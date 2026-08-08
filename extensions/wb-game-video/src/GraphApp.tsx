/**
 * GraphApp —— 新引擎的唯一应用外壳（graph-only）。NewSidebar 的每个 tab
 * 都对应 GraphMain 的真实视图：蓝图/视频/资产/界面/规则/试玩。
 *
 * Page layout 把 sidebar/workspace 两个 Panel 放成左右布局，宿主给两个 iframe
 * 分别传 `?pane=left` / `?pane=center`。两个 iframe 通过 graphViewStore /
 * uiNavSync / graphBlueprintSync 同步 tab、界面树与蓝图库意图。
 * 无 pane 时仍按侧栏 + 主区独立运行。
 *
 * 进程内挂载（mount()）可经 props 显式传入 pane / gameId，避免改宿主 URL。
 */
import { useEffect, useMemo, useState } from 'react'
import { GraphStudio } from './editor/shell/GraphStudio'
import { GraphVideoView } from './editor/shell/GraphVideoView'
import { VideoGenerationPage } from './editor/shell/VideoGenerationPage'
import { GraphAssetView } from './editor/shell/GraphAssetView'
import { GraphConfigView } from './editor/shell/GraphConfigView'
import { GraphPlaySurface } from './editor/shell/GraphPlaySurface'
import { NewSidebar } from './editor/shell/NewSidebar'
import { DocumentLibraryView } from './editor/documents/DocumentLibraryView'
import { useGraphScenario } from './editor/persist/graphScenarioStore'
import { useGraphView, installGraphViewSync } from './editor/persist/graphViewStore'
import { installUiNavSync } from './editor/persist/uiNavSync'
import { installGraphBlueprintSync } from './editor/persist/graphBlueprintSync'
import { installAssetNavSync } from './editor/persist/assetNavStore'
import { installDocumentNavSync } from './editor/persist/documentNavStore'
import { installRuleSelectionSync } from './editor/persist/ruleSelectionStore'
import { installVideoLibraryNavSync } from './editor/persist/videoLibraryNavStore'
import { getGameSlug, setSyncGameId } from './editor/persist/gameScope'
import { injectStyleOnce } from './styles/injectStyle'
import { GameBootstrap } from './editor/bootstrap/GameBootstrap'
import { useGlobalVideoGenerationTracker } from './editor/assets/generation/videoGenerationStore'
import { useVideoAssets, type VideoAssetsController } from './editor/assets/useVideoAssets'
import { installKinoVideoCacheSync } from './editor/assets/kinoVideoCacheStore'
import { installTipSyncPolling } from './editor/persist/tipSyncPolling'

export type GraphAppPane = 'left' | 'center' | null

export type GraphAppProps = {
  /** Host-supplied pane for in-process mounts; URL query wins only when omitted. */
  pane?: GraphAppPane
  /** Host-supplied game id (slug) for in-process mounts. */
  gameId?: string
  /** When true, an uninitialized package is seeded silently (skips the guide). */
  autoInitialize?: boolean
}

function readPane(): GraphAppPane {
  try {
    const pane = new URLSearchParams(location.search).get('pane')
    return pane === 'left' || pane === 'center' ? pane : null
  } catch {
    return null
  }
}

function resolveGameSlug(explicit?: string): string {
  return explicit ?? getGameSlug() ?? 'game-nodia-fighting'
}

/** 主区——当前 tab 对应的内容。center pane 的全部内容。 */
function GraphMain({ videoController }: { videoController?: VideoAssetsController } = {}): JSX.Element {
  const view = useGraphView((state) => state.view)
  const setView = useGraphView((state) => state.setView)
  const scenarioFromStore = useGraphScenario((s) => s.scn)
  const loadEpoch = useGraphScenario((s) => s.loadEpoch)
  const game = useGraphScenario((s) => s.game)
  useGlobalVideoGenerationTracker(game)
  // The host package is the only runtime source. The bundled demo remains
  // available for explicit reset/template flows, never as a live project.
  const scenario = useMemo(
    () => scenarioFromStore(),
    [loadEpoch, scenarioFromStore],
  )
  return (
    <main className="ga-main">
      {view === 'documents' && <DocumentLibraryView />}
      {view === 'graph' && <GraphStudio scenario={scenario} />}
      {view === 'video' && <GraphVideoView controller={videoController} />}
      {view === 'video-generate' && <VideoGenerationPage onBack={() => setView('video')} />}
      {view === 'assets' && <GraphAssetView />}
      {view === 'ui' && <GraphConfigView title="界面" icon="🖥" tabs={[{ section: 'overlays', label: '自定义界面' }]} scenario={scenario} />}
      {view === 'rule' && (
        <GraphConfigView
          title="规则"
          icon="📏"
          tabs={[
            { section: 'entities', label: '实体' },
            { section: 'variables', label: '变量' },
            { section: 'formulas', label: '公式' },
          ]}
          scenario={scenario}
        />
      )}
      {view === 'play' && <GraphPlaySurface scenario={scenario} />}
    </main>
  )
}

function CombinedWorkspace({
  gameId,
  ensureBoot,
  autoInitialize,
}: {
  gameId?: string
  ensureBoot: (gameId: string) => Promise<void>
  autoInitialize?: boolean
}): JSX.Element {
  const game = useGraphScenario((state) => state.game)
  const videoController = useVideoAssets(game)
  return (
    <div className="ga-root">
      <NewSidebar videoItems={videoController.items} />
      <GameBootstrap gameId={gameId} autoInitialize={autoInitialize} onBoot={(bootGameId) => ensureBoot(bootGameId)}>
        <GraphMain videoController={videoController} />
      </GameBootstrap>
    </div>
  )
}

function LeftPane({ gameSlug }: { gameSlug: string }): JSX.Element {
  const ensureBoot = useGraphScenario((state) => state.ensureBoot)

  useEffect(() => {
    // 侧栏不包 GameBootstrap（避免 package guide 顶掉导航），但仍需加载同一 persist。
    void ensureBoot(gameSlug)
  }, [ensureBoot, gameSlug])

  return (
    <div className="ga-root is-pane-left">
      <NewSidebar uiNavMode="left" />
    </div>
  )
}

export function GraphApp({ pane: explicitPane, gameId, autoInitialize }: GraphAppProps = {}): JSX.Element {
  injectStyleOnce('graph-app-shell', CSS)
  const [pane] = useState(() => (explicitPane === undefined ? readPane() : explicitPane))
  const ensureBoot = useGraphScenario((state) => state.ensureBoot)
  const booted = useGraphScenario((state) => state.booted)
  const gameSlug = resolveGameSlug(gameId)
  // 权威 game 来源：boot 后由 store 写入（center 来自宿主握手的 context.gameId，
  // left 来自 ensureBoot）。频道命名必须等它到位，否则同源多 tab 会共用空后缀串台。
  const activeGame = useGraphScenario((state) => state.game)

  useEffect(() => {
    if (pane === null || !activeGame) return
    // 用真实 game 作为跨 tab 同步频道的作用域，再安装，保证不同 game 的 tab 互不收听。
    setSyncGameId(activeGame)
    const disposeView = installGraphViewSync()
    const disposeUiNav = installUiNavSync(pane)
    const disposeBp = installGraphBlueprintSync()
    const disposeAssetNav = installAssetNavSync()
    const disposeDocumentNav = installDocumentNavSync()
    const disposeVideoLibraryNav = installVideoLibraryNavSync()
    const disposeRuleSelection = installRuleSelectionSync()
    return () => {
      disposeRuleSelection()
      disposeVideoLibraryNav()
      disposeDocumentNav()
      disposeAssetNav()
      disposeBp()
      disposeUiNav()
      disposeView()
    }
  }, [pane, activeGame])

  useEffect(() => installKinoVideoCacheSync(), [])

  useEffect(() => {
    if (!booted) return
    return installTipSyncPolling()
  }, [booted])

  if (pane === 'left') {
    return <LeftPane gameSlug={gameSlug} />
  }
  if (pane === 'center') {
    return (
      <div className="ga-root is-pane-center">
        <GameBootstrap gameId={gameId} autoInitialize={autoInitialize} onBoot={(bootGameId) => ensureBoot(bootGameId)}>
          <GraphMain />
        </GameBootstrap>
      </div>
    )
  }
  return <CombinedWorkspace gameId={gameId} ensureBoot={ensureBoot} autoInitialize={autoInitialize} />
}

const CSS = `
.ga-root { position: fixed; inset: 0; display: flex; background: var(--color-background-base, #0e0c09); color: var(--color-text-primary, #f6f1e9); }
/* pane 嵌入态 / 宿主进程内挂载：填满宿主容器，不用 fixed 视口 */
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
