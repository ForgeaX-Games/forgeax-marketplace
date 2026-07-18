export type Direction = 'down' | 'left' | 'right' | 'up'

export const DIRECTIONS: Direction[] = ['down', 'left', 'right', 'up']

export const DIR_LABELS: Record<Direction, string> = {
  down: '正面',
  left: '左面',
  right: '右面',
  up: '背面',
}

export interface ChibiAction {
  id: string
  label: string
  framesPerDir: number
  looping: boolean
  fps?: number
  holdLastFrameMs?: number
  /** Green-background expansion factor (default 2). */
  expandFactor?: number
  directions: Direction[]
  motion: string
  templateAsset?: string
  /**
   * Force a SINGLE physical row per direction, bypassing the wrap logic in
   * `computeSheetLayout`. Used by the small-creature character type — for
   * small silhouettes we prefer a wide 21:9 canvas with the creature sized
   * down inside each cell, rather than wrapping to 2+ physical rows which
   * small-creature prompts otherwise do not control tightly enough.
   */
  forceSingleRow?: boolean
}

function dirLock(n: number): string {
  return `DIRECTION LOCK: Same facing in all ${n} frames per row. Only limbs move. Do NOT flip the character between frames. ` +
    'Attack/action direction: FRONT row → strike downward (toward camera). BACK row → strike upward/forward (AWAY from camera, toward TOP of frame). ' +
    'LEFT row → character faces LEFT edge, action goes leftward. RIGHT row → character faces RIGHT edge, action goes rightward. ' +
    'LEFT and RIGHT rows are MIRROR IMAGES of each other — they must NOT look identical.'
}

export const CHIBI_ACTIONS: ChibiAction[] = [
  /* ── 基础 ────────────────────────────────────────────────── */
  {
    id: 'idle',
    label: '待机 (Idle)',
    framesPerDir: 3,
    looping: true,
    directions: ['down', 'left', 'right', 'up'],
    motion:
      '3-frame idle breathing loop. The character is STANDING STILL in a relaxed upright pose — NOT walking, NOT striding.\n' +
      'ALL frames: Feet together or nearly together, flat on the ground, NEVER spread apart. Arms hang naturally at sides (or one hand rests on weapon if holding one). Body faces the camera/direction straight on.\n' +
      '  Frame 1: Slight inhale — body raised a tiny bit, chest expands slightly.\n' +
      '  Frame 2: Neutral standing pose — feet level, relaxed, default posture.\n' +
      '  Frame 3: Slight exhale — body lowered a tiny bit, shoulders drop slightly.\n' +
      'The difference between frames is EXTREMELY subtle — only chest and shoulders shift. Legs and feet stay in the SAME position across all 3 frames. Do NOT animate the legs.\n' +
      dirLock(3),
  },
  {
    id: 'walk',
    label: '走路 (Walk)',
    framesPerDir: 3,
    looping: true,
    directions: ['down', 'left', 'right', 'up'],
    motion:
      '3-frame walk cycle.\n' +
      '  Frame 1 (LEFT STRIDE): Left foot steps FORWARD, right foot stays BEHIND. Legs are SPREAD APART in a clear stride. Left arm swings back, right arm forward.\n' +
      '  Frame 2 (PASSING POSE — ⚠️ CRITICAL): BOTH FEET TOGETHER, CLOSED, SIDE-BY-SIDE, TOUCHING. Legs are STRAIGHT and PARALLEL — like standing at attention. ' +
      'This is the neutral midpoint where one leg has caught up to the other. There must be ZERO gap between the feet. The character looks like they are standing still in this frame. ' +
      'DO NOT draw the legs apart or in a stride in frame 2. If feet are spread apart in frame 2, the animation is WRONG. ' +
      'Character MUST still hold weapon in the same hand — do NOT drop or hide it.\n' +
      '  Frame 3 (RIGHT STRIDE): Right foot steps FORWARD, left foot stays BEHIND. Mirror of frame 1. Arms swing opposite.\n' +
      'The cycle loops: 1→2→3→2→1… Arms swing opposite to legs.\n' +
      dirLock(3),
    templateAsset: '/pixel-templates/walk.png',
  },
  {
    id: 'run',
    label: '奔跑 (Run)',
    framesPerDir: 3,
    looping: true,
    directions: ['down', 'left', 'right', 'up'],
    motion:
      '3-frame run cycle — faster, more dynamic than walking.\n' +
      '  Frame 1 (PUSH-OFF): One leg fully extended behind, the other knee raised HIGH in front. Body leans forward aggressively. Arms pump wide.\n' +
      '  Frame 2 (FLIGHT — ⚠️ CRITICAL): BOTH feet OFF the ground. Legs tucked under the body mid-air. This is the "airborne" phase that distinguishes running from walking. ' +
      'Character MUST still hold weapon — even while airborne, do NOT drop or hide it.\n' +
      '  Frame 3 (LANDING): Opposite leg now extended behind, mirror of frame 1. Arms swing opposite.\n' +
      'The cycle loops: 1→2→3→2→1. Body has a noticeable forward lean compared to walking.\n' +
      dirLock(3),
  },

  /* ── 横版跳跃 ────────────────────────────────────────────── */
  {
    id: 'jump',
    label: '跳跃 (Jump)',
    framesPerDir: 5,
    looping: false,
    expandFactor: 3,
    directions: ['right'],
    motion:
      '5-frame side-view jump arc for a 2D platformer. Gravity pulls DOWN; forward motion is to the RIGHT.\n' +
      '  F1 CROUCH / ANTICIPATION: Knees bent deep, arms swung behind body to load energy. Center of mass LOWEST of the whole cycle.\n' +
      '  F2 TAKEOFF / PUSH: Both feet leaving the ground, legs extending, arms swinging upward and forward. Body leans slightly FORWARD (rightward).\n' +
      '  F3 APEX (⚠️ CRITICAL): Highest point of the jump. Both feet tucked under body or one knee raised, other leg extended. Arms roughly at shoulder height. ' +
      'Character must appear CLEARLY airborne — there must be empty pixels below the feet and above the head silhouette compared with F1.\n' +
      '  F4 DESCENT: Body descending, legs extending downward to prepare for landing, arms begin to spread for balance. Body still airborne.\n' +
      '  F5 LANDING: Feet touch ground, knees bent to absorb impact (less deep than F1), torso upright or slightly forward, arms forward/down for balance.\n' +
      'The vertical position of the character varies per frame: F1 lowest, F2 mid, F3 highest, F4 mid, F5 ground. This rising-and-falling silhouette is the whole point of the animation — do NOT keep the feet on the same baseline in every frame.\n' +
      'Weapon (if any) stays in the SAME hand all 5 frames, never dropped.\n' +
      'ONLY the RIGHT-facing profile is needed (engine mirrors for left jumps). Character faces RIGHT throughout; body, feet and weapon all in right profile.',
  },

  /* ── 战斗 ────────────────────────────────────────────────── */
  {
    id: 'attack',
    label: '攻击 (Attack)',
    framesPerDir: 4,
    looping: false,
    expandFactor: 3,
    directions: ['down', 'left', 'right', 'up'],
    motion:
      '4-frame attack animation. Look at the turnaround reference image to identify what weapon the character holds, ' +
      'then use the MATCHING attack style below.\n\n' +

      'SWORD / BLADE:\n' +
      '  F1 GUARD: Combat-ready stance, weapon at side or in front.\n' +
      '  F2 WIND-UP: Blade raised behind shoulder, body twists to store power.\n' +
      '  F3 SLASH: Full horizontal or diagonal slash, arm fully extended, blade at peak arc. ⚠️ This is the IMPACT frame.\n' +
      '  F4 FOLLOW-THROUGH: Blade swings past the body, character recovers balance.\n\n' +

      'BOW / CROSSBOW:\n' +
      '  F1 READY: Standing with bow lowered, one hand on the grip.\n' +
      '  F2 NOCK: Arrow drawn from quiver, placed on string.\n' +
      '  F3 FULL DRAW: String pulled back to cheek, body tensed, aim locked. ⚠️ IMPACT frame.\n' +
      '  F4 RELEASE: String snaps forward, drawing arm follows through, arrow gone.\n\n' +

      'GUN / PISTOL / RIFLE:\n' +
      '  F1 HOLSTER: Weapon lowered or at hip.\n' +
      '  F2 AIM: Weapon raised, both arms steady, sighting down the barrel.\n' +
      '  F3 FIRE: Recoil frame — arms jolt back slightly, muzzle kick visible in posture. ⚠️ IMPACT frame.\n' +
      '  F4 RECOVER: Weapon lowers, body settles from recoil.\n\n' +

      'STAFF / WAND / MAGIC WEAPON:\n' +
      '  F1 HOLD: Staff held vertically or diagonally, neutral stance.\n' +
      '  F2 CHANNEL: Staff sweeps back or raised overhead, body coils.\n' +
      '  F3 THRUST: Staff thrusts forward decisively, arm extended, weight shifts forward. ⚠️ IMPACT frame.\n' +
      '  F4 SETTLE: Staff returns to neutral position, body relaxes.\n\n' +

      'FIST / MARTIAL ARTS:\n' +
      '  F1 STANCE: Fighting guard, fists raised, weight centered.\n' +
      '  F2 COCK: Rear arm pulls back, hips rotate to load power.\n' +
      '  F3 PUNCH: Straight punch fully extended, body snaps forward. ⚠️ IMPACT frame.\n' +
      '  F4 RETRACT: Fist pulls back, return to guard stance.\n\n' +

      'POLEARM / SPEAR / LANCE:\n' +
      '  F1 READY: Spear held diagonally or overhead, wide stance.\n' +
      '  F2 PULL BACK: Spear drawn behind the body, coiling for thrust.\n' +
      '  F3 THRUST: Powerful forward stab, full arm extension, body lunges. ⚠️ IMPACT frame.\n' +
      '  F4 RETRACT: Spear pulls back, body settles into ready stance.\n\n' +

      'DAGGER / DUAL BLADES:\n' +
      '  F1 CROUCH: Low ready stance, blades held close.\n' +
      '  F2 LUNGE: Body springs forward, one blade leading.\n' +
      '  F3 CROSS-SLASH: Both arms sweep outward in an X-pattern. ⚠️ IMPACT frame.\n' +
      '  F4 SPRING BACK: Blades retract, return to low crouch.\n\n' +

      'If the weapon does not match any category above, use the closest one.\n' +
      'Weapon stays in the SAME hand across all 4 frames. ' +
      dirLock(4),
  },
  {
    id: 'hurt',
    label: '受击 (Hurt)',
    framesPerDir: 3,
    looping: false,
    expandFactor: 2.5,
    directions: ['down', 'left', 'right', 'up'],
    motion:
      '3-frame hurt reaction. ' +
      'Frame 1: Impact — body jolts back, pain expression. ' +
      'Frame 2: Maximum recoil — body bent furthest back, arms splayed. ' +
      'Frame 3: Partial recovery — still shaky, not fully upright. ' +
      'Character looks VULNERABLE, not aggressive. ' +
      dirLock(3),
  },
  {
    id: 'cast',
    label: '施法 (Cast)',
    framesPerDir: 4,
    looping: false,
    expandFactor: 2.5,
    directions: ['down', 'left', 'right', 'up'],
    motion:
      '4-frame spellcasting animation. NO magic effects, NO glowing, NO particles — body and weapon motion ONLY.\n\n' +

      '  F1 FOCUS: Hands brought together at chest, or staff held before the body, eyes narrowed in concentration.\n' +
      '  F2 CHANNEL: Arms spread apart or staff raised high overhead, body pulled taut, stance widens.\n' +
      '  F3 RELEASE: Decisive forward thrust or sweeping gesture — full body commitment, weight shifts forward. ⚠️ This is the PEAK frame.\n' +
      '  F4 SETTLE: Arms lower, body relaxes back to a neutral upright stance.\n\n' +

      'Adapt the casting gesture to match what the character holds in the turnaround reference:\n' +
      '  Staff / wand: use it as the focal point — raise it overhead in F2, thrust it forward in F3.\n' +
      '  Bare-handed caster: palms-together focus in F1, wide arm spread in F2, both palms push forward in F3.\n' +
      '  Book / tome: hold the book open in one hand throughout; gesture with the free hand.\n' +
      '  Sword-mage or weapon-caster: incorporate the blade or weapon into the channeling pose — raise it in F2, sweep it forward in F3 as if channeling energy through it.\n' +
      'Body only — absolutely no visible spell effects, auras, or particles.\n' +
      dirLock(4),
  },
  {
    id: 'dodge',
    label: '闪避 (Dodge)',
    framesPerDir: 3,
    looping: false,
    expandFactor: 3,
    directions: ['down', 'left', 'right', 'up'],
    motion:
      '3-frame dodge. NO blur, NO afterimages. ' +
      'Frame 1: Body drops low, knees bent, arms tucked. ' +
      'Frame 2: Body lunges in facing direction, feet off ground. ' +
      'Frame 3: Landing low, one hand on ground, ready posture. ' +
      'Body only — no visual effects. ' +
      dirLock(3),
  },

  /* ── 大招 (5帧, 纯肢体动作, 特效后加) ─────────────────────── */
  {
    id: 'ultimate',
    label: '大招 (Ultimate)',
    framesPerDir: 5,
    looping: false,
    holdLastFrameMs: 500,
    expandFactor: 3.5,
    directions: ['down', 'left', 'right', 'up'],
    motion:
      '5-frame ultimate attack — the character\'s most powerful move. NO effects, NO auras, NO glowing. ' +
      'Look at the turnaround reference to identify the weapon, then use the MATCHING ultimate style.\n\n' +

      'SWORD / BLADE:\n' +
      '  F1 Power stance, blade held at side. F2 Crouch, blade drawn far behind. ' +
      'F3 Explosive upward slash, body springs, blade overhead at zenith. ' +
      'F4 Devastating downward cleave, blade at full extension. F5 Finishing pose, blade swept to the side.\n\n' +

      'BOW / CROSSBOW:\n' +
      '  F1 Feet planted wide, bow raised. F2 Draw a special arrow, exaggerated pull-back. ' +
      'F3 Full power draw — string past the ear, body arched with tension. ' +
      'F4 Release — string snaps, drawing arm sweeps back dramatically. F5 Follow-through pose, bow arm still extended.\n\n' +

      'GUN / PISTOL / RIFLE:\n' +
      '  F1 Wide stance, weapon at hip. F2 Weapon raised, steadied with both hands. ' +
      'F3 Charged shot aim — arms locked, body leans into the shot. ' +
      'F4 Fire — heavy recoil, body jolts back. F5 Smoke-clear pose, weapon lowered.\n\n' +

      'STAFF / WAND / MAGIC WEAPON:\n' +
      '  F1 Staff planted on ground, wide stance. F2 Staff raised overhead, body coils. ' +
      'F3 Staff at zenith, body fully extended upward. ' +
      'F4 Staff slammed or thrust forward with maximum force. F5 Finishing pose, staff to the side.\n\n' +

      'FIST / MARTIAL ARTS:\n' +
      '  F1 Deep horse stance, fists clenched. F2 Body winds up, one fist drawn far back. ' +
      'F3 Explosive forward lunge, leading fist fires. ' +
      'F4 Follow-through — second strike or spinning kick at full extension. F5 Landing pose, one fist forward.\n\n' +

      'POLEARM / SPEAR / LANCE:\n' +
      '  F1 Spear held overhead, wide stance. F2 Body coils, spear pulled behind. ' +
      'F3 Leaping thrust — body airborne, spear tip leads. ' +
      'F4 Maximum extension, full lunge. F5 Landing with spear swept to the side.\n\n' +

      'DAGGER / DUAL BLADES:\n' +
      '  F1 Low crouch, blades fanned out. F2 Sprint forward, one blade leading. ' +
      'F3 First slash — wide arc. ' +
      'F4 Second cross-slash — opposite blade sweeps through. F5 Spinning finish, blades at sides.\n\n' +

      'Body and weapon only — absolutely no visual effects. ' +
      dirLock(5),
  },

  /* ── 死亡 ────────────────────────────────────────────────── */
  {
    id: 'death',
    label: '死亡 (Death)',
    framesPerDir: 3,
    looping: false,
    holdLastFrameMs: 1000,
    expandFactor: 3,
    directions: ['down', 'left', 'right', 'up'],
    motion:
      '3-frame death sequence. The character TOPPLES OVER and ends up lying flat.\n\n' +
      '  FRONT row (facing camera): Character falls FORWARD toward camera. Frame 2: body tips forward, leaning toward BOTTOM of frame. Frame 3: lying face-down, HEAD near BOTTOM ↓, FEET near TOP ↑.\n' +
      '  LEFT row (facing left): Character falls LEFTWARD. Frame 2: body tilts left. Frame 3: lying HORIZONTAL, HEAD on LEFT ←, FEET on RIGHT →.\n' +
      '  RIGHT row (facing right): Character falls RIGHTWARD. Frame 2: body tilts right. Frame 3: lying HORIZONTAL, HEAD on RIGHT →, FEET on LEFT ←.\n' +
      '  BACK row (facing away): Character falls BACKWARD. Frame 2: body tips backward, leaning toward BOTTOM of frame. Frame 3: lying on back, HEAD near BOTTOM ↓, FEET near TOP ↑.\n\n' +
      'KEY RULE: FRONT/BACK end up vertical (head at bottom). LEFT/RIGHT end up horizontal (head facing direction of fall). Character must be fully LYING FLAT in frame 3.\n' +
      dirLock(3),
  },
]

export function getAction(id: string): ChibiAction | undefined {
  return CHIBI_ACTIONS.find(a => a.id === id)
}

export function getAllActions(): ChibiAction[] {
  return CHIBI_ACTIONS
}

