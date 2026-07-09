/**
 * host-sdk bridge for the wb-observatory iframe.
 *
 * Minimal inline mirror of @forgeax/host-sdk's `createHost()` client — same
 * pattern wb-character/wb-anim/wb-skill use. The plugin is its own vite build
 * with separate node_modules, so it can't import the workspace package directly
 * (a build-surviving vite alias / symlink costs more than mirroring the small
 * envelope surface here). Envelope shape MUST stay in sync with
 * `@forgeax/types` (`packages/contracts/types/src/host-sdk.ts`).
 *
 * What this exposes:
 *   - surface.expose(surfaceId, { actions, snapshot })  — actions carrying a
 *     `capability` get registered into the host ActionRegistry (AI-invokable);
 *     others stay overlay-only (see todo 003).
 *   - onSurfaceDispatch(cb)  — receive AI/host-driven action requests, auto-ack.
 *
 * This replaces the retired `VAG_ACTION_*` `plugin-actions.ts` helper: one
 * host↔plugin action channel (host-sdk surface) across the whole repo.
 */

type SurfaceActionCapability =
  | 'read' | 'write' | 'delete' | 'exec' | 'network' | 'credential' | 'delegate' | 'other';

interface SurfaceDispatchEvent {
  surfaceId: string;
  actionId: string;
  args: unknown;
}

interface ExposeAction {
  id: string;
  label?: string;
  args?: unknown;
  enabled?: boolean;
  hotkey?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  capability?: SurfaceActionCapability;
}

let counter = 0;
function genId(): string {
  counter += 1;
  return `e-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const PLUGIN_ID = '@forgeax-plugin/wb-observatory';
const FROM = { kind: 'plugin' as const, pluginId: PLUGIN_ID };

export interface ObservatoryHost {
  /** True if reachable (inside an iframe with a parent host). */
  readonly available: boolean;
  surface: {
    expose(surfaceId: string, payload: { actions: ExposeAction[]; snapshot?: unknown }): void;
  };
  onSurfaceDispatch(cb: (e: SurfaceDispatchEvent) => Promise<unknown> | unknown): () => void;
}

function makeHost(): ObservatoryHost {
  const parent = window.parent;
  const inFrame = parent && parent !== window;
  const dispatchHandlers = new Set<(e: SurfaceDispatchEvent) => Promise<unknown> | unknown>();

  function post(env: Record<string, unknown>): void {
    if (!inFrame) return;
    try { parent.postMessage(env, '*'); } catch { /* dead parent */ }
  }
  function send(partial: Record<string, unknown>): void {
    post({ v: 1, id: genId(), from: FROM, ts: new Date().toISOString(), ...partial });
  }
  function reply(replyTo: string, partial: Record<string, unknown>): void {
    post({ v: 1, id: genId(), replyTo, from: FROM, ts: new Date().toISOString(), ...partial });
  }

  if (inFrame) {
    window.addEventListener('message', (e) => {
      if (e.source !== parent) return;
      const env = e.data as Record<string, unknown> | null;
      if (!env || typeof env !== 'object' || env.kind !== 'surface.dispatch') return;
      const surfaceId = String(env.surfaceId ?? '');
      const actionId = String(env.actionId ?? '');
      const args = env.args;
      const awaitAck = env.awaitAck !== false;
      const id = typeof env.id === 'string' ? env.id : null;
      Promise.resolve()
        .then(async () => {
          for (const h of [...dispatchHandlers]) {
            const out = await h({ surfaceId, actionId, args });
            if (awaitAck && id) reply(id, { kind: 'surface.ack', surfaceId, ok: true, result: out });
          }
        })
        .catch((err: unknown) => {
          if (awaitAck && id) {
            reply(id, {
              kind: 'surface.ack',
              surfaceId,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
    });
  }

  return {
    available: !!inFrame,
    surface: {
      expose(surfaceId, payload) {
        send({
          kind: 'surface.expose',
          surfaceId,
          actions: payload.actions.map((a) => ({
            id: a.id,
            label: a.label,
            args: a.args,
            enabled: a.enabled ?? true,
            hotkey: a.hotkey,
            description: a.description,
            inputSchema: a.inputSchema,
            capability: a.capability,
          })),
          snapshot: payload.snapshot,
        });
      },
    },
    onSurfaceDispatch(cb) {
      dispatchHandlers.add(cb);
      return () => dispatchHandlers.delete(cb);
    },
  };
}

export type { SurfaceActionCapability, ExposeAction };
export const forgeaxHost: ObservatoryHost = makeHost();
