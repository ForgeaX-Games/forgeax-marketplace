import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type LocalAudioKind = 'bgm' | 'sfx';

export interface LocalLibraryAsset {
  assetId: string;
  kind: LocalAudioKind;
  relativePath: string;
  fileName: string;
  displayName: string;
  mimeType: 'audio/ogg' | 'audio/mpeg';
  extension: '.ogg' | '.mp3';
  bytes: number;
  sha256: string;
  source: 'builtin';
  version: string;
  loopFromName: boolean;
  variantGroup: string;
  variantIndex: number | null;
}

export interface LocalLibraryIndex {
  schemaVersion: 'forgeax-local-audio-library/1';
  libraryVersion: '2026-08-07';
  assetCount: number;
  assets: LocalLibraryAsset[];
}

const FORMAT_BY_EXTENSION = {
  '.ogg': { kind: 'bgm', mimeType: 'audio/ogg' },
  '.mp3': { kind: 'sfx', mimeType: 'audio/mpeg' },
} as const;

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) return await listFiles(root, absolute);
    if (!entry.isFile()) {
      throw new Error(`unsafe audio library entry: ${normalizedRelativePath(root, absolute)}`);
    }
    return [absolute];
  }));
  return nested.flat();
}

function normalizedRelativePath(root: string, absolute: string): string {
  const normalizedRoot = resolve(root);
  const normalizedFile = resolve(absolute);
  if (normalizedFile !== normalizedRoot && !normalizedFile.startsWith(`${normalizedRoot}${sep}`)) {
    throw new Error(`audio path escapes library root: ${absolute}`);
  }
  const value = relative(normalizedRoot, normalizedFile).split(sep).join('/');
  if (!value || value.startsWith('/') || value.split('/').includes('..')) {
    throw new Error(`unsafe audio path: ${value || '(empty)'}`);
  }
  return value;
}

function parseVariant(fileName: string): { group: string; index: number | null } {
  const extension = extname(fileName);
  const stem = fileName.slice(0, fileName.length - extension.length);
  const matched = stem.match(/^(.*)_([0-9]{2})$/);
  return matched
    ? { group: matched[1] || stem, index: Number(matched[2]) }
    : { group: stem, index: null };
}

function displayName(fileName: string): string {
  const extension = extname(fileName);
  return fileName.slice(0, fileName.length - extension.length).replace(/[_-]+/g, ' ').trim();
}

export async function buildLocalLibraryIndex(root: string): Promise<LocalLibraryIndex> {
  const assets: LocalLibraryAsset[] = [];
  const ids = new Set<string>();
  const caseFoldedPaths = new Set<string>();

  for (const absolute of await listFiles(root)) {
    const relativePath = normalizedRelativePath(root, absolute);
    const extension = extname(absolute).toLowerCase() as keyof typeof FORMAT_BY_EXTENSION;
    const format = FORMAT_BY_EXTENSION[extension];
    if (!format) throw new Error(`unsupported local audio file: ${relativePath}`);
    const topLevel = relativePath.split('/', 1)[0];
    if (topLevel !== format.kind) {
      throw new Error(`${extension} must be stored below ${format.kind}/: ${relativePath}`);
    }
    const folded = relativePath.normalize('NFC').toLocaleLowerCase('en-US');
    if (caseFoldedPaths.has(folded)) throw new Error(`case-folded path collision: ${relativePath}`);
    caseFoldedPaths.add(folded);

    const bytes = await readFile(absolute);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const assetId = `local:${format.kind}:sha256:${sha256}`;
    if (ids.has(assetId)) throw new Error(`duplicate local audio content: ${relativePath}`);
    ids.add(assetId);

    const fileName = relativePath.split('/').at(-1)!;
    const variant = parseVariant(fileName);
    const info = await stat(absolute);
    assets.push({
      assetId,
      kind: format.kind,
      relativePath,
      fileName,
      displayName: displayName(fileName),
      mimeType: format.mimeType,
      extension,
      bytes: info.size,
      sha256,
      source: 'builtin',
      version: sha256.slice(0, 12),
      loopFromName: /(?:^|[_-])loop(?:[_-]|$)/i.test(fileName),
      variantGroup: variant.group,
      variantIndex: variant.index,
    });
  }

  assets.sort((left, right) => (
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  ));
  return {
    schemaVersion: 'forgeax-local-audio-library/1',
    libraryVersion: '2026-08-07',
    assetCount: assets.length,
    assets,
  };
}

export async function verifyLocalLibraryIndex(root: string, indexFile: string): Promise<void> {
  const current = await buildLocalLibraryIndex(root);
  let committed: LocalLibraryIndex;
  try {
    committed = JSON.parse(await readFile(indexFile, 'utf8')) as LocalLibraryIndex;
  } catch (error) {
    throw new Error(`local audio library index is out of date: ${(error as Error).message}`);
  }
  if (JSON.stringify(committed) !== JSON.stringify(current)) {
    throw new Error('local audio library index is out of date; run bun run index:local-library');
  }
}

async function main(): Promise<void> {
  const scriptDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const pluginRoot = resolve(scriptDir, '..');
  const libraryRoot = resolve(pluginRoot, 'public', 'library', 'builtin');
  const output = resolve(pluginRoot, 'data', 'local-library-index.json');
  if (process.argv.includes('--check')) {
    await verifyLocalLibraryIndex(libraryRoot, output);
    process.stdout.write('local audio library index is current\n');
    return;
  }
  const index = await buildLocalLibraryIndex(libraryRoot);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(index, null, 2)}\n`);
  process.stdout.write(`indexed ${index.assetCount} local audio assets\n`);
}

if (import.meta.main) await main();
