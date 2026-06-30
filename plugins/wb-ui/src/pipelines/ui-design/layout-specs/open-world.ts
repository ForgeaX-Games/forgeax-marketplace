import type { GenreScreenLayoutSpec } from './types'

export const OPEN_WORLD_START_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'open-world',
  screen: 'start',
  template: 'open-world-cinematic-start',
  slots: [
    { moduleId: 'main-nav', anchor: 'bottom-left', priority: 1 },
    { moduleId: 'settings-panel', anchor: 'bottom-left', priority: 2 },
  ],
  suppress: ['game-board', 'reticle'],
}

export const OPEN_WORLD_HUD_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'open-world',
  screen: 'hud',
  template: 'open-world-explore-hud',
  slots: [
    { moduleId: 'minimap', anchor: 'left-top', priority: 1 },
    { moduleId: 'quest-tracker', anchor: 'right-top', priority: 2 },
    { moduleId: 'health-status', anchor: 'left-bottom', priority: 3 },
    { moduleId: 'skill-bar', anchor: 'bottom-center', priority: 4 },
    { moduleId: 'interaction-hints', anchor: 'bottom-center', priority: 5 },
    { moduleId: 'currency', anchor: 'left-top', priority: 6 },
    { moduleId: 'weapon-hud', anchor: 'right-bottom', priority: 7 },
  ],
  suppress: ['game-board', 'reticle', 'step-counter'],
}

export const OPEN_WORLD_BAG_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'open-world',
  screen: 'bag',
  template: 'open-world-inventory',
  slots: [
    { moduleId: 'inventory-grid', anchor: 'center', priority: 1 },
    { moduleId: 'item-detail', anchor: 'right-mid', priority: 2 },
    { moduleId: 'currency', anchor: 'top-center', priority: 3 },
    { moduleId: 'resource-tracker', anchor: 'top-center', priority: 4 },
    { moduleId: 'crafting-panel', anchor: 'right-mid', priority: 5 },
  ],
  suppress: ['game-board', 'reticle', 'health-status', 'minimap', 'quest-tracker'],
}

export const OPEN_WORLD_CHARACTER_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'open-world',
  screen: 'character',
  template: 'open-world-character-sheet',
  slots: [
    { moduleId: 'character-panel', anchor: 'right-mid', priority: 1 },
    { moduleId: 'item-detail', anchor: 'right-mid', priority: 2 },
  ],
  suppress: [
    'inventory-grid',
    'crafting-panel',
    'resource-tracker',
    'currency',
    'shop-panel',
    'game-board',
    'reticle',
    'health-status',
    'minimap',
    'quest-tracker',
  ],
}

export const OPEN_WORLD_DIALOG_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'open-world',
  screen: 'dialog',
  template: 'open-world-npc-dialog',
  slots: [
    { moduleId: 'dialog-box', anchor: 'bottom-wide', priority: 1 },
    { moduleId: 'quest-tracker', anchor: 'right-top', priority: 2 },
    { moduleId: 'interaction-hints', anchor: 'bottom-center', priority: 3 },
  ],
  suppress: ['game-board', 'reticle', 'health-status', 'minimap', 'chat-panel'],
}
