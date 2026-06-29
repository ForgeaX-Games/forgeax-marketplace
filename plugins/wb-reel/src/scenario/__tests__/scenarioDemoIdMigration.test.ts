import { describe, expect, it } from 'vitest'
import { migrateBuiltinDemoIdCollision } from '../scenarioDemoIdMigration'
import { getDemoScenario } from '../demoScenario'
import type { PersistedDb, PersistedItem } from '../scenarioPersist'
import type { Scenario } from '../types'

function makeItem(scenario: Scenario, overrides?: Partial<PersistedItem>): PersistedItem {
  return {
    id: scenario.id,
    title: scenario.title,
    scenario,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function makeFakeNonDemo(id: string, title: string): Scenario {
  // 用 demo-001 占位但是内容明显不是雨夜样板 —— 模拟 v6.7 烙旧 id 留下的串台
  return {
    id,
    title,
    rootSceneId: 'scene_001',
    scenes: {
      scene_001: {
        id: 'scene_001',
        title: '01 · 卷宗封面',
        durationMs: 5000,
        media: { kind: 'IMAGE_PROMPT' as const, prompt: '' },
        dialogue: [],
        branches: [],
      },
    },
    defaultCharMs: 32,
    schemaVersion: 3 as const,
  }
}

describe('migrateBuiltinDemoIdCollision', () => {
  it('demo-001 是真雨夜样板 → 不动', () => {
    const db: PersistedDb = {
      version: 1,
      activeId: 'demo-001',
      items: [makeItem(getDemoScenario())],
    }
    const res = migrateBuiltinDemoIdCollision(db)
    expect(res.migrated).toBe(false)
    expect(res.db).toBe(db)
  })

  it('db 里没 demo-001 → 不动', () => {
    const other = makeFakeNonDemo('scn-other', 'Other')
    const db: PersistedDb = {
      version: 1,
      activeId: 'scn-other',
      items: [makeItem(other)],
    }
    const res = migrateBuiltinDemoIdCollision(db)
    expect(res.migrated).toBe(false)
  })

  it('demo-001 被新剧本占用 → 改名 + 改 activeId + 提供 asset 判定', () => {
    const fake = makeFakeNonDemo('demo-001', '第十三号卷宗')
    const db: PersistedDb = {
      version: 1,
      activeId: 'demo-001',
      items: [makeItem(fake)],
    }
    const res = migrateBuiltinDemoIdCollision(db, { now: 1700000000000 })
    expect(res.migrated).toBe(true)
    expect(res.oldId).toBe('demo-001')
    expect(res.newId).toBeTruthy()
    expect(res.newId!.startsWith('sn-migrated-')).toBe(true)

    // db.items 里那个被串台的 item 改了 id
    const renamed = res.db.items.find((it) => it.title === '第十三号卷宗')!
    expect(renamed.id).toBe(res.newId)
    expect(renamed.scenario.id).toBe(res.newId)
    // db.items 里 demo-001 槽位空了 (refreshBuiltinDemoInDb 会补回雨夜样板)
    expect(res.db.items.find((it) => it.id === 'demo-001')).toBeUndefined()
    // activeId 跟着切到新 id
    expect(res.db.activeId).toBe(res.newId)
  })

  it('shouldRelabelAsset: scenarioId=demo-001 + sceneId 在雨夜样板里 → 不改', () => {
    const fake = makeFakeNonDemo('demo-001', 'X')
    const db: PersistedDb = {
      version: 1,
      activeId: 'demo-001',
      items: [makeItem(fake)],
    }
    const res = migrateBuiltinDemoIdCollision(db, { now: 1 })
    expect(res.migrated).toBe(true)
    // 雨夜样板的 sceneId (intro/knock/...)
    const builtinSceneIds = Object.keys(getDemoScenario().scenes)
    for (const sceneId of builtinSceneIds) {
      expect(
        res.shouldRelabelAsset!({ meta: { scenarioId: 'demo-001', sceneId } }),
      ).toBe(false)
    }
  })

  it('shouldRelabelAsset: scenarioId=demo-001 + sceneId 是新剧本的 → 要改', () => {
    const fake = makeFakeNonDemo('demo-001', 'X')
    const db: PersistedDb = {
      version: 1,
      activeId: 'demo-001',
      items: [makeItem(fake)],
    }
    const res = migrateBuiltinDemoIdCollision(db, { now: 1 })
    expect(
      res.shouldRelabelAsset!({
        meta: { scenarioId: 'demo-001', sceneId: 'scene_001' },
      }),
    ).toBe(true)
  })

  it('shouldRelabelAsset: scenarioId 不是 demo-001 → 一律不改', () => {
    const fake = makeFakeNonDemo('demo-001', 'X')
    const db: PersistedDb = {
      version: 1,
      activeId: 'demo-001',
      items: [makeItem(fake)],
    }
    const res = migrateBuiltinDemoIdCollision(db, { now: 1 })
    expect(
      res.shouldRelabelAsset!({
        meta: { scenarioId: 'scn-other', sceneId: 'whatever' },
      }),
    ).toBe(false)
    expect(res.shouldRelabelAsset!({ meta: {} })).toBe(false)
    expect(res.shouldRelabelAsset!({})).toBe(false)
  })

  it('shouldRelabelAsset: 没 sceneId 的 asset (角色/道具参考) → 跟新剧本走', () => {
    const fake = makeFakeNonDemo('demo-001', 'X')
    const db: PersistedDb = {
      version: 1,
      activeId: 'demo-001',
      items: [makeItem(fake)],
    }
    const res = migrateBuiltinDemoIdCollision(db, { now: 1 })
    expect(
      res.shouldRelabelAsset!({ meta: { scenarioId: 'demo-001' } }),
    ).toBe(true)
  })

  it('draftScenario 是雨夜样板 → 视为未占用, 不动', () => {
    // 边界场景: scenario (已发布版) 不是雨夜, 但 draftScenario 是雨夜 (用户在样板上写了点东西又
    // 准备发布新内容). 当前判定 "draft 是样板就不迁移" —— 否则会把用户在样板上的草稿误改 id。
    // 单机版（移除 collab 后）已无 draftScenario 概念，本测试保留为 no-op 占位。
  })
})
