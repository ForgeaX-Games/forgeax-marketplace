export interface DirectoryOption {
  id: string;
  label: string;
  count: number;
}

export interface SfxDirectoryCatalog {
  categories: DirectoryOption[];
  subcategories: DirectoryOption[];
}

export interface OnlineSfxDirectory {
  category: string;
  subcategory: string;
  sourceCategory: string;
  sourceSubcategory: string;
}

export interface OnlineSfxPathLike {
  name?: string;
  display_name?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  '1_ui': '用户界面 UI',
  '2_foley': '拟音',
  '3_combat': '战斗音效',
  '4_ambient': '环境氛围',
  '5_magic': '魔法与超自然',
  '6_item': '物品交互与道具',
  '7_vehicle': '载具与机械',
  '8_disaster': '自然灾难与极端天气',
  '9_building': '建筑、结构与机关',
  '10_cyber': '科技与赛博朋克',
  '11_stinger': '音乐性音效 Stinger',
  '12_sports': '体育竞技',
  '13_creature': '动物与生物音效',
  '14_casual': '解谜与休闲玩法',
  '15_narrative': '剧情叙事与过场',
  '16_farm': '建造、生产与采集',
  '17_era': '时代与世界风格',
  '18_board': '桌面物件与操作反馈',
  '19_stg': '载具、武器与战斗反馈',
  '20_rpg': '生物、成长与状态反馈',
  '21_rhythm': '节奏、乐器与判定反馈',
  '22_tower': '建造、部署与战斗反馈',
  '23_rogue': '探索、遗物与生存反馈',
  '24_platform': '移动、机关与关卡反馈',
  '25_sim': '经营、角色与日程反馈',
  '26_avg': '对话、剧情与选择反馈',
};

// The online depot contains both the original directory numbering and the
// delivery-spec numbering. Normalize only the first level; the real online
// second-level folder remains the searchable tag.
const ONLINE_CATEGORY_TO_DELIVERY: Record<string, string> = {
  '1_ui': '1_ui',
  '2_character': '2_foley',
  '3_combat': '3_combat',
  '4_magic': '5_magic',
  '5_vehicle': '7_vehicle',
  '6_item': '6_item',
  '7_ambient': '4_ambient',
  '7_vehicle': '7_vehicle',
  '8_casual': '14_casual',
  '8_disaster': '8_disaster',
  '9_building': '9_building',
  '9_sports': '12_sports',
  '10_cyber': '10_cyber',
  '11_stinger': '11_stinger',
  '15_narrative': '15_narrative',
  '16_farm': '16_farm',
  '17_era': '17_era',
  '18_board': '18_board',
  '20_rpg': '20_rpg',
  '21_rhythm': '21_rhythm',
  '22_tower': '22_tower',
  '23_rogue': '23_rogue',
  '24_platform': '24_platform',
  '25_sim': '25_sim',
  '26_avg': '26_avg',
};

const SUBCATEGORY_LABELS: Record<string, string> = {
  btn: '按键音',
  casual: '休闲界面',
  common: '通用界面',
  countdown: '倒计时',
  currency: '货币',
  fantasy: '奇幻界面',
  horror: '恐怖界面',
  hud: 'HUD 界面',
  popup: '弹窗',
  scifi: '科幻界面',

  cloth: '衣物',
  footstep: '脚步',
  monster: '怪物',
  voice: '角色语音',

  firearms: '枪械',
  melee: '近战',
  scifi_weapon: '科幻武器',
  throwable: '投掷物',

  buff: '增益',
  debuff: '减益',
  fire: '火焰',
  ice: '冰霜',
  lightning: '闪电',
  teleport: '传送',
  water: '水系',
  wind: '风系',

  air: '空中载具',
  land: '陆地载具',
  machinery: '机械设备',
  boat: '船只',
  car: '汽车',
  heli: '直升机',
  mech: '机械装甲',
  moto: '摩托车',
  plane: '飞机',
  tank: '坦克',

  consumable: '消耗品',
  container: '容器',
  utility: '工具与实用品',

  nature: '自然环境',
  urban: '城市环境',

  combo: '连击',
  match: '消除与匹配',
  timer: '计时器',

  blizzard: '暴风雪',
  earthquake: '地震',
  rockslide: '山崩泥石流',
  sandstorm: '沙尘暴',
  tornado: '龙卷风',
  tsunami: '海啸',
  volcano: '火山',

  collapse: '坍塌',
  door: '门',
  elevator: '电梯',
  gear: '齿轮',
  glass: '玻璃',
  lever: '拉杆',
  trap: '陷阱',

  ball: '球类',
  stadium: '体育场馆',

  hack: '系统入侵',
  keyboard: '键盘',
  robot: '机器人',
  scan: '扫描',
  shield: '能量护盾',

  fail: '失败',
  levelup: '升级',
  loot: '稀有掉落',
  mission: '任务',
  victory: '胜利',

  anomaly: '神秘事件',
  flashback: '闪回',
  letter: '信件与书信',

  build: '建造',
  demolish: '拆除',
  harvest: '收获',
  mine: '采矿',
  plant: '种植',

  medieval: '中世纪',
  modern: '现代都市',
  pirate: '大航海',
  steampunk: '蒸汽朋克',
  ww2: '二战',

  chess: '棋子与棋盘',
  chips: '筹码',
  clock: '棋钟',
  dice: '骰子',
  poker: '扑克牌',
  result: '结果反馈',

  capture: '捕捉',
  evolve: '进化',
  exp: '经验值',
  hatch: '孵化',
  status: '状态异常',
  turn: '回合制',

  break: '连击断开',
  drum: '鼓',
  judge: '判定',
  slide: '滑条',
  bianzhong: '编钟',
  guqin: '古琴',

  attack: '攻击',
  deploy: '部署',
  energy: '能量与资源',
  skill: '技能',
  wave: '波次与基地反馈',

  curse: '诅咒',
  death: '死亡',
  room: '房间',

  dash: '冲刺',
  grapple: '抓钩',
  invincible: '无敌状态',
  jump: '跳跃',
  platform: '移动平台',

  customer: '顾客',
  day: '昼夜与日期',
  order: '订单',

  choice: '选项',
  typewriter: '对话打字机音',
};

const SUBCATEGORY_LABEL_OVERRIDES: Record<string, string> = {
  '4_ambient/horror': '恐怖环境',
  '14_casual/combo': '连击反馈',
  '22_tower/build': '防御塔建造',
};

const SHALLOW_INSTRUMENT_DIRECTORIES: Record<string, string> = {
  bianzhong_3oct_36_solfege_suffix: 'bianzhong',
  guqin_3oct_36_solfege_suffix: 'guqin',
};

function assetPath(asset: OnlineSfxPathLike): string {
  return String(asset.display_name || asset.name || '')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

export function onlineSfxDirectory(
  asset: OnlineSfxPathLike,
): OnlineSfxDirectory | null {
  const parts = assetPath(asset).split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() !== 'sfx') return null;

  if (parts.length >= 4) {
    const sourceCategory = parts[1]!.toLowerCase();
    const sourceSubcategory = parts[2]!.toLowerCase();
    return {
      category: ONLINE_CATEGORY_TO_DELIVERY[sourceCategory] ?? sourceCategory,
      subcategory: sourceSubcategory,
      sourceCategory,
      sourceSubcategory,
    };
  }

  if (parts.length === 3) {
    const sourceCategory = parts[1]!.toLowerCase();
    const instrument = SHALLOW_INSTRUMENT_DIRECTORIES[sourceCategory];
    if (instrument) {
      return {
        category: '21_rhythm',
        subcategory: instrument,
        sourceCategory,
        sourceSubcategory: instrument,
      };
    }
  }

  return null;
}

export function onlineSfxFamilyStem(asset: OnlineSfxPathLike): string {
  const parts = assetPath(asset).split('/');
  const filename = parts[parts.length - 1] ?? '';
  return filename
    .toLowerCase()
    .replace(/\.(wav|mp3|ogg|m4a)$/i, '')
    .replace(/_\d{2}$/i, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    || 'unclassified';
}

export function onlineSfxFallbackFamilyId(asset: OnlineSfxPathLike): string | null {
  const directory = onlineSfxDirectory(asset);
  if (!directory) return null;
  return [
    'online',
    directory.category,
    directory.subcategory,
    onlineSfxFamilyStem(asset),
  ].join('.').replace(/_/g, '.');
}

function categoryNumber(id: string): number {
  return Number(id.split('_', 1)[0]) || Number.MAX_SAFE_INTEGER;
}

function fallbackLabel(id: string): string {
  return id.replace(/_/g, ' ');
}

export function categoryLabel(id: string): string {
  return CATEGORY_LABELS[id] ?? fallbackLabel(id);
}

export function subcategoryLabel(categoryId: string, subcategoryId: string): string {
  return SUBCATEGORY_LABEL_OVERRIDES[`${categoryId}/${subcategoryId}`]
    ?? SUBCATEGORY_LABELS[subcategoryId]
    ?? fallbackLabel(subcategoryId);
}

export function buildSfxDirectoryCatalog(
  assets: readonly OnlineSfxPathLike[],
  categoryId?: string,
): SfxDirectoryCatalog {
  const categoryCounts = new Map<string, number>();
  const subcategoryCounts = new Map<string, number>();

  for (const asset of assets) {
    const directory = onlineSfxDirectory(asset);
    if (!directory) continue;
    categoryCounts.set(
      directory.category,
      (categoryCounts.get(directory.category) ?? 0) + 1,
    );
    if (directory.category === categoryId) {
      subcategoryCounts.set(
        directory.subcategory,
        (subcategoryCounts.get(directory.subcategory) ?? 0) + 1,
      );
    }
  }

  return {
    categories: [...categoryCounts.entries()]
      .map(([id, count]) => ({ id, count, label: categoryLabel(id) }))
      .sort((a, b) =>
        categoryNumber(a.id) - categoryNumber(b.id)
        || a.id.localeCompare(b.id)),
    subcategories: [...subcategoryCounts.entries()]
      .map(([id, count]) => ({
        id,
        count,
        label: subcategoryLabel(categoryId ?? '', id),
      }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, 'zh-CN')
        || a.id.localeCompare(b.id)),
  };
}

export function auditOnlineSfxDirectory(assets: readonly OnlineSfxPathLike[]): string[] {
  const errors: string[] = [];
  for (const asset of assets) {
    const path = assetPath(asset);
    const directory = onlineSfxDirectory(asset);
    if (!directory) {
      errors.push(`unmapped online SFX path: ${path || '(empty)'}`);
      continue;
    }
    if (!CATEGORY_LABELS[directory.category]) {
      errors.push(`missing category label: ${directory.category}`);
    }
    if (!SUBCATEGORY_LABELS[directory.subcategory]) {
      errors.push(
        `missing subcategory label: ${directory.category}/${directory.subcategory}`,
      );
    }
  }
  return [...new Set(errors)];
}
