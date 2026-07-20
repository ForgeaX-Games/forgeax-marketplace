import type { ContentLocale, NarrativeContext } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { appendUserInstructions } from "./design-context-helper.js";
import { composeSystemPrompt, composeUserPrompt, type PromptComposer } from "../prompt-composer.js";

function buildComposer(locale: ContentLocale): PromptComposer {
  const isEn = locale === "en";
  return {
    stepId: "preference_summary",
    skillSlots: [],
    systemBlockOrder: ["role", "extraction_guide", "output_format"],
    userBlockOrder: ["context_inputs", "task_instruction"],
    blocks: {
      role: isEn
        ? "You are a narrative requirements analyst. Extract key elements from user descriptions and summarize them structurally. All output must be in English."
        : "你是叙事需求分析专家，擅长从用户描述中提取关键要素并进行结构化总结。所有输出必须使用中文。",

      extraction_guide: isEn
        ? `## Elements to extract

From the user description, extract:
1. Protagonist: name, gender, age, race, occupation, etc.
2. Story theme: core theme (growth, revenge, redemption, love, sacrifice, etc.)
3. Genre/type: mystery, romance, adventure, growth, etc.
4. World setting: realistic, sci-fi, fantasy, historical, etc.
5. Core conflict: what problem the protagonist faces
6. Tone: epic, heartwarming, dark, humorous, etc.
7. Desired ending: happy / bad / open
8. Emotional tone: warm, tense, sad, surprising
9. Special requirements: user preferences or constraints`
        : `## 提取要素

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

      output_format: isEn
        ? "## Output format\n\nStructured Markdown, clear and readable."
        : "## 输出格式\n\n结构化Markdown格式，清晰易读。",

      context_inputs: (ctx: NarrativeContext): string => isEn
        ? `## User original request ⭐\n${ctx.user_input}`
        : `## 用户原始需求⭐\n${ctx.user_input}`,

      task_instruction: isEn
        ? `## Task

**Important**:
1. Base your analysis on the user's original request!
2. Do not invent details the user did not mention!
3. If a field is unspecified, infer reasonably from the genre/theme.

Summarize user preferences.

Output Markdown directly (do not wrap in code fences):

# User preference summary

## Core elements
- Protagonist: XXX
- Story theme: XXX
- Genre/type: XXX
- World setting: XXX
- Core conflict: XXX
- Tone: XXX

## Expected experience
- Ending preference: XXX
- Emotional tone: XXX
- Pacing preference: XXX

## Special requirements
- XXX

## Brief overview
One sentence summarizing the story the user wants.`
        : `## 任务

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
}

export async function userPreferenceSummary(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const streamEmit = (ctx as Record<string, unknown>)._streamEmit as
    | ((chunk: string, accumulated: string) => void)
    | undefined;

  const locale: ContentLocale = ctx.content_locale === "en" ? "en" : "zh";
  const composer = buildComposer(locale);
  const sp = composeSystemPrompt(composer, ctx);
  const up = composeUserPrompt(composer, ctx);

  const result = await llm.callStreamFull(
    sp,
    appendUserInstructions(up, ctx),
    {},
    streamEmit,
  );
  ctx.user_preference_summary = result.trim();
}
