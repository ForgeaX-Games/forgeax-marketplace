import audioSearchIndex from '../data/audio-search-index.json';
import type { HumanSfxIntent, IntensityId } from './humanSearchTypes.ts';

export interface IndexedTagFamily {
  cue: string;
  source: string[];
  targetMaterial: string[];
  intensity: string[];
  styleTags: string[];
  containsTags: string[];
}

export interface TagOption {
  id: string;
  label: string;
  count: number;
}

export interface SfxTagCatalog {
  cues: TagOption[];
  sources: TagOption[];
  materials: TagOption[];
  intensities: TagOption[];
  preferredStyles: TagOption[];
  hardExcludes: TagOption[];
  avoidStyles: TagOption[];
}

export interface ParsedQueryPatch {
  cue?: string;
  sourceId?: string;
  materialId?: string;
  intensity?: IntensityId;
  preferredStyleIds?: string[];
  hardExcludeIds?: string[];
  avoidStyleIds?: string[];
}

const families = audioSearchIndex.families as IndexedTagFamily[];

const CUE_LABELS: Record<string, string> = {
  'ambient.bed': '环境氛围',
  'board.chess': '棋子移动',
  'board.chips': '筹码',
  'board.clock': '棋钟',
  'board.dice': '骰子',
  'board.poker': '扑克牌',
  'board.result': '桌游结算',
  'casual.card': '卡牌操作',
  'casual.code': '数字反馈',
  'casual.fish': '捕鱼',
  'casual.pinball': '弹珠',
  'casual.slide': '滑动消除',
  'character.death': '角色死亡',
  'combat.attack.impact': '攻击命中',
  'combat.attack.swing': '武器挥动',
  'combat.boss': 'Boss攻击',
  'combat.defense.parry': '格挡招架',
  'combat.explosion': '爆炸',
  'combat.range': '远程攻击',
  'combat.ranged.draw': '拉弓',
  'combat.ranged.fire': '枪械开火',
  'combat.ranged.release': '弓箭释放',
  'combat.ranged.reload': '枪械换弹',
  'creature.vocal': '生物叫声',
  'cyber.city_loop': '赛博城市',
  'cyber.hack': '黑客入侵',
  'cyber.keyboard': '科技键盘',
  'cyber.robot': '机器人',
  'cyber.scan': '科技扫描',
  'cyber.shield': '能量护盾',
  'environment.disaster': '自然灾害',
  'environment.weather': '天气',
  'era.medieval': '中世纪环境',
  'era.modern': '现代环境',
  'era.pirate': '海盗环境',
  'era.steampunk': '蒸汽朋克环境',
  'era.ww2': '二战环境',
  'interaction.activate': '启动装置',
  'interaction.break': '物体破碎',
  'interaction.building.collapse': '建筑坍塌',
  'interaction.building.door': '开关门',
  'interaction.building.elevator': '电梯',
  'interaction.building.gear': '齿轮机关',
  'interaction.building.trap': '陷阱机关',
  'interaction.close': '关闭物体',
  'interaction.open': '打开物体',
  'item.armor': '护甲装备',
  'item.book': '书本',
  'item.drop': '丢下物品',
  'item.food': '食物',
  'item.lock': '锁具',
  'item.pickup': '拾取物品',
  'item.weapon': '武器装备',
  'magic.cast': '施法',
  'magic.curse': '诅咒',
  'magic.element': '元素魔法',
  'magic.energy': '魔法能量',
  'magic.summon': '召唤',
  'magic.teleport': '传送',
  'movement.cloth': '衣物摩擦',
  'movement.foley': '身体动作',
  'movement.footstep': '脚步',
  'movement.footstep.run': '跑步',
  'movement.footstep.walk': '行走',
  'movement.jump': '跳跃',
  'movement.jump_land': '跳起并落地',
  'movement.land': '落地',
  'narrative.anomaly': '异常事件',
  'narrative.avg.cg': '剧情演出',
  'narrative.dialogue': '对白提示',
  'narrative.flashback': '回忆转场',
  'narrative.letter': '信件阅读',
  'narrative.transition': '剧情转场',
  'rhythm.drum': '节奏鼓点',
  'rhythm.judge': '节奏判定',
  'rhythm.slide': '节奏滑动',
  'rogue.curse': '肉鸽诅咒',
  'rpg.capture': '捕获',
  'rpg.evolve': '进化',
  'rpg.exp': '经验成长',
  'rpg.hatch': '孵化',
  'rpg.status': '状态变化',
  'simulation.customer': '顾客反馈',
  'simulation.day': '日期切换',
  'simulation.farm.build': '农场建造',
  'simulation.farm.demolish': '农场拆除',
  'simulation.farm.harvest': '农场收获',
  'simulation.farm.mine': '农场采矿',
  'simulation.farm.plant': '农场种植',
  'simulation.order': '订单',
  'simulation.staff': '员工操作',
  'sports.action': '体育动作',
  'stinger.combo': '连击提示',
  'stinger.countdown': '倒计时',
  'stinger.failure': '失败提示',
  'stinger.levelup': '升级提示',
  'stinger.mission': '任务提示',
  'stinger.reveal': '揭晓提示',
  'stinger.success': '成功提示',
  'tower.attack': '塔防攻击',
  'tower.build': '塔防建造',
  'tower.energy': '塔防能量',
  'tower.skill': '塔防技能',
  'ui.cancel': 'UI取消',
  'ui.click': 'UI点击',
  'ui.confirm': 'UI确认',
  'ui.currency': '货币反馈',
  'ui.error': '错误提示',
  'ui.hover': 'UI悬停',
  'ui.notification': '通知提示',
  'ui.page.enter': '页面进入',
  'ui.popup': '弹窗提示',
  'ui.slider': '滑杆',
  'vehicle.engine': '载具引擎',
  'vehicle.move': '载具移动',
};

const SOURCE_LABELS: Record<string, string> = {
  body: '人物',
  bow: '弓箭',
  button: '按钮',
  chest: '宝箱',
  cloth: '布料',
  creature: '生物',
  door: '门',
  environment: '环境',
  foot: '脚步',
  grenade: '手雷',
  gun: '枪械',
  interface: '界面',
  machine: '机器',
  magic: '魔法',
  pistol: '手枪',
  rifle: '步枪',
  shotgun: '霰弹枪',
  sword: '剑',
  vehicle: '载具',
};

const MATERIAL_LABELS: Record<string, string> = {
  dirt: '泥土',
  energy_shield: '能量盾',
  fabric: '布料',
  flesh: '肉体',
  glass: '玻璃',
  grass: '草地',
  metal: '金属',
  sand: '沙地',
  snow: '雪地',
  stone: '石头',
  water: '水面',
  wood: '木头',
};

const INTENSITY_LABELS: Record<string, string> = {
  light: '轻',
  medium: '中',
  heavy: '重',
};

const STYLE_LABELS: Record<string, string> = {
  realistic: '写实',
  mechanical: '机械质感',
  casual: '轻松休闲',
  horror: '惊悚感',
  fantasy: '奇幻质感',
  dark_fantasy: '暗黑质感',
};

const HARD_EXCLUDE_LABELS: Record<string, string> = {
  voice: '人声',
  music: '音乐成分',
  reverb_long: '长混响',
};

const AVOID_STYLE_LABELS: Record<string, string> = {
  sci_fi: '科幻感',
  horror: '惊悚感',
  mechanical: '机械感',
  casual: '休闲感',
};

const CUE_ORDER = [
  'ui.click',
  'movement.footstep',
  'movement.footstep.run',
  'movement.jump',
  'movement.land',
  'combat.attack.impact',
  'combat.attack.swing',
  'combat.defense.parry',
  'combat.explosion',
  'interaction.building.door',
  'item.pickup',
  'interaction.break',
  'magic.cast',
  'magic.teleport',
];

function cueMatches(familyCue: string, requestedCue: string): boolean {
  if (familyCue === requestedCue) return true;
  return requestedCue === 'movement.footstep'
    && familyCue.startsWith('movement.footstep.');
}

function labelFor(id: string, labels: Record<string, string>): string {
  return labels[id] ?? id.replace(/_/g, ' ').replace(/\./g, ' / ');
}

function countValues(
  collection: readonly IndexedTagFamily[],
  pick: (family: IndexedTagFamily) => readonly string[],
  labels: Record<string, string>,
  allow?: ReadonlySet<string>,
): TagOption[] {
  const counts = new Map<string, number>();
  for (const family of collection) {
    for (const value of pick(family)) {
      if (allow && !allow.has(value)) continue;
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([id, count]) => ({ id, count, label: labelFor(id, labels) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
}

function cueOptions(collection: readonly IndexedTagFamily[]): TagOption[] {
  const counts = new Map<string, number>();
  for (const family of collection) {
    counts.set(family.cue, (counts.get(family.cue) ?? 0) + 1);
  }
  return [...counts]
    .map(([id, count]) => ({ id, count, label: labelFor(id, CUE_LABELS) }))
    .sort((a, b) => {
      const ai = CUE_ORDER.indexOf(a.id);
      const bi = CUE_ORDER.indexOf(b.id);
      if (ai >= 0 || bi >= 0) {
        if (ai < 0) return 1;
        if (bi < 0) return -1;
        return ai - bi;
      }
      return b.count - a.count || a.label.localeCompare(b.label, 'zh-CN');
    });
}

export function buildSfxTagCatalog(
  cue?: string,
  liveFamilies?: readonly IndexedTagFamily[],
): SfxTagCatalog {
  const collection = liveFamilies?.length ? liveFamilies : families;
  const pool = cue
    ? collection.filter((family) => cueMatches(family.cue, cue))
    : collection;
  const intensities = countValues(
    pool,
    (family) => family.intensity,
    INTENSITY_LABELS,
    new Set(['light', 'medium', 'heavy']),
  );
  return {
    cues: cueOptions(collection),
    sources: countValues(pool, (family) => family.source, SOURCE_LABELS),
    materials: countValues(pool, (family) => family.targetMaterial, MATERIAL_LABELS),
    intensities,
    preferredStyles: countValues(
      pool,
      (family) => family.styleTags,
      STYLE_LABELS,
      new Set(Object.keys(STYLE_LABELS)),
    ),
    hardExcludes: Object.entries(HARD_EXCLUDE_LABELS).map(([id, label]) => ({
      id,
      label,
      count: collection.filter((family) => family.containsTags.includes(id)).length,
    })),
    avoidStyles: countValues(
      pool,
      (family) => family.styleTags,
      AVOID_STYLE_LABELS,
      new Set(Object.keys(AVOID_STYLE_LABELS)),
    ),
  };
}

export function contextualMaterialLabel(cue?: string): string {
  if (!cue) return '碰到什么';
  if (cue.startsWith('movement.footstep') || cue.includes('land')) return '踩在什么上';
  if (cue.startsWith('interaction.')) return '物体是什么材质';
  return '碰到什么';
}

export function cueLabel(id: string): string {
  return labelFor(id, CUE_LABELS);
}

export function sourceLabel(id: string): string {
  return labelFor(id, SOURCE_LABELS);
}

export function materialLabel(id: string): string {
  return labelFor(id, MATERIAL_LABELS);
}

export function intensityLabel(id: string): string {
  return labelFor(id, INTENSITY_LABELS);
}

export function styleLabel(id: string): string {
  return labelFor(id, STYLE_LABELS);
}

export function excludeLabel(id: string): string {
  return labelFor(id, HARD_EXCLUDE_LABELS);
}

export function avoidStyleLabel(id: string): string {
  return labelFor(id, AVOID_STYLE_LABELS);
}

function includesAny(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function parseChineseSfxQuery(text: string): ParsedQueryPatch {
  const normalized = text.trim().toLowerCase();
  const patch: ParsedQueryPatch = {};
  if (!normalized) return patch;

  if (includesAny(normalized, ['枪声', '开枪', '射击', '枪械开火', '火器'])) {
    patch.cue = 'combat.ranged.fire';
  } else if (includesAny(normalized, ['换弹', '装弹', '上膛'])) {
    patch.cue = 'combat.ranged.reload';
  } else if (includesAny(normalized, ['格挡', '招架', '弹反'])) {
    patch.cue = 'combat.defense.parry';
  } else if (includesAny(normalized, ['命中', '击中', '砍中', '打中', '撞击', '重击'])) {
    patch.cue = 'combat.attack.impact';
  } else if (includesAny(normalized, ['挥动', '挥砍', '挥剑', '破风'])) {
    patch.cue = 'combat.attack.swing';
  } else if (includesAny(normalized, ['跑步', '奔跑'])) {
    patch.cue = 'movement.footstep.run';
  } else if (includesAny(normalized, ['脚步', '走路', '行走'])) {
    patch.cue = 'movement.footstep';
  } else if (includesAny(normalized, ['跳跃', '起跳'])) {
    patch.cue = 'movement.jump';
  } else if (includesAny(normalized, ['落地', '着地'])) {
    patch.cue = 'movement.land';
  } else if (includesAny(normalized, ['爆炸', '爆破'])) {
    patch.cue = 'combat.explosion';
  } else if (includesAny(normalized, ['开门', '关门'])) {
    patch.cue = 'interaction.building.door';
  } else if (includesAny(normalized, ['拾取', '捡起'])) {
    patch.cue = 'item.pickup';
  } else if (includesAny(normalized, ['破碎', '打碎'])) {
    patch.cue = 'interaction.break';
  } else if (includesAny(normalized, ['施法', '魔法'])) {
    patch.cue = 'magic.cast';
  } else if (includesAny(normalized, ['传送', '瞬移'])) {
    patch.cue = 'magic.teleport';
  } else if (includesAny(normalized, ['点击', '按钮'])) {
    patch.cue = 'ui.click';
  } else if (includesAny(normalized, ['确认', '确定'])) {
    patch.cue = 'ui.confirm';
  } else if (includesAny(normalized, ['取消', '返回'])) {
    patch.cue = 'ui.cancel';
  } else if (includesAny(normalized, ['错误提示', '操作失败'])) {
    patch.cue = 'ui.error';
  } else if (includesAny(normalized, ['通知', '消息提示'])) {
    patch.cue = 'ui.notification';
  } else if (includesAny(normalized, ['怪物叫', '生物叫', '咆哮', '嘶吼'])) {
    patch.cue = 'creature.vocal';
  } else if (includesAny(normalized, ['角色死亡', '死亡惨叫'])) {
    patch.cue = 'character.death';
  } else if (includesAny(normalized, ['衣物', '布料摩擦'])) {
    patch.cue = 'movement.cloth';
  } else if (includesAny(normalized, ['载具引擎', '汽车引擎', '飞船引擎'])) {
    patch.cue = 'vehicle.engine';
  } else if (includesAny(normalized, ['升级提示', '升级音效'])) {
    patch.cue = 'stinger.levelup';
  } else if (includesAny(normalized, ['成功提示', '胜利提示'])) {
    patch.cue = 'stinger.success';
  } else if (includesAny(normalized, ['失败提示', '失败音效'])) {
    patch.cue = 'stinger.failure';
  } else if (includesAny(normalized, ['倒计时'])) {
    patch.cue = 'stinger.countdown';
  } else if (includesAny(normalized, ['下雨', '雨声', '雷声', '天气'])) {
    patch.cue = 'environment.weather';
  } else if (includesAny(normalized, ['环境氛围', '环境声', '氛围声'])) {
    patch.cue = 'ambient.bed';
  }

  const sourceRules: Array<[string, readonly string[]]> = [
    ['sword', ['剑', '刀剑', '长剑']],
    ['bow', ['弓箭', '弓']],
    ['rifle', ['步枪']],
    ['pistol', ['手枪']],
    ['shotgun', ['霰弹枪']],
    ['gun', ['枪声', '枪械', '开枪', '火器']],
    ['creature', ['怪物', '生物']],
    ['body', ['人物', '角色', '身体']],
    ['foot', ['脚步', '走路', '跑步']],
    ['interface', ['界面', 'ui', '按钮']],
    ['magic', ['魔法', '法术', '施法']],
    ['machine', ['机器', '机械']],
    ['vehicle', ['载具', '汽车', '飞船', '坦克']],
    ['grenade', ['手雷', '榴弹']],
    ['chest', ['宝箱']],
    ['door', ['门']],
  ];
  patch.sourceId = sourceRules.find(([, terms]) => includesAny(normalized, terms))?.[0];

  const materialRules: Array<[string, readonly string[]]> = [
    ['metal', ['金属', '铁甲', '盔甲', '钢铁']],
    ['flesh', ['肉体', '血肉']],
    ['wood', ['木头', '木材']],
    ['stone', ['石头', '岩石']],
    ['glass', ['玻璃']],
    ['dirt', ['泥土']],
    ['grass', ['草地']],
    ['sand', ['沙地']],
    ['snow', ['雪地']],
    ['water', ['水面', '水里']],
    ['fabric', ['布料', '衣物', '地毯']],
    ['energy_shield', ['能量盾', '能量护盾']],
  ];
  patch.materialId = materialRules.find(([, terms]) => includesAny(normalized, terms))?.[0];

  if (includesAny(normalized, ['重击', '沉重', '强力', '很重'])) patch.intensity = 'heavy';
  else if (includesAny(normalized, ['轻击', '轻微', '很轻'])) patch.intensity = 'light';
  else if (includesAny(normalized, ['中等', '适中'])) patch.intensity = 'medium';

  const styles: string[] = [];
  if (includesAny(normalized, ['写实', '真实'])) styles.push('realistic');
  if (includesAny(normalized, ['机械质感'])) styles.push('mechanical');
  if (includesAny(normalized, ['轻松', '休闲'])) styles.push('casual');
  if (includesAny(normalized, ['暗黑奇幻', '黑暗奇幻'])) styles.push('dark_fantasy');
  else if (includesAny(normalized, ['奇幻'])) styles.push('fantasy');
  if (includesAny(normalized, ['恐怖', '惊悚'])) styles.push('horror');
  if (styles.length) patch.preferredStyleIds = styles;

  const hardExcludes: string[] = [];
  if (/不要.{0,3}(人声|说话|喊声)|无人声/.test(normalized)) hardExcludes.push('voice');
  if (/不要.{0,3}(音乐|旋律)|无音乐/.test(normalized)) hardExcludes.push('music');
  if (/不要.{0,4}(长混响|长尾音)|减少.{0,3}(混响)|无混响/.test(normalized)) {
    hardExcludes.push('reverb_long');
  }
  if (hardExcludes.length) patch.hardExcludeIds = hardExcludes;

  const avoids: string[] = [];
  if (/不要.{0,3}(科幻)|避免.{0,3}(科幻)/.test(normalized)) avoids.push('sci_fi');
  if (/不要.{0,3}(恐怖|惊悚)|避免.{0,3}(恐怖|惊悚)/.test(normalized)) avoids.push('horror');
  if (/不要.{0,3}(机械)|避免.{0,3}(机械)/.test(normalized)) avoids.push('mechanical');
  if (/不要.{0,3}(休闲|卡通)|避免.{0,3}(休闲|卡通)/.test(normalized)) avoids.push('casual');
  if (avoids.length) patch.avoidStyleIds = avoids;

  return patch;
}

const QUERY_EXPANSIONS: Array<[readonly string[], readonly string[]]> = [
  [['枪声', '开枪', '射击'], ['gunfire', 'gun', 'fire', 'shot']],
  [['换弹', '装弹', '上膛'], ['reload', 'magazine', 'shell']],
  [['命中', '击中', '撞击'], ['hit', 'impact', 'strike']],
  [['挥动', '挥砍', '破风'], ['swing', 'whoosh', 'swish']],
  [['格挡', '招架', '弹反'], ['parry', 'block', 'shield']],
  [['爆炸', '爆破'], ['explosion', 'blast', 'grenade']],
  [['脚步', '走路', '行走'], ['footstep', 'walk']],
  [['跑步', '奔跑'], ['footstep', 'run']],
  [['跳跃', '起跳'], ['jump', 'takeoff']],
  [['落地', '着地'], ['land', 'landing']],
  [['施法', '魔法', '法术'], ['magic', 'spell', 'cast']],
  [['传送', '瞬移'], ['teleport', 'portal']],
  [['点击', '按钮'], ['ui', 'button', 'click']],
  [['门', '开门', '关门'], ['door', 'open', 'close']],
  [['拾取', '捡起'], ['pickup', 'collect']],
  [['破碎', '打碎'], ['break', 'shatter']],
  [['怪物', '生物'], ['monster', 'creature']],
  [['咆哮', '嘶吼'], ['roar', 'snarl', 'scream']],
  [['剑', '刀剑', '长剑'], ['sword', 'blade']],
  [['步枪'], ['rifle']],
  [['手枪'], ['pistol']],
  [['霰弹枪'], ['shotgun']],
  [['金属', '铁甲', '盔甲', '钢铁'], ['metal', 'armor']],
  [['肉体', '血肉'], ['flesh', 'organic']],
  [['木头', '木材'], ['wood', 'wooden']],
  [['石头', '岩石'], ['stone', 'rock']],
  [['玻璃'], ['glass']],
  [['泥土'], ['dirt', 'soil']],
  [['草地'], ['grass']],
  [['沙地'], ['sand']],
  [['雪地'], ['snow']],
  [['水面', '水里'], ['water', 'wet']],
  [['布料', '衣物', '地毯'], ['fabric', 'cloth', 'carpet']],
  [['沉重', '重击', '强力'], ['heavy', 'strong', 'powerful']],
  [['轻微', '轻击', '很轻'], ['light', 'soft', 'gentle']],
  [['短促', '干脆'], ['short', 'dry']],
  [['写实', '真实'], ['realistic', 'naturalistic']],
  [['机械'], ['mechanical', 'machine']],
  [['科幻'], ['sci-fi', 'sci_fi', 'futuristic']],
  [['恐怖', '惊悚'], ['horror', 'terrifying']],
  [['奇幻'], ['fantasy', 'medieval']],
  [['火焰', '火系'], ['fire']],
  [['冰霜', '冰系'], ['ice']],
  [['雷电', '电系'], ['lightning', 'electric']],
  [['风系', '风声'], ['wind', 'air']],
  [['水系'], ['water']],
];

function positiveQueryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/(?:不要|避免|排除|去掉|不带|别有)[^，。；,;]{0,12}/g, ' ');
}

export function expandChineseSfxQueryTerms(text: string): string[] {
  const positive = positiveQueryText(text);
  const terms = new Set<string>();
  const rawSegments = positive
    .split(/[\s，。；、,;：:]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2);
  for (const term of rawSegments) terms.add(term);
  for (const [triggers, expansions] of QUERY_EXPANSIONS) {
    if (!includesAny(positive, triggers)) continue;
    for (const term of expansions) terms.add(term);
  }
  return [...terms];
}

export function summarizeIntent(intent: HumanSfxIntent): string {
  const parts = [
    cueLabel(intent.cue),
    intent.sourceId ? sourceLabel(intent.sourceId) : '',
    intent.materialId ? materialLabel(intent.materialId) : '',
    intent.intensity ? intensityLabel(intent.intensity) : '',
    ...intent.preferredStyleIds.map(styleLabel),
    intent.requireIntensityVariants ? '需要多个力度变体' : '',
    ...intent.hardExcludeIds.map((id) => `排除${excludeLabel(id)}`),
    ...intent.avoidStyleIds.map((id) => `尽量避免${avoidStyleLabel(id)}`),
  ].filter(Boolean);
  return parts.join(' · ');
}
