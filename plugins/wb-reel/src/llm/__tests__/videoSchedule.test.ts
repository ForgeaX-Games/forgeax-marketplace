import { describe, it, expect } from 'vitest'
import {
  buildVideoDag,
  layerizeDag,
  criticalPathDurationSec,
} from '../videoSchedule'
import type { VideoPlan, VideoSegment } from '../videoPlanTypes'

function makeSeg(
  id: string,
  shotId: string,
  opts: Partial<VideoSegment> = {},
): VideoSegment {
  return {
    id,
    sceneId: 'sc-1',
    shotId,
    segmentIndex: 0,
    durationSec: 5,
    prompt: 'p',
    continuityGroupId: `grp-${shotId}`,
    startFrameStrategy: 'shot-keyframe',
    shotOrder: 0,
    ...opts,
  }
}

function plan(segments: VideoSegment[]): VideoPlan {
  return {
    sceneId: 'sc-1',
    segments,
    modelId: 'seedance-doubao',
    rationale: 'test',
    warnings: [],
  }
}

describe('buildVideoDag · DAG 构建', () => {
  it('所有独立 shot → 全部 roots', () => {
    const segs = [
      makeSeg('a0', 'a', { shotOrder: 0 }),
      makeSeg('b0', 'b', { shotOrder: 1 }),
      makeSeg('c0', 'c', { shotOrder: 2 }),
    ]
    const dag = buildVideoDag(plan(segs))
    expect(dag.roots).toEqual(['a0', 'b0', 'c0'])
    expect(dag.nodes.every((n) => n.waitFor.length === 0)).toBe(true)
  })

  it('同 shot 拆多段串行', () => {
    const segs = [
      makeSeg('a0', 'a', { segmentIndex: 0 }),
      makeSeg('a1', 'a', { segmentIndex: 1, dependsOnSegmentId: 'a0', startFrameStrategy: 'prev-segment-tail' }),
      makeSeg('a2', 'a', { segmentIndex: 2, dependsOnSegmentId: 'a1', startFrameStrategy: 'prev-segment-tail' }),
    ]
    const dag = buildVideoDag(plan(segs))
    expect(dag.roots).toEqual(['a0'])
    expect(dag.nodes[1]!.waitFor).toEqual(['a0'])
    expect(dag.nodes[2]!.waitFor).toEqual(['a1'])
  })

  it('连续组跨 shot 串行 + 独立组并行混合', () => {
    const segs = [
      // 追逐戏同组
      makeSeg('a0', 'a', { shotOrder: 0, continuityGroupId: 'chase' }),
      makeSeg('b0', 'b', { shotOrder: 1, continuityGroupId: 'chase', dependsOnSegmentId: 'a0', startFrameStrategy: 'prev-segment-tail' }),
      // 回忆闪回独立
      makeSeg('c0', 'c', { shotOrder: 2, continuityGroupId: 'grp-c' }),
    ]
    const dag = buildVideoDag(plan(segs))
    // 两个 root：a0（追逐组首段）+ c0（独立）
    expect(dag.roots.sort()).toEqual(['a0', 'c0'])
    expect(dag.nodes[1]!.waitFor).toEqual(['a0'])
  })

  it('环依赖被检测并强制打断', () => {
    const segs = [
      makeSeg('a0', 'a', { dependsOnSegmentId: 'b0' }),
      makeSeg('b0', 'b', { dependsOnSegmentId: 'a0' }),
    ]
    const dag = buildVideoDag(plan(segs))
    expect(dag.warnings.some((w) => w.includes('环'))).toBe(true)
    expect(dag.nodes.every((n) => n.waitFor.length === 0)).toBe(true)
  })

  it('dependsOn 指向不存在段 → 告警并断开', () => {
    const segs = [
      makeSeg('a0', 'a', { dependsOnSegmentId: 'ghost' }),
    ]
    const dag = buildVideoDag(plan(segs))
    expect(dag.warnings.some((w) => w.includes('不存在'))).toBe(true)
    expect(dag.nodes[0]!.waitFor).toEqual([])
  })

  it('defaultConcurrency 透传到 recommendedConcurrency', () => {
    const dag = buildVideoDag(plan([makeSeg('a0', 'a')]), { defaultConcurrency: 5 })
    expect(dag.recommendedConcurrency).toBe(5)
  })
})

describe('layerizeDag · 波次', () => {
  it('独立段 → 1 波', () => {
    const segs = [makeSeg('a0', 'a'), makeSeg('b0', 'b', { shotOrder: 1 })]
    const waves = layerizeDag(buildVideoDag(plan(segs)))
    expect(waves.length).toBe(1)
    expect(waves[0]!.map((s) => s.id).sort()).toEqual(['a0', 'b0'])
  })

  it('三段串行 → 3 波', () => {
    const segs = [
      makeSeg('a0', 'a', { segmentIndex: 0 }),
      makeSeg('a1', 'a', { segmentIndex: 1, dependsOnSegmentId: 'a0' }),
      makeSeg('a2', 'a', { segmentIndex: 2, dependsOnSegmentId: 'a1' }),
    ]
    const waves = layerizeDag(buildVideoDag(plan(segs)))
    expect(waves.map((w) => w.map((s) => s.id))).toEqual([['a0'], ['a1'], ['a2']])
  })

  it('连续组 + 独立 → 串行组跑完才轮到结束', () => {
    const segs = [
      makeSeg('chase0', 'a', { continuityGroupId: 'chase' }),
      makeSeg('chase1', 'b', { shotOrder: 1, continuityGroupId: 'chase', dependsOnSegmentId: 'chase0' }),
      makeSeg('solo', 'c', { shotOrder: 2, continuityGroupId: 'grp-c' }),
    ]
    const waves = layerizeDag(buildVideoDag(plan(segs)))
    // 波 0：chase0 + solo；波 1：chase1
    expect(waves.length).toBe(2)
    expect(waves[0]!.map((s) => s.id).sort()).toEqual(['chase0', 'solo'])
    expect(waves[1]!.map((s) => s.id)).toEqual(['chase1'])
  })
})

describe('criticalPathDurationSec · 关键路径', () => {
  it('并行 → 取最长一段', () => {
    const segs = [
      makeSeg('a0', 'a', { durationSec: 5 }),
      makeSeg('b0', 'b', { durationSec: 10, shotOrder: 1 }),
    ]
    expect(criticalPathDurationSec(buildVideoDag(plan(segs)))).toBe(10)
  })

  it('串行 → 累加', () => {
    const segs = [
      makeSeg('a0', 'a', { durationSec: 10 }),
      makeSeg('a1', 'a', { durationSec: 10, segmentIndex: 1, dependsOnSegmentId: 'a0' }),
      makeSeg('a2', 'a', { durationSec: 10, segmentIndex: 2, dependsOnSegmentId: 'a1' }),
    ]
    expect(criticalPathDurationSec(buildVideoDag(plan(segs)))).toBe(30)
  })

  it('空 DAG 返回 0', () => {
    expect(criticalPathDurationSec(buildVideoDag(plan([])))).toBe(0)
  })
})
