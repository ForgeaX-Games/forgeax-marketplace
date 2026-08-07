/**
 * 选项 / 技能（component id: `choice` / `skill`）—— 契约 + 默认按钮条渲染同文件。
 * 专属皮肤（inkYingMo / battleSkillBar）复用本文件导出的 ChoiceParams / CHOICE_INPUTS。
 */
import type { ReactNode } from 'react'
import type { ComponentDef } from '../../registry/component-registry'
import type { GraphCondition } from '../../schema/graph-schema'
import type { ComponentEvent, ComponentInput } from '../../schema/node-config-schema'
import { isOptionLocked } from '../optionLock'
import type { OverlayProps } from '../rendererRegistry'
import { anchorStyle, bottomRow, defaultBtn, hasAnchor } from './defaultUi'
import { useDefaultEventTimeout } from './skinRuntime'

/** 选项呈现形态：列表 / 画面热区。 */
export type ChoicePresentation = 'list' | 'hotspot'
/**
 * choice/skill 的选项项 = 共享事件 + 本组件门控。
 * `condition` 不成立 → 皮肤用实时态灰置禁选（≠ 边 condition；引擎不注入 _locked）。
 */
export type ChoiceOption = ComponentEvent & { condition?: GraphCondition }
export interface ChoiceParams {
  /** 交互目录：每个 option 一个同名出口（id === 出口 handle）。 */
  events: ChoiceOption[]
  /** 限时 ms（0/缺省=不限时）。 */
  timeoutMs?: number
  /** 超时默认出口 event id。 */
  defaultEvent?: string
  presentation?: ChoicePresentation
  /** 整组选项锚点（归一化 0~1；预览拖拽 / 试玩共用）。 */
  x?: number
  y?: number
}
/**
 * choice 系共享 inputs（`choice`/`skill`/`inkYingMo`/`battleSkillBar` 契约复用）。
 * 作者可编辑的只有 `限时ms` + `选项`，其余字段刻意不声明：
 *
 * - `defaultEvent`（超时出口）：走向一律由蓝图出边决定，不让作者在组件参数里另配一份。字段仍在
 *   `ChoiceParams` 与落盘数据里，由各皮肤 preset 写入、运行时 `useDefaultEventTimeout` 消费。
 * - `presentation`（呈现）：没有任何渲染器读它——呈现形态由所选皮肤自身决定（`ChoiceButtons`
 *   看 `hasAnchor(x,y)`，應默/技能条各自写死排布），配了也不生效，故不再暴露为可编辑项。
 * - `x`/`y`：**必须留在本数组**——`isPositionable()`（editors.tsx）靠「manifest 是否声明 x+y」
 *   判定该组件能否自由定位，删掉会让预览台拖拽手柄失效；面板里不显示它们是靠调用侧
 *   `excludeKeys`（见 NodeInspector 的 ComponentFormFields），位置统一用预览台拖拽调。
 */
export const CHOICE_INPUTS: ComponentInput[] = [
  { key: 'timeoutMs', label: '限时ms', valueType: 'number' },
  { key: 'events', label: '选项', valueType: 'string', component: 'events', default: [{ id: 'opt0', label: '选项一' }] },
  { key: 'x', label: 'x', valueType: 'number' },
  { key: 'y', label: 'y', valueType: 'number' },
]
export const validateChoiceEvents = (p: ChoiceParams): string[] =>
  Array.isArray(p.events) && p.events.length > 0 ? [] : ['events must be non-empty']

export const choiceComponent: ComponentDef<ChoiceParams> = {
  label: '选项',
  inputs: CHOICE_INPUTS,
  validate: validateChoiceEvents,
}

export const skillComponent: ComponentDef<ChoiceParams> = {
  label: '技能',
  inputs: CHOICE_INPUTS,
  validate: validateChoiceEvents,
}

export function ChoiceButtons({ overlay, emit, ctx, preview }: OverlayProps): ReactNode {
  useDefaultEventTimeout(emit, overlay.inputs as Record<string, unknown>, preview)
  const inputs = overlay.inputs as unknown as ChoiceParams
  const rowStyle = hasAnchor(inputs.x, inputs.y)
    ? anchorStyle(inputs.x as number, inputs.y as number, {
        display: 'flex',
        gap: 10,
        justifyContent: 'center',
        flexWrap: 'wrap',
        pointerEvents: 'auto',
      })
    : bottomRow
  return (
    <div className="gv-choice-layer" style={rowStyle}>
      {(inputs.events ?? []).map((e) => {
        const locked = isOptionLocked(e, ctx)
        return (
          <button
            key={e.id}
            style={{ ...defaultBtn('#2563eb'), ...(locked ? { opacity: 0.4, cursor: 'not-allowed' } : null) }}
            disabled={locked}
            onClick={() => {
              if (!locked) emit?.(e.id)
            }}
          >
            {e.label ?? e.id}
          </button>
        )
      })}
    </div>
  )
}
