import { useEffect } from 'react';
import { X, ZoomIn } from 'lucide-react';
import type { ItemRecord } from '@shared/types';
import { localizedItemName, t, useT } from '@/i18n';

export interface PreviewItem {
  item: ItemRecord;
  src: string;
}

interface IconPreviewOverlayProps {
  preview: PreviewItem | null;
  onClose: () => void;
}

export function IconPreviewOverlay({ preview, onClose }: IconPreviewOverlayProps) {
  useT();

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, onClose]);

  if (!preview) return null;

  const displayName = localizedItemName(preview.item);

  return (
    <div className="wb-icon-overlay" role="dialog" aria-modal="true" aria-label={t('preview.title')}>
      <button type="button" className="wb-icon-overlay-backdrop" onClick={onClose} aria-label={t('preview.close')} />
      <div className="wb-icon-overlay-card">
        <header className="wb-icon-overlay-head">
          <div>
            <h2>{displayName}</h2>
            <p className="muted">{preview.item.slug}</p>
          </div>
          <button type="button" className="wb-icon-overlay-close" onClick={onClose} aria-label={t('preview.close')}>
            <X size={18} />
          </button>
        </header>
        <div className="wb-icon-overlay-stage">
          <img src={preview.src} alt={displayName} />
        </div>
        <p className="wb-icon-overlay-hint">
          <ZoomIn size={14} aria-hidden />
          {t('preview.hint')}
        </p>
      </div>
    </div>
  );
}
