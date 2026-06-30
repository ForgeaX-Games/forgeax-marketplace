import type {
  AdjustClip,
  AdjustParams,
  Branch,
  DialogueLine,
  EffectClip,
  FilterClip,
  MinigameClip,
  QTECue,
  SearchSegmentClip,
  StickerClip,
  TextOverlayClip,
} from '../../scenario/types'
import { clampMs } from './timelineMath'

/**
 * 时间轴右键菜单 · "插入 / 复制"动作的工厂函数
 *
 * 全部纯函数：
 *   - 输入：光标对应的 ms + 场景时长（+ 必要的目标场景 id）
 *   - 输出：新建好的 DialogueLine / QTECue / Branch（含唯一 id 和合理默认值）
 *   - 不变副作用：店里改谁、放哪个集合，由调用方决定
 *
 * 默认值的设计目标：
 *   - 落点 = 光标实际位置（绝不"偷偷偏移光标"）
 *   - 时长 / 提前量 = 让作者一眼就能看到、又不用立刻调
 *   - 撞边界时尾部夹紧，头部不动（保持光标对应的"主点位"）
 */

const DIALOGUE_DEFAULT_DURATION = 1500
/**
 * 新建 cue 时 `appearAt` 比 `targetAt` 提前多少毫秒——即"提示飞入命中圈"的总时长。
 *
 * 设计取值：1500ms。
 *   - 人类平均视觉反应 ~250ms；加上识别形状/位置 + 抬手到屏幕中央，
 *     稳点需要 ~700ms 余量；
 *   - 互动影游不是音游，不鼓励"贴线点"，留足提前期让玩家**看清再点**，
 *     比极致硬核更重要；
 *   - 想做硬核窗口的作者仍可在时间轴上手动缩短 leadIn。
 *
 * 历史：原值 300ms —— 对音游正常，但拖进剧情里几乎必 MISS（叠加命中窗一起算，
 * 从刚出现到过窗口总共 ~580ms，人根本反应不过来）。
 */
const CUE_DEFAULT_LEAD_IN = 1500

export interface InsertOpts {
  ms: number
  sceneDurationMs: number
}

export interface InsertBranchOpts extends InsertOpts {
  defaultTargetSceneId: string
}

export function makeInsertDialogue(opts: InsertOpts): DialogueLine {
  const minStart = 0
  // 给 endMs 留至少 100ms 余量，避免 start = duration 时 end 比 start 还小
  const maxStart = Math.max(0, opts.sceneDurationMs - 100)
  const startMs = clampMs(opts.ms, minStart, maxStart)
  const endMs = clampMs(
    startMs + DIALOGUE_DEFAULT_DURATION,
    startMs + 100,
    opts.sceneDurationMs,
  )
  return {
    id: makeId('d'),
    role: 'narration',
    text: '新台词',
    startMs,
    endMs,
  }
}

export function makeInsertCue(opts: InsertOpts): QTECue {
  const targetAt = clampMs(opts.ms, 0, opts.sceneDurationMs)
  const appearAt = clampMs(targetAt - CUE_DEFAULT_LEAD_IN, 0, targetAt)
  return {
    id: makeId('q'),
    shape: 'tap',
    x: 0.5,
    y: 0.5,
    appearAt,
    targetAt,
    label: undefined,
  }
}

export function makeInsertBranch(opts: InsertBranchOpts): Branch {
  const showAt = clampMs(opts.ms, 0, opts.sceneDurationMs)
  return {
    id: makeId('b'),
    kind: 'choice',
    label: '新选项',
    targetSceneId: opts.defaultTargetSceneId,
    showAt,
  }
}

export interface InsertMinigameOpts extends InsertOpts {
  minigameId: string
  defaultDurationMs: number
  label?: string
}

export function makeInsertMinigame(opts: InsertMinigameOpts): MinigameClip {
  const startMs = clampMs(opts.ms, 0, Math.max(0, opts.sceneDurationMs - 100))
  // 块视觉宽度尽量完整，但不超过场景尾部
  const durationMs = Math.max(
    500,
    Math.min(opts.defaultDurationMs, opts.sceneDurationMs - startMs),
  )
  return {
    id: makeId('mg'),
    minigameId: opts.minigameId,
    startMs,
    durationMs,
    label: opts.label,
  }
}

const TEXT_OVERLAY_DEFAULT_DURATION = 2500

export interface InsertTextOverlayOpts extends InsertOpts {
  text?: string
  defaultDurationMs?: number
}

export function makeInsertTextOverlay(opts: InsertTextOverlayOpts): TextOverlayClip {
  const maxStart = Math.max(0, opts.sceneDurationMs - 100)
  const startMs = clampMs(opts.ms, 0, maxStart)
  const dur = opts.defaultDurationMs ?? TEXT_OVERLAY_DEFAULT_DURATION
  const endMs = clampMs(startMs + dur, startMs + 100, opts.sceneDurationMs)
  return {
    id: makeId('tx'),
    text: opts.text ?? '双击编辑文字',
    startMs,
    endMs,
    x: 0.5,
    y: 0.5,
    fontSizePct: 7,
    scale: 1,
    rotation: 0,
    fontWeight: 700,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 3,
    align: 'center',
    shadow: true,
    opacity: 1,
  }
}

const SEARCH_SEGMENT_DEFAULT_DURATION = 4000

export interface InsertSearchSegmentOpts extends InsertOpts {
  label?: string
  defaultDurationMs?: number
}

export function makeInsertSearchSegment(opts: InsertSearchSegmentOpts): SearchSegmentClip {
  const maxStart = Math.max(0, opts.sceneDurationMs - 100)
  const startMs = clampMs(opts.ms, 0, maxStart)
  const dur = opts.defaultDurationMs ?? SEARCH_SEGMENT_DEFAULT_DURATION
  const endMs = clampMs(startMs + dur, startMs + 500, opts.sceneDurationMs)
  return {
    id: makeId('ss'),
    startMs,
    endMs,
    loopStartMs: startMs,
    loopEndMs: endMs,
    completeWhen: 'all',
    allowSkip: false,
    label: opts.label,
  }
}

// ─── v8 · 后期效果 clip 工厂 ──────────────────────────────────────
const FX_DEFAULT_DURATION = 3000

function spanFromMs(opts: InsertOpts, dur: number): { startMs: number; endMs: number } {
  const maxStart = Math.max(0, opts.sceneDurationMs - 100)
  const startMs = clampMs(opts.ms, 0, maxStart)
  const endMs = clampMs(startMs + dur, startMs + 100, opts.sceneDurationMs)
  return { startMs, endMs }
}

export function makeInsertFilterClip(
  opts: InsertOpts & { presetId: string; defaultDurationMs?: number },
): FilterClip {
  const { startMs, endMs } = spanFromMs(opts, opts.defaultDurationMs ?? FX_DEFAULT_DURATION)
  return { id: makeId('flt'), startMs, endMs, presetId: opts.presetId, intensity: 1 }
}

export function makeInsertAdjustClip(
  opts: InsertOpts & { params?: AdjustParams; defaultDurationMs?: number },
): AdjustClip {
  const { startMs, endMs } = spanFromMs(opts, opts.defaultDurationMs ?? FX_DEFAULT_DURATION)
  return { id: makeId('adj'), startMs, endMs, params: opts.params ?? {} }
}

export function makeInsertEffectClip(
  opts: InsertOpts & { presetId: string; defaultDurationMs?: number },
): EffectClip {
  const { startMs, endMs } = spanFromMs(opts, opts.defaultDurationMs ?? FX_DEFAULT_DURATION)
  return { id: makeId('efx'), startMs, endMs, presetId: opts.presetId, intensity: 1 }
}

export function makeInsertStickerClip(
  opts: InsertOpts & {
    stickerKind: StickerClip['kind']
    text?: string
    presetId?: string
    mediaId?: string
    defaultDurationMs?: number
  },
): StickerClip {
  const { startMs, endMs } = spanFromMs(opts, opts.defaultDurationMs ?? FX_DEFAULT_DURATION)
  return {
    id: makeId('stk'),
    startMs,
    endMs,
    kind: opts.stickerKind,
    text: opts.text,
    presetId: opts.presetId,
    mediaId: opts.mediaId,
    x: 0.5,
    y: 0.4,
    sizePct: 12,
    scale: 1,
    rotation: 0,
    opacity: 1,
    enter: 'pop',
  }
}

/**
 * 复制台词 —— 新 id + 同步偏移。
 *
 *   offset > 0 → 紧跟原台词后面，撞墙时贴右边
 *   offset = 0 → 同位置叠放（少见，但保留语义；只换 id）
 *   endMs 缺省 → 不创造 endMs；只移 startMs
 */
export function duplicateDialogue(
  src: DialogueLine,
  offsetMs: number,
  sceneDurationMs: number,
): DialogueLine {
  const id = makeId('d')
  if (offsetMs === 0) {
    return { ...src, id }
  }
  if (src.endMs === undefined) {
    const startMs = clampMs(src.startMs + offsetMs, 0, sceneDurationMs)
    return { ...src, id, startMs }
  }
  const span = src.endMs - src.startMs
  const minStart = 0
  const maxStart = Math.max(0, sceneDurationMs - span)
  const startMs = clampMs(src.startMs + offsetMs, minStart, maxStart)
  const endMs = startMs + span
  return { ...src, id, startMs, endMs }
}

/**
 * 紧凑随机 id —— 走 Math.random + 时间，前缀按域分（d/q/b/c/...）。
 * 6 位足够单场景内防碰，碰撞概率 36^6 = 21亿分之一。
 */
function makeId(prefix: string): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${t}${r}`
}
