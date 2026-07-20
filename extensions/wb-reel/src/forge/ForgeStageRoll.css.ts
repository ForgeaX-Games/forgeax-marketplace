/**
 * ForgeStageRoll 样式 —— 与 ForgeChatPanel 共栖在 Forge 右侧栏；
 * 出现在消息流上方, 作为"管道当前状态"的固定卡片柱.
 *
 * 用 design tokens (--ks-amber / --ks-border-soft / --ks-text-dim) 保持与
 * ChatPanel 视觉同源; 不引入新的颜色变量.
 */
export const stageRollCss = `
.ks-forge-stages-roll {
  flex-shrink: 0;
  padding: 12px 16px 14px;
  border-bottom: 1px solid var(--ks-border-soft);
  background: var(--ks-panel);
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 50vh;
  overflow-y: auto;
}

.ks-forge-stages-roll-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 11px;
  color: var(--ks-text-dim);
}
.ks-forge-stages-roll-kicker {
  letter-spacing: 0.26em;
  color: var(--ks-amber);
  text-transform: uppercase;
}
.ks-forge-stages-roll-sub {
  font-size: 12px;
  color: var(--ks-text);
}

.ks-forge-stages-roll-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ks-forge-stage-card {
  border: 1px solid var(--ks-border-soft);
  border-radius: 6px;
  background: var(--ks-panel-elev);
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.ks-forge-stage-card.is-current {
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 1px var(--ks-amber-soft, rgba(255, 176, 64, 0.18));
}
.ks-forge-stage-card.is-confirmed {
  opacity: 0.78;
}
.ks-forge-stage-card.is-failed {
  border-color: #c93b3b;
}

.ks-forge-stage-card-inner {
  padding: 10px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ks-forge-stage-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ks-forge-stage-card-titlewrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ks-forge-stage-card-kicker {
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--ks-text-dim);
  text-transform: uppercase;
}
.ks-forge-stage-card-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ks-text);
}

.ks-forge-stage-chip {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--ks-border-soft);
  font-family: var(--ks-font-mono);
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.ks-forge-stage-chip.is-idle      { color: var(--ks-text-dim); }
.ks-forge-stage-chip.is-running   { color: var(--ks-amber); border-color: var(--ks-amber); }
.ks-forge-stage-chip.is-await     { color: var(--ks-amber); border-color: var(--ks-amber); }
.ks-forge-stage-chip.is-confirmed { color: #4dbb6f; border-color: #4dbb6f55; }
.ks-forge-stage-chip.is-failed    { color: #ee6464; border-color: #ee646488; }

.ks-forge-stage-card-body {
  font-size: 13px;
  color: var(--ks-text);
  line-height: 1.7;
}
.ks-forge-stage-body-empty {
  color: var(--ks-text-dim);
  font-size: 12px;
  font-style: italic;
}
.ks-forge-stage-body-error {
  color: #ee6464;
  font-size: 12.5px;
  white-space: pre-wrap;
}

.ks-forge-stage-row {
  display: grid;
  grid-template-columns: 60px 1fr;
  gap: 8px;
  margin-bottom: 4px;
}
.ks-forge-stage-row-key {
  font-size: 10.5px;
  color: var(--ks-text-dim);
  letter-spacing: 0.06em;
}
.ks-forge-stage-row-val { color: var(--ks-text); }

.ks-forge-stage-logline-main {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}
.ks-forge-stage-logline-alts {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  color: var(--ks-text-dim);
}
.ks-forge-stage-logline-alts li {
  display: grid;
  grid-template-columns: 60px 1fr;
  gap: 8px;
}

.ks-forge-stage-synopsis p { margin: 0 0 8px 0; }
.ks-forge-stage-synopsis-beats {
  margin: 0;
  padding-left: 18px;
  font-size: 12.5px;
  color: var(--ks-text-dim);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ks-forge-stage-outline {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ks-forge-stage-outline strong { color: var(--ks-text); }

.ks-forge-stage-outline-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.ks-forge-stage-outline-text { flex: 1; min-width: 0; }
.ks-forge-stage-outline-tools {
  display: inline-flex;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 120ms ease;
}
.ks-forge-stage-outline-item:hover .ks-forge-stage-outline-tools,
.ks-forge-stage-outline-item:focus-within .ks-forge-stage-outline-tools {
  opacity: 1;
}
.ks-forge-stage-outline-tool {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid var(--ks-border-soft);
  background: transparent;
  color: var(--ks-text-dim);
  cursor: pointer;
  line-height: 1.4;
  font-family: var(--ks-font-mono);
}
.ks-forge-stage-outline-tool:hover:not(:disabled) {
  color: var(--ks-amber);
  border-color: var(--ks-amber);
}
.ks-forge-stage-outline-tool.is-danger:hover:not(:disabled) {
  color: #ee6464;
  border-color: #ee6464;
}
.ks-forge-stage-outline-tool:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.ks-forge-stage-card-actions {
  display: flex;
  gap: 6px;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.ks-forge-stage-btn {
  font-size: 12px;
  padding: 4px 12px;
  border-radius: 4px;
  border: 1px solid var(--ks-border-soft);
  background: transparent;
  color: var(--ks-text);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.ks-forge-stage-btn:hover:not(:disabled) {
  border-color: var(--ks-amber);
  color: var(--ks-amber);
}
.ks-forge-stage-btn.is-primary {
  background: var(--ks-amber);
  color: var(--ks-panel);
  border-color: var(--ks-amber);
  font-weight: 600;
}
.ks-forge-stage-btn.is-primary:hover:not(:disabled) {
  filter: brightness(1.05);
  color: var(--ks-panel);
}
.ks-forge-stage-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ks-forge-stage-running {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ks-amber);
}
.ks-forge-stage-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid currentColor;
  border-right-color: transparent;
  animation: ks-forge-stage-spin 0.7s linear infinite;
}
@keyframes ks-forge-stage-spin {
  to { transform: rotate(360deg); }
}

.ks-forge-stages-history {
  font-size: 11.5px;
  color: var(--ks-text-dim);
  border-top: 1px dashed var(--ks-border-soft);
  padding-top: 8px;
}
.ks-forge-stages-history summary {
  cursor: pointer;
  letter-spacing: 0.08em;
  color: var(--ks-amber);
  margin-bottom: 4px;
}
.ks-forge-stages-history ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
`
