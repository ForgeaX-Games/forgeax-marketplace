/**
 * 平台通信桥接器
 * 用于 iframe 内的应用与外部 Workbench 宿主通信
 */

export interface AppState {
  status: 'ready' | 'loading' | 'idle' | 'error';
}

export interface PlatformMessage {
  type: 'refresh' | 'search';
  query?: string;
}

type MessageHandler = (msg: PlatformMessage) => void;

export class PlatformBridge {
  private handlers: MessageHandler[] = [];
  private isEmbedded: boolean;

  constructor() {
    this.isEmbedded = window.parent !== window;

    if (this.isEmbedded) {
      window.addEventListener('message', this.handleMessage.bind(this));
    }
  }

  sendReady(): void {
    this.sendToParent({ type: 'ready' });
    // Workbench StudioHost protocol
    this.sendToParent({ type: 'STUDIO_READY' });
  }

  sendStateChange(state: Partial<AppState>): void {
    this.sendToParent({ type: 'stateChange', state });
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  private handleMessage(event: MessageEvent): void {
    const data = event.data;
    if (!data || typeof data.type !== 'string') return;

    // Workbench StudioHost init carries no wb-bgm-actionable payload (env is
    // Local-only; there is no file navigation), so ignore it explicitly.
    if (data.type === 'STUDIO_INIT') return;

    for (const handler of this.handlers) {
      handler(data as PlatformMessage);
    }
  }

  private sendToParent(data: Record<string, unknown>): void {
    if (this.isEmbedded) {
      window.parent.postMessage(data, '*');
    }
  }
}
