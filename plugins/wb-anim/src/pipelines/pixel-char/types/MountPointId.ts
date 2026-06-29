// @source wb-skill/src/vfx/mount/MountPointTypes.ts
/**
 * MountPointId -- reverse type snapshot for wb-character/pixel-char.
 *
 * D-3 (plan-strategy.md): After src/vfx/ migrates to wb-skill, wb-character
 * pixel-char pipeline must NOT import from wb-skill (D-1). This file is a
 * pure-enum snapshot of MountPointId, containing only the enum declaration
 * with no runtime logic. The authoritative definition lives in:
 *   wb-skill/src/vfx/mount/MountPointTypes.ts
 *
 * When wb-skill adds new MountPointId values, update this snapshot too.
 */

export enum MountPointId {
  // Lower body
  GROUND        = 'GROUND',
  ANKLE         = 'ANKLE',
  KNEE          = 'KNEE',

  // Torso
  WAIST         = 'WAIST',
  NAVEL         = 'NAVEL',
  CHEST         = 'CHEST',
  BACK          = 'BACK',

  // Upper body / arms
  SHOULDER_R    = 'SHOULDER_R',
  SHOULDER_L    = 'SHOULDER_L',
  HAND_R        = 'HAND_R',
  HAND_L        = 'HAND_L',
  WEAPON_ROOT   = 'WEAPON_ROOT',
  WEAPON_TIP    = 'WEAPON_TIP',
  WEAPON_TIP_L  = 'WEAPON_TIP_L',

  // Head
  NECK          = 'NECK',
  HEAD          = 'HEAD',
  HEAD_TOP      = 'HEAD_TOP',

  // Projectile spawn points (virtual, not body-attached)
  MUZZLE        = 'MUZZLE',
  GROUND_PROJ   = 'GROUND_PROJ',
  SKY_PROJ      = 'SKY_PROJ',
}
