/**
 * 初步方案的结构化大纲（替代原 Markdown 文本）。
 * 下游步骤通过 JSON.stringify 将其转为 LLM 上下文；
 * 前端按需渲染为可读文本。
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

/**
 * 上传剧本元数据 + 原文。
 *
 * 设计动机：之前 user_input 既装"用户在输入框写的口头需求"又装"上传剧本全文"，
 * 5000 字截断后剧本被砍掉一大半，且各步骤无法区分两者。
 *
 * 这一字段把"上传剧本"独立出来：
 *   - content     原文（mammoth 解析后的 .docx / utf8 .txt；前端保留二进制由后端解析）
 *   - format      script-format-detector 识别出来的格式（json/fountain/markdown/dialogue/prose）
 *   - char_count  字符数，用于 resolveTargetActs 兑底（长篇 → 多幕）
 *   - file_name / size / mime  仅用于存档和 UI 显示
 *
 * 各 step prompt 同时引用 user_input（口头需求）+ uploaded_script.content（剧本素材），
 * 实现"忠实素材原文 + 满足用户额外要求"的双重契约。
 */
export interface UploadedScript {
  content: string;
  format: "json" | "fountain" | "markdown" | "dialogue" | "prose";
  char_count: number;
  estimated_word_count?: number;
  file_name?: string;
  size?: number;
  mime?: string;
  /** detector 给的人类可读说明，可直接拼到 prompt 里 */
  description?: string;
}

export interface NarrativeContext {
  user_input: string;
  /**
   * 前端选定的有效复杂度档位（1-5）。由 pipeline.run 从 PipelineConfig.complexity 注入，
   * 供不跑 preference_analysis（即 global_control_params 为空）的管线（如 tpl-vn-v2）读取节点预算。
   * RPG 仍以 global_control_params.complexity 为权威，此字段仅作兜底来源。
   */
  complexity?: number;
  uploaded_script?: UploadedScript;
  user_preference_summary?: string;
  user_preference_analysis?: PreferenceAnalysis;
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
  item_database?: GameItem[];
  quest_graph?: QuestGraph;
  player_name?: string;
  global_control_params?: GlobalControlParams;

  // ── IP DNA（输入理解产物，A 套数据，§4.1）──
  // narrativeIpDna 与上述生成字段（B 套数据）并列；A 经双向映射喂入 B。
  // 类型见 ./narrative-ip-dna.ts（NarrativeIpDna = 叙事层级树 × 三件套）。
  narrativeIpDna?: import("./narrative-ip-dna.js").NarrativeIpDna;
  /** 改编指令（§4.4）：改编范围 + 游戏单元规划 + 改编维度。 */
  adaptation_directive?: import("./narrative-ip-dna.js").AdaptationDirective;
  /** 用户资产参考清单（§6.2）。 */
  user_asset_manifest?: import("./narrative-ip-dna.js").UserAssetManifest;
  /** 全局故事/项目标题（§6.5），策划 D0 或叙事首阶段生成，全局传递。 */
  story_title?: string;
  /** 完整故事时间戳（§6.0），贯穿 input→output 的同一主键。 */
  story_timestamp?: import("./narrative-ip-dna.js").StoryTimestamp;
  /** KAG 关系网络注入简报（§8）：角色关系/场景子图压缩文本，供生成节点保持一致性。 */
  relation_network?: string;

  // 策划管线数据 (D0-D4)
  demand_analysis?: import("./game-design.js").DemandAnalysis;
  core_concept?: import("./game-design.js").CoreConcept;
  system_architecture?: import("./game-design.js").SystemArchitecture;
  system_details?: import("./game-design.js").SystemDetails;
  value_framework?: import("./game-design.js").ValueFramework;
  game_design_context?: import("./game-design.js").GameDesignContext;
  narrative_requirements?: import("./game-design.js").NarrativeRequirements;

  // 影游叙事 v2 管线产出（tpl-vn-v2，9 步专属）
  vn_logline?: VnLogline;                       // E1-01
  /** VN 目标幕数（§4.6 开放幕数）：由复杂度/目标节点数派生（resolveVnActCount）；缺省 3 幕。 */
  vn_target_act_count?: number;
  vn_outline_acts?: VnOutlineActs;              // E1-02 (开放幕数，默认三幕)
  vn_character_bios?: VnCharacterBios;          // E1-02 (人物小传)
  vn_key_items?: VnKeyItems;                    // E1-02 (关键道具)
  vn_scenes?: VnScenes;                         // E1-03
  vn_beats?: VnBeats;                           // E1-04
  vn_script_normalized?: VnScriptNormalized;    // E2-01
  vn_segment_confirmed?: VnSegmentConfirmed;    // E2-02
  vn_branched_beats?: VnBranchedBeats;          // G-01
  world_state_ledger?: WorldStateLedger;         // G-01.5
  vn_screenplay?: VnScreenplay;                 // G-02
  vn_storyboard?: VnStoryboard;                 // G-03

  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────
// 影游叙事 v2 数据结构（与 MyFile/提示词/影游生成方案.md 对齐）
// 编号体系：场=<数字>，情节点=<数字>.<数字>，分镜=<数字>.<数字>-<数字>
// 三维场状态：location_name + time_of_day(日|夜) + indoor_outdoor(内|外)
// ─────────────────────────────────────────────────────────────────

/** E1-01 一句话故事梗概 */
export interface VnLogline {
  title: string;
  content: string;       // 五要素融合的一段叙述
}

/** 三幕剧本结构（act_id 用汉字 一/二/三） */
export interface VnOutlineActs {
  title: string;
  acts: VnAct[];
  central_theme?: string;
}

export interface VnAct {
  /**
   * 幕编号。历史上用汉字 一/二/三（固定三幕）；现已开放幕数（§4.6 VN 适配），
   * 类型放宽为 string，仍以汉字数字序列（一/二/…/十）表达，保持序号语义与向后兼容。
   */
  act_id: string;
  act_name: string;      // 建置/对抗/解决（或自定义）
  content: string;       // 五要素融合段落（150/300/150 字建议）
}

/** 人物小传 */
export interface VnCharacterBios {
  characters: VnCharacterBio[];
}

export interface VnCharacterBio {
  name: string;
  role: string;          // 主角/反派/配角…
  identity: string;
  external_motivation: string;   // 外驱
  internal_motivation: string;   // 内驱
  arc?: string;
  voice?: string;
  visual?: string;
}

/** 关键道具（E1-02 与三幕、人物小传同步产出） */
export interface VnKeyItems {
  items: VnKeyItem[];
}

export interface VnKeyItem {
  name: string;
  category?: string;             // 信物/武器/线索/契约物/媒介…
  description: string;           // 外形、来历、质感
  narrative_function: string;    // 在剧情中的作用（推动/转折/揭示/制约）
  bound_character?: string;      // 关联人物（与 character_bios.name 呼应）
  act_appearance?: ("一" | "二" | "三")[];  // 在哪几幕出现/起关键作用
  symbolism?: string;            // 象征意涵
}

/** E1-03 场（Scene）— 数字 ID + 三维状态 */
export interface VnScenes {
  scenes: VnScene[];
}

export interface VnScene {
  scene_id: string;                          // "1", "2", "3"…（纯数字字符串）
  act_id: string;                            // 幕编号（开放幕数，汉字数字序列）
  location_name: string;
  time_of_day: "日" | "夜";
  indoor_outdoor: "内" | "外";
  content: string;                            // 五要素融合段落
  is_main_line?: boolean;                     // 默认 true；G-01 改造后支线场为 false
  branch_origin_beat?: string;                // 支线起源情节点 ID（仅支线场用）
}

/** E1-04 情节点（Beat）线性版 — 尚未分支 */
export interface VnBeats {
  beats: VnBeat[];
}

export interface VnBeat {
  beat_id: string;                            // "1.1", "1.2", "2.1"…
  scene_id: string;                           // 所属场（首次时间轴上的归属）
  content: string;                            // 五要素融合段落
}

/** E2-01 用户剧本预处理（mode + raw + 推断的层级） */
export interface VnScriptNormalized {
  source_format: "json" | "fountain" | "markdown" | "dialogue" | "prose";
  inferred_layers: {
    has_acts: boolean;
    has_scenes: boolean;
    has_beats: boolean;
  };
  acts?: VnAct[];
  scenes?: VnScene[];
  beats?: VnBeat[];
  raw_segments?: Array<{ id: string; text: string }>;
}

/** E2-02 影游化文本段确认（截取 + 重新分幕的子剧本） */
export interface VnSegmentConfirmed {
  selected_range: { start: string; end: string };  // 起止 beat_id 或 scene_id
  acts: VnAct[];        // 重新分幕后的三幕
  scenes: VnScene[];
  beats: VnBeat[];
  preserved: boolean;   // true=已有原文一字不改；false=允许"二创"新增
  /**
   * E2 路径 character_bios：从截取段中抽取的人物小传。
   * E1 路径由 vn_outline_acts 同步产出 vn_character_bios；E2 路径跳过了 vn_outline_acts，
   * 必须在此处补出，否则 G-01 vn_branched_beats / G-02 vn_screenplay 会面对空角色清单。
   */
  character_bios?: VnCharacterBios;
  /**
   * E2 路径 key_items：从截取段中抽取的关键道具（与 E1-02 的 vn_key_items 对齐）。
   * 让 G-01/G-02 在两条入口下都能把"叙事硬抓手"喂入。原文无明显关键道具时可省略。
   */
  key_items?: VnKeyItems;
}

/** G-01 剧情树改造产物 — 含分支与多结局，beat 显式 prev/next + pivot_kind */
export interface VnBranchedBeats {
  acts: VnAct[];
  scenes: VnScene[];          // 含支线新增场（is_main_line=false）
  beats: VnBranchedBeat[];
  endings: VnEnding[];
  branch_summary?: {
    pivot_choice_count: number;
    pivot_branch_qte_count: number;
    ending_h_count: number;
    ending_b_count: number;
    ending_o_count: number;
  };
}

export interface VnBranchedBeat {
  beat_id: string;                           // "1.1", "2.3"...
  scene_id: string;
  content: string;
  prev_nodes: string[];                      // 上游 beat_id（root 为空）
  next_nodes: VnNextEdge[];                  // 下游链接（含 label/kind）
  is_main_line: boolean;
  is_ending: boolean;
  ending_label?: "H" | "B" | "O";            // 仅 is_ending=true 时给
  pivot_kind?: "choice" | "branch_qte";      // 该 beat 的判定类型（叶子可省）
  branch_origin_beat?: string;               // 该 beat 所在支线起源（main 为空）
  /**
   * 分支代价档（仅 pivot beat 给）——决定这组选项的"分支程度/代价量级"：
   *   - converge：路径不同、结果相同（一般犯错可改正，代价=绕远/损耗，各支走若干代价 beat 后汇回）
   *   - diverge ：路径天壤之别、结局不同（抉择真正分岔人生，长链不汇）
   *   - terminal：分支程度过大 → 直接走向结局（致命错误=局部 bad / 决定性正确=提前圆满）
   */
  branch_type?: "converge" | "diverge" | "terminal";
  /** 该 beat 的时空坐标（G-01 原生输出） */
  spacetime?: BeatSpaceTime;
  /** 该 beat 触发的世界状态变更（无变化的过渡 beat 可省略或给空数组） */
  state_deltas?: StateChange[];
}

export interface VnNextEdge {
  to: string;                                // 目标 beat_id 或 ending_id
  kind: "linear" | "choice" | "branch_qte" | "merge_back";
  label?: string;                            // UI 标签 A/B/C/D（choice 时）
  condition?: string;                        // 触发条件描述（可选）
}

export interface VnEnding {
  ending_id: string;                         // "END_H1", "END_B1"…
  label: "H" | "B" | "O";
  title: string;
  content: string;
  trigger?: string;
  /**
   * 结局作用域：
   *   - global：全局大结局（剧终，通常聚集在最后一幕的终极抉择之后）
   *   - local ：局部结局（中段触发的 game over / 提前圆满，如致命 QTE 失败）
   * 缺省视为 global（向后兼容旧数据）。
   */
  scope?: "local" | "global";
}

/** G-02 剧本（screenplay）— description + dialogue + 互动元件双轨 */
export interface VnScreenplay {
  beats: VnBeatScreenplay[];
  /** 部分场/子批生成失败时的降级告警（非致命；对应 beat 已用占位剧本保留拓扑） */
  warnings?: string[];
}

export interface VnBeatScreenplay {
  beat_id: string;
  scene_id: string;
  description: string;                       // ▲ 视觉动作（画面描写）
  dialogue: VnDialogueLine[];
  options?: VnChoiceOption[];                // 选项型 pivot（与 branch_qte 互斥）
  branch_qte?: VnBranchQTE;                  // 决策 QTE 型 pivot
  /** @deprecated 演出型 QTE 已全局停用（剧情完全靠决策推进）；保留字段仅为向后兼容历史数据，新生成不再产出 */
  performance?: VnPerformanceItem[];
}

export interface VnDialogueLine {
  kind: "dialogue" | "inner_monologue" | "narration" | "sfx";
  speaker?: string;                          // sfx/narration 可空
  text: string;
  emotion?: string;
}

export interface VnChoiceOption {
  label: "A" | "B" | "C" | "D";
  text: string;
  leads_to_beat: string;                     // 目标 beat_id
  cost?: string;                             // 取舍/代价描述
  persona_alignment?: string;                // 人设契合度提示
}

export interface VnBranchQTE {
  visual_action: string;                     // "3 秒内长按拉开衣柜"（未来 QTE 机制预留）
  duration_ms: number;                       // 限时毫秒数（未来 QTE 机制预留）
  /** @deprecated 路由统一由 options[].leads_to_beat 承载 */
  pass_leads_to_beat?: string;
  /** @deprecated 路由统一由 options[].leads_to_beat 承载 */
  fail_leads_to_beat?: string;
  /** @deprecated 文本统一由 options[].text 承载 */
  pass_text?: string;
  /** @deprecated 文本统一由 options[].text 承载 */
  fail_text?: string;
}

/** @deprecated 演出型 QTE 已全局停用；类型保留仅为兼容历史数据 */
export interface VnPerformanceItem {
  kind: "performance_qte" | "touch_hotspot";
  visual_action: string;
  duration_ms: number;
  success_effect: string;
  fail_effect: string;
}

/** G-03 分镜（storyboard）— 分镜挂在 beat 下 */
export interface VnStoryboard {
  storyboards: VnBeatStoryboard[];
  /** 部分场/子批生成失败时的降级告警（非致命；对应 beat 已用占位分镜保留拓扑） */
  warnings?: string[];
}

export interface VnBeatStoryboard {
  beat_id: string;
  shots: VnShot[];
  transition_in?: string;
  transition_out?: string;
  scene_prompt?: { zh?: string; en?: string };
}

export interface VnShot {
  shot_id: string;                           // "1.1-1", "1.1-2"...
  shot_type: "远" | "全" | "中" | "近" | "特";   // 中文景别
  camera_movement: string;                   // 静止/推/拉/摇/移/跟/升/降
  visual_content: string;                    // 画面内容描写
  dialogue_ref?: string[];                   // 对应 dialogue 行号
  sfx?: string;
  voice_over?: string;
  duration_sec: number;
  branch_qte_ref?: boolean;                  // 该镜头承载 beat.branch_qte 的呈现
  /** @deprecated 演出型 QTE 已停用；保留仅兼容历史数据 */
  performance_ref?: number;
  reuse_from?: string;                       // 复用镜头组 ID
  visual_prompt?: { zh?: string; en?: string };
}

// ─────────────────────────────────────────────────────────────────
// 世界状态快照系统（World State Snapshot）
// 用于追踪角色/道具/世界/剧情在每个情节点的状态变更，
// 为下游步骤提供精确的世界状态，防止"吃书"和状态漂移。
// ─────────────────────────────────────────────────────────────────

/** 情节点的时空坐标 */
export interface BeatSpaceTime {
  time: string;
  location: string;
}

/** 角色在某一时刻的完整状态 */
export interface CharacterState {
  name: string;
  psychology: {
    personality: string;
    persona_base: string;
    current_mood?: string;
  };
  physical: {
    body: string;
    attire: string;
  };
  power_level: string;
  relationships: Array<{ target: string; nature: string }>;
}

/** 道具在某一时刻的完整状态 */
export interface ItemState {
  name: string;
  location: string;
  acquired: boolean;
  durability: "permanent" | "multi_use" | "single_use" | "consumed";
  condition: string;
}

/** 单个状态变更事件 */
export interface StateChange {
  dimension: "time" | "location" | "character" | "item" | "world" | "plot";
  subject: string;
  attribute: string;
  from?: string;
  to: string;
}

/** 单个 beat 的时空坐标 + 状态变更声明 */
export interface BeatStateDelta {
  beat_id: string;
  spacetime: BeatSpaceTime;
  changes: StateChange[];
}

/** 世界状态账本（全树 + 基线） */
export interface WorldStateLedger {
  baseline: {
    spacetime: BeatSpaceTime;
    characters: CharacterState[];
    items: ItemState[];
    world_state: string;
    plot_state: string;
  };
  deltas: BeatStateDelta[];
}

/** 世界在某一时刻的完整快照（由 baseline + deltas 累积计算） */
export interface WorldSnapshot {
  spacetime: BeatSpaceTime;
  characters: CharacterState[];
  items: ItemState[];
  world: string;
  plot_progress: string;
}

export interface GlobalControlParams {
  complexity: number;
  deviation: number;
  target_structure?: TargetStructure | null;
  layer_controls?: LayerControls;
  framework_type?: FrameworkType;
  /** @deprecated use getEntropy(complexity) instead */
  entropy_budget?: number;
  /** @deprecated use deviation (continuous number) instead */
  deviation_direction?: "positive" | "negative" | "neutral";
}

export function deviationFromLegacy(
  gcp?: GlobalControlParams,
): number {
  if (gcp?.deviation !== undefined) return gcp.deviation;
  const dir = gcp?.deviation_direction;
  if (dir === "positive") return 0.5;
  if (dir === "negative") return -0.5;
  return 0;
}

export interface LayerControls {
  layer_0: LayerControl;
  layer_1: LayerControl;
  layer_2: LayerControl;
}

export type FrameworkType = "linear" | "dual_climax" | "multi_thread" | "nested" | "spiral";

export interface TargetStructure {
  l0_nodes: number;
  l1_per_parent: number;
  l2_per_parent: number;
  enable_branch: boolean;
  plot_length: number;
}

export interface PreferenceAnalysis {
  全局控制参数: GlobalControlParams;
  世界观维度: Record<string, SlotDimension>;
  框架层维度_L0: Record<string, SlotDimension>;
  大纲层维度_L1: Record<string, SlotDimension>;
  细纲层维度_L2: Record<string, SlotDimension>;
  层级调控参数: Record<string, LayerControl>;
}

export interface SlotDimension {
  slot_name: string;
  user_preference: string;
  description: string;
  search_keywords: string[];
  capacity: number;
  entropy_config: EntropyConfig;
  deviation_config: DeviationConfig;
}

export interface EntropyConfig {
  base_entropy: number;
  entropy_type: "conservative" | "balanced" | "creative";
  complexity_factor: number;
  branch_probability: number;
  detail_density: number;
}

export interface DeviationConfig {
  base_deviation: number;
  deviation_type: "emotional" | "structural" | "character" | "twist";
  deviation_direction: "positive" | "negative" | "neutral";
  deviation_intensity: number;
  anti_cliche_rules: string[];
}

export interface LayerControl {
  layer_name: string;
  entropy_inheritance: number;
  min_nodes: number;
  max_nodes: number;
  /** @deprecated deviation is now a global content-only param, not per-layer */
  deviation_inheritance?: number;
  /** @deprecated use deriveBranchProbability() deterministic calculation */
  branch_probability?: number;
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
  基础架构层: Record<string, Record<string, unknown>>;
  交互叙事层: Record<string, Record<string, unknown>>;
  核心规则?: Array<{ rule_id: number; rule_name: string; rule_content: string }>;
  /**
   * 全局 UI 风格基调（双语）。直接对应 kino-studio UIStyle.prompt：
   *   - 决定 UI 面板/按钮/字幕条/QTE icon 的视觉调性（赛博朋克/民国手绘/极简日漫…）
   *   - LLM 主动产出；缺失时由 normalizeWorldview 从时空背景/文化/科技槽位兜底合成
   */
  ui_style_prompt?: { zh?: string; en?: string };
  [key: string]: unknown;
}

export interface PlotSynopsis {
  synopsis_strategy: string;
  synopsis: string;
  highlight_analysis: string;
}

export interface FrameworkNode {
  node_id: string;
  content_id?: string;
  name: string;
  narrative_function: string;
  main_content: string;
  stage_type?: string;
  is_branch?: boolean;
  prev_node?: string[];
  next_node?: string[];
  sequence_index?: number;
}

export interface StoryFramework {
  framework: { nodes: FrameworkNode[] };
  dynamic_structure?: {
    structure_type: string;
    framework_nodes: FrameworkNode[];
    branch_groups?: Array<{ branch_at: string; branches: string[]; merge_at: string }>;
  };
}

export interface OutlineNode {
  node_id: string;
  content_id?: string;
  parent_id: string;
  name: string;
  narrative_stage: string;
  prev_node: string[];
  next_node: string[];
  story_elements: {
    plot: { cause: string; process: string; result: string };
  };
  content: string;
}

export interface OutlinesGenerated {
  outlines: OutlineNode[];
}

export interface DetailedOutlineNode extends OutlineNode {
  story_elements: {
    plot: { cause: string; process: string; result: string };
    dialogue_hint?: string;
    monologue_hint?: string;
    narration_hint?: string;
    atmosphere?: string;
  };
}

export interface DetailedOutlinesGenerated {
  detailed_outlines: DetailedOutlineNode[];
}

export interface CharacterPersonalLife {
  likes?: string[];
  dislikes?: string[];
  habits?: string[];
  speech_pattern?: string;
  personal_item?: string;
  private_wish?: string;
  vulnerability?: string;
  independent_bonds?: Array<{
    name: string;
    relationship: string;
    detail: string;
  }>;
}

export interface CharacterSheet {
  name: string;
  label: "主角" | "NPC" | "Boss";
  race?: string;
  gender?: string;
  age?: string;
  occupation?: string;
  role_in_story?: string;
  description?: Record<string, unknown>;
  /**
   * 高密度立绘视觉提示词（双语）。中文版直接喂 GPT-Image-2/Midjourney/SD，
   * 英文版喂 SD/Flux/Imagen。LLM 主动产出；缺失时由 normalizeCharacter 兜底。
   * 与 kino-studio Character.prompt 字段对齐（kino 直接消费 zh）。
   */
  visual_prompt?: { zh?: string; en?: string };
  archetype_analysis?: Record<string, unknown>;
  psychological_drivers?: Record<string, unknown>;
  character_arc_spectrum?: string;
  relationships?: Record<string, unknown>;
  background_information?: string;
  personal_life?: CharacterPersonalLife;
  game_mechanics?: Record<string, unknown>;
  _is_player?: boolean;
  [key: string]: unknown;
}

// --- L3 情节层 ---

export interface PlotNode {
  node_id: string;
  content_id?: string;
  parent_id: string;
  content: string;
  story_elements: { plot: { cause: string; process: string; result: string } };
  jrpg_elements: {
    scene_location: string;
    scene_locations: string[];
    scene_characters: string[];
    dialogue_segments: Array<{ speaker: string; text: string; emotion: string }>;
    key_items: string[];
    narration_hints: string[];
    bgm_hint: string;
    camera_hint: string;
  };
  boundary_constraints: { cause: string; result: string };
  prev_node: string[];
  next_node: string[];
  narrative_stage: string;
}

export interface PlotsGenerated {
  plots: PlotNode[];
  plot_id_map: Record<string, string>;
}

// --- L4 剧本层 ---

export interface ScriptContentItem {
  type: "stage_direction" | "narration" | "dialogue" | "inner_monologue" | "player_action" | "system_message" | "branch_point";
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
  camera_direction: string;
  bgm: string;
  content: ScriptContentItem[];
}

export interface ScriptChapter {
  chapter_id: string;
  node_id: string;
  plot_node_id: string;
  chapter_type: "opening" | "rising" | "climax" | "falling" | "resolution";
  title: string;
  conflict: { type: string; tension_level: number; stakes: string; turning_point: string };
  character_arcs: Array<{ character: string; arc_phase: string; emotional_shift: string; growth: string }>;
  scenes: ScriptScene[];
  prev_node?: string[];
  next_node?: string[];
  is_branch?: boolean;
  narrative_stage?: string;
}

export interface JrpgScript {
  title: string;
  chapters: ScriptChapter[];
}

// --- L5 道具清单 ---

export interface GameItem {
  name: string;
  category: string;
  rarity: string;
  description: string;
  effect: string;
  initial_owner: string | null;
  initial_scene: string;
  related_character: string | null;
  value: Record<string, number>;
  max_stack: number;
  read_content?: string;
}

// --- L5 任务系统 ---

export interface Quest {
  quest_id: string;
  name: string;
  type: "main" | "side" | "exploration" | "collection" | "challenge";
  description: string;
  story_node_id: string;
  chapter_id: string;
  framework_node: string;
  trigger: {
    type: "auto" | "npc" | "area" | "item" | "event" | "quest_complete";
    condition: string;
    npc?: string;
    scene?: string;
  };
  objectives: Array<{
    description: string;
    type: "talk" | "reach" | "collect" | "defeat" | "interact" | "explore" | "escort" | "custom";
    target: string;
    count?: number;
    optional?: boolean;
  }>;
  completion: {
    type: "auto" | "turn_in";
    condition: string;
    npc?: string;
    scene?: string;
  };
  rewards: {
    items?: Array<{ name: string; count: number }>;
    unlock?: string;
    description: string;
  };
  prerequisites: string[];
  next_quests: string[];
}

export interface QuestGraph {
  quests: Quest[];
  main_quest_chain: string[];
  branch_quests: Record<string, string[]>;
}

// --- 场景层 ---

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
  parent_uid: string | null;
  parent_name: string | null;
  parent_level: number | null;
  scene_level: number;
  label: SceneLabel[];
  description: SceneDescription;
  story_units?: string[];
  /** @deprecated use scene_level */
  level?: number;
}

export interface SceneMap {
  world_name: string;
  scenes: SceneNode[];
  _phase1_skeleton?: SceneNode[];
  _phase1_by_layer?: {
    l0: { name: string; parent: string; level?: number; label?: unknown; description?: unknown }[];
    l1: { name: string; parent: string; level?: number; label?: unknown; description?: unknown }[];
    l2: { name: string; parent: string; level?: number; label?: unknown; description?: unknown }[];
  };
  _phase2_per_node?: Record<string, SceneNode[]>;
  _phase2_per_node_md?: Record<string, string>;
  _scene_structure_md?: string;
}

// --- Tier / Mode 路由系统 ---

export type TierId = "tier1" | "tier2" | "tier3" | "tier4";
export type ModeId =
  | "character" | "item_lore" | "scene" | "worldview"
  | "initial_outline" | "story_framework"
  | "story_outline" | "detailed_outline"
  | "novel" | "script" | "quest" | "full"
  | "narrative_card"
  | "tier2_enhanced" | "tier3_basic"
  // 新增叙事模式
  | "fragmented" | "emergent" | "narrative_auto"
  // 模板级专属叙事单品（卡牌 / 开放世界）
  | "card_narrative" | "open_world_narrative"
  // 策划+叙事联合模式
  | "design_auto" | "design_full_narrative"
  | "design_fragmented" | "design_emergent"
  | "design_only"
  // 影游 v2 专属入口（tpl-vn-v2）
  | "vn_full" | "design_vn_full"
  | "vn_script" | "vn_storyboard_mode";

export type StepOrGroup = string | string[];

export interface ModeConfig {
  id: ModeId;
  label: string;
  tiers: TierId[];
  steps: StepOrGroup[];
  showComplexity: boolean;
  isDynamic?: boolean;
  /**
   * B4: Mode 真实语义二元组。
   *
   *   pipeline_template: 此 mode 对应的管线模板形态
   *     - 决定步骤"长什么样"（RPG / VN / 开放世界 / 卡牌 / 叙事卡 / 轻量 / 碎片 / 涌现）
   *     - undefined 表示该 mode 不绑定特定模板（如 narrative_auto 由 needs 动态决定）
   *
   *   target_endpoint: 此 mode 在管线中"跑到哪一步停止"
   *     - 取值为 STEP_IDS 中的某个 step（如 "character_enrichment" / "outline_batch"）
   *     - undefined 表示跑到模板末尾
   *     - 对"单一产物"型 mode（item_lore 等）也有效，等价于"跑到那一步停"
   *
   * 字段语义虽与 steps[] 重叠，但显式化两个维度方便后续 PipelineTemplate × Endpoint 的任意组合，
   * 不再受限于现有 mode 列表枚举。UI 不变（用户看到的还是一个下拉）。
   */
  pipeline_template?: import("../pipeline/templates.js").PipelineTemplateId;
  target_endpoint?: string;
}

export interface TierDetectionResult {
  tier: TierId;
  genre_code: string;
  genre_name: string;
  reasoning: string;
}

// --- Tier4 叙事卡 ---

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

// --- Tier2 Lore 碎片 ---

export interface LoreFragment {
  id: string;
  type: "inscription" | "journal" | "npc_whisper" | "item_description" | "codex_entry";
  title: string;
  content: string;
  source_location?: string;
  related_characters?: string[];
  related_worldview?: string;
}

// --- Tier2/3 物品叙事 ---

export interface ItemLore {
  item_name: string;
  item_type: string;
  rarity: string;
  lore_text: string;
  flavor_text: string;
}

// --- Pipeline 进度 & 配置 ---

export interface PipelineProgress {
  stage: string;
  stepId?: string;
  step: number;
  totalSteps: number;
  status: "pending" | "running" | "completed" | "failed";
  message?: string;
  data?: unknown;
  nodeId?: string;
  nodeDone?: number;
  nodeTotal?: number;
  /**
   * Special event types:
   *   - "streaming": LLM streaming chunk update (uses chunk/accumulated)
   *   - "pipeline_steps_announce": (D4) the very first SSE frame, advertising
   *     the full ordered list of step IDs the run will execute, the chosen
   *     pipeline_template, and the effective complexity. The frontend uses
   *     this to initialise all step rows to "pending" before any progress
   *     event arrives, instead of guessing from hardcoded route tables.
   */
  type?: "streaming" | "pipeline_steps_announce";
  chunk?: string;
  accumulated?: string;
  // pipeline_steps_announce payload
  steps?: string[];
  pipelineTemplate?: string;
  complexity?: number;
  /** @deprecated A1: derived from (tier, mode, genreCode). Kept for replay/log only. */
  routingMode?: "auto" | "semi" | "manual";
  /** A2-4: explicit genre_code (when frontend specified one). Empty in auto/semi mode. */
  genreCode?: string;
}

export type ProgressCallback = (progress: PipelineProgress) => void;

export interface PipelineConfig {
  apiKey?: string;
  proxyUrl?: string;
  proxyApiKey?: string;
  model?: string;
  fastModel?: string;
  maxRetries?: number;
  timeout?: number;
  onProgress?: ProgressCallback;
  onStepComplete?: (stepId: string, ctx: NarrativeContext) => void;
  tier?: TierId;
  mode?: ModeId;
  /** 前端选定的复杂度档位（1-5）；run() 会注入 ctx.complexity 供节点预算派生使用 */
  complexity?: number;
  autoDetectTier?: boolean;
  /**
   * A2-2: explicit genre code (e.g. "rpg-jrpg") from frontend selection.
   * When provided, the pipeline skips LLM detectGenre / detectTier and uses
   * the corresponding GenreEntry's tier + needs matrix directly.
   */
  genreCode?: string;
  resumeCtx?: NarrativeContext;
  resumeAfterStep?: string;
  /**
   * When true (default), the pipeline uses the Planner engine to determine
   * step sequence based on genre needs matrix. Set to false to use the
   * legacy static mode-based step list.
   */
  usePlanner?: boolean;
}

// ── Step modification metadata (stored in checkpoint.step_meta, NOT in ctx) ──

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

export interface Checkpoint {
  ctx: NarrativeContext;
  step_meta?: Record<string, StepMeta>;
  lastCompletedStep?: string;
  tier?: TierId;
  mode?: ModeId;
  userInput?: string;
  completedSteps?: string[];
  /** Blueprint 快照（Blueprint 模式时由 runWithBlueprint 落盘，resume 时恢复） */
  blueprint?: import("../pipeline/blueprint/types.js").PipelineBlueprint;
}
