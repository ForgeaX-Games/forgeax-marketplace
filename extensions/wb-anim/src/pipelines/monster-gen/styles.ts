const CSS_ID = 'monster-gen-pipeline-css'

export function injectStyles(): void {
  if (document.getElementById(CSS_ID)) return
  const style = document.createElement('style')
  style.id = CSS_ID
  style.textContent = STYLES
  document.head.appendChild(style)
}

export function removeStyles(): void {
  document.getElementById(CSS_ID)?.remove()
}

const STYLES = /* css */ `

/* ── Layout Overrides ──────────────────────────────────────────── */

.editor-center-overlay.mg-with-bottom {
  bottom: 210px !important;
}

/* ── Left Panel (Config) ──────────────────────────────────────── */

.mg-config {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  height: 100%;
  overflow-y: auto;
}

.mg-config label {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 3px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.mg-config input,
.mg-config select,
.mg-config textarea {
  width: 100%;
  padding: 6px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}

.mg-config input:focus,
.mg-config select:focus,
.mg-config textarea:focus {
  border-color: var(--accent);
}

.mg-config textarea {
  resize: vertical;
  min-height: 60px;
}

.mg-row {
  display: flex;
  gap: 6px;
}
.mg-row > div {
  flex: 1;
  min-width: 0;
}

.mg-section-title {
  font-size: 11px;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 6px 0 2px;
  border-bottom: 1px solid var(--border);
  margin-top: 4px;
}

.mg-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mg-chip {
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  transition: all 0.15s;
}

.mg-chip:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.mg-chip.on {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}

/* Swatch chip — shows 3 tiny color dots next to a palette label */
.mg-chip-swatch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.mg-swatch-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.15);
  display: inline-block;
  flex-shrink: 0;
}

/* Category cards (big clickable grid) */
.mg-cat-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.mg-cat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}

.mg-cat-card:hover {
  border-color: var(--accent);
  color: var(--text-primary);
}

.mg-cat-card.on {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}

.mg-cat-icon {
  font-size: 20px;
  line-height: 1;
}

.mg-cat-name {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.mg-cat-desc {
  font-size: 9px;
  opacity: 0.7;
  line-height: 1.2;
}

/* Inline label with a dim hint next to it */
.mg-label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.mg-label-hint {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.6;
  text-transform: none;
  letter-spacing: 0;
}

.mg-morph-pill {
  display: inline-block;
  margin-left: auto;
  padding: 1px 8px;
  font-size: 10px;
  color: var(--accent);
  background: var(--accent-dim);
  border-radius: 999px;
  text-transform: none;
  letter-spacing: 0;
}

.mg-subsection {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mg-chips-empty {
  font-size: 10px;
  color: var(--text-secondary);
  opacity: 0.6;
  padding: 2px 4px;
}

.mg-btn {
  width: 100%;
  padding: 10px;
  background: var(--accent);
  color: var(--bg-primary);
  border: none;
  border-radius: var(--radius);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: background 0.15s;
}

.mg-btn:hover {
  background: var(--accent-hover);
}

.mg-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.mg-btn-secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-primary);
}

.mg-btn-secondary:hover {
  border-color: var(--accent);
  color: var(--accent);
}

/* ── Left Panel Hero Preview ──────────────────────────────────── */

.mg-hero-panel {
  width: 100%;
  aspect-ratio: 1;
  max-height: 260px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}

.mg-hero-panel img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
}

.mg-hero-panel .mg-hero-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 12px;
  border: none;
  background: none;
}

/* ── Left Panel Upload Zone ───────────────────────────────────── */

.mg-upload-area {
  width: 100%;
  box-sizing: border-box;
  min-height: 92px;
  max-height: 220px;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 120ms, background 120ms;
}

.mg-upload-area:hover {
  border-color: var(--accent);
  background: rgba(127, 127, 255, 0.05);
}

/*
 * Dragging state gets a stronger visual so the user knows the drop will
 * land here. Solid border + animated inner glow.
 */
.mg-upload-area.drag {
  border-color: var(--accent);
  border-style: solid;
  background: rgba(127, 127, 255, 0.14);
  box-shadow: inset 0 0 0 2px rgba(127, 127, 255, 0.35);
}

/*
 * Let drag/drop events pass through inner decorative content straight to
 * the drop zone. Without this the dragenter/dragleave counter has to
 * increment for every child span/div the cursor crosses, adding noise.
 */
.mg-upload-area.drag * {
  pointer-events: none;
}

.mg-upload-empty {
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 12px;
  width: 100%;
}

.mg-upload-filled {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 6px;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

/*
 * The thumbnail must never exceed its wrapper — we set BOTH max dimensions
 * AND width/height auto so an oversized native image can't ignore them
 * (some CSS resets set img with width 100% which would stretch vertically).
 * display block plus object-fit contain lets aspect ratio be preserved.
 */
.mg-upload-thumb {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 200px;
  object-fit: contain;
  border-radius: 4px;
}

.mg-upload-clear {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mg-upload-clear:hover {
  background: rgba(220, 50, 50, 0.9);
}

/* ── Center Panel (Large Preview) ─────────────────────────────── */

.mg-preview-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  position: relative;
  background: var(--bg-primary);
}

.mg-preview-placeholder {
  color: var(--text-secondary);
  font-size: 14px;
  opacity: 0.5;
}

/*
 * Center stage preview — big enough to actually read at a glance on any
 * screen wider than ~1200px. The 1024 / 2048 hero art should fully display
 * at its target DPI when there is room, but never overflow the panel.
 */
.mg-preview-img {
  max-width: 96%;
  max-height: 92%;
  width: auto;
  height: auto;
  object-fit: contain;
  image-rendering: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: repeating-conic-gradient(#20231f 0% 25%, #2a2e29 0% 50%) 0 0 / 18px 18px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.mg-preview-img.pixel-mode {
  image-rendering: pixelated;
}

.mg-preview-label {
  margin-top: 10px;
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 600;
  letter-spacing: 0.5px;
}

/* ── Right Sidebar ────────────────────────────────────────────── */

.mg-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.mg-sidebar-section {
  overflow-y: auto;
  padding: 8px;
}

.mg-sidebar-title {
  font-size: 10px;
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 1px;
  padding: 4px 0;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  background: var(--bg-panel);
  z-index: 1;
}

/* ── Direction List (in sidebar) ──────────────────────────────── */

.mg-dir-list {
  flex: 1;
  min-height: 0;
}

.mg-dir-row {
  margin-bottom: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--bg-primary);
}

.mg-dir-row.generating {
  border-color: var(--accent);
}

.mg-dir-row-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 6px;
  background: var(--bg-active);
}

.mg-dir-name {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-primary);
}

.mg-dir-badge {
  font-size: 8px;
  padding: 1px 4px;
  border-radius: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.mg-dir-badge.generating {
  background: var(--accent-dim);
  color: var(--accent);
}

.mg-dir-badge.done {
  background: rgba(46, 204, 113, 0.15);
  color: var(--success);
}

.mg-dir-badge.mirror {
  background: rgba(100, 100, 100, 0.2);
  color: var(--text-secondary);
}

.mg-dir-badge.error {
  background: rgba(255, 68, 68, 0.15);
  color: var(--danger);
}

.mg-dir-badge.waiting {
  background: rgba(100, 100, 100, 0.1);
  color: var(--text-secondary);
}

.mg-dir-thumbs {
  display: flex;
  gap: 2px;
  padding: 3px 4px;
  min-height: 30px;
  align-items: center;
}

.mg-thumb {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--bg-panel);
  image-rendering: pixelated;
  object-fit: contain;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.1s;
  flex-shrink: 0;
}

.mg-thumb:hover {
  border-color: var(--accent);
  transform: scale(1.15);
  z-index: 2;
  position: relative;
}

/* ── History (in sidebar) ─────────────────────────────────────── */

.mg-sidebar-history {
  flex-shrink: 0;
  max-height: 200px;
  border-top: 1px solid var(--border);
}

.mg-hist-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px;
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.15s;
}

.mg-hist-item:hover {
  background: var(--bg-hover);
}

.mg-hist-item.active {
  background: var(--accent-dim);
}

.mg-hist-thumb {
  width: 28px;
  height: 28px;
  border-radius: 2px;
  background: var(--bg-primary);
  object-fit: contain;
  flex-shrink: 0;
}

.mg-hist-info {
  flex: 1;
  min-width: 0;
}

.mg-hist-name {
  font-size: 11px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mg-hist-time {
  font-size: 9px;
  color: var(--text-secondary);
}

/* ── Bottom Panel (Progress / Log) ────────────────────────────── */

.mg-progress {
  display: flex;
  flex-direction: column;
  max-height: 200px;
  padding: 8px 12px;
  gap: 6px;
  overflow: hidden;
}

.mg-progress-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mg-progress-stage {
  font-size: 12px;
  color: var(--accent);
  font-weight: 600;
}

.mg-progress-pct {
  font-size: 11px;
  color: var(--text-secondary);
  margin-left: auto;
}

.mg-progress-bar-track {
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
  flex-shrink: 0;
}

.mg-progress-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s ease;
  width: 0%;
}

.mg-log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  font-family: 'Consolas', 'SF Mono', monospace;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
  background: var(--bg-primary);
  border-radius: var(--radius);
  padding: 6px 8px;
}

.mg-log-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.mg-log-line.error {
  color: var(--danger);
}

.mg-log-line.success {
  color: var(--success);
}

.mg-log-line.info {
  color: var(--accent);
}

`
