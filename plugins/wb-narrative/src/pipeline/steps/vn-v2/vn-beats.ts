/**
 * E1-04：情节点搭建（线性，未分支）
 * ─────────────────────────────────────────────────────────────────
 * 与 MyFile/提示词/影游叙事生成提示词/04_情节点搭建.md 对齐。
 *
 * 输入：ctx.vn_scenes
 * 输出：ctx.vn_beats = { beats: [...] }
 *
 * 此阶段为每个场细化为线性情节点序列，尚未引入分支与多结局
 * （那是 G-01 剧情树改造的职责）。
 *
 * 编号规则：beat_id = "<场号>.<场内序号>"，例如 "1.1", "1.2", "2.1"。
 */
import type { NarrativeContext, VnBeats } from "../../../types/index.js";
import type { LLMClient } from "../../llm-client.js";
import { extractJSON } from "../../llm-client.js";
import { appendUserInstructions } from "../design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../../prompt-composer.js";
import { FIVE_ELEMENT_NOTE, NUMBERING_NOTE, getStreamEmit, getVnBudget } from "./_shared.js";

const VN_BEATS_COMPOSER: PromptComposer = {
  stepId: "vn_beats",
  skillSlots: ["style_guide", "constraints"],
  systemBlockOrder: ["role", "task", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    role: `你是互动影游剧作师。基于已切分的"场"，为每场细化出若干"情节点"。你产出的这条线性序列是整部影游的「黄金线（理想线）」——角色对世界每一次考验都做出"最理想作答"时走过的那一条路。它是下游 G-01 长出整棵剧情树的**脊**，本身要干净、紧凑、因果连贯。`,

    task: (ctx: NarrativeContext) => `## 任务
- 每场 ${getVnBudget(ctx).beatsPerScene[0]}-${getVnBudget(ctx).beatsPerScene[1]} 个情节点（复杂度档位「${getVnBudget(ctx).label}」决定；至少 ${getVnBudget(ctx).beatsPerScene[0]} 个，复杂场可至 ${getVnBudget(ctx).beatsPerScene[1]} 个）
- 情节点是"剧情推进的最小单元"：一个情境 + 一个动作 + 一个明确变化
- 这是「黄金线」：只写"理想作答"的那一条单路，**保持线性、不引入任何分支**（答错/答偏的分支、挣扎、多结局全部由 G-01 剧情树改造在你这条脊上长出）
- 因为是脊不是全部，**宁可紧凑**：每个情节点都要是后续可能"被世界出题考验"的节点，不要灌水；下游会在这些点上插决策、派生分支
- 情节点之间的衔接必须自然，可被读者一口气读完

## 编号规则（严格遵守）
- beat_id = "<场号>.<场内序号>"
- 场内序号从 1 开始递增（1.1 / 1.2 / 1.3...）
- 不同场之间的情节点编号不复用（场 1 有 1.1 1.2 1.3，场 2 从 2.1 起）

${NUMBERING_NOTE}

## 内容写作
${FIVE_ELEMENT_NOTE}
- 每个情节点 50-100 字
- 必须显化"该情节点的剧情净增量"（之前不知道什么、现在知道了什么；之前不会做什么、现在做了什么）`,

    output_format: `## 输出格式（严格 JSON）
{
  "beats": [
    { "beat_id": "1.1", "scene_id": "1", "content": "约 50-100 字" },
    { "beat_id": "1.2", "scene_id": "1", "content": "..." }
  ]
}`,

    context_inputs: (ctx: NarrativeContext): string => {
      if (!ctx.vn_scenes) throw new Error("vn_beats 需要 ctx.vn_scenes（E1-03 未完成）");
      const scenes = ctx.vn_scenes.scenes
        .map((s) => `### 场 ${s.scene_id}（第${s.act_id}幕，${s.location_name}/${s.time_of_day}/${s.indoor_outdoor}）\n${s.content}`)
        .join("\n\n");
      const logline = ctx.vn_logline
        ? `「${ctx.vn_logline.title}」${ctx.vn_logline.content}`
        : "（无）";
      const acts = ctx.vn_outline_acts
        ? ctx.vn_outline_acts.acts.map((a) => `- ${a.act_id}（${a.act_name}）：${a.content.slice(0, 120)}…`).join("\n")
        : "（无）";
      const chars = ctx.vn_character_bios?.characters
        ?.map((c) => `- ${c.name}（${c.role}）：${c.identity ?? ""}；外驱=${c.external_motivation ?? "?"}；内驱=${c.internal_motivation ?? "?"}`)
        .join("\n") ?? "（无）";
      return `## 已搭建的场（必需 — 主输入）
${scenes}

## 参考：一句话梗概（保持总命题一致）
${logline}

## 参考：三幕骨架（情节点节奏须服从所属幕的字数比 150/300/150）
${acts}

## 参考：人物小传（情节点中出场角色的语气与动机由此决定）
${chars}

## 参考：用户原始需求
${ctx.user_input}`;
    },

    task_instruction: `## 任务
为每个场细化出线性情节点序列。情节点的人物动机与对白节奏须与人物小传一致；情节点的剧情净增量须服从所属幕的功能（建置 / 对抗 / 解决）。`,
  },
};

function validate(beats: VnBeats): void {
  if (!Array.isArray(beats?.beats) || beats.beats.length === 0) {
    throw new Error("beats 不能为空");
  }
  const seen = new Set<string>();
  beats.beats.forEach((b, idx) => {
    if (!/^\d+\.\d+$/.test(b.beat_id)) {
      throw new Error(`beats[${idx}].beat_id 必须为 "<数字>.<数字>" 格式：${b.beat_id}`);
    }
    if (seen.has(b.beat_id)) throw new Error(`beat_id 重复：${b.beat_id}`);
    seen.add(b.beat_id);
    const [sceneNum] = b.beat_id.split(".");
    if (sceneNum !== b.scene_id) {
      throw new Error(`beats[${idx}].beat_id 的场号(${sceneNum}) 与 scene_id(${b.scene_id}) 不一致`);
    }
    if (!b.content?.trim()) throw new Error(`beats[${idx}].content 不能为空`);
  });
}

export async function vnBeats(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const streamEmit = getStreamEmit(ctx);

  const raw = await llm.callWithRetry(
    composeSystemPrompt(VN_BEATS_COMPOSER, ctx),
    appendUserInstructions(composeUserPrompt(VN_BEATS_COMPOSER, ctx), ctx),
    { temperature: 0.7, responseFormat: "json" },
    (r) => validate(extractJSON<VnBeats>(r)),
    streamEmit,
  );

  ctx.vn_beats = extractJSON<VnBeats>(raw);
}
