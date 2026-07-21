import { describe, expect, it } from 'vitest'
import type { Entity } from '../../../runtime/schema/graph-schema'
import type { Formula } from '../../persist/formula-authoring'
import { compileFormula, formulaHoles, formulaTermsPreview, missingFormulaHoles, recompileFormulaUsages } from '../formulaApply'

const entities: Record<string, Entity> = {
  'ent-player': {
    id: 'ent-player',
    name: '玩家',
    attrs: { attack: 40, defense: 10 },
    attrMeta: { attack: { label: '攻击' }, defense: { label: '防御' } },
  },
  'ent-boss': {
    id: 'ent-boss',
    name: 'Boss',
    attrs: { attack: 55, defense: 20 },
    attrMeta: { attack: { label: '攻击' }, defense: { label: '防御' } },
  },
}

const damageFormula: Formula = {
  id: 'formula-dmg',
  name: '伤害',
  terms: [
    { id: 't0', op: '+', source: 'entity', refId: '', attr: 'attack' }, // 留空实体（约定属性 attack）
    { id: 't1', op: '-', source: 'entity', refId: 'ent-boss', attr: 'defense' },
  ],
}

describe('formulaApply', () => {
  it('formulaHoles 找出留空条款并带上约定属性名', () => {
    const holes = formulaHoles(damageFormula)
    expect(holes).toEqual([{ termId: 't0', index: 0, suggestedAttr: 'attack' }])
  })

  it('missingFormulaHoles 报告尚未绑定实体的留空位', () => {
    expect(missingFormulaHoles(damageFormula, {})).toHaveLength(1)
    expect(missingFormulaHoles(damageFormula, { t0: { entityId: 'ent-player' } })).toEqual([])
  })

  it('formulaTermsPreview 把留空项标成 ❓ 待填实体', () => {
    expect(formulaTermsPreview(damageFormula.terms, entities, undefined)).toContain('❓待填实体')
  })

  it('compileFormula 用 holeBindings 套回留空位，编译出具体 expr', () => {
    const result = compileFormula(damageFormula, { t0: { entityId: 'ent-player' } }, entities)
    expect(result).toMatchObject({
      expr: '(entity.ent-player.attr.attack-entity.ent-boss.attr.defense)',
      pick: { mode: 'formula', formulaId: 'formula-dmg', holeBindings: { t0: { entityId: 'ent-player' } } },
    })
  })

  it('compileFormula 未填满留空位时按当前不完整条款编译（缺失项被滤掉）', () => {
    const result = compileFormula(damageFormula, {}, entities)
    expect(result).toMatchObject({ expr: '-entity.ent-boss.attr.defense' })
  })

  it('recompileFormulaUsages 深度遍历命中已应用处并按公式最新定义重编译', () => {
    const applied = compileFormula(damageFormula, { t0: { entityId: 'ent-player' } }, entities)
    const tree = {
      graph: { nodes: [{ id: 'n1', data: { effects: [{ kind: 'addAttr', value: applied }] } }], edges: [] },
      meta: { formulas: { 'formula-dmg': damageFormula }, entities },
    }
    // 公式改成加法（原本是减法）
    const editedFormula: Formula = { ...damageFormula, terms: [damageFormula.terms[0]!, { ...damageFormula.terms[1]!, op: '+' }] }
    const next = recompileFormulaUsages(tree, { 'formula-dmg': editedFormula }, entities)
    const nextValue = (next.graph.nodes[0]!.data.effects[0] as { value: unknown }).value
    expect(nextValue).toMatchObject({ expr: '(entity.ent-player.attr.attack+entity.ent-boss.attr.defense)' })
  })

  it('recompileFormulaUsages 未变化的分支保持引用不变（避免撤销历史抖动）', () => {
    const applied = compileFormula(damageFormula, { t0: { entityId: 'ent-player' } }, entities)
    const untouchedBranch = { kind: 'other', foo: 'bar' }
    const tree = {
      graph: { nodes: [{ id: 'n1', data: { effects: [{ kind: 'addAttr', value: applied }] } }], edges: [] },
      meta: { formulas: { 'formula-dmg': damageFormula }, entities },
      untouched: untouchedBranch,
    }
    const next = recompileFormulaUsages(tree, { 'formula-dmg': damageFormula }, entities)
    expect(next.untouched).toBe(untouchedBranch) // 同一份公式定义重编译 → expr 不变 → 引用应保持不变
  })

  it('recompileFormulaUsages 公式被删除时原样保留旧 expr（不报错、不清空）', () => {
    const applied = compileFormula(damageFormula, { t0: { entityId: 'ent-player' } }, entities)
    const tree = { value: applied }
    const next = recompileFormulaUsages(tree, {}, entities)
    expect(next.value).toEqual(applied)
  })
})
