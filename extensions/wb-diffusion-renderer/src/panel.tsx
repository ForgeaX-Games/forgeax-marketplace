import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { VisualBackendProfile, VisualSessionPhase } from '@forgeax/types/visual-generation';
import type {
  VisualBackendAdapter,
  VisualDirection,
  VisualSource,
} from './adapter';
import {
  GenerativeVisualsPresenter,
} from './presenter';
import { firstSelection, profileRequiresSeedImage } from './selection';
import {
  canRetryIssue,
  costWarning,
  formatSessionClock,
  panelStatusText,
  stopReasonText,
} from './status';

export const WB_DIFFUSION_RENDERER_PLUGIN_ID = '@forgeax-extension/wb-diffusion-renderer';
export { firstSelection } from './selection';
export {
  canRetryIssue,
  costWarning,
  formatSessionClock,
  panelStatusText,
  phaseStatusLabel,
  stopReasonText,
} from './status';

export interface GenerativeVisualsRuntime {
  createSource(): VisualSource;
  readonly adapters: readonly VisualBackendAdapter[];
}

// Games own the initial scene prompt. This remains an optional panel-level
// modifier so fixture smoke and the first Studio run send identical prose.
const DEFAULT_DIRECTION = '';

type DirectionQuality = NonNullable<VisualDirection['quality']>;

function parseSeed(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseRotationSpeed(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 30 ? parsed : undefined;
}

function directionForProfile(
  profile: VisualBackendProfile,
  prompt: string,
  quality: DirectionQuality,
  seedText: string,
  rotationSpeedText: string,
  attentionWindow: NonNullable<VisualDirection['attentionWindow']>,
  kvCacheResetMode: NonNullable<VisualDirection['kvCacheResetMode']>,
  kvCacheResetSequence: number,
): VisualDirection | undefined {
  const controls = new Set(profile.controls ?? []);
  const seed = parseSeed(seedText);
  const rotationSpeedDeg = parseRotationSpeed(rotationSpeedText);
  if (controls.has('seed') && seedText.trim() && seed === undefined) return undefined;
  if (controls.has('rotation-speed') && rotationSpeedText.trim() && rotationSpeedDeg === undefined) return undefined;
  return {
    prompt: controls.has('prompt') ? prompt.trim() || DEFAULT_DIRECTION : DEFAULT_DIRECTION,
    ...(controls.has('quality') ? { quality } : {}),
    ...(controls.has('seed') && seed !== undefined ? { seed } : {}),
    ...(controls.has('rotation-speed') && rotationSpeedDeg !== undefined ? { rotationSpeedDeg } : {}),
    ...(controls.has('attention-window') ? { attentionWindow } : {}),
    ...(controls.has('kv-cache-reset')
      ? { kvCacheResetMode, kvCacheResetSequence }
      : {}),
  };
}

function usePresenter(runtime: GenerativeVisualsRuntime) {
  const presenterRef = useRef<GenerativeVisualsPresenter | undefined>(undefined);
  const pendingDisposalRef = useRef<{
    cancelled: boolean;
    presenter: GenerativeVisualsPresenter;
  } | undefined>(undefined);
  const [, redraw] = useState(0);
  if (!presenterRef.current) {
    presenterRef.current = new GenerativeVisualsPresenter(runtime.createSource(), runtime.adapters);
  }
  const presenter = presenterRef.current;
  useEffect(() => {
    // React Strict Mode runs an effect setup → cleanup → setup probe in
    // development. Defer permanent disposal by one microtask so the second
    // setup can cancel it instead of reusing a presenter that the probe
    // already destroyed.
    if (pendingDisposalRef.current?.presenter === presenter) {
      pendingDisposalRef.current.cancelled = true;
    }
    const release = presenter.subscribe(() => redraw((revision) => revision + 1));
    return () => {
      release();
      const pending = { cancelled: false, presenter };
      pendingDisposalRef.current = pending;
      queueMicrotask(() => {
        if (!pending.cancelled) void presenter.dispose();
      });
    };
  }, [presenter]);
  return presenter;
}

function OutputVideo({ stream }: { stream: MediaStream | undefined }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream ?? null;
    if (stream) void video.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} muted autoPlay playsInline style={styles.video} aria-label="Generated visual output" />;
}

/** Studio injects source + adapters. This panel renders only the controls
 * declared by the selected profile; the game publishes semantic state only. */
export function GenerativeVisualsPanel({ runtime }: { runtime: GenerativeVisualsRuntime }) {
  const presenter = usePresenter(runtime);
  const snapshot = presenter.getSnapshot();
  const initial = snapshot.selection ?? firstSelection(runtime, {
    priorCatalogAvailable: snapshot.priorCatalogAvailable,
  });
  const [backendId, setBackendId] = useState(initial.backendId);
  const [profileId, setProfileId] = useState(initial.profileId);
  const [prompt, setPrompt] = useState(initial.direction.prompt);
  const [quality, setQuality] = useState<DirectionQuality>(initial.direction.quality ?? 'realtime');
  const [seedText, setSeedText] = useState(initial.direction.seed?.toString() ?? '42');
  const [rotationSpeedText, setRotationSpeedText] = useState(
    initial.direction.rotationSpeedDeg?.toString() ?? '5',
  );
  const [attentionWindow, setAttentionWindow] = useState<NonNullable<VisualDirection['attentionWindow']>>(
    initial.direction.attentionWindow ?? 'auto',
  );
  const [kvCacheResetMode, setKvCacheResetMode] = useState<NonNullable<VisualDirection['kvCacheResetMode']>>(
    initial.direction.kvCacheResetMode ?? 'auto',
  );
  const [kvCacheResetSequence, setKvCacheResetSequence] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [userPickedBackend, setUserPickedBackend] = useState(false);
  const selectedDescriptor = snapshot.descriptors.find((descriptor) => descriptor.id === backendId);
  const profiles = selectedDescriptor?.profiles ?? [];
  const selectedProfile = profiles.find((candidate) => candidate.id === profileId) ?? profiles[0];
  const controls = new Set(selectedProfile?.controls ?? []);
  const seedInvalid = controls.has('seed') && Boolean(seedText.trim()) && parseSeed(seedText) === undefined;
  const rotationSpeedInvalid = controls.has('rotation-speed')
    && Boolean(rotationSpeedText.trim())
    && parseRotationSpeed(rotationSpeedText) === undefined;
  const providerState = snapshot.status.runtime ?? {};
  const live = snapshot.status.phase === 'connecting'
    || snapshot.status.phase === 'waiting'
    || snapshot.status.phase === 'live';
  const paused = providerState.paused === true;
  const canPause = live && providerState.started === true && !paused;
  const canResume = live && paused;
  const retryable = canRetryIssue({
    phase: snapshot.status.phase,
    issue: snapshot.status.issue,
  });
  const sessionClock = formatSessionClock(snapshot.cost);
  const warning = costWarning(snapshot.cost, paused);

  useEffect(() => {
    if (userPickedBackend || snapshot.selection || live) return;
    if (snapshot.priorCatalogAvailable !== false) return;
    if (!profileRequiresSeedImage(selectedProfile)) return;
    const next = firstSelection(runtime, { priorCatalogAvailable: false });
    setBackendId(next.backendId);
    setProfileId(next.profileId);
  }, [
    live,
    runtime,
    selectedProfile,
    snapshot.priorCatalogAvailable,
    snapshot.selection,
    userPickedBackend,
  ]);

  useEffect(() => {
    const onVisibilityChange = () => presenter.setPageVisible(!document.hidden);
    const onPageHide = () => { void presenter.stop('pagehide'); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    onVisibilityChange();
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [presenter]);

  const start = () => {
    const profile = selectedProfile;
    if (!profile) return;
    const direction = directionForProfile(
      profile,
      prompt,
      quality,
      seedText,
      rotationSpeedText,
      attentionWindow,
      kvCacheResetMode,
      kvCacheResetSequence,
    );
    if (!direction) return;
    setProfileId(profile.id);
    void presenter.select({
      backendId,
      profileId: profile.id,
      direction,
    });
    setSettingsOpen(false);
  };

  const retry = () => {
    if (!retryable || !selectedProfile) return;
    const direction = directionForProfile(
      selectedProfile,
      prompt,
      quality,
      seedText,
      rotationSpeedText,
      attentionWindow,
      kvCacheResetMode,
      kvCacheResetSequence,
    )
      ?? snapshot.selection?.direction;
    if (!direction) return;
    void presenter.select({
      backendId: snapshot.selection?.backendId ?? backendId,
      profileId: snapshot.selection?.profileId ?? selectedProfile.id,
      direction,
    });
  };

  const switchBackend = (nextBackendId: string) => {
    const next = snapshot.descriptors.find((descriptor) => descriptor.id === nextBackendId);
    const profile = next?.profiles[0];
    if (!profile) return;
    setUserPickedBackend(true);
    setBackendId(nextBackendId);
    setProfileId(profile.id);
  };

  const applyDirection = (nextKvCacheResetSequence = kvCacheResetSequence) => {
    if (!selectedProfile) return;
    const direction = directionForProfile(
      selectedProfile,
      prompt,
      quality,
      seedText,
      rotationSpeedText,
      attentionWindow,
      kvCacheResetMode,
      nextKvCacheResetSequence,
    );
    if (!direction) return;
    void presenter.updateDirection(direction);
  };
  const onPromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      applyDirection();
    }
  };
  const statusText = warning
    ?? (paused
      ? 'Paused'
      : panelStatusText({
      phase: snapshot.status.phase,
      issue: snapshot.status.issue,
      activity: snapshot.status.activity,
      }));
  const stoppedReason = stopReasonText(snapshot.cost.stopReason);

  return (
    <section style={styles.root} data-fx-diffusion-renderer-panel="1">
      <OutputVideo stream={snapshot.output} />
      {!snapshot.output && (
        <div style={styles.empty}>
          {snapshot.sourceAvailable
            ? 'Generated visuals will appear here.'
            : 'Open a game in the Studio viewport to provide visual state.'}
        </div>
      )}

      <div style={styles.topBar}>
        <span style={{ ...styles.dot, background: colorForPhase(snapshot.status.phase) }} />
        <strong style={styles.title}>Diffusion Renderer</strong>
        <span style={styles.status} title={statusText}>{statusText}</span>
        {sessionClock && <span style={styles.clock}>{sessionClock}</span>}
        <div style={styles.grow} />
        <button type="button" style={styles.secondaryButton} onClick={() => setSettingsOpen((open) => !open)}>
          {settingsOpen ? 'Hide settings' : 'Settings'}
        </button>
        {retryable && (
          <button type="button" style={styles.retryButton} onClick={retry} data-fx-diffusion-renderer-retry="1">
            Retry
          </button>
        )}
        {canPause && (
          <button type="button" style={styles.secondaryButton} onClick={() => void presenter.pause()}>
            Pause
          </button>
        )}
        {canResume && (
          <button type="button" style={styles.secondaryButton} onClick={() => void presenter.resume()}>
            Resume
          </button>
        )}
        {live && providerState.started === true && (
          <button type="button" style={styles.secondaryButton} onClick={() => void presenter.restart()}>
            Restart
          </button>
        )}
        {warning?.startsWith('Idle') && snapshot.cost.canExtendIdle && (
          <button type="button" style={styles.secondaryButton} onClick={() => presenter.extendIdle()}>
            Continue 60s
          </button>
        )}
        <button
          type="button"
          style={live ? styles.stopButton : styles.liveButton}
          onClick={() => (live ? void presenter.stop() : start())}
        >
          {live ? 'Stop' : 'Go Live'}
        </button>
      </div>

      {settingsOpen && (
        <div style={styles.settings}>
          <label style={styles.field}>
            <span>Backend</span>
            <select style={styles.input} value={backendId} onChange={(event) => switchBackend(event.target.value)}>
              {snapshot.descriptors.map((descriptor) => (
                <option key={descriptor.id} value={descriptor.id}>{descriptor.label}</option>
              ))}
            </select>
          </label>
          <label style={styles.field}>
            <span>Profile</span>
            <select style={styles.input} value={profileId} onChange={(event) => setProfileId(event.target.value)}>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.label}</option>
              ))}
            </select>
          </label>
          {controls.has('prompt') && (
            <label style={{ ...styles.field, gridColumn: '1 / -1' }}>
              <span>Creative direction</span>
              <textarea
                style={styles.textarea}
                rows={3}
                value={prompt}
                placeholder="Optional global art direction"
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={onPromptKeyDown}
              />
            </label>
          )}
          {controls.has('quality') && (
            <label style={styles.field}>
              <span>Budget</span>
              <select style={styles.input} value={quality} onChange={(event) => setQuality(event.target.value as DirectionQuality)}>
                <option value="realtime">Realtime</option>
                <option value="balanced">Balanced</option>
                <option value="quality">Quality</option>
              </select>
            </label>
          )}
          {controls.has('seed') && (
            <label style={styles.field}>
              <span>Seed</span>
              <input
                style={styles.input}
                type="number"
                step="1"
                value={seedText}
                aria-invalid={seedInvalid}
                onChange={(event) => setSeedText(event.target.value)}
              />
              {seedInvalid && <small style={styles.error}>Seed must be a safe integer.</small>}
            </label>
          )}
          {controls.has('rotation-speed') && (
            <label style={styles.field}>
              <span>Rotation speed</span>
              <input
                style={styles.input}
                type="number"
                min="0"
                max="30"
                step="0.5"
                value={rotationSpeedText}
                aria-invalid={rotationSpeedInvalid}
                onChange={(event) => setRotationSpeedText(event.target.value)}
              />
              {rotationSpeedInvalid && <small style={styles.error}>Use a value from 0 to 30.</small>}
            </label>
          )}
          {controls.has('attention-window') && (
            <label style={styles.field}>
              <span>Attention window</span>
              <select
                style={styles.input}
                value={attentionWindow}
                onChange={(event) => setAttentionWindow(event.target.value as typeof attentionWindow)}
              >
                <option value="auto">Auto</option>
                <option value="small">Small</option>
                <option value="large">Large</option>
              </select>
            </label>
          )}
          {controls.has('kv-cache-reset') && (
            <label style={styles.field}>
              <span>KV cache reset</span>
              <select
                style={styles.input}
                value={kvCacheResetMode}
                onChange={(event) => setKvCacheResetMode(event.target.value as typeof kvCacheResetMode)}
              >
                <option value="auto">Auto</option>
                <option value="manual">Manual</option>
                <option value="off">Off</option>
              </select>
            </label>
          )}
          {controls.has('kv-cache-reset') && (
            <div style={{ ...styles.field, justifyContent: 'end' }}>
              <button
                type="button"
                style={styles.secondaryButton}
                disabled={kvCacheResetMode === 'off'}
                onClick={() => {
                  const nextSequence = kvCacheResetSequence + 1;
                  setKvCacheResetSequence(nextSequence);
                  applyDirection(nextSequence);
                }}
              >
                Reset model cache
              </button>
            </div>
          )}
          <div style={{ ...styles.field, justifyContent: 'end' }}>
            <button type="button" style={styles.secondaryButton} onClick={() => applyDirection()}>Apply direction</button>
          </div>
          <div style={styles.hint}>
            The game remains authoritative. This panel consumes semantic intent, presentation programs, camera state, and viewport media only to produce a presentation stream.
          </div>
          {snapshot.manifestRevision && (
            <div style={styles.hint}>
              Manifest: {snapshot.manifestRevision}
            </div>
          )}
          {stoppedReason && (
            <div style={styles.hint}>
              Cost guard: {stoppedReason}
            </div>
          )}
          {Object.keys(providerState).length > 0 && (
            <div style={styles.hint}>
              Provider state: {typeof providerState.currentAction === 'string' ? providerState.currentAction : 'still'}
              {typeof providerState.currentChunk === 'number' ? ` · chunk ${providerState.currentChunk}` : ''}
              {providerState.currentPrompt ? ' · prompt accepted' : ''}
            </div>
          )}
          {snapshot.status.appliedTransitionSequence !== undefined && (
            <div style={styles.hint}>
              Applied transition: {snapshot.status.appliedTransitionSequence}
            </div>
          )}
          {snapshot.status.issue && (
            <div
              style={{
                ...styles.diagnostics,
                ...(snapshot.status.issue.retryable ? styles.diagnosticsRetryable : styles.diagnosticsFatal),
              }}
              data-fx-diffusion-renderer-diagnostics="1"
            >
              <strong>Status</strong>
              <span>{snapshot.status.issue.message}</span>
              {snapshot.status.issue.retryable && (
                <button type="button" style={styles.retryButton} onClick={retry}>
                  Retry without refreshing
                </button>
              )}
            </div>
          )}
          {snapshot.diagnostics.length > 0 && (
            <div style={{ ...styles.diagnostics, ...styles.diagnosticsRetryable }}>
              <strong>Effect diagnostics</strong>
              {snapshot.diagnostics.map((diagnostic, index) => (
                <span key={`${diagnostic.code}:${diagnostic.instanceId ?? ''}:${index}`}>
                  {diagnostic.message}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function colorForPhase(phase: VisualSessionPhase): string {
  if (phase === 'live') return 'var(--color-accent-green-default, #4FD17F)';
  if (phase === 'connecting' || phase === 'waiting') return 'var(--color-accent-orange-default, #FFB056)';
  if (phase === 'failed') return 'var(--color-accent-error-default, #F26A6A)';
  if (phase === 'degraded') return 'var(--color-accent-orange-default, #FFB056)';
  return 'var(--color-text-tertiary, rgba(255,255,255,0.30))';
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'relative',
    height: '100%',
    minHeight: 320,
    overflow: 'hidden',
    background: 'var(--color-background-canvas, #0D0D0D)',
    color: 'var(--color-text-primary, #FFFFFF)',
    font: '12px/1.45 ui-sans-serif, system-ui, sans-serif',
  },
  video: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    background: 'var(--color-background-canvas, #0D0D0D)',
  },
  empty: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    padding: 32,
    color: 'var(--color-text-secondary, rgba(255,255,255,0.60))',
    textAlign: 'center',
  },
  topBar: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    background: 'color-mix(in srgb, var(--color-background-elevated, #242424) 92%, transparent)',
    border: '1px solid var(--color-border-subtle, #333333)',
    borderRadius: 8,
    backdropFilter: 'blur(8px)',
  },
  dot: { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' },
  title: { color: 'var(--color-text-primary, #FFFFFF)' },
  status: {
    color: 'var(--color-text-secondary, rgba(255,255,255,0.60))',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  clock: {
    color: 'var(--color-text-tertiary, rgba(255,255,255,0.45))',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  grow: { flex: 1 },
  settings: {
    position: 'absolute',
    zIndex: 1,
    top: 58,
    right: 10,
    width: 'min(430px, calc(100% - 20px))',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
    padding: 12,
    background: 'color-mix(in srgb, var(--color-background-elevated, #242424) 96%, transparent)',
    border: '1px solid var(--color-border-subtle, #333333)',
    borderRadius: 8,
    backdropFilter: 'blur(10px)',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    color: 'var(--color-text-secondary, rgba(255,255,255,0.60))',
  },
  error: { color: 'var(--color-accent-error-default, #F26A6A)', fontSize: 10 },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: 5,
    border: '1px solid var(--color-border-default, #404040)',
    padding: '6px 7px',
    background: 'var(--color-background-floating, #333333)',
    color: 'var(--color-text-primary, #FFFFFF)',
  },
  textarea: {
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
    borderRadius: 5,
    border: '1px solid var(--color-border-default, #404040)',
    padding: '7px',
    background: 'var(--color-background-floating, #333333)',
    color: 'var(--color-text-primary, #FFFFFF)',
  },
  hint: {
    gridColumn: '1 / -1',
    color: 'var(--color-text-tertiary, rgba(255,255,255,0.30))',
    fontSize: 11,
  },
  diagnostics: {
    gridColumn: '1 / -1',
    display: 'grid',
    gap: 6,
    padding: '8px 9px',
    borderRadius: 5,
    fontSize: 11,
  },
  diagnosticsRetryable: {
    background: 'var(--color-accent-orange-soft, #633C10)',
    color: 'var(--color-accent-orange-default, #FFB056)',
    border: '1px solid color-mix(in srgb, var(--color-accent-orange-default, #FFB056) 35%, transparent)',
  },
  diagnosticsFatal: {
    background: 'var(--color-accent-error-soft, #5C1A1A)',
    color: 'var(--color-accent-error-default, #F26A6A)',
    border: '1px solid color-mix(in srgb, var(--color-accent-error-default, #F26A6A) 35%, transparent)',
  },
  secondaryButton: {
    border: '1px solid var(--color-border-default, #404040)',
    borderRadius: 5,
    padding: '5px 8px',
    background: 'var(--color-background-floating, #333333)',
    color: 'var(--color-text-primary, #FFFFFF)',
    cursor: 'pointer',
  },
  retryButton: {
    border: '1px solid color-mix(in srgb, var(--color-accent-orange-default, #FFB056) 50%, transparent)',
    borderRadius: 5,
    padding: '5px 8px',
    background: 'var(--color-accent-orange-soft, #633C10)',
    color: 'var(--color-accent-orange-default, #FFB056)',
    cursor: 'pointer',
  },
  liveButton: {
    border: '1px solid color-mix(in srgb, var(--color-brand-primary, #D4FF48) 45%, transparent)',
    borderRadius: 5,
    padding: '5px 9px',
    background: 'var(--color-brand-primary-soft, #6A7F24)',
    color: 'var(--color-brand-primary, #D4FF48)',
    cursor: 'pointer',
  },
  stopButton: {
    border: '1px solid color-mix(in srgb, var(--color-accent-error-default, #F26A6A) 45%, transparent)',
    borderRadius: 5,
    padding: '5px 9px',
    background: 'var(--color-accent-error-soft, #5C1A1A)',
    color: 'var(--color-accent-error-default, #F26A6A)',
    cursor: 'pointer',
  },
};
