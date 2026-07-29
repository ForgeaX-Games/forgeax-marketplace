/**
 * 通用 QTE（component id: `qte`）—— 契约 + 默认三键渲染同文件。
 * 专属皮肤（inkKou / battleParry）复用本文件导出的 QteParams / QTE_INPUTS / QTE_DEFAULT_EVENTS。
 */
import type { ReactNode } from 'react'
import type { ComponentDef } from '../../registry/component-registry'
import type { ComponentEvent, ComponentInput } from '../../schema/node-config-schema'
import type { OverlayProps } from '../rendererRegistry'
import { bottomRow, defaultBtn } from './defaultUi'
import { useDefaultEventTimeout } from './skinRuntime'

/** QTE 单拍的几何/判定形态。 */
export type QteCueShape = 'tap' | 'hold' | 'sweep'
export interface QteCue {
  id: string
  shape?: QteCueShape
  /** 归一化坐标（0~1）。 */
  x?: number
  y?: number
  /** 提示环出现 / 判定命中时刻（相对演出 ms）。 */
  appearAt?: number
  targetAt?: number
  /** 单个按键的结束 / 消失时刻（相对演出 ms）；缺省由 targetAt/durationMs 派生。 */
  endAt?: number
  /** hold 时长 / sweep 划动窗口 ms。 */
  durationMs?: number
  /** sweep 方向。 */
  sweepDir?: 'left' | 'right' | 'up' | 'down'
  label?: string
  /** 触发键（键盘）。 */
  triggerKey?: string
  /** 慢动作系数（<1 减速）。 */
  slowMo?: number
  zIndex?: number
}
export interface QteParams {
  qteKind?: 'parry' | 'timing' | 'mash' | 'sequence' | 'sweep'
  windowMs?: number
  passingHits?: number
  /** 结构化拍点。 */
  cues?: QteCue[]
  /**
   * 完美判定半窗 ms：|玩家按下时刻 − 拍点「命中(targetAt)」时刻| ≤ 此值 → pass（完美）。
   * 「成功(good)」不需要独立参数——命中落在拍点显示窗 [appearAt, endAt] 内即成功、窗外/超时=fail。
   * 缺省=窗内命中即完美。运行时由各 QTE 皮肤消费。
   */
  perfectMs?: number
  /** 交互目录：自定义判定出口（缺省见本组件 `events`；皮肤自带 defaults 写进 params.events）。 */
  events?: ComponentEvent[]
  /** 超时默认出口 event id（缺省 'fail'）。 */
  defaultEvent?: string
  /** 限时 ms。 */
  timeoutMs?: number
  /** 皮肤自管时限 ms（如收圈时长；缺省各皮肤自带）。 */
  durationMs?: number
}
/** 无皮肤 / 未落盘 events 时的通用三档出口。 */
export const QTE_DEFAULT_EVENTS: ComponentEvent[] = [
  { id: 'pass', label: '完美' },
  { id: 'good', label: '良好' },
  { id: 'fail', label: '失败' },
]
/**
 * qte 系共享 inputs（`qte`/`inkKou`/`battleParry` 契约复用）。
 *
 * 与 `CHOICE_INPUTS` 同一处置：`defaultEvent`（超时出口 / 失手档位）不声明为可编辑项——走向
 * 一律交蓝图出边，作者不在组件参数里另配。字段仍在 `QteParams` 与落盘数据里由各皮肤 preset
 * 写入，运行时（`useDefaultEventTimeout` / inkKou 档位归一 / battleParry missKey）照旧消费。
 */
export const QTE_INPUTS: ComponentInput[] = [
  { key: 'qteKind', label: 'QTE型', valueType: 'string', default: 'parry', options: [{ value: 'parry', label: '完美防反' }, { value: 'timing', label: '打点' }, { value: 'mash', label: '连打' }, { value: 'sequence', label: '连招' }, { value: 'sweep', label: '划动' }] },
  { key: 'passingHits', label: '过关次', valueType: 'number', default: 1 },
  { key: 'perfectMs', label: '完美半窗ms', valueType: 'number' },
  { key: 'windowMs', label: '窗口ms', valueType: 'number' },
  { key: 'durationMs', label: '收圈时长ms', valueType: 'number' },
  { key: 'timeoutMs', label: '限时ms', valueType: 'number' },
  { key: 'glyph', label: '字形（inkKou）', valueType: 'string' },
  { key: 'events', label: '出口', valueType: 'string', component: 'events' },
  { key: 'cues', label: '拍点', valueType: 'string', component: 'qteCues', default: [] },
]

export const qteComponent: ComponentDef<QteParams> = {
  label: 'QTE',
  events: QTE_DEFAULT_EVENTS,
  inputs: QTE_INPUTS,
}

export function QteButtons({ overlay, emit, preview }: OverlayProps): ReactNode {
  useDefaultEventTimeout(emit, overlay.inputs as Record<string, unknown>, preview)
  return (
    <div className="gv-qte-layer" style={bottomRow}>
      <button style={defaultBtn('#16a34a')} onClick={() => emit?.('pass')}>完美</button>
      <button style={defaultBtn('#65a30d')} onClick={() => emit?.('good')}>成功</button>
      <button style={defaultBtn('#dc2626')} onClick={() => emit?.('fail')}>失败</button>
    </div>
  )
}
