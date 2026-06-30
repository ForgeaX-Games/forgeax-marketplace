import { useMemo } from 'react';
import dagre from '@dagrejs/dagre';
import type { Node, Edge } from 'reactflow';

const BASE_W: Record<string, number> = {
  systemModule: 200, turn: 240, toolCall: 170, subAgent: 190, default: 170,
};
const BASE_H: Record<string, number> = {
  systemModule: 72, turn: 115, toolCall: 54, subAgent: 62, default: 54,
};

function nodeWidth(node: Node): number {
  const base = BASE_W[node.type ?? 'default'] ?? BASE_W.default;
  const d = node.data;
  const textLen = Math.max(
    ((d.toolName ?? '') + (d.inputSummary ?? '')).length,
    (d.userSummary ?? '').length,
    ((d.agentId ?? '') + (d.task ?? '')).length,
    ((d.model ?? '') + (d.persona ?? '')).length,
  );
  return Math.min(base + textLen * 1.2, 380);
}

function nodeHeight(type?: string): number {
  return BASE_H[type ?? 'default'] ?? BASE_H.default;
}

export function useGraphLayout(nodes: Node[], edges: Edge[], _mode?: string) {
  return useMemo(() => {
    if (nodes.length === 0) return { nodes, edges };

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: 'TB',
      nodesep: 24,
      ranksep: 36,
      marginx: 30,
      marginy: 30,
      align: 'UL',
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const node of nodes) {
      const w = nodeWidth(node);
      const h = nodeHeight(node.type);
      g.setNode(node.id, { width: w, height: h });
    }

    for (const edge of edges) {
      g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    const layoutNodes = nodes.map(node => {
      const pos = g.node(node.id);
      const w = nodeWidth(node);
      const h = nodeHeight(node.type);
      return {
        ...node,
        position: { x: pos.x - w / 2, y: pos.y - h / 2 },
      };
    });

    return { nodes: layoutNodes, edges };
  }, [nodes, edges]);
}
