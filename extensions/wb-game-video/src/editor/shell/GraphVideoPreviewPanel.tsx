import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { VideoReplaceUpload, type VideoLibraryEntry } from '../assets/VideoAssetLibrary'
import type { VideoAssetsController } from '../assets/useVideoAssets'
import { MissingVideoNotice } from '../../runtime/play/MissingVideoNotice'
import { computeVideoContentRect, pointerToVideoNorm, type VideoContentRect } from '../../runtime/play/videoContentRect'
import { resolveVideoFxForNode } from '../../runtime/fx/video-fx'
import { resolveGraphTextCss } from '../text/text-css'
import { renderOverlayChildPreview } from './overlayChildPreview'
import { PreviewClockProvider, previewClockLayerClassName } from './previewClock'
import type { SkinCtx } from '../../runtime/component-host/rendererRegistry'
import { initState } from '../../runtime/engine/engine-init'
import { createCoreSkinRegistry } from '../../runtime/component-host/components'
import type { GameNode, GameScenario } from '../../runtime/schema/graph-schema'
import {
  type PreviewOverlay,
  activePreviewOverlaysFromNode,
  previewSkinChildrenInWindow,
} from '../video/graphMaterialOps'
import { materialClass, materialLabel } from '../video/materialTimelineShared'

export interface GraphVideoPreviewPanelHandle {
  pause(): void
  seekTo(ms: number): void
}

interface GraphVideoPreviewPanelProps {
  timelineEntry: VideoLibraryEntry
  previewEntry?: VideoLibraryEntry
  previewSrc?: string
  scenario: GameScenario
  node?: GameNode
  graphOverlays?: NonNullable<GameScenario['ui']>['overlays']
  editingBoundClip: boolean
  maxMs: number
  playheadMs: number
  selectedMaterialKey: string | null
  uploading: VideoAssetsController['uploading']
  onReplace: VideoAssetsController['replaceResource']
  onPlayheadChange(ms: number): void
  onDurationChange(ms: number): void
  onSelectMaterial(key: string): void
  onMoveOverlay(overlay: PreviewOverlay, x: number, y: number): void
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const GraphVideoPreviewPanel = forwardRef<GraphVideoPreviewPanelHandle, GraphVideoPreviewPanelProps>(
  function GraphVideoPreviewPanel({
    timelineEntry,
    previewEntry,
    previewSrc,
    scenario,
    node,
    graphOverlays,
    editingBoundClip,
    maxMs,
    playheadMs,
    selectedMaterialKey,
    uploading,
    onReplace,
    onPlayheadChange,
    onDurationChange,
    onSelectMaterial,
    onMoveOverlay,
  }, ref): JSX.Element {
    const frameRef = useRef<HTMLDivElement | null>(null)
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const [contentRect, setContentRect] = useState<VideoContentRect | null>(null)
    const [isVideoPlaying, setIsVideoPlaying] = useState(false)
    const [isMuted, setIsMuted] = useState(true)
    const [overlayDragId, setOverlayDragId] = useState<string | null>(null)
    const [missingPreviewId, setMissingPreviewId] = useState<string | null>(null)

    const previewSkinChildren = useMemo(
      () => (node && editingBoundClip ? previewSkinChildrenInWindow(scenario, node, playheadMs, maxMs) : []),
      [scenario, node, editingBoundClip, playheadMs, maxMs],
    )
    const previewSkinReg = useMemo(() => createCoreSkinRegistry(), [])
    const previewSkinCtx = useMemo((): SkinCtx => {
      const st = initState(scenario)
      const toHudEnt = (attrs: Record<string, number>, attrMeta?: Record<string, { max?: number }>) => {
        const attrMax: Record<string, number> = {}
        for (const [key, value] of Object.entries(attrs)) attrMax[key] = attrMeta?.[key]?.max ?? value
        return {
          hp: attrs.hp ?? 0,
          maxHp: attrMeta?.hp?.max ?? attrs.hp ?? 0,
          attrs: { ...attrs },
          attrMax,
        }
      }
      const entities: SkinCtx['hud']['entities'] = Object.fromEntries(
        Object.entries(st.entities).map(([id, entity]) => [id, toHudEnt(entity.attrs, entity.attrMeta)]),
      )
      if (!entities['ent-player']) entities['ent-player'] = toHudEnt({ hp: 72 }, { hp: { max: 100 } })
      if (!entities['ent-boss']) entities['ent-boss'] = toHudEnt({ hp: 58 }, { hp: { max: 100 } })
      return {
        hud: {
          entities,
          vars: { qi: 3, ...st.vars },
          score: st.score,
          flags: st.flags,
        },
        condition: { state: st, visited: new Set<string>() },
      }
    }, [scenario])
    const skinnedPreviewIds = useMemo(() => new Set(previewSkinChildren.map((child) => child.id)), [previewSkinChildren])
    const previewClockValue = useMemo(
      () => ({ playing: isVideoPlaying, playheadMs }),
      [isVideoPlaying, playheadMs],
    )
    const previewOverlays = useMemo(
      () => node && editingBoundClip
        ? activePreviewOverlaysFromNode(scenario, node, playheadMs, maxMs)
        : [],
      [scenario, node, editingBoundClip, playheadMs, maxMs],
    )
    const videoFx = useMemo(
      () => node && editingBoundClip
        ? resolveVideoFxForNode(node, graphOverlays, playheadMs, maxMs)
        : { overlays: [] },
      [node, editingBoundClip, graphOverlays, playheadMs, maxMs],
    )
    const previewContentStyle: CSSProperties | undefined = contentRect
      ? {
          left: `${contentRect.left}px`,
          top: `${contentRect.top}px`,
          width: `${contentRect.width}px`,
          height: `${contentRect.height}px`,
        }
      : undefined

    useEffect(() => {
      setMissingPreviewId(null)
    }, [timelineEntry.id, previewSrc, node?.id])

    useEffect(() => {
      setContentRect(null)
    }, [timelineEntry.id, node?.id, editingBoundClip])

    useEffect(() => {
      const video = videoRef.current
      if (!video) {
        setContentRect(null)
        return
      }
      let frame = 0
      const update = (): void => {
        if (frame) cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          const rect = computeVideoContentRect(video)
          if (rect) setContentRect(rect)
        })
      }
      update()
      video.addEventListener('loadedmetadata', update)
      window.addEventListener('resize', update)
      const resizeObserver = new ResizeObserver(update)
      if (video.parentElement) resizeObserver.observe(video.parentElement)
      return () => {
        if (frame) cancelAnimationFrame(frame)
        video.removeEventListener('loadedmetadata', update)
        window.removeEventListener('resize', update)
        resizeObserver.disconnect()
      }
    }, [timelineEntry.id, editingBoundClip])

    useEffect(() => {
      if (!isVideoPlaying) return
      let animationFrame = 0
      const tick = (): void => {
        const video = videoRef.current
        if (video) {
          onPlayheadChange(Math.max(0, Math.min(maxMs, Math.round((video.currentTime || 0) * 1000))))
        }
        animationFrame = requestAnimationFrame(tick)
      }
      animationFrame = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(animationFrame)
    }, [isVideoPlaying, maxMs, onPlayheadChange])

    useImperativeHandle(ref, () => ({
      pause(): void {
        const video = videoRef.current
        if (video && !video.paused) {
          try { video.pause() } catch { /* ignore */ }
        }
      },
      seekTo(ms: number): void {
        const target = Math.max(0, Math.min(maxMs, Math.round(ms)))
        const video = videoRef.current
        if (video) {
          try { video.currentTime = target / 1000 } catch { /* metadata 未就绪 */ }
        }
        onPlayheadChange(target)
      },
    }), [maxMs, onPlayheadChange])

    function positionFromFrame(event: ReactPointerEvent): { x: number; y: number } | null {
      const frame = frameRef.current
      if (!frame) return null
      return pointerToVideoNorm(event.clientX, event.clientY, frame, videoRef.current)
    }

    function onOverlayPointerDown(event: ReactPointerEvent<HTMLDivElement>, overlay: PreviewOverlay): void {
      event.preventDefault()
      event.stopPropagation()
      onSelectMaterial(overlay.materialKey)
      if (!overlay.movable) return
      event.currentTarget.setPointerCapture(event.pointerId)
      setOverlayDragId(overlay.id)
      const position = positionFromFrame(event)
      if (position) onMoveOverlay(overlay, position.x, position.y)
    }

    function onOverlayPointerMove(event: ReactPointerEvent<HTMLDivElement>, overlay: PreviewOverlay): void {
      if (overlayDragId !== overlay.id) return
      const position = positionFromFrame(event)
      if (position) onMoveOverlay(overlay, position.x, position.y)
    }

    function togglePlay(): void {
      const video = videoRef.current
      if (!video) return
      if (video.paused) void video.play().catch(() => { /* autoplay 限制 */ })
      else video.pause()
    }

    function toggleMute(): void {
      const video = videoRef.current
      if (!video) return
      video.muted = !video.muted
      setIsMuted(video.muted)
    }

    return (
      <div className="gvv-video-col">
        <div ref={frameRef} className="gc-frame" data-type={timelineEntry.type ?? 'video'}>
          <span className="gc-badge">
            {timelineEntry.label}
            {timelineEntry.type ? <em>{timelineEntry.type}</em> : null}
          </span>
          <video
            key={`${timelineEntry.id}:${timelineEntry.updatedAt ?? ''}`}
            ref={videoRef}
            className="gc-video"
            src={previewSrc}
            style={{ filter: videoFx.filter, transform: videoFx.transform }}
            autoPlay
            muted
            playsInline
            loop={timelineEntry.type === 'loop'}
            onLoadedMetadata={(event) => {
              setMissingPreviewId(null)
              const duration = event.currentTarget.duration
              if (Number.isFinite(duration) && duration > 0) onDurationChange(Math.round(duration * 1000))
            }}
            onError={() => setMissingPreviewId(timelineEntry.id)}
            onPlay={() => setIsVideoPlaying(true)}
            onPause={() => setIsVideoPlaying(false)}
            onVolumeChange={(event) => setIsMuted(event.currentTarget.muted)}
            onTimeUpdate={(event) => onPlayheadChange(Math.max(0, Math.min(maxMs, Math.round(event.currentTarget.currentTime * 1000))))}
            onSeeked={(event) => onPlayheadChange(Math.max(0, Math.min(maxMs, Math.round(event.currentTarget.currentTime * 1000))))}
            onEnded={() => { setIsVideoPlaying(false); onPlayheadChange(maxMs) }}
          />
          <VideoReplaceUpload entry={previewEntry} uploading={uploading} onReplace={onReplace} />
          {missingPreviewId ? (
            <div className="val-missing-overlay">
              <MissingVideoNotice resourceId={missingPreviewId} />
            </div>
          ) : null}
          {videoFx.overlays.length > 0 ? (
            <div className="gvv-fx-layer" aria-hidden>
              {videoFx.overlays.map((overlay) => (
                <div key={overlay.id} style={overlay.style as CSSProperties} />
              ))}
            </div>
          ) : null}
          <div className="gc-content-anchor" style={previewContentStyle}>
            <div className="gc-preview-overlays">
              {previewSkinChildren.length > 0 ? (
                <PreviewClockProvider value={previewClockValue}>
                  <div className={`gc-preview-skin-layer ${previewClockLayerClassName(isVideoPlaying)}`} aria-hidden>
                    {previewSkinChildren.map((child) => (
                      <Fragment key={child.id}>
                        {renderOverlayChildPreview(child, previewSkinReg, previewSkinCtx, playheadMs)}
                      </Fragment>
                    ))}
                  </div>
                </PreviewClockProvider>
              ) : null}
              {previewOverlays.map((overlay) => {
                const selected = selectedMaterialKey === overlay.materialKey
                const elementId = overlay.target.kind === 'element'
                  ? overlay.target.elementId
                  : overlay.target.kind === 'qteCue'
                    ? overlay.target.elementId
                    : ''
                const skinned = !!elementId && skinnedPreviewIds.has(elementId)
                return (
                  <div
                    key={overlay.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${materialLabel(overlay.kind)}：${overlay.label}${overlay.movable ? '，可拖动' : ''}`}
                    className={`gc-preview-overlay ${materialClass(overlay.kind)}${selected ? ' is-selected' : ''}${overlay.movable ? ' is-movable' : ''}${skinned ? ' is-skinned' : ''}`}
                    style={{ left: `${overlay.x * 100}%`, top: `${overlay.y * 100}%`, zIndex: skinned ? 30 : 20 + overlay.zIndex }}
                    onPointerDown={(event) => onOverlayPointerDown(event, overlay)}
                    onPointerMove={(event) => onOverlayPointerMove(event, overlay)}
                    onPointerUp={() => setOverlayDragId(null)}
                    onLostPointerCapture={() => setOverlayDragId(null)}
                  >
                    {overlay.kind === 'qte' || (skinned && overlay.movable) ? <span className="gc-preview-ring" /> : null}
                    <span
                      className="gc-preview-label"
                      style={(overlay.kind === 'subtitle' || overlay.kind === 'overlay') && overlay.style
                        ? resolveGraphTextCss(overlay.style)
                        : undefined}
                    >
                      {overlay.label}
                    </span>
                    {overlay.detail ? <span className="gc-preview-detail">{overlay.detail}</span> : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
        <div className="gvv-controls">
          <button type="button" onClick={togglePlay} title={isVideoPlaying ? '暂停' : '播放'} aria-label={isVideoPlaying ? '暂停' : '播放'}>
            {isVideoPlaying ? '⏸' : '▶'}
          </button>
          <span className="gvv-time">{fmtTime(playheadMs)} / {fmtTime(maxMs)}</span>
          <button type="button" className="gvv-mute" onClick={toggleMute} title={isMuted ? '取消静音' : '静音'} aria-label={isMuted ? '取消静音' : '静音'}>
            {isMuted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>
    )
  },
)
