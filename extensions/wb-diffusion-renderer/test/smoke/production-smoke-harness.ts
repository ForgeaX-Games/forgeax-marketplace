import type { VisualPresentationStatus } from '@forgeax/types/visual-generation';
import type {
  VisualBackendAdapter,
  VisualSource,
  VisualSourceSnapshot,
} from '../../src/adapter';
import { LingbotWorld2Adapter } from '../../src/adapters/lingbot-world-2';
import {
  GenerativeVisualsPresenter,
  type VisualPresenterSelection,
} from '../../src/presenter';
import type { SessionTimeGuardSnapshot } from '../../src/session-time-guard';

export type SmokePhase =
  | 'idle'
  | 'connecting'
  | 'waiting'
  | 'seeding'
  | 'live'
  | 'failed'
  | 'stopped';

export interface FixtureInput {
  readonly id: string;
  readonly image: Blob;
  readonly prompt: string;
}

export interface FixtureSmokeState {
  readonly phase: SmokePhase;
  readonly message: string;
  readonly lastCommand?: string;
  readonly leaseId?: string;
  readonly fixtureId?: string;
}

export interface LingbotControls {
  readonly longitudinal: 'forward' | 'backward' | 'idle';
  readonly lateral: 'left' | 'right' | 'idle';
  readonly lookHorizontal: 'left' | 'right' | 'idle';
  readonly lookVertical: 'up' | 'down' | 'idle';
}

type LingbotClientFactory = ConstructorParameters<typeof LingbotWorld2Adapter>[0];

export interface ProductionSmokeHarnessOptions {
  readonly createClient?: LingbotClientFactory;
  readonly onStateChanged?: (state: FixtureSmokeState) => void;
  readonly onVideo?: (stream: MediaStream | undefined) => void;
}

/**
 * Thin fixture shell over the production Presenter + LingBot adapter.
 * It does not own Reactor seeding / waiters / leases — those stay in
 * `LingbotWorld2Session`.
 */
export class ProductionLingbotSmokeHarness {
  private readonly source = new FixtureVisualSource();
  private readonly presenter: GenerativeVisualsPresenter;
  private readonly onStateChanged?: (state: FixtureSmokeState) => void;
  private readonly onVideo?: (stream: MediaStream | undefined) => void;
  private readonly releasePresenter: () => void;
  private fixture?: FixtureInput;
  private state: FixtureSmokeState = {
    phase: 'idle',
    message: 'Choose a fixture and connect.',
  };
  private lastOutput?: MediaStream;

  constructor(options: ProductionSmokeHarnessOptions = {}) {
    const adapter: VisualBackendAdapter = new LingbotWorld2Adapter(options.createClient);
    this.presenter = new GenerativeVisualsPresenter(this.source, [adapter]);
    this.onStateChanged = options.onStateChanged;
    this.onVideo = options.onVideo;
    this.releasePresenter = this.presenter.subscribe(() => this.syncFromPresenter());
  }

  getState(): FixtureSmokeState {
    return this.state;
  }

  /** Exposed for tests that wait on production Presenter status. */
  getPresenterStatus(): VisualPresentationStatus {
    return this.presenter.getSnapshot().status;
  }

  getCostState(): SessionTimeGuardSnapshot {
    return this.presenter.getSnapshot().cost;
  }

  async connect(fixture: FixtureInput): Promise<void> {
    this.fixture = fixture;
    this.source.setFixture(fixture);
    this.publish({
      phase: 'connecting',
      message: 'Starting production Presenter + LingBot adapter.',
      fixtureId: fixture.id,
    });
    const selection: VisualPresenterSelection = {
      backendId: 'reactor-lingbot-world-2',
      profileId: 'navigable-world',
      direction: { prompt: fixture.prompt },
    };
    await this.presenter.select(selection);
    this.syncFromPresenter();
  }

  async reset(): Promise<void> {
    const fixture = this.fixture;
    if (!fixture) return;
    await this.presenter.stop();
    await this.connect(fixture);
  }

  async updatePrompt(prompt: string): Promise<void> {
    const normalized = prompt.trim();
    const fixture = this.fixture;
    if (!fixture || !normalized) return;
    this.fixture = { ...fixture, prompt: normalized };
    await this.presenter.updateDirection({ prompt: normalized });
    this.publish({
      ...this.state,
      message: 'Applied prompt update through Presenter direction.',
      lastCommand: 'updateDirection',
    });
  }

  async setControls(next: LingbotControls): Promise<void> {
    this.source.setControls(next);
    this.publish({ ...this.state, lastCommand: 'set_controls' });
  }

  async disconnect(showStopped = true): Promise<void> {
    await this.presenter.stop();
    this.lastOutput = undefined;
    this.onVideo?.(undefined);
    if (showStopped) {
      this.publish({
        phase: 'stopped',
        message: 'Stopped the production Presenter session.',
        fixtureId: this.fixture?.id,
      });
    }
  }

  dispose(): void {
    this.releasePresenter();
    void this.presenter.dispose();
    this.source.dispose();
  }

  private syncFromPresenter(): void {
    const snapshot = this.presenter.getSnapshot();
    const status = snapshot.status;
    const output = snapshot.output;
    if (output !== this.lastOutput) {
      this.lastOutput = output;
      this.onVideo?.(output);
    }
    this.publish({
      phase: phaseFor(status.phase),
      message: status.issue?.message
        ?? status.activity
        ?? status.phase,
      ...(status.phase === 'live' ? { lastCommand: 'start' } : {}),
      fixtureId: this.fixture?.id,
    });
  }

  private publish(next: FixtureSmokeState): void {
    this.state = {
      ...next,
      ...(next.fixtureId ?? this.fixture?.id
        ? { fixtureId: next.fixtureId ?? this.fixture?.id }
        : {}),
    };
    this.onStateChanged?.(this.state);
  }
}

function phaseFor(phase: VisualPresentationStatus['phase']): SmokePhase {
  if (phase === 'connecting') return 'connecting';
  if (phase === 'waiting') return 'waiting';
  if (phase === 'live') return 'live';
  if (phase === 'failed') return 'failed';
  if (phase === 'stopped') return 'stopped';
  if (phase === 'degraded') return 'waiting';
  return 'idle';
}

class FixtureVisualSource implements VisualSource {
  private readonly listeners = new Set<() => void>();
  private fixture?: FixtureInput;
  private revision = 0;
  private controls: LingbotControls = {
    longitudinal: 'idle',
    lateral: 'idle',
    lookHorizontal: 'idle',
    lookVertical: 'idle',
  };
  private disposed = false;

  setFixture(fixture: FixtureInput): void {
    this.fixture = fixture;
    this.revision += 1;
    this.notify();
  }

  setControls(next: LingbotControls): void {
    this.controls = next;
    this.revision += 1;
    this.notify();
  }

  getSnapshot(): VisualSourceSnapshot {
    if (this.disposed || !this.fixture) {
      return { available: false };
    }
    const forward = this.controls.longitudinal === 'forward'
      ? 1
      : this.controls.longitudinal === 'backward'
        ? -1
        : 0;
    const strafe = this.controls.lateral === 'right'
      ? 1
      : this.controls.lateral === 'left'
        ? -1
        : 0;
    const yaw = this.controls.lookHorizontal === 'right'
      ? 1
      : this.controls.lookHorizontal === 'left'
        ? -1
        : 0;
    const pitch = this.controls.lookVertical === 'up'
      ? 1
      : this.controls.lookVertical === 'down'
        ? -1
        : 0;
    return {
      available: true,
      stamp: {
        epoch: 1,
        run: 'play',
        intentRevision: this.revision,
        programRevision: this.revision,
        transitionSequence: 0,
      },
      intent: {
        revision: this.revision,
        value: {
          scene: {
            summary: this.fixture.prompt,
            tags: ['fixture'],
            continuityKey: `fixture/${this.fixture.id}`,
            actors: [],
          },
          camera: { mode: 'third-person', motion: 'follow' },
        },
      },
      program: {
        version: 1,
        revision: this.revision,
        lifecycle: { desiredPlayback: 'running', restartSequence: 0 },
        signals: { forward, strafe, yaw, pitch },
        activeBehaviors: [],
        journal: { nextSequence: 1, dropped: 0, entries: [] },
        operations: [],
      },
      camera: {
        entity: 1,
        position: [0, 1.6, 2],
        forward: [0, 0, -1],
      },
      viewport: { width: 640, height: 360 },
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  leaseViewportTrack(): { stream: MediaStream; release: () => void } {
    return {
      stream: new MediaStream(),
      release: () => {},
    };
  }

  async hasPriorCatalog(): Promise<boolean> {
    return Boolean(this.fixture);
  }

  async resolveSeedImage(continuityKey: string): Promise<Blob> {
    if (!this.fixture || continuityKey !== `fixture/${this.fixture.id}`) {
      throw new Error(`No visual prior is registered for continuity key "${continuityKey}"`);
    }
    return this.fixture.image;
  }

  async resolvePresentation(continuityKey: string) {
    if (!this.fixture) return undefined;
    if (continuityKey !== `fixture/${this.fixture.id}`) {
      throw new Error(`No visual presentation is registered for continuity key "${continuityKey}"`);
    }
    return {
      continuityKey,
      signals: [
        { key: 'forward', type: 'number' as const, default: 0 },
        { key: 'strafe', type: 'number' as const, default: 0 },
        { key: 'yaw', type: 'number' as const, default: 0 },
        { key: 'pitch', type: 'number' as const, default: 0 },
      ],
      baseline: {
        prompt: [],
        motion: [
          { id: 'forward', target: 'navigation.forward-rate' as const, blend: 'replace' as const, priority: 0, required: false, scaleByIntensity: false, source: { kind: 'signal' as const, key: 'forward', scale: 1, invert: false } },
          { id: 'strafe', target: 'navigation.strafe-rate' as const, blend: 'replace' as const, priority: 0, required: false, scaleByIntensity: false, source: { kind: 'signal' as const, key: 'strafe', scale: 1, invert: false } },
          { id: 'yaw', target: 'camera.rotation.yaw-rate' as const, blend: 'replace' as const, priority: 0, required: false, scaleByIntensity: false, source: { kind: 'signal' as const, key: 'yaw', scale: 1, invert: false } },
          { id: 'pitch', target: 'camera.rotation.pitch-rate' as const, blend: 'replace' as const, priority: 0, required: false, scaleByIntensity: false, source: { kind: 'signal' as const, key: 'pitch', scale: 1, invert: false } },
        ],
      },
      recipes: [],
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
