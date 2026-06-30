/**
 * 复合步骤：剧本 + 场景耦合生成
 *
 * 设计哲学：
 * - P1: 场景骨架 (LLM) — 从世界观+大纲提取 L0-L2 场景（结构化 description）
 * - Loop per plot node (有序/分支可并行):
 *     剧本章节 (LLM) → 该节点场景扩展 P2 (LLM)
 * - P3: 场景合并去重 (Code) — 纯算法合并引擎，层级式 uid + MD 树形目录
 *
 * 叙事拓扑排序：同一条线上的章节严格有序，分支可并行。
 */
import type { NarrativeContext, PlotNode, ScriptChapter } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { processScriptNode } from "./script-generation.js";
import { processSceneUnit } from "./scene-generation.js";
import { extractJSON } from "../llm-client.js";
import { buildDesignContextSnippet, appendUserInstructions } from "./design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK } from "../prompt-composer.js";
import type { PromptComposer } from "../prompt-composer.js";
import {
  aggregateScenes,
  skeletonToRaw,
  expandedToRaw,
  buildPerNodeMd,
} from "../scene-aggregator.js";

/**
 * Topological sort of plot nodes: nodes on independent branches can be grouped
 * into parallel "waves". Within each wave, nodes are independent and can run concurrently.
 */
function topologicalWaves(plots: PlotNode[]): PlotNode[][] {
  const nodeMap = new Map(plots.map(p => [p.node_id, p]));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();
  const plotIds = new Set(plots.map(p => p.node_id));

  for (const p of plots) {
    if (!inDegree.has(p.node_id)) inDegree.set(p.node_id, 0);
    if (!adjList.has(p.node_id)) adjList.set(p.node_id, []);

    for (const next of (p.next_node ?? [])) {
      if (!plotIds.has(next)) continue;
      adjList.get(p.node_id)!.push(next);
      inDegree.set(next, (inDegree.get(next) ?? 0) + 1);
    }
  }

  const waves: PlotNode[][] = [];
  let queue = plots.filter(p => (inDegree.get(p.node_id) ?? 0) === 0);

  while (queue.length > 0) {
    waves.push(queue);
    const nextQueue: PlotNode[] = [];
    for (const node of queue) {
      for (const nextId of (adjList.get(node.node_id) ?? [])) {
        const deg = (inDegree.get(nextId) ?? 1) - 1;
        inDegree.set(nextId, deg);
        if (deg === 0) {
          const nextNode = nodeMap.get(nextId);
          if (nextNode) nextQueue.push(nextNode);
        }
      }
    }
    queue = nextQueue;
  }

  return waves;
}

// ---------------------------------------------------------------------------
// Phase 1 — L0-L2 scene skeleton (same prompt as scene-generation.ts)
// ---------------------------------------------------------------------------

const SSG_ROLE = `你是游戏场景设计专家。请从世界观、故事框架和大纲中提取场景骨架（L0-L2层级）。所有输出使用中文。`;

const SSG_TASK_SPEC = `## 6 层场景结构

| 层级 | 名称 | 说明 |
|------|------|------|
| L0 | 世界 | 整个游戏世界（唯一根节点） |
| L1 | 区域 | 世界的主要分区（大陆/城邦/星球） |
| L2 | 地域 | 区域内的具体地域（城市/森林/遗迹） |

## 要求
- Phase1 只提取 L0-L2 层级
- 从世界观中提取地理环境和势力分布
- 从故事大纲中提取出现过的地点
- name：纯中文，禁止空格、-、_、括号等特殊字符
- parent：父节点 name，根节点留空
- label：场景标签数组，可选值 "narrative"、"decoration"、"path"、"entrance"
- description：结构化三维描述对象`;

const SSG_OUTPUT_SCHEMA = `输出JSON：
{
  "world_name": "世界名称",
  "scenes": [
    {
      "name": "世界名",
      "parent": "",
      "label": ["narrative"],
      "description": {
        "location_description": "空间位置与功能描述",
        "art_style_description": "美术风格与氛围描述",
        "semantics_description": "叙事语义功能描述"
      },
      "level": 0
    }
  ]
}`;

export const SCRIPT_SCENE_SKELETON_COMPOSER: PromptComposer = {
  stepId: "script_scene_generation",
  blocks: {
    role: SSG_ROLE,
    task_spec: SSG_TASK_SPEC,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output_schema: SSG_OUTPUT_SCHEMA,
  },
  systemBlockOrder: ["role", "task_spec", "ip_dna", "style_guide", "constraints", "output_schema"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildPhase1Prompt(ctx: NarrativeContext): string {
  const worldview = JSON.stringify(ctx.worldview_structure ?? {}, null, 2);
  const framework = ctx.story_framework
    ? JSON.stringify(ctx.story_framework.framework.nodes.map(n => ({
        node_id: n.node_id, name: n.name, main_content: n.main_content,
      })), null, 2)
    : "（无）";
  const outlines = ctx.outlines_generated
    ? JSON.stringify(ctx.outlines_generated.outlines.map(o => ({
        node_id: o.node_id, name: o.name, content: o.content,
      })), null, 2)
    : "（无）";

  return `## 世界观设定
${worldview}

## L0 故事框架
${framework}

## L1 大纲
${outlines}

## 核心设定
- 世界名称：${ctx.core_settings?.world_name ?? "未命名世界"}
${buildDesignContextSnippet(ctx)}
请提取场景骨架（L0-L2）。`;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

interface SkeletonScene {
  name: string;
  parent: string;
  level: number;
  label?: unknown;
  description?: unknown;
}

interface RawExpandedScene {
  name: string;
  parent?: string;
  label?: unknown;
  description?: unknown;
  level?: number;
  story_units?: string[];
}

export async function scriptSceneGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const plots = ctx.plots_generated?.plots ?? [];
  if (plots.length === 0) return;

  // ── P1: 场景骨架提取 ──
  const phase1Raw = await llm.callWithRetry(
    composeSystemPrompt(SCRIPT_SCENE_SKELETON_COMPOSER, ctx),
    appendUserInstructions(buildPhase1Prompt(ctx), ctx),
    { responseFormat: "json" },
    (r) => {
      const p = extractJSON<Record<string, unknown>>(r);
      if (!Array.isArray(p.scenes) || p.scenes.length === 0)
        throw new Error("scenes必须是非空数组");
    },
  );

  const skeleton = extractJSON<{ world_name: string; scenes: SkeletonScene[] }>(phase1Raw);
  const skeletonScenes = skeleton.scenes;
  const worldName = skeleton.world_name ?? ctx.core_settings?.world_name ?? "游戏世界";

  // ── 按拓扑排序组织波次 ──
  const waves = topologicalWaves(plots);
  const allChapters: ScriptChapter[] = [];
  const allExpandedBatches: ReturnType<typeof expandedToRaw>[] = [];
  const phase2PerNode: Record<string, RawExpandedScene[]> = {};
  const phase2PerNodeMd: Record<string, string> = {};
  let processedCount = 0;
  const totalNodes = plots.length;
  const subEmit = (ctx as Record<string, unknown>)._subEmit as
    ((nodeId: string, nodeDone: number, nodeTotal: number, message?: string) => void) | undefined;

  let batchIdx = 0;
  for (const wave of waves) {
    const waveResults = await Promise.all(
      wave.map(async (plot) => {
        const index = plots.indexOf(plot);
        const myNum = processedCount + index + 1;

        subEmit?.(plot.node_id, processedCount, totalNodes,
          `剧本+场景: ${plot.node_id} 剧本生成中 (${myNum}/${totalNodes})`);

        const chapter = await processScriptNode(plot, index, plots.length, ctx, llm);

        const scriptInfo = {
          title: chapter.title,
          scenes: chapter.scenes.map(s => ({
            location: s.location,
            atmosphere: s.atmosphere,
          })),
        };

        subEmit?.(plot.node_id, processedCount, totalNodes,
          `剧本+场景: ${plot.node_id} 场景展开中 (${myNum}/${totalNodes})`);

        const expandedScenes = await processSceneUnit(plot, skeletonScenes, llm, ctx, scriptInfo);

        return { plot, chapter, expandedScenes };
      }),
    );

    processedCount += wave.length;
    subEmit?.(wave[0]?.node_id ?? "", processedCount, totalNodes,
      `剧本+场景: ${processedCount}/${totalNodes} 完成`);

    for (const { plot, chapter, expandedScenes } of waveResults) {
      allChapters.push(chapter);
      phase2PerNode[plot.node_id] = expandedScenes;
      phase2PerNodeMd[plot.node_id] = buildPerNodeMd(
        expandedScenes.map((s, idx) => ({
          uid: `tmp_${idx}`, name: s.name ?? "", parent: s.parent ?? "",
          parent_uid: null, parent_name: null, parent_level: null,
          scene_level: s.level ?? 3, label: ["narrative" as const],
          description: { location_description: "", art_style_description: "", semantics_description: "" },
          story_units: s.story_units,
        })),
      );
      allExpandedBatches.push(expandedToRaw(expandedScenes, batchIdx++));
    }
  }

  // 按原始 plot 顺序排序章节
  const plotOrder = new Map(plots.map((p, i) => [p.node_id, i]));
  allChapters.sort((a, b) => (plotOrder.get(a.plot_node_id) ?? 0) - (plotOrder.get(b.plot_node_id) ?? 0));

  ctx.jrpg_script = {
    title: ctx.core_settings?.world_name ?? "JRPG剧本",
    chapters: allChapters,
  };

  // ── P3: 场景合并去重 (scene-aggregator) ──
  const skeletonRaw = skeletonToRaw(skeletonScenes);
  const { scenes: mergedScenes, structureMd, uidMap } = aggregateScenes(worldName, skeletonRaw, allExpandedBatches);

  // Back-fill UIDs from merged result into intermediate snapshots
  const lookupUid = (name: string): string => uidMap.get(name) ?? "";

  ctx.scene_map = {
    world_name: worldName,
    scenes: mergedScenes,
    _phase1_skeleton: skeletonRaw.map(s => ({
      uid: lookupUid(s.name), name: s.name, parent: s.parent,
      parent_uid: null, parent_name: null, parent_level: null,
      scene_level: s.scene_level ?? 0, label: s.label,
      description: s.description, level: s.scene_level ?? 0,
    })),
    _phase2_per_node: Object.fromEntries(
      Object.entries(phase2PerNode).map(([k, v]) => [k, v.map(s => ({
        uid: lookupUid(s.name ?? ""), name: s.name ?? "", parent: s.parent ?? "",
        parent_uid: null, parent_name: null, parent_level: null,
        scene_level: s.level ?? 3, label: ["narrative" as const],
        description: typeof s.description === "object" && s.description !== null
          ? s.description as { location_description: string; art_style_description: string; semantics_description: string }
          : { location_description: String(s.description ?? ""), art_style_description: "", semantics_description: "" },
        story_units: s.story_units, level: s.level ?? 3,
      }))]),
    ),
    _phase2_per_node_md: phase2PerNodeMd,
    _scene_structure_md: structureMd,
  };
}
