// @source wb-character/src/vfx/mount/SpineBoneMapper.ts
/**
 * SpineBoneMapper — Spine  → MountPointId 
 *
 * ：
 *  - forgeax_v1（ ， ）
 *  - generic（ ，  fallback）
 *
 * forgeax_v1 （ ）：
 *  root                   — ， 
 *  pelvis                 — 
 *  torso                  — （ ）
 *  torso2, torso4         — / 
 *  head                   — 
 *  head2,3,5,6            — / 
 *  arm_f_up               — （ ）
 *  arm_f_down             — （ ）
 *  hand_f                 — （ ）
 *  arm_b_up               — （ ）
 *  arm_b_down             — （ ）
 *  hand_b                 — （ ）
 *  weapon                 — （ / ，  = WEAPON_TIP）
 *  leg_f_up               — 
 *  leg_f_down             — （  = ）
 *  foot_f                 — 
 *  target_f               — IK （ ，  IK ）
 *  leg_b_up               — 
 *  leg_b_down             — 
 *  foot_b                 — 
 *  target_b               — IK （ ）
 *
 * _f / _b ：
 *   2D Spine  _f = （ ），_b = （ ）
 *  weaponHand='right' → _f bones = HAND_R / SHOULDER_R
 *  weaponHand='left'  → _f bones = HAND_L / SHOULDER_L（ ）
 *
 * （ ） ：
 *  weapon 【 】=  /  = WEAPON_TIP
 *  weapon 【 】=  ≈ hand_f = WEAPON_ROOT
 *   worldRotation （ 、 、 ）
 */

import { MountPointId } from './MountPointTypes'

// ──  ──────────────────────────────────────────────────────────────

/**  */
export type WeaponHand = 'right' | 'left'

/**
 *  —  WEAPON_TIP 
 *
 * melee_*   → ： 、 、 
 * ranged_*  → ： 、 、 
 * magic_*   → ： 、 、 
 * dual_wield → ：  WEAPON_TIP + WEAPON_TIP_L
 * unarmed   → ： ，WEAPON_TIP = HAND_R
 */
export type WeaponType =
  | 'melee_sword'     | 'melee_axe'     | 'melee_blunt'
  | 'ranged_gun'      | 'ranged_bow'    | 'ranged_crossbow'
  | 'magic_staff'     | 'magic_wand'    | 'magic_catalyst'
  | 'dual_wield'
  | 'unarmed'
  | 'custom'

/**
 *  —  humanoid ， 
 *
 * quadruped  → ： ， 
 * avian      → ：  WING_TIP_L/R
 * serpentine → ： 
 * mechanic   → ： / 
 */
export type Species =
  | 'humanoid'    // ✅
  | 'quadruped'   // 🔲
  | 'avian'       // 🔲
  | 'serpentine'  // 🔲
  | 'mechanic'    // 🔲
  | 'custom'      // 🔲

/**  —  /  /  */
export type Gender = 'male' | 'female' | 'neutral'

/**  */
export type BoneConvention = 'forgeax_v1' | 'generic'

/**
 *  —  Spine ，  MountAdapter
 */
export interface CharacterRigProfile {
  /** （ ） */
  species: Species
  /** （ ） */
  gender: Gender
  /**  —  _f/_b  R/L  */
  weaponHand: WeaponHand
  /**  —  WEAPON_TIP  */
  weaponType: WeaponType
  /**  */
  boneConvention: BoneConvention
  /**
   * Spine  → Three.js  
   * ：character height in Spine = 800px, in 3D world = 1.65 unit → scale = 1.65/800
   */
  spineToWorldScale: number
  /**
   * weapon （ / ）
   * true = bone tail = WEAPON_TIP（ ）
   * false = bone root ，WEAPON_TIP  offset
   */
  weaponBoneFullLength: boolean
  /**
   * （ ，0 =  -Z），  3D 
   *  0（ ），  ±π/2
   */
  facingAngle: number
}

/** （ ，forgeax_v1 ） */
export const DEFAULT_RIG_PROFILE: CharacterRigProfile = {
  species:            'humanoid',
  gender:             'male',
  weaponHand:         'right',
  weaponType:         'melee_sword',
  boneConvention:     'forgeax_v1',
  spineToWorldScale:  1.0,   //
  weaponBoneFullLength: true,
  facingAngle:        0,
}

// ──  →  ──────────────────────────────────────────────────────

interface BoneMountEntry {
  mountId: MountPointId
  /** （tail） （head/origin）  */
  useTip: boolean
  /** （  mountId ） */
  priority: number
}

/**
 * 
 */
interface BoneRule {
  /**  */
  pattern: string | RegExp
  /**
   * ：
   *  'weapon'  → （  weaponHand  R  L）
   *  'offhand' → 
   *  null      →  weaponHand（  entries  mountId）
   */
  handSide: 'weapon' | 'offhand' | null
  entries: BoneMountEntry[]
}

// ── forgeax_v1  ─────────────────────────────────────────────────────────

const FORGEAX_V1_RULES: BoneRule[] = [
  // ─  ────────────────────────────────────────────────────────────────────
  {
    pattern: 'root',
    handSide: null,
    entries: [{ mountId: MountPointId.GROUND, useTip: false, priority: 10 }],
  },

  // ─  ──────────────────────────────────────────────────────────────────
  {
    pattern: 'pelvis',
    handSide: null,
    entries: [
      { mountId: MountPointId.WAIST,  useTip: false, priority: 10 },
      { mountId: MountPointId.NAVEL,  useTip: false, priority:  8 },
    ],
  },

  // ─  ──────────────────────────────────────────────────────────────
  {
    pattern: /^torso$/,
    handSide: null,
    entries: [
      { mountId: MountPointId.CHEST, useTip: false, priority: 10 },
      { mountId: MountPointId.BACK,  useTip: false, priority:  8 },
    ],
  },

  // ─ / （torso2, torso4 ） ─────────────────────────────────
  {
    pattern: /^torso[0-9]+$/,
    handSide: null,
    entries: [{ mountId: MountPointId.NECK, useTip: false, priority: 6 }],
  },

  // ─  ──────────────────────────────────────────────────────────────
  {
    pattern: /^head$/,
    handSide: null,
    entries: [{ mountId: MountPointId.HEAD, useTip: false, priority: 10 }],
  },

  // ─ （head2/3/5/6 — / ） ─────────────────────────────────
  {
    pattern: /^head[0-9]+$/,
    handSide: null,
    entries: [{ mountId: MountPointId.HEAD_TOP, useTip: true, priority: 5 }],
  },

  // ─ （ ） ────────────────────────────────────────────────────
  {
    pattern: 'arm_f_up',
    handSide: 'weapon',
    // mountId  weaponHand  SHOULDER_R or SHOULDER_L
    entries: [{ mountId: MountPointId.SHOULDER_R, useTip: false, priority: 10 }],
  },
  {
    pattern: 'arm_f_down',
    handSide: 'weapon',
    entries: [], // ， （KNEE ）
  },
  {
    pattern: 'hand_f',
    handSide: 'weapon',
    entries: [
      { mountId: MountPointId.HAND_R,       useTip: false, priority: 10 },
      { mountId: MountPointId.WEAPON_ROOT,  useTip: false, priority:  9 },
    ],
  },

  // ─ （ ） ──────────────────────────────────────────────────────
  {
    pattern: 'arm_b_up',
    handSide: 'offhand',
    entries: [{ mountId: MountPointId.SHOULDER_L, useTip: false, priority: 10 }],
  },
  {
    pattern: 'arm_b_down',
    handSide: 'offhand',
    entries: [],
  },
  {
    pattern: 'hand_b',
    handSide: 'offhand',
    entries: [
      { mountId: MountPointId.HAND_L,        useTip: false, priority: 10 },
      { mountId: MountPointId.WEAPON_TIP_L,  useTip: false, priority:  8 },
    ],
  },

  // ─  ─────────────────────────────────────────────────────────────────
  // weapon bone root ≈ （hand_f ）
  // weapon bone tip  =  / （weaponBoneFullLength=true  useTip=true）
  {
    pattern: /^weapon$/,
    handSide: null,
    entries: [
      { mountId: MountPointId.WEAPON_TIP, useTip: true,  priority: 10 },
      { mountId: MountPointId.MUZZLE,     useTip: true,  priority:  9 },  //
    ],
  },

  // ─  ─────────────────────────────────────────────────────────────────
  {
    pattern: /^leg_f_down$/,
    handSide: null,
    //  = （ ）
    entries: [{ mountId: MountPointId.KNEE, useTip: false, priority: 10 }],
  },
  {
    pattern: /^foot_f$/,
    handSide: null,
    entries: [{ mountId: MountPointId.ANKLE, useTip: false, priority: 10 }],
  },
  {
    pattern: /^target_[fb]$/,
    handSide: null,
    entries: [], // IK target ，
  },
  // （ ，  bridge  target_b）
  {
    pattern: /^leg_b_(up|down)$/,
    handSide: null,
    entries: [],
  },
  {
    pattern: /^foot_b$/,
    handSide: null,
    entries: [],
  },
]

// ── generic （fallback）────────────────────────────────────────

const GENERIC_RULES: BoneRule[] = [
  //
  { pattern: /\broot\b/i,   handSide: null, entries: [{ mountId: MountPointId.GROUND, useTip: false, priority: 3 }] },
  { pattern: /\b(hip|pelvis|hips)\b/i, handSide: null, entries: [{ mountId: MountPointId.WAIST, useTip: false, priority: 3 }] },
  { pattern: /\b(spine|torso|chest)\b/i, handSide: null, entries: [{ mountId: MountPointId.CHEST, useTip: false, priority: 3 }] },
  { pattern: /\b(neck)\b/i, handSide: null, entries: [{ mountId: MountPointId.NECK, useTip: false, priority: 3 }] },
  { pattern: /\b(head)\b/i, handSide: null, entries: [{ mountId: MountPointId.HEAD, useTip: false, priority: 3 }] },
  { pattern: /\b(weapon|sword|gun|staff|wand)\b/i, handSide: null, entries: [{ mountId: MountPointId.WEAPON_TIP, useTip: true, priority: 3 }] },
  { pattern: /\b(r.?hand|hand.?r|right.?hand)\b/i, handSide: null, entries: [{ mountId: MountPointId.HAND_R, useTip: false, priority: 3 }] },
  { pattern: /\b(l.?hand|hand.?l|left.?hand)\b/i, handSide: null, entries: [{ mountId: MountPointId.HAND_L, useTip: false, priority: 3 }] },
  { pattern: /\b(r.?foot|foot.?r|right.?foot)\b/i, handSide: null, entries: [{ mountId: MountPointId.ANKLE, useTip: false, priority: 3 }] },
  { pattern: /\b(l.?foot|foot.?l|left.?foot)\b/i, handSide: null, entries: [{ mountId: MountPointId.ANKLE, useTip: false, priority: 3 }] },
]

// ──  ───────────────────────────────────────────────────────────────────

/**
 * 
 */
export interface BoneResolvedMount {
  mountId: MountPointId
  useTip: boolean
  priority: number
}

/**
 * → （  buildBoneMap ， ）
 *
 * key = Spine 
 * value = 
 */
export type SpineBoneMap = Map<string, BoneResolvedMount[]>

/**
 * 
 *
 *  Spine ， 。
 * ， 。
 *
 * @param boneNames （  Spine skeleton.bones ）
 * @param profile   
 */
export function buildBoneMap(
  boneNames: string[],
  profile: CharacterRigProfile,
): SpineBoneMap {
  const rules = profile.boneConvention === 'forgeax_v1'
    ? [...FORGEAX_V1_RULES, ...GENERIC_RULES]
    : GENERIC_RULES

  const result: SpineBoneMap = new Map()

  for (const boneName of boneNames) {
    const resolved: BoneResolvedMount[] = []

    for (const rule of rules) {
      const matches = typeof rule.pattern === 'string'
        ? boneName === rule.pattern
        : rule.pattern.test(boneName)

      if (!matches || rule.entries.length === 0) continue

      for (const entry of rule.entries) {
        //  handSide （weapon/offhand → R/L）
        let mountId = entry.mountId

        if (rule.handSide === 'weapon' || rule.handSide === 'offhand') {
          mountId = remapHandSide(entry.mountId, rule.handSide, profile.weaponHand)
        }

        //  non-humanoid ， （  species=humanoid ）
        if (!isMountValidForSpecies(mountId, profile.species)) continue

        resolved.push({ mountId, useTip: entry.useTip, priority: entry.priority })
      }
    }

    if (resolved.length > 0) {
      result.set(boneName, resolved)
    }
  }

  return result
}

// ──  ───────────────────────────────────────────────────────────────────

/**
 * ，  R/L  weapon/offhand 
 */
function remapHandSide(
  mountId: MountPointId,
  handSide: 'weapon' | 'offhand',
  weaponHand: WeaponHand,
): MountPointId {
  const isWeaponSide = handSide === 'weapon'
  const needsFlip    = (isWeaponSide && weaponHand === 'left') ||
                       (!isWeaponSide && weaponHand === 'right')

  if (!needsFlip) return mountId

  // R ↔ L
  const FLIP: Partial<Record<MountPointId, MountPointId>> = {
    [MountPointId.SHOULDER_R]:   MountPointId.SHOULDER_L,
    [MountPointId.SHOULDER_L]:   MountPointId.SHOULDER_R,
    [MountPointId.HAND_R]:       MountPointId.HAND_L,
    [MountPointId.HAND_L]:       MountPointId.HAND_R,
    [MountPointId.WEAPON_ROOT]:  MountPointId.WEAPON_ROOT,  // （ ）
    [MountPointId.WEAPON_TIP_L]: MountPointId.WEAPON_TIP_L,
  }
  return FLIP[mountId] ?? mountId
}

/**
 * 
 *  humanoid ； 
 */
function isMountValidForSpecies(mountId: MountPointId, species: Species): boolean {
  if (species === 'humanoid') return true
  // ：TODO —
  return true
}

// ──  ────────────────────────────────────────────────────────────────
//
//  SpineRigBridge ，  Three.js world unit

export interface GenderBiasOffsets {
  /** （1 = ，<1 = ） */
  shoulderWidthScale: number
  /**  Y （ ） */
  waistYBias: number
  /**  Y  */
  chestYBias: number
}

export const GENDER_BIAS: Record<Gender, GenderBiasOffsets> = {
  male:    { shoulderWidthScale: 1.0,  waistYBias:  0.000, chestYBias:  0.000 },
  female:  { shoulderWidthScale: 0.88, waistYBias:  0.025, chestYBias:  0.020 },
  neutral: { shoulderWidthScale: 0.94, waistYBias:  0.010, chestYBias:  0.010 },
}

// ──  → （  MountAdapter ） ────────────────────────────

/**
 *  WEAPON_TIP （  chest）
 */
export const WEAPON_VFX_HINTS: Record<WeaponType, string[]> = {
  melee_sword:      ['slash', 'sword_blade', 'melee_swing', 'hit_spark'],
  melee_axe:        ['slash', 'melee_swing', 'hit_spark'],
  melee_blunt:      ['stomp', 'melee_swing', 'hit_spark', 'ground_crack'],
  ranged_gun:       ['muzzle_flash', 'bullet_spawn', 'shell_eject'],
  ranged_bow:       ['arrow', 'cast_hand'],
  ranged_crossbow:  ['arrow', 'bullet_spawn'],
  magic_staff:      ['magic_orb', 'pillar_up', 'charge_up'],
  magic_wand:       ['magic_orb', 'cast_hand'],
  magic_catalyst:   ['cast_center', 'aura'],
  dual_wield:       ['slash', 'melee_swing'],
  unarmed:          ['melee_swing', 'hit_spark'],
  custom:           ['slash'],
}
