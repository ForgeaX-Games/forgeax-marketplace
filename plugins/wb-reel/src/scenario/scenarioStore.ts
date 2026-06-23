import { create } from 'zustand'
import { shallow } from 'zustand/shallow'
import { temporal } from 'zundo'
import type {
  AudioClip,
  Blockout,
  Branch,
  Character,
  DialogueLine,
  Episode,
  GameVariable,
  Location,
  MinigameClip,
  Prop,
  QTECue,
  DirectorStyleId,
  QTESpec,
  Scenario,
  Scene,
  ScenePrompts,
  SearchSegmentClip,
  Shot,
  StudioMode,
  TextOverlayClip,
  UIStyle,
  VisualStyle,
  VideoConfig,
  FilterClip,
  AdjustClip,
  EffectClip,
  StickerClip,
  TransitionSpec,
  ClipAnimSpec,
} from './types'
import { getDemoScenario } from './demoScenario'
import { makeBlankScenario } from './blankScenario'
import { migrateScenarioToLatest, ensureEpisodes } from './schemaMigrate'
import {
  pickPublicVideoConfig,
  sanitizeScenarioForIO,
} from './sanitize'
import { applyReconnectPlan, type ReconnectPlan } from './reconnectOrphans'
import { applyJsonPatch, JsonPatchError } from './jsonPatch'
import {
  type ActSkeleton,
  type StreamingActStatus,
  type StreamingNodeStatus,
  type StreamingState,
  actSkeletonToMeta,
  makeBlankSkeletonScene,
  makeStreamingState,
  mergeScenePrompts,
} from './streamingState'

/**
 * Studio 全局存储 —— 编辑器与运行时共用。
 *
 * 编辑器对剧本做的所有改动都通过这里的 action（不直接 mutate），
 * 这样 undo/redo、JSON 导出、运行时切片读取都可以基于同一份数据。
 */

export interface ScenarioStore {
  scenario: Scenario
  mode: StudioMode
  selectedSceneId: string
  /** 编辑器右栏检视器选中的子项类型与 id */
  selection:
    | { kind: 'scene'; sceneId: string }
    | { kind: 'dialogue'; sceneId: string; dialogueId: string }
    | { kind: 'qte'; sceneId: string; cueId: string }
    | { kind: 'branch'; sceneId: string; branchId: string }
    | null

  /**
   * 长文本分段管线的运行时状态（id: p3-store）。
   *   - null：当前没有进行中的批次
   *   - 有值：actBatchPipeline 正在/刚跑完，Player 据此切 skeleton/prompts-ready/assets-ready
   *
   * **不进入持久化字段** —— 见 streamingState.ts 顶部注释。
   * partialize 也只跟踪 scenario，所以 streaming 不进 zundo / localStorage / exportJSON。
   */
  streaming: StreamingState | null

  setMode: (mode: StudioMode) => void
  selectScene: (sceneId: string) => void
  setSelection: (sel: ScenarioStore['selection']) => void

  loadScenario: (s: Scenario) => void
  /**
   * 跨 iframe 实时同步专用 —— 把对端 (另一个 pane) 刚改完的 scenario 轻量套用到
   * 本端。区别于 loadScenario:
   *   - 不重置选中态 / 不复位 streaming (除非当前选中的 scene 已被对端删掉)
   *   - 不走 migrate/sanitize 重流水 (对端已经处理过, 这里只是镜像)
   * 只用于 crossPaneSync 的 scenario CRUD 信令; UI 不要直接调。
   */
  applyExternalScenario: (s: Scenario) => void
  /**
   * 采纳 forge 流程（IdeaForge / ForgeChatPanel）产出的新 scenario 内容。
   *
   * v6.8 起需要显式选 mode 来表达意图 —— 见下方 action 注释。
   * 简记: "在当前剧本上修改/优化" → replace-current; "新建剧本" → create-new。
   */
  /**
   * 锻造管线最终落地 —— v6.8 重写: 支持两种 mode
   *
   *   mode='replace-current' (默认, 兼容老语义):
   *     "在当前工程里继续锻造 / 优化" —— 保留 current.id, 内容字段全替换。
   *     适用: 用户已经在编辑某个剧本, 让 AI 在它基础上重写大纲 / 重写场景。
   *     效果: persist 订阅看到"当前条目内容更新", 不会冒出新历史项;
   *          forgeChatStore session / assetStore.scenarioId 命名空间不被切断。
   *
   *   mode='create-new':
   *     "从零创作一个全新剧本" —— 用 next.id (若 next 自带), 否则生成新 scn-<ts>;
   *     不复用 current.id。适用: 用户在 demo 上点"灭火脚本 / 从空白锻造",
   *     不想覆盖样板剧本; 也避免"雨夜 demo 和新案件共用 demo-001"这种串台。
   *
   * 历史 bug:
   *   v6.7 之前 adoptForgedScenario 无脑用 current.id, 导致用户在内置 demo 上
   *   forge 出新剧本时, 新剧本会"烙成" demo-001, 把雨夜样板从磁盘上挤掉,
   *   还让两个 scenario 共享 .reel-assets/manifest.json 的同 scenarioId 命名空间,
   *   旧 intro 图会污染新剧本. 调用方现在必须显式选 mode 来表达意图.
   */
  adoptForgedScenario: (
    next: Scenario,
    opts?: { mode?: 'replace-current' | 'create-new' },
  ) => void
  /**
   * "➕ 新的故事" —— 把当前剧本归档（persist 订阅会自动写入历史），
   * 把编辑器切到一份干净的空白剧本，并清掉场景图 cache 防止旧图闪现。
   *
   * 实现细节放在 action 里而不是 UI 层：
   *   - UI 层只负责确认框 + 调用，没有重量级业务逻辑
   *   - 测试可以用 store 直接断言，不用拉 React 组件
   */
  newScenario: (opts?: { title?: string }) => void
  exportJSON: () => string
  importJSON: (raw: string) => string | null

  updateScene: (sceneId: string, patch: Partial<Scene>) => void
  updateDialogue: (
    sceneId: string,
    dialogueId: string,
    patch: Partial<DialogueLine>,
  ) => void
  addDialogue: (sceneId: string, line: DialogueLine) => void
  removeDialogue: (sceneId: string, dialogueId: string) => void
  /** 清理该场景内所有空文本台词（去掉残留的空 clip）。 */
  removeEmptyDialogue: (sceneId: string) => void

  updateQTECue: (sceneId: string, cueId: string, patch: Partial<QTECue>) => void
  addQTECue: (sceneId: string, cue: QTECue) => void
  removeQTECue: (sceneId: string, cueId: string) => void
  setQTESpec: (sceneId: string, spec: QTESpec | undefined) => void

  updateBranch: (
    sceneId: string,
    branchId: string,
    patch: Partial<Branch>,
  ) => void
  addBranch: (sceneId: string, branch: Branch) => void
  removeBranch: (sceneId: string, branchId: string) => void

  setScenePrompt: (sceneId: string, prompt: string) => void
  setSceneMediaRef: (
    sceneId: string,
    media: { kind: Scene['media']['kind']; ref?: string },
  ) => void

  /**
   * v3 · 写入某 shot 的关键帧 mediaStore id。
   * 若该 shot 是 keyShot（keyShotId 命中），额外把 scene.media.ref 同步到这张图，
   * 保证 Player / StoryTree 缩略默认用代表帧（下一轮才按时间轴切镜）。
   */
  setSceneShotKeyframe: (
    sceneId: string,
    shotId: string,
    mediaRef: string | undefined,
  ) => void

  /**
   * v3 · patch 某 shot 的非关键帧字段（prompt / framing / cameraHint / transitionHint…）。
   * 不接受直接改 `id` / `order` —— order 走专用 reorder action（下一轮），
   * id 是对外唯一键不允许改名。keyframeMediaRef 请走 setSceneShotKeyframe。
   */
  updateShot: (
    sceneId: string,
    shotId: string,
    patch: Partial<Omit<Shot, 'id' | 'order' | 'keyframeMediaRef'>>,
  ) => void

  /**
   * v3.1 · 在指定 shot 之后插入一个新 shot（可选 seed）。
   * insertAfterShotId 不传 / 未命中时插到末尾。order 会全员 reindex，返回新 id。
   */
  addShot: (
    sceneId: string,
    seed?: Partial<Omit<Shot, 'id' | 'order'>>,
    insertAfterShotId?: string,
  ) => string | null

  /**
   * v3.1 · 删除一个 shot；若是 keyShotId 则自动回退到 shots[0]。
   * 删除后其余 shot 的 order 全员 reindex，保证 0..n-1 连续。
   */
  removeShot: (sceneId: string, shotId: string) => void

  /**
   * v3.1 · 剪切：把 shot 在 scene 时间轴 atMs 处切成两段。
   * 返回新增的 "后半段" shot id；若 atMs 不落在该 shot 内则 no-op 并返回 null。
   */
  splitShot: (sceneId: string, shotId: string, atMs: number) => string | null

  /**
   * v3.1 · 一键左对齐：按 order 升序把所有 shot 的 startMs/endMs 重排成紧挨的段。
   * 每段 duration 取 shot 自身 duration（缺省时从 scene.durationMs / shots.length 均分）。
   */
  compactShotsLeft: (sceneId: string) => void

  // ─── v3.1 · 音频剪辑（scene.audio） ─────────────────────────────
  addAudioClip: (sceneId: string, clip: AudioClip) => void
  removeAudioClip: (sceneId: string, clipId: string) => void
  updateAudioClip: (
    sceneId: string,
    clipId: string,
    patch: Partial<Omit<AudioClip, 'id'>>,
  ) => void
  splitAudioClip: (sceneId: string, clipId: string, atMs: number) => string | null
  compactAudioLeft: (sceneId: string, role?: AudioClip['role']) => void

  // ─── v3.6 · 小游戏 clip（scene.minigames） ─────────────────────
  addMinigameClip: (sceneId: string, clip: MinigameClip) => void
  removeMinigameClip: (sceneId: string, clipId: string) => void
  updateMinigameClip: (
    sceneId: string,
    clipId: string,
    patch: Partial<Omit<MinigameClip, 'id'>>,
  ) => void

  // ─── v7 · 文字叠加 clip（scene.textOverlays） ───────────────────
  addTextOverlay: (sceneId: string, clip: TextOverlayClip) => void
  removeTextOverlay: (sceneId: string, clipId: string) => void
  updateTextOverlay: (
    sceneId: string,
    clipId: string,
    patch: Partial<Omit<TextOverlayClip, 'id'>>,
  ) => void

  // ─── v7 · 搜索段 clip（scene.searchSegments） ───────────────────
  addSearchSegment: (sceneId: string, clip: SearchSegmentClip) => void
  removeSearchSegment: (sceneId: string, clipId: string) => void
  updateSearchSegment: (
    sceneId: string,
    clipId: string,
    patch: Partial<Omit<SearchSegmentClip, 'id'>>,
  ) => void

  // ─── v8 · 剪映式后期效果（filter/adjust/effect/sticker + transition/clipAnim） ─
  addFilterClip: (sceneId: string, clip: FilterClip) => void
  removeFilterClip: (sceneId: string, clipId: string) => void
  updateFilterClip: (sceneId: string, clipId: string, patch: Partial<Omit<FilterClip, 'id'>>) => void
  addAdjustClip: (sceneId: string, clip: AdjustClip) => void
  removeAdjustClip: (sceneId: string, clipId: string) => void
  updateAdjustClip: (sceneId: string, clipId: string, patch: Partial<Omit<AdjustClip, 'id'>>) => void
  addEffectClip: (sceneId: string, clip: EffectClip) => void
  removeEffectClip: (sceneId: string, clipId: string) => void
  updateEffectClip: (sceneId: string, clipId: string, patch: Partial<Omit<EffectClip, 'id'>>) => void
  addStickerClip: (sceneId: string, clip: StickerClip) => void
  removeStickerClip: (sceneId: string, clipId: string) => void
  updateStickerClip: (sceneId: string, clipId: string, patch: Partial<Omit<StickerClip, 'id'>>) => void
  setTransition: (sceneId: string, spec: TransitionSpec | undefined) => void
  setClipAnim: (sceneId: string, spec: ClipAnimSpec | undefined) => void

  /**
   * 一键清空时间轴上的可见 clip —— 不动 scene 基础信息（title / media /
   * background / characterIds / locationId / durationMs / pos），
   * **也不动 branches[]**（它同时承担"剧情树拓扑"语义，清了会导致上游节点
   * 断线 —— 作者已反馈过这个回归）。
   *
   * 清理范围（v3.4）：
   *   - dialogue[]       （字幕 / 旁白）
   *   - qte              （QTE 规格，依附 shots 的节奏点）
   *   - shots[]          （镜头轨）
   *   - audio[]          （音频 clip）
   *   - keyShotId        （失效的代表镜引用，避免 UI 指向已删分镜）
   *   - sceneImages[]    （场景图像素材库 —— 作者视角"我上传的图"）
   *   - sceneVideos[]    （场景视频素材库 —— 作者视角"我上传的视频"）
   *
   * branches[] 虽然会在时间轴上以 choice pin 形式出现，但主语义是
   * 剧情树有向边，保留不动。
   * durationMs 保持不变 —— 清完后仍然是"一条空白轨道 = 该时长"，
   * 用户拖新素材进来不会突然被挤到 0。
   */
  clearSceneTimeline: (sceneId: string) => void

  /**
   * v3.3 · 修复"断链"——把 plan.entries 里的每条 (sceneId → targetSceneId)
   * 作为一条 auto 边补到源 scene.branches 末尾。
   *
   * 背景：早期 clearSceneTimeline 误清了 branches[] 导致剧情树断。
   * 当前代码已修但旧快照仍有脏数据，提供这个 action 让作者从画布一键修复。
   *
   * 约束（与 applyReconnectPlan 纯函数保持一致）：
   *   - 源 scene 已经有 branches 则跳过（幂等）
   *   - target 不存在则跳过
   *   - targetSceneId === null 视为"作者标为结局不连"跳过
   *   - 没有任何实际变更时不写 state（避免订阅抖动）
   */
  reconnectOrphans: (plan: ReconnectPlan) => void

  // ─── v3.2 · 场景级资产库（sceneImages / sceneVideos） ───────────
  /** 追加一个图像 mediaId 到场景图像库末尾（已存在则忽略，避免重复） */
  addSceneImage: (sceneId: string, mediaId: string) => void
  removeSceneImage: (sceneId: string, mediaId: string) => void
  reorderSceneImages: (sceneId: string, orderedIds: string[]) => void
  addSceneVideo: (sceneId: string, mediaId: string) => void
  removeSceneVideo: (sceneId: string, mediaId: string) => void
  reorderSceneVideos: (sceneId: string, orderedIds: string[]) => void

  /** 多类型提示词 patch；同时把 prompts.scene 同步写回 media.prompt 保持一致 */
  setScenePrompts: (sceneId: string, patch: Partial<ScenePrompts>) => void
  setSceneCharacterIds: (sceneId: string, ids: string[]) => void

  upsertCharacter: (c: Character) => void
  removeCharacter: (id: string) => void
  setCharacterRefImage: (id: string, refImageId: string | undefined) => void
  /** 设置角色三视图参考图（v2 新增；关键帧生图首选） */
  setCharacterTurnaroundRef: (id: string, turnaroundRefImageId: string | undefined) => void
  /**
   * 写入角色「试镜视频 + 音色样本」—— 角色定妆照流程 v7 新增。
   * 仅 patch 传入的字段（任一可单独更新）；传 undefined 不动该字段。
   */
  setCharacterAudition: (
    id: string,
    patch: { auditionVideoMediaId?: string; voiceSampleMediaId?: string },
  ) => void
  /**
   * P1-B · 设置角色大头照（headshot）锚点。
   * 同时按当前 visualStyle 推断并写入 realistic；缺 turnaround 时以大头照兜底，
   * 保证旧关键帧管线仍有可用的角色参考图。
   */
  setCharacterHeadshotRef: (id: string, headshotMediaId: string | undefined) => void
  /**
   * P1-B · 设置角色全身照（fullbody）锚点。
   * 全身照信息最全（体型 + 服化道），写入后优先作为 turnaround 兜底。
   */
  setCharacterFullbodyRef: (id: string, fullbodyMediaId: string | undefined) => void
  /**
   * v6.6 · 写入角色音色锚点。
   *
   * 入参：
   *   - id:     character.id
   *   - anchor: 完整或部分的 CharacterVoiceAnchor。
   *             undefined 或 { voiceType: '' } → 清空锚点，等于"取消音色绑定"。
   *
   * 不在锚点定义上做"voiceType 是否在 TTS_VOICE_PRESETS 内"的校验：
   *   未来支持自定义音色 / 私有 voiceType 时不破坏数据。UI 层做提示就好。
   */
  setCharacterVoiceAnchor: (
    id: string,
    anchor: import('./types').CharacterVoiceAnchor | undefined,
  ) => void

  /** 场所（v2） · 与 Scenario.locations 对应 */
  upsertLocation: (loc: Location) => void
  removeLocation: (id: string) => void
  setLocationRefImage: (id: string, refImageId: string | undefined) => void
  /** v3.6 · 追加或更新某个场所的角度参考图 */
  addLocationAngleRef: (locationId: string, angle: import('./types').LocationAngleRef) => void
  /** 删除某个场所的角度参考图（用于清理重复/不要的视角） */
  removeLocationAngleRef: (locationId: string, angleId: string) => void
  setSceneLocationId: (sceneId: string, locationId: string | undefined) => void
  /**
   * v6.7 · 写入场景背景音乐锚点。
   *
   * 入参：
   *   - sceneId：scene.id
   *   - anchor：完整或部分的 SceneBgmAnchor。
   *             undefined → 清空锚点，退回 Player 默认（无 BGM / 上一场延续）。
   *
   * 与 setCharacterVoiceAnchor 同构：
   *   - 传部分字段 → merge 到现有 sceneBgm；savedAt 默认刷成调用时间戳。
   *   - prompt 缺失或仅空白 → 视为清空（防止半新半旧的脏 brief）。
   *   - 不在这里二次校验 BGM 纪律 / forbidden 词；上游 sceneBgmComposer 已经做过。
   */
  setSceneBgm: (
    sceneId: string,
    anchor: import('./types').SceneBgmAnchor | undefined,
  ) => void

  /**
   * v3.10 · 角色外观状态变体 —— 追加或按 id 更新。
   *
   * 语义对齐 addLocationAngleRef：
   *   - id 已存在 → 整条替换（变体的 prompt/label/aliases/mediaId 全更新）
   *   - id 不存在 → 追加到末尾
   *
   * 用于 AssetPreviewDialog "添加为新变体" 选项与 ForgeWizard 角色卡的 + 按钮。
   * character 不存在时静默 no-op（保护剧本删过角色后的 stale UI 调用）。
   */
  addCharacterAppearanceVariant: (
    characterId: string,
    variant: import('./types').CharacterAppearanceVariant,
  ) => void
  /** v3.10 · 移除某角色的某个外观变体（按 variantId）。 */
  removeCharacterAppearanceVariant: (
    characterId: string,
    variantId: string,
  ) => void

  /** v3.10 · 道具状态变体 —— 追加或按 id 更新（同 addLocationAngleRef 语义）。 */
  addPropVariant: (
    propId: string,
    variant: import('./types').PropVariant,
  ) => void
  /** v3.10 · 移除某道具的某个状态变体（按 variantId）。 */
  removePropVariant: (propId: string, variantId: string) => void

  /**
   * v3.8.4 · 标/去除"此场景为真结局"。
   *
   * 语义：
   *   - `true`：把 scene.isEnding 写为 true
   *   - `false` / 省略：从 scene 上删除 isEnding 字段（shape 更干净）
   *
   * Player FIN 页据此区分：
   *   - 真结局 → "回到起点"
   *   - 断头（isEnding 未标但到了 FIN） → "换条路走"
   */
  setSceneIsEnding: (sceneId: string, isEnding: boolean) => void

  /** 关键道具（v3.7） · 与 Scenario.props 对应 */
  upsertProp: (p: Prop) => void
  removeProp: (id: string) => void
  setPropRefImage: (id: string, refImageId: string | undefined) => void

  /** 数值/变量（v6） · 与 Scenario.variables 对应（好感度 / flag / 积分） */
  upsertVariable: (v: GameVariable) => void
  removeVariable: (id: string) => void
  /** 背包系统(v7)：写入/更新一个物品定义。 */
  upsertItem: (item: import('./types').InventoryItem) => void
  /** 背包系统(v7)：删除一个物品定义。 */
  removeItem: (id: string) => void

  setUIStyle: (patch: Partial<UIStyle>) => void
  /**
   * 全局美术风格 —— 作者在 Forge Tab 一次选择，影响后续所有素材生成。
   * 传 undefined 相当于清除（回到默认 photoreal 语义）。
   */
  setVisualStyle: (style: VisualStyle | undefined) => void
  /**
   * 全局导演风格 —— 作者在 Forge「导演风格」分区选择，影响后续视频生成的
   * 运镜 / 剪辑节奏 / 色彩基调。传 undefined 清除（回到默认 persona）。
   */
  setDirectorStyle: (style: DirectorStyleId | undefined) => void
  /**
   * 模块开关 —— v7 新增。把某模块标记为启用/关闭(写入 scenario.modules)。
   * 关闭后生产/运行时会跳过该模块(见 scenario/moduleFlags.ts)。
   */
  setModuleEnabled: (moduleId: import('./types').ModuleId, enabled: boolean) => void
  /** 3D 相机调度：写入/更新一个 blockout（按 id 进 scenario.blockouts 注册表）。 */
  upsertBlockout: (blockout: Blockout) => void
  /** 3D 相机调度：删除一个 blockout，并清除指向它的所有 scene.blockoutRef。 */
  removeBlockout: (blockoutId: string) => void
  /** 3D 相机调度：把某场景的 blockoutRef 指向一个 blockout（或清除）。 */
  setSceneBlockoutRef: (sceneId: string, blockoutId: string | undefined) => void
  /**
   * 图像视图「小游戏选择池」开关 —— toggle 某个小游戏是否被预选。
   * 已在 enabledMinigameIds 里则移除，否则追加；后续剧情树剪辑据此过滤可选小游戏。
   */
  toggleEnabledMinigame: (minigameId: string) => void
  setVideoConfig: (patch: Partial<VideoConfig>) => void
  setOriginIdea: (idea: string) => void

  // ─── 小说家工作板（v5） ───────────────────────────────────────────
  /** 顶层梗概（作者层面，给玩家看 / 给 LLM 后续幕参考）。 */
  setSynopsis: (synopsis: string) => void
  /** 全量替换大纲；空数组 = 清空。LLM 锻造末段 / 作者手动整体重排都走这条。 */
  setOutline: (outline: import('./types').OutlineNode[]) => void
  /** 新增 / 更新单个大纲节点（按 id upsert，order 由调用方维护）。 */
  upsertOutlineNode: (node: import('./types').OutlineNode) => void
  /** 删除大纲节点（连带删除 parentId 指向它的子节点）。 */
  removeOutlineNode: (id: string) => void
  /** 全量替换关系（导入 / LLM 末段产出走这条）。 */
  setCharacterRelations: (relations: import('./types').CharacterRelation[]) => void
  /** 新增 / 更新单条关系（按 id upsert）。 */
  upsertCharacterRelation: (relation: import('./types').CharacterRelation) => void
  /** 删除单条关系。 */
  removeCharacterRelation: (id: string) => void

  // ─── Episode 相关（v4） ──────────────────────────────────────────
  /**
   * 新增一个剧集，自动追加到末尾（order = max+1）。
   * rootSceneId 必须是当前 scenario.scenes 中已存在的 scene id。
   */
  addEpisode: (ep: Omit<Episode, 'order' | 'createdAt'>) => void
  /**
   * 兜底：若当前剧本没有任何剧集，建默认「第一集」并把所有未分集的场景收纳进去。
   * 幂等（已有剧集则什么都不做）。给历史遗留(sv≥4 却缺 episodes)的剧本一键找回剧集。
   */
  ensureDefaultEpisode: () => void
  /** 更新剧集元数据（title / synopsis / rootSceneId）。 */
  updateEpisode: (id: string, patch: Partial<Pick<Episode, 'title' | 'synopsis' | 'rootSceneId'>>) => void
  /** 删除一个剧集（scenes 不连坐删除，仅解除 episodeId 绑定变成"未分集"）。 */
  removeEpisode: (id: string) => void
  /** 拖排：交换两集的 order 值，重新整理顺序。 */
  reorderEpisodes: (orderedIds: string[]) => void
  /**
   * 追加一批新场景到指定剧集。
   *
   * 用于 Forge 续写下一集时：LLM 返回 { episode, scenes, newCharacters }，
   * 由此 action 一口气写入 scenario。
   *   - episode 为新集元数据（若同 id 已存在则 upsert）
   *   - scenes  追加到 scenario.scenes，全部打上 episodeId
   *   - newCharacters 合并到 scenario.characters
   */
  adoptForgedEpisode: (payload: {
    episode: Episode
    scenes: Record<string, Scene>
    newCharacters?: Record<string, Character>
  }) => void
  /** 把场景移到指定剧集（更改 scene.episodeId）。 */
  setSceneEpisode: (sceneId: string, episodeId: string) => void
  /** 写入作者拖拽落点 */
  setScenePos: (sceneId: string, pos: { x: number; y: number }) => void
  /**
   * 一次性把多个场景的当前位置写进 scene.pos —— 用于"开始拖动时冻结其他所有节点"。
   *
   * 为什么存在这个 action：
   *   如果作者只 setScenePos('A')，A 变成 pinned、其他人还是 dynamic；下一次重算
   *   布局时 dagre 看到 A 被移出图、剩余拓扑不同，会给其他节点一套微不同的坐标
   *   —— 视觉上就是"拖一个节点，其他节点全跳了"。把所有节点一口气 pin 住，dagre
   *   就不会再碰任何人，作者拖谁就只动谁。
   *
   * 只给尚未有 pos 的 scene 写入；已 pin 过的不改，避免把当前的坐标刷回画布上某些
   * 正在动画中的残影位置。
   */
  pinAllScenePositions: (
    positions: Record<string, { x: number; y: number }>,
  ) => void
  /** 新增场景，可选自动从来源场景挂一条分支 */
  addScene: (
    scene: Scene,
    options?: { linkFrom?: { sceneId: string; kind: Branch['kind']; label?: string } },
  ) => void
  /**
   * 删除场景：
   *   - 禁止删 rootSceneId
   *   - 同时清掉任何指向它的 branch
   *   - 若被删的场景是 selectedSceneId，自动选回 root
   */
  removeScene: (sceneId: string) => void
  /** 改某条 branch 的目标场景；newTarget 不存在时整笔操作被拒绝 */
  relinkBranch: (
    sceneId: string,
    branchId: string,
    newTargetSceneId: string,
  ) => void
  /**
   * 清掉所有 scene.pos，把布局完全交回 dagre 自动算。
   * 实现细节：扫一遍场景表，发现至少一个 pos 才会更新；空操作下 zundo 不入栈。
   */
  resetLayout: () => void

  // ─── 长文本分段管线（id: p3-store） ──────────────────────────────
  /**
   * 启动新的流式批次：清旧 streaming，写新的 batchId + startedAt。
   *
   * 调用时机：actBatchPipeline 启动前（无论是否有 chunked 路径）。
   * 同一作者点两次"解析"也只保留最新批次 —— 老批次的回调到来时 batchId 不匹配会被丢弃。
   */
  startStreamingBatch: (batchId: string) => void

  /**
   * 把一个 Act 的"空骨架"插入 scenario.scenes：
   *   - 每个 SkeletonNode → 最小合法 Scene（PLACEHOLDER media、空 dialogue/branches）
   *   - 同 Act 内 N 个节点串成 auto 链：node[0] → node[1] → … → node[N-1]
   *   - 跨 Act 串：linkFromSceneId 命中时自动从上 Act 末尾节点挂 auto 边到 node[0]
   *   - streaming.acts 追加该 act 的 meta（status='queued'）
   *   - streaming.nodeStatus[*] = 'skeleton'
   *
   * 幂等：同一 actId 重复 append 直接被忽略（只有"在新批次里 reset 后再 append"才生效）。
   *
   * 关键不变量：rootSceneId 不动 —— 由 adoptForgedScenario / 流水线总收尾负责对齐。
   * 这里只做"把骨架插入存量 scenes 表"的事，避免管线中途切换 root 让 Player 跳屏。
   */
  appendActProgressive: (act: ActSkeleton) => void

  /**
   * Patch 单节点的 prompts，并把 streaming.nodeStatus[sceneId] 升迁到 'prompts-ready'。
   *
   * 行为契约：
   *   - 调用 setScenePrompts 同效果（prompts.scene 同步写回 media.prompt）
   *   - sceneId 不存在时 no-op（新批次的回调到来但 scene 已被换掉的兜底）
   *   - nodeStatus 单调升迁 —— 已经是 'assets-ready' 的不会被回退到 'prompts-ready'
   */
  patchNodePrompts: (sceneId: string, prompts: Partial<ScenePrompts>) => void

  /**
   * 把节点状态升迁到 'assets-ready'（关键帧/视频/音频已就绪）。
   * 通常由批量生图/生视频流水线在节点全员素材就绪时调用。
   * sceneId 不在 streaming 里 → no-op；状态已 'assets-ready' → no-op。
   */
  markNodeAssetsReady: (sceneId: string) => void

  /**
   * Patch 单 Act 的状态。常见用法：
   *   - 'forging'：actBatchPipeline 开始为这 Act 调 batch-prompt-trio
   *   - 'ready'  ：所有节点 prompts-ready 后由调用方收尾
   *   - 'failed' ：act 级 LLM 失败 → errorReason 给 UI 提示
   * actId 不存在 → no-op。
   */
  setStreamingActStatus: (
    actId: string,
    status: StreamingActStatus,
    errorReason?: string,
  ) => void

  /**
   * 流水线收尾：把 streaming 复位为 null（Player 退出 skeleton/streaming 装饰）。
   * loadScenario / adoptForgedScenario 会自动调它，不需要 UI 显式触发。
   */
  clearStreamingState: () => void

  /**
   * 应用一组 RFC 6902 JSON Patch 到 scenario。
   *
   * 设计目的：
   *   - **Forge 模块化管线** 里 LLM/控件双通道吐 patch（角色改名、场景顺序调整、
   *     台词替换…），这里是统一入口，保证 zundo 入栈一笔即可整体回滚。
   *   - patch 抛错（路径不存在、test 失败等）则整批回滚 —— `scenario` 字段引用
   *     不变，调用方拿到 `applied: false` 和 `error`，UI 可以提示。
   *   - 不通过 `set` 显式赋值时，**zundo 就不会把这次失败入栈**，符合"语义化原子"。
   *
   * 注意：`scenario` 经过 sanitize 一遍 —— patch 来自 LLM/外部时不能让 secrets
   * 或非法 schema 偷偷落到磁盘。
   */
  applyPatches: (patches: readonly import('./jsonPatch').JsonPatchOp[]) => {
    applied: boolean
    error?: { opIndex: number; message: string }
  }
}

/**
 * zundo 历史栈配置 ——
 *   - partialize：只追踪 `scenario` 一字段；其它（mode/selectedSceneId/selection）属
 *     UI 偏好，进栈反而会污染撤销体验（每次切关卡都被记一笔）
 *   - limit 50：编辑器场景 50 步足够回到上轮 idea，再多就让作者用「导出 JSON」备份
 *   - 没有 handleSet debounce：每个 store action 都已是"语义化原子操作"，
 *     拖拽时由 UI 层主动 pause()/resume() 合并为一笔提交
 */
export const useScenarioStore = create<ScenarioStore>()(
  temporal(
    (set, get) => ({
  scenario: migrateScenarioToLatest(getDemoScenario()),
  mode: 'editor',
  selectedSceneId: 'intro',
  selection: { kind: 'scene', sceneId: 'intro' },
  streaming: null,

  setMode: (mode) => {
    // 幂等：同值不写，避免无意义 store 通知。
    if (get().mode === mode) return
    set({ mode })
  },
  selectScene: (sceneId) => {
    // 幂等：已经选中同一 scene 时**绝不**再 set —— 否则每次调用都生成一个全新的
    // `selection` 对象并发一次 store 通知（即便 selectedSceneId 没变）。
    // SceneDetailDrawer 在挂载 effect 里无条件调用 selectScene(sceneId)，配合
    // React StrictMode 的 effect 重放，会把这条无意义通知放大成
    // flushPassiveEffects → setState → 再 commit → 再 flushPassiveEffects 的
    // 嵌套更新风暴（控制台报 scenarioStore.ts 这行的「Maximum update depth」）。
    const s = get()
    if (
      s.selectedSceneId === sceneId &&
      s.selection?.kind === 'scene' &&
      s.selection.sceneId === sceneId
    ) {
      return
    }
    set({ selectedSceneId: sceneId, selection: { kind: 'scene', sceneId } })
  },
  setSelection: (selection) => set({ selection }),

  loadScenario: (s) => {
    // 先跑 schema 迁移（v1 → v2），再过 sanitize（剥 secrets）。
    // 顺序很重要：迁移后字段形状稳定，sanitize 只需处理最新版字段。
    const migrated = migrateScenarioToLatest(s)
    const sanitized = sanitizeScenarioForIO(migrated)
    // rootSceneId 可能因数据损坏而指向不存在的 key — fallback 到第一个 scene
    const rootId =
      sanitized.scenes[sanitized.rootSceneId] ? sanitized.rootSceneId
        : Object.keys(sanitized.scenes)[0] ?? sanitized.rootSceneId
    set({
      scenario: sanitized,
      selectedSceneId: rootId,
      selection: { kind: 'scene', sceneId: rootId },
      streaming: null,
    })
  },
  applyExternalScenario: (s) =>
    set((state) => {
      // 当前选中的 scene 若被对端删掉, 落回 root; 否则保持选中态不动 (避免对端
      // 每次增删都把本端光标弹回起点).
      const curSel = state.selectedSceneId
      const stillExists = curSel ? Boolean(s.scenes[curSel]) : false
      const nextSel = stillExists
        ? curSel
        : s.scenes[s.rootSceneId]
          ? s.rootSceneId
          : Object.keys(s.scenes)[0] ?? curSel
      return {
        scenario: s,
        selectedSceneId: nextSel,
        selection: nextSel
          ? { kind: 'scene', sceneId: nextSel }
          : state.selection,
      }
    }),
  adoptForgedScenario: (next, opts) => {
    /*
     * 把 forge 产出的 scenario 挂进 store。两种 mode (见 interface 注释):
     *
     *   replace-current (默认): 保留 current.id, 内容字段全替换
     *     - 适用: 用户在已有剧本上让 AI 优化/重写
     *     - persist 订阅识别为"当前条目内容更新", 不冒新历史项
     *
     *   create-new: 用 next.id (若自带且非空), 否则生成新 scn-<ts>
     *     - 适用: 内置 demo / 空白上从零锻造一个全新剧本
     *     - 旧 demo / 旧剧本保留在 PersistedDb.items[] 不被覆盖
     *     - assetStore 的 scenarioId 命名空间也独立, 不会污染
     *
     * 注意: 不在这里调 newScenario / loadScenario, 因为我们要走和 v6.7 完全
     * 一致的 sanitize/migrate 流水, 只是把 id 决定权交回调用方。
     */
    const mode = opts?.mode ?? 'replace-current'
    const current = get().scenario
    const migrated = migrateScenarioToLatest(next)
    let nextId: string
    if (mode === 'create-new') {
      // 优先沿用 next 自带的 id (forge LLM 自己生成的, 通常是 scn-xxx);
      // 没有则按 makeBlankScenario 同款规则生成一个新的, 保证唯一不冲突。
      const incoming = (migrated.id ?? '').trim()
      if (incoming && incoming !== current.id) {
        nextId = incoming
      } else {
        // 同 makeBlankScenario: 加随机后缀防同毫秒撞 id
        nextId = `scn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      }
    } else {
      nextId = current.id
    }
    const adopted: Scenario = {
      ...migrated,
      id: nextId,
    }
    set({
      scenario: sanitizeScenarioForIO(adopted),
      selectedSceneId: adopted.rootSceneId,
      selection: { kind: 'scene', sceneId: adopted.rootSceneId },
      // adopt 等于"流式管线最终落地" —— streaming 状态使命完成，复位
      streaming: null,
    })
  },
  newScenario: (opts) => {
    /*
     * "➕ 新的故事" —— 切换到一份干净的空白剧本。
     *
     * 归档：persistBoot 已经订阅 scenario 变化会自动 upsert 到 localStorage，
     *       所以这里不用自己写库；新 scenario.id 进去 = 旧 id 自动留在历史里。
     *
     * 场景图 cache 清理：不在这里直接 clear（会产生模块级循环依赖
     *   scenarioStore → sceneImageCache → scenarioStore）。
     *   改由 media/sceneCacheReset 模块在 App boot 时挂订阅，
     *   监听 scenario.id 变化触发 clear。
     */
    const blank = makeBlankScenario({ title: opts?.title })
    get().loadScenario(blank)
  },
  // 防御纵深 #2：导出 JSON 永远是"公开版本"——apiKey/apiBase 不会落盘
  exportJSON: () => JSON.stringify(sanitizeScenarioForIO(get().scenario), null, 2),
  importJSON: (raw) => {
    try {
      const parsed = JSON.parse(raw) as Scenario
      if (!parsed?.rootSceneId || !parsed.scenes) return 'invalid scenario shape'
      // 防御纵深 #3：导入他人剧本时也清一遍，防止恶意 endpoint 注入
      get().loadScenario(sanitizeScenarioForIO(parsed))
      return null
    } catch (e) {
      return (e as Error).message
    }
  },

  updateScene: (sceneId, patch) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({ ...scene, ...patch }))),

  updateDialogue: (sceneId, dialogueId, patch) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        dialogue: scene.dialogue.map((d) =>
          d.id === dialogueId ? { ...d, ...patch } : d,
        ),
      })),
    ),

  addDialogue: (sceneId, line) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        dialogue: [
          ...scene.dialogue,
          placeDialogueNonOverlap(scene.dialogue, line, scene.durationMs),
        ],
      })),
    ),

  removeDialogue: (sceneId, dialogueId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        dialogue: scene.dialogue.filter((d) => d.id !== dialogueId),
      })),
    ),

  removeEmptyDialogue: (sceneId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        dialogue: scene.dialogue.filter((d) => (d.text ?? '').trim() !== ''),
      })),
    ),

  updateQTECue: (sceneId, cueId, patch) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => {
        if (!scene.qte) return scene
        return {
          ...scene,
          qte: {
            ...scene.qte,
            cues: scene.qte.cues.map((c) =>
              c.id === cueId ? { ...c, ...patch } : c,
            ),
          },
        }
      }),
    ),

  addQTECue: (sceneId, cue) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        qte: scene.qte
          ? { ...scene.qte, cues: [...scene.qte.cues, cue] }
          : {
              cues: [cue],
              window: { perfect: 80, great: 160, good: 280 },
              score: { perfect: 100, great: 60, good: 25, miss: -30 },
            },
      })),
    ),

  removeQTECue: (sceneId, cueId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => {
        if (!scene.qte) return scene
        return {
          ...scene,
          qte: {
            ...scene.qte,
            cues: scene.qte.cues.filter((c) => c.id !== cueId),
          },
        }
      }),
    ),

  setQTESpec: (sceneId, spec) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({ ...scene, qte: spec }))),

  updateBranch: (sceneId, branchId, patch) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        branches: scene.branches.map((b) =>
          b.id === branchId ? { ...b, ...patch } : b,
        ),
      })),
    ),

  addBranch: (sceneId, branch) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        branches: [...scene.branches, branch],
      })),
    ),

  removeBranch: (sceneId, branchId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        branches: scene.branches.filter((b) => b.id !== branchId),
      })),
    ),

  setScenePrompt: (sceneId, prompt) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        media: { ...scene.media, kind: 'IMAGE_PROMPT', prompt },
      })),
    ),

  setSceneMediaRef: (sceneId, media) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        media: { ...scene.media, ...media },
      })),
    ),

  setSceneShotKeyframe: (sceneId, shotId, mediaRef) =>
    set((s) => {
      const scene = s.scenario.scenes[sceneId]
      if (!scene) return {}
      const shots = scene.shots ?? []
      const idx = shots.findIndex((sh) => sh.id === shotId)
      if (idx === -1) return {}
      const currentShot = shots[idx]!
      const nextShots = shots.slice()
      nextShots[idx] = { ...currentShot, keyframeMediaRef: mediaRef }
      const keyShotId = scene.keyShotId ?? shots[0]?.id
      const isKeyShot = shotId === keyShotId
      return {
        scenario: {
          ...s.scenario,
          scenes: {
            ...s.scenario.scenes,
            [sceneId]: {
              ...scene,
              shots: nextShots,
              media: isKeyShot
                ? { ...scene.media, ref: mediaRef }
                : scene.media,
            },
          },
        },
      }
    }),

  updateShot: (sceneId, shotId, patch) =>
    set((s) => {
      const scene = s.scenario.scenes[sceneId]
      if (!scene) return {}
      const shots = scene.shots ?? []
      const idx = shots.findIndex((sh) => sh.id === shotId)
      if (idx === -1) return {}
      const currentShot = shots[idx]!
      const nextShots = shots.slice()
      nextShots[idx] = { ...currentShot, ...patch }
      return {
        scenario: {
          ...s.scenario,
          scenes: {
            ...s.scenario.scenes,
            [sceneId]: { ...scene, shots: nextShots },
          },
        },
      }
    }),

  addShot: (sceneId, seed, insertAfterShotId) => {
    let newId: string | null = null
    set((s) => {
      const scene = s.scenario.scenes[sceneId]
      if (!scene) return {}
      const shots = scene.shots ?? []
      newId = makeShotId(sceneId, shots)
      const insertIdx = (() => {
        if (!insertAfterShotId) return shots.length
        const i = shots.findIndex((sh) => sh.id === insertAfterShotId)
        return i === -1 ? shots.length : i + 1
      })()
      const shot: Shot = {
        id: newId,
        order: 0,
        framing: seed?.framing ?? 'medium',
        prompt: seed?.prompt ?? '',
        cameraHint: seed?.cameraHint,
        startMs: seed?.startMs,
        endMs: seed?.endMs,
        characterIds: seed?.characterIds,
        keyframeMediaRef: undefined,
        transitionHint: seed?.transitionHint,
      }
      const next = shots.slice()
      next.splice(insertIdx, 0, shot)
      // 重算 order —— 0..n-1 连续
      const reindexed = next.map((sh, i) => ({ ...sh, order: i }))
      return {
        scenario: {
          ...s.scenario,
          scenes: {
            ...s.scenario.scenes,
            [sceneId]: { ...scene, shots: reindexed },
          },
        },
      }
    })
    return newId
  },

  removeShot: (sceneId, shotId) =>
    set((s) => {
      const scene = s.scenario.scenes[sceneId]
      if (!scene) return {}
      const shots = scene.shots ?? []
      if (!shots.some((sh) => sh.id === shotId)) return {}
      const filtered = shots
        .filter((sh) => sh.id !== shotId)
        .map((sh, i) => ({ ...sh, order: i }))
      const keyFallback =
        scene.keyShotId === shotId ? filtered[0]?.id : scene.keyShotId
      return {
        scenario: {
          ...s.scenario,
          scenes: {
            ...s.scenario.scenes,
            [sceneId]: {
              ...scene,
              shots: filtered,
              keyShotId: keyFallback,
            },
          },
        },
      }
    }),

  splitShot: (sceneId, shotId, atMs) => {
    let newId: string | null = null
    set((s) => {
      const scene = s.scenario.scenes[sceneId]
      if (!scene) return {}
      const shots = scene.shots ?? []
      const idx = shots.findIndex((sh) => sh.id === shotId)
      if (idx === -1) return {}
      const shot = shots[idx]!
      const total = scene.durationMs
      const startMs = shot.startMs ?? Math.round(((shot.order) * total) / shots.length)
      const endMs = shot.endMs ?? Math.round((((shot.order) + 1) * total) / shots.length)
      if (atMs <= startMs + 1 || atMs >= endMs - 1) return {}
      const leftShot: Shot = { ...shot, startMs, endMs: atMs }
      newId = makeShotId(sceneId, shots)
      const rightShot: Shot = {
        ...shot,
        id: newId,
        startMs: atMs,
        endMs,
        // 分出来的后半段不继承关键帧（它是新镜，等作者或 batch 生图）
        keyframeMediaRef: undefined,
        // prompt 保留 —— 作者通常会在新段编辑；transitionHint 传给后段也合理
      }
      const next = shots.slice()
      next.splice(idx, 1, leftShot, rightShot)
      const reindexed = next.map((sh, i) => ({ ...sh, order: i }))
      return {
        scenario: {
          ...s.scenario,
          scenes: {
            ...s.scenario.scenes,
            [sceneId]: { ...scene, shots: reindexed },
          },
        },
      }
    })
    return newId
  },

  compactShotsLeft: (sceneId) =>
    set((s) => {
      const scene = s.scenario.scenes[sceneId]
      if (!scene) return {}
      const shots = scene.shots ?? []
      if (shots.length === 0) return {}
      const total = scene.durationMs
      // 每段 duration 取显式 endMs-startMs；缺省时均分 total
      const fallback = Math.max(1, Math.floor(total / shots.length))
      const sorted = shots.slice().sort((a, b) => a.order - b.order)
      let cursor = 0
      const next = sorted.map((sh, i) => {
        const has = typeof sh.startMs === 'number' && typeof sh.endMs === 'number'
        const dur = has
          ? Math.max(1, (sh.endMs ?? 0) - (sh.startMs ?? 0))
          : fallback
        const start = cursor
        const end = Math.min(total, cursor + dur)
        cursor = end
        return { ...sh, order: i, startMs: start, endMs: end }
      })
      return {
        scenario: {
          ...s.scenario,
          scenes: {
            ...s.scenario.scenes,
            [sceneId]: { ...scene, shots: next },
          },
        },
      }
    }),

  // ─── 音频 ─────────────────────────────────────────────────
  addAudioClip: (sceneId, clip) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        audio: [...(scene.audio ?? []), clip],
      })),
    ),

  removeAudioClip: (sceneId, clipId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        audio: (scene.audio ?? []).filter((c) => c.id !== clipId),
      })),
    ),

  updateAudioClip: (sceneId, clipId, patch) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        audio: (scene.audio ?? []).map((c) =>
          c.id === clipId ? { ...c, ...patch } : c,
        ),
      })),
    ),

  splitAudioClip: (sceneId, clipId, atMs) => {
    let newId: string | null = null
    set((s) => {
      const scene = s.scenario.scenes[sceneId]
      if (!scene) return {}
      const clips = scene.audio ?? []
      const idx = clips.findIndex((c) => c.id === clipId)
      if (idx === -1) return {}
      const clip = clips[idx]!
      const start = clip.startMs
      const end = clip.startMs + clip.durationMs
      if (atMs <= start + 1 || atMs >= end - 1) return {}
      const leftDur = atMs - start
      const rightDur = end - atMs
      newId = makeAudioClipId(clips)
      const left: AudioClip = { ...clip, durationMs: leftDur }
      const right: AudioClip = {
        ...clip,
        id: newId,
        startMs: atMs,
        durationMs: rightDur,
        // 源素材入点顺延 —— 保证左右两半合在一起就是原 clip
        offsetMs: (clip.offsetMs ?? 0) + leftDur,
      }
      const next = clips.slice()
      next.splice(idx, 1, left, right)
      return {
        scenario: {
          ...s.scenario,
          scenes: {
            ...s.scenario.scenes,
            [sceneId]: { ...scene, audio: next },
          },
        },
      }
    })
    return newId
  },

  compactAudioLeft: (sceneId, role) =>
    set((s) => {
      const scene = s.scenario.scenes[sceneId]
      if (!scene) return {}
      const clips = scene.audio ?? []
      if (clips.length === 0) return {}
      const groups = new Map<string, AudioClip[]>()
      for (const c of clips) {
        if (role && c.role !== role) {
          groups.set('__pin_' + c.id, [c])
          continue
        }
        const k = c.role
        const arr = groups.get(k) ?? []
        arr.push(c)
        groups.set(k, arr)
      }
      const next: AudioClip[] = []
      for (const [, arr] of groups) {
        arr.sort((a, b) => a.startMs - b.startMs)
        let cursor = 0
        for (const c of arr) {
          next.push({ ...c, startMs: cursor })
          cursor += c.durationMs
        }
      }
      return {
        scenario: {
          ...s.scenario,
          scenes: {
            ...s.scenario.scenes,
            [sceneId]: { ...scene, audio: next },
          },
        },
      }
    }),

  // ─── 小游戏 ──────────────────────────────────────────────
  addMinigameClip: (sceneId, clip) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        minigames: [...(scene.minigames ?? []), clip],
      })),
    ),

  removeMinigameClip: (sceneId, clipId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        minigames: (scene.minigames ?? []).filter((c) => c.id !== clipId),
      })),
    ),

  updateMinigameClip: (sceneId, clipId, patch) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        minigames: (scene.minigames ?? []).map((c) =>
          c.id === clipId ? { ...c, ...patch } : c,
        ),
      })),
    ),

  addTextOverlay: (sceneId, clip) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        textOverlays: [...(scene.textOverlays ?? []), clip],
      })),
    ),

  removeTextOverlay: (sceneId, clipId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        textOverlays: (scene.textOverlays ?? []).filter((c) => c.id !== clipId),
      })),
    ),

  updateTextOverlay: (sceneId, clipId, patch) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        textOverlays: (scene.textOverlays ?? []).map((c) =>
          c.id === clipId ? { ...c, ...patch } : c,
        ),
      })),
    ),

  addSearchSegment: (sceneId, clip) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        searchSegments: [...(scene.searchSegments ?? []), clip],
      })),
    ),

  removeSearchSegment: (sceneId, clipId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        searchSegments: (scene.searchSegments ?? []).filter((c) => c.id !== clipId),
      })),
    ),

  updateSearchSegment: (sceneId, clipId, patch) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        searchSegments: (scene.searchSegments ?? []).map((c) =>
          c.id === clipId ? { ...c, ...patch } : c,
        ),
      })),
    ),

  // ─── v8 · 后期效果 clip CRUD ──────────────────────────────────────
  addFilterClip: (sceneId, clip) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, filterClips: [...(scene.filterClips ?? []), clip],
    }))),
  removeFilterClip: (sceneId, clipId) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, filterClips: (scene.filterClips ?? []).filter((c) => c.id !== clipId),
    }))),
  updateFilterClip: (sceneId, clipId, patch) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, filterClips: (scene.filterClips ?? []).map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    }))),

  addAdjustClip: (sceneId, clip) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, adjustClips: [...(scene.adjustClips ?? []), clip],
    }))),
  removeAdjustClip: (sceneId, clipId) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, adjustClips: (scene.adjustClips ?? []).filter((c) => c.id !== clipId),
    }))),
  updateAdjustClip: (sceneId, clipId, patch) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, adjustClips: (scene.adjustClips ?? []).map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    }))),

  addEffectClip: (sceneId, clip) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, effectClips: [...(scene.effectClips ?? []), clip],
    }))),
  removeEffectClip: (sceneId, clipId) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, effectClips: (scene.effectClips ?? []).filter((c) => c.id !== clipId),
    }))),
  updateEffectClip: (sceneId, clipId, patch) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, effectClips: (scene.effectClips ?? []).map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    }))),

  addStickerClip: (sceneId, clip) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, stickerClips: [...(scene.stickerClips ?? []), clip],
    }))),
  removeStickerClip: (sceneId, clipId) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, stickerClips: (scene.stickerClips ?? []).filter((c) => c.id !== clipId),
    }))),
  updateStickerClip: (sceneId, clipId, patch) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({
      ...scene, stickerClips: (scene.stickerClips ?? []).map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    }))),

  setTransition: (sceneId, spec) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({ ...scene, transition: spec }))),
  setClipAnim: (sceneId, spec) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({ ...scene, clipAnim: spec }))),

  clearSceneTimeline: (sceneId) =>
    set((s) => {
      const scene = s.scenario.scenes[sceneId]
      if (!scene) return {}
      // 已经全空 —— 不产生新引用，避免无意义的订阅抖动
      //
      // v3.9.4（作者明确需求反转）：
      //   sceneImages / sceneVideos 是"我上传/生成过的历史素材"，是作者资产，
      //   清空时间轴时**不再一起清**。作者只想抹掉"摆在时间轴上的 clip"，
      //   素材库的历史保留，可以再拖入时间轴复用。
      //
      //   → isEmpty 判定不再看素材库；
      //   → cleared 里也不清 sceneImages / sceneVideos。
      //
      // v3.9.2：把 scene.media.kind==='VIDEO' 也算进"非空"判定，
      //         否则只拖过视频、别的都没改时，「清空」按钮点了没反应。
      const isEmpty =
        (scene.dialogue?.length ?? 0) === 0 &&
        !scene.qte &&
        (scene.shots?.length ?? 0) === 0 &&
        (scene.audio?.length ?? 0) === 0 &&
        !scene.keyShotId &&
        (scene.minigames?.length ?? 0) === 0 &&
        scene.media.kind !== 'VIDEO'
      if (isEmpty) return {}
      // 注意：branches[] **不清** —— 它同时承担"剧情树拓扑"语义
      // （当前 scene → 下游 scene 的边）。清空时间轴只是把"本场戏内的
      // 字幕 / QTE / 镜头 / 音频" 抹掉，不应断开剧情树连线。
      // 作者反馈过：清空后前面节点线变两行了，就是因为之前把 branches[] 也清了。
      const cleared: typeof scene = {
        ...scene,
        dialogue: [],
        shots: [],
        audio: [],
        minigames: [],
        // v3.9.4：sceneImages / sceneVideos **保留**（作者意图见上文）。
      }
      // qte / keyShotId 是可选字段 —— 删除 key 而不是置 undefined，
      // 让序列化 JSON 更干净，和 schemaMigrate 的缺省语义一致
      delete cleared.qte
      delete cleared.keyShotId
      /*
       * v3.9.2 · VIDEO 媒体在「清空」语义里必须一起清。
       *
       * 作者视角：VIDEO 轨上的蓝条就是时间轴上一条 clip，"清空时间轴"
       * 肯定要把它一起抹掉。之前不动 scene.media → UI 上 VIDEO 蓝条依然
       * 保留，作者反馈"清了没反应"。
       *
       * IMAGE_PROMPT / IMAGE_STATIC 留着 —— 它们是作者生的底图，不是
       * 时间轴产物；清空按钮的初衷只清时间轴层，不动底图。
       */
      if (scene.media.kind === 'VIDEO') {
        cleared.media = { kind: 'PLACEHOLDER' }
        delete cleared.videoOffsetMs
        delete cleared.videoClipDurationMs
        delete cleared.videoNaturalDurationMs
      }
      return {
        scenario: {
          ...s.scenario,
          scenes: {
            ...s.scenario.scenes,
            [sceneId]: cleared,
          },
        },
      }
    }),

  reconnectOrphans: (plan) =>
    set((s) => {
      const next = applyReconnectPlan(s.scenario, plan)
      if (next === s.scenario) return {}
      return { scenario: next }
    }),

  // ─── v3.2 · 场景级资产库 ─────────────────────────────────
  addSceneImage: (sceneId, mediaId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => {
        const cur = scene.sceneImages ?? []
        if (cur.includes(mediaId)) return scene
        return { ...scene, sceneImages: [...cur, mediaId] }
      }),
    ),
  removeSceneImage: (sceneId, mediaId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        sceneImages: (scene.sceneImages ?? []).filter((x) => x !== mediaId),
      })),
    ),
  reorderSceneImages: (sceneId, orderedIds) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => {
        const cur = scene.sceneImages ?? []
        // 保留只在 orderedIds 中且在原列表中存在的 id，过滤脏数据
        const set = new Set(cur)
        const next = orderedIds.filter((id) => set.has(id))
        return { ...scene, sceneImages: next }
      }),
    ),
  addSceneVideo: (sceneId, mediaId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => {
        const cur = scene.sceneVideos ?? []
        if (cur.includes(mediaId)) return scene
        return { ...scene, sceneVideos: [...cur, mediaId] }
      }),
    ),
  removeSceneVideo: (sceneId, mediaId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({
        ...scene,
        sceneVideos: (scene.sceneVideos ?? []).filter((x) => x !== mediaId),
      })),
    ),
  reorderSceneVideos: (sceneId, orderedIds) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => {
        const cur = scene.sceneVideos ?? []
        const set = new Set(cur)
        const next = orderedIds.filter((id) => set.has(id))
        return { ...scene, sceneVideos: next }
      }),
    ),

  setScenePrompts: (sceneId, patch) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => {
        const next: ScenePrompts = {
          scene: scene.media.prompt ?? '',
          ...(scene.prompts ?? {}),
          ...patch,
        }
        return {
          ...scene,
          prompts: next,
          // 把 prompts.scene 视作 media.prompt 的同源
          media: { ...scene.media, prompt: next.scene },
        }
      }),
    ),

  setSceneCharacterIds: (sceneId, ids) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({ ...scene, characterIds: ids })),
    ),

  upsertCharacter: (c) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        characters: { ...(s.scenario.characters ?? {}), [c.id]: c },
      },
    })),

  removeCharacter: (id) =>
    set((s) => {
      const cs = { ...(s.scenario.characters ?? {}) }
      delete cs[id]
      // 同时把所有 scene 里引用清掉
      const nextScenes: Record<string, Scene> = {}
      for (const [sid, scene] of Object.entries(s.scenario.scenes)) {
        nextScenes[sid] = {
          ...scene,
          characterIds: scene.characterIds?.filter((x) => x !== id),
        }
      }
      return {
        scenario: {
          ...s.scenario,
          characters: cs,
          scenes: nextScenes,
        },
      }
    }),

  setCharacterRefImage: (id, refImageId) =>
    set((s) => {
      const ch = s.scenario.characters?.[id]
      if (!ch) return {}
      return {
        scenario: {
          ...s.scenario,
          characters: {
            ...s.scenario.characters!,
            [id]: { ...ch, refImageId },
          },
        },
      }
    }),

  setCharacterTurnaroundRef: (id, turnaroundRefImageId) =>
    set((s) => {
      const ch = s.scenario.characters?.[id]
      if (!ch) return {}
      return {
        scenario: {
          ...s.scenario,
          characters: {
            ...s.scenario.characters!,
            [id]: { ...ch, turnaroundRefImageId },
          },
        },
      }
    }),

  setCharacterAudition: (id, patch) =>
    set((s) => {
      const ch = s.scenario.characters?.[id]
      if (!ch) return {}
      const next = { ...ch }
      if (patch.auditionVideoMediaId !== undefined)
        next.auditionVideoMediaId = patch.auditionVideoMediaId
      if (patch.voiceSampleMediaId !== undefined)
        next.voiceSampleMediaId = patch.voiceSampleMediaId
      return {
        scenario: {
          ...s.scenario,
          characters: { ...s.scenario.characters!, [id]: next },
        },
      }
    }),

  setCharacterHeadshotRef: (id, headshotMediaId) =>
    set((s) => {
      const ch = s.scenario.characters?.[id]
      if (!ch) return {}
      // 写实判定：photoreal（或未设风格，默认 photoreal）→ realistic
      const vs = s.scenario.visualStyle
      const realistic = vs === undefined || vs === 'photoreal'
      return {
        scenario: {
          ...s.scenario,
          characters: {
            ...s.scenario.characters!,
            [id]: {
              ...ch,
              headshotMediaId,
              realistic,
              // 缺 turnaround 时用大头照兜底，旧关键帧管线仍有角色参考
              turnaroundRefImageId: ch.turnaroundRefImageId ?? headshotMediaId,
            },
          },
        },
      }
    }),

  setCharacterFullbodyRef: (id, fullbodyMediaId) =>
    set((s) => {
      const ch = s.scenario.characters?.[id]
      if (!ch) return {}
      return {
        scenario: {
          ...s.scenario,
          characters: {
            ...s.scenario.characters!,
            [id]: {
              ...ch,
              fullbodyMediaId,
              // 全身照信息最全，优先作为 turnaround 兜底
              turnaroundRefImageId: fullbodyMediaId ?? ch.turnaroundRefImageId,
            },
          },
        },
      }
    }),

  /*
   * v6.6 · 角色音色锚点写入。
   *
   * patch 语义：
   *   - 传 undefined → 整个 voiceAnchor 清空（"取消锚定"，下游退回兜底音色）
   *   - 传部分字段 → merge 到现有 voiceAnchor；savedAt 始终用调用时间戳
   *     （即使作者只是改 sampleText / 试听音频，也算"重新确认了一次锚点"）
   *   - voiceType 缺失或空字符串 → 视为清空（防止半新半旧脏数据）
   */
  setCharacterVoiceAnchor: (id, anchor) =>
    set((s) => {
      const ch = s.scenario.characters?.[id]
      if (!ch) return {}
      const next = { ...ch } as typeof ch
      if (!anchor || !anchor.voiceType?.trim()) {
        delete next.voiceAnchor
      } else {
        next.voiceAnchor = {
          ...(ch.voiceAnchor ?? {}),
          ...anchor,
          savedAt: anchor.savedAt ?? Date.now(),
        }
      }
      return {
        scenario: {
          ...s.scenario,
          characters: {
            ...s.scenario.characters!,
            [id]: next,
          },
        },
      }
    }),

  upsertLocation: (loc) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        locations: {
          ...(s.scenario.locations ?? {}),
          [loc.id]: { ...(s.scenario.locations?.[loc.id] ?? {}), ...loc },
        },
      },
    })),

  removeLocation: (id) =>
    set((s) => {
      const locs = { ...(s.scenario.locations ?? {}) }
      if (!(id in locs)) return {}
      delete locs[id]
      // 同步清掉任何 scene 上引用的 locationId
      const nextScenes: Record<string, Scene> = {}
      for (const [sid, sc] of Object.entries(s.scenario.scenes)) {
        nextScenes[sid] = sc.locationId === id ? { ...sc, locationId: undefined } : sc
      }
      return {
        scenario: { ...s.scenario, locations: locs, scenes: nextScenes },
      }
    }),

  setLocationRefImage: (id, refImageId) =>
    set((s) => {
      const loc = s.scenario.locations?.[id]
      if (!loc) return {}
      return {
        scenario: {
          ...s.scenario,
          locations: {
            ...s.scenario.locations!,
            [id]: { ...loc, refImageId },
          },
        },
      }
    }),

  addLocationAngleRef: (locationId, angle) =>
    set((s) => {
      const loc = s.scenario.locations?.[locationId]
      if (!loc) return {}
      const existing = loc.angleRefs ?? []
      const idx = existing.findIndex((a) => a.id === angle.id)
      const next = idx >= 0
        ? existing.map((a, i) => (i === idx ? angle : a))
        : [...existing, angle]
      return {
        scenario: {
          ...s.scenario,
          locations: {
            ...s.scenario.locations!,
            [locationId]: { ...loc, angleRefs: next },
          },
        },
      }
    }),

  removeLocationAngleRef: (locationId, angleId) =>
    set((s) => {
      const loc = s.scenario.locations?.[locationId]
      if (!loc?.angleRefs) return {}
      const next = loc.angleRefs.filter((a) => a.id !== angleId)
      // 没真删任何东西就不写, 避免无意义历史步
      if (next.length === loc.angleRefs.length) return {}
      return {
        scenario: {
          ...s.scenario,
          locations: {
            ...s.scenario.locations!,
            [locationId]: { ...loc, angleRefs: next },
          },
        },
      }
    }),

  /*
   * v3.10 · Character.appearanceVariants —— add / remove。
   *
   * 实现选择 mirror addLocationAngleRef：upsert 语义（id 命中即整条替换），
   * 让上层不需要先查"已经有没有"。配合 normalizeScenario 已经支持的 sanitize
   * 逻辑，所有写入都走同一处 source of truth。
   *
   * 删除时如果数组变空，故意保留 `appearanceVariants: []`（不 unset 字段）：
   *   - 后续 normalizeScenario 的"空数组转 undefined"已经会净化序列化产物
   *   - 这里保留 [] 让 React 选择器立即看到"长度变 0"，UI 重渲染更直接
   */
  addCharacterAppearanceVariant: (characterId, variant) =>
    set((s) => {
      const ch = s.scenario.characters?.[characterId]
      if (!ch) return {}
      const existing = ch.appearanceVariants ?? []
      const idx = existing.findIndex((v) => v.id === variant.id)
      const next =
        idx >= 0
          ? existing.map((v, i) => (i === idx ? variant : v))
          : [...existing, variant]
      return {
        scenario: {
          ...s.scenario,
          characters: {
            ...s.scenario.characters!,
            [characterId]: { ...ch, appearanceVariants: next },
          },
        },
      }
    }),

  removeCharacterAppearanceVariant: (characterId, variantId) =>
    set((s) => {
      const ch = s.scenario.characters?.[characterId]
      if (!ch?.appearanceVariants) return {}
      const next = ch.appearanceVariants.filter((v) => v.id !== variantId)
      // 没有真删任何东西就不写，避免无意义历史步
      if (next.length === ch.appearanceVariants.length) return {}
      return {
        scenario: {
          ...s.scenario,
          characters: {
            ...s.scenario.characters!,
            [characterId]: { ...ch, appearanceVariants: next },
          },
        },
      }
    }),

  addPropVariant: (propId, variant) =>
    set((s) => {
      const p = s.scenario.props?.[propId]
      if (!p) return {}
      const existing = p.variants ?? []
      const idx = existing.findIndex((v) => v.id === variant.id)
      const next =
        idx >= 0
          ? existing.map((v, i) => (i === idx ? variant : v))
          : [...existing, variant]
      return {
        scenario: {
          ...s.scenario,
          props: {
            ...s.scenario.props!,
            [propId]: { ...p, variants: next },
          },
        },
      }
    }),

  removePropVariant: (propId, variantId) =>
    set((s) => {
      const p = s.scenario.props?.[propId]
      if (!p?.variants) return {}
      const next = p.variants.filter((v) => v.id !== variantId)
      if (next.length === p.variants.length) return {}
      return {
        scenario: {
          ...s.scenario,
          props: {
            ...s.scenario.props!,
            [propId]: { ...p, variants: next },
          },
        },
      }
    }),

  setSceneLocationId: (sceneId, locationId) =>
    set((s) => {
      const sc = s.scenario.scenes[sceneId]
      if (!sc) return {}
      return {
        scenario: {
          ...s.scenario,
          scenes: { ...s.scenario.scenes, [sceneId]: { ...sc, locationId } },
        },
      }
    }),

  setSceneIsEnding: (sceneId, isEnding) =>
    set((s) => {
      const sc = s.scenario.scenes[sceneId]
      if (!sc) return {}
      // undefined 表示"清除"，不写入 false（保持 Scene 类型 shape 简洁）
      const next = { ...sc }
      if (isEnding) next.isEnding = true
      else delete next.isEnding
      return {
        scenario: {
          ...s.scenario,
          scenes: { ...s.scenario.scenes, [sceneId]: next },
        },
      }
    }),

  /*
   * v6.7 · 场景 BGM 锚点写入。
   *
   * patch 语义（与 setCharacterVoiceAnchor 同构）：
   *   - 传 undefined / prompt 仅空白 → 清空 sceneBgm
   *     （Player 退回"无 BGM"或上一场延续，不会再去拉这场的音频）
   *   - 传部分字段 → 合并到既有 sceneBgm；savedAt 默认刷成 Date.now()
   *     （即使作者只是改了一个 mood tag, 也算"重新确认了一次锚点"）
   *   - scene 不存在 → 静默 no-op
   */
  setSceneBgm: (sceneId, anchor) =>
    set((s) => {
      const sc = s.scenario.scenes[sceneId]
      if (!sc) return {}
      const next = { ...sc }
      const promptOk = anchor && typeof anchor.prompt === 'string' && anchor.prompt.trim().length > 0
      if (!anchor || !promptOk) {
        delete next.sceneBgm
      } else {
        next.sceneBgm = {
          ...(sc.sceneBgm ?? {}),
          ...anchor,
          savedAt: anchor.savedAt ?? Date.now(),
        }
      }
      return {
        scenario: {
          ...s.scenario,
          scenes: { ...s.scenario.scenes, [sceneId]: next },
        },
      }
    }),

  upsertProp: (p) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        props: { ...(s.scenario.props ?? {}), [p.id]: p },
      },
    })),

  removeProp: (id) =>
    set((s) => {
      const next = { ...(s.scenario.props ?? {}) }
      delete next[id]
      return { scenario: { ...s.scenario, props: next } }
    }),

  upsertVariable: (v) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        variables: { ...(s.scenario.variables ?? {}), [v.id]: v },
      },
    })),

  removeVariable: (id) =>
    set((s) => {
      const next = { ...(s.scenario.variables ?? {}) }
      delete next[id]
      return { scenario: { ...s.scenario, variables: next } }
    }),

  upsertItem: (item) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        items: { ...(s.scenario.items ?? {}), [item.id]: item },
      },
    })),

  removeItem: (id) =>
    set((s) => {
      const next = { ...(s.scenario.items ?? {}) }
      delete next[id]
      return { scenario: { ...s.scenario, items: next } }
    }),

  setPropRefImage: (id, refImageId) =>
    set((s) => {
      const p = s.scenario.props?.[id]
      if (!p) return {}
      return {
        scenario: {
          ...s.scenario,
          props: {
            ...s.scenario.props!,
            [id]: { ...p, refImageId },
          },
        },
      }
    }),

  setUIStyle: (patch) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        uiStyle: { prompt: '', ...(s.scenario.uiStyle ?? {}), ...patch },
      },
    })),

  setVisualStyle: (style) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        visualStyle: style,
      },
    })),

  setDirectorStyle: (style) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        directorStyle: style,
      },
    })),

  setModuleEnabled: (moduleId, enabled) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        modules: { ...(s.scenario.modules ?? {}), [moduleId]: enabled },
      },
    })),

  upsertBlockout: (blockout) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        blockouts: { ...(s.scenario.blockouts ?? {}), [blockout.id]: blockout },
      },
    })),

  removeBlockout: (blockoutId) =>
    set((s) => {
      const next = { ...(s.scenario.blockouts ?? {}) }
      delete next[blockoutId]
      const scenes = { ...s.scenario.scenes }
      for (const [sid, scene] of Object.entries(scenes)) {
        if (scene.blockoutRef === blockoutId) {
          scenes[sid] = { ...scene, blockoutRef: undefined }
        }
      }
      return { scenario: { ...s.scenario, blockouts: next, scenes } }
    }),

  setSceneBlockoutRef: (sceneId, blockoutId) =>
    set((s) =>
      mutateScene(s, sceneId, (scene) => ({ ...scene, blockoutRef: blockoutId })),
    ),

  toggleEnabledMinigame: (minigameId) =>
    set((s) => {
      const cur = s.scenario.enabledMinigameIds ?? []
      const next = cur.includes(minigameId)
        ? cur.filter((id) => id !== minigameId)
        : [...cur, minigameId]
      return {
        scenario: {
          ...s.scenario,
          enabledMinigameIds: next,
        },
      }
    }),

  // 防御纵深 #4：scenario.videoConfig 只接收"公开"字段（model/duration/size/provider）
  // apiKey / apiBase 走 settingsStore（localStorage 本机持久化），永不进 scenario JSON
  setVideoConfig: (patch) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        videoConfig: {
          provider: 'seedance',
          ...(s.scenario.videoConfig ?? {}),
          ...pickPublicVideoConfig(patch),
        },
      },
    })),

  setOriginIdea: (idea) =>
    set((s) => ({ scenario: { ...s.scenario, originIdea: idea } })),

  // ─── 小说家工作板（v5）actions ─────────────────────────────────────
  setSynopsis: (synopsis) =>
    set((s) => ({ scenario: { ...s.scenario, synopsis } })),

  setOutline: (outline) =>
    set((s) => ({ scenario: { ...s.scenario, outline } })),

  upsertOutlineNode: (node) =>
    set((s) => {
      const list = s.scenario.outline ?? []
      const idx = list.findIndex((n) => n.id === node.id)
      const next = idx >= 0 ? [...list.slice(0, idx), node, ...list.slice(idx + 1)] : [...list, node]
      return { scenario: { ...s.scenario, outline: next } }
    }),

  removeOutlineNode: (id) =>
    set((s) => {
      const list = s.scenario.outline ?? []
      // 同时清掉以 id 为 parent 的子节点（最多两层级联，配合 v5 类型注释里说的"最多三层"）
      const toRemove = new Set<string>([id])
      for (const n of list) {
        if (n.parentId && toRemove.has(n.parentId)) toRemove.add(n.id)
      }
      return {
        scenario: {
          ...s.scenario,
          outline: list.filter((n) => !toRemove.has(n.id)),
        },
      }
    }),

  setCharacterRelations: (relations) =>
    set((s) => ({ scenario: { ...s.scenario, characterRelations: relations } })),

  upsertCharacterRelation: (relation) =>
    set((s) => {
      const list = s.scenario.characterRelations ?? []
      const idx = list.findIndex((r) => r.id === relation.id)
      const next = idx >= 0 ? [...list.slice(0, idx), relation, ...list.slice(idx + 1)] : [...list, relation]
      return { scenario: { ...s.scenario, characterRelations: next } }
    }),

  removeCharacterRelation: (id) =>
    set((s) => ({
      scenario: {
        ...s.scenario,
        characterRelations: (s.scenario.characterRelations ?? []).filter((r) => r.id !== id),
      },
    })),

  // ─── Episode actions（v4） ────────────────────────────────────────
  addEpisode: (ep) =>
    set((s) => {
      const existing = s.scenario.episodes ?? []
      const maxOrder = existing.reduce((m, e) => Math.max(m, e.order), -1)
      const newEp: Episode = { ...ep, order: maxOrder + 1, createdAt: Date.now() }
      return { scenario: { ...s.scenario, episodes: [...existing, newEp] } }
    }),

  ensureDefaultEpisode: () =>
    set((s) => {
      const next = ensureEpisodes(s.scenario)
      // 幂等：ensureEpisodes 在已有剧集时原样返回同一引用 → 不触发更新。
      if (next === s.scenario) return {}
      return { scenario: next }
    }),

  updateEpisode: (id, patch) =>
    set((s) => {
      const episodes = (s.scenario.episodes ?? []).map((e) =>
        e.id === id ? { ...e, ...patch } : e,
      )
      return { scenario: { ...s.scenario, episodes } }
    }),

  removeEpisode: (id) =>
    set((s) => {
      const episodes = (s.scenario.episodes ?? []).filter((e) => e.id !== id)
      // 解除该集所有 scene 的 episodeId 绑定
      const nextScenes: Record<string, Scene> = {}
      for (const [sid, sc] of Object.entries(s.scenario.scenes)) {
        nextScenes[sid] = sc.episodeId === id ? { ...sc, episodeId: undefined } : sc
      }
      return { scenario: { ...s.scenario, episodes, scenes: nextScenes } }
    }),

  reorderEpisodes: (orderedIds) =>
    set((s) => {
      const byId = Object.fromEntries((s.scenario.episodes ?? []).map((e) => [e.id, e]))
      const episodes = orderedIds
        .filter((id) => byId[id])
        .map((id, idx) => ({ ...byId[id]!, order: idx }))
      return { scenario: { ...s.scenario, episodes } }
    }),

  adoptForgedEpisode: ({ episode, scenes, newCharacters }) =>
    set((s) => {
      // Upsert episode
      const existing = s.scenario.episodes ?? []
      const hasEp = existing.some((e) => e.id === episode.id)
      const maxOrder = existing.reduce((m, e) => Math.max(m, e.order), -1)
      const finalEp: Episode = hasEp
        ? episode
        : { ...episode, order: maxOrder + 1 }
      const episodes = hasEp
        ? existing.map((e) => (e.id === episode.id ? finalEp : e))
        : [...existing, finalEp]

      // Merge scenes (all tagged with episodeId)
      const mergedScenes = { ...s.scenario.scenes }
      for (const [sid, sc] of Object.entries(scenes)) {
        mergedScenes[sid] = { ...sc, episodeId: episode.id }
      }

      // Merge new characters
      const mergedChars = {
        ...(s.scenario.characters ?? {}),
        ...(newCharacters ?? {}),
      }

      return {
        scenario: {
          ...s.scenario,
          episodes,
          scenes: mergedScenes,
          characters: mergedChars,
        },
      }
    }),

  setSceneEpisode: (sceneId, episodeId) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({ ...scene, episodeId }))),

  // ─── StoryGraph actions ──────────────────────────────────────────
  setScenePos: (sceneId, pos) =>
    set((s) => mutateScene(s, sceneId, (scene) => ({ ...scene, pos }))),

  pinAllScenePositions: (positions) =>
    set((s) => {
      // 只给"尚未 pinned"的 scene 写 pos —— 已 pin 的尊重作者历史落点
      let changed = false
      const nextScenes: Record<string, Scene> = {}
      for (const [id, sc] of Object.entries(s.scenario.scenes)) {
        if (sc.pos !== undefined) {
          nextScenes[id] = sc
          continue
        }
        const p = positions[id]
        if (!p) {
          nextScenes[id] = sc
          continue
        }
        nextScenes[id] = { ...sc, pos: { x: Math.round(p.x), y: Math.round(p.y) } }
        changed = true
      }
      if (!changed) return {}
      return { scenario: { ...s.scenario, scenes: nextScenes } }
    }),

  addScene: (scene, options) =>
    set((s) => {
      // id 冲突 → 直接拒绝（保持原值，让上层先 generateId 再调）
      if (s.scenario.scenes[scene.id]) return {}

      const nextScenes: Record<string, Scene> = {
        ...s.scenario.scenes,
        [scene.id]: scene,
      }

      // linkFrom 自动挂 branch
      const link = options?.linkFrom
      if (link && nextScenes[link.sceneId]) {
        const fromScene = nextScenes[link.sceneId]!
        const branch: Branch = {
          id: `b-${link.sceneId}-${scene.id}-${Math.random().toString(36).slice(2, 8)}`,
          kind: link.kind,
          targetSceneId: scene.id,
          label: link.label,
        }
        nextScenes[link.sceneId] = {
          ...fromScene,
          branches: [...fromScene.branches, branch],
        }
      }

      return { scenario: { ...s.scenario, scenes: nextScenes } }
    }),

  removeScene: (sceneId) =>
    set((s) => {
      // 保护 root
      if (s.scenario.rootSceneId === sceneId) return {}
      const target = s.scenario.scenes[sceneId]
      if (!target) return {}

      // "穿连"策略：
      //   被删节点 X 的主后继 = X.branches[0].targetSceneId（若存在且有效）
      //   所有其他场景中原本 `branch.targetSceneId === X` 的 branch，重定向到 successor。
      //   如果 X 无后继（末端节点）→ 直接删除这些 branch（老行为）。
      //
      // 为什么只取第一条 branch 作为"主后继"：
      //   - 最自然的心智模型："把这个节点从链条上抽掉"
      //   - X 若是分歧点（有多条 branch），保留哪条不存在"正确答案"，取首条是 UI 视觉顺序的稳态
      //   - 若作者希望保留多个分支，应当先手动调整再删除；这里的 auto-merge 只解决最常见的"删除中间一节"
      //
      // 防环：如果 successor === 入边源场景（A → X → A 这种回流），该 branch 视为末端，移除
      const successorId: string | undefined = (() => {
        const firstBranch = target.branches.find(
          (b) => s.scenario.scenes[b.targetSceneId] && b.targetSceneId !== sceneId,
        )
        return firstBranch?.targetSceneId
      })()

      const nextScenes: Record<string, Scene> = {}
      for (const [id, sc] of Object.entries(s.scenario.scenes)) {
        if (id === sceneId) continue
        const rewritten: Branch[] = []
        for (const b of sc.branches) {
          if (b.targetSceneId !== sceneId) {
            rewritten.push(b)
            continue
          }
          // 此 branch 指向被删节点 → 尝试穿连
          if (!successorId || successorId === id) {
            // 无后继 / 自环 → 丢弃
            continue
          }
          // 去重：若该场景已经有 branch 指向 successor，不重复挂
          if (rewritten.some((x) => x.targetSceneId === successorId)) continue
          if (sc.branches.some((x) => x.targetSceneId === successorId && x.id !== b.id)) {
            continue
          }
          rewritten.push({ ...b, targetSceneId: successorId })
        }
        nextScenes[id] = { ...sc, branches: rewritten }
      }

      const fallbackId = s.scenario.rootSceneId
      const nextSelection: ScenarioStore['selection'] =
        s.selection &&
        ((s.selection.kind === 'scene' && s.selection.sceneId === sceneId) ||
          ('sceneId' in s.selection && s.selection.sceneId === sceneId))
          ? { kind: 'scene', sceneId: fallbackId }
          : s.selection

      const nextSelectedSceneId =
        s.selectedSceneId === sceneId ? fallbackId : s.selectedSceneId

      return {
        scenario: { ...s.scenario, scenes: nextScenes },
        selectedSceneId: nextSelectedSceneId,
        selection: nextSelection,
      }
    }),

  relinkBranch: (sceneId, branchId, newTargetSceneId) =>
    set((s) => {
      // 目标场景不存在 → 拒绝（防止悬空 branch）
      if (!s.scenario.scenes[newTargetSceneId]) return {}
      return mutateScene(s, sceneId, (scene) => ({
        ...scene,
        branches: scene.branches.map((b) =>
          b.id === branchId ? { ...b, targetSceneId: newTargetSceneId } : b,
        ),
      }))
    }),

  resetLayout: () =>
    set((s) => {
      // 扫一遍：只要没有任何 scene 拥有 pos，就直接 no-op，避免污染 zundo
      const hasAnyPos = Object.values(s.scenario.scenes).some(
        (sc) => sc.pos !== undefined,
      )
      if (!hasAnyPos) return {}
      const nextScenes: Record<string, Scene> = {}
      for (const [id, sc] of Object.entries(s.scenario.scenes)) {
        if (sc.pos === undefined) {
          nextScenes[id] = sc
        } else {
          const { pos: _omit, ...rest } = sc
          void _omit
          nextScenes[id] = rest as Scene
        }
      }
      return { scenario: { ...s.scenario, scenes: nextScenes } }
    }),

  // ─── 长文本分段管线（id: p3-store） ──────────────────────────────
  startStreamingBatch: (batchId) => set({ streaming: makeStreamingState(batchId) }),

  appendActProgressive: (act) =>
    set((s) => {
      const streaming = s.streaming
      if (!streaming) return {}
      // 幂等：同 actId 重复 append → 跳过（防止重渲染时 React StrictMode 双调）
      if (streaming.acts.some((a) => a.actId === act.actId)) return {}

      // 新 scenes —— 跳过已存在的 sceneId（理论上不会发生；防御重名）
      const nextScenes: Record<string, Scene> = { ...s.scenario.scenes }
      const insertedSceneIds: string[] = []
      for (const node of act.nodes) {
        if (nextScenes[node.sceneId]) {
          // 同名已存在：保留旧的；只把它登记到 streaming 元数据里
          insertedSceneIds.push(node.sceneId)
          continue
        }
        nextScenes[node.sceneId] = makeBlankSkeletonScene(node)
        insertedSceneIds.push(node.sceneId)
      }

      // 串 Act 内 auto 链：node[i] → node[i+1]
      for (let i = 0; i < act.nodes.length - 1; i++) {
        const fromId = act.nodes[i]!.sceneId
        const toId = act.nodes[i + 1]!.sceneId
        const from = nextScenes[fromId]
        if (!from) continue
        // 已经有指向 toId 的边 → 跳过（幂等）
        if (from.branches.some((b) => b.targetSceneId === toId)) continue
        const branch: Branch = {
          id: `b-${fromId}-${toId}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'auto',
          targetSceneId: toId,
        }
        nextScenes[fromId] = {
          ...from,
          branches: [...from.branches, branch],
        }
      }

      // 跨 Act 串：linkFromSceneId 命中时挂到第一个新节点
      const firstNew = act.nodes[0]
      if (act.linkFromSceneId && firstNew) {
        const from = nextScenes[act.linkFromSceneId]
        if (from && !from.branches.some((b) => b.targetSceneId === firstNew.sceneId)) {
          const branch: Branch = {
            id: `b-${act.linkFromSceneId}-${firstNew.sceneId}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            kind: 'auto',
            targetSceneId: firstNew.sceneId,
          }
          nextScenes[act.linkFromSceneId] = {
            ...from,
            branches: [...from.branches, branch],
          }
        }
      }

      const nextNodeStatus: Record<string, StreamingNodeStatus> = {
        ...streaming.nodeStatus,
      }
      for (const id of insertedSceneIds) {
        // 已经升迁过的不要回退
        if (!nextNodeStatus[id]) nextNodeStatus[id] = 'skeleton'
      }

      return {
        scenario: { ...s.scenario, scenes: nextScenes },
        streaming: {
          ...streaming,
          acts: [...streaming.acts, actSkeletonToMeta(act)],
          nodeStatus: nextNodeStatus,
        },
      }
    }),

  patchNodePrompts: (sceneId, patch) =>
    set((s) => {
      const scene = s.scenario.scenes[sceneId]
      if (!scene) return {}
      const merged = mergeScenePrompts(scene.prompts, patch)
      const nextScene: Scene = {
        ...scene,
        prompts: merged,
        // 与 setScenePrompts 行为一致：把 prompts.scene 同步回 media.prompt
        media: { ...scene.media, prompt: merged.scene },
      }

      // streaming 没启动 → 单纯改 prompts，不动状态机
      if (!s.streaming) {
        return {
          scenario: {
            ...s.scenario,
            scenes: { ...s.scenario.scenes, [sceneId]: nextScene },
          },
        }
      }

      const cur = s.streaming.nodeStatus[sceneId]
      // 单调升迁：assets-ready 不回退；prompts-ready 已是目标态不重复写
      const nextStatus: StreamingNodeStatus =
        cur === 'assets-ready' ? 'assets-ready' : 'prompts-ready'

      return {
        scenario: {
          ...s.scenario,
          scenes: { ...s.scenario.scenes, [sceneId]: nextScene },
        },
        streaming:
          cur === nextStatus
            ? s.streaming
            : {
                ...s.streaming,
                nodeStatus: { ...s.streaming.nodeStatus, [sceneId]: nextStatus },
              },
      }
    }),

  markNodeAssetsReady: (sceneId) =>
    set((s) => {
      const streaming = s.streaming
      if (!streaming) return {}
      if (streaming.nodeStatus[sceneId] === 'assets-ready') return {}
      // 节点不在 streaming 名册里 —— 仍然写入（兼容"先生图后流水线"的场景）
      return {
        streaming: {
          ...streaming,
          nodeStatus: { ...streaming.nodeStatus, [sceneId]: 'assets-ready' },
        },
      }
    }),

  setStreamingActStatus: (actId, status, errorReason) =>
    set((s) => {
      const streaming = s.streaming
      if (!streaming) return {}
      const idx = streaming.acts.findIndex((a) => a.actId === actId)
      if (idx === -1) return {}
      const cur = streaming.acts[idx]!
      // 状态没变 + errorReason 也没变 → 不写
      if (cur.status === status && cur.errorReason === errorReason) return {}
      const nextActs = streaming.acts.slice()
      nextActs[idx] = {
        ...cur,
        status,
        errorReason: status === 'failed' ? errorReason : undefined,
      }
      return { streaming: { ...streaming, acts: nextActs } }
    }),

  clearStreamingState: () =>
    set((s) => (s.streaming === null ? {} : { streaming: null })),

  applyPatches: (patches) => {
    // 早退：空 patch 不动 store, 也不入 zundo
    if (!patches || patches.length === 0) {
      return { applied: false, error: { opIndex: -1, message: '空 patch 列表' } }
    }
    try {
      const current = get().scenario
      const next = applyJsonPatch(current, patches)
      // 通过 sanitize: 万一 LLM 把 apiKey 等敏感字段塞进 prompts 也会被剥掉.
      // migrate 不必再跑 — patch 改不了 schema 版本号 (除非作者手贱), 而且我们的
      // patch path 校验也不应允许动 schemaVersion.
      const sanitized = sanitizeScenarioForIO(next)
      // 引用相等就跳过 (避免 zundo 入一笔空操作)
      if (sanitized === current) {
        return { applied: false, error: { opIndex: -1, message: '无变更' } }
      }
      set({ scenario: sanitized })
      return { applied: true }
    } catch (e) {
      if (e instanceof JsonPatchError) {
        return {
          applied: false,
          error: { opIndex: e.opIndex, message: e.message },
        }
      }
      return {
        applied: false,
        error: { opIndex: -1, message: (e as Error).message ?? String(e) },
      }
    }
  },
    }),
    {
      partialize: (state) => ({ scenario: state.scenario }),
      // shallow 比 partial 的 keys —— 这里只有 1 个 key (scenario)，
      // 等价于"scenario 引用没变就不入栈"。selectScene 改的是 selectedSceneId，
      // partialize 之后 scenario 引用未变，shallow 返回 true → 不污染历史。
      equality: shallow,
      limit: 50,
    },
  ),
)

function mutateScene(
  state: ScenarioStore,
  sceneId: string,
  fn: (scene: Scene) => Scene,
): Partial<ScenarioStore> {
  const scene = state.scenario.scenes[sceneId]
  if (!scene) return {}
  return {
    scenario: {
      ...state.scenario,
      scenes: { ...state.scenario.scenes, [sceneId]: fn(scene) },
    },
  }
}

/** 台词缺省可见宽度（endMs 未填时按此估算占用区间，与时间轴渲染口径一致）。 */
const DIALOGUE_FALLBACK_WIDTH_MS = 2000

/** 台词的占用区间 [start, end)。endMs 缺省时按默认宽度估算。 */
function dialogueSpan(d: DialogueLine): [number, number] {
  const end = d.endMs ?? d.startMs + DIALOGUE_FALLBACK_WIDTH_MS
  return [d.startMs, Math.max(end, d.startMs + 1)]
}

/**
 * 为「新加入的台词」挑一个不与已有台词重叠的 startMs（自动避让）。
 *
 * 作者诉求（2026-06-19）："添加台词也是乱的" —— 新台词常和已有台词撞在同一时刻，
 * 在单行 DIA 轨里糊成一团。这里贪心地把新台词推到第一个空隙：
 *   - 期望落点本就空闲 → 原样保留（不偷偷挪走作者刻意点的落点）；
 *   - 与某条重叠 → 跳到该条末尾，重试，直到无重叠。
 * 同步平移 endMs 以保持原时长。纯函数，便于单测。
 */
export function placeDialogueNonOverlap(
  existing: readonly DialogueLine[],
  line: DialogueLine,
  _sceneDurationMs: number,
): DialogueLine {
  if (existing.length === 0) return line
  const intervals = existing.map(dialogueSpan).sort((a, b) => a[0] - b[0])
  const width =
    (line.endMs ?? line.startMs + DIALOGUE_FALLBACK_WIDTH_MS) - line.startMs
  let start = Math.max(0, line.startMs)
  let moved = true
  let guard = 0
  while (moved && guard++ <= intervals.length) {
    moved = false
    for (const [s, e] of intervals) {
      if (start < e && start + width > s) {
        start = e
        moved = true
      }
    }
  }
  if (start === line.startMs) return line
  if (line.endMs === undefined) return { ...line, startMs: start }
  return { ...line, startMs: start, endMs: start + width }
}

/**
 * 生成 "<sceneId>-shNN" 形式的 shot id，N 从既有 shot 最大序号 +1 起。
 * 通用策略：扫现有 id 里 `-sh(\d+)$` 取最大值；全无则从 01 开始。
 */
function makeShotId(sceneId: string, existing: readonly Shot[]): string {
  const re = /-sh(\d+)$/
  let max = 0
  for (const sh of existing) {
    const m = re.exec(sh.id)
    if (m) {
      const n = Number.parseInt(m[1]!, 10)
      if (n > max) max = n
    }
  }
  const next = max + 1
  return `${sceneId}-sh${String(next).padStart(2, '0')}`
}

/**
 * 生成 "aud_<n>" 形式的 audio clip id；扫现有 id 里 `^aud_(\d+)$` 取最大值。
 * audio id 不与 scene 绑定（作者可能在不同 scene 用同一条配乐）。
 */
function makeAudioClipId(existing: readonly AudioClip[]): string {
  const re = /^aud_(\d+)$/
  let max = 0
  for (const c of existing) {
    const m = re.exec(c.id)
    if (m) {
      const n = Number.parseInt(m[1]!, 10)
      if (n > max) max = n
    }
  }
  return `aud_${String(max + 1).padStart(3, '0')}`
}
