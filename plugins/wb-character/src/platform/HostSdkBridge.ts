/**
 * Phase A4 — host-sdk bridge for wb-character iframe.
 *
 * This is a minimal, inline implementation of @forgeax/host-sdk's
 * `createHost()` client. We don't depend on the package directly because
 * wb-character is its own vite build with separate node_modules; pulling in
 * a workspace package would require either a vite alias setup that survives
 * `npm run dev` and `npm run build`, or symlinks. The HostSdkEnvelope
 * surface is small enough that mirroring it here costs less than that
 * plumbing.
 *
 * Envelope shape MUST stay in sync with
 * `forgeax-studio/packages/types/src/host-sdk.ts`. If a kind is added there,
 * add it here only when wb-character actually needs it.
 *
 * What this exposes (assigned to `window.__forgeaxHost`):
 *   - handshake()           — protocol negotiation; returns { locale, theme, ctx }
 *   - tool.call(toolId,a)   — request the host run a registered tool
 *   - chat.post(text,att)   — push text into the host's chat panel
 *   - surface.expose(...)   — push current UI snapshot + actions
 *   - onSurfaceDispatch(cb) — receive AI/host-driven action requests
 *
 * Phase B-phase replaces this file with a real `import { createHost } from
 * '@forgeax/host-sdk'` once the build pipeline supports it.
 */

type Locale = 'zh' | 'en' | 'ja';
type Theme = 'light' | 'dark';

interface HandshakeResponse {
  kind: 'handshake.response';
  protocol: 1;
  locale: Locale;
  theme: Theme;
  ctx?: { sessionId?: string; threadId?: string; pane?: 'left' | 'center' };
}

interface ToolResultOk {
  ok: true;
  result?: unknown;
  artifacts?: Array<{ path: string; kind?: string; mime?: string }>;
}
interface ToolResultErr {
  ok: false;
  error: string;
  retryable?: boolean;
}
type ToolResult = ToolResultOk | ToolResultErr;

interface SurfaceDispatchEvent {
  surfaceId: string;
  actionId: string;
  args: unknown;
}

let counter = 0;
function genId(): string {
  counter += 1;
  return `e-${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const PLUGIN_ID = '@forgeax-plugin/wb-character';
const FROM = { kind: 'plugin' as const, pluginId: PLUGIN_ID };

interface PendingReq {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  expectedKind: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface ForgeaxHost {
  /** True if the bridge is reachable (we are inside an iframe with a parent). */
  readonly available: boolean;

  handshake(timeoutMs?: number): Promise<HandshakeResponse>;
  tool: { call(toolId: string, args?: unknown, timeoutMs?: number): Promise<ToolResult> };
  chat: { post(text: string, attachments?: string[]): void };
  surface: {
    expose(
      surfaceId: string,
      payload: {
        actions: Array<{ id: string; label?: string; args?: unknown; enabled?: boolean; hotkey?: string }>;
        snapshot?: unknown;
      },
    ): void;
  };
  onSurfaceDispatch(cb: (e: SurfaceDispatchEvent) => Promise<unknown> | unknown): () => void;
  /** Keep-alive panel visibility (host → plugin). `visible:false` means the
   *  studio CSS-hid this iframe (still alive) — pause render loops; `true` =
   *  back on screen. Returns unsubscribe fn. */
  onVisibilityChange(cb: (visible: boolean) => void): () => void;
}

function makeHost(): ForgeaxHost {
  const parent = window.parent;
  const inFrame = parent && parent !== window;
  const pending = new Map<string, PendingReq>();
  const dispatchHandlers = new Set<(e: SurfaceDispatchEvent) => Promise<unknown> | unknown>();
  const visibilityHandlers = new Set<(visible: boolean) => void>();

  function post(env: Record<string, unknown>): void {
    if (!inFrame) return;
    try { parent.postMessage(env, '*'); } catch { /* dead parent */ }
  }

  function send(partial: Record<string, unknown>): string {
    const id = genId();
    post({ v: 1, id, from: FROM, ts: new Date().toISOString(), ...partial });
    return id;
  }

  function request<T>(partial: Record<string, unknown>, expectedKind: string, timeoutMs = 10_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = genId();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`host-sdk timeout: ${String(partial.kind)} expecting ${expectedKind}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        expectedKind,
        timer,
      });
      post({ v: 1, id, from: FROM, ts: new Date().toISOString(), ...partial });
    });
  }

  function reply(replyTo: string, partial: Record<string, unknown>): void {
    post({ v: 1, id: genId(), replyTo, from: FROM, ts: new Date().toISOString(), ...partial });
  }

  if (inFrame) {
    window.addEventListener('message', (e) => {
      if (e.source !== parent) return;
      const env = e.data as Record<string, unknown> | null;
      if (!env || typeof env !== 'object') return;
      const kind = env.kind;
      if (typeof kind !== 'string') return;

      // Reply path — match by replyTo.
      const replyToId = typeof env.replyTo === 'string' ? env.replyTo : null;
      if (replyToId) {
        const p = pending.get(replyToId);
        if (p) {
          if (kind === p.expectedKind) {
            clearTimeout(p.timer);
            pending.delete(replyToId);
            p.resolve(env);
            return;
          }
          clearTimeout(p.timer);
          pending.delete(replyToId);
          p.reject(new Error(`host-sdk: unexpected reply kind ${kind}, want ${p.expectedKind}`));
        }
      }

      // visibility.changed — keep-alive panel show/hide signal (fire-and-forget).
      if (kind === 'visibility.changed') {
        const visible = env.visible !== false;
        for (const h of [...visibilityHandlers]) {
          try { h(visible); } catch { /* handler threw — ignore */ }
        }
        return;
      }

      // surface.dispatch — invoke local handlers, ack with surface.ack.
      if (kind === 'surface.dispatch') {
        const surfaceId = String(env.surfaceId ?? '');
        const actionId = String(env.actionId ?? '');
        const args = env.args;
        const awaitAck = env.awaitAck !== false;
        const id = typeof env.id === 'string' ? env.id : null;
        Promise.resolve()
          .then(async () => {
            for (const h of [...dispatchHandlers]) {
              const out = await h({ surfaceId, actionId, args });
              if (awaitAck && id) {
                reply(id, { kind: 'surface.ack', surfaceId, ok: true, result: out });
              }
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
      }
    });
  }

  return {
    available: !!inFrame,
    handshake(timeoutMs) {
      return request<HandshakeResponse>(
        { kind: 'handshake.request', protocols: [1] },
        'handshake.response',
        timeoutMs,
      );
    },
    tool: {
      async call(toolId, args, timeoutMs) {
        // caller.kind MUST be one of the @forgeax/types ToolCallSchema enum
        // ('user'|'ai'|'skill'|'workbench'|'cli') — 'plugin' is NOT valid there
        // and makes the host RpcChannel drop the whole tool.call envelope on
        // schema validation, so no tool.result ever comes back (the call hangs
        // until timeout). The host overrides this to {kind:'workbench',agentId}
        // anyway; we mirror that so the envelope passes validation.
        const resp = await request<{ kind: 'tool.result'; result: ToolResult }>(
          { kind: 'tool.call', call: { toolId, args, caller: { kind: 'workbench', agentId: PLUGIN_ID } } },
          'tool.result',
          timeoutMs,
        );
        return resp.result;
      },
    },
    chat: {
      post(text, attachments) {
        send({ kind: 'chat.post', text, attachments });
      },
    },
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
          })),
          snapshot: payload.snapshot,
        });
      },
    },
    onSurfaceDispatch(cb) {
      dispatchHandlers.add(cb);
      return () => dispatchHandlers.delete(cb);
    },
    onVisibilityChange(cb) {
      visibilityHandlers.add(cb);
      return () => visibilityHandlers.delete(cb);
    },
  };
}

export const forgeaxHost: ForgeaxHost = makeHost();

declare global {
  interface Window { __forgeaxHost?: ForgeaxHost }
}

(window as Window).__forgeaxHost = forgeaxHost;
