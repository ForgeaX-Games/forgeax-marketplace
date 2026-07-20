import type {
  VisualBackendDescriptor,
  VisualBackendProfile,
  VisualInputCapability,
  VisualPresentationIssue,
  VisualPresentationStatus,
} from '@forgeax/types/visual-generation';
import {
  evaluateVisualPresentation,
} from './behavior-evaluator';
import type { VisualEffectDiagnostic } from './effect-frame';
import type {
  VisualBackendAdapter,
  VisualBackendSession,
  VisualDirection,
  VisualSessionCostState,
  VisualSource,
  VisualViewportLease,
} from './adapter';
import {
  SessionTimeGuard,
  type SessionStopReason,
  type SessionTimeGuardSnapshot,
} from './session-time-guard';

export interface VisualPresenterSelection {
  readonly backendId: string;
  readonly profileId: string;
  readonly direction: VisualDirection;
}

export interface VisualPresenterSnapshot {
  readonly selection?: VisualPresenterSelection;
  readonly descriptors: readonly VisualBackendDescriptor[];
  readonly sourceAvailable: boolean;
  readonly priorCatalogAvailable?: boolean;
  readonly output?: MediaStream;
  readonly status: VisualPresentationStatus;
  readonly cost: SessionTimeGuardSnapshot;
  readonly manifestRevision?: string;
  readonly diagnostics: readonly VisualEffectDiagnostic[];
}

export interface GenerativeVisualsPresenterApi {
  getSnapshot(): VisualPresenterSnapshot;
  subscribe(listener: () => void): () => void;
  select(selection: VisualPresenterSelection): Promise<void>;
  updateDirection(direction: VisualDirection): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  restart(): Promise<void>;
  stop(reason?: SessionStopReason): Promise<void>;
  setPageVisible(visible: boolean): void;
  extendIdle(): boolean;
  dispose(): Promise<void>;
}

function issue(error: unknown): VisualPresentationIssue {
  return {
    code: 'transport',
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

function profileFor(adapter: VisualBackendAdapter, id: string): VisualBackendProfile {
  const profile = adapter.descriptor.profiles.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`${adapter.descriptor.label} does not provide profile "${id}"`);
  return profile;
}

function stopReasonLabel(reason: SessionStopReason): string {
  switch (reason) {
    case 'time-limit': return 'session time limit reached';
    case 'idle': return 'idle limit reached';
    case 'paused': return 'pause limit reached';
    case 'hidden': return 'page remained in the background';
    case 'pagehide': return 'page closed';
    case 'user': return 'released by user';
    default: {
      const exhaustive: never = reason;
      return String(exhaustive);
    }
  }
}

/**
 * Owns the source-to-adapter pipeline. The transition waterline moves only
 * after the active adapter resolves its reconcile promise.
 */
export class GenerativeVisualsPresenter implements GenerativeVisualsPresenterApi {
  private readonly adapters = new Map<string, VisualBackendAdapter>();
  private readonly listeners = new Set<() => void>();
  private readonly releaseSource: () => void;
  private session?: VisualBackendSession;
  private releaseSession?: () => void;
  private selection?: VisualPresenterSelection;
  private status: VisualPresentationStatus = { phase: 'idle' };
  private priorCatalogAvailable?: boolean;
  private sourceAvailable = false;
  private generation = 0;
  private waterline = 0;
  private viewportLease?: VisualViewportLease;
  private syncing = false;
  private queued = false;
  private disposed = false;
  private playbackOverride?: 'running' | 'paused';
  private restartRequested = false;
  private lastEpoch?: number;
  private lastContinuityKey?: string;
  private lastRestartSequence = 0;
  private resetSequence = 0;
  private lastDroppedTransitions = 0;
  private resolvedPresentation?: {
    readonly continuityKey: string;
    readonly entry: NonNullable<Awaited<ReturnType<VisualSource['resolvePresentation']>>>;
  };
  private diagnostics: readonly VisualEffectDiagnostic[] = [];
  private manifestRevision?: string;
  private lastActivityKey?: string;
  private stopReason?: SessionStopReason;
  private stopPromise?: Promise<void>;
  private readonly timeGuard: SessionTimeGuard;

  constructor(private readonly source: VisualSource, adapters: readonly VisualBackendAdapter[]) {
    this.timeGuard = new SessionTimeGuard({
      onStop: (reason) => {
        this.stopPromise ??= this.finishStop(reason);
      },
      onChange: () => this.notify(),
    });
    for (const adapter of adapters) this.adapters.set(adapter.descriptor.id, adapter);
    this.sourceAvailable = source.getSnapshot().available;
    this.releaseSource = source.subscribe(() => {
      this.sourceAvailable = source.getSnapshot().available;
      this.touchMeaningfulSourceActivity();
      this.requestSync();
      this.notify();
    });
    void source.hasPriorCatalog().then((available) => {
      this.priorCatalogAvailable = available;
      this.notify();
    }).catch(() => {
      this.priorCatalogAvailable = false;
      this.notify();
    });
  }

  getSnapshot(): VisualPresenterSnapshot {
    return {
      ...(this.selection ? { selection: this.selection } : {}),
      descriptors: [...this.adapters.values()].map((adapter) => adapter.descriptor),
      sourceAvailable: this.sourceAvailable,
      ...(this.priorCatalogAvailable === undefined ? {} : { priorCatalogAvailable: this.priorCatalogAvailable }),
      ...(this.session?.output ? { output: this.session.output } : {}),
      status: this.status,
      cost: this.timeGuard.getSnapshot(),
      ...(this.manifestRevision ? { manifestRevision: this.manifestRevision } : {}),
      diagnostics: this.diagnostics,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async select(selection: VisualPresenterSelection): Promise<void> {
    const adapter = this.adapters.get(selection.backendId);
    if (!adapter) throw new Error(`Unknown generative visual backend "${selection.backendId}"`);
    profileFor(adapter, selection.profileId);
    const generation = ++this.generation;
    this.releaseSession?.();
    await this.session?.dispose();
    if (generation !== this.generation) return;
    this.timeGuard.observeCostState({ phase: 'inactive' });
    this.releaseViewportLease();
    this.waterline = 0;
    this.lastEpoch = undefined;
    this.lastContinuityKey = undefined;
    this.lastRestartSequence = 0;
    this.resolvedPresentation = undefined;
    this.diagnostics = [];
    this.manifestRevision = undefined;
    this.lastDroppedTransitions = 0;
    this.playbackOverride = undefined;
    this.restartRequested = false;
    this.lastActivityKey = undefined;
    this.stopReason = undefined;
    this.stopPromise = undefined;
    this.selection = selection;
    this.session = adapter.createSession({ profileId: selection.profileId, direction: selection.direction });
    this.releaseSession = this.session.subscribe(() => {
      this.status = this.session?.getStatus() ?? { phase: 'stopped' };
      this.observeSessionCost(this.session?.getCostState?.());
      this.timeGuard.setPaused(this.status.runtime?.paused === true);
      this.notify();
    });
    this.status = this.session.getStatus();
    this.requestSync();
    this.notify();
  }

  async updateDirection(direction: VisualDirection): Promise<void> {
    if (!this.selection) return;
    this.timeGuard.touch();
    this.selection = { ...this.selection, direction };
    this.requestSync();
    this.notify();
  }

  async pause(): Promise<void> { await this.setLifecycle('paused'); }
  async resume(): Promise<void> {
    this.timeGuard.touch();
    await this.setLifecycle('running');
  }
  async restart(): Promise<void> {
    this.timeGuard.touch();
    this.waterline = 0;
    this.restartRequested = true;
    this.requestSync();
  }

  async stop(reason: SessionStopReason = 'user'): Promise<void> {
    if (this.stopReason) {
      await this.stopPromise;
      return;
    }
    this.timeGuard.stop(reason);
    await this.stopPromise;
  }

  private async finishStop(reason: SessionStopReason): Promise<void> {
    ++this.generation;
    this.stopReason = reason;
    this.status = {
      ...this.status,
      phase: 'connecting',
      activity: 'Stopping and releasing GPU…',
    };
    this.notify();
    this.releaseSession?.();
    this.releaseSession = undefined;
    await this.session?.dispose();
    this.session = undefined;
    this.timeGuard.observeCostState({ phase: 'stopped' });
    this.releaseViewportLease();
    this.status = {
      phase: 'stopped',
      activity: `Stopped: ${stopReasonLabel(reason)}`,
    };
    this.notify();
  }

  setPageVisible(visible: boolean): void {
    this.timeGuard.setVisible(visible);
  }

  extendIdle(): boolean {
    return this.timeGuard.extendIdle();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseSource();
    await this.stop('user');
    this.timeGuard.dispose();
    this.source.dispose();
    this.listeners.clear();
  }

  private async setLifecycle(desiredPlayback: 'running' | 'paused'): Promise<void> {
    if (!this.selection) return;
    this.playbackOverride = desiredPlayback;
    this.selection = { ...this.selection, direction: this.selection.direction };
    this.requestSync();
  }

  private observeSessionCost(cost: VisualSessionCostState | undefined): void {
    this.timeGuard.observeCostState(cost);
  }

  private touchMeaningfulSourceActivity(): void {
    const snapshot = this.source.getSnapshot();
    const stamp = snapshot.stamp;
    if (!stamp) return;
    const key = [
      stamp.epoch,
      stamp.intentRevision ?? '',
      stamp.programRevision ?? '',
      stamp.transitionSequence ?? '',
    ].join(':');
    if (key === this.lastActivityKey) return;
    this.lastActivityKey = key;
    this.timeGuard.touch();
  }

  private requestSync(): void {
    if (this.disposed) return;
    if (this.syncing) {
      this.queued = true;
      return;
    }
    this.syncing = true;
    void this.sync().finally(() => {
      this.syncing = false;
      if (this.queued) {
        this.queued = false;
        this.requestSync();
      }
    });
  }

  private async sync(): Promise<void> {
    const session = this.session;
    const selection = this.selection;
    if (!session || !selection) return;
    try {
      const adapter = this.adapters.get(selection.backendId);
      if (!adapter) return;
      const snapshot = this.source.getSnapshot();
      this.sourceAvailable = snapshot.available;
      if (!snapshot.available || !snapshot.stamp || !snapshot.program || !snapshot.intent) {
        this.status = { phase: 'degraded', issue: { code: 'missing-input', message: 'A visual program is required', retryable: true } };
        this.notify();
        return;
      }
      const profile = profileFor(adapter, selection.profileId);
      const continuityKey = snapshot.intent.value.scene.continuityKey;
      if (this.lastEpoch !== undefined && this.lastEpoch !== snapshot.stamp.epoch) {
        this.waterline = 0;
      }
      const overflowed = snapshot.program.journal.dropped > this.lastDroppedTransitions;
      if (overflowed) {
        this.waterline = snapshot.stamp.transitionSequence;
        this.diagnostics = [{
          code: 'journal-overflow',
          message: 'Some transient presentation transitions expired before the adapter consumed them',
        }];
      }
      const resetReason = this.lastEpoch === undefined
        ? 'attach'
        : this.lastEpoch !== snapshot.stamp.epoch
          ? 'epoch-change'
          : this.lastContinuityKey !== continuityKey
            ? 'continuity-break'
            : overflowed
              ? 'cue-overflow'
              : this.restartRequested
              || snapshot.program.lifecycle.restartSequence > this.lastRestartSequence
              ? 'explicit-restart'
              : undefined;
      if (
        continuityKey
        && (
          !this.resolvedPresentation
          || this.resolvedPresentation.continuityKey !== continuityKey
          || resetReason === 'explicit-restart'
        )
      ) {
        const entry = await this.source.resolvePresentation(continuityKey);
        this.resolvedPresentation = entry ? { continuityKey, entry } : undefined;
      } else if (!continuityKey) {
        this.resolvedPresentation = undefined;
      }
      const presentation = this.resolvedPresentation?.entry;
      if (!presentation) throw new Error('A visual-presentation manifest entry is required');
      const seedImage = await this.resolveInputs(profile.requiredInputs, continuityKey);
      const evaluated = evaluateVisualPresentation(
        snapshot,
        presentation,
        adapter.capabilities,
        this.waterline,
      );
      const effectFrame = {
        ...evaluated,
        lifecycle: {
          ...evaluated.lifecycle,
          desiredPlayback: this.playbackOverride ?? evaluated.lifecycle.desiredPlayback,
          ...(this.restartRequested ? { restartToken: `panel:${snapshot.stamp.epoch}` } : {}),
        },
      };
      this.diagnostics = [
        ...(overflowed ? [{
          code: 'journal-overflow' as const,
          message: 'Some transient presentation transitions expired before the adapter consumed them',
        }] : []),
        ...effectFrame.diagnostics,
      ];
      this.manifestRevision = effectFrame.manifestRevision;
      const applied = await session.reconcile({
        snapshot,
        direction: selection.direction,
        presentation,
        effectFrame,
        ...(resetReason ? {
          continuityReset: {
            token: `${this.generation}:${++this.resetSequence}`,
            reason: resetReason,
          },
        } : {}),
        ...(seedImage ? { seedImage } : {}),
        ...(this.viewportLease ? { viewportLease: this.viewportLease } : {}),
      });
      this.waterline = applied.transitionSequence;
      this.lastEpoch = snapshot.stamp.epoch;
      this.lastContinuityKey = continuityKey;
      this.lastRestartSequence = snapshot.program.lifecycle.restartSequence;
      this.lastDroppedTransitions = snapshot.program.journal.dropped;
      this.restartRequested = false;
      this.status = session.getStatus();
      this.observeSessionCost(session.getCostState?.());
      this.timeGuard.setPaused(this.status.runtime?.paused === true);
    } catch (error) {
      this.diagnostics = [];
      this.status = { phase: 'failed', issue: issue(error) };
    }
    this.notify();
  }

  private async resolveInputs(
    inputs: readonly VisualInputCapability[],
    continuityKey: string | undefined,
  ): Promise<{ readonly continuityKey: string; readonly blob: Blob } | undefined> {
    if (inputs.includes('seed-image')) {
      if (!continuityKey) throw new Error('A seed-image backend requires a continuity key');
      return { continuityKey, blob: await this.source.resolveSeedImage(continuityKey) };
    }
    if (inputs.includes('viewport-track') && !this.viewportLease) {
      this.viewportLease = this.source.leaseViewportTrack(10);
    }
    return undefined;
  }

  private releaseViewportLease(): void {
    this.viewportLease?.release();
    this.viewportLease = undefined;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function issueMessage(issueValue: VisualPresentationIssue | undefined): string | undefined {
  return issueValue?.message;
}
