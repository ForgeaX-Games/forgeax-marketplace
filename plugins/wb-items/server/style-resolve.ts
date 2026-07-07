import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StylePreset, StylePresetHint } from '../shared/types';

const catalogPath = join(dirname(fileURLToPath(import.meta.url)), '../shared/catalog.ts');

type CatalogModule = typeof import('../shared/catalog');

let loaded: { mtimeMs: number; mod: CatalogModule } | null = null;

export async function loadStyleCatalog(): Promise<CatalogModule> {
  const mtimeMs = statSync(catalogPath).mtimeMs;
  if (loaded?.mtimeMs === mtimeMs) return loaded.mod;
  const url = `${pathToFileURL(catalogPath).href}?fxmtime=${mtimeMs}`;
  const mod = (await import(url)) as CatalogModule;
  loaded = { mtimeMs, mod };
  return mod;
}

function hintToPreset(hint: StylePresetHint): StylePreset {
  return {
    id: hint.id,
    label: hint.label ?? { zh: hint.id, en: hint.id },
    delivery: hint.delivery,
    targetSize: hint.targetSize ?? 48,
    uiStyleId: hint.uiStyleId,
    promptSuffix: hint.promptSuffix,
  };
}

function isUsableHint(hint: StylePresetHint | undefined, id: string): hint is StylePresetHint {
  return !!hint
    && hint.id === id
    && !!hint.delivery
    && !!hint.promptSuffix?.trim();
}

/** Resolve style for generation — reloads catalog when catalog.ts changes; accepts client hint when handler cache is stale. */
export async function requireStylePreset(
  id: string,
  hint?: StylePresetHint,
): Promise<StylePreset> {
  const { getStylePreset } = await loadStyleCatalog();
  const fromCatalog = getStylePreset(id);
  if (fromCatalog) return fromCatalog;
  if (isUsableHint(hint, id)) return hintToPreset(hint);
  throw Object.assign(new Error(`unknown style: ${id}`), { code: 'unknown_style' });
}

export async function resolveStylePreset(
  id: string,
  hint?: StylePresetHint,
): Promise<StylePreset | undefined> {
  try {
    return await requireStylePreset(id, hint);
  } catch (e) {
    if ((e as { code?: string }).code === 'unknown_style') return undefined;
    throw e;
  }
}
