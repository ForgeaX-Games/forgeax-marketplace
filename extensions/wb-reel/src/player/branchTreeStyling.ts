/**
 * BranchTreeReadonly 的纯函数层 —— 把"一个 scene 在玩家视角里是什么状态"
 * 和"一条 branch 是已走过的历史/未来可能"拆出来，便于单测。
 *
 * 真实组件里这些计算在 useMemo 里就地完成，但单测不想启动 React —— 所以抽出来。
 */

export type SceneVariant = 'current' | 'visited' | 'unvisited'

export function sceneVariant(args: {
  sceneId: string
  currentSceneId: string
  visited: Set<string> | Iterable<string>
}): SceneVariant {
  const { sceneId, currentSceneId } = args
  if (sceneId === currentSceneId) return 'current'
  const visitedSet = args.visited instanceof Set ? args.visited : new Set(args.visited)
  if (visitedSet.has(sceneId)) return 'visited'
  return 'unvisited'
}

/**
 * 一条 branch 是不是"过去走过的那条路"：
 *   出发场景必须是已访问 且 目标已访问 或 目标 = 当前场景
 *
 * 直觉：玩家从 sceneA → sceneB → sceneC（当前），那 A→B 和 B→C 都是"过去"。
 * A→其他未访问兄弟则是 "future"。
 */
export function isPastBranch(args: {
  sourceSceneId: string
  targetSceneId: string
  currentSceneId: string
  visited: Set<string> | Iterable<string>
}): boolean {
  const visitedSet = args.visited instanceof Set ? args.visited : new Set(args.visited)
  const sourceVisited = visitedSet.has(args.sourceSceneId)
  if (!sourceVisited) return false
  const targetReached = visitedSet.has(args.targetSceneId) || args.targetSceneId === args.currentSceneId
  return targetReached
}
