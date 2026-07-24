/**
 * GameStage —— 「当前演出帧」的共享渲染 SSOT（runtime/play）。
 *
 * 把原先散在 GraphPlayer / GraphPlaySurface / GraphStudio 里**重复**的
 * 「<video> 演出 + 缺片提示 + VideoOverlayStage 叠层」这一块收成一个组件。
 * 只依赖 runtime（引擎快照类型 + 皮肤注册表 + 视频矩形工具），**不碰 editor / 宿主**：
 *   - 视频地址由调用方算好传入(`videoSrc`)——宿主专属的 mediaId→url 解析留在调用方(注入)。
 *   - 会话推进/事件回灌经回调(onTick / onPerformanceEnd / onEmit)交给调用方的 GraphSession。
 *
 * 自持:videoElRef、内容矩形(useVideoContentRect)、缺片状态(随 clip 变更自动复位)。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ClipSnap, OverlayMountSnap } from '../engine/session'
import type { SkinCtx, SkinRegistry } from '../component-host/rendererRegistry'
import { MissingVideoNotice } from './MissingVideoNotice'
import { VideoOverlayStage } from './VideoOverlayStage'
import { useVideoContentRect } from './useVideoContentRect'
import { videoDurationCapReached } from './videoTiming'

export interface GameStageProps {
  /** 当前演出视频的可播 url;调用方用(注入的)解析器把 clip.mediaId 转成 url。 */
  videoSrc: string | undefined
  clip: ClipSnap | undefined
  overlayMounts: OverlayMountSnap[]
  /** 皮肤注册表(session.skins);缺省不渲染叠层。 */
  skins: SkinRegistry | undefined
  skinCtx: SkinCtx | undefined
  onEmit: (elementId: string, key: string) => void
  onTick: (nowMs: number) => void
  /** 演出提前收尾(时长上限到点 / 非 loop 视频自然结束)。 */
  onPerformanceEnd: () => void
  /** 无视频时的占位内容(如「（无演出）」/「加载中…」)。 */
  placeholder?: ReactNode
  /** <video> 的 key 覆盖(默认 clip.nodeId);需要「同节点再 jump 强制 remount」时传入带 epoch 的 key。 */
  videoKey?: string
}

export function GameStage({
  videoSrc, clip, overlayMounts, skins, skinCtx, onEmit, onTick, onPerformanceEnd, placeholder, videoKey,
}: GameStageProps): JSX.Element {
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const { contentRect, recomputeRect } = useVideoContentRect(videoElRef, [clip?.nodeId])
  const [missingVideoId, setMissingVideoId] = useState<string | null>(null)

  useEffect(() => {
    setMissingVideoId(null)
  }, [clip?.nodeId, clip?.mediaId, videoSrc])

  return (
    <>
      {videoSrc ? (
        <>
          <video
            key={videoKey ?? clip?.nodeId}
            ref={videoElRef}
            src={videoSrc}
            autoPlay
            muted
            playsInline
            loop={!!clip?.loop}
            onLoadedMetadata={() => {
              setMissingVideoId(null)
              recomputeRect()
            }}
            onError={() => {
              if (clip?.mediaId) setMissingVideoId(clip.mediaId)
            }}
            onEnded={() => {
              if (clip?.loop) return
              onPerformanceEnd()
            }}
            onTimeUpdate={(e) => {
              const el = e.currentTarget
              const nowMs = Math.floor(el.currentTime * 1000)
              if (videoDurationCapReached(nowMs, clip?.durationMs, el.duration)) {
                el.pause()
                onPerformanceEnd()
                return
              }
              onTick(nowMs)
            }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
          />
          {missingVideoId ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.72)', padding: 16, zIndex: 2 }}>
              <MissingVideoNotice resourceId={missingVideoId} />
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7, color: 'rgba(255,255,255,0.6)' }}>
          {placeholder ?? clip?.name ?? '（无演出）'}
        </div>
      )}

      <VideoOverlayStage contentRect={contentRect}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {overlayMounts.map((m) => (
            <span key={m.mountId} style={{ display: 'contents' }}>
              {skins?.renderOverlayMount(m, onEmit, skinCtx)}
            </span>
          ))}
        </div>
      </VideoOverlayStage>
    </>
  )
}
