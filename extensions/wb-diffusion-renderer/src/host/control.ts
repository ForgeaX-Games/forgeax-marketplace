import {
  clearGameOverrides,
  isStreaming,
  setGameOverrides,
  subscribeStreamStatus,
  type StreamGameOverrides,
  type StreamStatus,
} from './stream';

export interface DiffusionRendererControl {
  readonly version: 1;
  isLive(): boolean;
  setParams(params: StreamGameOverrides): void;
  setPrompt(fragment: string): void;
  clearGameOverrides(): void;
  subscribe(cb: (status: StreamStatus) => void): () => void;
}

type DiffusionWindow = Window & { forgeaxDiffusion?: DiffusionRendererControl };

function createDiffusionRendererControl(): DiffusionRendererControl {
  return {
    version: 1,
    isLive: isStreaming,
    setParams: setGameOverrides,
    setPrompt: (fragment) => setGameOverrides({ prompt: fragment }),
    clearGameOverrides,
    subscribe: subscribeStreamStatus,
  };
}

export function publishDiffusionRendererControl(): () => void {
  const control = createDiffusionRendererControl();
  const target = window as DiffusionWindow;
  const previous = target.forgeaxDiffusion;
  target.forgeaxDiffusion = control;

  return () => {
    if (target.forgeaxDiffusion !== control) return;
    if (previous) target.forgeaxDiffusion = previous;
    else delete target.forgeaxDiffusion;
  };
}
