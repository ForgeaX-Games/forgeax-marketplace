import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../BlueprintTab.tsx'),
  'utf8',
)

describe('BlueprintTab port visuals', () => {
  test('keeps ReactFlow handles available for edge anchoring but visually hides them', () => {
    expect(SOURCE).toContain('.ks-bpg-handle')
    expect(SOURCE).toMatch(/\.ks-bpg-handle\s*\{[\s\S]*opacity:\s*0\s*!important/)
    expect(SOURCE).toMatch(/\.ks-bpg-handle\s*\{[\s\S]*pointer-events:\s*none\s*!important/)
  })

  test('does not render a fake default output pin for terminal nodes', () => {
    expect(SOURCE).not.toContain("__default', label: '输出'")
  })

  test('labels unlabeled QTE outcome branches instead of falling back to generic output text', () => {
    expect(SOURCE).toContain("if (kind === 'qte_pass') return 'QTE 成功'")
    expect(SOURCE).toContain("if (kind === 'qte_fail') return 'QTE 失败'")
  })
})
