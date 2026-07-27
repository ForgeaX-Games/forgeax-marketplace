import { useEffect, useRef, useState } from 'react'
import { VideoReplaceUpload, type VideoLibraryEntry } from '../assets/VideoAssetLibrary'
import type { VideoAssetsController } from '../assets/useVideoAssets'
import { MissingVideoNotice } from '../../runtime/play/MissingVideoNotice'

interface GraphVideoPreviewPanelProps {
  timelineEntry: VideoLibraryEntry
  previewEntry?: VideoLibraryEntry
  previewSrc?: string
  maxMs: number
  playheadMs: number
  uploading: VideoAssetsController['uploading']
  onReplace: VideoAssetsController['replaceResource']
  onPlayheadChange(ms: number): void
  onDurationChange(ms: number): void
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
    playheadMs,
    uploading,
    onReplace,
    onPlayheadChange,
    onDurationChange,
}: GraphVideoPreviewPanelProps): JSX.Element {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const [isVideoPlaying, setIsVideoPlaying] = useState(false)
    const [isMuted, setIsMuted] = useState(true)
    const [missingPreviewId, setMissingPreviewId] = useState<string | null>(null)

    useEffect(() => {
      setMissingPreviewId(null)
    }, [timelineEntry.id, previewSrc])

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
}
