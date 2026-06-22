// @source wb-character/src/pipelines/pixel-char/action-lib.ts
// Type snapshot — pure type/interface declarations, no runtime code.

import type { VfxType } from './VfxType'

export type { VfxType }

export interface VfxBinding {
  type: VfxType
  startFrame: number
  duration: number
  color: string
  scale: number
  /**
   * Original effect id (e.g. `starblade` / `weaponslash` / `dashtrail` / `attack`).
   * Optional — legacy manifests without it fall back to type-based generic particles.
   * Game-side VfxOverlay prefers effectId; falls back to type if absent.
   */
  effectId?: string
}
