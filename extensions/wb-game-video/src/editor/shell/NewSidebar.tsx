/**
 * NewSidebar —— 新版左侧栏（按 Figma 12650_5727 视觉稿还原）。
 *
 * 视觉契约（来自 Figma）：
 *   · 整栏宽度 318px、深底（#2C2C2C 头部 + 透明体）。
 *   · 一级条目 = 标题栏：左 chevron（展开/收起切换）+ 标题（20px PingFang SC 白色）
 *     + 右「＋」快速新增子级按钮（仅部分一级提供）。
 *   · 仅默认展开当前选中的一级栏目，其它一级折叠。
 *   · 二级条目：318×46、圆角 8、12px 内边距、16px 文字。
 *       - 未选中：rgba(255,255,255,0.03)
 *       - 悬浮态：rgba(255,255,255,0.10)
 *       - 选中态：rgba(255,255,255,0.20)
 *   · 部分二级项右侧带数量徽标（30×21，圆角 8，白 10% 背景与描边，12px 数字）。
 *
 * 功能契约（与原 GraphSidebar 等价）：
 *   · 点击一级标题 = 切到该 tab（调用 setView，与 GraphMain 联动渲染对应视图）。
 *   · 二级为 mock 数据（带 selectedId 本地态），点击切换选中但不影响主区视图。
 *
 * 共存策略：本组件独立于旧 GraphSidebar；通过 `?sidebar=new` 切换显示，
 *   旧 sidebar 暂不删除，待新版稳定后再统一替换。
 */
import { useEffect, useState } from 'react'
import { injectStyleOnce } from '../../styles/injectStyle'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useGraphView, type GraphView } from '../persist/graphViewStore'

/** 二级菜单项的 mock 形状。 */
export interface NavChild {
  /** 稳定 id，用于本地选中态。 */
  id: string
  /** 显示文案。 */
  label: string
  /** 数量徽标；undefined 表示不显示。 */
  count?: number
}

/** 一级菜单项的 mock 形状。 */
export interface NavGroup {
  id: GraphView
  label: string
  /** 该一级是否提供「＋」快速新增子级按钮（按 Figma 部分一级才有）。 */
  canAddChild?: boolean
  /** 二级菜单 mock 数据；空数组 = 该一级无二级。 */
  children: NavChild[]
}

/**
 * 一级/二级 mock 数据。一级 id 与 GraphView 严格对齐，点击一级即跳转对应视图。
 * 数量徽标与文案均为占位，便于视觉还原时立刻看到所有形态。
 */
const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'graph',
    label: '蓝图',
    canAddChild: true,
    children: [
      { id: 'g-debug', label: '调试蓝图' },
      { id: 'g-story', label: '故事蓝图' },
      { id: 'g-narrative', label: '叙事', count: 33 },
    ],
  },
  {
    id: 'video',
    label: '视频',
    canAddChild: true,
    children: [
      { id: 'v-generated', label: '生成视频', count: 12 },
      { id: 'v-uploaded', label: '上传视频', count: 4 },
    ],
  },
  {
    id: 'assets',
    label: '资产',
    canAddChild: false,
    children: [
      { id: 'a-image', label: '图片', count: 28 },
      { id: 'a-bgm', label: 'BGM', count: 6 },
    ],
  },
  {
    id: 'ui',
    label: '界面',
    canAddChild: true,
    children: [
      { id: 'u-overlay', label: '自定义界面', count: 9 },
    ],
  },
  {
    id: 'rule',
    label: '规则',
    canAddChild: false,
    children: [
      { id: 'r-entity', label: '实体', count: 5 },
      { id: 'r-variable', label: '变量', count: 18 },
      { id: 'r-formula', label: '公式', count: 7 },
    ],
  },
  {
    id: 'play',
    label: '试玩',
    canAddChild: false,
    children: [],
  },
]

const NEW_SIDEBAR_CSS = `
/* ── 新版左侧栏 · Figma 12650_5727 ────────────────────────────────── */
.ns-sidebar {
  --ns-bg: #2C2C2C;
  --ns-line: rgba(255, 255, 255, 0.10);
  --ns-line-soft: rgba(255, 255, 255, 0.04);
  --ns-text: #FFFFFF;
  --ns-text-soft: rgba(255, 255, 255, 0.55);
  --ns-row-h: 46px;
  --ns-row-radius: 8px;
  --ns-pad-x: 12px;
  --ns-gap: 2px;

  width: 318px;
  flex: none;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--ns-bg);
  color: var(--ns-text);
  font-family: 'PingFang SC', system-ui, -apple-system, 'Segoe UI', sans-serif;
  border-right: 1px solid var(--ns-line);
}

/* 一级标题栏：318×42，左 chevron + 标题 + 右「＋」。 */
.ns-group-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 12px;
  border-bottom: 1px solid var(--ns-line);
  background: var(--ns-bg);
  user-select: none;
}
.ns-group-head:hover { background: #323232; }
.ns-group-head.is-active { background: #313131; }

/* chevron：默认向下（展开），is-collapsed 时旋转 -90deg 指向右（收起）。 */
.ns-chev {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--ns-text);
  transition: transform .18s ease;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
}
.ns-chev svg { width: 20px; height: 20px; display: block; }
.ns-group.is-collapsed .ns-chev { transform: rotate(-90deg); }

.ns-title {
  flex: 1;
  min-width: 0;
  font-size: 20px;
  font-weight: 400;
  line-height: 1;
  color: var(--ns-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}

/* 右侧「＋」快速新增子级按钮（部分一级提供）。 */
.ns-add {
  flex: none;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--ns-text);
  cursor: pointer;
  padding: 0;
  transition: background .12s;
}
.ns-add:hover { background: rgba(255, 255, 255, 0.10); }
.ns-add svg { width: 18px; height: 18px; display: block; }

/* 二级列表容器。 */
.ns-group-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: var(--ns-gap);
}
.ns-group-body::-webkit-scrollbar { width: 6px; }
.ns-group-body::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.10);
  border-radius: 3px;
}
.ns-group-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.18);
}

/* 二级菜单项：318×46，圆角 8。 */
.ns-row {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 10px;
  height: var(--ns-row-h);
  padding: 0 var(--ns-pad-x);
  border-radius: var(--ns-row-radius);
  cursor: pointer;
  font-size: 16px;
  font-weight: 400;
  color: var(--ns-text);
  /* 未选中态：极淡白底（rgba 0.03）。 */
  background: rgba(255, 255, 255, 0.03);
  transition: background .12s, color .12s;
}
.ns-row:hover { background: rgba(255, 255, 255, 0.10); }
.ns-row.is-active {
  /* 选中态：半透明白底（rgba 0.20）。 */
  background: rgba(255, 255, 255, 0.20);
}
.ns-row:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.45);
  outline-offset: -2px;
}
.ns-row-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 数量徽标：30×21，圆角 8，白 10% 背景与描边，12px 数字。 */
.ns-count {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  height: 21px;
  padding: 0 6px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.10);
  /* outline 而非 border：不挤占布局尺寸。 */
  outline: 1px solid rgba(255, 255, 255, 0.10);
  outline-offset: -1px;
  color: var(--ns-text);
  font-size: 12px;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/* 二级空态。 */
.ns-empty {
  padding: 12px 14px;
  color: var(--ns-text-soft);
  font-size: 13px;
  line-height: 1.5;
}
`

const ChevronIcon = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M15 12.5L10 7.5L5 12.5" stroke="currentColor" strokeWidth="1.66667" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const PlusIcon = (
  <svg viewBox="0 0 18 18" fill="none" aria-hidden>
    <path d="M9.89941 2.25H8.02441L8.0625 8.16943H2.25V10.0444H8.0625V15.75H9.9375V10.0444H15.75V8.16943H9.9375L9.89941 2.25Z" fill="currentColor" />
  </svg>
)

/**
 * NewSidebar —— 新版左侧栏。
 *
 * 一级点击：调用 `setView(id)` 跳转主区视图（与旧 GraphSidebar 行为一致）。
 * 二级点击：仅本地 mock 选中态切换，不影响主区。
 * 展开规则：仅当前选中的一级默认展开；切换一级时旧的一级折叠。
 */
export function NewSidebar(): JSX.Element {
  injectStyleOnce('new-sidebar', NEW_SIDEBAR_CSS)
  const view = useGraphView((s) => s.view)
  const setView = useGraphView((s) => s.setView)
  const nodeCount = useGraphScenario((s) => s.graph?.nodes?.length ?? 0)

  /** 当前展开的一级 id；null 表示全部折叠（与选中一级联动；点击 chevron 可单独切换折叠）。 */
  const [expandedId, setExpandedId] = useState<GraphView | null>(view)
  /** 二级本地选中态：key = 一级 id，value = 该一级下选中的二级 id。 */
  const [selectedChild, setSelectedChild] = useState<Record<string, string>>({})

  // 切换一级视图时同步默认展开项（仅展开当前选中一级）。
  useEffect(() => {
    setExpandedId(view)
  }, [view])

  const onGroupHeadClick = (g: NavGroup): void => {
    // 点标题 = 切到该一级 → setView 跳转主区，并展开该一级。
    setView(g.id)
    setExpandedId(g.id)
  }

  const onToggleChevron = (g: NavGroup): void => {
    // 单独点 chevron：只切折叠/展开，不切一级视图。
    setExpandedId((cur) => (cur === g.id ? null : g.id))
  }

  const onChildClick = (groupId: GraphView, childId: string): void => {
    // 二级点击仅本地 mock 选中态，不影响主区。
    setSelectedChild((cur) => ({ ...cur, [groupId]: childId }))
  }

  const onAddChild = (g: NavGroup): void => {
    // 占位：mock「＋」按钮。点击无副作用，等接入真实新增能力时再实现。
    // 暂用 console.log 留痕，方便视觉还原时确认按钮可达。
    // eslint-disable-next-line no-console
    console.log('[NewSidebar] add child for', g.id)
  }

  return (
    <aside className="ns-sidebar" aria-label="视频游戏工坊（新版侧栏）">
      {NAV_GROUPS.map((g) => {
        const isExpanded = expandedId === g.id
        const isActiveView = view === g.id
        const activeChildId = selectedChild[g.id]
        return (
          <section
            key={g.id}
            className={`ns-group${isExpanded ? '' : ' is-collapsed'}`}
            aria-label={g.label}
          >
            <header
              className={`ns-group-head${isActiveView ? ' is-active' : ''}`}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-controls={`ns-group-body-${g.id}`}
              onClick={() => onGroupHeadClick(g)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onGroupHeadClick(g)
                }
              }}
            >
              <button
                type="button"
                className="ns-chev"
                aria-label={isExpanded ? '收起' : '展开'}
                aria-expanded={isExpanded}
                // 单独点 chevron：切换展开/收起，不影响一级视图跳转。
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleChevron(g)
                }}
              >
                {ChevronIcon}
              </button>
              <span className="ns-title">{g.label}</span>
              {g.canAddChild && (
                <button
                  type="button"
                  className="ns-add"
                  aria-label={`新增${g.label}子项`}
                  title={`新增${g.label}子项`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddChild(g)
                  }}
                >
                  {PlusIcon}
                </button>
              )}
            </header>
            {isExpanded && (
              <div
                id={`ns-group-body-${g.id}`}
                className="ns-group-body"
                role="group"
                aria-label={`${g.label}子项`}
              >
                {g.children.length === 0 ? (
                  <div className="ns-empty">
                    {g.id === 'play' ? '暂无子项 · 点试玩直接进入预览' : '暂无子项'}
                  </div>
                ) : (
                  g.children.map((child) => {
                    const isActive = activeChildId === child.id
                    return (
                      <button
                        key={child.id}
                        type="button"
                        className={`ns-row${isActive ? ' is-active' : ''}`}
                        aria-pressed={isActive}
                        onClick={() => onChildClick(g.id, child.id)}
                      >
                        <span className="ns-row-label">{child.label}</span>
                        {typeof child.count === 'number' && (
                          <span className="ns-count" aria-label={`${child.label} 共 ${child.count} 项`}>
                            {child.count}
                          </span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </section>
        )
      })}
      {/* 顶部小标识：与原 sidebar 的「节点数」徽标信息等价，便于对比验证。 */}
      <div
        style={{
          flex: 'none',
          padding: '6px 12px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          color: 'rgba(255,255,255,0.45)',
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        }}
        aria-label={`当前节点总数 ${nodeCount}`}
      >
        节点总数 {nodeCount}
      </div>
    </aside>
  )
}
