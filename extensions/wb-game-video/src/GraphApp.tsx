/**
 * GraphApp —— 新引擎的唯一应用外壳（graph-only）。NewSidebar 的每个 tab
 * 都对应 GraphMain 的真实视图：蓝图/视频/资产/界面/规则/试玩。
 *
 * Page layout 把 sidebar/workspace 两个 Panel 放成左右布局，宿主给两个 iframe
 * 分别传 `?pane=left` / `?pane=center`。两个 iframe 通过 graphViewStore 与
 * BroadcastChannel 同步当前 tab；无 pane 时仍按侧栏 + 主区独立运行。
 */
import { useEffect, useState } from 'react'
import { BlueprintLibraryView } from './editor/shell/BlueprintLibraryView'
import { GraphVideoView } from './editor/shell/GraphVideoView'
import { GraphAssetView } from './editor/shell/GraphAssetView'
import { GraphConfigView } from './editor/shell/GraphConfigView'
import { GraphPlaySurface } from './editor/shell/GraphPlaySurface'
import { NewSidebar } from './editor/shell/NewSidebar'
import { useGraphScenario } from './editor/persist/graphScenarioStore'
import { useGraphView, installGraphViewSync } from './editor/persist/graphViewStore'
import { NODIA_DEMO } from './editor/demo/demo'
import { getGameSlug } from './editor/persist/gameScope'
import { injectStyleOnce } from './styles/injectStyle'
import { GameBootstrap } from './editor/bootstrap/GameBootstrap'

function readPane(): 'left' | 'center' | null {
  try {
    const pane = new URLSearchParams(location.search).get('pane')
    return pane === 'left' || pane === 'center' ? pane : null
  } catch {
    return null
  }
}

/** 主区——当前 tab 对应的内容。center pane 的全部内容。 */
function GraphMain(): JSX.Element {
  const view = useGraphView((state) => state.view)
  return (
    <main className="ga-main">
      {view === 'graph' && <BlueprintLibraryView />}
      {view === 'video' && <GraphVideoView />}
      {view === 'assets' && <GraphAssetView />}
      {view === 'ui' && <GraphConfigView title="界面" icon="🖥" tabs={[{ section: 'overlays', label: '自定义界面' }]} scenario={NODIA_DEMO} />}
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
  const ensureBoot = useGraphScenario((state) => state.ensureBoot)
  const gameSlug = getGameSlug() ?? 'game-nodia-fighting'

  useEffect(() => {
    if (pane === null) return
    return installGraphViewSync()
  }, [pane])

  if (pane === 'left') {
    return <div className="ga-root is-pane-left"><NewSidebar /></div>
  }
  if (pane === 'center') {
    return <div className="ga-root is-pane-center"><GameBootstrap slug={gameSlug} onBoot={() => ensureBoot(gameSlug, NODIA_DEMO)}><GraphMain /></GameBootstrap></div>
  }
  return (
    <div className="ga-root">
      <NewSidebar />
      <GameBootstrap slug={gameSlug} onBoot={() => ensureBoot(gameSlug, NODIA_DEMO)}><GraphMain /></GameBootstrap>
    </div>
  )
}

const CSS = `
.ga-root { position: fixed; inset: 0; display: flex; background: var(--color-background-base, #0e0c09); color: var(--color-text-primary, #f6f1e9); }
.ga-root.is-pane-left, .ga-root.is-pane-center { position: absolute; inset: 0; }
.ks-app-host .ga-root { position: absolute; inset: 0; }
.ga-root.is-pane-left .ns-sidebar { width: 100%; min-width: 0; }

.ga-main { flex: 1; min-width: 0; min-height: 0; position: relative; display: flex; flex-direction: column; overflow: hidden; }
.ga-bootstrap { flex: 1; display: grid; place-content: center; gap: 12px; padding: 32px; color: var(--color-text-primary, #f6f1e9); text-align: center; }
.ga-bootstrap h1, .ga-bootstrap p { margin: 0; }
.ga-bootstrap-actions { display: flex; justify-content: center; gap: 12px; margin-top: 8px; }
.ga-bootstrap button { padding: 8px 16px; border: 1px solid var(--color-border-default, #2e2924); border-radius: 6px; background: var(--color-background-elevated, #161310); color: inherit; cursor: pointer; }
.ga-bootstrap button:first-child { background: var(--color-brand-primary, #f08840); color: #17120d; border-color: transparent; }
`
