/**
 * L2 细纲生成（DetailedOutlineBatchAgent）
 *
 * 三步走机制（继承自 v3）：
 *   Step1: LLM 规划结构 + 代码构建骨架 + 跨父连接
 *   Step1.5: 按 L1 父节点分组，每组独立 LLM 调用填充内容
 *   Step2: 全局内容补充（补充 Step1.5 遗漏或不足的节点）
 *
 * 设计哲学：
 * - 命运必然论：L0 预设所有命运分支和结局，L2 在大纲框架内细化，不创造新结局
 * - 有限突变论：L2 可产生新分支（Y轴），但必须聚合或路由到上层预设分支
 * - 双维度展开：X轴=顺序细化 / Y轴=可能性分支
 * - 与 L1 对称的通用细化机制
 * - 为 L3 提供三重约束信息（boundary/scope/validation）
 * - 反套路偏差指导（正偏差→意外/升华 / 负偏差→颠覆解构 / 中性→经典叙事）
 */
import type {
  NarrativeContext,
  DetailedOutlinesGenerated,
  DetailedOutlineNode,
} from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { extractJSON } from "../llm-client.js";
import { appendUserInstructions } from "./design-context-helper.js";
import { composeSystemPrompt, type PromptComposer } from "../prompt-composer.js";
import {
  buildCharacterDigest,
  buildItemDigest,
  buildStoryArcDigest,
  buildAdjacentGroupDigest,
} from "./context-helpers.js";
import { getNodeFilter } from "../node-merge.js";
import { structureValidationL2 } from "./structure-validation.js";
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

// ─── Step 1: 结构规划 ───

interface DetailPlan {
  parent_id: string;
  detail_count: number;
  branch_count: number;
  branch_position?: number;
  should_merge?: boolean;
  narrative_stage?: string;
  /** @deprecated backward compat */
  has_branch?: boolean;
}

const STEP1_SYSTEM = `你是叙事结构规划师。根据L1大纲节点，为每个大纲节点规划L2细纲子节点数量和分支。所有输出使用中文。`;

export const DETAIL_PLAN_COMPOSER: PromptComposer = {
  stepId: "detailed_outline",
  blocks: {
    base: STEP1_SYSTEM,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
  },
  systemBlockOrder: ["base", "style_guide", "constraints"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

export const DETAIL_FILL_COMPOSER: PromptComposer = {
  stepId: "detailed_outline",
  blocks: {
    base: "你是叙事结构设计师。",
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
  },
  systemBlockOrder: ["base", "style_guide", "constraints"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildStep1Prompt(ctx: NarrativeContext): string {
  const outlines = ctx.outlines_generated?.outlines ?? [];
  const olDesc = outlines.map(o =>
    `- [${o.node_id}] ${o.name}（${o.narrative_stage}）: ${o.content}`
  ).join("\n");

  const gcp = ctx.global_control_params;
  const complexity = gcp?.complexity ?? 2;
  const entropy = getEntropy(complexity);
  const l2Ctrl = gcp?.layer_controls?.layer_2;
  const layerEntropy = getLayerEntropy(entropy, 2, l2Ctrl);
  const deviation = deviationFromLegacy(gcp);

  const branchSection = buildBranchPromptSection(2, complexity, layerEntropy);
  const deviationSection = buildDeviationPrompt(deviation);
  const nodeCountSection = buildNodeCountPromptSection(2, layerEntropy, l2Ctrl?.min_nodes, l2Ctrl?.max_nodes, complexity);

  return `## 用户需求
${ctx.user_input}

## 核心设计原则
- **命运必然论**：L0框架层预设所有命运分支和结局，细纲层在大纲框架内继续细化，不创造新结局
- **有限突变论**：细纲层可产生独立新分支（Y轴可能性维度），但分支必须聚合或路由到上层预设分支
- **双维度嵌套展开**：X轴顺序维度将L1的1个节点拆解为N个连续L2子节点；Y轴可能性维度在L2内部独立产生新分支

## L1大纲节点
${olDesc}

${nodeCountSection}
每个L1父节点展开为上述范围内的L2子节点。

${branchSection}

${deviationSection}

## 细纲节点ID规则
- 格式: {L1父ID}_{序号}, 如 1_1_1, 2a_1_2
- 分支加字母: 1_1_2a, 1_1_2b（2条）或 1_1_2a, 1_1_2b, 1_1_2c（3条）

## 输出JSON数组
[
  { "parent_id": "1_1", "detail_count": 3, "branch_count": 1 },
  { "parent_id": "1_2", "detail_count": 4, "branch_count": 2, "branch_position": 2, "should_merge": true }
]

branch_count: 1=不分支（线性），2=二分支，3=三分支，以此类推。由你根据叙事需要决定。
每个L1节点都必须有对应规划。请严格输出JSON数组。`;
}

// ─── 构建骨架 ───

interface SkeletonNode {
  node_id: string;
  parent_id: string;
  sequence_index: number;
  is_branch: boolean;
  is_merge_point: boolean;
  merges_from?: string[];
  prev_node: string[];
  next_node: string[];
}

function normalizeDetailPlan(p: DetailPlan): DetailPlan {
  if (p.branch_count === undefined || p.branch_count === null) {
    return { ...p, branch_count: p.has_branch ? 2 : 1 };
  }
  return p;
}

function buildSkeleton(plans: DetailPlan[]): SkeletonNode[] {
  const nodes: SkeletonNode[] = [];
  const letters = "abcdefgh";

  for (const rawPlan of plans) {
    const plan = normalizeDetailPlan(rawPlan);
    const parentId = plan.parent_id;
    const count = Math.max(1, plan.detail_count);
    const numBranches = Math.max(1, plan.branch_count);
    const hasBranch = numBranches >= 2 && count >= 2;
    const branchPos = hasBranch ? Math.min(plan.branch_position ?? 2, count) : -1;
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

// ─── Step 1.5: 分组内容填充 ───

interface PartialFill {
  node_id: string;
  name: string;
  narrative_stage: string;
  story_elements: {
    plot: { cause: string; process: string; result: string };
    dialogue_hint: string;
    monologue_hint: string;
    narration_hint: string;
    atmosphere: string;
  };
  content: string;
}

async function step1_5_batchFill(
  ctx: NarrativeContext,
  llm: LLMClient,
  skeleton: SkeletonNode[],
): Promise<Map<string, PartialFill>> {
  const groups = new Map<string, SkeletonNode[]>();
  for (const node of skeleton) {
    const group = groups.get(node.parent_id) ?? [];
    group.push(node);
    groups.set(node.parent_id, group);
  }

  const outlines = ctx.outlines_generated?.outlines ?? [];
  const outlineMap = new Map(outlines.map(o => [o.node_id, o]));
  const fillMap = new Map<string, PartialFill>();

  for (const [parentId, group] of groups) {
    const parent = outlineMap.get(parentId);
    const parentName = parent?.name ?? parentId;
    const parentStage = parent?.narrative_stage ?? "rising";

    const skeletonDesc = group.map(s =>
      `- [${s.node_id}] prev=${JSON.stringify(s.prev_node)} next=${JSON.stringify(s.next_node)} ${s.is_branch ? "(分支)" : ""} ${s.is_merge_point ? "(合并点)" : ""}`
    ).join("\n");

    const prompt = `你是叙事结构设计师。请为以下L2细纲节点组填充详细内容。所有输出必须使用中文。

## 核心设计原则
- **命运必然论**：L0框架层预设所有命运分支和结局，细纲层在框架内细化，不创造新结局
- **有限突变论**：细纲层可产生独立新分支（Y轴可能性维度），但必须聚合或路由到上层预设分支
- **双维度嵌套展开**：X轴顺序维度将L1的1个节点拆解为N个连续L2子节点；Y轴可能性维度在L2内部独立产生新分支

## 所属L1大纲节点
- ID: ${parentId}
- 名称: ${parentName}
- 叙事阶段: ${parentStage}
- 内容: ${parent?.content ?? ""}

## 用户原始需求
${ctx.user_input}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 角色档案摘要
${buildCharacterDigest(ctx.detailed_character_sheets ?? [])}

## 道具清单
${buildItemDigest(ctx.item_database ?? [])}

## 整体故事弧
${buildStoryArcDigest(ctx.initial_story_outline)}

## 相邻章节概要
${buildAdjacentGroupDigest(parentId, outlines)}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {})}

## 节点骨架
${skeletonDesc}

## 反套路偏差指导
- 正偏差 → 意外/升华/惊喜转折
- 负偏差 → 颠覆解构常规套路
- 中性 → 经典叙事套路

## 输出要求
为每个节点填充:
- name: 具体化的节点名称
- narrative_stage: 叙事阶段
- story_elements:
  - plot: {"cause": "起因", "process": "发展", "result": "结果"}
  - dialogue_hint: 对白风格提示
  - monologue_hint: 独白方向
  - narration_hint: 旁白语气
  - atmosphere: 氛围描述
- content: 详细叙事内容（300字以上）

**重要：你必须为以下所有 ${group.length} 个节点都生成内容，不可遗漏任何一个。**
需要填充的全部 node_id 列表：${group.map(s => s.node_id).join(", ")}

请严格输出JSON对象:
{
  "detailed_outlines": [
    ${group.map(s => `{"node_id": "${s.node_id}", "name": "...", "narrative_stage": "...", "story_elements": {"plot": {"cause":"...", "process":"...", "result":"..."}, "dialogue_hint":"...", "atmosphere":"..."}, "content": "300字以上详细叙事..."}`).join(",\n    ")}
  ]
}`;

    try {
      const raw = await llm.callWithRetry(
        composeSystemPrompt(DETAIL_FILL_COMPOSER, ctx),
        prompt,
        { responseFormat: "json" },
        (r) => {
          const p = extractJSON<Record<string, unknown>>(r);
          if (!Array.isArray(p.detailed_outlines)) throw new Error("需要detailed_outlines数组");
        },
      );

      const parsed = extractJSON<{ detailed_outlines: PartialFill[] }>(raw);
      for (const fill of parsed.detailed_outlines) {
        if (fill.node_id) fillMap.set(fill.node_id, fill);
      }
    } catch (e) {
      console.warn(`[L2 Step1.5] 分组 ${parentId} 填充失败: ${(e as Error).message}`);
    }
  }

  return fillMap;
}

// ─── Step 2: 全局补充 ───

const STEP2_SYSTEM = `你是叙事结构设计师，请基于L1大纲和L2结构骨架，为内容不足的细纲节点补充详细内容。所有输出必须使用中文。

## Layer2 细纲层 6 槽位
- L2_01 局部场景: 场景细节
- L2_02 对白: 对话风格
- L2_03 独白: 内心独白方向
- L2_04 旁白: 旁白语气
- L2_05 语气: 整体语气
- L2_06 叙事腔调: 叙事风格

## 输出要求
输出 JSON 对象，包含 detailed_outlines 数组。
每个元素需含：node_id, name, narrative_stage, story_elements(含plot/dialogue_hint/monologue_hint/narration_hint/atmosphere), content（300字以上）

**严格要求**：node_id 必须与骨架完全一致。`;

export const DETAIL_GAP_COMPOSER: PromptComposer = {
  stepId: "detailed_outline",
  blocks: {
    base: STEP2_SYSTEM,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
  },
  systemBlockOrder: ["base", "style_guide", "constraints"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildStep2Prompt(ctx: NarrativeContext, skeleton: SkeletonNode[], fillMap: Map<string, PartialFill>): string {
  const needFill = skeleton.filter(s => {
    const fill = fillMap.get(s.node_id);
    return !fill || (fill.content?.length ?? 0) < 50;
  });

  if (needFill.length === 0) return "";

  const needDesc = needFill.map(s => `- [${s.node_id}] (parent: ${s.parent_id})`).join("\n");

  const outlinesDigest = ctx.outlines_generated
    ? JSON.stringify(ctx.outlines_generated.outlines.map(o => ({
        node_id: o.node_id, name: o.name, content: o.content,
      })), null, 2)
    : "（无）";

  return `## 用户原始需求
${ctx.user_input}

## L1大纲
${outlinesDigest}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 角色档案摘要
${buildCharacterDigest(ctx.detailed_character_sheets ?? [])}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {})}

## 需要补充内容的节点
${needDesc}

请为以上节点补充完整内容。输出 JSON：
{
  "detailed_outlines": [ { "node_id": "...", "name": "...", "narrative_stage": "...", "story_elements": {...}, "content": "300字以上..." } ]
}`;
}

// ─── 主函数 ───

export async function detailedOutlineBatch(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const allOutlines = ctx.outlines_generated?.outlines ?? [];
  if (allOutlines.length === 0) return;

  const nodeFilter = getNodeFilter(ctx);
  let outlines = allOutlines;
  if (nodeFilter) {
    const affectedParents = new Set<string>();
    for (const nid of nodeFilter) {
      const lastUnderscore = nid.lastIndexOf("_");
      affectedParents.add(lastUnderscore > 0 ? nid.substring(0, lastUnderscore) : nid);
    }
    outlines = allOutlines.filter(n => affectedParents.has(n.node_id));
    if (outlines.length === 0) {
      outlines = allOutlines.filter(n => {
        for (const nid of nodeFilter) {
          if (nid.startsWith(n.node_id + "_")) return true;
        }
        return false;
      });
    }
    if (outlines.length === 0) return;
  }

  // Step 1: 结构规划
  const step1Raw = await llm.callWithRetry(
    composeSystemPrompt(DETAIL_PLAN_COMPOSER, ctx),
    appendUserInstructions(buildStep1Prompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<unknown>(r);
      if (!Array.isArray(p) || p.length === 0) throw new Error("必须是非空JSON数组");
    },
  );

  const rawPlans = extractJSON<DetailPlan[]>(step1Raw);
  const existingParents = new Set(rawPlans.map(p => p.parent_id));
  const budgetL2Min = ctx.global_control_params
    ? getNodeBudget(ctx.global_control_params.complexity ?? 2).l2_per_min
    : 1;
  for (const ol of outlines) {
    if (!existingParents.has(ol.node_id)) {
      rawPlans.push({ parent_id: ol.node_id, detail_count: budgetL2Min, branch_count: 1, has_branch: false });
    }
  }

  // enforce 分支/聚合目标
  const gcp = ctx.global_control_params;
  const complexity = gcp?.complexity ?? 2;
  const entropy = getEntropy(complexity);
  const l2Ctrl = gcp?.layer_controls?.layer_2;
  const layerEntropy = getLayerEntropy(entropy, 2, l2Ctrl);
  const grossTarget = getTargetBranchRatio(complexity, layerEntropy, 2);
  const mergeTend = getMergeTendency(complexity, 2);

  const olStageMap = new Map(outlines.map(o => [o.node_id, o.narrative_stage]));
  const enforceable: StructurePlanItem[] = rawPlans.map((p) => ({
    parent_id: p.parent_id,
    child_count: p.detail_count,
    branch_count: p.branch_count ?? (p.has_branch ? 2 : 1),
    should_merge: p.should_merge,
    narrative_stage: p.narrative_stage ?? olStageMap.get(p.parent_id),
  }));
  const enforced = enforceBranchInPlan(enforceable, grossTarget, mergeTend, 2);

  const l2Max = gcp?.target_structure?.l2_per_parent ?? l2Ctrl?.max_nodes;
  const clamped = clampChildCount(enforced, 2, layerEntropy, l2Ctrl?.min_nodes, l2Max, complexity);

  const plans: DetailPlan[] = rawPlans.map((p, i) => ({
    ...p,
    detail_count: clamped[i].child_count,
    branch_count: clamped[i].branch_count,
    should_merge: clamped[i].should_merge,
  }));

  // 构建骨架
  let skeleton = buildSkeleton(plans);

  // 连接修复链（6 步，移植自 v3 fix_all_connections）
  const parentNodes = outlines.map(o => ({
    node_id: o.node_id,
    next_node: o.next_node,
  }));
  skeleton = inferCrossParentConnections(skeleton, parentNodes);
  skeleton = repairIntraGroupConnections(skeleton);
  skeleton = filterCrossBranchConnections(skeleton);
  const { nodes: danglingFixed, logs: danglingLogs } = fixDanglingBranches(skeleton, parentNodes);
  skeleton = danglingFixed;
  if (danglingLogs.length > 0) {
    console.log(`[L2] 悬挂分支修复: ${danglingLogs.length} 项`);
  }
  skeleton = fixNvNRouting(skeleton);
  skeleton = ensureBidirectionalConsistency(skeleton);

  // Step 1.5: 分组内容填充
  const fillMap = await step1_5_batchFill(ctx, llm, skeleton);

  // Step 2: 全局补充（仅填充不足的节点）
  const step2Prompt = buildStep2Prompt(ctx, skeleton, fillMap);
  if (step2Prompt) {
    try {
      const step2Raw = await llm.callWithRetry(
        composeSystemPrompt(DETAIL_GAP_COMPOSER, ctx),
        step2Prompt,
        { responseFormat: "json" },
        (r) => {
          const p = extractJSON<Record<string, unknown>>(r);
          if (!Array.isArray(p.detailed_outlines)) throw new Error("需要detailed_outlines数组");
        },
      );

      const supplement = extractJSON<{ detailed_outlines: PartialFill[] }>(step2Raw);
      for (const fill of supplement.detailed_outlines) {
        const existing = fillMap.get(fill.node_id);
        if (!existing || (existing.content?.length ?? 0) < 50) {
          fillMap.set(fill.node_id, fill);
        }
      }
    } catch (e) {
      console.warn(`[L2 Step2] 全局补充失败: ${(e as Error).message}`);
    }
  }

  // 合并骨架 + 内容
  const detailedOutlines: DetailedOutlineNode[] = skeleton.map((skel) => {
    const fill = fillMap.get(skel.node_id);
    const se = fill?.story_elements;

    return {
      node_id: skel.node_id,
      content_id: `do_${skel.node_id}`,
      parent_id: skel.parent_id,
      name: fill?.name ?? `细纲${skel.node_id}`,
      narrative_stage: fill?.narrative_stage ?? "rising",
      prev_node: skel.prev_node,
      next_node: skel.next_node,
      story_elements: {
        plot: {
          cause: se?.plot?.cause ?? "",
          process: se?.plot?.process ?? "",
          result: se?.plot?.result ?? "",
        },
        dialogue_hint: se?.dialogue_hint ?? "",
        monologue_hint: se?.monologue_hint ?? "",
        narration_hint: se?.narration_hint ?? "",
        atmosphere: se?.atmosphere ?? "",
      },
      content: fill?.content ?? "",
    };
  });

  ctx.detailed_outlines_generated = { detailed_outlines: detailedOutlines };

  await structureValidationL2(ctx, llm);
}
