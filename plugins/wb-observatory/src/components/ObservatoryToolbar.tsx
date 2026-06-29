import { useObservatoryStore, type SessionMode } from '../store/observatoryStore';
import { useSessionList, type SessionListItem } from '../hooks/useObservatoryData';

const MODE_STYLES: Record<SessionMode, { bg: string; color: string; label: string }> = {
  live:   { bg: 'rgba(212,255,72,0.1)', color: '#D4FF48', label: 'Live' },
  static: { bg: 'rgba(75,158,255,0.1)', color: '#4B9EFF', label: 'Replay' },
};

function formatLabel(s: SessionListItem): string {
  const idTail = s.id.length > 8 ? s.id.slice(0, 8) : s.id;
  const head = s.displayName?.trim() || idTail;
  const dir = s.defaultDir ? `· ${s.defaultDir}` : '';
  const ts = s.updated ? `· ${new Date(s.updated).toISOString().slice(0, 16).replace('T', ' ')}` : '';
  return `${head} ${dir} ${ts}`.replace(/\s+/g, ' ').trim();
}

export function ObservatoryToolbar() {
  const { sessionPath, setSessionPath, sessionMode, setSessionMode } = useObservatoryStore();
  // Refresh-key bumps every mode toggle: switching modes is the cheapest
  // signal that the operator wants to see fresh sessions (e.g. a new session
  // appeared in another tab while they were live-watching).
  const sessions = useSessionList(sessionMode);
  const modeStyle = MODE_STYLES[sessionMode];

  // 'current' is a magic string used by the SSE route — render it as
  // "(most recent)" so the dropdown's intent is obvious.
  const currentValue = sessionPath ?? '';

  return (
    <div className="observatory-toolbar">
      <span className="observatory-toolbar__title">Observatory</span>

      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />

      <button
        type="button"
        onClick={() => setSessionMode(sessionMode === 'live' ? 'static' : 'live')}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '3px 10px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
          background: modeStyle.bg, border: `1px solid ${modeStyle.color}30`, color: modeStyle.color,
        }}
      >
        {sessionMode === 'live' && (
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D4FF48', display: 'inline-block', animation: 'ob-blink 1.5s ease-in-out infinite' }} />
        )}
        {modeStyle.label}
      </button>

      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />
      <select
        value={currentValue}
        onChange={(e) => setSessionPath(e.target.value || null)}
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          color: 'var(--ob-node-text)',
          fontSize: 11,
          padding: '3px 8px',
          maxWidth: 280,
        }}
        title={sessionMode === 'live'
          ? 'Live session — leave blank to follow the most-recent session'
          : 'Replay — pick a session to inspect its ledger'}
      >
        <option value="">
          {sessionMode === 'live' ? '(most recent · live)' : 'Select session…'}
        </option>
        {sessions.map((s) => (
          <option key={s.id} value={s.id}>{formatLabel(s)}</option>
        ))}
      </select>

      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 10, color: 'var(--ob-node-text-dim)' }}>
        Double-click session node to inspect context
      </span>
    </div>
  );
}
