/**
 * GraphApp —— 新引擎的**唯一应用外壳**（graph-only）。左侧沿用旧 ReelSidebar 的
 * 视觉/交互（rs-* 胶囊 tab）：蓝图/视频/界面/规则/试玩 五个 tab，点击时中间区域
 * 显示对应 graph 视图。完全不依赖旧 FMV（scenario/editor/player/llm/media/forge）。
 *
 * split-pane 适配（对齐旧 App，见 forgeax-extension.json `surface: split`）：
 *   宿主给同一表面挂两个 iframe，URL 分别带 `?pane=left` / `?pane=center`。
 *   - pane=left   → 只渲染侧栏（五个 tab），是 sidebar iframe 的全部内容。
 *   - pane=center → 只渲染当前 tab 对应的主区内容（不含侧栏）。
 *   - 无 pane     → 独立运行（npm run dev / 直接打开 dist），侧栏 + 主区都渲染。
 *   两个 iframe 靠 graphViewStore + BroadcastChannel 同步「当前 tab」。
 */
import { useEffect, useState } from 'react'
import { BlueprintLibraryView } from './editor/shell/BlueprintLibraryView'
import { GraphVideoView } from './editor/shell/GraphVideoView'
import { GraphConfigView } from './editor/shell/GraphConfigView'
import { GraphPlaySurface } from './editor/shell/GraphPlaySurface'
import { useGraphScenario } from './editor/persist/graphScenarioStore'
import { useGraphView, installGraphViewSync, type GraphView } from './editor/persist/graphViewStore'
import { NODIA_DEMO } from './editor/demo/demo'
import { getGameSlug } from './editor/persist/gameScope'
import { injectStyleOnce } from './styles/injectStyle'

const NAV: Array<{ id: GraphView; label: string; hint: string }> = [
  { id: 'graph', label: '蓝图', hint: '新引擎蓝图工作室 · 可编辑画布 + 右上试玩浮层（点节点才出配置）' },
  { id: 'video', label: '视频', hint: '内置演出视频库 · 蓝图「视频」下拉的数据源' },
  { id: 'ui', label: '界面', hint: '覆盖物配置' },
  { id: 'rule', label: '规则', hint: '实体 / 变量 / 公式（左侧切换）' },
  { id: 'play', label: '试玩', hint: '新引擎预览 · 跑当前编辑的场景' },
]

function readPane(): 'left' | 'center' | null {
  try {
    const p = new URLSearchParams(location.search).get('pane')
    return p === 'left' || p === 'center' ? p : null
  } catch {
    return null
  }
}

/** 侧栏（rs-* 复刻旧 ReelSidebar 视觉）——左 pane 的全部内容。 */
function GraphSidebar(): JSX.Element {
  const view = useGraphView((s) => s.view)
  const setView = useGraphView((s) => s.setView)
  const nodeCount = useGraphScenario((s) => s.graph?.nodes?.length ?? 0)
  return (
    <aside className="rs-sidebar" aria-label="视频游戏工坊">
      <header className="rs-doc">
        <div className="rs-doc-title">视频游戏</div>
        <div className="rs-doc-meta">
          <span className="rs-doc-meta-num">{nodeCount}</span>
          <span className="rs-doc-meta-label">节点</span>
        </div>
      </header>
      <section className="rs-section">
        <div className="rs-pill-group">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`rs-pill${view === n.id ? ' is-active' : ''}`}
              aria-pressed={view === n.id}
              title={n.hint}
              onClick={() => setView(n.id)}
            >
              {n.label}
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}

/** 主区——当前 tab 对应的内容。center pane 的全部内容。 */
function GraphMain(): JSX.Element {
  const view = useGraphView((s) => s.view)
  return (
    <main className="ga-main">
      {view === 'graph' && <BlueprintLibraryView />}
      {view === 'video' && <GraphVideoView />}
      {view === 'ui' && <GraphConfigView title="界面" icon="🖥" tabs={[{ section: 'overlays', label: '自定义覆盖物' }]} scenario={NODIA_DEMO} />}
      {view === 'rule' && (
        <GraphConfigView
          title="规则"
          icon="📏"
          tabs={[
            { section: 'entities', label: '实体' },
            { section: 'variables', label: '变量' },
            { section: 'formulas', label: '公式' },
          ]}
          scenario={NODIA_DEMO}
        />
      )}
      {view === 'play' && <GraphPlaySurface scenario={NODIA_DEMO} />}
    </main>
  )
}

export function GraphApp(): JSX.Element {
  injectStyleOnce('graph-app-shell', CSS)
  const [pane] = useState(readPane)
  const ensureBoot = useGraphScenario((s) => s.ensureBoot)

  useEffect(() => {
    ensureBoot(getGameSlug() ?? 'game-nodia-fighting', NODIA_DEMO)
  }, [ensureBoot])

  // split-pane 嵌入态才开跨 iframe 同步桥；独立运行零开销。
  useEffect(() => {
    if (pane === null) return
    return installGraphViewSync()
  }, [pane])

  if (pane === 'left') {
    return <div className="ga-root is-pane-left"><GraphSidebar /></div>
  }
  if (pane === 'center') {
    return <div className="ga-root is-pane-center"><GraphMain /></div>
  }
  return (
    <div className="ga-root">
      <GraphSidebar />
      <GraphMain />
    </div>
  )
}

const CSS = `
.ga-root { position: fixed; inset: 0; display: flex; background: var(--color-background-base, #0e0c09); color: var(--color-text-primary, #f6f1e9); }
/* pane 嵌入态 / 宿主进程内挂载：填满宿主容器，不用 fixed 视口 */
.ga-root.is-pane-left, .ga-root.is-pane-center { position: absolute; inset: 0; }
.ks-app-host .ga-root { position: absolute; inset: 0; }
.ga-root.is-pane-left .rs-sidebar { width: 100%; }

/* 左侧栏 —— 复刻旧 ReelSidebar 视觉 */
.ga-root .rs-sidebar {
  width: 240px; flex: none;
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: var(--color-background-elevated, #161310);
  color: var(--color-text-primary, #f6f1e9);
  overflow: hidden;
  border-right: 1px solid var(--color-border-default, #2e2924);
  font-family: var(--font-sans, system-ui, sans-serif);
}
.ga-root .rs-doc {
  flex-shrink: 0; padding: 14px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  display: flex; align-items: center; gap: 8px;
}
.ga-root .rs-doc-title { flex: 0 0 auto; font-size: 15px; font-weight: 700; color: #d4ff48; line-height: normal; white-space: nowrap; }
.ga-root .rs-doc-meta {
  margin-left: auto; flex-shrink: 0; display: inline-flex; align-items: baseline; gap: 4px;
  padding: 3px 8px; border-radius: var(--radius-pill, 999px);
  background: rgba(212,255,72,0.08); border: 1px solid rgba(212,255,72,0.28);
  font-family: var(--font-mono, ui-monospace, monospace);
}
.ga-root .rs-doc-meta-num { font-size: 10px; font-weight: 700; color: #d4ff48; font-variant-numeric: tabular-nums; }
.ga-root .rs-doc-meta-label { font-size: 10px; color: #d4ff48; font-weight: 700; }
.ga-root .rs-section { flex-shrink: 0; padding: 12px 12px 10px; border-bottom: 1px solid var(--color-border-default, #2e2924); }
.ga-root .rs-pill-group {
  display: flex; gap: 1px; padding: 2px;
  background: var(--color-background-base, #0e0c09);
  border: 1px solid var(--color-border-default, #2e2924);
  border-radius: var(--radius-pill, 999px);
}
.ga-root .rs-pill {
  flex: 1; padding: 6px 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.4px;
  background: transparent; border: none; border-radius: var(--radius-pill, 999px);
  color: var(--color-text-secondary, #b8aea0); cursor: pointer; font-family: inherit;
  transition: color .12s ease, background .12s ease;
}
.ga-root .rs-pill:hover:not(.is-active) { color: var(--color-text-primary, #f6f1e9); }
.ga-root .rs-pill.is-active {
  background: color-mix(in srgb, var(--color-brand-primary, #f08840) 18%, var(--color-background-elevated, #161310));
  color: var(--color-brand-primary, #f08840);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-brand-primary, #f08840) 40%, transparent);
}

.ga-main { flex: 1; min-width: 0; min-height: 0; position: relative; display: flex; flex-direction: column; overflow: hidden; }
`
