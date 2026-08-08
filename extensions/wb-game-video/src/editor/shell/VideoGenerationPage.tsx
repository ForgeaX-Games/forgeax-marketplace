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

  return (
    <div className="wgv-generation-page">
      <header className="wgv-generation-page-head">
        <div className="wgv-generation-breadcrumb" aria-label={t('videoAssets.generate.breadcrumbAria')}>
          <button type="button" onClick={onBack}>{t('videoAssets.title')}</button>
          <span aria-hidden>/</span>
          <strong>{t('videoAssets.generate.pageTitle')}</strong>
        </div>
      </header>
      <VideoGenSheet
        open
        variant="page"
        gameSlug={game}
        imageAssets={imageAssets}
        recentClips={recentClips}
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
  --wgv-page-bg: #1a1a1a;
  --wgv-page-panel: #333;
  --wgv-page-text: #fff;
  --wgv-page-muted: rgba(255,255,255,.4);
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
  min-height: 48px;
  padding: 0 24px;
  border-bottom: 1px solid rgba(255,255,255,.1);
  background: var(--wgv-page-panel);
}
.wgv-generation-breadcrumb {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--wgv-page-muted);
  font-size: 13px;
}
.wgv-generation-breadcrumb button { padding: 0; border: 0; background: transparent; color: var(--wgv-page-muted); cursor: pointer; font: inherit; }
.wgv-generation-breadcrumb button:hover, .wgv-generation-breadcrumb button:focus-visible { color: #fff; outline: none; }
.wgv-generation-breadcrumb strong { color: var(--wgv-page-text); font-weight: 700; }
.wgv-generation-page > .vgen-sheet {
  position: relative;
  inset: auto;
  z-index: auto;
  flex: 1;
  min-height: 0;
}
@media (max-width: 820px) {
  .wgv-generation-page-head { min-height: 44px; padding: 0 14px; }
}
`

injectStyleOnce('video-generation-page', VIDEO_GENERATION_PAGE_CSS)
