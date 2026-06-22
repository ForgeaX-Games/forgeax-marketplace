import type { NarrativeContext, NarrativeCard } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { extractJSON } from "../llm-client.js";
import { matchPreset, WRITING_CORE, OUTPUT_TEMPLATE, type Tier4Preset } from "../../knowledge/game-narrative/tier4-presets.js";
import { appendUserInstructions, buildDesignContextSnippet } from "./design-context-helper.js";
import { composeSystemPrompt } from "../prompt-composer.js";
import type { PromptComposer } from "../prompt-composer.js";

function buildPresetContext(preset: Tier4Preset): string {
  let ctx = `品类：${preset.name}\n\n`;
  ctx += `## 组合逻辑\n${preset.comboLogic}\n\n`;

  ctx += `## 要素库\n`;
  for (const table of preset.elements) {
    ctx += `### ${table.category}\n`;
    for (const row of table.rows) {
      ctx += `- ${row.type}: ${row.variants}\n`;
    }
    ctx += "\n";
  }

  if (preset.examples.length > 0) {
    ctx += `## 组合示例\n`;
    for (const ex of preset.examples) {
      ctx += `- **${ex.name}**: 主角=${ex.protagonist}, 动机=${ex.motivation}, 目标=${ex.target}, 挑战=${ex.challenge}, 结局=${ex.ending}\n`;
    }
  }

  return ctx;
}

export const NARRATIVE_CARD_COMPOSER: PromptComposer = {
  stepId: "narrative_card",
  blocks: {
    role: `你是一个休闲游戏叙事设计师。根据用户的游戏需求和品类预设，生成一张完整的叙事卡。`,
    task_spec: `## 写作公式
${WRITING_CORE.formula}

## 三段式故事结构
- 第一段：${WRITING_CORE.storyStructure.p1}
- 第二段：${WRITING_CORE.storyStructure.p2}
- 第三段：${WRITING_CORE.storyStructure.p3}

## 写作原则
${WRITING_CORE.principles.map((p) => `- ${p}`).join("\n")}`,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output_schema: `## 输出格式（严格JSON）
{
  "game_name": "游戏名称",
  "one_liner": "一句话（15-30字，秒懂+想玩）",
  "story": "三段式故事（150-200字）",
  "gameplay_mapping": {
    "你是": "...",
    "核心行动": "...",
    "收集/消除": "...",
    "失败意味着": "...",
    "最终目标": "..."
  },
  "level_expansion": {
    "scene_line": "场景线（如：森林→雪山→火山→海底）",
    "difficulty_line": "难度线（如：敌人更强/时间更紧）",
    "final_chapter": "最终章（如：Boss战/大团圆）"
  }
}`,
  },
  systemBlockOrder: ["role", "task_spec", "style_guide", "constraints", "output_schema"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

/**
 * Tier4 叙事卡生成步骤
 * 1. 匹配品类预设（22种+通用兜底）
 * 2. 基于预设的组合逻辑和要素库生成叙事卡
 */
export async function narrativeCardGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const preset = matchPreset(ctx.user_input);
  const presetContext = buildPresetContext(preset);

  const designSnippet = buildDesignContextSnippet(ctx);
  const userPrompt = `用户需求：${ctx.user_input}

## 匹配到的品类预设
${presetContext}
${designSnippet ? `\n## 策划约束（若有）\n${designSnippet}\n` : ""}
## 输出模板参考
${OUTPUT_TEMPLATE}

请根据用户需求和品类预设，生成一张完整的叙事卡（JSON格式）。
要求：
1. 游戏名称要有创意，体现游戏主题
2. 一句话要让人秒懂玩法+想玩
3. 故事要有画面感，用短句保持节奏
4. 玩法映射要准确对应游戏核心机制
5. 关卡拓展要有递进感`;

  const raw = await llm.callWithRetry(
    composeSystemPrompt(NARRATIVE_CARD_COMPOSER, ctx),
    appendUserInstructions(userPrompt, ctx),
    { temperature: 0.8 },
    (r) => {
      const card = extractJSON<NarrativeCard>(r);
      if (!card.game_name || !card.one_liner || !card.story) {
        throw new Error("叙事卡缺少必需字段: game_name/one_liner/story");
      }
    },
  );

  ctx.narrative_card = extractJSON<NarrativeCard>(raw);
}
