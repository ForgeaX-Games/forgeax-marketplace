import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'
import type { BranchKind } from '../../scenario/types'

export interface BranchEdgeData extends Record<string, unknown> {
  kind: BranchKind
  label?: string
}

/**
 * BranchEdge —— StoryGraph 的自定义边组件
 *
 * 为什么不用 React Flow 默认的 `smoothstep` + label？
 *
 *   1) **Label 被节点遮挡**（作者原话"一些连线上的文字被遮盖了"）——
 *      默认 label 是 <text> 元素，和 edge 画在同一个 SVG 里；SVG 的 z-order
 *      由 DOM 顺序决定，而 React Flow 把 edges 画在 nodes container 之前。
 *      用 EdgeLabelRenderer（官方提供的 label 外 portal）把 label 挪到
 *      `.react-flow__edgelabel-renderer` 里 —— 那层在 nodes 之上，HTML
 *      元素也更容易加阴影/圆角。
 *
 *   2) **QTE 成功/失败看不出来**（作者原话"涉及到 QTE 的成功失败，没显示"）——
 *      原先四种 BranchKind 仅靠 inline stroke 颜色区分，CSS 里还有一条
 *      `.react-flow__edge-path { stroke: ...; stroke-width: 1.8 }` 正在
 *      覆盖 inline style（specificity 赢、inline 被吃）。这里把颜色 / 虚实 /
 *      粗细 / 标签形态全部绑到 kind 上，直接在 <BaseEdge style={...}> 指定
 *      并用不同的 dash 图案让笔触本身就能读出语义。
 *
 *   3) **文字过多遮图**（作者最新反馈"现在文字过多"）——
 *      原先 chip 是"图标 + label 文字"药丸，多条分支并排时文字挤满线条。
 *      现在退化为一枚**圆形 icon**（直径 24）嵌在连线中点：
 *        · 默认态：只显示 glyph，文字走 tooltip（native `title`）
 *        · 点击态：不展开侧挂标签；直接打开 EdgeMenu（详情 + 编辑 kind/label）
 *      早期版本在选中时同时显示 side-label pill + EdgeMenu，出现"两个弹窗"
 *      （作者 2026-04-29 反馈），故移除 side label，编辑全权交给 EdgeMenu。
 *
 * 四种笔触（设计意图）：
 *
 *     choice     琥珀实线 + ◆           ——  作者决策点，最显眼
 *     qte_pass   翠绿实线 + ✓            ——  成功走向，温暖积极
 *     qte_fail   朱红破折线 + ✗          ——  失败走向，破折线 = "断裂感"
 *     auto       浅灰虚线 + →            ——  被动过渡，最弱
 *
 * icon 永远显示，即使 label 文本为空 —— "QTE 成功/失败" 这种重要语义
 * 不会因为作者忘了填 label 就看不到。
 */

interface KindStyle {
  stroke: string
  strokeWidth: number
  strokeDasharray?: string
  chipFill: string
  chipText: string
  chipBorder: string
  glyph: string
  labelFallback: string
}

const KIND_STYLE: Record<BranchKind, KindStyle> = {
  choice: {
    stroke: '#f59e0b',
    strokeWidth: 2.4,
    chipFill: '#fff7e6',
    chipText: '#92400e',
    chipBorder: '#f59e0b',
    glyph: '◆',
    labelFallback: '选择',
  },
  qte_pass: {
    stroke: '#10b981',
    strokeWidth: 2.4,
    chipFill: '#ecfdf5',
    chipText: '#065f46',
    chipBorder: '#10b981',
    glyph: '✓',
    labelFallback: 'QTE 通过',
  },
  qte_fail: {
    stroke: '#ef4444',
    strokeWidth: 2.4,
    strokeDasharray: '8 5',
    chipFill: '#fef2f2',
    chipText: '#991b1b',
    chipBorder: '#ef4444',
    glyph: '✗',
    labelFallback: 'QTE 失败',
  },
  auto: {
    stroke: '#94a3b8',
    strokeWidth: 1.6,
    strokeDasharray: '4 4',
    chipFill: '#f8fafc',
    chipText: '#334155',
    chipBorder: '#cbd5e1',
    glyph: '→',
    labelFallback: '自动',
  },
}

export const BRANCH_ICON_CLICK_EVENT = 'reel-studio:branch-icon-click'

export interface BranchIconClickDetail {
  edgeId: string
  clientX: number
  clientY: number
}

export const BranchEdge = memo(function BranchEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const d = (data ?? {}) as BranchEdgeData
  const kind: BranchKind = d.kind ?? 'auto'
  const style = KIND_STYLE[kind]

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 14,
  })

  const pathStyle: React.CSSProperties = {
    stroke: style.stroke,
    strokeWidth: selected ? style.strokeWidth + 0.6 : style.strokeWidth,
    strokeDasharray: style.strokeDasharray,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    fill: 'none',
    opacity: selected ? 1 : 0.92,
    filter: selected
      ? `drop-shadow(0 0 6px ${style.stroke}66)`
      : 'drop-shadow(0 1px 2px rgba(28,22,15,0.12))',
    transition:
      'stroke-width 160ms ease, opacity 160ms ease, filter 160ms ease',
  }

  const labelText = d.label && d.label.trim().length > 0 ? d.label : style.labelFallback

  return (
    <>
      <BaseEdge id={id} path={path} style={pathStyle} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        {/*
          外层 wrapper 只做绝对定位 + 中心对齐；视觉单元是里面的圆形 icon。
          （早期版本在 selected 时还会展开 side-label pill，作者反馈与
           EdgeMenu 形成"两个弹窗"，故移除；编辑全权交给 EdgeMenu。）
        */}
        <div
          className={`ks-branch-icon-wrap kind-${kind} ${selected ? 'is-selected' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          data-testid={`branch-chip-${id}`}
        >
          <button
            type="button"
            className="ks-branch-icon"
            style={{
              background: style.chipFill,
              color: style.chipText,
              borderColor: style.chipBorder,
            }}
            title={labelText}
            aria-label={labelText}
            onClick={(e) => {
              /*
               * React Flow 的 onEdgeClick 只在 SVG path 被点时触发；HTML button
               * 里的点击不会冒泡到它。通过 window CustomEvent 桥接到 StoryGraph，
               * 那边同样调用 openEdgeMenuAt(id, clientX, clientY) 打开详情菜单。
               * 写自定义事件而非 context —— edges 组件由 React Flow 内部实例化，
               * Provider 的 consumer 对它无效。
               */
              e.stopPropagation()
              if (typeof window === 'undefined') return
              window.dispatchEvent(
                new CustomEvent<BranchIconClickDetail>(
                  BRANCH_ICON_CLICK_EVENT,
                  { detail: { edgeId: id, clientX: e.clientX, clientY: e.clientY } },
                ),
              )
            }}
          >
            <span className="ks-branch-icon-glyph" aria-hidden>
              {style.glyph}
            </span>
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
})

/**
 * 为测试导出的颜色/glyph map —— 渲染细节测试可直接比对
 * （不要在运行时代码里 import 这个常量；用 KIND_STYLE 即可）
 */
export const BRANCH_EDGE_STYLES = KIND_STYLE
