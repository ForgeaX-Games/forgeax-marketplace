/**
 * prompt-composer.ts (C6 - Phase P1)
 * ─────────────────────────────────────────────────────────────────
 * 把"过程性 step + 硬编码 prompt"重构为"声明式 PromptComposer + 薄 Executor"。
 *
 * @deprecated 新增步骤请使用 blueprint/prompt-resolver.ts + agent-templates/*.md
 * 外置模板系统。本文件保留用于尚未迁移到 .md 模板的旧步骤。
 * 迁移路径: PromptComposer.blocks → .md 模板文件 + AgentDef 注册
 *
 * 设计要点：
 *   1. 每个 step 用一份纯数据 PromptComposer 描述 prompt 结构
 *   2. blocks 是命名字符串块，按顺序拼接成最终 prompt
 *   3. 部分 block 内含 {{SKILL.<slot_name>}} 占位符，运行时被 skill.slots 填充
 *   4. skillSlots 显式声明哪些 slot 接受注入（白名单）
 *   5. 特异化 step 通过 skillSlots: [] 显式拒绝 skill 注入
 *
 * Skill 注入解析顺序：
 *   1. 优先用 skill.stepSkills[stepId].slots[<slotName>] 替换 {{SKILL.<slotName>}}
 *   2. 若 skill 仅提供 systemPromptAddition（旧形态），append 到 system prompt 末尾
 *   3. 未填充的 {{SKILL.*}} 占位符替换为空串（不留痕迹）
 */
import type { NarrativeContext } from "../types/index.js";
import { getStepSkill } from "../knowledge/game-narrative/skill-loader.js";
import type { StepSkillBlock } from "../knowledge/game-narrative/skill-types.js";

/**
 * 一个 step 的 prompt 蓝图。
 */
export interface PromptComposer {
  /** Step ID（与 STEP_IDS 对应），用于查找对应的 skill block */
  stepId: string;

  /**
   * 命名字符串块，按 systemBlockOrder/userBlockOrder 拼接。
   * 块内可使用 {{SKILL.<slotName>}} 占位符引用 skill slot 内容。
   */
  blocks: Record<string, string | ((ctx: NarrativeContext) => string)>;

  /**
   * System prompt 中包含的 block 顺序。未列出的 block 不会进入 system prompt。
   */
  systemBlockOrder: string[];

  /**
   * User prompt 中包含的 block 顺序。未列出的 block 不会进入 user prompt。
   */
  userBlockOrder: string[];

  /**
   * 显式开放给 skill 注入的 slot 名称集合（白名单）。
   * 空数组 = 显式拒绝所有 skill 注入（特异化 step）。
   * 非空数组 = 仅这些 slot 的内容会被注入到对应 block。
   */
  skillSlots: string[];
}

const SKILL_PLACEHOLDER = /\{\{SKILL\.([\w_]+)\}\}/g;

function resolveBlock(
  block: string | ((ctx: NarrativeContext) => string),
  ctx: NarrativeContext,
): string {
  return typeof block === "function" ? block(ctx) : block;
}

function fillSkillPlaceholders(
  text: string,
  skillBlock: StepSkillBlock | null,
  allowedSlots: string[],
): string {
  return text.replace(SKILL_PLACEHOLDER, (_, slotName: string) => {
    if (!skillBlock?.slots) return "";
    if (!allowedSlots.includes(slotName)) return "";
    return skillBlock.slots[slotName] ?? "";
  });
}

function joinNonEmpty(parts: string[]): string {
  return parts.filter((p) => p && p.trim().length > 0).join("\n\n");
}

/**
 * 拼装 system prompt：按 systemBlockOrder 串联 blocks，并填充 skill slot。
 * 若 skill 仅有 systemPromptAddition（无 slots），则附加到末尾（向后兼容方案 A）。
 */
export function composeSystemPrompt(
  composer: PromptComposer,
  ctx: NarrativeContext,
): string {
  const genreCode =
    ctx.demand_analysis?.genre_code ??
    ctx.tier_detection?.genre_code ??
    null;
  const skillBlock = genreCode ? getStepSkill(genreCode, composer.stepId) : null;
  const allowed = composer.skillSlots;

  const sysParts: string[] = [];
  for (const name of composer.systemBlockOrder) {
    const raw = composer.blocks[name];
    if (raw === undefined) continue;
    const resolved = resolveBlock(raw, ctx);
    sysParts.push(fillSkillPlaceholders(resolved, skillBlock, allowed));
  }
  let sp = joinNonEmpty(sysParts);

  if (skillBlock?.systemPromptAddition && allowed.length > 0) {
    sp += `\n\n## 🎭 品类专属指引（${genreCode}）\n${skillBlock.systemPromptAddition}`;
  }

  return sp;
}

/**
 * 拼装 user prompt：按 userBlockOrder 串联 blocks，同样支持 skill slot 注入。
 */
export function composeUserPrompt(
  composer: PromptComposer,
  ctx: NarrativeContext,
): string {
  const genreCode =
    ctx.demand_analysis?.genre_code ??
    ctx.tier_detection?.genre_code ??
    null;
  const skillBlock = genreCode ? getStepSkill(genreCode, composer.stepId) : null;
  const allowed = composer.skillSlots;

  const userParts: string[] = [];
  for (const name of composer.userBlockOrder) {
    const raw = composer.blocks[name];
    if (raw === undefined) continue;
    const resolved = resolveBlock(raw, ctx);
    userParts.push(fillSkillPlaceholders(resolved, skillBlock, allowed));
  }
  return joinNonEmpty(userParts);
}

/**
 * 调试辅助：序列化 composer 用于日志/单元测试。
 */
export function describeComposer(composer: PromptComposer): {
  stepId: string;
  systemBlocks: string[];
  userBlocks: string[];
  skillSlots: string[];
} {
  return {
    stepId: composer.stepId,
    systemBlocks: composer.systemBlockOrder,
    userBlocks: composer.userBlockOrder,
    skillSlots: composer.skillSlots,
  };
}
