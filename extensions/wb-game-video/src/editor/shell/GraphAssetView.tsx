import { injectStyleOnce } from '../../styles/injectStyle'
import { useEffect, useState } from 'react'
import { AssetLibraryPanel, type BrowserAsset } from '../assets/AssetLibraryPanel'
import {
  createKinoAssetLibraryClient,
  type AssetLibraryClient,
  useAssetLibrary,
} from '../assets/assetLibraryClient'
import { useAssetDirectory } from '../assets/asset-directory'
import { loadProjectComponentAssets, type ProjectComponentAsset } from '../assets/project-component-assets'
import { fetchRegistryAssets } from '../assets/registry-assets'
import { createKinoVideoClient } from '../assets/kino-api'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { useGraphView } from '../persist/graphViewStore'
import { useAssetNav } from '../persist/assetNavStore'

const CSS = `
.alx-root { display: flex; flex: 1; min-width: 0; min-height: 0; background: var(--asset-surface); }
.alx-tree { display: flex; width: 176px; flex: 0 0 176px; min-height: 0; flex-direction: column; border-right: 1px solid var(--asset-border); background: var(--asset-surface); }
.alx-tree-title { padding: 14px 14px 9px; color: var(--asset-text-primary); font-size: 13px; font-weight: 600; }
.alx-tree-list,.alx-tree-children { margin: 0; padding: 0; list-style: none; }
.alx-tree-list { flex: 1; min-height: 0; overflow: auto; padding: 0 7px 10px; }
.alx-tree-children { padding-left: 14px; }
.alx-tree-row { display: flex; min-width: 0; height: 30px; align-items: center; border-radius: 5px; color: var(--asset-text-secondary); }
.alx-tree-row:hover { color: var(--asset-text-primary); background: var(--asset-overlay-hover); }
.alx-tree-row.is-current { color: var(--asset-text-primary); background: var(--asset-brand-soft); }
.alx-tree-expander { width: 24px; height: 28px; flex: 0 0 24px; border: 0; color: inherit; background: transparent; cursor: pointer; }
.alx-tree-link { display: flex; min-width: 0; flex: 1; align-items: center; gap: 6px; overflow: hidden; border: 0; color: inherit; background: transparent; font: inherit; font-size: 12px; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.alx-new-folder { margin: 9px; padding: 8px; border: 1px dashed var(--asset-border); border-radius: 6px; color: var(--asset-text-secondary); background: transparent; font: inherit; font-size: 12px; cursor: pointer; }
.alx-new-folder:hover { color: var(--asset-text-primary); border-color: var(--asset-brand); }
.alx-workspace { position: relative; display: flex; min-width: 0; min-height: 0; flex: 1 1 0; flex-direction: column; }
.alx-toolbar { display: flex; height: 52px; min-height: 52px; align-items: center; gap: 16px; overflow-x: auto; padding: 12px 24px; border-bottom: 1px solid var(--asset-border); background: var(--asset-surface); scrollbar-width: none; }.alx-toolbar::-webkit-scrollbar { display: none; }
.alx-action-group,.alx-toolbar-end { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 16px; }.alx-toolbar-end { margin-left: auto; }
.alx-action-group button,.alx-preset { display: inline-flex; height: 28px; flex: 0 0 auto; align-items: center; gap: 6px; padding: 2px 8px; border: 0; border-radius: 6px; color: var(--asset-text-primary); background: var(--asset-overlay); font: inherit; font-size: var(--asset-toolbar-font-size); line-height: 24px; white-space: nowrap; cursor: pointer; }.alx-action-group button:hover,.alx-preset:hover { background: var(--asset-overlay-hover); }.alx-action-group button:disabled { cursor: not-allowed; opacity: .45; }.alx-action-icon { display: inline-grid; width: 24px; height: 24px; place-items: center; line-height: 1; }.alx-action-icon img { display: block; max-width: 20px; max-height: 20px; }
.alx-toolbar > button,.alx-empty button,.alx-selection-bar button { flex: 0 0 auto; padding: 2px 8px; border: 0; border-radius: 6px; color: var(--asset-text-primary); background: var(--asset-overlay); font: inherit; font-size: var(--asset-toolbar-font-size); line-height: 24px; white-space: nowrap; cursor: pointer; }
.alx-toolbar button.is-on { color: var(--asset-text-primary); border-color: var(--asset-brand); background: var(--asset-brand); }
.alx-toolbar button:disabled,.alx-empty button:disabled { opacity: .48; cursor: not-allowed; }
.alx-search { display: flex; width: 221px; height: 28px; flex: 0 0 221px; align-items: center; gap: 6px; padding: 0 8px; border: 0; border-radius: 8px; color: var(--asset-text-muted); background: var(--asset-overlay); }
.alx-search:focus-within { box-shadow: inset 0 0 0 2px var(--asset-focus); }
.alx-search-icon { display: grid; width: 24px; height: 24px; flex: 0 0 24px; place-items: center; }.alx-search-icon img { display: block; width: 24px; height: 24px; }
.alx-search-clear { display: grid; width: 18px; height: 18px; flex: 0 0 18px; place-items: center; border: 0; border-radius: 50%; padding: 0; color: var(--asset-text-muted, var(--asset-text-muted)); background: transparent; font: inherit; font-size: 18px; line-height: 1; cursor: pointer; }.alx-search-clear:hover { color: var(--asset-text-primary, var(--asset-text-primary)); background: var(--asset-overlay, rgba(255,255,255,.1)); }
.alx-search input,.alx-search input:focus,.alx-search input:focus-visible { width: 100%; height: 28px; border: 0 !important; outline: 0 !important; box-shadow: none !important; color: var(--asset-text-primary); background: transparent; font: inherit; font-size: var(--asset-toolbar-font-size); }
.alx-breadcrumb { display: flex; min-height: 40px; align-items: center; gap: 7px; padding: 0 24px; color: var(--asset-text-muted); font-size: 12px; }
.alx-breadcrumb > span { display: inline-flex; align-items: center; gap: 7px; }
.alx-breadcrumb > span.is-drop-target { border-radius: 4px; outline: 1px solid var(--asset-brand); outline-offset: 3px; color: var(--asset-text-primary); background: var(--asset-brand-soft); }
.alx-breadcrumb button { padding: 0; border: 0; color: var(--asset-text-secondary); background: transparent; font: inherit; cursor: pointer; }
.alx-breadcrumb button:disabled { color: var(--asset-text-primary); cursor: default; }
.alx-message,.alx-selection-bar { margin: 0 24px 10px; padding: 8px 10px; border: 1px solid var(--asset-border); border-radius: 6px; color: var(--asset-text-secondary); background: var(--asset-canvas); font-size: 12px; }
.alx-message button { margin-left: 8px; border: 0; color: var(--asset-text-secondary); background: transparent; font: inherit; cursor: pointer; }
.alx-message.is-error { color: var(--color-text-danger); }
.alx-selection-bar { display: flex; align-items: center; gap: 8px; }
.alx-grid { display: grid; flex: 1; min-height: 0; grid-template-columns: repeat(auto-fill, 140px); align-content: start; gap: 24px 52px; overflow: auto; padding: 20px 24px 26px; }
.alx-folder-card { position: relative; width: 140px; min-width: 0; min-height: 169px; overflow: visible; border: 0; border-radius: 0; background: transparent; }
.alx-asset-card { position: relative; width: 140px; min-width: 0; min-height: 169px; overflow: visible; border: 0; border-radius: 0; background: transparent; }
.alx-folder-card:hover,.alx-asset-card:hover { transform: translateY(var(--motion-hover-y)); }
.alx-folder-card.is-drop-ready .alx-folder-visual { transition: outline var(--motion-duration-fast) var(--motion-ease-out), filter var(--motion-duration-fast) var(--motion-ease-out); }
.alx-folder-card.is-drop-target .alx-folder-visual { outline: 1px solid var(--asset-brand); outline-offset: 3px; background: var(--asset-brand-soft); filter: none; }
.alx-asset-card { cursor: grab; }.alx-asset-card.is-dragging { cursor: grabbing; opacity: .42; transform: scale(.96); }
.alx-folder-open { display: flex; width: 100%; min-height: 169px; flex-direction: column; align-items: center; gap: 0; padding: 0; border: 0; color: var(--asset-text-primary); background: transparent; font: inherit; font-size: 14px; line-height: 20px; text-align: center; cursor: pointer; }
.alx-folder-open > span:last-child { display: block; box-sizing: border-box; width: 100%; padding: 4px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alx-asset-open { display: flex; width: 100%; min-height: 169px; flex-direction: column; align-items: center; gap: 0; padding: 0; border: 0; color: var(--asset-text-primary); background: transparent; font: inherit; font-size: 14px; line-height: 20px; text-align: center; cursor: pointer; }
.alx-asset-thumb { display: grid; width: 140px; height: 140px; flex: 0 0 140px; place-items: center; overflow: hidden; border-radius: 6px; color: var(--asset-brand-light); background: var(--asset-overlay); font-size: 34px; }
.alx-component-preview { position: relative; display: grid; width: 100%; height: 100%; place-items: center; overflow: hidden; pointer-events: none; }.alx-component-preview,.alx-component-preview * { pointer-events: none !important; }.alx-component-preview-stage { position: relative; width: 100%; height: 100%; overflow: hidden; }.alx-component-preview-stage > * { max-width: 100%; }.alx-component-preview-fallback { display: grid; width: 100%; height: 100%; place-items: center; color: var(--asset-brand-light); font-size: 34px; }.alx-component-preview.is-folder .alx-component-preview-fallback { font-size: 14px; }.alx-component-preview.is-detail { min-height: 220px; border: 1px solid var(--asset-border); border-radius: 6px; background: var(--asset-canvas); }
.alx-audio-waveform { display: flex; width: 110px; height: 32px; align-items: center; gap: 2px; }
.alx-audio-waveform i { display: block; width: 2px; flex: 0 0 2px; border-radius: 22369600px; background: rgba(255,255,255,.2); }
.alx-folder-visual { position: relative; display: flex; width: 140px; height: 140px; flex: 0 0 140px; overflow: visible; background: rgba(255,255,255,.1); clip-path: path('M0 6C0 2.6863 2.68629 0 6 0H50.8506C52.5206 0 54.115 0.695986 55.2505 1.92058L71.8399 19.813C72.9753 21.0376 74.5698 21.7335 76.2397 21.7335H134C137.314 21.7335 140 24.4198 140 27.7335V134C140 137.314 137.314 140 134 140H6C2.6863 140 0 137.314 0 134V6Z'); }
.alx-folder-preview { position: absolute; z-index: 1; top: 41px; left: 9px; display: grid; width: 121px; height: 78px; grid-template-columns: repeat(3, 34px); grid-template-rows: repeat(2, 34px); gap: 8px; }
.alx-folder-preview-item { display: grid; min-width: 0; min-height: 0; place-items: center; overflow: hidden; border-radius: 6px; color: var(--asset-text-secondary); background: rgba(255,255,255,.1); font-size: 14px; }
.alx-folder-preview-item.is-folder { background: transparent; }.alx-folder-preview-folder { display: block; width: 34px; height: 34px; overflow: hidden; }.alx-folder-preview-folder .alx-folder-visual { width: 140px; height: 140px; flex: none; transform: scale(.242857); transform-origin: top left; background: var(--asset-overlay-hover); }
.alx-folder-preview-item img,.alx-folder-preview-item video { width: 100%; height: 100%; object-fit: cover; }
.alx-asset-thumb img,.alx-asset-thumb video { width: 100%; height: 100%; object-fit: cover; object-position: center; }
.alx-video-thumbnail { display: block; width: 100%; height: 100%; object-fit: cover; background: var(--asset-surface-deep); pointer-events: none; }
.alx-asset-open > span:not(.alx-asset-thumb) { box-sizing: border-box; max-width: 100%; padding: 4px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.alx-asset-open small { display: none; }
.alx-more,.alx-card-close { position: absolute; top: 4px; right: 4px; z-index: 3; display: grid; width: 26px; height: 26px; place-items: center; border: 1px solid rgba(255,255,255,.24); border-radius: 6px; padding: 0 0 3px; color: rgba(255,255,255,.95); background: rgba(0,0,0,.5); font: inherit; font-size: 17px; line-height: 1; cursor: pointer; opacity: 0; transition: opacity var(--motion-duration-fast) var(--motion-ease-out), background var(--motion-duration-fast) var(--motion-ease-out); }.alx-folder-card:hover .alx-more,.alx-folder-card:focus-within .alx-more,.alx-asset-card:hover .alx-card-close,.alx-asset-card:focus-within .alx-card-close { opacity: 1; }.alx-more:hover,.alx-more:focus-visible,.alx-card-close:hover,.alx-card-close:focus-visible { background: rgba(0,0,0,.78); outline: 2px solid var(--asset-focus); outline-offset: 1px; }
.alx-more { padding: 0; }
.alx-folder-menu { position: absolute; top: 34px; right: 4px; z-index: 4; display: flex; width: 120px; flex-direction: column; padding: 4px; border: 1px solid rgba(255,255,255,.18); border-radius: 6px; background: #303030; box-shadow: 0 8px 20px rgba(0,0,0,.4); }
.alx-folder-menu button { padding: 6px 7px; border: 0; border-radius: 4px; color: var(--asset-text-secondary); background: transparent; font: inherit; font-size: 11px; text-align: left; cursor: pointer; }
.alx-folder-menu button:hover { color: var(--asset-text-primary); background: var(--asset-overlay-hover); }
.alx-asset-card.is-selected .alx-asset-thumb { outline: 2px solid var(--asset-brand); outline-offset: -2px; }
.alx-check { position: absolute; top: 8px; right: 8px; z-index: 1; }
.alx-check input { accent-color: var(--asset-brand); }
.alx-empty { position: absolute; top: 54%; left: 50%; display: flex; width: min(360px, calc(100% - 32px)); flex-direction: column; align-items: center; gap: 10px; transform: translate(-50%, -50%); color: var(--asset-text-secondary); font-size: 12px; text-align: center; }
.alx-empty > span { color: var(--asset-text-muted); font-size: 46px; }.alx-empty strong { color: var(--asset-text-primary); font-size: 14px; }.alx-empty p { margin: 0; }.alx-empty div { display: flex; gap: 7px; }
.alx-dialog-backdrop { position: fixed; inset: 0; z-index: var(--z-app-modal); display: grid; place-items: center; background: var(--color-overlay-modal); }
.alx-dialog { display: flex; width: min(400px, calc(100% - 32px)); flex-direction: column; gap: 14px; padding: 16px; border: 1px solid var(--asset-border); border-radius: 8px; color: var(--asset-text-primary); background: var(--asset-surface); }
.alx-dialog h2,.alx-dialog p { margin: 0; }.alx-dialog label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; }.alx-dialog input { padding: 8px; border: 1px solid var(--asset-border); border-radius: 5px; color: var(--asset-text-primary); background: var(--asset-canvas); }
.alx-dialog > div { display: flex; justify-content: space-between; gap: 8px; }.alx-dialog button { padding: 6px 9px; border: 1px solid var(--asset-border); border-radius: 5px; color: var(--asset-text-primary); background: var(--asset-canvas); cursor: pointer; }.alx-dialog > div > button:last-child { border-color: var(--asset-brand); background: var(--asset-brand); color: var(--asset-text-primary); }
.alx-preview-dialog { width: min(720px, calc(100% - 32px)); max-height: calc(100dvh - 32px); }.alx-preview-image,.alx-preview-video,.alx-preview-audio,.alx-preview-empty { width: 100%; max-height: 65dvh; object-fit: contain; }.alx-preview-empty { display: grid; min-height: 180px; place-items: center; border: 1px dashed var(--asset-border); border-radius: 6px; color: var(--asset-text-muted); font-size: 44px; }
.alx-detail { position: relative; display: flex; width: 480px; flex: 0 0 480px; min-height: 0; flex-direction: column; overflow: auto; border-left: 1px solid var(--asset-border); background: var(--asset-surface); }.alx-detail-close { position: absolute; top: 10px; right: 10px; z-index: 1; display: grid; width: 28px; height: 28px; place-items: center; border: 0; border-radius: 6px; padding: 0; color: var(--asset-text-secondary); background: var(--asset-overlay); font: inherit; font-size: 20px; line-height: 1; cursor: pointer; }.alx-detail-close:hover,.alx-detail-close:focus-visible { color: var(--asset-text-primary); background: var(--asset-overlay-hover); outline: 2px solid var(--asset-focus); outline-offset: 1px; }
.alx-root.is-detail-pane .alx-workspace { display: none; }
.alx-root.is-detail-pane .alx-detail { width: 100%; flex: 1 1 0; border-left: 0; }
.alx-detail-preview { display: grid; min-height: 250px; place-items: center; padding: 16px 24px; }.alx-detail-preview .alx-preview-image,.alx-detail-preview .alx-preview-video { max-height: 250px; }.alx-detail-preview .alx-preview-audio { width: 100%; }.alx-detail-preview .alx-preview-empty { width: 100%; min-height: 220px; }
.alx-detail-actions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; padding: 0 24px 16px; border-bottom: 1px solid var(--asset-border); }.alx-detail-actions button { display: flex; height: 28px; align-items: center; justify-content: center; border: 1px solid var(--asset-border); border-radius: 4px; padding: 0 8px; color: var(--asset-text-secondary); background: var(--asset-canvas); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; }.alx-detail-actions button:disabled { cursor: not-allowed; opacity: .48; }.alx-detail-readonly { grid-column: 1 / -1; margin: 0; color: var(--asset-text-muted); font-size: 12px; text-align: center; }
.alx-detail-fields { display: flex; flex-direction: column; gap: 14px; padding: 16px 24px; }.alx-detail-fields h2 { margin: 0; color: var(--asset-text-primary); font-size: 14px; }.alx-detail-fields label { display: flex; flex-direction: column; gap: 7px; color: var(--asset-text-secondary); font-size: 12px; }.alx-detail-fields label > span { color: var(--asset-text-muted); }.alx-detail-fields strong { font-weight: 400; }.alx-detail-fields input,.alx-detail-fields select,.alx-detail-fields textarea { box-sizing: border-box; width: 100%; border: 1px solid var(--asset-border); border-radius: 4px; padding: 6px 9px; color: var(--asset-text-primary); background: var(--asset-canvas); font: inherit; font-size: 12px; }.alx-detail-fields textarea { height: 80px; resize: none; }.alx-detail-fields input:disabled,.alx-detail-fields select:disabled { opacity: .5; }
.alx-detail-empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 32px; color: var(--asset-text-muted); font-size: 12px; text-align: center; }.alx-detail-empty > span { font-size: 40px; }.alx-detail-empty strong { color: var(--asset-text-primary); font-size: 14px; }.alx-detail-empty p { margin: 0; }
.ig-root { display: flex; width: 100%; min-width: 0; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; background: var(--asset-surface); color: #fff; }.ig-toolbar { display: flex; height: 48px; flex: 0 0 48px; align-items: center; gap: 10px; padding: 0 24px; }.ig-toolbar h1 { margin: 0; font-size: 20px; font-weight: 400; line-height: 48px; }.ig-back { display: grid; width: 24px; height: 24px; place-items: center; border: 0; padding: 0; color: #fff; background: transparent; font-size: 32px; font-weight: 200; line-height: 1; cursor: pointer; }.ig-search { display: flex; width: 221px; height: 28px; align-items: center; gap: 6px; margin-left: auto; padding: 0 8px; border-radius: 8px; color: rgba(255,255,255,.4); background: rgba(255,255,255,.1); }.ig-search input { width: 100%; border: 0; outline: 0; color: #fff; background: transparent; font: inherit; font-size: 16px; }.ig-content { display: flex; min-width: 0; flex: 1; gap: 40px; overflow: auto; padding: 20px 24px 40px; }.ig-params { display: flex; width: 300px; min-width: 300px; flex-direction: column; justify-content: space-between; gap: 20px; }.ig-fields { display: flex; flex-direction: column; gap: 20px; }.ig-field { display: flex; flex-direction: column; gap: 6px; position: relative; }.ig-field small { color: rgba(255,255,255,.2); font-size: 12px; }.ig-field-title { display: flex; align-items: center; gap: 8px; color: #fff; font-size: 14px; }.ig-field-title > span { width: 3px; height: 11px; border-radius: 2px; background: #e8864a; }.ig-reference { display: flex; gap: 6px; }.ig-reference-preview { display: grid; width: 70px; height: 70px; place-items: center; border-radius: 8px; color: #ff9c2a; background: #333; font-size: 28px; }.ig-reference-actions { display: flex; width: 70px; flex-direction: column; gap: 8px; padding: 8px 3px; border-radius: 8px; background: #333; }.ig-reference-actions button { height: 23px; border: 0; border-radius: 6px; color: #fff; background: rgba(255,255,255,.1); font: inherit; font-size: 12px; cursor: pointer; }.ig-reference-actions button.is-active { color: #000; background: #e8864a; }.ig-field textarea,.ig-field select { box-sizing: border-box; width: 100%; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 8px 12px; outline: 0; color: #fff; background: #1a1a1a; font: inherit; font-size: 12px; }.ig-field textarea { height: 80px; resize: none; }.ig-field select { height: 32px; }.ig-options { display: flex; flex-wrap: wrap; gap: 8px; }.ig-options button { height: 28px; min-width: 36px; border: 1px solid rgba(255,255,255,.1); border-radius: 6px; padding: 4px 10px; color: rgba(255,255,255,.6); background: #1a1a1a; font: inherit; font-size: 12px; cursor: pointer; }.ig-options button.is-active { border-color: #e8864a; color: #000; background: #e8864a; }.ig-preset-row { display: flex; align-items: center; justify-content: space-between; }.ig-preset-row button { height: 24px; border: 1px solid rgba(255,156,42,.6); border-radius: 4px; padding: 1px 20px; color: #ff9c2a; background: transparent; font: inherit; font-size: 12px; cursor: pointer; }.ig-preset-popover { display: flex; gap: 6px; margin-top: -12px; border: 1px solid rgba(255,255,255,.15); border-radius: 8px; padding: 8px; background: #252525; font-size: 12px; }.ig-preset-popover button { border: 0; border-radius: 4px; padding: 5px; color: #fff; background: rgba(255,255,255,.1); cursor: pointer; }.ig-generate { display: flex; width: 100%; height: 32px; align-items: center; justify-content: center; gap: 10px; border: 0; border-radius: 8px; color: #000; background: linear-gradient(90deg,#ff7001,#ff9c2a); font: inherit; font-size: 16px; cursor: pointer; }.ig-results { display: flex; min-width: 0; flex: 1; flex-direction: column; justify-content: space-between; gap: 20px; }.ig-results-head { display: flex; align-items: center; justify-content: space-between; }.ig-results-head > div { display: flex; align-items: center; gap: 10px; }.ig-results h2 { margin: 0; font-size: 16px; }.ig-results small { color: rgba(255,255,255,.4); font-size: 12px; }.ig-history { height: 31px; border: 0; border-radius: 8px; padding: 0 14px; color: #fff; background: rgba(255,255,255,.1); font: inherit; font-size: 14px; cursor: pointer; }.ig-primary-result { display: grid; height: min(506px,52vh); place-items: center; overflow: hidden; border-radius: 8px; background: #1a1a1a; }.ig-primary-result img { width: 100%; height: 100%; object-fit: cover; }.ig-result-grid { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 12px; }.ig-result-grid button { min-width: 0; overflow: hidden; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 0; background: #1a1a1a; cursor: pointer; }.ig-result-grid button.is-active { border: 2px solid #e8864a; }.ig-result-grid img { display: block; width: 100%; aspect-ratio: 237 / 160; object-fit: cover; }.ig-history-list { display: flex; min-height: 506px; flex-direction: column; align-items: center; justify-content: center; gap: 12px; border-radius: 8px; background: #1a1a1a; color: rgba(255,255,255,.4); }.ig-history-list p { margin: 0; }.ig-history-list button { border: 1px solid rgba(255,255,255,.1); border-radius: 6px; padding: 8px 12px; color: #fff; background: rgba(255,255,255,.1); cursor: pointer; }
.ig-reference-preview { overflow: hidden; }.ig-reference-preview img { width: 100%; height: 100%; object-fit: cover; }.ig-project-picker { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 6px; border: 1px solid rgba(255,255,255,.15); border-radius: 8px; padding: 8px; background: #252525; }.ig-project-picker strong,.ig-project-picker p { grid-column: 1 / -1; margin: 0; font-size: 12px; }.ig-project-picker p { color: rgba(255,255,255,.4); }.ig-project-picker button { display: flex; min-width: 0; align-items: center; gap: 5px; overflow: hidden; border: 0; border-radius: 4px; padding: 4px; color: #fff; background: rgba(255,255,255,.1); font: inherit; font-size: 11px; cursor: pointer; }.ig-project-picker button:disabled { cursor: not-allowed; opacity: .45; }.ig-project-picker img { width: 28px; height: 28px; flex: 0 0 28px; border-radius: 3px; object-fit: cover; }.ig-project-picker span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.ig-history { display: inline-flex; align-items: center; gap: 6px; }.ig-history img { width: 24px; height: 24px; }
.alx-root,.ig-root { --asset-canvas: #1a1a1a; --asset-surface: #333333; --asset-surface-deep: #1a1a1a; --asset-brand: #e8864a; --asset-brand-light: #ff9c2a; --asset-brand-soft: rgba(232,134,74,.2); --asset-text-primary: #fff; --asset-text-secondary: rgba(255,255,255,.6); --asset-text-muted: rgba(255,255,255,.4); --asset-text-disabled: rgba(255,255,255,.2); --asset-overlay: rgba(255,255,255,.1); --asset-overlay-hover: rgba(255,255,255,.16); --asset-border: rgba(255,255,255,.1); --asset-border-strong: rgba(255,255,255,.15); --asset-focus: rgba(232,134,74,.75); --asset-toolbar-font-size: 16px; }
@media (max-width: 1040px) { .alx-detail { width: 360px; flex-basis: 360px; }.alx-grid { gap: 20px; padding: 20px; } }
@media (max-width: 780px) { .alx-tree { width: 132px; flex-basis: 132px; }.alx-toolbar { flex-wrap: nowrap; }.alx-search { order: initial; width: 221px; margin-left: 0; }.alx-grid { grid-template-columns: repeat(auto-fill, 140px); gap: 20px; }.alx-root:not(.is-detail-pane) .alx-detail { display: none; }.alx-asset-actions { opacity: 1; }.ig-content { gap: 24px; }.ig-params { width: 260px; min-width: 260px; }.ig-result-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
`

const kinoVideoClient = createKinoVideoClient()

export function GraphAssetView({ client }: { client?: AssetLibraryClient }): JSX.Element {
  injectStyleOnce('graph-asset-view', CSS)
  const gameId = useGraphScenario((state) => state.game)
  const setView = useGraphView((state) => state.setView)
  const controller = useAssetLibrary(gameId, client ?? kinoAssetLibraryClient)
  const directory = useAssetDirectory(gameId)
  const requestedRoot = useAssetNav((state) => state.root)
  const requestedFolderId = useAssetNav((state) => state.folderId)
  const requestedEntryKey = useAssetNav((state) => state.entryKey)
  const [videoAssets, setVideoAssets] = useState<BrowserAsset[]>([])
  const [projectComponents, setProjectComponents] = useState<ProjectComponentAsset[]>([])

  useEffect(() => {
    let active = true
    void Promise.all([
      fetchRegistryAssets(gameId, 'video'),
      kinoVideoClient.list({
        game_id: gameId,
        media_type: 'video',
        page: 1,
        page_size: 100,
      }),
    ])
      .then(([assets, kinoVideos]) => {
        if (!active) return
        const resourceById = new Map(
          kinoVideos.items.map((resource) => [resource.resource_id, resource]),
        )
        setVideoAssets(assets.flatMap((asset) => {
          const kinoVideo = resourceById.get(asset.id)
          // A registry record without either a registry URL or a Kino video
          // resource cannot be previewed as video. Exclude it instead of
          // rendering the misleading fallback play icon in the 视频目录.
          const url = kinoVideo?.url ?? asset.url
          if (!url) return []
          return [{
            id: asset.id,
            kind: 'video' as const,
            name: asset.label ?? asset.id,
            url,
            mime: asset.mime ?? kinoVideo?.source_meta?.mime_type,
            bytes: asset.bytes,
            readOnly: true,
          }]
        }))
      })
      .catch(() => {
        if (active) setVideoAssets([])
      })
    return () => { active = false }
  }, [gameId])
  useEffect(() => {
    let active = true
    void loadProjectComponentAssets().then((components) => {
      if (active) setProjectComponents(components)
    })
    return () => { active = false }
  }, [gameId])

  return <AssetLibraryPanel
    controller={controller}
    directory={directory}
    videoAssets={videoAssets}
    projectComponents={projectComponents}
    requestedRoot={requestedRoot}
    requestedFolderId={requestedFolderId}
    requestedEntryKey={requestedEntryKey}
    onVideoGenerate={() => setView('video-generate')}
  />
}

const kinoAssetLibraryClient = createKinoAssetLibraryClient()
