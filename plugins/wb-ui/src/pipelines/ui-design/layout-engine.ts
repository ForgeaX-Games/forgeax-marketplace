import type { ModuleLayerId } from './model'
import type { GenrePresetId, ScreenKind } from './model'
import { getLayoutSpec } from './layout-specs'
import { LAYOUT_ANCHOR_CLASS, type GenreScreenLayoutSpec, type LayoutAnchorId } from './layout-specs/types'

export { getLayoutSpec, listLayoutSpecs, listGenreLayoutSpecs } from './layout-specs'

export function hasGenreLayoutTemplate(
  genre: GenrePresetId,
  screen: ScreenKind,
): boolean {
  const spec = getLayoutSpec(genre, screen)
  return spec != null && spec.template !== 'default-hud'
}

export function isModuleSuppressed(
  spec: GenreScreenLayoutSpec | undefined,
  moduleId: string,
): boolean {
  return spec?.suppress?.includes(moduleId) ?? false
}

export function getSlotAnchor(
  spec: GenreScreenLayoutSpec | undefined,
  moduleId: string,
): LayoutAnchorId | undefined {
  return spec?.slots.find(slot => slot.moduleId === moduleId)?.anchor
}

export function resolveLayoutAnchorClass(
  genre: GenrePresetId,
  screen: ScreenKind,
  moduleId: string,
  layer: ModuleLayerId,
  zone: string,
): string {
  const spec = getLayoutSpec(genre, screen)
  const slotAnchor = getSlotAnchor(spec, moduleId)
  if (slotAnchor) return LAYOUT_ANCHOR_CLASS[slotAnchor]

  return resolveDefaultLayoutAnchorClass(moduleId, layer, zone)
}

export function resolveDefaultLayoutAnchorClass(
  moduleId: string,
  layer: ModuleLayerId,
  zone: string,
): string {
  if (moduleId === 'main-nav') return 'anchor-right-top'
  if (moduleId === 'health-status') return 'anchor-left-bottom'
  if (moduleId === 'minimap') return 'anchor-left-top'
  if (moduleId === 'quest-tracker') return 'anchor-right-top'
  if (moduleId === 'interaction-hints') return 'anchor-bottom-center'
  if (moduleId === 'skill-bar') return 'anchor-bottom-center'
  if (moduleId === 'weapon-hud' || moduleId === 'ammo-counter') return 'anchor-right-bottom'
  if (moduleId === 'reticle') return 'anchor-center'
  if (moduleId === 'currency' || moduleId === 'resource-tracker' || moduleId === 'score-display' || moduleId === 'level-counter') {
    return 'anchor-top-center'
  }
  if (moduleId === 'step-counter') return 'anchor-right-top'
  if (moduleId === 'game-board') return 'anchor-center'
  if (moduleId === 'dialog-box') return 'anchor-bottom-wide'
  if (moduleId === 'pause-menu' || moduleId === 'settings-panel' || moduleId === 'modal-dialog') return 'anchor-center-wide'
  if (
    moduleId === 'inventory-grid'
    || moduleId === 'shop-panel'
    || moduleId === 'character-panel'
    || moduleId === 'item-detail'
    || moduleId === 'crafting-panel'
    || moduleId === 'reward-summary'
    || moduleId === 'level-select'
    || moduleId === 'weapon-select'
  ) {
    return 'anchor-right-mid'
  }
  if (zone.includes('左上')) return 'anchor-left-top'
  if (zone.includes('右上')) return 'anchor-right-top'
  if (zone.includes('左下')) return 'anchor-left-bottom'
  if (zone.includes('右下')) return 'anchor-right-bottom'
  if (zone.includes('顶部')) return 'anchor-top-center'
  if (zone.includes('底部')) return 'anchor-bottom-center'
  if (zone.includes('中心') || zone.includes('中央')) return 'anchor-center'
  if (layer === 'depth-settings') return 'anchor-center-wide'
  if (layer === 'active-menu') return 'anchor-right-mid'
  if (layer === 'context-hud') return 'anchor-right-top'
  return 'anchor-left-top'
}

export function shouldShowModuleInLayout(
  spec: GenreScreenLayoutSpec | undefined,
  moduleId: string,
  enabled: boolean,
): boolean {
  if (!enabled) return false
  if (isModuleSuppressed(spec, moduleId)) return false
  return true
}
