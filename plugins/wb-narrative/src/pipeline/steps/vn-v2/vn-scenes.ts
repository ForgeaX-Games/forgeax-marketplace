/**
 * E1-03：场搭建（三维场状态切分）
 * ─────────────────────────────────────────────────────────────────
 * 与 MyFile/提示词/影游叙事生成提示词/03_场搭建.md 对齐。
 *
 * 输入：ctx.vn_outline_acts + ctx.vn_character_bios + ctx.worldview_structure
 * 输出：ctx.vn_scenes = { scenes: [...] }
 *
 * 核心规则：场切分的唯一依据是三维状态（location_name + 日夜 + 内外）任一变化。
 * 此阶段所有场默认 is_main_line=true（支线场由 G-01 阶段在改造时新增）。
 */
import type { NarrativeContext, VnScenes, VnScene } from "../../../types/index.js";
import type { LLMClient } from "../../llm-client.js";
import { extractJSON } from "../../llm-client.js";
import { appendUserInstructions } from "../design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, IP_DNA_SLOT_BLOCK, type PromptComposer } from "../../prompt-composer.js";
import {
  FIVE_ELEMENT_NOTE,
  NUMBERING_NOTE,
  SCENE_STATE_NOTE,
  getStreamEmit,
  getVnBudget,
} from "./_shared.js";

export const VN_SCENES_COMPOSER: PromptComposer = {
  stepId: "vn_scenes",
  skillSlots: ["style_guide", "constraints"],
  systemBlockOrder: ["role", "task", "ip_dna", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    ip_dna: IP_DNA_SLOT_BLOCK,
    role: `你是互动影游剧作总监。基于三幕骨架，把每一幕分解为若干"场"。`,

    task: (ctx: NarrativeContext) => `## 任务
- 为每一幕产出 ${getVnBudget(ctx).scenesPerAct[0]}-${getVnBudget(ctx).scenesPerAct[1]} 个场（复杂度档位「${getVnBudget(ctx).label}」决定，视幕的字数与节奏密度而定）
- 场必须挂在所属幕（act_id）下
- 严格按照"三维场状态"切分：相邻两场至少有一个维度变化（location_name / time_of_day / indoor_outdoor）

${SCENE_STATE_NOTE}

${NUMBERING_NOTE}

## 内容写作（content）
${FIVE_ELEMENT_NOTE}
- 每场 80-150 字
- 必须显化"该场对推进剧情的贡献"（不要写无关于主线的纯氛围场）

## 主支线
- 本阶段所有场默认 is_main_line: true
- branch_origin_beat 留空（由 G-01 阶段在剧情树改造时回填）`,

    output_format: `## 输出格式（严格 JSON）
{
  "scenes": [
    {
      "scene_id": "1",
      "act_id": "一",
      "location_name": "雪山脚下的小镇市集",
      "time_of_day": "日",
      "indoor_outdoor": "外",
      "content": "约 80-150 字的五要素融合段落",
      "is_main_line": true
    }
  ]
}`,

    context_inputs: (ctx: NarrativeContext): string => {
      if (!ctx.vn_outline_acts) throw new Error("vn_scenes 需要 ctx.vn_outline_acts（E1-02 未完成）");
      const acts = ctx.vn_outline_acts.acts
        .map((a) => `### 第${a.act_id}幕（${a.act_name}）\n${a.content}`)
        .join("\n\n");
      const chars = ctx.vn_character_bios?.characters
        ?.map((c) => `- ${c.name}（${c.role}）：${c.identity}`)
        .join("\n") ?? "（无人物小传）";
      const wv = ctx.worldview_structure ? JSON.stringify(ctx.worldview_structure).slice(0, 1500) : "（无世界观）";
      return `## 三幕骨架（来自 E1-02）
${acts}

## 人物清单
${chars}

## 世界观（参考）
${wv}

## 用户原始需求
${ctx.user_input}`;
    },

    task_instruction: `## 任务
为三幕骨架按"三维场状态"切分场次。每个场号 = 全局递增数字（1, 2, 3...），场号一旦确定不允许重复使用。`,
  },
};

function validate(scenes: VnScenes): void {
  if (!Array.isArray(scenes?.scenes) || scenes.scenes.length === 0) {
    throw new Error("scenes 不能为空");
  }
  const seen = new Set<string>();
  let prev: VnScene | null = null;
  scenes.scenes.forEach((s, idx) => {
    if (!s.scene_id?.trim()) throw new Error(`scenes[${idx}].scene_id 不能为空`);
    if (!/^\d+$/.test(s.scene_id)) throw new Error(`scenes[${idx}].scene_id 必须为纯数字字符串：${s.scene_id}`);
    if (seen.has(s.scene_id)) throw new Error(`scenes[${idx}].scene_id 重复：${s.scene_id}`);
    seen.add(s.scene_id);
    if (!["一", "二", "三"].includes(s.act_id)) {
      throw new Error(`scenes[${idx}].act_id 非法：${s.act_id}`);
    }
    if (!s.location_name?.trim()) throw new Error(`scenes[${idx}].location_name 不能为空`);
    if (!["日", "夜"].includes(s.time_of_day)) throw new Error(`scenes[${idx}].time_of_day 必须为 "日" 或 "夜"`);
    if (!["内", "外"].includes(s.indoor_outdoor)) throw new Error(`scenes[${idx}].indoor_outdoor 必须为 "内" 或 "外"`);
    if (!s.content?.trim()) throw new Error(`scenes[${idx}].content 不能为空`);
    // 三维差异校验（相邻两场至少一维不同）
    if (prev) {
      const same =
        prev.location_name === s.location_name &&
        prev.time_of_day === s.time_of_day &&
        prev.indoor_outdoor === s.indoor_outdoor;
      if (same) {
        throw new Error(`scenes[${idx}] 与前一场三维状态完全相同，必须切分或合并：${s.scene_id}`);
      }
    }
    prev = s;
  });
}

export async function vnScenes(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const streamEmit = getStreamEmit(ctx);

  const raw = await llm.callWithRetry(
    composeSystemPrompt(VN_SCENES_COMPOSER, ctx),
    appendUserInstructions(composeUserPrompt(VN_SCENES_COMPOSER, ctx), ctx),
    { temperature: 0.7, responseFormat: "json" },
    (r) => validate(extractJSON<VnScenes>(r)),
    streamEmit,
  );

  const parsed = extractJSON<VnScenes>(raw);
  // 兜底：本阶段所有场必须 is_main_line=true
  parsed.scenes.forEach((s) => {
    if (s.is_main_line === undefined) s.is_main_line = true;
  });
  ctx.vn_scenes = parsed;
}
