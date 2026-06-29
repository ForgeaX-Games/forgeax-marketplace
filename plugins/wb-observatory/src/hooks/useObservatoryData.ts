import { useState, useEffect, useCallback } from 'react';

export interface ObservatoryData {
  systemPrompt: unknown | null;
  turns: unknown[];
  findings: unknown[];
  commTopology: unknown;
  subAgentSessions: unknown[];
  tokenTimeline: unknown[];
}

export interface SessionListItem {
  /** sid (UUID). */
  id: string;
  displayName?: string;
  /** game-project slug (`session.json::defaultDir`). */
  defaultDir?: string;
  /** mtime in ms. */
  updated?: number;
  created?: number;
}

export function useObservatoryData(sessionId: string | null) {
  const [data, setData] = useState<ObservatoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!sessionId) { setData(null); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/observatory/inspect?session=${encodeURIComponent(sessionId)}&scope=full&format=json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const parsed = JSON.parse(text);
      setData(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function useSessionList(refreshKey: unknown = null) {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);

  useEffect(() => {
    fetch('/api/observatory/sessions')
      .then(r => r.ok ? r.json() : [])
      .then((j) => {
        // Backend returns a flat array now; tolerate the legacy
        // `{sessions: [...]}` envelope so an old build doesn't break.
        const arr = Array.isArray(j) ? j : Array.isArray((j as { sessions?: unknown })?.sessions) ? (j as { sessions: SessionListItem[] }).sessions : [];
        setSessions(arr as SessionListItem[]);
      })
      .catch(() => setSessions([]));
  }, [refreshKey]);

  return sessions;
}
