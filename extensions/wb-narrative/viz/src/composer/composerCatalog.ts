/**
 * 叙事无限画布编排 — 角色调色板目录（五大类 agent）。
 *
 * 五类角色：
 *  - input     输入节点（适配 INPUT）：一次需求的锚点，一条管线以一个输入节点为起点。
 *  - routing   路由节点（适配 ROUTING）：承载 tier/细分类/品类/复杂度，决定下游生成管线。
 *  - expert    叙事策划专家（按游戏品类，预制管线；对应 4 个原型专家）。
 *  - assistant 叙事策略助手（按叙事策略/结构，作为可插拔提示词加载进相应环节）。
 *  - engineer  叙事单品工程师（复刻某一生成环节，对应后端 PIPELINE_STEPS 里的单步）。
 *
 * 说明：本目录仅驱动前端自由编排（拖拽/连线/配置同步）。真正"开始生成"仍以输入节点为锚点，
 * 用路由节点配置调用现有整条管线（startRun），自定义步序的后端执行延后。
 */
import type { TierId } from "../types";
import type { PipelineTemplateId } from "../pipeline-templates";

export type ComposerNodeCategory =
  | "input"
  | "routing"
  | "expert"
  | "assistant"
  | "engineer";

export interface ComposerCatalogItem {
  /** 目录内唯一 id（用于拖拽 dataTransfer 与节点回溯）。 */
  id: string;
  category: ComposerNodeCategory;
  /** i18n 键（缺失时回退 label）。 */
  labelKey: string;
  /** 回退中文标签。 */
  label: string;
  icon: string;
  /** 专家：预制管线模板 + 默认 tier + 路由组。 */
  pipelineTemplate?: PipelineTemplateId;
  tier?: TierId;
  routeGroup?: "planning" | "narrative";
  /** 助手：对应叙事策略/生成模式（mode）。工程师：对应 PIPELINE_STEPS 单步 id。 */
  stepId?: string;
  modeId?: string;
  /** 拖入画布时写到节点 config 的默认值。 */
  defaultConfig?: Record<string, unknown>;
}

export interface ComposerCategoryDef {
  category: ComposerNodeCategory;
  labelKey: string;
  label: string;
  icon: string;
  /** 单例类别（input/routing）只允许拖入一次锚点/路由（前端软约束）。 */
  singleton?: boolean;
  items: ComposerCatalogItem[];
}

/** 五大类调色板目录。顺序即调色板从左到右的展示顺序。 */
export const COMPOSER_CATALOG: ComposerCategoryDef[] = [
  {
    category: "input",
    labelKey: "composer.cat.input",
    label: "输入",
    icon: "◉",
    items: [
      {
        id: "input.default",
        category: "input",
        labelKey: "composer.item.input",
        label: "输入",
        icon: "◉",
        defaultConfig: { userInput: "" },
      },
    ],
  },
  {
    category: "routing",
    labelKey: "composer.cat.routing",
    label: "路由",
    icon: "⤳",
    items: [
      {
        id: "routing.default",
        category: "routing",
        labelKey: "composer.item.routing",
        label: "路由",
        icon: "⤳",
        defaultConfig: {
          routeGroup: "planning",
          tier: null,
          genreCode: null,
          complexity: undefined,
        },
      },
    ],
  },
  {
    category: "expert",
    labelKey: "composer.cat.expert",
    label: "叙事策划专家",
    icon: "◆",
    items: [
      {
        id: "expert.jrpg",
        category: "expert",
        labelKey: "composer.item.expert.jrpg",
        label: "JRPG 叙事策划专家",
        icon: "◆",
        pipelineTemplate: "tpl-rpg",
        tier: "tier1",
        routeGroup: "planning",
      },
      {
        id: "expert.orpg",
        category: "expert",
        labelKey: "composer.item.expert.orpg",
        label: "ORPG 叙事策划专家",
        icon: "◆",
        pipelineTemplate: "tpl-open-world",
        tier: "tier1",
        routeGroup: "planning",
      },
      {
        id: "expert.film_game",
        category: "expert",
        labelKey: "composer.item.expert.film_game",
        label: "互动影游叙事策划专家",
        icon: "◆",
        pipelineTemplate: "tpl-vn-v2",
        tier: "tier1",
        routeGroup: "planning",
      },
      {
        id: "expert.other",
        category: "expert",
        labelKey: "composer.item.expert.other",
        label: "其他品类叙事策划专家",
        icon: "◆",
        pipelineTemplate: "tpl-rpg",
        tier: "tier1",
        routeGroup: "planning",
      },
    ],
  },
  {
    category: "assistant",
    labelKey: "composer.cat.assistant",
    label: "叙事策略助手",
    icon: "❖",
    items: [
      { id: "assistant.worldview", category: "assistant", labelKey: "composer.item.assistant.worldview", label: "世界观策略助手", icon: "❖", modeId: "worldview" },
      { id: "assistant.character", category: "assistant", labelKey: "composer.item.assistant.character", label: "角色策略助手", icon: "❖", modeId: "character" },
      { id: "assistant.story_framework", category: "assistant", labelKey: "composer.item.assistant.story_framework", label: "故事框架策略助手", icon: "❖", modeId: "story_framework" },
      { id: "assistant.story_outline", category: "assistant", labelKey: "composer.item.assistant.story_outline", label: "故事大纲策略助手", icon: "❖", modeId: "story_outline" },
      { id: "assistant.detailed_outline", category: "assistant", labelKey: "composer.item.assistant.detailed_outline", label: "故事细纲策略助手", icon: "❖", modeId: "detailed_outline" },
      { id: "assistant.branch", category: "assistant", labelKey: "composer.item.assistant.branch", label: "分支叙事策略助手", icon: "❖", modeId: "vn_full" },
      { id: "assistant.fragmented", category: "assistant", labelKey: "composer.item.assistant.fragmented", label: "碎片叙事策略助手", icon: "❖", modeId: "fragmented" },
      { id: "assistant.emergent", category: "assistant", labelKey: "composer.item.assistant.emergent", label: "涌现叙事策略助手", icon: "❖", modeId: "emergent" },
      { id: "assistant.card_narrative", category: "assistant", labelKey: "composer.item.assistant.card_narrative", label: "卡牌叙事策略助手", icon: "❖", modeId: "card_narrative" },
      { id: "assistant.open_world", category: "assistant", labelKey: "composer.item.assistant.open_world", label: "开放世界叙事策略助手", icon: "❖", modeId: "open_world_narrative" },
      { id: "assistant.vn", category: "assistant", labelKey: "composer.item.assistant.vn", label: "影游叙事策略助手", icon: "❖", modeId: "vn_full" },
    ],
  },
  {
    category: "engineer",
    labelKey: "composer.cat.engineer",
    label: "叙事单品工程师",
    icon: "▣",
    items: [
      { id: "engineer.preference_summary", category: "engineer", labelKey: "composer.item.engineer.preference_summary", label: "偏好总结工程师", icon: "▣", stepId: "preference_summary" },
      { id: "engineer.initial_plan", category: "engineer", labelKey: "composer.item.engineer.initial_plan", label: "初步方案工程师", icon: "▣", stepId: "initial_plan" },
      { id: "engineer.worldview", category: "engineer", labelKey: "composer.item.engineer.worldview", label: "世界观工程师", icon: "▣", stepId: "worldview" },
      { id: "engineer.character_enrichment", category: "engineer", labelKey: "composer.item.engineer.character_enrichment", label: "角色档案工程师", icon: "▣", stepId: "character_enrichment" },
      { id: "engineer.item_database", category: "engineer", labelKey: "composer.item.engineer.item_database", label: "道具清单工程师", icon: "▣", stepId: "item_database" },
      { id: "engineer.story_framework", category: "engineer", labelKey: "composer.item.engineer.story_framework", label: "故事框架工程师", icon: "▣", stepId: "story_framework" },
      { id: "engineer.outline_batch", category: "engineer", labelKey: "composer.item.engineer.outline_batch", label: "故事大纲工程师", icon: "▣", stepId: "outline_batch" },
      { id: "engineer.detailed_outline", category: "engineer", labelKey: "composer.item.engineer.detailed_outline", label: "故事细纲工程师", icon: "▣", stepId: "detailed_outline" },
      { id: "engineer.plot_generation", category: "engineer", labelKey: "composer.item.engineer.plot_generation", label: "情节生成工程师", icon: "▣", stepId: "plot_generation" },
      { id: "engineer.script_generation", category: "engineer", labelKey: "composer.item.engineer.script_generation", label: "剧本生成工程师", icon: "▣", stepId: "script_generation" },
      { id: "engineer.quest_generation", category: "engineer", labelKey: "composer.item.engineer.quest_generation", label: "任务生成工程师", icon: "▣", stepId: "quest_generation" },
      { id: "engineer.scene_generation", category: "engineer", labelKey: "composer.item.engineer.scene_generation", label: "场景生成工程师", icon: "▣", stepId: "scene_generation" },
      { id: "engineer.narrative_card", category: "engineer", labelKey: "composer.item.engineer.narrative_card", label: "叙事卡工程师", icon: "▣", stepId: "narrative_card" },
    ],
  },
];

const ITEM_INDEX: Record<string, ComposerCatalogItem> = (() => {
  const idx: Record<string, ComposerCatalogItem> = {};
  for (const cat of COMPOSER_CATALOG) {
    for (const item of cat.items) idx[item.id] = item;
  }
  return idx;
})();

export function findCatalogItem(id: string): ComposerCatalogItem | undefined {
  return ITEM_INDEX[id];
}

/** 拖拽 payload 的 MIME 键（HTML5 dataTransfer）。 */
export const COMPOSER_DND_MIME = "application/x-forgeax-composer-role";

// ── 运行期编排数据（store composer 切片使用） ──────────────────────────────

export interface ComposerNodeData {
  id: string;
  category: ComposerNodeCategory;
  /** 溯源 catalog item id。 */
  catalogId: string;
  label: string;
  icon: string;
  position: { x: number; y: number };
  /** 节点级配置（输入文本 / 路由参数 / 专家助手工程师选项）。 */
  config: Record<string, unknown>;
  pipelineTemplate?: PipelineTemplateId;
  tier?: TierId | null;
  routeGroup?: "planning" | "narrative";
  stepId?: string;
  modeId?: string;
}

export interface ComposerEdgeData {
  id: string;
  source: string;
  target: string;
}

/** 以输入节点为锚点拆分出的一条可提交管线。 */
export interface AnchoredPipeline {
  inputNode: ComposerNodeData;
  /** 从输入节点前向可达的全部节点（含输入节点本身）。 */
  nodeIds: string[];
  /** 该管线内的路由节点（若有；取第一个可达路由节点）。 */
  routingNode?: ComposerNodeData;
  /** 可达节点，按到输入节点的距离排序（拓扑近似）。 */
  orderedNodes: ComposerNodeData[];
}

/** 拖入画布时把 catalog item 实例化为一个编排节点。 */
export function instantiateComposerNode(
  item: ComposerCatalogItem,
  position: { x: number; y: number },
  id: string,
): ComposerNodeData {
  return {
    id,
    category: item.category,
    catalogId: item.id,
    label: item.label,
    icon: item.icon,
    position,
    config: { ...(item.defaultConfig ?? {}) },
    pipelineTemplate: item.pipelineTemplate,
    tier: item.tier ?? null,
    routeGroup: item.routeGroup,
    stepId: item.stepId,
    modeId: item.modeId,
  };
}

/**
 * 以输入节点为锚点，前向 BFS 拆分子图。孤立节点（无输入节点可达）被忽略。
 * 每个输入节点独立成一条管线（对应多入口=多条目）。
 */
export function computeAnchoredPipelines(
  nodes: ComposerNodeData[],
  edges: ComposerEdgeData[],
): AnchoredPipeline[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const pipelines: AnchoredPipeline[] = [];
  for (const input of nodes.filter((n) => n.category === "input")) {
    const visited = new Set<string>([input.id]);
    const ordered: ComposerNodeData[] = [input];
    const queue: string[] = [input.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        const node = byId.get(next);
        if (node) ordered.push(node);
        queue.push(next);
      }
    }
    const routingNode = ordered.find((n) => n.category === "routing");
    pipelines.push({
      inputNode: input,
      nodeIds: [...visited],
      routingNode,
      orderedNodes: ordered,
    });
  }
  return pipelines;
}
