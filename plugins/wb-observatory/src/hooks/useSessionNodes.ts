import { useMemo } from 'react';
import type { Node, Edge } from 'reactflow';
import type { ObservatoryData } from './useObservatoryData';

interface Turn {
  index: number;
  model: string;
  durationMs: number;
  usage: { input: number; output: number };
  userBlocks: Array<{ summary: string }>;
  assistantBlocks: Array<{ summary: string }>;
  toolCalls: Array<{ toolName: string; hasReminder: boolean }>;
  reminders: Array<{ timeContext?: { date: string; lastInteraction: string }; scratchpadPath?: string }>;
  subAgentEvents: Array<{ type: string; agentId: string; agentType?: string; task?: string; summary?: string }>;
  commEvents: Array<{ type: string; from: string; to: string; summary?: string; approved?: boolean }>;
}

function buildTimelineNodes(data: ObservatoryData): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const turns = (data.turns ?? []) as Turn[];

  let y = 0;
  let prevId: string | null = null;

  for (const turn of turns) {
    const id = `turn-${turn.index}`;
    nodes.push({
      id,
      type: 'turn',
      position: { x: 200, y },
      data: {
        index: turn.index,
        model: turn.model || 'unknown',
        inputTokens: turn.usage?.input ?? 0,
        outputTokens: turn.usage?.output ?? 0,
        durationMs: turn.durationMs ?? 0,
        userSummary: turn.userBlocks?.[0]?.summary?.slice(0, 60) ?? '',
        assistantSummary: turn.assistantBlocks?.[0]?.summary?.slice(0, 60) ?? '',
        toolNames: turn.toolCalls?.map(t => t.toolName) ?? [],
        hasReminder: turn.reminders?.length > 0,
        subAgentCount: turn.subAgentEvents?.length ?? 0,
      },
    });

    if (prevId) {
      edges.push({
        id: `e-${prevId}-${id}`,
        source: prevId,
        target: id,
        type: 'observatory',
        data: { edgeType: 'sequential' },
      });
    }

    for (const sa of (turn.subAgentEvents ?? [])) {
      if (sa.type !== 'spawn') continue;
      const saId = `agent-${sa.agentId}-${turn.index}`;
      nodes.push({
        id: saId,
        type: 'subAgent',
        position: { x: 550, y },
        data: {
          agentId: sa.agentId,
          agentType: sa.agentType,
          task: sa.task,
          status: 'completed',
          resultSummary: sa.summary,
        },
      });
      edges.push({
        id: `e-fork-${id}-${saId}`,
        source: id,
        target: saId,
        type: 'observatory',
        data: { edgeType: 'fork' },
      });
    }

    prevId = id;
    y += 180;
  }

  return { nodes, edges };
}

export function useSessionNodes(data: ObservatoryData | null) {
  return useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[] };
    return buildTimelineNodes(data);
  }, [data]);
}
