/**
 * GraphPlayer —— 试玩运行时 React 组件。**只订阅 GraphSession 的 snapshot 渲染 + 回灌输入**，
 * 不含任何游戏逻辑（逻辑全在纯 TS 引擎/会话里，已 headless 单测）。
 *
 * 驱动：有 durationMs 的演出节点 → setTimeout 到时 performanceEnd 自动推进；有交互 → 等玩家点。
 * 渲染：clip（视频/占位）+ overlays（表现层）+ interaction（交互层）+ HUD + banner，均走渲染器 registry。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameScenario } from '../graph-schema'
import { GraphSession, type SessionSnapshot } from '../session'
import { registerCoreRenderers, renderInteraction, renderOverlay } from './rendererRegistry'
import { resolveMediaSrc } from './media'

export function GraphPlayer({ scenario }: { scenario: GameScenario }): JSX.Element {
  registerCoreRenderers()
  const game = useMemo(() => new URLSearchParams(location.search).get('game') ?? 'game-nodia-fighting', [])
  const session = useMemo(() => new GraphSession(scenario), [scenario])
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [snap, setSnap] = useState<SessionSnapshot>(() => session.start())
  const videoSrc = resolveMediaSrc(snap.clip?.mediaId, game)

  // 演出时长 durationMs 到点推进（视频作为视觉；video onEnded 也会推进，取先到者；tick 由 currentTime 驱动）。
  useEffect(() => {
    if (snap.interaction || snap.phase === 'ended' || !snap.clip?.durationMs) return
    const t = setTimeout(() => setSnap(sessionRef.current.performanceEnd()), snap.clip.durationMs)
    return () => clearTimeout(t)
  }, [snap.clip?.nodeId, snap.interaction, snap.phase, snap.clip?.durationMs])

  // 限时交互 timeoutMs：到点自动 submit(undefined) → 走 defaultKey / 缺省出口。
  useEffect(() => {
    const inter = snap.interaction
    if (!inter?.timeoutMs) return
    const t = setTimeout(() => setSnap(sessionRef.current.submit(undefined)), inter.timeoutMs)
    return () => clearTimeout(t)
  }, [snap.interaction?.elementId, snap.interaction?.timeoutMs])

  const submit = (input: unknown) => setSnap(sessionRef.current.submit(input))

  return (
    <div className="gv-graph-player" style={{ position: 'relative', width: '100%', height: '100%', background: '#000', color: '#fff' }}>
      {/* 演出画面 */}
      <div className="gv-stage" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {videoSrc ? (
          <video
            key={snap.clip?.nodeId}
            src={videoSrc}
            autoPlay
            muted
            playsInline
            onEnded={() => setSnap(sessionRef.current.performanceEnd())}
            onTimeUpdate={(e) => setSnap(sessionRef.current.tick(Math.floor(e.currentTarget.currentTime * 1000)))}
            style={{ maxWidth: '100%', maxHeight: '100%' }}
          />
        ) : (
          <div className="gv-placeholder" style={{ opacity: 0.7 }}>{snap.clip?.name ?? '（无演出）'}</div>
        )}
      </div>

      {/* 表现层叠加（漂字等） */}
      <div className="gv-overlays" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {snap.overlays.map((o, i) => (
          <span key={`${o.elementId}-${i}`} style={{ display: 'contents' }}>{renderOverlay(o)}</span>
        ))}
      </div>

      {/* HUD（按 hudHidden 过滤：全局 ui.hud show + 节点 node.data.hud） */}
      <div className="gv-hud" style={{ position: 'absolute', top: 8, left: 8, right: 8, display: 'flex', gap: 16 }}>
        {Object.entries(snap.hud.entities).filter(([id]) => !snap.hudHidden.includes(id)).map(([id, e]) => (
          <div key={id} className="gv-hud-hp">
            {id}: {e.hp}/{e.maxHp}
          </div>
        ))}
        {!snap.hudHidden.includes('score') && <div className="gv-hud-score">score: {snap.hud.score}</div>}
      </div>

      {/* 交互层 */}
      {snap.interaction && (
        <div className="gv-interaction" style={{ position: 'absolute', bottom: 24, left: 0, right: 0 }}>
          {renderInteraction(snap.interaction, submit)}
        </div>
      )}

      {/* 结局横幅 */}
      {snap.banner && (
        <div className="gv-banner" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, background: 'rgba(0,0,0,0.6)' }}>
          {snap.banner.kind === 'victory' ? '胜利' : snap.banner.kind === 'defeat' ? '失败' : '结束'} · {snap.banner.title}
        </div>
      )}
    </div>
  )
}
