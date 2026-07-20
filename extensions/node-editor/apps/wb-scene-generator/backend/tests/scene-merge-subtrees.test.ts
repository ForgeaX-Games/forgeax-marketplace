/**
 * scene_merge_subtrees regression suite.
 *
 * 锁定的修复：merge 收束时若两个 branch 在「同一父下的同名子节点」内各自新增了不同后代，
 * 旧实现按「同名整棵子树保留先到者」去重，会把后到 branch 的修改整棵丢弃。
 * 修复后改为递归深合并：同名子节点不跳过，递归下钻逐层合并，各 branch 的后代都保留，
 * 同时保持 z-order（version 递增）与 foc="/" 输出。
 */

import { describe, it, expect } from 'vitest'

import {
  emptyTree,
  makeScenePort,
  readNode,
  listChildren,
  projectSceneToVoxelLayers,
  type ScenePortValue,
} from '../../vendor/dist/shared/types/index.js'

import { grid2Node } from '../../batteries/scene/bridge/grid2node/index.js'
import { addChild } from '../../batteries/scene/manage/add_child/index.js'
import { sceneMergeSubtrees } from '../../batteries/special/scene/scene_merge_subtrees/index.js'

/** 搭一个共同 base：根下挂 building，building 下挂两个空容器 rest / arch。 */
function makeBase(): ScenePortValue {
  const building = grid2Node({ name: 'building', grid: [[0]] }).scene!
  const root = addChild({ scene: makeScenePort(emptyTree(), '/'), nodes: [building] }).scene!
  // building 下挂两个空壳容器
  const rest = grid2Node({ name: 'rest', grid: [[0]] }).scene!
  const arch = grid2Node({ name: 'arch', grid: [[0]] }).scene!
  return addChild({ scene: makeScenePort(root.tree, '/building'), nodes: [rest, arch] }).scene!
}

describe('scene_merge_subtrees — recursive deep merge', () => {
  it('preserves both branches modifying different subtrees under a shared parent (focus="/")', () => {
    const base = makeBase()

    // branch A: 在 /building/rest 下加 wallA
    const wallA = grid2Node({ name: 'wallA', grid: [[1]] }).scene!
    const treeA = addChild({ scene: makeScenePort(base.tree, '/building/rest'), nodes: [wallA] }).scene!

    // branch B: 在 /building/arch 下加 roofB
    const roofB = grid2Node({ name: 'roofB', grid: [[1, 1]] }).scene!
    const treeB = addChild({ scene: makeScenePort(base.tree, '/building/arch'), nodes: [roofB] }).scene!

    const out = sceneMergeSubtrees({
      scenes: [
        { tree: treeA.tree, focus: '/' },
        { tree: treeB.tree, focus: '/' },
      ],
    })

    expect(out.error).toBeUndefined()
    expect(out.scene?.focus).toBe('/')
    expect(out.mergedCount).toBe(2)

    const m = out.scene!.tree
    // 两个 branch 各自的修改都要保留
    expect(readNode(m, '/building/rest/wallA')?.cells?.length).toBe(1)
    expect(readNode(m, '/building/arch/roofB')?.cells?.length).toBe(2)
    expect(listChildren(m, '/building').sort()).toEqual(['arch', 'rest'])
  })

  it('preserves both branches when focus points at the shared parent', () => {
    const base = makeBase()
    const wallA = grid2Node({ name: 'wallA', grid: [[1]] }).scene!
    const treeA = addChild({ scene: makeScenePort(base.tree, '/building/rest'), nodes: [wallA] }).scene!
    const roofB = grid2Node({ name: 'roofB', grid: [[1, 1]] }).scene!
    const treeB = addChild({ scene: makeScenePort(base.tree, '/building/arch'), nodes: [roofB] }).scene!

    const out = sceneMergeSubtrees({
      scenes: [
        { tree: treeA.tree, focus: '/building' },
        { tree: treeB.tree, focus: '/building' },
      ],
    })

    expect(out.error).toBeUndefined()
    const m = out.scene!.tree
    expect(readNode(m, '/building/rest/wallA')?.cells?.length).toBe(1)
    expect(readNode(m, '/building/arch/roofB')?.cells?.length).toBe(2)
  })

  it('preserves both branches in the real fanout protocol (focus on distinct children)', () => {
    const base = makeBase()
    const wallA = grid2Node({ name: 'wallA', grid: [[1]] }).scene!
    const treeA = addChild({ scene: makeScenePort(base.tree, '/building/rest'), nodes: [wallA] }).scene!
    const roofB = grid2Node({ name: 'roofB', grid: [[1, 1]] }).scene!
    const treeB = addChild({ scene: makeScenePort(base.tree, '/building/arch'), nodes: [roofB] }).scene!

    const out = sceneMergeSubtrees({
      scenes: [
        { tree: treeA.tree, focus: '/building/rest' },
        { tree: treeB.tree, focus: '/building/arch' },
      ],
    })

    expect(out.error).toBeUndefined()
    const m = out.scene!.tree
    expect(readNode(m, '/building/rest/wallA')?.cells?.length).toBe(1)
    expect(readNode(m, '/building/arch/roofB')?.cells?.length).toBe(2)
  })

  it('preserves z-order: later-arriving siblings get strictly higher version', () => {
    // base 根下先后挂 first / second（version 递增）
    const first = grid2Node({ name: 'first', grid: [[1]] }).scene!
    const second = grid2Node({ name: 'second', grid: [[1]] }).scene!
    const base = addChild({ scene: makeScenePort(emptyTree(), '/'), nodes: [first, second] }).scene!

    // branch B 在根下追加一个新兄弟 third
    const third = grid2Node({ name: 'third', grid: [[1]] }).scene!
    const treeB = addChild({ scene: makeScenePort(base.tree, '/'), nodes: [third] }).scene!

    const out = sceneMergeSubtrees({
      scenes: [
        { tree: base.tree, focus: '/' },
        { tree: treeB.tree, focus: '/' },
      ],
    })
    expect(out.error).toBeUndefined()
    const m = out.scene!.tree

    const vFirst = readNode(m, '/first')!.version
    const vSecond = readNode(m, '/second')!.version
    const vThird = readNode(m, '/third')!.version
    // base 原有顺序保持，新增的 third z-order 排在最后（version 最大）
    expect(vFirst).toBeLessThan(vSecond)
    expect(vThird).toBeGreaterThan(vSecond)

    // projection 顺序（z-order）：first < second < third
    const { layers } = projectSceneToVoxelLayers(m, '/')
    const order = layers.filter((l) => l.cells.length > 0).map((l) => l.nodePath)
    expect(order).toEqual(['/first', '/second', '/third'])
  })

  it('keeps first arrival on a genuine same-named leaf conflict', () => {
    // 两个 branch 在根下都新建了同名最终节点 dup（各自不同 cells）→ 保留先到者
    const dupA = grid2Node({ name: 'dup', grid: [[1]] }).scene! // 1 cell
    const treeA = addChild({ scene: makeScenePort(emptyTree(), '/'), nodes: [dupA] }).scene!
    const dupB = grid2Node({ name: 'dup', grid: [[1, 1, 1]] }).scene! // 3 cells
    const treeB = addChild({ scene: makeScenePort(emptyTree(), '/'), nodes: [dupB] }).scene!

    const out = sceneMergeSubtrees({
      scenes: [
        { tree: treeA.tree, focus: '/' },
        { tree: treeB.tree, focus: '/' },
      ],
    })
    expect(out.error).toBeUndefined()
    // 先到者（1 cell）保留，后到者不覆盖
    expect(readNode(out.scene!.tree, '/dup')?.cells?.length).toBe(1)
  })
})
