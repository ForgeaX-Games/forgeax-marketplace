/**
 * scenario 级 overlay 编辑 —— children 住在 ui.overlays，节点挂 overlayNodes[]。
 */
import type { GameScenario, OverlayChild, OverlayNode } from '../schema/graph-schema'
import { overlayMountId } from '../schema/node-config-schema'
import { patchNodeData, setOverlayNodes } from '../../graph/edit/graph-edit'

export function nodeOverlayId(nodeId: string): string {
  return `node:${nodeId}`
}

/** 节点素材编辑用的主挂载：优先 `node:<id>`，否则第一份。 */
export function primaryOverlayMount(
  node: { id: string; data: { overlayNodes?: OverlayNode[] } } | undefined,
): OverlayNode | undefined {
  const mounts = node?.data.overlayNodes ?? []
  if (!node || !mounts.length) return undefined
  return mounts.find((m) => m.overlay === nodeOverlayId(node.id)) ?? mounts[0]
}

/** 确保节点有专属 overlay（`node:<id>`）并挂在 overlayNodes 中。 */
export function ensureNodeOverlay(scenario: GameScenario, nodeId: string): GameScenario {
  const node = scenario.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scenario
  const overlayId = nodeOverlayId(nodeId)
  const overlays = { ...(scenario.ui?.overlays ?? {}) }
  if (!overlays[overlayId]) {
    overlays[overlayId] = { id: overlayId, children: [] }
  }
  let graph = scenario.graph
  const mounts = [...(node.data.overlayNodes ?? [])]
  const idx = mounts.findIndex((m) => m.overlay === overlayId)
  if (idx < 0) {
    mounts.push({ overlay: overlayId })
    graph = setOverlayNodes(graph, nodeId, mounts)
  } else if (!node.data.overlayNodes) {
    graph = setOverlayNodes(graph, nodeId, mounts)
  }
  return {
    ...scenario,
    ui: { ...scenario.ui, overlays },
    graph,
  }
}

export function addOverlayChild(scenario: GameScenario, nodeId: string, child: OverlayChild): GameScenario {
  const scn = ensureNodeOverlay(scenario, nodeId)
  const node = scn.graph.nodes.find((n) => n.id === nodeId)!
  const overlayId = primaryOverlayMount(node)?.overlay ?? nodeOverlayId(nodeId)
  const ov = scn.ui!.overlays![overlayId]!
  return {
    ...scn,
    ui: {
      ...scn.ui,
      overlays: {
        ...scn.ui!.overlays,
        [overlayId]: { ...ov, children: [...ov.children, child] },
      },
    },
  }
}

export function removeOverlayChild(scenario: GameScenario, nodeId: string, childId: string): GameScenario {
  const node = scenario.graph.nodes.find((n) => n.id === nodeId)
  const overlayId = primaryOverlayMount(node)?.overlay
  if (!overlayId || !scenario.ui?.overlays?.[overlayId]) return scenario
  const ov = scenario.ui.overlays[overlayId]!
  return {
    ...scenario,
    ui: {
      ...scenario.ui,
      overlays: {
        ...scenario.ui.overlays,
        [overlayId]: { ...ov, children: ov.children.filter((c) => c.id !== childId) },
      },
    },
  }
}

export function patchOverlayChild(
  scenario: GameScenario,
  nodeId: string,
  childId: string,
  patch: Partial<OverlayChild>,
): GameScenario {
  const node = scenario.graph.nodes.find((n) => n.id === nodeId)
  const overlayId = primaryOverlayMount(node)?.overlay
  if (!overlayId || !scenario.ui?.overlays?.[overlayId]) return scenario
  const ov = scenario.ui.overlays[overlayId]!
  return {
    ...scenario,
    ui: {
      ...scenario.ui,
      overlays: {
        ...scenario.ui.overlays,
        [overlayId]: {
          ...ov,
          children: ov.children.map((c) =>
            c.id === childId
              ? {
                  ...c,
                  ...patch,
                  params: patch.params ? { ...c.params, ...patch.params } : c.params,
                  layout: patch.layout ? { ...c.layout, ...patch.layout } : c.layout,
                }
              : c,
          ),
        },
      },
    },
  }
}

export function patchOverlayChildParams(
  scenario: GameScenario,
  nodeId: string,
  childId: string,
  params: Record<string, unknown>,
): GameScenario {
  const node = scenario.graph.nodes.find((n) => n.id === nodeId)
  const overlayId = primaryOverlayMount(node)?.overlay
  if (!overlayId || !scenario.ui?.overlays?.[overlayId]) return scenario
  const ov = scenario.ui.overlays[overlayId]!
  const child = ov.children.find((c) => c.id === childId)
  if (!child) return scenario
  return patchOverlayChild(scenario, nodeId, childId, { params: { ...child.params, ...params } })
}

/** 仅改图上的节点 data（不碰 overlays）。 */
export function patchScenarioNodeData(
  scenario: GameScenario,
  nodeId: string,
  patch: Parameters<typeof patchNodeData>[2],
): GameScenario {
  return { ...scenario, graph: patchNodeData(scenario.graph, nodeId, patch) }
}

export function patchOverlayMount(
  scenario: GameScenario,
  nodeId: string,
  mountId: string,
  patch: Partial<OverlayNode>,
): GameScenario {
  const node = scenario.graph.nodes.find((n) => n.id === nodeId)
  if (!node) return scenario
  const mounts = (node.data.overlayNodes ?? []).map((m) =>
    overlayMountId(m) === mountId ? { ...m, ...patch } : m,
  )
  return { ...scenario, graph: setOverlayNodes(scenario.graph, nodeId, mounts) }
}
