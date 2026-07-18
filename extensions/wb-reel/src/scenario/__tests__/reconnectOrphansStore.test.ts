import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useScenarioStore } from '../scenarioStore'
import type { Scenario } from '../types'

/**
 * scenarioStore.reconnectOrphans —— 把纯函数 applyReconnectPlan 接成
 * 一次性 action，便于剧情树画布 UI 调用。
 *
 * 这里只校验 store 接线层：纯函数细节（跳过规则 / 幂等）已在
 * reconnectOrphans.test.ts 覆盖。
 */

function makeScenario(): Scenario {
  return {
    id: 'test',
    title: 'test',
    rootSceneId: 'a',
    defaultCharMs: 32,
    schemaVersion: 3,
    characters: {},
    locations: {},
    scenes: {
      a: {
        id: 'a',
        title: 'a',
        media: { kind: 'PLACEHOLDER' },
        durationMs: 1000,
        dialogue: [],
        branches: [{ id: 'a-0', kind: 'auto', targetSceneId: 'b' }],
        pos: { x: 0, y: 0 },
      },
      b: {
        id: 'b',
        title: 'b',
        media: { kind: 'PLACEHOLDER' },
        durationMs: 1000,
        dialogue: [],
        branches: [],
        pos: { x: 200, y: 0 },
      },
      c: {
        id: 'c',
        title: 'c',
        media: { kind: 'PLACEHOLDER' },
        durationMs: 1000,
        dialogue: [],
        branches: [],
        pos: { x: 400, y: 0 },
      },
    },
  } as Scenario
}

function reset(): void {
  useScenarioStore.setState({
    scenario: makeScenario(),
    selectedSceneId: 'a',
    selection: { kind: 'scene', sceneId: 'a' },
    mode: 'editor',
  })
  useScenarioStore.temporal.getState().clear()
}

describe('scenarioStore · reconnectOrphans', () => {
  beforeEach(reset)
  afterEach(reset)

  it('把 plan 转成 auto 边补到对应 scene.branches 末尾', () => {
    const api = useScenarioStore.getState()
    api.reconnectOrphans({
      entries: [
        { sceneId: 'b', targetSceneId: 'c' },
        { sceneId: 'c', targetSceneId: null },
      ],
    })
    const after = useScenarioStore.getState().scenario
    expect(after.scenes.b!.branches).toHaveLength(1)
    expect(after.scenes.b!.branches[0]!.kind).toBe('auto')
    expect(after.scenes.b!.branches[0]!.targetSceneId).toBe('c')
    // c 的 target=null 不连
    expect(after.scenes.c!.branches).toHaveLength(0)
    // 没动过的保持原样
    expect(after.scenes.a!.branches).toHaveLength(1)
  })

  it('plan 全空 → scenario 引用不变（避免订阅抖动）', () => {
    const before = useScenarioStore.getState().scenario
    useScenarioStore.getState().reconnectOrphans({ entries: [] })
    const after = useScenarioStore.getState().scenario
    expect(after).toBe(before)
  })
})
