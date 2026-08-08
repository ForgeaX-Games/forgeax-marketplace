import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph } from '../../../runtime/schema/graph-schema'
import { useGraphScenario } from '../graphScenarioStore'
import { findUiTreeNode } from '../ui-tree'
import { useUiSelection } from '../uiSelectionStore'
import {
  installUiNavSync,
  sendUiNavCommand,
  useUiNavMirror,
} from '../uiNavSync'

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  readonly posted: unknown[] = []
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this)
  }

  postMessage(data: unknown): void {
    this.posted.push(data)
    for (const peer of FakeBroadcastChannel.instances) {
      if (peer !== this && peer.name === this.name) {
        peer.onmessage?.({ data } as MessageEvent)
      }
    }
  }

  close(): void {
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter((entry) => entry !== this)
  }
}

const initialState = useGraphScenario.getState()
const graph: GameGraph = {
  nodes: [{
    id: 'node',
    type: 'perf',
    position: { x: 0, y: 0 },
    inputs: [],
    outputs: [],
    data: { name: 'node', overlayNodes: [{ overlay: 'hud' }] },
  }],
  edges: [],
}
const main: BlueprintDoc = { id: 'main', title: '主蓝图', entry: 'node', graph }
const disposers: Array<() => void> = []

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  FakeBroadcastChannel.instances = []
  useUiSelection.getState().clearUiSelection()
  useUiNavMirror.setState({ role: 'standalone', snapshot: null })
  useGraphScenario.setState({
    booted: true,
    blueprints: { main },
    mainBlueprintId: 'main',
    activeBlueprintId: 'main',
    graph,
    meta: {
      ui: { overlays: { hud: { id: 'hud', title: '战斗 HUD', children: [] } } },
      uiTree: {
        root: [{
          kind: 'folder',
          id: 'folder',
          name: '战斗',
          children: [{ kind: 'scheme', id: 'hud-node', overlayId: 'hud' }],
        }],
      },
    },
  })
})

afterEach(() => {
  while (disposers.length) disposers.pop()?.()
  useGraphScenario.setState(initialState, true)
  useUiSelection.getState().clearUiSelection()
  vi.unstubAllGlobals()
})

function installPair(): { center: FakeBroadcastChannel; left: FakeBroadcastChannel } {
  disposers.push(installUiNavSync('center'))
  const center = FakeBroadcastChannel.instances[0]!
  disposers.push(installUiNavSync('left'))
  const left = FakeBroadcastChannel.instances[1]!
  return { center, left }
}

describe('uiNav split-pane sync', () => {
  it('answers a left request with the center summary snapshot', () => {
    installPair()

    expect(useUiNavMirror.getState().snapshot).toMatchObject({
      overlays: { hud: { id: 'hud', title: '战斗 HUD' } },
      usage: { hud: 1 },
      selectedTreeNodeId: null,
      selectedOverlayId: null,
    })
  })

  it('routes left selection to center without echoing another command', () => {
    const { left } = installPair()
    left.posted.length = 0

    expect(sendUiNavCommand({
      type: 'select',
      treeNodeId: 'hud-node',
      overlayId: 'hud',
    })).toBe(true)

    expect(useUiSelection.getState()).toMatchObject({
      selectedTreeNodeId: 'hud-node',
      selectedOverlayId: 'hud',
    })
    expect(left.posted.filter((message) =>
      (message as { type?: string }).type === 'command')).toHaveLength(1)
  })

  it('applies add and remove commands only in the center store', () => {
    installPair()

    expect(sendUiNavCommand({ type: 'add-scheme', parentId: 'folder', name: '战斗结算' })).toBe(true)
    const selection = useUiSelection.getState()
    expect(selection.selectedOverlayId).toBeTruthy()
    expect(useGraphScenario.getState().meta.ui?.overlays?.[selection.selectedOverlayId!]).toMatchObject({
      title: '战斗结算',
    })
    expect(findUiTreeNode(
      useGraphScenario.getState().meta.uiTree!,
      selection.selectedTreeNodeId!,
    )).toMatchObject({ kind: 'scheme', overlayId: selection.selectedOverlayId })

    expect(sendUiNavCommand({ type: 'remove', nodeId: selection.selectedTreeNodeId! })).toBe(true)
    expect(useGraphScenario.getState().meta.ui?.overlays?.[selection.selectedOverlayId!]).toBeUndefined()
    expect(findUiTreeNode(
      useGraphScenario.getState().meta.uiTree!,
      selection.selectedTreeNodeId!,
    )).toBeUndefined()
  })

  it('ignores malformed and role-inappropriate messages', () => {
    const { center, left } = installPair()
    const before = useGraphScenario.getState().meta
    const publishedBefore = center.posted.length

    left.postMessage({ version: 1, type: 'command', command: { type: 'remove', nodeId: 42 } })
    left.postMessage({ version: 1, type: 'snapshot', snapshot: { uiTree: null } })

    expect(useGraphScenario.getState().meta).toBe(before)
    expect(center.posted).toHaveLength(publishedBefore)
  })
})
