/**
 * Structure Expansion Factory (L1/L2 fractal pattern)
 *
 * Captures the shared algorithm between `outline-batch.ts` (L1) and
 * `detailed-outline-batch.ts` (L2). Both steps follow the same 5-phase
 * pipeline:
 *
 *   Phase 1 — Structure Planning:
 *     LLM call to determine child-node count, branch positions, and merge
 *     decisions for each parent node. The raw plan is then normalized via
 *     layer-threshold-config (entropy/complexity clamping, branch-ratio
 *     enforcement).
 *
 *   Phase 2 — Skeleton Construction:
 *     Deterministic code builds a `SkeletonNode[]` graph from the clamped
 *     plan. Branch nodes get letter suffixes (a/b/c…), merge points are
 *     inserted when `should_merge` is true, and intra-group prev/next
 *     edges are wired.
 *
 *   Phase 3 — Graph Repair (6-step chain, ported from v3 fix_all_connections):
 *     1. inferCrossParentConnections  — wire edges between last child of
 *        parent N and first child of parent N+1
 *     2. repairIntraGroupConnections  — ensure all siblings within one
 *        parent are connected
 *     3. filterCrossBranchConnections — remove spurious cross-branch edges
 *     4. fixDanglingBranches          — route branches that neither merge
 *        nor connect to any next-parent group
 *     5. fixNvNRouting                — repair N-to-N fan-out routing
 *     6. ensureBidirectionalConsistency — if A→B in next_node, ensure B←A
 *        in prev_node and vice-versa
 *
 *   Phase 4 — Batch LLM Fill:
 *     Group skeleton nodes by parent, build per-group prompts with context
 *     (adjacent groups, character digests, worldview, etc.), call LLM to
 *     fill narrative content. Each call is independent per parent group.
 *
 *   Phase 5 — Gap Fill + Merge:
 *     Identify nodes where content is missing or below `minContentLength`,
 *     issue a single supplementary LLM call for all sparse nodes, then
 *     merge skeleton (graph structure) with fill results (narrative content)
 *     — skeleton edges always win over LLM-returned edges.
 *
 * The factory does NOT move code from the existing files. It defines the
 * shared interface and a skeleton implementation that documents each step.
 * The actual refactoring of outline-batch.ts / detailed-outline-batch.ts
 * to consume this factory will happen in a separate task.
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
import { getNodeFilter } from "../node-merge.js";
import {
  repairIntraGroupConnections,
  inferCrossParentConnections,
  filterCrossBranchConnections,
  ensureBidirectionalConsistency,
  fixDanglingBranches,
  fixNvNRouting,
} from "../../utils/connection-repair.js";
import {
  getEntropy,
  getLayerEntropy,
  buildBranchPromptSection,
  buildDeviationPrompt,
  buildNodeCountPromptSection,
  enforceBranchInPlan,
  clampChildCount,
  getNodeBudget,
  getTargetBranchRatio,
  getMergeTendency,
  type StructurePlanItem,
} from "../layer-threshold-config.js";
import { deviationFromLegacy } from "../../types/index.js";

// ─── Shared internal types ───

/** Raw structure plan returned by the LLM in Phase 1. */
interface RawStructurePlan {
  parent_id: string;
  child_count: number;
  branch_count: number;
  branch_position?: number;
  branch_reason?: string;
  should_merge?: boolean;
  narrative_stage?: string;
  /** @deprecated backward compat — mapped to branch_count when branch_count missing */
  has_branch?: boolean;
}

/** Internal skeleton node after Phase 2 (deterministic graph construction). */
export interface SkeletonNode {
  node_id: string;
  parent_id: string;
  sequence_index: number;
  is_branch: boolean;
  is_merge_point: boolean;
  merges_from?: string[];
  prev_node: string[];
  next_node: string[];
}

/** Partial fill result from a single parent-group LLM call (Phase 4). */
interface PartialFill {
  node_id: string;
  [key: string]: unknown;
}

// ─── Configuration interface ───

/**
 * Configuration for the structure expansion factory.
 *
 * Each field maps to a specific decision point in the 5-phase algorithm.
 * Callers (L1 outline-batch, L2 detailed-outline-batch) supply layer-specific
 * prompts, parent-node accessors, content thresholds, and output writers.
 */
export interface StructureExpansionConfig {
  /** Unique step identifier (e.g. "outline_batch", "detailed_outline"). */
  stepId: string;

  /** Human-readable layer label for logging (e.g. "L1", "L2"). */
  layerLabel: string;

  /** Numeric layer index used by layer-threshold-config (1 for L1, 2 for L2). */
  layerIndex: number;

  /**
   * Extract parent nodes from the narrative context.
   * L1 returns FrameworkNode[], L2 returns OutlineNode[].
   */
  getParentNodes: (ctx: NarrativeContext) => ParentNodeLike[];

  /**
   * Minimum content length (characters) for gap-fill detection.
   * Nodes below this threshold trigger supplementary LLM calls.
   * Typical values: 200 for L1 outlines, 300 for L2 detailed outlines.
   */
  minContentLength: number;

  /**
   * The field name on the raw LLM plan that holds the per-parent child count.
   * L1 uses "outline_count", L2 uses "detail_count".
   */
  childCountField: string;

  /**
   * Budget field name for the minimum child count from getNodeBudget().
   * L1 uses "l1_per_min", L2 uses "l2_per_min".
   */
  budgetMinField: "l1_per_min" | "l2_per_min";

  /**
   * Layer control accessor key (e.g. "layer_1" or "layer_2") for
   * global_control_params.layer_controls.
   */
  layerControlKey: "layer_1" | "layer_2";

  /**
   * Target structure max-per-parent field from global_control_params.
   * L1 uses "l1_per_parent", L2 uses "l2_per_parent".
   */
  targetStructureField: "l1_per_parent" | "l2_per_parent";

  // ─── Prompt composers ───

  /** Composer for the Phase 1 structure planning system prompt. */
  planComposer: PromptComposer;

  /** Composer for the Phase 4 batch fill system prompt. */
  fillComposer: PromptComposer;

  /** Composer for the Phase 5 gap fill system prompt. */
  gapComposer: PromptComposer;

  // ─── Prompt builders ───

  /** Build the user prompt for Phase 1 (structure planning). */
  buildPlanUserPrompt: (ctx: NarrativeContext) => string;

  /**
   * Build the user prompt for a single parent-group fill call (Phase 4).
   * Receives the parent node, its skeleton children, and the full context.
   */
  buildFillUserPrompt: (
    ctx: NarrativeContext,
    parentNode: ParentNodeLike,
    skeletonGroup: SkeletonNode[],
  ) => string;

  /**
   * Build the user prompt for Phase 5 gap fill.
   * Receives nodes that still need content.
   */
  buildGapUserPrompt: (
    ctx: NarrativeContext,
    skeleton: SkeletonNode[],
    fillMap: Map<string, PartialFill>,
  ) => string;

  // ─── Result handling ───

  /** JSON array field name in the LLM fill response (e.g. "outlines", "detailed_outlines"). */
  fillResponseArrayField: string;

  /**
   * Merge a single skeleton node + its LLM fill into the final output node.
   * Returns the layer-specific typed node (OutlineNode or DetailedOutlineNode).
   */
  mergeSkeletonAndFill: (skeleton: SkeletonNode, fill: PartialFill | undefined) => unknown;

  /** Write the final merged nodes into the NarrativeContext. */
  writeOutput: (ctx: NarrativeContext, nodes: unknown[]) => void;

  /**
   * Optional post-write validation (e.g. structureValidationL1/L2).
   * Called after output is written to ctx.
   */
  validate?: (ctx: NarrativeContext, llm: LLMClient) => Promise<void>;
}

/**
 * Minimal interface for parent nodes (works for both FrameworkNode and OutlineNode).
 * The factory only needs `node_id` and graph edges to do cross-parent wiring.
 */
export interface ParentNodeLike {
  node_id: string;
  next_node?: string[] | string;
  narrative_stage?: string;
  [key: string]: unknown;
}

// ─── Phase 2: Skeleton construction (deterministic) ───

function normalizePlan(
  p: Record<string, unknown>,
  childCountField: string,
): RawStructurePlan {
  const childCount = (p[childCountField] as number) ?? 1;
  let branchCount = p.branch_count as number | undefined;
  if (branchCount === undefined || branchCount === null) {
    branchCount = (p as Record<string, unknown>).has_branch ? 2 : 1;
  }
  return {
    parent_id: String(p.parent_id),
    child_count: childCount,
    branch_count: branchCount,
    branch_position: p.branch_position as number | undefined,
    should_merge: p.should_merge as boolean | undefined,
    narrative_stage: p.narrative_stage as string | undefined,
  };
}

/**
 * Build a skeleton graph from the structure plan.
 *
 * For each parent node's plan:
 * - Sequential nodes get IDs like `{parent}_{seq}`
 * - Branch nodes at `branch_position` get letter suffixes: `{parent}_{seq}a`, `{parent}_{seq}b`
 * - If `should_merge` is true, a merge node is inserted after the branch group
 * - Intra-parent prev/next edges are wired (cross-parent edges are handled in Phase 3)
 */
function buildSkeleton(plans: RawStructurePlan[]): SkeletonNode[] {
  const nodes: SkeletonNode[] = [];
  const letters = "abcdefgh";

  for (const plan of plans) {
    const parentId = plan.parent_id;
    const count = Math.max(1, plan.child_count);
    const numBranches = Math.max(1, plan.branch_count);
    const hasBranch = numBranches >= 2 && count >= 2;
    const branchPos = hasBranch
      ? Math.min(plan.branch_position ?? 2, count)
      : -1;
    const shouldMerge = plan.should_merge ?? true;

    let seqIdx = 0;
    for (let i = 1; i <= count; i++) {
      if (hasBranch && i === branchPos) {
        const branchNodes: SkeletonNode[] = [];
        for (let b = 0; b < numBranches; b++) {
          branchNodes.push({
            node_id: `${parentId}_${i}${letters[b]}`,
            parent_id: parentId,
            sequence_index: seqIdx,
            is_branch: true,
            is_merge_point: false,
            prev_node: [],
            next_node: [],
          });
        }

        if (nodes.length > 0) {
          const prev = nodes[nodes.length - 1];
          if (prev.parent_id === parentId) {
            for (const bn of branchNodes) {
              prev.next_node.push(bn.node_id);
              bn.prev_node.push(prev.node_id);
            }
          }
        }

        nodes.push(...branchNodes);
        seqIdx++;

        if (shouldMerge && i < count) {
          const mergeNode: SkeletonNode = {
            node_id: `${parentId}_${i + 1}`,
            parent_id: parentId,
            sequence_index: seqIdx,
            is_branch: false,
            is_merge_point: true,
            merges_from: branchNodes.map((bn) => bn.node_id),
            prev_node: branchNodes.map((bn) => bn.node_id),
            next_node: [],
          };
          for (const bn of branchNodes) bn.next_node.push(mergeNode.node_id);
          nodes.push(mergeNode);
          seqIdx++;
          i++;
        } else if (!shouldMerge) {
          break;
        }
      } else {
        const node: SkeletonNode = {
          node_id: `${parentId}_${i}`,
          parent_id: parentId,
          sequence_index: seqIdx,
          is_branch: false,
          is_merge_point: false,
          prev_node: [],
          next_node: [],
        };

        if (nodes.length > 0) {
          const prev = nodes[nodes.length - 1];
          if (prev.parent_id === parentId && !prev.is_branch) {
            prev.next_node.push(node.node_id);
            node.prev_node.push(prev.node_id);
          }
        }

        nodes.push(node);
        seqIdx++;
      }
    }
  }

  return nodes;
}

// ─── Phase 3: Graph repair (6-step chain) ───

/**
 * Apply the 6-step connection repair chain (ported from v3 fix_all_connections).
 *
 * The parent nodes provide next_node edges so the repair functions can infer
 * how children of different parents should connect to each other.
 */
function repairGraphConnections(
  skeleton: SkeletonNode[],
  parentNodes: Array<{ node_id: string; next_node: string[] }>,
  layerLabel: string,
): SkeletonNode[] {
  let nodes = inferCrossParentConnections(skeleton, parentNodes);
  nodes = repairIntraGroupConnections(nodes);
  nodes = filterCrossBranchConnections(nodes);

  const { nodes: danglingFixed, logs: danglingLogs } = fixDanglingBranches(
    nodes,
    parentNodes,
  );
  nodes = danglingFixed;
  if (danglingLogs.length > 0) {
    console.log(
      `[${layerLabel}] 悬挂分支修复: ${danglingLogs.length} 项`,
    );
  }

  nodes = fixNvNRouting(nodes);
  nodes = ensureBidirectionalConsistency(nodes);
  return nodes;
}

// ─── Factory function ───

/**
 * Create a `PipelineStep` that executes the 5-phase structure expansion algorithm.
 *
 * The returned step is a drop-in replacement for the monolithic functions in
 * `outline-batch.ts` and `detailed-outline-batch.ts`. Callers provide
 * layer-specific configuration; the factory handles the shared orchestration.
 *
 * @example
 * ```ts
 * // In outline-batch.ts (future refactoring):
 * export const outlineBatch = createStructureExpansionStep({
 *   stepId: "outline_batch",
 *   layerLabel: "L1",
 *   layerIndex: 1,
 *   getParentNodes: (ctx) => ctx.story_framework?.framework.nodes ?? [],
 *   minContentLength: 200,
 *   childCountField: "outline_count",
 *   budgetMinField: "l1_per_min",
 *   // ...remaining config
 * });
 * ```
 */
export function createStructureExpansionStep(
  config: StructureExpansionConfig,
): PipelineStep {
  return async (ctx: NarrativeContext, llm: LLMClient): Promise<void> => {
    // ─── Pre-flight: resolve parent nodes + optional node filter ───

    const allParentNodes = config.getParentNodes(ctx);
    if (allParentNodes.length === 0) return;

    const nodeFilter = getNodeFilter(ctx);
    let parentNodes = allParentNodes;
    if (nodeFilter) {
      const affectedParents = resolveAffectedParents(
        nodeFilter,
        allParentNodes,
        config.layerIndex,
      );
      parentNodes = allParentNodes.filter((n) =>
        affectedParents.has(n.node_id),
      );
      if (parentNodes.length === 0) return;
    }

    // ─── Phase 1: Structure planning (LLM call) ───

    const step1Raw = await llm.callWithRetry(
      composeSystemPrompt(config.planComposer, ctx),
      appendUserInstructions(config.buildPlanUserPrompt(ctx), ctx),
      { responseFormat: "json" },
      (r) => {
        const p = extractJSON<unknown>(r);
        if (!Array.isArray(p) || p.length === 0)
          throw new Error("必须是非空JSON数组");
      },
    );

    const rawPlans = extractJSON<Array<Record<string, unknown>>>(step1Raw);

    // Fill in missing parents with minimum-budget defaults
    const existingParents = new Set(rawPlans.map((p) => String(p.parent_id)));
    const budgetMin = ctx.global_control_params
      ? (getNodeBudget(ctx.global_control_params.complexity ?? 2) as unknown as Record<string, number>)[
          config.budgetMinField
        ]
      : config.layerIndex === 1 ? 2 : 1;

    for (const parent of parentNodes) {
      if (!existingParents.has(parent.node_id)) {
        rawPlans.push({
          parent_id: parent.node_id,
          [config.childCountField]: budgetMin,
          branch_count: 1,
          has_branch: false,
        });
      }
    }

    // Enforce branch/merge targets via layer-threshold-config
    const gcp = ctx.global_control_params;
    const complexity = gcp?.complexity ?? 2;
    const entropy = getEntropy(complexity);
    const layerCtrl = (gcp?.layer_controls as Record<string, unknown> | undefined)?.[
      config.layerControlKey
    ] as { min_nodes?: number; max_nodes?: number } | undefined;
    const layerEntropy = getLayerEntropy(
      entropy,
      config.layerIndex,
      layerCtrl as Parameters<typeof getLayerEntropy>[2],
    );
    const grossTarget = getTargetBranchRatio(
      complexity,
      layerEntropy,
      config.layerIndex,
    );
    const mergeTend = getMergeTendency(complexity, config.layerIndex);

    const stageMap = new Map(
      parentNodes.map((n) => [n.node_id, n.narrative_stage]),
    );
    const enforceable: StructurePlanItem[] = rawPlans.map((p) => ({
      parent_id: String(p.parent_id),
      child_count:
        (p[config.childCountField] as number) ??
        (p.has_branch ? 2 : 1),
      branch_count:
        (p.branch_count as number) ?? (p.has_branch ? 2 : 1),
      should_merge: p.should_merge as boolean | undefined,
      narrative_stage:
        (p.narrative_stage as string) ?? stageMap.get(String(p.parent_id)),
    }));
    const enforced = enforceBranchInPlan(
      enforceable,
      grossTarget,
      mergeTend,
      config.layerIndex,
    );

    const layerMax =
      (gcp?.target_structure as Record<string, number> | undefined)?.[
        config.targetStructureField
      ] ?? layerCtrl?.max_nodes;
    const clamped = clampChildCount(
      enforced,
      config.layerIndex,
      layerEntropy,
      layerCtrl?.min_nodes,
      layerMax,
      complexity,
    );

    const normalizedPlans: RawStructurePlan[] = rawPlans.map((p, i) => {
      const base = normalizePlan(p, config.childCountField);
      return {
        ...base,
        child_count: clamped[i].child_count,
        branch_count: clamped[i].branch_count,
        should_merge: clamped[i].should_merge,
      };
    });

    // ─── Phase 2: Build skeleton ───

    let skeleton = buildSkeleton(normalizedPlans);

    // ─── Phase 3: Graph repair (6-step chain) ───

    const parentEdges = parentNodes.map((n) => ({
      node_id: n.node_id,
      next_node: normalizeNextNode(n.next_node),
    }));
    skeleton = repairGraphConnections(
      skeleton,
      parentEdges,
      config.layerLabel,
    );

    // ─── Phase 4: Batch LLM fill by parent groups ───

    const fillMap = await batchFillByParent(
      ctx,
      llm,
      skeleton,
      parentNodes,
      config,
    );

    // ─── Phase 5: Gap fill for content-sparse nodes ───

    const gapPrompt = config.buildGapUserPrompt(ctx, skeleton, fillMap);
    if (gapPrompt) {
      try {
        const gapRaw = await llm.callWithRetry(
          composeSystemPrompt(config.gapComposer, ctx),
          gapPrompt,
          { responseFormat: "json" },
          (r) => {
            const p = extractJSON<Record<string, unknown>>(r);
            if (!Array.isArray(p[config.fillResponseArrayField]))
              throw new Error(
                `需要${config.fillResponseArrayField}数组`,
              );
          },
        );

        const supplement = extractJSON<Record<string, unknown[]>>(gapRaw);
        const supplementArray =
          (supplement[config.fillResponseArrayField] as PartialFill[]) ?? [];
        for (const fill of supplementArray) {
          const existing = fillMap.get(fill.node_id);
          if (
            !existing ||
            (String(existing.content ?? "").length) < 50
          ) {
            fillMap.set(fill.node_id, fill);
          }
        }
      } catch (e) {
        console.warn(
          `[${config.layerLabel} GapFill] 全局补漏失败: ${(e as Error).message}`,
        );
      }
    }

    // ─── Merge skeleton + fill content → final output ───

    const outputNodes = skeleton.map((skel) =>
      config.mergeSkeletonAndFill(skel, fillMap.get(skel.node_id)),
    );

    config.writeOutput(ctx, outputNodes);

    // ─── Optional post-write validation ───

    if (config.validate) {
      await config.validate(ctx, llm);
    }
  };
}

// ─── Internal helpers ───

/**
 * Phase 4 implementation: group skeleton by parent, issue per-group LLM calls.
 */
async function batchFillByParent(
  ctx: NarrativeContext,
  llm: LLMClient,
  skeleton: SkeletonNode[],
  parentNodes: ParentNodeLike[],
  config: StructureExpansionConfig,
): Promise<Map<string, PartialFill>> {
  const groups = new Map<string, SkeletonNode[]>();
  for (const node of skeleton) {
    const group = groups.get(node.parent_id) ?? [];
    group.push(node);
    groups.set(node.parent_id, group);
  }

  const parentMap = new Map(parentNodes.map((n) => [n.node_id, n]));
  const fillMap = new Map<string, PartialFill>();

  for (const [parentId, group] of groups) {
    const parent = parentMap.get(parentId);
    if (!parent) continue;

    const prompt = config.buildFillUserPrompt(ctx, parent, group);

    try {
      const raw = await llm.callWithRetry(
        composeSystemPrompt(config.fillComposer, ctx),
        prompt,
        { responseFormat: "json" },
        (r) => {
          const p = extractJSON<Record<string, unknown>>(r);
          if (!Array.isArray(p[config.fillResponseArrayField]))
            throw new Error(
              `需要${config.fillResponseArrayField}数组`,
            );
        },
      );

      const parsed = extractJSON<Record<string, unknown[]>>(raw);
      const fills =
        (parsed[config.fillResponseArrayField] as PartialFill[]) ?? [];
      for (const fill of fills) {
        if (fill.node_id) fillMap.set(fill.node_id, fill);
      }
    } catch (e) {
      console.warn(
        `[${config.layerLabel} BatchFill] 分组 ${parentId} 填充失败: ${(e as Error).message}`,
      );
    }
  }

  return fillMap;
}

/**
 * Determine which parent nodes are affected by a node-filter.
 *
 * L1 uses first-underscore split (filter "1_2" → parent "1"),
 * L2 uses last-underscore split (filter "1_1_2" → parent "1_1").
 */
function resolveAffectedParents(
  nodeFilter: Set<string>,
  allParents: ParentNodeLike[],
  layerIndex: number,
): Set<string> {
  const affectedParents = new Set<string>();
  for (const nid of nodeFilter) {
    if (layerIndex === 1) {
      const firstUnderscore = nid.indexOf("_");
      affectedParents.add(
        firstUnderscore > 0 ? nid.substring(0, firstUnderscore) : nid,
      );
    } else {
      const lastUnderscore = nid.lastIndexOf("_");
      affectedParents.add(
        lastUnderscore > 0 ? nid.substring(0, lastUnderscore) : nid,
      );
    }
  }

  // L2 fallback: if no exact parent match, try prefix match
  if (layerIndex >= 2 && affectedParents.size > 0) {
    const parentIds = new Set(allParents.map((n) => n.node_id));
    const directMatch = [...affectedParents].some((p) => parentIds.has(p));
    if (!directMatch) {
      const fallback = new Set<string>();
      for (const parent of allParents) {
        for (const nid of nodeFilter) {
          if (nid.startsWith(parent.node_id + "_")) {
            fallback.add(parent.node_id);
          }
        }
      }
      if (fallback.size > 0) return fallback;
    }
  }

  return affectedParents;
}

/** Normalize next_node which may be string[] or string (from different node types). */
function normalizeNextNode(next: string[] | string | undefined): string[] {
  if (!next) return [];
  if (Array.isArray(next)) return next;
  return [next];
}
