// @source wb-character/server/select-gemini-text-model.ts
/**
 * Gemini text model selector (pure function).
 *
 * wb-skill copy: identical logic to the authoritative file in
 *   wb-character/server/select-gemini-text-model.ts
 *
 * Priority (highest first):
 *   1. explicit passed by caller
 *   2. scenario-specific env: GEMINI_TEXT_MODEL_CHAT / _CHAT_FALLBACK /
 *      _MAGIC_PROMPT / _ANALYZE_IMAGE
 *   3. global env GEMINI_TEXT_MODEL
 *   4. default: gemini-3.1-pro-preview
 */

export type TextScenario = 'chat' | 'chat-fallback' | 'magic-prompt' | 'analyze-image'

export interface SelectOptions {
  explicit?: string
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
