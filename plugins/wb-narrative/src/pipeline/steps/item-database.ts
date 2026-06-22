import type { NarrativeContext, GameItem } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { extractJSON } from "../llm-client.js";
import { buildDesignContextSnippet, appendUserInstructions } from "./design-context-helper.js";
import { composeSystemPrompt } from "../prompt-composer.js";
import type { PromptComposer } from "../prompt-composer.js";

const MIN_ITEMS = 8;
const MAX_ITEMS = 30;

export const ITEM_DATABASE_COMPOSER: PromptComposer = {
  stepId: "item_database",
  blocks: {
    role: `你是游戏系统策划，请生成资源型道具数据库 JSON。所有输出使用中文。`,
    task_spec: `要求：
- 物品数量 ${MIN_ITEMS}~${MAX_ITEMS}
- 字段包含：name, category, rarity(common/uncommon/rare/epic/legendary), description, effect, initial_owner(null或角色名), initial_scene(初始出现场景名), related_character(关联角色名或null), value({"buy":数字,"sell":数字}), max_stack(堆叠上限), read_content(可选,仅readable物品)
- description 必须包含：外观描述 + 作用说明
- 位置信息必须基于世界观/故事/角色信息`,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output_schema: `输出格式（严格 JSON）：
{"item_database": [ {...}, ... ]}`,
  },
  systemBlockOrder: ["role", "task_spec", "style_guide", "constraints", "output_schema"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildUserPrompt(ctx: NarrativeContext): string {
  const charSummary = (ctx.detailed_character_sheets ?? [])
    .map(c => `${c.name} (${c.label}): ${c.occupation ?? ""} - ${c.role_in_story ?? ""}`)
    .join("\n");

  return `## 用户原始需求⭐
${ctx.user_input}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}

## 剧情简介
${JSON.stringify(ctx.plot_synopsis ?? {}, null, 2)}

## 核心设定
${JSON.stringify(ctx.core_settings ?? {}, null, 2)}

## 角色列表
${charSummary || "（无）"}

## 故事框架
${ctx.story_framework
    ? JSON.stringify(ctx.story_framework.framework.nodes.map(n => ({
        name: n.name, narrative_function: n.narrative_function,
      })), null, 2)
    : "（无）"}
${buildDesignContextSnippet(ctx)}
请输出道具数据库JSON：`;
}

function normalizeItem(raw: Record<string, unknown>): GameItem {
  const val = raw.value;
  const valueObj = (typeof val === "object" && val !== null)
    ? val as Record<string, number>
    : {};

  let owner = raw.initial_owner;
  if (owner === "null" || owner === "" || owner === undefined) owner = null;

  let related = raw.related_character;
  if (related === "null" || related === "" || related === undefined) related = null;

  return {
    name: String(raw.name ?? ""),
    category: String(raw.category ?? ""),
    rarity: String(raw.rarity ?? "common"),
    description: String(raw.description ?? ""),
    effect: String(raw.effect ?? ""),
    initial_owner: owner as string | null,
    initial_scene: String(raw.initial_scene ?? ""),
    related_character: related as string | null,
    value: valueObj,
    max_stack: Number(raw.max_stack ?? 1),
    ...(raw.read_content ? { read_content: String(raw.read_content) } : {}),
  };
}

export async function itemDatabase(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const rawText = await llm.callWithRetry(
    composeSystemPrompt(ITEM_DATABASE_COMPOSER, ctx),
    appendUserInstructions(buildUserPrompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => {
      const parsed = extractJSON(r);
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>).item_database;
      if (!Array.isArray(arr)) throw new Error("输出必须包含 item_database 数组");
      if (arr.length < 3) throw new Error(`道具数量太少(${arr.length})，至少3个`);
    },
  );

  const parsed = extractJSON<Record<string, unknown>>(rawText);
  const arr: Array<Record<string, unknown>> = Array.isArray(parsed)
    ? parsed
    : (parsed.item_database as Array<Record<string, unknown>>);

  ctx.item_database = arr.map(normalizeItem);
}
