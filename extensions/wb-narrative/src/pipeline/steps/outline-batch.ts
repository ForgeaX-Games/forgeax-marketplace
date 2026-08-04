/**
 * L1 大纲生成（OutlineBatchAgent）
 *
 * 完整两步走机制（继承自 v3）：
 *   Step1: LLM 规划结构（每个 L0 父节点的子节点数量 + 分支决策）
 *          → 代码构建固定骨架（ID、prev/next、branch/merge 元数据）
 *          → 跨父连接推断（1v1/Nv1/1vN/NvN）
 *   Step2: LLM 填充叙事内容（不覆盖骨架的图结构边）
 *
 * 设计哲学：
 * - 命运必然论：L0 预设所有命运分支和结局，L1 在框架内细化
 * - 有限突变：L1 可产生新分支（Y轴），但不创造新结局
 * - 双维度展开：X轴=顺序细化 / Y轴=可能性分支
 * - 分支必须聚合或路由到 L0 预设分支
 */
import type {
  NarrativeContext,
  OutlinesGenerated,
  OutlineNode,
  FrameworkNode,
  InitialOutline,
} from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { extractJSON } from "../llm-client.js";
import { appendUserInstructions, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK, STRATEGY_SLOT_BLOCK, type PromptComposer } from "../prompt-composer.js";
import {
  buildCharacterDigest,
  buildItemDigest,
  buildStoryArcDigest,
  buildAdjacentGroupDigest,
} from "./context-helpers.js";
import { getNodeFilter } from "../node-merge.js";
import { structureValidationL1 } from "./structure-validation.js";
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

function outlineToText(outline: InitialOutline | undefined): string {
  if (!outline) return "（无）";
  return [
    outline.theme ? `主题：${outline.theme}` : "",
    outline.background ? `背景：${outline.background}` : "",
    outline.main_conflict ? `主线冲突：${outline.main_conflict}` : "",
    outline.story_structure.opening ? `开端：${outline.story_structure.opening}` : "",
    outline.story_structure.development.length > 0
      ? outline.story_structure.development.join("\n")
      : "",
    outline.story_structure.ending ? `结局：${outline.story_structure.ending}` : "",
    outline.key_plot_points.length > 0
      ? outline.key_plot_points.map((p, i) => `${i + 1}. ${p}`).join("\n")
      : "",
  ].filter(Boolean).join("\n\n");
}

// ─── Step 1: 结构规划 ───

interface StructurePlan {
  parent_id: string;
  outline_count: number;
  branch_count: number;
  branch_position?: number;
  branch_reason?: string;
  should_merge?: boolean;
  narrative_stage?: string;
  /**
   * 分叉处哪条支线属于最优路径（分支字母 a/b/c…）。
   * feature list 2.3.8 要求结构层标出"最符合用户需求的那一条链路"。
   * 缺省时按 a 处理——总得有一条，不标等于把判断推给下游瞎猜。
   */
  optimal_branch?: string;
  /** @deprecated backward compat — mapped to branch_count */
  has_branch?: boolean;
}

const STEP1_SYSTEM = `你是叙事结构规划师。根据L0框架节点，为每个框架节点规划L1大纲子节点数量和分支。所有输出使用中文。`;

export const OUTLINE_PLAN_COMPOSER: PromptComposer = {
  stepId: "outline_batch",
  blocks: {
    cot: `## 机制与流程
本席把上游的每个**叙事单元**展开成一棵**剧情树**：定清树上每个节点的功能位、
主要内容与位置关系。节点正文交给下游情节席去写，此处只到"这个节点干什么、
接在哪、凭什么走到下一个"为止。

节点分五种功能位，任何形态的剧情树都由它们拼成：
- **起始**：单元入口，无前驱；
- **分支**：玩家在此作答，之后走向分岔；
- **聚合**：多条分支在此收束回主干；
- **结局**：本单元或全局的终点，无后继；
- **普通**：单入单出的推进。

分支、聚合、结局三种节点**必须给出条件**——凭什么走这条分支、各分支凭什么汇回、
达成这个结局要满足什么。条件写成玩家可感的判据（选了哪个选项、某个数值过线、
是否持有某物、是否去过某节点），不要写成"剧情需要"。普通节点默认无条件推进。
条件挂在**出边**上：一个三选分支就是三条边各带自己的条件与代价，不要把三个条件
堆在节点上再让下游去猜哪个通向哪。收束回主干的边要显式标为 merge_back。

开分支时先定这处分岔的**代价档**，再决定铺几条边：
- **converge**：路径不同、结果相同——一般失误可挽回，代价是绕远或损耗，走几个节点后汇回；
- **diverge**：路径天壤之别、结局不同——抉择真正分岔，长链不汇；
- **terminal**：分支程度过大——直接走向结局（致命错误，或决定性正确带来的提前圆满）。
定不出代价档，说明这处分岔本身没想清楚。**几条边指向同一个目标是假分支**，
玩家的选择没有产生任何差异，宁可不开。每条选择边尽量写明它的代价与人设契合倾向。

结局要分档：**H 圆满 / B 悲剧 / O 其他**（开放、反转、隐藏），并区分作用域——
**global** 是全剧终，**local** 是中途的 game over 或提前圆满。允许失败的作品会有
好几个 local 结局，这是正常的；但 global 结局不该满地都是。

1. 逐个读上游叙事单元，判断这一段承担的叙事功能需要几个子节点才铺得开。
2. 按**结构轴策略卡指定的形态**布置这棵树：线性形态只用起始/普通/结局；
   树状形态四种齐用；碎片化形态大量普通节点而少聚合。形态服从策略卡，
   不要一律铺成同一种树。
3. 决定分支位置与分支数——分支要出现在角色**必须做选择**的地方，不为分叉而分叉；
   每个分支给出条件，并确认它能收束回主干（除非本处就是结局分岔）。
4. 为每处分支指出最优路径。
5. 自检：因果是否连贯？五种功能位是否标全？分支/聚合/结局是否都带了条件？
   有没有节点成了孤岛（无前驱又非起始、无后继又非结局）？`,
    base: STEP1_SYSTEM,
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
  },
  systemBlockOrder: ["base", "strategy", "ip_dna", "style_guide", "constraints", "cot"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

export const OUTLINE_FILL_COMPOSER: PromptComposer = {
  stepId: "outline_batch",
  blocks: {
    base: "你是叙事结构设计师。",
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
  },
  systemBlockOrder: ["base", "strategy", "ip_dna", "style_guide", "constraints"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildStep1Prompt(ctx: NarrativeContext): string {
  const fw = ctx.story_framework?.framework.nodes ?? [];
  const fwDesc = fw.map(n =>
    `- [${n.node_id}] ${n.name}（${n.narrative_function}）: ${(n.main_content ?? "").slice(0, 80)}${(n.main_content ?? "").length > 80 ? "..." : ""}`
  ).join("\n");

  const gcp = ctx.global_control_params;
  const complexity = gcp?.complexity ?? 2;
  const entropy = getEntropy(complexity);
  const l1Ctrl = gcp?.layer_controls?.layer_1;
  const layerEntropy = getLayerEntropy(entropy, 1, l1Ctrl);
  const deviation = deviationFromLegacy(gcp);

  const branchSection = buildBranchPromptSection(1, complexity, layerEntropy);
  const deviationSection = buildDeviationPrompt(deviation);
  const nodeCountSection = buildNodeCountPromptSection(1, layerEntropy, l1Ctrl?.min_nodes, l1Ctrl?.max_nodes, complexity);

  return `## 用户需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## 偏好总结
${ctx.user_preference_summary ?? "（无）"}

## 初步大纲
${outlineToText(ctx.initial_story_outline)}

## L0框架节点
${fwDesc}

${nodeCountSection}
每个L0父节点展开为上述范围内的L1子节点。

${branchSection}

${deviationSection}

## 大纲节点ID规则
- 格式: {父节点ID}_{序号}，如 1_1, 2_1, 2_2
- 分支节点加字母: 1_2a, 1_2b（2条分支）或 1_2a, 1_2b, 1_2c（3条分支）

## 输出JSON数组
[
  { "parent_id": "1", "outline_count": 3, "branch_count": 1 },
  { "parent_id": "2", "outline_count": 4, "branch_count": 2, "branch_position": 2, "branch_reason": "...", "should_merge": true, "optimal_branch": "a" }
]

branch_count: 1=不分支（线性），2=二分支，3=三分支，以此类推。由你根据叙事需要决定。

## 最优路径
凡 branch_count >= 2，必须用 optimal_branch 指出哪条支线（"a"/"b"/"c"…）是**最优路径**——
即最贴合上面「用户需求」与「偏好总结」的那一条走向。判断依据按优先级：
1. 用户明确点名要的情节走向、结局倾向、角色归宿；
2. 与初步大纲的主题和角色弧光最一致的那条；
3. 戏剧张力最足、后续可展开空间最大的那条。
最优路径不等于"好结局"——若用户要的是悲剧，那条通向悲剧的支线才是最优路径。
不分支的节点无须标注，它们默认都在最优路径上。

每个框架节点都必须有对应规划。请严格输出JSON数组。`;
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
  /** 是否落在最优路径上。非分叉节点恒为 true：不分叉时人人都在唯一那条路上。 */
  on_optimal_path: boolean;
}

function normalizePlan(p: StructurePlan): StructurePlan {
  if (p.branch_count === undefined || p.branch_count === null) {
    return { ...p, branch_count: p.has_branch ? 2 : 1 };
  }
  return p;
}

function buildSkeleton(plans: StructurePlan[]): SkeletonNode[] {
  const nodes: SkeletonNode[] = [];
  const letters = "abcdefgh";

  for (const rawPlan of plans) {
    const plan = normalizePlan(rawPlan);
    const parentId = plan.parent_id;
    const count = Math.max(1, plan.outline_count);
    const numBranches = Math.max(1, plan.branch_count);
    const hasBranch = numBranches >= 2 && count >= 2;
    const branchPos = hasBranch ? Math.min(plan.branch_position ?? 2, count) : -1;
    const shouldMerge = plan.should_merge ?? true;

    let seqIdx = 0;
    for (let i = 1; i <= count; i++) {
      if (hasBranch && i === branchPos) {
        const optimalIdx = Math.max(0, letters.indexOf(plan.optimal_branch?.trim().toLowerCase() ?? "a"));
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
            on_optimal_path: b === optimalIdx,
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
            on_optimal_path: true,
          };
          for (const bn of branchNodes) bn.next_node.push(mergeNode.node_id);
          nodes.push(mergeNode);
          seqIdx++;
          i++;
        } else if (!shouldMerge) {
          // non-merging branches become dead-ends; cross-parent inference handles routing
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
          on_optimal_path: true,
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

// ─── Step 1.5b: 按 L0 父节点分组 LLM 填充 ───

interface PartialOutlineFill {
  node_id: string;
  name: string;
  narrative_stage: string;
  story_elements: {
    plot: { cause: string; process: string; result: string };
  };
  content: string;
}

async function step1_5b_batchFill(
  ctx: NarrativeContext,
  llm: LLMClient,
  skeleton: SkeletonNode[],
  frameworkNodes: FrameworkNode[],
): Promise<Map<string, PartialOutlineFill>> {
  const groups = new Map<string, SkeletonNode[]>();
  for (const node of skeleton) {
    const group = groups.get(node.parent_id) ?? [];
    group.push(node);
    groups.set(node.parent_id, group);
  }

  const fwMap = new Map(frameworkNodes.map(n => [n.node_id, n]));
  const fillMap = new Map<string, PartialOutlineFill>();

  for (const [parentId, group] of groups) {
    const parent = fwMap.get(parentId);
    const parentName = parent?.name ?? parentId;
    const parentFunction = parent?.narrative_function ?? "";

    const skeletonDesc = group.map(s =>
      `- [${s.node_id}] prev=${JSON.stringify(s.prev_node)} next=${JSON.stringify(s.next_node)} ${s.is_branch ? "(分支)" : ""} ${s.is_merge_point ? "(合并点)" : ""}`
    ).join("\n");

    const prompt = `你是叙事结构设计师。请为以下L1大纲节点组填充详细内容。所有输出必须使用中文。

## 核心设计原则
- **命运必然论**：L0框架层预设所有命运分支和结局，大纲层在框架内细化
- **有限突变论**：大纲层可产生独立新分支（Y轴可能性维度），但不创造新结局
- **双维度嵌套展开**：X轴顺序维度将L0的1个节点拆解为N个连续L1子节点；Y轴可能性维度在L1内部独立产生新分支

## 所属L0框架节点
- ID: ${parentId}
- 名称: ${parentName}
- 叙事功能: ${parentFunction}
- 内容: ${parent?.main_content ?? ""}

## 用户原始需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## 偏好总结
${ctx.user_preference_summary ?? "（无）"}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 角色档案摘要
${buildCharacterDigest(ctx.detailed_character_sheets ?? [])}

## 道具清单
${buildItemDigest(ctx.item_database ?? [])}

## 整体故事弧
${buildStoryArcDigest(ctx.initial_story_outline)}

## 相邻章节概要
${buildAdjacentGroupDigest(parentId, frameworkNodes)}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {})}

## 节点骨架
${skeletonDesc}

## Layer1 大纲层 6 槽位
- L1_01 个人故事: 角色个人线
- L1_02 性格弧光: 角色成长轨迹
- L1_03 人物关系: 关系发展变化
- L1_04 环境描写: 环境氛围营造
- L1_05 表现手法: 叙事表现技巧
- L1_06 表达方式: 语言表达风格

## 输出要求
为每个节点填充:
- name: 具体化的节点名称
- narrative_stage: 叙事阶段
- story_elements: { "plot": { "cause": "事件起因", "process": "发展过程", "result": "阶段结果" } }
- content: 详细叙事内容（200字以上）

**重要：你必须为以下所有 ${group.length} 个节点都生成内容，不可遗漏任何一个。**
需要填充的全部 node_id 列表：${group.map(s => s.node_id).join(", ")}

请严格输出JSON对象:
{
  "outlines": [
    ${group.map(s => `{"node_id": "${s.node_id}", "name": "...", "narrative_stage": "...", "story_elements": {"plot": {"cause": "...", "process": "...", "result": "..."}}, "content": "200字以上详细叙事..."}`).join(",\n    ")}
  ]
}`;

    try {
      const raw = await llm.callWithRetry(
        composeSystemPrompt(OUTLINE_FILL_COMPOSER, ctx),
        prompt,
        { responseFormat: "json" },
        (r) => {
          const p = extractJSON<Record<string, unknown>>(r);
          if (!Array.isArray(p.outlines)) throw new Error("需要outlines数组");
        },
      );

      const parsed = extractJSON<{ outlines: PartialOutlineFill[] }>(raw);
      for (const fill of parsed.outlines) {
        if (fill.node_id) fillMap.set(fill.node_id, fill);
      }
    } catch (e) {
      console.warn(`[L1 Step1.5b] 分组 ${parentId} 填充失败: ${(e as Error).message}`);
    }
  }

  return fillMap;
}

// ─── Step 2: 全局补漏（仅补充 Step 1.5b 遗漏/不足的节点） ───

const STEP2_SYSTEM = `你是叙事结构设计师，请基于L0框架和L1结构骨架，为内容不足的大纲节点补充详细内容。所有输出必须使用中文。

## Layer1 大纲层 6 槽位
- L1_01 个人故事: 角色个人线
- L1_02 性格弧光: 角色成长轨迹
- L1_03 人物关系: 关系发展变化
- L1_04 环境描写: 环境氛围营造
- L1_05 表现手法: 叙事表现技巧
- L1_06 表达方式: 语言表达风格

## 核心设计原则
- **命运必然论**：L0框架层预设所有命运分支和结局，大纲层在框架内细化
- **有限突变论**：大纲层可产生独立新分支（Y轴可能性维度），但不创造新结局
- **双维度嵌套展开**：X轴顺序维度将L0的1个节点拆解为N个连续L1子节点；Y轴可能性维度在L1内部独立产生新分支

## 输出要求
输出 JSON 对象，包含 outlines 数组。
每个元素需含：node_id, parent_id, name, narrative_stage, story_elements(含plot), content（200字以上）

**严格要求**：node_id 必须与骨架完全一致。`;

export const OUTLINE_GAP_COMPOSER: PromptComposer = {
  stepId: "outline_batch",
  blocks: {
    base: STEP2_SYSTEM,
    strategy: STRATEGY_SLOT_BLOCK,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
  },
  systemBlockOrder: ["base", "strategy", "ip_dna", "style_guide", "constraints"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildStep2Prompt(ctx: NarrativeContext, skeleton: SkeletonNode[], fillMap: Map<string, PartialOutlineFill>): string {
  const needFill = skeleton.filter(s => {
    const fill = fillMap.get(s.node_id);
    return !fill || (fill.content?.length ?? 0) < 50;
  });

  if (needFill.length === 0) return "";

  const needDesc = needFill.map(s => `- [${s.node_id}] (parent: ${s.parent_id})`).join("\n");

  const frameworkStr = ctx.story_framework
    ? JSON.stringify(ctx.story_framework.framework.nodes.map(n => ({
        node_id: n.node_id, name: n.name,
        narrative_function: n.narrative_function,
        main_content: n.main_content,
      })), null, 2)
    : "（无）";

  return `## 用户原始需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## L0故事框架
${frameworkStr}

## 初步大纲
${outlineToText(ctx.initial_story_outline)}

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
  "outlines": [ { "node_id": "...", "parent_id": "...", "name": "...", "narrative_stage": "...", "story_elements": {"plot": {...}}, "content": "200字以上..." } ]
}`;
}

// ─── 主函数 ───

export async function outlineBatch(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const allFrameworkNodes = ctx.story_framework?.framework.nodes ?? [];
  if (allFrameworkNodes.length === 0) return;

  const nodeFilter = getNodeFilter(ctx);
  let frameworkNodes = allFrameworkNodes;
  if (nodeFilter) {
    const affectedParents = new Set<string>();
    for (const nid of nodeFilter) {
      const firstUnderscore = nid.indexOf("_");
      affectedParents.add(firstUnderscore > 0 ? nid.substring(0, firstUnderscore) : nid);
    }
    frameworkNodes = allFrameworkNodes.filter(n => affectedParents.has(n.node_id));
    if (frameworkNodes.length === 0) return;
  }

  // Step 1: 结构规划
  const step1Raw = await llm.callWithRetry(
    composeSystemPrompt(OUTLINE_PLAN_COMPOSER, ctx),
    appendUserInstructions(buildStep1Prompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<unknown>(r);
      if (!Array.isArray(p) || p.length === 0) throw new Error("必须是非空JSON数组");
    },
  );

  const rawPlans = extractJSON<StructurePlan[]>(step1Raw);
  const existingParents = new Set(rawPlans.map(p => p.parent_id));
  const budgetL1Min = ctx.global_control_params
    ? getNodeBudget(ctx.global_control_params.complexity ?? 2).l1_per_min
    : 2;
  for (const fw of frameworkNodes) {
    if (!existingParents.has(fw.node_id)) {
      rawPlans.push({ parent_id: fw.node_id, outline_count: budgetL1Min, branch_count: 1, has_branch: false });
    }
  }

  // enforce 分支/聚合目标
  const gcp = ctx.global_control_params;
  const complexity = gcp?.complexity ?? 2;
  const entropy = getEntropy(complexity);
  const l1Ctrl = gcp?.layer_controls?.layer_1;
  const layerEntropy = getLayerEntropy(entropy, 1, l1Ctrl);
  const grossTarget = getTargetBranchRatio(complexity, layerEntropy, 1);
  const mergeTend = getMergeTendency(complexity, 1);

  const fwStageMap = new Map(frameworkNodes.map(n => [n.node_id, n.stage_type]));
  const enforceable: StructurePlanItem[] = rawPlans.map((p) => ({
    parent_id: p.parent_id,
    child_count: p.outline_count,
    branch_count: p.branch_count ?? (p.has_branch ? 2 : 1),
    should_merge: p.should_merge,
    narrative_stage: p.narrative_stage ?? fwStageMap.get(p.parent_id),
  }));
  const enforced = enforceBranchInPlan(enforceable, grossTarget, mergeTend, 1);

  const l1Max = gcp?.target_structure?.l1_per_parent ?? l1Ctrl?.max_nodes;
  const clamped = clampChildCount(enforced, 1, layerEntropy, l1Ctrl?.min_nodes, l1Max, complexity);

  const plans: StructurePlan[] = rawPlans.map((p, i) => ({
    ...p,
    outline_count: clamped[i].child_count,
    branch_count: clamped[i].branch_count,
    should_merge: clamped[i].should_merge,
  }));

  // 构建骨架
  let skeleton = buildSkeleton(plans);

  // Step 1.5a: 连接修复链（6 步，移植自 v3 fix_all_connections）
  const parentNodes = frameworkNodes.map(n => ({
    node_id: n.node_id,
    next_node: n.next_node ?? [],
  }));
  skeleton = inferCrossParentConnections(skeleton, parentNodes);
  skeleton = repairIntraGroupConnections(skeleton);
  skeleton = filterCrossBranchConnections(skeleton);
  const { nodes: danglingFixed, logs: danglingLogs } = fixDanglingBranches(skeleton, parentNodes);
  skeleton = danglingFixed;
  if (danglingLogs.length > 0) {
    console.log(`[L1] 悬挂分支修复: ${danglingLogs.length} 项`);
  }
  skeleton = fixNvNRouting(skeleton);
  skeleton = ensureBidirectionalConsistency(skeleton);

  // Step 1.5b: 按 L0 父节点分组 LLM 填充
  const fillMap = await step1_5b_batchFill(ctx, llm, skeleton, frameworkNodes);

  // Step 2: 全局补漏（仅填充不足的节点）
  const step2Prompt = buildStep2Prompt(ctx, skeleton, fillMap);
  if (step2Prompt) {
    try {
      const step2Raw = await llm.callWithRetry(
        composeSystemPrompt(OUTLINE_GAP_COMPOSER, ctx),
        step2Prompt,
        { responseFormat: "json" },
        (r) => {
          const p = extractJSON<Record<string, unknown>>(r);
          if (!Array.isArray(p.outlines) || p.outlines.length === 0) throw new Error("outlines必须是非空数组");
        },
      );

      const supplement = extractJSON<{ outlines: PartialOutlineFill[] }>(step2Raw);
      for (const fill of supplement.outlines) {
        const existing = fillMap.get(fill.node_id);
        if (!existing || (existing.content?.length ?? 0) < 50) {
          fillMap.set(fill.node_id, fill);
        }
      }
    } catch (e) {
      console.warn(`[L1 Step2] 全局补漏失败: ${(e as Error).message}`);
    }
  }

  // 合并骨架 + 内容（骨架的图结构优先）
  const outlines: OutlineNode[] = skeleton.map((skel) => {
    const fill = fillMap.get(skel.node_id);
    const plot = fill?.story_elements?.plot;

    return {
      node_id: skel.node_id,
      content_id: `ol_${skel.node_id}`,
      parent_id: skel.parent_id,
      name: fill?.name ?? `节点${skel.node_id}`,
      narrative_stage: fill?.narrative_stage ?? "rising",
      prev_node: skel.prev_node,
      next_node: skel.next_node,
      story_elements: {
        plot: {
          cause: plot?.cause ?? "",
          process: plot?.process ?? "",
          result: plot?.result ?? "",
        },
      },
      content: fill?.content ?? "",
      on_optimal_path: skel.on_optimal_path,
    };
  });

  ctx.outlines_generated = { outlines };

  await structureValidationL1(ctx, llm);
}
