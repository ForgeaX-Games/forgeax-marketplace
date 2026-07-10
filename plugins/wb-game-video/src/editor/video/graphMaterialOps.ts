/**
 * graphMaterialOps —— 「新引擎 › 视频」编辑器的 graph 原生数据层（读投影 + 写映射）。
 *
 * 权威数据 = `graphScenarioStore` 的 GameGraph。一个演出节点（`node.id === scene.id`）的
 * `node.data.timeline[]` + `node.data.media` + 出边（`graph.edges`）就是旧 Scene 的
 * dialogue/overlays/qte/choice/branches 的**统一容器**。这里把它投影成时间轴用的
 * `MaterialItem[]` / 预览叠层，并把编辑（拖拽/检视器/增删/选项分支）经 `graph-edit` 原语
 * 写回 —— 全程不落任何 Scene 拷贝（对齐用户「重写数据层、不做 Scene projection」的决策）。
 *
 * 旧 → 新 kind 映射：
 *   字幕 dialogue[]     → kind 'dialogue'   （MaterialItem 'subtitle'）
 *   飘字 overlays[]      → kind 'floatText'  （'overlay'）+ 结算联动 kind 'settle'（id `${floatId}-settle`）
 *   QTE  qte.cues[]      → kind 'qte'（params.cues[]）→ 每 cue 一个 'qte' 项（整段 QTE 跨度由 cues 派生，不再单列 'qte_window' 轨）
 *   选项 choice+branches → kind 'choice'（params.options[]）+ 分支跳转 = 出边 `opt:<key>`
 */
import type {
  EntitySpec,
  GameGraph,
  GameNode,
  GraphEffect,
  GraphTextStyle,
  TimelineElement,
} from '../../runtime/schema/graph-schema'
import type { ChoiceOption, QteCue } from '../../runtime/registry/core-kinds'
import { FILTER_PRESETS, FX_PRESETS } from '../../runtime/fx/video-fx'
import type { MaterialItem, MaterialKind } from './materialTimelineShared'
import { clampLayer, clampMs, normalizeLayer } from './materialTimelineShared'
import { elementStartMs } from '../../graph/canvas/timeline-geometry'
import {
  addTimelineElement,
  connect,
  disconnect,
  newElementId,
  patchTimelineElement,
  removeTimelineElement,
  teardownInteraction,
  updateNodeData,
  upsertBranchEdge,
} from '../../graph/edit/graph-edit'

// ── 预览叠层 ─────────────────────────────────────────────────────────────────
export type PreviewTarget =
  | { kind: 'element'; elementId: string }
  | { kind: 'qteCue'; elementId: string; cueId: string }
  | { kind: 'readonly' }

export interface PreviewOverlay {
  id: string
  materialKey: string
  kind: MaterialKind
  label: string
  x: number
  y: number
  layer: number
  movable: boolean
  style?: GraphTextStyle
  target: PreviewTarget
}

export const SUBTITLE_XY = { x: 0.5, y: 0.9 }
export const OVERLAY_XY = { x: 0.5, y: 0.42 }
const OPTION_XY = { x: 0.5, y: 0.72 }
const QTE_GOOD_WINDOW = 480
const QTE_HANDLES = ['pass', 'good', 'fail']
const CHOICE_HANDLE = 'opt:'

// ── 元素读取小工具 ────────────────────────────────────────────────────────────
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}
function cuesOf(el: TimelineElement | undefined): QteCue[] {
  return el && Array.isArray(el.params.cues) ? (el.params.cues as QteCue[]) : []
}
function optionsOf(el: TimelineElement | undefined): ChoiceOption[] {
  return el && Array.isArray(el.params.options) ? (el.params.options as ChoiceOption[]) : []
}
function filterLabel(id: unknown): string {
  return FILTER_PRESETS.find((p) => p.id === id)?.label ?? '滤镜'
}
function fxLabel(id: unknown): string {
  return FX_PRESETS.find((p) => p.id === id)?.label ?? '特效'
}

function firstEntityId(entities: Record<string, EntitySpec> | undefined, kind: 'boss' | 'player'): string {
  for (const [id, e] of Object.entries(entities ?? {})) if (e.kind === kind) return e.id ?? id
  return `ent-${kind}`
}

/** 从飘字内容里解析伤害数值：取首个数字的绝对值，无数字则 0。 */
export function parseDamageFromContent(content: string): number {
  const m = content.match(/-?\d+(?:\.\d+)?/)
  return m ? Math.abs(Number(m[0])) || 0 : 0
}

function settleIdFor(floatId: string): string {
  return `${floatId}-settle`
}
function hpEffect(
  entities: Record<string, EntitySpec> | undefined,
  target: 'boss' | 'player',
  amount: number,
): GraphEffect {
  return {
    kind: 'attr',
    entityId: firstEntityId(entities, target),
    attr: 'hp',
    op: 'add',
    value: -Math.abs(amount),
    id: `ov-${target}-hp`,
  }
}
/** settle 元素里 hp effect 的绝对伤害（无则 0）。 */
export function settleDamage(settle: TimelineElement | undefined): number {
  const effects = (settle?.params.effects as GraphEffect[] | undefined) ?? []
  const hp = effects.find((e) => e.kind === 'attr' && e.attr === 'hp') as { value?: unknown } | undefined
  return hp && typeof hp.value === 'number' ? Math.abs(hp.value) : 0
}
/** settle 的 hp effect 作用于 boss 还是 player。 */
export function settleTargetKind(
  settle: TimelineElement | undefined,
  entities: Record<string, EntitySpec> | undefined,
): 'boss' | 'player' {
  const effects = (settle?.params.effects as GraphEffect[] | undefined) ?? []
  const hp = effects.find((e) => e.kind === 'attr' && e.attr === 'hp') as { entityId?: string } | undefined
  const ent = hp?.entityId ? entities?.[hp.entityId] : undefined
  return ent?.kind === 'player' ? 'player' : 'boss'
}

// ── 节点/元素定位 ─────────────────────────────────────────────────────────────
export function findNode(graph: GameGraph, nodeId: string | undefined): GameNode | undefined {
  if (!nodeId) return undefined
  return graph.nodes.find((n) => n.id === nodeId)
}
export function findElement(node: GameNode | undefined, elId: string): TimelineElement | undefined {
  return node?.data.timeline.find((e) => e.id === elId)
}
export function qteElementOfCue(node: GameNode | undefined, cueId: string): TimelineElement | undefined {
  return node?.data.timeline.find((e) => e.kind === 'qte' && cuesOf(e).some((c) => c.id === cueId))
}
export function qteElement(node: GameNode | undefined): TimelineElement | undefined {
  return node?.data.timeline.find((e) => e.kind === 'qte')
}
export function choiceElement(node: GameNode | undefined): TimelineElement | undefined {
  return node?.data.timeline.find((e) => e.kind === 'choice')
}
export function settleElementFor(node: GameNode | undefined, floatId: string): TimelineElement | undefined {
  return findElement(node, settleIdFor(floatId))
}

function timedStart(el: TimelineElement): number {
  const s = elementStartMs(el)
  return s < 0 ? 0 : s
}

// ── 读投影：node → MaterialItem[] ─────────────────────────────────────────────
export function collectMaterialsFromNode(node: GameNode | undefined, maxMs: number): MaterialItem[] {
  if (!node) return []
  const out: MaterialItem[] = []
  for (const el of node.data.timeline) {
    if (el.kind === 'dialogue') {
      const start = timedStart(el)
      out.push({
        key: `subtitle:${el.id}`,
        id: el.id,
        kind: 'subtitle',
        label: str(el.params.text) || '字幕',
        startMs: start,
        endMs: el.window?.endMs ?? Math.min(maxMs, start + 2000),
        layer: normalizeLayer(el.layer, 0),
      })
    } else if (el.kind === 'floatText') {
      const start = timedStart(el)
      out.push({
        key: `overlay:${el.id}`,
        id: el.id,
        kind: 'overlay',
        label: (str(el.params.text) ?? '').trim() || '飘字',
        startMs: start,
        endMs: el.window?.endMs ?? Math.min(maxMs, start + 1200),
        layer: normalizeLayer(el.layer, 1),
      })
    } else if (el.kind === 'choice') {
      out.push({
        key: `option:${el.id}`,
        id: el.id,
        kind: 'option',
        label: str(el.params.prompt) || '选项',
        startMs: el.window?.startMs ?? 0,
        endMs: el.window?.endMs ?? maxMs,
        layer: normalizeLayer(el.layer, 3),
      })
    } else if (el.kind === 'filter') {
      out.push({
        key: `filter:${el.id}`,
        id: el.id,
        kind: 'filter',
        label: filterLabel(el.params.filter),
        startMs: el.window?.startMs ?? 0,
        endMs: el.window?.endMs ?? maxMs,
        layer: normalizeLayer(el.layer, 4),
      })
    } else if (el.kind === 'fx') {
      out.push({
        key: `fx:${el.id}`,
        id: el.id,
        kind: 'fx',
        label: fxLabel(el.params.fx),
        startMs: el.window?.startMs ?? 0,
        endMs: el.window?.endMs ?? maxMs,
        layer: normalizeLayer(el.layer, 5),
      })
    } else if (el.kind === 'qte') {
      for (const c of cuesOf(el)) {
        // 左缘=出现(appearAt) 右缘=消失(endAt) 菱形=命中判定(targetAt，计分锚点)。
        const s = c.appearAt ?? 0
        const target = c.targetAt ?? s
        const end = c.endAt ?? Math.max(target + 300, s + (c.durationMs ?? 500))
        out.push({
          key: `qte:${el.id}:${c.id}`,
          id: c.id,
          kind: 'qte',
          label: c.label || 'QTE',
          startMs: s,
          endMs: end,
          markerMs: Math.min(Math.max(target, s), end),
          layer: normalizeLayer(c.layer, 2),
        })
      }
    }
  }
  return out
}

// ── 读投影：预览叠层 ──────────────────────────────────────────────────────────
export function activePreviewOverlaysFromNode(
  node: GameNode | undefined,
  ms: number,
  maxMs: number,
): PreviewOverlay[] {
  if (!node) return []
  const out: PreviewOverlay[] = []
  for (const el of node.data.timeline) {
    if (el.kind === 'dialogue') {
      const start = timedStart(el)
      const end = el.window?.endMs ?? Math.min(maxMs, start + 2000)
      if (ms < start || ms > end) continue
      const speaker = str(el.params.speaker)
      const text = str(el.params.text) ?? ''
      out.push({
        id: `subtitle:${el.id}`,
        materialKey: `subtitle:${el.id}`,
        kind: 'subtitle',
        label: speaker ? `${speaker}：${text}` : text,
        x: (el.params.x as number) ?? SUBTITLE_XY.x,
        y: (el.params.y as number) ?? SUBTITLE_XY.y,
        layer: normalizeLayer(el.layer, 0),
        movable: true,
        style: el.params.style as GraphTextStyle | undefined,
        target: { kind: 'element', elementId: el.id },
      })
    } else if (el.kind === 'floatText') {
      const start = timedStart(el)
      const end = el.window?.endMs ?? Math.min(maxMs, start + 1200)
      if (ms < start || ms > end) continue
      const text = (str(el.params.text) ?? '').trim()
      if (!text) continue
      out.push({
        id: `overlay:${el.id}`,
        materialKey: `overlay:${el.id}`,
        kind: 'overlay',
        label: text,
        x: (el.params.x as number) ?? OVERLAY_XY.x,
        y: (el.params.y as number) ?? OVERLAY_XY.y,
        layer: normalizeLayer(el.layer, 1),
        movable: true,
        style: el.params.style as GraphTextStyle | undefined,
        target: { kind: 'element', elementId: el.id },
      })
    } else if (el.kind === 'qte') {
      for (const c of cuesOf(el)) {
        const s = c.appearAt ?? 0
        if (ms < s || ms > (c.targetAt ?? s) + QTE_GOOD_WINDOW) continue
        out.push({
          id: `qte:${c.id}`,
          materialKey: `qte:${el.id}:${c.id}`,
          kind: 'qte',
          label: c.label ?? (c.shape ?? 'tap').toUpperCase(),
          x: c.x ?? 0.5,
          y: c.y ?? 0.55,
          layer: normalizeLayer(c.layer, 2),
          movable: true,
          target: { kind: 'qteCue', elementId: el.id, cueId: c.id },
        })
      }
    } else if (el.kind === 'choice') {
      const start = el.window?.startMs ?? 0
      const end = el.window?.endMs ?? maxMs
      if (ms < start || ms > end) continue
      out.push({
        id: `option:list:${el.id}`,
        materialKey: `option:${el.id}`,
        kind: 'option',
        label: str(el.params.prompt) ?? '请选择',
        x: OPTION_XY.x,
        y: OPTION_XY.y,
        layer: normalizeLayer(el.layer, 3),
        movable: false,
        target: { kind: 'readonly' },
      })
    }
  }
  return out.sort((a, b) => a.layer - b.layer)
}

// ── 写映射：时间轴拖拽（start/end/layer）──────────────────────────────────────
export function patchMaterialGraph(
  graph: GameGraph,
  node: GameNode,
  maxMs: number,
  item: MaterialItem,
  patch: { startMs?: number; endMs?: number; layer?: number; markerMs?: number },
): GameGraph {
  const start = clampMs(patch.startMs ?? item.startMs, 0, Math.max(0, maxMs - 100))
  const end = clampMs(patch.endMs ?? item.endMs, start + 100, maxMs)
  const layer = patch.layer == null ? item.layer : clampLayer(patch.layer)
  switch (item.kind) {
    case 'subtitle':
    case 'overlay':
    case 'filter':
    case 'fx':
      return patchTimelineElement(graph, node.id, item.id, {
        window: { startMs: start, endMs: end },
        trigger: { when: 'at', ms: start },
        layer,
      })
    case 'option':
      return patchTimelineElement(graph, node.id, item.id, {
        window: { startMs: start, endMs: end },
        layer,
      })
    case 'qte': {
      const el = qteElementOfCue(node, item.id)
      if (!el) return graph
      const isMove = patch.layer != null && patch.startMs != null && patch.endMs != null
      const cues = cuesOf(el).map((c) => {
        if (c.id !== item.id) return c
        const next: QteCue = { ...c }
        if (patch.markerMs != null) {
          // 拖菱形：只改命中判定点，夹在 [出现, 消失] 内。
          const lo = c.appearAt ?? 0
          const hi = c.endAt ?? Math.max(lo, c.targetAt ?? lo)
          next.targetAt = clampMs(patch.markerMs, lo, Math.max(lo, hi))
          return next
        }
        if (isMove) {
          // 整体平移：出现/命中/消失同步移，保持相对间距。
          const shift = start - (c.appearAt ?? 0)
          next.appearAt = start
          next.endAt = end
          if (c.targetAt != null) next.targetAt = clampMs(c.targetAt + shift, start, end)
          next.layer = layer
          return next
        }
        // 拖边缘：左缘→出现(appearAt)，右缘→消失(endAt)；命中点夹回窗内。
        next.appearAt = start
        next.endAt = end
        if (c.targetAt != null) next.targetAt = clampMs(c.targetAt, start, end)
        next.layer = layer
        return next
      })
      return patchTimelineElement(graph, node.id, el.id, {
        params: { ...el.params, cues },
      })
    }
    default:
      return graph
  }
}

// ── 写映射：预览拖拽定位（x/y）─────────────────────────────────────────────────
export function patchOverlayPositionGraph(
  graph: GameGraph,
  node: GameNode,
  target: PreviewTarget,
  x: number,
  y: number,
): GameGraph {
  if (target.kind === 'element') {
    const el = findElement(node, target.elementId)
    if (!el) return graph
    return patchTimelineElement(graph, node.id, el.id, { params: { ...el.params, x, y } })
  }
  if (target.kind === 'qteCue') {
    const el = findElement(node, target.elementId)
    if (!el) return graph
    const cues = cuesOf(el).map((c) => (c.id === target.cueId ? { ...c, x, y } : c))
    return patchTimelineElement(graph, node.id, el.id, { params: { ...el.params, cues } })
  }
  return graph
}

// ── 写映射：删除 + 二次确认 ────────────────────────────────────────────────────
function isWholeInteractionDelete(node: GameNode, item: MaterialItem): boolean {
  if (item.kind === 'option') return true
  if (item.kind === 'qte') return cuesOf(qteElementOfCue(node, item.id)).length <= 1
  return false
}
export function confirmMaterialDelete(node: GameNode, item: MaterialItem): boolean {
  if (!isWholeInteractionDelete(node, item)) return true
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return true
  const message =
    item.kind === 'option'
      ? '删除整条选项交互？\n该节点将改回叙事节点，并自动续连到「第一个选项」原本指向的场景。\n这会同步更改蓝图上的节点连接关系，是否确认？'
      : '删除整段 QTE 交互？\n该节点将改回叙事节点，并自动续连到「通过 QTE」原本指向的场景。\n这会同步更改蓝图上的节点连接关系，是否确认？'
  return window.confirm(message)
}
export function deleteMaterialGraph(graph: GameGraph, node: GameNode, item: MaterialItem): GameGraph {
  switch (item.kind) {
    case 'subtitle':
    case 'filter':
    case 'fx':
      return removeTimelineElement(graph, node.id, item.id)
    case 'overlay': {
      const g = removeTimelineElement(graph, node.id, item.id)
      return removeTimelineElement(g, node.id, settleIdFor(item.id))
    }
    case 'qte': {
      const el = qteElementOfCue(node, item.id)
      if (!el) return graph
      if (cuesOf(el).length <= 1) {
        return teardownInteraction(graph, node.id, { kind: 'qte', handlePrefixes: QTE_HANDLES, continueHandle: 'pass' })
      }
      const cues = cuesOf(el).filter((c) => c.id !== item.id)
      return patchTimelineElement(graph, node.id, el.id, { params: { ...el.params, cues } })
    }
    case 'option':
      return teardownInteraction(graph, node.id, { kind: 'choice', handlePrefixes: [CHOICE_HANDLE] })
    default:
      return graph
  }
}

// ── 写映射：新增材料 ──────────────────────────────────────────────────────────
export type MaterialTemplate = 'subtitle' | 'overlay' | 'qte' | 'option' | 'filter' | 'fx'

export interface AddResult {
  graph: GameGraph
  selectKey: string | null
}

function firstOtherNodeId(graph: GameGraph, nodeId: string): string {
  return graph.nodes.find((n) => n.id !== nodeId)?.id ?? nodeId
}

/** 从素材库拖入时间轴的落点：ms = 落点时刻，layer = 落点所在轨。 */
export interface DropAt {
  ms: number
  layer: number
}

export function addMaterialGraph(
  graph: GameGraph,
  node: GameNode,
  maxMs: number,
  template: MaterialTemplate,
  entities: Record<string, EntitySpec> | undefined,
  playheadMs: number,
  at?: DropAt,
): AddResult {
  const dur = clampMs(2500, 100, maxMs)
  // at 存在 = 从素材库拖入的精确落点；缺省（点击添加）落在 0ms / 语义默认轨。
  const startMs = at ? clampMs(at.ms, 0, Math.max(0, maxMs - 100)) : 0
  const endMs = clampMs(startMs + dur, startMs + 100, maxMs)
  if (template === 'subtitle') {
    const id = newElementId()
    const el: TimelineElement = {
      id,
      role: 'presentation',
      kind: 'dialogue',
      trigger: { when: 'enter' },
      window: { startMs, endMs },
      layer: at ? at.layer : 0,
      params: { text: '新字幕' },
    }
    return { graph: addTimelineElement(graph, node.id, el), selectKey: `subtitle:${id}` }
  }
  if (template === 'overlay') {
    const id = newElementId()
    const float: TimelineElement = {
      id,
      role: 'presentation',
      kind: 'floatText',
      trigger: { when: 'enter' },
      window: { startMs, endMs },
      layer: at ? at.layer : 1,
      params: { text: '-100', x: OVERLAY_XY.x, y: 0.45 },
    }
    const settle: TimelineElement = {
      id: settleIdFor(id),
      role: 'logic',
      kind: 'settle',
      trigger: { when: 'enter' },
      params: { effects: [hpEffect(entities, 'boss', 100)] },
    }
    const g = addTimelineElement(addTimelineElement(graph, node.id, float), node.id, settle)
    return { graph: g, selectKey: `overlay:${id}` }
  }
  if (template === 'filter' || template === 'fx') {
    const id = newElementId()
    const el: TimelineElement = {
      id,
      role: 'presentation',
      kind: template,
      trigger: { when: 'at', ms: startMs },
      window: { startMs, endMs },
      layer: at ? at.layer : template === 'filter' ? 4 : 5,
      params: template === 'filter' ? { filter: 'warm', intensity: 1 } : { fx: 'flash', intensity: 1 },
    }
    return { graph: addTimelineElement(graph, node.id, el), selectKey: `${template}:${id}` }
  }
  if (template === 'qte') {
    return addQteCueGraph(graph, node, maxMs, at ? at.ms : playheadMs)
  }
  // option
  const existing = choiceElement(node)
  if (existing) return { graph, selectKey: `option:${existing.id}` }
  const g0 = teardownInteraction(graph, node.id, { kind: 'qte', handlePrefixes: QTE_HANDLES })
  const id = newElementId()
  const key = 'opt0'
  const el: TimelineElement = {
    id,
    role: 'interaction',
    kind: 'choice',
    trigger: { when: 'enter' },
    window: { startMs: 0, endMs: dur },
    layer: 3,
    params: { options: [{ key, label: '选项一' }], prompt: '请选择', presentation: 'list' },
  }
  let g = addTimelineElement(g0, node.id, el)
  g = connect(g, { source: node.id, sourceHandle: `${CHOICE_HANDLE}${key}`, target: firstOtherNodeId(g, node.id) })
  return { graph: g, selectKey: `option:${id}` }
}

/** 新增一个 QTE 按键点（无 qte 元素则新建整段 QTE，并清掉 choice）。 */
export function addQteCueGraph(
  graph: GameGraph,
  node: GameNode,
  maxMs: number,
  playheadMs: number,
  afterCueId?: string,
): AddResult {
  const el = qteElement(node)
  const cues = cuesOf(el)
  const base = afterCueId ? cues.find((c) => c.id === afterCueId) : cues[cues.length - 1]
  const appear = clampMs((base?.targetAt ?? playheadMs) + 500, 0, Math.max(0, maxMs - 200))
  const target = clampMs(appear + 300, appear + 100, Math.max(appear + 100, maxMs - 100))
  const end = clampMs(target + 400, target + 100, maxMs)
  const cueId = `q-${Date.now().toString(36)}`
  const cue: QteCue = {
    id: cueId,
    shape: base?.shape ?? 'tap',
    triggerKey: base?.triggerKey,
    x: base?.x ?? 0.5,
    y: base?.y ?? 0.55,
    appearAt: appear,
    targetAt: target,
    endAt: end,
    label: `QTE ${cues.length + 1}`,
    layer: base?.layer ?? 2,
  }
  if (el) {
    const g = patchTimelineElement(graph, node.id, el.id, {
      params: { ...el.params, cues: [...cues, cue] },
    })
    return { graph: g, selectKey: `qte:${el.id}:${cueId}` }
  }
  // 首次建 QTE：清掉 choice（互斥），新建 qte 元素。
  const g0 = teardownInteraction(graph, node.id, { kind: 'choice', handlePrefixes: [CHOICE_HANDLE] })
  const id = newElementId()
  const newEl: TimelineElement = {
    id,
    role: 'interaction',
    kind: 'qte',
    trigger: { when: 'enter' },
    params: {
      qteKind: 'parry',
      passingHits: 1,
      cues: [cue],
    },
  }
  return { graph: addTimelineElement(g0, node.id, newEl), selectKey: `qte:${id}:${cueId}` }
}

/** 删一个 QTE 按键点（删到最后一个 = 拆整段 QTE）。 */
export function removeQteCueGraph(graph: GameGraph, node: GameNode, cueId: string): GameGraph {
  const el = qteElementOfCue(node, cueId)
  if (!el) return graph
  if (cuesOf(el).length <= 1) {
    return teardownInteraction(graph, node.id, { kind: 'qte', handlePrefixes: QTE_HANDLES, continueHandle: 'pass' })
  }
  const cues = cuesOf(el).filter((c) => c.id !== cueId)
  return patchTimelineElement(graph, node.id, el.id, { params: { ...el.params, cues } })
}

// ── 写映射：检视器 params 编辑 ────────────────────────────────────────────────
function mergeParams(el: TimelineElement, patch: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...el.params }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  return next
}

/** 字幕/QTE-cue/选项的通用 params 编辑（飘字见 patchOverlayGraph）。 */
export function patchSelectedGraph(
  graph: GameGraph,
  node: GameNode,
  item: MaterialItem,
  patch: Record<string, unknown>,
): GameGraph {
  if (item.kind === 'subtitle' || item.kind === 'filter' || item.kind === 'fx') {
    const el = findElement(node, item.id)
    if (!el) return graph
    return patchTimelineElement(graph, node.id, el.id, { params: mergeParams(el, patch) })
  }
  if (item.kind === 'qte') {
    const el = qteElementOfCue(node, item.id)
    if (!el) return graph
    const cues = cuesOf(el).map((c) => (c.id === item.id ? { ...c, ...patch } : c))
    return patchTimelineElement(graph, node.id, el.id, { params: { ...el.params, cues } })
  }
  if (item.kind === 'option') {
    const el = findElement(node, item.id)
    if (!el) return graph
    const next = mergeParams(el, patch)
    return patchTimelineElement(graph, node.id, el.id, { params: next })
  }
  return graph
}

/** 飘字（floatText + 联动 settle）的 params 编辑：content/settlementOn/effectTarget/style/x/y。 */
export function patchOverlayGraph(
  graph: GameGraph,
  node: GameNode,
  floatId: string,
  patch: Record<string, unknown>,
  entities: Record<string, EntitySpec> | undefined,
): GameGraph {
  const float = findElement(node, floatId)
  if (!float) return graph
  let g = graph
  const settle = settleElementFor(node, floatId)
  const settleParams = (): Record<string, unknown> => ({
    effects: [hpEffect(entities, settleTargetKind(settle, entities), 0)],
  })

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'content') {
      const content = String(value)
      g = patchTimelineElement(g, node.id, floatId, { params: { ...findElement(findNode(g, node.id), floatId)!.params, text: content } })
      // 有结算时，伤害从内容派生同步。
      const s = settleElementFor(findNode(g, node.id), floatId)
      if (s) {
        const target = settleTargetKind(s, entities)
        g = patchTimelineElement(g, node.id, settleIdFor(floatId), {
          params: { effects: [hpEffect(entities, target, parseDamageFromContent(content))] },
        })
      }
    } else if (key === 'settlementOn') {
      const has = !!settleElementFor(findNode(g, node.id), floatId)
      if (value && !has) {
        const dmg = parseDamageFromContent(str(float.params.text) ?? '')
        g = addTimelineElement(g, node.id, {
          id: settleIdFor(floatId),
          role: 'logic',
          kind: 'settle',
          trigger: float.trigger,
          params: { effects: [hpEffect(entities, 'boss', dmg)] },
        })
      } else if (!value && has) {
        g = removeTimelineElement(g, node.id, settleIdFor(floatId))
      }
    } else if (key === 'effectTarget') {
      const s = settleElementFor(findNode(g, node.id), floatId)
      if (s) {
        g = patchTimelineElement(g, node.id, settleIdFor(floatId), {
          params: { effects: [hpEffect(entities, value === 'player' ? 'player' : 'boss', settleDamage(s))] },
        })
      }
    } else {
      const cur = findElement(findNode(g, node.id), floatId)
      if (cur) g = patchTimelineElement(g, node.id, floatId, { params: mergeParams(cur, { [key]: value }) })
    }
  }
  return g
}

// ── 写映射：选项分支（= 出边 opt:<key>）───────────────────────────────────────
export interface OptionBranchView {
  key: string
  label: string
  targetId: string | undefined
  edgeId: string | undefined
}
export function listOptionBranches(graph: GameGraph, node: GameNode): OptionBranchView[] {
  const el = choiceElement(node)
  if (!el) return []
  return optionsOf(el).map((o) => {
    const edge = graph.edges.find((e) => e.source === node.id && e.sourceHandle === `${CHOICE_HANDLE}${o.key}`)
    return { key: o.key, label: o.label ?? o.key, targetId: edge?.target, edgeId: edge?.id }
  })
}
export function addOptionBranchGraph(graph: GameGraph, node: GameNode): GameGraph {
  const el = choiceElement(node)
  if (!el) return graph
  const options = optionsOf(el)
  const key = `opt${options.length}-${Date.now().toString(36).slice(-3)}`
  const label = `选项 ${options.length + 1}`
  let g = patchTimelineElement(graph, node.id, el.id, {
    params: { ...el.params, options: [...options, { key, label }] },
  })
  g = connect(g, { source: node.id, sourceHandle: `${CHOICE_HANDLE}${key}`, target: firstOtherNodeId(g, node.id) })
  return g
}
export function updateOptionLabelGraph(graph: GameGraph, node: GameNode, key: string, label: string): GameGraph {
  const el = choiceElement(node)
  if (!el) return graph
  const options = optionsOf(el).map((o) => (o.key === key ? { ...o, label } : o))
  return patchTimelineElement(graph, node.id, el.id, { params: { ...el.params, options } })
}
export function setOptionTargetGraph(graph: GameGraph, node: GameNode, key: string, targetId: string): GameGraph {
  return upsertBranchEdge(graph, { source: node.id, sourceHandle: `${CHOICE_HANDLE}${key}`, target: targetId })
}
export function removeOptionBranchGraph(graph: GameGraph, node: GameNode, key: string): GameGraph {
  const el = choiceElement(node)
  if (!el) return graph
  const options = optionsOf(el).filter((o) => o.key !== key)
  // 删到 0 个选项 = 拆整段选项交互（回落叙事 + 自动续连）。
  if (options.length === 0) {
    return teardownInteraction(graph, node.id, { kind: 'choice', handlePrefixes: [CHOICE_HANDLE] })
  }
  let g = patchTimelineElement(graph, node.id, el.id, { params: { ...el.params, options } })
  const edge = g.edges.find((e) => e.source === node.id && e.sourceHandle === `${CHOICE_HANDLE}${key}`)
  if (edge) g = disconnect(g, edge.id)
  return g
}

// ── 写映射：视频绑定 ──────────────────────────────────────────────────────────
export function bindVideoGraph(
  graph: GameGraph,
  node: GameNode,
  ref: string,
  durationMs: number | undefined,
): GameGraph {
  return updateNodeData(graph, node.id, {
    media: { kind: 'VIDEO', ref },
    ...(durationMs != null ? { durationMs } : {}),
  })
}
export function setNodePromptGraph(graph: GameGraph, node: GameNode, prompt: string): GameGraph {
  const media = node.data.media ?? { kind: 'VIDEO' }
  return updateNodeData(graph, node.id, { media: { ...media, prompt: prompt || undefined } })
}
