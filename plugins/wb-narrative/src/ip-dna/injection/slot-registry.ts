/**
 * ip-dna/injection/slot-registry.ts —— 蓝图 §7 / §7.2 / §7.2b。
 *
 * 声明「哪些生成 step 在消费算子，且各需要哪些三视角槽位」。
 * 只有列入本表的 step 才会触发算子注入（蓝图 §7：仅在消费算子的环节加载）；
 * 其余 step（如 tier 检测、需求分析、归一化）一律不注入，保持零额外开销。
 *
 * 槽位命名对齐蓝图算子五大核心分类的实际消费形态：
 *   - 结构算子：剧情树/幕/场的拓扑与节奏（框架/大纲/幕/场层）
 *   - 情节算子：事件因果链、转折与悬念（情节点/beat 层）
 *   - 对白算子：台词、潜台词、信息释放（剧本/分镜层）
 *   - 风格算子：文学风格、叙事者定位、画面语言（全层可选）
 *   - 情感算子：读者/玩家情感体验曲线（全层可选）
 *
 * 视角（author/reader/character）是槽位内分组键，由 fillSlot 在运行时填满，
 * 不在本表声明（§4.5）。
 */

import { getAgentDef } from "../../pipeline/blueprint/agent-def-registry.js";

/** 一个生成 step 声明它消费的算子槽位（按需取最相关的几类，避免提示词膨胀）。 */
export interface StepSlotSpec {
  /** 该 step 需要的槽位名（顺序即注入顺序）。 */
  slots: string[];
  /** 该 step 是否需要 KAG 关系网络子图注入（§8）。 */
  kag?: boolean;
  /** 该 step 是否需要长记忆账本一致性约束注入（§10）。 */
  ledger?: boolean;
  /** 检索 query 的侧重提示（拼到 query 末尾，提升检索/生成贴合度）。 */
  queryHint?: string;
}

/**
 * stepId → 槽位规格。键使用 STEP_IDS 的字符串值（见 pipeline/modes.ts）。
 * 未列出的 step 不消费算子。
 */
export const OPERATOR_SLOT_REGISTRY: Readonly<Record<string, StepSlotSpec>> = {
  // ── RPG / 层级树管线 ──
  worldview: { slots: ["风格算子"], kag: false, ledger: true, queryHint: "世界观构建" },
  character_enrichment: { slots: ["风格算子", "情感算子"], kag: true, ledger: true, queryHint: "角色塑造与弧光" },
  // 道具/器物属世界观三部分之一（§4.2c）：受 IP 风格约束 + 与角色/阵营的持有关系（KAG）+ 账本一致性。
  item_database: { slots: ["风格算子"], kag: true, ledger: true, queryHint: "关键道具/器物与持有关系" },
  story_framework: { slots: ["结构算子", "风格算子"], kag: true, ledger: true, queryHint: "整体剧情框架与节奏" },
  outline_batch: { slots: ["结构算子", "情节算子"], kag: true, ledger: true, queryHint: "大纲层情节编排" },
  detailed_outline: { slots: ["情节算子", "结构算子"], kag: true, ledger: true, queryHint: "细纲层事件因果" },
  plot_generation: { slots: ["情节算子", "情感算子", "风格算子"], kag: true, ledger: true, queryHint: "情节展开与转折" },
  script_generation: { slots: ["对白算子", "情感算子", "风格算子"], kag: true, ledger: true, queryHint: "剧本台词与潜台词" },
  scene_generation: { slots: ["风格算子", "情节算子"], kag: true, ledger: true, queryHint: "场景刻画" },
  script_scene_generation: { slots: ["对白算子", "风格算子"], kag: true, ledger: true, queryHint: "剧本场景与台词" },
  quest_generation: { slots: ["结构算子", "情节算子"], kag: true, ledger: true, queryHint: "任务编排" },
  lore_generation: { slots: ["风格算子"], kag: false, ledger: true, queryHint: "世界设定与背景" },
  narrative_card: { slots: ["风格算子", "情感算子"], kag: false, ledger: true, queryHint: "叙事卡片表达" },

  // ── VN / 互动影游管线 ──
  vn_outline_acts: { slots: ["结构算子", "风格算子"], kag: true, ledger: true, queryHint: "幕结构与戏剧节拍" },
  vn_scenes: { slots: ["结构算子", "情节算子"], kag: true, ledger: true, queryHint: "场搭建" },
  vn_beats: { slots: ["情节算子", "情感算子"], kag: true, ledger: true, queryHint: "情节点节奏" },
  vn_branched_beats: { slots: ["情节算子", "结构算子"], kag: true, ledger: true, queryHint: "剧情树分支改造" },
  vn_screenplay: { slots: ["对白算子", "情感算子", "风格算子"], kag: true, ledger: true, queryHint: "影游剧本台词" },
  vn_storyboard: { slots: ["对白算子", "风格算子"], kag: true, ledger: true, queryHint: "分镜画面语言" },
};

/**
 * 取某 step 的槽位规格（单一事实源解析）：
 *   ① 优先 AgentDef.io.consumesIpDna（声明式契约，T1）；
 *   ② 回退 OPERATOR_SLOT_REGISTRY（默认提供器）。
 * 二者皆无 → undefined（该 step 不消费算子）。
 */
export function getSlotSpec(stepId: string): StepSlotSpec | undefined {
  const declared = getAgentDef(stepId)?.io.consumesIpDna;
  if (declared) return declared;
  return OPERATOR_SLOT_REGISTRY[stepId];
}

/** 是否为消费算子的 step（声明式优先，registry 兜底）。 */
export function isOperatorConsumingStep(stepId: string): boolean {
  return getSlotSpec(stepId) !== undefined;
}
