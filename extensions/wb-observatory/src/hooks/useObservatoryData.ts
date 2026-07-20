import { useState, useEffect } from 'react';

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
