import type { TierId, ModeId, ModeConfig, StepOrGroup } from "../types/index.js";

export const STEP_IDS = {
  // 偏好分析
  PREFERENCE_SUMMARY: "preference_summary",
  PREFERENCE_ANALYSIS: "preference_analysis",
  // 初步方案（合并步骤：大纲 + 核心设定 + 剧情简介）
  INITIAL_PLAN: "initial_plan",
  // 叙事结构步骤
  WORLDVIEW: "worldview",
  CHARACTER_ENRICHMENT: "character_enrichment",
  ITEM_DATABASE: "item_database",
  STORY_FRAMEWORK: "story_framework",
  OUTLINE_BATCH: "outline_batch",
  DETAILED_OUTLINE: "detailed_outline",
  PLOT_GENERATION: "plot_generation",
  SCRIPT_GENERATION: "script_generation",
  SCENE_GENERATION: "scene_generation",
  QUEST_GENERATION: "quest_generation",
  SCRIPT_SCENE_GENERATION: "script_scene_generation",
  // 路由/辅助步骤
  TIER_ROUTER: "tier_router",
  NARRATIVE_CARD: "narrative_card",
  LORE_GENERATION: "lore_generation",
  // 策划步骤 (D0-D4)
  CORE_CONCEPT: "core_concept",
  SYSTEM_ARCHITECTURE: "system_architecture",
  SYSTEM_DETAIL: "system_detail",
  VALUE_FRAMEWORK: "value_framework",
  DESIGN_DOC: "design_doc",

  // 影游叙事 v2 专属管线（tpl-vn-v2）
  // 与 MyFile/提示词/影游叙事生成提示词/01-09_*.md 一一对应
  VN_LOGLINE: "vn_logline",                       // E1-01 用户需求预处理（一句话故事梗概）
  VN_OUTLINE_ACTS: "vn_outline_acts",             // E1-02 三幕扩写（三幕 + 人物小传 + 关键道具）
  VN_SCENES: "vn_scenes",                         // E1-03 场搭建
  VN_BEATS: "vn_beats",                           // E1-04 情节点搭建（线性）
  VN_SCRIPT_NORMALIZE: "vn_script_normalize",     // E2-01 用户剧本预处理
  VN_SEGMENT_CONFIRM: "vn_segment_confirm",       // E2-02 影游化文本段确认
  VN_BRANCHED_BEATS: "vn_branched_beats",         // G-01 剧情树改造
  VN_STATE_LEDGER: "vn_state_ledger",             // G-01.5 世界状态账本
  VN_SCREENPLAY: "vn_screenplay",                 // G-02 剧本创作
  VN_STORYBOARD: "vn_storyboard",                 // G-03 分镜设计

  // ── 向后兼容 IDs（旧存档引用，不出现在任何 mode 步骤列表中）──
  INITIAL_OUTLINE: "initial_outline",
  CORE_SETTINGS: "core_settings",
  PLOT_SYNOPSIS: "plot_synopsis",
  STRUCTURE_VALIDATION_L1: "structure_validation_l1",
  STRUCTURE_VALIDATION_L2: "structure_validation_l2",
  STRUCTURE_VALIDATION_L3: "structure_validation_l3",
} as const;

const S = STEP_IDS;

// ─────────────────────────────────────────────────────────
// 步骤片段（原子块，自底向上组合）
// ─────────────────────────────────────────────────────────

const PREF = [S.PREFERENCE_SUMMARY, S.PREFERENCE_ANALYSIS];

const DESIGN = [
  S.CORE_CONCEPT,
  S.SYSTEM_ARCHITECTURE,
  S.SYSTEM_DETAIL,
  S.VALUE_FRAMEWORK,
  S.DESIGN_DOC,
];

/** 通用基础：偏好 + 初步方案 + 世界观 */
const BASE = [...PREF, S.INITIAL_PLAN, S.WORLDVIEW];

/** 实体层：角色 + 道具（世界观之后、L0 之前） */
const ENTITIES: string[] = [S.CHARACTER_ENRICHMENT, S.ITEM_DATABASE];

// ─────────────────────────────────────────────────────────
// 累积序列（方便 Mode 引用）
// ─────────────────────────────────────────────────────────

const UP_TO_WORLDVIEW = BASE;
const UP_TO_ENTITIES = [...BASE, ...ENTITIES];
const UP_TO_FRAMEWORK = [...UP_TO_ENTITIES, S.STORY_FRAMEWORK];
const UP_TO_OUTLINE = [...UP_TO_FRAMEWORK, S.OUTLINE_BATCH];
const UP_TO_DETAILED = [...UP_TO_OUTLINE, S.DETAILED_OUTLINE];
const UP_TO_NOVEL = [...UP_TO_DETAILED, S.PLOT_GENERATION];
const UP_TO_SCRIPT = [...UP_TO_NOVEL, S.SCRIPT_GENERATION];
const UP_TO_QUEST = [...UP_TO_SCRIPT, S.QUEST_GENERATION];

// ─────────────────────────────────────────────────────────
// Phase 1: 通用前驱（Tier 两档 × 路由类型）
//
// 设计：Planner 仅需「品类 + 复杂度」两个输入即可定位完整管线。
//   品类 → 派生 tier → 选定通用前驱档位；
//   品类 skill.narrativeSteps → 专属叙事段（拼接在前驱之后）。
//
// 两档：
//   T1/T2（完整前驱）：偏好总结 → 偏好分析 → 初步方案 → 世界观 → 主要角色 → 关键道具
//   T3/T4（简化前驱）：偏好总结 → 偏好分析 → 初步方案
//
// 路由类型：
//   design_full（策划全量）：在通用前驱前拼接 D0-D4 策划链
//   narrative_single（叙事单品）：纯叙事前驱，无 D0-D4
// ─────────────────────────────────────────────────────────

/** 叙事单品 T1/T2 完整前驱：偏好 → 初步方案 → 世界观 → 角色 → 道具 */
export const PRELUDE_NARRATIVE_FULL: string[] = [...BASE, ...ENTITIES];
/** 叙事单品 T3/T4 简化前驱：偏好 → 初步方案 */
export const PRELUDE_NARRATIVE_LITE: string[] = [...PREF, S.INITIAL_PLAN];
/** 策划全量 T1/T2 完整前驱：D0-D4 → 偏好 → 初步方案 → 世界观 → 角色 → 道具 */
export const PRELUDE_DESIGN_FULL: string[] = [...DESIGN, ...BASE, ...ENTITIES];
/** 策划全量 T3/T4 简化前驱：D0-D4 → 偏好 → 初步方案 */
export const PRELUDE_DESIGN_LITE: string[] = [...DESIGN, ...PREF, S.INITIAL_PLAN];

export type PreludeRoute = "narrative_single" | "design_full";

/**
 * 按「路由类型 + tier」返回通用前驱步骤序列。
 *
 * - T1/T2 → 完整前驱（含世界观/角色/道具）
 * - T3/T4 → 简化前驱（仅偏好 + 初步方案）
 * - design_full 路由额外在最前面拼接 D0-D4 策划链
 *
 * 返回的前驱之后由 Planner 拼接品类 skill.narrativeSteps 专属叙事段。
 */
export function getPrelude(route: PreludeRoute, tier: TierId): string[] {
  const full = tier === "tier1" || tier === "tier2";
  if (route === "design_full") {
    return full ? [...PRELUDE_DESIGN_FULL] : [...PRELUDE_DESIGN_LITE];
  }
  return full ? [...PRELUDE_NARRATIVE_FULL] : [...PRELUDE_NARRATIVE_LITE];
}

/**
 * RPG 七单品链（叙事单品路由，链式依赖固化）：
 *   ①初步方案 → ②世界观 → ③角色 → ④道具 → ⑤叙事(L0-L4) → ⑥任务(L5) → ⑦场景
 * 与 step-registrations 的 dependsOn 链一一对应。
 */
export const RPG_SEVEN_ITEM_CHAIN: Array<string | string[]> = [
  ...PREF,
  S.INITIAL_PLAN,        // ①
  S.WORLDVIEW,           // ②
  S.CHARACTER_ENRICHMENT,// ③
  S.ITEM_DATABASE,       // ④
  S.STORY_FRAMEWORK,     // ⑤ L0
  S.OUTLINE_BATCH,       //   L1
  S.DETAILED_OUTLINE,    //   L2
  S.PLOT_GENERATION,     //   L3
  S.SCRIPT_GENERATION,   //   L4
  [S.QUEST_GENERATION, S.SCENE_GENERATION], // ⑥任务 ∥ ⑦场景
];

/**
 * 完整管线：L0-L4 → L5/场景（并行）
 *
 * Lore 已集成到通用叙事 agent 内部（按 needs.L 维度由 capability 产出，不再独立 step）。
 * lore_generation step 保留用于向后兼容（旧存档），但不在任何 mode 主动调用。
 * UI 文案 / 运营文案已从叙事模块移除。
 */
const FULL: Array<string | string[]> = [
  ...UP_TO_SCRIPT,
  [S.QUEST_GENERATION, S.SCENE_GENERATION],
];

// ─────────────────────────────────────────────────────────
// Mode 配置
//
// B4 注解：每个 mode 都标注了 (pipeline_template, target_endpoint) 二元组，
// 实现"模板形态 × 停止点"的正交分解。UI 不变，但底层数据结构显式化。
//
// B5 deprecation 候选（保留不删，避免破坏用户工作流）：
//   - "scene"：与 "full" 完全等价
//   - "tier2_enhanced" / "tier3_basic"：可被 narrative_auto + 对应 tier 替代
//   未来可在 UI 隐藏这些 mode 但保留后端识别。
// ─────────────────────────────────────────────────────────

/**
 * @deprecated Phase 6: 动态模式（narrative_auto / design_auto）的步骤选择已迁移至
 * Planner 引擎。MODE_CONFIGS 中的静态 steps 列表仅用于：
 *   1. use_legacy_pipeline=true 回退路径
 *   2. 非动态模式（design_full_narrative 等）的固定步骤序列
 *   3. rerunFromStep 历史兼容
 * 新增品类/步骤变更应修改 planner/presets.ts。
 */
export const MODE_CONFIGS: ModeConfig[] = [
  // ═══════════════════════════════════════════
  //  纯叙事模式
  // ═══════════════════════════════════════════

  {
    id: "initial_outline",
    label: "初步方案",
    tiers: ["tier1", "tier2", "tier3"],
    steps: [...PREF, S.INITIAL_PLAN],
    showComplexity: false,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.INITIAL_PLAN,
  },
  {
    id: "worldview",
    label: "世界观",
    tiers: ["tier1", "tier2", "tier3"],
    steps: UP_TO_WORLDVIEW,
    showComplexity: false,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.WORLDVIEW,
  },
  {
    // [角色] = [世界观] + character_enrichment（不含 item_database）。
    // item_database 是 [道具] 路由的产出，[角色] 应当严格收口于角色档案。
    id: "character",
    label: "角色档案",
    tiers: ["tier1", "tier2"],
    steps: [...UP_TO_WORLDVIEW, S.CHARACTER_ENRICHMENT],
    showComplexity: false,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.CHARACTER_ENRICHMENT,
  },
  {
    // [道具] 仅产出 item_database（含基本道具说明）。
    // 道具背后的 Lore 由通用叙事 agent 内部产出（needs.L），不再独立 lore_generation 步骤。
    id: "item_lore",
    label: "道具",
    tiers: ["tier1", "tier2"],
    steps: [...UP_TO_WORLDVIEW, S.CHARACTER_ENRICHMENT, S.ITEM_DATABASE],
    showComplexity: false,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.ITEM_DATABASE,
  },
  {
    id: "story_framework",
    label: "故事框架 (L0)",
    tiers: ["tier1", "tier2"],
    steps: UP_TO_FRAMEWORK,
    showComplexity: true,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.STORY_FRAMEWORK,
  },
  {
    id: "story_outline",
    label: "故事大纲 (L1)",
    tiers: ["tier1", "tier2"],
    steps: UP_TO_OUTLINE,
    showComplexity: true,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.OUTLINE_BATCH,
  },
  {
    id: "detailed_outline",
    label: "故事细纲 (L2)",
    tiers: ["tier1", "tier2"],
    steps: UP_TO_DETAILED,
    showComplexity: true,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.DETAILED_OUTLINE,
  },
  {
    id: "novel",
    label: "情节 (L3)",
    tiers: ["tier1", "tier2"],
    steps: UP_TO_NOVEL,
    showComplexity: true,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.PLOT_GENERATION,
  },
  {
    id: "script",
    label: "剧本 (L4)",
    tiers: ["tier1"],
    steps: UP_TO_SCRIPT,
    showComplexity: true,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.SCRIPT_GENERATION,
  },
  {
    id: "quest",
    label: "任务 (L5)",
    tiers: ["tier1"],
    steps: UP_TO_QUEST,
    showComplexity: true,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.QUEST_GENERATION,
  },
  {
    id: "full",
    label: "全量生成",
    tiers: ["tier1"],
    steps: FULL,
    showComplexity: true,
    pipeline_template: "tpl-rpg",
  },
  {
    // [场景] = [任务] + scene_generation（不含 lore，与 full 区分）
    // 非 RPG 品类的 scene_generation 由通用场景 agent / region_design / cinematic_storyboard 替换
    id: "scene",
    label: "场景生成（任务 + 场景节点）",
    tiers: ["tier1", "tier2"],
    steps: [...UP_TO_QUEST, S.SCENE_GENERATION],
    showComplexity: true,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.SCENE_GENERATION,
  },

  // ═══════════════════════════════════════════
  //  风格化叙事模式（需求驱动品类适配）
  // ═══════════════════════════════════════════

  {
    // 碎片化叙事 — 世界观→角色→道具→场景→碎片叙事(lore)。环境/物品/Lore 承载碎片。
    id: "fragmented",
    label: "碎片化叙事（环境+物品驱动）",
    tiers: ["tier1", "tier2", "tier3"],
    steps: [
      ...BASE,
      S.CHARACTER_ENRICHMENT,
      S.ITEM_DATABASE,
      S.SCENE_GENERATION,
      S.LORE_GENERATION,
    ],
    showComplexity: true,
    pipeline_template: "tpl-fragmented",
  },
  {
    // 涌现叙事 — 世界观→角色→道具→场景→涌现事件。系统驱动事件池。
    id: "emergent",
    label: "涌现叙事（事件模板+世界框架）",
    tiers: ["tier2", "tier3"],
    steps: [
      ...BASE,
      S.CHARACTER_ENRICHMENT,
      S.ITEM_DATABASE,
      S.SCENE_GENERATION,
      "emergent_event",
    ],
    showComplexity: false,
    pipeline_template: "tpl-emergent",
  },
  {
    // 卡牌叙事 — 世界观→卡牌设定→事件池（叙事单品，无 D0-D4）。
    id: "card_narrative",
    label: "卡牌叙事（卡牌设定+事件池）",
    tiers: ["tier2", "tier3"],
    steps: [
      ...BASE,
      "card_lore",
      "event_pool",
    ],
    showComplexity: false,
    pipeline_template: "tpl-card-game",
  },
  {
    // 开放世界叙事 — 世界观→角色→道具→区域设计→涌现事件→[任务∥场景]（叙事单品，无 D0-D4）。
    id: "open_world_narrative",
    label: "开放世界叙事（区域+涌现事件）",
    tiers: ["tier1", "tier2"],
    steps: [
      ...BASE,
      S.CHARACTER_ENRICHMENT,
      S.ITEM_DATABASE,
      "region_design",
      "emergent_event",
      [S.QUEST_GENERATION, S.SCENE_GENERATION],
    ] as StepOrGroup[],
    showComplexity: true,
    pipeline_template: "tpl-open-world",
  },
  {
    id: "narrative_auto",
    label: "自动（根据品类需求动态组合叙事）",
    tiers: ["tier1", "tier2", "tier3", "tier4"],
    steps: [],
    showComplexity: true,
    isDynamic: true,
    // pipeline_template / target_endpoint 都为 undef → 完全由 needs/genre 动态决定
  },

  // ═══════════════════════════════════════════
  //  Tier 直通模式
  // ═══════════════════════════════════════════

  {
    // Tier2 增强管线 — Lore 已由叙事 agent 内嵌产出，UI 上的"Lore"特性通过 needs.L 体现。
    id: "tier2_enhanced",
    label: "Tier2 增强管线（道具 + 细纲）",
    tiers: ["tier2"],
    steps: [
      ...UP_TO_DETAILED,
    ],
    showComplexity: true,
    pipeline_template: "tpl-rpg",
    target_endpoint: S.DETAILED_OUTLINE,
  },
  {
    id: "tier3_basic",
    label: "Tier3 基础管线（世界观+角色+道具）",
    tiers: ["tier3"],
    steps: [
      ...UP_TO_ENTITIES,
    ],
    showComplexity: false,
    pipeline_template: "tpl-light",
  },
  {
    id: "narrative_card",
    label: "Tier4 叙事卡（极简一步生成）",
    tiers: ["tier4"],
    steps: [S.NARRATIVE_CARD],
    showComplexity: false,
    pipeline_template: "tpl-narrative-card",
    target_endpoint: S.NARRATIVE_CARD,
  },

  // ═══════════════════════════════════════════
  //  策划+叙事联合模式
  // ═══════════════════════════════════════════

  {
    id: "design_auto",
    label: "策划+自动叙事",
    tiers: ["tier1", "tier2", "tier3", "tier4"],
    steps: [...DESIGN],
    showComplexity: true,
    isDynamic: true,
    // pipeline_template / target_endpoint 由 LLM/needs 动态决定
  },
  {
    id: "design_full_narrative",
    label: "策划+全量叙事",
    tiers: ["tier1"],
    steps: [...DESIGN, ...FULL] as StepOrGroup[],
    showComplexity: true,
    pipeline_template: "tpl-rpg",
  },
  {
    id: "design_fragmented",
    label: "策划+碎片化叙事",
    tiers: ["tier1", "tier2", "tier3"],
    steps: [
      ...DESIGN,
      ...BASE,
      S.CHARACTER_ENRICHMENT,
      S.ITEM_DATABASE,
      S.SCENE_GENERATION,
    ],
    showComplexity: true,
    pipeline_template: "tpl-fragmented",
  },
  {
    id: "design_emergent",
    label: "策划+涌现叙事",
    tiers: ["tier2", "tier3"],
    steps: [
      ...DESIGN,
      ...BASE,
      S.CHARACTER_ENRICHMENT,
      "emergent_event",
    ],
    showComplexity: false,
    pipeline_template: "tpl-emergent",
  },
  {
    id: "design_only",
    label: "仅策划案",
    tiers: ["tier1", "tier2", "tier3", "tier4"],
    steps: DESIGN,
    showComplexity: false,
    target_endpoint: S.DESIGN_DOC,
  },

  // ═══════════════════════════════════════════
  //  影游叙事 v2 专属入口（tpl-vn-v2）
  //  纯叙事入口（无 D0-D4）：vn_full
  //  策划+叙事入口：design_vn_full
  //  上传剧本时由 pipeline.ts 在 VN_BEATS 后动态插入 VN_SCRIPT_NORMALIZE + VN_SEGMENT_CONFIRM
  // ═══════════════════════════════════════════

  {
    id: "vn_full",
    label: "互动影游 v2（全量叙事）",
    tiers: ["tier1", "tier2"],
    steps: [
      S.VN_LOGLINE,
      S.VN_OUTLINE_ACTS,
      S.WORLDVIEW,
      S.VN_SCENES,
      S.VN_BEATS,
      S.VN_BRANCHED_BEATS,
      S.VN_STATE_LEDGER,
      S.VN_SCREENPLAY,
      S.VN_STORYBOARD,
    ],
    showComplexity: true,
    pipeline_template: "tpl-vn-v2",
  },
  {
    id: "vn_script",
    label: "影游剧本（止于剧本创作）",
    tiers: ["tier1", "tier2"],
    steps: [
      S.VN_LOGLINE,
      S.VN_OUTLINE_ACTS,
      S.WORLDVIEW,
      S.VN_SCENES,
      S.VN_BEATS,
      S.VN_BRANCHED_BEATS,
      S.VN_STATE_LEDGER,
      S.VN_SCREENPLAY,
    ],
    showComplexity: true,
    pipeline_template: "tpl-vn-v2",
    target_endpoint: S.VN_SCREENPLAY,
  },
  {
    id: "vn_storyboard_mode",
    label: "影游分镜（含剧本+分镜）",
    tiers: ["tier1", "tier2"],
    steps: [
      S.VN_LOGLINE,
      S.VN_OUTLINE_ACTS,
      S.WORLDVIEW,
      S.VN_SCENES,
      S.VN_BEATS,
      S.VN_BRANCHED_BEATS,
      S.VN_STATE_LEDGER,
      S.VN_SCREENPLAY,
      S.VN_STORYBOARD,
    ],
    showComplexity: true,
    pipeline_template: "tpl-vn-v2",
    target_endpoint: S.VN_STORYBOARD,
  },
  {
    id: "design_vn_full",
    label: "策划+互动影游 v2",
    tiers: ["tier1", "tier2"],
    steps: [
      ...DESIGN,
      S.VN_LOGLINE,
      S.VN_OUTLINE_ACTS,
      S.WORLDVIEW,
      S.VN_SCENES,
      S.VN_BEATS,
      S.VN_BRANCHED_BEATS,
      S.VN_STATE_LEDGER,
      S.VN_SCREENPLAY,
      S.VN_STORYBOARD,
    ],
    showComplexity: true,
    pipeline_template: "tpl-vn-v2",
  },
];

/** Tier 的默认 Mode 映射 — 所有 Tier 默认走 design_auto */
export const TIER_DEFAULT_MODE: Record<TierId, ModeId> = {
  tier1: "design_auto",
  tier2: "design_auto",
  tier3: "design_auto",
  tier4: "design_auto",
};

export function getModeConfig(modeId: ModeId): ModeConfig {
  const config = MODE_CONFIGS.find((m) => m.id === modeId);
  if (!config) throw new Error(`Unknown mode: ${modeId}`);
  return config;
}

export function getModesForTier(tier: TierId): ModeConfig[] {
  return MODE_CONFIGS.filter((m) => m.tiers.includes(tier));
}

/**
 * Maps each pipeline step ID to the NarrativeContext field keys it produces.
 * Used by rerunFromStep to clear stale outputs before re-execution.
 */
export const STEP_OUTPUT_FIELDS: Record<string, string[]> = {
  [S.PREFERENCE_SUMMARY]:      ["user_preference_summary"],
  [S.PREFERENCE_ANALYSIS]:     ["user_preference_analysis", "global_control_params"],
  // 合并步骤：清除所有三个子字段 + 副作用字段 target_acts
  [S.INITIAL_PLAN]:            ["initial_story_outline", "core_settings", "plot_synopsis", "target_acts"],
  [S.WORLDVIEW]:               ["worldview_structure"],
  [S.CHARACTER_ENRICHMENT]:    ["detailed_character_sheets", "player_name"],
  [S.ITEM_DATABASE]:           ["item_database"],
  [S.STORY_FRAMEWORK]:         ["story_framework"],
  // OUTLINE_BATCH 内含 L1 验证，清除 outlines + validation
  [S.OUTLINE_BATCH]:           ["outlines_generated", "l1_validation"],
  // DETAILED_OUTLINE 内含 L2 验证
  [S.DETAILED_OUTLINE]:        ["detailed_outlines_generated", "l2_validation"],
  // PLOT_GENERATION 内含 L3 验证
  [S.PLOT_GENERATION]:         ["plots_generated", "l3_validation"],
  [S.SCRIPT_GENERATION]:       ["jrpg_script"],
  [S.QUEST_GENERATION]:        ["quest_graph"],
  [S.SCENE_GENERATION]:        ["scene_map"],
  [S.SCRIPT_SCENE_GENERATION]: ["jrpg_script", "scene_map"],
  [S.NARRATIVE_CARD]:          ["narrative_card"],
  [S.LORE_GENERATION]:         ["lore_fragments"],
  // 新管线模板步骤（B3 + Stage C/D）
  // cinematic_storyboard 完成后会派生 video_prompts（assembleVideoPrompts），
  // fork 整步重跑时必须一起清，否则旧 video_prompts 会与新 storyboard 不匹配。
  branch_tree:                 ["branch_tree"],
  dialogue_script:             ["dialogue_script"],
  cinematic_storyboard:        ["cinematic_storyboard", "video_prompts"],
  // 影游叙事 v2 专属管线（tpl-vn-v2）字段清除映射
  [S.VN_LOGLINE]:               ["vn_logline"],
  // E1-02 三幕扩写：同步产出三幕 + 人物小传 + 关键道具三份
  [S.VN_OUTLINE_ACTS]:          ["vn_outline_acts", "vn_character_bios", "vn_key_items"],
  [S.VN_SCENES]:                ["vn_scenes"],
  [S.VN_BEATS]:                 ["vn_beats"],
  [S.VN_SCRIPT_NORMALIZE]:      ["vn_script_normalized"],
  [S.VN_SEGMENT_CONFIRM]:       ["vn_segment_confirmed", "vn_outline_acts", "vn_scenes", "vn_beats", "vn_character_bios"],
  [S.VN_BRANCHED_BEATS]:        ["vn_branched_beats"],
  [S.VN_STATE_LEDGER]:           ["world_state_ledger"],
  [S.VN_SCREENPLAY]:            ["vn_screenplay"],
  [S.VN_STORYBOARD]:            ["vn_storyboard", "vn_video_prompts"],
  region_design:               ["regions"],
  emergent_event:              ["emergent_events"],
  card_lore:                   ["card_lore"],
  event_pool:                  ["event_pool"],
  // 策划步骤 (D0-D4)
  [S.CORE_CONCEPT]:            ["core_concept"],
  [S.SYSTEM_ARCHITECTURE]:     ["system_architecture"],
  [S.SYSTEM_DETAIL]:           ["system_details"],
  [S.VALUE_FRAMEWORK]:         ["value_framework"],
  [S.DESIGN_DOC]:              ["game_design_context", "narrative_requirements"],
  // 向后兼容：旧存档中这些步骤独立存在时的清除映射
  [S.INITIAL_OUTLINE]:         ["initial_story_outline"],
  [S.CORE_SETTINGS]:           ["core_settings"],
  [S.PLOT_SYNOPSIS]:           ["plot_synopsis"],
  [S.STRUCTURE_VALIDATION_L1]: ["l1_validation"],
  [S.STRUCTURE_VALIDATION_L2]: ["l2_validation"],
  [S.STRUCTURE_VALIDATION_L3]: ["l3_validation"],
};
