import { describe, expect, it } from 'vitest'
import type { Entity } from '../../../runtime/schema/graph-schema'
import type { Formula } from '../../persist/formula-authoring'
import { compileFormula, formulaHoles, formulaPreview, missingFormulaHoles, recompileFormulaUsages } from '../formulaApply'

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

// 伤害 = ❓(约定属性 attack) − ent-boss.防御
const damageFormula: Formula = {
  id: 'formula-dmg',
  name: '伤害',
  ast: {
    t: 'bin',
    id: 'b0',
    op: '-',
    a: { t: 'hole', id: 'h0', holeId: 'atk', kind: 'entityAttr', label: '攻击方', suggestAttr: 'attack' },
    b: { t: 'ref', id: 'r0', ref: { kind: 'entityAttr', entityId: 'ent-boss', attr: 'defense' } },
  },
}

describe('formulaApply', () => {
  it('formulaHoles 找出留空位并带上 kind / 约定属性名', () => {
    expect(formulaHoles(damageFormula)).toEqual([
      { holeId: 'atk', kind: 'entityAttr', label: '攻击方', suggestAttr: 'attack' },
    ])
  })

  it('missingFormulaHoles 报告尚未填全的留空位', () => {
    expect(missingFormulaHoles(damageFormula, {})).toHaveLength(1)
    // 绑定实体后，属性由 suggestAttr 兜底 → 视为填全
    expect(missingFormulaHoles(damageFormula, { atk: { kind: 'entityAttr', entityId: 'ent-player' } })).toEqual([])
  })

  it('formulaPreview 把未填空位标成 ?名字', () => {
    expect(formulaPreview(damageFormula)).toContain('?')
  })

  it('compileFormula 用 holeBindings 套回留空位，编译出具体 expr（并归一 attr）', () => {
    const result = compileFormula(damageFormula, { atk: { entityId: 'ent-player' } }, entities)
    expect(result).toMatchObject({
      expr: 'entity.ent-player.attr.attack - entity.ent-boss.attr.defense',
      pick: {
        mode: 'formula',
        formulaId: 'formula-dmg',
        holeBindings: { atk: { kind: 'entityAttr', entityId: 'ent-player', attr: 'attack' } },
      },
    })
  })

  it('compileFormula 未填满留空位 → expr 兜底为 "0"（不完整不外泄半成品）', () => {
    expect(compileFormula(damageFormula, {}, entities)).toMatchObject({ expr: '0' })
  })

  it('recompileFormulaUsages 深度遍历命中已应用处并按公式最新定义重编译', () => {
    const applied = compileFormula(damageFormula, { atk: { entityId: 'ent-player' } }, entities)
    const tree = {
      graph: { nodes: [{ id: 'n1', data: { effects: [{ kind: 'addAttr', value: applied }] } }], edges: [] },
      meta: { formulas: { 'formula-dmg': damageFormula }, entities },
    }
    // 公式定义改成加法（原本减法）
    const editedFormula: Formula = { ...damageFormula, ast: { ...damageFormula.ast, op: '+' } as Formula['ast'] }
    const next = recompileFormulaUsages(tree, { 'formula-dmg': editedFormula }, entities)
    const nextValue = (next.graph.nodes[0]!.data.effects[0] as { value: unknown }).value
    expect(nextValue).toMatchObject({ expr: 'entity.ent-player.attr.attack + entity.ent-boss.attr.defense' })
  })

  it('recompileFormulaUsages 未变化的分支保持引用不变（避免撤销历史抖动）', () => {
    const applied = compileFormula(damageFormula, { atk: { entityId: 'ent-player' } }, entities)
    const untouchedBranch = { kind: 'other', foo: 'bar' }
    const tree = {
      graph: { nodes: [{ id: 'n1', data: { effects: [{ kind: 'addAttr', value: applied }] } }], edges: [] },
      meta: { formulas: { 'formula-dmg': damageFormula }, entities },
      untouched: untouchedBranch,
    }
    const next = recompileFormulaUsages(tree, { 'formula-dmg': damageFormula }, entities)
    expect(next.untouched).toBe(untouchedBranch)
  })

  it('recompileFormulaUsages 公式被删除时原样保留旧 expr（不报错、不清空）', () => {
    const applied = compileFormula(damageFormula, { atk: { entityId: 'ent-player' } }, entities)
    const tree = { value: applied }
    const next = recompileFormulaUsages(tree, {}, entities)
    expect(next.value).toEqual(applied)
  })
})
