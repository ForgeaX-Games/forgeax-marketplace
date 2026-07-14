/**
 * NPC（路人 / 职业人员）词表与 prompt fragment。
 *
 * 角色设计默认走「主角英雄」管线——18 种战斗职业、武器装备、战斗姿态、
 * 大招演出全套加满。但玩家经常需要的其实是**世界里的普通居民**：
 * 现代都市里的上班族 / 学生 / 快递员、中世纪城镇里的铁匠 / 商贩 / 酒馆老板。
 *
 * 对这类「职业 NPC / 路人」我们要的是：
 *   - 没有武器、没有战斗姿态、没有技能特效
 *   - 服饰符合「世界观 + 职业」的日常穿着
 *   - 自然放松的站立姿势，只需要「待机 / 走路」这类日常动画
 *
 * 这个模块单独维护两块数据：
 *   - NPC_OCCUPATIONS_BY_WORLD：按世界观（与 CharacterDesign 中 WORLD_OPTIONS
 *     的 `id` 一一对应）列出该世界里「有代表性的路人职业」中文词表
 *   - OCCUPATION_EN_HINTS：常见职业中 → 英文描述，喂给图像模型
 *
 * 主角英雄那套 18 职业 / professionRemap 逻辑一概不参与——路人 prompt 走独立
 * 语言，避免把「上班族」塞到「swordsman + rim lighting」里生成出拿着大剑的
 * 白领。
 */

export interface NpcOccupation {
  /** 中文短名（UI chip 标签） */
  zh: string
  /** 英文描述片段，会拼进 prompt。尽量贴近「日常 + 世界观」不含武器 */
  en: string
}

/**
 * 每个世界观下最常见的 10 类路人 NPC，覆盖「男 / 女 / 老 / 少 / 商 / 工 / 学」
 * 几个典型面貌，保证 UI chip 网格够用。
 */
export const NPC_OCCUPATIONS_BY_WORLD: Record<string, NpcOccupation[]> = {
  'modern-urban': [
    { zh: '上班族', en: 'urban office worker in a simple business shirt and slacks, lanyard id, carrying a tote bag' },
    { zh: '学生', en: 'city highschool or university student in casual hoodie and jeans, backpack over one shoulder' },
    { zh: '警察', en: 'ordinary city patrol officer in a modern navy uniform, peaked cap, radio on shoulder, no drawn weapon' },
    { zh: '快递员', en: 'bike courier / delivery worker in a bright branded jacket, insulated food bag on back, helmet' },
    { zh: '路边小贩', en: 'street food vendor in a cotton apron beside a small cart, wiping hands on a towel' },
    { zh: '建筑工人', en: 'construction worker in a hi-vis vest, hard hat, work trousers and boots, holding a clipboard or a tool, casual stance' },
    { zh: '老人', en: 'retired elderly citizen in simple everyday clothing, perhaps with a cane or a small grocery bag, relaxed posture' },
    { zh: '程序员', en: 'tired programmer in a plain t-shirt and hoodie, glasses, holding a laptop bag and a coffee cup' },
    { zh: '游客', en: 'tourist with a small camera around the neck, sun hat, light daypack, comfortable travel clothes' },
    { zh: '清洁工', en: 'street cleaner in a plain city sanitation uniform holding a broom and dustpan, cap, practical boots' },
  ],

  'medieval-fantasy': [
    { zh: '商人', en: 'town merchant in layered wool tunic and leather apron, coin purse at belt, kindly approachable face' },
    { zh: '铁匠', en: 'village blacksmith in a thick leather apron, soot-smudged face, rolled-up sleeves, hammer tucked at hip' },
    { zh: '农夫', en: 'peasant farmer in patched linen tunic and trousers, simple straw hat, holding a wooden rake or sickle' },
    { zh: '酒馆老板', en: 'innkeeper in a stained apron over a woolen shirt, holding a clay mug, wide easy smile' },
    { zh: '乞丐', en: 'threadbare beggar in patched ragged cloak, clutching a wooden bowl, humble hunched posture' },
    { zh: '旅人', en: 'wandering traveler in a weathered hooded cloak, leather pack, simple walking staff (not a weapon)' },
    { zh: '守卫兵', en: 'town gate guard in standard-issue chain and tabard, helm under arm or beside them, relaxed parade-rest stance (sword sheathed)' },
    { zh: '老妇', en: 'elderly village woman in long woolen dress and shawl, hair in a kerchief, holding a basket of vegetables or bread' },
    { zh: '学徒', en: 'young apprentice in a simple wool tunic, ink-stained fingers, carrying scrolls or a tome under one arm' },
    { zh: '贵族', en: 'minor aristocrat in fine velvet doublet and embroidered sash, no visible weapon, posed with calm poise' },
  ],

  'cyberpunk': [
    { zh: '街头混混', en: 'street kid in cheap synthleather jacket with neon-tag graffiti, cheap cyber-implant on one ear, hands in pockets' },
    { zh: '义体技师', en: 'ripper-tech in a plain jumpsuit with arm augments exposed, tool belt full of connectors, not holding a weapon' },
    { zh: '送餐员', en: 'delivery runner in a glowing branded jacket, smart-helmet, insulated delivery case on back' },
    { zh: '记者', en: 'street journalist in a weathered trenchcoat, press badge on lapel, holding a pocket recorder' },
    { zh: '失业工人', en: 'out-of-work factory worker in worn coveralls, cheap cig in mouth, slumped posture outside a vending cubicle' },
    { zh: '黑客', en: 'netrunner in an oversized hoodie, cheap VR deck around the neck, cables dangling to a belt rig' },
    { zh: '赛博格', en: 'lightly augmented civilian with one mechanical arm and a visor over the eyes, otherwise ordinary street clothes' },
    { zh: '流浪者', en: 'homeless drifter in stacked synthetic layers, patched scarf, dragging a plastic tarp-wrapped bundle' },
    { zh: '夜店客人', en: 'club-goer in neon-reactive streetwear, chrome accessories, relaxed mid-conversation pose' },
    { zh: '清洁工', en: 'drone-supervising sanitation worker in a branded city-services jumpsuit, barcoded cap, practical boots' },
  ],

  'eastern-fantasy': [
    { zh: '药铺掌柜', en: 'herbal shopkeeper in a long blue-gray changshan robe, small round spectacles, measuring herbs with a bronze steelyard' },
    { zh: '茶馆跑堂', en: 'teahouse server in a short dark tunic with cloth apron, pot of tea in one hand, stack of cups in the other' },
    { zh: '赶路商旅', en: 'traveling merchant in a simple robe and sash, conical bamboo hat, leading a packhorse or carrying a bindle' },
    { zh: '算命先生', en: 'fortune-teller in a faded taoist-style gray robe, holding a tally stick banner and a folding fan' },
    { zh: '挑夫', en: 'porter with a wooden carrying pole over both shoulders, two bamboo baskets balanced, plain patched cotton tunic' },
    { zh: '侠客', en: 'wandering martial disciple in a simple cotton robe, no visible weapon at the hip, calm centered stance' },
    { zh: '采药人', en: 'herb gatherer in a rough hemp tunic, bamboo back-basket full of medicinal plants, straw shoes' },
    { zh: '船娘', en: 'river boat woman in a short blue tunic and cloth headscarf, oar in one hand, apron sash tied around the waist' },
    { zh: '老妇', en: 'elderly village grandmother in layered plain robe with a walking cane, hair in a low bun, kind expression' },
    { zh: '童子', en: 'young village child in a simple patched tunic, hair tied in two small buns, holding a small wooden toy' },
  ],

  'sci-fi': [
    { zh: '工程师', en: 'colony engineer in a utility jumpsuit with glowing console-patches, tool harness at hip, datapad in hand' },
    { zh: '太空港员工', en: 'spaceport service clerk in a clean crew uniform with rank tabs, headset over one ear, holding a boarding tablet' },
    { zh: '科学家', en: 'research scientist in a white-and-grey lab coat over utility wear, holo-lens over one eye, carrying a sample case' },
    { zh: '殖民兵', en: 'off-duty colonial trooper in a soft fatigue uniform, sidearm holstered and unused, relaxed stance' },
    { zh: '宇航员', en: 'station crew member in a soft-shell flight suit with patches, helmet tucked under one arm, magnetic boots' },
    { zh: '外星翻译', en: 'xeno-linguist in a flowing non-human-cut civilian outfit, translator disc at throat, friendly expression' },
    { zh: '殖民者家属', en: 'colony-born civilian in simple woven fabrics with a utility belt, holding a child\'s hand or a grocery tote' },
    { zh: '机械修理工', en: 'mech repair technician in an oil-stained coverall, plasma cutter on belt holstered, lifting a helmet visor' },
    { zh: '数据分析师', en: 'data analyst in a neat civilian uniform with a holo-bracelet projecting charts beside them, calm posture' },
    { zh: '孩童', en: 'colony child in simple playclothes with utility patches, holding a small toy drone, curious expression' },
  ],

  'post-apocalypse': [
    { zh: '拾荒者', en: 'scavenger in patched layered rags over scrap-plate armor scraps, dust goggles around neck, heavy backpack of salvage' },
    { zh: '商队向导', en: 'caravan scout in a weathered duster with a bandanna over face pulled down, no drawn weapon, compass in hand' },
    { zh: '定居点农夫', en: 'settlement farmer in coarse patched clothes, wide hat against the ash sun, holding a makeshift hoe' },
    { zh: '水贩', en: 'water trader in dust-caked clothes, large canteens strung on a wooden yoke across shoulders' },
    { zh: '辐射病人', en: 'frail wastelander with wrapped bandages and a breathing scarf, hunched on a walking stick, wary eyes' },
    { zh: '流民', en: 'wandering refugee in layered thin coats, clutching a small bundled pack to the chest, wind-scraped face' },
    { zh: '废土修补匠', en: 'wasteland tinker surrounded by scrap gadgets, leather apron, magnifier monocle, holding a soldering stylus' },
    { zh: '守望者', en: 'settlement watchman in makeshift riot gear (no active weapon), binoculars around neck, rooftop-observation posture' },
    { zh: '巫医', en: 'wasteland healer with herb pouches on belt, a smoke-stained robe, marked cheekbones, holding a clay bowl' },
    { zh: '孩童', en: 'wasteland child in oversized adult castoffs cinched with rope, clutching a toy stitched from scrap cloth' },
  ],

  'steampunk': [
    { zh: '机械工程师', en: 'steam-age engineer in a brass-buttoned waistcoat over a rolled-sleeve shirt, leather goggles on forehead, spanner in hand' },
    { zh: '锅炉工', en: 'boiler room worker in coal-smudged coveralls, flat cap, iron-toed boots, shovel leaning against them' },
    { zh: '书店老板', en: 'spectacled bookseller in a tweed jacket and bow tie, cradling a large leather tome, warm studious look' },
    { zh: '飞艇水手', en: 'airship deckhand in a short wool coat with rank braid, peaked cap, coil of rope over one shoulder' },
    { zh: '钟表匠', en: 'watchmaker in a long leather apron over a pressed shirt, loupe over one eye, tiny tools on a chain belt' },
    { zh: '发明家', en: 'eccentric inventor in a patched frock coat stuffed with blueprints, soot smudge on cheek, brass gadget in hand' },
    { zh: '矿工', en: 'deep-tunnel miner in heavy canvas clothes, helmet with a small oil lamp fixed to the brim, pickaxe on shoulder' },
    { zh: '新闻记者', en: 'street journalist in a pinstriped suit and press-card hatband, notebook and pencil in hand' },
    { zh: '贵族', en: 'well-to-do gentlewoman/gentleman in a gear-trim corset dress or frock coat, parasol or cane, refined stance' },
    { zh: '流浪琴师', en: 'wandering musician in patched velvet coat, brass harmonica or hurdy-gurdy hanging at chest, coin hat' },
  ],

  'dark-fantasy': [
    { zh: '逃亡村民', en: 'displaced villager in torn muddy rags clutching a bundled cloth pack, terrified tired expression' },
    { zh: '疯修士', en: 'gaunt cultist in a soot-stained cassock, hollow eyes, wax-dripped candle bound into a wooden wreath around neck' },
    { zh: '染病商贩', en: 'plague-ridden peddler with face covered by a crude beaked leather mask, gloved hands, stooped pose' },
    { zh: '老农', en: 'aged farmer with gnarled hands, threadbare woolen tunic, leaning on a crude wooden staff, haunted eyes' },
    { zh: '酒客', en: 'haggard tavern drunk in stained leather and fur scraps, unkempt beard, clay mug in one hand, slouched on a bench' },
    { zh: '乞讨孤儿', en: 'ash-smeared orphan in oversized adult rags, bare dirty feet, hugging a scrap of cloth as a keepsake' },
    { zh: '杂货铺老板', en: 'wary shopkeeper behind a scarred wooden counter, wool tunic with a grime-stained apron, knife shelved within reach but not drawn' },
    { zh: '守墓人', en: 'gravedigger in a heavy ash-streaked cowl, shovel planted in the earth beside them, silent grim stance' },
    { zh: '传教士', en: 'mendicant preacher in a patched robe of coarse hemp, clutching a holy symbol carved from bone' },
    { zh: '流浪艺人', en: 'ragged street performer in faded bright patches, cracked fiddle across chest, haunted smile' },
  ],

  'pirate-nautical': [
    { zh: '水手', en: 'ship\'s sailor in striped shirt and rolled canvas trousers, bare feet on deck planks, kerchief tied around head' },
    { zh: '码头工人', en: 'dockworker in simple linen tunic and leather belt, hauling a rope or a crate, sunburned neck' },
    { zh: '酒馆老板娘', en: 'seaport tavern keeper in a laced bodice and apron, tray of mugs balanced on one hand, shrewd lively smile' },
    { zh: '渔夫', en: 'coastal fisherman in patched oilskin coat and wide hat, mending a net draped across his lap' },
    { zh: '商船账房', en: 'merchant ship accountant in a neat waistcoat and spectacles, ledger under arm, quill behind the ear' },
    { zh: '海港乞儿', en: 'dockside street urchin in oversized worn coat and bare feet, smudged face, pickpocket-sly posture' },
    { zh: '殖民地官员', en: 'colonial administrator in a formal coat with powdered wig and tricorn, rolled dispatch clutched in one hand' },
    { zh: '传教士', en: 'seaborne missionary in a simple dark cassock, wooden cross on a cord, weather-beaten face' },
    { zh: '流亡者', en: 'exile in worn foreign-cut clothes, one small travel chest at feet, hopeful tired gaze over the harbour' },
    { zh: '老船长', en: 'retired sea captain in a faded naval coat without insignia, wooden spyglass tucked under arm, leaning on a cane' },
  ],

  'mythology': [
    { zh: '朝拜者', en: 'humble pilgrim in rough linen robe and sandals, head bowed, clay offering cup cradled in both hands' },
    { zh: '祭司弟子', en: 'temple apprentice in a white chiton with blue trim, holding a clay oil lamp, calm serene expression' },
    { zh: '农夫', en: 'archaic-era farmer in a simple knee-length tunic, broad straw sunhat, wooden hoe in hand' },
    { zh: '市集商人', en: 'marketplace merchant in dyed linen robes, selling figs or bread from a woven basket, gregarious gesture' },
    { zh: '占卜师', en: 'oracle-in-training in a white veil and chiton, holding a bundle of dried bay leaves, eyes half-closed' },
    { zh: '信使', en: 'foot-runner in a short sleeveless tunic and strapped sandals, staff in hand, scroll case on a shoulder cord' },
    { zh: '老妇', en: 'elderly matron in long wool robes and headscarf, spindle and thread in hand, soft-eyed smile' },
    { zh: '孩童', en: 'child in a simple knee tunic with a small terracotta toy, chasing after nothing in particular' },
    { zh: '哲人', en: 'wandering philosopher in an ankle-length cloak, long beard, holding a carved wooden staff, measured expression' },
    { zh: '酒神信徒', en: 'reveler in loose tunic crowned with grape leaves, clay wine cup in hand, relaxed happy posture' },
  ],
}

/**
 * 少量通用英文 hint——当玩家输入自定义职业时没有词表命中，也尽量把常见
 * 中文职业名直译成贴切的英文，避免 prompt 里出现裸露的拼音。
 */
const COMMON_OCCUPATION_EN: Record<string, string> = {
  '上班族': 'office worker',
  '学生': 'student',
  '警察': 'police officer',
  '快递员': 'delivery worker',
  '老人': 'elderly civilian',
  '孩童': 'child',
  '游客': 'tourist',
  '清洁工': 'sanitation worker',
  '商人': 'merchant',
  '农夫': 'peasant farmer',
  '铁匠': 'blacksmith',
  '酒馆老板': 'innkeeper',
  '乞丐': 'beggar',
  '旅人': 'traveler',
  '守卫兵': 'town guard (off-duty, sword sheathed)',
  '渔夫': 'fisherman',
  '水手': 'sailor',
  '码头工人': 'dockworker',
  '记者': 'journalist',
  '程序员': 'programmer',
  '工程师': 'engineer',
  '科学家': 'scientist',
  '宇航员': 'astronaut',
  '机械工程师': 'steam-age mechanic',
  '钟表匠': 'watchmaker',
  '书店老板': 'bookseller',
  '发明家': 'inventor',
  '拾荒者': 'wasteland scavenger',
  '流民': 'refugee',
  '街头混混': 'street punk',
  '黑客': 'netrunner',
  '送餐员': 'delivery runner',
  '义体技师': 'ripper-tech',
  '药铺掌柜': 'herbal apothecary owner',
  '茶馆跑堂': 'teahouse server',
  '占卜师': 'oracle',
  '朝拜者': 'pilgrim',
  '老妇': 'elderly woman',
  '老妇人': 'elderly woman',
}

/** 世界观 id → 该世界推荐路人职业（UI 网格使用）。未知世界观回退到现代都市。 */
export function listNpcOccupations(worldId: string | undefined | null): NpcOccupation[] {
  if (!worldId) return NPC_OCCUPATIONS_BY_WORLD['modern-urban']
  return NPC_OCCUPATIONS_BY_WORLD[worldId] ?? NPC_OCCUPATIONS_BY_WORLD['modern-urban']
}

/**
 * 给定 (worldId, 中文职业)，返回 { zh, en } 两段描述。
 *
 *   - 若 (world, occupation) 在词表里精确命中 → 用词表里的 en（携带服饰细节）。
 *   - 若没命中但 occupation 在 COMMON_OCCUPATION_EN 里有条目 → 用通用英文 + 世界观修饰词。
 *   - 否则直接把中文职业回传 + 一个 `ordinary civilian` 回退英文。
 *
 * 这让玩家输入「算命先生」「老船长」「孩童」这种词表之外的 NPC 也能拿到可用
 * prompt，而不是退化成「npc 路人」一句话。
 */
export function describeNpcOccupation(
  worldId: string | undefined | null,
  occupationZh: string,
): { zh: string; en: string } {
  const world = worldId || 'modern-urban'
  const zh = occupationZh.trim() || '路人'
  const list = NPC_OCCUPATIONS_BY_WORLD[world] ?? NPC_OCCUPATIONS_BY_WORLD['modern-urban']
  const exact = list.find(o => o.zh === zh)
  if (exact) return { zh, en: exact.en }

  const common = COMMON_OCCUPATION_EN[zh]
  if (common) return { zh, en: `${common}, clothing fits the ${world} setting, no weapon, relaxed everyday pose` }

  return {
    zh,
    en: `ordinary civilian (${zh}) that fits the ${world} setting, everyday clothing, no weapon, relaxed natural standing pose`,
  }
}
