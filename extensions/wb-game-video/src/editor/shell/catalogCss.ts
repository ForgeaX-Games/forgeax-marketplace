/**
 * 视频/配置栏目（catalog）的共享 gc-* 样式 —— 从旧 forge/CatalogTabs 的 CATALOG_CSS
 * 原样搬来（解耦自已删的 FMV 外壳），供 GraphVideoView（视频 tab）与 CatalogShell
 * （界面/规则）共用。两处都经 injectStyleOnce('graph-catalog') 注入，去重后只落一份。
 */
import { PREVIEW_CLOCK_CSS } from './previewClock'

export const CATALOG_CSS = `
${PREVIEW_CLOCK_CSS}
.gc-tab {
  --gc-bg: var(--work, #0e0c09);
  --gc-panel: var(--panel, #1b1713);
  --gc-panel2: var(--panel2, #252019);
  --gc-panel3: var(--panel3, #2f2923);
  --gc-line: var(--line, #403830);
  --gc-line-soft: var(--line-soft, #2e2924);
  --gc-text: var(--txt, #f6f1e9);
  --gc-muted: var(--muted, #b8aea0);
  --gc-faint: var(--faint, #8c8377);
  --gc-accent: var(--accent, #f08840);
  --gc-accent-soft: var(--accent-soft, rgba(240,136,64,.16));
  --gc-accent-line: var(--accent-line, rgba(240,136,64,.42));
  flex: 1; min-height: 0; min-width: 0;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  background: var(--gc-bg);
  color: var(--gc-text);
}
.gc-tab-video { grid-template-columns: 248px minmax(0, 1fr); }
.gc-tab-video.has-sidepanel { grid-template-columns: 248px minmax(0, 1fr) 340px; }
/* ── 左栏列表 ── */
.gc-list {
  display: flex; flex-direction: column; min-height: 0;
  background: var(--gc-panel);
  border: 1px solid var(--gc-line-soft);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: var(--shadow, 0 1px 4px rgba(0,0,0,.22));
}
.gc-list-head {
  flex: none;
  display: flex; align-items: center; gap: 8px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--gc-line-soft);
  background: rgba(255,255,255,0.025);
}
.gc-list-ico { font-size: 14px; }
.gc-list-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.gc-list-count {
  margin-left: auto;
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--gc-faint);
  background: rgba(255,255,255,0.05);
  border-radius: 999px; padding: 1px 8px;
}
.gc-list-body { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.gc-row {
  all: unset; box-sizing: border-box;
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid transparent;
  font-size: 12.5px; color: var(--gc-muted);
  transition: background .12s, color .12s, border-color .12s;
}
.gc-row:hover { background: var(--gc-panel2); color: var(--gc-text); }
.gc-row.is-on {
  background: var(--gc-accent-soft);
  border-color: var(--gc-accent-line);
  color: var(--gc-text);
}
.gc-row-mark {
  flex: none; width: 14px; text-align: center;
  font-size: 11px; color: #5fbf7f;
}
.gc-row-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── 右栏预览 ── */
.gc-preview {
  display: flex; min-height: 0; min-width: 0;
  background: var(--gc-panel);
  border: 1px solid var(--gc-line-soft);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: var(--shadow, 0 1px 4px rgba(0,0,0,.22));
}
.gc-stage {
  box-sizing: border-box;
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(8px, 1.3dvh, 14px);
  padding: clamp(10px, 1.6dvh, 18px);
}
.gc-stage-video {
  position: relative;
  height: 100%;
  --gc-timeline-h: clamp(204px, 22dvh, 240px);
}
/* 时间轴保持自身高度（内部自带滚动），由视频列吸收纵向伸缩，避免整段被挤压外溢。 */
.gc-stage-video > .mtl-root { flex: none; min-height: 0; }
.gc-stage-video > .gc-readonly-note { flex: none; }
.gc-video-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gc-video-title { color: var(--gc-text); font-size: 16px; font-weight: 700; }
.gc-video-sub { color: var(--gc-faint); font-size: 12px; margin-top: 2px; }
.gc-action {
  border: 1px solid var(--gc-accent-line);
  background: var(--gc-accent-soft);
  color: var(--gc-text);
  border-radius: 8px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 12px;
}
.gc-action:hover { background: rgba(240,136,64,.24); border-color: var(--gc-accent); }
/* 迷你动作按钮——常量/选取公式切换、运算符号按钮、"添加一项"等 ValueExprEditor 系小控件共用。
   .is-on 才是"当前选中/激活"的真正视觉标记（无 .is-on 时是未选中态，不是禁用）。 */
.gc-mini-action {
  border: 1px solid var(--gc-line);
  background: var(--gc-panel2);
  color: var(--gc-muted);
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 11.5px;
  line-height: 1.5;
  cursor: pointer;
  transition: background .12s, color .12s, border-color .12s;
}
.gc-mini-action:hover { border-color: var(--gc-accent-line); color: var(--gc-text); }
.gc-mini-action.is-on {
  background: var(--gc-accent-soft);
  border-color: var(--gc-accent-line);
  color: var(--gc-text);
  font-weight: 700;
}
.gc-mini-action:disabled { opacity: .4; cursor: not-allowed; }
.gc-mini-danger {
  border: 1px solid rgba(248,113,113,.4);
  background: rgba(248,113,113,.08);
  color: #ff9a9a;
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 11.5px;
  cursor: pointer;
  transition: background .12s, border-color .12s;
}
.gc-mini-danger:hover { background: rgba(248,113,113,.2); border-color: rgba(248,113,113,.75); }
.gc-video-top {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.85fr);
  gap: clamp(8px, 1.3dvh, 14px);
  align-items: stretch;
  min-height: 0;
  flex: 1 1 auto;
}
.gc-frame {
  position: relative;
  width: 100%; aspect-ratio: 16 / 9;
  max-height: min(58dvh, 100%);
  background: radial-gradient(120% 120% at 50% 30%, #251f18 0%, #070504 100%);
  border: 1px solid var(--gc-accent-line);
  border-radius: 12px;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.gc-badge {
  position: absolute; top: 14px; left: 14px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 9px;
  font-size: 13px; font-weight: 700; color: var(--gc-accent);
  background: rgba(0,0,0,0.55);
  border: 1px solid var(--gc-accent-line);
}
.gc-badge em { font-style: normal; font-weight: 700; color: var(--gc-muted); opacity: 0.85; }
.gc-video { width: 100%; height: 100%; object-fit: contain; background: #000; }
.gc-content-anchor {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.gc-preview-overlays {
  position: absolute;
  inset: 0;
  pointer-events: none;
  container-type: size;
}
.gc-preview-overlay {
  position: absolute;
  transform: translate(-50%, -50%);
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-width: 0;
  max-width: 78%;
  color: var(--gc-text);
  text-align: center;
  white-space: nowrap;
  text-shadow: 0 2px 8px rgba(0,0,0,.8);
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
  outline: none;
}
.gc-preview-overlay.is-movable { cursor: grab; }
.gc-preview-overlay.is-movable:active { cursor: grabbing; }
.gc-preview-overlay.is-selected .gc-preview-label {
  border-color: var(--gc-accent);
  box-shadow: 0 0 0 2px rgba(240,136,64,.24), 0 0 18px rgba(240,136,64,.3);
}
.gc-preview-overlay.is-hotspot-editing .gc-preview-label {
  border-color: rgba(248,113,113,.95);
  background: rgba(88,18,18,.74);
  box-shadow: 0 0 0 2px rgba(248,113,113,.34), 0 0 22px rgba(248,113,113,.45);
}
.gc-preview-overlay .gc-preview-label {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0,0,0,.58);
  border: 1px solid rgba(255,255,255,.16);
  font-size: 13px;
}
.gc-preview-overlay.is-subtitle {
  /* 位置完全由内联 x/y + 基类 translate(-50%,-50%) 决定（可拖拽、默认底部居中）；
     不再用 left:50% 硬锚，否则会与拖拽写入的 x 冲突。 */
  max-width: 82%;
  white-space: normal;
}
.gc-preview-overlay.is-subtitle .gc-preview-label {
  font-size: clamp(16px, 1.35vw, 28px);
  white-space: normal;
  border: none;
  background: transparent;
  text-shadow: 0 2px 8px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,.95);
}
.gc-preview-overlay.is-settlement .gc-preview-label {
  color: #ffd8bf;
  border-color: rgba(240,136,64,.5);
  background: rgba(40,20,10,.62);
  font-weight: 800;
}
.gc-preview-overlay.is-option .gc-preview-label {
  color: #eadbff;
  border-color: rgba(199,155,242,.48);
}
.gc-preview-overlay.is-qte .gc-preview-label {
  color: #cfe4ff;
  border-color: rgba(95,163,247,.48);
}
.gc-preview-overlay.is-component .gc-preview-label {
  color: #e2e8f0;
  border-color: rgba(148,163,184,.48);
}
.gc-preview-detail {
  max-width: 100%;
  padding: 3px 9px;
  border-radius: 8px;
  background: rgba(0,0,0,.66);
  border: 1px solid rgba(255,255,255,.12);
  color: rgba(255,255,255,.9);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-line;
  text-align: left;
}
.gc-preview-skin-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 25;
}
/* 挂皮肤时，皮肤自身已画在 cue 的 x/y 上（有样式）；这里只叠一个「平时透明、hover / 选中
   才显描边」的可拖热区，避免与皮肤重复出现一个常驻的定位符号。拖它即改该 cue 的 x/y。 */
.gc-preview-overlay.is-skinned {
  width: 56px;
  height: 56px;
}
.gc-preview-overlay.is-skinned .gc-preview-ring {
  inset: 0;
  width: auto;
  height: auto;
  border-style: dashed;
  border-color: transparent;
  box-shadow: none;
  animation: none;
  transition: border-color .12s ease, box-shadow .12s ease;
}
.gc-preview-overlay.is-skinned:hover .gc-preview-ring,
.gc-preview-overlay.is-skinned.is-selected .gc-preview-ring {
  border-color: rgba(240,136,64,.95);
  box-shadow: 0 0 14px rgba(240,136,64,.5);
}
.gc-preview-overlay.is-skinned .gc-preview-label,
.gc-preview-overlay.is-skinned .gc-preview-detail {
  display: none;
}
.gc-preview-overlay.is-skinned:hover .gc-preview-label,
.gc-preview-overlay.is-skinned.is-selected .gc-preview-label {
  display: block;
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  background: rgba(0,0,0,.72);
  border-color: rgba(240,136,64,.55);
  color: #ffd8bf;
  font-size: 11px;
}
.gc-preview-ring {
  position: absolute;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2px solid rgba(95,163,247,.9);
  box-shadow: 0 0 20px rgba(95,163,247,.55), inset 0 0 12px rgba(95,163,247,.25);
  animation: gcPreviewPulse 1.2s ease-in-out infinite;
}
.gc-preview-hotspot-ring {
  position: absolute;
  width: var(--gc-hotspot-r, 16%);
  aspect-ratio: 1;
  border-radius: 50%;
  border: 1px dashed rgba(199,155,242,.72);
  background: rgba(199,155,242,.08);
  box-shadow: 0 0 16px rgba(199,155,242,.2);
}
.gc-preview-overlay.is-hotspot-editing .gc-preview-hotspot-ring {
  border-color: rgba(248,113,113,.95);
  background: rgba(248,113,113,.14);
  box-shadow: 0 0 22px rgba(248,113,113,.42);
}
@keyframes gcPreviewPulse {
  0%, 100% { transform: scale(1); opacity: .8; }
  50% { transform: scale(1.14); opacity: 1; }
}
.gc-materialbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.gc-materialbar-meta { color: var(--gc-faint); font-size: 12px; }
.gc-materialbar-hint { color: rgba(184, 240, 238, 0.72); font-size: 11px; }
.gc-readonly-note {
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed var(--gc-line);
  color: var(--gc-muted);
  background: rgba(255,255,255,0.025);
  font-size: 12px;
  text-align: center;
}
.gc-inspector-subhead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--gc-line-soft);
}
.gc-inspector-subhead > span:first-child { color: var(--gc-text); font-size: 12px; font-weight: 600; }
.gc-inspector-subhint { color: var(--gc-faint); font-size: 11px; }
.gc-add-branch-btn {
  width: 100%;
  border: 1px dashed var(--gc-accent-line);
  background: rgba(212, 255, 72, 0.06);
  color: var(--gc-accent);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12px;
  cursor: pointer;
}
.gc-add-branch-btn:hover { background: rgba(212, 255, 72, 0.12); }
.gc-zoombar { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; }
.gc-zoombar input[type="range"] { width: 120px; accent-color: var(--gc-accent); cursor: pointer; }
.gc-zoom-val { color: var(--gc-faint); font-size: 11px; font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }
.gc-zoom-fit {
  border: 1px solid var(--gc-line); background: var(--gc-panel2); color: var(--gc-text);
  border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer;
}
.gc-zoom-fit:hover { border-color: var(--gc-accent-line); }
.gc-mtimeline-viewport {
  position: relative;
  height: var(--gc-timeline-h);
  min-height: 204px;
  border-radius: 10px;
  border: 1px solid var(--gc-line-soft);
  background: rgba(0,0,0,0.22);
  overflow: auto;
  overscroll-behavior: contain;
}
.gc-mtimeline-canvas {
  position: relative;
  min-width: 100%;
  min-height: 100%;
  touch-action: none;
}
.gc-mtimeline-ruler {
  position: sticky;
  left: 0; top: 0; height: 22px;
  border-bottom: 1px solid var(--gc-line-soft);
  background: rgba(20,16,12,0.94);
  z-index: 6;
}
.gc-mtick {
  position: absolute;
  top: 0;
  height: 22px;
  line-height: 22px;
  padding-left: 4px;
  font-size: 10px;
  color: var(--gc-faint);
  font-variant-numeric: tabular-nums;
  border-left: 1px solid var(--gc-line-soft);
  pointer-events: none;
  white-space: nowrap;
}
.gc-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-1px);
  background: var(--gc-accent);
  box-shadow: 0 0 12px rgba(240,136,64,.65);
  z-index: 8;
  pointer-events: none;
}
.gc-playhead::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--gc-accent);
  box-shadow: 0 0 8px rgba(240,136,64,.85);
}
.gc-mempty {
  position: absolute;
  inset: 22px 0 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--gc-faint);
  font-size: 13px;
}
.gc-mclip {
  position: absolute;
  top: 42px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  color: #fff;
  font-size: 12px;
  cursor: grab;
  user-select: none;
  background: rgba(18, 14, 11, 0.88);
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 6px 18px rgba(0,0,0,0.28);
  overflow: hidden;
}
.gc-mclip::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--gc-accent);
  box-shadow: 0 0 12px currentColor;
}
.gc-mclip:active { cursor: grabbing; }
.gc-mclip.is-selected { outline: 2px solid var(--gc-accent); outline-offset: 2px; }
.gc-mclip.is-subtitle { border-color: rgba(95,201,128,.58); color: #d6ffe2; }
.gc-mclip.is-subtitle::before { background: #62c980; }
.gc-mclip.is-settlement { border-color: rgba(240,136,64,.58); color: #ffd8bf; }
.gc-mclip.is-settlement::before { background: var(--gc-accent); }
.gc-mclip.is-qte { border-color: rgba(95,163,247,.58); color: #cfe4ff; }
.gc-mclip.is-qte::before { background: #5fa3f7; }
.gc-mclip.is-qte-window {
  border-color: rgba(56, 189, 186, 0.62);
  border-style: dashed;
  color: #b8f0ee;
  background: rgba(8, 28, 30, 0.72);
}
.gc-mclip.is-qte-window::before { background: #38bdba; opacity: 0.85; }
.gc-mclip.is-option { border-color: rgba(199,155,242,.58); color: #eadbff; }
.gc-mclip.is-option::before { background: #c79bf2; }
.gc-mhandle {
  position: absolute;
  top: 0; bottom: 0;
  width: 8px;
  border: 0;
  padding: 0;
  background: rgba(255,255,255,0.32);
  cursor: ew-resize;
}
.gc-mhandle.is-left { left: 0; border-radius: 8px 0 0 8px; }
.gc-mhandle.is-right { right: 0; border-radius: 0 8px 8px 0; }
.gc-sidepanel {
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--gc-line-soft);
  background: var(--gc-panel);
  overflow: auto;
}
.gc-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.gc-side-head button {
  border: 1px solid var(--gc-line);
  background: var(--gc-panel2);
  color: var(--gc-text);
  border-radius: 7px;
  padding: 5px 10px;
  cursor: pointer;
}
.gc-lib-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.gc-lib-item {
  min-height: 92px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--gc-line-soft);
  background: var(--gc-panel2);
  color: var(--gc-text);
  border-radius: 10px;
  padding: 14px 10px;
  text-align: center;
  cursor: pointer;
  transition: border-color .12s, background .12s, transform .12s;
}
.gc-lib-item[draggable="true"] { cursor: grab; }
.gc-lib-item[draggable="true"]:active { cursor: grabbing; }
.gc-lib-item:hover { border-color: var(--gc-accent-line); background: var(--gc-accent-soft); transform: translateY(-1px); }
.gc-lib-item strong { font-size: 12.5px; font-weight: 650; letter-spacing: .02em; color: var(--gc-text); }
.gc-lib-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 11px;
  color: var(--gc-accent);
  background: var(--gc-accent-soft);
  border: 1px solid var(--gc-accent-line);
  transition: background .12s, color .12s, transform .12s;
}
.gc-lib-ico svg { width: 22px; height: 22px; display: block; }
.gc-lib-item:hover .gc-lib-ico { background: rgba(240,136,64,.24); transform: scale(1.06); }
.gc-lib-item.is-disabled {
  cursor: not-allowed;
  opacity: 0.46;
  filter: grayscale(0.7);
}
.gc-lib-item.is-disabled:hover {
  border-color: rgba(255,255,255,0.1);
  background: var(--gc-panel2);
  transform: none;
}
.gc-lib-item.is-disabled:hover .gc-lib-ico { background: var(--gc-accent-soft); transform: none; }
.gc-inspector-empty {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gc-faint);
  font-size: 13px;
  text-align: center;
}
.gc-inspector-card { display: flex; flex-direction: column; gap: 12px; }
.gc-inspector-title { color: var(--gc-text); font-size: 15px; font-weight: 700; }
.gc-inspector-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255,255,255,0.58);
}
.gc-hotspot-sliders { display: flex; flex-direction: column; gap: 10px; }
.gc-range-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gc-range-field span {
  display: flex;
  justify-content: space-between;
  color: var(--gc-faint);
  font-size: 11px;
}
.gc-range-field b {
  color: var(--gc-text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.gc-range-field input[type="range"] {
  width: 100%;
  accent-color: var(--gc-accent);
}
.gc-field,
.gc-field-row label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.gc-field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.gc-field span,
.gc-field-row span { color: var(--gc-faint); font-size: 11px; }
.gc-field input,
.gc-field select,
.gc-field-row input {
  min-width: 0;
  width: 100%;
  border: 1px solid var(--gc-line);
  background: rgba(0,0,0,0.28);
  color: var(--gc-text);
  border-radius: 7px;
  padding: 7px 8px;
}
/* 主题化滑杆（覆盖浏览器默认蓝白 + 去掉上面 input 盒子样式）—— 与页面 accent 对齐 */
.gc-inspector-card input[type=range],
.gc-field-row input[type=range],
.gc-field input[type=range] {
  -webkit-appearance: none; appearance: none;
  height: 4px; padding: 0; border: none; border-radius: 999px;
  background: rgba(255,255,255,.14); outline: none; cursor: pointer;
}
.gc-inspector-card input[type=range]::-webkit-slider-thumb,
.gc-field-row input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 13px; height: 13px; border-radius: 50%;
  background: var(--gc-accent); border: 2px solid rgba(0,0,0,.35);
}
.gc-inspector-card input[type=range]::-moz-range-thumb,
.gc-field-row input[type=range]::-moz-range-thumb {
  width: 13px; height: 13px; border-radius: 50%; border: 2px solid rgba(0,0,0,.35);
  background: var(--gc-accent);
}
.gc-inspector-card input[type=range]::-moz-range-track,
.gc-field-row input[type=range]::-moz-range-track {
  height: 4px; border-radius: 999px; background: rgba(255,255,255,.14);
}
.gc-frame-center { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.gc-play-glyph {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; color: #fff; padding-left: 4px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.22);
  animation: gcPulse 2.2s ease-in-out infinite;
}
@keyframes gcPulse { 0%,100% { transform: scale(1); opacity: .85; } 50% { transform: scale(1.06); opacity: 1; } }
.gc-frame-hint { font-size: 12px; color: rgba(255,255,255,0.5); letter-spacing: 0.08em; }

@media (max-aspect-ratio: 4 / 3), (max-width: 980px) {
  .gc-stage-video { --gc-timeline-h: clamp(204px, 20dvh, 228px); }
  .gc-video-top {
    grid-template-columns: minmax(0, 1fr);
  }
  .gc-frame {
    max-height: 42dvh;
    justify-self: center;
  }
}

@media (max-height: 760px) {
  .gc-stage-video { --gc-timeline-h: 204px; }
  .gc-video-head { gap: 8px; }
  .gc-video-title { font-size: 14px; }
}

.gc-meta { display: flex; flex-wrap: wrap; gap: 10px; }
.gc-meta-cell {
  display: flex; flex-direction: column; gap: 3px;
  padding: 8px 12px; border-radius: 8px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  min-width: 96px;
}
.gc-meta-cell--wide { flex: 1; min-width: 200px; }
.gc-meta-k { font-size: 10.5px; letter-spacing: 0.1em; color: rgba(255,255,255,0.45); }
.gc-meta-v { font-size: 13px; color: #fff; }
.gc-mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }

/* HUD 预览（界面 tab 的迷你示意） */
.gc-hud-mock { position: absolute; inset: 0; pointer-events: none; }
.gc-hud-bar { position: absolute; height: 10px; border-radius: 5px; }
.gc-hud-bar--player { left: 16px; bottom: 16px; width: 38%; background: linear-gradient(90deg,#5fbf7f,#3a7d52); }
.gc-hud-bar--boss { right: 16px; top: 16px; width: 42%; background: linear-gradient(90deg,#b5453a,#e0795f); }
.gc-hud-chip {
  position: absolute; right: 16px; bottom: 16px;
  padding: 4px 10px; border-radius: 7px; font-size: 11px; color: #fff;
  background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);
}

/* 规则卡片 */
.gc-rule-card {
  width: 100%;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  overflow: hidden;
}
.gc-rule-head {
  padding: 12px 16px; font-size: 14px; font-weight: 700; color: #fff;
  background: rgba(224,121,95,0.14);
  border-bottom: 1px solid rgba(224,121,95,0.3);
}
.gc-rule-list { list-style: none; margin: 0; padding: 8px 0; }
.gc-rule-item {
  padding: 10px 16px; font-size: 13px; color: rgba(255,255,255,0.82);
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.gc-rule-item:last-child { border-bottom: none; }
.gc-rule-form {
  display: flex;
  flex-direction: column;
  padding: 12px 0 8px;
}
.gc-rule-section {
  font-size: 12px;
  font-weight: 700;
  color: rgba(255,255,255,0.78);
  padding: 12px 18px 6px;
  letter-spacing: 0.03em;
}
.gc-paramrow {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px 12px;
  margin: 0;
  padding: 10px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  min-height: 24px;
}
.gc-paramrow:hover { background: rgba(255,255,255,0.03); }
.gc-paramrow--select { grid-template-columns: 108px minmax(120px, 220px); }
.gc-param-label {
  font-size: 13px;
  color: rgba(255,255,255,0.56);
}
.gc-rule-slider {
  position: relative;
  height: 5px;
  border-radius: 3px;
  background: rgba(255,255,255,0.1);
}
.gc-rule-slider-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  border-radius: 3px;
  background: linear-gradient(90deg, #e86f20, #f08840);
}
.gc-rule-slider-knob {
  position: absolute;
  top: 50%;
  width: 14px; height: 14px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  box-shadow: 0 0 0 4px rgba(240,136,64,.95), 0 1px 4px rgba(0,0,0,.4);
  pointer-events: none;
}
.gc-rule-range {
  position: absolute;
  inset: -8px 0;
  width: 100%;
  opacity: 0;
  cursor: grab;
}
.gc-rule-value {
  min-width: 54px;
  width: 128px;
  box-sizing: border-box;
  padding: 4px 10px;
  border-radius: 7px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #fff;
  font: inherit;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.gc-rule-unit {
  color: rgba(255,255,255,0.5);
  font-size: 12px;
}
.gc-rule-select {
  width: 100%;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #ddd;
}

.gc-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
}
.gc-empty-glyph { font-size: 38px; color: rgba(255,255,255,0.25); }
.gc-empty-text { font-size: 13px; color: rgba(255,255,255,0.5); }
`
