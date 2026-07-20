import { describe, expect, it } from 'vitest'
import {
  maskSecret,
  pickPublicVideoConfig,
  sanitizeScenarioForIO,
} from '../sanitize'
import type { Scenario, VideoConfig } from '../types'

const baseScenario = (videoConfig?: Partial<VideoConfig>): Scenario => ({
  id: 'test',
  title: 'T',
  rootSceneId: 's1',
  defaultCharMs: 32,
  schemaVersion: 1,
  scenes: {
    s1: {
      id: 's1',
      title: 's1',
      durationMs: 5000,
      media: { kind: 'PLACEHOLDER' },
      dialogue: [],
      branches: [],
    },
  },
  videoConfig: videoConfig
    ? ({ provider: 'seedance', ...videoConfig } as VideoConfig)
    : undefined,
})

describe('sanitize · pickPublicVideoConfig', () => {
  it('保留 model/duration/size/provider（新档位）', () => {
    const out = pickPublicVideoConfig({
      provider: 'seedance',
      model: 'doubao',
      durationSec: 10,
      size: '1080p',
    })
    expect(out).toEqual({
      provider: 'seedance',
      model: 'doubao',
      durationSec: 10,
      size: '1080p',
    })
  })

  it('保留旧像素串 size 别名（向后兼容已持久化数据）', () => {
    const out = pickPublicVideoConfig({
      provider: 'seedance',
      model: 'doubao',
      durationSec: 10,
      size: '1280x720',
    })
    expect(out).toEqual({
      provider: 'seedance',
      model: 'doubao',
      durationSec: 10,
      size: '1280x720',
    })
  })

  it('剔除 apiKey 与 apiBase（核心安全保证）', () => {
    const out = pickPublicVideoConfig({
      provider: 'seedance',
      apiKey: 'sk-very-secret-1234',
      apiBase: 'https://attacker.example/api',
      model: 'doubao',
    })
    expect(out).not.toHaveProperty('apiKey')
    expect(out).not.toHaveProperty('apiBase')
    expect(out).toEqual({ provider: 'seedance', model: 'doubao' })
  })

  it('入参 undefined → 空对象，不抛错', () => {
    expect(pickPublicVideoConfig(undefined)).toEqual({})
  })

  it('保留 generateAudio / watermark 新字段（v3.9 多模态参考/音轨控制）', () => {
    const out = pickPublicVideoConfig({
      provider: 'seedance',
      model: 'ep-xxxxxxxxxxxxxx-xxxxx',
      size: '1080p',
      durationSec: 11,
      generateAudio: true,
      watermark: false,
    })
    expect(out).toEqual({
      provider: 'seedance',
      model: 'ep-xxxxxxxxxxxxxx-xxxxx',
      size: '1080p',
      durationSec: 11,
      generateAudio: true,
      watermark: false,
    })
  })
})

describe('sanitize · sanitizeScenarioForIO', () => {
  it('剧本里若残留 apiKey/apiBase，必须被剥离', () => {
    const dirty = baseScenario({
      apiKey: 'sk-leak',
      apiBase: 'https://attacker.example',
      model: 'doubao',
    })
    const clean = sanitizeScenarioForIO(dirty)
    expect(clean.videoConfig?.apiKey).toBeUndefined()
    expect(clean.videoConfig?.apiBase).toBeUndefined()
    expect(clean.videoConfig?.model).toBe('doubao')
  })

  it('没有 videoConfig 时不报错也不新增', () => {
    const s = baseScenario()
    expect(sanitizeScenarioForIO(s).videoConfig).toBeUndefined()
  })

  it('返回新对象，不修改入参（避免引用泄漏）', () => {
    const original = baseScenario({ apiKey: 'sk-leak' })
    const clean = sanitizeScenarioForIO(original)
    expect(original.videoConfig?.apiKey).toBe('sk-leak')
    expect(clean).not.toBe(original)
    expect(clean.scenes).toBe(original.scenes)
  })
})

describe('sanitize · maskSecret', () => {
  it('短串全 *', () => {
    expect(maskSecret('abc')).toBe('***')
  })
  it('长串前 4 + 后 4 + 长度', () => {
    expect(maskSecret('sk-abcdefghijklmnop')).toBe('sk-a…mnop (len=19)')
  })
  it('空值标识', () => {
    expect(maskSecret('')).toBe('(empty)')
    expect(maskSecret(undefined)).toBe('(empty)')
  })
})
