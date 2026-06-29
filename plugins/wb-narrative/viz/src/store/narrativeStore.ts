import { create } from "zustand";
import type {
  TierId,
  ModeId,
  PipelineProgress,
  NarrativeContext,
  StepStatus,
  TierModeInfo,
} from "../types";
import { PIPELINE_STEPS } from "../types";
import { sendToHost } from "../lib/bridge";
import type { EntryStatus, DraftState } from "../utils/stepDisplay";

export type ViewMode = "text" | "graph";

export interface EditDraft {
  content?: unknown;
  userInput?: string;
  editing?: boolean;
  saved?: boolean;
}

export interface StepState {
  id: string;
  label: string;
  status: StepStatus;
  message?: string;
  data?: unknown;
}

/**
 * Run lifecycle modes — 决定 pipeline_steps_announce 帧的渲染策略：
 *  - "start"  / "resume"：渐进式渲染（节点按 step_start/step_done 增量出现）
 *                         announce 帧只缓存 pipelineOrder（备总步数/导航用），不预填节点
 *  - "fork"           ：预填全量节点（已完成 + 受影响），便于用户一眼看出"哪些保留 / 哪些重跑"
 */
export type RunMode = "start" | "resume" | "fork" | null;

/**
 * Phase 2: 当前查看 entry 的"启动管线快照"。
 * 来自 `/api/narrative/history/:key/load` 返回的字段（Phase 1 后端补齐）。
 *
 * 用途：让 INPUT 文本框 / ROUTING 品类 chip / 复杂度选项 / PIPELINE STATUS 节点序
 * 全部以 store 为唯一权威源，避免散落在 TierModeSelector 本地 useState 时
 * 切 entry 易漏恢复（§4.② §4.③ 直接根因 V8 / V9）。
 *
 * 字段全部可选 —— 旧 entry 缺字段时 fallback 到本地 useState（双写过渡期）。
 */
export interface ActiveConfig {
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  tier?: TierId | null;
  mode?: ModeId | null;
  complexity?: number;
  genreCode?: string | null;
  /** Phase 1 持久化的"权威步骤序"，给 PipelineStatus 在非 running 时也能展示完整管线 */
  pipelineOrder?: string[];
  routingMode?: "auto" | "semi" | "manual";
  /**
   * 外部挂载（narrative:attach-run，由 Kotone 启动管线触发）时打的时间戳令牌。
   * 仅用于触发 TierModeSelector 把 tier/mode/genre/userInput 回填到本地选择器；
   * 手动启动/编辑流程从不设置它，故不会干扰用户正在进行的编辑。
   */
  hydrateToken?: number;
}

interface NarrativeState {
  // ---- Active branch (currently viewed entry) ----
  activeEntryKey: string | null;
  activeEntryStatus: EntryStatus;
  activeSteps: StepState[];
  activeResult: NarrativeContext | null;
  /** Phase 2: 当前查看 entry 的启动管线快照（用于 UI 恢复 INPUT/ROUTING/PIPELINE STATUS） */
  activeConfig: ActiveConfig | null;

  // ---- Running context (background pipeline) ----
  runningEntryKey: string | null;
  runningRunId: string | null;
  runningProgress: StepState[];
  /** 后端 announce 帧下发的完整管线步骤序列；用于已知总步数但未渲染节点时的进度指示 */
  pipelineOrder: string[];
  /** 当前运行采用哪种渲染策略（决定 announce 帧是否预填节点） */
  runMode: RunMode;
  /**
   * IP 半自动预览运行轨（§5.1）。与 runningRunId 解耦的独立旁路：
   * IP 处理走 job 轮询而非 SSE，故不能复用 runningRunId（否则 useNarrativeStream 会对
   * 不存在的 /stream/:id 开 EventSource 触发 404 重连风暴，并撞 handleStart 并发守卫）。
   * 非空时，中间预览（useOrderedSteps / TextViewPanel / NarrativeCanvas）把当前 entry 视为
   * "运行中"，读取 runningProgress + pipelineOrder，使 IP 各步带 data 实时投影到文本/节点模式。
   */
  ipPreviewRunId: string | null;

  // ---- Local drafts (bound to activeEntry) ----
  editDrafts: Record<string, EditDraft>;

  // ---- Config ----
  tier: TierId | null;
  mode: ModeId | null;
  autoDetect: boolean;
  availableModes: TierModeInfo[];

  // ---- UI state ----
  viewMode: ViewMode;
  focusedStepId: string | null;
  focusedChildNodeId: string | null;
  expandedStepId: string | null;
  collapsedGraphIds: string[];
  /** STEP2 预演链路：左栏算好的"待生成"步骤序，写入 store 供右栏 PIPELINE STATUS 跨 iframe 读取（fresh-config 预览）。 */
  previewOrder: string[] | null;
  /** 当前预演是否为"自动"模式（planning + auto tier）；右栏据此显示"由 LLM 判定"提示。 */
  previewIsAuto: boolean;

  streamingChunks: Record<string, string>;
  streamPlayedSteps: string[];
  runStartedAt: number;
  liveCompletedSteps: string[];
  animatingStepId: string | null;
  animPlayedNodes: string[];

  // ---- Actions: config ----
  setConfig: (tier: TierId | null, mode: ModeId | null, autoDetect: boolean) => void;
  setAvailableModes: (modes: TierModeInfo[]) => void;

  // ---- Actions: run lifecycle ----
  startNewRun: (runId: string, entryKey: string, tier?: TierId, mode?: ModeId) => void;
  startFork: (runId: string, newEntryKey: string, sourceEntryKey: string, tier?: TierId, mode?: ModeId, preloadSteps?: StepState[]) => void;
  startResume: (runId: string, entryKey: string, tier?: TierId, mode?: ModeId) => void;
  /**
   * 启动 IP 半自动预览运行轨（§5.1）。order = IP 前驱步骤序（ip_input…ip_dna_extract，
   * 可含 ip_decompose），seed 为 pending 节点。之后 pushProgress 把各步推成 running/completed
   * 并携带可读正文 data，文本/节点模式据此同源渲染。
   */
  startIpPreviewRun: (runId: string, entryKey: string, order: string[]) => void;
  /** IP 预览结束（完成/失败）：清旁路，固化 pipelineOrder 到 activeConfig 以保持非运行态有序。 */
  finishIpPreview: (status?: "completed" | "interrupted") => void;
  pushProgress: (p: PipelineProgress) => void;
  completeRun: (result: NarrativeContext, newEntryKey?: string) => void;
  failRun: (error: string) => void;
  /** Update the running entry's key (e.g., when backend reveals the real directory name) */
  updateRunningEntryKey: (newKey: string) => void;
  cancelRun: () => void;

  // ---- Actions: branch switching ----
  loadEntry: (opts: {
    entryKey: string;
    tier: TierId | null;
    mode: ModeId | null;
    result: NarrativeContext;
    status?: string;
    steps?: StepState[];
    /**
     * Phase 2: entry 的启动管线快照。来自 /history/:key/load。
     * 缺失字段（旧 entry）时不会清掉，让 TierModeSelector 的本地 fallback 兜底。
     */
    config?: ActiveConfig;
  }) => void;
  /** Phase 2: 单独更新 activeConfig 部分字段（保留双写过渡期手动打补丁的能力）。 */
  setActiveConfig: (patch: Partial<ActiveConfig> | null) => void;

  /**
   * 退出 viewing-history，进入 fresh-config 态。
   *
   * 语义：历史条目（HISTORY）= 书签 / 配置（INPUT/ROUTING）= 因 / 管线（PIPELINE STATUS）= 果。
   * 三者一一对应但解耦。本 action 用于把 entry 书签解除，让 PIPELINE STATUS 不再展示
   * 历史快照而是基于当前配置的预览。
   *
   * 触发场景：
   *   1) 用户在 history 里再次点击当前选中的 entry（"再点取消选中"）
   *   2) 用户改了 INPUT/ROUTING 配置（自动解除 viewing 锁定）
   *
   * 清空：activeEntryKey/activeEntryStatus/activeSteps/activeResult/activeConfig
   *       editDrafts（draft 是 entry 维度的，离开 entry 自动失效）
   *       focusedStepId/expandedStepId/collapsedGraphIds（UI 局部状态）
   *       streamingChunks/streamPlayedSteps/animatingStepId（动画/流式状态）
   * 保留：tier/mode/userInput 等 UI 配置（用户可在 fresh 态继续编辑）
   *       runningRunId/runningEntryKey/runningProgress（独立 lane，SSE 仍在跑）
   *       pipelineOrder（仅当还有 running 时有意义；否则 PipelineStatus 会忽略它）
   */
  clearActiveEntry: () => void;

  // ---- Actions: drafts ----
  setEditDraft: (key: string, draft: Partial<EditDraft>) => void;
  clearEditDraft: (key: string) => void;
  clearAllDrafts: () => void;

  // ---- Actions: UI ----
  setViewMode: (mode: ViewMode) => void;
  /** STEP2 路由变化时，左栏把算好的预演链路推进 store（BroadcastChannel 同步给右栏 PIPELINE STATUS）。 */
  setPreviewOrder: (order: string[] | null, isAuto?: boolean) => void;
  setFocus: (stepId: string | null, childNodeId?: string | null) => void;
  appendStreamChunk: (stepId: string, chunk: string) => void;
  markStreamPlayed: (stepId: string) => void;
  markLiveCompleted: (stepId: string) => void;
  markAnimPlayed: (nodeId: string) => void;
  finishAnimation: (stepId?: string) => void;
  toggleGraphCollapse: (nodeId: string) => void;
  setCollapsedGraphIds: (ids: string[]) => void;

  reset: () => void;
  snapshot: () => string;
  restore: (json: string) => boolean;

  // ---- Derived helpers ----
  hasDrafts: () => boolean;
}

const STORAGE_KEY = "narrative-viz-snapshot";

const STEP_RESULT_MAP: Array<{ id: string; label: string; key: keyof NarrativeContext }> = [
  { id: "core_concept", label: "D0 核心概念", key: "core_concept" },
  { id: "system_architecture", label: "D1 系统架构", key: "system_architecture" },
  { id: "system_detail", label: "D2 玩法设计", key: "system_details" },
  { id: "value_framework", label: "D3 数值框架", key: "value_framework" },
  { id: "design_doc", label: "D4 策划案整合", key: "game_design_context" },
  { id: "preference_summary", label: "偏好总结", key: "user_preference_summary" },
  { id: "preference_analysis", label: "偏好分析", key: "user_preference_analysis" },
  // 合并步骤：用 initial_story_outline 作为存在性探针，rebuildStepsFromResult 会
  // 把它当作单个 initial_plan 节点恢复（label = "初步方案"）。data 字段在前端
  // 渲染时通过 result.initial_story_outline / core_settings / plot_synopsis 自取。
  { id: "initial_plan", label: "初步方案", key: "initial_story_outline" },
  { id: "worldview", label: "世界观构建", key: "worldview_structure" },
  { id: "story_framework", label: "故事框架", key: "story_framework" },
  { id: "outline_batch", label: "故事大纲", key: "outlines_generated" },
  { id: "detailed_outline", label: "故事细纲", key: "detailed_outlines_generated" },
  { id: "character_enrichment", label: "角色档案", key: "detailed_character_sheets" },
  { id: "item_database", label: "道具清单", key: "item_database" },
  { id: "plot_generation", label: "情节节点", key: "plots_generated" },
  { id: "script_generation", label: "剧本生成", key: "jrpg_script" },
  { id: "quest_generation", label: "任务生成", key: "quest_graph" },
  { id: "scene_generation", label: "场景生成", key: "scene_map" },
  { id: "narrative_card", label: "叙事卡", key: "narrative_card" },
  { id: "lore_generation", label: "Lore碎片", key: "lore_fragments" },
  // B3 新模板步骤
  { id: "branch_tree", label: "分支树", key: "branch_tree" },
  { id: "dialogue_script", label: "对话脚本", key: "dialogue_script" },
  { id: "cinematic_storyboard", label: "影像分镜", key: "cinematic_storyboard" },
  { id: "region_design", label: "区域设计", key: "regions" },
  { id: "emergent_event", label: "涌现事件", key: "emergent_events" },
  { id: "card_lore", label: "卡牌Lore", key: "card_lore" },
  { id: "event_pool", label: "事件池", key: "event_pool" },
  // 互动影游 v2 专属管线（tpl-vn-v2）
  { id: "vn_logline", label: "E1-01 故事梗概", key: "vn_logline" },
  { id: "vn_outline_acts", label: "E1-02 三幕扩写", key: "vn_outline_acts" },
  { id: "vn_scenes", label: "E1-03 场搭建", key: "vn_scenes" },
  { id: "vn_beats", label: "E1-04 情节点", key: "vn_beats" },
  { id: "vn_script_normalize", label: "E2-01 剧本预处理", key: "vn_script_normalized" },
  { id: "vn_segment_confirm", label: "E2-02 文本段确认", key: "vn_segment_confirmed" },
  { id: "vn_branched_beats", label: "G-01 剧情树改造", key: "vn_branched_beats" },
  { id: "vn_screenplay", label: "G-02 剧本创作", key: "vn_screenplay" },
  { id: "vn_storyboard", label: "G-03 分镜设计", key: "vn_storyboard" },
];

/**
 * 老存档 / 旧 step ID → 当前 step ID 的迁移映射。
 * loadEntry / restore 时使用。
 *
 * INITIAL_PLAN 合并：原来三个独立步骤现在合并为 initial_plan，
 * 老存档加载时把这三个 ID 都迁移到 initial_plan，rebuildStepsFromResult
 * 再用存在性探针重建为单个节点。
 */
const STEP_ID_MIGRATION: Record<string, string> = {
  initial_story_outline: "initial_plan",
  initial_outline: "initial_plan",
  core_settings: "initial_plan",
  core_settings_extraction: "initial_plan",
  plot_synopsis: "initial_plan",
  worldview_construction: "worldview",
  detailed_outline_batch: "detailed_outline",
};

/**
 * 把任意（含老存档 / 合并前）step id 折叠到当前权威 id。
 * 所有"按 pipelineOrder 排序"的展示逻辑（节点模式 / 文本模式共用的 useOrderedSteps）
 * 都用它做归一，保证进度 id 必命中权威序，避免合并步骤（如 initial_plan）被当作
 * "序外节点"甩到最后一列。
 */
export function canonicalStepId(id: string): string {
  return STEP_ID_MIGRATION[id] ?? id;
}

/** 头部元节点（开场白），announce 整表替换时需保留，避免"出现又消失"。 */
const META_HEAD_IDS = ["tier_router", "pipeline_config"];

function rebuildStepsFromResult(result: NarrativeContext, existingSteps: StepState[]): StepState[] {
  const merged: StepState[] = [];
  const seen = new Set<string>();
  const mapEntryById = new Map(STEP_RESULT_MAP.map((e) => [e.id, e]));

  // Pass 1: 按 existingSteps 的传入顺序输出（权威序，来自 backend pipelineOrder/completedSteps），
  // 同时用 STEP_RESULT_MAP 把 ctx 里的 data 字段填进去。这样 vn entry 的步骤顺序不会被
  // 前端硬编码的 RPG-centric STEP_RESULT_MAP 顺序覆盖。
  for (const s of existingSteps) {
    if (seen.has(s.id)) continue;
    const entry = mapEntryById.get(s.id);
    const dataFromResult = entry ? result[entry.key] : undefined;
    if (dataFromResult != null) {
      merged.push({
        id: s.id,
        label: entry?.label ?? s.label,
        status: "completed",
        message: `${entry?.label ?? s.label} 完成`,
        data: dataFromResult,
      });
    } else {
      merged.push(s);
    }
    seen.add(s.id);
  }

  // Pass 2: STEP_RESULT_MAP 探测出的、但 existingSteps 里没有的 step
  // （场景：纯 result restore，没传 steps，需要从 ctx 探测出哪些 step 存在）。
  for (const entry of STEP_RESULT_MAP) {
    if (seen.has(entry.id)) continue;
    const data = result[entry.key];
    if (data == null) continue;
    merged.push({
      id: entry.id,
      label: entry.label,
      status: "completed",
      message: `${entry.label} 完成`,
      data,
    });
    seen.add(entry.id);
  }

  return merged;
}

/** 步骤 id → 展示标签（IP 预览轨 seed pending 节点时用）。 */
const STEP_LABEL_BY_ID = new Map(PIPELINE_STEPS.map((s) => [s.id, s.label]));

function buildStepState(p: PipelineProgress): StepState {
  return {
    id: p.stepId ?? p.stage,
    label: p.stage,
    status: p.status,
    message: p.message,
    data: p.data,
  };
}

function splitCompositeStep(
  p: PipelineProgress,
  steps: StepState[],
): StepState[] {
  const msg = p.message ?? "";
  const isScriptPhase = msg.includes("剧本");
  const isScenePhase = msg.includes("场景");

  if (p.status === "completed") {
    const data = p.data as Record<string, unknown> | undefined;
    const scriptData = data?.jrpg_script ?? data;
    const sceneData = data?.scene_map ?? data;
    return upsertStep(
      upsertStep(steps, {
        id: "script_generation",
        label: "L4 剧本生成",
        status: "completed",
        message: "L4 剧本生成 完成",
        data: scriptData,
      }),
      {
        id: "scene_generation",
        label: "场景生成",
        status: "completed",
        message: "场景生成 完成",
        data: sceneData,
      },
    );
  }

  let result = steps;
  if (isScriptPhase || !isScenePhase) {
    result = upsertStep(result, {
      id: "script_generation",
      label: "L4 剧本生成",
      status: "running",
      message: msg,
    });
    const existScene = result.find((s) => s.id === "scene_generation");
    if (!existScene) {
      result = upsertStep(result, {
        id: "scene_generation",
        label: "场景生成",
        status: "pending",
      });
    }
  }
  if (isScenePhase) {
    result = upsertStep(result, {
      id: "scene_generation",
      label: "场景生成",
      status: "running",
      message: msg,
    });
  }
  return result;
}

function upsertStep(steps: StepState[], step: StepState): StepState[] {
  const idx = steps.findIndex((s) => s.id === step.id);
  if (idx >= 0) {
    const copy = [...steps];
    copy[idx] = step;
    return copy;
  }
  return [...steps, step];
}

const VALIDATION_PARENT: Record<string, string> = {
  structure_validation_l1: "outline_batch",
  structure_validation_l2: "detailed_outline",
};

function mergeValidationIntoParent(
  p: PipelineProgress,
  steps: StepState[],
): StepState[] {
  const parentId = VALIDATION_PARENT[p.stepId ?? ""];
  if (!parentId) return steps;
  const idx = steps.findIndex((s) => s.id === parentId);
  if (idx < 0) return steps;
  const copy = [...steps];
  const parent = { ...copy[idx] };
  if (p.status === "running") {
    parent.message = p.message;
  } else if (p.status === "completed") {
    parent.message = `${parent.label} + 结构验证 完成`;
  }
  copy[idx] = parent;
  return copy;
}

function resolveEntryStatus(status: string | undefined): EntryStatus {
  if (status === "completed") return "completed";
  if (status === "running") return "running";
  if (status === "interrupted" || status === "failed") return "interrupted";
  return null;
}

export const useNarrativeStore = create<NarrativeState>((set, get) => ({
  // ---- Active branch ----
  activeEntryKey: null,
  activeEntryStatus: null,
  activeSteps: [],
  activeResult: null,
  activeConfig: null,

  // ---- Running context ----
  runningEntryKey: null,
  runningRunId: null,
  runningProgress: [],
  pipelineOrder: [],
  runMode: null,
  ipPreviewRunId: null,

  // ---- Drafts ----
  editDrafts: {},

  // ---- Config ----
  tier: null,
  mode: null,
  autoDetect: true,
  availableModes: [],

  // ---- UI state ----
  viewMode: "text",
  focusedStepId: null,
  focusedChildNodeId: null,
  expandedStepId: null,
  collapsedGraphIds: [],
  previewOrder: null,
  previewIsAuto: false,

  streamingChunks: {},
  streamPlayedSteps: [],
  runStartedAt: 0,
  liveCompletedSteps: [],
  animatingStepId: null,
  animPlayedNodes: [],

  // ---- Actions: config ----
  setConfig: (tier, mode, autoDetect) => set({ tier, mode, autoDetect }),
  setAvailableModes: (modes) => set({ availableModes: modes }),

  // ---- Actions: run lifecycle ----
  startNewRun: (runId, entryKey, tier, mode) =>
    set({
      activeEntryKey: entryKey,
      activeEntryStatus: "running",
      activeSteps: [],
      activeResult: null,
      runningEntryKey: entryKey,
      runningRunId: runId,
      ipPreviewRunId: null,
      runningProgress: [],
      pipelineOrder: [],
      runMode: "start",
      editDrafts: {},
      tier: tier ?? get().tier,
      mode: mode ?? get().mode,
      focusedStepId: null,
      focusedChildNodeId: null,
      expandedStepId: null,
      collapsedGraphIds: [],
      streamingChunks: {},
      streamPlayedSteps: [],
      runStartedAt: Date.now(),
      liveCompletedSteps: [],
      animatingStepId: null,
      animPlayedNodes: [],
    }),

  startFork: (runId, newEntryKey, _sourceEntryKey, tier, mode, preloadSteps) =>
    set({
      activeEntryKey: newEntryKey,
      activeEntryStatus: "running",
      activeSteps: preloadSteps ?? [],
      activeResult: null,
      runningEntryKey: newEntryKey,
      runningRunId: runId,
      ipPreviewRunId: null,
      // fork：preloadSteps 已含「已完成 + 受影响」全量，runningProgress 同步预填，
      // 这样 announce 帧到达前 UI 就能显示"哪些步骤会保留 / 哪些会重跑"。
      runningProgress: preloadSteps ?? [],
      pipelineOrder: preloadSteps?.map((s) => s.id) ?? [],
      runMode: "fork",
      editDrafts: {},
      tier: tier ?? get().tier,
      mode: mode ?? get().mode,
      streamingChunks: {},
      streamPlayedSteps: [],
      runStartedAt: Date.now(),
      liveCompletedSteps: preloadSteps?.filter((s) => s.status === "completed").map((s) => s.id) ?? [],
      animatingStepId: null,
      animPlayedNodes: [],
    }),

  startResume: (runId, entryKey, tier, mode) =>
    set({
      activeEntryKey: entryKey,
      activeEntryStatus: "running",
      runningEntryKey: entryKey,
      runningRunId: runId,
      // resume：只保留**真正已完成**的步骤；之前的 pending / running / failed 全部丢弃，
      // 这些状态由 backend 重发的 SSE 事件重新驱动，避免拖油手残留导致节点序乱
      // （旧实现 [...activeSteps] 会把上次失败时残留的 pending 节点塞进画布，
      //  叠加 SSE 时间序追加的新节点 → ui_copy 跑到 branch_tree 之前那种怪现象）。
      runningProgress: get().activeSteps.filter((s) => s.status === "completed"),
      pipelineOrder: [],
      runMode: "resume",
      streamingChunks: {},
      streamPlayedSteps: [],
      runStartedAt: Date.now(),
      liveCompletedSteps: get().activeSteps
        .filter((s) => s.status === "completed")
        .map((s) => s.id),
      animatingStepId: null,
      ipPreviewRunId: null,
    }),

  startIpPreviewRun: (runId, entryKey, order) =>
    set(() => {
      // seed 整条 IP 前驱链为 pending：画布立刻呈现完整链路，随各步 push 逐节点点亮（含边）。
      const seeded: StepState[] = order.map((id) => ({
        id,
        label: STEP_LABEL_BY_ID.get(id) ?? id,
        status: "pending" as StepStatus,
      }));
      return {
        activeEntryKey: entryKey,
        activeEntryStatus: "running",
        activeSteps: seeded,
        activeResult: null,
        activeConfig: null,
        runningEntryKey: entryKey,
        // runningRunId 故意保持 null：IP 走 job 轮询，不开 SSE，也不撞并发守卫。
        runningRunId: null,
        ipPreviewRunId: runId,
        runningProgress: seeded,
        pipelineOrder: order,
        runMode: "start",
        editDrafts: {},
        focusedStepId: null,
        focusedChildNodeId: null,
        expandedStepId: null,
        collapsedGraphIds: [],
        streamingChunks: {},
        streamPlayedSteps: [],
        runStartedAt: Date.now(),
        liveCompletedSteps: [],
        animatingStepId: null,
        animPlayedNodes: [],
      };
    }),

  finishIpPreview: (status = "completed") =>
    set((state) => {
      if (!state.ipPreviewRunId) return {};
      // 固化顺序到 activeConfig：非运行态 useOrderedSteps 用 activeConfig.pipelineOrder 保序。
      const finalized = state.runningProgress.map((s) =>
        status === "interrupted" && s.status === "running"
          ? { ...s, status: "failed" as StepStatus }
          : s,
      );
      return {
        ipPreviewRunId: null,
        runningEntryKey: null,
        runMode: null,
        activeEntryStatus: status === "interrupted" ? "interrupted" : "completed",
        activeSteps: finalized,
        runningProgress: finalized,
        activeConfig: { ...(state.activeConfig ?? {}), pipelineOrder: state.pipelineOrder },
      };
    }),

  pushProgress: (p) =>
    set((state) => {
      // pipeline_steps_announce — 三种 runMode 的渲染策略不同：
      //  - fork：announce 列表代表"完整管线全景"，预填全量节点（缺的补 pending），
      //          配合 startFork 已塞好的 preloadSteps 一起呈现"哪些保留 / 哪些重跑"。
      //  - start / resume：渐进式渲染，announce 帧只把序列存到 pipelineOrder（备总步数 / 进度条用），
      //                    runningProgress 不预填，等 step_start/step_done 增量加入节点。
      //  - null（极端兜底，正常不会发生）：按旧逻辑全量预填，避免节点丢失。
      if (p.type === "pipeline_steps_announce" && Array.isArray(p.steps) && p.steps.length > 0) {
        // 头部元节点保留：design_auto 第二帧 announce（D4 后重规划）只发
        // ["pipeline_config", ...]，会把首帧的 tier_router（品类识别）挤掉，导致
        // 该节点"出现又消失"。这里把上一帧已有、本帧缺失的头部元节点补回最前。
        let nextOrder = p.steps;
        const prevOrder = state.pipelineOrder;
        const missingHead = META_HEAD_IDS.filter(
          (id) => prevOrder.includes(id) && !nextOrder.includes(id),
        );
        if (missingHead.length > 0) {
          nextOrder = [...missingHead, ...nextOrder];
        }
        // IP 前驱链保序（§6 LIST 双模块）：下游生成管线 announce 时不应挤掉已展示的 ip_* 节点，
        // 把上一帧已有、本帧缺失的 ip_ 步骤补回最前（保持 输入→处理→生成 的视觉先后）。
        const missingIp = prevOrder.filter(
          (id) => id.startsWith("ip_") && !nextOrder.includes(id),
        );
        if (missingIp.length > 0) {
          nextOrder = [...missingIp, ...nextOrder];
        }
        const patch: Partial<NarrativeState> = { pipelineOrder: nextOrder };
        const isFork = state.runMode === "fork";
        const isLegacy = state.runMode === null;
        if (isFork || isLegacy) {
          const existingMap = new Map(state.runningProgress.map((s) => [s.id, s]));
          const announced: StepState[] = nextOrder.map((id) => existingMap.get(id) ?? {
            id,
            label: id,
            status: "pending" as const,
          });
          for (const s of state.runningProgress) {
            if (!nextOrder.includes(s.id)) announced.push(s);
          }
          patch.runningProgress = announced;
          if (state.activeEntryKey === state.runningEntryKey) {
            patch.activeSteps = announced;
          }
        }
        return patch;
      }

      const stepKey = p.stepId ?? p.stage;

      if (stepKey in VALIDATION_PARENT) {
        const progress = mergeValidationIntoParent(p, state.runningProgress);
        const patch: Partial<NarrativeState> = { runningProgress: progress };
        if (state.activeEntryKey === state.runningEntryKey) {
          patch.activeSteps = progress;
        }
        return patch;
      }

      let progress: StepState[];

      if (stepKey === "script_scene_generation") {
        progress = splitCompositeStep(p, state.runningProgress);
      } else {
        const updated = buildStepState(p);
        const existing = state.runningProgress.findIndex((s) => s.id === stepKey);
        if (existing >= 0) {
          progress = [...state.runningProgress];
          progress[existing] = updated;
        } else {
          progress = [...state.runningProgress, updated];
        }
      }

      const patch: Partial<NarrativeState> = { runningProgress: progress };

      // Sync active view when viewing the running entry
      if (state.activeEntryKey === state.runningEntryKey) {
        patch.activeSteps = progress;
      }

      // Auto-focus on newly running/completed steps
      if (p.status === "completed" && stepKey && !state.liveCompletedSteps.includes(stepKey)) {
        patch.liveCompletedSteps = [...state.liveCompletedSteps, stepKey];
        patch.animatingStepId = stepKey;
        patch.expandedStepId = stepKey;
        patch.focusedStepId = stepKey;
      }

      const activeId = stepKey === "script_scene_generation"
        ? ((p.message ?? "").includes("场景") ? "scene_generation" : "script_generation")
        : (p.status === "running" ? stepKey : undefined);

      if (activeId && !state.animatingStepId) {
        patch.focusedStepId = activeId;
        patch.expandedStepId = activeId;
      }

      return patch;
    }),

  completeRun: (result, newEntryKey) =>
    set((state) => {
      const isViewing = state.activeEntryKey === state.runningEntryKey;
      const resolvedKey = newEntryKey ?? state.runningEntryKey;
      const steps = rebuildStepsFromResult(result, state.runningProgress);
      // 把运行期的权威步骤序固化到 activeConfig，让"已完成视图"也按权威序展示
      // （否则会退回 rebuildStepsFromResult 的固定序，合并步骤如 initial_plan 会错位到末尾）。
      const persistedConfig: ActiveConfig | null =
        isViewing && state.pipelineOrder.length > 0
          ? { ...(state.activeConfig ?? {}), pipelineOrder: state.pipelineOrder }
          : state.activeConfig;
      return {
        runningProgress: steps,
        runningRunId: null,
        ipPreviewRunId: null,
        runningEntryKey: null,
        runMode: null,
        activeEntryKey: isViewing ? resolvedKey : state.activeEntryKey,
        activeSteps: isViewing ? steps : state.activeSteps,
        activeResult: isViewing ? result : state.activeResult,
        activeEntryStatus: isViewing ? "completed" : state.activeEntryStatus,
        activeConfig: persistedConfig,
      };
    }),

  failRun: (error) =>
    set((state) => {
      const isViewing = state.activeEntryKey === state.runningEntryKey;
      const finalProgress = state.runningProgress.map((s) =>
        s.status === "running" ? { ...s, status: "failed" as StepStatus } : s,
      );
      return {
        runningProgress: finalProgress,
        runningRunId: null,
        ipPreviewRunId: null,
        runningEntryKey: null,
        runMode: null,
        activeSteps: isViewing ? finalProgress : state.activeSteps,
        activeEntryStatus: isViewing ? "interrupted" : state.activeEntryStatus,
      };
    }),

  updateRunningEntryKey: (newKey) =>
    set((state) => {
      const wasViewing = state.activeEntryKey === state.runningEntryKey;
      return {
        runningEntryKey: newKey,
        activeEntryKey: wasViewing ? newKey : state.activeEntryKey,
      };
    }),

  cancelRun: () => {
    const state = get();
    if (state.runningRunId) {
      set({
        runningRunId: null,
        runningEntryKey: null,
        runMode: null,
        activeEntryStatus: state.activeEntryKey === state.runningEntryKey ? "interrupted" : state.activeEntryStatus,
      });
    }
  },

  // ---- Actions: branch switching ----
  loadEntry: (opts) => {
    const steps = (opts.steps ?? []).map((s) => {
      const migrated = STEP_ID_MIGRATION[s.id];
      if (migrated) {
        const pDef = PIPELINE_STEPS.find((p) => p.id === migrated);
        return { ...s, id: migrated, label: pDef?.label ?? s.label };
      }
      return s;
    });
    const rebuilt = opts.result ? rebuildStepsFromResult(opts.result, steps) : steps;
    const finalSteps = rebuilt.length > 0 ? rebuilt : steps;

    // pipelineOrder 仅描述「正在跑」的 run 的管线。
    // 切到其它历史 entry 时必须清掉，否则 vn run 的 announce 会把 rpg entry 的节点排乱。
    // 若加载的恰好就是当前 running entry（断回看运行视图），保留 pipelineOrder。
    const currentRunningKey = get().runningEntryKey;
    const keepPipelineOrder = opts.entryKey === currentRunningKey;

    // Phase 2: 同步把 entry 的启动管线快照写入 activeConfig，让 INPUT/ROUTING/PIPELINE STATUS
    // 全部以 store 为权威源（TierModeSelector 通过 useEffect 监听做双写过渡）。
    // 注意：tier/mode 已显式传入，与 config 中的 tier/mode 保持一致；缺失字段保留为 undefined。
    const activeConfig: ActiveConfig | null = opts.config
      ? {
          ...opts.config,
          tier: opts.config.tier ?? opts.tier,
          mode: opts.config.mode ?? opts.mode,
        }
      : opts.tier || opts.mode
        ? { tier: opts.tier, mode: opts.mode }
        : null;

    set({
      activeEntryKey: opts.entryKey,
      activeEntryStatus: resolveEntryStatus(opts.status),
      activeSteps: finalSteps,
      activeResult: opts.result,
      activeConfig,
      tier: opts.tier,
      mode: opts.mode,
      editDrafts: {},
      focusedStepId: null,
      focusedChildNodeId: null,
      expandedStepId: null,
      collapsedGraphIds: [],
      streamingChunks: {},
      streamPlayedSteps: [],
      animatingStepId: null,
      // 切到其它 entry 时清 IP 预览旁路，避免历史条目被误判为"运行中"。
      ...(opts.entryKey === currentRunningKey ? {} : { ipPreviewRunId: null }),
      ...(keepPipelineOrder ? {} : { pipelineOrder: [] as string[] }),
    });
  },

  setActiveConfig: (patch) =>
    set((state) => ({
      activeConfig: patch == null ? null : { ...(state.activeConfig ?? {}), ...patch },
    })),

  clearActiveEntry: () =>
    set({
      activeEntryKey: null,
      activeEntryStatus: null,
      activeSteps: [],
      activeResult: null,
      activeConfig: null,
      editDrafts: {},
      focusedStepId: null,
      focusedChildNodeId: null,
      expandedStepId: null,
      collapsedGraphIds: [],
      streamingChunks: {},
      streamPlayedSteps: [],
      animatingStepId: null,
    }),

  // ---- Actions: drafts ----
  setEditDraft: (key, draft) =>
    set((state) => ({
      editDrafts: {
        ...state.editDrafts,
        [key]: { ...state.editDrafts[key], ...draft },
      },
    })),

  clearEditDraft: (key) =>
    set((state) => {
      const drafts = { ...state.editDrafts };
      delete drafts[key];
      return { editDrafts: drafts };
    }),

  clearAllDrafts: () => set({ editDrafts: {} }),

  // ---- Actions: UI ----
  setViewMode: (mode) => set({ viewMode: mode }),

  setPreviewOrder: (order, isAuto = false) =>
    set((s) =>
      s.previewIsAuto === isAuto &&
      JSON.stringify(s.previewOrder) === JSON.stringify(order)
        ? s
        : { previewOrder: order, previewIsAuto: isAuto },
    ),

  setFocus: (stepId, childNodeId) => {
    const state = get();
    const collapsed = [...state.collapsedGraphIds];

    if (stepId && state.focusedStepId && state.focusedStepId !== stepId) {
      if (!collapsed.includes(state.focusedStepId)) {
        collapsed.push(state.focusedStepId);
      }
    }
    if (stepId) {
      const idx = collapsed.indexOf(stepId);
      if (idx >= 0) collapsed.splice(idx, 1);
    }

    const patch: Partial<NarrativeState> = {
      focusedStepId: stepId,
      focusedChildNodeId: childNodeId ?? null,
      expandedStepId: stepId,
      collapsedGraphIds: collapsed,
    };

    if (state.animatingStepId && state.animatingStepId !== stepId) {
      patch.animatingStepId = null;
      if (!state.streamPlayedSteps.includes(state.animatingStepId)) {
        patch.streamPlayedSteps = [...state.streamPlayedSteps, state.animatingStepId];
      }
    }

    set(patch);
  },

  appendStreamChunk: (stepId, text) =>
    set((state) => ({
      streamingChunks: {
        ...state.streamingChunks,
        [stepId]: text,
      },
    })),

  markStreamPlayed: (stepId) =>
    set((state) => ({
      streamPlayedSteps: state.streamPlayedSteps.includes(stepId)
        ? state.streamPlayedSteps
        : [...state.streamPlayedSteps, stepId],
    })),

  markLiveCompleted: (stepId) =>
    set((state) => ({
      liveCompletedSteps: state.liveCompletedSteps.includes(stepId)
        ? state.liveCompletedSteps
        : [...state.liveCompletedSteps, stepId],
    })),

  finishAnimation: (stepId) =>
    set((state) => {
      const target = stepId ?? state.animatingStepId;
      if (!target) return {};
      const played = state.streamPlayedSteps.includes(target)
        ? state.streamPlayedSteps
        : [...state.streamPlayedSteps, target];
      const patch: Partial<NarrativeState> = {
        animatingStepId: null,
        streamPlayedSteps: played,
      };
      const runningStepId = state.runningProgress.find((s) => s.status === "running")?.id;
      if (state.runningRunId && runningStepId && runningStepId !== target) {
        patch.expandedStepId = runningStepId;
        patch.focusedStepId = runningStepId;
      }
      return patch;
    }),

  markAnimPlayed: (nodeId) =>
    set((state) => ({
      animPlayedNodes: state.animPlayedNodes.includes(nodeId)
        ? state.animPlayedNodes
        : [...state.animPlayedNodes, nodeId],
    })),

  toggleGraphCollapse: (nodeId) =>
    set((state) => {
      const ids = [...state.collapsedGraphIds];
      const idx = ids.indexOf(nodeId);
      if (idx >= 0) ids.splice(idx, 1);
      else ids.push(nodeId);
      return { collapsedGraphIds: ids };
    }),

  setCollapsedGraphIds: (ids) => set({ collapsedGraphIds: ids }),

  reset: () =>
    set({
      activeEntryKey: null,
      activeEntryStatus: null,
      activeSteps: [],
      activeResult: null,
      activeConfig: null,
      runningEntryKey: null,
      runningRunId: null,
      ipPreviewRunId: null,
      runningProgress: [],
      pipelineOrder: [],
      runMode: null,
      editDrafts: {},
      focusedStepId: null,
      focusedChildNodeId: null,
      expandedStepId: null,
      collapsedGraphIds: [],
      streamingChunks: {},
      streamPlayedSteps: [],
      animatingStepId: null,
      animPlayedNodes: [],
    }),

  snapshot: () => {
    const s = get();
    const data = {
      activeEntryKey: s.activeEntryKey,
      activeEntryStatus: s.activeEntryStatus,
      activeSteps: s.activeSteps,
      activeResult: s.activeResult,
      activeConfig: s.activeConfig,
      runningEntryKey: s.runningEntryKey,
      runningRunId: s.runningRunId,
      tier: s.tier,
      mode: s.mode,
      viewMode: s.viewMode,
      editDrafts: s.editDrafts,
    };
    const json = JSON.stringify(data);
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch { /* quota exceeded */ }
    return json;
  },

  restore: (json: string) => {
    try {
      const data = JSON.parse(json);
      const steps: StepState[] = (data.activeSteps ?? data.steps ?? []).map((s: StepState) => {
        const migrated = STEP_ID_MIGRATION[s.id];
        if (migrated) {
          const pDef = PIPELINE_STEPS.find((p) => p.id === migrated);
          return { ...s, id: migrated, label: pDef?.label ?? s.label };
        }
        return s;
      });

      const result = data.activeResult ?? data.result ?? null;
      const rebuilt = result ? rebuildStepsFromResult(result, steps) : steps;
      const finalSteps = rebuilt.length > 0 ? rebuilt : steps;

      set({
        activeEntryKey: data.activeEntryKey ?? data.sourceDir ?? null,
        activeEntryStatus: data.activeEntryStatus ?? resolveEntryStatus(data.status),
        activeSteps: finalSteps,
        activeResult: result,
        activeConfig: data.activeConfig ?? null,
        runningEntryKey: data.runningEntryKey ?? null,
        runningRunId: data.runningRunId ?? null,
        tier: data.tier ?? null,
        mode: data.mode ?? null,
        viewMode: data.viewMode ?? "text",
        editDrafts: data.editDrafts ?? {},
      });
      return true;
    } catch {
      return false;
    }
  },

  hasDrafts: () => {
    const drafts = get().editDrafts;
    return Object.values(drafts).some((d) => d.saved);
  },
}));

/** Attempt to restore from localStorage on load */
export function tryRestoreFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return useNarrativeStore.getState().restore(raw);
    }
  } catch { /* ignore */ }
  return false;
}

/* ================================================================
 * BroadcastChannel cross-iframe sync (split-surface embedding).
 *
 * When the viz app runs as two iframes (?pane=left + ?pane=center),
 * both have independent Zustand stores. This bridge keeps them in
 * sync by broadcasting a subset of state changes.
 *
 * Only the keys that matter for cross-pane coordination are synced;
 * transient animation / streaming state stays local.
 * ================================================================ */

const BC_CHANNEL_NAME = "forgeax-plugin.@forgeax-plugin/wb-narrative";

const SYNC_KEYS: Array<keyof NarrativeState> = [
  "activeEntryKey",
  "activeEntryStatus",
  "activeSteps",
  "activeResult",
  "activeConfig",
  "runningEntryKey",
  "runningRunId",
  "ipPreviewRunId",
  "runningProgress",
  "pipelineOrder",
  "previewOrder",
  "previewIsAuto",
  "runMode",
  "tier",
  "mode",
  "autoDetect",
  "viewMode",
  "focusedStepId",
  "focusedChildNodeId",
  "expandedStepId",
  "editDrafts",
];

let _bcSuppressIncoming = false;

try {
  const bc = new BroadcastChannel(BC_CHANNEL_NAME);

  useNarrativeStore.subscribe((state, prevState) => {
    if (_bcSuppressIncoming) return;
    const patch: Record<string, unknown> = {};
    let changed = false;
    for (const k of SYNC_KEYS) {
      if (state[k] !== prevState[k]) {
        patch[k] = state[k];
        changed = true;
      }
    }
    if (changed) {
      bc.postMessage({ t: "sync", patch });
    }
  });

  bc.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as { t?: string; patch?: Record<string, unknown> };
    if (msg?.t !== "sync" || !msg.patch) return;
    _bcSuppressIncoming = true;
    try {
      useNarrativeStore.setState(msg.patch as Partial<NarrativeState>);
    } finally {
      _bcSuppressIncoming = false;
    }
  };
} catch {
  /* BroadcastChannel unavailable (e.g. non-browser env) — skip */
}

/* ================================================================
 * Surface snapshot push for AI DUAL-MODALITY.
 *
 * Pushes two surface snapshots to the host via postMessage whenever
 * the relevant state keys change:
 *   - wb-narrative.control  (config + running state)
 *   - wb-narrative.pipeline (steps + results + drafts)
 *
 * This is additive to the BroadcastChannel sync above; it targets
 * the host window (not sibling iframes) so the SurfaceRegistry /
 * ToolRegistry can serve snapshots to AI via bus.query().
 * ================================================================ */

const CONTROL_KEYS: Array<keyof NarrativeState> = [
  "tier", "mode", "autoDetect",
  "runningRunId", "runningEntryKey",
  "activeEntryKey", "activeEntryStatus",
];

const PIPELINE_KEYS: Array<keyof NarrativeState> = [
  "activeSteps", "activeEntryKey", "activeEntryStatus",
  "pipelineOrder", "viewMode", "focusedStepId", "editDrafts",
];

useNarrativeStore.subscribe((state, prevState) => {
  let controlChanged = false;
  for (const k of CONTROL_KEYS) {
    if (state[k] !== prevState[k]) { controlChanged = true; break; }
  }
  if (controlChanged) {
    sendToHost({
      type: "narrative:surface-snapshot",
      payload: {
        surface: "wb-narrative.control",
        snapshot: {
          tier: state.tier,
          mode: state.mode,
          autoDetect: state.autoDetect,
          runningRunId: state.runningRunId,
          runningEntryKey: state.runningEntryKey,
          activeEntryKey: state.activeEntryKey,
          activeEntryStatus: state.activeEntryStatus,
        },
      },
    });
  }

  let pipelineChanged = false;
  for (const k of PIPELINE_KEYS) {
    if (state[k] !== prevState[k]) { pipelineChanged = true; break; }
  }
  if (pipelineChanged) {
    sendToHost({
      type: "narrative:surface-snapshot",
      payload: {
        surface: "wb-narrative.pipeline",
        snapshot: {
          steps: state.activeSteps,
          activeEntryKey: state.activeEntryKey,
          activeEntryStatus: state.activeEntryStatus,
          pipelineOrder: state.pipelineOrder,
          viewMode: state.viewMode,
          focusedStepId: state.focusedStepId,
          editDrafts: state.editDrafts,
        },
      },
    });
  }
});
