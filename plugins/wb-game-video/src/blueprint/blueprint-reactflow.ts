/**
 * 转换层：GameVideoBlueprintGraph → reactflow(FX) 图。逐字对齐
 * `cinegame/src/blueprint-reactflow.ts` 的做法：
 *  - node.inputs/outputs 由 incoming/outgoing 派生为 handles。
 *  - edge.sourceHandle/targetHandle 用同一个 flow id 对齐（`source:`/`target:` 前缀）。
 *  - data 只放 HTML 渲染需要的字段；不把完整 blueprint 节点塞进 data。
 *
 * 与 cinegame 唯一不同：布局来自外部 positions（编辑器/scene.pos），蓝图本体仍渲染无关。
 */

import {
  type BlueprintElementType,
  type GameVideoBlueprintEdge,
  type GameVideoBlueprintGraph,
  type GameVideoBlueprintNode,
} from './blueprint-schema'
import type { FXGraph, FXHandleData, FXNodeType, Handle } from './react-flow-schema'

export type PositionMap = Record<string, { x: number; y: number }>

export function toFXGraph(graph: GameVideoBlueprintGraph, positions: PositionMap = {}): FXGraph {
  const layout = positions && Object.keys(positions).length > 0 ? positions : autoLayout(graph)
  return {
    nodes: graph.nodes.map((node) => {
      const pos = layout[node.id] ?? { x: 0, y: 0 }
      return {
        id: node.id,
        type: toFXNodeType(node.elementType),
        position: { x: pos.x, y: pos.y },
        inputs: node.incoming.map((flowId) => toHandle(flowId, 'target')),
        outputs: node.outgoing.map((flowId) => toHandle(flowId, 'source')),
        data: {
          label: node.name,
          subtitle: toSubtitle(node),
          elementType: String(node.elementType),
          badge: toBadge(node),
          sceneKind: node.extensionElements.sceneKind,
          hud: node.extensionElements.hud,
        },
      }
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.sourceRef,
      target: edge.targetRef,
      sourceHandle: toHandleId(edge.id, 'source'),
      targetHandle: toHandleId(edge.id, 'target'),
      label: edge.name,
      data: {
        edgeId: edge.id,
        conditionExpression: edge.conditionExpression,
        kind: edge.extension?.kind,
      },
    })),
  }
}

function toHandle(flowId: string, type: 'source' | 'target'): Handle<FXHandleData> {
  return {
    id: toHandleId(flowId, type),
    type,
    position: type === 'source' ? 'right' : 'left',
    label: flowId,
    data: { flowId },
  }
}

function toHandleId(flowId: string, type: 'source' | 'target'): string {
  return `${type}:${flowId}`
}

function toFXNodeType(type: BlueprintElementType): FXNodeType {
  if (type === 'start') return 'input'
  if (type === 'end') return 'output'
  if (type === 'subflow') return 'group'
  return 'default'
}

function toSubtitle(node: GameVideoBlueprintNode): string {
  const ext = node.extensionElements
  return ext.clipId ?? ext.calcType ?? ext.stateKey ?? node.elementType
}

function toBadge(node: GameVideoBlueprintNode): string {
  const ext = node.extensionElements
  if (ext.clipId) return ext.clipId
  if (ext.boss) return 'boss'
  if (ext.qte) return 'qte'
  if (ext.decision || (ext.options && ext.options.length > 0)) return 'choice'
  return ext.sceneKind
}

/**
 * 兜底自动布局 —— BFS 分层（从无 incoming 的节点开始），列 = 拓扑层级。
 * 仅在外部未提供 positions 时使用；产物只进 reactflow 视图，不回写蓝图。
 */
function autoLayout(graph: GameVideoBlueprintGraph): PositionMap {
  const COL_W = 260
  const ROW_H = 140
  const targetSet = new Set(graph.edges.map((e) => e.targetRef))
  const adjacency = new Map<string, string[]>()
  for (const edge of graph.edges) {
    ;(adjacency.get(edge.sourceRef) ?? adjacency.set(edge.sourceRef, []).get(edge.sourceRef)!).push(
      edge.targetRef,
    )
  }

  const depth = new Map<string, number>()
  const roots = graph.nodes.filter((n) => !targetSet.has(n.id)).map((n) => n.id)
  const queue: string[] = roots.length > 0 ? [...roots] : graph.nodes.slice(0, 1).map((n) => n.id)
  for (const r of queue) depth.set(r, 0)

  while (queue.length > 0) {
    const id = queue.shift()!
    const d = depth.get(id) ?? 0
    for (const next of adjacency.get(id) ?? []) {
      if (depth.has(next)) continue
      depth.set(next, d + 1)
      queue.push(next)
    }
  }

  const rowCursor = new Map<number, number>()
  const out: PositionMap = {}
  for (const node of graph.nodes) {
    const col = depth.get(node.id) ?? 0
    const row = rowCursor.get(col) ?? 0
    rowCursor.set(col, row + 1)
    out[node.id] = { x: col * COL_W, y: row * ROW_H }
  }
  return out
}
