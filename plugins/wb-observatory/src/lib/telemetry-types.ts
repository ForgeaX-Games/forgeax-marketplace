/** Read-only mirror of the @forgeax/types telemetry wire schema (todo 038).
 *
 *  wb-observatory is a standalone iframe plugin built apart from the monorepo
 *  workspace, so it cannot import @forgeax/types directly. These interfaces are
 *  a consumer-side view of the FROZEN wire contract (SpanData / LogRecord) —
 *  the same pattern the event stream already uses for AgentEventEnvelope. We
 *  only declare the fields the join reads; the server is the schema SSOT.
 */

export interface SpanData {
  kind: 'span';
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTs: number;
  endTs?: number;
  provisional?: boolean;
  attrs?: Record<string, unknown>;
  events?: { name: string; ts: number; attrs?: Record<string, unknown> }[];
  status?: { code: 'ok' | 'error'; message?: string };
  sid?: string;
  agentId?: string;
}

export interface LogRecord {
  kind: 'log';
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  fields?: Record<string, unknown>;
  traceId?: string;
  spanId?: string;
  sid?: string;
  agentId?: string;
}

export type TelemetryRecord = SpanData | LogRecord;
