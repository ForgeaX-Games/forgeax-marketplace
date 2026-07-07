import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildItemFromSlug } from '../shared/catalog';
import {
  deleteItem,
  iconsDir,
  itemsJsonPath,
  readItemsDocument,
  upsertItem,
  writeItemsDocument,
} from './item-store';
import tools from './tool-handlers';

const GAME = 'e2e-test';

/** 1×1 transparent PNG — listItems 会触发 ensureIconNormalizedInPlace */
const MINI_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let root = '';
let prevRoot: string | undefined;

beforeEach(async () => {
  prevRoot = process.env.FORGEAX_PROJECT_ROOT;
  root = await mkdtemp(join(tmpdir(), 'wb-items-'));
  process.env.FORGEAX_PROJECT_ROOT = root;

  await mkdir(iconsDir(GAME), { recursive: true });
  await writeItemsDocument(GAME, {
    version: 1,
    meta: { defaultLocale: 'zh', iconStyle: 'pixel-48', iconSize: 48 },
    items: [],
  });
});

afterEach(async () => {
  if (prevRoot === undefined) delete process.env.FORGEAX_PROJECT_ROOT;
  else process.env.FORGEAX_PROJECT_ROOT = prevRoot;
  await rm(root, { recursive: true, force: true });
});

describe('deleteItem', () => {
  test('removes item from items.json and deletes icon file', async () => {
    const iconPath = join(iconsDir(GAME), 'test-potion.png');
    await writeFile(iconPath, MINI_PNG);
    const item = buildItemFromSlug('test-potion', 'assets/icons/test-potion.png');
    item.name = { zh: '测试药水', en: 'Test Potion' };
    await upsertItem(GAME, item);

    const doc = await deleteItem(GAME, 'test-potion');
    expect(doc.items.some((i) => i.slug === 'test-potion')).toBe(false);
    expect(existsSync(iconPath)).toBe(false);

    const persisted = await readItemsDocument(GAME);
    expect(persisted.items).toHaveLength(0);
  });

  test('throws when item slug is missing', async () => {
    await expect(deleteItem(GAME, 'missing')).rejects.toMatchObject({ code: 'item_not_found' });
  });
});

describe('items:delete-item tool', () => {
  test('is registered and returns deleted slug', async () => {
    const iconPath = join(iconsDir(GAME), 'gem.png');
    await writeFile(iconPath, MINI_PNG);
    await upsertItem(GAME, buildItemFromSlug('gem', 'assets/icons/gem.png'));

    const handler = tools['items:delete-item'];
    expect(handler).toBeDefined();

    const result = await handler!({ slug: GAME, itemSlug: 'gem' });
    expect(result.deletedSlug).toBe('gem');
    expect(result.document.items).toHaveLength(0);
    expect(existsSync(iconPath)).toBe(false);
    expect(existsSync(itemsJsonPath(GAME))).toBe(true);
  });
});

describe('items:list + game asset path', () => {
  test('lists items with previewUrl after upsert', async () => {
    const iconPath = join(iconsDir(GAME), 'sword.png');
    await writeFile(iconPath, MINI_PNG);
    await upsertItem(GAME, {
      ...buildItemFromSlug('sword', 'assets/icons/sword.png'),
      name: { zh: '大剑', en: 'Sword' },
    });

    const list = await tools['items:list']!({ slug: GAME });
    expect(list.document.items).toHaveLength(1);
    expect(list.icons[0]?.previewUrl).toContain('/api/game-assets/');
    expect(list.icons[0]?.previewUrl).toContain('assets/icons/sword.png');

    const absIcon = resolve(root, '.forgeax', 'games', GAME, 'assets', 'icons', 'sword.png');
    expect(existsSync(absIcon)).toBe(true);
  });
});
