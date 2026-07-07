import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ItemRecord, ItemsDocument, ListItemsResult, OptimizePromptResult, RegenerateItemResult, RunPipelineResult, StylePreset } from '@shared/types';
import { DEFAULT_ICON_SIZE, getStylePreset, pickerStylePresets, resolvePickerStyles, toStylePresetHint } from '@shared/catalog';
import { uiStyleForIconStyle } from '@shared/ui-style-map';
import { callTool, reloadPluginsAndRetry } from '@/lib/toolClient';
import { regenerateItemViaPipeline } from '@/lib/regenerate-item';
import { activeSlug, hasActiveGame } from '@/lib/gameSlug';
import { navigateToUiWorkshop } from '@/lib/items-handoff';
import { broadcastItemsRefresh, installItemsRefreshListener } from '@/lib/paneSync';
import { Sidebar } from '@/components/Sidebar';
import { ItemLibrary } from '@/components/ItemLibrary';
import { localizedStyleLabel, t, tf, useT } from '@/i18n';

interface AppProps {
  pane: 'left' | 'center' | 'standalone';
}

function pipelineFeedback(r: RunPipelineResult): { message: string | null; error: string | null } {
  const total = r.summarize.items.length;
  const saved = r.normalize?.normalized.length ?? 0;
  const normFailed = r.normalize?.failed.length ?? 0;
  const genFailed = r.icons?.failed ?? [];

  if (saved > 0 && normFailed > 0) {
    return {
      message: tf('messages.partial', { saved, total }),
      error: tf('messages.failed', { count: normFailed }),
    };
  }
  if (saved > 0) {
    return { message: tf('messages.done', { count: saved }), error: null };
  }
  if (normFailed > 0) {
    const detail = r.normalize!.failed[0]?.error;
    return {
      message: null,
      error: detail
        ? tf('messages.failedDetail', { count: normFailed, detail })
        : tf('messages.failed', { count: normFailed }),
    };
  }
  if (genFailed.length > 0) {
    const detail = genFailed[0]?.error ?? t('messages.genFailed');
    return { message: null, error: detail };
  }
  if (r.icons && r.icons.generated.length === 0 && total > 0) {
    return { message: null, error: t('messages.genFailed') };
  }
  return { message: null, error: t('messages.noOutput') };
}

export function App({ pane }: AppProps) {
  useT();
  const gameActive = hasActiveGame();
  const [document, setDocument] = useState<ItemsDocument | null>(null);
  const [icons, setIcons] = useState<ListItemsResult['icons']>([]);
  const [references, setReferences] = useState<ListItemsResult['references']>([]);
  const [styles, setStyles] = useState<StylePreset[]>(() => resolvePickerStyles([]));
  const [selectedStyle, setSelectedStyle] = useState('pixel-48');
  const [requirements, setRequirements] = useState('');
  const [targetSize, setTargetSize] = useState(DEFAULT_ICON_SIZE);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [refBusy, setRefBusy] = useState(false);
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
    setReferences(r.result.references ?? []);
    setError(null);
  }, [gameActive]);

  useEffect(() => {
    void refresh();
    void (async () => {
      const r = await callTool<{ ok: true; styles: StylePreset[] }>('items:list-styles', {});
      const merged = resolvePickerStyles(r.ok ? r.result.styles : undefined);
      setStyles(merged);
      const expected = pickerStylePresets().length;
      if (r.ok && r.result.styles.length < expected) {
        const again = await reloadPluginsAndRetry<{ ok: true; styles: StylePreset[] }>('items:list-styles', {});
        if (again.ok) setStyles(resolvePickerStyles(again.result.styles));
      }
    })();
    return installItemsRefreshListener(() => {
      void refresh();
    });
  }, [refresh]);

  const styleOptions = useMemo(() => resolvePickerStyles(styles), [styles]);
  const selectedPreset = useMemo(
    () => styleOptions.find((s) => s.id === selectedStyle),
    [styleOptions, selectedStyle],
  );

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
      useStoredReferences: true,
      stylePreset: selectedPreset ? toStylePresetHint(selectedPreset) : undefined,
    });
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return;
    }
    const feedback = pipelineFeedback(r.result);
    setMessage(feedback.message);
    setError(feedback.error);
    await refresh();
    broadcastItemsRefresh('pipeline-done');
    setBusy(false);
  }, [requirements, selectedStyle, selectedPreset, targetSize, refresh]);

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
    const preset = getStylePreset(selectedStyle);
    const uiStyleId = preset?.uiStyleId ?? uiStyleForIconStyle(selectedStyle);
    navigateToUiWorkshop(activeSlug, [item.slug], uiStyleId);
  }, [selectedStyle]);

  const onUploadReference = useCallback(async (base64: string, label?: string) => {
    setRefBusy(true);
    setError(null);
    const r = await callTool<{ ok: true; document: ItemsDocument }>('items:upload-reference', { base64, label });
    setRefBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setMessage(t('form.refUploaded'));
    await refresh();
    broadcastItemsRefresh('ref-uploaded');
  }, [refresh]);

  const onDeleteReference = useCallback(async (refId: string) => {
    setRefBusy(true);
    setError(null);
    const r = await callTool<{ ok: true; document: ItemsDocument }>('items:delete-reference', { refId });
    setRefBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    await refresh();
    broadcastItemsRefresh('ref-deleted');
  }, [refresh]);

  const onOptimizePrompt = useCallback(async (depicts: string, style: string, hint?: string) => {
    const preset = styleOptions.find((s) => s.id === style);
    const r = await callTool<OptimizePromptResult>('items:optimize-prompt', {
      depicts,
      style,
      hint,
      stylePreset: preset ? toStylePresetHint(preset) : undefined,
    });
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    return r.result.prompt;
  }, [styleOptions]);

  const onRegenerateItem = useCallback(async (item: ItemRecord, style: string, customPrompt: string) => {
    setEditorBusy(true);
    setError(null);
    await callTool<{ ok: true; document: ItemsDocument }>('items:upsert-item', { item });

    const preset = styleOptions.find((s) => s.id === style);
    const stylePreset = preset ? toStylePresetHint(preset) : undefined;

    let r = await callTool<RegenerateItemResult>('items:regenerate-item', {
      itemSlug: item.slug,
      style,
      targetSize,
      customPrompt: customPrompt || undefined,
      useStoredReferences: true,
      stylePreset,
    });

    if (!r.ok && r.code === 'not_found') {
      r = await regenerateItemViaPipeline(item, style, targetSize, customPrompt || undefined, stylePreset);
    }

    setEditorBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (r.result.failed) {
      setError(r.result.failed);
      return;
    }
    setMessage(t('editor.regenerated'));
    await refresh();
    broadcastItemsRefresh('item-regenerated');
  }, [styleOptions, targetSize, refresh]);

  const sidebarProps = {
    styles,
    selectedStyle,
    onStyleChange: setSelectedStyle,
    requirements,
    onRequirementsChange: setRequirements,
    targetSize,
    onTargetSizeChange: setTargetSize,
    references,
    refBusy,
    onUploadReference,
    onDeleteReference,
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

  const selected = styleOptions.find((s) => s.id === selectedStyle);
  const styleLabel = selected ? localizedStyleLabel(selected) : selectedStyle;

  return (
    <div className="gx-root gx-root--standalone">
      {pane === 'standalone' && <Sidebar {...sidebarProps} />}
      {(message || error) && (
        <div className="wb-items-toast-stack">
          {message && <div className="status-banner ok">{message}</div>}
          {error && <div className="status-banner err">{error}</div>}
        </div>
      )}
      <ItemLibrary
        items={filteredItems}
        icons={icons}
        styles={styles}
        targetSize={targetSize}
        defaultIconStyle={document?.meta?.iconStyle}
        hasReferences={references.length > 0}
        filter={filter}
        onFilterChange={setFilter}
        styleLabel={styleLabel}
        totalCount={document?.items.length ?? 0}
        editorBusy={editorBusy}
        onSaveItem={onSaveItem}
        onDeleteItem={onDeleteItem}
        onOpenInUi={onOpenInUi}
        onOptimizePrompt={onOptimizePrompt}
        onRegenerateItem={onRegenerateItem}
      />
    </div>
  );
}
