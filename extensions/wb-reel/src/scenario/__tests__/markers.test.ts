import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useScenarioStore } from '../scenarioStore'
import { getDemoScenario } from '../demoScenario'

/**
 * scenarioStore · 时间轴标记点（markers）增量编辑。
 *
 * 覆盖契约（v9 markers 纳入 scenario，可被 agent reel:edit-marker 寻址）：
 *   - addMarker 追加并按 ms 升序排序，返回新 id；距已有点 ≤1ms 不重复加（返回旧 id）
 *   - removeMarker 按 id 删
 *   - renameMarker 按 id 改名
 *   - 不影响别的 scene
 */

function reset(): void {
  useScenarioStore.setState({
    scenario: getDemoScenario(),
    selectedSceneId: 'intro',
    selection: { kind: 'scene', sceneId: 'intro' },
    mode: 'editor',
  })
  useScenarioStore.temporal.getState().clear()
}

describe('scenarioStore · markers', () => {
  beforeEach(reset)
  afterEach(reset)

  it('addMarker 追加、升序排序并返回新 id', () => {
    const api = useScenarioStore.getState()
    const id2 = api.addMarker('intro', 2000, '高潮')
    const id1 = api.addMarker('intro', 500)
    const markers = useScenarioStore.getState().scenario.scenes.intro!.markers!
    expect(markers.map((m) => m.id)).toEqual([id1, id2]) // 500 在前
    expect(markers[0]!.ms).toBe(500)
    expect(markers[1]).toMatchObject({ id: id2, ms: 2000, label: '高潮' })
  })

  it('addMarker 距已有点 ≤1ms 不重复加（返回旧 id）', () => {
    const api = useScenarioStore.getState()
    const first = api.addMarker('intro', 1000)
    const dup = api.addMarker('intro', 1001) // 1ms 内
    expect(dup).toBe(first)
    expect(useScenarioStore.getState().scenario.scenes.intro!.markers).toHaveLength(1)
  })

  it('addMarker 四舍五入到非负整数 ms', () => {
    const api = useScenarioStore.getState()
    const id = api.addMarker('intro', 1234.6)
    const m = useScenarioStore.getState().scenario.scenes.intro!.markers!.find((x) => x.id === id)!
    expect(m.ms).toBe(1235)
  })

  it('renameMarker 按 id 改名', () => {
    const api = useScenarioStore.getState()
    const id = api.addMarker('intro', 800)
    api.renameMarker('intro', id, '开场')
    const m = useScenarioStore.getState().scenario.scenes.intro!.markers!.find((x) => x.id === id)!
    expect(m.label).toBe('开场')
  })

  it('removeMarker 按 id 删', () => {
    const api = useScenarioStore.getState()
    const a = api.addMarker('intro', 300)
    const b = api.addMarker('intro', 900)
    api.removeMarker('intro', a)
    const markers = useScenarioStore.getState().scenario.scenes.intro!.markers!
    expect(markers.map((m) => m.id)).toEqual([b])
  })

  it('不影响其他 scene', () => {
    const api = useScenarioStore.getState()
    const before = useScenarioStore.getState().scenario.scenes
    api.addMarker('intro', 100)
    const after = useScenarioStore.getState().scenario.scenes
    for (const id of Object.keys(after)) {
      if (id === 'intro') continue
      expect(after[id]).toBe(before[id])
    }
  })
})
