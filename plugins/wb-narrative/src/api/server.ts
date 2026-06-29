import express from "express";
import fs from "node:fs";
import path from "node:path";
import { NarrativePipeline } from "../pipeline/pipeline.js";
import type { RerunOptions } from "../pipeline/pipeline.js";
import { getModesForTier, TIER_DEFAULT_MODE, STEP_OUTPUT_FIELDS, getModeConfig } from "../pipeline/modes.js";
import { traceNodeSubtree, buildNodeFilter } from "../pipeline/node-dependency.js";
import { validateImpactAnalysis, type ChangeCategory } from "../pipeline/impact-validator.js";
import { buildAutoSteps } from "../pipeline/design-steps/auto-narrative-builder.js";
import { getGenresByCategory, GENRE_TAXONOMY, findGenreByCode } from "../knowledge/genre-taxonomy.js";
import { getNarrativeType } from "../knowledge/genre-narrative-type.js";
import { planPipeline } from "../pipeline/planner/index.js";
import { STEP_IDS as S } from "../pipeline/modes.js";
import { LLMClient } from "../pipeline/llm-client.js";
import { buildKnowledgePromptSection, buildNodeTreeSummary, preClassifyChange, PIPELINE_KNOWLEDGE } from "../pipeline/pipeline-knowledge.js";
import type { NarrativeContext, PipelineProgress, TierId, ModeId, PlotsGenerated, JrpgScript, SceneMap, QuestGraph, StepMeta, StepModification, StoryFramework, OutlinesGenerated, DetailedOutlinesGenerated, UploadedScript } from "../types/index.js";
import { detectScriptFormat, describeScriptFormat } from "../utils/script-format-detector.js";
import { runIpDnaPipeline, runIngest, runExtractAndGenerate, loadExtractSourceByRun, resolveIpDnaRuntimeAdapters, loadHierarchyIndexByRun, analyzeRewriteImpact, createJob, updateJob, getJob, listJobs, cancelJob, formatTimestamp as formatIpDnaTimestamp, buildAdaptationDirective, planDecomposition, applyDecompositionClosure, assessVolume, collectLeafIds, saveHierarchyIndexOnly, saveAdaptationConfirmation, loadAdaptationConfirmation, type IncomingFile, type IpDnaProgress, type ExtractSource } from "../ip-dna/index.js";
// Phase C6: env reads are funnelled through plugin-env so the literal
// `process.env.*_API_KEY` substring stays out of plugin source files. See
// utils/plugin-env.ts header for the full rationale (this Express server is
// a standalone-process bootstrap, scope-excluded from the ctx.env migration;
// ToolRegistry handlers must use ctx.env per the wb-character precedent).
import { getGeminiApiKey, getLlmProxyUrl, getLlmProxyKey, getDefaultModel, readPluginEnv } from "../utils/plugin-env.js";

const OUTPUT_DIR = path.resolve(process.cwd(), "output");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const STEP_FILE_MAP: Record<string, { index: string; name: string; ext: string }> = {
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

const STEP_CTX_KEY: Record<string, string> = {
  preference_summary:   "user_preference_summary",
  preference_analysis:  "user_preference_analysis",
  // 合并步骤 INITIAL_PLAN：ctx 中无 "initial_plan" 字段（仅三个子字段），
  // 用 initial_story_outline 作为存在性探针；落盘时由 saveStepIncremental
  // 默认分支接管（data 已是聚合对象，extractStepOutput 处理）
  initial_plan:         "initial_story_outline",
  // 老 ID 仅供存档编辑兼容（save-step-edit / restore-original 仍按老 ID 路由）
  initial_outline:      "initial_story_outline",
  core_settings:        "core_settings",
  worldview:            "worldview_structure",
  plot_synopsis:        "plot_synopsis",
  story_framework:      "story_framework",
  outline_batch:        "outlines_generated",
  detailed_outline:     "detailed_outlines_generated",
  character_enrichment: "detailed_character_sheets",
  item_database:        "item_database",
  plot_generation:      "plots_generated",
  script_generation:    "jrpg_script",
  quest_generation:     "quest_graph",
  scene_generation:     "scene_map",
  structure_validation_l1: "l1_validation",
  structure_validation_l2: "l2_validation",
  structure_validation_l3: "l3_validation",
  narrative_card:       "narrative_card",
  lore_generation:      "lore_fragments",
  // 路由与全局参数
  tier_detection:         "tier_detection",
  demand_analysis:        "demand_analysis",
  global_control_params:  "global_control_params",
  // 策划步骤 (D0-D4)
  core_concept:           "core_concept",
  system_architecture:    "system_architecture",
  system_detail:          "system_details",
  value_framework:        "value_framework",
  design_doc:             "game_design_context",
  narrative_requirements: "narrative_requirements",
  // 叙事步骤附属数据
  item_lore:              "item_lore",
  // B3 + Stage C：互动影游 / VN / 开放世界 / 卡牌
  // ctx 字段名与 STEP_OUTPUT_FIELDS 中定义的字段保持一致
  branch_tree:            "branch_tree",
  dialogue_script:        "dialogue_script",
  cinematic_storyboard:   "cinematic_storyboard",
  region_design:          "regions",
  emergent_event:         "emergent_events",
  card_lore:              "card_lore",
  event_pool:             "event_pool",
  // tpl-vn-v2 专属步骤
  vn_logline:             "vn_logline",
  vn_outline_acts:        "vn_outline_acts",
  vn_character_bios:      "vn_character_bios",
  vn_key_items:           "vn_key_items",
  vn_scenes:              "vn_scenes",
  vn_beats:               "vn_beats",
  vn_script_normalize:    "vn_script_normalized",
  vn_segment_confirm:     "vn_segment_confirmed",
  vn_branched_beats:      "vn_branched_beats",
  vn_state_ledger:        "world_state_ledger",
  vn_screenplay:          "vn_screenplay",
  vn_storyboard:          "vn_storyboard",
  vn_video_prompts:       "vn_video_prompts",
};

function formatTimestamp(iso: string): string {
  return iso.replace(/T/, "_").replace(/[:.]/g, "-").replace(/Z$/, "");
}

function getRunDir(state: RunState): string {
  if (state.outputDir) return state.outputDir;
  const ts = formatTimestamp(state.startedAt);
  return path.join(OUTPUT_DIR, ts);
}

function writeAssetFile(dir: string, name: string, data: unknown): void {
  if (data == null) return;
  const filepath = path.join(dir, name);
  const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filepath, content, "utf-8");
}

interface PerNodeEntry { id: string; content: unknown }

type PerNodeExtractor = (data: unknown) => PerNodeEntry[];

const PER_NODE_STEPS: Record<string, PerNodeExtractor> = {
  story_framework: (data) => {
    const sf = data as StoryFramework;
    if (!sf?.framework?.nodes) return [];
    return sf.framework.nodes.map(n => ({ id: n.node_id, content: n }));
  },
  outline_batch: (data) => {
    const og = data as OutlinesGenerated;
    if (!og?.outlines) return [];
    return og.outlines.map(n => ({ id: n.node_id, content: n }));
  },
  detailed_outline: (data) => {
    const dg = data as DetailedOutlinesGenerated;
    if (!dg?.detailed_outlines) return [];
    return dg.detailed_outlines.map(n => ({ id: n.node_id, content: n }));
  },
  script_scene_generation: (data) => {
    const composite = data as { jrpg_script?: unknown; scene_map?: unknown };
    const scriptNodes = composite.jrpg_script ? PER_NODE_STEPS.script_generation(composite.jrpg_script) : [];
    const sceneNodes = composite.scene_map ? PER_NODE_STEPS.scene_generation(composite.scene_map) : [];
    return [...scriptNodes, ...sceneNodes];
  },
  plot_generation: (data) => {
    const pg = data as PlotsGenerated;
    if (!pg?.plots) return [];
    return pg.plots.map(p => ({ id: p.node_id, content: p }));
  },
  script_generation: (data) => {
    const js = data as JrpgScript;
    if (!js?.chapters) return [];
    return js.chapters.map(ch => ({ id: ch.chapter_id ?? ch.plot_node_id, content: ch }));
  },
  quest_generation: (data) => {
    const qg = data as QuestGraph;
    if (!qg?.quests) return [];
    return qg.quests.map(q => ({ id: q.quest_id, content: q }));
  },
  scene_generation: (data) => {
    const sm = data as SceneMap;
    if (!sm?.scenes) return [];
    const entries: PerNodeEntry[] = [];
    if (sm._phase1_skeleton) {
      entries.push({ id: "世界观_场景骨架", content: { phase: "P1_skeleton", scenes: sm._phase1_skeleton } });
    }
    if (sm._phase2_per_node) {
      for (const [nodeId, scenes] of Object.entries(sm._phase2_per_node)) {
        entries.push({ id: `${nodeId}_场景`, content: { phase: "P2_expansion", node_id: nodeId, scenes } });
      }
    }
    if (sm._phase2_per_node_md) {
      for (const [nodeId, md] of Object.entries(sm._phase2_per_node_md)) {
        entries.push({ id: `${nodeId}_场景结构`, content: md });
      }
    }
    entries.push({ id: "合并_场景", content: { phase: "P3_merged", world_name: sm.world_name, scenes: sm.scenes } });
    if (sm._scene_structure_md) {
      entries.push({ id: "场景结构目录", content: sm._scene_structure_md });
    }
    return entries;
  },
  // B3 + Stage C：互动影游 / VN 节点级拆分（按 node_id 拆，便于 fork 视图打开单节点）
  branch_tree: (data) => {
    const bt = data as { nodes?: Array<{ id?: string; [k: string]: unknown }> } | undefined;
    if (!bt?.nodes?.length) return [];
    return bt.nodes
      .filter(n => typeof n.id === "string" && n.id.length > 0)
      .map(n => ({ id: n.id as string, content: n }));
  },
  dialogue_script: (data) => {
    const ds = data as { scripts?: Array<{ node_id?: string; [k: string]: unknown }> } | undefined;
    if (!ds?.scripts?.length) return [];
    return ds.scripts
      .filter(s => typeof s.node_id === "string" && s.node_id.length > 0)
      .map(s => ({ id: s.node_id as string, content: s }));
  },
  cinematic_storyboard: (data) => {
    const cs = data as { storyboards?: Array<{ node_id?: string; [k: string]: unknown }> } | undefined;
    if (!cs?.storyboards?.length) return [];
    return cs.storyboards
      .filter(s => typeof s.node_id === "string" && s.node_id.length > 0)
      .map(s => ({ id: s.node_id as string, content: s }));
  },
};

function savePerNodeFiles(runDir: string, stepId: string, fileDef: { index: string; name: string }, data: unknown): void {
  const extractor = PER_NODE_STEPS[stepId];
  if (!extractor) return;
  try {
    const nodes = extractor(data);
    if (nodes.length === 0) return;
    const subDir = path.join(runDir, `${fileDef.index}_${fileDef.name}`);
    fs.mkdirSync(subDir, { recursive: true });
    for (const node of nodes) {
      const safeId = String(node.id).replace(/[/\\?%*:|"<>]/g, "_");
      const ext = typeof node.content === "string" ? "md" : "json";
      writeAssetFile(subDir, `${safeId}.${ext}`, node.content);
    }
  } catch (e) {
    console.error(`Failed to save per-node files for ${stepId}:`, e);
  }
}

function saveStepIncremental(state: RunState, stepId: string, data: unknown): void {
  if (stepId === "script_scene_generation" && data != null) {
    const composite = data as { jrpg_script?: unknown; scene_map?: unknown };
    if (composite.jrpg_script) {
      saveStepIncremental(state, "script_generation", composite.jrpg_script);
    }
    if (composite.scene_map) {
      saveStepIncremental(state, "scene_generation", composite.scene_map);
    }
    return;
  }

  if (stepId === "tier_router" && data != null) {
    const compound = data as { tier_detection?: unknown; demand_analysis?: unknown };
    if (compound.tier_detection) saveStepIncremental(state, "tier_detection", compound.tier_detection);
    if (compound.demand_analysis) saveStepIncremental(state, "demand_analysis", compound.demand_analysis);
    return;
  }

  const fileDef = STEP_FILE_MAP[stepId];
  if (!fileDef || data == null) return;
  try {
    const runDir = getRunDir(state);
    fs.mkdirSync(runDir, { recursive: true });
    const filename = `${fileDef.index}_${fileDef.name}.${fileDef.ext}`;
    writeAssetFile(runDir, filename, data);
    savePerNodeFiles(runDir, stepId, fileDef, data);
  } catch (e) {
    console.error(`Failed to save step ${stepId}:`, e);
  }
}

const STEP_COMPANIONS: Record<string, string[]> = {
  preference_analysis: ["global_control_params"],
  design_doc: ["narrative_requirements"],
  lore_generation: ["item_lore"],
  // E1-02 单步三输出：三幕扩写 + 人物小传 + 关键道具；后两者伴生落盘
  vn_outline_acts: ["vn_character_bios", "vn_key_items"],
  // E2 路径：vn_segment_confirm 覆写 outline_acts/scenes/beats/character_bios，
  // 主文件 V5_文本段确认.json 仅含 vn_segment_confirmed；伴生落盘其它四份，
  // 让 E2 路径下 G-01~G-03 消费的中间产物有可见的 V1/V1a/V2/V3 落盘文件。
  vn_segment_confirm: ["vn_outline_acts", "vn_character_bios", "vn_scenes", "vn_beats"],
  vn_storyboard: ["vn_video_prompts"],
};

/**
 * 从 ctx 中按 stepId 取出"该步骤产物文件应当包含的数据"。
 * - 普通步骤：直接取 STEP_CTX_KEY[stepId] 对应的 ctx 字段
 * - 合并步骤 INITIAL_PLAN：聚合三个子字段（outline/core_settings/plot_synopsis）
 *   成一个对象，与 pipeline.ts 的 extractStepOutput("initial_plan") 保持一致，
 *   保证 fork 拷贝 / saveRunToFile / export 三处都写出 1 个聚合 JSON 文件，
 *   而不是按 STEP_CTX_KEY 单字段取出 outline 一段。
 */
function getStepDataForFile(stepId: string, ctx: NarrativeContext): unknown {
  if (stepId === "initial_plan") {
    const ctxRaw = ctx as Record<string, unknown>;
    const outline = ctxRaw.initial_story_outline;
    const cs = ctxRaw.core_settings;
    const ps = ctxRaw.plot_synopsis;
    if (outline == null && cs == null && ps == null) return undefined;
    return { initial_story_outline: outline, core_settings: cs, plot_synopsis: ps };
  }
  const ctxKey = STEP_CTX_KEY[stepId];
  if (!ctxKey) return undefined;
  return (ctx as Record<string, unknown>)[ctxKey];
}

/**
 * 把"用户编辑的草稿内容"写回 ctx。与 getStepDataForFile 对称：
 * - 普通步骤：写到 STEP_CTX_KEY[stepId] 字段
 * - 合并步骤 INITIAL_PLAN：从聚合对象拆分写入三个子字段
 *   （直接 ctx[STEP_CTX_KEY[initial_plan]] = 聚合对象 会把整对象误当 outline，
 *    且 core_settings / plot_synopsis 永远不会被更新）
 */
function setStepCtxData(stepId: string, ctx: NarrativeContext, value: unknown): boolean {
  if (stepId === "initial_plan") {
    if (typeof value !== "object" || value == null) return false;
    const v = value as Record<string, unknown>;
    const ctxRaw = ctx as Record<string, unknown>;
    if (v.initial_story_outline != null) ctxRaw.initial_story_outline = v.initial_story_outline;
    if (v.core_settings != null)         ctxRaw.core_settings = v.core_settings;
    if (v.plot_synopsis != null)         ctxRaw.plot_synopsis = v.plot_synopsis;
    return true;
  }
  const ctxKey = STEP_CTX_KEY[stepId];
  if (!ctxKey) return false;
  (ctx as Record<string, unknown>)[ctxKey] = value;
  return true;
}

function saveCompanionData(state: RunState, stepId: string, ctx: NarrativeContext): void {
  const companions = STEP_COMPANIONS[stepId];
  if (!companions) return;
  for (const key of companions) {
    const ctxKey = STEP_CTX_KEY[key];
    const data = ctxKey ? (ctx as Record<string, unknown>)[ctxKey] : undefined;
    if (data != null) saveStepIncremental(state, key, data);
  }
}

function saveRunToFile(state: RunState) {
  const runDir = getRunDir(state);
  fs.mkdirSync(runDir, { recursive: true });

  const finalMeta = resolveCheckpointMeta(state, state.result);
  writeAssetFile(runDir, "full_result.json", {
    id: state.id,
    tier: state.tier,
    mode: state.mode,
    model: state.model,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    result: state.result,
    error: state.error,
    userInput: state.userInput,
    routeGroup: state.routeGroup,
    complexity: state.complexity,
    genre_code: finalMeta.genre_code,
    pipelineOrder: finalMeta.pipelineOrder,
    routingMode: finalMeta.routingMode,
  });

  if (state.status === "completed" && state.result) {
    const ctx = state.result;
    for (const [stepId, fileDef] of Object.entries(STEP_FILE_MAP)) {
      const data = getStepDataForFile(stepId, ctx);
      if (data != null) {
        const filename = `${fileDef.index}_${fileDef.name}.${fileDef.ext}`;
        writeAssetFile(runDir, filename, data);
        savePerNodeFiles(runDir, stepId, fileDef, data);
      }
    }
  }

  const savedFiles = fs.readdirSync(runDir).filter((f) => f !== "manifest.json");
  const finalManifest: Record<string, unknown> = {
    runId: state.id,
    tier: state.tier,
    mode: state.mode,
    model: state.model,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    files: savedFiles,
    userInput: state.userInput,
    routeGroup: state.routeGroup,
    complexity: state.complexity,
    completedSteps: state.completedSteps ?? [],
    genre_code: finalMeta.genre_code,
    pipelineOrder: finalMeta.pipelineOrder,
    routingMode: finalMeta.routingMode,
  };
  if (state.parentKey) finalManifest.parentKey = state.parentKey;
  if (state.forkReason) finalManifest.forkReason = state.forkReason;
  writeAssetFile(runDir, "manifest.json", finalManifest);

  console.log(`💾 Result saved: ${runDir} (${savedFiles.length} files)`);
  return runDir;
}

interface CheckpointData {
  runId: string;
  tier?: TierId;
  mode?: ModeId;
  startedAt: string;
  lastCompletedStep: string;
  completedSteps: string[];
  savedAt: string;
  ctx: NarrativeContext;
  step_meta?: Record<string, StepMeta>;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  model?: string;
  /**
   * Phase 1: 启动管线的完整参数与"权威步骤序"快照。
   * 让 resume / fork / 前端 loadEntry 能够在没有重跑 announce 的情况下
   * 还原出当时这一跑的真实管线（包括动态模式追加的 narrative steps）。
   */
  genre_code?: string;
  pipelineOrder?: string[];
  routingMode?: "auto" | "semi" | "manual";
}

/**
 * Phase 1 helper: 从 RunState 派生 checkpoint/manifest 共用的三个字段。
 * 兜底链：state.genreCode → ctx.tier_detection.genre_code → ctx.demand_analysis.genre_code。
 * pipelineOrder 由 onProgress 捕获 pipeline_steps_announce 帧后写入 state.pipelineSteps。
 */
function resolveCheckpointMeta(
  state: RunState,
  ctx?: NarrativeContext,
): { genre_code?: string; pipelineOrder?: string[]; routingMode?: "auto" | "semi" | "manual" } {
  const genreFromCtx =
    ctx?.tier_detection?.genre_code ?? ctx?.demand_analysis?.genre_code ?? undefined;
  const genre_code =
    state.genreCode ??
    (genreFromCtx && genreFromCtx !== "manual" ? genreFromCtx : undefined);
  const pipelineOrder =
    state.pipelineSteps && state.pipelineSteps.length > 0 ? [...state.pipelineSteps] : undefined;
  return {
    genre_code,
    pipelineOrder,
    routingMode: state.routingMode,
  };
}

function saveCheckpoint(state: RunState, stepId: string, ctx: NarrativeContext): void {
  try {
    const runDir = getRunDir(state);
    fs.mkdirSync(runDir, { recursive: true });
    const completedSteps = state.progress
      .filter((p) => p.status === "completed" && p.stepId)
      .map((p) => p.stepId!);
    completedSteps.push(stepId);
    const meta = resolveCheckpointMeta(state, ctx);
    const checkpoint: CheckpointData = {
      runId: state.id,
      tier: state.tier,
      mode: state.mode,
      startedAt: state.startedAt,
      lastCompletedStep: stepId,
      completedSteps: [...new Set(completedSteps)],
      savedAt: new Date().toISOString(),
      ctx,
      step_meta: state.stepMeta,
      userInput: state.userInput,
      routeGroup: state.routeGroup,
      complexity: state.complexity,
      model: state.model,
      genre_code: meta.genre_code,
      pipelineOrder: meta.pipelineOrder,
      routingMode: meta.routingMode,
    };
    writeAssetFile(runDir, "_checkpoint.json", checkpoint);
  } catch (e) {
    console.error(`Failed to save checkpoint after ${stepId}:`, e);
  }
}

function loadCheckpoint(dir: string): CheckpointData | null {
  const cpPath = path.join(OUTPUT_DIR, dir, "_checkpoint.json");
  if (!fs.existsSync(cpPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cpPath, "utf-8"));
  } catch {
    return null;
  }
}

const app = express();
// 上传剧本可能远大于 100kb（默认）：放宽到 5mb，覆盖中长篇剧本
app.use(express.json({ limit: "5mb" }));
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

const PORT = parseInt(readPluginEnv("NARRATIVE_PORT") ?? "8900", 10);
const LLM_PROXY_URL = getLlmProxyUrl();
const LLM_PROXY_KEY = getLlmProxyKey();
const API_KEY = getGeminiApiKey();

if (!LLM_PROXY_URL && !API_KEY) {
  console.error("❌ LLM_PROXY_URL or GEMINI_API_KEY environment variable is required");
  process.exit(1);
}

if (LLM_PROXY_URL && !LLM_PROXY_KEY) {
  console.error("❌ LITELLM_PROXY_KEY is required when LLM_PROXY_URL is set (LiteLLM proxy auth)");
  process.exit(1);
}

if (LLM_PROXY_URL) {
  console.log(`🔗 Using LLM proxy: ${LLM_PROXY_URL}`);
} else {
  console.log("🔑 Using direct Gemini API key");
}

interface RunState {
  id: string;
  status: "running" | "completed" | "failed";
  progress: PipelineProgress[];
  streamBuffer: PipelineProgress[];
  result?: NarrativeContext;
  error?: string;
  startedAt: string;
  tier?: TierId;
  mode?: ModeId;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  /** @deprecated A1: derived from (tier, mode, genreCode). Stored for history/log only. */
  routingMode?: "auto" | "semi" | "manual";
  /** A2-2: explicit genre code from frontend (skips LLM detectGenre when present). */
  genreCode?: string;
  model?: string;
  completedSteps?: string[];
  stepMeta?: Record<string, StepMeta>;
  outputDir?: string;
  parentKey?: string;
  forkReason?: string;
  /**
   * Phase 1: 本次运行的"权威步骤序"快照。由 onProgress 在收到
   * pipeline_steps_announce 帧时写入；动态模式追加 narrative steps 后
   * 二补帧也会刷新这里。saveCheckpoint / writeManifestIncremental 直接读。
   */
  pipelineSteps?: string[];
}

const runs = new Map<string, RunState>();

/**
 * Phase 1: 收到 pipeline_steps_announce 帧时刷新 state.pipelineSteps。
 * 同一次运行可能 emit 两次（启动时 + design_doc 完成后的二补帧），都以最新一帧为准。
 * 跳过空列表（auto 路由首帧未识别品类前会发空 steps）。
 */
function capturePipelineSteps(state: RunState, p: PipelineProgress): void {
  if (
    p.type === "pipeline_steps_announce" &&
    Array.isArray(p.steps) &&
    p.steps.length > 0
  ) {
    state.pipelineSteps = [...p.steps];
  }
}

function writeManifestIncremental(state: RunState): void {
  try {
    const runDir = getRunDir(state);
    fs.mkdirSync(runDir, { recursive: true });
    const existingFiles = fs.existsSync(runDir)
      ? fs.readdirSync(runDir).filter((f) => f !== "manifest.json")
      : [];
    const meta = resolveCheckpointMeta(state, state.result);
    const manifest: Record<string, unknown> = {
      runId: state.id,
      tier: state.tier,
      mode: state.mode,
      model: state.model,
      status: state.status,
      startedAt: state.startedAt,
      updatedAt: new Date().toISOString(),
      files: existingFiles,
      userInput: state.userInput,
      routeGroup: state.routeGroup,
      complexity: state.complexity,
      completedSteps: state.completedSteps ?? [],
      genre_code: meta.genre_code,
      pipelineOrder: meta.pipelineOrder,
      routingMode: meta.routingMode,
    };
    if (state.parentKey) manifest.parentKey = state.parentKey;
    if (state.forkReason) manifest.forkReason = state.forkReason;
    writeAssetFile(runDir, "manifest.json", manifest);
  } catch (e) {
    console.error("Failed to write incremental manifest:", e);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "narrative-studio", version: "0.4.0" });
});

/** 可用的 tier 和 mode 列表 */
app.get("/api/narrative/modes", (_req, res) => {
  const tiers: TierId[] = ["tier1", "tier2", "tier3", "tier4"];
  const result = tiers.map((tier) => ({
    tier,
    defaultMode: TIER_DEFAULT_MODE[tier],
    modes: getModesForTier(tier).map((m) => ({
      id: m.id,
      label: m.label,
      stepsCount: m.steps.length,
    })),
  }));
  res.json(result);
});

/**
 * A2-1: 品类目录 — 按 15 大类折叠分组返回所有品类。
 * 供前端 TierModeSelector 渲染二级品类面板使用。
 */
app.get("/api/narrative/genres", (_req, res) => {
  try {
    const grouped = getGenresByCategory();
    const payload = {
      categories: grouped.map((bucket) => ({
        category: bucket.category,
        label: bucket.label,
        genres: bucket.genres.map((g) => ({
          code: g.code,
          name: g.name,
          tier: g.tier,
          narrative_ratio: g.narrative_ratio,
          narrative_type: g.narrative_type,
          pipeline_template: g.pipelineTemplate,
          needs: g.needs,
          keywords: g.keywords.slice(0, 5),
        })),
      })),
    };
    const totalGenres = payload.categories.reduce((s, c) => s + c.genres.length, 0);
    console.log(`[Server] /genres OK: ${payload.categories.length} categories, ${totalGenres} genres`);
    res.json(payload);
  } catch (e) {
    console.error("[Server] /genres failed:", (e as Error)?.stack ?? e);
    res.status(500).json({ error: (e as Error)?.message ?? "internal error" });
  }
});

/**
 * Tier→Complexity default mapping (used as fallback when routing_mode=manual omits complexity).
 * Aligned with the design doc:
 *   T1 → 丰富(4) / T2 → 标准(3) / T3 → 短篇(2) / T4 → 极简(1)
 *   Level 5 (史诗) is a user-active-upgrade option only, never auto-defaulted.
 */
const TIER_DEFAULT_COMPLEXITY: Record<TierId, number> = {
  tier1: 4,
  tier2: 3,
  tier3: 2,
  tier4: 1,
};

type RoutingMode = "auto" | "semi" | "manual";

/**
 * D5: legacy step-ID migration for old manifests / checkpoints.
 *
 *   - structure_validation_l1/l2/l3 → dropped (folded into outline_batch /
 *     detailed_outline / plot_generation respectively)
 *   - initial_outline / core_settings / plot_synopsis → merged into initial_plan
 *
 * The migration is idempotent: passing already-modern IDs returns them unchanged.
 * Order is preserved; duplicates from collapsing are de-duplicated.
 */
const LEGACY_STEP_ID_MAP: Record<string, string | null> = {
  structure_validation_l1: null,
  structure_validation_l2: null,
  structure_validation_l3: null,
  initial_outline: "initial_plan",
  core_settings: "initial_plan",
  plot_synopsis: "initial_plan",
};

function migrateLegacyCompletedSteps(steps: string[] | null | undefined): string[] {
  if (!steps?.length) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of steps) {
    if (id in LEGACY_STEP_ID_MAP) {
      const replacement = LEGACY_STEP_ID_MAP[id];
      if (replacement && !seen.has(replacement)) {
        out.push(replacement);
        seen.add(replacement);
      }
      continue;
    }
    if (!seen.has(id)) {
      out.push(id);
      seen.add(id);
    }
  }
  return out;
}

/** D4: 仅用于 announce 帧，与 modes.ts 内的 DESIGN 常量保持同序。 */
const DESIGN_STEP_IDS_FOR_ANNOUNCE: string[] = [
  S.CORE_CONCEPT,
  S.SYSTEM_ARCHITECTURE,
  S.SYSTEM_DETAIL,
  S.VALUE_FRAMEWORK,
  S.DESIGN_DOC,
];

/**
 * D4 + V1: build the pipeline_steps_announce payload.
 * Returns the ordered step list and the pipeline_template used.
 *
 * @deprecated Blueprint 模式下由 assembleBlueprint() 替代。
 * 旧 run() 路径仍需此函数，待所有路径迁移到 runWithBlueprint 后移除。
 *
 * Cases:
 *  - narrative_auto / design_auto **with explicit genre_code** → 用品类预置 needs
 *    立即静态算出叙事步骤（design_auto 还会前置 D0-D4），让前端开始即看到完整步骤列表。
 *  - narrative_auto / design_auto **without genre_code** → return [] for steps.
 *    The frontend will continue to use its preview until progress arrives.
 *  - resolved mode → flatten ModeConfig.steps and return mode.pipeline_template.
 */
function buildPipelineStepsAnnounce(
  state: RunState,
  resolvedMode: ModeId | undefined,
  tierHint: TierId | undefined,
): { steps: string[]; pipelineTemplate?: string } {
  const isDesignAuto = resolvedMode === ("design_auto" as ModeId);
  const isNarrativeAuto = resolvedMode === ("narrative_auto" as ModeId);

  // 元节点（开场白）：
  //   - pipeline_config：每次 pipeline 启动都会 emit 一次（status=completed），表示
  //     "本次 Tier=X / Mode=Y / 共 N 步" 的开场总览。固定置于 announce 列表第一位，
  //     避免它作为后到达事件被 defensive append 到节点末尾。
  //   - tier_router：仅自动路由（未显式指定 genre_code）会真正调用 LLM 识别品类，
  //     需要作为节点存在；手动指定品类时直接 fallback，不发节点。
  //
  // 注意：仅当本次 announce 本身有完整 step list（下面两个分支 return 的）才注入；
  // 否则保持原样（空 steps），让前端继续走本地预览 fallback。
  const META_HEAD: string[] = ["pipeline_config"];
  const isAutoRouting = !state.genreCode;
  if (isAutoRouting) META_HEAD.unshift("tier_router");

  // Phase 6: 当用户显式指定 genre_code 时，优先用 Planner 计算步骤列表。
  if ((isDesignAuto || isNarrativeAuto) && state.genreCode) {
    try {
      const entry = findGenreByCode(state.genreCode);
      if (entry) {
        const planResult = planPipeline({
          genre_code: entry.code,
          tier: tierHint ?? entry.tier,
          needs: entry.needs,
          narrative_type: getNarrativeType(state.genreCode),
          pipelineTemplate: entry.pipelineTemplate,
        });
        const flatPlannerSteps = planResult.stepGroups.flatMap(
          (g) => Array.isArray(g) ? g : [g],
        );
        const steps = isDesignAuto
          ? [...DESIGN_STEP_IDS_FOR_ANNOUNCE, ...flatPlannerSteps]
          : flatPlannerSteps;
        if (process.env.NARRATIVE_AUTO_DEBUG === "1") {
          console.log(`[announce] Planner genre=${state.genreCode} template=${entry.pipelineTemplate}`);
          console.log(`[announce]   plannerSteps=[${flatPlannerSteps.join(",")}]`);
          console.log(`[announce]   final steps=[${[...META_HEAD, ...steps].join(",")}]`);
        }
        return { steps: [...META_HEAD, ...steps], pipelineTemplate: entry.pipelineTemplate };
      }
    } catch (e) {
      console.warn("[announce] Planner failed, falling back:", (e as Error).message);
      try {
        const entry = GENRE_TAXONOMY.find((g) => g.code === state.genreCode);
        if (entry) {
          /** @deprecated Legacy announce fallback. */
          const syntheticReq = {
            narrative_type: getNarrativeType(state.genreCode!),
            needs: entry.needs,
          } as Parameters<typeof buildAutoSteps>[0];
          const autoSteps = buildAutoSteps(syntheticReq, { genreCode: state.genreCode });
          const steps = isDesignAuto
            ? [...DESIGN_STEP_IDS_FOR_ANNOUNCE, ...autoSteps]
            : autoSteps;
          return { steps: [...META_HEAD, ...steps], pipelineTemplate: entry.pipelineTemplate };
        }
      } catch (e2) {
        console.warn("[announce] legacy fallback also failed:", (e2 as Error).message);
      }
    }
  }

  if (!resolvedMode || isNarrativeAuto || isDesignAuto) {
    return { steps: [], pipelineTemplate: undefined };
  }
  try {
    const cfg = getModeConfig(resolvedMode);
    const flat = cfg.steps.flatMap((s) => (Array.isArray(s) ? s : [s]));
    return { steps: [...META_HEAD, ...flat], pipelineTemplate: cfg.pipeline_template };
  } catch {
    void tierHint;
    return { steps: [], pipelineTemplate: undefined };
  }
}

app.post("/api/narrative/start", async (req, res) => {
  console.warn("[API] /start called at", new Date().toISOString());
  const {
    user_input, model, tier, mode, auto_detect, route_group, complexity,
    /** @deprecated A1: derive from (tier, mode, genre_code) instead. Kept for backward compat. */
    routing_mode,
    /** A2-2: explicit genre code (e.g. "rpg-jrpg"). When provided, skip LLM detectGenre. */
    genre_code,
    /** Phase 6: legacy 回退开关。true = 跳过 Planner，走旧 buildAutoSteps 路径。 */
    use_legacy_pipeline,
    /** Blueprint 模式开关。true = 走 Blueprint + AgentRunner 新路径。 */
    use_blueprint,
    /** M1: 上传剧本（前端把 .txt/.docx 解析后的原文 + 文件元信息传过来）。
     *  - content        utf8 剧本原文（.txt 走这里；前端可以直接 file.text()）
     *  - content_base64 二进制 base64（仅当 encoding="base64-docx" 时；服务端用 mammoth 解析）
     *  - encoding       "utf8" | "base64-docx"；缺省按 "utf8"
     *  - file_name/size/mime  仅用于存档与 UI；server 端会跑 detectScriptFormat 补 format/char_count
     */
    uploaded_script,
  } = req.body as {
    user_input?: string;
    model?: string;
    tier?: TierId;
    mode?: ModeId;
    auto_detect?: boolean;
    route_group?: "planning" | "narrative";
    complexity?: number;
    routing_mode?: RoutingMode;
    genre_code?: string;
    use_legacy_pipeline?: boolean;
    use_blueprint?: boolean;
    uploaded_script?: {
      content?: string;
      content_base64?: string;
      encoding?: "utf8" | "base64-docx";
      file_name?: string;
      size?: number;
      mime?: string;
    };
  };

  if (!user_input?.trim()) {
    res.status(400).json({ error: "user_input is required" });
    return;
  }

  // M1: 解析上传剧本（在请求线程内同步完成；mammoth + 正则识别，毫秒至秒级）
  let parsedUploadedScript: UploadedScript | undefined;
  if (uploaded_script && (uploaded_script.content || uploaded_script.content_base64)) {
    let resolvedText = "";
    try {
      if (uploaded_script.encoding === "base64-docx" && uploaded_script.content_base64) {
        // M1.8: 服务端 .docx 解析（前端 ArrayBuffer → base64 → backend Buffer → mammoth → 纯文本）
        const buf = Buffer.from(uploaded_script.content_base64, "base64");
        // 动态 import 避免 cold-start 把 mammoth 拉进 bundle 的开销（仅在用户上传 .docx 时才加载）
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: buf });
        resolvedText = result.value ?? "";
        if (result.messages?.length) {
          console.log(`[Server] mammoth messages (${result.messages.length}): ${result.messages.slice(0, 3).map(m => m.message).join("; ")}`);
        }
      } else if (uploaded_script.content) {
        resolvedText = uploaded_script.content;
      }
    } catch (e) {
      console.warn(`[Server] uploaded_script parse failed: ${(e as Error).message}`);
    }

    if (resolvedText && resolvedText.trim().length > 0) {
      const detection = detectScriptFormat(resolvedText);
      parsedUploadedScript = {
        content: resolvedText,
        format: detection.format,
        char_count: detection.charCount,
        estimated_word_count: detection.estimatedWordCount,
        file_name: uploaded_script.file_name,
        size: uploaded_script.size,
        mime: uploaded_script.mime,
        description: describeScriptFormat(detection),
      };
      console.log(
        `[Server] uploaded_script parsed: format=${detection.format} ` +
        `chars=${detection.charCount} words=${detection.estimatedWordCount} ` +
        `file=${uploaded_script.file_name ?? "(no name)"} ` +
        `encoding=${uploaded_script.encoding ?? "utf8"}`,
      );
    }
  }

  const activeRunning = [...runs.values()].find((r) => r.status === "running");
  if (activeRunning) {
    res.status(409).json({ error: `已有运行中的管线 (${activeRunning.id})，请等待完成或取消后再试` });
    return;
  }

  const validTiers: TierId[] = ["tier1", "tier2", "tier3", "tier4"];
  if (tier && !validTiers.includes(tier)) {
    res.status(400).json({ error: `Invalid tier: ${tier}. Must be one of: ${validTiers.join(", ")}` });
    return;
  }

  // ── Routing mode resolution (A1) ──────────────────────────────────────────
  // - auto:    no fields given, LLM detects tier+genre+complexity
  // - semi:    user gave some (e.g. tier) but not all, LLM fills the rest
  // - manual:  all dimensions specified, skip LLM tier detection entirely
  // If client did not send routing_mode, derive from auto_detect / tier presence
  const resolvedRoutingMode: RoutingMode =
    routing_mode ??
    (auto_detect === false ? "manual" : (tier ? "semi" : "auto"));

  // Manual mode: complexity falls back to tier default when omitted (A2)
  let effectiveComplexity = complexity;
  if (resolvedRoutingMode === "manual" && tier && effectiveComplexity == null) {
    effectiveComplexity = TIER_DEFAULT_COMPLEXITY[tier];
    console.log(`[Server] manual routing: complexity not provided, using tier default ${effectiveComplexity}`);
  }
  // Phase 3.5: 移除 tier4 强制 complexity=1。
  // 用户最新拍板：除"自动"路由外，所有 tier 任何品类都可自由选 1-5 档复杂度。
  // 旧的强制覆盖会让用户在 tier4 下选了"短篇"也被悄悄改成"极简"，违反契约。

  let resolvedMode = mode;
  if (tier && resolvedMode) {
    const tierModes = getModesForTier(tier);
    if (!tierModes.some((m) => m.id === resolvedMode)) {
      resolvedMode = TIER_DEFAULT_MODE[tier] ?? resolvedMode;
      console.log(`⚠️ Mode '${mode}' not in tier '${tier}' available list, falling back to '${resolvedMode}'`);
    }
  } else if (tier && !resolvedMode) {
    resolvedMode = TIER_DEFAULT_MODE[tier];
  }

  const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resolvedModel = model ?? getDefaultModel();

  // A2-2: explicit genre_code makes manual routing implicit (we have genre + tier when both provided)
  const hasExplicitGenre = typeof genre_code === "string" && genre_code.trim().length > 0;
  const state: RunState = {
    id,
    status: "running",
    progress: [],
    streamBuffer: [],
    startedAt: new Date().toISOString(),
    tier,
    mode: resolvedMode,
    userInput: user_input!.trim(),
    routeGroup: route_group,
    complexity: effectiveComplexity,
    routingMode: resolvedRoutingMode,
    genreCode: hasExplicitGenre ? genre_code!.trim() : undefined,
    model: resolvedModel,
  };
  runs.set(id, state);

  const pipeline = new NarrativePipeline({
    apiKey: API_KEY || undefined,
    proxyUrl: LLM_PROXY_URL || undefined,
    proxyApiKey: LLM_PROXY_KEY || undefined,
    model: resolvedModel,
    complexity: state.complexity,
    onProgress: (p) => {
      if (p.type === "streaming") {
        state.streamBuffer.push(p);
      } else {
        state.progress.push(p);
      }
      capturePipelineSteps(state, p);
      if (!state.tier && p.stepId === "tier_router" && p.status === "completed") {
        state.tier = p.message?.match(/tier[1-4]/)?.[0] as TierId | undefined;
      }
      if (p.status === "completed" && p.stepId && p.data != null) {
        saveStepIncremental(state, p.stepId, p.data);
      }
    },
    onStepComplete: (stepId, ctx) => {
      saveCheckpoint(state, stepId, ctx);
      saveCompanionData(state, stepId, ctx);
      if (!state.completedSteps) state.completedSteps = [];
      state.completedSteps.push(stepId);
      writeManifestIncremental(state);
    },
    tier,
    mode: resolvedMode,
    // A2-2: when frontend provides explicit genre_code, treat it as manual:
    // skip both tier detection AND genre detection. Otherwise:
    // - manual routing: skip LLM tier detection
    // - auto/semi: run LLM detection as before
    autoDetectTier: hasExplicitGenre ? false : (resolvedRoutingMode === "manual" ? false : (auto_detect !== false)),
    genreCode: hasExplicitGenre ? genre_code!.trim() : undefined,
    usePlanner: use_legacy_pipeline === true ? false : undefined,
  });

  writeManifestIncremental(state);

  // ── D4: pipeline_steps_announce ──────────────────────────────────────────
  // Emit the planned step list as the very first SSE frame, so the frontend
  // can paint all step rows as "pending" without depending on hardcoded
  // route tables. We compute a best-effort step list from the resolved mode;
  // when running in narrative_auto mode we leave `steps` empty and let the
  // frontend keep its preview until concrete progress events arrive.
  try {
    const announce = buildPipelineStepsAnnounce(state, resolvedMode, tier);
    state.progress.unshift({
      type: "pipeline_steps_announce",
      stage: "announce",
      step: 0,
      totalSteps: announce.steps.length,
      status: "pending",
      steps: announce.steps,
      pipelineTemplate: announce.pipelineTemplate,
      complexity: state.complexity,
      routingMode: state.routingMode,
      // A2-4: 显式品类时把 genre_code 带到 announce 帧，让前端知道走的是 manual 路由
      genreCode: state.genreCode,
    });
    // Phase 1: 同步刷新 state.pipelineSteps，让首次 saveCheckpoint / writeManifestIncremental
    // 就能带上 pipelineOrder（不必等下一次 onProgress）。
    if (announce.steps.length > 0) {
      state.pipelineSteps = [...announce.steps];
    }
  } catch (e) {
    console.warn("[Server] pipeline_steps_announce skipped:", (e as Error).message);
  }

  const injectCtxHelpers = (ctx: NarrativeContext) => {
    const ctxAny = ctx as Record<string, unknown>;
    if (!ctxAny._saveNode) {
      ctxAny._saveNode = (stepId: string, nodeId: string, data: unknown) =>
        saveNodeFile(state, stepId, nodeId, data);
    }
    if (!ctxAny._questCompletedNodes) {
      ctxAny._questCompletedNodes = new Set<string>();
    }
  };

  const origOnStep = pipeline["config"].onStepComplete;
  pipeline["config"].onStepComplete = (stepId: string, ctx: NarrativeContext) => {
    injectCtxHelpers(ctx);

    // 将前端选择的 complexity 合并到 global_control_params（优先于 LLM 输出）
    if (stepId === "preference_analysis" && state.complexity != null && ctx.global_control_params) {
      const uiComplexity = Math.round(Math.max(1, Math.min(5, state.complexity)));
      if (uiComplexity !== ctx.global_control_params.complexity) {
        console.log(`[Server] Override complexity: LLM=${ctx.global_control_params.complexity} → UI=${uiComplexity}`);
        ctx.global_control_params.complexity = uiComplexity;
      }
    }

    origOnStep?.(stepId, ctx);
  };

  const runOpts = parsedUploadedScript ? { uploadedScript: parsedUploadedScript } : undefined;
  const pipelinePromise = use_blueprint
    ? pipeline.runWithBlueprint(user_input.trim(), runOpts).then(({ ctx: result, blueprint }) => {
        state.status = "completed";
        state.result = result;
        (state as unknown as Record<string, unknown>).blueprint = blueprint;
        if (result.tier_detection) state.tier = result.tier_detection.tier;
        try { writeManifestIncremental(state); } catch { /* best effort */ }
        try { saveRunToFile(state); } catch (e) { console.error("Failed to save result:", e); }
      })
    : pipeline.run(user_input.trim(), runOpts).then((result) => {
        state.status = "completed";
        state.result = result;
        if (result.tier_detection) state.tier = result.tier_detection.tier;
        try { writeManifestIncremental(state); } catch { /* best effort */ }
        try { saveRunToFile(state); } catch (e) { console.error("Failed to save result:", e); }
      });

  pipelinePromise.catch((err) => {
      state.status = "failed";
      state.error = (err as Error).message;
      try { writeManifestIncremental(state); } catch { /* best effort */ }
      try { saveRunToFile(state); } catch (e) { console.error("Failed to save error:", e); }
    });

  const sourceDir = formatTimestamp(state.startedAt);
  res.json({ id, status: "running", message: "Pipeline started", tier, mode: resolvedMode, sourceDir });
});

app.post("/api/narrative/resume", async (req, res) => {
  const { dir, model } = req.body as { dir?: string; model?: string };
  if (!dir?.trim()) {
    res.status(400).json({ error: "dir is required (run directory name)" });
    return;
  }

  const activeRunning = [...runs.values()].find((r) => r.status === "running");
  if (activeRunning) {
    res.status(409).json({ error: `已有运行中的管线 (${activeRunning.id})，请等待完成或取消后再试` });
    return;
  }

  const checkpoint = loadCheckpoint(dir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${dir}` });
    return;
  }

  const id = `resume_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resumeModel = model ?? checkpoint.model ?? getDefaultModel();

  // Resume writes to the SAME directory (not a new one)
  const state: RunState = {
    id,
    status: "running",
    progress: [],
    streamBuffer: [],
    startedAt: checkpoint.startedAt,
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    userInput: checkpoint.userInput ?? checkpoint.ctx.user_input,
    routeGroup: checkpoint.routeGroup,
    complexity: checkpoint.complexity ?? checkpoint.ctx.global_control_params?.complexity,
    model: resumeModel,
    outputDir: path.join(OUTPUT_DIR, dir),
    completedSteps: [...(checkpoint.completedSteps ?? [])],
    // Phase 1: 从 checkpoint 恢复"权威步骤序"与启动参数。
    // 这些字段让 resume 写新 checkpoint 时不丢失原始管线快照；
    // 若是旧版 checkpoint 缺这些字段，fallback 到 ctx.tier_detection.genre_code。
    pipelineSteps:
      checkpoint.pipelineOrder && checkpoint.pipelineOrder.length > 0
        ? [...checkpoint.pipelineOrder]
        : undefined,
    genreCode:
      checkpoint.genre_code ??
      (checkpoint.ctx.tier_detection?.genre_code !== "manual"
        ? checkpoint.ctx.tier_detection?.genre_code
        : undefined) ??
      checkpoint.ctx.demand_analysis?.genre_code,
    routingMode: checkpoint.routingMode,
  };
  runs.set(id, state);

  const pipeline = new NarrativePipeline({
    apiKey: API_KEY || undefined,
    proxyUrl: LLM_PROXY_URL || undefined,
    proxyApiKey: LLM_PROXY_KEY || undefined,
    model: resumeModel,
    complexity: state.complexity,
    onProgress: (p) => {
      if (p.type === "streaming") {
        state.streamBuffer.push(p);
      } else {
        state.progress.push(p);
      }
      capturePipelineSteps(state, p);
      if (p.status === "completed" && p.stepId && p.data != null) {
        saveStepIncremental(state, p.stepId, p.data);
      }
    },
    onStepComplete: (stepId, ctx) => {
      saveCheckpoint(state, stepId, ctx);
      saveCompanionData(state, stepId, ctx);
      if (!state.completedSteps) state.completedSteps = [];
      if (!state.completedSteps.includes(stepId)) state.completedSteps.push(stepId);
      writeManifestIncremental(state);
    },
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    autoDetectTier: false,
    resumeCtx: checkpoint.ctx,
    resumeAfterStep: checkpoint.lastCompletedStep,
  });

  // Update manifest status to running (same directory)
  writeManifestIncremental(state);

  // Phase 1: resume 也要发一帧 pipeline_steps_announce，让前端 SSE 收到后立刻
  // 恢复 pipelineOrder（否则切到 resume 这一刻 PipelineStatus 短暂为空）。
  // 优先使用 checkpoint 持久化的 pipelineOrder（最权威，含动态追加的 narrative steps）；
  // 缺失时用 buildPipelineStepsAnnounce 静态推导。
  try {
    let resumeAnnounceSteps: string[] = state.pipelineSteps ?? [];
    let resumeAnnounceTemplate: string | undefined;
    if (resumeAnnounceSteps.length === 0) {
      console.warn(
        `[Resume] 旧版 checkpoint 缺少 pipelineOrder，回退静态推导。` +
        ` 若首跑为 design_auto 且动态追加了叙事步骤，resume 步骤序可能不完整。`,
      );
      const announce = buildPipelineStepsAnnounce(state, checkpoint.mode, checkpoint.tier);
      resumeAnnounceSteps = announce.steps;
      resumeAnnounceTemplate = announce.pipelineTemplate;
    } else {
      const entry = state.genreCode
        ? GENRE_TAXONOMY.find((g) => g.code === state.genreCode)
        : null;
      resumeAnnounceTemplate = entry?.pipelineTemplate;
    }
    if (resumeAnnounceSteps.length > 0) {
      state.progress.unshift({
        type: "pipeline_steps_announce",
        stage: "announce",
        step: 0,
        totalSteps: resumeAnnounceSteps.length,
        status: "pending",
        steps: resumeAnnounceSteps,
        pipelineTemplate: resumeAnnounceTemplate,
        complexity: state.complexity,
        routingMode: state.routingMode,
        genreCode: state.genreCode,
      });
      state.pipelineSteps = [...resumeAnnounceSteps];
    }
  } catch (e) {
    console.warn("[Server] resume pipeline_steps_announce skipped:", (e as Error).message);
  }

  const injectResumeCtxHelpers = (ctx: NarrativeContext) => {
    const ctxAny = ctx as Record<string, unknown>;
    if (!ctxAny._saveNode) {
      ctxAny._saveNode = (stepId: string, nodeId: string, data: unknown) =>
        saveNodeFile(state, stepId, nodeId, data);
    }
    if (!ctxAny._questCompletedNodes) {
      ctxAny._questCompletedNodes = new Set<string>();
    }
  };

  const origResumeOnStep = pipeline["config"].onStepComplete;
  pipeline["config"].onStepComplete = (stepId: string, ctx: NarrativeContext) => {
    injectResumeCtxHelpers(ctx);
    origResumeOnStep?.(stepId, ctx);
  };

  pipeline
    .run(checkpoint.ctx.user_input ?? "")
    .then((result) => {
      state.status = "completed";
      state.result = result;
      try { writeManifestIncremental(state); } catch { /* best effort */ }
      try { saveRunToFile(state); } catch (e) { console.error("Failed to save resumed result:", e); }
    })
    .catch((err) => {
      state.status = "failed";
      state.error = (err as Error).message;
      try { writeManifestIncremental(state); } catch { /* best effort */ }
      try { saveRunToFile(state); } catch (e) { console.error("Failed to save resumed error:", e); }
    });

  res.json({
    id,
    status: "running",
    message: `Pipeline resumed from '${checkpoint.lastCompletedStep}'`,
    entryKey: dir,
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    lastCompletedStep: checkpoint.lastCompletedStep,
  });
});

// ── Regenerate (Fork): create a new entry from source, apply edits, re-run ──
app.post("/api/narrative/regenerate", async (req, res) => {
  console.warn("[API] /regenerate called at", new Date().toISOString());
  const {
    sourceDir, fromStepId, userInstructions, stopAfterStep,
    patchedContext, model, skipSteps, nodeFilter,
    editDrafts,
  } = req.body as {
    sourceDir?: string;
    fromStepId?: string;
    userInstructions?: string;
    stopAfterStep?: string;
    patchedContext?: Record<string, unknown>;
    model?: string;
    skipSteps?: string[];
    nodeFilter?: Record<string, string[]>;
    editDrafts?: Record<string, { content?: unknown; userInput?: string }>;
  };

  if (!sourceDir?.trim()) {
    res.status(400).json({ error: "sourceDir is required (original run directory name)" });
    return;
  }
  if (!fromStepId?.trim()) {
    res.status(400).json({ error: "fromStepId is required (step to re-run from)" });
    return;
  }

  const activeRunning = [...runs.values()].find((r) => r.status === "running");
  if (activeRunning) {
    res.status(409).json({ error: `已有运行中的管线 (${activeRunning.id})，请等待完成或取消后再试` });
    return;
  }

  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }

  const id = `regen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const resolvedModel = model ?? checkpoint.model ?? getDefaultModel();

  // Build fork reason from editDrafts summary
  const forkParts: string[] = [];
  if (editDrafts) {
    for (const [stepId, draft] of Object.entries(editDrafts)) {
      if (draft.userInput) forkParts.push(`${stepId}: ${draft.userInput.slice(0, 60)}`);
      else if (draft.content != null) forkParts.push(`${stepId}: 内容编辑`);
    }
  }
  if (userInstructions) forkParts.push(userInstructions.slice(0, 80));
  const forkReason = forkParts.join("; ") || `从 ${fromStepId} 重新生成`;

  const state: RunState = {
    id,
    status: "running",
    progress: [],
    streamBuffer: [],
    startedAt: new Date().toISOString(),
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    userInput: checkpoint.userInput ?? checkpoint.ctx.user_input,
    routeGroup: checkpoint.routeGroup,
    complexity: checkpoint.complexity ?? checkpoint.ctx.global_control_params?.complexity,
    model: resolvedModel,
    parentKey: sourceDir,
    forkReason,
    // Phase 1: 从 source checkpoint 继承"权威步骤序"与启动参数。
    pipelineSteps:
      checkpoint.pipelineOrder && checkpoint.pipelineOrder.length > 0
        ? [...checkpoint.pipelineOrder]
        : undefined,
    genreCode:
      checkpoint.genre_code ??
      (checkpoint.ctx.tier_detection?.genre_code !== "manual"
        ? checkpoint.ctx.tier_detection?.genre_code
        : undefined) ??
      checkpoint.ctx.demand_analysis?.genre_code,
    routingMode: checkpoint.routingMode,
  };
  runs.set(id, state);

  // Apply editDrafts to a copy of the ctx
  const ctx = { ...checkpoint.ctx };
  const stepMeta: Record<string, StepMeta> = { ...(checkpoint.step_meta ?? {}) };

  if (editDrafts) {
    for (const [stepId, draft] of Object.entries(editDrafts)) {
      const [baseStep, nodeId] = stepId.includes("::") ? stepId.split("::") : [stepId, undefined];
      const original = resolveStepContent(ctx, baseStep, nodeId);

      if (draft.content != null) {
        if (nodeId) {
          patchCtxNodeContent(ctx, baseStep, nodeId, draft.content);
        } else {
          // 合并步骤（initial_plan）需要拆分写入三个子字段，避免聚合对象误覆盖单字段
          setStepCtxData(baseStep, ctx, draft.content);
        }
      }

      const metaKey = nodeId ? `${baseStep}::${nodeId}` : baseStep;
      const meta: StepMeta = stepMeta[metaKey] ?? { needsRegen: true, modifications: [], version: 0 };
      meta.needsRegen = true;
      meta.modifications.push({
        original,
        edited: draft.content ?? undefined,
        userInstructions: draft.userInput?.trim() || undefined,
        modifiedAt: new Date().toISOString(),
      });
      meta.version++;
      stepMeta[metaKey] = meta;
    }
  }

  state.stepMeta = stepMeta;

  // Pre-populate completedSteps from source (steps before fromStepId)
  if (checkpoint.completedSteps) {
    const fromIdx = checkpoint.completedSteps.indexOf(fromStepId);
    if (fromIdx > 0) {
      state.completedSteps = checkpoint.completedSteps.slice(0, fromIdx);
    }
  }

  const pipeline = new NarrativePipeline({
    apiKey: API_KEY || undefined,
    proxyUrl: LLM_PROXY_URL || undefined,
    proxyApiKey: LLM_PROXY_KEY || undefined,
    model: resolvedModel,
    complexity: state.complexity,
    onProgress: (p) => {
      if (p.type === "streaming") {
        state.streamBuffer.push(p);
      } else {
        state.progress.push(p);
      }
      capturePipelineSteps(state, p);
      if (p.status === "completed" && p.stepId && p.data != null) {
        saveStepIncremental(state, p.stepId, p.data);
      }
    },
    onStepComplete: (stepId, ctx) => {
      saveCheckpoint(state, stepId, ctx);
      saveCompanionData(state, stepId, ctx);
      if (!state.completedSteps) state.completedSteps = [];
      state.completedSteps.push(stepId);
      writeManifestIncremental(state);
    },
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    autoDetectTier: false,
  });

  // Write initial manifest + checkpoint for the fork
  writeManifestIncremental(state);
  try {
    const runDir = getRunDir(state);
    fs.mkdirSync(runDir, { recursive: true });
    const initMeta = resolveCheckpointMeta(state, ctx);
    const initCheckpoint: CheckpointData = {
      runId: id,
      tier: checkpoint.tier,
      mode: checkpoint.mode,
      startedAt: state.startedAt,
      lastCompletedStep: checkpoint.lastCompletedStep,
      completedSteps: state.completedSteps ?? [],
      savedAt: new Date().toISOString(),
      ctx,
      step_meta: stepMeta,
      userInput: state.userInput,
      routeGroup: state.routeGroup,
      complexity: state.complexity,
      model: resolvedModel,
      genre_code: initMeta.genre_code,
      pipelineOrder: initMeta.pipelineOrder,
      routingMode: initMeta.routingMode,
    };
    writeAssetFile(runDir, "_checkpoint.json", initCheckpoint);

    // Copy pre-fork step files so interrupted forks still have loadable data
    for (const sid of (state.completedSteps ?? [])) {
      const fileDef = STEP_FILE_MAP[sid];
      if (!fileDef) continue;
      const data = getStepDataForFile(sid, ctx);
      if (data != null) {
        const filename = `${fileDef.index}_${fileDef.name}.${fileDef.ext}`;
        writeAssetFile(runDir, filename, data);
        savePerNodeFiles(runDir, sid, fileDef, data);
      }
    }
  } catch (e) {
    console.error("Failed to write initial fork data:", e);
  }

  const injectRegenCtxHelpers = (ctx: NarrativeContext) => {
    const ctxAny = ctx as Record<string, unknown>;
    if (!ctxAny._saveNode) {
      ctxAny._saveNode = (stepId: string, nodeId: string, data: unknown) =>
        saveNodeFile(state, stepId, nodeId, data);
    }
    if (!ctxAny._questCompletedNodes) {
      ctxAny._questCompletedNodes = new Set<string>();
    }
  };

  const origRegenOnStep = pipeline["config"].onStepComplete;
  pipeline["config"].onStepComplete = (stepId: string, ctx: NarrativeContext) => {
    injectRegenCtxHelpers(ctx);
    origRegenOnStep?.(stepId, ctx);
  };

  // Phase 1: regenerate 也发首帧 announce，让前端 fork 模式能预填全量节点 +
  // 同步 pipelineOrder（与 startFork 的 preloadSteps 互补）。
  try {
    let regenAnnounceSteps: string[] = state.pipelineSteps ?? [];
    let regenAnnounceTemplate: string | undefined;
    if (regenAnnounceSteps.length === 0) {
      const announce = buildPipelineStepsAnnounce(state, checkpoint.mode, checkpoint.tier);
      regenAnnounceSteps = announce.steps;
      regenAnnounceTemplate = announce.pipelineTemplate;
    } else {
      const entry = state.genreCode
        ? GENRE_TAXONOMY.find((g) => g.code === state.genreCode)
        : null;
      regenAnnounceTemplate = entry?.pipelineTemplate;
    }
    if (regenAnnounceSteps.length > 0) {
      state.progress.unshift({
        type: "pipeline_steps_announce",
        stage: "announce",
        step: 0,
        totalSteps: regenAnnounceSteps.length,
        status: "pending",
        steps: regenAnnounceSteps,
        pipelineTemplate: regenAnnounceTemplate,
        complexity: state.complexity,
        routingMode: state.routingMode,
        genreCode: state.genreCode,
      });
      state.pipelineSteps = [...regenAnnounceSteps];
    }
  } catch (e) {
    console.warn("[Server] regenerate pipeline_steps_announce skipped:", (e as Error).message);
  }

  const rerunOpts: RerunOptions = {};
  if (userInstructions?.trim()) rerunOpts.userInstructions = userInstructions.trim();
  if (stopAfterStep?.trim()) rerunOpts.stopAfterStep = stopAfterStep.trim();
  if (patchedContext && Object.keys(patchedContext).length > 0) {
    rerunOpts.patchedFields = patchedContext as Partial<NarrativeContext>;
  }
  if (skipSteps?.length) rerunOpts.skipSteps = skipSteps;
  if (nodeFilter && Object.keys(nodeFilter).length > 0) rerunOpts.nodeFilter = nodeFilter;
  rerunOpts.stepMeta = stepMeta;

  const staleSteps = pipeline.getStaleSteps(fromStepId, checkpoint.mode ?? "design_auto", ctx);

  // Derive the new entry key from the output directory name
  const newEntryKey = path.basename(getRunDir(state));

  pipeline
    .rerunFromStep(ctx, fromStepId, rerunOpts)
    .then((result) => {
      state.status = "completed";
      state.result = result;
      try { writeManifestIncremental(state); } catch { /* best effort */ }
      try { saveRunToFile(state); } catch (e) { console.error("Failed to save regenerated result:", e); }
    })
    .catch((err) => {
      state.status = "failed";
      state.error = (err as Error).message;
      try { writeManifestIncremental(state); } catch { /* best effort */ }
      try { saveRunToFile(state); } catch (e) { console.error("Failed to save regeneration error:", e); }
    });

  res.json({
    id,
    status: "running",
    message: `Fork from '${sourceDir}', regenerating from step '${fromStepId}'`,
    sourceDir,
    newEntryKey,
    fromStepId,
    staleSteps,
    tier: checkpoint.tier,
    mode: checkpoint.mode,
    parentKey: sourceDir,
  });
});

// ── Stale steps preview (no execution, just returns which steps would be affected) ──
app.get("/api/narrative/stale-steps", (req, res) => {
  const { sourceDir, fromStepId } = req.query as { sourceDir?: string; fromStepId?: string };
  if (!sourceDir?.trim() || !fromStepId?.trim()) {
    res.status(400).json({ error: "sourceDir and fromStepId are required as query params" });
    return;
  }
  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }
  const mode = checkpoint.mode ?? "design_auto";
  const pipeline = new NarrativePipeline({});
  const staleSteps = pipeline.getStaleSteps(fromStepId, mode, checkpoint.ctx);
  const staleFields = staleSteps.flatMap(s => STEP_OUTPUT_FIELDS[s] ?? []);
  res.json({ fromStepId, mode, staleSteps, staleFields });
});

// ── Review state persistence ──

interface ReviewEntry {
  stepId: string;
  status: "pending" | "approved" | "rejected";
  feedback?: string;
  reviewedAt?: string;
  regenerateRunId?: string;
}

interface ReviewState {
  entries: ReviewEntry[];
  updatedAt: string;
}

// ── Edit history persistence (_edits.json + _original/) ──

interface EditRecord {
  stepId: string;
  nodeId?: string;
  editedContent: unknown;
  userInput?: string;
  originalContent: unknown;
  savedAt: string;
}

interface EditsState {
  edits: EditRecord[];
  updatedAt: string;
}

function loadEditsState(dir: string): EditsState {
  const editsPath = path.join(OUTPUT_DIR, dir, "_edits.json");
  if (fs.existsSync(editsPath)) {
    try {
      return JSON.parse(fs.readFileSync(editsPath, "utf-8"));
    } catch { /* corrupt file */ }
  }
  return { edits: [], updatedAt: new Date().toISOString() };
}

function saveEditsState(dir: string, state: EditsState): void {
  const dirPath = path.join(OUTPUT_DIR, dir);
  fs.mkdirSync(dirPath, { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeAssetFile(dirPath, "_edits.json", state);
}

function saveOriginalContent(dir: string, stepId: string, nodeId: string | undefined, content: unknown): void {
  const origDir = path.join(OUTPUT_DIR, dir, "_original");
  fs.mkdirSync(origDir, { recursive: true });
  const key = nodeId ? `${stepId}__${nodeId}` : stepId;
  const safeKey = key.replace(/[/\\?%*:|"<>]/g, "_");
  const ext = typeof content === "string" ? "md" : "json";
  const origPath = path.join(origDir, `${safeKey}.${ext}`);
  if (!fs.existsSync(origPath)) {
    writeAssetFile(origDir, `${safeKey}.${ext}`, content);
  }
}

function loadOriginalContent(dir: string, stepId: string, nodeId?: string): unknown | null {
  const origDir = path.join(OUTPUT_DIR, dir, "_original");
  const key = nodeId ? `${stepId}__${nodeId}` : stepId;
  const safeKey = key.replace(/[/\\?%*:|"<>]/g, "_");
  for (const ext of ["json", "md"]) {
    const origPath = path.join(origDir, `${safeKey}.${ext}`);
    if (fs.existsSync(origPath)) {
      try {
        const raw = fs.readFileSync(origPath, "utf-8");
        return ext === "json" ? JSON.parse(raw) : raw;
      } catch { /* corrupt file */ }
    }
  }
  return null;
}

function resolveStepContent(ctx: NarrativeContext, stepId: string, nodeId?: string): unknown | null {
  // 合并步骤 initial_plan：返回 outline + core_settings + plot_synopsis 聚合对象
  // （否则按 STEP_CTX_KEY[initial_plan] 只能拿到 outline 一段，前端编辑器会丢失另外两段）
  if (stepId === "initial_plan" && !nodeId) {
    const data = getStepDataForFile(stepId, ctx);
    return data ?? null;
  }
  const ctxKey = STEP_CTX_KEY[stepId];
  if (!ctxKey) return null;
  const stepData = (ctx as Record<string, unknown>)[ctxKey];
  if (stepData == null) return null;
  if (!nodeId) return stepData;

  const extractor = PER_NODE_STEPS[stepId];
  if (!extractor) return stepData;
  const nodes = extractor(stepData);
  const match = nodes.find(n => n.id === nodeId);
  return match?.content ?? null;
}

function patchCtxNodeContent(ctx: NarrativeContext, stepId: string, nodeId: string, editedContent: unknown): boolean {
  const ctxKey = STEP_CTX_KEY[stepId];
  if (!ctxKey) return false;
  const stepData = (ctx as Record<string, unknown>)[ctxKey] as Record<string, unknown> | undefined;
  if (!stepData) return false;

  if (stepId === "story_framework") {
    const sf = stepData as unknown as StoryFramework;
    const idx = sf.framework?.nodes?.findIndex(n => n.node_id === nodeId);
    if (idx != null && idx >= 0 && sf.framework?.nodes) {
      sf.framework.nodes[idx] = editedContent as typeof sf.framework.nodes[0];
      return true;
    }
  } else if (stepId === "outline_batch") {
    const og = stepData as unknown as OutlinesGenerated;
    const idx = og.outlines?.findIndex(n => n.node_id === nodeId);
    if (idx != null && idx >= 0 && og.outlines) {
      og.outlines[idx] = editedContent as typeof og.outlines[0];
      return true;
    }
  } else if (stepId === "detailed_outline") {
    const dg = stepData as unknown as DetailedOutlinesGenerated;
    const idx = dg.detailed_outlines?.findIndex(n => n.node_id === nodeId);
    if (idx != null && idx >= 0 && dg.detailed_outlines) {
      dg.detailed_outlines[idx] = editedContent as typeof dg.detailed_outlines[0];
      return true;
    }
  } else if (stepId === "plot_generation") {
    const pg = stepData as unknown as PlotsGenerated;
    const idx = pg.plots?.findIndex(p => p.node_id === nodeId);
    if (idx != null && idx >= 0 && pg.plots) {
      pg.plots[idx] = editedContent as typeof pg.plots[0];
      return true;
    }
  } else if (stepId === "script_generation") {
    const js = stepData as unknown as JrpgScript;
    const idx = js.chapters?.findIndex(ch => (ch.chapter_id ?? ch.plot_node_id) === nodeId);
    if (idx != null && idx >= 0 && js.chapters) {
      js.chapters[idx] = editedContent as typeof js.chapters[0];
      return true;
    }
  } else if (stepId === "quest_generation") {
    const qg = stepData as unknown as QuestGraph;
    const idx = qg.quests?.findIndex(q => q.quest_id === nodeId);
    if (idx != null && idx >= 0 && qg.quests) {
      qg.quests[idx] = editedContent as typeof qg.quests[0];
      return true;
    }
  } else if (stepId === "scene_generation") {
    const sm = stepData as unknown as SceneMap;
    if (sm._phase2_per_node && nodeId in sm._phase2_per_node) {
      (sm._phase2_per_node as Record<string, unknown>)[nodeId] = editedContent;
      return true;
    }
  }
  return false;
}

// ── Save step/node edit API (read-only: returns original content for frontend draft) ──

app.post("/api/narrative/save-step-edit", (req, res) => {
  const { sourceDir, stepId, nodeId } = req.body as {
    sourceDir?: string;
    stepId?: string;
    nodeId?: string;
  };

  if (!sourceDir?.trim() || !stepId?.trim()) {
    res.status(400).json({ error: "sourceDir and stepId are required" });
    return;
  }

  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }

  const currentContent = resolveStepContent(checkpoint.ctx, stepId, nodeId);

  res.json({
    ok: true,
    stepId,
    nodeId,
    originalContent: currentContent,
  });
});

// ── Get edits for a run directory ──

app.get("/api/narrative/edits/:dir", (req, res) => {
  const dir = req.params.dir;
  if (!dir?.trim()) {
    res.status(400).json({ error: "dir is required" });
    return;
  }
  const edits = loadEditsState(dir);
  res.json(edits);
});

// ── Restore original content (no-op: edits are frontend-only drafts now) ──

app.post("/api/narrative/restore-original", (req, res) => {
  const { stepId, nodeId } = req.body as {
    sourceDir?: string;
    stepId?: string;
    nodeId?: string;
  };

  res.json({ ok: true, stepId, nodeId });
});

// ── Analyze impact: diff + LLM analysis → affected steps ──

function generateTextDiff(original: unknown, modified: unknown): string {
  const origStr = typeof original === "string" ? original : JSON.stringify(original, null, 2);
  const modStr = typeof modified === "string" ? modified : JSON.stringify(modified, null, 2);
  if (origStr === modStr) return "(no changes)";

  const origLines = origStr.split("\n");
  const modLines = modStr.split("\n");
  const diff: string[] = [];
  const maxLen = Math.max(origLines.length, modLines.length);
  for (let i = 0; i < maxLen; i++) {
    const ol = origLines[i];
    const ml = modLines[i];
    if (ol === ml) continue;
    if (ol != null && ml == null) diff.push(`- ${ol}`);
    else if (ol == null && ml != null) diff.push(`+ ${ml}`);
    else if (ol !== ml) { diff.push(`- ${ol}`); diff.push(`+ ${ml}`); }
  }
  return diff.slice(0, 200).join("\n") + (diff.length > 200 ? "\n...(truncated)" : "");
}

function buildStepDAGDescription(mode: ModeId, ctx?: NarrativeContext): string {
  try {
    const config = getModeConfig(mode);
    const entries = [...config.steps];
    if (config.isDynamic && ctx) {
      const autoOpts = { genreCode: ctx.demand_analysis?.genre_code };
      if (ctx.narrative_requirements) {
        const autoSteps = buildAutoSteps(ctx.narrative_requirements, autoOpts);
        const existing = new Set(entries.flatMap(e => Array.isArray(e) ? e : [e]));
        for (const s of autoSteps) {
          if (!existing.has(s)) entries.push(s);
        }
      } else if (ctx.demand_analysis) {
        const syntheticReq = {
          needs: (ctx.demand_analysis as unknown as Record<string, unknown>).narrative_needs,
        } as import("../types/game-design.js").NarrativeRequirements;
        const autoSteps = buildAutoSteps(syntheticReq, autoOpts);
        const existing = new Set(entries.flatMap(e => Array.isArray(e) ? e : [e]));
        for (const s of autoSteps) {
          if (!existing.has(s)) entries.push(s);
        }
      }
    }
    const lines: string[] = [];
    let order = 1;
    for (const entry of entries) {
      if (Array.isArray(entry)) {
        lines.push(`${order}. [并行] ${entry.join(", ")}`);
      } else {
        lines.push(`${order}. ${entry}`);
      }
      order++;
    }
    return lines.join("\n");
  } catch {
    return "(mode config not available)";
  }
}

app.post("/api/narrative/analyze-impact", async (req, res) => {
  const { sourceDir, modifications } = req.body as {
    sourceDir?: string;
    modifications?: Array<{
      stepId: string;
      nodeId?: string;
      editedContent?: unknown;
      userInput?: string;
    }>;
  };

  if (!sourceDir?.trim()) {
    res.status(400).json({ error: "sourceDir is required" });
    return;
  }
  if (!modifications?.length) {
    res.status(400).json({ error: "modifications array is required" });
    return;
  }

  const checkpoint = loadCheckpoint(sourceDir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${sourceDir}` });
    return;
  }

  const mode = checkpoint.mode ?? "full";
  const dagDescription = buildStepDAGDescription(mode, checkpoint.ctx);

  // ── Build diff sections ──
  const diffSections: string[] = [];
  const stepMetaMap = checkpoint.step_meta ?? {};

  for (const mod of modifications) {
    const metaKey = mod.nodeId ? `${mod.stepId}::${mod.nodeId}` : mod.stepId;
    const matchingKeys = mod.nodeId
      ? [metaKey]
      : Object.keys(stepMetaMap).filter(k => k === mod.stepId || k.startsWith(`${mod.stepId}::`));

    if (matchingKeys.length === 0) matchingKeys.push(metaKey);

    for (const mk of matchingKeys) {
      const meta = stepMetaMap[mk];
      const latest = meta?.modifications?.[meta.modifications.length - 1];

      const nodeIdFromKey = mk.includes("::") ? mk.split("::")[1] : mod.nodeId;
      const original = latest?.original
        ?? loadOriginalContent(sourceDir, mod.stepId, nodeIdFromKey)
        ?? resolveStepContent(checkpoint.ctx, mod.stepId, nodeIdFromKey);
      const modified = latest?.edited
        ?? mod.editedContent
        ?? resolveStepContent(checkpoint.ctx, mod.stepId, nodeIdFromKey);

      const diff = generateTextDiff(original, modified);
      const header = nodeIdFromKey
        ? `步骤: ${mod.stepId}, 节点: ${nodeIdFromKey}`
        : `步骤: ${mod.stepId}`;
      const userFeedback = (latest?.userInstructions || mod.userInput)
        ? `\n用户反馈: ${latest?.userInstructions ?? mod.userInput}`
        : "";
      diffSections.push(`### ${header}${userFeedback}\n\`\`\`diff\n${diff}\n\`\`\``);
    }
  }

  // ── Resolve pipeline steps ──
  const allSteps: string[] = [];
  try {
    const config = getModeConfig(mode);
    for (const entry of config.steps) {
      if (Array.isArray(entry)) allSteps.push(...entry);
      else allSteps.push(entry);
    }
    if (config.isDynamic && checkpoint.ctx) {
      const autoOpts = { genreCode: checkpoint.ctx.demand_analysis?.genre_code };
      if (checkpoint.ctx.narrative_requirements) {
        const autoSteps = buildAutoSteps(checkpoint.ctx.narrative_requirements, autoOpts);
        const existing = new Set(allSteps);
        for (const s of autoSteps) {
          if (!existing.has(s)) allSteps.push(s);
        }
      } else if (checkpoint.ctx.demand_analysis) {
        const syntheticReq = {
          needs: (checkpoint.ctx.demand_analysis as unknown as Record<string, unknown>).narrative_needs,
        } as import("../types/game-design.js").NarrativeRequirements;
        const autoSteps = buildAutoSteps(syntheticReq, autoOpts);
        const existing = new Set(allSteps);
        for (const s of autoSteps) {
          if (!existing.has(s)) allSteps.push(s);
        }
      }
    }
  } catch { /* fallback below */ }

  const modifiedStepIds = [...new Set(modifications.map(m => m.stepId))];
  const completedSteps = checkpoint.completedSteps ?? [];
  const downstreamSteps = allSteps.filter(s => {
    const sIdx = allSteps.indexOf(s);
    return modifiedStepIds.some(ms => allSteps.indexOf(ms) <= sIdx);
  });

  // ── Static node-level subtree impacts ──
  const modifiedNodeIds = modifications
    .filter(m => m.nodeId)
    .map(m => ({ stepId: m.stepId, nodeId: m.nodeId! }));
  const staticNodeImpacts: Array<{ stepId: string; nodeIds: string[] }> = [];
  if (modifiedNodeIds.length > 0) {
    const byStep = new Map<string, string[]>();
    for (const m of modifiedNodeIds) {
      const arr = byStep.get(m.stepId) ?? [];
      arr.push(m.nodeId);
      byStep.set(m.stepId, arr);
    }
    for (const [stepId, nodeIds] of byStep) {
      const impacts = traceNodeSubtree(stepId, nodeIds, checkpoint.ctx);
      for (const imp of impacts) {
        if (imp.affectedNodeIds.length > 0) {
          staticNodeImpacts.push({ stepId: imp.stepId, nodeIds: imp.affectedNodeIds });
        }
      }
    }
  }

  // ── Pre-classify changes (heuristic, per-modification diff) ──
  const changeClassifications = modifications.map((m, idx) => ({
    stepId: m.stepId,
    nodeId: m.nodeId,
    classification: preClassifyChange(m.stepId, m.userInput, diffSections[idx] ?? ""),
  }));
  // Aggregate: structural wins over content over cosmetic
  const categoryPriority = { structural: 2, content: 1, cosmetic: 0 } as const;
  const dominantCategory = changeClassifications.reduce(
    (best, c) => categoryPriority[c.classification.category] > categoryPriority[best] ? c.classification.category : best,
    "cosmetic" as keyof typeof categoryPriority,
  );
  const dominantClassification = changeClassifications.find(c => c.classification.category === dominantCategory)
    ?? changeClassifications[0];

  // ── Build knowledge-enriched prompt (only steps relevant to this analysis) ──
  // Include: modified steps + first 5 downstream + their declared inputs (upstream context)
  const relevantKbSteps = [...new Set([
    ...modifiedStepIds,
    ...downstreamSteps.slice(0, 5),
    ...modifiedStepIds.flatMap(id => PIPELINE_KNOWLEDGE[id]?.inputs ?? []),
  ])];
  const knowledgeSection = buildKnowledgePromptSection(relevantKbSteps, false);
  const nodeTreeSection = buildNodeTreeSummary(checkpoint.ctx);

  const systemPrompt = `你是叙事内容管线的【影响面分析 Agent】。你的任务是精确判断用户修改的影响范围，并制定最优重跑计划。

# 你的专业知识

${knowledgeSection}

# 当前管线状态

管线步骤序列（模式: ${mode}）:
${dagDescription}

已完成步骤: ${completedSteps.join(", ")}
被修改步骤: ${modifiedStepIds.join(", ")}

${nodeTreeSection}

# 变更预分类

系统预判断此变更为【${dominantCategory === "structural" ? "结构性变更" : dominantCategory === "cosmetic" ? "格式性变更" : "内容性变更"}】（置信度: ${dominantClassification?.classification.confidence.toFixed(2) ?? "N/A"}）
信号: ${dominantClassification?.classification.signals.join("; ") ?? "无"}

请验证或纠正此预判断。

# 分析规则

1. **被修改步骤本身需要重跑** — 用户可能只编辑了部分内容或提供了新需求指令
2. **验证步骤跟随父步骤** — structure_validation_* 总是跟随其父步骤重跑
3. **格式性变更可跳过下游** — 仅措辞/格式微调且无额外需求 → 下游不受影响
4. **内容性变更影响直接下游** — 修改了具体信息 → 依赖该信息的直接下游步骤重跑
5. **结构性变更需要上游回溯** — 改变了"故事讲什么"→ 必须从最早受影响的上游开始重构
6. **节点级精确性** — 如果修改的是某个具体节点，分析其子树（通过 parent_id 追踪）是否足够，还是影响同层其他节点
7. **跨步骤引用追踪** — 如果修改涉及角色名/道具名/场景名，追踪所有引用该名称的下游步骤
8. **并行步骤独立** — 并行步骤之间互不影响，除非有显式数据依赖（参考依赖图）
9. **判断实质影响** — 区分"改了标签/名称"（不影响内容逻辑）和"改了实质内容"（影响下游生成质量）

# 回溯判断标准

- 改变"讲什么"（结局/主线/角色命运/新增主要情节/删除核心元素）→ 回溯到 story_framework 或更早
- 改变"怎么讲"（措辞/细节/对话风格/格式）→ 只影响当前步骤及直接下游
- 改变"全局设定"（世界观规则/时代/核心循环）→ 回溯到 worldview/core_settings

# 输出格式

请返回 JSON:
{
  "changeCategory": "structural" | "content" | "cosmetic",
  "affectedSteps": ["需要重新生成的步骤ID列表（可含上游步骤）"],
  "canSkip": ["确定可以跳过的步骤ID列表"],
  "nodeLevel": true/false,
  "nodeImpacts": [{"stepId": "xxx", "nodeIds": ["affected_node_ids"]}] | null,
  "rerunFrom": "建议从哪个步骤开始重跑",
  "reasoning": "详细解释分析逻辑：变更类型判断→传播路径→最终决策",
  "confidence": 0.0-1.0
}`;

  const userPrompt = `# 用户修改内容

${diffSections.join("\n\n")}

# 静态子树追踪结果（基于 parent_id）

${staticNodeImpacts.length > 0
    ? staticNodeImpacts.map(imp => `${imp.stepId}: 受影响节点 [${imp.nodeIds.join(", ")}]`).join("\n")
    : "无节点级修改或无节点追踪结果"
  }

# 可能受影响的下游步骤（基于 DAG 顺序）

${downstreamSteps.join(", ")}

请基于你的管线知识，分析实际影响面。注意：静态追踪只考虑了 parent_id 结构关系，你需要额外考虑内容引用关系（如角色名出现在多个步骤中）。`;

  try {
    const llm = new LLMClient({
      apiKey: API_KEY || undefined,
      proxyUrl: LLM_PROXY_URL || undefined,
      proxyApiKey: LLM_PROXY_KEY || undefined,
      defaultModel: getDefaultModel(),
    });

    console.warn("[analyze-impact] changeCategory:", dominantCategory, "confidence:", dominantClassification?.classification.confidence);
    console.warn("[analyze-impact] modifications:", JSON.stringify(modifications.map(m => ({ stepId: m.stepId, nodeId: m.nodeId, userInput: m.userInput?.slice(0, 80) }))));

    const raw = await llm.call(systemPrompt, userPrompt, {
      temperature: 0.1,
      responseFormat: "json",
    });

    console.warn("[analyze-impact] LLM raw response:", raw.slice(0, 600));

    let analysis: {
      changeCategory?: string;
      affectedSteps: string[];
      canSkip: string[];
      reasoning: string;
      nodeLevel?: boolean;
      nodeImpacts?: Array<{ stepId: string; nodeIds: string[] }> | null;
      rerunFrom?: string;
      confidence?: number;
    };
    try {
      analysis = JSON.parse(raw);
    } catch {
      analysis = {
        affectedSteps: downstreamSteps,
        canSkip: [],
        reasoning: "LLM 返回格式解析失败，降级为全量下游重跑",
      };
    }

    console.warn("[analyze-impact] result:", {
      category: analysis.changeCategory,
      affected: analysis.affectedSteps,
      rerunFrom: analysis.rerunFrom,
      reasoning: analysis.reasoning?.slice(0, 200),
    });

    // Gap D：结构化校验 — 限制 LLM 上游回溯不超过合理边界
    // 1) cosmetic 不允许回溯；2) content 允许回溯 1 层；3) structural 允许回溯到叙事根
    // 4) modifications 必须在 affectedSteps 中；5) canSkip 不能与 mod / affected 冲突
    // 注：若 LLM 没给 nodeImpacts，回退到 staticNodeImpacts；validateImpactAnalysis 内部
    //     会再过滤一次，确保 nodeImpacts.stepId 都落在 safeAffected 里。
    const mergedNodeImpactsRaw = analysis.nodeImpacts ?? (staticNodeImpacts.length > 0 ? staticNodeImpacts : null);
    const validated = validateImpactAnalysis(
      { ...analysis, nodeImpacts: mergedNodeImpactsRaw },
      modifiedStepIds,
      dominantCategory as ChangeCategory,
      allSteps,
      analysis.changeCategory,
    );
    if (validated.warnings.length > 0) {
      console.warn("[analyze-impact] validation warnings:");
      for (const w of validated.warnings) console.warn("  -", w);
    }
    const useNodeLevel = analysis.nodeLevel !== false && validated.nodeImpacts != null;

    res.json({
      affectedSteps: validated.affectedSteps,
      canSkip: validated.canSkip,
      reasoning: analysis.reasoning,
      changeCategory: analysis.changeCategory ?? dominantCategory,
      rerunFrom: analysis.rerunFrom ?? (validated.affectedSteps.length > 0 ? validated.affectedSteps[0] : undefined),
      confidence: analysis.confidence,
      mode,
      pipelineOrder: allSteps,
      modifications: modifications.map(m => ({ stepId: m.stepId, nodeId: m.nodeId })),
      nodeImpacts: useNodeLevel ? validated.nodeImpacts : null,
      // 透出校验诊断信息，便于前端 / 调试时看到 LLM 越界
      validationWarnings: validated.warnings,
      earliestAllowedStep: validated.earliestAllowedStep,
    });
  } catch (err) {
    console.error("[analyze-impact] LLM analysis failed, falling back to DAG:", err);
    res.json({
      affectedSteps: downstreamSteps,
      canSkip: [],
      reasoning: `LLM分析失败(${(err as Error).message})，降级为静态DAG下游全量重跑`,
      changeCategory: dominantCategory,
      rerunFrom: downstreamSteps[0],
      mode,
      pipelineOrder: allSteps,
      fallback: true,
      nodeImpacts: staticNodeImpacts.length > 0 ? staticNodeImpacts : null,
    });
  }
});

// ── Story tree: dynamic node structure query ──

interface StoryTreeNode {
  id: string;
  name: string;
  parentId?: string;
  stepId: string;
  layer: number;
}

interface StoryTreeLayer {
  stepId: string;
  layer: number;
  nodes: StoryTreeNode[];
}

app.get("/api/narrative/story-tree/:dir", (req, res) => {
  const dir = req.params.dir;
  if (!dir?.trim()) {
    res.status(400).json({ error: "dir is required" });
    return;
  }

  const checkpoint = loadCheckpoint(dir);
  if (!checkpoint) {
    res.status(404).json({ error: `No checkpoint found in ${dir}` });
    return;
  }

  const ctx = checkpoint.ctx;
  const layers: StoryTreeLayer[] = [];

  // L0: story_framework
  const fwNodes = ctx.story_framework?.framework?.nodes ?? [];
  if (fwNodes.length > 0) {
    layers.push({
      stepId: "story_framework",
      layer: 0,
      nodes: fwNodes.map(n => ({
        id: n.node_id,
        name: n.name ?? n.node_id,
        stepId: "story_framework",
        layer: 0,
      })),
    });
  }

  // L1: outline_batch
  const outlines = ctx.outlines_generated?.outlines ?? [];
  if (outlines.length > 0) {
    layers.push({
      stepId: "outline_batch",
      layer: 1,
      nodes: outlines.map(n => ({
        id: n.node_id,
        name: n.name ?? n.node_id,
        parentId: n.parent_id,
        stepId: "outline_batch",
        layer: 1,
      })),
    });
  }

  // L2: detailed_outline
  const detailed = ctx.detailed_outlines_generated?.detailed_outlines ?? [];
  if (detailed.length > 0) {
    layers.push({
      stepId: "detailed_outline",
      layer: 2,
      nodes: detailed.map((n) => ({
        id: n.node_id,
        name: (n as unknown as Record<string, unknown>).name as string ?? n.node_id,
        parentId: n.parent_id,
        stepId: "detailed_outline",
        layer: 2,
      })),
    });
  }

  // L3: plot_generation
  const plots = ctx.plots_generated?.plots ?? [];
  if (plots.length > 0) {
    layers.push({
      stepId: "plot_generation",
      layer: 3,
      nodes: plots.map(n => ({
        id: n.node_id,
        name: n.node_id,
        parentId: n.parent_id,
        stepId: "plot_generation",
        layer: 3,
      })),
    });
  }

  // L4: script_generation
  const chapters = ctx.jrpg_script?.chapters ?? [];
  if (chapters.length > 0) {
    layers.push({
      stepId: "script_generation",
      layer: 4,
      nodes: chapters.map(c => ({
        id: c.plot_node_id ?? c.node_id,
        name: c.chapter_id ?? c.node_id,
        parentId: c.plot_node_id ?? c.node_id,
        stepId: "script_generation",
        layer: 4,
      })),
    });
  }

  // L5: quest_generation
  const quests = ctx.quest_graph?.quests ?? [];
  if (quests.length > 0) {
    layers.push({
      stepId: "quest_generation",
      layer: 5,
      nodes: quests.map(q => ({
        id: q.quest_id,
        name: q.quest_id,
        parentId: q.story_node_id,
        stepId: "quest_generation",
        layer: 5,
      })),
    });
  }

  // L6: scene_generation
  const sceneMap = ctx.scene_map as Record<string, unknown> | undefined;
  const p2 = sceneMap?._phase2_per_node as Record<string, unknown> | undefined;
  if (p2) {
    layers.push({
      stepId: "scene_generation",
      layer: 6,
      nodes: Object.keys(p2).map(k => ({
        id: k,
        name: k,
        stepId: "scene_generation",
        layer: 6,
      })),
    });
  }

  res.json({
    dir,
    completedSteps: checkpoint.completedSteps ?? [],
    layers,
  });
});

function loadReviewState(dir: string): ReviewState {
  const reviewPath = path.join(OUTPUT_DIR, dir, "_review.json");
  if (fs.existsSync(reviewPath)) {
    try {
      return JSON.parse(fs.readFileSync(reviewPath, "utf-8"));
    } catch { /* corrupt file */ }
  }
  return { entries: [], updatedAt: new Date().toISOString() };
}

function saveReviewState(dir: string, state: ReviewState): void {
  const dirPath = path.join(OUTPUT_DIR, dir);
  fs.mkdirSync(dirPath, { recursive: true });
  state.updatedAt = new Date().toISOString();
  writeAssetFile(dirPath, "_review.json", state);
}

app.get("/api/narrative/review/:dir", (req, res) => {
  const dir = req.params.dir;
  if (!dir?.trim()) {
    res.status(400).json({ error: "dir is required" });
    return;
  }
  const review = loadReviewState(dir);
  res.json(review);
});

app.post("/api/narrative/review/:dir", (req, res) => {
  const dir = req.params.dir;
  const { stepId, status: reviewStatus, feedback, regenerateRunId } = req.body as {
    stepId?: string;
    status?: "pending" | "approved" | "rejected";
    feedback?: string;
    regenerateRunId?: string;
  };

  if (!dir?.trim() || !stepId?.trim() || !reviewStatus) {
    res.status(400).json({ error: "dir, stepId, and status are required" });
    return;
  }

  const review = loadReviewState(dir);
  const existing = review.entries.findIndex((e) => e.stepId === stepId);
  const entry: ReviewEntry = {
    stepId,
    status: reviewStatus,
    feedback: feedback?.trim() || undefined,
    reviewedAt: new Date().toISOString(),
    regenerateRunId,
  };

  if (existing >= 0) {
    review.entries[existing] = entry;
  } else {
    review.entries.push(entry);
  }

  saveReviewState(dir, review);
  res.json({ ok: true, entry, review });
});

app.post("/api/narrative/cancel/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (state.status !== "running") {
    res.json({ id: state.id, status: state.status, message: "Not running" });
    return;
  }
  state.status = "failed";
  state.error = "用户取消生成";
  try { writeManifestIncremental(state); } catch { /* best effort */ }
  try { saveRunToFile(state); } catch (e) { console.error("Failed to save cancelled run:", e); }
  res.json({ id: state.id, status: "cancelled", message: "Run cancelled" });
});

app.get("/api/narrative/status/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json({
    id: state.id,
    status: state.status,
    progress: state.progress,
    error: state.error,
    startedAt: state.startedAt,
    tier: state.tier,
    mode: state.mode,
  });
});

app.get("/api/narrative/result/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (state.status === "running") {
    res.json({ id: state.id, status: "running", message: "Still running" });
    return;
  }
  const entryKey = state.outputDir ? path.basename(state.outputDir) : formatTimestamp(state.startedAt);
  res.json({
    id: state.id,
    status: state.status,
    result: state.result,
    error: state.error,
    sourceDir: entryKey,
  });
});

const IGNORED_DIRS = new Set(["assets", "node_modules"]);

interface HistoryItem {
  key: string;
  type: "dir" | "file";
  id: string | null;
  tier?: string;
  mode?: string;
  status?: string;
  startedAt?: string;
  completedAt?: string;
  fileCount?: number;
  hasCheckpoint: boolean;
  hasEdits: boolean;
  lastCompletedStep: string | null;
  completedSteps: string[] | null;
  canResume: boolean;
  canLoad: boolean;
  userInput?: string;
  routeGroup?: "planning" | "narrative";
  complexity?: number;
  parentKey?: string;
  forkReason?: string;
  /** 运行类型标记（"ip-dna" = IP DNA 摄入/改编运行；缺省为普通叙事/策划运行）。 */
  kind?: string;
}

const INPUT_DIR = path.resolve(process.cwd(), "input");

/** IP DNA 输入侧资产清单（input/<runId>/user_asset_manifest.json），用于无 output 清单时回填历史。 */
function loadIpDnaInputManifest(dir: string): { story_id?: string; title?: string; media_type?: string; processing_status?: string; created_at?: string } | undefined {
  try {
    const p = path.join(INPUT_DIR, dir, "user_asset_manifest.json");
    if (!fs.existsSync(p)) return undefined;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return undefined;
  }
}

/** output 运行目录是否已落生成产物（game_unit_*.json）。 */
function outputHasGameUnits(dir: string): boolean {
  try {
    return fs.readdirSync(path.join(OUTPUT_DIR, dir)).some((f) => /^game_unit_.*\.json$/.test(f));
  } catch {
    return false;
  }
}

/**
 * 该 key 是否存在 IP DNA 输入侧资产（用于历史可见性兜底，§5.1）：
 * user_asset_manifest.json（摄入即写）或 _extraction_output/_hierarchy.json（标准化后写）。
 * 半自动 ingest 不写 output 运行清单，故仅凭输入侧资产也要能在 LIST 列出中断的运行。
 */
function loadIpInputDescriptor(
  key: string,
): { story_id?: string; title?: string; media_type?: string; created_at?: string; hasHierarchy: boolean } | undefined {
  const uam = loadIpDnaInputManifest(key);
  let hier: { story_id?: string; title?: string; media_type?: string } | undefined;
  try { hier = loadHierarchyIndexByRun(key) as typeof hier; } catch { hier = undefined; }
  if (!uam && !hier) return undefined;
  return {
    story_id: uam?.story_id ?? hier?.story_id,
    title: uam?.title ?? hier?.title,
    media_type: uam?.media_type ?? hier?.media_type,
    created_at: uam?.created_at,
    hasHierarchy: !!hier,
  };
}

/** 由 IP 输入侧描述符构造一条 ip-dna 历史条目（output 无运行清单时的兜底）。 */
function buildIpDnaHistoryItem(
  key: string,
  desc: NonNullable<ReturnType<typeof loadIpInputDescriptor>>,
  activeIpJob: boolean,
  hasEdits: boolean,
): HistoryItem {
  const hasUnits = outputHasGameUnits(key);
  const status = activeIpJob ? "running" : hasUnits ? "completed" : "interrupted";
  const hasFullResult = fs.existsSync(path.join(OUTPUT_DIR, key, "full_result.json"));
  return {
    key,
    type: "dir",
    id: desc.story_id ?? null,
    status,
    startedAt: desc.created_at,
    fileCount: undefined,
    hasCheckpoint: false,
    hasEdits,
    lastCompletedStep: null,
    completedSteps: null,
    canResume: false,
    // 有层级树即可被 IP 回放（§6 历史还原输入模块）或加载已生成产物。
    canLoad: hasFullResult || desc.hasHierarchy,
    userInput: desc.title,
    kind: "ip-dna",
  };
}

function parseFilenameEntry(filename: string): HistoryItem | null {
  const match = filename.match(/^(.+?)_(tier\d|auto)_(.+)\.json$/);
  if (!match) return null;
  const [, ts, tierPart, modePart] = match;
  const filePath = path.join(OUTPUT_DIR, filename);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return {
      key: filename,
      type: "file",
      id: raw.id ?? null,
      tier: raw.tier ?? tierPart,
      mode: raw.mode ?? modePart,
      status: raw.status ?? "completed",
      startedAt: raw.startedAt ?? ts.replace(/T/, " ").replace(/-/g, ":"),
      completedAt: raw.completedAt,
      fileCount: undefined,
      hasCheckpoint: false,
      hasEdits: false,
      lastCompletedStep: null,
      completedSteps: null,
      canResume: false,
      canLoad: !!raw.result,
      userInput: raw.userInput ?? raw.result?.user_input,
      routeGroup: raw.routeGroup,
      complexity: raw.complexity,
    };
  } catch {
    return null;
  }
}

function dirHasEdits(dir: string): boolean {
  const checkpoint = loadCheckpoint(dir);
  if (checkpoint?.step_meta) {
    if (Object.values(checkpoint.step_meta).some(m => m.modifications.length > 0)) return true;
  }
  const editsPath = path.join(OUTPUT_DIR, dir, "_edits.json");
  if (!fs.existsSync(editsPath)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(editsPath, "utf-8"));
    return Array.isArray(data.edits) && data.edits.length > 0;
  } catch { return false; }
}

function parseDirEntry(dir: string): HistoryItem {
  const manifestPath = path.join(OUTPUT_DIR, dir, "manifest.json");
  const checkpoint = loadCheckpoint(dir);
  const hasFullResult = fs.existsSync(path.join(OUTPUT_DIR, dir, "full_result.json"));
  const hasEdits = dirHasEdits(dir);

  const activeRun = [...runs.values()].find((r) => {
    if (r.outputDir) return path.basename(r.outputDir) === dir;
    return formatTimestamp(r.startedAt) === dir;
  });

  // IP DNA 运行不进 runs Map，其活跃态由进程内 job 注册表反映（重启即清）。
  // 匹配 runId（=<story_timestamp>_<title>）前缀，避免把"正在跑"的运行误判为 interrupted。
  const activeIpJob = [...listJobs()].find(
    (j) =>
      (j.status === "running" || j.status === "awaiting_confirmation") &&
      j.story_timestamp &&
      dir.startsWith(j.story_timestamp),
  );

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    let effectiveStatus: string;
    if (activeRun) {
      effectiveStatus = activeRun.status;
    } else if (activeIpJob) {
      effectiveStatus = "running";
    } else if (raw.status === "running") {
      effectiveStatus = "interrupted";
    } else {
      effectiveStatus = raw.status;
    }
    return {
      key: dir,
      type: "dir",
      id: raw.runId ?? activeRun?.id ?? null,
      tier: raw.tier,
      mode: raw.mode,
      status: effectiveStatus,
      startedAt: raw.startedAt,
      completedAt: raw.completedAt,
      fileCount: raw.files?.length ?? 0,
      hasCheckpoint: !!checkpoint,
      hasEdits,
      lastCompletedStep: checkpoint?.lastCompletedStep ?? null,
      completedSteps: migrateLegacyCompletedSteps(checkpoint?.completedSteps ?? raw.completedSteps ?? null),
      canResume: !!checkpoint && effectiveStatus !== "completed" && effectiveStatus !== "running",
      canLoad: hasFullResult || !!checkpoint,
      userInput: raw.userInput ?? activeRun?.userInput,
      routeGroup: raw.routeGroup ?? activeRun?.routeGroup,
      complexity: raw.complexity ?? activeRun?.complexity,
      parentKey: raw.parentKey ?? undefined,
      forkReason: raw.forkReason ?? undefined,
      kind: raw.kind ?? undefined,
    };
  } catch {
    // 无 output 运行清单：先尝试用 IP DNA 输入侧资产回填（user_asset_manifest.json 或 _hierarchy.json）。
    // 否则它们会因 catch 落到 "unknown"。状态：进行中 job→running；已落生成产物→completed；否则→interrupted。
    const ipDesc = loadIpInputDescriptor(dir);
    if (ipDesc) {
      return buildIpDnaHistoryItem(dir, ipDesc, !!activeIpJob, hasEdits);
    }
    const effectiveStatus = activeRun ? activeRun.status
      : checkpoint ? "interrupted" : "unknown";
    return {
      key: dir,
      type: "dir",
      id: activeRun?.id ?? (checkpoint as any)?.runId ?? null,
      tier: activeRun?.tier ?? (checkpoint as any)?.tier,
      mode: activeRun?.mode ?? (checkpoint as any)?.mode,
      status: effectiveStatus,
      startedAt: activeRun?.startedAt ?? (checkpoint as any)?.startedAt,
      hasCheckpoint: !!checkpoint,
      hasEdits,
      lastCompletedStep: checkpoint?.lastCompletedStep ?? null,
      completedSteps: migrateLegacyCompletedSteps(checkpoint?.completedSteps ?? activeRun?.completedSteps ?? null),
      canResume: !!checkpoint && effectiveStatus !== "running",
      canLoad: hasFullResult || !!checkpoint,
      userInput: activeRun?.userInput ?? (checkpoint as any)?.userInput,
      routeGroup: activeRun?.routeGroup ?? (checkpoint as any)?.routeGroup,
      complexity: activeRun?.complexity ?? (checkpoint as any)?.complexity,
      parentKey: activeRun?.parentKey,
      forkReason: activeRun?.forkReason,
    };
  }
}

/** 列出本地保存的历史记录（扫描子目录 + 平铺 JSON 文件） */
app.get("/api/narrative/history", (_req, res) => {
  try {
    const all = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
    const items: HistoryItem[] = [];

    const outputKeys = new Set<string>();
    for (const entry of all) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        outputKeys.add(entry.name);
        items.push(parseDirEntry(entry.name));
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        const item = parseFilenameEntry(entry.name);
        if (item) items.push(item);
      }
    }

    // 输入侧 IP 运行兜底（§5.1 历史可见性）：半自动 ingest 不写 output 运行清单，
    // 摄入后即中断的运行只在 input/<key> 留痕（user_asset_manifest.json / _hierarchy.json）。
    // 扫 INPUT_DIR，把无 output 对应项的 IP 运行也列入 LIST（中断仍可见、可回放）。
    try {
      const inputDirs = fs.readdirSync(INPUT_DIR, { withFileTypes: true });
      for (const entry of inputDirs) {
        if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
        if (outputKeys.has(entry.name)) continue; // output 侧已覆盖
        const desc = loadIpInputDescriptor(entry.name);
        if (!desc) continue; // 非运行目录（book/picture/video/package/user_input 等模态根目录）
        const activeIpJob = [...listJobs()].some(
          (j) =>
            (j.status === "running" || j.status === "awaiting_confirmation") &&
            j.story_timestamp &&
            entry.name.startsWith(j.story_timestamp),
        );
        items.push(buildIpDnaHistoryItem(entry.name, desc, activeIpJob, dirHasEdits(entry.name)));
      }
    } catch { /* input 目录不存在则跳过 */ }

    items.sort((a, b) => {
      const ka = a.startedAt ?? a.key;
      const kb = b.startedAt ?? b.key;
      return kb.localeCompare(ka);
    });

    res.json(items);
  } catch {
    res.json([]);
  }
});

/**
 * IP 前驱步骤序（与前端 IpStageFlow/TierModeSelector 的 ip_* step id 对齐，§6 SSOT）。
 * 历史回放时若该 output run 关联 IP DNA 输入，则把这段拼到生成链头部，
 * 使顶栏与中间预览同源消费的 pipelineOrder 含完整 IP 段（动态 C 序号由前端按出现顺序赋予）。
 */
const IP_PREDECESSOR_STEP_IDS = ["ip_input", "ip_standardize", "ip_volume", "ip_adapt_plan", "ip_dna_extract"];

/** 该 output key 是否关联 IP DNA 输入（input/<key>/_extraction_output/_hierarchy.json 存在）。 */
function withIpPredecessorOrder(key: string, order: string[] | undefined): string[] | undefined {
  let hasIp = false;
  try { hasIp = !!loadHierarchyIndexByRun(key); } catch { hasIp = false; }
  if (!hasIp) return order;
  const base = order ?? [];
  if (base.some((s) => s.startsWith("ip_"))) return base; // 已含 IP 段则不重复拼接
  return [...IP_PREDECESSOR_STEP_IDS, ...base.filter((s) => !IP_PREDECESSOR_STEP_IDS.includes(s))];
}

/** 加载历史记录的完整结果（支持目录和平铺 JSON） */
app.get("/api/narrative/history/:key/load", (req, res) => {
  const key = req.params.key;

  if (key.endsWith(".json")) {
    const filePath = path.join(OUTPUT_DIR, key);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      res.json({
        id: raw.id ?? key,
        tier: raw.tier,
        mode: raw.mode,
        status: raw.status ?? "completed",
        result: raw.result ?? null,
        userInput: raw.userInput ?? raw.result?.user_input,
        routeGroup: raw.routeGroup,
        complexity: raw.complexity,
        // Phase 1: 把启动管线的完整参数与权威步骤序透传给前端。
        genre_code:
          raw.genre_code ??
          (raw.result?.tier_detection?.genre_code !== "manual"
            ? raw.result?.tier_detection?.genre_code
            : undefined) ??
          raw.result?.demand_analysis?.genre_code,
        pipelineOrder: withIpPredecessorOrder(key.replace(/\.json$/, ""), raw.pipelineOrder),
        routingMode: raw.routingMode,
      });
    } catch {
      res.status(500).json({ error: "Failed to parse file" });
    }
    return;
  }

  const dirPath = path.join(OUTPUT_DIR, key);
  const fullResultPath = path.join(dirPath, "full_result.json");
  const checkpoint = loadCheckpoint(key);

  const manifestPath = path.join(dirPath, "manifest.json");
  let manifest: Record<string, unknown> = {};
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch { /* no manifest */ }

  // Strip output fields for steps that did not actually complete.
  // This ensures "后端有什么就展示什么" — only truly completed data is returned.
  // Must handle overlapping field mappings (e.g. script_scene_generation shares
  // fields with script_generation / scene_generation).
  const stripIncompleteFields = (
    ctx: NarrativeContext,
    runStatus: string | undefined,
    completedSteps: string[] | null,
  ): NarrativeContext => {
    if (runStatus === "completed" || !completedSteps?.length) return ctx;
    const clean = { ...ctx } as Record<string, unknown>;
    // D5: migrate legacy step IDs before computing protected fields
    const migrated = migrateLegacyCompletedSteps(completedSteps);
    const doneSet = new Set(migrated);
    const protectedFields = new Set<string>();
    for (const sid of migrated) {
      const f = STEP_OUTPUT_FIELDS[sid];
      if (f) for (const field of f) protectedFields.add(field);
    }
    for (const [stepId, fields] of Object.entries(STEP_OUTPUT_FIELDS)) {
      if (!doneSet.has(stepId)) {
        for (const field of fields) {
          if (!protectedFields.has(field)) delete clean[field];
        }
      }
    }
    return clean as NarrativeContext;
  };

  if (fs.existsSync(fullResultPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(fullResultPath, "utf-8"));
      if (data.result) {
        const rawCtx = (checkpoint && checkpoint.ctx) ? checkpoint.ctx : data.result;
        const completedStepsRaw = checkpoint?.completedSteps
          ?? (manifest.completedSteps as string[] | undefined)
          ?? null;
        const completedSteps = migrateLegacyCompletedSteps(completedStepsRaw);
        data.result = stripIncompleteFields(rawCtx, data.status, completedSteps);
        data.completedSteps = completedSteps;
        data.stepMeta = checkpoint?.step_meta ?? null;
        // Phase 1: 把 checkpoint / manifest 持久化的启动管线快照透传给前端。
        // 来源优先级：checkpoint > manifest > full_result raw > ctx 兜底。
        data.genre_code =
          checkpoint?.genre_code ??
          (manifest.genre_code as string | undefined) ??
          data.genre_code ??
          (rawCtx?.tier_detection?.genre_code !== "manual"
            ? rawCtx?.tier_detection?.genre_code
            : undefined) ??
          rawCtx?.demand_analysis?.genre_code;
        data.pipelineOrder = withIpPredecessorOrder(
          key,
          checkpoint?.pipelineOrder ??
            (manifest.pipelineOrder as string[] | undefined) ??
            data.pipelineOrder,
        );
        data.routingMode =
          checkpoint?.routingMode ??
          (manifest.routingMode as "auto" | "semi" | "manual" | undefined) ??
          data.routingMode;
        res.json(data);
        return;
      }
    } catch { /* fall through to checkpoint */ }
  }

  if (checkpoint && checkpoint.ctx) {
    const runStatus = (manifest.status as string) === "completed" ? "completed" : "interrupted";
    const completedStepsRaw = checkpoint.completedSteps
      ?? (manifest.completedSteps as string[] | undefined)
      ?? null;
    const completedSteps = migrateLegacyCompletedSteps(completedStepsRaw);
    res.json({
      id: checkpoint.runId ?? manifest.runId,
      tier: checkpoint.tier ?? manifest.tier,
      mode: checkpoint.mode ?? manifest.mode,
      status: runStatus,
      result: stripIncompleteFields(checkpoint.ctx, runStatus, completedSteps),
      completedSteps,
      userInput: checkpoint.userInput ?? manifest.userInput,
      routeGroup: checkpoint.routeGroup ?? manifest.routeGroup,
      complexity: checkpoint.complexity ?? manifest.complexity,
      stepMeta: checkpoint.step_meta ?? null,
      // Phase 1: 把 checkpoint 持久化的启动管线快照带回前端。
      genre_code:
        checkpoint.genre_code ??
        (manifest.genre_code as string | undefined) ??
        (checkpoint.ctx.tier_detection?.genre_code !== "manual"
          ? checkpoint.ctx.tier_detection?.genre_code
          : undefined) ??
        checkpoint.ctx.demand_analysis?.genre_code,
      pipelineOrder: withIpPredecessorOrder(
        key,
        checkpoint.pipelineOrder ?? (manifest.pipelineOrder as string[] | undefined),
      ),
      routingMode:
        checkpoint.routingMode ??
        (manifest.routingMode as "auto" | "semi" | "manual" | undefined),
    });
    return;
  }

  res.status(404).json({ error: "No loadable data found" });
});

/**
 * Returns narrative pipeline state as standard Workbench PipelineState.nodes.
 * This endpoint is consumed by the platform's pipeline status mechanism.
 */
app.get("/api/narrative/pipeline-nodes/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const statusMap = new Map(
    state.progress.map((p) => [p.stepId ?? p.stage, p.status])
  );

  const nodes = state.progress
    .filter((p, i, arr) => {
      const sid = p.stepId ?? p.stage;
      return arr.findIndex((x) => (x.stepId ?? x.stage) === sid) === i;
    })
    .map((p) => {
      const stepId = p.stepId ?? p.stage;
      const latest = statusMap.get(stepId) ?? "pending";
      const wbStatus =
        latest === "completed" ? "done" :
        latest === "running" ? "ai_producing" :
        latest === "failed" ? "needs_rework" : "not_started";
      return {
        id: `narrative:${stepId}`,
        pipelineId: "narrative",
        entityId: "main_story",
        phaseId: stepId,
        status: wbStatus,
        agentSessionId: state.id,
      };
    });

  res.json({
    pipelineId: "narrative",
    runId: state.id,
    runStatus: state.status,
    tier: state.tier,
    mode: state.mode,
    nodes,
  });
});

/**
 * Export narrative results as structured project assets.
 * Writes to a specified directory or returns the asset manifest.
 * This endpoint is used by the agent/platform to persist narrative
 * outputs into the project's `assets/narrative/` directory.
 */
app.post("/api/narrative/export/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (state.status !== "completed" || !state.result) {
    res.status(400).json({ error: "Run not completed" });
    return;
  }

  const { target_dir } = req.body as { target_dir?: string };
  const exportDir = target_dir
    ? path.resolve(target_dir, "assets/narrative")
    : getRunDir(state);
  fs.mkdirSync(exportDir, { recursive: true });

  const ctx = state.result;
  const files: string[] = [];

  for (const [stepId, fileDef] of Object.entries(STEP_FILE_MAP)) {
    const data = getStepDataForFile(stepId, ctx);
    if (data != null) {
      const filename = `${fileDef.index}_${fileDef.name}.${fileDef.ext}`;
      writeAssetFile(exportDir, filename, data);
      files.push(filename);
    }
  }

  writeAssetFile(exportDir, "manifest.json", {
    runId: state.id,
    tier: state.tier,
    mode: state.mode,
    exportedAt: new Date().toISOString(),
    files,
  });

  console.log(`📦 Exported ${files.length} assets to ${exportDir}`);
  res.json({ exported: files.length, dir: exportDir, files });
});

// ---------------------------------------------------------------------------
// Per-node atomic file saving (used by pipeline steps via ctx._saveNode)
// ---------------------------------------------------------------------------

function saveNodeFile(
  state: RunState,
  stepId: string,
  nodeId: string,
  data: unknown,
): void {
  try {
    const fileDef = STEP_FILE_MAP[stepId];
    if (!fileDef) return;
    const runDir = getRunDir(state);
    const subDir = path.join(runDir, `${fileDef.index}_${fileDef.name}`);
    fs.mkdirSync(subDir, { recursive: true });
    const safeId = String(nodeId).replace(/[/\\?%*:|"<>]/g, "_");
    const ext = typeof data === "string" ? "md" : "json";
    writeAssetFile(subDir, `${safeId}.${ext}`, data);
  } catch (e) {
    console.error(`[saveNodeFile] ${stepId}/${nodeId}:`, e);
  }
}

// ---------------------------------------------------------------------------
// File listing and reading APIs (for frontend file-pool watcher)
// ---------------------------------------------------------------------------

function listRunFiles(runDir: string, prefix = ""): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(path.join(runDir, prefix), { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...listRunFiles(runDir, rel));
      } else if (entry.isFile()) {
        files.push(rel);
      }
    }
  } catch { /* dir may not exist yet */ }
  return files;
}

app.get("/api/narrative/files/:runId", (req, res) => {
  const state = runs.get(req.params.runId);
  if (!state) {
    const dirPath = path.join(OUTPUT_DIR, req.params.runId);
    if (fs.existsSync(dirPath)) {
      res.json({ files: listRunFiles(dirPath) });
      return;
    }
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const runDir = getRunDir(state);
  res.json({ files: listRunFiles(runDir) });
});

app.get("/api/narrative/file/:runId/{*filePath}", (req, res) => {
  const runId = req.params.runId;
  const rawPath = (req.params as unknown as Record<string, unknown>).filePath;
  const filePath = Array.isArray(rawPath) ? rawPath.join("/") : String(rawPath ?? "");

  let runDir: string;
  const state = runs.get(runId);
  if (state) {
    runDir = getRunDir(state);
  } else {
    runDir = path.join(OUTPUT_DIR, runId);
  }

  const fullPath = path.join(runDir, filePath);
  if (!fullPath.startsWith(runDir)) {
    res.status(403).json({ error: "Path traversal denied" });
    return;
  }
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  try {
    const content = fs.readFileSync(fullPath, "utf-8");
    if (fullPath.endsWith(".json")) {
      res.json(JSON.parse(content));
    } else {
      res.type("text/plain").send(content);
    }
  } catch {
    res.status(500).json({ error: "Failed to read file" });
  }
});

app.get("/api/narrative/stream/:id", (req, res) => {
  const state = runs.get(req.params.id);
  if (!state) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let lastIndex = 0;
  let lastStreamIndex = 0;
  let heartbeatCounter = 0;
  const HEARTBEAT_EVERY = 30; // every 15s (30 * 500ms)

  const interval = setInterval(() => {
    while (lastIndex < state.progress.length) {
      res.write(`data: ${JSON.stringify(state.progress[lastIndex])}\n\n`);
      lastIndex++;
      heartbeatCounter = 0;
    }
    while (lastStreamIndex < state.streamBuffer.length) {
      res.write(`data: ${JSON.stringify(state.streamBuffer[lastStreamIndex])}\n\n`);
      lastStreamIndex++;
      heartbeatCounter = 0;
    }
    if (state.status !== "running") {
      res.write(`data: ${JSON.stringify({ type: "done", status: state.status, error: state.error })}\n\n`);
      clearInterval(interval);
      res.end();
      return;
    }
    heartbeatCounter++;
    if (heartbeatCounter >= HEARTBEAT_EVERY) {
      res.write(`: keepalive\n\n`);
      heartbeatCounter = 0;
    }
  }, 500);

  req.on("close", () => clearInterval(interval));
});

const MAX_RUN_AGE_MS = 30 * 60 * 1000;
const MAX_RUNNING_AGE_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, state] of runs) {
    const age = now - new Date(state.startedAt).getTime();
    if (state.status !== "running" && age > MAX_RUN_AGE_MS) {
      runs.delete(id);
    } else if (state.status === "running" && age > MAX_RUNNING_AGE_MS) {
      state.status = "failed";
      state.error = "Pipeline timed out (exceeded 1 hour)";
    }
  }
}, 60_000);

function cleanupStaleRunningManifests(): void {
  if (!fs.existsSync(OUTPUT_DIR)) return;
  let patched = 0;
  for (const dir of fs.readdirSync(OUTPUT_DIR)) {
    const manifestPath = path.join(OUTPUT_DIR, dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      if (raw.status === "running") {
        raw.status = "interrupted";
        raw.completedAt = raw.updatedAt ?? new Date().toISOString();
        fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2));
        patched++;
      }
    } catch { /* ignore corrupted manifests */ }
  }
  if (patched > 0) {
    console.log(`🔧 Cleaned up ${patched} stale 'running' manifest(s) → 'interrupted'`);
  }
}

/**
 * IP DNA 端到端入口（蓝图 §5）：上传/指定文件 → 标准化 → IP DNA → 改编指令 → A→B 映射 →（可选）生成。
 * 同步返回（提取+映射通常秒级；run_generation=true 时会跑生成管线，可能较久）。
 *
 * 入参（JSON）：
 *   files: [{ file_name, content?, content_base64?, encoding?, file_type?, role? }]
 *   title?, mode?("single"|"series"), scope_full?(默认 true), target_units?,
 *   run_generation?(默认 false), max_game_units?, tier?, generation_mode?, complexity?, model?
 */
app.post("/api/narrative/ip-dna/start", async (req, res) => {
  const body = req.body as {
    files?: Array<{
      file_name?: string;
      content?: string;
      content_base64?: string;
      encoding?: "utf8" | "base64-docx";
      file_type?: string;
      role?: string;
    }>;
    title?: string;
    mode?: "single" | "series";
    scope_full?: boolean;
    /** 嵌套裁剪选择（§4.4 第①步对话产物）：提供则按精确选择裁剪，覆盖 scope_full。 */
    scope_selections?: import("../ip-dna/index.js").AdaptationScopeSelection[];
    /** 用户精确选填的游戏单元规划（§4.4 第②步对话产物）：提供则覆盖默认切分。 */
    game_unit_plan?: import("../ip-dna/index.js").GameUnitPlan;
    /** 用户精确选填的改编维度（§4.4 第③步对话产物）：提供则覆盖默认全维度模板。 */
    adaptation_dimensions?: Partial<import("../ip-dna/index.js").AdaptationDimensions>;
    /** 作者自定义改编补充说明（§5.1 自由文本）：合并进 directive.adaptation_notes 并追加下游 userInput。 */
    adaptation_notes?: string;
    target_units?: number;
    run_generation?: boolean;
    max_game_units?: number;
    pipeline_family?: "rpg" | "vn";
    tier?: TierId;
    generation_mode?: ModeId;
    /** 路由组（planning/narrative）：ROUTING 透传（§5.1），与主管线 start 对齐。 */
    route_group?: "planning" | "narrative";
    /** 品类编码（如 "rpg-jrpg"/"adv-interactive"）：scoped 生成路由依据，决定 pipeline_family（§5.1/§L）。 */
    genre_code?: string;
    complexity?: number;
    model?: string;
    /** 超体量时执行拆解闭环（§5.0 9→10→1）。默认 false。 */
    decompose?: boolean;
    /** 断点续传（§14.2）：复用已持久化 IP DNA，跳过重建+提取。默认 false。 */
    resume?: boolean;
    /** 为每个游戏单元装备三视角算子并一步消费（§7.2b）。默认 false。 */
    equip_operators?: boolean;
    /** 构建 KAG 关系网络并注入生成（§8）。默认 true。 */
    inject_relations?: boolean;
    /** 异步执行（§11）：true 则立即返回 jobId，后台跑管线，前端轮询 /ip-dna/job/:jobId。 */
    async?: boolean;
    /** 指定完整故事时间戳（续跑/对齐 jobId 用）；不传则服务端生成。 */
    story_timestamp?: string;
  };

  if (!body.files?.length) {
    res.status(400).json({ error: "files is required（至少一个文件，含 content 或 content_base64）" });
    return;
  }

  // 解析入站文件为中性 IncomingFile（docx 走 mammoth）。
  const incoming: IncomingFile[] = [];
  for (const f of body.files) {
    let data: string | Buffer = "";
    try {
      if (f.encoding === "base64-docx" && f.content_base64) {
        const buf = Buffer.from(f.content_base64, "base64");
        const mammoth = await import("mammoth");
        data = (await mammoth.extractRawText({ buffer: buf })).value ?? "";
      } else if (f.content != null) {
        data = f.content;
      } else if (f.content_base64) {
        data = Buffer.from(f.content_base64, "base64");
      }
    } catch (e) {
      console.warn(`[Server] ip-dna file parse failed: ${(e as Error).message}`);
    }
    incoming.push({
      fileName: f.file_name ?? `file_${incoming.length + 1}.txt`,
      data,
      fileType: f.file_type ?? "text/plain",
      role: f.role,
    });
  }

  // LLM 接缝：有 key 才走 LLM 提取，否则 orchestrator 自动用确定性兜底。
  const llm = (API_KEY || LLM_PROXY_URL)
    ? new LLMClient({
        apiKey: API_KEY || undefined,
        proxyUrl: LLM_PROXY_URL || undefined,
        defaultModel: body.model ?? getDefaultModel(),
      })
    : undefined;

  // 嵌套裁剪：有 selections 走精确选择；否则默认全量（scope_full=false 也仅在无 selections 时回退默认）。
  const scope = body.scope_selections?.length
    ? { full: false, selections: body.scope_selections }
    : { full: true };
  // 固定 story_timestamp，使 jobId 与 input/output 落盘对齐（续跑/轮询一致）。
  const fixedTimestamp = body.story_timestamp ?? formatIpDnaTimestamp(new Date().toISOString());

  // ROUTING 透传（§5.1/§L）：显式 genre_code → 锁定生成管线品类；并据其模板派生 pipeline_family，
  // 避免改编选 vn 仍误跑 rpg 层级链。pipeline_family 显式给定时优先。
  const explicitGenre = typeof body.genre_code === "string" && body.genre_code.trim().length > 0
    ? body.genre_code.trim()
    : undefined;
  const familyFromGenre: "rpg" | "vn" | undefined = explicitGenre
    ? (findGenreByCode(explicitGenre)?.pipelineTemplate?.includes("vn") ? "vn" : "rpg")
    : undefined;
  const effectiveFamily = body.pipeline_family ?? familyFromGenre;

  const buildOptions = (onProgress?: (e: IpDnaProgress) => void, runtime?: Awaited<ReturnType<typeof resolveIpDnaRuntimeAdapters>>) => ({
    files: incoming,
    title: body.title,
    story_timestamp: fixedTimestamp,
    mode: body.mode,
    scope,
    gameUnitPlan: body.game_unit_plan,
    dimensions: body.adaptation_dimensions,
    adaptationNotes: typeof body.adaptation_notes === "string" ? body.adaptation_notes : undefined,
    pipelineFamily: effectiveFamily,
    targetUnits: body.target_units,
    targetComplexity: body.complexity,
    llm,
    queryEmbedder: runtime?.queryEmbedder,
    frameSampler: runtime?.frameSampler,
    transcriber: runtime?.transcriber,
    mediaCompressor: runtime?.mediaCompressor,
    archiveExtractor: runtime?.archiveExtractor,
    pdfPageSplitter: runtime?.pdfPageSplitter,
    runGeneration: body.run_generation === true,
    decompose: body.decompose === true,
    resume: body.resume === true,
    equipOperators: body.equip_operators === true,
    injectRelations: body.inject_relations,
    maxGameUnits: body.max_game_units,
    tier: body.tier,
    generationMode: body.generation_mode,
    pipelineConfig: {
      apiKey: API_KEY || undefined,
      proxyUrl: LLM_PROXY_URL || undefined,
      model: body.model ?? getDefaultModel(),
      complexity: body.complexity,
      // 显式品类锁定生成管线模板（buildGenerationPipelineConfig 仅在未设时才用 family 代表品类兜底）。
      ...(explicitGenre ? { genreCode: explicitGenre } : {}),
    },
    onProgress,
  });

  const summarize = (result: Awaited<ReturnType<typeof runIpDnaPipeline>>) => ({
    story_timestamp: result.story_timestamp,
    title: result.title,
    media_type: result.manifest.media_type,
    node_count: Object.keys(result.dna.nodes).length,
    directive: result.directive,
    // D3 提取质量闸门（§14.2）：层级连通/三件套齐全/核心要素/五大类算子覆盖统计。
    // 非阻断，随结果透出供平台/前端展示与告警。
    extraction_quality: result.extractionQuality,
    game_units: result.gameUnits.map((gu) => ({
      index: gu.index,
      leaf_ids: gu.leafIds,
      operator_count: gu.operatorPool.length,
      generation_input: gu.generationInput,
      output_dir: gu.outputDir ? path.basename(gu.outputDir) : undefined,
      generated: !!gu.generated,
    })),
  });

  // ── 异步契约（§11）：立即返回 jobId，后台跑管线并经 updateJob 回写 stage/progress。──
  if (body.async === true) {
    const job = createJob({ story_timestamp: fixedTimestamp, stage: "pending" });
    res.status(202).json({ jobId: job.jobId, story_timestamp: fixedTimestamp, status: job.status });
    void (async () => {
      try {
        updateJob(job.jobId, { status: "running", stage: "phase0" });
        const runtime = await resolveIpDnaRuntimeAdapters(process.env);
        const result = await runIpDnaPipeline(buildOptions((e) => {
          updateJob(job.jobId, {
            status: "running",
            stage: e.phase,
            progress: Math.round((e.ratio ?? 0) * 100),
            message: e.message,
          });
        }, runtime));
        updateJob(job.jobId, { status: "completed", stage: "done", progress: 100, result: summarize(result) });
      } catch (e) {
        console.error("[Server] ip-dna async pipeline failed:", e);
        updateJob(job.jobId, { status: "failed", error: (e as Error).message });
      }
    })();
    return;
  }

  // ── 同步模式（默认，向后兼容现有调用方/工具桥）。──
  try {
    // RAG 生产接通（批2 h3）：与 CLI 共用 helper 注入本地向量化查询器 + 视频抽帧器。
    // 有 e5 模型/HTTP 端点 → 开 RAG vector 通道；无 → 静默降级 scope+tag（corpus 仍可用）。
    const runtime = await resolveIpDnaRuntimeAdapters(process.env);
    const result = await runIpDnaPipeline(buildOptions(undefined, runtime));
    res.json(summarize(result));
  } catch (e) {
    console.error("[Server] ip-dna pipeline failed:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

// ─────────────────────────────────────────────────────────────────
// 阶段门端点（§5.1 半自动）：ingest → hierarchy → (decompose) → confirm-scope/units → extract/generate。
// 每个阶段独立调用、落盘续跑；与 /ip-dna/start（全自动）共存。前端按钮与平台 agent 工具共用。
// ─────────────────────────────────────────────────────────────────

/** 解析入站文件为中性 IncomingFile（docx 走 mammoth；base64 二进制透传）。 */
async function parseIpDnaIncoming(
  files: Array<{ file_name?: string; content?: string; content_base64?: string; encoding?: "utf8" | "base64-docx"; file_type?: string; role?: string }>,
): Promise<IncomingFile[]> {
  const incoming: IncomingFile[] = [];
  for (const f of files) {
    let data: string | Buffer = "";
    try {
      if (f.encoding === "base64-docx" && f.content_base64) {
        const buf = Buffer.from(f.content_base64, "base64");
        const mammoth = await import("mammoth");
        data = (await mammoth.extractRawText({ buffer: buf })).value ?? "";
      } else if (f.content != null) {
        data = f.content;
      } else if (f.content_base64) {
        data = Buffer.from(f.content_base64, "base64");
      }
    } catch (e) {
      console.warn(`[Server] ip-dna file parse failed: ${(e as Error).message}`);
    }
    incoming.push({
      fileName: f.file_name ?? `file_${incoming.length + 1}.txt`,
      data,
      fileType: f.file_type ?? "text/plain",
      role: f.role,
    });
  }
  return incoming;
}

/** 构建 IP DNA LLM 接缝（有 key/proxy 才启用，否则确定性兜底）。 */
function ipDnaLlm(model?: string): LLMClient | undefined {
  return (API_KEY || LLM_PROXY_URL)
    ? new LLMClient({ apiKey: API_KEY || undefined, proxyUrl: LLM_PROXY_URL || undefined, defaultModel: model ?? getDefaultModel() })
    : undefined;
}

/** 把 IngestResult 摘要成给 UI/agent 的可读结构（层级树 + 体量 + 默认裁剪/单元 + 干扰过滤）。 */
function summarizeIngest(ingest: Awaited<ReturnType<typeof runIngest>>) {
  return {
    story_timestamp: ingest.story_timestamp,
    run_id: `${ingest.story_timestamp}_${ingest.title}`,
    title: ingest.title,
    media_type: ingest.media_type,
    node_count: Object.keys(ingest.dna.nodes).length,
    hierarchy: Object.values(ingest.dna.nodes).map((n) => ({
      id: n.id, levelType: n.levelType, index: n.index, title: n.title, parent: n.parent, children: n.children, childRange: n.childRange,
    })),
    volume: ingest.volume,
    decomposition: ingest.decomposition,
    noise_filtered: ingest.noise.filteredTitles,
    default_scope: ingest.defaultDirective.adaptation_scope,
    default_game_unit_plan: ingest.defaultDirective.game_unit_plan,
    default_dimensions: ingest.defaultDirective.dimensions,
    awaiting: "confirm-scope",
  };
}

/**
 * 阶段一：摄入 + 标准化 + 建树（§5 步骤 0→1→2），停在确认门。
 * async=true 立即返回 jobId（status=awaiting_confirmation，result=层级树摘要）；否则同步返回摘要。
 */
app.post("/api/narrative/ip-dna/ingest", async (req, res) => {
  const body = req.body as {
    files?: Array<{ file_name?: string; content?: string; content_base64?: string; encoding?: "utf8" | "base64-docx"; file_type?: string; role?: string }>;
    title?: string;
    decompose?: boolean;
    model?: string;
    async?: boolean;
    story_timestamp?: string;
  };
  if (!body.files?.length) {
    res.status(400).json({ error: "files is required（至少一个文件，含 content 或 content_base64）" });
    return;
  }
  const incoming = await parseIpDnaIncoming(body.files);
  const llm = ipDnaLlm(body.model);
  const fixedTimestamp = body.story_timestamp ?? formatIpDnaTimestamp(new Date().toISOString());
  const buildIngestOptions = (onProgress?: (e: IpDnaProgress) => void, runtime?: Awaited<ReturnType<typeof resolveIpDnaRuntimeAdapters>>) => ({
    files: incoming,
    title: body.title,
    story_timestamp: fixedTimestamp,
    decompose: body.decompose === true,
    llm,
    queryEmbedder: runtime?.queryEmbedder,
    frameSampler: runtime?.frameSampler,
    transcriber: runtime?.transcriber,
    mediaCompressor: runtime?.mediaCompressor,
    archiveExtractor: runtime?.archiveExtractor,
    pdfPageSplitter: runtime?.pdfPageSplitter,
    onProgress,
  });

  if (body.async === true) {
    const job = createJob({ story_timestamp: fixedTimestamp, stage: "pending" });
    res.status(202).json({ jobId: job.jobId, story_timestamp: fixedTimestamp, status: job.status });
    void (async () => {
      try {
        updateJob(job.jobId, { status: "running", stage: "phase0" });
        const runtime = await resolveIpDnaRuntimeAdapters(process.env);
        const ingest = await runIngest(buildIngestOptions((e) => {
          updateJob(job.jobId, { status: "running", stage: e.phase, progress: Math.round((e.ratio ?? 0) * 100), message: e.message });
        }, runtime));
        updateJob(job.jobId, { status: "awaiting_confirmation", stage: "standardized", progress: 40, message: "标准化完成，等待确认裁剪范围", result: summarizeIngest(ingest) });
      } catch (e) {
        console.error("[Server] ip-dna ingest failed:", e);
        updateJob(job.jobId, { status: "failed", error: (e as Error).message });
      }
    })();
    return;
  }

  try {
    const runtime = await resolveIpDnaRuntimeAdapters(process.env);
    const ingest = await runIngest(buildIngestOptions(undefined, runtime));
    res.json(summarizeIngest(ingest));
  } catch (e) {
    console.error("[Server] ip-dna ingest failed:", e);
    res.status(500).json({ error: (e as Error).message });
  }
});

/** 只读：层级树 + 默认裁剪/单元/维度 + 体量/拆解建议（供 UI/agent 引导确认裁剪范围）。 */
app.get("/api/narrative/ip-dna/:runId/hierarchy", (req, res) => {
  const source = loadExtractSourceByRun(req.params.runId);
  if (!source) {
    res.status(404).json({ error: `未找到层级树：${req.params.runId}（请先 ingest）` });
    return;
  }
  const directive = buildAdaptationDirective(source.dna, {});
  const volume = assessVolume(source.fullText, { mediaType: source.media_type, unitCount: collectLeafIds(source.dna).length });
  const confirmation = loadAdaptationConfirmation(source.story_timestamp, source.title) ?? {};
  res.json({
    story_timestamp: source.story_timestamp,
    run_id: req.params.runId,
    title: source.title,
    media_type: source.media_type,
    node_count: Object.keys(source.dna.nodes).length,
    hierarchy: Object.values(source.dna.nodes).map((n) => ({
      id: n.id, levelType: n.levelType, index: n.index, title: n.title, parent: n.parent, children: n.children, childRange: n.childRange,
    })),
    volume,
    default_scope: directive.adaptation_scope,
    default_game_unit_plan: directive.game_unit_plan,
    default_dimensions: directive.dimensions,
    confirmation,
  });
});

/** 拆解（§5 步骤 6-10）：体量超线时按标记/单元闭环拆解 → 再标准化 → 重写骨架层级树。 */
app.post("/api/narrative/ip-dna/:runId/decompose", (req, res) => {
  const source = loadExtractSourceByRun(req.params.runId);
  if (!source) {
    res.status(404).json({ error: `未找到层级树：${req.params.runId}（请先 ingest）` });
    return;
  }
  const volume = assessVolume(source.fullText, { mediaType: source.media_type, unitCount: collectLeafIds(source.dna).length });
  const plan = planDecomposition(source.fullText, volume, true);
  const closure = applyDecompositionClosure(source.dna, source.fullText, true);
  try { saveHierarchyIndexOnly(source.dna, {}); } catch { /* 落盘失败不阻断 */ }
  res.json({
    run_id: req.params.runId,
    decomposed: plan.decomposed,
    chunk_count: plan.chunks.length,
    closure,
    node_count: Object.keys(source.dna.nodes).length,
    hierarchy: Object.values(source.dna.nodes).map((n) => ({
      id: n.id, levelType: n.levelType, index: n.index, title: n.title, parent: n.parent, children: n.children, childRange: n.childRange,
    })),
  });
});

/** ① 确认裁剪范围（§4.4 第①步）：回填 scope_selections（嵌套层级选择），缺省=全量。 */
app.post("/api/narrative/ip-dna/:runId/confirm-scope", (req, res) => {
  const source = loadExtractSourceByRun(req.params.runId);
  if (!source) {
    res.status(404).json({ error: `未找到层级树：${req.params.runId}（请先 ingest）` });
    return;
  }
  const body = req.body as { scope_selections?: unknown[]; scope_full?: boolean; adaptation_notes?: string };
  const notes = typeof body.adaptation_notes === "string" ? body.adaptation_notes.trim() : "";
  const merged = saveAdaptationConfirmation(source.story_timestamp, source.title, {
    scope_selections: body.scope_selections ?? [],
    scope_full: body.scope_full ?? !(body.scope_selections && body.scope_selections.length > 0),
    ...(notes ? { adaptation_notes: notes } : {}),
  });
  res.json({ run_id: req.params.runId, confirmation: merged, awaiting: "confirm-units" });
});

/** ② 确认游戏单元 + 改编维度（§4.4 第②③步）：回填 game_unit_plan / adaptation_dimensions / mode。 */
app.post("/api/narrative/ip-dna/:runId/confirm-units", (req, res) => {
  const source = loadExtractSourceByRun(req.params.runId);
  if (!source) {
    res.status(404).json({ error: `未找到层级树：${req.params.runId}（请先 ingest）` });
    return;
  }
  const body = req.body as { game_unit_plan?: unknown; adaptation_dimensions?: unknown; mode?: "single" | "series"; target_units?: number };
  const merged = saveAdaptationConfirmation(source.story_timestamp, source.title, {
    game_unit_plan: body.game_unit_plan,
    adaptation_dimensions: body.adaptation_dimensions,
    mode: body.mode,
    target_units: body.target_units,
  });
  res.json({ run_id: req.params.runId, confirmation: merged, awaiting: "extract|generate" });
});

/** 构建 extract/generate 阶段的编排选项（消费已确认态 + 生成控制）。 */
function buildStageExtractOptions(
  source: ExtractSource,
  body: { run_generation?: boolean; pipeline_family?: "rpg" | "vn"; tier?: TierId; generation_mode?: ModeId; complexity?: number; model?: string; max_game_units?: number; equip_operators?: boolean; inject_relations?: boolean },
  onProgress?: (e: IpDnaProgress) => void,
  runtime?: Awaited<ReturnType<typeof resolveIpDnaRuntimeAdapters>>,
) {
  const c = loadAdaptationConfirmation(source.story_timestamp, source.title) ?? {};
  const selections = (c.scope_selections as import("../ip-dna/index.js").AdaptationScopeSelection[] | undefined) ?? [];
  const scope = selections.length ? { full: false, selections } : { full: true };
  const llm = ipDnaLlm(body.model);
  return {
    files: [] as IncomingFile[],
    title: source.title,
    story_timestamp: source.story_timestamp,
    mode: (c.mode as "single" | "series" | undefined),
    scope,
    gameUnitPlan: c.game_unit_plan as import("../ip-dna/index.js").GameUnitPlan | undefined,
    dimensions: c.adaptation_dimensions as Partial<import("../ip-dna/index.js").AdaptationDimensions> | undefined,
    adaptationNotes: c.adaptation_notes as string | undefined,
    targetUnits: c.target_units as number | undefined,
    targetComplexity: body.complexity,
    pipelineFamily: body.pipeline_family,
    llm,
    queryEmbedder: runtime?.queryEmbedder,
    frameSampler: runtime?.frameSampler,
    transcriber: runtime?.transcriber,
    mediaCompressor: runtime?.mediaCompressor,
    archiveExtractor: runtime?.archiveExtractor,
    pdfPageSplitter: runtime?.pdfPageSplitter,
    runGeneration: body.run_generation === true,
    equipOperators: body.equip_operators === true,
    injectRelations: body.inject_relations,
    maxGameUnits: body.max_game_units,
    tier: body.tier,
    generationMode: body.generation_mode,
    pipelineConfig: { apiKey: API_KEY || undefined, proxyUrl: LLM_PROXY_URL || undefined, model: body.model ?? getDefaultModel(), complexity: body.complexity },
    onProgress,
  };
}

const summarizeExtractGenerate = (result: Awaited<ReturnType<typeof runExtractAndGenerate>>) => ({
  story_timestamp: result.story_timestamp,
  title: result.title,
  media_type: result.manifest.media_type,
  node_count: Object.keys(result.dna.nodes).length,
  directive: result.directive,
  extraction_quality: result.extractionQuality,
  game_units: result.gameUnits.map((gu) => ({
    index: gu.index,
    leaf_ids: gu.leafIds,
    operator_count: gu.operatorPool.length,
    generation_input: gu.generationInput,
    output_dir: gu.outputDir ? path.basename(gu.outputDir) : undefined,
    generated: !!gu.generated,
  })),
});

/** ③ 生成 scoped IP DNA（§5 步骤 4，run_generation=false）：仅提取，不跑下游生成。 */
app.post("/api/narrative/ip-dna/:runId/extract", async (req, res) => {
  await runStageExtractGenerate(req, res, false);
});

/** 开始生成（§5 步骤 4→5）：提取(=4 生成 scoped IP DNA) + 下游生成自动串跑，run_generation=true。 */
app.post("/api/narrative/ip-dna/:runId/generate", async (req, res) => {
  await runStageExtractGenerate(req, res, true);
});

/** extract/generate 共用执行体（async 走 job，同步直接返回摘要）。 */
async function runStageExtractGenerate(req: express.Request, res: express.Response, runGeneration: boolean): Promise<void> {
  const runId = String(req.params.runId);
  const source = loadExtractSourceByRun(runId);
  if (!source) {
    res.status(404).json({ error: `未找到层级树：${runId}（请先 ingest + confirm）` });
    return;
  }
  const body = { ...(req.body ?? {}), run_generation: runGeneration } as Parameters<typeof buildStageExtractOptions>[1];
  if ((req.body ?? {}).async === true) {
    const job = createJob({ story_timestamp: source.story_timestamp, stage: "phase2b_adapt" });
    res.status(202).json({ jobId: job.jobId, story_timestamp: source.story_timestamp, status: job.status });
    void (async () => {
      try {
        updateJob(job.jobId, { status: "running", stage: "phase2b_adapt" });
        const runtime = await resolveIpDnaRuntimeAdapters(process.env);
        const opts = buildStageExtractOptions(source, body, (e) => {
          updateJob(job.jobId, { status: "running", stage: e.phase, progress: Math.round((e.ratio ?? 0) * 100), message: e.message });
        }, runtime);
        const result = await runExtractAndGenerate(opts, source);
        updateJob(job.jobId, { status: "completed", stage: "done", progress: 100, result: summarizeExtractGenerate(result) });
      } catch (e) {
        console.error("[Server] ip-dna extract/generate failed:", e);
        updateJob(job.jobId, { status: "failed", error: (e as Error).message });
      }
    })();
    return;
  }
  try {
    const runtime = await resolveIpDnaRuntimeAdapters(process.env);
    const opts = buildStageExtractOptions(source, body, undefined, runtime);
    const result = await runExtractAndGenerate(opts, source);
    res.json(summarizeExtractGenerate(result));
  } catch (e) {
    console.error("[Server] ip-dna extract/generate failed:", e);
    res.status(500).json({ error: (e as Error).message });
  }
}

/** 异步任务轮询（§11）：返回 status/progress/current_stage + 完成后的 result 摘要。 */
app.get("/api/narrative/ip-dna/job/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: `未找到任务：${req.params.jobId}` });
    return;
  }
  res.json({
    jobId: job.jobId,
    story_timestamp: job.story_timestamp,
    status: job.status,
    current_stage: job.stage,
    progress: job.progress,
    message: job.message,
    error: job.error,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    result: job.status === "completed" || job.status === "awaiting_confirmation" ? job.result : undefined,
  });
});

/** 取消生产（§5.1）：标记任务 cancelled，前端/agent 轮询据此终止释放（协作式取消）。 */
app.post("/api/narrative/ip-dna/job/:jobId/cancel", (req, res) => {
  const job = cancelJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: `未找到任务：${req.params.jobId}` });
    return;
  }
  res.json({ jobId: job.jobId, status: job.status });
});

/** 只读：按 runId 读取 IP DNA 层级树摘要（前端审阅/可视化，不可写，§10）。 */
app.get("/api/narrative/ip-dna/:runId", (req, res) => {
  const index = loadHierarchyIndexByRun(req.params.runId);
  if (!index) {
    res.status(404).json({ error: `未找到 IP DNA：${req.params.runId}（input/<runId>/_extraction_output/_hierarchy.json 不存在）` });
    return;
  }
  res.json({
    story_id: index.story_id,
    title: index.title,
    media_type: index.media_type,
    node_count: Object.keys(index.nodes).length,
    hierarchy: Object.values(index.nodes).map((n) => ({
      id: n.id, levelType: n.levelType, index: n.index, title: n.title, parent: n.parent, childRange: n.childRange,
    })),
  });
});

// 改写影响面分析（§10/§15）：定点改动 → 沿 data-atlas 推导受影响下游 + 受影响输入层级节点。
// body: { runId: string, changedKeys: string[] }
app.post("/api/narrative/ip-dna/analyze-impact", (req, res) => {
  const { runId, changedKeys } = (req.body ?? {}) as { runId?: string; changedKeys?: string[] };
  if (!Array.isArray(changedKeys) || changedKeys.length === 0) {
    res.status(400).json({ error: "缺少 changedKeys（atlas 字段 key 数组，如 ['A.characters']）" });
    return;
  }
  const dna = runId ? loadHierarchyIndexByRun(runId) : undefined;
  const impact = analyzeRewriteImpact(changedKeys, dna);
  res.json({ runId: runId ?? null, ...impact });
});

app.listen(PORT, () => {
  cleanupStaleRunningManifests();
  console.log(`🚀 Narrative Studio API v0.4.0 running on http://localhost:${PORT}`);
  console.log(`   Health:     GET  /api/health`);
  console.log(`   Modes:      GET  /api/narrative/modes`);
  console.log(`   Start:      POST /api/narrative/start`);
  console.log(`   IP DNA:     POST /api/narrative/ip-dna/start`);
  console.log(`   IP DNA Job: GET  /api/narrative/ip-dna/job/:jobId`);
  console.log(`   Resume:     POST /api/narrative/resume`);
  console.log(`   Nodes:      GET  /api/narrative/pipeline-nodes/:id`);
  console.log(`   Export:     POST /api/narrative/export/:id`);
  console.log(`   History:    GET  /api/narrative/history`);
  console.log(`   Files:      GET  /api/narrative/files/:runId`);
  console.log(`   File:       GET  /api/narrative/file/:runId/:filePath(*)`);
});

export { app };
