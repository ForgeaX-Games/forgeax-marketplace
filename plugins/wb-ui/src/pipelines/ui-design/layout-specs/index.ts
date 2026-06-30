import type { GenrePresetId, ScreenKind } from '../model'
import {
  ACTION_RPG_BAG_LAYOUT,
  ACTION_RPG_CHARACTER_LAYOUT,
  ACTION_RPG_DIALOG_LAYOUT,
  ACTION_RPG_HUD_LAYOUT,
  ACTION_RPG_PAUSE_LAYOUT,
  ACTION_RPG_RESULTS_LAYOUT,
  ACTION_RPG_START_LAYOUT,
} from './action-rpg'
import { FPS_HUD_LAYOUT, FPS_START_LAYOUT, FPS_WEAPON_SELECT_LAYOUT } from './fps'
import { LIFE_SIM_HUD_LAYOUT, LIFE_SIM_START_LAYOUT } from './life-sim'
import { MMO_CHARACTER_LAYOUT, MMO_DIALOG_LAYOUT, MMO_HUD_LAYOUT, MMO_START_LAYOUT } from './mmo'
import {
  OPEN_WORLD_BAG_LAYOUT,
  OPEN_WORLD_CHARACTER_LAYOUT,
  OPEN_WORLD_DIALOG_LAYOUT,
  OPEN_WORLD_HUD_LAYOUT,
  OPEN_WORLD_START_LAYOUT,
} from './open-world'
import { PUZZLE_HUD_LAYOUT } from './puzzle.hud'
import { PUZZLE_LEVEL_SELECT_LAYOUT } from './puzzle.level-select'
import { PUZZLE_START_LAYOUT } from './puzzle.start'
import { RACING_HUD_LAYOUT, RACING_LEVEL_SELECT_LAYOUT, RACING_START_LAYOUT } from './racing'
import { SURVIVAL_HUD_LAYOUT, SURVIVAL_START_LAYOUT } from './survival'
import type { GenreScreenLayoutSpec } from './types'

export type { GenreScreenLayoutSpec, LayoutAnchorId, LayoutModuleSlot, LayoutTemplateId } from './types'
export { LAYOUT_ANCHOR_CLASS } from './types'
export * from './open-world'
export * from './action-rpg'
export * from './fps'
export * from './survival'
export * from './mmo'
export * from './life-sim'
export * from './racing'
export * from './puzzle.hud'
export * from './puzzle.start'
export * from './puzzle.level-select'

const LAYOUT_SPECS: GenreScreenLayoutSpec[] = [
  OPEN_WORLD_START_LAYOUT,
  OPEN_WORLD_HUD_LAYOUT,
  OPEN_WORLD_BAG_LAYOUT,
  OPEN_WORLD_CHARACTER_LAYOUT,
  OPEN_WORLD_DIALOG_LAYOUT,
  ACTION_RPG_START_LAYOUT,
  ACTION_RPG_HUD_LAYOUT,
  ACTION_RPG_BAG_LAYOUT,
  ACTION_RPG_CHARACTER_LAYOUT,
  ACTION_RPG_DIALOG_LAYOUT,
  ACTION_RPG_RESULTS_LAYOUT,
  ACTION_RPG_PAUSE_LAYOUT,
  FPS_START_LAYOUT,
  FPS_WEAPON_SELECT_LAYOUT,
  FPS_HUD_LAYOUT,
  SURVIVAL_START_LAYOUT,
  SURVIVAL_HUD_LAYOUT,
  MMO_START_LAYOUT,
  MMO_HUD_LAYOUT,
  MMO_DIALOG_LAYOUT,
  MMO_CHARACTER_LAYOUT,
  LIFE_SIM_START_LAYOUT,
  LIFE_SIM_HUD_LAYOUT,
  RACING_START_LAYOUT,
  RACING_LEVEL_SELECT_LAYOUT,
  RACING_HUD_LAYOUT,
  PUZZLE_START_LAYOUT,
  PUZZLE_LEVEL_SELECT_LAYOUT,
  PUZZLE_HUD_LAYOUT,
]

const layoutSpecKey = (genre: GenrePresetId, screen: ScreenKind): string => `${genre}:${screen}`

const LAYOUT_SPEC_MAP = new Map<string, GenreScreenLayoutSpec>(
  LAYOUT_SPECS.map(spec => [layoutSpecKey(spec.genre, spec.screen), spec]),
)

export function getLayoutSpec(
  genre: GenrePresetId,
  screen: ScreenKind,
): GenreScreenLayoutSpec | undefined {
  return LAYOUT_SPEC_MAP.get(layoutSpecKey(genre, screen))
}

export function listLayoutSpecs(): GenreScreenLayoutSpec[] {
  return [...LAYOUT_SPECS]
}

export function listGenreLayoutSpecs(genre: GenrePresetId): GenreScreenLayoutSpec[] {
  return LAYOUT_SPECS.filter(spec => spec.genre === genre)
}
