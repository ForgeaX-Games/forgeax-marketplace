import { GoogleGenAI, type GenerateContentResponse } from "@google/genai";

export interface LLMCallOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeout?: number;
  responseFormat?: "text" | "json";
}

export interface LLMClientConfig {
  apiKey?: string;
  proxyUrl?: string;
  /** Bearer token for LiteLLM proxy (`LITELLM_PROXY_KEY`). */
  proxyApiKey?: string;
  defaultModel?: string;
}

import { getDefaultModel } from "../utils/plugin-env.js";
const DEFAULT_MODEL = getDefaultModel();
const DEFAULT_TIMEOUT = 300_000;
/**
 * Gemini 2.5 Flash / Pro 单次 generate 输出 token 硬上限。
 * 这是模型物理上限（传更大也只会输出到 64K），全代码库统一引用此值。
 * 短输出步骤不会因为 maxOutputTokens 设大而多消耗 token —— 计费按实际输出。
 */
export const MODEL_OUTPUT_MAX_TOKENS = 65_536;
const DEFAULT_MAX_TOKENS = MODEL_OUTPUT_MAX_TOKENS;
const DEFAULT_RETRIES = 3;

/**
 * 检测 JSON 字符串是否被截断（基于括号配平）。
 * 仅做廉价检测，不验证语义；语义校验交给上层 extractJSON。
 *
 * 触发条件：
 *  - 输入空字符串 → 抛错
 *  - 末尾不是 } 或 ] → 抛错
 *  - 大括号 / 中括号未配平 → 抛错
 *
 * 抛错时由 callWithRetry 自动重试 3 次，错误信息回灌给 LLM。
 */
export function assertJsonNotTruncated(raw: string, label: string): void {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`[${label}] LLM 返回空字符串，疑似超时/截断`);
  }
  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar !== "}" && lastChar !== "]") {
    const stripped = trimmed.replace(/```\s*$/g, "").trim();
    const lastCharStripped = stripped[stripped.length - 1];
    if (lastCharStripped !== "}" && lastCharStripped !== "]") {
      throw new Error(
        `[${label}] LLM 输出疑似被截断（末尾不是 } 或 ]，最后 30 字符: ${stripped.slice(-30)})`,
      );
    }
  }
  let braceDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") braceDepth++;
    else if (ch === "}") braceDepth--;
    else if (ch === "[") bracketDepth++;
    else if (ch === "]") bracketDepth--;
  }
  if (braceDepth !== 0 || bracketDepth !== 0) {
    throw new Error(
      `[${label}] JSON 括号未配平（{ 差 ${braceDepth}，[ 差 ${bracketDepth}），疑似被截断`,
    );
  }
}

export class LLMClient {
  private client: GoogleGenAI | null;
  private proxyUrl: string | null;
  private proxyApiKey: string | null;
  private defaultModel: string;

  constructor(config: LLMClientConfig) {
    const model = config.defaultModel ?? DEFAULT_MODEL;
    this.defaultModel = model;
    this.proxyUrl = config.proxyUrl?.replace(/\/+$/, "") ?? null;
    this.proxyApiKey = config.proxyApiKey?.trim() || null;

    if (this.proxyUrl) {
      this.client = null;
      if (!this.proxyApiKey) {
        throw new Error(
          "LLMClient proxy mode requires LITELLM_PROXY_KEY (LiteLLM proxy auth)",
        );
      }
    } else if (config.apiKey) {
      this.client = new GoogleGenAI({ apiKey: config.apiKey });
    } else {
      throw new Error("LLMClient requires either proxyUrl+proxyApiKey or apiKey");
    }
  }

  async call(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions = {},
  ): Promise<string> {
    if (this.proxyUrl) {
      return this._callViaProxy(systemPrompt, userPrompt, options);
    }
    return this._callViaSdk(systemPrompt, userPrompt, options);
  }

  private async _callViaSdk(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions,
  ): Promise<string> {
    const model = options.model ?? this.defaultModel;
    const config: Record<string, unknown> = {};

    if (options.temperature !== undefined)
      config.temperature = options.temperature;
    config.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
    if (options.responseFormat === "json")
      config.responseMimeType = "application/json";

    const response: GenerateContentResponse =
      await this.client!.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        config: {
          systemInstruction: systemPrompt,
          ...config,
        },
      });

    const text = response.text;
    if (!text) throw new Error("LLM returned empty response");
    return text;
  }

  private async _callViaProxy(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions,
  ): Promise<string> {
    const model = options.model ?? this.defaultModel;
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;

    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    // ForgeaX LiteLLM proxy exposes OpenAI-compat `/v1/chat/completions`.
    // Legacy `/v1/gemini/generateContent/*` routes return 404 as of 2026-06.
    const url = `${this.proxyUrl}/chat/completions`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.proxyApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const detail = await resp.text().catch(() => "");
        throw new Error(`Proxy returned ${resp.status}: ${detail}`);
      }

      const data = await resp.json() as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };

      const text = data.choices?.[0]?.message?.content;
      if (!text) {
        const msg = data.error?.message ?? "LLM returned empty response";
        throw new Error(msg);
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }

  async *callStream(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions = {},
  ): AsyncGenerator<string> {
    if (this.proxyUrl) {
      yield* this._streamViaProxy(systemPrompt, userPrompt, options);
    } else {
      yield* this._streamViaSdk(systemPrompt, userPrompt, options);
    }
  }

  private async *_streamViaSdk(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions,
  ): AsyncGenerator<string> {
    const model = options.model ?? this.defaultModel;
    const config: Record<string, unknown> = {};
    if (options.temperature !== undefined) config.temperature = options.temperature;
    config.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_TOKENS;
    if (options.responseFormat === "json") config.responseMimeType = "application/json";

    const stream = await this.client!.models.generateContentStream({
      model,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: { systemInstruction: systemPrompt, ...config },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text;
    }
  }

  private async *_streamViaProxy(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions,
  ): AsyncGenerator<string> {
    // Proxy only exposes generateContent (non-streaming).
    // Simulate streaming by yielding in small chunks for typewriter UX.
    const result = await this._callViaProxy(systemPrompt, userPrompt, options);
    if (!result) return;

    const CHUNK = 80;
    for (let i = 0; i < result.length; i += CHUNK) {
      yield result.slice(i, i + CHUNK);
      if (i + CHUNK < result.length) {
        await new Promise((r) => setTimeout(r, 12));
      }
    }
  }

  async callStreamFull(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions = {},
    onChunk?: (chunk: string, accumulated: string) => void,
    maxRetries = DEFAULT_RETRIES,
  ): Promise<string> {
    let lastError: Error | undefined;
    for (let i = 0; i < Math.max(1, maxRetries); i++) {
      try {
        let accumulated = "";
        for await (const chunk of this.callStream(systemPrompt, userPrompt, options)) {
          accumulated += chunk;
          onChunk?.(chunk, accumulated);
        }
        if (!accumulated) throw new Error("LLM returned empty response (stream)");
        return accumulated;
      } catch (e) {
        lastError = e as Error;
        if (i < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
        }
      }
    }
    throw lastError ?? new Error("callStreamFull exhausted all retries");
  }

  async callWithRetry(
    systemPrompt: string,
    userPrompt: string,
    options: LLMCallOptions = {},
    parseResult?: (raw: string) => unknown,
    onChunk?: (chunk: string, accumulated: string) => void,
  ): Promise<string> {
    const effectiveRetries = DEFAULT_RETRIES;
    let lastError: Error | undefined;
    let adjustedUserPrompt = userPrompt;

    const effectiveSystemPrompt =
      options.responseFormat === "json"
        ? systemPrompt +
          "\n\n【格式铁律】你的输出必须是且仅是合法JSON。禁止：注释、省略号(...)、尾逗号、未转义换行符、单引号。数组/对象元素之间必须用逗号分隔。"
        : systemPrompt;

    // json 模式下，若调用方未自定义 parseResult，自动启用截断校验：
    // 末尾必须是 } 或 ]，且括号配平，否则抛错触发本函数自身的 3 次重试。
    // 这避免了 LLM 输出在 maxOutputTokens 边界被切成半截 JSON 后下游 JSON.parse 直接挂掉的问题。
    const effectiveParseResult =
      parseResult ??
      (options.responseFormat === "json"
        ? (raw: string) => assertJsonNotTruncated(raw, "callWithRetry.json")
        : undefined);

    for (let i = 0; i < effectiveRetries; i++) {
      try {
        const raw = onChunk
          ? await this.callStreamFull(effectiveSystemPrompt, adjustedUserPrompt, options, onChunk)
          : await this.call(effectiveSystemPrompt, adjustedUserPrompt, options);
        if (effectiveParseResult) effectiveParseResult(raw);
        return raw;
      } catch (e) {
        lastError = e as Error;
        if (i < effectiveRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, i)));
        }
        adjustedUserPrompt =
          userPrompt +
          `\n\n⚠️ 上次输出有误（第${i + 1}次重试）：${lastError.message}\n请重新生成。严格要求：\n- 输出必须是合法JSON，禁止任何注释、省略号或多余文字\n- 数组元素之间必须有逗号分隔\n- 对象键值对之间必须有逗号分隔\n- 最后一个元素后禁止尾逗号\n- 字符串中的换行符必须用\\n转义`;
      }
    }
    throw lastError ?? new Error("callWithRetry exhausted all retries");
  }
}

/**
 * Attempt to repair common LLM JSON output errors:
 * - Trailing commas before ] or }
 * - Missing commas between elements (e.g. "}\n{" or '"\n"')
 * - Single quotes used as string delimiters
 * - Unescaped control characters inside strings
 */
function repairJSON(text: string): string {
  let s = text;
  // Remove trailing commas: ,] or ,}
  s = s.replace(/,\s*([\]}])/g, "$1");
  // Insert missing commas: }\s*{ or ]\s*[ or "value"\s*"key" patterns
  s = s.replace(/}\s*\n\s*{/g, "},\n{");
  s = s.replace(/]\s*\n\s*\[/g, "],\n[");
  s = s.replace(/"\s*\n(\s*")/g, '",\n$1');
  // Fix: value followed by key without comma (e.g. "foo": "bar"\n"baz":)
  s = s.replace(/"(\s*)\n(\s*"[^"]+"\s*:)/g, '",$1\n$2');
  // Replace single quotes with double (only outside already-double-quoted strings)
  // Conservative: only fix obvious patterns like {'key': 'value'}
  if (!s.includes('"')) {
    s = s.replace(/'/g, '"');
  }
  return s;
}

function safeParse<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const repaired = repairJSON(text);
    return JSON.parse(repaired) as T;
  }
}

export function parseJSON<T = unknown>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  return safeParse<T>(cleaned);
}

export function extractJSON<T = unknown>(raw: string): T {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return safeParse<T>(match[1].trim());
  try {
    return safeParse<T>(raw.trim());
  } catch {
    const jsonStart = raw.search(/[{[]/);
    if (jsonStart >= 0) {
      const isArray = raw[jsonStart] === "[";
      const jsonEnd = raw.lastIndexOf(isArray ? "]" : "}");
      if (jsonEnd > jsonStart) {
        return safeParse<T>(raw.slice(jsonStart, jsonEnd + 1));
      }
    }
    throw new Error(`No valid JSON found in response: ${raw.slice(0, 200)}`);
  }
}
