/**
 * pipeline/narrative-pipelines.ts —— 新架构叙事管线（四期，SSOT）。
 *
 * 事实源：MyFile/feature_list2/叙事工坊 feature list-agent-叙事策划专家组.csv
 * 那张表里 117 个品类专家、第 7 列「叙事管线」去重之后**只有四条**。四条管线全部
 * 由 assistant-seats.ts 的二十席组合而成——"专家 = 席位的编排"在这里第一次成为
 * 代码事实，而不只是文档说法。
 *
 * ┌─ 四条管线与层级的对应（层级编号方向相反，是历史遗留，语义一致）
 * │  CSV T4 重度叙事(20) = 代码 tier1 ─┬→ 任务线（除影游）
 * │  CSV T3 中度叙事(45) = 代码 tier2 ─┘   影游单独走分镜线
 * │  CSV T2 轻度叙事(34) = 代码 tier3  → 设定集线
 * │  CSV T1 极简叙事(18) = 代码 tier4  → 叙事卡线
 * └─
 *
 * 与旧 PIPELINE_TEMPLATES 的关系：旧表是十一个按品类家族切的 step 序列，
 * 新架构收敛成四条按**叙事层级**切的席位序列。旧表不再作为路由目标，
 * 只保留供历史 checkpoint 读取（见 templates.ts 各条的 legacy 注记）。
 * 新旧解析结果的差异由 narrative-pipelines.test.ts 显式登记，不做静默切换。
 */
import type { TierId } from "../types/index.js";
import { resolveSeatAgents, getSeat, type SeatScope } from "./assistant-seats.js";

export type NarrativePipelineId = "pl-narrative" | "pl-film-game" | "pl-codex" | "pl-card";

/**
 * 管线的前置阶段：CSV 每条管线都以「需求输入（IP作品提炼）→叙事路由」开头。
 * 这两步不是 agent——前者是用户在创作空间底栏填需求 / 传原作，后者是四轴选轴。
 * 记在这里是为了让"管线定义"与 CSV 逐字对得上，展开成 step 时会跳过。
 */
export const PIPELINE_PREAMBLE = ["需求输入（IP作品提炼）", "叙事路由"] as const;

export interface NarrativePipeline {
  id: NarrativePipelineId;
  /** 展示名（前端专家组卡片上的管线名） */
  name: string;
  /** CSV 第 7 列的环节名序列，逐字保留以便复核 */
  csvStages: readonly string[];
  /** 环节对应的席位 id 序列（与 csvStages 去掉前置阶段后一一对应） */
  seats: readonly string[];
  /**
   * 把席位解析成具体 step 时用的作用域。
   * 影游线用 tpl-vn-v2 取到影游专属实现（logline / 三幕 / 剧情树 / 剧本 / 分镜）——
   * 那批 step 本身就是新席位的实现，v2 只是它们的历史作用域名。
   */
  implScope: SeatScope;
  /** 本管线覆盖的层级（tier1 最重 … tier4 最简） */
  tiers: readonly TierId[];
  /** 从层级默认里单独挑出来走本管线的品类 */
  genreOverrides: readonly string[];
}

/** 前六席：四条管线共用的设定层地基（叙事卡线只取前三席）。 */
const SETTING_SEATS = [
  "req_list",
  "design_doc",
  "worldview",
  "character",
  "item",
  "scene_list",
] as const;

/** 叙事层：大纲 → 结构 → 情节，产出剧情树。 */
const NARRATIVE_SEATS = ["outline", "structure", "plot"] as const;

/**
 * 质检段：结构检查 + 内容检查。
 * CSV 写作「质检（故事、角色、道具、场景）」——四个受检对象，两个检查席分工：
 * 结构检查管剧情树的分支/聚合/结局/节奏，内容检查管吃书防范与世界观、角色弧光适配。
 * content_check 目前 status=planned，展开时按 includePlanned 决定是否落进步序。
 */
const QA_SEATS = ["structure_check", "content_check"] as const;

export const NARRATIVE_PIPELINES: Readonly<Record<NarrativePipelineId, NarrativePipeline>> = {
  "pl-narrative": {
    id: "pl-narrative",
    name: "叙事管线（任务）",
    csvStages: [
      ...PIPELINE_PREAMBLE,
      "需求清单", "策划文档", "世界观设定", "角色档案", "道具清单", "场景列表",
      "故事大纲", "故事结构", "故事情节", "任务", "质检（故事、角色、道具、场景）",
    ],
    seats: [...SETTING_SEATS, ...NARRATIVE_SEATS, "quest", ...QA_SEATS],
    implScope: {},
    tiers: ["tier1", "tier2"],
    genreOverrides: [],
  },

  "pl-film-game": {
    id: "pl-film-game",
    name: "叙事管线（分镜）",
    csvStages: [
      ...PIPELINE_PREAMBLE,
      "需求清单", "策划文档", "世界观设定", "角色档案", "道具清单", "场景列表",
      "故事大纲", "故事结构", "故事情节", "分镜", "质检（故事、角色、道具、场景）",
    ],
    /**
     * 与任务线共用**同一批席位实现**，只有交付席不同（分镜替任务）。
     *
     * 这里刻意不接归档的 tpl-vn-v2 实现：那条线以"三幕"为骨架，而新架构里
     * 不管 RPG 还是影游都不再有"幕"——大纲定叙事单元、结构展开为剧情树、
     * 情节填节点内容，三层职责对所有品类同构。剧情树的**形态差异**（线性 /
     * 树状 / 碎片化 / 涌现 / 混合 / 多线交织 / 多视角交织）由叙事策略的结构轴
     * 策略卡决定，不靠给影游另开一条管线来实现。
     *
     * 影游之所以仍单列一条，只因它的下游是生图/生视频模型而非任务系统：
     * 交付物是分镜，不是任务树。
     */
    seats: [...SETTING_SEATS, ...NARRATIVE_SEATS, "storyboard", ...QA_SEATS],
    implScope: {},
    tiers: [],
    // 影游是全表唯一走分镜线的品类：它的下游是生图/生视频模型，不是任务系统。
    genreOverrides: ["adv-interactive"],
  },

  "pl-codex": {
    id: "pl-codex",
    name: "叙事管线（设定集）",
    csvStages: [
      ...PIPELINE_PREAMBLE,
      "需求清单", "策划文档", "世界观设定", "角色档案", "道具清单", "场景列表", "设定集",
    ],
    // 轻度叙事不产剧情树：设定齐了就交付设定集，不进大纲/结构/情节。
    seats: [...SETTING_SEATS, "codex"],
    implScope: {},
    tiers: ["tier3"],
    genreOverrides: [],
  },

  "pl-card": {
    id: "pl-card",
    name: "叙事管线（叙事卡）",
    csvStages: [
      ...PIPELINE_PREAMBLE,
      "需求清单", "策划文档", "世界观设定", "叙事卡",
    ],
    // 极简叙事连角色/道具/场景都不单独出：一张叙事卡自成一体。
    seats: ["req_list", "design_doc", "worldview", "narrative_card"],
    implScope: {},
    tiers: ["tier4"],
    genreOverrides: [],
  },
};

export const NARRATIVE_PIPELINE_IDS = Object.keys(
  NARRATIVE_PIPELINES,
) as NarrativePipelineId[];

const OVERRIDE_INDEX = new Map<string, NarrativePipelineId>();
const TIER_INDEX = new Map<TierId, NarrativePipelineId>();
for (const p of Object.values(NARRATIVE_PIPELINES)) {
  for (const code of p.genreOverrides) OVERRIDE_INDEX.set(code, p.id);
  for (const tier of p.tiers) {
    const prev = TIER_INDEX.get(tier);
    if (prev && prev !== p.id) {
      throw new Error(`层级 ${tier} 被 ${prev} 与 ${p.id} 同时认领，层级到管线必须唯一`);
    }
    TIER_INDEX.set(tier, p.id);
  }
}

/**
 * 品类 → 新架构管线。品类特例优先于层级默认。
 *
 * 与旧 resolvePipelineTemplate 的根本差别：旧函数按品类家族逐条列举（117 个品类里
 * 66 个要写 override），新函数按层级归类（只有影游一个特例）。层级本就是"这游戏
 * 有多少叙事"的度量，管线深浅正该由它决定。
 */
export function resolveNarrativePipeline(
  genreCode: string,
  tier: TierId,
): NarrativePipeline {
  const byOverride = OVERRIDE_INDEX.get(genreCode);
  if (byOverride) return NARRATIVE_PIPELINES[byOverride];
  const byTier = TIER_INDEX.get(tier);
  if (!byTier) throw new Error(`层级 ${tier} 没有对应管线`);
  return NARRATIVE_PIPELINES[byTier];
}

export interface ExpandOptions {
  /** 是否把 status=planned 的席位也展开（默认 false：只跑已实现的） */
  includePlanned?: boolean;
}

/**
 * 席位序列 → step 序列。
 *
 * 一席可能对应多个 step（如需求清单席 = 偏好总结 + 偏好分析），席内顺序即
 * 席位绑定里声明的顺序。未实现的席位（planned）默认跳过，让四条管线今天就能跑，
 * 而不是等六个 planned 席全部落地才通电。
 */
export function expandPipelineSteps(
  pipeline: NarrativePipeline,
  options: ExpandOptions = {},
): string[] {
  const steps: string[] = [];
  for (const seatId of pipeline.seats) {
    const seat = getSeat(seatId);
    if (!seat) throw new Error(`管线 ${pipeline.id} 引用了不存在的席位 ${seatId}`);
    if (seat.status === "planned" && !options.includePlanned) continue;
    steps.push(...resolveSeatAgents(seatId, pipeline.implScope));
  }
  return steps;
}

/** 本管线里尚未落地的席位（planned），用于前端标灰与进度统计。 */
export function pendingSeats(pipeline: NarrativePipeline): string[] {
  return pipeline.seats.filter((id) => getSeat(id)?.status === "planned");
}

/**
 * 品类 + 层级 → 该跑的步序。运行时（pipeline.run）与预览（/plan）共用的唯一入口。
 *
 * 这是四期路由的落地点：PRD v1.4 §3.2.3 规定所有品类走同一条通用流程，品类差异
 * 来自提示词槽位 / 策略卡 / 产出模板，不来自各写一条链。所以这里不再按 needs 或
 * 原型族现算步序，只按（层级 + 影游特例）取四条之一。
 *
 * 步序是纯串行的：CSV 的环节本就一环接一环，并行组由具体 agent 内部的批处理承担，
 * 不在管线层展开。
 */
export function resolveSeatStepGroups(
  genreCode: string | null | undefined,
  tier: TierId,
): { pipeline: NarrativePipeline; stepGroups: string[] } {
  const pipeline = resolveNarrativePipeline(genreCode ?? "", tier);
  return { pipeline, stepGroups: expandPipelineSteps(pipeline) };
}
