import type { DialogueLine } from '../scenario/types'

/**
 * 字幕选择 + 显示策略 —— 纯函数。
 *
 * 在 DialogueBox 里裸写 if/else 不可测。这层把选择逻辑抽出来，
 * 让"哪一句台词此刻该显示在屏幕上"有契约。
 *
 * 关键不变量：
 *   - 同一时刻只显示一句（电影字幕惯例）
 *   - 多句重叠时取 startMs 最大的（最新写的覆盖最旧）
 *   - 已结束的 (elapsed > endMs) 不再显示
 *   - role=narration → 没有说话人前缀，显示风格更"叙事"
 *   - role=character/protagonist → 显示说话人名 + 冒号 + 内容
 */

export interface SubtitleView {
  /** 选中的原始台词；返回 null 表示这一刻应当无字幕 */
  line: DialogueLine | null
  /** 显示用说话人；narration 时为 null（不该渲染人名行） */
  speaker: string | null
  /** 是否旁白态（决定样式：italic / 颜色更弱） */
  isNarration: boolean
}

export function pickActiveLine(
  lines: DialogueLine[],
  elapsedMs: number,
): DialogueLine | null {
  let best: DialogueLine | null = null
  for (const l of lines) {
    if (l.startMs > elapsedMs) continue
    if (l.endMs != null && l.endMs < elapsedMs) continue
    if (!best || l.startMs > best.startMs) best = l
  }
  return best
}

/**
 * 决定如何显示当前活跃台词 —— UI 拿这个直接渲染。
 * 关键：narration 和 character 都返回；调用方根据 isNarration 上不同样式。
 *
 * 旧 bug 根因（用户反馈"场景描述没显示"）：DialogueBox 把"无 speaker"
 * 当成"该藏起来"——其实 narration 本就该作为字幕显示，只是不带说话人前缀。
 * 这个函数把规则收敛到一处，UI 只管样式。
 */
export function deriveSubtitleView(
  lines: DialogueLine[],
  elapsedMs: number,
): SubtitleView {
  const line = pickActiveLine(lines, elapsedMs)
  if (!line) {
    return { line: null, speaker: null, isNarration: false }
  }
  const isNarration = line.role === 'narration'
  if (isNarration) {
    return { line, speaker: null, isNarration: true }
  }
  // character / protagonist：speaker 字段优先；空则用 fallback 推断
  const speaker =
    (line.speaker?.trim() ?? '') ||
    (line.role === 'protagonist' ? '主角' : '???')
  return { line, speaker, isNarration: false }
}
