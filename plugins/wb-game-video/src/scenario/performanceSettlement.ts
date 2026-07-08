import type { PerformanceCue } from './gameplayTypes'
import type { EntityStatEffect, Scenario, Scene, StickerClip } from './types'

/** 蓝图「计算」组只读展示的结算飘字摘要（SSOT = performance.cues + stickerClips）。 */
export interface PerformanceSettlementView {
  id: string
  atMs: number
  label: string
  damage: number | null
  displayText: string
  xPct: number
  yPct: number
}

export function cueDamageValue(cue: PerformanceCue | undefined): number {
  const effect = cue?.effects.find((e): e is EntityStatEffect => e.kind === 'entityStat' && e.stat === 'hp')
  return Math.abs(Number(effect?.value ?? 0))
}

export function cueTargetKind(cue: PerformanceCue | undefined, scenario: Scenario): 'boss' | 'player' {
  const effect = cue?.effects.find((e): e is EntityStatEffect => e.kind === 'entityStat' && e.stat === 'hp')
  const entity = effect ? scenario.entities?.[effect.entityId] : undefined
  return entity?.kind === 'player' ? 'player' : 'boss'
}

function stickerForCue(stickers: StickerClip[], cueId: string): StickerClip | undefined {
  return stickers.find((s) => s.performanceCueId === cueId) ?? stickers.find((s) => s.id === cueId)
}

function formatMs(ms: number): string {
  const sec = Math.max(0, ms) / 1000
  return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`
}

/** 从 Scene 读取结算点列表（供蓝图只读预览 + blueprint 编译）。 */
export function listPerformanceSettlements(scene: Scene): PerformanceSettlementView[] {
  const cues = scene.performance?.cues ?? []
  const stickers = scene.stickerClips ?? []
  const usedStickerIds = new Set<string>()
  const fromCues = cues.map((cue) => {
    const sticker = stickerForCue(stickers, cue.id)
    if (sticker) usedStickerIds.add(sticker.id)
    const damage = cue.effects.some((e) => e.kind === 'entityStat' && e.stat === 'hp')
      ? cueDamageValue(cue)
      : null
    const displayText = sticker?.text ?? (damage != null && damage > 0 ? `-${damage}` : cue.label ?? '')
    return {
      id: cue.id,
      atMs: cue.atMs,
      label: cue.label ?? '结算',
      damage,
      displayText,
      xPct: Math.round((sticker?.x ?? 0.5) * 100),
      yPct: Math.round((sticker?.y ?? 0.42) * 100),
    }
  })
  const fromTextStickers = stickers
    .filter((s) => s.kind === 'numeric' && !usedStickerIds.has(s.id))
    .map((s) => ({
      id: s.id,
      atMs: s.startMs,
      label: '飘字',
      damage: null as number | null,
      displayText: s.text ?? '',
      xPct: Math.round((s.x ?? 0.5) * 100),
      yPct: Math.round((s.y ?? 0.42) * 100),
    }))
  return [...fromCues, ...fromTextStickers].sort((a, b) => a.atMs - b.atMs)
}

/** 计算节点的判定结果摘要 —— 取非 auto 分支标签（≥2 条时在蓝图展示）。 */
export function branchOutcomeLabels(scene: Scene): string[] {
  const labels = scene.branches
    .filter((b) => b.kind !== 'auto')
    .map((b) => b.label?.trim() || b.targetSceneId)
    .filter(Boolean)
  if (labels.length >= 2) return labels
  if (labels.length === 1 && scene.branches.length === 1) return []
  return labels
}

export function formatSettlementTime(atMs: number): string {
  return formatMs(atMs)
}
