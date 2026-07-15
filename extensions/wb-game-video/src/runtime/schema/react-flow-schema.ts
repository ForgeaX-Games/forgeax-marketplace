/**
 * reactflow 渲染层数据契约 —— 逐字对齐 `cinegame/src/react-flow-schema.d.ts`。
 *
 * 这是**转换层**（蓝图 → reactflow）的目标形态：reactflow 节点的 inputs/outputs
 * 由蓝图节点的 incoming/outgoing 派生为 handles；edge 的 sourceHandle/targetHandle
 * 用同一个 flow id 对齐。蓝图本体不含任何这里的字段。
 */

export interface Position {
  x: number
  y: number
}

export type HandleType = 'source' | 'target'
export type HandlePosition = 'left' | 'right' | 'top' | 'bottom'

export interface Handle<TData = unknown> {
  id: string
  type: HandleType
  position: HandlePosition
  label?: string
  data?: TData
}

export interface Node<TData = unknown, TType extends string = string, THandleData = unknown> {
  id: string
  type: TType
  position: Position
  inputs: Handle<THandleData>[]
  outputs: Handle<THandleData>[]
  data: TData
}

export interface Edge<TData = unknown> {
  id: string
  source: string
  target: string
  sourceHandle: string
  targetHandle: string
  label?: string
  data?: TData
}

export interface Graph<TNode extends Node = Node, TEdge extends Edge = Edge> {
  nodes: TNode[]
  edges: TEdge[]
}

export interface FXHandleData {
  flowId: string
}

export interface FXNodeData {
  label: string
  /** 节点角标：overlay / subflow / pack 等，驱动标题条样式。 */
  badge: string
}

export type FXNode = Node<FXNodeData, string, FXHandleData>
export type FXEdge = Edge
export type FXGraph = Graph<FXNode, FXEdge>
