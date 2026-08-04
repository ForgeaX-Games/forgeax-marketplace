import fs from "node:fs";
import path from "node:path";

/**
 * §条目持久化（统一"条目"模型，无"草稿"一说）。
 *
 * 一次用户需求 = 一个条目，键为首次输入确认时前端铸造的 `<时间戳>`。条目的**全部参数**
 * （INPUT 参数 + ROUTING 参数）落盘到 `output/<key>/_entry.json`，与生成产物同处一个目录，
 * 使"确认输入即建条目、任何阶段点击都能还原 INPUT/ROUTING(+结果)"成立。
 *
 * 与 input/ 的分工：input/ 只存"输入了什么"（IP 作品整条媒体处理链：原始→标准化→压缩→结构化 IP DNA）。
 * IP 作品的 ROUTING 参数仍归 output/<key>/_entry.json，用 `ipRunKey=<时间戳>_<标题>` 指针桥接到媒体目录。
 */
export interface EntryConfig {
  key?: string;
  /** INPUT 来源类型：文本 / 标签 / IP 作品上传。 */
  inputType?: "text" | "tags" | "works";
  userInput?: string;
  tags?: { selections?: Record<string, string>; customTexts?: Record<string, string> };
  uploadedFileNames?: string[];
  routeGroup?: "planning" | "narrative";
  /** 叙事层级：三期起由 genreCode 派生的只读值，不再是用户选择项。 */
  tier?: string;
  mode?: string;
  genreCode?: string;
  /** 三轴路由（PRD v1.4 §3.2.2）；旧条目无这三个字段，读取端一律按可空处理。 */
  storyType?: string;
  storyTheme?: string;
  narrativeStructure?: string;
  /** 叙事体量档位（1-5）。 */
  complexity?: number;
  /** UI locale for generated narrative content (en/zh). */
  locale?: "en" | "zh";
  /** IP 作品桥接指针：指向 input 媒体目录下的运行键（<时间戳>_<标题>）。 */
  ipRunKey?: string;
  /** 完成态分叉来源条目键（本条目由某已完成条目改配置后新建）。 */
  parentKey?: string;
  /**
   * Phase-1 多管线条目：一条目 = 一组 RunManifest（按独立开始节点切分）。
   * 形状与 types/run-manifest.RunManifest 对齐；旧条目无此字段时视为单管线。
   */
  pipelines?: unknown[];
  /** 当前聚焦的管线 id（状态栏/文本视图默认展示）。 */
  activePipelineId?: string;
  /** LIST 是否展开显示多管线子行。 */
  listExpanded?: boolean;
  /**
   * 资产库（PRD v1.4 §5.1）：作者确认、可供下游生成引用的产物。
   * 元素是 `<group>/<相对路径>`，与 GET /api/narrative/files/:key 返回的分组路径同形；
   * 不在此列表里的落盘文件都只是资源库里的原料/中间产物。
   */
  assets?: string[];
  /** 画布编排拓扑快照（nodes/edges），供刷新恢复。 */
  compositionNodes?: unknown[];
  compositionEdges?: unknown[];
  createdAt?: string;
  updatedAt?: string;
}

/** key 安全校验：仅允许安全的相对目录名（防目录穿越）。 */
export function isSafeKey(key: unknown): key is string {
  return typeof key === "string" && /^[A-Za-z0-9_.-]+$/.test(key) && !key.includes("..");
}

/** _entry.json 在 output/<key>/ 下的绝对路径。 */
export function entryPath(outputDir: string, key: string): string {
  return path.join(outputDir, key, "_entry.json");
}

/** 读取条目配置；不存在或损坏返回 null。 */
export function loadEntry(outputDir: string, key: string): EntryConfig | null {
  if (!isSafeKey(key)) return null;
  const p = entryPath(outputDir, key);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as EntryConfig;
  } catch {
    return null;
  }
}

/**
 * upsert 条目配置到 output/<key>/_entry.json。合并语义：保留已有 createdAt，
 * 刷新 updatedAt，patch 中 undefined 字段不覆盖既有值。返回落盘后的完整配置。
 */
export function writeEntry(outputDir: string, key: string, patch: Partial<EntryConfig>): EntryConfig {
  if (!isSafeKey(key)) throw new Error(`invalid entry key: ${String(key)}`);
  const dir = path.join(outputDir, key);
  fs.mkdirSync(dir, { recursive: true });
  const existing = loadEntry(outputDir, key) ?? {};
  const now = new Date().toISOString();
  const merged: EntryConfig = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  }
  merged.key = key;
  merged.createdAt = existing.createdAt ?? now;
  merged.updatedAt = now;
  fs.writeFileSync(path.join(dir, "_entry.json"), JSON.stringify(merged, null, 2), "utf-8");
  return merged;
}
