/** Client-side telemetry join (todo 038 P2) — attach trace spans + logs to the
 *  trajectory nodes the event stream already built. ZERO clock dependency: keys
 *  only (callId / agentId / turn-ordinal / spanId). This is a pure function so
 *  the join rules can be unit-tested exhaustively.
 *
 *  Join rules (定稿 §2):
 *    tool-${id}        → span where name==='tool' && attrs.callId===id
 *    agent-${path}     → span where name==='agent.run' && attrs.agentId===path
 *    turn-${k}         → ORDINAL: k-th kernel.turn span in the owning agentId
 *                        bucket (sorted by startTs). If a bucket has MORE spans
 *                        than nodes (empty-turn ordinal drift) the whole bucket
 *                        degrades to 'ordinal-misaligned' and nothing is
 *                        attached — honest degrade over mis-attach (D4/A).
 *    logs              → logsBySpanId[node.span.spanId]. Tool spans carry no
 *                        bound logger, so a tool node's logs are empty by design
 *                        (its turn node holds the turn-scoped logs, P1-3).
 *    no span           → degrade 'no-trace'.
 */

import type { SpanData, LogRecord } from './telemetry-types';

export type TraceDegrade = 'no-trace' | 'ordinal-misaligned';
export interface NodeTrace {
  span?: SpanData;
  logs: LogRecord[];
  degrade?: TraceDegrade;
}

/** Minimal node shape the join reads (structurally compatible with reactflow Node). */
export interface JoinNode {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
}

const TURN_RE = /^turn-(\d+)$/;
const SUB_TURN_RE = /^agent-(.+)-turn-(\d+)$/;
const TOOL_RE = /^(?:agent-.+?-)?tool-(.+)$/;

function attrStr(span: SpanData, key: string): string | undefined {
  const v = span.attrs?.[key];
  return typeof v === 'string' ? v : undefined;
}

export function joinTelemetryToNodes(
  nodes: JoinNode[],
  spansById: Map<string, SpanData>,
  logsBySpanId: Map<string, LogRecord[]>,
): Map<string, NodeTrace> {
  const out = new Map<string, NodeTrace>();
  const spans = [...spansById.values()];

  // ── Index spans by their join keys ──────────────────────────────────────
  const toolByCallId = new Map<string, SpanData>();
  const agentRunByAgentId = new Map<string, SpanData>();
  const turnBuckets = new Map<string, SpanData[]>(); // agentId → kernel.turn spans
  for (const s of spans) {
    if (s.name === 'tool') {
      const callId = attrStr(s, 'callId');
      if (callId) toolByCallId.set(callId, s);
    } else if (s.name === 'agent.run') {
      const aid = attrStr(s, 'agentId');
      if (aid) agentRunByAgentId.set(aid, s);
    } else if (s.name === 'kernel.turn') {
      const aid = attrStr(s, 'agentId') ?? s.agentId ?? '';
      const arr = turnBuckets.get(aid) ?? [];
      arr.push(s);
      turnBuckets.set(aid, arr);
    }
  }
  for (const arr of turnBuckets.values()) arr.sort((a, b) => a.startTs - b.startTs);

  // ── Resolve the root agentId (owner of top-level `turn-${k}` nodes) ──────
  // Sub-agent nodes name their own agentId; the root is the one kernel.turn
  // bucket NOT claimed by any sub-agent node. Ambiguous (0 or >1) → undefined,
  // which safely degrades top-level turns to no-trace rather than mis-bucket.
  const subAgentPaths = new Set<string>();
  for (const n of nodes) {
    if (n.type === 'subAgent') {
      const path = (n.data?.agentId as string) ?? n.id.replace(/^agent-/, '');
      subAgentPaths.add(path);
    }
  }
  const rootCandidates = [...turnBuckets.keys()].filter((k) => !subAgentPaths.has(k));
  const rootAgentId = rootCandidates.length === 1 ? rootCandidates[0] : undefined;

  // ── Map each turn node to (bucket, ordinal); count nodes per bucket ──────
  const turnMeta = new Map<string, { bucket: string; ordinal: number }>();
  const turnNodeCount = new Map<string, number>();
  for (const n of nodes) {
    if (n.type !== 'turn') continue;
    let bucket: string | undefined;
    let ordinal: number | undefined;
    const sub = SUB_TURN_RE.exec(n.id);
    if (sub) {
      bucket = sub[1];
      ordinal = Number(sub[2]);
    } else {
      const top = TURN_RE.exec(n.id);
      if (top) {
        bucket = rootAgentId;
        ordinal = Number(top[1]);
      }
    }
    if (bucket === undefined || ordinal === undefined) continue;
    turnMeta.set(n.id, { bucket, ordinal });
    turnNodeCount.set(bucket, (turnNodeCount.get(bucket) ?? 0) + 1);
  }

  const logsFor = (span?: SpanData): LogRecord[] => (span ? (logsBySpanId.get(span.spanId) ?? []) : []);
  const withSpan = (span: SpanData): NodeTrace => ({ span, logs: logsFor(span) });
  const noTrace: NodeTrace = { logs: [], degrade: 'no-trace' };

  // ── Emit a NodeTrace for every traceable node ───────────────────────────
  for (const n of nodes) {
    if (n.type === 'toolCall') {
      const callId = TOOL_RE.exec(n.id)?.[1];
      const span = callId ? toolByCallId.get(callId) : undefined;
      out.set(n.id, span ? withSpan(span) : noTrace);
    } else if (n.type === 'subAgent') {
      const path = (n.data?.agentId as string) ?? n.id.replace(/^agent-/, '');
      const span = agentRunByAgentId.get(path);
      out.set(n.id, span ? withSpan(span) : noTrace);
    } else if (n.type === 'turn') {
      const meta = turnMeta.get(n.id);
      if (!meta) { out.set(n.id, noTrace); continue; }
      const bucketSpans = turnBuckets.get(meta.bucket) ?? [];
      const nodeCount = turnNodeCount.get(meta.bucket) ?? 0;
      if (bucketSpans.length > nodeCount) {
        // Empty-turn drift: more turn spans than turn nodes in this bucket →
        // ordinals no longer line up. Degrade the whole bucket; never mis-attach.
        out.set(n.id, { logs: [], degrade: 'ordinal-misaligned' });
        continue;
      }
      const span = bucketSpans[meta.ordinal];
      out.set(n.id, span ? withSpan(span) : noTrace);
    }
  }
  return out;
}
