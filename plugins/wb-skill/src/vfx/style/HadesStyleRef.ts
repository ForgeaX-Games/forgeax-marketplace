// @source wb-character/src/vfx/style/HadesStyleRef.ts
/**
 * HadesStyleRef — 
 *
 *  Supergiant Games《Hades》 ，
 *  VFX 。
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * （  RPG ）
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 1. （Shape Language）
 *    -  RPG：  + （ ）
 *    - ：   + （ ）
 *    - ： 「 」， 
 *    - ， （0.3~0.6s）， 
 *
 * 2. （Color Identity）
 *    - ：  = 
 *    - （saturation 1.6~2.0）， 
 *    - （#0d0014 ）， 
 *    - ， （ ：  + ）
 *
 * 3. （Bloom）
 *    -  extreme bloom（bloomIntensity ≥ 1.8）
 *    - bloom 「 」， 
 *    - ，  bloom ， 
 *
 * 4. （Timing）
 *    - ： 「 」→ 
 *    - ：  0.05~0.1s（ ），  0.2~0.4s（ ）
 *    - ， 「 」
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  → 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

import * as THREE from 'three'

// ───  ─────────────────────────────────────────────────────────────

export interface GodStyleEntry {
  /** （  + ） */
  name:        string
  nameZh:      string
  /** （ ）*/
  mappedClasses: string[]
  /** （ ）*/
  primary:     THREE.Color
  /** /  */
  secondary:   THREE.Color
  /** （ ）*/
  void:        THREE.Color
  /** bloom （  1.0）*/
  bloomMult:   number
  /** （  AI  VFX ）*/
  shapeKeywords: string[]
  /** （ / ）*/
  motionKeywords: string[]
  /**  */
  effectNote: string
}

function c(h: string) { return new THREE.Color(h) }

export const HADES_GOD_STYLES: ReadonlyArray<GodStyleEntry> = [
  {
    name: 'Zagreus',
    nameZh: 'Zagreus (protagonist)',
    mappedClasses: ['assassin', 'shadow-assassin'],
    primary:    c('#cc1111'),   //
    secondary:  c('#ff4422'),   //
    void:       c('#220000'),   //
    bloomMult:  1.4,
    shapeKeywords: ['blood shard', 'crimson slash arc', 'bone fragment burst', 'dark red ink splash'],
    motionKeywords: ['fast dash trail', 'quick cut', 'no lingering smoke', 'instant dissipate'],
    effectNote: 'blood-red sharp fragments + short trail, strong close-range combo feel, no afterimage',
  },
  {
    name: 'Ares',
    nameZh: 'Ares (war god)',
    mappedClasses: ['berserker', 'fighter'],
    primary:    c('#cc0000'),   //
    secondary:  c('#880000'),   //
    void:       c('#110000'),
    bloomMult:  1.6,
    shapeKeywords: ['spinning blade shard', 'blood mist burst', 'dark red vortex', 'cursed blade ring'],
    motionKeywords: ['spinning rotation', 'heavy impact', 'lingering curse ring', 'slow pulse'],
    effectNote: 'rotating blade fragments + curse ring, heavier and slower than Zagreus, rotational motion',
  },
  {
    name: 'Poseidon',
    nameZh: 'Poseidon (sea god)',
    mappedClasses: ['mage', 'elementalist'],
    primary:    c('#0099cc'),   //
    secondary:  c('#44ddff'),   //
    void:       c('#001122'),   //
    bloomMult:  1.5,
    shapeKeywords: ['water column burst', 'teal crystal shard', 'ocean foam splash', 'pressure wave ring'],
    motionKeywords: ['knockback wave', 'radial splash', 'wet impact sound', 'tide retreat'],
    effectNote: 'cyan crystal pillars + pressure shockwave ring, signature: knocks enemies airborne on hit',
  },
  {
    name: 'Zeus',
    nameZh: 'Zeus (thunder god)',
    mappedClasses: ['monk', 'fighter', 'elementalist'],
    primary:    c('#ffe040'),   //
    secondary:  c('#ffffff'),   //
    void:       c('#0a0a1a'),   //
    bloomMult:  2.0,            //  bloom，
    shapeKeywords: ['electric arc branch', 'lightning bolt fork', 'gold-white spark chain', 'thunder ring'],
    motionKeywords: ['instant snap', 'chain reaction', 'no wind-up', 'sharp crack'],
    effectNote: 'branching lightning + chain conduction, extremely bright and fast, instant hit',
  },
  {
    name: 'Athena',
    nameZh: 'Athena (wisdom goddess)',
    mappedClasses: ['paladin', 'exorcist'],
    primary:    c('#ffd700'),   //
    secondary:  c('#f5f5cc'),   //
    void:       c('#1a1400'),   //
    bloomMult:  1.7,
    shapeKeywords: ['gold shield flash', 'deflect spark burst', 'laurel petal shard', 'divine white ring'],
    motionKeywords: ['deflect rebound', 'shield pulse', 'reflect flash', 'protective dome'],
    effectNote: 'golden shield ricochet + bounce particles, signature: defense-as-offense ricochet feel',
  },
  {
    name: 'Artemis',
    nameZh: 'Artemis (moon/hunt goddess)',
    mappedClasses: ['archer', 'gunner'],
    primary:    c('#aaddaa'),   //
    secondary:  c('#ffffff'),   //
    void:       c('#001108'),   //
    bloomMult:  1.6,
    shapeKeywords: ['silver arrow pierce', 'moon leaf fragment', 'critical star burst', 'clean pierce trail'],
    motionKeywords: ['precision trajectory', 'no spread', 'burst on crit', 'instant hit'],
    effectNote: 'silver arrow pierce + star burst on crit, clean and precise, special burst on aim point',
  },
  {
    name: 'Hermes',
    nameZh: 'Hermes (speed god)',
    mappedClasses: ['ninja', 'assassin'],
    primary:    c('#44cc44'),   //
    secondary:  c('#aaffaa'),   //
    void:       c('#001100'),
    bloomMult:  1.2,
    shapeKeywords: ['speed afterimage line', 'motion blur streak', 'fast dash ghost', 'quick step trail'],
    motionKeywords: ['blur trail', 'afterimage', 'no contact impact', 'pure speed'],
    effectNote: 'high-speed afterimage + green speed lines, conveys speed not damage',
  },
  {
    name: 'Demeter',
    nameZh: 'Demeter (winter goddess)',
    mappedClasses: ['mage', 'alchemist'],
    primary:    c('#88ddff'),   //
    secondary:  c('#ffffff'),   //
    void:       c('#000d1a'),   //
    bloomMult:  1.4,
    shapeKeywords: ['ice crystal fragment', 'frost ring spread', 'snowflake burst', 'blizzard shard'],
    motionKeywords: ['slow freeze', 'expanding ring', 'crystallize on contact', 'cold snap'],
    effectNote: 'hexagonal ice crystal fragments + frost spread ring, freeze pause feel, leaves frost on enemies',
  },
  {
    name: 'Dionysus',
    nameZh: 'Dionysus (wine god)',
    mappedClasses: ['bard', 'summoner'],
    primary:    c('#cc44cc'),   //
    secondary:  c('#ff88ff'),   //
    void:       c('#1a0020'),   //
    bloomMult:  1.5,
    shapeKeywords: ['grape cluster burst', 'poison mist splash', 'festive sparkle', 'purple puddle splat'],
    motionKeywords: ['drunk wobble', 'lingering debuff cloud', 'slow spread', 'sticky impact'],
    effectNote: 'wine splash + lingering poison fog ring, longest-lasting effect, the only slow-spread style',
  },
  {
    name: 'Hephaestus',
    nameZh: 'Hephaestus (forge god)',
    mappedClasses: ['mechanic', 'alchemist'],
    primary:    c('#ff8800'),   //
    secondary:  c('#ffff44'),   //
    void:       c('#1a0800'),   //
    bloomMult:  1.8,
    shapeKeywords: ['forge spark burst', 'anvil impact ring', 'lava shard explosion', 'hammer shockwave'],
    motionKeywords: ['delayed explosion', 'heavy thud', 'ground shake', 'burst after delay'],
    effectNote: 'forge sparks + delayed blast shockwave, signature: brief delay before explosion on contact',
  },
]

// ───  ─────────────────────────────────────────────────────────────

/**  */
export function getGodStyleForClass(className: string): GodStyleEntry | undefined {
  return HADES_GOD_STYLES.find(g => g.mappedClasses.includes(className))
}

/**  AI （ ， ）*/
export function getAllHadesKeywords(): string[] {
  const kws = new Set<string>()
  for (const g of HADES_GOD_STYLES) {
    g.shapeKeywords.forEach(k => kws.add(k))
    g.motionKeywords.forEach(k => kws.add(k))
  }
  return [...kws]
}

// ───  ──────────────────────────────────────────────────────

/**
 * 
 * 
 */
export const HADES_BASE_PARAMS = {
  /** （ ）——  RPG  40% */
  particleLifetime: { min: 0.15, max: 0.55 },
  /**  ——  */
  particleSpeedMult: 2.2,
  /** bloom  */
  bloomBase: 1.6,
  /** （  0~1，  1 = HDR） */
  peakBrightness: 2.5,
  /** ：ambient  #222 */
  maxAmbientHex: '#222222',
  /**  ——  */
  minSaturation: 1.4,
  /** 「 」 ，  */
  requireGeometricSilhouette: true,
} as const

// ─── （  AI  Shader ）────────────────────────────────────

/**
 * ：
 *  AI Prompt  VFX 
 *
 * ┌──────────────────┬────────────────────────────────────────────────┐
 * │               │                                            │
 * ├──────────────────┼────────────────────────────────────────────────┤
 * │ shard            │ （ ， ）              │
 * │ inkblob          │ （ ）                      │
 * │ arc_slash        │ （ ）                    │
 * │ ring_pulse       │ （ ）                  │
 * │ afterimage       │ （ ）                      │
 * │ crystal_burst    │ （ / ）                         │
 * │ void_tear        │ （ ）                              │
 * │ divine_pillar    │ （ / ）                           │
 * │ chain_arc        │ （ ）                              │
 * │ ember_drift      │ （ / ）                       │
 * └──────────────────┴────────────────────────────────────────────────┘
 */
export type HadesShapeVocab =
  | 'shard'
  | 'inkblob'
  | 'arc_slash'
  | 'ring_pulse'
  | 'afterimage'
  | 'crystal_burst'
  | 'void_tear'
  | 'divine_pillar'
  | 'chain_arc'
  | 'ember_drift'

// ───  AI Prompt ─────────────────────────────────────────────

/**
 *  AI VFX  Prompt
 *  buildAIStylePrompt() 
 */
export function buildHadesStylePrompt(className: string): string {
  const god = getGodStyleForClass(className)
  const base = [
    '=== Hades Art Style Reference ===',
    'Shape: angular shards + ink splash blobs (NOT soft round puffs)',
    'Color: highly saturated, single dominant hue per class, dark void background',
    'Bloom: extreme, color-tinted (not white), visible from across the room',
    'Timing: fast burst 0.05~0.1s peak, quick dissipate 0.2~0.4s, NO lingering fog',
    'Readability: silhouette must be visible against pure black background',
  ]
  if (god) {
    base.push(
      `=== ${god.name} (${god.nameZh}) ===`,
      `Primary: #${god.primary.getHexString()}, Secondary: #${god.secondary.getHexString()}`,
      `Shape: ${god.shapeKeywords.join(', ')}`,
      `Motion: ${god.motionKeywords.join(', ')}`,
      `Note: ${god.effectNote}`,
    )
  }
  return base.join('\n')
}
