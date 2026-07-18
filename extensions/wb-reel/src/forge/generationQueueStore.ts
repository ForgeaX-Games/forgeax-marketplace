/**
 * `generationQueueStore` —— 统一的生成任务队列（图像 / 视频 / 音频分池并发）。
 *
 * 为什么要它（作者 2026-06）：
 *   · 原来每张卡片各自 `await generateOne()`，「一键全部」只用一个固定 runPool(3)，
 *     视频/音频/图像混在一起、并发写死、看不到全局进度、不能暂停/取消/重试。
 *   · litellm 统一代理内置并发 100 后，瓶颈从单 deployment 限速转移到代理侧，
 *     需要一个「能把并发开大、又能可视化/可控」的中央调度器。
 *
 * 设计要点：
 *   · **分池并发**：image / video / audio 各自独立并发上限，
 *     读 settingsStore.genConcurrency（运行时可调），默认 6/6/4。
 *   · **纯内存**：job 里带 run 闭包（不可序列化），不持久化。
 *     视频长任务的「刷新/切 tab 接盘」由既有 videoTaskStore 负责（generateCardVideo 内部已写入）。
 *   · **取消语义**：queued → 直接出队；running → 标记 cancelled 并 abort（best-effort，
 *     底层 fetch 不一定支持 signal，但其结果会被丢弃，不写回素材）。
 *   · **重试**：失败/取消的 job 可原样重新入队（保留 run 闭包）。
 *
 * 安全：本模块不接触任何 key/host —— run 闭包内部调 provider，
 *   provider 的凭据全部来自 settingsStore（build-time 注入），队列只调度不传密钥。
 */
import { create } from 'zustand'
import { getGenConcurrency } from '../scenario/settingsStore'
import { gameKeySuffix } from '../shell/gameScope'

export type GenJobKind = 'image' | 'video' | 'audio'
export type GenJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled'

/**
 * 一张「上传的参考素材」—— 进入视频/图像模型的输入之一。
 * role 用模型侧的语义角色名，便于作者一眼看出「这张图是当首帧 / 参考 / 尾帧」。
 */
export interface GenRequestRef {
  role: 'first_frame' | 'last_frame' | 'reference_image' | 'reference_video' | 'reference_audio'
  /** 素材 URL（mediaStore/asset URL 或 data URL）。持久化时会丢弃超长/ data: URL。 */
  url: string
  label?: string
  /**
   * 该参考素材的 mediaId（若已知）。持久化时 url 里的 data: / 超长 URL 会被裁掉，
   * 但 mediaId 很短、始终保留 —— 查看时可据它从 mediaStore **重新解析**出可显示的
   * 缩略图，从而「刷新/跨 iframe 后仍能看到用了哪张参考图（角色/场景/道具锚点）」。
   */
  mediaId?: string
}

/**
 * 「请求快照」—— 一个生成 job **真正发给模型的东西**：提示词 + 参数 + 上传的参考素材。
 * 在 run 真正发起请求前由 generateCardVideo 等写入 job.request，**成功失败都留底**，
 * 让作者能在队列里一键查看「到底上传了什么、提示词是什么」，排查失败。
 */
export interface GenRequestSnapshot {
  /** 人类可读的目标端点/模型（如「Seedance 2.0 · 图生视频」） */
  endpoint?: string
  prompt: string
  /** 关键参数（mode / ratio / resolution / seconds / generateAudio / model …） */
  params: Record<string, string | number | boolean>
  /** 随请求上传的参考素材（首尾帧 / 参考图 / 参考视频 / 参考音频） */
  refs: GenRequestRef[]
  /** 写入时间戳 */
  at: number
}

export interface GenJobRunCtx {
  signal: AbortSignal
  onStage: (stage: string) => void
  /** 在发起模型请求前调用，记录「发了什么」到 job.request（成功失败都可回看）。 */
  setRequest: (req: GenRequestSnapshot) => void
}

/**
 * 可序列化的「配方」—— job 的 run/onDone 闭包不可持久化，但只要记下「用什么配方
 * + 什么参数」就能在刷新/重开后**重建**同一个 job。带 recipe 的 job 会被落盘，
 * 启动时由 resumeGenerationQueue 按当前剧本/素材重建并重新入队（见底部注册表）。
 *
 * 约定：args 必须是纯可 JSON 化对象；工厂在 resume 时按「当前」剧本状态重建闭包
 * （而非持久化时的快照），所以参考图/提示词都用最新值，且已完成的镜应幂等跳过。
 */
export interface GenRecipe {
  type: string
  args: unknown
}

export interface GenJobInput {
  kind: GenJobKind
  /** 人类可读标签，队列面板展示用（如「视频 · 场景3 镜2」） */
  label: string
  /**
   * 可选「配方」—— 提供后该 job 会被持久化，刷新/切页/重开能自动接盘续跑。
   * 不提供则仅存内存（ad-hoc 任务，刷新即丢，符合一次性手点的语义）。
   */
  recipe?: GenRecipe
  sceneId?: string
  shotId?: string
  /**
   * 稳定的「卡片键」—— 把一个 job 绑定到某张素材卡，让卡片能订阅自己的实时
   * 状态/进度/失败原因（见 useCardJob）。约定命名空间：
   *   · `audition:<characterId>`   角色试镜视频
   *   · `scene:<sceneId>:<cardId>` 场景/道具/自由卡（按需）
   * 同一 cardKey 只保留「最近一次」job 作为该卡的当前状态（重生会覆盖）。
   */
  cardKey?: string
  /** 编排批次 id —— 同一次「一键编排」生成的 job 共享，便于聚合进度 */
  group?: string
  /** 真正干活的闭包；返回 mediaId（或 void）。抛错视为失败。 */
  run: (ctx: GenJobRunCtx) => Promise<string | void>
  /** 成功回调（如自动采用写回 shot.videoMediaRef） */
  onDone?: (mediaId: string | undefined) => void
}

export interface GenJob extends GenJobInput {
  id: string
  status: GenJobStatus
  stage?: string
  error?: string
  resultMediaId?: string
  /** run 发起请求前写入的「发了什么」快照（prompt + 参数 + 上传的参考素材）。 */
  request?: GenRequestSnapshot
  attempts: number
  createdAt: number
  startedAt?: number
  finishedAt?: number
}

interface QueueState {
  jobs: Record<string, GenJob>
  /** 入队顺序（FIFO 调度） */
  order: string[]
  paused: boolean

  enqueue: (input: GenJobInput) => string
  enqueueMany: (inputs: GenJobInput[]) => string[]
  /**
   * 以「失败」终态恢复一个 job（刷新接盘用）——保留错误文案、可手动重试，但**不**
   * 自动重跑（风控/参数类必失败的镜不该刷新一次就重扣一次费）。
   * request 为持久化的请求快照（prompt+参数+参考素材），刷新后仍可回看。
   */
  restoreFailed: (
    input: GenJobInput,
    error: string,
    request?: GenRequestSnapshot,
  ) => string
  pause: () => void
  resume: () => void
  cancel: (id: string) => void
  /** 取消全部（可按 group / kind 过滤）；不影响已 done。 */
  cancelAll: (filter?: { group?: string; kind?: GenJobKind }) => void
  retry: (id: string) => void
  clearFinished: () => void
  /** 调度泵 —— 内部用，状态变化后自动调用。 */
  pump: () => void
}

/** AbortController 放模块级，避免进 store（不可序列化、无需触发渲染）。 */
const controllers = new Map<string, AbortController>()

function genId(): string {
  return `gj-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

function capFor(kind: GenJobKind): number {
  const c = getGenConcurrency()
  return kind === 'image' ? c.image : kind === 'video' ? c.video : c.audio
}

export const useGenerationQueue = create<QueueState>((set, get) => ({
  jobs: {},
  order: [],
  paused: false,

  enqueue: (input) => {
    const id = genId()
    const job: GenJob = {
      ...input,
      id,
      status: 'queued',
      attempts: 0,
      createdAt: Date.now(),
    }
    set((s) => ({ jobs: { ...s.jobs, [id]: job }, order: [...s.order, id] }))
    get().pump()
    return id
  },

  enqueueMany: (inputs) => {
    const ids: string[] = []
    const now = Date.now()
    set((s) => {
      const jobs = { ...s.jobs }
      const order = [...s.order]
      inputs.forEach((input) => {
        const id = genId()
        ids.push(id)
        jobs[id] = { ...input, id, status: 'queued', attempts: 0, createdAt: now }
        order.push(id)
      })
      return { jobs, order }
    })
    get().pump()
    return ids
  },

  restoreFailed: (input, error, request) => {
    const id = genId()
    const now = Date.now()
    const job: GenJob = {
      ...input,
      id,
      status: 'failed',
      error,
      request,
      attempts: 1,
      createdAt: now,
      finishedAt: now,
    }
    // 不调 pump：失败终态恢复，等用户手动 ↻ 重试。
    set((s) => ({ jobs: { ...s.jobs, [id]: job }, order: [...s.order, id] }))
    return id
  },

  pause: () => set({ paused: true }),

  resume: () => {
    set({ paused: false })
    get().pump()
  },

  cancel: (id) => {
    const job = get().jobs[id]
    if (!job) return
    if (job.status === 'running') {
      controllers.get(id)?.abort()
    }
    if (job.status === 'queued' || job.status === 'running') {
      set((s) => ({
        jobs: {
          ...s.jobs,
          [id]: { ...job, status: 'cancelled', finishedAt: Date.now(), stage: undefined },
        },
      }))
    }
    get().pump()
  },

  cancelAll: (filter) => {
    const { jobs } = get()
    for (const job of Object.values(jobs)) {
      if (job.status !== 'queued' && job.status !== 'running') continue
      if (filter?.group && job.group !== filter.group) continue
      if (filter?.kind && job.kind !== filter.kind) continue
      if (job.status === 'running') controllers.get(job.id)?.abort()
    }
    set((s) => {
      const next = { ...s.jobs }
      for (const job of Object.values(s.jobs)) {
        if (job.status !== 'queued' && job.status !== 'running') continue
        if (filter?.group && job.group !== filter.group) continue
        if (filter?.kind && job.kind !== filter.kind) continue
        next[job.id] = { ...job, status: 'cancelled', finishedAt: Date.now(), stage: undefined }
      }
      return { jobs: next }
    })
  },

  retry: (id) => {
    const job = get().jobs[id]
    if (!job) return
    if (job.status !== 'failed' && job.status !== 'cancelled') return
    set((s) => ({
      jobs: {
        ...s.jobs,
        [id]: {
          ...job,
          status: 'queued',
          error: undefined,
          stage: undefined,
          finishedAt: undefined,
          startedAt: undefined,
        },
      },
      // 重排到队尾
      order: [...s.order.filter((x) => x !== id), id],
    }))
    get().pump()
  },

  clearFinished: () => {
    set((s) => {
      const jobs: Record<string, GenJob> = {}
      const order: string[] = []
      for (const id of s.order) {
        const j = s.jobs[id]
        if (!j) continue
        if (j.status === 'done' || j.status === 'failed' || j.status === 'cancelled') continue
        jobs[id] = j
        order.push(id)
      }
      return { jobs, order }
    })
  },

  pump: () => {
    const { paused, jobs, order } = get()
    if (paused) return

    // 统计当前 running 各池占用
    const running: Record<GenJobKind, number> = { image: 0, video: 0, audio: 0 }
    for (const j of Object.values(jobs)) {
      if (j.status === 'running') running[j.kind] += 1
    }

    for (const id of order) {
      const job = jobs[id]
      if (!job || job.status !== 'queued') continue
      if (running[job.kind] >= capFor(job.kind)) continue
      running[job.kind] += 1
      startJob(id)
    }
  },
}))

function startJob(id: string): void {
  const store = useGenerationQueue
  const job = store.getState().jobs[id]
  if (!job || job.status !== 'queued') return

  const ctrl = new AbortController()
  controllers.set(id, ctrl)

  store.setState((s) => ({
    jobs: {
      ...s.jobs,
      [id]: { ...job, status: 'running', startedAt: Date.now(), attempts: job.attempts + 1 },
    },
  }))

  const onStage = (stage: string): void => {
    const cur = store.getState().jobs[id]
    if (!cur || cur.status !== 'running') return
    store.setState((s) => ({ jobs: { ...s.jobs, [id]: { ...cur, stage } } }))
  }

  // 记录「发给模型的东西」—— 即使后续失败/取消也保留，供队列里回看排查。
  const setRequest = (req: GenRequestSnapshot): void => {
    const cur = store.getState().jobs[id]
    if (!cur) return
    store.setState((s) => ({ jobs: { ...s.jobs, [id]: { ...cur, request: req } } }))
  }

  job
    .run({ signal: ctrl.signal, onStage, setRequest })
    .then((mediaId) => {
      controllers.delete(id)
      const cur = store.getState().jobs[id]
      // 期间被取消 → 丢弃结果
      if (!cur || cur.status === 'cancelled') {
        store.getState().pump()
        return
      }
      const resultMediaId = typeof mediaId === 'string' ? mediaId : undefined
      const doneJob: GenJob = {
        ...cur,
        status: 'done',
        resultMediaId,
        stage: undefined,
        finishedAt: Date.now(),
      }
      store.setState((s) => ({ jobs: { ...s.jobs, [id]: doneJob } }))
      // 把「发了什么」归档，供刷新/跨 iframe 后仍能在素材库/时间轴看参数（不进活动队列）。
      try {
        archiveDoneRequest(doneJob)
      } catch {
        /* 归档失败不影响主流程 */
      }
      try {
        job.onDone?.(resultMediaId)
      } catch (e) {
        console.warn('[generationQueue] onDone failed:', e)
      }
      store.getState().pump()
    })
    .catch((err: unknown) => {
      controllers.delete(id)
      const cur = store.getState().jobs[id]
      if (!cur || cur.status === 'cancelled') {
        store.getState().pump()
        return
      }
      store.setState((s) => ({
        jobs: {
          ...s.jobs,
          [id]: {
            ...cur,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            stage: undefined,
            finishedAt: Date.now(),
          },
        },
      }))
      store.getState().pump()
    })
}

/**
 * 取某张卡片（cardKey）当前对应的 job —— 即最近一次入队的、cardKey 相同的 job。
 * 用 createdAt 取最新一条（重生会产生新 job，覆盖旧状态展示）。非 React 读。
 */
export function cardJobOf(cardKey: string): GenJob | undefined {
  let latest: GenJob | undefined
  for (const j of Object.values(useGenerationQueue.getState().jobs)) {
    if (j.cardKey !== cardKey) continue
    if (!latest || j.createdAt > latest.createdAt) latest = j
  }
  return latest
}

/**
 * 取某一镜（sceneId + shotId）最近一次的生成 job —— 用于时间轴上双击/右键某段视频/
 * 关键帧时回看「这一镜是怎么生成的」（提示词 / 上传的参考素材 / 参数 / 报错）。非 React 读。
 *
 * kind 可选：同一镜可能同时有「关键帧(image)」与「逐镜视频(video)」两条 job，
 *   时间轴图像轨右键传 'image'、视频轨右键传 'video'，各自命中正确的那条；
 *   不传则返回该镜最近一条（不分类型）。
 */
export function jobForShot(sceneId: string, shotId: string, kind?: GenJobKind): GenJob | undefined {
  let latest: GenJob | undefined
  for (const j of Object.values(useGenerationQueue.getState().jobs)) {
    if (j.sceneId !== sceneId || j.shotId !== shotId) continue
    if (kind && j.kind !== kind) continue
    if (!latest || j.createdAt > latest.createdAt) latest = j
  }
  return latest
}

/**
 * 取产出了某个 mediaId 的生成 job（按结果素材反查），用于场景级单条视频/关键帧的回看。
 *   优先内存活动队列里**带请求快照**的最近一条（含完整 url，可显示缩略图）；
 *   内存找不到（已清理 / 跨 iframe / 刷新）时回退到 localStorage 请求归档。非 React 读。
 */
export function jobForMedia(mediaId: string): GenJob | undefined {
  if (!mediaId) return undefined
  let latest: GenJob | undefined
  for (const j of Object.values(useGenerationQueue.getState().jobs)) {
    if (j.resultMediaId !== mediaId) continue
    if (!latest || j.createdAt > latest.createdAt) latest = j
  }
  // 内存命中但无请求快照时，仍尝试归档兜底（归档里可能有更完整的 prompt/参考）。
  if (latest?.request) return latest
  return archivedJobForMedia(mediaId) ?? latest
}

// ─────────────────────────────────────────────────────────────────────────────
// 已完成生成的「请求快照」归档 —— 让「看参数」跨刷新/跨 iframe 存活。
//
// 背景（作者反馈）：新出的逐镜视频在素材库/时间轴上点「查看生成记录」常报「没找到」，
//   因为活动队列是纯内存、done 不持久化、且 split-pane 跨 iframe 不共享内存。
//   这里把每个**成功完成**的 job 的请求快照（prompt+参数+参考）按 sceneId:shotId 和
//   resultMediaId 双键归档到 localStorage（裁掉超长/ data: URL），刷新/跨页后仍可回看，
//   不进活动队列面板（避免老 done 反复刷屏）。
// ─────────────────────────────────────────────────────────────────────────────

interface ArchivedRequest {
  kind: GenJobKind
  label: string
  sceneId?: string
  shotId?: string
  resultMediaId?: string
  request: GenRequestSnapshot
  at: number
}

const REQ_ARCHIVE_CAP = 240

function reqArchiveKey(): string {
  return `reel-studio:gen-req-archive:v1${gameKeySuffix()}`
}

function loadReqArchive(): ArchivedRequest[] {
  if (isPersistDisabled()) return []
  try {
    const raw = window.localStorage.getItem(reqArchiveKey())
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? (arr as ArchivedRequest[]) : []
  } catch {
    return []
  }
}

function saveReqArchive(list: ArchivedRequest[]): void {
  if (isPersistDisabled()) return
  try {
    // 只留最近 CAP 条，避免 localStorage 无限增长。
    const trimmed = list.slice(-REQ_ARCHIVE_CAP)
    window.localStorage.setItem(reqArchiveKey(), JSON.stringify(trimmed))
  } catch {
    /* 配额满/不可用 —— best-effort */
  }
}

/** 成功完成且带请求快照的 job → 归档（裁掉超长 URL）。同键去重保留最新。 */
function archiveDoneRequest(job: GenJob): void {
  if (!job.request) return
  const trimmed = trimRequestForPersist(job.request)
  if (!trimmed) return
  const entry: ArchivedRequest = {
    kind: job.kind,
    label: job.label,
    sceneId: job.sceneId,
    shotId: job.shotId,
    resultMediaId: job.resultMediaId,
    request: trimmed,
    at: Date.now(),
  }
  const list = loadReqArchive().filter((a) => {
    // 同一镜同类型 / 同 mediaId 的旧归档去掉，保留这条最新。
    if (entry.resultMediaId && a.resultMediaId === entry.resultMediaId) return false
    if (
      entry.sceneId &&
      entry.shotId &&
      a.sceneId === entry.sceneId &&
      a.shotId === entry.shotId &&
      a.kind === entry.kind
    )
      return false
    return true
  })
  list.push(entry)
  saveReqArchive(list)
}

/**
 * 直接归档一条「请求快照 ↔ 产物 mediaId」—— 供**不走生成队列**的路径（如素材库手点
 * 视频卡）调用，使其生成信息（prompt/参数/角色·场景·道具锚点参考）同样能在卡片
 * 「ⓘ 生成信息」里按 mediaId 回看。语义与 archiveDoneRequest 一致（同键去重保留最新）。
 */
export function archiveRequestForMedia(input: {
  kind: GenJobKind
  label: string
  sceneId?: string
  shotId?: string
  resultMediaId: string
  request: GenRequestSnapshot
}): void {
  archiveDoneRequest({
    id: `adhoc-${Date.now().toString(36)}`,
    kind: input.kind,
    label: input.label,
    sceneId: input.sceneId,
    shotId: input.shotId,
    status: 'done',
    request: input.request,
    resultMediaId: input.resultMediaId,
    attempts: 1,
    createdAt: Date.now(),
    finishedAt: Date.now(),
    run: async () => undefined,
  })
}

/** 把归档记录还原成一个「已完成」的最小 GenJob，供 GenRequestDialog 直接渲染。 */
function archivedToJob(a: ArchivedRequest): GenJob {
  return {
    id: `arch-${a.at.toString(36)}`,
    kind: a.kind,
    label: a.label,
    sceneId: a.sceneId,
    shotId: a.shotId,
    status: 'done',
    request: a.request,
    resultMediaId: a.resultMediaId,
    attempts: 1,
    createdAt: a.at,
    finishedAt: a.at,
    run: async () => undefined,
  }
}

/** 从归档里找某一镜最近一次的请求快照（活动队列里找不到时的兜底）。 */
export function archivedJobForShot(
  sceneId: string,
  shotId: string,
  kind?: GenJobKind,
): GenJob | undefined {
  let latest: ArchivedRequest | undefined
  for (const a of loadReqArchive()) {
    if (a.sceneId !== sceneId || a.shotId !== shotId) continue
    if (kind && a.kind !== kind) continue
    if (!latest || a.at > latest.at) latest = a
  }
  return latest ? archivedToJob(latest) : undefined
}

/** 从归档里按产物 mediaId 找请求快照。 */
export function archivedJobForMedia(mediaId: string): GenJob | undefined {
  let latest: ArchivedRequest | undefined
  for (const a of loadReqArchive()) {
    if (a.resultMediaId !== mediaId) continue
    if (!latest || a.at > latest.at) latest = a
  }
  return latest ? archivedToJob(latest) : undefined
}

/**
 * React hook：订阅某张卡片的当前 job 状态（排队 / 生成中+阶段 / 失败+原因 / 完成）。
 * cardKey 为空时返回 undefined（不订阅）。卡片用它渲染状态浮层 + 重试按钮。
 */
export function useCardJob(cardKey: string | undefined): GenJob | undefined {
  return useGenerationQueue((s) => {
    if (!cardKey) return undefined
    let latest: GenJob | undefined
    for (const j of Object.values(s.jobs)) {
      if (j.cardKey !== cardKey) continue
      if (!latest || j.createdAt > latest.createdAt) latest = j
    }
    return latest
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// 持久化 + 刷新/重开接盘
//
// 背景（作者 2026-06，反复踩坑）：
//   "我让他生成了剧情视频，等了很久也没有，生成队列里也没看到。"
//   根因：本队列是纯内存的，agent→工坊的产线请求是一次性消费（取走即删）。任何
//   整页刷新（HMR / 手动刷新 / 关页重开）都会把在途 job 连同 run 闭包一起清空，
//   而被消费掉的产线请求又不会再触发 → 视频凭空消失、谁也接不上。
//
// 方案：带 recipe 的 job 落 localStorage（按 game 作用域隔离），启动时
//   resumeGenerationQueue() 读回未完成的，用注册表里的工厂**按当前剧本重建**
//   run/onDone 并重新入队。已完成/已绑定的镜由工厂自身幂等跳过，避免重复出片。
// ─────────────────────────────────────────────────────────────────────────────

/** recipe.type → 工厂：按 args + 当前剧本/素材重建一个可入队的 GenJobInput。 */
const recipeRegistry = new Map<string, (args: unknown) => GenJobInput | null>()

/**
 * 注册一种可恢复任务的重建工厂。工厂应：
 *   · 读「当前」剧本/素材状态重建 run/onDone（不要依赖持久化时的快照）；
 *   · 若该任务已无意义（镜已绑定视频 / 角色已有试镜 / 目标已不存在）返回 null；
 *   · 原样带上同一个 recipe，使其二次刷新仍能接盘。
 */
export function registerGenRecipe(
  type: string,
  factory: (args: unknown) => GenJobInput | null,
): void {
  recipeRegistry.set(type, factory)
}

interface PersistedGenJob {
  kind: GenJobKind
  label: string
  sceneId?: string
  shotId?: string
  cardKey?: string
  group?: string
  recipe: GenRecipe
  createdAt: number
  /** 持久化时的状态：'queued'（含 running 归一）自动续跑；'failed' 恢复为失败态保留错误。 */
  status: 'queued' | 'failed'
  /** status='failed' 时的错误文案（刷新后仍可查看/复制）。 */
  error?: string
  /** status='failed' 时的请求快照（已裁掉超长/ data: URL），刷新后仍可查看「发了什么」。 */
  request?: GenRequestSnapshot
}

/**
 * 裁剪请求快照以便落 localStorage：丢弃 data: / 超长 URL（避免撑爆配额），
 * 但保留 role/label，刷新后作者仍能看到「上传过哪几张、各是什么角色」。
 */
function trimRequestForPersist(req: GenRequestSnapshot | undefined): GenRequestSnapshot | undefined {
  if (!req) return undefined
  return {
    ...req,
    refs: req.refs.map((r) => ({
      role: r.role,
      label: r.label,
      // mediaId 很短、始终保留：刷新后即便 url 被裁掉，也能据 mediaId 重解析缩略图。
      mediaId: r.mediaId,
      url: r.url.startsWith('data:') || r.url.length > 2048 ? '' : r.url,
    })),
  }
}

function persistKey(): string {
  return `reel-studio:gen-queue:v1${gameKeySuffix()}`
}

function isPersistDisabled(): boolean {
  if (typeof window === 'undefined') return true
  if (typeof process !== 'undefined' && process.env?.VITEST === 'true') return true
  return false
}

/**
 * 序列化「带 recipe」的 job：
 *   · queued/running → 存为 'queued'（刷新后自动续跑）
 *   · failed         → 存为 'failed'（保留错误，刷新后恢复为失败态、可手动重试）
 * done/cancelled 不持久化（已完成/主动取消，无需接盘）。
 */
function snapshotForPersist(): PersistedGenJob[] {
  const { jobs, order } = useGenerationQueue.getState()
  const out: PersistedGenJob[] = []
  for (const id of order) {
    const j = jobs[id]
    if (!j || !j.recipe) continue
    const status: 'queued' | 'failed' | null =
      j.status === 'queued' || j.status === 'running'
        ? 'queued'
        : j.status === 'failed'
          ? 'failed'
          : null
    if (!status) continue
    out.push({
      kind: j.kind,
      label: j.label,
      sceneId: j.sceneId,
      shotId: j.shotId,
      cardKey: j.cardKey,
      group: j.group,
      recipe: j.recipe,
      createdAt: j.createdAt,
      status,
      error: status === 'failed' ? j.error : undefined,
      request: status === 'failed' ? trimRequestForPersist(j.request) : undefined,
    })
  }
  return out
}

let _persistTimer: ReturnType<typeof setTimeout> | null = null

function schedulePersist(): void {
  if (isPersistDisabled()) return
  if (_persistTimer) clearTimeout(_persistTimer)
  _persistTimer = setTimeout(() => {
    _persistTimer = null
    try {
      const snap = snapshotForPersist()
      if (snap.length === 0) window.localStorage.removeItem(persistKey())
      else window.localStorage.setItem(persistKey(), JSON.stringify(snap))
    } catch {
      /* localStorage 满/不可用 —— best-effort，丢失持久化不影响内存运行 */
    }
  }, 600)
}

function loadPersisted(): PersistedGenJob[] {
  if (isPersistDisabled()) return []
  try {
    const raw = window.localStorage.getItem(persistKey())
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (x): x is PersistedGenJob =>
        !!x && typeof x === 'object' && !!(x as PersistedGenJob).recipe,
    )
  } catch {
    return []
  }
}

/**
 * 应用启动时接盘上次未完成的任务（刷新/切页/关页重开都会触发）。
 *
 * 用 recipe 注册表按**当前**剧本重建 run/onDone 再入队；已在跑同卡/同镜的 job
 * 不重复入队（去重）；已完成（如镜已绑定视频）由工厂返回 null 跳过。
 * 返回成功接盘的任务数。在 App 顶层（scenario hydrate 之后）调用一次。
 */
export function resumeGenerationQueue(opts?: { onLog?: (m: string) => void }): number {
  const persisted = loadPersisted()
  if (persisted.length === 0) return 0

  const store = useGenerationQueue.getState()
  const activeCardKeys = new Set<string>()
  const activeShotKeys = new Set<string>()
  for (const j of Object.values(store.jobs)) {
    if (j.status !== 'queued' && j.status !== 'running') continue
    if (j.cardKey) activeCardKeys.add(j.cardKey)
    if (j.sceneId && j.shotId) activeShotKeys.add(`${j.sceneId}:${j.shotId}`)
  }

  let resumed = 0
  let restoredFailed = 0
  let skipped = 0
  for (const p of persisted) {
    const factory = recipeRegistry.get(p.recipe.type)
    if (!factory) continue
    if (p.cardKey && activeCardKeys.has(p.cardKey)) continue
    if (p.sceneId && p.shotId && activeShotKeys.has(`${p.sceneId}:${p.shotId}`)) continue
    let input: GenJobInput | null = null
    try {
      input = factory(p.recipe.args)
    } catch {
      input = null
    }
    if (!input) {
      skipped += 1
      continue
    }
    if (p.status === 'failed') {
      // 恢复为失败态：保留错误文案 + 请求快照可查看/复制，等用户手动重试（不自动重跑）。
      store.restoreFailed(input, p.error || '失败（已从上次会话恢复）', p.request)
      restoredFailed += 1
    } else {
      store.enqueue(input)
      resumed += 1
    }
    if (input.cardKey) activeCardKeys.add(input.cardKey)
    if (input.sceneId && input.shotId) activeShotKeys.add(`${input.sceneId}:${input.shotId}`)
  }

  opts?.onLog?.(
    `[gen-queue] 刷新接盘：续跑 ${resumed} 个未完成` +
      (restoredFailed > 0 ? `，保留 ${restoredFailed} 个失败项` : '') +
      (skipped > 0 ? `（${skipped} 个已完成/失效，跳过）` : ''),
  )
  return resumed + restoredFailed
}

// 任意队列状态变化后（入队/状态流转/重试/清理）异步落盘一次（debounce 内已收敛）。
if (!isPersistDisabled()) {
  useGenerationQueue.subscribe(schedulePersist)
}

/** 非 React 读取队列汇总（编排/面板用）。 */
export function queueSummary(group?: string): {
  total: number
  queued: number
  running: number
  done: number
  failed: number
  cancelled: number
} {
  const jobs = Object.values(useGenerationQueue.getState().jobs).filter(
    (j) => !group || j.group === group,
  )
  return {
    total: jobs.length,
    queued: jobs.filter((j) => j.status === 'queued').length,
    running: jobs.filter((j) => j.status === 'running').length,
    done: jobs.filter((j) => j.status === 'done').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
    cancelled: jobs.filter((j) => j.status === 'cancelled').length,
  }
}
