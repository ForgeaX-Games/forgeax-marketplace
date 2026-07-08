import type { Scene, Scenario, SceneKind } from '../../scenario/types'

/**
 * 蓝图画布视觉 SSOT —— 对齐 `视频交互原型.html` §UE4 蓝图风格 (.bpg-* / .bp-type-*)。
 */

export const BPG_CANVAS_BG = '#1b1d22'

export const BPG_CANVAS_GRID_CSS = `
  background-color: ${BPG_CANVAS_BG};
  background-image:
    linear-gradient(rgba(150,165,190,.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(150,165,190,.045) 1px, transparent 1px),
    linear-gradient(rgba(150,165,190,.085) 1px, transparent 1px),
    linear-gradient(90deg, rgba(150,165,190,.085) 1px, transparent 1px);
  background-size: 16px 16px, 16px 16px, 128px 128px, 128px 128px;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.55), inset 0 22px 60px rgba(0,0,0,.5);
`

/** 原型新建连线默认色 `.bpg-wires path` / `ws.push({ c:'#9aa7b4' })` */
export const BPG_WIRE_STROKE = '#9aa7b4'
export const BPG_WIRE_WIDTH = 2.5
export const BPG_WIRE_SELECTED_STROKE = '#e0795f'

export const BPG_NODE_W = 174

/** 原型 `.bp-type-*` 标题栏 accent */
export const BPG_TYPE_ACCENTS = {
  root: '#3aa86a',
  loop: '#4a90d8',
  open: '#e0a83a',
  perf: '#e0734a',
  end: '#a06ad0',
} as const

export type BpgTypeClass = keyof typeof BPG_TYPE_ACCENTS

export function resolveBpgType(
  scene: Scene,
  scenario: Scenario,
): { typeClass: BpgTypeClass; accent: string; kindLabel: string } {
  if (scene.id === scenario.rootSceneId) {
    return { typeClass: 'root', accent: BPG_TYPE_ACCENTS.root, kindLabel: '起点' }
  }
  if (scene.isEnding) {
    return { typeClass: 'end', accent: BPG_TYPE_ACCENTS.end, kindLabel: '结局' }
  }
  const kind: SceneKind = scene.kind ?? 'story'
  switch (kind) {
    case 'choice':
      return { typeClass: 'open', accent: BPG_TYPE_ACCENTS.open, kindLabel: '选择' }
    case 'battle':
      return { typeClass: 'perf', accent: BPG_TYPE_ACCENTS.perf, kindLabel: 'Boss战' }
    case 'qte':
      return { typeClass: 'perf', accent: BPG_TYPE_ACCENTS.perf, kindLabel: 'QTE' }
    default:
      return { typeClass: 'loop', accent: BPG_TYPE_ACCENTS.loop, kindLabel: '剧情' }
  }
}

export const BPG_LEGEND: { typeClass: BpgTypeClass; label: string }[] = [
  { typeClass: 'loop', label: '剧情 loop' },
  { typeClass: 'open', label: '选择' },
  { typeClass: 'perf', label: 'Boss / QTE' },
  { typeClass: 'root', label: '起点' },
  { typeClass: 'end', label: '结局' },
]
