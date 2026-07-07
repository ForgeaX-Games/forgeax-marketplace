import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

import type { ItemsDocument, ItemRecord } from '../shared/types';
import { buildItemFromSlug, DEFAULT_ICON_SIZE } from '../shared/catalog';

export function projectRoot(): string {
  return process.env.FORGEAX_PROJECT_ROOT ?? resolve(process.cwd(), '.forgeax-runtime');
}

function safeSlug(slug: string): string {
  if (!slug || slug.includes('/') || slug.includes('\\') || slug === '..' || slug.includes('\0')) {
    throw Object.assign(new Error(`unsafe slug ${JSON.stringify(slug)}`), { code: 'invalid_slug' });
  }
  return slug;
}

export function gameRoot(slug: string): string {
  return resolve(projectRoot(), '.forgeax', 'games', safeSlug(slug));
}

export function itemsJsonPath(slug: string): string {
  return resolve(gameRoot(slug), 'items.json');
}

export function iconsDir(slug: string): string {
  return resolve(gameRoot(slug), 'assets', 'icons');
}

export function workspaceBatchDir(batchId: string): string {
  return resolve(projectRoot(), 'workspace', 'images', 'items', batchId);
}

export async function ensureGameDirs(slug: string): Promise<void> {
  await mkdir(iconsDir(slug), { recursive: true });
}

export function emptyDocument(): ItemsDocument {
  return {
    version: 1,
    meta: {
      defaultLocale: 'zh',
      iconStyle: 'pixel-48',
      iconSize: DEFAULT_ICON_SIZE,
    },
    items: [],
  };
}

export async function readItemsDocument(slug: string): Promise<ItemsDocument> {
  const path = itemsJsonPath(slug);
  if (!existsSync(path)) return emptyDocument();
  const raw = await readFile(path, 'utf-8');
  const parsed = JSON.parse(raw) as ItemsDocument;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
    throw Object.assign(new Error('invalid items.json'), { code: 'invalid_items_json' });
  }
  return parsed;
}

export async function writeItemsDocument(slug: string, doc: ItemsDocument): Promise<void> {
  const path = itemsJsonPath(slug);
  await mkdir(dirname(path), { recursive: true });
  const next: ItemsDocument = {
    ...doc,
    meta: {
      ...doc.meta,
      updatedAt: new Date().toISOString(),
    },
  };
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
}

export async function listIconFiles(slug: string): Promise<string[]> {
  const dir = iconsDir(slug);
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && /\.(png|svg|webp)$/i.test(e.name))
    .map((e) => `assets/icons/${e.name}`)
    .sort();
}

export function mergeItemsFromIcons(doc: ItemsDocument, iconPaths: string[]): ItemsDocument {
  const iconSet = new Set(iconPaths);
  const bySlug = new Map(
    doc.items
      .filter((item) => {
        const rel = item.icon.replace(/^\.?\//, '');
        return iconSet.has(rel) || iconSet.has(item.icon);
      })
      .map((i) => [i.slug, i]),
  );
  for (const iconPath of iconPaths) {
    const file = iconPath.split('/').pop() ?? iconPath;
    const slug = file.replace(/\.[^.]+$/, '');
    if (!bySlug.has(slug)) {
      bySlug.set(slug, buildItemFromSlug(slug, iconPath));
    } else {
      const existing = bySlug.get(slug)!;
      bySlug.set(slug, { ...existing, icon: iconPath });
    }
  }
  return {
    ...doc,
    items: [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug)),
  };
}

export async function upsertItem(slug: string, item: ItemRecord): Promise<ItemsDocument> {
  const doc = await readItemsDocument(slug);
  const idx = doc.items.findIndex((i) => i.slug === item.slug);
  if (idx >= 0) doc.items[idx] = { ...doc.items[idx], ...item };
  else doc.items.push(item);
  doc.items.sort((a, b) => a.slug.localeCompare(b.slug));
  await writeItemsDocument(slug, doc);
  return doc;
}

export async function deleteItem(
  slug: string,
  itemSlug: string,
  options: { deleteIcon?: boolean } = {},
): Promise<ItemsDocument> {
  const deleteIcon = options.deleteIcon !== false;
  const doc = await readItemsDocument(slug);
  const item = doc.items.find((i) => i.slug === itemSlug);
  if (!item) {
    throw Object.assign(new Error(`item not found: ${itemSlug}`), { code: 'item_not_found' });
  }

  const next: ItemsDocument = {
    ...doc,
    items: doc.items.filter((i) => i.slug !== itemSlug),
  };
  await writeItemsDocument(slug, next);

  if (deleteIcon && item.icon) {
    const rel = item.icon.replace(/^\.?\//, '');
    const game = gameRoot(slug);
    const abs = resolve(game, rel);
    const relToGame = relative(game, abs);
    if (!relToGame.startsWith('..') && !relToGame.includes('..') && existsSync(abs)) {
      await unlink(abs);
    }
  }

  return next;
}

/** Drop stale entries that share a display name with newly generated items. */
export async function removeDuplicateNames(
  slug: string,
  keepSlugs: Set<string>,
  names: Set<string>,
): Promise<ItemsDocument> {
  const doc = await readItemsDocument(slug);
  const next = doc.items.filter((item) => {
    if (keepSlugs.has(item.slug)) return true;
    const zh = item.name?.zh?.trim();
    if (zh && names.has(zh)) return false;
    return true;
  });
  if (next.length === doc.items.length) return doc;
  const updated = { ...doc, items: next };
  await writeItemsDocument(slug, updated);
  return updated;
}
