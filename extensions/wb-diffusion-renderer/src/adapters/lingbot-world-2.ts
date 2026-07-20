import {
  LingbotWorld2Model,
  type LingbotWorld2CommandErrorMessage,
  type LingbotWorld2Message,
} from '@reactor-models/lingbot-world-2/core';
import type {
  VisualBackendDescriptor,
  VisualPresentationStatus,
  VisualPlaybackIntent,
} from '@forgeax/types/visual-generation';
import type {
  VisualBackendAdapter,
  VisualBackendSession,
  VisualDirection,
  ResolvedVisualRequest,
  VisualSessionCostState,
} from '../adapter';
import {
  clamp,
  projectLingbotControls,
  subtractVector,
  type LingbotControls,
} from '../projector';
import { mergeLatchedPrompts } from '../behavior-evaluator';
import {
  composeLingbotWorld2Prompt,
  LingbotPromptTooLargeError,
} from './lingbot-world-2-prompt';
import type {
  AppliedEffectFrame,
  ResolvedMotionTimeline,
  ResolvedMotionValue,
  ResolvedPromptContribution,
} from '../effect-frame';

export const LINGBOT_WORLD_2_DESCRIPTOR: VisualBackendDescriptor = {
  id: 'reactor-lingbot-world-2',
  label: 'LingBot World 2',
  profiles: [{
    id: 'navigable-world',
    label: 'Seeded navigable world',
    requiredInputs: ['seed-image', 'semantic-intent', 'camera-pose'],
    optionalInputs: [],
    outputs: ['presentation-stream'],
    controls: [
      'prompt',
      'seed',
      'rotation-speed',
      'attention-window',
      'kv-cache-reset',
    ],
  }],
};

type ReactorStatus = 'disconnected' | 'connecting' | 'waiting' | 'ready';
type LingbotClientFactory = (options: { readonly apiUrl: string }) => LingbotClient;
type ReactorWaiter = {
  readonly epoch: number;
  readonly resolve: () => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_COORDINATOR_URL = 'https://api.reactor.inc';
const DEFAULT_WAIT_TIMEOUT_MS = 15_000;
const RECONNECT_DEADLINE_MS = 5_000;
const RECONNECT_MIN_DELAY_MS = 250;
const RECONNECT_MAX_DELAY_MS = 5_000;
const LINGBOT_CHUNK_LATENTS = 3;
const SEMANTIC_ORBIT_RADIUS = 6;
const MOUSE_SENS = 0.0003;
const MOUSE_MAX_ROT = 0.2;

class MissingVisualInputError extends Error {
  readonly code = 'missing-input' as const;

  constructor(message: string) {
    super(message);
    this.name = 'MissingVisualInputError';
  }
}

class ReactorOperationCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReactorOperationCancelledError';
  }
}

type LingbotClient = Pick<
  LingbotWorld2Model,
  | 'connect'
  | 'reconnect'
  | 'disconnect'
  | 'getStatus'
  | 'on'
  | 'off'
  | 'onMainVideo'
  | 'onCommandError'
  | 'onMessage'
  | 'getLastError'
  | 'uploadFile'
  | 'reset'
  | 'setImage'
  | 'setPrompt'
  | 'setSeed'
  | 'setAttnWindow'
  | 'setRotationSpeedDeg'
  | 'sendCommand'
  | 'pause'
  | 'resume'
  | 'setCameraPose'
  | 'setMoveLongitudinal'
  | 'setMoveLateral'
  | 'setLookHorizontal'
  | 'setLookVertical'
  | 'start'
>;

type RecoverableReactorError = {
  readonly code?: unknown;
  readonly message?: unknown;
  readonly recoverable?: unknown;
  readonly retryAfter?: unknown;
};

function reactorErrorMetadata(error: unknown): {
  readonly message: string;
  readonly recoverable: boolean;
  readonly retryAfter?: number;
} {
  const value = error && typeof error === 'object' ? error as RecoverableReactorError : {};
  const retryAfter = typeof value.retryAfter === 'number' && Number.isFinite(value.retryAfter)
    ? Math.max(0, value.retryAfter)
    : undefined;
  return {
    message: typeof value.message === 'string'
      ? value.message
      : error instanceof Error ? error.message : String(error),
    recoverable: value.recoverable !== false,
    ...(retryAfter === undefined ? {} : { retryAfter }),
  };
}

function clampReconnectDelay(value: number | undefined): number {
  return Math.max(
    RECONNECT_MIN_DELAY_MS,
    Math.min(RECONNECT_MAX_DELAY_MS, Number.isFinite(value) ? value! : RECONNECT_MIN_DELAY_MS),
  );
}

type TokenResponse = {
  jwt?: unknown;
  leaseId?: unknown;
  coordinatorUrl?: unknown;
  expiresAt?: unknown;
  error?: unknown;
};

function priorKey(input: ResolvedVisualRequest): string {
  return input.seedImage?.continuityKey ?? '';
}

function coordinatorUrlFromPayload(value: unknown): string {
  if (value === undefined) return DEFAULT_COORDINATOR_URL;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('Session token response did not include a valid coordinator URL');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Session token response did not include a valid coordinator URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Session token response did not include a valid coordinator URL');
  }
  return value.trim().replace(/\/+$/, '');
}

function phaseForReactor(status: ReactorStatus): VisualPresentationStatus['phase'] {
  if (status === 'ready') return 'waiting';
  if (status === 'disconnected') return 'stopped';
  return status === 'waiting' ? 'waiting' : 'connecting';
}

function cameraPose(
  previous: ResolvedVisualRequest['snapshot']['camera'] | undefined,
  next: ResolvedVisualRequest['snapshot']['camera'] | undefined,
  semanticOwnership: {
    readonly move: boolean;
    readonly look: boolean;
  },
): number[] {
  if (!previous || !next) return [];
  const [dx, dy, dz] = subtractVector(next.position, previous.position);
  const previousYaw = Math.atan2(previous.forward[0], -previous.forward[2]);
  const nextYaw = Math.atan2(next.forward[0], -next.forward[2]);
  let yaw = nextYaw - previousYaw;
  if (yaw > Math.PI) yaw -= Math.PI * 2;
  if (yaw < -Math.PI) yaw += Math.PI * 2;
  // One motion tuple applies cleanly to a model chunk. Clamping prevents an
  // editor teleport / render hitch from becoming an invalid world-model jump.
  // Semantic WASD/look commands remain authoritative; numeric camera deltas
  // only supplement motion that those controls do not already describe.
  const delta = [
    0,
    semanticOwnership.look ? 0 : clamp(yaw, 0.2),
    0,
    semanticOwnership.move ? 0 : clamp(dx, 0.25),
    semanticOwnership.move ? 0 : clamp(dy, 0.25),
    semanticOwnership.move ? 0 : clamp(dz, 0.25),
  ];
  return delta.some((value) => Math.abs(value) > 1e-5) ? delta : [];
}

function sampleTimelineValue(
  definition: ResolvedMotionTimeline,
  progress: number,
): number {
  const frames = definition.keyframes;
  const clamped = Math.max(0, Math.min(1, progress));
  const nextIndex = frames.findIndex((frame) => frame.at >= clamped);
  const next = nextIndex < 0 ? frames.at(-1)! : frames[nextIndex]!;
  const previous = nextIndex <= 0 ? frames[0]! : frames[nextIndex - 1]!;
  const span = next.at - previous.at;
  const ratio = definition.interpolation === 'linear' && span > 0
    ? (clamped - previous.at) / span
    : 0;
  return definition.interpolation === 'linear'
    ? previous.value + (next.value - previous.value) * Math.max(0, Math.min(1, ratio))
    : previous.value;
}

type VisualMotionTarget = ResolvedMotionValue['target'];

function blendTimelineSamples(
  candidates: Array<ResolvedMotionValue & {
    readonly blend: 'add' | 'replace';
    readonly priority: number;
    readonly sourceId: string;
  }>,
): Map<VisualMotionTarget, number> {
  const sampled = new Map<VisualMotionTarget, number>();
  for (const target of new Set(candidates.map((candidate) => candidate.target))) {
    const targetCandidates = candidates.filter((candidate) => candidate.target === target);
    const replace = targetCandidates.filter((candidate) => candidate.blend === 'replace')
      .sort((left, right) => right.priority - left.priority || left.sourceId.localeCompare(right.sourceId))[0];
    const additive = targetCandidates.filter((candidate) => candidate.blend === 'add')
      .reduce((total, candidate) => total + candidate.value, 0);
    sampled.set(target, Math.max(-1, Math.min(1, (replace?.value ?? 0) + additive)));
  }
  return sampled;
}

function semanticCameraPose(
  input: ResolvedVisualRequest | undefined,
  previousOffset: readonly [number, number, number],
  latentTimelineMotion: readonly (readonly ResolvedMotionValue[])[],
  mouseDelta: { readonly yaw: number; readonly pitch: number },
): {
  readonly pose: number[];
  readonly offset: [number, number, number];
} {
  const continuous = new Map(input?.effectFrame?.continuousMotion.map((value) => [value.target, value.value]));
  const speed = (((input?.direction.rotationSpeedDeg ?? 5) * Math.PI) / 180);
  const ry = clamp(
    mouseDelta.yaw * MOUSE_SENS + (continuous.get('camera.rotation.yaw-rate') ?? 0) * speed,
    MOUSE_MAX_ROT,
  );
  const rx = clamp(
    -(mouseDelta.pitch * MOUSE_SENS) - (continuous.get('camera.rotation.pitch-rate') ?? 0) * speed,
    MOUSE_MAX_ROT,
  );
  const rz = clamp((continuous.get('camera.rotation.roll-rate') ?? 0) * speed, MOUSE_MAX_ROT);
  const offset: [number, number, number] = [
    continuous.get('camera.offset.x') ?? 0,
    continuous.get('camera.offset.y') ?? 0,
    continuous.get('camera.offset.z') ?? 0,
  ];
  const orbitRadius = (continuous.get('camera.orbit.radius') ?? 0) * SEMANTIC_ORBIT_RADIUS;
  const baseTx = clamp(
    (continuous.get('camera.translation.x-rate') ?? 0)
      + offset[0] - previousOffset[0]
      - orbitRadius * Math.sin(ry),
    0.25,
  );
  const baseTy = clamp(
    (continuous.get('camera.translation.y-rate') ?? 0) + offset[1] - previousOffset[1],
    0.25,
  );
  const baseTz = clamp(
    (continuous.get('camera.translation.z-rate') ?? 0)
      + offset[2] - previousOffset[2]
      + orbitRadius * (1 - Math.cos(ry)),
    0.25,
  );
  const pose: number[] = [];
  let any = Math.abs(rx) > 1e-5 || Math.abs(ry) > 1e-5 || Math.abs(rz) > 1e-5
    || Math.abs(baseTx) > 1e-5 || Math.abs(baseTy) > 1e-5 || Math.abs(baseTz) > 1e-5;
  for (let latent = 0; latent < LINGBOT_CHUNK_LATENTS; latent += 1) {
    const timeline = new Map(latentTimelineMotion[latent]?.map((value) => [value.target, value.value]));
    // Continuous navigation stays clamped; timeline vertical arcs use full
    // [-1, 1] intent magnitude to match the reference charge/crouch patterns.
    const tx = clamp(baseTx + (timeline.get('camera.translation.x-rate') ?? 0)
      + (timeline.get('camera.offset.x') ?? 0), 0.25);
    const ty = baseTy
      + (timeline.get('camera.translation.y-rate') ?? 0)
      + (timeline.get('camera.offset.y') ?? 0);
    const tz = clamp(baseTz + (timeline.get('camera.translation.z-rate') ?? 0)
      + (timeline.get('camera.offset.z') ?? 0), 0.25);
    any = any || Math.abs(tx - baseTx) > 1e-5 || Math.abs(ty - baseTy) > 1e-5 || Math.abs(tz - baseTz) > 1e-5
      || Math.abs(timeline.get('camera.rotation.yaw-rate') ?? 0) > 1e-5;
    pose.push(
      clamp(rx + (timeline.get('camera.rotation.pitch-rate') ?? 0), MOUSE_MAX_ROT),
      clamp(ry + (timeline.get('camera.rotation.yaw-rate') ?? 0), MOUSE_MAX_ROT),
      clamp(rz + (timeline.get('camera.rotation.roll-rate') ?? 0), MOUSE_MAX_ROT),
      tx,
      ty,
      tz,
    );
  }
  return { pose: any ? pose : [], offset };
}

function controlsEqual(left: LingbotControls | undefined, right: LingbotControls): boolean {
  return left?.moveLongitudinal === right.moveLongitudinal
    && left.moveLateral === right.moveLateral;
}

/**
 * WebRTC-direct Reactor session. The raw API key never reaches the browser:
 * every Coordinator hop calls the token broker with the panel's stable session
 * id, so the Reactor SDK refreshes short-lived JWTs without interrupting media.
 */
class LingbotWorld2Session implements VisualBackendSession {
  readonly descriptor = LINGBOT_WORLD_2_DESCRIPTOR;
  readonly profileId = 'navigable-world';
  private readonly listeners = new Set<() => void>();
  private readonly sessionId = crypto.randomUUID();
  private serial = Promise.resolve();
  private client?: LingbotClient;
  private stopMainVideo?: () => void;
  private stopCommandErrors?: () => void;
  private stopMessages?: () => void;
  private stopErrors?: () => void;
  private onStatusChanged?: (status: ReactorStatus) => void;
  private current?: ResolvedVisualRequest;
  private flushedCamera?: ResolvedVisualRequest['snapshot']['camera'];
  private desiredCamera?: ResolvedVisualRequest['snapshot']['camera'];
  private poseActive = false;
  private flushedEffectOffset: [number, number, number] = [0, 0, 0];
  private readonly timelines = new Map<string, {
    readonly definition: ResolvedMotionTimeline;
    /** Provider chunks already confirmed for this timeline. */
    chunksCompleted: number;
  }>();
  private pendingMouseYaw = 0;
  private pendingMousePitch = 0;
  private latchedPrompts = new Map<string, readonly ResolvedPromptContribution[]>();
  private semanticMoveSinceFlush = false;
  private semanticLookSinceFlush = false;
  private lastControls?: LingbotControls;
  private lastPrompt?: string;
  private leaseId?: string;
  private coordinatorUrl?: string;
  private sessionEpoch?: number;
  private failedEpoch?: number;
  private seededEpoch?: number;
  private seededPriorKey?: string;
  private seededSeed?: number;
  private resetRequested = false;
  private consumedContinuityResetToken?: string;
  private reconnectReplayPending = false;
  private reconnectPromise?: Promise<void>;
  private reconnectDeadline?: number;
  private reconnectGeneration = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectDelayResolve?: () => void;
  private runtimeState?: VisualPresentationStatus['runtime'];
  private costState: VisualSessionCostState = { phase: 'inactive' };
  private lastRotationSpeedDeg?: number;
  private lastAttentionWindow?: VisualDirection['attentionWindow'];
  private lastKvCacheResetMode?: VisualDirection['kvCacheResetMode'];
  private consumedKvCacheResetSequence?: number;
  private lastPoseChunkIndex?: number;
  private reactorReadyEpoch?: number;
  private reactorReadyFailure?: Error;
  private resetFailure?: Error;
  private readyWaiter?: ReactorWaiter;
  private resetAcknowledgedEpoch?: number;
  private resetWaiter?: ReactorWaiter;
  private imageAcceptedEpoch?: number;
  private imageFailure?: Error;
  private imageWaiter?: ReactorWaiter;
  private conditionsReady = false;
  private conditionFailure?: Error;
  private conditionWaiter?: ReactorWaiter;
  private disposed = false;
  private terminationHandshake = false;
  private media?: MediaStream;
  private status: VisualPresentationStatus = {
    phase: 'idle',
    backendId: 'reactor-lingbot-world-2',
    profileId: 'navigable-world',
  };

  constructor(
    private readonly createClient: LingbotClientFactory = ({ apiUrl }) => new LingbotWorld2Model({ apiUrl }),
    private readonly captureSeedImage: (input: ResolvedVisualRequest) => Promise<Blob> = async (input) => {
      if (!input.seedImage) {
        throw new MissingVisualInputError(
          'LingBot World 2 requires a resolved game image prior before connecting',
        );
      }
      return input.seedImage.blob;
    },
    private readonly waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ) {}

  get output(): MediaStream | undefined {
    return this.media;
  }

  getStatus(): VisualPresentationStatus {
    return this.status;
  }

  getCostState(): VisualSessionCostState {
    return this.costState;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reconcile(input: ResolvedVisualRequest): Promise<AppliedEffectFrame> {
    this.current = input;
    this.registerTimelines(input.effectFrame?.timelines ?? []);
    const stamp = input.snapshot.stamp;
    if (!input.snapshot.available || !stamp) {
      this.sessionEpoch = undefined;
      this.rejectAllWaiters(new ReactorOperationCancelledError(
        'The Studio world was removed before the backend operation completed',
      ));
      return this.enqueue(async () => {
        await this.disconnect();
        this.publish({
          phase: 'degraded',
          issue: {
            code: 'source-lost',
            message: 'The Studio world is unavailable for this backend',
            retryable: true,
          },
        });
      }).then(() => this.applied(input));
    }
    const epochChanged = this.sessionEpoch !== stamp.epoch;
    this.sessionEpoch = stamp.epoch;
    if (epochChanged) {
      this.rejectAllWaiters(new ReactorOperationCancelledError(
        'Backend work was superseded by a newer Studio world epoch',
      ));
    }
    if (this.failedEpoch === stamp.epoch) {
      return Promise.reject(new Error('LingBot session is failed for the current world epoch'));
    }
    return this.enqueue(async () => {
      if (!this.isCurrent(stamp.epoch)) return;
      // The host resolves game-owned prior assets before an adapter is called.
      // Missing resolved media must fail closed before obtaining a Reactor lease.
      if (!input.seedImage || !priorKey(input)) {
        throw new MissingVisualInputError(
          `No resolved LingBot image prior is available for game continuity key "${priorKey(input)}"`,
        );
      }
      // Validate the complete serialized prompt before connecting, resetting,
      // or uploading anything. Oversized content is a local input failure,
      // never a provider transport failure.
      composeLingbotWorld2Prompt(
        input.direction,
        input.effectFrame,
      );
      if (epochChanged) await this.disconnect();
      if (!this.isCurrent(stamp.epoch)) return;
      await this.ensureConnected(stamp.epoch);
      if (!this.isCurrent(stamp.epoch)) return;
      const requestedPriorKey = priorKey(input);
      const requestedSeed = input.direction.seed ?? 42;
      const needsSeed = this.seededEpoch !== stamp.epoch;
      const priorChanged = this.seededPriorKey !== undefined && this.seededPriorKey !== requestedPriorKey;
      const seedChanged = this.seededSeed !== undefined && this.seededSeed !== requestedSeed;
      const resetByToken = input.continuityReset !== undefined
        && input.continuityReset.token !== this.consumedContinuityResetToken;
      const resetFirst = resetByToken || this.resetRequested || priorChanged || seedChanged;
      if (needsSeed || resetFirst) {
        this.resetRequested = false;
        await this.resetAndSeed(stamp.epoch, resetFirst);
        if (input.continuityReset && resetByToken) {
          this.consumedContinuityResetToken = input.continuityReset.token;
        }
      } else {
        await this.applyLiveControls(stamp.epoch);
      }
      await this.applyPlayback(
        stamp.epoch,
        input.effectFrame?.lifecycle.desiredPlayback ?? 'running',
      );
      this.publish({
        phase: this.media ? 'live' : 'waiting',
        appliedIntentRevision: stamp.intentRevision,
        appliedTransitionSequence: stamp.transitionSequence,
      });
    }).then(() => this.applied(input));
  }

  private applied(input: ResolvedVisualRequest): AppliedEffectFrame {
    return {
      transitionSequence: input.effectFrame?.transitions.at(-1)?.sequence
        ?? input.snapshot.stamp?.transitionSequence
        ?? 0,
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    // #region agent log
    fetch('http://127.0.0.1:7823/ingest/da340269-854a-4c93-8ba0-c179d99ee400',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cb69a8'},body:JSON.stringify({sessionId:'cb69a8',runId:'stop-pre-fix',hypothesisId:'F,H',location:'lingbot-world-2.ts:dispose',message:'Adapter dispose entered',data:{costPhase:this.costState.phase,hasClient:this.client!==undefined,clientStatus:this.client?.getStatus()},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    this.rejectAllWaiters(new ReactorOperationCancelledError(
      'Backend session was disposed before its pending operation completed',
    ));
    await this.enqueue(async () => {
      await this.disconnect();
      this.publish({ phase: 'stopped' });
    });
    this.listeners.clear();
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.serial.then(work);
    this.serial = next.catch(() => undefined);
    return next.catch((error: unknown) => {
      if (!(error instanceof ReactorOperationCancelledError) && !this.disposed
        && !(this.failedEpoch !== undefined && this.failedEpoch === this.sessionEpoch)) {
      const code = error instanceof MissingVisualInputError
        ? error.code
        : error instanceof LingbotPromptTooLargeError
          ? error.code
          : 'transport';
      this.fail(
        code,
        error instanceof Error ? error.message : String(error),
      );
      }
      throw error;
    });
  }

  private async ensureConnected(epoch: number): Promise<void> {
    if (this.client?.getStatus() === 'ready') return;
    await this.disconnect();
    if (!this.disposed) this.costState = { phase: 'inactive' };
    let initialToken: { readonly jwt: string; readonly coordinatorUrl: string };
    try {
      initialToken = await this.fetchJwt();
    } catch (error) {
      await this.releaseLease();
      throw error;
    }
    if (!this.isCurrent(epoch)) return;
    let client: LingbotClient;
    try {
      client = this.createClient({ apiUrl: initialToken.coordinatorUrl });
    } catch (error) {
      await this.releaseLease();
      throw error;
    }
    this.client = client;
    this.onStatusChanged = (status) => {
      if (!this.isCurrent(epoch) || this.client !== client) return;
      if (this.failedEpoch === epoch) return;
      if (status === 'disconnected') {
        this.reconnectReplayPending = true;
        const metadata = reactorErrorMetadata(
          typeof client.getLastError === 'function' ? client.getLastError() : undefined,
        );
        const recoverable = metadata.recoverable && typeof client.reconnect === 'function';
        const failure = recoverable
          ? new ReactorOperationCancelledError(
            'Backend disconnected; pending work will be replayed after reconnect',
          )
          : new Error(metadata.message);
        this.reactorReadyFailure = failure;
        this.rejectReadyWaiter(failure);
        this.resetFailure = failure;
        this.rejectResetWaiter(failure);
        this.imageFailure = failure;
        this.rejectImageWaiter(failure);
        this.conditionFailure = failure;
        this.rejectConditionWaiter(failure);
        if (recoverable) {
          this.startReconnectLoop(epoch, metadata.retryAfter);
        } else {
          this.fail('transport', metadata.message);
          return;
        }
        this.publish({
          phase: 'connecting',
          activity: 'Backend disconnected; retrying the latest world state.',
        });
        return;
      } else if (status === 'ready' && this.reconnectReplayPending) {
        // A transport reconnection may have lost the model's working state.
        // Reconcile the latest durable snapshot instead of assuming the old
        // command stream is still present.
        this.handleReconnectReady(epoch);
      }
      if (status === 'ready') {
        this.reactorReadyEpoch = epoch;
        this.reactorReadyFailure = undefined;
        if (this.costState.phase === 'inactive') {
          this.costState = {
            phase: 'billable',
            startedAtMs: Date.now(),
            ...(this.costState.providerExpiresAtMs === undefined
              ? {}
              : { providerExpiresAtMs: this.costState.providerExpiresAtMs }),
          };
        }
        this.resolveReadyWaiter(epoch);
      }
      this.publish({
        phase: phaseForReactor(status),
        activity: status === 'waiting'
          ? 'Waiting for a model worker.'
          : status === 'ready'
            ? 'Backend ready; preparing the selected image prior.'
            : status === 'connecting'
              ? 'Connecting to the backend.'
              : 'Backend disconnected.',
      });
    };
    client.on('statusChanged', this.onStatusChanged);
    this.stopMainVideo = client.onMainVideo((_track, stream) => {
      if (!this.isCurrent(epoch)) return;
      if (this.failedEpoch === epoch) return;
      this.media = stream;
      this.publish({ phase: 'live', activity: 'Receiving the presentation stream.' });
    });
    this.stopCommandErrors = client.onCommandError((message) => this.commandRejected(message, epoch));
    this.stopMessages = client.onMessage((message) => this.observeMessage(message, epoch));
    const onError = (error: unknown) => {
      if (!this.isCurrent(epoch) || this.client !== client) return;
      const metadata = reactorErrorMetadata(error);
      if (!metadata.recoverable || typeof client.reconnect !== 'function') {
        this.fail('transport', metadata.message);
        return;
      }
      this.reconnectReplayPending = true;
      if (client.getStatus() === 'disconnected') {
        this.startReconnectLoop(epoch, metadata.retryAfter);
      }
    };
    client.on('error', onError);
    this.stopErrors = () => client.off('error', onError);
    this.publish({ phase: 'connecting' });
    let bootstrapJwt: string | undefined = initialToken.jwt;
    try {
      await client.connect(async () => {
        // #region agent log
        fetch('http://127.0.0.1:7823/ingest/da340269-854a-4c93-8ba0-c179d99ee400',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cb69a8'},body:JSON.stringify({sessionId:'cb69a8',runId:'stop-pre-fix',hypothesisId:'E,F',location:'lingbot-world-2.ts:connect-token-callback',message:'SDK requested connection token',data:{disposed:this.disposed,costPhase:this.costState.phase,hasBootstrapJwt:bootstrapJwt!==undefined},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        if (bootstrapJwt) {
          const jwt = bootstrapJwt;
          bootstrapJwt = undefined;
          return jwt;
        }
        return (await this.fetchJwt()).jwt;
      });
    } catch (error) {
      await this.disconnect();
      throw error;
    }
    if (!this.isCurrent(epoch)) return;
    if (client.getStatus() === 'ready') {
      this.reactorReadyEpoch = epoch;
      this.reactorReadyFailure = undefined;
      if (this.costState.phase === 'inactive') {
        this.costState = {
          phase: 'billable',
          startedAtMs: Date.now(),
          ...(this.costState.providerExpiresAtMs === undefined
            ? {}
            : { providerExpiresAtMs: this.costState.providerExpiresAtMs }),
        };
      }
    }
    await this.waitForReactorReady(epoch);
  }

  private startReconnectLoop(epoch: number, retryAfter?: number): void {
    if (!this.isCurrent(epoch) || this.reconnectPromise) return;
    const generation = ++this.reconnectGeneration;
    const deadline = Date.now() + RECONNECT_DEADLINE_MS;
    this.reconnectDeadline = deadline;
    const loop = this.runReconnectLoop(epoch, generation, clampReconnectDelay(retryAfter));
    this.reconnectPromise = loop.finally(() => {
      if (this.reconnectGeneration !== generation) return;
      this.reconnectPromise = undefined;
      this.reconnectDeadline = undefined;
    });
  }

  private async runReconnectLoop(
    epoch: number,
    generation: number,
    initialDelay: number,
  ): Promise<void> {
    let delay = initialDelay;
    while (
      this.isCurrent(epoch)
      && this.reconnectGeneration === generation
      && this.reconnectReplayPending
    ) {
      const deadline = this.reconnectDeadline ?? Date.now();
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await this.waitForReconnectDelay(Math.min(delay, remaining));
      if (
        !this.isCurrent(epoch)
        || this.reconnectGeneration !== generation
        || !this.reconnectReplayPending
      ) {
        return;
      }

      const client = this.client;
      if (!client) return;
      if (typeof client.reconnect !== 'function') {
        this.fail('transport', 'Reactor client does not support reconnect');
        return;
      }
      try {
        await client.reconnect();
      } catch (error) {
        const metadata = reactorErrorMetadata(error);
        if (!metadata.recoverable) {
          this.fail('transport', metadata.message);
          return;
        }
        delay = clampReconnectDelay(metadata.retryAfter ?? delay * 2);
        continue;
      }
      if (!this.isCurrent(epoch) || this.reconnectGeneration !== generation) return;
      if (client.getStatus() === 'ready') {
        this.handleReconnectReady(epoch);
        return;
      }
      delay = clampReconnectDelay(delay * 2);
    }

    if (
      this.isCurrent(epoch)
      && this.reconnectGeneration === generation
      && this.reconnectReplayPending
    ) {
      this.fail('transport', 'Backend reconnect deadline exceeded');
    }
  }

  private handleReconnectReady(epoch: number): void {
    if (!this.isCurrent(epoch) || !this.reconnectReplayPending) return;
    this.reconnectReplayPending = false;
    this.cancelReconnectLoop();
    this.resetRequested = true;
    if (this.current) void this.reconcile(this.current);
  }

  private cancelReconnectLoop(): void {
    this.reconnectGeneration += 1;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    const resolveDelay = this.reconnectDelayResolve;
    this.reconnectDelayResolve = undefined;
    resolveDelay?.();
    this.reconnectDeadline = undefined;
    this.reconnectPromise = undefined;
  }

  private waitForReconnectDelay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      const finish = () => {
        this.reconnectTimer = undefined;
        this.reconnectDelayResolve = undefined;
        resolve();
      };
      this.reconnectDelayResolve = finish;
      this.reconnectTimer = setTimeout(finish, milliseconds);
    });
  }

  private async resetAndSeed(epoch: number, resetFirst: boolean): Promise<void> {
    const client = this.client;
    const current = this.current;
    if (!client || !current || !this.isCurrent(epoch)) return;
    this.flushedCamera = undefined;
    this.desiredCamera = current.snapshot.camera;
    this.poseActive = false;
    this.flushedEffectOffset = [0, 0, 0];
    this.timelines.clear();
    this.latchedPrompts.clear();
    this.pendingMouseYaw = 0;
    this.pendingMousePitch = 0;
    this.semanticMoveSinceFlush = false;
    this.semanticLookSinceFlush = false;
    this.lastControls = undefined;
    this.lastPrompt = undefined;
    this.conditionsReady = false;
    this.conditionFailure = undefined;
    this.resetFailure = undefined;
    this.imageAcceptedEpoch = undefined;
    this.imageFailure = undefined;
    this.failedEpoch = undefined;
    this.rejectAllWaiters(new ReactorOperationCancelledError(
      'Backend work was superseded by a new image prior',
    ));
    this.reconnectReplayPending = false;
    if (resetFirst) {
      this.resetAcknowledgedEpoch = undefined;
      this.publish({ phase: 'waiting', activity: 'Resetting the session for the selected image prior.' });
      await client.reset();
      await this.waitForGenerationReset(epoch);
      if (!this.isCurrent(epoch)) return;
    }
    this.publish({ phase: 'waiting', activity: 'Loading the selected game image prior.' });
    const seed = await this.captureSeedImage(current);
    if (!this.isCurrent(epoch)) return;
    const file = new File([seed], 'forgeax-game-image-prior.jpg', { type: seed.type || 'image/jpeg' });
    this.publish({ phase: 'waiting', activity: 'Uploading the selected image prior.' });
    const ref = await client.uploadFile(file);
    if (!this.isCurrent(epoch)) return;
    this.publish({ phase: 'waiting', activity: 'Requesting image conditioning.' });
    await client.setImage({ image: ref });
    await this.waitForImageAccepted(epoch);
    if (!this.isCurrent(epoch)) return;
    await this.applyLiveControls(epoch);
    if (!this.isCurrent(epoch)) return;
    await this.waitForReadyConditions(epoch);
    if (!this.isCurrent(epoch)) return;
    if (typeof client.setSeed === 'function') {
      await client.setSeed({ seed: current.direction.seed ?? 42 });
    }
    if (!this.isCurrent(epoch)) return;
    this.publish({ phase: 'waiting', activity: 'Starting generation and waiting for main_video.' });
    await client.start();
    this.seededEpoch = epoch;
    this.seededPriorKey = priorKey(current);
    this.seededSeed = current.direction.seed ?? 42;
    this.runtimeState = {
      ...(this.runtimeState ?? {}),
      started: true,
      running: true,
      paused: false,
      hasImage: true,
      hasPrompt: true,
      seed: this.seededSeed,
    };
  }

  private async applyLiveControls(epoch: number): Promise<void> {
    const client = this.client;
    const current = this.current;
    if (!client || !current || !this.isCurrent(epoch)) return;
    // Accumulate after reset/seed so a bootstrap clear cannot drop the latest deltas.
    this.accumulateMouseDeltas(current);
    await this.publishPrompt(epoch);
    if (!this.isCurrent(epoch)) return;
    const rotationSpeedDeg = current.direction.rotationSpeedDeg ?? 5;
    if (
      this.lastRotationSpeedDeg !== rotationSpeedDeg
      && typeof client.setRotationSpeedDeg === 'function'
    ) {
      await client.setRotationSpeedDeg({ rotation_speed_deg: rotationSpeedDeg });
      this.lastRotationSpeedDeg = rotationSpeedDeg;
    }
    if (!this.isCurrent(epoch)) return;
    if (
      current.direction.attentionWindow !== undefined
      && this.lastAttentionWindow !== current.direction.attentionWindow
      && typeof client.setAttnWindow === 'function'
    ) {
      await client.setAttnWindow({ attn_window: current.direction.attentionWindow });
      this.lastAttentionWindow = current.direction.attentionWindow;
    }
    if (
      current.direction.kvCacheResetMode !== undefined
      && typeof client.sendCommand === 'function'
      && this.lastKvCacheResetMode !== current.direction.kvCacheResetMode
    ) {
      await client.sendCommand('set_kv_cache_reset', {
        mode: current.direction.kvCacheResetMode,
      });
      this.lastKvCacheResetMode = current.direction.kvCacheResetMode;
    }
    if (
      current.direction.kvCacheResetSequence !== undefined
      && current.direction.kvCacheResetSequence > (this.consumedKvCacheResetSequence ?? -1)
      && current.direction.kvCacheResetMode !== 'off'
      && typeof client.sendCommand === 'function'
    ) {
      await client.sendCommand('trigger_kv_cache_reset', {});
      this.consumedKvCacheResetSequence = current.direction.kvCacheResetSequence;
    }
    if (!this.isCurrent(epoch)) return;
    const controls = projectLingbotControls(current.effectFrame);
    const previousMoveActive = this.lastControls
      ? this.lastControls.moveLongitudinal !== 'idle' || this.lastControls.moveLateral !== 'idle'
      : false;
    this.semanticMoveSinceFlush ||= controls.moveLongitudinal !== 'idle'
      || controls.moveLateral !== 'idle'
      || previousMoveActive;
    if (!controlsEqual(this.lastControls, controls)) {
      await Promise.all([
        client.setMoveLongitudinal({ move_longitudinal: controls.moveLongitudinal }),
        client.setMoveLateral({ move_lateral: controls.moveLateral }),
      ]);
      this.lastControls = controls;
    }
    if (!this.isCurrent(epoch)) return;
    this.desiredCamera = current.snapshot.camera;
  }

  private async applyPlayback(
    epoch: number,
    desired: VisualPlaybackIntent,
  ): Promise<void> {
    const client = this.client;
    if (!client || !this.isCurrent(epoch)) return;
    const runtime = this.runtimeState;
    if (desired === 'paused') {
      if (runtime?.paused) return;
      if (typeof client.pause === 'function') {
        await client.pause();
      }
      if (!this.isCurrent(epoch)) return;
      this.runtimeState = {
        ...(this.runtimeState ?? { started: true, hasImage: true, hasPrompt: true }),
        started: true,
        running: false,
        paused: true,
      };
      return;
    }
    if (!runtime?.paused) return;
    if (typeof client.resume === 'function') {
      await client.resume();
    }
    if (!this.isCurrent(epoch)) return;
    this.runtimeState = {
      ...(this.runtimeState ?? { started: true, hasImage: true, hasPrompt: true }),
      started: true,
      running: true,
      paused: false,
    };
  }

  private async disconnect(): Promise<void> {
    const client = this.client;
    const onStatusChanged = this.onStatusChanged;
    // #region agent log
    fetch('http://127.0.0.1:7823/ingest/da340269-854a-4c93-8ba0-c179d99ee400',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cb69a8'},body:JSON.stringify({sessionId:'cb69a8',runId:'stop-pre-fix',hypothesisId:'E,G,H',location:'lingbot-world-2.ts:disconnect',message:'Adapter disconnect entered',data:{disposed:this.disposed,costPhase:this.costState.phase,hasClient:client!==undefined,clientStatus:client?.getStatus(),reconnectPending:this.reconnectReplayPending},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    this.cancelReconnectLoop();
    this.reconnectReplayPending = false;
    if (this.costState.phase === 'billable') {
      this.costState = {
        ...this.costState,
        phase: 'stopping',
      };
      this.publish({ activity: 'Stopping and releasing GPU…' });
    }
    this.client = undefined;
    this.onStatusChanged = undefined;
    this.stopMainVideo?.();
    this.stopMainVideo = undefined;
    this.stopCommandErrors?.();
    this.stopCommandErrors = undefined;
    this.stopMessages?.();
    this.stopMessages = undefined;
    this.stopErrors?.();
    this.stopErrors = undefined;
    this.rejectAllWaiters(new ReactorOperationCancelledError(
      'Backend session disconnected before its pending operation completed',
    ));
    this.media = undefined;
    this.flushedCamera = undefined;
    this.desiredCamera = undefined;
    this.poseActive = false;
    this.timelines.clear();
    this.latchedPrompts.clear();
    this.pendingMouseYaw = 0;
    this.pendingMousePitch = 0;
    this.semanticMoveSinceFlush = false;
    this.semanticLookSinceFlush = false;
    this.lastControls = undefined;
    this.lastPrompt = undefined;
    this.coordinatorUrl = undefined;
    this.conditionsReady = false;
    this.conditionFailure = undefined;
    this.reactorReadyEpoch = undefined;
    this.reactorReadyFailure = undefined;
    this.resetAcknowledgedEpoch = undefined;
    this.resetFailure = undefined;
    this.imageAcceptedEpoch = undefined;
    this.imageFailure = undefined;
    this.seededEpoch = undefined;
    this.seededPriorKey = undefined;
    this.seededSeed = undefined;
    this.consumedContinuityResetToken = undefined;
    this.failedEpoch = undefined;
    this.runtimeState = undefined;
    this.lastRotationSpeedDeg = undefined;
    this.lastAttentionWindow = undefined;
    this.lastKvCacheResetMode = undefined;
    this.consumedKvCacheResetSequence = undefined;
    this.lastPoseChunkIndex = undefined;
    this.status = { ...this.status, runtime: undefined };
    if (client) {
      if (onStatusChanged) client.off('statusChanged', onStatusChanged);
      try {
        await Promise.all([
          client.setMoveLongitudinal({ move_longitudinal: 'idle' }),
          client.setMoveLateral({ move_lateral: 'idle' }),
          client.setLookHorizontal({ look_horizontal: 'idle' }),
          client.setLookVertical({ look_vertical: 'idle' }),
          client.setCameraPose({ camera_pose: [] }),
        ]);
      } catch {
        // Disconnect is still required even if a closing data channel rejects.
      }
      try {
        // #region agent log
        fetch('http://127.0.0.1:7823/ingest/da340269-854a-4c93-8ba0-c179d99ee400',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cb69a8'},body:JSON.stringify({sessionId:'cb69a8',runId:'stop-pre-fix',hypothesisId:'E',location:'lingbot-world-2.ts:disconnect:client',message:'Calling SDK disconnect',data:{disposed:this.disposed,costPhase:this.costState.phase,clientStatus:client.getStatus()},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        this.terminationHandshake = true;
        try {
          await client.disconnect();
        } finally {
          this.terminationHandshake = false;
        }
        // #region agent log
        fetch('http://127.0.0.1:7823/ingest/da340269-854a-4c93-8ba0-c179d99ee400',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cb69a8'},body:JSON.stringify({sessionId:'cb69a8',runId:'stop-pre-fix',hypothesisId:'E',location:'lingbot-world-2.ts:disconnect:client:after',message:'SDK disconnect returned',data:{clientStatus:client.getStatus()},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      } catch {
        // Disconnect is best effort; lease release still follows.
      }
    }
    await this.releaseLease();
    this.costState = { phase: 'stopped' };
  }

  private async fetchJwt(): Promise<{ readonly jwt: string; readonly coordinatorUrl: string }> {
    // #region agent log
    fetch('http://127.0.0.1:7823/ingest/da340269-854a-4c93-8ba0-c179d99ee400',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cb69a8'},body:JSON.stringify({sessionId:'cb69a8',runId:'stop-pre-fix',hypothesisId:'E,F,G,H',location:'lingbot-world-2.ts:fetchJwt',message:'Token fetch requested',data:{disposed:this.disposed,costPhase:this.costState.phase,hasClient:this.client!==undefined,clientStatus:this.client?.getStatus()},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (
      !this.terminationHandshake
      && (this.disposed || this.costState.phase === 'stopping' || this.costState.phase === 'stopped')
    ) {
      throw new ReactorOperationCancelledError(
        'LingBot session is stopping and must not renew its provider token',
      );
    }
    // #region agent log
    fetch('http://127.0.0.1:7823/ingest/da340269-854a-4c93-8ba0-c179d99ee400',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'cb69a8'},body:JSON.stringify({sessionId:'cb69a8',runId:'stop-post-fix',hypothesisId:'E',location:'lingbot-world-2.ts:fetchJwt:allowed',message:'Token fetch allowed',data:{terminationHandshake:this.terminationHandshake,disposed:this.disposed,costPhase:this.costState.phase},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const response = await fetch('/api/generative-visuals/reactor/tokens', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session: this.sessionId }),
    });
    const payload = await response.json().catch(() => ({})) as TokenResponse;
    if (!response.ok || typeof payload.jwt !== 'string' || payload.jwt.length === 0) {
      throw new Error(typeof payload.error === 'string' ? payload.error : `Session token request failed (${response.status})`);
    }
    if (typeof payload.leaseId === 'string') this.leaseId = payload.leaseId;
    if (typeof payload.expiresAt === 'number' && Number.isFinite(payload.expiresAt)) {
      this.costState = {
        ...this.costState,
        providerExpiresAtMs: payload.expiresAt * 1_000,
      };
    }
    const coordinatorUrl = coordinatorUrlFromPayload(payload.coordinatorUrl);
    if (this.coordinatorUrl && this.coordinatorUrl !== coordinatorUrl) {
      throw new Error('Backend endpoint changed while the session was active');
    }
    this.coordinatorUrl = coordinatorUrl;
    return {
      jwt: payload.jwt,
      coordinatorUrl,
    };
  }

  private async releaseLease(): Promise<void> {
    const leaseId = this.leaseId;
    this.leaseId = undefined;
    if (!leaseId) return;
    try {
      await fetch(`/api/generative-visuals/reactor/leases/${encodeURIComponent(leaseId)}/release`, {
        method: 'POST',
        credentials: 'same-origin',
      });
    } catch {
      // Server TTL still bounds abandoned browser sessions.
    }
  }

  private commandRejected(message: LingbotWorld2CommandErrorMessage, epoch: number): void {
    if (!this.isCurrent(epoch)) return;
    const failure = new Error(`${message.command}: ${message.reason}`);
    const liveCommand = message.command === 'set_move_longitudinal'
      || message.command === 'set_move_lateral'
      || message.command === 'set_look_horizontal'
      || message.command === 'set_look_vertical'
      || message.command === 'set_camera_pose'
      || message.command === 'set_rotation_speed_deg'
      || message.command === 'pause'
      || message.command === 'resume'
      || (message.command === 'set_prompt' && this.seededEpoch !== undefined);
    if (liveCommand) {
      this.publish({
        phase: 'degraded',
        activity: 'Backend rejected a live control; the next world update will retry it.',
        issue: { code: 'command-rejected', message: failure.message, retryable: true },
      });
      return;
    }
    if (message.command === 'set_image') {
      this.imageFailure = failure;
      this.rejectImageWaiter(failure);
    } else if (message.command === 'set_prompt') {
      this.conditionFailure = failure;
      this.rejectConditionWaiter(failure);
    } else if (message.command === 'reset') {
      this.resetFailure = failure;
      this.rejectResetWaiter(failure);
    }
    this.fail('command-rejected', failure.message);
  }

  private observeMessage(message: LingbotWorld2Message, epoch: number): void {
    if (!this.isCurrent(epoch)) return;
    if (this.failedEpoch === epoch) return;
    if (message.type === 'state') {
      this.runtimeState = {
        started: message.started,
        running: message.running,
        paused: message.paused,
        hasImage: message.has_image,
        hasPrompt: message.has_prompt,
        currentChunk: message.current_chunk,
        currentAction: message.current_action || 'still',
        currentPrompt: typeof message.current_prompt === 'string'
          ? message.current_prompt
          : undefined,
        seed: message.seed,
        rotationSpeedDeg: message.rotation_speed_deg,
        cameraPoseActive: message.camera_pose_active,
      };
      this.publish({ runtime: this.runtimeState });
    }
    if (message.type === 'generation_reset') {
      this.resetAcknowledgedEpoch = epoch;
      this.lastPoseChunkIndex = undefined;
      this.runtimeState = {
        started: false,
        running: false,
        paused: false,
        hasImage: false,
        hasPrompt: false,
        currentChunk: 0,
      };
      this.publish({ runtime: this.runtimeState });
      this.resolveResetWaiter(epoch);
      return;
    }
    if (message.type === 'image_accepted') {
      this.imageAcceptedEpoch = epoch;
      this.imageFailure = undefined;
      this.resolveImageWaiter(epoch);
      return;
    }
    if (message.type === 'chunk_complete') {
      this.runtimeState = {
        ...(this.runtimeState ?? { started: true, running: true, paused: false }),
        currentChunk: message.chunk_index,
        currentAction: message.active_action || 'still',
        currentPrompt: message.active_prompt,
      };
      this.publish({ runtime: this.runtimeState });
      if (
        message.chunk_index !== undefined
        && this.lastPoseChunkIndex === message.chunk_index
      ) return;
      if (message.chunk_index !== undefined) {
        this.lastPoseChunkIndex = message.chunk_index;
      }
      // Sample the current chunk first (ticks = chunks already completed), then
      // advance so the next provider tick sees the next latent window — matching
      // the reference app's send-then-advance cadence on chunk_complete.
      void this.enqueue(async () => {
        await this.flushCameraPose(epoch);
        const promptsChanged = this.advanceTimelines();
        if (promptsChanged) await this.publishPrompt(epoch);
      });
      return;
    }
    if (message.type === 'generation_started') {
      this.lastPoseChunkIndex = undefined;
      this.runtimeState = {
        ...(this.runtimeState ?? { hasImage: true, hasPrompt: true }),
        started: true,
        running: true,
        paused: false,
        currentPrompt: message.prompt,
      };
      this.publish({ runtime: this.runtimeState });
    } else if (message.type === 'generation_paused') {
      this.runtimeState = {
        ...(this.runtimeState ?? { started: true }),
        started: true,
        running: false,
        paused: true,
        currentChunk: message.chunk_index,
      };
      this.publish({ runtime: this.runtimeState });
    } else if (message.type === 'generation_resumed') {
      this.runtimeState = {
        ...(this.runtimeState ?? { started: true }),
        started: true,
        running: true,
        paused: false,
        currentChunk: message.chunk_index,
      };
      this.publish({ runtime: this.runtimeState });
    } else if (message.type === 'generation_complete') {
      this.runtimeState = {
        ...(this.runtimeState ?? { hasImage: true, hasPrompt: true }),
        started: false,
        running: false,
        paused: false,
        currentChunk: message.total_chunks,
      };
      this.publish({ runtime: this.runtimeState });
    }
    const ready = (message.type === 'conditions_ready' || message.type === 'state')
      && message.has_image
      && message.has_prompt;
    if (!ready) return;
    this.conditionsReady = true;
    this.conditionFailure = undefined;
    const waiter = this.conditionWaiter;
    if (waiter?.epoch !== epoch) return;
    clearTimeout(waiter.timeout);
    this.conditionWaiter = undefined;
    waiter.resolve();
  }

  private fail(
    code: 'backend-unavailable'
      | 'command-rejected'
      | 'missing-input'
      | 'unsupported-input'
      | 'transport',
    message: string,
  ): void {
    this.failedEpoch = this.sessionEpoch;
    this.publish({
      phase: 'failed',
      activity: 'Session failed; retry after reviewing the message.',
      issue: { code, message, retryable: code !== 'unsupported-input' },
    });
  }

  private waitForReadyConditions(epoch: number): Promise<void> {
    if (this.conditionsReady) return Promise.resolve();
    if (this.conditionFailure) return Promise.reject(this.conditionFailure);
    this.rejectConditionWaiter(new Error('Superseded by a newer backend condition wait'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.conditionWaiter?.epoch !== epoch) return;
        this.conditionWaiter = undefined;
        const failure = new Error('Backend did not accept the seed image and prompt within the configured timeout');
        this.conditionFailure = failure;
        reject(failure);
      }, this.waitTimeoutMs);
      this.conditionWaiter = { epoch, resolve, reject, timeout };
    });
  }

  private waitForReactorReady(epoch: number): Promise<void> {
    if (this.reactorReadyEpoch === epoch) return Promise.resolve();
    if (this.reactorReadyFailure) return Promise.reject(this.reactorReadyFailure);
    this.rejectReadyWaiter(new Error('Superseded by a newer backend ready wait'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.readyWaiter?.epoch !== epoch) return;
        this.readyWaiter = undefined;
        const failure = new Error('Backend did not become ready within the configured timeout');
        this.reactorReadyFailure = failure;
        reject(failure);
      }, this.waitTimeoutMs);
      this.readyWaiter = { epoch, resolve, reject, timeout };
    });
  }

  private resolveReadyWaiter(epoch: number): void {
    const waiter = this.readyWaiter;
    if (waiter?.epoch !== epoch) return;
    clearTimeout(waiter.timeout);
    this.readyWaiter = undefined;
    waiter.resolve();
  }

  private rejectReadyWaiter(reason: Error): void {
    const waiter = this.readyWaiter;
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    this.readyWaiter = undefined;
    waiter.reject(reason);
  }

  private waitForGenerationReset(epoch: number): Promise<void> {
    if (this.resetAcknowledgedEpoch === epoch) return Promise.resolve();
    if (this.resetFailure) return Promise.reject(this.resetFailure);
    this.rejectResetWaiter(new Error('Superseded by a newer backend reset wait'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.resetWaiter?.epoch !== epoch) return;
        this.resetWaiter = undefined;
        const failure = new Error('Backend did not acknowledge reset within the configured timeout');
        this.resetFailure = failure;
        reject(failure);
      }, this.waitTimeoutMs);
      this.resetWaiter = { epoch, resolve, reject, timeout };
    });
  }

  private resolveResetWaiter(epoch: number): void {
    const waiter = this.resetWaiter;
    if (waiter?.epoch !== epoch) return;
    clearTimeout(waiter.timeout);
    this.resetWaiter = undefined;
    waiter.resolve();
  }

  private rejectResetWaiter(reason: Error): void {
    const waiter = this.resetWaiter;
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    this.resetWaiter = undefined;
    waiter.reject(reason);
  }

  private waitForImageAccepted(epoch: number): Promise<void> {
    if (this.imageAcceptedEpoch === epoch) return Promise.resolve();
    if (this.imageFailure) return Promise.reject(this.imageFailure);
    this.rejectImageWaiter(new Error('Superseded by a newer backend image wait'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.imageWaiter?.epoch !== epoch) return;
        this.imageWaiter = undefined;
        const failure = new Error('Backend did not accept the seed image within the configured timeout');
        this.imageFailure = failure;
        reject(failure);
      }, this.waitTimeoutMs);
      this.imageWaiter = { epoch, resolve, reject, timeout };
    });
  }

  private resolveImageWaiter(epoch: number): void {
    const waiter = this.imageWaiter;
    if (waiter?.epoch !== epoch) return;
    clearTimeout(waiter.timeout);
    this.imageWaiter = undefined;
    waiter.resolve();
  }

  private rejectImageWaiter(reason: Error): void {
    const waiter = this.imageWaiter;
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    this.imageWaiter = undefined;
    waiter.reject(reason);
  }

  private rejectConditionWaiter(reason: Error): void {
    const waiter = this.conditionWaiter;
    if (!waiter) return;
    clearTimeout(waiter.timeout);
    this.conditionWaiter = undefined;
    waiter.reject(reason);
  }

  private rejectAllWaiters(reason: Error): void {
    this.rejectReadyWaiter(reason);
    this.rejectResetWaiter(reason);
    this.rejectImageWaiter(reason);
    this.rejectConditionWaiter(reason);
  }

  private accumulateMouseDeltas(input: ResolvedVisualRequest): void {
    const signals = input.effectFrame?.signals;
    const yaw = signals?.['input.mouse-yaw-delta'];
    const pitch = signals?.['input.mouse-pitch-delta'];
    if (typeof yaw === 'number') this.pendingMouseYaw += yaw;
    if (typeof pitch === 'number') this.pendingMousePitch += pitch;
  }

  private registerTimelines(timelines: readonly ResolvedMotionTimeline[]): void {
    for (const timeline of timelines) {
      if (this.timelines.has(timeline.sourceId)) continue;
      this.timelines.set(timeline.sourceId, { definition: timeline, chunksCompleted: 0 });
      if (timeline.boundPrompts.length) {
        this.latchedPrompts.set(timeline.sourceId, timeline.boundPrompts);
      }
    }
  }

  /** Advances provider-confirmed progress. Returns true when latched prompts changed. */
  private advanceTimelines(): boolean {
    if (this.runtimeState?.paused) return false;
    let promptsChanged = false;
    for (const [sourceId, state] of [...this.timelines]) {
      state.chunksCompleted += 1;
      if (state.chunksCompleted < state.definition.durationChunks) continue;
      this.timelines.delete(sourceId);
      if (this.latchedPrompts.delete(sourceId)) promptsChanged = true;
    }
    return promptsChanged;
  }

  private sampledLatentTimelineMotion(): ResolvedMotionValue[][] {
    type Candidate = ResolvedMotionValue & {
      readonly blend: 'add' | 'replace';
      readonly priority: number;
      readonly sourceId: string;
    };
    const perLatent: Candidate[][] = Array.from({ length: LINGBOT_CHUNK_LATENTS }, () => []);
    for (const [sourceId, state] of this.timelines) {
      const { definition, chunksCompleted } = state;
      const duration = Math.max(1, definition.durationChunks);
      for (let latent = 0; latent < LINGBOT_CHUNK_LATENTS; latent += 1) {
        const progress = Math.min(
          1,
          (chunksCompleted + (latent + 0.5) / LINGBOT_CHUNK_LATENTS) / duration,
        );
        perLatent[latent]!.push({
          target: definition.target,
          value: sampleTimelineValue(definition, progress),
          blend: definition.blend,
          priority: definition.priority,
          sourceId,
        });
      }
    }
    return perLatent.map((candidates) => (
      [...blendTimelineSamples(candidates)].map(([target, value]) => ({ target, value }))
    ));
  }

  private async publishPrompt(epoch: number): Promise<void> {
    const client = this.client;
    const current = this.current;
    if (!client || !current || !this.isCurrent(epoch) || !current.effectFrame) return;
    const latched = [...this.latchedPrompts.values()].flat();
    const mergedPrompt = mergeLatchedPrompts(
      current.effectFrame.prompt,
      latched,
      current.presentation?.promptOrder ?? [],
    );
    const prompt = composeLingbotWorld2Prompt(current.direction, {
      ...current.effectFrame,
      prompt: mergedPrompt,
    }).prompt;
    if (prompt === this.lastPrompt) return;
    this.publish({
      phase: this.media ? 'live' : 'waiting',
      activity: 'Sending creative direction.',
    });
    await client.setPrompt({ prompt });
    this.lastPrompt = prompt;
  }

  private async flushCameraPose(epoch: number): Promise<void> {
    const client = this.client;
    const desired = this.desiredCamera;
    if (!client || !this.isCurrent(epoch)) return;
    const mouseDelta = {
      yaw: this.pendingMouseYaw,
      pitch: this.pendingMousePitch,
    };
    const semantic = semanticCameraPose(
      this.current,
      this.flushedEffectOffset,
      this.sampledLatentTimelineMotion(),
      mouseDelta,
    );
    this.pendingMouseYaw = 0;
    this.pendingMousePitch = 0;
    this.flushedEffectOffset = semantic.offset;
    if (semantic.pose.length) {
      this.flushedCamera = desired;
      this.semanticMoveSinceFlush = false;
      this.semanticLookSinceFlush = false;
      await client.setCameraPose({ camera_pose: semantic.pose });
      this.poseActive = true;
      return;
    }
    if (!this.flushedCamera || !desired) {
      this.flushedCamera = desired;
      this.semanticMoveSinceFlush = false;
      this.semanticLookSinceFlush = false;
      return;
    }
    const pose = cameraPose(this.flushedCamera, desired, {
      move: this.semanticMoveSinceFlush,
      look: this.semanticLookSinceFlush,
    });
    this.flushedCamera = desired;
    this.semanticMoveSinceFlush = false;
    this.semanticLookSinceFlush = false;
    if (pose.length) {
      await client.setCameraPose({ camera_pose: pose });
      this.poseActive = true;
    } else if (this.poseActive) {
      await client.setCameraPose({ camera_pose: [] });
      this.poseActive = false;
    }
  }

  private isCurrent(epoch: number): boolean {
    return !this.disposed && this.sessionEpoch === epoch;
  }

  private publish(next: Partial<VisualPresentationStatus>): void {
    this.status = {
      ...this.status,
      ...next,
      ...((next.phase === 'live' || next.phase === 'connecting' || next.phase === 'waiting')
        ? { issue: undefined } : {}),
      backendId: 'reactor-lingbot-world-2',
      profileId: 'navigable-world',
      ...(this.current?.snapshot.stamp?.intentRevision !== undefined
        ? { appliedIntentRevision: this.current.snapshot.stamp.intentRevision } : {}),
      ...(this.current?.snapshot.stamp
        ? { appliedTransitionSequence: this.current.snapshot.stamp.transitionSequence } : {}),
      runtime: next.runtime ?? this.runtimeState,
    };
    for (const listener of this.listeners) listener();
  }
}

export class LingbotWorld2Adapter implements VisualBackendAdapter {
  readonly descriptor = LINGBOT_WORLD_2_DESCRIPTOR;
  readonly capabilities = {
    prompt: true,
    motionTargets: new Set([
      'navigation.forward-rate',
      'navigation.strafe-rate',
      'camera.rotation.pitch-rate',
      'camera.rotation.yaw-rate',
      'camera.rotation.roll-rate',
      'camera.translation.x-rate',
      'camera.translation.y-rate',
      'camera.translation.z-rate',
      'camera.offset.x',
      'camera.offset.y',
      'camera.offset.z',
      'camera.orbit.radius',
    ] as const),
  };

  constructor(
    private readonly createClient: LingbotClientFactory = ({ apiUrl }) => new LingbotWorld2Model({ apiUrl }),
    private readonly captureSeedImage: (input: ResolvedVisualRequest) => Promise<Blob> = async (input) => {
      if (!input.seedImage) {
        throw new MissingVisualInputError(
          'LingBot World 2 requires a resolved game image prior before connecting',
        );
      }
      return input.seedImage.blob;
    },
    private readonly waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ) {}

  createSession(options: { readonly profileId: string; readonly direction: VisualDirection }): VisualBackendSession {
    if (options.profileId !== 'navigable-world') {
      throw new Error(`LingBot World 2 does not provide profile ${options.profileId}`);
    }
    return new LingbotWorld2Session(this.createClient, this.captureSeedImage, this.waitTimeoutMs);
  }
}
