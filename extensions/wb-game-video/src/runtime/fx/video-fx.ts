/**
 * video-fx —— 滤镜 / 特效的**纯解析层**（runtime-neutral，无 React / 无 DOM）。
 *
 * 单一职责：给定一个演出节点 + 当前播放头 ms，算出该时刻要施加到视频画面上的
 *   · `filter`    —— CSS `filter` 值（调色滤镜，kind='filter'）
 *   · `transform` —— CSS `transform` 值（震屏 / 变焦特效，kind='fx' 的 shake/zoom）
 *   · `overlays`  —— 覆盖在视频上的效果层（闪白 / 染色 / 暗角，kind='fx' 的 flash/tint/vignette）
 *
 * 数据模型零新增字段：滤镜/特效就是 `node.data.timeline[]` 里 `kind:'filter'|'fx'` 的
 * TimelineElement，用 `window`(起止) + `layer`(叠放) + `params`(预设/强度/色)。
 *
 * 编辑器预览（GraphVideoView）现在直接用本模块把效果画出来；运行时 Player 侧（P2）
 * 可原样复用同一解析——两边同源，互不写对方文件。
 */
import type { GameNode, TimelineElement } from '../schema/graph-schema'

// ── 通用小工具 ────────────────────────────────────────────────────────────────
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * clamp01(t)
}
function round(v: number, d = 3): number {
  const p = 10 ** d
  return Math.round(v * p) / p
}

// ── 滤镜预设（调色）──────────────────────────────────────────────────────────
export interface FilterPreset {
  id: string
  label: string
  /** 强度 I∈[0,1] → CSS filter 值（I=0 应≈原图）。 */
  css: (intensity: number) => string
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', label: '无', css: () => '' },
  { id: 'grayscale', label: '黑白', css: (i) => `grayscale(${round(i)})` },
  { id: 'sepia', label: '怀旧', css: (i) => `sepia(${round(i)})` },
  {
    id: 'warm',
    label: '暖调',
    css: (i) => `sepia(${round(0.3 * i)}) saturate(${round(lerp(1, 1.35, i))}) brightness(${round(lerp(1, 1.05, i))}) hue-rotate(${round(-8 * i, 1)}deg)`,
  },
  {
    id: 'cool',
    label: '冷调',
    css: (i) => `saturate(${round(lerp(1, 1.15, i))}) contrast(${round(lerp(1, 1.05, i))}) brightness(${round(lerp(1, 0.98, i))}) hue-rotate(${round(-16 * i, 1)}deg)`,
  },
  { id: 'noir', label: '黑色电影', css: (i) => `grayscale(1) contrast(${round(lerp(1, 1.5, i))}) brightness(${round(lerp(1, 0.92, i))})` },
  { id: 'vivid', label: '鲜艳', css: (i) => `saturate(${round(lerp(1, 1.7, i))}) contrast(${round(lerp(1, 1.15, i))})` },
  { id: 'dream', label: '梦幻', css: (i) => `brightness(${round(lerp(1, 1.1, i))}) saturate(${round(lerp(1, 1.25, i))}) blur(${round(1.2 * i, 2)}px)` },
]
const FILTER_BY_ID = new Map(FILTER_PRESETS.map((p) => [p.id, p]))
export const FILTER_OPTIONS = FILTER_PRESETS.map((p) => ({ value: p.id, label: p.label }))

// ── 特效预设 ──────────────────────────────────────────────────────────────────
export type FxKindId = 'flash' | 'tint' | 'vignette' | 'shake' | 'zoom'
export interface FxPreset {
  id: FxKindId
  label: string
  /** 是否需要一个颜色参数（flash/tint 用）。 */
  color?: boolean
  defaultColor?: string
}
export const FX_PRESETS: FxPreset[] = [
  { id: 'flash', label: '闪白/闪光', color: true, defaultColor: '#ffffff' },
  { id: 'tint', label: '染色', color: true, defaultColor: '#ff5533' },
  { id: 'vignette', label: '暗角' },
  { id: 'shake', label: '震屏' },
  { id: 'zoom', label: '变焦冲击' },
]
export const FX_OPTIONS = FX_PRESETS.map((p) => ({ value: p.id, label: p.label }))
export function fxNeedsColor(fx: string | undefined): boolean {
  return FX_PRESETS.find((p) => p.id === fx)?.color ?? false
}

// ── 解析结果 ──────────────────────────────────────────────────────────────────
/** 一个覆盖在视频上的效果层；`style` 为可直接铺给 DOM 的属性袋（背景/混合/透明度）。 */
export interface FxOverlay {
  id: string
  style: Record<string, string | number>
}
export interface VideoFxRender {
  /** 施加到 <video> 的 CSS filter（多个 filter 元素叠加）。 */
  filter?: string
  /** 施加到 <video> 的 CSS transform（震屏 + 变焦叠加）。 */
  transform?: string
  /** 覆盖层（闪白/染色/暗角），按 layer 升序。 */
  overlays: FxOverlay[]
}

function winStart(el: TimelineElement): number {
  return el.window?.startMs ?? 0
}
function winEnd(el: TimelineElement, maxMs: number): number {
  return el.window?.endMs ?? maxMs
}
function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

/** 当前 ms 下、该节点视频要施加的滤镜/特效渲染指令。 */
export function resolveVideoFxRender(node: GameNode | undefined, ms: number, maxMs: number): VideoFxRender {
  if (!node) return { overlays: [] }
  const filters: string[] = []
  const transforms: string[] = []
  const overlays: Array<{ layer: number; ov: FxOverlay }> = []

  for (const el of node.data.timeline) {
    const start = winStart(el)
    const end = winEnd(el, maxMs)
    if (ms < start || ms > end) continue
    const layer = num(el.layer, 0)

    if (el.kind === 'filter') {
      const preset = FILTER_BY_ID.get((el.params.filter as string) ?? 'warm')
      const css = preset?.css(num(el.params.intensity, 1)) ?? ''
      if (css) filters.push(css)
      continue
    }
    if (el.kind !== 'fx') continue

    const fx = (el.params.fx as FxKindId) ?? 'flash'
    const intensity = clamp01(num(el.params.intensity, 1))
    const color = (el.params.color as string) || FX_PRESETS.find((p) => p.id === fx)?.defaultColor || '#ffffff'
    const span = Math.max(1, end - start)
    const progress = clamp01((ms - start) / span)

    if (fx === 'flash') {
      // 起点最亮，随 window 淡出。
      overlays.push({ layer, ov: { id: `fx:${el.id}`, style: { background: color, opacity: round(intensity * (1 - progress), 3) } } })
    } else if (fx === 'tint') {
      overlays.push({ layer, ov: { id: `fx:${el.id}`, style: { background: color, mixBlendMode: 'multiply', opacity: round(0.55 * intensity, 3) } } })
    } else if (fx === 'vignette') {
      const dark = round(0.85 * intensity, 3)
      overlays.push({
        layer,
        ov: { id: `fx:${el.id}`, style: { background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 52%, rgba(0,0,0,${dark}) 100%)`, opacity: 1 } },
      })
    } else if (fx === 'shake') {
      // 由 ms 派生的确定性抖动：拖播放头/播放都能看到，无需动画。
      const amp = 7 * intensity
      transforms.push(`translate(${round(Math.sin(ms / 38) * amp, 2)}px, ${round(Math.cos(ms / 31) * amp, 2)}px)`)
    } else if (fx === 'zoom') {
      // 起点冲击、随后回落。
      const env = 1 - progress
      transforms.push(`scale(${round(1 + 0.18 * intensity * env, 4)})`)
    }
  }

  return {
    filter: filters.length ? filters.join(' ') : undefined,
    transform: transforms.length ? transforms.join(' ') : undefined,
    overlays: overlays.sort((a, b) => a.layer - b.layer).map((o) => o.ov),
  }
}
