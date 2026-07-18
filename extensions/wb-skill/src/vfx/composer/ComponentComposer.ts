// @source wb-character/src/vfx/composer/ComponentComposer.ts
/**
 * VFX （Component Composer）
 *
 *  VFX （ComponentConfig）
 *  ITemplate ，  update / dispose。
 *
 * ：
 *    delay（ ）、duration（ ） / 。
 *   Composer  scale / duration / intensity 。
 *   ，Composer 。
 *
 * AI ：
 *   {
 *     "mode": "compose",
 *     "label": " ",
 *     "components": {
 *       "GroundRing":  { "delay": 0.0, "color1": [0.3,1.0,0.5], "scale": 1.2 },
 *       "GroundCrack": { "delay": 0.15, "count": 10, "color1": [0.2,0.8,0.4] },
 *       "ScatterPart": { "delay": 0.08, "count": 24, "variant": "star", "color1": [0.3,1.0,0.5] }
 *     }
 *   }
 */

import * as THREE from 'three'
import type { ITemplate } from '../templates/VFXTemplates'
import {
  buildGroundRing,
  buildGroundCrack,
  buildScatterPart,
  buildVerticalPillar,
  buildImpactFlash,
  buildGroundGlow,
  buildContactSpark,
  buildImpactStreak,
  buildSlashMark,
  type ComponentConfig,
  type ComponentResult,
} from './VFXComponents'

// ──  ──────────────────────────────────────────────────────────────────

export interface ComponentInstanceConfig extends ComponentConfig {
  /** （default 0） */
  delay?: number
  /** （default 1.0），  baseDur  */
  duration?: number
}

export interface ComposeConfig {
  components: Record<string, ComponentInstanceConfig>
  /**
   * （  XZ ， ）。
   * [1,0] = , [-1,0] = , [0.7,-0.7] = 
   *  ImpactStreak 、ContactSpark 。
   * AI （" " → [1,0]）。
   *  [1,0]。
   */
  attackDir?: [number, number]
}

export interface ComposeOptions {
  /**
   *  ImpactFlash  delay （ ） 。
   *  GameFeelSystem.triggerImpact()。
   *  config  ImpactFlash，  elapsed=0 。
   */
  onImpact?: () => void
}

// ── ：  →  ─────────────────────────────────────────────────

type BuildFn = (
  scene:  THREE.Scene,
  pos:    THREE.Vector3,
  cfg:    ComponentConfig,
) => ComponentResult

const BUILDERS: Record<string, BuildFn> = {
  GroundRing:     buildGroundRing,
  GroundCrack:    buildGroundCrack,
  ScatterPart:    buildScatterPart,
  VerticalPillar: buildVerticalPillar,
  ImpactFlash:    buildImpactFlash,
  GroundGlow:     buildGroundGlow,
  ContactSpark:   buildContactSpark,
  ImpactStreak:   buildImpactStreak,
  SlashMark:      buildSlashMark,
}

// ──  ────────────────────────────────────────────────────────────────────

/**
 *  ComposeConfig  ITemplate。
 *
 * @param globalScale    （  scale ）
 * @param globalDuration （ ）
 * @param globalIntensity 
 */
export function composeEffect(
  scene:           THREE.Scene,
  pos:             THREE.Vector3,
  config:          ComposeConfig,
  globalScale      = 1.0,
  globalDuration   = 1.0,
  globalIntensity  = 1.0,
  options?:        ComposeOptions,
): ITemplate {
  interface BuiltEntry {
    name:    string
    delay:   number
    durMult: number
    result:  ComponentResult
  }

  const built: BuiltEntry[] = []

  // attackDir ， ：ComposeConfig >  >
  const globalAttackDir = config.attackDir ?? [1, 0] as [number, number]

  // ：  AI  SlashMark，
  // ：compose config  SlashMark
  const components = { ...config.components }
  if (!components['SlashMark']) {
    console.info('[VFX Composer] auto-injecting SlashMark (absent from AI output)')
    //  color1 ，
    const refComp = Object.values(components).find(c => c.color1)
    components['SlashMark'] = {
      delay:     0,
      color1:    refComp?.color1 ?? [1.0, 0.92, 0.75],
      color2:    refComp?.color2 ?? [0.8, 0.45, 0.05],
      offsetY:   (components['ContactSpark']?.offsetY as number | undefined) ?? (pos.y + 1.0),
      scale:     1.0,
      intensity: 1.0,
    }
  }

  for (const [name, instCfg] of Object.entries(components)) {
    const builder = BUILDERS[name]
    if (!builder) {
      console.warn(`[VFX Composer] : ${name}， `)
      continue
    }
    const result = builder(scene, pos, {
      ...instCfg,
      scale:     (instCfg.scale     ?? 1) * globalScale,
      intensity: (instCfg.intensity ?? 1) * globalIntensity,
      //  attackDir ，
      attackDir: instCfg.attackDir ?? globalAttackDir,
    })
    built.push({
      name,
      delay:   instCfg.delay    ?? 0,
      durMult: instCfg.duration ?? 1.0,
      result,
    })
  }

  //  =  + 0.4s
  const maxDur = (built.length > 0
    ? Math.max(...built.map(b => b.delay + b.result.baseDur * b.durMult * globalDuration))
    : 0) + 0.4

  //  ImpactFlash （  SlashMark/ImpactStreak ）
  const impactEntry = built.find(b => b.name === 'ImpactFlash')
  const impactDelay = impactEntry?.delay ?? 0

  // （ / ）  impact  SCREEN_OFFSET ：
  //   - T=0.00 : SlashMark/ImpactStreak/ContactSpark （ ）
  //   - T=0.06 : （  3-4 ， ）
  // Hades ：  →
  const SCREEN_OFFSET = 0.06
  const screenFeedbackAt = impactDelay + SCREEN_OFFSET
  let   impactFired = false

  let elapsed = 0
  let alive   = true

  return {
    update(dt: number, camera?: THREE.Camera) {
      const prev = elapsed
      elapsed += dt

      // ：  screenFeedbackAt
      if (!impactFired && options?.onImpact) {
        if (prev < screenFeedbackAt && elapsed >= screenFeedbackAt) {
          impactFired = true
          options.onImpact()
        }
      }

      for (const b of built) {
        const lt = (elapsed - b.delay) / (b.durMult * globalDuration)
        if (lt > 0) b.result.update(lt, camera)
      }
      if (elapsed > maxDur) alive = false
    },

    isAlive() { return alive },

    dispose() {
      for (const b of built) {
        b.result.meshes.forEach(m => { scene.remove(m); m.geometry.dispose() })
        b.result.mats.forEach(m => m.dispose())
      }
    },
  }
}

/** （  AI prompt ） */
export const COMPONENT_NAMES = Object.keys(BUILDERS) as (keyof typeof BUILDERS)[]
