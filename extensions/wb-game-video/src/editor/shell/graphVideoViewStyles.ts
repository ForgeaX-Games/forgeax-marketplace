export const GRAPH_VIDEO_VIEW_CSS = `
.gvv-toolseg { display: inline-flex; border: 1px solid var(--gc-accent-line); border-radius: 8px; overflow: hidden; }
.gvv-toolseg button { border: 0; background: var(--gc-accent-soft); color: var(--gc-muted); padding: 7px 14px; cursor: pointer; font-size: 12px; line-height: 1; }
.gvv-toolseg button + button { border-left: 1px solid var(--gc-accent-line); }
.gvv-toolseg button:hover { background: rgba(240,136,64,.24); color: var(--gc-text); }
.gvv-toolseg button.is-on { background: var(--gc-accent); color: #1a1206; font-weight: 700; }
.gc-lib-empty { color: var(--gc-faint); font-size: 12px; padding: 12px 4px; }
.gvv-video-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; min-height: 0; }
.gvv-controls { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 10px; background: var(--gc-panel2); border: 1px solid var(--gc-line-soft); flex: none; }
.gvv-controls button { flex: none; width: 32px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--gc-accent-line); background: var(--gc-accent-soft); color: var(--gc-text); border-radius: 7px; cursor: pointer; font-size: 13px; line-height: 1; }
.gvv-controls button:hover { background: rgba(240,136,64,.24); border-color: var(--gc-accent); }
.gvv-time { color: var(--gc-faint); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.gvv-timeline {
  --gvv-progress: 0%;
  min-width: 72px;
  flex: 1;
  height: 4px;
  appearance: none;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}
.gvv-timeline::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: inherit;
  background: linear-gradient(to right, var(--gc-accent) 0 var(--gvv-progress), var(--gc-line-soft) var(--gvv-progress) 100%);
}
.gvv-timeline::-webkit-slider-thumb {
  width: 12px;
  height: 12px;
  margin-top: -4px;
  appearance: none;
  border: 2px solid var(--gc-panel2);
  border-radius: 50%;
  background: var(--gc-accent);
}
.gvv-controls .gvv-loop,
.gvv-controls .gvv-mute { position: relative; }
.gvv-controls .gvv-loop:not(.is-on)::after {
  content: "";
  position: absolute;
  width: 1px;
  height: 17px;
  background: currentColor;
  transform: rotate(45deg);
}
.gvv-controls .gvv-loop.is-on,
.gvv-controls .gvv-mute.is-on { background: var(--gc-accent); border-color: var(--gc-accent); color: #1a1206; }
.gvv-controls .gvv-mute { margin-left: auto; }
.gvv-row-status { margin-left: auto; font-size: 10px; padding: 1px 6px; border-radius: 999px; line-height: 1.6; white-space: nowrap; }
.gvv-row-status.is-generating { background: rgba(240,136,64,.22); color: var(--gc-accent); }
.gvv-row-status.is-failed { background: rgba(224,72,72,.2); color: #ff8f8f; }
.gvv-row-status.is-placeholder { background: var(--gc-accent-soft); color: var(--gc-faint); }
.gvv-gen { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.gvv-gen button { border: 1px solid var(--gc-accent-line); background: var(--gc-accent); color: #1a1206; font-weight: 700; padding: 9px 12px; border-radius: 9px; cursor: pointer; font-size: 13px; }
.gvv-gen button:hover:not(:disabled) { filter: brightness(1.06); }
.gvv-gen button:disabled { opacity: 0.5; cursor: default; }
.gvv-gen-hint { font-size: 11px; color: var(--gc-faint); line-height: 1.5; }
.gvv-gen-hint.is-error { color: #ff8f8f; }
.val-library { --asset-surface: #333; --asset-canvas: #1a1a1a; --asset-overlay: rgba(255,255,255,.1); --asset-overlay-hover: rgba(255,255,255,.16); --asset-text: #fff; --asset-muted: rgba(255,255,255,.4); --asset-brand: #e8864a; box-sizing: border-box; flex: 1; border: 0; border-radius: 0; background: var(--asset-surface); box-shadow: none; }
.val-library-head { display: flex; height: 52px; min-height: 52px; align-items: center; gap: 16px; overflow-x: auto; padding: 0 24px; border-bottom: 1px solid rgba(255,255,255,.1); scrollbar-width: none; }
.val-library-head::-webkit-scrollbar { display: none; }
.val-library-sources, .val-library-actions { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 16px; }
.val-library-actions { position: relative; margin-left: auto; }
.val-source-action, .val-folder-create, .val-head-more { display: inline-flex; height: 28px; flex: 0 0 auto; align-items: center; justify-content: center; gap: 6px; padding: 2px 8px; border: 0; border-radius: 6px; background: var(--asset-overlay); color: var(--asset-text); cursor: pointer; font: inherit; font-size: 16px; line-height: 24px; white-space: nowrap; }
.val-source-action:hover:not(:disabled), .val-source-action:focus-visible, .val-folder-create:hover:not(:disabled), .val-folder-create:focus-visible, .val-head-more:hover:not(:disabled), .val-head-more:focus-visible { background: var(--asset-overlay-hover); outline: none; }
.val-source-action:disabled, .val-folder-create:disabled, .val-head-more:disabled { opacity: .45; cursor: not-allowed; }
.val-source-icon { display: grid; width: 24px; height: 24px; place-items: center; }
.val-source-icon img { display: block; max-width: 20px; max-height: 20px; }
.val-head-upload { position: relative; min-width: 30px; min-height: 28px; overflow: hidden; }
.val-head-upload > span { pointer-events: none; }
.val-head-upload-input { position: absolute; inset: 0; z-index: 1; display: block; width: 100%; height: 100%; margin: 0; padding: 0; opacity: 0; cursor: pointer; }
.val-head-upload-input::file-selector-button { width: 100%; height: 100%; margin: 0; cursor: pointer; }
.val-head-upload[aria-disabled="true"] { opacity: 0.5; cursor: default; }
.val-head-upload-input:disabled, .val-head-upload-input:disabled::file-selector-button { cursor: default; }
.val-head-more { width: 32px; padding: 0 8px 5px; font-size: 21px; }
.val-head-more.is-on { background: var(--asset-brand); color: #000; }
.val-more-wrap { position: relative; }
.val-more-menu { position: absolute; z-index: 12; top: 34px; right: 0; display: flex; width: 128px; flex-direction: column; gap: 2px; padding: 4px; border: 1px solid rgba(255,255,255,.16); border-radius: 7px; background: #303030; box-shadow: 0 8px 24px rgba(0,0,0,.38); }
.val-more-menu button { padding: 6px 8px; border: 0; border-radius: 4px; background: transparent; color: rgba(255,255,255,.72); cursor: pointer; font: inherit; font-size: 12px; text-align: left; }
.val-more-menu button:hover:not(:disabled), .val-more-menu button:focus-visible { background: var(--asset-overlay-hover); color: #fff; outline: none; }
.val-more-menu button:disabled { opacity: .45; cursor: not-allowed; }
.val-library-search { display: flex; width: 221px; height: 28px; flex: 0 0 221px; align-items: center; gap: 6px; box-sizing: border-box; padding: 0 8px; border: 0; border-radius: 8px; background: var(--asset-overlay); color: var(--asset-muted); }
.val-library-search:focus-within { box-shadow: inset 0 0 0 2px rgba(232,134,74,.75); }
.val-search-icon { display: grid; width: 24px; height: 24px; flex: 0 0 24px; place-items: center; }
.val-search-icon img { display: block; width: 24px; height: 24px; }
.val-library-search input, .val-library-search input:focus, .val-library-search input:focus-visible { min-width: 0; width: 100%; height: 28px; padding: 0; border: 0; outline: 0; box-shadow: none; background: transparent; color: #fff; font: inherit; font-size: 16px; }
.val-library-search input::placeholder { color: var(--asset-muted); }
.val-search-clear { display: grid; width: 18px; height: 18px; flex: 0 0 18px; place-items: center; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--asset-muted); cursor: pointer; font: inherit; font-size: 18px; line-height: 1; }
.val-search-clear:hover { background: var(--asset-overlay); color: #fff; }
.val-library-breadcrumb { display: flex; min-height: 40px; flex: 0 0 40px; align-items: center; gap: 7px; padding: 0 24px; color: var(--asset-muted); font-size: 12px; }
.val-library-breadcrumb button { padding: 0; border: 0; background: transparent; color: rgba(255,255,255,.6); cursor: pointer; font: inherit; }
.val-library-breadcrumb button:disabled, .val-library-breadcrumb strong { color: #fff; cursor: default; font-weight: 400; }
.val-library-status-row { display: flex; min-height: 0; align-items: center; gap: 8px; padding: 0 24px; }
.val-library-status-row:has(> *) { min-height: 30px; padding-bottom: 8px; }
.val-library-count { margin-left: auto; color: var(--asset-muted); font-size: 11px; white-space: nowrap; }
.val-batch-bar { display: flex; align-items: center; gap: 8px; margin: 0 24px 8px; padding: 7px 10px; border: 1px solid rgba(255,255,255,.1); border-radius: 6px; background: var(--asset-canvas); color: rgba(255,255,255,.6); font-size: 11px; }
.val-batch-bar button { padding: 3px 7px; border: 1px solid rgba(255,255,255,.1); border-radius: 6px; background: var(--asset-overlay); color: #fff; cursor: pointer; font-size: 11px; }
.val-batch-bar button:last-child { margin-left: auto; }
.gvv-replace-upload { position: absolute; top: 10px; right: 10px; z-index: 35; display: inline-flex; align-items: center; justify-content: center; min-width: 80px; min-height: 30px; padding: 4px 10px; border: 1px solid var(--gc-line-soft); border-radius: 7px; background: rgba(20,20,20,.82); color: var(--gc-text); font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
.gc-frame:hover > .gvv-replace-upload, .gc-frame:focus-within > .gvv-replace-upload { opacity: 1; pointer-events: auto; }
.gvv-replace-upload > span { pointer-events: none; }
.gvv-replace-upload-input { position: absolute; inset: 0; z-index: 1; display: block; width: 100%; height: 100%; margin: 0; padding: 0; opacity: 0; cursor: pointer; }
.gvv-replace-upload-input::file-selector-button { width: 100%; height: 100%; margin: 0; cursor: pointer; }
.gvv-replace-upload[aria-disabled="true"] { cursor: default; opacity: 1; }
.gvv-replace-upload-input:disabled, .gvv-replace-upload-input:disabled::file-selector-button { cursor: default; }
.val-head-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(255,255,255,.6); white-space: nowrap; }
.val-head-status button { border: 1px solid var(--gc-line-soft); background: transparent; color: var(--gc-text); border-radius: 6px; padding: 1px 6px; cursor: pointer; font-size: 11px; }
.val-head-fail { color: #ff8f8f; }
.val-error { margin: 0 24px 8px; color: #ff8f8f; font-size: 12px; }
.val-empty { color: var(--asset-muted); font-size: 12px; padding: 12px 10px; }
.val-row { position: relative; }
.val-row > .gc-row { width: 100%; min-width: 0; }
.val-row.is-selecting > .gc-row { padding-right: 36px; }
.val-row-select { position: absolute !important; top: 50%; right: 10px; z-index: 2; display: grid !important; width: 18px; height: 18px; margin: 0 !important; padding: 0 !important; place-items: center; line-height: 1; transform: translateY(-50%); }
.val-row-select input { margin: 0; accent-color: var(--gc-accent); }
.val-row .gc-row-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.val-row-action { position: absolute; z-index: 3; top: 5px; display: grid; width: 26px; min-width: 26px; height: 26px; min-height: 26px; place-items: center; padding: 0; border: 1px solid rgba(255,255,255,.24); border-radius: 6px; background: rgba(0,0,0,.5); color: rgba(255,255,255,.95); cursor: pointer; font-size: 15px; opacity: 0; pointer-events: none; transition: opacity .15s ease, background .15s ease; }
.val-row-rename { right: 58px; }
.val-row-delete { right: 8px; }
.val-row:hover > .gc-row, .val-row:has(> .val-row-action:focus-visible) > .gc-row { padding-right: 0; }
.val-row:hover .val-row-action { opacity: 1; pointer-events: auto; }
.val-row:has(> .val-row-action:focus-visible) .val-row-action { opacity: 1; pointer-events: auto; }
.val-row-action:hover:not(:disabled), .val-row-action:focus-visible { background: rgba(0,0,0,.78); outline: 2px solid rgba(232,134,74,.75); outline-offset: 1px; }
.val-row-action:disabled { cursor: default; opacity: 0.4; }
.gc-tab-video .gc-stage-video,
.gc-tab-video .gc-video-top,
.gc-tab-video .gvv-video-col { min-height: 0; }
.gc-tab-video .gc-video-top { display: flex; height: 0; grid-template-columns: none; flex: 1 1 0; }
.gc-tab-video .gvv-video-col { width: 100%; flex: 1 1 0; }
.gc-tab-video .gc-frame { width: 100%; height: 100%; min-height: 0; max-height: none; flex: 1 1 0; aspect-ratio: auto; }
@media (prefers-reduced-motion: reduce) { .val-row-action { transition: none; } }
.val-load-more { margin: 8px 24px 12px; border: 0; background: var(--asset-overlay); color: #fff; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.val-library-content { display: flex; min-width: 0; min-height: 0; flex: 1; flex-direction: column; }
.val-tag-action { flex: none; min-height: 26px; padding: 0 9px; border: 0; border-radius: 6px; background: var(--asset-overlay); color: #fff; cursor: pointer; font: inherit; font-size: 11px; }
.val-tag-action:hover:not(:disabled), .val-tag-action:focus-visible { background: var(--asset-overlay-hover); outline: none; }
.val-meta-warning { flex: none; margin: 0 24px 8px; color: var(--asset-muted); font-size: 10px; }
.val-library .gc-list-body { display: grid; flex: 1; min-height: 0; grid-template-columns: repeat(auto-fill, 140px); grid-auto-rows: 169px; align-content: start; gap: 24px 52px; overflow: auto; padding: 20px 24px 26px; }
.val-library .val-row, .val-folder-card { position: relative; width: 140px; min-width: 0; min-height: 169px; }
.val-library .val-row > .gc-row, .val-folder-open { box-sizing: border-box; display: flex; width: 100%; min-height: 169px; height: 169px; flex-direction: column; align-items: center; gap: 0; padding: 0; overflow: visible; border: 0; border-radius: 0; background: transparent; color: #fff; cursor: pointer; font: inherit; font-size: 14px; line-height: 20px; text-align: center; }
.val-library .val-row > .gc-row:hover, .val-library .val-row > .gc-row.is-on { background: transparent; }
.val-library .val-row:hover, .val-folder-card:hover { transform: translateY(-1px); }
.val-card-thumb { display: grid; width: 140px; height: 140px; min-height: 140px; flex: 0 0 140px; place-items: center; overflow: hidden; border-radius: 6px; background: var(--asset-overlay); color: #ff9c2a; font-size: 34px; }
.val-card-thumb video { display: block; width: 100%; height: 100%; object-fit: cover; background: #101114; }
.val-card-thumb.is-generating { background: linear-gradient(145deg, rgba(240,136,64,.18), rgba(26,26,26,.94)); }
.val-generation-spinner { width: 30px; height: 30px; border: 3px solid rgba(255,255,255,.16); border-top-color: var(--gc-accent); border-radius: 50%; animation: val-generation-spin .9s linear infinite; }
@keyframes val-generation-spin { to { transform: rotate(360deg); } }
.val-card-copy { box-sizing: border-box; display: block; width: 100%; min-width: 0; padding: 4px 10px; overflow: hidden; }
.val-card-copy .gc-row-label { display: block; width: 100%; overflow: hidden; color: #fff; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.val-folder-visual { position: relative; display: flex; width: 140px; height: 140px; flex: 0 0 140px; overflow: visible; background: var(--asset-overlay); clip-path: path('M0 6C0 2.6863 2.68629 0 6 0H50.8506C52.5206 0 54.115 0.695986 55.2505 1.92058L71.8399 19.813C72.9753 21.0376 74.5698 21.7335 76.2397 21.7335H134C137.314 21.7335 140 24.4198 140 27.7335V134C140 137.314 137.314 140 134 140H6C2.6863 140 0 137.314 0 134V6Z'); }
.val-folder-preview { position: absolute; z-index: 1; top: 41px; left: 9px; display: grid; width: 121px; height: 78px; grid-template-columns: repeat(3, 34px); grid-template-rows: repeat(2, 34px); gap: 8px; }
.val-folder-preview-item { display: grid; min-width: 0; min-height: 0; place-items: center; overflow: hidden; border-radius: 6px; background: var(--asset-overlay); color: rgba(255,255,255,.6); font-size: 14px; }
.val-folder-preview-item video { width: 100%; height: 100%; object-fit: cover; }
.val-folder-name { box-sizing: border-box; display: block; width: 100%; padding: 4px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.val-library .gc-row-mark { position: absolute; z-index: 2; top: 7px; left: 7px; width: 20px; height: 20px; border-radius: 999px; background: rgba(0,0,0,.62); }
.val-library .gvv-row-status { position: absolute; z-index: 2; top: 7px; right: 7px; margin-left: 0; }
.val-library .val-row:hover > .gc-row, .val-library .val-row:has(> .val-row-action:focus-visible) > .gc-row { padding-right: 0; }
.val-library .val-row-action { top: 5px; transform: none; }
.val-library .val-row-rename { right: 35px; }
.val-library .val-row-delete { right: 5px; }
.val-library .val-row-select { top: 7px; right: 8px; transform: none; }
.val-library .val-empty { grid-column: 1 / -1; min-height: 160px; display: grid; place-items: center; padding: 24px; }
.val-folder-suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.val-folder-suggestions button { padding: 4px 7px; border: 1px solid var(--gc-line-soft); border-radius: 999px; background: transparent; color: var(--gc-muted); cursor: pointer; font-size: 11px; }
.val-folder-suggestions button:hover:not(:disabled) { border-color: var(--gc-accent-line); color: var(--gc-text); }
.val-folder-clear { margin-top: 10px; padding: 5px 8px; border: 1px solid var(--gc-line-soft); border-radius: 6px; background: transparent; color: var(--gc-muted); cursor: pointer; font-size: 11px; }
@media (max-width: 760px) {
  .val-library-head { height: auto; min-height: 52px; padding: 8px 14px; }
  .val-library-search { width: 180px; flex-basis: 180px; }
  .val-library .gc-list-body { gap: 20px; padding: 16px 14px 24px; }
}
.val-dialog-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 40; }
.val-dialog { background: var(--gc-panel2); border: 1px solid var(--gc-line-soft); border-radius: 12px; padding: 16px; max-width: 420px; width: calc(100% - 32px); color: var(--gc-text); }
.vei-dialog-backdrop { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.62); }
.vei-dialog { position: relative; box-sizing: border-box; width: min(600px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 32px)); overflow: auto; padding: 40px; border: 1px solid #515151; border-radius: 16px; background: #141414; color: var(--gc-text); box-shadow: 0 24px 80px rgba(0,0,0,.52); }
.vei-dialog h2 { margin: 0 0 24px; color: #fff; font-size: 20px; line-height: 1.5; text-align: center; }
.vei-dialog-close { position: absolute; top: 16px; right: 20px; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #fff; cursor: pointer; font-size: 26px; line-height: 1; }
.vei-dialog-close:hover, .vei-dialog-close:focus-visible { background: rgba(255,255,255,.1); outline: none; }
.vei-dialog label { display: block; margin: 14px 0 7px; color: #fff; font-size: 12px; line-height: 1.5; }
.vei-dialog input, .vei-dialog select { box-sizing: border-box; width: 100%; min-height: 37px; padding: 7px 9px; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; background: rgba(255,255,255,.1); color: #fff; font: inherit; font-size: 14px; }
.vei-dialog select { background: #242424; }
.vei-dialog input:focus-visible, .vei-dialog select:focus-visible { border-color: var(--gc-accent); outline: 2px solid var(--gc-accent-soft); outline-offset: 1px; }
.vei-dialog input:disabled, .vei-dialog select:disabled { opacity: .55; cursor: not-allowed; }
.vei-dialog-path { min-height: 37px; display: flex; align-items: center; box-sizing: border-box; overflow: hidden; margin-top: 7px; padding: 7px 9px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; color: rgba(255,255,255,.62); font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.vei-dialog p[role="alert"] { margin: 12px 0 0; color: #ff9b9b; font-size: 12px; }
.vei-dialog-actions { display: flex; justify-content: flex-end; gap: 24px; margin-top: 40px; }
.vei-dialog-actions button { width: 120px; min-height: 32px; padding: 1px 28px; border: 0; border-radius: 8px; background: #fff; color: #000; cursor: pointer; font: inherit; font-size: 16px; font-weight: 600; }
.vei-dialog-actions button:last-child { background: linear-gradient(90deg, #ff7001, #ff9c2a); color: #000; font-weight: 700; }
.vei-dialog-actions button:hover:not(:disabled), .vei-dialog-actions button:focus-visible { filter: brightness(1.08); outline: none; }
.vei-dialog-actions button:disabled { opacity: .5; cursor: not-allowed; }
.val-dialog > label { display: block; margin: 10px 0 4px; color: var(--gc-faint); font-size: 12px; }
.val-dialog > input { box-sizing: border-box; width: 100%; border: 1px solid var(--gc-line); background: rgba(0,0,0,.28); color: var(--gc-text); border-radius: 7px; padding: 8px 10px; font: inherit; }
.val-dialog-error { margin-top: 6px; color: #ff8f8f; font-size: 12px; }
.val-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.val-missing-overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.72); color: #fff; padding: 16px; text-align: center; z-index: 3; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.gvv-axes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.gvv-axes label { display: flex; flex-direction: column; gap: 3px; font-size: 10px; color: var(--gc-faint); letter-spacing: .04em; }
.gvv-axes select { background: var(--gc-panel2); color: var(--gc-text); border: 1px solid var(--gc-line-soft); border-radius: 7px; padding: 5px 6px; font-size: 12px; }
.gvv-gen-row { display: flex; gap: 8px; }
.gvv-gen-row button { flex: 1; }
.gvv-gen-row button.gvv-gen-alt { background: var(--gc-accent-soft); color: var(--gc-text); border-color: var(--gc-accent-line); font-weight: 600; }
.gc-prompt {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  background: var(--gc-panel2);
  border: 1px solid var(--gc-line-soft);
  border-radius: 12px;
  padding: 12px;
}
.gc-prompt > span { color: var(--gc-faint); font-size: 11px; letter-spacing: 0.1em; }
.gc-prompt textarea {
  flex: 1;
  width: 100%;
  min-height: clamp(72px, 16dvh, 160px);
  resize: vertical;
  border: 1px solid var(--gc-line);
  background: rgba(0,0,0,0.28);
  color: var(--gc-text);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}
.gvv-config-panels { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: auto; }
.gvv-reference-panel { display: flex; flex-direction: column; gap: 8px; background: var(--gc-panel2); border: 1px solid var(--gc-line-soft); border-radius: 12px; padding: 12px; }
.gvv-reference-panel > span:first-child { color: var(--gc-faint); font-size: 11px; letter-spacing: .1em; }
.gvv-image-upload { display: flex; gap: 8px; }
.gvv-image-upload label { position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: 30px; border: 1px solid var(--gc-line-soft); border-radius: 7px; background: var(--gc-accent-soft); color: var(--gc-text); padding: 0 9px; overflow: hidden; cursor: pointer; font-size: 12px; }
.gvv-image-upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.gvv-image-upload input:disabled { cursor: default; }
.gvv-reference-thumbs { display: flex; flex-wrap: wrap; gap: 6px; }
.gvv-reference-thumb { position: relative; width: 42px; height: 42px; }
.gvv-reference-thumb img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; border: 1px solid var(--gc-line-soft); background: rgba(0,0,0,.2); }
.gvv-reference-thumb button { position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; padding: 0; border: 1px solid var(--gc-line-soft); border-radius: 999px; background: var(--gc-panel2); color: var(--gc-text); font-size: 13px; line-height: 15px; cursor: pointer; }
.gvv-reference-thumb button:hover:not(:disabled) { border-color: #ff8f8f; color: #ff8f8f; }
.gvv-reference-thumb button:disabled { opacity: .55; cursor: default; }

/* 横屏：提示词占右侧整列，图片参考留在视频下方，避免打断预览与参考素材的关联。 */
@media (min-width: 981px) {
  .gc-stage-video .gc-video-top {
    grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.85fr);
    grid-template-rows: minmax(0, 1fr) minmax(180px, 0.6fr);
  }
  .gc-stage-video .gvv-video-col {
    grid-column: 1;
    grid-row: 1;
    height: 100%;
  }
  .gc-stage-video .gvv-video-col .gc-frame {
    flex: 1 1 0;
    min-height: 0;
    max-height: none;
    aspect-ratio: auto;
  }
  .gc-stage-video .gvv-config-panels {
    display: contents;
  }
  .gc-stage-video .gc-prompt {
    grid-column: 2;
    grid-row: 1 / -1;
    min-height: 0;
  }
  .gc-stage-video .gvv-reference-panel {
    grid-column: 1;
    grid-row: 2;
    box-sizing: border-box;
    height: 100%;
    min-height: 180px;
  }
}

/* 视频 Tab 仅保留预览时，预览列占满原本的生成配置区域。 */
.gc-stage-video .gc-video-top { grid-template-columns: minmax(0, 1fr); }
.gc-stage-video .gvv-video-col { height: 100%; }
.gc-stage-video .gvv-video-col .gc-frame {
  flex: 1 1 0;
  min-height: 0;
  max-height: none;
  aspect-ratio: auto;
}
.gc-tab-video.val-video-workspace { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 0; background: #333; }
.gc-tab-video.val-video-workspace > .val-library { min-width: 0; }
@media (max-width: 980px) { .gc-tab-video.val-video-workspace { grid-template-columns: minmax(0, 1fr); overflow: auto; } }
`
