// @source wb-character/src/vfx/effects/modern/ModernWeaponTypes.ts
/**
 * ModernWeaponTypes — 
 * / / / 
 */

/**  */
export type ModernWeaponCategory =
  | 'handgun'       //
  | 'smg'           //
  | 'assault_rifle' //
  | 'sniper'        //
  | 'shotgun'       //
  | 'rpg'           //
  | 'minigun'       //
  | 'flamethrower'  //
  | 'railgun'       //
  | 'grenade'       // /C4

/** /  */
export type ProjectileType =
  | 'bullet'        // （ ， ）
  | 'shell'         // （ ， ）
  | 'rocket'        // （ ）
  | 'beam'          // （ ， ， ）
  | 'spread'        // （ ）
  | 'flame'         // （ ， ）

/** （ ） */
export type ImpactSurface =
  | 'flesh'         // ：  +
  | 'metal'         // ：  +
  | 'concrete'      // ：  +
  | 'explosive'     // / ：  +

/**  */
export interface ModernWeaponConfig {
  category:        ModernWeaponCategory
  /** （  > 1） */
  projectileCount: number
  projectileType:  ProjectileType
  /** （ / ， ） */
  fireRate:        number
  /**  */
  muzzleFlashScale: number
  /**  */
  trailLength:     number
  /** （ ，0= ） */
  blastRadius:     number
  /** （ ，0= ） */
  spreadAngle:     number
  /** AI prompt  */
  hints:           string[]
}

export const MODERN_WEAPON_CONFIGS: Record<ModernWeaponCategory, ModernWeaponConfig> = {
  handgun: {
    category: 'handgun', projectileCount: 1, projectileType: 'bullet',
    fireRate: 2, muzzleFlashScale: 0.7, trailLength: 0.6,
    blastRadius: 0, spreadAngle: 2,
    hints: ['pistol muzzle flash', 'small smoke puff', 'brass casing eject'],
  },
  smg: {
    category: 'smg', projectileCount: 1, projectileType: 'bullet',
    fireRate: 12, muzzleFlashScale: 0.55, trailLength: 0.4,
    blastRadius: 0, spreadAngle: 5,
    hints: ['rapid fire muzzle', 'continuous smoke', 'spray pattern'],
  },
  assault_rifle: {
    category: 'assault_rifle', projectileCount: 1, projectileType: 'bullet',
    fireRate: 8, muzzleFlashScale: 0.85, trailLength: 0.8,
    blastRadius: 0, spreadAngle: 3,
    hints: ['rifle flash', 'supersonic trail', 'dust kick'],
  },
  sniper: {
    category: 'sniper', projectileCount: 1, projectileType: 'bullet',
    fireRate: 0.5, muzzleFlashScale: 1.3, trailLength: 2.5,
    blastRadius: 0, spreadAngle: 0,
    hints: ['large muzzle blast', 'long vapor trail', 'distant impact', 'chamber smoke'],
  },
  shotgun: {
    category: 'shotgun', projectileCount: 8, projectileType: 'spread',
    fireRate: 1, muzzleFlashScale: 1.2, trailLength: 0.3,
    blastRadius: 0.3, spreadAngle: 25,
    hints: ['wide cone flash', 'scattered pellets', 'close range devastation'],
  },
  rpg: {
    category: 'rpg', projectileCount: 1, projectileType: 'rocket',
    fireRate: 0.3, muzzleFlashScale: 1.5, trailLength: 3.5,
    blastRadius: 3.0, spreadAngle: 0,
    hints: ['rocket exhaust trail', 'backblast smoke', 'large explosion', 'fireball'],
  },
  minigun: {
    category: 'minigun', projectileCount: 1, projectileType: 'bullet',
    fireRate: 25, muzzleFlashScale: 0.9, trailLength: 0.5,
    blastRadius: 0, spreadAngle: 6,
    hints: ['sustained fire', 'rotating barrels glow', 'continuous shell rain'],
  },
  flamethrower: {
    category: 'flamethrower', projectileCount: 1, projectileType: 'flame',
    fireRate: 30, muzzleFlashScale: 0, trailLength: 1.2,
    blastRadius: 0.5, spreadAngle: 18,
    hints: ['cone flame stream', 'napalm burn', 'smoke cloud', 'fire particle'],
  },
  railgun: {
    category: 'railgun', projectileCount: 1, projectileType: 'beam',
    fireRate: 0.4, muzzleFlashScale: 2.0, trailLength: 5.0,
    blastRadius: 0.8, spreadAngle: 0,
    hints: ['electric arc', 'instant beam', 'EMP shockwave', 'plasma discharge'],
  },
  grenade: {
    category: 'grenade', projectileCount: 1, projectileType: 'shell',
    fireRate: 0.5, muzzleFlashScale: 0, trailLength: 0.4,
    blastRadius: 2.5, spreadAngle: 0,
    hints: ['grenade arc', 'delayed explosion', 'smoke ring', 'debris scatter'],
  },
}

/**  +  */
export function inferWeaponCategory(
  charClass: string,
  worldSetting: string,
): ModernWeaponCategory {
  const cls = charClass.toLowerCase()
  const world = worldSetting.toLowerCase()

  if (cls.includes('mech') || cls.includes('mechanical')) {
    if (world.includes('cyber')) return 'railgun'
    if (world.includes('steam')) return 'minigun'
    return 'rpg'
  }
  if (cls.includes('gunner')) {
    if (world.includes('post') || world.includes('wasteland')) return 'assault_rifle'
    if (world.includes('cyber') || world.includes('sci')) return 'railgun'
    if (world.includes('urban') || world.includes('city')) return 'handgun'
    return 'handgun'
  }
  return 'handgun'
}
