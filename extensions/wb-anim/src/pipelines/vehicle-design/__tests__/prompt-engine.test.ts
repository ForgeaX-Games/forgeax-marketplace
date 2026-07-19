import { describe, it, expect } from 'vitest'
import { generateViewsPrompt, generateAnimPrompt, generateSingleViewAnimPrompt } from '../prompt-engine'
import { getViewMode, getAnimation, getUniqueViews, type VehicleView } from '../vehicle-types'

const fourDir = getViewMode('four-dir')!
const sideOnly = getViewMode('side-only')!
const style = 'pixel art style'
const desc = 'military tank'

describe('viewPromptLabel (via generateViewsPrompt)', () => {
  const prompt = generateViewsPrompt(fourDir, style, desc)

  it('left view says FACING RIGHT', () => {
    expect(prompt).toContain('FACING RIGHT')
  })

  it('front view says facing the camera', () => {
    expect(prompt).toContain('FRONT')
    expect(prompt).toContain('facing the camera')
  })

  it('rear view says facing away', () => {
    expect(prompt).toContain('REAR')
    expect(prompt).toContain('facing away')
  })

  it('does NOT use old wordings', () => {
    expect(prompt).not.toContain('body pointing LEFT')
    expect(prompt).not.toContain('body pointing RIGHT')
    expect(prompt).not.toContain('LEFT VIEW')
    expect(prompt).not.toContain('RIGHT VIEW')
  })
})

describe('generateViewsPrompt side-view scaling', () => {
  const prompt = generateViewsPrompt(fourDir, style, desc)

  it('includes consistent scale guidance', () => {
    expect(prompt).toContain('CONSISTENT SCALE')
    expect(prompt).toContain('vehicle HEIGHT consistent')
  })
})

describe('generateAnimPrompt — regular animation', () => {
  const idle = getAnimation('idle')!
  const uniqueViews = getUniqueViews(fourDir)
  const prompt = generateAnimPrompt(idle, fourDir, uniqueViews, style, desc)

  it('generates animation prompt with frame columns', () => {
    expect(prompt).toContain('3 COLUMNS')
    expect(prompt).toContain('ANIMATION')
    expect(prompt).toContain('LOOP')
  })

  it('does NOT use static state format', () => {
    expect(prompt).not.toContain('STATIC STATE SHEET')
  })

  it('includes side-view scaling guidance', () => {
    expect(prompt).toContain('CONSISTENT SCALE')
  })
})

describe('generateAnimPrompt — damaged in-place loop', () => {
  const damaged = getAnimation('damaged')!
  const uniqueViews = getUniqueViews(fourDir)
  const prompt = generateAnimPrompt(damaged, fourDir, uniqueViews, style, desc)

  it('uses the regular multi-frame animation format (NOT static state)', () => {
    expect(prompt).not.toContain('STATIC STATE SHEET')
    expect(prompt).toContain(`${damaged.framesPerView} COLUMNS`)
  })

  it('row count matches unique views', () => {
    expect(prompt).toContain(`${uniqueViews.length} ROWS`)
  })

  it('includes loop marker since damaged is looping', () => {
    expect(prompt).toContain('LOOP:')
  })

  it('emphasises body-stationary with micro VFX per frame', () => {
    expect(prompt).toMatch(/IN-PLACE|stationary/i)
  })
})

describe('generateAnimPrompt — destroyed in-place loop', () => {
  const destroyed = getAnimation('destroyed')!
  const uniqueViews = getUniqueViews(fourDir)
  const prompt = generateAnimPrompt(destroyed, fourDir, uniqueViews, style, desc)

  it('uses the regular multi-frame animation format', () => {
    expect(prompt).not.toContain('STATIC STATE SHEET')
    expect(prompt).toContain(`${destroyed.framesPerView} COLUMNS`)
  })

  it('mentions wreckage and smoke wisp in checklist', () => {
    expect(prompt.toLowerCase()).toContain('wreckage')
    expect(prompt.toLowerCase()).toMatch(/smoke|ember/)
  })
})

describe('generateSingleViewAnimPrompt — damaged single-view', () => {
  const damaged = getAnimation('damaged')!
  const view: VehicleView = 'left'
  const prompt = generateSingleViewAnimPrompt(damaged, view, fourDir, style, desc)

  it('generates a 3-frame single-row strip (not static)', () => {
    expect(prompt).not.toContain('STATIC STATE')
    expect(prompt).toContain('3 vehicle poses')
    expect(prompt).toContain('SINGLE ROW')
  })

  it('uses direct facing label', () => {
    expect(prompt).toContain('FACING RIGHT')
  })
})

describe('generateSingleViewAnimPrompt — regular animation', () => {
  const fire = getAnimation('fire')!
  const view: VehicleView = 'front'
  const prompt = generateSingleViewAnimPrompt(fire, view, fourDir, style, desc)

  it('generates animation frames', () => {
    expect(prompt).toContain('3 vehicle poses')
    expect(prompt).toContain('SINGLE ROW')
  })

  it('does NOT use static state format', () => {
    expect(prompt).not.toContain('STATIC STATE')
  })
})
