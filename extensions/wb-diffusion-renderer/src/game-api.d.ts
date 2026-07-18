export interface ForgeaxDiffusionStreamStatus {
  state: 'connecting' | 'live' | 'stopped' | 'error' | 'busy' | 'unauthorized';
  fps?: number;
  modelFps?: number;
  e2eMs?: number;
  serverMs?: number;
  dropped?: number;
  error?: string;
}

export interface ForgeaxDiffusionParams {
  prompt?: string;
  steps?: number;
  interp?: number;
  seed?: number;
}

export interface ForgeaxDiffusionControl {
  readonly version: 1;
  isLive(): boolean;
  setParams(params: Partial<ForgeaxDiffusionParams>): void;
  setPrompt(fragment: string): void;
  clearGameOverrides(): void;
  subscribe(cb: (status: ForgeaxDiffusionStreamStatus) => void): () => void;
}

declare global {
  interface Window {
    forgeaxDiffusion?: ForgeaxDiffusionControl;
  }
}
