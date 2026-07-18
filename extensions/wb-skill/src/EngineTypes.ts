// @source wb-character/src/core/Engine.ts
/**
 * EngineTypes -- minimal Engine interface snapshot for wb-skill (D-1).
 *
 * D-1: wb-skill must NOT import from wb-character at runtime.
 * vfx2-bootstrap.ts receives an Engine instance via the __ce:ready event
 * and needs type information for scene, camera, and onUpdate.
 * This file declares only the fields accessed by vfx2-bootstrap.
 *
 * The authoritative class lives in:
 *   wb-character/src/core/Engine.ts
 */

import type * as THREE from 'three'

export interface IEngine {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  onUpdate(cb: (dt: number) => void): void
}
