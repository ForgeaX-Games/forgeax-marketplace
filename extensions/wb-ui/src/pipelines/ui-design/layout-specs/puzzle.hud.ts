import type { GenreScreenLayoutSpec } from './types'

export const PUZZLE_HUD_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'puzzle',
  screen: 'hud',
  template: 'match3-centered',
  slots: [
    { moduleId: 'game-board', anchor: 'center', priority: 1 },
    { moduleId: 'score-display', anchor: 'top-center', priority: 2 },
    { moduleId: 'level-counter', anchor: 'left-top', priority: 3 },
    { moduleId: 'step-counter', anchor: 'right-top', priority: 4 },
    { moduleId: 'item-slot', anchor: 'bottom-center', priority: 5 },
    { moduleId: 'interaction-hints', anchor: 'bottom-center', priority: 6 },
    { moduleId: 'endless-mode', anchor: 'top-center', priority: 7 },
  ],
  suppress: [
    'minimap',
    'quest-tracker',
    'health-status',
    'skill-bar',
    'weapon-hud',
    'ammo-counter',
    'reticle',
    'currency',
    'resource-tracker',
    'chat-panel',
  ],
}
