/**
 * GraphStudio —— 调试用「编辑 + 试玩 + 运行时可视化」一体表面。
 *
 * 左：可编辑蓝图画布（GraphCanvas），实时高亮当前执行节点 + 点亮已走边，点节点可 jump。
 * 右：试玩面板（演出/HUD/交互/结局），与画布共享**同一个 GraphSession**，所以执行到哪、画布就亮哪。
 * 编辑图后可从节点「从此试玩」打开浮层；浮层内「重开」用最新图重建 session。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { GameGraph, GameScenario, SubFlowPackDef } from '../../runtime/schema/graph-schema'
import { getSubFlowPack, getSubProcess } from '../../runtime/schema/graph-schema'
import { GraphSession, type SessionSnapshot } from '../../runtime/engine/session'
import { GraphCanvas } from '../../graph/canvas/GraphCanvas'
import { NodeInspector, type VideoOption } from './NodeInspector'
import { createKinoAssetLibraryClient } from '../assets/assetLibraryClient'
import { useProjectAssets } from '../assets/projectAssetCacheStore'
import { audioAssetOptions } from './bgm-authoring'
import { NodePreviewStage } from './NodePreviewStage'
import { VersionPicker } from './VersionPicker'
import { PlayerRootContext } from '../../runtime/component-host/rendererRegistry'
import { claimPlayerFocus, releasePlayerFocus } from '../../runtime/input/playerFocus'
import { bootEditorSkins } from '../init'
import { BgmPlayer, GameStage, PlaybackClockProvider, useControlledPlaybackTimeout, VideoAudioToggle } from '../../runtime/play'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { getGameSlug } from '../persist/gameScope'
import { dropOverlayIfUnreferenced } from '../../graph/edit/overlay-edit'
import { removeMountGraph } from '../video/graphMaterialOps'
import { resolveMediaSrc } from './media'
import { useKinoVideoResources } from '../assets/kinoVideoCacheStore'
import { useClipPerformanceEnd, videoDurationCapReached, MissingVideoNotice } from '../../runtime/play'
import { addNode } from '../../graph/edit/graph-edit'
import type { GameNode } from '../../runtime/schema/graph-schema'
import type { Formula } from '../persist/formula-authoring'
import { docToPack, metaFromDocument, packToDoc } from '../persist/blueprint-project'
import { wouldCreateCycle } from '../../graph/edit/blueprint-refs'
import { useRevealOnScopeChange } from './useRevealOnScopeChange'
import {
  graphPathLabels, resolveGraphAtPath, resolveGraphEntryAtPath, updateGraphAtPath, validGraphPath,
} from '../../graph/edit/graph-scope'
import { computeGraphLayout } from '../../graph/edit/graph-layout'

interface PlayAnchor {
  nodeId: string
  blueprintId: string
  graphPath: string[]
}

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
    .gv-splitter{flex:none;width:5px;margin:0 -1px;cursor:col-resize;background:transparent;transition:background .12s;z-index:3}
    .gv-splitter:hover,.gv-splitter.is-drag{background:rgba(240,136,64,.4)}
  `
}

/** 节点面板分栏：默认预览占 60%，拖拽后记住像素宽度；表单保持可操作的最小宽度。 */
const PREVIEW_W_KEY = 'wb-game-video.nodePanel.previewW'
const PREVIEW_W_MIN = 340
const FORM_W_MIN = 280
const SPLITTER_W = 5
const PREVIEW_OPEN_KEY = 'wb-game-video.nodePanel.previewOpen'

const kinoAssetLibraryClient = createKinoAssetLibraryClient()

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
  const fitSignal = useGraphScenario((s) => s.fitSignal)
  const loadEpoch = useGraphScenario((s) => s.loadEpoch)
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
  // 保存 = 打版本：一次性存 blueprint + 组件（服务端钩子）+ git tag vN。
  const doCommit = useGraphScenario((s) => s.commit)
  const reset = useGraphScenario((s) => s.reset)
  const bumpRun = useGraphScenario((s) => s.bumpRun)

  // 选中节点走共享 store（视频/界面等其它视图据此编辑同一节点）。
  const selected = useGraphScenario((s) => s.selectedNodeId)
  const setSelected = useGraphScenario((s) => s.setSelectedNode)
  // 节点配置面板：预览台选中的挂载覆盖物 id（联动右侧表单聚焦该卡片）；换节点自动清空。
  const [focusedMountId, setFocusedMountId] = useState<string | null>(null)
  // 节点配置面板：时间轴上选中的生命周期效果（子集序号，见 isLifecycleReaction 注释）。
  const [focusedLifecycleIndex, setFocusedLifecycleIndex] = useState<number | null>(null)
  useEffect(() => { setFocusedMountId(null); setFocusedLifecycleIndex(null) }, [selected])
  // 面板里同一时刻只该有一个聚焦对象：选覆盖物就松开效果，反之亦然。
  const focusMount = useCallback((id: string | null) => {
    setFocusedMountId(id)
    if (id != null) setFocusedLifecycleIndex(null)
  }, [])
  const focusLifecycle = useCallback((index: number | null) => {
    setFocusedLifecycleIndex(index)
    if (index != null) setFocusedMountId(null)
  }, [])
  // 节点配置面板：左侧预览区宽度（px，可拖调，localStorage 记忆）。
  const [previewW, setPreviewW] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    const v = Number(window.localStorage.getItem(PREVIEW_W_KEY))
    return Number.isFinite(v) && v >= PREVIEW_W_MIN ? v : null
  })
  // 已有节点间切换沿用上次状态并跨会话记忆；只有新建节点时强制收起（见 addPerfNode）。
  const [previewOpen, setPreviewOpen] = useState(
    () => typeof window !== 'undefined' && window.localStorage.getItem(PREVIEW_OPEN_KEY) === '1',
  )
  const setPreviewOpenPersisted = useCallback((open: boolean) => {
    setPreviewOpen(open)
    if (typeof window !== 'undefined') window.localStorage.setItem(PREVIEW_OPEN_KEY, open ? '1' : '0')
  }, [])
  const togglePreview = useCallback(() => {
    setPreviewOpen((open) => {
      const next = !open
      if (typeof window !== 'undefined') window.localStorage.setItem(PREVIEW_OPEN_KEY, next ? '1' : '0')
      return next
    })
  }, [])
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [panelW, setPanelW] = useState(0)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const [playOpen, setPlayOpen] = useState(false)
  const [videoAudioEnabled, setVideoAudioEnabled] = useState(false)
  /** 「从此试玩」钉住的入口；浮层「重开」始终回到此节点（可随后沿边/事件前进）。 */
  const [playFrom, setPlayFrom] = useState<PlayAnchor | null>(null)
  /** 每次 start / 从此试玩 递增，强制 <video> remount——末节点同 id 再 jump 时否则 key 不变、播完不重开。 */
  const [playEpoch, setPlayEpoch] = useState(0)
  /**
   * 只随 session 重建递增，用来重挂 `BgmPlayer`。新会话的 `bgm` 快照从 `null` 起，而「还没发过
   * 指令」不是停播令（见 SessionSnapshot.bgm）——不重挂就会把上一局的曲子拖进新局。
   * 刻意**不**复用 `playEpoch`：那个还会在画布 jump 时递增，跟着重挂会让床轨每次点节点都从头起播。
   */
  const [bgmRunKey, setBgmRunKey] = useState(0)
  const [videoOptions, setVideoOptions] = useState<VideoOption[]>([])
  const [videoOptionsError, setVideoOptionsError] = useState<string | null>(null)
  const kinoResources = useKinoVideoResources(game)
  // 节点面板「音乐」下拉候选（与「视频」同款）：Kino media_type=audio，展示形状在壳层拼。
  const audio = useProjectAssets(game, 'audio', kinoAssetLibraryClient)
  const audioOptions = useMemo(() => audioAssetOptions(audio.items), [audio.items])

  useEffect(() => { ensureBoot(game, scenario) }, [game, scenario, ensureBoot])
  useEffect(() => {
    const seen = new Set<string>()
    const kino: VideoOption[] = []
    for (const resource of kinoResources.items) {
      if (seen.has(resource.resource_id)) continue
      seen.add(resource.resource_id)
      kino.push({
        id: resource.resource_id,
        label: resource.name?.trim() || resource.resource_id,
      })
    }
    setVideoOptions(kino)
    setVideoOptionsError(kinoResources.error)
  }, [kinoResources.error, kinoResources.items])

  // NodeInspector「新建并挂载子蓝图」：`onPacksChange` 契约是"给出完整下一份列表"（历史遗留，
  // 实际全部调用点只会追加恰好一个新建的包）；蓝图库改版后 packs 由 blueprints 派生，这里按 id
  // 差集把新增项各自落成一个子蓝图文档，已存在的 id 不重复导入。
  const setPacks = useCallback((next: SubFlowPackDef[]) => {
    const cur = useGraphScenario.getState().blueprints
    for (const p of next) if (!cur[p.id]) importBlueprint(packToDoc(p))
  }, [importBlueprint])

  // 子流程下钻：每一段是当前层直属 subProcess 容器 id。
  const [drillStack, setDrillStack] = useState<string[]>([])
  const [layoutEpoch, setLayoutEpoch] = useState(0)

  const canvasGraph = useMemo(() => resolveGraphAtPath(graph, drillStack) ?? graph, [graph, drillStack])
  const canvasEntryId = useMemo(
    () => resolveGraphEntryAtPath(graph, blueprints[activeBlueprintId]?.entry, drillStack),
    [graph, blueprints, activeBlueprintId, drillStack],
  )
  const setCanvasGraph = useCallback(
    (update: GameGraph | ((current: GameGraph) => GameGraph)) => {
      setGraph((root) => {
        const current = resolveGraphAtPath(root, drillStack)
        if (!current) return root
        const next = typeof update === 'function' ? update(current) : update
        const entry = resolveGraphEntryAtPath(root, blueprints[activeBlueprintId]?.entry, drillStack)
        if (entry && current.nodes.some((node) => node.id === entry) && next.nodes.length === 0) {
          alert('入口是当前图唯一的业务节点，不能删除。')
          return root
        }
        return updateGraphAtPath(root, drillStack, next)
      })
    },
    [setGraph, drillStack, blueprints, activeBlueprintId],
  )
  const applyCanvasLayout = useCallback(() => {
    setCanvasGraph((current) => {
      const positions = computeGraphLayout(current)
      return {
        ...current,
        nodes: current.nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
      }
    })
    setLayoutEpoch((value) => value + 1)
  }, [setCanvasGraph])

  useEffect(() => {
    setDrillStack([])
  }, [activeBlueprintId, loadEpoch])

  // 撤销删除祖先容器后，路径必须回到仍然存在的最长前缀。
  useEffect(() => {
    setDrillStack((path) => {
      const valid = validGraphPath(graph, path)
      return valid.length === path.length ? path : valid
    })
  }, [graph])

  // ── 节点配置面板 · 左侧预览台（NodePreviewStage）──────────────────────────
  const selectedNode = useMemo(
    () => canvasGraph.nodes.find((n) => n.id === selected) ?? null,
    [canvasGraph, selected],
  )
  const selectedCanConfigurePerformance = !!selectedNode
    && !getSubProcess(selectedNode.data)
    && !getSubFlowPack(selectedNode.data)
  const effectivePreviewOpen = previewOpen && selectedCanConfigurePerformance
  /** 预览台读投影场景：canvasGraph（下钻时为包内图）+ 目录 overlays + 实体/变量（meta 缺省回落 demo）。 */
  const previewScenario = useMemo<GameScenario>(
    () => ({
      version: 'wb-game-video.graph.v1',
      graph: canvasGraph,
      ui: { overlays: overlays ?? scenario.ui?.overlays ?? {} },
      entities: entities ?? scenario.entities,
      variables: variables ?? scenario.variables,
    }),
    [canvasGraph, overlays, entities, variables, scenario],
  )
  /**
   * 预览台写回通道：authoringScenario 的 graph 是主蓝图，换成当前选中蓝图图（st.graph）再交给
   * 编辑函数；setScenario 把 graph 写回 activeBlueprintId、meta 字段浅合并（与 GraphVideoView 同款）。
   */
  const editPreviewScenario = useCallback(
    (fn: (s: GameScenario, n: GameNode) => GameScenario) => {
      const st = useGraphScenario.getState()
      const s: GameScenario = { ...st.authoringScenario(), graph: canvasGraph }
      const n = s.graph.nodes.find((x) => x.id === selected)
      if (!n) return
      const next = fn(s, n)
      setCanvasGraph(next.graph)
      st.setMeta(metaFromDocument(next))
    },
    [canvasGraph, selected, setCanvasGraph],
  )
  /** 预览/表单分栏拖拽：pointer capture 跟踪横向位移，松手写回 localStorage。 */
  const startPreviewDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const el = e.currentTarget
      const startX = e.clientX
      const previewColumn = el.previousElementSibling as HTMLElement | null
      const startW = previewColumn?.getBoundingClientRect().width ?? previewW ?? PREVIEW_W_MIN
      const maxW = Math.max(PREVIEW_W_MIN, (panelRef.current?.clientWidth ?? 960) - FORM_W_MIN - SPLITTER_W)
      el.classList.add('is-drag')
      el.setPointerCapture(e.pointerId)
      const onMove = (ev: PointerEvent): void => {
        const next = Math.round(Math.max(PREVIEW_W_MIN, Math.min(maxW, startW + (ev.clientX - startX))))
        setPreviewW(next)
      }
      const onUp = (): void => {
        el.classList.remove('is-drag')
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerup', onUp)
        setPreviewW((w) => {
          if (typeof window !== 'undefined' && w != null) window.localStorage.setItem(PREVIEW_W_KEY, String(w))
          return w
        })
      }
      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerup', onUp)
    },
    [previewW],
  )
  // 面板实际宽度跟随测量（clamp 宽度 + 窗口缩放都会变），用于夹住预览区上限。
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setPanelW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [selected])
  // 画布容器宽度跟随测量，用于算 panelRatio（选中节点平移可见区偏移用）。
  useEffect(() => {
    const el = canvasHostRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setCanvasW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  /** 面板宽度 ÷ 画布容器宽度（0~1），传给 GraphCanvas 让选中节点平移到左侧可见区中心。 */
  const [canvasW, setCanvasW] = useState(0)
  const panelRatio = canvasW > 0 ? Math.min(0.8, panelW / canvasW) : 0

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
    // 新节点还没有预览内容，首次配置时只展示表单；后续手动展开会重新成为全局偏好。
    setPreviewOpenPersisted(false)
    setSelected(id)
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
  const [playPaused, setPlayPaused] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const pendingJumpRef = useRef<PlayAnchor | null>(null)
  const session = useMemo(
    () => {
      const st = useGraphScenario.getState()
      return new GraphSession(st.playScn(), { rootBlueprintId: st.activeBlueprintId })
    },
    // runKey：工具条整局重开；activeBlueprintId：切库；playNonce：从此试玩吃最新图
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runKey, entitySig, activeBlueprintId, playNonce],
  )
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [snap, setSnap] = useState<SessionSnapshot>(() => session.start())
  const playRootGraph = blueprints[snap.activeBlueprintId]?.graph
  const executingGraph = playRootGraph
    ? (resolveGraphAtPath(playRootGraph, snap.activeGraphPath) ?? playRootGraph)
    : canvasGraph
  const playGraph = playOpen ? executingGraph : canvasGraph
  // 试玩落进被引用的子蓝图时，画布改为只读执行视图；同图试玩仍保持原本的编辑/下钻体验。
  const showingForeignPlayGraph = playOpen && (
    snap.activeBlueprintId !== activeBlueprintId
    || snap.activeGraphPath.join('/') !== drillStack.join('/')
  )
  // 进/出子蓝图时把视口挪到当前播放节点；同图推进不抢手动平移。未试玩时仍用编辑选中 reveal。
  const playRevealNodeId = useRevealOnScopeChange(
    playOpen ? `${snap.activeBlueprintId}:${snap.activeGraphPath.join('/')}` : null,
    playOpen ? snap.currentNodeId : null,
  )
  // playEpoch：同节点 jump 重播时清闸（clip.nodeId 不变）
  const endPerformance = useClipPerformanceEnd(sessionRef, setSnap, snap.clip?.nodeId, `${runKey}:${playEpoch}`)

  // 切到另一张蓝图时清掉「从此试玩」钉住（节点 id 只在原图语义下有效）。
  useEffect(() => {
    setPlayFrom(null)
  }, [activeBlueprintId])

  useEffect(() => {
    const pending = pendingJumpRef.current
    pendingJumpRef.current = null
    const latestRoot = pending ? useGraphScenario.getState().blueprints[pending.blueprintId]?.graph : undefined
    const targetGraph = latestRoot && pending
      ? (resolveGraphAtPath(latestRoot, pending.graphPath) ?? latestRoot)
      : undefined
    setSnap(pending ? sessionRef.current.jump(pending.nodeId, {
      resetGlobals: true,
      blueprintId: pending.blueprintId,
      graph: targetGraph,
      graphPath: pending.graphPath,
    }) : sessionRef.current.start())
    setPlayEpoch((n) => n + 1)
    setBgmRunKey((n) => n + 1)
  }, [session])

  const videoSrc = resolveMediaSrc(snap.clip?.mediaId, game)
  const preloadVideos = useMemo(
    () => session.preloadClips().map((candidate) => ({
      videoSrc: resolveMediaSrc(candidate.mediaId, game),
      clip: candidate,
      videoKey: `${candidate.nodeId}-${playEpoch}`,
    })),
    [session, snap.currentNodeId, game, playEpoch],
  )
  /** 床轨解析器（引擎只抛资产 id，URL 归壳层）；稳定引用，避免每帧让 BgmPlayer 重跑 effect。 */
  const resolveBgm = useCallback((id: string | undefined) => resolveMediaSrc(id, game), [game])

  useControlledPlaybackTimeout(
    endPerformance,
    snap.clip?.durationMs,
    { paused: playPaused, rate: playbackRate },
    snap.phase === 'ended' || !!snap.clip?.mediaId,
    `${runKey}:${playEpoch}:${snap.clip?.nodeId ?? ''}`,
  )

  /** 从此试玩：钉住入口 + 打开浮层 + 以当前蓝图最新图重建 session 再 seek。 */
  const jump = useCallback((nodeId: string) => {
    setPlayPaused(false)
    const anchor = { nodeId, blueprintId: activeBlueprintId, graphPath: [...drillStack] }
    setPlayFrom(anchor)
    setPlayOpen(true)
    pendingJumpRef.current = anchor
    setPlayNonce((n) => n + 1)
  }, [activeBlueprintId, drillStack])
  /** 浮层重开：回到钉住的入口节点；无钉住时回退整局 bumpRun。 */
  const restartPlayFrom = useCallback(() => {
    setPlayPaused(false)
    if (!playFrom) {
      bumpRun()
      return
    }
    pendingJumpRef.current = playFrom
    setPlayNonce((n) => n + 1)
  }, [playFrom, bumpRun])
  const traversed = useMemo(() => new Set(snap.traversedEdgeIds), [snap.traversedEdgeIds])

  const drillFitKey = useMemo(() => `root:${drillStack.join('/')}:${layoutEpoch}`, [drillStack, layoutEpoch])
  const drillLabels = useMemo(() => graphPathLabels(graph, drillStack), [graph, drillStack])

  // 下钻导航和「重开」锚点属于正在编辑的蓝图；试玩状态行才解析执行图节点。
  const playNameOf = (id: string) => playGraph.nodes.find((n) => n.id === id)?.data.name ?? id
  /** 双击容器：跨蓝图引用（`subFlowPack`）→ 平级切库选中项（selectBlueprint），不是嵌套下钻；
   * 私有内嵌子流程（`subProcess`）沿当前图路径下钻。 */
  const onDrill = (id: string) => {
    const n = canvasGraph.nodes.find((x) => x.id === id)
    if (!n) return
    const pack = getSubFlowPack(n.data)
    if (pack) {
      selectBlueprint(pack.id)
      return
    }
    if (getSubProcess(n.data)) {
      setSelected(null)
      setDrillStack((s) => [...s, id])
    }
  }

  const leaveToRoot = () => {
    setDrillStack([])
    setSelected(null)
  }
  const leaveOneLevel = () => {
    if (drillStack.length > 0) {
      setDrillStack((s) => s.slice(0, -1))
      setSelected(null)
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0e0c09', color: '#f6f1e9', isolation: 'isolate' }}>
      {/* 顶部工具条：历史版本 → 保存 → 重置 → 草稿提示，不含画布编辑手势 */}
      <div className="gv-graph-toolbar" style={{ padding: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <VersionPicker />
        <button type="button" onClick={() => void doCommit()} title="保存当前内容并打一个新版本（vN）">💾 保存</button>
        <button
          type="button"
          style={{ display: 'none' }}
          onClick={() => { if (confirm('重置为内置 demo 数据？当前未保存的编辑将丢失。')) reset() }}
          title="重置为内置 demo（丢弃当前未保存编辑）"
        >
          ↺ 重置
        </button>
        {isDraft ? (
          <span
            style={{ opacity: 0.85, fontSize: 12, color: '#ffc53d' }}
            title="当前显示的是未保存草稿，尚未写入权威版本。点「💾 保存」提交。"
          >
            ⚠ 未保存草稿
          </span>
        ) : null}
        {videoOptionsError ? (
          <span role="alert" style={{ color: '#ff8f8f', fontSize: 11 }}>
            Kino 视频素材加载失败：{videoOptionsError}
          </span>
        ) : null}
      </div>

      {/* 主体：画布命中区必须裁在本层内（WebKit 上 RF transform 层会把 hit-test 渗到工具条） */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative', zIndex: 0, overflow: 'hidden', isolation: 'isolate' }}>
      {/* 左：可编辑画布 + 运行时高亮（点节点=选中编辑；双击子流程容器下钻） */}
      <div ref={canvasHostRef} className="gv-canvas-host" style={{ flex: 1, minWidth: 0, borderRight: '1px solid #2e2924', position: 'relative', overflow: 'hidden', contain: 'paint' }}>
        {drillStack.length > 0 && (
          <div
            style={{
              position: 'absolute', top: 8, left: 8, zIndex: 5, display: 'flex', gap: 6, alignItems: 'center',
              padding: '4px 10px', borderRadius: 999, fontSize: 12, background: 'rgba(27,23,19,0.92)',
              border: '1px solid #403830', color: '#c9d1e0', boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            <button onClick={leaveToRoot} style={{ background: 'none', border: 'none', color: '#f08840', cursor: 'pointer', padding: 0 }}>根</button>
            {drillLabels.map((item, i) => (
              <span key={item.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ opacity: 0.5 }}>›</span>
                <button
                  onClick={() => setDrillStack(drillStack.slice(0, i + 1))}
                  style={{ background: 'none', border: 'none', color: i === drillStack.length - 1 ? '#e8eaed' : '#f08840', cursor: 'pointer', padding: 0, fontWeight: i === drillStack.length - 1 ? 700 : 400 }}
                >
                  {item.name}
                </button>
              </span>
            ))}
            <button onClick={leaveOneLevel} title="返回上一层" style={{ marginLeft: 4, color: '#c9d1e0', background: '#2a2d33', border: '1px solid #3a3d44', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>← 返回</button>
          </div>
        )}
        {isDraft && (
          <div
            title="当前显示的是 localStorage 未保存草稿，尚未写入权威 blueprint.json。点右侧「💾 保存」提交。"
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
          // 切蓝图 remount：清掉画布本地 selectedIds（store 已清 selectedNodeId，本地不跟会残留旧 id）。
          // 节点剪贴板在 GraphCanvas 模块级，不跟 remount 走，故主↔子蓝图可粘贴。
          key={`${activeBlueprintId}:${drillStack.join('/')}`}
          graph={playGraph}
          onChange={setCanvasGraph}
          entryNodeId={showingForeignPlayGraph ? undefined : canvasEntryId}
          overlays={overlays}
          // 试玩游标与编辑选中共用橙色描边；未开浮层时勿把 session 当前节点画成「选中」——
          // 新建子蓝图后 session.start() 停在「入口」，否则入口会像永远选不掉。
          activeNodeId={playOpen ? snap.currentNodeId : null}
          traversedEdgeIds={playOpen ? traversed : undefined}
          readOnly={showingForeignPlayGraph}
          // 配置面板打开时禁用 Delete/Backspace，避免作者改表单时误删当前节点；关闭后恢复。
          keyboardDeleteEnabled={!selected}
          fitSignal={fitSignal + layoutEpoch}
          drillFitKey={drillFitKey}
          // 试玩浮层宽 320 + 边距；传稳定 number，避免每帧新 object 触发反复 fitView。
          fitReserveRightPx={playOpen ? 340 : 0}
          revealNodeId={playRevealNodeId ?? selected}
          revealPanelRatio={panelRatio}
          onJump={(nodeId) => {
            if (!showingForeignPlayGraph) {
              setSelected(nodeId)
              return
            }
            setSnap(sessionRef.current.jump(nodeId, {
              blueprintId: snap.activeBlueprintId,
              graph: playGraph,
              graphPath: snap.activeGraphPath,
            }))
            setPlayEpoch((n) => n + 1)
          }}
          onDrill={showingForeignPlayGraph ? undefined : onDrill}
          onPaneClick={() => setSelected(null)}
          onAddNode={showingForeignPlayGraph ? undefined : addPerfNode}
          onFitLayout={showingForeignPlayGraph ? undefined : applyCanvasLayout}
        />

        {/* 试玩浮层：画布右上角（原独立试玩面板搬来） */}
        {playOpen && (
          <div style={{ position: 'absolute', top: 8, right: 8, width: 320, zIndex: 6, borderRadius: 10, overflow: 'hidden', border: '1px solid #403830', background: 'rgba(27,23,19,0.94)', boxShadow: '0 8px 28px rgba(0,0,0,0.55)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', background: '#252019', borderBottom: '1px solid #2e2924', fontSize: 11, color: '#c9d1e0', gap: 8 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={snap.currentNodeId ? `${snap.phase} · ${playNameOf(snap.currentNodeId)}` : snap.phase}>
                试玩 · {snap.phase}
                {snap.currentNodeId ? ` · ${snap.clip?.name || playNameOf(snap.currentNodeId)}` : ''}
              </span>
              <span style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  onClick={() => setPlayPaused((value) => !value)}
                  title={playPaused ? '继续试玩' : '暂停试玩'}
                  aria-label={playPaused ? '继续试玩' : '暂停试玩'}
                  style={{ background: 'none', border: 'none', color: playPaused ? '#f5bd75' : '#c9d1e0', cursor: 'pointer', padding: 0 }}
                >
                  {playPaused ? '▶' : 'Ⅱ'}
                </button>
                <select
                  aria-label="试玩倍速"
                  value={playbackRate}
                  onChange={(event) => setPlaybackRate(Number(event.target.value))}
                  style={{ border: '1px solid #403830', borderRadius: 4, background: '#1b1713', color: '#c9d1e0', fontSize: 10, padding: '1px 2px' }}
                >
                  {[0.5, 1, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}x</option>)}
                </select>
                <VideoAudioToggle
                  compact
                  enabled={videoAudioEnabled}
                  onToggle={() => setVideoAudioEnabled((enabled) => !enabled)}
                />
                <button onClick={restartPlayFrom} title={playFrom ? `重开 · 回到 ${playFrom.nodeId}` : '重开'} style={{ background: 'none', border: 'none', color: '#f08840', cursor: 'pointer', padding: 0 }}>▶ 重开</button>
                <button onClick={() => setPlayOpen(false)} title="隐藏" style={{ background: 'none', border: 'none', color: '#9aa2b1', cursor: 'pointer', padding: 0 }}>✕</button>
              </span>
            </div>
            <PlaybackClockProvider value={{ paused: playPaused, rate: playbackRate }}>
            <PlayerRootContext.Provider value={playRootEl}>
            <div
              ref={bindPlayRoot}
              tabIndex={0}
              onPointerDown={() => claimPlayerFocus(playRootRef.current)}
              onFocus={() => claimPlayerFocus(playRootRef.current)}
              style={{ position: 'relative', height: 180, background: '#000', outline: 'none' }}
            >
              {/* 床轨：独立音频通道，不受视频原声开关影响。挂在浮层里 → 关掉试玩即随卸载停播；
                  key 随 session 重建换 → 重开不把上一局的曲子拖进新局（同 GraphPlaySurface）。 */}
              <BgmPlayer key={bgmRunKey} bgm={snap.bgm} resolveAsset={resolveBgm} paused={playPaused} playbackRate={playbackRate} />

              {/* 演出 + 叠层：共享 runtime/play 的 GameStage。videoKey 带 playEpoch → 同节点再 jump 强制 remount。 */}
              <GameStage
                videoSrc={videoSrc}
                videoKey={`${snap.clip?.nodeId ?? 'clip'}-${playEpoch}`}
                clip={snap.clip}
                preloadVideos={preloadVideos}
                overlayMounts={snap.overlayMounts}
                skins={session.skins}
                skinCtx={{
                  hud: snap.hud,
                  condition: { state: session.runtime.state, visited: session.runtime.state.visited },
                }}
                onEmit={(elementId, key) => { if (!playPaused) setSnap(sessionRef.current.emitEvent(elementId, key)) }}
                onTick={(nowMs) => setSnap(sessionRef.current.tick(nowMs))}
                onPerformanceEnd={endPerformance}
                paused={playPaused}
                playbackRate={playbackRate}
                videoAudioEnabled={videoAudioEnabled}
              />
            </div>
            </PlayerRootContext.Provider>
            </PlaybackClockProvider>
          </div>
        )}
      </div>

      {/* 右：节点配置面板 —— 默认隐藏，点画布节点才出现；✕ 或点画布空白处关闭。
          左预览（NodePreviewStage：视频+覆盖物+时间轴，可编辑）｜右表单（NodeInspector 原样）。 */}
      {selected && (
        <div
          ref={panelRef}
          style={{
            // 展开预览时让节点面板最多占主区 90%，给 3:2 分栏足够空间；收起时仍给画布留至少 20%。
            // 预览收起时只留表单宽度——否则表单会被拉到 960px，面板照旧占地方，收起就白收了。
            width: effectivePreviewOpen ? 'clamp(960px, 66vw, 1380px)' : `clamp(${FORM_W_MIN}px, 28vw, 500px)`,
            maxWidth: effectivePreviewOpen ? '90%' : '80%',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid #2e2924',
          }}
        >
          {/* header（含 ✕ 关闭）独立在内容滚动区之外：面板多窄、内部怎么横滚都始终呈现。 */}
          <div style={{ display: 'flex', gap: 4, padding: 6, borderBottom: '1px solid #2e2924', alignItems: 'center', flexShrink: 0 }}>
            <b style={{ fontSize: 12 }}>节点配置{selectedNode ? ` · ${selectedNode.data.name || selectedNode.id}` : ''}</b>
            <button onClick={() => setSelected(null)} title="关闭" style={{ marginLeft: 'auto', color: '#9aa2b1', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>
          {/* 展开态默认 3:2；拖拽后首列改用用户设定宽度。窄面板仍保证预览略宽于表单。 */}
          <div
            data-testid="node-panel-columns"
            style={{
              flex: 1,
              minHeight: 0,
              display: effectivePreviewOpen ? 'grid' : 'flex',
              gridTemplateColumns: effectivePreviewOpen
                ? `${previewW == null ? `minmax(${PREVIEW_W_MIN}px, 3fr)` : `${previewW}px`} ${SPLITTER_W}px minmax(${FORM_W_MIN}px, 2fr)`
                : undefined,
              overflowX: 'auto',
            }}
          >
            {selectedNode && effectivePreviewOpen ? (
              <>
                <div
                  data-testid="node-preview-column"
                  style={{
                    // 列宽由外层 grid 管：默认 3:2，拖拽后首列固定为 previewW。
                    minWidth: PREVIEW_W_MIN,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                  }}
                >
                  <NodePreviewStage
                    scenario={previewScenario}
                    node={selectedNode}
                    game={game}
                    focusedMountId={focusedMountId}
                    focusedLifecycleIndex={focusedLifecycleIndex}
                    onEditScenario={editPreviewScenario}
                    onFocusMount={focusMount}
                    onFocusLifecycle={focusLifecycle}
                  />
                </div>
                <div
                  className="gv-splitter"
                  onPointerDown={startPreviewDrag}
                  title="拖动调整预览区宽度"
                />
              </>
            ) : null}
            {/* 收起态由面板的 28vw 给出舒适宽度；展开态表单下限 280px，把空间优先留给预览。
                长下拉文案会把表单撑到 ~880px，中等宽度也出现不必要的横向滚动。 */}
            <div data-testid="node-inspector-column" style={{ flex: `1 0 ${FORM_W_MIN}px`, minWidth: FORM_W_MIN, overflow: 'auto' }}>
              <NodeInspector
                graph={canvasGraph}
                nodeId={selected}
                videoOptions={videoOptions}
                audioOptions={audioOptions}
                packs={packs}
                isRefAllowed={isRefAllowed}
                overlays={overlays}
                entities={entities}
                variables={variables}
                formulas={formulas}
                focusedMountId={focusedMountId}
                focusedLifecycleIndex={focusedLifecycleIndex}
                onFocusMount={focusMount}
                onFocusLifecycle={focusLifecycle}
                previewOpen={effectivePreviewOpen}
                onTogglePreview={selectedCanConfigurePerformance ? togglePreview : undefined}
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
                onRemoveMount={(mountId) => {
                  editPreviewScenario((s, n) => removeMountGraph(s, n, mountId))
                }}
                onJump={jump}
              />
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
