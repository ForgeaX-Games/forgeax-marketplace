import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { AssetRole, ItemRecord, StylePreset } from '@shared/types';
import { resolvePickerStyles } from '@shared/catalog';
import { localizedItemName, localizedStyleLabel, rarityLabel, roleLabel, t, tf, useT } from '@/i18n';

const ROLES: AssetRole[] = [
  'consumable', 'equipment', 'weapon', 'material', 'currency', 'quest', 'key-item', 'ui-glyph',
];

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

interface ItemEditorProps {
  item: ItemRecord;
  styles: StylePreset[];
  targetSize: number;
  hasReferences: boolean;
  busy: boolean;
  onSave: (item: ItemRecord) => void;
  onDelete: (item: ItemRecord) => void;
  onClose: () => void;
  onOpenInUi: (item: ItemRecord) => void;
  onOptimizePrompt: (depicts: string, style: string, hint?: string) => Promise<string | null>;
  onRegenerate: (item: ItemRecord, style: string, customPrompt: string) => Promise<void>;
}

export function ItemEditor({
  item,
  styles,
  targetSize,
  hasReferences,
  busy,
  onSave,
  onDelete,
  onClose,
  onOpenInUi,
  onOptimizePrompt,
  onRegenerate,
}: ItemEditorProps) {
  useT();
  const [draft, setDraft] = useState<ItemRecord>(item);
  const [editorStyle, setEditorStyle] = useState(item.iconStyle ?? 'pixel-48');
  const [customPrompt, setCustomPrompt] = useState(item.customPrompt ?? '');
  const [optimizing, setOptimizing] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    setDraft(item);
    setEditorStyle(item.iconStyle ?? 'pixel-48');
    setCustomPrompt(item.customPrompt ?? '');
  }, [item]);

  const styleOptions = resolvePickerStyles(styles);

  const patch = (partial: Partial<ItemRecord>) => setDraft((prev) => ({ ...prev, ...partial }));

  const handleOptimize = async () => {
    const depicts = draft.depicts?.trim() || draft.name.zh || draft.name.en;
    if (!depicts) return;
    setOptimizing(true);
    const prompt = await onOptimizePrompt(depicts, editorStyle, customPrompt || undefined);
    setOptimizing(false);
    if (prompt) {
      setCustomPrompt(prompt);
      patch({ customPrompt: prompt });
    }
  };

  const handleRegenerate = async () => {
    const next: ItemRecord = {
      ...draft,
      iconStyle: editorStyle as ItemRecord['iconStyle'],
      customPrompt: customPrompt.trim() || undefined,
    };
    setRegenerating(true);
    await onRegenerate(next, editorStyle, customPrompt.trim());
    setRegenerating(false);
  };

  const actionBusy = busy || optimizing || regenerating;

  return (
    <aside className="wb-item-editor">
      <header className="wb-item-editor-head">
        <h2>{t('editor.title')}</h2>
        <button type="button" className="wb-icon-overlay-close" onClick={onClose} aria-label={t('preview.close')}>
          ×
        </button>
      </header>

      <div className="wb-item-editor-body">
        <label className="field">
          <span className="field-label">{t('editor.nameZh')}</span>
          <input
            className="fx-input"
            value={draft.name.zh}
            onChange={(e) => patch({ name: { ...draft.name, zh: e.target.value } })}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('editor.nameEn')}</span>
          <input
            className="fx-input"
            value={draft.name.en}
            onChange={(e) => patch({ name: { ...draft.name, en: e.target.value } })}
          />
        </label>
        <label className="field">
          <span className="field-label">{t('editor.depicts')}</span>
          <input
            className="fx-input"
            value={draft.depicts ?? ''}
            onChange={(e) => patch({ depicts: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label">{t('editor.styleLabel')}</span>
          <div className="fx-segmented fx-segmented--wrap">
            {styleOptions.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`fx-segmented-btn${editorStyle === s.id ? ' is-selected' : ''}`}
                disabled={actionBusy}
                onClick={() => setEditorStyle(s.id)}
              >
                {localizedStyleLabel(s)}
              </button>
            ))}
          </div>
        </label>

        <label className="field">
          <span className="field-label">
            <span>{t('editor.promptLabel')}</span>
            <button
              type="button"
              className="wb-prompt-opt-btn"
              disabled={actionBusy}
              onClick={() => void handleOptimize()}
            >
              <Sparkles size={12} aria-hidden />
              {optimizing ? t('editor.optimizing') : t('editor.optimizePrompt')}
            </button>
          </span>
          <textarea
            className="fx-textarea"
            rows={4}
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={t('editor.promptPlaceholder')}
          />
          <p className="step-note">{t('editor.promptHint')}</p>
        </label>

        {hasReferences && (
          <p className="step-note step-note--ok">{t('editor.refActive')}</p>
        )}

        <label className="field">
          <span className="field-label">{t('editor.role')}</span>
          <select
            className="fx-input"
            value={draft.asset_role}
            onChange={(e) => patch({ asset_role: e.target.value as AssetRole })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{roleLabel(r)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('editor.rarity')}</span>
          <select
            className="fx-input"
            value={draft.rarity}
            onChange={(e) => patch({ rarity: e.target.value as ItemRecord['rarity'] })}
          >
            {RARITIES.map((r) => (
              <option key={r} value={r}>{rarityLabel(r)}</option>
            ))}
          </select>
        </label>
        <label className="field field--row">
          <input
            type="checkbox"
            checked={draft.stackable}
            onChange={(e) => patch({ stackable: e.target.checked })}
          />
          <span>{t('editor.stackable')}</span>
        </label>
        {draft.stackable && (
          <label className="field">
            <span className="field-label">{t('editor.maxStack')}</span>
            <input
              className="fx-input"
              type="number"
              min={1}
              max={9999}
              value={draft.maxStack ?? 99}
              onChange={(e) => patch({ maxStack: Number(e.target.value) || 99 })}
            />
          </label>
        )}
        <p className="step-note">{t('editor.slugNote')} <code>{draft.slug}</code></p>

        <button
          type="button"
          className="fx-btn fx-btn--primary wb-regen-btn"
          disabled={actionBusy}
          onClick={() => void handleRegenerate()}
        >
          {regenerating ? t('editor.regenerating') : tf('editor.regenerate', { size: targetSize })}
        </button>
      </div>

      <div className="gx-action-row wb-item-editor-actions">
        <button type="button" className="fx-btn fx-btn--danger" disabled={actionBusy} onClick={() => {
          if (!window.confirm(tf('editor.deleteConfirm', { name: localizedItemName(draft) }))) return;
          onDelete(draft);
        }}>
          {t('editor.delete')}
        </button>
        <button type="button" className="fx-btn" disabled={actionBusy} onClick={() => onOpenInUi(draft)}>
          {t('editor.openInUi')}
        </button>
        <button
          type="button"
          className="fx-btn fx-btn--primary"
          disabled={actionBusy}
          onClick={() => onSave({
            ...draft,
            iconStyle: editorStyle as ItemRecord['iconStyle'],
            customPrompt: customPrompt.trim() || undefined,
          })}
        >
          {busy ? t('editor.saving') : t('editor.save')}
        </button>
      </div>
    </aside>
  );
}
