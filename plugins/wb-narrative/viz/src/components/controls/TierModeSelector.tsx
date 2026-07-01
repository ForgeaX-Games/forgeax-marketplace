import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { BookOpen, ClipboardList, FileUp, PenLine, Tags, Upload, X } from "lucide-react";
import { WorkbenchStepSection } from "../sidebar/WorkbenchStepSection";
import { WorkbenchFieldSelect } from "../sidebar/WorkbenchFieldSelect";
import { useNarrativeStore } from "../../store/narrativeStore";
import {
  fetchModes,
  fetchGenres,
  startRun,
  resumeRun,
  cancelRun,
  fetchHistory,
  loadHistoryResult,
  useNarrativeStream,
  analyzeImpact,
  regenerateStep,
  fetchIpDnaJob,
  ipDnaCancel,
  fetchIpDnaHierarchy,
} from "../../hooks/useNarrativeStream";
import type { IpDnaHierarchySummary } from "../../hooks/useNarrativeStream";
import type { HistoryEntry, GenreCategoryGroup, IpDnaFilePayload, IpDnaJobStatus } from "../../hooks/useNarrativeStream";
import { IpStageFlow, type IpUploadDisplay } from "./IpStageFlow";
import { tryRestoreFromStorage } from "../../store/narrativeStore";
import type { TierId, ModeId, NarrativeContext } from "../../types";
import { PIPELINE_STEPS, STEP_CTX_FIELD } from "../../types";
import {
  PIPELINE_TEMPLATE_STEPS,
  type PipelineTemplateId,
} from "../../pipeline-templates";
import type { StepState } from "../../store/narrativeStore";

type InputTab = "text" | "tags" | "file";
type RouteGroup = "narrative" | "planning";
type StepSectionId = "input" | "routing" | "project";

const INPUT_TAB_DEFS: { id: InputTab; label: string; Icon: typeof PenLine }[] = [
  { id: "text", label: "直接输入", Icon: PenLine },
  { id: "tags", label: "标签选择", Icon: Tags },
  { id: "file", label: "文件上传", Icon: FileUp },
];

// 蓝图 §3.4/§6.1：多模态 + 压缩包 + 多文件上传。按扩展名分流读取方式。
const TEXT_EXTS = ["txt", "md", "markdown"];
const DOCX_EXTS = ["doc", "docx"];
const BINARY_EXTS = [
  "pdf",
  "png", "jpg", "jpeg", "webp", "gif",
  "mp4", "mov", "webm", "mkv",
  "mp3", "wav", "m4a",
  "zip", "tar", "gz", "tgz",
];
const ALL_UPLOAD_EXTS = [...TEXT_EXTS, ...DOCX_EXTS, ...BINARY_EXTS];
const UPLOAD_ACCEPT = ALL_UPLOAD_EXTS.map((e) => `.${e}`).join(",");

type UploadKind = "text" | "docx" | "binary";

interface UploadedItem {
  name: string;
  size: number;
  mime?: string;
  fileType: string;
  kind: UploadKind;
  content?: string;
  contentBase64?: string;
  encoding: "utf8" | "base64-docx" | "base64";
}

/** ArrayBuffer → base64（分块 btoa，避免大文件栈溢出）。 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

function uploadKindOf(ext: string): UploadKind | null {
  if (TEXT_EXTS.includes(ext)) return "text";
  if (DOCX_EXTS.includes(ext)) return "docx";
  if (BINARY_EXTS.includes(ext)) return "binary";
  return null;
}

/** 读取单个文件为中性 UploadedItem（文本 utf8 / docx base64-docx / 二进制 base64）。 */
async function readUploadedItem(file: File): Promise<UploadedItem | null> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const kind = uploadKindOf(ext);
  if (!kind) return null;
  const base = { name: file.name, size: file.size, mime: file.type, fileType: file.type || ext };
  if (kind === "text") {
    // file.text() 默认按 UTF-8 解码,GBK/CP936 的中文 txt 会整篇变 `�`。
    // 改为读字节后先 UTF-8 严格解码,失败再回退 gb18030(GBK 超集),并去 BOM。
    let text = "";
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder("gb18030").decode(bytes);
      }
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    } catch {
      text = "";
    }
    return { ...base, kind, content: text, encoding: "utf8" };
  }
  const b64 = arrayBufferToBase64(await file.arrayBuffer());
  if (kind === "docx") {
    return { ...base, kind, contentBase64: b64, encoding: "base64-docx" };
  }
  return { ...base, kind, contentBase64: b64, encoding: "base64" };
}

const ROUTE_GROUP_DEFS: { id: RouteGroup; label: string; Icon: typeof ClipboardList }[] = [
  { id: "planning", label: "策划全量", Icon: ClipboardList },
  { id: "narrative", label: "叙事单品", Icon: BookOpen },
];

/* ═══════════════════════════════════════════════════════════════════
 *  NARRATIVE ROUTE OPTIONS (D3: built from PipelineTemplate step lists)
 * ═══════════════════════════════════════════════════════════════════ */
// 11 项叙事功能 — 按层级递进，每个 mode 严格继承上一级
//
// 设计原则（用户对话记录 1671-1680 锁定）：
//   [大纲]   = 初步大纲（核心设定+剧情简介），即 initial_plan，不含 worldview
//   [世界观] = [大纲] + worldview
//   [角色]   = [世界观] + character_enrichment
//   [道具]   = [角色] + item_database （Lore 已由通用叙事 agent 内部按 needs.L 处理，不再独立步骤）
//   [叙事]   = [道具] + L0-L4 + Lore 内嵌（RPG: story_framework + outline_batch + detailed + plot + script；
//                                        非 RPG: 通用三件套 agent 替换对应 stub，Lore 作为 capability 内部产出）
//   [任务]   = [叙事] + L5 quest_generation（非 RPG 走通用任务 agent）
//   [场景]   = [任务] + scene_generation（非 RPG 走通用场景 agent / region_design / cinematic_storyboard）
//   [全量]   = [场景]（Lore 在叙事 agent 内部按 needs.L 处理，UI/运营文案已从叙事模块移除）
//   [自动]   = narrative_auto，由 buildAutoSteps 按 needs/品类动态决定
const PREF_STEPS = ["preference_summary", "preference_analysis"];

/**
 * IP DNA 半自动前驱节点链（输入 + IP 处理），拼在生成管线 previewStepOrder 头部（WS-F）。
 * 改编规划(ip_adapt_plan) 合并了范围裁剪 + 游戏单元；拆解(ip_decompose) 为可选分支，仅在体量超线时按需插入（§3.5 动态分步）。
 * 中间管线的 C 序号由 PipelineStatusBar 按实际出现顺序动态赋号，故此链可随路径增减而序号自洽。
 */
const IP_PREDECESSOR_STEPS = ["ip_input", "ip_standardize", "ip_volume", "ip_adapt_plan", "ip_dna_extract"];

/**
 * 历史回放还原输入模块（§6 LIST 双模块）：由已落盘 IP DNA 层级树摘要重建各 IP 前驱步的可读正文，
 * 使点选 LIST 条目时中间预览能精确展示「之前经历的所有步骤」（嵌套到最小叙事单元）。
 * ip_input 上传原件不可由层级树反推，仅以顶层单元概述占位；其余步直接由树/计数派生。
 */
function buildIpReplayContent(summary: IpDnaHierarchySummary): Record<string, string> {
  const nodes = summary.hierarchy;
  const byParent = new Map<string | null, typeof nodes>();
  for (const n of nodes) {
    const k = n.parent ?? null;
    const arr = byParent.get(k);
    if (arr) arr.push(n);
    else byParent.set(k, [n]);
  }
  const ids = new Set(nodes.map((n) => n.id));
  const roots = nodes.filter((n) => !n.parent || !ids.has(n.parent));
  const lines: string[] = ["# 标准化 · 层级化文件系统\n"];
  const walk = (group: typeof nodes, depth: number): void => {
    for (const n of [...group].sort((a, b) => a.index - b.index)) {
      lines.push(`${"  ".repeat(depth)}- ${n.title}${n.childRange ? `（第 ${n.childRange}）` : ""}`);
      walk(byParent.get(n.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  const tree = lines.join("\n");
  const topTitles = [...roots].sort((a, b) => a.index - b.index).map((n) => `### ${n.title}`).join("\n\n");
  return {
    ip_input: `# IP 作品输入\n\n${topTitles || summary.title}`,
    ip_standardize: tree,
    ip_volume: `# 体量判断\n\n- 层级节点：${summary.node_count}`,
    ip_adapt_plan: "# 改编规划\n\n- 改编范围 + 游戏单元（历史记录）",
    ip_dna_extract: `# 生成 scoped IP DNA\n\n- 作品：${summary.title}\n- 层级节点：${summary.node_count}`,
  };
}
const OUTLINE_BASE  = [...PREF_STEPS, "initial_plan"];                                       // [大纲]
const WV_BASE       = [...OUTLINE_BASE, "worldview"];                                        // [世界观]
// 兼容旧引用：策划入口的 TIER_MODE_STEPS / DESIGN_MODE_STEPS 中 PLAN_BASE = 偏好 + initial_plan + worldview
const PLAN_BASE     = WV_BASE;
const CHAR_BASE     = [...WV_BASE, "character_enrichment"];                                  // [角色]
const ITEM_BASE     = [...CHAR_BASE, "item_database"];                                       // [道具]（Lore 内嵌至叙事 agent）
const NARRATIVE_L04 = ["story_framework", "outline_batch", "detailed_outline", "plot_generation", "script_generation"];
const SCRIPT_BASE   = [...ITEM_BASE, ...NARRATIVE_L04];                                      // [叙事] = [道具] + L0-L4
const QUEST_BASE    = [...SCRIPT_BASE, "quest_generation"];                                  // [任务] = [叙事] + L5
const SCENE_BASE    = [...QUEST_BASE, "scene_generation"];                                   // [场景] = [任务] + scene
const VN_SCRIPT_STEPS = ["vn_logline", "vn_outline_acts", "worldview", "vn_scenes", "vn_beats", "vn_branched_beats", "vn_screenplay"];
const VN_STORYBOARD_STEPS = [...VN_SCRIPT_STEPS, "vn_storyboard"];
// 原型族代表性叙事单品（后端 modes.ts 已就绪）。统一纳入道具（ITEM_BASE 含 item_database）。
const FRAGMENTED_STEPS = [...ITEM_BASE, "scene_generation", "lore_generation"];      // 碎片化：环境/物品/Lore 碎片
const EMERGENT_STEPS   = [...ITEM_BASE, "scene_generation", "emergent_event"];       // 涌现：道具+场景+涌现事件
const NARRATIVE_CARD_STEPS = ["narrative_card"];                                     // 微叙事(T4)：单步叙事卡
const CARD_NARRATIVE_STEPS = [...WV_BASE, "card_lore", "event_pool"];                // 卡牌：世界观→卡牌设定→事件池
const OPEN_WORLD_STEPS = [...ITEM_BASE, "region_design", "emergent_event", "quest_generation", "scene_generation"]; // 开放世界

// Phase 3 (§4.①修复 V5): steps 类型加 null 表达"无静态预览"。
// narrative_auto 的步骤完全由后端 buildAutoSteps 按品类动态决定，前端没有合理的预览
// 序，应该返回 null（而非 [] —— 后者会让 PipelineStatus 误以为"预览=空管线"，
// 导致 X/Y 数字消失 + 显示占位文案而非"等待开始生成"）。
const NARRATIVE_ROUTES: { id: ModeId; label: string; hasComplexity: boolean; steps: string[] | null }[] = [
  { id: "narrative_auto",   label: "自动",     hasComplexity: true,  steps: null },
  { id: "initial_outline",  label: "大纲",     hasComplexity: false, steps: OUTLINE_BASE },
  { id: "worldview",        label: "世界观",   hasComplexity: false, steps: WV_BASE },
  { id: "character",        label: "角色",     hasComplexity: false, steps: CHAR_BASE },
  { id: "item_lore",        label: "道具",     hasComplexity: false, steps: ITEM_BASE },
  { id: "script",           label: "叙事",     hasComplexity: true,  steps: SCRIPT_BASE },
  { id: "quest",            label: "任务",     hasComplexity: true,  steps: QUEST_BASE },
  { id: "scene",            label: "场景",     hasComplexity: true,  steps: SCENE_BASE },
  { id: "vn_script",        label: "影游剧本", hasComplexity: true,  steps: VN_SCRIPT_STEPS },
  { id: "vn_storyboard_mode", label: "影游分镜", hasComplexity: true,  steps: VN_STORYBOARD_STEPS },
  // ── 原型族代表性叙事单品（除 RPG 链 / 影游 VN 外的种子选手，按层级补充）──
  { id: "fragmented",       label: "碎片化叙事", hasComplexity: true,  steps: FRAGMENTED_STEPS },
  { id: "emergent",         label: "涌现叙事",   hasComplexity: false, steps: EMERGENT_STEPS },
  { id: "card_narrative",   label: "卡牌叙事",   hasComplexity: false, steps: CARD_NARRATIVE_STEPS },
  { id: "open_world_narrative", label: "开放世界叙事", hasComplexity: true, steps: OPEN_WORLD_STEPS },
  { id: "narrative_card",   label: "叙事卡",     hasComplexity: false, steps: NARRATIVE_CARD_STEPS },
];

const NARRATIVE_HINTS: Record<string, string> = {
  narrative_auto:   "按品类需求矩阵 + 模板动态组合（RPG 走 L0-L5；VN/卡牌/涌现/Tier4 走对应模板替代步骤）",
  initial_outline:  "初步大纲：核心设定 + 剧情简介（preference_summary + preference_analysis + initial_plan）",
  worldview:        "世界观结构（前置：大纲）",
  character:        "角色档案（前置：世界观）",
  item_lore:        "道具清单（含基本道具说明；Lore 由叙事 agent 内嵌产出，不再独立步骤）",
  script:           "叙事 — RPG: L0-L4 完整（框架+大纲+细纲+情节+剧本，Lore 内嵌）；非 RPG: 通用叙事 agent（规划+执行+质检）",
  quest:            "任务 — RPG: L5 任务图；非 RPG: 通用任务 agent（碎片化/涌现/支线）",
  scene:            "场景 — RPG: 场景节点；开放世界: 区域设计；互动影游: 电影分镜；其他: 通用场景 agent",
  vn_script:        "影游剧本 — 梗概→三幕→世界观→场→情节点→剧情树改造→剧本创作（止于 G-02，不含分镜）",
  vn_storyboard_mode: "影游分镜 — 在影游剧本基础上追加电影级分镜设计（含 G-03）",
  fragmented:       "碎片化叙事 — 世界观+角色+道具+场景+碎片(Lore)，代表 类魂 / 步行模拟 / 恐怖探索（T1-T3）",
  emergent:         "涌现叙事 — 世界观+角色+道具+场景+涌现事件，代表 4X / 模拟经营 / 沙盒殖民（T2-T3）",
  card_narrative:   "卡牌叙事 — 世界观+卡牌设定+事件池，代表 集换式卡牌 / 桌游 / 部分 Roguelike 卡构（T2-T3）",
  open_world_narrative: "开放世界叙事 — 世界观+角色+道具+区域设计+涌现事件+[任务∥场景]，代表 开放世界 RPG / 沙盒探索（T1-T2）",
  narrative_card:   "叙事卡 — 极简一步生成背景设定，代表 超休闲 / 三消 / IO / 弹球（T4）",
};

/**
 * Phase 3.5 — 复杂度档位全品类解锁。
 *
 * 用户拍板（2026-04-30）：除"自动"路由外，所有 tier / 任何品类都可自由选择 1-5 档复杂度。
 *
 *   - **RPG 模板（tpl-rpg / tpl-open-world）**：复杂度参数化驱动 L0-5 节点数（已有逻辑保留）
 *   - **非 RPG 模板**：复杂度通过后端 prompt tail 注入（详见 universal-narrative.ts），不参数化
 *   - **默认值**：按 tier 自动设置（T1=4 / T2=3 / T3=2 / T4=1）；tier4 也可手动改
 *
 * 旧 `COMPLEXITY_PIPELINE_TEMPLATES` 限制（V16）已废弃 —— 它会让 VN/影游/卡牌等模板的用户
 * 完全看不到复杂度按钮组，导致"我选了 T1 互动影游就没复杂度可调"的体验。
 */

/* ═══════════════════════════════════════════════════════════════════
 *  M7: UI 灰显方案 B（D12）
 *  ─────────────────────────────────────────────────────────────────
 *  根据当前 selectedGenreCode 的 needs 矩阵，给 11 个叙事按钮标星级。
 *
 *  星级规则（needs 0-3）：
 *    3 → ★★★ active           (高亮，主推)
 *    2 → ★★  recommended      (常规)
 *    1 → ★   optional          (淡化)
 *    0 → —   inactive          (灰显，但不禁用，悬浮提示原因)
 *
 *  下面的映射对应"11 功能 × 8 模板分流大表"中的 needs 主导维度。
 *  always-on 按钮（自动 / 全量 / 大纲）不参与灰显（值为 null）。
 * ═══════════════════════════════════════════════════════════════════ */
type NeedsKey = "W" | "C" | "S" | "D" | "Q" | "E" | "I" | "U" | "L";

const ROUTE_NEEDS_MAP: Record<string, ReadonlyArray<NeedsKey> | null> = {
  narrative_auto:  null,
  initial_outline: null,
  worldview:       ["W"],
  character:       ["C"],
  item_lore:       ["I"],
  script:          ["S", "D", "L"],
  quest:           ["Q"],
  scene:           ["E"],
  vn_script:       ["S", "D"],
  vn_storyboard_mode: ["S", "D", "E"],
  fragmented:      ["E", "I"],
  emergent:        ["E", "S"],
  card_narrative:  ["I", "E"],
  open_world_narrative: ["W", "E"],
  narrative_card:  null,
};

const NEED_LABEL: Record<NeedsKey, string> = {
  W: "世界观", C: "角色", S: "剧情结构", D: "对话", Q: "支线任务",
  E: "环境叙事", I: "物品叙事", U: "UI文案", L: "Lore",
};

function scoreToTag(score: number | null): { tag: string; cls: string } {
  if (score === null) return { tag: "", cls: "" };
  if (score >= 3) return { tag: "★★★", cls: "tms-route-needs-3" };
  if (score === 2) return { tag: "★★", cls: "tms-route-needs-2" };
  if (score === 1) return { tag: "★", cls: "tms-route-needs-1" };
  return { tag: "—", cls: "tms-route-needs-0" };
}

/** 计算单个 button 的"代表 needs 分数"（needsKeys 中取最大值）。 */
function computeRouteScore(routeId: string, needs: Record<string, number> | null): number | null {
  const keys = ROUTE_NEEDS_MAP[routeId];
  if (!keys || !needs) return null;
  let max = 0;
  for (const k of keys) {
    const v = needs[k] ?? 0;
    if (v > max) max = v;
  }
  return max;
}

/** 构造完整的 9 维 needs tooltip。 */
function formatNeedsTooltip(needs: Record<string, number> | null, routeId: string): string {
  if (!needs) return NARRATIVE_HINTS[routeId] ?? "";
  const keys = ROUTE_NEEDS_MAP[routeId];
  const lines: string[] = [];
  if (keys && keys.length > 0) {
    const detail = keys.map((k) => `${NEED_LABEL[k]}=${needs[k] ?? 0}`).join(", ");
    lines.push(`本项需求维度: ${detail}`);
  }
  const all = (Object.keys(NEED_LABEL) as NeedsKey[])
    .map((k) => `${NEED_LABEL[k]}${needs[k] ?? 0}`)
    .join(" | ");
  lines.push(`完整 needs: ${all}`);
  if (NARRATIVE_HINTS[routeId]) lines.push(NARRATIVE_HINTS[routeId]);
  return lines.join("\n");
}

/* ═══════════════════════════════════════════════════════════════════
 *  PLANNING TIER OPTIONS — A1-4: 选择 Tier 后展开二级品类面板
 * ═══════════════════════════════════════════════════════════════════ */
// 排列顺序：自动 / T4 / T3 / T2 / T1 — 由轻到重，符合用户阅读习惯
const TIER_ITEMS: { id: TierId | "auto"; label: string }[] = [
  { id: "auto",  label: "自动" },
  { id: "tier4", label: "极简叙事" },
  { id: "tier3", label: "轻叙事" },
  { id: "tier2", label: "中度叙事" },
  { id: "tier1", label: "重度叙事" },
];

const TIER_HINTS: Record<string, string> = {
  auto:  "根据输入自动检测最适合的层级 → 策划 D0-D4 + 自动叙事",
  tier1: "重叙事 — 策划 D0-D4 + L0-L5 完整叙事链 + 任务 + 场景",
  tier2: "中叙事 — 策划 D0-D4 + 完整叙事 / 任务 / 场景（按品类模板）",
  tier3: "轻叙事 — 策划 D0-D4 + 简版叙事（世界观 + 角色）",
  tier4: "极简叙事 — 策划 D0-D4 + 叙事卡（一步生成）",
};

const TIER_NARRATIVE_TRAITS: Record<string, string> = {
  auto:  "系统将根据您的描述自动选择最合适的叙事深度",
  tier1: "适合 RPG / 互动影游 / 开放世界等剧情驱动型游戏，生成完整叙事链路",
  tier2: "适合 Roguelike / 模拟经营 / 动作冒险等叙事增强型游戏",
  tier3: "适合卡牌 / 竞技 / 休闲等需要轻量叙事包装的游戏",
  tier4: "适合超休闲 / 自走棋 / IO 类等仅需极简背景设定的游戏",
};

const DESIGN_STEPS = ["core_concept","system_architecture","system_detail","value_framework","design_doc"];

const TIER_DEFAULT_MODES: Record<TierId, ModeId> = {
  tier1: "design_auto",
  tier2: "design_auto",
  tier3: "design_auto",
  tier4: "design_auto",
};

// TIER_MODE_STEPS：每个 Tier 在 PIPELINE STATUS 列表展示的"全集"step 候选。
// 实际运行时由 buildAutoSteps 按 genre/needs 在该全集内裁剪/替换 stub。
//   - T1/T2：完整 RPG 叙事链（D0-D4 + L0-L5 + scene + lore）。
//     非 RPG 品类的 stub 步骤（branch_tree / region_design / card_lore 等）由后端在运行时替换对应步骤，
//     UI 仍展示完整候选以保持视觉一致。
//   - T3：轻量链（简版叙事：世界观+角色）。
//   - T4：极简一步（narrative_card）。
// Lore 已集成至通用叙事 agent（按 needs.L 由 capability 内嵌产出），不再作为独立 step 出现在管线列表。
const FULL_NARRATIVE_CHAIN = [
  "character_enrichment", "item_database",
  "story_framework", "outline_batch", "detailed_outline", "plot_generation", "script_generation",
  "quest_generation", "scene_generation",
];
const TIER_MODE_STEPS: Record<TierId, string[]> = {
  tier1: [...DESIGN_STEPS, ...PLAN_BASE, ...FULL_NARRATIVE_CHAIN],
  tier2: [...DESIGN_STEPS, ...PLAN_BASE, ...FULL_NARRATIVE_CHAIN],
  tier3: [...DESIGN_STEPS, ...PLAN_BASE, "character_enrichment"],
  tier4: [...DESIGN_STEPS, "narrative_card"],
};

// Phase 3.5: tier4 也可自由选复杂度（默认 1，但允许手动改）。auto 路由不走品类 → 隐藏。
const TIER_HAS_COMPLEXITY: Record<string, boolean> = {
  auto: false, tier1: true, tier2: true, tier3: true, tier4: true,
};

const COMPLEXITY_LEVELS = [
  { level: 1, label: "极简", hint: "5-10 节点，L0框架直通，不扩展" },
  { level: 2, label: "短篇", hint: "15-25 节点，仅L1克制细化" },
  { level: 3, label: "标准", hint: "35-50 节点，L1/L2克制细化" },
  { level: 4, label: "丰富", hint: "75-100 节点，L1/L2正常细化" },
  { level: 5, label: "史诗", hint: "100+ 节点，不限" },
];

const TIER_DEFAULT_COMPLEXITY: Record<TierId, number> = {
  tier1: 4,
  tier2: 3,
  tier3: 2,
  tier4: 1,
};

// A1-1/A1-2/A1-3: ROUTING_MODES removed — routing 模式从 (tier, mode, genre_code) 推导。
//   - 没有 tier 选择 + 选了"自动" → routing="auto"  （LLM 全检测）
//   - 选了 tier，但没选 genre_code → routing="semi" （LLM 仅补品类）
//   - 选了 tier + genre_code → routing="manual"（跳过 LLM 检测）

// ── Tag system ──
interface TagDimension {
  key: string;
  name: string;
  options: string[];
  allowCustom?: boolean;
}

const TAG_DIMENSIONS: TagDimension[] = [
  { key: "theme", name: "故事主题", options: ["成长", "救赎", "复仇", "爱情", "友情", "牺牲", "自由", "权力", "命运", "探索"] },
  { key: "genre", name: "故事题材", options: ["奇幻", "科幻", "武侠", "悬疑", "恐怖", "历史", "都市", "末日", "仙侠", "军事"] },
  { key: "tone", name: "风格基调", options: ["热血", "黑暗", "温暖", "幽默", "史诗", "治愈", "压抑", "荒诞", "浪漫", "硬核"] },
  { key: "conflict", name: "核心冲突", options: ["人vs人", "人vs自然", "人vs社会", "人vs自我", "人vs命运", "人vs科技", "阵营对抗", "生存危机"] },
  { key: "worldtype", name: "世界观类型", options: ["中世纪", "赛博朋克", "蒸汽朋克", "后启示录", "太空歌剧", "东方仙侠", "克苏鲁", "现代都市", "异世界"] },
  { key: "custom", name: "自定义补充", options: [], allowCustom: true },
];

// ── Main component ──
export function TierModeSelector() {
  const [inputTab, setInputTab] = useState<InputTab>("text");
  const [routeGroup, setRouteGroup] = useState<RouteGroup>("planning");
  const [userInput, setUserInput] = useState("");
  const [complexity, setComplexity] = useState(2);
  const [complexityTouched, setComplexityTouched] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedTierId, setSelectedTierId] = useState<TierId | "auto">("auto");
  const [selectedNarrativeRoute, setSelectedNarrativeRoute] = useState<ModeId>("narrative_auto");

  // A1-4: 选中的二级品类（来自 GET /api/narrative/genres）
  const [selectedGenreCode, setSelectedGenreCode] = useState<string | null>(null);
  const [genreCategories, setGenreCategories] = useState<GenreCategoryGroup[]>([]);
  const [genresLoading, setGenresLoading] = useState(false);
  const [genresError, setGenresError] = useState<string | null>(null);

  const [tagSelections, setTagSelections] = useState<Record<string, string>>({});
  const [tagCustomTexts, setTagCustomTexts] = useState<Record<string, string>>({});
  const [openTagDropdownKey, setOpenTagDropdownKey] = useState<string | null>(null);

  // 上传文件与"用户输入框"独立 state，提交时一起传给 backend，互不污染。
  // 蓝图 §3.4：支持单/多文件 + 混合模态 + 压缩包。
  //   - 纯单文本/docx（轻需求）→ 走老 uploaded_script 通道（流式预览）。
  //   - 含二进制/压缩包/多文件（重需求）→ 走 /ip-dna/start（IP DNA 异步管线）。
  const [uploadedFiles, setUploadedFiles] = useState<UploadedItem[]>([]);
  // IP DNA 异步任务（重需求路径）：本地轮询进度，不污染流式 run store。
  const [ipDnaJob, setIpDnaJob] = useState<{
    jobId: string;
    status: IpDnaJobStatus["status"];
    stage?: string;
    progress?: number;
    message?: string;
    error?: string;
    result?: IpDnaJobStatus["result"];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const actionLockRef = useRef(false);

  // 轻需求剧本 = 唯一一个纯文本/docx 文件（走老 uploaded_script 流式通道）。
  // 重需求 = 含二进制/压缩包，或多文件（走 IP DNA 异步管线）。
  const scriptFile = useMemo(
    () => (uploadedFiles.length === 1 && uploadedFiles[0].kind !== "binary" ? uploadedFiles[0] : null),
    [uploadedFiles],
  );
  const isHeavyUpload = uploadedFiles.length > 0 && !scriptFile;
  const ipDnaRunning =
    !!ipDnaJob && ipDnaJob.status !== "completed" && ipDnaJob.status !== "failed" && ipDnaJob.status !== "cancelled";

  const [historyList, setHistoryList] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Set<StepSectionId>>(new Set(["input"]));
  /** 用户是否在 ROUTING 区显式配置过叙事路由（重需求 IP 流程：改编确认后必须先配路由再生成）。 */
  const [routingConfigured, setRoutingConfigured] = useState(false);
  const [openRouteDropdownId, setOpenRouteDropdownId] = useState<string | null>(null);

  const routeDropdownProps = useCallback((dropdownId: string) => ({
    open: openRouteDropdownId === dropdownId,
    onOpenChange: (next: boolean) => setOpenRouteDropdownId(next ? dropdownId : null),
  }), [openRouteDropdownId]);

  useEffect(() => {
    setOpenRouteDropdownId(null);
  }, [routeGroup]);

  useEffect(() => {
    if (!expandedSteps.has("routing")) {
      setOpenRouteDropdownId(null);
    }
  }, [expandedSteps]);

  const toggleStepSection = useCallback((id: StepSectionId) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Phase 4: 分析影响面预览 modal 状态。
  //   - impactPreview: analyzeImpact 返回的 affectedSteps / canSkip / reasoning
  //   - pendingForkPlan: 用户确认重新生成时所需的全部上下文（fromStepId / skipSteps / nodeFilter / drafts / preloadSteps）
  // 设计：Phase 4 把"分析"和"重新生成"拆成两阶段。点 ▶ 重新生成 = 阶段 A（分析），
  // 弹 modal 让用户预览受影响节点；点确认 = 阶段 B（实际 fork）。
  type PendingForkPlan = {
    fromStepId: string;
    pipelineOrder: string[];
    affectedStepIds: string[];
    skipSteps: string[];
    nodeFilter?: Record<string, string[]>;
    savedDrafts: Record<string, { content?: unknown; userInput?: string }>;
    preloadSteps: StepState[];
  };
  const [impactPreview, setImpactPreview] = useState<{
    affectedSteps: string[];
    canSkip: string[];
    reasoning: string;
    fallback?: boolean;
  } | null>(null);
  const [pendingForkPlan, setPendingForkPlan] = useState<PendingForkPlan | null>(null);

  // ---- Store selectors ----
  const activeEntryKey = useNarrativeStore((s) => s.activeEntryKey);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const activeSteps = useNarrativeStore((s) => s.activeSteps);
  const activeConfig = useNarrativeStore((s) => s.activeConfig);
  const runningEntryKey = useNarrativeStore((s) => s.runningEntryKey);
  const runningRunId = useNarrativeStore((s) => s.runningRunId);
  const ipPreviewRunId = useNarrativeStore((s) => s.ipPreviewRunId);
  const runningProgress = useNarrativeStore((s) => s.runningProgress);
  const editDrafts = useNarrativeStore((s) => s.editDrafts);
  const tier = useNarrativeStore((s) => s.tier);
  const mode = useNarrativeStore((s) => s.mode);
  const autoDetect = useNarrativeStore((s) => s.autoDetect);
  const setConfig = useNarrativeStore((s) => s.setConfig);
  const setAvailableModes = useNarrativeStore((s) => s.setAvailableModes);
  const storeStartNewRun = useNarrativeStore((s) => s.startNewRun);
  const storeStartFork = useNarrativeStore((s) => s.startFork);
  const storeStartResume = useNarrativeStore((s) => s.startResume);
  const storeLoadEntry = useNarrativeStore((s) => s.loadEntry);
  const clearActiveEntry = useNarrativeStore((s) => s.clearActiveEntry);
  const reset = useNarrativeStore((s) => s.reset);
  const setPreviewOrder = useNarrativeStore((s) => s.setPreviewOrder);

  const isRunning = !!runningRunId;
  const hasDrafts = useMemo(() => Object.values(editDrafts).some((d) => d.saved), [editDrafts]);
  /** 重需求 IP 流程：ROUTING 已显式配置 + 非"全自动占位"态，才允许 IpStageFlow「开始生成」。 */
  const ipRoutingReady = useMemo(
    () =>
      routingConfigured &&
      (selectedTierId !== "auto" || !!selectedGenreCode || selectedNarrativeRoute !== "narrative_auto"),
    [routingConfigured, selectedTierId, selectedGenreCode, selectedNarrativeRoute],
  );

  /**
   * 统一的"用户改了 INPUT/ROUTING 配置"hook。
   *
   * 状态机契约：配置 = 因 / 管线状态 = 果 / 历史条目 = 书签。
   * 当用户在 viewing-history 态修改任意配置（tier/mode/genre/complexity/userInput/upload/routeGroup），
   * 自动解除书签 → 进入 fresh-config 态。这样 PIPELINE STATUS 立刻切到新配置的预览，
   * "开始生成"按钮也自然亮起，符合"配置变 → 管线变 → 选中态消失"的因果。
   *
   * 注意：仅在 onClick / onChange handler 中调用。loadEntry 通过 setter（setUserInput 等）
   * 写入 UI state 不会触发本函数，因此 hydrate 路径无副作用。
   */
  const onConfigChange = useCallback(() => {
    if (useNarrativeStore.getState().activeEntryKey) {
      clearActiveEntry();
    }
  }, [clearActiveEntry]);

  // ---- Action routing ----
  type PrimaryAction = "start" | "resume" | "regen" | "none";
  const primaryAction = useMemo<PrimaryAction>(() => {
    // 状态机三态：
    //   - viewing-running（书签 + status=running）→ "none"（不能再操作正在跑的）
    //   - viewing 任意态 + 有 step draft → "regen"（保留配置，仅重跑改过的 step）
    //   - viewing-interrupted → "resume"（从断点续跑）
    //   - fresh-config（无书签）→ "start"（用当前配置开新 entry）
    //   - viewing-completed（无 draft）→ "none"（纯查看，要改配置或再点取消选中才能重启）
    if (activeEntryStatus === "running") return "none";
    if (hasDrafts) return "regen";
    if (activeEntryKey && activeEntryStatus === "interrupted") return "resume";
    if (!activeEntryKey) return "start";
    return "none";
  }, [activeEntryKey, activeEntryStatus, hasDrafts]);

  // 仅正式 SSE / IP DNA 下游 job 算"生成中"；IP 半自动预处理（ipPreviewRunId）不算，避免误禁用 ROUTING。
  const isGenerating = isRunning || ipDnaRunning;
  const isIpPreprocessing = !!ipPreviewRunId && !isGenerating;
  const isViewingRunning = isGenerating;

  useNarrativeStream();

  useEffect(() => {
    tryRestoreFromStorage();
    fetchModes().then(setAvailableModes).catch(() => {});
    setGenresLoading(true);
    setGenresError(null);
    fetchGenres()
      .then((cats) => {
        if (!Array.isArray(cats) || cats.length === 0) {
          console.warn("[TierModeSelector] fetchGenres returned empty payload — 后端可能未启动或品类目录为空");
          setGenresError("品类目录为空（请检查后端 /api/narrative/genres）");
        }
        setGenreCategories(cats ?? []);
      })
      .catch((err) => {
        console.error("[TierModeSelector] fetchGenres failed:", err);
        setGenresError(`加载品类目录失败：${(err as Error)?.message ?? "未知错误"}`);
        setGenreCategories([]);
      })
      .finally(() => setGenresLoading(false));
    loadHistory();
  }, [setAvailableModes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (routeGroup === "planning") {
      if (selectedTierId === "auto") {
        setConfig(null, null, true);
      } else {
        const defaultMode = TIER_DEFAULT_MODES[selectedTierId];
        setConfig(selectedTierId, defaultMode, false);
      }
    } else {
      const needsAutoDetect = selectedNarrativeRoute === "narrative_auto";
      setConfig(null, selectedNarrativeRoute, needsAutoDetect);
    }
  }, [routeGroup, selectedTierId, selectedNarrativeRoute, setConfig]);

  // A1-5: complexity 默认按 tier，用户没改才自动套（去掉自动档专属逻辑）
  useEffect(() => {
    if (complexityTouched) return;
    if (routeGroup === "planning" && selectedTierId !== "auto") {
      const defaultC = TIER_DEFAULT_COMPLEXITY[selectedTierId];
      if (defaultC && defaultC !== complexity) setComplexity(defaultC);
    }
  }, [routeGroup, selectedTierId, complexityTouched, complexity]);

  // A1-4: 切换 Tier 时，清掉不兼容的品类选择（防止 T1 切到 T3 后留着 T1 的品类）
  useEffect(() => {
    if (selectedTierId === "auto") {
      if (selectedGenreCode) setSelectedGenreCode(null);
      return;
    }
    if (!selectedGenreCode) return;
    const allGenres = genreCategories.flatMap((c) => c.genres);
    const found = allGenres.find((g) => g.code === selectedGenreCode);
    if (found && found.tier !== selectedTierId) {
      setSelectedGenreCode(null);
    }
  }, [selectedTierId, selectedGenreCode, genreCategories]);

  // 外部挂载回填：Kotone 通过 narrative:attach-run 起的 run，App.tsx 把 agent 选好的参数写入
  // store.activeConfig 并打上 hydrateToken。这里据此把 INPUT/ROUTING 回填到左栏本地选择器，
  // 让 STEP1/2 的 chip 与「手动选填」时一样亮起。仅在 token 变化时执行一次——手动启动/编辑流程
  // 从不设 token，因此绝不会覆盖用户正在进行的编辑。
  const hydratedTokenRef = useRef<number | null>(null);
  useEffect(() => {
    const token = activeConfig?.hydrateToken;
    if (!token || token === hydratedTokenRef.current) return;
    hydratedTokenRef.current = token;
    const c = activeConfig!;
    if (c.userInput != null) setUserInput(c.userInput);
    if (c.routeGroup) setRouteGroup(c.routeGroup);
    if (c.routeGroup === "narrative") {
      const resolved = (c.mode === ("auto" as ModeId) ? ("narrative_auto" as ModeId) : c.mode) ?? null;
      if (resolved) setSelectedNarrativeRoute(resolved);
    } else if (c.tier) {
      setSelectedTierId(c.tier);
    }
    if (c.genreCode !== undefined) setSelectedGenreCode(c.genreCode ?? null);
  }, [activeConfig]);

  // A1-4: 二级品类面板的可见品类（只展示与当前 Tier 兼容的）
  const visibleGenreCategories = useMemo<GenreCategoryGroup[]>(() => {
    if (routeGroup !== "planning") return [];
    // "自动" = LLM 从全部品类库自动选择品类+层级，不展示手动品类选项。
    // 全部 104 品类仍可通过四个具体 Tier 页签触达（每层显示该层品类）。
    if (selectedTierId === "auto") return [];
    // 选具体 Tier → 仅展示该层级品类。
    return genreCategories
      .map((cat) => ({
        ...cat,
        genres: cat.genres.filter((g) => g.tier === selectedTierId),
      }))
      .filter((cat) => cat.genres.length > 0);
  }, [routeGroup, selectedTierId, genreCategories]);

  // M7 / D12: 当前选中品类的 needs 矩阵（用于 11 个叙事按钮的灰显方案 B）
  const activeNeeds = useMemo<Record<string, number> | null>(() => {
    if (!selectedGenreCode) return null;
    const all = genreCategories.flatMap((c) => c.genres);
    const found = all.find((g) => g.code === selectedGenreCode);
    return found?.needs ?? null;
  }, [selectedGenreCode, genreCategories]);

  // 当前选中品类的 pipeline_template（用于复杂度档位的显隐规则）
  const activePipelineTemplate = useMemo<string | null>(() => {
    if (!selectedGenreCode) return null;
    const all = genreCategories.flatMap((c) => c.genres);
    return all.find((g) => g.code === selectedGenreCode)?.pipeline_template ?? null;
  }, [selectedGenreCode, genreCategories]);

  // Phase 3.5: 复杂度对全品类开放（除"自动"路由外）。RPG 走参数化 L0-5，
  // 非 RPG 走 prompt tail 注入（universal-narrative.ts）—— 前端不再按 pipeline_template 隐藏。
  const showComplexity = useMemo(() => {
    if (routeGroup === "planning") {
      return TIER_HAS_COMPLEXITY[selectedTierId] ?? false;
    }
    const route = NARRATIVE_ROUTES.find((r) => r.id === selectedNarrativeRoute);
    return route?.hasComplexity ?? false;
  }, [routeGroup, selectedTierId, selectedNarrativeRoute]);

  /**
   * STEP2 预演链路（fresh-config，未开始生成时的"待生成"步骤序）。
   *
   * 原本内联在 <PipelineStatus> 的 routeStepOrder prop 里（同一计算）；重构后 PIPELINE STATUS
   * 移到右栏（PipelineStatusBar），而路由选择是左栏的本地 state，跨 iframe 不可见，
   * 故把算好的步骤序推进 store.previewOrder（已加入 SYNC_KEYS，BroadcastChannel 同步给右栏）。
   */
  const previewStepOrder = useMemo<string[] | null>(() => {
    if (routeGroup !== "planning") {
      return NARRATIVE_ROUTES.find((r) => r.id === selectedNarrativeRoute)?.steps ?? null;
    }
    const tierKey = selectedTierId === "auto" ? "tier1" : selectedTierId;
    const tplId = activePipelineTemplate as PipelineTemplateId | null;
    if (tplId && PIPELINE_TEMPLATE_STEPS[tplId]) {
      const baseSteps = PIPELINE_TEMPLATE_STEPS[tplId];
      // tpl-vn-v2 E2 旁路镜像 backend：上传剧本时把 vn_outline_acts/vn_scenes/vn_beats 三步
      // 替换为 vn_script_normalize + vn_segment_confirm（E1/E2 互斥）。
      if (tplId === "tpl-vn-v2" && (scriptFile?.content || scriptFile?.contentBase64)) {
        const REPLACED = new Set(["vn_outline_acts", "vn_scenes", "vn_beats"]);
        const expanded: string[] = [];
        let injected = false;
        for (const s of baseSteps) {
          if (REPLACED.has(s)) {
            if (!injected) {
              expanded.push("vn_script_normalize", "vn_segment_confirm");
              injected = true;
            }
            continue;
          }
          expanded.push(s);
        }
        return [...DESIGN_STEPS, ...expanded];
      }
      return [...DESIGN_STEPS, ...baseSteps];
    }
    return TIER_MODE_STEPS[tierKey];
  }, [routeGroup, selectedNarrativeRoute, selectedTierId, activePipelineTemplate, scriptFile]);

  const previewIsAuto = routeGroup === "planning" && selectedTierId === "auto";

  // IP DNA 重需求上传时（输入阶段）：中间管线只呈现"输入 + IP 处理"前驱环节链
  // （ip_input→标准化→体量→裁剪→生成 scoped IP DNA），不提前铺生产全管线（避免一上来就 0/23）。
  // 生产环节在"开始生成"后由实时运行轨揭示——这与"第一步只显示输入环节、确认参数后再揭示生产工作流"的
  // 设计一致；且生产走 job 轮询无 SSE，提前 seed 只会留下永不点亮的 pending 死节点。
  const previewStepOrderWithIp = useMemo<string[] | null>(() => {
    if (!isHeavyUpload) return previewStepOrder;
    return [...IP_PREDECESSOR_STEPS];
  }, [isHeavyUpload, previewStepOrder]);

  // 把预演链路推进 store（右栏 PIPELINE STATUS 跨 iframe 读取的唯一来源）。
  useEffect(() => {
    setPreviewOrder(previewStepOrderWithIp, previewIsAuto);
  }, [previewStepOrderWithIp, previewIsAuto, setPreviewOrder]);

  // ---- Handlers ----

  const handleStart = useCallback(async () => {
    console.warn("[NarrativeAction] handleStart TRIGGERED", {
      activeEntryKey, activeEntryStatus, hasDrafts, primaryAction,
      stack: new Error().stack?.split("\n").slice(1, 5).join(" < "),
    });
    // 用户口头需求或上传文件，至少一个非空就允许提交
    const hasAnyUpload = uploadedFiles.length > 0;
    if ((!userInput.trim() && !hasAnyUpload) || actionLockRef.current) return;
    // Phase 5.3 (V15): 前端拦截并发，避免重复请求后端再吃 409。
    // 后端通过 [...runs.values()].find(r=>r.status==="running") 强制单实例，前端给个提示更友好。
    const runningCheck = useNarrativeStore.getState();
    if (runningCheck.runningRunId) {
      setError(`已有运行中的管线（${runningCheck.runningEntryKey ?? runningCheck.runningRunId}），请先取消或等待完成`);
      return;
    }
    if (ipDnaRunning) {
      setError(`已有运行中的 IP DNA 任务（${ipDnaJob?.jobId}），请等待完成`);
      return;
    }

    // 重需求路径（多模态/压缩包/多文件）：走 IP DNA 半自动分步卡片，禁止底部按钮一键全自动（会跳过 ROUTING）。
    if (isHeavyUpload) {
      setError("重需求 IP 作品请走上方分步卡片：确认改编范围 → 在 ROUTING 选择叙事路由 → 点击「开始生成（IP DNA → 下游）」");
      return;
    }

    actionLockRef.current = true;
    setStarting(true);
    setError(null);
    try {
      // A1-7/A1-8: routing mode 由 (tier, genreCode) 隐式推导，不再显式传 routingMode
      // 当 selectedGenreCode 存在时，autoDetect=false（manual 路由）
      const hasGenre = !!selectedGenreCode && routeGroup === "planning";
      const effectiveAutoDetect = hasGenre ? false : autoDetect;
      // M1: 上传剧本独立通道传给 backend；user_input 留给"用户在输入框写的口头需求"。
      // 若用户只上传了剧本没在输入框写需求，user_input 给一个简短占位（避免 backend 校验失败）。
      const trimmedInput = userInput.trim();
      const fallbackInput = scriptFile?.name
        ? `（用户上传了剧本：${scriptFile.name}，请基于上传剧本展开生成）`
        : "";
      const effectiveUserInput = trimmedInput || fallbackInput;
      const res = await startRun(effectiveUserInput, {
        tier: tier ?? undefined,
        mode: mode ?? undefined,
        autoDetect: effectiveAutoDetect,
        complexity: showComplexity ? complexity : undefined,
        routeGroup,
        genreCode: hasGenre ? selectedGenreCode! : undefined,
        uploadedScript: scriptFile
          ? {
              content: scriptFile.content,
              content_base64: scriptFile.contentBase64,
              encoding: scriptFile.encoding as "utf8" | "base64-docx",
              file_name: scriptFile.name,
              size: scriptFile.size,
              mime: scriptFile.mime,
            }
          : undefined,
      });
      const entryKey = (res as any).sourceDir as string | undefined;
      if (!entryKey) throw new Error("Backend did not return sourceDir");
      storeStartNewRun(res.id, entryKey, res.tier ?? undefined, res.mode ?? undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLockRef.current = false;
      setStarting(false);
    }
  }, [userInput, uploadedFiles, scriptFile, isHeavyUpload, ipDnaRunning, ipDnaJob, tier, mode, autoDetect, complexity, showComplexity, routeGroup, selectedGenreCode, storeStartNewRun]);

  /**
   * 半自动每步产物推给中间预览（WS-F 实时同步）：复用 pushProgress 把 IP 处理步骤
   * （ip_input/ip_standardize/ip_volume/ip_scope/ip_dna_extract）作为生成管线前驱节点
   * 增量加入 runningProgress，使中间节点图随每步确认实时更新。
   */
  const pushIpStageProgress = useCallback(
    (stepId: string, status: "running" | "completed", message?: string, data?: unknown) => {
      const store = useNarrativeStore.getState();
      // 首次推送时建立 IP 预览运行轨：让中间画布/文本与正式生成同源（读 runningProgress + pipelineOrder），
      // 否则 IP 步因无 run 上下文而排不进预览（孤立浮节点 / 文本空）。独立旁路不触发 SSE、不撞并发守卫。
      if (!store.ipPreviewRunId && !store.runningRunId) {
        const diskKey = store.ipRunKey;
        const suffix = diskKey ?? String(Date.now());
        const entryKey = diskKey ? `ip-preview:${diskKey}` : `ip-preview:${suffix}`;
        store.startIpPreviewRun(`ip-preview-${suffix}`, entryKey, [...IP_PREDECESSOR_STEPS]);
      }
      useNarrativeStore.getState().pushProgress({
        stage: stepId,
        stepId,
        step: 0,
        totalSteps: 0,
        status: status === "completed" ? "completed" : "running",
        message,
        // 该步可读正文（文本直接展示 / 多模态以 @文件名 表示），中间文本视图据此渲染。
        data,
      });
      // 不在 ip_dna_extract 完成时收束预览轨——节点需保留至用户配置 ROUTING 并手动触发生成；
      // 收束由 cancel / 新 run 挂载 / 显式 reset 负责。
    },
    [],
  );

  const handleCancel = useCallback(async () => {
    const store = useNarrativeStore.getState();
    // 收束 IP 预览轨（任意阶段取消）：把"运行中"步骤标为中断、退出运行态，否则预览残留 running。
    if (store.ipPreviewRunId) store.finishIpPreview("interrupted");
    // 统一 job 状态（§5.1 取消生产）：IP DNA 异步任务也由"取消生成"接管。
    if (ipDnaRunning && ipDnaJob?.jobId) {
      try { await ipDnaCancel(ipDnaJob.jobId); } catch { /* 后端无端点时静默，仅清前端态 */ }
      setIpDnaJob((prev) => (prev ? { ...prev, status: "failed" } : prev));
      setTimeout(() => fetchHistory().then(setHistoryList).catch(() => {}), 500);
      return;
    }
    if (store.runningRunId) {
      cancelRun(store.runningRunId);
      store.cancelRun();
    } else {
      // Fallback: find the active run from history list by checking running status
      const history = await fetchHistory().catch(() => [] as HistoryEntry[]);
      const runningEntry = history.find((h) => h.status === "running" && h.id);
      if (runningEntry?.id) {
        cancelRun(runningEntry.id);
      }
      // Clear the stale "running" status in frontend
      if (store.activeEntryStatus === "running") {
        useNarrativeStore.setState({ activeEntryStatus: "interrupted" });
      }
      setHistoryList(history);
    }
    setTimeout(() => fetchHistory().then(setHistoryList).catch(() => {}), 500);
  }, [ipDnaRunning, ipDnaJob]);

  const handleReset = useCallback(() => {
    const store = useNarrativeStore.getState();
    if (store.runningRunId) cancelRun(store.runningRunId);
    reset();
    setUserInput("");
    setError(null);
    setTimeout(() => fetchHistory().then(setHistoryList).catch(() => {}), 500);
  }, [reset]);

  const handleResume = useCallback(async () => {
    if (!activeEntryKey || actionLockRef.current) return;
    // Phase 5.3 (V15): 前端拦截并发
    const runningCheck = useNarrativeStore.getState();
    if (runningCheck.runningRunId) {
      setError(`已有运行中的管线（${runningCheck.runningEntryKey ?? runningCheck.runningRunId}），请先取消或等待完成`);
      return;
    }
    actionLockRef.current = true;
    setStarting(true);
    setError(null);
    try {
      const res = await resumeRun(activeEntryKey);
      const entryKey = (res as any).entryKey ?? activeEntryKey;
      storeStartResume(res.id, entryKey, res.tier ?? undefined, res.mode ?? undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLockRef.current = false;
      setStarting(false);
    }
  }, [activeEntryKey, storeStartResume]);

  /**
   * Phase 4 阶段 A：调 /api/narrative/analyze-impact，把结果存入 impactPreview state，
   * 并预算好 fork 所需的所有参数到 pendingForkPlan。
   * 用户在 modal 里点"确认重新生成"时由 confirmRegenerate 真正调用 /regenerate + startFork。
   */
  const handleRegenerate = useCallback(async () => {
    console.warn("[NarrativeAction] handleRegenerate TRIGGERED (analyze stage)", {
      activeEntryKey, activeEntryStatus, hasDrafts,
    });
    if (!activeEntryKey || !hasDrafts || actionLockRef.current) return;
    // Phase 5.3 (V15): 前端拦截并发
    const runningCheck = useNarrativeStore.getState();
    if (runningCheck.runningRunId) {
      setError(`已有运行中的管线（${runningCheck.runningEntryKey ?? runningCheck.runningRunId}），请先取消或等待完成`);
      return;
    }
    actionLockRef.current = true;
    setStarting(true);
    setError(null);
    try {
      const drafts = useNarrativeStore.getState().editDrafts;
      const savedDrafts: Record<string, { content?: unknown; userInput?: string }> = {};
      const modifiedStepIds: string[] = [];
      const modifications: Array<{
        stepId: string;
        nodeId?: string;
        editedContent?: unknown;
        userInput?: string;
      }> = [];
      for (const [key, draft] of Object.entries(drafts)) {
        if (draft.saved) {
          savedDrafts[key] = { content: draft.content, userInput: draft.userInput };
          const [baseStep, nodeId] = key.includes("::") ? key.split("::") : [key, undefined];
          if (!modifiedStepIds.includes(baseStep)) modifiedStepIds.push(baseStep);
          modifications.push({ stepId: baseStep, nodeId, userInput: draft.userInput, editedContent: draft.content });
        }
      }

      const impact = await analyzeImpact(activeEntryKey, modifications);

      // pipelineOrder 优先级：LLM impact 返回 → activeConfig 持久化 → tier/mode 推导
      const livePipelineOrder = impact.pipelineOrder
        ?? activeConfig?.pipelineOrder
        ?? resolveExpectedSteps(tier, mode);

      // Determine the earliest step to regenerate from:
      // Use the LLM's affectedSteps if available (may include upstream steps),
      // otherwise fall back to the earliest modified step.
      let earliestIdx = livePipelineOrder.length;
      if (impact.affectedSteps?.length) {
        for (const id of impact.affectedSteps) {
          const idx = livePipelineOrder.indexOf(id);
          if (idx >= 0 && idx < earliestIdx) earliestIdx = idx;
        }
      }
      for (const id of modifiedStepIds) {
        const idx = livePipelineOrder.indexOf(id);
        if (idx >= 0 && idx < earliestIdx) earliestIdx = idx;
      }
      if (earliestIdx >= livePipelineOrder.length) {
        setError("未找到被修改步骤在管线中的位置");
        return;
      }

      const fromStepId = livePipelineOrder[earliestIdx];
      const modSet = new Set(modifiedStepIds);
      const affectedSet = new Set(impact.affectedSteps ?? modifiedStepIds);
      const skipSteps = (impact.canSkip ?? []).filter((s) => !modSet.has(s) && !affectedSet.has(s));

      let nodeFilter: Record<string, string[]> | undefined;
      if (impact.nodeImpacts?.length) {
        nodeFilter = {};
        for (const ni of impact.nodeImpacts) {
          nodeFilter[ni.stepId] = ni.nodeIds;
        }
      }

      // Pre-build preloadSteps（fromStepId 之前=completed/绿，之后=pending/灰）
      const staleSet = new Set(livePipelineOrder.slice(earliestIdx));
      const baseSteps: StepState[] = livePipelineOrder.map((id) => ({
        id,
        label: STEP_LABEL_LOOKUP.get(id) ?? id,
        status: staleSet.has(id) ? ("pending" as const) : ("completed" as const),
      }));
      const preloadSteps: StepState[] = [
        { id: "pipeline_config", label: STEP_LABEL_LOOKUP.get("pipeline_config") ?? "管线配置", status: "completed" as const },
        ...baseSteps,
      ];

      // 把分析结果与 fork 计划存到 state，让 modal 渲染。
      setImpactPreview({
        affectedSteps: impact.affectedSteps ?? [],
        canSkip: impact.canSkip ?? [],
        reasoning: impact.reasoning ?? "",
        fallback: impact.fallback,
      });
      setPendingForkPlan({
        fromStepId,
        pipelineOrder: livePipelineOrder,
        affectedStepIds: [...affectedSet],
        skipSteps,
        nodeFilter,
        savedDrafts,
        preloadSteps,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLockRef.current = false;
      setStarting(false);
    }
  }, [activeEntryKey, hasDrafts, tier, mode, activeConfig]);

  /**
   * Phase 4 阶段 B：用户在 modal 里确认后，真正调 /regenerate + startFork。
   * 这一步染色策略由 storeStartFork 处理（preloadSteps 中绿=已完成 / 灰=待重跑）。
   */
  const confirmRegenerate = useCallback(async () => {
    if (!pendingForkPlan || !activeEntryKey) return;
    actionLockRef.current = true;
    setStarting(true);
    setError(null);
    try {
      const res = await regenerateStep(activeEntryKey, pendingForkPlan.fromStepId, {
        skipSteps: pendingForkPlan.skipSteps.length ? pendingForkPlan.skipSteps : undefined,
        nodeFilter: pendingForkPlan.nodeFilter,
        editDrafts: pendingForkPlan.savedDrafts,
      });
      const newEntryKey = res.newEntryKey ?? `__fork__${res.id}`;

      // 后端 /regenerate 会返回最终 staleSteps（更精确），覆盖前端 affectedSet。
      const finalStaleSet = new Set(res.staleSteps ?? pendingForkPlan.affectedStepIds);
      const finalSteps: StepState[] = pendingForkPlan.pipelineOrder.map((id) => ({
        id,
        label: STEP_LABEL_LOOKUP.get(id) ?? id,
        status: finalStaleSet.has(id) ? ("pending" as const) : ("completed" as const),
      }));
      const finalPreload: StepState[] = [
        { id: "pipeline_config", label: STEP_LABEL_LOOKUP.get("pipeline_config") ?? "管线配置", status: "completed" as const },
        ...finalSteps,
      ];

      storeStartFork(
        res.id,
        newEntryKey,
        activeEntryKey,
        res.tier as TierId | undefined,
        res.mode as ModeId | undefined,
        finalPreload,
      );
      setImpactPreview(null);
      setPendingForkPlan(null);
      setTimeout(() => loadHistory(), 500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      actionLockRef.current = false;
      setStarting(false);
    }
  }, [pendingForkPlan, activeEntryKey, storeStartFork]);

  const cancelRegenerate = useCallback(() => {
    setImpactPreview(null);
    setPendingForkPlan(null);
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const list = await fetchHistory();
      setHistoryList(list);
    } catch { /* silent */ }
    finally { setHistoryLoading(false); }
  }, []);

  // Refresh history when a run completes
  const prevRunningRef = useRef(runningRunId);
  useEffect(() => {
    const prev = prevRunningRef.current;
    prevRunningRef.current = runningRunId;
    if (prev && !runningRunId) {
      loadHistory();
    }
  }, [runningRunId, loadHistory]);

  const displayHistory = useMemo<HistoryEntry[]>(() => {
    if (isRunning && runningEntryKey) {
      const doneSteps = runningProgress.filter((s) => s.status === "completed").map((s) => s.id);
      const lastDone = doneSteps.length > 0 ? doneSteps[doneSteps.length - 1] : null;
      const alreadyInList = historyList.some((h) => h.key === runningEntryKey);
      if (!alreadyInList) {
        const virtualEntry: HistoryEntry = {
          key: runningEntryKey,
          type: "dir",
          id: runningRunId,
          tier: tier ?? undefined,
          mode: mode ?? undefined,
          status: "running",
          startedAt: new Date().toISOString(),
          hasCheckpoint: false,
          lastCompletedStep: lastDone,
          completedSteps: doneSteps,
          canResume: false,
          canLoad: false,
          userInput: userInput || undefined,
          routeGroup,
          complexity: showComplexity ? complexity : undefined,
        };
        return [virtualEntry, ...historyList];
      }
      return historyList.map((h) =>
        h.key === runningEntryKey ? { ...h, status: "running" } : h,
      );
    }
    return historyList;
  }, [isRunning, runningEntryKey, runningRunId, tier, mode, runningProgress, userInput, routeGroup, complexity, showComplexity, historyList]);

  const inputStepSummary = useMemo(() => {
    if (inputTab === "file" && uploadedFiles.length > 0) {
      return uploadedFiles.length === 1
        ? `已上传 ${uploadedFiles[0].name}`
        : `已上传 ${uploadedFiles.length} 个文件`;
    }
    if (inputTab === "tags") {
      const picked = TAG_DIMENSIONS.map((dim) => {
        const val = tagSelections[dim.key] ?? tagCustomTexts[dim.key]?.trim();
        return val ? `${dim.name}·${val}` : null;
      }).filter(Boolean);
      return picked.length > 0 ? picked.join("；") : "标签未限定";
    }
    const trimmed = userInput.trim();
    if (!trimmed) return "未填写需求";
    return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed;
  }, [inputTab, uploadedFiles, tagSelections, tagCustomTexts, userInput]);

  const routingStepSummary = useMemo(() => {
    const routeLabel = routeGroup === "planning" ? "策划全量" : "叙事单品";
    if (routeGroup === "planning") {
      const tierLabel = TIER_ITEMS.find((t) => t.id === selectedTierId)?.label ?? "自动";
      const genreLabel = selectedGenreCode
        ? genreCategories.flatMap((c) => c.genres).find((g) => g.code === selectedGenreCode)?.name ?? selectedGenreCode
        : "品类自动识别";
      const cplx = showComplexity ? ` · 复杂度 ${complexity}` : "";
      return `${routeLabel} · ${tierLabel} · ${genreLabel}${cplx}`;
    }
    const route = NARRATIVE_ROUTES.find((r) => r.id === selectedNarrativeRoute);
    const cplx = showComplexity ? ` · 复杂度 ${complexity}` : "";
    return `${routeLabel} · ${route?.label ?? selectedNarrativeRoute}${cplx}`;
  }, [routeGroup, selectedTierId, selectedGenreCode, genreCategories, showComplexity, complexity, selectedNarrativeRoute]);

  const projectStepSummary = useMemo(() => {
    if (historyLoading) return "加载历史记录…";
    if (displayHistory.length === 0) return "暂无项目";
    const active = displayHistory.find((e) => e.key === activeEntryKey);
    if (active) {
      const status =
        active.status === "completed" ? "已完成"
          : active.status === "running" ? "生成中"
          : active.status === "interrupted" ? "已中断"
          : active.status === "failed" ? "失败"
          : "已选中";
      return `${displayHistory.length} 条记录 · 当前 ${status}`;
    }
    return `${displayHistory.length} 条历史记录`;
  }, [historyLoading, displayHistory, activeEntryKey]);

  const genreSelectGroups = useMemo(() => {
    return visibleGenreCategories.map((cat) => ({
      label: cat.label,
      options: cat.genres.map((g) => ({
        value: g.code,
        label: g.name,
        title: `${g.name} (${g.code}) — ${g.narrative_ratio}`,
        description: g.narrative_ratio,
      })),
    }));
  }, [visibleGenreCategories]);

  const complexityHint = useMemo(
    () => COMPLEXITY_LEVELS.find((c) => c.level === complexity)?.hint ?? "",
    [complexity],
  );

  const handleLoadHistory = useCallback(async (entry: HistoryEntry) => {
    // Read latest running state from store to avoid stale closures
    const { runningEntryKey: currentRunKey, runningRunId: currentRunId, runningProgress: currentProgress } = useNarrativeStore.getState();
    const currentlyRunning = !!currentRunId;

    if (entry.status === "running" && currentlyRunning && entry.key === currentRunKey) {
      // Switch view to the running entry (tracked by frontend)
      useNarrativeStore.setState({
        activeEntryKey: entry.key,
        activeEntryStatus: "running",
        activeSteps: currentProgress,
      });
      return;
    }

    // Entry shows "running" but frontend isn't tracking it — backend-only state
    if (entry.status === "running" && !currentlyRunning) {
      useNarrativeStore.setState({
        activeEntryKey: entry.key,
        activeEntryStatus: "running",
        activeSteps: [],
      });
      return;
    }

    setLoadingKey(entry.key);
    setError(null);
    try {
      const data = await loadHistoryResult(entry.key);
      if (!data.result) {
        setError("该记录无可加载的结果数据（仅加载了元信息）");
        return;
      }
      const ctx = data.result;
      const entryTier = (data.tier ?? entry.tier ?? null) as TierId | null;
      const entryMode = (data.mode ?? entry.mode ?? null) as ModeId | null;
      const entryStatus = data.status ?? entry.status;

      // 「忠实反应后端」: 权威步骤序优先级
      //   1) Phase 1 持久化的 pipelineOrder（新 entry，含完整动态管线）
      //   2) backend completedSteps（旧 entry fallback：只含实际跑过的）
      //   3) 前端 resolveExpectedSteps（极旧 entry 兜底，可能错配）
      // 这样 vn entry 不会再被前端硬编码的 RPG 标准管线污染出灰色 placeholder。
      const authoritativeOrder: string[] =
        (data.pipelineOrder && data.pipelineOrder.length > 0)
          ? data.pipelineOrder
          : (data.completedSteps && data.completedSteps.length > 0)
            ? data.completedSteps
            : resolveExpectedSteps(entryTier, entryMode);

      const rawSteps = buildStepsFromCtx(ctx, authoritativeOrder);

      // §6 LIST 双模块：若权威序含 IP 前驱段（IP 作品入口的历史条目），拉取已落盘层级树摘要，
      // 回填各 IP 步的可读正文并标记完成，使中间预览还原输入模块（嵌套到最小叙事单元），
      // 同时保证 IP 步不被下方 completed 过滤甩掉 → 顶栏与中间预览同源（SSOT）。
      if (authoritativeOrder.some((id) => id.startsWith("ip_"))) {
        try {
          const summary = await fetchIpDnaHierarchy(entry.key);
          if (summary) {
            const ipContent = buildIpReplayContent(summary);
            for (const s of rawSteps) {
              if (s.id.startsWith("ip_")) {
                s.status = "completed";
                if (ipContent[s.id] != null) s.data = ipContent[s.id];
              }
            }
          }
        } catch { /* 无 IP 层级树（非 IP 条目或未落盘）：保持原状，零回归 */ }
      }

      // pipeline_config 是「管线启动」元 step，没有 ctx field；如果它出现在权威序里
      // 视为隐式 completed（一旦 announce 帧发出就完成），避免显灰。
      for (const s of rawSteps) {
        if (s.id === "pipeline_config" && s.status === "pending") {
          s.status = "completed";
        }
      }

      // 对未完成 entry，按 backend completedSteps 修正：实际没跑的 step 改回 pending
      // 并清理 ctx 上的残留字段（前端强行从 ctx 探测出的 stale data）。
      if (entryStatus !== "completed" && data.completedSteps) {
        const doneSet = new Set(data.completedSteps);
        const ctxRec = ctx as Record<string, unknown>;
        for (const s of rawSteps) {
          if (s.status === "completed" && !doneSet.has(s.id) && s.id !== "pipeline_config") {
            s.status = "pending";
            s.data = undefined;
            const field = STEP_CTX_FIELD[s.id];
            if (field) delete ctxRec[field];
          }
        }
      }

      // 「忠实反应后端」硬约束：completed entry 不存在「待跑」step → 过滤掉 pending。
      // interrupted / failed 保留 pending，让用户看出在哪断了便于 resume。
      const steps = entryStatus === "completed"
        ? rawSteps.filter((s) => s.status !== "pending")
        : rawSteps;

      const allDone = steps.every((s) => s.status === "completed");

      // If backend says "running" but frontend lost track, respect the backend status
      const resolvedStatus = (entryStatus === "running" || (currentlyRunning && entry.key === currentRunKey))
        ? "running"
        : allDone ? "completed" : entryStatus;

      // Phase 2: 把启动管线快照打包成 ActiveConfig 写入 store.activeConfig，
      // 供 PIPELINE STATUS / Canvas / TextView 在非 running 视图时也能展示完整管线（V5/V13 修复基础）。
      const savedInput = data.userInput ?? ctx.user_input;
      const savedRouteGroup = data.routeGroup ?? entry.routeGroup ?? inferRouteGroup(entryTier, entryMode);
      const savedComplexity = data.complexity ?? entry.complexity;
      // Phase 1 持久化后，data.genre_code 是权威源；旧 entry fallback 到 ctx.tier_detection。
      // 注意：旧版"用户手动指定 tier"时 genre_code 会写成 "manual" 占位，要 strip 掉。
      const tdCode = ctx.tier_detection?.genre_code;
      const tdCodeReal = tdCode && tdCode !== "manual" ? tdCode : undefined;
      const daCode = (ctx.demand_analysis as { genre_code?: string } | undefined)?.genre_code;
      const savedGenreCode: string | null =
        data.genre_code ?? tdCodeReal ?? daCode ?? null;

      storeLoadEntry({
        entryKey: entry.key,
        tier: entryTier,
        mode: entryMode,
        result: ctx,
        status: resolvedStatus,
        steps,
        config: {
          userInput: savedInput,
          routeGroup: savedRouteGroup,
          tier: entryTier,
          mode: entryMode,
          complexity: savedComplexity,
          genreCode: savedGenreCode,
          pipelineOrder: data.pipelineOrder,
          routingMode: data.routingMode,
        },
      });
      useNarrativeStore.getState().snapshot();

      // 双写过渡：activeConfig 由 store 持有，但 TierModeSelector 内部还有大量逻辑读本地 useState；
      // 这里手动同步一次（Phase 2 useEffect 在 store 变化时也会触发，相当于双层兜底）。
      if (savedInput) setUserInput(savedInput);

      setRouteGroup(savedRouteGroup);

      if (savedRouteGroup === "planning") {
        if (entryTier) setSelectedTierId(entryTier);
      } else {
        const resolved = entryMode === ("auto" as ModeId) ? "narrative_auto" as ModeId : entryMode;
        if (resolved) setSelectedNarrativeRoute(resolved);
      }

      if (savedComplexity != null) setComplexity(savedComplexity);

      // V6 / §4.③ 修复：以前完全不调 setSelectedGenreCode，导致互动影游品类切回不亮。
      // 现在从 data.genre_code（Phase 1 持久化）/ ctx.tier_detection.genre_code 取真实品类写回。
      // 注意：strip "manual" 占位（旧版用户手动指定 tier 时 genre_code 写成 "manual"）。
      setSelectedGenreCode(savedGenreCode ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingKey(null);
    }
  }, [storeLoadEntry]);

  const setTagValue = useCallback((dimKey: string, val: string) => {
    setTagSelections((prev) => {
      const next = { ...prev };
      if (!val) delete next[dimKey];
      else next[dimKey] = val;
      return next;
    });
    onConfigChange();
  }, [onConfigChange]);

  const setCustomText = useCallback((dimKey: string, val: string) => {
    setTagCustomTexts((prev) => ({ ...prev, [dimKey]: val }));
  }, []);

  // 标签 → 输入框自动同步（仅当 inputTab === "tags" 时生效，避免覆盖手动输入）。
  // 用户在标签 tab 任何选择/输入变化都会实时反映到 userInput，去掉了"✓ 确认标签"按钮的中间步骤。
  useEffect(() => {
    if (inputTab !== "tags") return;
    const parts: string[] = [];
    for (const dim of TAG_DIMENSIONS) {
      const sel = tagSelections[dim.key];
      const custom = tagCustomTexts[dim.key]?.trim();
      if (sel) parts.push(`${dim.name}：${sel}`);
      if (custom) parts.push(`${dim.name}补充：${custom}`);
    }
    setUserInput(parts.join("；"));
  }, [inputTab, tagSelections, tagCustomTexts, setUserInput]);

  // ── File handlers（多文件 + 多模态 + 压缩包，蓝图 §3.4）──
  // 读取与 userInput 解耦：输入框留给用户写口头需求。逐文件按扩展名分流：
  //   - 文本(txt/md)：utf8 content；docx：base64-docx（后端 mammoth）；
  //   - 二进制(图片/视频/音频/pdf/压缩包)：base64 + file_type（后端 IP DNA 摄入）。
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setRoutingConfigured(false);
    const items: UploadedItem[] = [];
    const rejected: string[] = [];
    for (const f of list) {
      const item = await readUploadedItem(f);
      if (item) items.push(item);
      else rejected.push(f.name);
    }
    if (items.length > 0) {
      // 同名去重：后上传覆盖先前同名条目。
      setUploadedFiles((prev) => {
        const byName = new Map(prev.map((p) => [p.name, p] as const));
        for (const it of items) byName.set(it.name, it);
        return Array.from(byName.values());
      });
    }
    if (rejected.length > 0) {
      setError(`不支持的格式已忽略：${rejected.join("、")}`);
    }
    onConfigChange();
  }, [onConfigChange]);

  const onFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.currentTarget.classList.remove("dragover");
    const files = e.dataTransfer?.files;
    if (files?.length) void addFiles(files);
  }, [addFiles]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void addFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [addFiles]);

  const removeFile = useCallback((name: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.name !== name));
    setRoutingConfigured(false);
    onConfigChange();
  }, [onConfigChange]);

  // IP DNA 异步任务轮询：每 1.5s 拉一次进度，完成/失败即停；完成后刷新历史列表
  // 让生成的游戏单元可被加载预览。
  useEffect(() => {
    if (!ipDnaJob?.jobId || ipDnaJob.status === "completed" || ipDnaJob.status === "failed" || ipDnaJob.status === "cancelled") return;
    let cancelled = false;
    const tick = async () => {
      try {
        const st = await fetchIpDnaJob(ipDnaJob.jobId);
        if (cancelled) return;
        setIpDnaJob((prev) =>
          prev && prev.jobId === st.jobId
            ? { ...prev, status: st.status, stage: st.current_stage, progress: st.progress, message: st.message, error: st.error, result: st.result }
            : prev,
        );
        if (st.status === "completed" || st.status === "failed" || st.status === "cancelled") {
          fetchHistory().then(setHistoryList).catch(() => {});
        }
      } catch { /* 轮询失败下次再试 */ }
    };
    const id = setInterval(tick, 1500);
    void tick();
    return () => { cancelled = true; clearInterval(id); };
  }, [ipDnaJob?.jobId, ipDnaJob?.status]);

  return (
    <div className="tier-mode-selector">
      <div className="workbench-pane-scroll">
        <div className="wb-step-stack">
          <WorkbenchStepSection
            step={1}
            title="输入需求"
            titleEn="INPUT"
            note="三种模式，开启自由创作之路"
            summary={inputStepSummary}
            expanded={expandedSteps.has("input")}
            active={expandedSteps.has("input")}
            onToggle={() => toggleStepSection("input")}
          >
            <div className="wb-segmented" role="tablist" aria-label="输入方式">
              {INPUT_TAB_DEFS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={inputTab === id}
                  className={`wb-segmented-btn ${inputTab === id ? "active" : ""}`}
                  onClick={() => setInputTab(id)}
                >
                  <Icon className="wb-segmented-icon" size={13} strokeWidth={2} aria-hidden />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {inputTab === "text" && (
              <div className="input-wrap">
                <p className="wb-helper">输入你的故事需求</p>
                <textarea
                  className="input-textarea"
                  value={userInput}
                  onChange={(e) => { setUserInput(e.target.value); onConfigChange(); }}
                  placeholder={"例：赛博朋克世界，黑客揭露政府阴谋，充满背叛与救赎。"}
                  rows={4}
                />
              </div>
            )}

            {inputTab === "tags" && (
              <div className="wb-route-fields tag-select-wrap">
                <p className="wb-helper">可勾选标签辅助生成，不选则不限制方向。</p>
                {TAG_DIMENSIONS.map((dim) => {
                  if (dim.allowCustom && dim.options.length === 0) {
                    return (
                      <div key={dim.key} className="wb-field">
                        <span className="wb-field-label">{dim.name}</span>
                        <input
                          className="wb-tag-custom-input"
                          placeholder="输入自定义补充..."
                          value={tagCustomTexts[dim.key] ?? ""}
                          onChange={(e) => setCustomText(dim.key, e.target.value)}
                        />
                      </div>
                    );
                  }
                  return (
                    <WorkbenchFieldSelect
                      key={dim.key}
                      label={dim.name}
                      value={tagSelections[dim.key] ?? ""}
                      onChange={(v) => setTagValue(dim.key, v)}
                      options={dim.options.map((o) => ({ value: o, label: o }))}
                      allowEmpty
                      placeholder="不限"
                      emptyLabel="不限"
                      open={openTagDropdownKey === dim.key}
                      onOpenChange={(o) => setOpenTagDropdownKey(o ? dim.key : null)}
                    />
                  );
                })}
              </div>
            )}

            {inputTab === "file" && (
              <div className="file-upload-wrap">
                <p className="wb-helper">上传 IP 作品 · 支持多模态 / 压缩包 / 多文件</p>
                <div
                  className="file-drop-zone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("dragover"); }}
                  onDragLeave={(e) => e.currentTarget.classList.remove("dragover")}
                  onDrop={onFileDrop}
                >
                  <div className="fdz-icon"><Upload size={20} strokeWidth={1.75} aria-hidden /></div>
                  <div className="fdz-text">点击或拖拽上传文件（可多选）</div>
                  <div className="fdz-hint">文本 txt/md/doc/docx · 图片 jpg/png/webp/gif · 视频 mp4/mov/webm/mkv · 音频 mp3/wav · pdf · 压缩包 zip/tar/gz</div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  multiple
                  style={{ display: "none" }}
                  onChange={onFileChange}
                />
                {uploadedFiles.length > 0 && (
                  <div className="file-list visible">
                    {uploadedFiles.map((f) => (
                      <div className="file-info visible" key={f.name}>
                        <span className="fi-name">{f.name}</span>
                        <span className="fi-size">{(f.size / 1024).toFixed(1)} KB</span>
                        <button type="button" className="fi-remove" onClick={() => removeFile(f.name)} aria-label={`移除 ${f.name}`}>
                          <X size={14} strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {isHeavyUpload && (
                  <>
                    <p className="wb-helper">含多模态/压缩包/多文件 → IP DNA 半自动摄入：分步确认裁剪范围后，配置 ROUTING 即可开始生成。</p>
                    <IpStageFlow
                      files={uploadedFiles.map((f) => ({
                        file_name: f.name,
                        content: f.kind === "text" ? f.content : undefined,
                        content_base64: f.kind !== "text" ? f.contentBase64 : undefined,
                        encoding: f.kind === "docx" ? "base64-docx" : f.kind === "text" ? "utf8" : undefined,
                        file_type: f.fileType,
                      }))}
                      displayItems={uploadedFiles.map<IpUploadDisplay>((f) => ({ name: f.name, kind: f.kind, fileType: f.fileType }))}
                      title={uploadedFiles[0]?.name?.replace(/\.[^.]+$/, "")}
                      tier={tier ?? undefined}
                      mode={mode ?? undefined}
                      complexity={showComplexity ? complexity : undefined}
                      routingReady={ipRoutingReady}
                      onStageProgress={pushIpStageProgress}
                      onGenerateStarted={(jobId) => setIpDnaJob({ jobId, status: "running" })}
                    />
                  </>
                )}
                {ipDnaJob && (
                  <div className={`ip-dna-job ip-dna-job--${ipDnaJob.status}`}>
                    <div className="ip-dna-job__head">
                      <span className="ip-dna-job__stage">
                        IP DNA · {ipDnaJob.status === "completed" ? "完成" : ipDnaJob.status === "failed" ? "失败" : (ipDnaJob.stage ?? "处理中")}
                      </span>
                      {typeof ipDnaJob.progress === "number" && ipDnaJob.status !== "completed" && ipDnaJob.status !== "failed" && (
                        <span className="ip-dna-job__pct">{ipDnaJob.progress}%</span>
                      )}
                    </div>
                    {ipDnaJob.message && <div className="ip-dna-job__msg">{ipDnaJob.message}</div>}
                    {ipDnaJob.error && <div className="ip-dna-job__msg ip-dna-job__msg--err">{ipDnaJob.error}</div>}
                    {ipDnaJob.status === "completed" && ipDnaJob.result && (
                      <div className="ip-dna-job__msg">
                        层级节点 {ipDnaJob.result.node_count ?? 0} · 游戏单元 {ipDnaJob.result.game_units?.length ?? 0}（已生成 {ipDnaJob.result.game_units?.filter((g) => g.generated).length ?? 0}）
                      </div>
                    )}
                    {ipDnaJob.status === "completed" && ipDnaJob.result?.extraction_quality && (
                      <div className="ip-dna-job__quality">
                        <span className={`ip-dna-job__quality-head${ipDnaJob.result.extraction_quality.passed ? " ok" : " warn"}`}>
                          提取质量{ipDnaJob.result.extraction_quality.passed ? " · 通过" : " · 有告警"}
                        </span>
                        <div className="ip-dna-job__quality-checks">
                          {ipDnaJob.result.extraction_quality.checks.map((c) => (
                            <span key={c.name} className={`ip-dna-job__check${c.passed ? " ok" : " warn"}`} title={c.detail}>
                              {c.passed ? "✓" : "!"} {c.name}{c.detail ? ` · ${c.detail}` : ""}
                            </span>
                          ))}
                        </div>
                        {ipDnaJob.result.extraction_quality.warnings.length > 0 && (
                          <div className="ip-dna-job__msg ip-dna-job__msg--err">
                            {ipDnaJob.result.extraction_quality.warnings.join("；")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </WorkbenchStepSection>

          <WorkbenchStepSection
            step={2}
            title="叙事路由"
            titleEn="ROUTING"
            note="两个入口，百种叙事，任您挑选"
            summary={routingStepSummary}
            expanded={expandedSteps.has("routing")}
            active={expandedSteps.has("routing")}
            onToggle={() => toggleStepSection("routing")}
          >
            <div className="wb-segmented" role="tablist" aria-label="叙事入口">
              {ROUTE_GROUP_DEFS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={routeGroup === id}
                  className={`wb-segmented-btn ${routeGroup === id ? "active" : ""}`}
                  onClick={() => { setRouteGroup(id); setRoutingConfigured(true); onConfigChange(); }}
                >
                  <Icon className="wb-segmented-icon" size={13} strokeWidth={2} aria-hidden />
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <p className="wb-helper">
              {routeGroup === "planning"
                ? "从 0 跑完整策划（D0-D4）与叙事全链，适合新游戏立项"
                : "跳过策划，直接产出大纲、世界观、角色、剧本等单品"}
            </p>

            <div className="tms-route-body">
          {routeGroup === "planning" && (
            <div className="wb-route-fields">
              <WorkbenchFieldSelect
                id="route-tier"
                {...routeDropdownProps("route-tier")}
                label="叙事层级"
                value={selectedTierId}
                onChange={(val) => {
                  setSelectedTierId(val as TierId | "auto");
                  setRoutingConfigured(true);
                  onConfigChange();
                }}
                options={TIER_ITEMS.map((t) => ({
                  value: t.id,
                  label: t.label,
                  title: TIER_HINTS[t.id] ?? "",
                }))}
                hint={TIER_NARRATIVE_TRAITS[selectedTierId]}
              />

              {genresLoading ? (
                <div className="tms-genre-loading">加载品类目录…</div>
              ) : genresError ? (
                <div className="tms-genre-empty" title={genresError}>{genresError}</div>
              ) : selectedTierId === "auto" ? (
                <p className="wb-field-hint">自动模式将根据描述从品类库识别层级与品类，无需手动指定</p>
              ) : genreSelectGroups.length === 0 ? (
                <p className="wb-field-hint">该层级暂无品类，将保持自动识别</p>
              ) : (
                <WorkbenchFieldSelect
                  id="route-genre"
                  {...routeDropdownProps("route-genre")}
                  menuMaxHeight={200}
                  label="游戏品类"
                  value={selectedGenreCode ?? ""}
                  allowEmpty
                  emptyLabel="自动识别品类"
                  onChange={(val) => {
                    if (!val) {
                      setSelectedGenreCode(null);
                      setRoutingConfigured(true);
                      onConfigChange();
                      return;
                    }
                    setSelectedGenreCode(val);
                    setRoutingConfigured(true);
                    const found = genreCategories
                      .flatMap((c) => c.genres)
                      .find((g) => g.code === val);
                    if (found && found.tier !== selectedTierId) {
                      setSelectedTierId(found.tier as TierId);
                    }
                    onConfigChange();
                  }}
                  groups={genreSelectGroups}
                />
              )}

              {showComplexity && (
                <WorkbenchFieldSelect
                  id="route-complexity-planning"
                  {...routeDropdownProps("route-complexity-planning")}
                  label="复杂度"
                  value={String(complexity)}
                  onChange={(val) => {
                    setComplexity(Number(val));
                    setComplexityTouched(true);
                    onConfigChange();
                  }}
                  options={COMPLEXITY_LEVELS.map((c) => ({
                    value: String(c.level),
                    label: c.label,
                    title: c.hint,
                    description: c.hint,
                  }))}
                  hint={complexityHint}
                />
              )}
            </div>
          )}

          {routeGroup === "narrative" && (
            <div className="wb-route-fields">
              <WorkbenchFieldSelect
                id="route-narrative-mode"
                {...routeDropdownProps("route-narrative-mode")}
                label="叙事单品"
                value={selectedNarrativeRoute}
                onChange={(val) => {
                  setSelectedNarrativeRoute(val as ModeId);
                  setRoutingConfigured(true);
                  onConfigChange();
                }}
                options={NARRATIVE_ROUTES.map((opt) => {
                  const score = computeRouteScore(opt.id, activeNeeds);
                  const { tag } = scoreToTag(score);
                  const needsSuffix = tag ? ` ${tag}` : "";
                  return {
                    value: opt.id,
                    label: `${opt.label}${needsSuffix}`,
                    title: formatNeedsTooltip(activeNeeds, opt.id),
                  };
                })}
                hint={
                  <>
                    {NARRATIVE_HINTS[selectedNarrativeRoute] ?? ""}
                    {activeNeeds && (
                      <span style={{ display: "block", marginTop: 4, opacity: 0.85 }}>
                        选项后缀 ★ 基于当前品类 needs 矩阵，悬浮可查看详情
                      </span>
                    )}
                  </>
                }
              />

              {showComplexity && (
                <WorkbenchFieldSelect
                  id="route-complexity-narrative"
                  {...routeDropdownProps("route-complexity-narrative")}
                  label="复杂度"
                  value={String(complexity)}
                  onChange={(val) => {
                    setComplexity(Number(val));
                    setComplexityTouched(true);
                    onConfigChange();
                  }}
                  options={COMPLEXITY_LEVELS.map((c) => ({
                    value: String(c.level),
                    label: c.label,
                    title: c.hint,
                    description: c.hint,
                  }))}
                  hint={complexityHint}
                />
              )}
            </div>
          )}
            </div>
          </WorkbenchStepSection>

          <WorkbenchStepSection
            step={3}
            title="项目清单"
            titleEn="LIST"
            note="创作成果，在此落盘"
            summary={projectStepSummary}
            expanded={expandedSteps.has("project")}
            active={expandedSteps.has("project")}
            onToggle={() => toggleStepSection("project")}
          >
            <div className="history-panel">
              {historyLoading ? (
                <div className="history-loading">加载中...</div>
              ) : displayHistory.length === 0 ? (
                <div className="history-empty">暂无历史记录</div>
              ) : (
                <div className="history-list">
                  {displayHistory.map((entry) => {
                    const isActive = activeEntryKey === entry.key;
                    const isCurrentlyRunning = entry.key === runningEntryKey || entry.status === "running";
                    const busy = loadingKey === entry.key;

                    return (
                      <div
                        key={entry.key}
                        className={`history-item status-${entry.status ?? "unknown"} ${isActive ? "selected" : ""} ${isCurrentlyRunning ? "current-run" : ""}`}
                        style={{ cursor: busy ? "wait" : "pointer" }}
                        onClick={() => {
                          if (busy) return;
                          if (isActive) {
                            clearActiveEntry();
                            return;
                          }
                          handleLoadHistory(entry);
                        }}
                      >
                        <div className="hi-header">
                          <span className="hi-time">{isCurrentlyRunning && !entry.startedAt ? "当前" : formatHistoryTime(entry)}</span>
                          <span className={`hi-badge hi-badge--${entry.status ?? "unknown"}`}>
                            {entry.status === "completed" ? "完成"
                              : entry.status === "running" ? "生成中"
                              : entry.status === "interrupted" ? "中断"
                              : entry.status === "failed" ? "失败"
                              : entry.status ?? "?"}
                          </span>
                        </div>
                        {entry.userInput && (
                          <div className="hi-input-preview">
                            {entry.userInput.length > 40 ? entry.userInput.slice(0, 40) + "…" : entry.userInput}
                          </div>
                        )}
                        <div className="hi-meta">
                          {entry.routeGroup && <span className="hi-tag">{entry.routeGroup === "planning" ? "策划全量" : "叙事单品"}</span>}
                          {entry.tier && <span className="hi-tag">{entry.tier}</span>}
                          {entry.mode && <span className="hi-tag">{entry.mode}</span>}
                          {entry.parentKey && (
                            <span className="hi-tag hi-tag--fork" title={entry.forkReason}>
                              fork
                            </span>
                          )}
                          {entry.fileCount != null && <span className="hi-files">{entry.fileCount} files</span>}
                        </div>
                        {entry.hasCheckpoint && entry.lastCompletedStep && (
                          <div className="hi-cp-info">断点: {STEP_LABEL_MAP.get(entry.lastCompletedStep) ?? entry.lastCompletedStep}</div>
                        )}
                        {busy && <div className="hi-loading-indicator">加载中...</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </WorkbenchStepSection>

          {error && <div className="error-msg">{error}</div>}
        </div>
      </div>

      <div className="tool-action-row tool-action-row--stack">
        <div className="tool-action-row__main">
          <button
            type="button"
            className={`btn-cancel btn-cancel--compact${(isGenerating || isIpPreprocessing) ? " btn-cancel--active" : ""}`}
            onClick={handleCancel}
            disabled={!isGenerating && !isIpPreprocessing}
          >
            取消生成
          </button>
          {primaryAction === "regen" ? (
            <button
              type="button"
              className="btn-generate btn-generate--regen btn-generate--compact"
              onClick={handleRegenerate}
              disabled={starting || isRunning}
            >
              {starting ? "分析中..." : isViewingRunning ? "重新生成中..." : isRunning ? "等待运行结束" : "重新生成"}
            </button>
          ) : primaryAction === "resume" ? (
            <button
              type="button"
              className="btn-generate btn-generate--resume btn-generate--compact"
              onClick={handleResume}
              disabled={starting || isRunning}
            >
              {starting ? "恢复中..." : isViewingRunning ? "生成中..." : isRunning ? "等待运行结束" : "断点续传"}
            </button>
          ) : (
            <button
              type="button"
              className="btn-generate btn-generate--compact"
              onClick={handleStart}
              disabled={primaryAction === "none" || starting || isGenerating || isHeavyUpload || (!userInput.trim() && uploadedFiles.length === 0)}
              title={isHeavyUpload ? "重需求 IP 请使用上方分步卡片的「开始生成（IP DNA → 下游）」" : undefined}
            >
              {starting ? "启动中..." : isGenerating ? "生成中..." : "开始生成"}
            </button>
          )}
        </div>

        {isRunning && activeEntryKey !== runningEntryKey && (
          <button
            type="button"
            className="tms-running-hint tms-running-hint--inline"
            onClick={() => {
              if (runningEntryKey) {
                useNarrativeStore.setState({
                  activeEntryKey: runningEntryKey,
                  activeEntryStatus: "running",
                  activeSteps: runningProgress,
                });
              }
            }}
          >
            后台运行中 — 点击查看
          </button>
        )}
      </div>

      {impactPreview && pendingForkPlan && (
        <ImpactPreviewModal
          fromStepId={pendingForkPlan.fromStepId}
          pipelineOrder={pendingForkPlan.pipelineOrder}
          affectedSteps={pendingForkPlan.affectedStepIds}
          skipSteps={pendingForkPlan.skipSteps}
          reasoning={impactPreview.reasoning}
          fallback={impactPreview.fallback}
          submitting={starting}
          onConfirm={confirmRegenerate}
          onCancel={cancelRegenerate}
        />
      )}
    </div>
  );
}

/**
 * Phase 4: 分析影响面预览 modal。
 * 用户编辑 step 后点 ▶ 重新生成 → 调 /analyze-impact → 弹这个 modal 显示：
 *   - LLM 推理（reasoning）
 *   - 重新生成的 fromStepId
 *   - 受影响 step（红色"将重新生成"）
 *   - 保留的 step（绿色"将保留"）
 * 用户点"确认重新生成"才真正触发 /regenerate + startFork。
 */
function ImpactPreviewModal({
  fromStepId,
  pipelineOrder,
  affectedSteps,
  skipSteps,
  reasoning,
  fallback,
  submitting,
  onConfirm,
  onCancel,
}: {
  fromStepId: string;
  pipelineOrder: string[];
  affectedSteps: string[];
  skipSteps: string[];
  reasoning: string;
  fallback?: boolean;
  submitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fromIdx = pipelineOrder.indexOf(fromStepId);
  const preserved = fromIdx > 0 ? pipelineOrder.slice(0, fromIdx) : [];
  const willRerun = fromIdx >= 0
    ? pipelineOrder.slice(fromIdx).filter((id) => !skipSteps.includes(id))
    : affectedSteps;

  const labelOf = (id: string) => STEP_LABEL_MAP.get(id) ?? id;

  return (
    <div className="impact-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="impact-modal">
        <div className="impact-modal-header">
          <span className="impact-modal-title">分析影响面</span>
          {fallback && <span className="impact-modal-fallback">（LLM 失败，已用规则兜底）</span>}
          <button className="impact-modal-close" onClick={onCancel} aria-label="关闭">×</button>
        </div>

        <div className="impact-modal-body">
          {reasoning && (
            <div className="impact-modal-section">
              <div className="impact-modal-section-title">分析说明</div>
              <div className="impact-modal-reasoning">{reasoning}</div>
            </div>
          )}

          <div className="impact-modal-section">
            <div className="impact-modal-section-title">重新生成起点</div>
            <div className="impact-modal-from-step">▶ {labelOf(fromStepId)}（{fromStepId}）</div>
          </div>

          {preserved.length > 0 && (
            <div className="impact-modal-section">
              <div className="impact-modal-section-title impact-modal-preserved-title">
                ✓ 将保留 ({preserved.length})
              </div>
              <div className="impact-modal-step-list impact-modal-preserved-list">
                {preserved.map((id) => (
                  <div key={id} className="impact-modal-step impact-modal-step--preserved">
                    {labelOf(id)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {willRerun.length > 0 && (
            <div className="impact-modal-section">
              <div className="impact-modal-section-title impact-modal-rerun-title">
                ⟳ 将重新生成 ({willRerun.length})
              </div>
              <div className="impact-modal-step-list impact-modal-rerun-list">
                {willRerun.map((id) => (
                  <div key={id} className="impact-modal-step impact-modal-step--rerun">
                    {labelOf(id)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {skipSteps.length > 0 && (
            <div className="impact-modal-section">
              <div className="impact-modal-section-title impact-modal-skip-title">
                — 不受影响 (跳过, {skipSteps.length})
              </div>
              <div className="impact-modal-step-list impact-modal-skip-list">
                {skipSteps.map((id) => (
                  <div key={id} className="impact-modal-step impact-modal-step--skip">
                    {labelOf(id)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="impact-modal-footer">
          <button className="impact-modal-btn impact-modal-btn--cancel" onClick={onCancel} disabled={submitting}>
            取消
          </button>
          <button className="impact-modal-btn impact-modal-btn--confirm" onClick={onConfirm} disabled={submitting}>
            {submitting ? "生成中..." : "确认重新生成"}
          </button>
        </div>
      </div>
    </div>
  );
}

const STEP_LABEL_MAP = new Map(PIPELINE_STEPS.map((s) => [s.id, s.label]));

function formatHistoryTime(entry: HistoryEntry): string {
  if (entry.startedAt) {
    try {
      const d = new Date(entry.startedAt);
      if (!isNaN(d.getTime())) {
        return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      }
    } catch { /* fallback */ }
  }
  const k = entry.key.replace(/\.json$/, "");
  const m = k.match(/(\d{4})-(\d{2})-(\d{2})[T_](\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]} ${m[4]}:${m[5]}`;
  return k.slice(0, 16);
}

const NARRATIVE_MODE_IDS = new Set(NARRATIVE_ROUTES.map((r) => r.id));

function inferRouteGroup(tier: TierId | null, mode: ModeId | null): "planning" | "narrative" {
  if (mode && (NARRATIVE_MODE_IDS.has(mode) || mode === ("auto" as ModeId))) return "narrative";
  if (tier) return "planning";
  return "planning";
}

// D3 + Lore 整合：DESIGN_MODE_STEPS 与后端 modes.ts 中 design_* 的 steps 对齐。
// 注意：Lore (L) 已由通用叙事 agent 内嵌产出，所有 design_* 路由不再展示独立 lore_generation。
const DESIGN_MODE_STEPS: Record<string, string[]> = {
  design_full_narrative:  [...DESIGN_STEPS, ...PLAN_BASE, "character_enrichment", "item_database", "story_framework", "outline_batch", "detailed_outline", "plot_generation", "script_generation", "quest_generation", "scene_generation"],
  design_fragmented:      [...DESIGN_STEPS, ...PLAN_BASE, "character_enrichment", "item_database", "scene_generation"],
  design_emergent:        [...DESIGN_STEPS, ...PLAN_BASE, "character_enrichment", "emergent_event"],
  design_only:            [...DESIGN_STEPS],
};

const STEP_LABEL_LOOKUP = new Map(PIPELINE_STEPS.map((s) => [s.id, s.label]));

function resolveExpectedSteps(tier: TierId | null, mode: ModeId | null): string[] {
  if (mode) {
    const route = NARRATIVE_ROUTES.find((r) => r.id === mode);
    // Phase 3.3: NARRATIVE_ROUTES.steps 现在可为 null（narrative_auto 无静态预览）。
    if (route && route.steps && route.steps.length > 0) return route.steps;
    if (mode in DESIGN_MODE_STEPS) return DESIGN_MODE_STEPS[mode];
  }
  if (tier) {
    const steps = TIER_MODE_STEPS[tier];
    if (steps) return steps;
  }
  return TIER_MODE_STEPS.tier1;
}

function buildStepsFromCtx(ctx: NarrativeContext, expectedStepIds: string[]): StepState[] {
  return expectedStepIds.map((id) => {
    let ctxField = STEP_CTX_FIELD[id];
    if (id === "script_generation") ctxField = "jrpg_script";
    if (id === "scene_generation") ctxField = "scene_map";
    const fieldData = ctxField ? (ctx as Record<string, unknown>)[ctxField] : undefined;
    const hasData = fieldData != null;
    return {
      id,
      label: STEP_LABEL_LOOKUP.get(id) ?? id,
      status: hasData ? "completed" as const : "pending" as const,
      data: hasData ? fieldData : undefined,
    };
  });
}
