import type { ListItemsResult, StylePreset } from '@shared/types';
import { localizedStyleLabel, t, tf, useT } from '@/i18n';
import { ReferenceUpload } from '@/components/ReferenceUpload';
import { resolvePickerStyles } from '@shared/catalog';

export interface SidebarProps {
  styles: StylePreset[];
  selectedStyle: string;
  onStyleChange: (id: string) => void;
  requirements: string;
  onRequirementsChange: (v: string) => void;
  targetSize: number;
  onTargetSizeChange: (v: number) => void;
  references: ListItemsResult['references'];
  refBusy: boolean;
  onUploadReference: (base64: string, label?: string) => Promise<void>;
  onDeleteReference: (refId: string) => Promise<void>;
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
  references,
  refBusy,
  onUploadReference,
  onDeleteReference,
  busy,
  message,
  error,
  onConfirm,
}: SidebarProps) {
  useT();
  const styleOptions = resolvePickerStyles(styles);

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

          <ReferenceUpload
            references={references}
            busy={refBusy || busy}
            onUpload={onUploadReference}
            onDelete={onDeleteReference}
          />

          <label className="field">
            <span className="field-label">{t('form.styleLabel')}</span>
            <p className="step-note">{t('form.stylePixelGroup')}</p>
            <div className="fx-segmented fx-segmented--wrap">
              {styleOptions.filter((s) => s.delivery === 'png-pixel').map((s) => (
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
            <p className="step-note">{tf('form.stylePaintedGroup', { count: styleOptions.filter((s) => s.delivery === 'png-transparent').length })}</p>
            <div className="fx-segmented fx-segmented--wrap wb-style-grid wb-style-grid--painted">
              {styleOptions.filter((s) => s.delivery === 'png-transparent').map((s) => (
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
