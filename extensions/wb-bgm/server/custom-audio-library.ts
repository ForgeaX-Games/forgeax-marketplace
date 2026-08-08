import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';

export type CustomAudioKind = 'bgm' | 'sfx';
export type CustomAudioMimeType = 'audio/ogg' | 'audio/mpeg' | 'audio/wav';

export interface CustomAudioAsset {
  assetId: string;
  kind: CustomAudioKind;
  originalName: string;
  relativePath: string;
  extension: '.ogg' | '.mp3' | '.wav';
  mimeType: CustomAudioMimeType;
  bytes: number;
  sha256: string;
  version: string;
  source: 'custom';
  previewUrl: string;
  createdAt: string;
}

interface CustomAudioIndex {
  schemaVersion: 'forgeax-custom-audio-library/1';
  assets: CustomAudioAsset[];
}

export interface ImportCustomAudioArgs {
  kind: CustomAudioKind;
  fileName: string;
  mimeType: string;
  base64: string;
}

export interface ResolvedCustomAudio {
  assetId: string;
  kind: CustomAudioKind;
  absolutePath: string;
  previewUrl: string;
  fileName: string;
  version: string;
  mimeType: CustomAudioMimeType;
}

export class CustomAudioError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'CustomAudioError';
  }
}

const INDEX_VERSION = 'forgeax-custom-audio-library/1' as const;
const MAX_CUSTOM_AUDIO_BYTES = 64 * 1024 * 1024;
const FORMAT_BY_EXTENSION = {
  '.ogg': new Set(['audio/ogg', 'application/ogg']),
  '.mp3': new Set(['audio/mpeg', 'audio/mp3']),
  '.wav': new Set(['audio/wav', 'audio/x-wav', 'audio/wave']),
} as const;
const MIME_BY_EXTENSION = {
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
} as const;
const catalogWriteTails = new Map<string, Promise<void>>();

function libraryRoot(projectRoot: string): string {
  return resolve(projectRoot, '.forgeax', 'assets', 'audio-custom');
}

function indexPath(projectRoot: string): string {
  return resolve(libraryRoot(projectRoot), 'index.json');
}

function emptyIndex(): CustomAudioIndex {
  return { schemaVersion: INDEX_VERSION, assets: [] };
}

async function readIndex(projectRoot: string): Promise<CustomAudioIndex> {
  let parsed: CustomAudioIndex;
  try {
    parsed = JSON.parse(await readFile(indexPath(projectRoot), 'utf8')) as CustomAudioIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyIndex();
    throw new CustomAudioError('catalog-invalid', `custom audio catalog is invalid: ${(error as Error).message}`);
  }
  if (parsed.schemaVersion !== INDEX_VERSION || !Array.isArray(parsed.assets)) {
    throw new CustomAudioError('catalog-invalid', 'custom audio catalog schema is invalid');
  }
  return parsed;
}

async function writeIndex(projectRoot: string, index: CustomAudioIndex): Promise<void> {
  const file = indexPath(projectRoot);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`);
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function withCatalogWriteLock<T>(projectRoot: string, task: () => Promise<T>): Promise<T> {
  const key = indexPath(projectRoot);
  const previous = catalogWriteTails.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const ticket = new Promise<void>((resolveTicket) => { release = resolveTicket; });
  const tail = previous.catch(() => undefined).then(() => ticket);
  catalogWriteTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (catalogWriteTails.get(key) === tail) catalogWriteTails.delete(key);
  }
}

function normalizedInput(args: ImportCustomAudioArgs): {
  kind: CustomAudioKind;
  fileName: string;
  extension: keyof typeof FORMAT_BY_EXTENSION;
  mimeType: CustomAudioMimeType;
  bytes: Buffer;
} {
  if (args.kind !== 'bgm' && args.kind !== 'sfx') {
    throw new CustomAudioError('invalid-kind', "kind must be exactly 'bgm' or 'sfx'");
  }
  const fileName = String(args.fileName ?? '').normalize('NFC').trim();
  if (!fileName || basename(fileName) !== fileName || /[\\/\0]/.test(fileName)) {
    throw new CustomAudioError('invalid-file-name', 'fileName must not contain a directory path');
  }
  const extension = extname(fileName).toLowerCase() as keyof typeof FORMAT_BY_EXTENSION;
  const acceptedMimes = FORMAT_BY_EXTENSION[extension];
  if (!acceptedMimes || !acceptedMimes.has(String(args.mimeType ?? '').toLowerCase() as never)) {
    throw new CustomAudioError('unsupported-audio-format', 'custom audio must be OGG, MP3, or WAV');
  }
  const encoded = String(args.base64 ?? '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new CustomAudioError('invalid-audio-data', 'audio bytes must be valid base64');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw new CustomAudioError('invalid-audio-data', 'audio file is empty');
  if (bytes.length > MAX_CUSTOM_AUDIO_BYTES) {
    throw new CustomAudioError('audio-too-large', `audio file exceeds ${MAX_CUSTOM_AUDIO_BYTES} bytes`);
  }
  return { kind: args.kind, fileName, extension, mimeType: MIME_BY_EXTENSION[extension], bytes };
}

function isBeneath(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
}

export async function importCustomAudio(
  args: ImportCustomAudioArgs,
  projectRoot: string,
): Promise<{ asset: CustomAudioAsset; absolutePath: string; duplicate: boolean }> {
  const input = normalizedInput(args);
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const assetId = `custom:${input.kind}:sha256:${sha256}`;
  const relativePath = `${input.kind}/${sha256}${input.extension}`;
  const root = libraryRoot(projectRoot);
  const absolutePath = resolve(root, relativePath);
  if (!isBeneath(root, absolutePath)) {
    throw new CustomAudioError('invalid-storage-path', 'custom audio path escapes its storage root');
  }

  return await withCatalogWriteLock(projectRoot, async () => {
    const index = await readIndex(projectRoot);
    const existing = index.assets.find((asset) => asset.assetId === assetId);
    if (existing) {
      return { asset: existing, absolutePath, duplicate: true };
    }
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, input.bytes);
    const asset: CustomAudioAsset = {
      assetId,
      kind: input.kind,
      originalName: input.fileName,
      relativePath,
      extension: input.extension,
      mimeType: input.mimeType,
      bytes: input.bytes.length,
      sha256,
      version: sha256.slice(0, 12),
      source: 'custom',
      previewUrl: `/api/wb/bgm/custom/${encodeURIComponent(assetId)}`,
      createdAt: new Date().toISOString(),
    };
    index.assets.push(asset);
    index.assets.sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0);
    await writeIndex(projectRoot, index);
    return { asset, absolutePath, duplicate: false };
  });
}

export async function listCustomAudio(
  projectRoot: string,
  kind?: CustomAudioKind,
): Promise<{ assets: CustomAudioAsset[]; total: number }> {
  if (kind !== undefined && kind !== 'bgm' && kind !== 'sfx') {
    throw new CustomAudioError('invalid-kind', "kind must be exactly 'bgm' or 'sfx'");
  }
  const index = await readIndex(projectRoot);
  const assets = index.assets.filter((asset) => !kind || asset.kind === kind);
  return { assets, total: assets.length };
}

export async function resolveCustomAudio(
  projectRoot: string,
  assetId: string,
): Promise<ResolvedCustomAudio | null> {
  const index = await readIndex(projectRoot);
  const asset = index.assets.find((candidate) => candidate.assetId === assetId);
  if (!asset) return null;
  const root = libraryRoot(projectRoot);
  const candidate = resolve(root, asset.relativePath);
  if (!isBeneath(root, candidate) || !existsSync(candidate)) return null;
  let absolutePath: string;
  try {
    const physicalRoot = await realpath(root);
    absolutePath = await realpath(candidate);
    if (!isBeneath(physicalRoot, absolutePath)) return null;
  } catch {
    return null;
  }
  return {
    assetId: asset.assetId,
    kind: asset.kind,
    absolutePath,
    previewUrl: asset.previewUrl,
    fileName: asset.originalName,
    version: asset.version,
    mimeType: asset.mimeType,
  };
}

export async function deleteCustomAudio(projectRoot: string, assetId: string): Promise<boolean> {
  return await withCatalogWriteLock(projectRoot, async () => {
    const index = await readIndex(projectRoot);
    const asset = index.assets.find((candidate) => candidate.assetId === assetId);
    if (!asset) return false;
    index.assets = index.assets.filter((candidate) => candidate.assetId !== assetId);
    await writeIndex(projectRoot, index);
    const root = libraryRoot(projectRoot);
    const file = resolve(root, asset.relativePath);
    if (isBeneath(root, file)) await unlink(file).catch(() => undefined);
    return true;
  });
}

export async function changeCustomAudioKind(
  projectRoot: string,
  assetId: string,
  kind: CustomAudioKind,
): Promise<{ asset: CustomAudioAsset; duplicate: boolean }> {
  if (kind !== 'bgm' && kind !== 'sfx') {
    throw new CustomAudioError('invalid-kind', "kind must be exactly 'bgm' or 'sfx'");
  }
  const index = await readIndex(projectRoot);
  const current = index.assets.find((asset) => asset.assetId === assetId);
  if (!current) throw new CustomAudioError('asset-not-found', 'custom assetId is not registered');
  if (current.kind === kind) return { asset: current, duplicate: true };
  const resolved = await resolveCustomAudio(projectRoot, assetId);
  if (!resolved) throw new CustomAudioError('asset-not-found', 'custom audio file is unavailable');
  const imported = await importCustomAudio({
    kind,
    fileName: current.originalName,
    mimeType: current.mimeType,
    base64: (await readFile(resolved.absolutePath)).toString('base64'),
  }, projectRoot);
  await deleteCustomAudio(projectRoot, assetId);
  return { asset: imported.asset, duplicate: imported.duplicate };
}
