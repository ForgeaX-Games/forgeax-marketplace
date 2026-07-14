import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  useReactFlow,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useScenarioStore } from '../scenario/scenarioStore'
import { useSceneImageCache } from '../media/sceneImageCache'
import { useMediaStore } from '../media/mediaStore'
import { computeStoryGraphLayout } from '../scenario/layout'
import { injectStyleOnce } from '../styles/injectStyle'
import { isPastBranch } from './branchTreeStyling'
import { computeNodeAccess, isJumpable, type TreeNodeAccess } from './treeNav'
import { DEFAULT_TREE_EDGE } from '../forge/modules/treeThemePresets'

/**
 * BranchTreeReadonly —— Player 全屏 Overlay 里的只读剧情树。
 *
 * 风格参考"完蛋我被美女包围了"：
 *   - 节点 = 240×140 场景缩略图卡片（从 sceneImageCache 取 dataUrl）
 *   - 缩略图顶部有分类徽章（START / CHOICE），底部覆盖标题
 *   - 当前场景：琥珀描边 + 脉冲动画
 *   - 已走场景：正常亮度 + 淡琥珀描边
 *   - 未走场景：压暗 + 灰度滤镜 + 细虚线描边
 *   - 已走分支：琥珀粗线 + 流光（animated=true）
 *   - 未走分支：灰色虚线
 *
 * 为什么不直接复用编辑器 StoryGraph：
 *   StoryGraph 牵动 shellStore / 编辑 action（增删分支 / 拖拽 / 展开）
 *   Player 场景下这些都是副作用。共用底层 computeStoryGraphLayout + sceneImageCache
 *   即可达到"视觉复用"，交互上保持最小只读边界。
 */

interface Props {
  currentSceneId: string
  visitedSceneIds: string[]
  onJump: (sceneId: string) => void
}

interface ReadonlyNodeData {
  title: string
  /** 可达性(章节/关卡选择):current / visited / frontier / locked。 */
  access: TreeNodeAccess
  thumbnailUrl?: string
  /** 主题节点框图(按状态选好的);无则回落内置 CSS 框。 */
  frameUrl?: string
  /** 是否显示缩略图(主题 showThumbnails=false → 纯标题框)。 */
  showThumb: boolean
  /** 是否可点跳转(由 jumpScope + access 决定)。 */
  jumpable: boolean
  isRoot: boolean
  branchCount: number
  [key: string]: unknown
}

type ReadonlyFlowNode = Node<ReadonlyNodeData, 'readonly-scene'>

const NODE_W = 240
const NODE_H = 140

const NODE_TYPES: NodeTypes = {
  'readonly-scene': ReadonlySceneNode,
}

function ReadonlySceneNode({ data }: { data: ReadonlyNodeData }) {
  const cls = [
    'ks-btro-card',
    `is-${data.access}`,
    data.frameUrl ? 'is-themed' : '',
    data.showThumb ? '' : 'is-noThumb',
    data.jumpable ? 'is-jumpable' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cls}>
      {/* 隐形 handles —— 仅用于 xyflow 计算 edge 端点，不参与交互（CSS 置 opacity:0 + pointer-events:none） */}
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      {data.showThumb && (
        <div className="ks-btro-card-thumb">
          {data.thumbnailUrl ? (
            <img src={data.thumbnailUrl} alt={data.title} draggable={false} />
          ) : (
            <div className="ks-btro-card-placeholder ks-mono">⌗ NO PREVIEW</div>
          )}
          <div className="ks-btro-card-veil" />
        </div>
      )}
      {data.isRoot && <div className="ks-btro-card-badge ks-mono">START</div>}
      {data.branchCount >= 2 && (
        <div className="ks-btro-card-badge-branch ks-mono" title="分歧点">
          ⎇ {data.branchCount}
        </div>
      )}
      {data.access === 'locked' && (
        <div className="ks-btro-card-lock ks-mono" title="尚未解锁">
          🔒
        </div>
      )}
      {data.access === 'current' && !data.frameUrl && (
        <div className="ks-btro-card-pulse" aria-hidden />
      )}
      {data.access === 'current' && <div className="ks-btro-card-now ks-mono">NOW</div>}
      <div className="ks-btro-card-title ks-cn" title={data.title}>
        {data.title}
      </div>
      {/* 主题节点框:整框覆盖(生成图中心留空,盖在缩略图上不挡内容)。 */}
      {data.frameUrl && (
        <img className="ks-btro-card-frame" src={data.frameUrl} alt="" aria-hidden draggable={false} />
      )}
    </div>
  )
}

export function BranchTreeReadonly(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  )
}

function Inner({ currentSceneId, visitedSceneIds, onJump }: Props) {
  const scenario = useScenarioStore((s) => s.scenario)
  const cacheRecords = useSceneImageCache((s) => s.records)
  const mediaEntries = useMediaStore((s) => s.entries)
  const visited = useMemo(() => new Set(visitedSceneIds), [visitedSceneIds])
  const flow = useReactFlow()
  const reactFlowReadyRef = useRef(false)

  const theme = scenario.treeTheme
  const jumpScope = theme?.jumpScope ?? (theme ? 'visited' : 'none')
  const showThumb = theme?.showThumbnails ?? true
  const edge = { ...DEFAULT_TREE_EDGE, ...(theme?.edge ?? {}) }

  /** treeTheme 引用的 UI 部件 assetId → mediaStore url。 */
  const assetUrl = (assetId: string | undefined): string | undefined => {
    if (!assetId) return undefined
    const mid = scenario.uiAssets?.[assetId]?.mediaId
    return mid ? mediaEntries[mid]?.url : undefined
  }
  const bgUrl = assetUrl(theme?.backgroundAssetId)
  const frameDefaultUrl = assetUrl(theme?.nodeFrameAssetId)
  const frameCurrentUrl = assetUrl(theme?.nodeFrameCurrentAssetId) ?? frameDefaultUrl
  const frameLockedUrl = assetUrl(theme?.nodeFrameLockedAssetId) ?? frameDefaultUrl

  /**
   * 打开剧情树时把视口居中到"当前正在播的场景"。
   *
   * 作者要求：玩家掀开树一眼就能看见自己走到哪——旧版用 `fitView` 把整张
   * 网铺满，节点多时 currentScene 被塞在边角，玩家还得手动找一遍。
   *
   * 踩坑记录（2026-05-07 二次修）：
   *   第一版只在 currentSceneId 变时跑，且用 `flow.getNode()` 读节点坐标。
   *   但 ReactFlow 把外部 `nodes` prop 吸入内部 store 也是 effect 驱动，
   *   组件首次挂载的 RAF 里 `getNode()` 往往返回 undefined，effect 走回
   *   fallback fitView —— 作者截图显示的"没聚焦到当前"就是这个。
   *
   * 现在的做法：
   *   · 等 ReactFlow `onInit` 触发，确认 viewport 尺寸就绪后才开始聚焦
   *   · 用我们自己的 `nodes` 数组（useMemo 里已经装好 position）直接读坐标，
   *     绕过 ReactFlow internal store 的同步时序
   *   · `focusedSceneRef` 只记忆"已经为这个 sceneId 聚焦过"，避免
   *     cacheRecords 更新导致 nodes 引用变化时相机被拽回中心
   *   · 依赖加上 nodes：某些场景（nodes 数组是 layout 之后第二拍才成型）
   *     也能在数据稳定后补上一次聚焦
   */
  const focusedSceneRef = useRef<string | null>(null)

  const { nodes, edges } = useMemo(() => {
    const layout = computeStoryGraphLayout(scenario, {
      nodeWidth: NODE_W,
      nodeHeight: NODE_H,
      nodeSep: 32,
      rankSep: 120,
      ...(theme?.direction ? { direction: theme.direction } : {}),
    })
    const access = computeNodeAccess({ scenario, currentSceneId, visited })
    const nodes: ReadonlyFlowNode[] = []
    const edges: Edge[] = []
    for (const sc of Object.values(scenario.scenes)) {
      const rect = layout[sc.id]
      if (!rect) continue
      const acc: TreeNodeAccess = access[sc.id] ?? 'locked'
      const jumpable = isJumpable(acc, jumpScope)
      const rec = cacheRecords[sc.id]
      const thumbnailUrl =
        rec?.status === 'ready' ? rec.dataUrl : undefined
      const frameUrl =
        acc === 'current'
          ? frameCurrentUrl
          : acc === 'locked'
            ? frameLockedUrl
            : frameDefaultUrl
      nodes.push({
        id: sc.id,
        type: 'readonly-scene',
        position: { x: rect.x, y: rect.y },
        width: NODE_W,
        height: NODE_H,
        data: {
          title: sc.title || sc.id,
          access: acc,
          thumbnailUrl,
          frameUrl,
          showThumb,
          jumpable,
          isRoot: sc.id === scenario.rootSceneId,
          branchCount: sc.branches.length,
        },
        draggable: false,
        selectable: jumpable,
      })
      for (const br of sc.branches) {
        if (!br.targetSceneId || !scenario.scenes[br.targetSceneId]) continue
        const isPast = isPastBranch({
          sourceSceneId: sc.id,
          targetSceneId: br.targetSceneId,
          currentSceneId,
          visited,
        })
        edges.push({
          id: `e-${sc.id}-${br.id}`,
          source: sc.id,
          target: br.targetSceneId,
          type: 'smoothstep',
          animated: isPast,
          // 不在 edge 上挂 label：作者反馈 player 阶段剧情树预览里，连线旁的
          // 选项文本（br.label）视觉噪声大、顺着折线能横跨好几个节点，反而
          // 干扰玩家看清"下一步会去哪个分镜"。选择文案已经在 DialogueBox /
          // ChoiceOverlay 里当一等公民展示，这里不再重复。
          className: isPast ? 'is-past' : 'is-future',
          // 未走分支用主题连线样式;已走分支保留琥珀高亮(靠 CSS is-past)。
          style: isPast
            ? undefined
            : {
                stroke: edge.color,
                strokeWidth: edge.width,
                ...(edge.dashed ? { strokeDasharray: '6 4' } : {}),
              },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: isPast ? '#ffb347' : edge.color,
          },
        })
      }
    }
    return { nodes, edges }
  }, [
    scenario,
    currentSceneId,
    visited,
    cacheRecords,
    theme?.direction,
    showThumb,
    jumpScope,
    frameCurrentUrl,
    frameLockedUrl,
    frameDefaultUrl,
    edge.color,
    edge.width,
    edge.dashed,
  ])

  /**
   * 用我们自己的 nodes 数组读坐标来 setCenter —— 不依赖 ReactFlow internal
   * store（它的同步是 effect 驱动，首次挂载时读不到）。
   *
   * 触发时机：currentSceneId 首次出现 / 切换到新场景后，首次拿到装有该节点
   * 坐标的 nodes 数组时。focusedSceneRef 做去重防止后续无关更新劫持相机。
   *
   * ReactFlow 的 viewport 可能尚未 init：effect 执行时 viewport 宽高还是 0，
   * setCenter 计算出的 transform 会变成 NaN。用 reactFlowReadyRef（由 onInit
   * 置 true）把真正的聚焦推迟到 viewport 就绪，等就绪后再依赖 nodes / id 补跑。
   */
  useEffect(() => {
    if (!reactFlowReadyRef.current) return
    if (focusedSceneRef.current === currentSceneId) return
    const node = nodes.find((n) => n.id === currentSceneId)
    if (!node) return
    focusedSceneRef.current = currentSceneId
    const cx = node.position.x + (node.width ?? NODE_W) / 2
    const cy = node.position.y + (node.height ?? NODE_H) / 2
    flow.setCenter(cx, cy, { zoom: 1, duration: 360 })
  }, [currentSceneId, nodes, flow])

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_e, node) => {
      if (node.id === currentSceneId) return
      // 关卡选择:仅允许 jumpScope 许可的节点跳转(未解锁/只读时点击无效)。
      const data = node.data as ReadonlyNodeData | undefined
      if (data && data.jumpable === false) return
      onJump(node.id)
    },
    [currentSceneId, onJump],
  )

  /**
   * ReactFlow viewport 就绪回调 —— 这时候才能安全调用 setCenter。
   * 首次挂载聚焦就由 onInit 主动驱动一次；之后的 currentSceneId 切换由上面
   * 的 effect 负责（ready 已经是 true）。
   */
  const handleInit = useCallback(() => {
    reactFlowReadyRef.current = true
    const node = nodes.find((n) => n.id === currentSceneId)
    if (!node) {
      // 脏数据兜底：起码把可见范围铺满，别留个空视口
      flow.fitView({ padding: 0.2, duration: 0, maxZoom: 1.0 })
      return
    }
    focusedSceneRef.current = currentSceneId
    const cx = node.position.x + (node.width ?? NODE_W) / 2
    const cy = node.position.y + (node.height ?? NODE_H) / 2
    // 初次 setCenter 不做 duration —— 作者打开的瞬间就该"已经在这儿"，
    // 不应看到镜头飞动；场景切换时（上面那个 effect）才用 360ms 平滑过渡。
    flow.setCenter(cx, cy, { zoom: 1, duration: 0 })
  }, [nodes, currentSceneId, flow])

  return (
    <div className="ks-btro">
      {/* 主题全屏背景(在节点/连线之下)。无主题时不渲染,保持内置深色。 */}
      {bgUrl && (
        <div
          className="ks-btro-bg"
          style={{ backgroundImage: `url(${bgUrl})` }}
          aria-hidden
        />
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={handleNodeClick}
        onInit={handleInit}
        proOptions={{ hideAttribution: true }}
        /*
         * 故意不挂 fitView：fitView 会在首帧把整张图铺满视口，把 currentSceneId
         * 挤到角落；由上面的 effect 用 setCenter 把当前场景居中才符合作者的诉求。
         * 极端"当前节点坐标缺失"时 effect 会回退到 fitView 兜底。
         */
        minZoom={0.3}
        maxZoom={1.4}
        panOnDrag
        panOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        {!bgUrl && (
          <Background
            variant={BackgroundVariant.Dots}
            gap={22}
            size={1}
            color="rgba(125, 211, 252, 0.1)"
          />
        )}
      </ReactFlow>
    </div>
  )
}

const css = `
.ks-btro {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

/* 主题全屏背景(在 React Flow 之下)。 */
.ks-btro-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  z-index: 0;
  pointer-events: none;
}
.ks-btro .react-flow { position: relative; z-index: 1; }

/* ─── 场景卡片 ─────────────────────────────────────────────── */
.ks-btro-card {
  width: ${NODE_W}px;
  height: ${NODE_H}px;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(10, 12, 18, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  cursor: default;
  transition:
    transform 180ms cubic-bezier(0.22, 0.61, 0.36, 1),
    border-color 180ms ease,
    box-shadow 180ms ease,
    filter 180ms ease;
  position: relative;
  box-sizing: border-box;
}
.ks-btro-card.is-jumpable { cursor: pointer; }
.ks-btro-card.is-jumpable:hover {
  transform: translateY(-3px) scale(1.03);
  border-color: rgba(232, 162, 58, 0.55);
  box-shadow:
    0 12px 32px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(232, 162, 58, 0.3),
    0 0 20px rgba(232, 162, 58, 0.18);
}
/* 主题节点框:整框覆盖(中心镂空),盖住内置边框。 */
.ks-btro-card.is-themed {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  overflow: visible;
}
.ks-btro-card-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  z-index: 4;
}
.ks-btro-card.is-noThumb { height: 56px; }
.ks-btro-card-lock {
  position: absolute;
  bottom: 6px;
  left: 6px;
  font-size: 11px;
  z-index: 5;
  opacity: 0.85;
}
.ks-btro-card-thumb {
  position: relative;
  width: 100%;
  height: 100px;
  overflow: hidden;
  background:
    repeating-linear-gradient(45deg, transparent 0 10px, rgba(125,211,252,0.05) 10px 11px),
    rgba(8, 10, 16, 0.7);
}
.ks-btro-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  filter: saturate(0.95) contrast(1.05);
}
.ks-btro-card-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  letter-spacing: 0.24em;
  color: rgba(255, 255, 255, 0.35);
}
.ks-btro-card-veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 50%, rgba(0, 0, 0, 0.55));
  pointer-events: none;
}
.ks-btro-card-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  padding: 2px 6px;
  font-size: 8.5px;
  letter-spacing: 0.22em;
  color: #ffb347;
  background: rgba(232, 162, 58, 0.2);
  border: 1px solid rgba(232, 162, 58, 0.55);
  border-radius: 2px;
}
.ks-btro-card-badge-branch {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 6px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: rgba(125, 211, 252, 0.95);
  background: rgba(125, 211, 252, 0.15);
  border: 1px solid rgba(125, 211, 252, 0.45);
  border-radius: 2px;
}
.ks-btro-card-now {
  position: absolute;
  bottom: 6px;
  right: 6px;
  padding: 2px 6px;
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.28em;
  color: #fff;
  background: rgba(232, 162, 58, 0.85);
  border-radius: 2px;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
}
.ks-btro-card-title {
  padding: 6px 10px;
  flex: 1;
  display: flex;
  align-items: center;
  font-size: 12.5px;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.88);
  background: linear-gradient(180deg, rgba(8,10,16,0.95), rgba(4,6,10,0.98));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── 四态：current / visited / frontier / locked ─────────────── */
.ks-btro-card.is-current {
  border-color: rgba(232, 162, 58, 0.95);
  box-shadow:
    0 0 0 2px rgba(232, 162, 58, 0.5),
    0 0 24px rgba(232, 162, 58, 0.4),
    0 10px 30px rgba(0, 0, 0, 0.6);
}
.ks-btro-card.is-current.is-themed { box-shadow: 0 0 24px rgba(232, 162, 58, 0.4); }
.ks-btro-card.is-current .ks-btro-card-title {
  color: #fff;
  background: linear-gradient(180deg, rgba(232,162,58,0.18), rgba(8,10,16,0.98));
}
.ks-btro-card-pulse {
  position: absolute;
  inset: -3px;
  border-radius: 12px;
  border: 1px solid rgba(232, 162, 58, 0.7);
  pointer-events: none;
  animation: ks-btro-pulse 1.8s ease-in-out infinite;
}
@keyframes ks-btro-pulse {
  0%, 100% { opacity: 0.8; transform: scale(1); }
  50%      { opacity: 0.15; transform: scale(1.05); }
}

.ks-btro-card.is-visited {
  border-color: rgba(232, 162, 58, 0.4);
}
.ks-btro-card.is-visited .ks-btro-card-thumb img { filter: saturate(0.95) contrast(1.05); }

/* frontier = 下一步可推进的未访问节点:冷色可用高亮,不压暗。 */
.ks-btro-card.is-frontier {
  border-color: rgba(125, 211, 252, 0.55);
  box-shadow: 0 0 0 1px rgba(125, 211, 252, 0.25), 0 8px 24px rgba(0, 0, 0, 0.45);
}
.ks-btro-card.is-frontier .ks-btro-card-title { color: rgba(255, 255, 255, 0.9); }

/* locked = 尚不可达:压暗 + 灰度 + 虚线。 */
.ks-btro-card.is-locked {
  border-style: dashed;
  border-color: rgba(255, 255, 255, 0.18);
  filter: grayscale(0.7) brightness(0.62);
}
.ks-btro-card.is-locked.is-jumpable:hover { filter: grayscale(0) brightness(1); }
.ks-btro-card.is-locked .ks-btro-card-title { color: rgba(255, 255, 255, 0.5); }

/* ─── 分支（xyflow edge 层） ───────────────────────────────── */
.ks-btro .react-flow__edge.is-past .react-flow__edge-path {
  stroke: #ffb347;
  stroke-width: 2.4;
  filter: drop-shadow(0 0 6px rgba(232, 162, 58, 0.55));
}
.ks-btro .react-flow__edge.is-past.react-flow__edge.animated .react-flow__edge-path {
  stroke-dasharray: 6 4;
  animation: ks-btro-flow 1.2s linear infinite;
}
@keyframes ks-btro-flow {
  to { stroke-dashoffset: -20; }
}
.ks-btro .react-flow__edge.is-future .react-flow__edge-path {
  stroke: rgba(255, 255, 255, 0.3);
  stroke-width: 1.6;
  stroke-dasharray: 4 4;
}
.ks-btro .react-flow__edge-text {
  fill: rgba(255, 255, 255, 0.9);
  font-size: 10.5px;
  letter-spacing: 0.08em;
}
.ks-btro .react-flow__edge-textbg {
  fill: rgba(8, 10, 16, 0.92);
}
.ks-btro .react-flow__edge.is-past .react-flow__edge-textbg {
  stroke: rgba(232, 162, 58, 0.5);
  stroke-width: 0.8;
}

/* ─── xyflow handles 隐藏（只读模式不需要连线抓手） ─────── */
.ks-btro .react-flow__handle {
  opacity: 0;
  pointer-events: none;
}
`
injectStyleOnce('branch-tree-readonly', css)
