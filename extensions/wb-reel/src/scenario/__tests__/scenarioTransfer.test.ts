import { describe, expect, it } from 'vitest'
import {
  defaultExportFilename,
  EXPORT_KIND,
  exportDbToJson,
  importDbFromJson,
} from '../scenarioTransfer'
import { emptyDb, upsertScenario } from '../scenarioPersist'
import type { Scenario } from '../types'

/**
 * scenarioTransfer · 导出/导入兜底 ——
 *
 * 这层是所有持久化失效时的最后救命通道：作者从任何浏览器导出一个 .json，
 * 带到任何地方点"导入"都能合并到当前历史。测试重点：
 *
 *   - 导出的 JSON 能自我复现（round-trip）
 *   - 导入支持两种输入：信封格式 / 裸 PersistedDb
 *   - 合并按 updatedAt 新者胜（不会用老版覆盖新版）
 *   - 恶意/损坏输入：ok=false + 明确 error，绝不抛
 */

function makeScenario(id: string, title = id): Scenario {
  return {
    id,
    title,
    rootSceneId: 's',
    schemaVersion: 1,
    scenes: {
      s: {
        id: 's',
        title: 'scn',
        durationMs: 1000,
        media: { kind: 'PLACEHOLDER' },
        dialogue: [],
        branches: [],
        characterIds: [],
      },
    },
  } as unknown as Scenario
}

describe('scenarioTransfer', () => {
  describe('exportDbToJson · 信封', () => {
    it('包含 kind / exportedAt / db 三字段', () => {
      const db = upsertScenario(emptyDb(), makeScenario('a'), { now: 100 })
      const out = JSON.parse(exportDbToJson(db, { now: 999 })) as {
        kind: string
        exportedAt: number
        db: { items: { id: string }[] }
      }
      expect(out.kind).toBe(EXPORT_KIND)
      expect(out.exportedAt).toBe(999)
      expect(out.db.items.map((it) => it.id)).toEqual(['a'])
    })
  })

  describe('importDbFromJson · 成功路径', () => {
    it('信封 + 空 current → 原样导入', () => {
      const source = upsertScenario(emptyDb(), makeScenario('imported', 'I'), { now: 500 })
      const json = exportDbToJson(source)

      const res = importDbFromJson(emptyDb(), json)
      expect(res.ok).toBe(true)
      expect(res.addedCount).toBe(1)
      expect(res.merged?.items.map((it) => it.id)).toEqual(['imported'])
    })

    it('裸 PersistedDb（无信封）也能解析', () => {
      const source = upsertScenario(emptyDb(), makeScenario('bare', 'B'), { now: 500 })
      const json = JSON.stringify(source)

      const res = importDbFromJson(emptyDb(), json)
      expect(res.ok).toBe(true)
      expect(res.merged?.items.map((it) => it.id)).toEqual(['bare'])
    })

    it('同 id 取 updatedAt 更大者 —— 导入的更新 → 覆盖当前', () => {
      const current = upsertScenario(emptyDb(), makeScenario('a', '老标题'), { now: 100 })
      const external = upsertScenario(emptyDb(), makeScenario('a', '新标题'), { now: 500 })
      const json = exportDbToJson(external)

      const res = importDbFromJson(current, json)
      expect(res.ok).toBe(true)
      expect(res.merged?.items[0]?.title).toBe('新标题')
      // 不是"新带进来"的（同 id 算更新，不是新增）
      expect(res.addedCount).toBe(0)
    })

    it('同 id 取 updatedAt 更大者 —— 当前的更新 → 保留当前', () => {
      const current = upsertScenario(emptyDb(), makeScenario('a', '当前版本'), { now: 500 })
      const external = upsertScenario(emptyDb(), makeScenario('a', '旧导出'), { now: 100 })
      const json = exportDbToJson(external)

      const res = importDbFromJson(current, json)
      expect(res.ok).toBe(true)
      expect(res.merged?.items[0]?.title).toBe('当前版本')
    })

    it('不同 id 全部合并', () => {
      let current = upsertScenario(emptyDb(), makeScenario('a'), { now: 100 })
      current = upsertScenario(current, makeScenario('b'), { now: 200 })
      const external = upsertScenario(emptyDb(), makeScenario('c'), { now: 50 })
      const json = exportDbToJson(external)

      const res = importDbFromJson(current, json)
      expect(res.ok).toBe(true)
      expect(res.addedCount).toBe(1)
      // 合并按 updatedAt desc：b(200), a(100), c(50)
      expect(res.merged?.items.map((it) => it.id)).toEqual(['b', 'a', 'c'])
    })

    it('空 items 的导入也算 ok —— 只是没新带东西', () => {
      const current = upsertScenario(emptyDb(), makeScenario('a'), { now: 100 })
      const json = exportDbToJson(emptyDb())

      const res = importDbFromJson(current, json)
      expect(res.ok).toBe(true)
      expect(res.addedCount).toBe(0)
      expect(res.merged?.items.map((it) => it.id)).toEqual(['a'])
    })
  })

  describe('importDbFromJson · 失败路径（不抛）', () => {
    it('损坏 JSON → ok=false，error 含 "JSON 解析失败"', () => {
      const res = importDbFromJson(emptyDb(), 'not json at all')
      expect(res.ok).toBe(false)
      expect(res.error).toContain('JSON 解析失败')
    })

    it('JSON 但结构不对 → ok=false + 明确 error', () => {
      const res = importDbFromJson(emptyDb(), JSON.stringify({ hello: 'world' }))
      expect(res.ok).toBe(false)
      expect(res.error).toMatch(/无法识别|PersistedDb/)
    })

    it('空字符串 → ok=false', () => {
      const res = importDbFromJson(emptyDb(), '')
      expect(res.ok).toBe(false)
    })
  })

  describe('defaultExportFilename', () => {
    it('格式正确：reel-scenarios-YYYY-MM-DD-HHmm.json', () => {
      // 2026-05-01 15:30
      const t = new Date(2026, 4, 1, 15, 30).getTime()
      const name = defaultExportFilename(t)
      expect(name).toBe('reel-scenarios-2026-05-01-1530.json')
    })
  })
})
