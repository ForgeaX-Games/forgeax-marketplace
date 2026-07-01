import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactFlow, { Background, MiniMap, Controls, applyNodeChanges, type Node, type Edge, type NodeChange } from 'reactflow';
import 'reactflow/dist/style.css';
import { useObservatoryStore, type ContextBlock } from '../store/observatoryStore';
import { useObservatoryData } from '../hooks/useObservatoryData';
import { useSessionNodes } from '../hooks/useSessionNodes';
import { useGraphLayout } from '../hooks/useGraphLayout';
import { useEventStream } from '../hooks/useEventStream';
import { useTelemetryStream } from '../hooks/useTelemetryStream';
import { joinTelemetryToNodes } from '../lib/join-telemetry';
import { SystemModuleNode } from './nodes/SystemModuleNode';
import { TurnNode } from './nodes/TurnNode';
import { ToolCallNode } from './nodes/ToolCallNode';
import { SubAgentNode } from './nodes/SubAgentNode';
import { ReminderNode } from './nodes/ReminderNode';
import { CompactNode } from './nodes/CompactNode';
import { ApprovalNode } from './nodes/ApprovalNode';
import { ObservatoryEdge } from './edges/ObservatoryEdge';
import { ModuleSidebar } from './ModuleSidebar';

const nodeTypes = {
  systemModule: SystemModuleNode,
  turn: TurnNode,
  toolCall: ToolCallNode,
  subAgent: SubAgentNode,
  reminder: ReminderNode,
  compact: CompactNode,
  approval: ApprovalNode,
};

const edgeTypes = { observatory: ObservatoryEdge };

const EMPTY_EDGES: Edge[] = [];

const PLACEHOLDER_NODES: Node[] = [{
  id: 'welcome', type: 'default', position: { x: 250, y: 200 },
  data: { label: 'Context Observatory — select a session or switch to Live mode' },
  style: { background: 'rgba(255,255,255,0.06)', color: '#ffffff', border: '1px solid rgba(212,255,72,0.4)', borderRadius: 10, fontSize: 13, padding: '12px 20px', backdropFilter: 'blur(8px)' },
}];

const NODE_TYPE_COLORS: Record<string, string> = {
  systemModule: '#D4FF48', turn: '#4B9EFF', toolCall: '#A78BFA',
  subAgent: '#F97316', reminder: '#FBBF24', compact: '#8b5cf6',
  approval: '#FBBF24', default: '#D4FF48',
};

async function fetchInspectModules(sid: string) {
  const res = await fetch(`/api/observatory/inspect?session=${encodeURIComponent(sid)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const sp = json.systemPrompt;
  return {
    modules: (sp?.modules ?? []) as ContextBlock[],
    estimatedTokens: (sp?.estimatedTokens ?? 0) as number,
  };
}


export function ObservatoryCanvas() {
  const {
    sessionPath, sessionMode, liveNodes, liveEdges,
    openSidebarLoading, setSidebarSystemData, setSidebarTurnNode, closeSidebar,
    spansById, logsBySpanId, setNodeTraces,
  } = useObservatoryStore();

  const isLive = sessionMode === 'live';
  // sessionPath is the canonical sid; null falls through to 'current' (server
  // resolves to the most-recently-touched session). Switching the dropdown
  // mutates sessionPath, so the dependency below tears down + reconnects the
  // EventSource to the new session — that's the whole "switch session →
  // switch Observatory" requirement.
  useEventStream(isLive ? (sessionPath ?? 'current') : null, isLive);

  const { data, loading, error } = useObservatoryData(isLive ? null : sessionPath);
  const staticGraph = useSessionNodes(data);
  const layoutedStatic = useGraphLayout(staticGraph.nodes, staticGraph.edges, 'timeline');
  const layoutedLive = useGraphLayout(liveNodes, liveEdges, 'timeline');

  const showPlaceholder = !isLive && !sessionPath;
  const sourceNodes = useMemo(() =>
    showPlaceholder ? PLACEHOLDER_NODES : (isLive ? layoutedLive.nodes : layoutedStatic.nodes),
    [showPlaceholder, isLive, layoutedLive.nodes, layoutedStatic.nodes],
  );
  const sourceEdges = useMemo(() =>
    showPlaceholder ? EMPTY_EDGES : (isLive ? layoutedLive.edges : layoutedStatic.edges),
    [showPlaceholder, isLive, layoutedLive.edges, layoutedStatic.edges],
  );

  const [displayNodes, setDisplayNodes] = useState<Node[]>(sourceNodes);
  const [displayEdges, setDisplayEdges] = useState<Edge[]>(sourceEdges);

  useEffect(() => {
    setDisplayNodes(sourceNodes);
    setDisplayEdges(sourceEdges);
  }, [sourceNodes, sourceEdges]);

  // Telemetry overlay (todo 038) — subscribe the same session and join spans/logs
  // onto the existing nodes. Pure additive: when telemetry is empty/off the join
  // simply marks traceable nodes 'no-trace' and the trajectory is untouched.
  const telemetrySid = sessionPath ?? (isLive ? 'current' : null);
  useTelemetryStream(showPlaceholder ? null : telemetrySid, !showPlaceholder);
  const nodeTraces = useMemo(
    () => joinTelemetryToNodes(sourceNodes, spansById, logsBySpanId),
    [sourceNodes, spansById, logsBySpanId],
  );
  useEffect(() => { setNodeTraces(nodeTraces); }, [nodeTraces, setNodeTraces]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setDisplayNodes(nds => applyNodeChanges(changes, nds));
  }, []);

  const handleNodeDoubleClick = useCallback(async (_event: React.MouseEvent, node: Node) => {
    // Honor sessionPath in BOTH live and static modes — when the operator
    // pinned a specific session in the dropdown the inspect panel must show
    // that session's prompt, not the server-resolved "current".
    const sid = sessionPath ?? (isLive ? 'current' : '');
    if (!sid) return;

    if (node.type === 'systemModule') {
      openSidebarLoading('System Prompt');
      try {
        const { modules, estimatedTokens } = await fetchInspectModules(sid);
        setSidebarSystemData(modules, estimatedTokens);
      } catch { closeSidebar(); }
      return;
    }

    // For turn nodes (and tool/agent nodes → find parent turn)
    let targetNodeId: string;
    let targetLabel: string;
    if (node.type === 'turn') {
      targetNodeId = node.id;
      targetLabel = node.id.startsWith('agent-') ? `${node.data.userSummary ?? node.id}` : `Turn ${node.data.index ?? 0}`;
    } else if (node.type === 'subAgent') {
      // Double-clicked the sub-agent node itself — find its first turn
      const firstTurnId = `${node.id}-turn-0`;
      const firstTurn = displayNodes.find(n => n.id === firstTurnId);
      if (firstTurn) {
        targetNodeId = firstTurnId;
        targetLabel = `${node.data.agentId ?? node.id}`;
      } else {
        targetNodeId = node.id;
        targetLabel = `${node.data.agentId ?? node.id}`;
      }
    } else {
      const parentEdge = displayEdges.find(e => e.target === node.id);
      const parentNode = parentEdge ? displayNodes.find(n => n.id === parentEdge.source) : null;
      if (parentNode?.type === 'turn') {
        targetNodeId = parentNode.id;
        targetLabel = parentNode.id.startsWith('agent-') ? `${parentNode.data.userSummary ?? parentNode.id}` : `Turn ${parentNode.data.index ?? 0}`;
      } else {
        return;
      }
    }

    // For sub-agent turns, find the parent subAgent node to extract persona + task
    let agentContext: { persona: string; identityBlock: string } | undefined;
    if (targetNodeId.startsWith('agent-')) {
      // Could be 'agent-xxx-turn-N' or 'agent-xxx' (the subAgent node itself)
      const agentPrefix = targetNodeId.includes('-turn-')
        ? targetNodeId.replace(/-turn-\d+$/, '')
        : targetNodeId;
      const agentNode = displayNodes.find(n => n.id === agentPrefix && n.type === 'subAgent');
      if (agentNode?.data) {
        const { persona, identityBlock } = agentNode.data;
        if (persona || identityBlock) {
          agentContext = { persona: persona ?? '', identityBlock: identityBlock ?? '' };
        }
      }
    }

    openSidebarLoading(targetLabel);
    try {
      const { modules, estimatedTokens } = await fetchInspectModules(sid);
      setSidebarTurnNode(targetNodeId, targetLabel, modules, estimatedTokens, agentContext);
    } catch { closeSidebar(); }
  }, [isLive, sessionPath, displayNodes, displayEdges, openSidebarLoading, setSidebarSystemData, setSidebarTurnNode, closeSidebar]);

  return (
    <>
      {isLive && (
        <div style={{ position: 'absolute', top: 48, left: 12, zIndex: 20, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(16,16,16,0.9)', padding: '4px 10px', borderRadius: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#D4FF48', display: 'inline-block', animation: 'ob-blink 1.5s ease-in-out infinite' }} />
          <span style={{ color: '#D4FF48' }}>Live</span>
          <span style={{ color: 'var(--ob-node-text-dim)' }}>· {displayNodes.length} nodes</span>
        </div>
      )}
      {!isLive && loading && (
        <div style={{ position: 'absolute', top: 48, left: 12, zIndex: 20, fontSize: 11, color: 'var(--ob-system)', background: 'rgba(16,16,16,0.9)', padding: '4px 10px', borderRadius: 6 }}>
          Loading session...
        </div>
      )}
      {!isLive && error && (
        <div style={{ position: 'absolute', top: 48, left: 12, zIndex: 20, fontSize: 11, color: 'var(--ob-error)', background: 'rgba(16,16,16,0.9)', padding: '4px 10px', borderRadius: 6 }}>
          Error: {error}
        </div>
      )}
      <ReactFlow
        nodes={displayNodes} edges={displayEdges}
        nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDoubleClick={handleNodeDoubleClick}
        nodesDraggable fitView panOnScroll
        zoomOnScroll={false} zoomOnPinch
        zoomOnDoubleClick={false} panOnDrag
        proOptions={{ hideAttribution: true }}
        style={{ background: 'var(--ob-bg-canvas)' }}
      >
        <Background color="rgba(255, 255, 255, 0.04)" gap={20} size={1} />
        <MiniMap
          nodeColor={(n) => NODE_TYPE_COLORS[n.type ?? 'default'] ?? '#D4FF48'}
          maskColor="rgba(15, 15, 15, 0.85)"
          position="bottom-left"
          style={{ background: 'rgba(16, 16, 16, 0.9)', borderRadius: 8 }}
        />
        <Controls style={{ background: 'rgba(16, 16, 16, 0.9)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)' }} />
      </ReactFlow>
      <ModuleSidebar />
    </>
  );
}
