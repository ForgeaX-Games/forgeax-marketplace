/**
 * HelpPanel —— 时间轴快捷键 / 功能速查面板。
 *
 * 工具栏「?」按钮（onboardingStore.setHelpOpen(true)）随时打开；列快捷键 + 各轨/各
 * 功能速查 + 一个「重看新手引导」入口（重开分步 tour）。
 */

import { injectStyleOnce } from '../../styles/injectStyle'
import { useOnboardingStore } from './onboardingStore'
import { useT } from '../../i18n'

const SHORTCUT_KEYS = [
  { keysKey: 'help.keys.undo', descKey: 'help.shortcut.undo' },
  { keysKey: 'help.keys.redo', descKey: 'help.shortcut.redo' },
  { keysKey: 'help.keys.delete', descKey: 'help.shortcut.delete' },
  { keysKey: 'help.keys.clipboard', descKey: 'help.shortcut.clipboard' },
  { keysKey: 'help.keys.shiftClick', descKey: 'help.shortcut.multiselect' },
  { keysKey: 'help.keys.markerKey', descKey: 'help.shortcut.marker' },
  { keysKey: 'help.keys.esc', descKey: 'help.shortcut.esc' },
  { keysKey: 'help.keys.trim', descKey: 'help.shortcut.trim' },
  { keysKey: 'help.keys.zoom', descKey: 'help.shortcut.zoom' },
] as const

const FEATURE_KEYS = [
  { keysKey: 'help.keys.trackEye', descKey: 'help.feature.trackEye' },
  { keysKey: 'help.keys.trackLock', descKey: 'help.feature.trackLock' },
  { keysKey: 'help.keys.trackMenu', descKey: 'help.feature.trackMenu' },
  { keysKey: 'help.keys.fxPanel', descKey: 'help.feature.fxPanel' },
  { keysKey: 'help.keys.speed', descKey: 'help.feature.speed' },
  { keysKey: 'help.keys.moreMenu', descKey: 'help.feature.moreMenu' },
  { keysKey: 'help.keys.marker', descKey: 'help.feature.marker' },
  { keysKey: 'help.keys.audioFade', descKey: 'help.feature.audioFade' },
] as const

export function HelpPanel() {
  injectStyleOnce('ks-help-panel', css)
  const t = useT()
  const helpOpen = useOnboardingStore((s) => s.helpOpen)
  const setHelpOpen = useOnboardingStore((s) => s.setHelpOpen)
  const openTour = useOnboardingStore((s) => s.openTour)
  if (!helpOpen) return null
  const close = (): void => setHelpOpen(false)
  return (
    <div className="ks-help-scrim" onClick={close} role="presentation">
      <aside className="ks-help-panel" role="dialog" aria-label={t('help.ariaLabel')} onClick={(e) => e.stopPropagation()}>
        <header className="ks-help-head">
          <span className="ks-help-title">{t('help.title')}</span>
          <button type="button" className="ks-help-close" onClick={close} aria-label={t('drawer.close')} title={t('help.closeTitle')}>
            ✕
          </button>
        </header>
        <div className="ks-help-body">
          <section className="ks-help-sec">
            <h4 className="ks-help-sec-title">{t('help.shortcuts')}</h4>
            <table className="ks-help-table">
              <tbody>
                {SHORTCUT_KEYS.map((r) => (
                  <tr key={r.keysKey}>
                    <td className="ks-help-keys ks-mono">{t(r.keysKey)}</td>
                    <td className="ks-help-desc">{t(r.descKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="ks-help-sec">
            <h4 className="ks-help-sec-title">{t('help.features')}</h4>
            <table className="ks-help-table">
              <tbody>
                {FEATURE_KEYS.map((r) => (
                  <tr key={r.keysKey}>
                    <td className="ks-help-keys">{t(r.keysKey)}</td>
                    <td className="ks-help-desc">{t(r.descKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <footer className="ks-help-foot">
          <button
            type="button"
            className="ks-help-replay"
            onClick={() => {
              setHelpOpen(false)
              openTour()
            }}
          >
            {t('help.replayTour')}
          </button>
        </footer>
      </aside>
    </div>
  )
}

const css = `
.ks-help-scrim {
  position: absolute; inset: 0; z-index: 61;
  display: flex; align-items: stretch; justify-content: flex-end;
  background: rgba(0,0,0,0.4);
}
.ks-help-panel {
  width: min(420px, 92%);
  height: 100%;
  display: flex; flex-direction: column;
  background: var(--ks-panel-elev);
  border-left: 1px solid var(--ks-border);
  box-shadow: -12px 0 40px rgba(0,0,0,0.45);
  color: var(--ks-text);
}
.ks-help-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px; border-bottom: 1px solid var(--ks-border-soft);
}
.ks-help-title { font-size: 14px; font-weight: 700; }
.ks-help-close {
  all: unset; cursor: pointer; width: 24px; height: 24px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--ks-radius-sm); color: var(--ks-text-dim);
}
.ks-help-close:hover { color: var(--ks-text); background: var(--ks-panel-solid); }
.ks-help-body { flex: 1 1 auto; overflow-y: auto; padding: 12px 16px; }
.ks-help-sec { margin-bottom: 18px; }
.ks-help-sec-title {
  margin: 0 0 8px; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ks-text-faint);
}
.ks-help-table { width: 100%; border-collapse: collapse; }
.ks-help-table td { padding: 5px 0; vertical-align: top; font-size: 12px; line-height: 1.5; }
.ks-help-keys {
  width: 44%; padding-right: 10px !important; color: var(--ks-amber);
  white-space: nowrap; word-break: keep-all;
}
.ks-help-desc { color: var(--ks-text-soft); }
.ks-help-foot { padding: 12px 16px; border-top: 1px solid var(--ks-border-soft); }
.ks-help-replay {
  all: unset; cursor: pointer; display: block; width: 100%; text-align: center;
  padding: 8px 0; border-radius: var(--ks-radius-sm); font-size: 12px;
  color: var(--ks-text-soft); border: 1px solid var(--ks-border-soft); background: var(--ks-panel-solid);
}
.ks-help-replay:hover { color: var(--ks-text); border-color: var(--ks-border-strong); }
`
