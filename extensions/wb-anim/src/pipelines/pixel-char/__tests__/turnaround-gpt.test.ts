import { describe, it, expect } from 'vitest'
import { generateTurnaroundPrompt, type StyleContext } from '../prompt-engine'

const rpgHumanoid: StyleContext = {
  gameplayMode: 'rpg',
  artStyleId: 'pixel-16bit',
  characterType: 'humanoid',
  customStyle: '',
  charDesc: '',
}

const rpgMonster: StyleContext = {
  ...rpgHumanoid,
  characterType: 'monster',
}

describe('generateTurnaroundPrompt — gpt-image-2 variant', () => {
  const promptH = generateTurnaroundPrompt(rpgHumanoid, 'gpt-image-2')
  const promptM = generateTurnaroundPrompt(rpgMonster, 'gpt-image-2')

  it('does NOT contain SD weight syntax like (keyword:1.4)', () => {
    const sdWeightPattern = /\([^)]+:\d+\.?\d*\)/
    expect(promptH).not.toMatch(sdWeightPattern)
    expect(promptM).not.toMatch(sdWeightPattern)
  })

  it('contains anti-mirror-flip instruction', () => {
    expect(promptH).toContain('NOT produced by horizontally flipping')
    expect(promptM).toContain('NOT produced by horizontally flipping')
  })

  it('uses Chinese labels for left/right views', () => {
    expect(promptH).toContain('左视图')
    expect(promptH).toContain('右视图')
    expect(promptH).toContain('正面')
    expect(promptH).toContain('背面')
  })

  it('describes left view as facing left edge, right view as facing right edge', () => {
    expect(promptH).toContain('faces toward the left edge')
    expect(promptH).toContain('faces toward the right edge')
  })

  it('mentions asymmetric detail handling', () => {
    expect(promptH).toContain('asymmetric')
  })

  it('includes 2×2 grid layout', () => {
    expect(promptH).toContain('2×2')
    expect(promptH).toContain('Top-left')
    expect(promptH).toContain('Bottom-right')
  })

  it('specifies green background', () => {
    expect(promptH).toContain('#00FF00')
  })
})

describe('generateTurnaroundPrompt — gemini variant unchanged', () => {
  const promptGemini = generateTurnaroundPrompt(rpgHumanoid, 'gemini')

  it('still uses the existing Gemini prompt structure', () => {
    expect(promptGemini).toContain('GRID LAYOUT (2×2) — the 4 cells are arranged like a compass')
  })

  it('defaults to gemini when model is omitted', () => {
    const promptDefault = generateTurnaroundPrompt(rpgHumanoid)
    expect(promptDefault).toEqual(promptGemini)
  })
})
