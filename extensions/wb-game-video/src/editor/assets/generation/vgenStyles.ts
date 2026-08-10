export const VGEN_CSS = `
.vgen-sheet { position: fixed; inset: 0; z-index: 222; }
.vgen-page { position: relative; inset: auto; z-index: auto; min-height: 0; }
.vgen-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.vgen-panel {
  position: absolute; left: 0; right: 0; bottom: 0; height: 92%;
  display: flex; flex-direction: column; box-sizing: border-box;
  border: 1px solid var(--gc-line, #403830); border-bottom: 0;
  border-radius: 14px 14px 0 0; background: var(--gc-panel, #1b1713);
  color: var(--gc-text, #f6f1e9); transform: translateY(100%);
  transition: transform .3s cubic-bezier(.22,1,.36,1);
}
.vgen-page .vgen-panel,
.vgen-panel.is-page {
  position: relative;
  inset: auto;
  height: 100%;
  min-height: 0;
  transform: none;
  border: 0;
  border-radius: 0;
}
.vgen-panel.is-page .vgen-head { display: none; }
.vgen-panel.is-page .vgen-body {
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 22px max(20px, calc((100% - 970px) / 2));
  background: rgba(0,0,0,.18);
}
.vgen-panel.is-page .vgen-page-results { order: 1; }
.vgen-panel.is-page .vgen-page-composer { order: 2; }
.vgen-panel.is-page .vgen-page-results .vgen-card {
  display: grid;
  grid-template-columns: minmax(0, 508px) minmax(260px, 1fr);
  grid-template-rows: auto 1fr;
  column-gap: 18px;
  padding: 0;
  border: 0;
  background: transparent;
}
.vgen-panel.is-page .vgen-page-results .vgen-card-head { grid-column: 1 / -1; margin-bottom: 8px; }
.vgen-panel.is-page .vgen-out-stage { min-height: 220px; }
.vgen-panel.is-page .vgen-out-progress,
.vgen-panel.is-page .vgen-output-error { grid-column: 1; }
.vgen-panel.is-page .vgen-active-tasks,
.vgen-panel.is-page .vgen-history { grid-column: 2; margin-top: 0; }
.vgen-panel.is-page .vgen-history { max-height: 285px; overflow: auto; }
.vgen-panel.is-page .vgen-page-composer {
  width: min(970px, 100%);
  margin: 0 auto;
  padding: 14px;
  border: 1px solid var(--gc-line-soft, #2e2924);
  border-radius: 16px;
  background: var(--gc-panel2, #252019);
  box-shadow: 0 12px 34px rgba(0,0,0,.22);
}
.vgen-panel.is-page .vgen-page-composer .vgen-card { padding: 0; border: 0; background: transparent; }
.vgen-panel.is-page .vgen-page-composer .vgen-card:first-child { order: 2; }
.vgen-panel.is-page .vgen-page-composer .vgen-card:nth-child(2) { order: 1; }
.vgen-panel.is-page .vgen-page-composer .vgen-textarea { min-height: 76px; }
.vgen-panel.is-page .vgen-page-composer .vgen-tip { margin-top: 8px; }
.vgen-panel.is-page .vgen-foot {
  width: min(970px, 100%);
  box-sizing: border-box;
  align-self: center;
  margin: 0 auto 18px;
  padding: 10px 14px;
  border: 1px solid var(--gc-line-soft, #2e2924);
  border-radius: 0 0 16px 16px;
  background: var(--gc-panel2, #252019);
}
.vgen-panel.is-page.vgen-design-panel { overflow: hidden; background: #1a1a1a; color: #fff; }
.vgen-visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.vgen-design-workspace { box-sizing: border-box; display: grid; width: 100%; height: 100%; min-height: 0; grid-template-columns: 225px minmax(0,1fr); grid-template-rows: minmax(300px,1.65fr) minmax(255px,1fr); gap: 5px; padding: 5px; background: #1a1a1a; }
.vgen-settings { box-sizing: border-box; display: flex; min-height: 0; flex-direction: column; gap: 20px; overflow: auto; padding: 16px; background: #2c2c2c; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent; }
.vgen-setting-group { display: flex; flex: none; flex-direction: column; gap: 8px; }
.vgen-setting-group h3 { display: flex; align-items: center; gap: 8px; margin: 0; color: #fff; font-size: 14px; font-weight: 500; line-height: 21px; }
.vgen-setting-group h3 > span { display: block; width: 3px; height: 11px; border-radius: 3px; background: #e8864a; }
.vgen-setting-select, .vgen-custom-duration { box-sizing: border-box; width: 100%; height: 40px; padding: 0 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; outline: 0; background: #1a1a1a; color: #fff; font: inherit; font-size: 14px; }
.vgen-setting-select:disabled { opacity: 1; cursor: not-allowed; color: rgba(255,255,255,.82); }
.vgen-setting-pills { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 6px; }
.vgen-setting-pills button { box-sizing: border-box; min-width: 0; height: 31px; padding: 0 5px; border: 0; border-radius: 8px; background: #1a1a1a; color: rgba(255,255,255,.6); cursor: pointer; font: inherit; font-size: 12px; white-space: nowrap; }
.vgen-setting-pills button.is-on { background: #e8864a; color: #000; }
.vgen-setting-pills button:disabled { cursor: not-allowed; opacity: .55; }
.vgen-setting-pills button.is-on:disabled { opacity: 1; }
.vgen-camera-pills { grid-template-columns: repeat(3,minmax(0,1fr)); }
.vgen-custom-duration { height: 32px; }
.vgen-preview-stage { position: relative; display: grid; min-width: 0; min-height: 0; place-items: center; overflow: hidden; border-radius: 10px; background: #1f1f1f; }
.vgen-preview-empty { display: flex; width: min(440px,calc(100% - 40px)); flex-direction: column; align-items: center; color: rgba(255,255,255,.4); text-align: center; }
.vgen-preview-empty > img { display: block; width: 164px; height: 128px; }
.vgen-preview-empty p { margin: 12px 0 4px; color: rgba(255,255,255,.72); font-size: 14px; }
.vgen-preview-empty > span { font-size: 12px; line-height: 1.5; }
.vgen-preview-progress { width: min(280px,80%); height: 4px; margin-top: 18px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.12); }
.vgen-preview-progress i { display: block; width: 36%; height: 100%; border-radius: inherit; background: #e8864a; animation: vgen-indeterminate 1.2s ease-in-out infinite; }
.vgen-design-status { position: absolute; top: 12px; left: 12px; z-index: 2; padding: 3px 8px; border-radius: 999px; background: rgba(0,0,0,.55); color: rgba(255,255,255,.58); font-size: 11px; }
.vgen-design-status.running, .vgen-design-status.done { color: #ff9c2a; }
.vgen-design-status.failed, .vgen-design-error { color: #ff8f8f; }
.vgen-design-error { font-size: 12px; line-height: 1.5; }
.vgen-generated-preview { position: absolute; inset: 0; overflow: hidden; border-radius: 10px; background: #111; }
.vgen-generated-preview > video { display: block; width: 100%; height: 100%; object-fit: cover; cursor: pointer; }
.vgen-preview-close { position: absolute; z-index: 4; top: 5px; right: 5px; display: grid; width: 28px; height: 28px; place-items: center; padding: 0; border: 0; border-radius: 6px; background: rgba(0,0,0,.18); color: #fff; cursor: pointer; font: inherit; font-size: 20px; line-height: 1; }
.vgen-preview-close:hover, .vgen-preview-close:focus-visible { background: rgba(0,0,0,.6); outline: none; }
.vgen-player-controls { position: absolute; z-index: 3; right: 0; bottom: 0; left: 0; display: flex; flex-direction: column; gap: 12px; padding: 54px 16px 15px; background: linear-gradient(to top,rgba(0,0,0,.9),rgba(0,0,0,.5) 50%,transparent); }
.vgen-player-row { display: flex; height: 16px; align-items: center; gap: 10px; color: rgba(255,255,255,.6); font-size: 11px; font-variant-numeric: tabular-nums; }
.vgen-player-row button { border: 0; background: transparent; color: rgba(255,255,255,.82); cursor: pointer; font: inherit; }
.vgen-player-play { width: 18px; padding: 0; }
.vgen-player-rate { margin-left: auto; color: #ff9c2a !important; }
.vgen-player-fullscreen { width: 20px; padding: 0; font-size: 17px !important; }
.vgen-player-progress { --vgen-progress: 0%; width: 100%; height: 4px; margin: 0; appearance: none; border-radius: 999px; background: linear-gradient(to right,#ff9c2a 0 var(--vgen-progress),rgba(255,255,255,.2) var(--vgen-progress) 100%); cursor: pointer; }
.vgen-player-progress::-webkit-slider-thumb { width: 0; height: 0; appearance: none; }
.vgen-apply { width: 145px; height: 32px; align-self: center; border: 0; border-radius: 8px; background: linear-gradient(90deg,#ff7001,#ff9c2a); color: #000; cursor: pointer; font: inherit; font-size: 14px; font-weight: 700; }
.vgen-apply:disabled { opacity: .45; cursor: not-allowed; }
.vgen-composer { box-sizing: border-box; display: flex; min-width: 0; min-height: 0; grid-column: 1 / -1; flex-direction: column; gap: 15px; overflow: auto; padding: 16px; background: #2c2c2c; }
.vgen-mode-tabs { display: inline-flex; width: max-content; max-width: 100%; flex: none; align-self: flex-start; gap: 4px; overflow-x: auto; padding: 6px; border-radius: 9px; background: rgba(0,0,0,.2); }
.vgen-mode-tabs button { height: 30px; flex: none; padding: 0 14px; border: 0; border-radius: 8px; background: transparent; color: rgba(255,255,255,.6); cursor: pointer; font: inherit; font-size: 14px; white-space: nowrap; }
.vgen-mode-tabs button:hover, .vgen-mode-tabs button:focus-visible { color: #fff; outline: none; }
.vgen-mode-tabs button.is-on { background: #fff; color: #000; }
.vgen-media-row { display: flex; min-height: 95px; flex: none; align-items: center; gap: 12px; overflow-x: auto; }
.vgen-frame-tile, .vgen-page-ref-add { box-sizing: border-box; display: flex; width: 79px; height: 95px; flex: 0 0 79px; flex-direction: column; align-items: center; justify-content: center; gap: 8px; overflow: hidden; border: 0; border-radius: 8px; color: #fff; font: inherit; font-size: 12px; }
.vgen-media-divider { width: 1px; height: 74px; flex: 0 0 1px; margin: 0 2px; background: rgba(255,255,255,.16); }
.vgen-frame-tile, .vgen-page-ref-add { padding: 0; background: rgba(0,0,0,.2) center/cover no-repeat; color: rgba(255,255,255,.6); cursor: pointer; }
.vgen-frame-tile:hover, .vgen-frame-tile:focus-visible, .vgen-page-ref-add:hover, .vgen-page-ref-add:focus-visible { box-shadow: inset 0 0 0 1px #e8864a; outline: none; }
.vgen-frame-tile.has-image { justify-content: flex-end; }
.vgen-frame-tile.has-image span { width: 100%; box-sizing: border-box; overflow: hidden; padding: 6px; background: rgba(0,0,0,.6); color: #fff; text-overflow: ellipsis; white-space: nowrap; }
.vgen-frame-tile img, .vgen-page-ref-add img { width: 22px; height: 22px; }
.vgen-frame-swap { display: grid; width: 18px; flex: 0 0 18px; place-items: center; }
.vgen-frame-swap img { width: 15px; height: 13px; }
.vgen-page-refs { display: flex; align-items: center; gap: 8px; }
.vgen-page-ref { position: relative; width: 79px; height: 95px; flex: 0 0 79px; border: 0; border-radius: 8px; background: #1a1a1a center/cover no-repeat; cursor: pointer; }
.vgen-page-ref span { position: absolute; top: 4px; right: 4px; display: grid; width: 18px; height: 18px; place-items: center; border-radius: 50%; background: rgba(0,0,0,.62); color: #fff; }
.vgen-prompt-box { box-sizing: border-box; display: flex; height: 164px; min-height: 164px; flex: 0 0 164px; flex-direction: column; overflow: hidden; padding: 15px 19px; border-radius: 12px; background: rgba(0,0,0,.2); }
.vgen-prompt-box textarea { box-sizing: border-box; width: 100%; min-height: 48px; flex: 1; resize: none; padding: 0; border: 0; outline: 0; background: transparent; color: #fff; box-shadow: none; font: inherit; font-size: 14px; line-height: 1.5; }
.vgen-prompt-box:focus-within { box-shadow: 0 0 0 2px rgba(255,156,42,.42); }
.vgen-prompt-box textarea:focus { border: 0; box-shadow: none; }
.vgen-prompt-box textarea::placeholder { color: rgba(255,255,255,.4); }
.vgen-prompt-tools { box-sizing: border-box; display: flex; width: 100%; min-height: 32px; align-items: center; justify-content: space-between; }
.vgen-prompt-options { display: flex; min-width: 0; align-items: flex-start; gap: 8px; }
.vgen-prompt-actions { display: flex; width: 289px; flex: 0 0 289px; align-items: center; justify-content: flex-end; gap: 15px; }
.vgen-prompt-options .vgen-style-button { box-sizing: border-box; display: inline-flex; max-width: 180px; height: 24px; align-items: center; gap: 8px; overflow: hidden; padding: 0 8px; border: 0; border-bottom: 0; border-radius: 4px; background: transparent; color: rgba(255,255,255,.8); cursor: pointer; font: inherit; font-size: 12px; font-weight: 400; line-height: 18px; white-space: nowrap; }
.vgen-prompt-options .vgen-style-button:hover, .vgen-prompt-options .vgen-style-button:focus-visible { background: rgba(255,255,255,.08); color: #fff; outline: none; }
.vgen-prompt-options .vgen-style-button:focus-visible { box-shadow: 0 0 0 2px rgba(255,156,42,.42); }
.vgen-style-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vgen-style-swap { display: grid; width: 12px; height: 12px; flex: 0 0 12px; place-items: center; }
.vgen-style-swap img { display: block; width: 10px; height: 8.5px; }
.vgen-audio-toggle { box-sizing: border-box; display: inline-flex; width: 86px; height: 24px; flex: 0 0 86px; align-items: center; gap: 8px; padding: 0 8px; color: rgba(255,255,255,.8); font-size: 12px; line-height: 18px; cursor: pointer; }
.vgen-audio-toggle input { position: absolute; opacity: 0; pointer-events: none; }
.vgen-audio-switch { position: relative; display: block; width: 38px; height: 18px; box-sizing: border-box; padding: 2px; border: 1px solid rgba(255,255,255,.05); border-radius: 999px; background: rgba(255,255,255,.1); transition: background .15s ease; }
.vgen-audio-switch::after { content: ''; position: absolute; top: 1px; left: 1px; width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,.22); transition: transform .15s ease, background .15s ease; }
.vgen-audio-toggle input:checked + .vgen-audio-switch { background: linear-gradient(90deg,#ff7001,#ff9c2a); }
.vgen-audio-toggle input:checked + .vgen-audio-switch::after { transform: translateX(20px); background: #fff; }
.vgen-audio-toggle input:focus-visible + .vgen-audio-switch { outline: 2px solid rgba(255,156,42,.48); outline-offset: 2px; }
.vgen-prompt-actions .vgen-prompt-undo, .vgen-prompt-actions .vgen-prompt-helper { box-sizing: border-box; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: rgba(255,255,255,.8); cursor: pointer; font: inherit; font-size: 12px; font-weight: 400; line-height: 18px; }
.vgen-prompt-actions .vgen-prompt-undo { display: grid; width: 16px; flex: 0 0 16px; place-items: center; }
.vgen-prompt-actions .vgen-prompt-undo img { width: 16px; height: 16px; }
.vgen-prompt-undo:hover:not(:disabled), .vgen-prompt-helper:hover:not(:disabled) { background: rgba(255,255,255,.1); }
.vgen-prompt-undo:disabled, .vgen-prompt-helper:disabled { opacity: .45; cursor: not-allowed; }
.vgen-prompt-actions .vgen-prompt-helper { display: inline-flex; align-items: center; gap: 8px; padding: 0 8px; white-space: nowrap; }
.vgen-prompt-helper-chevron { box-sizing: border-box; width: 8px; height: 8px; margin-top: -3px; transform: rotate(45deg); border-right: 1.4px solid rgba(255,255,255,.8); border-bottom: 1.4px solid rgba(255,255,255,.8); }
.vgen-prompt-actions .vgen-send { position: relative; display: grid; width: 32px; height: 32px; flex: 0 0 32px; place-items: center; padding: 0; border: 0; border-radius: 50%; background: #ff9c2a; box-shadow: 0 2px 8px rgba(255,112,1,.18); cursor: pointer; transition: transform .12s ease, background .12s ease, box-shadow .12s ease; }
.vgen-prompt-actions .vgen-send img { width: 20.1912px; height: 17.9477px; transform: translate(-1.37px, -1.37px) rotate(45deg) scaleX(-1); }
.vgen-prompt-actions .vgen-send:hover:not(:disabled) { background: #ffad4d; box-shadow: 0 4px 12px rgba(255,112,1,.28); }
.vgen-prompt-actions .vgen-send:active:not(:disabled) { transform: scale(.94); background: #ff8a14; box-shadow: 0 1px 4px rgba(255,112,1,.2); }
.vgen-prompt-actions .vgen-send:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.vgen-prompt-actions .vgen-send:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }
.vgen-prompt-actions .vgen-send.running::before { content: ''; position: absolute; width: 16px; height: 16px; border: 2px solid rgba(0,0,0,.25); border-top-color: #000; border-radius: 50%; animation: vgen-spin .8s linear infinite; }
.vgen-prompt-actions .vgen-send.running img { opacity: 0; }
@media (max-width: 620px) {
  .vgen-prompt-actions { width: auto; flex-basis: auto; }
}
.vgen-style-layer { position: fixed; inset: 0; z-index: 330; display: grid; place-items: center; padding: 24px; background: rgba(0,0,0,.68); }
.vgen-style-dialog { box-sizing: border-box; width: min(971px,calc(100vw - 48px)); max-height: min(760px,calc(100vh - 48px)); display: flex; flex-direction: column; overflow: hidden; padding: 24px 40px 32px; border: 1px solid rgba(255,255,255,.2); border-radius: 14px; background: #141414; color: #fff; box-shadow: 0 24px 72px rgba(0,0,0,.5); }
.vgen-style-head { display: flex; align-items: center; }
.vgen-style-head h3 { margin: 0; font-size: 20px; font-weight: 700; }
.vgen-style-head button { width: 32px; height: 32px; margin-left: auto; border: 0; border-radius: 7px; background: transparent; color: rgba(255,255,255,.72); cursor: pointer; font-size: 22px; }
.vgen-style-head button:hover, .vgen-style-head button:focus-visible { background: rgba(255,255,255,.08); color: #fff; outline: none; }
.vgen-style-toolbar { display: flex; align-items: center; gap: 16px; margin: 22px 0 18px; }
.vgen-style-categories { display: flex; min-width: 0; flex: 1; gap: 4px; overflow-x: auto; }
.vgen-style-categories button { flex: none; padding: 7px 13px; border: 0; border-radius: 7px; background: transparent; color: rgba(255,255,255,.55); cursor: pointer; font: inherit; font-size: 13px; }
.vgen-style-categories button.is-on { background: rgba(255,255,255,.12); color: #fff; }
.vgen-style-toolbar > input { box-sizing: border-box; width: 203px; height: 34px; padding: 0 12px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; outline: none; background: rgba(255,255,255,.06); color: #fff; font: inherit; font-size: 13px; }
.vgen-style-toolbar > input:focus { border-color: #e8864a; }
.vgen-style-grid { min-height: 160px; overflow-y: auto; display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); grid-auto-rows: 111px; align-content: start; gap: 15px 18px; padding-right: 4px; }
.vgen-style-card { position: relative; min-width: 0; height: 111px; overflow: hidden; padding: 0; border: 1px solid transparent; border-radius: 8px; background: #242424; color: #fff; cursor: pointer; }
.vgen-style-card img { width: 100%; height: 100%; display: block; object-fit: cover; }
.vgen-style-card span { position: absolute; inset: auto 0 0; overflow: hidden; padding: 22px 8px 7px; background: linear-gradient(transparent,rgba(0,0,0,.76)); text-align: left; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.vgen-style-card:hover, .vgen-style-card:focus-visible, .vgen-style-card.is-selected { border-color: #e8864a; outline: none; }
.vgen-style-message { grid-column: 1/-1; display: grid; min-height: 160px; place-items: center; margin: 0; color: rgba(255,255,255,.55); font-size: 13px; }
.vgen-style-message.error { color: #ff8f8f; }
.vgen-sheet.on .vgen-panel { transform: translateY(0); }
.vgen-head { display: flex; align-items: center; gap: 10px; padding: 14px 24px; border-bottom: 1px solid var(--gc-line-soft, #2e2924); }
.vgen-title { margin: 0; font-size: .92rem; font-weight: 700; color: var(--gc-text, #f6f1e9); }
.vgen-sub { margin: 2px 0 0; font-size: .72rem; color: var(--gc-muted, #b8aea0); }
.vgen-close { margin-left: auto; width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent; color: var(--gc-muted, #b8aea0); cursor: pointer; font-size: 1rem; }
.vgen-close:hover, .vgen-close:focus-visible { color: var(--gc-text, #f6f1e9); background: var(--gc-accent-soft, rgba(240,136,64,.16)); outline: none; }
.vgen-body { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: minmax(0,1.4fr) minmax(300px,.9fr); gap: 20px; padding: 16px 24px; }
.vgen-column { min-width: 0; display: flex; flex-direction: column; gap: 14px; }
.vgen-column-output .vgen-card { flex: 1; }
.vgen-card { box-sizing: border-box; border: 1px solid var(--gc-line-soft, #2e2924); background: var(--gc-panel2, #252019); border-radius: 10px; padding: 14px; }
.vgen-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.vgen-card-title { margin: 0; font-size: .82rem; font-weight: 700; color: var(--gc-text, #f6f1e9); }
.vgen-card-head .vgen-status { margin-left: auto; }
.vgen-label { display: block; font-size: .68rem; font-weight: 600; color: var(--gc-muted, #b8aea0); margin: 10px 0 4px; }
.vgen-input, .vgen-select, .vgen-textarea {
  box-sizing: border-box; width: 100%; padding: 7px 10px; font: inherit; font-size: .78rem;
  color: var(--gc-text, #f6f1e9); border: 1px solid var(--gc-line-soft, #2e2924);
  background: rgba(0,0,0,.2); border-radius: 6px;
}
.vgen-input:focus-visible, .vgen-select:focus-visible, .vgen-textarea:focus-visible { border-color: var(--gc-accent, #f08840); outline: 2px solid var(--gc-accent-soft, rgba(240,136,64,.16)); outline-offset: 1px; }
.vgen-textarea { min-height: 120px; resize: vertical; line-height: 1.5; }
.vgen-select:disabled { opacity: .55; cursor: not-allowed; }
.vgen-tip { margin-top: 10px; padding: 8px 10px; font-size: .72rem; line-height: 1.45; border-radius: 6px; color: var(--gc-accent, #f08840); background: var(--gc-accent-soft, rgba(240,136,64,.16)); border: 1px solid var(--gc-accent-line, rgba(240,136,64,.42)); }
.vgen-tip.error, .vgen-error { color: var(--gc-danger, #ff8f8f); }
.vgen-frame-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
.vgen-frame { aspect-ratio: 16/10; width: 100%; padding: 0; border: 1px dashed var(--gc-line, #403830); border-radius: 10px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--gc-faint, #8c8377); font-size: .72rem; position: relative; overflow: hidden; background: rgba(0,0,0,.2) center/cover no-repeat; }
.vgen-frame:hover, .vgen-frame:focus-visible { border-color: var(--gc-accent, #f08840); color: var(--gc-text, #f6f1e9); outline: none; }
.vgen-frame.has-image::after { content: ""; position: absolute; inset: 0; background: rgba(0,0,0,.14); }
.vgen-frame .vgen-role { position: absolute; z-index: 1; left: 6px; top: 6px; font-size: .6rem; padding: 2px 6px; border-radius: 999px; background: rgba(0,0,0,.55); color: var(--gc-muted, #b8aea0); font-family: ui-monospace, Menlo, Consolas, monospace; }
.vgen-frame .vgen-frame-label { position: relative; z-index: 1; padding: 4px 7px; border-radius: 5px; background: rgba(0,0,0,.55); }
.vgen-refs { display: flex; flex-wrap: wrap; gap: 8px; }
.vgen-ref { width: 54px; height: 54px; border-radius: 6px; border: 1px solid var(--gc-line-soft, #2e2924); background: var(--gc-panel3, #2f2923) center/cover no-repeat; position: relative; }
.vgen-ref-del { position: absolute; right: -6px; top: -6px; width: 18px; height: 18px; padding: 0; border-radius: 50%; border: 1px solid var(--gc-line-soft, #2e2924); background: var(--gc-panel3, #2f2923); color: var(--gc-muted, #b8aea0); font-size: .7rem; line-height: 1; cursor: pointer; }
.vgen-ref-del:hover, .vgen-ref-del:focus-visible { color: var(--gc-text, #f6f1e9); border-color: var(--gc-accent, #f08840); outline: none; }
.vgen-ref-add { width: 54px; height: 54px; border-radius: 6px; border: 1px dashed var(--gc-line, #403830); background: transparent; color: var(--gc-faint, #8c8377); cursor: pointer; }
.vgen-ref-add:hover, .vgen-ref-add:focus-visible { color: var(--gc-text, #f6f1e9); border-color: var(--gc-accent, #f08840); outline: none; }
.vgen-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.vgen-readonly { min-height: 32px; box-sizing: border-box; display: flex; align-items: center; padding: 7px 10px; border: 1px solid var(--gc-line-soft, #2e2924); border-radius: 6px; background: rgba(0,0,0,.2); color: var(--gc-faint, #8c8377); font-size: .78rem; }
.vgen-check { display: flex; align-items: center; gap: 8px; margin-top: 12px; color: var(--gc-text, #f6f1e9); font-size: .78rem; }
.vgen-check input { accent-color: var(--gc-accent, #f08840); }
.vgen-check-hint { margin-left: 23px; color: var(--gc-faint, #8c8377); font-size: .68rem; }
.vgen-advanced { margin-top: 12px; color: var(--gc-muted, #b8aea0); font-size: .72rem; }
.vgen-advanced summary { cursor: pointer; }
.vgen-out-stage { aspect-ratio: 16/9; border-radius: 10px; background: var(--gc-bg, #0e0c09); border: 1px solid var(--gc-line-soft, #2e2924); display: flex; align-items: center; justify-content: center; color: var(--gc-faint, #8c8377); font-size: .72rem; overflow: hidden; }
.vgen-out-stage video { width: 100%; height: 100%; object-fit: contain; background: var(--gc-bg, #0e0c09); }
.vgen-out-progress { height: 4px; border-radius: 2px; background: var(--gc-line-soft, #2e2924); margin-top: 10px; overflow: hidden; }
.vgen-out-progress .fill { height: 100%; width: 40%; border-radius: 2px; background: var(--gc-accent, #f08840); animation: vgen-indeterminate 1.2s ease-in-out infinite; }
@keyframes vgen-indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }
.vgen-status { font-size: .66rem; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--gc-line-soft, #2e2924); color: var(--gc-muted, #b8aea0); white-space: nowrap; }
.vgen-status.running, .vgen-status.done { color: var(--gc-accent, #f08840); border-color: var(--gc-accent-line, rgba(240,136,64,.42)); }
.vgen-status.failed { color: var(--gc-danger, #ff8f8f); border-color: var(--gc-danger-line, rgba(255,143,143,.42)); }
.vgen-output-error { margin-top: 10px; font-size: .72rem; }
.vgen-active-tasks { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--gc-line-soft, #2e2924); }
.vgen-history { margin-top: 16px; }
.vgen-history-title { margin: 0 0 6px; color: var(--gc-muted, #b8aea0); font-size: .72rem; }
.vgen-hist-list { display: flex; flex-direction: column; gap: 2px; }
.vgen-hist-item { width: 100%; display: flex; gap: 10px; align-items: center; padding: 8px; border: 0; border-radius: 8px; background: transparent; color: var(--gc-text, #f6f1e9); text-align: left; cursor: pointer; }
.vgen-hist-item:hover, .vgen-hist-item:focus-visible { background: var(--gc-accent-soft, rgba(240,136,64,.16)); outline: none; }
.vgen-hist-thumb { width: 72px; height: 40px; border-radius: 6px; background: var(--gc-bg, #0e0c09) center/cover no-repeat; flex: none; }
.vgen-hist-copy { min-width: 0; flex: 1; }
.vgen-hist-label { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .74rem; }
.vgen-hist-time { display: block; margin-top: 2px; color: var(--gc-faint, #8c8377); font-size: .64rem; }
.vgen-foot { display: flex; align-items: center; gap: 12px; padding: 12px 24px; border-top: 1px solid var(--gc-line-soft, #2e2924); }
.vgen-foot-hint { font-size: .7rem; color: var(--gc-muted, #b8aea0); }
.vgen-btn-primary { margin-left: auto; height: 36px; min-width: 120px; padding: 0 18px; border: 0; border-radius: 8px; background: var(--gc-accent, #f08840); color: var(--gc-bg, #0e0c09); font-size: .82rem; font-weight: 700; cursor: pointer; }
.vgen-btn-primary:disabled { opacity: .55; cursor: not-allowed; }
.vgen-btn-ghost { height: 36px; padding: 0 14px; border: 1px solid var(--gc-line, #403830); border-radius: 8px; background: transparent; color: var(--gc-text, #f6f1e9); font-size: .78rem; cursor: pointer; }
.vgen-btn-ghost:hover, .vgen-btn-ghost:focus-visible { border-color: var(--gc-accent, #f08840); background: var(--gc-accent-soft, rgba(240,136,64,.16)); outline: none; }
.vgen-btn-primary.running::before { content: ""; display: inline-block; width: 13px; height: 13px; margin-right: 8px; vertical-align: -2px; border: 2px solid var(--gc-accent-soft, rgba(255,255,255,.4)); border-top-color: var(--gc-text, #f6f1e9); border-radius: 50%; animation: vgen-spin .8s linear infinite; }
@keyframes vgen-spin { to { transform: rotate(360deg); } }
.vgen-toast { position: fixed; z-index: 326; left: 50%; bottom: 24px; max-width: min(480px, calc(100vw - 32px)); transform: translateX(-50%); padding: 9px 14px; border: 1px solid var(--gc-accent-line, rgba(240,136,64,.42)); border-radius: 8px; background: var(--gc-panel3, #2f2923); color: var(--gc-text, #f6f1e9); box-shadow: 0 8px 24px rgba(0,0,0,.35); font-size: .74rem; }
.vgen-picker-layer { position: fixed; inset: 0; z-index: 325; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.62); }
.vgen-picker { box-sizing: border-box; width: min(680px,92vw); max-height: min(720px,88vh); display: flex; flex-direction: column; padding: 16px; border: 1px solid var(--gc-line, #403830); border-radius: 12px; background: var(--gc-panel2, #252019); color: var(--gc-text, #f6f1e9); box-shadow: 0 18px 56px rgba(0,0,0,.48); }
.vgen-picker-head { display: flex; align-items: center; gap: 10px; }
.vgen-picker-title { margin: 0; font-size: .88rem; }
.vgen-picker-close { margin-left: auto; width: 30px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: var(--gc-muted, #b8aea0); cursor: pointer; }
.vgen-picker-tabs { display: flex; gap: 6px; margin: 14px 0 10px; }
.vgen-picker-tab { padding: 5px 10px; border: 1px solid var(--gc-line-soft, #2e2924); border-radius: 999px; background: transparent; color: var(--gc-muted, #b8aea0); cursor: pointer; font-size: .7rem; }
.vgen-picker-tab[aria-selected="true"] { border-color: var(--gc-accent-line, rgba(240,136,64,.42)); background: var(--gc-accent-soft, rgba(240,136,64,.16)); color: var(--gc-text, #f6f1e9); }
.vgen-picker-grid { min-height: 132px; overflow: auto; display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); align-content: start; gap: 10px; }
.vgen-picker-item { position: relative; aspect-ratio: 16/10; padding: 0; overflow: hidden; border: 1px solid var(--gc-line-soft, #2e2924); border-radius: 8px; background: var(--gc-bg, #0e0c09) center/cover no-repeat; color: var(--gc-text, #f6f1e9); cursor: pointer; }
.vgen-picker-item:hover, .vgen-picker-item:focus-visible { border-color: var(--gc-accent, #f08840); outline: none; }
.vgen-picker-item:disabled { opacity: .46; cursor: not-allowed; filter: grayscale(.55); }
.vgen-picker-item:disabled:hover { border-color: var(--gc-line-soft, #2e2924); }
.vgen-picker-item span { position: absolute; left: 0; right: 0; bottom: 0; overflow: hidden; padding: 7px 8px; background: rgba(0,0,0,.66); text-overflow: ellipsis; white-space: nowrap; font-size: .7rem; }
.vgen-picker-empty { grid-column: 1/-1; display: grid; place-items: center; min-height: 120px; color: var(--gc-faint, #8c8377); font-size: .72rem; }
.vgen-picker-foot { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--gc-line-soft, #2e2924); }
.vgen-import { position: relative; display: inline-flex; align-items: center; justify-content: center; min-height: 32px; overflow: hidden; padding: 0 10px; border: 1px solid var(--gc-accent-line, rgba(240,136,64,.42)); border-radius: 7px; background: var(--gc-accent-soft, rgba(240,136,64,.16)); color: var(--gc-text, #f6f1e9); font-size: .72rem; cursor: pointer; }
.vgen-import input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.vgen-import[aria-disabled="true"] { opacity: .55; cursor: not-allowed; }
.vgen-import input:disabled { cursor: not-allowed; }
.vgen-import-error { margin-left: auto; font-size: .68rem; }
@media (max-width:820px) {
  .vgen-design-workspace { grid-template-columns: 190px minmax(360px,1fr); grid-template-rows: minmax(320px,1fr) minmax(280px,auto); overflow: auto; }
  .vgen-settings { padding: 14px 12px; }
  .vgen-setting-pills { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .vgen-composer { min-width: 555px; }
  .vgen-body { grid-template-columns: 1fr; }
  .vgen-panel.is-page .vgen-body { padding: 16px 14px; }
  .vgen-panel.is-page .vgen-page-results .vgen-card { display: block; }
  .vgen-panel.is-page .vgen-history { max-height: none; margin-top: 16px; }
  .vgen-panel.is-page .vgen-page-composer,
  .vgen-panel.is-page .vgen-foot { width: calc(100% - 28px); }
}
@media (max-width:700px) { .vgen-style-dialog { padding: 20px; } .vgen-style-grid { grid-template-columns: repeat(3,minmax(0,1fr)); } }
@media (max-width:520px) { .vgen-head, .vgen-body, .vgen-foot { padding-left: 14px; padding-right: 14px; } .vgen-grid2, .vgen-frame-grid { grid-template-columns: 1fr; } .vgen-picker-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } .vgen-style-toolbar { align-items: stretch; flex-direction: column; } .vgen-style-toolbar > input { width: 100%; } .vgen-style-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media (prefers-reduced-motion:reduce) { .vgen-panel { transition: none; } .vgen-out-progress .fill, .vgen-btn-primary.running::before { animation-duration: 2.4s; } }
`
