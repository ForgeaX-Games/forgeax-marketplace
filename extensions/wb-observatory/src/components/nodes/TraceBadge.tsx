import { useObservatoryStore } from '../../store/observatoryStore';

/** Corner badge showing a node's trace status (todo 038 P3). Reads the joined
 *  NodeTrace from the store by node id:
 *    has span        → "◷ <duration>"  (trace linked)
 *    no-trace        → "no trace"       (OTEL off / rented kernel / old session)
 *    ordinal-misaligned → "trace ~"     (empty-turn ordinal drift, honest degrade)
 *  Renders nothing when no join entry exists (node type not traceable). */
export function TraceBadge({ nodeId }: { nodeId: string }) {
  const trace = useObservatoryStore((s) => s.nodeTraces.get(nodeId));
  if (!trace) return null;

  if (trace.degrade === 'no-trace') {
    return <span className="ob-trace-badge ob-trace-badge--none" title="No trace span linked">no trace</span>;
  }
  if (trace.degrade === 'ordinal-misaligned') {
    return (
      <span className="ob-trace-badge ob-trace-badge--warn" title="Empty-turn ordinal drift — trace alignment degraded">
        trace ~
      </span>
    );
  }
  if (trace.span) {
    const { startTs, endTs } = trace.span;
    const dur = endTs !== undefined ? `${((endTs - startTs) / 1000).toFixed(2)}s` : '…';
    return (
      <span className="ob-trace-badge ob-trace-badge--ok" title={`trace: ${trace.span.name} · ${dur}`}>
        ◷ {dur}
      </span>
    );
  }
  return null;
}
