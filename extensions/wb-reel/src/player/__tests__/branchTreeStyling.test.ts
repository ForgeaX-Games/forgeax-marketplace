import { describe, expect, it } from 'vitest'
import { isPastBranch, sceneVariant } from '../branchTreeStyling'

/**
 * 只读剧情树的样式判定 —— 玩家视角需要直观区分：
 *   - 当前所在 = 金色双环
 *   - 走过的场景 + 走过的边 = 金色实线
 *   - 没去过 = 灰描边虚线
 *
 * 这层是纯逻辑，不依赖 xyflow / React / scenarioStore，单测很便宜。
 */

describe('sceneVariant', () => {
  it('当前场景 = current', () => {
    expect(sceneVariant({ sceneId: 's1', currentSceneId: 's1', visited: new Set() })).toBe('current')
  })

  it('已访问 & 不是当前 = visited', () => {
    expect(
      sceneVariant({ sceneId: 's2', currentSceneId: 's3', visited: new Set(['s1', 's2']) }),
    ).toBe('visited')
  })

  it('current 优先于 visited（玩家"回到"走过的场景时仍显示为 current）', () => {
    expect(
      sceneVariant({ sceneId: 's1', currentSceneId: 's1', visited: new Set(['s1']) }),
    ).toBe('current')
  })

  it('其他情况 = unvisited', () => {
    expect(
      sceneVariant({ sceneId: 'sX', currentSceneId: 's1', visited: new Set(['s1']) }),
    ).toBe('unvisited')
  })

  it('accepts an iterable (not Set) for visited', () => {
    expect(sceneVariant({ sceneId: 's1', currentSceneId: 'sX', visited: ['s1'] })).toBe('visited')
  })
})

describe('isPastBranch', () => {
  it('source 未访问 → false（路线还没开始）', () => {
    expect(
      isPastBranch({
        sourceSceneId: 's1',
        targetSceneId: 's2',
        currentSceneId: 's3',
        visited: new Set(['s3']),
      }),
    ).toBe(false)
  })

  it('source 访问过且 target 访问过 → true（已过去）', () => {
    expect(
      isPastBranch({
        sourceSceneId: 's1',
        targetSceneId: 's2',
        currentSceneId: 's3',
        visited: new Set(['s1', 's2']),
      }),
    ).toBe(true)
  })

  it('source 访问过且 target = 当前场景 → true（最后一跳）', () => {
    expect(
      isPastBranch({
        sourceSceneId: 's1',
        targetSceneId: 's2',
        currentSceneId: 's2',
        visited: new Set(['s1']),
      }),
    ).toBe(true)
  })

  it('source 访问过但 target 是未走的兄弟分支 → false', () => {
    expect(
      isPastBranch({
        sourceSceneId: 's1',
        targetSceneId: 'sOther',
        currentSceneId: 's2',
        visited: new Set(['s1', 's2']),
      }),
    ).toBe(false)
  })
})
