import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../CatalogTabs.tsx'),
  'utf8',
)

describe('RuleCatalogTab editable combat rules', () => {
  it('edits structured combat rules instead of rendering static rule text only', () => {
    expect(SOURCE).toContain('readCombatRules')
    expect(SOURCE).toContain('applyCombatRules')
    expect(SOURCE).toContain('RuleSliderField')
  })

  it('organizes rules by combat actor and exposes prototype-style fields', () => {
    expect(SOURCE).toContain('{rule.label} 属性')
    expect(SOURCE).toContain('基础属性')
    expect(SOURCE).toContain('出手 / 先手')
    expect(SOURCE).toContain('RuleSliderField')
    expect(SOURCE).toContain('gc-rule-slider')
    expect(SOURCE).not.toContain("case 'r-skills'")
    expect(SOURCE).not.toContain("case 'r-parry'")
  })
})
