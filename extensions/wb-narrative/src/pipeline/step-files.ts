/**
 * step-files.ts — 产物落盘命名表（step / 派生字段 → 文件名前缀）。
 *
 * 原本埋在 api/server.ts 里，只有落盘那一处用得上。席位层要据此推导
 * 「某助手的产物长什么前缀」投影给前端两库，就不能再是私有常量了——
 * 抽成共享模块，落盘与归类共用同一张表。
 *
 * 键既有 step id，也有派生字段名（vn_character_bios / item_lore 这类
 * 由某一步顺带产出、需要单独落盘的东西）。
 */

export const STEP_FILE_MAP: Record<string, { index: string; name: string; ext: string }> = {
  preference_summary:   { index: "00", name: "偏好总结",   ext: "md" },
  preference_analysis:  { index: "01", name: "偏好分析",   ext: "json" },
  // 合并步骤 INITIAL_PLAN：一次 LLM 调用产出 outline + core_settings + plot_synopsis 三段，
  // 输出统一为 1 个 JSON 文件 02_初步方案.json，三段作为 top-level keys。
  // 老的 initial_outline / core_settings / plot_synopsis 不再独立落盘（仅 STEP_CTX_KEY
  // 保留作为存档编辑的兼容兜底；fork 拷贝循环按 STEP_FILE_MAP 遍历，不会再写老格式）。
  initial_plan:         { index: "02", name: "初步方案",   ext: "json" },
  worldview:            { index: "04", name: "世界观",     ext: "json" },
  story_framework:      { index: "06", name: "故事框架",   ext: "json" },
  outline_batch:        { index: "07", name: "故事大纲",   ext: "json" },
  detailed_outline:     { index: "08", name: "故事细纲",   ext: "json" },
  character_enrichment: { index: "09", name: "角色档案",   ext: "json" },
  item_database:        { index: "10", name: "道具清单",   ext: "json" },
  plot_generation:      { index: "11", name: "情节节点",   ext: "json" },
  script_generation:    { index: "12", name: "剧本节点",   ext: "json" },
  quest_generation:     { index: "13", name: "任务节点",   ext: "json" },
  scene_generation:     { index: "14", name: "场景节点",   ext: "json" },
  script_scene_generation: { index: "12", name: "剧本场景", ext: "json" },
  structure_validation_l1: { index: "07a", name: "L1结构验证", ext: "json" },
  structure_validation_l2: { index: "08a", name: "L2结构验证", ext: "json" },
  structure_validation_l3: { index: "11a", name: "L3结构验证", ext: "json" },
  lore_generation:      { index: "15", name: "Lore碎片",   ext: "json" },
  narrative_card:       { index: "17", name: "叙事卡",     ext: "json" },
  // 路由与全局参数
  tier_detection:         { index: "T0", name: "品类识别",     ext: "json" },
  demand_analysis:        { index: "T1", name: "需求分析",     ext: "json" },
  global_control_params:  { index: "01a", name: "全局控制参数", ext: "json" },
  // 策划步骤 (D0-D4)
  core_concept:           { index: "D0", name: "核心概念",     ext: "json" },
  system_architecture:    { index: "D1", name: "系统架构",     ext: "json" },
  system_detail:          { index: "D2", name: "玩法设计",     ext: "json" },
  value_framework:        { index: "D3", name: "数值框架",     ext: "json" },
  design_doc:             { index: "D4", name: "策划案整合",   ext: "json" },
  narrative_requirements: { index: "D4a", name: "叙事需求",    ext: "json" },
  // 叙事步骤附属数据
  item_lore:              { index: "15a", name: "物品Lore",    ext: "json" },
  // B3 + Stage C：互动影游 / VN / 开放世界 / 卡牌等模板专属步骤
  // 必须有 STEP_FILE_MAP 条目，否则 fork 时这些步骤的已生成产物不会被拷到新目录，
  // 也不会被 saveStepIncremental 落盘成单独文件（前端"已保留"卡片打开会空白）
  branch_tree:            { index: "B0", name: "分支树",       ext: "json" },
  dialogue_script:        { index: "B1", name: "对话脚本",     ext: "json" },
  cinematic_storyboard:   { index: "B2", name: "电影分镜",     ext: "json" },
  region_design:          { index: "B3", name: "区域设计",     ext: "json" },
  emergent_event:         { index: "B4", name: "涌现事件",     ext: "json" },
  card_lore:              { index: "B5", name: "卡牌Lore",     ext: "json" },
  event_pool:             { index: "B6", name: "事件池",       ext: "json" },
  // tpl-vn-v2 专属步骤
  vn_logline:             { index: "V0", name: "需求预处理",   ext: "json" },
  vn_outline_acts:        { index: "V1", name: "三幕扩写",     ext: "json" },
  vn_character_bios:      { index: "V1a", name: "人物小传",    ext: "json" },
  vn_key_items:           { index: "V1b", name: "关键道具",    ext: "json" },
  vn_scenes:              { index: "V2", name: "场搭建",       ext: "json" },
  vn_beats:               { index: "V3", name: "情节点搭建",   ext: "json" },
  vn_script_normalize:    { index: "V4", name: "剧本预处理",   ext: "json" },
  vn_segment_confirm:     { index: "V5", name: "文本段确认",   ext: "json" },
  vn_branched_beats:      { index: "V6", name: "剧情树改造",   ext: "json" },
  vn_state_ledger:        { index: "V6a", name: "世界状态账本", ext: "json" },
  vn_screenplay:          { index: "V7", name: "剧本创作",     ext: "json" },
  vn_storyboard:          { index: "V8", name: "分镜设计",     ext: "json" },
  vn_video_prompts:       { index: "V9", name: "视频提示词",   ext: "json" },
};
