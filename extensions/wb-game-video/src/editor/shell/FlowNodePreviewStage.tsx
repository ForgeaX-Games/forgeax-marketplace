import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { GraphSession, SessionSnapshot } from '../../runtime/engine/session'
import { PlayerRootContext } from '../../runtime/component-host/rendererRegistry'
import { claimPlayerFocus, releasePlayerFocus } from '../../runtime/input/playerFocus'
import {
  BgmPlayer,
  GameStage,
  PlaybackClockProvider,
  VideoAudioToggle,
  type GameStageProps,
} from '../../runtime/play'
import { MaterialTimeline } from '../video/MaterialTimeline'
import type { ProjectedFlowTimeline } from '../video/flowPreviewTimeline'
import { injectStyleOnce } from '../../styles/injectStyle'

const FLOW_PREVIEW_CSS = `
.nps-flow-status { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--gc-muted); font-size: 11px; }
.nps-flow-status strong { color: var(--gc-text); font-weight: 600; }
.nps-flow-controls { gap: 7px; }
.nps-flow-controls select {
  height: 26px; border: 1px solid var(--gc-line); border-radius: 6px;
  background: var(--gc-panel); color: var(--gc-text); font-size: 10px; padding: 1px 4px;
}
.nps-flow-controls .nps-restart { width: auto; padding: 0 8px; color: #f5bd75; }
`

export interface FlowNodePreviewState {
  snapshot: SessionSnapshot
  session: GraphSession
  videoSrc: string | undefined
  videoKey: string
  preloadVideos: NonNullable<GameStageProps['preloadVideos']>
  timeline: ProjectedFlowTimeline
  paused: boolean
  playbackRate: number
  videoAudioEnabled: boolean
  /** 全流程时间轴持续拖动的灵敏度；1 为等比例，默认 0.8。按下定位不受影响。 */
  seekDragSensitivity?: number
  bgmRunKey: number
  resolveBgm: (id: string | undefined) => string | undefined
  onPausedChange: (paused: boolean) => void
  onPlaybackRateChange: (rate: number) => void
  onVideoAudioToggle: () => void
  onRestart: () => void
  onEmit: (elementId: string, key: string) => void
  onTick: (nowMs: number) => void
  onPerformanceEnd: () => void
  onDurationChange: (durationMs: number) => void
  /** 恢复目标片段入口 checkpoint 并推进到局部时刻；无 checkpoint 时返回 false。 */
  onSeek: (segmentIndex: number, localMs: number) => boolean
}

interface PendingFlowSeek {
  segmentIndex: number
  localMs: number
  globalMs: number
}

interface FlowNodePreviewStageProps {
  flow: FlowNodePreviewState
  timelineId: string
  timelineExpanded: boolean
  timelineToggle: ReactNode
}

export function FlowNodePreviewStage({
  flow,
  timelineId,
  timelineExpanded,
  timelineToggle,
}: FlowNodePreviewStageProps): JSX.Element {
  injectStyleOnce('flow-node-preview-stage', FLOW_PREVIEW_CSS)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [rootElement, setRootElement] = useState<HTMLElement | null>(null)
  const activeVideoRef = useRef<HTMLVideoElement | null>(null)
  const timelineHostRef = useRef<HTMLDivElement | null>(null)
  const timelineModelRef = useRef(flow.timeline)
  const syntheticLocalMsRef = useRef(0)
  const pendingSeekRef = useRef<PendingFlowSeek | null>(null)
  const scrubbingRef = useRef(false)
  timelineModelRef.current = flow.timeline
  const bindRoot = useCallback((element: HTMLDivElement | null) => {
    const previous = rootRef.current
    rootRef.current = element
    setRootElement(element)
    if (!element && previous) releasePlayerFocus(previous)
  }, [])
  const snap = flow.snapshot
  const writeGlobalPlayhead = useCallback((globalMs: number) => {
    const timeline = timelineModelRef.current
    const playhead = timelineHostRef.current?.querySelector<HTMLElement>('.gc-playhead')
    if (!playhead || !(timeline.maxMs > 0)) return
    const ratio = globalMs / timeline.maxMs
    playhead.style.left = `${ratio * 100}%`
    const viewport = timelineHostRef.current?.querySelector<HTMLElement>('.gc-mtimeline-viewport')
    const canvas = timelineHostRef.current?.querySelector<HTMLElement>('.gc-mtimeline-canvas')
    if (viewport && canvas && !scrubbingRef.current) {
      const playheadX = ratio * canvas.clientWidth
      viewport.scrollLeft = Math.max(0, playheadX - viewport.clientWidth * 0.7)
    }
  }, [])
  const writeSmoothPlayhead = useCallback((localMs: number) => {
    const timeline = timelineModelRef.current
    const active = timeline.segments[timeline.activeIndex]
    if (!active) return
    const globalMs = active.startMs + Math.max(0, Math.min(active.endMs - active.startMs, localMs))
    writeGlobalPlayhead(globalMs)
  }, [writeGlobalPlayhead])
  const handleActiveVideoChange = useCallback((video: HTMLVideoElement | null) => {
    activeVideoRef.current = video
    if (!video) return
    const pending = pendingSeekRef.current
    if (pending && timelineModelRef.current.activeIndex === pending.segmentIndex) {
      try { video.currentTime = pending.localMs / 1000 } catch { /* metadata 未就绪 */ }
      syntheticLocalMsRef.current = pending.localMs
      writeGlobalPlayhead(pending.globalMs)
      pendingSeekRef.current = null
      return
    }
    writeSmoothPlayhead(video.currentTime * 1000)
  }, [writeGlobalPlayhead, writeSmoothPlayhead])

  const handleScrubStart = useCallback(() => {
    scrubbingRef.current = true
    const video = activeVideoRef.current
    if (video && !video.paused) {
      try { video.pause() } catch { /* ignore */ }
    }
    flow.onPausedChange(true)
  }, [flow.onPausedChange])

  const handleScrubEnd = useCallback(() => {
    scrubbingRef.current = false
  }, [])

  const handleTimelineSeek = useCallback((globalMs: number) => {
    const timeline = timelineModelRef.current
    const segmentIndex = timeline.segments.findIndex((segment, index) => (
      globalMs < segment.endMs || index === timeline.segments.length - 1
    ))
    const segment = timeline.segments[segmentIndex]
    if (!segment) return
    const localMs = Math.max(0, Math.min(segment.endMs - segment.startMs, globalMs - segment.startMs))
    if (!flow.onSeek(segmentIndex, localMs)) return
    const pending = { segmentIndex, localMs, globalMs: segment.startMs + localMs }
    pendingSeekRef.current = pending
    syntheticLocalMsRef.current = localMs
    writeGlobalPlayhead(pending.globalMs)
    if (segmentIndex === timeline.activeIndex && activeVideoRef.current) {
      try { activeVideoRef.current.currentTime = localMs / 1000 } catch { /* metadata 未就绪 */ }
      pendingSeekRef.current = null
    }
  }, [flow.onSeek, writeGlobalPlayhead])

  useEffect(() => {
    const pending = pendingSeekRef.current
    if (pending) {
      writeGlobalPlayhead(pending.globalMs)
      if (!flow.videoSrc && flow.timeline.activeIndex === pending.segmentIndex) {
        syntheticLocalMsRef.current = pending.localMs
        pendingSeekRef.current = null
      }
      return
    }
    const active = flow.timeline.segments[flow.timeline.activeIndex]
    const localMs = active ? Math.max(0, flow.timeline.playheadMs - active.startMs) : 0
    syntheticLocalMsRef.current = localMs
    writeSmoothPlayhead(localMs)
  }, [snap.clipSeq, flow.timeline, flow.videoSrc, writeGlobalPlayhead, writeSmoothPlayhead])

  useEffect(() => {
    if (flow.paused) {
      const video = activeVideoRef.current
      if (video) writeSmoothPlayhead(video.currentTime * 1000)
      return
    }
    let frameId = 0
    let previousFrameAt = performance.now()
    const renderFrame = (now: number): void => {
      const pending = pendingSeekRef.current
      if (pending) {
        writeGlobalPlayhead(pending.globalMs)
        previousFrameAt = now
        frameId = requestAnimationFrame(renderFrame)
        return
      }
      const video = activeVideoRef.current
      if (video) {
        syntheticLocalMsRef.current = video.currentTime * 1000
      } else if (!flow.videoSrc) {
        syntheticLocalMsRef.current += Math.max(0, now - previousFrameAt) * flow.playbackRate
      }
      previousFrameAt = now
      writeSmoothPlayhead(syntheticLocalMsRef.current)
      frameId = requestAnimationFrame(renderFrame)
    }
    frameId = requestAnimationFrame(renderFrame)
    return () => cancelAnimationFrame(frameId)
  }, [flow.paused, flow.playbackRate, flow.videoSrc, snap.clipSeq, writeGlobalPlayhead, writeSmoothPlayhead])

  return (
    <div className="nps-root nps-flow-root" data-testid="flow-node-preview">
      <div className="gc-frame nps-frame" data-type="video">
        <PlaybackClockProvider value={{ paused: flow.paused, rate: flow.playbackRate }}>
          <PlayerRootContext.Provider value={rootElement}>
            <div
              ref={bindRoot}
              tabIndex={0}
              onPointerDown={() => claimPlayerFocus(rootRef.current)}
              onFocus={() => claimPlayerFocus(rootRef.current)}
              style={{ position: 'absolute', inset: 0, outline: 'none' }}
            >
              <BgmPlayer
                key={flow.bgmRunKey}
                bgm={snap.bgm}
                resolveAsset={flow.resolveBgm}
                paused={flow.paused}
                playbackRate={flow.playbackRate}
                active={snap.phase !== 'ended'}
              />
              <GameStage
                videoSrc={flow.videoSrc}
                videoKey={flow.videoKey}
                clip={snap.clip}
                preloadVideos={flow.preloadVideos}
                overlayMounts={snap.overlayMounts}
                skins={flow.session.skins}
                skinCtx={{
                  hud: snap.hud,
                  condition: {
                    state: flow.session.runtime.state,
                    visited: flow.session.runtime.state.visited,
                  },
                }}
                onEmit={flow.onEmit}
                onTick={flow.onTick}
                onPerformanceEnd={flow.onPerformanceEnd}
                onDurationChange={flow.onDurationChange}
                onActiveVideoChange={handleActiveVideoChange}
                paused={flow.paused}
                playbackRate={flow.playbackRate}
                videoAudioEnabled={flow.videoAudioEnabled}
              />
            </div>
          </PlayerRootContext.Provider>
        </PlaybackClockProvider>
      </div>

      <div className="nps-controls nps-flow-controls">
        <button
          type="button"
          onClick={() => flow.onPausedChange(!flow.paused)}
          title={flow.paused ? '继续预览' : '暂停预览'}
          aria-label={flow.paused ? '继续预览' : '暂停预览'}
        >
          {flow.paused ? '▶' : 'Ⅱ'}
        </button>
        <span className="nps-flow-status" title={`${snap.phase} · ${snap.clip?.name || snap.currentNodeId || ''}`}>
          <strong>{snap.phase}</strong>{snap.clip?.name || snap.currentNodeId ? ` · ${snap.clip?.name || snap.currentNodeId}` : ''}
        </span>
        <select
          aria-label="预览倍速"
          value={flow.playbackRate}
          onChange={(event) => flow.onPlaybackRateChange(Number(event.target.value))}
        >
          {[0.5, 1, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
        </select>
        <VideoAudioToggle
          compact
          enabled={flow.videoAudioEnabled}
          onToggle={flow.onVideoAudioToggle}
        />
        <button type="button" className="nps-restart" onClick={flow.onRestart} title="从起始节点重开">
          ↻ 重开
        </button>
        {timelineToggle}
      </div>

      {timelineExpanded ? (
        <div ref={timelineHostRef} id={timelineId}>
          <MaterialTimeline
            materials={flow.timeline.materials}
            maxMs={flow.timeline.maxMs}
            playheadMs={flow.timeline.playheadMs}
            selectedMaterialKey={null}
            pointMarkers={flow.timeline.pointMarkers}
            conditionMarkers={flow.timeline.conditionMarkers}
            segments={flow.timeline.segments}
            widthMode="append"
            context="video"
            editable={false}
            selectable={false}
            emptyHint="正在建立流程时间轴…"
            onSeek={handleTimelineSeek}
            onScrubStart={handleScrubStart}
            onScrubEnd={handleScrubEnd}
            seekDragSensitivity={flow.seekDragSensitivity ?? 0.8}
            onSelectMaterial={() => {}}
            onPatchMaterial={() => {}}
          />
        </div>
      ) : null}
    </div>
  )
}
