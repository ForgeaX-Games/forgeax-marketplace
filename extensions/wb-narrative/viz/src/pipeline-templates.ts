/**
 * Pipeline template identity + display labels（纯展示层）。
 *
 * Phase-2 M9：这里曾经镜像后端 templates.ts 的每模板 step 列表，供 UI 在 SSE
 * announce 帧到达前先画一条"将要跑的链"。代价是同一套步序存在两份实现，模板改动
 * 必须同步改前端，漂移时用户看到的预览是假的。步序真值现在只有后端
 * POST /api/narrative/plan 一处，本文件只保留模板 id 与人类可读标签。
 */
export type PipelineTemplateId =
  | "tpl-jrpg"
  | "tpl-jrpg-v2"
  | "tpl-rpg"
  | "tpl-vn"
  | "tpl-vn-v2"
  | "tpl-open-world"
  | "tpl-card-game"
  | "tpl-fragmented"
  | "tpl-emergent"
  | "tpl-narrative-card"
  | "tpl-light";

export const TEMPLATE_LABELS: Record<PipelineTemplateId, string> = {
  "tpl-jrpg": "tpl-jrpg",
  "tpl-jrpg-v2": "tpl-jrpg-v2",
  "tpl-rpg": "tpl-jrpg-v2",
  "tpl-vn": "[已废弃] 视觉小说 / 互动影游 v1",
  "tpl-vn-v2": "tpl-vn-v2",
  "tpl-open-world": "开放世界 RPG",
  "tpl-card-game": "卡牌游戏叙事",
  "tpl-fragmented": "碎片化叙事",
  "tpl-emergent": "涌现性叙事",
  "tpl-narrative-card": "叙事卡（Tier4）",
  "tpl-light": "轻量管线（Tier3）",
};
