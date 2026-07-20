import { describe, it, expect } from 'vitest'
import {
  applyItemEffects,
  evaluateClause,
  evaluateGate,
  type ItemState,
} from '../conditionEval'
import type { EntryGate } from '../../scenario/types'

const ctxBase = {
  vars: {},
  visitedSceneIds: new Set<string>(),
}

describe('applyItemEffects', () => {
  it('give 累加数量', () => {
    const out = applyItemEffects([{ itemId: 'key', op: 'give', count: 2 }], {})
    expect(out.key).toBe(2)
  })

  it('give 默认 count=1', () => {
    const out = applyItemEffects([{ itemId: 'key', op: 'give' }], { key: 1 })
    expect(out.key).toBe(2)
  })

  it('take 不会减到负数', () => {
    const out = applyItemEffects([{ itemId: 'key', op: 'take', count: 5 }], { key: 2 })
    expect(out.key).toBe(0)
  })

  it('空 effects 原样返回（引用相等）', () => {
    const owned: ItemState = { key: 1 }
    expect(applyItemEffects(undefined, owned)).toBe(owned)
    expect(applyItemEffects([], owned)).toBe(owned)
  })

  it('不修改原对象', () => {
    const owned: ItemState = { key: 1 }
    applyItemEffects([{ itemId: 'key', op: 'give', count: 1 }], owned)
    expect(owned.key).toBe(1)
  })
})

describe('evaluateClause · hasItem', () => {
  it('持有量达标 → true', () => {
    const ok = evaluateClause(
      { type: 'hasItem', itemId: 'key', count: 1 },
      { ...ctxBase, ownedItems: { key: 1 } },
    )
    expect(ok).toBe(true)
  })

  it('持有量不足 → false', () => {
    const ok = evaluateClause(
      { type: 'hasItem', itemId: 'key', count: 2 },
      { ...ctxBase, ownedItems: { key: 1 } },
    )
    expect(ok).toBe(false)
  })

  it('未持有（空背包）→ false', () => {
    const ok = evaluateClause(
      { type: 'hasItem', itemId: 'key', count: 1 },
      { ...ctxBase },
    )
    expect(ok).toBe(false)
  })

  it('count 缺省视为 1', () => {
    const ok = evaluateClause(
      { type: 'hasItem', itemId: 'key' },
      { ...ctxBase, ownedItems: { key: 1 } },
    )
    expect(ok).toBe(true)
  })
})

describe('evaluateGate · 物品门槛', () => {
  const gate: EntryGate = {
    condition: { all: [{ type: 'hasItem', itemId: 'key', count: 1 }] },
    onFail: 'redirect',
    redirectSceneId: 'locked-room',
    hint: '需要钥匙',
  }

  it('满足 → allowed', () => {
    const r = evaluateGate(gate, { ...ctxBase, ownedItems: { key: 1 } })
    expect(r.allowed).toBe(true)
  })

  it('不满足 + redirect → 给出改道目标与提示', () => {
    const r = evaluateGate(gate, { ...ctxBase, ownedItems: {} })
    expect(r.allowed).toBe(false)
    expect(r.redirectSceneId).toBe('locked-room')
    expect(r.hint).toBe('需要钥匙')
  })

  it('不满足 + block → 仅阻断不改道', () => {
    const blockGate: EntryGate = { ...gate, onFail: 'block', redirectSceneId: undefined }
    const r = evaluateGate(blockGate, { ...ctxBase, ownedItems: {} })
    expect(r.allowed).toBe(false)
    expect(r.redirectSceneId).toBeUndefined()
  })
})
