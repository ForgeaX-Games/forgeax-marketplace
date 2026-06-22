// @source wb-character/src/pipelines/pixel-char/exportManifest.ts
// Type snapshot — pure type/interface declarations, no runtime code.

import type { VfxBinding } from './VfxBinding'

/** The four sprite directions */
export type ExportDirection = 'down' | 'up' | 'left' | 'right'

/** Per-direction frame atlas + anchors */
export interface ExportedDirection {
  /** Relative PNG path, e.g. `sprites/attack/atlas_down.png` */
  atlasFile: string
  /** Number of frames laid out horizontally (atlas width = frameSize * frameCount) */
  frameCount: number
  /**
   * True-pixel anchors extracted from turnaround or sprite analysis.
   * Coordinate system: (0,0) = frame top-left, Y increases downward.
   * All anchors are single-frame pixel coordinates (game-side normalises to 0-1 by frameSize).
   * Absent if extraction failed; game-side falls back to `frameSize/2` geometric center.
   */
  referenceAnchors?: {
    feet?: { x: number; y: number }
    waist?: { x: number; y: number }
    head?: { x: number; y: number }
    weaponHand?: { x: number; y: number }
  }
}

/** Single action (all four directions bundled) */
export interface ExportedAction {
  /** actionId: idle / walk / run / attack / hurt / death / skill1 ... */
  id: string
  /** Frame size in pixels (square) */
  frameSize: number
  fps: number
  looping: boolean
  /** Milliseconds to hold on last frame when not looping */
  holdLastFrameMs: number
  /** Per-direction frame data; absent if that direction was not exported */
  directions: Partial<Record<ExportDirection, ExportedDirection>>
}

/** An exported skill slot bound to an action + VFX */
export interface ExportedSkill {
  /** Slot id (normal = basic attack) */
  slotId: 'normal' | 'skill1' | 'skill2' | 'skill3' | 'skill4' | 'ultimate'
  /** Display name */
  name: string
  /** Which action plays when this skill triggers (actionId) */
  actionId: string
  /** Frame index (0-based) at which VFX + targeting + resolution fires */
  triggerFrame: number
  /** Base damage (fed to CombatFormula.calcSkillDamage) */
  damage: number
  /** Attack range (world units) */
  range: number
  /** Cooldown in milliseconds */
  cooldown: number
  /** Targeting strategy */
  targeting: 'nearest' | 'forward' | 'aoe'
  /** Particle VFX binding (slash / impact / aura / projectile) */
  vfx: VfxBinding
  /** Mount point where VFX originates (defaults to WEAPON_ROOT) */
  mountPointId?: string
}
