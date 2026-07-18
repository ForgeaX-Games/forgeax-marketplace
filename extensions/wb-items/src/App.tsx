import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ItemRecord, ItemsDocument, ListItemsResult, RunPipelineResult, StylePreset } from '@shared/types';
import { DEFAULT_ICON_SIZE } from '@shared/catalog';
import { callTool } from '@/lib/toolClient';
import { activeSlug, hasActiveGame } from '@/lib/gameSlug';
import { navigateToUiWorkshop } from '@/lib/items-handoff';
import { broadcastItemsRefresh, installItemsRefreshListener } from '@/lib/paneSync';
import { Sidebar } from '@/components/Sidebar';
import { ItemLibrary } from '@/components/ItemLibrary';
import { localizedStyleLabel, t, tf, useT } from '@/i18n';

interface AppProps {
  pane: 'left' | 'center' | 'standalone';
}

function resultMessage(r: RunPipelineResult): string {
  const total = r.summarize.items.length;
  const saved = r.normalize?.normalized.length ?? 0;
  const failed = r.normalize?.failed.length ?? 0;

  if (saved > 0 && failed > 0) return tf('messages.partial', { saved, total });
  if (saved > 0) return tf('messages.done', { count: saved });
  if (failed > 0) return tf('messages.failed', { count: failed });
  return t('messages.noOutput');
}

export function App({ pane }: AppProps) {
  useT();
  const gameActive = hasActiveGame();
  const [document, setDocument] = useState<ItemsDocument | null>(null);
  const [icons, setIcons] = useState<ListItemsResult['icons']>([]);
  const [styles, setStyles] = useState<StylePreset[]>([]);
  const [selectedStyle, setSelectedStyle] = useState('pixel-48');
  const [requirements, setRequirements] = useState('');
  const [targetSize, setTargetSize] = useState(DEFAULT_ICON_SIZE);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [editorBusy, setEditorBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!gameActive) return;
    const r = await callTool<ListItemsResult>('items:list', {});
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDocument(r.result.document);
    setIcons(r.result.icons);
    setError(null);
  }, [gameActive]);

  useEffect(() => {
    void refresh();
    void callTool<{ ok: true; styles: StylePreset[] }>('items:list-styles', {}).then((r) => {
      if (r.ok) setStyles(r.result.styles);
    });
    return installItemsRefreshListener(() => {
      void refresh();
    });
  }, [refresh]);

  const filteredItems = useMemo(() => {
    const items = document?.items ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.slug.includes(q)
        || item.name.zh.toLowerCase().includes(q)
        || item.name.en.toLowerCase().includes(q),
    );
  }, [document, filter]);

  const onConfirm = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    setError(null);
    const r = await callTool<RunPipelineResult>('items:run-pipeline', {
      requirements,
      style: selectedStyle,
      targetSize,
    });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    const msg = resultMessage(r.result);
    setMessage(msg);
    if (r.result.normalize?.failed.length) {
      setError(tf('messages.failed', { count: r.result.normalize.failed.length }));
    }
    await refresh();
    broadcastItemsRefresh('pipeline-done');
    setBusy(false);
  }, [requirements, selectedStyle, targetSize, refresh]);

  const onSaveItem = useCallback(async (item: ItemRecord) => {
    setEditorBusy(true);
    setError(null);
    const r = await callTool<{ ok: true; document: ItemsDocument }>('items:upsert-item', { item });
    setEditorBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setMessage(t('editor.saved'));
    await refresh();
    broadcastItemsRefresh('item-saved');
  }, [refresh]);

  const onDeleteItem = useCallback(async (item: ItemRecord) => {
    setEditorBusy(true);
    setError(null);
    const r = await callTool<{ ok: true; document: ItemsDocument; deletedSlug: string }>('items:delete-item', {
      itemSlug: item.slug,
    });
    setEditorBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setMessage(t('editor.deleted'));
    await refresh();
    broadcastItemsRefresh('item-deleted');
  }, [refresh]);

  const onOpenInUi = useCallback((item: ItemRecord) => {
    if (!activeSlug) return;
    navigateToUiWorkshop(activeSlug, [item.slug]);
  }, []);

  const sidebarProps = {
    styles,
    selectedStyle,
    onStyleChange: setSelectedStyle,
    requirements,
    onRequirementsChange: setRequirements,
    targetSize,
    onTargetSizeChange: setTargetSize,
    busy,
    message,
    error,
    onConfirm,
  };

  if (!gameActive) {
    return (
      <div className="wb-items-empty">
        <h1>{t('page.title')}</h1>
        <p>{t('empty.noGame')}</p>
      </div>
    );
  }

  if (pane === 'left') {
    return <Sidebar {...sidebarProps} />;
  }

  const selected = styles.find((s) => s.id === selectedStyle);
  const styleLabel = selected ? localizedStyleLabel(selected) : 'pixel-48';

  return (
    <div className="gx-root gx-root--standalone">
      {pane === 'standalone' && <Sidebar {...sidebarProps} />}
      <ItemLibrary
        items={filteredItems}
        icons={icons}
        filter={filter}
        onFilterChange={setFilter}
        targetSize={targetSize}
        styleLabel={styleLabel}
        totalCount={document?.items.length ?? 0}
        editorBusy={editorBusy}
        onSaveItem={onSaveItem}
        onDeleteItem={onDeleteItem}
        onOpenInUi={onOpenInUi}
      />
    </div>
  );
}
