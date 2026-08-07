import {
  HUMAN_SEARCH_SCHEMA,
  type AudioWorkbenchMessage,
} from './humanSearchTypes.ts';

type Listener = (message: AudioWorkbenchMessage) => void;

const LOCAL_EVENT = 'forgeax:wb-bgm:local-message';

function channelIdentity(): { projectId: string; instanceId: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    projectId: params.get('slug') || 'default',
    instanceId: params.get('fxv') || 'standalone',
  };
}

export class AudioWorkbenchChannel {
  readonly projectId: string;
  readonly instanceId: string;
  private channel: BroadcastChannel | null = null;
  private listeners = new Set<Listener>();

  constructor() {
    const identity = channelIdentity();
    this.projectId = identity.projectId;
    this.instanceId = identity.instanceId;
    if ('BroadcastChannel' in window) {
      this.channel = new BroadcastChannel(
        `forgeax:wb-bgm:${this.projectId}:${this.instanceId}`,
      );
      this.channel.addEventListener('message', (event: MessageEvent<unknown>) => {
        this.receive(event.data);
      });
    }
    window.addEventListener(LOCAL_EVENT, this.onLocalMessage as EventListener);
  }

  post(message: AudioWorkbenchMessage): void {
    if (
      message.schemaVersion !== HUMAN_SEARCH_SCHEMA
      || message.projectId !== this.projectId
    ) return;
    this.channel?.postMessage(message);
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: message }));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.channel?.close();
    window.removeEventListener(LOCAL_EVENT, this.onLocalMessage as EventListener);
    this.listeners.clear();
  }

  private onLocalMessage = (event: CustomEvent<unknown>): void => {
    this.receive(event.detail);
  };

  private receive(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const message = value as Partial<AudioWorkbenchMessage>;
    if (
      message.schemaVersion !== HUMAN_SEARCH_SCHEMA
      || message.projectId !== this.projectId
    ) return;
    for (const listener of this.listeners) listener(message as AudioWorkbenchMessage);
  }
}
