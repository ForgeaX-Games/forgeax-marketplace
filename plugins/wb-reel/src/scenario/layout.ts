import { graphlib, layout as dagreLayout } from '@dagrejs/dagre'
import type { Scenario } from './types'

/**
 * 把 Scenario 编译成 StoryGraph 节点矩形 —— 纯函数，零 React 依赖。
 *
 * 设计三件事：
 *
 *   1. **作者位置优先**：scene.pos 已设置 → 直接当 NodeRect 用，dagre 不碰它。
 *      让作者拖过的节点不会因为加了一条新边就被布局算法弹走。
 *
 *   2. **dagre 处理剩余节点**：rootSceneId 起步，按 branches 当有向边走 LR 布局。
 *      孤岛节点（不可达）也参与算法（dagre 会塞到右侧或独立行）。
 *
 *   3. **结果是左上角坐标**：dagre 给的是中心点，本函数把它转成 React/CSS 习惯的
 *      `top-left` 矩形 —— react-flow 的 Node.position 也用左上角。
 *
 * 这层不做"持久化作者位置回写"——拖拽 commit 由 scenarioStore.setScenePos 完成。
 */

export interface NodeRect {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutOptions {
  nodeWidth: number
  nodeHeight: number
  /** 同 rank（同列）相邻节点间距 */
  nodeSep: number
  /** 不同 rank 间距（LR 时即列间距） */
  rankSep: number
  /** 整图四周外边距（让 fitView 后不贴边） */
  marginX: number
  marginY: number
  /** 'LR'（默认，左→右） | 'TB'（上→下） */
  direction: 'LR' | 'TB'
  /**
   * 特殊节点尺寸覆盖表 —— 用于节点膨胀态让 dagre 真正感知大小、
   * 从而把邻居推开，而不是视觉上层叠/穿插。
   *
   * key = sceneId，value = { width, height }。未列出的节点用 nodeWidth/nodeHeight。
   * 已固定位置（scene.pos）的节点**也**会应用尺寸覆盖，这样膨胀作者拖过的节点时
   * 该节点画框本身尺寸正确（但邻居还是保持作者的位置，不会被推）。
   */
  nodeSizes?: Record<string, { width: number; height: number }>
}

export const DEFAULT_LAYOUT_OPTIONS: LayoutOptions = {
  nodeWidth: 224,
  nodeHeight: 196,
  nodeSep: 44,
  rankSep: 180,
  marginX: 40,
  marginY: 40,
  direction: 'LR',
}

/**
 * 主入口。返回每个 sceneId 到 NodeRect 的映射。
 * 不会抛错（即使 scenario 内部引用悬空，也只跳过对应边）。
 */
export function computeStoryGraphLayout(
  scenario: Scenario,
  partial?: Partial<LayoutOptions>,
): Record<string, NodeRect> {
  const opts: LayoutOptions = { ...DEFAULT_LAYOUT_OPTIONS, ...(partial ?? {}) }
  const sizes = opts.nodeSizes ?? {}

  /** 取节点尺寸：优先 override，其次默认。 */
  function sizeOf(id: string): { width: number; height: number } {
    const s = sizes[id]
    if (s) return s
    return { width: opts.nodeWidth, height: opts.nodeHeight }
  }

  const sceneIds = Object.keys(scenario.scenes)
  const result: Record<string, NodeRect> = {}

  // 1. 作者位置：先吃下来，dagre 算法对它"视而不见"
  const pinned: Set<string> = new Set()
  for (const id of sceneIds) {
    const scene = scenario.scenes[id]
    if (!scene) continue
    if (scene.pos) {
      const sz = sizeOf(id)
      result[id] = {
        x: scene.pos.x,
        y: scene.pos.y,
        width: sz.width,
        height: sz.height,
      }
      pinned.add(id)
    }
  }

  // 2. 收集需要 dagre 算的节点
  const dynamicIds = sceneIds.filter((id) => !pinned.has(id))
  if (dynamicIds.length === 0) {
    return result
  }

  const g = new graphlib.Graph()
  g.setGraph({
    rankdir: opts.direction,
    nodesep: opts.nodeSep,
    ranksep: opts.rankSep,
    marginx: opts.marginX,
    marginy: opts.marginY,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const id of dynamicIds) {
    const sz = sizeOf(id)
    g.setNode(id, { width: sz.width, height: sz.height })
  }

  // 3. 边：仅当**两端都在 dynamic set 里**才喂给 dagre。
  //    一端是 pinned 的边对 dagre 来说是悬空，反而会让算法把动态节点拽到奇怪地方。
  //    多重边（同两个节点之间多条 branch）合并：dagre 单图模式 setEdge 会覆盖，
  //    刚好实现了"同两节点之间布局算一次"的去重，符合 storygraph 视觉。
  for (const fromId of dynamicIds) {
    const scene = scenario.scenes[fromId]
    if (!scene) continue
    const seen = new Set<string>()
    for (const branch of scene.branches) {
      const toId = branch.targetSceneId
      if (!toId) continue
      if (!sceneIds.includes(toId)) continue // 悬空 target → 忽略
      if (pinned.has(toId)) continue // 跨 pinned/dynamic 边 → 忽略
      if (fromId === toId) continue // 自环 → 忽略，dagre 不支持
      if (seen.has(toId)) continue
      seen.add(toId)
      g.setEdge(fromId, toId)
    }
  }

  // 4. 跑布局；dagre 偶发 throw（极端环结构），用 try 兜底，至少返回作者位置部分
  try {
    dagreLayout(g)
  } catch (e) {
    console.warn('[storygraph/layout] dagre layout failed:', e)
    // fallback：把所有 dynamic 节点摆成纵向单列
    let y = opts.marginY
    for (const id of dynamicIds) {
      const sz = sizeOf(id)
      result[id] = {
        x: opts.marginX,
        y,
        width: sz.width,
        height: sz.height,
      }
      y += sz.height + opts.nodeSep
    }
    return result
  }

  // 5. 把 dagre 给的中心坐标转成左上角
  for (const id of dynamicIds) {
    const node = g.node(id)
    if (!node) continue
    const sz = sizeOf(id)
    const halfW = (node.width ?? sz.width) / 2
    const halfH = (node.height ?? sz.height) / 2
    result[id] = {
      x: node.x - halfW,
      y: node.y - halfH,
      width: sz.width,
      height: sz.height,
    }
  }

  return result
}
