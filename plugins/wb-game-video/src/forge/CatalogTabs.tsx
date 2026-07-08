import { useEffect, useMemo, useRef, useState } from 'react'

import { injectStyleOnce } from '../styles/injectStyle'
import { resolveOptType, qteInteractionWindowEnd } from '../player/choiceTiming'
import {
  computeVideoContentRect,
  pointerToVideoNorm,
  type VideoContentRect,
} from '../player/videoContentRect'
import { useShellStore } from '../shell/shellStore'
import { useScenarioStore } from '../scenario/scenarioStore'
import { applyCombatRules, readCombatRules, type CombatRulesPatch } from '../scenario/combatRules'
import {
  VIDEO_CLIPS,
  UI_SCHEMES,
  GAME_RULES,
  type VideoClip,
  type UiScheme,
  type GameRule,
} from '../scenario/gameAssetCatalog'
import type { Branch, DecisionSpec, DialogueLine, EntityStatEffect, Hotspot, PerformanceCue, QTECue, Scenario, Scene, StickerClip } from '../scenario/types'

/**
 * 视频 / 界面 / 规则 三个 tab 的内容面板 —— 统一「列表 + 预览」形态：
 *
 *   左栏：固定资产条目列表（带 ✓ 标记，选中项 amber 高亮）；
 *   右栏：点中那一条的预览 —— 视频=播放框（占位）、界面/规则=数据展示。
 *
 * 数据全部来自 gameAssetCatalog（内置固定数据），与蓝图节点配置面板的「演出编号 /
 * HUD 方案」下拉同源。样式对齐 `视频交互原型.html` 的左栏栏目 + 预览框。
 */

function fmtDur(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/* ── 通用外壳 ─────────────────────────────────────────── */

interface CatalogItem {
  id: string
  label: string
}

export function CatalogShell<T extends CatalogItem>({
  icon,
  title,
  items,
  selectedId,
  onSelect,
  renderPreview,
}: {
  icon: string
  title: string
  items: readonly T[]
  selectedId: string
  onSelect: (id: string) => void
  renderPreview: (item: T | undefined) => React.ReactNode
}) {
  injectStyleOnce('game-catalog', CATALOG_CSS)
  const selected = items.find((i) => i.id === selectedId)
  return (
    <div className="gc-tab">
      <aside className="gc-list" aria-label={title}>
        <div className="gc-list-head">
          <span className="gc-list-ico" aria-hidden>
            {icon}
          </span>
          <span className="gc-list-title">{title}</span>
          <span className="gc-list-count">{items.length}</span>
        </div>
        <div className="gc-list-body">
          {items.map((it) => (
            <button
              key={it.id}
              type="button"
              className={`gc-row${it.id === selectedId ? ' is-on' : ''}`}
              onClick={() => onSelect(it.id)}
            >
              <span className="gc-row-mark" aria-hidden>
                ✓
              </span>
              <span className="gc-row-label">{it.label}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="gc-preview">{renderPreview(selected)}</section>
    </div>
  )
}

/* ── 视频 ─────────────────────────────────────────────── */

type MaterialKind = 'subtitle' | 'settlement' | 'qte' | 'qte_window' | 'option'

interface MaterialItem {
  key: string
  id: string
  kind: MaterialKind
  label: string
  startMs: number
  endMs: number
  layer: number
  cueId?: string
  stickerId?: string
}

interface PreviewOverlay {
  id: string
  materialKey: string
  kind: MaterialKind
  label: string
  x: number
  y: number
  r?: number
  layer: number
  movable: boolean
  target:
    | { kind: 'sticker'; stickerId: string }
    | { kind: 'qte'; cueId: string }
    | { kind: 'hotspot'; hotspotId: string }
    | { kind: 'readonly' }
}

type MaterialTemplate = 'subtitle' | 'settlement' | 'qte' | 'option'
type SettlementMode = 'damage' | 'text'

const TIMELINE_RULER_H = 24
const TIMELINE_LAYER_TOP = 34
const TIMELINE_LAYER_STEP = 34
const TIMELINE_MAX_LAYER = 4

function clampMs(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return Math.max(min, Math.min(max, Math.round(v)))
}

function clampLayer(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(TIMELINE_MAX_LAYER, Math.round(v)))
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

function normalizeLayer(v: number | undefined, fallback: number): number {
  if (v == null) return fallback
  // Temporary compatibility with earlier 10/20/30 style defaults.
  if (v >= 10) return clampLayer(Math.round(v / 10) - 1)
  return clampLayer(v)
}

function layerFromPointerY(clientY: number, rect: DOMRect): number {
  const y = clientY - rect.top - TIMELINE_RULER_H
  return clampLayer(Math.round((y - (TIMELINE_LAYER_TOP - TIMELINE_RULER_H)) / TIMELINE_LAYER_STEP))
}

function layerTop(layer: number): number {
  return TIMELINE_LAYER_TOP + clampLayer(layer) * TIMELINE_LAYER_STEP
}

function materialLabel(kind: MaterialKind): string {
  switch (kind) {
    case 'subtitle':
      return '字幕'
    case 'settlement':
      return '结算飘字'
    case 'qte':
      return 'QTE 按键点'
    case 'qte_window':
      return 'QTE 窗口'
    case 'option':
      return '选项'
  }
}

function materialDisplayLabel(item: Pick<MaterialItem, 'kind' | 'key'>): string {
  return materialLabel(item.kind)
}

function materialClass(kind: MaterialKind): string {
  switch (kind) {
    case 'subtitle':
      return 'is-subtitle'
    case 'settlement':
      return 'is-settlement'
    case 'qte':
      return 'is-qte'
    case 'qte_window':
      return 'is-qte-window'
    case 'option':
      return 'is-option'
  }
}

function choiceHotspotId(branchId: string): string {
  return `choice-${branchId}`
}

function findStickerForCue(scene: Scene, cue: PerformanceCue): StickerClip | undefined {
  const stickers = scene.stickerClips ?? []
  return (
    stickers.find((s) => s.performanceCueId === cue.id && s.kind === 'numeric') ??
    stickers.find((s) => s.id === cue.id && s.kind === 'numeric') ??
    stickers.find(
      (s) =>
        s.kind === 'numeric' &&
        Math.abs(s.startMs - cue.atMs) <= 50 &&
        (s.text === cue.label ||
          s.text === defaultSettlementText(cue)),
    )
  )
}

function findCueForSticker(scene: Scene, sticker: StickerClip): PerformanceCue | undefined {
  const cues = scene.performance?.cues ?? []
  return (
    (sticker.performanceCueId ? cues.find((cue) => cue.id === sticker.performanceCueId) : undefined) ??
    cues.find((cue) => cue.id === sticker.id) ??
    cues.find((cue) => {
      if (sticker.kind !== 'numeric') return false
      if (Math.abs(sticker.startMs - cue.atMs) > 50) return false
      const textValue = numericTextValue(sticker.text)
      const damageValue = cueDamageValue(cue)
      return textValue != null && textValue === damageValue
    })
  )
}

function collectMaterials(scene: Scene): MaterialItem[] {
  const out: MaterialItem[] = []
  for (const d of scene.dialogue ?? []) {
    out.push({
      key: `subtitle:${d.id}`,
      id: d.id,
      kind: 'subtitle',
      label: d.text || '字幕',
      startMs: d.startMs,
      endMs: d.endMs ?? Math.min(scene.durationMs, d.startMs + 2000),
      layer: normalizeLayer(d.layer, 0),
    })
  }
  const usedStickerIds = new Set<string>()
  for (const cue of scene.performance?.cues ?? []) {
    const pairedSticker = findStickerForCue(scene, cue)
    if (pairedSticker) usedStickerIds.add(pairedSticker.id)
    const endMs = pairedSticker?.endMs ?? Math.min(scene.durationMs, cue.atMs + 1200)
    out.push({
      key: `settlement:${cue.id}`,
      id: cue.id,
      kind: 'settlement',
      label: cue.label || pairedSticker?.text || '结算飘字',
      startMs: cue.atMs,
      endMs,
      layer: normalizeLayer(cue.layer ?? pairedSticker?.layer, 1),
      cueId: cue.id,
      stickerId: pairedSticker?.id,
    })
  }
  for (const c of scene.stickerClips ?? []) {
    if (c.kind !== 'numeric') continue
    if (usedStickerIds.has(c.id)) continue
    out.push({
      key: `settlement:${c.id}`,
      id: c.id,
      kind: 'settlement',
      label: c.text || '结算飘字',
      startMs: c.startMs,
      endMs: c.endMs,
      layer: normalizeLayer(c.layer, 1),
      stickerId: c.id,
    })
  }
  for (const c of scene.qte?.cues ?? []) {
    out.push({
      key: `qte:${c.id}`,
      id: c.id,
      kind: 'qte',
      label: c.label || 'QTE',
      startMs: c.appearAt,
      endMs: Math.max(c.targetAt, c.appearAt + (c.durationMs ?? 500)),
      layer: normalizeLayer(c.layer, 2),
    })
  }
  const choiceBranches = scene.branches.filter((b) => b.kind === 'choice')
  if (scene.decision && resolveOptType(scene.decision) === 'timed_qte') {
    const startMs = scene.decision.windowStartMs ?? scene.decision.atMs ?? 0
    const endMs = scene.qte?.cues?.length
      ? qteInteractionWindowEnd(scene)
      : scene.decision.windowEndMs ??
        (scene.decision.timeoutMs != null
          ? startMs + scene.decision.timeoutMs
          : scene.durationMs)
    out.push({
      key: 'qte-window',
      id: 'qte-decision',
      kind: 'qte_window',
      label: '整段限时',
      startMs,
      endMs,
      layer: normalizeLayer(scene.decision.layer, 3),
    })
  } else if (scene.decision && choiceBranches.length > 0) {
    const startMs = scene.decision.windowStartMs ?? scene.decision.atMs ?? 0
    const endMs = scene.decision.windowEndMs ?? scene.durationMs
    out.push({
      key: 'option:decision',
      id: 'decision',
      kind: 'option',
      label: scene.decision.prompt || '选项',
      startMs,
      endMs,
      layer: normalizeLayer(scene.decision.layer, 3),
    })
  }
  return out
}

function activePreviewOverlays(scene: Scene, materials: MaterialItem[], ms: number): PreviewOverlay[] {
  const out: PreviewOverlay[] = []
  for (const d of scene.dialogue ?? []) {
    const endMs = d.endMs ?? Math.min(scene.durationMs, d.startMs + 2000)
    if (ms < d.startMs || ms > endMs) continue
    out.push({
      id: `subtitle:${d.id}`,
      materialKey: `subtitle:${d.id}`,
      kind: 'subtitle',
      label: d.speaker ? `${d.speaker}：${d.text}` : d.text,
      x: 0.5,
      y: 0.86,
      layer: normalizeLayer(d.layer, 0),
      movable: false,
      target: { kind: 'readonly' },
    })
  }
  for (const s of scene.stickerClips ?? []) {
    if (ms < s.startMs || ms > s.endMs) continue
    const cue = findCueForSticker(scene, s)
    const material = materials.find((m) => m.kind === 'settlement' && (m.stickerId ?? m.id) === s.id)
    out.push({
      id: `sticker:${s.id}`,
      materialKey: material?.key ?? `settlement:${s.id}`,
      kind: s.kind === 'numeric' ? 'settlement' : 'subtitle',
      label: cue ? defaultSettlementText(cue) : s.text ?? s.presetId ?? '贴纸',
      x: s.x ?? 0.5,
      y: s.y ?? 0.42,
      layer: normalizeLayer(s.layer, 1),
      movable: true,
      target: { kind: 'sticker', stickerId: s.id },
    })
  }
  const goodWindow = scene.qte?.window?.good ?? 480
  for (const q of scene.qte?.cues ?? []) {
    if (ms < q.appearAt || ms > q.targetAt + goodWindow) continue
    out.push({
      id: `qte:${q.id}`,
      materialKey: `qte:${q.id}`,
      kind: 'qte',
      label: q.label ?? q.shape.toUpperCase(),
      x: q.x,
      y: q.y,
      layer: normalizeLayer(q.layer, 2),
      movable: true,
      target: { kind: 'qte', cueId: q.id },
    })
  }
  const decision = scene.decision
  if (decision && resolveOptType(decision) !== 'timed_qte') {
    const start = decision.windowStartMs ?? decision.atMs ?? 0
    const end = decision.windowEndMs ?? scene.durationMs
    if (ms >= start && ms <= end) {
      if (decision.presentation === 'hotspot') {
        for (const h of scene.hotspots ?? []) {
          if (h.detour) continue
          out.push({
            id: `option-hotspot:${h.id}`,
            materialKey: 'option:decision',
            kind: 'option',
            label: h.label ?? '选项',
            x: h.x,
            y: h.y,
            r: h.r,
            layer: normalizeLayer(decision.layer, 3),
            movable: true,
            target: { kind: 'hotspot', hotspotId: h.id },
          })
        }
      } else {
        out.push({
          id: 'option:list',
          materialKey: 'option:decision',
          kind: 'option',
          label: decision.prompt ?? '请选择',
          x: 0.5,
          y: 0.72,
          layer: normalizeLayer(decision.layer, 3),
          movable: false,
          target: { kind: 'readonly' },
        })
      }
    }
  }
  return out.sort((a, b) => a.layer - b.layer)
}

function firstTargetSceneId(scene: Scene, scenarioScenes: Record<string, Scene>): string {
  const firstOther = Object.keys(scenarioScenes).find((id) => id !== scene.id)
  return firstOther ?? scene.id
}

function upsertChoiceHotspot(scene: Scene, branch: Branch, patch: Partial<Hotspot>): Hotspot[] {
  const hotspots = scene.hotspots ?? []
  const existing =
    hotspots.find((h) => h.id === choiceHotspotId(branch.id)) ??
    hotspots.find((h) => h.id === branch.id) ??
    hotspots.find((h) => h.targetSceneId === branch.targetSceneId && !h.detour)
  const id = existing?.id ?? choiceHotspotId(branch.id)
  const next: Hotspot = {
    ...(existing ?? { id, x: 0.5, y: 0.55, mode: 'goto' as const }),
    ...patch,
    id,
    label: patch.label ?? existing?.label ?? branch.label ?? branch.targetSceneId,
    targetSceneId: branch.targetSceneId,
  }
  delete next.detour
  return [...hotspots.filter((h) => h.id !== id), next]
}

function numericTextValue(text: string | undefined): number | undefined {
  if (!text) return undefined
  const match = text.match(/-?\d+(\.\d+)?/)
  if (!match) return undefined
  const n = Number(match[0])
  return Number.isFinite(n) ? Math.abs(n) : undefined
}

function cueDamageValue(cue: PerformanceCue | undefined): number {
  const effect = cue?.effects.find((e): e is EntityStatEffect => e.kind === 'entityStat' && e.stat === 'hp')
  return Math.abs(Number(effect?.value ?? 100)) || 100
}

function defaultSettlementText(cue: PerformanceCue | undefined): string {
  const n = cueDamageValue(cue)
  return n === 0 ? '0' : `-${n}`
}

function firstEntityId(scenario: Scenario, kind: 'boss' | 'player'): string {
  return Object.values(scenario.entities ?? {}).find((e) => e.kind === kind)?.id ?? `ent-${kind}`
}

function cueTargetKind(cue: PerformanceCue | undefined, scenario: Scenario): 'boss' | 'player' {
  const effect = cue?.effects.find((e): e is EntityStatEffect => e.kind === 'entityStat' && e.stat === 'hp')
  const entity = effect ? scenario.entities?.[effect.entityId] : undefined
  return entity?.kind === 'player' ? 'player' : 'boss'
}

function cueWithHpEffect(
  cue: PerformanceCue,
  scenario: Scenario,
  target: 'boss' | 'player',
  amount: number,
): PerformanceCue {
  const entityId = firstEntityId(scenario, target)
  const effectId = `${cue.id}-${target}-hp`
  const nextEffect: EntityStatEffect = {
    id: effectId,
    kind: 'entityStat',
    entityId,
    stat: 'hp',
    op: 'add',
    value: -Math.abs(amount),
  }
  const replaced = cue.effects.some((e) => e.kind === 'entityStat' && e.stat === 'hp')
  return {
    ...cue,
    effects: replaced
      ? cue.effects.map((e) => (e.kind === 'entityStat' && e.stat === 'hp' ? nextEffect : e))
      : [nextEffect, ...cue.effects],
  }
}

function materialDisabledReason(template: MaterialTemplate, scene: Scene | undefined, hasVideo: boolean): string | undefined {
  if (!scene || !hasVideo) return '当前节点未绑定视频素材'
  const hasQteResultBranches = scene.branches.some((b) => b.kind === 'qte_pass' || b.kind === 'qte_fail')
  const hasBoss = !!scene.boss
  if (template === 'option' && scene.decision && resolveOptType(scene.decision) === 'timed_qte') {
    return '限时 QTE 节点请编辑「QTE 窗口」轨，不添加选项'
  }
  if (template === 'option' && hasQteResultBranches) {
    return 'QTE 节点请使用成功/失败分支，不配置普通选项'
  }
  if (template === 'option' && hasBoss) {
    return 'Boss战节点以回合交互为主，不配置普通选项'
  }
  return undefined
}

export function VideoCatalogTab() {
  const listBodyRef = useRef<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<string>(VIDEO_CLIPS[0]?.id ?? '')
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [contentRect, setContentRect] = useState<VideoContentRect | null>(null)
  const [sideMode, setSideMode] = useState<'library' | 'inspector' | null>(null)
  const [selectedMaterialKey, setSelectedMaterialKey] = useState<string | null>(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState<number | null>(null)
  const [overlayDragId, setOverlayDragId] = useState<string | null>(null)
  const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null)
  const [drag, setDrag] = useState<{
    key: string
    mode: 'move' | 'start' | 'end'
    pointerX: number
    startMs: number
    endMs: number
    layer: number
  } | null>(null)
  const scenario = useScenarioStore((s) => s.scenario)
  const selectedSceneId = useScenarioStore((s) => s.selectedSceneId)
  const forgeView = useShellStore((s) => s.forgeView)
  const updateScene = useScenarioStore((s) => s.updateScene)
  const scene = scenario.scenes[selectedSceneId]
  const selectedClip = VIDEO_CLIPS.find((v) => v.id === selectedId)
  const boundClip = VIDEO_CLIPS.find((v) => v.id === scene?.clipId)
  const previewClip = selectedClip ?? boundClip
  const editingBoundClip = Boolean(boundClip && previewClip && boundClip.id === previewClip.id)
  const timelineClip = editingBoundClip ? boundClip : previewClip
  const maxMs = Math.max(1000, videoDurationMs ?? timelineClip?.durMs ?? scene?.durationMs ?? 0)
  const hasEditableVideo = Boolean(scene && editingBoundClip && timelineClip)
  const isTimedQteNode = scene?.decision ? resolveOptType(scene.decision) === 'timed_qte' : false
  const materials = useMemo(() => (scene ? collectMaterials(scene) : []), [scene])
  const previewOverlays = useMemo(
    () => (scene && editingBoundClip ? activePreviewOverlays(scene, materials, playheadMs) : []),
    [scene, editingBoundClip, materials, playheadMs],
  )
  const selectedMaterial = materials.find((m) => m.key === selectedMaterialKey) ?? null
  const settlementDisabled = materialDisabledReason('settlement', scene, hasEditableVideo)
  const qteDisabled = materialDisabledReason('qte', scene, hasEditableVideo)
  const optionDisabled = materialDisabledReason('option', scene, hasEditableVideo)

  // 切到视频视图 / 换节点时，左栏跟随当前节点绑定的 clipId（避免总从第一条开始）。
  useEffect(() => {
    const clipId = scene?.clipId
    if (!clipId || !VIDEO_CLIPS.some((v) => v.id === clipId)) return
    setSelectedId(clipId)
    requestAnimationFrame(() => {
      listBodyRef.current
        ?.querySelector(`[data-clip-id="${clipId}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }, [forgeView, selectedSceneId, scene?.clipId])

  useEffect(() => {
    if (selectedMaterialKey === 'option:qte-window') setSelectedMaterialKey('qte-window')
  }, [selectedMaterialKey])

  useEffect(() => {
    setVideoDurationMs(null)
    setPlayheadMs(0)
    setContentRect(null)
  }, [timelineClip?.id, scene?.id, editingBoundClip])

  useEffect(() => {
    const v = videoRef.current
    if (!v) {
      setContentRect(null)
      return
    }
    let frame = 0
    const update = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = computeVideoContentRect(v)
        if (rect) setContentRect(rect)
      })
    }
    update()
    v.addEventListener('loadedmetadata', update)
    window.addEventListener('resize', update)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      v.removeEventListener('loadedmetadata', update)
      window.removeEventListener('resize', update)
    }
  }, [timelineClip?.id, editingBoundClip])

  function setPrompt(next: string): void {
    if (!scene) return
    const prompts = { ...(scene.prompts ?? { scene: scene.media.prompt ?? '' }) }
    if (next) prompts.video = next
    else delete prompts.video
    updateScene(scene.id, {
      prompts,
    })
  }

  function patchMaterial(item: MaterialItem, patch: { startMs?: number; endMs?: number; layer?: number }): void {
    if (!scene) return
    const start = clampMs(patch.startMs ?? item.startMs, 0, Math.max(0, maxMs - 100))
    const end = clampMs(patch.endMs ?? item.endMs, start + 100, maxMs)
    const layer = patch.layer == null ? item.layer : clampLayer(patch.layer)
    switch (item.kind) {
      case 'subtitle':
        updateScene(scene.id, {
          dialogue: (scene.dialogue ?? []).map((d) =>
            d.id === item.id ? { ...d, startMs: start, endMs: end, layer } : d,
          ),
        })
        break
      case 'settlement': {
        const cueId = item.cueId ?? item.id
        const stickerId = item.stickerId ?? item.id
        const nextCue: PerformanceCue = { id: cueId, atMs: start, label: item.label, layer, effects: [] }
        updateScene(scene.id, {
          performance: {
          cues: (scene.performance?.cues ?? []).some((c) => c.id === cueId)
            ? (scene.performance?.cues ?? []).map((c) =>
              c.id === cueId ? { ...c, atMs: start, layer } : c,
            )
            : [...(scene.performance?.cues ?? []), nextCue],
          },
          stickerClips: (scene.stickerClips ?? []).map((c) =>
            c.id === stickerId ? { ...c, startMs: start, endMs: end, layer } : c,
          ),
        })
        break
      }
      case 'qte':
        updateScene(scene.id, {
          qte: scene.qte
            ? {
                ...scene.qte,
                cues: scene.qte.cues.map((c) =>
                  c.id === item.id ? { ...c, appearAt: start, targetAt: end, layer } : c,
                ),
              }
            : undefined,
          ...(scene.decision?.optType === 'timed_qte' && scene.qte
            ? {
                decision: {
                  ...scene.decision,
                  windowEndMs: qteInteractionWindowEnd(scene, {
                    ...scene.qte,
                    cues: scene.qte.cues.map((c) =>
                      c.id === item.id ? { ...c, appearAt: start, targetAt: end, layer } : c,
                    ),
                  }),
                },
              }
            : {}),
        })
        break
      case 'qte_window':
        updateScene(scene.id, {
          decision: scene.decision
            ? { ...scene.decision, windowStartMs: start, windowEndMs: end, layer }
            : undefined,
        })
        break
      case 'option':
        updateScene(scene.id, {
          decision: scene.decision
            ? { ...scene.decision, windowStartMs: start, windowEndMs: end, layer }
            : undefined,
          branches: scene.branches.map((b) => (b.kind === 'choice' ? { ...b, showAt: start } : b)),
        })
        break
    }
  }

  function addMaterial(template: MaterialTemplate): void {
    if (!scene || !timelineClip) return
    const startMs = 0
    const endMs = clampMs(2500, 100, maxMs)
    if (template === 'subtitle') {
      const id = `d-${Date.now().toString(36)}`
      const line: DialogueLine = {
        id,
        role: 'narration',
        text: '新字幕',
        startMs,
        endMs,
        layer: 0,
      }
      updateScene(scene.id, { dialogue: [...(scene.dialogue ?? []), line] })
      setSelectedMaterialKey(`subtitle:${id}`)
    } else if (template === 'settlement') {
      const id = `settle-${Date.now().toString(36)}`
      const clip: StickerClip = {
        id,
        performanceCueId: id,
        startMs,
        endMs,
        kind: 'numeric',
        text: '-100',
        x: 0.5,
        y: 0.42,
        sizePct: 12,
        scale: 1,
        rotation: 0,
        opacity: 1,
        enter: 'pop',
        layer: 1,
      }
      updateScene(scene.id, {
        performance: {
          cues: [
            ...(scene.performance?.cues ?? []),
            cueWithHpEffect({ id, atMs: startMs, label: '命中', layer: 1, effects: [] }, scenario, 'boss', 100),
          ],
        },
        stickerClips: [...(scene.stickerClips ?? []), clip],
      })
      setSelectedMaterialKey(`settlement:${id}`)
    } else if (template === 'qte') {
      addQteCue()
    } else {
      const existingChoice = scene.branches.find((b) => b.kind === 'choice')
      const branch: Branch =
        existingChoice ??
        {
          id: `b-${Date.now().toString(36)}`,
          kind: 'choice',
          label: '新选项',
          targetSceneId: firstTargetSceneId(scene, scenario.scenes),
          showAt: startMs,
        }
      const nextBranches = existingChoice
        ? scene.branches
        : [...scene.branches, branch]
      const nextDecision = {
        ...(scene.decision ?? {}),
        optType: scene.decision?.optType ?? 'static',
        mode: scene.decision?.mode ?? 'pause',
        presentation: scene.decision?.presentation ?? 'list',
        windowStartMs: startMs,
        windowEndMs: endMs,
        layer: normalizeLayer(scene.decision?.layer, 3),
        prompt: scene.decision?.prompt ?? '请选择',
      } as DecisionSpec
      updateScene(scene.id, {
        kind: 'choice',
        decision: nextDecision,
        branches: nextBranches,
      })
      setSelectedMaterialKey('option:decision')
    }
    setSideMode('inspector')
  }

  function patchSelected(patch: Record<string, unknown>): void {
    if (!scene || !selectedMaterial) return
    if (selectedMaterial.kind === 'subtitle') {
      updateScene(scene.id, {
        dialogue: (scene.dialogue ?? []).map((d) =>
          d.id === selectedMaterial.id ? { ...d, ...patch } : d,
        ),
      })
    } else if (selectedMaterial.kind === 'settlement') {
      const cueId = selectedMaterial.cueId ?? selectedMaterial.id
      const cue = (scene.performance?.cues ?? []).find((c) => c.id === cueId)
      const pairedSticker = cue ? findStickerForCue(scene, cue) : undefined
      const stickerId = selectedMaterial.stickerId ?? pairedSticker?.id ?? selectedMaterial.id
      let cuePatch: Partial<PerformanceCue> = {}
      const stickerPatch: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'effectTarget') {
          if (cue) cuePatch = cueWithHpEffect({ ...cue, ...cuePatch }, scenario, value === 'player' ? 'player' : 'boss', cueDamageValue({ ...cue, ...cuePatch }))
        } else if (key === 'effectValue') {
          if (cue) cuePatch = cueWithHpEffect({ ...cue, ...cuePatch }, scenario, cueTargetKind({ ...cue, ...cuePatch }, scenario), Number(value) || 0)
        } else if (key === 'label' || key === 'layer') {
          cuePatch = { ...cuePatch, [key]: value }
        } else {
          stickerPatch[key] = value
        }
      }
      if (cuePatch.layer !== undefined) stickerPatch.layer = cuePatch.layer
      if (Object.prototype.hasOwnProperty.call(patch, 'effectTarget') || Object.prototype.hasOwnProperty.call(patch, 'effectValue')) {
        if (cue) {
          const nextCue = { ...cue, ...cuePatch }
          stickerPatch.performanceCueId = cueId
          stickerPatch.text = defaultSettlementText(nextCue)
        }
      }
      updateScene(scene.id, {
        performance: {
          cues: (scene.performance?.cues ?? []).map((c) =>
            c.id === cueId ? { ...c, ...cuePatch } : c,
          ),
        },
        stickerClips: (scene.stickerClips ?? []).map((c) =>
          c.id === stickerId ? { ...c, ...stickerPatch } : c,
        ),
      })
    } else if (selectedMaterial.kind === 'qte') {
      updateScene(scene.id, {
        qte: scene.qte
          ? {
              ...scene.qte,
              cues: scene.qte.cues.map((c) =>
                c.id === selectedMaterial.id ? { ...c, ...patch } : c,
              ),
            }
          : undefined,
      })
    } else if (selectedMaterial.kind === 'qte_window' || selectedMaterial.kind === 'option') {
      const decisionPatch = patch as Partial<NonNullable<Scene['decision']>>
      const nextDecision = scene.decision ? { ...scene.decision, ...decisionPatch } : undefined
      const nextQte =
        selectedMaterial.kind === 'qte_window' &&
        Object.prototype.hasOwnProperty.call(patch, 'timeoutMs') &&
        scene.qte
          ? { ...scene.qte, timeoutMs: patch.timeoutMs as number | undefined }
          : scene.qte
      const nextScene = { ...scene, decision: nextDecision, qte: nextQte }
      const windowEndMs =
        selectedMaterial.kind === 'qte_window' && nextDecision?.optType === 'timed_qte' && nextQte
          ? qteInteractionWindowEnd(nextScene)
          : nextDecision?.windowEndMs
      updateScene(scene.id, {
        decision:
          nextDecision != null
            ? {
                ...nextDecision,
                ...(windowEndMs != null ? { windowEndMs } : {}),
              }
            : undefined,
        ...(nextQte ? { qte: nextQte } : {}),
      })
    }
  }

  function setSettlementMode(item: MaterialItem, mode: SettlementMode): void {
    if (!scene || item.kind !== 'settlement') return
    const cueId = item.cueId ?? item.id
    const stickerId = item.stickerId ?? item.id
    const cues = scene.performance?.cues ?? []
    const cue = cues.find((c) => c.id === cueId)
    const stickers = scene.stickerClips ?? []
    const sticker = stickers.find((s) => s.id === stickerId)
    const nextSticker: StickerClip = sticker ?? {
      id: stickerId,
      startMs: item.startMs,
      endMs: item.endMs,
      kind: 'numeric',
      text: cue ? defaultSettlementText(cue) : item.label || '飘字',
      x: 0.5,
      y: 0.42,
      sizePct: 12,
      scale: 1,
      rotation: 0,
      opacity: 1,
      enter: 'pop',
      layer: item.layer,
    }
    const nextStickers = sticker
      ? stickers
      : [...stickers, nextSticker]

    if (mode === 'text') {
      updateScene(scene.id, {
        performance: { cues: cues.filter((c) => c.id !== cueId) },
        stickerClips: nextStickers.map((s) =>
          s.id === stickerId ? { ...s, performanceCueId: undefined } : s,
        ),
      })
      setSelectedMaterialKey(`settlement:${stickerId}`)
      return
    }

    const damage = cueDamageValue(cue) || numericTextValue(nextSticker.text) || 100
    const baseCue: PerformanceCue = cue ?? {
      id: cueId,
      atMs: item.startMs,
      label: '命中',
      layer: item.layer,
      effects: [],
    }
    const nextCue = cueWithHpEffect(baseCue, scenario, 'boss', damage)
    const damageSticker = { ...nextSticker, performanceCueId: nextCue.id, text: defaultSettlementText(nextCue) }
    updateScene(scene.id, {
      performance: {
        cues: cue
          ? cues
          : [...cues, nextCue],
      },
      stickerClips: sticker
        ? stickers.map((s) => (s.id === stickerId ? damageSticker : s))
        : [...stickers, damageSticker],
    })
    setSelectedMaterialKey(`settlement:${cueId}`)
  }

  function patchHotspot(hotspotId: string, patch: Partial<Hotspot>): void {
    if (!scene) return
    updateScene(scene.id, {
      hotspots: (scene.hotspots ?? []).map((h) =>
        h.id === hotspotId ? { ...h, ...patch } : h,
      ),
    })
  }

  function addQteCue(afterCueId?: string): void {
    if (!scene) return
    const cues = scene.qte?.cues ?? []
    const base = afterCueId ? cues.find((cue) => cue.id === afterCueId) : cues[cues.length - 1]
    const start = clampMs((base?.targetAt ?? playheadMs) + 500, 0, Math.max(0, maxMs - 100))
    const end = clampMs(start + 800, start + 100, maxMs)
    const id = `q-${Date.now().toString(36)}`
    const cue: QTECue = {
      id,
      shape: base?.shape ?? 'tap',
      triggerKey: base?.triggerKey,
      x: base?.x ?? 0.5,
      y: base?.y ?? 0.55,
      appearAt: start,
      targetAt: end,
      label: `QTE ${cues.length + 1}`,
      layer: base?.layer ?? 2,
    }
    const nextCues = [...cues, cue]
    const nextQte = scene.qte
      ? { ...scene.qte, cues: nextCues }
      : {
          cues: nextCues,
          window: { perfect: 120, great: 280, good: 480 },
          score: { perfect: 100, great: 60, good: 30, miss: 0 },
        }
    const nextExt: Record<string, unknown> = { ...(scene.ext ?? {}) }
    if (nextCues.length > 1 && nextExt.qteUi === 'battleParry') {
      delete nextExt.qteUi
    }
    updateScene(scene.id, {
      kind: 'qte',
      qte: nextQte,
      ext: Object.keys(nextExt).length > 0 ? nextExt : undefined,
      ...(scene.decision?.optType === 'timed_qte'
        ? {
            decision: {
              ...scene.decision,
              windowEndMs: qteInteractionWindowEnd(scene, nextQte),
            },
          }
        : {}),
    })
    setSelectedMaterialKey(`qte:${id}`)
  }

  function removeQteCue(cueId: string): void {
    if (!scene?.qte) return
    const cues = scene.qte.cues.filter((cue) => cue.id !== cueId)
    updateScene(scene.id, { qte: cues.length ? { ...scene.qte, cues } : undefined })
    if (selectedMaterialKey === `qte:${cueId}`) setSelectedMaterialKey(cues[0] ? `qte:${cues[0].id}` : null)
  }

  function patchOverlayPosition(overlay: PreviewOverlay, x: number, y: number): void {
    if (!scene || !overlay.movable) return
    const target = overlay.target
    switch (target.kind) {
      case 'sticker': {
        const stickerId = target.stickerId
        updateScene(scene.id, {
          stickerClips: (scene.stickerClips ?? []).map((c) =>
            c.id === stickerId ? { ...c, x, y } : c,
          ),
        })
        break
      }
      case 'qte': {
        const cueId = target.cueId
        updateScene(scene.id, {
          qte: scene.qte
            ? {
                ...scene.qte,
                cues: scene.qte.cues.map((c) =>
                  c.id === cueId ? { ...c, x, y } : c,
                ),
              }
            : undefined,
        })
        break
      }
      case 'hotspot':
        patchHotspot(target.hotspotId, { x, y })
        break
      case 'readonly':
        break
    }
  }

  function positionFromFrame(e: React.PointerEvent): { x: number; y: number } | null {
    const frame = frameRef.current
    if (!frame) return null
    return pointerToVideoNorm(e.clientX, e.clientY, frame, videoRef.current)
  }

  const previewContentStyle = contentRect
    ? {
        left: `${contentRect.left}px`,
        top: `${contentRect.top}px`,
        width: `${contentRect.width}px`,
        height: `${contentRect.height}px`,
      }
    : undefined

  function onOverlayPointerDown(e: React.PointerEvent<HTMLDivElement>, overlay: PreviewOverlay): void {
    e.preventDefault()
    e.stopPropagation()
    setSelectedMaterialKey(overlay.materialKey)
    setSideMode('inspector')
    setActiveHotspotId(overlay.target.kind === 'hotspot' ? overlay.target.hotspotId : null)
    if (!overlay.movable) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setOverlayDragId(overlay.id)
    const pos = positionFromFrame(e)
    if (pos) patchOverlayPosition(overlay, pos.x, pos.y)
  }

  function onOverlayPointerMove(e: React.PointerEvent<HTMLDivElement>, overlay: PreviewOverlay): void {
    if (overlayDragId !== overlay.id) return
    const pos = positionFromFrame(e)
    if (pos) patchOverlayPosition(overlay, pos.x, pos.y)
  }

  function onOverlayPointerUp(): void {
    setOverlayDragId(null)
    setActiveHotspotId(null)
  }

  function onPointerDown(e: React.PointerEvent, item: MaterialItem, mode: 'move' | 'start' | 'end'): void {
    e.preventDefault()
    e.stopPropagation()
    timelineRef.current?.setPointerCapture(e.pointerId)
    setSelectedMaterialKey(item.key)
    setSideMode('inspector')
    setDrag({ key: item.key, mode, pointerX: e.clientX, startMs: item.startMs, endMs: item.endMs, layer: item.layer })
  }

  function onPointerMove(e: React.PointerEvent): void {
    if (!drag) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const item = materials.find((m) => m.key === drag.key)
    if (!item) return
    const deltaMs = ((e.clientX - drag.pointerX) / rect.width) * maxMs
    const nextLayer = drag.mode === 'move' ? layerFromPointerY(e.clientY, rect) : drag.layer
    const span = drag.endMs - drag.startMs
    if (drag.mode === 'move') {
      const start = clampMs(drag.startMs + deltaMs, 0, Math.max(0, maxMs - span))
      patchMaterial(item, { startMs: start, endMs: start + span, layer: nextLayer })
    } else if (drag.mode === 'start') {
      patchMaterial(item, { startMs: drag.startMs + deltaMs, endMs: drag.endMs })
    } else {
      patchMaterial(item, { startMs: drag.startMs, endMs: drag.endMs + deltaMs })
    }
  }

  function onPointerUp(): void {
    setDrag(null)
  }

  return (
    <div className={`gc-tab gc-tab-video${sideMode ? ' has-sidepanel' : ''}`}>
      <aside className="gc-list" aria-label="视频">
        <div className="gc-list-head">
          <span className="gc-list-ico" aria-hidden>🎥</span>
          <span className="gc-list-title">视频素材</span>
          <span className="gc-list-count">{VIDEO_CLIPS.length}</span>
        </div>
        <div className="gc-list-body" ref={listBodyRef}>
          {VIDEO_CLIPS.map((it) => (
            <button
              key={it.id}
              type="button"
              data-clip-id={it.id}
              className={`gc-row${it.id === selectedId ? ' is-on' : ''}`}
              onClick={() => setSelectedId(it.id)}
            >
              <span className="gc-row-mark" aria-hidden>✓</span>
              <span className="gc-row-label">{it.label}</span>
            </button>
          ))}
        </div>
      </aside>
      <section className="gc-preview">
        {timelineClip ? (
          <div className="gc-stage gc-stage-video">
            <div className="gc-video-head">
              <div>
                <div className="gc-video-title">{timelineClip.label}</div>
                <div className="gc-video-sub">
                  {!scene
                    ? '素材预览 · 未选中节点'
                    : editingBoundClip
                    ? `当前节点 · ${scene.title}`
                    : boundClip
                      ? `素材预览 · 当前节点绑定 ${boundClip.label}`
                      : '素材预览 · 当前节点未绑定演出'}
                </div>
              </div>
              <button
                type="button"
                className="gc-action"
                onClick={() => {
                  if (!scene) return
                  if (previewClip && !editingBoundClip) {
                    updateScene(scene.id, {
                      clipId: previewClip.id,
                      durationMs: previewClip.durMs ?? scene.durationMs,
                    })
                    return
                  }
                  setSideMode('library')
                }}
              >
                {scene ? (editingBoundClip ? '添加控件' : '绑定到当前节点') : '选择节点后绑定'}
              </button>
            </div>
            <div className="gc-video-top">
              <div ref={frameRef} className="gc-frame" data-type={timelineClip.type ?? 'video'}>
                <span className="gc-badge">
                  {timelineClip.label}
                  {timelineClip.type ? <em>{timelineClip.type}</em> : null}
                </span>
                <video
                  key={timelineClip.id}
                  ref={videoRef}
                  className="gc-video"
                  src={timelineClip.url}
                  controls
                  autoPlay
                  muted
                  playsInline
                  loop={timelineClip.type === 'loop'}
                  onLoadedMetadata={(e) => {
                    const dur = e.currentTarget.duration
                    if (Number.isFinite(dur) && dur > 0) {
                      const ms = Math.round(dur * 1000)
                      setVideoDurationMs(ms)
                      if (scene && editingBoundClip && scene.durationMs !== ms) updateScene(scene.id, { durationMs: ms })
                    }
                  }}
                  onTimeUpdate={(e) => setPlayheadMs(clampMs(e.currentTarget.currentTime * 1000, 0, maxMs))}
                  onSeeked={(e) => setPlayheadMs(clampMs(e.currentTarget.currentTime * 1000, 0, maxMs))}
                  onEnded={() => setPlayheadMs(maxMs)}
                />
                <div className="gc-content-anchor" style={previewContentStyle}>
                <div className="gc-preview-overlays">
                  {previewOverlays.map((o) => {
                    const selected = selectedMaterialKey === o.materialKey
                    return (
                      <div
                        key={o.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`${materialLabel(o.kind)}：${o.label}${o.movable ? '，可拖动' : ''}`}
                        className={`gc-preview-overlay ${materialClass(o.kind)}${selected ? ' is-selected' : ''}${o.movable ? ' is-movable' : ''}${o.target.kind === 'hotspot' && activeHotspotId === o.target.hotspotId ? ' is-hotspot-editing' : ''}`}
                        style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, zIndex: 20 + o.layer }}
                        onPointerDown={(e) => onOverlayPointerDown(e, o)}
                        onPointerMove={(e) => onOverlayPointerMove(e, o)}
                        onPointerUp={onOverlayPointerUp}
                        onLostPointerCapture={onOverlayPointerUp}
                      >
                        {o.kind === 'qte' ? <span className="gc-preview-ring" /> : null}
                        {o.kind === 'option' && o.target.kind === 'hotspot' ? (
                          <span
                            className="gc-preview-hotspot-ring"
                            style={{ ['--gc-hotspot-r' as string]: `${(o.r ?? 0.08) * 200}%` }}
                          />
                        ) : null}
                        <span className="gc-preview-label">{o.label}</span>
                      </div>
                    )
                  })}
                </div>
                </div>
              </div>
              <label className="gc-prompt">
                <span>提示词</span>
                <textarea
                  value={scene?.prompts?.video ?? ''}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={!scene}
                  placeholder="写给视频生成模型的镜头、动作、氛围提示词"
                />
              </label>
            </div>
            {editingBoundClip ? (
              <>
                <div className="gc-materialbar">
                  <span className="gc-materialbar-meta">时间轴 · {fmtDur(maxMs)}</span>
                  {isTimedQteNode ? (
                    <span className="gc-materialbar-hint">
                      蓝实线 = QTE 按键点 · 青虚线 = QTE 窗口（整段限时，非选项）
                    </span>
                  ) : null}
                </div>
                <div
                  ref={timelineRef}
                  className="gc-mtimeline"
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onLostPointerCapture={onPointerUp}
                >
                  <div className="gc-mtimeline-ruler" />
                  <div
                    className="gc-playhead"
                    style={{ left: `${Math.max(0, Math.min(100, (playheadMs / maxMs) * 100))}%` }}
                    aria-hidden
                  />
                  {materials.map((m) => {
                    const left = (m.startMs / maxMs) * 100
                    const width = Math.max(2, ((m.endMs - m.startMs) / maxMs) * 100)
                    const selected = selectedMaterialKey === m.key
                    return (
                      <div
                        key={m.key}
                        className={`gc-mclip ${materialClass(m.kind)}${selected ? ' is-selected' : ''}`}
                        style={{ left: `${left}%`, width: `${width}%`, top: `${layerTop(m.layer)}px` }}
                        onPointerDown={(e) => onPointerDown(e, m, 'move')}
                        title={`${materialDisplayLabel(m)} · ${fmtDur(m.startMs)} - ${fmtDur(m.endMs)}`}
                      >
                        <button className="gc-mhandle is-left" onPointerDown={(e) => onPointerDown(e, m, 'start')} aria-label="调整起点" />
                        <span>{materialDisplayLabel(m)}{m.label ? ` · ${m.label}` : ''}</span>
                        <button className="gc-mhandle is-right" onPointerDown={(e) => onPointerDown(e, m, 'end')} aria-label="调整终点" />
                      </div>
                    )
                  })}
                  {materials.length === 0 && <div className="gc-mempty">打开素材库，把控件加入当前节点时间轴</div>}
                </div>
              </>
            ) : (
              <div className="gc-readonly-note">
                这是素材预览。绑定到当前节点后可编辑时间轴控件。
              </div>
            )}
          </div>
        ) : (
          <EmptyPreview text="选择一个视频素材以预览" />
        )}
      </section>
      {sideMode && (
        <aside className="gc-sidepanel">
          <div className="gc-side-head">
            <strong>{sideMode === 'library' ? '素材库' : '素材属性'}</strong>
            <button type="button" onClick={() => setSideMode(null)}>关闭</button>
          </div>
          {sideMode === 'library' ? (
            <div className="gc-lib-grid">
              <MaterialCard
                title="字幕"
                desc="底栏对白/旁白字幕，可拖动显示时段。"
                disabledReason={materialDisabledReason('subtitle', scene, hasEditableVideo)}
                onClick={() => addMaterial('subtitle')}
              />
              <MaterialCard
                title="结算飘字"
                desc="到点结算伤害，并在画面上弹出数字。"
                disabledReason={settlementDisabled}
                onClick={() => addMaterial('settlement')}
              />
              <MaterialCard
                title="QTE 按键点"
                desc={
                  isTimedQteNode
                    ? '单个按键的时刻与坐标；整段限时在「QTE 窗口」轨编辑。'
                    : '限时按键点，写入当前节点 QTE 轨。'
                }
                disabledReason={qteDisabled}
                onClick={() => addMaterial('qte')}
              />
              {isTimedQteNode ? (
                <MaterialCard
                  title="QTE 窗口"
                  desc="整段 QTE 何时生效、超时多久；时间轴已自动生成该轨。"
                  onClick={() => {
                    setSelectedMaterialKey('qte-window')
                    setSideMode('inspector')
                  }}
                />
              ) : (
                <MaterialCard
                  title="选项"
                  desc="添加节点选项，可切换清单或画面热区。"
                  disabledReason={optionDisabled}
                  onClick={() => addMaterial('option')}
                />
              )}
            </div>
          ) : (
            <MaterialInspector
              scenario={scenario}
              scene={scene}
              item={selectedMaterial}
              onPatch={patchSelected}
              onTiming={(item, start, end) => patchMaterial(item, { startMs: start, endMs: end })}
              onPatchHotspot={patchHotspot}
              onHotspotDragState={setActiveHotspotId}
              onAddQteCue={addQteCue}
              onRemoveQteCue={removeQteCue}
              onSelectQteCue={(cueId) => setSelectedMaterialKey(`qte:${cueId}`)}
              onSettlementMode={setSettlementMode}
            />
          )}
        </aside>
      )}
    </div>
  )
}

function MaterialCard({
  title,
  desc,
  disabledReason,
  onClick,
}: {
  title: string
  desc: string
  disabledReason?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`gc-lib-item${disabledReason ? ' is-disabled' : ''}`}
      onClick={disabledReason ? undefined : onClick}
      disabled={!!disabledReason}
      title={disabledReason}
    >
      <strong>{title}</strong>
      <span>{disabledReason ?? desc}</span>
    </button>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  unit,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (value: number) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const rounded = Math.round(value * 10) / 10
  return (
    <label className="gc-range-field">
      <span>
        {label}
        <b>{rounded}{unit}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={0.5}
        value={rounded}
        onPointerDown={onDragStart}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onBlur={onDragEnd}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function MaterialInspector({
  scenario,
  scene,
  item,
  onPatch,
  onTiming,
  onPatchHotspot,
  onHotspotDragState,
  onAddQteCue,
  onRemoveQteCue,
  onSelectQteCue,
  onSettlementMode,
}: {
  scenario: Scenario
  scene: Scene | undefined
  item: MaterialItem | null
  onPatch: (patch: Record<string, unknown>) => void
  onTiming: (item: MaterialItem, startMs: number, endMs: number) => void
  onPatchHotspot: (hotspotId: string, patch: Partial<Hotspot>) => void
  onHotspotDragState: (hotspotId: string | null) => void
  onAddQteCue: (afterCueId?: string) => void
  onRemoveQteCue: (cueId: string) => void
  onSelectQteCue: (cueId: string) => void
  onSettlementMode: (item: MaterialItem, mode: SettlementMode) => void
}) {
  if (!scene || !item) {
    return (
      <div className="gc-inspector-empty">
        <span>选择时间轴上的素材以编辑属性</span>
      </div>
    )
  }
  const cue =
    item.kind === 'settlement'
      ? (scene.performance?.cues ?? []).find((c) => c.id === (item.cueId ?? item.id))
      : undefined
  const sticker =
    item.kind === 'settlement'
      ? (scene.stickerClips ?? []).find((c) => c.id === (item.stickerId ?? item.id))
      : undefined
  const current =
    item.kind === 'subtitle'
      ? scene.dialogue.find((d) => d.id === item.id)
      : item.kind === 'qte'
      ? scene.qte?.cues.find((c) => c.id === item.id)
      : item.kind === 'qte_window' || item.kind === 'option'
        ? scene.decision
        : undefined
  const branches = scene.branches.filter((b) => b.kind === 'choice')
  const firstBranch = branches[0]
  const firstHotspot = firstBranch
    ? (scene.hotspots ?? []).find((h) => h.id === choiceHotspotId(firstBranch.id) || h.targetSceneId === firstBranch.targetSceneId)
    : undefined
  const settlementMode: SettlementMode = cue ? 'damage' : 'text'
  return (
    <div className="gc-inspector-card">
      <div className="gc-inspector-title">{materialDisplayLabel(item)}</div>
      <div className="gc-field-row">
        <label>
          <span>开始</span>
          <input type="number" value={item.startMs} onChange={(e) => onTiming(item, Number(e.target.value), item.endMs)} />
        </label>
        <label>
          <span>结束</span>
          <input type="number" value={item.endMs} onChange={(e) => onTiming(item, item.startMs, Number(e.target.value))} />
        </label>
      </div>
      {item.kind === 'subtitle' && current && 'role' in current && (
        <>
          <label className="gc-field">
            <span>文本</span>
            <input value={current.text} onChange={(e) => onPatch({ text: e.target.value })} />
          </label>
          <label className="gc-field">
            <span>类型</span>
            <select value={current.role} onChange={(e) => onPatch({ role: e.target.value })}>
              <option value="narration">旁白</option>
              <option value="character">对白</option>
              <option value="protagonist">主角</option>
              <option value="system">系统</option>
            </select>
          </label>
          {current.role === 'character' && (
            <label className="gc-field">
              <span>署名</span>
              <input value={current.speaker ?? ''} onChange={(e) => onPatch({ speaker: e.target.value || undefined })} />
            </label>
          )}
        </>
      )}
      {item.kind === 'settlement' && (
        <>
          <label className="gc-field">
            <span>模式</span>
            <select
              value={settlementMode}
              onChange={(e) => onSettlementMode(item, e.target.value as SettlementMode)}
            >
              <option value="damage">伤害结算</option>
              <option value="text">文本</option>
            </select>
          </label>
          {settlementMode === 'damage' && (
            <label className="gc-field">
              <span>计算标签</span>
              <input
                value={cue?.label ?? ''}
                onChange={(e) => onPatch({ label: e.target.value || undefined })}
              />
            </label>
          )}
          {settlementMode === 'damage' && (
          <label className="gc-field">
            <span>结算目标</span>
            <select
              value={cueTargetKind(cue, scenario)}
              onChange={(e) =>
                onPatch({ effectTarget: e.target.value })
              }
            >
              <option value="boss">Boss</option>
              <option value="player">玩家</option>
            </select>
          </label>
          )}
          {settlementMode === 'damage' && (
          <label className="gc-field">
            <span>伤害数值</span>
            <input
              type="number"
              value={cueDamageValue(cue)}
              onChange={(e) =>
                onPatch({ effectValue: Number(e.target.value) || 0 })
              }
            />
          </label>
          )}
          <label className="gc-field">
            <span>显示文字</span>
            <input
              type={settlementMode === 'damage' ? 'number' : 'text'}
              value={settlementMode === 'damage' ? cueDamageValue(cue) : sticker?.text ?? ''}
              title={settlementMode === 'damage' ? '伤害结算模式下只能输入数字，并同步到判定项' : undefined}
              onChange={(e) => {
                if (settlementMode === 'damage') {
                  onPatch({ effectValue: Number(e.target.value) || 0 })
                } else {
                  onPatch({ text: e.target.value })
                }
              }}
            />
          </label>
          <div className="gc-field-row">
            <label>
              <span>X%</span>
              <input type="number" value={Math.round((sticker?.x ?? 0.5) * 100)} onChange={(e) => onPatch({ x: Number(e.target.value) / 100 })} />
            </label>
            <label>
              <span>Y%</span>
              <input type="number" value={Math.round((sticker?.y ?? 0.42) * 100)} onChange={(e) => onPatch({ y: Number(e.target.value) / 100 })} />
            </label>
          </div>
        </>
      )}
      {item.kind === 'qte' && current && 'shape' in current && (
        <>
          <div className="gc-qte-cues-head">
            <span>按键点 · {scene.qte?.cues.length ?? 0}</span>
            <button type="button" className="gc-mini-action" onClick={() => onAddQteCue(current.id)}>
              + 添加按键点
            </button>
          </div>
          <div className="gc-qte-cue-list">
            {(scene.qte?.cues ?? []).map((cue, i) => (
              <button
                key={cue.id}
                type="button"
                className={`gc-qte-cue-chip${cue.id === current.id ? ' is-on' : ''}`}
                onClick={() => onSelectQteCue(cue.id)}
                onDoubleClick={() => onRemoveQteCue(cue.id)}
                title="双击删除该按键点"
              >
                {i + 1}. {cue.triggerKey || cue.label || cue.shape}
              </button>
            ))}
          </div>
          <label className="gc-field">
            <span>标签</span>
            <input value={current.label ?? ''} onChange={(e) => onPatch({ label: e.target.value || undefined })} />
          </label>
          <label className="gc-field">
            <span>触发键</span>
            <select value={current.triggerKey ?? ''} onChange={(e) => onPatch({ triggerKey: e.target.value || undefined })}>
              <option value="">默认（空格 / Enter / 点击）</option>
              <option value="Space">Space</option>
              <option value="Enter">Enter</option>
              <option value="KeyA">A</option>
              <option value="KeyD">D</option>
              <option value="KeyW">W</option>
              <option value="KeyS">S</option>
              <option value="ArrowLeft">←</option>
              <option value="ArrowRight">→</option>
              <option value="ArrowUp">↑</option>
              <option value="ArrowDown">↓</option>
            </select>
          </label>
          <label className="gc-field">
            <span>形态</span>
            <select value={current.shape} onChange={(e) => onPatch({ shape: e.target.value })}>
              <option value="tap">Tap</option>
              <option value="hold">Hold</option>
              <option value="sweep">Sweep</option>
            </select>
          </label>
          {current.shape === 'hold' && (
            <label className="gc-field">
              <span>按住时长 ms</span>
              <input
                type="number"
                min={100}
                value={current.durationMs ?? 500}
                onChange={(e) => onPatch({ durationMs: Math.max(100, Number(e.target.value) || 500) })}
              />
            </label>
          )}
          {current.shape === 'sweep' && (
            <label className="gc-field">
              <span>滑动方向</span>
              <select value={current.sweepDir ?? 'right'} onChange={(e) => onPatch({ sweepDir: e.target.value })}>
                <option value="left">左</option>
                <option value="right">右</option>
                <option value="up">上</option>
                <option value="down">下</option>
              </select>
            </label>
          )}
          <button type="button" className="gc-mini-danger" onClick={() => onRemoveQteCue(current.id)}>
            删除当前按键点
          </button>
        </>
      )}
      {item.kind === 'qte_window' && current && 'optType' in current && (
        <>
          <p className="gc-inspector-hint">
            整段 QTE 何时生效、何时整段超时。试玩<strong>不会</strong>再弹「选项清单」——玩家只经历一次 QTE；
            「QTE 按键点」轨上的圆点才是各次按键时刻。
          </p>
          <label className="gc-field">
            <span>设计备注（可选）</span>
            <input value={current.prompt ?? ''} onChange={(e) => onPatch({ prompt: e.target.value || undefined })} />
          </label>
          <label className="gc-field">
            <span>整段限时 ms</span>
            <input
              type="number"
              min={500}
              step={500}
              value={current.timeoutMs ?? scene.qte?.timeoutMs ?? ''}
              onChange={(e) => {
                const timeoutMs = e.target.value ? Number(e.target.value) : undefined
                onPatch({ timeoutMs })
              }}
            />
          </label>
        </>
      )}
      {item.kind === 'option' && current && 'optType' in current && (
        <>
          <label className="gc-field">
            <span>提示文案</span>
            <input value={current.prompt ?? ''} onChange={(e) => onPatch({ prompt: e.target.value || undefined })} />
          </label>
          <label className="gc-field">
            <span>呈现</span>
            <select value={current.presentation ?? 'list'} onChange={(e) => onPatch({ presentation: e.target.value })}>
              <option value="list">清单</option>
              <option value="hotspot">画面热区</option>
            </select>
          </label>
          {current.presentation === 'hotspot' && firstHotspot && (
            <div className="gc-hotspot-sliders">
              <RangeField
                label="热区 X"
                value={firstHotspot.x * 100}
                min={0}
                max={100}
                unit="%"
                onDragStart={() => onHotspotDragState(firstHotspot.id)}
                onDragEnd={() => onHotspotDragState(null)}
                onChange={(value) => onPatchHotspot(firstHotspot.id, { x: clamp01(value / 100) })}
              />
              <RangeField
                label="热区 Y"
                value={firstHotspot.y * 100}
                min={0}
                max={100}
                unit="%"
                onDragStart={() => onHotspotDragState(firstHotspot.id)}
                onDragEnd={() => onHotspotDragState(null)}
                onChange={(value) => onPatchHotspot(firstHotspot.id, { y: clamp01(value / 100) })}
              />
              <RangeField
                label="热区范围"
                value={(firstHotspot.r ?? 0.08) * 100}
                min={2}
                max={40}
                unit="%"
                onDragStart={() => onHotspotDragState(firstHotspot.id)}
                onDragEnd={() => onHotspotDragState(null)}
                onChange={(value) => onPatchHotspot(firstHotspot.id, { r: clamp01(value / 100) })}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── 界面 ─────────────────────────────────────────────── */

export function UiCatalogTab() {
  const [selectedId, setSelectedId] = useState<string>(UI_SCHEMES[0]?.id ?? '')
  return (
    <CatalogShell<UiScheme>
      icon="🗔"
      title="界面"
      items={UI_SCHEMES}
      selectedId={selectedId}
      onSelect={setSelectedId}
      renderPreview={(ui) =>
        ui ? (
          <div className="gc-stage">
            <div className="gc-frame" data-type="ui">
              <span className="gc-badge">{ui.label}</span>
              <div className="gc-hud-mock" data-hud={ui.id}>
                {ui.id !== 'hidden' && (
                  <>
                    <div className="gc-hud-bar gc-hud-bar--player" />
                    {ui.id === 'battle' && <div className="gc-hud-bar gc-hud-bar--boss" />}
                    {ui.id === 'explore' && <div className="gc-hud-chip">背包</div>}
                  </>
                )}
              </div>
            </div>
            <div className="gc-meta">
              <span className="gc-meta-cell gc-meta-cell--wide">
                <span className="gc-meta-k">说明</span>
                <span className="gc-meta-v">{ui.desc}</span>
              </span>
              <span className="gc-meta-cell">
                <span className="gc-meta-k">方案</span>
                <span className="gc-meta-v gc-mono">{ui.id}</span>
              </span>
            </div>
          </div>
        ) : (
          <EmptyPreview text="选择一个界面以预览" />
        )
      }
    />
  )
}

/* ── 规则 ─────────────────────────────────────────────── */

export function RuleCatalogTab() {
  const [selectedId, setSelectedId] = useState<string>(GAME_RULES[0]?.id ?? '')
  const scenario = useScenarioStore((s) => s.scenario)
  const applyExternalScenario = useScenarioStore((s) => s.applyExternalScenario)
  const rules = readCombatRules(scenario)

  function patchRules(patch: CombatRulesPatch): void {
    applyExternalScenario(applyCombatRules(scenario, patch))
  }

  return (
    <CatalogShell<GameRule>
      icon="📜"
      title="规则"
      items={GAME_RULES}
      selectedId={selectedId}
      onSelect={setSelectedId}
      renderPreview={(rule) =>
        rule ? (
          <div className="gc-stage">
            <div className="gc-rule-card">
              <div className="gc-rule-head">{rule.label} 属性</div>
              <RuleEditor ruleId={rule.id} rules={rules} onPatch={patchRules} />
            </div>
          </div>
        ) : (
          <EmptyPreview text="选择一条规则以查看" />
        )
      }
    />
  )
}

function RuleEditor({
  ruleId,
  rules,
  onPatch,
}: {
  ruleId: string
  rules: ReturnType<typeof readCombatRules>
  onPatch: (patch: CombatRulesPatch) => void
}) {
  switch (ruleId) {
    case 'r-player':
      return (
        <div className="gc-rule-form">
          <div className="gc-rule-section">基础属性</div>
          <RuleSliderField label="生命值" value={rules.playerMaxHp} max={15000} onChange={(playerMaxHp) => onPatch({ playerMaxHp })} />
          <RuleSliderField label="攻击力" value={rules.playerAttack} max={150} onChange={(playerAttack) => onPatch({ playerAttack })} />
          <RuleSliderField label="防御力" value={rules.playerDefense} max={100} onChange={(playerDefense) => onPatch({ playerDefense })} />
          <RuleSliderField label="暴击率" value={rules.playerCritRate} max={50} unit="%" onChange={(playerCritRate) => onPatch({ playerCritRate })} />
          <RuleSliderField label="气力上限" value={rules.qiMax} max={5} onChange={(qiMax) => onPatch({ qiMax })} />
          <div className="gc-rule-section">出手 / 先手</div>
          <RuleSliderField label="出手速度" value={rules.playerSpeed} max={50} onChange={(playerSpeed) => onPatch({ playerSpeed })} />
          <RuleSelectField label="先手判定" value="speed" options={['出手速度大者先手']} />
          <RuleSelectField label="速度相等时" value="player" options={['空藏先手']} />
        </div>
      )
    case 'r-enemy':
      return (
        <div className="gc-rule-form">
          <div className="gc-rule-section">基础属性</div>
          <RuleSliderField label="生命值" value={rules.bossMaxHp} max={15000} onChange={(bossMaxHp) => onPatch({ bossMaxHp })} />
          <RuleSliderField label="攻击力" value={rules.bossAttack} max={150} onChange={(bossAttack) => onPatch({ bossAttack })} />
          <RuleSliderField label="防御力" value={rules.bossDefense} max={100} onChange={(bossDefense) => onPatch({ bossDefense })} />
          <RuleSliderField label="暴击率" value={rules.bossCritRate} max={50} unit="%" onChange={(bossCritRate) => onPatch({ bossCritRate })} />
          <RuleSliderField label="进攻欲望" value={rules.bossAggression} max={1} step={0.1} onChange={(bossAggression) => onPatch({ bossAggression })} />
          <div className="gc-rule-section">出手 / 先手</div>
          <RuleSliderField label="出手速度" value={rules.bossSpeed} max={50} onChange={(bossSpeed) => onPatch({ bossSpeed })} />
          <RuleSelectField label="先手判定" value="speed" options={['出手速度大者先手']} />
        </div>
      )
    default:
      return null
  }
}

function RuleSliderField({
  label,
  value,
  max,
  step = 1,
  unit,
  onChange,
}: {
  label: string
  value: number
  max: number
  step?: number
  unit?: string
  onChange: (value: number) => void
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  return (
    <label className="gc-paramrow gc-paramrow--slider">
      <span className="gc-param-label">{label}</span>
      <span className="gc-rule-slider">
        <span className="gc-rule-slider-fill" style={{ width: `${pct}%` }} />
        <span className="gc-rule-slider-knob" style={{ left: `${pct}%` }} />
        <input
          className="gc-rule-range"
          type="range"
          min={0}
          max={max}
          step={step}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
      </span>
      <input
        className="gc-rule-value"
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      {unit && <span className="gc-rule-unit">{unit}</span>}
    </label>
  )
}

function RuleSelectField({
  label,
  value,
  options,
}: {
  label: string
  value: string
  options: string[]
}) {
  return (
    <label className="gc-paramrow gc-paramrow--select">
      <span className="gc-param-label">{label}</span>
      <select className="gc-rule-select" value={value} disabled>
        {options.map((opt) => (
          <option key={opt} value={value}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  )
}

function EmptyPreview({ text }: { text: string }) {
  return (
    <div className="gc-empty">
      <span className="gc-empty-glyph" aria-hidden>
        ◇
      </span>
      <span className="gc-empty-text">{text}</span>
    </div>
  )
}

export const CATALOG_CSS = `
.gc-tab {
  --gc-bg: var(--work, #0e0c09);
  --gc-panel: var(--panel, #1b1713);
  --gc-panel2: var(--panel2, #252019);
  --gc-panel3: var(--panel3, #2f2923);
  --gc-line: var(--line, #403830);
  --gc-line-soft: var(--line-soft, #2e2924);
  --gc-text: var(--txt, #f6f1e9);
  --gc-muted: var(--muted, #b8aea0);
  --gc-faint: var(--faint, #8c8377);
  --gc-accent: var(--accent, #f08840);
  --gc-accent-soft: var(--accent-soft, rgba(240,136,64,.16));
  --gc-accent-line: var(--accent-line, rgba(240,136,64,.42));
  flex: 1; min-height: 0; min-width: 0;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  background: var(--gc-bg);
  color: var(--gc-text);
}
.gc-tab-video { grid-template-columns: 248px minmax(0, 1fr); }
.gc-tab-video.has-sidepanel { grid-template-columns: 248px minmax(0, 1fr) 340px; }
/* ── 左栏列表 ── */
.gc-list {
  display: flex; flex-direction: column; min-height: 0;
  background: var(--gc-panel);
  border: 1px solid var(--gc-line-soft);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: var(--shadow, 0 1px 4px rgba(0,0,0,.22));
}
.gc-list-head {
  flex: none;
  display: flex; align-items: center; gap: 8px;
  padding: 11px 13px;
  border-bottom: 1px solid var(--gc-line-soft);
  background: rgba(255,255,255,0.025);
}
.gc-list-ico { font-size: 14px; }
.gc-list-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
.gc-list-count {
  margin-left: auto;
  font-size: 11px; font-variant-numeric: tabular-nums;
  color: var(--gc-faint);
  background: rgba(255,255,255,0.05);
  border-radius: 999px; padding: 1px 8px;
}
.gc-list-body { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; }
.gc-row {
  all: unset; box-sizing: border-box;
  display: flex; align-items: center; gap: 9px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  border: 1px solid transparent;
  font-size: 12.5px; color: var(--gc-muted);
  transition: background .12s, color .12s, border-color .12s;
}
.gc-row:hover { background: var(--gc-panel2); color: var(--gc-text); }
.gc-row.is-on {
  background: var(--gc-accent-soft);
  border-color: var(--gc-accent-line);
  color: var(--gc-text);
}
.gc-row-mark {
  flex: none; width: 14px; text-align: center;
  font-size: 11px; color: #5fbf7f;
}
.gc-row-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── 右栏预览 ── */
.gc-preview {
  display: flex; min-height: 0; min-width: 0;
  background: var(--gc-panel);
  border: 1px solid var(--gc-line-soft);
  border-radius: 10px;
  overflow: auto;
  box-shadow: var(--shadow, 0 1px 4px rgba(0,0,0,.22));
}
.gc-stage {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: clamp(8px, 1.3dvh, 14px);
  padding: clamp(10px, 1.6dvh, 18px);
}
.gc-stage-video {
  position: relative;
  height: 100%;
  --gc-timeline-h: clamp(204px, 22dvh, 240px);
}
.gc-video-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.gc-video-title { color: var(--gc-text); font-size: 16px; font-weight: 700; }
.gc-video-sub { color: var(--gc-faint); font-size: 12px; margin-top: 2px; }
.gc-action {
  border: 1px solid var(--gc-accent-line);
  background: var(--gc-accent-soft);
  color: var(--gc-text);
  border-radius: 8px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 12px;
}
.gc-action:hover { background: rgba(240,136,64,.24); border-color: var(--gc-accent); }
.gc-video-top {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(260px, 0.85fr);
  gap: clamp(8px, 1.3dvh, 14px);
  align-items: stretch;
  min-height: 0;
  flex: 1 1 auto;
}
.gc-frame {
  position: relative;
  width: 100%; aspect-ratio: 16 / 9;
  max-height: min(58dvh, 100%);
  background: radial-gradient(120% 120% at 50% 30%, #251f18 0%, #070504 100%);
  border: 1px solid var(--gc-accent-line);
  border-radius: 12px;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}
.gc-badge {
  position: absolute; top: 14px; left: 14px;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 9px;
  font-size: 13px; font-weight: 700; color: var(--gc-accent);
  background: rgba(0,0,0,0.55);
  border: 1px solid var(--gc-accent-line);
}
.gc-badge em { font-style: normal; font-weight: 700; color: var(--gc-muted); opacity: 0.85; }
.gc-video { width: 100%; height: 100%; object-fit: contain; background: #000; }
.gc-content-anchor {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.gc-preview-overlays {
  position: absolute;
  inset: 0;
  pointer-events: none;
  container-type: size;
}
.gc-preview-overlay {
  position: absolute;
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  max-width: 78%;
  color: var(--gc-text);
  text-align: center;
  white-space: nowrap;
  text-shadow: 0 2px 8px rgba(0,0,0,.8);
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
  outline: none;
}
.gc-preview-overlay.is-movable { cursor: grab; }
.gc-preview-overlay.is-movable:active { cursor: grabbing; }
.gc-preview-overlay.is-selected .gc-preview-label {
  border-color: var(--gc-accent);
  box-shadow: 0 0 0 2px rgba(240,136,64,.24), 0 0 18px rgba(240,136,64,.3);
}
.gc-preview-overlay.is-hotspot-editing .gc-preview-label {
  border-color: rgba(248,113,113,.95);
  background: rgba(88,18,18,.74);
  box-shadow: 0 0 0 2px rgba(248,113,113,.34), 0 0 22px rgba(248,113,113,.45);
}
.gc-preview-overlay .gc-preview-label {
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0,0,0,.58);
  border: 1px solid rgba(255,255,255,.16);
  font-size: 13px;
}
.gc-preview-overlay.is-subtitle {
  left: 50%;
  right: auto;
  width: 82%;
}
.gc-preview-overlay.is-subtitle .gc-preview-label {
  font-size: clamp(16px, 1.35vw, 28px);
  white-space: normal;
  border: none;
  background: transparent;
  text-shadow: 0 2px 8px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,.95);
}
.gc-preview-overlay.is-settlement .gc-preview-label {
  color: #ffd8bf;
  border-color: rgba(240,136,64,.5);
  background: rgba(40,20,10,.62);
  font-weight: 800;
}
.gc-preview-overlay.is-option .gc-preview-label {
  color: #eadbff;
  border-color: rgba(199,155,242,.48);
}
.gc-preview-overlay.is-qte .gc-preview-label {
  color: #cfe4ff;
  border-color: rgba(95,163,247,.48);
}
.gc-preview-ring {
  position: absolute;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2px solid rgba(95,163,247,.9);
  box-shadow: 0 0 20px rgba(95,163,247,.55), inset 0 0 12px rgba(95,163,247,.25);
  animation: gcPreviewPulse 1.2s ease-in-out infinite;
}
.gc-preview-hotspot-ring {
  position: absolute;
  width: var(--gc-hotspot-r, 16%);
  aspect-ratio: 1;
  border-radius: 50%;
  border: 1px dashed rgba(199,155,242,.72);
  background: rgba(199,155,242,.08);
  box-shadow: 0 0 16px rgba(199,155,242,.2);
}
.gc-preview-overlay.is-hotspot-editing .gc-preview-hotspot-ring {
  border-color: rgba(248,113,113,.95);
  background: rgba(248,113,113,.14);
  box-shadow: 0 0 22px rgba(248,113,113,.42);
}
@keyframes gcPreviewPulse {
  0%, 100% { transform: scale(1); opacity: .8; }
  50% { transform: scale(1.14); opacity: 1; }
}
.gc-prompt {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
  background: var(--gc-panel2);
  border: 1px solid var(--gc-line-soft);
  border-radius: 12px;
  padding: 12px;
}
.gc-prompt span { color: var(--gc-faint); font-size: 11px; letter-spacing: 0.1em; }
.gc-prompt textarea {
  flex: 1;
  width: 100%;
  min-height: clamp(72px, 16dvh, 160px);
  resize: vertical;
  border: 1px solid var(--gc-line);
  background: rgba(0,0,0,0.28);
  color: var(--gc-text);
  border-radius: 8px;
  padding: 8px 10px;
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}
.gc-materialbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.gc-materialbar-meta { color: var(--gc-faint); font-size: 12px; }
.gc-materialbar-hint { color: rgba(184, 240, 238, 0.72); font-size: 11px; }
.gc-readonly-note {
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed var(--gc-line);
  color: var(--gc-muted);
  background: rgba(255,255,255,0.025);
  font-size: 12px;
  text-align: center;
}
.gc-mtimeline {
  position: relative;
  height: var(--gc-timeline-h);
  min-height: 204px;
  border-radius: 10px;
  border: 1px solid var(--gc-line-soft);
  background:
    linear-gradient(90deg, rgba(240,136,64,0.12) 1px, transparent 1px) 0 0 / 10% 100%,
    rgba(0,0,0,0.22);
  overflow: hidden;
  touch-action: none;
}
.gc-mtimeline-ruler {
  position: absolute;
  left: 0; right: 0; top: 0; height: 22px;
  border-bottom: 1px solid var(--gc-line-soft);
  background: rgba(255,255,255,0.025);
}
.gc-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  transform: translateX(-1px);
  background: var(--gc-accent);
  box-shadow: 0 0 12px rgba(240,136,64,.65);
  z-index: 8;
  pointer-events: none;
}
.gc-playhead::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--gc-accent);
  box-shadow: 0 0 8px rgba(240,136,64,.85);
}
.gc-mempty {
  position: absolute;
  inset: 22px 0 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--gc-faint);
  font-size: 13px;
}
.gc-mclip {
  position: absolute;
  top: 42px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 14px;
  color: #fff;
  font-size: 12px;
  cursor: grab;
  user-select: none;
  background: rgba(18, 14, 11, 0.88);
  border: 1px solid rgba(255,255,255,0.12);
  box-shadow: 0 6px 18px rgba(0,0,0,0.28);
  overflow: hidden;
}
.gc-mclip::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: var(--gc-accent);
  box-shadow: 0 0 12px currentColor;
}
.gc-mclip:active { cursor: grabbing; }
.gc-mclip.is-selected { outline: 2px solid var(--gc-accent); outline-offset: 2px; }
.gc-mclip.is-subtitle { border-color: rgba(95,201,128,.58); color: #d6ffe2; }
.gc-mclip.is-subtitle::before { background: #62c980; }
.gc-mclip.is-settlement { border-color: rgba(240,136,64,.58); color: #ffd8bf; }
.gc-mclip.is-settlement::before { background: var(--gc-accent); }
.gc-mclip.is-qte { border-color: rgba(95,163,247,.58); color: #cfe4ff; }
.gc-mclip.is-qte::before { background: #5fa3f7; }
.gc-mclip.is-qte-window {
  border-color: rgba(56, 189, 186, 0.62);
  border-style: dashed;
  color: #b8f0ee;
  background: rgba(8, 28, 30, 0.72);
}
.gc-mclip.is-qte-window::before { background: #38bdba; opacity: 0.85; }
.gc-mclip.is-option { border-color: rgba(199,155,242,.58); color: #eadbff; }
.gc-mclip.is-option::before { background: #c79bf2; }
.gc-mhandle {
  position: absolute;
  top: 0; bottom: 0;
  width: 8px;
  border: 0;
  padding: 0;
  background: rgba(255,255,255,0.32);
  cursor: ew-resize;
}
.gc-mhandle.is-left { left: 0; border-radius: 8px 0 0 8px; }
.gc-mhandle.is-right { right: 0; border-radius: 0 8px 8px 0; }
.gc-sidepanel {
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--gc-line-soft);
  background: var(--gc-panel);
  overflow: auto;
}
.gc-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.gc-side-head button {
  border: 1px solid var(--gc-line);
  background: var(--gc-panel2);
  color: var(--gc-text);
  border-radius: 7px;
  padding: 5px 10px;
  cursor: pointer;
}
.gc-lib-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.gc-lib-item {
  min-height: 120px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  border: 1px solid var(--gc-line-soft);
  background: var(--gc-panel2);
  color: var(--gc-text);
  border-radius: 10px;
  padding: 12px;
  text-align: left;
  cursor: pointer;
}
.gc-lib-item:hover { border-color: var(--gc-accent-line); background: var(--gc-accent-soft); }
.gc-lib-item span { color: var(--gc-muted); font-size: 12px; line-height: 1.45; }
.gc-lib-item.is-disabled {
  cursor: not-allowed;
  opacity: 0.48;
  filter: grayscale(0.7);
}
.gc-lib-item.is-disabled:hover {
  border-color: rgba(255,255,255,0.1);
  background: var(--gc-panel2);
}
.gc-inspector-empty {
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--gc-faint);
  font-size: 13px;
  text-align: center;
}
.gc-inspector-card { display: flex; flex-direction: column; gap: 12px; }
.gc-inspector-title { color: var(--gc-text); font-size: 15px; font-weight: 700; }
.gc-inspector-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255,255,255,0.58);
}
.gc-hotspot-sliders { display: flex; flex-direction: column; gap: 10px; }
.gc-range-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.gc-range-field span {
  display: flex;
  justify-content: space-between;
  color: var(--gc-faint);
  font-size: 11px;
}
.gc-range-field b {
  color: var(--gc-text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.gc-range-field input[type="range"] {
  width: 100%;
  accent-color: var(--gc-accent);
}
.gc-field,
.gc-field-row label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.gc-field-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.gc-field span,
.gc-field-row span { color: var(--gc-faint); font-size: 11px; }
.gc-field input,
.gc-field select,
.gc-field-row input {
  min-width: 0;
  width: 100%;
  border: 1px solid var(--gc-line);
  background: rgba(0,0,0,0.28);
  color: var(--gc-text);
  border-radius: 7px;
  padding: 7px 8px;
}
.gc-frame-center { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.gc-play-glyph {
  width: 64px; height: 64px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; color: #fff; padding-left: 4px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.22);
  animation: gcPulse 2.2s ease-in-out infinite;
}
@keyframes gcPulse { 0%,100% { transform: scale(1); opacity: .85; } 50% { transform: scale(1.06); opacity: 1; } }
.gc-frame-hint { font-size: 12px; color: rgba(255,255,255,0.5); letter-spacing: 0.08em; }

@media (max-aspect-ratio: 4 / 3), (max-width: 980px) {
  .gc-stage-video { --gc-timeline-h: clamp(204px, 20dvh, 228px); }
  .gc-video-top {
    grid-template-columns: minmax(0, 1fr);
  }
  .gc-frame {
    max-height: 42dvh;
    justify-self: center;
  }
  .gc-prompt textarea {
    min-height: clamp(56px, 10dvh, 96px);
  }
}

@media (max-height: 760px) {
  .gc-stage-video { --gc-timeline-h: 204px; }
  .gc-video-head { gap: 8px; }
  .gc-video-title { font-size: 14px; }
  .gc-prompt { padding: 9px; }
  .gc-prompt textarea { min-height: 56px; }
}

.gc-meta { display: flex; flex-wrap: wrap; gap: 10px; }
.gc-meta-cell {
  display: flex; flex-direction: column; gap: 3px;
  padding: 8px 12px; border-radius: 8px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  min-width: 96px;
}
.gc-meta-cell--wide { flex: 1; min-width: 200px; }
.gc-meta-k { font-size: 10.5px; letter-spacing: 0.1em; color: rgba(255,255,255,0.45); }
.gc-meta-v { font-size: 13px; color: #fff; }
.gc-mono { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; }

/* HUD 预览（界面 tab 的迷你示意） */
.gc-hud-mock { position: absolute; inset: 0; pointer-events: none; }
.gc-hud-bar { position: absolute; height: 10px; border-radius: 5px; }
.gc-hud-bar--player { left: 16px; bottom: 16px; width: 38%; background: linear-gradient(90deg,#5fbf7f,#3a7d52); }
.gc-hud-bar--boss { right: 16px; top: 16px; width: 42%; background: linear-gradient(90deg,#b5453a,#e0795f); }
.gc-hud-chip {
  position: absolute; right: 16px; bottom: 16px;
  padding: 4px 10px; border-radius: 7px; font-size: 11px; color: #fff;
  background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.25);
}

/* 规则卡片 */
.gc-rule-card {
  width: 100%;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  overflow: hidden;
}
.gc-rule-head {
  padding: 12px 16px; font-size: 14px; font-weight: 700; color: #fff;
  background: rgba(224,121,95,0.14);
  border-bottom: 1px solid rgba(224,121,95,0.3);
}
.gc-rule-list { list-style: none; margin: 0; padding: 8px 0; }
.gc-rule-item {
  padding: 10px 16px; font-size: 13px; color: rgba(255,255,255,0.82);
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.gc-rule-item:last-child { border-bottom: none; }
.gc-rule-form {
  display: flex;
  flex-direction: column;
  padding: 12px 0 8px;
}
.gc-rule-section {
  font-size: 12px;
  font-weight: 700;
  color: rgba(255,255,255,0.78);
  padding: 12px 18px 6px;
  letter-spacing: 0.03em;
}
.gc-paramrow {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px 12px;
  margin: 0;
  padding: 10px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  min-height: 24px;
}
.gc-paramrow:hover { background: rgba(255,255,255,0.03); }
.gc-paramrow--select { grid-template-columns: 108px minmax(120px, 220px); }
.gc-param-label {
  font-size: 13px;
  color: rgba(255,255,255,0.56);
}
.gc-rule-slider {
  position: relative;
  height: 5px;
  border-radius: 3px;
  background: rgba(255,255,255,0.1);
}
.gc-rule-slider-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  border-radius: 3px;
  background: linear-gradient(90deg, #e86f20, #f08840);
}
.gc-rule-slider-knob {
  position: absolute;
  top: 50%;
  width: 14px; height: 14px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  box-shadow: 0 0 0 4px rgba(240,136,64,.95), 0 1px 4px rgba(0,0,0,.4);
  pointer-events: none;
}
.gc-rule-range {
  position: absolute;
  inset: -8px 0;
  width: 100%;
  opacity: 0;
  cursor: grab;
}
.gc-rule-value {
  min-width: 54px;
  width: 128px;
  box-sizing: border-box;
  padding: 4px 10px;
  border-radius: 7px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #fff;
  font: inherit;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.gc-rule-unit {
  color: rgba(255,255,255,0.5);
  font-size: 12px;
}
.gc-rule-select {
  width: 100%;
  padding: 6px 10px;
  border-radius: 7px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.06);
  color: #ddd;
}

.gc-empty {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
}
.gc-empty-glyph { font-size: 38px; color: rgba(255,255,255,0.25); }
.gc-empty-text { font-size: 13px; color: rgba(255,255,255,0.5); }
`
