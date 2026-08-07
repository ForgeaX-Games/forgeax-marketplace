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
.val-head-upload, .val-head-refresh { border: 1px solid var(--gc-line-soft); background: var(--gc-panel2); color: var(--gc-text); border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 12px; }
.val-library .gc-list-head { flex-wrap: nowrap; }
.val-library .gc-list-title { flex: 0 0 auto; white-space: nowrap; }
.val-head-select { flex: none; width: 28px; height: 28px; padding: 0; border: 1px solid var(--gc-line-soft); border-radius: 6px; color: var(--gc-muted); background: var(--gc-panel2); cursor: pointer; }
.val-head-select.is-on { color: #1a1206; border-color: var(--gc-accent); background: var(--gc-accent); }
.val-batch-bar { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-bottom: 1px solid var(--gc-line-soft); color: var(--gc-faint); font-size: 11px; }
.val-batch-bar button { border: 1px solid var(--gc-line-soft); border-radius: 6px; padding: 3px 7px; background: var(--gc-panel2); color: var(--gc-text); font-size: 11px; cursor: pointer; }
.val-batch-bar button:last-child { margin-left: auto; }
.val-head-upload { position: relative; display: inline-flex; flex: none; min-width: 30px; min-height: 28px; padding: 2px 8px; align-items: center; justify-content: center; overflow: hidden; }
.val-head-upload > span { pointer-events: none; }
.val-head-upload-input { position: absolute; inset: 0; z-index: 1; display: block; width: 100%; height: 100%; margin: 0; padding: 0; opacity: 0; cursor: pointer; }
.val-head-upload-input::file-selector-button { width: 100%; height: 100%; margin: 0; cursor: pointer; }
.val-head-upload[aria-disabled="true"] { opacity: 0.5; cursor: default; }
.val-head-upload-input:disabled, .val-head-upload-input:disabled::file-selector-button { cursor: default; }
.val-head-refresh { margin-left: auto; }
.gvv-replace-upload { position: absolute; top: 10px; right: 10px; z-index: 35; display: inline-flex; align-items: center; justify-content: center; min-width: 80px; min-height: 30px; padding: 4px 10px; border: 1px solid var(--gc-line-soft); border-radius: 7px; background: rgba(20,20,20,.82); color: var(--gc-text); font-size: 12px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
.gc-frame:hover > .gvv-replace-upload, .gc-frame:focus-within > .gvv-replace-upload { opacity: 1; pointer-events: auto; }
.gvv-replace-upload > span { pointer-events: none; }
.gvv-replace-upload-input { position: absolute; inset: 0; z-index: 1; display: block; width: 100%; height: 100%; margin: 0; padding: 0; opacity: 0; cursor: pointer; }
.gvv-replace-upload-input::file-selector-button { width: 100%; height: 100%; margin: 0; cursor: pointer; }
.gvv-replace-upload[aria-disabled="true"] { cursor: default; opacity: 1; }
.gvv-replace-upload-input:disabled, .gvv-replace-upload-input:disabled::file-selector-button { cursor: default; }
.val-head-status { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--gc-faint); white-space: nowrap; }
.val-head-status button { border: 1px solid var(--gc-line-soft); background: transparent; color: var(--gc-text); border-radius: 6px; padding: 1px 6px; cursor: pointer; font-size: 11px; }
.val-head-fail { color: #ff8f8f; }
.val-error { color: #ff8f8f; font-size: 12px; padding: 6px 10px; }
.val-empty { color: var(--gc-faint); font-size: 12px; padding: 12px 10px; }
.val-row { position: relative; }
.val-row > .gc-row { width: 100%; min-width: 0; }
.val-row.is-selecting > .gc-row { padding-right: 36px; }
.val-row-select { position: absolute !important; top: 50%; right: 10px; z-index: 2; display: grid !important; width: 18px; height: 18px; margin: 0 !important; padding: 0 !important; place-items: center; line-height: 1; transform: translateY(-50%); }
.val-row-select input { margin: 0; accent-color: var(--gc-accent); }
.val-row .gc-row-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.val-row-action { position: absolute; top: 50%; transform: translateY(-50%); min-width: 44px; height: 28px; min-height: 28px; padding: 0 6px; border: 1px solid var(--gc-line-soft); background: var(--gc-panel); color: var(--gc-muted); border-radius: 999px; font-size: 10px; cursor: pointer; opacity: 0; pointer-events: none; transition: opacity .15s ease, color .15s ease, border-color .15s ease; }
.val-row-rename { right: 58px; }
.val-row-delete { right: 8px; }
.val-row:hover > .gc-row, .val-row:has(> .val-row-action:focus-visible) > .gc-row { padding-right: 112px; }
.val-row:hover .val-row-action { opacity: 1; pointer-events: auto; }
.val-row:has(> .val-row-action:focus-visible) .val-row-action { opacity: 1; pointer-events: auto; }
.val-row-action:hover:not(:disabled), .val-row-action:focus-visible { color: var(--gc-text); border-color: var(--gc-accent-line); }
.val-row-action:disabled { cursor: default; opacity: 0.4; }
.gc-tab-video .gc-stage-video,
.gc-tab-video .gc-video-top,
.gc-tab-video .gvv-video-col { min-height: 0; }
.gc-tab-video .gc-video-top { display: flex; height: 0; grid-template-columns: none; flex: 1 1 0; }
.gc-tab-video .gvv-video-col { width: 100%; flex: 1 1 0; }
.gc-tab-video .gc-frame { width: 100%; height: 100%; min-height: 0; max-height: none; flex: 1 1 0; aspect-ratio: auto; }
@media (prefers-reduced-motion: reduce) { .val-row-action { transition: none; } }
.val-load-more { margin: 8px 10px 12px; border: 1px solid var(--gc-accent-line); background: var(--gc-accent-soft); color: var(--gc-text); border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.val-dialog-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 40; }
.val-dialog { background: var(--gc-panel2); border: 1px solid var(--gc-line-soft); border-radius: 12px; padding: 16px; max-width: 420px; width: calc(100% - 32px); color: var(--gc-text); }
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
`
