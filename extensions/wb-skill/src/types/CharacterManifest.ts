// @source wb-character/src/pipelines/pixel-char/exportManifest.ts
// Type snapshot — pure type/interface declarations, no runtime code.

import type { ExportedAction, ExportedSkill } from './ExportedSkill'

export type { ExportedAction, ExportedSkill }
export type { ExportDirection, ExportedDirection } from './ExportedSkill'

/** Current schema version — game-side should refuse to load versions higher than its own */
export const MANIFEST_SCHEMA_VERSION = 1 as const

/** Root metadata for a full character package */
export interface CharacterManifest {
  /** Schema version */
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION
  /** Character unique id (URL-safe, e.g. `lobster-001`) */
  id: string
  /** Display name */
  name: string
  /**
   * Head-body ratio (representative values 2/4/6/8/10; game-side interpolates).
   * Drives MountPoint calculations; see MountPointTypes.MOUNT_RATIO_TABLE.
   */
  headBodyRatio: number
  /** Default action id to play when no specific action is specified (falls back to idle) */
  defaultAction: string
  /** All exported actions */
  actions: ExportedAction[]
  /** All exported skills (may be empty) */
  skills: ExportedSkill[]
  /** Creation timestamp (ms) */
  exportedAt: number
  /** Export source (character-editor version etc.) */
  exportedBy?: string
}
