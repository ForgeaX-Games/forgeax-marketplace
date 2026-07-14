import { describe, expect, it } from 'vitest'
import { computeStoryGraphLayout, DEFAULT_LAYOUT_OPTIONS } from '../layout'
import type { Scenario, Scene } from '../types'

/**
 * computeStoryGraphLayout 契约：
 *
 *   1. 返回所有 scene 的 NodeRect（左上角坐标 + 宽高）
 *   2. 默认 LR 方向：rootScene 在最左，子代靠右
 *   3. scene.pos 已设置 → 优先用作者位置（不被 dagre 覆盖）
 *   4. 不可达节点也参与布局（不会丢节点）
 *   5. nodeWidth / nodeHeight 在结果里如实反映
 *   6. branches 视为有向边
 */

function makeScene(id: string, branches: { to: string }[] = []): Scene {
  return {
    id,
    title: id,
    media: { kind: 'PLACEHOLDER' },
    durationMs: 5000,
    dialogue: [],
    branches: branches.map((b, i) => ({
      id: `b-${id}-${i}`,
      kind: 'auto',
      targetSceneId: b.to,
    })),
  }
}

function makeScenario(scenes: Scene[], rootId: string): Scenario {
  const map: Record<string, Scene> = {}
  for (const s of scenes) map[s.id] = s
  return {
    id: 'test',
    title: 'test',
    rootSceneId: rootId,
    scenes: map,
    defaultCharMs: 40,
    schemaVersion: 1,
  }
}

describe('computeStoryGraphLayout', () => {
  describe('基本契约', () => {
    it('单节点：返回该节点矩形（默认尺寸来自 DEFAULT_LAYOUT_OPTIONS）', () => {
      const sc = makeScenario([makeScene('a')], 'a')
      const r = computeStoryGraphLayout(sc)
      expect(Object.keys(r)).toEqual(['a'])
      expect(r['a']?.width).toBe(DEFAULT_LAYOUT_OPTIONS.nodeWidth)
      expect(r['a']?.height).toBe(DEFAULT_LAYOUT_OPTIONS.nodeHeight)
      expect(typeof r['a']?.x).toBe('number')
      expect(typeof r['a']?.y).toBe('number')
    })

    it('线性链 a → b → c：LR 方向 x 严格递增', () => {
      const sc = makeScenario(
        [
          makeScene('a', [{ to: 'b' }]),
          makeScene('b', [{ to: 'c' }]),
          makeScene('c'),
        ],
        'a',
      )
      const r = computeStoryGraphLayout(sc)
      expect(r['a']!.x).toBeLessThan(r['b']!.x)
      expect(r['b']!.x).toBeLessThan(r['c']!.x)
    })

    it('分叉 a → {b, c}：b 与 c 同列（x 相等），y 不同', () => {
      const sc = makeScenario(
        [
          makeScene('a', [{ to: 'b' }, { to: 'c' }]),
          makeScene('b'),
          makeScene('c'),
        ],
        'a',
      )
      const r = computeStoryGraphLayout(sc)
      expect(r['b']!.x).toBe(r['c']!.x)
      expect(r['b']!.y).not.toBe(r['c']!.y)
    })

    it('返回的是左上角坐标（不是中心点）', () => {
      const sc = makeScenario([makeScene('only')], 'only')
      const r = computeStoryGraphLayout(sc, {
        nodeWidth: 200,
        nodeHeight: 80,
        marginX: 50,
        marginY: 30,
      })
      // marginX/Y 后第一个节点的左边缘应当 ≥ marginX
      expect(r['only']!.x).toBeGreaterThanOrEqual(50 - 1)
      expect(r['only']!.y).toBeGreaterThanOrEqual(30 - 1)
    })
  })

  describe('作者位置覆盖（scene.pos）', () => {
    it('scene.pos 已设置：直接采用作者位置，不被 dagre 覆盖', () => {
      const a = makeScene('a', [{ to: 'b' }])
      const b = makeScene('b')
      b.pos = { x: 999, y: 777 }
      const sc = makeScenario([a, b], 'a')
      const r = computeStoryGraphLayout(sc)
      expect(r['b']).toEqual({
        x: 999,
        y: 777,
        width: DEFAULT_LAYOUT_OPTIONS.nodeWidth,
        height: DEFAULT_LAYOUT_OPTIONS.nodeHeight,
      })
    })

    it('部分节点有 pos、部分没有：有 pos 用作者，没 pos 用 dagre', () => {
      const a = makeScene('a', [{ to: 'b' }])
      a.pos = { x: 10, y: 20 }
      const b = makeScene('b')
      const sc = makeScenario([a, b], 'a')
      const r = computeStoryGraphLayout(sc)
      expect(r['a']!.x).toBe(10)
      expect(r['a']!.y).toBe(20)
      expect(r['b']).toBeDefined()
      // b 用了 dagre 算的位置
      expect(r['b']!.x).not.toBe(0)
    })
  })

  describe('鲁棒性', () => {
    it('不可达节点（孤岛）也出现在结果里', () => {
      const sc = makeScenario(
        [makeScene('root'), makeScene('orphan')],
        'root',
      )
      const r = computeStoryGraphLayout(sc)
      expect(r['root']).toBeDefined()
      expect(r['orphan']).toBeDefined()
    })

    it('指向不存在节点的 branch 不会让函数崩溃', () => {
      const sc = makeScenario(
        [makeScene('a', [{ to: 'ghost' }])],
        'a',
      )
      expect(() => computeStoryGraphLayout(sc)).not.toThrow()
      expect(computeStoryGraphLayout(sc)['a']).toBeDefined()
    })

    it('环（a → b → a）不会让函数崩溃', () => {
      const sc = makeScenario(
        [makeScene('a', [{ to: 'b' }]), makeScene('b', [{ to: 'a' }])],
        'a',
      )
      expect(() => computeStoryGraphLayout(sc)).not.toThrow()
    })
  })

  describe('options', () => {
    it('nodeWidth / nodeHeight 自定义会反映在结果里', () => {
      const sc = makeScenario([makeScene('a')], 'a')
      const r = computeStoryGraphLayout(sc, { nodeWidth: 300, nodeHeight: 120 })
      expect(r['a']!.width).toBe(300)
      expect(r['a']!.height).toBe(120)
    })

    it('rankSep 越大，链路总宽度越宽', () => {
      const scenes = [
        makeScene('a', [{ to: 'b' }]),
        makeScene('b', [{ to: 'c' }]),
        makeScene('c'),
      ]
      const sc = makeScenario(scenes, 'a')
      const tight = computeStoryGraphLayout(sc, { rankSep: 30 })
      const loose = computeStoryGraphLayout(sc, { rankSep: 200 })
      const tightSpan = tight['c']!.x - tight['a']!.x
      const looseSpan = loose['c']!.x - loose['a']!.x
      expect(looseSpan).toBeGreaterThan(tightSpan)
    })
  })

  describe('nodeSizes 覆盖（膨胀态让邻居让路）', () => {
    it('某节点被标成膨胀尺寸时，它的 rect 按该尺寸返回', () => {
      const sc = makeScenario(
        [makeScene('a', [{ to: 'b' }]), makeScene('b')],
        'a',
      )
      const r = computeStoryGraphLayout(sc, {
        nodeSizes: { a: { width: 420, height: 300 } },
      })
      expect(r['a']!.width).toBe(420)
      expect(r['a']!.height).toBe(300)
      // 邻居仍为默认尺寸
      expect(r['b']!.width).toBe(DEFAULT_LAYOUT_OPTIONS.nodeWidth)
    })

    it('a 被膨胀后，它到 b 的 rankSep 距离应 ≥ 默认（dagre 感知到 a 变宽）', () => {
      const scenes = [makeScene('a', [{ to: 'b' }]), makeScene('b')]
      const normal = computeStoryGraphLayout(makeScenario(scenes, 'a'))
      const expanded = computeStoryGraphLayout(makeScenario(scenes, 'a'), {
        nodeSizes: { a: { width: 500, height: 120 } },
      })
      // 两图 a 左上角都在 marginX 附近；膨胀图 b.x 应该比普通图更靠右
      // （因为 dagre 以节点中心间距 + half(width) 算距离）
      expect(expanded['b']!.x).toBeGreaterThan(normal['b']!.x)
    })

    it('兄弟分叉：由于 dagre LR 布局同 rank 间距仅由 nodesep 决定，高度膨胀不会让 y 方向让路（已知限制，由 z-index 浮起补偿）', () => {
      const scenes = [
        makeScene('root', [{ to: 'x' }, { to: 'y' }]),
        makeScene('x'),
        makeScene('y'),
      ]
      const sc = makeScenario(scenes, 'root')
      const normal = computeStoryGraphLayout(sc)
      const expanded = computeStoryGraphLayout(sc, {
        nodeSizes: { x: { width: 220, height: 400 } },
      })
      // 契约：y 轴 dagre 不让路 —— siblings 的 |y 差| 不变（限制的可见契约）
      const normalDy = Math.abs(normal['x']!.y - normal['y']!.y)
      const expandedDy = Math.abs(expanded['x']!.y - expanded['y']!.y)
      expect(expandedDy).toBe(normalDy)
    })

    it('pinned（scene.pos）节点也会应用尺寸覆盖', () => {
      const a = makeScene('a')
      a.pos = { x: 50, y: 50 }
      const sc = makeScenario([a], 'a')
      const r = computeStoryGraphLayout(sc, {
        nodeSizes: { a: { width: 420, height: 300 } },
      })
      expect(r['a']).toEqual({ x: 50, y: 50, width: 420, height: 300 })
    })
  })
})
