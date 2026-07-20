// @source wb-character/src/vfx/trailmaster/TrailMasterPresets.ts
/**
 * TrailMasterPresets — （  UE ）
 *
 * arc ：radius 0.85~0.92（ ），width 0.24~0.32，height 0.72~0.82
 *
 * TRAIL_FRAG （UE MM_Trail_01 ）：
 *   emissive = pow(EmissiveTex.R, EmissivePower) × EmissiveStrength
 *   color    = lerp(ColorA, ColorB, emissive) × ParticleColor
 *   opacity  = CavityTex.R × emissive × ParticleAlpha
 */

import type { TrailPreset } from './TrailMasterEffect'

const NOISE_NORMAL = 'T_Normal_Noise_001.png'  // （ ）

// ════════════════════════════════════════════════════════════════════════
//  （MI_Trail_001）
//  ：CavityTex=T_Trail_001, EmissiveTex=T_Noise_007, Noise=T_Normal_Noise_001
//  ColorA= , ColorB=   EmissiveStrength≈1.0  EmissivePower=0.5
//  → →  + T_Trail_001 （ ）
// ════════════════════════════════════════════════════════════════════════
export const MI_TRAIL_001_FIRE: TrailPreset = {
  name:       'MI_Trail_001 · Flame Slash',
  effectType: 'trail',

  cavityTex:   'T_Trail_001.png',   // OpacityTexture（ ）
  noiseTex:    NOISE_NORMAL,
  emissiveTex: 'T_Noise_007.png',   // →

  colorA: 0xff4400,   // （ ）
  colorB: 0xffcc00,   // （ ）

  noiseTileU:  1.0,
  noiseTileV:  1.0,
  noiseSpeedU: 0.0,
  noiseSpeedV: 0.0,
  noiseStrength: 0.8,

  emissiveTileU:    1.5,
  emissiveTileV:    1.0,
  emissiveSpeedU:   0.3,   //
  emissiveSpeedV:   0.05,
  emissiveStrength: 1.2,
  emissivePower:    0.5,   // sqrt →
  emissiveNoiseStr: 0.1,

  cavityStrength: 1.8,     // OpacityStrength
  cavityMouths:   1.2,     // OpacityPower
  opacityNoiseStr: 0.1,
  opacityStrength: 1.0,
  opacityPower:    1.0,

  particleColor: 0xffffff,
  particleCount: 16,

  swingDuration: 0.28,
  duration:      1.15,

  arc: {
    angleStart:  -Math.PI * 0.80,
    angleEnd:     Math.PI * 0.22,
    radius:       0.88,
    width:        0.28,
    heightOffset: 0.78,
  },
}

// ════════════════════════════════════════════════════════════════════════
//  （MI_Trail_002）
//  CavityTex=T_Trail_003（ ）, EmissiveTex=T_Noise_015
//  ColorA= , ColorB=    → → ，
// ════════════════════════════════════════════════════════════════════════
export const MI_TRAIL_002_ICE: TrailPreset = {
  name:       'MI_Trail_002 · Ice Slash',
  effectType: 'trail',

  cavityTex:   'T_Trail_003.png',
  noiseTex:    NOISE_NORMAL,
  emissiveTex: 'T_Noise_015.png',

  colorA: 0x7733ff,   // （ ）
  colorB: 0x2255aa,   // （ ， ）

  noiseTileU:  1.2,
  noiseTileV:  1.2,
  noiseSpeedU: 0.0,
  noiseSpeedV: 0.0,
  noiseStrength: 0.6,

  emissiveTileU:    1.0,
  emissiveTileV:    1.2,
  emissiveSpeedU:   0.08,
  emissiveSpeedV:   0.12,
  emissiveStrength: 0.35,  // ：  bloom
  emissivePower:    0.9,
  emissiveNoiseStr: 0.04,

  cavityStrength: 0.6,    //  1.1 → 0.6
  cavityMouths:   0.7,
  opacityNoiseStr: 0.05,
  opacityStrength: 0.6,   //  0.85 → 0.6
  opacityPower:    1.2,

  particleColor: 0x2244aa,  // ，
  particleCount: 8,         //

  swingDuration: 0.32,
  duration:      1.3,

  arc: {
    angleStart:  -Math.PI * 0.78,
    angleEnd:     Math.PI * 0.20,
    radius:       0.86,
    width:        0.25,
    heightOffset: 0.75,
  },
}

// ════════════════════════════════════════════════════════════════════════
//  （MI_Trail_004）——
//  EmissiveNoiseStr=0.1  EmissivePower=0.5  EmissiveSpeedU=0.1  EmissiveStrength=2.0
//  EmissiveTileU/V=0.3   NoiseTileU/V=0.1   NoiseSpeedV=0.4
//  Emissive=T_Noise_009(≈T_Noise_008)  Noise=T_Normal_Noise_001
//  OpacityTex=T_Thunder_001（ ）  ColorA=   ColorB=
// ════════════════════════════════════════════════════════════════════════
export const MI_TRAIL_004_LIGHTNING: TrailPreset = {
  name:       'MI_Trail_004 · Thunder Slash',
  effectType: 'lightning',

  cavityTex:   'T_Thunder_001.png',   // （4 ）
  noiseTex:    NOISE_NORMAL,
  emissiveTex: 'T_Noise_008.png',     // （≈T_Noise_009） →

  colorA: 0xff7300,   // （  FF7300 sRGB）
  colorB: 0x00ffff,   //    （  00FFFF sRGB）

  // （ ：Tile=0.1 ，SpeedV=0.4 ）
  noiseTileU:  0.1,   //
  noiseTileV:  0.1,
  noiseSpeedU: 0.0,
  noiseSpeedV: 0.4,   //  ——
  noiseStrength: 0.1,  //

  // Emissive（ ：Tile=0.3 ，SpeedU=0.1）
  emissiveTileU:    0.3,   //
  emissiveTileV:    0.3,
  emissiveSpeedU:   0.1,   //
  emissiveSpeedV:   0.0,
  emissiveStrength: 2.0,   //
  emissivePower:    0.5,   //
  emissiveNoiseStr: 0.1,   //

  // Opacity（ ： 1.0，NoiseStr=0.1）
  cavityStrength:  1.0,   // OpacityStrength=1.0
  cavityMouths:    1.0,   // OpacityPower=1.0
  opacityNoiseStr: 0.1,   // OpacityNoiseStrength=0.1
  opacityStrength: 1.0,
  opacityPower:    1.0,

  particleColor: 0xffffff,
  particleCount: 20,

  swingDuration: 0.22,    //
  duration:      1.1,

  arc: {
    angleStart:  -Math.PI * 0.82,
    angleEnd:     Math.PI * 0.25,
    radius:       0.90,
    width:        0.26,
    heightOffset: 0.80,
  },
}

// ════════════════════════════════════════════════════════════════════════
//  （MI_Blood_001）——
//  EmissiveNoiseStr=0.1  EmissivePower=1.0  EmissiveStrength=0.5
//  NoiseSpeedV=0.5  OpacityPower=0.5  OpacityStrength=2.0
//  EmissiveTex=T_Blood_0001  NoiseTex=T_Normal_Noise_001  OpacityTex=T_Blood_0001
//  ColorA/B=white（ RGB ）
// ════════════════════════════════════════════════════════════════════════
export const MI_BLOOD_001: TrailPreset = {
  name:       'MI_Blood_001 · Blood Slash',
  effectType: 'blood',

  cavityTex:   'T_Blood_0001.png',       // OpacityTexture
  noiseTex:    NOISE_NORMAL,
  emissiveTex: 'T_Blood_0001.png',       // EmissiveTexture（ RGB）

  colorA: 0xffffff,   // white（ ）
  colorB: 0xffffff,

  noiseTileU:  1.0,
  noiseTileV:  1.0,
  noiseSpeedU: 0.0,
  noiseSpeedV: 0.5,    // ：
  noiseStrength: 1.0,

  emissiveTileU:    1.0,
  emissiveTileV:    1.0,
  emissiveSpeedU:   0.0,
  emissiveSpeedV:   0.0,
  emissiveStrength: 0.5,   //
  emissivePower:    1.0,   //
  emissiveNoiseStr: 0.1,   //

  cavityStrength:  2.0,   // OpacityStrength=2.0
  cavityMouths:    0.5,   // OpacityPower=0.5（ ）
  opacityNoiseStr: 0.1,   //
  opacityStrength: 1.0,
  opacityPower:    1.0,

  particleColor: 0xdd0000,
  particleCount: 28,

  swingDuration: 0.28,
  duration:      1.6,

  arc: {
    angleStart:  -Math.PI * 0.72,
    angleEnd:     Math.PI * 0.18,
    radius:       0.88,
    width:        0.32,
    heightOffset: 0.72,
  },
}

// ════════════════════════════════════════════════════════════════════════
//  （MI_Smoke_001）
//  ： ， ，T_Smoke
//   EmissiveStrength，  cavityMouths（ ）
// ════════════════════════════════════════════════════════════════════════
export const MI_SMOKE_001: TrailPreset = {
  name:       'MI_Smoke_001 · Smoke Trail',
  effectType: 'trail',

  cavityTex:   'T_Smoke_001.png',   // （ ）
  noiseTex:    'T_Noise_005.png',   //
  emissiveTex: 'T_Smoke_002.png',   //

  colorA: 0x555566,   // （ ）
  colorB: 0xccccdd,   // （ ）

  noiseTileU:  0.8,
  noiseTileV:  0.8,
  noiseSpeedU: 0.05,
  noiseSpeedV: 0.08,   //
  noiseStrength: 0.5,

  emissiveTileU:    0.7,
  emissiveTileV:    0.7,
  emissiveSpeedU:   0.03,
  emissiveSpeedV:   0.06,
  emissiveStrength: 0.55,   // （ ）
  emissivePower:    1.2,
  emissiveNoiseStr: 0.08,

  cavityStrength:  0.8,   // OpacityStrength （ ）
  cavityMouths:    0.5,   // OpacityPower （ ）
  opacityNoiseStr: 0.12,
  opacityStrength: 0.7,   //
  opacityPower:    0.8,

  particleColor: 0xaaaaaa,
  particleCount: 10,

  swingDuration: 0.38,    //
  duration:      1.8,     //

  arc: {
    angleStart:  -Math.PI * 0.70,
    angleEnd:     Math.PI * 0.18,
    radius:       0.86,
    width:        0.30,
    heightOffset: 0.74,
    taperRatio:   0.4,   // （ ）
  },
}

// ──  ──────────────────────────────────────────────────────

export const TRAIL_PRESETS: Record<string, TrailPreset> = {
  fire:      MI_TRAIL_001_FIRE,
  ice:       MI_TRAIL_002_ICE,
  lightning: MI_TRAIL_004_LIGHTNING,
  blood:     MI_BLOOD_001,
  smoke:     MI_SMOKE_001,
}

export const TRAIL_PRESET_KEYS = Object.keys(TRAIL_PRESETS) as (keyof typeof TRAIL_PRESETS)[]

export const TRAIL_PRESET_LABELS: Record<string, string> = {
  fire:      '🔥 MI_Trail_001 · Flame Slash',
  ice:       '❄ MI_Trail_002 · Ice Slash',
  lightning: '⚡ MI_Trail_004 · Thunder Slash',
  blood:     '🩸 MI_Blood_001 · Blood Slash',
  smoke:     '💨 MI_Smoke_001 · Smoke Trail',
}
