import type { NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { appendUserInstructions } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../prompt-composer.js";

const PREFERENCE_SUMMARY_COMPOSER: PromptComposer = {
  stepId: "preference_summary",
  skillSlots: [],
  systemBlockOrder: ["role", "extraction_guide", "output_format"],
  userBlockOrder: ["context_inputs", "task_instruction"],
  blocks: {
    role: "你是叙事需求分析专家，擅长从用户描述中提取关键要素并进行结构化总结。所有输出必须使用中文。",

    extraction_guide: `## 提取要素

从用户描述中提取以下关键信息：
1. 主角信息：姓名、性别、年龄、种族、职业身份等
2. 故事主题：核心主旨与思想内核（如复仇、成长、救赎、爱与牺牲等）
3. 题材类型：悬疑/爱情/冒险/成长等
4. 世界背景：现实/科幻/奇幻/历史等
5. 核心冲突：主角面临什么问题
6. 风格基调：叙事风格与整体氛围（如史诗恢宏、温馨治愈、暗黑压抑、轻松幽默等）
7. 期望结局：Happy/Bad/Open
8. 情感倾向：温馨/紧张/悲伤/惊喜
9. 特殊要求：用户的特殊偏好或禁忌`,

    output_format: `## 输出格式

结构化Markdown格式，清晰易读。`,

    context_inputs: (ctx: NarrativeContext): string => `## 用户原始需求⭐
${ctx.user_input}`,

    task_instruction: `## 任务

**重要**：
1. 必须基于用户原始需求进行分析！
2. 不要编造用户未提及的内容！
3. 如果用户未明确某项，根据题材合理推断。

请总结用户偏好。

直接输出Markdown格式（不要用代码块包裹）：

# 用户偏好总结

## 核心要素
- 主角信息：XXX
- 故事主题：XXX
- 题材类型：XXX
- 世界背景：XXX
- 核心冲突：XXX
- 风格基调：XXX

## 期望体验
- 结局倾向：XXX
- 情感倾向：XXX
- 节奏偏好：XXX

## 特殊要求
- XXX

## 简短概述
一句话总结用户想要什么样的故事。`,
  },
};

export async function userPreferenceSummary(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const streamEmit = (ctx as Record<string, unknown>)._streamEmit as
    | ((chunk: string, accumulated: string) => void)
    | undefined;

  const sp = composeSystemPrompt(PREFERENCE_SUMMARY_COMPOSER, ctx);
  const up = composeUserPrompt(PREFERENCE_SUMMARY_COMPOSER, ctx);

  const result = await llm.callStreamFull(
    sp,
    appendUserInstructions(up, ctx),
    {},
    streamEmit,
  );
  ctx.user_preference_summary = result.trim();
}
