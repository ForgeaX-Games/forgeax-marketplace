import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useEdgesState,
  useNodesState,
  useReactFlow,
  Handle,
  Position,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useScenarioStore } from '../scenario/scenarioStore'
import { useShellStore } from '../shell/shellStore'
import { useSceneImageCache } from '../media/sceneImageCache'
import { useMediaStore } from '../media/mediaStore'
import { computeNodeThumbnail } from '../editor/storygraph/sceneNodeThumbnail'
import { BRANCH_EDGE_STYLES } from '../editor/storygraph/BranchEdge'
import { computeStoryGraphLayout } from '../scenario/layout'
import { makeBlankScene } from '../editor/storygraph/sceneFactory'
import { injectStyleOnce } from '../styles/injectStyle'
import { detectOrphans, defaultPlan } from '../scenario/reconnectOrphans'
import { EpisodeRail } from './EpisodeRail'
import type { BranchKind, Episode, Scene } from '../scenario/types'

const EMPTY_EPISODES: Episode[] = []

/** 四种下游类型的极简图例（与大图 BranchEdge 配色严格一致）。 */
const KIND_LEGEND: { kind: BranchKind; label: string }[] = [
  { kind: 'choice', label: '选择' },
  { kind: 'qte_pass', label: 'QTE 通过' },
  { kind: 'qte_fail', label: 'QTE 失败' },
  { kind: 'auto', label: '自动' },
]

/** 新建后继节点时可选的连线类型（含一句说明）。 */
const BRANCH_KIND_OPTIONS: { kind: BranchKind; label: string; hint: string }[] = [
  { kind: 'auto', label: '自动续播', hint: '看完自动进入下一节点' },
  { kind: 'choice', label: '玩家选择', hint: '作为一个选项按钮，建议填按钮文字' },
  { kind: 'qte_pass', label: 'QTE 通过', hint: 'QTE / 小游戏通过后走这条' },
  { kind: 'qte_fail', label: 'QTE 失败', hint: 'QTE / 小游戏失败后走这条' },
]

/** mini 节点尺寸 —— 比大图(224×196)小一大圈, 适配窄侧栏. */
const MINI_W = 150
const MINI_H = 64

/**
 * 「上次在编辑的节点」记忆 —— 按 scenario.id 落 localStorage。
 *
 * selectedSceneId / stageSceneId 都不持久化(刷新归位到默认 'intro'), 所以刷新后剧情树
 * 总是 fitView 全景, 作者得重新找之前编辑的节点。这里记住最后聚焦的节点, 刷新后据此把
 * 视图居中过去; 取不到(新树/换游戏)再退回全景。
 */
const LAST_SCENE_KEY = (scenarioId: string) => `reel-studio:lastScene:${scenarioId}`
function readLastScene(scenarioId: string): string | null {
  try {
    return localStorage.getItem(LAST_SCENE_KEY(scenarioId))
  } catch {
    return null
  }
}
function writeLastScene(scenarioId: string, sceneId: string): void {
  try {
    localStorage.setItem(LAST_SCENE_KEY(scenarioId), sceneId)
  } catch {
    /* localStorage 不可用(隐私模式/配额)时静默 */
  }
}

/**
 * SceneMiniMap —— 剧情树「左侧边栏」紧凑节点图 (2026-06-14 三次重构).
 *
 * 背景: 作者反馈 APP 大卡列表 (SceneRail) "节点太大、内容太多, 看不到节点连接".
 *   诉求: 回到"之前 xyflow 那种带连线的剧情树样式, 但小很多".
 *
 * 做法: 复用 xyflow (保留 节点+连线 的可视化 + 平移/缩放, 横竖皆可滚动),
 *   但换成极简 mini 节点 (小缩略图 + 标题 + 出度), 用 TB 纵向 dagre 紧凑布局
 *   (忽略 scene.pos —— 大图里作者拖过的坐标在窄栏里会乱, mini 图永远重算紧凑布局).
 *   连线 = 分支关系, 一眼可见整体结构.
 *
 * 交互: 点节点 = focusSceneInStage 进 center 二级页 (跨 iframe 经 crossPaneSync 同步).
 *   只读导航 + 可视化, 不带大图那套 hover 播放视频 / modal / 批量生成重逻辑.
 *
 * 下游语义 (2026-06-14 修复, 作者反馈"看不出单选/自然下一节点/QTE 判定"):
 *   连线按 branch.kind 上色+虚实+图标 (复用大图 BRANCH_EDGE_STYLES, 配色严格一致):
 *     choice   琥珀实线 ◆ —— 单选(玩家选项)
 *     qte_pass 翠绿实线 ✓ —— QTE/小游戏 通过
 *     qte_fail 朱红破折线 ✗ —— QTE/小游戏 失败
 *     auto     浅灰虚线 → —— 自然下一节点(自动续播)
 *   节点底部按 kind 分组显示下游徽章; 顶部一条极简四色图例.
 */
export function SceneMiniMap() {
  return (
    <ReactFlowProvider>
      <SceneMiniMapInner />
    </ReactFlowProvider>
  )
}

function SceneMiniMapInner() {
  const scenario = useScenarioStore((s) => s.scenario)
  const selectedSceneId = useScenarioStore((s) => s.selectedSceneId)
  const addScene = useScenarioStore((s) => s.addScene)
  const removeScene = useScenarioStore((s) => s.removeScene)
  const selectScene = useScenarioStore((s) => s.selectScene)
  const setSceneIsEnding = useScenarioStore((s) => s.setSceneIsEnding)
  const reconnectOrphans = useScenarioStore((s) => s.reconnectOrphans)
  const focusSceneInStage = useShellStore((s) => s.focusSceneInStage)
  const setStageScene = useShellStore((s) => s.setStageScene)
  const setActiveEpisodeId = useShellStore((s) => s.setActiveEpisodeId)
  const forgeView = useShellStore((s) => s.forgeView)
  const stageSceneId = useShellStore((s) => s.stageSceneId)
  const activeEpisodeId = useShellStore((s) => s.activeEpisodeId)
  const cacheRecords = useSceneImageCache((s) => s.records)
  const mediaEntries = useMediaStore((s) => s.entries)
  const { fitView, setCenter } = useReactFlow()

  const episodes = scenario.episodes ?? EMPTY_EPISODES
  const sortedEpisodes = useMemo(
    () => [...episodes].sort((a, b) => a.order - b.order),
    [episodes],
  )
  const effectiveEpisodeId = useMemo(() => {
    if (sortedEpisodes.length === 0) return undefined
    const valid = new Set(sortedEpisodes.map((e) => e.id))
    if (activeEpisodeId && valid.has(activeEpisodeId)) return activeEpisodeId
    return sortedEpisodes[0]?.id
  }, [sortedEpisodes, activeEpisodeId])

  const activeId = stageSceneId ?? selectedSceneId

  // 当前集的 sceneId 集合 (仅用于"高亮/聚焦", 不再用来剔除连线)
  const episodeSceneIds = useMemo(() => {
    if (!effectiveEpisodeId) return null // 无 episode 概念 → 不区分
    const out = new Set<string>()
    for (const s of Object.values(scenario.scenes)) {
      if ((s.episodeId ?? sortedEpisodes[0]?.id) === effectiveEpisodeId) out.add(s.id)
    }
    return out.size ? out : null
  }, [scenario.scenes, effectiveEpisodeId, sortedEpisodes])

  // TB 紧凑布局 (忽略 pos: 传一个 pos 全清空的浅拷贝给 layout)
  const layout = useMemo(() => {
    const scenesNoPos: Record<string, Scene> = {}
    for (const [id, s] of Object.entries(scenario.scenes)) {
      scenesNoPos[id] = s.pos ? { ...s, pos: undefined } : s
    }
    return computeStoryGraphLayout(
      { ...scenario, scenes: scenesNoPos },
      {
        direction: 'TB',
        nodeWidth: MINI_W,
        nodeHeight: MINI_H,
        nodeSep: 18,
        rankSep: 38,
        marginX: 16,
        marginY: 16,
      },
    )
  }, [scenario])

  /**
   * 平移边界 —— 节点包围盒 + 一圈余量。
   *
   * 作者反馈: 滚轮/拖拽会把节点树甩出画框很远, 找不回来。xyflow 默认 translateExtent
   * 是无限的, 所以这里按当前布局的包围盒算一个有限矩形, 上下左右各留 PAD 的余量
   * (既能小幅平移微调, 又不会把整棵树拖到看不见)。布局变化时重算。
   */
  const translateExtent = useMemo<[[number, number], [number, number]]>(() => {
    const rects = Object.values(layout)
    if (rects.length === 0) {
      return [
        [-Infinity, -Infinity],
        [Infinity, Infinity],
      ]
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const r of rects) {
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + MINI_W)
      maxY = Math.max(maxY, r.y + MINI_H)
    }
    const PAD = 240
    return [
      [minX - PAD, minY - PAD],
      [maxX + PAD, maxY + PAD],
    ]
  }, [layout])

  // 每个节点的下游 branch 按 kind 分组计数 + 是否含 QTE/小游戏判定
  const branchSummary = useMemo(() => {
    const out = new Map<
      string,
      { choice: number; qtePass: number; qteFail: number; auto: number; hasQte: boolean }
    >()
    for (const s of Object.values(scenario.scenes)) {
      let choice = 0
      let qtePass = 0
      let qteFail = 0
      let auto = 0
      for (const b of s.branches) {
        if (b.kind === 'choice') choice++
        else if (b.kind === 'qte_pass') qtePass++
        else if (b.kind === 'qte_fail') qteFail++
        else auto++
      }
      const hasQte =
        Boolean(s.qte?.cues?.length) ||
        Boolean(s.minigames?.length) ||
        qtePass > 0 ||
        qteFail > 0
      out.set(s.id, { choice, qtePass, qteFail, auto, hasQte })
    }
    return out
  }, [scenario.scenes])

  // 断链检测 —— branches 为空 / 全是野指针, 且未标为结局的节点 = 孤儿(断头).
  // 这是"很多节点未连线"的根因: 数据里它们就没有有效下游分支.
  const orphans = useMemo(() => detectOrphans(scenario), [scenario])
  const orphanIds = useMemo(() => new Set(orphans.map((o) => o.sceneId)), [orphans])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // scenario / 选中 / 缩略图 变化 → 重建 nodes+edges (渲染全部, 不再按集剔除 → 不断裂)
  useEffect(() => {
    const nextNodes: Node[] = []
    for (const [id, scene] of Object.entries(scenario.scenes)) {
      const rect = layout[id]
      if (!scene || !rect) continue
      const t = computeNodeThumbnail(scene, cacheRecords[id], mediaEntries)
      const sum = branchSummary.get(id) ?? {
        choice: 0,
        qtePass: 0,
        qteFail: 0,
        auto: 0,
        hasQte: false,
      }
      nextNodes.push({
        id,
        type: 'mini',
        position: { x: rect.x, y: rect.y },
        data: {
          title: scene.title,
          thumbUrl: t.mediaKind === 'video' ? t.posterUrl : t.url,
          status: t.status,
          isVideoNoPoster: t.mediaKind === 'video' && !t.posterUrl,
          isRoot: scene.id === scenario.rootSceneId,
          isSelected: scene.id === activeId,
          // 有 episode 概念且节点不属于当前集 → 淡显(但仍渲染+连线), 消除"断裂"错觉
          isDimmed: episodeSceneIds ? !episodeSceneIds.has(id) : false,
          // 断头(无有效下游且非结局) → 红色描边标记, 让作者一眼看到哪些断了
          isOrphan: orphanIds.has(id),
          choiceCount: sum.choice,
          qtePassCount: sum.qtePass,
          qteFailCount: sum.qteFail,
          autoCount: sum.auto,
          hasQte: sum.hasQte,
          isEnding: Boolean(scene.isEnding),
        },
        draggable: false,
        selectable: true,
      })
    }
    const nextEdges: Edge[] = []
    for (const [id, scene] of Object.entries(scenario.scenes)) {
      if (!scene) continue
      for (const b of scene.branches) {
        // 仅要求两端 scene 真实存在 (悬空 target 才跳过); 不再按集过滤 → 跨集连线也画
        if (!scenario.scenes[b.targetSceneId]) continue
        if (!layout[id] || !layout[b.targetSceneId]) continue
        nextEdges.push({
          id: b.id,
          source: id,
          target: b.targetSceneId,
          type: 'miniBranch',
          animated: false,
          data: { kind: b.kind, label: b.label },
        })
      }
    }
    setNodes(nextNodes)
    setEdges(nextEdges)
  }, [
    scenario,
    layout,
    episodeSceneIds,
    orphanIds,
    cacheRecords,
    mediaEntries,
    activeId,
    branchSummary,
    setNodes,
    setEdges,
  ])

  // 持续记住"当前在编辑的节点"(按 scenario.id), 供下次刷新定位。
  useEffect(() => {
    if (activeId) writeLastScene(scenario.id, activeId)
  }, [activeId, scenario.id])

  /**
   * 初始定位 —— 把视图**居中到一个具体节点**, 而非全景(全景下作者每次刷新/换剧本
   * 都得自己找)。两个历史 bug 在这里一并修:
   *   1) 「新剧本不聚焦第一个节点」: 旧实现用 `fitted` 只在**整个组件挂载期跑一次**,
   *      所以 app 内换/建剧本(不整页刷新)时 fitted 已是 true → 永不重居中, 且兜底
   *      还是 fitView 全景。改为**按 scenario.id 记账**: 换了剧本就重新居中。
   *   2) 「每次刷新还得找」: iframe 初次挂载时 ReactFlow 容器宽高可能仍是 0, 此刻
   *      setCenter 的居中数学会算错位。改为**等容器测量出非零宽度再居中**(rAF 轮询,
   *      封顶 ~20 帧兜底)。
   *
   * 目标节点优先级: 上次在编辑的节点(记忆) → 当前选中 → **起始/根节点(第一个)** →
   *   布局里的第一个节点 → 实在没有才 fitView。这样新剧本默认落在第一个节点上。
   */
  const wrapperRef = useRef<HTMLDivElement>(null)
  const focusedForScenario = useRef<string | null>(null)
  useEffect(() => {
    if (nodes.length === 0) return
    if (focusedForScenario.current === scenario.id) return // 本剧本已居中过, 点节点不再强跳
    focusedForScenario.current = scenario.id

    const inLayout = (id: string | null | undefined): string | null =>
      id && layout[id] ? id : null
    const targetId =
      inLayout(readLastScene(scenario.id)) ??
      inLayout(activeId) ??
      inLayout(scenario.rootSceneId) ??
      inLayout(Object.keys(layout)[0]) ??
      null

    const focus = (): void => {
      const rect = targetId ? layout[targetId] : undefined
      if (targetId && rect) {
        // 居中缩放: 作者反馈 zoom:1 太大, 收到约一半(看得到更多上下文节点)。
        setCenter(rect.x + MINI_W / 2, rect.y + MINI_H / 2, { zoom: 0.5, duration: 0 })
        if (targetId !== activeId) selectScene(targetId)
        const epId = scenario.scenes[targetId]?.episodeId
        if (epId && epId !== effectiveEpisodeId) setActiveEpisodeId(epId)
      } else {
        fitView({ padding: 0.18, duration: 0, maxZoom: 1 })
      }
    }

    // 等容器测量完成(clientWidth>0)再居中; 最多等 ~20 帧, 之后兜底也居中。
    let tries = 0
    const tick = (): void => {
      const w = wrapperRef.current?.clientWidth ?? 0
      if (w > 0 || tries >= 20) {
        focus()
        return
      }
      tries += 1
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    // 仅在「首批节点就绪」或「切换了剧本」时跑; 其余值首跑取当时快照(focusedForScenario 守)。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, scenario.id])

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      selectScene(node.id)
      // 素材库视图: 只切换舞台节点(保持停留素材库); 其它视图: 聚焦到剧情树二级页。
      if (forgeView === 'assets') setStageScene(node.id)
      else focusSceneInStage(node.id)
    },
    [selectScene, focusSceneInStage, setStageScene, forgeView],
  )

  // 工具条作用的"当前节点": 优先详情聚焦的, 其次列表选中的
  const targetSceneId = activeId
  const targetScene = targetSceneId ? scenario.scenes[targetSceneId] : undefined

  // 新建后继节点的「连线类型对话框」状态: null = 关闭。
  const [branchDialogOpen, setBranchDialogOpen] = useState(false)
  const [newBranchKind, setNewBranchKind] = useState<BranchKind>('auto')
  const [newBranchLabel, setNewBranchLabel] = useState('')

  /** 真正落地建节点; link 为空 = 不接线(孤立/起点)。 */
  const createScene = useCallback(
    (link?: { kind: BranchKind; label?: string }) => {
      const fresh = makeBlankScene()
      if (effectiveEpisodeId) fresh.episodeId = effectiveEpisodeId
      addScene(fresh, {
        linkFrom:
          targetSceneId && link
            ? { sceneId: targetSceneId, kind: link.kind, label: link.label }
            : undefined,
      })
      selectScene(fresh.id)
      focusSceneInStage(fresh.id)
    },
    [addScene, targetSceneId, effectiveEpisodeId, selectScene, focusSceneInStage],
  )

  const onAddScene = useCallback(() => {
    // 有上游节点 → 弹「选连线类型 + 填文字」对话框; 没有 → 直接建孤立节点。
    if (targetSceneId) {
      setNewBranchKind('auto')
      setNewBranchLabel('')
      setBranchDialogOpen(true)
    } else {
      createScene()
    }
  }, [targetSceneId, createScene])

  const onConfirmBranchDialog = useCallback(() => {
    createScene({ kind: newBranchKind, label: newBranchLabel.trim() || undefined })
    setBranchDialogOpen(false)
  }, [createScene, newBranchKind, newBranchLabel])

  const onDuplicateScene = useCallback(() => {
    if (!targetScene) return
    const copy = makeBlankScene({ title: `${targetScene.title} 副本` })
    copy.media = { ...targetScene.media }
    copy.durationMs = targetScene.durationMs
    copy.dialogue = targetScene.dialogue.map((d) => ({ ...d }))
    copy.prompts = targetScene.prompts ? { ...targetScene.prompts } : undefined
    copy.background = targetScene.background
    copy.characterIds = targetScene.characterIds ? [...targetScene.characterIds] : undefined
    copy.locationId = targetScene.locationId
    if (targetScene.episodeId) copy.episodeId = targetScene.episodeId
    else if (effectiveEpisodeId) copy.episodeId = effectiveEpisodeId
    // 副本不继承 branches (避免双向连到同一目标造成混乱); 作者自行接线
    addScene(copy, { linkFrom: { sceneId: targetScene.id, kind: 'auto' } })
    selectScene(copy.id)
    focusSceneInStage(copy.id)
  }, [targetScene, addScene, effectiveEpisodeId, selectScene, focusSceneInStage])

  const onDeleteScene = useCallback(() => {
    if (!targetSceneId || !targetScene) return
    if (targetSceneId === scenario.rootSceneId) {
      window.alert('起始节点不能删除。请先把别的节点设为起点，或改接剧情线。')
      return
    }
    const ok = window.confirm(
      `删除节点「${targetScene.title}」？\n指向它的连线会自动穿连到它的第一个后继（无后继则断开）。`,
    )
    if (!ok) return
    removeScene(targetSceneId)
  }, [targetSceneId, targetScene, scenario.rootSceneId, removeScene])

  const onToggleEnding = useCallback(() => {
    if (!targetSceneId || !targetScene) return
    setSceneIsEnding(targetSceneId, !targetScene.isEnding)
  }, [targetSceneId, targetScene, setSceneIsEnding])

  // 一键修复断链:
  //   · 有推荐目标(suggestedTargetId 非空) → 补一条 auto 边接上后续
  //   · 推荐不到(末端/最右, suggestedTargetId=null) → 标记为结局(markEnding),
  //     这类本就是真结局, 不该再当"断头"报警 (作者确认 are_endings).
  const onFixOrphans = useCallback(() => {
    if (orphans.length === 0) return
    const plan = defaultPlan(orphans)
    const linkCount = plan.entries.filter((e) => e.targetSceneId).length
    const endingCount = plan.entries.length - linkCount
    const parts: string[] = []
    if (linkCount > 0) parts.push(`为 ${linkCount} 个补「自然下一节点」连线`)
    if (endingCount > 0) parts.push(`把 ${endingCount} 个末端节点标记为「结局」`)
    const ok = window.confirm(
      `检测到 ${orphans.length} 个无下游的节点。\n将${parts.join('，')}。\n（已接好的节点不受影响，可继续手动调整）`,
    )
    if (!ok) return
    // 推荐不到目标的 → markEnding 写 isEnding=true; 能接的照常补 auto 边
    const entries = plan.entries.map((e) =>
      e.targetSceneId ? e : { ...e, markEnding: true },
    )
    reconnectOrphans({ entries })
  }, [orphans, reconnectOrphans])

  const isRootTarget = targetSceneId === scenario.rootSceneId

  return (
    <div className="ks-mini" aria-label="剧情树连线图">
      <EpisodeRail />

      <div className="ks-mini-legend" aria-label="分支类型图例">
        {KIND_LEGEND.map(({ kind, label }) => {
          const s = BRANCH_EDGE_STYLES[kind]
          return (
            <span key={kind} className="ks-mini-legend-item" title={label}>
              <span
                className="ks-mini-legend-dot"
                style={{ background: s.stroke, boxShadow: `0 0 0 2px ${s.stroke}33` }}
                aria-hidden
              />
              <span className="ks-mini-legend-glyph" aria-hidden>{s.glyph}</span>
              <span className="ks-mini-legend-label">{label}</span>
            </span>
          )
        })}
      </div>

      <div className="ks-mini-canvas" ref={wrapperRef}>
        {nodes.length === 0 ? (
          <div className="ks-mini-empty">
            <span className="ks-mini-empty-glyph" aria-hidden>
              ✦
            </span>
            <span className="ks-mini-empty-text">这一集还没有节点</span>
            <button type="button" className="ks-mini-empty-add" onClick={onAddScene}>
              ＋ 新建第一个节点
            </button>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            /* 初始视图不用内置 fitView —— 由上面的 effect 决定"居中到上次编辑节点 / 退回全景"。 */
            minZoom={0.25}
            maxZoom={1.6}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            /* 滚轮=缩放(作者诉求), 不再用滚轮平移(会把树甩飞); 平移仍靠拖拽。 */
            zoomOnScroll
            panOnScroll={false}
            panOnDrag
            /* 限制平移范围: 节点包围盒+余量, 防止把整棵树拖出画框找不回。 */
            translateExtent={translateExtent}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="ks-mini-bg" />
          </ReactFlow>
        )}

        {/* 断链修复 —— 悬浮在画布右下角的小图标(hover 展开文字), 不再占底栏整行 */}
        {orphans.length > 0 && (
          <button
            type="button"
            className="ks-mini-fixfab"
            onClick={onFixOrphans}
            title={`${orphans.length} 个节点未连下游 —— 自动接上后续节点；末端标记为结局`}
          >
            <span className="ks-mini-fixfab-dot" aria-hidden />
            <span className="ks-mini-fixfab-count">{orphans.length}</span>
            <span className="ks-mini-fixfab-text">未连下游 · 一键修复</span>
          </button>
        )}
      </div>

      <div className="ks-mini-foot">
        <button type="button" className="ks-mini-add" onClick={onAddScene}>
          <span aria-hidden>＋</span>
          {targetScene ? '在此后新建' : '新建节点'}
        </button>
        <div className="ks-mini-ops" role="group" aria-label="节点操作">
          <button
            type="button"
            className="ks-mini-op"
            onClick={onDuplicateScene}
            disabled={!targetScene}
            title={targetScene ? `复制「${targetScene.title}」` : '先选中一个节点'}
          >
            <span aria-hidden>⧉</span> 复制
          </button>
          <button
            type="button"
            className={`ks-mini-op${targetScene?.isEnding ? ' is-on' : ''}`}
            onClick={onToggleEnding}
            disabled={!targetScene}
            title={
              !targetScene
                ? '先选中一个节点'
                : targetScene.isEnding
                  ? '取消结局标记'
                  : '标记为结局节点'
            }
          >
            <span aria-hidden>★</span> 结局
          </button>
          <button
            type="button"
            className="ks-mini-op is-danger"
            onClick={onDeleteScene}
            disabled={!targetScene || isRootTarget}
            title={
              !targetScene
                ? '先选中一个节点'
                : isRootTarget
                  ? '起始节点不能删除'
                  : `删除「${targetScene.title}」`
            }
          >
            <span aria-hidden>🗑</span> 删除
          </button>
        </div>
      </div>

      {/* 新建后继节点 · 选连线类型 + 填文字 */}
      {branchDialogOpen && (
        <div
          className="ks-mini-bdlg-mask"
          onClick={() => setBranchDialogOpen(false)}
          role="presentation"
        >
          <div
            className="ks-mini-bdlg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="选择连线类型"
          >
            <div className="ks-mini-bdlg-title">
              在「{targetScene?.title ?? '当前节点'}」之后新建
            </div>
            <div className="ks-mini-bdlg-sub">这条连线是什么类型？</div>
            <div className="ks-mini-bdlg-kinds">
              {BRANCH_KIND_OPTIONS.map((o) => {
                const s = BRANCH_EDGE_STYLES[o.kind]
                const on = newBranchKind === o.kind
                return (
                  <button
                    key={o.kind}
                    type="button"
                    className={`ks-mini-bdlg-kind${on ? ' is-on' : ''}`}
                    onClick={() => setNewBranchKind(o.kind)}
                    style={on ? { borderColor: s.stroke } : undefined}
                  >
                    <span
                      className="ks-mini-bdlg-kdot"
                      style={{ background: s.stroke }}
                      aria-hidden
                    />
                    <span className="ks-mini-bdlg-klabel">{o.label}</span>
                    <span className="ks-mini-bdlg-khint">{o.hint}</span>
                  </button>
                )
              })}
            </div>
            <input
              className="ks-mini-bdlg-input"
              value={newBranchLabel}
              autoFocus
              onChange={(e) => setNewBranchLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onConfirmBranchDialog()
                if (e.key === 'Escape') setBranchDialogOpen(false)
              }}
              placeholder={
                newBranchKind === 'choice'
                  ? '按钮文字，如：追上去'
                  : '连线标签（可选）'
              }
            />
            <div className="ks-mini-bdlg-actions">
              <button
                type="button"
                className="ks-mini-bdlg-cancel"
                onClick={() => setBranchDialogOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="ks-mini-bdlg-ok"
                onClick={onConfirmBranchDialog}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface MiniNodeData extends Record<string, unknown> {
  title: string
  thumbUrl?: string
  status: 'ready' | 'pending' | 'error' | 'empty'
  isVideoNoPoster: boolean
  isRoot: boolean
  isSelected: boolean
  isDimmed: boolean
  isOrphan: boolean
  choiceCount: number
  qtePassCount: number
  qteFailCount: number
  autoCount: number
  hasQte: boolean
  isEnding: boolean
}

function MiniSceneNode({ data }: NodeProps<Node<MiniNodeData, 'mini'>>) {
  const d = data
  const cls = [
    'ks-mini-node',
    d.isSelected ? 'is-selected' : '',
    d.isRoot ? 'is-root' : '',
    d.isDimmed ? 'is-dimmed' : '',
    d.isOrphan ? 'is-orphan' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const cChoice = BRANCH_EDGE_STYLES.choice
  const cPass = BRANCH_EDGE_STYLES.qte_pass
  const cFail = BRANCH_EDGE_STYLES.qte_fail
  const cAuto = BRANCH_EDGE_STYLES.auto
  return (
    <div className={cls}>
      <Handle type="target" position={Position.Top} className="ks-mini-handle" />
      <div className={`ks-mini-thumb is-${d.status}`}>
        {d.thumbUrl ? (
          <img src={d.thumbUrl} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="ks-mini-thumb-empty">{d.isVideoNoPoster ? '视频' : '无图'}</span>
        )}
        {d.status === 'pending' && <span className="ks-mini-dot is-pending" title="生成中" />}
        {d.status === 'error' && <span className="ks-mini-dot is-error" title="生成失败" />}
        {d.isRoot && <span className="ks-mini-rootbadge">起</span>}
        {d.hasQte && (
          <span className="ks-mini-qtebadge" title="含 QTE / 小游戏判定">
            QTE
          </span>
        )}
      </div>
      <div className="ks-mini-info">
        <div className="ks-mini-title" title={d.title}>
          {d.title}
        </div>
        <div className="ks-mini-sub">
          {d.choiceCount > 0 && (
            <span className="ks-mini-bk" style={{ color: cChoice.stroke }} title={`${d.choiceCount} 个选择分支`}>
              {cChoice.glyph}{d.choiceCount}
            </span>
          )}
          {d.qtePassCount > 0 && (
            <span className="ks-mini-bk" style={{ color: cPass.stroke }} title={`${d.qtePassCount} 条 QTE 通过`}>
              {cPass.glyph}{d.qtePassCount}
            </span>
          )}
          {d.qteFailCount > 0 && (
            <span className="ks-mini-bk" style={{ color: cFail.stroke }} title={`${d.qteFailCount} 条 QTE 失败`}>
              {cFail.glyph}{d.qteFailCount}
            </span>
          )}
          {d.autoCount > 0 && d.choiceCount === 0 && d.qtePassCount === 0 && d.qteFailCount === 0 && (
            <span className="ks-mini-bk" style={{ color: cAuto.stroke }} title="自然下一节点">
              {cAuto.glyph}
            </span>
          )}
          {d.isEnding ? <span className="ks-mini-end">结局</span> : null}
          {d.isOrphan && !d.isEnding ? (
            <span className="ks-mini-orphan" title="无下游连线（断头）">⚠ 未连线</span>
          ) : null}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="ks-mini-handle" />
    </div>
  )
}

interface MiniEdgeData extends Record<string, unknown> {
  kind: BranchKind
  label?: string
}

/**
 * MiniBranchEdge —— 侧栏紧凑版分支连线 (复用大图 BRANCH_EDGE_STYLES 配色).
 *
 * 与大图 BranchEdge 的差异: 只读、无点击编辑、icon 缩到 14px;
 * 但 kind 的颜色/虚实/glyph 严格一致, 让作者在小图里也能一眼读出
 * 单选 / QTE 通过 / QTE 失败 / 自然下一节点 四种下游语义.
 */
const MiniBranchEdge = memo(function MiniBranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps) {
  const d = (data ?? {}) as MiniEdgeData
  const kind: BranchKind = d.kind ?? 'auto'
  const style = BRANCH_EDGE_STYLES[kind]
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 10,
  })
  const pathStyle: React.CSSProperties = {
    stroke: style.stroke,
    strokeWidth: selected ? 2.4 : 1.6,
    strokeDasharray: style.strokeDasharray,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
    opacity: selected ? 1 : 0.9,
  }
  const labelText = d.label && d.label.trim().length > 0 ? d.label : style.labelFallback
  return (
    <>
      <BaseEdge id={id} path={path} style={pathStyle} />
      <EdgeLabelRenderer>
        <div
          className="ks-mini-edge-icon"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            background: style.chipFill,
            color: style.chipText,
            borderColor: style.chipBorder,
          }}
          title={labelText}
          aria-label={labelText}
        >
          {style.glyph}
        </div>
      </EdgeLabelRenderer>
    </>
  )
})

injectStyleOnce('scene-minimap', miniMapCss())

const NODE_TYPES: NodeTypes = { mini: MiniSceneNode }
const EDGE_TYPES: EdgeTypes = { miniBranch: MiniBranchEdge }

function miniMapCss(): string {
  return `
.ks-mini {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  /* 兜底深色: 即使外层 --color-* 没继承到也不会白底 (作者反馈"还是白色") */
  background: var(--color-background-elevated, #242424);
  color: var(--color-text-primary, #ffffff);
  font-family: var(--font-sans, system-ui, sans-serif);
}

/* ── 断链修复悬浮图标 (画布右下角, 收起=圆点+数字, hover 展开文字) ── */
.ks-mini-fixfab {
  all: unset;
  position: absolute;
  right: 10px;
  bottom: 10px;
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 30px;
  padding: 6px;
  box-sizing: border-box;
  cursor: pointer;
  color: #ffb0c0;
  background: color-mix(in srgb, #ff5d7a 18%, var(--color-background-base, #191919));
  border: 1px solid color-mix(in srgb, #ff5d7a 45%, transparent);
  border-radius: var(--radius-pill, 999px);
  box-shadow: 0 4px 14px rgba(0,0,0,0.35);
  overflow: hidden;
  white-space: nowrap;
  transition: max-width .18s ease, background .12s ease, border-color .12s ease;
}
.ks-mini-fixfab:hover {
  max-width: 220px;
  background: color-mix(in srgb, #ff5d7a 26%, var(--color-background-base, #191919));
  border-color: color-mix(in srgb, #ff5d7a 60%, transparent);
}
.ks-mini-fixfab-dot {
  flex-shrink: 0;
  width: 7px; height: 7px; border-radius: 50%;
  background: #ff5d7a;
  box-shadow: 0 0 0 3px color-mix(in srgb, #ff5d7a 28%, transparent);
}
.ks-mini-fixfab-count {
  flex-shrink: 0;
  font-size: 10px; font-weight: 800; line-height: 1;
  font-variant-numeric: tabular-nums;
}
.ks-mini-fixfab-text {
  font-size: 11px; font-weight: 700; line-height: 1;
}

/* ── 新建后继节点 · 连线类型对话框 ── */
.ks-mini-bdlg-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(2px);
}
.ks-mini-bdlg {
  width: 100%;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  box-sizing: border-box;
  background: var(--color-background-elevated, #242424);
  border: 1px solid var(--color-border-default, #404040);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
}
.ks-mini-bdlg-title {
  font-size: 12.5px; font-weight: 700;
  color: var(--color-text-primary, #fff);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ks-mini-bdlg-sub {
  font-size: 11px; color: var(--color-text-secondary, rgba(255,255,255,0.6));
  margin-top: -4px;
}
.ks-mini-bdlg-kinds {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.ks-mini-bdlg-kind {
  all: unset;
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 7px;
  padding: 7px 10px;
  cursor: pointer;
  border: 1px solid var(--color-border-default, #404040);
  border-radius: 8px;
  background: var(--color-background-base, #191919);
  transition: border-color .12s ease, background .12s ease;
}
.ks-mini-bdlg-kind:hover { background: var(--color-interaction-hover, rgba(255,255,255,0.06)); }
.ks-mini-bdlg-kind.is-on { background: var(--color-interaction-hover, rgba(255,255,255,0.06)); }
.ks-mini-bdlg-kdot { width: 9px; height: 9px; border-radius: 50%; }
.ks-mini-bdlg-klabel {
  font-size: 12px; font-weight: 700;
  color: var(--color-text-primary, #fff);
}
.ks-mini-bdlg-khint {
  font-size: 10px;
  color: var(--color-text-tertiary, rgba(255,255,255,0.4));
  text-align: right;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ks-mini-bdlg-input {
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  font-size: 12px;
  color: var(--color-text-primary, #fff);
  background: var(--color-background-base, #191919);
  border: 1px solid var(--color-border-default, #404040);
  border-radius: 8px;
  outline: none;
}
.ks-mini-bdlg-input:focus {
  border-color: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 55%, transparent);
}
.ks-mini-bdlg-actions {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.ks-mini-bdlg-cancel,
.ks-mini-bdlg-ok {
  all: unset;
  flex: 1;
  text-align: center;
  padding: 8px;
  font-size: 12px; font-weight: 700;
  border-radius: var(--radius-pill, 999px);
  cursor: pointer;
}
.ks-mini-bdlg-cancel {
  color: var(--color-text-secondary, rgba(255,255,255,0.6));
  background: var(--color-background-base, #191919);
  border: 1px solid var(--color-border-default, #404040);
}
.ks-mini-bdlg-cancel:hover { color: var(--color-text-primary, #fff); }
.ks-mini-bdlg-ok {
  color: #0a0a0a;
  background: var(--color-brand-primary, #d4ff48);
}
.ks-mini-bdlg-ok:hover { filter: brightness(1.08); }

/* 剧集切换 */
.ks-mini-eps {
  flex-shrink: 0;
  display: flex;
  gap: 5px;
  padding: 8px 10px;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid var(--color-border-default);
}
.ks-mini-eps::-webkit-scrollbar { display: none; }
.ks-mini-ep {
  all: unset;
  flex-shrink: 0;
  padding: 3px 11px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  border-radius: var(--radius-pill);
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: color .12s ease, background .12s ease, border-color .12s ease;
}
.ks-mini-ep:hover:not(.is-active) { color: var(--color-text-primary); background: var(--color-interaction-hover); }
.ks-mini-ep.is-active {
  color: var(--color-brand-primary);
  background: color-mix(in srgb, var(--color-brand-primary) 16%, transparent);
  border-color: color-mix(in srgb, var(--color-brand-primary) 40%, transparent);
}

/* 分支类型图例条 —— 四色点 + glyph + 标签, 极简一行 */
.ks-mini-legend {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 9px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border-default, #404040);
  background: var(--color-background-base, #191919);
}
.ks-mini-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 9.5px;
  line-height: 1;
  color: var(--color-text-secondary, rgba(255,255,255,0.6));
  white-space: nowrap;
}
.ks-mini-legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.ks-mini-legend-glyph { font-size: 9px; font-weight: 800; }
.ks-mini-legend-label { font-weight: 600; }

/* 画布 —— 占满侧栏剩余高度, xyflow 自己平移缩放(横竖皆可) */
.ks-mini-canvas {
  flex: 1;
  min-height: 0;
  position: relative;
  background: var(--color-background-elevated, #242424);
}
/*
 * 白底根因: @xyflow/react 默认 style.css 把 .react-flow 底色设成
 * var(--xy-background-color, #fff) 浅色, 且 .react-flow__pane 也带白底.
 * 这里把 xyflow 自己的背景变量 + 容器底色全部按深色覆盖, 彻底消白.
 */
.ks-mini-canvas .react-flow {
  background: transparent;
  --xy-background-color: transparent;
  --xy-background-color-default: transparent;
  --xy-edge-stroke-default: var(--color-text-tertiary, rgba(255,255,255,0.3));
  --xy-attribution-background-color-default: transparent;
}
.ks-mini-canvas .react-flow__pane,
.ks-mini-canvas .react-flow__renderer,
.ks-mini-canvas .react-flow__viewport { background: transparent; }
.ks-mini-canvas .react-flow__attribution { display: none; }
.ks-mini-bg { color: var(--color-border-default, #404040); opacity: 0.5; }

/* 分支连线中点 icon (kind 语义化, 与大图 BranchEdge 同色) */
.ks-mini-edge-icon {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  border: 1.2px solid;
  border-radius: 50%;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.35);
}

/* ── mini 节点 ─────────────────────────────────────── */
.ks-mini-node {
  width: ${MINI_W}px;
  height: ${MINI_H}px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 7px;
  box-sizing: border-box;
  background: var(--color-background-base);
  border: 1px solid var(--color-border-default);
  border-radius: 9px;
  cursor: pointer;
  transition: border-color .14s ease, box-shadow .14s ease, background .14s ease;
}
.ks-mini-node:hover {
  border-color: color-mix(in srgb, var(--color-brand-primary) 45%, var(--color-border-default));
  background: var(--color-interaction-hover);
}
.ks-mini-node.is-root {
  border-color: color-mix(in srgb, var(--color-brand-primary) 55%, var(--color-border-default));
}
.ks-mini-node.is-selected {
  border-color: var(--color-brand-primary);
  background: color-mix(in srgb, var(--color-brand-primary) 14%, var(--color-background-base));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-brand-primary) 45%, transparent);
}

.ks-mini-thumb {
  position: relative;
  flex-shrink: 0;
  width: 42px;
  height: 30px;
  border-radius: 5px;
  overflow: hidden;
  background: var(--color-background-elevated);
}
.ks-mini-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ks-mini-thumb-empty {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono);
  font-size: 8px; font-weight: 600; letter-spacing: 0.06em;
  color: var(--color-text-tertiary);
  background: repeating-linear-gradient(45deg, transparent 0 6px, rgba(255,255,255,0.03) 6px 7px), var(--color-background-elevated);
}
.ks-mini-dot {
  position: absolute; left: 3px; bottom: 3px;
  width: 7px; height: 7px; border-radius: 50%;
  box-shadow: 0 0 0 1.5px rgba(0,0,0,0.5);
}
.ks-mini-dot.is-pending { background: var(--color-brand-primary); animation: ks-mini-pulse 1.1s ease-in-out infinite; }
.ks-mini-dot.is-error { background: #ff5d7a; }
@keyframes ks-mini-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
.ks-mini-rootbadge {
  position: absolute; top: 2px; right: 2px;
  padding: 0 3px;
  font-size: 8px; font-weight: 800; line-height: 1.4;
  color: #0a0a0a; background: var(--color-brand-primary, #d4ff48);
  border-radius: 3px;
}
.ks-mini-qtebadge {
  position: absolute; bottom: 2px; right: 2px;
  padding: 0 3px;
  font-size: 7px; font-weight: 800; line-height: 1.5; letter-spacing: 0.04em;
  color: #fff; background: rgba(16,185,129,0.85);
  border-radius: 3px;
}

.ks-mini-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ks-mini-title {
  font-size: 11px; font-weight: 600; line-height: 1.2;
  color: var(--color-text-primary, #fff);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
/* 下游分支徽章 —— 按 kind 上色, 与连线/图例同源 */
.ks-mini-sub {
  display: flex; flex-wrap: wrap; gap: 3px 6px;
  font-family: var(--font-mono, ui-monospace, monospace); font-size: 9px;
}
.ks-mini-bk { font-weight: 800; line-height: 1; }
.ks-mini-end { color: var(--color-text-tertiary, rgba(255,255,255,0.3)); font-weight: 700; }
.ks-mini-orphan { color: #ff8da0; font-weight: 800; }

.ks-mini-handle {
  width: 5px; height: 5px;
  background: var(--color-text-tertiary);
  border: none;
  opacity: 0;
}
/* 不属于当前集的节点 —— 仍渲染+连线(不断裂), 仅淡显区分 */
.ks-mini-node.is-dimmed { opacity: 0.4; }
.ks-mini-node.is-dimmed:hover { opacity: 0.75; }

/* 断头节点 —— 红色描边, 让作者一眼看到哪些没有下游连线 */
.ks-mini-node.is-orphan {
  border-color: color-mix(in srgb, #ff5d7a 60%, var(--color-border-default, #404040));
  box-shadow: 0 0 0 1px color-mix(in srgb, #ff5d7a 35%, transparent);
}
.ks-mini-node.is-orphan.is-selected {
  border-color: #ff5d7a;
  box-shadow: 0 0 0 2px color-mix(in srgb, #ff5d7a 50%, transparent);
}

/* 空态 */
.ks-mini-empty {
  height: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 22px; text-align: center;
}
.ks-mini-empty-glyph { font-size: 26px; color: var(--color-text-tertiary); }
.ks-mini-empty-text { font-size: 12px; color: var(--color-text-secondary); }
.ks-mini-empty-add {
  all: unset; cursor: pointer;
  padding: 6px 14px; font-size: 12px; font-weight: 600;
  color: var(--color-brand-primary);
  background: color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 35%, transparent);
  border-radius: var(--radius-pill);
}
.ks-mini-empty-add:hover { background: color-mix(in srgb, var(--color-brand-primary) 20%, transparent); }

/* 底部工具条 */
.ks-mini-foot {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--color-border-default, #404040);
  background: var(--color-background-base, #191919);
}
/* 断链修复行 —— 移到底部工具条顶端(原顶部红条挪下来), 不抢视线 */
.ks-mini-fixlink {
  all: unset; box-sizing: border-box; width: 100%; cursor: pointer;
  display: flex; align-items: center; gap: 7px;
  padding: 6px 10px; font-size: 11px;
  color: #ffb0c0;
  background: color-mix(in srgb, #ff5d7a 12%, transparent);
  border: 1px solid color-mix(in srgb, #ff5d7a 32%, transparent);
  border-radius: 8px;
  transition: background .12s ease, border-color .12s ease;
}
.ks-mini-fixlink:hover {
  background: color-mix(in srgb, #ff5d7a 20%, transparent);
  border-color: color-mix(in srgb, #ff5d7a 50%, transparent);
}
.ks-mini-fixlink-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: #ff5d7a;
  box-shadow: 0 0 0 3px color-mix(in srgb, #ff5d7a 28%, transparent);
}
.ks-mini-fixlink-text {
  flex: 1; min-width: 0; font-weight: 600;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ks-mini-fixlink-cta {
  flex-shrink: 0; font-weight: 800; color: #ff8da0;
}

.ks-mini-add {
  all: unset; box-sizing: border-box; width: 100%;
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px; font-size: 12px; font-weight: 700;
  color: #0a0a0a; background: var(--color-brand-primary, #d4ff48);
  border-radius: var(--radius-pill, 999px); cursor: pointer;
  transition: filter .12s ease, transform .12s ease;
}
.ks-mini-add:hover { filter: brightness(1.08); }
.ks-mini-add:active { transform: translateY(1px); }

/* 次级操作: 复制 / 结局 / 删除 */
.ks-mini-ops {
  display: flex;
  gap: 5px;
}
.ks-mini-op {
  all: unset; box-sizing: border-box; flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 3px;
  padding: 6px 4px; font-size: 11px; font-weight: 600;
  color: var(--color-text-secondary, rgba(255,255,255,0.6));
  background: var(--color-background-elevated, #242424);
  border: 1px solid var(--color-border-default, #404040);
  border-radius: 7px; cursor: pointer;
  white-space: nowrap;
  transition: color .12s ease, background .12s ease, border-color .12s ease;
}
.ks-mini-op:hover:not(:disabled) {
  color: var(--color-text-primary, #fff);
  background: var(--color-interaction-hover, rgba(255,255,255,0.06));
  border-color: var(--color-border-strong, #737373);
}
.ks-mini-op:disabled { opacity: 0.4; cursor: not-allowed; }
.ks-mini-op.is-on {
  color: var(--color-brand-primary, #d4ff48);
  border-color: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 45%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary, #d4ff48) 12%, transparent);
}
.ks-mini-op.is-danger:hover:not(:disabled) {
  color: #ff5d7a;
  border-color: color-mix(in srgb, #ff5d7a 50%, transparent);
  background: color-mix(in srgb, #ff5d7a 12%, transparent);
}
`
}

