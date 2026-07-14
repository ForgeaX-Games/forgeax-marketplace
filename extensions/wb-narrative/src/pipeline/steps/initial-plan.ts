/**
 * 初步方案（单次 LLM 直出）
 *
 * 一次调用生成全部初始数据，输出纯 JSON：
 *   - initial_story_outline（结构化大纲，非 Markdown 文本）
 *   - core_settings（世界/角色/设定）
 *   - plot_synopsis（剧情简介）
 *
 * 前端负责将 JSON 字段渲染为可读文本，后端只存结构化数据。
 */
import type { NarrativeContext, CoreSettings, PlotSynopsis, InitialOutline } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { extractJSON } from "../llm-client.js";
import { buildDesignContextSnippet, appendUserInstructions } from "./design-context-helper.js";
import { composeSystemPrompt } from "../prompt-composer.js";
import type { PromptComposer } from "../prompt-composer.js";
import { resolveTargetActs } from "../narrative-scale.js";
import { loadSkill } from "../../knowledge/game-narrative/skill-loader.js";

const VALID_TONES = ["romantic", "epic", "mystery", "apocalyptic", "growth", "rivalry", "cozy", "comedy", "horror", "absurd"] as const;
const VALID_THEMES = ["fantasy", "xuanhuan", "urban", "cyberpunk", "wuxia", "school", "mythology", "space_opera", "steampunk", "western"] as const;
const VALID_HOOKS = ["puzzle", "slice_of_life", "competitive"] as const;

export const INITIAL_PLAN_COMPOSER: PromptComposer = {
  stepId: "initial_plan",
  blocks: {
    role: `你是专业故事策划师，请根据用户需求一次性输出初步方案全部数据。所有输出必须使用中文（world_tags 的值除外）。`,
    task_spec: `## 输出要求

输出单一 JSON 对象，包含以下所有字段（禁止省略任何字段）：

\`\`\`json
{
  "theme": "故事核心主旨（一句话）",
  "background": "世界背景与时代环境描述（100-200字）",
  "character_arc": "主角成长轨迹：从XXX到XXX",
  "main_conflict": "核心矛盾描述",
  "story_structure": {
    "opening": "开端（200字以上）：故事起点与触发事件。即使采用热开场（in media res），也必须在动作中嵌入以下要素——①关系展示：角色之间的情感纽带通过行为或对话体现；②行动动机：他们为什么在做这件事、为谁而动、失败了谁受伤；③角色个性：至少一个角色通过独有的反应/对话/习惯展示不可替代的性格；④flag种子：至少一个角色表达对未来的具体期待（这个期待在后续会被打碎，制造情感冲击）",
    "development": ["中段阶段一：XXX", "中段阶段二：XXX"],
    "ending": "结局：矛盾解决与情感落点"
  },
  "key_plot_points": ["转折点1", "转折点2", "转折点3"],
  "world_name": "世界/宇宙/纪元级专有名称",
  "world_setting": "世界背景简述（50-100字）",
  "world_summary": "世界简介（50-200字，有吸引力）",
  "world_tags": {
    "tone": ["从 romantic/epic/mystery/apocalyptic/growth/rivalry/cozy/comedy/horror/absurd 选1-3个"],
    "theme": ["从 fantasy/xuanhuan/urban/cyberpunk/wuxia/school/mythology/space_opera/steampunk/western 选1-2个"],
    "hook": ["从 puzzle/slice_of_life/competitive 选0-2个"]
  },
  "protagonist": {
    "name": "主角全名（非占位符）",
    "identity": "身份",
    "personality": "性格特点",
    "core_conflict": "主角内心核心冲突"
  },
  "key_npcs": [
    { "name": "配角全名", "identity": "身份", "personality": "性格", "relationship_to_protagonist": "与主角关系" }
  ],
  "main_theme": "故事主题",
  "narrative_perspective": "叙事视角（第一人称/第三人称等）",
  "genre": "题材（如奇幻/赛博朋克/武侠等）",
  "synopsis_strategy": "剧情策略（如何设置钩子、如何推进）",
  "synopsis": "200-300字剧情简介（有代入感）",
  "highlight_analysis": "核心亮点分析（吸引力所在）"
}
\`\`\``,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output_schema: `## 设计原则
- 所有名字必须具体（禁止使用"主角""配角"等占位符）
- story_structure.development 设置2-4个阶段，每阶段有自己的起伏
- key_plot_points 3-5个关键转折点
- synopsis 必须200字以上，有代入感`,
  },
  systemBlockOrder: ["role", "task_spec", "style_guide", "constraints", "output_schema"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildUserPrompt(ctx: NarrativeContext): string {
  const digest = ctx.user_preference_analysis
    ? JSON.stringify(ctx.user_preference_analysis, null, 2)
    : "（无）";

  return `## 用户原始需求（必须严格遵循！）⭐
${ctx.user_input}

## 用户偏好总结
${ctx.user_preference_summary ?? "（无）"}

## 用户偏好分析（42维度槽位参数摘要）
${digest}
${buildDesignContextSnippet(ctx)}
请严格按照系统提示中的 JSON 格式输出初步方案，不要省略任何字段。`;
}

interface InitialPlanRaw {
  // InitialOutline fields
  theme: string;
  background: string;
  character_arc: string;
  main_conflict: string;
  story_structure: { opening: string; development: string[]; ending: string };
  key_plot_points: string[];
  // CoreSettings fields
  world_name: string;
  world_setting: string;
  world_summary: string;
  world_tags: { tone: string[]; theme: string[]; hook: string[] };
  protagonist: { name: string; identity: string; personality: string; core_conflict: string };
  key_npcs: Array<{ name: string; identity: string; personality: string; relationship_to_protagonist: string }>;
  main_theme: string;
  narrative_perspective: string;
  genre: string;
  // PlotSynopsis fields
  synopsis_strategy: string;
  synopsis: string;
  highlight_analysis: string;
}

function validate(raw: InitialPlanRaw): void {
  if (!raw.theme) throw new Error("缺少 theme 字段");
  if (!raw.protagonist?.name || raw.protagonist.name.length < 2)
    throw new Error("protagonist.name 不能为空或占位符");
  if (!raw.world_name || raw.world_name.length < 2)
    throw new Error("world_name 不能为空");
  if (!raw.synopsis || raw.synopsis.length < 50)
    throw new Error("synopsis 不能为空（需200字以上）");
  if (!raw.story_structure?.opening)
    throw new Error("story_structure.opening 不能为空");
  if (!Array.isArray(raw.story_structure?.development) || raw.story_structure.development.length === 0)
    throw new Error("story_structure.development 不能为空");
}

function normalizeTags(raw: InitialPlanRaw): InitialPlanRaw["world_tags"] {
  const tags = raw.world_tags ?? { tone: [], theme: [], hook: [] };
  tags.tone = (tags.tone ?? []).filter((t) => (VALID_TONES as readonly string[]).includes(t));
  tags.theme = (tags.theme ?? []).filter((t) => (VALID_THEMES as readonly string[]).includes(t));
  tags.hook = (tags.hook ?? []).filter((t) => (VALID_HOOKS as readonly string[]).includes(t));

  if (tags.theme.length === 0 && raw.genre) {
    const genreLower = raw.genre.toLowerCase();
    for (const t of VALID_THEMES) {
      if (genreLower.includes(t)) { tags.theme.push(t); break; }
    }
    if (tags.theme.length === 0) tags.theme.push("fantasy");
  }
  return tags;
}

export async function initialPlan(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const sp = composeSystemPrompt(INITIAL_PLAN_COMPOSER, ctx);
  const raw = await llm.callWithRetry(
    sp,
    appendUserInstructions(buildUserPrompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => {
      const parsed = extractJSON<InitialPlanRaw>(r);
      validate(parsed);
    },
  );

  const parsed = extractJSON<InitialPlanRaw>(raw);
  const tags = normalizeTags(parsed);

  // ── 写入 initial_story_outline（结构化大纲） ──
  const outline: InitialOutline = {
    theme:          parsed.theme,
    background:     parsed.background ?? "",
    character_arc:  parsed.character_arc ?? "",
    main_conflict:  parsed.main_conflict,
    story_structure: {
      opening:     parsed.story_structure?.opening ?? "",
      development: parsed.story_structure?.development ?? [],
      ending:      parsed.story_structure?.ending ?? "",
    },
    key_plot_points: parsed.key_plot_points ?? [],
  };
  ctx.initial_story_outline = outline;

  // ── 写入 core_settings ──
  const coreSettings: CoreSettings = {
    world_name:           parsed.world_name,
    world_setting:        parsed.world_setting ?? "",
    world_summary:        parsed.world_summary ?? parsed.world_setting ?? "",
    world_tags:           tags,
    protagonist:          parsed.protagonist,
    key_npcs:             parsed.key_npcs ?? [],
    main_theme:           parsed.main_theme ?? parsed.theme,
    main_conflict:        parsed.main_conflict,
    narrative_perspective: parsed.narrative_perspective ?? "",
    genre:                parsed.genre ?? "",
  };
  ctx.core_settings = coreSettings;

  // ── 全局故事标题（§6.5）：D0 生成的 world_name 即全局唯一 story_title；
  // 若上游（如 IP DNA A→B 种子）已预置 story_title 则尊重之，保证一级标题与算子 source-name 全局统一。──
  if (!ctx.story_title?.trim()) ctx.story_title = parsed.world_name;

  // ── 写入 plot_synopsis ──
  const synopsis: PlotSynopsis = {
    synopsis_strategy: parsed.synopsis_strategy ?? "",
    synopsis:          parsed.synopsis,
    highlight_analysis: parsed.highlight_analysis ?? "",
  };
  ctx.plot_synopsis = synopsis;

  // ── Stage C：解析目标幕数（短剧 1 幕 / 长剧 ≥2 幕） ──
  // hybrid 触发：user_input 关键词 > skill.defaultActs > 1。
  // 写入 ctx.target_acts，下游 chunked capability 据此切换 single/long-form 模式。
  const genreCode = (ctx as Record<string, unknown>).demand_analysis &&
    typeof (ctx as Record<string, { genre_code?: unknown }>).demand_analysis === "object"
    ? ((ctx as Record<string, { genre_code?: unknown }>).demand_analysis as { genre_code?: string }).genre_code
    : undefined;
  const skill = loadSkill(genreCode);
  // M1.7: 把上传剧本的 char_count 透传，让长篇剧本自动 → 多幕
  const uploadedCharCount = ctx.uploaded_script?.char_count;
  ctx.target_acts = resolveTargetActs(ctx.user_input, skill, uploadedCharCount);
}
