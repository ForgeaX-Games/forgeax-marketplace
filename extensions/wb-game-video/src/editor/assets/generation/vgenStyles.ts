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
  .vgen-body { grid-template-columns: 1fr; }
  .vgen-panel.is-page .vgen-body { padding: 16px 14px; }
  .vgen-panel.is-page .vgen-page-results .vgen-card { display: block; }
  .vgen-panel.is-page .vgen-history { max-height: none; margin-top: 16px; }
  .vgen-panel.is-page .vgen-page-composer,
  .vgen-panel.is-page .vgen-foot { width: calc(100% - 28px); }
}
@media (max-width:520px) { .vgen-head, .vgen-body, .vgen-foot { padding-left: 14px; padding-right: 14px; } .vgen-grid2, .vgen-frame-grid { grid-template-columns: 1fr; } .vgen-picker-grid { grid-template-columns: repeat(2,minmax(0,1fr)); } }
@media (prefers-reduced-motion:reduce) { .vgen-panel { transition: none; } .vgen-out-progress .fill, .vgen-btn-primary.running::before { animation-duration: 2.4s; } }
`
