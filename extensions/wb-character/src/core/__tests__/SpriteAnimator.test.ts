import { describe, it, expect } from 'vitest'
import { computeFrameDrawSize } from '../SpriteAnimator'

describe('computeFrameDrawSize — per-frame scale normalization', () => {
  it('square image matching canvas fills exactly', () => {
    expect(computeFrameDrawSize(256, 256, 256)).toEqual({ dw: 256, dh: 256 })
  })

  it('smaller square is upscaled so long edge === canvas size', () => {
    // 角色左右帧常见情形：原始 128×128 放到 256 canvas 必须放大到 256×256
    // 保证与上下方向在 sprite plane 上视觉大小一致
    expect(computeFrameDrawSize(128, 128, 256)).toEqual({ dw: 256, dh: 256 })
  })

  it('larger square is downscaled to fit canvas', () => {
    expect(computeFrameDrawSize(512, 512, 256)).toEqual({ dw: 256, dh: 256 })
  })

  it('portrait aspect — long edge (height) hits canvas size, width scaled proportionally', () => {
    // 128×256 → 长边 256，缩放系数 1，宽 128 保持
    expect(computeFrameDrawSize(128, 256, 256)).toEqual({ dw: 128, dh: 256 })
  })

  it('landscape aspect — long edge (width) hits canvas size', () => {
    expect(computeFrameDrawSize(256, 128, 256)).toEqual({ dw: 256, dh: 128 })
  })

  it('portrait smaller than canvas is upscaled preserving aspect', () => {
    // 64×128 长边 128 → 256（翻倍），宽 64 → 128
    expect(computeFrameDrawSize(64, 128, 256)).toEqual({ dw: 128, dh: 256 })
  })

  it('degenerate input (0 dim) returns zero size', () => {
    expect(computeFrameDrawSize(0, 128, 256)).toEqual({ dw: 0, dh: 0 })
    expect(computeFrameDrawSize(128, 0, 256)).toEqual({ dw: 0, dh: 0 })
    expect(computeFrameDrawSize(128, 128, 0)).toEqual({ dw: 0, dh: 0 })
  })

  it('never rounds down to zero for tiny images', () => {
    // 1×1 放到 256 canvas：最小也应该至少 1 像素
    const r = computeFrameDrawSize(1, 1, 256)
    expect(r.dw).toBeGreaterThanOrEqual(1)
    expect(r.dh).toBeGreaterThanOrEqual(1)
  })
})
