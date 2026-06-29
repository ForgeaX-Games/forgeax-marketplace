// @source wb-skill/src/vfx/mount/CharPosTracker.ts
/**
 * CharPosTracker stub for wb-character (D-1 bridge, M1 transition).
 *
 * The authoritative implementation lives in wb-skill/src/vfx/mount/CharPosTracker.ts.
 * wb-character/src/pipelines/pixel-char/index.ts calls these two functions to
 * track the character sprite for VFX positioning.
 *
 * No-op stubs during M1; real wiring happens in host layer.
 */

import type * as THREE from 'three'

/** Start tracking a sprite mesh for VFX position queries. No-op stub. */
export function trackCharSprite(
  _mesh: THREE.Mesh,
  _spriteWorldHeight: number,
): void {
  // No-op: VFX system lives in wb-skill; inject at runtime in host layer.
}

/** Stop tracking the current sprite. No-op stub. */
export function untrackCharSprite(): void {
  // No-op: VFX system lives in wb-skill; inject at runtime in host layer.
}
