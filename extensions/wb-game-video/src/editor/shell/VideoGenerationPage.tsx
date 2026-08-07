import { useMemo, useState } from 'react'
import { useT } from '../../i18n'
import { injectStyleOnce } from '../../styles/injectStyle'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useVideoAssets } from '../assets/useVideoAssets'
import { useVideoGenerationWorkspace } from '../assets/generation/useVideoGenerationWorkspace'
import { requestVideoAssetSelection } from '../assets/generation/videoGenerationNavigation'
import { VideoGenSheet } from '../assets/generation/VideoGenSheet'


export interface VideoGenerationPageProps {
  onBack: () => void
}

/**
 * Full-page generation workspace. The form/state still lives in VideoGenSheet;
 * this wrapper only changes its presentation and owns the page-level data feed.
 */
export function VideoGenerationPage({ onBack }: VideoGenerationPageProps): JSX.Element {
  const t = useT()
  const game = useGraphScenario((s) => s.game)
  const videoController = useVideoAssets(game)
  const { imageAssets, recentClips, clipGeneration } = useVideoGenerationWorkspace(game, videoController)
  const [query, setQuery] = useState('')
  const [newestFirst, setNewestFirst] = useState(true)
  const modelFilterLabel = clipGeneration.state.transport === 'tool'
    ? '模型 · 兼容链路'
    : '模型 · 服务端'
  const visibleClips = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return [...recentClips]
      .filter((clip) => !normalizedQuery || clip.label.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => newestFirst
        ? right.createdAt - left.createdAt
        : left.createdAt - right.createdAt)
  }, [newestFirst, query, recentClips])

  return (
    <div className="wgv-generation-page">
      <header className="wgv-generation-page-head">
        <button type="button" className="wgv-generation-back" onClick={onBack}>
          <span aria-hidden>←</span>
          {t('videoAssets.generate.backToLibrary')}
        </button>
        <div className="wgv-generation-breadcrumb" aria-label={t('videoAssets.generate.breadcrumbAria')}>
          <span>{t('videoAssets.title')}</span>
          <span aria-hidden>/</span>
          <strong>{t('videoAssets.generate.pageTitle')}</strong>
        </div>
        <div className="wgv-generation-filters" aria-label="生成记录筛选">
          <label className="wgv-generation-search">
            <span className="wgv-sr-only">搜索生成记录</span>
            <span aria-hidden>⌕</span>
            <input
              type="search"
              value={query}
              placeholder="搜索"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="wgv-generation-filter"
            aria-pressed={!newestFirst}
            onClick={() => setNewestFirst((current) => !current)}
          >
            时间 {newestFirst ? '↓' : '↑'}
          </button>
          <button
            type="button"
            className="wgv-generation-filter is-unavailable"
            title="当前生成记录未提供逐条模型字段"
            disabled
          >
            {modelFilterLabel}
          </button>
          <button
            type="button"
            className="wgv-generation-filter is-unavailable"
            title="当前生成记录未提供逐条分辨率字段"
            disabled
          >
            分辨率 · 服务端
          </button>
        </div>
      </header>
      <VideoGenSheet
        open
        variant="page"
        gameSlug={game}
        imageAssets={imageAssets}
        recentClips={visibleClips}
        genState={clipGeneration.state}
        onSubmit={clipGeneration.submit}
        onCancel={clipGeneration.cancel}
        onTrack={clipGeneration.track}
        onClose={onBack}
        onLocateAsset={(assetId) => { requestVideoAssetSelection(assetId); onBack() }}
      />
    </div>
  )
}

const VIDEO_GENERATION_PAGE_CSS = `
.wgv-generation-page {
  --wgv-page-bg: var(--work, #0e0c09);
  --wgv-page-panel: var(--panel, #1b1713);
  --wgv-page-text: var(--txt, #f6f1e9);
  --wgv-page-muted: var(--muted, #b8aea0);
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  background: var(--wgv-page-bg);
  color: var(--wgv-page-text);
}
.wgv-generation-page-head {
  display: flex;
  align-items: center;
  gap: 18px;
  flex: none;
  min-height: 58px;
  padding: 0 24px;
  border-bottom: 1px solid var(--gc-line-soft, #2e2924);
  background: var(--wgv-page-panel);
}
.wgv-generation-filters {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin-left: auto;
}
.wgv-generation-search,
.wgv-generation-filter {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  border: 1px solid var(--gc-line-soft, #2e2924);
  border-radius: 8px;
  background: rgba(0,0,0,.2);
  color: var(--wgv-page-muted);
  font: inherit;
  font-size: 12px;
}
.wgv-generation-search { width: 152px; padding: 0 9px; }
.wgv-generation-search input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; color: var(--wgv-page-text); font: inherit; }
.wgv-generation-search input::placeholder { color: var(--wgv-page-muted); }
.wgv-generation-filter { padding: 0 9px; cursor: pointer; }
select.wgv-generation-filter { appearance: none; padding-right: 24px; }
.wgv-generation-filter:hover:not(:disabled), .wgv-generation-filter:focus-visible { border-color: var(--gc-accent, #f08840); color: var(--wgv-page-text); outline: none; }
.wgv-generation-filter.is-unavailable { cursor: not-allowed; opacity: .48; }
.wgv-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.wgv-generation-back {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--gc-line-soft, #2e2924);
  border-radius: 7px;
  background: transparent;
  color: var(--wgv-page-muted);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}
.wgv-generation-back:hover,
.wgv-generation-back:focus-visible {
  border-color: var(--gc-accent, #f08840);
  background: var(--gc-accent-soft, rgba(240,136,64,.16));
  color: var(--wgv-page-text);
  outline: none;
}
.wgv-generation-breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--wgv-page-muted);
  font-size: 13px;
}
.wgv-generation-breadcrumb strong { color: var(--wgv-page-text); font-weight: 700; }
.wgv-generation-page > .vgen-sheet {
  position: relative;
  inset: auto;
  z-index: auto;
  flex: 1;
  min-height: 0;
}
@media (max-width: 820px) {
  .wgv-generation-page-head { min-height: auto; align-items: flex-start; flex-wrap: wrap; gap: 10px; padding: 12px 14px; }
  .wgv-generation-filters { order: 3; width: 100%; margin-left: 0; overflow-x: auto; padding-bottom: 1px; }
  .wgv-generation-search { flex: 1 0 132px; }
}
`

injectStyleOnce('video-generation-page', VIDEO_GENERATION_PAGE_CSS)
