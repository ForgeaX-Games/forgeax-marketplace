/**
 * 文件系统布局（Filesystem Layout）—— 蓝图 §6「落盘与文件系统」/ §14.2 D4-D5 的可执行实现。
 *
 * 两大根目录（与现有 api/server.ts 的 output 约定对齐）：
 *
 *   input/<时间戳>_<故事名>/         （输入侧三段式）
 *     ├─ _original/                   原始上传（多模态/压缩包，Phase0 归档）
 *     ├─ _processing/                 标准化中间产物（含 _compress 解压临时区，Phase1）
 *     │    └─ _compress/
 *     └─ _extraction_output/          IP DNA 提取产物（三件套，Phase2）
 *          └─ <node_id>/{template,operators,metadata}.json   ← 每层每文件夹必有三件套
 *
 *   output/<时间戳>_<故事名>/        （输出侧，生成产物）
 *     ├─ <序号>_<名>.<ext>            生成步骤产物（沿用 server.ts 既有格式）
 *     ├─ 算子方案/                     算子方案 JSON（§6.4，文件名不带时间戳）
 *     │    └─ <节点>_operator_solution.json
 *     └─ _checkpoint.json             断点续传
 *
 * input 与 output 同名（<时间戳>_<故事名>）即可关联同一完整故事（§6.0）。
 * 层级树支持按层分文件懒加载（§14.2 D4）：层级树本身是索引，三件套按节点目录存放。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  NarrativeIpDna,
  HierarchyNode,
  NarrativeTemplate,
  NarrativeOperator,
  NodeMetadata,
  OperatorSolution,
  StoryTimestamp,
  UserAssetManifest,
} from "../types/narrative-ip-dna.js";
import { NARRATIVE_IP_DNA_SCHEMA_VERSION, migrateIpDnaSchema } from "../types/narrative-ip-dna.js";

/** 三件套文件名（每层每文件夹必有）。 */
export const TRIAD_FILES = {
  template: "template.json",
  operators: "operators.json",
  metadata: "metadata.json",
} as const;

/** 层级树索引文件名（懒加载时只读这个，节点正文按需读）。 */
export const HIERARCHY_INDEX_FILE = "_hierarchy.json";

/** 用户资产参考清单文件名（§6.2，落在 input 运行目录根）。 */
export const USER_ASSET_MANIFEST_FILE = "user_asset_manifest.json";

/** 文件名安全化（与 server.ts savePerNodeFiles 同款规则）。 */
export function safeName(raw: string): string {
  return String(raw).replace(/[/\\?%*:|"<>]/g, "_");
}

/** 输入/输出共用的"运行名"：<时间戳>_<故事名>。 */
export function runName(timestamp: StoryTimestamp, title: string): string {
  const safeTitle = safeName(title || "untitled");
  return `${timestamp}_${safeTitle}`;
}

export interface LayoutRoots {
  /** 进程根（默认 process.cwd()）。 */
  cwd?: string;
}

function resolveCwd(roots?: LayoutRoots): string {
  return roots?.cwd ?? process.cwd();
}

// ─────────────────────────────────────────────────────────────────
// 输入侧三段式路径
// ─────────────────────────────────────────────────────────────────

export function inputRunDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(resolveCwd(roots), "input", runName(timestamp, title));
}

export function originalDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(inputRunDir(timestamp, title, roots), "_original");
}

/** 输入模态（§2 模态分目录）；映射自 modalityOf 的 text/image/video。 */
export type InputModality = "text" | "image" | "video";

/** 模态 → _original 子目录名（对齐产品蓝图命名：text→book、image→picture、video→video）。 */
export const MODAL_SUBDIR: Record<InputModality, string> = {
  text: "book",
  image: "picture",
  video: "video",
};

/** 模态分目录：input/<run>/_original/<book|picture|video>/（§2）。 */
export function modalOriginalDir(
  timestamp: StoryTimestamp,
  title: string,
  modality: InputModality,
  roots?: LayoutRoots,
): string {
  return path.join(originalDir(timestamp, title, roots), MODAL_SUBDIR[modality]);
}

/** 压缩包暂存目录：input/<run>/_package/（§2，解压后成员归入各模态 _original）。 */
export function packageDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(inputRunDir(timestamp, title, roots), "_package");
}

export function processingDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(inputRunDir(timestamp, title, roots), "_processing");
}

export function compressDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(processingDir(timestamp, title, roots), "_compress");
}

/** 某节点的标准化处理目录：_processing/<节点>/（每节点一目录，存 content.md）。 */
export function nodeProcessingDir(
  timestamp: StoryTimestamp,
  title: string,
  nodeId: string,
  nodeTitle: string,
  roots?: LayoutRoots,
): string {
  const folder = `${safeName(nodeId)}_${safeName(nodeTitle).slice(0, 40)}`;
  return path.join(processingDir(timestamp, title, roots), folder);
}

/**
 * 落盘单个节点的标准化正文为嵌套 markdown（_processing/<节点>/content.md，§6.1）。
 * 标准化产物按层级树结构镜像存放，便于审阅与断点续处理。
 */
export function saveNodeProcessingMarkdown(
  timestamp: StoryTimestamp,
  title: string,
  nodeId: string,
  nodeTitle: string,
  content: string,
  roots?: LayoutRoots,
): string {
  const dir = nodeProcessingDir(timestamp, title, nodeId, nodeTitle, roots);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "content.md");
  fs.writeFileSync(file, `# ${nodeTitle}\n\n${content}\n`, "utf-8");
  return file;
}

export function extractionOutputDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(inputRunDir(timestamp, title, roots), "_extraction_output");
}

/** 某层级节点的三件套目录。 */
export function nodeTriadDir(
  timestamp: StoryTimestamp,
  title: string,
  nodeId: string,
  roots?: LayoutRoots,
): string {
  return path.join(extractionOutputDir(timestamp, title, roots), safeName(nodeId));
}

// ─────────────────────────────────────────────────────────────────
// 输出侧路径（与 server.ts output 约定对齐）
// ─────────────────────────────────────────────────────────────────

export function outputRunDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(resolveCwd(roots), "output", runName(timestamp, title));
}

/** IP DNA 运行清单文件名（output/<runId>/manifest.json，与既有 narrative 运行清单同名同构）。 */
export const IP_DNA_RUN_MANIFEST_FILE = "manifest.json";

/**
 * 落盘「运行清单」到 output 运行目录（output/<runId>/manifest.json），使 IP DNA 运行
 * （半自动 / 全自动）能被 `GET /api/narrative/history` 列出（§5.1 历史可见性）。
 *
 * 此前 IP DNA 主链产物落在 input/<runId>，生成产物只写 game_unit_N.json，从不写运行清单，
 * 故 history（只扫 output 的 manifest.json）始终列不出，进程重启打断的运行更是无迹可寻。
 *
 * 与既有 narrative 运行清单字段同构（runId/status/startedAt/updatedAt/tier/mode…），
 * 增量浅合并、幂等覆盖；首写补 startedAt，每写刷新 updatedAt。中断（进程重启）后残留的
 * "running" 由 server 的 cleanupStaleRunningManifests 统一翻为 "interrupted"，从而可见。
 */
export function saveIpDnaRunManifest(
  timestamp: StoryTimestamp,
  title: string,
  patch: Record<string, unknown>,
  roots?: LayoutRoots,
): void {
  const dir = outputRunDir(timestamp, title, roots);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, IP_DNA_RUN_MANIFEST_FILE);
  const prev = readJson<Record<string, unknown>>(file) ?? {};
  const now = new Date().toISOString();
  const merged: Record<string, unknown> = {
    ...prev,
    kind: "ip-dna",
    runId: prev.runId ?? runName(timestamp, title),
    title,
    story_timestamp: timestamp,
    startedAt: prev.startedAt ?? now,
    ...patch,
    updatedAt: now,
  };
  writeJson(file, merged);
}

/** 算子方案目录（§6.4，外层已有时间戳，本目录不再带时间戳）。 */
export function operatorSolutionDir(timestamp: StoryTimestamp, title: string, roots?: LayoutRoots): string {
  return path.join(outputRunDir(timestamp, title, roots), "算子方案");
}

// ─────────────────────────────────────────────────────────────────
// 落盘 / 读取（含懒加载）
// ─────────────────────────────────────────────────────────────────

function writeJson(filepath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf-8");
}

function readJson<T>(filepath: string): T | undefined {
  if (!fs.existsSync(filepath)) return undefined;
  return JSON.parse(fs.readFileSync(filepath, "utf-8")) as T;
}

/**
 * 落盘整棵 IP DNA：层级树写索引文件（剥离三件套正文），三件套各节点分目录写。
 * 这样上层只需读 `_hierarchy.json` 即可遍历结构，三件套按需懒加载（§14.2 D4）。
 */
export function saveIpDna(dna: NarrativeIpDna, roots?: LayoutRoots): void {
  const { story_id, title } = dna;
  const extractDir = extractionOutputDir(story_id, title, roots);
  fs.mkdirSync(extractDir, { recursive: true });

  // 索引：节点结构（剥离三件套正文，仅留是否存在的标记由文件系统体现）。
  const index: NarrativeIpDna = {
    ...dna,
    nodes: Object.fromEntries(
      Object.entries(dna.nodes).map(([id, node]) => [
        id,
        { ...node, template: undefined, operators: undefined, metadata: node.metadata },
      ]),
    ),
  };
  writeJson(path.join(extractDir, HIERARCHY_INDEX_FILE), index);

  // 三件套：每节点一个目录。
  for (const node of Object.values(dna.nodes)) {
    const dir = nodeTriadDir(story_id, title, node.id, roots);
    if (node.template !== undefined) writeJson(path.join(dir, TRIAD_FILES.template), node.template);
    if (node.operators !== undefined) writeJson(path.join(dir, TRIAD_FILES.operators), node.operators);
    if (node.metadata !== undefined) writeJson(path.join(dir, TRIAD_FILES.metadata), node.metadata);
  }
}

/** 标准化全文文件名（_processing/standardized.txt，阶段门续跑时复读）。 */
export const STANDARDIZED_TEXT_FILE = "standardized.txt";

/** 改编指令落盘文件名（_extraction_output/adaptation_directive.json，§4.4 续跑/审阅）。 */
export const ADAPTATION_DIRECTIVE_FILE = "adaptation_directive.json";

/** 改编确认态文件名（阶段门半自动：confirm-scope/confirm-units 增量回填，extract 消费）。 */
export const ADAPTATION_CONFIRMATION_FILE = "_adaptation_confirmation.json";

/**
 * 仅落盘层级树骨架索引（阶段门 §5.1）：标准化(Phase1)后还没提取三件套时，
 * 先把可编辑的层级树写到 _hierarchy.json，供 UI/agent 审阅与确认裁剪范围，
 * 不写三件套目录（便宜，覆盖整部）。后续 runExtract 会用 saveIpDna 覆盖为完整版。
 */
export function saveHierarchyIndexOnly(dna: NarrativeIpDna, roots?: LayoutRoots): void {
  const { story_id, title } = dna;
  const extractDir = extractionOutputDir(story_id, title, roots);
  fs.mkdirSync(extractDir, { recursive: true });
  const index: NarrativeIpDna = {
    ...dna,
    nodes: Object.fromEntries(
      Object.entries(dna.nodes).map(([id, node]) => [
        id,
        { ...node, template: undefined, operators: undefined, metadata: node.metadata },
      ]),
    ),
  };
  writeJson(path.join(extractDir, HIERARCHY_INDEX_FILE), index);
}

/** 读取标准化全文（_processing/standardized.txt），阶段门续跑时重建提取所需正文。 */
export function loadStandardizedText(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): string | undefined {
  const file = path.join(processingDir(timestamp, title, roots), STANDARDIZED_TEXT_FILE);
  if (!fs.existsSync(file)) return undefined;
  return fs.readFileSync(file, "utf-8");
}

/** 落盘改编指令（§4.4）：confirm-scope/units 后持久化，供 runExtract 续跑与审阅复用。 */
export function saveAdaptationDirective(
  directive: { story_id: StoryTimestamp },
  title: string,
  roots?: LayoutRoots,
): void {
  const dir = extractionOutputDir(directive.story_id, title, roots);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, ADAPTATION_DIRECTIVE_FILE), directive);
}

/** 只读改编指令（§4.4），无则 undefined。 */
export function loadAdaptationDirective<T = unknown>(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): T | undefined {
  return readJson<T>(path.join(extractionOutputDir(timestamp, title, roots), ADAPTATION_DIRECTIVE_FILE));
}

/**
 * 增量保存改编确认态（阶段门半自动）：confirm-scope / confirm-units 分次回填，
 * extract/generate 一次性消费。与已有确认态浅合并（幂等覆盖同名字段）。
 */
export function saveAdaptationConfirmation(
  timestamp: StoryTimestamp,
  title: string,
  patch: Record<string, unknown>,
  roots?: LayoutRoots,
): Record<string, unknown> {
  const dir = extractionOutputDir(timestamp, title, roots);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, ADAPTATION_CONFIRMATION_FILE);
  const prev = readJson<Record<string, unknown>>(file) ?? {};
  const merged = { ...prev, ...patch };
  writeJson(file, merged);
  return merged;
}

/** 只读改编确认态（阶段门）。 */
export function loadAdaptationConfirmation(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): Record<string, unknown> | undefined {
  return readJson<Record<string, unknown>>(
    path.join(extractionOutputDir(timestamp, title, roots), ADAPTATION_CONFIRMATION_FILE),
  );
}

/**
 * 落盘《用户资产参考清单》(§6.2) 到 input 运行目录根（user_asset_manifest.json）。
 * 随阶段更新 processing_status / guessed_levels 后复调即可覆盖（幂等）。
 */
export function saveManifest(manifest: UserAssetManifest, roots?: LayoutRoots): void {
  const dir = inputRunDir(manifest.story_id, manifest.title, roots);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, USER_ASSET_MANIFEST_FILE), manifest);
}

/** 只读《用户资产参考清单》(§6.2)。 */
export function loadManifest(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): UserAssetManifest | undefined {
  return readJson<UserAssetManifest>(
    path.join(inputRunDir(timestamp, title, roots), USER_ASSET_MANIFEST_FILE),
  );
}

/** 只读层级树索引（按 runId=<时间戳>_<故事名> 直接定位，前端审阅用）。 */
export function loadHierarchyIndexByRun(runId: string, roots?: LayoutRoots): NarrativeIpDna | undefined {
  const raw = readJson<NarrativeIpDna>(
    path.join(resolveCwd(roots), "input", safeName(runId), "_extraction_output", HIERARCHY_INDEX_FILE),
  );
  return raw ? migrateIpDnaSchema(raw) : undefined;
}

/** 只读层级树索引（懒加载入口，不加载三件套正文）。加载即按需做 schema 迁移（§14.2 D5）。 */
export function loadHierarchyIndex(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): NarrativeIpDna | undefined {
  const raw = readJson<NarrativeIpDna>(
    path.join(extractionOutputDir(timestamp, title, roots), HIERARCHY_INDEX_FILE),
  );
  return raw ? migrateIpDnaSchema(raw) : undefined;
}

/** 按需加载单个节点的三件套（懒加载）。 */
export function loadNodeTriad(
  timestamp: StoryTimestamp,
  title: string,
  nodeId: string,
  roots?: LayoutRoots,
): { template?: NarrativeTemplate; operators?: NarrativeOperator[]; metadata?: NodeMetadata } {
  const dir = nodeTriadDir(timestamp, title, nodeId, roots);
  return {
    template: readJson<NarrativeTemplate>(path.join(dir, TRIAD_FILES.template)),
    operators: readJson<NarrativeOperator[]>(path.join(dir, TRIAD_FILES.operators)),
    metadata: readJson<NodeMetadata>(path.join(dir, TRIAD_FILES.metadata)),
  };
}

/**
 * 断点续传（§14.2）：加载层级索引并 hydrate 全部节点三件套回内存的完整 IP DNA。
 * 无持久化 checkpoint（_hierarchy.json 不存在）时返回 undefined。
 */
export function loadFullIpDna(
  timestamp: StoryTimestamp,
  title: string,
  roots?: LayoutRoots,
): NarrativeIpDna | undefined {
  const index = loadHierarchyIndex(timestamp, title, roots);
  if (!index) return undefined;
  const nodes: NarrativeIpDna["nodes"] = {};
  for (const id of Object.keys(index.nodes)) {
    const triad = loadNodeTriad(timestamp, title, id, roots);
    nodes[id] = { ...index.nodes[id], ...triad };
  }
  return { ...index, nodes };
}

/** 把索引节点连同其三件套完整加载回内存（hydrate 单节点）。 */
export function hydrateNode(
  index: NarrativeIpDna,
  nodeId: string,
  roots?: LayoutRoots,
): HierarchyNode | undefined {
  const node = index.nodes[nodeId];
  if (!node) return undefined;
  const triad = loadNodeTriad(index.story_id, index.title, nodeId, roots);
  return { ...node, ...triad };
}

/** 落盘算子方案（§6.4）：每次消费算子写一个 JSON。 */
export function saveOperatorSolution(
  solution: OperatorSolution,
  title: string,
  roots?: LayoutRoots,
): string {
  const dir = operatorSolutionDir(solution.story_id, title, roots);
  const filename = `${safeName(solution.node)}_operator_solution.json`;
  writeJson(path.join(dir, filename), solution);
  return path.join(dir, filename);
}

/** 新建一棵空 IP DNA（顶层 complete 根节点）。 */
export function createEmptyIpDna(args: {
  story_id: StoryTimestamp;
  title: string;
  media_type: NarrativeIpDna["media_type"];
}): NarrativeIpDna {
  const rootId = "root";
  const root: HierarchyNode = {
    id: rootId,
    levelType: "complete",
    index: 0,
    title: args.title,
    parent: null,
    children: [],
  };
  return {
    schema_version: NARRATIVE_IP_DNA_SCHEMA_VERSION,
    story_id: args.story_id,
    title: args.title,
    media_type: args.media_type,
    rootId,
    nodes: { [rootId]: root },
  };
}
