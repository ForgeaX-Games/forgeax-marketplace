/**
 * 视频 overlay 舞台 —— 与 object-fit:contain 后的实际画面矩形对齐。
 * HUD / 表现叠层 / 交互层均相对这块定位，视频缩放或换比例时跟着视频走。
 */
import type { CSSProperties, ReactNode } from 'react'
import type { VideoContentRect } from './videoContentRect'

export function videoOverlayStageStyle(contentRect: VideoContentRect | null): CSSProperties {
  return contentRect
    ? {
        position: 'absolute',
        left: contentRect.left,
        top: contentRect.top,
        width: contentRect.width,
        height: contentRect.height,
        pointerEvents: 'none',
      }
    : { position: 'absolute', inset: 0, pointerEvents: 'none' }
}

export function VideoOverlayStage({
  contentRect,
  className,
  children,
}: {
  contentRect: VideoContentRect | null
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className={className} style={videoOverlayStageStyle(contentRect)}>
      {children}
    </div>
  )
}
