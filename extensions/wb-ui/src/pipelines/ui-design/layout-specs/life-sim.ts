import type { GenreScreenLayoutSpec } from './types'

export const LIFE_SIM_START_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'life-sim',
  screen: 'start',
  template: 'lifesim-cozy-start',
  slots: [
    { moduleId: 'main-nav', anchor: 'bottom-center', priority: 1 },
    { moduleId: 'resource-tracker', anchor: 'top-right', priority: 2 },
  ],
  suppress: ['game-board', 'reticle', 'weapon-hud', 'ammo-counter'],
}

export const LIFE_SIM_HUD_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'life-sim',
  screen: 'hud',
  template: 'lifesim-day-hud',
  slots: [
    { moduleId: 'resource-tracker', anchor: 'top-right', priority: 1 },
    { moduleId: 'currency', anchor: 'top-right', priority: 2 },
    { moduleId: 'item-slot', anchor: 'bottom-center', priority: 3 },
    { moduleId: 'interaction-hints', anchor: 'bottom-center', priority: 4 },
    { moduleId: 'minimap', anchor: 'right-top', priority: 5 },
  ],
  suppress: ['game-board', 'reticle', 'health-status', 'skill-bar', 'quest-tracker', 'ammo-counter'],
}
