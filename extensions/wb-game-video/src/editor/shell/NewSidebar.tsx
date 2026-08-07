/**
 * NewSidebar —— 新版左侧栏（按 Figma 15195_75500 视觉稿一比一还原）。
 *
 * 视觉契约（来自 Figma 15195_75500，1920 基准）：
 *   · 整栏宽度 220px，背景 #2C2C2C；内容区 196px（左右各 12px 内边距）。
 *   · 每行高 42px，内容高 26px（上 8px），底部 1px rgba(255,255,255,0.10) 分隔线。
 *   · 文字 16px PingFang SC weight 400，白色。
 *   · 图标 20×20；文字从图标右侧起（图标 20 + 间距 8 = 左 28px）。
 *   · chevron：展开态=向上 ⌃（白色实线）；折叠态=向右 ›（白 40%）。
 *   · 层级缩进：顶层 left 0，每下一层 +16px（对齐设计稿 8/16/24 的递进）。
 *   · 选中态：整行背景 rgba(255,255,255,0.10)。
 *   · 可展开的容器节点右上角带「＋」新增子项按钮（14×14 加号，白 80%）。
 *   · 行 hover / 选中时右侧显示操作图标组：重命名(铅笔) / 删除(垃圾桶)，14×14。
 *   · 编辑态：行内输入框 rgba(44,44,44,0.20) 背景 + 白 60% 描边 + 3px 圆角，
 *     右侧带确认(加号) / 取消 图标。
 *
 * 功能契约（与旧 GraphSidebar 等价，缺失的先 mock）：
 *   · 顶层「蓝图/界面/资产库/规则」点击 → setView 跳转主区对应视图。
 *   · 其余层级（章节、子蓝图等）为 mock 树数据，点击仅切换本地选中态。
 *   · 展开/折叠、新增子项、重命名、删除等交互：无真实后端能力时先 mock（本地态 + console 留痕），
 *     但相应 icon 必须齐全。
 *
 * 新旧并存：本组件已替换旧 GraphSidebar 的 UI 渲染位置；旧组件代码保留待清理。
 */
import { useMemo, useState } from 'react'
import { injectStyleOnce } from '../../styles/injectStyle'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useGraphView, type GraphView } from '../persist/graphViewStore'

/** 树节点类型：区分「可展开容器 / 叶子 / 顶层入口」。 */
type NavKind = 'entry' | 'branch' | 'leaf'

/** 侧栏树节点的 mock 形状。 */
export interface NavNode {
  /** 稳定 id，用于选中态与展开态。 */
  id: string
  /** 显示文案。 */
  label: string
  /** 节点种类。 */
  kind: NavKind
  /** 顶层入口点击后跳转的主区视图；仅 kind==='entry' 且需要跳转时提供。 */
  view?: GraphView
  /** 是否可新增子项（右上角「＋」按钮）；对齐设计稿部分容器/入口才有。 */
  canAddChild?: boolean
  /** 子节点。 */
  children?: NavNode[]
}

/**
 * 侧栏树 mock 数据（对齐 Figma 15195_75500 的层级）。
 * 顶层入口的 view 与 GraphView 对齐，点击即跳转主区；其余为占位便于视觉还原。
 */
const NAV_TREE: readonly NavNode[] = [
  {
    id: 'graph',
    label: '蓝图',
kind: 'entry',
    view: 'graph',
    canAddChild: true,
    children: [
      {
        id: 'bp-debug',
    label: '调试蓝图',
        kind: 'branch',
   children: [
          {
    id: 'bp-chapter1',
   label: '章节1',
  kind: 'branch',
            children: [
     { id: 'bp-c1-open', label: '章节1-开幕', kind: 'leaf' },
    { id: 'bp-c1-cast', label: '章节1-选角', kind: 'leaf' },
   ],
          },
          { id: 'bp-chapter2', label: '章节2', kind: 'leaf' },
        ],
      },
{ id: 'bp-narrative', label: '叙事蓝图', kind: 'leaf' },
    { id: 'bp-battle', label: '战斗蓝图', kind: 'leaf' },
    ],
  },
  {
    id: 'video',
    label: '视频',
    kind: 'entry',
    view: 'video',
    canAddChild: true,
    children: [
      {
        id: 'vid-generated',
        label: '生成视频',
   kind: 'branch',
        children: [
        { id: 'vid-gen-door', label: 'narr-door.mp4', kind: 'leaf' },
          { id: 'vid-gen-land', label: 'narr-land.mp4', kind: 'leaf' },
        ],
   },
      { id: 'vid-uploaded', label: '上传视频', kind: 'leaf' },
    ],
  },
  {
    id: 'ui',
    label: '界面',
    kind: 'entry',
    view: 'ui',
    canAddChild: true,
    children: [
      {
        id: 'ui-hud',
        label: '战斗 HUD',
        kind: 'branch',
    children: [
      { id: 'ui-hud-hp', label: '我方水墨血条', kind: 'leaf' },
          { id: 'ui-hud-skill', label: '战斗技能条', kind: 'leaf' },
      ],
      },
      { id: 'ui-dialog', label: '对话框', kind: 'leaf' },
    { id: 'ui-choice', label: '选项面板', kind: 'leaf' },
    ],
  },
  {
 id: 'assets',
    label: '资产库',
    kind: 'entry',
    view: 'assets',
    canAddChild: true,
    children: [
      {
        id: 'as-video',
 label: '视频',
        kind: 'branch',
        children: [
    { id: 'as-video-door', label: 'narr-door.mp4', kind: 'leaf' },
          { id: 'as-video-land', label: 'narr-land.mp4', kind: 'leaf' },
    ],
      },
      {
        id: 'as-image',
        label: '图片',
        kind: 'branch',
        children: [
   { id: 'as-img-hero', label: '主角立绘', kind: 'leaf' },
     { id: 'as-img-bg', label: '场景背景', kind: 'leaf' },
        ],
   },
      { id: 'as-bgm', label: 'BGM', kind: 'leaf' },
    ],
  },
  {
    id: 'rule',
    label: '规则',
    kind: 'entry',
    view: 'rule',
    canAddChild: true,
    children: [
      {
        id: 'rule-entity',
        label: '实体',
        kind: 'branch',
        children: [
          { id: 'rule-entity-hero', label: '主角', kind: 'leaf' },
          { id: 'rule-entity-enemy', label: '空藏', kind: 'leaf' },
        ],
      },
      { id: 'rule-var', label: '变量', kind: 'leaf' },
      { id: 'rule-formula', label: '公式', kind: 'leaf' },
    ],
  },
  { id: 'play', label: '试玩', kind: 'entry', view: 'play' },
]

/** 递归收集所有可展开节点 id（初始默认全部展开，对齐设计稿展开态）。 */
function collectExpandableIds(nodes: readonly NavNode[], acc: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      acc.add(n.id)
 collectExpandableIds(n.children, acc)
    }
  }
  return acc
}

const NEW_SIDEBAR_CSS = `
/* ── 新版左侧栏 · Figma 15195_75500 ─────────────────────────────────── */
.ns-sidebar {
  --ns-bg: #2C2C2C;
  --ns-line: rgba(255, 255, 255, 0.10);
  --ns-text: #FFFFFF;
  --ns-text-40: rgba(255, 255, 255, 0.40);
  --ns-text-60: rgba(255, 255, 255, 0.60);
  --ns-text-80: rgba(255, 255, 255, 0.80);
  --ns-row-h: 42px;
  --ns-indent: 8px;

  /* 完整页面模式：固定一个合理宽度（最小 220px），主区自适应剩余空间。
     split-pane（?pane=left）模式下由 GraphApp 覆盖为 width:100% 撑满 iframe。 */
  width: 240px;
  min-width: 220px;
  flex: none;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--ns-bg);
  color: var(--ns-text);
  font-family: 'PingFang SC', system-ui, -apple-system, 'Segoe UI', sans-serif;
}

/* 内容区：左右 12px 内边距（对齐设计稿 196px 内容 / 220px 栏宽）。 */
.ns-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}
.ns-scroll::-webkit-scrollbar { width: 6px; }
.ns-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.10); border-radius: 3px; }
.ns-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }

/* 每一行：42px 高，底部 1px 分隔线，内容垂直居中。
   右侧留 8px 内边距，避免操作图标（重命名/删除）与「＋」贴死到最右边缘。 */
.ns-row {
  all: unset;
box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: var(--ns-row-h);
  padding-right: 8px;
  border-bottom: 1px solid var(--ns-line);
  cursor: pointer;
  font-family: inherit;
  transition: background .12s;
}
.ns-row:hover { background: rgba(255, 255, 255, 0.04); }
.ns-row.is-active { background: rgba(255, 255, 255, 0.10); }
.ns-row:focus-visible { outline: 1px solid rgba(255,255,255,0.45); outline-offset: -1px; }

/* chevron：20×20；展开态向上 ⌃，折叠态向右 ›（旋转 -90deg）。与文字间距 8px。 */
.ns-chev {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  padding: 0;
  margin-right: 8px;
  cursor: pointer;
  color: var(--ns-text);
  transition: transform .18s ease;
}
.ns-chev svg { width: 20px; height: 20px; display: block; }
.ns-chev.is-collapsed { transform: rotate(-90deg); }

/* 行图标（叶子节点）：20×20 容器，图形 16×16 居中；与文字间距 8px，
   与 chevron 同宽同间距，使叶子/容器节点文字对齐同一列。 */
.ns-ico {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ns-text-80);
  margin-right: 8px;
}
.ns-ico svg { width: 16px; height: 16px; display: block; }

/* 文字：16px PingFang SC weight 400 白色，单行省略。 */
.ns-label {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 400;
  line-height: 26px;
  color: var(--ns-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 右上角「＋」新增子项按钮（可展开容器/入口）。 */
.ns-add {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--ns-text-80);
  cursor: pointer;
  padding: 0;
  border-radius: 4px;
  transition: background .12s;
}
.ns-add:hover { background: rgba(255,255,255,0.10); }
.ns-add svg { width: 14px; height: 14px; display: block; }

/* 行右操作图标组（hover / 选中时显示）：重命名 / 删除，14×14。 */
.ns-row-actions {
  flex: none;
  display: none;
  align-items: center;
  gap: 8px;
  margin-left: 8px;
}
.ns-row:hover .ns-row-actions,
.ns-row.is-active .ns-row-actions { display: inline-flex; }
.ns-act {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
  color: var(--ns-text-40);
  border-radius: 3px;
  transition: color .12s, background .12s;
}
.ns-act:hover { color: var(--ns-text); background: rgba(255,255,255,0.10); }
.ns-act svg { width: 14px; height: 14px; display: block; }

/* 编辑态输入框：rgba(44,44,44,0.20) 背景 + 白 60% 描边 + 3px 圆角。 */
.ns-edit {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 26px;
  padding: 0 4px;
  background: rgba(44, 44, 44, 0.20);
  border-radius: 3px;
  outline: 0.4px solid var(--ns-text-60);
  outline-offset: -0.4px;
}
.ns-edit input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ns-text-60);
  font-family: inherit;
  font-size: 16px;
  font-weight: 400;
}
.ns-edit input::placeholder { color: var(--ns-text-60); }
`

/* ── 图标（对齐 Figma 15195_75500 的 SVG）─────────────────────────── */

/** chevron：展开态向上 ⌃（白色）。折叠态由 .is-collapsed 旋转 -90deg。 */
const ChevronIcon = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M15 12.5L10 7.5L5 12.5" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** 加号（14×14，白 80%）：新增子项 / 确认新建。 */
const PlusIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M0 5.85059L0 7.72559L5.91943 7.6875V13.5H7.79443V7.6875H13.5V5.8125H7.79443V0H5.91943V5.8125L0 5.85059Z" fill="currentColor" />
  </svg>
)

/** 铅笔（14×14）：重命名。 */
const PencilIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M10.2083 6.41732L12.5416 4.08398L9.91661 1.45898L7.58327 3.79232L1.75 9.62565V12.2506H4.37494L10.2083 6.41732ZM7.58327 3.79232L10.2083 6.41732" stroke="currentColor" strokeWidth="1.16667" />
  </svg>
)

/** 垃圾桶（14×14）：删除。 */
const TrashIcon = (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden>
    <path d="M12.25 2.91602H1.75M2.91667 2.91602H11.0833L10.7917 12.8327H3.20833L2.91667 2.91602ZM4.95833 1.16602H9.04167V2.91602H4.95833V1.16602Z" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="square" />
    <path d="M7 5.25V10.5" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="square" />
  </svg>
)

/** 文件/文档图标（20×20 占位，用简单文档轮廓，作为叶子/入口的默认图标）。 */
const DocIcon = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M5 2.5h6l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M11 2.5V6.5H15" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
)

interface NsRowProps {
  node: NavNode
  depth: number
  expanded: Set<string>
  activeId: string | null
  onToggle: (id: string) => void
  onSelect: (node: NavNode) => void
  onAddChild: (node: NavNode) => void
  onRename: (node: NavNode) => void
  onDelete: (node: NavNode) => void
}

/**
 * NsRow —— 单行 + 递归子行渲染。
 * 缩进由 depth 决定（每层 +16px，加在 chevron 前的 paddingLeft）。
 */
function NsRow({ node, depth, expanded, activeId, onToggle, onSelect, onAddChild, onRename, onDelete }: NsRowProps): JSX.Element {
  const hasChildren = !!(node.children && node.children.length > 0)
  const isExpanded = expanded.has(node.id)
  const isActive = activeId === node.id
  // 缩进：对齐 Figma I14597_19057 —— 顶层 depth=0 无缩进，每深一层 +8px（设计稿 8.33px）。
  const indent = depth * 8

  return (
<>
      <div
        className={`ns-row${isActive ? ' is-active' : ''}`}
   role="treeitem"
        aria-expanded={hasChildren ? isExpanded : undefined}
aria-selected={isActive}
        tabIndex={0}
style={{ paddingLeft: indent }}
        onClick={() => onSelect(node)}
  onKeyDown={(e) => {
  if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(node)
   }
        }}
      >
      {hasChildren ? (
          <button
      type="button"
  className={`ns-chev${isExpanded ? '' : ' is-collapsed'}`}
  aria-label={isExpanded ? '折叠' : '展开'}
       onClick={(e) => {
       e.stopPropagation()
     onToggle(node.id)
    }}
   >
  {ChevronIcon}
  </button>
      ) : (
        // 叶子节点：用文档图标占据与 chevron 同一列（不再额外加 chev-spacer，避免多出一个 20px 前缀）。
       <span className="ns-ico" aria-hidden>{DocIcon}</span>
  )}
     <span className="ns-label" title={node.label}>{node.label}</span>
      {/* 行右操作组：重命名 / 删除（hover / 选中显示）。 */}
        <span className="ns-row-actions" onClick={(e) => e.stopPropagation()}>
     <button type="button" className="ns-act" aria-label={`重命名 ${node.label}`} title="重命名" onClick={() => onRename(node)}>
    {PencilIcon}
     </button>
   <button type="button" className="ns-act" aria-label={`删除 ${node.label}`} title="删除" onClick={() => onDelete(node)}>
   {TrashIcon}
      </button>
     </span>
  {/* 可新增子项：右上角「＋」按钮。 */}
   {node.canAddChild && (
          <button
       type="button"
   className="ns-add"
        aria-label={`新增 ${node.label} 子项`}
        title="新增子项"
          onClick={(e) => {
       e.stopPropagation()
     onAddChild(node)
          }}
          >
            {PlusIcon}
          </button>
        )}
      </div>
      {hasChildren && isExpanded && node.children!.map((child) => (
        <NsRow
   key={child.id}
          node={child}
      depth={depth + 1}
        expanded={expanded}
          activeId={activeId}
onToggle={onToggle}
          onSelect={onSelect}
          onAddChild={onAddChild}
        onRename={onRename}
    onDelete={onDelete}
        />
      ))}
    </>
  )
}

/**
 * NewSidebar —— 新版左侧栏（树形层级导航）。
 *
 * 顶层入口（有 view）点击：调用 setView 跳转主区视图。
 * 其余节点点击：仅本地选中态。展开/折叠、新增/重命名/删除：mock。
 */
export function NewSidebar(): JSX.Element {
  injectStyleOnce('new-sidebar', NEW_SIDEBAR_CSS)
  const view = useGraphView((s) => s.view)
  const setView = useGraphView((s) => s.setView)
  // 读一下节点数，保持与 scenario 的订阅（未来可用于显示统计），当前不渲染。
  useGraphScenario((s) => s.graph?.nodes?.length ?? 0)

  // 初始默认展开全部可展开节点（对齐设计稿的展开态）。
  const [expanded, setExpanded] = useState<Set<string>>(() => collectExpandableIds(NAV_TREE))
  // 当前选中节点 id：默认高亮与当前主区视图对应的顶层入口。
  const initialActive = useMemo(() => {
    const hit = NAV_TREE.find((n) => n.view === view)
return hit?.id ?? null
  }, [view])
  const [activeId, setActiveId] = useState<string | null>(initialActive)

  const onToggle = (id: string): void => {
    setExpanded((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onSelect = (node: NavNode): void => {
    setActiveId(node.id)
    // 顶层入口带 view → 跳转主区；其余仅本地选中态（mock）。
    if (node.view) setView(node.view)
  }

  const onAddChild = (node: NavNode): void => {
    // mock：新增子项。等接入真实能力再实现，先 console 留痕并保证展开。
    setExpanded((cur) => new Set(cur).add(node.id))
    // eslint-disable-next-line no-console
    console.log('[NewSidebar] add child for', node.id)
  }

  const onRename = (node: NavNode): void => {
    // mock：重命名。等接入真实能力再实现。
    // eslint-disable-next-line no-console
 console.log('[NewSidebar] rename', node.id)
  }

  const onDelete = (node: NavNode): void => {
    // mock：删除。等接入真实能力再实现。
    // eslint-disable-next-line no-console
    console.log('[NewSidebar] delete', node.id)
  }

  return (
    <aside className="ns-sidebar" aria-label="视频游戏工坊（新版侧栏）">
      <div className="ns-scroll" role="tree" aria-label="工坊导航树">
        {NAV_TREE.map((node) => (
   <NsRow
            key={node.id}
          node={node}
        depth={0}
            expanded={expanded}
   activeId={activeId}
            onToggle={onToggle}
        onSelect={onSelect}
  onAddChild={onAddChild}
  onRename={onRename}
    onDelete={onDelete}
       />
      ))}
      </div>
    </aside>
  )
}
