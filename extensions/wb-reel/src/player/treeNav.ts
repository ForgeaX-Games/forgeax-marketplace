import type { Scenario, TreeJumpScope } from '../scenario/types'

/**
 * 剧情树节点可达性 —— 支撑「章节/关卡选择」式可玩导航。
 *
 *   current  = 当前正在播的节点。
 *   visited  = 已访问过(可回放)。
 *   frontier = 尚未访问,但是某个已访问/当前节点的直接分支目标(下一步可推进)。
 *   locked   = 其余尚不可达节点(默认压暗/上锁)。
 *
 * 纯函数,零 React 依赖,方便测试与在编辑器预览/播放器共用。
 */
export type TreeNodeAccess = 'current' | 'visited' | 'frontier' | 'locked'

export function computeNodeAccess(args: {
  scenario: Scenario
  currentSceneId: string
  visited: Iterable<string>
}): Record<string, TreeNodeAccess> {
  const { scenario, currentSceneId } = args
  const visitedSet = new Set(args.visited)
  visitedSet.add(currentSceneId)

  // frontier = 已访问/当前节点的直接分支目标里,尚未访问的那些。
  const frontier = new Set<string>()
  for (const id of visitedSet) {
    const scene = scenario.scenes[id]
    if (!scene) continue
    for (const br of scene.branches) {
      const t = br.targetSceneId
      if (t && scenario.scenes[t] && !visitedSet.has(t)) frontier.add(t)
    }
  }

  const out: Record<string, TreeNodeAccess> = {}
  for (const id of Object.keys(scenario.scenes)) {
    if (id === currentSceneId) out[id] = 'current'
    else if (visitedSet.has(id)) out[id] = 'visited'
    else if (frontier.has(id)) out[id] = 'frontier'
    else out[id] = 'locked'
  }
  return out
}

/**
 * 某节点在给定跳转范围下是否可点跳转。
 *   none    = 都不可跳(纯只读)。
 *   visited = 已访问(回放) + frontier(推进)可跳;locked 不可。
 *   all     = 除当前节点外任意可跳(含 locked,调试/自由探索)。
 */
export function isJumpable(access: TreeNodeAccess, scope: TreeJumpScope): boolean {
  if (access === 'current') return false
  switch (scope) {
    case 'none':
      return false
    case 'all':
      return true
    case 'visited':
    default:
      return access === 'visited' || access === 'frontier'
  }
}
