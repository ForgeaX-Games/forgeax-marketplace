import type { GenrePresetId, ScreenKind } from '../model'

export type LayoutAnchorId =
  | 'left-top'
  | 'right-top'
  | 'left-bottom'
  | 'right-bottom'
  | 'left-mid'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center'
  | 'center'
  | 'center-wide'
  | 'right-mid'
  | 'bottom-wide'
  | 'fullscreen'

export type LayoutTemplateId =
  | 'default-hud'
  | 'match3-centered'
  | 'casual-home-hub'
  | 'casual-stage-map'
  | 'open-world-cinematic-start'
  | 'open-world-explore-hud'
  | 'open-world-inventory'
  | 'open-world-npc-dialog'
  | 'open-world-character-sheet'
  | 'arpg-hero-start'
  | 'arpg-combat-hud'
  | 'arpg-system-pause'
  | 'arpg-inventory'
  | 'arpg-character-sheet'
  | 'arpg-story-dialog'
  | 'arpg-battle-results'
  | 'fps-lobby-start'
  | 'fps-combat-hud'
  | 'fps-weapon-select'
  | 'survival-camp-start'
  | 'survival-vitals-hud'
  | 'mmo-login-start'
  | 'mmo-raid-hud'
  | 'mmo-social-dialog'
  | 'mmo-character-sheet'
  | 'lifesim-cozy-start'
  | 'lifesim-day-hud'
  | 'racing-garage-start'
  | 'racing-track-select'
  | 'racing-dash-hud'

export interface LayoutModuleSlot {
  moduleId: string
  anchor: LayoutAnchorId
  priority?: number
}

export interface GenreScreenLayoutSpec {
  genre: GenrePresetId
  screen: ScreenKind
  template: LayoutTemplateId
  slots: LayoutModuleSlot[]
  suppress?: string[]
}

export const LAYOUT_ANCHOR_CLASS: Record<LayoutAnchorId, string> = {
  'left-top': 'anchor-left-top',
  'right-top': 'anchor-right-top',
  'left-bottom': 'anchor-left-bottom',
  'right-bottom': 'anchor-right-bottom',
  'left-mid': 'anchor-left-top',
  'top-right': 'anchor-right-top',
  'bottom-left': 'anchor-left-bottom',
  'bottom-right': 'anchor-right-bottom',
  'top-center': 'anchor-top-center',
  'bottom-center': 'anchor-bottom-center',
  center: 'anchor-center',
  'center-wide': 'anchor-center-wide',
  'right-mid': 'anchor-right-mid',
  'bottom-wide': 'anchor-bottom-wide',
  fullscreen: 'anchor-center-wide',
}
