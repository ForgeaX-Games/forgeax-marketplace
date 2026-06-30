/**
 * Gameplay mode controls how many directions a sprite sheet must contain
 * and which motion vocabulary drives the prompts.
 *
 *   rpg        — classic 2.5D top-down RPG: 4 directions (down/left/right/up).
 *                Actions retain their native direction sets.
 *
 *   platformer — 2D side-scroller platformer: only RIGHT-facing animations
 *                are generated. The game engine mirrors to the left at runtime.
 *                Jumps, landings, wall interactions and attacks all happen in
 *                a pure side profile, so the prompts emphasise side-view
 *                silhouette readability and gravity-based motion.
 */

import type { ChibiAction, Direction } from './actions'

export type GameplayMode = 'rpg' | 'platformer'

export const DEFAULT_GAMEPLAY_MODE: GameplayMode = 'rpg'

export interface GameplayModePreset {
  id: GameplayMode
  label: string
  shortLabel: string
  icon: string
  description: string
  /** Headline note injected at the top of every prompt. */
  headline: string
  /** Directions any action is FORCED to emit, regardless of its native config. */
  forcedDirections: Direction[] | null
  /**
   * Actions whose `id` appears here are NOT offered in this mode (e.g. RPG-only
   * "death from 4 sides" doesn't make sense for a platformer run-and-jumper;
   * conversely a platformer `jump` doesn't apply to an RPG top-down camera).
   */
  excludedActionIds: string[]
  /** Turnaround layout: 'grid-2x2' for 4-view sheet, 'single-side' for 1-view. */
  turnaroundLayout: 'grid-2x2' | 'single-side'
}

export const GAMEPLAY_MODES: GameplayModePreset[] = [
  {
    id: 'rpg',
    label: 'RPG / 俯视角',
    shortLabel: 'RPG',
    icon: '🗺️',
    description: '经典四方向 RPG 视角，所有动作生成正/背/左/右四个朝向',
    headline:
      'Top-down 2.5D RPG gameplay. The camera looks slightly down at the character. The character must have 4 readable facings (FRONT / BACK / LEFT / RIGHT).',
    forcedDirections: null,
    excludedActionIds: ['jump'],
    turnaroundLayout: 'grid-2x2',
  },
  {
    id: 'platformer',
    label: '横版跳跃',
    shortLabel: '横版',
    icon: '🦘',
    description: '2D 横版平台跳跃，只生成侧面朝向（右），运行时镜像出左向',
    headline:
      '2D side-scrolling platformer gameplay. The camera is a pure side view. Only RIGHT-facing animations are generated; the engine mirrors them to face LEFT at runtime. Gravity is vertical — jumps have a clear takeoff / apex / descent arc, every pose must read cleanly in silhouette from the side.',
    forcedDirections: ['right'],
    // death still works, but we drop RPG-specific 4-direction death content
    excludedActionIds: [],
    turnaroundLayout: 'single-side',
  },
]

export function getGameplayMode(id: string | undefined | null): GameplayModePreset {
  return (
    GAMEPLAY_MODES.find(m => m.id === id)
    ?? GAMEPLAY_MODES.find(m => m.id === DEFAULT_GAMEPLAY_MODE)!
  )
}

/**
 * Apply a gameplay-mode overlay to a canonical ChibiAction.
 *
 * For `rpg` this is a no-op.
 * For `platformer` the action is cloned with `directions = ['right']` and the
 * motion description is prefixed with side-profile guidance so the prompt
 * reads unambiguously when only one row is generated.
 */
export function applyGameplayMode(action: ChibiAction, mode: GameplayMode): ChibiAction {
  const preset = getGameplayMode(mode)
  if (!preset.forcedDirections) return action

  const sideNote =
    '\n\nSIDE-PROFILE CONSTRAINT (platformer): The character faces RIGHT throughout and is seen in pure right-profile (viewer sees its LEFT side). ' +
    'All visible features (limbs, wings, weapons, tentacles, tails — whatever the creature has) are in profile orientation. ' +
    'The engine will mirror this strip to produce the LEFT-facing animation, so never draw front or back views. ' +
    'Horizon stays level. The silhouette must be fully readable as a side view — features farthest from the camera may partially overlap the body, but defining accessories (weapon, cape, ponytail, wings, horns, tail, etc.) remain clearly visible.'

  return {
    ...action,
    directions: [...preset.forcedDirections],
    motion: action.motion + sideNote,
  }
}

/** Filter the catalogue of actions to those that make sense in this mode. */
export function filterActionsForMode<T extends ChibiAction>(actions: T[], mode: GameplayMode): T[] {
  const preset = getGameplayMode(mode)
  if (!preset.excludedActionIds.length) return actions
  const excl = new Set(preset.excludedActionIds)
  return actions.filter(a => !excl.has(a.id))
}
