/**
 * GamePlayer —— 运行时试玩组件 SSOT（runtime/play）。**只订阅 GraphSession 的 snapshot 渲染 +
 * 回灌事件**,游戏逻辑全在纯 TS 引擎/会话里(已 headless 单测)。
 *
 * 与宿主解耦:靠两个注入项跑起来,不 import editor/宿主:
 *   - `resolveAsset(mediaId, game)`:把节点媒体 id 解析成可播 url(宿主专属——forgeax 走
 *     宿主媒体服务、将来 manifest/COS;arrival 走自己的实现)。runtime 不认识这些。
 *   - `game`:宿主 handshake 接受的当前游戏 id，作 prop 传入；runtime 不读 URL。
 *
 * 渲染帧交给共享的 <GameStage>;这里只管会话生命周期 + 根容器/焦点/占位。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameScenario } from '../schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '../engine/session'
import { PlayerRootContext, type SkinCtx } from '../component-host/rendererRegistry'
import { registerBuiltins } from '../component-host'
import { claimPlayerFocus, releasePlayerFocus } from '../input/playerFocus'
import { useClipPerformanceEnd } from './useClipPerformanceEnd'
import { GameStage } from './GameStage'
import { BgmPlayer } from './BgmPlayer'

/** 媒体解析注入契约:节点媒体 id → 可播 url(宿主实现)。 */
export type ResolveAsset = (mediaId: string | undefined, game: string) => string | undefined

export interface GamePlayerProps {
  scenario: GameScenario
  /** 当前游戏 slug（宿主注入）。 */
  game: string
  /** 媒体解析器（宿主注入）。 */
  resolveAsset: ResolveAsset
}

export function GamePlayer({ scenario, game, resolveAsset }: GamePlayerProps): JSX.Element {
  registerBuiltins()
  const session = useMemo(() => new GraphSession(scenario), [scenario])
  const sessionRef = useRef(session)
  sessionRef.current = session
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  const [snap, setSnap] = useState<SessionSnapshot>(() => session.start())
  const endPerformance = useClipPerformanceEnd(sessionRef, setSnap, snap.clip?.nodeId)
  const videoSrc = resolveAsset(snap.clip?.mediaId, game)
  const preloadVideos = useMemo(
    () => session.preloadClips().map((candidate) => ({
      videoSrc: resolveAsset(candidate.mediaId, game),
      clip: candidate,
    })),
    [session, snap.currentNodeId, game, resolveAsset],
  )
  // 床轨与视频共用同一个宿主解析器（audio id 走同一 assets/manifest 路径）；BgmPlayer 只吃单参签名。
  const resolveBgm = useCallback((id: string | undefined) => resolveAsset(id, game), [resolveAsset, game])

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

  const skinCtx: SkinCtx = {
    hud: snap.hud,
    condition: { state: session.runtime.state, visited: session.runtime.state.visited },
  }

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
        {/* 床轨：独立音频通道，与 <video muted> 无关；无 UI。 */}
        <BgmPlayer bgm={snap.bgm} resolveAsset={resolveBgm} />
        <GameStage
          videoSrc={videoSrc}
          clip={snap.clip}
          preloadVideos={preloadVideos}
          overlayMounts={snap.overlayMounts}
          skins={session.skins}
          skinCtx={skinCtx}
          onEmit={(elementId, key) => setSnap(sessionRef.current.emitEvent(elementId, key))}
          onTick={(nowMs) => setSnap(sessionRef.current.tick(nowMs))}
          onPerformanceEnd={endPerformance}
        />
      </div>
    </PlayerRootContext.Provider>
  )
}
