import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { fetchDiffusionRendererMeta } from './host/meta';
import { isStreaming, startStream, stopStream, updateParams, type StreamStatus } from './host/stream';
import {
  getDiffusionRendererOutputSnapshot,
  setDiffusionRendererOutputTarget,
  setDiffusionRendererOutputVisible,
  subscribeDiffusionRendererOutput,
  type DiffusionRendererOutputSnapshot,
} from './host/output-store';

export const WB_DIFFUSION_RENDERER_PLUGIN_ID = '@forgeax-plugin/wb-diffusion-renderer';

const DEFAULT_PROMPT = 'photorealistic game screenshot, realistic PBR materials and lighting, natural global illumination, highly detailed, sharp focus, cinematic';
const FIXED_LORA = 'sim-to-real';
const OUTPUT_RES = '576x320';

export function DiffusionRendererPanel() {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [steps, setSteps] = useState('2');
  const [interp, setInterp] = useState('2');
  const [meta, setMeta] = useState('checking...');
  const [ready, setReady] = useState(false);
  const [stream, setStream] = useState<StreamStatus>({ state: isStreaming() ? 'live' : 'stopped' });
  const [output, setOutput] = useState<DiffusionRendererOutputSnapshot>(() => getDiffusionRendererOutputSnapshot());
  const [settingsOpen, setSettingsOpen] = useState(true);

  const params = () => ({
    prompt: prompt.trim() || DEFAULT_PROMPT,
    steps: parseInt(steps || '2', 10),
    interp: parseInt(interp || '0', 10),
    lora: FIXED_LORA,
    seed: 42,
  });

  useEffect(() => subscribeDiffusionRendererOutput(() => setOutput(getDiffusionRendererOutputSnapshot())), []);
  useEffect(() => {
    const img = imgRef.current;
    setDiffusionRendererOutputTarget(img);
    return () => {
      setDiffusionRendererOutputTarget(null);
      if (isStreaming()) stopStream();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const m = await fetchDiffusionRendererMeta();
      if (cancelled) return;
      setReady(m.ready);
      setMeta(m.statusText);
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (isStreaming()) updateParams(params());
  }, [prompt, steps, interp]);

  const start = () => {
    setDiffusionRendererOutputVisible(true);
    setSettingsOpen(false);
    setStream({ state: 'connecting' });
    void startStream(params(), setStream);
  };

  const toggleLive = () => {
    if (isStreaming()) {
      stopStream();
      return;
    }
    start();
  };

  const live = stream.state === 'live' || stream.state === 'connecting';
  const connecting = stream.state === 'connecting';
  const errored = stream.state === 'error' || stream.state === 'unauthorized' || stream.state === 'busy';

  const statusText =
    stream.state === 'live'
      ? 'live'
      : stream.state === 'connecting'
        ? 'connecting...'
        : stream.state === 'stopped'
          ? meta
          : stream.error ?? stream.state;
  const statusTone: 'ok' | 'warn' | 'bad' =
    stream.state === 'live' ? 'ok'
      : connecting ? 'warn'
        : errored ? 'bad'
          : ready ? 'ok' : 'bad';

  const fpsValue =
    stream.modelFps !== undefined && stream.fps !== undefined && stream.fps > stream.modelFps
      ? `${stream.modelFps}->${stream.fps}`
      : stream.fps !== undefined ? String(stream.fps) : '-';
  const metricItems = [
    { label: 'FPS', value: fpsValue, hint: 'Frames rendered by the model -> frames shown after smoothing, per second' },
    { label: 'E2E', value: stream.e2eMs !== undefined ? `${Math.round(stream.e2eMs)}ms` : '-', hint: 'End-to-end latency: capture -> server -> back to this panel' },
    { label: 'Server', value: stream.serverMs !== undefined ? `${Math.round(stream.serverMs)}ms` : '-', hint: 'Time the backend spent on inference per frame' },
    { label: 'Drops', value: String(stream.dropped ?? 0), hint: 'Frames dropped to keep latency bounded (drop-to-newest)' },
  ];

  const hasOutput = Boolean(output.src);
  // Idle = nothing to preview yet. In that state the settings render INLINE
  // (centered form), since there is no frame to keep clear; once a frame is
  // streaming/shown they collapse into a floating slim bar + popover so they
  // never cover the output.
  const idle = !hasOutput && !live;

  const promptField = (
    <div style={styles.promptField}>
      <div style={styles.labelRow}>
        <label style={styles.label}>Prompt</label>
        {prompt !== DEFAULT_PROMPT && (
          <button type="button" style={styles.linkButton} onClick={() => setPrompt(DEFAULT_PROMPT)}>reset</button>
        )}
      </div>
      <textarea style={styles.textarea} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
    </div>
  );

  const tuningFields = (
    <div style={styles.row}>
      <label style={styles.field}>
        <span style={styles.label}>Steps</span>
        <select style={styles.input} value={steps} onChange={(e) => setSteps(e.target.value)}>
          <option>1</option><option>2</option><option>3</option><option>4</option>
        </select>
      </label>
      <label style={styles.field}>
        <span style={styles.label}>Smooth</span>
        <select style={styles.input} value={interp} onChange={(e) => setInterp(e.target.value)}>
          <option value="0">off</option><option value="1">2x</option><option value="2">4x</option>
        </select>
      </label>
    </div>
  );

  return (
    <div style={{ ...styles.root, background: idle ? t.base : t.canvas }} data-fx-diffusion-renderer-panel="1">
      <style>{spinKeyframes}</style>

      {/* Full-bleed preview: sized to fill the panel so it matches the raw
          viewport next to it (Fit / object-fit: contain). */}
      <img ref={imgRef} alt="Diffusion rendered output" style={styles.image} />

      {/* Idle: settings inline + a short hint, centered. No floating card over
          an empty void. */}
      {idle && (
        <div style={styles.idleWrap}>
          {settingsOpen && <div style={styles.idleCard}>{promptField}{tuningFields}</div>}
          <div style={styles.idleHint}>
            Open a game in the viewport, then <b style={styles.emphasis}>Go Live</b> to render the enhanced frame here beside it.
          </div>
        </div>
      )}
      {hasOutput && !output.visible && (
        <div style={styles.empty}>Output hidden. Click Go Live to show new frames in this panel.</div>
      )}

      {connecting && (
        <div style={styles.overlayCenter}>
          <span style={styles.spinner} />
          <span style={styles.overlayText}>connecting...</span>
        </div>
      )}

      {errored && (
        <div style={styles.errorOverlay}>
          <div style={styles.errorTitle}>{errorTitle[stream.state] ?? 'Stream error'}</div>
          {stream.error && <div style={styles.errorMsg}>{stream.error}</div>}
          {ready && <button type="button" style={styles.retryButton} onClick={start}>Retry</button>}
        </div>
      )}

      {/* Floating slim control bar: overlays the preview instead of stacking
          above it, so the frame stays full-bleed. */}
      <div style={styles.bar}>
        <div style={styles.barLeft}>
          <span style={{ ...styles.dot, background: toneColor[statusTone], boxShadow: statusTone === 'ok' && live ? `0 0 6px ${toneColor.ok}` : 'none' }} />
          <span style={styles.barTitle}>Diffusion Renderer</span>
          <span style={styles.barSep}>|</span>
          <span style={{ ...styles.barStatus, color: toneColor[statusTone] }}>{statusText}</span>
          <span style={styles.barRes}>{OUTPUT_RES}</span>
        </div>
        {stream.state === 'live' && (
          <div style={styles.barMetrics} aria-label="Diffusion Renderer realtime metrics">
            {metricItems.map((item) => (
              <span key={item.label} style={styles.barMetric} title={item.hint}>
                <span style={styles.barMetricLabel}>{item.label}</span>
                <span style={styles.barMetricValue}>{item.value}</span>
              </span>
            ))}
          </div>
        )}
        <div style={styles.barRight}>
          <button
            type="button"
            style={{ ...styles.gearButton, ...(settingsOpen ? styles.gearActive : null) }}
            aria-label={settingsOpen ? 'Hide settings' : 'Show settings'}
            title={settingsOpen ? 'Hide settings' : 'Show settings'}
            onClick={() => setSettingsOpen((v) => !v)}
          >
          Settings
          </button>
          <button
            type="button"
            style={live ? styles.stopButton : { ...styles.liveButton, opacity: ready ? 1 : 0.5 }}
            disabled={!ready && !live}
            title={!ready && !live ? 'Backend not ready yet' : live ? 'Stop the live stream' : 'Start the live stream'}
            onClick={toggleLive}
          >
            {live ? 'Stop' : 'Go Live'}
          </button>
        </div>
      </div>

      {/* Tuning popover (gear): only Steps/Smooth; floats over the preview so
          it does not push the frame. Prompt lives in the bottom bar instead. */}
      {!idle && settingsOpen && (
        <div style={styles.popover}>{tuningFields}</div>
      )}

      {/* Bottom prompt bar: always available while a frame is present/streaming
          so the prompt can be tweaked live during gameplay. */}
      {!idle && (
        <div style={styles.promptBar}>
          <span style={styles.promptTag}>Prompt</span>
          <input
            style={styles.promptInput}
            value={prompt}
            placeholder={DEFAULT_PROMPT}
            onChange={(e) => setPrompt(e.target.value)}
            aria-label="Diffusion prompt"
          />
          {prompt !== DEFAULT_PROMPT && (
            <button type="button" style={styles.promptReset} onClick={() => setPrompt(DEFAULT_PROMPT)}>reset</button>
          )}
        </div>
      )}
    </div>
  );
}

const spinKeyframes = '@keyframes fx-dr-spin { to { transform: rotate(360deg); } }';

// Host design tokens (packages/interface/src/styles/tokens.css) with static
// fallbacks so the panel also renders sanely outside Studio. Keeping colors,
// radii and fonts on the shared scale is what makes the panel look consistent
// with the rest of the app instead of a bag of ad-hoc hex values.
const t = {
  canvas: 'var(--color-background-canvas, #0d0d0d)',
  base: 'var(--color-background-base, #191919)',
  elevated: 'var(--color-background-elevated, #242424)',
  floating: 'var(--color-background-floating, #333333)',
  textPrimary: 'var(--color-text-primary, #ffffff)',
  textSecondary: 'var(--color-text-secondary, rgba(255,255,255,0.6))',
  textTertiary: 'var(--color-text-tertiary, rgba(255,255,255,0.3))',
  borderSubtle: 'var(--color-border-subtle, #333333)',
  borderDefault: 'var(--color-border-default, #404040)',
  borderStrong: 'var(--color-border-strong, #737373)',
  blue: 'var(--color-accent-blue-default, #639cf8)',
  green: 'var(--color-accent-green-default, #4fd17f)',
  orange: 'var(--color-accent-orange-default, #ffb056)',
  error: 'var(--color-accent-error-default, #f26a6a)',
  sans: 'var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif)',
  mono: "var(--font-mono, ui-monospace, 'SF Mono', Menlo, monospace)",
  radSm: 'var(--radius-sm, 4px)',
  radMd: 'var(--radius-md, 8px)',
  radLg: 'var(--radius-lg, 12px)',
} as const;

const toneColor: Record<'ok' | 'warn' | 'bad', string> = {
  ok: t.green,
  warn: t.orange,
  bad: t.error,
};

const errorTitle: Partial<Record<StreamStatus['state'], string>> = {
  unauthorized: 'Unauthorized',
  busy: 'Backend busy',
  error: 'Stream error',
};

const baseButton: CSSProperties = {
  border: `1px solid ${t.borderDefault}`,
  borderRadius: t.radMd,
  color: t.textPrimary,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 12,
  lineHeight: 1.2,
  padding: '6px 12px',
};

const styles: Record<string, CSSProperties> = {
  root: { position: 'relative', height: '100%', minHeight: 0, overflow: 'hidden', background: t.base, color: t.textPrimary, fontFamily: t.sans },

  image: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', display: 'none' },

  empty: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: t.textSecondary, fontSize: 12, lineHeight: 1.6 },
  emphasis: { color: t.textPrimary, fontWeight: 600 },

  idleWrap: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 20 },
  idleCard: { width: '100%', maxWidth: 340, display: 'flex', flexDirection: 'column', gap: 10, padding: 14, background: t.elevated, border: `1px solid ${t.borderDefault}`, borderRadius: t.radLg },
  idleHint: { maxWidth: 340, color: t.textSecondary, fontSize: 12, lineHeight: 1.6, textAlign: 'center' },

  overlayCenter: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, pointerEvents: 'none' },
  spinner: { width: 24, height: 24, borderRadius: '50%', border: `2px solid ${t.borderSubtle}`, borderTopColor: t.blue, animation: 'fx-dr-spin 0.8s linear infinite' },
  overlayText: { color: t.textSecondary, fontSize: 12 },

  errorOverlay: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, textAlign: 'center', background: 'var(--color-overlay-modal, rgba(0,0,0,0.5))' },
  errorTitle: { color: t.error, fontSize: 13, fontWeight: 700 },
  errorMsg: { color: t.textSecondary, fontSize: 11, maxWidth: 280, lineHeight: 1.5 },
  retryButton: { ...baseButton, marginTop: 4, background: t.blue, borderColor: 'transparent', color: '#0d0d0d', fontWeight: 700, padding: '6px 16px' },

  bar: { position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', background: 'linear-gradient(to bottom, rgba(0,0,0,0.72), rgba(0,0,0,0))', zIndex: 2 },
  barLeft: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 },
  dot: { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto' },
  barTitle: { fontSize: 12, fontWeight: 700, letterSpacing: 0.1, color: t.textPrimary, whiteSpace: 'nowrap' },
  barSep: { color: t.textTertiary, fontSize: 12 },
  barStatus: { fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 },
  barRes: { marginLeft: 4, color: t.textTertiary, fontSize: 10, fontFamily: t.mono, whiteSpace: 'nowrap' },
  barMetrics: { display: 'flex', alignItems: 'center', gap: 10, flex: '0 1 auto', minWidth: 0, overflow: 'hidden' },
  barMetric: { display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' },
  barMetricLabel: { color: t.textTertiary, fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase' },
  barMetricValue: { color: t.textPrimary, fontSize: 11, fontWeight: 600, fontFamily: t.mono },
  barRight: { display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' },
  gearButton: { ...baseButton, padding: '5px 9px', fontSize: 13, lineHeight: 1, background: 'rgba(0,0,0,0.4)', color: t.textSecondary, borderColor: t.borderSubtle },
  gearActive: { color: t.textPrimary, borderColor: t.borderStrong, background: t.floating },
  liveButton: { ...baseButton, background: t.blue, borderColor: 'transparent', color: '#0d0d0d', fontWeight: 700 },
  stopButton: { ...baseButton, background: t.error, borderColor: 'transparent', color: '#0d0d0d', fontWeight: 700 },

  popover: { position: 'absolute', top: 46, right: 10, width: 220, maxWidth: 'calc(100% - 20px)', display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: t.elevated, border: `1px solid ${t.borderDefault}`, borderRadius: t.radLg, boxShadow: '0 8px 24px rgba(0,0,0,0.45)', zIndex: 3 },
  promptField: { display: 'flex', flexDirection: 'column' },
  labelRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  label: { display: 'block', color: t.textSecondary, fontSize: 11, fontWeight: 500, marginBottom: 5 },
  linkButton: { background: 'none', border: 'none', color: t.blue, cursor: 'pointer', fontSize: 11, fontWeight: 500, padding: 0 },
  textarea: { resize: 'vertical', minHeight: 56, background: t.base, color: t.textPrimary, border: `1px solid ${t.borderDefault}`, borderRadius: t.radMd, padding: 8, fontSize: 12, lineHeight: 1.5, fontFamily: t.sans },
  row: { display: 'flex', gap: 10 },
  field: { flex: 1 },
  input: { width: '100%', boxSizing: 'border-box', background: t.base, color: t.textPrimary, border: `1px solid ${t.borderDefault}`, borderRadius: t.radSm, padding: '6px 8px', fontSize: 12, fontFamily: t.sans },

  promptBar: { position: 'absolute', left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'linear-gradient(to top, rgba(0,0,0,0.82), rgba(0,0,0,0))', zIndex: 2 },
  promptTag: { flex: '0 0 auto', color: t.textTertiary, fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' },
  promptInput: { flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'rgba(0,0,0,0.35)', color: t.textPrimary, border: `1px solid ${t.borderSubtle}`, borderRadius: t.radSm, padding: '5px 8px', fontSize: 12, fontFamily: t.sans },
  promptReset: { flex: '0 0 auto', background: 'none', border: 'none', color: t.blue, cursor: 'pointer', fontSize: 11, fontWeight: 500, padding: 0 },
};
