/**
 * 跨 pane 蓝图意图同步：mock BroadcastChannel，验证广播与 apply 不回环。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraphScenario } from '../graphScenarioStore'
import {
  broadcastBlueprintIntent,
  installGraphBlueprintSync,
  resetGraphBlueprintSyncForTests,
  type BlueprintSyncMsg,
} from '../graphBlueprintSync'
import { NODIA_DEMO_PROJECT } from '../../demo/demo'
import { emptyBlueprintDoc } from '../blueprint-project'

type Handler = (e: MessageEvent) => void

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = []
  name: string
  onmessage: Handler | null = null
  constructor(name: string) {
    this.name = name
    MockBroadcastChannel.instances.push(this)
  }
  postMessage(data: unknown): void {
    for (const peer of MockBroadcastChannel.instances) {
      if (peer === this) continue
      peer.onmessage?.({ data } as MessageEvent)
    }
  }
  close(): void {
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter((c) => c !== this)
  }
}

const OriginalBroadcastChannel = globalThis.BroadcastChannel

beforeEach(() => {
  MockBroadcastChannel.instances = []
  globalThis.BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel
  resetGraphBlueprintSyncForTests()
  const p = structuredClone(NODIA_DEMO_PROJECT)
  const mainId = p.manifest.mainPackId
  useGraphScenario.setState({
    blueprints: p.manifest.packs,
    mainBlueprintId: mainId,
    activeBlueprintId: mainId,
    graph: p.manifest.packs[mainId]!.graph,
    meta: { variables: p.variables, entities: p.entities, ui: p.ui },
    booted: true,
  } as never)
})

afterEach(() => {
  resetGraphBlueprintSyncForTests()
  globalThis.BroadcastChannel = OriginalBroadcastChannel
})

describe('graphBlueprintSync', () => {
  it('broadcasts select/created/renamed/deleted/mainSet when channel installed', () => {
    const dispose = installGraphBlueprintSync()
    const posts: BlueprintSyncMsg[] = []
    const spy = vi.spyOn(MockBroadcastChannel.instances[0]!, 'postMessage').mockImplementation((data) => {
      posts.push(data as BlueprintSyncMsg)
    })

    const created = useGraphScenario.getState().createBlueprint('SyncSub')
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const id = created.id!
    expect(posts.some((m) => m.type === 'created' && m.doc.id === id)).toBe(true)

    useGraphScenario.getState().renameBlueprint(id, 'RenamedSub')
    expect(posts.some((m) => m.type === 'renamed' && m.id === id && m.title === 'RenamedSub')).toBe(true)

    useGraphScenario.getState().setMainBlueprint(id)
    expect(posts.some((m) => m.type === 'mainSet' && m.id === id)).toBe(true)

    // 设回原主包再删子蓝图
    const originalMain = NODIA_DEMO_PROJECT.manifest.mainPackId
    useGraphScenario.getState().setMainBlueprint(originalMain)
    useGraphScenario.getState().selectBlueprint(originalMain)
    posts.length = 0
    useGraphScenario.getState().deleteBlueprint(id)
    expect(posts.some((m) => m.type === 'deleted' && m.id === id)).toBe(true)

    posts.length = 0
    const other = useGraphScenario.getState().createBlueprint('Other')
    expect(other.ok).toBe(true)
    posts.length = 0
    useGraphScenario.getState().selectBlueprint(originalMain)
    expect(posts).toEqual([{ type: 'select', id: originalMain }])

    spy.mockRestore()
    dispose()
  })

  it('does not echo when applying remote (no loop)', () => {
    const dispose = installGraphBlueprintSync()
    const local = MockBroadcastChannel.instances[0]!
    const posts: unknown[] = []
    const origPost = local.postMessage.bind(local)
    local.postMessage = (data: unknown) => {
      posts.push(data)
      origPost(data)
    }

    const doc = emptyBlueprintDoc({ id: 'remote-bp', title: 'FromA' })
    // 对端频道推送 created；本端 apply 后不应再 postMessage
    const foreign = new MockBroadcastChannel('foreign')
    foreign.postMessage({ type: 'created', doc } satisfies BlueprintSyncMsg)

    expect(useGraphScenario.getState().blueprints['remote-bp']?.title).toBe('FromA')
    expect(useGraphScenario.getState().activeBlueprintId).toBe('remote-bp')
    expect(posts).toEqual([])

    posts.length = 0
    foreign.postMessage({ type: 'select', id: NODIA_DEMO_PROJECT.manifest.mainPackId } satisfies BlueprintSyncMsg)
    expect(useGraphScenario.getState().activeBlueprintId).toBe(NODIA_DEMO_PROJECT.manifest.mainPackId)
    expect(posts).toEqual([])

    dispose()
  })

  it('broadcastBlueprintIntent is no-op without install', () => {
    expect(() => broadcastBlueprintIntent({ type: 'select', id: 'x' })).not.toThrow()
  })
})
