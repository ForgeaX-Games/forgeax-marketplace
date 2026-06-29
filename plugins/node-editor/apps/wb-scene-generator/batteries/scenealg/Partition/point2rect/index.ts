/**
 * point2rect — 区域内点生矩形。
 *
 * 输入一张 01 区域网格、一个采样 point2d 点，以及目标宽/高；在区域的"1"内寻找一个
 * 包含该点（点落在 0 上则取最近的 1 格）、完整落在区域内、中心尽量贴近该点、长宽尽量
 * 接近输入的矩形，放不下就缩小，输出与输入同形状、矩形处为 1 的新网格。区域全 0 时
 * 输出同形状全 0 网格。算法解耦在 rectFit.ts。
 */
import { fitRect, stampRect } from './rectFit.ts'

export function point2rect(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as number[][] | undefined
  if (!region || region.length === 0 || !Array.isArray(region[0]) || region[0].length === 0) {
    return { error: 'region is required and must be a non-empty grid' }
  }
  const rows = region.length
  const cols = region[0].length

  const point = input.point as { x?: unknown; y?: unknown } | null | undefined
  const px = Number(point?.x)
  const py = Number(point?.y)
  if (!Number.isFinite(px) || !Number.isFinite(py)) {
    return { error: 'point is required and must be a point2d {x,y}' }
  }

  const width = Number(input.width ?? 5)
  const height = Number(input.height ?? 5)

  const rect = fitRect({ region, px, py, width, height })
  if (!rect) {
    // 区域全 0：按约定输出同形状全 0 网格（无点）。
    return { outputGrid: Array.from({ length: rows }, () => new Array<number>(cols).fill(0)) }
  }
  return { outputGrid: stampRect(rows, cols, rect) }
}
