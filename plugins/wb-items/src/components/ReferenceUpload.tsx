import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import type { ListItemsResult } from '@shared/types';
import { compressImageFile } from '@/lib/imageCompress';
import { t, useT } from '@/i18n';

export type ReferenceEntry = ListItemsResult['references'][number];

interface ReferenceUploadProps {
  references: ReferenceEntry[];
  busy: boolean;
  onUpload: (base64: string, label?: string) => Promise<void>;
  onDelete: (refId: string) => Promise<void>;
}

const MAX_REFS = 5;

export function ReferenceUpload({ references, busy, onUpload, onDelete }: ReferenceUploadProps) {
  useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const remaining = MAX_REFS - references.length;
    if (remaining <= 0) return;

    setUploading(true);
    try {
      for (const file of list.slice(0, remaining)) {
        const base64 = await compressImageFile(file);
        await onUpload(base64, file.name.replace(/\.[^.]+$/, ''));
      }
    } finally {
      setUploading(false);
    }
  };

  const disabled = busy || uploading || references.length >= MAX_REFS;

  return (
    <div className="field wb-ref-upload">
      <span className="field-label">
        <span>{t('form.refLabel')}</span>
        <span className="field-count">{references.length}/{MAX_REFS}</span>
      </span>
      <p className="step-note">{t('form.refHint')}</p>

      {references.length > 0 && (
        <div className="wb-ref-grid">
          {references.map((ref) => (
            <div key={ref.id} className="wb-ref-thumb">
              <img src={ref.previewUrl} alt="" />
              <button
                type="button"
                className="wb-ref-remove"
                disabled={busy || uploading}
                onClick={() => void onDelete(ref.id)}
                aria-label={t('form.refRemove')}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className={`wb-ref-drop${dragOver ? ' is-drag' : ''}${disabled ? ' is-disabled' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled) void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => { if (!disabled) inputRef.current?.click(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
        role="button"
        tabIndex={disabled ? -1 : 0}
      >
        <ImagePlus size={18} aria-hidden />
        <span>{uploading ? t('form.refUploading') : t('form.refDrop')}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        disabled={disabled}
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
