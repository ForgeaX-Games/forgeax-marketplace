/**
 * Scenario(legacy) → GameScenario(graph) 一次性转换器。
 *
 * 把旧引擎的「玩法优先」Scenario（scenes + branches + overlays/dialogue/choice/qte）编译成
 * 新引擎 graph 数据模型（GameScenario/GameGraph + TimelineElement + EdgeRouting），让 graph 视图
 * 直接吃真实 per-game 剧本，而非硬编码 demo。映射约定（对齐 core-kinds 与 engine 的 handle 语义）：
 *
 *  - 每个 Scene → 一个 `perf` node（root scene 排首位，因为 engine 从 nodes[0] 起）。
 *  - onEnterEffects/setFlags → `settle`(logic, trigger=enter)；dialogue[] → `dialogue`(presentation)；
 *    overlays[] → `floatText`(presentation, kind text) + 可选 `settle`(logic)；scene.choice/choice 分支
 *    → `choice`(interaction)；scene.qte → `qte`(interaction)；scene.hotspots → `hotspot`(interaction)。
 *  - branches[] → 出边：choice→`opt:<branchId>`、qte_pass→`pass`/`good`、qte_fail→`fail`、
 *    auto(带条件)→`cond:N`/`else`、auto(无条件)→`out`；hotspot→`hs:<id>`。条件/副作用落 edge.data。
 *  - variables/entities(hp→attrs)/ui/textStylePresets → GameScenario 顶层 meta。
 */
import type {
  Branch,
  BranchCondition,
  ConditionClause,
  DialogueLine,
  Effect,
  GameVariable,
  OverlayClip,
  QTESpec,
  Scenario,
  Scene,
  TextStyle,
  TextStylePreset,
} from '../../scenario/types'
import type { EntitySpec as LegacyEntitySpec, UIConfig } from '../../scenario/gameplayTypes'
import { resolveInteraction } from '../../player/choiceTiming'
import type {
  EntitySpec,
  GameEdge,
  GameNode,
  GameScenario,
  GraphClause,
  GraphCondition,
  GraphEffect,
  GraphTextStyle,
  GraphTextStylePreset,
  PerfNodeData,
  TimelineElement,
  TriggerSpec,
  VarSpec,
} from './graph-schema'

export const GRAPH_SCHEMA_VERSION = 'wb-game-video.graph.v1'

// ── 顶层入口 ───────────────────────────────────────────────────────────────

export function scenarioToGraph(scenario: Scenario): GameScenario {
  const scenes = orderedScenes(scenario)
  const sceneIds = new Set(scenes.map((s) => s.id))

  const nodes: GameNode[] = scenes.map((scene) => buildNode(scene))
  const edges: GameEdge[] = []
  for (const scene of scenes) collectEdges(scene, sceneIds, edges)

  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    variables: mapVariables(scenario.variables),
    entities: mapEntities(scenario.entities),
    ui: mapUi(scenario.ui),
    rng: { seed: 1 },
    textStylePresets: mapPresets(scenario.textStylePresets),
    graph: { nodes, edges },
  }
}

// ── nodes ─────────────────────────────────────────────────────────────────

function buildNode(scene: Scene): GameNode {
  const data: PerfNodeData = {
    name: scene.title || scene.id,
    timeline: buildTimeline(scene),
  }
  if (scene.media?.ref) data.media = { kind: scene.media.kind, ref: scene.media.ref }
  if (scene.mediaPlayMode) data.mediaPlayMode = scene.mediaPlayMode
  if (scene.durationMs != null) data.durationMs = scene.durationMs
  if (scene.hudPreset) data.hud = { preset: scene.hudPreset }
  if (scene.isEnding) data.end = 'ending'
  if (scene.returnsToCaller) data.returnsToCaller = true
  if (scene.subFlowRef) data.subFlowRef = scene.subFlowRef
  return {
    id: scene.id,
    type: 'perf',
    position: scene.pos ? { x: scene.pos.x, y: scene.pos.y } : { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data,
  }
}

// ── timeline ──────────────────────────────────────────────────────────────

function buildTimeline(scene: Scene): TimelineElement[] {
  const els: TimelineElement[] = []

  // 1) onEnter 结算（effects + setFlags）
  const enterEffects: GraphEffect[] = [
    ...mapEffects(scene.onEnterEffects),
    ...(scene.setFlags ?? []).map(
      (varId, i): GraphEffect => ({ kind: 'flag', varId, value: true, id: `${scene.id}-setflag-${i}` }),
    ),
  ]
  if (enterEffects.length > 0) {
    els.push({
      id: `${scene.id}-onenter`,
      role: 'logic',
      kind: 'settle',
      trigger: { when: 'enter' },
      params: { effects: enterEffects },
    })
  }

  // 2) 字幕
  for (const line of scene.dialogue ?? []) els.push(dialogueElement(line))

  // 3) 飘字 / 结算叠层
  for (const ov of scene.overlays ?? []) els.push(...overlayElements(ov))

  // 4) 交互（choice / qte / hotspot）—— 互斥优先级同 resolveInteraction
  const it = resolveInteraction(scene).type
  if (it === 'qte' && scene.qte) {
    els.push(qteElement(scene, scene.qte))
  } else {
    const choiceEl = choiceElement(scene)
    if (choiceEl) els.push(choiceEl)
  }
  const hs = (scene.hotspots ?? []).filter((h) => h.targetSceneId)
  if (hs.length > 0) {
    els.push({
      id: `${scene.id}-hotspots`,
      role: 'interaction',
      kind: 'hotspot',
      trigger: { when: 'enter' },
      params: {
        hotspots: hs.map((h) => ({ id: h.id, target: h.targetSceneId, label: h.label, x: h.x, y: h.y })),
      },
    })
  }

  return els
}

function dialogueElement(line: DialogueLine): TimelineElement {
  const params: Record<string, unknown> = { text: line.text }
  if (line.speaker) params.speaker = line.speaker
  if (line.style) params.style = mapTextStyle(line.style)
  if (line.x != null) params.x = line.x
  if (line.y != null) params.y = line.y
  const window = line.endMs != null ? { startMs: line.startMs, endMs: line.endMs } : undefined
  return {
    id: line.id,
    role: 'presentation',
    kind: 'dialogue',
    trigger: triggerAt(line.startMs),
    ...(window ? { window } : {}),
    ...(line.layer != null ? { layer: line.layer } : {}),
    params,
  }
}

/** 一个 overlay → 可选 floatText（有可见 content）+ 可选 settle（有 settlement.effects）。 */
function overlayElements(ov: OverlayClip): TimelineElement[] {
  const out: TimelineElement[] = []
  const trigger = triggerAt(ov.startMs)
  const window = ov.endMs != null ? { startMs: ov.startMs, endMs: ov.endMs } : undefined

  if (ov.content && ov.content.trim().length > 0) {
    const params: Record<string, unknown> = { text: ov.content, x: ov.x, y: ov.y }
    if (ov.style) params.style = mapTextStyle(ov.style)
    if (ov.style?.color) params.color = ov.style.color
    if (ov.enter) params.enter = ov.enter
    if (ov.exit) params.exit = ov.exit
    out.push({
      id: ov.id,
      role: 'presentation',
      kind: 'floatText',
      trigger,
      ...(window ? { window } : {}),
      ...(ov.layer != null ? { layer: ov.layer } : {}),
      params,
    })
  }

  const effects = mapEffects(ov.settlement?.effects)
  if (effects.length > 0) {
    out.push({
      id: `${ov.id}-settle`,
      role: 'logic',
      kind: 'settle',
      trigger,
      params: { effects },
    })
  }

  return out
}

function choiceElement(scene: Scene): TimelineElement | null {
  const choiceBranches = (scene.branches ?? []).filter((b) => b.kind === 'choice')
  const spec = scene.choice
  if (choiceBranches.length === 0 && !spec) return null

  const params: Record<string, unknown> = {
    options: choiceBranches.map((b) => {
      const effects = mapEffects(b.effects)
      return { key: b.id, label: b.label ?? b.targetSceneId, ...(effects.length ? { effects } : {}) }
    }),
  }
  if (spec?.prompt) params.prompt = spec.prompt
  if (spec?.presentation) params.presentation = spec.presentation
  if (spec?.ui) params.ui = spec.ui
  if (spec?.fireAt) params.fireAt = spec.fireAt
  if (spec?.window?.timeoutMs != null) params.timeoutMs = spec.window.timeoutMs
  if (spec?.defaultBranchId) params.defaultKey = spec.defaultBranchId

  const startMs = spec?.window?.startMs
  return {
    id: `${scene.id}-choice`,
    role: 'interaction',
    kind: 'choice',
    trigger: startMs != null && startMs > 0 ? triggerAt(startMs) : { when: 'enter' },
    ...(spec?.layer != null ? { layer: spec.layer } : {}),
    params,
  }
}

function qteElement(scene: Scene, qte: QTESpec): TimelineElement {
  const params: Record<string, unknown> = {}
  if (qte.template) params.qteKind = qte.template
  if (qte.tolerance?.good != null) params.windowMs = qte.tolerance.good
  if (qte.tolerance) params.tolerance = qte.tolerance.good
  if (qte.score?.perfect != null) params.score = qte.score.perfect
  if (qte.passingScore != null) params.passingScore = qte.passingScore
  if (qte.sequence != null) params.sequence = qte.sequence ? [] : undefined
  if (qte.window) params.window = qte.window
  if (qte.ui) params.ui = qte.ui
  if (qte.outcomeLabels) params.outcomeLabels = qte.outcomeLabels
  params.passingHits = qte.sequence ? (qte.cues?.length ?? 1) : Math.max(1, Math.ceil((qte.cues?.length ?? 0) / 2)) || 1
  params.cues = (qte.cues ?? []).map((c) => ({
    id: c.id,
    shape: c.shape,
    x: c.x,
    y: c.y,
    appearAt: c.appearAt,
    targetAt: c.targetAt,
    durationMs: c.durationMs,
    sweepDir: c.sweepDir,
    label: c.label,
    triggerKey: c.triggerKey,
    layer: c.layer,
  }))

  return {
    id: `${scene.id}-qte`,
    role: 'interaction',
    kind: 'qte',
    trigger: { when: 'enter' },
    params,
  }
}

function triggerAt(ms: number): TriggerSpec {
  return ms > 0 ? { when: 'at', ms } : { when: 'enter' }
}

// ── edges（branches → 出边 handle）──────────────────────────────────────────

function collectEdges(scene: Scene, sceneIds: Set<string>, out: GameEdge[]): void {
  let condIdx = 0
  const autos = (scene.branches ?? []).filter((b) => b.kind === 'auto')
  const hasConditionalAuto = autos.some((b) => (b.condition?.all?.length ?? 0) > 0)

  for (const br of scene.branches ?? []) {
    if (!sceneIds.has(br.targetSceneId)) continue
    let handle: string
    switch (br.kind) {
      case 'choice':
        handle = `opt:${br.id}`
        break
      case 'qte_pass':
        handle = br.qteOutcome === 'good' ? 'good' : 'pass'
        break
      case 'qte_fail':
        handle = 'fail'
        break
      case 'auto':
      default:
        if ((br.condition?.all?.length ?? 0) > 0) handle = `cond:${condIdx++}`
        else handle = hasConditionalAuto ? 'else' : 'out'
        break
    }
    out.push(makeEdge(scene.id, br, handle))
  }

  // 热点子流程 / 跳转出边
  for (const hs of scene.hotspots ?? []) {
    if (!hs.targetSceneId || !sceneIds.has(hs.targetSceneId)) continue
    out.push({
      id: `e-${scene.id}-hs-${hs.id}`,
      source: scene.id,
      target: hs.targetSceneId,
      sourceHandle: `hs:${hs.id}`,
      ...(hs.mode !== 'goto' ? { data: { call: true } } : {}),
    })
  }
}

function makeEdge(source: string, br: Branch, handle: string): GameEdge {
  const condition = mapCondition(br.condition)
  const effects = mapEffects(br.effects)
  const data: GameEdge['data'] = {}
  if (condition) data.condition = condition
  if (effects.length > 0) data.effects = effects
  const edge: GameEdge = {
    id: `e-${source}-${handle}-${br.id}`.replace(/:/g, '_'),
    source,
    target: br.targetSceneId,
    sourceHandle: handle,
  }
  if (br.label) edge.label = br.label
  if (Object.keys(data).length > 0) edge.data = data
  return edge
}

// ── effects / conditions 映射 ───────────────────────────────────────────────

function mapEffects(effects: Effect[] | undefined): GraphEffect[] {
  if (!effects) return []
  const out: GraphEffect[] = []
  for (const e of effects) {
    switch (e.kind) {
      case 'var':
        out.push({ kind: 'var', varId: e.varId, op: e.op, value: e.value, ...(e.once ? { once: true } : {}), id: e.id })
        break
      case 'entityStat':
        out.push({ kind: 'attr', entityId: e.entityId, attr: e.stat, op: e.op, value: e.value, id: e.id })
        break
      case 'flag':
        out.push({ kind: 'flag', varId: e.varId, value: e.value, id: e.id })
        break
      case 'item':
        out.push({ kind: 'item', itemId: e.itemId, op: e.op, count: e.count, id: e.id })
        break
      case 'status':
      default:
        // status 无 graph 等价物，跳过。
        break
    }
  }
  return out
}

function mapCondition(cond: BranchCondition | undefined): GraphCondition | undefined {
  if (!cond || !cond.all || cond.all.length === 0) return undefined
  const all: GraphClause[] = []
  for (const c of cond.all) {
    const mapped = mapClause(c)
    if (mapped) all.push(mapped)
  }
  return all.length > 0 ? { all } : undefined
}

function mapClause(c: ConditionClause): GraphClause | null {
  switch (c.type) {
    case 'var':
      return { type: 'var', varId: c.varId, op: c.op, value: c.value }
    case 'flag':
      return { type: 'flag', varId: c.varId, equals: c.equals }
    case 'visited':
      return { type: 'visited', nodeId: c.sceneId }
    case 'hasItem':
      return { type: 'hasItem', itemId: c.itemId, ...(c.count != null ? { count: c.count } : {}) }
    case 'hpRatio':
      return { type: 'attrRatio', entityId: c.entityId, attr: 'hp', op: c.op, value: c.value }
    case 'score':
      return { type: 'score', op: c.op, value: c.value }
    case 'attrCompare':
      return { type: 'attrCompare', left: c.left, right: c.right, attr: c.attr, op: c.op }
    case 'status':
    default:
      return null
  }
}

// ── meta 映射 ───────────────────────────────────────────────────────────────

function mapVariables(vars: Record<string, GameVariable> | undefined): Record<string, VarSpec> | undefined {
  if (!vars || Object.keys(vars).length === 0) return undefined
  const out: Record<string, VarSpec> = {}
  for (const [id, v] of Object.entries(vars)) {
    out[id] = {
      id: v.id,
      name: v.name,
      kind: v.kind,
      initial: v.initial,
      ...(v.min != null ? { min: v.min } : {}),
      ...(v.max != null ? { max: v.max } : {}),
    }
  }
  return out
}

function mapEntities(entities: Record<string, LegacyEntitySpec> | undefined): Record<string, EntitySpec> | undefined {
  if (!entities || Object.keys(entities).length === 0) return undefined
  const out: Record<string, EntitySpec> = {}
  for (const [id, e] of Object.entries(entities)) {
    const initialHp = e.initialHp ?? e.maxHp
    out[id] = {
      id: e.id,
      name: e.name,
      kind: e.kind,
      attrs: { hp: initialHp, speed: e.speed ?? 0 },
      attrMeta: { hp: { min: 0, max: e.maxHp, initial: initialHp, label: '生命' } },
    }
  }
  return out
}

function mapUi(ui: UIConfig | undefined): GameScenario['ui'] {
  if (!ui) return undefined
  const out: NonNullable<GameScenario['ui']> = {}
  if (ui.hud) out.hud = ui.hud.map((r) => ({ element: r.element, show: r.show }))
  if (ui.accentColor) out.accentColor = ui.accentColor
  return Object.keys(out).length > 0 ? out : undefined
}

function mapTextStyle(s: TextStyle): GraphTextStyle {
  return {
    ...(s.fontFamily != null ? { fontFamily: s.fontFamily } : {}),
    ...(s.fontWeight != null ? { fontWeight: s.fontWeight } : {}),
    ...(s.italic != null ? { italic: s.italic } : {}),
    ...(s.underline != null ? { underline: s.underline } : {}),
    ...(s.color != null ? { color: s.color } : {}),
    ...(s.strokeColor != null ? { strokeColor: s.strokeColor } : {}),
    ...(s.strokeWidth != null ? { strokeWidth: s.strokeWidth } : {}),
    ...(s.fontSizePct != null ? { fontSizePct: s.fontSizePct } : {}),
    ...(s.align != null ? { align: s.align } : {}),
    ...(s.bgColor != null ? { bgColor: s.bgColor } : {}),
    ...(s.opacity != null ? { opacity: s.opacity } : {}),
    ...(s.shadow != null ? { shadow: s.shadow } : {}),
  }
}

function mapPresets(
  presets: { subtitle: TextStylePreset[]; overlay: TextStylePreset[] } | undefined,
): GameScenario['textStylePresets'] {
  if (!presets) return undefined
  const conv = (list: TextStylePreset[] | undefined): GraphTextStylePreset[] | undefined =>
    list && list.length > 0
      ? list.map((p) => ({
          id: p.id,
          name: p.name,
          style: mapTextStyle(p.style),
          ...(p.speakerPrefix != null ? { speakerPrefix: p.speakerPrefix } : {}),
          ...(p.builtin != null ? { builtin: p.builtin } : {}),
        }))
      : undefined
  const subtitle = conv(presets.subtitle)
  const overlay = conv(presets.overlay)
  if (!subtitle && !overlay) return undefined
  return { ...(subtitle ? { subtitle } : {}), ...(overlay ? { overlay } : {}) }
}

// ── utils ─────────────────────────────────────────────────────────────────

function orderedScenes(scenario: Scenario): Scene[] {
  const all = Object.values(scenario.scenes)
  const rootId = scenario.rootSceneId
  const root = all.find((s) => s.id === rootId)
  if (!root) return all
  return [root, ...all.filter((s) => s.id !== rootId)]
}
