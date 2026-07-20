/**
 * Body-type / species presets for protagonist design.
 *
 * Why this exists：默认管线把所有主角当成「人形 RPG 英雄」处理（双足、有面部、穿鞋、左右镜像）。
 * 但独立游戏里大量主流主角是 *非人形*：
 *   - 空洞骑士 Hornet（昆虫骑士）
 *   - Ori（光之灵 / 小型奇幻生物）
 *   - Tunic 小狐狸 / 大神狼（兽类）
 *   - Hyper Light Drifter / Risk of Rain（机械 / 半机械）
 *   - Cuphead / Kirby（卡通吉祥物）
 *
 * 这套预设给概念图、设定图、像素动画三个 prompt 阶段提供一致的「物种语言」，
 * 并把 18 种职业（剑士/法师/...）映射到符合该形态的描述词，避免 prompt 里
 * 残留「male human warrior with boots」这种与形态冲突的人体假设。
 */

export type BodyType =
  | 'humanoid'
  | 'insectoid'
  | 'spirit'
  | 'beast'
  | 'mecha'
  | 'mascot'

export interface BodyTypePreset {
  id: BodyType
  icon: string
  /** 中文短名（左栏 chip 显示） */
  label: string
  /** 中文一句话 hint（chip tooltip 与状态条） */
  hint: string
  /** 中文：知名参考作品，喂给 brief 给 Claude 看 */
  references: string

  // ── English prompt fragments — used directly in image-gen prompts ──

  /** 物种短描述，会替代「1girl/1boy human」类的 solo 描述。例：`small chitinous bug knight, agile bipedal insect`。 */
  speciesEn: string
  /** 头身比 / 整体比例线。例：`compact 2.5-head silhouette, oversized cloak swirling around small body`。 */
  proportionsEn: string
  /** 解剖结构提示，告诉模型「眼睛是怎样的、有没有面部、几条腿、有没有手」。 */
  anatomyEn: string
  /** 剪影 / 标志性视觉元素，避免泛化。 */
  silhouetteEn: string
  /** Negative prompt — 必须避免的内容。 */
  negativeEn: string

  /** 是否抑制「性别」「年龄」「鞋子」「面部细节」这类只对人形有意义的字段。 */
  suppressGenderInPrompt: boolean
  suppressFootwear: boolean
  suppressFacialDetail: boolean

  /**
   * 职业 → 该形态下的英文描述词。覆盖默认的 `CLASS_EN[zhClass]`。
   * 每个 key 必须是 CharacterDesign 里 CLASS_OPTIONS 的 18 个职业之一。
   * 未列出的职业会回退到「{species} {classEn}」拼接。
   */
  professionRemap: Record<string, string>
}

/* eslint-disable @typescript-eslint/quotes */

const HUMANOID: BodyTypePreset = {
  id: 'humanoid',
  icon: '🧑',
  label: '人形',
  hint: '默认 — 双足人形（人 / 精灵 / 半兽人）',
  references: '原神 / DNF / LOL / 英雄联盟 / 大多数 JRPG',

  speciesEn: 'humanoid bipedal hero',
  proportionsEn: '4 to 5 head-to-body ratio, anatomically correct human proportions',
  anatomyEn: 'two arms, two legs, expressive human face, hands with five fingers, footwear visible',
  silhouetteEn: 'classic action-RPG hero silhouette with weapon and armor',
  negativeEn: '',

  suppressGenderInPrompt: false,
  suppressFootwear: false,
  suppressFacialDetail: false,

  // Humanoid 不需要 remap（CLASS_EN 默认就是给人形用的），留空表走默认。
  professionRemap: {},
}

const INSECTOID: BodyTypePreset = {
  id: 'insectoid',
  icon: '🪲',
  label: '昆虫骑士',
  hint: 'Hollow Knight 类 — 几丁质外壳的小型昆虫战士',
  references: '空洞骑士 Hollow Knight / Hornet / Bug Fables / Webbed',

  speciesEn:
    'small chitinous bug-knight protagonist in the visual lineage of Hollow Knight, ' +
    'matte exoskeleton plates, ink-wash silhouette, voidlike interior',
  proportionsEn:
    'compact 2.5-head silhouette, oversized cloak or carapace skirt swirling around a small rounded body, ' +
    'short stubby limbs that read clearly even at low resolution',
  anatomyEn:
    'no human face — instead a smooth chitin mask with two solid void eyes (no pupils, no nose, no mouth), ' +
    'two thin segmented arms ending in claw-mitts (NOT five-finger hands), two stubby legs ending in pointed chitin tips ' +
    '(NO shoes, NO boots), optional pair of antennae or horns on the helmet shell',
  silhouetteEn:
    'distinctive sharp horned helmet, flowing tattered cloak, pale-on-dark contrast — ' +
    'the silhouette must be readable as a single iconic shape (think Knight, Hornet, Quirrel)',
  negativeEn:
    'no human anatomy, no human face, no nose, no mouth, no five-finger hands, no shoes, no boots, ' +
    'no realistic insect photo-texture, no oversized buggy compound eyes',

  suppressGenderInPrompt: true,
  suppressFootwear: true,
  suppressFacialDetail: true,

  professionRemap: {
    剑士:    'bug-knight wielding a slim nail-blade, classic Hollow Knight nail silhouette',
    狂战士:  'feral horned bug-warrior with a heavy serrated nail and shredded cloak',
    魔法师:  'cloaked spell-caster bug clutching a glowing soul vessel, swirling void energy',
    元素师:  'elemental bug-shaman with crystalline horns and orbiting elemental motes',
    弓箭手:  'quick-stepping bug archer with a thread-strung beetle bow and quiver of stingers',
    枪手:    'tiny tinker-bug operating a brass needle-cannon strapped to its back',
    刺客:    'agile silk-cloaked stinger-assassin reminiscent of Hornet, twin needles drawn',
    暗影刺客: 'shadow-shrouded void-bug assassin trailing inky tendrils, silent claw-blades',
    格斗家:  'stocky armored beetle-brawler with reinforced carapace gauntlets',
    圣骑士:  'radiant lumafly knight in pale soul-engraved chitin plate, hallowed nail',
    牧师:    'gentle moth-priest in flowing wing-mantle, glowing soul lantern raised',
    召唤师:  'pale bug-conjurer surrounded by tiny attendant grub spirits',
    忍者:    'lithe silk-shroud bug-shinobi, two slim nails and binding thread',
    武僧:    'meditating mantis-monk in simple wrap-cloak, bare claw stance',
    机械师:  'tinker-grub with a brass-cog backpack and tiny mechanical drones',
    炼金术士: 'soul-flask alchemist bug with bubbling vials clipped to its carapace',
    驱魔师:  'voidsick exorcist bug with a dream-nail and prayer-wreath antennae',
    吟游诗人: 'cricket-bard with a tiny string-fiddle made from a husk',
  },
}

const SPIRIT: BodyTypePreset = {
  id: 'spirit',
  icon: '✨',
  label: '灵 / 小生物',
  hint: 'Ori 类 — 发光的小型奇幻精灵 / 灵兽',
  references: 'Ori and the Blind Forest / Spiritfarer / Hob / Gris',

  speciesEn:
    'small luminous forest-spirit protagonist in the visual lineage of Ori, ' +
    'soft glowing fur or feather coat, ethereal trailing light',
  proportionsEn:
    'tiny cat-or-fawn-sized creature, big head and big eyes, slender limbs, ' +
    'gracile silhouette that reads against any background',
  anatomyEn:
    'large expressive shining eyes (the only facial feature that matters), no human nose / mouth / lips, ' +
    'four delicate paws or two paws + two clawed hands, long expressive tail or trailing wisp, ' +
    'optional antlers / fronds / leaf-tipped ears, NO shoes',
  silhouetteEn:
    'soft inner glow rim-lighting the silhouette, drifting motes of light, ' +
    'organic curves over hard angles, fairytale storybook readability',
  negativeEn:
    'no human face, no human anatomy, no clothes covering the body, no shoes, ' +
    'no realistic photo-fur, no creepy uncanny baby-doll proportions',

  suppressGenderInPrompt: true,
  suppressFootwear: true,
  suppressFacialDetail: true,

  professionRemap: {
    剑士:    'spirit beast with a shard-of-light blade floating beside it',
    狂战士:  'feral glowing spirit, fur bristling, claws bared and trailing embers',
    魔法师:  'arcane spirit weaving glyphs of light in the air',
    元素师:  'elemental spirit haloed by drifting shards of fire, ice, and wind',
    弓箭手:  'spirit archer with a bow woven from living branches and starlight arrows',
    枪手:    'spirit beast with a crystalline focus that fires beams of light',
    刺客:    'fox-shaped shadow spirit fading in and out of the underbrush',
    暗影刺客: 'umbral spirit cloaked in living shadow, hollow glowing eyes',
    格斗家:  'stocky stone-bound spirit with glowing-rune knuckles',
    圣骑士:  'sacred spirit-stag wearing a halo of golden light and a shard-shield',
    牧师:    'healing spirit cradling a flower of pure light',
    召唤师:  'small spirit surrounded by drifting will-o-wisp companions',
    忍者:    'mist spirit dispersing into petals between strikes',
    武僧:    'serene spirit-cub balanced on one paw, palm of light raised',
    机械师:  'spirit fused with delicate clockwork heartwood limbs',
    炼金术士: 'spirit brewing motes of light from glass vials of dewstuff',
    驱魔师:  'spirit-shaman with a wreath of warding sigils',
    吟游诗人: 'spirit minstrel with a harp of silver thread, music as visible light',
  },
}

const BEAST: BodyTypePreset = {
  id: 'beast',
  icon: '🦊',
  label: '兽形',
  hint: '兽人 / 拟人兽 — Tunic 小狐狸、大神 Okami 类',
  references: 'Tunic / 大神 Okami / Stray / Solatorobo / Klonoa',

  speciesEn:
    'anthropomorphic animal protagonist (fox / wolf / cat / lynx archetype), ' +
    'wearing simple adventurer gear, equally comfortable on two legs or four',
  proportionsEn:
    '3 to 3.5 head-to-body ratio, expressive snout-and-ears head shape, ' +
    'slender limbs with paw-hands that can grip a weapon or item',
  anatomyEn:
    'animal head with snout, alert pointed ears, large clear eyes, fur coat (single or two-tone), ' +
    'four-fingered paw-hands, paw-feet (NO shoes — bare paws), long expressive tail',
  silhouetteEn:
    'distinctive ear-and-tail silhouette, simple cloak / scarf / harness over fur, ' +
    'storybook indie readability — clean shapes, limited palette',
  negativeEn:
    'no human face, no human nose, no human hair, no shoes, no boots, ' +
    'no full human clothing covering the entire body, no realistic photo-fur',

  suppressGenderInPrompt: true,
  suppressFootwear: true,
  suppressFacialDetail: true,

  professionRemap: {
    剑士:    'fox-knight with a slim curved blade and a tabard',
    狂战士:  'wolf-warrior with savage twin axes, fur bristling, war-paint stripes',
    魔法师:  'lynx-mage in starry robe holding a glowing rune-stone',
    元素师:  'cat-shaman with elemental sigils painted on its fur',
    弓箭手:  'fox-ranger with a recurve bow and feathered quiver across the back',
    枪手:    'otter-gunslinger with a brass single-shot and bandolier',
    刺客:    'lithe black-fur cat with twin daggers, hooded scarf',
    暗影刺客: 'shadow-wolf assassin trailing dark mist, eyes glowing pale',
    格斗家:  'bear-brawler with banded fur-wraps on knuckles',
    圣骑士:  'noble lion-paladin in light gilded plate, mane like a halo',
    牧师:    'kind deer-priest with a wreath of leaves, wooden staff topped with a sun symbol',
    召唤师:  'kitsune-summoner with floating fox-fire spirits at its side',
    忍者:    'tanuki ninja in indigo wrap, leaf-cloak shimmer-camouflage',
    武僧:    'panda-monk in patched robe, calm balanced stance',
    机械师:  'raccoon tinker with a pack of brass tools and a mounted spyglass',
    炼金术士: 'badger alchemist with vials clipped to a leather apron',
    驱魔师:  'wolf-exorcist with prayer beads and a scroll-binding talisman',
    吟游诗人: 'mouse-bard with a tiny lute and a feathered cap',
  },
}

const MECHA: BodyTypePreset = {
  id: 'mecha',
  icon: '🤖',
  label: '机械 / 半机械',
  hint: 'Hyper Light Drifter / Risk of Rain — 小型机械主角',
  references: 'Hyper Light Drifter / Risk of Rain / NieR / Solar Ash 机械同伴',

  speciesEn:
    'small humanoid-shape mech protagonist with hard-surface plate construction, ' +
    'visible joint pivots, single luminous visor or eye-slit instead of a face',
  proportionsEn:
    '3 to 4 head-to-body ratio, blocky armor over articulated frame, ' +
    'silhouette readable as a single iconic mech shape',
  anatomyEn:
    'no organic face — only a single glowing visor band or T-slit eye, no mouth, no nose, ' +
    'segmented metallic arms with three- or four-finger gripper hands, articulated metal feet ' +
    '(NOT shoes — exposed mech footplates with toe articulation), exposed cabling at joints',
  silhouetteEn:
    'crisp hard-surface paneling, two-tone palette (matte body + accent emissive trim), ' +
    'one strong rim-emissive light source from the visor or chest core',
  negativeEn:
    'no organic skin, no organic face, no human eyes, no realistic human anatomy under armor, ' +
    'no realistic photo-mech texture, no shoes, no boots',

  suppressGenderInPrompt: true,
  suppressFootwear: true,
  suppressFacialDetail: true,

  professionRemap: {
    剑士:    'mech-drifter wielding a humming energy-blade, single rim-lit visor',
    狂战士:  'berserker-frame mech with two oversized chain-blades, scarred plating',
    魔法师:  'caster-frame mech with floating focus prisms orbiting its head',
    元素师:  'elemental-core mech, swappable element canisters glowing on its back',
    弓箭手:  'sniper-frame mech with a folding rail-bow and HUD reticle visor',
    枪手:    'gunslinger mech with twin holstered sidearms and a chest reload coil',
    刺客:    'thin agile recon mech with cloaking shimmer and twin pulse-blades',
    暗影刺客: 'voidframe assassin mech leaking dark vapor from its joints, silent stride',
    格斗家:  'heavy bruiser frame with reinforced piston-arms',
    圣骑士:  'paladin frame in white-gold plate, halo emitter ring above the head',
    牧师:    'medic frame with a chest-mounted nano-emitter, soothing teal glow',
    召唤师:  'commander mech with deployable drone-companions',
    忍者:    'compact stealth-frame, retractable wrist-blades and grapnel cables',
    武僧:    'monk-frame focused on hand-to-hand strikes, prayer-wheel core spinning',
    机械师:  'engineer mech festooned with tools, secondary repair-arm emerging from the back',
    炼金术士: 'reactor-frame mech with bubbling alchemical canisters lining the spine',
    驱魔师:  'exorcism-frame with rune-engraved plates and a hex-binding visor',
    吟游诗人: 'minstrel-frame with a wrist-mounted resonator that visualizes sound waves',
  },
}

const MASCOT: BodyTypePreset = {
  id: 'mascot',
  icon: '🐤',
  label: '卡通吉祥物',
  hint: 'Cuphead / Kirby / Hat in Time — 圆润 Q 萌的卡通主角',
  references: 'Cuphead / Kirby / Hat in Time / Pizza Tower',

  speciesEn:
    'rounded cartoon-mascot protagonist in a vintage rubber-hose / 30s cartoon style, ' +
    'simple iconic head shape (cup, blob, ball, animal head) with a clear single signature feature',
  proportionsEn:
    '2 to 2.5 head-to-body ratio, big head, tiny body, big white-glove hands, big shoes, ' +
    'silhouette dominated by the head shape',
  anatomyEn:
    'simple cartoon dot eyes (or pie-cut eyes for rubber-hose), small mouth, ' +
    'noodly rubber-hose limbs (no visible joints), classic four-finger white-glove hands, ' +
    'big rounded cartoon shoes — this IS a body type that DOES wear shoes',
  silhouetteEn:
    'one signature head accessory (cup straw / hat / antenna / bowtie), bold black outlines, ' +
    'flat cel-shaded fills with crisp 30s vintage palette',
  negativeEn:
    'no realistic anatomy, no detailed human face, no realistic textures, no gritty rendering, ' +
    'no realistic proportions, no body horror, no creepy proportions',

  suppressGenderInPrompt: true,
  suppressFootwear: false, // 卡通主角通常就有大鞋子
  suppressFacialDetail: false,

  professionRemap: {
    剑士:    'cup-headed mascot wielding an oversized cartoon sword, white-glove grip',
    狂战士:  'angry cartoon mascot with a comically huge club twice its size',
    魔法师:  'pointy-hat cartoon wizard mascot conjuring star-burst spell sparkles',
    元素师:  'cartoon mascot juggling fire / ice / lightning balls in white-glove hands',
    弓箭手:  'cartoon mascot with a tiny cupid-style bow and exaggerated arrow',
    枪手:    'cartoon mascot with a giant cartoon revolver, smoke puffs',
    刺客:    'sneaky cartoon mascot tip-toeing with a comically large dagger',
    暗影刺客: 'spooky shadow mascot with hollow white pie-eyes, drippy ink form',
    格斗家:  'short-tempered cartoon brawler mascot with red boxing gloves',
    圣骑士:  'cartoon paladin mascot with a halo and heart-shield, clean primary palette',
    牧师:    'gentle cartoon mascot with a tiny halo and a healing star wand',
    召唤师:  'cartoon mascot with summon-circle pop and tiny chibi minions',
    忍者:    'wrap-headband cartoon mascot ninja, smoke-bomb puff transitions',
    武僧:    'meditating cartoon mascot, cross-legged hover with sparkles',
    机械师:  'tinker mascot with cartoon wrench and bouncing spring gadgets',
    炼金术士: 'mascot mixing bubbling cartoon potions in oversized flask',
    驱魔师:  'cartoon mascot with cross-shaped wards and pop-up ghost speech bubbles',
    吟游诗人: 'cartoon mascot with banjo or trumpet, music notes floating above head',
  },
}

/* eslint-enable @typescript-eslint/quotes */

export const BODY_TYPE_PRESETS: BodyTypePreset[] = [
  HUMANOID,
  INSECTOID,
  SPIRIT,
  BEAST,
  MECHA,
  MASCOT,
]

const BY_ID: Record<string, BodyTypePreset> = Object.fromEntries(
  BODY_TYPE_PRESETS.map(p => [p.id, p]),
)

/**
 * Look up a preset; falls back to humanoid for unknown / legacy values.
 * Always returns a real preset — callers don't need null checks.
 */
export function getBodyType(id: string | undefined | null): BodyTypePreset {
  if (!id) return HUMANOID
  return BY_ID[id] ?? HUMANOID
}

/**
 * For a (bodyType, chineseClass) pair, return the English descriptor to use
 * in the image-gen prompt. Falls back to a generic `{species} {classEn}` join
 * if the preset has no remap for that class.
 */
export function describeProfession(
  bodyTypeId: string | undefined | null,
  chineseClass: string,
  defaultClassEn: string,
): string {
  const preset = getBodyType(bodyTypeId)
  const remap = preset.professionRemap[chineseClass]
  if (remap) return remap
  if (preset.id === 'humanoid') return defaultClassEn
  // Generic fallback: keep the class word but anchor it on the species.
  return `${preset.speciesEn}, acting as ${defaultClassEn || chineseClass}`
}
