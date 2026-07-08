import { injectStyleOnce } from '../styles/injectStyle'

/**
 * CrossfadeLayer —— 换场叠化(v9 M2b · 双缓冲)。
 *
 * 「双缓冲」的轻量实现:换场瞬间把上一幕画面截一张冻帧作为**后缓冲**叠在最上层,
 * 新场景在其**下方**正常挂载播放(前缓冲),后缓冲 opacity 由 1 渐隐到 0 —— 视觉上
 * 就是旧画面叠化进新画面,避免硬切黑闪。不引入第二个常驻 <video>,对 SceneCanvas
 * 零侵入(只多一张会自我销毁的冻帧 <img>)。
 *
 * 冻帧由 Player 在 navigateTo 时从 <video> 当前帧抓取(captureFreeze);非视频场景
 * 抓不到则不叠化(直接硬切,旧行为)。动画结束自销毁(onDone 清状态)。
 */
export function CrossfadeLayer({
  freeze,
  durationMs = 360,
  onDone,
}: {
  freeze: { url: string; key: number } | null
  durationMs?: number
  onDone: () => void
}) {
  injectStyleOnce('player-crossfade', XFADE_CSS)
  if (!freeze) return null
  return (
    <img
      key={freeze.key}
      className="ks-xfade"
      src={freeze.url}
      draggable={false}
      style={{ animationDuration: `${durationMs}ms` }}
      onAnimationEnd={onDone}
      alt=""
      aria-hidden
    />
  )
}

const XFADE_CSS = `
.ks-xfade {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  z-index: 10;
  pointer-events: none;
  animation-name: ks-xfade-out;
  animation-timing-function: ease-out;
  animation-fill-mode: forwards;
}
@keyframes ks-xfade-out {
  from { opacity: 1; }
  to { opacity: 0; }
}
`
