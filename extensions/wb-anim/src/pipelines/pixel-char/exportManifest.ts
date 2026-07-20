/**
 * CharacterManifest —    +    +        
 *
 *      character-editor        （  phaser-2d）        。
 *       game_templates/templates/basic/phaser-2d/src/forgea-character/
 * （   schemaVersion        ）。
 *
 *   ：
 *   1.           sprite sheet + action-lib    SkillMeta
 *   2. publishToGame()    schema    manifest + PNG atlases
 *   3.     CharacterLoader.ts    schema     ，   Phaser + VFXOverlay
 */

import type { VfxBinding } from './action-lib'
import { MountPointId } from './types/MountPointId'

/**    schema   ，                  */
export const MANIFEST_SCHEMA_VERSION = 1 as const

/**    （  actions.ts   Direction     ） */
export type ExportDirection = 'down' | 'up' | 'left' | 'right'

/**         +    */
export interface ExportedDirection {
  /**    manifest      PNG   ，  `sprites/attack/atlas_down.png` */
  atlasFile: string
  /**         （atlas   = frameSize * frameCount） */
  frameCount: number
  /**
   *       ，  turnaround   sprite     ；   ：
   *   (0,0)   frame    ，Y     
   *              （      frameSize      0-1）。
   *
   *      ，     ，        `frameSize/2`      。
   */
  referenceAnchors?: {
    /**     （     ） */
    feet?: { x: number; y: number }
    /**     （      / CHAR_POS   ） */
    waist?: { x: number; y: number }
    /**   （     / HEAD_TOP） */
    head?: { x: number; y: number }
    /**     （VFX      ） */
    weaponHand?: { x: number; y: number }
  }
}

/**     （     ） */
export interface ExportedAction {
  /** actionId: idle / walk / run / attack / hurt / death / skill1 ... */
  id: string
  /**     （   ） */
  frameSize: number
  fps: number
  looping: boolean
  /**               （  looping   ） */
  holdLastFrameMs: number
  /**       ；           */
  directions: Partial<Record<ExportDirection, ExportedDirection>>
}

/**      （        + VFX） */
export interface ExportedSkill {
  /**    id（normal =   ） */
  slotId: 'normal' | 'skill1' | 'skill2' | 'skill3' | 'skill4' | 'ultimate'
  /**     */
  name: string
  /**             （actionId） */
  actionId: string
  /**           VFX +    +   （0-based） */
  triggerFrame: number
  /**     （   CombatFormula.calcSkillDamage） */
  damage: number
  /**     （    ） */
  range: number
  /**       */
  cooldown: number
  /**      */
  targeting: 'nearest' | 'forward' | 'aoe'
  /**       （slash / impact / aura / projectile） */
  vfx: VfxBinding
  /** VFX           （   WEAPON_ROOT） */
  mountPointId?: MountPointId
}

/**            */
export interface CharacterManifest {
  /** Schema    */
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  /**      id（URL   ，  `lobster-001`） */
  id: string
  /**     */
  name: string
  /**
   *    （2 / 4 / 6 / 8 / 10     ；             ）
   *    MountPoint   ，  MountPointTypes.MOUNT_RATIO_TABLE
   */
  headBodyRatio: number
  /**         id（       idle） */
  defaultAction: string
  /**      */
  actions: ExportedAction[]
  /**     （     ） */
  skills: ExportedSkill[]
  /**      （ms） */
  exportedAt: number
  /**    （character-editor     ，      ） */
  exportedBy?: string
}

/**
 *   manifest      action
 */
export function findAction(
  manifest: CharacterManifest,
  actionId: string,
): ExportedAction | undefined {
  return manifest.actions.find(a => a.id === actionId)
}

/**
 *   manifest      skill slot
 */
export function findSkill(
  manifest: CharacterManifest,
  slotId: ExportedSkill['slotId'],
): ExportedSkill | undefined {
  return manifest.skills.find(s => s.slotId === slotId)
}
