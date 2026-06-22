/**
 * step-registrations.ts — 所有活跃 step 的 StepDescriptor 注册
 *
 * 副作用文件：import 后自动注册所有 step 到 STEP_REGISTRY。
 * 按类别组织：偏好前置 → 叙事核心 → B3 模板步骤 → VN v2 → 策划 D0-D4 → 向后兼容
 */
import { registerStep } from "./step-registry.js";

// Step 函数导入（与 pipeline.ts 保持一致）
import { userPreferenceSummary } from "./steps/user-preference-summary.js";
import { userPreferenceAnalysis } from "./steps/user-preference-analysis.js";
import { initialPlan } from "./steps/initial-plan.js";
import { worldviewConstruction } from "./steps/worldview-construction.js";
import { characterEnrichment } from "./steps/character-enrichment.js";
import { itemDatabase } from "./steps/item-database.js";
import { storyFramework } from "./steps/story-framework.js";
import { outlineBatch } from "./steps/outline-batch.js";
import { detailedOutlineBatch } from "./steps/detailed-outline-batch.js";
import { plotGeneration } from "./steps/plot-generation.js";
import { scriptGeneration } from "./steps/script-generation.js";
import { questGeneration } from "./steps/quest-generation.js";
import { sceneGeneration } from "./steps/scene-generation.js";
import { scriptSceneGeneration } from "./steps/script-scene-generation.js";
import { narrativeCardGeneration } from "./steps/narrative-card.js";
import { loreGeneration } from "./steps/lore-generation.js";
import { branchTree } from "./steps/branch-tree.js";
import { dialogueScript } from "./steps/dialogue-script.js";
import { cinematicStoryboard } from "./steps/cinematic-storyboard.js";
import { regionDesign } from "./steps/region-design.js";
import { emergentEvent } from "./steps/emergent-event.js";
import { cardLore } from "./steps/card-lore.js";
import { eventPool } from "./steps/event-pool.js";
import {
  vnLogline,
  vnOutlineActs,
  vnScenes,
  vnBeats,
  vnScriptNormalize,
  vnSegmentConfirm,
  vnBranchedBeats,
  vnStateLedger,
  vnScreenplay,
  vnStoryboard,
} from "./steps/vn-v2/index.js";
import { coreConcept } from "./design-steps/core-concept.js";
import { systemArchitecture } from "./design-steps/system-architecture.js";
import { systemDetail } from "./design-steps/system-detail.js";
import { valueFramework } from "./design-steps/value-framework.js";
import { designDoc } from "./design-steps/design-doc.js";
import { initialStoryOutline } from "./steps/initial-story-outline.js";
import { coreSettingsExtraction } from "./steps/core-settings-extraction.js";
import { plotSynopsis } from "./steps/plot-synopsis.js";
import {
  structureValidationL1,
  structureValidationL2,
  structureValidationL3,
} from "./steps/structure-validation.js";

// ════════════════════════════════════════════════════════════
// A. 偏好前置（所有叙事品类必须执行）
// ════════════════════════════════════════════════════════════

registerStep({
  id: "preference_summary",
  name: "偏好总结",
  fn: userPreferenceSummary,
  extractOutputKey: "user_preference_summary",
  dependsOn: [],
  outputFields: ["user_preference_summary"],
});

registerStep({
  id: "preference_analysis",
  name: "偏好分析",
  fn: userPreferenceAnalysis,
  extractOutputKey: "user_preference_analysis",
  dependsOn: ["preference_summary"],
  outputFields: ["user_preference_analysis", "global_control_params"],
});

registerStep({
  id: "initial_plan",
  name: "初步方案",
  fn: initialPlan,
  extractOutputKey: "initial_plan",
  dependsOn: ["preference_analysis"],
  outputFields: ["initial_story_outline", "core_settings", "plot_synopsis", "target_acts"],
});

// ════════════════════════════════════════════════════════════
// B. 叙事核心步骤
// ════════════════════════════════════════════════════════════

registerStep({
  id: "worldview",
  name: "世界观构建",
  fn: worldviewConstruction,
  extractOutputKey: "worldview_structure",
  needsDesignContext: true,
  dependsOn: ["initial_plan"],
  outputFields: ["worldview_structure"],
  needsThreshold: { W: 1 },
});

registerStep({
  id: "character_enrichment",
  name: "角色档案",
  fn: characterEnrichment,
  extractOutputKey: "detailed_character_sheets",
  dependsOn: ["worldview"],
  outputFields: ["detailed_character_sheets", "player_name"],
  needsThreshold: { C: 2 },
});

registerStep({
  id: "item_database",
  name: "道具清单",
  fn: itemDatabase,
  extractOutputKey: "item_database",
  dependsOn: ["worldview", "character_enrichment"],
  outputFields: ["item_database"],
  needsThreshold: { I: 2 },
});

registerStep({
  id: "story_framework",
  name: "L0 故事框架",
  fn: storyFramework,
  extractOutputKey: "story_framework",
  // 七单品链式依赖：①初步方案→②世界观→③角色→④道具→⑤叙事(L0)。
  // item_database 仅在含道具的管线出现；缺席时该依赖对拓扑排序/下游计算无副作用。
  dependsOn: ["worldview", "character_enrichment", "item_database"],
  outputFields: ["story_framework"],
  needsThreshold: { S: 2 },
});

registerStep({
  id: "outline_batch",
  name: "L1 故事大纲",
  fn: outlineBatch,
  extractOutputKey: "outlines_generated",
  dependsOn: ["story_framework"],
  outputFields: ["outlines_generated"],
  derivedFields: ["l1_validation"],
  supportsNodeFilter: true,
  supportsSubEmit: true,
  needsThreshold: { S: 2 },
});

registerStep({
  id: "detailed_outline",
  name: "L2 故事细纲",
  fn: detailedOutlineBatch,
  extractOutputKey: "detailed_outlines_generated",
  dependsOn: ["outline_batch"],
  outputFields: ["detailed_outlines_generated"],
  derivedFields: ["l2_validation"],
  supportsNodeFilter: true,
  supportsSubEmit: true,
  needsThreshold: { S: 3 },
});

registerStep({
  id: "plot_generation",
  name: "L3 情节生成",
  fn: plotGeneration,
  extractOutputKey: "plots_generated",
  dependsOn: ["detailed_outline"],
  outputFields: ["plots_generated"],
  derivedFields: ["l3_validation"],
  supportsNodeFilter: true,
  supportsSubEmit: true,
  needsThreshold: { S: 3 },
});

registerStep({
  id: "script_generation",
  name: "L4 剧本生成",
  fn: scriptGeneration,
  extractOutputKey: "jrpg_script",
  dependsOn: ["plot_generation"],
  outputFields: ["jrpg_script"],
  supportsNodeFilter: true,
  supportsSubEmit: true,
  needsThreshold: { D: 3 },
});

registerStep({
  id: "quest_generation",
  name: "L5 任务生成",
  fn: questGeneration,
  extractOutputKey: "quest_graph",
  dependsOn: ["plot_generation"],
  outputFields: ["quest_graph"],
  needsThreshold: { Q: 2 },
});

registerStep({
  id: "scene_generation",
  name: "场景生成",
  fn: sceneGeneration,
  extractOutputKey: "scene_map",
  dependsOn: ["worldview", "story_framework", "outline_batch", "detailed_outline", "plot_generation"],
  outputFields: ["scene_map"],
  needsThreshold: { E: 2 },
});

registerStep({
  id: "script_scene_generation",
  name: "剧本+场景耦合生成",
  fn: scriptSceneGeneration,
  extractOutputKey: "script_scene",
  dependsOn: ["plot_generation"],
  outputFields: ["jrpg_script", "scene_map"],
});

registerStep({
  id: "narrative_card",
  name: "叙事卡",
  fn: narrativeCardGeneration,
  extractOutputKey: "narrative_card",
  dependsOn: [],
  outputFields: ["narrative_card"],
});

registerStep({
  id: "lore_generation",
  name: "Lore 碎片",
  fn: loreGeneration,
  extractOutputKey: "lore_fragments",
  dependsOn: ["worldview"],
  outputFields: ["lore_fragments"],
});

// ════════════════════════════════════════════════════════════
// C. B3 管线模板步骤（tpl-vn / tpl-open-world / tpl-card-game / tpl-emergent）
// ════════════════════════════════════════════════════════════

registerStep({
  id: "branch_tree",
  name: "剧情分支树",
  fn: branchTree,
  extractOutputKey: "branch_tree",
  dependsOn: ["initial_plan", "worldview", "character_enrichment"],
  outputFields: ["branch_tree"],
});

registerStep({
  id: "dialogue_script",
  name: "对话脚本",
  fn: dialogueScript,
  extractOutputKey: "dialogue_script",
  dependsOn: ["branch_tree"],
  outputFields: ["dialogue_script"],
});

registerStep({
  id: "cinematic_storyboard",
  name: "电影分镜",
  fn: cinematicStoryboard,
  extractOutputKey: "cinematic_storyboard",
  dependsOn: ["dialogue_script"],
  outputFields: ["cinematic_storyboard", "video_prompts"],
});

registerStep({
  id: "region_design",
  name: "区域设计",
  fn: regionDesign,
  extractOutputKey: "regions",
  dependsOn: ["worldview"],
  outputFields: ["regions"],
});

registerStep({
  id: "emergent_event",
  name: "涌现事件模板",
  fn: emergentEvent,
  extractOutputKey: "emergent_events",
  dependsOn: ["worldview"],
  outputFields: ["emergent_events"],
});

registerStep({
  id: "card_lore",
  name: "卡牌 Lore",
  fn: cardLore,
  extractOutputKey: "card_lore",
  dependsOn: ["worldview"],
  outputFields: ["card_lore"],
});

registerStep({
  id: "event_pool",
  name: "事件池",
  fn: eventPool,
  extractOutputKey: "event_pool",
  dependsOn: ["worldview"],
  outputFields: ["event_pool"],
});

// ════════════════════════════════════════════════════════════
// D. 影游叙事 v2 专属管线（tpl-vn-v2）— E1+E2+G 9 步
// ════════════════════════════════════════════════════════════

registerStep({
  id: "vn_logline",
  name: "E1-01 一句话故事梗概",
  fn: vnLogline,
  extractOutputKey: "vn_logline",
  dependsOn: [],
  outputFields: ["vn_logline"],
});

registerStep({
  id: "vn_outline_acts",
  name: "E1-02 三幕扩写",
  fn: vnOutlineActs,
  extractOutputKey: "vn_outline_acts",
  dependsOn: ["vn_logline"],
  outputFields: ["vn_outline_acts", "vn_character_bios", "vn_key_items"],
});

registerStep({
  id: "vn_scenes",
  name: "E1-03 场搭建",
  fn: vnScenes,
  extractOutputKey: "vn_scenes",
  dependsOn: ["vn_outline_acts", "worldview"],
  outputFields: ["vn_scenes"],
});

registerStep({
  id: "vn_beats",
  name: "E1-04 情节点搭建",
  fn: vnBeats,
  extractOutputKey: "vn_beats",
  dependsOn: ["vn_scenes"],
  outputFields: ["vn_beats"],
});

registerStep({
  id: "vn_script_normalize",
  name: "E2-01 用户剧本预处理",
  fn: vnScriptNormalize,
  extractOutputKey: "vn_script_normalized",
  dependsOn: ["vn_logline"],
  outputFields: ["vn_script_normalized"],
});

registerStep({
  id: "vn_segment_confirm",
  name: "E2-02 影游化文本段确认",
  fn: vnSegmentConfirm,
  extractOutputKey: "vn_segment_confirmed",
  dependsOn: ["vn_script_normalize"],
  outputFields: ["vn_segment_confirmed", "vn_outline_acts", "vn_scenes", "vn_beats", "vn_character_bios", "vn_key_items"],
});

registerStep({
  id: "vn_branched_beats",
  name: "G-01 剧情树改造",
  fn: vnBranchedBeats,
  extractOutputKey: "vn_branched_beats",
  dependsOn: ["vn_beats", "vn_scenes", "vn_outline_acts"],
  outputFields: ["vn_branched_beats"],
  temperature: 0.7,
});

registerStep({
  id: "vn_state_ledger",
  name: "G-01.5 世界状态账本",
  fn: vnStateLedger,
  extractOutputKey: "world_state_ledger",
  dependsOn: ["vn_branched_beats"],
  outputFields: ["world_state_ledger"],
  temperature: 0.3,
});

registerStep({
  id: "vn_screenplay",
  name: "G-02 剧本创作",
  fn: vnScreenplay,
  extractOutputKey: "vn_screenplay",
  dependsOn: ["vn_branched_beats", "vn_state_ledger"],
  outputFields: ["vn_screenplay"],
});

registerStep({
  id: "vn_storyboard",
  name: "G-03 分镜设计",
  fn: vnStoryboard,
  extractOutputKey: "vn_storyboard",
  dependsOn: ["vn_screenplay"],
  outputFields: ["vn_storyboard", "vn_video_prompts"],
});

// ════════════════════════════════════════════════════════════
// E. 策划步骤 D0-D4（不改，仅注册元数据）
// ════════════════════════════════════════════════════════════

registerStep({
  id: "core_concept",
  name: "D0 核心概念",
  fn: coreConcept,
  extractOutputKey: "core_concept",
  dependsOn: [],
  outputFields: ["core_concept"],
});

registerStep({
  id: "system_architecture",
  name: "D1 系统架构",
  fn: systemArchitecture,
  extractOutputKey: "system_architecture",
  dependsOn: ["core_concept"],
  outputFields: ["system_architecture"],
});

registerStep({
  id: "system_detail",
  name: "D2 玩法设计",
  fn: systemDetail,
  extractOutputKey: "system_details",
  dependsOn: ["system_architecture"],
  outputFields: ["system_details"],
});

registerStep({
  id: "value_framework",
  name: "D3 数值框架",
  fn: valueFramework,
  extractOutputKey: "value_framework",
  dependsOn: ["system_detail"],
  outputFields: ["value_framework"],
});

registerStep({
  id: "design_doc",
  name: "D4 策划案整合",
  fn: designDoc,
  extractOutputKey: "game_design_context",
  dependsOn: ["value_framework"],
  outputFields: ["game_design_context", "narrative_requirements"],
});

// ════════════════════════════════════════════════════════════
// F. 向后兼容（旧存档引用，仅注册使其可执行）
// ════════════════════════════════════════════════════════════

registerStep({
  id: "initial_outline",
  name: "初步大纲（旧）",
  fn: initialStoryOutline,
  extractOutputKey: "initial_story_outline",
  dependsOn: [],
  outputFields: ["initial_story_outline"],
});

registerStep({
  id: "core_settings",
  name: "核心设定（旧）",
  fn: coreSettingsExtraction,
  extractOutputKey: "core_settings",
  dependsOn: [],
  outputFields: ["core_settings"],
});

registerStep({
  id: "plot_synopsis",
  name: "剧情简介（旧）",
  fn: plotSynopsis,
  extractOutputKey: "plot_synopsis",
  dependsOn: [],
  outputFields: ["plot_synopsis"],
});

registerStep({
  id: "structure_validation_l1",
  name: "L1 结构验证（旧）",
  fn: structureValidationL1,
  extractOutputKey: "l1_validation",
  dependsOn: [],
  outputFields: ["l1_validation"],
});

registerStep({
  id: "structure_validation_l2",
  name: "L2 结构验证（旧）",
  fn: structureValidationL2,
  extractOutputKey: "l2_validation",
  dependsOn: [],
  outputFields: ["l2_validation"],
});

registerStep({
  id: "structure_validation_l3",
  name: "L3 结构验证（旧）",
  fn: structureValidationL3,
  extractOutputKey: "l3_validation",
  dependsOn: [],
  outputFields: ["l3_validation"],
});
