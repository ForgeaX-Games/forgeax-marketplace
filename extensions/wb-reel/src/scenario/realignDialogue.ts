/**
 * realignSceneDialogue —— 纯函数：把 `scene.dialogue` 的 startMs/endMs 重新对齐到
 * 分镜（shots）的时间轴上，解决「台词全挤在场景开头、和画面/视频完全错位」。
 *
 * 背景（为什么需要它）：
 *   - 剧本结构化时台词 startMs 用的是「200 + i*1500」的均匀兜底（promptForge.ts），
 *     和真实画面无关。
 *   - 拆分镜（storyboardQueueTrigger）把 scene.durationMs 重算成各镜时长之和、给每个
 *     shot 写了精确 startMs/endMs，但**完全不碰 scene.dialogue** —— 于是场景被拉长、
 *     台词却锁死在前几秒，时间轴 DIA 轨和播放器字幕双双错位。
 *
 * 对齐数据来源（拆分镜时已经备好）：
 *   - 每个 shot 的精确时间窗 startMs/endMs（assignShotTimecodes 写定）。
 *   - 每个 shot 的 dialogueText —— storyboard skill 已按说话人、按顺序把台词分配进对应镜，
 *     多句来回时每行「角色名：台词」。
 *
 * 算法（确定性，零额外 LLM 调用）：
 *   1. 解析每个有时间窗的 shot 的 dialogueText 成「角色名 + 台词」多行。
 *   2. 把解析出的行回匹配到 scene.dialogue（按归一化文本 + 说话人），保留原句 id/role/文字，
 *      只重写时间。
 *   3. 镜内按**字数占比**铺时间（带朗读速度下限 + 句间小停顿），顺序排开、不重叠、不超镜窗。
 *   4. 没被任何镜认领的台词（常见是旁白）按原顺序在相邻锚点之间线性插值补位，不丢句、不乱序。
 *   5. 没有任何镜命中（dialogueText 全空 / 无分镜窗）时，整体按字数占比铺满 scene.durationMs，
 *      至少不再全挤在开头。
 *
 * 不变量：startMs ≥ 0；endMs ≤ scene.durationMs；同一来源顺序单调不减。
 * 返回新的 DialogueLine[]（不可变；输入 dialogue 为空 / 无可对齐依据时按需回退）。
 */

import type { DialogueLine, Scene, Shot } from './types'

/** 中文朗读速度估计：每字约 240ms。 */
const MS_PER_CHAR = 240
/** 单句最短占用（哪怕一个字也给一点驻留时间）。 */
const MIN_LINE_MS = 700
/** 同一镜内相邻台词之间的小停顿。 */
const INTRA_GAP_MS = 120

interface TimedShot {
  startMs: number
  endMs: number
  order: number
  text: string
}

/** 「角色名：台词」前缀（中英文冒号都认；角色名限制 1~12 字，避免把整句吃进去）。 */
const SPEAKER_PREFIX = /^\s*([^：:]{1,12})[：:]\s*(.+)$/

interface ParsedLine {
  speaker?: string
  text: string
}

export function parseDialogueTextLine(raw: string): ParsedLine | null {
  const t = raw.trim()
  if (!t) return null
  const m = SPEAKER_PREFIX.exec(t)
  if (m && m[2] && m[2].trim()) {
    return { speaker: m[1]!.trim(), text: m[2]!.trim() }
  }
  return { text: t }
}

/** 归一化文本用于匹配：去空白、去常见引号、转小写。 */
function norm(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/[「」『』“”"'`]/g, '')
    .toLowerCase()
}

function charCount(s: string): number {
  return Array.from(s.trim()).length
}

function getTimedShots(scene: Scene): TimedShot[] {
  const shots = scene.shots ?? []
  const timed: TimedShot[] = []
  shots.forEach((shot: Shot, i) => {
    const { startMs, endMs } = shot
    if (
      typeof startMs === 'number' &&
      typeof endMs === 'number' &&
      Number.isFinite(startMs) &&
      Number.isFinite(endMs) &&
      endMs > startMs &&
      shot.dialogueText?.trim()
    ) {
      timed.push({
        startMs,
        endMs,
        order: typeof shot.order === 'number' ? shot.order : i,
        text: shot.dialogueText,
      })
    }
  })
  timed.sort((a, b) => a.startMs - b.startMs || a.order - b.order)
  return timed
}

/**
 * 把一组台词在 [gapStart, gapEnd] 区间里按字数占比顺序铺开。
 * 溢出则等比压缩；不足则保留估计时长、在区间内留白（说完留静默更自然）。
 */
function layoutRun(
  texts: string[],
  gapStart: number,
  gapEnd: number,
): { startMs: number; endMs: number }[] {
  const n = texts.length
  if (n === 0) return []
  const weights = texts.map((t) => Math.max(MIN_LINE_MS, charCount(t) * MS_PER_CHAR))
  const sum = weights.reduce((a, b) => a + b, 0)
  const totalGap = INTRA_GAP_MS * Math.max(0, n - 1)
  const avail = Math.max(1, gapEnd - gapStart)
  const budget = Math.max(1, avail - totalGap)
  const scale = sum > budget ? budget / sum : 1
  const gap = sum > budget ? 0 : INTRA_GAP_MS

  const out: { startMs: number; endMs: number }[] = []
  let cursor = gapStart
  for (let i = 0; i < n; i++) {
    const dur = Math.max(1, Math.round(weights[i]! * scale))
    const startMs = Math.round(cursor)
    const endMs = Math.min(gapEnd, startMs + dur)
    out.push({ startMs, endMs })
    cursor = endMs + gap
  }
  return out
}

export function realignSceneDialogue(scene: Scene): DialogueLine[] {
  const lines = scene.dialogue ?? []
  if (lines.length === 0) return lines

  const total = Math.max(1, Math.round(scene.durationMs || 0))
  const timedShots = getTimedShots(scene)

  // —— 1) 把分镜 dialogueText 的每一行回匹配到 scene.dialogue（按顺序贪心 + 归一化文本）——
  const matched = new Map<string, { startMs: number; endMs: number }>()
  const usedIds = new Set<string>()

  for (const shot of timedShots) {
    const parsed = shot.text
      .split('\n')
      .map(parseDialogueTextLine)
      .filter((p): p is ParsedLine => p !== null)
    if (parsed.length === 0) continue

    // 把解析行匹配到尚未用过的 scene.dialogue，得到本镜要排布的台词文本
    const slotTexts: string[] = []
    const slotIds: string[] = []
    for (const p of parsed) {
      const target = norm(p.text)
      const hit = lines.find(
        (d) =>
          !usedIds.has(d.id) &&
          (norm(d.text) === target ||
            (target.length >= 4 &&
              (norm(d.text).includes(target) || target.includes(norm(d.text))))),
      )
      if (hit) {
        usedIds.add(hit.id)
        slotIds.push(hit.id)
        slotTexts.push(hit.text)
      } else {
        // 没匹配到原句（模型改写了文字）：仍占一个槽，用解析文本估时，但不写回某条 id
        slotIds.push('')
        slotTexts.push(p.text)
      }
    }

    const layout = layoutRun(slotTexts, shot.startMs, shot.endMs)
    layout.forEach((t, i) => {
      const id = slotIds[i]
      if (id) matched.set(id, t)
    })
  }

  // —— 2) 没有任何镜命中：整体按字数占比铺满 scene.durationMs（至少不再全挤在开头）——
  if (matched.size === 0) {
    const layout = layoutRun(
      lines.map((d) => d.text),
      0,
      total,
    )
    return lines.map((d, i) => ({
      ...d,
      startMs: layout[i]!.startMs,
      endMs: layout[i]!.endMs,
    }))
  }

  // —— 3) 未匹配台词在相邻锚点之间线性插值补位（按原顺序，保持单调）——
  const times: ({ startMs: number; endMs: number } | null)[] = lines.map(
    (d) => matched.get(d.id) ?? null,
  )

  let i = 0
  while (i < lines.length) {
    if (times[i]) {
      i++
      continue
    }
    // 收集一段连续的 null
    let j = i
    while (j < lines.length && !times[j]) j++
    const leftAnchor = i > 0 ? times[i - 1] : null
    const rightAnchor = j < lines.length ? times[j] : null
    const gapStart = leftAnchor ? leftAnchor.endMs : 0
    const gapEnd = rightAnchor ? rightAnchor.startMs : total
    const safeEnd = Math.max(gapStart + 1, gapEnd)
    const layout = layoutRun(
      lines.slice(i, j).map((d) => d.text),
      gapStart,
      safeEnd,
    )
    for (let k = i; k < j; k++) times[k] = layout[k - i]!
    i = j
  }

  return lines.map((d, idx) => {
    const t = times[idx]!
    const startMs = Math.max(0, Math.min(total, t.startMs))
    const endMs = Math.max(startMs + 1, Math.min(total, t.endMs))
    return { ...d, startMs, endMs }
  })
}
