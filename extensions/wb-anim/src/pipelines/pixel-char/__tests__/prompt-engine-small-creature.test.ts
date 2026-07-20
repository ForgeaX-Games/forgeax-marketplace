import { describe, it, expect } from 'vitest'
import type { ChibiAction } from '../actions'
import {
  generateSheetPrompt,
  generateSingleDirectionPrompt,
  generateTemplatePrompt,
  generatePoseTransferPrompt,
  type StyleContext,
} from '../prompt-engine'

/**
 * The small-creature layout clause MUST agree with the main grid instruction.
 *
 * The bug these tests guard against:
 *   Previously the clause said "SINGLE PHYSICAL ROW" for EVERY prompt, which
 *   contradicted the main "EXACTLY 4 columns × 4 rows" instruction in the
 *   RPG (multi-direction) case, so Gemini tried to satisfy both by splitting
 *   each direction's 4 frames into a 2×2 mini-grid — i.e. "walk is still
 *   showing 2 rows per direction".
 *
 * The fix:
 *   - SINGLE-DIRECTION (platformer) prompts keep "SINGLE PHYSICAL ROW".
 *   - MULTI-DIRECTION (RPG) prompts instead say "each direction's frames
 *     stay on a SINGLE horizontal row" and explicitly lock the total
 *     `physRows × physCols` grid shape.
 */

const smallCreatureCtx: StyleContext = {
  gameplayMode: 'rpg',
  artStyleId: 'pixel-8bit',
  characterType: 'creature-small',
  customStyle: '',
  charDesc: '',
}

const humanoidCtx: StyleContext = {
  ...smallCreatureCtx,
  characterType: 'humanoid',
}

function smallCreatureAction(directions: ChibiAction['directions']): ChibiAction {
  return {
    id: 'walk',
    label: 'walk',
    framesPerDir: 4,
    directions,
    motion: 'motion-placeholder',
    looping: true,
    forceSingleRow: true,
  }
}

describe('smallCreatureLayoutClause (via generateSheetPrompt)', () => {
  it('uses single-row wording for a platformer (1-direction) small-creature sheet', () => {
    const action = smallCreatureAction(['right'])
    const prompt = generateSheetPrompt(action, smallCreatureCtx)

    expect(prompt).toContain('SMALL-CREATURE LAYOUT')
    expect(prompt).toContain('SINGLE PHYSICAL ROW')
    expect(prompt).toContain('ONE horizontal row of 4 frames')
    expect(prompt).not.toContain('GRID SHAPE LOCK')
  })

  it('uses grid-lock wording (NOT "single row") for a 4-direction RPG small-creature sheet', () => {
    const action = smallCreatureAction(['down', 'left', 'right', 'up'])
    const prompt = generateSheetPrompt(action, smallCreatureCtx)

    expect(prompt).toContain('SMALL-CREATURE LAYOUT')
    expect(prompt).toContain('GRID SHAPE LOCK')
    expect(prompt).toContain('4 physical rows × 4 columns')
    expect(prompt).toContain("ONE row per facing direction")
    expect(prompt).toContain("Do NOT split ANY direction's frames across 2 rows")
    // Critical regression guard: the old bug was the clause saying
    // "SINGLE PHYSICAL ROW" in RPG mode. That phrase must NOT appear.
    expect(prompt).not.toContain('SINGLE PHYSICAL ROW')
    expect(prompt).not.toContain('ONE horizontal row of 4 frames')
  })

  it('omits the small-creature clause entirely for humanoid characters', () => {
    const action = smallCreatureAction(['down', 'left', 'right', 'up'])
    const prompt = generateSheetPrompt(action, humanoidCtx)
    expect(prompt).not.toContain('SMALL-CREATURE LAYOUT')
  })
})

describe('smallCreatureLayoutClause (via other generators)', () => {
  it('generateSingleDirectionPrompt always uses single-row wording (single direction by construction)', () => {
    const action = smallCreatureAction(['left', 'right']) // caller picks ONE direction
    const prompt = generateSingleDirectionPrompt(action, 'right', smallCreatureCtx)
    expect(prompt).toContain('SMALL-CREATURE LAYOUT')
    expect(prompt).toContain('SINGLE PHYSICAL ROW')
    expect(prompt).not.toContain('GRID SHAPE LOCK')
  })

  it('generateTemplatePrompt agrees with the main grid for multi-direction RPG sheets', () => {
    const action = smallCreatureAction(['down', 'left', 'right', 'up'])
    const prompt = generateTemplatePrompt(action, smallCreatureCtx)
    expect(prompt).toContain('GRID SHAPE LOCK')
    expect(prompt).toContain('4 physical rows × 4 columns')
    expect(prompt).not.toContain('SINGLE PHYSICAL ROW')
  })

  it('generatePoseTransferPrompt agrees with the main grid for multi-direction RPG sheets', () => {
    const action = smallCreatureAction(['down', 'left', 'right', 'up'])
    const prompt = generatePoseTransferPrompt(action, smallCreatureCtx)
    expect(prompt).toContain('GRID SHAPE LOCK')
    expect(prompt).toContain('4 physical rows × 4 columns')
    expect(prompt).not.toContain('SINGLE PHYSICAL ROW')
  })
})
