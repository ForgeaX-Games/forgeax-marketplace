import { useState } from 'react';
import type { ItemRecord, ListItemsResult } from '@shared/types';
import { localizedItemName, roleLabel, t, useT } from '@/i18n';
import { IconPreviewOverlay, type PreviewItem } from '@/components/IconPreviewOverlay';
import { ItemEditor } from '@/components/ItemEditor';

interface ItemGridProps {
  items: ItemRecord[];
  icons: ListItemsResult['icons'];
  filterActive?: boolean;
  editorBusy?: boolean;
  onSaveItem: (item: ItemRecord) => void | Promise<void>;
  onDeleteItem: (item: ItemRecord) => void | Promise<void>;
  onOpenInUi: (item: ItemRecord) => void;
}

export function ItemGrid({
  items,
  icons,
  filterActive = false,
  editorBusy = false,
  onSaveItem,
  onDeleteItem,
  onOpenInUi,
}: ItemGridProps) {
  useT();
  const previewBySlug = new Map(icons.map((i) => [i.slug, i.previewUrl]));
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [editing, setEditing] = useState<ItemRecord | null>(null);

  if (!items.length) {
    return (
      <div className="wb-items-empty-grid">
        {filterActive ? t('library.noMatch') : t('empty.noItems')}
      </div>
    );
  }

  return (
    <>
      <div className="wb-items-grid">
        {items.map((item) => {
          const src = previewBySlug.get(item.slug) ?? item.icon;
          const displayName = localizedItemName(item);
          return (
            <article key={item.slug} className="wb-item-card">
              <button
                type="button"
                className="wb-item-thumb"
                onClick={() => setPreview({ item, src })}
                title={t('preview.open')}
                aria-label={`${t('preview.open')}${t('preview.ariaSep')}${displayName}`}
              >
                <img src={src} alt="" loading="lazy" />
              </button>
              <div className="wb-item-name">{displayName}</div>
              <div className="wb-item-meta">{roleLabel(item.asset_role)}</div>
              <button
                type="button"
                className="wb-item-edit-btn"
                onClick={() => setEditing(item)}
              >
                {t('editor.edit')}
              </button>
            </article>
          );
        })}
      </div>
      <IconPreviewOverlay preview={preview} onClose={() => setPreview(null)} />
      {editing && (
        <ItemEditor
          item={editing}
          busy={editorBusy}
          onSave={async (item) => {
            await onSaveItem(item);
            setEditing(null);
          }}
          onDelete={async (item) => {
            await onDeleteItem(item);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
          onOpenInUi={onOpenInUi}
        />
      )}
    </>
  );
}
