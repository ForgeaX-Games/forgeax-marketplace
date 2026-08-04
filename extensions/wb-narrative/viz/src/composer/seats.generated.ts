/**
 * 由 scripts/gen-seats.ts 从 src/pipeline/assistant-seats.ts 生成——请勿手改。
 * 改席位请改后端注册表，然后跑 `npm run gen:seats`。
 */

export type SeatKind = "generator" | "validator" | "polisher" | "retriever";

export interface SeatBindingView {
  /** 管线模板 id 或运行模式 id；null = 通用兜底。 */
  scope: string | null;
  agentIds: string[];
}

export interface SeatView {
  id: string;
  featureId: string;
  name: string;
  kind: SeatKind;
  /** planned = 契约已立、后端实现待建：可拖可 @，不可单跑。 */
  status: "active" | "planned";
  /** 产物落到哪个内容类别（对应 lib/contentTypes.ts）。 */
  contentType: string | null;
  /** 该席位产物的文件名前缀，两库据此归类。 */
  filePrefixes: string[];
  bindings: SeatBindingView[];
}

export const ASSISTANT_SEATS: readonly SeatView[] = [
  {
    id: "req_list",
    featureId: "2.3.1",
    name: "需求清单助手",
    kind: "generator",
    status: "active",
    contentType: "requirement",
    filePrefixes: ["00_","01_","01a_","V4_","V5_"],
    bindings: [
      { scope: null, agentIds: ["preference_summary","preference_analysis"] },
      { scope: "tpl-vn-v2", agentIds: ["vn_script_normalize","vn_segment_confirm"] },
      { scope: "tpl-vn-v2", agentIds: [] },
    ],
  },
  {
    id: "design_doc",
    featureId: "2.3.2",
    name: "策划文档助手",
    kind: "generator",
    status: "active",
    contentType: "design-doc",
    filePrefixes: ["02_","D0_","D1_","D2_","D3_","D4_","D4a_","V0_"],
    bindings: [
      { scope: null, agentIds: ["initial_plan"] },
      { scope: "tpl-vn-v2", agentIds: ["vn_logline"] },
      { scope: "design_auto", agentIds: ["core_concept","system_architecture","system_detail","value_framework","design_doc"] },
    ],
  },
  {
    id: "worldview",
    featureId: "2.3.3",
    name: "世界观设定助手",
    kind: "generator",
    status: "active",
    contentType: "worldview",
    filePrefixes: ["04_"],
    bindings: [
      { scope: null, agentIds: ["worldview"] },
    ],
  },
  {
    id: "character",
    featureId: "2.3.4",
    name: "角色档案助手",
    kind: "generator",
    status: "active",
    contentType: "character",
    filePrefixes: ["09_","V1a_"],
    bindings: [
      { scope: null, agentIds: ["character_enrichment"] },
      { scope: "tpl-vn-v2", agentIds: [] },
    ],
  },
  {
    id: "item",
    featureId: "2.3.5",
    name: "道具清单助手",
    kind: "generator",
    status: "active",
    contentType: "item",
    filePrefixes: ["10_","15a_","V1b_"],
    bindings: [
      { scope: null, agentIds: ["item_database"] },
      { scope: "tpl-vn-v2", agentIds: [] },
    ],
  },
  {
    id: "scene_list",
    featureId: "2.3.6",
    name: "场景列表助手",
    kind: "generator",
    status: "active",
    contentType: "scene",
    filePrefixes: ["14_","B3_","V2_"],
    bindings: [
      { scope: null, agentIds: ["scene_generation"] },
      { scope: "tpl-open-world", agentIds: ["region_design"] },
      { scope: "tpl-vn-v2", agentIds: [] },
    ],
  },
  {
    id: "outline",
    featureId: "2.3.7",
    name: "故事大纲助手",
    kind: "generator",
    status: "active",
    contentType: "outline",
    filePrefixes: ["06_","V1_"],
    bindings: [
      { scope: null, agentIds: ["story_framework"] },
      { scope: "tpl-vn-v2", agentIds: ["vn_outline_acts"] },
    ],
  },
  {
    id: "structure",
    featureId: "2.3.8",
    name: "故事结构助手",
    kind: "generator",
    status: "active",
    contentType: "structure",
    filePrefixes: ["07_","08_","B0_","V3_","V6_","V6a_"],
    bindings: [
      { scope: null, agentIds: ["outline_batch","detailed_outline"] },
      { scope: "tpl-vn-v2", agentIds: ["vn_beats","vn_branched_beats","vn_state_ledger"] },
      { scope: "tpl-vn", agentIds: ["branch_tree"] },
    ],
  },
  {
    id: "plot",
    featureId: "2.3.9",
    name: "故事情节助手",
    kind: "generator",
    status: "active",
    contentType: "plot",
    filePrefixes: ["11_","B1_","B4_","B6_","V7_"],
    bindings: [
      { scope: null, agentIds: ["plot_generation"] },
      { scope: "tpl-vn-v2", agentIds: ["vn_screenplay"] },
      { scope: "tpl-vn", agentIds: ["dialogue_script"] },
      { scope: "tpl-emergent", agentIds: ["emergent_event"] },
      { scope: "tpl-card-game", agentIds: ["event_pool"] },
    ],
  },
  {
    id: "quest",
    featureId: "2.3.10",
    name: "任务助手",
    kind: "generator",
    status: "active",
    contentType: "quest",
    filePrefixes: ["13_"],
    bindings: [
      { scope: null, agentIds: ["quest_generation"] },
    ],
  },
  {
    id: "storyboard",
    featureId: "2.3.11",
    name: "分镜助手",
    kind: "generator",
    status: "active",
    contentType: "storyboard",
    filePrefixes: ["12_","B2_","V8_","V9_"],
    bindings: [
      { scope: null, agentIds: ["script_generation"] },
      { scope: "tpl-vn-v2", agentIds: ["vn_storyboard"] },
      { scope: "tpl-vn", agentIds: ["cinematic_storyboard"] },
    ],
  },
  {
    id: "narrative_card",
    featureId: "2.3.12",
    name: "叙事卡助手",
    kind: "generator",
    status: "active",
    contentType: "narrative-card",
    filePrefixes: ["17_"],
    bindings: [
      { scope: null, agentIds: ["narrative_card"] },
    ],
  },
  {
    id: "codex",
    featureId: "2.3.13",
    name: "设定集助手",
    kind: "generator",
    status: "active",
    contentType: "codex",
    filePrefixes: ["15_","B5_"],
    bindings: [
      { scope: null, agentIds: ["lore_generation"] },
      { scope: "tpl-card-game", agentIds: ["card_lore"] },
    ],
  },
  {
    id: "structure_check",
    featureId: "2.3.14",
    name: "结构检查助手",
    kind: "validator",
    status: "active",
    contentType: "structure-check",
    filePrefixes: ["07a_","08a_","11a_"],
    bindings: [
      { scope: null, agentIds: ["structure_check"] },
      { scope: "tpl-vn-v2", agentIds: ["vn_structure_check"] },
    ],
  },
  {
    id: "content_check",
    featureId: "2.3.15",
    name: "内容检查助手",
    kind: "validator",
    status: "planned",
    contentType: "content-check",
    filePrefixes: [],
    bindings: [],
  },
  {
    id: "deai",
    featureId: "2.3.16",
    name: "去 AI 味助手",
    kind: "polisher",
    status: "planned",
    contentType: "deai",
    filePrefixes: [],
    bindings: [],
  },
  {
    id: "plot_refine",
    featureId: "2.3.17",
    name: "情节优化助手",
    kind: "polisher",
    status: "planned",
    contentType: "plot-refine",
    filePrefixes: [],
    bindings: [],
  },
  {
    id: "plot_polish",
    featureId: "2.3.18",
    name: "情节润色助手",
    kind: "polisher",
    status: "planned",
    contentType: "plot-polish",
    filePrefixes: [],
    bindings: [],
  },
  {
    id: "playability",
    featureId: "2.3.19",
    name: "玩法适配助手",
    kind: "polisher",
    status: "planned",
    contentType: "playability",
    filePrefixes: [],
    bindings: [],
  },
  {
    id: "encyclopedia",
    featureId: "2.3.20",
    name: "百科娘",
    kind: "retriever",
    status: "planned",
    contentType: "encyclopedia",
    filePrefixes: [],
    bindings: [],
  },
];

const INDEX = new Map(ASSISTANT_SEATS.map((s) => [s.id, s]));

export function getSeat(id: string): SeatView | undefined {
  return INDEX.get(id);
}

/** 该席位在指定作用域下要跑的 agent 序列；无绑定返回空数组。 */
export function resolveSeatAgents(id: string, scope?: string | null): string[] {
  const seat = INDEX.get(id);
  if (!seat) return [];
  if (scope) {
    const exact = seat.bindings.find((b) => b.scope === scope);
    if (exact) return [...exact.agentIds];
  }
  const generic = seat.bindings.find((b) => b.scope === null);
  return generic ? [...generic.agentIds] : [];
}

/** 席位的代表步骤：通用绑定的第一步，用于单节点试跑。 */
export function seatPrimaryStep(id: string): string | undefined {
  return resolveSeatAgents(id)[0];
}
