/**
 * Phase D3 — wb-character `entry.backend` for ToolRegistry.
 *
 * The forgeax-plugin manifest's `provides.tools[]` lists 12 tool ids; this
 * file is the dispatch map ToolRegistry dynamic-imports to resolve them
 * (`packages/server/src/tools/registry.ts` calls `mod.tools` or
 * `mod.default`). Each handler receives `(args, { caller, toolId })` and
 * returns the tool's result envelope verbatim — ToolRegistry wraps it in
 * `{ ok, result }` and emits `tool.starting/completed/failed` automatically.
 *
 * Five pipelines are wired today by delegating to `@server-lib/character-forge`:
 *
 *   character:generate-portrait   → handlers.generatePortrait
 *   character:generate-sprite-sheet → handlers.generateSpriteSheet
 *   character:list                → handlers.listCharacters
 *   character:get                 → handlers.getCharacter
 *   character:rename              → handlers.renameCharacter
 *
 * The seven AI-only / MCP-backed pipelines (pixel / spine / vfx / monster /
 * video / turnaround / vehicle) are stubbed to return `{ ok: false,
 * code: 'not_implemented' }` so AI / UI callers get a structured signal
 * instead of a 500. They land in subsequent PRs (D6 authoring + the
 * pixel/monster MCP services).
 *
 * Caller story:
 *   - kind=ai/cli/skill/workbench/user — every entry treats its caller as a
 *     trust signal recorded in the ledger event but does not gate access.
 *     ToolRegistry already gates `kind=ai` against `exposedToAI=true`
 *     (which all 12 manifest tools opt into).
 *
 * NOTE on env (gap #2 — sandbox bypass fix):
 *   Handlers in `@server-lib/character-forge` need `{ projectRoot, env }`.
 *   We MUST consume the `env` and `cwd` that ToolRegistry hands us via the
 *   per-call ctx — that env is filtered to keys declared in the plugin
 *   manifest's `requestedEnv` (see registry.ts §240, GAP 5 in 15-coverage).
 *   Reading `process.env` / `process.cwd()` directly here would bypass that
 *   allow-list and the Bus permission layer. Tests in __tests__/tool-handlers
 *   pin this contract: a handler given a ctx env MUST forward it instead of
 *   reaching for the global process.
 *
 *   The legacy `./api-plugin.ts` (Vite plugin) is unrelated to this file; it
 *   stays in place for the standalone dev-server iframe API while
 *   ToolRegistry goes through THIS module.
 */
import { resolve } from 'node:path';
// Resolved relative to this file: marketplace/plugins/wb-character/server/ →
// packages/server/src/lib/character-forge/. We can't use the
// `@server-lib/character-forge` tsconfig alias here because Bun walks up from
// THIS file and lands on the plugin's tsconfig, which does not declare that
// path. Relative import is the contract-friendly fix.
import * as forge from '../../../../server/src/lib/character-forge/index';
import type { ToolCall } from '../../../../types/src/index';
import { dispatchToSurface } from '../../../../server/src/api/bus';

const WB_CHARACTER_SURFACE_ID = 'wb-character.host';

function notifyWorkbenchHost(action: string, payload: Record<string, unknown>): void {
  try {
    dispatchToSurface(WB_CHARACTER_SURFACE_ID, action, payload);
  } catch {
    // iframe 未挂载时静默丢弃；用户切回工作台会自行 refresh
  }
}

interface ToolCtx {
  caller: ToolCall['caller'];
  toolId: string;
  /** Manifest-allow-listed env, supplied by ToolRegistry. Plugin code must
   *  not fall back to `process.env` — that defeats the sandbox. */
  env?: Record<string, string | undefined>;
  /** Plugin install dir, supplied by ToolRegistry. Falls back to cwd only
   *  for unit tests that bypass the registry. */
  cwd?: string;
}

/** Build a `HandlerCtx` from the per-call ToolCtx the registry provides.
 *  The registry passes `env` already filtered to manifest `requestedEnv`,
 *  so handlers downstream see exactly the keys the plugin declared. */
function makeForgeCtx(ctx: ToolCtx): forge.HandlerCtx {
  return {
    projectRoot: resolve(ctx.cwd ?? process.cwd()),
    env: ctx.env ?? {},
  };
}

interface NotImplementedArgs {
  /** Echoed back so the caller can correlate. */
  slug?: string;
}

function notImplemented(toolId: string) {
  return (_args: NotImplementedArgs, _ctx: ToolCtx) => {
    throw Object.assign(new Error(`${toolId} is not implemented in this build`), {
      code: 'not_implemented',
    });
  };
}

interface PortraitArgs {
  slug: string;
  prompt: string;
  style?: forge.GeneratePortraitArgs['style'];
  views?: forge.GeneratePortraitArgs['views'];
  name?: string;
  charId?: string;
  model?: string;
  size?: '1k' | '2k' | '4k';
  refImageBase64?: string;
}

interface SpriteSheetArgs {
  slug: string;
  charId: string;
  action?: 'walk' | 'idle' | 'attack';
  directions?: Array<'down' | 'left' | 'right' | 'up'>;
  framesPerDir?: number;
  frameSize?: 64 | 96 | 128;
  model?: string;
}

interface ListArgs { slug: string }
interface GetArgs { slug: string; charId: string }
interface RenameArgs { slug: string; charId: string; name: string }

export const tools = {
  'character:generate-portrait': async (args: PortraitArgs, _ctx: ToolCtx) => {
    const result = await forge.generatePortrait(makeForgeCtx(_ctx), args as forge.GeneratePortraitArgs);
    notifyWorkbenchHost('reload', { charId: result.charId, slug: args.slug, kind: 'portrait' });
    return result;
  },

  'character:generate-sprite-sheet': async (args: SpriteSheetArgs, _ctx: ToolCtx) => {
    const result = await forge.generateSpriteSheet(makeForgeCtx(_ctx), args as forge.GenerateSpriteSheetArgs);
    notifyWorkbenchHost('reload', { charId: result.charId, slug: args.slug, kind: 'sprite-sheet' });
    return result;
  },

  'character:list': async (args: ListArgs, _ctx: ToolCtx) => {
    const result = await forge.listCharacters(makeForgeCtx(_ctx), args.slug);
    notifyWorkbenchHost('reload', { slug: args.slug, kind: 'list' });
    return result;
  },

  'character:get': async (args: GetArgs, _ctx: ToolCtx) => {
    const result = await forge.getCharacter(makeForgeCtx(_ctx), args.slug, args.charId);
    notifyWorkbenchHost('reload', { slug: args.slug, charId: args.charId, kind: 'get' });
    return result;
  },

  'character:rename': async (args: RenameArgs, _ctx: ToolCtx) => {
    const result = await forge.renameCharacter(makeForgeCtx(_ctx), args.slug, args.charId, args.name);
    notifyWorkbenchHost('reload', { slug: args.slug, charId: args.charId, kind: 'rename' });
    return result;
  },

  'character:generate-pixel':      notImplemented('character:generate-pixel'),
  'character:generate-spine':      notImplemented('character:generate-spine'),
  'character:generate-vfx':        notImplemented('character:generate-vfx'),
  'character:generate-monster':    notImplemented('character:generate-monster'),
  'character:generate-video':      notImplemented('character:generate-video'),
  'character:generate-turnaround': notImplemented('character:generate-turnaround'),
  'character:generate-vehicle':    notImplemented('character:generate-vehicle'),

  // Doc 01 §P4 — host-tool entry points used by wb-character UI when it
  // runs embedded as an iframe. The standalone vite dev server still serves
  // /__ce-api__/<thing> (see ./api-plugin.ts) and the iframe falls through
  // to that path when the host bridge is unavailable. These stubs will be
  // replaced once the host can resolve plugin-local working dirs; for now
  // they preserve the contract so call sites stay auditable via ToolRegistry.
  'character:save-render-config':            notImplemented('character:save-render-config'),
  'character:save-spine-session':            notImplemented('character:save-spine-session'),
  'character:publish-character':             notImplemented('character:publish-character'),
  'character:publish-to-workspace-game':     notImplemented('character:publish-to-workspace-game'),
  'character:merge-skills-to-workspace-game':notImplemented('character:merge-skills-to-workspace-game'),
};

export default tools;
