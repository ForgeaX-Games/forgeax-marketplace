export interface MonsterRace {
  list: string[]
  morph: string
}

export type MonsterSubCategory = Record<string, MonsterRace>

export type MonsterTree = Record<string, MonsterSubCategory>

export const MONSTER_TREE: MonsterTree = {
  '类人型': {
    '亚人':     { list: ['哥布林', '矮人'],                       morph: 'humanoid' },
    '兽人':     { list: ['蜥蜴人', '狼人'],                       morph: 'humanoid' },
    '人形魔物': { list: ['骷髅', '石头人', '树人', '恶魔'],       morph: 'humanoid' },
  },
  '非人型': {
    '猛兽类': { list: ['狼', '熊', '狮鹫', '飞龙'],             morph: 'quadruped' },
    '巨龙类': { list: ['古龙'],                                  morph: 'quadruped' },
    '爬虫类': { list: ['蜘蛛', '甲虫'],                          morph: 'insectoid' },
    '异物':   { list: ['史莱姆', '宝箱怪', '食人花', '眼魔'],   morph: 'amorphous' },
  },
  '混合': {
    '漂浮类': { list: ['幽灵', '元素'],       morph: 'floating' },
    '异化类': { list: ['夺心魔'],             morph: 'humanoid' },
  },
}

export const MORPH_LABELS: Record<string, string> = {
  humanoid: '人形',
  quadruped: '四足',
  insectoid: '多足/虫形',
  amorphous: '不定形',
  floating: '漂浮',
}

/* ── Category icons ──────────────────────────────────────────────── */

export const CATEGORY_ICONS: Record<string, string> = {
  '类人型': '🧝',
  '非人型': '🐺',
  '混合':   '👻',
}

export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  '类人型': '直立/双足/接近人类轮廓',
  '非人型': '野兽/虫类/异物等非人形生物',
  '混合':   '灵体/漂浮/形态异化',
}

export const SUBCATEGORY_ICONS: Record<string, string> = {
  '亚人':     '🧌',
  '兽人':     '🐗',
  '人形魔物': '💀',
  '猛兽类':   '🐾',
  '巨龙类':   '🐉',
  '爬虫类':   '🕷',
  '异物':     '👁',
  '漂浮类':   '💨',
  '异化类':   '🧠',
}

export function getMorph(cat1: string, cat2: string): string {
  return MONSTER_TREE[cat1]?.[cat2]?.morph ?? 'quadruped'
}

export function getRaces(cat1: string, cat2: string): string[] {
  return MONSTER_TREE[cat1]?.[cat2]?.list ?? []
}

/* ── Body type presets ───────────────────────────────────────────── */

export interface BodyTypeOption {
  id: string
  label: string
  /** Human-readable Chinese descriptor written into the feature lock */
  prompt: string
}

export const BODY_TYPES: BodyTypeOption[] = [
  { id: 'default', label: '默认',  prompt: '默认体型、身材均衡、比例协调' },
  { id: 'stocky',  label: '矮壮',  prompt: '矮壮、肩宽、重心低' },
  { id: 'lean',    label: '细长',  prompt: '细长、纤瘦、四肢修长' },
  { id: 'giant',   label: '巨型',  prompt: '巨型、高大、压迫感十足的轮廓' },
  { id: 'agile',   label: '敏捷',  prompt: '敏捷、精悍、流线型身形' },
  { id: 'heavy',   label: '厚重',  prompt: '厚重、重甲包覆、体量庞大' },
  { id: 'compact', label: '紧凑',  prompt: '紧凑、小巧但结实' },
  { id: 'gangly',  label: '扭曲',  prompt: '扭曲、畸形、不对称的身体结构' },
]

export function getBodyType(id: string): BodyTypeOption | undefined {
  return BODY_TYPES.find(b => b.id === id)
}

/* ── Color palette presets ───────────────────────────────────────── */

export interface ColorPalette {
  id: string
  label: string
  primary: string    // 主色
  secondary: string  // 辅色
  accent: string     // 眼/发光点缀
}

export const COLOR_PALETTES: ColorPalette[] = [
  { id: 'shadow',  label: '暗影',   primary: '深灰',   secondary: '紫黑', accent: '暗紫光' },
  { id: 'fire',    label: '烈焰',   primary: '赤红',   secondary: '焦黑', accent: '金色火光' },
  { id: 'forest',  label: '森莽',   primary: '墨绿',   secondary: '苔绿', accent: '琥珀黄' },
  { id: 'royal',   label: '皇家',   primary: '宝蓝',   secondary: '银白', accent: '金边' },
  { id: 'bone',    label: '骸骨',   primary: '骨白',   secondary: '灰烬', accent: '幽蓝光' },
  { id: 'blood',   label: '绯血',   primary: '血红',   secondary: '漆黑', accent: '象牙白' },
  { id: 'toxic',   label: '剧毒',   primary: '毒绿',   secondary: '漆黑', accent: '荧紫' },
  { id: 'ice',     label: '冰霜',   primary: '冰蓝',   secondary: '雪白', accent: '银光' },
  { id: 'sand',    label: '沙砾',   primary: '土黄',   secondary: '棕褐', accent: '赤铜' },
]

export function getPalette(id: string): ColorPalette | undefined {
  return COLOR_PALETTES.find(p => p.id === id)
}
