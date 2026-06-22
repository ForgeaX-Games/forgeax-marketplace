import { describe, expect, it } from 'vitest'

import {
  buildUiDesignAssetOutputPath,
  freshUiGenerationBody,
  uiDesignSessionPrefix,
} from '../ui-design-generation-path'
import { createUiGenerationNonce, ensureUiGenerationNonce } from '../ui-design-generation-nonce'

describe('ui-design-generation-path', () => {
  it('ensureUiGenerationNonce creates value when missing', () => {
    const nonce = ensureUiGenerationNonce()
    expect(nonce.length).toBeGreaterThan(10)
    expect(ensureUiGenerationNonce(nonce)).toBe(nonce)
  })

  it('session prefix changes when nonce changes', () => {
    const base = {
      genre: '开放世界',
      style: '科幻',
      styleKey: 'sci-fi',
      genreKey: 'open-world',
    }
    const a = uiDesignSessionPrefix({ ...base, generationNonce: 'nonce-a' })
    const b = uiDesignSessionPrefix({ ...base, generationNonce: 'nonce-b' })
    expect(a).not.toBe(b)
  })

  it('asset output paths are unique per call', () => {
    const prefix = uiDesignSessionPrefix({
      genreKey: 'open-world',
      styleKey: 'sci-fi',
      generationNonce: createUiGenerationNonce(),
    })
    const p1 = buildUiDesignAssetOutputPath(prefix, 'buttonNormal', 'normal', 1)
    const p2 = buildUiDesignAssetOutputPath(prefix, 'buttonNormal', 'normal', 1)
    expect(p1).not.toBe(p2)
    expect(p1).toMatch(/buttonnormal-normal-.*-a1\.png$/)
  })

  it('freshUiGenerationBody always assigns nonce', () => {
    const next = freshUiGenerationBody({ genreKey: 'fps', styleKey: 'modern-dark' })
    expect(String(next.generationNonce || '').length).toBeGreaterThan(8)
  })
})
