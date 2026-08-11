/**
 * seat-spec.ts —— 叙事单品助手的「配置表」入码（四期 SSOT）
 *
 * 事实源：MyFile/feature_list2/叙事工坊 feature list-agent-叙事单品助手团队.csv
 *
 * ─────────────────────────────────────────────────────────────────
 * 为什么这张表要单独存在（而不是塞进 assistant-seats.ts）
 * ─────────────────────────────────────────────────────────────────
 * assistant-seats.ts 回答的是「这个助手对用户承诺什么、由哪些 step 实现」；
 * 本文件回答的是**表里另外两列**：
 *
 *   1. 「agent 类型」列 → 该席作为 agent 的**形态**（原子 / 串行 / 并行 / 嵌套），
 *      即 feature list 4.3 要求的四类抽象在产品侧的归属；
 *   2. 「prompt」那一组列 → 八段骨架的**填充矩阵**（√ 通用 / ◐ 可插拔 / × 不填），
 *      即 feature list 4.4 要求的「按需加载」到底每席该加载哪几段。
 *
 * 这两列此前完全没有代码表示：运行层把所有 step 一律当成单轮 LLM 调用
 * （见 agent-registry.bridgeStepDescriptor 硬编码 "single-turn"），
 * 提示词则由各 step 自己决定吃哪几段。于是「体量大→多并行」「场景树」
 * 「逐节点填充」这些声明只活在表格里。本文件把它们变成代码事实。
 *
 * ─────────────────────────────────────────────────────────────────
 * 与 STEP_REGISTRY 的分工（不制造第二份事实源）
 * ─────────────────────────────────────────────────────────────────
 * 本表**只记表格里才有的东西**。io 契约（requiredInputs / outputField /
 * derivedFields）、LLM 参数（temperature / responseFormat）、依赖边一律仍以
 * StepDescriptor 为准，注册 AgentDef 时从那里派生（见 seat-agents.ts）。
 * 表格与实现重叠的字段若两处都写，迟早对不上。
 *
 * ─────────────────────────────────────────────────────────────────
 * 硬不变量（测试守）
 * ─────────────────────────────────────────────────────────────────
 *   1. 20 席与 assistant-seats.ts 的 20 席一一对应，不多不少；
 *   2. prototype 与 csvShape 的对应关系集中在 SHAPE_PROTOTYPE 一处；
 *   3. 声明形态与今天可执行原语的落差必须登记在 SHAPE_DIVERGENCES，
 *      未登记的落差会红——防止「声明了并行、其实还是单轮」这种事再次静默存在。
 */
import type { AgentPrototype } from "./agent-contract.js";
import type { AgentStructureType } from "./blueprint/types.js";
import type { PromptSlot } from "./prompt/skeleton.js";

// ════════════════════════════════════════════════════════
// 一、「agent 类型」列
// ════════════════════════════════════════════════════════

/**
 * CSV「agent 类型」列的原文取值，逐字保留以便与表格对照。
 *
 * 括号里的限定语描述的是**这一席内部怎么展开**，不是修饰词：
 *   体量大→多并行  角色/道具在体量大时按批并发，小体量退化为一次调用
 *   场景树          场景列表按树的层级分轮产出，层与层之间有依赖
 *   游戏单元展开    故事大纲逐个游戏单元展开宏观框架
 *   剧情树分支      故事结构逐个单元把大纲展开成剧情树
 *   逐节点填充      情节/任务/分镜按剧情树节点逐个填充，节点之间互不依赖
 */
export type SeatCsvShape =
  | "单agent"
  | "单agent（体量大→多并行）"
  | "多agent（场景树）"
  | "单agent（游戏单元展开）"
  | "单agent（剧情树分支）"
  | "多agent（逐节点填充）";

/**
 * CSV 形态 → 四原型。判读口径：
 *   「多agent」= 同时有多个 agent 在跑 → parallel（互不依赖）或 nested（有层级依赖）；
 *   「单agent（...）」= 产品上是一个助手，括号说明它内部如何多轮展开 → serial；
 *   体量大→多并行 是条件性并发，按其上限形态归 parallel。
 *
 * 归类有争议时改这里一处，不要在下面二十行里各写各的。
 */
export const SHAPE_PROTOTYPE: Readonly<Record<SeatCsvShape, AgentPrototype>> = {
  "单agent": "atomic",
  "单agent（体量大→多并行）": "parallel",
  "多agent（场景树）": "nested",
  "单agent（游戏单元展开）": "serial",
  "单agent（剧情树分支）": "serial",
  "多agent（逐节点填充）": "parallel",
};

// ════════════════════════════════════════════════════════
// 二、八段骨架的填充矩阵
// ════════════════════════════════════════════════════════

/** CSV 图例：√ 通用提示词 / ◐ 可插拔提示词 / × 不用填入提示词。 */
export type SlotFill = "generic" | "pluggable" | "none";

/**
 * 叙事策略段的四个子轴（对应 PromptSlot 的 strategy_* 四槽）。
 * 表里四轴各占一列，因为一席可能只吃其中几轴。
 */
export interface StrategyAxisFill {
  genre: SlotFill;
  type: SlotFill;
  theme: SlotFill;
  structure: SlotFill;
}

/**
 * 六段在全表二十席上一律是 √，因此不逐席重复，只在此登记为不变量。
 * CSV 若出现例外，改这里并同步 seat-spec.test.ts。
 */
export const ALWAYS_GENERIC_SLOTS: readonly PromptSlot[] = [
  "role",
  "task",
  "constraints",
  "cot",
  "material",
  "output",
];

/** 策略子轴 → 骨架插槽名。 */
export const STRATEGY_AXIS_SLOT: Readonly<Record<keyof StrategyAxisFill, PromptSlot>> = {
  genre: "strategy_genre",
  type: "strategy_type",
  theme: "strategy_theme",
  structure: "strategy_structure",
};

/** 四轴全不吃（表里 × × × ×）。 */
const NO_STRATEGY: StrategyAxisFill = {
  genre: "none",
  type: "none",
  theme: "none",
  structure: "none",
};

/** 四轴全可插拔（表里 ◐ ◐ ◐ ◐）——只有需求清单/策划文档/故事大纲/故事结构四席。 */
const ALL_STRATEGY: StrategyAxisFill = {
  genre: "pluggable",
  type: "pluggable",
  theme: "pluggable",
  structure: "pluggable",
};

// ════════════════════════════════════════════════════════
// 三、IP DNA 段的口径
// ════════════════════════════════════════════════════════

/**
 * CSV「IP DNA（模板/算子）」列的 ◐ 后面那段方括号注记，结构化后的形态。
 *
 *   field  按**字段**取：世界观/角色/道具/场景各取自己那一类的合集。
 *          coverage 区分「跨层全量」与「跨层非全量」——世界观只要跨层的要点，
 *          角色/道具/场景要全量，否则会漏掉只在某一层出现过的条目。
 *   layer  按**层级**取：故事大纲吃游戏单元级（模板 + 顶层算子），
 *          故事结构与故事情节吃故事单元级（模板 + 底层算子）。
 *   none   不吃。downstream_derived 表示它的内容是下游从上游产物派生的
 *          （任务/分镜/叙事卡/设定集），不是「忘了接」。
 */
export type IpDnaScope =
  | { mode: "none"; reason?: "downstream_derived" }
  | { mode: "field"; coverage: "full" | "partial"; collection: string }
  | { mode: "layer"; unit: "game_unit" | "story_unit"; operators: "top" | "bottom" };

const NO_IP_DNA: IpDnaScope = { mode: "none" };
const DOWNSTREAM_IP_DNA: IpDnaScope = { mode: "none", reason: "downstream_derived" };

// ════════════════════════════════════════════════════════
// 四、席位规格
// ════════════════════════════════════════════════════════

export interface SeatSpec {
  /** 席位 id，与 assistant-seats.ts 同名。 */
  seatId: string;
  /** CSV 第一列原文（与 AssistantSeat.name 不完全一致时以本字段为表格事实）。 */
  csvName: string;
  /** CSV「简介」列原文——这是该席**新架构下的职责**，写提示词时的第一依据。 */
  brief: string;
  csvShape: SeatCsvShape;
  /** 由 csvShape 推出的四原型（注册 AgentDef 时写进 prototype）。 */
  prototype: AgentPrototype;
  strategy: StrategyAxisFill;
  ipDna: IpDnaScope;
  /**
   * 老实现里可供参考的来源（用户在对话记录里给的映射）。
   *
   * 定位是**迁移参考，不是照搬清单**：新架构的产出口径以 feature list 详细描述
   * 为准，老实现只提供「这件事以前是怎么做的、哪部分还能用」。
   */
  migrateFrom?: string[];
}

/**
 * 二十席规格表。顺序与 CSV 行序一致（百科娘在首行）。
 *
 * 注意 brief 一栏抄的是 CSV「简介」列，几处与老实现口径明显不同的地方值得留意：
 *   - 需求清单助手要「结构类型预判」——叙事结构轴由本席推断，不由用户在入口选；
 *   - 故事大纲助手「游戏单元在此对齐」——单元是大纲的产出物，不是幕；
 *   - 故事结构助手「剧情树框架 + 标最优路径」——树在结构层成形，情节层只填内容。
 */
export const SEAT_SPECS: readonly SeatSpec[] = [
  {
    seatId: "encyclopedia",
    csvName: "百科娘",
    brief: "开启 websearching + 检索总结信息",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: NO_STRATEGY,
    ipDna: NO_IP_DNA,
  },
  {
    seatId: "req_list",
    csvName: "需求清单助手",
    brief: "提炼总结为叙事模板 + 结构类型预判",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: ALL_STRATEGY,
    ipDna: NO_IP_DNA,
    // 「叙事模板」是本席的产出而非输入（CSV 的 IP DNA 列对本席标 ×），
    // 所以迁移来源只有偏好两步，不含 IP DNA 子系统。
    migrateFrom: ["preference_summary", "preference_analysis"],
  },
  {
    seatId: "design_doc",
    csvName: "策划文档助手",
    brief: "规划关键设定，落盘叙事策略",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: ALL_STRATEGY,
    ipDna: NO_IP_DNA,
    migrateFrom: ["initial_plan"],
  },
  {
    seatId: "worldview",
    csvName: "世界观设定助手",
    brief: "输出世界观模块全局信息",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: NO_STRATEGY,
    ipDna: { mode: "field", coverage: "partial", collection: "世界观合集" },
    migrateFrom: ["worldview"],
  },
  {
    seatId: "character",
    csvName: "角色档案助手",
    brief: "输出角色模块全局信息",
    csvShape: "单agent（体量大→多并行）",
    prototype: SHAPE_PROTOTYPE["单agent（体量大→多并行）"],
    strategy: NO_STRATEGY,
    ipDna: { mode: "field", coverage: "full", collection: "角色合集" },
    migrateFrom: ["character_enrichment"],
  },
  {
    seatId: "item",
    csvName: "道具清单助手",
    brief: "输出道具模块全局信息",
    csvShape: "单agent（体量大→多并行）",
    prototype: SHAPE_PROTOTYPE["单agent（体量大→多并行）"],
    strategy: NO_STRATEGY,
    ipDna: { mode: "field", coverage: "full", collection: "道具合集" },
    migrateFrom: ["item_database"],
  },
  {
    seatId: "scene_list",
    csvName: "场景列表助手",
    brief: "输出场景模块全局信息",
    csvShape: "多agent（场景树）",
    prototype: SHAPE_PROTOTYPE["多agent（场景树）"],
    strategy: NO_STRATEGY,
    ipDna: { mode: "field", coverage: "full", collection: "场景合集" },
    migrateFrom: ["scene_generation"],
  },
  {
    seatId: "outline",
    csvName: "故事大纲助手",
    brief: "宏观框架，游戏单元在此对齐",
    csvShape: "单agent（游戏单元展开）",
    prototype: SHAPE_PROTOTYPE["单agent（游戏单元展开）"],
    strategy: ALL_STRATEGY,
    ipDna: { mode: "layer", unit: "game_unit", operators: "top" },
    migrateFrom: ["story_framework"],
  },
  {
    seatId: "structure",
    csvName: "故事结构助手",
    brief: "剧情树框架 + 标最优路径",
    csvShape: "单agent（剧情树分支）",
    prototype: SHAPE_PROTOTYPE["单agent（剧情树分支）"],
    strategy: ALL_STRATEGY,
    ipDna: { mode: "layer", unit: "story_unit", operators: "bottom" },
    migrateFrom: ["outline_batch", "detailed_outline", "vn_outline_acts", "vn_branched_beats"],
  },
  {
    seatId: "plot",
    csvName: "故事情节助手",
    brief: "填充节点具体情节",
    csvShape: "多agent（逐节点填充）",
    prototype: SHAPE_PROTOTYPE["多agent（逐节点填充）"],
    strategy: NO_STRATEGY,
    ipDna: { mode: "layer", unit: "story_unit", operators: "bottom" },
    migrateFrom: ["plot_generation", "vn_screenplay"],
  },
  {
    seatId: "quest",
    csvName: "任务助手",
    brief: "任务树 + 数值系统",
    csvShape: "多agent（逐节点填充）",
    prototype: SHAPE_PROTOTYPE["多agent（逐节点填充）"],
    strategy: NO_STRATEGY,
    ipDna: DOWNSTREAM_IP_DNA,
    migrateFrom: ["quest_generation"],
  },
  {
    seatId: "storyboard",
    csvName: "分镜工助手",
    brief: "剧本分镜美术",
    csvShape: "多agent（逐节点填充）",
    prototype: SHAPE_PROTOTYPE["多agent（逐节点填充）"],
    strategy: NO_STRATEGY,
    ipDna: DOWNSTREAM_IP_DNA,
    migrateFrom: ["script_generation", "vn_screenplay"],
  },
  {
    seatId: "narrative_card",
    csvName: "叙事卡助手",
    brief: "低叙事品类直接包装",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: NO_STRATEGY,
    ipDna: DOWNSTREAM_IP_DNA,
    migrateFrom: ["narrative_card"],
  },
  {
    seatId: "codex",
    csvName: "设定集助手",
    brief: "低叙事品类直接包装",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: NO_STRATEGY,
    ipDna: DOWNSTREAM_IP_DNA,
    migrateFrom: ["lore_generation"],
  },
  {
    seatId: "structure_check",
    csvName: "结构检查助手",
    brief: "检查生成的结构是否正确并修正",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: NO_STRATEGY,
    ipDna: NO_IP_DNA,
    migrateFrom: ["structure_check"],
  },
  {
    seatId: "content_check",
    csvName: "内容（吃书）检查助手",
    brief: "检查生成的内容是否正确并修正",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: NO_STRATEGY,
    ipDna: NO_IP_DNA,
  },
  {
    seatId: "deai",
    csvName: "去ai味助手",
    brief: "优化表达人机感并修正",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: NO_STRATEGY,
    ipDna: NO_IP_DNA,
  },
  {
    seatId: "plot_refine",
    csvName: "情节优化助手",
    brief: "优化生成的情节的人物刻画、剧情推进和环境描写",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: NO_STRATEGY,
    ipDna: NO_IP_DNA,
  },
  {
    seatId: "plot_polish",
    csvName: "情节润色助手",
    brief: "优化生成的情节的表达方式和表现手法",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: NO_STRATEGY,
    ipDna: NO_IP_DNA,
  },
  {
    seatId: "playability",
    csvName: "玩法适配助手",
    brief: "适配叙事&玩法",
    csvShape: "单agent",
    prototype: SHAPE_PROTOTYPE["单agent"],
    strategy: NO_STRATEGY,
    ipDna: NO_IP_DNA,
  },
];

// ════════════════════════════════════════════════════════
// 五、声明形态 × 今天可执行原语的落差
// ════════════════════════════════════════════════════════

/**
 * 一条落差登记 = 「这一席声明的是 A 形态，今天实际按 B 原语跑」。
 *
 * 为什么要显式登记而不是直接把 structure 写成声明形态：五个 runner
 * （single-turn / chunked / sequence / composite / conditional / deterministic）
 * 都已实现，但 chunked/sequence 需要知道「按什么切分、每片喂什么提示词」，
 * 而这些席今天的分片逻辑写在各自 step 函数体内部（如场景席的 L1 batch=12、
 * 任务席的 batch=6）。在把分片参数上移进 ChunkedConfig 之前就把 structure
 * 标成 chunked，只会让 useNewRunner 一旦打开就跑进一个不认识我们数据的 runner。
 *
 * 所以：prototype 按表声明（画布连接能力、平台看到的形态由它决定），
 * structure 记今天真能跑的原语，两者的差记在这里，由测试盯着不许悄悄消失。
 */
export interface ShapeDivergence {
  seatId: string;
  /** 今天实际使用的执行原语。 */
  actual: AgentStructureType;
  /** 把 actual 提升到声明形态还差什么。 */
  blocker: string;
}

export const SHAPE_DIVERGENCES: readonly ShapeDivergence[] = [
  {
    seatId: "character",
    actual: "single-turn",
    blocker: "体量大时的分批并发写在 character-enrichment 内部，未上移为 ChunkedConfig",
  },
  {
    seatId: "item",
    actual: "single-turn",
    blocker: "同角色席：分批策略未上移为 ChunkedConfig",
  },
  {
    seatId: "scene_list",
    actual: "single-turn",
    blocker: "场景树的 L1/L2 分轮与并行度（batch 12/5、并发 6）写在 scene-generation 内部",
  },
  {
    seatId: "outline",
    actual: "single-turn",
    blocker: "游戏单元的逐单元展开在 story-framework 内部成环，未拆成 SequenceStage",
  },
  {
    seatId: "structure",
    actual: "single-turn",
    blocker: "本席由 outline_batch + detailed_outline 两 agent 串成，席位级 sequence 尚未建模",
  },
  {
    seatId: "plot",
    actual: "single-turn",
    blocker: "逐节点填充在 plot-generation 内部循环，未上移为 ChunkedConfig",
  },
  {
    seatId: "quest",
    actual: "single-turn",
    blocker: "逐节点填充的 batch=6 写在 quest-generation 内部",
  },
  {
    seatId: "storyboard",
    actual: "single-turn",
    blocker: "逐节点填充在 script-generation 内部循环",
  },
];

// ════════════════════════════════════════════════════════
// 六、查询
// ════════════════════════════════════════════════════════

const SPEC_INDEX: ReadonlyMap<string, SeatSpec> = new Map(
  SEAT_SPECS.map((s) => [s.seatId, s]),
);

export function getSeatSpec(seatId: string): SeatSpec | undefined {
  return SPEC_INDEX.get(seatId);
}

const DIVERGENCE_INDEX: ReadonlyMap<string, ShapeDivergence> = new Map(
  SHAPE_DIVERGENCES.map((d) => [d.seatId, d]),
);

/**
 * 该席今天该用哪个执行原语：登记了落差就用登记值，否则声明形态即可执行。
 *
 * atomic → single-turn 是唯一「声明即可执行」的映射；其余三个原型今天都必须
 * 有落差登记，否则 assertSeatSpecComplete 会报错。
 */
export function executableStructureFor(seatId: string): AgentStructureType {
  const divergence = DIVERGENCE_INDEX.get(seatId);
  if (divergence) return divergence.actual;
  return "single-turn";
}

/** 该席在八段骨架里吃到的策略子轴（供提示词装配按需加载）。 */
export function seatStrategyAxes(seatId: string): StrategyAxisFill {
  return SPEC_INDEX.get(seatId)?.strategy ?? NO_STRATEGY;
}

/**
 * 该席该注入哪几个策略插槽。表里标 × 的轴不注入——不是省 token，
 * 而是四轴策略卡对不吃它的席位是噪声（如角色档案席不该被叙事结构策略牵着走）。
 */
export function seatStrategySlots(seatId: string): PromptSlot[] {
  const axes = seatStrategyAxes(seatId);
  return (Object.keys(STRATEGY_AXIS_SLOT) as Array<keyof StrategyAxisFill>)
    .filter((axis) => axes[axis] !== "none")
    .map((axis) => STRATEGY_AXIS_SLOT[axis]);
}

/**
 * 契约自检：表格本身是否自洽。抛错即表示这张表与 CSV 或与四原型语义脱节，
 * 应在启动/测试期暴露而非运行期。
 */
export function assertSeatSpecComplete(): void {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const spec of SEAT_SPECS) {
    if (seen.has(spec.seatId)) problems.push(`${spec.seatId}: 重复登记`);
    seen.add(spec.seatId);

    if (spec.prototype !== SHAPE_PROTOTYPE[spec.csvShape]) {
      problems.push(
        `${spec.seatId}: prototype 与 csvShape 不一致（应为 ${SHAPE_PROTOTYPE[spec.csvShape]}），`
          + "请改 SHAPE_PROTOTYPE 而不是逐席硬写",
      );
    }

    // 非 atomic 的声明形态今天都还没有对应 runner 接管，必须有落差登记；
    // 反之 atomic 席不该有落差——它本来就是单轮。
    const divergence = DIVERGENCE_INDEX.get(spec.seatId);
    if (spec.prototype === "atomic" && divergence) {
      problems.push(`${spec.seatId}: atomic 席不应登记形态落差`);
    }
    if (spec.prototype !== "atomic" && !divergence) {
      problems.push(
        `${spec.seatId}: 声明为 ${spec.prototype} 却没有落差登记——`
          + "若已把分片/分阶段参数上移到 structure，请连同 executableStructureFor 一起改",
      );
    }

    if (spec.ipDna.mode === "field" && !spec.ipDna.collection.trim()) {
      problems.push(`${spec.seatId}: IP DNA 字段级口径缺 collection`);
    }
  }

  for (const d of SHAPE_DIVERGENCES) {
    if (!SPEC_INDEX.has(d.seatId)) {
      problems.push(`落差登记指向不存在的席位 ${d.seatId}`);
    }
    if (!d.blocker.trim()) {
      problems.push(`${d.seatId}: 落差登记缺 blocker 说明`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`SeatSpec 契约不成立：\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}
