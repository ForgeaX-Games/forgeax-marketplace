import type { Scene } from '../scenario/types'

/**
 * computeEffectiveEndMs —— 场景"画面轨"的有效结束时间（ms）。
 *
 * 动机：作者粘进来的素材（主视频 + shots 上的关键帧/视频）可能只有 10s，
 * 而 scene.durationMs 默认 30s。原 Player 按 durationMs 等满才跳转/弹选项，
 * 用户要空坐 20s 盯着最后一帧。这个函数给出"所有画面类内容都播完了"
 * 的时刻，供 Player 提前 end。
 *
 * 范围（按作者 2026-05-01 的选择 A）：
 *   - 只看 shots[*].endMs（视频拖入时同步写，静态图 shot 不写 → 忽略）
 *   - 不算 dialogue / audio / QTE —— 它们不是"画面轨"
 *
 * 规则：
 *   1. 取所有 shot **同时有** 有限 startMs & endMs 且 endMs > startMs 的 endMs 最大值
 *   2. 找不到 → 回退到 scene.durationMs（保持空场景 / 老数据原行为）
 *   3. 结果夹在 [0, scene.durationMs] —— 不允许超出 scene 自己声明的总长，
 *      防止异常数据导致 Player 等比 durationMs 更久
 *
 * 返回值永远是 >= 0 的整数。
 */
export function computeEffectiveEndMs(scene: Scene): number {
  const total = Math.max(0, scene.durationMs | 0)
  const shots = scene.shots ?? []

  let maxEnd = -1
  for (const s of shots) {
    const start = typeof s.startMs === 'number' ? s.startMs : null
    const end = typeof s.endMs === 'number' ? s.endMs : null
    if (start == null || end == null) continue
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    if (end <= start) continue
    if (end > maxEnd) maxEnd = end
  }

  if (maxEnd < 0) return total

  if (maxEnd > total) return total
  if (maxEnd < 0) return 0
  return maxEnd
}
