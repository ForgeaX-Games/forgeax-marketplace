import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type NodeTypes,
  type EdgeTypes,
  type NodeChange,
  BackgroundVariant,
  ReactFlowProvider,
} from "reactflow";
import { useNarrativeStore } from "../store/narrativeStore";
import { useOrderedSteps } from "../hooks/useOrderedSteps";
import { PipelineStepNode } from "./nodes/PipelineStepNode";
import { StoryGroupNode } from "./nodes/StoryGroupNode";
import { StoryChildNode } from "./nodes/StoryChildNode";
import { NarrativeCardNode } from "./nodes/NarrativeCardNode";
import { DetroitEdge } from "./edges/DetroitEdge";
import { useDetroitLayout } from "../hooks/useDetroitLayout";
import { useAnimatedProgress } from "../hooks/useAnimatedProgress";

class CanvasErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; info: React.ErrorInfo | null }
> {
  state = { error: null as Error | null, info: null as React.ErrorInfo | null };
  static getDerivedStateFromError(error: Error) { return { error, info: null }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 把完整错误推到 console，开发态可直接看到 — 浏览器 DevTools/Console 里搜 [CanvasErrorBoundary]
    console.error("[CanvasErrorBoundary] React tree crashed:", error);
    console.error("[CanvasErrorBoundary] Component stack:", info.componentStack);
    this.setState({ info });
  }
  render() {
    if (this.state.error) {
      const stack = this.state.error.stack ?? "";
      const compStack = this.state.info?.componentStack ?? "";
      return (
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "flex-start",
          width: "100%", height: "100%",
          background: "var(--dt-bg, #060a04)", color: "rgba(255,120,120,0.95)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, padding: 24,
          flexDirection: "column", gap: 10, overflow: "auto",
        }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>节点渲染异常 (CanvasErrorBoundary)</div>
          <div style={{ color: "rgba(255,180,180,0.95)", fontSize: 12, fontWeight: 600 }}>
            {this.state.error.name}: {this.state.error.message}
          </div>
          {stack && (
            <details open style={{ width: "100%" }}>
              <summary style={{ color: "rgba(180,255,200,0.7)", cursor: "pointer", fontSize: 11 }}>JS Stack</summary>
              <pre style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", whiteSpace: "pre-wrap",
                background: "rgba(0,0,0,0.4)", padding: 8, borderRadius: 4, margin: "6px 0", maxHeight: 240, overflow: "auto" }}>
                {stack}
              </pre>
            </details>
          )}
          {compStack && (
            <details open style={{ width: "100%" }}>
              <summary style={{ color: "rgba(180,255,200,0.7)", cursor: "pointer", fontSize: 11 }}>Component Stack</summary>
              <pre style={{ fontSize: 10, color: "rgba(255,255,255,0.55)", whiteSpace: "pre-wrap",
                background: "rgba(0,0,0,0.4)", padding: 8, borderRadius: 4, margin: "6px 0", maxHeight: 240, overflow: "auto" }}>
                {compStack}
              </pre>
            </details>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              style={{ padding: "4px 16px", cursor: "pointer",
                background: "transparent", border: "1px solid rgba(77,255,160,0.3)",
                color: "rgba(77,255,160,0.85)", borderRadius: 2, fontSize: 11 }}
              onClick={() => this.setState({ error: null, info: null })}
            >
              重试
            </button>
            <button
              style={{ padding: "4px 16px", cursor: "pointer",
                background: "transparent", border: "1px solid rgba(150,200,255,0.3)",
                color: "rgba(150,200,255,0.85)", borderRadius: 2, fontSize: 11 }}
              onClick={() => {
                const text = `${this.state.error?.name}: ${this.state.error?.message}\n\n--- JS Stack ---\n${stack}\n\n--- Component Stack ---\n${compStack}`;
                navigator.clipboard?.writeText(text).catch(() => {});
              }}
            >
              复制完整堆栈
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const nodeTypes: NodeTypes = {
  pipelineStep: PipelineStepNode,
  storyGroup: StoryGroupNode,
  storyChild: StoryChildNode,
  narrativeCard: NarrativeCardNode,
};

const edgeTypes: EdgeTypes = {
  detroit: DetroitEdge,
};

function resolveStepId(nodeId: string, steps: { id: string }[]): string | null {
  const hasComposite = steps.some((s) => s.id === "script_scene_generation");
  if (nodeId === "qsg::quest") {
    return hasComposite ? "script_scene_generation" : "quest_generation";
  }
  if (
    nodeId === "qsg::scene" || nodeId === "qsg::scene::p1" || nodeId === "qsg::scene::p2" || nodeId === "qsg::scene::p3"
    || nodeId === "qsg::scene::p1::l0" || nodeId === "qsg::scene::p1::l1" || nodeId === "qsg::scene::p1::l2"
    || nodeId === "qsg::scene::p1::merge"
  ) {
    return hasComposite ? "script_scene_generation" : "scene_generation";
  }
  return null;
}

function NarrativeCanvasInner() {
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const ipPreviewRunId = useNarrativeStore((s) => s.ipPreviewRunId);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const activeResult = useNarrativeStore((s) => s.activeResult);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);

  const isViewingRunning =
    activeEntryKey != null &&
    activeEntryKey === runningEntryKey &&
    (!!runningRunId || !!ipPreviewRunId || runningProgress.length > 0);
  // 加载对象 + 顺序由 useOrderedSteps 统一计算（与文本阅读模式同源同序）。
  const steps = useOrderedSteps();
  const result = activeResult;
  const pipelineStatus = isViewingRunning ? "running" : (activeEntryStatus ?? "idle");
  const selectedStepId = useNarrativeStore((s) => s.focusedStepId);
  const setFocus = useNarrativeStore((s) => s.setFocus);
  const collapsedGraphIds = useNarrativeStore((s) => s.collapsedGraphIds);
  const toggleGraphCollapse = useNarrativeStore((s) => s.toggleGraphCollapse);
  const setCollapsedGraphIds = useNarrativeStore((s) => s.setCollapsedGraphIds);

  const collapsedIds = useMemo(() => new Set(collapsedGraphIds), [collapsedGraphIds]);

  const seenWithDataRef = useRef<Set<string>>(new Set());

  const animState = useAnimatedProgress();

  useEffect(() => {
    if (steps.length === 0) {
      seenWithDataRef.current.clear();
      if (collapsedIds.size > 0) setCollapsedGraphIds([]);
      return;
    }

    const seen = seenWithDataRef.current;
    const toRemove: string[] = [];

    for (const step of steps) {
      if (step.status === "completed" && step.data && !seen.has(step.id)) {
        seen.add(step.id);
        if (collapsedIds.has(step.id)) toRemove.push(step.id);

        if (step.id === "script_scene_generation" || step.id === "quest_generation") {
          if (collapsedIds.has("qsg::quest")) toRemove.push("qsg::quest");
        }
        if (step.id === "script_scene_generation" || step.id === "scene_generation") {
          if (collapsedIds.has("qsg::scene")) toRemove.push("qsg::scene");
          if (collapsedIds.has("qsg::scene::p1")) toRemove.push("qsg::scene::p1");
          if (collapsedIds.has("qsg::scene::p2")) toRemove.push("qsg::scene::p2");
        }
      }
    }

    if (toRemove.length > 0) {
      const next = collapsedGraphIds.filter((id) => !toRemove.includes(id));
      if (next.length !== collapsedGraphIds.length) setCollapsedGraphIds(next);
    }
  }, [steps, collapsedIds, collapsedGraphIds, setCollapsedGraphIds]);

  const { layoutNodes, layoutEdges } = useDetroitLayout(
    steps, result, collapsedIds, selectedStepId,
    animState.progressMap, animState.revealTimestamps,
    pipelineStatus,
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(layoutNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutEdges);
  const { fitView, setCenter, getViewport } = useReactFlow();
  const prevKeyRef = useRef("");
  const fitViewTimerRef = useRef<ReturnType<typeof setTimeout>>();

  type CameraMode = "idle" | "tracking" | "userControl" | "stepOverview" | "finalOverview";
  const cameraModeRef = useRef<CameraMode>("idle");
  const programMoveRef = useRef(false);
  const userIdleTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const prevPipelineStatusRef = useRef(pipelineStatus);
  const prevActiveStepRef = useRef<string | null>(null);
  const activeStepId = useNarrativeStore((s) => s.focusedStepId);

  const adaptiveZoom = useCallback((nodeCount: number) => {
    return Math.max(0.5, Math.min(1.0, 1.0 - (nodeCount - 5) * 0.015));
  }, []);

  const resolveActiveNodeId = useCallback((stepId: string | null): string | null => {
    if (!stepId) return null;
    if (layoutNodes.some((n) => n.id === stepId && !n.parentNode)) return stepId;
    const FORK_MAP: Record<string, string> = {
      quest_generation: "qsg::quest",
      scene_generation: "qsg::scene",
      script_generation: "qsg::quest",
    };
    const mapped = FORK_MAP[stepId];
    if (mapped && layoutNodes.some((n) => n.id === mapped)) return mapped;
    return stepId;
  }, [layoutNodes]);

  const trackCurrentStep = useCallback(() => {
    if (cameraModeRef.current !== "tracking") return;
    const resolvedId = resolveActiveNodeId(activeStepId);
    const runningNode = layoutNodes.find((n) =>
      n.type !== "storyChild" && n.id === resolvedId,
    );
    const targetNode = runningNode ?? layoutNodes.filter((n) =>
      n.type !== "storyChild" && !n.parentNode,
    ).pop();
    if (!targetNode) return;

    const vp = getViewport();
    const vpW = (typeof window !== "undefined" ? window.innerWidth : 1200) / vp.zoom;
    const nodeX = targetNode.position.x + ((targetNode.style?.width as number) ?? 150) / 2;
    const nodeY = targetNode.position.y + ((targetNode.style?.height as number) ?? 50) / 2;
    const centerX = nodeX + vpW * 0.25;
    const childCount = layoutNodes.filter((n) => n.parentNode === targetNode.id).length;
    const zoom = adaptiveZoom(childCount > 0 ? childCount : layoutNodes.filter((n) => !n.parentNode).length);

    programMoveRef.current = true;
    setCenter(centerX, nodeY, { zoom, duration: 500 });
    setTimeout(() => { programMoveRef.current = false; }, 600);
  }, [layoutNodes, activeStepId, getViewport, setCenter, adaptiveZoom, resolveActiveNodeId]);

  useEffect(() => {
    setNodes(layoutNodes);
    setEdges(layoutEdges);

    const key = layoutNodes.map((n) => `${n.id}:${n.type}:${n.style?.width ?? 0}`).join("|");
    const isRunning = pipelineStatus === "running";
    const justStarted = prevPipelineStatusRef.current !== "running" && isRunning;
    const justFinished = prevPipelineStatusRef.current === "running" && !isRunning;
    prevPipelineStatusRef.current = pipelineStatus;

    if (justStarted) {
      cameraModeRef.current = "tracking";
    }

    if (justFinished && pipelineStatus === "completed") {
      cameraModeRef.current = "finalOverview";
      const lastCompleted = layoutNodes.filter((n) => !n.parentNode && n.type !== "storyChild").pop();
      if (lastCompleted) {
        const children = layoutNodes.filter((n) => n.parentNode === lastCompleted.id);
        if (children.length > 5) {
          programMoveRef.current = true;
          setTimeout(() => {
            fitView({ nodes: [lastCompleted, ...children].map((n) => ({ id: n.id })), padding: 0.1, duration: 800 });
            setTimeout(() => { programMoveRef.current = false; }, 900);
          }, 200);
        } else {
          programMoveRef.current = true;
          setTimeout(() => {
            fitView({ padding: 0.05, duration: 800 });
            setTimeout(() => { programMoveRef.current = false; }, 900);
          }, 200);
        }
      } else {
        fitView({ padding: 0.05, duration: 800 });
      }
      return;
    }

    if (cameraModeRef.current === "tracking" && isRunning) {
      const prevStepId = prevActiveStepRef.current;
      const stepChanged = activeStepId !== prevStepId;
      prevActiveStepRef.current = activeStepId;

      if (stepChanged && prevStepId) {
        const resolvedPrev = resolveActiveNodeId(prevStepId);
        const prevNode = layoutNodes.find((n) => n.id === resolvedPrev && !n.parentNode);
        if (prevNode) {
          const childCount = layoutNodes.filter((n) => n.parentNode === prevNode.id).length;
          if (childCount > 5) {
            cameraModeRef.current = "stepOverview";
            programMoveRef.current = true;
            const children = layoutNodes.filter((n) => n.parentNode === prevNode.id);
            fitView({ nodes: [prevNode, ...children].map((n) => ({ id: n.id })), padding: 0.1, duration: 600 });
            setTimeout(() => {
              programMoveRef.current = false;
              cameraModeRef.current = "tracking";
              trackCurrentStep();
            }, 1500);
            return;
          }
        }
      }

      if (fitViewTimerRef.current) clearTimeout(fitViewTimerRef.current);
      fitViewTimerRef.current = setTimeout(trackCurrentStep, 300);
      return;
    }

    if (key !== prevKeyRef.current && !isRunning) {
      prevKeyRef.current = key;
      if (fitViewTimerRef.current) clearTimeout(fitViewTimerRef.current);
      fitViewTimerRef.current = setTimeout(() => fitView({ padding: 0.05, duration: 300 }), 120);
    }

    return () => {
      if (fitViewTimerRef.current) clearTimeout(fitViewTimerRef.current);
    };
  }, [layoutNodes, layoutEdges, setNodes, setEdges, fitView, setCenter, pipelineStatus, activeStepId, trackCurrentStep, adaptiveZoom, getViewport, resolveActiveNodeId]);

  const onMoveStart = useCallback(() => {
    if (programMoveRef.current) return;
    if (cameraModeRef.current === "tracking" || cameraModeRef.current === "stepOverview") {
      cameraModeRef.current = "userControl";
      if (userIdleTimerRef.current) clearTimeout(userIdleTimerRef.current);
      userIdleTimerRef.current = setTimeout(() => {
        if (pipelineStatus === "running") {
          cameraModeRef.current = "tracking";
          trackCurrentStep();
        }
      }, 3000);
    }
  }, [pipelineStatus, trackCurrentStep]);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
    },
    [onNodesChange],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "storyGroup") {
        toggleGraphCollapse(node.id);
        return;
      }

      let stepId = node.id;
      const childNodeId = node.type === "storyChild" ? node.id : null;
      if (stepId.includes("__")) stepId = stepId.split("__")[0];
      const resolved = resolveStepId(stepId, steps);
      if (resolved) stepId = resolved;
      setFocus(selectedStepId === stepId && !childNodeId ? null : stepId, childNodeId);
    },
    [setFocus, toggleGraphCollapse, selectedStepId, steps],
  );

  const onPaneClick = useCallback(() => {
    setFocus(null);
  }, [setFocus]);

  if (steps.length === 0) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: "100%", height: "100%",
        background: "var(--dt-bg, #060a04)", color: "var(--dt-text-sec, rgba(77,255,160,0.3))",
        fontFamily: "var(--font-mono, monospace)", fontSize: 12,
        flexDirection: "column", gap: 6,
      }}>
        <span style={{ fontSize: 24, opacity: 0.3 }}>◈</span>
        <span>运行管线后查看节点图</span>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <LayoutErrorBanner />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onMoveStart={onMoveStart}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.1}
        maxZoom={3}
        defaultEdgeOptions={{ type: "detroit" }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1.1}
          color="rgba(77,255,160,0.04)"
        />
        <Controls showInteractive={false} />
        <MiniMap
          nodeColor={(n) => {
            if (n.type === "storyChild") return "rgba(77,255,160,0.30)";
            let lookupId = n.id;
            const resolved = resolveStepId(n.id, steps);
            if (resolved) lookupId = resolved;
            const step = steps.find((s) => s.id === lookupId);
            if (!step) return "rgba(77,255,160,0.08)";
            if (step.status === "completed") return "rgba(77,255,160,0.70)";
            if (step.status === "running") return "rgba(255,107,53,0.70)";
            if (step.status === "failed") return "rgba(255,80,80,0.60)";
            return "rgba(77,255,160,0.10)";
          }}
          maskColor="rgba(4,8,2,0.80)"
          style={{ background: "rgba(6,10,4,0.95)" }}
        />
      </ReactFlow>
    </div>
  );
}

export function NarrativeCanvas() {
  return (
    <CanvasErrorBoundary>
      <ReactFlowProvider>
        <NarrativeCanvasInner />
      </ReactFlowProvider>
    </CanvasErrorBoundary>
  );
}

interface LayoutErrPayload {
  message: string;
  stack?: string;
  steps: Array<{ id: string; status: string; hasData: boolean }>;
  resultKeys: string[] | null;
  ts: number;
}

function LayoutErrorBanner() {
  const [err, setErr] = useState<LayoutErrPayload | null>(() => {
    const w = window as unknown as { __narrativeLayoutError__?: LayoutErrPayload };
    return w.__narrativeLayoutError__ ?? null;
  });
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<LayoutErrPayload>).detail;
      setErr(detail);
    };
    window.addEventListener("narrative-layout-error", handler);
    return () => window.removeEventListener("narrative-layout-error", handler);
  }, []);

  if (!err) return null;

  const dump = `${err.message}\n\n--- Stack ---\n${err.stack ?? "(no stack)"}\n\n--- Steps ---\n${JSON.stringify(err.steps, null, 2)}\n\n--- Result keys ---\n${JSON.stringify(err.resultKeys, null, 2)}`;

  return (
    <div style={{
      position: "absolute", top: 8, left: 8, right: 8, zIndex: 1000,
      background: "rgba(60,0,0,0.92)", border: "1px solid rgba(255,80,80,0.5)",
      borderRadius: 6, padding: "10px 14px", color: "rgba(255,200,200,0.95)",
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12,
      maxHeight: "60%", overflow: "auto",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>⚠ Layout 计算崩溃 (useDetroitLayout)</span>
        <button
          style={{
            marginLeft: "auto", padding: "2px 10px", cursor: "pointer",
            background: "transparent", border: "1px solid rgba(150,200,255,0.4)",
            color: "rgba(180,220,255,0.95)", borderRadius: 3, fontSize: 11,
          }}
          onClick={() => navigator.clipboard?.writeText(dump).catch(() => {})}
        >
          复制完整堆栈
        </button>
        <button
          style={{
            padding: "2px 10px", cursor: "pointer",
            background: "transparent", border: "1px solid rgba(180,255,200,0.3)",
            color: "rgba(180,255,200,0.85)", borderRadius: 3, fontSize: 11,
          }}
          onClick={() => {
            const w = window as unknown as { __narrativeLayoutError__?: LayoutErrPayload };
            w.__narrativeLayoutError__ = undefined;
            setErr(null);
          }}
        >
          关闭
        </button>
      </div>
      <div style={{ color: "rgba(255,180,180,0.95)", fontWeight: 600, marginBottom: 4 }}>{err.message}</div>
      {err.stack && (
        <details open>
          <summary style={{ color: "rgba(180,220,255,0.7)", cursor: "pointer", fontSize: 11 }}>JS Stack</summary>
          <pre style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", whiteSpace: "pre-wrap",
            background: "rgba(0,0,0,0.4)", padding: 6, borderRadius: 4, margin: "4px 0", maxHeight: 180, overflow: "auto" }}>
            {err.stack}
          </pre>
        </details>
      )}
      <details>
        <summary style={{ color: "rgba(180,220,255,0.7)", cursor: "pointer", fontSize: 11 }}>Steps & Result keys</summary>
        <pre style={{ fontSize: 10, color: "rgba(255,255,255,0.6)", whiteSpace: "pre-wrap",
          background: "rgba(0,0,0,0.4)", padding: 6, borderRadius: 4, margin: "4px 0", maxHeight: 180, overflow: "auto" }}>
          {JSON.stringify({ steps: err.steps, resultKeys: err.resultKeys }, null, 2)}
        </pre>
      </details>
    </div>
  );
}
