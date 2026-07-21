/**
 * GraphPlayer —— 试玩运行时 React 组件。**只订阅 GraphSession 的 snapshot 渲染 + 回灌事件**，
 * 不含任何游戏逻辑（逻辑全在纯 TS 引擎/会话里，已 headless 单测）。
 *
 * 全部组件经 overlayMounts + skinCtx（绘制时 resolve / 选项门控）渲染；事件走 emitEvent。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameScenario } from '../../runtime/schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '../../runtime/engine/session'
import { PlayerRootContext, type SkinCtx } from '../../runtime/skins/rendererRegistry'
import { claimPlayerFocus, releasePlayerFocus } from '../../runtime/input/playerFocus'
import { bootEditorSkins } from '../init'
import { resolveMediaSrc, videoDurationCapReached } from './media'
import { useClipPerformanceEnd } from './useClipPerformanceEnd'
import { VideoOverlayStage } from '../video/VideoOverlayStage'
import { useVideoContentRect } from '../video/useVideoContentRect'
import { getGameSlug } from '../persist/gameScope'

export function GraphPlayer({ scenario }: { scenario: GameScenario }): JSX.Element {
  bootEditorSkins()
  // 宿主 iframe 传 `?slug=`（见 gameScope.ts）；勿只读 `?game=`，否则媒体路径落到错误 game。
  const game = useMemo(() => getGameSlug() ?? 'game-nodia-fighting', [])
  const session = useMemo(() => new GraphSession(scenario), [scenario])
  const sessionRef = useRef(session)
  sessionRef.current = session
  const rootRef = useRef<HTMLDivElement | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  const [snap, setSnap] = useState<SessionSnapshot>(() => session.start())
  const endPerformance = useClipPerformanceEnd(sessionRef, setSnap, snap.clip?.nodeId)
  const { contentRect, recomputeRect } = useVideoContentRect(videoElRef, [snap.clip?.nodeId])
  const videoSrc = resolveMediaSrc(snap.clip?.mediaId, game)
  const skinCtx: SkinCtx = {
    hud: snap.hud,
    condition: { state: session.runtime.state, visited: session.runtime.state.visited },
  }

  useEffect(() => {
    const el = rootRef.current
    setRootEl(el)
    if (el) claimPlayerFocus(el)
    return () => releasePlayerFocus(el)
  }, [])

  useEffect(() => {
    // 无视频：durationMs 到点推进；有视频：durationMs 作播放时长上限，走 <video> onTimeUpdate。
    if (snap.phase === 'ended' || !snap.clip?.durationMs || snap.clip.mediaId) return
    const t = setTimeout(() => endPerformance(), snap.clip.durationMs)
    return () => clearTimeout(t)
  }, [snap.clip?.nodeId, snap.phase, snap.clip?.durationMs, snap.clip?.mediaId, endPerformance])

  const skins = session.skins

  return (
    <PlayerRootContext.Provider value={rootEl}>
      <div
        ref={rootRef}
        className="gv-graph-player"
        tabIndex={0}
        onPointerDown={() => claimPlayerFocus(rootRef.current)}
        onFocus={() => claimPlayerFocus(rootRef.current)}
        style={{ position: 'relative', width: '100%', height: '100%', background: '#000', color: '#fff', outline: 'none' }}
      >
        {videoSrc ? (
          <video
            key={snap.clip?.nodeId}
            ref={videoElRef}
            src={videoSrc}
            autoPlay
            muted
            playsInline
            loop={!!snap.clip?.loop}
            onLoadedMetadata={recomputeRect}
            onEnded={() => {
              if (snap.clip?.loop) return
              endPerformance()
            }}
            onTimeUpdate={(e) => {
              const el = e.currentTarget
              const nowMs = Math.floor(el.currentTime * 1000)
              if (videoDurationCapReached(nowMs, snap.clip?.durationMs, el.duration)) {
                el.pause()
                endPerformance()
                return
              }
              setSnap(sessionRef.current.tick(nowMs))
            }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : (
          <div className="gv-placeholder" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.7 }}>
            {snap.clip?.name ?? '（无演出）'}
          </div>
        )}

        <VideoOverlayStage contentRect={contentRect}>
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {snap.overlayMounts.map((m) => (
              <span key={m.mountId} style={{ display: 'contents' }}>
                {skins.renderOverlayMount(
                  m,
                  (elementId, key) => setSnap(sessionRef.current.emitEvent(elementId, key)),
                  skinCtx,
                )}
              </span>
            ))}
          </div>
        </VideoOverlayStage>
      </div>
    </PlayerRootContext.Provider>
  )
}
