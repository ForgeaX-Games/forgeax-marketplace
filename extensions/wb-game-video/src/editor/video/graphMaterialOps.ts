/**
 * graphMaterialOps —— 「新引擎 › 视频」编辑器的 scenario 原生数据层（读投影 + 写映射）。
 *
 * 权威数据 = `graphScenarioStore` 合出的 `GameScenario`（graph + `ui.overlays`）。一个演出节点
 * （`node.id === scene.id`）经 `node.data.overlayNodes` 指向 `scenario.ui.overlays[id]`，
 * 该 overlay 的 `children[]`（`OverlayChild[]`）就是旧 Scene 的 dialogue/overlays/qte/choice/branches
 * 的**统一容器**。这里把它投影成时间轴用的 `MaterialItem[]` / 预览叠层，并把编辑（拖拽/检视器/增删/
 * 选项分支）经 `overlay-edit` + `graph-edit` 原语写回 —— 全程不落任何 Scene 拷贝。
 *
 * 每个节点专属一张 overlay（`node:<nodeId>`，见 `ensureNodeOverlay`）：本编辑器只直写该 overlay 的
 * `children`。挂载侧仅 `overlay` + `layout` + `reactions`，不补丁子组件。
 *
 * 旧 → 新 kind 映射：
 *   字幕 dialogue[]     → kind 'dialogue'   （MaterialItem 'subtitle'）
 *   飘字 overlays[]      → kind 'floatText'  （'overlay'）+ 结算联动 = 节点 reaction（effect.id `${floatId}-settle`）
 *   QTE  qte.cues[]      → kind 'qte'（inputs.cues[]）→ 每 cue 一个 'qte' 项（整段 QTE 跨度由 cues 派生，不再单列 'qte_window' 轨）
 *   选项 choice+branches → kind 'choice'（inputs.events[]）+ 分支跳转 = 出边 `<id>`；效果 = 节点 event reaction
 */
import type {
  Entity,
  GameNode,
  GameScenario,
  GraphEffect,
  GraphTextStyle,
  NumOrExpr,
  OverlayChild,
  Reaction,
  Trigger,
} from '../../runtime/schema/graph-schema'
import type { NodeAction } from '../../runtime/schema/node-config-schema'
import type { ChoiceOption, FloatTextParams, QteCue } from '../../runtime/registry/core-components'
import { componentHandles, componentTypeLabel, defaultsForComponent, getComponent, hasCuePointsInput, hasOptionEventsInput, isPositionable } from '../../runtime/registry/component-registry'
import { INTERACTION_SKINS } from '../../runtime/skins/components'
import { FILTER_PRESETS, FX_PRESETS } from '../../runtime/fx/video-fx'
import { initState } from '../../runtime/engine/engine-init'
import type { InteractionSnap } from '../../runtime/engine/session'
import type { MaterialItem, MaterialKind } from './materialTimelineShared'
import { clampLayer, clampMs, normalizeLayer } from './materialTimelineShared'
import {
  type PreviewEvalContext,
  type QteOutcomePreview,
  resolveChoicePreviewDetail,
  resolveFloatTextPreviewLabel,
  resolveQteCuePreviewLabel,
  resolveQteOutcomesPreviewDetail,
} from './previewResolve'
import {
  disconnect,
  newElementId,
  teardownInteraction,
  updateNodeData,
  upsertBranchEdge,
} from '../../graph/edit/graph-edit'
import {
  addOverlayChild,
  addOverlayChildToMount,
  ensureNodeOverlay,
  findMountOwningChild,
  forkSchemeForEdit,
  overriddenChildIds,
  patchOverlayChild,
  patchOverlayMount,
  primaryOverlayMount,
  removeOverlayChild,
  resetOverride,
} from '../../graph/edit/overlay-edit'
import { overlayMountId } from '../../runtime/schema/node-config-schema'
import { resolveMountChildren } from '../../runtime/schema/expand-overlay'

// ── overlay children 读取小工具（内容挂载 = 原型 ⊕ 稀疏差量，见 resolveMountChildren） ──
/** 内容挂载的 children：原型（共享方案）跟随 + 本挂载 overrides/added/removed 差量。 */
function childrenOf(scenario: GameScenario, node: GameNode | undefined): OverlayChild[] {
  const mount = primaryOverlayMount(node)
  if (!mount) return []
  return resolveMountChildren(scenario.ui?.overlays, mount)
}

/** 节点所有挂载（共享方案 + 节点专属）解析后的 children；交互元素检索用。 */
function mountedChildrenOf(scenario: GameScenario, node: GameNode | undefined): OverlayChild[] {
  if (!node) return []
  const out: OverlayChild[] = []
  for (const mount of node.data.overlayNodes ?? []) {
    out.push(...resolveMountChildren(scenario.ui?.overlays, mount))
  }
  return out.length ? out : childrenOf(scenario, node)
}
/** 拆掉一整段交互：先摘掉承载它的 overlay child，再删占用的出边（`teardownInteraction` 只管边）。 */
function teardownInteractionScenario(
  scenario: GameScenario,
  node: GameNode,
  opts: { kind: string; handlePrefixes: string[]; continueHandle?: string; childId?: string },
): GameScenario {
  const s = opts.childId ? removeOverlayChild(scenario, node.id, opts.childId) : scenario
  return { ...s, graph: teardownInteraction(s.graph, node.id, opts) }
}

// ── 预览叠层 ─────────────────────────────────────────────────────────────────
export type PreviewTarget =
  | { kind: 'element'; elementId: string }
  | { kind: 'qteCue'; elementId: string; cueId: string }
  | { kind: 'readonly' }

export interface PreviewOverlay {
  id: string
  materialKey: string
  kind: MaterialKind
  label: string
  /** 求值后的效果摘要（选项各分支 / QTE 各档改数值），多行；预览副标题展示。 */
  detail?: string
  x: number
  y: number
  zIndex: number
  movable: boolean
  style?: GraphTextStyle
  target: PreviewTarget
}

export const SUBTITLE_XY = { x: 0.5, y: 0.9 }
export const OVERLAY_XY = { x: 0.5, y: 0.42 }
/** 选项整组默认锚点（预览拖拽 / 新建缺省 / 皮肤回退共用）。 */
export const OPTION_XY = { x: 0.5, y: 0.72 }
const QTE_GOOD_WINDOW = 480
/**
 * QTE 元素级参数键（落 el.inputs，非某个 cue）：完美半窗 / 过关次数 / 满分 / 过关分 /
 * 出口目录（events/defaultEvent，PR #77）+ 旧 exits/defaultKey 兼容 / 皮肤自管时长
 * （windowMs 或 durationMs——注意与 cue 级 `durationMs` hold 时长同名冲突）。
 */
const QTE_ELEMENT_PARAM_KEYS = new Set([
  'perfectMs',
  'passingHits',
  'score',
  'passingScore',
  'tolerance',
  'events',
  'defaultEvent',
  'exits',
  'defaultKey',
  'windowMs',
  'durationMs',
  'timeoutMs',
])
/** 边路由统一后选项 handle = 裸 event id（无 `opt:` 前缀）。 */
const CHOICE_HANDLE = ''

// ── 元素读取小工具 ────────────────────────────────────────────────────────────
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function paramsOf(el: OverlayChild | undefined): Record<string, unknown> {
  return el?.inputs ?? {}
}
function cuesOf(el: OverlayChild | undefined): QteCue[] {
  const cues = paramsOf(el).cues
  return Array.isArray(cues) ? (cues as QteCue[]) : []
}
function optionsOf(el: OverlayChild | undefined): ChoiceOption[] {
  const events = paramsOf(el).events
  return Array.isArray(events) ? (events as ChoiceOption[]) : []
}

/** 结算后刷出的瞬态组件（NodeAction.spawn；本版 ttl 截断到当前节点时长）。 */
export interface SettlementSpawn {
  from: string
  ttlMs?: number
  inputs?: Record<string, unknown>
}

/** 本节点演出时长（ms）；缺省给一个安全上限，避免 spawn 无界。 */
export function nodePlayDurationMs(node: GameNode): number {
  const d = node.data.durationMs
  return typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.round(d) : 60_000
}

/** 本版：spawn 不跨节点——ttl 夹在 (0, nodeDur]；缺省/0 = 撑到本节点结束。 */
export function clampSettlementSpawnTtlMs(ttlMs: number | undefined, nodeDurMs: number): number {
  const cap = Math.max(100, Math.round(nodeDurMs))
  if (ttlMs == null || !Number.isFinite(ttlMs) || ttlMs <= 0) return cap
  return Math.min(Math.max(100, Math.round(ttlMs)), cap)
}

function readSpawnFromDo(actions: NodeAction[] | undefined): SettlementSpawn | undefined {
  const a = actions?.find((x) => x.kind === 'spawn' && x.from)
  if (!a || a.kind !== 'spawn') return undefined
  return {
    from: a.from,
    ...(a.ttlMs != null ? { ttlMs: a.ttlMs } : {}),
    ...(a.inputs && Object.keys(a.inputs).length ? { inputs: a.inputs } : {}),
  }
}

function spawnActionOf(spawn: SettlementSpawn, nodeDurMs: number): Extract<NodeAction, { kind: 'spawn' }> {
  return {
    kind: 'spawn',
    from: spawn.from,
    ttlMs: clampSettlementSpawnTtlMs(spawn.ttlMs, nodeDurMs),
    ...(spawn.inputs && Object.keys(spawn.inputs).length ? { inputs: spawn.inputs } : {}),
  }
}

/**
 * legacy 读兜底 —— 2026-07-16 边路由统一重构曾把选项/组件结算误写进 `node.data.reactions`
 * （运行时 submitInteraction/emitComponentEvent 只读 mount.reactions，这条数据从未被执行过，见
 * §结算 mount-scoped 改造说明）。现只在 `readMountEventEffects`/`readMountEventSpawn` mount 侧
 * 无命中时回落一次，避免历史配置在升级后静默消失；不再是任何结算的主写入位置。
 */
function readEventEffects(node: GameNode, id: string): GraphEffect[] {
  const r = (node.data.reactions ?? []).find((rc) => rc.when.type === 'event' && rc.when.id === id)
  const eff = r?.do.find((a) => a.kind === 'effect')
  return eff && eff.kind === 'effect' ? eff.effects : []
}

function readEventSpawn(node: GameNode, id: string): SettlementSpawn | undefined {
  const r = (node.data.reactions ?? []).find((rc) => rc.when.type === 'event' && rc.when.id === id)
  return readSpawnFromDo(r?.do)
}

/** legacy 清理用：见 `clearLegacyNodeEvent`（写入 mount 侧后同步清掉这条 node 级残留）。 */
function writeEventEffectsData(
  reactions: Reaction[] | undefined,
  id: string,
  effects: GraphEffect[],
): Reaction[] | undefined {
  const list = reactions ?? []
  const idx = list.findIndex((r) => r.when.type === 'event' && r.when.id === id)
  if (idx < 0) {
    if (!effects.length) return reactions
    return [...list, { when: { type: 'event', id }, do: [{ kind: 'effect', effects }] }]
  }
  const r = list[idx]!
  const rest = r.do.filter((a) => a.kind !== 'effect')
  const nextDo = effects.length ? [{ kind: 'effect' as const, effects }, ...rest] : rest
  const next = [...list]
  if (nextDo.length) next[idx] = { ...r, do: nextDo }
  else next.splice(idx, 1)
  return next.length ? next : undefined
}

/** legacy 清理用：见 `clearLegacyNodeEvent`。 */
function writeEventSpawnData(
  reactions: Reaction[] | undefined,
  id: string,
  spawn: SettlementSpawn | undefined,
  nodeDurMs: number,
): Reaction[] | undefined {
  const list = reactions ?? []
  const idx = list.findIndex((r) => r.when.type === 'event' && r.when.id === id)
  const spawnDo = spawn?.from ? [spawnActionOf(spawn, nodeDurMs)] : []
  if (idx < 0) {
    if (!spawnDo.length) return reactions
    return [...list, { when: { type: 'event', id }, do: spawnDo }]
  }
  const r = list[idx]!
  const rest = r.do.filter((a) => a.kind !== 'spawn')
  const nextDo = [...rest, ...spawnDo]
  const next = [...list]
  if (nextDo.length) next[idx] = { ...r, do: nextDo }
  else next.splice(idx, 1)
  return next.length ? next : undefined
}

/** 目录里可选作 spawn 模板的组件（`overlayId/childId`）。 */
export function listSpawnTemplateOptions(
  scenario: GameScenario,
): Array<{ value: string; label: string }> {
  const overlays = scenario.ui?.overlays ?? {}
  const out: Array<{ value: string; label: string }> = []
  for (const ov of Object.values(overlays)) {
    for (const c of ov.children) {
      const label = componentTypeLabel(c.component)
      const title = ov.title?.trim()
      out.push({
        value: `${ov.id}/${c.id}`,
        label: title ? `${label} · ${title}/${c.id}` : `${label} · ${ov.id}/${c.id}`,
      })
    }
  }
  return out
}
function filterLabel(id: unknown): string {
  return FILTER_PRESETS.find((p) => p.id === id)?.label ?? '滤镜'
}
function fxLabel(id: unknown): string {
  return FX_PRESETS.find((p) => p.id === id)?.label ?? '特效'
}

/** 预览求值上下文：以场景 meta 初始态求所有公式（与试玩首帧一致）。 */
function previewCtxFor(scenario: GameScenario): { ctx: PreviewEvalContext; state: ReturnType<typeof initState> } {
  const state = initState(scenario)
  return {
    state,
    ctx: {
      evalCtx: { vars: state.vars, entities: state.entities, flags: state.flags, score: state.score, rng: state.rng },
      entities: scenario.entities,
      variables: scenario.variables,
    },
  }
}

// ── 结算（选项分支 / QTE 档位 / 通用组件事件，三者共用同一套读写内核）──────────────
// 运行时只读 mount.reactions 承接 event 类反应（engine.ts submitInteraction/emitComponentEvent
// 都只查 nodeOverlayMounts(node)...reactions），落盘统一走 mount 级——跳转=边，改数值/生成组件=
// mount 的 event reaction。candidate handle 来自各自的 events 目录（选项=inputs.events 的 id、
// QTE=componentHandles(skin, inputs)、通用组件=manifest.events/inputs.events）。
export type QteOutcomeHandle = string
export interface OutcomeCandidate {
  handle: QteOutcomeHandle
  label: string
}
export interface OutcomeView {
  key: string
  label: string
  targetId: string | undefined
  edgeId: string | undefined
  effects: GraphEffect[]
  /** 结算后刷出的瞬态组件（本节点内，ttl 截断到节点时长）。 */
  spawn?: SettlementSpawn
  /**
   * QTE 默认三档里「良好」未单独配置时，运行时会按「完美」结算 —— UI 提示用。
   * 仅当候选同时含 pass/good 时才可能为 true（组合按键 exits 模式不适用；选项/通用组件恒为 false）。
   */
  fallsBackToPass?: boolean
}
/** 向后兼容命名（QTE 结算专用别名，语义与 OutcomeCandidate/OutcomeView 相同）。 */
export type QteOutcomeCandidate = OutcomeCandidate

/**
 * 有完整专属皮肤实现的组件（真实交互动画 + 自己的固定出口目录）——不是靠某个分类字段
 * （"QTE"/"choice"）圈出来的一族，而是直接从 `INTERACTION_SKINS`（唯一登记点，见
 * `runtime/skins/components/index.ts`）派生：新皮肤在那边注册一行，这里自动识别，不必再手工
 * 同步维护第二份组件 id 名单。
 * - 编辑器能直接渲染它们的真实皮肤做时间轴预览（而不是通用兜底展示）；
 * - 它们的出口目录（`events[]` + `defaultEvent`，见 `ChoiceParams`/`QteParams` 共用契约）不让
 *   编辑器自由增删/改文案，永远用自己皮肤登记的 `defaultEvents` 覆盖。
 * 默认清单（choice/skill/qte 裸组件，未在 `INTERACTION_SKINS` 登记）不在此列，可自由增删事件。
 */
const RICH_SKIN_COMPONENTS = new Set(INTERACTION_SKINS.map((s) => s.id))

/** 上述组件各自的固定出口目录，直接取自 `INTERACTION_SKINS` 登记的 `defaultEvents`。 */
const RICH_SKIN_DEFAULT_EVENTS: Record<string, ChoiceOption[]> = Object.fromEntries(
  INTERACTION_SKINS.map((s) => [s.id, s.defaultEvents as ChoiceOption[]]),
)

/** 当前组件是否样式锁定出口集合（默认清单可自由增删；这份白名单里的不可）。 */
export function componentEventsLocked(component: string | undefined): boolean {
  return RICH_SKIN_COMPONENTS.has(component ?? '')
}

/**
 * 样式锁定出口：白名单组件强制用自己皮肤 defaults.events 覆盖实例上可被写脏的 events。
 * （边路由统一后 SSOT = inputs.events；旧 exits/defaultKey 仅作兼容回退。）
 */
export function applyStyleLockedEventParams(
  inputs: Record<string, unknown>,
  componentId?: string,
): Record<string, unknown> {
  const id = componentId ?? ''
  const cleaned = inputs
  if (!RICH_SKIN_COMPONENTS.has(id)) return cleaned
  const locked = RICH_SKIN_DEFAULT_EVENTS[id]
  if (!Array.isArray(locked) || locked.length === 0) return cleaned
  return {
    ...cleaned,
    events: locked.map((e) => ({ id: e.id, label: e.label, condition: e.condition })),
    defaultEvent:
      (typeof cleaned.defaultEvent === 'string' && cleaned.defaultEvent) ||
      (typeof cleaned.defaultKey === 'string' && cleaned.defaultKey) ||
      'fail',
  }
}

/** 某 QTE 元素当前样式声明的结算候选 = component manifest.events / componentHandles(skin, inputs)。 */
function qteOutcomeCandidates(el: OverlayChild | undefined): QteOutcomeCandidate[] {
  if (!el) return []
  const skin = el.component
  const inputs = applyStyleLockedEventParams(paramsOf(el), skin)
  const outs = componentHandles(skin, inputs)
  return outs.map((o: { id: string; label?: string }) => ({
    handle: o.id,
    label: o.label ?? o.id,
  }))
}

/** 出边命中（跳转=边，与 reactions 无关）；无 `sourceHandle` 视为 `'default'`。 */
function edgeForHandle(scenario: GameScenario, nodeId: string, handle: string) {
  return scenario.graph.edges.find((e) => e.source === nodeId && (e.sourceHandle ?? 'default') === handle)
}

/**
 * 含指定元素 elId 的挂载 id——选项/QTE/通用组件结算统一用这个定位落盘位置。
 * 取代原先只找「含 qte 子件」的 QTE 专属定位，改为按元素 id 精确定位（HUD 等第二份挂载同样命中）。
 */
function mountIdForElement(scenario: GameScenario, node: GameNode, elId: string): string | undefined {
  const owning = findMountOwningChild(scenario, node, elId)
  if (owning) return overlayMountId(owning)
  const pm = primaryOverlayMount(node)
  return pm ? overlayMountId(pm) : undefined
}

function mountReactionsOf(scenario: GameScenario, node: GameNode, mountId: string): Reaction[] {
  const mount = (node.data.overlayNodes ?? []).find((m) => overlayMountId(m) === mountId)
  return mount?.reactions ?? []
}

function hasMountEventReaction(scenario: GameScenario, node: GameNode, elId: string, eventId: string): boolean {
  const mountId = mountIdForElement(scenario, node, elId)
  if (!mountId) return false
  return mountReactionsOf(scenario, node, mountId).some((r) => r.when.type === 'event' && r.when.id === eventId)
}

/**
 * 读某元素 event(id) 结算的 effect——运行时真正读的地方（mount.reactions）。
 * legacy 兜底：2026-07-16 边路由统一重构一度把选项/组件结算误写进 `node.data.reactions`
 * （运行时从不读，等于配了不生效，见本次修复说明），mount 侧无该档时回落扫一遍，
 * 避免历史配置在升级后静默消失；下一次编辑写入时会同步清掉这条 legacy 残留（见 writeMountEventEffects）。
 */
function readMountEventEffects(scenario: GameScenario, node: GameNode, elId: string, eventId: string): GraphEffect[] {
  const mountId = mountIdForElement(scenario, node, elId)
  const rx = mountId ? mountReactionsOf(scenario, node, mountId) : []
  const hit = rx.find((r) => r.when.type === 'event' && r.when.id === eventId)
  const eff = hit?.do.find((a) => a.kind === 'effect')
  if (eff && eff.kind === 'effect' && eff.effects.length) return eff.effects
  return readEventEffects(node, eventId)
}

/** 读某元素 event(id) 结算的 spawn；legacy 兜底同 `readMountEventEffects`。 */
function readMountEventSpawn(scenario: GameScenario, node: GameNode, elId: string, eventId: string): SettlementSpawn | undefined {
  const mountId = mountIdForElement(scenario, node, elId)
  const rx = mountId ? mountReactionsOf(scenario, node, mountId) : []
  const hit = rx.find((r) => r.when.type === 'event' && r.when.id === eventId)
  const spawn = readSpawnFromDo(hit?.do)
  return spawn ?? readEventSpawn(node, eventId)
}

function isOutcomeConfigured(scenario: GameScenario, node: GameNode, elId: string, handle: string): boolean {
  if (edgeForHandle(scenario, node.id, handle)) return true
  if (hasMountEventReaction(scenario, node, elId, handle)) return true
  if (readMountEventEffects(scenario, node, elId, handle).length > 0) return true
  return !!readMountEventSpawn(scenario, node, elId, handle)
}

function outcomeView(
  scenario: GameScenario,
  node: GameNode,
  elId: string,
  handle: string,
  label: string,
  candidates: OutcomeCandidate[],
): OutcomeView {
  const edge = edgeForHandle(scenario, node.id, handle)
  const hasGood = candidates.some((c) => c.handle === 'good')
  return {
    key: handle,
    label,
    targetId: edge?.target,
    edgeId: edge?.id,
    effects: readMountEventEffects(scenario, node, elId, handle),
    spawn: readMountEventSpawn(scenario, node, elId, handle),
    fallsBackToPass: handle === 'pass' && hasGood && !isOutcomeConfigured(scenario, node, elId, 'good'),
  }
}

/** 检视器：已配置的 QTE 结算档；无任何配置时默认展示样式的第一档候选（可不跳转）。 */
export function listQteOutcomeViews(scenario: GameScenario, node: GameNode): OutcomeView[] {
  const el = qteElement(scenario, node)
  if (!el) return []
  const candidates = qteOutcomeCandidates(el)
  const configured = candidates.filter((c) => isOutcomeConfigured(scenario, node, el.id, c.handle))
  if (configured.length === 0) {
    const first = candidates[0] ?? { handle: 'pass', label: '完美' }
    return [outcomeView(scenario, node, el.id, first.handle, first.label, candidates)]
  }
  return configured.map((c) => outcomeView(scenario, node, el.id, c.handle, c.label, candidates))
}

/** 还可添加的 QTE 结算档（来自当前样式的候选集，减去已配置的）。 */
export function listAvailableQteOutcomes(scenario: GameScenario, node: GameNode): OutcomeCandidate[] {
  const el = qteElement(scenario, node)
  if (!el) return []
  const used = new Set(listQteOutcomeViews(scenario, node).map((o) => o.key))
  return qteOutcomeCandidates(el).filter((c) => !used.has(c.handle))
}

/** 确保节点至少有一份可编辑挂载，并定位 elId 所属挂载 id（写路径通用入口）。 */
function ensureReactionMountFor(scenario: GameScenario, node: GameNode, elId: string): { scenario: GameScenario; mountId: string } {
  let s = forkSchemeForEdit(scenario, node.id)
  const n = s.graph.nodes.find((x) => x.id === node.id)!
  let mountId = mountIdForElement(s, n, elId)
  if (!mountId) {
    const pm = primaryOverlayMount(n)!
    mountId = overlayMountId(pm)
  }
  return { scenario: s, mountId }
}

/**
 * 写挂载级 event reaction 的 effect（保留 spawn 等其它 do）。
 * `effects: []` 仍落一条空 effect，用作「该档已配置」标记（与历史行为一致）。
 */
function patchMountEventReaction(
  scenario: GameScenario,
  node: GameNode,
  mountId: string,
  handle: string,
  effects: GraphEffect[] | undefined,
  remove = false,
): GameScenario {
  const prev = mountReactionsOf(scenario, node, mountId)
  const existing = prev.find((r) => r.when.type === 'event' && r.when.id === handle)
  const kept = prev.filter((r) => !(r.when.type === 'event' && r.when.id === handle))
  if (!remove) {
    const rest = (existing?.do ?? []).filter((a) => a.kind !== 'effect')
    kept.push({
      when: { type: 'event', id: handle },
      do: [{ kind: 'effect', effects: effects ?? [] }, ...rest],
    })
  }
  return patchOverlayMount(scenario, node.id, mountId, { reactions: kept.length ? kept : undefined })
}

/** 写挂载级 event reaction 的 spawn（保留 effect 等其它 do；本版 ttl 截断到节点时长）。 */
function patchMountEventSpawn(
  scenario: GameScenario,
  node: GameNode,
  mountId: string,
  handle: string,
  spawn: SettlementSpawn | undefined,
): GameScenario {
  const prev = mountReactionsOf(scenario, node, mountId)
  const existing = prev.find((r) => r.when.type === 'event' && r.when.id === handle)
  const kept = prev.filter((r) => !(r.when.type === 'event' && r.when.id === handle))
  const rest = (existing?.do ?? []).filter((a) => a.kind !== 'spawn')
  // 尚无 reaction 时补空 effect，保证该档算「已配置」
  const withEffect = rest.some((a) => a.kind === 'effect')
    ? rest
    : ([{ kind: 'effect' as const, effects: [] as GraphEffect[] }, ...rest] as NodeAction[])
  const nextDo = spawn?.from
    ? [...withEffect, spawnActionOf(spawn, nodePlayDurationMs(node))]
    : withEffect
  if (nextDo.length) kept.push({ when: { type: 'event', id: handle }, do: nextDo })
  return patchOverlayMount(scenario, node.id, mountId, { reactions: kept.length ? kept : undefined })
}

/** 删掉挂载上某档整条 event reaction（区别于「effects 置空」——那仍算「已配置」）。 */
function removeMountEventReaction(scenario: GameScenario, node: GameNode, elId: string, eventId: string): GameScenario {
  const mountId = mountIdForElement(scenario, node, elId)
  if (!mountId) return scenario
  return patchMountEventReaction(scenario, node, mountId, eventId, undefined, true)
}

/** 清掉 legacy `node.data.reactions` 里同 id 的残留（写入新位置后不留两处数据）。 */
function clearLegacyNodeEvent(scenario: GameScenario, node: GameNode, eventId: string): GameScenario {
  const n = scenario.graph.nodes.find((x) => x.id === node.id) ?? node
  let reactions = writeEventEffectsData(n.data.reactions, eventId, [])
  reactions = writeEventSpawnData(reactions, eventId, undefined, nodePlayDurationMs(n))
  if (reactions === n.data.reactions) return scenario
  return { ...scenario, graph: updateNodeData(scenario.graph, node.id, { reactions }) }
}

/** 写某元素 event(id) 结算的 effect（mount 级，运行时真正读的地方）+ 顺带清 legacy 残留。 */
function writeMountEventEffects(scenario: GameScenario, node: GameNode, elId: string, eventId: string, effects: GraphEffect[]): GameScenario {
  const { scenario: s0, mountId } = ensureReactionMountFor(scenario, node, elId)
  const n = s0.graph.nodes.find((x) => x.id === node.id)!
  const s1 = patchMountEventReaction(s0, n, mountId, eventId, effects)
  return clearLegacyNodeEvent(s1, s1.graph.nodes.find((x) => x.id === node.id)!, eventId)
}

/** 写某元素 event(id) 结算的 spawn（mount 级）+ 顺带清 legacy 残留。 */
function writeMountEventSpawn(scenario: GameScenario, node: GameNode, elId: string, eventId: string, spawn: SettlementSpawn | undefined): GameScenario {
  const { scenario: s0, mountId } = ensureReactionMountFor(scenario, node, elId)
  const n = s0.graph.nodes.find((x) => x.id === node.id)!
  const s1 = patchMountEventSpawn(s0, n, mountId, eventId, spawn)
  return clearLegacyNodeEvent(s1, s1.graph.nodes.find((x) => x.id === node.id)!, eventId)
}

export function addQteOutcomeGraph(scenario: GameScenario, node: GameNode, handle: QteOutcomeHandle): GameScenario {
  const el = qteElement(scenario, node)
  if (!el || isOutcomeConfigured(scenario, node, el.id, handle)) return scenario
  let s = scenario
  const first = qteOutcomeCandidates(el)[0]?.handle ?? 'pass'
  if (listQteOutcomeViews(s, node).length === 1 && !isOutcomeConfigured(s, node, el.id, first) && handle !== first) {
    s = ensureQtePassOutcomeGraph(s, node)
  }
  return setQteOutcomeEffectsGraph(s, node, handle, [])
}

/** 确保样式第一档候选（缺省 'pass'）已显式落盘——避免"只有一张隐式默认卡"的歧义态。 */
export function ensureQtePassOutcomeGraph(scenario: GameScenario, node: GameNode): GameScenario {
  const el = qteElement(scenario, node)
  if (!el) return scenario
  const first = qteOutcomeCandidates(el)[0]?.handle ?? 'pass'
  if (isOutcomeConfigured(scenario, node, el.id, first)) return scenario
  return setQteOutcomeEffectsGraph(scenario, node, first, [])
}

export function removeQteOutcomeGraph(scenario: GameScenario, node: GameNode, handle: QteOutcomeHandle): GameScenario {
  const cards = listQteOutcomeViews(scenario, node)
  if (cards.length <= 1) return scenario
  let s = scenario
  const edge = edgeForHandle(s, node.id, handle)
  if (edge) s = { ...s, graph: disconnect(s.graph, edge.id) }
  const n = s.graph.nodes.find((x) => x.id === node.id)!
  const el = qteElement(s, n)
  if (el) s = removeMountEventReaction(s, s.graph.nodes.find((x) => x.id === node.id)!, el.id, handle)
  return s
}

export function setQteOutcomeTargetGraph(
  scenario: GameScenario,
  node: GameNode,
  handle: QteOutcomeHandle,
  targetId: string,
): GameScenario {
  let s = scenario
  if (!targetId) {
    const edge = edgeForHandle(s, node.id, handle)
    return edge ? { ...s, graph: disconnect(s.graph, edge.id) } : s
  }
  const el = qteElement(s, node)
  if (el && !isOutcomeConfigured(s, node, el.id, handle)) {
    s = setQteOutcomeEffectsGraph(s, node, handle, [])
  }
  return { ...s, graph: upsertBranchEdge(s.graph, { source: node.id, sourceHandle: handle, target: targetId }) }
}

export function setQteOutcomeEffectsGraph(
  scenario: GameScenario,
  node: GameNode,
  handle: QteOutcomeHandle,
  effects: GraphEffect[],
): GameScenario {
  const el = qteElement(scenario, node)
  if (!el) return scenario
  return writeMountEventEffects(scenario, node, el.id, handle, effects)
}

export function setQteOutcomeSpawnGraph(
  scenario: GameScenario,
  node: GameNode,
  handle: QteOutcomeHandle,
  spawn: SettlementSpawn | undefined,
): GameScenario {
  const el = qteElement(scenario, node)
  if (!el) return scenario
  return writeMountEventSpawn(scenario, node, el.id, handle, spawn)
}

/** 预览摘要：各档改数值（读 mount reactions，legacy 兜底见 readMountEventEffects）。 */
function listQteOutcomes(scenario: GameScenario, node: GameNode): QteOutcomePreview[] {
  return listQteOutcomeViews(scenario, node)
    .filter((o) => o.effects.length > 0)
    .map((o) => ({
      handle: o.key,
      label: o.label,
      effects: o.effects,
      fallsBackToPass: o.fallsBackToPass,
    }))
}

function firstEntityId(entities: Record<string, Entity> | undefined, kind: 'boss' | 'player'): string {
  for (const [id, e] of Object.entries(entities ?? {})) if (e.kind === kind) return e.id ?? id
  return `ent-${kind}`
}

/** 从飘字内容里解析伤害数值：取首个数字的绝对值，无数字则 0。 */
export function parseDamageFromContent(content: string): number {
  const m = content.match(/-?\d+(?:\.\d+)?/)
  return m ? Math.abs(Number(m[0])) || 0 : 0
}

/**
 * 「飘字联动结算」的结算副作用 = 挂在**节点 reactions** 上的一条 effect（不再是 settle 组件）。
 * 通过 effect.id = `${floatId}-settle` 把结算与对应飘字绑定，便于检视器定位/删改。
 */
function settleEffectId(floatId: string): string {
  return `${floatId}-settle`
}
function hpEffect(
  entities: Record<string, Entity> | undefined,
  target: 'boss' | 'player',
  amount: NumOrExpr,
  floatId: string,
): GraphEffect {
  return {
    kind: 'attr',
    entityId: firstEntityId(entities, target),
    attr: 'hp',
    op: 'add',
    // 常量沿用旧语义（数值取绝对值后自动按扣血取负）；选取式公式的正负号完全由用户在条款里选（−=扣血/+=回血）。
    value: typeof amount === 'number' ? -Math.abs(amount) : amount,
    id: settleEffectId(floatId),
  }
}
/** 飘字出现时机 → 结算 reaction 的相位（at:ms 优先，否则 enter）。 */
function floatSettleWhen(float: OverlayChild | undefined): Reaction['when'] {
  const t = float?.trigger
  if (t?.when === 'at') return { type: 'at', ms: t.ms }
  const start = float?.window?.startMs
  return typeof start === 'number' && start > 0 ? { type: 'at', ms: start } : { type: 'enter' }
}
/** 定位某飘字对应的结算 reaction（node.data.reactions 中含 effect.id=`${floatId}-settle` 的那条）。 */
export function settleElementFor(scenario: GameScenario, node: GameNode | undefined, floatId: string): Reaction | undefined {
  const eid = settleEffectId(floatId)
  return (node?.data.reactions ?? []).find((r) =>
    r.do.some((a) => a.kind === 'effect' && a.effects.some((e) => e.id === eid)),
  )
}
function settleHpEffect(settle: Reaction | undefined): { value?: NumOrExpr; entityId?: string } | undefined {
  for (const a of settle?.do ?? []) {
    if (a.kind !== 'effect') continue
    const hp = a.effects.find((e) => e.kind === 'attr' && e.attr === 'hp')
    if (hp) return hp as { value?: NumOrExpr; entityId?: string }
  }
  return undefined
}
/** 结算 reaction 的绝对伤害（公式态时取不到常量，返回 0）。 */
export function settleDamage(settle: Reaction | undefined): number {
  const hp = settleHpEffect(settle)
  return hp && typeof hp.value === 'number' ? Math.abs(hp.value) : 0
}
/** 结算 reaction 里 hp effect 的原始值（常量或 `{expr,pick}`），供检视器公式编辑器回填。 */
export function settleValue(settle: Reaction | undefined): NumOrExpr | undefined {
  return settleHpEffect(settle)?.value
}
/** 结算作用于 boss 还是 player。 */
export function settleTargetKind(
  settle: Reaction | undefined,
  entities: Record<string, Entity> | undefined,
): 'boss' | 'player' {
  const hp = settleHpEffect(settle)
  const ent = hp?.entityId ? entities?.[hp.entityId] : undefined
  return ent?.kind === 'player' ? 'player' : 'boss'
}
/** 飘字到点广播的 effects（settle reaction 里挂的完整效果列表；无结算则 []）。 */
export function overlayEffects(
  scenario: GameScenario,
  node: GameNode | undefined,
  floatId: string,
): GraphEffect[] {
  const settle = settleElementFor(scenario, node, floatId)
  for (const a of settle?.do ?? []) {
    if (a.kind === 'effect') return a.effects
  }
  return []
}
/** 预览用飘字 inputs：`expr` 缺省时回落结算效果第一条的值，与「所见即所广播」一致。 */
function floatPreviewParams(
  scenario: GameScenario,
  node: GameNode | undefined,
  el: OverlayChild,
  inputs: FloatTextParams,
): FloatTextParams {
  if (typeof inputs.expr === 'string' && inputs.expr.trim()) return inputs
  const first = overlayEffects(scenario, node, el.id).find((e) => e.kind === 'attr' || e.kind === 'var')
  const v = first && (first.kind === 'attr' || first.kind === 'var') ? first.value : undefined
  if (v === undefined) return inputs
  return { ...inputs, expr: typeof v === 'number' ? String(v) : v.expr }
}
/** 删除某飘字的结算 reaction。 */
function removeSettleReaction(scenario: GameScenario, node: GameNode, floatId: string): GameScenario {
  const eid = settleEffectId(floatId)
  const kept = (node.data.reactions ?? []).filter(
    (r) => !r.do.some((a) => a.kind === 'effect' && a.effects.some((e) => e.id === eid)),
  )
  return { ...scenario, graph: updateNodeData(scenario.graph, node.id, { reactions: kept.length ? kept : undefined }) }
}
/**
 * 写入/覆盖某飘字的结算 reaction，effects 为完整效果列表（对齐 `EffectsEditor` 的编辑单位）。
 * 空列表＝纯展示，等价删除。首条效果打上 `${floatId}-settle` 定位 id，供 `settleElementFor` 检索；
 * 其余保留用户自定义 id（缺省兜底生成，避免 undefined 冲突）。
 */
function upsertSettleEffects(
  scenario: GameScenario,
  node: GameNode,
  floatId: string,
  when: Reaction['when'],
  effects: GraphEffect[],
): GameScenario {
  if (effects.length === 0) return removeSettleReaction(scenario, node, floatId)
  const eid = settleEffectId(floatId)
  const kept = (node.data.reactions ?? []).filter(
    (r) => !r.do.some((a) => a.kind === 'effect' && a.effects.some((e) => e.id === eid)),
  )
  const tagged = effects.map((e, i) => (i === 0 ? { ...e, id: eid } : { ...e, id: e.id ?? `${eid}-${i + 1}` }))
  kept.push({ when, do: [{ kind: 'effect', effects: tagged }] })
  return { ...scenario, graph: updateNodeData(scenario.graph, node.id, { reactions: kept }) }
}

// ── 节点/元素定位 ─────────────────────────────────────────────────────────────
export function findNode(graph: GameScenario['graph'], nodeId: string | undefined): GameNode | undefined {
  if (!nodeId) return undefined
  return graph.nodes.find((n) => n.id === nodeId)
}
export function findElement(scenario: GameScenario, node: GameNode | undefined, elId: string): OverlayChild | undefined {
  // 扫全部挂载：HUD 方案常挂在内容挂载之外的第二份上。
  return mountedChildrenOf(scenario, node).find((e) => e.id === elId)
}
export function qteElementOfCue(scenario: GameScenario, node: GameNode | undefined, cueId: string): OverlayChild | undefined {
  return mountedChildrenOf(scenario, node).find((e) => hasCuePointsInput(e.component) && cuesOf(e).some((c) => c.id === cueId))
}
export function qteElement(scenario: GameScenario, node: GameNode | undefined): OverlayChild | undefined {
  return mountedChildrenOf(scenario, node).find((e) => hasCuePointsInput(e.component))
}

/** 编辑器预览：当前节点 QTE 用到可联调皮肤时，供 GraphVideoView 渲染真实交互皮。
 *  传入 `playheadMs` 时：播放头不落在任一 cue 窗内则返回 null（皮肤层整段卸掉，避免窗外残留）。 */
export function qteSkinPreviewInteraction(
  scenario: GameScenario,
  node: GameNode | undefined,
  playheadMs?: number,
): InteractionSnap | null {
  const el = qteElement(scenario, node)
  if (!el) return null
  const component = el.component
  if (!RICH_SKIN_COMPONENTS.has(component)) return null
  const inputs = paramsOf(el)
  const cues = cuesOf(el)
  if (!cues.length) return null
  if (playheadMs != null) {
    const inWindow = cues.some((c) => {
      const s = c.appearAt ?? 0
      const end = c.endAt ?? s + QTE_GOOD_WINDOW
      return playheadMs >= s && playheadMs <= end
    })
    if (!inWindow) return null
  }
  return {
    elementId: el.id,
    component,
    inputs: { ...inputs, component, cues },
    handles: qteOutcomeCandidates(el).map((c) => c.handle),
    timeoutMs: typeof inputs.timeoutMs === 'number' ? inputs.timeoutMs : undefined,
  }
}

export function choiceElement(scenario: GameScenario, node: GameNode | undefined): OverlayChild | undefined {
  return mountedChildrenOf(scenario, node).find((e) => hasOptionEventsInput(e.component))
}

/** 写回锁定 events，并清掉已不存在的出口边。 */
function writeChoiceParamsWithEdgeCleanup(
  scenario: GameScenario,
  node: GameNode,
  el: OverlayChild,
  nextParams: Record<string, unknown>,
): GameScenario {
  const keep = new Set(
    (Array.isArray(nextParams.events) ? (nextParams.events as ChoiceOption[]) : []).map((o) => o.id),
  )
  let s = patchOverlayChild(scenario, node.id, el.id, { inputs: nextParams })
  for (const edge of s.graph.edges) {
    if (edge.source !== node.id || edge.sourceHandle == null) continue
    if (edge.sourceHandle === 'default' || edge.sourceHandle === 'in') continue
    if (!keep.has(edge.sourceHandle)) s = { ...s, graph: disconnect(s.graph, edge.id) }
  }
  return s
}

/**
 * 编辑器预览：当前节点 choice 用到可联调皮肤时，供 GraphVideoView 渲染真实交互皮。
 * 传入 `playheadMs` 时按 `window` 门闸（窗外卸掉，避免残留默认清单叠层）。
 * 可能同时挂多份（方案里應默+技能条），全部返回。
 */
export function choiceSkinPreviewInteractions(
  scenario: GameScenario,
  node: GameNode | undefined,
  playheadMs?: number,
  maxMs = 60_000,
): InteractionSnap[] {
  if (!node) return []
  const out: InteractionSnap[] = []
  for (const el of mountedChildrenOf(scenario, node)) {
    if (!hasOptionEventsInput(el.component)) continue
    const component = el.component
    if (!RICH_SKIN_COMPONENTS.has(component)) continue
    if (playheadMs != null) {
      const start = el.window?.startMs ?? 0
      const end = el.window?.endMs ?? maxMs
      if (playheadMs < start || playheadMs > end) continue
    }
    const locked = applyStyleLockedEventParams(paramsOf(el), component)
    out.push({
      elementId: el.id,
      component,
      inputs: { ...locked, component },
      handles: (Array.isArray(locked.events) ? (locked.events as ChoiceOption[]) : []).map((o) => o.id),
      timeoutMs: typeof locked.timeoutMs === 'number' ? locked.timeoutMs : undefined,
    })
  }
  return out
}

/** 起点：window.startMs 优先；否则 trigger='at' 用 ms；其余（含缺省 trigger）落 0。 */
function timedStart(el: OverlayChild): number {
  if (el.window?.startMs != null) return el.window.startMs
  if (el.trigger?.when === 'at') return el.trigger.ms
  return 0
}

/**
 * 该元素是否来自某个真实方案挂载（`node.data.overlayNodes` 中非 `node:` 前缀的那份），
 * 而不是节点本地内容容器（`node:<nodeId>`）——「方案来源组件统一走通用编辑逻辑」的唯一判定入口。
 * 不看组件的 component/kind 是什么，只看它物理落在哪份挂载上（prototype 原型 / overrides / added
 * 皆算方案来源；只有节点本地容器里的才算「默认样式」来源）。
 */
export function isSchemeOriginElement(scenario: GameScenario, node: GameNode | undefined, elId: string): boolean {
  if (!node) return false
  const mount = findMountOwningChild(scenario, node, elId)
  return !!mount && !mount.overlay.startsWith('node:')
}

/**
 * 时间轴 / 检视器分类的唯一入口。方案来源的元素统一归为 `'component'`（走通用编辑 UI，
 * 不管它底层是 dialogue/qte/choice 还是自定义组件）；只有节点本地容器（「默认样式」来源）
 * 的元素才继续按字面 `component` 细分到字幕/飘字/QTE/选项/滤镜/特效六个专属分支
 * （默认样式的这六个位置落盘时 `component` 恒为对应字面值，无需别名折叠）。
 */
function materialKindForChild(scenario: GameScenario, node: GameNode | undefined, el: OverlayChild): MaterialKind {
  if (isSchemeOriginElement(scenario, node, el.id)) return 'component'
  if (el.component === 'dialogue') return 'subtitle'
  if (el.component === 'floatText') return 'overlay'
  if (hasOptionEventsInput(el.component)) return 'option'
  if (hasCuePointsInput(el.component)) return 'qte'
  if (el.component === 'filter') return 'filter'
  if (el.component === 'fx') return 'fx'
  return 'component'
}

/** `kind` 由调用方传入（已由 `materialKindForChild` 算好），避免这里重复一遍 isKind 判断。 */
function componentLabelOf(el: OverlayChild, kind: MaterialKind): string {
  const id = el.component
  const params = paramsOf(el)
  if (kind === 'subtitle') return str(params.text) || '字幕'
  if (kind === 'overlay') return (str(params.text) ?? '').trim() || '飘字'
  if (kind === 'option') return componentTypeLabel(id) || '选项'
  if (kind === 'filter') return filterLabel(params.filter)
  if (kind === 'fx') return fxLabel(params.fx)
  // 通用组件（含方案来源）：实例 params.label（如「我方」）→ 类型展示名（manifest.label）→ component id
  return str(params.label) || componentTypeLabel(id)
}

// ── 读投影：node → MaterialItem[] ─────────────────────────────────────────────
export function collectMaterialsFromNode(scenario: GameScenario, node: GameNode | undefined, maxMs: number): MaterialItem[] {
  if (!node) return []
  // 全部挂载的「↺ 回连方案」徽章（HUD 等第二份挂载也要能标）——只标真正的 overrides；
  // added 是纯新增实例，没有原型可回连，resetMaterialOverrideGraph 对它是 no-op，不该显示这个按钮。
  const flagged = new Set<string>()
  for (const mount of node.data.overlayNodes ?? []) {
    const { overridden } = overriddenChildIds(mount)
    for (const id of overridden) flagged.add(id)
  }
  const out: MaterialItem[] = []
  for (const el of mountedChildrenOf(scenario, node)) {
    const overriddenFlag = flagged.has(el.id) || undefined
    const componentId = el.component
    const kind = materialKindForChild(scenario, node, el)
    if (kind === 'qte') {
      for (const c of cuesOf(el)) {
        // 左缘=出现(appearAt) 右缘=消失(endAt) 菱形=命中判定(targetAt，计分锚点)。
        const s = c.appearAt ?? 0
        const target = c.targetAt ?? s
        const end = c.endAt ?? Math.max(target + 300, s + (c.durationMs ?? 500))
        out.push({
          key: `qte:${el.id}:${c.id}`,
          id: c.id,
          kind: 'qte',
          componentId,
          label: c.label || 'QTE',
          startMs: s,
          endMs: end,
          markerMs: Math.min(Math.max(target, s), end),
          zIndex: normalizeLayer(c.zIndex, 2),
          overridden: overriddenFlag,
        })
      }
      continue
    }
    const start = kind === 'subtitle' || kind === 'overlay'
      ? timedStart(el)
      : (el.window?.startMs ?? timedStart(el))
    const defaultEnd = kind === 'subtitle' ? start + 2000 : kind === 'overlay' ? start + 1200 : maxMs
    out.push({
      key: `${kind}:${el.id}`,
      id: el.id,
      kind,
      componentId,
      label: componentLabelOf(el, kind),
      startMs: start,
      endMs: el.window?.endMs ?? Math.min(maxMs, defaultEnd),
      zIndex: normalizeLayer(el.layout?.zIndex, kind === 'component' ? 3 : kind === 'filter' ? 4 : kind === 'fx' ? 5 : kind === 'option' ? 3 : kind === 'overlay' ? 1 : 0),
      overridden: overriddenFlag,
    })
  }
  return out
}

/** 素材属性「↺ 回连方案」：清掉该素材所属组件在挂载上的差量，改回跟随共享方案。 */
export function resetMaterialOverrideGraph(scenario: GameScenario, node: GameNode, item: MaterialItem): GameScenario {
  const elId = item.kind === 'qte' ? qteElementOfCue(scenario, node, item.id)?.id : item.id
  if (!elId) return scenario
  return resetOverride(scenario, node.id, elId)
}

// ── 读投影：预览叠层 ──────────────────────────────────────────────────────────
export function activePreviewOverlaysFromNode(
  scenario: GameScenario,
  node: GameNode | undefined,
  ms: number,
  maxMs: number,
): PreviewOverlay[] {
  if (!node) return []
  const out: PreviewOverlay[] = []
  const { ctx: previewCtx, state: previewState } = previewCtxFor(scenario)
  let qteOutcomeDetail: string | undefined
  for (const el of mountedChildrenOf(scenario, node)) {
    const inputs = paramsOf(el)
    // 与 collectMaterialsFromNode 用同一分类入口：方案来源元素统一走末尾的通用手柄分支，
    // 保证 materialKey（`${kind}:${el.id}`）与时间轴条目一致，选中态才能对上。
    const kind = materialKindForChild(scenario, node, el)
    if (kind === 'subtitle') {
      const start = timedStart(el)
      const end = el.window?.endMs ?? Math.min(maxMs, start + 2000)
      if (ms < start || ms > end) continue
      const speaker = str(inputs.speaker)
      const text = str(inputs.text) ?? ''
      out.push({
        id: `subtitle:${el.id}`,
        materialKey: `subtitle:${el.id}`,
        kind: 'subtitle',
        label: speaker ? `${speaker}：${text}` : text,
        x: (inputs.x as number) ?? SUBTITLE_XY.x,
        y: (inputs.y as number) ?? SUBTITLE_XY.y,
        zIndex: normalizeLayer(el.layout?.zIndex, 0),
        movable: true,
        style: inputs.style as GraphTextStyle | undefined,
        target: { kind: 'element', elementId: el.id },
      })
    } else if (kind === 'overlay') {
      const start = timedStart(el)
      const end = el.window?.endMs ?? Math.min(maxMs, start + 1200)
      if (ms < start || ms > end) continue
      const label = resolveFloatTextPreviewLabel(floatPreviewParams(scenario, node, el, inputs as FloatTextParams), previewCtx)
      if (!label) continue
      out.push({
        id: `overlay:${el.id}`,
        materialKey: `overlay:${el.id}`,
        kind: 'overlay',
        label,
        x: (inputs.x as number) ?? OVERLAY_XY.x,
        y: (inputs.y as number) ?? OVERLAY_XY.y,
        zIndex: normalizeLayer(el.layout?.zIndex, 1),
        movable: true,
        style: inputs.style as GraphTextStyle | undefined,
        target: { kind: 'element', elementId: el.id },
      })
    } else if (kind === 'qte') {
      if (qteOutcomeDetail === undefined) {
        qteOutcomeDetail = resolveQteOutcomesPreviewDetail(listQteOutcomes(scenario, node), previewState, previewCtx)
      }
      for (const c of cuesOf(el)) {
        const s = c.appearAt ?? 0
        const end = c.endAt ?? s + QTE_GOOD_WINDOW
        if (ms < s || ms > end) continue
        out.push({
          id: `qte:${c.id}`,
          materialKey: `qte:${el.id}:${c.id}`,
          kind: 'qte',
          label: resolveQteCuePreviewLabel(c),
          detail: qteOutcomeDetail || undefined,
          x: c.x ?? 0.5,
          y: c.y ?? 0.55,
          zIndex: normalizeLayer(c.zIndex, 2),
          movable: true,
          target: { kind: 'qteCue', elementId: el.id, cueId: c.id },
        })
      }
    } else if (kind === 'option') {
      const start = el.window?.startMs ?? 0
      const end = el.window?.endMs ?? maxMs
      if (ms < start || ms > end) continue
      out.push({
        id: `option:list:${el.id}`,
        materialKey: `option:${el.id}`,
        kind: 'option',
        label: '请选择',
        detail: resolveChoicePreviewDetail(
          optionsOf(el).map((o) => ({ label: o.label ?? o.id, effects: readMountEventEffects(scenario, node, el.id, o.id), condition: o.condition })),
          previewCtx,
          previewState,
        ) || undefined,
        x: typeof inputs.x === 'number' ? inputs.x : OPTION_XY.x,
        y: typeof inputs.y === 'number' ? inputs.y : OPTION_XY.y,
        zIndex: normalizeLayer(el.layout?.zIndex, 3),
        movable: true,
        target: { kind: 'element', elementId: el.id },
      })
    } else if (kind === 'filter' || kind === 'fx') {
      // 滤镜/特效走 videoFx 旁路，不进可拖叠层
      continue
    } else {
      // 通用组件手柄（含方案来源的字幕/QTE/选项等）：整组上预览手柄，可拖 params.x/y——
      // 但能不能拖由组件自己的 inputs 是否声明了 x/y 决定（见 isPositionable），这里不按 kind/surface 硬编码枚举，
      // 免得每来一个新组件（如以后的 hud2/hud3）都要回来改一遍这条分支。
      const start = el.window?.startMs ?? timedStart(el)
      const end = el.window?.endMs ?? maxMs
      if (ms < start || ms > end) continue
      out.push({
        id: `component:${el.id}`,
        materialKey: `component:${el.id}`,
        kind: 'component',
        label: componentLabelOf(el, kind),
        x: typeof inputs.x === 'number' ? inputs.x : 0.5,
        y: typeof inputs.y === 'number' ? inputs.y : 0.5,
        zIndex: normalizeLayer(el.layout?.zIndex, 3),
        movable: isPositionable(el.component),
        target: { kind: 'element', elementId: el.id },
      })
    }
  }
  return out.sort((a, b) => a.zIndex - b.zIndex)
}

/**
 * 当前播放头落在 window 内、应画到预览皮肤层的挂载 children（不含 filter/fx）。
 * 含未分类组件；与 `activePreviewOverlaysFromNode` 手柄配套。
 */
export function previewSkinChildrenInWindow(
  scenario: GameScenario,
  node: GameNode | undefined,
  ms: number,
  maxMs: number,
): OverlayChild[] {
  if (!node) return []
  const out: OverlayChild[] = []
  // 与运行时一致：扫全部挂载（内容轨 + 常驻 HUD 方案），不能只看 primary。
  for (const el of mountedChildrenOf(scenario, node)) {
    if (el.component === 'filter' || el.component === 'fx') continue
    const cues = hasCuePointsInput(el.component) ? cuesOf(el) : null
    if (cues && cues.length > 0) {
      const inCue = cues.some((c) => {
        const s = c.appearAt ?? 0
        const end = c.endAt ?? s + QTE_GOOD_WINDOW
        return ms >= s && ms <= end
      })
      if (inCue) out.push(el)
      continue
    }
    // 拍点型组件还没落任何拍点（刚挂载/克隆到时间轴、尚未点出第一个按键点）：
    // 兜底按通用 window 全程可见，而不是直接判定"不在任一拍点窗内"就永远隐藏——
    // 否则挂完方案却啥也看不到，会被误当成渲染坏了（真实原因只是还没打拍点）。
    const start = el.window?.startMs ?? timedStart(el)
    const end = el.window?.endMs ?? maxMs
    if (ms < start || ms > end) continue
    out.push(el)
  }
  return out
}

// ── 写映射：时间轴拖拽（start/end/zIndex）──────────────────────────────────────
export function patchMaterialGraph(
  scenario: GameScenario,
  node: GameNode,
  maxMs: number,
  item: MaterialItem,
  patch: { startMs?: number; endMs?: number; zIndex?: number; markerMs?: number },
): GameScenario {
  const start = clampMs(patch.startMs ?? item.startMs, 0, Math.max(0, maxMs - 100))
  const end = clampMs(patch.endMs ?? item.endMs, start + 100, maxMs)
  const zIndex = patch.zIndex == null ? item.zIndex : clampLayer(patch.zIndex)
  switch (item.kind) {
    case 'subtitle':
    case 'overlay':
    case 'filter':
    case 'fx':
    case 'component':
      return patchOverlayChild(scenario, node.id, item.id, {
        window: { startMs: start, endMs: end },
        trigger: { when: 'at', ms: start },
        layout: { zIndex },
      })
    case 'option':
      return patchOverlayChild(scenario, node.id, item.id, {
        window: { startMs: start, endMs: end },
        layout: { zIndex },
      })
    case 'qte': {
      const el = qteElementOfCue(scenario, node, item.id)
      if (!el) return scenario
      const isMove = patch.zIndex != null && patch.startMs != null && patch.endMs != null
      const cues = cuesOf(el).map((c) => {
        if (c.id !== item.id) return c
        const next: QteCue = { ...c }
        if (patch.markerMs != null) {
          // 拖菱形：只改命中判定点，夹在 [出现, 消失] 内。
          const lo = c.appearAt ?? 0
          const hi = c.endAt ?? Math.max(lo, c.targetAt ?? lo)
          next.targetAt = clampMs(patch.markerMs, lo, Math.max(lo, hi))
          return next
        }
        if (isMove) {
          // 整体平移：出现/命中/消失同步移，保持相对间距。
          const shift = start - (c.appearAt ?? 0)
          next.appearAt = start
          next.endAt = end
          if (c.targetAt != null) next.targetAt = clampMs(c.targetAt + shift, start, end)
          next.zIndex = zIndex
          return next
        }
        // 拖边缘：左缘→出现(appearAt)，右缘→消失(endAt)；命中点夹回窗内。
        next.appearAt = start
        next.endAt = end
        if (c.targetAt != null) next.targetAt = clampMs(c.targetAt, start, end)
        next.zIndex = zIndex
        return next
      })
      // battleParry 检视器以 windowMs 为时长 SSOT；拖缘时同步，避免检视器/皮肤与时间轴脱节。
      const skin = el.component
      const nextParams: Record<string, unknown> = { ...(el.inputs ?? {}), cues }
      if (skin === 'battleParry' && patch.markerMs == null) {
        nextParams.windowMs = Math.max(200, end - start)
      }
      return patchOverlayChild(scenario, node.id, el.id, { inputs: nextParams })
    }
    default:
      return scenario
  }
}

// ── 写映射：预览拖拽定位（x/y）─────────────────────────────────────────────────
export function patchOverlayPositionGraph(
  scenario: GameScenario,
  node: GameNode,
  target: PreviewTarget,
  x: number,
  y: number,
): GameScenario {
  if (target.kind === 'element') {
    const el = findElement(scenario, node, target.elementId)
    if (!el) return scenario
    return patchOverlayChild(scenario, node.id, el.id, { inputs: { ...el.inputs, x, y } })
  }
  if (target.kind === 'qteCue') {
    const el = findElement(scenario, node, target.elementId)
    if (!el) return scenario
    const cues = cuesOf(el).map((c) => (c.id === target.cueId ? { ...c, x, y } : c))
    return patchOverlayChild(scenario, node.id, el.id, { inputs: { ...el.inputs, cues } })
  }
  return scenario
}

// ── 写映射：删除 + 二次确认 ────────────────────────────────────────────────────
function isWholeInteractionDelete(scenario: GameScenario, node: GameNode, item: MaterialItem): boolean {
  if (item.kind === 'option') return true
  if (item.kind === 'qte') return cuesOf(qteElementOfCue(scenario, node, item.id)).length <= 1
  return false
}
export function confirmMaterialDelete(scenario: GameScenario, node: GameNode, item: MaterialItem): boolean {
  if (!isWholeInteractionDelete(scenario, node, item)) return true
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true
  const message =
    item.kind === 'option'
      ? '删除整条选项交互？\n该节点将改回叙事节点，并自动续连到「第一个选项」原本指向的场景。\n这会同步更改蓝图上的节点连接关系，是否确认？'
      : '删除整段 QTE 交互？\n该节点将改回叙事节点，并自动续连到「通过 QTE」原本指向的场景。\n这会同步更改蓝图上的节点连接关系，是否确认？'
  return window.confirm(message)
}
export function deleteMaterialGraph(scenario: GameScenario, node: GameNode, item: MaterialItem): GameScenario {
  switch (item.kind) {
    case 'subtitle':
    case 'filter':
    case 'fx':
    case 'component':
      return removeOverlayChild(scenario, node.id, item.id)
    case 'overlay': {
      const s1 = removeOverlayChild(scenario, node.id, item.id)
      const s1Node = findNode(s1.graph, node.id) ?? node
      return removeSettleReaction(s1, s1Node, item.id)
    }
    case 'qte':
      return removeQteCueGraph(scenario, node, item.id)
    case 'option': {
      const el = choiceElement(scenario, node)
      return teardownInteractionScenario(scenario, node, { kind: 'choice', handlePrefixes: el ? optionsOf(el).map((o) => o.id) : [], childId: el?.id })
    }
    default:
      return scenario
  }
}

/**
 * 本节点「默认样式方案」（`node.data.styleScheme`）里，与 `component` 精确同名的 child 全集。
 * 方案本身不挂载、不进 `overlayNodes`——纯查表源；新增素材取 [0] 当默认，其余供检视器切换。
 * 只服务字幕/飘字/滤镜/特效（这几个位置的默认样式允许多套预设切换）；QTE/选项的默认样式
 * 已锁定固定组件，不走这里。
 */
export function styleVariantsFor(scenario: GameScenario, node: GameNode, component: string): OverlayChild[] {
  const schemeId = node.data.styleScheme
  if (!schemeId) return []
  return scenario.ui?.overlays?.[schemeId]?.children.filter((c) => c.component === component) ?? []
}

// ── 写映射：新增材料 ──────────────────────────────────────────────────────────
/** 默认六槽 template；其它值为原始 component id（添加未分类组件）。 */
export type MaterialTemplate = 'subtitle' | 'overlay' | 'qte' | 'option' | 'filter' | 'fx' | string

const BUILTIN_TEMPLATES = new Set(['subtitle', 'overlay', 'qte', 'option', 'filter', 'fx'])

export function isBuiltinMaterialTemplate(t: string): boolean {
  return BUILTIN_TEMPLATES.has(t)
}

/**
 * 「添加控件」二级栏卡片：某个方案挂载目录里的一个**原型 OverlayChild**（对齐 `spawn.from = mountId/childId`）。
 * 同 `component` 类型可有多份（如两份 battleHpBar：我方/敌方，各有自己的 params.bind）。
 * 不按 kind 过滤——字幕/QTE/选项等基础 kind 若来自方案，也照样列出（拖入后统一走通用编辑逻辑）。
 */
export interface ExtraAddableComponent {
  /** = `mountId/childId`（添加时作 template，克隆该实例的 params）。 */
  id: string
  /** 卡片标题：实例 params.label → 类型名 · childId → childId。 */
  label: string
  /** 注册表 component id（图标/描述用）。 */
  componentId: string
}

/** 「添加控件」一级分类里，一个已挂载方案对应的一个 tab。 */
export interface SchemeMountTab {
  /** 挂载键（`overlayMountId(mount)`），tab 选中态 key，也是落盘目标挂载。 */
  mountId: string
  /** tab 标题：overlay.title → mountId。 */
  title: string
  components: ExtraAddableComponent[]
}

/**
 * 每个已挂载的真实方案（排除 `node:*` 本地内容容器）对应一个 tab，tab 下是该方案**目录原型**
 * 里的全部组件——
 * 刻意排除：
 * - `node:*` 本地内容容器（时间轴直写产物，不是可复用界面方案）
 * - `mount.added`（本节点已克隆新增的实例——再列进库面板会导致「添加一次多一张卡」）
 * 只枚举目录原型；overrides 改字段仍可借 resolveSchemeChildTemplate 取合并结果，但不把 added 当模板。
 */
export function listSchemeMountTabs(scenario: GameScenario, node: GameNode | undefined): SchemeMountTab[] {
  if (!node) return []
  const out: SchemeMountTab[] = []
  const seenMount = new Set<string>()
  for (const mount of node.data.overlayNodes ?? []) {
    if (mount.overlay.startsWith('node:')) continue
    const mountId = overlayMountId(mount)
    if (seenMount.has(mountId)) continue
    seenMount.add(mountId)
    const overlay = scenario.ui?.overlays?.[mount.overlay]
    const title = overlay?.title?.trim() || mountId
    const components: ExtraAddableComponent[] = []
    for (const el of overlay?.children ?? []) {
      const componentId = el.component
      if (!componentId) continue
      const params = paramsOf(el)
      const instanceLabel = str(params.label)
      components.push({
        id: `${mountId}/${el.id}`,
        label: instanceLabel || `${componentTypeLabel(componentId)} · ${el.id}`,
        componentId,
      })
    }
    out.push({ mountId, title, components: components.sort((a, b) => a.label.localeCompare(b.label, 'zh')) })
  }
  return out
}

/** 解析 `overlayId/childId`：优先当前挂载的合并结果（含 overrides），再回退目录原型。 */
export function resolveSchemeChildTemplate(
  scenario: GameScenario,
  node: GameNode | undefined,
  from: string,
): OverlayChild | undefined {
  const slash = from.indexOf('/')
  if (slash <= 0 || slash >= from.length - 1) return undefined
  const head = from.slice(0, slash)
  const childId = from.slice(slash + 1)
  if (node) {
    for (const mount of node.data.overlayNodes ?? []) {
      if (mount.overlay !== head && overlayMountId(mount) !== head) continue
      const hit = resolveMountChildren(scenario.ui?.overlays, mount).find((c) => c.id === childId)
      if (hit) return hit
    }
  }
  return scenario.ui?.overlays?.[head]?.children.find((c) => c.id === childId)
}

function isSchemeTemplateRef(template: string): boolean {
  return template.includes('/')
}

export interface AddResult {
  scenario: GameScenario
  selectKey: string | null
}

/** 从素材库拖入时间轴的落点：ms = 落点时刻，zIndex = 落点所在轨。 */
export interface DropAt {
  ms: number
  zIndex: number
}

export function addMaterialGraph(
  scenario: GameScenario,
  node: GameNode,
  maxMs: number,
  template: MaterialTemplate,
  entities: Record<string, Entity> | undefined,
  playheadMs: number,
  at?: DropAt,
): AddResult {
  const dur = clampMs(2500, 100, maxMs)
  // at 存在 = 从素材库拖入的精确落点；缺省（点击添加）落在 0ms / 语义默认轨。
  const startMs = at ? clampMs(at.ms, 0, Math.max(0, maxMs - 100)) : 0
  const endMs = clampMs(startMs + dur, startMs + 100, maxMs)
  if (template === 'subtitle') {
    const id = newElementId()
    const style = styleVariantsFor(scenario, node, 'dialogue')[0]?.inputs
    const el: OverlayChild = {
      id,
      component: 'dialogue',
      trigger: { when: 'enter' },
      window: { startMs, endMs },
      layout: { zIndex: at ? at.zIndex : 0 },
      inputs: { text: '新字幕', ...style },
    }
    return { scenario: addOverlayChild(scenario, node.id, el), selectKey: `subtitle:${id}` }
  }
  if (template === 'overlay') {
    const id = newElementId()
    const style = styleVariantsFor(scenario, node, 'floatText')[0]?.inputs
    const float: OverlayChild = {
      id,
      component: 'floatText',
      trigger: { when: 'enter' },
      window: { startMs, endMs },
      layout: { zIndex: at ? at.zIndex : 1 },
      inputs: { text: '-100', x: OVERLAY_XY.x, y: 0.45, ...style },
    }
    const s1 = addOverlayChild(scenario, node.id, float)
    const s1Node = findNode(s1.graph, node.id) ?? node
    // 结算副作用挂节点 reaction（默认对 boss 扣 100，与飘字同相位出现）。
    const s2 = upsertSettleEffects(s1, s1Node, id, floatSettleWhen(float), [hpEffect(entities, 'boss', 100, id)])
    return { scenario: s2, selectKey: `overlay:${id}` }
  }
  if (template === 'filter' || template === 'fx') {
    const id = newElementId()
    const style = styleVariantsFor(scenario, node, template)[0]?.inputs
    const el: OverlayChild = {
      id,
      component: template,
      trigger: { when: 'at', ms: startMs },
      window: { startMs, endMs },
      layout: { zIndex: at ? at.zIndex : template === 'filter' ? 4 : 5 },
      inputs: { ...(template === 'filter' ? { filter: 'warm', intensity: 1 } : { fx: 'flash', intensity: 1 }), ...style },
    }
    return { scenario: addOverlayChild(scenario, node.id, el), selectKey: `${template}:${id}` }
  }
  if (template === 'qte') {
    return addQteCueGraph(scenario, node, maxMs, at ? at.ms : playheadMs)
  }
  if (template === 'option') {
    const existing = choiceElement(scenario, node)
    if (existing) return { scenario, selectKey: `option:${existing.id}` }
    const existingQte = qteElement(scenario, node)
    const s0 = teardownInteractionScenario(scenario, node, {
      kind: 'qte',
      handlePrefixes: qteOutcomeCandidates(existingQte).map((c) => c.handle),
    })
    const id = newElementId()
    const optStart = at ? startMs : 0
    const optEnd = at ? endMs : dur
    // 默认样式的选项固定为无皮肤清单（可自由增删选项）——不再有多皮肤可选。
    const el: OverlayChild = {
      id,
      component: 'choice',
      trigger: { when: 'enter' },
      window: { startMs: optStart, endMs: optEnd },
      layout: { zIndex: at ? at.zIndex : 3 },
      inputs: { presentation: 'list', x: OPTION_XY.x, y: OPTION_XY.y, events: [{ id: 'opt0', label: '选项一' }] },
    }
    const s = addOverlayChild(s0, node.id, el)
    return { scenario: s, selectKey: `option:${id}` }
  }
  // 未分类：优先 `overlayId/childId` 克隆挂载实例（保留 bind/label 等输入）；否则按 component id 用 defaults。
  const fromChild = isSchemeTemplateRef(template)
    ? resolveSchemeChildTemplate(scenario, node, template)
    : undefined
  const componentId = fromChild ? fromChild.component : template
  const plugin = getComponent(componentId)
  if (!plugin && !fromChild) return { scenario, selectKey: null }
  const id = newElementId()
  const defaults = defaultsForComponent(componentId) as Record<string, unknown>
  // 克隆自方案实例时也要垫 defaults：方案目录里的组件可能是老数据（未经当前 preset 补全 inputs），
  // 直接搬 fromChild.inputs 会把这份缺省原样克隆出去，每次"重新拖入"都还是同一份残缺 inputs。
  // 叩击/防反/應默/技能条这类样式锁定皮肤还要过一遍 applyStyleLocked*Params——
  // 通用 defaultsForComponent 只给得出无皮肤特征的泛用兜底（如"选项一"），
  // 这两个函数才知道该皮肤自己的出口文案（應/默、斩/突/守…），克隆出来才跟方案目录里长得一样。
  const seeded = fromChild
    ? applyStyleLockedEventParams({ ...defaults, ...(fromChild.inputs ?? {}) }, componentId)
    : { x: 0.5, y: 0.5, ...defaults }
  const el: OverlayChild = {
    id,
    component: componentId,
    trigger: { when: 'at', ms: startMs },
    window: { startMs, endMs },
    layout: { zIndex: at ? at.zIndex : (fromChild?.layout?.zIndex ?? 3) },
    inputs: seeded,
  }
  // 方案克隆（template = `mountId/childId`）：落进「那个方案」自己的挂载 added[]，
  // 不能落进节点本地容器——否则 isSchemeOriginElement 会误判成默认样式来源。
  if (fromChild) {
    const mountId = template.slice(0, template.indexOf('/'))
    return { scenario: addOverlayChildToMount(scenario, node.id, mountId, el), selectKey: `component:${id}` }
  }
  return { scenario: addOverlayChild(scenario, node.id, el), selectKey: `component:${id}` }
}

/**
 * 新增一个 QTE 按键点（无 qte 元素则新建整段 QTE，并清掉 choice）。
 * 默认样式的 QTE 皮肤固定为「叩击」（inkKou，单点提示环）——不再有多皮肤可选，
 * 拍点节奏/出口自然只有一套（inkKou 的 pass/fail），无需按皮肤分支。
 */
export function addQteCueGraph(
  scenario: GameScenario,
  node: GameNode,
  maxMs: number,
  playheadMs: number,
  afterCueId?: string,
): AddResult {
  const el = qteElement(scenario, node)
  const cues = cuesOf(el)
  const base = afterCueId ? cues.find((c) => c.id === afterCueId) : cues[cues.length - 1]
  const appear = clampMs(
    cues.length ? (base?.targetAt ?? playheadMs) + 500 : playheadMs,
    0,
    Math.max(0, maxMs - 200),
  )
  const target = clampMs(appear + 300, appear + 100, Math.max(appear + 100, maxMs - 100))
  const end = clampMs(target + 400, target + 100, maxMs)
  const cueId = `q-${Date.now().toString(36)}`
  const cue: QteCue = {
    id: cueId,
    shape: base?.shape ?? 'tap',
    triggerKey: base?.triggerKey,
    x: base?.x ?? 0.5,
    y: base?.y ?? 0.55,
    appearAt: appear,
    targetAt: target,
    endAt: end,
    label: `QTE ${cues.length + 1}`,
    zIndex: base?.zIndex ?? 2,
  }
  if (el) {
    const nextParams: Record<string, unknown> = { ...(el.inputs ?? {}), cues: [...cues, cue] }
    const s = patchOverlayChild(scenario, node.id, el.id, { inputs: nextParams })
    return { scenario: s, selectKey: `qte:${el.id}:${cueId}` }
  }
  // 首次建 QTE：清掉 choice（互斥），新建固定 inkKou 皮肤的 qte 元素。
  const choice = choiceElement(scenario, node)
  const s0 = teardownInteractionScenario(scenario, node, { kind: 'choice', handlePrefixes: choice ? optionsOf(choice).map((o) => o.id) : [], childId: choice?.id })
  const id = newElementId()
  const seeded = applyStyleLockedEventParams({ qteKind: 'parry', passingHits: 1, cues: [cue] }, 'inkKou')
  const newEl: OverlayChild = {
    id,
    component: 'inkKou',
    trigger: { when: 'enter' },
    inputs: seeded,
  }
  let s = addOverlayChild(s0, node.id, newEl)
  const n = findNode(s.graph, node.id) ?? node
  s = ensureQtePassOutcomeGraph(s, n)
  return { scenario: s, selectKey: `qte:${id}:${cueId}` }
}

/** 删一个 QTE 按键点（删到最后一个 = 拆整段 QTE；结算是整段共享的，删单个拍点不动结算）。 */
export function removeQteCueGraph(scenario: GameScenario, node: GameNode, cueId: string): GameScenario {
  const el = qteElementOfCue(scenario, node, cueId)
  if (!el) return scenario
  const cues = cuesOf(el)
  if (cues.length <= 1) {
    return teardownInteractionScenario(scenario, node, {
      kind: 'qte',
      handlePrefixes: qteOutcomeCandidates(el).map((c) => c.handle),
      continueHandle: qteOutcomeCandidates(el)[0]?.handle ?? 'pass',
      childId: el.id,
    })
  }
  const remaining = cues.filter((c) => c.id !== cueId)
  return patchOverlayChild(scenario, node.id, el.id, { inputs: { ...el.inputs, cues: remaining } })
}

// ── 写映射：检视器 inputs 编辑 ────────────────────────────────────────────────
/**
 * 合并出下一份完整 inputs 快照。`v === undefined` 的键**保留但置为 undefined**（不 delete）——
 * 下游 `patchOverlayChild` → `mergeChild`/`mergePatch` 对 inputs 是「浅 spread」式累积合并
 * （`{ ...base.inputs, ...patch.inputs }`），若这里直接删键，缺席的键不会覆盖 base/override 里
 * 的旧值，「清空」就会被历史值悄悄复活。显式置 undefined 才能穿透层层浅合并真正生效清空；
 * 落盘走 JSON 时 undefined 键本就会被丢弹，不会遗留脏数据。
 */
function mergeParams(el: OverlayChild, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...el.inputs, ...patch }
}

/** 字幕/QTE-cue/选项的通用 inputs 编辑（飘字见 patchOverlayGraph）。 */
export function patchSelectedGraph(
  scenario: GameScenario,
  node: GameNode,
  item: MaterialItem,
  patch: Record<string, unknown>,
): GameScenario {
  if (item.kind === 'subtitle' || item.kind === 'filter' || item.kind === 'fx') {
    const el = findElement(scenario, node, item.id)
    if (!el) return scenario
    return patchOverlayChild(scenario, node.id, el.id, { inputs: mergeParams(el, patch) })
  }
  if (item.kind === 'qte') {
    const el = qteElementOfCue(scenario, node, item.id)
    if (!el) return scenario
    // 元素级 QTE 参数（如完美半窗 perfectMs）落 el.inputs；其余按 cue 级 patch 进当前拍点。
    const elemPatch: Record<string, unknown> = {}
    const cuePatch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (QTE_ELEMENT_PARAM_KEYS.has(k)) elemPatch[k] = v
      else cuePatch[k] = v
    }
    const cues = cuesOf(el).map((c) => (c.id === item.id ? { ...c, ...cuePatch } : c))
    // 样式锁出口：写入时强制用皮肤 defaults.exits，丢掉实例上的脏出口
    const nextParams = applyStyleLockedEventParams({ ...(el.inputs ?? {}), ...elemPatch, cues }, el.component)
    return patchOverlayChild(scenario, node.id, el.id, { inputs: nextParams })
  }
  if (item.kind === 'option') {
    const el = findElement(scenario, node, item.id)
    if (!el) return scenario
    const next = mergeParams(el, patch)
    return patchOverlayChild(scenario, node.id, el.id, { inputs: applyStyleLockedEventParams(next, el.component) })
  }
  if (item.kind === 'component') {
    const el = findElement(scenario, node, item.id)
    if (!el) return scenario
    return patchOverlayChild(scenario, node.id, el.id, { inputs: mergeParams(el, patch) })
  }
  return scenario
}

/**
 * 飘字（floatText 展示 + 联动结算 reaction）的 inputs 编辑。键：
 *   - content  → inputs.text（显示文案，含 {v} 用数值替换）
 *   - effects  → 结算 reaction 的完整效果列表（`EffectsEditor` 直接产出；空数组＝纯展示，删结算）
 *   - 其余（expr/valuePick/style/x/y…）→ 直接并入 inputs（undefined 删键）
 * expr 缺省时 {v} 取 effects 第一条的值（预览侧对齐，见 `activePreviewOverlaysFromNode`）；
 * 写了 expr 则显示与效果解耦。
 */
export function patchOverlayGraph(
  scenario: GameScenario,
  node: GameNode,
  floatId: string,
  patch: Record<string, unknown>,
  entities: Record<string, Entity> | undefined,
): GameScenario {
  const float = findElement(scenario, node, floatId)
  if (!float) return scenario
  let s = scenario
  const curNode = () => findNode(s.graph, node.id) ?? node

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'content') {
      const content = String(value)
      const cur = findElement(s, node, floatId)
      s = patchOverlayChild(s, node.id, floatId, { inputs: { ...cur?.inputs, text: content } })
    } else if (key === 'effects') {
      const list = Array.isArray(value) ? (value as GraphEffect[]) : []
      s = upsertSettleEffects(s, curNode(), floatId, floatSettleWhen(float), list)
    } else {
      const cur = findElement(s, node, floatId)
      if (cur) s = patchOverlayChild(s, node.id, floatId, { inputs: mergeParams(cur, { [key]: value }) })
    }
  }
  return s
}

// ── 写映射：选项分支（= 出边 <id> + mount event reaction effects，与 QTE 同内核）─────
/** 向后兼容命名（选项分支专用别名，结构与 OutcomeView 相同）。 */
export type OptionBranchView = OutcomeView
export function listOptionBranches(scenario: GameScenario, node: GameNode): OutcomeView[] {
  const el = choiceElement(scenario, node)
  if (!el) return []
  const locked = applyStyleLockedEventParams(paramsOf(el), el.component)
  const events = Array.isArray(locked.events) ? (locked.events as ChoiceOption[]) : optionsOf(el)
  const candidates: OutcomeCandidate[] = events.map((o) => ({ handle: o.id, label: o.label ?? o.id }))
  return candidates.map((c) => outcomeView(scenario, node, el.id, c.handle, c.label, candidates))
}

/** 打开检视器时把脏 events 写回样式锁定值（与 listOptionBranches / 预览对齐）。 */
export function syncChoiceStyleLockedOptionsGraph(scenario: GameScenario, node: GameNode): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el || !componentEventsLocked(el.component)) return scenario
  const locked = applyStyleLockedEventParams(paramsOf(el), el.component)
  if (JSON.stringify(locked.events) === JSON.stringify(paramsOf(el).events)) return scenario
  return writeChoiceParamsWithEdgeCleanup(scenario, node, el, locked)
}

export function addOptionBranchGraph(scenario: GameScenario, node: GameNode): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el || componentEventsLocked(el.component)) return scenario
  const events = optionsOf(el)
  const id = `opt${events.length}-${Date.now().toString(36).slice(-3)}`
  const label = `选项 ${events.length + 1}`
  return patchOverlayChild(scenario, node.id, el.id, {
    inputs: { ...(el.inputs ?? {}), events: [...events, { id, label }] },
  })
}
export function updateOptionLabelGraph(scenario: GameScenario, node: GameNode, key: string, label: string): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el || componentEventsLocked(el.component)) return scenario
  const events = optionsOf(el).map((o) => (o.id === key ? { ...o, label } : o))
  return patchOverlayChild(scenario, node.id, el.id, { inputs: { ...(el.inputs ?? {}), events } })
}
export function setOptionTargetGraph(scenario: GameScenario, node: GameNode, key: string, targetId: string): GameScenario {
  const handle = `${CHOICE_HANDLE}${key}`
  if (!targetId) {
    const edge = edgeForHandle(scenario, node.id, handle)
    if (!edge) return scenario
    return { ...scenario, graph: disconnect(scenario.graph, edge.id) }
  }
  return { ...scenario, graph: upsertBranchEdge(scenario.graph, { source: node.id, sourceHandle: handle, target: targetId }) }
}
export function setOptionBranchEffectsGraph(
  scenario: GameScenario,
  node: GameNode,
  key: string,
  effects: GraphEffect[],
): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el) return scenario
  return writeMountEventEffects(scenario, node, el.id, key, effects)
}

export function setOptionBranchSpawnGraph(
  scenario: GameScenario,
  node: GameNode,
  key: string,
  spawn: SettlementSpawn | undefined,
): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el) return scenario
  return writeMountEventSpawn(scenario, node, el.id, key, spawn)
}

/**
 * 通用组件的事件结算列表（manifest.events / outputs；跳转·改数值·spawn 与选项/QTE 同内核）。
 */
export function listComponentEventViews(
  scenario: GameScenario,
  node: GameNode,
  el: OverlayChild | undefined,
): OutcomeView[] {
  if (!el) return []
  const componentId = el.component
  const plugin = getComponent(componentId)
  const fromPlugin = plugin ? componentHandles(componentId, paramsOf(el)) : []
  const candidates: OutcomeCandidate[] = fromPlugin.map((e) => ({ handle: e.id, label: e.label ?? e.id }))
  if (!candidates.length) return []
  return candidates.map((c) => outcomeView(scenario, node, el.id, c.handle, c.label, candidates))
}

/**
 * 通用组件事件结算写入（elId = 该组件在时间轴上的落盘 id，与 listComponentEventViews 用同一个）。
 * 修复：此前 UI 把通用组件的改数值/生成组件误接到 setOptionBranchEffectsGraph/Spawn（内部按
 * choiceElement 定位，非选项元素时静默 no-op），这里补上真正 elId-驱动的写入路径。
 */
export function setComponentEventEffectsGraph(
  scenario: GameScenario,
  node: GameNode,
  elId: string,
  key: string,
  effects: GraphEffect[],
): GameScenario {
  return writeMountEventEffects(scenario, node, elId, key, effects)
}

export function setComponentEventSpawnGraph(
  scenario: GameScenario,
  node: GameNode,
  elId: string,
  key: string,
  spawn: SettlementSpawn | undefined,
): GameScenario {
  return writeMountEventSpawn(scenario, node, elId, key, spawn)
}
export function removeOptionBranchGraph(scenario: GameScenario, node: GameNode, key: string): GameScenario {
  const el = choiceElement(scenario, node)
  if (!el || componentEventsLocked(el.component)) return scenario
  const events = optionsOf(el).filter((o) => o.id !== key)
  // 删到 0 个选项 = 拆整段选项交互（回落叙事 + 自动续连）。
  if (events.length === 0) {
    return teardownInteractionScenario(scenario, node, { kind: 'choice', handlePrefixes: optionsOf(el).map((o) => o.id), childId: el.id })
  }
  let s = patchOverlayChild(scenario, node.id, el.id, { inputs: { ...(el.inputs ?? {}), events } })
  const edge = edgeForHandle(s, node.id, key)
  if (edge) s = { ...s, graph: disconnect(s.graph, edge.id) }
  // 清掉该分支的 event 反应（mount 级 effect + spawn，legacy node 级残留一并清）。
  const n = s.graph.nodes.find((x) => x.id === node.id)!
  s = removeMountEventReaction(s, n, el.id, key)
  s = clearLegacyNodeEvent(s, s.graph.nodes.find((x) => x.id === node.id)!, key)
  return s
}

// ── 写映射：视频绑定 ──────────────────────────────────────────────────────────
export function bindVideoGraph(
  scenario: GameScenario,
  node: GameNode,
  ref: string,
  durationMs: number | undefined,
): GameScenario {
  return {
    ...scenario,
    graph: updateNodeData(scenario.graph, node.id, {
      media: { ...(node.data.media ?? {}), kind: 'VIDEO', ref },
      ...(durationMs != null ? { durationMs } : {}),
    }),
  }
}

/** 写节点媒体提示词（生成面板）；空串清掉 `prompt`。 */
export function setNodePromptGraph(
  scenario: GameScenario,
  node: GameNode,
  prompt: string,
): GameScenario {
  const media = node.data.media ?? { kind: 'VIDEO' }
  return {
    ...scenario,
    graph: updateNodeData(scenario.graph, node.id, {
      media: { ...media, prompt: prompt || undefined },
    }),
  }
}

// 保留 ensureNodeOverlay 引用路径可见（供上层需要时显式确保节点已有专属 overlay）。
export { ensureNodeOverlay }
export type { Trigger }
