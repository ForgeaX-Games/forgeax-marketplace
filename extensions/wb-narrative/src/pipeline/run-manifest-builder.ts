/**
 * run-manifest-builder.ts — config → resolved RunManifest（Phase-1 M2）
 *
 * 算法只在后端：调用 planPipeline，填 agents[].lifecycle=pending。
 * 前端「未运行」预览与 /start 前预检均经此入口，禁止客户端重算步序。
 */
import { randomUUID } from "node:crypto";
import { findGenreByCode } from "../knowledge/genre-taxonomy.js";
import { getNarrativeType } from "../knowledge/genre-narrative-type.js";
import { resolveNarrativeStructure } from "../knowledge/narrative-axes/index.js";
import type { ModeId, TierId, ContentLocale } from "../types/index.js";
import {
  type RunManifest,
  type RunManifestConfig,
  type CompositionGraph,
  type ManifestAgentSlot,
  promptLibraryForTemplate,
  isCompositionComplete,
  emptyLifecycle,
} from "../types/run-manifest.js";
import { planPipeline } from "./planner/index.js";
import { getModeConfig, TIER_DEFAULT_MODE } from "./modes.js";
import { injectVnV2E2Steps } from "./vn-v2-e2.js";
import { PIPELINE_TEMPLATES, type PipelineTemplateId } from "./templates.js";
import type { NeedsKey, NeedsScore } from "./universal-agent/types.js";
import { getNarrativeAgent } from "./agent-registry.js";
import { type AgentLifecycle, prototypeFromStructure } from "./agent-contract.js";
import { STEP_REGISTRY } from "./step-registry.js";
// Ensure StepDescriptor + AgentDef registries are populated for name/prototype lookup.
import "./step-registrations.js";
import "./blueprint/agent-def-registrations.js";

export interface PlanManifestRequest {
  entryKey?: string;
  pipelineId?: string;
  config: RunManifestConfig;
  compositionGraph?: CompositionGraph;
  /** 自由编排显式请求的 step id（工程师节点）；与预设冲突时以此为准。 */
  requestedSteps?: string[];
  /** tpl-vn-v2 E2：已上传剧本时步序走 normalize/confirm 旁路（与运行时同一实现）。 */
  hasUploadedScript?: boolean;
}

function resolveNeeds(
  genreCode: string | null | undefined,
  tier: TierId | null | undefined,
): Partial<Record<NeedsKey, NeedsScore>> {
  if (genreCode) {
    const g = findGenreByCode(genreCode);
    if (g?.needs) return g.needs as Partial<Record<NeedsKey, NeedsScore>>;
  }
  // tier 兜底（与 tier-router 一致的粗粒度）
  switch (tier) {
    case "tier1":
      return { W: 3, C: 3, S: 3, D: 3, Q: 2, E: 2, I: 2, U: 2, L: 2 };
    case "tier2":
      return { W: 2, C: 2, S: 2, D: 2, Q: 1, E: 1, I: 1, U: 1, L: 1 };
    case "tier3":
      return { W: 2, C: 1, S: 1, D: 1, Q: 0, E: 0, I: 1, U: 1, L: 0 };
    case "tier4":
      return { W: 1, C: 0, S: 0, D: 0, Q: 0, E: 0, I: 0, U: 1, L: 0 };
    default:
      return { W: 2, C: 2, S: 2, D: 2 };
  }
}

function agentName(id: string): string {
  return getNarrativeAgent(id)?.name ?? STEP_REGISTRY.get(id)?.name ?? id;
}

function agentPrototype(id: string) {
  const a = getNarrativeAgent(id);
  if (a) return a.prototype;
  return prototypeFromStructure("single-turn");
}

/** 展平并去重（保序、保留并行组），供 mode 步序与 planner 步序拼接。 */
function concatGroupsDeduped(
  ...groupLists: (string | string[])[][]
): (string | string[])[] {
  const seen = new Set<string>();
  const out: (string | string[])[] = [];
  for (const groups of groupLists) {
    for (const entry of groups) {
      if (Array.isArray(entry)) {
        const kept = entry.filter((id) => !seen.has(id));
        for (const id of kept) seen.add(id);
        if (kept.length === 1) out.push(kept[0]!);
        else if (kept.length > 1) out.push(kept);
      } else if (!seen.has(entry)) {
        seen.add(entry);
        out.push(entry);
      }
    }
  }
  return out;
}

/**
 * 该 tier 的专属模板（`tiers` 恰为 [tier] 的那一个）。
 * 用于「选了层级但还没选品类」的预览：tier4 → tpl-narrative-card、tier3 → tpl-light。
 * 从 PIPELINE_TEMPLATES 的 tiers 声明推导，不另立一份 tier→template 映射。
 */
function exclusiveTemplateForTier(tier: TierId): PipelineTemplateId | undefined {
  for (const tpl of Object.values(PIPELINE_TEMPLATES)) {
    if (tpl.tiers.length === 1 && tpl.tiers[0] === tier) return tpl.id;
  }
  return undefined;
}

interface ResolveStepsInput {
  mode: ModeId | null | undefined;
  tier: TierId;
  genreCode: string | undefined;
  narrativeType: ReturnType<typeof getNarrativeType>;
  pipelineTemplate: PipelineTemplateId | undefined;
  hasUploadedScript: boolean;
}

/**
 * config → 步序，镜像 NarrativePipeline.run 的两层路由（Phase-2 M9）。
 *
 * 一期把 /plan 的步序算法收到后端，但只调了 planPipeline，漏掉了运行时真正的第一层
 * ——mode 路由：design_* 模式先跑 D0-D4，narrative_* 静态模式直接用 modeConfig.steps。
 * 前端于是自己补 D0-D4 前缀、自己维护 NARRATIVE_ROUTES.steps 镜像，形成两份算法。
 * 这里把 mode 路由补齐，/plan 才真的是唯一步序真值。
 *
 * 与运行时的唯一差异：运行时 design_auto 的叙事段在 D4 完成后才由 Planner 追加
 * （需要 LLM 的 demand_analysis），预览则直接把 Planner 结果接在 D0-D4 之后，
 * 使「待生成」链条完整可见；两者的步集一致，只是揭示时机不同。
 */
function resolveStepGroups(input: ResolveStepsInput): {
  stepGroups: (string | string[])[];
  resolvedTemplate: string;
} {
  const { tier, genreCode, narrativeType, pipelineTemplate } = input;
  // 无品类时不假装是 jrpg：品类未定则按 tier 的专属模板预览（tier4→叙事卡 / tier3→轻量），
  // tier1/2 无专属模板，才退回 jrpg 这一代表性重叙事链。
  const template = pipelineTemplate ?? (genreCode ? undefined : exclusiveTemplateForTier(tier));
  const plan = () =>
    planPipeline({
      genre_code: genreCode ?? (template ? "" : "rpg-jrpg"),
      tier,
      needs: resolveNeeds(genreCode, tier),
      narrative_type: narrativeType,
      pipelineTemplate: template,
    });

  const mode = (input.mode ?? TIER_DEFAULT_MODE[tier]) as ModeId;
  let modeConfig: ReturnType<typeof getModeConfig> | undefined;
  try {
    modeConfig = getModeConfig(mode);
  } catch {
    modeConfig = undefined;
  }

  let stepGroups: (string | string[])[];
  let resolvedTemplate: string;

  if (!modeConfig || mode === "narrative_auto") {
    // 全自动：步序完全由 Planner 按品类 needs 决定（与运行时 usePlanner 路径一致）。
    const planned = plan();
    stepGroups = planned.stepGroups;
    resolvedTemplate = String(planned.metadata.resolvedTemplate);
  } else if (modeConfig.isDynamic) {
    // design_*：modeConfig.steps（D0-D4）在前，叙事段由 Planner 决定。
    const planned = plan();
    stepGroups = concatGroupsDeduped([...modeConfig.steps], planned.stepGroups);
    resolvedTemplate = String(planned.metadata.resolvedTemplate);
  } else {
    // 静态叙事单品（worldview / script / vn_script ...）：modeConfig.steps 即真值。
    stepGroups = concatGroupsDeduped([...modeConfig.steps]);
    resolvedTemplate = modeConfig.pipeline_template ?? pipelineTemplate ?? "needs-driven";
  }

  return {
    stepGroups: injectVnV2E2Steps(stepGroups, input.hasUploadedScript),
    resolvedTemplate,
  };
}

function parallelGroupsToIndex(
  stepGroups: (string | string[])[],
  flat: string[],
): number[][] {
  const indexOf = new Map(flat.map((id, i) => [id, i]));
  const groups: number[][] = [];
  for (const g of stepGroups) {
    if (!Array.isArray(g) || g.length < 2) continue;
    groups.push(g.map((id) => indexOf.get(id)!).filter((n) => n !== undefined));
  }
  return groups;
}

/**
 * 有序 step id → ManifestAgentSlot[]。
 * /plan 预览与运行时 manifest 共用，保证两侧 slot 形状一致。
 */
export function buildAgentSlots(
  flatSteps: string[],
  pipelineId: string,
  lifecycle?: Record<string, AgentLifecycle>,
): ManifestAgentSlot[] {
  return flatSteps.map((agentId, index) => {
    const na = getNarrativeAgent(agentId);
    return {
      agentId,
      name: agentName(agentId),
      prototype: agentPrototype(agentId),
      index,
      lifecycle: emptyLifecycle(lifecycle?.[agentId] ?? "pending"),
      outputField: na?.io.outputField,
      outputRef: `${pipelineId}:${agentId}`,
    };
  });
}

/**
 * 将前端 config（+ 可选画布拓扑）解析为 RunManifest。
 * 自由编排 requestedSteps / compositionGraph 优先于预设管线。
 */
export function buildRunManifest(req: PlanManifestRequest): RunManifest {
  const now = new Date().toISOString();
  const entryKey = req.entryKey ?? `draft-${randomUUID().slice(0, 8)}`;
  const pipelineId = req.pipelineId ?? `pipe-${randomUUID().slice(0, 8)}`;
  const cfg = req.config;

  let complete = true;
  let incompletenessReason: string | undefined;
  if (req.compositionGraph) {
    const c = isCompositionComplete(req.compositionGraph);
    complete = c.complete;
    incompletenessReason = c.reason;
  }

  const genreCode = cfg.genreCode ?? undefined;
  // tier 已降级为品类的只读派生属性：有品类就以品类为准，客户端传来的 tier 只在
  // 「还没选专家」的预览态兜底（PRD v1.4 §3.2.2）。
  const tier = ((genreCode ? findGenreByCode(genreCode)?.tier : undefined) ??
    cfg.tier ??
    "tier1") as TierId;
  const narrativeType = genreCode
    ? getNarrativeType(genreCode)
    : ("linear" as const);

  // 三轴综合出叙事结构，结论写回 config 供提示词层与前端读取。
  const structure = resolveNarrativeStructure({
    genreCode,
    storyType: cfg.storyType,
    storyTheme: cfg.storyTheme,
    explicit: cfg.narrativeStructure,
  });
  const pipelineTemplate = (cfg.pipelineTemplate ??
    (genreCode ? findGenreByCode(genreCode)?.pipelineTemplate : undefined)) as
    | PipelineTemplateId
    | undefined;

  // 自由编排：若显式给了 requestedSteps，直接用（仍做去重保序）
  let flatSteps: string[];
  let stepGroups: (string | string[])[];
  let resolvedTemplate: string;

  if (req.requestedSteps && req.requestedSteps.length > 0) {
    flatSteps = [...new Set(req.requestedSteps)];
    stepGroups = flatSteps;
    resolvedTemplate = "composition-driven";
  } else {
    const resolved = resolveStepGroups({
      mode: cfg.mode,
      tier,
      genreCode,
      narrativeType,
      pipelineTemplate,
      hasUploadedScript: !!req.hasUploadedScript,
    });
    stepGroups = resolved.stepGroups;
    flatSteps = stepGroups.flatMap((g) => (Array.isArray(g) ? g : [g]));
    resolvedTemplate = resolved.resolvedTemplate;
  }

  const agents = buildAgentSlots(flatSteps, pipelineId);

  const templateCode =
    cfg.pipelineTemplate ??
    (resolvedTemplate !== "needs-driven" &&
    resolvedTemplate !== "composition-driven"
      ? resolvedTemplate
      : pipelineTemplate) ??
    "needs-driven";

  return {
    pipelineId,
    entryKey,
    status: "planned",
    config: {
      ...cfg,
      tier,
      genreCode: genreCode ?? null,
      storyType: cfg.storyType ?? null,
      storyTheme: cfg.storyTheme ?? null,
      narrativeStructure: structure.structure,
      structureSource: structure.source,
      pipelineTemplate: templateCode,
      mode: (cfg.mode ?? null) as ModeId | null,
      locale: (cfg.locale ?? "zh") as ContentLocale,
    },
    compositionGraph: req.compositionGraph,
    agents,
    parallelGroups: parallelGroupsToIndex(stepGroups, flatSteps),
    promptLibrary: promptLibraryForTemplate(templateCode),
    complete,
    incompletenessReason,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 多管线：对每张 composition 子图各建一份 manifest。
 * 每条管线可有自己的 config（各自的 routing/expert 节点参数不同），
 * 由 configByStart 按开始节点覆盖 baseConfig。
 */
export function buildEntryManifests(
  entryKey: string,
  graphs: CompositionGraph[],
  baseConfig: RunManifestConfig,
  requestedStepsByStart?: Record<string, string[]>,
  configByStart?: Record<string, Partial<RunManifestConfig>>,
  hasUploadedScript?: boolean,
): RunManifest[] {
  return graphs.map((graph) =>
    buildRunManifest({
      entryKey,
      config: { ...baseConfig, ...(configByStart?.[graph.startNodeId] ?? {}) },
      compositionGraph: graph,
      requestedSteps: requestedStepsByStart?.[graph.startNodeId],
      hasUploadedScript,
    }),
  );
}
