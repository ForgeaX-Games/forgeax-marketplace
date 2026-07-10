import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ItemsDocument, ReferenceImage } from '../shared/types';
import {
  ensureGameDirs,
  gameRoot,
  iconsDir,
  readItemsDocument,
  writeItemsDocument,
} from './item-store';

export function refsDir(slug: string): string {
  return resolve(iconsDir(slug), 'refs');
}

function shortRefId(): string {
  return `ref-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function cleanB64(s: string): string {
  return s.replace(/^data:[^;]+;base64,/, '');
}

export async function saveReferenceImage(
  slug: string,
  base64: string,
  label?: string,
): Promise<{ document: ItemsDocument; reference: ReferenceImage }> {
  const raw = cleanB64(base64.trim());
  if (!raw) {
    throw Object.assign(new Error('empty reference image'), { code: 'empty_reference' });
  }
  await ensureGameDirs(slug);
  await mkdir(refsDir(slug), { recursive: true });
  const doc = await readItemsDocument(slug);
  const refs = doc.meta?.referenceImages ?? [];
  if (refs.length >= 5) {
    throw Object.assign(new Error('最多 5 张参考图'), { code: 'reference_limit' });
  }
  const id = shortRefId();
  const rel = `assets/icons/refs/${id}.png`;
  const abs = resolve(gameRoot(slug), rel);
  await writeFile(abs, Buffer.from(raw, 'base64'));
  const reference: ReferenceImage = { id, path: rel, label: label?.trim() || undefined };
  const next: ItemsDocument = {
    ...doc,
    meta: {
      ...doc.meta,
      referenceImages: [...refs, reference],
    },
  };
  await writeItemsDocument(slug, next);
  return { document: next, reference };
}

export async function deleteReferenceImage(slug: string, refId: string): Promise<ItemsDocument> {
  const doc = await readItemsDocument(slug);
  const refs = doc.meta?.referenceImages ?? [];
  const target = refs.find((r) => r.id === refId);
  if (!target) {
    throw Object.assign(new Error(`reference not found: ${refId}`), { code: 'reference_not_found' });
  }
  const abs = resolve(gameRoot(slug), target.path.replace(/^\.?\//, ''));
  if (existsSync(abs)) await unlink(abs);
  const next: ItemsDocument = {
    ...doc,
    meta: {
      ...doc.meta,
      referenceImages: refs.filter((r) => r.id !== refId),
    },
  };
  await writeItemsDocument(slug, next);
  return next;
}

export async function loadReferenceImagesB64(slug: string, doc: ItemsDocument): Promise<string[]> {
  const refs = doc.meta?.referenceImages ?? [];
  const out: string[] = [];
  for (const ref of refs) {
    const abs = resolve(gameRoot(slug), ref.path.replace(/^\.?\//, ''));
    if (!existsSync(abs)) continue;
    try {
      out.push((await readFile(abs)).toString('base64'));
    } catch { /* skip broken ref */ }
  }
  return out;
}
