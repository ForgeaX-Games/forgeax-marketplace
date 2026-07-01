import { describe, test, expect } from 'bun:test';
import { joinTelemetryToNodes, type JoinNode } from '../src/lib/join-telemetry';
import type { SpanData, LogRecord } from '../src/lib/telemetry-types';

// joinTelemetryToNodes is the heart of the client overlay (todo 038 P2). It is a
// pure key-join (no clock), so we pin every rule here. Real-session gates
// (AC-P2-1/2/7 namespace + live/replay) are verified separately at runtime.

const span = (over: Partial<SpanData> & Pick<SpanData, 'spanId' | 'name' | 'startTs'>): SpanData => ({
  kind: 'span', traceId: 'tr', endTs: over.startTs + 1, ...over,
});
const spanMap = (...ss: SpanData[]) => new Map(ss.map((s) => [s.spanId, s]));
const noLogs = new Map<string, LogRecord[]>();

describe('joinTelemetryToNodes', () => {
  test('tool node ← span.attrs.callId (top-level + sub-agent) [AC-P2-1]', () => {
    const nodes: JoinNode[] = [
      { id: 'tool-call-1', type: 'toolCall' },
      { id: 'agent-iori-tool-call-2', type: 'toolCall' },
    ];
    const spans = spanMap(
      span({ spanId: 's1', name: 'tool', startTs: 10, attrs: { callId: 'call-1' } }),
      span({ spanId: 's2', name: 'tool', startTs: 20, attrs: { callId: 'call-2' } }),
    );
    const r = joinTelemetryToNodes(nodes, spans, noLogs);
    expect(r.get('tool-call-1')?.span?.spanId).toBe('s1');
    expect(r.get('agent-iori-tool-call-2')?.span?.spanId).toBe('s2');
  });

  test('agent node ← agent.run span.attrs.agentId [AC-P2-2]', () => {
    const nodes: JoinNode[] = [{ id: 'agent-iori', type: 'subAgent', data: { agentId: 'iori' } }];
    const spans = spanMap(span({ spanId: 'a1', name: 'agent.run', startTs: 5, attrs: { agentId: 'iori' } }));
    const r = joinTelemetryToNodes(nodes, spans, noLogs);
    expect(r.get('agent-iori')?.span?.spanId).toBe('a1');
    expect(r.get('agent-iori')?.degrade).toBeUndefined();
  });

  test('turn node ← k-th kernel.turn span by startTs in agentId bucket [AC-P2-3]', () => {
    const nodes: JoinNode[] = [
      { id: 'turn-0', type: 'turn', data: { index: 0 } },
      { id: 'turn-1', type: 'turn', data: { index: 1 } },
    ];
    // Out-of-order insertion; join must sort by startTs, not map order.
    const spans = spanMap(
      span({ spanId: 't_late', name: 'kernel.turn', startTs: 200, attrs: { agentId: 'forge' } }),
      span({ spanId: 't_early', name: 'kernel.turn', startTs: 100, attrs: { agentId: 'forge' } }),
    );
    const r = joinTelemetryToNodes(nodes, spans, noLogs);
    expect(r.get('turn-0')?.span?.spanId).toBe('t_early');
    expect(r.get('turn-1')?.span?.spanId).toBe('t_late');
  });

  test('sub-agent turn node ← ordinal within its own bucket', () => {
    const nodes: JoinNode[] = [
      { id: 'agent-iori', type: 'subAgent', data: { agentId: 'iori' } },
      { id: 'agent-iori-turn-0', type: 'turn', data: { index: 0 } },
      { id: 'turn-0', type: 'turn', data: { index: 0 } },
    ];
    const spans = spanMap(
      span({ spanId: 'root0', name: 'kernel.turn', startTs: 10, attrs: { agentId: 'forge' } }),
      span({ spanId: 'iori0', name: 'kernel.turn', startTs: 20, attrs: { agentId: 'iori' } }),
    );
    const r = joinTelemetryToNodes(nodes, spans, noLogs);
    expect(r.get('turn-0')?.span?.spanId).toBe('root0');
    expect(r.get('agent-iori-turn-0')?.span?.spanId).toBe('iori0');
  });

  test('empty-turn drift: spans > nodes → whole bucket ordinal-misaligned, no mis-attach [AC-P2-4]', () => {
    const nodes: JoinNode[] = [
      { id: 'turn-0', type: 'turn', data: { index: 0 } },
      { id: 'turn-1', type: 'turn', data: { index: 1 } },
    ];
    const spans = spanMap(
      span({ spanId: 'k0', name: 'kernel.turn', startTs: 10, attrs: { agentId: 'forge' } }),
      span({ spanId: 'k1', name: 'kernel.turn', startTs: 20, attrs: { agentId: 'forge' } }),
      span({ spanId: 'k2', name: 'kernel.turn', startTs: 30, attrs: { agentId: 'forge' } }),
    );
    const r = joinTelemetryToNodes(nodes, spans, noLogs);
    expect(r.get('turn-0')?.degrade).toBe('ordinal-misaligned');
    expect(r.get('turn-1')?.degrade).toBe('ordinal-misaligned');
    expect(r.get('turn-0')?.span).toBeUndefined();
  });

  test('no span → no-trace [AC-P3-2]', () => {
    const nodes: JoinNode[] = [
      { id: 'turn-0', type: 'turn', data: { index: 0 } },
      { id: 'tool-x', type: 'toolCall' },
      { id: 'agent-suzu', type: 'subAgent', data: { agentId: 'suzu' } },
    ];
    const r = joinTelemetryToNodes(nodes, new Map(), noLogs);
    for (const id of ['turn-0', 'tool-x', 'agent-suzu']) expect(r.get(id)?.degrade).toBe('no-trace');
  });

  test('logs attach by spanId; tool node logs empty by design [AC-P2-5]', () => {
    const nodes: JoinNode[] = [
      { id: 'turn-0', type: 'turn', data: { index: 0 } },
      { id: 'tool-c1', type: 'toolCall' },
    ];
    const turnSpan = span({ spanId: 'ts', name: 'kernel.turn', startTs: 10, attrs: { agentId: 'forge' } });
    const toolSpan = span({ spanId: 'tl', name: 'tool', startTs: 12, attrs: { callId: 'c1' } });
    const logs = new Map<string, LogRecord[]>([
      ['ts', [{ kind: 'log', ts: 11, level: 'info', msg: 'turn log', spanId: 'ts' }]],
      // no logs under the tool span — tool spans carry no bound logger
    ]);
    const r = joinTelemetryToNodes(nodes, spanMap(turnSpan, toolSpan), logs);
    expect(r.get('turn-0')?.logs.map((l) => l.msg)).toEqual(['turn log']);
    expect(r.get('tool-c1')?.logs).toEqual([]);
  });
});
