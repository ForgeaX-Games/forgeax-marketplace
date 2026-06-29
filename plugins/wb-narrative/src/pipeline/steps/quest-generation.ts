/**
 * L5 任务生成（QuestGeneration）
 *
 * 为每个情节节点(L3)生成任务。6个一组并行调用LLM。
 * 每个节点生成完毕立即通过 ctx._saveNode 原子保存，
 * 并将 node_id 加入 ctx._questCompletedNodes 供场景生成监控。
 */
import type { NarrativeContext, PlotNode, Quest, QuestGraph, ScriptChapter } from "../../types/index.js";
import type { LLMClient } from "../llm-client.js";
import { extractJSON } from "../llm-client.js";
import { chunkArray } from "../topo-sort.js";
import { buildDesignContextSnippet, appendUserInstructions } from "./design-context-helper.js";
import { composeSystemPrompt, IP_DNA_SLOT_BLOCK } from "../prompt-composer.js";
import type { PromptComposer } from "../prompt-composer.js";
import { getNodeFilter } from "../node-merge.js";
import { runGraphQA, type GraphAdapter, type QaGraph } from "../../utils/graph-qa.js";

export const QUEST_GENERATION_COMPOSER: PromptComposer = {
  stepId: "quest_generation",
  blocks: {
    role: `你是游戏任务系统策划，请为给定的情节节点生成游戏任务。所有输出使用中文。`,
    task_spec: `## 任务结构要求

每个任务必须包含：
1. **quest_id**: 格式 "q_情节节点ID"
2. **name**: 任务名称
3. **type**: main(主线)/side(支线)/exploration(探索)/collection(收集)/challenge(挑战)
4. **description**: 任务描述（含故事因果）
5. **story_node_id**: 关联的情节节点ID
6. **chapter_id**: 关联的剧本章节ID "sc_节点ID"
7. **framework_node**: 所属的框架阶段节点ID
8. **trigger**: 触发条件 { type(auto/npc/area/item/event/quest_complete), condition, npc?, scene? }
9. **objectives**: 目标数组 [{ description, type(talk/reach/collect/defeat/interact/explore/escort/custom), target, count?, optional? }]
10. **completion**: 完成条件 { type(auto/turn_in), condition, npc?, scene? }
11. **rewards**: { items?:[{name,count}], unlock?, description }
12. **prerequisites**: 前置任务ID数组
13. **next_quests**: 后续任务ID数组

## 设计原则

- 主线任务（main）对应核心剧情推进
- 支线任务丰富世界观、角色关系
- 触发条件必须基于剧情上下文（不能凭空）
- 奖励道具应尽量来自道具清单
- 前后任务链必须符合剧情时间线`,
    ip_dna: IP_DNA_SLOT_BLOCK,
    style_guide: "{{SKILL.style_guide}}",
    constraints: "{{SKILL.constraints}}",
    output_schema: `输出JSON对象：
{"quests": [{ ... }]}`,
  },
  systemBlockOrder: ["role", "task_spec", "ip_dna", "style_guide", "constraints", "output_schema"],
  userBlockOrder: [],
  skillSlots: ["style_guide", "constraints"],
};

function buildChapterDigest(chapter: ScriptChapter | undefined): string {
  if (!chapter) return "（无）";
  const lines = [
    `标题: ${chapter.title}, 类型: ${chapter.chapter_type}`,
    `冲突: ${chapter.conflict?.type ?? ""}, 赌注: ${chapter.conflict?.stakes ?? ""}`,
    `场景: ${(chapter.scenes ?? []).map(s => s.location).filter(Boolean).join(", ")}`,
  ];
  return lines.join("\n");
}

function buildUserPrompt(
  plot: PlotNode,
  ctx: NarrativeContext,
  chapter: ScriptChapter | undefined,
): string {
  const plotPrevIds = (plot.prev_node ?? []).join(", ") || "无";
  const plotNextIds = (plot.next_node ?? []).join(", ") || "无";

  const itemList = (ctx.item_database ?? [])
    .map(i => `${i.name} (${i.category}, ${i.rarity})`)
    .join(", ") || "（无道具清单）";

  return `## 情节节点
${JSON.stringify(plot, null, 2)}

## 前后情节关系
- 前置节点: ${plotPrevIds}
- 后续节点: ${plotNextIds}

## 剧本章节摘要
${buildChapterDigest(chapter)}

## 角色档案
${JSON.stringify((ctx.detailed_character_sheets ?? []).map(c => ({ name: c.name, label: c.label, occupation: c.occupation })), null, 2)}

## 道具清单
${itemList}

## 世界观
${JSON.stringify(ctx.worldview_structure ?? {}, null, 2)}
${buildDesignContextSnippet(ctx)}
请为此情节节点生成任务JSON。`;
}

function normalizeQuest(raw: Record<string, unknown>, plot: PlotNode): Quest {
  const trigger = (raw.trigger ?? {}) as Record<string, unknown>;
  const completion = (raw.completion ?? {}) as Record<string, unknown>;
  const rewards = (raw.rewards ?? {}) as Record<string, unknown>;

  return {
    quest_id: String(raw.quest_id ?? `q_${plot.node_id}`),
    name: String(raw.name ?? ""),
    type: (["main", "side", "exploration", "collection", "challenge"].includes(String(raw.type))
      ? raw.type : "main") as Quest["type"],
    description: String(raw.description ?? ""),
    story_node_id: plot.node_id,
    chapter_id: `sc_${plot.node_id}`,
    framework_node: String(raw.framework_node ?? plot.parent_id ?? ""),
    trigger: {
      type: (["auto", "npc", "area", "item", "event", "quest_complete"].includes(String(trigger.type))
        ? trigger.type : "auto") as Quest["trigger"]["type"],
      condition: String(trigger.condition ?? ""),
      ...(trigger.npc ? { npc: String(trigger.npc) } : {}),
      ...(trigger.scene ? { scene: String(trigger.scene) } : {}),
    },
    objectives: Array.isArray(raw.objectives)
      ? (raw.objectives as Array<Record<string, unknown>>).map(o => ({
          description: String(o.description ?? ""),
          type: (["talk", "reach", "collect", "defeat", "interact", "explore", "escort", "custom"]
            .includes(String(o.type)) ? o.type : "custom") as Quest["objectives"][number]["type"],
          target: String(o.target ?? ""),
          ...(o.count !== undefined ? { count: Number(o.count) } : {}),
          ...(o.optional !== undefined ? { optional: Boolean(o.optional) } : {}),
        }))
      : [],
    completion: {
      type: (["auto", "turn_in"].includes(String(completion.type))
        ? completion.type : "auto") as Quest["completion"]["type"],
      condition: String(completion.condition ?? ""),
      ...(completion.npc ? { npc: String(completion.npc) } : {}),
      ...(completion.scene ? { scene: String(completion.scene) } : {}),
    },
    rewards: {
      description: String(rewards.description ?? ""),
      ...(Array.isArray(rewards.items)
        ? { items: (rewards.items as Array<Record<string, unknown>>).map(i => ({
            name: String(i.name ?? ""), count: Number(i.count ?? 1),
          })) }
        : {}),
      ...(rewards.unlock ? { unlock: String(rewards.unlock) } : {}),
    },
    prerequisites: Array.isArray(raw.prerequisites) ? raw.prerequisites.map(String) : [],
    next_quests: Array.isArray(raw.next_quests) ? raw.next_quests.map(String) : [],
  };
}

async function processQuestNode(
  plot: PlotNode,
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<Quest[]> {
  const chapter = ctx.jrpg_script?.chapters.find(c => c.plot_node_id === plot.node_id);

  const rawText = await llm.callWithRetry(
    composeSystemPrompt(QUEST_GENERATION_COMPOSER, ctx),
    appendUserInstructions(buildUserPrompt(plot, ctx, chapter), ctx),
    { responseFormat: "json" },
    (r) => {
      const parsed = extractJSON(r);
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>).quests;
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error("输出必须包含 quests 数组且不为空");
      }
    },
  );

  const parsed = extractJSON<Record<string, unknown>>(rawText);
  const arr = Array.isArray(parsed) ? parsed : (parsed.quests as Array<Record<string, unknown>>);
  return arr.map(q => normalizeQuest(q as Record<string, unknown>, plot));
}

export async function questGeneration(
  ctx: NarrativeContext,
  llm: LLMClient,
): Promise<void> {
  const { runParallel } = await import("../parallel-runner.js");
  const allPlots = ctx.plots_generated?.plots ?? [];
  if (allPlots.length === 0) return;

  const nodeFilter = getNodeFilter(ctx);
  const plots = nodeFilter
    ? allPlots.filter(p => nodeFilter.has(p.node_id))
    : allPlots;

  const allQuests: Quest[] = [];
  const rawCompleted = (ctx as Record<string, unknown>)._questCompletedNodes;
  const completedNodes: Set<string> = rawCompleted instanceof Set
    ? rawCompleted
    : new Set<string>(Array.isArray(rawCompleted) ? rawCompleted : []);
  (ctx as Record<string, unknown>)._questCompletedNodes = completedNodes;

  if (!ctx.quest_graph) {
    ctx.quest_graph = { quests: [], main_quest_chain: [], branch_quests: {} };
  }

  const saveNode = (ctx as Record<string, unknown>)._saveNode as
    ((stepId: string, nodeId: string, data: unknown) => void) | undefined;

  const batches = chunkArray(plots, 6);

  for (const batch of batches) {
    const tasks = batch.map((plot, idx) => ({
      id: plot.node_id,
      sequenceIndex: idx,
      run: async () => {
        const quests = await processQuestNode(plot, ctx, llm);
        allQuests.push(...quests);
        ctx.quest_graph!.quests.push(...quests);
        completedNodes.add(plot.node_id);
        saveNode?.("quest_generation", plot.node_id, quests);
        return quests;
      },
    }));

    await runParallel(tasks, 6);
  }

  const mainChain = allQuests
    .filter(q => q.type === "main")
    .map(q => q.quest_id);

  const branchQuests: Record<string, string[]> = {};
  for (const q of allQuests) {
    if (q.type !== "main") {
      const parent = q.story_node_id;
      if (!branchQuests[parent]) branchQuests[parent] = [];
      branchQuests[parent].push(q.quest_id);
    }
  }

  ctx.quest_graph = {
    quests: allQuests,
    main_quest_chain: mainChain,
    branch_quests: branchQuests,
  };

  // 结构质量门：任务链是多入口 DAG（允许多个无前置入口 + 自然终止任务），
  // 故 flagDeadEnds=false、孤儿仅 warn。逐节点独立生成易出现指向不存在 quest_id
  // 的悬空 next_quests（运行时会断链）→ 算法去重 + 删真悬空边；不重建 prerequisites
  // （两方向语义不同，避免覆盖 LLM 意图），不开 LLM critic。仅全量生成时执行
  // （局部重跑时 quests 仅子集，跨子集引用会被误判为悬空）。
  if (!nodeFilter) await qaQuestGraph(ctx.quest_graph);
}

function questGraphAdapter(): GraphAdapter<QuestGraph> {
  return {
    toCanonical(qg: QuestGraph): QaGraph {
      const nodes = qg.quests.map((q) => ({
        id: q.quest_id,
        next: [...(q.next_quests ?? [])],
        label: q.name,
      }));
      const mainRoot = qg.main_quest_chain?.[0] ?? qg.quests[0]?.quest_id ?? "";
      return { rootId: mainRoot, nodes };
    },
    applyRepairs(qg: QuestGraph, repaired: QaGraph): void {
      const byId = new Map(qg.quests.map((q) => [q.quest_id, q]));
      for (const cn of repaired.nodes) {
        const q = byId.get(cn.id);
        if (q) q.next_quests = cn.next; // 仅写回清理后的出边，不动 prerequisites
      }
    },
  };
}

async function qaQuestGraph(qg: QuestGraph): Promise<void> {
  if (!Array.isArray(qg.quests) || qg.quests.length === 0) return;
  const extraRoots = qg.quests.filter((q) => (q.prerequisites ?? []).length === 0).map((q) => q.quest_id);
  await runGraphQA(qg, questGraphAdapter(), {
    label: "quest_graph",
    flagDeadEnds: false,
    orphanSeverity: "warn",
    extraRoots,
    allowLlmRepair: false,
  });
}
