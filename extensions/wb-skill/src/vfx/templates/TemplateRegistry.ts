// @source wb-character/src/vfx/templates/TemplateRegistry.ts
/**
 * VFX （character-editor ）
 *
 *  vfx-composer-test ：
 *   - generateFromDescription  /__ce-api__/gemini-text ，  API Key
 *   - spawnTemplate  THREE.Scene / THREE.Vector3
 */

import * as THREE from 'three'
import {
  FireImpact, ArcaneStrike, FrostSlam, LightningStrike, MeleeSlash, PoisonCloud,
  HealingCircle, WindSlash, EarthShatter, ShadowVoid,
} from './VFXTemplates'
import type { TemplateParams, ITemplate } from './VFXTemplates'

export type { TemplateParams, ITemplate }

// ──  ─────────────────────────────────────────────────────────────

export interface TemplateMeta {
  id:          string
  label:       string
  emoji:       string
  bestFor:     string
  defaultParams: TemplateParams
}

export const TEMPLATE_REGISTRY: TemplateMeta[] = [
  {
    id: 'FireImpact', label: 'Fire Impact', emoji: '🔥',
    bestFor: 'fireball, explosion, meteor, bomb, burning attack, lava',
    defaultParams: { primaryColor:[1.0,0.35,0.0], secondaryColor:[0.7,0.05,0.0], scale:1.0, duration:1.0, intensity:1.0, crackCount:8, particleCount:24 },
  },
  {
    id: 'ArcaneStrike', label: 'Arcane Strike', emoji: '🔮',
    bestFor: 'magic attack, holy skill, arcane blast, lightning, light type',
    defaultParams: { primaryColor:[0.4,0.2,1.0], secondaryColor:[0.1,0.05,0.6], scale:1.0, duration:1.0, intensity:1.0, particleCount:32 },
  },
  {
    id: 'FrostSlam', label: 'Frost Slam', emoji: '❄',
    bestFor: 'ice attack, ground stomp, nature type, poison spread, petrify',
    defaultParams: { primaryColor:[0.5,0.85,1.0], secondaryColor:[0.05,0.2,0.7], scale:1.0, duration:1.0, intensity:1.0, crackCount:10, particleCount:28 },
  },
  {
    id: 'LightningStrike', label: 'Lightning Strike', emoji: '⚡',
    bestFor: 'lightning attack, divine punishment, chain lightning, overload, shock',
    defaultParams: { primaryColor:[0.8,0.92,1.0], secondaryColor:[0.25,0.4,1.0], scale:1.0, duration:0.8, intensity:1.4, particleCount:28 },
  },
  {
    id: 'MeleeSlash', label: 'Melee Slash', emoji: '⚔',
    bestFor: 'melee slash, wind blade, burst slash, blade aura, sword aura, physical burst',
    defaultParams: { primaryColor:[0.95,0.88,0.6], secondaryColor:[0.5,0.35,0.1], scale:1.0, duration:0.7, intensity:1.1, particleCount:20 },
  },
  {
    id: 'PoisonCloud', label: 'Poison Cloud', emoji: '☠',
    bestFor: 'poison attack, miasma, smoke, corrosion, dark spread, poison swamp',
    defaultParams: { primaryColor:[0.2,0.9,0.12], secondaryColor:[0.04,0.35,0.02], scale:1.0, duration:1.5, intensity:1.0, particleCount:24 },
  },
  {
    id: 'HealingCircle', label: 'Healing Circle', emoji: '💚',
    bestFor: 'heal, holy, revive, bless, light skill, restore, purify',
    defaultParams: { primaryColor:[0.3,1.0,0.45], secondaryColor:[0.05,0.55,0.15], scale:1.0, duration:1.2, intensity:1.0, particleCount:20 },
  },
  {
    id: 'WindSlash', label: 'Wind Slash', emoji: '🌪',
    bestFor: 'wind blade, qi-gong, wind slash, air knife, swift slash, speed dash, sword aura',
    defaultParams: { primaryColor:[0.7,0.95,1.0], secondaryColor:[0.15,0.55,0.75], scale:1.0, duration:0.8, intensity:1.2, particleCount:18 },
  },
  {
    id: 'EarthShatter', label: 'Earth Shatter', emoji: '🪨',
    bestFor: 'earth type, earthquake, rock, earth magic, heavy hit, stomp, landslide',
    defaultParams: { primaryColor:[0.75,0.45,0.1], secondaryColor:[0.35,0.18,0.03], scale:1.0, duration:1.2, intensity:1.0, crackCount:9, particleCount:22 },
  },
  {
    id: 'ShadowVoid', label: 'Shadow Void', emoji: '🌑',
    bestFor: 'shadow, void, abyss, death, dark magic, curse, dimensional rift',
    defaultParams: { primaryColor:[0.6,0.08,1.0], secondaryColor:[0.12,0.0,0.35], scale:1.0, duration:1.5, intensity:1.0, particleCount:20 },
  },
]

// ──  ─────────────────────────────────────────────────────────────

export function spawnTemplate(
  scene: THREE.Scene,
  templateId: string,
  params: TemplateParams,
  position = new THREE.Vector3(),
): ITemplate | null {
  switch (templateId) {
    case 'FireImpact':      return new FireImpact(scene, position, params)
    case 'ArcaneStrike':   return new ArcaneStrike(scene, position, params)
    case 'FrostSlam':      return new FrostSlam(scene, position, params)
    case 'LightningStrike':return new LightningStrike(scene, position, params)
    case 'MeleeSlash':     return new MeleeSlash(scene, position, params)
    case 'PoisonCloud':    return new PoisonCloud(scene, position, params)
    case 'HealingCircle':  return new HealingCircle(scene, position, params)
    case 'WindSlash':      return new WindSlash(scene, position, params)
    case 'EarthShatter':   return new EarthShatter(scene, position, params)
    case 'ShadowVoid':     return new ShadowVoid(scene, position, params)
    default: return null
  }
}

// ── AI （  character-editor ，  Key）────────────────

const TEMPLATE_AI_SCHEMA = `You are a game VFX director. Choose between TWO output modes based on the skill description.

━━ MODE A: Template (for standard skills matching one archetype) ━━
AVAILABLE TEMPLATES:
1. FireImpact — fire/energy explosion + shockwave + ground cracks + sparks
   Best for: fireball, explosion, meteor, bomb, burning, lava, inferno
2. ArcaneStrike — concentric energy rings + runic ground circle + magic burst
   Best for: magic, arcane, psychic, divine light, rune, energy pulse
3. FrostSlam — frost ground cracks + mist disc + ice crystal particles
   Best for: ice slam, freeze, cold, blizzard, crystal
4. LightningStrike — vertical jagged bolt + branching arc + electric ring + sparks
   Best for: lightning, thunder, chain lightning, electric shock, storm
5. MeleeSlash — diagonal slash arc + speed trail + shockwave + debris
   Best for: sword slash, physical strike, katana, axe, heavy melee
6. PoisonCloud — organic toxic puddle + puffy cloud + rising bubbles
   Best for: poison, toxic gas, miasma, plague, corrosion, acid
7. HealingCircle — rotating rune mandala + healing rings + light pillar + sparkles
   Best for: heal, restore, bless, revive, holy light, purify, regeneration
8. WindSlash — arc wind marks + curved slash billboard + fast streaks
   Best for: wind blade, air slash, gust, speed burst, cyclone
9. EarthShatter — wide rocky cracks + dust shockwave + rock debris cloud
   Best for: earth, rock, seismic, stomp, ground slam, boulder
10. ShadowVoid — swirling void portal + jagged shadow ring + dark smoke + shards
    Best for: shadow, void, abyss, death, dark magic, curse, dimension tear

TEMPLATE OUTPUT (JSON only):
{"template":"FireImpact","label":"Skill Name","params":{"primaryColor":[r,g,b],"secondaryColor":[r,g,b],"scale":1.0,"duration":1.0,"intensity":1.0}}

━━ MODE B: Compose (for novel/hybrid/cross-element skills) ━━
Use when the skill combines multiple ground-layer visuals OR mixes two elements (e.g. "holy fire crack", "ice pillar with stars", "shadow void ring").

AVAILABLE COMPONENTS:
  ImpactFlash    — instant white-hot center flash (0.25s)      → ALWAYS include, delay:0
  ImpactStreak   — directional radial streaks billboard (0.35s) → MUST include for melee/directional skills
                   Hades-style: 18 sharp lines radiating from impact, 65% concentrated in attackDir
                   Adds Z-depth (vertical billboard at body height) + breaks "all circles" monotony
                   CRITICAL: pair with attackDir in the top-level config
  GroundRing     — expanding shockwave ring on ground            → any explosive impact
  GroundCrack    — radial fracture lines on ground               → earth/ice/fire break
  GroundGlow     — soft persistent radial glow disc (1.5s)       → aftermath/lingering feel
  ScatterPart    — particle field on ground plane                 → sparkles/bubbles/stars
  VerticalPillar — vertical light column billboard                → holy/shadow/energy beam
  ContactSpark   — hit-point sparks billboard (0.7s)             → sparks flying at the impact body point
                   use offsetY to set the world Y height of the hit (e.g. 1.2 = chest, 0.6 = low, 1.8 = high)
                   particles concentrate in attackDir (70% directional cone, 30% fill)
  SlashMark      — hit-confirmation cross mark billboard (0.65s) → "✕" slash imprint at impact point
                   *** MANDATORY for ALL compose effects *** — it is the #1 "did I hit?" signal
                   two crossing strokes: main stroke rotated +30° from attackDir, cross-stroke perpendicular
                   three-layer shader: ultra-thin hot core + mid body + soft glow halo (all visible at distance)
                   offsetY same as ContactSpark (chest height = 1.2); scale 1.0 is already large enough

TOP-LEVEL FIELDS:
  attackDir: [x, z]  — normalized attack direction in world XZ plane (MUST set for directional skills)
    [1, 0]    = rightward slash (default)
    [-1, 0]   = leftward slash
    [0.7, 0.7] = right-forward diagonal
    [0, -1]   = downward/toward camera
    Automatically propagates to ImpactStreak and ContactSpark

COMPONENT PARAMS (each component gets its own independent config):
  color1:    [r,g,b]   primary color — MUST set per component to match description
  color2:    [r,g,b]   secondary/shadow color (darker complement)
  scale:     0.5–2.0   size multiplier (default 1.0)
  intensity: 0.5–2.0   brightness (default 1.0)
  count:     4–40      crack lines (GroundCrack) or particle count (ScatterPart/ContactSpark)
  variant:   "spark"|"bubble"|"star"  — ScatterPart shape only
              "spark"  = trailing fire sparks (use for fire/lightning)
              "bubble" = floating orbs       (use for poison/water/magic)
              "star"   = twinkling cross-stars (use for holy/arcane/star/sparkle/glitter)
  delay:     0.0–0.8   seconds before this component starts (stagger for drama)
  duration:  0.5–2.0   how long this component lasts relative to its base
  offsetY:   world-Y coordinate for ContactSpark/ImpactStreak height
             1.2 = chest (default), 0.6 = low/sweep, 1.8 = head/high slash

TIMING GUIDE (use delay to create natural sequence):
  ImpactFlash:    delay 0.0        (frame-0 punch — always first)
  SlashMark:      delay 0.0        ("✕" imprint simultaneous with Flash — 0.4s then gone)
  ImpactStreak:   delay 0.0        (directional lines simultaneous with Flash — 0.55s)
  ContactSpark:   delay 0.0        (sparks fly immediately at hit point)
  GroundRing:     delay 0.0–0.05   (ring expands with flash)
  GroundCrack:    delay 0.08–0.20  (cracks open after ring)
  GroundGlow:     delay 0.0–0.1    (glow starts immediately, long fade)
  ScatterPart:    delay 0.05–0.15  (particles fly during crack)
  VerticalPillar: delay 0.15–0.4   (pillar shoots up AFTER the initial burst — NEVER delay 0, always wait)

ELEMENT → COLOR MAPPING (apply to each component's color1/color2):
  Fire:    color1=[1.0,0.35,0.0]  color2=[0.55,0.06,0.0]
  Holy:    color1=[1.0,0.95,0.75] color2=[0.8,0.6,0.15]
  Ice:     color1=[0.45,0.88,1.0] color2=[0.05,0.22,0.7]
  Shadow:  color1=[0.55,0.05,1.0] color2=[0.12,0.0,0.4]
  Earth:   color1=[0.75,0.45,0.1] color2=[0.35,0.18,0.03]
  Poison:  color1=[0.2,0.9,0.12]  color2=[0.04,0.35,0.02]
  For MIXED elements: color1 = blend of two elements' colors

RULES:
  1. ALWAYS set color1 for every component (never rely on default)
  2. ALWAYS include SlashMark in EVERY compose effect — no exceptions. It is mandatory.
  3. ALWAYS include ImpactStreak for melee/slash/directional hits — set attackDir accordingly
  4. SlashMark + ImpactStreak + ContactSpark is the "hit trinity" — all three at delay:0 for melee
  4. If description mentions "stars/sparkle/glitter/ / " → ScatterPart variant MUST be "star"
  5. If description mentions "bubbles/orbs/ / " → variant = "bubble"
  6. VerticalPillar color2 should be a darker/richer version of color1 (NOT a different element)
  7. For holy+fire mix: GroundCrack/GroundRing use fire colors, VerticalPillar/ScatterPart use holy colors
  8. To avoid "everything looks like circles": ImpactStreak + SlashMark BREAK the circle pattern
  9. SlashMark offsetY should match ContactSpark offsetY (same hit point height)

COMPOSE OUTPUT (JSON only, no markdown):
Example — "holy fire right-slash: hit trinity at chest, ground cracks, white pillar, star particles":
{"mode":"compose","attackDir":[1,0],"label":" ","components":{"ImpactFlash":{"delay":0,"color1":[1.0,0.9,0.7],"scale":1.1},"SlashMark":{"delay":0,"color1":[1.0,0.95,0.8],"color2":[1.0,0.5,0.1],"offsetY":1.2,"scale":1.0},"ImpactStreak":{"delay":0,"color1":[1.0,0.85,0.5],"color2":[1.0,0.35,0.0],"scale":1.0},"ContactSpark":{"delay":0,"count":18,"color1":[1.0,0.75,0.2],"color2":[1.0,0.2,0.0],"offsetY":1.2,"scale":1.0},"GroundGlow":{"delay":0,"color1":[1.0,0.5,0.05],"color2":[0.5,0.08,0.0],"scale":1.4},"GroundRing":{"delay":0.02,"color1":[1.0,0.4,0.05],"color2":[0.55,0.06,0.0],"scale":1.2},"GroundCrack":{"delay":0.10,"count":9,"color1":[1.0,0.5,0.05],"color2":[0.4,0.08,0.0]},"VerticalPillar":{"delay":0.15,"color1":[1.0,0.95,0.78],"color2":[0.85,0.65,0.2]},"ScatterPart":{"delay":0.08,"count":20,"variant":"star","color1":[1.0,0.95,0.78],"color2":[0.8,0.55,0.1]}}}

━━ COLOR GUIDE ━━
  Fire=[1.0,0.3,0.0]/[0.6,0.04,0.0]  Ice=[0.4,0.85,1.0]/[0.05,0.2,0.7]
  Lightning=[0.9,0.95,1.0]/[0.3,0.4,1.0]  Holy=[0.3,1.0,0.45]/[0.05,0.55,0.15]
  Wind=[0.7,0.95,1.0]/[0.15,0.55,0.75]  Earth=[0.75,0.45,0.1]/[0.35,0.18,0.03]
  Shadow=[0.6,0.08,1.0]/[0.12,0.0,0.35]  Poison=[0.2,0.9,0.12]/[0.04,0.35,0.02]`

export interface GenerateResult {
  success:     boolean
  /** ：template（ ）  compose（ ） */
  mode?:       'template' | 'compose'
  template?:   string
  label?:      string
  params?:     TemplateParams
  /** compose  */
  components?: Record<string, Record<string, unknown>>
  /** （world XZ ， ）—— compose  */
  attackDir?:  [number, number]
  error?:      string
}

export async function generateFromDescription(description: string): Promise<GenerateResult> {
  const prompt = TEMPLATE_AI_SCHEMA + '\n\nSKILL DESCRIPTION: ' + description + '\n\nJSON:'
  try {
    const res = await fetch('/__ce-api__/gemini-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: 'gemini-2.0-flash' }),
    })
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
    const data = await res.json()
    if (!data.success || !data.text) return { success: false, error: data.error || 'AI no response' }
    let raw: string = data.text.trim()
    const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/)
    if (jsonMatch) raw = (jsonMatch[1] ?? jsonMatch[0]).trim()
    const parsed = JSON.parse(raw)

    // compose
    if (parsed.mode === 'compose') {
      if (!parsed.components || typeof parsed.components !== 'object') {
        return { success: false, error: 'compose mode missing components field' }
      }
      //  attackDir（ ）
      let attackDir: [number, number] | undefined
      if (Array.isArray(parsed.attackDir) && parsed.attackDir.length >= 2) {
        const [ax, az] = parsed.attackDir as number[]
        const len = Math.hypot(ax, az)
        attackDir = len > 0 ? [ax / len, az / len] : [1, 0]
      }
      return {
        success:    true,
        mode:       'compose',
        label:      parsed.label ?? 'Composite VFX',
        components: parsed.components,
        attackDir,
      }
    }

    // template （ ）
    if (!parsed.template || !parsed.params) return { success: false, error: 'invalid response format' }
    return {
      success:  true,
      mode:     'template',
      template: parsed.template,
      label:    parsed.label,
      params:   parsed.params,
    }
  } catch (e: unknown) {
    return { success: false, error: (e as Error).message }
  }
}
