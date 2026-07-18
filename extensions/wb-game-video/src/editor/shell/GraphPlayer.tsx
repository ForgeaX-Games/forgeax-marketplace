/**
 * GraphPlayer —— 试玩运行时 React 组件。**只订阅 GraphSession 的 snapshot 渲染 + 回灌输入**，
 * 不含任何游戏逻辑（逻辑全在纯 TS 引擎/会话里，已 headless 单测）。
 *
 * HUD 与 GraphPlaySurface 同源：仅当当前节点挂了 `surface:'hud'` overlay 时渲染皮肤血条。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameScenario } from '../../runtime/schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '../../runtime/engine/session'
import { PlayerRootContext, type HudElementView, type SkinCtx } from '../../runtime/skins/rendererRegistry'
import { claimPlayerFocus, releasePlayerFocus } from '../../runtime/input/playerFocus'
import { bootEditorSkins } from '../init'
import { resolveMediaSrc } from './media'
import { expandNodeOverlays } from '../../runtime/schema/expand-overlay'
import { getKind } from '../../runtime/registry/kind-registry'

export function GraphPlayer({ scenario }: { scenario: GameScenario }): JSX.Element {
  bootEditorSkins()
  const game = useMemo(() => new URLSearchParams(location.search).get('game') ?? 'game-nodia-fighting', [])
  const session = useMemo(() => new GraphSession(scenario), [scenario])
  const sessionRef = useRef(session)
  sessionRef.current = session
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  const [snap, setSnap] = useState<SessionSnapshot>(() => session.start())
  const videoSrc = resolveMediaSrc(snap.clip?.mediaId, game)
  const overlays = scenario.ui?.overlays
  const currentNode = useMemo(
    () => scenario.graph.nodes.find((n) => n.id === snap.currentNodeId),
    [scenario.graph.nodes, snap.currentNodeId],
  )
  const hudComp = useMemo(() => {
    const m = new Map<string, HudElementView>()
    if (!currentNode) return m
    const children = expandNodeOverlays(overlays, currentNode).flatMap((i) => i.children)
    for (const c of children) {
      const plugin = getKind(c.component)
      if (plugin?.surface !== 'hud') continue
      const params = c.params as { bind?: string; label?: string; accent?: string }
      const bind = params.bind ?? c.id
      m.set(bind, {
        element: bind,
        component: c.component,
        label: params.label,
        accent: params.accent,
        layout: c.layout,
      })
    }
    return m
  }, [overlays, currentNode])
  const skinCtx: SkinCtx = { hud: snap.hud }

  useEffect(() => {
    const el = rootRef.current
    setRootEl(el)
    if (el) claimPlayerFocus(el)
    return () => releasePlayerFocus(el)
  }, [])

  useEffect(() => {
    if (snap.interaction || snap.phase === 'ended' || !snap.clip?.durationMs) return
    const t = setTimeout(() => setSnap(sessionRef.current.performanceEnd()), snap.clip.durationMs)
    return () => clearTimeout(t)
  }, [snap.clip?.nodeId, snap.interaction, snap.phase, snap.clip?.durationMs])

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
        <div className="gv-stage" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {videoSrc ? (
            <video
              key={snap.clip?.nodeId}
              src={videoSrc}
              autoPlay
              muted
              playsInline
              loop={!!snap.clip?.loop}
              onEnded={() => {
                if (snap.clip?.loop) return
                setSnap(sessionRef.current.performanceEnd())
              }}
              onTimeUpdate={(e) => setSnap(sessionRef.current.tick(Math.floor(e.currentTarget.currentTime * 1000)))}
              style={{ maxWidth: '100%', maxHeight: '100%' }}
            />
          ) : (
            <div className="gv-placeholder" style={{ opacity: 0.7 }}>{snap.clip?.name ?? '（无演出）'}</div>
          )}
        </div>

        <div className="gv-overlays" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {snap.overlays.map((o, i) => (
            <span key={`${o.elementId}-${i}`} style={{ display: 'contents' }}>{skins.renderOverlay(o)}</span>
          ))}
        </div>

        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
          {hudComp.size > 0 && Object.keys(snap.hud.entities).map((id) => {
            const el = hudComp.get(id)
            if (el?.component) return <span key={id}>{skins.renderHudElement(el, skinCtx)}</span>
            return null
          })}
        </div>

        {snap.interaction && (
          <div className="gv-interaction" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {skins.renderInteraction(snap.interaction, submit, skinCtx)}
          </div>
        )}

        {snap.banner && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, background: 'rgba(0,0,0,0.55)' }}>
            结束{snap.banner.title ? ` · ${snap.banner.title}` : ''}
          </div>
        )}
      </div>
    </PlayerRootContext.Provider>
  )
}
