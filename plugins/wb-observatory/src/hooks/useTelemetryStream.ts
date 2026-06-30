import { useEffect, useRef } from 'react';
import { useObservatoryStore } from '../store/observatoryStore';
import type { SpanData, LogRecord, TelemetryRecord } from '../lib/telemetry-types';

/** Subscribe to /api/observatory/telemetry (todo 038 P2) and accumulate the
 *  span/log streams into the store. Mirrors useEventStream's replay→live shape,
 *  but ONLY enriches existing nodes — it never builds nodes (that is the event
 *  stream's job; telemetry is a pure additive overlay).
 *
 *  Spans dedup by spanId with final winning over a late provisional; logs bucket
 *  by spanId. Batched into the store via requestAnimationFrame. Any stream error
 *  is swallowed — telemetry must never break the trajectory plane (§9). */
export function useTelemetryStream(sessionId: string | null, enabled: boolean): void {
  const spansRef = useRef<Map<string, SpanData>>(new Map());
  const logsRef = useRef<Map<string, LogRecord[]>>(new Map());
  const setTelemetry = useObservatoryStore((s) => s.setTelemetry);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    spansRef.current = new Map();
    logsRef.current = new Map();
    setTelemetry(new Map(), new Map());

    const url = `/api/observatory/telemetry${sessionId !== 'current' ? `?session=${encodeURIComponent(sessionId)}` : ''}`;
    const es = new EventSource(url);
    let pendingFlush = false;
    const flush = () => {
      pendingFlush = false;
      setTelemetry(new Map(spansRef.current), new Map(logsRef.current));
    };
    const schedule = () => {
      if (pendingFlush) return;
      pendingFlush = true;
      requestAnimationFrame(flush);
    };

    es.onmessage = (msg) => {
      try {
        const { record } = JSON.parse(msg.data) as { record?: TelemetryRecord };
        if (!record) return;
        if (record.kind === 'span') {
          const prev = spansRef.current.get(record.spanId);
          // Keep a final span over a stray late provisional; otherwise newest wins.
          if (prev && prev.endTs !== undefined && record.endTs === undefined) return;
          spansRef.current.set(record.spanId, record);
        } else if (record.kind === 'log' && record.spanId) {
          const arr = logsRef.current.get(record.spanId) ?? [];
          arr.push(record);
          logsRef.current.set(record.spanId, arr);
        }
        schedule();
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => {
      /* EventSource auto-reconnects; telemetry overlay tolerates gaps. */
    };

    return () => { es.close(); };
  }, [sessionId, enabled, setTelemetry]);
}
