/**
 * Content Expansion Factory (L3/L4 fractal pattern)
 *
 * Captures the shared algorithm between `plot-generation.ts` (L3) and
 * `script-generation.ts` (L4). Both steps follow the same 5-phase
 * pipeline:
 *
 *   Phase 1 — Topological Sort (Kahn's algorithm):
 *     Partition source nodes into layers via `topologicalLayers()`.
 *     Nodes in the same layer have no inter-dependencies and can be
 *     processed concurrently. Cross-layer ordering ensures that every
 *     node's predecessors are fully generated before it begins.
 *
 *   Phase 2 — Per-Layer Parallel Expansion:
 *     For each layer, fire `Promise.all()` over its nodes. Each node
 *     gets an independent LLM call with context that includes:
 *     - The source node data (L2 detailed outline for L3, L3 plot for L4)
 *     - Predecessor/successor boundary context (prev result → next cause)
 *     - Sliding window summary from already-generated predecessors
 *
 *   Phase 3 — Sliding Window Context:
 *     After each layer completes, build a sliding-window summary of each
 *     generated node's content (via `buildSlidingWindowSummary()`). The
 *     next layer's nodes receive concatenated summaries of their prev_node
 *     predecessors, ensuring narrative continuity without exceeding context
 *     window limits.
 *
 *   Phase 4 — Constraint Validation + Retry:
 *     Each generated node is validated against triple constraints:
 *     - Boundary: content starts at cause, ends at result
 *     - Scope: content stays within parent-node scope
 *     - Boundary validation: no overlap with prev/next nodes
 *     Failed nodes trigger up to MAX_CONSTRAINT_RETRIES re-generations
 *     with constraint feedback injected into the prompt.
 *
 *   Phase 5 — Collect + Write Output:
 *     All generated nodes are collected in topological order, optional
 *     _saveNode callbacks fire per node (for SSE streaming), and the
 *     final results are written to ctx.
 *
 * The factory does NOT move code from the existing files. It defines the
 * shared interface and a skeleton implementation. The actual refactoring of
 * plot-generation.ts / script-generation.ts to consume this factory will
 * happen in a separate task.
 *
 * @module
 */

import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import type { PipelineStep } from "../pipeline.js";
import type { PromptComposer } from "../prompt-composer.js";
import { extractJSON } from "../llm-client.js";
import { composeSystemPrompt } from "../prompt-composer.js";
import { appendUserInstructions } from "../steps/design-context-helper.js";
import { validateTripleConstraints } from "../../utils/constraint-validator.js";
import { getNodeFilter } from "../node-merge.js";
import {
  buildSlidingWindowSummary,
  topologicalLayers,
} from "../steps/context-helpers.js";

// ─── Shared internal types ───

/** Minimal interface for source nodes consumed by the content expansion. */
export interface ContentNodeLike {
  node_id: string;
  parent_id: string;
  prev_node: string[] | string;
  next_node: string[] | string;
  content: string;
  story_elements: {
    plot: { cause: string; process: string; result: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Result of constraint validation for a single node. */
export interface ConstraintResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Configuration interface ───

/**
 * Configuration for the content expansion factory.
 *
 * Each field maps to a specific decision point in the 5-phase algorithm.
 * Callers (L3 plot-generation, L4 script-generation) supply layer-specific
 * prompts, node accessors, result parsers, and output writers.
 */
export interface ContentExpansionConfig {
  /** Unique step identifier (e.g. "plot_generation", "script_generation"). */
  stepId: string;

  /** Human-readable layer label for logging (e.g. "L3", "L4"). */
  layerLabel: string;

  /** Composer for the LLM system prompt. */
  composer: PromptComposer;

  /**
   * Extract the source nodes from the narrative context.
   * L3 returns DetailedOutlineNode[], L4 returns PlotNode[].
   */
  getSourceNodes: (ctx: NarrativeContext) => ContentNodeLike[];

  /**
   * Resolve the graph edges for a given node.
   * Returns arrays of prev/next node IDs.
   */
  getGraphEdges: (node: ContentNodeLike) => {
    prev_node: string[];
    next_node: string[];
  };

  /**
   * Build the full node map used for looking up neighbor nodes.
   * L3 builds from DetailedOutlineNode[], L4 from PlotNode[].
   * Returns a map of node_id → source node for neighbor lookups.
   */
  buildNodeMap: (ctx: NarrativeContext) => Map<string, ContentNodeLike>;

  /**
   * Build the user prompt for a single node expansion.
   *
   * @param ctx - Full narrative context
   * @param node - The source node to expand
   * @param nodeMap - Map of all source nodes (for neighbor lookups)
   * @param slidingWindowSummary - Concatenated summaries from predecessors
   * @param constraintFeedback - If retrying, the feedback from the failed validation
   * @param index - 0-based index of this node in the global sequence
   * @param total - Total number of nodes being processed
   */
  buildNodePrompt: (
    ctx: NarrativeContext,
    node: ContentNodeLike,
    nodeMap: Map<string, ContentNodeLike>,
    slidingWindowSummary: string | undefined,
    constraintFeedback: string | undefined,
    index: number,
    total: number,
  ) => string;

  /**
   * Parse and normalize the raw LLM response into the output node type.
   *
   * L3 returns PlotNode (with jrpg_elements, boundary_constraints).
   * L4 returns ScriptChapter (with scenes, conflict, character_arcs).
   */
  parseNodeResult: (
    raw: Record<string, unknown>,
    node: ContentNodeLike,
    index: number,
  ) => ContentResultLike;

  /**
   * LLM response validation function passed to `callWithRetry`.
   * Called on the raw string before JSON parsing to catch structural issues.
   */
  validateLLMResponse: (raw: string) => void;

  /**
   * Extract the text content from a generated result for constraint validation
   * and sliding window summary.
   *
   * L3: returns result.content directly.
   * L4: concatenates all scene content texts.
   */
  extractContentText: (result: ContentResultLike) => string;

  /**
   * Extract boundary constraints for triple-constraint validation.
   * Returns { cause, result } from the source node's story_elements.
   */
  extractBoundaryConstraints: (node: ContentNodeLike) => {
    cause: string;
    result: string;
  };

  /**
   * Extract scope content for triple-constraint validation.
   * Typically the source node's `content` field.
   */
  extractScopeContent: (node: ContentNodeLike) => string;

  /**
   * Maximum number of constraint-validation retries per node.
   * Defaults to 2 if not specified.
   */
  maxConstraintRetries?: number;

  /**
   * Maximum character length for the sliding window summary.
   * Defaults to 200 if not specified.
   */
  slidingWindowMaxLen?: number;

  /** Write the final collected results into the NarrativeContext. */
  writeOutput: (ctx: NarrativeContext, results: ContentResultLike[]) => void;

  /**
   * Optional post-write validation (e.g. structureValidationL3).
   * Called after output is written to ctx.
   */
  validate?: (ctx: NarrativeContext, llm: LLMClient) => Promise<void>;
}

/** Minimal interface for generated result nodes (PlotNode or ScriptChapter). */
export interface ContentResultLike {
  node_id: string;
  [key: string]: unknown;
}

// ─── Factory function ───

const DEFAULT_MAX_CONSTRAINT_RETRIES = 2;

/**
 * Create a `PipelineStep` that executes the 5-phase content expansion algorithm.
 *
 * The returned step is a drop-in replacement for the monolithic functions in
 * `plot-generation.ts` and `script-generation.ts`. Callers provide
 * layer-specific configuration; the factory handles the shared orchestration.
 *
 * @example
 * ```ts
 * // In plot-generation.ts (future refactoring):
 * export const plotGeneration = createContentExpansionStep({
 *   stepId: "plot_generation",
 *   layerLabel: "L3",
 *   getSourceNodes: (ctx) => ctx.detailed_outlines_generated?.detailed_outlines ?? [],
 *   buildNodePrompt: (ctx, node, nodeMap, sliding, feedback) => buildPromptForNode(...),
 *   parseNodeResult: (raw, node) => normalizePlot(raw, node),
 *   // ...remaining config
 * });
 * ```
 */
export function createContentExpansionStep(
  config: ContentExpansionConfig,
): PipelineStep {
  const maxRetries =
    config.maxConstraintRetries ?? DEFAULT_MAX_CONSTRAINT_RETRIES;

  return async (ctx: NarrativeContext, llm: LLMClient): Promise<void> => {
    // ─── Pre-flight: resolve source nodes + optional node filter ───

    const allSourceNodes = config.getSourceNodes(ctx);
    if (allSourceNodes.length === 0) return;

    const nodeFilter = getNodeFilter(ctx);
    const targetNodes = nodeFilter
      ? allSourceNodes.filter((n) => nodeFilter.has(n.node_id))
      : allSourceNodes;

    if (targetNodes.length === 0) return;

    // Pre-flight integrity check: warn about orphaned or dead-end nodes
    checkConnectionIntegrity(targetNodes, config.layerLabel);

    const nodeMap = config.buildNodeMap(ctx);
    const _save = (ctx as Record<string, unknown>)._saveNode as
      | ((stepId: string, nodeId: string, data: unknown) => void)
      | undefined;

    // ─── Phase 1: Topological sort into layers ───

    const normalizedNodes = targetNodes.map((n) => ({
      node_id: n.node_id,
      prev_node: Array.isArray(n.prev_node) ? n.prev_node : n.prev_node ? [n.prev_node] : [],
      next_node: Array.isArray(n.next_node) ? n.next_node : n.next_node ? [n.next_node] : [],
    }));
    const nodeById = new Map(targetNodes.map((n) => [n.node_id, n]));
    const idLayers = topologicalLayers(normalizedNodes);
    const layers = idLayers.map((layer) =>
      layer.map((slim) => nodeById.get(slim.node_id)!),
    );
    const summaryMap = new Map<string, string>();
    const results: ContentResultLike[] = [];
    let globalIdx = 0;

    console.log(
      `[${config.layerLabel}] 拓扑分层: ${layers.length} 层, 节点分布: ${layers.map((l) => l.length).join(",")}`,
    );

    // ─── Phase 2+3+4: Per-layer parallel expansion with sliding window ───

    for (const layer of layers) {
      const layerResults = await Promise.all(
        layer.map(async (node) => {
          // Phase 3: Build sliding window from predecessor summaries
          const edges = config.getGraphEdges(node);
          const prevSummaries = edges.prev_node
            .map((id) => summaryMap.get(id))
            .filter(Boolean)
            .join("\n---\n");

          const idx = globalIdx++;

          // Phase 2+4: Expand with constraint retry loop
          return processNodeWithConstraints(
            ctx,
            llm,
            node,
            nodeMap,
            prevSummaries || undefined,
            idx,
            targetNodes.length,
            config,
            maxRetries,
          );
        }),
      );

      // Phase 3: Update sliding window after layer completes
      for (const result of layerResults) {
        results.push(result);
        const contentText = config.extractContentText(result);
        summaryMap.set(
          result.node_id,
          buildSlidingWindowSummary(contentText),
        );
        _save?.(config.stepId, result.node_id, result);
      }
    }

    // ─── Phase 5: Write output ───

    config.writeOutput(ctx, results);

    if (config.validate) {
      await config.validate(ctx, llm);
    }
  };
}

// ─── Internal helpers ───

/**
 * Process a single node through the constraint-validation retry loop.
 *
 * On each attempt:
 * 1. Build the node prompt (with optional constraint feedback from prior failure)
 * 2. Call LLM
 * 3. Parse + normalize the result
 * 4. Validate triple constraints
 * 5. If validation fails and retries remain, inject feedback and retry
 */
async function processNodeWithConstraints(
  ctx: NarrativeContext,
  llm: LLMClient,
  node: ContentNodeLike,
  nodeMap: Map<string, ContentNodeLike>,
  slidingWindowSummary: string | undefined,
  index: number,
  total: number,
  config: ContentExpansionConfig,
  maxRetries: number,
): Promise<ContentResultLike> {
  const edges = config.getGraphEdges(node);
  const prevNodes = edges.prev_node
    .map((id) => nodeMap.get(id))
    .filter((n): n is ContentNodeLike => !!n);
  const nextNodes = edges.next_node
    .map((id) => nodeMap.get(id))
    .filter((n): n is ContentNodeLike => !!n);

  const prevResults = prevNodes
    .map((p) => p.story_elements.plot.result)
    .filter(Boolean);
  const nextCauses = nextNodes
    .map((n) => n.story_elements.plot.cause)
    .filter(Boolean);

  const boundary = config.extractBoundaryConstraints(node);
  const scopeContent = config.extractScopeContent(node);

  let constraintFeedback: string | undefined;
  let result: ContentResultLike | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const prompt = config.buildNodePrompt(
      ctx,
      node,
      nodeMap,
      slidingWindowSummary,
      constraintFeedback,
      index,
      total,
    );

    const raw = await llm.callWithRetry(
      composeSystemPrompt(config.composer, ctx),
      appendUserInstructions(prompt, ctx),
      { responseFormat: "json" },
      config.validateLLMResponse,
    );

    const parsed = extractJSON<Record<string, unknown>>(raw);
    result = config.parseNodeResult(parsed, node, index);

    // Triple constraint validation
    const contentText = config.extractContentText(result);
    const tcResult = validateTripleConstraints({
      content: contentText,
      boundary_constraints: boundary,
      scope_content: scopeContent,
      prev_result: prevResults.join("；"),
      next_cause: nextCauses.join("；"),
    });

    const issues = [...tcResult.errors, ...tcResult.warnings];
    if (issues.length === 0) break;

    if (attempt < maxRetries) {
      constraintFeedback = issues
        .map((msg, i) => `${i + 1}. ${msg}`)
        .join("\n");
      console.warn(
        `[${config.layerLabel}] ${node.node_id} 三重约束未通过(第${attempt + 1}次)，触发修正重试:`,
        issues,
      );
    } else {
      console.warn(
        `[${config.layerLabel}] ${node.node_id} 三重约束重试${maxRetries}次后仍有问题:`,
        issues,
      );
    }
  }

  return result!;
}

/**
 * Pre-flight connection integrity check.
 *
 * Warns about:
 * - Orphaned nodes: nodes with no prev_node that aren't the legitimate DAG root
 * - Dead-end nodes: non-root nodes with no next_node (informational only)
 */
function checkConnectionIntegrity(
  nodes: ContentNodeLike[],
  layerLabel: string,
): void {
  const firstEntryId = nodes.find(
    (n) => normalizeEdges(n.prev_node).length === 0,
  )?.node_id;

  const orphans = nodes.filter(
    (n) =>
      normalizeEdges(n.prev_node).length === 0 &&
      n.node_id !== firstEntryId,
  );
  const deadEnds = nodes.filter(
    (n) =>
      normalizeEdges(n.next_node).length === 0 &&
      normalizeEdges(n.prev_node).length > 0,
  );

  if (orphans.length > 0) {
    console.warn(
      `[${layerLabel}] 连接完整性警告: ${orphans.length} 个非入口节点缺少 prev_node:`,
      orphans.map((n) => n.node_id),
    );
  }
  if (deadEnds.length > 0 && deadEnds.length < nodes.length) {
    console.log(
      `[${layerLabel}] 信息: ${deadEnds.length} 个节点为叶子节点（无后继）`,
    );
  }
}

/** Normalize prev_node/next_node which may be string[] or string. */
function normalizeEdges(edges: string[] | string | undefined): string[] {
  if (!edges) return [];
  if (Array.isArray(edges)) return edges;
  return [edges];
}
