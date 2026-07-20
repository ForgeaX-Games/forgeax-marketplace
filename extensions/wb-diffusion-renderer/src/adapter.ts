import type {
  VisualBackendDescriptor,
  VisualPresentationEntry,
  VisualSource as ContractVisualSource,
  VisualSourceSnapshot as ContractVisualSourceSnapshot,
  VisualPresentationStatus,
  VisualViewportLease as ContractVisualViewportLease,
} from '@forgeax/types/visual-generation';
import type {
  AppliedEffectFrame,
  ResolvedEffectFrame,
  VisualAdapterCapabilities,
} from './effect-frame';

/** Browser specialization of the shared host-side source contract. */
export type VisualSource = ContractVisualSource<MediaStream, Blob>;
export type VisualSourceSnapshot = ContractVisualSourceSnapshot;
export type VisualViewportLease = ContractVisualViewportLease<MediaStream>;

/**
 * Product-owned creative direction. Game code never sees this object: it
 * publishes semantic state only, and each provider projects both inputs into
 * its own native commands.
 */
export interface VisualDirection {
  readonly prompt: string;
  readonly seed?: number;
  readonly quality?: 'realtime' | 'balanced' | 'quality';
  readonly rotationSpeedDeg?: number;
  readonly attentionWindow?: 'auto' | 'small' | 'large';
  readonly kvCacheResetMode?: 'off' | 'auto' | 'manual';
  readonly kvCacheResetSequence?: number;
}

export type VisualContinuityResetReason =
  | 'attach'
  | 'epoch-change'
  | 'cue-overflow'
  | 'continuity-break'
  | 'explicit-restart'
  | 'reconnect';

export interface VisualContinuityReset {
  readonly token: string;
  readonly reason: VisualContinuityResetReason;
}

export interface ResolvedVisualRequest {
  readonly snapshot: VisualSourceSnapshot;
  readonly direction: VisualDirection;
  readonly presentation?: VisualPresentationEntry;
  readonly effectFrame?: ResolvedEffectFrame;
  readonly continuityReset?: VisualContinuityReset;
  readonly seedImage?: {
    readonly continuityKey: string;
    readonly blob: Blob;
  };
  readonly viewportLease?: VisualViewportLease;
}

/**
 * Plugin-private cost-bearing session state. This intentionally stays out of
 * shared game contracts: it describes a provider connection, never gameplay.
 */
export interface VisualSessionCostState {
  readonly phase: 'inactive' | 'billable' | 'stopping' | 'stopped';
  readonly startedAtMs?: number;
  readonly providerExpiresAtMs?: number;
}

export interface VisualBackendSession {
  readonly descriptor: VisualBackendDescriptor;
  readonly profileId: string;
  /** Undefined while a backend is connecting or has no visible output yet. */
  readonly output: MediaStream | undefined;
  getStatus(): VisualPresentationStatus;
  /** Undefined for providers without a metered, session-style connection. */
  getCostState?(): VisualSessionCostState;
  subscribe(listener: () => void): () => void;
  /** Atomically applies durable effects and the unacknowledged transition tail. */
  reconcile(input: ResolvedVisualRequest): Promise<AppliedEffectFrame>;
  dispose(): Promise<void>;
}

export interface VisualBackendAdapter {
  readonly descriptor: VisualBackendDescriptor;
  readonly capabilities: VisualAdapterCapabilities;
  createSession(options: {
    readonly profileId: string;
    readonly direction: VisualDirection;
  }): VisualBackendSession;
}
