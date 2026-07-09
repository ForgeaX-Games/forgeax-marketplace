/**
 * GraphStudio —— 调试用「编辑 + 试玩 + 运行时可视化」一体表面。
 *
 * 左：可编辑蓝图画布（GraphCanvas），实时高亮当前执行节点 + 点亮已走边，点节点可 jump。
 * 右：试玩面板（演出/HUD/交互/结局），与画布共享**同一个 GraphSession**，所以执行到哪、画布就亮哪。
 * 编辑图后点「重开」用最新图重建 session。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameGraph, GameScenario } from '../graph-schema'
import { GraphSession, type SessionSnapshot } from '../session'
import { GraphCanvas } from './GraphCanvas'
import { NodeInspector } from './NodeInspector'
import { VersionPicker } from './VersionPicker'
import { registerCoreRenderers, renderInteraction, renderOverlay } from './rendererRegistry'
import { registerCoreSkins } from './skins'
import { useGraphScenario } from '../graphScenarioStore'
import { listVideoAssets, resolveMediaSrc } from './media'
import { addNode } from '../graph-edit'
import type { GameNode } from '../graph-schema'

/** 工具条暖色皮肤（对齐旧 gc- 目录风格）。 */
function ensureToolbarStyle(): void {
  if (typeof document === 'undefined' || document.getElementById('gv-graph-toolbar-style')) return
  const s = document.createElement('style')
  s.id = 'gv-graph-toolbar-style'
  s.textContent = `
    .gv-graph-toolbar{background:#1b1713;border-bottom:1px solid #2e2924;color:#f6f1e9}
    .gv-graph-toolbar button,.gv-graph-toolbar select{background:#252019;border:1px solid #403830;color:#f6f1e9;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
    .gv-graph-toolbar button:hover,.gv-graph-toolbar select:hover{background:#2f2923;border-color:#f08840}
  `
  document.head.appendChild(s)
}

/** 子流程成员：从 subFlowRef 入口沿出边 BFS 可达的节点集合（返回靠 callStack，不经边回主流，故止于子流程内）。 */
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

export function GraphStudio({ scenario }: { scenario: GameScenario }): JSX.Element {
  registerCoreRenderers()
  registerCoreSkins()
  ensureToolbarStyle()
  const game = useMemo(() => new URLSearchParams(location.search).get('game') ?? 'game-nodia-fighting', [])

  // 共享场景 store（蓝图/实体/变量/规则/场景/试玩 并行视图共用同一份 graph+meta+持久化）。
  const graph = useGraphScenario((s) => s.graph)
  const isDraft = useGraphScenario((s) => s.isDraft)
  const savedTip = useGraphScenario((s) => s.savedTip)
  const fitSignal = useGraphScenario((s) => s.fitSignal)
  const runKey = useGraphScenario((s) => s.runKey)
  const setGraph = useGraphScenario((s) => s.setGraph)
  const ensureBoot = useGraphScenario((s) => s.ensureBoot)
  const doSave = useGraphScenario((s) => s.save)
  const reset = useGraphScenario((s) => s.reset)
  const applyLayout = useGraphScenario((s) => s.applyLayout)
  const bumpRun = useGraphScenario((s) => s.bumpRun)

  // 选中节点走共享 store（视频/界面等其它视图据此编辑同一节点）。
  const selected = useGraphScenario((s) => s.selectedNodeId)
  const setSelected = useGraphScenario((s) => s.setSelectedNode)
  const [playOpen, setPlayOpen] = useState(false)
  const [videoOptions, setVideoOptions] = useState<string[]>([])

  useEffect(() => { ensureBoot(game, scenario) }, [game, scenario, ensureBoot])
  useEffect(() => { void listVideoAssets(game).then(setVideoOptions) }, [game])

  const resetToDemo = () => {
    if (!confirm('重置为内置 demo 数据？当前未保存的编辑将丢失。')) return
    reset()
    setSelected(null)
  }
  const addPerfNode = () => {
    const id = `n-${Date.now().toString(36)}`
    const node: GameNode = {
      id,
      type: 'perf',
      position: { x: 40 + Math.random() * 80, y: 40 + Math.random() * 80 },
      inputs: [],
      outputs: [],
      data: { name: '新演出节点', timeline: [] },
    }
    setGraph((g) => addNode(g, node))
    setSelected(id)
  }

  const session = useMemo(
    () => new GraphSession(useGraphScenario.getState().scn()),
    // 仅在「重开」时重建（runKey 变），编辑图时不打断当前试玩
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey],
  )
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [snap, setSnap] = useState<SessionSnapshot>(() => session.start())

  useEffect(() => {
    setSnap(sessionRef.current.start())
  }, [session])

  const videoSrc = resolveMediaSrc(snap.clip?.mediaId, game)
  useEffect(() => {
    // 演出时长 durationMs 到点推进（视频作为视觉，到时被切；video onEnded 也会推进，取先到者）。
    if (snap.interaction || snap.phase === 'ended' || !snap.clip?.durationMs) return
    const t = setTimeout(() => setSnap(sessionRef.current.performanceEnd()), snap.clip.durationMs)
    return () => clearTimeout(t)
  }, [snap.clip?.nodeId, snap.interaction, snap.phase, snap.clip?.durationMs])

  useEffect(() => {
    // 限时交互 timeoutMs：到点自动 submit(undefined) → 走 defaultKey / 缺省出口。
    const inter = snap.interaction
    if (!inter?.timeoutMs) return
    const t = setTimeout(() => setSnap(sessionRef.current.submit(undefined)), inter.timeoutMs)
    return () => clearTimeout(t)
  }, [snap.interaction?.elementId, snap.interaction?.timeoutMs])

  const submit = (input: unknown) => setSnap(sessionRef.current.submit(input))
  const jump = useCallback((nodeId: string) => setSnap(sessionRef.current.jump(nodeId)), [])
  const traversed = useMemo(() => new Set(snap.traversedEdgeIds), [snap.traversedEdgeIds])
  const hudHidden = useMemo(() => new Set(snap.hudHidden), [snap.hudHidden])

  // 子流程下钻：drillStack 记录逐层进入的容器 id；顶层折叠所有子流程成员进各自容器。
  const [drillStack, setDrillStack] = useState<string[]>([])
  const visibleNodeIds = useMemo(() => {
    const containers = graph.nodes.filter((n) => n.data.subFlowRef)
    if (drillStack.length === 0) {
      const hidden = new Set<string>()
      for (const c of containers) for (const m of subflowMembers(graph, c.data.subFlowRef!)) hidden.add(m)
      return new Set(graph.nodes.map((n) => n.id).filter((id) => !hidden.has(id)))
    }
    const cid = drillStack[drillStack.length - 1]!
    const c = graph.nodes.find((n) => n.id === cid)
    return c?.data.subFlowRef ? subflowMembers(graph, c.data.subFlowRef) : new Set(graph.nodes.map((n) => n.id))
  }, [graph, drillStack])
  const nameOf = (id: string) => graph.nodes.find((n) => n.id === id)?.data.name ?? id

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0e0c09', color: '#f6f1e9' }}>
      {/* 顶部工具条（编辑动作） */}
      <div className="gv-graph-toolbar" style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={addPerfNode}>＋ 节点</button>
        <button onClick={doSave}>💾 保存</button>
        <VersionPicker />
        <button onClick={bumpRun}>▶ 重开</button>
        <button onClick={applyLayout} title="dagre 自动重排节点位置并框选">⤢ 自适应</button>
        <button onClick={resetToDemo} title="恢复为内置 demo 数据（丢弃当前未保存编辑）">↺ 重置</button>
        <button onClick={() => setPlayOpen((v) => !v)} title="显示/隐藏试玩浮层">{playOpen ? '▣ 隐藏试玩' : '▷ 显示试玩'}</button>
        <span style={{ opacity: 0.6, fontSize: 11 }}>{savedTip || `phase: ${snap.phase}`}</span>
      </div>

      {/* 主体：画布（含右上试玩浮层）+ 配置面板 */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {/* 左：可编辑画布 + 运行时高亮（点节点=选中编辑；双击子流程容器下钻） */}
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid #2e2924', position: 'relative' }}>
        {drillStack.length > 0 && (
          <div
            style={{
              position: 'absolute', top: 8, left: 8, zIndex: 5, display: 'flex', gap: 6, alignItems: 'center',
              padding: '4px 10px', borderRadius: 999, fontSize: 12, background: 'rgba(27,23,19,0.92)',
              border: '1px solid #403830', color: '#c9d1e0', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            <button onClick={() => setDrillStack([])} style={{ background: 'none', border: 'none', color: '#f08840', cursor: 'pointer', padding: 0 }}>根</button>
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
            <button onClick={() => setDrillStack(drillStack.slice(0, -1))} title="返回上一层" style={{ marginLeft: 4, color: '#c9d1e0', background: '#2a2d33', border: '1px solid #3a3d44', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>← 返回</button>
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
          graph={graph}
          onChange={setGraph}
          activeNodeId={snap.currentNodeId}
          traversedEdgeIds={traversed}
          visibleNodeIds={visibleNodeIds}
          fitSignal={fitSignal}
          onJump={setSelected}
          onDrill={(id) => setDrillStack((s) => [...s, id])}
          onPaneClick={() => setSelected(null)}
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
            <div style={{ position: 'relative', height: 180, background: '#000' }}>
              {videoSrc ? (
                <video
                  key={snap.clip?.nodeId}
                  src={videoSrc}
                  autoPlay
                  muted
                  playsInline
                  onEnded={() => setSnap(sessionRef.current.performanceEnd())}
                  onTimeUpdate={(e) => setSnap(sessionRef.current.tick(Math.floor(e.currentTarget.currentTime * 1000)))}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }}
                />
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.75, fontSize: 12 }}>
                  {snap.clip?.name ?? '（无演出）'}
                </div>
              )}
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {snap.overlays.map((o, i) => (
                  <span key={`${o.elementId}-${i}`} style={{ display: 'contents' }}>{renderOverlay(o)}</span>
                ))}
              </div>
              {snap.banner && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, background: 'rgba(0,0,0,0.6)' }}>
                  {snap.banner.kind === 'victory' ? '胜利' : snap.banner.kind === 'defeat' ? '失败' : '结束'}
                </div>
              )}
              {snap.interaction && (
                <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0 }}>{renderInteraction(snap.interaction, submit, { hud: snap.hud })}</div>
              )}
            </div>
            <div style={{ padding: 8, borderTop: '1px solid #2e2924', fontSize: 12, background: '#121316' }}>
              {Object.entries(snap.hud.entities).filter(([id]) => !hudHidden.has(id)).map(([id, e]) => {
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
                {Object.entries(snap.hud.vars).filter(([k]) => !hudHidden.has(k)).map(([k, v]) => (
                  <span key={k} style={{ padding: '1px 8px', background: '#2a2d33', borderRadius: 8 }}>{k} {v}</span>
                ))}
                {!hudHidden.has('score') && <span style={{ padding: '1px 8px', background: '#2a2d33', borderRadius: 8 }}>score {snap.hud.score}</span>}
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
            <NodeInspector graph={graph} nodeId={selected} videoOptions={videoOptions} onChange={setGraph} onJump={jump} />
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
