/**
 * Scenario schema 迁移 —— v1 → v2 → v3 → v4 → v5。
 *
 * v2 的增量：
 *   1. Scenario.locations: Record<string, Location>
 *      · v1 每个 scene 独立持有 media.prompt；v2 把"场所"单独建档，方便生基准图
 *      · v1 → v2：创建一个空 locations 字典（已有脚本不预置 locations，
 *        由作者在新 Forge 流程里追加；旧剧本仍能播放，只是没有 location ref）
 *   2. Character.turnaroundRefImageId?: string
 *      · v1 的 refImageId（单张头像）原样保留，做向前兼容
 *      · v2 新生成的三视图放 turnaroundRefImageId
 *      · 迁移时暂不填（旧数据没有这种图），下次 Forge 走一遍自然补上
 *   3. Scene.locationId?: string
 *      · v1 的 scenes 不动；locationId 由作者在 StoryTree Tab 里关联
 *
 * v3 的增量（分镜化）：
 *   1. Scene.background?: string  —— 舞美/氛围速记，不念、不上字幕
 *      · v2 → v3：留空；迁移不猜测哪些 narration 属于"背景描述"
 *   2. Scene.shots?: Shot[]       —— 每场 2~4 镜
 *      · v2 → v3：为每个 scene 注入一个 medium 单镜兜底，prompt = scene 主提示词，
 *        keyframeMediaRef = 原 scene.media.ref（旧图无缝接管为 sh_01 的关键帧）
 *      · 这样下游所有"以 shot 为单位"的代码不用处理空数组分支
 *   3. Scene.keyShotId?: string   —— 代表帧指向
 *      · v2 → v3：默认指向 sh_01（就是刚注入的兜底镜头）
 *
 * v4 的增量（分剧集化）：
 *   1. Scenario.episodes?: Episode[]  —— 剧集列表
 *      · v3 → v4：自动生成默认集 ep-default（title = 第一集），order=0
 *   2. Scene.episodeId?: string       —— 所属剧集
 *      · v3 → v4：全量 scenes 打上 episodeId: 'ep-default'
 *
 * v5 的增量（小说家工作板）：
 *   1. Scenario.outline?: OutlineNode[]            —— 剧情大纲（作者层面纲领）
 *   2. Scenario.characterRelations?: CharacterRelation[]  —— 角色关系图
 *      · v4 → v5：两者都置空数组；旧剧本没有这两份数据，作者在 ForgeStudio
 *        "剧情大纲" / "人物关系" tab 里手动添加，或通过 chat 命令让 LLM 反向提炼
 *
 * 约束：每一步迁移必须幂等 —— 已是目标版本直接返回。
 */

import { coerceHudRules } from './gameplayTypes'
import { BUILTIN_VIDEO_MEDIA_PREFIX } from './gameAssetCatalog'
import type {
  Effect,
  Episode,
  MediaRef,
  OverlayClip,
  OverlayKind,
  QTESpec,
  Scenario,
  Scene,
  Shot,
  TextStyle,
} from './types'

export function migrateV1ToV2(scenario: Scenario): Scenario {
  if (scenario.schemaVersion >= 2) return scenario
  return {
    ...scenario,
    schemaVersion: 2,
    locations: scenario.locations ?? {},
  }
}

/**
 * 为单个 scene 注入兜底单镜（幂等：已有非空 shots 则原样返回）。
 * 抽成纯函数，方便 promptForge inflateScenes 在同样的路径上复用。
 */
export function ensureSceneHasShots(scene: Scene): Scene {
  if (scene.shots && scene.shots.length > 0) {
    const shots = scene.shots
    const firstShotId = shots[0]?.id
    if (scene.keyShotId && shots.some((s) => s.id === scene.keyShotId)) {
      return scene
    }
    if (!firstShotId) return scene
    return { ...scene, keyShotId: firstShotId }
  }
  const prompt =
    scene.prompts?.scene?.trim() ||
    scene.media?.prompt?.trim() ||
    scene.title ||
    ''
  const fallback: Shot = {
    id: 'sh_01',
    order: 0,
    framing: 'medium',
    prompt,
    keyframeMediaRef: scene.media?.ref,
  }
  return {
    ...scene,
    shots: [fallback],
    keyShotId: 'sh_01',
  }
}

export function migrateV2ToV3(scenario: Scenario): Scenario {
  if (scenario.schemaVersion >= 3) return scenario
  const nextScenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(scenario.scenes)) {
    nextScenes[id] = ensureSceneHasShots(scene)
  }
  return {
    ...scenario,
    schemaVersion: 3,
    scenes: nextScenes,
  }
}

/**
 * v3 → v4：为所有 scene 注入默认 episodeId，生成第一个默认集。
 * 幂等：已有 episodes[] 且 schemaVersion === 4 则直接返回。
 */
export const DEFAULT_EPISODE_ID = 'ep-default'

export function migrateV3ToV4(scenario: Scenario): Scenario {
  if (scenario.schemaVersion === 4 || scenario.schemaVersion === 5) return scenario
  const defaultEpisode: Episode = {
    id: DEFAULT_EPISODE_ID,
    title: '第一集',
    rootSceneId: scenario.rootSceneId,
    order: 0,
    createdAt: Date.now(),
  }
  const nextScenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(scenario.scenes)) {
    nextScenes[id] = scene.episodeId ? scene : { ...scene, episodeId: DEFAULT_EPISODE_ID }
  }
  return {
    ...scenario,
    schemaVersion: 4,
    episodes: scenario.episodes && scenario.episodes.length > 0 ? scenario.episodes : [defaultEpisode],
    scenes: nextScenes,
  }
}

/**
 * v4 → v5：补齐"小说家工作板"两个新字段。
 *
 * 增量：
 *   1. Scenario.outline?: OutlineNode[]  —— 剧情大纲（作者层面纲领）
 *      · v4 → v5：留空数组；旧剧本没有大纲，作者可在 ForgeStudio "剧情大纲" tab
 *        手动添加，或通过 chat `/outline` 命令让 LLM 反向提炼
 *   2. Scenario.characterRelations?: CharacterRelation[]  —— 角色关系图
 *      · v4 → v5：留空数组；同上由作者或 chat 命令补齐
 *
 * 注意：v5 的两个字段都是可选的，渲染层 (RelationsPanel / OutlinePanel) 已
 * 用 `?? []` 兜底，所以即使迁移没运行也不会崩。这里写迁移主要是为了"显式 bump"
 * schemaVersion，让后续 v6 迁移能干净地从 v5 起步。
 */
export function migrateV4ToV5(scenario: Scenario): Scenario {
  if (scenario.schemaVersion === 5) return scenario
  return {
    ...scenario,
    schemaVersion: 5,
    outline: scenario.outline ?? [],
    characterRelations: scenario.characterRelations ?? [],
  }
}

/**
 * v5 → v6：数值系统。
 *
 * 增量：
 *   1. Scenario.variables?: Record<string, GameVariable> —— 数值/flag 注册表
 *   2. Branch.condition / gateMode / effects —— 分支解锁条件与数值副作用
 *   3. Scene.onEnterEffects —— 进入节点时的数值变化
 *
 * 这些字段都是可选的、运行时已用 `?? []` / `?? {}` 兜底，旧数据不写也能播放。
 * 迁移只显式建一个空 variables 字典并 bump 版本号，保证「有没有数值系统」可判定。
 */
export function migrateV5ToV6(scenario: Scenario): Scenario {
  if (scenario.schemaVersion >= 6) return scenario
  return {
    ...scenario,
    schemaVersion: 6,
    variables: scenario.variables ?? {},
  }
}

/**
 * v6 → v7：模块化 + 背包系统。
 *
 * 增量：
 *   1. Scenario.modules?: Partial<Record<ModuleId, boolean>> —— 模块开关
 *      · 旧剧本视为「全开」（isModuleEnabled 默认 true），这里不强写，
 *        让向后兼容由 moduleFlags 兜底；只为显式 bump 版本号。
 *   2. Scenario.items?: Record<string, InventoryItem> —— 背包物品注册表
 *   3. Scene.entryGate / searchLoot、Effect.kind='item'、
 *      ConditionClause 'hasItem' —— 均为可选，运行时已 `?? []`/`?? {}` 兜底。
 *
 * 与 v5→v6 同理：旧数据不写这些字段也能照常播放，迁移仅显式建空 items 字典
 * 并 bump 版本号，保证「有没有背包系统」可判定。
 */
export function migrateV6ToV7(scenario: Scenario): Scenario {
  if (scenario.schemaVersion >= 7) return scenario
  return {
    ...scenario,
    schemaVersion: 7,
    items: scenario.items ?? {},
  }
}

/**
 * v7 → v8：剪映式后期效果（滤镜/调节/特效/贴纸/转场/首尾动画）。
 *
 * 增量全部为 Scene 上的可选字段（filterClips / adjustClips / effectClips /
 * stickerClips / transition / clipAnim），缺省即「无效果」，渲染层已用 `?? []`
 * 兜底。旧数据不写这些字段也能照常播放，迁移仅显式 bump 版本号即可，
 * 无需任何字段转换。
 */
export function migrateV7ToV8(scenario: Scenario): Scenario {
  if (scenario.schemaVersion >= 8) return scenario
  return {
    ...scenario,
    schemaVersion: 8,
  }
}

/**
 * v8 → v9：视频游戏「玩法优先」扩展。
 *
 * 增量全部为可选字段，缺省即「纯影游」、旧数据零回归、运行时已用 `?? []`/`?? {}`/
 * isModuleEnabled 兜底，无需任何字段转换：
 *   · Scene.kind / boss / decision / hotspots / returnsToCaller
 *   · Scenario.entities / statuses / ui、modules.gameplay
 *   · QTESpec.sequence / timeoutMs、ConditionClause hpRatio/score/status
 *
 * 与 v7→v8 同理：迁移仅显式 bump 版本号，让「是不是 v9」可判定即可。
 */
export function migrateV8ToV9(scenario: Scenario): Scenario {
  if (scenario.schemaVersion >= 9) return scenario
  return {
    ...scenario,
    schemaVersion: 9,
  }
}

function legacyHpEffect(id: string, entityId: string | undefined, value: unknown): Effect[] {
  const n = Number(value)
  if (!entityId || !Number.isFinite(n) || n === 0) return []
  return [{ id, kind: 'entityStat', entityId, stat: 'hp', op: 'add', value: -Math.abs(n) }]
}

function migrateEffectList(raw: unknown, fallbackPrefix: string): Effect[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Effect[] = []
  raw.forEach((eff, i) => {
    if (!eff || typeof eff !== 'object') return
    const r = eff as Record<string, unknown>
    if (r.kind === 'var' || (!r.kind && typeof r.varId === 'string')) {
      out.push({
        id: typeof r.id === 'string' ? r.id : `${fallbackPrefix}-var-${i + 1}`,
        kind: 'var',
        varId: String(r.varId),
        op: r.op === 'set' ? 'set' : 'add',
        value: Number(r.value) || 0,
      })
    } else if (r.kind === 'flag') {
      out.push({
        id: typeof r.id === 'string' ? r.id : `${fallbackPrefix}-flag-${i + 1}`,
        kind: 'flag',
        varId: String(r.varId ?? ''),
        value: r.value !== false,
      })
    } else if (r.kind === 'item' || (!r.kind && typeof r.itemId === 'string')) {
      out.push({
        id: typeof r.id === 'string' ? r.id : `${fallbackPrefix}-item-${i + 1}`,
        kind: 'item',
        itemId: String(r.itemId),
        op: r.op === 'take' ? 'take' : 'give',
        count: Math.max(1, Number(r.count) || 1),
      })
    } else if (r.kind === 'entityStat') {
      out.push({
        id: typeof r.id === 'string' ? r.id : `${fallbackPrefix}-entity-${i + 1}`,
        kind: 'entityStat',
        entityId: String(r.entityId ?? ''),
        stat: r.stat === 'qi' || r.stat === 'shield' || r.stat === 'speed' ? r.stat : 'hp',
        op: r.op === 'set' ? 'set' : 'add',
        value: Number(r.value) || 0,
      })
    } else if (r.kind === 'status') {
      out.push({
        id: typeof r.id === 'string' ? r.id : `${fallbackPrefix}-status-${i + 1}`,
        kind: 'status',
        statusId: String(r.statusId ?? ''),
        ...(typeof r.entityId === 'string' ? { entityId: r.entityId } : {}),
        op: r.op === 'remove' ? 'remove' : 'add',
      })
    }
  })
  return out.length > 0 ? out : undefined
}

export function migrateV9ToV10(scenario: Scenario): Scenario {
  if (scenario.schemaVersion >= 10) return scenario
  const bossId = Object.values(scenario.entities ?? {}).find((e) => e.kind === 'boss')?.id
  const playerId = Object.values(scenario.entities ?? {}).find((e) => e.kind === 'player')?.id
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(scenario.scenes)) {
    const rawScene = scene as unknown as Record<string, unknown>
    const onEnterEffects = [
      ...(migrateEffectList(scene.onEnterEffects, `${sceneId}-enter`) ?? []),
      ...(migrateEffectList(rawScene.onEnterItemEffects, `${sceneId}-enter-item`) ?? []),
    ]
    const branches = (scene.branches ?? []).map((branch) => {
      const rawBranch = branch as unknown as Record<string, unknown>
      const effects = [
        ...(migrateEffectList(branch.effects, `${sceneId}-${branch.id}`) ?? []),
        ...(migrateEffectList(rawBranch.itemEffects, `${sceneId}-${branch.id}-item`) ?? []),
      ]
      return {
        ...branch,
        effects: effects.length > 0 ? effects : undefined,
        itemEffects: undefined,
      } as unknown as typeof branch
    })
    const rawPerf = (scene as unknown as Record<string, unknown>).performance as
      | { cues?: Array<Record<string, unknown>> }
      | undefined
    const cues = rawPerf?.cues?.map((rawCue) => {
      return {
        id: rawCue.id,
        atMs: rawCue.atMs,
        label: rawCue.label,
        layer: rawCue.layer,
        effects: [
          ...(migrateEffectList(rawCue.effects, `${sceneId}-${rawCue.id}`) ?? []),
          ...legacyHpEffect(`${sceneId}-${rawCue.id}-boss-hp`, bossId, rawCue.damageToBoss),
          ...legacyHpEffect(`${sceneId}-${rawCue.id}-player-hp`, playerId, rawCue.damageToPlayer),
        ],
      }
    })
    scenes[sceneId] = {
      ...scene,
      branches,
      onEnterEffects: onEnterEffects.length > 0 ? onEnterEffects : undefined,
      onEnterItemEffects: undefined,
      performance: cues && cues.length > 0 ? { cues } : rawScene.performance,
    } as unknown as Scene
  }
  return { ...scenario, schemaVersion: 10, scenes }
}

const DEFAULT_TOLERANCE = { perfect: 120, great: 280, good: 500 }
const DEFAULT_QTE_SCORE = { perfect: 100, great: 60, good: 30, miss: 0 }

function cleanTimeWindow(w: {
  startMs?: unknown
  endMs?: unknown
  timeoutMs?: unknown
}): { startMs?: number; endMs?: number; timeoutMs?: number } | undefined {
  const out: { startMs?: number; endMs?: number; timeoutMs?: number } = {}
  if (typeof w.startMs === 'number') out.startMs = w.startMs
  if (typeof w.endMs === 'number') out.endMs = w.endMs
  if (typeof w.timeoutMs === 'number') out.timeoutMs = w.timeoutMs
  return Object.keys(out).length > 0 ? out : undefined
}

/** 旧 scene.qte + decision(窗口/qteKind) + ext.qteUi → 新 QTESpec（tolerance/window/ui/template）。 */
function migrateQte(
  rawQte: Record<string, unknown> | undefined,
  decision: Record<string, unknown> | undefined,
  ext: Record<string, unknown> | undefined,
): QTESpec {
  const tolerance =
    (rawQte?.tolerance as QTESpec['tolerance']) ??
    (rawQte?.window as QTESpec['tolerance']) ??
    DEFAULT_TOLERANCE
  const window = cleanTimeWindow({
    startMs: decision?.windowStartMs ?? decision?.atMs,
    endMs: decision?.windowEndMs,
    timeoutMs: rawQte?.timeoutMs ?? decision?.timeoutMs,
  })
  const qteUi = ext?.qteUi
  const template = decision?.qteKind
  return {
    cues: (Array.isArray(rawQte?.cues) ? rawQte?.cues : []) as QTESpec['cues'],
    tolerance,
    score: (rawQte?.score as QTESpec['score']) ?? DEFAULT_QTE_SCORE,
    ...(typeof rawQte?.passingScore === 'number' ? { passingScore: rawQte.passingScore } : {}),
    ...(rawQte?.sequence === true ? { sequence: true } : {}),
    ...(rawQte?.outcomeLabels ? { outcomeLabels: rawQte.outcomeLabels as QTESpec['outcomeLabels'] } : {}),
    ...(window ? { window } : {}),
    ...(typeof qteUi === 'string' ? { ui: qteUi as QTESpec['ui'] } : {}),
    ...(typeof template === 'string' ? { template: template as QTESpec['template'] } : {}),
  }
}

/** 旧 decision(static/timed) + ext.choiceUi → 新 ChoiceSpec。 */
function migrateChoice(
  decision: Record<string, unknown>,
  ext: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const optType = decision.optType
  const timed = optType === 'timed' || decision.mode === 'timed'
  const window = cleanTimeWindow({
    startMs: decision.windowStartMs ?? decision.atMs,
    endMs: decision.windowEndMs,
    timeoutMs: decision.timeoutMs,
  })
  const choiceUi = ext?.choiceUi
  return {
    ...(timed ? { timed: true } : {}),
    ...(window ? { window } : {}),
    ...(typeof decision.prompt === 'string' ? { prompt: decision.prompt } : {}),
    ...(typeof decision.defaultBranchId === 'string'
      ? { defaultBranchId: decision.defaultBranchId }
      : {}),
    ...(typeof decision.fireAt === 'string' ? { fireAt: decision.fireAt } : {}),
    ...(typeof decision.presentation === 'string' ? { presentation: decision.presentation } : {}),
    ...(typeof choiceUi === 'string' ? { ui: choiceUi } : {}),
    ...(typeof decision.layer === 'number' ? { layer: decision.layer } : {}),
  }
}

/**
 * v11：交互形态 presence 化。
 *   - Scene.kind/decision/calcType → boss/qte/choice/calc 专属字段（至多一个非空，
 *     优先级 boss > qte > calc > choice）。
 *   - QTESpec.window(命中窗) → tolerance；decision 窗口 + qte.timeoutMs → qte.window:TimeWindow。
 *   - ext.qteUi/choiceUi → qte.ui/choice.ui（其余 ext 键保留）。
 *   - decision.mode==='wait' → scene.mediaPlayMode='loop'。
 *   - PerformanceCue.effects → settlement:{effects,float}；配对的 numeric sticker
 *     文本/坐标搬进 settlement.float，该 sticker 从 stickerClips 移除；其余 sticker 去 performanceCueId。
 *   - 删 Branch.showAt。
 */
export function migrateV10ToV11(scenario: Scenario): Scenario {
  if (scenario.schemaVersion >= 11) return scenario
  const scenes: Record<string, Scene> = {}
  for (const [sceneId, scene] of Object.entries(scenario.scenes)) {
    const raw = scene as unknown as Record<string, unknown>
    const decision = (raw.decision as Record<string, unknown> | undefined) ?? undefined
    const ext = (raw.ext as Record<string, unknown> | undefined) ?? undefined
    const oldKind = raw.kind as string | undefined
    const rawQte = raw.qte as Record<string, unknown> | undefined
    const optType =
      (decision?.optType as string | undefined) ??
      (decision?.mode === 'timed' || decision?.mode === 'wait' ? 'timed' : decision ? 'static' : undefined)

    const hasCues = Array.isArray(rawQte?.cues) && (rawQte?.cues as unknown[]).length > 0

    const isBoss = raw.boss != null
    // legacy-alias：旧 decision 枚举里的 'timed_qte' 不是"限时 QTE"这种独立形态
    // （QTE 天生限时），而是"该 decision 其实是 QTE"的旧说法 → 归到 qte 形态。
    const isQte = !isBoss && (optType === 'timed_qte' || oldKind === 'qte' || hasCues)
    const isCalc = !isBoss && !isQte && typeof raw.calcType === 'string'
    const isChoice = !isBoss && !isQte && !isCalc && (decision != null || oldKind === 'choice')

    // performance cues → settlement，配对 sticker 搬进 float
    const stickers = Array.isArray(raw.stickerClips)
      ? (raw.stickerClips as Array<Record<string, unknown>>)
      : []
    const usedStickerIds = new Set<string>()
    const findPaired = (cueId: string): Record<string, unknown> | undefined =>
      stickers.find((s) => s.performanceCueId === cueId) ??
      stickers.find((s) => s.id === cueId && s.kind === 'numeric')
    const perfRaw = raw.performance as { cues?: Array<Record<string, unknown>> } | undefined
    const cues = perfRaw?.cues?.map((cue) => {
      const paired = typeof cue.id === 'string' ? findPaired(cue.id) : undefined
      if (paired && typeof paired.id === 'string') usedStickerIds.add(paired.id)
      const existingSettlement = cue.settlement as { effects?: Effect[]; float?: unknown } | undefined
      const effects = (Array.isArray(cue.effects) ? cue.effects : existingSettlement?.effects ?? []) as Effect[]
      const float = paired
        ? {
            ...(typeof paired.text === 'string' ? { text: paired.text } : {}),
            ...(typeof paired.x === 'number' ? { x: paired.x } : {}),
            ...(typeof paired.y === 'number' ? { y: paired.y } : {}),
          }
        : (existingSettlement?.float as { text?: string; x?: number; y?: number } | undefined)
      return {
        id: cue.id as string,
        atMs: cue.atMs as number,
        ...(typeof cue.label === 'string' ? { label: cue.label } : {}),
        ...(typeof cue.layer === 'number' ? { layer: cue.layer } : {}),
        settlement: { effects, ...(float && Object.keys(float).length > 0 ? { float } : {}) },
      }
    })
    const nextStickers = stickers
      .filter((s) => !(typeof s.id === 'string' && usedStickerIds.has(s.id)))
      .map((s) => {
        const { performanceCueId: _drop, ...rest } = s
        return rest
      })

    // branches 去 showAt
    const branches = (Array.isArray(raw.branches) ? (raw.branches as Array<Record<string, unknown>>) : []).map(
      (b) => {
        const { showAt: _drop, ...rest } = b
        return rest
      },
    )

    // ext 去 UI 变体键
    let nextExt: Record<string, unknown> | undefined
    if (ext) {
      const { qteUi: _q, choiceUi: _c, ...restExt } = ext
      nextExt = Object.keys(restExt).length > 0 ? restExt : undefined
    }

    const {
      kind: _k,
      decision: _d,
      calcType: _ct,
      ext: _e,
      qte: _q2,
      boss: _b,
      branches: _br,
      performance: _p,
      stickerClips: _s,
      ...restScene
    } = raw

    const mediaPlayMode =
      raw.mediaPlayMode ?? (decision?.mode === 'wait' ? 'loop' : undefined)

    const next: Record<string, unknown> = {
      ...restScene,
      branches,
      ...(mediaPlayMode ? { mediaPlayMode } : {}),
      ...(nextExt ? { ext: nextExt } : {}),
      ...(nextStickers.length > 0 ? { stickerClips: nextStickers } : {}),
      ...(cues && cues.length > 0 ? { performance: { cues } } : {}),
    }
    if (isBoss) next.boss = raw.boss
    if (isQte) next.qte = migrateQte(rawQte, decision, ext)
    if (isCalc) next.calc = { calcType: raw.calcType }
    if (isChoice) next.choice = migrateChoice(decision as Record<string, unknown>, ext)

    scenes[sceneId] = next as unknown as Scene
  }
  return { ...scenario, schemaVersion: 11, scenes }
}

/**
 * v11 → v12：视频演出来源收敛到 `scene.media.ref`（SSOT）。
 *   - 旧 `scene.clipId`（引用内置 VIDEO_CLIPS）→ `media = { kind:'VIDEO', ref:'m-builtin-<clipId>' }`，
 *     内置片段以 `m-builtin-<clipId>` 稳定 id 落入 mediaStore（App 启动 seed）。
 *   - 删除持久化的 `scene.clipId`；蓝图/运行时的 clipId 改由 media.ref 在编译边界派生。
 *   - 已有真实视频 media（上传产物：kind==='VIDEO' 且 ref 非空）优先保留，不被 clipId 覆盖。
 */
export function migrateV11ToV12(scenario: Scenario): Scenario {
  if (scenario.schemaVersion >= 12) return scenario
  const scenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(scenario.scenes)) {
    const raw = scene as unknown as Record<string, unknown>
    const clipId = typeof raw.clipId === 'string' && raw.clipId ? raw.clipId : undefined
    const { clipId: _dropClip, ...rest } = raw
    const media = scene.media as MediaRef | undefined
    const mediaIsRealVideo = media?.kind === 'VIDEO' && Boolean(media.ref)
    const nextMedia: MediaRef | undefined =
      !mediaIsRealVideo && clipId
        ? { kind: 'VIDEO', ref: `${BUILTIN_VIDEO_MEDIA_PREFIX}${clipId}` }
        : media
    scenes[id] = {
      ...(rest as unknown as Scene),
      ...(nextMedia ? { media: nextMedia } : {}),
    }
  }
  return { ...scenario, schemaVersion: 12, scenes }
}

/** 从旧扁平载体（TextOverlayClip / numeric sticker）抽出嵌套 TextStyle；scale 折进 fontSizePct。 */
function extractOverlayStyle(raw: Record<string, unknown>, scale: number): TextStyle {
  const style: Record<string, unknown> = {}
  for (const k of ['fontFamily', 'color', 'strokeColor', 'align', 'bgColor'] as const) {
    if (typeof raw[k] === 'string') style[k] = raw[k]
  }
  for (const k of ['fontWeight', 'strokeWidth', 'opacity'] as const) {
    if (typeof raw[k] === 'number') style[k] = raw[k]
  }
  for (const k of ['italic', 'underline'] as const) {
    if (typeof raw[k] === 'boolean') style[k] = raw[k]
  }
  if (typeof raw.fontSizePct === 'number') style.fontSizePct = raw.fontSizePct * scale
  else if (scale !== 1) style.fontSizePct = 7 * scale
  if (typeof raw.shadow === 'boolean') style.shadow = raw.shadow
  return style as TextStyle
}

/**
 * v12 → v13：统一飘字载体。
 *   - `textOverlays[]`（花字）→ `overlays[]`（kind='text'、content=text、scale 折进 fontSizePct、
 *     shadow → style.shadow、扁平样式收进嵌套 style）。
 *   - `stickerClips[]`（贴纸）→ `overlays[]`：numeric/emoji → kind='text'（content=text、sizePct*scale
 *     折进 style.fontSizePct、color → style）；builtin → kind='icon'（content=presetId）；
 *     image → kind='image'（content=mediaId）；sizePct*scale 折进 sizePct。
 *   - `performance.cues[]` → 按 id 配对已转出的 overlay 挂 `settlement`；未配对 → 不可见
 *     overlay（content=''、startMs=atMs）仅当纯逻辑触发器。
 *   - 删除 `textOverlays` / `stickerClips` / `performance` 旧字段。
 */
export function migrateV12ToV13(scenario: Scenario): Scenario {
  if (scenario.schemaVersion >= 13) return scenario
  const scenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(scenario.scenes)) {
    const raw = scene as unknown as Record<string, unknown>
    const overlays: OverlayClip[] = []
    const byId = new Map<string, number>()

    // 1) textOverlays → kind:'text'
    const textOverlays = Array.isArray(raw.textOverlays)
      ? (raw.textOverlays as Array<Record<string, unknown>>)
      : []
    for (const t of textOverlays) {
      const scale = typeof t.scale === 'number' ? t.scale : 1
      const style = extractOverlayStyle(t, scale)
      const ov: OverlayClip = {
        id: String(t.id),
        kind: 'text',
        content: typeof t.text === 'string' ? t.text : '',
        startMs: typeof t.startMs === 'number' ? t.startMs : 0,
        x: typeof t.x === 'number' ? t.x : 0.5,
        y: typeof t.y === 'number' ? t.y : 0.5,
        ...(typeof t.endMs === 'number' ? { endMs: t.endMs } : {}),
        ...(typeof t.rotation === 'number' ? { rotation: t.rotation } : {}),
        ...(typeof t.opacity === 'number' ? { opacity: t.opacity } : {}),
        ...(typeof t.layer === 'number' ? { layer: t.layer } : {}),
        ...(Object.keys(style).length > 0 ? { style } : {}),
      }
      byId.set(ov.id, overlays.length)
      overlays.push(ov)
    }

    // 2) stickerClips → text / icon / image
    const stickers = Array.isArray(raw.stickerClips)
      ? (raw.stickerClips as Array<Record<string, unknown>>)
      : []
    for (const s of stickers) {
      const oldKind = String(s.kind)
      const scale = typeof s.scale === 'number' ? s.scale : 1
      const baseSize = (typeof s.sizePct === 'number' ? s.sizePct : 12) * scale
      let kind: OverlayKind
      let content: string
      let style: TextStyle | undefined
      let sizePct: number | undefined
      if (oldKind === 'builtin') {
        kind = 'icon'
        content = typeof s.presetId === 'string' ? s.presetId : ''
        sizePct = baseSize
      } else if (oldKind === 'image') {
        kind = 'image'
        content = typeof s.mediaId === 'string' ? s.mediaId : ''
        sizePct = baseSize
      } else {
        kind = 'text'
        content = typeof s.text === 'string' ? s.text : ''
        const st: Record<string, unknown> = { fontSizePct: baseSize }
        if (typeof s.color === 'string') st.color = s.color
        if (oldKind === 'numeric') {
          st.strokeColor = '#000000'
          st.strokeWidth = 3
          st.fontWeight = 900
        }
        style = st as TextStyle
      }
      const ov: OverlayClip = {
        id: String(s.id),
        kind,
        content,
        startMs: typeof s.startMs === 'number' ? s.startMs : 0,
        x: typeof s.x === 'number' ? s.x : 0.5,
        y: typeof s.y === 'number' ? s.y : 0.5,
        ...(typeof s.endMs === 'number' ? { endMs: s.endMs } : {}),
        ...(typeof s.rotation === 'number' ? { rotation: s.rotation } : {}),
        ...(typeof s.opacity === 'number' ? { opacity: s.opacity } : {}),
        ...(typeof s.layer === 'number' ? { layer: s.layer } : {}),
        ...(sizePct !== undefined ? { sizePct } : {}),
        ...(style && Object.keys(style).length > 0 ? { style } : {}),
        ...(typeof s.enter === 'string' ? { enter: s.enter } : {}),
        ...(typeof s.exit === 'string' ? { exit: s.exit } : {}),
      }
      byId.set(ov.id, overlays.length)
      overlays.push(ov)
    }

    // 3) performance.cues → 配对挂 settlement / 未配对生成不可见触发器
    const perf = raw.performance as { cues?: Array<Record<string, unknown>> } | undefined
    const cues = Array.isArray(perf?.cues) ? perf!.cues! : []
    for (const cue of cues) {
      const cueId = String(cue.id)
      const atMs = typeof cue.atMs === 'number' ? cue.atMs : 0
      const settlement = cue.settlement as OverlayClip['settlement']
      const idx = byId.get(cueId)
      const target = idx !== undefined ? overlays[idx] : undefined
      if (target) {
        overlays[idx as number] = {
          ...target,
          ...(settlement ? { settlement } : {}),
          ...(target.label === undefined && typeof cue.label === 'string' ? { label: cue.label } : {}),
        }
      } else {
        overlays.push({
          id: cueId,
          kind: 'text',
          content: '',
          startMs: atMs,
          x: 0.5,
          y: 0.5,
          ...(typeof cue.layer === 'number' ? { layer: cue.layer } : {}),
          ...(settlement ? { settlement } : {}),
          ...(typeof cue.label === 'string' ? { label: cue.label } : {}),
        })
      }
    }

    const { textOverlays: _t, stickerClips: _s, performance: _p, ...restScene } = raw
    scenes[id] = {
      ...(restScene as unknown as Scene),
      ...(overlays.length > 0 ? { overlays } : {}),
    }
  }
  return { ...scenario, schemaVersion: 13, scenes }
}

/**
 * 防御层：确保 scenes 是 Record<string, Scene> 而非 Array。
 * LLM 工具调用 / 旧版序列化 / 外部导入偶尔会把 scenes 存成数组；
 * 一旦作为数组进入迁移链，Object.entries 会产出 "0","1","2" 等数字 key，
 * 后续按 rootSceneId 查找 → undefined → 渲染崩溃。
 */
function normalizeScenesShape(scenario: Scenario): Scenario {
  const raw = scenario.scenes as unknown
  if (!Array.isArray(raw)) return scenario
  const dict: Record<string, Scene> = {}
  for (const item of raw as Array<Record<string, unknown>>) {
    if (item && typeof item === 'object' && typeof item.id === 'string') {
      dict[item.id as string] = item as unknown as Scene
    }
  }
  return { ...scenario, scenes: dict }
}

/**
 * 防御层：确保每个 scene 的 `dialogue` / `branches` 都是可迭代数组。
 *
 * 历史遗留事故：LLM 锻造 / 外部导入 / 旧序列化偶尔产出缺字段的 scene
 * （`dialogue` 或 `branches` 为 undefined）。这两个字段在 Scene 类型里是
 * **必填数组**，下游（DetailScriptPanel 拼剧本 / orderScenesForEpisode BFS /
 * StoryTree 连线 / Player 播放）都直接 `for...of` / `.map` / `.length` 迭代，
 * 一旦缺失就抛 `sc.dialogue is not iterable` 把整块 UI 打崩。
 *
 * 在迁移链里无条件兜底：缺失则补空数组。幂等（已是数组则原样返回该 scene 引用，
 * 整份 scenario 也只在确有修补时才返回新对象，避免无谓的引用变更触发重渲染）。
 */
export function normalizeSceneArrays(scenario: Scenario): Scenario {
  let touched = false
  const nextScenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(scenario.scenes)) {
    const dialogueOk = Array.isArray(scene.dialogue)
    const branchesOk = Array.isArray(scene.branches)
    if (dialogueOk && branchesOk) {
      nextScenes[id] = scene
      continue
    }
    touched = true
    nextScenes[id] = {
      ...scene,
      dialogue: dialogueOk ? scene.dialogue : [],
      branches: branchesOk ? scene.branches : [],
    }
  }
  return touched ? { ...scenario, scenes: nextScenes } : scenario
}

/**
 * 防御层：确保 scenario.ui.hud 是可迭代的 HudRule[]。
 *
 * LLM 锻造 / 外部导入偶尔把 hud 存成 Record（{ playerHp: 'always' }）；
 * HudLayer 与规则模块都依赖 .find / .filter，非数组会直接崩溃。
 */
export function normalizeUiHud(scenario: Scenario): Scenario {
  const ui = scenario.ui
  if (!ui?.hud) return scenario
  const hud = coerceHudRules(ui.hud)
  const unchanged =
    Array.isArray(ui.hud) &&
    hud.length === ui.hud.length &&
    hud.every(
      (r, i) =>
        r.element === ui.hud![i]?.element && r.show === ui.hud![i]?.show,
    )
  if (unchanged) return scenario
  if (hud.length === 0) {
    const { hud: _drop, ...restUi } = ui
    const nextUi = Object.keys(restUi).length > 0 ? restUi : undefined
    return { ...scenario, ui: nextUi }
  }
  return { ...scenario, ui: { ...ui, hud } }
}

/**
 * 防御层：确保 scene.qte.cues 是可迭代数组。
 *
 * LLM / 外部导入偶尔只写 qte 壳（含 timeoutMs）却不带 cues；
 * QTEEngine 与 Player 都依赖 cues.length / .map，缺失会直接崩溃。
 */
export function normalizeSceneQte(scenario: Scenario): Scenario {
  let touched = false
  const nextScenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(scenario.scenes)) {
    const qte = scene.qte
    if (!qte || Array.isArray(qte.cues)) {
      nextScenes[id] = scene
      continue
    }
    touched = true
    nextScenes[id] = { ...scene, qte: { ...qte, cues: [] } }
  }
  return touched ? { ...scenario, scenes: nextScenes } : scenario
}

/**
 * 防御层：确保至少有一集（无视 schemaVersion）。
 *
 * 历史遗留事故：部分剧本在「分剧集化」(v4) 之前就已经被打到了更高的
 * schemaVersion（例如直接以 sv6 落库 / 旧导入路径没写 episodes），
 * migrateV3ToV4 因 `schemaVersion===3` 守卫被跳过 → episodes 一直为空 →
 * 剧集 UI(EpisodeRail) 整条隐藏，作者反馈"剧情树的剧集不见了"。
 *
 * 这里在迁移链末尾无条件兜底：没有 episodes 就建默认「第一集」，把所有
 * 尚未分集的 scene 收纳进去。幂等（已有 episodes 直接返回）。
 */
export function ensureEpisodes(scenario: Scenario): Scenario {
  if (scenario.episodes && scenario.episodes.length > 0) return scenario
  const defaultEpisode: Episode = {
    id: DEFAULT_EPISODE_ID,
    title: '第一集',
    rootSceneId: scenario.rootSceneId,
    order: 0,
    createdAt: Date.now(),
  }
  const nextScenes: Record<string, Scene> = {}
  for (const [id, scene] of Object.entries(scenario.scenes)) {
    nextScenes[id] = scene.episodeId ? scene : { ...scene, episodeId: DEFAULT_EPISODE_ID }
  }
  return { ...scenario, episodes: [defaultEpisode], scenes: nextScenes }
}

/**
 * 统一入口：读入任意版本的 Scenario，返回当前最新版本。
 * 之后再加 v6 时，按版本号顺序链式调用。
 */
export function migrateScenarioToLatest(scenario: Scenario): Scenario {
  let s = normalizeScenesShape(scenario)
  s = normalizeSceneArrays(s)
  if (s.schemaVersion === 1) s = migrateV1ToV2(s)
  if (s.schemaVersion === 2) s = migrateV2ToV3(s)
  if (s.schemaVersion === 3) s = migrateV3ToV4(s)
  if (s.schemaVersion === 4) s = migrateV4ToV5(s)
  if (s.schemaVersion === 5) s = migrateV5ToV6(s)
  if (s.schemaVersion === 6) s = migrateV6ToV7(s)
  if (s.schemaVersion === 7) s = migrateV7ToV8(s)
  if (s.schemaVersion === 8) s = migrateV8ToV9(s)
  if (s.schemaVersion === 9) s = migrateV9ToV10(s)
  if (s.schemaVersion === 10) s = migrateV10ToV11(s)
  if (s.schemaVersion === 11) s = migrateV11ToV12(s)
  if (s.schemaVersion === 12) s = migrateV12ToV13(s)
  s = normalizeUiHud(s)
  s = normalizeSceneQte(s)
  // 末尾无条件兜底：跨过 v4 守卫导致 episodes 缺失的历史剧本也能拿回剧集。
  s = ensureEpisodes(s)
  return s
}
