/**
 * 干扰项 / 非目标物过滤 —— 蓝图 §1 引言所指 agentos 三提取管线的「识别非目标物」算法 TS 移植。
 *
 * 参考实现：MyFile/agents/workflow_book_extraction/chapter_filter_utils.py
 *
 * 标准化阶段在建好层级树后，剔除「非正文/干扰」节点（引言/序/前言/作者互动/感言/求月票/
 * 附录/设定/广告/公告等），使这些非主体内容不参与后续提取与生成；保留正文章节 +
 * 特殊章节（后记/番外/尾声/终章/大结局——属于故事内容，序号接在正常章节后）。
 *
 * 设计：确定性、可单测；只看节点标题（标准化后标题=原文件名/标记），不动正文。
 * 多模态（图片画册重复页、视频片头片尾）先留规则接口（isLikelyMediaNoise 占位）。
 */

import type { NarrativeIpDna, HierarchyNode } from "../types/narrative-ip-dna.js";

/** 特殊章节关键词（属于故事内容，保留，序号接在正常章节后）。 */
export const SPECIAL_CHAPTER_KEYWORDS = [
  "后记", "後記", "番外", "尾声", "尾聲", "终章", "終章", "大结局", "大結局",
];

/** 非正文前缀关键词（标题以这些开头则视为干扰项过滤）。 */
export const NON_CONTENT_PREFIXES = [
  "引言", "引子", "楔子", "序言", "序章", "序", "前言", "卷首语", "卷首語",
  "人物志", "完结感言", "完本感言", "完结", "完本",
  "感言", "感谢", "感謝", "致谢", "致謝", "作者", "关于", "關於",
  "请假", "請假", "求月票", "求推荐", "求推薦", "更新", "公告", "通知",
  "上架", "爆更", "加更", "停更", "断更", "斷更",
  "附录", "附錄", "设定", "設定", "世界观", "世界觀",
  "参加", "參加", "沙龙", "沙龍", "活动", "活動",
  "持续", "持續", "厮杀", "廝殺", "郑重", "鄭重", "拜求",
  "广告", "廣告", "推广", "推廣",
];

/** 非正文完整匹配模式（标题完全匹配这些则过滤）。 */
const NON_CONTENT_EXACT_PATTERNS: RegExp[] = [
  /^引[言子]$/,
  /^楔子$/,
  /^序[言章]?$/,
  /^前言$/,
  /^人物志$/,
  /^完[结本].*$/,
  /^感[言谢謝].*$/,
  /^作者.*$/,
  /^关于.*$/,
  /^關於.*$/,
];

function normalizeTitle(raw: string): string {
  return String(raw ?? "").trim();
}

/** 是否为特殊章节（后记/番外等，保留为正文）。 */
export function isSpecialChapter(title: string): boolean {
  const t = normalizeTitle(title);
  if (!t) return false;
  return SPECIAL_CHAPTER_KEYWORDS.some((kw) => t.startsWith(kw) || t.includes(kw));
}

/** 是否为非正文/干扰节点（应过滤）。特殊章节优先豁免。 */
export function isNonContentTitle(title: string): boolean {
  const t = normalizeTitle(title);
  if (!t) return false;
  if (isSpecialChapter(t)) return false;
  if (NON_CONTENT_PREFIXES.some((p) => t.startsWith(p))) return true;
  if (NON_CONTENT_EXACT_PATTERNS.some((re) => re.test(t))) return true;
  return false;
}

/** 多模态干扰占位（图片重复页/视频片头片尾），当前留接口恒 false，后续按规则补齐。 */
export function isLikelyMediaNoise(_title: string): boolean {
  return false;
}

export interface NoiseFilterResult {
  /** 被过滤掉的节点 id 列表。 */
  filtered: string[];
  /** 被过滤掉的节点标题（供审阅展示）。 */
  filteredTitles: string[];
}

/**
 * 原地过滤层级树中的干扰/非正文节点（连同其子树）：
 *   - 从父节点 children 中摘除；
 *   - 从 dna.nodes 删除该节点及其子孙；
 *   - 保留正文章节与特殊章节（后记/番外）。
 *
 * 仅过滤非根、非 complete 顶层的节点；root 永不删除。
 */
export function filterNoiseNodes(dna: NarrativeIpDna): NoiseFilterResult {
  const filtered: string[] = [];
  const filteredTitles: string[] = [];

  const collectSubtree = (id: string, acc: string[]): void => {
    const node = dna.nodes[id];
    if (!node) return;
    acc.push(id);
    for (const c of node.children ?? []) collectSubtree(c, acc);
  };

  // 收集要删除的顶层干扰节点（自身命中即整棵子树删除）。
  const toRemove: HierarchyNode[] = [];
  for (const node of Object.values(dna.nodes)) {
    if (node.id === dna.rootId) continue;
    if (node.levelType === "complete") continue;
    if (isNonContentTitle(node.title) || isLikelyMediaNoise(node.title)) {
      // 仅当父节点不也是待删（避免重复），这里简单标记后统一处理。
      toRemove.push(node);
    }
  }

  const removedSet = new Set<string>();
  for (const node of toRemove) {
    if (removedSet.has(node.id)) continue;
    const subtree: string[] = [];
    collectSubtree(node.id, subtree);
    // 从父 children 摘除。
    const parent = node.parent ? dna.nodes[node.parent] : undefined;
    if (parent) parent.children = parent.children.filter((c) => c !== node.id);
    for (const id of subtree) {
      if (removedSet.has(id)) continue;
      removedSet.add(id);
      filtered.push(id);
      filteredTitles.push(dna.nodes[id]?.title ?? id);
      delete dna.nodes[id];
    }
  }

  return { filtered, filteredTitles };
}
