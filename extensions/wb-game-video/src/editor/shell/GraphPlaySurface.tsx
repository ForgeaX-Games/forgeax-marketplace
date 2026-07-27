/**
 * GraphPlaySurface —— 新引擎「试玩」整表面（对齐旧 BlueprintPlayer 的试玩交互，用新引擎渲染）。
 *
 * 主区 = 新引擎（GraphSession）跑出的视频游戏：视频演出 + 表现叠层 + 交互层 + HUD 血条 + 结局横幅。
 * 右上角悬浮**控制条**（重开 / 自动演示 / 日志 / 蓝图，样式对齐旧试玩）。
 * 「蓝图」「日志」为**可拖拽 + 可缩放**浮层（对齐旧 DraggablePanel）；蓝图浮层复用 GraphCanvas，
 * 实时高亮当前节点/已走边，点节点=jump 执行，只读（不改图、不出节点配置）。
 * 数据来自共享 graphScenario store（与蓝图/视频/界面/规则同源）。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { GameScenario, GraphLibraryDocument } from '../../runtime/schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '../../runtime/engine/session'
import { GraphCanvas } from '../../graph/canvas/GraphCanvas'
import { PlayerRootContext, type SkinCtx } from '../../runtime/component-host/rendererRegistry'
import { claimPlayerFocus, releasePlayerFocus } from '../../runtime/input/playerFocus'
import { getComponent } from '../../runtime/registry/component-registry'
import { bootEditorSkins } from '../init'
import { resolveMediaSrc } from './media'
import { GameStage, useClipPerformanceEnd } from '../../runtime/play'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { getGameSlug } from '../persist/gameScope'
import { useRevealOnScopeChange } from './useRevealOnScopeChange'
import { getSubFlowPack } from '../../runtime/schema/graph-schema'
import { blueprintBreadcrumbs, deepestCallerOnBlueprint } from './call-stack-view'

function autoEmitTarget(snap: SessionSnapshot): { elementId: string; key: string } | null {
  // 自动演示：找首个可 emit 的挂载组件，抛其首个非 default 事件。
  for (const m of snap.overlayMounts) {
    for (const c of m.children) {
      const events = (c.inputs as { events?: Array<{ id: string }> }).events
      const ids = Array.isArray(events) && events.length
        ? events.map((e) => e.id)
        : (getComponent(c.component)?.events ?? []).map((e) => e.id)
      const key = ids.find((h) => h !== 'default') ?? ids[0]
      if (key) return { elementId: c.elementId, key }
    }
  }
  return null
}

// ── 可拖拽 + 可缩放浮层（对齐旧 BlueprintPlayer DraggablePanel）──────────────────
type Gesture = { type: 'move'; ox: number; oy: number } | { type: 'resize'; sx: number; sy: number; sw: number; sh: number }
function DraggablePanel({ title, initial, onClose, children }: { title: ReactNode; initial: { x: number; y: number; w: number; h: number }; onClose: () => void; children: ReactNode }): JSX.Element {
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
        <div style={{ flex: 1, minWidth: 0 }}>{title}</div>
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
  // 宿主 iframe 传 `?slug=`（见 gameScope.ts）；勿只读 `?game=`，否则会落到默认 demo 命名空间。
  const game = useMemo(() => getGameSlug() ?? 'game-nodia-fighting', [])
  const ensureBoot = useGraphScenario((s) => s.ensureBoot)
  const graph = useGraphScenario((s) => s.graph)
  const blueprints = useGraphScenario((s) => s.blueprints)
  const mainBlueprintId = useGraphScenario((s) => s.mainBlueprintId)
  const overlays = useGraphScenario((s) => s.meta.ui?.overlays)
  const ready = graph.nodes.length > 0
  useEffect(() => { ensureBoot(game, scenario) }, [game, scenario, ensureBoot])

  const [restartKey, setRestartKey] = useState(0)
  const [auto, setAuto] = useState(false)
  const [showBlueprint, setShowBlueprint] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [viewMode, setViewMode] = useState<'follow' | 'pinned'>('follow')
  const [pinnedBlueprintId, setPinnedBlueprintId] = useState<string>()
  const sessionRef = useRef<GraphSession | null>(null)
  const rootBlueprintIdRef = useRef(mainBlueprintId)
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

  // 实体从空被回填后要重建 session（否则 HUD bind 不到 ent-*）。
  const entitySig = useGraphScenario((s) => {
    const e = s.meta.entities ?? s.demo?.entities
    return e ? Object.keys(e).sort().join(',') : ''
  })
  useEffect(() => {
    if (!ready) return
    const st = useGraphScenario.getState()
    const scn = st.scn()
    const rootBlueprintId = (scn as GraphLibraryDocument).manifest?.mainPackId ?? st.mainBlueprintId
    rootBlueprintIdRef.current = rootBlueprintId
    const s = new GraphSession(scn, { rootBlueprintId })
    sessionRef.current = s
    setSkins(s.skins)
    setSnap(s.start())
  }, [restartKey, ready, entitySig])

  const videoSrc = resolveMediaSrc(snap?.clip?.mediaId, game)
  const preloadVideos = useMemo(
    () => sessionRef.current?.preloadClips().map((candidate) => ({
      videoSrc: resolveMediaSrc(candidate.mediaId, game),
      clip: candidate,
    })) ?? [],
    [snap?.currentNodeId, game, restartKey, entitySig],
  )
  const endPerformance = useClipPerformanceEnd(sessionRef, setSnap, snap?.clip?.nodeId, restartKey)

  useEffect(() => {
    // 无视频：durationMs 到点推进；有视频：durationMs 作播放时长上限，走 <video> onTimeUpdate。
    if (!snap || snap.phase === 'ended' || !snap.clip?.durationMs || snap.clip.mediaId) return
    const t = setTimeout(() => endPerformance(), snap.clip.durationMs)
    return () => clearTimeout(t)
  }, [snap?.clip?.nodeId, snap?.phase, snap?.clip?.durationMs, snap?.clip?.mediaId, endPerformance])

  useEffect(() => {
    if (!auto || !snap) return
    const target = autoEmitTarget(snap)
    if (!target) return
    const t = setTimeout(() => setSnap(sessionRef.current!.emitEvent(target.elementId, target.key)), 700)
    return () => clearTimeout(t)
  }, [auto, snap?.currentNodeId, snap?.overlayMounts])

  const rootBlueprintId = rootBlueprintIdRef.current || mainBlueprintId
  const displayBlueprintId =
    viewMode === 'pinned' && pinnedBlueprintId
      ? pinnedBlueprintId
      : (snap?.activeBlueprintId ?? rootBlueprintId)
  const displayGraph =
    blueprints[displayBlueprintId]?.graph
    ?? blueprints[rootBlueprintId]?.graph
    ?? graph
  const activeNodeId = !snap
    ? null
    : displayBlueprintId === snap.activeBlueprintId
      ? snap.currentNodeId
      : deepestCallerOnBlueprint(snap.callStack, displayBlueprintId, snap.activeBlueprintId)
  const crumbs = snap
    ? blueprintBreadcrumbs(
      rootBlueprintId,
      blueprints[rootBlueprintId]?.title ?? rootBlueprintId,
      snap.callStack,
      snap.activeBlueprintId,
      blueprints[snap.activeBlueprintId]?.title ?? snap.activeBlueprintId,
    )
    : []
  const jumpFromBlueprint = (nodeId: string) => {
    const packNode = displayGraph.nodes.find((node) => node.id === nodeId)
    const packRef = packNode ? getSubFlowPack(packNode.data) : undefined
    if (
      viewMode === 'pinned'
      && displayBlueprintId !== snap?.activeBlueprintId
      && packRef
      && snap?.callStack.some((frame) => frame.callerNodeId === nodeId)
    ) {
      setViewMode('follow')
      setPinnedBlueprintId(undefined)
      return
    }
    setSnap(sessionRef.current!.jump(nodeId, {
      blueprintId: displayBlueprintId,
      graph: displayGraph,
    }))
    setViewMode('follow')
    setPinnedBlueprintId(undefined)
  }
  const traversed = useMemo(() => new Set(snap?.traversedEdgeIds ?? []), [snap?.traversedEdgeIds])
  // 打开蓝图浮层 / 进出自蓝图（含面包屑回看）时平移到高亮节点；同图内推进不抢视口。
  const revealNodeId = useRevealOnScopeChange(
    showBlueprint ? `${viewMode}:${displayBlueprintId}` : null,
    activeNodeId,
  )
  const executingGraph =
    (snap?.activeBlueprintId
      ? blueprints[snap.activeBlueprintId]?.graph
      : undefined)
    ?? blueprints[rootBlueprintId]?.graph
    ?? graph
  const currentNode = useMemo(
    () => executingGraph.nodes.find((n) => n.id === snap?.currentNodeId),
    [executingGraph, snap?.currentNodeId],
  )
  const rt = sessionRef.current?.runtime
  const skinCtx: SkinCtx | undefined = snap && rt
    ? {
        hud: snap.hud,
        condition: { state: rt.state, visited: rt.state.visited },
      }
    : snap
      ? { hud: snap.hud }
      : undefined

  const toolBtn = (on: boolean): CSSProperties => ({
    padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12,
    border: '1px solid ' + (on ? '#f08840' : 'rgba(255,255,255,0.14)'),
    background: on ? '#2f2923' : 'rgba(37,32,25,0.9)', color: '#e8eaed',
  })

  // 游戏 overlay 舞台 = 视频实际显示矩形（有黑边时锚在视频那块，不铺满容器）。
  return (
    <PlayerRootContext.Provider value={rootEl}>
    <div
      ref={rootRef}
      tabIndex={0}
      onPointerDown={() => claimPlayerFocus(rootRef.current)}
      onFocus={() => claimPlayerFocus(rootRef.current)}
      style={{ position: 'relative', width: '100%', height: '100%', background: '#000', overflow: 'hidden', outline: 'none' }}
    >
      {/* 演出画面 + 叠层：共享 runtime/play 的 GameStage（视频舞台锚定内容矩形，HUD/QTE/交互随视频走）。 */}
      <GameStage
        videoSrc={videoSrc}
        clip={snap?.clip}
        preloadVideos={preloadVideos}
        overlayMounts={snap?.overlayMounts ?? []}
        skins={skins ?? undefined}
        skinCtx={skinCtx}
        onEmit={(elementId, key) => { const s = sessionRef.current; if (s) setSnap(s.emitEvent(elementId, key)) }}
        onTick={(nowMs) => { const s = sessionRef.current; if (s) setSnap(s.tick(nowMs)) }}
        onPerformanceEnd={endPerformance}
        placeholder={snap ? (snap.clip?.name ?? '（无演出）') : '加载中…'}
      />

      {/* 控制条：右上角悬浮 */}
      <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 6, alignItems: 'center', padding: 4, borderRadius: 10, background: 'rgba(27,23,19,0.7)' }}>
        <button style={toolBtn(false)} onClick={() => setRestartKey((k) => k + 1)}>重开</button>
        <button style={toolBtn(auto)} onClick={() => setAuto((v) => !v)}>{auto ? '停止演示' : '自动演示'}</button>
        <button style={toolBtn(showLogs)} onClick={() => setShowLogs((v) => !v)}>日志</button>
        <button style={toolBtn(showBlueprint)} onClick={() => setShowBlueprint((v) => !v)}>蓝图</button>
      </div>

      {/* 蓝图浮层：可拖拽 + 可缩放，复用 GraphCanvas */}
      {showBlueprint && (
        <DraggablePanel
          title={(
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span>蓝图状态机 · {viewMode === 'follow' ? '跟随执行' : '回看'}</span>
              {crumbs.length > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0, overflow: 'hidden' }}>
                  {crumbs.map((crumb, index) => (
                    <span key={crumb.blueprintId} style={{ display: 'contents' }}>
                      {index > 0 && <span style={{ color: '#697386' }}>›</span>}
                      <button
                        title={`查看${crumb.title}`}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => {
                          if (crumb.blueprintId === snap?.activeBlueprintId) {
                            setViewMode('follow')
                            setPinnedBlueprintId(undefined)
                          } else {
                            setViewMode('pinned')
                            setPinnedBlueprintId(crumb.blueprintId)
                          }
                        }}
                        style={{ padding: 0, border: 'none', background: 'none', color: crumb.blueprintId === displayBlueprintId ? '#f5bd75' : '#aeb8c8', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}
                      >
                        {crumb.title}
                      </button>
                    </span>
                  ))}
                </span>
              )}
              {viewMode === 'pinned' && (
                <button
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    setViewMode('follow')
                    setPinnedBlueprintId(undefined)
                  }}
                  style={{ marginLeft: 'auto', padding: '2px 6px', borderRadius: 4, border: '1px solid #66513b', background: '#2f2923', color: '#f5bd75', cursor: 'pointer', fontSize: 11, whiteSpace: 'nowrap' }}
                >
                  跟随执行
                </button>
              )}
            </div>
          )}
          initial={{ x: 40, y: 56, w: 540, h: 420 }}
          onClose={() => setShowBlueprint(false)}
        >
          <GraphCanvas
            graph={displayGraph}
            onChange={() => {}}
            overlays={overlays}
            activeNodeId={activeNodeId}
            traversedEdgeIds={displayBlueprintId === snap?.activeBlueprintId ? traversed : undefined}
            revealNodeId={revealNodeId}
            onJump={jumpFromBlueprint}
            readOnly
          />
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
