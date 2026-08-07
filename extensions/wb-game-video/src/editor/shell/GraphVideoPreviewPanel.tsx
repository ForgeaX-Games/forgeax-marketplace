import { useEffect, useRef, useState } from 'react'
import { VideoReplaceUpload, type VideoLibraryEntry } from '../assets/VideoAssetLibrary'
import type { VideoAssetsController } from '../assets/useVideoAssets'
import { MissingVideoNotice } from '../../runtime/play/MissingVideoNotice'
import { VideoFullscreenDialog } from './VideoFullscreenDialog'

interface GraphVideoPreviewPanelProps {
  timelineEntry: VideoLibraryEntry
  previewEntry?: VideoLibraryEntry
  previewSrc?: string
  maxMs: number
  uploading: VideoAssetsController['uploading']
  onReplace: VideoAssetsController['replaceResource']
  onDurationChange(ms: number): void
  fullscreenRequest?: number
  fullscreenOnly?: boolean
}

export interface GraphVideoPlaybackProps {
  timelineEntry: VideoLibraryEntry
  previewEntry?: VideoLibraryEntry
  previewSrc?: string
  maxMs: number
  uploading: VideoAssetsController['uploading']
  onReplace: VideoAssetsController['replaceResource']
  onDurationChange(ms: number): void
  onOpenFullscreen?: () => void
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function GraphVideoPreviewPanel({
  timelineEntry,
  previewEntry,
  previewSrc,
  maxMs,
  uploading,
  onReplace,
  onDurationChange,
  fullscreenRequest,
  fullscreenOnly = false,
}: GraphVideoPreviewPanelProps): JSX.Element {
  const [fullscreenOpen, setFullscreenOpen] = useState(false)

  useEffect(() => {
    setFullscreenOpen(false)
  }, [timelineEntry.id, previewSrc])

  useEffect(() => {
    if (fullscreenRequest !== undefined) setFullscreenOpen(true)
  }, [fullscreenRequest])

  const playbackProps: GraphVideoPlaybackProps = {
    timelineEntry,
    previewEntry,
    previewSrc,
    maxMs,
    uploading,
    onReplace,
    onDurationChange,
  }

  return (
    <>
      {fullscreenOnly ? null : (
        <GraphVideoPlayback
          {...playbackProps}
          onOpenFullscreen={() => setFullscreenOpen(true)}
        />
      )}
      <VideoFullscreenDialog
        open={fullscreenOpen}
        src={previewSrc}
        label={timelineEntry.label}
        durationMs={maxMs}
        onClose={() => setFullscreenOpen(false)}
      >
        <GraphVideoPlayback {...playbackProps} />
      </VideoFullscreenDialog>
    </>
  )
}

export function GraphVideoPlayback({
  timelineEntry,
  previewEntry,
  previewSrc,
  maxMs,
  uploading,
  onReplace,
  onDurationChange,
  onOpenFullscreen,
}: GraphVideoPlaybackProps): JSX.Element {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const isScrubbingRef = useRef(false)
    const playheadMsRef = useRef(0)
    const timelineRef = useRef<HTMLInputElement | null>(null)
    const timeRef = useRef<HTMLSpanElement | null>(null)
    const [isVideoPlaying, setIsVideoPlaying] = useState(false)
    const [isMuted, setIsMuted] = useState(true)
    const [isLooping, setIsLooping] = useState(false)
    const [missingPreviewId, setMissingPreviewId] = useState<string | null>(null)

    useEffect(() => {
      setMissingPreviewId(null)
      setIsLooping(false)
      reportPlayhead(0)
    }, [timelineEntry.id, previewSrc])

    function reportPlayhead(ms: number): void {
      const next = Math.max(0, Math.min(maxMs, Math.round(ms)))
      playheadMsRef.current = next
      if (timelineRef.current) {
        timelineRef.current.value = String(next)
        timelineRef.current.style.setProperty('--gvv-progress', `${(next / maxMs) * 100}%`)
      }
      if (timeRef.current) timeRef.current.textContent = `${fmtTime(next)} / ${fmtTime(maxMs)}`
    }

    useEffect(() => {
      if (!isVideoPlaying) return
      let animationFrame = 0
      const syncPlayhead = (): void => {
        const video = videoRef.current
        if (!video || video.paused) return
        reportPlayhead(video.currentTime * 1000)
        animationFrame = requestAnimationFrame(syncPlayhead)
      }
      animationFrame = requestAnimationFrame(syncPlayhead)
      return () => cancelAnimationFrame(animationFrame)
    }, [isVideoPlaying, maxMs])

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

    function seekTo(ms: number): void {
      const target = Math.max(0, Math.min(maxMs, Math.round(ms)))
      const video = videoRef.current
      isScrubbingRef.current = true
      if (video) {
        try { video.currentTime = target / 1000 } catch { /* metadata 未就绪 */ }
      }
      reportPlayhead(target)
    }

    function beginScrub(): void {
      isScrubbingRef.current = true
      const video = videoRef.current
      if (video && !video.paused) video.pause()
    }

    function endScrub(): void {
      const video = videoRef.current
      if (!video?.seeking) {
        isScrubbingRef.current = false
        if (video) reportPlayhead(video.currentTime * 1000)
      }
    }

    function toggleLoop(): void {
      const next = !isLooping
      const video = videoRef.current
      if (video) video.loop = next
      setIsLooping(next)
    }

    return (
      <div className="gvv-video-col">
        <div className="gc-frame" data-type={timelineEntry.type ?? 'video'}>
          <span className="gc-badge">
            {timelineEntry.label}
            {timelineEntry.type ? <em>{timelineEntry.type}</em> : null}
          </span>
          <video
            key={`${timelineEntry.id}:${timelineEntry.updatedAt ?? ''}`}
            ref={videoRef}
            className="gc-video"
            src={previewSrc}
            autoPlay
            muted
            playsInline
            loop={isLooping}
            onClick={onOpenFullscreen}
            onLoadedMetadata={(event) => {
              setMissingPreviewId(null)
              const duration = event.currentTarget.duration
              if (Number.isFinite(duration) && duration > 0) onDurationChange(Math.round(duration * 1000))
            }}
            onError={() => setMissingPreviewId(timelineEntry.id)}
            onPlay={() => setIsVideoPlaying(true)}
            onPause={() => setIsVideoPlaying(false)}
            onVolumeChange={(event) => setIsMuted(event.currentTarget.muted)}
            onTimeUpdate={(event) => {
              if (!isScrubbingRef.current) {
                reportPlayhead(event.currentTarget.currentTime * 1000)
              }
            }}
            onSeeked={(event) => {
              isScrubbingRef.current = false
              reportPlayhead(event.currentTarget.currentTime * 1000)
            }}
            onEnded={() => { setIsVideoPlaying(false); reportPlayhead(maxMs) }}
          />
          <VideoReplaceUpload entry={previewEntry} uploading={uploading} onReplace={onReplace} />
          {missingPreviewId ? (
            <div className="val-missing-overlay">
              <MissingVideoNotice resourceId={missingPreviewId} />
            </div>
          ) : null}
        </div>
        <div className="gvv-controls">
          <button type="button" onClick={togglePlay} title={isVideoPlaying ? '暂停' : '播放'} aria-label={isVideoPlaying ? '暂停' : '播放'}>
            {isVideoPlaying ? '⏸' : '▶'}
          </button>
          <span ref={timeRef} className="gvv-time">{fmtTime(playheadMsRef.current)} / {fmtTime(maxMs)}</span>
          <input
            ref={timelineRef}
            className="gvv-timeline"
            type="range"
            min="0"
            max={maxMs}
            step="10"
            defaultValue={Math.min(maxMs, playheadMsRef.current)}
            aria-label="视频播放进度"
            onChange={(event) => seekTo(Number(event.currentTarget.value))}
            onPointerDown={beginScrub}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
          />
          <button
            type="button"
            className={`gvv-loop${isLooping ? ' is-on' : ''}`}
            onClick={toggleLoop}
            title={isLooping ? '关闭循环播放' : '开启循环播放'}
            aria-label={isLooping ? '关闭循环播放' : '开启循环播放'}
            aria-pressed={isLooping}
          >
            ↻
          </button>
          <button
            type="button"
            className={`gvv-mute${isMuted ? '' : ' is-on'}`}
            onClick={toggleMute}
            title={isMuted ? '取消静音' : '静音'}
            aria-label={isMuted ? '取消静音' : '静音'}
            aria-pressed={!isMuted}
          >
            {isMuted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>
    )
}
