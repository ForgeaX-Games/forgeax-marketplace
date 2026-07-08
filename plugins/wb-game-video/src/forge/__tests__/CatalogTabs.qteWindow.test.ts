import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(resolve(import.meta.dirname, '../CatalogTabs.tsx'), 'utf8')

describe('CatalogTabs timed_qte timeline presentation', () => {
  it('uses qte_window material kind instead of option for whole-qte envelope', () => {
    expect(SOURCE).toContain("'qte_window'")
    expect(SOURCE).toContain("key: 'qte-window'")
    expect(SOURCE).toContain('is-qte-window')
    expect(SOURCE).not.toContain("key: 'option:qte-window'")
  })

  it('shows QTE window card instead of option card on timed_qte nodes', () => {
    expect(SOURCE).toContain('isTimedQteNode')
    expect(SOURCE).toContain('title="QTE 窗口"')
    expect(SOURCE).toContain('QTE 按键点')
  })
})
