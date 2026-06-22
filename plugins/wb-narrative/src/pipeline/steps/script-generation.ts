/**
 * L4 剧本生成（ScriptProcessor）
 *
 * 设计哲学（继承自 v3）：
 * - 情节→专业级 JRPG 剧本（冲突推动 + 角色弧光 + 游戏交互）
 * - 7 种 content 类型：stage_direction/narration/dialogue/inner_monologue/
 *   player_action/system_message/branch_point
 * - 5 种章节类型：opening/rising/climax/falling/resolution
 * - 拓扑分层执行（分支并行 + 主干顺序）：
 *   同层节点并行，层间顺序，通过滑动窗口传递前驱实际内容摘要
 * - 增强上下文：L2 风格指引（dialogue_hint 等）、用户原始需求
 */
import type { NarrativeContext, PlotNode, ScriptChapter, JrpgScript } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { extractJSON } from "../llm-client.js";
import { validateTripleConstraints } from "../../utils/constraint-validator.js";
import { buildDesignContextSnippet, appendUserInstructions } from "./design-context-helper.js";
import { composeSystemPrompt, type PromptComposer } from "../prompt-composer.js";
import { getNodeFilter } from "../node-merge.js";
import {
  buildSlidingWindowSummary,
  topologicalLayers,
} from "./context-helpers.js";

const VALID_CONTENT_TYPES = new Set([
  "stage_direction", "narration", "dialogue", "inner_monologue",
  "player_action", "system_message", "branch_point",
]);
const VALID_CHAPTER_TYPES = new Set(["opening", "rising", "climax", "falling", "resolution"]);

const SYSTEM_PROMPT = `你是游戏剧本设计师，请将情节节点改写为JRPG剧本章节。所有输出使用中文。

## 章节结构要求

每个章节必须包含：
1. **conflict**（冲突结构）：type, tension_level(1-10), stakes(赌注), turning_point(转折)
2. **character_arcs**（角色弧光）：character, arc_phase, emotional_shift, growth
3. **scenes**（场景列表）：每个场景含 location, atmosphere, camera_direction, bgm, content[]

## 7 种 content 类型
- stage_direction: 舞台指示（环境、动作）
- narration: 旁白叙述
- dialogue: 对话（需 speaker, emotion, action, subtext）
- inner_monologue: 角色内心独白
- player_action: 玩家操作提示
- system_message: 系统消息
- branch_point: 分支选择点

## 5 种章节类型
- opening: 开端
- rising: 发展
- climax: 高潮
- falling: 下降
- resolution: 结局

输出JSON对象：
{
  "chapter_id": "sc_节点ID",
  "plot_node_id": "原情节节点ID",
  "chapter_type": "rising",
  "title": "章节标题",
  "conflict": { "type": "...", "tension_level": 7, "stakes": "...", "turning_point": "..." },
  "character_arcs": [{ "character": "角色名", "arc_phase": "...", "emotional_shift": "...", "growth": "..." }],
  "scenes": [{
    "scene_id": "s1",
    "location": "场景地点",
    "atmosphere": "氛围",
    "camera_direction": "镜头",
    "bgm": "背景音乐",
    "content": [
      { "type": "stage_direction", "text": "舞台指示内容" },
      { "type": "dialogue", "speaker": "角色名", "text": "对话内容", "emotion": "情感", "action": "动作", "subtext": "潜台词" },
      { "type": "narration", "text": "旁白内容" }
    ]
  }]
}`;

const SCRIPT_GENERATION_COMPOSER: PromptComposer = {
  stepId: "script_generation",
  skillSlots: ["style_guide", "examples", "constraints"],
  systemBlockOrder: ["base", "style_guide", "examples", "constraints"],
  userBlockOrder: [],
  blocks: {
    base: SYSTEM_PROMPT,
    style_guide: "{{SKILL.style_guide}}",
    examples: "{{SKILL.examples}}",
    constraints: "{{SKILL.constraints}}",
  },
};

function buildL2StyleHints(plot: PlotNode, ctx: NarrativeContext): string {
  const detailedOutlines = ctx.detailed_outlines_generated?.detailed_outlines ?? [];
  // L3 与 L2 是 1:1 映射（plot.node_id === L2 node_id），plot.parent_id 是 L1 ID
  const l2Node = detailedOutlines.find(n => n.node_id === plot.node_id);
  if (!l2Node) return "";
  const se = l2Node.story_elements;
  const lines = [
    `- 对白风格: ${se.dialogue_hint ?? "（无）"}`,
    `- 独白方向: ${se.monologue_hint ?? "（无）"}`,
    `- 旁白语气: ${se.narration_hint ?? "（无）"}`,
    `- 氛围: ${se.atmosphere ?? "（无）"}`,
  ];
  return lines.join("\n");
}

function buildPromptForPlot(
  plot: PlotNode, index: number, total: number, ctx: NarrativeContext,
  prevPlots: PlotNode[], nextPlots: PlotNode[], constraintFeedback?: string,
  slidingWindowSummary?: string,
): string {
  const prevInfo = prevPlots.length > 0
    ? prevPlots.map(p =>
        `前置节点 [${p.node_id}] "${p.jrpg_elements?.scene_location ?? ""}":\n     result="${p.story_elements.plot.result}"\n     摘要: ${p.content.slice(0, 100)}${p.content.length > 100 ? "..." : ""}`
      ).join("\n- ")
    : "（无前序节点）";
  const nextInfo = nextPlots.length > 0
    ? nextPlots.map(n =>
        `后续节点 [${n.node_id}] "${n.jrpg_elements?.scene_location ?? ""}":\n     cause="${n.story_elements.plot.cause}"\n     摘要: ${n.content.slice(0, 100)}${n.content.length > 100 ? "..." : ""}`
      ).join("\n- ")
    : "（无后续节点）";

  const l2Hints = buildL2StyleHints(plot, ctx);

  let prompt = `## 用户原始需求
${ctx.user_input}

## 情节节点（需改写为剧本章节）
${JSON.stringify(plot, null, 2)}

## 边界校验上下文
- ${prevInfo}
- ${nextInfo}
${l2Hints ? `\n## L2 风格指引\n${l2Hints}` : ""}

## 角色档案
${JSON.stringify(ctx.detailed_character_sheets ?? [], null, 2)}

## 全局调控参数
${JSON.stringify(ctx.global_control_params ?? {})}

## 世界观设定
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}
${slidingWindowSummary ? `\n## 前一节点实际生成摘要（保持叙事连贯）\n${slidingWindowSummary}` : ""}

## 进度
第 ${index + 1}/${total} 个情节节点

请输出此节点对应的剧本章节JSON。chapter_id 请用 "sc_${plot.node_id}"。
${buildDesignContextSnippet(ctx)}`;

  if (constraintFeedback) {
    prompt += `\n\n## ⚠ 约束修正要求（上次生成未通过三重约束验证，请针对性修正）\n${constraintFeedback}`;
  }
  return prompt;
}

function normalizeChapter(raw: Record<string, unknown>, plot: PlotNode, index: number): ScriptChapter {
  let chapterType = String(raw.chapter_type ?? "rising");
  if (!VALID_CHAPTER_TYPES.has(chapterType)) chapterType = "rising";

  const conflict = (raw.conflict ?? {}) as Record<string, unknown>;
  const scenes = Array.isArray(raw.scenes) ? raw.scenes : [];

  return {
    chapter_id: `sc_${plot.node_id}`,
    node_id: plot.node_id,
    plot_node_id: plot.node_id,
    chapter_type: chapterType as ScriptChapter["chapter_type"],
    title: String(raw.title ?? plot.jrpg_elements?.scene_location ?? `第${index + 1}章`),
    conflict: {
      type: String(conflict.type ?? ""),
      tension_level: Number(conflict.tension_level ?? 5),
      stakes: String(conflict.stakes ?? ""),
      turning_point: String(conflict.turning_point ?? ""),
    },
    character_arcs: Array.isArray(raw.character_arcs)
      ? raw.character_arcs.map((a: Record<string, unknown>) => ({
          character: String(a.character ?? ""),
          arc_phase: String(a.arc_phase ?? ""),
          emotional_shift: String(a.emotional_shift ?? ""),
          growth: String(a.growth ?? ""),
        }))
      : [],
    scenes: scenes.map((s: Record<string, unknown>, si: number) => ({
      scene_id: String(s.scene_id ?? `s${si + 1}`),
      location: String(s.location ?? ""),
      atmosphere: String(s.atmosphere ?? ""),
      camera_direction: String(s.camera_direction ?? ""),
      bgm: String(s.bgm ?? ""),
      content: Array.isArray(s.content)
        ? (s.content as Array<Record<string, unknown>>).map((c) => {
            let type = String(c.type ?? "narration");
            if (!VALID_CONTENT_TYPES.has(type)) type = "narration";
            return { type: type as ScriptChapter["scenes"][number]["content"][number]["type"], speaker: c.speaker ? String(c.speaker) : undefined, text: String(c.text ?? ""), emotion: c.emotion ? String(c.emotion) : undefined, action: c.action ? String(c.action) : undefined, subtext: c.subtext ? String(c.subtext) : undefined };
          })
        : [],
    })),
    prev_node: plot.prev_node,
    next_node: plot.next_node,
    is_branch: plot.prev_node.length > 1 || plot.next_node.length > 1,
    narrative_stage: plot.narrative_stage,
  };
}

const MAX_CONSTRAINT_RETRIES = 2;

export async function processScriptNode(
  plot: PlotNode,
  index: number,
  total: number,
  ctx: NarrativeContext,
  llm: LLMClient,
  slidingWindowSummary?: string,
): Promise<ScriptChapter> {
  const plotMap = new Map((ctx.plots_generated?.plots ?? []).map(p => [p.node_id, p]));
  const prevPlots = (plot.prev_node ?? []).map(id => plotMap.get(id)).filter((p): p is PlotNode => !!p);
  const nextPlots = (plot.next_node ?? []).map(id => plotMap.get(id)).filter((p): p is PlotNode => !!p);

  const prevResults = prevPlots.map(p => p.story_elements.plot.result).filter(Boolean);
  const nextCauses = nextPlots.map(n => n.story_elements.plot.cause).filter(Boolean);

  let constraintFeedback: string | undefined;
  let chapter: ScriptChapter | undefined;

  for (let attempt = 0; attempt <= MAX_CONSTRAINT_RETRIES; attempt++) {
    const raw = await llm.callWithRetry(
      composeSystemPrompt(SCRIPT_GENERATION_COMPOSER, ctx),
      appendUserInstructions(buildPromptForPlot(plot, index, total, ctx, prevPlots, nextPlots, constraintFeedback, slidingWindowSummary), ctx),
      { responseFormat: "json" },
      (r) => {
        const p = extractJSON<Record<string, unknown>>(r);
        if (!p.scenes && !p.content) throw new Error("剧本必须包含scenes");
      },
    );

    const parsed = extractJSON<Record<string, unknown>>(raw);
    chapter = normalizeChapter(parsed, plot, index);

    const chapterText = chapter.scenes.map(s => s.content.map(c => c.text).join(" ")).join(" ");
    const tcResult = validateTripleConstraints({
      content: chapterText,
      boundary_constraints: {
        cause: plot.story_elements.plot.cause,
        result: plot.story_elements.plot.result,
      },
      scope_content: plot.content,
      prev_result: prevResults.join("；"),
      next_cause: nextCauses.join("；"),
    });

    const issues = [...tcResult.errors, ...tcResult.warnings];
    if (issues.length === 0) break;

    if (attempt < MAX_CONSTRAINT_RETRIES) {
      constraintFeedback = issues.map((msg, i) => `${i + 1}. ${msg}`).join("\n");
      console.warn(`[L4] ${plot.node_id} 三重约束未通过(第${attempt + 1}次)，触发修正重试:`, issues);
    } else {
      console.warn(`[L4] ${plot.node_id} 三重约束重试${MAX_CONSTRAINT_RETRIES}次后仍有问题:`, issues);
    }
  }

  return chapter!;
}

export async function scriptGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const allPlots = ctx.plots_generated?.plots ?? [];
  if (allPlots.length === 0) return;

  const nodeFilter = getNodeFilter(ctx);
  const plots = nodeFilter
    ? allPlots.filter(p => nodeFilter.has(p.node_id))
    : allPlots;

  const _save = (ctx as Record<string, unknown>)._saveNode as ((s: string, n: string, d: unknown) => void) | undefined;

  // 拓扑分层执行：分支并行 + 主干顺序
  const layers = topologicalLayers(plots);
  const summaryMap = new Map<string, string>();
  const chapters: ScriptChapter[] = [];
  let globalIdx = 0;

  console.log(`[L4] 拓扑分层: ${layers.length} 层, 节点分布: ${layers.map(l => l.length).join(",")}`);

  for (const layer of layers) {
    const layerResults = await Promise.all(
      layer.map(async (plot) => {
        const prevSummaries = (plot.prev_node ?? [])
          .map(id => summaryMap.get(id))
          .filter(Boolean)
          .join("\n---\n");
        const idx = globalIdx++;
        return processScriptNode(
          plot, idx, plots.length, ctx, llm,
          prevSummaries || undefined,
        );
      }),
    );

    for (const ch of layerResults) {
      chapters.push(ch);
      const chapterText = ch.scenes.map(s => s.content.map(c => c.text).join(" ")).join(" ");
      summaryMap.set(ch.plot_node_id, buildSlidingWindowSummary(chapterText));
      const nodeId = ch.chapter_id ?? ch.plot_node_id;
      if (nodeId) _save?.("script_generation", nodeId, ch);
    }
  }

  ctx.jrpg_script = {
    title: ctx.core_settings?.world_name ?? "JRPG剧本",
    chapters,
  };
}
