import { afterEach, describe, expect, it } from 'vitest'
import type { Scenario, Scene } from '../types'
import {
  __resetTrashForTest,
  captureTrashOnChange,
  clearTrash,
  describeShrink,
  deserialize,
  emptyTrash,
  listTrash,
  loadTrash,
  pushSnapshot,
  restoreSnapshot,
  saveTrash,
  skipNextTrashCapture,
} from '../scenarioTrash'
import { useScenarioStore } from '../scenarioStore'

/**
 * 误删保护（回收站）契约 ——
 *   - 内容缩水（删除）才入库；切剧本 / 内容没变少 / skipNext 都不入库。
 *   - 环按上限裁剪、最新在前。
 *   - 恢复回滚到删除前那一份，且恢复前先给当前态留一张（可逆）。
 */

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: 'a',
    title: '幕一',
    durationMs: 5000,
    media: { kind: 'IMAGE_PROMPT', prompt: '' },
    dialogue: [],
    branches: [],
    characterIds: [],
    ...over,
  } as Scene
}

function makeScenario(over: Partial<Scenario> = {}): Scenario {
  return {
    id: 'scn-1',
    title: '测试剧本',
    rootSceneId: 'a',
    schemaVersion: 1,
    scenes: { a: scene() },
    ...over,
  } as Scenario
}

afterEach(() => {
  __resetTrashForTest()
})

describe('pushSnapshot', () => {
  it('最新在前，按上限裁剪', () => {
    let db = emptyTrash()
    for (let i = 0; i < 5; i++) {
      db = pushSnapshot(db, makeScenario({ title: `v${i}` }), {
        reason: 'r',
        now: 1000 + i,
        max: 3,
      })
    }
    expect(db.snapshots).toHaveLength(3)
    expect(db.snapshots[0]!.title).toBe('v4')
    expect(db.snapshots[2]!.title).toBe('v2')
  })

  it('记录 scenarioId / reason / score / scenario', () => {
    const db = pushSnapshot(emptyTrash(), makeScenario({ id: 'scn-X' }), {
      reason: '删除前备份 · 场景 2→1',
      now: 42,
    })
    const s = db.snapshots[0]!
    expect(s.scenarioId).toBe('scn-X')
    expect(s.reason).toBe('删除前备份 · 场景 2→1')
    expect(s.takenAt).toBe(42)
    expect(s.scenario.id).toBe('scn-X')
    expect(typeof s.score).toBe('number')
  })
})

describe('describeShrink', () => {
  it('场景减少 → 报场景', () => {
    const prev = makeScenario({ scenes: { a: scene(), b: scene({ id: 'b' }) } })
    const next = makeScenario({ scenes: { a: scene() } })
    expect(describeShrink(prev, next)).toBe('删除前备份 · 场景 2→1')
  })
  it('镜头减少 → 报镜头', () => {
    const prev = makeScenario({
      scenes: { a: scene({ shots: [{ id: 's1' }, { id: 's2' }] as never }) },
    })
    const next = makeScenario({
      scenes: { a: scene({ shots: [{ id: 's1' }] as never }) },
    })
    expect(describeShrink(prev, next)).toBe('删除前备份 · 镜头 2→1')
  })
})

describe('captureTrashOnChange', () => {
  it('内容缩水：把删除前 prev 入库', () => {
    const prev = makeScenario({ scenes: { a: scene(), b: scene({ id: 'b' }) } })
    const next = makeScenario({ scenes: { a: scene() } })
    captureTrashOnChange(prev, next)
    const list = listTrash()
    expect(list).toHaveLength(1)
    expect(list[0]!.scenario.scenes.b).toBeTruthy() // 删除前那份还留着 b
  })

  it('内容没变少（新增/平移）不入库', () => {
    const prev = makeScenario({ scenes: { a: scene() } })
    const next = makeScenario({ scenes: { a: scene(), b: scene({ id: 'b' }) } })
    captureTrashOnChange(prev, next)
    expect(listTrash()).toHaveLength(0)
  })

  it('切换剧本（id 变）不入库', () => {
    const prev = makeScenario({ id: 'scn-A', scenes: { a: scene(), b: scene({ id: 'b' }) } })
    const next = makeScenario({ id: 'scn-B', scenes: { a: scene() } })
    captureTrashOnChange(prev, next)
    expect(listTrash()).toHaveLength(0)
  })

  it('skipNextTrashCapture 跳过紧接着的一次', () => {
    const prev = makeScenario({ scenes: { a: scene(), b: scene({ id: 'b' }) } })
    const next = makeScenario({ scenes: { a: scene() } })
    skipNextTrashCapture()
    captureTrashOnChange(prev, next)
    expect(listTrash()).toHaveLength(0)
    // 跳过只生效一次：下一次正常入库
    captureTrashOnChange(prev, next)
    expect(listTrash()).toHaveLength(1)
  })
})

describe('IO', () => {
  it('saveTrash / loadTrash 往返', () => {
    const db = pushSnapshot(emptyTrash(), makeScenario(), { reason: 'r', now: 1 })
    saveTrash(db)
    expect(loadTrash().snapshots).toHaveLength(1)
  })
  it('clearTrash 清空', () => {
    saveTrash(pushSnapshot(emptyTrash(), makeScenario(), { reason: 'r' }))
    clearTrash()
    expect(loadTrash().snapshots).toHaveLength(0)
  })
  it('deserialize 容错：垃圾 → 空库', () => {
    expect(deserialize('not json').snapshots).toEqual([])
    expect(deserialize(null).snapshots).toEqual([])
    expect(deserialize(JSON.stringify({ version: 2 })).snapshots).toEqual([])
  })
})

describe('restoreSnapshot', () => {
  it('回滚到删除前那份，并给当前态留一张备份', () => {
    const full = makeScenario({
      id: 'scn-R',
      scenes: { a: scene(), b: scene({ id: 'b' }) },
    })
    // 当前态：被删得只剩一个场景
    const shrunk = makeScenario({ id: 'scn-R', scenes: { a: scene() } })
    useScenarioStore.getState().loadScenario(shrunk)

    // 回收站里放一张「删除前」的完整快照
    saveTrash(pushSnapshot(emptyTrash(), full, { reason: '删除前备份 · 场景 2→1' }))
    const snapId = loadTrash().snapshots[0]!.id

    const ok = restoreSnapshot(snapId)
    expect(ok).toBe(true)
    // store 已回到完整版（b 回来了）
    expect(useScenarioStore.getState().scenario.scenes.b).toBeTruthy()
    // 回收站里多了一张「恢复前自动备份」（当前的缩水态）
    const reasons = loadTrash().snapshots.map((s) => s.reason)
    expect(reasons).toContain('恢复前自动备份')
  })

  it('快照属于另一本剧本时拒绝恢复', () => {
    useScenarioStore.getState().loadScenario(makeScenario({ id: 'scn-CUR' }))
    saveTrash(pushSnapshot(emptyTrash(), makeScenario({ id: 'scn-OTHER' }), { reason: 'r' }))
    const id = loadTrash().snapshots[0]!.id
    expect(restoreSnapshot(id)).toBe(false)
  })
})
