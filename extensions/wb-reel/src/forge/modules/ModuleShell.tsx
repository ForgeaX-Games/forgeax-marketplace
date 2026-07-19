import { injectStyleOnce } from '../../styles/injectStyle'

/**
 * ModuleShell —— 「模块」中枢里各模块面板的统一外壳。
 *
 * 提供一致的标题 / 副标题 / 启用开关 / 关闭态遮罩，让数值、背包等新模块与
 * 既有的美术/导演面板在视觉上对齐。模块关闭时内容区降透明并禁交互(但作者
 * 仍能在此开启)。
 */
export function ModuleShell({
  title,
  subtitle,
  enabled,
  onToggle,
  toolbar,
  children,
}: {
  title: string
  subtitle?: string
  enabled: boolean
  onToggle: (next: boolean) => void
  toolbar?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="ks-mod-shell">
      <header className="ks-mod-head">
        <div className="ks-mod-head-text">
          <div className="ks-mod-title ks-mono">{title}</div>
          {subtitle ? <div className="ks-mod-sub ks-cn">{subtitle}</div> : null}
        </div>
        <div className="ks-mod-head-actions">
          {toolbar}
          <button
            type="button"
            className={`ks-mod-switch${enabled ? ' is-on' : ''}`}
            role="switch"
            aria-checked={enabled}
            onClick={() => onToggle(!enabled)}
            title={enabled ? '已开启 · 点击关闭(制作/运行时跳过)' : '已关闭 · 点击开启'}
          >
            <span className="ks-mod-switch-track" aria-hidden>
              <span className="ks-mod-switch-knob" />
            </span>
            <span className="ks-mod-switch-label">{enabled ? '已开启' : '已关闭'}</span>
          </button>
        </div>
      </header>
      <div className={`ks-mod-body${enabled ? '' : ' is-disabled'}`}>
        {children}
        {!enabled ? (
          <div className="ks-mod-veil">
            <div className="ks-mod-veil-text">
              该模块已关闭 —— 制作与试玩时会跳过。
              <button type="button" className="ks-mod-veil-btn" onClick={() => onToggle(true)}>
                开启模块
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const css = `
.ks-mod-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.ks-mod-head {
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--color-border-default);
}
.ks-mod-head-text { flex: 1; min-width: 0; }
.ks-mod-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: 0.2px;
}
.ks-mod-sub {
  margin-top: 3px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  line-height: 1.5;
}
.ks-mod-head-actions {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.ks-mod-switch {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 10px 4px 6px;
  border-radius: 999px;
  border: 1px solid var(--color-border-default);
  background: var(--color-background-base);
  color: var(--color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: color .12s, border-color .12s, background .12s;
}
.ks-mod-switch.is-on {
  color: var(--color-brand-primary);
  border-color: color-mix(in srgb, var(--color-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 10%, var(--color-background-base));
}
.ks-mod-switch-track {
  position: relative;
  display: block;
  width: 26px;
  height: 15px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-text-tertiary) 28%, transparent);
  transition: background .12s;
}
.ks-mod-switch-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--color-text-secondary);
  transition: transform .12s, background .12s;
}
.ks-mod-switch.is-on .ks-mod-switch-track {
  background: color-mix(in srgb, var(--color-brand-primary) 70%, transparent);
}
.ks-mod-switch.is-on .ks-mod-switch-knob {
  transform: translateX(11px);
  background: #0c0f08;
}
.ks-mod-body {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  /* 作为内层模块面板（数值图 / 背包三栏）的容器查询上下文：面板按这块实际
     可用宽度自适应，而不是按浏览器视口——嵌在 studio center iframe / 分屏里
     时视口宽度并不代表面板宽度。 */
  container-type: inline-size;
  container-name: ksmod;
}
.ks-mod-body.is-disabled > *:not(.ks-mod-veil) {
  opacity: 0.4;
  pointer-events: none;
  filter: grayscale(0.4);
}
.ks-mod-veil {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-background-base) 35%, transparent);
}
.ks-mod-veil-text {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--radius-md, 10px);
  border: 1px solid var(--color-border-default);
  background: var(--color-background-elevated);
  color: var(--color-text-secondary);
  font-size: 12.5px;
}
.ks-mod-veil-btn {
  padding: 5px 12px;
  border-radius: var(--radius-pill, 999px);
  border: 1px solid color-mix(in srgb, var(--color-brand-primary) 45%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 14%, transparent);
  color: var(--color-brand-primary);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
}
.ks-mod-veil-btn:hover {
  background: color-mix(in srgb, var(--color-brand-primary) 22%, transparent);
}
`
injectStyleOnce('ks-module-shell', css)
