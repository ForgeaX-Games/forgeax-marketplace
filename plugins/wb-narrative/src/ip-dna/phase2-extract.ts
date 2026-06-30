/**
 * Phase 2 · 游戏单元 IP DNA（scoped 提取）—— 蓝图 §5.1 / §4.2c / §4.3。
 *
 * 流程：
 *   ① 对每个最小叙事单元提取三件套（template/operators/metadata）—— LLM seam；
 *   ② summary 由下至上**递归聚合**为上层 template + 算子池（确定性核心，可单测）；
 *   ③ 顶层 template（=游戏单元完整故事内容）映射到 NarrativeContext 生成字段（A→B，对齐 data-atlas）。
 *
 * 聚合是确定性的（去重/拼接/上卷），LLM 仅负责"从单元正文抽取" + 可选的上层 prose 精炼。
 */

import type { LLMClient } from "../pipeline/llm-client.js";
import { parseJSON } from "../pipeline/llm-client.js";
import { loadIpDnaPrompt } from "./prompt-loader.js";
import type {
  NarrativeIpDna,
  HierarchyNode,
  NarrativeTemplate,
  NarrativeOperator,
  TemplateSummary,
  TemplateWorldview,
  TemplateCharacter,
  TemplateCoreElements,
  TemplateStoryStructure,
  PlotTreeTopology,
  PlotTree,
} from "../types/narrative-ip-dna.js";
import type {
  NarrativeContext,
  CoreSettings,
  CharacterSheet,
  WorldviewStructure,
  UploadedScript,
  SceneMap,
  GameItem,
  StoryFramework,
  FrameworkNode,
} from "../types/index.js";

// ─────────────────────────────────────────────────────────────────
// 确定性聚合：summary / template 由下至上上卷
// ─────────────────────────────────────────────────────────────────

/** 聚合 N 条子 summary → 父 summary（去重角色、拼接场景/事件）。 */
export function aggregateSummaries(children: TemplateSummary[]): TemplateSummary {
  const characters = dedupe(children.flatMap((c) => c.characters));
  const scene = joinNonEmpty(children.map((c) => c.scene), " / ");
  const events = joinNonEmpty(children.map((c) => c.events), "；");
  return { characters, scene, events };
}

/** 聚合 N 个子 template → 父 template（worldview/characters/core_elements 上卷）。 */
export function aggregateTemplates(children: NarrativeTemplate[]): NarrativeTemplate {
  const worldview: TemplateWorldview = {
    setting: joinNonEmpty(children.map((c) => c.worldview.setting), "\n"),
    scene_structure: joinNonEmpty(children.map((c) => c.worldview.scene_structure), "\n"),
    item_inventory: joinNonEmpty(children.map((c) => c.worldview.item_inventory), "\n"),
  };

  // 角色按 name 去重合并（关系并集）
  const charMap = new Map<string, TemplateCharacter>();
  for (const c of children) {
    for (const ch of c.characters) {
      const existing = charMap.get(ch.name);
      if (!existing) {
        charMap.set(ch.name, { ...ch, relationships: [...(ch.relationships ?? [])] });
      } else {
        if (!existing.arc && ch.arc) existing.arc = ch.arc;
        existing.relationships = mergeRelationships(existing.relationships, ch.relationships);
      }
    }
  }

  const core_elements: TemplateCoreElements = {
    subject: firstNonEmpty(children.map((c) => c.core_elements.subject)),
    theme: firstNonEmpty(children.map((c) => c.core_elements.theme)),
    core_conflict: joinNonEmpty(children.map((c) => c.core_elements.core_conflict), "；"),
    literature_style: firstNonEmpty(children.map((c) => c.core_elements.literature_style)),
    emotion_experience: joinNonEmpty(children.map((c) => c.core_elements.emotion_experience), "；"),
  };

  // 保留 plot_tree（§4.3）：把子单元的剧情树并入父级，避免上卷时丢失实质剧情结构。
  const childTrees = children
    .map((c) => c.story_structure.plot_tree)
    .filter((t): t is PlotTree => !!t && t.nodes.length > 0);
  const story_structure: TemplateStoryStructure = {
    topology: rollupTopology(children.map((c) => c.story_structure.topology)),
    plot_tree: childTrees.length > 0 ? mergePlotTrees(childTrees) : undefined,
  };

  return {
    worldview,
    characters: [...charMap.values()],
    story_structure,
    core_elements,
    summary: aggregateSummaries(children.map((c) => c.summary)),
  };
}

/**
 * 合并多个子单元剧情树为一棵（§4.3）：按 id 去重拼接节点，entry 取首棵，topology 重算。
 * 上卷保留实质剧情结构（节点/边/分支），而非仅留拓扑计数。
 */
function mergePlotTrees(trees: PlotTree[]): PlotTree {
  const byId = new Map<string, PlotTree["nodes"][number]>();
  for (const tree of trees) {
    for (const n of tree.nodes) if (!byId.has(n.id)) byId.set(n.id, n);
  }
  const nodes = [...byId.values()];
  return {
    nodes,
    entryNodeId: trees[0]?.entryNodeId ?? nodes[0]?.id ?? "",
    topology: rollupTopology(trees.map((t) => t.topology)),
  };
}

function rollupTopology(tops: PlotTreeTopology[]): PlotTreeTopology {
  return {
    nodeCount: sum(tops.map((t) => t.nodeCount)),
    startCount: sum(tops.map((t) => t.startCount)),
    endCount: sum(tops.map((t) => t.endCount)),
    pivotCount: sum(tops.map((t) => t.pivotCount)),
    mergeCount: sum(tops.map((t) => t.mergeCount)),
  };
}

/**
 * 在 IP DNA 上对某子树做"由下至上"的 template 聚合（确定性）。
 * 叶子需已具备 template（由 LLM 提取填入）；内部节点的 template 由子节点聚合得到。
 * 返回根节点（rootId 子树）的聚合 template。原地写回每个内部节点的 template。
 */
export function aggregateSubtreeTemplates(dna: NarrativeIpDna, rootId: string): NarrativeTemplate | undefined {
  const node = dna.nodes[rootId];
  if (!node) return undefined;
  if (node.children.length === 0) return node.template;

  const childTemplates: NarrativeTemplate[] = [];
  const sorted = [...node.children].sort((a, b) => dna.nodes[a].index - dna.nodes[b].index);
  for (const c of sorted) {
    const t = aggregateSubtreeTemplates(dna, c);
    if (t) childTemplates.push(t);
  }
  if (childTemplates.length === 0) return node.template;
  const aggregated = aggregateTemplates(childTemplates);
  node.template = aggregated;
  return aggregated;
}

// ─────────────────────────────────────────────────────────────────
// 逐层递归聚合（LLM 合父三件套 + 批压缩 + DynamicHierarchyAnalyzer，§3.3）
// 迁移自 agentos v6 递归聚合内核，改造为 TS：去掉框架开销，保留"后序逐层 + 批压缩 + 规模自适应"，
// 顶在确定性 aggregateTemplates 之上——LLM 不可用时整体降级为确定性结构上卷（不抛错）。
// ─────────────────────────────────────────────────────────────────

/** 聚合规模档位（驱动批大小与是否做迭代归并）。 */
export type AggregationScale = "micro" | "meso" | "macro";

/** 层级规模分析结果（DynamicHierarchyAnalyzer，§3.3）。 */
export interface HierarchyAnalysis {
  totalNodes: number;
  leafCount: number;
  maxDepth: number;
  /** 最大扇出（单节点最多子节点数）。 */
  maxFanout: number;
  scale: AggregationScale;
  /** 推荐批压缩大小（macro 更小以控 prompt）。 */
  batchSize: number;
}

/**
 * DynamicHierarchyAnalyzer（§3.3）：据叶子规模选聚合策略。
 *   micro（≤25 叶）：直接逐层 LLM 合父；
 *   meso（≤300 叶）：批压缩(25) + 逐层合父；
 *   macro（>300 叶，千章级）：更小批(20) 迭代归并 + 逐层合父。
 */
export function analyzeHierarchy(dna: NarrativeIpDna): HierarchyAnalysis {
  let totalNodes = 0;
  let leafCount = 0;
  let maxDepth = 0;
  let maxFanout = 0;
  const walk = (id: string, depth: number): void => {
    const n = dna.nodes[id];
    if (!n) return;
    if (id !== dna.rootId) {
      totalNodes++;
      maxDepth = Math.max(maxDepth, depth);
      if (n.children.length === 0) leafCount++;
    }
    maxFanout = Math.max(maxFanout, n.children.length);
    for (const c of n.children) walk(c, depth + 1);
  };
  walk(dna.rootId, 0);
  const scale: AggregationScale = leafCount <= 25 ? "micro" : leafCount <= 300 ? "meso" : "macro";
  const batchSize = scale === "macro" ? 20 : 25;
  return { totalNodes, leafCount, maxDepth, maxFanout, scale, batchSize };
}

const PARENT_AGG_SYSTEM = loadIpDnaPrompt(
  "parent-aggregate",
  `你是叙事聚合助手。给定若干下层叙事单元的摘要（角色/场景/事件），综合归纳出其父层级的统一摘要：合并去重角色、概括场景脉络、串联事件主线，忠实不臆造、不引入原文没有的设定。仅输出 JSON：{"characters":["..."],"scene":"...","events":"..."}。`,
);

/**
 * LLM 合成父层级三件套（§3.3）。失败/无 LLM 时确定性降级为 aggregateSummaries。
 */
export async function synthesizeParentSummary(
  llm: LLMClient | undefined,
  title: string,
  children: TemplateSummary[],
): Promise<TemplateSummary> {
  if (children.length === 0) return { characters: [], scene: "", events: "" };
  const fallback = aggregateSummaries(children);
  if (!llm) return fallback;
  try {
    const body = children
      .map((c, i) => `## 子单元${i + 1}\n- 角色：${(c.characters ?? []).join("、")}\n- 场景：${c.scene}\n- 事件：${c.events}`)
      .join("\n\n");
    const raw = await llm.callWithRetry(
      PARENT_AGG_SYSTEM,
      `# 父层级标题\n${title}\n\n# 下层摘要\n${body}`,
      { responseFormat: "json", temperature: 0.3 },
    );
    const parsed = parseJSON<Partial<TemplateSummary>>(raw);
    return {
      characters: dedupe((parsed.characters ?? []).length > 0 ? parsed.characters! : fallback.characters),
      scene: parsed.scene?.trim() || fallback.scene,
      events: parsed.events?.trim() || fallback.events,
    };
  } catch {
    return fallback; // LLM 不可用 / 解析失败 → 确定性降级（§3.3）。
  }
}

/**
 * 批压缩 + 迭代归并（§3.3）：子摘要超 batchSize 时分批合并为更少中间摘要，反复直至 ≤batchSize，
 * 再合成最终父摘要。控制 prompt 体量，支撑千章级（macro）聚合。
 */
export async function batchCompressSummaries(
  llm: LLMClient | undefined,
  title: string,
  summaries: TemplateSummary[],
  batchSize = 25,
): Promise<TemplateSummary> {
  if (summaries.length === 0) return { characters: [], scene: "", events: "" };
  let level = summaries;
  let round = 0;
  while (level.length > batchSize) {
    round++;
    const next: TemplateSummary[] = [];
    for (let i = 0; i < level.length; i += batchSize) {
      const batch = level.slice(i, i + batchSize);
      next.push(await synthesizeParentSummary(llm, `${title}·第${round}轮·批${next.length + 1}`, batch));
    }
    level = next;
  }
  return synthesizeParentSummary(llm, title, level);
}

/** 逐层递归聚合选项。 */
export interface RecursiveAggregateOptions {
  /** 提供则 LLM 精炼父三件套；缺省走确定性结构上卷。 */
  llm?: LLMClient;
  /** 批压缩大小；缺省由 analyzeHierarchy 决定。 */
  batchSize?: number;
}

/**
 * 逐层递归聚合（§3.3 主入口）：后序遍历，先聚合子树，再用确定性 aggregateTemplates 上卷结构，
 * 最后（有 LLM 时）用 synthesizeParentSummary / batchCompressSummaries 精炼父层级三件套。
 * 原地写回每个内部节点 template，返回根子树聚合 template。LLM 不可用整体降级为确定性。
 */
export async function aggregateSubtreeTemplatesRecursive(
  dna: NarrativeIpDna,
  rootId: string,
  options: RecursiveAggregateOptions = {},
): Promise<NarrativeTemplate | undefined> {
  const batchSize = options.batchSize ?? analyzeHierarchy(dna).batchSize;
  const recurse = async (id: string): Promise<NarrativeTemplate | undefined> => {
    const node = dna.nodes[id];
    if (!node) return undefined;
    if (node.children.length === 0) return node.template;
    const sorted = [...node.children].sort((a, b) => dna.nodes[a].index - dna.nodes[b].index);
    const childTemplates: NarrativeTemplate[] = [];
    for (const c of sorted) {
      const t = await recurse(c);
      if (t) childTemplates.push(t);
    }
    if (childTemplates.length === 0) return node.template;
    const aggregated = aggregateTemplates(childTemplates); // 确定性结构上卷（worldview/角色/算子/拓扑）
    if (options.llm) {
      const childSummaries = childTemplates.map((t) => t.summary);
      aggregated.summary =
        childSummaries.length > batchSize
          ? await batchCompressSummaries(options.llm, node.title, childSummaries, batchSize)
          : await synthesizeParentSummary(options.llm, node.title, childSummaries);
    }
    node.template = aggregated;
    return aggregated;
  };
  return recurse(rootId);
}

/** 收集子树下所有节点的算子，去重成算子池（按 uid）。 */
export function collectOperatorPool(dna: NarrativeIpDna, rootId: string): NarrativeOperator[] {
  const pool = new Map<string, NarrativeOperator>();
  const walk = (id: string): void => {
    const node = dna.nodes[id];
    if (!node) return;
    for (const op of node.operators ?? []) if (!pool.has(op.uid)) pool.set(op.uid, op);
    for (const c of node.children) walk(c);
  };
  walk(rootId);
  return [...pool.values()];
}

// ─────────────────────────────────────────────────────────────────
// LLM 提取 seam：从单元正文抽取三件套
// ─────────────────────────────────────────────────────────────────

const UNIT_EXTRACT_SYSTEM = loadIpDnaPrompt(
  "unit-extract",
  `你是叙事 IP 提取助手。给定一个最小叙事单元的正文，提取其叙事模板与算子。仅输出 JSON（template + operators）。忠实原文、不臆造；summary 三件(characters/scene/events)必填。`,
);

/** 提取单个最小单元的三件套（LLM seam）。原地写回 node.template / node.operators。 */
export async function extractUnitTemplate(
  llm: LLMClient,
  node: HierarchyNode,
  unitText: string,
): Promise<void> {
  const raw = await llm.callWithRetry(
    UNIT_EXTRACT_SYSTEM,
    `# 单元标题\n${node.title}\n\n# 正文\n${unitText}`,
    { responseFormat: "json", temperature: 0.3 },
  );
  const parsed = parseJSON<{ template?: NarrativeTemplate; operators?: NarrativeOperator[] }>(raw);
  if (parsed.template) node.template = normalizeTemplate(parsed.template);
  node.operators = parsed.operators ?? [];
  node.metadata = {
    processing_status: "extracted",
    adaptation_status: "未改编",
    stats: { char_count: unitText.length, operator_count: (parsed.operators ?? []).length },
    updated_at: new Date().toISOString(),
  };
}

/**
 * 确定性兜底提取（无 LLM 时用于 dry-run / 离线管线自检）。
 * 只做最朴素的结构化：标题作事件、正文首段作场景。不臆造世界观/角色。
 */
export function heuristicExtractUnit(node: HierarchyNode, unitText: string): void {
  const firstChunk = unitText.replace(/\s+/g, " ").trim().slice(0, 120);
  node.template = normalizeTemplate({
    summary: { characters: [], scene: firstChunk, events: node.title },
  });
  node.operators = [];
  node.metadata = {
    processing_status: "extracted",
    adaptation_status: "未改编",
    stats: { char_count: unitText.length, operator_count: 0 },
    updated_at: new Date().toISOString(),
  };
}

/** 补齐 template 缺省字段，保证聚合不 NPE。 */
export function normalizeTemplate(t: Partial<NarrativeTemplate>): NarrativeTemplate {
  return {
    worldview: {
      setting: t.worldview?.setting ?? "",
      scene_structure: t.worldview?.scene_structure ?? "",
      item_inventory: t.worldview?.item_inventory ?? "",
    },
    characters: t.characters ?? [],
    story_structure: {
      topology: {
        nodeCount: t.story_structure?.topology?.nodeCount ?? 0,
        startCount: t.story_structure?.topology?.startCount ?? 0,
        endCount: t.story_structure?.topology?.endCount ?? 0,
        pivotCount: t.story_structure?.topology?.pivotCount ?? 0,
        mergeCount: t.story_structure?.topology?.mergeCount ?? 0,
      },
      plot_tree: t.story_structure?.plot_tree,
    },
    core_elements: {
      subject: t.core_elements?.subject ?? "",
      theme: t.core_elements?.theme ?? "",
      core_conflict: t.core_elements?.core_conflict ?? "",
      literature_style: t.core_elements?.literature_style ?? "",
      emotion_experience: t.core_elements?.emotion_experience ?? "",
    },
    summary: {
      characters: t.summary?.characters ?? [],
      scene: t.summary?.scene ?? "",
      events: t.summary?.events ?? "",
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// A→B：顶层 template 映射到 NarrativeContext（对齐 data-atlas）
// ─────────────────────────────────────────────────────────────────

/**
 * 把游戏单元顶层 template 映射进 NarrativeContext（A→B，§4.1 / data-atlas）。
 * 只填"输入理解可确定"的字段；其余生成字段交给后续生成管线。确定性转换。
 */
export function mapTemplateToContext(template: NarrativeTemplate, base: NarrativeContext): NarrativeContext {
  const ctx: NarrativeContext = { ...base };

  const protagonist = template.characters[0];
  const core_settings: CoreSettings = {
    world_name: ctx.story_title ?? "",
    world_setting: template.worldview.setting,
    world_summary: template.summary.scene,
    world_tags: { tone: [], theme: [template.core_elements.theme].filter(Boolean), hook: [] },
    protagonist: {
      name: protagonist?.name ?? "",
      identity: protagonist?.profile ?? "",
      personality: "",
      core_conflict: template.core_elements.core_conflict,
    },
    key_npcs: template.characters.slice(1).map((c) => ({
      name: c.name,
      identity: c.profile,
      personality: "",
      relationship_to_protagonist: (c.relationships ?? []).map((r) => `${r.target}:${r.relation}`).join("; "),
    })),
    main_theme: template.core_elements.theme,
    main_conflict: template.core_elements.core_conflict,
    narrative_perspective: "",
    genre: template.core_elements.subject,
  };
  ctx.core_settings = core_settings;

  // 初始大纲（A→B）：从 plot_tree 上卷 opening/development/ending + 关键节点，IP 已有则不丢。
  const plotTree = template.story_structure.plot_tree;
  const plotOutline = plotTree ? plotTreeToOutlineStructure(plotTree) : undefined;
  ctx.initial_story_outline = {
    theme: template.core_elements.theme,
    background: template.worldview.setting,
    character_arc: protagonist?.arc ?? "",
    main_conflict: template.core_elements.core_conflict,
    story_structure: plotOutline?.story_structure ?? { opening: "", development: [], ending: "" },
    key_plot_points: plotOutline?.key_plot_points ?? [],
  };

  // 叙事层世界观结构（A→B）：把模板世界观/规则上卷为 WorldviewStructure 的叙事侧骨架。
  // 深层"基础架构层/交互叙事层"留给后续生成管线细化，这里只落 IP 可确定的部分。
  const worldview_structure: WorldviewStructure = {
    world_name: core_settings.world_name,
    worldview_title: ctx.story_title,
    基础架构层: {
      时空背景: { setting: template.worldview.setting },
    },
    交互叙事层: {
      场景结构: { scene_structure: template.worldview.scene_structure },
      物品体系: { item_inventory: template.worldview.item_inventory },
    },
  };
  ctx.worldview_structure = worldview_structure;

  // 角色档案（A→B）：模板角色 → CharacterSheet（仅落确定字段，立绘/机制留生成）。
  ctx.detailed_character_sheets = template.characters.map((c, i): CharacterSheet => ({
    name: c.name,
    label: i === 0 ? "主角" : "NPC",
    role_in_story: c.profile,
    character_arc_spectrum: c.arc,
    background_information: c.profile,
    relationships: Object.fromEntries(
      (c.relationships ?? []).map((r) => [r.target, { relation: r.relation, detail: r.detail ?? "" }]),
    ),
    _is_player: i === 0 || undefined,
  }));

  // 场景地图（A→B，§4.2c worldview②）：把 IP 场景结构作为骨架种子带入；
  // 具体 SceneNode 由 scene_generation 步生成，这里只保留可确定的结构 md，避免丢失 IP 场景信息。
  if (template.worldview.scene_structure?.trim()) {
    ctx.scene_map = {
      world_name: core_settings.world_name,
      scenes: [],
      _scene_structure_md: template.worldview.scene_structure,
    } satisfies SceneMap;
  }

  // 道具库（A→B，§4.2c worldview③）：把道具清单切成种子条目，pipeline item_database 步再丰富。
  const items = parseItemInventory(template.worldview.item_inventory);
  if (items.length > 0) ctx.item_database = items;

  // 故事框架（A→B，§4.3）：plot_tree → StoryFramework.framework.nodes（确定性结构转换）。
  if (plotTree) ctx.story_framework = plotTreeToStoryFramework(plotTree);

  return ctx;
}

/** plot_tree → StoryFramework（节点拓扑确定性转换，§4.3）。 */
function plotTreeToStoryFramework(tree: PlotTree): StoryFramework {
  const nodes: FrameworkNode[] = tree.nodes.map((n, i) => ({
    node_id: n.id,
    name: n.title ?? n.id,
    narrative_function: n.nodeTypes.join("+") || "normal",
    main_content: n.title ?? "",
    is_branch: n.nodeTypes.includes("pivot") || undefined,
    prev_node: n.prevNodes,
    next_node: n.nextNodes.map((e) => e.to),
    sequence_index: i,
  }));
  return { framework: { nodes } };
}

/** plot_tree → InitialOutline 的结构部分（opening/development/ending + 关键节点）。 */
function plotTreeToOutlineStructure(tree: PlotTree): {
  story_structure: { opening: string; development: string[]; ending: string };
  key_plot_points: string[];
} {
  const titleOf = (id: string): string => tree.nodes.find((n) => n.id === id)?.title ?? id;
  const starts = tree.nodes.filter((n) => n.nodeTypes.includes("start"));
  const ends = tree.nodes.filter((n) => n.nodeTypes.includes("end"));
  const pivots = tree.nodes.filter((n) => n.nodeTypes.includes("pivot"));
  const opening = starts[0] ? titleOf(starts[0].id) : (tree.entryNodeId ? titleOf(tree.entryNodeId) : "");
  const ending = ends.map((n) => n.title ?? n.id).filter(Boolean).join("；");
  const development = pivots.map((n) => n.title ?? n.id).filter(Boolean);
  const key_plot_points = pivots.map((n) => n.question ?? n.title ?? n.id).filter(Boolean);
  return { story_structure: { opening, development, ending }, key_plot_points };
}

/** 把自由文本道具清单切成 GameItem 种子条目（确定性，分隔符切分 + 去噪 + 上限）。 */
function parseItemInventory(inventory: string): GameItem[] {
  const text = (inventory ?? "").trim();
  if (!text) return [];
  const segments = text
    .split(/[、，,；;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 40);
  const seen = new Set<string>();
  const items: GameItem[] = [];
  for (const name of segments) {
    if (seen.has(name)) continue;
    seen.add(name);
    items.push({
      name,
      category: "未分类",
      rarity: "common",
      description: name,
      effect: "",
      initial_owner: null,
      initial_scene: "",
      related_character: null,
      value: {},
      max_stack: 1,
    });
    if (items.length >= 30) break;
  }
  return items;
}

// ─────────────────────────────────────────────────────────────────
// 生成输入构建：IP DNA 顶层 template → 驱动既有生成管线的 userInput + uploadedScript
// ─────────────────────────────────────────────────────────────────

/**
 * 由顶层（已聚合）template + 原文切片，合成一份"忠实改编简报" + uploaded_script。
 * 这是 A→B 的运行时主驱动：既有生成管线消费 user_input / uploaded_script 完成 IP 改编，
 * 而 mapTemplateToContext 负责把可确定字段提前落到 NarrativeContext（resumeCtx 喂入）。
 */
export function buildGenerationInput(
  template: NarrativeTemplate,
  options?: { storyTitle?: string; sourceText?: string },
): { userInput: string; uploadedScript?: UploadedScript } {
  const ce = template.core_elements;
  const wv = template.worldview;
  const charLines = template.characters
    .map((c, i) => `  - ${i === 0 ? "【主角】" : "【角色】"}${c.name}：${c.profile}${c.arc ? `（弧光：${c.arc}）` : ""}`)
    .join("\n");

  const userInput = [
    `请基于以下 IP 叙事内核进行忠实游戏化改编${options?.storyTitle ? `（项目：${options.storyTitle}）` : ""}：`,
    options?.storyTitle ? `- ⭐全局标题：本作品统一使用《${options.storyTitle}》作为作品名，所有标题/命名须与之一致，不要另起新名。` : "",
    ce.subject ? `- 题材：${ce.subject}` : "",
    ce.theme ? `- 主题：${ce.theme}` : "",
    ce.core_conflict ? `- 核心冲突：${ce.core_conflict}` : "",
    ce.literature_style ? `- 文学风格：${ce.literature_style}` : "",
    ce.emotion_experience ? `- 情感体验：${ce.emotion_experience}` : "",
    wv.setting ? `- 世界设定：${wv.setting}` : "",
    charLines ? `- 主要角色：\n${charLines}` : "",
    template.summary.events ? `- 关键事件脉络：${template.summary.events}` : "",
    `\n要求：尊重原 IP 设定、人物关系与情节脉络，不臆造与原作冲突的核心设定。`,
  ]
    .filter(Boolean)
    .join("\n");

  const sourceText = options?.sourceText?.trim();
  const uploadedScript: UploadedScript | undefined = sourceText
    ? {
        content: sourceText,
        format: "prose",
        char_count: sourceText.length,
        description: "来自 IP DNA 改编范围内的原文切片，用于忠实改编参考。",
      }
    : undefined;

  return { userInput, uploadedScript };
}

// ─────────────────────────────────────────────────────────────────
// 提取质量评估（§14.2 D3）—— 结构完整性 + 三件套齐全 + 五大类算子统计
// ─────────────────────────────────────────────────────────────────

import type { QualityCheck } from "./job.js";
import type { OperatorDomain } from "../types/narrative-ip-dna.js";

/** 五大核心算子分类（§3.2），用于覆盖度统计。 */
const OPERATOR_DOMAINS: OperatorDomain[] = ["叙事者定位", "情感体验", "文学风格", "故事内容", "叙事技巧"];

/**
 * 评估一次 scoped 提取的质量（§14.2 D3）：把"结构完整性 + 三件套齐全 + 算子统计"这套
 * 蓝图要求的质量闸门接到提取链路上（此前 runWithRetry/QualityCheck 仅有定义、无调用）。
 *
 * - 选中叶子（minimal units）必须有 template（三件套之 ②）且 metadata 标记 extracted；
 * - 顶层聚合 template 的核心要素不应全空（结构完整性："开端-发展-高潮-结局"的语义载体）；
 * - 五大类算子覆盖统计（缺类记 warning，不判失败——算子只增强质量、不阻断生成 §3.3）。
 *
 * 设计为**非阻断**：返回告警供编排器 emit / 落盘，degrade 友好（passed=false 不抛错）。
 */
export function assessExtractionQuality(
  dna: NarrativeIpDna,
  selectedLeafIds: string[],
): QualityCheck {
  const checks: QualityCheck["checks"] = [];
  const warnings: string[] = [];

  // ① 层级树连通性：rootId 存在、被选叶子可经 parent 链回溯到 root。
  const rootOk = !!dna.nodes[dna.rootId];
  const connected =
    rootOk &&
    selectedLeafIds.every((id) => {
      let cur: string | null = id;
      const guard = new Set<string>();
      while (cur && !guard.has(cur)) {
        if (cur === dna.rootId) return true;
        guard.add(cur);
        cur = dna.nodes[cur]?.parent ?? null;
      }
      return cur === dna.rootId;
    });
  checks.push({ name: "层级树连通", passed: connected });
  if (!connected) warnings.push("部分选中单元无法回溯到根节点，层级树可能断裂。");

  // ② 三件套齐全（template + metadata.extracted）。
  const missing = selectedLeafIds.filter(
    (id) => !dna.nodes[id]?.template || dna.nodes[id]?.metadata?.processing_status !== "extracted",
  );
  const triadOk = selectedLeafIds.length > 0 && missing.length === 0;
  checks.push({
    name: "三件套齐全",
    passed: triadOk,
    detail: missing.length > 0 ? `缺失/未提取单元：${missing.length}` : undefined,
  });
  if (missing.length > 0) warnings.push(`有 ${missing.length} 个选中单元缺 template 或未标记 extracted。`);

  // ③ 结构完整性：顶层聚合 template 的核心要素不应全空。
  const leafTemplates = selectedLeafIds
    .map((id) => dna.nodes[id]?.template)
    .filter((t): t is NarrativeTemplate => !!t);
  const top = leafTemplates.length > 0 ? aggregateTemplates(leafTemplates) : undefined;
  const ce = top?.core_elements;
  const coreOk =
    !!ce && [ce.subject, ce.theme, ce.core_conflict, ce.literature_style, ce.emotion_experience].some((s) => !!s?.trim());
  checks.push({ name: "核心要素非空", passed: coreOk });
  if (!coreOk) warnings.push("顶层核心要素（题材/主题/冲突/风格/情感）全空，提取可能过于稀薄。");

  // ④ 五大类算子覆盖统计（缺类仅告警）。
  const operators = selectedLeafIds.flatMap((id) => dna.nodes[id]?.operators ?? []);
  const presentDomains = new Set(operators.map((o) => o.knowledge_domain).filter(Boolean));
  const missingDomains = OPERATOR_DOMAINS.filter((d) => !presentDomains.has(d));
  checks.push({
    name: "算子分类覆盖",
    passed: operators.length > 0,
    detail: `共 ${operators.length} 个算子；覆盖 ${OPERATOR_DOMAINS.length - missingDomains.length}/${OPERATOR_DOMAINS.length} 类`,
  });
  if (operators.length === 0) warnings.push("未提取到任何算子（生成将退化为无算子增强，仍可跑通）。");
  else if (missingDomains.length > 0) warnings.push(`算子未覆盖分类：${missingDomains.join("、")}。`);

  return { passed: checks.every((c) => c.passed), checks, warnings };
}

// ─────────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────────

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.filter(Boolean))];
}
function joinNonEmpty(arr: string[], sep: string): string {
  return arr.filter(Boolean).join(sep);
}
function firstNonEmpty(arr: string[]): string {
  return arr.find(Boolean) ?? "";
}
function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
function mergeRelationships(
  a: TemplateCharacter["relationships"],
  b: TemplateCharacter["relationships"],
): TemplateCharacter["relationships"] {
  const map = new Map<string, { target: string; relation: string; detail?: string }>();
  for (const r of [...(a ?? []), ...(b ?? [])]) map.set(`${r.target}|${r.relation}`, r);
  return [...map.values()];
}
