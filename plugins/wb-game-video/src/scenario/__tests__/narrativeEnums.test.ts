import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const GT = readFileSync(resolve(import.meta.dirname, '../gameplayTypes.ts'), 'utf8')
const BS = readFileSync(resolve(import.meta.dirname, '../../blueprint/blueprint-schema.ts'), 'utf8')

describe('narrative enums', () => {
  it('HudPreset includes narrative', () => {
    expect(GT).toMatch(/HudPreset\s*=\s*'hidden'\s*\|\s*'main'\s*\|\s*'battle'\s*\|\s*'explore'\s*\|\s*'narrative'/)
  })
  it('QteUi / ChoiceUi named unions include ink variants', () => {
    expect(GT).toMatch(/QteUi\s*=\s*'default'\s*\|\s*'battleParry'\s*\|\s*'inkKou'/)
    expect(GT).toMatch(/ChoiceUi\s*=\s*'default'\s*\|\s*'battleSkillBar'\s*\|\s*'inkYingMo'/)
  })
  it('BLUEPRINT_HUD_MODES includes narrative', () => {
    expect(BS).toContain("'narrative'")
  })
})
