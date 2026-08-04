/**
 * Pipeline Templates (B1)
 * ─────────────────────────────────────────────────────────────────
 * 8 个固定的"管线形态"模板。每个模板对应一个游戏品类家族
 * （RPG / VN / 开放世界 / 卡牌 / 碎片化 / 涌现 / 叙事卡 / 轻量）。
 *
 * 一个 Genre 通过 genreCode → pipelineTemplate 的映射选取模板，
 * 模板再决定 step 列表（可被 Mode 的 target_endpoint 截断）。
 *
 * ⚠️ 这一层不直接执行 LLM。它只是数据描述，被 modes.ts / pipeline.ts 消费。
 *
 * @deprecated Phase 6: 管线步骤选择已迁移至 Planner 引擎（pipeline/planner/）。
 * 此文件保留用于 use_legacy_pipeline=true 回退路径和 rerunFromStep 历史兼容。
 * 新增品类/步骤变更应修改 planner/presets.ts，而非此文件。
 */
import { STEP_IDS as S } from "./modes.js";

export type PipelineTemplateId =
  | "tpl-jrpg"            // 新架构 JRPG 预制管线（V1 槽位化提示词库）
  | "tpl-jrpg-v2"         // 归档：原精调 RPG/JRPG 管线（V2 整体提示词）
  | "tpl-rpg"             // [DEPRECATED alias] = tpl-jrpg-v2；历史 checkpoint 兼容
  | "tpl-vn"              // [DEPRECATED] 视觉小说/互动影游（分支树+对话脚本）— 仅兼容历史数据
  | "tpl-vn-v2"           // 互动影游归档精调（V2）；新架构朴素代号 tpl-vn 二期再建
  | "tpl-open-world"      // 开放世界 RPG（区域+涌现事件）
  | "tpl-card-game"       // 卡牌游戏（卡牌 Lore + 事件池）
  | "tpl-fragmented"      // 碎片化叙事（Souls-like / Metroidvania）
  | "tpl-emergent"        // 涌现性叙事（4X / 沙盒）
  | "tpl-narrative-card"  // Tier4 叙事卡（一步生成）
  | "tpl-light";          // Tier3 轻量（仅 4 步）

export interface PipelineTemplate {
  id: PipelineTemplateId;
  label: string;
  description: string;
  /** 步骤序列（与 ModeConfig.steps 同构，支持嵌套数组表示并行组） */
  steps: Array<string | string[]>;
  /** 可选的扩展步骤：默认关闭，可被 skill md frontmatter 的 enableSteps 启用 */
  optionalSteps?: string[];
  /** 该模板适配的 tier 范围（用于 UI 显示与校验） */
  tiers: Array<"tier1" | "tier2" | "tier3" | "tier4">;
}

// ─────────────────────────────────────────────────────────────────
// 共享步骤片段（与 modes.ts 保持一致以避免漂移）
// ─────────────────────────────────────────────────────────────────
const PREF = [S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS];
const BASE = [...PREF, S.INITIAL_PLAN, S.WORLDVIEW];
const ENTITIES = [S.CHARACTER_ENRICHMENT, S.ITEM_DATABASE];

/** JRPG 全量步序（新架构 tpl-jrpg 与归档 tpl-jrpg-v2 共享；差异在提示词库版本）。 */
export const JRPG_PIPELINE_STEPS: Array<string | string[]> = [
  ...BASE,
  ...ENTITIES,
  S.STORY_FRAMEWORK,
  S.OUTLINE_BATCH,
  S.DETAILED_OUTLINE,
  S.PLOT_GENERATION,
  S.SCRIPT_GENERATION,
  [S.QUEST_GENERATION, S.SCENE_GENERATION],
];

// ─────────────────────────────────────────────────────────────────
// 管线模板
// ─────────────────────────────────────────────────────────────────

export const PIPELINE_TEMPLATES: Record<PipelineTemplateId, PipelineTemplate> = {
  "tpl-jrpg": {
    id: "tpl-jrpg",
    label: "tpl-jrpg",
    description:
      "新架构 JRPG 预制管线（V1）：由单品工程师组合而成的工作流；提示词从三轴槽位库按需组装。",
    tiers: ["tier1"],
    steps: [...JRPG_PIPELINE_STEPS],
  },

  "tpl-jrpg-v2": {
    id: "tpl-jrpg-v2",
    label: "tpl-jrpg-v2",
    description:
      "归档精调 JRPG/RPG 管线（V2）：原 tpl-rpg 整体提示词；legacy 与对照基线保留可跑。",
    tiers: ["tier1"],
    steps: [...JRPG_PIPELINE_STEPS],
  },

  "tpl-rpg": {
    id: "tpl-rpg",
    label: "tpl-jrpg-v2",
    description:
      "[DEPRECATED alias → tpl-jrpg-v2] 历史 checkpoint / genre 映射兼容；新代码请用 tpl-jrpg 或 tpl-jrpg-v2。",
    tiers: ["tier1"],
    steps: [...JRPG_PIPELINE_STEPS],
  },

  "tpl-vn": {
    id: "tpl-vn",
    label: "[已废弃] 视觉小说 / 互动影游 v1",
    description: "[历史兼容用] 旧版 VN 管线：偏好 → 初步方案 → 世界观 → 角色 → 分支树 → 对话脚本。新工程请使用 tpl-vn-v2。",
    tiers: ["tier2"],
    steps: [
      ...BASE,
      S.CHARACTER_ENRICHMENT,
      "branch_tree",
      "dialogue_script",
    ],
    optionalSteps: ["cinematic_storyboard"],
  },

  "tpl-vn-v2": {
    id: "tpl-vn-v2",
    // 展示层去 v2 后缀（命名统一，§Phase5）；底层 id 保持 tpl-vn-v2 以兼容历史 checkpoint/模板注册。
    label: "互动影游（专属管线）",
    description:
      "影游叙事专属管线：E1（Logline → 三幕 → 情节点黄金线）→ G（剧情树改造〔含场号导出〕 → 剧本创作 → 分镜设计）。" +
      "上传剧本时自动切换到 E2 入口（剧本预处理 → 文本段确认 → 跳过 E1 中下层），E1 与 E2 互斥。" +
      "借用 世界观 一步（已注入 vn-v2 上下文），不再包含 RPG 范式的偏好分析（vn 用 logline+三幕直接驱动）。",
    tiers: ["tier1", "tier2"],
    steps: [
      // E1：故事结构
      S.VN_LOGLINE,            // E1-01
      S.VN_OUTLINE_ACTS,       // E1-02（三幕 + 人物小传，单步双输出）
      // 借用：世界观（影游写实风格 skill 注入；context_inputs 已读取 vn_logline / vn_outline_acts / vn_character_bios）
      S.WORLDVIEW,
      S.VN_SCENES,             // E1-03
      S.VN_BEATS,              // E1-04
      // G：剧情树 + 状态账本 + 剧本 + 分镜
      S.VN_BRANCHED_BEATS,     // G-01
      S.VN_STATE_LEDGER,       // G-01.5
      S.VN_SCREENPLAY,         // G-02
      S.VN_STORYBOARD,         // G-03
    ],
    // E2 路径动态接管：has_uploaded_script=true 时 pipeline.ts 把 E1 中下层
    // (VN_OUTLINE_ACTS / VN_SCENES / VN_BEATS) 替换为 (VN_SCRIPT_NORMALIZE / VN_SEGMENT_CONFIRM)
    optionalSteps: [S.VN_SCRIPT_NORMALIZE, S.VN_SEGMENT_CONFIRM],
  },

  "tpl-open-world": {
    id: "tpl-open-world",
    label: "开放世界 RPG",
    description: "开放世界：偏好 → 初步方案 → 世界观 → 区域设计 → 角色 → 涌现事件（Lore 由通用叙事 agent 内嵌产出）",
    tiers: ["tier1"],
    steps: [
      ...BASE,
      "region_design",    // B3 stub
      S.CHARACTER_ENRICHMENT,
      "emergent_event",   // B3 stub
      // Lore (L) 已由通用叙事 agent 在区域/角色/事件中内嵌产出，不再驱动独立 step
    ],
  },

  "tpl-card-game": {
    id: "tpl-card-game",
    label: "卡牌游戏叙事",
    description: "CCG / Card Narrative：偏好 → 初步方案 → 世界观 → 卡牌 Lore → 事件池",
    tiers: ["tier2", "tier3"],
    steps: [
      ...BASE,
      "card_lore",        // B3 stub
      "event_pool",       // B3 stub
    ],
  },

  "tpl-fragmented": {
    id: "tpl-fragmented",
    label: "碎片化叙事",
    description: "Souls-like / Metroidvania：偏好 → 初步方案 → 世界观 → 角色 → 道具 → 场景（Lore 由通用叙事 agent 内嵌产出）",
    tiers: ["tier1", "tier2", "tier3"],
    steps: [
      ...BASE,
      S.CHARACTER_ENRICHMENT,
      S.ITEM_DATABASE,           // 物品/碎片/笔记承载 Lore 的载体
      // Lore (L) 已由通用叙事 agent 在 item_database 中内嵌产出，不再驱动独立 step
      S.SCENE_GENERATION,
    ],
  },

  "tpl-emergent": {
    id: "tpl-emergent",
    label: "涌现性叙事",
    description: "4X / 沙盒：偏好 → 初步方案 → 世界观 → 事件模板",
    tiers: ["tier2", "tier3"],
    steps: [
      ...BASE,
      "emergent_event",   // 复用同一 step
    ],
  },

  "tpl-narrative-card": {
    id: "tpl-narrative-card",
    label: "叙事卡（Tier4）",
    description: "Tier4 极简：narrative_card 一步生成",
    tiers: ["tier4"],
    steps: [S.NARRATIVE_CARD],
  },

  "tpl-light": {
    id: "tpl-light",
    label: "轻量管线（Tier3）",
    description: "Tier3 大部分品类：偏好 → 初步方案 → 世界观 → 角色",
    tiers: ["tier3"],
    steps: [
      ...BASE,
      S.CHARACTER_ENRICHMENT,
    ],
  },
};

export function getPipelineTemplate(id: PipelineTemplateId): PipelineTemplate {
  const tpl = PIPELINE_TEMPLATES[id];
  if (!tpl) throw new Error(`Unknown pipeline template: ${id}`);
  return tpl;
}

/**
 * Resolve the effective step sequence for a template, given optional skill-driven enables.
 * Optional steps are appended in their declared order at the end of the template.
 */
export function resolveTemplateSteps(
  templateId: PipelineTemplateId,
  enableOptionalSteps: string[] = [],
): Array<string | string[]> {
  const tpl = getPipelineTemplate(templateId);
  if (!enableOptionalSteps.length || !tpl.optionalSteps?.length) {
    return [...tpl.steps];
  }
  const enable = new Set(
    enableOptionalSteps.filter((s) => tpl.optionalSteps!.includes(s)),
  );
  if (enable.size === 0) return [...tpl.steps];

  const out: Array<string | string[]> = [...tpl.steps];
  for (const opt of enable) out.push(opt);
  return out;
}
