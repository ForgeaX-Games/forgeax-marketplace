import { describe, expect, it } from 'vitest'
import {
  refreshBuiltinDemoInDb,
  signScenarioRuntimeSurface,
} from '../scenarioPersistBoot'
import type { PersistedDb, PersistedItem } from '../scenarioPersist'
import type { Scenario } from '../types'

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 'demo-001',
    title: 'demo',
    rootSceneId: 's1',
    defaultCharMs: 32,
    schemaVersion: 3,
    scenes: {
      s1: {
        id: 's1',
        title: 'scene 1',
        media: { kind: 'IMAGE_PROMPT', prompt: '', meta: {} },
        durationMs: 10000,
        pos: { x: 0, y: 0 },
        dialogue: [],
        branches: [],
        qte: {
          window: { perfect: 100, great: 200, good: 400 },
          score: { perfect: 100, great: 50, good: 20, miss: -30 },
          cues: [
            {
              id: 'c1',
              shape: 'tap',
              x: 0.5,
              y: 0.5,
              appearAt: 1000,
              targetAt: 3000,
              label: 'tap',
            },
          ],
        },
      },
    },
    ...overrides,
  }
}

function wrap(s: Scenario, updatedAt = 1): PersistedItem {
  return { id: s.id, scenario: s, updatedAt }
}

describe('signScenarioRuntimeSurface', () => {
  it('同一份 scenario 签名稳定', () => {
    const s = makeScenario()
    expect(signScenarioRuntimeSurface(s)).toBe(signScenarioRuntimeSurface(s))
  })

  it('QTE window 变化 → 签名变化', () => {
    const a = makeScenario()
    const b = makeScenario()
    b.scenes.s1!.qte!.window = { perfect: 400, great: 800, good: 1500 }
    expect(signScenarioRuntimeSurface(a)).not.toBe(
      signScenarioRuntimeSurface(b),
    )
  })

  it('cue targetAt 变化 → 签名变化', () => {
    const a = makeScenario()
    const b = makeScenario()
    b.scenes.s1!.qte!.cues[0]!.targetAt = 7000
    expect(signScenarioRuntimeSurface(a)).not.toBe(
      signScenarioRuntimeSurface(b),
    )
  })

  it('scene durationMs 变化 → 签名变化', () => {
    const a = makeScenario()
    const b = makeScenario()
    b.scenes.s1!.durationMs = 20000
    expect(signScenarioRuntimeSurface(a)).not.toBe(
      signScenarioRuntimeSurface(b),
    )
  })
})

describe('refreshBuiltinDemoInDb', () => {
  it('db 里没有 bundled.id → 补一条 bundled (v6.8 改动: migrateBuiltinDemoIdCollision 腾空槽位后由这里恢复样板)', () => {
    const bundled = makeScenario()
    const other = makeScenario({ id: 'mine' })
    const db: PersistedDb = { version: 1, activeId: 'mine', items: [wrap(other)] }
    const next = refreshBuiltinDemoInDb(db, bundled)
    expect(next).not.toBe(db)
    expect(next.items.length).toBe(2)
    const seeded = next.items.find((it) => it.id === bundled.id)
    expect(seeded?.scenario).toBe(bundled)
    // activeId 不动 (用户当前在编辑的剧本是 'mine')
    expect(next.activeId).toBe('mine')
  })

  it('db 里的 demo-001 与 bundled 签名一致 → 不动', () => {
    const bundled = makeScenario()
    const db: PersistedDb = {
      version: 1,
      activeId: 'demo-001',
      items: [wrap(bundled, 123)],
    }
    const next = refreshBuiltinDemoInDb(db, bundled)
    expect(next).toBe(db)
  })

  it('db 里的 demo-001 比 bundled 老（QTE 更快）→ 用 bundled 覆盖', () => {
    const older = makeScenario()
    older.scenes.s1!.qte!.window = { perfect: 80, great: 160, good: 280 }
    const bundled = makeScenario() // perfect:100 great:200 good:400
    const db: PersistedDb = {
      version: 1,
      activeId: 'demo-001',
      items: [wrap(older, 1)],
    }
    const next = refreshBuiltinDemoInDb(db, bundled)
    expect(next).not.toBe(db)
    const refreshed = next.items.find((it) => it.id === 'demo-001')
    expect(refreshed?.scenario.scenes.s1?.qte?.window).toEqual({
      perfect: 100,
      great: 200,
      good: 400,
    })
    expect(refreshed?.updatedAt).toBeGreaterThan(1)
  })

  it('不会动其它 item', () => {
    const bundled = makeScenario()
    const olderDemo = makeScenario()
    olderDemo.scenes.s1!.durationMs = 5000 // demo 老版 durationMs 跟 bundled 不一样 → 会被刷新
    const mine = makeScenario({ id: 'mine' })
    mine.scenes.s1!.durationMs = 7777 // 用户自己的剧本，必须保持不变
    const db: PersistedDb = {
      version: 1,
      activeId: 'mine',
      items: [wrap(olderDemo, 1), wrap(mine, 1)],
    }
    const next = refreshBuiltinDemoInDb(db, bundled)
    // demo-001 被刷新
    const demoAfter = next.items.find((it) => it.id === 'demo-001')
    expect(demoAfter?.scenario.scenes.s1?.durationMs).toBe(
      bundled.scenes.s1!.durationMs,
    )
    // mine 一根毛不动
    const mineAfter = next.items.find((it) => it.id === 'mine')
    expect(mineAfter?.scenario.scenes.s1?.durationMs).toBe(7777)
    expect(next.activeId).toBe('mine')
  })
})
