import type { GenreScreenLayoutSpec } from './types'

export const ACTION_RPG_START_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'action-rpg',
  screen: 'start',
  template: 'arpg-hero-start',
  slots: [
    { moduleId: 'main-nav', anchor: 'bottom-center', priority: 1 },
    { moduleId: 'character-panel', anchor: 'right-mid', priority: 2 },
  ],
  suppress: ['game-board', 'reticle'],
}

export const ACTION_RPG_HUD_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'action-rpg',
  screen: 'hud',
  template: 'arpg-combat-hud',
  slots: [
    { moduleId: 'minimap', anchor: 'left-top', priority: 1 },
    { moduleId: 'quest-tracker', anchor: 'left-top', priority: 2 },
    { moduleId: 'resource-tracker', anchor: 'top-center', priority: 3 },
    { moduleId: 'health-status', anchor: 'left-bottom', priority: 4 },
    { moduleId: 'skill-bar', anchor: 'right-bottom', priority: 5 },
    { moduleId: 'interaction-hints', anchor: 'bottom-center', priority: 6 },
  ],
  suppress: ['game-board', 'reticle', 'ammo-counter', 'step-counter', 'weapon-hud', 'currency', 'chat-panel'],
}

export const ACTION_RPG_BAG_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'action-rpg',
  screen: 'bag',
  template: 'arpg-inventory',
  slots: [
    { moduleId: 'inventory-grid', anchor: 'center', priority: 1 },
    { moduleId: 'item-detail', anchor: 'right-mid', priority: 2 },
    { moduleId: 'currency', anchor: 'top-center', priority: 3 },
    { moduleId: 'resource-tracker', anchor: 'top-center', priority: 4 },
  ],
  suppress: [
    'crafting-panel',
    'game-board',
    'reticle',
    'health-status',
    'minimap',
    'quest-tracker',
    'shop-panel',
    'character-panel',
  ],
}

export const ACTION_RPG_CHARACTER_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'action-rpg',
  screen: 'character',
  template: 'arpg-character-sheet',
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
    'reward-summary',
  ],
}

export const ACTION_RPG_DIALOG_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'action-rpg',
  screen: 'dialog',
  template: 'arpg-story-dialog',
  slots: [
    { moduleId: 'dialog-box', anchor: 'bottom-wide', priority: 1 },
    { moduleId: 'quest-tracker', anchor: 'right-top', priority: 2 },
    { moduleId: 'interaction-hints', anchor: 'bottom-center', priority: 3 },
  ],
  suppress: [
    'chat-panel',
    'game-board',
    'reticle',
    'inventory-grid',
    'shop-panel',
    'health-status',
    'minimap',
    'currency',
    'crafting-panel',
  ],
}

export const ACTION_RPG_RESULTS_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'action-rpg',
  screen: 'results',
  template: 'arpg-battle-results',
  slots: [
    { moduleId: 'reward-summary', anchor: 'center-wide', priority: 1 },
    { moduleId: 'level-counter', anchor: 'top-center', priority: 2 },
    { moduleId: 'scoreboard', anchor: 'left-mid', priority: 3 },
  ],
  suppress: [
    'inventory-grid',
    'game-board',
    'reticle',
    'health-status',
    'minimap',
    'quest-tracker',
    'shop-panel',
    'dialog-box',
    'crafting-panel',
  ],
}

export const ACTION_RPG_PAUSE_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'action-rpg',
  screen: 'pause',
  template: 'arpg-system-pause',
  slots: [
    { moduleId: 'pause-menu', anchor: 'center-wide', priority: 1 },
    { moduleId: 'settings-panel', anchor: 'right-mid', priority: 2 },
    { moduleId: 'quest-tracker', anchor: 'left-top', priority: 3 },
  ],
  suppress: [
    'game-board',
    'reticle',
    'inventory-grid',
    'shop-panel',
    'health-status',
    'skill-bar',
    'minimap',
  ],
}
