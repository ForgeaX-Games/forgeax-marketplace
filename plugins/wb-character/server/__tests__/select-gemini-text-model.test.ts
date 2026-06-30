import { describe, expect, it } from 'vitest'
import { selectGeminiTextModel, type TextScenario } from '../select-gemini-text-model'

describe('selectGeminiTextModel', () => {
  const scenarios: TextScenario[] = ['chat', 'chat-fallback', 'magic-prompt', 'analyze-image']

  it('defaults every scenario to gemini-3.1-pro-preview when no overrides', () => {
    for (const s of scenarios) {
      expect(selectGeminiTextModel(s, {})).toBe('gemini-3.1-pro-preview')
    }
  })

  it('honors explicit per-call model when provided', () => {
    expect(selectGeminiTextModel('chat', { explicit: 'gemini-2.5-flash' })).toBe('gemini-2.5-flash')
  })

  it('honors global env override GEMINI_TEXT_MODEL across all scenarios', () => {
    for (const s of scenarios) {
      expect(
        selectGeminiTextModel(s, { env: { GEMINI_TEXT_MODEL: 'gemini-2.5-pro' } }),
      ).toBe('gemini-2.5-pro')
    }
  })

  it('honors scenario-specific env override over the global one', () => {
    expect(
      selectGeminiTextModel('magic-prompt', {
        env: {
          GEMINI_TEXT_MODEL: 'gemini-2.5-pro',
          GEMINI_TEXT_MODEL_MAGIC_PROMPT: 'gemini-2.5-flash',
        },
      }),
    ).toBe('gemini-2.5-flash')
  })

  it('explicit per-call model beats any env override', () => {
    expect(
      selectGeminiTextModel('chat', {
        explicit: 'gemini-3.1-flash-lite-preview',
        env: { GEMINI_TEXT_MODEL: 'gemini-2.5-pro' },
      }),
    ).toBe('gemini-3.1-flash-lite-preview')
  })

  it('ignores empty/whitespace env values and falls back to default', () => {
    expect(
      selectGeminiTextModel('chat', { env: { GEMINI_TEXT_MODEL: '   ' } }),
    ).toBe('gemini-3.1-pro-preview')
  })

  it('ignores empty explicit and falls back to default', () => {
    expect(selectGeminiTextModel('chat', { explicit: '' })).toBe('gemini-3.1-pro-preview')
    expect(selectGeminiTextModel('chat', { explicit: '   ' })).toBe('gemini-3.1-pro-preview')
  })

  it('scenario chat-fallback uses GEMINI_TEXT_MODEL_CHAT_FALLBACK when given', () => {
    expect(
      selectGeminiTextModel('chat-fallback', {
        env: { GEMINI_TEXT_MODEL_CHAT_FALLBACK: 'gemini-2.5-flash' },
      }),
    ).toBe('gemini-2.5-flash')
  })
})
