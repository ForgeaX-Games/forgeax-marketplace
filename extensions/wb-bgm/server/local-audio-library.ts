import { realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import indexJson from '../data/local-library-index.json';
import type {
  LocalLibraryAsset,
  LocalLibraryIndex,
} from '../scripts/build-local-library-index.ts';
import type {
  AssetMetaLike,
  AudioLibraryProvider,
  LibraryQuery,
  ResolvedLibraryAsset,
} from './audio-library-provider.ts';

const DEFAULT_LIBRARY_ROOT = fileURLToPath(
  new URL('../public/library/builtin/', import.meta.url),
);
const PREVIEW_ROOT = '/extensions/wb-bgm/library/builtin';
const TYPE_BY_KIND = { bgm: 3, sfx: 7 } as const;

function previewUrl(relativePath: string): string {
  return `${PREVIEW_ROOT}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

function assetMeta(asset: LocalLibraryAsset): AssetMetaLike {
  const url = previewUrl(asset.relativePath);
  const type = TYPE_BY_KIND[asset.kind];
  return {
    id: asset.assetId,
    asset_id: asset.assetId,
    name: asset.relativePath,
    display_name: asset.relativePath,
    type,
    state: 1,
    description: '',
    current_version: asset.version,
    versions: [{
      version_name: asset.version,
      display_version_name: asset.version,
      res_url: url,
      state: 1,
    }],
  };
}

function isBeneath(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
}

export class LocalAudioLibraryProvider implements AudioLibraryProvider {
  private readonly assets: LocalLibraryAsset[];
  private readonly byId: Map<string, LocalLibraryAsset>;

  constructor(
    private readonly index: LocalLibraryIndex = indexJson as LocalLibraryIndex,
    private readonly libraryRoot = DEFAULT_LIBRARY_ROOT,
  ) {
    this.assets = [...index.assets];
    this.byId = new Map(this.assets.map((asset) => [asset.assetId, asset]));
  }

  async findAssets(query: LibraryQuery): Promise<{ assets: AssetMetaLike[]; total: number }> {
    const page = Math.max(1, Math.trunc(query.page));
    const pageSize = Math.max(1, Math.trunc(query.pageSize));
    const tokens = String(query.query ?? '')
      .normalize('NFC')
      .toLocaleLowerCase('en-US')
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    const matched = this.assets.filter((asset) => {
      if (query.kind && asset.kind !== query.kind) return false;
      const searchable = `${asset.relativePath} ${asset.fileName} ${asset.displayName}`
        .normalize('NFC')
        .toLocaleLowerCase('en-US');
      return tokens.every((token) => searchable.includes(token));
    });
    const start = (page - 1) * pageSize;
    return {
      assets: matched.slice(start, start + pageSize).map(assetMeta),
      total: matched.length,
    };
  }

  async resolveAsset(assetId: string): Promise<ResolvedLibraryAsset | null> {
    const asset = this.byId.get(assetId);
    if (!asset) return null;
    const root = await realpath(this.libraryRoot);
    const candidate = resolve(root, asset.relativePath);
    if (!isBeneath(root, candidate)) return null;
    let absolutePath: string;
    try {
      absolutePath = await realpath(candidate);
    } catch {
      return null;
    }
    if (!isBeneath(root, absolutePath)) return null;
    return {
      assetId: asset.assetId,
      kind: asset.kind,
      absolutePath,
      previewUrl: previewUrl(asset.relativePath),
      fileName: asset.fileName,
      version: asset.version,
    };
  }
}

export const localAudioLibrary = new LocalAudioLibraryProvider();
