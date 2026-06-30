// @source wb-character/server/env-credentials.ts
/**
 * `.env` credential reader (forgeax-studio global policy: all LLM keys go through .env)
 * ─────────────────────────────────────────────────────────────────
 * The old `llm_key.json` was retired (2026-05). This module extracts from
 * `process.env` the three credential groups needed by wb-skill server:
 *
 *   - Gemini direct:   `GEMINI_API_KEY`
 *   - Claude (incl. LiteLLM proxy): `LITELLM_PROXY_*` preferred, else `ANTHROPIC_*`
 *   - Azure GPT-Image: `AZURE_GPT_IMAGE_KEY` + `AZURE_GPT_IMAGE_ENDPOINT`
 *                       + `AZURE_GPT_IMAGE_DEPLOYMENT` (+ optional API_VERSION)
 *
 * Designed as pure functions with explicit env parameter — easy to unit-test
 * without mocking process.env.
 */

// ── Types ────────────────────────────────────────────────────────────

export interface ClaudeCredentials {
  apiKey: string
  apiBase: string
  model: string
}

export interface AzureImageCredentials {
  apiKey: string
  apiBase: string
  apiVersion: string
  deployment: string
}

type Env = Record<string, string | undefined>

// ── Defaults ─────────────────────────────────────────────────────────

const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-6'
const DEFAULT_AZURE_IMAGE_API_VERSION = '2024-02-01'
const DEFAULT_AZURE_IMAGE_DEPLOYMENT = 'gpt-image-2'

// ── Extractors ───────────────────────────────────────────────────────

/**
 * Gemini direct key — reads `GEMINI_API_KEY` only; returns empty string if absent
 * (caller decides whether to throw). Note: LiteLLM proxy uses openai-compat
 * protocol and is not handled here.
 */
export function pickGeminiKeyFromEnv(env: Env): string {
  return env.GEMINI_API_KEY?.trim() || ''
}

/**
 * Claude credentials — forgeax-studio global routing policy:
 *
 *   1. Both `LITELLM_PROXY_KEY` + `LITELLM_PROXY_BASE_URL` configured -> use proxy
 *      (trailing `/` and `/v1` stripped to avoid double `/v1/v1/messages`)
 *   2. Otherwise use `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`
 *   3. Neither configured -> return null (caller should surface a friendly error)
 *
 * Model defaults to `claude-opus-4-6`; override with `WB_CHARACTER_CLAUDE_MODEL`.
 */
export function pickClaudeFromEnv(env: Env): ClaudeCredentials | null {
  const model = env.WB_CHARACTER_CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL

  const proxyKey = env.LITELLM_PROXY_KEY?.trim()
  const proxyBase = env.LITELLM_PROXY_BASE_URL?.trim()
  if (proxyKey && proxyBase) {
    return {
      apiKey: proxyKey,
      apiBase: proxyBase.replace(/\/+$/, '').replace(/\/v1$/, ''),
      model,
    }
  }

  const anthropicKey = env.ANTHROPIC_API_KEY?.trim()
  if (anthropicKey) {
    return {
      apiKey: anthropicKey,
      apiBase: env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com',
      model,
    }
  }

  return null
}

/**
 * Azure OpenAI gpt-image-2 credentials.
 *   - `AZURE_GPT_IMAGE_KEY`        required
 *   - `AZURE_GPT_IMAGE_ENDPOINT`   required (e.g. `https://<resource>.openai.azure.com`)
 *   - `AZURE_GPT_IMAGE_DEPLOYMENT` optional (default `gpt-image-2`)
 *   - `AZURE_GPT_IMAGE_API_VERSION` optional (default `2024-02-01`)
 */
export function pickAzureImageFromEnv(env: Env): AzureImageCredentials | null {
  const apiKey = env.AZURE_GPT_IMAGE_KEY?.trim()
  const apiBase = env.AZURE_GPT_IMAGE_ENDPOINT?.trim()
  if (!apiKey || !apiBase) return null
  return {
    apiKey,
    apiBase: apiBase.replace(/\/+$/, ''),
    apiVersion: env.AZURE_GPT_IMAGE_API_VERSION?.trim() || DEFAULT_AZURE_IMAGE_API_VERSION,
    deployment: env.AZURE_GPT_IMAGE_DEPLOYMENT?.trim() || DEFAULT_AZURE_IMAGE_DEPLOYMENT,
  }
}
