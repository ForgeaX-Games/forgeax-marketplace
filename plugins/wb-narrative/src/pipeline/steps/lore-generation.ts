import type { NarrativeContext, LoreFragment, ItemLore } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { extractJSON } from "../llm-client.js";
import { buildDesignContextSnippet, appendUserInstructions } from "./design-context-helper.js";
import { composeSystemPrompt } from "../prompt-composer.js";
import type { PromptComposer } from "../prompt-composer.js";

export const LORE_GENERATION_COMPOSER: PromptComposer = {
  stepId: "lore_generation",
  blocks: {
    role: `你是一个游戏世界观设计师，擅长创作碎片化叙事内容。
根据已有的世界观、故事框架和角色设定，生成 Lore 碎片和物品叙事文本。`,
    task_spec: `## Lore 碎片类型
- inscription: 碑文/铭刻 — 古老的石碑、墙壁刻文、祭坛铭文
- journal: 日志/手记 — 探险者日记、学者笔记、战场报告
- npc_whisper: NPC 碎语 — 酒馆传言、村民闲谈、神秘低语
- item_description: 物品描述 — 装备/道具的Lore文本
- codex_entry: 图鉴条目 — 百科条目、生物志、种族志

## 物品叙事要求
- 每件物品需要: 名称、类型、稀有度、Lore文本（2-3句背景故事）、风味文本（1句意境文本）
- 稀有度: common, uncommon, rare, epic, legendary`,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output_schema: `## 输出格式（严格JSON）
{
  "lore_fragments": [
    {
      "id": "lore_001",
      "type": "inscription|journal|npc_whisper|item_description|codex_entry",
      "title": "碎片标题",
      "content": "碎片正文（50-150字）",
      "source_location": "发现地点",
      "related_characters": ["相关角色"],
      "related_worldview": "关联的世界观设定"
    }
  ],
  "item_lore": [
    {
      "item_name": "物品名称",
      "item_type": "weapon|armor|accessory|consumable|key_item|material",
      "rarity": "common|uncommon|rare|epic|legendary",
      "lore_text": "Lore文本（2-3句）",
      "flavor_text": "风味文本（1句）"
    }
  ]
}`,
  },
  systemBlockOrder: ["role", "task_spec", "style_guide", "constraints", "output_schema"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

/**
 * Tier2 Lore 碎片 + 物品叙事生成
 * 依赖: worldview_structure, story_framework, detailed_character_sheets (如有)
 */
export async function loreGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const worldview = ctx.worldview_structure;
  const framework = ctx.story_framework;
  const characters = ctx.detailed_character_sheets;
  const coreSettings = ctx.core_settings;

  let contextInfo = `## 世界观\n`;
  if (worldview) {
    contextInfo += `世界名: ${worldview.world_name}\n`;
    if (worldview.基础架构层) {
      contextInfo += `基础架构层: ${JSON.stringify(worldview.基础架构层, null, 2)}\n`;
    }
  }

  if (coreSettings) {
    contextInfo += `\n## 核心设定\n`;
    contextInfo += `主题: ${coreSettings.main_theme}\n`;
    contextInfo += `冲突: ${coreSettings.main_conflict}\n`;
    contextInfo += `题材: ${coreSettings.genre}\n`;
  }

  if (framework?.framework?.nodes) {
    contextInfo += `\n## 故事框架节点\n`;
    for (const node of framework.framework.nodes) {
      contextInfo += `- ${node.name}: ${node.main_content ?? ""}\n`;
    }
  }

  if (characters && characters.length > 0) {
    contextInfo += `\n## 角色\n`;
    for (const ch of characters) {
      contextInfo += `- ${ch.name} (${ch.label}): ${ch.occupation ?? ""} ${ch.role_in_story ?? ""}\n`;
    }
  }

  const designContext = buildDesignContextSnippet(ctx);
  const userPrompt = `${contextInfo}
${designContext}
请基于以上世界观和故事设定，生成：
1. 8-12 个 Lore 碎片（涵盖多种类型：碑文、日志、NPC碎语、图鉴条目等）
2. 6-10 个物品叙事（涵盖不同稀有度和类型）

要求：
- Lore 碎片之间有关联性，拼凑起来能揭示更大的故事
- 物品叙事要与世界观紧密结合
- 风味文本要有诗意和意境感
- 每个碎片的 source_location 要合理`;

  const raw = await llm.callWithRetry(
    composeSystemPrompt(LORE_GENERATION_COMPOSER, ctx),
    appendUserInstructions(userPrompt, ctx),
    { temperature: 0.85 },
    (r) => {
      const parsed = extractJSON<{ lore_fragments: LoreFragment[]; item_lore: ItemLore[] }>(r);
      if (!Array.isArray(parsed.lore_fragments)) throw new Error("lore_fragments 必须是数组");
      if (!Array.isArray(parsed.item_lore)) throw new Error("item_lore 必须是数组");
    },
  );

  const result = extractJSON<{ lore_fragments: LoreFragment[]; item_lore: ItemLore[] }>(raw);

  ctx.lore_fragments = result.lore_fragments.map((f, i) => ({
    id: f.id || `lore_${String(i + 1).padStart(3, "0")}`,
    type: f.type,
    title: String(f.title ?? ""),
    content: String(f.content ?? ""),
    source_location: f.source_location ? String(f.source_location) : undefined,
    related_characters: Array.isArray(f.related_characters) ? f.related_characters.map(String) : undefined,
    related_worldview: f.related_worldview ? String(f.related_worldview) : undefined,
  }));

  ctx.item_lore = result.item_lore.map((item) => ({
    item_name: String(item.item_name ?? ""),
    item_type: String(item.item_type ?? ""),
    rarity: String(item.rarity ?? "common"),
    lore_text: String(item.lore_text ?? ""),
    flavor_text: String(item.flavor_text ?? ""),
  }));
}
