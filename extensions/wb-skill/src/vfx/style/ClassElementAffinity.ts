// @source wb-character/src/vfx/style/ClassElementAffinity.ts
/**
 * ClassElementAffinity — 
 *
 * 、 、 ，
 *  VFXColorResolver 。
 */

import * as THREE from 'three'

export type ElementType =
  | 'physical'   //
  | 'fire'       //
  | 'ice'        //
  | 'lightning'  //
  | 'wind'       //
  | 'dark'       //
  | 'light'      //
  | 'poison'     //
  | 'arcane'     // /
  | 'mechanical' //
  | 'explosive'  // /
  | 'nature'     // /

export interface ElementColorSet {
  /**  */
  main: THREE.Color
  /**  */
  glow: THREE.Color
  /**  */
  fade: THREE.Color
}

/**
 * （ ）
 *
 * ：
 *   - （ ）
 *   - glow （ ）
 *   - fade （#000011 ）， 
 *   - 「 」， 
 *
 * ：
 *   physical  ≈ （ ）
 *   fire      ≈  / 
 *   ice       ≈ 
 *   lightning ≈ 
 *   wind      ≈ 
 *   dark      ≈ / 
 *   light     ≈ 
 *   poison    ≈ 
 *   arcane    ≈ 
 *   explosive ≈ 
 *   nature    ≈ · 
 */
export const ELEMENT_COLORS: Record<ElementType, ElementColorSet> = {
  // / ： ，
  physical:   { main: new THREE.Color('#f0e0b0'), glow: new THREE.Color('#ffffff'), fade: new THREE.Color('#110800') },
  // ： ，  RPG ，
  fire:       { main: new THREE.Color('#ff4400'), glow: new THREE.Color('#ffaa00'), fade: new THREE.Color('#1a0000') },
  // ： ，
  ice:        { main: new THREE.Color('#66ccff'), glow: new THREE.Color('#ddf5ff'), fade: new THREE.Color('#000d1a') },
  // ： ，glow （ ）
  lightning:  { main: new THREE.Color('#ffe040'), glow: new THREE.Color('#ffffff'), fade: new THREE.Color('#050510') },
  // ： ， ， " "
  wind:       { main: new THREE.Color('#88ff44'), glow: new THREE.Color('#ccffaa'), fade: new THREE.Color('#001100') },
  // ： / ，glow （  chaos ）
  dark:       { main: new THREE.Color('#9900ff'), glow: new THREE.Color('#cc44ff'), fade: new THREE.Color('#08000f') },
  // ： ，  fire
  light:      { main: new THREE.Color('#ffd700'), glow: new THREE.Color('#fffacc'), fade: new THREE.Color('#100e00') },
  // / ： ， （ ）
  poison:     { main: new THREE.Color('#cc44cc'), glow: new THREE.Color('#ff88ff'), fade: new THREE.Color('#12001a') },
  // ： ，  lightning （ ， ）
  arcane:     { main: new THREE.Color('#4466ff'), glow: new THREE.Color('#88aaff'), fade: new THREE.Color('#000015') },
  // / ： ，  + （ ）
  mechanical: { main: new THREE.Color('#ffaa00'), glow: new THREE.Color('#44ddff'), fade: new THREE.Color('#0a0500') },
  // ： ，  fire ，
  explosive:  { main: new THREE.Color('#ff6600'), glow: new THREE.Color('#ffff44'), fade: new THREE.Color('#0f0500') },
  // ： ，  wind ， 「 」
  nature:     { main: new THREE.Color('#44bb44'), glow: new THREE.Color('#99ff88'), fade: new THREE.Color('#001400') },
}

export interface ClassAffinityEntry {
  /** （  CharacterDesign CLASS_OPTIONS ） */
  className: string
  /**  */
  classNameEn: string
  /** （ / ） */
  primaryElement: ElementType
  /** （ / ） */
  secondaryElement: ElementType
  /** （0= ，1= ） */
  classTint: number
  /** （ 、 ） */
  effectScale: number
  /** （true=weapon_tip，false=hand） */
  weaponTipPrimary: boolean
  /** AI prompt  */
  classHints: string[]
}

/**
 * （ ）
 *
 * classHints ：[ , ... ]
 *  HadesStyleRef.ts HADES_GOD_STYLES
 */
export const CLASS_AFFINITY: ReadonlyArray<ClassAffinityEntry> = [
  {
    // ： （ ）
    className: 'swordsman',
    classNameEn: 'Swordsman',
    primaryElement: 'physical',
    secondaryElement: 'fire',
    classTint: 0.35,
    effectScale: 1.0,
    weaponTipPrimary: true,
    classHints: [
      'sword slash arc', 'blade light trail',
      // Hades style
      'white shard burst on hit', 'short crimson trail', 'clean cut no fog',
    ],
  },
  {
    // ： （ / ）
    className: 'berserker',
    classNameEn: 'Berserker',
    primaryElement: 'fire',
    secondaryElement: 'dark',
    classTint: 0.55,
    effectScale: 1.5,
    weaponTipPrimary: true,
    classHints: [
      'rage aura', 'massive AOE ground crack',
      // Hades Ares style
      'spinning blade shard burst', 'blood red inkblob impact', 'cursed dark ring',
      'heavy thud shockwave', 'extreme bloom on crit',
    ],
  },
  {
    // ： （ ）/ （ ）
    className: 'mage',
    classNameEn: 'Mage',
    primaryElement: 'arcane',
    secondaryElement: 'ice',
    classTint: 0.65,
    effectScale: 1.3,
    weaponTipPrimary: false,
    classHints: [
      'spellcast glow', 'rune circle',
      // Hades Poseidon/Hades style
      'teal crystal shard burst', 'pressure ring expand', 'blue inkblob core',
      'knockback wave pulse', 'dark void void_tear edge',
    ],
  },
  {
    // ： （ ）+ （ ）
    className: 'elementalist',
    classNameEn: 'Elementalist',
    primaryElement: 'lightning',
    secondaryElement: 'ice',
    classTint: 0.65,
    effectScale: 1.35,
    weaponTipPrimary: false,
    classHints: [
      'dual element clash',
      // Hades multi-element
      'gold arc meets ice crystal', 'prism shard split', 'chain_arc to crystal_burst',
      'extreme saturation color clash', 'two-color shard explosion',
    ],
  },
  {
    // ： （ ）
    className: 'archer',
    classNameEn: 'Archer',
    primaryElement: 'wind',
    secondaryElement: 'physical',
    classTint: 0.45,
    effectScale: 0.9,
    weaponTipPrimary: true,
    classHints: [
      'arrow trail', 'precision shot',
      // Hades Artemis style
      'silver arrow pierce shard', 'moon leaf fragment', 'critical star burst on crit',
      'clean pierce no smoke', 'afterimage trajectory line',
    ],
  },
  {
    // ： （ ）+
    className: 'gunner',
    classNameEn: 'Gunner',
    primaryElement: 'explosive',
    secondaryElement: 'mechanical',
    classTint: 0.45,
    effectScale: 1.05,
    weaponTipPrimary: true,
    classHints: [
      'muzzle flash', 'bullet trail',
      // Hades Hephaestus style
      'forge spark burst', 'delayed explosion ring', 'anvil impact shard',
      'orange-gold bloom', 'shell casing shard',
    ],
  },
  {
    // ： （ ）
    className: 'assassin',
    classNameEn: 'Assassin',
    primaryElement: 'wind',
    secondaryElement: 'physical',
    classTint: 0.4,
    effectScale: 0.85,
    weaponTipPrimary: true,
    classHints: [
      'quick dash trail', 'blade flicker',
      // Hades Zagreus style
      'crimson shard quick burst', 'no lingering trail', 'fast dissipate',
      'blood shard on hit', 'clean cut impact',
    ],
  },
  {
    // ： （ ）+ （ ）
    className: 'shadow-assassin',
    classNameEn: 'Shadow Assassin',
    primaryElement: 'dark',
    secondaryElement: 'physical',
    classTint: 0.7,
    effectScale: 0.95,
    weaponTipPrimary: true,
    classHints: [
      'shadow step', 'void energy',
      // Hades Chaos/shadow style
      'void_tear step trail', 'purple shard dark edge', 'dark inkblob vanish',
      'ghost afterimage', 'shadow clone silhouette',
    ],
  },
  {
    // ： （ ）+ （ ）
    className: 'fighter',
    classNameEn: 'Fighter',
    primaryElement: 'physical',
    secondaryElement: 'lightning',
    classTint: 0.4,
    effectScale: 1.15,
    weaponTipPrimary: false,
    classHints: [
      'shockwave fist', 'ki blast',
      // Hades Ares+Zeus hybrid
      'impact shard radial burst', 'ring_pulse on heavy hit', 'lightning spark on crit',
      'ground crack inkblob', 'compressed energy release',
    ],
  },
  {
    // ： （ / ）
    className: 'paladin',
    classNameEn: 'Paladin',
    primaryElement: 'light',
    secondaryElement: 'physical',
    classTint: 0.55,
    effectScale: 1.2,
    weaponTipPrimary: true,
    classHints: [
      'holy aura', 'divine shield',
      // Hades Athena style
      'gold shield deflect flash', 'laurel shard burst', 'divine_pillar on skill',
      'white-gold bloom ring', 'sacred inkblob on parry',
    ],
  },
  {
    // ：  /
    className: 'priest',
    classNameEn: 'Priest',
    primaryElement: 'light',
    secondaryElement: 'arcane',
    classTint: 0.55,
    effectScale: 1.0,
    weaponTipPrimary: false,
    classHints: [
      'healing orb', 'bless circle',
      // Hades boon style (soft but saturated)
      'warm gold shard rain', 'divine_pillar heal beam', 'ring_pulse heal wave',
      'saturated gold-white', 'no dark edges (only light)',
    ],
  },
  {
    // ：  /
    className: 'summoner',
    classNameEn: 'Summoner',
    primaryElement: 'arcane',
    secondaryElement: 'dark',
    classTint: 0.5,
    effectScale: 1.3,
    weaponTipPrimary: false,
    classHints: [
      'summoning circle', 'spirit energy',
      // Hades underworld summon
      'void_tear summoning portal', 'dark shard explode on summon', 'purple inkblob bind',
      'creature silhouette aura', 'dark arcane ring_pulse',
    ],
  },
  {
    // ： （ ）
    className: 'ninja',
    classNameEn: 'Ninja',
    primaryElement: 'wind',
    secondaryElement: 'dark',
    classTint: 0.4,
    effectScale: 0.8,
    weaponTipPrimary: true,
    classHints: [
      'smoke bomb', 'kunai flash',
      // Hades Hermes style
      'speed afterimage shard', 'green motion blur streak', 'no contact impact only trail',
      'quick step shard pop', 'afterimage ghost line',
    ],
  },
  {
    // ： （ ）
    className: 'monk',
    classNameEn: 'Monk',
    primaryElement: 'lightning',
    secondaryElement: 'physical',
    classTint: 0.45,
    effectScale: 1.1,
    weaponTipPrimary: false,
    classHints: [
      'chi energy', 'pressure wave',
      // Hades Zeus style
      'chain_arc fist strike', 'gold-white spark burst', 'thunder ring_pulse',
      'instant snap electric', 'focused lightning shard',
    ],
  },
  {
    // ： （ ）
    className: 'mechanic',
    classNameEn: 'Mechanic',
    primaryElement: 'mechanical',
    secondaryElement: 'explosive',
    classTint: 0.55,
    effectScale: 1.25,
    weaponTipPrimary: true,
    classHints: [
      'electric spark', 'machine smoke',
      // Hades Hephaestus style
      'forge ember_drift', 'delayed explosion shard', 'anvil inkblob shockwave',
      'orange-teal contrast', 'gear shard burst',
    ],
  },
  {
    // ： （ / ）
    className: 'alchemist',
    classNameEn: 'Alchemist',
    primaryElement: 'poison',
    secondaryElement: 'explosive',
    classTint: 0.6,
    effectScale: 1.15,
    weaponTipPrimary: false,
    classHints: [
      'flask explosion', 'transmute glow',
      // Hades Dionysus style
      'purple inkblob puddle splat', 'poison mist linger', 'festive shard sparkle',
      'grape burst particle', 'sticky slow spread',
    ],
  },
  {
    // ： （ ）+ （ ）
    className: 'exorcist',
    classNameEn: 'Exorcist',
    primaryElement: 'light',
    secondaryElement: 'dark',
    classTint: 0.6,
    effectScale: 1.2,
    weaponTipPrimary: true,
    classHints: [
      'banish light', 'exorcism beam',
      // Hades dual-tone
      'gold shard meets void_tear', 'divine seal ring_pulse', 'holy-dark contrast burst',
      'bright edge dark core', 'spirit inkblob dissipate',
    ],
  },
  {
    // ： （ / ）/ （ ）
    className: 'bard',
    classNameEn: 'Bard',
    primaryElement: 'arcane',
    secondaryElement: 'wind',
    classTint: 0.45,
    effectScale: 0.95,
    weaponTipPrimary: false,
    classHints: [
      'music note particle', 'sound wave',
      // Hades Dionysus festive style
      'purple sparkle shard', 'festive ring_pulse', 'melody afterimage',
      'inspire aura bloom', 'soft inkblob on buff',
    ],
  },
]

/** ，  */
export function getClassAffinity(className: string): ClassAffinityEntry {
  return (
    CLASS_AFFINITY.find(c => c.className === className) ??
    {
      className,
      classNameEn: className,
      primaryElement: 'physical' as ElementType,
      secondaryElement: 'fire' as ElementType,
      classTint: 0.3,
      effectScale: 1.0,
      weaponTipPrimary: true,
      classHints: [],
    }
  )
}
