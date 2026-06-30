import { describe, expect, it } from 'vitest'
import {
  pickClaudeFromEnv,
  pickGeminiKeyFromEnv,
  pickAzureImageFromEnv,
} from '../env-credentials'

describe('pickGeminiKeyFromEnv()', () => {
  it('returns GEMINI_API_KEY trimmed', () => {
    expect(pickGeminiKeyFromEnv({ GEMINI_API_KEY: '  aistudio-key  ' })).toBe('aistudio-key')
  })

  it('returns empty string when GEMINI_API_KEY is unset/blank', () => {
    expect(pickGeminiKeyFromEnv({})).toBe('')
    expect(pickGeminiKeyFromEnv({ GEMINI_API_KEY: '' })).toBe('')
    expect(pickGeminiKeyFromEnv({ GEMINI_API_KEY: '   ' })).toBe('')
  })
})

describe('pickClaudeFromEnv()', () => {
  it('prefers LITELLM_PROXY_* when both proxy vars are set', () => {
    const got = pickClaudeFromEnv({
      LITELLM_PROXY_KEY: 'proxy-key',
      LITELLM_PROXY_BASE_URL: 'https://llm-proxy.example.com',
      ANTHROPIC_API_KEY: 'should-be-ignored',
    })
    expect(got).toEqual({
      apiKey: 'proxy-key',
      apiBase: 'https://llm-proxy.example.com',
      model: 'claude-opus-4-6',
    })
  })

  it('strips trailing /v1 and trailing slashes from LITELLM_PROXY_BASE_URL', () => {
    expect(
      pickClaudeFromEnv({
        LITELLM_PROXY_KEY: 'k',
        LITELLM_PROXY_BASE_URL: 'https://proxy.example.com/v1/',
      })?.apiBase,
    ).toBe('https://proxy.example.com')
  })

  it('falls back to ANTHROPIC_API_KEY when proxy vars are not both set', () => {
    const got = pickClaudeFromEnv({
      LITELLM_PROXY_KEY: 'only-key-no-base',
      ANTHROPIC_API_KEY: 'anthropic-direct',
      ANTHROPIC_BASE_URL: 'https://api.example.com',
    })
    expect(got).toEqual({
      apiKey: 'anthropic-direct',
      apiBase: 'https://api.example.com',
      model: 'claude-opus-4-6',
    })
  })

  it('defaults ANTHROPIC_BASE_URL to https://api.anthropic.com', () => {
    const got = pickClaudeFromEnv({ ANTHROPIC_API_KEY: 'k' })
    expect(got?.apiBase).toBe('https://api.anthropic.com')
  })

  it('honors WB_CHARACTER_CLAUDE_MODEL override', () => {
    const got = pickClaudeFromEnv({
      ANTHROPIC_API_KEY: 'k',
      WB_CHARACTER_CLAUDE_MODEL: 'claude-sonnet-4-6',
    })
    expect(got?.model).toBe('claude-sonnet-4-6')
  })

  it('returns null when no usable key is configured', () => {
    expect(pickClaudeFromEnv({})).toBeNull()
    expect(pickClaudeFromEnv({ ANTHROPIC_API_KEY: '' })).toBeNull()
  })
})

describe('pickAzureImageFromEnv()', () => {
  it('returns full credentials when key + endpoint are set', () => {
    const got = pickAzureImageFromEnv({
      AZURE_GPT_IMAGE_KEY: 'azkey',
      AZURE_GPT_IMAGE_ENDPOINT: 'https://r.openai.azure.com/',
      AZURE_GPT_IMAGE_DEPLOYMENT: 'my-gpt-image',
      AZURE_GPT_IMAGE_API_VERSION: '2025-01-01',
    })
    expect(got).toEqual({
      apiKey: 'azkey',
      apiBase: 'https://r.openai.azure.com',
      apiVersion: '2025-01-01',
      deployment: 'my-gpt-image',
    })
  })

  it('uses default deployment + api version when not provided', () => {
    const got = pickAzureImageFromEnv({
      AZURE_GPT_IMAGE_KEY: 'k',
      AZURE_GPT_IMAGE_ENDPOINT: 'https://r.openai.azure.com',
    })
    expect(got?.deployment).toBe('gpt-image-2')
    expect(got?.apiVersion).toBe('2024-02-01')
  })

  it('returns null when key or endpoint is missing', () => {
    expect(pickAzureImageFromEnv({})).toBeNull()
    expect(pickAzureImageFromEnv({ AZURE_GPT_IMAGE_KEY: 'k' })).toBeNull()
    expect(pickAzureImageFromEnv({ AZURE_GPT_IMAGE_ENDPOINT: 'https://x' })).toBeNull()
  })
})
