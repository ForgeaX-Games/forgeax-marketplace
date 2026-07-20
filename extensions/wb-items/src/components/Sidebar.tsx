import type { StylePreset } from '@shared/types';
import { localizedStyleLabel, t, useT } from '@/i18n';

export interface SidebarProps {
  styles: StylePreset[];
  selectedStyle: string;
  onStyleChange: (id: string) => void;
  requirements: string;
  onRequirementsChange: (v: string) => void;
  targetSize: number;
  onTargetSizeChange: (v: number) => void;
  busy: boolean;
  message: string | null;
  error: string | null;
  onConfirm: () => void;
}

export function Sidebar({
  styles,
  selectedStyle,
  onStyleChange,
  requirements,
  onRequirementsChange,
  targetSize,
  onTargetSizeChange,
  busy,
  message,
  error,
  onConfirm,
}: SidebarProps) {
  useT();
  const visualStyles = styles.filter(
    (s) => s.delivery === 'png-pixel' || s.delivery === 'png-transparent',
  );
  const styleOptions = visualStyles.length > 0 ? visualStyles : styles;

  return (
    <div className="gx-left">
      <header className="workbench-pane-header">
        <span className="workbench-pane-title">{t('form.title')}</span>
      </header>

      <div className="workbench-pane-scroll">
        <div className="gx-setup wb-items-form">
          <label className="field">
            <span className="field-label">
              <span>{t('form.requirementsLabel')}</span>
              <span className="field-count">{requirements.length}/800</span>
            </span>
            <textarea
              className="fx-textarea fx-textarea--lg"
              maxLength={800}
              value={requirements}
              onChange={(e) => onRequirementsChange(e.target.value)}
              placeholder={t('form.requirementsPlaceholder')}
            />
          </label>

          <label className="field">
            <span className="field-label">{t('form.styleLabel')}</span>
            <div className="fx-segmented fx-segmented--wrap">
              {styleOptions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`fx-segmented-btn${selectedStyle === s.id ? ' is-selected' : ''}`}
                  onClick={() => onStyleChange(s.id)}
                >
                  {localizedStyleLabel(s)}
                </button>
              ))}
            </div>
          </label>

          <label className="field">
            <span className="field-label">{t('form.sizeLabel')}</span>
            <div className="size-presets">
              {[16, 32, 48, 64].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`fx-segmented-btn${targetSize === n ? ' is-selected' : ''}`}
                  onClick={() => onTargetSizeChange(n)}
                >
                  {n}×{n}
                </button>
              ))}
            </div>
          </label>

          {message && <div className="status-banner ok">{message}</div>}
          {error && <div className="status-banner err">{error}</div>}
        </div>
      </div>

      <div className="gx-action-row">
        <button
          type="button"
          className="fx-btn fx-btn--primary"
          disabled={busy || !requirements.trim()}
          onClick={onConfirm}
        >
          {busy ? t('form.confirmBusy') : t('form.confirm')}
        </button>
      </div>
    </div>
  );
}
