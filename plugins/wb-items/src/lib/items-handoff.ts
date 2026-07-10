/** Cross-workbench handoff: wb-items → wb-ui */

export const ITEMS_HANDOFF_KEY = 'forgeax:items-handoff';

export interface ItemsHandoff {
  slug: string;
  itemSlugs: string[];
  /** wb-ui StylePresetId，与道具图标画风对齐 */
  uiStyleId?: string;
  targetPluginId: '@forgeax-plugin/wb-ui';
  ts: number;
}

export function writeItemsHandoff(payload: Pick<ItemsHandoff, 'slug' | 'itemSlugs' | 'uiStyleId'>): void {
  try {
    window.localStorage.setItem(ITEMS_HANDOFF_KEY, JSON.stringify({
      ...payload,
      targetPluginId: '@forgeax-plugin/wb-ui',
      ts: Date.now(),
    } satisfies ItemsHandoff));
  } catch { /* private mode */ }
}

export function readItemsHandoff(maxAgeMs = 30 * 60_000): ItemsHandoff | null {
  try {
    const raw = window.localStorage.getItem(ITEMS_HANDOFF_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as ItemsHandoff;
    if (!data?.slug || !Array.isArray(data.itemSlugs)) return null;
    if (Date.now() - (data.ts ?? 0) > maxAgeMs) return null;
    return data;
  } catch {
    return null;
  }
}

export function navigateToUiWorkshop(slug: string, itemSlugs: string[], uiStyleId?: string): void {
  writeItemsHandoff({ slug, itemSlugs, uiStyleId });
  window.parent?.postMessage({
    type: 'FORGEAX_NAVIGATE',
    targetPluginId: '@forgeax-plugin/wb-ui',
    payload: { slug, itemSlugs, uiStyleId },
  }, '*');
}
