// @source wb-character/src/core/CharacterController.ts
/**
 * CharacterControllerBridge -- runtime-injectable bridge for wb-skill (D-1).
 *
 * D-1: wb-skill must NOT import from wb-character at runtime.
 * VFXManager.ts needs getSpriteDirection() and getAimYaw() from the host's
 * CharacterController. This module exposes a module-level singleton that the
 * host (wb-character or any consumer) populates at startup via
 * registerCharacterController(ctrl). VFXManager calls getCharacterController()
 * from this local bridge instead of importing from wb-character.
 *
 * When no controller is registered, getCharacterController() returns null and
 * callers degrade gracefully (default direction, null aim yaw).
 */

export interface ICharacterControllerBridge {
  /** Current sprite direction: 'down' | 'up' | 'left' | 'right' */
  getSpriteDirection(): string
  /** Aim yaw in radians, or null if not aiming */
  getAimYaw(): number | null
}

let _bridge: ICharacterControllerBridge | null = null

/**
 * Register the host's CharacterController instance.
 * Call this once on startup, passing null to unregister.
 */
export function registerCharacterController(ctrl: ICharacterControllerBridge | null): void {
  _bridge = ctrl
}

/** Get the registered CharacterController, or null if none is registered. */
export function getCharacterController(): ICharacterControllerBridge | null {
  return _bridge
}
