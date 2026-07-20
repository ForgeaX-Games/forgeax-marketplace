import { describe, expect, it } from 'vitest'
import {
  formatTimeCode,
  formatDelta,
  describeSnapGrid,
  previewKeyTimeMs,
} from '../timelineFormat'

describe('formatTimeCode', () => {
  it('0ms → "0.000s"', () => {
    expect(formatTimeCode(0)).toBe('0.000s')
  })

  it('1234ms → "1.234s"', () => {
    expect(formatTimeCode(1234)).toBe('1.234s')
  })

  it('60_000ms → "1:00.000"（>= 60s 切到 mm:ss.SSS）', () => {
    expect(formatTimeCode(60_000)).toBe('1:00.000')
  })

  it('125_678ms → "2:05.678"', () => {
    expect(formatTimeCode(125_678)).toBe('2:05.678')
  })

  it('负数（不可能但防御）→ 转正后加负号', () => {
    expect(formatTimeCode(-500)).toBe('-0.500s')
  })

  it('小数 ms 自动取整', () => {
    expect(formatTimeCode(1234.7)).toBe('1.235s')
  })
})

describe('formatDelta', () => {
  it('正值带 + 号', () => {
    expect(formatDelta(125)).toBe('+125ms')
  })

  it('负值保留负号', () => {
    expect(formatDelta(-300)).toBe('-300ms')
  })

  it('0 → "±0ms"（明确告诉作者拖到原位）', () => {
    expect(formatDelta(0)).toBe('±0ms')
  })

  it('|delta| ≥ 1000 切到秒：+1.250s', () => {
    expect(formatDelta(1250)).toBe('+1.250s')
  })

  it('|delta| ≥ 1000 切到秒：-2.000s', () => {
    expect(formatDelta(-2000)).toBe('-2.000s')
  })
})

describe('describeSnapGrid', () => {
  it('默认（无修饰键）→ 100ms 标', () => {
    expect(describeSnapGrid({ shift: false, alt: false })).toBe('100ms')
  })

  it('Shift → 10ms 精', () => {
    expect(describeSnapGrid({ shift: true, alt: false })).toBe('10ms · Shift')
  })

  it('Alt → 500ms 粗', () => {
    expect(describeSnapGrid({ shift: false, alt: true })).toBe('500ms · Alt')
  })

  it('Shift+Alt → Shift 优先', () => {
    expect(describeSnapGrid({ shift: true, alt: true })).toBe('10ms · Shift')
  })
})

describe('previewKeyTimeMs —— 从 preview 抽出"关键时间"用于 HUD 显示', () => {
  it('dialogue: 取 patch.startMs（拖整体或拖左 handle）', () => {
    expect(
      previewKeyTimeMs({
        kind: 'dialogue',
        id: 'd1',
        patch: { startMs: 1500, endMs: 2500 },
        deltaMs: 500,
      }),
    ).toBe(1500)
  })

  it('dialogue: patch 仅 endMs（右 handle）→ 取 endMs', () => {
    expect(
      previewKeyTimeMs({
        kind: 'dialogue',
        id: 'd1',
        patch: { endMs: 3000 },
        deltaMs: 500,
      }),
    ).toBe(3000)
  })

  it('cue: 取 patch.targetAt（拖整体或拖目标点）', () => {
    expect(
      previewKeyTimeMs({
        kind: 'cue',
        id: 'c1',
        patch: { appearAt: 800, targetAt: 1200 },
        deltaMs: 400,
      }),
    ).toBe(1200)
  })

  it('cue: 拖 leadIn → patch 仅 slowMo → 返回 null', () => {
    expect(
      previewKeyTimeMs({
        kind: 'cue',
        id: 'c1',
        patch: { slowMo: { rate: 0.3, leadInMs: 200 } },
        deltaMs: -100,
      }),
    ).toBeNull()
  })

  it('branch: 取 patch.showAt', () => {
    expect(
      previewKeyTimeMs({
        kind: 'branch',
        id: 'b1',
        patch: { showAt: 2200 },
        deltaMs: 200,
      }),
    ).toBe(2200)
  })

  it('空 patch → 返回 null', () => {
    expect(
      previewKeyTimeMs({
        kind: 'dialogue',
        id: 'd1',
        patch: {},
        deltaMs: 0,
      }),
    ).toBeNull()
  })
})
