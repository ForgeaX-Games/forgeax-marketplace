import type { GlobalState } from '../state/GlobalState';

/* PostMessage protocol — see docs/v2-vision/modules/16-three-pane-embedding.md §4 */
type StudioToPanel =
  | { type: 'STUDIO_INIT'; ctx: unknown; pane: 'left' | 'center' }
  | { type: 'STUDIO_CTX_UPDATE'; ctx: unknown }
  | { type: 'SURFACE_DISPATCH'; id: string; toolId: string; args: unknown }
  | { type: 'STUDIO_RELOAD'; reason?: string };

type PanelToStudio =
  | { type: 'PANEL_READY'; pluginId: string; pane: 'left' | 'center' }
  | { type: 'PANEL_BUS_CALL'; reqId: string; toolId: string; args: unknown }
  | { type: 'PANEL_SURFACE_PATCH'; id: string; snapshot: Record<string, unknown> }
  | { type: 'PANEL_NAVIGATE'; subTab: string };

interface Opts {
  pluginId: string;
  surfaceId: string;
  pane: 'left' | 'center' | 'standalone';
  state: GlobalState;
}

export class Bridge {
  private pending = new Map<string, (v: unknown) => void>();
  private embedded: boolean;

  constructor(private readonly opts: Opts) {
    this.embedded = opts.pane !== 'standalone' && window.parent !== window;
    if (this.embedded) {
      window.addEventListener('message', (e) => this.onMessage(e.data));
    }
  }

  announceReady() {
    if (!this.embedded) return;
    this.post({
      type: 'PANEL_READY',
      pluginId: this.opts.pluginId,
      pane: this.opts.pane as 'left' | 'center',
    });
  }

  /** Call a server-side tool. In embedded mode goes via host postMessage,
   *  in standalone mode goes direct to fetch. */
  async callTool(toolId: string, args: unknown): Promise<unknown> {
    if (this.embedded) {
      const reqId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        this.pending.set(reqId, (v) => {
          const r = v as { result?: unknown; error?: string };
          if (r.error) reject(new Error(r.error));
          else resolve(r.result);
        });
        this.post({ type: 'PANEL_BUS_CALL', reqId, toolId, args });
      });
    }
    // standalone: hit local dev API
    const res = await fetch(`/api/bus/tools/${encodeURIComponent(toolId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args }),
    });
    if (!res.ok) throw new Error(`tool ${toolId} → ${res.status}`);
    return await res.json();
  }

  /** Push current snapshot to host so it persists into bus surface. */
  pushSurfaceSnapshot(snapshot: Record<string, unknown>) {
    if (this.embedded) {
      this.post({ type: 'PANEL_SURFACE_PATCH', id: this.opts.surfaceId, snapshot });
    } else {
      fetch(`/api/bus/ui/surfaces/${encodeURIComponent(this.opts.surfaceId)}/snapshot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      }).catch(() => {/* standalone w/o studio backend — ignore */});
    }
  }

  private post(msg: PanelToStudio) {
    window.parent.postMessage(msg, '*');
  }

  private onMessage(msg: StudioToPanel | { type: 'PANEL_BUS_RESULT'; reqId: string; result?: unknown; error?: string }) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'PANEL_BUS_RESULT') {
      const cb = this.pending.get(msg.reqId);
      if (cb) {
        this.pending.delete(msg.reqId);
        cb(msg);
      }
      return;
    }

    if (msg.type === 'STUDIO_INIT') {
      // ctx contains theme/lang/project — extend GlobalState if you need them
      return;
    }

    if (msg.type === 'SURFACE_DISPATCH') {
      this.opts.state.applyRemote({ lastResult: `dispatched: ${msg.toolId}` });
      return;
    }

    if (msg.type === 'STUDIO_RELOAD') {
      location.reload();
      return;
    }
  }
}
