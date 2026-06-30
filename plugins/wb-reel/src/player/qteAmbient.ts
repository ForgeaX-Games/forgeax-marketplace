import type { Scene } from '../scenario/types'

/**
 * QTEOverlay 根容器的 ambient modifier class。
 *
 * 背景：QTE cue 的视觉语言里有几层无限循环动画（tap 内点 scale pulse、
 * hold 字样呼吸、sweep 流光、is-peak 外环振铃），设计上是"邀请点击"的
 * 微妙动效。但当场景**没有预生成图**（IMAGE_PROMPT 且无 media.ref）时，
 * 玩家看到的就是黑底 + 青蓝点阵在原地蹦 —— 这在《渡魂灯》之类纯文本
 * 场景打开时会被感知为"屏幕一直闪蓝"。
 *
 * 治法：给 overlay 根容器挂一个 `is-bg-empty` modifier，CSS 选择器
 * 穿透到 cue 元素把循环动画关掉（保留一次性 fade-in，让 cue 出现
 * 的进入动画依然可见）。有画面时不加此 class，完全保留原设计。
 */
export function qteOverlayAmbientClass(scene: Scene): string {
  const m = scene.media
  if (m.kind === 'VIDEO') return ''
  if (m.kind === 'IMAGE_PROMPT') {
    return m.ref ? '' : 'is-bg-empty'
  }
  return ''
}
