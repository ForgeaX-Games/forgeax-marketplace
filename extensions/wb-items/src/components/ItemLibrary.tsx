import { Search } from 'lucide-react';
import type { ItemRecord, ListItemsResult } from '@shared/types';
import { t, tf, useT } from '@/i18n';
import { ItemGrid } from '@/components/ItemGrid';

interface ItemLibraryProps {
  items: ItemRecord[];
  icons: ListItemsResult['icons'];
  filter: string;
  onFilterChange: (v: string) => void;
  targetSize: number;
  styleLabel: string;
  totalCount: number;
  editorBusy?: boolean;
  onSaveItem: (item: ItemRecord) => void | Promise<void>;
  onDeleteItem: (item: ItemRecord) => void | Promise<void>;
  onOpenInUi: (item: ItemRecord) => void;
}

export function ItemLibrary({
  items,
  icons,
  filter,
  onFilterChange,
  targetSize,
  styleLabel,
  totalCount,
  editorBusy,
  onSaveItem,
  onDeleteItem,
  onOpenInUi,
}: ItemLibraryProps) {
  useT();

  return (
    <main className="gx-center wb-items-main">
      <header className="wb-items-header">
        <div className="wb-items-header-main">
          <h1 className="workbench-pane-title">{t('library.title')}</h1>
          <p className="muted">
            {tf('library.subtitle', { count: totalCount, size: targetSize, style: styleLabel })}
          </p>
        </div>
        <label className="wb-items-library-search">
          <Search size={14} aria-hidden />
          <input
            className="fx-input"
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            placeholder={t('library.searchPlaceholder')}
          />
        </label>
      </header>
      <ItemGrid
        items={items}
        icons={icons}
        filterActive={filter.trim().length > 0}
        editorBusy={editorBusy}
        onSaveItem={onSaveItem}
        onDeleteItem={onDeleteItem}
        onOpenInUi={onOpenInUi}
      />
    </main>
  );
}
