/**
 * Character-type axis for the pixel pipeline.
 *
 * The humanoid pipeline bakes in a LOT of biped-specific prompt detail
 * (feet together passing pose, weapon stays in the same hand, left/right hip
 * rotation, etc.). For monsters and bosses those rules are actively harmful —
 * a tentacled horror shouldn't have "feet together in frame 2", a wyvern
 * shouldn't hold a sword, a slime shouldn't "topple forward on death".
 *
 * The monster path therefore strips the humanoid-specific guards and asks
 * the image model to let the CREATURE'S ANATOMY drive the motion, using
 * only the reference image and the action name as clues. Prompt authoring
 * is kept deliberately shallow here — the user's core request is "don't
 * over-engineer the monster prompts, trust the model".
 */

import type { ChibiAction } from './actions'

export type CharacterType = 'humanoid' | 'monster' | 'creature-small'

export const DEFAULT_CHARACTER_TYPE: CharacterType = 'humanoid'

export interface CharacterTypePreset {
  id: CharacterType
  label: string
  icon: string
  shortLabel: string
  description: string
  /** Headline note that opens every prompt. */
  headline: string
  /**
   * Whether to include humanoid-specific guards:
   *  - frame-by-frame walk/idle checklist ("feet together in frame 2")
   *  - weapon retention ("weapon stays in the same hand")
   *  - chibi 4-5 head-tall proportion enforcement
   *  - directional "face this way / mirror on the other side" strictness
   */
  humanoidGuards: boolean
  /**
   * Force single-row physical layout (rowsPerDir=1) regardless of aspect.
   *
   * Only meaningful for NON-humanoid types where frame counts are small
   * enough that a 21:9 canvas at `framesPerDir × 1` physically fits the
   * creature without cropping. Small creatures benefit from this: the wrap
   * logic that serves bosses (5-7 frame cinematic strips) is overkill and
   * makes the model invent "row A / row B" layouts for something that could
   * have been 4 punchy frames in a single row.
   */
  forceSingleRow: boolean
}

/**
 * `monster` is kept as the id for the big-BOSS preset to preserve backward
 * compatibility with saved characters authored before `creature-small` was
 * introduced. Legacy configs loaded from localStorage will continue to
 * resolve to the boss preset without migration.
 */
export const CHARACTER_TYPES: CharacterTypePreset[] = [
  {
    id: 'humanoid',
    label: '人形 / 类人',
    shortLabel: '人形',
    icon: '🧍',
    description: '带四肢、躯干、可持械的类人角色，启用走路/待机等标准人形动画细则',
    headline:
      'The character is HUMANOID (biped or biped-like). Standard humanoid animation grammar applies — feet, hands, arms, weapon hand, walk-cycle passing pose, etc.',
    humanoidGuards: true,
    forceSingleRow: false,
  },
  {
    id: 'monster',
    label: '大型BOSS / 巨兽',
    shortLabel: 'BOSS',
    icon: '🐲',
    description: '大体型BOSS/巨兽：画面里占比大，动画帧多（5-7 帧），允许物理画幅自动折行为多行',
    headline:
      'The character is a LARGE BOSS / GIANT CREATURE. It occupies most of its cell area and uses richer, more cinematic animation with more frames. Do NOT force humanoid animation rules. ' +
      'Read the reference image to determine the creature\'s anatomy (quadruped, floating, tentacled, serpentine, mechanical, amorphous, swarm, etc.) and animate it in a way that is NATURAL for that body plan. ' +
      'Quadrupeds use quadruped gaits. Floating creatures bob. Tentacled creatures undulate. Slimes squish. Mechs pivot on joints. Dragons unfurl wings. ' +
      'Do NOT invent arms, legs, or weapons that are not visible in the reference. Do NOT apply biped walk-cycle rules like "feet together in frame 2".',
    humanoidGuards: false,
    forceSingleRow: false,
  },
  {
    id: 'creature-small',
    label: '小型怪物 / 生物',
    shortLabel: '小怪',
    icon: '🐛',
    description: '小体型杂兵：史莱姆、蝙蝠、小蜘蛛等。强制单行输出，帧数精简但动作张力更强',
    headline:
      'The character is a SMALL CREATURE / MINION (slime, bat, tiny spider, goblin whelp, sprite, etc.). Do NOT force humanoid animation rules. ' +
      'Read the reference image to determine the creature\'s anatomy and animate it in a way that is NATURAL for that body plan. ' +
      'This is a SMALL creature — in the sprite sheet it occupies only a modest portion of each cell (roughly 35-55% of cell area, vertically centred) leaving generous green space on every side. ' +
      'The animation prioritises TENSION and PUNCH over polish: exaggerated anticipation, pronounced squash-and-stretch, snappy impacts, sharp recoils. Each pose differs dramatically from its neighbours.',
    humanoidGuards: false,
    forceSingleRow: true,
  },
]

export function getCharacterType(id: string | undefined | null): CharacterTypePreset {
  return (
    CHARACTER_TYPES.find(t => t.id === id)
    ?? CHARACTER_TYPES.find(t => t.id === DEFAULT_CHARACTER_TYPE)!
  )
}

/**
 * Minimal, anatomy-agnostic motion descriptions used when characterType ===
 * 'monster'. These intentionally DO NOT prescribe specific limb mechanics;
 * they name the INTENT of each action and let the image model infer how the
 * creature would execute it.
 *
 * The text is written in PHASE language (anticipation / wind-up / impact /
 * recovery / apex / landing / ...) so that bumping `framesPerDir` from 4 to 6
 * or 3 to 5 does NOT leave stale "Frame 5: landing" lines dangling. The
 * wrapper announces the actual frame count and then the phases self-distribute
 * across however many frames we ask for.
 */
export function buildMonsterMotion(
  actionId: string,
  framesPerDir: number,
  looping: boolean,
  characterType: CharacterType = 'monster',
): string {
  const loopNote = looping
    ? `Loop-ready: the last frame should connect smoothly back into the first.`
    : `One-shot: plays exactly once from the first frame to the last.`

  const isSmall = characterType === 'creature-small'
  const motionTable = isSmall ? SMALL_CREATURE_MOTION : MONSTER_MOTION
  const base = motionTable[actionId] ?? defaultMonsterMotion(actionId, isSmall)

  const pacing = isSmall
    // Small-creature pacing prizes CONTRAST over cinematic smoothness: every
    // frame must feel dramatically different from its neighbour, because
    // small creatures rely on exaggerated silhouettes to "read" at tiny pixel
    // sizes — subtle in-betweens get lost.
    ? `Use all ${framesPerDir} frames with MAXIMUM pose contrast between neighbours. This is a small creature — details wash out at small sizes, so SILHOUETTE SHAPES must change dramatically frame to frame. Avoid subtle in-betweens; favour strong, punchy pose changes.`
    : framesPerDir >= 5
      ? `Use ALL ${framesPerDir} frames — the motion should feel smoother and more cinematic than a minimal 3-frame loop. Spread the phases so neighbouring frames differ noticeably; do NOT repeat the same pose twice.`
      : `Use all ${framesPerDir} frames — each frame must show a visibly different pose from its neighbours.`

  const framingRule = isSmall
    ? 'FRAMING: this is a SMALL creature. It occupies roughly 35-55% of cell area, vertically centred, with generous green margin on ALL sides. Do NOT enlarge the creature to fill the cell. Do NOT let limbs / projectiles / effects cross the invisible boundary between neighbouring frames.'
    : 'FRAMING: keep the creature fully inside its own frame cell. Leave a clear margin of empty space on all four sides; do NOT let any limb, tail, weapon, wing, horn, projectile or effect cross the invisible boundary between neighbouring frames.'

  const header = isSmall
    ? `${framesPerDir}-frame ${actionId} animation for a SMALL creature — punchy and high-tension.`
    : `${framesPerDir}-frame ${actionId} animation for the creature.`

  return `${header}\n${base}\n${pacing}\n${framingRule}\n${loopNote}`
}

const MONSTER_MOTION: Record<string, string> = {
  idle:
    'PHASES: inhale / neutral / exhale. The creature is at rest. Only SUBTLE motion: breathing, idle sway, tail flick, hover bob, tentacle drift, slime pulse — whatever fits its anatomy. ' +
    'The creature does NOT move from its spot. Silhouette stays almost identical across frames; only small organic shifts separate them.',

  walk:
    'PHASES (distribute evenly across frames): lead-limb forward / passing neutral / trail-limb forward / passing neutral. ' +
    'The creature performs its natural LOCOMOTION at a walking pace. ' +
    'Quadrupeds: proper quadruped walk cycle (diagonal leg pairs). Bipedal beasts: asymmetric stride with whatever limb count it has. ' +
    'Serpentine: slither wave travels along the body. Floating: gentle hover with forward drift and subtle altitude bob. ' +
    'Slime / blob: squash-and-roll — body flattens on landings, stretches on takeoffs. ' +
    'The animation should CLEARLY convey forward travel; the body deforms according to the creature\'s anatomy, not a human walk cycle. Body silhouette visibly changes from frame to frame.',

  run:
    'PHASES: push-off / extension / flight (airborne if possible) / landing / recovery. ' +
    'A faster, more exaggerated version of the creature\'s natural locomotion — more extension, more body compression/extension, greater displacement between frames. ' +
    'If airborne/floating, the hover bob becomes a propulsive surge. If legged, at least one frame should show all feet off the ground.',

  attack:
    'PHASES: READY stance / WIND-UP (coil, load energy, draw back) / IMPACT (peak aggression, full extension — the most dynamic frame) / FOLLOW-THROUGH / RECOVER. ' +
    'The creature performs its PRIMARY OFFENSIVE move — bite, slam, claw swipe, horn gore, tail sweep, projectile spit, energy discharge, body-check — whatever its anatomy makes most natural. ' +
    'The IMPACT phase must be unambiguously the most aggressive, extended pose; surrounding frames read as build-up and release around it. ' +
    'With more frames available, add an extra anticipation beat before IMPACT and/or an extra settle beat after RECOVER — do not waste frames on duplicates.',

  hurt:
    'PHASES: initial impact / peak recoil / partial recovery. ' +
    'The creature reacts to being struck. It flinches, recoils, or convulses in a way that fits its body plan. ' +
    'If it has a head, the head snaps back. If it is amorphous, the body compresses. If it hovers, it dips. The pose reads as PAIN, not aggression. ' +
    'With extra frames, add a second recoil beat or a tremor on recovery.',

  cast:
    'PHASES: FOCUS (gather) / CHANNEL (coil, tense, arch) / RELEASE (peak forward / outward gesture) / SETTLE. ' +
    'The creature channels / summons / charges up. Posture tenses, body arches or coils, glow-less preparation (NO particle effects, NO auras, NO glow), culminating in a release gesture at the peak phase. ' +
    'Monsters with no "casting gesture" simply throb, inflate, or contort to show the build-up.',

  dodge:
    'PHASES: load / leap or slip away / land or reset. ' +
    'The creature evades. It hops, sidesteps, ducks, blinks, coils back, or slithers away — whichever movement its body supports. ' +
    'The middle frame shows the furthest displacement or most extreme pose.',

  ultimate:
    'PHASES: READY / DEEP WIND-UP / EXPLOSIVE LAUNCH / PEAK COMMITMENT (signature impact, most dynamic frame) / DRAMATIC FOLLOW-THROUGH / FINISHING POSE. ' +
    'The creature\'s SIGNATURE attack — a cinematic dramatic sequence. Build the intensity frame by frame; each phase should look meaningfully different from its neighbours so the sequence reads as a mini cutscene. ' +
    'With more frames available, lengthen the wind-up or add a secondary strike rather than duplicating poses. ' +
    'NO visual effects, NO glow, NO particles — motion and posture only.',

  death:
    'PHASES: struck / collapsing / fallen. ' +
    'The creature is defeated. The sequence conveys increasing collapse appropriate to its anatomy — it may topple, crumble, deflate, dissolve, fragment, or slump. ' +
    'The FINAL frame must show the creature fully defeated (fallen, collapsed, scattered, or dissolved) — NOT still upright. ' +
    'With extra frames, insert an intermediate sag/buckling beat between struck and fallen. ' +
    'Do NOT force a "humanoid topples forward" pose; match the body plan.',

  jump:
    'PHASES: CROUCH / TAKEOFF / APEX (airborne, empty space clearly visible below the body) / DESCENT / LANDING. ' +
    'The creature performs a vertical leap. Vertical position of the silhouette varies per frame — lowest at CROUCH and LANDING, highest at APEX. ' +
    'Creatures that cannot physically jump (floating, crawling) should instead perform a big vertical surge-and-dip that conveys "jumping" in spirit.',
}

function defaultMonsterMotion(actionId: string, isSmall: boolean): string {
  if (isSmall) {
    return (
      `Animate the small creature performing "${actionId}" with exaggerated, punchy motion. ` +
      `Silhouette shape changes dramatically between frames. ` +
      `The central / middle frame is the most extreme, aggressive, or dynamic moment of the action.`
    )
  }
  return (
    `Animate the creature performing "${actionId}" in a way that is natural for its anatomy. ` +
    `The creature\'s body plan drives the motion; do not impose human movement rules. ` +
    `The central / middle frame should be the most visually dynamic moment of the action.`
  )
}

/**
 * Small-creature motion table.
 *
 * Deliberately shorter and more exaggerated than `MONSTER_MOTION`:
 *
 * - SMALL creatures work in 3-4 frames, not 5-7. Extra frames get wasted on
 *   tiny silhouettes because subtle tweens don't read at small pixel sizes.
 * - Every phase is an EXAGGERATION cue — SQUASH deeper, STRETCH longer,
 *   COIL tighter, RECOIL harder — so small pixel art still feels alive.
 * - Attack-family actions explicitly call out ANTICIPATION and IMPACT as
 *   the two "star" frames with maximum pose contrast.
 */
const SMALL_CREATURE_MOTION: Record<string, string> = {
  idle:
    'PHASES: inhale (compress) / neutral / exhale (extend). ' +
    'The creature hovers/breathes in place with noticeable squash-and-stretch — not subtle. ' +
    'A slime visibly pulses, a bat flaps once, a little imp bounces on its heels. ' +
    'Silhouette shape differs clearly between phases; position stays.',

  walk:
    'PHASES: contact / lift / passing / contact (opposite). ' +
    'Snappy forward locomotion with pronounced body tilt and exaggerated limb extension. ' +
    'Quadrupeds: bouncy hop-walk with clear up-down motion. Floating: forward surge + dip, then catch-up. ' +
    'Slimes: stretch forward, then snap the rear up to catch, compressing on the landing. ' +
    'Silhouette bobs up and down visibly; do NOT draw a "flat slide".',

  run:
    'PHASES: push-off / airborne / landing. ' +
    'An even more exaggerated version of walk — if there is a 4th frame, add a second airborne beat. ' +
    'At peak extension the body is STRETCHED long; at landing it is COMPRESSED. ' +
    'Maximum silhouette contrast between consecutive frames.',

  attack:
    'PHASES: ANTICIPATION (deep coil / wind-up — body compressed and pulled back into its own mass) / ' +
    'IMPACT (EXPLOSIVE forward lunge, maximum body extension, pose is as aggressive as the anatomy allows — this frame is the STAR of the animation and must be unmistakably the most extreme) / ' +
    'RECOVERY (settling back toward neutral, slightly past neutral in the opposite direction if there\'s a 4th frame). ' +
    'Use STRONG squash-and-stretch: tight ball before impact, long extended shape at impact. ' +
    'Impact frame silhouette must be dramatically larger or longer than the anticipation frame.',

  hurt:
    'PHASES: flinch (body yanked backward, limbs splayed, SHOCK pose) / recoil (maximum backward compression, face-equivalent contorted) / recovery. ' +
    'Motion reads as a sharp, involuntary kickback. Silhouette clearly shows the creature being STRUCK, not posing.',

  cast:
    'PHASES: FOCUS (compress, pull energy inward, smallest silhouette) / CHANNEL (tensed arch, body visibly puffed or elongated) / RELEASE (forward burst gesture, biggest silhouette). ' +
    'NO particle effects, NO glow, NO auras — motion and posture only.',

  dodge:
    'PHASES: load (squash inward) / leap (maximum horizontal displacement, body stretched) / land (squash again, opposite side). ' +
    'Middle frame is the most extreme — body off-centre, stretched thin in the direction of the dodge.',

  ultimate:
    'PHASES: DEEP WIND-UP (compressed, tense) / EXPLOSIVE COMMITMENT (most aggressive, fully extended, signature pose) / DRAMATIC FOLLOW-THROUGH / LANDING POSE. ' +
    'Even for a small creature this reads as its "hero moment" — exaggerate the extreme poses so the sequence feels bigger than the creature. ' +
    'NO visual effects, NO glow, NO particles — motion and posture only.',

  death:
    'PHASES: struck (jolt, silhouette fractured) / collapsing (body crumples, half-deflated) / fallen (finished pose, creature is clearly defeated — toppled, splattered, deflated, or dissolved). ' +
    'The final frame is unmistakably defeated; do NOT leave the creature standing.',

  jump:
    'PHASES: CROUCH (deep squash, ball-shape, silhouette low) / TAKEOFF / APEX (body STRETCHED vertically, highest silhouette) / DESCENT / LANDING (deep squash again). ' +
    'Vertical displacement across frames is obvious; apex frame is visibly above where the creature started.',
}

/**
 * Frames-per-direction overrides for the LARGE BOSS path.
 *
 * Rationale: bosses and big creatures need richer, more cinematic animation
 * than a 3-frame humanoid walk. We keep `idle` unchanged (still subtle) and
 * hold everything else at +1 to +2 frames versus the humanoid baseline.
 *
 * Kept in ONE place so that it stays in sync with the phase descriptions in
 * MONSTER_MOTION above.
 */
const MONSTER_FRAMES: Record<string, number> = {
  walk: 5,
  run: 5,
  attack: 6,
  ultimate: 7,
  cast: 5,
  dodge: 4,
  jump: 6,
  hurt: 4,
  death: 4,
}

const MONSTER_EXPAND_BONUS: Record<string, number> = {
  walk: 0.5,
  run: 0.5,
  attack: 0.5,
  ultimate: 0.5,
  cast: 0.5,
  dodge: 0.5,
  jump: 0.5,
  hurt: 0.5,
  death: 0.5,
}

/**
 * Frames-per-direction overrides for the SMALL CREATURE path.
 *
 * Deliberately leaner than `MONSTER_FRAMES`:
 *
 * - A 5-7 frame boss ultimate becomes 4 snappy frames for a small creature:
 *   at small pixel sizes each "cinematic beat" gets lost anyway, so extra
 *   frames just dilute pose contrast.
 * - `attack` stays at 4 (anticipation / impact / follow-through / recovery)
 *   — the minimum needed to sell the wind-up → explode → settle beat the
 *   user asked for.
 * - `idle` stays at 3 so subtle breathing works.
 *
 * At framesPerDir ≤ 4 the 21:9 canvas comfortably fits a single row once
 * the small-creature prompt instructs the model to leave ~50% of each cell
 * as empty green space, so `forceSingleRow` on the preset stays honest.
 */
const SMALL_CREATURE_FRAMES: Record<string, number> = {
  walk: 4,
  run: 4,
  attack: 4,
  ultimate: 4,
  cast: 3,
  dodge: 3,
  jump: 4,
  hurt: 3,
  death: 3,
}

const SMALL_CREATURE_EXPAND_BONUS: Record<string, number> = {
  walk: 0.25,
  run: 0.25,
  attack: 0.25,
  ultimate: 0.25,
  cast: 0.25,
  dodge: 0.25,
  jump: 0.25,
  hurt: 0.25,
  death: 0.25,
}

/**
 * Overlay the character-type axis onto a canonical ChibiAction.
 *
 * - humanoid        → identity (keeps the rich biped motion copy and 3/4/5-
 *                     frame counts authored in actions.ts).
 * - monster (BOSS)  → frame count bumped via MONSTER_FRAMES, expand factor
 *                     nudged up. Layout may wrap (rowsPerDir > 1) for wide
 *                     strips.
 * - creature-small  → frame count mildly bumped via SMALL_CREATURE_FRAMES,
 *                     smaller expand bump, and `forceSingleRow=true` so the
 *                     physical layout stays 1 row per direction regardless
 *                     of aspect. The motion field is NOT overwritten here;
 *                     `buildMonsterMotion(..., 'creature-small')` produces
 *                     the tension-heavy copy in `prompt-engine.motionCopy`.
 */
export function applyCharacterType(action: ChibiAction, characterType: CharacterType): ChibiAction {
  if (characterType === 'humanoid') return action

  const preset = characterType === 'creature-small'
    ? { frames: SMALL_CREATURE_FRAMES, expand: SMALL_CREATURE_EXPAND_BONUS }
    : { frames: MONSTER_FRAMES, expand: MONSTER_EXPAND_BONUS }

  const overrideFrames = preset.frames[action.id]
  const expandBonus = preset.expand[action.id] ?? 0
  const forceSingleRow = characterType === 'creature-small' ? true : action.forceSingleRow

  if (!overrideFrames && expandBonus === 0 && forceSingleRow === action.forceSingleRow) {
    return action
  }

  return {
    ...action,
    framesPerDir: overrideFrames ?? action.framesPerDir,
    expandFactor: (action.expandFactor ?? 2) + expandBonus,
    forceSingleRow,
  }
}
