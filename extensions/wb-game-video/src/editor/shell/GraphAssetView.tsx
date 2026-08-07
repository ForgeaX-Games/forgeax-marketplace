import { injectStyleOnce } from '../../styles/injectStyle'
import { AssetLibraryPanel } from '../assets/AssetLibraryPanel'
import {
  createKinoAssetLibraryClient,
  type AssetLibraryClient,
  useAssetLibrary,
} from '../assets/assetLibraryClient'
import { getGameSlug } from '../persist/gameScope'

const CSS = `
.alp-root { position: relative; display: flex; flex: 1; min-height: 0; min-width: 0; flex-direction: column; }
.alp-shell { display: flex; flex: 1; min-height: 0; min-width: 0; }
.alp-kind-tabs { display: flex; width: 132px; flex: 0 0 132px; flex-direction: column; gap: 4px; padding: 8px; border-right: 1px solid var(--color-border-default); background: var(--color-background-base); }
.alp-kind-tabs button { display: flex; min-height: 34px; align-items: center; justify-content: space-between; gap: 8px; padding: 0 9px; border: 1px solid transparent; border-radius: 6px; color: var(--color-text-secondary); background: transparent; font: inherit; font-size: 12px; text-align: left; cursor: pointer; transition: background var(--motion-duration-fast) var(--motion-ease-out), color var(--motion-duration-fast) var(--motion-ease-out), transform var(--motion-duration-instant) var(--motion-ease-out); }
.alp-kind-tabs button:hover { background: var(--color-interaction-hover); color: var(--color-text-primary); }
.alp-kind-tabs button:active { transform: scale(var(--motion-press-scale)); }
.alp-kind-tabs button:focus-visible { outline: 2px solid var(--color-overlay-focus); outline-offset: 1px; }
.alp-kind-tabs button.is-active { border-color: var(--primary); color: var(--color-text-primary); background: var(--color-interaction-selected-brand); }
.alp-kind-tabs button span { color: var(--color-text-tertiary); font-size: 10px; }
.alp-kind-tabs button.is-active span { color: var(--primary); }
.alp-workspace { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; }
.alp-workspace-head { display: flex; min-height: 48px; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--color-divider-subtle); }
.alp-workspace-head > div { display: flex; min-width: 0; align-items: baseline; gap: 8px; }
.alp-workspace-head h2 { margin: 0; color: var(--color-text-primary); font-size: 13px; }
.alp-workspace-head > div > span { color: var(--color-text-tertiary); font-size: 11px; }
.alp-workspace-head > button,.alp-batch-bar button { border: 1px solid var(--color-border-default); border-radius: 6px; padding: 4px 8px; color: var(--color-text-secondary); background: var(--color-background-elevated); font-size: 11px; cursor: pointer; }
.alp-workspace-head > button.is-on { color: #1a1206; border-color: var(--accent, #f08840); background: var(--accent, #f08840); }
.alp-batch-bar { display: flex; align-items: center; gap: 8px; }
.alp-unavailable,.alp-error,.alp-loading { margin: 12px 12px 0; padding: 8px 10px; border: 1px solid var(--color-border-default); border-radius: 8px; font-size: 12px; color: var(--color-text-secondary); background: var(--color-background-elevated); }
.alp-error { color: var(--color-text-danger); }
.alp-list { flex: 1; min-height: 0; overflow: auto; background: var(--color-background-canvas); }
.alp-list--grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(172px, 1fr)); align-content: start; gap: 10px; padding: 12px; }
.alp-upload-tile { position: relative; display: flex; min-height: 174px; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 1px dashed var(--color-border-default); border-radius: 8px; color: var(--color-text-secondary); background: var(--color-background-base); font-size: 12px; cursor: pointer; transition: border-color var(--motion-duration-fast) var(--motion-ease-out), background var(--motion-duration-fast) var(--motion-ease-out), transform var(--motion-duration-fast) var(--motion-ease-out); }
.alp-upload-tile:hover { border-color: var(--primary); background: var(--color-interaction-hover); color: var(--color-text-primary); transform: translateY(var(--motion-hover-y)); }
.alp-upload-tile:focus-within { outline: 2px solid var(--color-overlay-focus); outline-offset: 1px; }
.alp-upload-tile[aria-disabled="true"] { color: var(--color-text-disabled); cursor: not-allowed; opacity: .65; }
.alp-upload-tile[aria-disabled="true"] input { cursor: not-allowed; }
.alp-upload-tile-plus { color: var(--primary); font-size: 32px; font-weight: 300; line-height: 1; }
.alp-upload-tile input { position: absolute; inset: 0; width: 100%; opacity: 0; cursor: pointer; }
.alp-row { position: relative; display: flex; min-width: 0; flex-direction: column; overflow: hidden; border: 1px solid var(--color-border-subtle); border-radius: 8px; background: var(--color-background-base); transition: border-color var(--motion-duration-fast) var(--motion-ease-out), transform var(--motion-duration-fast) var(--motion-ease-out); }
.alp-row-check { position: absolute; top: 8px; right: 8px; z-index: 2; display: grid; width: 18px; height: 18px; place-items: center; border-radius: 4px; background: var(--color-background-elevated); }
.alp-row-check input { margin: 0; accent-color: var(--accent, #f08840); }
.alp-row:hover { border-color: var(--color-border-default); transform: translateY(var(--motion-hover-y)); }
.alp-row.is-selected { border-color: var(--primary); background: var(--color-interaction-selected-brand); }
.alp-row-select { display: flex; min-width: 0; flex-direction: column; gap: 8px; padding: 8px; border: 0; color: var(--color-text-primary); background: transparent; font: inherit; text-align: left; cursor: pointer; }
.alp-thumbnail { display: grid; aspect-ratio: 16 / 10; place-items: center; overflow: hidden; border-radius: 5px; color: var(--color-text-tertiary); background: var(--color-background-elevated); font-size: 11px; }
.alp-thumbnail img { width: 100%; height: 100%; object-fit: cover; }
.alp-row-copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.alp-row-copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.alp-row-copy small { color: var(--color-text-tertiary); font-size: 10px; }
.alp-row-select:focus-visible { outline: 2px solid var(--color-overlay-focus); outline-offset: -2px; }
.alp-row-actions { display: inline-flex; align-items: center; gap: 2px; padding: 0 6px 7px; opacity: 0; transition: opacity var(--motion-duration-fast) var(--motion-ease-out); }
.alp-row:hover .alp-row-actions,.alp-row.is-selected .alp-row-actions,.alp-row:focus-within .alp-row-actions { opacity: 1; }
.alp-row-actions button { border: 0; border-radius: 4px; padding: 4px 5px; color: var(--color-text-secondary); background: transparent; font-size: 10px; cursor: pointer; }
.alp-row-actions button:hover { color: var(--color-text-primary); background: var(--color-interaction-hover); }
.alp-row-actions button.is-danger:hover { color: var(--color-text-danger); }
.alp-row-actions button:disabled { color: var(--color-text-disabled); cursor: not-allowed; }
.alp-stage { display: flex; min-width: 0; flex-direction: column; align-items: flex-start; gap: 14px; }
.alp-stage h2 { margin: 0; color: var(--color-text-primary); font-size: 18px; }
.alp-image { width: min(100%, 640px); max-height: 58dvh; object-fit: contain; border: 1px solid var(--color-border-subtle); border-radius: 8px; background: var(--color-background-canvas); }
.alp-audio { width: min(100%, 640px); }
.alp-preview-icon,.alp-empty { display: grid; min-height: 160px; width: min(100%, 640px); place-items: center; border: 1px dashed var(--color-border-default); border-radius: 8px; color: var(--color-text-tertiary); }
.alp-font-preview { color: var(--color-text-primary); font-family: var(--font-sans); font-size: 64px; }
.alp-meta { display: grid; width: 100%; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.alp-meta > div { display: flex; min-width: 0; flex-direction: column; gap: 3px; padding: 8px; border: 1px solid var(--color-border-subtle); border-radius: 6px; background: var(--color-background-elevated); }
.alp-meta span { color: var(--color-text-tertiary); font-size: 10px; }
.alp-meta strong { overflow: hidden; color: var(--color-text-secondary); font-size: 11px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.alp-dialog-backdrop { position: fixed; inset: 0; z-index: var(--z-app-modal); display: grid; place-items: center; background: var(--color-overlay-modal); }
.alp-dialog { display: flex; width: min(400px, calc(100% - 32px)); flex-direction: column; gap: 14px; padding: 16px; border: 1px solid var(--color-border-default); border-radius: 10px; color: var(--color-text-primary); background: var(--color-background-base); }
.alp-preview-dialog { width: min(760px, calc(100% - 32px)); max-height: calc(100dvh - 32px); overflow: auto; }
.alp-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--color-text-secondary); font-size: 12px; }
.alp-dialog-head button { flex: 0 0 auto; }
.alp-dialog label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }
.alp-dialog input { padding: 8px; border: 1px solid var(--color-border-default); border-radius: 6px; color: var(--color-text-primary); background: var(--color-background-elevated); }
.alp-dialog > div { display: flex; justify-content: flex-end; gap: 8px; }
.alp-dialog button { padding: 6px 10px; border: 1px solid var(--color-border-default); border-radius: 6px; color: var(--color-text-primary); background: var(--color-background-elevated); cursor: pointer; }
.alp-dialog button:last-child { color: var(--color-text-on-bright-primary); border-color: var(--primary); background: var(--primary); }
.alp-dialog .alp-dialog-head button { color: var(--color-text-primary); border-color: var(--color-border-default); background: var(--color-background-elevated); }
.alp-dialog button:disabled { opacity: .45; cursor: not-allowed; }
@media (max-width: 680px) { .alp-kind-tabs { width: 104px; flex-basis: 104px; } .alp-list--grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); } .alp-row-actions { opacity: 1; } .alp-meta { grid-template-columns: 1fr; } }
`

export function GraphAssetView({ client }: { client?: AssetLibraryClient }): JSX.Element {
  injectStyleOnce('graph-asset-view', CSS)
  const controller = useAssetLibrary(
    getGameSlug() ?? 'game-nodia-fighting',
    client ?? kinoAssetLibraryClient,
  )
  return <AssetLibraryPanel controller={controller} />
}

const kinoAssetLibraryClient = createKinoAssetLibraryClient()
