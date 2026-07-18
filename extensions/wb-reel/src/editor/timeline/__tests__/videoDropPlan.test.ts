import { describe, it, expect } from 'vitest'
import { planVideoDrop } from '../videoDropPlan'

/**
 * 视频拖入时间轴 · 时长规划纯函数
 *
 * 作者反馈（2026-04-30）："拖入视频在时间轴上很短，根本没按照视频时长。"
 *
 * 根因：
 *   - TimelineDock render 时把 durationMs（来自 cache）烤死到 payload；
 *     loadedmetadata 未触发过时，cache 空 → durationMs=0
 *   - Timeline onTrackDrop 看到 0 走兜底 4 秒，还会被 Math.min(剩余场景时长)
 *     进一步夹短，导致视频铁定缩水
 *
 * 修法切面：
 *   1. 把「要放多长」做成纯函数（本文件）
 *   2. drop 前若视频时长不够（payload=0），改为异步 probe 视频真时长再提交
 *   3. 如果视频真时长超过当前 scene.durationMs，自动扩展场景总长
 *
 * 本函数的契约：
 *   输入：startMs、请求时长 requestedMs、当前场景总时长 sceneDurationMs
 *   输出：
 *     - startMs, endMs —— 实际落到 shot 上的起止
 *     - nextSceneDurationMs —— 如果需要扩展，给出的新场景总时长；不需扩展时等于 sceneDurationMs
 *
 *   规则：
 *     A. 当 startMs + requestedMs <= sceneDurationMs → 不扩展，endMs = startMs + requestedMs
 *     B. 当 startMs + requestedMs  > sceneDurationMs → 扩展场景，nextSceneDurationMs = startMs + requestedMs
 *     C. 所有输入经过正向夹取：startMs ≥ 0，requestedMs ≥ MIN_SHOT_MS
 *     D. requestedMs 缺失（0/负/undefined）→ 用 DEFAULT_VIDEO_SHOT_MS 兜底
 */

describe('planVideoDrop', () => {
  it('视频比剩余场景短 → 不扩展，startMs+requested 就是 endMs', () => {
    const p = planVideoDrop({
      startMs: 1000,
      requestedMs: 3000,
      sceneDurationMs: 12000,
    })
    expect(p.startMs).toBe(1000)
    expect(p.endMs).toBe(4000)
    expect(p.nextSceneDurationMs).toBe(12000)
  })

  it('视频放不下当前场景 → 自动扩展场景总时长', () => {
    const p = planVideoDrop({
      startMs: 2000,
      requestedMs: 20000, // 20s 视频
      sceneDurationMs: 12000, // 场景只有 12s
    })
    expect(p.startMs).toBe(2000)
    expect(p.endMs).toBe(22000)
    expect(p.nextSceneDurationMs).toBe(22000)
  })

  it('requestedMs=0（未 probe 到真时长）→ 用默认 4 秒兜底', () => {
    const p = planVideoDrop({
      startMs: 0,
      requestedMs: 0,
      sceneDurationMs: 12000,
    })
    expect(p.endMs - p.startMs).toBe(4000)
  })

  it('requestedMs 为负/undefined → 同样走默认兜底', () => {
    const a = planVideoDrop({
      startMs: 0,
      requestedMs: -100,
      sceneDurationMs: 12000,
    })
    expect(a.endMs - a.startMs).toBe(4000)
  })

  it('startMs 越界 → 夹到 [0, sceneDurationMs]', () => {
    const p = planVideoDrop({
      startMs: -500,
      requestedMs: 3000,
      sceneDurationMs: 12000,
    })
    expect(p.startMs).toBe(0)
    expect(p.endMs).toBe(3000)
  })

  it('startMs > sceneDurationMs → 夹到末尾，然后按视频时长扩展', () => {
    const p = planVideoDrop({
      startMs: 20000,
      requestedMs: 5000,
      sceneDurationMs: 12000,
    })
    expect(p.startMs).toBe(12000)
    expect(p.endMs).toBe(17000)
    expect(p.nextSceneDurationMs).toBe(17000)
  })

  it('刚好贴合场景末尾：startMs+requestedMs == sceneDurationMs → 不扩展', () => {
    const p = planVideoDrop({
      startMs: 9000,
      requestedMs: 3000,
      sceneDurationMs: 12000,
    })
    expect(p.endMs).toBe(12000)
    expect(p.nextSceneDurationMs).toBe(12000)
  })

  it('requestedMs 超小（如 200ms）→ 至少保证最小 shot 时长', () => {
    const p = planVideoDrop({
      startMs: 0,
      requestedMs: 200,
      sceneDurationMs: 12000,
    })
    expect(p.endMs - p.startMs).toBeGreaterThanOrEqual(500)
  })
})
