/** Cross-workbench handoff: wb-items → wb-ui */

export const ITEMS_HANDOFF_KEY = 'forgeax:items-handoff';

export interface ItemsHandoff {
  slug: string;
  itemSlugs: string[];
  targetPluginId: '@forgeax-plugin/wb-ui';
  ts: number;
}

export function writeItemsHandoff(payload: Pick<ItemsHandoff, 'slug' | 'itemSlugs'>): void {
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

export function navigateToUiWorkshop(slug: string, itemSlugs: string[]): void {
  writeItemsHandoff({ slug, itemSlugs });
  window.parent?.postMessage({
    type: 'FORGEAX_NAVIGATE',
    targetPluginId: '@forgeax-plugin/wb-ui',
    payload: { slug, itemSlugs },
  }, '*');
}
