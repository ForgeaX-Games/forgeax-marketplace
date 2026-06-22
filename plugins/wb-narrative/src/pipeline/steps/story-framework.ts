import type { NarrativeContext, StoryFramework, FrameworkNode, InitialOutline } from "../../types/index.js";
import { deviationFromLegacy } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { extractJSON } from "../llm-client.js";
import { getNodeFilter } from "../node-merge.js";
import { appendUserInstructions } from "./design-context-helper.js";
import { buildCharacterDigest, buildItemDigest } from "./context-helpers.js";
import { composeSystemPrompt, type PromptComposer } from "../prompt-composer.js";
import {
  repairIntraGroupConnections,
  filterCrossBranchConnections,
  fixDanglingBranches,
  fixNvNRouting,
  ensureBidirectionalConsistency,
  fullValidation,
} from "../../utils/connection-repair.js";
import {
  getEntropy,
  getLayerEntropy,
  getNodeBudget,
  buildBranchPromptSection,
  buildDeviationPrompt,
  buildNodeCountPromptSection,
  type LayerBranchStats,
} from "../layer-threshold-config.js";

interface TempNode {
  node_id: string;
  parent_id: string;
  prev_node: string[];
  next_node: string[];
  sequence_index: number;
  is_branch: boolean;
}

/**
 * L0 orphan repair: reconnect fully disconnected branch nodes (e.g. "5c")
 * by tracing sibling parent chains to the fork ancestor.
 */
/** 将结构化 InitialOutline 转为适合 LLM 上下文或关键词检测的文本 */
function outlineToText(outline: InitialOutline | undefined): string {
  if (!outline) return "（无）";
  const dev = outline.story_structure.development.join("\n");
  return [
    outline.theme ? `主题：${outline.theme}` : "",
    outline.background ? `背景：${outline.background}` : "",
    outline.main_conflict ? `主线冲突：${outline.main_conflict}` : "",
    outline.character_arc ? `角色弧光：${outline.character_arc}` : "",
    outline.story_structure.opening ? `开端：${outline.story_structure.opening}` : "",
    dev ? `中段：\n${dev}` : "",
    outline.story_structure.ending ? `结局：${outline.story_structure.ending}` : "",
    outline.key_plot_points.length > 0
      ? `关键节点：\n${outline.key_plot_points.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n");
}

function repairOrphanBranchAtL0(nodes: TempNode[]): TempNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.node_id, n]));
  const orphans = nodes.filter(
    (n) => n.prev_node.length === 0 && n.next_node.length === 0 && n.sequence_index > 0,
  );

  for (const orphan of orphans) {
    const m = orphan.node_id.match(/^(\d+)([a-z]+)$/);
    if (!m) continue;
    const numericPart = m[1];

    const siblings = nodes.filter(
      (n) =>
        n.node_id !== orphan.node_id &&
        new RegExp(`^${numericPart}[a-z]+$`).test(n.node_id) &&
        n.prev_node.length > 0,
    );
    if (!siblings.length) continue;

    const visited = new Set<string>();
    let forkId: string | null = null;
    const queue = siblings.flatMap((s) => s.prev_node);
    while (queue.length && !forkId) {
      const pid = queue.shift()!;
      if (visited.has(pid)) continue;
      visited.add(pid);
      const parent = nodeMap.get(pid);
      if (!parent) continue;
      if (parent.next_node.length > 1) {
        forkId = pid;
      } else {
        queue.push(...parent.prev_node);
      }
    }

    const targetId = forkId ?? siblings[0]?.prev_node[0];
    if (!targetId) continue;
    const target = nodeMap.get(targetId);
    if (!target) continue;

    if (!target.next_node.includes(orphan.node_id)) target.next_node.push(orphan.node_id);
    if (!orphan.prev_node.includes(targetId)) orphan.prev_node.push(targetId);
    console.log(`[L0] 孤立修复: ${targetId} → ${orphan.node_id}`);
  }

  return nodes;
}

const STEP1_SYSTEM = `你是一位故事结构规划专家。根据用户需求规划故事的框架结构。所有输出使用中文。

你需要决定：
1. 总节点数（根据复杂度指示确定，宜精不宜多）
2. 是否有分支——好的故事通常有分支（命运选择/多线并行/路线分歧等）
3. 每个节点的阶段类型和叙事功能

## node_id 编码规则（Detroit 风格，必须严格遵守）
- 主线节点用纯数字递增: "1", "2", "3", "4"
- 分支节点在分叉位置加字母后缀: "3a"(分支A), "3b"(分支B)
- 分支后的合并节点恢复纯数字: "4"(合并点)
- 分支节点共享同一数字前缀，用字母区分

## 示例1：线性结构（4节点）
"1" → "2" → "3" → "4"

## 示例2：钻石分支（5节点）
"1" → "2" → "3a"(路线A) → "4"(合并)
              └→ "3b"(路线B) ─┘

## 示例3：分叉不合并（6节点）
"1" → "2" → "3a" → "4a"(结局A)
              └→ "3b" → "4b"(结局B)

输出JSON格式:
{
  "total_nodes": 5,
  "has_branch": true,
  "nodes": [
    { "node_id": "1", "stage_name": "开端", "stage_type": "opening", "narrative_function": "引入故事", "is_branch": false, "next_nodes": ["2"] },
    { "node_id": "2", "stage_name": "发展", "stage_type": "rising", "narrative_function": "冲突升级", "is_branch": false, "next_nodes": ["3a", "3b"] },
    { "node_id": "3a", "stage_name": "路线A", "stage_type": "climax", "narrative_function": "光明路线", "is_branch": true, "next_nodes": ["4"] },
    { "node_id": "3b", "stage_name": "路线B", "stage_type": "climax", "narrative_function": "黑暗路线", "is_branch": true, "next_nodes": ["4"] },
    { "node_id": "4", "stage_name": "结局", "stage_type": "resolution", "narrative_function": "命运汇聚", "is_branch": false, "next_nodes": [] }
  ],
  "branch_groups": [{ "branch_at": "2", "branches": ["3a", "3b"], "merge_at": "4" }],
  "reason": "选择此结构的原因"
}

⚠️ 关键：每个节点必须包含 next_nodes 数组，明确声明其后继节点。这是最终拓扑的权威来源。
分支节点的 next_nodes 可以不同（各自通往不同结局），也可以相同（合并到同一节点）。
结局节点 next_nodes 为空数组。`;

const STEP2_SYSTEM = `你是专业的叙事架构师。根据用户需求和框架结构骨架，完善故事框架设计。所有输出必须使用中文。

🚨 **最重要的约束**：
1. 必须基于初步故事大纲来设计框架，不要创造新故事！
2. 必须使用用户提供的角色、世界观、情节！
3. 必须遵循系统生成的框架结构骨架！

**核心设计原则**：
- **命运必然论**：L0框架层预设所有可能的命运分支和结局走向
- **有限突变论**：偏差值控制"反套路"程度

**输出要求**：
- 输出JSON对象
- node_contents: 与骨架中的节点一一对应的数组
- 每个节点必须包含: node_id, name, narrative_function, main_content
- main_content每个节点不少于200字

## 开端节点（stage_type === "opening"）特殊要求

开端节点的 main_content 必须在动作/紧张氛围中自然嵌入以下信息（融入场景，不要独立段落平铺）：
1. **角色个性碎片**：至少一个角色通过口头禅、习惯动作或独特反应展示其不可替代的性格
2. **Flag式对话/期待**：至少一个角色表达对未来的具体期待或承诺（如"干完这票就XX"），这是后续 callback 的种子
3. **差异化危机反应**：不同性格的角色面对同一个危机做出不同的选择和反应，体现各自的独立动机
4. **反派悬念**：如果涉及反派叛变/出场，必须留下至少一个未解释的异常细节（一个犹豫、一句奇怪的话、一个反常行为），为后续揭示埋下悬念`;

const STORY_FRAMEWORK_PLAN_COMPOSER: PromptComposer = {
  stepId: "story_framework",
  skillSlots: ["style_guide", "examples", "constraints"],
  systemBlockOrder: ["base", "style_guide", "examples", "constraints"],
  userBlockOrder: [],
  blocks: {
    base: STEP1_SYSTEM,
    style_guide: "{{SKILL.style_guide}}",
    examples: "{{SKILL.examples}}",
    constraints: "{{SKILL.constraints}}",
  },
};

const STORY_FRAMEWORK_FILL_COMPOSER: PromptComposer = {
  stepId: "story_framework",
  skillSlots: ["style_guide", "examples", "constraints"],
  systemBlockOrder: ["base", "style_guide", "examples", "constraints"],
  userBlockOrder: [],
  blocks: {
    base: STEP2_SYSTEM,
    style_guide: "{{SKILL.style_guide}}",
    examples: "{{SKILL.examples}}",
    constraints: "{{SKILL.constraints}}",
  },
};

interface EndingRequirement {
  required: boolean;
  count: number;
  types: string[];
  hint: string;
}

interface MultiThreadRequirement {
  required: boolean;
  threadHint: string;
}

interface StructureRequirements {
  endings: EndingRequirement;
  multiThread: MultiThreadRequirement;
  combined: string;
}

/**
 * 检测用户输入中对结构的明确需求：多结局、多线并行、多开局等。
 * 返回统一的 StructureRequirements，combined 为合并后的 prompt 约束段。
 */
function detectStructureRequirements(userInput: string, outline: string): StructureRequirements {
  const combined = `${userInput}\n${outline}`;

  // ── 多结局检测 ──
  const endingTypes: string[] = [];
  if (/(?:^|[^A-Za-z])HE(?=[^A-Za-z]|$)/i.test(combined) || /好结局|光明结局|圆满/i.test(combined)) endingTypes.push("HE(好结局)");
  if (/(?:^|[^A-Za-z])BE(?=[^A-Za-z]|$)/i.test(combined) || /坏结局|悲剧|黑暗结局/i.test(combined)) endingTypes.push("BE(坏结局)");
  if (/(?:^|[^A-Za-z])OE(?=[^A-Za-z]|$)/i.test(combined) || /开放结局|未定结局/i.test(combined)) endingTypes.push("OE(开放结局)");

  const multiEndingKw = /多(种|个|线|路线)?结局|分支结局|不同结局|多ending/i;
  const explicitCount = combined.match(/(\d+)\s*[种个条]?\s*结局/);

  let endings: EndingRequirement;
  if (endingTypes.length >= 2) {
    endings = { required: true, count: endingTypes.length, types: endingTypes, hint: `用户明确要求 ${endingTypes.join("、")} 共 ${endingTypes.length} 种结局` };
  } else if (explicitCount) {
    const cnt = parseInt(explicitCount[1]);
    endings = { required: true, count: Math.max(cnt, 2), types: endingTypes, hint: `用户要求 ${cnt} 种结局` };
  } else if (multiEndingKw.test(combined)) {
    endings = { required: true, count: 2, types: endingTypes, hint: "用户要求多结局" };
  } else {
    endings = { required: false, count: 0, types: [], hint: "" };
  }

  // ── 多线并行 / 多开局检测 ──
  const threadPatterns = [
    { re: /双主角|双线|两条(主)?线/i, hint: "用户要求双主角/双线叙事" },
    { re: /多(条)?线(并行|交织)?|多线程/i, hint: "用户要求多线并行叙事" },
    { re: /明线.{0,4}暗线|暗线.{0,4}明线/i, hint: "用户要求明暗线交织" },
    { re: /多(个)?开局|不同起点|多(条)?开场/i, hint: "用户要求多开局/不同起点" },
    { re: /平行(叙事|故事|线)|并行(叙事|故事|线)/i, hint: "用户要求平行叙事" },
  ];

  let multiThread: MultiThreadRequirement = { required: false, threadHint: "" };
  for (const tp of threadPatterns) {
    if (tp.re.test(combined)) {
      multiThread = { required: true, threadHint: tp.hint };
      break;
    }
  }

  // ── 合并为约束提示词 ──
  const sections: string[] = [];

  if (endings.required) {
    const lines = [
      `### 多结局约束`,
      `${endings.hint}。你必须在 L0 框架中规划至少 ${endings.count} 条不同的结局分支。`,
    ];
    if (endings.types.length > 0) lines.push(`要求的结局类型: ${endings.types.join("、")}`);
    lines.push(
      `- 在主线的 climax 阶段设置分叉点，从分叉点分出 ${endings.count} 条不合并的分支线，每条线通往不同的结局`,
      `- 分支/结局节点使用字母后缀: 如分叉在节点 "4"，则结局为 "5a"(HE), "5b"(BE), "5c"(OE)`,
      `- branch_groups 的 merge_at 设为 null（分支不合并，代表不同命运终点）`,
    );
    sections.push(lines.join("\n"));
  }

  if (multiThread.required) {
    sections.push([
      `### 多线/并行叙事约束`,
      `${multiThread.threadHint}。你应在 L0 框架中体现多线/并行结构。`,
      `- 可在开局/发展阶段设置分叉点，分出并行叙事线`,
      `- 并行线可在后续合并（钻石结构）或各自通往不同结局`,
      `- 使用字母后缀区分并行线: 如 "2a"(明线), "2b"(暗线)`,
    ].join("\n"));
  }

  let combinedText = "";
  if (sections.length > 0) {
    combinedText = `\n## 🚨 用户结构需求（必须遵守）\n${sections.join("\n\n")}\n\n所有分支/结局/并行线节点均包含在 L0 节点预算内，无需额外担心超限。\n`;
  }

  return { endings, multiThread, combined: combinedText };
}

function buildStep1Prompt(ctx: NarrativeContext): string {
  const gcp = ctx.global_control_params;
  const complexity = gcp?.complexity ?? 2;
  const entropy = getEntropy(complexity);
  const l0Ctrl = gcp?.layer_controls?.layer_0;
  const layerEntropy = getLayerEntropy(entropy, 0, l0Ctrl);
  const deviation = deviationFromLegacy(gcp);

  const branchSection = buildBranchPromptSection(0, complexity, layerEntropy);
  const deviationSection = buildDeviationPrompt(deviation);
  const nodeCountSection = buildNodeCountPromptSection(0, layerEntropy, l0Ctrl?.min_nodes, l0Ctrl?.max_nodes, complexity);

  const budget = getNodeBudget(complexity);
  const l1Desc = budget.l1_per_min === 1 && budget.l1_per_max === 1
    ? "不扩展（继承L0）"
    : `${budget.l1_per_min}~${budget.l1_per_max} 个子节点`;
  const l2Desc = budget.l2_per_min === 1 && budget.l2_per_max === 1
    ? "不扩展（继承L1）"
    : `${budget.l2_per_min}~${budget.l2_per_max} 个子节点`;

  const budgetHint = `## 总节点预算（全管线最终叶节点: ${budget.total_label}）
- L0 框架总节点（含分支/结局/并行线）: ${budget.l0_min}~${budget.l0_max} 个
- L1 每个L0扩展: ${l1Desc}
- L2 每个L1扩展: ${l2Desc}

⚠️ 节点预算平衡原则：
- L0 的分支/结局/并行线等结构节点包含在 ${budget.l0_max} 上限内
- 若 L0 使用了较多结构节点，下游 L1/L2 会自动在较低端扩展以平衡总量
- 总量目标 ${budget.total_label} 是最终约束，L0 结构由你根据用户需求自由组织`;

  const structReq = detectStructureRequirements(ctx.user_input ?? "", outlineToText(ctx.initial_story_outline));

  return `## 用户需求
${ctx.user_input}

## 初步大纲（参考）
${outlineToText(ctx.initial_story_outline)}

## 叙事控制（复杂度=${complexity}级）

${budgetHint}
${structReq.combined}
${nodeCountSection}

${branchSection}

${deviationSection}

## 框架结构类型参考
根据叙事熵和故事特性，可选择以下结构类型（仅作参考，非必须）：
- linear — 线性单线叙事，适合低熵/简单故事
- dual_climax — 双高潮结构，中段双线交汇
- multi_thread — 多线程并行，适合高熵/复杂叙事
- nested — 嵌套结构，故事套故事
- spiral — 螺旋递进，不断回溯深化

node_id 必须严格遵守 Detroit 编码规则（分支用字母后缀）。`;
}

function buildStep2Prompt(
  ctx: NarrativeContext,
  skeleton: unknown,
  connections: Map<string, { prev: string[]; next: string[] }>,
): string {
  const connSummary = Array.from(connections.entries())
    .map(([id, c]) => `${c.prev.join(",") || "(入口)"} → [${id}] → ${c.next.join(",") || "(出口)"}`)
    .join("\n");

  return `## 用户原始需求⭐
${ctx.user_input}

## 初步故事大纲
${outlineToText(ctx.initial_story_outline)}

## 世界观设定
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 角色档案摘要
${buildCharacterDigest(ctx.detailed_character_sheets ?? [])}

## 道具清单
${buildItemDigest(ctx.item_database ?? [])}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {})}

## 核心设定约束
- 世界名称：${ctx.core_settings?.world_name ?? ""}
- 主角：${ctx.core_settings?.protagonist?.name ?? ""}

## 框架结构骨架（由Step1规划生成）
${JSON.stringify(skeleton, null, 2)}

## 已验证的拓扑连接（Step 1.5 结构修复后）
${connSummary}

## 任务
请为骨架中的每个节点填充创意内容。内容填充须严格遵循上方拓扑连接关系，确保叙事流转与分支逻辑一致。
输出格式（JSON）：
{
  "node_contents": [
    { "node_id": "1", "name": "章节名", "narrative_function": "叙事功能描述", "main_content": "200字以上详细内容..." }
  ]
}`;
}

// ── 从 LLM 输出构建正确的 prev_node/next_node 连接 ──
// 优先使用 LLM 显式输出的 next_nodes，回退到 Detroit 编码推断
function buildFrameworkConnections(
  skeletonNodes: Array<Record<string, unknown>>,
  branchGroups: Array<{ branch_at: string; branches: string[]; merge_at: string }>,
): Map<string, { prev: string[]; next: string[] }> {
  const conns = new Map<string, { prev: string[]; next: string[] }>();
  const nodeIds = skeletonNodes.map((n) => String(n.node_id));
  const nodeIdSet = new Set(nodeIds);

  for (const id of nodeIds) {
    conns.set(id, { prev: [], next: [] });
  }

  // Check if LLM provided explicit next_nodes
  const hasExplicitEdges = skeletonNodes.some(
    (n) => Array.isArray(n.next_nodes) && (n.next_nodes as string[]).length > 0,
  );

  if (hasExplicitEdges) {
    // Use LLM-provided next_nodes as authoritative topology
    for (const node of skeletonNodes) {
      const id = String(node.node_id);
      const nextArr = (Array.isArray(node.next_nodes) ? node.next_nodes : []) as string[];
      for (const nxt of nextArr) {
        const nxtStr = String(nxt);
        if (nodeIdSet.has(nxtStr)) {
          conns.get(id)!.next.push(nxtStr);
          conns.get(nxtStr)!.prev.push(id);
        }
      }
    }
  } else {
    // Fallback: infer from Detroit encoding + branch_groups
    const branchAtSet = new Set<string>();
    const branchChildSet = new Set<string>();
    const mergeAtSet = new Set<string>();
    const branchMap = new Map<string, string[]>();
    const mergeMap = new Map<string, string[]>();

    for (const bg of branchGroups) {
      branchAtSet.add(bg.branch_at);
      mergeAtSet.add(bg.merge_at);
      branchMap.set(bg.branch_at, bg.branches);
      mergeMap.set(bg.merge_at, bg.branches);
      for (const b of bg.branches) branchChildSet.add(b);
    }

    function numPrefix(id: string): number {
      const m = id.match(/^(\d+)/);
      return m ? parseInt(m[1]) : 0;
    }

    const sortedIds = [...nodeIds].sort((a, b) => numPrefix(a) - numPrefix(b));
    const mainLine = sortedIds.filter((id) => !branchChildSet.has(id));

    for (let i = 1; i < mainLine.length; i++) {
      const prev = mainLine[i - 1];
      const curr = mainLine[i];

      if (branchAtSet.has(prev)) {
        const branches = branchMap.get(prev) ?? [];
        for (const b of branches) {
          if (conns.has(b)) {
            conns.get(prev)!.next.push(b);
            conns.get(b)!.prev.push(prev);
          }
        }
      }

      if (mergeAtSet.has(curr)) {
        const merging = mergeMap.get(curr) ?? [];
        for (const b of merging) {
          if (conns.has(b)) {
            conns.get(b)!.next.push(curr);
            conns.get(curr)!.prev.push(b);
          }
        }
      }

      if (!branchAtSet.has(prev) && !mergeAtSet.has(curr)) {
        conns.get(prev)!.next.push(curr);
        conns.get(curr)!.prev.push(prev);
      }
    }
  }

  // Deduplicate
  for (const [, c] of conns) {
    c.prev = [...new Set(c.prev)];
    c.next = [...new Set(c.next)];
  }

  // Orphan detection: warn about non-root nodes with no prev
  const rootId = nodeIds[0];
  for (const id of nodeIds) {
    if (id !== rootId && conns.get(id)!.prev.length === 0) {
      console.warn(`[StoryFramework] Orphan node detected: ${id} has no incoming edges`);
    }
  }

  return conns;
}

export async function storyFramework(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const nodeFilter = getNodeFilter(ctx);

  // Node-level regeneration: only re-run content fill for filtered nodes,
  // preserving all structural topology. The pipeline's mergeNodesBack will
  // combine preserved + new nodes after this function returns.
  if (nodeFilter && ctx.story_framework?.framework?.nodes) {
    const existingNodes = ctx.story_framework.framework.nodes;
    const targetNodes = existingNodes.filter(n => nodeFilter.has(n.node_id));
    if (targetNodes.length === 0) return;

    const skeleton = {
      nodes: targetNodes.map(n => ({
        node_id: n.node_id,
        stage_type: n.stage_type ?? "rising",
        is_branch: n.is_branch ?? false,
        stage_name: n.name,
        narrative_function: n.narrative_function,
      })),
      has_branch: targetNodes.some(n => n.is_branch),
    };
    const connections = new Map<string, { prev: string[]; next: string[] }>();
    for (const n of targetNodes) {
      connections.set(n.node_id, { prev: n.prev_node ?? [], next: n.next_node ?? [] });
    }

    const step2Raw = await llm.callWithRetry(
      composeSystemPrompt(STORY_FRAMEWORK_FILL_COMPOSER, ctx),
      buildStep2Prompt(ctx, skeleton, connections),
      { responseFormat: "json" },
      (r) => {
        const p = extractJSON<Record<string, unknown>>(r);
        if (!Array.isArray(p.node_contents) || p.node_contents.length === 0)
          throw new Error("node_contents必须是非空数组");
      },
    );
    const content = extractJSON<{ node_contents: Array<Record<string, unknown>> }>(step2Raw);

    const regenNodes: FrameworkNode[] = targetNodes.map((orig, i) => {
      const fill = content.node_contents.find(c => String(c.node_id) === orig.node_id)
        ?? content.node_contents[i] ?? {};
      return {
        ...orig,
        name: String(fill.name ?? orig.name),
        narrative_function: String(fill.narrative_function ?? orig.narrative_function),
        main_content: String(fill.main_content ?? orig.main_content),
      };
    });

    ctx.story_framework = {
      framework: { nodes: regenNodes },
      dynamic_structure: {
        structure_type: ctx.story_framework.dynamic_structure?.structure_type ?? "linear",
        framework_nodes: regenNodes,
        branch_groups: ctx.story_framework.dynamic_structure?.branch_groups ?? [],
      },
    };
    return;
  }

  // 检测结构需求（多结局/多线），用于输出验证
  const structReq = detectStructureRequirements(ctx.user_input ?? "", outlineToText(ctx.initial_story_outline));

  // Step 1: 结构规划
  const step1Raw = await llm.callWithRetry(
    composeSystemPrompt(STORY_FRAMEWORK_PLAN_COMPOSER, ctx),
    appendUserInstructions(buildStep1Prompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<Record<string, unknown>>(r);
      if (!Array.isArray(p.nodes) || p.nodes.length === 0)
        throw new Error("nodes必须是非空数组");
      if (structReq.endings.required) {
        const nodes = p.nodes as Array<Record<string, unknown>>;
        const branchNodes = nodes.filter((n) => n.is_branch === true);
        const terminalNodes = nodes.filter((n) => {
          const next = n.next_nodes ?? n.next_node;
          return Array.isArray(next) && (next as unknown[]).length === 0;
        });
        const endingCount = Math.max(branchNodes.length, terminalNodes.length);
        if (endingCount < structReq.endings.count) {
          throw new Error(
            `用户要求 ${structReq.endings.count} 种结局，但仅检测到 ${endingCount} 个结局/分支节点。请重新生成包含 ${structReq.endings.count} 条独立结局分支的框架。`,
          );
        }
      }
    },
  );

  const skeleton = extractJSON<{
    total_nodes: number;
    has_branch: boolean;
    nodes: Array<Record<string, unknown>>;
    branch_groups?: Array<{ branch_at: string; branches: string[]; merge_at: string }>;
  }>(step1Raw);

  // L0 总量截断：l0_max 是总节点上限（含分支），超标时结构感知裁剪
  const l0Budget = getNodeBudget(ctx.global_control_params?.complexity ?? 2);
  if (skeleton.nodes.length > l0Budget.l0_max) {
    console.warn(
      `[StoryFramework] L0 total ${skeleton.nodes.length} exceeds budget max ${l0Budget.l0_max}, truncating`,
    );

    const branchNodeIds = new Set<string>();
    for (const bg of (skeleton.branch_groups ?? []) as Array<{ branches: string[] }>) {
      for (const b of bg.branches) branchNodeIds.add(b);
    }
    for (const n of skeleton.nodes) {
      if (n.is_branch) branchNodeIds.add(String(n.node_id));
    }

    const trunkNodes = skeleton.nodes.filter((n) => !branchNodeIds.has(String(n.node_id)));
    const maxTrunk = Math.max(2, l0Budget.l0_max - branchNodeIds.size);

    if (trunkNodes.length > maxTrunk) {
      const keepTrunkIds = new Set(trunkNodes.slice(0, maxTrunk).map((n) => String(n.node_id)));
      skeleton.nodes = skeleton.nodes.filter(
        (n) => keepTrunkIds.has(String(n.node_id)) || branchNodeIds.has(String(n.node_id)),
      );
    }

    if (skeleton.nodes.length > l0Budget.l0_max) {
      skeleton.nodes = skeleton.nodes.slice(0, l0Budget.l0_max);
    }
  }

  // Step 1.5: 结构修复 — 先构建连接，再验证拓扑完整性
  const branchGroups = (skeleton.branch_groups ?? []) as Array<{
    branch_at: string;
    branches: string[];
    merge_at: string;
  }>;
  const connections = buildFrameworkConnections(skeleton.nodes, branchGroups);

  let tempNodes = skeleton.nodes.map((skel, i) => {
    const id = String(skel.node_id);
    const conn = connections.get(id);
    return {
      node_id: id,
      parent_id: "root",
      prev_node: conn?.prev ?? [],
      next_node: conn?.next ?? [],
      sequence_index: i,
      is_branch: Boolean(skel.is_branch),
    };
  });

  // L0 修复链（跳过 inferCrossParentConnections，L0 只有一层无跨父概念）
  tempNodes = repairIntraGroupConnections(tempNodes);
  tempNodes = filterCrossBranchConnections(tempNodes);

  // L0 孤立分支修复：LLM 可能遗漏某些节点的 next_nodes 导致完全断连
  const orphanFixed = repairOrphanBranchAtL0(tempNodes);

  const { nodes: danglingFixed, logs: danglingLogs } = fixDanglingBranches(orphanFixed);
  tempNodes = fixNvNRouting(danglingFixed);
  tempNodes = ensureBidirectionalConsistency(tempNodes);
  if (danglingLogs.length > 0) {
    console.log(`[L0] 悬挂分支修复: ${danglingLogs.length} 项`);
    for (const log of danglingLogs.slice(0, 10)) console.log(`  ${log}`);
  }

  // 回写修复后的连接到 connections map
  for (const tn of tempNodes) {
    const c = connections.get(tn.node_id);
    if (c) {
      c.prev = tn.prev_node;
      c.next = tn.next_node;
    }
  }

  const l0Report = fullValidation(tempNodes);
  if (l0Report.errors.length > 0) {
    console.warn("[L0] 结构验证错误:", l0Report.errors);
  }
  if (l0Report.warnings.length > 0) {
    console.warn("[L0] 结构验证警告:", l0Report.warnings);
  }

  // Step 2: 内容填充（在连接修复之后，prompt 中注入已验证的拓扑）
  const step2Raw = await llm.callWithRetry(
    composeSystemPrompt(STORY_FRAMEWORK_FILL_COMPOSER, ctx),
    buildStep2Prompt(ctx, skeleton, connections),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<Record<string, unknown>>(r);
      if (!Array.isArray(p.node_contents) || p.node_contents.length === 0)
        throw new Error("node_contents必须是非空数组");
    },
  );

  const content = extractJSON<{ node_contents: Array<Record<string, unknown>> }>(step2Raw);

  // 合并骨架 + 内容
  const nodes: FrameworkNode[] = skeleton.nodes.map((skel, i) => {
    const nodeId = String(skel.node_id);
    const fill = content.node_contents.find(
      (c) => String(c.node_id) === nodeId,
    ) ?? content.node_contents[i] ?? {};

    const conn = connections.get(nodeId);

    return {
      node_id: nodeId,
      content_id: `fw_${nodeId}`,
      name: String(fill.name ?? skel.stage_name ?? `节点${nodeId}`),
      narrative_function: String(fill.narrative_function ?? skel.narrative_function ?? ""),
      main_content: String(fill.main_content ?? ""),
      stage_type: String(skel.stage_type ?? "rising"),
      is_branch: Boolean(skel.is_branch),
      sequence_index: i,
      prev_node: conn?.prev ?? [],
      next_node: conn?.next ?? [],
    };
  });

  ctx.story_framework = {
    framework: { nodes },
    dynamic_structure: {
      structure_type: skeleton.has_branch ? "branching" : "linear",
      framework_nodes: nodes,
      branch_groups: branchGroups,
    },
  };

  // record actual L0 branch stats for downstream prompts
  const branchNodeCount = nodes.filter((n) => n.is_branch).length;
  const totalNodes = nodes.length;
  const grossRatio = totalNodes > 0 ? branchNodeCount / totalNodes : 0;
  const mergedCount = branchGroups
    .filter((bg) => bg.merge_at)
    .reduce((s, bg) => s + bg.branches.length, 0);
  const netBranch = branchNodeCount - mergedCount;
  const l0Stats: LayerBranchStats = {
    layer: 0,
    totalNodes,
    branchNodes: branchNodeCount,
    grossRatio,
    mergedCount: Math.max(0, mergedCount),
    netRatio: totalNodes > 0 ? Math.max(0, netBranch) / totalNodes : 0,
  };
  (ctx as Record<string, unknown>)._l0_branch_stats = l0Stats;
}
