/**
 * 草稿脏检查：只有「当前内容 ≠ 最近成功保存/干净载入的版本」才标 isDraft。
 * 回归：保存版本后无改动不得再提示「未保存草稿」。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../persist-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../persist-client')>()
  return {
    ...actual,
    saveProject: vi.fn(async () => ({ ok: true })),
    saveDraft: vi.fn(),
    clearDraft: vi.fn(),
    loadVersionProject: vi.fn(),
    commitVersion: vi.fn(async () => ({ tag: 'v9', commitHash: 'abc', dirty: false })),
    listVersions: vi.fn(async () => []),
  }
})

import {
  resetCleanFingerprintForTests,
  useGraphScenario,
} from '../graphScenarioStore'
import {
  saveProject,
  saveDraft,
  clearDraft,
  loadVersionProject,
  commitVersion,
} from '../persist-client'
import type { BlueprintDoc } from '../../../runtime/schema/graph-schema'

const bpNode = (id: string) => ({
  id,
  type: 'perf' as const,
  position: { x: 0, y: 0 },
  inputs: [],
  outputs: [],
  data: { name: id },
})
const bpDoc = (id: string, title = id): BlueprintDoc => ({
  id,
  title,
  entry: 'e',
  graph: { nodes: [bpNode('e')], edges: [] },
})

function seedCleanStore(): void {
  useGraphScenario.setState({
    blueprints: { a: bpDoc('a') },
    mainBlueprintId: 'a',
    activeBlueprintId: 'a',
    graph: bpDoc('a').graph,
    meta: {},
    booted: true,
    game: 'game-test',
    isDraft: false,
    savedTip: '',
  } as any)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(saveProject).mockClear().mockResolvedValue({ ok: true })
  vi.mocked(saveDraft).mockClear()
  vi.mocked(clearDraft).mockClear()
  vi.mocked(loadVersionProject).mockClear()
  vi.mocked(commitVersion).mockClear().mockResolvedValue({ tag: 'v9', commitHash: 'abc', dirty: false })
  resetCleanFingerprintForTests()
  seedCleanStore()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('content-based isDraft', () => {
  it('successful save clears draft flag and keeps it clear when content unchanged', async () => {
    useGraphScenario.setState({ isDraft: true } as any)
    const errs = useGraphScenario.getState().save()
    expect(errs).toBe(0)
    await vi.mocked(saveProject).mock.results[0]!.value
    expect(useGraphScenario.getState().isDraft).toBe(false)

    // 无实质改动的 setMeta（返回同一引用）不得重新标脏
    useGraphScenario.getState().setMeta((m) => m)
    expect(useGraphScenario.getState().isDraft).toBe(false)
    expect(clearDraft).toHaveBeenCalled()
  })

  it('successful commit leaves isDraft false when nothing else changed', async () => {
    useGraphScenario.setState({ isDraft: true } as any)
    const tag = await useGraphScenario.getState().commit('msg')
    expect(tag).toBe('v9')
    expect(useGraphScenario.getState().isDraft).toBe(false)
    expect(useGraphScenario.getState().currentTag).toBe('v9')
  })

  it('real edit after save marks draft; reverting content clears it', async () => {
    useGraphScenario.getState().save()
    await vi.mocked(saveProject).mock.results[0]!.value
    expect(useGraphScenario.getState().isDraft).toBe(false)

    useGraphScenario.getState().renameBlueprint('a', 'renamed')
    expect(useGraphScenario.getState().isDraft).toBe(true)

    useGraphScenario.getState().renameBlueprint('a', 'a')
    expect(useGraphScenario.getState().isDraft).toBe(false)
  })

  it('loadVersion equal to clean baseline does not mark draft', async () => {
    useGraphScenario.getState().save()
    await vi.mocked(saveProject).mock.results[0]!.value
    const clean = useGraphScenario.getState().authoringProject()
    vi.mocked(loadVersionProject).mockResolvedValue(structuredClone(clean))

    await useGraphScenario.getState().loadVersion('v9')
    expect(useGraphScenario.getState().isDraft).toBe(false)
    expect(useGraphScenario.getState().savedTip).toMatch(/已载入版本 v9$/)
  })

  it('loadVersion different from clean baseline marks draft', async () => {
    useGraphScenario.getState().save()
    await vi.mocked(saveProject).mock.results[0]!.value
    const other = useGraphScenario.getState().authoringProject()
    other.manifest.packs.a = { ...other.manifest.packs.a!, title: 'old' }
    vi.mocked(loadVersionProject).mockResolvedValue(other)

    await useGraphScenario.getState().loadVersion('v1')
    expect(useGraphScenario.getState().isDraft).toBe(true)
    expect(useGraphScenario.getState().savedTip).toMatch(/未保存/)
  })

  it('noop setGraph after save does not stick isDraft true', async () => {
    useGraphScenario.getState().save()
    await vi.mocked(saveProject).mock.results[0]!.value

    const g = useGraphScenario.getState().graph
    useGraphScenario.getState().setGraph({ ...g, nodes: [...g.nodes], edges: [...g.edges] })
    expect(useGraphScenario.getState().isDraft).toBe(false)
  })
})
