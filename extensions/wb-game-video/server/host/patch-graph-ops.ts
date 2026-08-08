import { randomUUID } from 'node:crypto'
import type {
  EdgeRouting,
  GameGraph,
  GameNode,
  GraphLibraryDocument,
  NodeBgm,
  OverlayChild,
  OverlayNode,
} from '../../src/runtime/schema/graph-schema'
import { normalizeDocument } from '../../src/editor/persist/blueprint-project'
import {
  addNode,
  attachSubProcess,
  connect,
  disconnect,
  insertNodeAfter,
  makeEmptySubFlowPack,
  patchNodeData,
  removeNode,
  updateEdgeData,
  type ConnectSpec,
  type NodeDataPatch,
} from '../../src/graph/edit/graph-edit'
import {
  addOverlayChild,
  ensureNodeOverlay,
  patchOverlayChild,
  patchOverlayChildParams,
  patchOverlayMount,
  removeOverlayChild,
  resetOverride,
} from '../../src/graph/edit/overlay-edit'
import { patchNodeBgm } from '../../src/editor/shell/bgm-authoring'

export type PatchGraphInput = {
  blueprintId?: string
  ops: Array<Record<string, unknown>>
}

export type PatchGraphApplyResult =
  | { ok: true; document: GraphLibraryDocument; applied: number }
  | { ok: false; errors: string[]; failedOpIndex?: number }

function resolvePackId(doc: GraphLibraryDocument, blueprintId?: string): string {
  return blueprintId ?? doc.manifest.mainPackId
}

function withPackGraph(
  doc: GraphLibraryDocument,
  packId: string,
  nextGraph: GameGraph,
): GraphLibraryDocument {
  const pack = doc.manifest.packs[packId]
  if (!pack) throw new Error(`blueprint not found: ${packId}`)
  const packs = {
    ...doc.manifest.packs,
    [packId]: { ...pack, graph: nextGraph },
  }
  return normalizeDocument({
    ...doc,
    manifest: { ...doc.manifest, packs },
  })
}

function requireString(op: Record<string, unknown>, key: string, index: number): string {
  const value = String(op[key] ?? '')
  if (!value) throw new Error(`op[${index}] missing ${key}`)
  return value
}

/**
 * 编辑 helper 对缺失目标一律 no-op（画布手势需要这种宽容），但工具批次必须硬失败：
 * 否则 AI 拿着错 id 也能收到 ok，改动静默丢失。
 */
function requireNode(graph: GameGraph, nodeId: string): void {
  if (!graph.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`node not found: ${nodeId}`)
  }
}

function requireEdge(graph: GameGraph, edgeId: string): void {
  if (!graph.edges.some((edge) => edge.id === edgeId)) {
    throw new Error(`edge not found: ${edgeId}`)
  }
}

function applyOverlayOp(
  doc: GraphLibraryDocument,
  packId: string,
  nodeId: string,
  edit: (scenario: GraphLibraryDocument) => GraphLibraryDocument,
): GraphLibraryDocument {
  const graph = doc.manifest.packs[packId]!.graph
  requireNode(graph, nodeId)
  const scenario = edit({ ...doc, graph })
  return withPackGraph({ ...doc, ui: scenario.ui }, packId, scenario.graph)
}

export function applyPatchGraphOps(
  inputDoc: GraphLibraryDocument,
  input: PatchGraphInput,
): PatchGraphApplyResult {
  if (!Array.isArray(input.ops) || input.ops.length === 0) {
    return { ok: false, errors: ['ops must be a non-empty array'] }
  }

  let doc = normalizeDocument(structuredClone(inputDoc))
  const packId = resolvePackId(doc, input.blueprintId)
  if (!doc.manifest.packs[packId]) {
    return { ok: false, errors: [`blueprint not found: ${packId}`], failedOpIndex: 0 }
  }

  for (let i = 0; i < input.ops.length; i++) {
    const op = input.ops[i]!
    const kind = String(op.op)
    try {
      let graph = doc.manifest.packs[packId]!.graph
      if (kind === 'set-node-field') {
        const nodeId = String(op.nodeId ?? '')
        const field = String(op.field ?? '')
        if (!nodeId || !field) throw new Error(`op[${i}] missing nodeId/field`)
        const node = graph.nodes.find((n) => n.id === nodeId)
        if (!node) throw new Error(`node not found: ${nodeId}`)
        if (field === 'name') {
          graph = patchNodeData(graph, nodeId, { name: String(op.value) })
        } else if (field === 'type') {
          graph = {
            ...graph,
            nodes: graph.nodes.map((n) =>
              n.id === nodeId ? { ...n, type: String(op.value) as typeof n.type } : n,
            ),
          }
        } else if (field === 'position') {
          const pos = op.value as { x: number; y: number }
          graph = {
            ...graph,
            nodes: graph.nodes.map((n) =>
              n.id === nodeId ? { ...n, position: { x: pos.x, y: pos.y } } : n,
            ),
          }
        } else {
          throw new Error(`unsupported field: ${field}`)
        }
        doc = withPackGraph(doc, packId, graph)
      } else if (kind === 'set-node-data') {
        const nodeId = requireString(op, 'nodeId', i)
        requireNode(graph, nodeId)
        const patch = { ...(op.patch as Record<string, unknown>) }
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) patch[key] = undefined
        }
        graph = patchNodeData(graph, nodeId, patch as NodeDataPatch)
        doc = withPackGraph(doc, packId, graph)
      } else if (kind === 'add-node') {
        const node = structuredClone(op.node) as GameNode
        if (!node || typeof node !== 'object') throw new Error(`op[${i}] missing node`)
        if (!node.id) node.id = `n-${randomUUID()}`
        doc = withPackGraph(doc, packId, addNode(graph, node))
      } else if (kind === 'remove-node') {
        const nodeId = requireString(op, 'nodeId', i)
        requireNode(graph, nodeId)
        doc = withPackGraph(doc, packId, removeNode(graph, nodeId))
      } else if (kind === 'insert-node-after') {
        const afterId = requireString(op, 'afterId', i)
        requireNode(graph, afterId)
        const inserted = insertNodeAfter(graph, afterId, {
          name: typeof op.name === 'string' ? op.name : undefined,
          gapX: typeof op.gapX === 'number' ? op.gapX : undefined,
          node: op.node as GameNode | undefined,
        })
        doc = withPackGraph(doc, packId, inserted.graph)
      } else if (kind === 'connect') {
        const spec: ConnectSpec = {
          source: requireString(op, 'source', i),
          target: requireString(op, 'target', i),
          sourceHandle: typeof op.sourceHandle === 'string' ? op.sourceHandle : undefined,
          targetHandle: typeof op.targetHandle === 'string' ? op.targetHandle : undefined,
          data: op.data as EdgeRouting | undefined,
          id: typeof op.id === 'string' ? op.id : undefined,
        }
        requireNode(graph, spec.source)
        requireNode(graph, spec.target)
        doc = withPackGraph(doc, packId, connect(graph, spec))
      } else if (kind === 'disconnect') {
        const edgeId = requireString(op, 'edgeId', i)
        requireEdge(graph, edgeId)
        doc = withPackGraph(doc, packId, disconnect(graph, edgeId))
      } else if (kind === 'update-edge-data') {
        const edgeId = requireString(op, 'edgeId', i)
        requireEdge(graph, edgeId)
        doc = withPackGraph(doc, packId, updateEdgeData(graph, edgeId, op.data as EdgeRouting))
      } else if (kind === 'patch-node-bgm') {
        const nodeId = requireString(op, 'nodeId', i)
        const node = graph.nodes.find((item) => item.id === nodeId)
        if (!node) throw new Error(`node not found: ${nodeId}`)
        const bgm = patchNodeBgm(node.data.bgm, op.patch as Partial<NodeBgm>)
        doc = withPackGraph(doc, packId, patchNodeData(graph, nodeId, { bgm }))
      } else if (kind === 'ensure-node-overlay') {
        const nodeId = requireString(op, 'nodeId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          ensureNodeOverlay(scenario, nodeId) as GraphLibraryDocument)
      } else if (kind === 'add-overlay-child') {
        const nodeId = requireString(op, 'nodeId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          addOverlayChild(scenario, nodeId, op.child as OverlayChild) as GraphLibraryDocument)
      } else if (kind === 'remove-overlay-child') {
        const nodeId = requireString(op, 'nodeId', i)
        const childId = requireString(op, 'childId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          removeOverlayChild(scenario, nodeId, childId) as GraphLibraryDocument)
      } else if (kind === 'patch-overlay-child') {
        const nodeId = requireString(op, 'nodeId', i)
        const childId = requireString(op, 'childId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          patchOverlayChild(
            scenario,
            nodeId,
            childId,
            op.patch as Partial<OverlayChild>,
          ) as GraphLibraryDocument)
      } else if (kind === 'patch-overlay-child-params') {
        const nodeId = requireString(op, 'nodeId', i)
        const childId = requireString(op, 'childId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          patchOverlayChildParams(
            scenario,
            nodeId,
            childId,
            op.inputs as Record<string, unknown>,
          ) as GraphLibraryDocument)
      } else if (kind === 'patch-overlay-mount') {
        const nodeId = requireString(op, 'nodeId', i)
        const mountId = requireString(op, 'mountId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          patchOverlayMount(
            scenario,
            nodeId,
            mountId,
            op.patch as Partial<OverlayNode>,
          ) as GraphLibraryDocument)
      } else if (kind === 'reset-overlay-override') {
        const nodeId = requireString(op, 'nodeId', i)
        const childId = requireString(op, 'childId', i)
        doc = applyOverlayOp(doc, packId, nodeId, (scenario) =>
          resetOverride(scenario, nodeId, childId) as GraphLibraryDocument)
      } else if (kind === 'attach-sub-process') {
        const nodeId = requireString(op, 'nodeId', i)
        requireNode(graph, nodeId)
        doc = withPackGraph(doc, packId, attachSubProcess(graph, nodeId))
      } else if (kind === 'make-empty-sub-flow-pack') {
        const pack = makeEmptySubFlowPack({
          id: typeof op.id === 'string' ? op.id : undefined,
          title: typeof op.title === 'string' ? op.title : undefined,
          version: typeof op.version === 'string' ? op.version : undefined,
        })
        const blueprintPack = { ...pack, title: pack.title ?? '子蓝图' }
        doc = normalizeDocument({
          ...doc,
          manifest: {
            ...doc.manifest,
            packs: { ...doc.manifest.packs, [pack.id]: blueprintPack },
          },
        })
      } else {
        throw new Error(`unsupported op: ${kind}`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        errors: [message],
        failedOpIndex: i,
      }
    }
  }

  return { ok: true, document: doc, applied: input.ops.length }
}
