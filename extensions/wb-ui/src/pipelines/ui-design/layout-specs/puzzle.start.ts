import type { GenreScreenLayoutSpec } from './types'

export const PUZZLE_START_LAYOUT: GenreScreenLayoutSpec = {
  genre: 'puzzle',
  screen: 'start',
  template: 'casual-home-hub',
  slots: [
    { moduleId: 'currency', anchor: 'top-center', priority: 1 },
    { moduleId: 'resource-tracker', anchor: 'top-center', priority: 2 },
    { moduleId: 'main-nav', anchor: 'bottom-center', priority: 3 },
    { moduleId: 'shop-panel', anchor: 'bottom-right', priority: 4 },
  ],
  suppress: ['minimap', 'quest-tracker', 'health-status', 'game-board'],
}
