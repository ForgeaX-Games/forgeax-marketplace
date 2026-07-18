import type { Scene, ScenePrompts } from './types'

/**
 * StreamingState —— 长文本分段管线的"未持久化"运行时状态。
 *
 * ## 为什么单开一个 state 字段而不是塞进 scenario？
 *
 * Plan 5.（风险与回退）明确要求：
 *   "Player 三态破坏现有快照：三态字段命名为 `_streamingState`，下沉到 store derived，
 *    **不**进入 graph.json 的持久化字段，刷新页面回到稳定态"
 *
 * scenarioStore 的 zundo `partialize` 只跟踪 `scenario` 一字段；exportJSON / persist
 * 也只读 `scenario`。把流式状态放到 store 根的 `streaming` 字段：
 *   - 不进 zundo 历史栈（撤销不会回到"半成品"中间态）
 *   - 不入 localStorage / 历史归档
 *   - 不写到导出 JSON
 *   - 刷新页面 → 重置到 null（与 plan 一致）
 *
 * ## 状态机（per-node）
 *
 *   skeleton          ←  Act 骨架已出，节点已存在但 prompts 为空 / 占位
 *   prompts-ready     ←  三件套 prompts 到位，可以"生素材"
 *   assets-ready      ←  关键帧 / 视频 / 音频 全都生好
 *
 * 升迁是单调的：skeleton → prompts-ready → assets-ready。Player 据此切 UI 装饰。
 *
 * ## 状态机（per-act）
 *
 *   queued       ← act 的骨架已 append；prompts 还没批量出
 *   forging      ← 当前 batch-prompt-trio LLM 正在为这个 act 调
 *   ready        ← act 内所有节点 prompts-ready
 *   failed       ← act 级 LLM 失败（节点回退到老的逐节点路径）
 *
 * ## 不在这里管的事
 *
 *   - 媒体生成进度（mediaStore / sceneImageCache / assetStore 自己有 cache）
 *   - LLM 流式 token 的逐 chunk delta（由 forge*.ts 内部 onDelta 决定要不要冒）
 */

export type StreamingNodeStatus =
  | 'skeleton'
  | 'prompts-ready'
  | 'assets-ready'

export type StreamingActStatus =
  | 'queued'
  | 'forging'
  | 'ready'
  | 'failed'

export interface StreamingActMeta {
  /** Act id；与 Outline.acts[i].id 同源 */
  actId: string
  /** Act 短标题 */
  title: string
  /** Act 这一拍的剧情节拍（用于 Player skeleton 上做 hint） */
  beat?: string
  /** Act 内属于它的 sceneIds（按出现顺序） */
  sceneIds: string[]
  status: StreamingActStatus
  /** Act 级失败原因（仅 status==='failed' 时有意义） */
  errorReason?: string
}

export interface StreamingState {
  /** 当前批次 id —— 用于 race 防御：旧批次的回调到的时候新批次已开，丢弃 */
  batchId: string
  /** Act 元数据列表，按出现顺序 */
  acts: StreamingActMeta[]
  /** 节点状态映射：sceneId → 三态枚举 */
  nodeStatus: Record<string, StreamingNodeStatus>
  /** 整体批次开始时间（ms epoch），用于 UI 展示"已跑 12 秒…" */
  startedAt: number
}

/**
 * 为新批次构造空 streaming 状态。
 */
export function makeStreamingState(batchId: string): StreamingState {
  return {
    batchId,
    acts: [],
    nodeStatus: {},
    startedAt: Date.now(),
  }
}

/**
 * Act 骨架：一个 Act 对应一组待 append 的"空节点"。
 *
 * 节点最少需要的信息：sceneId / title / 接续顺序。其余字段（media / dialogue / shots…）
 * 由 makeBlankSkeletonScene 兜成空但合法的 Scene。
 *
 * `linkFromSceneId` 用于把这些新 scene 串到上一 Act 末尾或 root；
 * 若 act 是首 act 且 linkFromSceneId 不传，外层应当把 scenario.rootSceneId 改成第一个 sceneId。
 */
export interface ActSkeleton {
  actId: string
  title: string
  beat?: string
  /** Act 内每个节点的最小骨架 */
  nodes: SkeletonNode[]
  /**
   * 上一个 Act 末尾节点的 sceneId（用于 auto branch 串联）。
   * 首 Act 不传 → 节点直接被加进 scenes 表，由调用方决定 root。
   */
  linkFromSceneId?: string
}

export interface SkeletonNode {
  /** 全局唯一 sceneId —— 与 outline.acts[i].id + nodeIndex 拼出来稳定 */
  sceneId: string
  /** 节点短标题（4-8 字） */
  title: string
  /** 该节点要表达的一拍剧情，可能为空（未拆细）；用于 Player 骨架 hint */
  beat?: string
  /** 默认时长 ms；不传走 SCENE_DEFAULT_DURATION */
  durationMs?: number
}

/** 骨架场景默认时长 —— 给 Player 一个非零的占位（默认 50s 起步） */
export const SKELETON_SCENE_DEFAULT_DURATION = 50000

/**
 * 把 SkeletonNode 转成符合 Scene 类型的最小合法占位。
 *
 * 关键取舍：
 *   - media.kind = 'PLACEHOLDER'：让 StagePane / Player 自动走"占位画面"分支
 *   - dialogue/qte/branches/shots/audio 全空数组（不是 undefined） —— Scene
 *     的字段语义"必填数组"，避免下游做 null check 漏写
 *   - 无 prompts 字段 —— streaming 状态机会把 prompts-ready 后再注入
 */
export function makeBlankSkeletonScene(node: SkeletonNode): Scene {
  return {
    id: node.sceneId,
    title: node.title,
    media: { kind: 'PLACEHOLDER' },
    durationMs: node.durationMs ?? SKELETON_SCENE_DEFAULT_DURATION,
    dialogue: [],
    branches: [],
  }
}

/**
 * 从 ActSkeleton 派生 StreamingActMeta。
 */
export function actSkeletonToMeta(act: ActSkeleton): StreamingActMeta {
  return {
    actId: act.actId,
    title: act.title,
    beat: act.beat,
    sceneIds: act.nodes.map((n) => n.sceneId),
    status: 'queued',
  }
}

/**
 * Patch ScenePrompts —— 不创建新对象，只浅合并补齐 `scene` 字段（必填）。
 */
export function mergeScenePrompts(
  current: ScenePrompts | undefined,
  patch: Partial<ScenePrompts>,
): ScenePrompts {
  return {
    scene: current?.scene ?? '',
    ...current,
    ...patch,
  }
}
