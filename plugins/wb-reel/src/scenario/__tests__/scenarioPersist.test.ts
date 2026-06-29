import { describe, expect, it } from 'vitest'
import {
  deserialize,
  emptyDb,
  mergeDbs,
  pickActive,
  pickRecent,
  removeFromDb,
  serialize,
  setActive,
  upsertScenario,
} from '../scenarioPersist'
import type { Scenario } from '../types'

/**
 * 持久化纯函数契约 ——
 *
 * 这层是 localStorage 的"语义层"：上面 store 不直接操心 JSON 字符串，
 * 下面 UI 不直接操心去重 / max 上限 / 时间戳。
 *
 * 真实 bug 现场：用户辛苦贴完 5K 字剧本、锻造 + 批量生图，
 * 结果浏览器刷新一下整个剧情树和图全没了。
 *
 * 这套测试的目的是钉死：
 *   - upsert 按 scenario.id 去重（编辑现有不会变成新建）
 *   - 上限超出按 updatedAt 升序剔除最老（不丢最近编辑的）
 *   - active 跟踪能跨刷新保留
 *   - serialize/deserialize 双向稳定 —— 有损的话刷新就崩
 */

function makeScenario(over: Partial<Scenario>): Scenario {
  return {
    id: 'scn-1',
    title: '测试剧本',
    rootSceneId: 'a',
    schemaVersion: 1,
    scenes: { a: { id: 'a', title: '幕一', durationMs: 5000, media: { kind: 'IMAGE_PROMPT', prompt: '' }, dialogue: [], branches: [], characterIds: [] } },
    ...over,
  } as Scenario
}

describe('scenarioPersist', () => {
  describe('emptyDb', () => {
    it('返回 v1 空库', () => {
      const db = emptyDb()
      expect(db.version).toBe(1)
      expect(db.activeId).toBeNull()
      expect(db.items).toEqual([])
    })
  })

  describe('upsertScenario', () => {
    it('首次插入：items 长度 1，activeId 自动指向它', () => {
      const db = upsertScenario(emptyDb(), makeScenario({ id: 'scn-A' }))
      expect(db.items).toHaveLength(1)
      expect(db.items[0]?.id).toBe('scn-A')
      expect(db.activeId).toBe('scn-A')
    })

    it('同 id 二次写入 → 不新建，覆盖原条目（updatedAt 更新、createdAt 保留）', () => {
      let db = upsertScenario(
        emptyDb(),
        makeScenario({ id: 'scn-A', title: '原标题' }),
      )
      const createdAt = db.items[0]!.createdAt
      // 等几毫秒再写
      const later = createdAt + 100
      db = upsertScenario(
        db,
        makeScenario({ id: 'scn-A', title: '新标题' }),
        { now: later },
      )
      expect(db.items).toHaveLength(1)
      expect(db.items[0]?.title).toBe('新标题')
      expect(db.items[0]?.createdAt).toBe(createdAt)
      expect(db.items[0]?.updatedAt).toBe(later)
    })

    it('不同 id → 新建并按 updatedAt 排序最新在前', () => {
      let db = emptyDb()
      db = upsertScenario(db, makeScenario({ id: 'scn-A' }), { now: 100 })
      db = upsertScenario(db, makeScenario({ id: 'scn-B' }), { now: 200 })
      db = upsertScenario(db, makeScenario({ id: 'scn-C' }), { now: 300 })
      expect(db.items.map((i) => i.id)).toEqual(['scn-C', 'scn-B', 'scn-A'])
      expect(db.activeId).toBe('scn-C')
    })

    it('上限 max=3：第 4 个进来 → 最老的被剔除', () => {
      let db = emptyDb()
      const max = 3
      db = upsertScenario(db, makeScenario({ id: 'a' }), { now: 1, max })
      db = upsertScenario(db, makeScenario({ id: 'b' }), { now: 2, max })
      db = upsertScenario(db, makeScenario({ id: 'c' }), { now: 3, max })
      db = upsertScenario(db, makeScenario({ id: 'd' }), { now: 4, max })
      expect(db.items).toHaveLength(3)
      expect(db.items.map((i) => i.id)).toEqual(['d', 'c', 'b'])
      // 'a' 应已被剔除
      expect(db.items.find((i) => i.id === 'a')).toBeUndefined()
    })

    it('上限剔除时不会动 activeId（除非 active 自身被剔除，那就回退到最新）', () => {
      let db = emptyDb()
      db = upsertScenario(db, makeScenario({ id: 'a' }), { now: 1, max: 2 })
      db = upsertScenario(db, makeScenario({ id: 'b' }), { now: 2, max: 2 })
      db = setActive(db, 'a')
      // active='a'，再加 'c' → 触发 max=2 剔除最老（'a'，因为它 updatedAt=1 最老）
      db = upsertScenario(db, makeScenario({ id: 'c' }), { now: 3, max: 2 })
      expect(db.items.find((i) => i.id === 'a')).toBeUndefined()
      // a 没了，active 应回退到当前最新 'c'
      expect(db.activeId).toBe('c')
    })
  })

  describe('pickActive / pickRecent', () => {
    it('pickActive：按 activeId 取条目；不存在返 null', () => {
      const empty = emptyDb()
      expect(pickActive(empty)).toBeNull()
      const db = upsertScenario(empty, makeScenario({ id: 'x' }))
      expect(pickActive(db)?.id).toBe('x')
    })

    it('pickRecent：按 updatedAt desc 返回前 N 条', () => {
      let db = emptyDb()
      db = upsertScenario(db, makeScenario({ id: 'a' }), { now: 1 })
      db = upsertScenario(db, makeScenario({ id: 'b' }), { now: 2 })
      db = upsertScenario(db, makeScenario({ id: 'c' }), { now: 3 })
      expect(pickRecent(db, 2).map((i) => i.id)).toEqual(['c', 'b'])
    })
  })

  describe('removeFromDb', () => {
    it('删除存在的 id：列表少一项；删 active 时 active 切到剩下最新', () => {
      let db = emptyDb()
      db = upsertScenario(db, makeScenario({ id: 'a' }), { now: 1 })
      db = upsertScenario(db, makeScenario({ id: 'b' }), { now: 2 })
      db = setActive(db, 'b')
      db = removeFromDb(db, 'b')
      expect(db.items).toHaveLength(1)
      expect(db.items[0]?.id).toBe('a')
      expect(db.activeId).toBe('a')
    })

    it('删最后一个：activeId 回 null', () => {
      let db = upsertScenario(emptyDb(), makeScenario({ id: 'only' }))
      db = removeFromDb(db, 'only')
      expect(db.items).toEqual([])
      expect(db.activeId).toBeNull()
    })

    it('删不存在的 id 是 no-op', () => {
      const db = upsertScenario(emptyDb(), makeScenario({ id: 'a' }))
      const after = removeFromDb(db, 'nope')
      expect(after).toEqual(db)
    })
  })

  describe('serialize / deserialize', () => {
    it('round-trip 稳定：序列化再反序列化 = 原 db', () => {
      let db = emptyDb()
      db = upsertScenario(db, makeScenario({ id: 'a', title: '甲' }), { now: 1 })
      db = upsertScenario(db, makeScenario({ id: 'b', title: '乙' }), { now: 2 })
      const round = deserialize(serialize(db))
      expect(round).toEqual(db)
    })

    it('deserialize null / 空字符串 → emptyDb', () => {
      expect(deserialize(null)).toEqual(emptyDb())
      expect(deserialize('')).toEqual(emptyDb())
    })

    it('deserialize 损坏 JSON → emptyDb（不抛错，作者打开页面不能崩）', () => {
      expect(deserialize('this is not json')).toEqual(emptyDb())
    })

    it('deserialize 未知 version → emptyDb（保留升级容错）', () => {
      const future = JSON.stringify({ version: 999, items: [], activeId: null })
      expect(deserialize(future)).toEqual(emptyDb())
    })
  })

  describe('mergeDbs', () => {
    it('同 id 取 updatedAt 更大者 —— primary 更新', () => {
      const pri = upsertScenario(emptyDb(), makeScenario({ id: 'a', title: 'new' }), { now: 100 })
      const sec = upsertScenario(emptyDb(), makeScenario({ id: 'a', title: 'old' }), { now: 50 })
      const merged = mergeDbs(pri, sec)
      expect(merged.items).toHaveLength(1)
      expect(merged.items[0]!.title).toBe('new')
      expect(merged.items[0]!.updatedAt).toBe(100)
    })

    it('同 id 取 updatedAt 更大者 —— secondary 更新', () => {
      const pri = upsertScenario(emptyDb(), makeScenario({ id: 'a', title: 'old' }), { now: 50 })
      const sec = upsertScenario(emptyDb(), makeScenario({ id: 'a', title: 'new' }), { now: 100 })
      const merged = mergeDbs(pri, sec)
      expect(merged.items[0]!.title).toBe('new')
      expect(merged.items[0]!.updatedAt).toBe(100)
    })

    it('双方 id 不重叠 → 取并集，按 updatedAt 降序', () => {
      let pri = upsertScenario(emptyDb(), makeScenario({ id: 'a' }), { now: 100 })
      pri = upsertScenario(pri, makeScenario({ id: 'b' }), { now: 300 })
      const sec = upsertScenario(emptyDb(), makeScenario({ id: 'c' }), { now: 200 })
      const merged = mergeDbs(pri, sec)
      expect(merged.items.map((it) => it.id)).toEqual(['b', 'c', 'a'])
    })

    it('primary.activeId 存在于合并结果 → 保留', () => {
      let pri = upsertScenario(emptyDb(), makeScenario({ id: 'a' }), { now: 100 })
      pri = upsertScenario(pri, makeScenario({ id: 'b' }), { now: 200 })
      const sec = upsertScenario(emptyDb(), makeScenario({ id: 'c' }), { now: 50 })
      const withActive = setActive(pri, 'a')
      const merged = mergeDbs(withActive, sec)
      expect(merged.activeId).toBe('a')
    })

    it('primary.activeId 在结果里不存在 → 回落 secondary.activeId', () => {
      const pri = { ...emptyDb(), activeId: 'ghost' }
      const sec = setActive(
        upsertScenario(emptyDb(), makeScenario({ id: 'a' }), { now: 100 }),
        'a',
      )
      const merged = mergeDbs(pri, sec)
      expect(merged.activeId).toBe('a')
    })

    it('两边都没 active → items[0].id（最新那条）', () => {
      const pri = upsertScenario(emptyDb(), makeScenario({ id: 'a' }), { now: 100 })
      const sec = upsertScenario(emptyDb(), makeScenario({ id: 'b' }), { now: 200 })
      const merged = mergeDbs({ ...pri, activeId: null }, { ...sec, activeId: null })
      // 合并后按 updatedAt 降序：b 在前
      expect(merged.activeId).toBe('b')
    })

    it('超过 max → 按 updatedAt 降序保留前 max 条', () => {
      let pri = emptyDb()
      for (let i = 0; i < 3; i++) {
        pri = upsertScenario(pri, makeScenario({ id: `p-${i}` }), { now: 100 + i })
      }
      let sec = emptyDb()
      for (let i = 0; i < 3; i++) {
        sec = upsertScenario(sec, makeScenario({ id: `s-${i}` }), { now: 200 + i })
      }
      const merged = mergeDbs(pri, sec, { max: 4 })
      expect(merged.items).toHaveLength(4)
      // 4 条应都是 updatedAt 最大的：s-2(202), s-1(201), s-0(200), p-2(102)
      expect(merged.items.map((it) => it.id)).toEqual(['s-2', 's-1', 's-0', 'p-2'])
    })

    it('空 db 合并 → 仍返回空', () => {
      const merged = mergeDbs(emptyDb(), emptyDb())
      expect(merged).toEqual(emptyDb())
    })
  })
})
