import { useCallback, useEffect, useRef, useState } from "react";

export interface FilePoolState {
  files: string[];
  newFiles: string[];
  lastUpdate: number;
}

const API_BASE = (import.meta as unknown as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE ?? "";

/**
 * Polls `/api/narrative/files/:runId` every `interval` ms.
 * Returns the current file list and any newly detected files since last poll.
 */
export function useFilePoolWatcher(
  runId: string | null,
  isActive: boolean,
  interval = 2000,
): FilePoolState {
  const [state, setState] = useState<FilePoolState>({
    files: [],
    newFiles: [],
    lastUpdate: 0,
  });

  const prevFilesRef = useRef<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  const poll = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await fetch(`${API_BASE}/api/narrative/files/${runId}`);
      if (!res.ok) return;
      const data = await res.json() as { files: string[] };
      const currentFiles = data.files ?? [];
      const currentSet = new Set(currentFiles);
      const prevSet = prevFilesRef.current;

      const newFiles = currentFiles.filter(f => !prevSet.has(f));
      prevFilesRef.current = currentSet;

      setState({
        files: currentFiles,
        newFiles,
        lastUpdate: Date.now(),
      });
    } catch {
      // network error, skip
    }
  }, [runId]);

  useEffect(() => {
    if (!runId || !isActive) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    poll();
    timerRef.current = setInterval(poll, interval);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [runId, isActive, interval, poll]);

  useEffect(() => {
    if (!runId) {
      prevFilesRef.current = new Set();
      setState({ files: [], newFiles: [], lastUpdate: 0 });
    }
  }, [runId]);

  return state;
}

/**
 * Fetch a single file from the file pool.
 */
export async function fetchNodeFile(
  runId: string,
  filePath: string,
): Promise<unknown> {
  const res = await fetch(`${API_BASE}/api/narrative/file/${runId}/${filePath}`);
  if (!res.ok) throw new Error(`Failed to fetch ${filePath}: ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    return res.json();
  }
  return res.text();
}
