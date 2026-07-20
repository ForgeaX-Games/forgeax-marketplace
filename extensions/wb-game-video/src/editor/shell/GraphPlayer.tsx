/**
 * GraphPlayer —— 试玩运行时 React 组件。**只订阅 GraphSession 的 snapshot 渲染 + 回灌输入**，
 * 不含任何游戏逻辑（逻辑全在纯 TS 引擎/会话里，已 headless 单测）。
 *
 * HUD 与 GraphPlaySurface 同源：挂载的 battleHpBar 等经 overlayMounts + skinCtx 渲染。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameScenario } from '../../runtime/schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '../../runtime/engine/session'
import { PlayerRootContext, type SkinCtx } from '../../runtime/skins/rendererRegistry'
import { claimPlayerFocus, releasePlayerFocus } from '../../runtime/input/playerFocus'
import { bootEditorSkins } from '../init'
import { resolveMediaSrc, videoDurationCapReached } from './media'
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
  const { contentRect, recomputeRect } = useVideoContentRect(videoElRef, [snap.clip?.nodeId])
  const videoSrc = resolveMediaSrc(snap.clip?.mediaId, game)
  // 挂载 HUD 走 overlayMounts + skinCtx；选项门控需要 condition（PR #77 optionLock）。
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
    if (snap.interaction || snap.phase === 'ended' || !snap.clip?.durationMs || snap.clip.mediaId) return
    const t = setTimeout(() => setSnap(sessionRef.current.performanceEnd()), snap.clip.durationMs)
    return () => clearTimeout(t)
  }, [snap.clip?.nodeId, snap.interaction, snap.phase, snap.clip?.durationMs, snap.clip?.mediaId])

  useEffect(() => {
    const inter = snap.interaction
    if (!inter?.timeoutMs) return
    const t = setTimeout(() => setSnap(sessionRef.current.submit(undefined)), inter.timeoutMs)
    return () => clearTimeout(t)
  }, [snap.interaction?.elementId, snap.interaction?.timeoutMs])

  const submit = (input: unknown) => setSnap(sessionRef.current.submit(input))
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
              setSnap(sessionRef.current.performanceEnd())
            }}
            onTimeUpdate={(e) => {
              const el = e.currentTarget
              const nowMs = Math.floor(el.currentTime * 1000)
              // 播放时长上限：到点提前收演出（awaitInteraction 下 performanceEnd 为 no-op）。
              if (!snap.interaction && videoDurationCapReached(nowMs, snap.clip?.durationMs, el.duration)) {
                setSnap(sessionRef.current.performanceEnd())
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
          {/* 表现叠层 + 挂载 HUD：传 skinCtx，否则 battleHpBar 等会在 overlay 表查不到而静默丢弃。 */}
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

          {snap.interaction && (
            <div className="gv-interaction" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {skins.renderInteraction(snap.interaction, submit, skinCtx)}
            </div>
          )}
        </VideoOverlayStage>
      </div>
    </PlayerRootContext.Provider>
  )
}
