/**
 * L3 情节生成（PlotProcessor）
 *
 * 设计哲学（继承自 v3）：
 * - 继承 L2 结构（1:1 映射），不产生新分支
 * - 三重约束：边界约束（cause→result）、范围约束（content）、边界校验（前后节点不越界）
 * - 拓扑分层执行（分支并行 + 主干顺序）：
 *   同层节点并行，层间顺序，通过滑动窗口传递前驱实际内容摘要
 * - 情节内容为小说级笔触（1000-2000 字），含 jrpg_elements
 * - 增强上下文：祖先链（L0→L1→L2）、用户需求、剧情简介
 */
import type { NarrativeContext, DetailedOutlineNode, PlotNode } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { extractJSON } from "../llm-client.js";
import { validateTripleConstraints } from "../../utils/constraint-validator.js";
import { buildDesignContextSnippet, appendUserInstructions, buildIpSourceReference } from "./design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK, type PromptComposer } from "../prompt-composer.js";
import { getNodeFilter } from "../node-merge.js";
import { structureValidationL3 } from "./structure-validation.js";
import {
  buildAncestorChainContext,
  buildSlidingWindowSummary,
  topologicalLayers,
} from "./context-helpers.js";

const SYSTEM_PROMPT = `你是叙事与游戏剧本设计师，请基于L2细纲节点生成L3情节。所有输出必须使用中文。

### 三重约束系统（必须严格遵守）

**1. 边界约束（Boundary Constraint）**
- 起始状态 = 细纲节点 story_elements.plot.cause
- 终止状态 = 细纲节点 story_elements.plot.result
- 情节必须从 cause 出发，到达 result

**2. 范围约束（Scope Constraint）**
- 生成内容必须在细纲节点 content 定义的范围内
- 不得引入细纲未提及的重大事件或角色

**3. 边界校验（Boundary Validation）**
- 不得重复前一节点已完成的事
- 不得提前后一节点将发生的事
- 上下文无缝衔接

### 输出格式（严格 JSON 对象）
{
  "node_id": "节点ID",
  "parent_id": "父节点ID",
  "content": "情节详细内容描述（1000-2000字，小说级笔触）",
  "story_elements": { "plot": { "cause": "起因", "process": "经过", "result": "结果" } },
  "jrpg_elements": {
    "scene_location": "主场景位置",
    "scene_locations": ["主场景", "细分场景"],
    "scene_characters": ["角色1", "角色2"],
    "dialogue_segments": [{ "speaker": "角色名", "text": "对话内容", "emotion": "情感" }],
    "key_items": ["道具"],
    "narration_hints": ["叙事提示"],
    "bgm_hint": "背景音乐提示",
    "camera_hint": "镜头提示"
  }
}`;

export const PLOT_GENERATION_COMPOSER: PromptComposer = {
  stepId: "plot_generation",
  blocks: {
    base: SYSTEM_PROMPT,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
  },
  systemBlockOrder: ["base", "ip_dna", "style_guide", "constraints"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

const CALLBACK_TRIGGER_STAGES = /climax|turning|crisis|fall|resolution|death|betray|sacrifice/i;

function buildCallbackGuidance(node: DetailedOutlineNode, ctx: NarrativeContext): string {
  const stage = node.narrative_stage ?? "";
  const content = node.content ?? "";
  const isCallbackMoment = CALLBACK_TRIGGER_STAGES.test(stage)
    || /死|牺牲|背叛|叛变|失去|毁灭|离别|诀别/.test(content);

  if (!isCallbackMoment) return "";

  const sheets = ctx.detailed_character_sheets ?? [];
  const fragments: string[] = [];
  for (const c of sheets) {
    const pl = c.personal_life;
    if (!pl) continue;
    const items: string[] = [];
    if (pl.private_wish) items.push(`曾经的期待: "${pl.private_wish}"`);
    if (pl.personal_item) items.push(`随身物件: ${pl.personal_item}`);
    if (pl.independent_bonds && pl.independent_bonds.length > 0) {
      const bonds = pl.independent_bonds.map(b => `${b.name}(${b.relationship}: ${b.detail})`).join("、");
      items.push(`还有人在等: ${bonds}`);
    }
    if (pl.speech_pattern) items.push(`口头禅: "${pl.speech_pattern}"`);
    if (items.length > 0) {
      fragments.push(`- ${c.name}: ${items.join("; ")}`);
    }
  }

  if (fragments.length === 0) return "";

  return `\n## ⭐ Callback 叙事呼应提示

当前节点处于关键转折阶段（${stage}），涉及角色的命运变化。这是回收之前埋下的叙事碎片（Call）的最佳时机。

请在情节中自然融入以下 callback 素材（不要全部使用，选择最能制造情感冲击的1-2个）：
${fragments.join("\n")}

callback 要求：
- 不要直接重复角色档案的文字，而是通过场景细节、对话、物件、回忆闪回等手法间接呼应
- 例如：角色死亡时，口袋里滑出之前承诺要带给某人的东西；幸存者想起死者说过"干完这票就..."
- 目的是让读者/玩家在此刻感受到"这个人不只是一个功能角色，他有未完成的人生"
`;
}

function buildEntryNodeGuidance(ctx: NarrativeContext): string {
  const sheets = ctx.detailed_character_sheets ?? [];
  const fragments: string[] = [];
  for (const c of sheets) {
    const pl = c.personal_life;
    if (!pl) continue;
    const items: string[] = [];
    if (pl.speech_pattern) items.push(`口头禅/说话方式: "${pl.speech_pattern}"`);
    if (pl.habits && pl.habits.length > 0) items.push(`习惯: ${pl.habits.join("、")}`);
    if (pl.private_wish) items.push(`内心期待(flag): "${pl.private_wish}"`);
    if (pl.personal_item) items.push(`私人物件: ${pl.personal_item}`);
    if (pl.vulnerability) items.push(`矛盾面: ${pl.vulnerability}`);
    if (pl.independent_bonds && pl.independent_bonds.length > 0) {
      const bonds = pl.independent_bonds.map(b => `${b.name}(${b.relationship})`).join("、");
      items.push(`牵挂的人: ${bonds}`);
    }
    if (items.length > 0) {
      fragments.push(`- ${c.name}: ${items.join("; ")}`);
    }
  }

  let section = `\n## ⭐ 叙事入口节点——角色个性碎片展示要求

这是故事的入口节点。除推进情节外，你必须通过角色的行为、对话、细微动作来展示他们的个性碎片。
这些碎片是后续 callback 的种子——先让读者/玩家感受到"这是一个活人"，后续才能在他们遭遇变故时产生真正的情感冲击。

要求：
1. 至少一个角色通过口头禅、习惯动作展示独有性格
2. 至少一个角色的 flag（对未来的期待/承诺）以对话或内心独白形式自然嵌入
3. 这些碎片必须自然融入场景节奏，禁止像人物介绍一样平铺罗列
`;
  if (fragments.length > 0) {
    section += `\n### 可用的角色个性素材（从角色档案 personal_life 提取）\n${fragments.join("\n")}\n`;
  }
  return section;
}

function buildPromptForNode(
  node: DetailedOutlineNode,
  prevNodes: DetailedOutlineNode[],
  nextNodes: DetailedOutlineNode[],
  ctx: NarrativeContext,
  constraintFeedback?: string,
  slidingWindowSummary?: string,
): string {
  const prevInfo = prevNodes.length > 0
    ? prevNodes.map(p =>
        `前置节点 [${p.node_id}] "${p.name}":\n     result="${p.story_elements.plot.result}"\n     摘要: ${p.content.slice(0, 100)}${p.content.length > 100 ? "..." : ""}`
      ).join("\n- ")
    : "（无前序节点）";
  const nextInfo = nextNodes.length > 0
    ? nextNodes.map(n =>
        `后续节点 [${n.node_id}] "${n.name}":\n     cause="${n.story_elements.plot.cause}"\n     摘要: ${n.content.slice(0, 100)}${n.content.length > 100 ? "..." : ""}`
      ).join("\n- ")
    : "（无后续节点）";

  const ancestorChain = buildAncestorChainContext(node.node_id, ctx);

  let prompt = `## 用户原始需求
${ctx.user_input}
${buildIpSourceReference(ctx)}

## 剧情简介
${JSON.stringify(ctx.plot_synopsis ?? {}, null, 2)}

${ancestorChain ? `## 祖先链上下文（L0→L1→当前L2）\n${ancestorChain}\n` : ""}
## L2 细纲节点（你需要为此生成情节）
${JSON.stringify(node, null, 2)}

## 边界校验上下文
- ${prevInfo}
- ${nextInfo}

## 角色档案
${JSON.stringify(ctx.detailed_character_sheets ?? [], null, 2)}

## 世界观设定
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {})}
${slidingWindowSummary ? `\n## 前一节点实际生成摘要（保持叙事连贯）\n${slidingWindowSummary}` : ""}
${prevNodes.length === 0 ? buildEntryNodeGuidance(ctx) : buildCallbackGuidance(node, ctx)}
请输出此节点的情节JSON。node_id 必须为 "${node.node_id}"，parent_id 必须为 "${node.parent_id}"。
${buildDesignContextSnippet(ctx)}`;

  if (constraintFeedback) {
    prompt += `\n\n## ⚠ 约束修正要求（上次生成未通过三重约束验证，请针对性修正）\n${constraintFeedback}`;
  }

  return prompt;
}

function normalizePlot(raw: Record<string, unknown>, node: DetailedOutlineNode): PlotNode {
  const jrpg = (raw.jrpg_elements ?? {}) as Record<string, unknown>;
  const plot = ((raw.story_elements as Record<string, unknown>)?.plot ?? node.story_elements.plot) as Record<string, string>;

  const nodeId = String(node.node_id);
  return {
    node_id: nodeId,
    content_id: `pl_${nodeId}`,
    parent_id: String(raw.parent_id ?? node.parent_id),
    content: String(raw.content ?? ""),
    story_elements: {
      plot: {
        cause: plot.cause ?? node.story_elements.plot.cause,
        process: plot.process ?? "",
        result: plot.result ?? node.story_elements.plot.result,
      },
    },
    jrpg_elements: {
      scene_location: String(jrpg.scene_location ?? ""),
      scene_locations: Array.isArray(jrpg.scene_locations) ? jrpg.scene_locations.map(String) : [],
      scene_characters: Array.isArray(jrpg.scene_characters) ? jrpg.scene_characters.map(String) : [],
      dialogue_segments: Array.isArray(jrpg.dialogue_segments)
        ? jrpg.dialogue_segments.map((d: Record<string, unknown>) => ({
            speaker: String(d.speaker ?? ""),
            text: String(d.text ?? ""),
            emotion: String(d.emotion ?? ""),
          }))
        : [],
      key_items: Array.isArray(jrpg.key_items) ? jrpg.key_items.map(String) : [],
      narration_hints: Array.isArray(jrpg.narration_hints) ? jrpg.narration_hints.map(String) : [],
      bgm_hint: String(jrpg.bgm_hint ?? ""),
      camera_hint: String(jrpg.camera_hint ?? ""),
    },
    boundary_constraints: {
      cause: node.story_elements.plot.cause,
      result: node.story_elements.plot.result,
    },
    prev_node: node.prev_node,
    next_node: node.next_node,
    narrative_stage: node.narrative_stage,
  };
}

const MAX_CONSTRAINT_RETRIES = 2;

export async function processPlotNode(
  node: DetailedOutlineNode,
  nodeMap: Map<string, DetailedOutlineNode>,
  ctx: NarrativeContext,
  llm: LLMClient,
  slidingWindowSummary?: string,
): Promise<PlotNode> {
  const prevNodes = node.prev_node.map(id => nodeMap.get(id)).filter((n): n is DetailedOutlineNode => !!n);
  const nextNodes = node.next_node.map(id => nodeMap.get(id)).filter((n): n is DetailedOutlineNode => !!n);

  const prevResults = prevNodes.map(p => p.story_elements.plot.result).filter(Boolean);
  const nextCauses = nextNodes.map(n => n.story_elements.plot.cause).filter(Boolean);

  let constraintFeedback: string | undefined;
  let plot: PlotNode | undefined;

  for (let attempt = 0; attempt <= MAX_CONSTRAINT_RETRIES; attempt++) {
    const raw = await llm.callWithRetry(
      composeSystemPrompt(PLOT_GENERATION_COMPOSER, ctx),
      appendUserInstructions(buildPromptForNode(node, prevNodes, nextNodes, ctx, constraintFeedback, slidingWindowSummary), ctx),
      { responseFormat: "json" },
      (r) => {
        const p = extractJSON<Record<string, unknown>>(r);
        if (!p.content) throw new Error("情节 content 不能为空");
      },
    );

    const parsed = extractJSON<Record<string, unknown>>(raw);
    plot = normalizePlot(parsed, node);

    const tcResult = validateTripleConstraints({
      content: plot.content,
      boundary_constraints: plot.boundary_constraints,
      scope_content: node.content,
      prev_result: prevResults.join("；"),
      next_cause: nextCauses.join("；"),
    });

    const issues = [...tcResult.errors, ...tcResult.warnings];
    if (issues.length === 0) break;

    if (attempt < MAX_CONSTRAINT_RETRIES) {
      constraintFeedback = issues.map((msg, i) => `${i + 1}. ${msg}`).join("\n");
      console.warn(`[L3] ${node.node_id} 三重约束未通过(第${attempt + 1}次)，触发修正重试:`, issues);
    } else {
      console.warn(`[L3] ${node.node_id} 三重约束重试${MAX_CONSTRAINT_RETRIES}次后仍有问题:`, issues);
    }
  }

  return plot!;
}

export async function plotGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const detailedOutlines = ctx.detailed_outlines_generated?.detailed_outlines ?? [];
  if (detailedOutlines.length === 0) return;

  // Pre-flight: check connection integrity before content generation
  // The first node with no prev is the legitimate DAG root; others are suspect
  const firstEntryId = detailedOutlines.find(n => n.prev_node.length === 0)?.node_id;
  const orphans = detailedOutlines.filter(
    n => n.prev_node.length === 0 && n.node_id !== firstEntryId,
  );
  const deadEnds = detailedOutlines.filter(
    n => n.next_node.length === 0 && n.prev_node.length > 0,
  );
  if (orphans.length > 0) {
    console.warn(
      `[L3] 连接完整性警告: ${orphans.length} 个非入口节点缺少 prev_node:`,
      orphans.map(n => n.node_id),
    );
  }
  if (deadEnds.length > 0 && deadEnds.length < detailedOutlines.length) {
    console.log(`[L3] 信息: ${deadEnds.length} 个节点为叶子节点（无后继）`);
  }

  const nodeMap = new Map(detailedOutlines.map(n => [n.node_id, n]));
  const nodeFilter = getNodeFilter(ctx);
  const targetNodes = nodeFilter
    ? detailedOutlines.filter(n => nodeFilter.has(n.node_id))
    : detailedOutlines;

  const _save = (ctx as Record<string, unknown>)._saveNode as ((s: string, n: string, d: unknown) => void) | undefined;

  // 拓扑分层执行：分支并行 + 主干顺序
  const layers = topologicalLayers(targetNodes);
  const summaryMap = new Map<string, string>();
  const plots: PlotNode[] = [];

  console.log(`[L3] 拓扑分层: ${layers.length} 层, 节点分布: ${layers.map(l => l.length).join(",")}`);

  for (const layer of layers) {
    const layerResults = await Promise.all(
      layer.map(async (node) => {
        const prevSummaries = node.prev_node
          .map(id => summaryMap.get(id))
          .filter(Boolean)
          .join("\n---\n");
        return processPlotNode(
          node, nodeMap, ctx, llm,
          prevSummaries || undefined,
        );
      }),
    );

    for (const plot of layerResults) {
      plots.push(plot);
      summaryMap.set(plot.node_id, buildSlidingWindowSummary(plot.content));
      _save?.("plot_generation", plot.node_id, plot);
    }
  }

  const plotIdMap: Record<string, string> = {};
  plots.forEach((p, i) => { plotIdMap[p.node_id] = `np_${i}`; });

  ctx.plots_generated = { plots, plot_id_map: plotIdMap };

  await structureValidationL3(ctx, llm);
}
