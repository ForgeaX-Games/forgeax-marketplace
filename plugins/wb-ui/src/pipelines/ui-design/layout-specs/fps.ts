import type { GenreScreenLayoutSpec } from './types'

export const FPS_START_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'fps',
  screen: 'start',
  template: 'fps-lobby-start',
  slots: [
    { moduleId: 'main-nav', anchor: 'top-center', priority: 1 },
    { moduleId: 'weapon-select', anchor: 'center', priority: 2 },
  ],
  suppress: ['game-board', 'quest-tracker', 'minimap'],
}

export const FPS_WEAPON_SELECT_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'fps',
  screen: 'weapon-select',
  template: 'fps-weapon-select',
  slots: [
    { moduleId: 'weapon-select', anchor: 'center', priority: 1 },
    { moduleId: 'weapon-hud', anchor: 'right-bottom', priority: 2 },
    { moduleId: 'ammo-counter', anchor: 'right-bottom', priority: 3 },
  ],
  suppress: ['game-board', 'quest-tracker', 'minimap', 'reticle'],
}

export const FPS_HUD_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'fps',
  screen: 'hud',
  template: 'fps-combat-hud',
  slots: [
    { moduleId: 'reticle', anchor: 'center', priority: 1 },
    { moduleId: 'ammo-counter', anchor: 'right-bottom', priority: 2 },
    { moduleId: 'weapon-hud', anchor: 'right-bottom', priority: 3 },
    { moduleId: 'minimap', anchor: 'left-top', priority: 4 },
    { moduleId: 'health-status', anchor: 'left-bottom', priority: 5 },
    { moduleId: 'scoreboard', anchor: 'right-top', priority: 6 },
  ],
  suppress: ['game-board', 'quest-tracker', 'skill-bar', 'step-counter', 'currency'],
}
