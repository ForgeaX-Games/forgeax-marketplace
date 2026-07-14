// @source wb-character/server/select-gemini-text-model.ts
/**
 * Gemini 文本模型选择器（纯函数）
 * ──────────────────────────────────────────
 * character-editor 有若干条文本 LLM 调用路径：/chat（原本走 Claude）、
 * magic-prompt（增强用户 prompt）、analyze-image（Ultimate 看图吐 prompt）、
 * 以及 Claude 失败时的 Gemini fallback。
 *
 * 之前这些地方都硬编码 `gemini-2.5-flash`。现在 Claude 4.6 被封、上游要求
 * 统一走 `gemini-3.1-pro-preview`。为了不在 api-plugin.ts 里四处散落同一个
 * 字符串，把「选哪个 Gemini 文本模型」抽成这一个函数：
 *
 * 优先级（越靠前越高）：
 *   1. 调用方显式传入的 `explicit`
 *   2. 场景专属 env：GEMINI_TEXT_MODEL_CHAT / _CHAT_FALLBACK /
 *      _MAGIC_PROMPT / _ANALYZE_IMAGE
 *   3. 全局 env `GEMINI_TEXT_MODEL`
 *   4. 默认：`gemini-3.1-pro-preview`
 *
 * 设计为纯函数，便于 Vitest 校验，不触碰 process.env（env 由调用方传入）。
 */

export type TextScenario = 'chat' | 'chat-fallback' | 'magic-prompt' | 'analyze-image'

export interface SelectOptions {
  /** 调用点显式传入的 model；优先级最高 */
  explicit?: string
  /** 环境变量表（由 api-plugin.ts 负责从 process.env 注入） */
  env?: Record<string, string | undefined>
}

const DEFAULT_TEXT_MODEL = 'gemini-3.1-pro-preview'

const SCENARIO_ENV: Record<TextScenario, string> = {
  'chat': 'GEMINI_TEXT_MODEL_CHAT',
  'chat-fallback': 'GEMINI_TEXT_MODEL_CHAT_FALLBACK',
  'magic-prompt': 'GEMINI_TEXT_MODEL_MAGIC_PROMPT',
  'analyze-image': 'GEMINI_TEXT_MODEL_ANALYZE_IMAGE',
}

function nonEmpty(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function selectGeminiTextModel(
  scenario: TextScenario,
  options: SelectOptions = {},
): string {
  const explicit = nonEmpty(options.explicit)
  if (explicit) return explicit

  const env = options.env ?? {}
  const scenarioOverride = nonEmpty(env[SCENARIO_ENV[scenario]])
  if (scenarioOverride) return scenarioOverride

  const globalOverride = nonEmpty(env.GEMINI_TEXT_MODEL)
  if (globalOverride) return globalOverride

  return DEFAULT_TEXT_MODEL
}
