/**
 * blueprint/prompt-resolver.ts
 *
 * 提示词模板解析器。从 .md 模板文件读取 → 按分区解析 → 填充 skill 槽位 →
 * 渲染 ctx 变量 → 输出最终 system / user prompt。
 *
 * 模板文件格式（每个 step 一个 .md）：
 *
 *   # <Step 名称>
 *
 *   ## System Prompt
 *   ### A. 身份与专业性
 *   ### B. 约束与格式
 *   ### C. 机制与流程
 *   ### D. 品类风格注入（可选）
 *
 *   ## User Prompt
 *   <user prompt 模板，含 {{ctx.*}} 占位符>
 *
 *   ## Output Template
 *   <JSON Schema 或示例>
 *
 * 占位符语法：
 *   {{SKILL.<slotName>}}   — 品类 skill 注入（编译时填充）
 *   {{ctx.<fieldPath>}}    — 运行时 ctx 数据注入
 *
 * 向后兼容：
 *   同时支持从现有 PromptComposer（blocks 内联）解析，
 *   使迁移可以逐步进行。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NarrativeContext } from "../../types/index.js";
import type { StepSkillBlock } from "../../knowledge/game-narrative/skill-types.js";
import type { ResolvedPrompts, AgentPromptConfig } from "./types.js";
import type { PromptComposer } from "../prompt-composer.js";
import {
  composeSystemPrompt as legacyComposeSystem,
  composeUserPrompt as legacyComposeUser,
} from "../prompt-composer.js";
import { findGenreByCode } from "../../knowledge/genre-taxonomy.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SKILL_PLACEHOLDER = /\{\{SKILL\.([\w_]+)\}\}/g;
const CTX_PLACEHOLDER = /\{\{ctx\.([\w_.]+)\}\}/g;

// ════════════════════════════════════════════════════════
// 模板缓存
// ════════════════════════════════════════════════════════

interface ParsedTemplate {
  systemPrompt: string;
  userPrompt: string;
  outputTemplate: string;
}

const templateCache = new Map<string, ParsedTemplate>();

function resolveDirWithFallback(candidate: string, srcFallback: string): string {
  return fs.existsSync(candidate) ? candidate : srcFallback;
}

// tsx 模式: __dirname = src/pipeline/blueprint/ → ../agent-templates = src/pipeline/agent-templates/
// 编译模式: __dirname = dist/pipeline/blueprint/ → 回退到 src/ 路径
const TEMPLATES_DIR = resolveDirWithFallback(
  path.resolve(__dirname, "../agent-templates"),
  path.resolve(__dirname, "../../../src/pipeline/agent-templates"),
);

// 品类专属 prompts 根目录：knowledge/game-narrative/skills/<tier>/<genre>/prompts/<step>.md
const SKILLS_DIR = resolveDirWithFallback(
  path.resolve(__dirname, "../../knowledge/game-narrative/skills"),
  path.resolve(__dirname, "../../../src/knowledge/game-narrative/skills"),
);

/**
 * 定位品类专属 prompt 文件：skills/<tier>/<genre>/prompts/<step>.md。
 * 返回绝对路径（可能不存在），由调用方用 fs.existsSync 判断。
 */
function genrePromptPath(genreCode: string, stepId: string): string | null {
  const entry = findGenreByCode(genreCode);
  if (!entry) return null;
  return path.join(SKILLS_DIR, entry.tier, genreCode, "prompts", `${stepId}.md`);
}

// ════════════════════════════════════════════════════════
// 模板解析
// ════════════════════════════════════════════════════════

/**
 * 从 .md 文件按 ## 标题分区提取内容。
 */
function parseTemplateSections(content: string): ParsedTemplate {
  const sections: Record<string, string> = {};
  let currentSection = "__preamble__";
  const lines = content.split("\n");

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      currentSection = h2Match[1].trim().toLowerCase();
      continue;
    }
    if (!sections[currentSection]) sections[currentSection] = "";
    sections[currentSection] += line + "\n";
  }

  const systemKey = Object.keys(sections).find((k) => k.startsWith("system"));
  const userKey = Object.keys(sections).find((k) => k.startsWith("user"));
  const outputKey = Object.keys(sections).find(
    (k) => k.startsWith("output") || k.startsWith("json"),
  );

  return {
    systemPrompt: (systemKey ? sections[systemKey] : "").trim(),
    userPrompt: (userKey ? sections[userKey] : "").trim(),
    outputTemplate: (outputKey ? sections[outputKey] : "").trim(),
  };
}

/**
 * 加载模板（双层）：
 *   1. 品类专属 skills/<tier>/<genre>/prompts/<step>.md（若 genreCode 提供且文件存在，完全覆盖）
 *   2. 通用骨架 agent-templates/<step>.md（fallback）
 *
 * 缓存键 = `${genreCode ?? "_generic"}:${templateId}`。
 */
function loadTemplate(templateId: string, genreCode?: string): ParsedTemplate {
  const cacheKey = `${genreCode ?? "_generic"}:${templateId}`;
  const cached = templateCache.get(cacheKey);
  if (cached) return cached;

  // Layer 1: 品类专属 prompt（完全独立提示词，优先）
  if (genreCode) {
    const gPath = genrePromptPath(genreCode, templateId);
    if (gPath && fs.existsSync(gPath)) {
      const parsed = parseTemplateSections(fs.readFileSync(gPath, "utf-8"));
      templateCache.set(cacheKey, parsed);
      return parsed;
    }
  }

  // Layer 2: 通用骨架
  const filePath = path.join(TEMPLATES_DIR, `${templateId}.md`);
  if (!fs.existsSync(filePath)) {
    const empty: ParsedTemplate = { systemPrompt: "", userPrompt: "", outputTemplate: "" };
    templateCache.set(cacheKey, empty);
    return empty;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = parseTemplateSections(raw);
  templateCache.set(cacheKey, parsed);
  return parsed;
}

// ════════════════════════════════════════════════════════
// Skill 槽位填充
// ════════════════════════════════════════════════════════

function fillSkillSlots(
  text: string,
  skill: StepSkillBlock | null,
  allowedSlots: string[],
): string {
  let result = text.replace(SKILL_PLACEHOLDER, (_, slotName: string) => {
    if (!skill?.slots) return "";
    if (allowedSlots.length > 0 && !allowedSlots.includes(slotName)) return "";
    return skill.slots[slotName] ?? "";
  });

  if (skill?.systemPromptAddition && allowedSlots.length > 0) {
    result += `\n\n${skill.systemPromptAddition}`;
  }

  return result;
}

// ════════════════════════════════════════════════════════
// Ctx 变量渲染
// ════════════════════════════════════════════════════════

function resolveCtxPath(ctx: NarrativeContext, fieldPath: string): string {
  const parts = fieldPath.split(".");
  let current: unknown = ctx;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[part];
  }
  if (current == null) return "";
  if (typeof current === "string") return current;
  return JSON.stringify(current, null, 2);
}

function fillCtxPlaceholders(text: string, ctx: NarrativeContext): string {
  return text.replace(CTX_PLACEHOLDER, (_, fieldPath: string) => {
    return resolveCtxPath(ctx, fieldPath);
  });
}

// ════════════════════════════════════════════════════════
// 公共 API
// ════════════════════════════════════════════════════════

export class PromptResolver {
  /**
   * 从 .md 模板文件解析提示词。
   *
   * System prompt 在 Blueprint 组装时调用（注入 skill，不依赖 ctx 数据）。
   * User prompt 返回含 {{ctx.*}} 的模板字符串，运行时再渲染。
   */
  static resolveFromTemplate(
    promptConfig: AgentPromptConfig,
    skill: StepSkillBlock | null,
    genreCode?: string,
  ): ResolvedPrompts {
    const tpl = loadTemplate(promptConfig.templateId, genreCode);

    const systemPrompt = fillSkillSlots(
      tpl.systemPrompt,
      skill,
      promptConfig.skillSlots,
    );

    return {
      systemPrompt,
      userPromptTemplate: tpl.userPrompt,
      outputSchema: tpl.outputTemplate ? tryParseSchema(tpl.outputTemplate) : undefined,
    };
  }

  /**
   * 从现有 PromptComposer 解析提示词（向后兼容桥接）。
   *
   * 过渡期使用：尚未迁移到 .md 模板的 step 仍用 PromptComposer 内联 blocks。
   * 将 PromptComposer 的 blocks 包装为 ResolvedPrompts 格式。
   */
  static resolveFromComposer(
    composer: PromptComposer,
    ctx: NarrativeContext,
  ): ResolvedPrompts {
    return {
      systemPrompt: legacyComposeSystem(composer, ctx),
      userPromptTemplate: legacyComposeUser(composer, ctx),
    };
  }

  /**
   * 运行时渲染 user prompt 模板。
   * 将 {{ctx.*}} 占位符替换为实际 ctx 数据。
   */
  static renderUserPrompt(template: string, ctx: NarrativeContext): string {
    return fillCtxPlaceholders(template, ctx);
  }

  /**
   * 运行时渲染 system prompt 中的 {{ctx.*}} 占位符（如果有）。
   * 大多数 system prompt 不含 ctx 引用，但部分动态 step 需要。
   */
  static renderSystemPrompt(template: string, ctx: NarrativeContext): string {
    return fillCtxPlaceholders(template, ctx);
  }

  /** 清除模板缓存（用于热重载/测试） */
  static clearCache(): void {
    templateCache.clear();
  }
}

function tryParseSchema(raw: string): Record<string, unknown> | undefined {
  const jsonMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      return undefined;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
