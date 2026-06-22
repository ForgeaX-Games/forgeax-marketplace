import type { GenreScreenLayoutSpec } from './types'

export const PUZZLE_LEVEL_SELECT_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'puzzle',
  screen: 'level-select',
  template: 'casual-stage-map',
  slots: [
    { moduleId: 'level-select', anchor: 'center', priority: 1 },
    { moduleId: 'level-counter', anchor: 'top-center', priority: 2 },
    { moduleId: 'reward-summary', anchor: 'right-mid', priority: 3 },
  ],
  suppress: ['minimap', 'quest-tracker', 'game-board'],
}
