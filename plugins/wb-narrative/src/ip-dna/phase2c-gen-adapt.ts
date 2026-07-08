/**
 * Phase 2c · 输出游戏化资产整理与管线适配 —— 蓝图 §3.1c / §4.6。
 *
 * 把游戏单元规划映射到现有生成管线（tpl-rpg / tpl-vn-v2），统一单品/系列两模式：
 *   - 单品 single：完整游戏叙事内容(游戏单元(剧情树)) - 游戏叙事节点(L2/P1)。整段=一次管线运行。
 *   - 系列 series：完整内容 - 部(游戏单元(剧情树)，对应 rpg L0框架节点 / vn P0幕节点) - 节点。
 *     每个"部"=一个游戏单元=一次管线运行。
 *
 * 恒等：游戏单元=一棵剧情树；游戏叙事节点=rpg L2 / vn P1；每单元剧情树 ≥ 25 节点。
 * VN 适配：开放幕数（不再固定三幕）+ 复杂度/节点数量控制（对齐 rpg）。
 */

import type { PipelineTemplateId } from "../pipeline/templates.js";
import type { TargetStructure } from "../types/index.js";
import type { GameUnit, GameUnitPlan, GameMode } from "../types/narrative-ip-dna.js";
import { DEFAULT_UNITS_PER_GAME_UNIT } from "./phase2b-adapt.js";

/** 每个游戏单元剧情树的最小节点数（恒等约束，§4.6）。 */
export const MIN_PLOT_TREE_NODES = 25;

/** 系列游戏单元结局总数默认上限（§4.6b，蓝图建议 3-5，取上界防结局爆炸）。 */
export const DEFAULT_MAX_ENDINGS_PER_SERIES_UNIT = 5;

/**
 * 系列结局收束 + 跨部承接约束（§4.6b，精简版：以提示词约束注入下游，不新增落盘字段）。
 *
 * 覆盖底层管线「结局不设上限」对系列单元的问题——每部约束结局数量、区分承接/收束结局：
 *   - 非末部：恰好 1（最多 2）个「承接结局」通向下一部（留主角状态/世界变化/悬念钩子），其余就地收束；
 *   - 末部：全部就地收束，不再留钩子。
 * 跨部只经承接结局的收尾状态传递，禁止跨部节点直接连边（bounded coupling）。
 * 返回空串表示非系列/无需注入。
 */
export function buildSeriesEndingDirective(
  mode: GameMode,
  unitIndex: number,
  totalUnits: number,
  maxEndings: number = DEFAULT_MAX_ENDINGS_PER_SERIES_UNIT,
): string {
  if (mode !== "series" || totalUnits <= 1) return "";
  const isLast = unitIndex >= totalUnits;
  const head = `## 系列结局收束约束（本部为系列第 ${unitIndex}/共 ${totalUnits} 部）`;
  if (isLast) {
    return [
      head,
      `- 本部是系列最后一部：所有结局均为「就地收束」结局，不再为后续留承接钩子。`,
      `- 本部结局总数控制在 ${maxEndings} 个以内，避免结局无限膨胀。`,
    ].join("\n");
  }
  return [
    head,
    `- 恰好设置 1 个（最多 2 个）「承接结局」作为通向下一部的正典出口：该结局须为下一部留下延续钩子（主角状态、世界关键变化、未竟悬念）。`,
    `- 其余结局一律为「就地收束」结局，本部内闭合。`,
    `- 本部结局总数控制在 ${maxEndings} 个以内。`,
    `- 跨部只通过承接结局的收尾状态传递，禁止本部节点与其他部节点直接连边。`,
  ].join("\n");
}

/** 管线家族选择（rpg=层级树管线；vn=互动影游管线）。 */
export type PipelineFamily = "rpg" | "vn";

export interface GameUnitPipelinePlan {
  /** 游戏单元序号。 */
  unitIndex: number;
  /** 该单元对应的管线模板。 */
  pipelineTemplate: PipelineTemplateId;
  /** 复杂度档（喂节点预算）。 */
  complexity: number;
  /** 目标节点数（≥25）。 */
  targetNodeCount: number;
  /** RPG：层级目标结构。 */
  targetStructure?: TargetStructure;
  /** VN：开放幕数（不固定三幕）。 */
  vnActCount?: number;
  /** 系列模式下对应的顶层节点语义（rpg L0 框架节点 / vn P0 幕节点）。 */
  topLevelMapping?: "rpg-L0" | "vn-P0";
}

/**
 * VN 开放幕数解析（§4.6 关键适配）：按目标节点数派生幕数，替代固定三幕。
 * 经验：每幕 ≈ 8-10 个情节点；clamp 到 [2, 6] 幕，保留戏剧节拍。
 */
export function resolveVnActCount(targetNodeCount: number): number {
  const n = Math.max(MIN_PLOT_TREE_NODES, targetNodeCount);
  const acts = Math.round(n / 9);
  return Math.max(2, Math.min(6, acts));
}

/**
 * 由目标节点数派生 RPG 层级目标结构（粗分配：L0 框架节点 × L1 × L2）。
 * 满足 l0*l1*l2 ≈ targetNodeCount 且 ≥25；优先保证 L2（=游戏叙事节点）密度。
 */
export function deriveRpgTargetStructure(targetNodeCount: number, complexity: number): TargetStructure {
  const n = Math.max(MIN_PLOT_TREE_NODES, targetNodeCount);
  // 经验分配：L0 = 3~5，L1 每父 2~3，L2 每父 2~3
  const l0 = Math.max(3, Math.min(6, Math.round(Math.cbrt(n))));
  const remaining = n / l0;
  const l1 = Math.max(2, Math.min(4, Math.round(Math.sqrt(remaining))));
  const l2 = Math.max(2, Math.ceil(remaining / l1));
  return {
    l0_nodes: l0,
    l1_per_parent: l1,
    l2_per_parent: l2,
    enable_branch: complexity >= 3,
    plot_length: n,
  };
}

export interface MapToPipelineOptions {
  family: PipelineFamily;
  /** 缺省复杂度（单元未指定时）。 */
  defaultComplexity?: number;
}

/** 单个游戏单元 → 管线计划。 */
export function mapGameUnitToPipeline(
  unit: GameUnit,
  mode: GameMode,
  opts: MapToPipelineOptions,
): GameUnitPipelinePlan {
  const complexity = unit.targetComplexity ?? opts.defaultComplexity ?? 3;
  const targetNodeCount = Math.max(MIN_PLOT_TREE_NODES, unit.targetNodeCount ?? DEFAULT_UNITS_PER_GAME_UNIT);
  const topLevelMapping =
    mode === "series" ? (opts.family === "rpg" ? "rpg-L0" : "vn-P0") : undefined;

  if (opts.family === "vn") {
    return {
      unitIndex: unit.index,
      pipelineTemplate: "tpl-vn-v2",
      complexity,
      targetNodeCount,
      vnActCount: resolveVnActCount(targetNodeCount),
      topLevelMapping,
    };
  }
  return {
    unitIndex: unit.index,
    pipelineTemplate: "tpl-rpg",
    complexity,
    targetNodeCount,
    targetStructure: deriveRpgTargetStructure(targetNodeCount, complexity),
    topLevelMapping,
  };
}

/**
 * 管线家族 → 规范代表品类 code（§4.6 关键接缝）。
 *
 * 背景：编排器生成默认走 design_auto 模式，叙事步骤链的模板由
 * `demand_analysis.genre_code` 解析。编排器不向生成管线传 genre_code 时，
 * 管线会退化为后备品类 `rpg-jrpg`（→ tpl-rpg），导致改编选定 `pipeline_family: vn`
 * 的内容仍误跑 RPG 层级链。把家族映射回其规范代表品类，使模板解析锁定到对应链：
 *   - vn  → adv-interactive（GENRE_TEMPLATE_OVERRIDES 中映射到 tpl-vn-v2）
 *   - rpg → undefined（沿用既有 LLM 检测 / rpg-jrpg 默认，行为不变）
 *
 * 返回 undefined 表示「不强制品类」。调用方若已显式指定 genreCode 则不应覆盖。
 */
export function representativeGenreForFamily(family: PipelineFamily): string | undefined {
  return family === "vn" ? "adv-interactive" : undefined;
}

/** 整套游戏单元规划 → 一组管线计划（单品=1 个；系列=N 个）。 */
export function planPipelineRuns(
  plan: GameUnitPlan,
  opts: MapToPipelineOptions,
): GameUnitPipelinePlan[] {
  return plan.units.map((u) => mapGameUnitToPipeline(u, plan.mode, opts));
}
