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

import type { Episode, Scenario, Scene, Shot } from './types'

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
 *   3. Scene.entryGate / onEnterItemEffects / searchLoot、Branch.itemEffects、
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
  if (s.schemaVersion === 1) s = migrateV1ToV2(s)
  if (s.schemaVersion === 2) s = migrateV2ToV3(s)
  if (s.schemaVersion === 3) s = migrateV3ToV4(s)
  if (s.schemaVersion === 4) s = migrateV4ToV5(s)
  if (s.schemaVersion === 5) s = migrateV5ToV6(s)
  if (s.schemaVersion === 6) s = migrateV6ToV7(s)
  if (s.schemaVersion === 7) s = migrateV7ToV8(s)
  // 末尾无条件兜底：跨过 v4 守卫导致 episodes 缺失的历史剧本也能拿回剧集。
  s = ensureEpisodes(s)
  return s
}
