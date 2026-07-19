// @source wb-skill/src/vfx/mount/SharedAdapter.ts
/**
 * SharedAdapter stub for wb-character (D-1 bridge, M1 transition).
 *
 * The authoritative implementation lives in wb-skill/src/vfx/mount/SharedAdapter.ts.
 * wb-character/src/pipelines/pixel-char/index.ts calls these three functions to
 * notify the VFX system about sprite mesh registration and character dimensions.
 *
 * During M1, wb-character no longer bundles the VFX engine. These stubs provide
 * no-op implementations so pixel-char compiles cleanly. The host (wb-character
 * as a workbench) will wire the real implementations at runtime through a future
 * injection mechanism (M2/M3).
 */

import type * as THREE from 'three'

/** Notify the VFX system about detected character dimensions. No-op stub. */
export function notifyDetectedDims(
  _spriteWorldHeight: number,
  _bodyRatio: number,
  _weaponLength: number,
): void {
  // No-op: VFX system lives in wb-skill; inject at runtime in host layer.
}

/** Register a sprite mesh with the VFX mount adapter. No-op stub. */
export function registerSpriteMesh(
  _mesh: THREE.Mesh,
  _spriteWorldHeight: number,
  _bodyRatio: number,
): void {
  // No-op: VFX system lives in wb-skill; inject at runtime in host layer.
}

/** Unregister the current sprite mesh. No-op stub. */
export function unregisterSpriteMesh(): void {
  // No-op: VFX system lives in wb-skill; inject at runtime in host layer.
}
