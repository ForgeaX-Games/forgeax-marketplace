import { useEffect, useRef, useCallback } from 'react';
import type { Node, Edge } from 'reactflow';
import { useObservatoryStore } from '../store/observatoryStore';

interface AgentEventEnvelope {
  sessionId: string;
  event: {
    type: string;
    subtype?: string;
    [key: string]: unknown;
  };
  ts: number;
}

type NodeMap = Map<string, Node>;
type EdgeMap = Map<string, Edge>;

function applyEvent(
  envelope: AgentEventEnvelope,
  nodes: NodeMap,
  edges: EdgeMap,
  turnCounter: { current: number },
  pendingUserText: { current: string },
): boolean {
  const { event } = envelope;
  let changed = false;

  if (event.type === 'user_message') {
    pendingUserText.current = ((event.text as string) ?? '').slice(0, 200);
    return false;
  }

  if (event.type === 'system' && event.subtype === 'init') {
    nodes.set('session-root', {
      id: 'session-root',
      type: 'systemModule',
      position: { x: 200, y: 0 },
      data: {
        id: 'session',
        tag: 'init',
        charCount: 0,
        estimatedTokens: 0,
        percentOfTotal: 0,
        sourceFile: '',
        findingsCount: 0,
        errorCount: 0,
        isPersona: false,
        model: event.model,
        persona: event.persona,
        status: 'running',
      },
    });
    changed = true;
  }

  if (event.type === 'llm_call' && event.subtype === 'start') {
    const idx = turnCounter.current++;
    const id = `turn-${idx}`;
    const y = 100 + idx * 200;
    const userText = pendingUserText.current || `Iteration ${event.iteration}`;
    pendingUserText.current = '';
    nodes.set(id, {
      id,
      type: 'turn',
      position: { x: 200, y },
      data: {
        index: idx,
        model: (event.model as string) || '',
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        userSummary: userText,
        assistantSummary: '',
        toolNames: [],
        hasReminder: false,
        subAgentCount: 0,
        status: 'thinking',
      },
    });
    const prevId = idx > 0 ? `turn-${idx - 1}` : 'session-root';
    if (nodes.has(prevId)) {
      edges.set(`e-${prevId}-${id}`, {
        id: `e-${prevId}-${id}`,
        source: prevId,
        target: id,
        type: 'observatory',
        data: { edgeType: 'sequential' },
      });
    }
    changed = true;
  }

  if (event.type === 'llm_call' && event.subtype === 'end') {
    const idx = turnCounter.current - 1;
    const id = `turn-${idx}`;
    const node = nodes.get(id);
    if (node) {
      const usage = event.usage as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number } | undefined;
      const existingSummary = node.data.assistantSummary;
      node.data = {
        ...node.data,
        status: event.stopReason === 'tool_use' ? 'tool_calling' : 'completed',
        durationMs: event.durationMs ?? 0,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cacheReadTokens ?? 0,
        cacheCreationTokens: usage?.cacheCreationTokens ?? 0,
        assistantSummary: existingSummary || `stop: ${event.stopReason ?? 'end_turn'}`,
        stopReason: event.stopReason ?? 'end_turn',
      };
      changed = true;
    }
  }

  if (event.type === 'text') {
    const idx = turnCounter.current - 1;
    const id = `turn-${idx}`;
    const node = nodes.get(id);
    if (node) {
      const prev = node.data.textContent ?? '';
      const full = prev + (event.content ?? '');
      node.data = {
        ...node.data,
        textContent: full,
        assistantSummary: full.slice(0, 80).replace(/\n/g, ' '),
      };
      changed = true;
    }
  }

  if (event.type === 'model_resolved') {
    const idx = turnCounter.current - 1;
    const id = `turn-${idx}`;
    const node = nodes.get(id);
    if (node) {
      node.data = { ...node.data, model: event.model ?? node.data.model };
      changed = true;
    }
    const rootNode = nodes.get('session-root');
    if (rootNode && rootNode.data.model === 'unknown') {
      rootNode.data = { ...rootNode.data, model: event.model ?? rootNode.data.model };
    }
  }

  if (event.type === 'text_delta') {
    const idx = turnCounter.current - 1;
    const id = `turn-${idx}`;
    const node = nodes.get(id);
    if (node) {
      const prev = node.data.textContent ?? '';
      node.data = { ...node.data, textContent: prev + (event.delta ?? '') };
    }
  }

  if (event.type === 'tool_use') {
    const turnIdx = turnCounter.current - 1;
    const turnId = `turn-${turnIdx}`;
    const toolId = `tool-${event.toolUseId}`;
    const turnNode = nodes.get(turnId);
    const y = (turnNode?.position.y ?? 100) + 20;

    nodes.set(toolId, {
      id: toolId,
      type: 'toolCall',
      position: { x: 500, y },
      data: {
        toolName: event.name,
        inputSummary: JSON.stringify(event.input ?? {}).slice(0, 50),
        inputFull: JSON.stringify(event.input ?? {}, null, 2),
        hasReminder: false,
        status: 'running',
      },
    });

    edges.set(`e-${turnId}-${toolId}`, {
      id: `e-${turnId}-${toolId}`,
      source: turnId,
      target: toolId,
      type: 'observatory',
      data: { edgeType: 'sequential' },
    });

    if (turnNode) {
      const names = [...(turnNode.data.toolNames || []), event.name];
      turnNode.data = { ...turnNode.data, toolNames: names, status: 'tool_calling' };
    }
    changed = true;
  }

  if (event.type === 'tool_result') {
    const toolId = `tool-${event.toolUseId}`;
    const node = nodes.get(toolId);
    if (node) {
      const output = (event.output ?? event.result ?? '') as string;
      node.data = {
        ...node.data,
        status: event.isError ? 'error' : 'completed',
        hasReminder: false,
        outputResult: output.slice(0, 2000),
        isError: event.isError ?? false,
      };
      changed = true;
    }
  }

  if (event.type === 'sub_agent' && event.subtype === 'started') {
    const saId = `agent-${event.agentId}`;

    // Find the spawn_agent tool node that triggered this sub-agent
    let parentId: string | null = null;
    for (const [id, node] of nodes) {
      if (node.type === 'toolCall' && node.data.toolName === 'spawn_agent' && node.data.status === 'running') {
        parentId = id;
        break;
      }
    }
    // Fallback to current turn if no matching tool node
    if (!parentId) {
      const turnIdx = turnCounter.current - 1;
      parentId = `turn-${turnIdx}`;
    }

    const parentNode = nodes.get(parentId);
    const y = (parentNode?.position.y ?? 100) + 40;

    nodes.set(saId, {
      id: saId,
      type: 'subAgent',
      position: { x: 550, y },
      data: {
        agentId: event.agentId,
        agentType: event.agentType,
        task: event.task,
        status: 'running',
        persona: event.persona ?? '',
        identityBlock: event.identityBlock ?? '',
      },
    });
    edges.set(`e-fork-${parentId}-${saId}`, {
      id: `e-fork-${parentId}-${saId}`,
      source: parentId,
      target: saId,
      type: 'observatory',
      data: { edgeType: 'fork' },
    });
    changed = true;
  }

  if (event.type === 'sub_agent' && event.subtype === 'progress') {
    const saId = `agent-${event.agentId}`;
    const node = nodes.get(saId);
    const inner = (event as any).event;
    if (!node || !inner) { return changed; }

    // Track sub-agent turn counter
    if (inner.type === 'llm_call' && inner.subtype === 'start') {
      const turns = (node.data.turns ?? 0) + 1;
      node.data = { ...node.data, turns, lastProgress: `turn ${turns}` };

      const subTurnId = `${saId}-turn-${turns - 1}`;
      const parentY = (node.position?.y ?? 200);
      nodes.set(subTurnId, {
        id: subTurnId,
        type: 'turn',
        position: { x: 700, y: parentY + turns * 120 },
        data: {
          index: turns - 1,
          model: (inner.model as string) || '',
          inputTokens: 0, outputTokens: 0, durationMs: 0,
          userSummary: `${node.data.agentId} iter ${inner.iteration ?? turns - 1}`,
          assistantSummary: '',
          toolNames: [],
          hasReminder: false,
          subAgentCount: 0,
          status: 'thinking',
        },
      });
      // Connect to parent agent or previous sub-turn
      const prevSubTurn = turns > 1 ? `${saId}-turn-${turns - 2}` : saId;
      edges.set(`e-${prevSubTurn}-${subTurnId}`, {
        id: `e-${prevSubTurn}-${subTurnId}`,
        source: prevSubTurn,
        target: subTurnId,
        type: 'observatory',
        data: { edgeType: 'sequential' },
      });
      changed = true;
    }

    if (inner.type === 'llm_call' && inner.subtype === 'end') {
      const turns = node.data.turns ?? 1;
      const subTurnId = `${saId}-turn-${turns - 1}`;
      const subTurn = nodes.get(subTurnId);
      if (subTurn) {
        const usage = inner.usage as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number } | undefined;
        subTurn.data = {
          ...subTurn.data,
          status: 'completed',
          durationMs: inner.durationMs ?? 0,
          inputTokens: usage?.inputTokens ?? 0,
          outputTokens: usage?.outputTokens ?? 0,
          cacheReadTokens: usage?.cacheReadTokens ?? 0,
          cacheCreationTokens: usage?.cacheCreationTokens ?? 0,
          assistantSummary: `stop: ${inner.stopReason ?? 'end'}`,
        };
        changed = true;
      }
    }

    if (inner.type === 'tool_use') {
      const turns = node.data.turns ?? 1;
      const subTurnId = `${saId}-turn-${turns - 1}`;
      const subTurn = nodes.get(subTurnId);
      if (subTurn) {
        const names = [...(subTurn.data.toolNames || []), inner.name];
        subTurn.data = { ...subTurn.data, toolNames: names, status: 'tool_calling' };

        // Create toolCall node (same as main agent)
        const toolId = `${saId}-tool-${inner.toolUseId}`;
        const y = (subTurn.position?.y ?? 200) + 20;
        nodes.set(toolId, {
          id: toolId,
          type: 'toolCall',
          position: { x: 800, y },
          data: {
            toolName: inner.name,
            inputSummary: JSON.stringify(inner.input ?? {}).slice(0, 50),
            inputFull: JSON.stringify(inner.input ?? {}, null, 2),
            hasReminder: false,
            status: 'running',
          },
        });
        edges.set(`e-${subTurnId}-${toolId}`, {
          id: `e-${subTurnId}-${toolId}`,
          source: subTurnId,
          target: toolId,
          type: 'observatory',
          data: { edgeType: 'sequential' },
        });
        changed = true;
      }
    }

    if (inner.type === 'tool_result') {
      const toolId = `${saId}-tool-${inner.toolUseId}`;
      const toolNode = nodes.get(toolId);
      if (toolNode) {
        const output = (inner.output ?? inner.result ?? '') as string;
        toolNode.data = {
          ...toolNode.data,
          status: inner.isError ? 'error' : 'completed',
          outputResult: output.slice(0, 2000),
          isError: inner.isError ?? false,
        };
        changed = true;
      }
    }

    if (inner.type === 'text') {
      const turns = node.data.turns ?? 1;
      const subTurnId = `${saId}-turn-${turns - 1}`;
      const subTurn = nodes.get(subTurnId);
      if (subTurn) {
        const prev = subTurn.data.textContent ?? '';
        subTurn.data = { ...subTurn.data, textContent: prev + (inner.content ?? '') };
      }
      node.data = { ...node.data, lastProgress: (inner.content ?? '').slice(0, 60) };
      changed = true;
    }
  }

  if (event.type === 'sub_agent' && event.subtype === 'done') {
    const saId = `agent-${event.agentId}`;
    const node = nodes.get(saId);
    if (node) {
      node.data = {
        ...node.data,
        status: event.status === 'completed' ? 'completed' : 'failed',
        resultSummary: typeof event.result === 'string' ? event.result.slice(0, 100) : '',
      };
      const turnIdx = turnCounter.current - 1;
      const turnId = `turn-${turnIdx}`;
      edges.set(`e-merge-${saId}-${turnId}`, {
        id: `e-merge-${saId}-${turnId}`,
        source: saId,
        target: turnId,
        type: 'observatory',
        data: { edgeType: 'merge' },
      });
      changed = true;
    }
  }

  if (event.type === 'context_update') {
    const turnIdx = turnCounter.current - 1;
    const turnId = `turn-${turnIdx}`;
    const node = nodes.get(turnId);
    if (node) {
      const tokens = event.tokens as { used?: number; limit?: number; percent?: number } | undefined;
      node.data = {
        ...node.data,
        inputTokens: tokens?.used ?? node.data.inputTokens,
      };
      changed = true;
    }
  }

  if (event.type === 'turn_end') {
    const turnIdx = turnCounter.current - 1;
    const turnId = `turn-${turnIdx}`;
    const node = nodes.get(turnId);
    if (node) {
      const usage = event.usage as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number } | undefined;
      node.data = {
        ...node.data,
        status: 'completed',
        durationMs: event.durationMs ?? node.data.durationMs,
        inputTokens: usage?.inputTokens ?? node.data.inputTokens,
        outputTokens: usage?.outputTokens ?? node.data.outputTokens,
        cacheReadTokens: usage?.cacheReadTokens ?? node.data.cacheReadTokens ?? 0,
        cacheCreationTokens: usage?.cacheCreationTokens ?? node.data.cacheCreationTokens ?? 0,
      };
      changed = true;
    }
  }

  return changed;
}

export function useEventStream(sessionId: string | null, live: boolean) {
  const nodesRef = useRef<NodeMap>(new Map());
  const edgesRef = useRef<EdgeMap>(new Map());
  const turnCounterRef = useRef({ current: 0 });
  const pendingUserTextRef = useRef({ current: '' });
  const setLiveGraph = useObservatoryStore(s => s.setLiveGraph);

  const flush = useCallback(() => {
    setLiveGraph(
      Array.from(nodesRef.current.values()),
      Array.from(edgesRef.current.values()),
    );
  }, [setLiveGraph]);

  useEffect(() => {
    if (!live || !sessionId) return;

    nodesRef.current.clear();
    edgesRef.current.clear();
    turnCounterRef.current = { current: 0 };
    pendingUserTextRef.current = { current: '' };
    flush();

    // SSE connection — server replays full history on connect, then streams live events
    const url = `/api/observatory/events${sessionId !== 'current' ? `?session=${encodeURIComponent(sessionId)}` : ''}`;
    const es = new EventSource(url);
    let pendingFlush = false;

    es.onmessage = (msg) => {
      try {
        const envelope: AgentEventEnvelope = JSON.parse(msg.data);
        if (!envelope.event) return;
        const changed = applyEvent(envelope, nodesRef.current, edgesRef.current, turnCounterRef.current, pendingUserTextRef.current);
        if (changed && !pendingFlush) {
          pendingFlush = true;
          requestAnimationFrame(() => {
            pendingFlush = false;
            flush();
          });
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => { es.close(); };
  }, [sessionId, live, flush]);
}
