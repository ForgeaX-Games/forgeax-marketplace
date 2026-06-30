/**
 * videoSchedule —— VideoPlan → 执行 DAG（v3.8 新增）
 *
 * 定位：纯函数层。把 Planner 产出的 VideoPlan 拆成可执行的 DAG：
 *   - 同 continuityGroupId + 有 dependsOnSegmentId → 串行链
 *   - 跨组 / 无依赖 → 可并行
 *
 * 不做副作用：不调模型、不写磁盘；只返回描述执行顺序的结构。
 * Runner 层（videoPipelineRunner）读本文件输出，真正去调视频 API。
 *
 * 为什么不把调度塞进 Runner？
 *   - 纯函数可 100% 单测（并行度 / 串行链 / 循环依赖检测）
 *   - 未来如果要支持"分布式执行/作业队列" 只换 Runner，调度不动
 */
import type { VideoPlan, VideoSegment } from './videoPlanTypes'

/**
 * DAG 节点 —— 每个节点 = 一次视频模型调用。
 */
export interface VideoDagNode {
  segment: VideoSegment
  /** 必须等待这些 node 完成才能启动（node.segment.id） */
  waitFor: string[]
}

/**
 * DAG 描述。
 */
export interface VideoDag {
  nodes: VideoDagNode[]
  /** 所有可以立即并行启动的 node id —— waitFor.length === 0 */
  roots: string[]
  /** 推荐的最大并行度（取自 modelCapabilities.recommendedConcurrency 或 DAG 自身分支） */
  recommendedConcurrency: number
  warnings: string[]
}

export interface BuildDagOptions {
  /** 默认推荐并发数，通常来自 modelCapabilities.recommendedConcurrency */
  defaultConcurrency?: number
}

/**
 * 把 VideoPlan 编译为 DAG。
 *
 * 规则：
 *   1) 每个 segment → 一个 DagNode
 *   2) waitFor = [dependsOnSegmentId] if 有，否则 []
 *   3) 并行度 = min(defaultConcurrency, 当前层可启动节点数)
 *   4) 检测环（不应该存在，但 LLM 产物不可信）→ 进 warnings + 断环
 */
export function buildVideoDag(
  plan: VideoPlan,
  opts: BuildDagOptions = {},
): VideoDag {
  const warnings: string[] = []
  const segIds = new Set(plan.segments.map((s) => s.id))

  // 检查 dependsOn 是否指向不存在的 segment
  plan.segments.forEach((seg) => {
    if (seg.dependsOnSegmentId && !segIds.has(seg.dependsOnSegmentId)) {
      warnings.push(`segment ${seg.id} 依赖不存在的段 ${seg.dependsOnSegmentId}，已断开`)
    }
  })

  // 构建节点
  const nodes: VideoDagNode[] = plan.segments.map((seg) => {
    const waitFor: string[] = []
    if (seg.dependsOnSegmentId && segIds.has(seg.dependsOnSegmentId)) {
      waitFor.push(seg.dependsOnSegmentId)
    }
    return { segment: seg, waitFor }
  })

  // 环检测：拓扑排序跑一遍，跑不完说明有环
  if (hasCycle(nodes)) {
    warnings.push('VideoPlan 含依赖环，已强制打断为平铺并行')
    nodes.forEach((n) => {
      n.waitFor = []
    })
  }

  const roots = nodes
    .filter((n) => n.waitFor.length === 0)
    .map((n) => n.segment.id)

  return {
    nodes,
    roots,
    recommendedConcurrency: Math.max(1, opts.defaultConcurrency ?? 2),
    warnings,
  }
}

/**
 * 按拓扑序列出执行"波次"—— 每一波内的节点可并行执行，相邻波之间有依赖。
 * Runner 可以用这个做简单 for-each-wave 执行；更高级的 Runner 可忽略这个，
 * 改用 waitFor 做事件驱动并发。
 *
 * 不会改 DAG 结构，只返回分组视图。
 */
export function layerizeDag(dag: VideoDag): VideoSegment[][] {
  const waves: VideoSegment[][] = []
  const remaining = new Map<string, VideoDagNode>()
  dag.nodes.forEach((n) => remaining.set(n.segment.id, n))

  while (remaining.size > 0) {
    const ready: VideoDagNode[] = []
    remaining.forEach((n) => {
      if (n.waitFor.every((w) => !remaining.has(w))) ready.push(n)
    })
    if (ready.length === 0) {
      // 不可能到这里（cycle 已在 buildVideoDag 处理）；但安全兜底
      remaining.forEach((n) => ready.push(n))
    }
    // 稳定排序：按 shotOrder, segmentIndex
    ready.sort((a, b) => {
      const ao = a.segment.shotOrder
      const bo = b.segment.shotOrder
      if (ao !== bo) return ao - bo
      return a.segment.segmentIndex - b.segment.segmentIndex
    })
    waves.push(ready.map((n) => n.segment))
    ready.forEach((n) => remaining.delete(n.segment.id))
  }

  return waves
}

/**
 * 返回 DAG 的"关键路径总时长"估算（秒）—— UI 做进度条用。
 *
 * 关键路径 = 最长串行链的 durationSec 之和 + 每段 `typicalJobLatencySec` 估算。
 * 这里只算段时长之和（不含 API 延迟，调用方自己加）。
 */
export function criticalPathDurationSec(dag: VideoDag): number {
  const byId = new Map<string, VideoDagNode>()
  dag.nodes.forEach((n) => byId.set(n.segment.id, n))
  const memo = new Map<string, number>()

  function depth(id: string): number {
    if (memo.has(id)) return memo.get(id)!
    const n = byId.get(id)
    if (!n) return 0
    const ownDur = n.segment.durationSec
    const waitMax = n.waitFor.length === 0
      ? 0
      : Math.max(...n.waitFor.map((w) => depth(w)))
    const total = waitMax + ownDur
    memo.set(id, total)
    return total
  }

  if (dag.nodes.length === 0) return 0
  return Math.max(...dag.nodes.map((n) => depth(n.segment.id)))
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部：环检测（Kahn 算法）
// ─────────────────────────────────────────────────────────────────────────────

function hasCycle(nodes: VideoDagNode[]): boolean {
  const indeg = new Map<string, number>()
  const outs = new Map<string, string[]>()
  nodes.forEach((n) => {
    indeg.set(n.segment.id, 0)
    outs.set(n.segment.id, [])
  })
  nodes.forEach((n) => {
    n.waitFor.forEach((w) => {
      if (!indeg.has(n.segment.id)) return
      indeg.set(n.segment.id, (indeg.get(n.segment.id) ?? 0) + 1)
      const arr = outs.get(w)
      if (arr) arr.push(n.segment.id)
    })
  })
  const queue: string[] = []
  indeg.forEach((d, id) => {
    if (d === 0) queue.push(id)
  })
  let processed = 0
  while (queue.length > 0) {
    const id = queue.shift()!
    processed++
    const children = outs.get(id) ?? []
    children.forEach((c) => {
      const nd = (indeg.get(c) ?? 0) - 1
      indeg.set(c, nd)
      if (nd === 0) queue.push(c)
    })
  }
  return processed !== nodes.length
}
