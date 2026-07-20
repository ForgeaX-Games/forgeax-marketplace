/**
 * `.env` 凭据读取器（forgeax-studio 全局策略：所有 LLM key 都走 .env）
 * ─────────────────────────────────────────────────────────────────
 * 旧的 `llm_key.json` 已退役（2026-05）。本模块从 `process.env` 抽取
 * wb-character 服务端需要的三组凭据：
 *
 *   - Gemini 直连：`GEMINI_API_KEY`
 *   - Claude（含 LiteLLM 代理）：`LITELLM_PROXY_*` 优先，否则 `ANTHROPIC_*`
 *   - Azure GPT-Image：`AZURE_GPT_IMAGE_KEY` + `AZURE_GPT_IMAGE_ENDPOINT`
 *                       + `AZURE_GPT_IMAGE_DEPLOYMENT` (+ optional API_VERSION)
 *
 * 设计成纯函数 + 显式 env 入参，便于 vitest 单测，不用 mock process.env。
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
 * Gemini 直连 Key——只读 `GEMINI_API_KEY`，没配则返回空字符串（caller 自行
 * 决定是否 throw）。注：LiteLLM 代理走 openai-compat 协议，不在此处理。
 */
export function pickGeminiKeyFromEnv(env: Env): string {
  return env.GEMINI_API_KEY?.trim() || ''
}

/**
 * Claude 凭据——按 forgeax-studio 全局路由策略：
 *
 *   1. `LITELLM_PROXY_KEY` + `LITELLM_PROXY_BASE_URL` 都配置 → 走代理
 *      （base 末尾的 `/` 和 `/v1` 都剥掉，避免拼接成 `/v1/v1/messages`）
 *   2. 否则用 `ANTHROPIC_API_KEY` + `ANTHROPIC_BASE_URL`
 *   3. 都没配 → 返回 null（caller 应该 surface 友好错误）
 *
 * model 默认 `claude-opus-4-6`；可用 `WB_CHARACTER_CLAUDE_MODEL` 覆盖。
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
 * Azure OpenAI gpt-image-2 凭据。
 *   - `AZURE_GPT_IMAGE_KEY`        必填
 *   - `AZURE_GPT_IMAGE_ENDPOINT`   必填（形如 `https://<resource>.openai.azure.com`）
 *   - `AZURE_GPT_IMAGE_DEPLOYMENT` 可选（默认 `gpt-image-2`）
 *   - `AZURE_GPT_IMAGE_API_VERSION` 可选（默认 `2024-02-01`）
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
