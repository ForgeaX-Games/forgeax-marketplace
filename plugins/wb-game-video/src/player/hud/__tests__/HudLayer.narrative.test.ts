import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(resolve(import.meta.dirname, '../HudLayer.tsx'), 'utf8')

describe('HudLayer narrative preset', () => {
  it('narrative preset only allows playerHp (no boss bar / score in narrative scenes)', () => {
    // 叙事段不得出现敌方血条/score —— presetAllows 必须显式处理 narrative,不能落 default:return true
    expect(SOURCE).toContain("case 'narrative':")
    const narrativeBranch = SOURCE.slice(
      SOURCE.indexOf("case 'narrative':"),
      SOURCE.indexOf("case 'main':"),
    )
    expect(narrativeBranch).toContain("return el === 'playerHp'")
    expect(narrativeBranch).not.toContain('bossHp')
  })
})
