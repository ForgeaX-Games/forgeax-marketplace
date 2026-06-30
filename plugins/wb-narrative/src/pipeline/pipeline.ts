import type {
  NarrativeContext,
  PipelineConfig,
  PipelineProgress,
  TierId,
  ModeId,
  StepMeta,
} from "../types/index.js";
import { LLMClient } from "./llm-client.js";
import { getDefaultModel } from "../utils/plugin-env.js";
import { getModeConfig, TIER_DEFAULT_MODE, STEP_IDS, STEP_OUTPUT_FIELDS } from "./modes.js";
import { detectTier, buildDemandAnalysis } from "./tier-router.js";
import { findGenreByCode } from "../knowledge/genre-taxonomy.js";
import { partialClearNodes, snapshotStepNodes, mergeNodesBack } from "./node-merge.js";
// Auto-register all genre skills (E1+) on import. Side-effect only.
import "../knowledge/game-narrative/skill-bootstrap.js";

// 叙事步骤
import { userPreferenceSummary } from "./steps/user-preference-summary.js";
import { userPreferenceAnalysis } from "./steps/user-preference-analysis.js";
import { initialPlan } from "./steps/initial-plan.js";
import { worldviewConstruction } from "./steps/worldview-construction.js";
import { storyFramework } from "./steps/story-framework.js";
import { outlineBatch } from "./steps/outline-batch.js";
import { detailedOutlineBatch } from "./steps/detailed-outline-batch.js";
import { characterEnrichment } from "./steps/character-enrichment.js";
import { itemDatabase } from "./steps/item-database.js";
import { plotGeneration } from "./steps/plot-generation.js";
import { scriptGeneration } from "./steps/script-generation.js";
import { sceneGeneration } from "./steps/scene-generation.js";
import { scriptSceneGeneration } from "./steps/script-scene-generation.js";
import { narrativeCardGeneration } from "./steps/narrative-card.js";
import { loreGeneration } from "./steps/lore-generation.js";
import { questGeneration } from "./steps/quest-generation.js";
// 向后兼容：旧存档可能仍含这些独立步骤 ID，保留注册使其可被执行
import { initialStoryOutline } from "./steps/initial-story-outline.js";
import { coreSettingsExtraction } from "./steps/core-settings-extraction.js";
import { plotSynopsis } from "./steps/plot-synopsis.js";
import { structureValidationL1, structureValidationL2, structureValidationL3 } from "./steps/structure-validation.js";

// 策划步骤 (D0-D4)
import { coreConcept } from "./design-steps/core-concept.js";
import { systemArchitecture } from "./design-steps/system-architecture.js";
import { systemDetail } from "./design-steps/system-detail.js";
import { valueFramework } from "./design-steps/value-framework.js";
import { designDoc } from "./design-steps/design-doc.js";

// 新管线模板步骤 (B3 stubs)
import { branchTree } from "./steps/branch-tree.js";
import { dialogueScript } from "./steps/dialogue-script.js";
import { cinematicStoryboard } from "./steps/cinematic-storyboard.js";
import { regionDesign } from "./steps/region-design.js";
import { emergentEvent } from "./steps/emergent-event.js";
import { cardLore } from "./steps/card-lore.js";
import { eventPool } from "./steps/event-pool.js";

// 影游叙事 v2 专属管线（tpl-vn-v2）9 个独立 step
import {
  vnLogline,
  vnOutlineActs,
  vnScenes,
  vnBeats,
  vnScriptNormalize,
  vnSegmentConfirm,
  vnBranchedBeats,
  vnStateLedger,
  vnScreenplay,
  vnStoryboard,
} from "./steps/vn-v2/index.js";

// auto 模式步骤组合器
import { buildAutoSteps } from "./design-steps/auto-narrative-builder.js";

// Phase 1: StepDescriptor 注册表（副作用导入，注册所有 step 元数据）
import "./step-registrations.js";
import { STEP_REGISTRY, getStepOutputFields as registryGetOutputFields } from "./step-registry.js";

// Planner engine: needs-driven step selection
import { planPipeline } from "./planner/index.js";
import type { PlannerInput } from "./planner/index.js";

// IP DNA 统一注入适配器（算子/关系/账本 → 消费 step 提示词，§7.2b/§8/§10）
// 注入逻辑下沉到 ip-dna/injection 服务，pipeline 仅薄委托（T5）。
import { prepareInjection } from "../ip-dna/injection/operator-injection.js";

// Blueprint + Agent Framework (Phase 4 integration)
import type { PipelineBlueprint, StepBlueprint } from "./blueprint/types.js";
import { assembleBlueprint } from "./blueprint/assembler.js";
import { hasAgentDef } from "./blueprint/agent-def-registry.js";
import { getRunnerForStructure } from "./blueprint/runners/index.js";
// Side-effect: register AgentDefs + validators
import "./blueprint/agent-def-registrations.js";

export type PipelineStep = (
  ctx: NarrativeContext,
  llm: LLMClient,
) => Promise<void>;

export interface RerunOptions {
  userInstructions?: string;
  stopAfterStep?: string;
  patchedFields?: Partial<NarrativeContext>;
  skipSteps?: string[];
  stepMeta?: Record<string, StepMeta>;
  /** Per-step node filter: stepId → nodeIds to regenerate (others preserved) */
  nodeFilter?: Record<string, string[]>;
}

/**
 * Build concise modification instructions for a given step from upstream step_meta.
 * Only includes modifications from steps that appear BEFORE `currentStepId` in the pipeline.
 */
function collectMetaForStep(
  stepId: string,
  stepMeta: Record<string, StepMeta>,
): StepMeta[] {
  const results: StepMeta[] = [];
  const exact = stepMeta[stepId];
  if (exact && exact.modifications.length > 0) results.push(exact);
  const prefix = `${stepId}::`;
  for (const [key, meta] of Object.entries(stepMeta)) {
    if (key.startsWith(prefix) && meta.modifications.length > 0) results.push(meta);
  }
  return results;
}

function buildRelevantInstructions(
  currentStepId: string,
  stepMeta: Record<string, StepMeta>,
  pipelineOrder: string[],
): string | null {
  const currentIdx = pipelineOrder.indexOf(currentStepId);
  if (currentIdx < 0) return null;

  const sections: string[] = [];
  for (let i = 0; i < currentIdx; i++) {
    const upstreamId = pipelineOrder[i];
    const metas = collectMetaForStep(upstreamId, stepMeta);
    if (metas.length === 0) continue;

    for (const meta of metas) {
      const latest = meta.modifications[meta.modifications.length - 1];
      const parts: string[] = [`[${upstreamId}]`];

      if (latest.edited != null && latest.original != null) {
        const origStr = typeof latest.original === "string"
          ? latest.original.slice(0, 300) : JSON.stringify(latest.original).slice(0, 300);
        const editStr = typeof latest.edited === "string"
          ? latest.edited.slice(0, 300) : JSON.stringify(latest.edited).slice(0, 300);
        parts.push(`原始内容摘要: ${origStr}${origStr.length >= 300 ? "..." : ""}`);
        parts.push(`修改后摘要: ${editStr}${editStr.length >= 300 ? "..." : ""}`);
      }
      if (latest.userInstructions) {
        parts.push(`用户指令: ${latest.userInstructions}`);
      }
      sections.push(parts.join("\n"));
    }
  }

  const ownMetas = collectMetaForStep(currentStepId, stepMeta);
  for (const meta of ownMetas) {
    const latest = meta.modifications[meta.modifications.length - 1];
    const parts: string[] = [`[${currentStepId}] 用户对本步骤的修改:`];

    if (latest.edited != null && latest.original != null) {
      const origStr = typeof latest.original === "string"
        ? latest.original.slice(0, 500) : JSON.stringify(latest.original).slice(0, 500);
      const editStr = typeof latest.edited === "string"
        ? latest.edited.slice(0, 500) : JSON.stringify(latest.edited).slice(0, 500);
      parts.push(`用户编辑前: ${origStr}${origStr.length >= 500 ? "..." : ""}`);
      parts.push(`用户编辑后: ${editStr}${editStr.length >= 500 ? "..." : ""}`);
    }
    if (latest.userInstructions) {
      parts.push(`用户新需求指令: ${latest.userInstructions}`);
    }
    if (parts.length > 1) sections.push(parts.join("\n"));
  }

  if (sections.length === 0) return null;

  return `以下是用户对管线内容的修改信息和新需求，请据此重新生成本步骤的内容：\n\n${sections.join("\n\n")}\n\n请严格遵循用户的修改和新需求指令，重新生成完整内容。`;
}

const S = STEP_IDS;

const ALL_STEPS = new Map<string, { name: string; fn: PipelineStep }>([
  // 偏好分析
  [S.PREFERENCE_SUMMARY,    { name: "偏好总结",           fn: userPreferenceSummary }],
  [S.PREFERENCE_ANALYSIS,   { name: "偏好分析",           fn: userPreferenceAnalysis }],
  // 初步方案（合并步骤）
  [S.INITIAL_PLAN,          { name: "初步方案",           fn: initialPlan }],
  // 叙事步骤
  [S.WORLDVIEW,             { name: "世界观构建",         fn: worldviewConstruction }],
  [S.CHARACTER_ENRICHMENT,  { name: "角色档案",           fn: characterEnrichment }],
  [S.ITEM_DATABASE,         { name: "道具清单",           fn: itemDatabase }],
  [S.STORY_FRAMEWORK,       { name: "L0 故事框架",        fn: storyFramework }],
  [S.OUTLINE_BATCH,         { name: "L1 故事大纲",        fn: outlineBatch }],
  [S.DETAILED_OUTLINE,      { name: "L2 故事细纲",        fn: detailedOutlineBatch }],
  [S.PLOT_GENERATION,       { name: "L3 情节生成",        fn: plotGeneration }],
  [S.SCRIPT_GENERATION,     { name: "L4 剧本生成",        fn: scriptGeneration }],
  [S.QUEST_GENERATION,      { name: "L5 任务生成",        fn: questGeneration }],
  [S.SCENE_GENERATION,      { name: "场景生成",           fn: sceneGeneration }],
  [S.SCRIPT_SCENE_GENERATION, { name: "剧本+场景耦合生成", fn: scriptSceneGeneration }],
  [S.NARRATIVE_CARD,        { name: "叙事卡",             fn: narrativeCardGeneration }],
  [S.LORE_GENERATION,       { name: "Lore 碎片",          fn: loreGeneration }],
  // 策划步骤 (D0-D4)
  [S.CORE_CONCEPT,          { name: "D0 核心概念",        fn: coreConcept }],
  [S.SYSTEM_ARCHITECTURE,   { name: "D1 系统架构",        fn: systemArchitecture }],
  [S.SYSTEM_DETAIL,         { name: "D2 玩法设计",        fn: systemDetail }],
  [S.VALUE_FRAMEWORK,       { name: "D3 数值框架",        fn: valueFramework }],
  [S.DESIGN_DOC,            { name: "D4 策划案整合",      fn: designDoc }],
  // 新管线模板步骤（B3，P0 stubs）
  ["branch_tree",           { name: "剧情分支树",         fn: branchTree }],
  ["dialogue_script",       { name: "对话脚本",           fn: dialogueScript }],
  ["cinematic_storyboard",  { name: "电影分镜",           fn: cinematicStoryboard }],
  // 影游叙事 v2 专属管线（tpl-vn-v2）— E1+E2+G 9 步
  [S.VN_LOGLINE,            { name: "E1-01 一句话故事梗概",   fn: vnLogline }],
  [S.VN_OUTLINE_ACTS,       { name: "E1-02 三幕扩写", fn: vnOutlineActs }],
  [S.VN_SCENES,             { name: "E1-03 场搭建",           fn: vnScenes }],
  [S.VN_BEATS,              { name: "E1-04 情节点搭建",       fn: vnBeats }],
  [S.VN_SCRIPT_NORMALIZE,   { name: "E2-01 用户剧本预处理",   fn: vnScriptNormalize }],
  [S.VN_SEGMENT_CONFIRM,    { name: "E2-02 影游化文本段确认", fn: vnSegmentConfirm }],
  [S.VN_BRANCHED_BEATS,     { name: "G-01 剧情树改造",        fn: vnBranchedBeats }],
  [S.VN_STATE_LEDGER,       { name: "G-01.5 世界状态账本",    fn: vnStateLedger }],
  [S.VN_SCREENPLAY,         { name: "G-02 剧本创作",          fn: vnScreenplay }],
  [S.VN_STORYBOARD,         { name: "G-03 分镜设计",          fn: vnStoryboard }],
  ["region_design",         { name: "区域设计",           fn: regionDesign }],
  ["emergent_event",        { name: "涌现事件模板",       fn: emergentEvent }],
  ["card_lore",             { name: "卡牌 Lore",          fn: cardLore }],
  ["event_pool",            { name: "事件池",             fn: eventPool }],
  // 向后兼容：旧存档中这些独立步骤仍可执行
  [S.INITIAL_OUTLINE,       { name: "初步大纲（旧）",     fn: initialStoryOutline }],
  [S.CORE_SETTINGS,         { name: "核心设定（旧）",     fn: coreSettingsExtraction }],
  [S.PLOT_SYNOPSIS,         { name: "剧情简介（旧）",     fn: plotSynopsis }],
  [S.STRUCTURE_VALIDATION_L1, { name: "L1 结构验证（旧）", fn: structureValidationL1 }],
  [S.STRUCTURE_VALIDATION_L2, { name: "L2 结构验证（旧）", fn: structureValidationL2 }],
  [S.STRUCTURE_VALIDATION_L3, { name: "L3 结构验证（旧）", fn: structureValidationL3 }],
]);

/**
 * tpl-vn-v2 E2 旁路：用户上传剧本时，**替换**（不是叠加）E1 中下层步骤。
 *
 * 与 MyFile/提示词/影游叙事生成提示词/00_README.md §四 调用顺序对齐：
 *   入口一（用户输入）：vn_logline → vn_outline_acts → vn_scenes → vn_beats → G-01...
 *   入口二（上传剧本）：vn_logline → vn_script_normalize → vn_segment_confirm → G-01...
 *
 * 也就是 E2 路径下 vn_outline_acts / vn_scenes / vn_beats 三步全部被
 * vn_script_normalize + vn_segment_confirm 替代——后者会同时产出
 * vn_outline_acts / vn_scenes / vn_beats / vn_character_bios，让 G-01~G-03 无差别消费。
 *
 * 共享同一 mode（vn_full / design_vn_full），路由由 ctx.uploaded_script 是否存在决定。
 */
function injectVnV2E2Steps(
  stepGroups: Array<string | string[]>,
  ctx: NarrativeContext,
): Array<string | string[]> {
  const hasUploadedScript = !!ctx.uploaded_script?.content;
  if (!hasUploadedScript) return stepGroups;

  const isFlatBeat = (entry: string | string[], target: string): boolean =>
    Array.isArray(entry) ? entry.includes(target) : entry === target;

  // 防御：避免重复处理（rerun 场景）
  const alreadyInjected = stepGroups.some(
    (e) => isFlatBeat(e, S.VN_SCRIPT_NORMALIZE) || isFlatBeat(e, S.VN_SEGMENT_CONFIRM),
  );
  if (alreadyInjected) return stepGroups;

  // 要被替换的 E1 中下层 step（不再保留）
  const REPLACED: ReadonlySet<string> = new Set([
    S.VN_OUTLINE_ACTS,
    S.VN_SCENES,
    S.VN_BEATS,
  ]);

  const containsAnyReplaced = stepGroups.some((e) =>
    Array.isArray(e) ? e.some((s) => REPLACED.has(s)) : REPLACED.has(e),
  );
  if (!containsAnyReplaced) return stepGroups;

  // 替换策略：
  //   - 单个 step 命中 REPLACED → 移除该 entry
  //   - 数组 step 部分命中 REPLACED → 过滤掉命中的元素，保留其他
  //   - 第一次遇到 REPLACED 时插入 [VN_SCRIPT_NORMALIZE, VN_SEGMENT_CONFIRM] 替代
  const out: Array<string | string[]> = [];
  let injected = false;
  for (const entry of stepGroups) {
    if (Array.isArray(entry)) {
      const remaining = entry.filter((s) => !REPLACED.has(s));
      const hadReplaced = remaining.length !== entry.length;
      if (remaining.length > 0) out.push(remaining);
      if (hadReplaced && !injected) {
        out.push(S.VN_SCRIPT_NORMALIZE);
        out.push(S.VN_SEGMENT_CONFIRM);
        injected = true;
      }
    } else {
      if (REPLACED.has(entry)) {
        if (!injected) {
          out.push(S.VN_SCRIPT_NORMALIZE);
          out.push(S.VN_SEGMENT_CONFIRM);
          injected = true;
        }
        // 命中则跳过（被 normalize+confirm 取代）
        continue;
      }
      out.push(entry);
    }
  }
  return out;
}

export class NarrativePipeline {
  private llm: LLMClient;
  private config: PipelineConfig;

  constructor(config: PipelineConfig) {
    this.config = config;
    this.llm = new LLMClient({
      apiKey: config.apiKey,
      proxyUrl: config.proxyUrl,
      proxyApiKey: config.proxyApiKey,
      defaultModel: config.model ?? getDefaultModel(),
    });
  }

  async run(
    userInput: string,
    options?: { uploadedScript?: import("../types/index.js").UploadedScript },
  ): Promise<NarrativeContext> {
    const resuming = !!this.config.resumeCtx;
    const ctx: NarrativeContext = resuming
      ? { ...this.config.resumeCtx!, user_input: userInput }
      : { user_input: userInput };

    // 复杂度档位注入：让不跑 preference_analysis 的管线（tpl-vn-v2 等）也能拿到 UI 选的档位派生节点预算。
    if (this.config.complexity != null && ctx.complexity == null) {
      ctx.complexity = this.config.complexity;
    }

    // M1: 上传剧本独立字段（前端在 /start 时给，resume 时从 checkpoint 还原 ctx.uploaded_script 自然带回）
    if (options?.uploadedScript && !resuming) {
      ctx.uploaded_script = options.uploadedScript;
    }

    // M1.6: 把上传剧本拼接到 user_input 末尾（带清晰分隔标记），让 21 个 step 无侵入地拿到剧本素材；
    //       同时 ctx.uploaded_script 保留为元数据（format / char_count）给 resolveTargetActs / 调试使用。
    //       这样既"显式独立字段"又"现存 prompt 自动透传"，避免逐个改 prompt。
    if (ctx.uploaded_script?.content && ctx.user_input) {
      const u = ctx.uploaded_script;
      const desc = u.description ?? `${u.format} 格式（约 ${u.char_count} 字）`;
      // 防御：避免重复拼接（resume / fork 场景 user_input 可能已经包含拼接尾巴）
      const SENTINEL = "\n\n---\n（以下为用户上传的剧本素材";
      if (!ctx.user_input.includes(SENTINEL)) {
        ctx.user_input = `${ctx.user_input}${SENTINEL}：${desc}；请作为创作的核心参考，保留原文人物名/场景命名/关键台词，不要凭空改写）\n${u.content}`;
      }
    }

    // === 第一层：Tier 路由 ===
    let tier: TierId;
    let mode: ModeId;

    // A2-2: explicit genre_code from frontend has highest priority. It overrides
    // both manual tier and LLM tier detection: we infer tier from the genre entry
    // and pre-populate tier_detection with the canonical genre name.
    const explicitGenre = findGenreByCode(this.config.genreCode);
    if (resuming && ctx.tier_detection) {
      tier = ctx.tier_detection.tier;
    } else if (explicitGenre) {
      tier = explicitGenre.tier;
      ctx.tier_detection = {
        tier,
        genre_code: explicitGenre.code,
        genre_name: explicitGenre.name,
        reasoning: `前端显式指定品类: ${explicitGenre.name} (${explicitGenre.code})`,
      };
    } else if (this.config.tier) {
      tier = this.config.tier;
      ctx.tier_detection = {
        tier,
        genre_code: "manual",
        genre_name: "用户手动指定",
        reasoning: "用户手动指定 tier",
      };
    } else if (this.config.autoDetectTier !== false) {
      this.emit({
        stage: "品类识别",
        stepId: "tier_router",
        step: 0,
        totalSteps: 0,
        status: "running",
        message: "正在识别游戏品类和叙事强度...",
      });
      await detectTier(ctx, this.llm);
      tier = ctx.tier_detection!.tier;
      this.emit({
        stage: "品类识别",
        stepId: "tier_router",
        step: 0,
        totalSteps: 0,
        status: "completed",
        message: `识别结果: ${tier} — ${ctx.tier_detection!.genre_name} (${ctx.tier_detection!.genre_code})`,
        data: { tier_detection: ctx.tier_detection, demand_analysis: ctx.demand_analysis },
      });
    } else {
      tier = "tier1";
    }

    // 确保 demand_analysis 存在（手动指定 tier 或 autoDetect=false 时未经过 tier_router）
    if (!ctx.demand_analysis) {
      // A2-2: 显式品类时用真实 code，否则保留旧后备 "rpg-jrpg"
      const td = ctx.tier_detection;
      const isManualPlaceholder = td?.genre_code === "manual";
      const genreCode = (!isManualPlaceholder && td?.genre_code) || "rpg-jrpg";
      const genreName = (!isManualPlaceholder && td?.genre_name) || "默认";
      ctx.demand_analysis = buildDemandAnalysis(
        genreCode, genreName, tier,
        "auto", "自动识别",
        "full_design_doc", 0,
        td?.reasoning ?? "知识库填充（未经过 tier_router）",
      );
    }

    // === 第二层：Mode 路由 ===
    mode = this.config.mode ?? TIER_DEFAULT_MODE[tier];

    const modeConfig = getModeConfig(mode);
    let stepGroups = [...modeConfig.steps];

    const usePlanner = this.config.usePlanner !== false;

    if (usePlanner && mode === "narrative_auto" && ctx.demand_analysis) {
      // ─── Planner path: narrative_auto ───
      // Use the Planner engine to select steps based on genre needs matrix.
      const plannerInput: PlannerInput = {
        genre_code: ctx.demand_analysis.genre_code,
        tier,
        needs: ctx.demand_analysis.narrative_needs ?? {},
        narrative_type: ctx.demand_analysis.narrative_type,
        pipelineTemplate: findGenreByCode(ctx.demand_analysis.genre_code)?.pipelineTemplate,
      };
      const planResult = planPipeline(plannerInput);
      stepGroups = planResult.stepGroups;
    } else if (!usePlanner || !modeConfig.isDynamic) {
      // ─── Legacy path (static modes + old dynamic fallback) ───
      /** @deprecated Use usePlanner=true (default) for new runs. Legacy path retained for backward compatibility. */
      const autoBuildOptions = { genreCode: ctx.demand_analysis?.genre_code };
      if (modeConfig.isDynamic && ctx.narrative_requirements) {
        const autoNarrativeSteps = buildAutoSteps(ctx.narrative_requirements, autoBuildOptions);
        stepGroups = [...stepGroups, ...autoNarrativeSteps];
      } else if (modeConfig.isDynamic && mode === "narrative_auto") {
        if (ctx.demand_analysis) {
          const syntheticReq = {
            needs: ctx.demand_analysis.narrative_needs,
            narrative_type: ctx.demand_analysis.narrative_type,
            depth: "standard" as const,
            available_modes: [],
            recommended_mode: "",
            priority_content: [],
            constraints: [],
            system_context: [],
            loops_summary: { gameplay_loop: "", resource_loop: "" },
          };
          stepGroups = buildAutoSteps(syntheticReq, autoBuildOptions);
        }
      }
    }
    // else: usePlanner=true && isDynamic && mode=design_auto → stepGroups stays as
    // modeConfig.steps (design steps D0-D4); narrative steps appended after D4 completes.

    if (mode === "design_full_narrative" && ctx.narrative_requirements) {
      console.warn(
        "[Pipeline] design_full_narrative 使用静态全量 RPG 步骤，未根据 narrative_requirements.needs 裁剪。" +
        " 若品类非 RPG，建议使用 design_auto 模式。",
      );
    }

    // tpl-vn-v2 E2 旁路：用户上传剧本时，把 VN_SCRIPT_NORMALIZE / VN_SEGMENT_CONFIRM
    // 替换 E1 的 VN_OUTLINE_ACTS / VN_SCENES / VN_BEATS。无上传剧本则不插，走纯 E1 路径。
    stepGroups = injectVnV2E2Steps(stepGroups, ctx);

    type ResolvedStep = { id: string; name: string; fn: PipelineStep };
    type ResolvedGroup = ResolvedStep | ResolvedStep[];

    const resolveStepId = (id: string): ResolvedStep | null => {
      const step = ALL_STEPS.get(id);
      return step ? { id, ...step } : null;
    };

    const activeGroups: ResolvedGroup[] = stepGroups
      .map((entry): ResolvedGroup | null => {
        if (Array.isArray(entry)) {
          const group = entry.map(resolveStepId).filter((s): s is ResolvedStep => s !== null);
          return group.length > 0 ? group : null;
        }
        return resolveStepId(entry);
      })
      .filter((g): g is ResolvedGroup => g !== null);

    const flatStepIds = (): string[] =>
      activeGroups.flatMap(g => Array.isArray(g) ? g.map(s => s.id) : [g.id]);
    const getTotal = () => flatStepIds().length;

    const resumeAfter = this.config.resumeAfterStep;
    let skipping = resuming && !!resumeAfter;

    const initTotal = getTotal();
    const dynamicHint = modeConfig.isDynamic && usePlanner
      ? "（Planner 模式，叙事步骤将在策划完成后由 Planner 追加）"
      : modeConfig.isDynamic ? "（动态模式，叙事步骤将在策划完成后追加）" : "";
    this.emit({
      stage: "管线配置",
      stepId: "pipeline_config",
      step: 0,
      totalSteps: initTotal,
      status: "completed",
      message: resuming
        ? `Tier=${tier}, Mode=${mode}(${modeConfig.label}), 共 ${initTotal} 步${dynamicHint} — 从 ${resumeAfter} 之后恢复`
        : `Tier=${tier}, Mode=${mode}(${modeConfig.label}), 共 ${initTotal} 步${dynamicHint}`,
    });

    // SSE: announce pipeline steps (Planner-selected when available)
    {
      const announceGenreCode = ctx.demand_analysis?.genre_code;
      const announceTemplate = findGenreByCode(announceGenreCode)?.pipelineTemplate;
      this.emit({
        type: "pipeline_steps_announce",
        stage: "announce",
        stepId: "pipeline_steps_announce",
        step: 0,
        totalSteps: initTotal + 1,
        status: "pending",
        steps: ["pipeline_config", ...flatStepIds()],
        pipelineTemplate: announceTemplate,
        genreCode: announceGenreCode,
      });
    }

    // === 执行管线（支持并行组） ===
    let stepCounter = 0;

    const executeStep = async (step: ResolvedStep, stepNum: number) => {
      if (skipping) {
        this.emit({
          stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
          status: "completed", message: `${step.name} (已恢复)`,
          data: this.extractStepOutput(step.id, ctx),
        });
        if (step.id === resumeAfter) skipping = false;
        return;
      }

      this.emit({
        stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
        status: "running", message: `正在执行：${step.name}...`,
      });

      const subEmit = (nodeId: string, nodeDone: number, nodeTotal: number, message?: string) => {
        this.emit({
          stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
          status: "running", message: message ?? `${step.name}: ${nodeDone}/${nodeTotal}`,
          nodeId, nodeDone, nodeTotal,
        });
      };
      (ctx as Record<string, unknown>)._subEmit = subEmit;

      const streamEmit = (chunk: string, accumulated: string) => {
        this.emit({
          stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
          status: "running", type: "streaming", chunk, accumulated,
        });
      };
      (ctx as Record<string, unknown>)._streamEmit = streamEmit;

      // IP DNA 算子/关系/账本注入（仅 IP DNA 驱动的改编生成 + 消费算子的 step；否则零开销）。
      await prepareInjection(ctx, step.id, this.llm);

      try {
        await step.fn(ctx, this.llm);

        if (step.id === S.DESIGN_DOC && modeConfig.isDynamic && ctx.narrative_requirements) {
          if (usePlanner) {
            // ─── Planner path: design_auto after D4 ───
            const liveGenreCode = ctx.demand_analysis?.genre_code ?? "";
            const plannerInput: PlannerInput = {
              genre_code: liveGenreCode,
              tier,
              needs: ctx.demand_analysis?.narrative_needs ?? {},
              narrative_type: ctx.demand_analysis?.narrative_type ?? "linear",
              pipelineTemplate: findGenreByCode(liveGenreCode)?.pipelineTemplate,
            };
            const planResult = planPipeline(plannerInput);
            const existingIds = new Set(flatStepIds());
            for (const entry of planResult.stepGroups) {
              if (Array.isArray(entry)) {
                const resolved = entry.map(resolveStepId).filter((s): s is ResolvedStep => s !== null);
                const newInGroup = resolved.filter((s) => !existingIds.has(s.id));
                if (newInGroup.length > 0) {
                  activeGroups.push(newInGroup.length === 1 ? newInGroup[0] : newInGroup);
                  newInGroup.forEach((s) => existingIds.add(s.id));
                }
              } else {
                if (!existingIds.has(entry)) {
                  const resolved = resolveStepId(entry);
                  if (resolved) {
                    activeGroups.push(resolved);
                    existingIds.add(entry);
                  }
                }
              }
            }
          } else {
            /** @deprecated Legacy design_auto step expansion. Use usePlanner=true for new runs. */
            const autoBuildOptionsLive = {
              genreCode: ctx.demand_analysis?.genre_code,
            };
            const autoSteps = buildAutoSteps(ctx.narrative_requirements, autoBuildOptionsLive);
            const existingIds = new Set(flatStepIds());
            for (const autoId of autoSteps) {
              if (!existingIds.has(autoId)) {
                const autoStep = ALL_STEPS.get(autoId);
                if (autoStep) activeGroups.push({ id: autoId, ...autoStep });
              }
            }
          }

          const liveGenreCode = ctx.demand_analysis?.genre_code;
          const liveTemplate = findGenreByCode(liveGenreCode)?.pipelineTemplate;
          this.emit({
            type: "pipeline_steps_announce",
            stage: "announce",
            stepId: "pipeline_steps_announce",
            step: 0,
            totalSteps: getTotal() + 1,
            status: "pending",
            steps: ["pipeline_config", ...flatStepIds()],
            pipelineTemplate: liveTemplate,
            genreCode: liveGenreCode,
          });
        }

        this.config.onStepComplete?.(step.id, ctx);
        this.emit({
          stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
          status: "completed", message: `${step.name} 完成`,
          data: this.extractStepOutput(step.id, ctx),
        });
      } catch (err) {
        // 注意：失败时**不**调 onStepComplete。
        // 否则 server.ts 会把失败步骤写入 manifest.completedSteps + 更新 lastCompletedStep，
        // 导致下次 resume 时这一步被当成"已完成"跳过，pipeline 0 秒"完成"，
        // 用户看到"断点续传无反应"。失败步骤的 partial ctx 数据本来就不可靠，丢弃是正确行为。
        this.emit({
          stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
          status: "failed", message: `${step.name} 失败: ${(err as Error).message}`,
        });
        throw err;
      }
    };

    for (const group of activeGroups) {
      if (Array.isArray(group)) {
        const startNum = stepCounter + 1;
        const promises = group.map((step, i) => executeStep(step, startNum + i));
        stepCounter += group.length;
        const results = await Promise.allSettled(promises);
        const failures = results.filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (failures.length === results.length) {
          throw failures[0].reason as Error;
        }
        if (failures.length > 0) {
          console.warn(
            `[Pipeline] ${failures.length}/${results.length} parallel steps failed (non-blocking):`,
            failures.map((f) => (f.reason as Error).message),
          );
        }
      } else {
        stepCounter++;
        await executeStep(group, stepCounter);
      }
    }

    return ctx;
  }

  /**
   * Re-run the pipeline from a specific step, reusing an existing context.
   * Clears output fields for fromStepId and all downstream steps before execution.
   */
  async rerunFromStep(
    ctx: NarrativeContext,
    fromStepId: string,
    options?: RerunOptions,
  ): Promise<NarrativeContext> {
    // Apply direct field patches
    if (options?.patchedFields) {
      Object.assign(ctx, options.patchedFields);
    }

    // Global user instructions (legacy path; stepMeta-based injection preferred)
    if (options?.userInstructions && !options?.stepMeta) {
      (ctx as Record<string, unknown>)._userInstructions = options.userInstructions;
    }

    // Resolve active step sequence (reuse Tier/Mode already stored in ctx)
    const tier: TierId = ctx.tier_detection?.tier ?? this.config.tier ?? "tier1";
    const mode: ModeId = this.config.mode ?? TIER_DEFAULT_MODE[tier];
    const modeConfig = getModeConfig(mode);

    let stepGroups: (string | string[])[] = [...modeConfig.steps];
    const usePlanner = this.config.usePlanner !== false;
    const rerunAutoBuildOptions = { genreCode: ctx.demand_analysis?.genre_code };

    if (usePlanner && modeConfig.isDynamic && mode === "narrative_auto" && ctx.demand_analysis) {
      const plannerInput: PlannerInput = {
        genre_code: ctx.demand_analysis.genre_code,
        tier,
        needs: ctx.demand_analysis.narrative_needs ?? {},
        narrative_type: ctx.demand_analysis.narrative_type,
        pipelineTemplate: findGenreByCode(ctx.demand_analysis.genre_code)?.pipelineTemplate,
      };
      stepGroups = planPipeline(plannerInput).stepGroups;
    } else if (usePlanner && modeConfig.isDynamic && (ctx.narrative_requirements || ctx.demand_analysis)) {
      const liveGenreCode = ctx.demand_analysis?.genre_code ?? "";
      const plannerInput: PlannerInput = {
        genre_code: liveGenreCode,
        tier,
        needs: ctx.demand_analysis?.narrative_needs ?? {},
        narrative_type: ctx.demand_analysis?.narrative_type ?? "linear",
        pipelineTemplate: findGenreByCode(liveGenreCode)?.pipelineTemplate,
      };
      const planResult = planPipeline(plannerInput);
      const existingIds = new Set(stepGroups.flat());
      for (const entry of planResult.stepGroups) {
        if (Array.isArray(entry)) {
          const newEntries = entry.filter((id: string) => !existingIds.has(id));
          if (newEntries.length) {
            stepGroups.push(newEntries.length === 1 ? newEntries[0] : newEntries);
            newEntries.forEach((id: string) => existingIds.add(id));
          }
        } else if (!existingIds.has(entry)) {
          stepGroups.push(entry);
          existingIds.add(entry);
        }
      }
    } else {
      /** @deprecated Legacy rerun path. Use usePlanner=true (default) for new runs. */
      if (modeConfig.isDynamic && ctx.narrative_requirements) {
        const autoNarrativeSteps = buildAutoSteps(ctx.narrative_requirements, rerunAutoBuildOptions);
        stepGroups = [...stepGroups, ...autoNarrativeSteps];
      } else if (modeConfig.isDynamic && mode === "narrative_auto" && ctx.demand_analysis) {
        const syntheticReq = {
          needs: ctx.demand_analysis.narrative_needs,
          narrative_type: ctx.demand_analysis.narrative_type,
          depth: "standard" as const,
          available_modes: [],
          recommended_mode: "",
          priority_content: [],
          constraints: [],
          system_context: [],
          loops_summary: { gameplay_loop: "", resource_loop: "" },
        };
        stepGroups = buildAutoSteps(syntheticReq, rerunAutoBuildOptions);
      }
    }

    // tpl-vn-v2 E2 旁路（重跑路径同样要镜像 run() 的插入逻辑）
    stepGroups = injectVnV2E2Steps(stepGroups, ctx);

    type ResolvedStep = { id: string; name: string; fn: PipelineStep };
    type ResolvedGroup = ResolvedStep | ResolvedStep[];

    const resolveStepId = (id: string): ResolvedStep | null => {
      const step = ALL_STEPS.get(id);
      return step ? { id, ...step } : null;
    };

    const activeGroups: ResolvedGroup[] = stepGroups
      .map((entry): ResolvedGroup | null => {
        if (Array.isArray(entry)) {
          const group = entry.map(resolveStepId).filter((s): s is ResolvedStep => s !== null);
          return group.length > 0 ? group : null;
        }
        return resolveStepId(entry);
      })
      .filter((g): g is ResolvedGroup => g !== null);

    const flatStepIds = (): string[] =>
      activeGroups.flatMap(g => Array.isArray(g) ? g.map(s => s.id) : [g.id]);

    const allIds = flatStepIds();
    const fromIndex = allIds.indexOf(fromStepId);
    if (fromIndex === -1) {
      throw new Error(`Step '${fromStepId}' not found in current pipeline mode '${mode}'`);
    }

    // Determine the stop boundary
    const stopIndex = options?.stopAfterStep
      ? allIds.indexOf(options.stopAfterStep)
      : allIds.length - 1;
    if (stopIndex === -1) {
      throw new Error(`stopAfterStep '${options!.stopAfterStep}' not found in current pipeline mode '${mode}'`);
    }

    const skipSet = new Set(options?.skipSteps ?? []);
    const nodeFilterMap = options?.nodeFilter ?? {};

    const stepsToRerun = allIds.slice(fromIndex, stopIndex + 1)
      .filter(sid => !skipSet.has(sid));
    for (const sid of stepsToRerun) {
      const nodeIds = nodeFilterMap[sid];
      if (nodeIds?.length) {
        partialClearNodes(ctx, sid, nodeIds);
      } else {
        const fields = STEP_OUTPUT_FIELDS[sid];
        if (fields) {
          for (const field of fields) {
            delete (ctx as Record<string, unknown>)[field];
          }
        }
      }
    }

    const getTotal = () => allIds.length;

    // Execute only the steps in [fromIndex..stopIndex], skip everything else
    let stepCounter = 0;

    const executeStep = async (step: ResolvedStep, stepNum: number) => {
      const idx = allIds.indexOf(step.id);
      const inRerunRange = idx >= fromIndex && idx <= stopIndex;
      const shouldSkip = !inRerunRange || skipSet.has(step.id);

      if (shouldSkip) {
        this.emit({
          stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
          status: "completed", message: `${step.name} (已保留)`,
          data: this.extractStepOutput(step.id, ctx),
        });
        this.config.onStepComplete?.(step.id, ctx);
        return;
      }

      this.emit({
        stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
        status: "running", message: `正在重新生成：${step.name}...`,
      });

      const subEmit = (nodeId: string, nodeDone: number, nodeTotal: number, message?: string) => {
        this.emit({
          stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
          status: "running", message: message ?? `${step.name}: ${nodeDone}/${nodeTotal}`,
          nodeId, nodeDone, nodeTotal,
        });
      };
      (ctx as Record<string, unknown>)._subEmit = subEmit;

      const streamEmit = (chunk: string, accumulated: string) => {
        this.emit({
          stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
          status: "running", type: "streaming", chunk, accumulated,
        });
      };
      (ctx as Record<string, unknown>)._streamEmit = streamEmit;

      try {
        const stepMeta = options?.stepMeta;
        if (stepMeta) {
          const instructions = buildRelevantInstructions(step.id, stepMeta, allIds);
          if (instructions) {
            (ctx as Record<string, unknown>)._userInstructions = instructions;
          }
        }

        const nodeIds = nodeFilterMap[step.id];
        let snapshot: unknown;
        if (nodeIds?.length) {
          console.warn(
            `[Rerun] 节点级重跑 step=${step.id} nodes=[${nodeIds.join(",")}]。` +
            ` 注意：前驱节点内容未同步重跑，滑动窗口/边界约束可能基于旧版本数据。`,
          );
          (ctx as Record<string, unknown>)._nodeFilter = nodeIds;
          snapshot = snapshotStepNodes(ctx, step.id);
        }

        await step.fn(ctx, this.llm);

        if (nodeIds?.length && snapshot) {
          mergeNodesBack(ctx, step.id, nodeIds, snapshot);
        }
        delete (ctx as Record<string, unknown>)._nodeFilter;
        delete (ctx as Record<string, unknown>)._userInstructions;

        if (stepMeta) {
          const prefix = `${step.id}::`;
          for (const key of Object.keys(stepMeta)) {
            if (key === step.id || key.startsWith(prefix)) {
              stepMeta[key].needsRegen = false;
            }
          }
        }

        this.config.onStepComplete?.(step.id, ctx);
        this.emit({
          stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
          status: "completed", message: `${step.name} 完成 (重新生成)`,
          data: this.extractStepOutput(step.id, ctx),
        });
      } catch (err) {
        delete (ctx as Record<string, unknown>)._nodeFilter;
        delete (ctx as Record<string, unknown>)._userInstructions;
        this.emit({
          stage: step.name, stepId: step.id, step: stepNum, totalSteps: getTotal(),
          status: "failed", message: `${step.name} 失败: ${(err as Error).message}`,
        });
        throw err;
      }
    };

    for (const group of activeGroups) {
      if (Array.isArray(group)) {
        const startNum = stepCounter + 1;
        const promises = group.map((step, i) => executeStep(step, startNum + i));
        stepCounter += group.length;
        const results = await Promise.allSettled(promises);
        const failures = results.filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (failures.length === results.length) {
          throw failures[0].reason as Error;
        }
        if (failures.length > 0) {
          console.warn(
            `[Rerun] ${failures.length}/${results.length} parallel steps failed (non-blocking):`,
            failures.map((f) => (f.reason as Error).message),
          );
        }
      } else {
        stepCounter++;
        await executeStep(group, stepCounter);
      }
    }

    return ctx;
  }

  /**
   * Return the list of step IDs that would become stale if `fromStepId` is re-run.
   * Useful for the frontend to preview cascade impact before triggering regeneration.
   * Pass `ctx` for dynamic modes so that `buildAutoSteps` can append runtime steps.
   */
  getStaleSteps(fromStepId: string, mode: ModeId, ctx?: NarrativeContext): string[] {
    const modeConfig = getModeConfig(mode);
    let allIds: string[] = modeConfig.steps.flatMap(entry =>
      Array.isArray(entry) ? entry : [entry],
    );

    const usePlanner = this.config.usePlanner !== false;

    if (usePlanner && modeConfig.isDynamic && ctx) {
      const liveGenreCode = ctx.demand_analysis?.genre_code ?? "";
      if (mode === "narrative_auto" && ctx.demand_analysis) {
        const plannerInput: PlannerInput = {
          genre_code: liveGenreCode,
          tier: ctx.tier_detection?.tier ?? this.config.tier ?? "tier1",
          needs: ctx.demand_analysis.narrative_needs ?? {},
          narrative_type: ctx.demand_analysis.narrative_type,
          pipelineTemplate: findGenreByCode(liveGenreCode)?.pipelineTemplate,
        };
        allIds = planPipeline(plannerInput).stepGroups.flatMap(
          (g) => Array.isArray(g) ? g : [g],
        );
      } else if (ctx.narrative_requirements || ctx.demand_analysis) {
        const plannerInput: PlannerInput = {
          genre_code: liveGenreCode,
          tier: ctx.tier_detection?.tier ?? this.config.tier ?? "tier1",
          needs: ctx.demand_analysis?.narrative_needs ?? {},
          narrative_type: ctx.demand_analysis?.narrative_type ?? "linear",
          pipelineTemplate: findGenreByCode(liveGenreCode)?.pipelineTemplate,
        };
        const planResult = planPipeline(plannerInput);
        const existing = new Set(allIds);
        for (const entry of planResult.stepGroups) {
          if (Array.isArray(entry)) {
            for (const id of entry) {
              if (!existing.has(id)) { allIds.push(id); existing.add(id); }
            }
          } else if (!existing.has(entry)) {
            allIds.push(entry);
            existing.add(entry);
          }
        }
      }
    } else if (modeConfig.isDynamic && ctx) {
      /** @deprecated Legacy stale detection path. */
      const autoBuildOptions = { genreCode: ctx.demand_analysis?.genre_code };
      if (ctx.narrative_requirements) {
        const autoSteps = buildAutoSteps(ctx.narrative_requirements, autoBuildOptions);
        const existing = new Set(allIds);
        for (const s of autoSteps) {
          if (!existing.has(s)) allIds.push(s);
        }
      } else if (mode === "narrative_auto" && ctx.demand_analysis) {
        const syntheticReq = {
          needs: ctx.demand_analysis.narrative_needs,
          narrative_type: ctx.demand_analysis.narrative_type,
          depth: "standard" as const,
          available_modes: [],
          recommended_mode: "",
          priority_content: [],
          constraints: [],
          system_context: [],
          loops_summary: { gameplay_loop: "", resource_loop: "" },
        };
        allIds = buildAutoSteps(syntheticReq, autoBuildOptions);
      }
    }
    // tpl-vn-v2 E2 旁路：与 run/rerun 镜像
    if (ctx) {
      const grouped = injectVnV2E2Steps(allIds, ctx);
      allIds = grouped.flatMap((entry) => (Array.isArray(entry) ? entry : [entry]));
    }
    const fromIndex = allIds.indexOf(fromStepId);
    if (fromIndex === -1) return [];
    return allIds.slice(fromIndex);
  }

  // ════════════════════════════════════════════════════════════
  // Blueprint-based execution (Phase 4)
  // ════════════════════════════════════════════════════════════

  /**
   * 基于 Blueprint 运行管线。
   *
   * 与 run() 的关键区别：
   *   - 步骤序列、提示词、执行参数全部来自预组装的 Blueprint（不可变）
   *   - 有 AgentDef 注册的 step → 走 AgentRunner 新路径
   *   - 无 AgentDef 注册的 step → 回退到旧 step 函数（向后兼容）
   *   - Blueprint 随 SSE 首帧下发前端
   */
  async runWithBlueprint(
    userInput: string,
    options?: { uploadedScript?: import("../types/index.js").UploadedScript },
  ): Promise<{ ctx: NarrativeContext; blueprint: PipelineBlueprint }> {
    const resuming = !!this.config.resumeCtx;
    const ctx: NarrativeContext = resuming
      ? { ...this.config.resumeCtx!, user_input: userInput }
      : { user_input: userInput };

    if (this.config.complexity != null && ctx.complexity == null) {
      ctx.complexity = this.config.complexity;
    }

    if (options?.uploadedScript && !resuming) {
      ctx.uploaded_script = options.uploadedScript;
    }

    if (ctx.uploaded_script?.content && ctx.user_input) {
      const u = ctx.uploaded_script;
      const desc = u.description ?? `${u.format} 格式（约 ${u.char_count} 字）`;
      const SENTINEL = "\n\n---\n（以下为用户上传的剧本素材";
      if (!ctx.user_input.includes(SENTINEL)) {
        ctx.user_input = `${ctx.user_input}${SENTINEL}：${desc}；请作为创作的核心参考，保留原文人物名/场景命名/关键台词，不要凭空改写）\n${u.content}`;
      }
    }

    // Tier / Genre detection (reuse existing logic)
    let tier: TierId;
    const explicitGenre = findGenreByCode(this.config.genreCode);
    if (resuming && ctx.tier_detection) {
      tier = ctx.tier_detection.tier;
    } else if (explicitGenre) {
      tier = explicitGenre.tier;
      ctx.tier_detection = {
        tier,
        genre_code: explicitGenre.code,
        genre_name: explicitGenre.name,
        reasoning: `前端显式指定品类: ${explicitGenre.name} (${explicitGenre.code})`,
      };
    } else if (this.config.tier) {
      tier = this.config.tier;
      ctx.tier_detection = {
        tier,
        genre_code: "manual",
        genre_name: "用户手动指定",
        reasoning: "用户手动指定 tier",
      };
    } else if (this.config.autoDetectTier !== false) {
      this.emit({
        stage: "品类识别", stepId: "tier_router", step: 0, totalSteps: 0,
        status: "running", message: "正在识别游戏品类和叙事强度...",
      });
      await detectTier(ctx, this.llm);
      tier = ctx.tier_detection!.tier;
      this.emit({
        stage: "品类识别", stepId: "tier_router", step: 0, totalSteps: 0,
        status: "completed",
        message: `识别结果: ${tier} — ${ctx.tier_detection!.genre_name} (${ctx.tier_detection!.genre_code})`,
        data: { tier_detection: ctx.tier_detection, demand_analysis: ctx.demand_analysis },
      });
    } else {
      tier = "tier1";
    }

    if (!ctx.demand_analysis) {
      const td = ctx.tier_detection;
      const isManualPlaceholder = td?.genre_code === "manual";
      const genreCode = (!isManualPlaceholder && td?.genre_code) || "rpg-jrpg";
      const genreName = (!isManualPlaceholder && td?.genre_name) || "默认";
      ctx.demand_analysis = buildDemandAnalysis(
        genreCode, genreName, tier,
        "auto", "自动识别",
        "full_design_doc", 0,
        td?.reasoning ?? "知识库填充（未经过 tier_router）",
      );
    }

    const mode: ModeId = this.config.mode ?? TIER_DEFAULT_MODE[tier];
    const genreCode = ctx.demand_analysis?.genre_code ?? "rpg-jrpg";
    const complexity = ctx.global_control_params?.complexity ?? 0.5;

    // Assemble Blueprint
    const blueprint = assembleBlueprint({
      genreCode,
      mode,
      tier,
      complexity,
      ctx,
    });

    const total = blueprint.steps.length;

    // SSE: announce blueprint
    this.emit({
      type: "pipeline_steps_announce",
      stage: "announce",
      stepId: "pipeline_steps_announce",
      step: 0,
      totalSteps: total + 1,
      status: "pending",
      steps: ["pipeline_config", ...blueprint.steps.map((s) => s.stepId)],
      pipelineTemplate: blueprint.pipelineTemplate === "needs-driven"
        ? undefined
        : blueprint.pipelineTemplate,
      genreCode: blueprint.genreCode,
      complexity: blueprint.complexity,
    });

    this.emit({
      stage: "管线配置", stepId: "pipeline_config", step: 0, totalSteps: total,
      status: "completed",
      message: `Blueprint 组装完成: Tier=${tier}, Mode=${mode}, ${total} 步`,
    });

    // Execute steps
    const resumeAfter = this.config.resumeAfterStep;
    let skipping = resuming && !!resumeAfter;

    const executeStepBlueprint = async (step: StepBlueprint, stepNum: number) => {
      if (skipping) {
        this.emit({
          stage: step.agentDef.name, stepId: step.stepId, step: stepNum, totalSteps: total,
          status: "completed", message: `${step.agentDef.name} (已恢复)`,
          data: this.extractStepOutput(step.stepId, ctx),
        });
        if (step.stepId === resumeAfter) skipping = false;
        return;
      }

      this.emit({
        stage: step.agentDef.name, stepId: step.stepId, step: stepNum, totalSteps: total,
        status: "running", message: `正在执行：${step.agentDef.name}...`,
      });

      // 与 run() 主循环一致：消费算子的 step 在执行前注入 IP DNA（算子/关系/账本）。
      // 缺此调用会导致 Blueprint 路径静默丢失算子注入（名实不符），故必须对齐。
      await prepareInjection(ctx, step.stepId, this.llm);

      try {
        if (hasAgentDef(step.stepId) && step.agentDef.useNewRunner) {
          const runner = getRunnerForStructure(step.agentDef.structure.type);
          const result = await runner.execute(step, ctx, this.llm, {
            onProgress: (sid, msg) => {
              this.emit({
                stage: step.agentDef.name, stepId: sid, step: stepNum, totalSteps: total,
                status: "running", message: msg,
              });
            },
            onStream: (chunk, accumulated) => {
              this.emit({
                stage: step.agentDef.name, stepId: step.stepId, step: stepNum, totalSteps: total,
                status: "running", type: "streaming", chunk, accumulated,
              });
            },
            onSubEmit: (nodeId, done, nodeTotal) => {
              this.emit({
                stage: step.agentDef.name, stepId: step.stepId, step: stepNum, totalSteps: total,
                status: "running", message: `${step.agentDef.name}: ${done}/${nodeTotal}`,
                nodeId, nodeDone: done, nodeTotal,
              });
            },
          });
          (ctx as Record<string, unknown>)[step.agentDef.io.outputField] = result;
        } else {
          // Fallback to legacy step function
          const legacyStep = ALL_STEPS.get(step.stepId);
          if (!legacyStep) {
            throw new Error(`Step '${step.stepId}' has no AgentDef and no legacy step function`);
          }

          const subEmit = (nodeId: string, nodeDone: number, nodeTotal: number, message?: string) => {
            this.emit({
              stage: step.agentDef.name, stepId: step.stepId, step: stepNum, totalSteps: total,
              status: "running", message: message ?? `${step.agentDef.name}: ${nodeDone}/${nodeTotal}`,
              nodeId, nodeDone, nodeTotal,
            });
          };
          (ctx as Record<string, unknown>)._subEmit = subEmit;

          const streamEmit = (chunk: string, accumulated: string) => {
            this.emit({
              stage: step.agentDef.name, stepId: step.stepId, step: stepNum, totalSteps: total,
              status: "running", type: "streaming", chunk, accumulated,
            });
          };
          (ctx as Record<string, unknown>)._streamEmit = streamEmit;

          await legacyStep.fn(ctx, this.llm);
        }

        this.config.onStepComplete?.(step.stepId, ctx);
        this.emit({
          stage: step.agentDef.name, stepId: step.stepId, step: stepNum, totalSteps: total,
          status: "completed", message: `${step.agentDef.name} 完成`,
          data: this.extractStepOutput(step.stepId, ctx),
        });
      } catch (err) {
        this.emit({
          stage: step.agentDef.name, stepId: step.stepId, step: stepNum, totalSteps: total,
          status: "failed", message: `${step.agentDef.name} 失败: ${(err as Error).message}`,
        });
        throw err;
      }
    };

    let stepCounter = 0;

    for (let i = 0; i < blueprint.steps.length; ) {
      const pg = blueprint.parallelGroups.find((g) => g.includes(i));
      if (pg) {
        const groupSteps = pg.map((idx) => blueprint.steps[idx]);
        const promises = groupSteps.map((step, j) =>
          executeStepBlueprint(step, stepCounter + j + 1),
        );
        stepCounter += groupSteps.length;
        const results = await Promise.allSettled(promises);
        const failures = results.filter(
          (r): r is PromiseRejectedResult => r.status === "rejected",
        );
        if (failures.length === results.length) {
          throw failures[0].reason as Error;
        }
        i += pg.length;
      } else {
        stepCounter++;
        await executeStepBlueprint(blueprint.steps[i], stepCounter);
        i++;
      }
    }

    return { ctx, blueprint };
  }

  private emit(progress: PipelineProgress) {
    this.config.onProgress?.(progress);
  }

  private extractStepOutput(stepId: string, ctx: NarrativeContext): unknown {
    const ctxRaw = ctx as Record<string, unknown>;
    const map: Record<string, unknown> = {
      [S.PREFERENCE_SUMMARY]:    ctx.user_preference_summary,
      [S.PREFERENCE_ANALYSIS]:   ctx.user_preference_analysis,
      // 合并步骤：输出三个子字段的聚合视图
      [S.INITIAL_PLAN]: {
        initial_story_outline: ctx.initial_story_outline,
        core_settings:         ctx.core_settings,
        plot_synopsis:         ctx.plot_synopsis,
      },
      [S.WORLDVIEW]:             ctx.worldview_structure,
      [S.CHARACTER_ENRICHMENT]:  ctx.detailed_character_sheets,
      [S.ITEM_DATABASE]:         ctx.item_database,
      [S.STORY_FRAMEWORK]:       ctx.story_framework,
      [S.OUTLINE_BATCH]:         ctx.outlines_generated,
      [S.DETAILED_OUTLINE]:      ctx.detailed_outlines_generated,
      [S.PLOT_GENERATION]:       ctx.plots_generated,
      [S.SCRIPT_GENERATION]:     ctx.jrpg_script,
      [S.SCENE_GENERATION]:      ctx.scene_map,
      [S.SCRIPT_SCENE_GENERATION]: { jrpg_script: ctx.jrpg_script, scene_map: ctx.scene_map },
      [S.QUEST_GENERATION]:      ctx.quest_graph,
      [S.NARRATIVE_CARD]:        ctx.narrative_card,
      [S.LORE_GENERATION]:       ctx.lore_fragments,
      // F1 / B3 新模板步骤
      "branch_tree":             ctxRaw.branch_tree ?? null,
      "dialogue_script":         ctxRaw.dialogue_script ?? null,
      "cinematic_storyboard":    ctxRaw.cinematic_storyboard ?? null,
      "region_design":           ctxRaw.region_design ?? null,
      "emergent_event":          ctxRaw.emergent_events ?? null,
      "card_lore":               ctxRaw.card_lore ?? null,
      "event_pool":              ctxRaw.event_pool ?? null,
      // tpl-vn-v2 专属步骤
      [S.VN_LOGLINE]:            ctxRaw.vn_logline ?? null,
      // E1-02 单步三输出：SSE 帧在三幕基础上附带人物小传 / 关键道具，
      // 让运行期前端（activeResult 仍为 null）也能从 stepData 读到线路2。
      // acts/title/central_theme 保持顶层，节点视图照旧读 data.acts。
      [S.VN_OUTLINE_ACTS]: ctxRaw.vn_outline_acts
        ? {
            ...(ctxRaw.vn_outline_acts as Record<string, unknown>),
            character_bios: ctxRaw.vn_character_bios ?? null,
            key_items: ctxRaw.vn_key_items ?? null,
          }
        : null,
      [S.VN_SCENES]:             ctxRaw.vn_scenes ?? null,
      [S.VN_BEATS]:              ctxRaw.vn_beats ?? null,
      [S.VN_SCRIPT_NORMALIZE]:   ctxRaw.vn_script_normalized ?? null,
      [S.VN_SEGMENT_CONFIRM]:    ctxRaw.vn_segment_confirmed ?? null,
      [S.VN_BRANCHED_BEATS]:     ctxRaw.vn_branched_beats ?? null,
      [S.VN_SCREENPLAY]:         ctxRaw.vn_screenplay ?? null,
      [S.VN_STORYBOARD]:         ctxRaw.vn_storyboard ?? null,
      // 策划步骤
      [S.CORE_CONCEPT]:          ctx.core_concept,
      [S.SYSTEM_ARCHITECTURE]:   ctx.system_architecture,
      [S.SYSTEM_DETAIL]:         ctx.system_details,
      [S.VALUE_FRAMEWORK]:       ctx.value_framework,
      [S.DESIGN_DOC]:            ctx.game_design_context,
      // 向后兼容：旧存档中独立步骤的输出提取
      [S.INITIAL_OUTLINE]:       ctx.initial_story_outline,
      [S.CORE_SETTINGS]:         ctx.core_settings,
      [S.PLOT_SYNOPSIS]:         ctx.plot_synopsis,
      [S.STRUCTURE_VALIDATION_L1]: ctxRaw.l1_validation ?? null,
      [S.STRUCTURE_VALIDATION_L2]: ctxRaw.l2_validation ?? null,
      [S.STRUCTURE_VALIDATION_L3]: ctxRaw.l3_validation ?? null,
    };
    return map[stepId] ?? null;
  }
}
