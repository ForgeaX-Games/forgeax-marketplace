export type CharacterView = 'front' | 'side' | 'back' | 'idle'

export const VIEW_LABELS: Record<CharacterView, { zh: string; en: string }> = {
  front: { zh: '正面', en: 'Front' },
  side:  { zh: '侧面', en: 'Side' },
  back:  { zh: '背面', en: 'Back' },
  idle:  { zh: '待机(45°)', en: 'Idle (45°)' },
}

export interface SpriteActionPreset {
  id: string
  nameZh: string
  nameEn: string
  icon: string
  descZh: string
  descEn: string
  prompt: string
  useEndFrame: boolean
  duration?: string
  needsDesignImage?: boolean
  viewPrompts?: Partial<Record<CharacterView, string>>
  /** If true, this preset generates a cinematic with background/VFX (not a game sprite) */
  isCinematic?: boolean
}

// ── Prompt building blocks ──────────────────────────────────────────

const STYLE = 'high-quality 2D HD game character animation, cel-shaded art style, clean linework, consistent character proportions throughout, '
const CAMERA = 'fixed camera, no camera movement, no zoom, no pan, static framing, character centered in frame, '
const NO_VFX = 'no magic effects, no glowing particles, no energy auras, no shockwaves, no spell circles, pure physical body and weapon motion only, '
const CLEAN = 'solid color background, no environment changes, no scene transitions, '

const LOOP_ANCHOR =
  'CRITICAL: this is a seamless loop animation — the character must return to the EXACT starting pose in the final frames. ' +
  'The first frame and last frame must be visually identical in pose, position, and expression so the loop is imperceptible. ' +
  'Ease motion curves at the loop point to avoid any sudden jump or pop. '

const ONCE_TAG = 'one-time animation, does not need to loop. '

function loopPrompt(action: string, duration = '5'): string {
  return `${STYLE}${CAMERA}${CLEAN}${action}, ${NO_VFX}${LOOP_ANCHOR}generate at least ${duration} seconds of smooth animation.`
}

function oncePrompt(action: string, duration = '5'): string {
  return `${STYLE}${CAMERA}${CLEAN}${action}, ${ONCE_TAG}generate at least ${duration} seconds of smooth animation.`
}

// ── Presets ──────────────────────────────────────────────────────────

export const SPRITE_ACTION_PRESETS: SpriteActionPreset[] = [
  // ── Idle ──
  {
    id: 'idle',
    nameZh: '待机', nameEn: 'Idle', icon: '⏱',
    descZh: '富有游戏感的站立呼吸待机', descEn: 'Game-quality idle breathing animation',
    prompt: loopPrompt(
      'game character idle stance animation, the character stands in a relaxed but alert combat-ready pose, ' +
      'subtle rhythmic breathing causes the chest and shoulders to rise and fall gently, ' +
      'hair and cloth accessories sway with a gentle breeze, cape or scarf drifts lazily, ' +
      'the character shifts weight slightly between feet every few seconds, ' +
      'fingers twitch near the weapon grip, eyes blink naturally 1-2 times, ' +
      'the overall feeling is a living, breathing game character waiting for the next command, ' +
      'full of personality and subtle life, not a static mannequin',
    ),
    useEndFrame: true,
  },

  // ── Move ──
  {
    id: 'move',
    nameZh: '移动', nameEn: 'Move', icon: '👣',
    descZh: '原地行走循环（可选视角）', descEn: 'Walking cycle in place (per view)',
    prompt: loopPrompt(
      'game character walk cycle animation, the character walks in place at a steady pace facing forward, ' +
      'proper walk cycle mechanics: right foot contact → right passing → left foot contact → left passing, ' +
      'arms swing naturally opposite to legs, body bobs up slightly during passing positions and down during contacts, ' +
      'keep the vertical bobbing subtle (1-2 pixel equivalent), head stays relatively level, ' +
      'shoulders rotate slightly with each stride, equipment and hair sway with the walking rhythm, ' +
      'constant walking speed throughout, smooth and natural gait',
    ),
    useEndFrame: true,
    viewPrompts: {
      front: loopPrompt(
        'game character front-facing walk cycle animation, the character walks in place toward the camera, ' +
        'proper walk cycle: alternating leg strides with natural arm swing, ' +
        'hips sway subtly side to side, shoulders counter-rotate with each step, ' +
        'body bobs up during passing positions (one leg crosses the other) and down at contact positions (foot strikes ground), ' +
        'equipment dangles and hair bounces with each step rhythm, ' +
        'facial expression is neutral and forward-looking, boots make contact with ground convincingly, ' +
        'constant walking speed, the stride length and timing must be perfectly even so the loop is seamless',
      ),
      side: loopPrompt(
        'game character side-view walk cycle animation facing right, classic 2D side-scroller walking animation, ' +
        'proper walk cycle seen from the side: right foot forward contact → passing position → left foot forward contact → passing position, ' +
        'arms swing forward and back opposite to legs, ' +
        'body rises during passing (legs cross under body) and dips at contact (extended stride), ' +
        'spine has a slight forward lean, head bobs gently, ' +
        'weapon on back or at hip sways with movement, cape or cloth trails behind with walking momentum, ' +
        'the stride speed is constant and even, perfectly timed for seamless looping',
      ),
      back: loopPrompt(
        'game character back-view walk cycle animation facing away from camera, ' +
        'the character walks in place with their back toward the viewer, ' +
        'proper walk cycle mechanics visible from behind: alternating leg strides, shoulder blade movement, ' +
        'spine rotates subtly, back muscles shift with each stride, ' +
        'cape, backpack, or rear equipment sways naturally with walking rhythm, ' +
        'hair bounces at the back of the head, arms swing in opposition to legs, ' +
        'all back-of-character details clearly visible: belt, sheath, armor straps, hair accessories',
      ),
    },
  },

  // ── Attack ──
  {
    id: 'attack',
    nameZh: '攻击', nameEn: 'Attack', icon: '⚔️',
    descZh: '普通攻击循环（蓄力→挥击→回收）', descEn: 'Normal attack cycle (wind-up → strike → recovery)',
    prompt: loopPrompt(
      'game character melee attack animation cycle, three-phase attack motion: ' +
      'Phase 1 WIND-UP: the character pulls weapon back and coils their body, loading power into the strike, slight pause to telegraph the attack, ' +
      'Phase 2 STRIKE: explosive forward slash or thrust with the weapon, fast and powerful, hold the impact frame slightly longer for emphasis, body extends fully, ' +
      'Phase 3 RECOVERY: the character smoothly pulls the weapon back and returns to the original combat stance, ' +
      'no magical effects, only the physical motion of body and weapon, ' +
      'the recovery pose must exactly match the starting pose for seamless loop',
    ),
    useEndFrame: true,
    viewPrompts: {
      front: loopPrompt(
        'game character front-facing attack animation cycle, the character faces the camera and performs a weapon strike, ' +
        'Phase 1: coils back, weapon raised behind or to the side, weight shifts to back foot, ' +
        'Phase 2: explosive forward slash or thrust toward the camera, weapon arc visible, body weight transfers forward, hold impact frame, ' +
        'Phase 3: weapon returns to guard position, body settles back into the starting combat stance, ' +
        'pure physical weapon motion only, no energy effects, ' +
        'the ending pose must perfectly match the beginning pose',
      ),
      side: loopPrompt(
        'game character side-view attack animation cycle facing right, classic 2D action game attack, ' +
        'Phase 1: character leans back, weapon winds up behind the body, anticipation pose, ' +
        'Phase 2: fast horizontal or diagonal slash to the right, weapon sweeps in a wide arc, body lunges forward with the strike, ' +
        'Phase 3: follow-through and recovery, weapon swings past the strike point then pulls back to starting guard stance, ' +
        'pure physical weapon motion, no spell effects, ' +
        'the recovery must return to the exact starting side-stance pose',
      ),
      back: loopPrompt(
        'game character back-view attack animation cycle, the character faces away from camera and strikes forward, ' +
        'Phase 1: weapon winds up, back muscles tense, shoulder blades pull together, ' +
        'Phase 2: powerful forward strike, arm extends, back muscles stretch, weapon impact frame, ' +
        'Phase 3: weapon returns, back relaxes to starting stance, ' +
        'back details clearly visible throughout: armor, cape movement, weapon trajectory seen from behind, ' +
        'the ending pose must match the starting pose exactly',
      ),
    },
  },

  // ── Cast ──
  {
    id: 'cast',
    nameZh: '施法', nameEn: 'Cast', icon: '🪄',
    descZh: '施法吟唱循环（举杖→聚能→释放→回收）', descEn: 'Spellcasting cycle (raise → channel → release → recover)',
    prompt: loopPrompt(
      'game character spellcasting animation cycle, mystical casting gesture sequence: ' +
      'Phase 1 RAISE: the character lifts their weapon or extends hands upward or forward, eyes focused, body enters a channeling pose, ' +
      'Phase 2 CHANNEL: the character holds the casting pose, body trembles slightly with power, robes and hair billow as if affected by invisible energy, fingers spread or weapon glows (subtle), ' +
      'Phase 3 RELEASE: a decisive forward thrust or downward sweep gesture, the casting motion peaks, body extends powerfully, ' +
      'Phase 4 RECOVER: the character draws hands or weapon back, body relaxes to the starting stance, ' +
      'no visible spell projectiles or magic circles, only the physical casting gestures of the body, ' +
      'cloth and hair should react to the implied magical energy buildup',
    ),
    useEndFrame: true,
    viewPrompts: {
      front: loopPrompt(
        'game character front-facing spellcasting animation cycle, the caster faces the camera, ' +
        'RAISE: lifts staff or extends both hands forward, stance widens, expression becomes focused, ' +
        'CHANNEL: holds the pose, robes and hair drift upward as if caught in an updraft, subtle body tremor, ' +
        'RELEASE: decisive forward push or sweeping arm gesture, full body commitment to the cast, ' +
        'RECOVER: arms lower, robes settle, returns to the original standing pose, ' +
        'only physical body motion, no spell effects, ' +
        'ending pose must match starting pose exactly',
      ),
      side: loopPrompt(
        'game character side-view spellcasting animation cycle facing right, ' +
        'RAISE: staff or hands rise to casting position, body leans slightly back to gather power, ' +
        'CHANNEL: holds pose, robes flutter, hair streams to the left as if wind pushes from the casting direction, ' +
        'RELEASE: body thrusts forward, arms extend to the right, decisive casting gesture, ' +
        'RECOVER: pulls back to original side-stance, robes settle, ' +
        'no visible magic projectiles, only the physical casting motion, ' +
        'must return to exact starting pose',
      ),
      back: loopPrompt(
        'game character back-view spellcasting animation cycle facing away from camera, ' +
        'RAISE: arms and weapon lift, back muscles engage, cape rises, ' +
        'CHANNEL: holding pose, cape and fabric billow dramatically, shoulders tense, ' +
        'RELEASE: arms thrust forward, back arches with the effort, cape sweeps forward, ' +
        'RECOVER: arms lower, body relaxes, returns to starting stance viewed from behind, ' +
        'back details visible: spine movement, shoulder blade mechanics, cape flow, ' +
        'ending pose matches starting pose',
      ),
    },
  },

  // ── Hit ──
  {
    id: 'hit',
    nameZh: '受击', nameEn: 'Hit', icon: '⚡',
    descZh: '被击中的反馈动作（可循环）', descEn: 'Taking damage flinch reaction',
    prompt: loopPrompt(
      'game character taking damage hit reaction animation, ' +
      'IMPACT: the character suddenly recoils as if struck by a blow from the front, head snaps back, ' +
      'body lurches backward, arms flinch outward, weapon nearly drops, expression shows pain, ' +
      'STAGGER: the character stumbles back half a step, tries to regain balance, one hand reaches toward the wound area, ' +
      'RECOVERY: gritting teeth with determination, the character steadies themselves, ' +
      'plants feet firmly and returns to the original combat-ready stance, ' +
      'the motion conveys real physical impact and pain but also the warrior\'s resilience, ' +
      'no blood or damage effects, only body reaction motion',
    ),
    useEndFrame: true,
  },

  // ── Die ──
  {
    id: 'die',
    nameZh: '死亡', nameEn: 'Die', icon: '💀',
    descZh: '倒地死亡（不循环）', descEn: 'Fall to the ground and die',
    prompt: oncePrompt(
      'game character death animation, dramatic fall sequence: ' +
      'the character receives a final devastating blow, their body goes rigid for a brief moment, ' +
      'weapon slips from their grasp, knees buckle, ' +
      'the character collapses: first dropping to one knee, then falling sideways or forward, ' +
      'arms go limp, head drops, equipment clatters, cape or cloth drapes over the fallen body, ' +
      'the character lies motionless on the ground in a final resting pose, ' +
      'the death feels weighty and dramatic, not comedic, conveying the gravity of defeat, ' +
      'no resurrection, the character remains down, no blood or gore, ' +
      'only the physical collapse animation',
      '5',
    ),
    useEndFrame: false,
  },

  // ── Ultimate Cinematic (power-awakening intro, fullscreen 16:9) ──
  {
    id: 'ultimate-cinematic',
    nameZh: '大招演出', nameEn: 'Ultimate Cinematic', icon: '🎬',
    descZh: '大招前摇演出（全屏CG，华丽觉醒/变身起手，带背景+特效）',
    descEn: 'Ultimate intro cinematic (fullscreen CG, power-awakening, with background & VFX)',
    isCinematic: true,
    prompt:
      'anime power-awakening cinematic, 16:9 widescreen, rich detailed environment background, ' +
      'inspired by Genshin Impact elemental burst intro and anime transformation sequences, ' +
      'this is a character power-awakening portrait sequence — the character does NOT move from their position, ' +
      'the character NEVER performs any physical action, the character stays in one place the entire time: ' +
      'PHASE 1 — STILLNESS (0-1s): the world around the character darkens and time seems to slow down, ' +
      'the character stands still with eyes closed in serene concentration, ' +
      'a gentle breeze begins to stir their hair and clothes, ' +
      'faint luminous particles drift upward from the ground like floating embers, ' +
      'PHASE 2 — AWAKENING (1-3s): brilliant energy aura erupts around the character, ' +
      'the character\'s hair rises and flows upward dramatically as if submerged in water, ' +
      'radiant light emanates from the character\'s body, clothes and cape billow majestically, ' +
      'glowing sigils, orbiting rune circles, and ethereal symbols materialize in the air around them, ' +
      'luminous particles swirl in an ascending spiral, the background shifts in color and atmosphere, ' +
      'lens flare and god-rays stream from behind the character, ' +
      'PHASE 3 — CLIMAX (3-5s): camera slowly dollies in toward the character\'s face, ' +
      'the character opens their eyes — irises glow with supernatural brilliance, ' +
      'an expression of absolute resolve and overwhelming power, ' +
      'energy aura reaches maximum intensity, the entire frame vibrates with contained power, ' +
      'hair and fabric flow in dramatic slow-motion, the video holds on this breathtaking portrait, ' +
      'the character is still, poised, transcendent — a living icon of power frozen at its zenith, ' +
      'NO physical movement, NO swinging, NO running, NO jumping — only the character standing as power envelops them, ' +
      'the background must be a detailed environment (forest, ruins, sky, temple — NOT a solid color), ' +
      'fullscreen cinematic meant to be displayed as a game cutscene overlay, ' +
      'generate 3-5 seconds.',
    useEndFrame: false,
    duration: '5',
    needsDesignImage: true,
    viewPrompts: {
      front:
        'anime power-awakening cinematic portrait, 16:9 widescreen, rich environment background, ' +
        'the character faces the camera, centered in frame, does NOT move from position: ' +
        'begins with eyes closed, serene stillness, world darkens around them, gentle breeze stirs hair, ' +
        'luminous energy aura ignites — hair rises and flows upward, clothes billow outward, ' +
        'glowing sigils and orbiting rune circles appear, radiant light pours from the body, ' +
        'particles spiral upward, background atmosphere shifts dramatically, god-rays from behind, ' +
        'camera slowly dollies in toward the face, the character opens their eyes — irises blaze with light, ' +
        'expression of absolute power and unwavering resolve, energy peaks in blinding intensity, ' +
        'hair and fabric drift in slow-motion, a breathtaking power portrait held at its zenith, ' +
        'NO physical action — only standing still as power awakens, ' +
        'detailed environment background, fullscreen overlay, generate 3-5 seconds.',
      side:
        'anime power-awakening cinematic portrait, 16:9 widescreen, rich environment background, ' +
        'dramatic side-profile facing right, the character does NOT move from position: ' +
        'begins in calm stillness, eyes closed, wind gently stirs hair and cape, world dims, ' +
        'energy aura blooms — hair lifts and streams to the left in slow-motion, cape unfurls majestically, ' +
        'glowing orbiting rune circles frame the silhouette, radiant light outlines the profile, ' +
        'particles rise in spirals, background color shifts, dramatic rim-light along the silhouette edge, ' +
        'camera holds on the powerful side-profile, the character\'s eye opens — a flash of supernatural light, ' +
        'the silhouette becomes an iconic portrait of awakened power, still and transcendent, ' +
        'NO physical action — only standing as power envelops them, ' +
        'detailed environment background, fullscreen overlay, generate 3-5 seconds.',
      back:
        'anime power-awakening cinematic portrait, 16:9 widescreen, rich environment background, ' +
        'the character\'s back faces the camera, does NOT move from position: ' +
        'begins in stillness, head slightly bowed, cape and hair hang still, the world darkens, ' +
        'energy aura erupts outward — cape and hair rise and billow toward the camera dramatically, ' +
        'brilliant light radiates from the character\'s body creating a glowing rim-light silhouette, ' +
        'rune circles and sigils orbit outward, particles stream past the camera creating depth, ' +
        'the character lifts their head — a halo of light crowns them from behind, ' +
        'the back-silhouette becomes an awe-inspiring icon against the transformed environment, ' +
        'NO physical action — only standing as power radiates outward, ' +
        'detailed environment background, fullscreen overlay, generate 3-5 seconds.',
    },
  },

  // ── Ultimate Action (in-game, NO VFX, loopable) ──
  {
    id: 'ultimate',
    nameZh: '大招动作', nameEn: 'Ultimate Action', icon: '✨',
    descZh: '游戏内大招攻击动作（无特效，可循环，用于序列帧）',
    descEn: 'In-game ultimate attack motion (no VFX, loopable, for sprite extraction)',
    prompt: loopPrompt(
      'game character ultimate attack combo animation, powerful multi-hit signature attack sequence: ' +
      'Phase 1 CHARGE (0-0.8s): the character enters a dramatic charge-up pose, body coils with tension, weapon pulled back to maximum range, ' +
      'feet planted wide, muscles tensed, a brief powerful anticipation beat, ' +
      'Phase 2 COMBO (0.8-3.5s): explosive three-strike combination attack — ' +
      'Strike 1: a wide sweeping horizontal slash or thrust, body rotates with the force, weapon arcs through the air, ' +
      'Strike 2: an upward launching attack or leaping overhead chop, the character\'s feet may briefly leave the ground, ' +
      'Strike 3: a devastating finishing blow — a heavy downward slam, spinning roundhouse slash, or piercing stab, ' +
      'each hit has clear physical impact with the weapon, the body commits fully to every strike, ' +
      'Phase 3 RECOVER (3.5-5s): after the final devastating blow, the character smoothly transitions back to the original standing combat stance, ' +
      'weapon returns to guard position, breathing slightly heavier, ' +
      'this is PURE PHYSICAL combat motion — absolutely no magic effects, no glowing, no particles, no energy auras, ' +
      'only the raw power of body and weapon technique',
      '5',
    ),
    useEndFrame: true,
    duration: '5',
    needsDesignImage: true,
    viewPrompts: {
      front: loopPrompt(
        'game character front-facing ultimate combo, three powerful strikes toward the camera: ' +
        'CHARGE: dramatic wide stance, weapon pulled back, eyes locked forward, raw physical tension, ' +
        'Strike 1: lunging horizontal sweep, weapon arcs across the frame, ' +
        'Strike 2: jumping upward slash or rising uppercut strike, feet leave the ground briefly, ' +
        'Strike 3: devastating downward slam or forward thrust, maximum force, ' +
        'RECOVER: lands, weapon returns to guard, settles into original starting stance, ' +
        'PURE physical weapon combat, no magic effects, no glowing, no particles',
        '5',
      ),
      side: loopPrompt(
        'game character side-view ultimate combo facing right, classic 2D action game super attack: ' +
        'CHARGE: weapon drawn back, body coils, anticipation beat, ' +
        'Strike 1: wide rightward horizontal slash, weapon trails through the air, ' +
        'Strike 2: leaping overhead chop or spinning mid-air attack, ' +
        'Strike 3: landing with a ground-shaking finishing blow, weapon slams down or thrusts forward, ' +
        'RECOVER: weapon back to guard position, returns to original side-stance, ' +
        'PURE physical weapon combat, no magic effects, no glowing, no particles',
        '5',
      ),
      back: loopPrompt(
        'game character back-view ultimate combo facing away, powerful strikes viewed from behind: ' +
        'CHARGE: back muscles tense, weapon raised, anticipation, ' +
        'Strike 1: wide sweeping slash, back rotates with the force, ' +
        'Strike 2: jumping spin attack or overhead strike, viewed from behind, ' +
        'Strike 3: devastating finishing blow, full body extension, ' +
        'RECOVER: back to original stance, weapon lowered to guard, ' +
        'PURE physical weapon combat, no magic effects, no glowing, no particles',
        '5',
      ),
    },
  },
]

// ── Dynamic context-aware prompt builder ────────────────────────────

interface CharacterContext {
  name?: string
  charClass?: string
  combatType?: 'melee' | 'ranged'
  worldSetting?: string
  gender?: 'male' | 'female'
  extraDesc?: string
}

const CLASS_WEAPON_MAP: Record<string, string> = {
  '剑士': 'longsword slashes and precise thrusting techniques',
  '狂战士': 'massive greatsword devastating overhead cleaves and wide horizontal sweeps',
  '魔法师': 'arcane staff channeling destructive spell blasts and magical shockwaves',
  '元素师': 'elemental orb conjuring storms of fire, ice, and lightning',
  '弓箭手': 'precision bow shots and rapid-fire arrow volleys',
  '枪手': 'dual pistol rapid-fire and explosive charged shots',
  '刺客': 'twin daggers lightning-fast backstab combos and vanishing strikes',
  '暗影刺客': 'shadow-infused blade teleportation attacks and phantom slash chains',
  '格斗家': 'martial arts rapid punch-kick combos and devastating uppercuts',
  '圣骑士': 'holy sword radiant smites and shield-bash counter-attacks',
  '牧师': 'divine staff holy light beams and sacred barrier conjuration',
  '召唤师': 'summoning tome conjuring spirit beasts and commanding minions to attack',
  '忍者': 'kunai throwing and rapid ninjutsu hand-seal spell techniques',
  '武僧': 'chi-powered palm strikes and spinning kick combinations',
  '机械师': 'mechanical gadget deployment and energy cannon barrage',
  '炼金术士': 'potion flask throwing explosive chemical reactions and transmutation',
  '驱魔师': 'sacred talisman throwing and demon-sealing ritual strikes',
  '吟游诗人': 'magical instrument sound-wave attacks and enchanting melody bursts',
}

const CLASS_WEAPON_PHYSICAL_MAP: Record<string, string> = {
  '剑士': 'precise sword slashes — horizontal sweep, rising cut, and a powerful downward cleave',
  '狂战士': 'brutal greatsword strikes — wide horizontal cleave, overhead slam, and spinning full-body slash',
  '魔法师': 'staff strikes — staff thrust, sweeping staff swing, and overhead slam using the staff as a polearm',
  '元素师': 'rapid hand gestures and staff twirls — channeling pose, wide arm sweep, and decisive forward thrust',
  '弓箭手': 'rapid bow draw and release — three quick successive arrow shots followed by a jumping backward flip shot',
  '枪手': 'dual pistol rapid fire — rolling dodge, dual-aim forward barrage, and finishing charged shot pose',
  '刺客': 'twin dagger flurry — quick cross-slash, spinning backstab, and lunging double stab',
  '暗影刺客': 'shadow blade combo — vanishing slash reappear, cross-blade X-strike, and leaping downward stab',
  '格斗家': 'martial arts combo — rapid one-two punch, spinning roundhouse kick, and rising uppercut',
  '圣骑士': 'sword and shield combo — shield bash, rising holy slash, and heavy overhead two-handed strike',
  '牧师': 'staff channeling gestures — raising staff skyward, wide circular sweep, and forward thrust',
  '召唤师': 'tome and gesture combo — book held high, wide beckoning arm sweep, and forward commanding point',
  '忍者': 'ninjutsu combo — kunai slash, spinning shuriken throw motion, and diving aerial strike',
  '武僧': 'chi martial arts — rapid palm strikes, spinning crescent kick, and powerful double-palm thrust',
  '机械师': 'gadget deployment combo — throwing device, turret activation pose, and cannon arm forward blast pose',
  '炼金术士': 'flask throwing sequence — overhand throw, underhand splash, and wide area scatter throw',
  '驱魔师': 'talisman combat — rapid talisman throw, sweeping seal gesture, and forward sealing palm strike',
  '吟游诗人': 'instrument combat — striking chord pose, wide strumming sweep, and dramatic finishing note pose',
}

const WORLD_STYLE_MAP: Record<string, string> = {
  'medieval-fantasy': 'medieval fantasy magical energy, glowing runes and arcane sigils',
  'dark-fantasy': 'dark gothic energy, crimson and violet dark magic, bone and shadow motifs',
  'eastern-fantasy': 'eastern xianxia qi energy, jade light trails, lotus petals and spirit flames',
  'cyberpunk': 'neon cyberpunk holographic effects, digital glitch particles, circuit-pattern energy',
  'sci-fi': 'sci-fi plasma energy, laser grid effects, futuristic holographic displays',
  'post-apocalypse': 'radioactive energy glow, rust-colored particle explosions, wasteland debris',
  'steampunk': 'steam-powered brass mechanical effects, gear-shaped energy bursts, copper sparks',
  'modern-urban': 'urban supernatural energy, street-light colored aura, modern magical effects',
  'pirate-nautical': 'ocean-themed water and storm effects, tidal wave energy, sea-spray particles',
  'mythology': 'divine mythological power, golden god-rays, celestial constellation effects',
}

/**
 * Build a context-aware prompt using character profile info.
 * Returns null for presets that don't benefit from context (use static prompt instead).
 */
export function buildContextPrompt(
  presetId: string,
  view: CharacterView,
  ctx: CharacterContext,
): string | null {
  const charName = ctx.name || 'the character'
  const genderWord = ctx.gender === 'female' ? 'heroine' : 'hero'
  const combatRange = ctx.combatType === 'ranged' ? 'ranged projectile' : 'close-range melee'
  const extraInfo = ctx.extraDesc ? `, character traits: ${ctx.extraDesc}` : ''

  // ── Ultimate Cinematic (power-awakening portrait, with VFX + background) ──
  if (presetId === 'ultimate-cinematic') {
    const worldStyle = (ctx.worldSetting && WORLD_STYLE_MAP[ctx.worldSetting]) || 'magical energy effects'
    const worldBg = (ctx.worldSetting && WORLD_STYLE_MAP[ctx.worldSetting]?.split(',')[0]) || 'mystical energy'

    const characterDesc =
      `This is ${charName}'s power-awakening cinematic, ` +
      `a ${genderWord}${extraInfo}. `

    const base =
      'anime power-awakening cinematic portrait, 16:9 widescreen, rich environment background, ' +
      characterDesc +
      `The character does NOT move from position — NO physical action at all. ` +
      `Energy style: ${worldStyle}. `

    const prompts: Record<CharacterView, string> = {
      front:
        base +
        `${charName} faces the camera centered in a ${worldBg} themed environment, ` +
        'begins with eyes closed in serene concentration, world darkens, gentle breeze stirs hair, ' +
        `${worldBg} aura ignites — hair rises and flows upward, clothes billow, ` +
        'glowing sigils and rune circles materialize, radiant light pours from the body, ' +
        'particles spiral upward, background atmosphere shifts, god-rays stream from behind, ' +
        `camera dollies toward ${charName}'s face, eyes open — irises blaze with ${worldBg} light, ` +
        'expression of absolute power and resolve, energy peaks in blinding intensity, ' +
        'a breathtaking power portrait held at its zenith, NO movement, only standing still, ' +
        'detailed environment background, fullscreen overlay, generate 3-5 seconds.',
      side:
        base +
        `Side profile facing right, ${charName} in a ${worldBg} themed environment, ` +
        'eyes closed, calm stillness, wind gently stirs hair and cape, world dims around them, ' +
        `${worldBg} aura blooms — hair lifts and streams to the left, cape unfurls, ` +
        'rune circles frame the silhouette, rim-light along the profile edge, particles rise, ' +
        `${charName}'s eye opens — a flash of ${worldBg} light, ` +
        'the silhouette becomes an iconic portrait of awakened power, still and transcendent, ' +
        'NO movement, detailed environment background, fullscreen overlay, generate 3-5 seconds.',
      back:
        base +
        `Back to camera, ${charName} in a ${worldBg} themed environment, ` +
        'head slightly bowed in stillness, cape and hair hang still, the world darkens, ' +
        `${worldBg} aura erupts — cape and hair rise and billow toward the camera, ` +
        'brilliant light creates a glowing rim-light silhouette from behind, ' +
        'rune circles orbit outward, particles stream past the camera, ' +
        `${charName} lifts head — a halo of ${worldBg} light crowns them, ` +
        'an awe-inspiring silhouette against the transformed environment, ' +
        'NO movement, detailed environment background, fullscreen overlay, generate 3-5 seconds.',
      idle:
        base +
        `${charName} faces the camera in a relaxed idle stance in a ${worldBg} themed environment, ` +
        'gentle breathing animation, subtle weight shifting, hair and clothes sway in a light breeze, ' +
        `${worldBg} ambient glow, calm and composed expression, ` +
        'NO movement, detailed environment background, fullscreen overlay, generate 3-5 seconds.',
    }
    return prompts[view]
  }

  // ── Ultimate Action (in-game, NO VFX) ──
  if (presetId === 'ultimate') {
    const weaponPhysical = (ctx.charClass && CLASS_WEAPON_PHYSICAL_MAP[ctx.charClass]) || 'powerful three-strike weapon combo'

    const characterDesc =
      `This is ${charName}'s ultimate attack combo, a ${genderWord} fighting with ${weaponPhysical}${extraInfo}. `

    const base =
      `${STYLE}${CAMERA}${CLEAN}` +
      'game character ultimate attack combo animation, ' +
      characterDesc +
      'PURE PHYSICAL combat — absolutely no magic effects, no glowing, no particles, no energy, ' +
      'only raw weapon and body technique. '

    const prompts: Record<CharacterView, string> = {
      front:
        base +
        `CHARGE: ${charName} faces the camera in a wide power stance, weapon drawn back, raw physical tension, ` +
        `COMBO: ${weaponPhysical}, ` +
        'each strike shows full body commitment and physical weapon impact, ' +
        `RECOVER: returns to the exact starting combat stance. ` +
        `${LOOP_ANCHOR}generate at least 5 seconds.`,
      side:
        base +
        `CHARGE: side view facing right, weapon drawn back, body coils, ` +
        `COMBO: ${weaponPhysical}, ` +
        'classic 2D action game super attack viewed from the side, ' +
        `RECOVER: returns to original side-stance. ` +
        `${LOOP_ANCHOR}generate at least 5 seconds.`,
      back:
        base +
        `CHARGE: back to camera, muscles tense, weapon raised, ` +
        `COMBO: ${weaponPhysical}, ` +
        'powerful strikes viewed from behind with visible back mechanics, ' +
        `RECOVER: returns to original stance. ` +
        `${LOOP_ANCHOR}generate at least 5 seconds.`,
      idle:
        base +
        `IDLE: ${charName} faces the camera in a relaxed combat-ready stance, ` +
        'subtle weight shift, weapon held loosely at the ready, calm breathing, ' +
        `RECOVER: returns to idle stance. ` +
        `${LOOP_ANCHOR}generate at least 5 seconds.`,
    }
    return prompts[view]
  }

  return null
}
