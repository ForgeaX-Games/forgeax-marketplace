// 💡 跨插件共享调色板
//
// 设计目标:同一图层 / 同一值 在不同视角下染同色,视觉连贯。
//
// 两种取色路径:
//   * colorForLayerIdx(idx)  —— 单值图层;按 layerIdx 从 LAYER_BASE_HUES 取色相
//   * colorForValue(value)   —— 多值图层中某个值;按值黄金角散列(同 render2d / threeScene 旧逻辑)
//
// 选中 / 子值降饱和 通过 ColorOpts 调饱和度 + 亮度,各插件遵循同一约定:
//   * editorSelected → success 绿(与 store.selectedEditorNodeIds 协议一致)
//   * selected       → accent 绿(layer 自己被选中)
//   * subDimmed      → 多值层中未选中的值,降到原色 50% 饱和

const GOLDEN_ANGLE = 137.508

/** 与 editor 主题对齐的基础色相;单值图层按 layerIdx % 12 取一种 */
export const LAYER_BASE_HUES = [
  0, 120, 240, 60, 180, 300, 30, 150, 270, 90, 210, 330,
] as const

export interface RGBA {
  r: number  // 0-255
  g: number
  b: number
  a: number  // 0-255
}

export interface ColorOpts {
  /** 在 LayersSidePanel / 画布点击选中(accent 绿) */
  selected?: boolean
  /** 编辑器画布选中(success 绿) */
  editorSelected?: boolean
  /** 多值层中未选中的子值,降饱和 */
  subDimmed?: boolean
  /** 整体不透明度系数(0-1),与上述 selected 状态独立 */
  alpha?: number
}

/** HSL → RGB(h ∈ [0, 360), s/l ∈ [0, 100]),返回 0-255 整数 */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sN = s / 100
  const lN = l / 100
  const c = (1 - Math.abs(2 * lN - 1)) * sN
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = lN - c / 2
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function applyOpts(h: number, opts?: ColorOpts): RGBA {
  let s = 70
  let l = 55
  if (opts?.editorSelected) {
    // success 绿(与 --color-success #3ECF6B 对齐)
    return { r: 62, g: 207, b: 107, a: Math.round(255 * (opts?.alpha ?? 1)) }
  }
  if (opts?.selected) {
    // accent 绿(柠檬绿,与 --color-accent #d4ff48 对齐)
    return { r: 212, g: 255, b: 72, a: Math.round(255 * (opts?.alpha ?? 1)) }
  }
  if (opts?.subDimmed) {
    s = 35
    l = 45
  }
  const { r, g, b } = hslToRgb(h, s, l)
  return { r, g, b, a: Math.round(255 * (opts?.alpha ?? 1)) }
}

/** 单值图层取色:按 layerIdx 从 LAYER_BASE_HUES 取一个色相 */
export function colorForLayerIdx(layerIdx: number, opts?: ColorOpts): RGBA {
  const h = LAYER_BASE_HUES[((layerIdx % LAYER_BASE_HUES.length) + LAYER_BASE_HUES.length) % LAYER_BASE_HUES.length]
  return applyOpts(h, opts)
}

/** 多值图层中某个值的取色:按值黄金角散列 */
export function colorForValue(value: number, opts?: ColorOpts): RGBA {
  const h = (value * GOLDEN_ANGLE) % 360
  return applyOpts(h, opts)
}

/** 把 RGBA 转成 CSS 字符串(stroke / fill 用) */
export function rgbaToCss(c: RGBA): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a / 255).toFixed(3)})`
}
