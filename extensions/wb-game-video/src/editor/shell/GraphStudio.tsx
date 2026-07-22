/**
 * GraphStudio —— 调试用「编辑 + 试玩 + 运行时可视化」一体表面。
 *
 * 左：可编辑蓝图画布（GraphCanvas），实时高亮当前执行节点 + 点亮已走边，点节点可 jump。
 * 右：试玩面板（演出/HUD/交互/结局），与画布共享**同一个 GraphSession**，所以执行到哪、画布就亮哪。
 * 编辑图后点「重开」用最新图重建 session。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GameGraph, GameScenario, SubFlowPackDef } from '../../runtime/schema/graph-schema'
import { getSubFlowPack, getSubFlow, resolveGraphEntry } from '../../runtime/schema/graph-schema'
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
import { useClipPerformanceEnd } from './useClipPerformanceEnd'
import { MissingVideoNotice } from './MissingVideoNotice'
import { ZHANDOU_VIDEOS } from '../assets/catalog'
import { addNode } from '../../graph/edit/graph-edit'
import type { GameNode } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import { docToPack, metaFromDocument, packToDoc } from '../persist/blueprint-project'
import { wouldCreateCycle } from '../../graph/edit/blueprint-refs'

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
  // 节点配置「引用蓝图」下拉：由 blueprints 派生为 SubFlowPackDef 列表（不落盘 packs）；
  // 含 main（子蓝图可引用主蓝图），自引用/成环由 isRefAllowed 过滤。
  const blueprints = useGraphScenario((s) => s.blueprints)
  const mainBlueprintId = useGraphScenario((s) => s.mainBlueprintId)
  const activeBlueprintId = useGraphScenario((s) => s.activeBlueprintId)
  const selectBlueprint = useGraphScenario((s) => s.selectBlueprint)
  const importBlueprint = useGraphScenario((s) => s.importBlueprint)
  const packs = useMemo(
    () => Object.values(blueprints).map(docToPack),
    [blueprints],
  )
  /** 某蓝图 id 能否被当前活跃蓝图引用：排除自引用 + 会成环的候选。传给 NodeInspector 的
   * 「子蓝图包」下拉，堵上画布「添加引用」按钮之外唯一还没成环校验的挂包路径。 */
  const isRefAllowed = useCallback(
    (packId: string) =>
      packId !== activeBlueprintId
      && !wouldCreateCycle(useGraphScenario.getState().authoringProject(), activeBlueprintId, packId),
    [activeBlueprintId],
  )
  const overlays = useGraphScenario((s) => s.meta.ui?.overlays)
  const entities = useGraphScenario((s) => s.meta.entities)
  const variables = useGraphScenario((s) => s.meta.variables)
  // meta.formulas 在 schema 里存为 `Record<string, unknown>`（runtime ↛ editor）；编辑器侧窄化回 Formula。
  const formulas = useGraphScenario((s) => s.meta.formulas) as Record<string, Formula> | undefined
  const ensureBoot = useGraphScenario((s) => s.ensureBoot)
  const doSave = useGraphScenario((s) => s.save)
  const reset = useGraphScenario((s) => s.reset)
  const applyLayout = useGraphScenario((s) => s.applyLayout)
  const bumpRun = useGraphScenario((s) => s.bumpRun)

  // 选中节点走共享 store（视频/界面等其它视图据此编辑同一节点）。
  const selected = useGraphScenario((s) => s.selectedNodeId)
  const setSelected = useGraphScenario((s) => s.setSelectedNode)
  const [playOpen, setPlayOpen] = useState(false)
  /** 「从此试玩」钉住的入口；浮层「重开」始终回到此节点（可随后沿边/事件前进）。 */
  const [playFromNodeId, setPlayFromNodeId] = useState<string | null>(null)
  /** 每次 start / 从此试玩 递增，强制 <video> remount——末节点同 id 再 jump 时否则 key 不变、播完不重开。 */
  const [playEpoch, setPlayEpoch] = useState(0)
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
      try {
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
      } catch {
        if (alive) {
          setVideoOptions(bundled)
        }
      }
    })()
    return () => { alive = false }
  }, [game])

  // NodeInspector 自己的「新建并挂载子蓝图」小机关（节点属性面板内，与画布「添加引用」按钮
  // 是两条不同的路：面板走这里只会新建全新子蓝图，天然不成环）。`onPacksChange` 契约是"给出
  // 完整下一份列表"（历史遗留，实际全部调用点只会追加恰好一个新建的包）；蓝图库改版后 packs
  // 由 blueprints 派生，这里按 id 差集把新增项各自落成一个子蓝图文档，已存在的 id 不重复导入。
  // 画布侧「引用已存在蓝图」的成环保护见下方 `addPackRef`（用 `wouldCreateCycle`）。
  const setPacks = useCallback((next: SubFlowPackDef[]) => {
    const cur = useGraphScenario.getState().blueprints
    for (const p of next) if (!cur[p.id]) importBlueprint(packToDoc(p))
  }, [importBlueprint])

  // 子流程下钻：drillStack = 当前编辑图上的同图子流程容器栈（subFlow，非 pack 引用）。
  const [drillStack, setDrillStack] = useState<string[]>([])

  const canvasGraph = graph
  const setCanvasGraph = setGraph

  const resetToDemo = () => {
    if (!confirm('重置为内置 demo 数据？当前未保存的编辑将丢失。')) return
    reset()
    setSelected(null)
    setDrillStack([])
  }
  const addPerfNode = (position: { x: number; y: number }) => {
    const id = `n-${Date.now().toString(36)}`
    const node: GameNode = {
      id,
      type: 'perf',
      position,
      inputs: [],
      outputs: [],
      data: { name: '新演出节点' },
    }
    setCanvasGraph((g) => addNode(g, node))
    setSelected(id)
  }
  /** 画布空白处「添加引用」：从蓝图库里挑一个既有蓝图接进来（不新建全新子蓝图），排除自己 +
   * 会成环的候选（`wouldCreateCycle`）。选中后插入一个 `subFlowPack` 引用容器节点。 */
  const addPackRef = (position: { x: number; y: number }) => {
    const proj = useGraphScenario.getState().authoringProject()
    const candidates = Object.values(blueprints).filter(
      (d) => d.id !== activeBlueprintId && !wouldCreateCycle(proj, activeBlueprintId, d.id),
    )
    if (candidates.length === 0) {
      alert('没有可引用的蓝图（或都会造成引用环）。先在左侧「＋ 新建蓝图」。')
      return
    }
    const pick = prompt(`引用哪张蓝图？输入编号：\n${candidates.map((d, i) => `${i}: ${d.title}`).join('\n')}`, '0')
    if (pick == null) return
    const chosen = candidates[Number(pick)]
    if (!chosen) return
    const container: GameNode = {
      id: `n-${Date.now().toString(36)}`,
      type: 'perf',
      position,
      inputs: [],
      outputs: [],
      data: {
        name: chosen.title,
        subFlowPack: { id: chosen.id, entry: resolveGraphEntry(chosen.graph, chosen.entry) ?? chosen.entry },
      },
    }
    setGraph((g) => addNode(g, container))
    setSelected(container.id)
  }

  // 实体键签名：草稿曾缺 entities 被回填后必须重建 session，否则 HUD bind 全空、血条永不出现。
  const entitySig = useGraphScenario((s) => {
    const e = s.meta.entities ?? s.demo?.entities
    return e ? Object.keys(e).sort().join(',') : ''
  })
  /**
   * 试玩 session 以**当前选中蓝图**为根（`playScn`），不是永远主蓝图——子蓝图可独立跑，
   * 「从此试玩」才能 jump 到该图节点。`playNonce`：从此试玩/钉住重开时强制吃最新图。
   */
  const [playNonce, setPlayNonce] = useState(0)
  const pendingJumpRef = useRef<string | null>(null)
  const session = useMemo(
    () => new GraphSession(useGraphScenario.getState().playScn()),
    // runKey：工具条整局重开；activeBlueprintId：切库；playNonce：从此试玩吃最新图
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey, entitySig, activeBlueprintId, playNonce],
  )
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [snap, setSnap] = useState<SessionSnapshot>(() => session.start())
  // overlay 舞台锚视频实际画面矩形（object-fit:contain），与 GraphPlaySurface/GraphPlayer 同源，避免有黑边时叠层错位。
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const { contentRect, recomputeRect } = useVideoContentRect(videoElRef, [snap.clip?.nodeId])
  // playEpoch：同节点 jump 重播时清闸（clip.nodeId 不变）
  const endPerformance = useClipPerformanceEnd(sessionRef, setSnap, snap.clip?.nodeId, `${runKey}:${playEpoch}`)

  // 切到另一张蓝图时清掉「从此试玩」钉住（节点 id 只在原图语义下有效）。
  useEffect(() => {
    setPlayFromNodeId(null)
  }, [activeBlueprintId])

  useEffect(() => {
    const jumpId = pendingJumpRef.current
    pendingJumpRef.current = null
    setSnap(jumpId ? sessionRef.current.jump(jumpId) : sessionRef.current.start())
    setPlayEpoch((n) => n + 1)
  }, [session])

  const videoSrc = resolveMediaSrc(snap.clip?.mediaId, game)
  const [missingVideoId, setMissingVideoId] = useState<string | null>(null)

  useEffect(() => {
    setMissingVideoId(null)
  }, [snap.clip?.nodeId, snap.clip?.mediaId, videoSrc])

  useEffect(() => {
    // 无视频：durationMs 到点推进（逻辑节拍节点）。
    // 有视频：durationMs 作播放时长上限，改由 <video> onTimeUpdate 处理（见 videoDurationCapReached）。
    if (snap.phase === 'ended' || !snap.clip?.durationMs || snap.clip.mediaId) return
    const t = setTimeout(() => endPerformance(), snap.clip.durationMs)
    return () => clearTimeout(t)
  }, [snap.clip?.nodeId, snap.phase, snap.clip?.durationMs, snap.clip?.mediaId, endPerformance])

  /** 从此试玩：钉住入口 + 打开浮层 + 以当前蓝图最新图重建 session 再 seek。 */
  const jump = useCallback((nodeId: string) => {
    setPlayFromNodeId(nodeId)
    setPlayOpen(true)
    pendingJumpRef.current = nodeId
    setPlayNonce((n) => n + 1)
  }, [])
  /** 浮层重开：回到钉住的入口节点；无钉住时回退整局 bumpRun。 */
  const restartPlayFrom = useCallback(() => {
    if (!playFromNodeId) {
      bumpRun()
      return
    }
    pendingJumpRef.current = playFromNodeId
    setPlayNonce((n) => n + 1)
  }, [playFromNodeId, bumpRun])
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

  const drillFitKey = useMemo(() => `root:${drillStack.join('/')}`, [drillStack])

  const nameOf = (id: string) => canvasGraph.nodes.find((n) => n.id === id)?.data.name ?? id

  /** 双击容器：跨蓝图引用（`subFlowPack`）→ 平级切库选中项（selectBlueprint），不是嵌套下钻；
   * 同图子流程（`subFlow`，非引用）仍原地下钻压栈。 */
  const onDrill = (id: string) => {
    const n = canvasGraph.nodes.find((x) => x.id === id)
    if (!n) return
    const pack = getSubFlowPack(n.data)
    if (pack) {
      selectBlueprint(pack.id)
      return
    }
    if (getSubFlow(n.data)) setDrillStack((s) => [...s, id])
  }

  const leaveToRoot = () => {
    setDrillStack([])
    setSelected(null)
  }
  const leaveOneLevel = () => {
    if (drillStack.length > 0) setDrillStack((s) => s.slice(0, -1))
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
        {drillStack.length > 0 && (
          <div
            style={{
              position: 'absolute', top: 8, left: 8, zIndex: 5, display: 'flex', gap: 6, alignItems: 'center',
              padding: '4px 10px', borderRadius: 999, fontSize: 12, background: 'rgba(27,23,19,0.92)',
              border: '1px solid #403830', color: '#c9d1e0', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            <button onClick={leaveToRoot} style={{ background: 'none', border: 'none', color: '#f08840', cursor: 'pointer', padding: 0 }}>根</button>
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
          // 试玩浮层宽 320 + 边距；传稳定 number，避免每帧新 object 触发反复 fitView。
          fitReserveRightPx={playOpen ? 340 : 0}
          onJump={setSelected}
          onDrill={onDrill}
          onPaneClick={() => setSelected(null)}
          onAddNode={addPerfNode}
          onAddPackNode={addPackRef}
          onFitLayout={applyLayout}
        />

        {/* 试玩浮层：画布右上角（原独立试玩面板搬来） */}
        {playOpen && (
          <div style={{ position: 'absolute', top: 8, right: 8, width: 320, zIndex: 6, borderRadius: 10, overflow: 'hidden', border: '1px solid #403830', background: 'rgba(27,23,19,0.94)', boxShadow: '0 8px 28px rgba(0,0,0,0.55)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#252019', borderBottom: '1px solid #2e2924', fontSize: 11, color: '#c9d1e0', gap: 8 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={snap.currentNodeId ? `${snap.phase} · ${nameOf(snap.currentNodeId)}` : snap.phase}>
                试玩 · {snap.phase}
                {snap.currentNodeId ? ` · ${snap.clip?.name || nameOf(snap.currentNodeId)}` : ''}
              </span>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button onClick={restartPlayFrom} title={playFromNodeId ? `重开 · 回到 ${nameOf(playFromNodeId)}` : '重开'} style={{ background: 'none', border: 'none', color: '#f08840', cursor: 'pointer', padding: 0 }}>▶ 重开</button>
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
                <>
                <video
                  key={`${snap.clip?.nodeId ?? 'clip'}-${playEpoch}`}
                  ref={videoElRef}
                  src={videoSrc}
                  autoPlay
                  muted
                  playsInline
                  loop={!!snap.clip?.loop}
                  onLoadedMetadata={() => {
                    setMissingVideoId(null)
                    recomputeRect()
                  }}
                  onError={() => {
                    if (snap.clip?.mediaId) {
                      setMissingVideoId(snap.clip.mediaId)
                    }
                  }}
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
                {missingVideoId ? (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.72)', padding: 12, zIndex: 2 }}>
                    <MissingVideoNotice resourceId={missingVideoId} />
                  </div>
                ) : null}
                </>
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.75, fontSize: 12 }}>
                  {snap.clip?.name ?? '（无演出）'}
                </div>
              )}
              {/* 全部叠层锚视频实际画面矩形（VideoOverlayStage）；contentRect 为空时回退整容器（inset:0）。 */}
              <VideoOverlayStage contentRect={contentRect}>
                <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  {snap.overlayMounts.map((m) => (
                    <span key={m.mountId} style={{ display: 'contents' }}>
                      {session.skins.renderOverlayMount(
                        m,
                        (elementId, key) => setSnap(sessionRef.current.emitEvent(elementId, key)),
                        {
                          hud: snap.hud,
                          condition: { state: session.runtime.state, visited: session.runtime.state.visited },
                        },
                      )}
                    </span>
                  ))}
                </div>
              </VideoOverlayStage>
            </div>
            </PlayerRootContext.Provider>
          </div>
        )}
      </div>

      {/* 右：节点配置面板 —— 默认隐藏，点画布节点才出现；✕ 或点画布空白处关闭 */}
      {selected && (
        <div style={{ width: 440, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #2e2924' }}>
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
              isRefAllowed={isRefAllowed}
              overlays={overlays}
              entities={entities}
              variables={variables}
              formulas={formulas}
              onChange={setCanvasGraph}
              onPacksChange={setPacks}
              onEnsureOverlay={(overlay) => {
                setMeta((m) => {
                  const cur = m.ui?.overlays ?? {}
                  if (cur[overlay.id]) return m
                  return { ...m, ui: { ...m.ui, overlays: { ...cur, [overlay.id]: overlay } } }
                })
              }}
              onDropOverlayIfOrphan={(oid) => {
                // 卸载已同步写入 store；用完整库文档（根 graph + manifest.packs）判孤儿后只改共享 meta。
                const st = useGraphScenario.getState()
                const scn = st.authoringScenario()
                const cleaned = dropOverlayIfUnreferenced(scn, oid)
                if (cleaned !== scn) st.setMeta(metaFromDocument(cleaned))
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
