/**
 * assignShotTimecodes —— 纯函数：把一组分镜按 durationSec 占比铺到场景时间轴上，
 * 写定每个 shot 的 startMs / endMs，让时间轴站位条长度反映导演节奏。
 *
 * 设计：
 *   - 权重 = shot.durationSec（>0）；缺省/非法的 shot 用「已知 durationSec 的均值」
 *     兜底（全都缺省时退化为等分），保证任意输入都能得到单调、铺满整段的区间。
 *   - 首镜 startMs=0；末镜 endMs 强制 = sceneDurationMs，消除取整误差累积，
 *     保证站位条正好铺满（与 Timeline.shotSpan 的回落均分语义一致但更精确）。
 *   - 区间单调不减；取整到整数毫秒。零长度场景按 1ms 兜底避免除零。
 *
 * 与 Timeline.shotSpan 的关系：shotSpan 在 shot 未填 startMs/endMs 时按 order 等分；
 * 本函数显式写入后，shotSpan 会优先用显式值，于是站位条按节奏分布。
 */

import type { Shot } from '../scenario/types'

export function assignShotTimecodes(shots: Shot[], sceneDurationMs: number): Shot[] {
  const n = shots.length
  if (n === 0) return []
  const total = Math.max(1, Math.round(sceneDurationMs))

  const rawWeights = shots.map((s) =>
    typeof s.durationSec === 'number' && s.durationSec > 0 ? s.durationSec : 0,
  )
  const present = rawWeights.filter((w) => w > 0)
  const fallback =
    present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : 1
  const eff = rawWeights.map((w) => (w > 0 ? w : fallback))
  const sum = eff.reduce((a, b) => a + b, 0) || n

  let cum = 0
  let prevEnd = 0
  return shots.map((shot, i) => {
    const startMs = prevEnd
    cum += eff[i] ?? 0
    const endMs =
      i === n - 1 ? total : Math.min(total, Math.max(startMs, Math.round((cum / sum) * total)))
    prevEnd = endMs
    return { ...shot, startMs, endMs }
  })
}
