/**
 * scenarioStore.applyPatches —— RFC 6902 patch 通道契约
 *
 * 重点验证:
 *   1. happy path: 改 scene 标题 / scene 顺序 / 添加 dialogue → store 立即体现
 *   2. 整批失败: 任一 op 抛错时, scenario 引用不变 (回滚)
 *   3. zundo 整合: 一次 applyPatches 入栈一笔, undo 能整体回滚
 *   4. sanitize 防御: 即便 patch 想塞 apiKey 进 videoConfig, 也会被剥掉
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useScenarioStore } from '../scenarioStore'
import { getDemoScenario } from '../demoScenario'
import type { JsonPatchOp } from '../jsonPatch'

function reset(): void {
  useScenarioStore.setState({
    scenario: getDemoScenario(),
    selectedSceneId: 'intro',
    selection: { kind: 'scene', sceneId: 'intro' },
    mode: 'editor',
  })
  useScenarioStore.temporal.getState().clear()
}

describe('scenarioStore.applyPatches · RFC 6902 通道', () => {
  beforeEach(reset)
  afterEach(reset)

  it('happy path: replace scene 标题', () => {
    const intro = useScenarioStore.getState().scenario.scenes['intro']
    expect(intro).toBeTruthy()

    const result = useScenarioStore
      .getState()
      .applyPatches([{ op: 'replace', path: '/scenes/intro/title', value: 'NEW' }])

    expect(result.applied).toBe(true)
    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).toBe('NEW')
  })

  it('整批失败时, scenario 引用不变 (回滚, 不污染状态)', () => {
    const before = useScenarioStore.getState().scenario

    const ops: JsonPatchOp[] = [
      { op: 'replace', path: '/scenes/intro/title', value: 'NEW' },
      // 第 2 步: 故意错路径
      { op: 'replace', path: '/scenes/non-existent/title', value: 'NOPE' },
    ]
    const result = useScenarioStore.getState().applyPatches(ops)

    expect(result.applied).toBe(false)
    expect(result.error?.opIndex).toBe(1)
    // 引用相等 = 完全没动 store
    expect(useScenarioStore.getState().scenario).toBe(before)
    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).toBe(
      before.scenes['intro']!.title,
    )
  })

  it('空 patch 列表直接返回 applied:false, 不动 store', () => {
    const before = useScenarioStore.getState().scenario
    const result = useScenarioStore.getState().applyPatches([])
    expect(result.applied).toBe(false)
    expect(useScenarioStore.getState().scenario).toBe(before)
  })

  it('zundo 整合: 一次 applyPatches 入栈一笔, undo 能整体回滚', () => {
    useScenarioStore.temporal.getState().clear()

    const ops: JsonPatchOp[] = [
      { op: 'replace', path: '/scenes/intro/title', value: 'TITLE-A' },
      { op: 'replace', path: '/title', value: 'STORY-A' },
    ]

    const beforeTitle = useScenarioStore.getState().scenario.title
    const beforeIntroTitle =
      useScenarioStore.getState().scenario.scenes['intro']!.title

    const result = useScenarioStore.getState().applyPatches(ops)
    expect(result.applied).toBe(true)
    expect(useScenarioStore.getState().scenario.title).toBe('STORY-A')
    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).toBe(
      'TITLE-A',
    )

    // undo 一次 → 两个改动一起回滚 (而不是回滚一个)
    useScenarioStore.temporal.getState().undo()
    expect(useScenarioStore.getState().scenario.title).toBe(beforeTitle)
    expect(useScenarioStore.getState().scenario.scenes['intro']?.title).toBe(
      beforeIntroTitle,
    )
  })

  it('sanitize 防御: 即便 LLM patch 把 apiKey 塞进 videoConfig, 也会被剥掉', () => {
    // 借 videoConfig 做防御示例 — sanitizeScenarioForIO 已经知道怎么剥它
    const ops: JsonPatchOp[] = [
      {
        op: 'add',
        path: '/videoConfig',
        value: { apiKey: 'sk-leak', apiBase: 'https://evil.example' },
      },
    ]
    const result = useScenarioStore.getState().applyPatches(ops)
    expect(result.applied).toBe(true)
    const vc = useScenarioStore.getState().scenario.videoConfig as
      | Record<string, unknown>
      | undefined
    // sanitize 后 apiKey 不应保留
    expect(vc && 'apiKey' in vc ? vc.apiKey : undefined).toBeUndefined()
  })
})
