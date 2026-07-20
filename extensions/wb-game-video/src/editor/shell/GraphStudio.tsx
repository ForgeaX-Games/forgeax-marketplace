/**
 * GraphStudio —— 调试用「编辑 + 试玩 + 运行时可视化」一体表面。
 *
 * 左：可编辑蓝图画布（GraphCanvas），实时高亮当前执行节点 + 点亮已走边，点节点可 jump。
 * 右：试玩面板（演出/HUD/交互/结局），与画布共享**同一个 GraphSession**，所以执行到哪、画布就亮哪。
 * 编辑图后点「重开」用最新图重建 session。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameGraph, GameScenario, SubFlowPackDef } from '../../runtime/schema/graph-schema'
import { getSubFlowPack, getSubFlow } from '../../runtime/schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '../../runtime/engine/session'
import { GraphCanvas } from '../../graph/canvas/GraphCanvas'
import { NodeInspector, type VideoOption } from './NodeInspector'
import { VersionPicker } from './VersionPicker'
import { PlayerRootContext } from '../../runtime/skins/rendererRegistry'
import { claimPlayerFocus, releasePlayerFocus } from '../../runtime/input/playerFocus'
import { bootEditorSkins } from '../init'
import { VideoOverlayStage } from '../video/VideoOverlayStage'
import { useVideoContentRect } from '../video/useVideoContentRect'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { getGameSlug } from '../persist/gameScope'
import { dropOverlayIfUnreferenced } from '../../graph/edit/overlay-edit'
import { listVideoAssetInfos, resolveMediaSrc, videoDurationCapReached } from './media'
import { ZHANDOU_VIDEOS } from '../assets/catalog'
import { addNode, insertSubFlowPackAfter, makeEmptySubFlowPack, makeSubFlowPackContainer } from '../../graph/edit/graph-edit'
import type { GameNode } from '../../runtime/schema/graph-schema'
import { computeGraphLayout } from '../../graph/edit/graph-layout'

/** 工具条暖色皮肤（对齐旧 gc- 目录风格）。 */
function ensureToolbarStyle(): void {
  if (typeof document === 'undefined') return
  let s = document.getElementById('gv-graph-toolbar-style') as HTMLStyleElement | null
  if (!s) {
    s = document.createElement('style')
    s.id = 'gv-graph-toolbar-style'
    document.head.appendChild(s)
  }
  // 每次写回，避免 HMR 后旧 CSS 残留。
  s.textContent = `
    .gv-graph-toolbar{position:relative;z-index:2;flex-shrink:0;background:#1b1713;border-bottom:1px solid #2e2924;color:#f6f1e9}
    .gv-graph-toolbar button,.gv-graph-toolbar select{background:#252019;border:1px solid #403830;color:#f6f1e9;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
    .gv-graph-toolbar button:hover,.gv-graph-toolbar select:hover{background:#2f2923;border-color:#f08840}
  `
}

/** 子流程成员：从 subFlow 入口沿出边 BFS 可达的节点集合（返回靠 callStack，不经边回主流，故止于子流程内）。 */
function subflowMembers(graph: GameGraph, entryId: string): Set<string> {
  const adj = new Map<string, string[]>()
  for (const e of graph.edges) {
    const list = adj.get(e.source) ?? []
    list.push(e.target)
    adj.set(e.source, list)
  }
  const seen = new Set<string>([entryId])
  const queue = [entryId]
  while (queue.length > 0) {
    const u = queue.shift()!
    for (const v of adj.get(u) ?? []) if (!seen.has(v)) { seen.add(v); queue.push(v) }
  }
  return seen
}

/** Zustand selector 稳定空引用，避免 `?? []` / `?? {}` 每次新建导致无限重渲染。 */
const EMPTY_PACKS: readonly SubFlowPackDef[] = []
const EMPTY_GRAPH: GameGraph = { nodes: [], edges: [] }

export function GraphStudio({ scenario }: { scenario: GameScenario }): JSX.Element {
  bootEditorSkins()
  ensureToolbarStyle()
  // 宿主 iframe 传 `?slug=`（见 gameScope.ts）；勿只读 `?game=`，否则会落到默认 demo 命名空间。
  const game = useMemo(() => getGameSlug() ?? 'game-nodia-fighting', [])
  const playRootRef = useRef<HTMLDivElement | null>(null)
  const [playRootEl, setPlayRootEl] = useState<HTMLElement | null>(null)
  const bindPlayRoot = (el: HTMLDivElement | null) => {
    playRootRef.current = el
    setPlayRootEl(el)
    if (el) claimPlayerFocus(el)
    else releasePlayerFocus(playRootEl)
  }

  // 共享场景 store（蓝图/实体/变量/规则/场景/试玩 并行视图共用同一份 graph+meta+持久化）。
  const graph = useGraphScenario((s) => s.graph)
  const isDraft = useGraphScenario((s) => s.isDraft)
  const savedTip = useGraphScenario((s) => s.savedTip)
  const fitSignal = useGraphScenario((s) => s.fitSignal)
  const runKey = useGraphScenario((s) => s.runKey)
  const setGraph = useGraphScenario((s) => s.setGraph)
  const setMeta = useGraphScenario((s) => s.setMeta)
  const packs = useGraphScenario((s) => s.meta.packs ?? EMPTY_PACKS)
  const overlays = useGraphScenario((s) => s.meta.ui?.overlays)
  const entities = useGraphScenario((s) => s.meta.entities)
  const variables = useGraphScenario((s) => s.meta.variables)
  const ensureBoot = useGraphScenario((s) => s.ensureBoot)
  const doSave = useGraphScenario((s) => s.save)
  const reset = useGraphScenario((s) => s.reset)
  const applyLayout = useGraphScenario((s) => s.applyLayout)
  const bumpRun = useGraphScenario((s) => s.bumpRun)

  // 选中节点走共享 store（视频/界面等其它视图据此编辑同一节点）。
  const selected = useGraphScenario((s) => s.selectedNodeId)
  const setSelected = useGraphScenario((s) => s.setSelectedNode)
  const [playOpen, setPlayOpen] = useState(false)
  const [videoOptions, setVideoOptions] = useState<VideoOption[]>([])

  useEffect(() => { ensureBoot(game, scenario) }, [game, scenario, ensureBoot])
  // 视频下拉 = 视频 tab 同源：内置 zhandou 包 + 共享素材层 registry。
  useEffect(() => {
    let alive = true
    void (async () => {
      const bundled: VideoOption[] = Object.keys(ZHANDOU_VIDEOS)
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({
          id,
          label: id.startsWith('narr-') ? `叙事 · ${id}` : `战斗 · ${id}`,
        }))
      const registry = await listVideoAssetInfos(game)
      if (!alive) return
      const seen = new Set(bundled.map((v) => v.id))
      const fromReg: VideoOption[] = []
      for (const a of registry) {
        if (seen.has(a.id)) continue
        seen.add(a.id)
        const name = a.label?.trim()
        fromReg.push({
          id: a.id,
          label: name && name !== a.id ? `素材 · ${name} (${a.id})` : `素材 · ${a.id}`,
        })
      }
      setVideoOptions([...bundled, ...fromReg])
    })()
    return () => { alive = false }
  }, [game])

  const setPacks = useCallback((next: SubFlowPackDef[]) => {
    setMeta((m) => ({ ...m, packs: next }))
  }, [setMeta])

  // 子流程下钻：drillStack = 当前编辑图上的容器栈；packDrill = 已进入的外部子蓝图。
  const [drillStack, setDrillStack] = useState<string[]>([])
  const [packDrill, setPackDrill] = useState<{ containerId: string; packId: string; version?: string } | null>(null)

  const findPack = useCallback((id: string, version?: string): SubFlowPackDef | undefined => {
    if (version) {
      const keyed = packs.find((p) => p.id === id && p.version === version)
      if (keyed) return keyed
    }
    return packs.find((p) => p.id === id)
  }, [packs])

  const activePack = packDrill ? findPack(packDrill.packId, packDrill.version) : undefined
  const canvasGraph: GameGraph = activePack?.graph ?? (packDrill ? EMPTY_GRAPH : graph)

  const setPackGraph = useCallback((g: GameGraph | ((prev: GameGraph) => GameGraph)) => {
    if (!packDrill) return
    setMeta((m) => {
      const list = m.packs ?? []
      return {
        ...m,
        packs: list.map((p) => {
          const match = p.id === packDrill.packId && (!packDrill.version || p.version === packDrill.version)
          if (!match) return p
          const next = typeof g === 'function' ? g(p.graph) : g
          return { ...p, graph: next }
        }),
      }
    })
  }, [packDrill, setMeta])

  const setCanvasGraph = useCallback((g: GameGraph | ((prev: GameGraph) => GameGraph)) => {
    if (packDrill) setPackGraph(g)
    else setGraph(g)
  }, [packDrill, setPackGraph, setGraph])

  const resetToDemo = () => {
    if (!confirm('重置为内置 demo 数据？当前未保存的编辑将丢失。')) return
    reset()
    setSelected(null)
    setPackDrill(null)
    setDrillStack([])
  }
  const addPerfNode = () => {
    const id = `n-${Date.now().toString(36)}`
    const node: GameNode = {
      id,
      type: 'perf',
      position: { x: 40 + Math.random() * 80, y: 40 + Math.random() * 80 },
      inputs: [],
      outputs: [],
      data: { name: '新演出节点' },
    }
    setCanvasGraph((g) => addNode(g, node))
    setSelected(id)
  }
  const addPackNode = () => {
    const pack = makeEmptySubFlowPack({ title: '子蓝图' })
    const container = makeSubFlowPackContainer(pack, { name: '子蓝图' })
    setPacks([...packs, pack])
    setGraph((g) => addNode(g, container))
    setSelected(container.id)
    setPackDrill(null)
    setDrillStack([])
  }
  const insertPackAfter = useCallback((nodeId: string) => {
    const { graph: next, nodeId: created, pack } = insertSubFlowPackAfter(graph, nodeId)
    if (next === graph) return
    setPacks([...packs, pack])
    setGraph(next)
    setSelected(created)
  }, [graph, packs, setGraph, setPacks, setSelected])
  const fitActiveLayout = () => {
    if (!packDrill) {
      applyLayout()
      return
    }
    setPackGraph((g) => {
      const pos = computeGraphLayout(g)
      return { ...g, nodes: g.nodes.map((n) => ({ ...n, position: pos[n.id] ?? n.position })) }
    })
  }

  // 实体键签名：草稿曾缺 entities 被回填后必须重建 session，否则 HUD bind 全空、血条永不出现。
  const entitySig = useGraphScenario((s) => {
    const e = s.meta.entities ?? s.demo?.entities
    return e ? Object.keys(e).sort().join(',') : ''
  })
  const session = useMemo(
    () => new GraphSession(useGraphScenario.getState().scn()),
    // runKey：手动重开；entitySig：实体从空→有时自动重建（不跟 graph 编辑走，免打断试玩）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey, entitySig],
  )
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [snap, setSnap] = useState<SessionSnapshot>(() => session.start())
  // overlay 舞台锚视频实际画面矩形（object-fit:contain），与 GraphPlaySurface/GraphPlayer 同源，避免有黑边时叠层错位。
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const { contentRect, recomputeRect } = useVideoContentRect(videoElRef, [snap.clip?.nodeId])

  useEffect(() => {
    setSnap(sessionRef.current.start())
  }, [session])

  const videoSrc = resolveMediaSrc(snap.clip?.mediaId, game)
  useEffect(() => {
    // 无视频：durationMs 到点推进（逻辑节拍节点）。
    // 有视频：durationMs 作播放时长上限，改由 <video> onTimeUpdate 处理（见 videoDurationCapReached）。
    if (snap.interaction || snap.phase === 'ended' || !snap.clip?.durationMs || snap.clip.mediaId) return
    const t = setTimeout(() => setSnap(sessionRef.current.performanceEnd()), snap.clip.durationMs)
    return () => clearTimeout(t)
  }, [snap.clip?.nodeId, snap.interaction, snap.phase, snap.clip?.durationMs, snap.clip?.mediaId])

  useEffect(() => {
    // 限时交互 timeoutMs：到点自动 submit(undefined) → 走 defaultEvent / 缺省出口。
    const inter = snap.interaction
    if (!inter?.timeoutMs) return
    const t = setTimeout(() => setSnap(sessionRef.current.submit(undefined)), inter.timeoutMs)
    return () => clearTimeout(t)
  }, [snap.interaction?.elementId, snap.interaction?.timeoutMs])

  const submit = (input: unknown) => setSnap(sessionRef.current.submit(input))
  const jump = useCallback((nodeId: string) => setSnap(sessionRef.current.jump(nodeId)), [])
  const traversed = useMemo(() => new Set(snap.traversedEdgeIds), [snap.traversedEdgeIds])

  const visibleNodeIds = useMemo(() => {
    const containers = canvasGraph.nodes.filter((n) => getSubFlow(n.data))
    if (drillStack.length === 0) {
      const hidden = new Set<string>()
      for (const c of containers) {
        const entry = getSubFlow(c.data)
        if (entry) for (const m of subflowMembers(canvasGraph, entry)) hidden.add(m)
      }
      return new Set(canvasGraph.nodes.map((n) => n.id).filter((id) => !hidden.has(id)))
    }
    const cid = drillStack[drillStack.length - 1]!
    const c = canvasGraph.nodes.find((n) => n.id === cid)
    const entry = c ? getSubFlow(c.data) : undefined
    return entry ? subflowMembers(canvasGraph, entry) : new Set(canvasGraph.nodes.map((n) => n.id))
  }, [canvasGraph, drillStack])

  const drillFitKey = useMemo(
    () => (packDrill ? `pack:${packDrill.containerId}:${packDrill.packId}` : `root:${drillStack.join('/')}`),
    [packDrill, drillStack],
  )

  const nameOf = (id: string) =>
    canvasGraph.nodes.find((n) => n.id === id)?.data.name
    ?? graph.nodes.find((n) => n.id === id)?.data.name
    ?? id

  const onDrill = (id: string) => {
    const n = canvasGraph.nodes.find((x) => x.id === id)
    if (!n) return
    const pack = getSubFlowPack(n.data)
    if (!packDrill && pack) {
      setPackDrill({ containerId: id, packId: pack.id, version: pack.version })
      setDrillStack([])
      setSelected(null)
      return
    }
    if (getSubFlow(n.data)) setDrillStack((s) => [...s, id])
  }

  const leaveToRoot = () => {
    setPackDrill(null)
    setDrillStack([])
    setSelected(null)
  }
  const leaveOneLevel = () => {
    if (drillStack.length > 0) {
      setDrillStack((s) => s.slice(0, -1))
      return
    }
    if (packDrill) {
      setPackDrill(null)
      setSelected(packDrill.containerId)
    }
  }
  const clearCanvasGraph = () => {
    if (canvasGraph.nodes.length === 0 && canvasGraph.edges.length === 0) return
    if (!confirm('清空当前画布的所有节点和连线？（其它数据如实体/变量/界面方案不受影响）')) return
    setCanvasGraph({ nodes: [], edges: [] })
    setSelected(null)
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0e0c09', color: '#f6f1e9', isolation: 'isolate' }}>
      {/* 顶部工具条：场景级动作（保存/版本/试玩），不含画布编辑手势 */}
      <div className="gv-graph-toolbar" style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={doSave}>💾 保存</button>
        <VersionPicker />
        <button type="button" onClick={bumpRun}>▶ 重开</button>
        <button type="button" onClick={resetToDemo} title="恢复为内置 demo 数据（丢弃当前未保存编辑）">↺ 重置</button>
        <button type="button" onClick={() => setPlayOpen((v) => !v)} title="显示/隐藏试玩浮层">{playOpen ? '▣ 隐藏试玩' : '▷ 显示试玩'}</button>
        <button type="button" onClick={clearCanvasGraph} title="清空当前画布的所有节点和连线">🗑 清空</button>
        <span style={{ opacity: 0.6, fontSize: 11 }}>{savedTip || `phase: ${snap.phase}`}</span>
      </div>

      {/* 主体：画布命中区必须裁在本层内（WebKit 上 RF transform 层会把 hit-test 渗到工具条） */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative', zIndex: 0, overflow: 'hidden', isolation: 'isolate' }}>
      {/* 左：可编辑画布 + 运行时高亮（点节点=选中编辑；双击子流程容器下钻） */}
      <div className="gv-canvas-host" style={{ flex: 1, minWidth: 0, borderRight: '1px solid #2e2924', position: 'relative', overflow: 'hidden', contain: 'paint' }}>
        {(packDrill || drillStack.length > 0) && (
          <div
            style={{
              position: 'absolute', top: 8, left: 8, zIndex: 5, display: 'flex', gap: 6, alignItems: 'center',
              padding: '4px 10px', borderRadius: 999, fontSize: 12, background: 'rgba(27,23,19,0.92)',
              border: '1px solid #403830', color: '#c9d1e0', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            <button onClick={leaveToRoot} style={{ background: 'none', border: 'none', color: '#f08840', cursor: 'pointer', padding: 0 }}>根</button>
            {packDrill && (
              <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ opacity: 0.5 }}>›</span>
                <button
                  onClick={() => { setDrillStack([]); setSelected(null) }}
                  style={{ background: 'none', border: 'none', color: drillStack.length === 0 ? '#e8eaed' : '#f08840', cursor: 'pointer', padding: 0, fontWeight: drillStack.length === 0 ? 700 : 400 }}
                >
                  {nameOf(packDrill.containerId)}·子蓝图
                </button>
              </span>
            )}
            {drillStack.map((id, i) => (
              <span key={id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ opacity: 0.5 }}>›</span>
                <button
                  onClick={() => setDrillStack(drillStack.slice(0, i + 1))}
                  style={{ background: 'none', border: 'none', color: i === drillStack.length - 1 ? '#e8eaed' : '#f08840', cursor: 'pointer', padding: 0, fontWeight: i === drillStack.length - 1 ? 700 : 400 }}
                >
                  {nameOf(id)}
                </button>
              </span>
            ))}
            <button onClick={leaveOneLevel} title="返回上一层" style={{ marginLeft: 4, color: '#c9d1e0', background: '#2a2d33', border: '1px solid #3a3d44', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>← 返回</button>
          </div>
        )}
        {isDraft && (
          <div
            title="当前显示的是未保存草稿（scenarios.graph.draft.json），尚未写入权威 scenarios.graph.json。点右侧「💾 保存」提交。"
            style={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 5,
              padding: '4px 12px',
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 600,
              color: '#3a2a00',
              background: '#ffc53d',
              border: '1px solid #d48806',
              boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            ⚠ 当前为未保存草稿
          </div>
        )}
        <GraphCanvas
          graph={canvasGraph}
          onChange={setCanvasGraph}
          overlays={overlays}
          activeNodeId={snap.currentNodeId}
          traversedEdgeIds={traversed}
          visibleNodeIds={visibleNodeIds}
          fitSignal={fitSignal}
          drillFitKey={drillFitKey}
          onJump={setSelected}
          onDrill={onDrill}
          onPaneClick={() => setSelected(null)}
          onAddNode={addPerfNode}
          onAddPackNode={packDrill ? undefined : addPackNode}
          onInsertPackAfter={packDrill ? undefined : insertPackAfter}
          onFitLayout={fitActiveLayout}
        />

        {/* 试玩浮层：画布右上角（原独立试玩面板搬来） */}
        {playOpen && (
          <div style={{ position: 'absolute', top: 8, right: 8, width: 320, zIndex: 6, borderRadius: 10, overflow: 'hidden', border: '1px solid #403830', background: 'rgba(27,23,19,0.94)', boxShadow: '0 8px 28px rgba(0,0,0,0.55)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#252019', borderBottom: '1px solid #2e2924', fontSize: 11, color: '#c9d1e0' }}>
              <span>试玩 · {snap.phase}</span>
              <span style={{ display: 'flex', gap: 8 }}>
                <button onClick={bumpRun} title="重开" style={{ background: 'none', border: 'none', color: '#f08840', cursor: 'pointer', padding: 0 }}>▶ 重开</button>
                <button onClick={() => setPlayOpen(false)} title="隐藏" style={{ background: 'none', border: 'none', color: '#9aa2b1', cursor: 'pointer', padding: 0 }}>✕</button>
              </span>
            </div>
            <PlayerRootContext.Provider value={playRootEl}>
            <div
              ref={bindPlayRoot}
              tabIndex={0}
              onPointerDown={() => claimPlayerFocus(playRootRef.current)}
              onFocus={() => claimPlayerFocus(playRootRef.current)}
              style={{ position: 'relative', height: 180, background: '#000', outline: 'none' }}
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
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.75, fontSize: 12 }}>
                  {snap.clip?.name ?? '（无演出）'}
                </div>
              )}
              {/* overlay / 交互层锚视频实际画面矩形（VideoOverlayStage）；contentRect 为空时回退整容器（inset:0）。 */}
              <VideoOverlayStage contentRect={contentRect}>
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  {snap.overlayMounts.map((m) => (
                    <span key={m.mountId} style={{ display: 'contents' }}>
                      {session.skins.renderOverlayMount(
                        m,
                        (elementId, key) => setSnap(sessionRef.current.emitEvent(elementId, key)),
                        { hud: snap.hud },
                      )}
                    </span>
                  ))}
                </div>
                {snap.interaction && (
                  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    {session.skins.renderInteraction(snap.interaction, submit, {
                      hud: snap.hud,
                      condition: { state: session.runtime.state, visited: session.runtime.state.visited },
                    })}
                  </div>
                )}
              </VideoOverlayStage>
            </div>
            </PlayerRootContext.Provider>
            <div style={{ padding: 8, borderTop: '1px solid #2e2924', fontSize: 12, background: '#121316' }}>
              {Object.entries(snap.hud.entities).map(([id, e]) => {
                const ratio = e.maxHp > 0 ? Math.max(0, Math.min(1, e.hp / e.maxHp)) : 0
                const col = ratio > 0.5 ? '#22c55e' : ratio > 0.2 ? '#eab308' : '#ef4444'
                return (
                  <div key={id} style={{ marginBottom: 5 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.85 }}>
                      <span>{id}</span>
                      <span>{e.hp}/{e.maxHp}</span>
                    </div>
                    <div style={{ height: 6, background: '#2a2d33', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${ratio * 100}%`, height: '100%', background: col, transition: 'width .25s' }} />
                    </div>
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, opacity: 0.85, fontSize: 11 }}>
                {Object.entries(snap.hud.vars).map(([k, v]) => (
                  <span key={k} style={{ padding: '1px 8px', background: '#2a2d33', borderRadius: 8 }}>{k} {v}</span>
                ))}
                <span style={{ padding: '1px 8px', background: '#2a2d33', borderRadius: 8 }}>score {snap.hud.score}</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 右：节点配置面板 —— 默认隐藏，点画布节点才出现；✕ 或点画布空白处关闭 */}
      {selected && (
        <div style={{ width: 340, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #2e2924' }}>
          <div style={{ display: 'flex', gap: 4, padding: 6, borderBottom: '1px solid #2e2924', alignItems: 'center' }}>
            <b style={{ fontSize: 12 }}>节点配置</b>
            <button onClick={() => setSelected(null)} title="关闭" style={{ marginLeft: 'auto', color: '#9aa2b1', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            <NodeInspector
              graph={canvasGraph}
              nodeId={selected}
              videoOptions={videoOptions}
              packs={packs}
              overlays={overlays}
              entities={entities}
              variables={variables}
              onChange={setCanvasGraph}
              onPacksChange={setPacks}
              onDropOverlayIfOrphan={(oid) => {
                // 卸载已同步写入 store；用最新完整 scenario（主图 + 所有 packs）判断是否孤儿再清。
                const st = useGraphScenario.getState()
                const scn = st.scn()
                const cleaned = dropOverlayIfUnreferenced(scn, oid)
                if (cleaned !== scn) st.setScenario(cleaned)
              }}
              onJump={jump}
            />
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
