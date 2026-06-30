/**
 * fxPresets —— 剪映式后期效果的「内置预设表」与「合成函数」。
 *
 * 设计：所有效果都是预览/播放期实时渲染，不重编码 mp4。
 *   · 滤镜 + 调节 → 合成一段 CSS `filter` 串作用到画面元素
 *   · 暗角 / 颗粒 → 叠层（CSS filter 表达不了）
 *   · 特效 → 叠层动效（光效/抖动/马赛克/故障/暗角脉冲）
 *   · 贴纸 → 画面元素（数值花字/图标/emoji/图片）
 *   · 转场 / 首尾动画 → 节点级，按 elapsed 在画面边界跑入/出动画
 *
 * 该模块为纯函数 + 静态表，编辑器与播放器共用，便于"预览=成片"。
 */
import type {
  AdjustParams,
  ClipAnimSpec,
  Scene,
  Shot,
  StickerClip,
} from '../scenario/types'

// ─────────────────────────────────────────────────────────────────────
// 预设表
// ─────────────────────────────────────────────────────────────────────

export interface FilterPreset {
  id: string
  label: string
  params: AdjustParams
}

/** 内置滤镜：每个 = 一组 AdjustParams 包，强度 0~1 线性缩放。 */
export const FX_FILTERS: FilterPreset[] = [
  { id: 'clear', label: '清透感', params: { brightness: 0.06, contrast: 0.08, saturation: 0.18 } },
  { id: 'cinema', label: '浓郁电影感', params: { contrast: 0.22, saturation: -0.1, temperature: 0.18, vignette: 0.3 } },
  { id: 'warmSun', label: '暖阳', params: { brightness: 0.05, temperature: 0.5, saturation: 0.1 } },
  { id: 'night', label: '夜景增色', params: { brightness: -0.08, contrast: 0.16, temperature: -0.4, saturation: 0.12 } },
  { id: 'retroFilm', label: '复古胶片', params: { sepia: 0.35, contrast: 0.1, saturation: -0.18, grain: 0.35, vignette: 0.25 } },
  { id: 'mono', label: '黑白', params: { saturation: -1, contrast: 0.14 } },
  { id: 'tealOrange', label: '青橙大片', params: { temperature: 0.22, contrast: 0.16, saturation: 0.2, hue: -8 } },
  { id: 'fade', label: '褪色文艺', params: { contrast: -0.12, saturation: -0.2, brightness: 0.06 } },
]

export interface EffectPreset {
  id: string
  label: string
  /** 渲染类型：overlay=叠层动效；shake=画面抖动；mosaic=马赛克模糊；vignettePulse=暗角脉冲。 */
  kind: 'lightLeak' | 'shake' | 'mosaic' | 'glitch' | 'vignettePulse' | 'bokeh'
}

export const FX_EFFECTS: EffectPreset[] = [
  { id: 'lightLeak', label: '光效漏光', kind: 'lightLeak' },
  { id: 'shake', label: '镜头抖动', kind: 'shake' },
  { id: 'mosaic', label: '马赛克', kind: 'mosaic' },
  { id: 'glitch', label: '故障噪点', kind: 'glitch' },
  { id: 'vignettePulse', label: '暗角脉冲', kind: 'vignettePulse' },
  { id: 'bokeh', label: '梦幻虚化', kind: 'bokeh' },
]

export interface StickerPreset {
  id: string
  label: string
  /** 内置矢量图标用 emoji/字符近似（无需额外资源）。 */
  glyph: string
  /** 数值花字模板（kind=numeric 的快捷预设）。 */
  numericTemplate?: string
}

export const FX_STICKERS: StickerPreset[] = [
  { id: 'favPlus', label: '好感度+1', glyph: '❤', numericTemplate: '好感度 +1' },
  { id: 'scorePlus', label: '积分+10', glyph: '⭐', numericTemplate: '积分 +10' },
  { id: 'arrow', label: '箭头', glyph: '➤' },
  { id: 'pin', label: '定位', glyph: '📍' },
  { id: 'question', label: '问号', glyph: '❓' },
  { id: 'emphasis', label: '强调', glyph: '✦' },
  { id: 'thumbUp', label: '点赞', glyph: '👍' },
  { id: 'spark', label: '闪光', glyph: '✨' },
]

export interface TransitionPreset {
  id: string
  label: string
  defaultDurationMs: number
}

export const FX_TRANSITIONS: TransitionPreset[] = [
  { id: 'flashBlack', label: '闪黑', defaultDurationMs: 500 },
  { id: 'flashWhite', label: '闪白', defaultDurationMs: 400 },
  { id: 'dissolve', label: '叠化', defaultDurationMs: 700 },
  { id: 'pushIn', label: '推近', defaultDurationMs: 600 },
  { id: 'slideLeft', label: '左移', defaultDurationMs: 600 },
  { id: 'zoomBlur', label: '变焦模糊', defaultDurationMs: 600 },
]

export interface ClipAnimPreset {
  id: string
  label: string
  /** 适用端：in=入场, out=出场, both=两端皆可。 */
  end: 'in' | 'out' | 'both'
}

export const FX_CLIP_ANIM: ClipAnimPreset[] = [
  { id: 'fade', label: '渐显/渐隐(黑底)', end: 'both' },
  { id: 'fadeWhite', label: '渐显/渐隐(白底)', end: 'both' },
  { id: 'zoomIn', label: '放大进入', end: 'in' },
  { id: 'zoomOut', label: '缩小退出', end: 'out' },
  { id: 'slideIn', label: '滑入', end: 'in' },
  { id: 'slideOut', label: '滑出', end: 'out' },
]

/**
 * 贴纸（花字）自身的入/出场动画预设。
 *
 * 与 FX_CLIP_ANIM（节点级画面首尾动画）不同：这套作用在**单个贴纸元素**上，
 * 通过 transform/opacity 在贴纸的 [startMs, startMs+IN] / [endMs-OUT, endMs] 区间
 * 内做弹入/淡入/滑动等微动效（见 stickerAnimAt）。preset id 存进 StickerClip.enter/exit。
 */
export interface StickerAnimPreset {
  id: string
  label: string
}
export const FX_STICKER_ANIM_IN: StickerAnimPreset[] = [
  { id: 'pop', label: '弹入' },
  { id: 'fade', label: '淡入' },
  { id: 'zoomIn', label: '放大入' },
  { id: 'slideUp', label: '上滑入' },
  { id: 'slideDown', label: '下滑入' },
]
export const FX_STICKER_ANIM_OUT: StickerAnimPreset[] = [
  { id: 'fade', label: '淡出' },
  { id: 'pop', label: '弹出' },
  { id: 'zoomOut', label: '缩小出' },
  { id: 'slideUp', label: '上滑出' },
  { id: 'slideDown', label: '下滑出' },
]

/** 贴纸入/出场动画默认时长（ms）—— 固定值，UI 不暴露，保持极简。 */
export const STICKER_ANIM_IN_MS = 450
export const STICKER_ANIM_OUT_MS = 380

// ─────────────────────────────────────────────────────────────────────
// 查表辅助
// ─────────────────────────────────────────────────────────────────────

export function getFilterPreset(id: string): FilterPreset | undefined {
  return FX_FILTERS.find((p) => p.id === id)
}
export function getEffectPreset(id: string): EffectPreset | undefined {
  return FX_EFFECTS.find((p) => p.id === id)
}
export function getStickerPreset(id: string): StickerPreset | undefined {
  return FX_STICKERS.find((p) => p.id === id)
}
export function getTransitionPreset(id: string): TransitionPreset | undefined {
  return FX_TRANSITIONS.find((p) => p.id === id)
}

// ─────────────────────────────────────────────────────────────────────
// 参数合成
// ─────────────────────────────────────────────────────────────────────

const PARAM_KEYS: (keyof AdjustParams)[] = [
  'brightness', 'contrast', 'saturation', 'temperature', 'hue', 'blur', 'vignette', 'grain', 'sepia',
]

/** 把多组 AdjustParams 的同名项求和（每组可先按强度缩放）。 */
export function mergeParams(list: AdjustParams[]): AdjustParams {
  const out: AdjustParams = {}
  for (const p of list) {
    for (const k of PARAM_KEYS) {
      const v = p[k]
      if (typeof v === 'number') out[k] = (out[k] ?? 0) + v
    }
  }
  return out
}

function scaleParams(p: AdjustParams, k: number): AdjustParams {
  const out: AdjustParams = {}
  for (const key of PARAM_KEYS) {
    const v = p[key]
    if (typeof v === 'number') out[key] = v * k
  }
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** AdjustParams → CSS filter 串（不含暗角/颗粒，那两个走叠层）。 */
export function adjustToFilterCss(p: AdjustParams): string {
  const parts: string[] = []
  const b = p.brightness ?? 0
  const c = p.contrast ?? 0
  const s = p.saturation ?? 0
  const hue = p.hue ?? 0
  const blur = p.blur ?? 0
  const sepia = p.sepia ?? 0
  const temp = p.temperature ?? 0
  if (b) parts.push(`brightness(${clamp(1 + b, 0, 3).toFixed(3)})`)
  if (c) parts.push(`contrast(${clamp(1 + c, 0, 3).toFixed(3)})`)
  // 饱和度 + 色温（暖色额外提一点饱和；冷色用 hue-rotate 近似）
  const sat = clamp(1 + s, 0, 3)
  if (s) parts.push(`saturate(${sat.toFixed(3)})`)
  const sepiaTotal = clamp(sepia + Math.max(0, temp) * 0.5, 0, 1)
  if (sepiaTotal) parts.push(`sepia(${sepiaTotal.toFixed(3)})`)
  const hueTotal = hue + (temp < 0 ? temp * 30 : 0)
  if (hueTotal) parts.push(`hue-rotate(${hueTotal.toFixed(1)}deg)`)
  if (blur) parts.push(`blur(${clamp(blur * 12, 0, 24).toFixed(2)}px)`)
  return parts.join(' ')
}

// ─────────────────────────────────────────────────────────────────────
// 时间区间命中
// ─────────────────────────────────────────────────────────────────────

function inRange(ms: number, startMs: number, endMs: number): boolean {
  return ms >= startMs && ms <= endMs
}

export interface ActiveEffect {
  id: string
  preset: EffectPreset
  intensity: number
  /** 段内进度 0~1，做循环/脉冲动画用。 */
  t: number
}

export interface SceneFxFrame {
  /** 作用到画面元素的 CSS filter 串。 */
  filterCss: string
  /** 暗角强度 0~1（叠层）。 */
  vignette: number
  /** 颗粒强度 0~1（叠层）。 */
  grain: number
  /** 当前激活的叠层特效。 */
  effects: ActiveEffect[]
  /** 画面 wrapper 需要附加的 class（如抖动）。 */
  wrapperClass: string
}

/** 合成当前帧的画面级效果（滤镜/调节/暗角/颗粒/特效）。 */
export function composeSceneFx(scene: Scene, ms: number): SceneFxFrame {
  const paramList: AdjustParams[] = []
  let vignette = 0
  let grain = 0

  for (const f of scene.filterClips ?? []) {
    if (!inRange(ms, f.startMs, f.endMs)) continue
    const preset = getFilterPreset(f.presetId)
    if (!preset) continue
    const k = f.intensity ?? 1
    paramList.push(scaleParams(preset.params, k))
    vignette = Math.max(vignette, (preset.params.vignette ?? 0) * k)
    grain = Math.max(grain, (preset.params.grain ?? 0) * k)
  }
  for (const a of scene.adjustClips ?? []) {
    if (!inRange(ms, a.startMs, a.endMs)) continue
    paramList.push(a.params)
    vignette = Math.max(vignette, a.params.vignette ?? 0)
    grain = Math.max(grain, a.params.grain ?? 0)
  }

  const effects: ActiveEffect[] = []
  let wrapperClass = ''
  for (const e of scene.effectClips ?? []) {
    if (!inRange(ms, e.startMs, e.endMs)) continue
    const preset = getEffectPreset(e.presetId)
    if (!preset) continue
    const span = Math.max(1, e.endMs - e.startMs)
    const t = clamp((ms - e.startMs) / span, 0, 1)
    const intensity = e.intensity ?? 1
    effects.push({ id: e.id, preset, intensity, t })
    if (preset.kind === 'shake') wrapperClass = 'ks-fx-shake'
    if (preset.kind === 'vignettePulse') vignette = Math.max(vignette, 0.4 * intensity)
  }

  return {
    filterCss: adjustToFilterCss(mergeParams(paramList)),
    vignette: clamp(vignette, 0, 1),
    grain: clamp(grain, 0, 1),
    effects,
    wrapperClass,
  }
}

/** 当前激活的贴纸（按 ms 区间过滤）。 */
export function activeStickers(scene: Scene, ms: number): StickerClip[] {
  return (scene.stickerClips ?? []).filter((s) => inRange(ms, s.startMs, s.endMs))
}

/** 贴纸入/出场动画的当前帧偏移量（叠加到 stickerStyle 的基准 transform/opacity 上）。 */
export interface StickerAnimDelta {
  /** 透明度乘子 0~1。 */
  opacity: number
  /** 缩放乘子（在 c.scale 之上再乘）。 */
  scaleMul: number
  /** 额外平移（画面高度百分比，正=下移）。 */
  translateYPct: number
  /** 额外平移（画面宽度百分比，正=右移）。 */
  translateXPct: number
}

function easeOutBack(t: number): number {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/**
 * 计算贴纸在 ms 时刻的入/出场动画偏移。
 *
 * 入场：贴纸 startMs 起的前 STICKER_ANIM_IN_MS 内，按 preset 做弹入/淡入/滑入。
 * 出场：endMs 前 STICKER_ANIM_OUT_MS 内，按 preset 做淡出/缩小/滑出。
 * 两段都不命中时返回"完全显示"（opacity 1、无缩放、无位移）。
 * ms 省略（编辑器静态取用）时也返回完全显示，便于拖拽编辑时贴纸稳定可见。
 */
export function stickerAnimAt(c: StickerClip, ms?: number): StickerAnimDelta {
  const rest: StickerAnimDelta = { opacity: 1, scaleMul: 1, translateYPct: 0, translateXPct: 0 }
  if (ms == null) return rest

  // 入场
  if (c.enter) {
    const t = clamp((ms - c.startMs) / STICKER_ANIM_IN_MS, 0, 1)
    if (t < 1) {
      switch (c.enter) {
        case 'fade':
          return { ...rest, opacity: t }
        case 'pop':
          return { ...rest, opacity: clamp(t * 2, 0, 1), scaleMul: 0.3 + 0.7 * easeOutBack(t) }
        case 'zoomIn':
          return { ...rest, opacity: t, scaleMul: 0.6 + 0.4 * t }
        case 'slideUp':
          return { ...rest, opacity: t, translateYPct: (1 - t) * 12 }
        case 'slideDown':
          return { ...rest, opacity: t, translateYPct: -(1 - t) * 12 }
      }
    }
  }

  // 出场（p = 出场进度 0→1）
  if (c.exit) {
    const tFromEnd = clamp((c.endMs - ms) / STICKER_ANIM_OUT_MS, 0, 1)
    const p = 1 - tFromEnd
    if (p > 0) {
      switch (c.exit) {
        case 'fade':
          return { ...rest, opacity: 1 - p }
        case 'pop':
          return { ...rest, opacity: 1 - p, scaleMul: 1 - 0.7 * p }
        case 'zoomOut':
          return { ...rest, opacity: 1 - p, scaleMul: 1 - 0.4 * p }
        case 'slideUp':
          return { ...rest, opacity: 1 - p, translateYPct: -p * 12 }
        case 'slideDown':
          return { ...rest, opacity: 1 - p, translateYPct: p * 12 }
      }
    }
  }

  return rest
}

/** 转场进度：在 scene 开头 [0, durationMs] 内返回 0~1，否则 null。 */
export function transitionProgress(
  scene: Scene,
  ms: number,
): { presetId: string; t: number } | null {
  const tr = scene.transition
  if (!tr) return null
  const dur = Math.max(1, tr.durationMs)
  if (ms > dur) return null
  return { presetId: tr.presetId, t: clamp(ms / dur, 0, 1) }
}

export interface ClipAnimFrame {
  inPreset?: string
  /** 入场进度 0(刚开始)~1(完成)。 */
  inT: number
  outPreset?: string
  /** 出场进度 0(未开始)~1(完成)。 */
  outT: number
}

/**
 * 首尾动画状态：在 [spanStart, spanEnd] 这段「片段」内算入/出进度。
 *
 *   · 入场：相对 spanStart 起的前 in.durationMs
 *   · 出场：spanEnd 前 out.durationMs 内
 *
 * 多镜节点里每段视频各自传自己的 [startMs,endMs] + shot.clipAnim，做到「逐镜隔离」；
 * 单视频节点传 [0,durationMs] + scene.clipAnim 兜底。
 */
export function clipAnimState(
  spec: ClipAnimSpec | undefined,
  ms: number,
  spanStart: number,
  spanEnd: number,
): ClipAnimFrame {
  let inT = 1
  let outT = 0
  if (spec?.in) {
    const dur = Math.max(1, spec.in.durationMs)
    inT = clamp((ms - spanStart) / dur, 0, 1)
  }
  if (spec?.out) {
    const dur = Math.max(1, spec.out.durationMs)
    const start = spanEnd - dur
    outT = clamp((ms - start) / dur, 0, 1)
  }
  return { inPreset: spec?.in?.preset, inT, outPreset: spec?.out?.preset, outT }
}

/** 取带合法时间码（endMs>startMs）的 shots，按 startMs 升序。 */
function timedShots(scene: Scene): Shot[] {
  return (scene.shots ?? [])
    .filter(
      (s) =>
        Number.isFinite(s.startMs) &&
        Number.isFinite(s.endMs) &&
        (s.endMs as number) > (s.startMs as number),
    )
    .slice()
    .sort((a, b) => (a.startMs as number) - (b.startMs as number))
}

/** 在 ms 落点命中的当前镜（含其 [startMs,endMs] 与 clipAnim）。无 shots 时返回 null。 */
function activeShotAt(
  scene: Scene,
  ms: number,
): { startMs: number; endMs: number; clipAnim?: ClipAnimSpec } | null {
  const shots = timedShots(scene)
  if (shots.length === 0) return null
  for (const s of shots) {
    if (ms >= (s.startMs as number) && ms <= (s.endMs as number)) {
      return { startMs: s.startMs as number, endMs: s.endMs as number, clipAnim: s.clipAnim }
    }
  }
  // 落在镜间空隙 / 首镜前 / 末镜后:返回 null —— 空隙=留白(黑场),不在缝隙里硬挂某镜的
  // 首尾动画(过去就近取首/末镜,会让"剪出来的空档"被首尾动画的渐显渐隐糊上,违背
  // 作者的剪辑意图)。播放层在 null 时直接渲染黑场,与 Player/StagePane 的取镜逻辑一致。
  return null
}

// ─────────────────────────────────────────────────────────────────────
// 舞台整合：媒体元素的 filter+transform，与所有叠层描述（预览与播放器共用）
// ─────────────────────────────────────────────────────────────────────

export interface StageFxFrame {
  /** 应用到 <video>/<img> 的 CSS filter。 */
  mediaFilter: string
  /** 应用到 <video>/<img> 的 CSS transform（转场推近/首尾缩放滑动）。 */
  mediaTransform: string
  vignette: number
  grain: number
  effects: ActiveEffect[]
  wrapperClass: string
  /** 全屏纯色遮罩（闪黑/闪白/渐显渐隐），叠在媒体之上。 */
  fadeColor: string
  fadeOpacity: number
}

/** 综合本帧媒体应有的 filter/transform + 遮罩，供 StagePane / Player 直接消费。 */
export function composeStageFx(scene: Scene, ms: number, durationMs: number): StageFxFrame {
  const base = composeSceneFx(scene, ms)
  const transforms: string[] = []
  let fadeColor = '#000000'
  let fadeOpacity = 0

  // 转场（节点入场，[0, dur]）
  const tr = transitionProgress(scene, ms)
  if (tr) {
    const t = tr.t
    switch (tr.presetId) {
      case 'flashBlack':
      case 'dissolve':
        fadeColor = '#000000'
        fadeOpacity = Math.max(fadeOpacity, 1 - t)
        break
      case 'flashWhite':
        fadeColor = '#ffffff'
        fadeOpacity = Math.max(fadeOpacity, 1 - t)
        break
      case 'pushIn':
        transforms.push(`scale(${(1 + 0.15 * (1 - t)).toFixed(4)})`)
        break
      case 'zoomBlur':
        transforms.push(`scale(${(1 + 0.3 * (1 - t)).toFixed(4)})`)
        break
      case 'slideLeft':
        transforms.push(`translateX(${((1 - t) * 100).toFixed(2)}%)`)
        break
    }
  }

  // 镜间转场（剪映式两段衔接）：转场摆在「上一镜 → 本镜」的衔接点（本镜 startMs），
  // 峰值在衔接点。闪黑/闪白在衔接点全黑/全白，营造切镜过场。
  for (const sh of timedShots(scene)) {
    const tr = sh.transitionIn
    if (!tr) continue
    const dur = Math.max(1, tr.durationMs)
    const center = sh.startMs as number
    const half = dur / 2
    if (ms < center - half || ms > center + half) continue
    // 中点峰值曲线：边缘 0 → 衔接点 1。
    const peak = 1 - Math.abs((ms - center) / half)
    switch (tr.presetId) {
      case 'flashWhite':
        fadeColor = '#ffffff'
        fadeOpacity = Math.max(fadeOpacity, peak)
        break
      case 'pushIn':
        transforms.push(`scale(${(1 + 0.18 * peak).toFixed(4)})`)
        fadeColor = '#000000'
        fadeOpacity = Math.max(fadeOpacity, peak * 0.55)
        break
      case 'zoomBlur':
        transforms.push(`scale(${(1 + 0.32 * peak).toFixed(4)})`)
        fadeColor = '#000000'
        fadeOpacity = Math.max(fadeOpacity, peak * 0.5)
        break
      case 'slideLeft':
        transforms.push(`translateX(${(((ms - center) / half) * -15).toFixed(2)}%)`)
        fadeColor = '#000000'
        fadeOpacity = Math.max(fadeOpacity, peak * 0.5)
        break
      case 'flashBlack':
      case 'dissolve':
      default:
        fadeColor = '#000000'
        fadeOpacity = Math.max(fadeOpacity, peak)
        break
    }
  }

  // 首尾动画 —— 逐镜隔离：命中当前镜则用该镜的 [startMs,endMs] + shot.clipAnim；
  // 无 shots（单视频节点）才用 scene.clipAnim + 整段 [0,durationMs] 兜底。
  const shotSpan = activeShotAt(scene, ms)
  const caSpec = shotSpan ? shotSpan.clipAnim : scene.clipAnim
  const caStart = shotSpan ? shotSpan.startMs : 0
  const caEnd = shotSpan ? shotSpan.endMs : durationMs
  const ca = clipAnimState(caSpec, ms, caStart, caEnd)
  if (ca.inPreset && ca.inT < 1) {
    switch (ca.inPreset) {
      case 'fade':
        fadeColor = '#000000'
        fadeOpacity = Math.max(fadeOpacity, 1 - ca.inT)
        break
      case 'fadeWhite':
        fadeColor = '#ffffff'
        fadeOpacity = Math.max(fadeOpacity, 1 - ca.inT)
        break
      case 'zoomIn':
        transforms.push(`scale(${(0.8 + 0.2 * ca.inT).toFixed(4)})`)
        break
      case 'slideIn':
        transforms.push(`translateX(${((ca.inT - 1) * 30).toFixed(2)}%)`)
        break
    }
  }
  if (ca.outPreset && ca.outT > 0) {
    switch (ca.outPreset) {
      case 'fade':
        fadeColor = '#000000'
        fadeOpacity = Math.max(fadeOpacity, ca.outT)
        break
      case 'fadeWhite':
        fadeColor = '#ffffff'
        fadeOpacity = Math.max(fadeOpacity, ca.outT)
        break
      case 'zoomOut':
        transforms.push(`scale(${(1 - 0.2 * ca.outT).toFixed(4)})`)
        break
      case 'slideOut':
        transforms.push(`translateX(${(ca.outT * 30).toFixed(2)}%)`)
        break
    }
  }

  return {
    mediaFilter: base.filterCss,
    mediaTransform: transforms.join(' '),
    vignette: base.vignette,
    grain: base.grain,
    effects: base.effects,
    wrapperClass: base.wrapperClass,
    fadeColor,
    fadeOpacity: clamp(fadeOpacity, 0, 1),
  }
}
