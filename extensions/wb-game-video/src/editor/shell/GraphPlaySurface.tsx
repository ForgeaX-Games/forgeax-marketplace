/**
 * GraphPlaySurface —— 新引擎「试玩」整表面（对齐旧 BlueprintPlayer 的试玩交互，用新引擎渲染）。
 *
 * 主区 = 新引擎（GraphSession）跑出的视频游戏：视频演出 + 表现叠层 + 交互层 + HUD 血条 + 结局横幅。
 * 右上角悬浮**控制条**（重开 / 自动演示 / 日志 / 蓝图，样式对齐旧试玩）。
 * 「蓝图」「日志」为**可拖拽 + 可缩放**浮层（对齐旧 DraggablePanel）；蓝图浮层复用 GraphCanvas，
 * 实时高亮当前节点/已走边，点节点=jump 执行，只读（不改图、不出节点配置）。
 * 数据来自共享 graphScenario store（与蓝图/视频/界面/规则同源）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { GameScenario } from '../../runtime/schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '../../runtime/engine/session'
import { GraphCanvas } from '../../graph/canvas/GraphCanvas'
import { PlayerRootContext, type HudElementView, type SkinCtx } from '../../runtime/skins/rendererRegistry'
import { claimPlayerFocus, releasePlayerFocus } from '../../runtime/input/playerFocus'
import { bootEditorSkins } from '../init'
import { resolveMediaSrc } from './media'
import { computeVideoContentRect, type VideoContentRect } from '../video/videoContentRect'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { expandNodeOverlays } from '../../runtime/schema/expand-overlay'
import { getKind } from '../../runtime/registry/kind-registry'

function autoInput(handles: string[]): unknown {
  const h = handles[0] ?? ''
  if (h.startsWith('opt:')) return h.slice(4)
  if (h.startsWith('hs:')) return h.slice(3)
  return h
}

// ── 可拖拽 + 可缩放浮层（对齐旧 BlueprintPlayer DraggablePanel）──────────────────
type Gesture = { type: 'move'; ox: number; oy: number } | { type: 'resize'; sx: number; sy: number; sw: number; sh: number }
function DraggablePanel({ title, initial, onClose, children }: { title: string; initial: { x: number; y: number; w: number; h: number }; onClose: () => void; children: ReactNode }): JSX.Element {
  const [box, setBox] = useState(initial)
  const g = useRef<Gesture | null>(null)
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const gg = g.current
      if (!gg) return
      if (gg.type === 'move') setBox((b) => ({ ...b, x: Math.max(0, e.clientX - gg.ox), y: Math.max(0, e.clientY - gg.oy) }))
      else setBox((b) => ({ ...b, w: Math.max(280, gg.sw + (e.clientX - gg.sx)), h: Math.max(200, gg.sh + (e.clientY - gg.sy)) }))
    }
    const onUp = () => { g.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [])
  return (
    <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, zIndex: 20, borderRadius: 10, border: '1px solid #403830', background: 'rgba(27,23,19,0.96)', boxShadow: '0 10px 40px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div
        onPointerDown={(e) => { g.current = { type: 'move', ox: e.clientX - box.x, oy: e.clientY - box.y } }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 10px', background: '#252019', borderBottom: '1px solid #2e2924', fontSize: 12, color: '#c9d1e0', cursor: 'move', userSelect: 'none', flex: 'none' }}
      >
        <span>{title}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#9aa2b1', cursor: 'pointer' }}>✕</button>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>{children}</div>
      <div
        title="按住拖拽缩放"
        onPointerDown={(e) => { e.stopPropagation(); g.current = { type: 'resize', sx: e.clientX, sy: e.clientY, sw: box.w, sh: box.h } }}
        style={{ position: 'absolute', right: 2, bottom: 2, width: 16, height: 16, cursor: 'nwse-resize', borderRight: '2px solid #f08840', borderBottom: '2px solid #f08840', borderRadius: '0 0 5px 0' }}
      />
    </div>
  )
}

export function GraphPlaySurface({ scenario }: { scenario: GameScenario }): JSX.Element {
  bootEditorSkins()
  const game = useMemo(() => new URLSearchParams(location.search).get('game') ?? 'game-nodia-fighting', [])
  const ensureBoot = useGraphScenario((s) => s.ensureBoot)
  const graph = useGraphScenario((s) => s.graph)
  const overlays = useGraphScenario((s) => s.meta.ui?.overlays)
  const ready = graph.nodes.length > 0
  useEffect(() => { ensureBoot(game, scenario) }, [game, scenario, ensureBoot])

  const [restartKey, setRestartKey] = useState(0)
  const [auto, setAuto] = useState(false)
  const [showBlueprint, setShowBlueprint] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const sessionRef = useRef<GraphSession | null>(null)
  const [snap, setSnap] = useState<SessionSnapshot | null>(null)
  const [skins, setSkins] = useState<GraphSession['skins'] | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const el = rootRef.current
    setRootEl(el)
    if (el) claimPlayerFocus(el)
    return () => releasePlayerFocus(el)
  }, [])

  // 视频 object-fit:contain 后的实际画面矩形——HUD/QTE/交互等 overlay 都锚在这块
  // 视频显示区上（而非整个内容区），视频缩小/换比例时血条等跟着视频走。
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const [contentRect, setContentRect] = useState<VideoContentRect | null>(null)
  const recomputeRect = useCallback(() => {
    const v = videoElRef.current
    setContentRect(v ? computeVideoContentRect(v) : null)
  }, [])
  useEffect(() => {
    const v = videoElRef.current
    if (!v) return
    const parent = v.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => recomputeRect())
    ro.observe(parent)
    return () => ro.disconnect()
  }, [recomputeRect, snap?.clip?.nodeId])

  useEffect(() => {
    if (!ready) return
    const s = new GraphSession(useGraphScenario.getState().scn())
    sessionRef.current = s
    setSkins(s.skins)
    setSnap(s.start())
  }, [restartKey, ready])

  const videoSrc = resolveMediaSrc(snap?.clip?.mediaId, game)

  useEffect(() => {
    if (!snap || snap.interaction || snap.phase === 'ended' || !snap.clip?.durationMs) return
    const t = setTimeout(() => setSnap(sessionRef.current!.performanceEnd()), snap.clip.durationMs)
    return () => clearTimeout(t)
  }, [snap?.clip?.nodeId, snap?.interaction, snap?.phase, snap?.clip?.durationMs])

  useEffect(() => {
    if (!snap?.interaction?.timeoutMs) return
    const t = setTimeout(() => setSnap(sessionRef.current!.submit(undefined)), snap.interaction.timeoutMs)
    return () => clearTimeout(t)
  }, [snap?.interaction?.elementId, snap?.interaction?.timeoutMs])

  useEffect(() => {
    if (!auto || !snap?.interaction) return
    const handles = snap.interaction.handles
    const t = setTimeout(() => setSnap(sessionRef.current!.submit(autoInput(handles))), 700)
    return () => clearTimeout(t)
  }, [auto, snap?.interaction?.elementId, snap?.interaction])

  const submit = (input: unknown) => setSnap(sessionRef.current!.submit(input))
  const doJump = (nodeId: string) => setSnap(sessionRef.current!.jump(nodeId))
  const traversed = useMemo(() => new Set(snap?.traversedEdgeIds ?? []), [snap?.traversedEdgeIds])
  const currentNode = useMemo(() => graph.nodes.find((n) => n.id === snap?.currentNodeId), [graph, snap?.currentNodeId])
  // 皮肤 HUD：从当前节点 overlay 展开后取 surface:'hud' 的组件。
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
  const skinCtx: SkinCtx | undefined = snap ? { hud: snap.hud } : undefined

  const toolBtn = (on: boolean): CSSProperties => ({
    padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
    border: '1px solid ' + (on ? '#f08840' : 'rgba(255,255,255,0.14)'),
    background: on ? '#2f2923' : 'rgba(37,32,25,0.9)', color: '#e8eaed',
  })

  // 游戏 overlay 舞台 = 视频实际显示矩形（有黑边时锚在视频那块，不铺满容器）。
  // 无 contentRect（未加载/无视频）时回退到铺满容器。层内自身 pointerEvents 不变，
  // 舞台设 none 让空白处点击穿透，交互层单独开 auto。
  const stageStyle: CSSProperties = contentRect
    ? { position: 'absolute', left: contentRect.left, top: contentRect.top, width: contentRect.width, height: contentRect.height, pointerEvents: 'none' }
    : { position: 'absolute', inset: 0, pointerEvents: 'none' }

  return (
    <PlayerRootContext.Provider value={rootEl}>
    <div
      ref={rootRef}
      tabIndex={0}
      onPointerDown={() => claimPlayerFocus(rootRef.current)}
      onFocus={() => claimPlayerFocus(rootRef.current)}
      style={{ position: 'relative', width: '100%', height: '100%', background: '#000', overflow: 'hidden', outline: 'none' }}
    >
      {/* 演出画面 */}
      {videoSrc ? (
        <video
          key={snap?.clip?.nodeId}
          ref={videoElRef}
          src={videoSrc}
          autoPlay
          muted
          playsInline
          loop={!!snap?.clip?.loop}
          onLoadedMetadata={recomputeRect}
          onEnded={() => {
            if (snap?.clip?.loop) return
            setSnap(sessionRef.current!.performanceEnd())
          }}
          onTimeUpdate={(e) => setSnap(sessionRef.current!.tick(Math.floor(e.currentTarget.currentTime * 1000)))}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.6)' }}>
          {snap ? snap.clip?.name ?? '（无演出）' : '加载中…'}
        </div>
      )}

      {/* 游戏 overlay 舞台：锚定视频实际显示矩形（object-fit:contain 后带黑边的那块）。
          HUD / QTE / 交互 / 结局横幅都相对这块定位，视频缩放/换比例时跟着视频走。 */}
      <div style={stageStyle}>
      {/* 表现叠层 */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {(snap?.overlays ?? []).map((o, i) => (
          <span key={`${o.elementId}-${i}`} style={{ display: 'contents' }}>{skins?.renderOverlay(o)}</span>
        ))}
      </div>

      {/* 皮肤 HUD：仅当前节点挂了 surface:'hud' 时显示（叙事段不挂 battleHud → 无血条）。 */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 5 }}>
        {hudComp.size > 0 && Object.keys(snap?.hud.entities ?? {}).map((id) => {
          const el = hudComp.get(id)
          if (el?.component && skinCtx && skins) return <span key={id}>{skins.renderHudElement(el, skinCtx)}</span>
          return null
        })}
      </div>

      {/* 内置 HUD 列：仅节点声明了 HUD 挂载、且实体未配皮肤组件时兜底。 */}
      <div style={{ position: 'absolute', top: 10, left: 12, width: 220, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hudComp.size > 0 && Object.entries(snap?.hud.entities ?? {}).filter(([id]) => !hudComp.get(id)?.component).map(([id, e]) => {
          const ratio = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0
          const col = ratio > 0.5 ? '#22c55e' : ratio > 0.2 ? '#eab308' : '#ef4444'
          return (
            <div key={id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#fff', textShadow: '0 1px 3px #000' }}>
                <span>{id}</span><span>{e.hp}/{e.maxHp}</span>
              </div>
              <div style={{ height: 9, background: 'rgba(0,0,0,0.55)', borderRadius: 5, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.15)' }}>
                <div style={{ width: `${ratio * 100}%`, height: '100%', background: col, transition: 'width .25s' }} />
              </div>
            </div>
          )
        })}
      </div>

      {/* 结局横幅 */}
      {snap?.banner && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 44, color: '#fff', background: 'rgba(0,0,0,0.6)' }}>
          结束{snap.banner.title ? ` · ${snap.banner.title}` : ''}
        </div>
      )}

      {/* 交互层：铺满舞台=视频显示区。皮肤（防反/技能条）与默认按钮行各自绝对定位到
          自己的位置（防反=右侧居中、技能条/默认=底部），故这里只做全区容器、点击穿透。 */}
      {snap?.interaction && skins && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>{skins.renderInteraction(snap.interaction, submit, skinCtx)}</div>
      )}
      </div>

      {/* 控制条：右上角悬浮 */}
      <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 6, alignItems: 'center', padding: 4, borderRadius: 10, background: 'rgba(27,23,19,0.7)' }}>
        <button style={toolBtn(false)} onClick={() => setRestartKey((k) => k + 1)}>重开</button>
        <button style={toolBtn(auto)} onClick={() => setAuto((v) => !v)}>{auto ? '停止演示' : '自动演示'}</button>
        <button style={toolBtn(showLogs)} onClick={() => setShowLogs((v) => !v)}>日志</button>
        <button style={toolBtn(showBlueprint)} onClick={() => setShowBlueprint((v) => !v)}>蓝图</button>
      </div>

      {/* 蓝图浮层：可拖拽 + 可缩放，复用 GraphCanvas */}
      {showBlueprint && (
        <DraggablePanel title="蓝图状态机 · 点节点跳转执行" initial={{ x: 40, y: 56, w: 540, h: 420 }} onClose={() => setShowBlueprint(false)}>
          <GraphCanvas graph={graph} onChange={() => {}} activeNodeId={snap?.currentNodeId} traversedEdgeIds={traversed} onJump={doJump} />
        </DraggablePanel>
      )}

      {/* 日志浮层：可拖拽 + 可缩放；含运行流水 + 当前执行节点的配置 JSON（对齐旧试玩） */}
      {showLogs && (
        <DraggablePanel title="运行日志" initial={{ x: 600, y: 56, w: 360, h: 420 }} onClose={() => setShowLogs(false)}>
          <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: 10, fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7, color: '#cfe3ff' }}>
            <div style={{ fontWeight: 700, opacity: 0.8, marginBottom: 4 }}>运行流水</div>
            {(snap?.log ?? []).length === 0 ? <div style={{ opacity: 0.5 }}>（暂无日志）</div> : (snap?.log ?? []).map((l, i) => <div key={i}>{l}</div>)}
            <div style={{ fontWeight: 700, opacity: 0.8, margin: '10px 0 4px', borderTop: '1px solid #2e2924', paddingTop: 8 }}>进入原因</div>
            <div style={{ color: '#ffe08a', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{snap?.entryReason ?? '起始节点（无入口边）'}</div>
            <div style={{ fontWeight: 700, opacity: 0.8, margin: '10px 0 4px', borderTop: '1px solid #2e2924', paddingTop: 8 }}>
              当前节点配置{snap?.currentNodeId ? `（${snap.currentNodeId}）` : ''}
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, color: '#bfe4ff', background: 'rgba(255,255,255,0.05)', padding: 10, borderRadius: 8 }}>
              {JSON.stringify(currentNode?.data ?? null, null, 2)}
            </pre>
          </div>
        </DraggablePanel>
      )}
    </div>
    </PlayerRootContext.Provider>
  )
}
