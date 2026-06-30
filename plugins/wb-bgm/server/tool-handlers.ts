/**
 * wb-bgm `entry.backend` for the Host ToolRegistry.
 *
 * The forgeax-plugin manifest's `provides.tools[]` lists the bgm tool ids; this
 * module is the dispatch map ToolRegistry dynamic-imports (it reads `mod.tools`
 * or `mod.default`). It runs IN the server process, so:
 *   - AI callers reach `search-audio` / `attach-audio` / `list-audio` via the
 *     native host_tool_bridge and the CLI providers' forgeax-tools MCP.
 *   - the vendored SPA (human) reaches `bgm:backend` (raw library passthrough,
 *     exposedToAI:false) and the same three tools via POST /api/tools/call.
 *
 * Sandbox contract (registry.ts §270): secrets + project root arrive via the
 * per-call `ctx.env` (filtered to the manifest's `requestedEnv`); NEVER read
 * `process.env` directly. `ctx.cwd` is the plugin dir (not the project root),
 * so the project root comes from `ctx.env.FORGEAX_PROJECT_ROOT`.
 */

import {
  ALLOWED_ENDPOINTS,
  AUDIO_ASSET_TYPES,
  attachAudio,
  callBackend,
  readManifest,
  searchAudio,
  type AudioKind,
  type BgmConfig,
} from './core.ts';

interface ToolCtx {
  caller: { kind: string; id?: string };
  toolId: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
}

function cfgFromEnv(ctx: ToolCtx): BgmConfig {
  const env = ctx.env ?? {};
  return {
    backendBase: (env.WB_BGM_BACKEND_BASE ?? '').replace(/\/$/, ''),
    sandboxKey: env.WB_BGM_SANDBOX_KEY ?? '',
    depot: env.WB_BGM_DEPOT ?? 'aw',
  };
}

/** Project root holding `.forgeax/games`. The handler runs in the server
 *  process, where FORGEAX_PROJECT_ROOT is the instance root (run.sh / .app). */
function projectRootOf(ctx: ToolCtx): string {
  return ctx.env?.FORGEAX_PROJECT_ROOT ?? process.cwd();
}

function asKind(v: unknown): AudioKind | undefined {
  return v === 'bgm' || v === 'sfx' ? v : undefined;
}

interface SearchArgs { query?: string; kind?: string; limit?: number }
interface AttachArgs {
  assetId?: string; kind?: string; resUrl?: string; slug?: string;
  name?: string; version?: string; filename?: string;
}
interface ListArgs { slug?: string }
interface BackendArgs { endpoint?: string; payload?: Record<string, unknown> }

const tools = {
  'search-audio': async (args: SearchArgs, ctx: ToolCtx) => {
    const results = await searchAudio(cfgFromEnv(ctx), {
      query: args.query || undefined,
      kind: asKind(args.kind),
      limit: typeof args.limit === 'number' ? args.limit : undefined,
    });
    return { ok: true, count: results.length, results };
  },

  'attach-audio': async (args: AttachArgs, ctx: ToolCtx) => {
    const kind = asKind(args.kind);
    if (!kind) throw Object.assign(new Error("kind must be 'bgm' or 'sfx'"), { code: 'invalid-kind' });
    const cfg = cfgFromEnv(ctx);
    return await attachAudio({
      projectRoot: projectRootOf(ctx),
      slug: args.slug,
      assetId: args.assetId ?? '',
      name: args.name,
      kind,
      version: args.version,
      resUrl: args.resUrl ?? '',
      filename: args.filename,
      depot: cfg.depot,
      addedBy: ctx.caller?.kind === 'ai' ? 'ai' : 'human',
    });
  },

  'list-audio': async (args: ListArgs, ctx: ToolCtx) => {
    return await readManifest(projectRootOf(ctx), args.slug);
  },

  // Raw library passthrough for the vendored SPA (exposedToAI:false). Read-only
  // allowlist + audio/SFX-only guard mirror the old /api/wb/bgm/backend route.
  'bgm:backend': async (args: BackendArgs, ctx: ToolCtx) => {
    const endpoint = args.endpoint ?? '';
    const payload = args.payload ?? {};
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      throw Object.assign(new Error(`wb-bgm is read-only; '${endpoint}' is not allowed`), { code: 'forbidden-endpoint' });
    }
    const query = (payload as { query?: { asset_type?: number } }).query;
    if (query?.asset_type != null && !AUDIO_ASSET_TYPES.includes(query.asset_type as 3 | 7)) {
      throw Object.assign(new Error('wb-bgm only serves audio(3) and sfx(7)'), { code: 'forbidden-asset-type' });
    }
    return await callBackend(cfgFromEnv(ctx), endpoint, payload);
  },
};

export default tools;
