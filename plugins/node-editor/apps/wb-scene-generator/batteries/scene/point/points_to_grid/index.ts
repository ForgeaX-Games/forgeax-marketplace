/**
 * points_to_grid — 点列表栅格化为 01 mask。
 *
 * 输入一个 point2d 列表与一张区域网格，输出与区域同形状的 0/1 mask：
 * 凡是落在区域有效（非零）格、且命中点列表位置的格点标记为 1，其余为 0。
 * 坐标约定：x→列(col)、y→行(row)，四舍五入；越界或落在区域外（0 格）的点忽略。
 */
import { normalizePoints } from './normalize.ts'

export function pointsToGrid(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as number[][] | undefined
  if (!region || region.length === 0 || !Array.isArray(region[0]) || region[0].length === 0) {
    return { error: 'region is required and must be a non-empty grid' }
  }
  const rows = region.length
  const cols = region[0].length

  const points = normalizePoints(input.points)
  const mask: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0))

  for (const p of points) {
    const c = Math.round(p.x)
    const r = Math.round(p.y)
    if (r >= 0 && r < rows && c >= 0 && c < cols && region[r][c] !== 0) {
      mask[r][c] = 1
    }
  }

  return { mask }
}
