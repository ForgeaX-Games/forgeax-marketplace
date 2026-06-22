import type { Bridge } from '../platform/Bridge';

export interface TemplateState {
  prompt: string;
  lastResult: string | null;
  busy: boolean;
}

type Listener = (s: TemplateState) => void;

interface Opts {
  pluginId: string;
  surfaceId: string;
  pane: 'left' | 'center' | 'standalone';
}

const SELF_ID = Math.random().toString(36).slice(2);

export class GlobalState {
  private state: TemplateState = { prompt: '', lastResult: null, busy: false };
  private listeners = new Set<Listener>();
  private channel: BroadcastChannel | null = null;
  private bridge: Bridge | null = null;

  constructor(private readonly opts: Opts) {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(`forgeax-plugin.${opts.pluginId}`);
      this.channel.onmessage = (e) => {
        const { type, patch, source } = e.data ?? {};
        if (source === SELF_ID) return;
        if (type === 'state-patch') this.applyLocal(patch);
      };
    }
  }

  bindBridge(b: Bridge) {
    this.bridge = b;
  }

  get(): TemplateState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /** Local-only state change (e.g. transient UI). Broadcasts to peer iframes,
   *  does NOT push to bus surface — use setBusiness for that. */
  setLocal(patch: Partial<TemplateState>) {
    this.applyLocal(patch);
    this.channel?.postMessage({ type: 'state-patch', patch, source: SELF_ID });
  }

  /** Business state change — broadcasts AND pushes to bus surface so
   *  forgeax-cli sees it. */
  setBusiness(patch: Partial<TemplateState>) {
    this.setLocal(patch);
    this.bridge?.pushSurfaceSnapshot({ ...this.state });
  }

  /** Apply remote patch (from BroadcastChannel or SURFACE_DISPATCH). */
  applyRemote(patch: Partial<TemplateState>) {
    this.applyLocal(patch);
  }

  private applyLocal(patch: Partial<TemplateState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }
}
