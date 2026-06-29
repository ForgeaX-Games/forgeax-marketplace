import { describe, it, expect } from 'vitest'
import {
  MODEL_CAPABILITIES,
  DEFAULT_MODEL,
  getCapability,
  fitsInSingleClip,
  splitDurationToSegments,
  listCapabilities,
} from '../modelCapabilities'

describe('modelCapabilities · 能力表', () => {
  it('DEFAULT_MODEL 在表里', () => {
    expect(MODEL_CAPABILITIES[DEFAULT_MODEL]).toBeDefined()
  })

  it('所有 capability 条目都有必填字段', () => {
    Object.values(MODEL_CAPABILITIES).forEach((c) => {
      expect(c.id).toBeTruthy()
      expect(c.displayName).toBeTruthy()
      expect(c.asOf).toMatch(/^\d{4}-\d{2}$/)
      expect(c.maxSingleClipSec).toBeGreaterThan(0)
      expect(c.minUsefulClipSec).toBeGreaterThan(0)
      expect(c.minUsefulClipSec).toBeLessThanOrEqual(c.maxSingleClipSec)
      expect(c.recommendedConcurrency).toBeGreaterThan(0)
      expect(c.notes).toBeTruthy()
    })
  })
})

describe('Seedance 2.0 条目（P3-A）', () => {
  it('seedance-2-0：4~15s、9 图、首尾帧 + 尾帧回传 + 原生延长 + 同步音轨', () => {
    const c = MODEL_CAPABILITIES['seedance-2-0']
    expect(c.maxSingleClipSec).toBe(15)
    expect(c.minUsefulClipSec).toBe(4)
    expect(c.durationRangeSec).toEqual([4, 15])
    expect(c.maxRefImages).toBe(9)
    expect(c.maxRefVideos).toBe(3)
    expect(c.maxRefAudios).toBe(3)
    expect(c.supportsStartEndFrame).toBe(true)
    expect(c.supportsGenerateAudio).toBe(true)
    expect(c.supportsReturnLastFrame).toBe(true)
    expect(c.supportsVideoExtend).toBe(true)
    expect(c.resolutions).toContain('1080p')
  })
  it('seedance-2-0-fast：上限 12s、无 1080p，其余同 2.0', () => {
    const c = MODEL_CAPABILITIES['seedance-2-0-fast']
    expect(c.maxSingleClipSec).toBe(12)
    expect(c.durationRangeSec).toEqual([4, 12])
    expect(c.resolutions).not.toContain('1080p')
    expect(c.supportsReturnLastFrame).toBe(true)
    expect(c.supportsVideoExtend).toBe(true)
  })
  it('两个新 id 都能被 getCapability 命中', () => {
    expect(getCapability('seedance-2-0').id).toBe('seedance-2-0')
    expect(getCapability('seedance-2-0-fast').id).toBe('seedance-2-0-fast')
  })
})

describe('getCapability · 容错', () => {
  it('已知 id 命中', () => {
    expect(getCapability('seedance-doubao').id).toBe('seedance-doubao')
  })
  it('未知 id 回退默认', () => {
    expect(getCapability('nonexistent-model').id).toBe(DEFAULT_MODEL)
  })
  it('undefined 回退默认', () => {
    expect(getCapability().id).toBe(DEFAULT_MODEL)
  })
})

describe('fitsInSingleClip', () => {
  const cap = MODEL_CAPABILITIES['seedance-doubao']
  it('时长 ≤ max 能一次生', () => {
    expect(fitsInSingleClip(5, cap)).toBe(true)
    expect(fitsInSingleClip(10, cap)).toBe(true)
  })
  it('时长 > max 必须拆', () => {
    expect(fitsInSingleClip(11, cap)).toBe(false)
    expect(fitsInSingleClip(30, cap)).toBe(false)
  })
  it('0 / 负值不合法', () => {
    expect(fitsInSingleClip(0, cap)).toBe(false)
    expect(fitsInSingleClip(-1, cap)).toBe(false)
  })
})

describe('splitDurationToSegments · 长镜拆段', () => {
  const cap = MODEL_CAPABILITIES['seedance-doubao'] // max 10s, min 3s

  it('≤ max 不拆', () => {
    expect(splitDurationToSegments(5, cap)).toEqual([5])
    expect(splitDurationToSegments(10, cap)).toEqual([10])
    expect(splitDurationToSegments(1, cap)).toEqual([1]) // 快切 1s 保留
  })

  it('30s / 10s → 三段 10s 均匀', () => {
    expect(splitDurationToSegments(30, cap)).toEqual([10, 10, 10])
  })

  it('25s / 10s → 均匀偏前不留 1s 尾', () => {
    const segs = splitDurationToSegments(25, cap)
    expect(segs.reduce((a, b) => a + b, 0)).toBe(25)
    expect(segs.length).toBe(3)
    expect(segs.every((s) => s >= cap.minUsefulClipSec)).toBe(true)
  })

  it('12s / 10s → 两段 6+6', () => {
    expect(splitDurationToSegments(12, cap)).toEqual([6, 6])
  })

  it('非法输入返回空数组', () => {
    expect(splitDurationToSegments(0, cap)).toEqual([])
    expect(splitDurationToSegments(-5, cap)).toEqual([])
    expect(splitDurationToSegments(NaN, cap)).toEqual([])
  })

  it('小数输入就近取整', () => {
    expect(splitDurationToSegments(10.4, cap)).toEqual([10])
    expect(splitDurationToSegments(10.6, cap)).toEqual([6, 5])
  })
})

describe('listCapabilities', () => {
  it('默认模型排第一', () => {
    const list = listCapabilities()
    expect(list[0]!.id).toBe(DEFAULT_MODEL)
  })
  it('长度等于表大小', () => {
    expect(listCapabilities().length).toBe(Object.keys(MODEL_CAPABILITIES).length)
  })
})
