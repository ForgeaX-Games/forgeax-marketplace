/**
 * assistant-seats.ts — 叙事单品助手「席位」注册表（feature list 2.3.x 的单一事实源）
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么要有这一层
 * ─────────────────────────────────────────────────────────────────
 * 历史上 SSOT 是 STEP_REGISTRY：几轮迭代沉淀了 jrpg-v2 / vn-v2 / tier3-4 / 策划 D 链
 * 等多套管线的 step，同一件产品职责在不同模板下叫不同名字（宏观框架在 jrpg 叫
 * story_framework、在 vn 叫 vn_outline_acts），产品侧无从索引。
 *
 * feature list 反过来定义：**席位是产品，step 只是它在某模板下的实现**。
 *   - 专家组（2.2）= 席位序列组成的预制工作流
 *   - 单品助手（2.3）= 席位本身，可被单独调用
 * 所以本文件立席位为一等公民。
 *
 * 老 step 的定位是**迁移期实现**，不是终态：每席的形态（四原型）、八段提示词填充
 * 矩阵与产出口径以 seat-spec.ts（即 feature list 的 agent 配置表）为准，老 step 只
 * 提供「这件事以前怎么做的、哪部分机制知识还能用」。凡老实现与配置表冲突，改老实现。
 * 席位与老 step 名字对不上（宏观框架在 jrpg 叫 story_framework、在 vn 叫
 * vn_outline_acts）正是迁移期的表征，binding 表就是这层索引。
 *
 * ─────────────────────────────────────────────────────────────────
 * 与既有契约层的分工
 * ─────────────────────────────────────────────────────────────────
 *   AssistantSeat（本文件） 产品契约：这个助手对用户承诺什么、吃什么、产出什么类别
 *   NarrativeAgent          执行契约：怎么跑（原型/结构/连接能力/生命周期）
 *   StepDescriptor          实现细节：具体哪个函数、prompt、依赖
 *
 * 席位只声明「席位 → 席位」的硬前置；具体 ctx 字段随管线而变，由
 * resolveSeatRequiredFields 从实现反查，避免两份会漂移的事实源。
 *
 * ─────────────────────────────────────────────────────────────────
 * 硬不变量（测试守）
 * ─────────────────────────────────────────────────────────────────
 *   1. 20 席与 feature list 2.3.1–2.3.20 一一对应，featureId 唯一
 *   2. 每个已注册 step 必须且只能归属一个席位——不允许孤儿 step
 *   3. status=active 的席位至少有一条绑定；status=planned 的必须没有绑定
 */
import type { ModeId } from "../types/index.js";
import { getStepRequiredInputs } from "./step-registry.js";
import type { PipelineTemplateId } from "./templates.js";

// ════════════════════════════════════════════════════════
// 一、席位类型
// ════════════════════════════════════════════════════════

/**
 * 席位四类。决定执行器形态与产物写回方式，是 kind 专属字段的判别标签。
 *
 *   generator  产出新产物，写 ctx 主字段（13 席，管线主干）
 *   validator  读已有产物 → 出检查报告，可选自动修正后回写（2 席）
 *   polisher   读已有产物 → **另存打磨分支**，主产物不动，由用户选哪版进下游（4 席）
 *   retriever  检索本地/网络资料 → 产出可检索文档，供其余席位引用（1 席）
 */
export type SeatKind = "generator" | "validator" | "polisher" | "retriever";

/**
 * 席位在某作用域下的实现绑定。
 *
 * agentIds 有序：长度 >1 表示该席位内部本身是一条 workflow
 * （feature list 2.3 原话「叙事单品如有前驱环节依赖，也是由 workflow 组成的 agent」）。
 *
 * 作用域二选一或都不填：
 *   templateId  该管线模板专属实现
 *   modeId      无专属模板、由运行模式决定的实现（如策划+叙事联合的 D 链）
 *   都不填      通用兜底，每席至多一条
 *
 * 解析优先级：modeId 精确 > templateId 精确 > 通用兜底。
 */
export interface SeatBinding {
  templateId?: PipelineTemplateId;
  modeId?: ModeId;
  agentIds: string[];
  /**
   * 本席在该作用域下没有独立 step，产物由另一席的 step 顺带产出（agentIds 必须为空）。
   *
   * 影游侧的典型形态：vn_outline_acts 是单步双输出，三幕骨架之外把人物小传与关键道具
   * 一并产出——角色档案席与道具清单席因此在影游线上"有产物、无实现"。这不是缺失，
   * 而是实现层的合并；照通用兜底再跑一遍 RPG 版的角色/道具步，只会产出与小传打架的第二套设定。
   */
  coveredBy?: string;
  /**
   * 该绑定只在此运行时条件成立时启用（agentIds 非空）。
   * 目前唯一取值 has_uploaded_script：影游 E2 上传剧本入口与 E1 原创入口互斥。
   */
  condition?: "has_uploaded_script";
  /** 该绑定为何这样接（尤其是与 step 历史命名不一致时），供后来者追溯。 */
  note?: string;
}

export interface AssistantSeat {
  /** 席位 id。与前端 composerCatalog 的 `engineer.<id>` 后缀同名。 */
  id: string;
  /** feature list 编号，需求可追溯。 */
  featureId: string;
  name: string;
  kind: SeatKind;
  /**
   * feature list 的职责原文。改需求先改这里，再改实现——
   * 这是席位存在的理由，不是注释。
   */
  responsibility: string;
  /** active = 已有实现可跑；planned = 契约已立、实现待建。 */
  status: "active" | "planned";

  /**
   * 硬前置席位：没有它们的产物，本席位跑出来的东西没有意义。
   *
   * 声明在席位层而非字段层，是因为同一职责在不同管线落到不同 ctx 字段
   * （故事结构在 jrpg 是 detailed_outlines_generated、在影游是 vn_branched_beats），
   * 只有「席位 → 席位」这层关系跨模板成立。具体字段由
   * resolveSeatRequiredFields 从实现反查。
   *
   * 注意这里只写**硬**前置，不抄 feature list「根据 A、B、C…」的完整枚举——
   * 那些多数是上下文参考而非执行门槛。
   */
  upstreamSeats: string[];
  /** 由用户直接带入、不由任何席位产出的输入。 */
  externalInputs?: string[];
  /** 产物落到哪个内容类别（与前端 lib/contentTypes.ts 的 id 同名；无产物落盘为 null）。 */
  contentType: string | null;
  /**
   * 顺带产出、需要单独落盘的派生产物（STEP_FILE_MAP 里按字段名而非 step id 建的条目）。
   * 归类时和主产物同属本席位，否则它们会掉进"无类别"堆里。
   */
  derivedArtifacts?: string[];

  /** 实现绑定；planned 席位为空数组。 */
  bindings: SeatBinding[];
  /**
   * 归属本席、但不参与任何解析路径的 agent：老形态、已被合并的步骤、
   * 或写好了却没接进任何模板的变体。存在的意义是让「每个 step 都有主人」
   * 这条不变量成立，从而任何新增 step 都无法悄悄成为孤儿。
   */
  alsoOwns?: string[];

  /** validator 专属：报告字段与是否自动修正。 */
  report?: { field: string; autoRepair: boolean };
  /**
   * polisher 专属：打磨的基准字段。产物写 `<baseField>__<seatId>`，
   * 主字段保持不动，下游用哪版由用户在前端选。
   */
  branch?: { baseField: string };
  /** retriever 专属：检索来源与落盘文档字段。 */
  retrieval?: { sources: Array<"local" | "web">; outputField: string };
}

// ════════════════════════════════════════════════════════
// 二、20 席注册表
// ════════════════════════════════════════════════════════

/**
 * 席位与 step 的对应按**职责**判定，不按历史命名。两处刻意与旧绑定不同：
 *
 *   - 故事大纲席（2.3.7）= 宏观框架 → jrpg story_framework / vn vn_outline_acts；
 *     旧前端把它接到 outline_batch（L1 故事大纲），是被 step 中文名带偏了。
 *   - 分镜席（2.3.11）vn 侧 = vn_storyboard（G-03 分镜设计），
 *     而 vn_screenplay（G-02 剧本创作）属于故事情节席——「填充剧情树内容」。
 */
export const ASSISTANT_SEATS: readonly AssistantSeat[] = [
  {
    id: "req_list",
    featureId: "2.3.1",
    name: "需求清单助手",
    kind: "generator",
    responsibility:
      "对用户上传的内容进行提炼总结。如果是直接输入或标签选择，则总结即可；" +
      "如果上传的是文件，则直接提炼文件里的内容即可。（格式主要为叙事模板，以及叙事策略）",
    status: "active",
    upstreamSeats: [],
    externalInputs: ["uploaded_files", "user_tags"],
    contentType: "requirement",
    derivedArtifacts: ["global_control_params"],
    bindings: [
      {
        agentIds: ["preference_summary", "preference_analysis"],
        note: "总结与分析是同一件产品职责的两步，合为一席内部 workflow。",
      },
      {
        templateId: "tpl-vn-v2",
        agentIds: ["vn_script_normalize", "vn_segment_confirm"],
        condition: "has_uploaded_script",
        note: "上传剧本走 E2 入口：预处理 + 文本段确认，即「提炼文件里的内容」在影游侧的形态。",
      },
      {
        templateId: "tpl-vn-v2",
        agentIds: [],
        coveredBy: "design_doc",
        note: "E1 原创入口（未传剧本）：需求提炼由 vn_logline 一并吸收，不另跑偏好总结/分析——"
          + "影游用 logline 当命题锚点，中间再插一层偏好总结只会引入与 logline 打架的第二份需求解读。",
      },
    ],
  },
  {
    id: "design_doc",
    featureId: "2.3.2",
    name: "策划文档助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单，规划关键设定，包括：叙事策略、一句话故事梗概、" +
      "重要事件、重要场景、关键角色、关键道具。",
    status: "active",
    upstreamSeats: ["req_list"],
    contentType: "design-doc",
    derivedArtifacts: ["narrative_requirements"],
    bindings: [
      { agentIds: ["initial_plan"] },
      {
        templateId: "tpl-vn-v2",
        agentIds: ["vn_logline"],
        note: "「一句话故事梗概」在影游侧就是 E1-01 logline。",
      },
      {
        modeId: "design_auto",
        agentIds: [
          "core_concept",
          "system_architecture",
          "system_detail",
          "value_framework",
          "design_doc",
        ],
        note: "策划+叙事联合模式的 D0-D4 链无专属模板，按运行模式挂。",
      },
    ],
    alsoOwns: [
      // 初步方案合并前的三段老形态，仅历史存档会命中
      "initial_outline",
      "core_settings",
      "plot_synopsis",
    ],
  },
  {
    id: "worldview",
    featureId: "2.3.3",
    name: "世界观设定助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档，构建世界观设定，包括：基础架构层" +
      "（时空背景、物理法则、生物生态、政治体制、经济系统、文化信仰、科技水平、势力组织）、" +
      "交互叙事层（历史脉络、核心冲突、主要人物、叙事入口）以及核心规则。",
    status: "active",
    upstreamSeats: ["design_doc"],
    contentType: "worldview",
    bindings: [{ agentIds: ["worldview"] }],
  },
  {
    id: "character",
    featureId: "2.3.4",
    name: "角色档案助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定，设定角色档案，包括：" +
      "角色基础信息、角色弧光、角色关系。（待叙事生成完毕需二次校验）",
    status: "active",
    upstreamSeats: ["worldview"],
    contentType: "character",
    derivedArtifacts: ["vn_character_bios"],
    bindings: [
      { agentIds: ["character_enrichment"] },
      {
        templateId: "tpl-vn-v2",
        agentIds: [],
        coveredBy: "outline",
        note: "vn_outline_acts 单步双输出，三幕之外一并产出全员人物小传（vn_character_bios）。",
      },
    ],
  },
  {
    id: "item",
    featureId: "2.3.5",
    name: "道具清单助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定、角色档案，设定道具清单，" +
      "包括：道具基础信息、生命周期、附属关系。（待叙事生成完毕需二次校验）",
    status: "active",
    upstreamSeats: ["worldview"],
    contentType: "item",
    derivedArtifacts: ["vn_key_items", "item_lore"],
    bindings: [
      { agentIds: ["item_database"] },
      {
        templateId: "tpl-vn-v2",
        agentIds: [],
        coveredBy: "outline",
        note: "贯穿剧情的关键道具同样出自 vn_outline_acts 那一步（vn_key_items）。",
      },
    ],
  },
  {
    id: "scene_list",
    featureId: "2.3.6",
    name: "场景列表助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定、道具清单，" +
      "设定层级化、结构化的场景列表/场景树。（待叙事生成完毕需二次校验）",
    status: "active",
    upstreamSeats: ["worldview"],
    contentType: "scene",
    derivedArtifacts: ["vn_scenes"],
    bindings: [
      { agentIds: ["scene_generation"] },
      {
        templateId: "tpl-open-world",
        agentIds: ["region_design"],
        note: "开放世界的「场景列表」以区域为粒度。",
      },
      {
        templateId: "tpl-vn-v2",
        agentIds: [],
        coveredBy: "structure",
        note: "影游的场号是 vn_branched_beats 拓扑定稿后的确定性派生（vn_scenes），不是执行步。",
      },
    ],
  },
  {
    id: "outline",
    featureId: "2.3.7",
    name: "故事大纲助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定、道具清单、场景列表，" +
      "规划宏观故事框架和总体故事走向，为下一环节规划微观故事框架和详细故事走向" +
      "起到了提纲挈领的作用。（叙事策略在此落盘）",
    status: "active",
    upstreamSeats: ["worldview"],
    contentType: "outline",
    bindings: [
      {
        agentIds: ["story_framework"],
        note: "宏观 = L0 故事框架；L1/L2 属微观，归故事结构席。",
      },
      {
        templateId: "tpl-vn-v2",
        agentIds: ["vn_outline_acts"],
        note: "三幕扩写即影游侧的宏观框架（同步产出人物小传/关键道具两份派生）。",
      },
    ],
  },
  {
    id: "structure",
    featureId: "2.3.8",
    name: "故事结构助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定、道具清单、场景列表、故事大纲，" +
      "规划微观故事框架和详细故事走向，为下一环节故事情节的落盘起到了详细指南的作用。" +
      "（叙事策略和剧情树在此落盘，但只有梗概等基础信息，具体内容在下游完善；" +
      "需要标记最优路径，即最符合用户需求的那一条链路）",
    status: "active",
    upstreamSeats: ["outline"],
    contentType: "structure",
    bindings: [
      {
        agentIds: ["outline_batch", "detailed_outline"],
        note: "L1 故事大纲 + L2 故事细纲同属微观展开，合为一席内部 workflow。",
      },
      {
        templateId: "tpl-vn-v2",
        agentIds: ["vn_beats", "vn_branched_beats", "vn_state_ledger"],
        note: "情节点 → 剧情树改造（最优路径标记在此）→ 世界状态账本。",
      },
      {
        templateId: "tpl-vn",
        agentIds: ["branch_tree"],
        note: "旧影游管线的分支树，同为「剧情树落盘」职责。",
      },
    ],
  },
  {
    id: "plot",
    featureId: "2.3.9",
    name: "故事情节助手",
    kind: "generator",
    responsibility:
      "根据用户初始需求、需求清单、策划文档、世界观设定、道具清单、场景列表、故事结构，" +
      "填充故事内容。（剧情树的内容在此填充，但只有梗概等基础信息，具体内容在下游完善）",
    status: "active",
    upstreamSeats: ["structure"],
    contentType: "plot",
    bindings: [
      { agentIds: ["plot_generation"] },
      {
        templateId: "tpl-vn-v2",
        agentIds: ["vn_screenplay"],
        note: "G-02 剧本创作 = 把剧情树节点填成实际内容，属「填充」而非「分镜」。",
      },
      { templateId: "tpl-vn", agentIds: ["dialogue_script"] },
      {
        templateId: "tpl-emergent",
        agentIds: ["emergent_event"],
        note: "涌现叙事的「情节」以事件模板为载体。",
      },
      { templateId: "tpl-card-game", agentIds: ["event_pool"] },
    ],
  },
  {
    id: "quest",
    featureId: "2.3.10",
    name: "任务助手",
    kind: "generator",
    responsibility:
      "根据故事情节，规划任务树，设置任务的开启条件、实现步骤和完成条件。" +
      "（数值系统在此落盘，包括战斗数值、养成数值、经济数值、好感度系统）",
    status: "active",
    upstreamSeats: ["plot"],
    contentType: "quest",
    bindings: [{ agentIds: ["quest_generation"] }],
  },
  {
    id: "storyboard",
    featureId: "2.3.11",
    name: "分镜助手",
    kind: "generator",
    responsibility: "根据故事情节，规划剧本分镜，设置剧情表演的美术效果。",
    status: "active",
    upstreamSeats: ["plot"],
    contentType: "storyboard",
    derivedArtifacts: ["vn_video_prompts"],
    bindings: [
      { agentIds: ["script_generation"] },
      { templateId: "tpl-vn-v2", agentIds: ["vn_storyboard"] },
      { templateId: "tpl-vn", agentIds: ["cinematic_storyboard"] },
    ],
    // 剧本+场景耦合成一步的变体，实现完整但当前未接进任何模板
    alsoOwns: ["script_scene_generation"],
  },
  {
    id: "narrative_card",
    featureId: "2.3.12",
    name: "叙事卡助手",
    kind: "generator",
    responsibility: "根据用户初始需求，对叙事要求极低的游戏品类直接进行叙事包装。",
    status: "active",
    upstreamSeats: [],
    contentType: "narrative-card",
    bindings: [{ agentIds: ["narrative_card"] }],
  },
  {
    id: "codex",
    featureId: "2.3.13",
    name: "设定集助手",
    kind: "generator",
    responsibility: "根据用户初始需求，对叙事要求较低的游戏品类直接进行叙事包装。",
    status: "active",
    upstreamSeats: [],
    contentType: "codex",
    bindings: [
      { agentIds: ["lore_generation"] },
      { templateId: "tpl-card-game", agentIds: ["card_lore"] },
    ],
  },
  {
    id: "structure_check",
    featureId: "2.3.14",
    name: "结构检查助手",
    kind: "validator",
    responsibility:
      "检查生成的结构是否正确并修正，包括：分支、聚合、结局节点的设置，以及节奏设置。",
    status: "active",
    upstreamSeats: ["structure"],
    contentType: "structure-check",
    report: { field: "structure_check_report", autoRepair: true },
    bindings: [
      { agentIds: ["structure_check"] },
      { templateId: "tpl-vn-v2", agentIds: ["vn_structure_check"] },
    ],
    // 生成步内部的修复钩子：跑在 L1/L2/L3 各层之后就地修连接、拆环、补悬挂分支。
    // 「检查并修正」里的修正由它们完成，席位的独立实现只负责通读出报告。
    alsoOwns: [
      "structure_validation_l1",
      "structure_validation_l2",
      "structure_validation_l3",
    ],
  },
  {
    id: "content_check",
    featureId: "2.3.15",
    name: "内容检查助手",
    kind: "validator",
    responsibility:
      "检查生成的内容是否正确并修正，包括：改编还原、创作忠实、逻辑自洽、吃书防范、" +
      "世界观适配、角色弧光适配。",
    status: "planned",
    upstreamSeats: ["plot"],
    contentType: "content-check",
    report: { field: "content_check_report", autoRepair: false },
    bindings: [],
  },
  {
    id: "deai",
    featureId: "2.3.16",
    name: "去 AI 味助手",
    kind: "polisher",
    responsibility: "优化表达人机感并修正。",
    status: "planned",
    upstreamSeats: ["plot"],
    contentType: "deai",
    branch: { baseField: "plots_generated" },
    bindings: [],
  },
  {
    id: "plot_refine",
    featureId: "2.3.17",
    name: "情节优化助手",
    kind: "polisher",
    responsibility: "优化生成的情节的人物刻画、剧情推进和环境描写。",
    status: "planned",
    upstreamSeats: ["plot"],
    contentType: "plot-refine",
    branch: { baseField: "plots_generated" },
    bindings: [],
  },
  {
    id: "plot_polish",
    featureId: "2.3.18",
    name: "情节润色助手",
    kind: "polisher",
    responsibility: "优化生成的情节的表达方式和表现手法，包括：情感渲染。",
    status: "planned",
    upstreamSeats: ["plot"],
    contentType: "plot-polish",
    branch: { baseField: "plots_generated" },
    bindings: [],
  },
  {
    id: "playability",
    featureId: "2.3.19",
    name: "玩法适配助手",
    kind: "polisher",
    responsibility:
      "优化生成的分支剧情与选项之间的可玩度，例如让选项变得有意义，" +
      "分支能够真正起到推进剧情的作用。",
    status: "planned",
    upstreamSeats: ["structure"],
    contentType: "playability",
    branch: { baseField: "detailed_outlines_generated" },
    bindings: [],
  },
  {
    id: "encyclopedia",
    featureId: "2.3.20",
    name: "百科娘",
    kind: "retriever",
    responsibility:
      "对用户想要体验的目标，无论是某一作品，抑或是相关历史事实，" +
      "都能够从本地或者网上检索、对比、分析，得出准确信息和设定。",
    status: "planned",
    upstreamSeats: [],
    contentType: "encyclopedia",
    retrieval: { sources: ["local", "web"], outputField: "encyclopedia_doc" },
    bindings: [],
  },
] as const;

// ════════════════════════════════════════════════════════
// 三、产品意图 × 实现现状的已知落差
// ════════════════════════════════════════════════════════

/**
 * upstreamSeats 是产品意图；实现里的依赖图未必对得上。
 * 对不上的地方在这里逐条登记——每条都是一个明确的产品判断，不是遗漏：
 * 要么承认该品类天生没有这一环，要么它就是待补的接线。
 *
 * 测试双向校验：出现未登记的落差会红（防止悄悄漂移），
 * 登记了却已经不存在的条目也会红（防止清单变成陈年垃圾）。
 */
export interface SeatGraphDivergence {
  seatId: string;
  /** 绑定作用域：模板 id、模式 id 或 "通用"。 */
  scope: string;
  /** 该作用域下实际拿不到的上游席位。 */
  missingUpstream: string[];
  reason: string;
  /** true = 该品类本就不需要这一环；false = 待补的接线缺口。 */
  byDesign: boolean;
}

export const KNOWN_SEAT_GRAPH_DIVERGENCES: readonly SeatGraphDivergence[] = [
  {
    seatId: "design_doc",
    scope: "tpl-vn-v2",
    missingUpstream: ["req_list"],
    reason: "影游 E1 从 logline 直接起步，不走 RPG 范式的偏好总结/分析。",
    byDesign: true,
  },
  {
    seatId: "design_doc",
    scope: "design_auto",
    missingUpstream: ["req_list"],
    reason: "策划 D 链以核心概念为入口，需求提炼由策划侧自带。",
    byDesign: true,
  },
  {
    seatId: "outline",
    scope: "tpl-vn-v2",
    missingUpstream: ["worldview"],
    reason: "影游管线顺序是 logline → 三幕 → 世界观：宏观框架先于世界观落定。",
    byDesign: true,
  },
  {
    seatId: "structure",
    scope: "tpl-vn",
    missingUpstream: ["outline"],
    reason: "旧影游管线没有宏观大纲步，分支树直接由世界观+角色推出。",
    byDesign: true,
  },
  {
    seatId: "plot",
    scope: "tpl-emergent",
    missingUpstream: ["structure"],
    reason: "涌现叙事不预设剧情结构，情节以事件模板为载体。",
    byDesign: true,
  },
  {
    seatId: "plot",
    scope: "tpl-card-game",
    missingUpstream: ["structure"],
    reason: "卡牌事件池同样无前置结构。",
    byDesign: true,
  },
];

// ════════════════════════════════════════════════════════
// 四、查询
// ════════════════════════════════════════════════════════

const SEAT_INDEX: ReadonlyMap<string, AssistantSeat> = new Map(
  ASSISTANT_SEATS.map((s) => [s.id, s]),
);

export function getSeat(id: string): AssistantSeat | undefined {
  return SEAT_INDEX.get(id);
}

export interface SeatScope {
  templateId?: PipelineTemplateId;
  modeId?: ModeId;
  /** 是否满足 condition="has_uploaded_script" 的绑定（影游 E2 上传剧本入口）。 */
  hasUploadedScript?: boolean;
}

/** 该条件绑定在本作用域下是否启用。无 condition 的绑定恒启用。 */
function conditionHolds(binding: SeatBinding, scope: SeatScope): boolean {
  if (!binding.condition) return true;
  return binding.condition === "has_uploaded_script" && scope.hasUploadedScript === true;
}

/**
 * 席位在指定作用域下实际要跑的 agent 序列。
 *
 * 优先级：模式精确 > 模板精确 > 通用兜底。同一作用域内可有多条绑定，按声明顺序
 * 取第一条**条件成立**的——影游 req_list 就是靠这一点区分 E2（传了剧本）与 E1（没传，
 * 本席由 logline 覆盖）两种形态。
 *
 * 返回空数组有两种含义，都表示"本席不产生独立 step"：
 *   - 命中 coveredBy 绑定：产物由另一席的 step 顺带产出（影游的角色/道具/场景）；
 *   - 一条都没命中：该品类不设此席。
 * 关键是命中作用域绑定后**不再回落通用兜底**，否则影游会多跑一遍 RPG 版的角色与道具，
 * 产出与人物小传打架的第二套设定。
 */
export function resolveSeatAgents(seatId: string, scope: SeatScope = {}): string[] {
  const seat = SEAT_INDEX.get(seatId);
  if (!seat) return [];
  const pick = (match: (b: SeatBinding) => boolean): SeatBinding | undefined =>
    seat.bindings.find((b) => match(b) && conditionHolds(b, scope));

  if (scope.modeId) {
    const byMode = pick((b) => b.modeId === scope.modeId);
    if (byMode) return [...byMode.agentIds];
  }
  if (scope.templateId) {
    const byTemplate = pick((b) => b.templateId === scope.templateId);
    if (byTemplate) return [...byTemplate.agentIds];
  }
  const generic = pick((b) => !b.templateId && !b.modeId);
  return generic ? [...generic.agentIds] : [];
}

/** 本席在该作用域下由哪一席顺带产出；没有则返回 undefined。 */
export function seatCoveredBy(seatId: string, scope: SeatScope = {}): string | undefined {
  const seat = SEAT_INDEX.get(seatId);
  if (!seat) return undefined;
  const candidates = seat.bindings.filter((b) => conditionHolds(b, scope));
  const byScope =
    (scope.modeId ? candidates.find((b) => b.modeId === scope.modeId) : undefined) ??
    (scope.templateId ? candidates.find((b) => b.templateId === scope.templateId) : undefined) ??
    candidates.find((b) => !b.templateId && !b.modeId);
  return byScope?.coveredBy;
}

/** 反查：某个 agent/step 归属哪个席位。全局唯一，由测试守。 */
const AGENT_TO_SEAT: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const seat of ASSISTANT_SEATS) {
    const owned = [
      ...seat.bindings.flatMap((b) => b.agentIds),
      ...(seat.alsoOwns ?? []),
    ];
    for (const agentId of owned) {
      if (!map.has(agentId)) map.set(agentId, seat.id);
    }
  }
  return map;
})();

export function getSeatForAgent(agentId: string): AssistantSeat | undefined {
  const seatId = AGENT_TO_SEAT.get(agentId);
  return seatId ? SEAT_INDEX.get(seatId) : undefined;
}

/**
 * 席位在指定作用域下的具体输入字段：取该席位实现链首个 agent 的输入契约。
 * 前端单跑一个助手时据此提示「还缺什么」。
 */
export function resolveSeatRequiredFields(seatId: string, scope: SeatScope = {}): string[] {
  const [first] = resolveSeatAgents(seatId, scope);
  return first ? getStepRequiredInputs(first) : [];
}

/** 所有被席位登记的 agent id（用于孤儿 step 检测）。 */
export function boundAgentIds(): string[] {
  return [...AGENT_TO_SEAT.keys()];
}

/**
 * 契约自检：kind 专属字段齐全、状态与绑定自洽。
 * 抛错即表示席位声明本身不成立，应在启动/测试期暴露而非运行期。
 */
export function assertSeatContractComplete(): void {
  const problems: string[] = [];
  const seenFeatureIds = new Set<string>();

  for (const seat of ASSISTANT_SEATS) {
    if (seenFeatureIds.has(seat.featureId)) {
      problems.push(`${seat.id}: featureId ${seat.featureId} 重复`);
    }
    seenFeatureIds.add(seat.featureId);

    if (seat.status === "active" && seat.bindings.length === 0) {
      problems.push(`${seat.id}: 标为 active 却没有任何实现绑定`);
    }
    if (seat.status === "planned" && seat.bindings.length > 0) {
      problems.push(`${seat.id}: 标为 planned 却已有实现绑定，应改为 active`);
    }
    const generics = seat.bindings.filter((b) => !b.templateId && !b.modeId);
    if (generics.length > 1) {
      problems.push(`${seat.id}: 有 ${generics.length} 条通用绑定，解析会二义；请加作用域或移入 alsoOwns`);
    }
    if (seat.kind === "validator" && !seat.report) {
      problems.push(`${seat.id}: validator 席位缺 report 字段`);
    }
    if (seat.kind === "polisher" && !seat.branch) {
      problems.push(`${seat.id}: polisher 席位缺 branch 字段（打磨必须另存分支）`);
    }
    if (seat.kind === "retriever" && !seat.retrieval) {
      problems.push(`${seat.id}: retriever 席位缺 retrieval 字段`);
    }
    for (const binding of seat.bindings) {
      // 空 agentIds 只在「产物由他席顺带产出」时合法，且必须指名是哪一席——
      // 否则就是接线漏了，而不是有意合并实现
      if (binding.agentIds.length === 0 && !binding.coveredBy) {
        problems.push(`${seat.id}: 存在空的 agentIds 绑定，却未交代由哪一席顺带产出`);
      }
      if (binding.coveredBy) {
        if (binding.agentIds.length > 0) {
          problems.push(`${seat.id}: coveredBy 绑定不该同时给 agentIds（既合并又独立跑，产物会打架）`);
        }
        if (!SEAT_INDEX.has(binding.coveredBy)) {
          problems.push(`${seat.id}: coveredBy 指向不存在的席位 ${binding.coveredBy}`);
        }
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`AssistantSeat 契约不成立：\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}
