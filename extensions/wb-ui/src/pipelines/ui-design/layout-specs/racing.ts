import type { GenreScreenLayoutSpec } from './types'

export const RACING_START_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'racing',
  screen: 'start',
  template: 'racing-garage-start',
  slots: [
    { moduleId: 'main-nav', anchor: 'bottom-center', priority: 1 },
    { moduleId: 'character-panel', anchor: 'right-mid', priority: 2 },
  ],
  suppress: ['game-board', 'quest-tracker'],
}

export const RACING_LEVEL_SELECT_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'racing',
  screen: 'level-select',
  template: 'racing-track-select',
  slots: [
    { moduleId: 'level-select', anchor: 'left-mid', priority: 1 },
    { moduleId: 'reward-summary', anchor: 'right-mid', priority: 2 },
    { moduleId: 'main-nav', anchor: 'top-center', priority: 3 },
    { moduleId: 'level-counter', anchor: 'top-right', priority: 4 },
  ],
  suppress: ['game-board', 'health-status'],
}

export const RACING_HUD_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'racing',
  screen: 'hud',
  template: 'racing-dash-hud',
  slots: [
    { moduleId: 'minimap', anchor: 'left-top', priority: 1 },
    { moduleId: 'scoreboard', anchor: 'left-mid', priority: 2 },
    { moduleId: 'level-counter', anchor: 'top-center', priority: 3 },
    { moduleId: 'resource-tracker', anchor: 'right-bottom', priority: 4 },
    { moduleId: 'interaction-hints', anchor: 'bottom-center', priority: 5 },
  ],
  suppress: [
    'game-board',
    'reticle',
    'health-status',
    'skill-bar',
    'quest-tracker',
    'ammo-counter',
    'currency',
    'crafting-panel',
    'inventory-grid',
    'chat-panel',
  ],
}
