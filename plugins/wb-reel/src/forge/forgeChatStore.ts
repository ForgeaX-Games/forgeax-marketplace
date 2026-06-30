import { create } from 'zustand'

/**
 * ForgeChat —— Forge 页的对话历史 store。
 *
 * 需求（来自作者反馈）：
 *   "我上传给你的这个文件、以及我们的生成记录，图像、视频等，都有历史，
 *    能保存，刷新还能看到之前编辑的就行！！！！"
 *
 * 设计要点：
 *   1. **per-scenario 会话** —— 切 scenario 时对话跟着切，不混
 *   2. **消息 + 附件分仓** —— 消息里存 attachmentIds（引用），附件本体进
 *      sessions[id].attachments；这样一条消息反复引用同一张图不重复占空间
 *   3. **草稿持久化** —— 作者正在敲但还没点发送的 text / staged 附件也要存，
 *      切 tab / 刷新都要在
 *   4. **立即落盘** —— 每次 set 后同步写 localStorage（无 debounce）
 *      单次写入 KB 级别开销可接受，换来"绝不丢"的心智
 *
 * 存储上限：
 *   - localStorage 5MB，图片 base64 大（~1MB/张）很快会爆
 *   - 本 v1 不做额外压缩/外置 blob，先让 UX 跑通
 *   - 触达上限时 saveSnapshot 静默降级：保留最新 10 条消息 + 最近 5 个附件
 *     后续可接入 assetStore 把图片挪到磁盘（见 vite.config.ts reel-assets 插件）
 */

// ─────────────────────────────────────────────────────────────────────────────
// 数据形状
// ─────────────────────────────────────────────────────────────────────────────

export type AttachmentKind = 'text' | 'image'

interface AttachmentBase {
  id: string
  kind: AttachmentKind
  filename: string
  bytes: number
  createdAt: number
}
export interface TextAttachment extends AttachmentBase {
  kind: 'text'
  /** 文件的原文内容（UTF-8）—— 发送时整段拼进 user prompt */
  content: string
}
export interface ImageAttachment extends AttachmentBase {
  kind: 'image'
  /** data URL（base64 inline），用于预览 + 作为 image 生成的 referenceImageDataUrl */
  dataUrl: string
  mimeType?: string
}
export type Attachment = TextAttachment | ImageAttachment

/**
 * addAttachment 的入参形状。
 *
 * 为什么不直接用 `Omit<Attachment, 'id' | 'createdAt'>`：
 *   TypeScript 对 discriminated union 做 Omit 时会塌缩丢字段（#35719），
 *   导致调用端传 `{ kind: 'text', content: ... }` 被判为不存在 `content`。
 *   显式写 union 分支让两边字段各自保留。
 */
export type NewAttachment =
  | Omit<TextAttachment, 'id' | 'createdAt'>
  | Omit<ImageAttachment, 'id' | 'createdAt'>

export type ProductAssetKind = 'image' | 'video'
export interface ProductAsset {
  kind: ProductAssetKind
  /** 指向 media/asset store 的 URL —— 产物落盘由 assetStore 负责，这里只存引用 */
  url: string
  /** 可选人类可读标签（"场景 s3 关键帧"） */
  label?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  /** 发送这条消息时附带的附件 ids（引用 session.attachments 里的本体） */
  attachmentIds?: string[]
  /** assistant 消息生成的产物：图片、视频等 */
  productAssets?: ProductAsset[]
  /** 出错信息 —— assistant 调用 LLM 失败时仍把消息写入，标红展示 */
  error?: string
  /**
   * 锻造工作流归档 —— 这条 assistant 消息对应的那次锻造里跑过的所有 stages。
   *
   * 为什么放消息上：刷新 / 切 tab / 切 scenario 后，PendingBubble 会被销毁
   * （pending 在 loadInitial 时强制清成 null，避免"虚假锻造中"），但作者期望
   * "无论怎么刷新都能看到当前各环节的工作"。把 stages 归档到产出消息上，让
   * 历史记录里点开就能看到「调用模型 → 解析 JSON → 角色参考图 4/4」整条链路。
   *
   * 写入时机：runForgeFromChat 在 clearPending 之前调用 archiveStagesToMessage。
   */
  stagesArchive?: PendingStage[]
  /** 该次锻造耗时（毫秒）—— 配合 stagesArchive 一起展示 */
  forgeElapsedMs?: number
  /** 是否为作者主动中断 —— 在 stagesArchive 末尾加上"已中断"标记时置 true */
  aborted?: boolean
  createdAt: number
}

export interface PendingForge {
  /** 目前只有 'forging'；以后可扩展 'regen-image' 等 */
  reason: 'forging'
  /** 作为耗时显示锚点；也让切回来的 UI 能算出"已跑 N 秒" */
  startedAt: number
  /**
   * 锻造阶段日志 —— 按时间顺序叠加，最新在末尾。
   * UI 的 PendingBubble 会把它们渲染成一条条"✓ 调用模型 (Claude · 32000 tokens)"。
   *
   * 为什么进 store：切 tab / 切 scenario / 刷新回来还能看到进度（即便模型还在跑，
   * 阶段历史已经生成的也在）。
   */
  stages: PendingStage[]
  /**
   * 最近一段 streaming 文本（模型正在吐的 token 流的全量累积）。
   * **只存最后 8KB**，旧内容 UI 显示用不到（bubble 里有 snapshot 预览即可），
   * 防止把 localStorage 打爆。
   */
  streamTail: string
  /** streamTail 的总长度（累计，不是 tail 的长度）—— 用于 UI 显示 "已吐 N 字" */
  streamBytes: number
  /**
   * 该次锻造是否可被作者中断 —— 当 runForgeFromChat 持有 AbortController 时为 true。
   * UI 的 PendingBubble 据此决定是否渲染「中断」按钮。
   *
   * 为什么进 store 而不是组件 state：runForgeFromChat 是 module 级函数，
   * AbortController 也存在 module scope（abortRegistry），UI 只需要知道
   * "现在能不能中断"这个布尔值；具体的 controller 不进 store（不可序列化）。
   */
  abortable?: boolean
}

export interface PendingStage {
  /** 用户可读的短标签，如"调用模型"、"解析 JSON" */
  label: string
  /** 可选明细，如"Claude · claude-opus-4-6 · 流式" */
  detail?: string
  /** 到达该阶段的时间戳 */
  at: number
}

/** streamTail 在内存里保留多少字节（UTF-16 长度）；超过就从头丢。 */
const STREAM_TAIL_MAX = 8 * 1024

// ─────────────────────────────────────────────────────────────────────────────
// v3.10 · 模块化锻造 stage 机
//
// 用户期望（原话浓缩）："剧本锻造要模块化 —— 输入 → 风格确认 → 一句话梗概
//   → 纲要 → 大纲 → 分段扩写 → 锚点入库 → 资产生成确认 → 落定。每一步都要能
//   暂停、修改、重生、确认才进下一步。刷新切页都不能丢，要能看到所有环节。"
//
// 这里实现的是 store 这一层 —— 只负责"现在卡在哪、每个 stage 的 draft 是什么、
// 历史快照"。具体 LLM skill 由 ForgeChatPanel 的 runStage 调度（PR5），路由器
// 把作者输入翻译成 ForgeIntent（PR4 第二刀）。
//
// 设计要点：
//   1. **9 元 stage**。idle 是初始（还没开始）；confirmed 是终态（资产生成确认）。
//   2. **每 stage 有自己的 draft + status**：status 是 'idle' | 'running' |
//      'await-confirm' | 'confirmed' | 'failed'。同一个 stage 反复重生不影响
//      其他 stage 的 record。
//   3. **下游作废**：作者从 outline 回到 logline 改一刀，下游 outline /
//      expansion 的 record 必须立刻作废（status 重置）—— 不然 expansion
//      还挂着旧 outline 的产物，UI 一不小心展示就出对不上号的剧本。
//   4. **append-only 历史**：每次 confirmStage 把当时的 draft 快照入 stageHistory，
//      作者哪怕再改也能从历史里回看"昨天那一版 logline 是什么"。
//   5. **不折叠**：UI 渲染时遍历 stages.records 全画卡片，不再做"只显示当前 stage"
//      的折叠逻辑。这条不在 store 里强制，但 store 的形状专为此设计。
// ─────────────────────────────────────────────────────────────────────────────

export type ForgeStage =
  | 'idle'
  | 'await-style'
  | 'logline'
  | 'synopsis'
  | 'outline'
  | 'expansion'
  | 'await-assets'
  | 'generating-assets'
  | 'confirmed'

/**
 * stage 顺序表 —— 用作"下游作废"和"前进一步"的唯一 source of truth。
 * 改顺序时只动这里；其他逻辑通过 indexOf 派生，不会散落硬编码。
 */
export const FORGE_STAGE_ORDER: ForgeStage[] = [
  'idle',
  'await-style',
  'logline',
  'synopsis',
  'outline',
  'expansion',
  'await-assets',
  'generating-assets',
  'confirmed',
]

export type StageStatus =
  | 'idle'
  | 'running'
  | 'await-confirm'
  | 'confirmed'
  | 'failed'

/**
 * 每个 stage 的 draft 形状。
 *
 * 留作 LLM skill 输出格式的"地基" —— skill 自己产出的 JSON 必须能 lossless 喂进
 * 这里，UI 也照着读。下面只保留最少必要字段，后续 PR5 再扩。
 */
export interface StageDraftStyle {
  director?: string
  writer?: string
  visualPreset?: string
  /** LLM 自由补充的备注（不影响 UI，仅作上下文带回下一 stage） */
  notes?: string
}
export interface StageDraftLogline {
  text: string
  /** 备选项 —— 让作者在 UI 里直接挑一条 */
  alternatives?: string[]
}
export interface StageDraftSynopsis {
  text: string
  /** 一段简短的 beat 节拍，用于过渡到 outline 时给模型上下文 */
  beats?: string[]
}
export interface StageDraftOutlineChapter {
  id: string
  title: string
  summary: string
}
export interface StageDraftOutline {
  chapters: StageDraftOutlineChapter[]
}
export interface StageDraftExpansionScene {
  /** 对应到 scenario.scenes[].id；锻造未完成时可能还是占位 id */
  sceneId: string
  prose: string
  /** 该 scene 当前的扩写态：模型还在写 / 写完待确认 / 作者已确认 / 失败 */
  status: 'pending' | 'running' | 'await-confirm' | 'confirmed' | 'failed'
  /** 失败原因（status === 'failed' 时） */
  error?: string
}
export interface StageDraftExpansion {
  scenes: StageDraftExpansionScene[]
}
/** await-assets / generating-assets / confirmed 没有"draft"，但 record 仍然要在，方便 UI 画卡。 */
export type StageDraftAssetsStub = Record<string, never>

/**
 * 把 stage kind 映射到对应 draft 形状。
 *
 * 用映射类型让 setStageDraft / getStageDraft 在 TS 层面强类型 —— UI 拿
 * `getStageDraft(scenarioId, 'logline')` 直接得到 `StageDraftLogline | undefined`。
 */
export interface StageDraftMap {
  'idle': StageDraftAssetsStub
  'await-style': StageDraftStyle
  'logline': StageDraftLogline
  'synopsis': StageDraftSynopsis
  'outline': StageDraftOutline
  'expansion': StageDraftExpansion
  'await-assets': StageDraftAssetsStub
  'generating-assets': StageDraftAssetsStub
  'confirmed': StageDraftAssetsStub
}

export interface StageRecord<K extends ForgeStage = ForgeStage> {
  kind: K
  status: StageStatus
  draft: StageDraftMap[K]
  /** 上次写入时间，用于 UI 显示"3 分钟前重生过" */
  updatedAt: number
  /**
   * 该 stage 内部的"重生历史" —— 不同于 stageHistory（跨 stage 的全局归档），
   * 这里记录同一个 stage 反复重生的 N 个版本，UI 可以做"上一版 / 下一版"切换。
   * 每条只存 draft + ts，避免整 record 自包含递归。
   */
  attempts: { draft: StageDraftMap[K]; updatedAt: number }[]
  /** 失败原因（status === 'failed' 时） */
  error?: string
}

/**
 * stageHistory —— 跨 stage 的 append-only 归档。
 *
 * 每次 confirmStage 把当时的 record 快照推进来，作者后面无论怎么回退/修改/重生，
 * "曾经确认过的版本"都还在。UI 在历史卡片里渲染时间线。
 *
 * 为什么不直接复用 messages 的 stagesArchive：那个是"模型跑一次的内部进度日志"
 * （调用模型 → 解析 JSON → 角色参考图 4/4），生命周期跟一次 forge 调用绑定；
 * stageHistory 是"作者的剧本演化轨迹"，跨多次调用、可能跨天。
 */
export interface StageHistoryEntry<K extends ForgeStage = ForgeStage> {
  kind: K
  draft: StageDraftMap[K]
  /** 该次确认的时间 */
  at: number
  /** 用户填的备注或 LLM 给的标签（可选），UI 显示在历史卡边上 */
  note?: string
}

/** stage 状态总集 —— 进 ForgeSession.stages */
export interface ForgeStageState {
  current: ForgeStage
  /** 每个 stage 的最新 record；只有走过的 stage 才有 entry */
  records: { [K in ForgeStage]?: StageRecord<K> }
  /** append-only，confirmStage 时 push */
  history: StageHistoryEntry[]
}

const EMPTY_STAGE_STATE: ForgeStageState = {
  current: 'idle',
  records: {},
  history: [],
}

export interface ForgeSession {
  messages: ChatMessage[]
  /** session 内所有出现过的附件本体，按 id 查；gc 策略见本文件底部 */
  attachments: Record<string, Attachment>
  /** 作者正在敲但还没发送的文本 */
  draft: string
  /** 已上传到 stage 但还没发送的附件 ids */
  draftAttachmentIds: string[]
  /**
   * 当前是否正在跑锻造 —— 非 null 表示 UI 要显示"锻造中…"气泡。
   * 为什么进 store 而不是 useState：ForgeTab 是 activeTab 条件渲染，
   * 切 tab 就卸载，组件本地状态丢。进 store + localStorage 才撑得过切 tab / 刷新。
   * 约定：发起请求前 setPending，成功/失败回来 clearPending（即便作者已经切走）。
   */
  pending: PendingForge | null
  /**
   * v3.10 · 模块化 stage 状态。
   *
   * 每条 session 都自带一份 stage 机；首次切到该 scenario 时初始化为
   * EMPTY_STAGE_STATE。pending 表示"现在某个 LLM 调用在跑"，stages 表示
   * "锻造工作流卡在哪、每段产物是什么"，两个维度独立 —— 一段 stage 可能
   * 处于 await-confirm（draft 已就位等用户点确认），同时 pending 为 null
   * （没有任何正在跑的 LLM 调用）。
   */
  stages: ForgeStageState
}

const EMPTY_SESSION: ForgeSession = {
  messages: [],
  attachments: {},
  draft: '',
  draftAttachmentIds: [],
  pending: null,
  stages: EMPTY_STAGE_STATE,
}

// ─────────────────────────────────────────────────────────────────────────────
// store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 生成 session 存储 key。
 *
 * - 只传 scenarioId（旧调用方式）：key = scenarioId（向后兼容）
 * - 传入 episodeId：key = `${scenarioId}:${episodeId}`（每集独立对话历史）
 *
 * 场景：分剧集模式下，每一集的锻造历史互不干扰；全局 Forge（不区分集）仍用 scenarioId。
 */
export function forgeChatSessionKey(scenarioId: string, episodeId?: string): string {
  return episodeId ? `${scenarioId}:${episodeId}` : scenarioId
}

interface ForgeChatState {
  sessions: Record<string, ForgeSession>

  getSession: (scenarioId: string, episodeId?: string) => ForgeSession
  getAttachment: (scenarioId: string, attId: string) => Attachment | undefined

  setDraft: (scenarioId: string, text: string) => void
  addAttachment: (scenarioId: string, att: NewAttachment) => Attachment
  stageAttachment: (scenarioId: string, attId: string) => void
  unstageAttachment: (scenarioId: string, attId: string) => void
  clearStaged: (scenarioId: string) => void

  appendMessage: (
    scenarioId: string,
    msg: Omit<ChatMessage, 'id' | 'createdAt'>,
  ) => ChatMessage

  setPending: (scenarioId: string, p: PendingForge) => void
  appendPendingStage: (
    scenarioId: string,
    stage: Omit<PendingStage, 'at'>,
  ) => void
  appendPendingDelta: (scenarioId: string, delta: string) => void
  /**
   * 把当前 pending.stages 归档到指定消息上 —— 调用时机：clearPending 之前。
   * 通常 runForgeFromChat 在 try 里写入产出消息后立刻 archive，再 clearPending。
   *
   * @param messageId 目标消息（一般是刚 appendMessage 返回的产出消息）
   * @param opts.aborted 是否为作者主动中断（影响 UI 标识）
   */
  archiveStagesToMessage: (
    scenarioId: string,
    messageId: string,
    opts?: { aborted?: boolean },
  ) => void
  clearPending: (scenarioId: string) => void

  // ─── v3.10 · 模块化 stage 机 ───
  /**
   * 切到某个 stage（current 指针）。一般给"作者从外部 UI 跳过去"用，
   * 比如点历史卡片里的"回到 outline"会走这里。
   *
   * 注意：跳到上游 stage 不会自动作废下游 record —— 那是 resetStagesFrom 的事。
   * 这里只动 current 指针，让 UI 渲染聚焦点切走，下游 records 留作"待修订"参考。
   */
  setStage: (scenarioId: string, stage: ForgeStage) => void
  /**
   * 写入某个 stage 的 draft（不动 status）。LLM 流式吐字时由 PR5 的 runStage
   * 逐增写入；作者在 UI 里手动改某个字段也走这里。
   */
  setStageDraft: <K extends ForgeStage>(
    scenarioId: string,
    kind: K,
    draft: StageDraftMap[K],
  ) => void
  setStageStatus: (
    scenarioId: string,
    kind: ForgeStage,
    status: StageStatus,
    error?: string,
  ) => void
  /**
   * 把当前 attempts 入栈，开始下一次重生 —— 用在 LLM 重跑前。
   * 调用时把"现在的 draft"作为 attempt 存档，然后 status 切回 'running'。
   */
  beginStageAttempt: (scenarioId: string, kind: ForgeStage) => void
  /**
   * 用户点"确认"：record.status → 'confirmed'，draft snapshot 推进 history，
   * current 指针自动前进到下一 stage（如果传 advance=true，默认 true）。
   *
   * 已经 confirmed 的 stage 再 confirm 一次是 no-op（防双击）。
   */
  confirmStage: (
    scenarioId: string,
    kind: ForgeStage,
    opts?: { note?: string; advance?: boolean },
  ) => void
  /**
   * 作废从 kind 起的所有下游 stage（含 kind 自己）—— 用在作者从中间回退、
   * 修改 logline 后下游 outline / expansion 必须重跑的场景。
   *
   * 实现选择：直接从 records 删掉对应 entries（而不是设 status='idle'），
   * 让 UI 选择器以"records 里没 key"判定"还没走到"。stageHistory 不动，
   * 历史归档永远保留。
   */
  resetStagesFrom: (scenarioId: string, kind: ForgeStage) => void

  clearSession: (scenarioId: string) => void
}

const STORAGE_KEY = 'reel-studio:forge-chat:v1'

/**
 * 持久化形状版本：
 *   - v1：messages / attachments / draft / draftAttachmentIds / pending
 *   - v2 (2026-05)：在 v1 基础上每个 session 加 `stages: ForgeStageState`
 *     旧 v1 数据迁移：sessions[*].stages 兜成 EMPTY_STAGE_STATE（current='idle'）
 *
 * STORAGE_KEY 没改名，靠内部 version 字段判定；老用户刷一次就升级，
 * 新字段缺失时按 EMPTY 兜底，零写入失败。
 */
interface PersistShape {
  version: 1 | 2
  sessions: Record<string, ForgeSession>
}

function loadInitial(): PersistShape {
  if (typeof window === 'undefined') return { version: 2, sessions: {} }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { version: 2, sessions: {} }
    const parsed = JSON.parse(raw) as Partial<PersistShape>
    if (
      !parsed ||
      typeof parsed.sessions !== 'object' ||
      (parsed.version !== 1 && parsed.version !== 2)
    ) {
      return { version: 2, sessions: {} }
    }
    // 旧持久化数据可能没有 pending / stages 字段 —— 前向兼容补默认值，
    // 同时**清掉任何 pending 状态**：刷新时那笔请求已经丢了，不能让"锻造中"卡着。
    // stages 用 EMPTY_STAGE_STATE 兜底；如果 v1 数据有 messages 但没走过 stage 机，
    // 视作"刚开始"是合理的 —— 老消息照常显示在 messages 里，stage 机从 idle 起步。
    const sessions: Record<string, ForgeSession> = {}
    for (const [id, sess] of Object.entries(
      parsed.sessions as Record<string, Partial<ForgeSession>>,
    )) {
      sessions[id] = {
        messages: sess.messages ?? [],
        attachments: sess.attachments ?? {},
        draft: sess.draft ?? '',
        draftAttachmentIds: sess.draftAttachmentIds ?? [],
        pending: null,
        stages: hydrateStageState(sess.stages),
      }
    }
    return { version: 2, sessions }
  } catch {
    return { version: 2, sessions: {} }
  }
}

/**
 * 把任意来源的 stages 字段（可能是 undefined / 旧形状 / 新形状）规整成 ForgeStageState。
 *
 * 防御要点：
 *   - current 必须是合法 ForgeStage，否则兜成 'idle'
 *   - records 只保留 key 在 FORGE_STAGE_ORDER 内的 entry（防御未来改名）
 *   - 每个 record 的 status / attempts / draft 都做最小化兜底，未知字段直接丢
 *   - history 是 array 的就保留，否则空
 */
function hydrateStageState(raw: unknown): ForgeStageState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STAGE_STATE }
  const r = raw as Partial<ForgeStageState>
  const current: ForgeStage =
    typeof r.current === 'string' && FORGE_STAGE_ORDER.includes(r.current)
      ? r.current
      : 'idle'
  const records: ForgeStageState['records'] = {}
  if (r.records && typeof r.records === 'object') {
    for (const [k, v] of Object.entries(r.records)) {
      if (!FORGE_STAGE_ORDER.includes(k as ForgeStage)) continue
      if (!v || typeof v !== 'object') continue
      const rec = v as Partial<StageRecord>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(records as any)[k] = {
        kind: k as ForgeStage,
        status: isStageStatus(rec.status) ? rec.status : 'idle',
        // draft 不做形状校验 —— 上层选择器自己 narrow；旧版 schema 改了也不会崩
        draft: (rec.draft ?? {}) as StageDraftMap[ForgeStage],
        updatedAt: typeof rec.updatedAt === 'number' ? rec.updatedAt : Date.now(),
        attempts: Array.isArray(rec.attempts) ? rec.attempts : [],
        error: typeof rec.error === 'string' ? rec.error : undefined,
      } as StageRecord
    }
  }
  const history = Array.isArray(r.history) ? r.history : []
  return { current, records, history }
}

function isStageStatus(v: unknown): v is StageStatus {
  return (
    v === 'idle' ||
    v === 'running' ||
    v === 'await-confirm' ||
    v === 'confirmed' ||
    v === 'failed'
  )
}

function saveSnapshot(sessions: Record<string, ForgeSession>): void {
  if (typeof window === 'undefined') return
  const shape: PersistShape = { version: 2, sessions }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape))
  } catch (e) {
    // Quota 爆：降级策略 —— 每个 session 只留最新 10 条消息和最近 5 个附件。
    // **stages 与 stageHistory 整体保留**：那是作者剧本演化的骨架，比 N 条
    // 闲聊消息珍贵得多；图片附件才是真的占空间的。
    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
      const trimmed: Record<string, ForgeSession> = {}
      for (const [scenarioId, sess] of Object.entries(sessions)) {
        const keepMsgs = sess.messages.slice(-10)
        const usedAttIds = new Set<string>(sess.draftAttachmentIds)
        keepMsgs.forEach((m) => m.attachmentIds?.forEach((id) => usedAttIds.add(id)))
        const keepAtts: Record<string, Attachment> = {}
        Array.from(usedAttIds)
          .slice(-5)
          .forEach((id) => {
            const a = sess.attachments[id]
            if (a) keepAtts[id] = a
          })
        trimmed[scenarioId] = {
          ...sess,
          messages: keepMsgs,
          attachments: keepAtts,
        }
      }
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ version: 2, sessions: trimmed } as PersistShape),
        )
      } catch {
        // 还爆就彻底清空；数据丢一点总比编辑器崩好
        window.localStorage.removeItem(STORAGE_KEY)
      }
    }
  }
}

function nextId(prefix: 'att' | 'msg'): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${t}-${r}`
}

const initial = loadInitial()

export const useForgeChatStore = create<ForgeChatState>((set, get) => {
  function mutate(
    scenarioId: string,
    fn: (sess: ForgeSession) => ForgeSession,
  ): void {
    set((state) => {
      const cur = state.sessions[scenarioId] ?? EMPTY_SESSION
      const next = fn(cur)
      const sessions = { ...state.sessions, [scenarioId]: next }
      // 立即落盘 —— 见文件头注释
      saveSnapshot(sessions)
      return { sessions }
    })
  }

  return {
    sessions: initial.sessions,

    getSession: (scenarioId, episodeId) =>
      get().sessions[forgeChatSessionKey(scenarioId, episodeId)] ?? EMPTY_SESSION,

    getAttachment: (scenarioId, attId) => {
      const sess = get().sessions[scenarioId]
      return sess?.attachments[attId]
    },

    setDraft: (scenarioId, text) =>
      mutate(scenarioId, (s) => ({ ...s, draft: text })),

    addAttachment: (scenarioId, input) => {
      const full: Attachment = {
        ...input,
        id: nextId('att'),
        createdAt: Date.now(),
      } as Attachment
      mutate(scenarioId, (s) => ({
        ...s,
        attachments: { ...s.attachments, [full.id]: full },
      }))
      return full
    },

    stageAttachment: (scenarioId, attId) =>
      mutate(scenarioId, (s) =>
        s.draftAttachmentIds.includes(attId)
          ? s
          : { ...s, draftAttachmentIds: [...s.draftAttachmentIds, attId] },
      ),
    unstageAttachment: (scenarioId, attId) =>
      mutate(scenarioId, (s) => ({
        ...s,
        draftAttachmentIds: s.draftAttachmentIds.filter((id) => id !== attId),
      })),
    clearStaged: (scenarioId) =>
      mutate(scenarioId, (s) => ({ ...s, draftAttachmentIds: [] })),

    appendMessage: (scenarioId, msg) => {
      const full: ChatMessage = {
        ...msg,
        id: nextId('msg'),
        createdAt: Date.now(),
      }
      mutate(scenarioId, (s) => ({
        ...s,
        messages: [...s.messages, full],
      }))
      return full
    },

    setPending: (scenarioId, p) =>
      mutate(scenarioId, (s) => ({ ...s, pending: p })),
    appendPendingStage: (scenarioId, stage) =>
      mutate(scenarioId, (s) => {
        if (!s.pending) return s
        const next: PendingStage = { ...stage, at: Date.now() }
        return {
          ...s,
          pending: { ...s.pending, stages: [...s.pending.stages, next] },
        }
      }),
    appendPendingDelta: (scenarioId, delta) =>
      mutate(scenarioId, (s) => {
        if (!s.pending) return s
        const tailNext = (s.pending.streamTail + delta).slice(-STREAM_TAIL_MAX)
        return {
          ...s,
          pending: {
            ...s.pending,
            streamTail: tailNext,
            streamBytes: s.pending.streamBytes + delta.length,
          },
        }
      }),
    archiveStagesToMessage: (scenarioId, messageId, opts = {}) =>
      mutate(scenarioId, (s) => {
        if (!s.pending) return s
        const { aborted } = opts
        const elapsedMs = Date.now() - s.pending.startedAt
        // 中断时在末尾追加一条"已中断"标记，方便后续阅读历史时一眼识别
        const archive: PendingStage[] = aborted
          ? [
              ...s.pending.stages,
              {
                label: '作者中断',
                detail: `已运行 ${Math.round(elapsedMs / 1000)}s`,
                at: Date.now(),
              },
            ]
          : s.pending.stages
        const messages = s.messages.map((m) =>
          m.id === messageId
            ? {
                ...m,
                stagesArchive: archive,
                forgeElapsedMs: elapsedMs,
                ...(aborted ? { aborted: true } : {}),
              }
            : m,
        )
        return { ...s, messages }
      }),
    clearPending: (scenarioId) =>
      mutate(scenarioId, (s) => ({ ...s, pending: null })),

    // ─── v3.10 · 模块化 stage 机 ───
    setStage: (scenarioId, stage) =>
      mutate(scenarioId, (s) => ({
        ...s,
        stages: { ...s.stages, current: stage },
      })),

    setStageDraft: (scenarioId, kind, draft) =>
      mutate(scenarioId, (s) => {
        const prev = s.stages.records[kind] as StageRecord | undefined
        const next: StageRecord = {
          kind,
          status: prev?.status ?? 'idle',
          // draft 的具体形状由调用方保证；store 不做形状校验，只透传
          draft: draft as StageDraftMap[ForgeStage],
          updatedAt: Date.now(),
          attempts: prev?.attempts ?? [],
          error: prev?.error,
        }
        return {
          ...s,
          stages: {
            ...s.stages,
            records: { ...s.stages.records, [kind]: next },
          },
        }
      }),

    setStageStatus: (scenarioId, kind, status, error) =>
      mutate(scenarioId, (s) => {
        const prev = s.stages.records[kind] as StageRecord | undefined
        // 没 record 就开一个空的 —— 让 UI 能立刻渲染"running 中"骨架
        const base: StageRecord = prev ?? {
          kind,
          status: 'idle',
          draft: {} as StageDraftMap[ForgeStage],
          updatedAt: Date.now(),
          attempts: [],
        }
        const next: StageRecord = {
          ...base,
          status,
          updatedAt: Date.now(),
          // 'failed' 时写错误；其他状态清掉旧错误（避免老红字阴魂不散）
          error: status === 'failed' ? error : undefined,
        }
        return {
          ...s,
          stages: {
            ...s.stages,
            records: { ...s.stages.records, [kind]: next },
          },
        }
      }),

    beginStageAttempt: (scenarioId, kind) =>
      mutate(scenarioId, (s) => {
        const prev = s.stages.records[kind] as StageRecord | undefined
        if (!prev) return s
        const next: StageRecord = {
          ...prev,
          status: 'running',
          updatedAt: Date.now(),
          attempts: [
            ...prev.attempts,
            { draft: prev.draft, updatedAt: prev.updatedAt },
          ],
          error: undefined,
        }
        return {
          ...s,
          stages: {
            ...s.stages,
            records: { ...s.stages.records, [kind]: next },
          },
        }
      }),

    confirmStage: (scenarioId, kind, opts = {}) =>
      mutate(scenarioId, (s) => {
        const prev = s.stages.records[kind] as StageRecord | undefined
        if (!prev) return s
        if (prev.status === 'confirmed') return s
        const advance = opts.advance ?? true
        const idx = FORGE_STAGE_ORDER.indexOf(kind)
        const nextStage =
          advance && idx >= 0 && idx < FORGE_STAGE_ORDER.length - 1
            ? FORGE_STAGE_ORDER[idx + 1]!
            : s.stages.current
        const recordNext: StageRecord = {
          ...prev,
          status: 'confirmed',
          updatedAt: Date.now(),
          error: undefined,
        }
        const historyEntry: StageHistoryEntry = {
          kind,
          draft: prev.draft,
          at: Date.now(),
          note: opts.note,
        }
        return {
          ...s,
          stages: {
            ...s.stages,
            current: nextStage,
            records: { ...s.stages.records, [kind]: recordNext },
            history: [...s.stages.history, historyEntry],
          },
        }
      }),

    resetStagesFrom: (scenarioId, kind) =>
      mutate(scenarioId, (s) => {
        const idx = FORGE_STAGE_ORDER.indexOf(kind)
        if (idx < 0) return s
        // 收集需要被丢弃的 stage key
        const toDrop = new Set<ForgeStage>(FORGE_STAGE_ORDER.slice(idx))
        const recordsNext: ForgeStageState['records'] = {}
        for (const [k, v] of Object.entries(s.stages.records)) {
          if (toDrop.has(k as ForgeStage)) continue
          // mapped type `{ [K in ForgeStage]?: StageRecord<K> }` 在按 key 赋值时
          // 推不出泛型 K，二次 cast 是普遍做法
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(recordsNext as any)[k] = v as StageRecord
        }
        // current 如果落在被丢弃的范围内，回退到 kind 的上一阶段（让 UI 焦点回到
        // 上游"待修订"那段）；如果 current 在 kind 之前则保持不动
        const curIdx = FORGE_STAGE_ORDER.indexOf(s.stages.current)
        const nextCurrent: ForgeStage =
          curIdx >= idx
            ? (FORGE_STAGE_ORDER[Math.max(0, idx - 1)] as ForgeStage)
            : s.stages.current
        return {
          ...s,
          stages: {
            ...s.stages,
            current: nextCurrent,
            records: recordsNext,
            // history 不动 —— 归档永远保留
          },
        }
      }),

    clearSession: (scenarioId) =>
      mutate(scenarioId, () => ({ ...EMPTY_SESSION })),
  }
})

/** 测试 / 调试用 —— 清空全部会话 + localStorage */
export function __resetForgeChatForTest(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // noop
    }
  }
  useForgeChatStore.setState({ sessions: {} })
}

export const __FORGE_CHAT_STORAGE_KEY__ = STORAGE_KEY
