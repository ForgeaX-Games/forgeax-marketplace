import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * NumericEditors 的源级契约（与 BlueprintGameplayPanel.visual 同风格）：
 * 锁死条件编辑器与分支编辑器对玩法系统（v9+）的覆盖，避免回退到
 * 「只能编数值/旗标/物品」而丢掉 demo 战斗蓝图真正在用的 hpRatio / qteOutcome。
 */
const SOURCE = readFileSync(resolve(import.meta.dirname, '../NumericEditors.tsx'), 'utf8')

describe('NumericEditors condition & branch coverage', () => {
  it('ConditionRow 支持 hpRatio（血量比例）条件 —— demo 战斗分支核心', () => {
    expect(SOURCE).toContain("type === 'hpRatio'")
    expect(SOURCE).toContain("clause.type === 'hpRatio'")
    expect(SOURCE).toContain('血量比例')
    // 百分比 UI ↔ 0~1 ratio 的换算
    expect(SOURCE).toContain('(clause.value ?? 0) * 100')
  })

  it('ConditionRow 支持 QTE分数 与 状态 条件', () => {
    expect(SOURCE).toContain("type === 'score'")
    expect(SOURCE).toContain("clause.type === 'score'")
    expect(SOURCE).toContain("type === 'status'")
    expect(SOURCE).toContain("clause.type === 'status'")
  })

  it('hpRatio / status 目标从 scenario.entities / statuses 取选项', () => {
    expect(SOURCE).toContain('scenario.entities')
    expect(SOURCE).toContain('scenario.statuses')
    expect(SOURCE).toContain('entities={entityOptions}')
    expect(SOURCE).toContain('statuses={statusOptions}')
  })

  it('BranchGateEditor 为 qte_pass / qte_fail 分支提供 qteOutcome 判定档选择', () => {
    expect(SOURCE).toContain("branch.kind === 'qte_pass' || branch.kind === 'qte_fail'")
    expect(SOURCE).toContain('qteOutcome')
    expect(SOURCE).toContain('判定档')
  })
})
