import type { Branch, DialogueLine, QTECue } from '../../scenario/types'
import type { SnapModifiers } from './timelineMath'

/**
 * 时间码 / 增量 / 吸附粒度的纯文字格式化 —— 给 HUD / 浮提用。
 * 不依赖任何 React 或 DOM；100% 可测。
 */

/** 把毫秒数格式化为人类时间码字符串 */
export function formatTimeCode(ms: number): string {
  const rounded = Math.round(ms)
  const sign = rounded < 0 ? '-' : ''
  const abs = Math.abs(rounded)
  if (abs < 60_000) {
    const sec = Math.floor(abs / 1000)
    const rem = abs % 1000
    return `${sign}${sec}.${pad3(rem)}s`
  }
  const totalSec = Math.floor(abs / 1000)
  const minutes = Math.floor(totalSec / 60)
  const seconds = totalSec % 60
  const remMs = abs % 1000
  return `${sign}${minutes}:${pad2(seconds)}.${pad3(remMs)}`
}

/**
 * 拖拽增量字符串："+125ms" / "-300ms" / "+1.250s"
 *
 *   - |delta| < 1000 → 显示 ms 单位
 *   - |delta| ≥ 1000 → 切到秒（保留 3 位小数）
 *   - 0 → "±0ms"（明确表达"未移动"）
 */
export function formatDelta(deltaMs: number): string {
  if (deltaMs === 0) return '±0ms'
  const abs = Math.abs(deltaMs)
  const sign = deltaMs > 0 ? '+' : '-'
  if (abs < 1000) {
    return `${sign}${abs}ms`
  }
  const sec = Math.floor(abs / 1000)
  const rem = abs % 1000
  return `${sign}${sec}.${pad3(rem)}s`
}

/** 修饰键 → 吸附粒度文字（HUD 用） */
export function describeSnapGrid(mods: SnapModifiers): string {
  if (mods.shift) return '10ms · Shift'
  if (mods.alt) return '500ms · Alt'
  return '100ms'
}

/**
 * 从 preview 数据抽出当前最相关的"关键时间"——用于 HUD 显示绝对时间码。
 *
 *   - dialogue：startMs（拖整体/左 handle）或 endMs（拖右 handle）
 *   - cue：targetAt（拖整体/目标点）；leadIn 拖动无关键时间 → null
 *   - branch：showAt
 *
 * 没有合适的 → 返回 null（HUD 退化只显示 delta）。
 */
/**
 * 跟 Timeline.tsx 里 Preview 形状兼容的最小契约 ——
 * 只读 `kind` 和 `patch` 两个字段，其余无关字段（id/deltaMs/modifiers）
 * 用 index signature 接住，避免上层每次都裁切。
 */
export interface PreviewLike {
  kind: 'dialogue' | 'cue' | 'branch'
  patch: Partial<DialogueLine> | Partial<QTECue> | Partial<Branch>
  [extra: string]: unknown
}

export function previewKeyTimeMs(p: PreviewLike): number | null {
  if (p.kind === 'dialogue') {
    const dp = p.patch as Partial<DialogueLine>
    if (typeof dp.startMs === 'number') return dp.startMs
    if (typeof dp.endMs === 'number') return dp.endMs
    return null
  }
  if (p.kind === 'cue') {
    const cp = p.patch as Partial<QTECue>
    if (typeof cp.targetAt === 'number') return cp.targetAt
    return null
  }
  if (p.kind === 'branch') {
    const bp = p.patch as Partial<Branch>
    if (typeof bp.showAt === 'number') return bp.showAt
    return null
  }
  return null
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
function pad3(n: number): string {
  if (n < 10) return `00${n}`
  if (n < 100) return `0${n}`
  return String(n)
}
