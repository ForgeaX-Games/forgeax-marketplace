/**
 * 材料时间轴 —— 视频 tab 与剧情树抽屉共享的时间轴层的纯工具 + 类型 + 常量。
 *
 * 这里只放**无 React / 无 DOM 副作用**的东西：材料模型、轨道/缩放几何、刻度生成、
 * 分类样式映射。`<MaterialTimeline>`（渲染 + 交互）与 `CatalogTabs`（收集材料 +
 * patch 回写 scenario）都从这里取，避免两处各持一份定义漂移，也避免组件与其宿主
 * 互相 import 造成的循环依赖。
 */

/** 时间轴上一段可编辑材料的种类。 */
export type MaterialKind = 'subtitle' | 'overlay' | 'qte' | 'option'

/** 时间轴上的一段材料（由 scene 派生，见 CatalogTabs.collectMaterials）。 */
export interface MaterialItem {
  key: string
  id: string
  kind: MaterialKind
  label: string
  startMs: number
  endMs: number
  layer: number
  /** 段内的一个「判定点」标记（当前仅 QTE 用：= cue.targetAt 计分锚点）；缺省无标记。 */
  markerMs?: number
}

export const TIMELINE_RULER_H = 24
export const TIMELINE_LAYER_TOP = 34
export const TIMELINE_LAYER_STEP = 34
// 存储硬上限（防脏数据爆表）；可见轨数是「无限」的，由数据 + 一条空投放轨动态派生。
export const TIMELINE_MAX_LAYER = 15
// 空节点默认展示的轨数（0..MIN-1）。
export const TIMELINE_MIN_TRACKS = 5
export const ZOOM_MIN = 1
export const ZOOM_MAX = 20

export function fmtDur(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function clampMs(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.round(v)))
}

export function clampLayer(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(TIMELINE_MAX_LAYER, Math.round(v)))
}

export function clampZoom(v: number): number {
  if (!Number.isFinite(v)) return ZOOM_MIN
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v))
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

export function normalizeLayer(v: number | undefined, fallback: number): number {
  if (v == null) return fallback
  // 兼容更早的 10/20/30 档位默认值（仅精确的整十值才当旧格式，避免误伤高轨号）。
  if (v === 10 || v === 20 || v === 30 || v === 40) return clampLayer(v / 10 - 1)
  return clampLayer(v)
}

export function layerFromPointerY(clientY: number, rect: DOMRect, maxLayer: number): number {
  const y = clientY - rect.top - TIMELINE_RULER_H
  const raw = Math.round((y - (TIMELINE_LAYER_TOP - TIMELINE_RULER_H)) / TIMELINE_LAYER_STEP)
  return Math.max(0, Math.min(maxLayer, raw))
}

export function layerTop(layer: number): number {
  return TIMELINE_LAYER_TOP + Math.max(0, layer) * TIMELINE_LAYER_STEP
}

/** ruler 刻度：按缩放挑一个「整」间隔，保证相邻刻度像素间距足够读。 */
export function buildMaterialTicks(maxMs: number, pxPerMs: number): Array<{ ms: number; label: string }> {
  if (!(pxPerMs > 0) || !(maxMs > 0)) return []
  const targetPx = 84
  const rawMs = targetPx / pxPerMs
  const nice = [100, 200, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000]
  const step = nice.find((n) => n >= rawMs) ?? 120000
  const out: Array<{ ms: number; label: string }> = []
  for (let t = 0; t <= maxMs + 1; t += step) out.push({ ms: t, label: fmtDur(t) })
  return out
}

export function materialLabel(kind: MaterialKind): string {
  switch (kind) {
    case 'subtitle':
      return '字幕'
    case 'overlay':
      return '飘字'
    case 'qte':
      return 'QTE 按键点'
    case 'option':
      return '选项'
  }
}

export function materialDisplayLabel(item: Pick<MaterialItem, 'kind' | 'key'>): string {
  return materialLabel(item.kind)
}

/**
 * 该材料能否从时间轴直接删除。
 * 可删：字幕 / 结算飘字 / QTE 按键点（各自是独立子项）。
 * 选项：删「整条选项交互」= 抹掉 scene.choice + choice 分支，节点回落为叙事并自动续连到
 *   第一个选项原本的目标（applyMaterialDelete 处理）；因是破坏式改连接，删除前需二次确认。
 * QTE：删最后一个 QTE 按键点 = 删「整段 QTE 交互」（抹掉 scene.qte + qte_pass/qte_fail 分支，
 *   节点回落为叙事并自动续连到「通过 QTE」原目标，破坏式改连接需二次确认，
 *   在 applyMaterialDelete / confirmMaterialDelete 里判定）。
 */
export function canDeleteMaterial(kind: MaterialKind): boolean {
  return (
    kind === 'subtitle' ||
    kind === 'overlay' ||
    kind === 'qte' ||
    kind === 'option'
  )
}

export function materialClass(kind: MaterialKind): string {
  switch (kind) {
    case 'subtitle':
      return 'is-subtitle'
    case 'overlay':
      return 'is-overlay'
    case 'qte':
      return 'is-qte'
    case 'option':
      return 'is-option'
  }
}
