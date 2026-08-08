/**
 * wb-bgm `entry.backend` for the Host ToolRegistry.
 *
 * The extension manifest's `contributes.tools[]` lists the bgm tool ids; this
 * module is the dispatch map ToolRegistry dynamic-imports (it reads `mod.tools`
 * or `mod.default`). It runs IN the server process, so:
 *   - AI callers reach `search-audio` / `attach-audio` / `list-audio` via the
 *     native host_tool_bridge and the CLI providers' forgeax-tools MCP.
 *   - the vendored SPA (human) reaches `bgm:backend` (raw library passthrough,
 *     exposedToAI:false) and the same three tools via POST /api/tools/call.
 *
 * Sandbox contract (registry.ts §270): the project root arrives via the
 * per-call context. `ctx.cwd` is the plugin dir (not the project root), so the
 * project root comes from `ctx.projectRoot` or `ctx.env.FORGEAX_PROJECT_ROOT`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  attachAudio,
  attachGeneratedAudio,
  BgmError,
  readManifest,
  searchAudio,
  type AudioKind,
  type BgmConfig,
  gameRoot,
} from './core.ts';
import { localAudioLibrary } from './local-audio-library.ts';
import {
  changeCustomAudioKind,
  deleteCustomAudio,
  importCustomAudio,
  listCustomAudio,
  resolveCustomAudio,
  type CustomAudioKind,
  type ImportCustomAudioArgs,
} from './custom-audio-library.ts';
import { searchAudioV2, type SearchAudioV2Options } from './search-v2.ts';
import { searchBgm, type SearchBgmOptions } from './search-bgm.ts';
import {
  resolveAudioPlan,
  type ResolveAudioPlanOptions,
} from './resolve-audio-plan.ts';
import {
  applyAudioPlan,
  type ApplyAudioPlanOptions,
} from './apply-audio-plan.ts';
import { inspectAudioEvents } from './audio-event-inspector.ts';
import {
  patchAudioProject,
  readAppliedAudioProject,
  readAudioProject,
  writeAppliedAudioProject,
  type PatchAudioProjectArgs,
} from './audio-project-store.ts';
import { compileAudioRuntime } from './audio-runtime-compiler.ts';
import { verifyAudioProject } from './audio-project-verify.ts';

interface ToolCtx {
  caller: { kind: string; id?: string };
  toolId: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  projectRoot?: string;
  game?: string;
}

function libraryConfig(ctx: ToolCtx): BgmConfig {
  void ctx;
  return { depot: 'builtin' };
}

/** Project root holding `.forgeax/games`. The handler runs in the server
 *  process, where FORGEAX_PROJECT_ROOT is the instance root (run.sh / .app). */
function projectRootOf(ctx: ToolCtx): string {
  return ctx.projectRoot ?? ctx.env?.FORGEAX_PROJECT_ROOT ?? process.cwd();
}

function slugOf(args: { slug?: string }, ctx: ToolCtx): string {
  const slug = String(args.slug ?? ctx.game ?? '').trim();
  if (!slug) throw new BgmError('slug-required', 'slug is required (explicit; no auto-detect)', 400);
  gameRoot(projectRootOf(ctx), slug);
  return slug;
}

function audioProjectLocation(args: { slug?: string; projectId?: string }, ctx: ToolCtx) {
  const slug = slugOf(args, ctx);
  return {
    slug,
    projectId: String(args.projectId ?? slug).trim() || slug,
    gameDir: gameRoot(projectRootOf(ctx), slug),
  };
}

function asKind(v: unknown): AudioKind | undefined {
  return v === 'bgm' || v === 'sfx' || v === 'voice' ? v : undefined;
}

interface SearchArgs { query?: string; kind?: string; limit?: number }
type SearchV2Args = SearchAudioV2Options;
type SearchBgmArgs = SearchBgmOptions;
type ResolvePlanArgs = ResolveAudioPlanOptions;
type ApplyPlanArgs = ApplyAudioPlanOptions;
interface AttachArgs {
  assetId?: string; kind?: string; slug?: string;
  name?: string; version?: string; filename?: string;
  shaping?: import('../shared/audio-project.ts').AudioShapingParams;
}
interface SaveGeneratedArgs {
  slug?: string;
  assetId?: string;
  name?: string;
  kind?: string;
  base64?: string;
  mimeType?: string;
  filename?: string;
  provider?: string;
  model?: string;
}
interface ListArgs { slug?: string }
interface BackendArgs { endpoint?: string; payload?: Record<string, unknown> }
interface ListCustomAudioArgs { kind?: CustomAudioKind }
interface DeleteCustomAudioArgs { assetId?: string }
interface ChangeCustomAudioKindArgs { assetId?: string; kind?: CustomAudioKind }
interface AudioProjectArgs { slug?: string; projectId?: string }
interface PatchProjectArgs extends Partial<PatchAudioProjectArgs> { slug?: string }
interface ApplyProjectArgs extends AudioProjectArgs { expectedRevision?: number }

const tools = {
  'search-audio': async (args: SearchArgs, ctx: ToolCtx) => {
    if (ctx.caller?.kind === 'ai' && args.kind !== 'bgm') {
      throw new BgmError(
        'sfx-audio-plan-required',
        'AI SFX search must use resolve-audio-plan',
        400,
      );
    }
    const requestedKind = asKind(args.kind);
    const results = await searchAudio(libraryConfig(ctx), {
      query: args.query || undefined,
      kind: requestedKind === 'voice' ? undefined : requestedKind,
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    });
    return { ok: true, count: results.length, results };
  },

  'search-audio-v2': async (args: SearchV2Args, ctx: ToolCtx) => {
    return await searchAudioV2(
      libraryConfig(ctx),
      args,
      projectRootOf(ctx),
      ctx.caller?.kind === 'ai',
    );
  },

  'search-bgm': async (args: SearchBgmArgs, ctx: ToolCtx) => {
    return await searchBgm(
      libraryConfig(ctx),
      args,
      projectRootOf(ctx),
      ctx.caller?.kind === 'ai',
    );
  },

  'resolve-audio-plan': async (args: ResolvePlanArgs, ctx: ToolCtx) => {
    return await resolveAudioPlan(libraryConfig(ctx), args, projectRootOf(ctx));
  },

  'apply-audio-plan': async (args: ApplyPlanArgs, ctx: ToolCtx) => {
    return await applyAudioPlan(
      libraryConfig(ctx),
      args,
      projectRootOf(ctx),
      ctx.caller?.kind === 'ai' ? 'ai' : 'human',
    );
  },

  'inspect-audio-events': async (args: AudioProjectArgs, ctx: ToolCtx) => {
    const { gameDir } = audioProjectLocation(args, ctx);
    return await inspectAudioEvents(gameDir);
  },

  'get-audio-project': async (args: AudioProjectArgs, ctx: ToolCtx) => {
    const { gameDir, projectId } = audioProjectLocation(args, ctx);
    const [project, applied] = await Promise.all([
      readAudioProject(gameDir, projectId),
      readAppliedAudioProject(gameDir, projectId),
    ]);
    return { project, appliedRevision: applied?.revision ?? null };
  },

  'patch-audio-project': async (args: PatchProjectArgs, ctx: ToolCtx) => {
    const { gameDir, projectId } = audioProjectLocation(args, ctx);
    const project = await patchAudioProject(gameDir, {
      projectId,
      expectedRevision: Number(args.expectedRevision),
      upsertBindings: args.upsertBindings,
      removeEventIds: args.removeEventIds,
    });
    return { project };
  },

  'apply-audio-project': async (args: ApplyProjectArgs, ctx: ToolCtx) => {
    const { gameDir, projectId } = audioProjectLocation(args, ctx);
    const project = await readAudioProject(gameDir, projectId);
    const expectedRevision = Number(args.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw Object.assign(new Error('expectedRevision must be a non-negative integer'), { code: 'bad_input' });
    }
    if (project.revision !== expectedRevision) {
      throw Object.assign(
        new Error(`audio project revision changed from ${expectedRevision} to ${project.revision}`),
        { code: 'revision_conflict', actualRevision: project.revision },
      );
    }
    const runtimeSource = await readFile(join(ctx.cwd ?? '', 'runtime/forgeax-audio-runtime.ts'), 'utf8');
    const compiled = await compileAudioRuntime(gameDir, project, runtimeSource);
    const applied = await writeAppliedAudioProject(gameDir, project);
    return { project: applied, files: compiled.files };
  },

  'verify-audio-project': async (args: AudioProjectArgs, ctx: ToolCtx) => {
    const { gameDir, projectId } = audioProjectLocation(args, ctx);
    const project = await readAppliedAudioProject(gameDir, projectId)
      ?? await readAudioProject(gameDir, projectId);
    return await verifyAudioProject(gameDir, project, { requireRuntime: project.status === 'applied' });
  },

  'attach-audio': async (args: AttachArgs, ctx: ToolCtx) => {
    const kind = asKind(args.kind);
    if (kind !== 'bgm' && kind !== 'sfx') throw Object.assign(new Error("kind must be 'bgm' or 'sfx'"), { code: 'invalid-kind' });
    const projectRoot = projectRootOf(ctx);
    const resolved = await localAudioLibrary.resolveAsset(args.assetId ?? '')
      ?? await resolveCustomAudio(projectRoot, args.assetId ?? '');
    if (!resolved) {
      throw new BgmError('asset-not-found', 'assetId is not present in the packaged audio library', 404);
    }
    if (resolved.kind !== kind) {
      throw new BgmError('invalid-kind', `asset kind is '${resolved.kind}', not '${kind}'`, 400);
    }
    const cfg = libraryConfig(ctx);
    return await attachAudio({
      projectRoot,
      slug: args.slug,
      assetId: args.assetId ?? '',
      name: args.name ?? resolved.fileName,
      kind,
      version: args.version ?? resolved.version,
      resUrl: resolved.previewUrl,
      sourcePath: resolved.absolutePath,
      filename: args.filename ?? resolved.fileName,
      shaping: args.shaping,
      depot: args.assetId?.startsWith('custom:') ? 'custom' : cfg.depot,
      addedBy: ctx.caller?.kind === 'ai' ? 'ai' : 'human',
    });
  },

  'import-custom-audio': async (args: ImportCustomAudioArgs, ctx: ToolCtx) => {
    const { asset, duplicate } = await importCustomAudio(args, projectRootOf(ctx));
    return { asset, duplicate };
  },

  'list-custom-audio': async (args: ListCustomAudioArgs, ctx: ToolCtx) => {
    return await listCustomAudio(projectRootOf(ctx), args.kind);
  },

  'delete-custom-audio': async (args: DeleteCustomAudioArgs, ctx: ToolCtx) => {
    const assetId = String(args.assetId ?? '');
    if (!/^custom:(bgm|sfx):sha256:[a-f0-9]{64}$/.test(assetId)) {
      throw new BgmError('asset-not-found', 'custom assetId is not registered', 404);
    }
    const deleted = await deleteCustomAudio(projectRootOf(ctx), assetId);
    return { deleted, assetId };
  },

  'change-custom-audio-kind': async (args: ChangeCustomAudioKindArgs, ctx: ToolCtx) => {
    const assetId = String(args.assetId ?? '');
    if (!/^custom:(bgm|sfx):sha256:[a-f0-9]{64}$/.test(assetId)) {
      throw new BgmError('asset-not-found', 'custom assetId is not registered', 404);
    }
    if (args.kind !== 'bgm' && args.kind !== 'sfx') {
      throw new BgmError('invalid-kind', "kind must be exactly 'bgm' or 'sfx'", 400);
    }
    return await changeCustomAudioKind(projectRootOf(ctx), assetId, args.kind);
  },

  'save-generated-audio': async (args: SaveGeneratedArgs, ctx: ToolCtx) => {
    const kind = asKind(args.kind);
    if (!kind) {
      throw Object.assign(new Error("kind must be 'bgm', 'sfx', or 'voice'"), { code: 'invalid-kind' });
    }
    return await attachGeneratedAudio({
      projectRoot: projectRootOf(ctx),
      slug: args.slug,
      assetId: args.assetId ?? '',
      name: args.name ?? '',
      kind,
      base64: args.base64 ?? '',
      mimeType: args.mimeType,
      filename: args.filename,
      provider: args.provider,
      model: args.model,
      addedBy: ctx.caller?.kind === 'ai' ? 'ai' : 'human',
    });
  },

  'list-audio': async (args: ListArgs, ctx: ToolCtx) => {
    return await readManifest(projectRootOf(ctx), args.slug);
  },

  // Compatibility surface for the vendored SPA (exposedToAI:false).
  'bgm:backend': async (args: BackendArgs, ctx: ToolCtx) => {
    void ctx;
    const endpoint = args.endpoint ?? '';
    const payload = args.payload ?? {};
    if (endpoint !== 'FindAssetMeta') {
      throw Object.assign(new Error(`wb-bgm is read-only; '${endpoint}' is not allowed`), { code: 'forbidden-endpoint' });
    }
    const query = (payload as {
      query?: { asset_type?: number; tag?: string };
      pagination?: { page_num?: number; page_size?: number };
    }).query;
    if (query?.asset_type != null && query.asset_type !== 3 && query.asset_type !== 7) {
      throw Object.assign(new Error('wb-bgm only serves audio(3) and sfx(7)'), { code: 'forbidden-asset-type' });
    }
    const pagination = (payload as {
      pagination?: { page_num?: number; page_size?: number };
    }).pagination;
    const result = await localAudioLibrary.findAssets({
      kind: query?.asset_type === 3 ? 'bgm' : query?.asset_type === 7 ? 'sfx' : undefined,
      query: query?.tag,
      page: Number(pagination?.page_num) || 1,
      pageSize: Number(pagination?.page_size) || 20,
    });
    return { asset_meta_info_list: result.assets, total: result.total };
  },
};

export default tools;
