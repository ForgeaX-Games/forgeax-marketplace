import { describe, it, expect } from 'vitest'
import {
  decideSeekFromHover,
  decideHoverFromVideo,
  isAtSceneEnd,
  VIDEO_SYNC_EPSILON_MS,
  decideSeekFromHoverWithTrim,
  decideHoverFromVideoWithTrim,
  isAtTrimEnd,
  resolveTrimRange,
} from '../videoTimelineSync'

/*
 * 覆盖矩阵：
 *   方向                    | 暂停 | 播放中
 *   hoverMs → video.seek   |  ✓   |  null  （播放时不能再拿游标反向覆盖 video）
 *   videoMs → setHoverMs   | null |   ✓
 *   边界：负数 / > sceneMs / NaN / EPSILON 内不动 / EPSILON 外触发
 */

describe('decideSeekFromHover (暂停时游标拖到哪，视频就跳到哪)', () => {
  it('暂停、差距超 EPSILON → 返回目标秒数', () => {
    expect(
      decideSeekFromHover({
        hoverMs: 2500,
        videoMs: 1000,
        isPlaying: false,
        sceneMs: 5000,
      }),
    ).toBeCloseTo(2.5)
  })

  it('差距在 EPSILON 内 → null（不 seek，避免抖）', () => {
    expect(
      decideSeekFromHover({
        hoverMs: 1000,
        videoMs: 1000 + VIDEO_SYNC_EPSILON_MS - 1,
        isPlaying: false,
        sceneMs: 5000,
      }),
    ).toBeNull()
  })

  it('播放中一律 null（由视频主导）', () => {
    expect(
      decideSeekFromHover({
        hoverMs: 4000,
        videoMs: 1000,
        isPlaying: true,
        sceneMs: 5000,
      }),
    ).toBeNull()
  })

  it('hoverMs 超 sceneMs 夹到 sceneMs', () => {
    expect(
      decideSeekFromHover({
        hoverMs: 99999,
        videoMs: 0,
        isPlaying: false,
        sceneMs: 5000,
      }),
    ).toBeCloseTo(5)
  })

  it('hoverMs 负数 / NaN 退 0', () => {
    expect(
      decideSeekFromHover({
        hoverMs: -500,
        videoMs: 1000,
        isPlaying: false,
        sceneMs: 5000,
      }),
    ).toBeCloseTo(0)
    expect(
      decideSeekFromHover({
        hoverMs: Number.NaN,
        videoMs: 1000,
        isPlaying: false,
        sceneMs: 5000,
      }),
    ).toBeCloseTo(0)
  })
})

describe('decideHoverFromVideo (播放时视频推到哪，游标就跟到哪)', () => {
  it('播放中 + 差距超 EPSILON → 返回 ms', () => {
    expect(
      decideHoverFromVideo({
        hoverMs: 1000,
        videoMs: 2000,
        isPlaying: true,
        sceneMs: 5000,
      }),
    ).toBe(2000)
  })

  it('暂停中 → null（别拿视频反向骚扰游标）', () => {
    expect(
      decideHoverFromVideo({
        hoverMs: 1000,
        videoMs: 3000,
        isPlaying: false,
        sceneMs: 5000,
      }),
    ).toBeNull()
  })

  it('videoMs 无限大 / NaN → null（video 元素 loading 中会给 NaN）', () => {
    expect(
      decideHoverFromVideo({
        hoverMs: 1000,
        videoMs: Number.NaN,
        isPlaying: true,
        sceneMs: 5000,
      }),
    ).toBeNull()
  })

  it('videoMs 超 sceneMs 夹到 sceneMs', () => {
    expect(
      decideHoverFromVideo({
        hoverMs: 1000,
        videoMs: 9999,
        isPlaying: true,
        sceneMs: 5000,
      }),
    ).toBe(5000)
  })

  it('EPSILON 内不 emit', () => {
    expect(
      decideHoverFromVideo({
        hoverMs: 1000,
        videoMs: 1000 + VIDEO_SYNC_EPSILON_MS - 1,
        isPlaying: true,
        sceneMs: 5000,
      }),
    ).toBeNull()
  })
})

describe('isAtSceneEnd', () => {
  it('videoMs 到 sceneMs 附近（差在 EPSILON 内）→ true', () => {
    expect(
      isAtSceneEnd({
        hoverMs: 4999,
        videoMs: 5000 - VIDEO_SYNC_EPSILON_MS + 1,
        isPlaying: true,
        sceneMs: 5000,
      }),
    ).toBe(true)
  })

  it('还差很多 → false', () => {
    expect(
      isAtSceneEnd({
        hoverMs: 1000,
        videoMs: 2000,
        isPlaying: true,
        sceneMs: 5000,
      }),
    ).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────
// 裁剪变体覆盖矩阵：
//
// 场景：视频原长 10s，作者裁剪为 [2s, 7s]（offset=2000, clipDur=5000），
//       scene.durationMs = 5000（即时间轴 0-5s 对应视频 2s-7s）
//
// 关键用例：
//   · hoverMs=0 → 应 seek 到视频 2s（不是 0s）
//   · hoverMs=3000 → 应 seek 到视频 5s
//   · hoverMs=4999 → 应 seek 到视频 6.999s（不越过 7s）
//   · 播放中 videoMs=3000（视频文件 3s）→ 游标 = 3000-2000 = 1000ms
//   · 播放中 videoMs=6999（视频文件接近裁剪出点）→ isAtTrimEnd true
//
// 无裁剪 trim=undefined 时退化为无 offset 语义（保持向后兼容）。
// ─────────────────────────────────────────────────────────────────────

describe('resolveTrimRange', () => {
  it('trim 全缺省 → [0, sceneMs]', () => {
    expect(resolveTrimRange(undefined, 5000)).toEqual({ startMs: 0, endMs: 5000 })
  })
  it('只给 offset → [offset, offset+sceneMs]（clip 兜底=sceneMs）', () => {
    expect(resolveTrimRange({ offsetMs: 1000 }, 5000)).toEqual({
      startMs: 1000,
      endMs: 6000,
    })
  })
  it('显式裁剪段 → [offset, offset+clip]', () => {
    expect(
      resolveTrimRange({ offsetMs: 2000, clipDurationMs: 3000 }, 5000),
    ).toEqual({ startMs: 2000, endMs: 5000 })
  })
  it('非法值（负 offset / 0 clip / NaN）→ 退回缺省', () => {
    expect(resolveTrimRange({ offsetMs: -100 }, 5000)).toEqual({
      startMs: 0,
      endMs: 5000,
    })
    expect(
      resolveTrimRange({ offsetMs: 1000, clipDurationMs: 0 }, 5000),
    ).toEqual({ startMs: 1000, endMs: 6000 })
  })
})

describe('decideSeekFromHoverWithTrim', () => {
  const trim = { offsetMs: 2000, clipDurationMs: 5000 } // video [2s,7s]

  it('暂停、hoverMs=0 → seek 到视频 2s（起点 = offset）', () => {
    expect(
      decideSeekFromHoverWithTrim(
        { hoverMs: 0, videoMs: 5, isPlaying: false, sceneMs: 5000 },
        trim,
      ),
    ).toBeCloseTo(2)
  })

  it('暂停、hoverMs=3000 → seek 到视频 5s（offset + hoverMs）', () => {
    expect(
      decideSeekFromHoverWithTrim(
        { hoverMs: 3000, videoMs: 0, isPlaying: false, sceneMs: 5000 },
        trim,
      ),
    ).toBeCloseTo(5)
  })

  it('暂停、hoverMs 超 sceneMs → 夹到裁剪出点', () => {
    expect(
      decideSeekFromHoverWithTrim(
        { hoverMs: 99999, videoMs: 0, isPlaying: false, sceneMs: 5000 },
        trim,
      ),
    ).toBeCloseTo(7)
  })

  it('EPSILON 内不 seek（避免播放抖）', () => {
    expect(
      decideSeekFromHoverWithTrim(
        {
          hoverMs: 1000,
          videoMs: 3000 + VIDEO_SYNC_EPSILON_MS - 1,
          isPlaying: false,
          sceneMs: 5000,
        },
        trim,
      ),
    ).toBeNull()
  })

  it('播放中也支持 seek（v3.9.2：作者边播边点时间轴跳转）', () => {
    // 播放中 hoverMs=3000（作者点时间轴 3s 处），视频还在 0s → 应 seek 到 5s（offset+hover）
    expect(
      decideSeekFromHoverWithTrim(
        { hoverMs: 3000, videoMs: 0, isPlaying: true, sceneMs: 5000 },
        trim,
      ),
    ).toBeCloseTo(5)
  })

  it('播放中：hoverMs 贴着视频（EPSILON 内）→ null（避免 onTimeUpdate 回写循环）', () => {
    // 播放中 onTimeUpdate 把 hoverMs 回写成 videoMs-offset = 3000；再走 seek 应该不动
    expect(
      decideSeekFromHoverWithTrim(
        { hoverMs: 3000, videoMs: 5000, isPlaying: true, sceneMs: 5000 },
        trim,
      ),
    ).toBeNull()
  })

  it('trim=undefined 退化为无裁剪 + offset=0（向后兼容）', () => {
    expect(
      decideSeekFromHoverWithTrim(
        { hoverMs: 2500, videoMs: 0, isPlaying: false, sceneMs: 5000 },
        undefined,
      ),
    ).toBeCloseTo(2.5)
  })
})

describe('decideHoverFromVideoWithTrim', () => {
  const trim = { offsetMs: 2000, clipDurationMs: 5000 }

  it('播放中 videoMs=3000 → 游标 = 3000-2000 = 1000', () => {
    expect(
      decideHoverFromVideoWithTrim(
        { hoverMs: 0, videoMs: 3000, isPlaying: true, sceneMs: 5000 },
        trim,
      ),
    ).toBe(1000)
  })

  it('播放中 videoMs < offset（视频还没播到入点，极端 seek 回跳）→ 游标夹到 0', () => {
    expect(
      decideHoverFromVideoWithTrim(
        { hoverMs: 500, videoMs: 500, isPlaying: true, sceneMs: 5000 },
        trim,
      ),
    ).toBe(0)
  })

  it('播放中 videoMs 超过出点 → 游标夹到 sceneMs', () => {
    expect(
      decideHoverFromVideoWithTrim(
        { hoverMs: 1000, videoMs: 9999, isPlaying: true, sceneMs: 5000 },
        trim,
      ),
    ).toBe(5000)
  })

  it('暂停 → null', () => {
    expect(
      decideHoverFromVideoWithTrim(
        { hoverMs: 1000, videoMs: 3000, isPlaying: false, sceneMs: 5000 },
        trim,
      ),
    ).toBeNull()
  })
})

describe('isAtTrimEnd', () => {
  const trim = { offsetMs: 2000, clipDurationMs: 5000 } // video end at 7000

  it('videoMs 到裁剪出点附近（差在 EPSILON 内）→ true', () => {
    expect(
      isAtTrimEnd(
        {
          hoverMs: 0,
          videoMs: 7000 - VIDEO_SYNC_EPSILON_MS + 1,
          isPlaying: true,
          sceneMs: 5000,
        },
        trim,
      ),
    ).toBe(true)
  })

  it('还没到 → false', () => {
    expect(
      isAtTrimEnd(
        { hoverMs: 0, videoMs: 5000, isPlaying: true, sceneMs: 5000 },
        trim,
      ),
    ).toBe(false)
  })

  it('scene 比裁剪段短 → 以 scene 终点为准（不是 clip 终点）', () => {
    // sceneMs=3000，视频裁剪 5000；scene 终点 = offset+sceneMs = 5000 先到
    expect(
      isAtTrimEnd(
        {
          hoverMs: 0,
          videoMs: 5000 - VIDEO_SYNC_EPSILON_MS + 1,
          isPlaying: true,
          sceneMs: 3000,
        },
        trim,
      ),
    ).toBe(true)
  })

  it('trim=undefined + videoMs 到 sceneMs → true（退化为 isAtSceneEnd）', () => {
    expect(
      isAtTrimEnd(
        {
          hoverMs: 0,
          videoMs: 5000 - VIDEO_SYNC_EPSILON_MS + 1,
          isPlaying: true,
          sceneMs: 5000,
        },
        undefined,
      ),
    ).toBe(true)
  })
})
