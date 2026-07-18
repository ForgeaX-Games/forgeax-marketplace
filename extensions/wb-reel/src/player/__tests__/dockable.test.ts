import { describe, expect, it } from 'vitest'
import {
  clampToViewport,
  computeDockPosition,
  cssFromDock,
  deserializeDock,
  serializeDock,
  type DockPosition,
} from '../dockable'

/**
 * 可贴边浮动按钮契约 ——
 *
 * 真实 bug 现场：玩家模式右上角的设置 FAB 跟顶栏"导出剧本"按钮叠在一起，
 * 用户没法点。修法 = 让 FAB 可拖拽 + 贴最近的边停靠。
 *
 * 这层是"贴边数学"的真相之源：
 *   - 坐标 → DockPosition（哪条边 + 沿边的 0-1 比例）
 *   - DockPosition + 视口 → CSS（top/right/bottom/left 中两个）
 *   - 任意 px 值都不能超过视口（防止 FAB 跑到屏外）
 */

const VP = { width: 1200, height: 800 }

describe('computeDockPosition', () => {
  it('FAB 中心更靠近右边 → edge=right', () => {
    const dock = computeDockPosition({ x: 1100, y: 300 }, { w: 36, h: 36 }, VP)
    expect(dock.edge).toBe('right')
  })

  it('FAB 中心更靠近左边 → edge=left', () => {
    const dock = computeDockPosition({ x: 20, y: 300 }, { w: 36, h: 36 }, VP)
    expect(dock.edge).toBe('left')
  })

  it('FAB 中心更靠近上边 → edge=top', () => {
    const dock = computeDockPosition({ x: 600, y: 30 }, { w: 36, h: 36 }, VP)
    expect(dock.edge).toBe('top')
  })

  it('FAB 中心更靠近下边 → edge=bottom', () => {
    const dock = computeDockPosition({ x: 600, y: 770 }, { w: 36, h: 36 }, VP)
    expect(dock.edge).toBe('bottom')
  })

  it('右边 ratio：从顶部到底部沿 y 轴 0→1', () => {
    // 紧贴右边 (x=1180 → 离右边 cy=2 ≪ 任何其他边)
    const top = computeDockPosition({ x: 1180, y: 100 }, { w: 36, h: 36 }, VP)
    const mid = computeDockPosition(
      { x: 1180, y: (VP.height - 36) / 2 },
      { w: 36, h: 36 },
      VP,
    )
    const bot = computeDockPosition(
      { x: 1180, y: VP.height - 36 - 100 },
      { w: 36, h: 36 },
      VP,
    )
    expect(top.edge).toBe('right')
    expect(mid.edge).toBe('right')
    expect(bot.edge).toBe('right')
    expect(top.ratio).toBeCloseTo(100 / (VP.height - 36), 1)
    expect(mid.ratio).toBeCloseTo(0.5, 1)
    expect(bot.ratio).toBeCloseTo((VP.height - 36 - 100) / (VP.height - 36), 1)
  })

  it('上边 ratio：从左到右沿 x 轴 0→1', () => {
    const a = computeDockPosition({ x: 100, y: 0 }, { w: 36, h: 36 }, VP)
    const b = computeDockPosition(
      { x: (VP.width - 36) / 2, y: 0 },
      { w: 36, h: 36 },
      VP,
    )
    expect(a.edge).toBe('top')
    expect(b.edge).toBe('top')
    expect(a.ratio).toBeCloseTo(100 / (VP.width - 36), 1)
    expect(b.ratio).toBeCloseTo(0.5, 1)
  })
})

describe('clampToViewport', () => {
  it('FAB 跑出右边 → 钳到右边内', () => {
    const r = clampToViewport({ x: 1300, y: 200 }, { w: 36, h: 36 }, VP)
    expect(r.x).toBeLessThanOrEqual(VP.width - 36)
  })

  it('FAB 跑出左边 → 钳到 0', () => {
    const r = clampToViewport({ x: -50, y: 200 }, { w: 36, h: 36 }, VP)
    expect(r.x).toBe(0)
  })

  it('FAB 跑出上边 / 下边 → 钳进', () => {
    expect(clampToViewport({ x: 100, y: -50 }, { w: 36, h: 36 }, VP).y).toBe(0)
    expect(
      clampToViewport({ x: 100, y: 9000 }, { w: 36, h: 36 }, VP).y,
    ).toBeLessThanOrEqual(VP.height - 36)
  })
})

describe('cssFromDock', () => {
  const SIZE = { w: 36, h: 36 }
  const MARGIN = 12

  it('右边停靠：返回 right=12, top=ratio*(vh-h)', () => {
    const dock: DockPosition = { edge: 'right', ratio: 0.5 }
    const css = cssFromDock(dock, SIZE, VP, MARGIN)
    expect(css.right).toBe(12)
    expect(css.top).toBeCloseTo(0.5 * (VP.height - SIZE.h - MARGIN * 2) + MARGIN, 0)
    expect(css.left).toBeUndefined()
    expect(css.bottom).toBeUndefined()
  })

  it('左边：返回 left=12', () => {
    const dock: DockPosition = { edge: 'left', ratio: 0 }
    const css = cssFromDock(dock, SIZE, VP, MARGIN)
    expect(css.left).toBe(12)
    expect(css.right).toBeUndefined()
  })

  it('上边：返回 top=12', () => {
    const dock: DockPosition = { edge: 'top', ratio: 0.3 }
    const css = cssFromDock(dock, SIZE, VP, MARGIN)
    expect(css.top).toBe(12)
    expect(css.bottom).toBeUndefined()
  })

  it('下边：返回 bottom=12', () => {
    const dock: DockPosition = { edge: 'bottom', ratio: 1 }
    const css = cssFromDock(dock, SIZE, VP, MARGIN)
    expect(css.bottom).toBe(12)
    expect(css.top).toBeUndefined()
  })

  it('ratio 永不让 FAB 撞顶 / 撞边 —— margin 至少有效', () => {
    const dock: DockPosition = { edge: 'right', ratio: 0 }
    const css = cssFromDock(dock, SIZE, VP, MARGIN)
    expect(css.top).toBeGreaterThanOrEqual(MARGIN)
    const dock2: DockPosition = { edge: 'right', ratio: 1 }
    const css2 = cssFromDock(dock2, SIZE, VP, MARGIN)
    expect((css2.top ?? 0) + SIZE.h).toBeLessThanOrEqual(VP.height - MARGIN)
  })
})

describe('serialize / deserialize', () => {
  it('round-trip 稳定', () => {
    const orig: DockPosition = { edge: 'right', ratio: 0.42 }
    expect(deserializeDock(serializeDock(orig))).toEqual(orig)
  })

  it('损坏值 → 默认 right corner', () => {
    expect(deserializeDock('garbage')).toEqual({ edge: 'right', ratio: 0.5 })
    expect(deserializeDock(null)).toEqual({ edge: 'right', ratio: 0.5 })
    expect(deserializeDock('')).toEqual({ edge: 'right', ratio: 0.5 })
  })

  it('未知 edge 值 → 默认 right corner', () => {
    expect(
      deserializeDock(JSON.stringify({ edge: 'sideways', ratio: 0.5 })),
    ).toEqual({ edge: 'right', ratio: 0.5 })
  })

  it('ratio 越界 → 钳到 [0,1]', () => {
    expect(
      deserializeDock(JSON.stringify({ edge: 'right', ratio: 5 })).ratio,
    ).toBe(1)
    expect(
      deserializeDock(JSON.stringify({ edge: 'right', ratio: -3 })).ratio,
    ).toBe(0)
  })
})
