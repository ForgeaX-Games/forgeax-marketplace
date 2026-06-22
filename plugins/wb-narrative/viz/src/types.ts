/**
 * Shared types between narrative-studio backend and viz frontend.
 * Keep in sync with ../src/types/index.ts — only the subset needed by UI.
 */

export type TierId = "tier1" | "tier2" | "tier3" | "tier4";

export type ModeId =
  | "character"
  | "item_lore"
  | "scene"
  | "worldview"
  | "initial_outline"
  | "story_framework"
  | "story_outline"
  | "detailed_outline"
  | "novel"
  | "script"
  | "quest"
  | "full"
  | "narrative_card"
  | "tier2_enhanced"
  | "tier3_basic"
  | "fragmented"
  | "emergent"
  | "card_narrative"
  | "open_world_narrative"
  | "narrative_auto"
  | "design_auto"
  | "design_full_narrative"
  | "design_fragmented"
  | "design_emergent"
  | "design_only"
  | "vn_full"
  | "design_vn_full"
  | "vn_script"
  | "vn_storyboard_mode";

export type StepStatus = "pending" | "running" | "completed" | "failed";

export interface PipelineProgress {
  stage: string;
  stepId?: string;
  step: number;
  totalSteps: number;
  status: StepStatus;
  message?: string;
  data?: unknown;
  nodeId?: string;
  nodeDone?: number;
  nodeTotal?: number;
  type?: "streaming" | "pipeline_steps_announce";
  chunk?: string;
  accumulated?: string;
  // D4: pipeline_steps_announce payload
  steps?: string[];
  pipelineTemplate?: string;
  complexity?: number;
  routingMode?: "auto" | "semi" | "manual";
}

export interface RunStartResponse {
  id: string;
  status: "running";
  message: string;
  tier?: TierId;
  mode?: ModeId;
}

export interface RunStatusResponse {
  id: string;
  status: "running" | "completed" | "failed";
  progress: PipelineProgress[];
  error?: string;
  startedAt: string;
  tier?: TierId;
  mode?: ModeId;
}

export interface StepModification {
  original: unknown;
  edited?: unknown;
  userInstructions?: string;
  modifiedAt: string;
}

export interface StepMeta {
  needsRegen: boolean;
  modifications: StepModification[];
  version: number;
}

export interface RunResultResponse {
  id: string;
  status: "completed" | "failed" | "running" | "interrupted";
  result?: NarrativeContext;
  error?: string;
  message?: string;
  tier?: TierId;
  mode?: ModeId;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  completedSteps?: string[] | null;
  stepMeta?: Record<string, StepMeta> | null;
  // Phase 1: 后端持久化的"启动管线快照"。
  // genre_code: 当时跑的真实品类（manual fallback 不算）；
  // pipelineOrder: 当时跑的"权威步骤序"（含动态追加的 narrative steps）；
  // routingMode: auto | semi | manual。
  genre_code?: string;
  pipelineOrder?: string[];
  routingMode?: "auto" | "semi" | "manual";
}

export interface ModeInfo {
  id: ModeId;
  label: string;
  stepsCount: number;
}

export interface TierModeInfo {
  tier: TierId;
  defaultMode: ModeId;
  modes: ModeInfo[];
}

// Subset of NarrativeContext used by the viz
/**
 * 与 src/types/index.ts 的 InitialOutline 保持同步。
 * INITIAL_PLAN 合并步骤的子段，结构化对象（不再是 string）。
 */
export interface InitialOutline {
  theme: string;
  background: string;
  character_arc: string;
  main_conflict: string;
  story_structure: {
    opening: string;
    development: string[];
    ending: string;
  };
  key_plot_points: string[];
}

export interface NarrativeContext {
  user_input: string;
  user_preference_summary?: string;
  user_preference_analysis?: Record<string, unknown>;
  initial_story_outline?: InitialOutline;
  core_settings?: CoreSettings;
  worldview_structure?: WorldviewStructure;
  plot_synopsis?: PlotSynopsis;
  story_framework?: StoryFramework;
  outlines_generated?: OutlinesGenerated;
  detailed_outlines_generated?: DetailedOutlinesGenerated;
  detailed_character_sheets?: CharacterSheet[];
  plots_generated?: PlotsGenerated;
  jrpg_script?: JrpgScript;
  scene_map?: SceneMap;
  tier_detection?: TierDetectionResult;
  narrative_card?: NarrativeCard;
  lore_fragments?: LoreFragment[];
  item_lore?: ItemLore[];
  item_database?: Record<string, unknown>[];
  quest_graph?: { quests: Record<string, unknown>[]; main_quest_chain: string[]; branch_quests: Record<string, string[]> };
  // 策划管线数据 (D0-D4)
  demand_analysis?: Record<string, unknown>;
  core_concept?: Record<string, unknown>;
  system_architecture?: Record<string, unknown>;
  system_details?: Record<string, unknown>;
  value_framework?: Record<string, unknown>;
  game_design_context?: Record<string, unknown>;
  narrative_requirements?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CoreSettings {
  world_name: string;
  world_setting: string;
  world_summary: string;
  world_tags: { tone: string[]; theme: string[]; hook: string[] };
  protagonist: { name: string; identity: string; personality: string; core_conflict: string };
  key_npcs: Array<{ name: string; identity: string; personality: string; relationship_to_protagonist: string }>;
  main_theme: string;
  main_conflict: string;
  narrative_perspective: string;
  genre: string;
}

export interface WorldviewStructure {
  world_name: string;
  worldview_title?: string;
  [key: string]: unknown;
}

export interface PlotSynopsis {
  synopsis_strategy: string;
  synopsis: string;
  highlight_analysis: string;
}

export interface StoryNode {
  node_id: string;
  content_id?: string;
  name: string;
  narrative_function?: string;
  main_content?: string;
  content?: string;
  stage_type?: string;
  narrative_stage?: string;
  is_branch?: boolean;
  is_branch_point?: boolean;
  is_merge_point?: boolean;
  branch_letter?: string;
  prev_node?: string[];
  next_node?: string[];
  parent_id?: string;
  sequence_index?: number;
  story_elements?: {
    plot?: { cause?: string; process?: string; result?: string };
    dialogue_hint?: string;
    monologue_hint?: string;
    narration_hint?: string;
    atmosphere?: string;
  };
  boundary_constraints?: { cause?: string; result?: string };
  /**
   * 仅供 Detroit layout 算法解析 xKey 用的 "Detroit 风格 ID"（如 "1"、"2a"、"3"）。
   * 当 node_id 是语义化命名（如 "N_00_ROOT"、"A1_N12"）时必须填这个字段，
   * 否则列分配会失败。RPG story_framework / plot_generation 等本身就用 Detroit
   * 风格 id 的步骤可以不填（layout 会 fallback 到 node_id）。
   *
   * 显示层 / 引用关系（prev_node / next_node）仍用 node_id —— 这只是布局内部的别名。
   */
  _layoutId?: string;
  _rawData?: Record<string, unknown>;
}

export interface StoryFramework {
  framework: { nodes: StoryNode[] };
  dynamic_structure?: {
    structure_type: string;
    framework_nodes: StoryNode[];
    branch_groups?: Array<{ branch_at: string; branches: string[]; merge_at: string }>;
  };
}

export interface OutlinesGenerated {
  outlines: StoryNode[];
}

export interface DetailedOutlinesGenerated {
  detailed_outlines: StoryNode[];
}

export interface CharacterSheet {
  name: string;
  label: string;
  role_in_story?: string;
  [key: string]: unknown;
}

export interface PlotsGenerated {
  plots: StoryNode[];
  plot_id_map: Record<string, string>;
}

export interface ScriptChapter {
  chapter_id: string;
  node_id: string;
  plot_node_id: string;
  chapter_type: string;
  title: string;
  conflict: { type: string; tension_level: number; stakes: string; turning_point: string };
  character_arcs: Array<{ character: string; arc_phase: string; emotional_shift: string; growth: string }>;
  scenes: ScriptScene[];
  prev_node?: string[];
  next_node?: string[];
  is_branch?: boolean;
  narrative_stage?: string;
}

export interface ScriptContentItem {
  type: string;
  speaker?: string;
  text: string;
  emotion?: string;
  action?: string;
  subtext?: string;
}

export interface ScriptScene {
  scene_id: string;
  location: string;
  atmosphere: string;
  camera_direction?: string;
  bgm?: string;
  content: ScriptContentItem[];
}

export interface JrpgScript {
  title: string;
  chapters: ScriptChapter[];
}

export interface SceneDescription {
  location_description: string;
  art_style_description: string;
  semantics_description: string;
}

export type SceneLabel = "narrative" | "decoration" | "path" | "entrance";

export interface SceneNode {
  uid: string;
  name: string;
  parent: string;
  parent_uid?: string | null;
  parent_name?: string | null;
  parent_level?: number | null;
  scene_level?: number;
  label: SceneLabel[] | string;
  description: SceneDescription | string;
  level?: number;
  story_units?: string[];
}

export interface SkeletonLayerScene {
  name: string;
  parent: string;
  level?: number;
  label?: unknown;
  description?: unknown;
}

export interface SceneMap {
  world_name: string;
  scenes: SceneNode[];
  _phase1_skeleton?: SceneNode[];
  _phase1_by_layer?: {
    l0: SkeletonLayerScene[];
    l1: SkeletonLayerScene[];
    l2: SkeletonLayerScene[];
  };
  _phase2_per_node?: Record<string, SceneNode[]>;
  _phase2_per_node_md?: Record<string, string>;
  _scene_structure_md?: string;
}

export interface TierDetectionResult {
  tier: TierId;
  genre_code: string;
  genre_name: string;
  reasoning: string;
}

export interface NarrativeCard {
  game_name: string;
  one_liner: string;
  story: string;
  gameplay_mapping: Record<string, string>;
  level_expansion: {
    scene_line: string;
    difficulty_line: string;
    final_chapter: string;
  };
}

export interface LoreFragment {
  id: string;
  type: string;
  title: string;
  content: string;
  source_location?: string;
  related_characters?: string[];
}

export interface ItemLore {
  item_name: string;
  item_type: string;
  rarity: string;
  lore_text: string;
  flavor_text: string;
}

/** Pipeline step definition for the UI */
export interface PipelineStepDef {
  id: string;
  label: string;
  type: "pipeline" | "story" | "special";
}

export const STEP_CTX_FIELD: Record<string, string> = {
  preference_summary: "user_preference_summary",
  preference_analysis: "user_preference_analysis",
  initial_plan: "initial_plan",
  worldview: "worldview_structure",
  story_framework: "story_framework",
  outline_batch: "outlines_generated",
  detailed_outline: "detailed_outlines_generated",
  character_enrichment: "detailed_character_sheets",
  item_database: "item_database",
  plot_generation: "plots_generated",
  script_generation: "jrpg_script",
  quest_generation: "quest_graph",
  scene_generation: "scene_map",
  script_scene_generation: "jrpg_script",
  narrative_card: "narrative_card",
  lore_generation: "lore_fragments",
  // B3 新模板专属步骤
  branch_tree: "branch_tree",
  dialogue_script: "dialogue_script",
  cinematic_storyboard: "cinematic_storyboard",
  region_design: "regions",
  emergent_event: "emergent_events",
  card_lore: "card_lore",
  event_pool: "event_pool",
  // 互动影游 v2 专属步骤（tpl-vn-v2）
  vn_logline: "vn_logline",
  vn_outline_acts: "vn_outline_acts",
  vn_scenes: "vn_scenes",
  vn_beats: "vn_beats",
  vn_script_normalize: "vn_script_normalized",
  vn_segment_confirm: "vn_segment_confirmed",
  vn_branched_beats: "vn_branched_beats",
  vn_screenplay: "vn_screenplay",
  vn_storyboard: "vn_storyboard",
  // 策划步骤 (D0-D4)
  core_concept: "core_concept",
  system_architecture: "system_architecture",
  system_detail: "system_details",
  value_framework: "value_framework",
  design_doc: "game_design_context",
  // ── 向后兼容（旧存档可能包含这些 id；前端忽略时不渲染）──
  initial_outline: "initial_story_outline",
  core_settings: "core_settings",
  plot_synopsis: "plot_synopsis",
  structure_validation_l1: "l1_validation",
  structure_validation_l2: "l2_validation",
  structure_validation_l3: "l3_validation",
};

export const PIPELINE_STEPS: PipelineStepDef[] = [
  { id: "tier_router", label: "品类识别", type: "pipeline" },
  { id: "pipeline_config", label: "管线配置", type: "pipeline" },
  // 策划步骤 (D0-D4)
  { id: "core_concept", label: "D0 核心概念", type: "pipeline" },
  { id: "system_architecture", label: "D1 系统架构", type: "pipeline" },
  { id: "system_detail", label: "D2 玩法设计", type: "pipeline" },
  { id: "value_framework", label: "D3 数值框架", type: "pipeline" },
  { id: "design_doc", label: "D4 策划案整合", type: "pipeline" },
  // 叙事步骤
  { id: "preference_summary", label: "偏好总结", type: "pipeline" },
  { id: "preference_analysis", label: "偏好分析", type: "pipeline" },
  { id: "initial_plan", label: "初步方案", type: "pipeline" },
  { id: "worldview", label: "世界观构建", type: "pipeline" },
  { id: "character_enrichment", label: "角色档案", type: "pipeline" },
  { id: "item_database", label: "道具清单", type: "pipeline" },
  { id: "story_framework", label: "L0 故事框架", type: "story" },
  { id: "outline_batch", label: "L1 故事大纲", type: "story" },
  { id: "detailed_outline", label: "L2 故事细纲", type: "story" },
  { id: "plot_generation", label: "L3 情节生成", type: "story" },
  { id: "script_generation", label: "L4 剧本生成", type: "story" },
  { id: "quest_generation", label: "L5 任务生成", type: "story" },
  { id: "scene_generation", label: "场景生成", type: "story" },
  { id: "script_scene_generation", label: "剧本+场景", type: "story" },
  // B3 新模板专属步骤
  { id: "branch_tree", label: "分支树（VN）", type: "story" },
  { id: "dialogue_script", label: "对话脚本（VN）", type: "story" },
  { id: "cinematic_storyboard", label: "影像分镜（互动影游）", type: "story" },
  // 互动影游 v2 专属管线（tpl-vn-v2）9 步独立 step
  { id: "vn_logline",         label: "E1-01 一句话故事梗概",     type: "story" },
  { id: "vn_outline_acts",    label: "E1-02 三幕扩写",            type: "story" },
  { id: "vn_scenes",          label: "E1-03 场搭建",             type: "story" },
  { id: "vn_beats",           label: "E1-04 情节点搭建",         type: "story" },
  { id: "vn_script_normalize", label: "E2-01 用户剧本预处理",    type: "story" },
  { id: "vn_segment_confirm", label: "E2-02 影游化文本段确认",   type: "story" },
  { id: "vn_branched_beats",  label: "G-01 剧情树改造",          type: "story" },
  { id: "vn_screenplay",      label: "G-02 剧本创作",            type: "story" },
  { id: "vn_storyboard",      label: "G-03 分镜设计",            type: "story" },
  { id: "region_design", label: "区域设计（开放世界）", type: "story" },
  { id: "emergent_event", label: "涌现事件（开放世界/沙盒）", type: "story" },
  { id: "card_lore", label: "卡牌 Lore", type: "story" },
  { id: "event_pool", label: "事件池", type: "story" },
  // 终点/特殊
  { id: "narrative_card", label: "叙事卡", type: "special" },
  { id: "lore_generation", label: "Lore 碎片", type: "special" },
  // ── 向后兼容（旧存档显示用，不出现在任何模板的步骤列表）──
  { id: "initial_outline", label: "初步大纲（已合并）", type: "pipeline" },
  { id: "core_settings", label: "核心设定（已合并）", type: "pipeline" },
  { id: "plot_synopsis", label: "剧情简介（已合并）", type: "pipeline" },
  { id: "structure_validation_l1", label: "L1 结构验证（已废弃）", type: "pipeline" },
  { id: "structure_validation_l2", label: "L2 结构验证（已废弃）", type: "pipeline" },
  { id: "structure_validation_l3", label: "L3 结构验证（已废弃）", type: "pipeline" },
];
