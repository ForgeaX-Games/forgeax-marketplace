// @source wb-character/src/vfx/style/VFXColorResolver.ts
/**
 * VFXColorResolver — 
 *
 * ：worldSetting + charClass → 
 * ：lerp( , , classTint)
 *
 *  VFX ， 。
 */

import * as THREE from 'three'
import { getWorldStyle, GLOW_INTENSITY, type WorldStyleEntry } from './WorldStylePalette'
import { getClassAffinity, ELEMENT_COLORS, type ClassAffinityEntry } from './ClassElementAffinity'

// ───  ────────────────────────────────────────────────────────────────

export interface VFXColorPack {
  /** （ ） */
  primary: THREE.Color
  /** （ / ） */
  secondary: THREE.Color
  /**  */
  fade: THREE.Color
  /**  */
  ambientTint: THREE.Color
  /** bloom  */
  bloomIntensity: number
  /**  */
  saturation: number
  /**  */
  brightness: number
  /**  */
  particleSpeed: number
  /**  */
  effectScale: number
  /** AI prompt  */
  aiPromptHints: string[]
  /**  */
  _meta: {
    worldId: string
    className: string
    worldStyle: WorldStyleEntry['particleStyle']
    primaryElement: string
  }
}

// ───  ────────────────────────────────────────────────────────────────

function lerpColor(a: THREE.Color, b: THREE.Color, t: number): THREE.Color {
  return new THREE.Color(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
  )
}

// ───  ──────────────────────────────────────────────────────────────

/**
 *  ID 
 *
 * @param worldId   — GlobalState.profile.worldSetting
 * @param className — GlobalState.profile.charClass
 */
export function resolveVFXColors(worldId: string, className: string): VFXColorPack {
  const world = getWorldStyle(worldId)
  const cls   = getClassAffinity(className)
  const elem  = ELEMENT_COLORS[cls.primaryElement]
  const elemSec = ELEMENT_COLORS[cls.secondaryElement]

  const t = cls.classTint

  // ：  ↔
  const primary = lerpColor(world.primaryColor, elem.main, t)
  // ：  ↔
  const secondary = lerpColor(world.secondaryColor, elemSec.main, t * 0.7)
  // ：  fade （ ）
  const fade = lerpColor(world.ambientTint, elem.fade, 0.6)

  const bloomIntensity = GLOW_INTENSITY[world.glowLevel]

  return {
    primary,
    secondary,
    fade,
    ambientTint: world.ambientTint.clone(),
    bloomIntensity,
    saturation:    world.saturation,
    brightness:    world.brightness,
    particleSpeed: world.particleSpeed,
    effectScale:   cls.effectScale,
    aiPromptHints: [...world.styleHints, ...cls.classHints],
    _meta: {
      worldId,
      className,
      worldStyle: world.particleStyle,
      primaryElement: cls.primaryElement,
    },
  }
}

/**
 *  CSS hex （ /UI ）
 */
export function colorPackToHex(pack: VFXColorPack): {
  primary: string
  secondary: string
  fade: string
} {
  return {
    primary:   '#' + pack.primary.getHexString(),
    secondary: '#' + pack.secondary.getHexString(),
    fade:      '#' + pack.fade.getHexString(),
  }
}

/**
 *  AI  prompt 
 *  AIVFXGenerator  systemPrompt
 */
export function buildAIStylePrompt(pack: VFXColorPack): string {
  const hex = colorPackToHex(pack)
  return [
    `World Setting: ${pack._meta.worldId}`,
    `Character Class: ${pack._meta.className}`,
    `Primary Element: ${pack._meta.primaryElement}`,
    `Effect Palette: primary=${hex.primary}, secondary=${hex.secondary}, fade=${hex.fade}`,
    `Glow Intensity: ${(pack.bloomIntensity * 100).toFixed(0)}%`,
    `Particle Style: ${pack._meta.worldStyle}`,
    `Style Keywords: ${pack.aiPromptHints.join(', ')}`,
  ].join('\n')
}

// ───  ────────────────────────────────────────────────────────────

/**
 * （ ）
 */
export function getPrimaryColor(worldId: string, className: string): THREE.Color {
  return resolveVFXColors(worldId, className).primary
}

/**
 *  VFXColorPack  Three.js 
 */
export function applyColorPackToMaterial(
  mat: THREE.MeshStandardMaterial,
  pack: VFXColorPack,
): void {
  mat.color.copy(pack.primary)
  mat.emissive.copy(pack.secondary)
  mat.emissiveIntensity = pack.bloomIntensity * 0.5
}
