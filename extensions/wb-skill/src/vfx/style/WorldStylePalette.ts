// @source wb-character/src/vfx/style/WorldStylePalette.ts
/**
 * WorldStylePalette — 
 *
 * ： 、 、 、 、
 * （ 、 ） ，  VFXColorResolver 。
 *  VFX ， 。
 */

import * as THREE from 'three'

export type ParticleStyle =
  | 'sparkle'      // 、 （ ）
  | 'ash'          // 、 （ ）
  | 'petal'        // 、 （ ）
  | 'hex'          // 、 （ ）
  | 'energy'       // 、 （ ）
  | 'dust'         // 、 （ ）
  | 'gear'         // 、 （ ）
  | 'glass'        // 、 （ ）
  | 'wave'         // 、 （ ）
  | 'feather'      // 、 （ ）
  // ──  ──────────────────────────────────────────────────────
  | 'shard'        // ★ （ ， ）
  | 'inkblob'      // ★ （ / ）

export type GlowLevel = 'none' | 'low' | 'medium' | 'high' | 'extreme'

export interface WorldStyleEntry {
  /**  ID，  GlobalState.worldSetting  */
  id: string
  /** （  AI prompt ） */
  en: string
  /**  */
  primaryColor: THREE.Color
  /**  */
  secondaryColor: THREE.Color
  /** （ ） */
  ambientTint: THREE.Color
  /**  */
  particleStyle: ParticleStyle
  /**  */
  glowLevel: GlowLevel
  /** （0= ，1= ，>1= ） */
  saturation: number
  /** （-1 ~ +1， = ， = ） */
  brightness: number
  /** （ ） */
  particleSpeed: number
  /** AI prompt  */
  styleHints: string[]
}

function hex(h: string): THREE.Color {
  return new THREE.Color(h)
}

export const WORLD_STYLE_PALETTE: ReadonlyArray<WorldStyleEntry> = [
  {
    id: 'medieval-fantasy',
    en: 'Medieval Fantasy',
    primaryColor:    hex('#c8a840'),
    secondaryColor:  hex('#4a90e2'),
    ambientTint:     hex('#f5e8c0'),
    particleStyle:   'sparkle',
    glowLevel:       'medium',
    saturation:      1.1,
    brightness:      0.05,
    particleSpeed:   1.0,
    styleHints:      ['golden light', 'arcane sparkle', 'magical aura', 'classic RPG'],
  },
  {
    id: 'dark-fantasy',
    en: 'Dark Fantasy',
    primaryColor:    hex('#8b1a1a'),
    secondaryColor:  hex('#4a0080'),
    ambientTint:     hex('#1a0a0a'),
    particleStyle:   'ash',
    glowLevel:       'low',
    saturation:      0.75,
    brightness:      -0.15,
    particleSpeed:   0.7,
    styleHints:      ['gothic', 'blood red', 'dark souls style', 'bone fragments', 'unholy'],
  },
  {
    id: 'eastern-fantasy',
    en: 'Eastern Wuxia/Xianxia',
    primaryColor:    hex('#e8f4f8'),
    secondaryColor:  hex('#c05050'),
    ambientTint:     hex('#f0e8d8'),
    particleStyle:   'petal',
    glowLevel:       'medium',
    saturation:      0.9,
    brightness:      0.1,
    particleSpeed:   0.8,
    styleHints:      ['ink wash', 'cherry blossom', 'chi energy', 'eastern mysticism', 'flowing robes'],
  },
  {
    id: 'cyberpunk',
    en: 'Cyberpunk',
    primaryColor:    hex('#00ffff'),
    secondaryColor:  hex('#ff0080'),
    ambientTint:     hex('#0a0a1a'),
    particleStyle:   'hex',
    glowLevel:       'extreme',
    saturation:      1.8,
    brightness:      0.2,
    particleSpeed:   1.5,
    styleHints:      ['neon glow', 'data stream', 'glitch', 'holographic', 'circuit board'],
  },
  {
    id: 'sci-fi',
    en: 'Sci-Fi Future',
    primaryColor:    hex('#0088ff'),
    secondaryColor:  hex('#00ff88'),
    ambientTint:     hex('#050510'),
    particleStyle:   'energy',
    glowLevel:       'high',
    saturation:      1.3,
    brightness:      0.15,
    particleSpeed:   1.3,
    styleHints:      ['plasma energy', 'clean sci-fi', 'tech grid', 'hard light', 'energy beam'],
  },
  {
    id: 'post-apocalypse',
    en: 'Post-Apocalypse Wasteland',
    primaryColor:    hex('#8b7355'),
    secondaryColor:  hex('#ff4400'),
    ambientTint:     hex('#3a2a10'),
    particleStyle:   'dust',
    glowLevel:       'low',
    saturation:      0.6,
    brightness:      -0.1,
    particleSpeed:   0.9,
    styleHints:      ['rust and ash', 'smoke cloud', 'fire debris', 'gritty realism', 'burnt orange'],
  },
  {
    id: 'steampunk',
    en: 'Steampunk',
    primaryColor:    hex('#b87333'),
    secondaryColor:  hex('#ffd700'),
    ambientTint:     hex('#2a1a08'),
    particleStyle:   'gear',
    glowLevel:       'medium',
    saturation:      1.0,
    brightness:      0.0,
    particleSpeed:   0.85,
    styleHints:      ['brass gears', 'steam cloud', 'clockwork', 'Victorian era', 'copper pipe'],
  },
  {
    id: 'modern-urban',
    en: 'Modern Urban',
    primaryColor:    hex('#e0e0e0'),
    secondaryColor:  hex('#404040'),
    ambientTint:     hex('#101010'),
    particleStyle:   'glass',
    glowLevel:       'none',
    saturation:      0.5,
    brightness:      -0.05,
    particleSpeed:   1.2,
    styleHints:      ['realistic', 'muzzle flash', 'concrete dust', 'shattered glass', 'blood splatter'],
  },
  {
    id: 'pirate-sea',
    en: 'Pirate Sea Adventure',
    primaryColor:    hex('#006994'),
    secondaryColor:  hex('#daa520'),
    ambientTint:     hex('#0a1a2a'),
    particleStyle:   'wave',
    glowLevel:       'medium',
    saturation:      1.1,
    brightness:      0.05,
    particleSpeed:   1.0,
    styleHints:      ['ocean spray', 'sea foam', 'lightning bolt', 'cannon smoke', 'salt wind'],
  },
  {
    //  → 《 》
    // ： 、 、
    id: 'mythic-epic',
    en: 'Mythic Epic',
    primaryColor:    hex('#ffd700'),
    secondaryColor:  hex('#ffffff'),
    ambientTint:     hex('#140e00'),    // ，
    particleStyle:   'shard',          // ★ ：
    glowLevel:       'extreme',
    saturation:      1.7,              // ，
    brightness:      0.25,
    particleSpeed:   1.3,              //
    styleHints: [
      //
      'divine shard burst', 'olympian gold', 'angular light fragment',
      'god boon flash', 'saturated mythic', 'Hades game style',
      'high contrast dark bg', 'short burst lifetime', 'bloom tinted gold',
    ],
  },
  {
    // ★  — /
    // ： 、 、
    // 《 》
    id: 'greek-underworld',
    en: 'Greek Underworld (Hades Style)',
    primaryColor:    hex('#cc1111'),   // （ ）
    secondaryColor:  hex('#ff4422'),   //
    ambientTint:     hex('#0d0014'),   // ★ （ ）
    particleStyle:   'shard',          // ★
    glowLevel:       'extreme',
    saturation:      1.9,              // ★ ，
    brightness:      0.1,              // （ ）
    particleSpeed:   1.8,              // ★
    styleHints: [
      //
      'Hades game art style', 'Supergiant Games VFX',
      'angular shard particle', 'inkblob impact core',
      'crimson void background', 'extreme saturated color',
      'god boon color identity', 'fast burst short lifetime',
      'dark bg high contrast', 'no lingering fog or smoke',
      'geometric silhouette readable on black',
      //
      'blood red slash arc', 'teal water column burst',
      'gold lightning fork', 'divine shield deflect flash',
      'purple poison mist splash', 'forge ember burst',
    ],
  },
]

/**  worldSetting ID ，  */
export function getWorldStyle(worldId: string): WorldStyleEntry {
  return (
    WORLD_STYLE_PALETTE.find(w => w.id === worldId) ??
    WORLD_STYLE_PALETTE.find(w => w.id === 'medieval-fantasy')!
  )
}

/** ：GlowLevel → bloom intensity （ ） */
export const GLOW_INTENSITY: Record<GlowLevel, number> = {
  none:    0.0,
  low:     0.3,
  medium:  0.65,
  high:    1.0,
  extreme: 1.8,
}
