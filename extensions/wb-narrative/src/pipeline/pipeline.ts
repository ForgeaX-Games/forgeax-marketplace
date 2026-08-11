import type {
  NarrativeContext,
  PipelineConfig,
  PipelineProgress,
  TierId,
  ModeId,
  StepMeta,
  AnnounceStepGroup,
} from "../types/index.js";
import { LLMClient } from "./llm-client.js";
import { getDefaultModel } from "../utils/plugin-env.js";
import { getModeConfig, TIER_DEFAULT_MODE, STEP_IDS, STEP_OUTPUT_FIELDS } from "./modes.js";
import { injectVnV2E2Steps } from "./vn-v2-e2.js";
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
import { structureCheck } from "./steps/structure-check.js";

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

// 影游叙事 v2 专属管线（tpl-vn-v2）独立 step（场号改后处理导出，无独立 vn_scenes 步）
import {
  vnLogline,
  vnOutlineActs,
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
import {
  STEP_REGISTRY,
  BANNER_STEP_IDS,
  getStepOutputFields as registryGetOutputFields,
  stepDisplayName,
  stepDisplayNames,
} from "./step-registry.js";

// 四期步序真值：品类 + 层级 → 四条席位管线之一（事实源 = 叙事策划专家组 CSV）
// 本文件的 NarrativePipeline 是执行器类，席位管线定义同名，故取别名区分。
import {
  resolveSeatStepGroups,
  resolveNarrativePipeline,
  expandPipelineSteps,
  type NarrativePipeline as SeatPipelineDef,
} from "./narrative-pipelines.js";
import { expertDisplayName } from "./expert-agents.js";
import { seatGroupsForSteps } from "./seat-attribution.js";

// Planner engine: needs-driven step selection（仅 use_legacy_pipeline 回退路径）
import { planPipeline } from "./planner/index.js";
import type { PlannerInput } from "./planner/index.js";

// IP DNA 统一注入适配器（算子/关系/账本 → 消费 step 提示词，§7.2b/§8/§10）
// 注入逻辑下沉到 ip-dna/injection 服务，pipeline 仅薄委托（T5）。
import { prepareInjection } from "../ip-dna/injection/operator-injection.js";

// Blueprint + Agent Framework (Phase 4 integration)
import type { PipelineBlueprint, StepBlueprint } from "./blueprint/types.js";
import { assembleBlueprint } from "./blueprint/assembler.js";
import { shouldSkipAgent } from "./run-manifest-runtime.js";
import { executeAgent } from "./agent-exec.js";
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

/**
 * id → 执行函数。这张表**只**回答"哪个 step 由哪个函数跑"。
 *
 * 显示名不在这里写第二遍：registerStep 的 name 是唯一真值，取名一律走
 * stepDisplayName()。以前这里带一列 name，与注册表逐字重复 36 行，
 * 改一个环节名要同时改两处，漏一处就是"日志里新名、画布上旧名"。
 */
const STEP_FNS = new Map<string, PipelineStep>([
  // 需求清单席（两步实现）
  [S.PREFERENCE_SUMMARY, userPreferenceSummary],
  [S.PREFERENCE_ANALYSIS, userPreferenceAnalysis],
  // 初步方案（合并步骤）
  [S.INITIAL_PLAN, initialPlan],
  // 叙事步骤
  [S.WORLDVIEW, worldviewConstruction],
  [S.CHARACTER_ENRICHMENT, characterEnrichment],
  [S.ITEM_DATABASE, itemDatabase],
  [S.STORY_FRAMEWORK, storyFramework],
  [S.OUTLINE_BATCH, outlineBatch],
  [S.DETAILED_OUTLINE, detailedOutlineBatch],
  [S.PLOT_GENERATION, plotGeneration],
  [S.SCRIPT_GENERATION, scriptGeneration],
  [S.QUEST_GENERATION, questGeneration],
  [S.SCENE_GENERATION, sceneGeneration],
  [S.SCRIPT_SCENE_GENERATION, scriptSceneGeneration],
  [S.NARRATIVE_CARD, narrativeCardGeneration],
  [S.LORE_GENERATION, loreGeneration],
  // 质检段（席位管线的收尾）。只在 STEP_REGISTRY 登记是不够的：run() 靠本表取 fn，
  // 缺项会被 resolveStepId 静默丢掉 —— 预览里有质检、实跑却没有。
  ["structure_check", structureCheck],
  ["vn_structure_check", structureCheck],
  // 策划步骤 (D0-D4)
  [S.CORE_CONCEPT, coreConcept],
  [S.SYSTEM_ARCHITECTURE, systemArchitecture],
  [S.SYSTEM_DETAIL, systemDetail],
  [S.VALUE_FRAMEWORK, valueFramework],
  [S.DESIGN_DOC, designDoc],
  // 新管线模板步骤（B3，P0 stubs）
  ["branch_tree", branchTree],
  ["dialogue_script", dialogueScript],
  ["cinematic_storyboard", cinematicStoryboard],
  // 影游叙事 v2 专属管线（tpl-vn-v2）— E1+E2+G 9 步
  [S.VN_LOGLINE, vnLogline],
  [S.VN_OUTLINE_ACTS, vnOutlineActs],
  [S.VN_BEATS, vnBeats],
  [S.VN_SCRIPT_NORMALIZE, vnScriptNormalize],
  [S.VN_SEGMENT_CONFIRM, vnSegmentConfirm],
  [S.VN_BRANCHED_BEATS, vnBranchedBeats],
  [S.VN_STATE_LEDGER, vnStateLedger],
  [S.VN_SCREENPLAY, vnScreenplay],
  [S.VN_STORYBOARD, vnStoryboard],
  ["region_design", regionDesign],
  ["emergent_event", emergentEvent],
  ["card_lore", cardLore],
  ["event_pool", eventPool],
  // 向后兼容：旧存档中这些独立步骤仍可执行
  [S.INITIAL_OUTLINE, initialStoryOutline],
  [S.CORE_SETTINGS, coreSettingsExtraction],
  [S.PLOT_SYNOPSIS, plotSynopsis],
  [S.STRUCTURE_VALIDATION_L1, structureValidationL1],
  [S.STRUCTURE_VALIDATION_L2, structureValidationL2],
  [S.STRUCTURE_VALIDATION_L3, structureValidationL3],
]);

/**
 * 这个 step id 在 run() 里真的跑得起来吗？
 *
 * 「在 STEP_REGISTRY 登记」与「run() 跑得起来」是两件事：前者供 planner 拓扑、
 * rerun 清字段、提示词组装读元数据，后者要本表里有 fn。少了后者 resolveStepId
 * 返回 null，那一步被静默丢掉，于是 /plan 预览里有、实跑却没有。
 * 席位管线的步序由 narrative-pipelines.ts 决定，两边由测试盯住不许漂移。
 */
export function isExecutableStep(id: string): boolean {
  return STEP_FNS.has(id);
}

/**
 * run() 能跑起来的全部 step id。
 *
 * 供测试守住「可执行 ⊆ 已登记」：执行派发经 executeAgent 走注册表查形态与 io，
 * 本表里有 fn 但注册表里没登记的 step，一派发就抛错。
 */
export function executableStepIds(): string[] {
  return [...STEP_FNS.keys()];
}

/**
 * 本表为该 step 登记的函数。
 *
 * 存在的唯一理由是让测试能断言「本表的 fn 与 StepDescriptor.fn 是同一个函数」——
 * 执行派发已改走 executeAgent（读 StepDescriptor.fn），两处若指向不同实现，
 * 换派发口径就等于悄悄换了实现。
 */
export function executableStepFn(id: string): PipelineStep | undefined {
  return STEP_FNS.get(id);
}

/** E2 旁路由「是否有上传剧本」决定；规则实现见 vn-v2-e2.ts（与 /plan 预览同源）。 */
function injectVnV2E2StepsForCtx(
  stepGroups: Array<string | string[]>,
  ctx: NarrativeContext,
): Array<string | string[]> {
  return injectVnV2E2Steps(stepGroups, !!ctx.uploaded_script?.content);
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
      contentLocale: config.locale ?? "zh",
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
    // 三轴路由注入：策略段 provider 只认 ctx.narrative_axes，resume 时以 checkpoint 里的为准。
    if (this.config.narrativeAxes && !ctx.narrative_axes) {
      ctx.narrative_axes = { ...this.config.narrativeAxes };
    }
    if (this.config.locale && !ctx.content_locale) {
      ctx.content_locale = this.config.locale;
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

    // 本次跑的是哪条席位管线。announce 帧靠它告诉画布「这几步同属一个专家」，
    // 画布才能画成专家容器而非一排同级节点。design_auto 在 D4 后追加时也会填上。
    let seatPipeline: SeatPipelineDef | null = null;

    const usePlanner = this.config.usePlanner !== false;

    if (usePlanner && mode === "narrative_auto" && ctx.demand_analysis) {
      // ─── 四期路由：品类 + 层级 → 四条席位管线之一 ───
      // 步序真值是 narrative-pipelines.ts（事实源 = 叙事策划专家组 CSV 第 7 列）。
      // 旧 Planner 按 needs / 原型族现算每品类各自的链，与 PRD v1.4 §3.2.3
      // 「所有品类走同一条通用流程、差异在提示词槽位」相反，故不再作为路由目标；
      // 它仍留在 use_legacy_pipeline=true 的回退路径上。
      const seat = resolveSeatStepGroups(ctx.demand_analysis.genre_code, tier);
      stepGroups = [...seat.stepGroups];
      seatPipeline = seat.pipeline;
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
    stepGroups = injectVnV2E2StepsForCtx(stepGroups, ctx);

    type ResolvedStep = { id: string; name: string; fn: PipelineStep };
    type ResolvedGroup = ResolvedStep | ResolvedStep[];

    const resolveStepId = (id: string): ResolvedStep | null => {
      const fn = STEP_FNS.get(id);
      return fn ? { id, name: stepDisplayName(id), fn } : null;
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

    /**
     * 告诉画布哪几步同属本次的专家席位管线。
     * 只报实际进入 activeGroups 的步（planned 席位、缺执行函数的步都已被滤掉），
     * 否则画布会为跑不到的步留空位。非席位路径（legacy / 静态模式）返回空——
     * 没有专家归属可言，画布退回一排同级节点。
     */
    const announceStepGroups = (): AnnounceStepGroup[] => {
      if (!seatPipeline) return [];
      const live = new Set(flatStepIds());
      const steps = expandPipelineSteps(seatPipeline).filter((id) => live.has(id));
      if (steps.length === 0) return [];
      // 容器标题用专家名而非管线内部名：用户拖进画布的是「互动叙事专家」，
      // 生成后容器顶上写「叙事管线（分镜）」会让人以为跑错了专家。
      return [{
        id: seatPipeline.id,
        label: expertDisplayName(ctx.demand_analysis?.genre_code),
        steps,
        pipelineId: seatPipeline.id,
        pipelineName: seatPipeline.name,
        seats: seatGroupsForSteps(steps),
      }];
    };

    const resumeAfter = this.config.resumeAfterStep;
    const agentLifecycle = this.config.agentLifecycle;
    // lifecycle 在场时逐 agent 判定；否则退回一期的线性前缀跳过。
    const useLifecycleSkip = resuming && !!agentLifecycle;
    let skipping = resuming && !useLifecycleSkip && !!resumeAfter;
    const shouldSkip = (stepId: string): boolean =>
      useLifecycleSkip ? shouldSkipAgent(agentLifecycle, stepId) : skipping;

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
      // 运行横幅，不是 agent：报本次的 Tier/Mode/总步数，没有产物。
      meta: true,
      message: resuming
        ? `Tier=${tier}, Mode=${mode}(${modeConfig.label}), 共 ${initTotal} 步${dynamicHint} — ${
            useLifecycleSkip
              ? `按 lifecycle 恢复（跳过 ${flatStepIds().filter((id) => shouldSkipAgent(agentLifecycle, id)).length} 步）`
              : `从 ${resumeAfter} 之后恢复`
          }`
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
        steps: [...BANNER_STEP_IDS, ...flatStepIds()],
        stepNames: stepDisplayNames(flatStepIds()),
        metaSteps: [...BANNER_STEP_IDS],
        stepGroups: announceStepGroups(),
        pipelineTemplate: announceTemplate,
        genreCode: announceGenreCode,
      });
    }

    // === 执行管线（支持并行组） ===
    let stepCounter = 0;

    const executeStep = async (step: ResolvedStep, stepNum: number) => {
      if (shouldSkip(step.id)) {
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
        // 单一派发点：全量管线、单 agent HTTP 入口、composite 子步都经 executeAgent，
        // 由它按 AgentDef 决定走 runner 还是 step 函数。这里不再直接调 step.fn——
        // 否则「席位声明了什么形态」在全量管线里永远不生效（形态只在单跑时被看见）。
        // 不转发 onProgress：那条回调承载的是执行层标记（runner 的 stage 序号、
        // composite 的子步名），与本 step 已经发过的「正在执行」帧重复。
        // 分片进度走 onSubEmit，流式增量走 onStream，两者都在下面接着。
        await executeAgent(step.id, ctx, this.llm, {
          index: stepNum,
          callbacks: {
            onStream: streamEmit,
            onSubEmit: (nodeId, done, nodeTotal) => subEmit(nodeId, done, nodeTotal),
          },
        });

        if (step.id === S.DESIGN_DOC && modeConfig.isDynamic && ctx.narrative_requirements) {
          if (usePlanner) {
            // ─── design_* 的叙事段：D4 之后接同一条席位管线 ───
            // 与 narrative_auto 共用 resolveSeatStepGroups，避免"策划+叙事"与"纯叙事"
            // 两条路跑出不同步序。D0-D4 段仍由 modeConfig.steps 提供。
            const liveGenreCode = ctx.demand_analysis?.genre_code ?? "";
            const seatAfterDesign = resolveSeatStepGroups(liveGenreCode, tier);
            seatPipeline = seatAfterDesign.pipeline;
            const existingIds = new Set(flatStepIds());
            for (const entry of seatAfterDesign.stepGroups as (string | string[])[]) {
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
                const autoFn = STEP_FNS.get(autoId);
                if (autoFn) activeGroups.push({ id: autoId, name: stepDisplayName(autoId), fn: autoFn });
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
            steps: [...BANNER_STEP_IDS, ...flatStepIds()],
            stepNames: stepDisplayNames(flatStepIds()),
            metaSteps: [...BANNER_STEP_IDS],
            stepGroups: announceStepGroups(),
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

    // 重跑的步序必须与首跑同源，否则"只重跑受影响环节"会错位到别的步上。
    // 两个分支都走 resolveSeatStepGroups，与 run() 里的两处一一对应。
    if (usePlanner && modeConfig.isDynamic && mode === "narrative_auto" && ctx.demand_analysis) {
      stepGroups = [...resolveSeatStepGroups(ctx.demand_analysis.genre_code, tier).stepGroups];
    } else if (usePlanner && modeConfig.isDynamic && (ctx.narrative_requirements || ctx.demand_analysis)) {
      const liveGenreCode = ctx.demand_analysis?.genre_code ?? "";
      const seatRerun = resolveSeatStepGroups(liveGenreCode, tier);
      const existingIds = new Set(stepGroups.flat());
      for (const entry of seatRerun.stepGroups as (string | string[])[]) {
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
    stepGroups = injectVnV2E2StepsForCtx(stepGroups, ctx);

    type ResolvedStep = { id: string; name: string; fn: PipelineStep };
    type ResolvedGroup = ResolvedStep | ResolvedStep[];

    const resolveStepId = (id: string): ResolvedStep | null => {
      const fn = STEP_FNS.get(id);
      return fn ? { id, name: stepDisplayName(id), fn } : null;
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

        // 与 run() 同一派发点：重跑走的形态必须和全量管线一致，
        // 否则同一个 step 在首跑与重跑下由不同执行路径产出。
        await executeAgent(step.id, ctx, this.llm, {
          index: stepNum,
          callbacks: {
            onStream: streamEmit,
            onSubEmit: (nodeId, done, nodeTotal) => subEmit(nodeId, done, nodeTotal),
          },
        });

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
      const staleTier = ctx.tier_detection?.tier ?? this.config.tier ?? "tier1";
      // 影响面预判读的必须是真正会跑的那条步序，否则"哪些环节会失效"算在旧链上。
      if (mode === "narrative_auto" && ctx.demand_analysis) {
        allIds = [...resolveSeatStepGroups(liveGenreCode, staleTier).stepGroups];
      } else if (ctx.narrative_requirements || ctx.demand_analysis) {
        const seatStale = resolveSeatStepGroups(liveGenreCode, staleTier);
        const existing = new Set(allIds);
        for (const entry of seatStale.stepGroups as (string | string[])[]) {
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
      const grouped = injectVnV2E2StepsForCtx(allIds, ctx);
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
    // 三轴路由注入：策略段 provider 只认 ctx.narrative_axes，resume 时以 checkpoint 里的为准。
    if (this.config.narrativeAxes && !ctx.narrative_axes) {
      ctx.narrative_axes = { ...this.config.narrativeAxes };
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

    // 与 run() 同一件事：告诉画布这几步同属哪位专家。blueprint 的动态步序本就来自
    // resolveSeatStepGroups，所以按同一条席位管线取交集即可，不必再算一遍步序。
    const blueprintStepGroups = (): AnnounceStepGroup[] => {
      const pipeline = resolveNarrativePipeline(genreCode, tier);
      const live = new Set(blueprint.steps.map((s) => s.stepId));
      const steps = expandPipelineSteps(pipeline).filter((id) => live.has(id));
      if (steps.length === 0) return [];
      return [{
        id: pipeline.id,
        label: expertDisplayName(genreCode),
        steps,
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        seats: seatGroupsForSteps(steps),
      }];
    };

    // SSE: announce blueprint
    this.emit({
      type: "pipeline_steps_announce",
      stage: "announce",
      stepId: "pipeline_steps_announce",
      step: 0,
      totalSteps: total + 1,
      status: "pending",
      steps: [...BANNER_STEP_IDS, ...blueprint.steps.map((s) => s.stepId)],
      stepNames: stepDisplayNames(blueprint.steps.map((s) => s.stepId)),
      metaSteps: [...BANNER_STEP_IDS],
      stepGroups: blueprintStepGroups(),
      pipelineTemplate: blueprint.pipelineTemplate === "needs-driven"
        ? undefined
        : blueprint.pipelineTemplate,
      genreCode: blueprint.genreCode,
      complexity: blueprint.complexity,
    });

    this.emit({
      stage: "管线配置", stepId: "pipeline_config", step: 0, totalSteps: total,
      status: "completed", meta: true,
      message: `Blueprint 组装完成: Tier=${tier}, Mode=${mode}, ${total} 步`,
    });

    // Execute steps
    const resumeAfter = this.config.resumeAfterStep;
    const agentLifecycle = this.config.agentLifecycle;
    const useLifecycleSkip = resuming && !!agentLifecycle;
    let skipping = resuming && !useLifecycleSkip && !!resumeAfter;
    const shouldSkip = (stepId: string): boolean =>
      useLifecycleSkip ? shouldSkipAgent(agentLifecycle, stepId) : skipping;

    const executeStepBlueprint = async (step: StepBlueprint, stepNum: number) => {
      if (shouldSkip(step.stepId)) {
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

      const subEmit = (nodeId: string, nodeDone: number, nodeTotal: number, message?: string) => {
        this.emit({
          stage: step.agentDef.name, stepId: step.stepId, step: stepNum, totalSteps: total,
          status: "running", message: message ?? `${step.agentDef.name}: ${nodeDone}/${nodeTotal}`,
          nodeId, nodeDone, nodeTotal,
        });
      };
      const streamEmit = (chunk: string, accumulated: string) => {
        this.emit({
          stage: step.agentDef.name, stepId: step.stepId, step: stepNum, totalSteps: total,
          status: "running", type: "streaming", chunk, accumulated,
        });
      };
      // legacy step 函数从 ctx 上取回调，不走 AgentRunnerCallbacks。
      (ctx as Record<string, unknown>)._subEmit = subEmit;
      (ctx as Record<string, unknown>)._streamEmit = streamEmit;

      try {
        // 与 run()/rerunFromStep() 同一派发点。Blueprint 路径的提示词已预解析，
        // 显式传进去——runner 路径要靠它，不传会渲染出空提示词。
        await executeAgent(step.stepId, ctx, this.llm, {
          index: stepNum,
          resolvedPrompts: step.resolvedPrompts,
          callbacks: {
            onStream: streamEmit,
            onSubEmit: (nodeId, done, nodeTotal) => subEmit(nodeId, done, nodeTotal),
          },
        });

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
