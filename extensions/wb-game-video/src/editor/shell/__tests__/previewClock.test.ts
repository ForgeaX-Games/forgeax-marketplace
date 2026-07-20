/**
 * 回归：泛用时间轴预览时钟的纯函数契约。
 *   - previewClockLayerClassName：暂停态才带 is-paused（配合 PREVIEW_CLOCK_CSS 统一冻结子树 CSS 动画）。
 *   - localMsForChild：无 window 的 child（QTE cues 走这条）本地时刻 = 原始播放头，行为不变；
 *     挂了 window.startMs 的 child（choice/option 等）本地时刻 = 「进场后过了多久」，且不为负。
 */
import { describe, expect, it } from 'vitest'
import { localMsForChild, previewClockLayerClassName } from '../previewClock'

describe('previewClock · previewClockLayerClassName', () => {
  it('播放中不带 is-paused', () => {
    expect(previewClockLayerClassName(true)).toBe('gc-preview-clock')
  })
  it('暂停/scrub 中带 is-paused', () => {
    expect(previewClockLayerClassName(false)).toBe('gc-preview-clock is-paused')
  })
})

describe('previewClock · localMsForChild', () => {
  it('无 window（QTE cues 走 appearAt 自己的绝对帧）→ 原样返回播放头', () => {
    expect(localMsForChild({}, 1234)).toBe(1234)
  })
  it('有 window.startMs → 相对进场时刻', () => {
    expect(localMsForChild({ window: { startMs: 200 } }, 500)).toBe(300)
  })
  it('播放头落在 window 之前 → 夹到 0（不出现负数负 delay）', () => {
    expect(localMsForChild({ window: { startMs: 200 } }, 100)).toBe(0)
  })
})
