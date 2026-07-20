// @source wb-skill/src/vfx/VFXManager.ts
/**
 * VFXManager stub for wb-character (D-1 bridge, M1 transition).
 *
 * The authoritative implementation lives in wb-skill/src/vfx/VFXManager.ts.
 * wb-character/src/pipelines/pixel-char/index.ts calls getVFXManager() to
 * access onCharacterAction, setCharacterSprite, setPlayActionCallback, and
 * setFlashIntensityCallback.
 *
 * This stub returns null from getVFXManager() so all optional-chained calls
 * (?.) are no-ops. The host layer may inject a real VFXManager instance via
 * registerVFXManager() for full VFX integration.
 */

import type * as THREE from 'three'

export interface IVFXManager {
  onCharacterAction(actionId: string): void
  setCharacterSprite(mesh: THREE.Mesh | null, worldHeight?: number): void
  setPlayActionCallback(cb: ((actionId: string) => void) | null): void
  setFlashIntensityCallback(cb: ((intensity: number) => void) | null): void
}

let _vfxManager: IVFXManager | null = null

/**
 * Register a VFXManager instance from the host (e.g. wb-skill).
 * Pass null to unregister.
 */
export function registerVFXManager(mgr: IVFXManager | null): void {
  _vfxManager = mgr
}

/** Get the registered VFXManager, or null if none is registered. */
export function getVFXManager(): IVFXManager | null {
  return _vfxManager
}
