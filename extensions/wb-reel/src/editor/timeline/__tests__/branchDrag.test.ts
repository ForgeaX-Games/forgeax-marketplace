import { describe, expect, it } from 'vitest'
import { moveBranchShowAtPatch } from '../branchDrag'
import type { Branch } from '../../../scenario/types'

const SCENE = 5000

function branch(over: Partial<Branch> = {}): Branch {
  return {
    id: 'b1',
    kind: 'choice',
    label: '选项 A',
    targetSceneId: 'scene2',
    showAt: 2000,
    ...over,
  }
}

describe('moveBranchShowAtPatch', () => {
  it('正方向 → showAt 右移', () => {
    expect(moveBranchShowAtPatch(branch(), 500, SCENE)).toEqual({ showAt: 2500 })
  })

  it('负方向 → showAt 左移', () => {
    expect(moveBranchShowAtPatch(branch(), -800, SCENE)).toEqual({ showAt: 1200 })
  })

  it('showAt 不能小于 0', () => {
    expect(moveBranchShowAtPatch(branch({ showAt: 200 }), -1000, SCENE)).toEqual({
      showAt: 0,
    })
  })

  it('showAt 不能超过 sceneDuration', () => {
    expect(moveBranchShowAtPatch(branch({ showAt: 4500 }), 1500, SCENE)).toEqual({
      showAt: SCENE,
    })
  })

  it('showAt 缺省 → 默认起算 = sceneDuration（与渲染一致）', () => {
    expect(
      moveBranchShowAtPatch(branch({ showAt: undefined }), -500, SCENE),
    ).toEqual({ showAt: SCENE - 500 })
  })

  it('delta=0 → 空 patch', () => {
    expect(moveBranchShowAtPatch(branch(), 0, SCENE)).toEqual({})
  })

  it('非 choice 分支 → 仍按 showAt 平移（store 决定要不要持久化）', () => {
    expect(moveBranchShowAtPatch(branch({ kind: 'auto' }), 500, SCENE)).toEqual({
      showAt: 2500,
    })
  })
})
