import type { GenreScreenLayoutSpec } from './types'

export const MMO_START_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'mmo',
  screen: 'start',
  template: 'mmo-login-start',
  slots: [
    { moduleId: 'main-nav', anchor: 'bottom-center', priority: 1 },
    { moduleId: 'character-panel', anchor: 'center', priority: 2 },
  ],
  suppress: ['game-board', 'reticle'],
}

export const MMO_HUD_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'mmo',
  screen: 'hud',
  template: 'mmo-raid-hud',
  slots: [
    { moduleId: 'minimap', anchor: 'left-top', priority: 1 },
    { moduleId: 'health-status', anchor: 'left-top', priority: 2 },
    { moduleId: 'currency', anchor: 'top-center', priority: 3 },
    { moduleId: 'scoreboard', anchor: 'top-center', priority: 4 },
    { moduleId: 'quest-tracker', anchor: 'right-top', priority: 5 },
    { moduleId: 'character-panel', anchor: 'right-top', priority: 6 },
    { moduleId: 'chat-panel', anchor: 'left-bottom', priority: 7 },
    { moduleId: 'skill-bar', anchor: 'bottom-center', priority: 8 },
  ],
  suppress: ['game-board', 'reticle', 'step-counter', 'resource-tracker'],
}

export const MMO_DIALOG_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'mmo',
  screen: 'dialog',
  template: 'mmo-social-dialog',
  slots: [
    { moduleId: 'chat-panel', anchor: 'left-bottom', priority: 1 },
    { moduleId: 'dialog-box', anchor: 'bottom-wide', priority: 2 },
    { moduleId: 'interaction-hints', anchor: 'bottom-center', priority: 3 },
    { moduleId: 'quest-tracker', anchor: 'right-top', priority: 4 },
  ],
  suppress: ['game-board', 'reticle', 'skill-bar', 'minimap'],
}

export const MMO_CHARACTER_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'mmo',
  screen: 'character',
  template: 'mmo-character-sheet',
  slots: [
    { moduleId: 'character-panel', anchor: 'right-mid', priority: 1 },
    { moduleId: 'resource-tracker', anchor: 'top-center', priority: 2 },
    { moduleId: 'item-detail', anchor: 'right-mid', priority: 3 },
  ],
  suppress: [
    'inventory-grid',
    'crafting-panel',
    'currency',
    'shop-panel',
    'game-board',
    'reticle',
    'health-status',
    'minimap',
    'quest-tracker',
    'chat-panel',
    'skill-bar',
    'reward-summary',
  ],
}
