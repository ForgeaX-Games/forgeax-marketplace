/**
 * QTE 键盘绑定纯函数
 *
 * 把"键盘事件 / 当前 cue 列表"映射成"应被点击的目标 cue"。
 * 不依赖 React，方便单测与跨上下文复用（编辑器 hover 演示也能借用）。
 *
 * ── 输入键 ───────────────────────────────────────────
 *   Space ( ) 或 Enter（外加 Edge/老 Firefox 才会发的 'Spacebar'）
 *   持有 Ctrl/Meta/Alt 时一律不命中（避免抢系统快捷键）
 *
 * ── 选 cue 策略 ──────────────────────────────────────
 *   live 集 = appearAt ≤ now ≤ targetAt + window.good 且未 resolved
 *   从 live 集里选 |targetAt − now| 最小的一只 cue（最近的目标）。
 *   没有 → null（呼叫方应忽略此次按键）
 */

import type { HitVerdict } from './QTEEngine'
import type { QTECue, QTEHitWindow } from '../scenario/types'

const QTE_KEYS = new Set([' ', 'Spacebar', 'Enter'])

/** 该键值是否属于 QTE 触发键。 */
export function isQTEKeyboardKey(key: string): boolean {
  return QTE_KEYS.has(key)
}

interface KeyEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/**
 * 该键盘事件是否构成有效的 QTE 触发。
 * 任何 Ctrl/Meta/Alt 组合都拒绝，避免误吞系统快捷键
 * （macOS Cmd-Space → Spotlight、Ctrl-Space → 输入法 等）。
 */
export function isQTEKeyEvent(e: KeyEventLike): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false
  return isQTEKeyboardKey(e.key)
}

/**
 * 在当前时刻 now，从 cues 里挑出"应该被键盘命中"的那只。
 * 没有可命中的 cue → null。
 */
export function pickKeyboardCue(
  cues: readonly QTECue[],
  verdicts: readonly HitVerdict[],
  window: QTEHitWindow,
  now: number,
): QTECue | null {
  const resolved = new Set(verdicts.map((v) => v.cueId))
  let best: QTECue | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const c of cues) {
    if (resolved.has(c.id)) continue
    if (now < c.appearAt) continue
    if (now > c.targetAt + window.good) continue
    const dist = Math.abs(c.targetAt - now)
    if (dist < bestDist) {
      bestDist = dist
      best = c
    }
  }
  return best
}
