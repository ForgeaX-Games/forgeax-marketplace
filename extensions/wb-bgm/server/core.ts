/**
 * wb-bgm core — audio/SFX library logic, now OWNED by the plugin (moved out of
 * forgeax-server). Single source of truth for BOTH modalities:
 *   - humans:  the vendored SPA → host `/api/tools/call` (caller.kind='user')
 *   - AI:      server/tool-handlers.ts (registry entry.backend, caller.kind='ai')
 *
 * Differences from the old server copy:
 *   - Config (upstream gateway base / sandbox key / depot) is INJECTED via
 *     `BgmConfig` (sourced from the per-call ctx.env the host hands the handler,
 *     filtered to the manifest's `requestedEnv`) — never read from process.env.
 *   - `projectRoot` is INJECTED (ctx.cwd) and `slug` is REQUIRED on every write/
 *     read path — no server-internal active-slug detection.
 *
 * Scope is intentionally locked: depot is Local, only asset_type 3 (bgm) and 7
 * (sfx) are addressable. "Attach" = download the COS blob into the current
 * game's `.forgeax/games/<slug>/audio/` and upsert `audio/manifest.json`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, relative, basename, extname } from 'node:path';

/** Upstream gateway config — injected from the host-filtered env. */
export interface BgmConfig {
  backendBase: string;
  sandboxKey: string;
  depot: string;
}

export type AudioKind = 'bgm' | 'sfx';
const KIND_TO_TYPE: Record<AudioKind, number> = { bgm: 3, sfx: 7 };
const TYPE_TO_KIND: Record<number, AudioKind> = { 3: 'bgm', 7: 'sfx' };
export const AUDIO_ASSET_TYPES = [3, 7] as const;

const MANIFEST_VERSION = 1;
const MAX_AUDIO_BYTES = 64 * 1024 * 1024; // 64 MB safety ceiling per blob

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

// ── upstream content-server proxy ────────────────────────────────────────

interface VersionLike {
  version_name?: string;
  display_version_name?: string;
  res_url?: string;
  state?: number;
  update_time?: number | string;
  create_time?: number | string;
}
interface AssetMetaLike {
  id?: string;
  asset_id?: string;
  name?: string;
  display_name?: string;
  type?: number;
  description?: string;
  versions?: VersionLike[];
}

/** wb-bgm is read + attach only — the raw passthrough may only reach READ RPCs
 *  of the content server, never mutate the shared library. */
export const ALLOWED_ENDPOINTS = new Set(['FindAssetMeta', 'HybridSearch', 'Search']);

/**
 * Raw passthrough to the Local content server. `endpoint` is one of the
 * upstream RPC method names (FindAssetMeta / HybridSearch / Search). The
 * X-Sandbox-Key header + base URL are injected here so neither the SPA nor the
 * AI tool ever needs the credential.
 */
export async function callBackend(
  cfg: BgmConfig,
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(endpoint)) {
    throw new BgmError('invalid-endpoint', `illegal backend endpoint: ${endpoint}`, 400);
  }
  if (!cfg.backendBase) {
    throw new BgmError(
      'backend-not-configured',
      'wb-bgm backend not configured — set WB_BGM_BACKEND_BASE (and WB_BGM_SANDBOX_KEY) in $ROOT/.env; see .env.example',
      503,
    );
  }
  let resp: Response;
  try {
    resp = await fetch(`${cfg.backendBase}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Sandbox-Key': cfg.sandboxKey },
      body: JSON.stringify(payload ?? {}),
    });
  } catch (e) {
    throw new BgmError('backend-unreachable', `content server unreachable: ${(e as Error).message}`, 502);
  }
  const text = await resp.text();
  if (!resp.ok) {
    throw new BgmError('backend-error', `backend ${endpoint} → HTTP ${resp.status}`, 502, text.slice(0, 500));
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new BgmError('backend-bad-json', `backend ${endpoint} returned non-JSON`, 502, text.slice(0, 200));
  }
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
  kind: AudioKind;
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
  cfg: BgmConfig,
  opts: { query?: string; kind?: AudioKind; limit?: number },
): Promise<AudioResult[]> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
  const types = opts.kind ? [KIND_TO_TYPE[opts.kind]] : [...AUDIO_ASSET_TYPES];
  const out: AudioResult[] = [];
  for (const asset_type of types) {
    const query: Record<string, unknown> = { depot_name: cfg.depot, asset_type };
    if (opts.query) query.tag = opts.query;
    const d = await callBackend(cfg, 'FindAssetMeta', {
      query,
      pagination: { page_num: 1, page_size: limit, is_need_total_num: true },
    });
    const list = (d.asset_meta_info_list as AssetMetaLike[] | undefined) ?? [];
    for (const m of list) {
      const n = normalize(m);
      if (n) out.push(n);
    }
  }
  return out.slice(0, limit);
}

// ── game-side write path (download + manifest) ───────────────────────────

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

function gameRoot(projectRoot: string, slug: string): string {
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
    return {
      version: parsed.version ?? MANIFEST_VERSION,
      slug: resolved,
      tracks: Array.isArray(parsed.tracks) ? (parsed.tracks as ManifestTrack[]) : [],
    };
  } catch {
    return { version: MANIFEST_VERSION, slug: resolved, tracks: [] };
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
  kind: AudioKind;
  version?: string;
  resUrl: string;
  filename?: string;
  addedBy?: 'human' | 'ai';
  /** Depot label recorded on the manifest track (from BgmConfig.depot). */
  depot?: string;
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
 * Download a COS audio blob into `<game>/audio/` and upsert the matching
 * `audio/manifest.json` entry. Idempotent on assetId.
 */
export async function attachAudio(input: AttachInput): Promise<AttachResult> {
  const { projectRoot, assetId, kind, resUrl } = input;
  if (!assetId) throw new BgmError('missing-asset-id', 'assetId is required', 400);
  if (!resUrl) throw new BgmError('missing-res-url', 'resUrl (COS download url) is required', 400);
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

  const manifest = await readManifest(projectRoot, slug);
  const existing = manifest.tracks.find((t) => t.assetId === assetId);

  let fileRel: string;
  if (existing) {
    fileRel = existing.file;
  } else {
    let fname = safeFilename(input.filename || input.name || assetId, resUrl);
    const ownedByOther = (f: string) =>
      manifest.tracks.some((t) => t.file === `audio/${f}` && t.assetId !== assetId);
    if (ownedByOther(fname) || existsSync(resolve(audioDir, fname))) {
      const ext = extname(fname);
      const stem = fname.slice(0, fname.length - ext.length);
      fname = `${stem}-${assetId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6) || 'x'}${ext}`;
    }
    fileRel = `audio/${fname}`;
  }
  const abs = resolve(root, fileRel);

  let resp: Response;
  try {
    resp = await fetch(resUrl);
  } catch (e) {
    throw new BgmError('download-failed', `COS fetch failed: ${(e as Error).message}`, 502);
  }
  if (!resp.ok) throw new BgmError('download-failed', `COS returned HTTP ${resp.status}`, 502);
  const bytes = Buffer.from(await resp.arrayBuffer());
  if (bytes.length === 0) throw new BgmError('empty-download', 'downloaded 0 bytes', 502);
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw new BgmError('too-large', `audio exceeds ${MAX_AUDIO_BYTES} byte ceiling`, 413);
  }

  await mkdir(audioDir, { recursive: true });
  const reused = existsSync(abs);
  await writeFile(abs, bytes);

  const track: ManifestTrack = {
    assetId,
    name: input.name || basename(fileRel),
    kind,
    file: fileRel,
    version: input.version || '',
    source: input.depot || 'aw',
    addedBy: input.addedBy === 'ai' ? 'ai' : 'human',
    addedAt: new Date().toISOString(),
  };
  const idx = manifest.tracks.findIndex((t) => t.assetId === assetId);
  if (idx >= 0) manifest.tracks[idx] = track;
  else manifest.tracks.push(track);
  manifest.version = MANIFEST_VERSION;
  manifest.slug = slug;

  for (const t of manifest.tracks) {
    delete (t as { url?: string }).url;
  }

  await writeFile(manifestPath(projectRoot, slug), JSON.stringify(manifest, null, 2) + '\n');

  return {
    ok: true,
    slug,
    assetId,
    kind,
    file: fileRel,
    path: relative(projectRoot, abs),
    url: resUrl,
    bytes: bytes.length,
    manifest: relative(projectRoot, manifestPath(projectRoot, slug)),
    reused,
  };
}
