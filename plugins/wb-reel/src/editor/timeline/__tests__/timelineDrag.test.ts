import { describe, expect, it } from 'vitest'
import {
  createDragState,
  updateDragState,
  type DragState,
} from '../timelineDrag'

const COMMON = { totalMs: 5000, trackWidthPx: 1000 }

describe('createDragState', () => {
  it('初始状态：deltaPx/deltaMs/rawDeltaMs 都是 0', () => {
    const s = createDragState({ startX: 200, ...COMMON })
    expect(s.startX).toBe(200)
    expect(s.currentX).toBe(200)
    expect(s.deltaPx).toBe(0)
    expect(s.deltaMs).toBe(0)
    expect(s.rawDeltaMs).toBe(0)
    expect(s.modifiers).toEqual({ shift: false, alt: false })
  })
})

describe('updateDragState', () => {
  it('右拖 200px @ 1000px=5000ms → deltaMs = 1000ms', () => {
    const init = createDragState({ startX: 100, ...COMMON })
    const next = updateDragState(init, { currentX: 300, ...COMMON })
    expect(next.deltaPx).toBe(200)
    expect(next.rawDeltaMs).toBe(1000)
    expect(next.deltaMs).toBe(1000) // 默认开 snap，1000 在 100 网格上
  })

  it('左拖 50px → 负数 deltaMs', () => {
    const init = createDragState({ startX: 500, ...COMMON })
    const next = updateDragState(init, { currentX: 450, ...COMMON })
    expect(next.deltaPx).toBe(-50)
    expect(next.rawDeltaMs).toBe(-250)
    expect(next.deltaMs).toBe(-300) // round-half-up to 100ms grid
  })

  it('snap=false → deltaMs == rawDeltaMs（不吸附）', () => {
    const init = createDragState({ startX: 100, ...COMMON })
    const next = updateDragState(init, {
      currentX: 137,
      ...COMMON,
      snap: false,
    })
    expect(next.deltaPx).toBe(37)
    expect(next.rawDeltaMs).toBe(185)
    expect(next.deltaMs).toBe(185)
  })

  it('Shift 修饰键 → 切到 10ms 网格', () => {
    const init = createDragState({ startX: 100, ...COMMON })
    const next = updateDragState(init, {
      currentX: 137,
      ...COMMON,
      modifiers: { shift: true, alt: false },
    })
    // raw 185 → snap 10ms = 190
    expect(next.deltaMs).toBe(190)
    expect(next.modifiers).toEqual({ shift: true, alt: false })
  })

  it('Alt 修饰键 → 切到 500ms 粗网格', () => {
    const init = createDragState({ startX: 0, ...COMMON })
    const next = updateDragState(init, {
      currentX: 240,
      ...COMMON,
      modifiers: { shift: false, alt: true },
    })
    // raw 1200 → snap 500ms = 1000
    expect(next.deltaMs).toBe(1000)
  })

  it('Shift + Alt 同按 → Shift 优先（10ms）', () => {
    const init = createDragState({ startX: 0, ...COMMON })
    const next = updateDragState(init, {
      currentX: 21,
      ...COMMON,
      modifiers: { shift: true, alt: true },
    })
    // raw = 105ms → 10ms snap = 110ms
    expect(next.deltaMs).toBe(110)
  })

  it('startX 在 prev 中保留 —— 多次 update 后基准不变', () => {
    let s: DragState = createDragState({ startX: 100, ...COMMON })
    s = updateDragState(s, { currentX: 200, ...COMMON })
    s = updateDragState(s, { currentX: 350, ...COMMON })
    expect(s.startX).toBe(100)
    expect(s.currentX).toBe(350)
    expect(s.deltaPx).toBe(250)
    expect(s.rawDeltaMs).toBe(1250)
  })

  it('totalMs 为 0 → deltaMs 全部退回 0（不算 NaN）', () => {
    const init = createDragState({ startX: 100, totalMs: 0, trackWidthPx: 800 })
    const next = updateDragState(init, {
      currentX: 300,
      totalMs: 0,
      trackWidthPx: 800,
    })
    expect(next.deltaMs).toBe(0)
    expect(next.rawDeltaMs).toBe(0)
    expect(next.deltaPx).toBe(200)
  })

  it('trackWidthPx 为 0 → 同样 0 化', () => {
    const init = createDragState({ startX: 100, totalMs: 5000, trackWidthPx: 0 })
    const next = updateDragState(init, {
      currentX: 300,
      totalMs: 5000,
      trackWidthPx: 0,
    })
    expect(next.deltaMs).toBe(0)
  })
})
