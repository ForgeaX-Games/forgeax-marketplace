/**
 * @vitest-environment happy-dom
 *
 * Note: happy-dom doesn't implement HTMLCanvasElement#getContext('2d'), so we
 * can only unit-test the pure/non-canvas code paths here. Canvas-heavy branches
 * (measureContentHeight / rescaleFrameData with scale !== 1) are exercised
 * end-to-end in the browser via the action-library UI.
 */
import { describe, it, expect } from 'vitest'
import {
  clampScale,
  rescaleFrameData,
  rescaleDirections,
} from '../sprite-processor'

// ── clampScale — pure function, no DOM ───────────────────────────────

describe('clampScale', () => {
  it('passes sane values through unchanged', () => {
    expect(clampScale(1)).toBe(1)
    expect(clampScale(0.5)).toBe(0.5)
    expect(clampScale(1.8)).toBe(1.8)
  })

  it('clamps values below 0.3 up to the floor', () => {
    expect(clampScale(0.1)).toBe(0.3)
    expect(clampScale(0)).toBe(0.3)
    expect(clampScale(-5)).toBe(0.3)
  })

  it('accepts values up to the ceiling (3.0)', () => {
    expect(clampScale(2.5)).toBe(2.5)
    expect(clampScale(3)).toBe(3)
  })

  it('clamps values above 3.0 down to the ceiling', () => {
    expect(clampScale(3.5)).toBe(3)
    expect(clampScale(10)).toBe(3)
  })

  it('falls back to 1 for non-finite input (NaN / Infinity)', () => {
    expect(clampScale(Number.NaN)).toBe(1)
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampScale(Number.NEGATIVE_INFINITY)).toBe(1)
  })
})

// ── measureContentHeight — canvas-dependent, covered by browser UAT ──
// measureContentHeight requires a working HTMLCanvasElement#getContext('2d'),
// which happy-dom does not implement. We verify this path manually in the
// browser via the "自动统一大小" button in the action library.

// ── rescaleFrameData — identity branches ─────────────────────────────

describe('rescaleFrameData identity paths', () => {
  it('returns the same URL when scale === 1', async () => {
    const url = 'data:image/png;base64,FAKE'
    expect(await rescaleFrameData(url, 1)).toBe(url)
  })

  it('returns the same URL when scale is NaN', async () => {
    const url = 'data:image/png;base64,FAKE'
    expect(await rescaleFrameData(url, Number.NaN)).toBe(url)
  })

  it('returns the same URL when scale is Infinity', async () => {
    const url = 'data:image/png;base64,FAKE'
    expect(await rescaleFrameData(url, Number.POSITIVE_INFINITY)).toBe(url)
  })
})

// ── rescaleDirections — structural behaviour ─────────────────────────

describe('rescaleDirections', () => {
  it('returns a fresh object at scale=1 so callers can mutate safely', async () => {
    const src = { down: ['u1', 'u2'], up: ['u3'] }
    const out = await rescaleDirections(src, 1)
    expect(out).not.toBe(src)
    expect(out.down).not.toBe(src.down)
    // URLs themselves untouched on the identity path
    expect(out.down).toEqual(['u1', 'u2'])
    expect(out.up).toEqual(['u3'])
  })

  it('keeps the same set of direction keys', async () => {
    const src = { down: ['a'], up: ['b'], left: ['c'], right: ['d'] }
    const out = await rescaleDirections(src, 1)
    expect(Object.keys(out).sort()).toEqual(['down', 'left', 'right', 'up'])
  })

  it('preserves frame count per direction at scale=1', async () => {
    const src = { down: ['1', '2', '3'], up: ['4', '5'] }
    const out = await rescaleDirections(src, 1)
    expect(out.down.length).toBe(3)
    expect(out.up.length).toBe(2)
  })

  it('treats NaN scale as identity (shape preserved, urls untouched)', async () => {
    const src = { down: ['x'] }
    const out = await rescaleDirections(src, Number.NaN)
    expect(out.down).toEqual(['x'])
  })

  it('handles empty input without crashing', async () => {
    const out = await rescaleDirections({}, 1)
    expect(Object.keys(out)).toEqual([])
  })
})
