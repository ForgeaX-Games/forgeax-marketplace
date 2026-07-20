import type { GenreScreenLayoutSpec } from './types'

export const SURVIVAL_START_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'survival',
  screen: 'start',
  template: 'survival-camp-start',
  slots: [
    { moduleId: 'main-nav', anchor: 'right-mid', priority: 1 },
    { moduleId: 'character-panel', anchor: 'left-mid', priority: 2 },
  ],
  suppress: ['game-board', 'reticle'],
}

export const SURVIVAL_HUD_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'survival',
  screen: 'hud',
  template: 'survival-vitals-hud',
  slots: [
    { moduleId: 'minimap', anchor: 'left-top', priority: 1 },
    { moduleId: 'quest-tracker', anchor: 'right-top', priority: 2 },
    { moduleId: 'resource-tracker', anchor: 'left-bottom', priority: 3 },
    { moduleId: 'health-status', anchor: 'left-bottom', priority: 4 },
    { moduleId: 'item-slot', anchor: 'bottom-center', priority: 5 },
    { moduleId: 'interaction-hints', anchor: 'bottom-center', priority: 6 },
    { moduleId: 'crafting-panel', anchor: 'right-bottom', priority: 7 },
  ],
  suppress: ['game-board', 'reticle', 'skill-bar'],
}
