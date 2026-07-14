import { useState } from 'react';
import { useObservatoryStore } from '../store/observatoryStore';
import { useSessionList, type SessionListItem } from '../hooks/useObservatoryData';

const pad = (n: number) => String(n).padStart(2, '0');

function formatLabel(s: SessionListItem): string {
  const idTail = s.id.length > 8 ? s.id.slice(0, 8) : s.id;
  const head = s.displayName?.trim() || idTail;
  const dir = s.defaultDir ? `· ${s.defaultDir}` : '';
  // LOCAL time (was toISOString → UTC, which read 8h behind Beijing). Sessions
  // are the operator's own, so their wall-clock is the right frame.
  let ts = '';
  if (s.updated) {
    const d = new Date(s.updated);
    ts = `· ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${head} ${dir} ${ts}`.replace(/\s+/g, ' ').trim();
}

export function ObservatoryToolbar() {
  const { sessionPath, setSessionPath, sessionMode, setSessionMode } = useObservatoryStore();
  // Bump on each dropdown open so a session started elsewhere shows up fresh.
  const [refreshKey, setRefreshKey] = useState(0);
  const sessions = useSessionList(refreshKey);
  const isLive = sessionMode === 'live';

  // ONE control, not two. The old design split "Live/Replay" (a toggle button)
  // from "which session" (this dropdown) — so switching to Replay left the sid
  // null and dropped you on an empty placeholder, and Live wasn't reachable from
  // the list at all. Here the first entry IS Live (follow the newest running
  // session); any other entry replays that saved session. Mode is DERIVED from
  // the choice, never set independently.
  const value = isLive ? '' : (sessionPath ?? '');
  const onPick = (v: string) => {
    if (v) { setSessionMode('static'); setSessionPath(v); }
    else { setSessionMode('live'); setSessionPath(null); }
  };

  return (
    <div className="observatory-toolbar">
      <span className="observatory-toolbar__title">Observatory</span>

      <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.08)', margin: '0 4px' }} />

      {/* Status dot mirrors the active mode; the canvas carries the full badge. */}
      <span
        style={{
          width: 8, height: 8, borderRadius: '50%', display: 'inline-block', flexShrink: 0,
          background: isLive ? '#D4FF48' : '#4B9EFF',
          ...(isLive ? { animation: 'ob-blink 1.5s ease-in-out infinite' } : {}),
        }}
      />

      <select
        value={value}
        onMouseDown={() => setRefreshKey((k) => k + 1)}
        onChange={(e) => onPick(e.target.value)}
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          color: 'var(--ob-node-text)',
          fontSize: 11,
          padding: '3px 8px',
          maxWidth: 300,
        }}
        title="Live follows the newest running session; pick a saved session to replay it"
      >
        <option value="">● Live (most recent)</option>
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
