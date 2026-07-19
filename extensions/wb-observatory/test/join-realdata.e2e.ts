/* Real-data join e2e (todo 038 AC-P2-1/2/3/5). Pulls REAL spans from the live
 * /api/observatory/telemetry and REAL node ids reconstructed from /events
 * (mirroring useEventStream id construction), then runs the ACTUAL
 * joinTelemetryToNodes and reports the links. Run: bun test/join-realdata.e2e.ts <sid> */
import { joinTelemetryToNodes, type JoinNode } from '../src/lib/join-telemetry';
import type { SpanData, LogRecord, TelemetryRecord } from '../src/lib/telemetry-types';

const BASE = 'http://localhost:18900';
const sid = process.argv[2];
if (!sid) { console.error('usage: bun join-realdata.e2e.ts <sid>'); process.exit(1); }

async function collectSSE(url: string, ms: number): Promise<any[]> {
  const out: any[] = [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (line.startsWith('data: ')) { try { out.push(JSON.parse(line.slice(6))); } catch {} }
      }
    }
  } catch { /* aborted = window closed */ } finally { clearTimeout(timer); }
  return out;
}

// 1) Real spans + logs from the telemetry plane.
const telem = await collectSSE(`${BASE}/api/observatory/telemetry?session=${sid}`, 4000);
const spansById = new Map<string, SpanData>();
const logsBySpanId = new Map<string, LogRecord[]>();
for (const { record } of telem as { record: TelemetryRecord }[]) {
  if (record.kind === 'span') spansById.set(record.spanId, record);
  else if (record.kind === 'log' && record.spanId) {
    (logsBySpanId.get(record.spanId) ?? logsBySpanId.set(record.spanId, []).get(record.spanId)!).push(record);
  }
}

// 2) Real node ids reconstructed from the trajectory event stream (mirror useEventStream).
const events = await collectSSE(`${BASE}/api/observatory/events?session=${sid}`, 5000);
const nodes: JoinNode[] = [];
let turn = 0;
for (const env of events) {
  const e = env.event; if (!e) continue;
  if (e.type === 'llm_call' && e.subtype === 'start') { nodes.push({ id: `turn-${turn}`, type: 'turn', data: { index: turn } }); turn++; }
  else if (e.type === 'tool_use') nodes.push({ id: `tool-${e.toolUseId}`, type: 'toolCall' });
  else if (e.type === 'sub_agent' && e.subtype === 'started') nodes.push({ id: `agent-${e.agentId}`, type: 'subAgent', data: { agentId: e.agentId } });
}

// 3) Run the real join.
const traces = joinTelemetryToNodes(nodes, spansById, logsBySpanId);

const spanNames = new Map<string, number>();
for (const s of spansById.values()) spanNames.set(s.name, (spanNames.get(s.name) ?? 0) + 1);
console.log(`\n=== session ${sid} ===`);
console.log(`spans: ${spansById.size}  (${[...spanNames].map(([k, v]) => `${k}:${v}`).join(', ')})`);
console.log(`nodes reconstructed: ${nodes.length}  (turn:${nodes.filter(n => n.type === 'turn').length}, tool:${nodes.filter(n => n.type === 'toolCall').length}, agent:${nodes.filter(n => n.type === 'subAgent').length})`);
console.log('\nnode → joined trace:');
let linked = 0, noTrace = 0, misaligned = 0;
for (const n of nodes) {
  const t = traces.get(n.id);
  if (!t) { console.log(`  ${n.id}  (no entry)`); continue; }
  if (t.span) { linked++; const dur = t.span.endTs !== undefined ? `${((t.span.endTs - t.span.startTs) / 1000).toFixed(2)}s` : '…'; console.log(`  ${n.id}  ✓ ${t.span.name} ${dur}  logs=${t.logs.length}  spanId=${t.span.spanId}`); }
  else if (t.degrade === 'ordinal-misaligned') { misaligned++; console.log(`  ${n.id}  ~ ordinal-misaligned`); }
  else { noTrace++; console.log(`  ${n.id}  · no-trace`); }
}
console.log(`\nLINKED=${linked}  no-trace=${noTrace}  misaligned=${misaligned}`);
// Assertions: every tool node should link a 'tool' span; turn nodes should link kernel.turn.
const toolNodes = nodes.filter(n => n.type === 'toolCall');
const toolLinked = toolNodes.filter(n => traces.get(n.id)?.span?.name === 'tool').length;
const turnNodes = nodes.filter(n => n.type === 'turn');
const turnLinked = turnNodes.filter(n => traces.get(n.id)?.span?.name === 'kernel.turn').length;
console.log(`\nAC-P2-1 tool←callId : ${toolLinked}/${toolNodes.length} tool nodes linked a 'tool' span`);
console.log(`AC-P2-3 turn←ordinal: ${turnLinked}/${turnNodes.length} turn nodes linked a 'kernel.turn' span`);
