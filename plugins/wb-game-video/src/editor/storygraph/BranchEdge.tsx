import { memo, type CSSProperties } from 'react'
import {
  BaseEdge,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import type { BranchKind } from '../../scenario/types'
import {
  BPG_WIRE_SELECTED_STROKE,
  BPG_WIRE_STROKE,
  BPG_WIRE_WIDTH,
} from './blueprintGraphStyle'

export interface BranchEdgeData extends Record<string, unknown> {
  kind: BranchKind
  label?: string
}

/**
 * BranchEdge —— 剧情树 / 蓝图共用的分支连线样式。
 *
 * 对齐原型 `.bpg-wires path`：统一 #9aa7b4 贝塞尔线，2.5px 圆头 + 轻阴影；
 * 不在连线上放 ✓/✗ 等 icon。branch.kind 仍保留在数据里供运行时路由。
 */

export interface BranchEdgeVisualStyle {
  stroke: string
  strokeWidth: number
  strokeDasharray?: string
}

/** 全插件统一的连线视觉（与 branch.kind 无关）。 */
export const UNIFIED_BRANCH_EDGE_STYLE: BranchEdgeVisualStyle = {
  stroke: BPG_WIRE_STROKE,
  strokeWidth: BPG_WIRE_WIDTH,
}

/** 兼容旧 import：各 kind 映射到同一套视觉。 */
export const BRANCH_EDGE_STYLES: Record<
  BranchKind,
  BranchEdgeVisualStyle & { glyph: string; labelFallback: string }
> = {
  choice: { ...UNIFIED_BRANCH_EDGE_STYLE, glyph: '', labelFallback: '' },
  qte_pass: { ...UNIFIED_BRANCH_EDGE_STYLE, glyph: '', labelFallback: '' },
  qte_fail: { ...UNIFIED_BRANCH_EDGE_STYLE, glyph: '', labelFallback: '' },
  auto: { ...UNIFIED_BRANCH_EDGE_STYLE, glyph: '', labelFallback: '' },
}

export function resolveBranchEdgeStyle(_kind?: BranchKind): BranchEdgeVisualStyle {
  return UNIFIED_BRANCH_EDGE_STYLE
}

function wirePathStyle(selected: boolean | undefined): CSSProperties {
  return {
    stroke: selected ? BPG_WIRE_SELECTED_STROKE : BPG_WIRE_STROKE,
    strokeWidth: selected ? 3.6 : BPG_WIRE_WIDTH,
    strokeLinecap: 'round',
    fill: 'none',
    opacity: selected ? 1 : 0.92,
    filter: selected
      ? 'drop-shadow(0 0 5px rgba(224,121,95,.75))'
      : 'drop-shadow(0 1px 2px rgba(0,0,0,.55))',
    transition: 'stroke-width 160ms ease, opacity 160ms ease',
  }
}

export const BranchEdge = memo(function BranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  markerEnd,
}: EdgeProps) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={wirePathStyle(selected)}
    />
  )
})
