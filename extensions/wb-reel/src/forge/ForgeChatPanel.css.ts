/**
 * ForgeChatPanel 样式。
 * 配色沿用 global.css 的 design tokens，不引入新的颜色变量。
 */
export const chatPanelCss = `
.ks-forge-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border-left: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-elev);
  backdrop-filter: var(--ks-glass-blur);
  -webkit-backdrop-filter: var(--ks-glass-blur);
}

.ks-forge-chat-head {
  padding: 14px 20px 10px;
  border-bottom: 1px solid var(--ks-border-soft);
  flex-shrink: 0;
}
.ks-forge-chat-kicker {
  font-size: 10px;
  letter-spacing: 0.26em;
  color: var(--ks-amber);
  text-transform: uppercase;
}
.ks-forge-chat-sub {
  font-size: 11px;
  color: var(--ks-text-dim);
  margin-top: 4px;
}

/* ─── 消息流 ─── */
.ks-forge-chat-stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scroll-behavior: smooth;
}
.ks-forge-chat-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--ks-text-dim);
  font-size: 12.5px;
  line-height: 1.8;
  border: 1px dashed var(--ks-border);
  border-radius: var(--ks-radius-lg);
  background: var(--ks-surface-glass);
}

.ks-forge-chat-msg {
  display: flex;
}
.ks-forge-chat-msg.is-user { justify-content: flex-end; }
.ks-forge-chat-msg.is-assistant { justify-content: flex-start; }
.ks-forge-chat-msg.is-system { justify-content: center; }

.ks-forge-chat-bubble {
  max-width: 86%;
  padding: 10px 14px;
  border-radius: var(--ks-radius-lg);
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
  box-shadow: var(--ks-shadow-soft);
}
.ks-forge-chat-bubble.is-user {
  background: var(--ks-amber);
  color: var(--color-text-on-bright-primary);
  border-bottom-right-radius: 6px;
}
.ks-forge-chat-bubble.is-assistant {
  background: var(--ks-panel-solid);
  color: var(--ks-text);
  border: 1px solid var(--ks-border);
  border-bottom-left-radius: 6px;
}
.ks-forge-chat-bubble.is-error {
  border-color: rgba(240, 119, 157, 0.45);
  background: rgba(240, 119, 157, 0.08);
}
.ks-forge-chat-bubble.is-typing {
  color: var(--ks-text-dim);
  font-size: 11px;
  letter-spacing: 0.1em;
}

.ks-forge-chat-text {
  white-space: pre-wrap;
}
.ks-forge-chat-errbody {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: var(--ks-radius-md);
  background: rgba(240, 119, 157, 0.12);
  color: #b1335a;
  font-size: 10.5px;
  line-height: 1.6;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
}

.ks-forge-chat-sysnote {
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--ks-text-dim);
  padding: 4px 10px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-surface-warm);
}

/* ─── 消息里的附件（灰底小卡片） ─── */
.ks-forge-chat-atts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.ks-forge-chat-att {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--ks-radius-md);
  background: rgba(255, 255, 255, 0.2);
  font-size: 10.5px;
  max-width: 220px;
}
.ks-forge-chat-bubble.is-assistant .ks-forge-chat-att {
  background: var(--ks-surface-warm);
}
.ks-forge-chat-att.is-image {
  padding: 0;
  overflow: hidden;
  width: 64px; height: 64px;
}
.ks-forge-chat-att.is-image img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.ks-forge-chat-att-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ks-forge-chat-att-size {
  color: var(--ks-text-faint);
}

/* assistant 产物图 / 视频 */
.ks-forge-chat-products {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
  margin-top: 10px;
}
.ks-forge-chat-product {
  border-radius: var(--ks-radius-md);
  overflow: hidden;
  border: 1px solid var(--ks-border-soft);
  display: flex;
  flex-direction: column;
}
.ks-forge-chat-product img,
.ks-forge-chat-product video {
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  display: block;
}
.ks-forge-chat-prodlabel {
  font-size: 10px;
  padding: 4px 6px;
  color: var(--ks-text-dim);
  background: var(--ks-surface-warm);
}

/* ─── staged 附件条（输入框上方） ─── */
.ks-forge-chat-staged {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 14px 0;
  flex-shrink: 0;
}
.ks-forge-chat-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 4px;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-surface-warm);
  border: 1px solid var(--ks-border);
  font-size: 10.5px;
  max-width: 220px;
}
.ks-forge-chat-chip.is-image { padding-left: 2px; }
.ks-forge-chat-chip img {
  width: 22px; height: 22px;
  border-radius: var(--ks-radius-sm, 6px);
  object-fit: cover;
}
.ks-forge-chat-chip-icon { font-size: 12px; }
.ks-forge-chat-chip-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ks-text-soft);
}
.ks-forge-chat-chip-rm {
  all: unset;
  cursor: pointer;
  width: 16px; height: 16px;
  border-radius: 50%;
  text-align: center;
  line-height: 16px;
  font-size: 10px;
  color: var(--ks-text-faint);
  transition: background var(--ks-dur-fast), color var(--ks-dur-fast);
}
.ks-forge-chat-chip-rm:hover {
  background: rgba(240, 119, 157, 0.18);
  color: var(--ks-rose);
}

.ks-forge-chat-error {
  padding: 8px 14px;
  background: rgba(240, 119, 157, 0.08);
  color: #b1335a;
  font-size: 11.5px;
  border-top: 1px solid rgba(240, 119, 157, 0.28);
  flex-shrink: 0;
}

/* ─── 输入条 ─── */
.ks-forge-chat-inputbar {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 14px 14px;
  border-top: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-solid);
  flex-shrink: 0;
}
.ks-forge-chat-attbtn {
  all: unset;
  cursor: pointer;
  width: 34px; height: 34px;
  border-radius: 50%;
  text-align: center;
  line-height: 34px;
  font-size: 18px;
  color: var(--ks-text-soft);
  border: 1px solid var(--ks-border);
  background: var(--ks-surface-warm);
  transition: background var(--ks-dur-fast), color var(--ks-dur-fast);
  flex-shrink: 0;
}
.ks-forge-chat-attbtn:hover {
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
}
.ks-forge-chat-input {
  flex: 1;
  resize: none;
  font-family: var(--ks-font-cn);
  font-size: 13px;
  line-height: 1.6;
  padding: 10px 12px;
  background: var(--ks-panel-elev);
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  box-shadow: var(--ks-shadow-inset-hi);
  min-height: 44px;
  max-height: 180px;
}
.ks-forge-chat-input:focus {
  outline: none;
  border-color: var(--ks-amber);
  box-shadow:
    0 0 0 3px var(--ks-amber-soft),
    var(--ks-shadow-inset-hi);
}
.ks-forge-chat-send {
  all: unset;
  cursor: pointer;
  padding: 10px 14px;
  font-family: var(--ks-font-ui);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--color-text-on-bright-primary);
  background: var(--ks-amber);
  border-radius: var(--ks-radius-pill);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--ks-amber) 32%, transparent);
  transition: background var(--ks-dur-fast), transform var(--ks-dur-fast);
  flex-shrink: 0;
}
.ks-forge-chat-send:hover:not(:disabled) {
  background: var(--ks-amber-glow);
  transform: translateY(-1px);
}
.ks-forge-chat-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  box-shadow: none;
}

/* ─── 锻造中 / 流式进度气泡 ─── */
.ks-forge-chat-pending {
  max-width: 92%;
  padding: 12px 14px 14px;
  border-radius: var(--ks-radius-lg);
  background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border);
  box-shadow: var(--ks-shadow-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ks-forge-chat-pending-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--ks-amber);
}
.ks-forge-chat-pending-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ks-amber);
  box-shadow: 0 0 0 4px var(--ks-amber-soft);
  animation: ks-fc-pulse 1.2s ease-in-out infinite;
}
@keyframes ks-fc-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.35); opacity: 0.55; }
}
.ks-forge-chat-pending-timer {
  margin-left: auto;
  font-size: 11px;
  color: var(--ks-text-dim);
  letter-spacing: 0.08em;
}
.ks-forge-chat-pending-abort {
  all: unset;
  cursor: pointer;
  padding: 3px 10px;
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--ks-rose, #b1335a);
  border: 1px solid rgba(240, 119, 157, 0.45);
  border-radius: var(--ks-radius-pill);
  background: rgba(240, 119, 157, 0.06);
  transition: background var(--ks-dur-fast), color var(--ks-dur-fast);
}
.ks-forge-chat-pending-abort:hover {
  background: rgba(240, 119, 157, 0.18);
  color: #fff;
}

/* ─── 历史归档：消息上的"工作流摘要" ─── */
.ks-forge-chat-archive {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed var(--ks-border-soft);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ks-forge-chat-archive.is-aborted {
  border-top-color: rgba(240, 119, 157, 0.4);
}
.ks-forge-chat-archive-head {
  all: unset;
  cursor: pointer;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--ks-text-dim);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  text-transform: uppercase;
  align-self: flex-start;
  transition: color var(--ks-dur-fast);
}
.ks-forge-chat-archive-head:hover {
  color: var(--ks-amber);
}
.ks-forge-chat-archive.is-aborted .ks-forge-chat-archive-head {
  color: #b1335a;
}
.ks-forge-chat-archive-toggle {
  font-family: var(--ks-font-mono);
  font-size: 11px;
}

.ks-forge-chat-stages {
  display: flex;
  flex-direction: column;
  gap: 6px;
  list-style: none;
  margin: 0;
  padding: 0;
}
.ks-forge-chat-stage {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 11.5px;
  line-height: 1.55;
  color: var(--ks-text);
}
.ks-forge-chat-stage.is-last {
  color: var(--ks-amber);
  font-weight: 600;
}
.ks-forge-chat-stage-tick {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  color: var(--ks-text-dim);
}
.ks-forge-chat-stage.is-last .ks-forge-chat-stage-tick {
  color: var(--ks-amber);
}
.ks-forge-chat-stage-label { font-weight: 600; }
.ks-forge-chat-stage-detail {
  color: var(--ks-text-dim);
  margin-left: 6px;
  font-weight: 400;
}

.ks-forge-chat-sniff {
  margin-top: 2px;
  padding: 10px 12px;
  border-radius: var(--ks-radius-md);
  background: var(--ks-surface-warm);
  border: 1px solid var(--ks-border-soft);
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--ks-text);
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.ks-forge-chat-sniff-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ks-text);
  letter-spacing: 0.02em;
}
.ks-forge-chat-sniff-row {
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.ks-forge-chat-sniff-key {
  color: var(--ks-text-dim);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  flex-shrink: 0;
  width: 54px;
}
.ks-forge-chat-sniff-val {
  color: var(--ks-text);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ks-forge-chat-sniff-val.is-multi {
  white-space: normal;
}
.ks-forge-chat-sniff-chip {
  display: inline-block;
  padding: 1px 8px;
  margin: 0 4px 2px 0;
  border-radius: var(--ks-radius-pill);
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
  font-size: 10.5px;
  line-height: 1.5;
}

.ks-forge-chat-tail {
  margin-top: 2px;
  padding: 8px 10px;
  border-radius: var(--ks-radius-md);
  background: var(--ks-surface-glass);
  border: 1px dashed var(--ks-border-soft);
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--ks-text-dim);
  max-height: 80px;
  overflow: hidden;
  position: relative;
  white-space: pre-wrap;
  word-break: break-all;
}
.ks-forge-chat-tail::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 14px;
  background: linear-gradient(to bottom, var(--ks-surface-glass), transparent);
  pointer-events: none;
}
.ks-forge-chat-tail-head {
  font-family: var(--ks-font-ui);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--ks-text-dim);
  text-transform: uppercase;
  margin-bottom: 4px;
}
.ks-forge-chat-tail-caret {
  display: inline-block;
  width: 0.5em;
  height: 1em;
  margin-left: 1px;
  background: var(--ks-amber);
  vertical-align: text-bottom;
  animation: ks-fc-blink 1s steps(2) infinite;
}
@keyframes ks-fc-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* 双 CTA — outline 之后的两个里程碑按钮 */
.ks-forge-chat-dualcta {
  display: flex;
  gap: 8px;
  padding: 8px 16px 0;
  flex-wrap: wrap;
  flex-shrink: 0;
  justify-content: flex-end;
}
.ks-forge-chat-cta {
  font-size: 12.5px;
  padding: 6px 14px;
  border-radius: var(--ks-radius-pill);
  border: 1px solid var(--ks-amber);
  background: transparent;
  color: var(--ks-amber);
  cursor: pointer;
  font-family: var(--ks-font-ui);
  letter-spacing: 0.04em;
}
.ks-forge-chat-cta.is-primary {
  background: var(--ks-amber);
  color: var(--ks-panel);
  font-weight: 600;
}
.ks-forge-chat-cta:hover:not(:disabled) {
  filter: brightness(1.05);
}
.ks-forge-chat-cta:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* v5 · slash 命令快捷栏 ----------------------------------- */
.ks-forge-chat-slash-hints {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 4px 10px 0;
  flex-shrink: 0;
}
.ks-forge-chat-slash-chip {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  padding: 3px 9px;
  border-radius: var(--ks-radius-pill);
  border: 1px solid var(--ks-border-soft);
  background: var(--ks-panel-solid);
  font-size: 10.5px;
  color: var(--ks-text-soft);
  transition: background var(--ks-dur-fast), border-color var(--ks-dur-fast);
}
.ks-forge-chat-slash-chip:hover {
  background: rgba(255, 123, 61, 0.06);
  border-color: rgba(255, 123, 61, 0.4);
  color: var(--ks-text);
}
.ks-forge-chat-slash-chip[data-group="distill"] {
  border-color: rgba(108, 143, 184, 0.25);
}
.ks-forge-chat-slash-chip[data-group="distill"]:hover {
  background: rgba(108, 143, 184, 0.08);
  border-color: var(--ks-cyan);
}
.ks-forge-chat-slash-cmd {
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--ks-amber);
  font-weight: 600;
}
.ks-forge-chat-slash-chip[data-group="distill"] .ks-forge-chat-slash-cmd {
  color: var(--ks-cyan);
}
.ks-forge-chat-slash-label {
  font-family: var(--ks-font-cn);
  font-size: 11px;
}
`
