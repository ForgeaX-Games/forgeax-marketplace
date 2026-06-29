import { describe, it, expect } from 'vitest'
import {
  buildSegmentsFromShots,
  applyContinuityAssignments,
  parseContinuityDecision,
  augmentPromptWithContinuityContext,
  decideExtendStrategy,
  composeContinuityDeclaration,
} from '../forgeVideoPlan'
import { getCapability } from '../modelCapabilities'
import type { Scene, Shot } from '../../scenario/types'

function makeShot(id: string, order: number, opts: Partial<Shot> = {}): Shot {
  return {
    id,
    order,
    framing: 'medium',
    prompt: `shot ${id} prompt`,
    ...opts,
  }
}

function makeScene(shots: Shot[], id = 'sc-1'): Scene {
  return {
    id,
    title: 'Test Scene',
    ref: 'loc-1',
    prompts: { scene: 'base scene prompt' },
    shots,
  }
}

describe('buildSegmentsFromShots · 物理拆段', () => {
  const cap = getCapability('seedance-doubao') // max 10s

  it('短镜 5s → 1 段', () => {
    const scene = makeScene([makeShot('a', 0, { durationSec: 5 })])
    const segs = buildSegmentsFromShots(scene, cap)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.durationSec).toBe(5)
    expect(segs[0]!.continuityGroupId).toBe('grp-a')
    expect(segs[0]!.dependsOnSegmentId).toBeUndefined()
  })

  it('30s 长镜 → 3 段 10s 串行，dependsOn 链完整', () => {
    const scene = makeScene([makeShot('a', 0, { durationSec: 30 })])
    const segs = buildSegmentsFromShots(scene, cap)
    expect(segs).toHaveLength(3)
    expect(segs.map((s) => s.durationSec)).toEqual([10, 10, 10])
    expect(segs[0]!.dependsOnSegmentId).toBeUndefined()
    expect(segs[1]!.dependsOnSegmentId).toBe(segs[0]!.id)
    expect(segs[2]!.dependsOnSegmentId).toBe(segs[1]!.id)
    // 同 shot 多段共享 groupId
    expect(new Set(segs.map((s) => s.continuityGroupId))).toEqual(new Set(['grp-a']))
  })

  it('首段 startFrameStrategy 看 keyframeStrategy', () => {
    const scene = makeScene([
      makeShot('a', 0, { durationSec: 5, keyframeStrategy: 'ab' }),
      makeShot('b', 1, { durationSec: 5, keyframeStrategy: 'single' }),
      makeShot('c', 2, { durationSec: 5 }), // 缺省
    ])
    const segs = buildSegmentsFromShots(scene, cap)
    expect(segs[0]!.startFrameStrategy).toBe('shot-start-frame')
    expect(segs[1]!.startFrameStrategy).toBe('shot-keyframe')
    expect(segs[2]!.startFrameStrategy).toBe('shot-keyframe')
  })

  it('多段 shot 第 N≥1 段 startFrame 为 prev-segment-tail', () => {
    const scene = makeScene([makeShot('a', 0, { durationSec: 25 })])
    const segs = buildSegmentsFromShots(scene, cap)
    expect(segs[0]!.startFrameStrategy).toBe('shot-keyframe')
    expect(segs[1]!.startFrameStrategy).toBe('prev-segment-tail')
    expect(segs[2]!.startFrameStrategy).toBe('prev-segment-tail')
  })

  it('durationSec 缺失 → 默认 5s', () => {
    const scene = makeScene([makeShot('a', 0)])
    const segs = buildSegmentsFromShots(scene, cap)
    expect(segs[0]!.durationSec).toBe(5)
  })

  it('1s 快切保留为 1 段', () => {
    const scene = makeScene([makeShot('a', 0, { durationSec: 1 })])
    const segs = buildSegmentsFromShots(scene, cap)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.durationSec).toBe(1)
  })

  it('segment id 可稳定定位（scene-shot-segNN）', () => {
    const scene = makeScene([makeShot('sh1', 0, { durationSec: 12 })], 'myScene')
    const segs = buildSegmentsFromShots(scene, cap)
    expect(segs[0]!.id).toBe('myScene-sh1-seg00')
    expect(segs[1]!.id).toBe('myScene-sh1-seg01')
  })
})

describe('P3-C · Seedance 2.0 结算器接通 + 连续镜头续接', () => {
  const sd2 = getCapability('seedance-2-0') // max 15, floor 4, supportsVideoExtend
  const doubao = getCapability('seedance-doubao') // 旧模型，沿用 splitDurationToSegments

  it('2.0 走 planClipSegments：30s → [15,15]，承接段 extendStrategy=continuation', () => {
    const scene = makeScene([makeShot('a', 0, { durationSec: 30 })])
    const segs = buildSegmentsFromShots(scene, sd2)
    expect(segs.map((s) => s.durationSec)).toEqual([15, 15])
    expect(segs[0]!.extendStrategy).toBe('standalone') // 首段不承接
    expect(segs[1]!.startFrameStrategy).toBe('prev-segment-tail')
    expect(segs[1]!.extendStrategy).toBe('continuation')
  })

  it('2.0 单段短镜抬到 floor：2s → [4]（宁多勿少）', () => {
    const scene = makeScene([makeShot('a', 0, { durationSec: 2 })])
    const segs = buildSegmentsFromShots(scene, sd2)
    expect(segs).toHaveLength(1)
    expect(segs[0]!.durationSec).toBe(4)
  })

  it('旧模型沿用 splitDurationToSegments：保留 1s 快切（回归保护），承接段仍标 continuation', () => {
    const long = buildSegmentsFromShots(makeScene([makeShot('a', 0, { durationSec: 25 })]), doubao)
    expect(long[1]!.startFrameStrategy).toBe('prev-segment-tail')
    expect(long[1]!.extendStrategy).toBe('continuation')
    const quick = buildSegmentsFromShots(makeScene([makeShot('b', 0, { durationSec: 1 })]), doubao)
    expect(quick.map((s) => s.durationSec)).toEqual([1])
  })

  it('decideExtendStrategy 纯函数：承接段 → continuation，其余 standalone', () => {
    expect(decideExtendStrategy('prev-segment-tail')).toBe('continuation')
    expect(decideExtendStrategy('shot-keyframe')).toBe('standalone')
    expect(decideExtendStrategy('shot-start-frame')).toBe('standalone')
    expect(decideExtendStrategy('text-only')).toBe('standalone')
  })

  it('跨 shot 合并：后 shot 首段升 continuation', () => {
    const scene = makeScene([
      makeShot('a', 0, { durationSec: 5 }),
      makeShot('b', 1, { durationSec: 5 }),
    ])
    const segs = buildSegmentsFromShots(scene, sd2)
    applyContinuityAssignments(segs, { a: 'chase', b: 'chase' }, scene)
    expect(segs[1]!.startFrameStrategy).toBe('prev-segment-tail')
    expect(segs[1]!.extendStrategy).toBe('continuation')
  })

  it('composeContinuityDeclaration 明确声明「连续镜头/同一镜头/不切镜」', () => {
    const d = composeContinuityDeclaration()
    expect(d).toMatch(/连续镜头|一镜到底/)
    expect(d).toMatch(/同一镜头|不切换|不要跳剪|不要重新构图/)
    expect(d).toMatch(/尾帧/)
  })
})

describe('applyContinuityAssignments · LLM 语义决策落地', () => {
  const cap = getCapability('seedance-doubao')

  it('跨 shot 合并组：后 shot 首段变 prev-segment-tail + dependsOn 指向前 shot 末段', () => {
    const scene = makeScene([
      makeShot('a', 0, { durationSec: 5 }),
      makeShot('b', 1, { durationSec: 5 }),
    ])
    const segs = buildSegmentsFromShots(scene, cap)
    applyContinuityAssignments(segs, { a: 'chase', b: 'chase' }, scene)
    expect(segs[0]!.continuityGroupId).toBe('chase')
    expect(segs[1]!.continuityGroupId).toBe('chase')
    expect(segs[1]!.startFrameStrategy).toBe('prev-segment-tail')
    expect(segs[1]!.dependsOnSegmentId).toBe(segs[0]!.id)
  })

  it('空决策 → 不改变原组', () => {
    const scene = makeScene([makeShot('a', 0, { durationSec: 5 })])
    const segs = buildSegmentsFromShots(scene, cap)
    const before = segs[0]!.continuityGroupId
    applyContinuityAssignments(segs, {}, scene)
    expect(segs[0]!.continuityGroupId).toBe(before)
  })

  it('单 shot 拆多段 + 跨 shot 合并 → 依赖链完整', () => {
    const scene = makeScene([
      makeShot('a', 0, { durationSec: 20 }), // 2 段
      makeShot('b', 1, { durationSec: 5 }),  // 1 段
    ])
    const segs = buildSegmentsFromShots(scene, cap)
    applyContinuityAssignments(segs, { a: 'chase', b: 'chase' }, scene)
    expect(segs).toHaveLength(3)
    expect(segs[0]!.dependsOnSegmentId).toBeUndefined()
    expect(segs[1]!.dependsOnSegmentId).toBe(segs[0]!.id)
    expect(segs[2]!.dependsOnSegmentId).toBe(segs[1]!.id)
    expect(segs[2]!.startFrameStrategy).toBe('prev-segment-tail')
  })
})

describe('parseContinuityDecision · LLM 输出解析', () => {
  it('标准 JSON 输出', () => {
    const raw = JSON.stringify({
      groups: [{ groupId: 'chase', shotIds: ['a', 'b'], reason: 'r' }],
      rationale: 'test',
    })
    const d = parseContinuityDecision(raw)
    expect(d.assignments).toEqual({ a: 'chase', b: 'chase' })
    expect(d.rationale).toBe('test')
  })

  it('带 markdown 代码围栏能剥', () => {
    const raw = '```json\n{"groups":[{"groupId":"g","shotIds":["a","b"]}],"rationale":"ok"}\n```'
    const d = parseContinuityDecision(raw)
    expect(d.assignments).toEqual({ a: 'g', b: 'g' })
  })

  it('只有 1 个 shotId 的组被忽略', () => {
    const raw = JSON.stringify({
      groups: [{ groupId: 'solo', shotIds: ['a'] }],
      rationale: 'r',
    })
    const d = parseContinuityDecision(raw)
    expect(d.assignments).toEqual({})
  })

  it('非法 JSON 返回空 + 诊断 rationale', () => {
    const d = parseContinuityDecision('not json at all')
    expect(d.assignments).toEqual({})
    expect(d.rationale).toContain('无法解析')
  })

  it('空 groupId 被过滤', () => {
    const raw = JSON.stringify({
      groups: [{ groupId: '   ', shotIds: ['a', 'b'] }],
      rationale: 'r',
    })
    const d = parseContinuityDecision(raw)
    expect(d.assignments).toEqual({})
  })
})

describe('augmentPromptWithContinuityContext · 前后承接提示', () => {
  it('首段 + prevTail → 加承接锚点', () => {
    const out = augmentPromptWithContinuityContext('base prompt', '灯下转身', undefined, 0)
    expect(out).toContain('承接前镜')
    expect(out).toContain('灯下转身')
  })

  it('非首段 + prevTail → 不加承接（dependsOn 已物理串行）', () => {
    const out = augmentPromptWithContinuityContext('base prompt', '灯下转身', undefined, 1)
    expect(out).not.toContain('承接前镜')
  })

  it('nextHead → 加预接锚点', () => {
    const out = augmentPromptWithContinuityContext('base', undefined, '奔跑起势', 0)
    expect(out).toContain('预接下镜')
    expect(out).toContain('奔跑起势')
  })

  it('无前后 → 原样返回', () => {
    expect(augmentPromptWithContinuityContext('base', undefined, undefined, 0)).toBe('base')
  })

  it('超长 tail 被截断不爆 prompt', () => {
    const longTail = '超长' + 'x'.repeat(500)
    const out = augmentPromptWithContinuityContext('base', longTail, undefined, 0)
    expect(out.length).toBeLessThan(600)
    expect(out).toContain('…')
  })
})
