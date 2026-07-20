import { describe, it, expect } from 'vitest'
import {
  validateReelScenario,
  assertReelScenario,
  extractValidatedScenario,
} from '../validateScenario'

/** 最小合法骨架：runtime 寻路真正依赖的字段都齐。 */
function validScenario(): Record<string, unknown> {
  return {
    id: 'narr-1',
    title: '三国',
    rootSceneId: 'sc-root',
    schemaVersion: 8,
    defaultCharMs: 30,
    scenes: {
      'sc-root': {
        id: 'sc-root',
        title: '开场',
        durationMs: 5000,
        media: { kind: 'video', id: 'm-1' },
        dialogue: [],
        branches: [],
      },
    },
  }
}

describe('validateReelScenario', () => {
  it('骨架齐全 → ok', () => {
    expect(validateReelScenario(validScenario())).toEqual({ ok: true })
  })

  it('长尾未知字段宽松放行（additionalProperties:true）', () => {
    const s = validScenario()
    s.directorStyle = 'minimal-epic'
    s.variables = { aff: { value: 0 } }
    ;(s.scenes as Record<string, Record<string, unknown>>)['sc-root']!.textOverlays = [
      { id: 'tx', whatever: true },
    ]
    expect(validateReelScenario(s).ok).toBe(true)
  })

  it('缺顶层必填字段 → 失败并报路径', () => {
    const s = validScenario()
    delete s.rootSceneId
    const r = validateReelScenario(s)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toContain('rootSceneId')
  })

  it('schemaVersion 越界（>8）→ 失败', () => {
    const s = validScenario()
    s.schemaVersion = 99
    expect(validateReelScenario(s).ok).toBe(false)
  })

  it('scenes 为空对象 → 失败（rootSceneId 无处寻址）', () => {
    const s = validScenario()
    s.scenes = {}
    expect(validateReelScenario(s).ok).toBe(false)
  })

  it('scene 缺 durationMs / branches → 失败并指到该 scene', () => {
    const s = validScenario()
    const scene = (s.scenes as Record<string, Record<string, unknown>>)['sc-root']!
    delete scene.durationMs
    delete scene.branches
    const r = validateReelScenario(s)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join('\n')).toContain('sc-root')
  })

  it('非对象 → 失败', () => {
    expect(validateReelScenario(null).ok).toBe(false)
    expect(validateReelScenario('nope').ok).toBe(false)
  })
})

describe('assertReelScenario', () => {
  it('合法不抛', () => {
    expect(() => assertReelScenario(validScenario())).not.toThrow()
  })
  it('非法抛出带全部错误', () => {
    expect(() => assertReelScenario({ id: 'x' })).toThrow(/schema 校验失败/)
  })
})

describe('extractValidatedScenario', () => {
  it('从 payload 取出并校验', () => {
    const scenario = extractValidatedScenario({ schemaVersion: 1, scenario: validScenario() })
    expect(scenario.id).toBe('narr-1')
  })
  it('缺 scenario → 抛', () => {
    expect(() => extractValidatedScenario({ schemaVersion: 1 })).toThrow(/缺少 scenario/)
  })
  it('scenario 不合契约 → 抛', () => {
    expect(() => extractValidatedScenario({ scenario: { id: 'x' } })).toThrow(/schema 校验失败/)
  })
})
