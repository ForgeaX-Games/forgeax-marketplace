/**
 * E1-02 三幕扩写：单步三输出（三幕 + 人物小传 + 关键道具）
 * ─────────────────────────────────────────────────────────────────
 * 与 MyFile/提示词/影游叙事生成提示词/02_故事梗概扩写.md 对齐。
 *
 * 输入：ctx.vn_logline + ctx.user_input
 * 输出：
 *   - ctx.vn_outline_acts     = { title, central_theme, acts: [一/二/三] }
 *   - ctx.vn_character_bios   = { characters: [...] }
 *   - ctx.vn_key_items        = { items: [...] }
 *
 * 单次 LLM 调用产出三份 JSON 子结构（在同一个根对象里），落地时拆开写入三个字段，
 * 由 STEP_COMPANIONS 一并落盘成独立产物文件。
 */
import type {
  NarrativeContext,
  VnOutlineActs,
  VnCharacterBios,
  VnKeyItems,
} from "../../../types/index.js";
import type { LLMClient } from "../../llm-client.js";
import { extractJSON } from "../../llm-client.js";
import { appendUserInstructions } from "../design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../../prompt-composer.js";
import { FIVE_ELEMENT_NOTE, getStreamEmit } from "./_shared.js";

interface CombinedOutput {
  outline_acts: VnOutlineActs;
  character_bios: VnCharacterBios;
  key_items: VnKeyItems;
}

const VN_OUTLINE_ACTS_COMPOSER: PromptComposer = {
  stepId: "vn_outline_acts",
  skillSlots: ["style_guide", "constraints"],
  systemBlockOrder: ["role", "task", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    role: `你是互动影游主笔。基于 logline，扩写出严格三幕剧本骨架、全员人物小传与贯穿剧情的关键道具。`,

    task: `## 三幕结构（严格，不允许新增或删减幕）
- 一（建置）：约 150 字。介绍主角处境、关键关系、世界规则、推动主角离开常态的引爆事件
- 二（对抗）：约 300 字。主角的连续尝试与挫折，反派/阻力的逐步显影，至少 1 个低谷
- 三（解决）：约 150 字。最终对峙与代价；为后续"剧情树改造"留出可分支的高潮空间

## 双轮驱动（必须在三幕中显化）
- 外驱（external_motivation）：来自世界事件、他人压力、时间窗口的外部紧迫
- 内驱（internal_motivation）：主角的性格缺陷、未愈伤口、价值观挣扎
- 两者须在第二幕交叉、第三幕收束

## 人物小传（最少 3 人：主角 + 1 反派/对立 + 1 关键关系人）
每人必须包含：
- name / role（主角/反派/对立/导师/挚友/旁观…）
- identity（社会身份、年龄、外形特征极简描述）
- external_motivation / internal_motivation（双轮驱动）
- arc（人物弧光：从 X 到 Y）
- voice（说话风格描述：节奏 / 词汇偏好 / 情绪基调）
- visual（视觉关键词：服装 / 标志性配饰 / 体态）

## 关键道具（最少 2 件，必须真正驱动剧情而非装饰）
道具是叙事的"硬抓手"——它制造目标、转折与象征。每件必须包含：
- name（道具名）/ category（信物 / 武器 / 线索 / 契约物 / 媒介 / 遗物…）
- description（外形、来历、质感，可被镜头看见）
- narrative_function（在剧情中的具体作用：推动 / 转折 / 揭示真相 / 制造制约 / 完成代价）——必须能与三幕中的具体事件挂钩
- bound_character（关联人物，需与人物小传中的 name 呼应；若为无主线索可留空）
- act_appearance（出现/起关键作用的幕，用 ["一","二","三"] 子集）
- symbolism（象征意涵：道具如何外化主角的内驱或中心主题）
要求：至少 1 件道具贯穿第二、三幕并在第三幕的对峙/代价中扮演关键角色。

${FIVE_ELEMENT_NOTE}

## 编号约定（本步骤产出）
- act_id：使用汉字 "一" / "二" / "三"
- act_name：建置 / 对抗 / 解决（或保留同义中文，不允许英文）`,

    output_format: `## 输出格式（严格 JSON，单一根对象包含三个子结构）
{
  "outline_acts": {
    "title": "故事标题（沿用 logline.title 或微调）",
    "central_theme": "作品中心主题（一句话，如：复仇是否能换回失去的）",
    "acts": [
      { "act_id": "一", "act_name": "建置", "content": "约 150 字的五要素融合段落" },
      { "act_id": "二", "act_name": "对抗", "content": "约 300 字" },
      { "act_id": "三", "act_name": "解决", "content": "约 150 字" }
    ]
  },
  "character_bios": {
    "characters": [
      {
        "name": "...", "role": "主角",
        "identity": "...",
        "external_motivation": "...", "internal_motivation": "...",
        "arc": "从 X 到 Y", "voice": "...", "visual": "..."
      }
    ]
  },
  "key_items": {
    "items": [
      {
        "name": "...", "category": "信物",
        "description": "外形 / 来历 / 质感",
        "narrative_function": "在第二幕推动主角揭开真相，在第三幕成为换取代价的筹码",
        "bound_character": "主角名（与 character_bios 呼应）",
        "act_appearance": ["二", "三"],
        "symbolism": "..."
      }
    ]
  }
}`,

    context_inputs: (ctx: NarrativeContext): string => {
      const logline = ctx.vn_logline;
      if (!logline) {
        throw new Error("vn_outline_acts 需要 ctx.vn_logline 已生成（E1-01 未完成）");
      }
      return `## 一句话故事梗概（来自 E1-01）
- 标题：${logline.title}
- 内容：${logline.content}

## 用户原始需求（参考）
${ctx.user_input}`;
    },

    task_instruction: `## 任务
基于上述 logline 扩写：(1) 严格三幕剧本骨架；(2) 全员人物小传；(3) 贯穿剧情的关键道具。三者在同一份 JSON 中分别落到 outline_acts / character_bios / key_items 三个键。关键道具须与三幕事件、人物驱动真正咬合，不得是可有可无的摆设。`,
  },
};

function validateOutput(parsed: CombinedOutput): void {
  const oa = parsed.outline_acts;
  if (!oa?.title?.trim()) throw new Error("缺少 outline_acts.title");
  if (!Array.isArray(oa.acts) || oa.acts.length !== 3) {
    throw new Error("acts 必须恰好 3 项（一/二/三）");
  }
  const expected = ["一", "二", "三"] as const;
  oa.acts.forEach((act, idx) => {
    if (act.act_id !== expected[idx]) {
      throw new Error(`acts[${idx}].act_id 必须为 "${expected[idx]}"`);
    }
    if (!act.content?.trim()) throw new Error(`acts[${idx}].content 不能为空`);
  });

  const cb = parsed.character_bios;
  if (!Array.isArray(cb?.characters) || cb.characters.length < 1) {
    throw new Error("character_bios.characters 至少 1 人");
  }
  cb.characters.forEach((c, idx) => {
    if (!c.name?.trim()) throw new Error(`characters[${idx}].name 不能为空`);
    if (!c.external_motivation?.trim() || !c.internal_motivation?.trim()) {
      throw new Error(`characters[${idx}] 必须包含 external_motivation 与 internal_motivation`);
    }
  });

  const ki = parsed.key_items;
  if (!Array.isArray(ki?.items) || ki.items.length < 1) {
    throw new Error("key_items.items 至少 1 件关键道具");
  }
  ki.items.forEach((it, idx) => {
    if (!it.name?.trim()) throw new Error(`key_items[${idx}].name 不能为空`);
    if (!it.description?.trim()) throw new Error(`key_items[${idx}].description 不能为空`);
    if (!it.narrative_function?.trim()) {
      throw new Error(`key_items[${idx}].narrative_function 不能为空（道具必须驱动剧情）`);
    }
  });
}

export async function vnOutlineActs(ctx: NarrativeContext, llm: LLMClient): Promise<void> {
  const streamEmit = getStreamEmit(ctx);

  const raw = await llm.callWithRetry(
    composeSystemPrompt(VN_OUTLINE_ACTS_COMPOSER, ctx),
    appendUserInstructions(composeUserPrompt(VN_OUTLINE_ACTS_COMPOSER, ctx), ctx),
    { temperature: 0.7, responseFormat: "json" },
    (r) => validateOutput(extractJSON<CombinedOutput>(r)),
    streamEmit,
  );

  const parsed = extractJSON<CombinedOutput>(raw);
  ctx.vn_outline_acts = parsed.outline_acts;
  ctx.vn_character_bios = parsed.character_bios;
  ctx.vn_key_items = parsed.key_items;
}
