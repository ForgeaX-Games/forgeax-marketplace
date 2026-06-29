import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useScenarioStore } from '../scenarioStore'
import { getDemoScenario } from '../demoScenario'

/**
 * scenarioStore + zundo · history 行为契约
 *
 * 关键不变量：
 *   1. partialize 只追踪 `scenario` —— UI 类 state（mode/selectedSceneId/selection）
 *      变化**不入** history（不然每次切关卡都会污染 undo 栈）
 *   2. 初始无任何编辑动作时 pastStates 为空
 *   3. 编辑一次 scenario → past +1
 *   4. undo() 回滚 scenario，但 selectedSceneId 不会被复原
 *   5. redo() 重新应用刚才被 undo 的状态
 *   6. limit 上限不被突破
 *
 * 因为 store 是 module-singleton，每个测试前 setState({...demo}) + temporal.clear()。
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

describe('scenarioStore · zundo undo/redo', () => {
  beforeEach(reset)
  afterEach(reset)

  it('初始 pastStates / futureStates 为空', () => {
    const t = useScenarioStore.temporal.getState()
    expect(t.pastStates.length).toBe(0)
    expect(t.futureStates.length).toBe(0)
  })

  it('selectScene（仅 UI state）不进 history', () => {
    useScenarioStore.getState().selectScene('intro')
    expect(useScenarioStore.temporal.getState().pastStates.length).toBe(0)
  })

  it('updateScene 进 history（past += 1）', () => {
    useScenarioStore
      .getState()
      .updateScene('intro', { title: '改名后的序章' })
    expect(useScenarioStore.temporal.getState().pastStates.length).toBe(1)
  })

  it('undo() 回滚 scenario', () => {
    const original = useScenarioStore.getState().scenario.scenes['intro']?.title
    useScenarioStore.getState().updateScene('intro', { title: 'NEW' })
    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).toBe(
      'NEW',
    )

    useScenarioStore.temporal.getState().undo()
    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).toBe(
      original,
    )
  })

  it('redo() 重新应用回滚掉的状态', () => {
    useScenarioStore.getState().updateScene('intro', { title: 'NEW' })
    useScenarioStore.temporal.getState().undo()
    useScenarioStore.temporal.getState().redo()
    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).toBe(
      'NEW',
    )
  })

  it('undo 不复原 UI state（selectedSceneId 保持当前值）', () => {
    useScenarioStore.getState().updateScene('intro', { title: 'NEW' })
    // 编辑后切到另一个场景；这步不该被 undo 撤销
    useScenarioStore.getState().selectScene('pry')
    useScenarioStore.temporal.getState().undo()
    // 选中仍然是 pry（partialize 把 selectedSceneId 排除了）
    expect(useScenarioStore.getState().selectedSceneId).toBe('pry')
    // 但 scenario 已回滚
    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).not.toBe(
      'NEW',
    )
  })

  it('多次编辑后能逐步 undo', () => {
    useScenarioStore.getState().updateScene('intro', { title: 'A' })
    useScenarioStore.getState().updateScene('intro', { title: 'B' })
    useScenarioStore.getState().updateScene('intro', { title: 'C' })

    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).toBe('C')
    useScenarioStore.temporal.getState().undo()
    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).toBe('B')
    useScenarioStore.temporal.getState().undo()
    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).toBe('A')
  })

  it('栈深度受 limit 约束（≤ 50）', () => {
    for (let i = 0; i < 80; i++) {
      useScenarioStore.getState().updateScene('intro', { title: `T${i}` })
    }
    expect(
      useScenarioStore.temporal.getState().pastStates.length,
    ).toBeLessThanOrEqual(50)
  })

  it('pause / resume 期间的编辑不入栈（拖拽用）', () => {
    const t = useScenarioStore.temporal.getState()
    t.pause()
    useScenarioStore.getState().updateScene('intro', { title: 'midDrag1' })
    useScenarioStore.getState().updateScene('intro', { title: 'midDrag2' })
    t.resume()
    expect(useScenarioStore.temporal.getState().pastStates.length).toBe(0)

    // resume 后再编辑应正常入栈
    useScenarioStore.getState().updateScene('intro', { title: 'committed' })
    expect(useScenarioStore.temporal.getState().pastStates.length).toBe(1)
  })

  it('clear() 清空所有历史', () => {
    useScenarioStore.getState().updateScene('intro', { title: 'X' })
    expect(useScenarioStore.temporal.getState().pastStates.length).toBe(1)
    useScenarioStore.temporal.getState().clear()
    expect(useScenarioStore.temporal.getState().pastStates.length).toBe(0)
    expect(useScenarioStore.temporal.getState().futureStates.length).toBe(0)
  })
})
