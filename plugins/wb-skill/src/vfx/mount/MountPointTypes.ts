// @source wb-character/src/vfx/mount/MountPointTypes.ts
/**
 * MountPointTypes — VFX ：  + 
 *
 * ：
 *  - " " ：yFrac = worldY / totalHeight
 *  - xFrac = worldX / totalHeight（ = ），  zFrac（ = ）
 *  - 5 （ratio 2/4/6/8/10）  fractions， 
 *  - CharDummy(H=1.65, ratio≈7.5)  ratio=8 ，  yFrac 
 *
 * （Three.js ）：
 *  origin (0,0,0) = 
 *  +Y = ，+X = ，-Z = 
 */

// ──  ID ──────────────────────────────────────────────────────────────────

export enum MountPointId {
  // ─  ─────────────────────────────────────────────────────
  /** （ 、 、 ） */
  GROUND        = 'GROUND',
  /** （ 、 ） */
  ANKLE         = 'ANKLE',
  /** （ 、 ） */
  KNEE          = 'KNEE',

  // ─  ─────────────────────────────────────────────────────
  /** （ 、 、 ，  CHAR_POS） */
  WAIST         = 'WAIST',
  /** / （ ， ） */
  NAVEL         = 'NAVEL',
  /** （ 、 、 ） */
  CHEST         = 'CHEST',
  /** （ 、 、 ） */
  BACK          = 'BACK',

  // ─  ─────────────────────────────────────────────────────
  /** （ 、 ） */
  SHOULDER_R    = 'SHOULDER_R',
  /**  */
  SHOULDER_L    = 'SHOULDER_L',
  /** / （ ）*/
  HAND_R        = 'HAND_R',
  /**  */
  HAND_L        = 'HAND_L',
  /**
   * （  weapon head = hand_f ）
   * ： 、 、 
   */
  WEAPON_ROOT   = 'WEAPON_ROOT',
  /** （ 、 、 ）*/
  WEAPON_TIP    = 'WEAPON_TIP',
  /** （ / ）*/
  WEAPON_TIP_L  = 'WEAPON_TIP_L',

  // ─  ─────────────────────────────────────────────────────
  /** （ 、 ） */
  NECK          = 'NECK',
  /** （ 、 ） */
  HEAD          = 'HEAD',
  /** （ 、 ） */
  HEAD_TOP      = 'HEAD_TOP',

  // ─ （ ， ） ────────────────────────────
  /** / （  WEAPON_TIP ） */
  MUZZLE        = 'MUZZLE',
  /** （  GROUND ） */
  GROUND_PROJ   = 'GROUND_PROJ',
  /** （  HEAD_TOP ） */
  SKY_PROJ      = 'SKY_PROJ',
}

// ──  ────────────────────────────────────────────────────────

export interface MountFractions {
  /** yFrac ∈ [0,1]: 0= ，1=  */
  yFrac: number
  /** xFrac: （ = ），0=  */
  xFrac: number
  /** zFrac: （ = ），0=  */
  zFrac: number
}

/**  */
export type MountTable = Record<MountPointId, MountFractions>

// ──  ──────────────────────────────────────────────────────────────

export interface CharacterDimensions {
  /** （  Three.js scene，  scale） */
  height: number
  /**
   * （ ，  8 = 8 ）
   *  1–10，  yFrac 
   */
  bodyRatio: number
  /**
   * （ ）
   *  (0, 0, 0)
   */
  rootX?: number
  rootY?: number   //  = 0（ ）
  rootZ?: number
  /**
   * （  height），  WEAPON_TIP 
   * 0 = 
   */
  weaponLength?: number
  /**
   * （Y ， ），0 =  -Z
   */
  facingAngle?: number
}

// ── ：5  ────────────────────────────────────────────
//
// ：ratio=8  CharDummy （H=1.65， ）
//       head sphere center y=1.52, top y=1.665, neck y=1.36, chest y=1.00,
//       hip y=0.71, forearm tip x=0.66 y=1.05, shoe bottom y≈0
//
//  ratio （chibi ， ）
//
// ─────────────────────────────────────────────────────────────────────────────

/**  key，  value  */
export const MOUNT_RATIO_TABLE: Record<number, MountTable> = {

  // ── ratio = 2（Q ， ≈1/2 ， ）──────────────
  2: {
    [MountPointId.GROUND]:       { yFrac: 0.000, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.ANKLE]:        { yFrac: 0.040, xFrac: 0.060, zFrac: 0.000 },
    [MountPointId.KNEE]:         { yFrac: 0.130, xFrac: 0.060, zFrac: 0.000 },
    [MountPointId.NAVEL]:        { yFrac: 0.320, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.WAIST]:        { yFrac: 0.350, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.CHEST]:        { yFrac: 0.430, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.BACK]:         { yFrac: 0.430, xFrac: 0.000, zFrac: 0.080 },
    [MountPointId.SHOULDER_R]:   { yFrac: 0.480, xFrac: 0.240, zFrac: 0.000 },
    [MountPointId.SHOULDER_L]:   { yFrac: 0.480, xFrac:-0.240, zFrac: 0.000 },
    [MountPointId.HAND_R]:       { yFrac: 0.450, xFrac: 0.350, zFrac:-0.050 },
    [MountPointId.HAND_L]:       { yFrac: 0.450, xFrac:-0.350, zFrac:-0.050 },
    [MountPointId.WEAPON_ROOT]:  { yFrac: 0.450, xFrac: 0.350, zFrac:-0.050 },
    [MountPointId.WEAPON_TIP]:   { yFrac: 0.450, xFrac: 0.350, zFrac:-0.200 },
    [MountPointId.WEAPON_TIP_L]: { yFrac: 0.450, xFrac:-0.350, zFrac:-0.200 },
    [MountPointId.NECK]:         { yFrac: 0.540, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.HEAD]:         { yFrac: 0.750, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.HEAD_TOP]:     { yFrac: 1.000, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.MUZZLE]:       { yFrac: 0.450, xFrac: 0.350, zFrac:-0.250 },
    [MountPointId.GROUND_PROJ]:  { yFrac: 0.000, xFrac: 0.000, zFrac:-0.500 },
    [MountPointId.SKY_PROJ]:     { yFrac: 2.200, xFrac: 0.000, zFrac: 0.000 },
  },

  // ── ratio = 4（Q ，SD ， ）────────────────────────────
  4: {
    [MountPointId.GROUND]:       { yFrac: 0.000, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.ANKLE]:        { yFrac: 0.030, xFrac: 0.055, zFrac: 0.000 },
    [MountPointId.KNEE]:         { yFrac: 0.140, xFrac: 0.055, zFrac: 0.000 },
    [MountPointId.NAVEL]:        { yFrac: 0.340, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.WAIST]:        { yFrac: 0.360, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.CHEST]:        { yFrac: 0.470, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.BACK]:         { yFrac: 0.470, xFrac: 0.000, zFrac: 0.075 },
    [MountPointId.SHOULDER_R]:   { yFrac: 0.530, xFrac: 0.230, zFrac: 0.000 },
    [MountPointId.SHOULDER_L]:   { yFrac: 0.530, xFrac:-0.230, zFrac: 0.000 },
    [MountPointId.HAND_R]:       { yFrac: 0.490, xFrac: 0.380, zFrac:-0.040 },
    [MountPointId.HAND_L]:       { yFrac: 0.490, xFrac:-0.380, zFrac:-0.040 },
    [MountPointId.WEAPON_ROOT]:  { yFrac: 0.490, xFrac: 0.380, zFrac:-0.040 },
    [MountPointId.WEAPON_TIP]:   { yFrac: 0.490, xFrac: 0.380, zFrac:-0.280 },
    [MountPointId.WEAPON_TIP_L]: { yFrac: 0.490, xFrac:-0.380, zFrac:-0.280 },
    [MountPointId.NECK]:         { yFrac: 0.630, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.HEAD]:         { yFrac: 0.820, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.HEAD_TOP]:     { yFrac: 1.000, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.MUZZLE]:       { yFrac: 0.490, xFrac: 0.380, zFrac:-0.320 },
    [MountPointId.GROUND_PROJ]:  { yFrac: 0.000, xFrac: 0.000, zFrac:-0.500 },
    [MountPointId.SKY_PROJ]:     { yFrac: 2.200, xFrac: 0.000, zFrac: 0.000 },
  },

  // ── ratio = 6（ ， ，  RPG ）────────────────────
  6: {
    [MountPointId.GROUND]:       { yFrac: 0.000, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.ANKLE]:        { yFrac: 0.022, xFrac: 0.053, zFrac: 0.000 },
    [MountPointId.KNEE]:         { yFrac: 0.115, xFrac: 0.053, zFrac: 0.000 },
    [MountPointId.NAVEL]:        { yFrac: 0.370, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.WAIST]:        { yFrac: 0.390, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.CHEST]:        { yFrac: 0.540, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.BACK]:         { yFrac: 0.540, xFrac: 0.000, zFrac: 0.070 },
    [MountPointId.SHOULDER_R]:   { yFrac: 0.590, xFrac: 0.260, zFrac: 0.000 },
    [MountPointId.SHOULDER_L]:   { yFrac: 0.590, xFrac:-0.260, zFrac: 0.000 },
    [MountPointId.HAND_R]:       { yFrac: 0.560, xFrac: 0.390, zFrac:-0.040 },
    [MountPointId.HAND_L]:       { yFrac: 0.560, xFrac:-0.390, zFrac:-0.040 },
    [MountPointId.WEAPON_ROOT]:  { yFrac: 0.560, xFrac: 0.390, zFrac:-0.040 },
    [MountPointId.WEAPON_TIP]:   { yFrac: 0.560, xFrac: 0.390, zFrac:-0.330 },
    [MountPointId.WEAPON_TIP_L]: { yFrac: 0.560, xFrac:-0.390, zFrac:-0.330 },
    [MountPointId.NECK]:         { yFrac: 0.770, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.HEAD]:         { yFrac: 0.895, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.HEAD_TOP]:     { yFrac: 1.000, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.MUZZLE]:       { yFrac: 0.560, xFrac: 0.390, zFrac:-0.370 },
    [MountPointId.GROUND_PROJ]:  { yFrac: 0.000, xFrac: 0.000, zFrac:-0.500 },
    [MountPointId.SKY_PROJ]:     { yFrac: 2.200, xFrac: 0.000, zFrac: 0.000 },
  },

  // ── ratio = 8（ ，CharDummy ）──────────────────────────────
  //   H = 1.65 (unscaled),  = worldY / 1.665 (head top)
  //   WAIST:    0.67 / 1.665 = 0.402
  //   NAVEL:    0.71 / 1.665 = 0.426
  //   CHEST:    1.00 / 1.665 = 0.601
  //   SHOULDER: y = 1.05 / 1.665 = 0.631; x outer ≈ (0.46)/1.665 = 0.276
  //   NECK:     1.36 / 1.665 = 0.817
  //   HEAD ctr: 1.52 / 1.665 = 0.913
  //   HAND_R tip: x = 0.66/1.665 = 0.396, y same as shoulder
  8: {
    [MountPointId.GROUND]:       { yFrac: 0.000, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.ANKLE]:        { yFrac: 0.018, xFrac: 0.057, zFrac: 0.000 },
    [MountPointId.KNEE]:         { yFrac: 0.120, xFrac: 0.057, zFrac: 0.000 },
    [MountPointId.NAVEL]:        { yFrac: 0.426, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.WAIST]:        { yFrac: 0.402, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.CHEST]:        { yFrac: 0.601, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.BACK]:         { yFrac: 0.601, xFrac: 0.000, zFrac: 0.065 },
    [MountPointId.SHOULDER_R]:   { yFrac: 0.631, xFrac: 0.276, zFrac: 0.000 },
    [MountPointId.SHOULDER_L]:   { yFrac: 0.631, xFrac:-0.276, zFrac: 0.000 },
    [MountPointId.HAND_R]:       { yFrac: 0.631, xFrac: 0.396, zFrac:-0.030 },
    [MountPointId.HAND_L]:       { yFrac: 0.631, xFrac:-0.396, zFrac:-0.030 },
    [MountPointId.WEAPON_ROOT]:  { yFrac: 0.631, xFrac: 0.396, zFrac:-0.030 },
    [MountPointId.WEAPON_TIP]:   { yFrac: 0.631, xFrac: 0.396, zFrac:-0.380 },
    [MountPointId.WEAPON_TIP_L]: { yFrac: 0.631, xFrac:-0.396, zFrac:-0.380 },
    [MountPointId.NECK]:         { yFrac: 0.817, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.HEAD]:         { yFrac: 0.913, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.HEAD_TOP]:     { yFrac: 1.000, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.MUZZLE]:       { yFrac: 0.631, xFrac: 0.396, zFrac:-0.420 },
    [MountPointId.GROUND_PROJ]:  { yFrac: 0.000, xFrac: 0.000, zFrac:-0.500 },
    [MountPointId.SKY_PROJ]:     { yFrac: 2.200, xFrac: 0.000, zFrac: 0.000 },
  },

  // ── ratio = 10（ / ， ， ）─────────────────────────
  10: {
    [MountPointId.GROUND]:       { yFrac: 0.000, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.ANKLE]:        { yFrac: 0.015, xFrac: 0.053, zFrac: 0.000 },
    [MountPointId.KNEE]:         { yFrac: 0.130, xFrac: 0.053, zFrac: 0.000 },
    [MountPointId.NAVEL]:        { yFrac: 0.440, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.WAIST]:        { yFrac: 0.415, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.CHEST]:        { yFrac: 0.620, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.BACK]:         { yFrac: 0.620, xFrac: 0.000, zFrac: 0.060 },
    [MountPointId.SHOULDER_R]:   { yFrac: 0.660, xFrac: 0.255, zFrac: 0.000 },
    [MountPointId.SHOULDER_L]:   { yFrac: 0.660, xFrac:-0.255, zFrac: 0.000 },
    [MountPointId.HAND_R]:       { yFrac: 0.640, xFrac: 0.370, zFrac:-0.025 },
    [MountPointId.HAND_L]:       { yFrac: 0.640, xFrac:-0.370, zFrac:-0.025 },
    [MountPointId.WEAPON_ROOT]:  { yFrac: 0.640, xFrac: 0.370, zFrac:-0.025 },
    [MountPointId.WEAPON_TIP]:   { yFrac: 0.640, xFrac: 0.370, zFrac:-0.400 },
    [MountPointId.WEAPON_TIP_L]: { yFrac: 0.640, xFrac:-0.370, zFrac:-0.400 },
    [MountPointId.NECK]:         { yFrac: 0.840, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.HEAD]:         { yFrac: 0.930, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.HEAD_TOP]:     { yFrac: 1.000, xFrac: 0.000, zFrac: 0.000 },
    [MountPointId.MUZZLE]:       { yFrac: 0.640, xFrac: 0.370, zFrac:-0.440 },
    [MountPointId.GROUND_PROJ]:  { yFrac: 0.000, xFrac: 0.000, zFrac:-0.500 },
    [MountPointId.SKY_PROJ]:     { yFrac: 2.200, xFrac: 0.000, zFrac: 0.000 },
  },
}

/**  key （ ） */
export const RATIO_KEYS = [2, 4, 6, 8, 10] as const

// ── （ / ）────────────────────────────────────────────────

export interface MountPointMeta {
  id: MountPointId
  label: string          //
  color: number          // （ ）
  /** （  VFX ） */
  vfxHints: string[]
}

export const MOUNT_META: ReadonlyArray<MountPointMeta> = [
  { id: MountPointId.GROUND,       label: 'ground',       color: 0x888888, vfxHints: ['ground', 'shadow', 'aoe_ring', 'stomp'] },
  { id: MountPointId.ANKLE,        label: 'ankle',       color: 0xaaaaaa, vfxHints: ['footstep', 'dust', 'ice_chain'] },
  { id: MountPointId.KNEE,         label: 'knee',       color: 0x99aacc, vfxHints: ['freeze_lower', 'hit_lower'] },
  { id: MountPointId.NAVEL,        label: 'pelvis',       color: 0xffbb44, vfxHints: ['ground_wave', 'gravity_hit'] },
  { id: MountPointId.WAIST,        label: 'waist',   color: 0xff8800, vfxHints: ['teleport', 'appear', 'dissolve', 'cast_center'] },
  { id: MountPointId.CHEST,        label: 'chest',       color: 0x44aaff, vfxHints: ['shield', 'aura', 'hit_body', 'explosion_self'] },
  { id: MountPointId.BACK,         label: 'back',       color: 0x4488ff, vfxHints: ['wing', 'cape', 'backstab'] },
  { id: MountPointId.SHOULDER_R,   label: 'shoulder-r',       color: 0xffcc00, vfxHints: ['pauldron', 'slash_start'] },
  { id: MountPointId.SHOULDER_L,   label: 'shoulder-l',       color: 0xffcc00, vfxHints: ['pauldron', 'slash_start'] },
  { id: MountPointId.HAND_R,       label: 'hand-r',       color: 0xff4400, vfxHints: ['melee_swing', 'cast_hand', 'charge'] },
  { id: MountPointId.HAND_L,       label: 'hand-l',       color: 0xff4400, vfxHints: ['melee_swing', 'cast_hand', 'offhand'] },
  { id: MountPointId.WEAPON_ROOT,  label: 'weapon-root',   color: 0xff6622, vfxHints: ['grip_charge', 'dual_hold', 'weapon_root'] },
  { id: MountPointId.WEAPON_TIP,   label: 'weapon-tip',   color: 0xff0044, vfxHints: ['sword_blade', 'magic_orb', 'muzzle_flash', 'slash', 'bullet_spawn'] },
  { id: MountPointId.WEAPON_TIP_L, label: 'weapon-tip-l', color: 0xff0044, vfxHints: ['dual_wield'] },
  { id: MountPointId.NECK,         label: 'neck',       color: 0xddaaff, vfxHints: ['link_beam', 'stun_ring'] },
  { id: MountPointId.HEAD,         label: 'head',       color: 0x88ffcc, vfxHints: ['stun_stars', 'crown', 'buff_halo'] },
  { id: MountPointId.HEAD_TOP,     label: 'head-top',       color: 0x00ff88, vfxHints: ['pillar_up', 'charge_up', 'levelup'] },
  { id: MountPointId.MUZZLE,       label: 'muzzle',       color: 0xffee00, vfxHints: ['muzzle_flash', 'bullet_spawn'] },
  { id: MountPointId.GROUND_PROJ,  label: 'ground-proj',   color: 0x00ccff, vfxHints: ['projectile_ground', 'shockwave'] },
  { id: MountPointId.SKY_PROJ,     label: 'sky-proj',   color: 0xffffff, vfxHints: ['meteor', 'starblade', 'sky_strike'] },
]
