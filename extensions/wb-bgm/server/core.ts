/**
 * wb-bgm core — audio/SFX library logic, now OWNED by the plugin (moved out of
 * forgeax-server). Single source of truth for BOTH modalities:
 *   - humans:  the vendored SPA → host `/api/tools/call` (caller.kind='user')
 *   - AI:      server/tool-handlers.ts (registry entry.backend, caller.kind='ai')
 *
 * The packaged library is the only search source. `projectRoot` is injected
 * and `slug` is required on every write/read path.
 *
 * Scope is intentionally locked: depot is Local, only asset_type 3 (bgm) and 7
 * (sfx) are addressable. "Attach" = copy the selected audio into the current
 * game's `.forgeax/games/<slug>/audio/` and upsert `audio/manifest.json`.
 */

import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, relative, basename, dirname, extname } from 'node:path';
import type { AudioShapingParams } from '../shared/audio-project.ts';
import type { AssetMetaLike } from './audio-library-provider.ts';
import { localAudioLibrary } from './local-audio-library.ts';

export interface BgmConfig {
  depot: string;
  [key: string]: unknown;
}

export type AudioKind = 'bgm' | 'sfx' | 'voice';
export type LibraryAudioKind = Exclude<AudioKind, 'voice'>;
const TYPE_TO_KIND: Record<number, LibraryAudioKind> = { 3: 'bgm', 7: 'sfx' };

const MANIFEST_VERSION = 1;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024; // 64 MB safety ceiling per blob
const manifestWriteTails = new Map<string, Promise<void>>();

export class BgmError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public detail?: string,
  ) {
    super(message);
    this.name = 'BgmError';
  }
}

interface VersionLike {
  version_name?: string;
  display_version_name?: string;
  res_url?: string;
  state?: number;
  update_time?: number | string;
  create_time?: number | string;
}
function pickLatestVersion(meta: AssetMetaLike): VersionLike | undefined {
  const usable = (meta.versions ?? []).filter((v) => v.res_url);
  if (!usable.length) return undefined;
  return usable.reduce((best, v) => {
    const bt = Number(best.update_time ?? best.create_time ?? 0);
    const vt = Number(v.update_time ?? v.create_time ?? 0);
    return vt >= bt ? v : best;
  }, usable[0]);
}

export interface AudioResult {
  assetId: string;
  name: string;
  kind: LibraryAudioKind;
  type: number;
  description: string;
  version: string;
  resUrl: string;
}

function normalize(meta: AssetMetaLike): AudioResult | null {
  const ver = pickLatestVersion(meta);
  if (!ver?.res_url) return null;
  const type = meta.type ?? 3;
  return {
    assetId: meta.asset_id || meta.id || '',
    name: meta.display_name || meta.name || '(unnamed)',
    kind: TYPE_TO_KIND[type] ?? 'bgm',
    type,
    description: meta.description || '',
    version: ver.display_version_name || ver.version_name || '',
    resUrl: ver.res_url,
  };
}

/** Search the Local depot for BGM (type 3) and/or SFX (type 7). */
export async function searchAudio(
  _cfg: BgmConfig,
  opts: { query?: string; kind?: LibraryAudioKind; limit?: number },
): Promise<AudioResult[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const { assets } = await localAudioLibrary.findAssets({
    kind: opts.kind,
    query: opts.query,
    page: 1,
    pageSize: limit,
  });
  return assets
    .map(normalize)
    .filter((asset): asset is AudioResult => Boolean(asset));
}

// ── game-side write path (persist + manifest) ────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export interface ManifestTrack {
  assetId: string;
  name: string;
  kind: AudioKind;
  file: string; // relative to the game root, e.g. "audio/foo.mp3"
  version: string;
  source: string; // depot name
  addedBy: 'human' | 'ai';
  addedAt: string; // ISO timestamp
  shaping?: AudioShapingParams;
}
export interface AudioManifest {
  version: number;
  slug: string;
  tracks: ManifestTrack[];
}

function listGameSlugs(projectRoot: string): string[] {
  const gamesDir = resolve(projectRoot, '.forgeax', 'games');
  if (!existsSync(gamesDir)) return [];
  try {
    return readdirSync(gamesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && SLUG_RE.test(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function gameRoot(projectRoot: string, slug: string): string {
  if (!SLUG_RE.test(slug)) throw new BgmError('invalid-slug', `invalid game slug: ${slug}`, 400);
  const abs = resolve(projectRoot, '.forgeax/games', slug);
  const rel = relative(projectRoot, abs);
  const segs = rel.split(/[/\\]/);
  if (segs[0] !== '.forgeax' || segs[1] !== 'games' || segs[2] !== slug) {
    throw new BgmError('invalid-slug', `slug escapes games dir: ${slug}`, 400);
  }
  return abs;
}

function manifestPath(projectRoot: string, slug: string): string {
  return resolve(gameRoot(projectRoot, slug), 'audio', 'manifest.json');
}

function normalizeShaping(value: unknown): AudioShapingParams | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Partial<Record<keyof AudioShapingParams, unknown>>;
  const clampNumber = (key: keyof AudioShapingParams, fallback: number, min: number, max: number) => {
    const raw = row[key];
    const numeric = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
    return Math.min(max, Math.max(min, numeric));
  };
  const shaping: AudioShapingParams = {
    gainDb: clampNumber('gainDb', 0, -24, 12),
    pitchSemitones: clampNumber('pitchSemitones', 0, -12, 12),
    highpassHz: clampNumber('highpassHz', 20, 20, 2_000),
    lowpassHz: clampNumber('lowpassHz', 20_000, 1_000, 20_000),
    eqLowDb: clampNumber('eqLowDb', 0, -12, 12),
    eqMidDb: clampNumber('eqMidDb', 0, -12, 12),
    eqHighDb: clampNumber('eqHighDb', 0, -12, 12),
  };
  if (shaping.highpassHz >= shaping.lowpassHz) shaping.highpassHz = Math.max(20, shaping.lowpassHz - 100);
  return shaping;
}

function requireSlug(slug?: string): string {
  const s = slug && slug.trim() ? slug.trim() : '';
  if (!s) throw new BgmError('slug-required', 'slug is required (explicit; no auto-detect)', 400);
  if (!SLUG_RE.test(s)) throw new BgmError('invalid-slug', `invalid game slug: ${s}`, 400);
  return s;
}

export async function readManifest(projectRoot: string, slug?: string): Promise<AudioManifest> {
  const resolved = requireSlug(slug);
  const file = manifestPath(projectRoot, resolved);
  if (!existsSync(file)) return { version: MANIFEST_VERSION, slug: resolved, tracks: [] };
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as Partial<AudioManifest>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('manifest root must be an object');
    }
    if (parsed.slug && parsed.slug !== resolved) {
      throw new BgmError(
        'manifest-slug-mismatch',
        `audio manifest slug '${parsed.slug}' does not match target '${resolved}'`,
        409,
      );
    }
    if (parsed.tracks !== undefined && !Array.isArray(parsed.tracks)) {
      throw new Error('manifest.tracks must be an array');
    }
    const tracks = (parsed.tracks ?? []) as ManifestTrack[];
    for (const [index, track] of tracks.entries()) {
      if (
        !track
        || typeof track.assetId !== 'string'
        || typeof track.file !== 'string'
        || (track.kind !== 'bgm' && track.kind !== 'sfx' && track.kind !== 'voice')
      ) {
        throw new Error(`manifest.tracks[${index}] is invalid`);
      }
      const trackPath = resolve(gameRoot(projectRoot, resolved), track.file);
      const trackRelative = relative(gameRoot(projectRoot, resolved), trackPath);
      if (!track.file.startsWith('audio/') || trackRelative.startsWith('..')) {
        throw new Error(`manifest.tracks[${index}].file escapes the audio directory`);
      }
      const shaping = normalizeShaping(track.shaping);
      if (shaping) track.shaping = shaping;
      else delete track.shaping;
    }
    return {
      version: parsed.version ?? MANIFEST_VERSION,
      slug: resolved,
      tracks,
    };
  } catch (error) {
    if (error instanceof BgmError) throw error;
    throw new BgmError(
      'manifest-invalid',
      `audio manifest is invalid for '${resolved}': ${(error as Error).message}`,
      409,
    );
  }
}

/** Crash-safe JSON replacement used by manifest/cue-plan writes. */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Serialize manifest mutations for one game while allowing source reads to
 * run concurrently. This also protects human and AI attach calls from
 * overwriting each other's manifest updates inside the same server process. */
async function withManifestWriteLock<T>(
  file: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = manifestWriteTails.get(file) ?? Promise.resolve();
  let release: () => void = () => {};
  const ticket = new Promise<void>((resolveTicket) => {
    release = resolveTicket;
  });
  const tail = previous.catch(() => undefined).then(() => ticket);
  manifestWriteTails.set(file, tail);
  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (manifestWriteTails.get(file) === tail) manifestWriteTails.delete(file);
  }
}

const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|aac|flac|opus|wma)$/i;

function safeFilename(name: string, resUrl: string): string {
  const fromUrl = basename((resUrl.split('?')[0] || '').trim());
  let candidate = AUDIO_EXT_RE.test(fromUrl) ? fromUrl : name;
  candidate = candidate.replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!candidate) candidate = 'audio';
  if (!AUDIO_EXT_RE.test(candidate)) {
    const ext = extname(fromUrl);
    candidate += AUDIO_EXT_RE.test(`x${ext}`) ? ext : '.mp3';
  }
  return candidate;
}

export interface AttachInput {
  projectRoot: string;
  slug?: string;
  assetId: string;
  name?: string;
  kind: LibraryAudioKind;
  version?: string;
  resUrl: string;
  /** Trusted server-resolved source. Never exposed as a tool argument. */
  sourcePath?: string;
  filename?: string;
  addedBy?: 'human' | 'ai';
  /** Depot label recorded on the manifest track (from BgmConfig.depot). */
  depot?: string;
  shaping?: AudioShapingParams;
}
export interface AttachResult {
  ok: true;
  slug: string;
  assetId: string;
  kind: AudioKind;
  file: string;
  path: string;
  url: string;
  bytes: number;
  manifest: string;
  reused: boolean;
}

/**
 * Persist an audio blob into `<game>/audio/` and upsert the matching
 * `audio/manifest.json` entry. Idempotent on assetId.
 */
export async function attachAudio(input: AttachInput): Promise<AttachResult> {
  const { projectRoot, assetId, kind, resUrl } = input;
  if (!assetId) throw new BgmError('missing-asset-id', 'assetId is required', 400);
  if (!resUrl) throw new BgmError('missing-res-url', 'resUrl is required', 400);
  if (kind !== 'bgm' && kind !== 'sfx') {
    throw new BgmError('invalid-kind', `kind must be 'bgm' or 'sfx', got: ${kind}`, 400);
  }

  const slug = requireSlug(input.slug);
  if (!existsSync(gameRoot(projectRoot, slug))) {
    const available = listGameSlugs(projectRoot).join(', ') || '(none)';
    throw new BgmError('unknown-slug', `game not found: ${slug}. Available games: ${available}.`, 400);
  }
  const root = gameRoot(projectRoot, slug);
  const audioDir = resolve(root, 'audio');
  const file = manifestPath(projectRoot, slug);

  // Validate before spending network time. The manifest is read again under
  // the write lock after download so concurrent attaches cannot lose tracks.
  await readManifest(projectRoot, slug);

  let bytes: Buffer | undefined;
  let byteLength: number;
  if (input.sourcePath) {
    const sourceInfo = await stat(input.sourcePath);
    if (!sourceInfo.isFile()) {
      throw new BgmError('invalid-source', 'registered audio source is not a file', 409);
    }
    byteLength = sourceInfo.size;
  } else {
    let resp: Response;
    try {
      resp = await fetch(resUrl);
    } catch (e) {
      throw new BgmError('download-failed', `audio fetch failed: ${(e as Error).message}`, 502);
    }
    if (!resp.ok) throw new BgmError('download-failed', `audio source returned HTTP ${resp.status}`, 502);
    bytes = Buffer.from(await resp.arrayBuffer());
    byteLength = bytes.length;
  }
  if (byteLength === 0) throw new BgmError('empty-download', 'downloaded 0 bytes', 502);
  if (byteLength > MAX_AUDIO_BYTES) {
    throw new BgmError('too-large', `audio exceeds ${MAX_AUDIO_BYTES} byte ceiling`, 413);
  }

  return await withManifestWriteLock(file, async () => {
    const manifest = await readManifest(projectRoot, slug);
    const existing = manifest.tracks.find((track) => track.assetId === assetId);

    let fileRel: string;
    if (existing) {
      fileRel = existing.file;
    } else {
      let fname = safeFilename(input.filename || input.name || assetId, resUrl);
      const ownedByOther = (candidate: string) =>
        manifest.tracks.some((track) =>
          track.file === `audio/${candidate}` && track.assetId !== assetId);
      if (ownedByOther(fname) || existsSync(resolve(audioDir, fname))) {
        const ext = extname(fname);
        const stem = fname.slice(0, fname.length - ext.length);
        fname = `${stem}-${assetId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'x'}${ext}`;
      }
      fileRel = `audio/${fname}`;
    }
    const abs = resolve(root, fileRel);

    await mkdir(audioDir, { recursive: true });
    const reused = existsSync(abs);
    if (input.sourcePath) await copyFile(input.sourcePath, abs);
    else await writeFile(abs, bytes!);

    const shaping = normalizeShaping(input.shaping);
    const track: ManifestTrack = {
      assetId,
      name: input.name || basename(fileRel),
      kind,
      file: fileRel,
      version: input.version || '',
      source: input.depot || 'aw',
      addedBy: input.addedBy === 'ai' ? 'ai' : 'human',
      addedAt: new Date().toISOString(),
      ...(shaping ? { shaping } : {}),
    };
    const index = manifest.tracks.findIndex((candidate) =>
      candidate.assetId === assetId);
    if (index >= 0) manifest.tracks[index] = track;
    else manifest.tracks.push(track);
    manifest.version = MANIFEST_VERSION;
    manifest.slug = slug;

    for (const candidate of manifest.tracks) {
      delete (candidate as { url?: string }).url;
    }

    await writeJsonAtomic(file, manifest);

    return {
      ok: true,
      slug,
      assetId,
      kind,
      file: fileRel,
      path: relative(projectRoot, abs),
      url: resUrl,
      bytes: byteLength,
      manifest: relative(projectRoot, file),
      reused,
    };
  });
}

export interface AttachGeneratedAudioInput {
  projectRoot: string;
  slug?: string;
  assetId: string;
  name: string;
  kind: AudioKind;
  base64: string;
  mimeType?: string;
  filename?: string;
  provider?: string;
  model?: string;
  addedBy?: 'human' | 'ai';
}

/**
 * Persist API-generated audio into a game without round-tripping through an
 * external URL. The browser receives generated bytes from the host gateway,
 * previews them, and sends the selected version back through this host tool.
 * The same manifest lock and validation rules as library attachments apply.
 */
export async function attachGeneratedAudio(
  input: AttachGeneratedAudioInput,
): Promise<AttachResult> {
  const slug = requireSlug(input.slug);
  if (!existsSync(gameRoot(input.projectRoot, slug))) {
    const available = listGameSlugs(input.projectRoot).join(', ') || '(none)';
    throw new BgmError(
      'unknown-slug',
      `game not found: ${slug}. Available games: ${available}.`,
      400,
    );
  }
  const assetId = String(input.assetId ?? '').trim();
  if (!assetId || assetId.length > 160) {
    throw new BgmError('invalid-asset-id', 'generated assetId is required and must be <= 160 characters', 400);
  }
  if (input.kind !== 'bgm' && input.kind !== 'sfx' && input.kind !== 'voice') {
    throw new BgmError('invalid-kind', `kind must be 'bgm', 'sfx', or 'voice', got: ${input.kind}`, 400);
  }
  const encoded = String(input.base64 ?? '').replace(/^data:[^;]+;base64,/, '').trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new BgmError('invalid-audio-data', 'generated audio must be valid base64', 400);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) throw new BgmError('empty-audio', 'generated audio contains 0 bytes', 400);
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw new BgmError('too-large', `audio exceeds ${MAX_AUDIO_BYTES} byte ceiling`, 413);
  }

  const mime = String(input.mimeType ?? '').toLowerCase();
  const extension = mime.includes('wav') ? '.wav'
    : mime.includes('ogg') ? '.ogg'
      : mime.includes('flac') ? '.flac'
        : '.mp3';
  const root = gameRoot(input.projectRoot, slug);
  const audioDir = resolve(root, 'audio', 'generated');
  const manifestFile = manifestPath(input.projectRoot, slug);
  await readManifest(input.projectRoot, slug);

  return await withManifestWriteLock(manifestFile, async () => {
    const manifest = await readManifest(input.projectRoot, slug);
    const existing = manifest.tracks.find((track) => track.assetId === assetId);
    let fileRel = existing?.file;
    if (!fileRel) {
      let filename = safeFilename(
        input.filename || input.name || assetId,
        input.filename || `generated${extension}`,
      );
      const usedByAnother = (candidate: string) => manifest.tracks.some((track) =>
        track.file === `audio/generated/${candidate}` && track.assetId !== assetId);
      if (usedByAnother(filename) || existsSync(resolve(audioDir, filename))) {
        const ext = extname(filename);
        const stem = filename.slice(0, filename.length - ext.length);
        filename = `${stem}-${assetId.replace(/[^a-zA-Z0-9]/g, '').slice(-8) || 'x'}${ext}`;
      }
      fileRel = `audio/generated/${filename}`;
    }
    const absolute = resolve(root, fileRel);
    await mkdir(dirname(absolute), { recursive: true });
    const reused = existsSync(absolute);
    await writeFile(absolute, bytes);

    const provider = String(input.provider ?? 'api').trim() || 'api';
    const model = String(input.model ?? '').trim();
    const track: ManifestTrack = {
      assetId,
      name: String(input.name ?? '').trim() || basename(fileRel),
      kind: input.kind,
      file: fileRel,
      version: model || 'generated',
      source: `generated:${provider}`,
      addedBy: input.addedBy === 'ai' ? 'ai' : 'human',
      addedAt: new Date().toISOString(),
    };
    const index = manifest.tracks.findIndex((track) => track.assetId === assetId);
    if (index >= 0) manifest.tracks[index] = track;
    else manifest.tracks.push(track);
    manifest.version = MANIFEST_VERSION;
    manifest.slug = slug;
    await writeJsonAtomic(manifestFile, manifest);

    return {
      ok: true,
      slug,
      assetId,
      kind: input.kind,
      file: fileRel,
      path: relative(input.projectRoot, absolute),
      url: '',
      bytes: bytes.length,
      manifest: relative(input.projectRoot, manifestFile),
      reused,
    };
  });
}
