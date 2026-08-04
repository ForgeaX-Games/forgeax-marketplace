/**
 * NewSidebar —— 视频游戏的真实视图导航。
 *
 * 保留 Figma 15195_75500 的 240px 栏宽、42px 行高和图标排版；每一行都直接
 * 对应 GraphMain 的一个视图。未接入主区路由的 mock 树节点不作为可点击导航。
 */
import { injectStyleOnce } from '../../styles/injectStyle'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useGraphView, type GraphView } from '../persist/graphViewStore'

interface NavItem {
  id: GraphView
  label: string
}

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'graph', label: '蓝图' },
  { id: 'video', label: '视频' },
  { id: 'ui', label: '界面' },
  { id: 'assets', label: '资产库' },
  { id: 'rule', label: '规则' },
  { id: 'play', label: '试玩' },
]

const DocIcon = (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden>
    <path d="M5 2.5h6l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M11 2.5V6.5H15" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
)

const NEW_SIDEBAR_CSS = `
.ns-sidebar {
  --ns-bg: #2C2C2C;
  --ns-line: rgba(255, 255, 255, 0.10);
  --ns-text: #FFFFFF;
  --ns-text-80: rgba(255, 255, 255, 0.80);

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

.ns-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}
.ns-scroll::-webkit-scrollbar { width: 6px; }
.ns-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.10); border-radius: 3px; }

.ns-row {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  height: 42px;
  padding: 0 8px;
  border-bottom: 1px solid var(--ns-line);
  cursor: pointer;
  font-family: inherit;
  transition: background .12s;
}
.ns-row:hover { background: rgba(255, 255, 255, 0.04); }
.ns-row.is-active { background: rgba(255, 255, 255, 0.10); }
.ns-row:focus-visible { outline: 1px solid rgba(255,255,255,0.45); outline-offset: -1px; }

.ns-ico {
  flex: none;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
  color: var(--ns-text-80);
}
.ns-ico svg { width: 16px; height: 16px; display: block; }

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

.ns-footer {
  flex: none;
  padding: 6px 12px;
  border-top: 1px solid rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.45);
  font: 11px ui-monospace, SFMono-Regular, Menlo, monospace;
}
`

export function NewSidebar(): JSX.Element {
  injectStyleOnce('new-sidebar', NEW_SIDEBAR_CSS)
  const view = useGraphView((state) => state.view)
  const setView = useGraphView((state) => state.setView)
  const nodeCount = useGraphScenario((state) => state.graph?.nodes?.length ?? 0)

  return (
    <aside className="ns-sidebar" aria-label="视频游戏工坊">
      <nav className="ns-scroll" role="tablist" aria-label="视频游戏视图">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`ns-row${view === item.id ? ' is-active' : ''}`}
            aria-selected={view === item.id}
            onClick={() => setView(item.id)}
          >
            <span className="ns-ico">{DocIcon}</span>
            <span className="ns-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="ns-footer" aria-label={`当前节点总数 ${nodeCount}`}>
        节点总数 {nodeCount}
      </div>
    </aside>
  )
}
