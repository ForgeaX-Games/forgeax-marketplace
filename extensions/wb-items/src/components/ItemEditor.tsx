import { useEffect, useState } from 'react';
import type { AssetRole, ItemRecord } from '@shared/types';
import { localizedItemName, rarityLabel, roleLabel, t, tf, useT } from '@/i18n';

const ROLES: AssetRole[] = [
  'consumable', 'equipment', 'weapon', 'material', 'currency', 'quest', 'key-item', 'ui-glyph',
];

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;

interface ItemEditorProps {
  item: ItemRecord;
  busy: boolean;
  onSave: (item: ItemRecord) => void;
  onDelete: (item: ItemRecord) => void;
  onClose: () => void;
  onOpenInUi: (item: ItemRecord) => void;
}

export function ItemEditor({ item, busy, onSave, onDelete, onClose, onOpenInUi }: ItemEditorProps) {
  useT();
  const [draft, setDraft] = useState<ItemRecord>(item);

  useEffect(() => {
    setDraft(item);
  }, [item]);

  const patch = (partial: Partial<ItemRecord>) => setDraft((prev) => ({ ...prev, ...partial }));

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
      </div>

      <div className="gx-action-row wb-item-editor-actions">
        <button type="button" className="fx-btn fx-btn--danger" disabled={busy} onClick={() => {
          if (!window.confirm(tf('editor.deleteConfirm', { name: localizedItemName(draft) }))) return;
          onDelete(draft);
        }}>
          {t('editor.delete')}
        </button>
        <button type="button" className="fx-btn" disabled={busy} onClick={() => onOpenInUi(draft)}>
          {t('editor.openInUi')}
        </button>
        <button type="button" className="fx-btn fx-btn--primary" disabled={busy} onClick={() => onSave(draft)}>
          {busy ? t('editor.saving') : t('editor.save')}
        </button>
      </div>
    </aside>
  );
}
