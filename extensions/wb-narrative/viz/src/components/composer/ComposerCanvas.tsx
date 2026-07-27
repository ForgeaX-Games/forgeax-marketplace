import { useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "reactflow";
import { useNarrativeStore } from "../../store/narrativeStore";
import {
  COMPOSER_DND_MIME,
  computeAnchoredPipelines,
  findCatalogItem,
  type ComposerNodeCategory,
} from "../../composer/composerCatalog";

const CATEGORY_COLOR: Record<ComposerNodeCategory, string> = {
  input: "rgba(120,200,255,0.9)",
  routing: "rgba(255,190,120,0.9)",
  expert: "rgba(77,255,160,0.9)",
  assistant: "rgba(200,150,255,0.9)",
  engineer: "rgba(255,235,120,0.9)",
};

interface ComposerCanvasProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * 无限画布编排的可编辑 ReactFlow。数据源为 store 的 composer 切片；支持拖入(onDrop)、
 * 活连线(onConnect)、拖动持久化(onNodesChange)、删除(onNodesDelete/onEdgesDelete)。
 * 孤立节点（无输入节点可达）置灰提示。
 */
export function ComposerCanvas({ selectedId, onSelect }: ComposerCanvasProps) {
  const composerNodes = useNarrativeStore((s) => s.composerNodes);
  const composerEdges = useNarrativeStore((s) => s.composerEdges);
  const addComposerNode = useNarrativeStore((s) => s.addComposerNode);
  const moveComposerNode = useNarrativeStore((s) => s.moveComposerNode);
  const connectComposer = useNarrativeStore((s) => s.connectComposer);
  const removeComposerNode = useNarrativeStore((s) => s.removeComposerNode);
  const removeComposerEdge = useNarrativeStore((s) => s.removeComposerEdge);
  const { project } = useReactFlow();

  const isolatedIds = useMemo(() => {
    const anchored = computeAnchoredPipelines(composerNodes, composerEdges);
    const reachable = new Set<string>();
    for (const p of anchored) for (const id of p.nodeIds) reachable.add(id);
    return new Set(composerNodes.filter((n) => !reachable.has(n.id)).map((n) => n.id));
  }, [composerNodes, composerEdges]);

  const rfNodes: Node[] = useMemo(
    () =>
      composerNodes.map((n) => {
        const isolated = isolatedIds.has(n.id) && n.category !== "input";
        const color = CATEGORY_COLOR[n.category];
        return {
          id: n.id,
          position: n.position,
          data: { label: `${n.icon}  ${n.label}` },
          selected: n.id === selectedId,
          style: {
            background: "rgba(6,14,10,0.92)",
            border: `1px solid ${n.id === selectedId ? color : "rgba(77,255,160,0.35)"}`,
            borderRadius: 8,
            color: isolated ? "rgba(200,220,210,0.4)" : "rgba(220,255,235,0.95)",
            fontSize: 12,
            padding: "8px 12px",
            width: 190,
            opacity: isolated ? 0.5 : 1,
            boxShadow: n.id === selectedId ? `0 0 0 2px ${color}` : undefined,
          },
        } satisfies Node;
      }),
    [composerNodes, isolatedIds, selectedId],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      composerEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        animated: true,
        style: { stroke: "rgba(77,255,160,0.5)" },
      })),
    [composerEdges],
  );

  const [nodes, setNodes, onNodesChangeRF] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChangeRF] = useEdgesState(rfEdges);

  useEffect(() => { setNodes(rfNodes); }, [rfNodes, setNodes]);
  useEffect(() => { setEdges(rfEdges); }, [rfEdges, setEdges]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeRF(changes);
      for (const c of changes) {
        if (c.type === "position" && c.position && !c.dragging) {
          moveComposerNode(c.id, c.position);
        }
      }
    },
    [onNodesChangeRF, moveComposerNode],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => { onEdgesChangeRF(changes); },
    [onEdgesChangeRF],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      setEdges((eds) => addEdge({ ...conn, animated: true }, eds));
      connectComposer(conn.source, conn.target);
    },
    [connectComposer, setEdges],
  );

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const n of deleted) removeComposerNode(n.id);
      if (deleted.some((n) => n.id === selectedId)) onSelect(null);
    },
    [removeComposerNode, selectedId, onSelect],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => { for (const e of deleted) removeComposerEdge(e.id); },
    [removeComposerEdge],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(COMPOSER_DND_MIME);
      if (!raw) return;
      let catalogId: string | undefined;
      try { catalogId = JSON.parse(raw).catalogId; } catch { return; }
      if (!catalogId) return;
      const item = findCatalogItem(catalogId);
      if (!item) return;
      const position = project({ x: e.clientX, y: e.clientY });
      const id = addComposerNode(item, position);
      onSelect(id);
    },
    [project, addComposerNode, onSelect],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => { onSelect(node.id); },
    [onSelect],
  );

  const onPaneClick = useCallback(() => { onSelect(null); }, [onSelect]);

  return (
    <div style={{ width: "100%", height: "100%" }} onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.2}
        maxZoom={2}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.1} color="rgba(77,255,160,0.05)" />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            const node = composerNodes.find((c) => c.id === n.id);
            return node ? CATEGORY_COLOR[node.category] : "rgba(77,255,160,0.2)";
          }}
          maskColor="rgba(4,8,2,0.8)"
          style={{ background: "rgba(6,10,4,0.95)" }}
        />
      </ReactFlow>
    </div>
  );
}
