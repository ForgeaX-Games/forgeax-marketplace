/**
 * 需求驱动步骤组合器（deriveSteps）
 *
 * 根据 NarrativeRequirements.needs 矩阵动态组合叙事步骤。
 * 步骤按固定执行顺序过滤：越靠前的步骤越基础，不可跳过上游步骤。
 *
 * 维度含义（0-3）：
 *   W=世界观  C=角色  S=剧情结构  D=对话剧本  Q=任务
 *   E=环境叙事  I=物品  U=UI文案  L=Lore碎片
 *
 * F1：当 narrative_type === "branching"（VN/互动影游 家族）时，
 * 输出 VN 模板专属步骤序列（branch_tree + dialogue_script），
 * 而不是 L0-L5 的 RPG 思路步骤。可选的 cinematic_storyboard 通过
 * 品类 skill 的 enableSteps 字段激活。
 */
import type { NarrativeRequirements } from "../../types/game-design.js";
import { STEP_IDS } from "../modes.js";
import { loadSkill } from "../../knowledge/game-narrative/skill-loader.js";
import { getPipelineTemplate } from "../templates.js";
import type { PipelineTemplateId } from "../templates.js";
import { GENRE_TAXONOMY } from "../../knowledge/genre-taxonomy.js";

const S = STEP_IDS;

export interface BuildAutoStepsOptions {
  /** 来自 demand_analysis.genre_code，用于查 skill 的 enableSteps */
  genreCode?: string;
}

function resolvePipelineTemplate(genreCode: string | undefined): PipelineTemplateId | undefined {
  if (!genreCode) return undefined;
  const entry = GENRE_TAXONOMY.find((g) => g.code === genreCode);
  return entry?.pipelineTemplate;
}

/**
 * 根据叙事需求矩阵动态组合叙事步骤列表。
 * 返回按正确执行顺序排列的步骤 ID 数组。
 *
 * 路由优先级：
 *   1) 品类的 pipelineTemplate（显式声明，最高优先级）
 *   2) narrative_type 兜底（未显式映射的品类）
 *   3) 经典 L0-L5 RPG 链（兜底默认）
 *
 * @deprecated Phase 6: 使用 planPipeline()（pipeline/planner/index.ts）替代。
 * 此函数保留用于 use_legacy_pipeline=true 回退路径和 rerunFromStep 历史兼容。
 */
export function buildAutoSteps(
  req: NarrativeRequirements,
  options: BuildAutoStepsOptions = {},
): string[] {
  const template = resolvePipelineTemplate(options.genreCode);

  // 模板优先：先按品类显式声明的 pipelineTemplate 路由
  switch (template) {
    case "tpl-narrative-card":
      return buildNarrativeCardAutoSteps();
    case "tpl-open-world":
      return buildOpenWorldAutoSteps(req, options);
    case "tpl-card-game":
      return buildCardGameAutoSteps(req, options);
    case "tpl-light":
      return buildLightAutoSteps(req);
    case "tpl-vn":
      return buildVnAutoSteps(req, options);
    case "tpl-vn-v2":
      return buildVnV2AutoSteps();
    case "tpl-fragmented":
      return buildFragmentedAutoSteps(req);
    case "tpl-emergent":
      return buildEmergentAutoSteps(req);
    case "tpl-rpg":
      return buildClassicAutoSteps(req);
    case undefined:
      // 未知品类（无 pipelineTemplate）：按 narrative_type 兜底
      break;
  }

  // narrative_type 兜底：未显式映射的品类按 narrative_type 走经典分支
  if (req.narrative_type === "branching") {
    return buildVnAutoSteps(req, options);
  }
  if (req.narrative_type === "fragmented") {
    return buildFragmentedAutoSteps(req);
  }
  if (req.narrative_type === "emergent") {
    return buildEmergentAutoSteps(req);
  }
  if (req.narrative_type === "minimal") {
    return buildLightAutoSteps(req);
  }

  return buildClassicAutoSteps(req);
}

function buildClassicAutoSteps(req: NarrativeRequirements): string[] {
  const needs = req.needs;
  const W = needs.W ?? 0;
  const C = needs.C ?? 0;
  const S_ = needs.S ?? 0;
  const D = needs.D ?? 0;
  const Q = needs.Q ?? 0;
  const E = needs.E ?? 0;
  const I = needs.I ?? 0;
  // L (Lore) 已由通用叙事 agent 内嵌产出，不再驱动独立 step
  // U (UI 文案) 已从叙事模块移除

  const steps: string[] = [];

  // ── Phase 0: 通用前置（所有叙事品类必须执行）──
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);

  // ── Phase 1: 世界观（W≥1 时需要，基本所有品类都满足）──
  if (W >= 1) {
    steps.push(S.WORLDVIEW);
  }

  // ── Phase 2: 实体层（世界观之后、叙事结构之前）──
  // 角色档案（C≥2）
  if (C >= 2) {
    steps.push(S.CHARACTER_ENRICHMENT);
  }
  // 道具清单（I≥2，需要角色数据作为上下文）
  if (I >= 2) {
    steps.push(S.ITEM_DATABASE);
  }

  // ── Phase 3: 叙事结构 L0-L2 ──
  // L0 故事框架（S≥2）
  if (S_ >= 2) {
    steps.push(S.STORY_FRAMEWORK);
  }
  // L1 章节大纲（S≥2）
  if (S_ >= 2) {
    steps.push(S.OUTLINE_BATCH);
  }
  // L2 详细大纲（S≥3）
  if (S_ >= 3) {
    steps.push(S.DETAILED_OUTLINE);
  }

  // ── Phase 4: 叙事内容 L3-L4 ──
  // L3 情节生成（D≥2 或 S≥3 时需要完整情节描写）
  if (D >= 2 || S_ >= 3) {
    steps.push(S.PLOT_GENERATION);
  }
  // L4 剧本生成（D≥3 时需要完整对话剧本）
  if (D >= 3) {
    steps.push(S.SCRIPT_GENERATION);
  }

  // ── Phase 5: 系统内容 L5 + 场景 ──
  // L5 任务生成（Q≥2）
  if (Q >= 2) {
    steps.push(S.QUEST_GENERATION);
  }
  // 场景生成（E≥2）
  if (E >= 2) {
    steps.push(S.SCENE_GENERATION);
  }

  // ── Phase 6: 补充内容 ──
  // Lore 已集成至通用叙事 agent（按 needs.L 由 capability 内嵌产出，不再独立 step）
  // UI 文案已从叙事模块移除

  return steps;
}

/**
 * 视觉小说 / 互动影游 / 乙女 / 互动叙事家族的步骤序列。
 * 基于 tpl-vn 模板：偏好 → 初步方案 → 世界观 → 角色 → 分支树 → 对话脚本 → [可选分镜] → UI
 *
 * 可选的 cinematic_storyboard 步骤由该品类的 skill.enableSteps 决定。
 * 例：adv-interactive 在其 skill 中声明 enableSteps:["cinematic_storyboard"] 即激活分镜。
 */
/**
 * tpl-vn-v2 专属管线：固定 9 步独立实现 + 借用收尾（worldview）。
 *
 * 与 templates.ts tpl-vn-v2 / modes.ts vn_full 的 steps 序列保持一致。
 * 此处不引入 needs 维度过滤——v2 是"专属重型管线"，9 步缺一不可。
 *
 * 已剔除 PREFERENCE_ANALYSIS：vn-v2 用 logline + 三幕直接驱动，
 * 不需要 RPG 范式的 42 维度叙事槽位。
 *
 * E2 路径（has_uploaded_script=true）：pipeline.ts 的 injectVnV2E2Steps 把
 * VN_OUTLINE_ACTS / VN_SCENES / VN_BEATS 替换为 VN_SCRIPT_NORMALIZE / VN_SEGMENT_CONFIRM。
 */
function buildVnV2AutoSteps(): string[] {
  return [
    S.VN_LOGLINE,
    S.VN_OUTLINE_ACTS,
    S.WORLDVIEW,
    S.VN_SCENES,
    S.VN_BEATS,
    S.VN_BRANCHED_BEATS,
    S.VN_SCREENPLAY,
    S.VN_STORYBOARD,
  ];
}

function buildVnAutoSteps(
  req: NarrativeRequirements,
  options: BuildAutoStepsOptions,
): string[] {
  const needs = req.needs;
  const W = needs.W ?? 0;
  const C = needs.C ?? 0;

  const steps: string[] = [];

  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);

  if (W >= 1) {
    steps.push(S.WORLDVIEW);
  }
  if (C >= 2) {
    steps.push(S.CHARACTER_ENRICHMENT);
  }

  steps.push("branch_tree");
  steps.push("dialogue_script");

  // Resolve optional steps (e.g., cinematic_storyboard) declared by the skill.
  const enabled = resolveOptionalVnSteps(options.genreCode);
  for (const optStep of enabled) {
    steps.push(optStep);
  }

  return steps;
}

/**
 * 读取该品类 skill 中声明的 enableSteps，返回属于 tpl-vn 模板可选步骤集合的子集。
 * 不在 tpl-vn.optionalSteps 列表中的 step 会被忽略以防止越权激活。
 *
 * Phase 3.4: 加 NARRATIVE_AUTO_DEBUG=1 环境变量打开 debug 日志，
 * 用于诊断 §4.④ 影游分镜没出现的根因（skill 没注册 / enableSteps 为空 / 越权过滤等）。
 */
function resolveOptionalVnSteps(genreCode: string | undefined): string[] {
  const debug = process.env.NARRATIVE_AUTO_DEBUG === "1";
  if (!genreCode) {
    if (debug) console.log("[auto-narrative-builder] resolveOptionalVnSteps: empty genreCode → []");
    return [];
  }
  const skill = loadSkill(genreCode);
  if (!skill?.enableSteps?.length) {
    if (debug) {
      console.log(`[auto-narrative-builder] resolveOptionalVnSteps(${genreCode}): skill=${!!skill} enableSteps=${skill?.enableSteps?.length ?? "n/a"} → []`);
    }
    return [];
  }
  const tpl = getPipelineTemplate("tpl-vn");
  const allowed = new Set(tpl.optionalSteps ?? []);
  const filtered = skill.enableSteps.filter((s) => allowed.has(s));
  if (debug) {
    console.log(`[auto-narrative-builder] resolveOptionalVnSteps(${genreCode}): enableSteps=[${skill.enableSteps.join(",")}] allowed=[${[...allowed].join(",")}] → [${filtered.join(",")}]`);
  }
  return filtered;
}

/**
 * 开放世界 RPG (rpg-open-world) 步骤序列：
 * 偏好 → 初步方案 → 世界观 → 区域设计 → 角色 → 涌现事件 → UI
 *
 * Lore 已集成至通用叙事 agent（emergent_event 内部按 needs.L 产出 lore 包），不再独立 step。
 */
function buildOpenWorldAutoSteps(
  req: NarrativeRequirements,
  _options: BuildAutoStepsOptions,
): string[] {
  const needs = req.needs;
  const C = needs.C ?? 0;

  const steps: string[] = [];
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);
  steps.push(S.WORLDVIEW);
  steps.push("region_design");
  if (C >= 2) steps.push(S.CHARACTER_ENRICHMENT);
  steps.push("emergent_event");
  return steps;
}

/**
 * 卡牌游戏 (card-ccg / card-dbg / card-boardgame) 步骤序列：
 * 偏好 → 初步方案 → 世界观 → 卡牌 Lore → 事件池 → UI
 */
function buildCardGameAutoSteps(
  _req: NarrativeRequirements,
  _options: BuildAutoStepsOptions,
): string[] {
  const steps: string[] = [];
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);
  steps.push(S.WORLDVIEW);
  steps.push("card_lore");
  steps.push("event_pool");
  return steps;
}

/**
 * 轻量管线 (tpl-light, Tier3 大部分品类)：
 * 偏好 → 初步方案 → 世界观 → 角色 → UI
 */
function buildLightAutoSteps(req: NarrativeRequirements): string[] {
  const needs = req.needs;
  const W = needs.W ?? 0;
  const C = needs.C ?? 0;

  const steps: string[] = [];
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);
  if (W >= 1) steps.push(S.WORLDVIEW);
  if (C >= 1) steps.push(S.CHARACTER_ENRICHMENT);
  return steps;
}

/**
 * 碎片化叙事 (tpl-fragmented)：Souls-like / Metroidvania / 心理恐怖 等
 * 偏好 → 初步方案 → 世界观 → 角色 → 道具 → 场景 → UI
 *
 * Lore 已集成至通用叙事 agent（在 item_database 与 scene_generation 内部按 needs.L 产出），
 * 不再独立 step。
 */
function buildFragmentedAutoSteps(req: NarrativeRequirements): string[] {
  const needs = req.needs;
  const C = needs.C ?? 0;
  const E = needs.E ?? 0;
  const I = needs.I ?? 0;

  const steps: string[] = [];
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);
  steps.push(S.WORLDVIEW);
  if (C >= 1) steps.push(S.CHARACTER_ENRICHMENT);
  if (I >= 1) steps.push(S.ITEM_DATABASE);
  if (E >= 1) steps.push(S.SCENE_GENERATION);
  return steps;
}

/**
 * 涌现叙事 (tpl-emergent)：4X / 沙盒 / 模拟经营 / 生存
 * 偏好 → 初步方案 → 世界观 → 涌现事件模板 → UI
 */
function buildEmergentAutoSteps(_req: NarrativeRequirements): string[] {
  const steps: string[] = [];
  steps.push(S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS);
  steps.push(S.INITIAL_PLAN);
  steps.push(S.WORLDVIEW);
  steps.push("emergent_event");
  return steps;
}

/**
 * 叙事卡 (tpl-narrative-card, Tier4 全部品类)：仅 narrative_card 一步生成。
 * 不进入 PREFERENCE / INITIAL_PLAN（避免对超休闲 / IO 等品类过度展开）。
 */
function buildNarrativeCardAutoSteps(): string[] {
  return [S.NARRATIVE_CARD];
}
