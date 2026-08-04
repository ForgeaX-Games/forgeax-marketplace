/**
 * pipeline/prompt/strategy-slots.ts —— 叙事策略段（骨架第 ③ 段）的四个 provider。
 *
 * 四轴各占一个子槽，内容来自约定式策略库（knowledge/strategy/*.md）。
 * 与 IP DNA 段的差别：IP DNA 的内容是运行时算出来写进 ctx 的，策略卡是静态文件，
 * 这里直接按四轴 code 查库。
 *
 * 生效范围严格限定四个环节 —— feature list 的单品 agent 表里只有这四席标了 ◐，
 * 其余环节即便声明了 STRATEGY_SLOT_BLOCK 也会拿到空串、整块塌缩。
 */
import type { PromptSlot } from "./skeleton.js";
import type { FragmentProvider } from "./providers.js";
import type { NarrativeContext } from "../../types/index.js";
import type { StrategyAxis } from "../../knowledge/narrative-axes/index.js";
import type { StrategyStage } from "../../knowledge/narrative-axes/story-structures.js";
import { STRATEGY_AXIS_LABELS } from "../../knowledge/narrative-axes/index.js";
import { getStrategyCards } from "../../knowledge/strategy/strategy-loader.js";

/**
 * step → 策略环节。表外的 step 不装配策略卡。
 *
 * 环节按**席位**定，不按 step 名：feature list 标 ◐ 的是需求清单 / 策划文档 /
 * 故事大纲 / 故事结构四席，一席在不同管线下是不同 step，都要能吃到卡。
 *
 * 两处随席位反转纠正过来的落点：
 *   - outline 环节原先挂在 outline_batch，但那是 L1 微观展开、属故事结构席；
 *     宏观框架才是故事大纲席，RPG 侧是 story_framework。
 *   - 影游管线此前一个 step 都没登记，等于三轴策略对 tpl-vn-v2 完全不生效。
 */
export const STEP_TO_STRATEGY_STAGE: Readonly<Record<string, StrategyStage>> = {
  // 需求清单席
  //   影游侧的 vn_script_normalize 同属本席但**不登记**：它做的是对上传剧本的
  //   忠实抽取，产出须贴原文，注入策略卡只会诱导它改写素材。
  preference_summary: "demand",
  // 策划文档席
  initial_plan: "design",
  vn_logline: "design",
  // 故事大纲席（宏观框架）
  story_framework: "outline",
  vn_outline_acts: "outline",
  // 故事结构席（微观展开 + 剧情树）
  outline_batch: "structure",
  detailed_outline: "structure",
  vn_beats: "structure",
  vn_branched_beats: "structure",
};

/** 四个策略子槽，顺序与 PROMPT_SLOT_ORDER 一致。 */
export const STRATEGY_SLOTS: readonly Extract<
  PromptSlot,
  "strategy_genre" | "strategy_type" | "strategy_theme" | "strategy_structure"
>[] = ["strategy_genre", "strategy_type", "strategy_theme", "strategy_structure"];

const SLOT_TO_AXIS: Readonly<Record<(typeof STRATEGY_SLOTS)[number], StrategyAxis>> = {
  strategy_genre: "genre",
  strategy_type: "type",
  strategy_theme: "theme",
  strategy_structure: "structure",
};

/**
 * 品类优先取配置注入的那一份（选专家时就定了），检测结果只作旧条目/自动路由的兜底。
 */
function resolveGenreCode(ctx: NarrativeContext): string | null {
  return (
    ctx.narrative_axes?.genre ??
    ctx.demand_analysis?.genre_code ??
    ctx.tier_detection?.genre_code ??
    null
  );
}

/** 取本次运行的四轴 code；未换轴的旧条目只有品类一轴。 */
export function resolveStrategySelection(ctx: NarrativeContext): Record<StrategyAxis, string | null> {
  const axes = ctx.narrative_axes;
  return {
    genre: resolveGenreCode(ctx),
    type: axes?.storyType ?? null,
    theme: axes?.storyTheme ?? null,
    structure: axes?.structure ?? null,
  };
}

function makeStrategyProvider(slot: (typeof STRATEGY_SLOTS)[number]): FragmentProvider {
  const axis = SLOT_TO_AXIS[slot];
  return {
    slot,
    name: `strategy-${axis}`,
    provide({ ctx, stepId }) {
      const stage = STEP_TO_STRATEGY_STAGE[stepId];
      if (!stage) return "";
      const card = getStrategyCards(resolveStrategySelection(ctx), stage)[axis];
      if (!card) return "";
      return `### ${STRATEGY_AXIS_LABELS[axis]}：${card.name}\n\n${card.body}`;
    },
  };
}

export const strategyGenreProvider = makeStrategyProvider("strategy_genre");
export const strategyTypeProvider = makeStrategyProvider("strategy_type");
export const strategyThemeProvider = makeStrategyProvider("strategy_theme");
export const strategyStructureProvider = makeStrategyProvider("strategy_structure");

export const STRATEGY_PROVIDERS: readonly FragmentProvider[] = [
  strategyGenreProvider,
  strategyTypeProvider,
  strategyThemeProvider,
  strategyStructureProvider,
];
