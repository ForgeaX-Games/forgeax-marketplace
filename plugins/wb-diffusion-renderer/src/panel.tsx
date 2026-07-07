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

export function DiffusionRendererPanel() {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [steps, setSteps] = useState('2');
  const [interp, setInterp] = useState('2');
  const [meta, setMeta] = useState('checking...');
  const [ready, setReady] = useState(false);
  const [stream, setStream] = useState<StreamStatus>({ state: isStreaming() ? 'live' : 'stopped' });
  const [output, setOutput] = useState<DiffusionRendererOutputSnapshot>(() => getDiffusionRendererOutputSnapshot());

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

  const toggleLive = () => {
    if (isStreaming()) {
      stopStream();
      return;
    }
    setDiffusionRendererOutputVisible(true);
    setStream({ state: 'connecting' });
    void startStream(params(), setStream);
  };

  const live = stream.state === 'live' || stream.state === 'connecting';
  const statusText =
    stream.state === 'live'
      ? 'live'
      : stream.state === 'connecting'
        ? 'connecting...'
        : stream.state === 'stopped'
          ? meta
          : stream.error ?? stream.state;
  const processingFps = stream.serverMs ? 1000 / stream.serverMs : null;
  const displayFps =
    stream.modelFps !== undefined && stream.fps !== undefined && stream.fps > stream.modelFps
      ? `${stream.modelFps} -> ${stream.fps}`
      : stream.fps !== undefined ? String(stream.fps) : '-';
  const metricItems = [
    { label: 'FPS', value: displayFps },
    { label: 'E2E', value: stream.e2eMs !== undefined ? `${Math.round(stream.e2eMs)} ms` : '-' },
    { label: 'Server', value: stream.serverMs !== undefined ? `${Math.round(stream.serverMs)} ms` : '-' },
    { label: 'Process', value: processingFps ? `${processingFps.toFixed(1)} fps` : '-' },
    { label: 'Drops', value: String(stream.dropped ?? 0) },
  ];

  return (
    <div style={styles.root} data-fx-diffusion-renderer-panel="1">
      <div style={styles.controls}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>Diffusion Renderer</div>
            <div style={ready ? styles.ready : styles.down}>{statusText}</div>
          </div>
          <button type="button" style={live ? styles.stopButton : styles.liveButton} disabled={!ready && !live} onClick={toggleLive}>
            {live ? 'Stop' : 'Go Live'}
          </button>
        </div>
        <div style={styles.metrics} aria-label="Diffusion Renderer realtime metrics">
          {metricItems.map((item) => (
            <div key={item.label} style={styles.metric}>
              <span style={styles.metricLabel}>{item.label}</span>
              <span style={styles.metricValue}>{item.value}</span>
            </div>
          ))}
        </div>
        <label style={styles.label}>Prompt</label>
        <textarea style={styles.textarea} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
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
      </div>
      <div style={styles.preview}>
        {!output.src && <div style={styles.empty}>Open a game in the viewport, then click Go Live to render diffusion-rendererd frames here.</div>}
        {output.src && !output.visible && <div style={styles.empty}>Output hidden. Click Go Live to show new frames in this panel.</div>}
        <img ref={imgRef} alt="Diffusion Rendererd output" style={styles.image} />
      </div>
    </div>
  );
}

const baseButton: CSSProperties = {
  border: '1px solid var(--color-border-default, #2a2d30)',
  borderRadius: 7,
  color: '#e5e7eb',
  cursor: 'pointer',
  fontWeight: 700,
  padding: '7px 12px',
};

const styles: Record<string, CSSProperties> = {
  root: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', background: '#0b0f19', color: '#e5e7eb' },
  controls: { flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderBottom: '1px solid #2a2d30' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { fontSize: 14, fontWeight: 800 },
  ready: { color: '#6ee7b7', fontSize: 11, marginTop: 2 },
  down: { color: '#fca5a5', fontSize: 11, marginTop: 2 },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 6 },
  metric: { minWidth: 0, border: '1px solid #1f2937', borderRadius: 7, background: '#0f1626', padding: '6px 7px' },
  metricLabel: { display: 'block', color: '#6b7280', fontSize: 10, lineHeight: 1.2 },
  metricValue: { display: 'block', color: '#e5e7eb', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 2 },
  label: { display: 'block', color: '#9ca3af', fontSize: 11, marginBottom: 4 },
  textarea: { resize: 'vertical', minHeight: 58, background: '#111827', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 8, padding: 8, fontSize: 12 },
  row: { display: 'flex', gap: 8 },
  field: { flex: 1 },
  input: { width: '100%', boxSizing: 'border-box', background: '#111827', color: '#e5e7eb', border: '1px solid #374151', borderRadius: 7, padding: '6px 7px', fontSize: 12 },
  liveButton: { ...baseButton, background: '#1d4ed8', borderColor: '#2563eb' },
  stopButton: { ...baseButton, background: '#7f1d1d', borderColor: '#b91c1c' },
  preview: { position: 'relative', flex: '1 1 auto', minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: '#000' },
  image: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'none' },
  empty: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, textAlign: 'center', color: '#778', fontSize: 12, lineHeight: 1.5 },
};
