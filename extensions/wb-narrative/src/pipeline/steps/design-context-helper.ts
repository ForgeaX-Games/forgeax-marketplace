/**
 * 共享工具：将策划管线的输出注入到叙事步骤的 prompt 中。
 * 当 NarrativeContext 中有 game_design_context / narrative_requirements 时，
 * 生成一段 prompt 文本供叙事步骤参考。
 *
 * 也提供 userInstructions 注入：当 rerunFromStep 设置了 ctx._userInstructions 时，
 * 步骤函数可调用 appendUserInstructions 将修改意见追加到 LLM prompt。
 */
import type { NarrativeContext } from "../../types/index.js";

export function buildDesignContextSnippet(ctx: NarrativeContext): string {
  const nr = ctx.narrative_requirements;
  const gdc = ctx.game_design_context;
  const cc = ctx.core_concept;

  if (!nr && !cc) return "";

  const lines: string[] = ["\n## 策划约束（来自策划管线，叙事必须遵守）\n"];

  if (cc) {
    lines.push(`游戏名称: ${cc.game_name}`);
    lines.push(`一句话概括: ${cc.one_liner}`);
    if (cc.narrative_pillars?.length) {
      lines.push(`叙事支柱: ${cc.narrative_pillars.join("、")}`);
    }
    if (cc.three_loops?.gameplay_loop) {
      lines.push(`玩法循环: ${cc.three_loops.gameplay_loop.description}`);
    }
    lines.push("");
  }

  if (nr) {
    if (nr.constraints?.length) {
      lines.push("### 叙事约束");
      for (const c of nr.constraints) {
        lines.push(`- ${c}`);
      }
      lines.push("");
    }

    if (nr.system_context?.length) {
      lines.push("### 相关系统（叙事需参考）");
      for (const sc of nr.system_context.slice(0, 8)) {
        lines.push(`- ${sc.name}: ${sc.brief}`);
      }
      lines.push("");
    }

    if (nr.loops_summary) {
      if (nr.loops_summary.gameplay_loop) {
        lines.push(`玩法循环摘要: ${nr.loops_summary.gameplay_loop}`);
      }
      if (nr.loops_summary.resource_loop) {
        lines.push(`资源循环摘要: ${nr.loops_summary.resource_loop}`);
      }
      lines.push("");
    }

    if (nr.priority_content?.length) {
      lines.push(`优先内容: ${nr.priority_content.slice(0, 5).join("、")}`);
    }
  }

  return lines.join("\n");
}

/**
 * Append user modification instructions to an LLM prompt when running in
 * rerunFromStep mode. Returns the original prompt unmodified if no instructions
 * are present on ctx.
 */
export function appendUserInstructions(prompt: string, ctx: NarrativeContext): string {
  const instructions = (ctx as Record<string, unknown>)._userInstructions as string | undefined;
  if (!instructions) return prompt;
  return `${prompt}\n\n## 🚨 用户修改意见（本次重新生成的核心指导，必须优先遵守）\n${instructions}`;
}

/**
 * IP 原文参考块（§B2）：当存在 IP 改编范围内的原文切片（ctx.uploaded_script.content，
 * 由 IP DNA 编排在 buildGenerationInput 时注入）时，给结构规划/情节点生成步骤一个显式、
 * 高优先级的"忠实改编基准"指令。原文正文已由管线 M1.6 拼接到 user_input 末尾，
 * 此处不重复倾倒全文（避免 token 膨胀），仅显式声明其权威性与改编约束。
 * 无上传原文时返回空串（忠实/纯生成行为不变）。
 */
export function buildIpSourceReference(ctx: NarrativeContext): string {
  const u = ctx.uploaded_script;
  if (!u?.content?.trim()) return "";
  const meta = u.description ?? `${u.format ?? "prose"} 格式（约 ${u.char_count ?? u.content.length} 字）`;
  return [
    "\n## 📖 IP 原文参考（忠实改编基准，最高优先级）",
    `本作品改编自既有 IP，原文素材（${meta}）已附在「用户需求」末尾，请将其作为本步创作的权威依据：`,
    "- 严格沿用原作的人名、地名、势力、场景命名与关键台词，不臆造与原作冲突的核心设定；",
    "- 情节顺序、因果关系与人物动机以原文为准，仅在游戏化结构（节点/分支/单元）层面做必要重组；",
    "- 若原文体量大于本层级所需，按本层级职责提炼，不遗漏原文中的关键转折与高光段落。",
  ].join("\n");
}

import { getStepSkill, renderStepSkillForSystemPrompt } from "../../knowledge/game-narrative/skill-loader.js";

/**
 * C5-P0：把品类 skill 拼到 system prompt 末尾。
 *
 * 调用方式（每个 step 改 1 行）：
 *   const SP = buildSkillSystemPrompt(BASE_SYSTEM_PROMPT, ctx, "worldview");
 *
 * 当 ctx.demand_analysis.genre_code 不存在或该品类未注册 skill 时，原样返回 baseSystemPrompt。
 *
 * 这是方案 A 的最小注入：所有 26 处 step 共用此 helper。后续 PromptComposer
 * (C6-P1) 重构的 step 会把 skill 内容插入命名 slot 而非末尾。
 */
export function buildSkillSystemPrompt(
  baseSystemPrompt: string,
  ctx: NarrativeContext,
  stepId: string,
): string {
  const genreCode = ctx.demand_analysis?.genre_code ?? ctx.tier_detection?.genre_code;
  if (!genreCode) return baseSystemPrompt;
  const block = getStepSkill(genreCode, stepId);
  if (!block) return baseSystemPrompt;
  const skillText = renderStepSkillForSystemPrompt(block);
  if (!skillText) return baseSystemPrompt;
  return `${baseSystemPrompt}\n\n## 🎭 品类专属指引（${genreCode}）\n${skillText}`;
}
