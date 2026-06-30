import { globalState, type CombatType, type Gender, type ArtStyle, type CharacterRole, type CharacterProfile, type ImageModel } from './GlobalState'
import { BODY_TYPE_PRESETS, getBodyType, describeProfession, type BodyType } from './BodyTypes'
import { listNpcOccupations, describeNpcOccupation } from './NpcOccupations'
import { applyHideableTo } from './HideableImage'
import { apiModelIdForImageModel, turnaroundVendorForImageModel } from './promptRouter'
import { adaptPromptForImageModel } from './promptAdapter'
import {
  buildConceptStyleDirectives,
  buildFinalSheetStyleDirectives,
  type ConceptStyleCtx,
  type FinalSheetStyleCtx,
} from './conceptPromptStyles'
import {
  buildFinalSheetLayoutTemplate,
  type FinalSheetTemplateCtx,
} from './finalSheetPromptStyles'
import {
  MONSTER_TREE,
  BODY_TYPES as MONSTER_BODY_PRESETS,
  CATEGORY_ICONS as MONSTER_CAT_ICONS,
  SUBCATEGORY_ICONS as MONSTER_SUB_ICONS,
} from './MonsterClassification'
import {
  VEHICLE_CATEGORIES,
  VEHICLE_STYLES,
  VEHICLE_ERAS,
  getVehicleCategory,
  getVehicleSubtype,
  getVehicleStyle,
  getVehicleEra,
  isCustomVehicleSubtype,
} from './VehicleClassification'
import {
  generateTurnaroundFor3D,
  loadTurnaround3DHandoffViews,
  type TurnaroundViewAsset,
} from '../lib/api-client'

/**
 * 决定是否要把「职业 NPC / 路人」的角色设计流程自动跳到像素动画管线。
 *
 * 抽成纯函数是为了在 `__tests__/CharacterDesign.autoroute.test.ts` 里单独校验
 * 三条规则，不用把整个 CharacterDesign UI 挂到 happy-dom 里去——那条路径
 * 对 globalState / applyHideableTo / setTimeout 全都敏感，很脆弱。
 *
 * 规则：
 *   1. 必须有 `currentImage`——没图就没有「生成完」的概念。
 *   2. 角色必须是 `npc`——主角英雄保留原有流程（设定图 → 修改局部细节 → 选择管线）。
 *   3. 当前图与上次已跳转的图不同——避免用户切回 CharacterDesign tab 时被反复弹走。
 */
/** Map handler turnaround `{path,url}` objects to wb-gen3d handoff URL strings. */
export function buildGen3DHandoffViews(
  views: Partial<Record<'front' | 'back' | 'left' | 'right', TurnaroundViewAsset | undefined>>,
): { front: string; back?: string; left?: string; right?: string } | null {
  const front = views.front?.url?.trim()
  if (!front) return null
  const out: { front: string; back?: string; left?: string; right?: string } = { front }
  const back = views.back?.url?.trim()
  const left = views.left?.url?.trim()
  const right = views.right?.url?.trim()
  if (back) out.back = back
  if (left) out.left = left
  if (right) out.right = right
  return out
}

export function shouldAutoRouteNpcToPixel(
  role: CharacterRole | undefined | null,
  lastRoutedImage: string | null,
  currentImage: string | null,
): boolean {
  if (!currentImage) return false
  if (role !== 'npc') return false
  if (lastRoutedImage === currentImage) return false
  return true
}

/**
 * 生成概念图时的变体数量。
 *
 * - `hero`（主角英雄）：4 张 A/B/C/D 让玩家挑，原流程不变。
 * - `npc` （职业路人）：1 张就够——背景群众不值得 4 次模型调用 + 挑图点击，
 *   自动勾选单张概设让玩家直接点「生成设定图」。
 * - `monster`（怪物敌人）：4 张——BOSS 值得挑图，需要融合选择。
 *
 * 抽成纯函数便于在 `__tests__/CharacterDesign.autoroute.test.ts` 里一起测。
 */
export function conceptVariantCount(role: CharacterRole | undefined | null): number {
  // 单段 prompt 单张图：NPC（轻量、无需挑图）/ vehicle（载具是工业产品，
  // 4 张细微差别在 gameplay 里没有意义，1 张直接进入下游 wb-anim/vehicle-design
  // 的多视角切帧更省钱）。
  if (role === 'npc' || role === 'vehicle') return 1
  return 4
}

export function conceptGenButtonLabel(role: CharacterRole | undefined | null): string {
  if (role === 'npc') return '生成 NPC 参考稿'
  if (role === 'monster') return '生成 4 张怪物概念图'
  if (role === 'vehicle') return '生成载具设计图'
  return '生成 4 张概念图'
}

function cdRoleIcon(role: CharacterRole | 'hero'): string {
  const cls = 'cd-role-icon-svg'
  if (role === 'npc') {
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="5.5" r="2.5"/>
      <path d="M8.5 21v-4.8l1.2-5.2h4.6l1.2 5.2V21"/>
      <path d="M9.8 11 6.5 13.5"/>
      <path d="M14.2 11 17.5 13.5"/>
    </svg>`
  }
  if (role === 'monster') {
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 8 4.8 4.5"/>
      <path d="M17 8l2.2-3.5"/>
      <path d="M5.5 13c0-4 2.8-6.5 6.5-6.5s6.5 2.5 6.5 6.5v1.8c0 3.1-2.4 5.2-6.5 5.2s-6.5-2.1-6.5-5.2V13Z"/>
      <path d="M9 13h.01"/>
      <path d="M15 13h.01"/>
      <path d="M10 17h4"/>
    </svg>`
  }
  if (role === 'vehicle') {
    return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 14.5 6.2 9h11.6l2.2 5.5"/>
      <path d="M5.5 14.5h13c1 0 1.8.8 1.8 1.8V18H3.7v-1.7c0-1 .8-1.8 1.8-1.8Z"/>
      <circle cx="7.5" cy="18" r="1.8"/>
      <circle cx="16.5" cy="18" r="1.8"/>
      <path d="M8 9V6.5h8V9"/>
    </svg>`
  }
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3.5 16.2 7l-1.1 5.6H8.9L7.8 7 12 3.5Z"/>
    <path d="M9 12.6 6.5 20"/>
    <path d="M15 12.6 17.5 20"/>
    <path d="M9 16h6"/>
    <path d="M7.8 7H4.5"/>
    <path d="M16.2 7h3.3"/>
  </svg>`
}

/**
 * 是否跳过「修改局部细节 → final sheet」这一步。
 *
 * - hero：false——主角要逐个部件抠；
 * - npc：true——路人的概念图就是最终设定；
 * - monster：true——怪物的局部细节走 pixel-char 管线自己的编辑，
 *   不走英雄那套部件编辑面板。
 * - vehicle：true——载具是工业产品没有"部件细节修改"的概念，
 *   下游 wb-anim/vehicle-design 自己负责动画化。
 *
 * 函数名历史保留「ForNpc」后缀，语义已扩展到「任何不需要部件编辑的形态」。
 */
export function shouldSkipFinalSheetForNpc(role: CharacterRole | undefined | null): boolean {
  return role === 'npc' || role === 'monster' || role === 'vehicle'
}

/**
 * NPC prompt 中绝对不能出现的关键词——这些会让 Gemini 画成多视图 turnaround sheet。
 * 抽成纯函数供测试验证。
 */
export const NPC_PROMPT_FORBIDDEN_KEYWORDS = [
  'character reference sheet',
  'character design sheet',
  'reference sheet',
  'turnaround',
  'multiple views',
  'multiple angles',
  'front and back',
  'side view and back view',
  'back view',
  'Side view',
] as const

/**
 * 怪物概念图 prompt 的纯函数。
 *
 * 职责：
 *   - 输入一份极简的「怪物档案」字段（见入参类型），输出 1 段适合 Gemini /
 *     gpt-image-2 消费的正向提示词；
 *   - **强约束单个生物居中 / 全身 / 中性背景**——pixel-char 管线后续要把
 *     这张概念图作为参考去跑四视图和序列帧，背景干净很关键；
 *   - **严禁出现 `NPC_PROMPT_FORBIDDEN_KEYWORDS`**（`reference sheet`
 *     / `turnaround` / `multiple views`...）——这些是多视图触发词，会
 *     把 Gemini 引导去画 character sheet；
 *   - 根据 `monsterThreat` 调整描述力度：BOSS 强调震慑 / 巨大 /
 *     压迫感；精英强调独特徽记；普通怪不加戏。
 *
 * 抽成纯函数是为了在 `__tests__/CharacterDesign.monster.test.ts` 里
 * 单独校验关键词约束——UI 和 Gemini 调用链都不掺和。
 */
export interface MonsterPromptInput {
  name?: string
  /** 主分类，'类人型' / '非人型' / '混合'（参考 monster-gen/classification.ts） */
  monsterCategory?: string
  /** 次分类，'亚人' / '猛兽类' / '巨龙类' 等 */
  monsterSubCategory?: string
  /** 种族名，最细粒度识别词：'哥布林' / '飞龙' / '史莱姆' */
  monsterRace?: string
  /** 体型 id，参考 `BODY_TYPES`（stocky/lean/giant/agile/heavy/compact/gangly）。 */
  monsterBodyType?: string
  /** 威胁等级。缺省 'normal'。 */
  monsterThreat?: 'normal' | 'elite' | 'boss'
  /** 世界观标签，作为风格上下文（fantasy / cyberpunk / ...）。 */
  worldSetting?: string
}

const MONSTER_BODY_DESCRIPTOR: Record<string, string> = {
  stocky: 'stocky, broad-shouldered, low center of gravity',
  lean: 'lean, slender, long limbs',
  giant: 'giant, towering, imposing silhouette',
  agile: 'agile, lithe, streamlined',
  heavy: 'heavy, armored, massive bulk',
  compact: 'compact, small but tough',
  gangly: 'twisted, asymmetric, distorted anatomy',
}

const MONSTER_THREAT_DESCRIPTOR: Record<NonNullable<MonsterPromptInput['monsterThreat']>, string> = {
  normal: 'standard enemy creature, clear silhouette for gameplay readability',
  elite: 'elite variant, distinctive markings and accessories, slightly larger than common kin',
  boss: 'epic boss, menacing and towering, imposing cinematic presence, volumetric rim lighting',
}

export function buildMonsterConceptPrompt(input: MonsterPromptInput): string {
  const race = (input.monsterRace || input.monsterSubCategory || input.monsterCategory || 'creature').trim()
  const body = MONSTER_BODY_DESCRIPTOR[input.monsterBodyType ?? ''] ?? 'well-proportioned anatomy'
  const threat = MONSTER_THREAT_DESCRIPTOR[input.monsterThreat ?? 'normal']
  const world = (input.worldSetting || 'fantasy').trim()
  // 把种族名直接写入——中文保留识别度，英文泛化描述兜底
  const raceTag = `solo creature, single monster, ${race}`
  const positive = [
    '(masterpiece:1.3)',
    '(best quality:1.3)',
    '2D creature concept art',
    raceTag,
    `(${world} setting:1.2)`,
    'full body, centered composition, front-facing',
    body,
    threat,
    'clean readable silhouette',
    'neutral plain background, light grey background #e6e6e6',
    'no props, no UI, no text, no watermark',
  ].join(', ')
  // 强负面约束——用同义措辞避免直接重复可能触发多视图的禁词短语本身
  const negative =
    '(single pose only, one angle only, one viewpoint, no multi-pose grid, no multi-angle layout, no model showcase, no orthographic panel:1.5)' +
    ', NEGATIVE: no multiple creatures, no crowd, no human, no rider, no weapon held by human, no splash art, no dramatic battle scene'
  return `${positive}, ${negative}`
}

// ── Vehicle concept prompt ──────────────────────────────────────
/**
 * 载具概念图 prompt 的纯函数。
 *
 * 职责：
 *   - 把"载具档案"（大类/子类型/风格/时代/世界观/补充描述）拼成一段适合
 *     Gemini / gpt-image-2 消费的正向 prompt；
 *   - **强约束单个载具居中 / 全身 / 中性背景** —— 下游 wb-anim/vehicle-design
 *     管线要把这张概念图当参考去切多视角和动画帧，背景干净很关键；
 *   - 跟 `buildMonsterConceptPrompt` 一样，禁用 `NPC_PROMPT_FORBIDDEN_KEYWORDS`
 *     这套多视图触发词；
 *   - 当 subtype === 'custom' 时，用 `customSubtype` 文本（用户在 textarea
 *     里填的自由描述）替代 subtype.prompt，作为载具主体描述。
 *
 * 单元测试 → `__tests__/CharacterDesign.vehicle.test.ts`
 */
export interface VehiclePromptInput {
  /** 大类 id：ground / air / water / scifi / fantasy（参见 VEHICLE_CATEGORIES） */
  vehicleCategory?: string
  /** 子类型 id（必须属于 vehicleCategory）。'custom' 时启用 customSubtype */
  vehicleSubtype?: string
  /** subtype === 'custom' 时使用的自由描述文本 */
  vehicleSubtypeCustom?: string
  /** 风格 id（参见 VEHICLE_STYLES）。缺省时不加风格指令。 */
  vehicleStyle?: string
  /** 时代 id（参见 VEHICLE_ERAS）。缺省时不加时代指令。 */
  vehicleEra?: string
  /** 世界观（与角色共用 worldSetting 字段）。缺省按 'fantasy' 兜底。 */
  worldSetting?: string
  /** 补充描述（与角色共用 extraDesc 字段）。 */
  extraDesc?: string
}

export function buildVehicleConceptPrompt(input: VehiclePromptInput): string {
  const cat = getVehicleCategory(input.vehicleCategory)
  const sub = getVehicleSubtype(input.vehicleCategory, input.vehicleSubtype)
  const style = getVehicleStyle(input.vehicleStyle)
  const era = getVehicleEra(input.vehicleEra)
  const world = (input.worldSetting || 'fantasy').trim()

  // 主体：custom 走自由文本，其余走子类型自带的英文 prompt；都没填就退化到大类标签
  const subjectRaw = isCustomVehicleSubtype(sub)
    ? (input.vehicleSubtypeCustom || '').trim()
    : (sub?.prompt || '').trim()
  const subject = subjectRaw || (cat?.label ?? 'vehicle')

  const tags = [
    '(masterpiece:1.3)',
    '(best quality:1.3)',
    '2D vehicle concept art',
    `solo vehicle, single ${subject}`,
    `(${world} setting:1.1)`,
    'full body, centered composition, three-quarter front view',
    'clean readable silhouette, distinctive shape language',
    'neutral plain background, light grey background #e6e6e6',
    'no rider, no driver, no pilot, no human in or on the vehicle',
    'no props in foreground, no UI, no text, no watermark',
  ]
  if (style) tags.push(style.prompt)
  if (era) tags.push(era.prompt)
  if (input.extraDesc && input.extraDesc.trim()) {
    tags.push(input.extraDesc.trim())
  }
  const positive = tags.join(', ')

  // 跟 monster 同款多视图禁令——下游 vehicle-design 管线自己负责切多视角
  const negative =
    '(single pose only, one angle only, one viewpoint, no multi-pose grid, no multi-angle layout, no orthographic panel, no reference sheet:1.5)' +
    ', NEGATIVE: no human figure, no character, no driver, no rider, no crew member visible, no weapon held by human, no crowd'
  return `${positive}, ${negative}`
}

const STYLE_KEYWORDS: Record<string, { keywords: string }> = {
  pixel:      { keywords: 'Pixel art style, retro 16-bit game sprite, clean pixel edges, limited color palette,' },
  anime:      { keywords: 'Anime illustration style, cel shaded, vibrant saturated colors, clean sharp lines, smooth gradients,' },
  chibi:      { keywords: 'Chibi style, super deformed cute proportions, big head small body ratio, rounded soft shapes, kawaii,' },
  realistic:  { keywords: 'Highly detailed realistic rendering, PBR materials, cinematic quality, physically accurate lighting,' },
  painterly:  { keywords: 'Oil painting style, thick visible brushstrokes, painterly texture, rich color layering,' },
  flat:       { keywords: 'Flat vector design, minimal shading, bold solid colors, geometric shapes, clean silhouettes,' },
  ink:        { keywords: 'Chinese ink painting style, sumi-e brush strokes, xuan paper texture, elegant flowing lines,' },
  dark:       { keywords: 'Dark gothic style, grim desaturated tones, high contrast, heavy shadows, sharp angular shapes,' },
}

interface DetailPartDef {
  code: string; name: string; icon: string; position: string; hints: string[]
}

const DETAIL_PARTS: DetailPartDef[] = [
  { code: 'hair',            name: '头发',     icon: '💇', position: '头部',   hints: ['长发飘逸','短发利落','双马尾','渐变色','发饰','卷发','编发'] },
  { code: 'eyes',            name: '眼睛',     icon: '👁️', position: '面部',   hints: ['异色瞳','猫瞳','发光','星形瞳孔','深邃','温柔'] },
  { code: 'nose',            name: '鼻子',     icon: '👃', position: '面部',   hints: ['小巧','高挺','鹰钩鼻','鼻环','圆润'] },
  { code: 'mouth',           name: '嘴型',     icon: '👄', position: '面部',   hints: ['微笑','冷酷','虎牙','红唇','抿嘴','露齿笑'] },
  { code: 'face-tattoo',     name: '面部花纹', icon: '✨', position: '面部',   hints: ['魔法符文','战纹','疤痕','面具','刺青','发光印记'] },
  { code: 'outfit',          name: '服装',     icon: '👔', position: '全身',   hints: ['铠甲','长袍','战甲','连衣裙','皮夹克','制服','和服'] },
  { code: 'neck-accessory',  name: '脖颈装饰', icon: '📿', position: '颈部',   hints: ['项链','围巾','护颈','铃铛','领结','吊坠'] },
  { code: 'hand-accessory',  name: '手部装饰', icon: '🧤', position: '手部',   hints: ['手套','护腕','戒指','手链','绷带','爪形指'] },
  { code: 'waist-accessory', name: '腰部装饰', icon: '🎗️', position: '腰部',   hints: ['腰带','药水瓶','卷轴','挂饰','弹药带','钥匙'] },
  { code: 'leg-accessory',   name: '腿部装饰', icon: '🦵', position: '腿部',   hints: ['护腿','绑腿','腿甲','靴子装饰','踝链'] },
  { code: 'cape',            name: '披风',     icon: '🧣', position: '背部',   hints: ['长斗篷','短披肩','翅膀','背旗','兜帽','毛皮边'] },
  { code: 'weapon',          name: '武器道具', icon: '⚔️', position: '手持',   hints: ['燃烧巨剑','精灵长弓','发光法杖','战锤','双持匕首','狙击步枪','悬浮魔法书'] },
  { code: 'effect',          name: '特效',     icon: '🔥', position: '环绕',   hints: ['火焰','冰霜','雷电','光环','法阵','粒子','暗影'] },
  { code: 'pose',            name: '动作',     icon: '🏃', position: '全身',   hints: ['战斗姿态','施法','奔跑','跳跃','蹲伏','举剑','双手叉腰'] },
]

const PART_REGION_MAP: Record<string, string> = {
  'hair':            'hair / hairstyle on the head',
  'eyes':            'eyes / pupils / eye area on the face',
  'nose':            'nose area on the face',
  'mouth':           'mouth / lips area on the face',
  'face-tattoo':     'facial markings / tattoos / scars on the face',
  'outfit':          'clothing / outfit / armor covering the torso, arms, and legs',
  'neck-accessory':  'neck / collar area accessories',
  'hand-accessory':  'hands / wrists / fingers accessories',
  'waist-accessory': 'waist / belt area accessories',
  'leg-accessory':   'legs / calves / boots area',
  'cape':            'back / shoulders cape or cloak',
  'weapon':          'weapon / prop held in the character hand(s)',
  'effect':          'special effects / aura / particles around the character',
  'pose':            'full body pose / stance / action',
}

const EDIT_PREAMBLE =
  'You are performing a SURGICAL EDIT on an existing image. This is NOT a regeneration — it is a targeted local modification. '
  + 'The output image must be virtually identical to the input image, with ONLY the specified region changed. '
  + 'BACKGROUND PRESERVATION: The entire background, scene, lighting, atmosphere, colors, and composition MUST remain completely untouched and pixel-perfect identical to the input. Do NOT regenerate, alter, or reinterpret the background in any way. '
  + 'CHARACTER PRESERVATION: All parts of the character that are NOT being edited MUST remain pixel-perfect identical — same face, same hair, same pose, same proportions, same colors, same art style. '

const KEEP_FRAMING =
  'FRAMING: Maintain the exact same camera angle, framing, crop, and character position as the input image. '
  + 'Do NOT change the aspect ratio, zoom level, or composition. The character should occupy the same area of the frame.'

function buildDetailPrompt(partCode: string, userDesc: string): string {
  const partInfo = DETAIL_PARTS.find(p => p.code === partCode)
  const partName = partInfo?.name ?? partCode
  const region = PART_REGION_MAP[partCode] ?? partCode

  if (partCode === 'pose') {
    return EDIT_PREAMBLE
      + `TARGET EDIT: Change ONLY the character's body pose/action to: ${userDesc}. `
      + `The character's face, hairstyle, hair color, eye color, outfit, clothing design, weapon, accessories, special effects, art style, color palette, and the ENTIRE background MUST remain exactly the same as the input image. `
      + `Only the body pose, limb positions, and dynamic action should change. `
      + KEEP_FRAMING
  }
  if (partCode === 'weapon') {
    return EDIT_PREAMBLE
      + `TARGET EDIT: Replace ONLY the weapon/prop held in the character's hand(s) with: ${userDesc}. `
      + `The weapon/prop must appear naturally held with correct grip, perspective, and proportions — show the complete weapon from handle to tip. `
      + `The character's face, hairstyle, hair color, eye color, outfit, body proportions, pose, stance, accessories, special effects, and the ENTIRE background MUST remain pixel-perfect identical. `
      + `Only the weapon/prop in hand should change. `
      + KEEP_FRAMING
  }
  if (partCode === 'outfit') {
    return EDIT_PREAMBLE
      + `TARGET EDIT: Replace ONLY the character's outfit/clothing with: ${userDesc}. `
      + `The character's face, hairstyle, hair color, eye color, body proportions, pose, stance, weapon, and the ENTIRE background MUST remain pixel-perfect identical. `
      + `Only the clothing/armor/outfit should change. `
      + KEEP_FRAMING
  }
  return EDIT_PREAMBLE
    + `TARGET EDIT: ONLY modify the ${region} (${partName}) — change it to: ${userDesc}. `
    + `Do NOT alter anything else. The character's face, body shape, pose, clothing, colors, and the ENTIRE background MUST remain pixel-perfect identical to the input image. `
    + `The ONLY visible difference between input and output should be the ${partName}. `
    + KEEP_FRAMING
}

const CSS_ID = 'char-design-css'
const HISTORY_KEY = 'character-editor:design-history'
const MAX_HISTORY = 8

interface HistoryEntry {
  id: string
  name: string
  charClass: string
  imageData: string
  thumb: string
  timestamp: number
  /** 区分该历史来自哪个角色类型（主角/NPC/怪物/载具）。旧数据无此字段，按 hero 兜底。 */
  role?: CharacterRole
}

function roleHistoryLabel(role: CharacterRole | undefined | null): string {
  switch (role) {
    case 'npc': return 'NPC'
    case 'monster': return '怪物'
    case 'vehicle': return '载具'
    default: return '主角'
  }
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveHistory(entries: HistoryEntry[]): void {
  const list = entries.slice(0, MAX_HISTORY)
  for (let tries = list.length; tries >= 1; tries--) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, tries)))
      return
    } catch { /* quota exceeded, try fewer entries */ }
  }
}

function resizeImage(dataUrl: string, maxW: number, maxH: number, quality: number): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(maxW / img.width, maxH / img.height, 1)
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        c.getContext('2d')!.drawImage(img, 0, 0, w, h)
        const result = c.toDataURL('image/jpeg', quality)
        if (result && result.length > 50) {
          resolve(result)
        } else {
          resolve(dataUrl)
        }
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

async function compressForUpload(dataUrl: string, maxKB = 300): Promise<string> {
  let result = await resizeImage(dataUrl, 768, 768, 0.75)
  let b64Len = result.replace(/^data:[^;]+;base64,/, '').length
  if (b64Len > maxKB * 1370) {
    result = await resizeImage(dataUrl, 512, 512, 0.6)
  }
  b64Len = result.replace(/^data:[^;]+;base64,/, '').length
  if (b64Len > maxKB * 1370) {
    result = await resizeImage(dataUrl, 384, 384, 0.5)
  }
  return result
}

// ── IndexedDB: stores full-resolution images (hundreds of MB capacity) ──
const IDB_NAME = 'ce-hist-img'
const IDB_STORE = 'full'
let _db: IDBDatabase | null = null

function getDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE) }
    req.onsuccess = () => { _db = req.result; resolve(_db!) }
    req.onerror = () => reject(req.error)
  })
}

async function idbSave(id: string, data: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).put(data, id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function idbLoad(id: string): Promise<string | null> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const req = tx.objectStore(IDB_STORE).get(id)
    req.onsuccess = () => resolve((req.result as string) ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function idbRemove(id: string): Promise<void> {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    tx.objectStore(IDB_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const CONCEPT_IDB_PREFIX = 'ce-concept-'
const SELECTED_CONCEPT_KEY = 'ce-selected-concept'

async function saveConceptsToIDB(images: string[]): Promise<void> {
  await idbSave(CONCEPT_IDB_PREFIX + 'count', String(images.length))
  await Promise.all(images.map((img, i) => idbSave(CONCEPT_IDB_PREFIX + i, img)))
}
async function loadConceptsFromIDB(): Promise<string[]> {
  const countStr = await idbLoad(CONCEPT_IDB_PREFIX + 'count')
  if (!countStr) return []
  const count = parseInt(countStr, 10)
  if (!count || count <= 0) return []
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) => idbLoad(CONCEPT_IDB_PREFIX + i))
  )
  return results.filter((r): r is string => !!r)
}
async function clearConceptsFromIDB(): Promise<void> {
  // 读旧计数以便把对应 key 清掉；失败就忽略——下次 saveConceptsToIDB 会覆盖 count 键。
  try {
    const countStr = await idbLoad(CONCEPT_IDB_PREFIX + 'count')
    const count = countStr ? parseInt(countStr, 10) : 0
    await Promise.all(Array.from({ length: count }, (_, i) => idbRemove(CONCEPT_IDB_PREFIX + i)).concat([
      idbRemove(CONCEPT_IDB_PREFIX + 'count'),
      idbRemove(SELECTED_CONCEPT_KEY),
    ]))
  } catch (e) {
    console.warn('[Concept] clearConceptsFromIDB failed:', e)
  }
}

/** Save the selected concept art to IDB (called when user picks a concept to finalize). */
export async function saveSelectedConcept(dataUrl: string): Promise<void> {
  try { await idbSave(SELECTED_CONCEPT_KEY, dataUrl) } catch (e) { console.warn('[Concept] IDB save failed:', e) }
}

/** Load the selected concept art from IDB. Returns null if none stored. */
export async function loadSelectedConcept(): Promise<string | null> {
  try { return await idbLoad(SELECTED_CONCEPT_KEY) } catch { return null }
}

async function apiPost(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

const CLASS_OPTIONS = [
  '剑士', '狂战士', '魔法师', '元素师', '弓箭手', '枪手',
  '刺客', '暗影刺客', '格斗家', '圣骑士', '牧师', '召唤师',
  '忍者', '武僧', '机械师', '炼金术士', '驱魔师', '吟游诗人',
]

const RANGED_CLASSES = new Set(['魔法师', '元素师', '弓箭手', '枪手', '牧师', '召唤师', '机械师', '吟游诗人'])
const MELEE_CLASSES = new Set(['剑士', '狂战士', '刺客', '暗影刺客', '格斗家', '圣骑士', '忍者', '武僧', '驱魔师'])

/* ── Monster form rendering ──────────────────────────────────────
 * 复用 `pipelines/monster-gen/classification.ts` 的数据结构：
 *   - MONSTER_TREE：三层分类（主类 → 次类 → 种族）
 *   - MONSTER_BODY_PRESETS：体型 7 档
 *
 * UI 约束：只有当 `characterRole === 'monster'` 时这整块可见，隐藏主角专属
 * 的「职业 / 战斗类型 / 形态」——它们跟怪物分类冲突。
 */
interface CharacterProfileRenderView {
  characterRole: CharacterRole
  monsterCategory?: string
  monsterSubCategory?: string
  monsterRace?: string
  monsterBodyType?: string
  monsterThreat?: 'normal' | 'elite' | 'boss'
}

function renderMonsterFields(p: CharacterProfileRenderView): string {
  const visible = p.characterRole === 'monster'
  const style = `style="display:${visible ? '' : 'none'}"`
  const cat = p.monsterCategory ?? ''
  const sub = p.monsterSubCategory ?? ''
  const subOptions = cat && MONSTER_TREE[cat] ? Object.keys(MONSTER_TREE[cat]) : []
  const raceOptions = cat && sub && MONSTER_TREE[cat]?.[sub] ? MONSTER_TREE[cat][sub].list : []
  const threat = p.monsterThreat ?? 'normal'

  // ── drilldown:主分类 → 次分类 → 种族 ────────────────────────────
  // 没选主分类时只显示主分类区;选完才依次展开下一层。breadcrumb
  // 在「分类路径」label 上简短展示当前层级。
  const crumb = cat
    ? (sub
        ? `<span class="cd-crumb">${esc(cat)} <span class="cd-crumb-sep">›</span> ${esc(sub)}</span>`
        : `<span class="cd-crumb">${esc(cat)}</span>`)
    : ''

  return `
          <div class="cd-field" data-cd-role="monster-only" ${style}>
            <label class="cd-label">怪物分类 ${crumb}</label>
            <select class="cd-select" data-cd="monster-cat-select">
              <option value="">选择怪物分类</option>
              ${Object.keys(MONSTER_TREE).map(k => `<option value="${esc(k)}" ${cat === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}
            </select>
          </div>

          <div class="cd-field" data-cd-role="monster-only" style="display:${visible && cat ? '' : 'none'}">
            <label class="cd-label">次分类 <span class="cd-optional">(决定基础形态)</span></label>
            <select class="cd-select" data-cd="monster-sub-select">
              <option value="">选择次分类</option>
              ${subOptions.map(s => `<option value="${esc(s)}" ${sub === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}
            </select>
          </div>

          <div class="cd-field" data-cd-role="monster-only" style="display:${visible && cat && sub ? '' : 'none'}">
            <label class="cd-label">种族 <span class="cd-optional">(最细识别词;可自定义)</span></label>
            <select class="cd-select" data-cd="monster-race-select">
              <option value="">选择种族</option>
              ${raceOptions.map(r => `<option value="${esc(r)}" ${p.monsterRace === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}
            </select>
            <input class="cd-input cd-input-sm" data-cd="monster-race-custom" type="text"
              placeholder="或自定义种族名..." value="${raceOptions.includes(p.monsterRace ?? '') ? '' : esc(p.monsterRace ?? '')}" />
          </div>

          <div class="cd-field-row" data-cd-role="monster-only" style="display:${visible && cat ? '' : 'none'}">
            <div class="cd-field cd-field-half">
              <label class="cd-label">体型</label>
              <select class="cd-select" data-cd="monster-body-select">
                ${MONSTER_BODY_PRESETS.map(b => `<option value="${esc(b.id)}" ${(p.monsterBodyType ?? 'default') === b.id ? 'selected' : ''}>${esc(b.label)}</option>`).join('')}
              </select>
            </div>
            <div class="cd-field cd-field-half">
              <label class="cd-label">威胁等级</label>
              <select class="cd-select" data-cd="monster-threat-select">
                <option value="normal" ${threat === 'normal' ? 'selected' : ''}>普通</option>
                <option value="elite" ${threat === 'elite' ? 'selected' : ''}>精英</option>
                <option value="boss" ${threat === 'boss' ? 'selected' : ''}>BOSS</option>
              </select>
            </div>
          </div>
  `
}

/* ── Vehicle form rendering ──────────────────────────────────────
 * 走载具自己的产线分类（VEHICLE_CATEGORIES / STYLES / ERAS），跟 hero/npc/
 * monster 的字段完全不同。整块外面包 `data-cd-role="vehicle-only"`，
 * 只在 `characterRole === 'vehicle'` 时显示。
 *
 * 子类型 chip 区会随 vehicleCategory 变化重渲（renderForm 会整页重建），
 * 自定义子类型独立 textarea 用 vehicleSubtypeCustom 字段存。
 */
interface VehicleProfileRenderView {
  characterRole: CharacterRole
  vehicleCategory?: string
  vehicleSubtype?: string
  vehicleSubtypeCustom?: string
  vehicleStyle?: string
  vehicleEra?: string
}

function renderVehicleFields(p: VehicleProfileRenderView): string {
  const visible = p.characterRole === 'vehicle'
  const style = `style="display:${visible ? '' : 'none'}"`
  const catId = p.vehicleCategory ?? ''
  const cat = getVehicleCategory(catId)
  const sub = getVehicleSubtype(catId, p.vehicleSubtype ?? '')
  const showCustomTextarea = isCustomVehicleSubtype(sub)
  const styleId = p.vehicleStyle ?? ''
  const eraId = p.vehicleEra ?? ''

  // breadcrumb 仅在已选大类时出现,避免空 label
  const crumb = cat
    ? (sub
        ? `<span class="cd-crumb">${esc(cat.label)} <span class="cd-crumb-sep">›</span> ${esc(sub.label)}</span>`
        : `<span class="cd-crumb">${esc(cat.label)}</span>`)
    : ''

  return `
          <div class="cd-field" data-cd-role="vehicle-only" ${style}>
            <label class="cd-label">载具大类 ${crumb}</label>
            <select class="cd-select" data-cd="vehicle-cat-select">
              <option value="">选择载具大类</option>
              ${VEHICLE_CATEGORIES.map(c => `<option value="${esc(c.id)}" ${catId === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
            </select>
          </div>

          <div class="cd-field" data-cd-role="vehicle-only" style="display:${visible && cat ? '' : 'none'}">
            <label class="cd-label">载具子类型 <span class="cd-optional">(决定生成时的载具主体描述)</span></label>
            <select class="cd-select" data-cd="vehicle-subtype-select">
              <option value="">选择载具子类型</option>
              ${cat ? cat.subtypes.map(s => `<option value="${esc(s.id)}" ${p.vehicleSubtype === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('') : ''}
            </select>
            <textarea class="cd-textarea" data-cd="vehicle-subtype-custom" rows="2"
              placeholder="自定义载具描述,例如:六足蜘蛛形机甲,前端搭载激光炮塔..."
              style="display:${showCustomTextarea ? '' : 'none'};margin-top:6px">${esc(p.vehicleSubtypeCustom ?? '')}</textarea>
          </div>

          <div class="cd-field-row" data-cd-role="vehicle-only" style="display:${visible && cat ? '' : 'none'}">
            <div class="cd-field cd-field-half">
              <label class="cd-label">美术风格 <span class="cd-optional">(可选)</span></label>
              <select class="cd-select" data-cd="vehicle-style-select">
                <option value="" ${!styleId ? 'selected' : ''}>默认</option>
                ${VEHICLE_STYLES.map(s => `<option value="${esc(s.id)}" ${styleId === s.id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}
              </select>
            </div>
            <div class="cd-field cd-field-half">
              <label class="cd-label">时代背景 <span class="cd-optional">(可选)</span></label>
              <select class="cd-select" data-cd="vehicle-era-select">
                <option value="" ${!eraId ? 'selected' : ''}>默认</option>
                ${VEHICLE_ERAS.map(e => `<option value="${esc(e.id)}" ${eraId === e.id ? 'selected' : ''}>${esc(e.label)}</option>`).join('')}
              </select>
            </div>
          </div>
  `
}

const CLASS_EN: Record<string, string> = {
  '剑士': 'Swordsman', '狂战士': 'Berserker', '魔法师': 'Mage', '元素师': 'Elementalist',
  '弓箭手': 'Archer', '枪手': 'Gunner', '刺客': 'Assassin', '暗影刺客': 'Shadow Assassin',
  '格斗家': 'Brawler', '圣骑士': 'Paladin', '牧师': 'Priest', '召唤师': 'Summoner',
  '忍者': 'Ninja', '武僧': 'Monk', '机械师': 'Mechanic', '炼金术士': 'Alchemist',
  '驱魔师': 'Exorcist', '吟游诗人': 'Bard',
}

const AGE_OPTIONS = ['少年 (14-17)', '青年 (18-25)', '壮年 (26-35)', '中年 (36-50)', '老年 (50+)']

const ART_STYLE_OPTIONS: { id: ArtStyle; icon: string; label: string; hint: string; gradient: string }[] = [
  { id: 'pixel',      icon: '🕹️', label: '像素风',     hint: '复古独立游戏',       gradient: 'linear-gradient(135deg, #4a6741, #8bac7e)' },
  { id: 'anime',      icon: '✨', label: '日式动漫',   hint: '视觉小说 / 二次元', gradient: 'linear-gradient(135deg, #e85d8c, #8b5cf6)' },
  { id: 'chibi',      icon: '🧸', label: 'Q版',        hint: '休闲萌系',           gradient: 'linear-gradient(135deg, #fbbf24, #f472b6)' },
  { id: 'realistic',  icon: '📷', label: '写实',       hint: '3A / 电影级',        gradient: 'linear-gradient(135deg, #374151, #6b7280)' },
  { id: 'painterly',  icon: '🖌️', label: '厚涂',       hint: '卡牌 / 艺术',        gradient: 'linear-gradient(135deg, #92400e, #d97706)' },
  { id: 'flat',       icon: '◼️', label: '扁平矢量',   hint: '极简休闲',           gradient: 'linear-gradient(135deg, #0ea5e9, #22d3ee)' },
  { id: 'ink',        icon: '🏔️', label: '水墨国风',   hint: '武侠仙侠',           gradient: 'linear-gradient(135deg, #1c1917, #78716c)' },
  { id: 'dark',       icon: '💀', label: '暗黑哥特',   hint: '恐怖 / 暗黑',        gradient: 'linear-gradient(135deg, #18181b, #991b1b)' },
]

const WORLD_OPTIONS: { id: string; icon: string; label: string; en: string; desc: string }[] = [
  { id: 'medieval-fantasy', icon: '⚔️', label: '中世纪奇幻', en: 'Medieval Fantasy', desc: '剑与魔法的经典世界' },
  { id: 'dark-fantasy', icon: '🌑', label: '黑暗奇幻', en: 'Dark Fantasy', desc: '哥特风、黑暗灵魂' },
  { id: 'eastern-fantasy', icon: '🐉', label: '东方仙侠', en: 'Eastern Wuxia/Xianxia', desc: '修仙、武侠、东方神话' },
  { id: 'cyberpunk', icon: '🌆', label: '赛博朋克', en: 'Cyberpunk', desc: '高科技低生活、霓虹都市' },
  { id: 'sci-fi', icon: '🚀', label: '科幻未来', en: 'Sci-Fi Futuristic', desc: '太空歌剧、星际战争' },
  { id: 'post-apocalypse', icon: '☢️', label: '末日废土', en: 'Post-Apocalyptic', desc: '文明崩塌后的荒野' },
  { id: 'steampunk', icon: '⚙️', label: '蒸汽朋克', en: 'Steampunk', desc: '蒸汽机械与维多利亚美学' },
  { id: 'modern-urban', icon: '🏙️', label: '现代都市', en: 'Modern Urban', desc: '现实都市、都市异能' },
  { id: 'pirate-nautical', icon: '🏴‍☠️', label: '海盗航海', en: 'Pirate / Nautical', desc: '大航海、海盗冒险' },
  { id: 'mythology', icon: '🏛️', label: '神话史诗', en: 'Mythology / Epic', desc: '希腊/北欧/埃及等神话' },
]

type DesignPhase = 'form' | 'concepts' | 'final' | 'detail'

interface DetailPartMod {
  code: string
  description: string
  modifiedAt: number
}

interface DetailHistoryEntry {
  version: number
  dataUrl: string
  partCode: string
  partIcon: string
  partName: string
  description: string
}

export class CharacterDesign {
  private leftEl: HTMLElement | null = null
  private centerEl: HTMLElement | null = null
  private refImageData: string | null = null
  /** 「补全设定」上传的任意尺寸参考图（单独存，避免和图生图干扰）。 */
  private completeRefImage: string | null = null
  private activeMethod: 'text' | 'upload' | 'direct' = 'text'
  private generating = false
  /** 当前进度条 data-cd id，跨 unmount/remount 与 split-pane 同步用。 */
  private progressId: string | null = null
  private progressText: string | null = null
  private activeHistoryId: string | null = null

  private phase: DesignPhase = 'form'
  private conceptImages: string[] = []
  private selectedConcepts: Set<number> = new Set()
  private fusionDesc: string = ''

  private detailCurrentPart: string | null = null
  private detailParts: Record<string, DetailPartMod> = {}
  private detailHistory: DetailHistoryEntry[] = []
  private detailVersion = 0

  private conceptDetailOpen = false
  private conceptDetailPart: string | null = null
  private conceptDetailVersion = 0

  /** 3D-ready orthographic view URLs for wb-gen3d handoff (hero/monster final phase). */
  private turnaround3DViews: { front: string; back?: string; left?: string; right?: string } | null = null
  private turnaround3DCharId: string | null = null
  private turnaroundHydrateGen = 0
  private finalPreviewHydrateGen = 0
  private generatingTurnaround3D = false

  /**
   * 路人 NPC 一次性自动跳转到像素管线的记忆位。
   *
   * 仅当 `characterImage` 的 dataUrl 本身变化时再次触发——否则 `refreshCenter()`
   * 在 `final` 阶段反复被调用（切 tab / 回到面板）会把用户弹走第二次。
   *
   * 持久化到 sessionStorage：split-pane / tab 切换会重建 CharacterDesign 实例，
   * 若记忆只存实例字段，切回 character tab 时记忆丢失 → renderFinalCenter 末尾
   * 又触发 maybeAutoRouteNpcToPixel → 立刻被弹回 anim（反复跳转 bug）。
   * sessionStorage 跨实例存活、会话结束自动清除，正好符合「本会话该图已跳过就别再跳」。
   */
  private static readonly NPC_ROUTED_KEY = 'forgeax:cd-npc-routed-image'
  private static readonly GEN_ACTIVE_KEY = 'ce:generating'
  private static readonly GEN_PROGRESS_ID_KEY = 'ce:gen-progress-id'
  private static readonly GEN_PROGRESS_TEXT_KEY = 'ce:gen-progress-text'
  private static readonly GEN_STARTED_AT_KEY = 'ce:gen-started-at'
  /** 超过此时长的 generating 快照视为过期（整页刷新后 API 已中断）。 */
  private static readonly GEN_STALE_MS = 30 * 60 * 1000
  private get _npcAutoRoutedForImage(): string | null {
    try { return sessionStorage.getItem(CharacterDesign.NPC_ROUTED_KEY) } catch { return null }
  }
  private set _npcAutoRoutedForImage(v: string | null) {
    try {
      if (v == null) sessionStorage.removeItem(CharacterDesign.NPC_ROUTED_KEY)
      else sessionStorage.setItem(CharacterDesign.NPC_ROUTED_KEY, v)
    } catch { /* sessionStorage 不可用 — 退化为不记忆(可能多跳一次,但不致命) */ }
  }

  // ── Split-pane sync (Module 16) ──────────────────────────────────
  // Studio 把本插件以两个同源 iframe 嵌入：?pane=left (Sidebar 表单)
  // 和 ?pane=center (MainArea 预览)。每个 iframe 都跑一份 CharacterDesign
  // 实例，CSS 只显隐对应的 leftEl / centerEl。当用户在 left iframe 点生成
  // 时, conceptImages 被写到该 iframe 的 centerEl(已 display:none),
  // center iframe 完全感知不到。这里用 BroadcastChannel 在两份实例间
  // 镜像 phase / conceptImages / selectedConcepts; 接收方重读 IDB+sessionStorage
  // 然后调自己的 refreshCenter()/refreshLeftActions(),把变化体现在对方
  // 那份可见 DOM 上。
  private _bc: BroadcastChannel | null = null
  private _bcSelfId = Math.random().toString(36).slice(2, 10)
  private _applyingBroadcast = false

  /**
   * 左侧表单当前渲染所用的 characterRole。split-pane 下另一个 iframe 改了
   * role 会经 localStorage → 'storage' 事件 → globalState.notify() 传到
   * 本 iframe,但只有订阅者才会触发重渲。这里记录"已渲染的 role",在
   * globalState 订阅回调里对比,role 真变了才 buildLeft()+refreshCenter(),
   * 避免每次 notify 都全量重渲(以及 input 重建导致的失焦)。
   */
  private _renderedRole: CharacterRole | null = null
  private _unsubscribeState: (() => void) | null = null

  private setupBroadcast(): void {
    if (this._bc) return
    try {
      this._bc = new BroadcastChannel('forgeax-plugin.@forgeax-plugin/wb-character.cd-state')
    } catch {
      this._bc = null
      return
    }
    this._bc.onmessage = (e) => { void this.handleBroadcast(e) }
  }

  private async handleBroadcast(e: MessageEvent): Promise<void> {
    const data = (e.data ?? {}) as {
      type?: string
      source?: string
      phase?: DesignPhase
      conceptCount?: number
      selectedConcepts?: number[]
      fusionDesc?: string
      generating?: boolean
      progressId?: string | null
      progressText?: string | null
    }
    if (data.source === this._bcSelfId) return
    if (data.type === 'cd-request-sync') {
      this.broadcastState()
      return
    }
    if (data.type !== 'cd-state') return
    if (!this.leftEl && !this.centerEl) return // not mounted yet

    this._applyingBroadcast = true
    try {
      if (data.phase) this.phase = data.phase
      if (data.fusionDesc !== undefined) this.fusionDesc = data.fusionDesc
      if (data.selectedConcepts) this.selectedConcepts = new Set(data.selectedConcepts)

      // 概念图 dataURL 走 IDB 共享存储,这里只按 count 决定是否重读
      const wantCount = data.conceptCount ?? 0
      if (wantCount > 0 && this.conceptImages.length !== wantCount) {
        // 跨 iframe IDB 一致性无保证:发送端可能刚 broadcast、IDB 事务还没
        // 对本 context 可见。读空就退避重试几次,避免永远卡在"正在加载概念图"。
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            const full = await loadConceptsFromIDB()
            if (full.length >= wantCount) { this.conceptImages = full; break }
            if (full.length > 0 && attempt >= 3) { this.conceptImages = full; break }
          } catch { /* ignore — 下一轮重试 */ }
          await new Promise((r) => setTimeout(r, 150))
        }
      } else if (wantCount === 0) {
        this.conceptImages = []
      }

      // final / detail phase 的成品图走 globalState.characterImage(localStorage),
      // 跨 iframe 靠 'storage' 事件同步,可能晚于本条 BroadcastChannel 消息到达。
      // 若广播说进了 final/detail 但本地 image 还没同步过来,退避重试,避免成品图
      // 区域永远停在"加载中..."。
      if ((this.phase === 'final' || this.phase === 'detail') && !globalState.get().characterImage) {
        for (let attempt = 0; attempt < 6 && !globalState.get().characterImage; attempt++) {
          await new Promise((r) => setTimeout(r, 150))
        }
      }

      if (data.generating) {
        this.progressId = data.progressId ?? 'progress'
        this.progressText = data.progressText ?? '生成中...'
      } else if (!this.generating) {
        this.progressId = null
        this.progressText = null
        this.setGenBtnState(false)
        this.applyProgressDom('progress', false)
        this.applyProgressDom('progress-img', false)
        this.applyProgressDom('progress-complete', false)
        this.applyProgressDom('detail-progress', false)
        this.applyProgressDom('cdetail-progress', false)
      }

      this.refreshCenter()
      this.refreshLeftActions()
    } finally {
      this._applyingBroadcast = false
    }
  }

  private broadcastState(): void {
    if (this._applyingBroadcast) return
    if (!this._bc) return
    try {
      this._bc.postMessage({
        type: 'cd-state',
        source: this._bcSelfId,
        phase: this.phase,
        conceptCount: this.conceptImages.length,
        selectedConcepts: [...this.selectedConcepts],
        fusionDesc: this.fusionDesc,
        generating: this.generating || this.isPersistedGenerationActive(),
        progressId: this.progressId,
        progressText: this.progressText,
      })
    } catch { /* */ }
  }

  private requestSyncFromPeer(): void {
    if (!this._bc) return
    try {
      this._bc.postMessage({ type: 'cd-request-sync', source: this._bcSelfId })
    } catch { /* */ }
  }

  private isPersistedGenerationActive(): boolean {
    try {
      if (sessionStorage.getItem(CharacterDesign.GEN_ACTIVE_KEY) !== '1') return false
      const started = parseInt(sessionStorage.getItem(CharacterDesign.GEN_STARTED_AT_KEY) || '0', 10)
      if (started && Date.now() - started > CharacterDesign.GEN_STALE_MS) {
        this.clearGenerationSnapshot()
        return false
      }
      return true
    } catch {
      return false
    }
  }

  private isGenerationActive(): boolean {
    return this.generating || this.isPersistedGenerationActive()
  }

  private persistGenerationSnapshot(): void {
    try {
      const active = this.generating
      if (active) {
        sessionStorage.setItem(CharacterDesign.GEN_ACTIVE_KEY, '1')
        if (!sessionStorage.getItem(CharacterDesign.GEN_STARTED_AT_KEY)) {
          sessionStorage.setItem(CharacterDesign.GEN_STARTED_AT_KEY, String(Date.now()))
        }
        sessionStorage.setItem(CharacterDesign.GEN_PROGRESS_ID_KEY, this.progressId || 'progress')
        sessionStorage.setItem(CharacterDesign.GEN_PROGRESS_TEXT_KEY, this.progressText || '生成中...')
      } else {
        this.clearGenerationSnapshot()
      }
    } catch { /* quota */ }
  }

  private clearGenerationSnapshot(): void {
    try {
      sessionStorage.removeItem(CharacterDesign.GEN_ACTIVE_KEY)
      sessionStorage.removeItem(CharacterDesign.GEN_PROGRESS_ID_KEY)
      sessionStorage.removeItem(CharacterDesign.GEN_PROGRESS_TEXT_KEY)
      sessionStorage.removeItem(CharacterDesign.GEN_STARTED_AT_KEY)
    } catch { /* */ }
  }

  private readGenerationSnapshot(): { progressId: string; progressText: string } {
    try {
      return {
        progressId: sessionStorage.getItem(CharacterDesign.GEN_PROGRESS_ID_KEY) || 'progress',
        progressText: sessionStorage.getItem(CharacterDesign.GEN_PROGRESS_TEXT_KEY) || '生成中...',
      }
    } catch {
      return { progressId: 'progress', progressText: '生成中...' }
    }
  }

  /** remount / 跨 pane 广播后恢复进度条与中央占位，不重复写 sessionStorage。 */
  private restoreGenerationUI(): void {
    if (!this.isGenerationActive()) return
    const snap = this.readGenerationSnapshot()
    const id = this.progressId || snap.progressId
    const text = this.progressText || snap.progressText
    this.progressId = id
    this.progressText = text
    this.applyProgressDom(id, true, text)
    this.setGenBtnState(true)
    this.patchCenterGeneratingOverlay(text)
  }

  constructor() {
    injectCSS()
    this.restoreSession()
    this.setupBroadcast()
  }

  mount(left: HTMLElement, center: HTMLElement): void {
    this.leftEl = left
    this.centerEl = center
    this.buildLeft()
    this.buildCenter()
    this.wireRoleTabBar()
    this.syncFromState()
    this.subscribeRoleSync()
    this.loadConceptsFromStorage()
    if (this.phase === 'detail') {
      this.rebuildLeftForDetail()
    }
    this.restoreGenerationUI()
    this.requestSyncFromPeer()
  }

  /**
   * 订阅 globalState,处理 split-pane 下另一个 iframe 改了 characterRole 的
   * 跨 iframe 同步:center iframe 点角色 tab → updateProfile() 写 localStorage
   * → 本(left)iframe 'storage' 事件 → globalState.load()+notify() → 此回调。
   * 因为表单(buildLeft)和中央(refreshCenter)是手动渲染的、没有响应式绑定,
   * 必须在这里检测 role 变化并主动重渲,否则左侧表单不会跟着切。
   *
   * 只在 role 真的变化时重渲,避免 notify 风暴里反复 rebuild 输入框导致失焦。
   */
  private subscribeRoleSync(): void {
    if (this._unsubscribeState) return
    this._renderedRole = globalState.profile?.characterRole ?? 'hero'
    this._unsubscribeState = globalState.subscribe(() => {
      const role = globalState.profile?.characterRole ?? 'hero'
      // 仅按「已渲染 role」判重,不再用 _applyingBroadcast 早退:role 经
      // localStorage 'storage' 事件传到另一个 pane 时,该 pane 可能恰好在
      // handleBroadcast(_applyingBroadcast=true)中,早退会让它永久错过这次
      // role 变更、左侧表单不跟着切。改用 _renderedRole 比较即可避免重复重渲。
      if (role === this._renderedRole) return
      this._renderedRole = role
      // role 切换:概念图/选择态作废,回到表单态,左右两侧都重渲。
      this.conceptImages = []
      this.selectedConcepts.clear()
      if (this.phase !== 'form') this.phase = 'form'
      this.buildLeft()
      this.refreshCenter()
    })
  }

  private saveSession(): void {
    try {
      sessionStorage.setItem('ce:phase', this.phase)
      if (this.phase === 'concepts' && this.conceptImages.length > 0) {
        sessionStorage.setItem('ce:concept-count', String(this.conceptImages.length))
      }
    } catch { /* quota */ }
  }

  private restoreSession(): void {
    try {
      const phase = sessionStorage.getItem('ce:phase') as DesignPhase | null
      const count = parseInt(sessionStorage.getItem('ce:concept-count') || '0', 10)
      if (phase === 'detail' && globalState.get().characterImage) {
        this.phase = 'detail'
      } else if (phase === 'concepts' && count > 0) {
        this.phase = 'concepts'
        this._needLoadFromIDB = true
      } else if (phase === 'final' && globalState.get().characterImage) {
        this.phase = 'final'
      } else {
        this.phase = 'form'
      }
      if (this.isPersistedGenerationActive()) {
        const snap = this.readGenerationSnapshot()
        this.progressId = snap.progressId
        this.progressText = snap.progressText
      }
    } catch { this.phase = 'form' }
  }

  private _needLoadFromIDB = false

  private async loadConceptsFromStorage(): Promise<void> {
    if (!this._needLoadFromIDB) return
    this._needLoadFromIDB = false
    try {
      const full = await loadConceptsFromIDB()
      if (full.length > 0) {
        this.conceptImages = full
        this.refreshCenter()
      } else {
        this.phase = 'form'
        this.refreshCenter()
        this.refreshLeftActions()
      }
    } catch {
      this.phase = 'form'
      this.refreshCenter()
      this.refreshLeftActions()
    }
  }

  unmount(): void {
    this.persistGenerationSnapshot()
    this.leftEl = null
    this.centerEl = null
  }

  /**
   * 渲染中央内容区顶部的「角色定位」4-tab 条:主角 / NPC / 怪物 / 载具。
   * 与 wb-anim 顶部的「像素角色 / 载具设计 / Spine 骨骼 / 视频角色」同谱。
   *
   * 这条 tab 在 4 个 phase(form / concepts / final / detail)的 centerEl
   * 渲染入口都会被前置一次,所以无论用户当前在生成流程的哪一步,都能
   * 看到并切换大类。click 事件用委托(wireRoleTabBar),挂在 centerEl 上
   * 一次,不会因为 phase 切换 innerHTML 导致丢失。
   */
  private roleTabBarHTML(): string {
    const r = globalState.profile?.characterRole
    const isHero = !r || r === 'hero'
    return `
      <div class="cd-role-tabbar">
        <button class="cd-role-tab ${isHero ? 'active' : ''}" data-cd-role-tab="hero" title="主角英雄走完整战斗管线">
          <span class="cd-role-icon">${cdRoleIcon('hero')}</span><span class="cd-role-label">主角</span>
        </button>
        <button class="cd-role-tab ${r === 'npc' ? 'active' : ''}" data-cd-role-tab="npc" title="职业 NPC 是普通路人,直达像素管线">
          <span class="cd-role-icon">${cdRoleIcon('npc')}</span><span class="cd-role-label">NPC</span>
        </button>
        <button class="cd-role-tab ${r === 'monster' ? 'active' : ''}" data-cd-role-tab="monster" title="敌方生物 / BOSS">
          <span class="cd-role-icon">${cdRoleIcon('monster')}</span><span class="cd-role-label">怪物</span>
        </button>
        <button class="cd-role-tab ${r === 'vehicle' ? 'active' : ''}" data-cd-role-tab="vehicle" title="可驾驶 / 可骑乘的产线产物">
          <span class="cd-role-icon">${cdRoleIcon('vehicle')}</span><span class="cd-role-label">载具</span>
        </button>
      </div>
    `
  }

  /**
   * centerEl 上的 role-tab 委托。每次 refreshCenter 都会重写 centerEl
   * 的 innerHTML,但 listener 挂在 centerEl 本身,不受 innerHTML 重写
   * 影响,所以只需要 mount 时挂一次。
   *
   * 切 role 的副作用与原来 wireGroup('role') 完全一致:清掉非当前
   * role 的专属字段、重置概念图、buildLeft 重渲、回到 form phase。
   */
  private wireRoleTabBar(): void {
    if (!this.centerEl) return
    this.centerEl.addEventListener('click', (e) => {
      const target = (e.target as HTMLElement)?.closest('[data-cd-role-tab]') as HTMLElement | null
      if (!target) return
      const val = target.dataset.cdRoleTab
      if (!val) return
      const role: CharacterRole =
        val === 'npc' ? 'npc'
        : val === 'monster' ? 'monster'
        : val === 'vehicle' ? 'vehicle'
        : 'hero'
      const prev = globalState.profile.characterRole
      if (prev === role) return
      const monsterFields: Partial<CharacterProfile> = role === 'monster'
        ? {}
        : {
            monsterCategory: undefined,
            monsterSubCategory: undefined,
            monsterRace: undefined,
            monsterBodyType: undefined,
            monsterThreat: undefined,
          }
      const vehicleFields: Partial<CharacterProfile> = role === 'vehicle'
        ? {}
        : {
            vehicleCategory: undefined,
            vehicleSubtype: undefined,
            vehicleSubtypeCustom: undefined,
            vehicleStyle: undefined,
            vehicleEra: undefined,
          }
      // 自包含地完成整次切换 + 重渲,不依赖 subscribeRoleSync 回调的时序:
      // 那条回调会在 _applyingBroadcast(另一个 pane 正在跨 iframe 同步)期间
      // 早退,从而出现「第一次切了之后再点别的类没反应」。这里先把渲染基线
      // (_renderedRole)对齐成目标 role,再直接 buildLeft()+强制回到 form 重渲,
      // 让本 pane 立即可见地切过去,localStorage/BroadcastChannel 只负责把变更
      // 同步给另一个 pane。
      this._renderedRole = role
      this.conceptImages = []
      this.selectedConcepts.clear()
      this.fusionDesc = ''
      this.phase = 'form'
      clearConceptsFromIDB().catch(() => {})
      // updateProfile / setCharacterImage 会触发 globalState.notify() → 本 pane 的
      // subscribeRoleSync,但此时 _renderedRole 已等于 role,回调会原样早退,不会
      // 与下面的显式重渲打架。
      globalState.updateProfile({ characterRole: role, ...monsterFields, ...vehicleFields })
      globalState.setCharacterImage(null)
      this.buildLeft()
      this.refreshCenter()
      this.refreshLeftActions()
    })
  }

  private q(sel: string): HTMLElement | null {
    return this.leftEl?.querySelector(sel) ?? this.centerEl?.querySelector(sel) ?? null
  }

  // ── Left Panel ───────────────────────────────────────────────

  private characterRoleLabel(role: CharacterRole | undefined | null): string {
    if (role === 'npc') return '职业 NPC'
    if (role === 'monster') return '怪物敌人'
    if (role === 'vehicle') return '载具'
    return '主角英雄'
  }

  private worldLabel(worldSetting: string | undefined): string {
    const world = WORLD_OPTIONS.find(w => w.id === worldSetting)
    return world?.label ?? (worldSetting?.trim() || '未选择世界观')
  }

  private artStyleLabel(profile: CharacterProfile): string {
    if (profile.artStyle === 'custom') return profile.artStyleCustom?.trim() || '自定义画风'
    const style = ART_STYLE_OPTIONS.find(s => s.id === profile.artStyle)
    return style?.label ?? '默认写实'
  }

  private professionLabel(profile: CharacterProfile): string {
    if (profile.characterRole === 'npc') return profile.npcOccupation?.trim() || '未选择 NPC 职业'
    if (profile.characterRole === 'monster') {
      return [profile.monsterCategory, profile.monsterSubCategory, profile.monsterRace]
        .filter(Boolean)
        .join(' / ') || '未选择怪物分类'
    }
    if (profile.characterRole === 'vehicle') {
      const category = VEHICLE_CATEGORIES.find(c => c.id === profile.vehicleCategory)
      const subtype = category?.subtypes.find(s => s.id === profile.vehicleSubtype)
      return [category?.label, subtype?.label ?? profile.vehicleSubtypeCustom]
        .filter(Boolean)
        .join(' / ') || '未选择载具类型'
    }
    const combat = profile.combatType === 'ranged' ? '远程' : '近战'
    return `${profile.charClass?.trim() || '未选择职业'} · ${combat}`
  }

  private buildLeft(): void {
    if (!this.leftEl) return
    const p = globalState.profile
    this._renderedRole = p.characterRole ?? 'hero'
    const roleLabel = this.characterRoleLabel(p.characterRole)
    const identitySummary = p.name?.trim()
      ? `${p.name.trim()} · ${roleLabel}`
      : `未命名 · ${roleLabel}`
    const worldLabel = this.worldLabel(p.worldSetting)
    const professionLabel = this.professionLabel(p)
    const styleLabel = this.artStyleLabel(p)
    const methodSummary = conceptGenButtonLabel(p.characterRole).replace(/^[^\s]+\s*/, '')

    this.leftEl.innerHTML = `
      <div class="cd-panel">
        <div class="cd-header">
          <span class="cd-header-title">角色概念设计</span>
          <span class="cd-header-pill">${esc(roleLabel)}</span>
        </div>

        <div class="cd-form">
          <details class="cd-workflow-card" open>
            <summary class="cd-workflow-head">
              <span class="cd-workflow-title"><span class="cd-step">1</span>基础设定</span>
              <span class="cd-workflow-caret">⌄</span>
            </summary>
            <div class="cd-workflow-summary">${esc(identitySummary)}</div>
            <div class="cd-workflow-body">
              <div class="cd-field">
                <label class="cd-label">角色名称</label>
                <input class="cd-input" data-cd="name" type="text" placeholder="输入角色名称,如:焰影·洛" value="${esc(p.name)}" />
              </div>

              <div class="cd-field-row" data-cd-role="character-only" style="display:${p.characterRole === 'vehicle' ? 'none' : ''}">
                <div class="cd-field cd-field-half">
                  <label class="cd-label">性别</label>
                  <div class="cd-btn-group" data-group="gender">
                    <button class="cd-chip ${p.gender === 'male' ? 'active' : ''}" data-val="male">♂ 男</button>
                    <button class="cd-chip ${p.gender === 'female' ? 'active' : ''}" data-val="female">♀ 女</button>
                  </div>
                </div>
                <div class="cd-field cd-field-half">
                  <label class="cd-label">年龄段</label>
                  <select class="cd-select" data-cd="age">
                    <option value="">选择年龄</option>
                    ${AGE_OPTIONS.map(a => `<option value="${a}" ${p.age === a ? 'selected' : ''}>${a}</option>`).join('')}
                  </select>
                </div>
              </div>
            </div>
          </details>

          <details class="cd-workflow-card">
            <summary class="cd-workflow-head">
              <span class="cd-workflow-title"><span class="cd-step">2</span>形态与世界</span>
              <span class="cd-workflow-caret">⌄</span>
            </summary>
            <div class="cd-workflow-summary">${esc(worldLabel)} · ${esc(styleLabel)}</div>
            <div class="cd-workflow-body">
              <div class="cd-field" data-cd-role="hero-only" style="display:${p.characterRole === 'hero' || !p.characterRole ? '' : 'none'}">
                <label class="cd-label">形态 / 物种 <span class="cd-optional">(决定整套画风走向)</span></label>
                <div class="cd-world-grid" data-group="bodytype">
                  ${BODY_TYPE_PRESETS.map(b => `<button class="cd-world-chip ${p.bodyType === b.id ? 'active' : ''}" data-val="${esc(b.id)}" title="${esc(b.hint)}\n参考:${esc(b.references)}">${esc(b.label)}</button>`).join('')}
                </div>
              </div>

              <div class="cd-field">
                <label class="cd-label">世界观 / 风格</label>
                <div class="cd-world-grid" data-group="world">
                  ${WORLD_OPTIONS.map(w => `<button class="cd-world-chip ${p.worldSetting === w.id ? 'active' : ''}" data-val="${esc(w.id)}" title="${esc(w.desc)}">${esc(w.label)}</button>`).join('')}
                </div>
                <input class="cd-input cd-input-sm" data-cd="world-custom" type="text"
                  placeholder="或自定义世界观..." value="${WORLD_OPTIONS.some(w => w.id === p.worldSetting) ? '' : esc(p.worldSetting)}" />
              </div>
            </div>
          </details>

          <details class="cd-workflow-card">
            <summary class="cd-workflow-head">
              <span class="cd-workflow-title"><span class="cd-step">3</span>职业与规则</span>
              <span class="cd-workflow-caret">⌄</span>
            </summary>
            <div class="cd-workflow-summary">${esc(professionLabel)}</div>
            <div class="cd-workflow-body">
              <div class="cd-field" data-cd-role="hero-only" style="display:${p.characterRole === 'hero' || !p.characterRole ? '' : 'none'}">
                <label class="cd-label">职业 / 角色定位</label>
                <select class="cd-select" data-cd="class-select">
                  <option value="">选择职业</option>
                  ${CLASS_OPTIONS.map(c => `<option value="${esc(c)}" ${p.charClass === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
                </select>
                <input class="cd-input cd-input-sm" data-cd="class-custom" type="text"
                  placeholder="或自定义职业..." value="${CLASS_OPTIONS.includes(p.charClass) ? '' : esc(p.charClass)}" />
              </div>

              <div class="cd-field" data-cd-role="npc-only" style="display:${p.characterRole === 'npc' ? '' : 'none'}">
                <label class="cd-label">NPC 职业 <span class="cd-optional">(随「世界观」自动切换候选词表)</span></label>
                <select class="cd-select" data-cd="npc-occupation-select">
                  <option value="">选择 NPC 职业</option>
                  ${listNpcOccupations(p.worldSetting).map(o => `<option value="${esc(o.zh)}" ${p.npcOccupation === o.zh ? 'selected' : ''}>${esc(o.zh)}</option>`).join('')}
                </select>
                <input class="cd-input cd-input-sm" data-cd="npc-occupation-custom" type="text"
                  placeholder="或自定义 NPC 职业..." value="${listNpcOccupations(p.worldSetting).some(o => o.zh === p.npcOccupation) ? '' : esc(p.npcOccupation)}" />
              </div>

              <div class="cd-field" data-cd-role="hero-only" style="display:${p.characterRole === 'hero' || !p.characterRole ? '' : 'none'}">
                <label class="cd-label">战斗类型</label>
                <div class="cd-btn-group" data-group="combat">
                  <button class="cd-chip ${p.combatType === 'melee' ? 'active' : ''}" data-val="melee">近战</button>
                  <button class="cd-chip ${p.combatType === 'ranged' ? 'active' : ''}" data-val="ranged">远程</button>
                </div>
              </div>

              ${renderMonsterFields(p)}

              ${renderVehicleFields(p)}
            </div>
          </details>

          <details class="cd-workflow-card">
            <summary class="cd-workflow-head">
              <span class="cd-workflow-title"><span class="cd-step">4</span>画风与生成</span>
              <span class="cd-workflow-caret">⌄</span>
            </summary>
            <div class="cd-workflow-summary">${esc(styleLabel)} · ${esc(methodSummary)}</div>
            <div class="cd-workflow-body">
              <div class="cd-field">
                <label class="cd-label">画风风格 <span class="cd-optional">(可选 · 默认韩式写实)</span></label>
                <div class="cd-world-grid" data-group="artstyle">
                  <button class="cd-world-chip ${!p.artStyle ? 'active' : ''}" data-val="" title="韩式写实 DNF 风格">默认写实</button>
                  ${ART_STYLE_OPTIONS.map(s => `<button class="cd-world-chip ${p.artStyle === s.id ? 'active' : ''}" data-val="${esc(s.id)}" title="${esc(s.hint)}">${esc(s.label)}</button>`).join('')}
                  <button class="cd-world-chip ${p.artStyle === 'custom' ? 'active' : ''}" data-val="custom" title="自定义画风">自定义</button>
                </div>
                <input class="cd-input cd-input-sm" data-cd="artstyle-custom" type="text"
                  placeholder="描述你想要的画风，例如：赛璐璐厚涂混合、90年代复古漫画风..."
                  value="${esc(p.artStyleCustom)}"
                  style="display:${p.artStyle === 'custom' ? '' : 'none'}" />
              </div>

              <div class="cd-field">
                <label class="cd-label">补充描述 <span class="cd-optional">(可选)</span></label>
                <textarea class="cd-textarea" data-cd="extra" rows="3"
                  placeholder="补充外貌、性格、武器、配色等细节...&#10;例如：银白色长发，佩戴黑色面具，双持弯刀，暗红色披风">${esc(p.extraDesc)}</textarea>
              </div>

              <div class="cd-section">
                <div class="cd-label">生成方式</div>
                <div class="cd-method-row">
                  <button class="cd-method active" data-method="text">AI 生成</button>
                  <button class="cd-method" data-method="upload">图生图</button>
                  <button class="cd-method" data-method="complete">补全设定</button>
                  <button class="cd-method" data-method="direct">上传</button>
                </div>
              </div>

              <div class="cd-method-body" data-body="text">
                <div class="cd-gen-row">
                  <button class="cd-btn cd-btn-primary cd-btn-gen" data-action="gen-text">
                    ${conceptGenButtonLabel(p.characterRole)}
                  </button>
                </div>
                <button class="cd-btn cd-btn-back" data-action="go-back" style="display:none;margin-top:6px">
                  ← 返回上一步
                </button>
                <div class="cd-progress" data-cd="progress" style="display:none">
                  <div class="cd-progress-bar"><div class="cd-progress-fill"></div></div>
                  <div class="cd-progress-text">生成中...</div>
                </div>
              </div>

              <div class="cd-method-body" data-body="upload" style="display:none">
                <div class="cd-drop" data-drop="ref">
                  <div>拖拽参考图或点击上传</div>
                  <div class="cd-drop-sub">AI 将参考图转换为 DNF 风格角色设定图</div>
                </div>
                <button class="cd-btn cd-btn-primary cd-btn-gen" data-action="gen-img2img" disabled>
                  AI 风格转换
                </button>
                <div class="cd-progress" data-cd="progress-img" style="display:none">
                  <div class="cd-progress-bar"><div class="cd-progress-fill"></div></div>
                  <div class="cd-progress-text">风格转换中...</div>
                </div>
              </div>

              <div class="cd-method-body" data-body="complete" style="display:none">
                <div class="cd-drop" data-drop="complete">
                  <div>拖拽任意参考图或点击上传</div>
                  <div class="cd-drop-sub">头像 / 草图 / 局部立绘 / 任意尺寸 —  AI 会把这张图当作设计本身，<br/>只参考上面的「角色名称」做标签，其余（职业 / 世界观 / 画风 / 形态 等）全部从图里推断</div>
                </div>
                <button class="cd-btn cd-btn-primary cd-btn-gen" data-action="gen-complete" disabled>
                  补全为完整设定图
                </button>
                <div class="cd-progress" data-cd="progress-complete" style="display:none">
                  <div class="cd-progress-bar"><div class="cd-progress-fill"></div></div>
                  <div class="cd-progress-text">补全中...</div>
                </div>
              </div>

              <div class="cd-method-body" data-body="direct" style="display:none">
                <div class="cd-drop" data-drop="direct">
                  <div>拖拽角色立绘到此处</div>
                  <div class="cd-drop-sub">直接使用此图进入后续管线</div>
                </div>
              </div>
            </div>
          </details>
        </div>

        <div class="cd-history-section">
          <div class="cd-history-header">
            <span class="cd-history-title">📂 ${roleHistoryLabel(p.characterRole)}历史</span>
            <button class="cd-history-clear" data-action="clear-history">清空</button>
          </div>
          <div class="cd-history-list" data-cd="history"></div>
        </div>

        <div class="cd-status">
          <span data-cd="status-summary"></span>
        </div>
      </div>
    `
    this.wireLeftEvents()
    this.wireHistoryEvents()
    this.updateStatus()
    this.renderHistory()
  }

  // ── Center Panel ──────────────────────────────────────────────

  private buildCenter(): void {
    this.refreshCenter()
  }

  private refreshCenter(): void {
    if (!this.centerEl) return
    this.saveSession()
    switch (this.phase) {
      case 'form': this.renderFormCenter(); break
      case 'concepts': this.renderConceptsCenter(); break
      case 'final': this.renderFinalCenter(); break
      case 'detail': this.renderDetailPhaseCenter(); break
    }
    this.broadcastState()
    if (this.isGenerationActive()) this.restoreGenerationUI()
  }

  private renderFormCenter(): void {
    if (!this.centerEl) return
    const role = globalState.profile?.characterRole
    const hint = role === 'npc'
      ? '填写左侧角色信息，点击「生成 NPC 参考稿」'
      : role === 'vehicle'
        ? '填写左侧载具信息，点击「生成载具设计图」'
        : role === 'monster'
          ? '填写左侧怪物信息，点击「生成 4 张怪物概念图」'
          : '填写左侧角色信息，点击「生成 4 张概念图」'
    const tip = role === 'npc'
      ? 'Claude 参考稿方案 · Gemini 单图 · 直达像素管线'
      : role === 'vehicle'
        ? 'Claude 载具设计方案 · Gemini 单图 · 下游接 wb-anim/vehicle-design 切多视角'
        : 'Claude 设计方案 · Gemini 绘图'
    this.centerEl.innerHTML = `
      <div class="cd-center-stack">
        ${this.roleTabBarHTML()}
        <div class="cd-preview-wrap">
          <div class="cd-preview-title">角色预览</div>
          <div class="cd-preview" data-cd="preview">
            <div class="cd-preview-empty">
              <div class="cd-preview-empty-icon">🖼️</div>
              <div>${hint}</div>
              <div class="cd-preview-tip">${tip}</div>
            </div>
          </div>
        </div>
      </div>
    `
  }

  private _conceptsLoadFallbackTimer: ReturnType<typeof setTimeout> | null = null

  /** concepts phase 无图时的自愈:到点还没拿到概念图就退回 form,避免永久卡
   *  「正在加载概念图...」。期间若 generating(正在生成中)则不退,生成流程会
   *  自己 refreshCenter。 */
  private scheduleConceptsLoadFallback(): void {
    if (this._conceptsLoadFallbackTimer) return
    this._conceptsLoadFallbackTimer = setTimeout(() => {
      this._conceptsLoadFallbackTimer = null
      if (this.isGenerationActive()) return
      if (this.phase === 'concepts' && this.conceptImages.length === 0) {
        this.phase = 'form'
        this.refreshCenter()
        this.refreshLeftActions()
      }
    }, 2500)
  }

  private clearConceptsLoadFallback(): void {
    if (this._conceptsLoadFallbackTimer) {
      clearTimeout(this._conceptsLoadFallbackTimer)
      this._conceptsLoadFallbackTimer = null
    }
  }

  private renderConceptsCenter(): void {
    if (!this.centerEl) return
    const count = this.conceptImages.length

    if (count === 0) {
      this.centerEl.innerHTML = `
        <div class="cd-center-stack">
          ${this.roleTabBarHTML()}
          <div class="cd-preview-wrap">
            <div class="cd-preview-title">正在加载概念图...</div>
            <div class="cd-preview" data-cd="preview">
              <div class="cd-preview-empty">
                <div class="cd-preview-empty-icon">⏳</div>
                <div>正在从缓存加载概念图，请稍候...</div>
              </div>
            </div>
          </div>
        </div>`
      // 自愈:concepts phase 但内存里没有概念图(IDB 读空 / 跨 iframe 同步丢失 /
      // 切到没生成过的角色),否则会永久卡在「正在加载概念图...」。给一个超时,到点
      // 还是没图就退回 form,让用户能正常开始生成,不会卡死。
      this.scheduleConceptsLoadFallback()
      return
    }
    this.clearConceptsLoadFallback()

    const selCount = this.selectedConcepts.size
    // 跳过「修改局部」分支：NPC（1 张自动勾）/ 怪物（4 张挑完后直接走设定图）/ 载具（单图直达）
    const role = globalState.profile?.characterRole
    const isNpc = role === 'npc'
    const isMonster = role === 'monster'
    const isVehicle = role === 'vehicle'
    const skipLocalEdit = isNpc || isMonster || isVehicle

    let gridHtml = ''
    for (let i = 0; i < count; i++) {
      const selected = this.selectedConcepts.has(i)
      gridHtml += `
        <div class="cd-concept-card ${selected ? 'selected' : ''}" data-concept-idx="${i}">
          <img src="${this.conceptImages[i]}" class="cd-concept-img" />
          <div class="cd-concept-check">${selected ? '✓' : ''}</div>
          <div class="cd-concept-label">#${i + 1}</div>
        </div>`
    }

    let actionText = '请点击选择'
    let actionBtns = ''
    if (selCount === 1) {
      const editPartsBtn = skipLocalEdit
        ? ''
        : '<button class="cd-btn" data-action="concept-edit-parts">✏️ 修改局部</button>'
      // 怪物分支：挑完直接落 characterImage，跳过「生成完整设定图」——Gemini/Claude
      // 的 final sheet 对怪物意义不大（没有装备槽、没有正反侧背分解），只会拖慢流程。
      const confirmAction = isMonster ? 'concept-to-pixel' : 'gen-final'
      const confirmLabel = isMonster ? '确认 — 进入像素管线 →' : '生成完整设定图 →'
      actionBtns = `
        ${editPartsBtn}
        <button class="cd-btn cd-btn-primary" data-action="${confirmAction}">${confirmLabel}</button>`
      actionText = isNpc ? 'NPC 参考稿（已自动选中）' : isMonster ? '怪物概念图（已选 1 张）' : `已选中 1 张`
    } else if (selCount >= 2) {
      actionBtns = `<button class="cd-btn cd-btn-accent" data-action="fuse-selected">融合并生成 →</button>`
      actionText = `已选中 ${selCount} 张`
    }

    let conceptDetailHtml = ''
    if (this.conceptDetailOpen && selCount === 1) {
      conceptDetailHtml = this.buildConceptDetailPanel()
    }

    this.centerEl.innerHTML = `
      <div class="cd-center-stack">
        ${this.roleTabBarHTML()}
        <div class="cd-preview-wrap">
          <div class="cd-preview-title">选择概念图 <span class="cd-sel-count">${actionText}</span></div>
        <div class="cd-concepts-grid">${gridHtml}</div>
        <div class="cd-concepts-actions">
          <button class="cd-btn" data-action="regen-concepts">不满意，重新生成</button>
          ${actionBtns}
        </div>
        ${selCount >= 2 ? (() => {
          const selIndices = [...this.selectedConcepts].sort()
          const labels = 'ABCDEFGH'
          const thumbsHtml = selIndices.map((idx, li) =>
            `<div class="cd-fusion-thumb-item">
              <img class="cd-fusion-thumb-img" src="${this.conceptImages[idx]}" />
              <span class="cd-fusion-thumb-label">${labels[li]}</span>
              <span class="cd-fusion-thumb-num">#${idx + 1}</span>
            </div>`
          ).join('')
          return `
        <div class="cd-fusion-panel">
          <div class="cd-fusion-ref">
            <div class="cd-fusion-ref-title">选中的图（用字母指代）</div>
            <div class="cd-fusion-thumbs">${thumbsHtml}</div>
          </div>
          <textarea class="cd-textarea cd-fusion-input" rows="2"
            placeholder="描述融合方式（可选）&#10;例如：要图A的场景氛围 + 图B的角色设计">${esc(this.fusionDesc)}</textarea>
        </div>`
        })() : ''}
        ${conceptDetailHtml}
        <div class="cd-progress" data-cd="progress" style="display:none">
          <div class="cd-progress-bar"><div class="cd-progress-fill"></div></div>
          <div class="cd-progress-text">生成中...</div>
        </div>
        </div>
      </div>
    `
    this.wireConceptEvents()
  }

  /** Best preview src: disk URL beats memory; concept thumb is last resort. */
  private resolveFinalPreviewSrc(): string | null {
    const st = globalState.get()
    if (st.characterImageUrl) return st.characterImageUrl
    if (st.characterImage) return st.characterImage
    return this.conceptImages[0] || null
  }

  private mountFinalPreviewImage(src: string): void {
    const preview = this.centerEl?.querySelector('[data-cd="preview"]') as HTMLElement | null
    const actions = this.centerEl?.querySelector('[data-cd="actions"]') as HTMLElement | null
    if (!preview) return
    const imgEl = document.createElement('img')
    imgEl.className = 'cd-preview-img'
    imgEl.onload = () => { if (actions) actions.style.display = 'flex' }
    imgEl.src = src
    preview.innerHTML = ''
    preview.appendChild(imgEl)
    applyHideableTo(preview, 'img.cd-preview-img', { idFrom: () => 'character-design:final' })
    if (actions) actions.style.display = 'flex'
  }

  /** Pull full-res portrait from disk when memory only has a thumb / concept fallback. */
  private hydrateFinalPreviewIfNeeded(initialSrc: string | null): void {
    const gen = ++this.finalPreviewHydrateGen
    void (async () => {
      const needsHydrate = !initialSrc
        || (!globalState.get().characterImage && !!globalState.get().characterImageUrl)
        || (initialSrc === this.conceptImages[0] && !!globalState.get().characterImageUrl)
      if (!needsHydrate && initialSrc?.startsWith('/api/')) return
      if (!needsHydrate && initialSrc?.startsWith('data:') && !globalState.get().characterImageUrl) return
      const ok = await globalState.hydrateCharacterImage()
      if (gen !== this.finalPreviewHydrateGen || this.phase !== 'final') return
      const upgraded = this.resolveFinalPreviewSrc()
      if (upgraded && upgraded !== initialSrc) {
        this.mountFinalPreviewImage(upgraded)
      } else if (!initialSrc && ok && upgraded) {
        this.mountFinalPreviewImage(upgraded)
        this.clearConceptsLoadFallback()
      }
    })()
  }

  private renderFinalCenter(): void {
    if (!this.centerEl) return
    // NPC / 怪物 / 载具都不走「修改局部细节」部件编辑面板——都是 gameplay 实例，
    // 不需要逐个发型 / 眼睛 / 饰品抠。NPC 直接进像素管线；怪物让用户挑管线；
    // 载具是工业产品，直接进 wb-anim/vehicle-design 切多视角。
    const role = globalState.profile?.characterRole
    const isNpc = role === 'npc'
    const isMonster = role === 'monster'
    const isVehicle = role === 'vehicle'
    const skipDetail = isNpc || isMonster || isVehicle
    const detailBtnHtml = skipDetail
      ? ''
      : '<button class="cd-btn cd-btn-primary" data-action="enter-detail">✏️ 修改局部细节</button>'
    const titleText = isNpc
      ? '角色设定图（NPC / 路人）'
      : isMonster
        ? '怪物设定图'
        : isVehicle
          ? '载具设计图'
          : '角色设定图'
    // 只剩像素管线一条主路——video / spine 都下沉到"更多模块"下拉里，主流程
    // 不再让用户选 3 选 1（大部分用户会点错）。按钮直接叫"生成动画"。载具走
    // wb-anim/vehicle-design 切多视角，文案也叫「生成动画」。
    const confirmText = isVehicle ? '🎬 切多视角 / 生成动画' : '🎬 生成动画'
    const showGen3D = !isNpc && !isVehicle
    const gen3dButtonsHtml = showGen3D
      ? `<button class="cd-btn" data-action="gen-turnaround-3d"${this.generatingTurnaround3D ? ' disabled' : ''}>${this.generatingTurnaround3D ? '⏳ 生成四视图中...' : '🧊 生成 3D 四视图'}</button>
            <button class="cd-btn cd-btn-primary" data-action="go-gen3d"${this.turnaround3DViews ? '' : ' disabled'}>🚀 送去 3D 生成</button>`
      : ''
    this.centerEl.innerHTML = `
      <div class="cd-center-stack">
        ${this.roleTabBarHTML()}
        <div class="cd-preview-wrap">
          <div class="cd-preview-title">${titleText}</div>
          <div class="cd-preview" data-cd="preview">
            <div class="cd-preview-empty">
              <div class="cd-preview-empty-icon">🖼️</div>
              <div>加载中...</div>
            </div>
          </div>
          ${this.turnaroundGridHtml()}
          <div class="cd-preview-actions" data-cd="actions" style="display:none">
            <button class="cd-btn" data-action="back-concepts">← 返回概念图</button>
            <button class="cd-btn" data-action="regen-final">重新生成设定图</button>
            ${detailBtnHtml}
            ${gen3dButtonsHtml}
            <button class="cd-btn cd-btn-accent cd-btn-xl" data-action="go-pixel">${confirmText}</button>
          </div>
        </div>
      </div>
    `
    this.wireFinalEvents()

    // 优先 characterImageUrl(磁盘全分辨率); memory / conceptImages[0] 作即时兜底,
    // hydrateFinalPreviewIfNeeded 再从磁盘拉高清替换缩略图。
    const img = this.resolveFinalPreviewSrc()
    if (img) {
      this.mountFinalPreviewImage(img)
      this.clearConceptsLoadFallback()
      this.hydrateFinalPreviewIfNeeded(img)
    } else {
      this.hydrateFinalPreviewIfNeeded(null)
    }
    if (!img && !this.isGenerationActive()) {
      // final phase 但拿不到任何图(localStorage 同步丢失 / 切到没生成过的角色 /
      // 状态残留)——别永久卡在"加载中...",退回 form 让用户重新开始。
      this.scheduleFinalNoImageFallback()
    }

    this.maybeAutoRouteNpcToPixel(img)
    void this.hydrateTurnaround3DFromDisk()
  }

  /** Restore 2×2 turnaround grid from manifest / on-disk files (no re-generation). */
  private async hydrateTurnaround3DFromDisk(): Promise<void> {
    const role = globalState.profile?.characterRole
    if (role === 'npc' || role === 'vehicle') return
    if (this.generatingTurnaround3D) return

    const slug = globalState.getSlug()
    if (!slug) return
    let charId = globalState.profile?.charId?.trim() ?? ''
    if (!charId) charId = globalState.ensureCharId()
    if (!charId) return

    if (this.turnaround3DViews && this.turnaround3DCharId === charId) return

    const gen = ++this.turnaroundHydrateGen
    try {
      const views = await loadTurnaround3DHandoffViews(slug, charId)
      if (gen !== this.turnaroundHydrateGen || this.generatingTurnaround3D) return
      if (!views) {
        if (this.turnaround3DCharId !== charId) {
          this.turnaround3DViews = null
          this.turnaround3DCharId = charId
          this.syncTurnaround3DUI()
        }
        return
      }
      this.turnaround3DViews = views
      this.turnaround3DCharId = charId
      this.syncTurnaround3DUI()
    } catch { /* best-effort */ }
  }

  private _finalNoImageFallbackTimer: ReturnType<typeof setTimeout> | null = null

  private scheduleFinalNoImageFallback(): void {
    if (this._finalNoImageFallbackTimer) return
    this._finalNoImageFallbackTimer = setTimeout(() => {
      this._finalNoImageFallbackTimer = null
      if (this.isGenerationActive()) return
      const hasImg = !!(globalState.get().characterImage || this.conceptImages[0])
      if (this.phase === 'final' && !hasImg) {
        this.phase = 'form'
        this.refreshCenter()
        this.refreshLeftActions()
      }
    }, 2500)
  }

  /**
   * 路人 NPC 生成完设定图后**自动切换**到「像素角色」管线——没必要再走「修改
   * 局部细节」那套部件编辑流程，群众角色的细节价值很低。
   *
   * 实现细节：
   *   - 只在 `characterRole === 'npc'` 且 `characterImage` 存在时触发。
   *   - 用 `_npcAutoRoutedForImage` 记忆上次已跳转的图，避免用户切回 character
   *     -design tab 时被反复弹走。
   *   - 异步 dispatch（`setTimeout(0)`）让当前 refreshCenter 的 DOM 写入先走
   *     完，用户至少能瞥一眼设定图，后跳过去才不突兀。
   */
  private maybeAutoRouteNpcToPixel(img: string | null): void {
    if (!shouldAutoRouteNpcToPixel(globalState.profile?.characterRole, this._npcAutoRoutedForImage, img)) return
    this._npcAutoRoutedForImage = img
    setTimeout(() => {
      void this.navigateToAnim()
    }, 0)
  }

  private wireConceptEvents(): void {
    if (!this.centerEl) return

    this.centerEl.querySelectorAll('.cd-concept-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = Number((card as HTMLElement).dataset.conceptIdx)
        if (this.selectedConcepts.has(idx)) {
          this.selectedConcepts.delete(idx)
        } else {
          this.selectedConcepts.add(idx)
        }
        this.conceptDetailOpen = false
        this.conceptDetailPart = null
        this.refreshCenter()
      })
    })

    this.centerEl.querySelector('[data-action="regen-concepts"]')?.addEventListener('click', () => {
      this.phase = 'form'
      this.conceptDetailOpen = false
      this.conceptDetailPart = null
      this.refreshCenter()
      this.refreshLeftActions()
      this.generateConcepts()
    })

    this.centerEl.querySelector('[data-action="gen-final"]')?.addEventListener('click', () => {
      this.generateFinalSheet()
    })

    this.centerEl.querySelector('[data-action="concept-to-pixel"]')?.addEventListener('click', () => {
      this.acceptConceptAsFinal()
    })

    this.centerEl.querySelector('[data-action="concept-edit-parts"]')?.addEventListener('click', () => {
      this.conceptDetailOpen = !this.conceptDetailOpen
      this.conceptDetailPart = null
      this.refreshCenter()
    })

    this.centerEl.querySelector('[data-action="fuse-selected"]')?.addEventListener('click', () => {
      this.fuseConcepts()
    })

    const fusionInput = this.centerEl.querySelector('.cd-fusion-input') as HTMLTextAreaElement
    if (fusionInput) {
      fusionInput.addEventListener('input', () => {
        this.fusionDesc = fusionInput.value
      })
    }

    this.wireConceptDetailEvents()
  }

  private buildConceptDetailPanel(): string {
    const selIdx = [...this.selectedConcepts][0]
    if (selIdx == null) return ''

    let partsHtml = '<div class="cd-cdetail-parts">'
    for (const part of DETAIL_PARTS) {
      const active = this.conceptDetailPart === part.code
      partsHtml += `<button class="cd-cdetail-part-btn ${active ? 'active' : ''}" data-cdetail-part="${part.code}" title="${part.name} · ${part.position}">${part.icon}</button>`
    }
    partsHtml += '</div>'

    let editorHtml = ''
    if (this.conceptDetailPart) {
      const part = DETAIL_PARTS.find(p => p.code === this.conceptDetailPart)
      if (part) {
        let placeholder = '描述这个部件你想要的样子...'
        if (part.code === 'weapon') placeholder = '描述想在手中生成的武器道具...'
        if (part.code === 'outfit') placeholder = '描述想要替换的服装...'
        if (part.code === 'pose') placeholder = '描述想要的动作姿态...'

        editorHtml = `
          <div class="cd-cdetail-editor">
            <div class="cd-cdetail-editor-head">
              <span>${part.icon}</span>
              <span style="font-weight:600;">${part.name}</span>
              <span style="font-size:10px;color:var(--text-secondary);">${part.position}</span>
            </div>
            <textarea class="cd-textarea" data-cdetail-desc rows="2" placeholder="${placeholder}"></textarea>
            <div class="cd-cdetail-hints">
              ${part.hints.map(h => `<span class="cd-cdetail-hint">${h}</span>`).join('')}
            </div>
            <button class="cd-btn cd-btn-primary" data-action="apply-cdetail" disabled style="margin-top:6px;">⚡ 应用修改到概念图</button>
            <div class="cd-progress" data-cd="cdetail-progress" style="display:none">
              <div class="cd-progress-bar"><div class="cd-progress-fill"></div></div>
              <div class="cd-progress-text">修改中...</div>
            </div>
          </div>`
      }
    }

    return `
      <div class="cd-cdetail-panel">
        <div class="cd-cdetail-header">
          <span style="font-size:12px;font-weight:600;">✏️ 局部修改</span>
          <span style="font-size:10px;color:var(--text-secondary);">选择部件 → 描述 → 应用</span>
        </div>
        ${partsHtml}
        ${editorHtml}
      </div>`
  }

  private wireConceptDetailEvents(): void {
    if (!this.centerEl) return

    this.centerEl.querySelectorAll('[data-cdetail-part]').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = (btn as HTMLElement).dataset.cdetailPart!
        this.conceptDetailPart = this.conceptDetailPart === code ? null : code
        this.refreshCenter()
      })
    })

    const textarea = this.centerEl.querySelector('[data-cdetail-desc]') as HTMLTextAreaElement
    const applyBtn = this.centerEl.querySelector('[data-action="apply-cdetail"]') as HTMLButtonElement

    textarea?.addEventListener('input', () => {
      if (applyBtn) applyBtn.disabled = !textarea.value.trim()
    })

    this.centerEl.querySelectorAll('.cd-cdetail-hint').forEach(tag => {
      tag.addEventListener('click', () => {
        if (!textarea) return
        const hint = tag.textContent ?? ''
        textarea.value = textarea.value ? textarea.value + '、' + hint : hint
        textarea.dispatchEvent(new Event('input'))
      })
    })

    applyBtn?.addEventListener('click', () => {
      const desc = textarea?.value.trim()
      if (!desc || !this.conceptDetailPart) return
      this.applyConceptDetailMod(this.conceptDetailPart, desc)
    })
  }

  private async applyConceptDetailMod(code: string, desc: string): Promise<void> {
    const selIdx = [...this.selectedConcepts][0]
    if (selIdx == null || !this.conceptImages[selIdx]) return

    const part = DETAIL_PARTS.find(p => p.code === code)
    if (!part || this.generating) return

    this.generating = true
    this.showProgress('cdetail-progress', true, `正在修改「${part.name}」...`)
    const applyBtn = this.centerEl?.querySelector('[data-action="apply-cdetail"]') as HTMLButtonElement
    if (applyBtn) applyBtn.disabled = true

    try {
      const rawPrompt = buildDetailPrompt(code, desc)
      const prompt = adaptPromptForImageModel(rawPrompt, globalState.getImageModel())
      const compressed = await compressForUpload(this.conceptImages[selIdx], 400)
      const base64 = compressed.replace(/^data:[^;]+;base64,/, '')

      const result = await apiPost('/__ce-api__/generate-image', {
        prompt,
        inputImageBase64: base64,
        aspectRatio: '16:9',
        model: apiModelIdForImageModel(globalState.getImageModel()),
      })

      if (result.success && result.imageBase64) {
        const dataUrl = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`
        this.conceptImages[selIdx] = dataUrl
        saveConceptsToIDB(this.conceptImages).catch(() => {})
        void globalState.uploadConceptBatch(this.conceptImages)
        this.conceptDetailVersion++
        this.toast(`「${part.name}」修改成功！`)
      } else {
        this.toast('修改失败: ' + (result.error || result.text || '未知错误'))
      }
    } catch (e: any) {
      this.toast('请求失败: ' + e.message)
    } finally {
      this.generating = false
      this.showProgress('cdetail-progress', false)
    }

    this.refreshCenter()
  }

  private wireFinalEvents(): void {
    this.centerEl?.querySelector('[data-action="back-concepts"]')?.addEventListener('click', () => {
      this.phase = 'concepts'
      this.refreshCenter()
      this.refreshLeftActions()
    })

    this.centerEl?.querySelector('[data-action="regen-final"]')?.addEventListener('click', () => {
      this.generateFinalSheet()
    })

    this.centerEl?.querySelector('[data-action="enter-detail"]')?.addEventListener('click', () => {
      this.enterDetailPhase()
    })

    this.centerEl?.querySelector('[data-action="go-pixel"]')?.addEventListener('click', () => {
      void this.navigateToAnim()
    })

    this.centerEl?.querySelector('[data-action="gen-turnaround-3d"]')?.addEventListener('click', () => {
      void this.generateTurnaround3D()
    })

    this.centerEl?.querySelector('[data-action="go-gen3d"]')?.addEventListener('click', () => {
      void this.navigateToGen3D()
    })
  }

  private turnaroundGridHtml(): string {
    if (!this.turnaround3DViews) return ''
    const labels: Record<'front' | 'back' | 'left' | 'right', string> = {
      front: '正面',
      back: '背面',
      left: '左侧',
      right: '右侧',
    }
    const order = ['front', 'back', 'left', 'right'] as const
    const cells = order.map((key) => {
      const url = this.turnaround3DViews![key]
      if (!url) {
        return `<div class="cd-turnaround-cell cd-turnaround-empty"><span>${labels[key]}</span></div>`
      }
      return `<div class="cd-turnaround-cell"><img src="${esc(url)}" alt="${labels[key]}"/><span>${labels[key]}</span></div>`
    }).join('')
    return `<div class="cd-turnaround-grid" data-cd="turnaround-grid">${cells}</div>`
  }

  private syncTurnaround3DUI(): void {
    if (!this.centerEl) return
    const wrap = this.centerEl.querySelector('.cd-preview-wrap')
    const existing = wrap?.querySelector('[data-cd="turnaround-grid"]')
    existing?.remove()
    const html = this.turnaroundGridHtml()
    if (html && wrap) {
      const actions = wrap.querySelector('[data-cd="actions"]')
      const tpl = document.createElement('template')
      tpl.innerHTML = html.trim()
      wrap.insertBefore(tpl.content.firstElementChild!, actions)
    }
    const genBtn = this.centerEl.querySelector('[data-action="gen-turnaround-3d"]') as HTMLButtonElement | null
    if (genBtn) {
      genBtn.disabled = this.generatingTurnaround3D
      genBtn.textContent = this.generatingTurnaround3D ? '⏳ 生成四视图中...' : '🧊 生成 3D 四视图'
    }
    const goBtn = this.centerEl.querySelector('[data-action="go-gen3d"]') as HTMLButtonElement | null
    if (goBtn) goBtn.disabled = !this.turnaround3DViews
  }

  /** Final-phase reference image — same fallbacks as renderFinalCenter preview. */
  private async resolveFinalReferenceDataUrl(): Promise<string | null> {
    const fromState = globalState.get().characterImage
    if (fromState) return fromState

    const fromConcept = this.conceptImages[0]
    if (fromConcept) return fromConcept

    const preview = this.centerEl?.querySelector('img.cd-preview-img') as HTMLImageElement | null
    const src = preview?.currentSrc || preview?.src
    if (src) {
      if (src.startsWith('data:')) return src
      if (await globalState.loadPortraitFromUrl(src)) {
        return globalState.get().characterImage
      }
    }

    if (await globalState.hydrateCharacterImage(true)) {
      return globalState.get().characterImage
    }
    return null
  }

  private static dataUrlToBase64(dataUrl: string): string {
    const comma = dataUrl.indexOf(',')
    return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  }

  private async generateTurnaround3D(): Promise<void> {
    const slug = globalState.getSlug()
    if (!slug) {
      this.toast('请先在 Studio 顶部选择一个游戏项目，再生成 3D 四视图')
      return
    }
    if (this.generatingTurnaround3D) return
    this.generatingTurnaround3D = true
    this.syncTurnaround3DUI()

    const refDataUrl = await this.resolveFinalReferenceDataUrl()
    if (!refDataUrl) {
      this.generatingTurnaround3D = false
      this.syncTurnaround3DUI()
      this.toast('找不到角色设定图，请重新生成设定图后再试')
      return
    }

    let charId = globalState.profile?.charId ?? ''
    try {
      charId = globalState.ensureCharId()
      await globalState.uploadAsset('portrait/current.png', refDataUrl)
      const r = await globalState.writeManifest('portrait/current.png')
      if (r) charId = r.charId
    } catch { /* best-effort — refImageBase64 below is the hard guarantee */ }
    if (!charId) charId = globalState.ensureCharId()

    const profile = globalState.profile
    const promptParts = [profile?.extraDesc?.trim(), profile?.name?.trim()].filter(Boolean) as string[]
    const prompt = promptParts.length ? promptParts.join('\n') : undefined

    try {
      const result = await generateTurnaroundFor3D({
        slug,
        charId,
        prompt,
        refImageBase64: CharacterDesign.dataUrlToBase64(refDataUrl),
        model: turnaroundVendorForImageModel(globalState.getImageModel()),
      })
      const handoff = buildGen3DHandoffViews(result.views)
      if (!handoff) {
        this.toast('四视图生成失败：缺少正面视图')
        return
      }
      this.turnaround3DViews = handoff
      this.turnaround3DCharId = charId
      this.syncTurnaround3DUI()
      this.toast('✅ 3D 四视图已生成，可送去 3D 工坊')
    } catch (e: any) {
      this.toast('四视图生成失败: ' + (e?.message || '未知错误'))
    } finally {
      this.generatingTurnaround3D = false
      this.syncTurnaround3DUI()
    }
  }

  /** Hand off orthographic view URLs to wb-gen3d (views mode prefill only — no auto 3D gen). */
  private async navigateToGen3D(): Promise<void> {
    const slug = globalState.getSlug()
    if (!slug) {
      this.toast('请先在 Studio 顶部选择一个游戏项目')
      return
    }
    if (!this.turnaround3DViews?.front) {
      this.toast('请先生成 3D 四视图')
      return
    }
    const name = globalState.profile?.name?.trim() || undefined
    try {
      window.parent?.postMessage({
        type: 'FORGEAX_NAVIGATE',
        targetPluginId: '@forgeax-plugin/wb-gen3d',
        payload: {
          views: this.turnaround3DViews,
          name,
          slug,
        },
      }, '*')
    } catch { /* not embedded — no-op */ }
  }

  /**
   * 「生成动画」连通:把当前角色登记进磁盘 manifest(含 role + portrait),再请
   * 求宿主把 active workbench 切到动画工作台(wb-anim),并透传 charId/role/slug。
   *
   * 取代旧的 `window.dispatchEvent('ce:switch-pipeline')`——那是 character/anim
   * 合并时代切「同一插件内部 pipeline tab」用的 window 事件,拆成独立模块后跨不出
   * iframe、已失效(pixel-char 管线现在在 wb-anim,本插件 registry 里没有它)。
   *
   * 宿主侧 StandalonePluginIframe 监听 FORGEAX_NAVIGATE → setWorkbenchExpandedPluginId
   * + setWorkbenchTab('wb:anim'),并把 payload 写进 localStorage 供 wb-anim 读取。
   * role 决定 wb-anim 的管线分流:vehicle → 载具设计动画,其它 → 像素角色等。
   */
  private async navigateToAnim(): Promise<void> {
    const role = globalState.profile?.characterRole ?? 'hero'
    const slug = globalState.getSlug()
    if (!slug) {
      this.toast('请先在 Studio 顶部选择一个游戏项目，再生成动画')
      return
    }
    let charId = ''
    let portraitUrl: string | undefined
    try {
      const disk = await globalState.ensurePortraitOnDisk()
      if (disk) {
        charId = disk.charId
        portraitUrl = disk.portraitUrl
      }
      const r = await globalState.writeManifest('portrait/current.png')
      if (r) charId = r.charId
      if (!portraitUrl) portraitUrl = globalState.get().characterImageUrl ?? undefined
    } catch { /* best-effort */ }
    if (!portraitUrl && !globalState.get().characterImage) {
      this.toast('角色图未能保存到磁盘，请重新生成设定图后重试')
      return
    }
    // 「走文件连通」:把 active-character 指针落盘到工程目录
    // (.forgeax/games/<slug>/active-character.json),让 wb-anim 在挂载时
    // 直接读盘拿 charId/role —— 这是可靠的、跨刷新/跨 iframe 的交接载体。
    if (charId) {
      try { await globalState.setActiveCharacter(charId, role) } catch { /* best-effort */ }
    }
    // postMessage 仅作为「切到动画工作台 tab」的 UI 信号 + 一次性快速路径
    // (避免下游靠轮询);真正的数据交接在上面的指针文件 + manifest。
    try {
      window.parent?.postMessage({
        type: 'FORGEAX_NAVIGATE',
        targetPluginId: '@forgeax-plugin/wb-anim',
        payload: { charId, role, slug, portraitUrl },
      }, '*')
    } catch { /* not embedded — no-op */ }
  }

  private refreshLeftActions(): void {
    if (!this.leftEl) return
    const backBtn = this.leftEl.querySelector('[data-action="go-back"]') as HTMLElement
    const genBtn = this.leftEl.querySelector('[data-action="gen-text"]') as HTMLButtonElement
    const detailPanel = this.leftEl.querySelector('[data-cd="detail-panel"]') as HTMLElement

    if (backBtn) {
      backBtn.style.display = this.phase === 'form' ? 'none' : ''
    }
    if (genBtn) {
      if (this.phase === 'detail') {
        genBtn.style.display = 'none'
      } else {
        genBtn.style.display = ''
        const role = globalState.profile?.characterRole
        if (this.phase === 'form') {
          genBtn.textContent = conceptGenButtonLabel(role)
        } else {
          genBtn.textContent = role === 'npc' ? '🔄 重新生成参考稿' : '🔄 重新生成概念图'
        }
      }
    }
    if (detailPanel) {
      detailPanel.style.display = this.phase === 'detail' ? '' : 'none'
    }
    this.broadcastState()
  }

  private resetToForm(): void {
    if (this.phase === 'form') return
    this.phase = 'form'
    this.conceptImages = []
    this.selectedConcepts.clear()
    this.fusionDesc = ''
    this.refreshCenter()
    this.refreshLeftActions()
  }

  // ── Event Wiring ──────────────────────────────────────────────

  private wireLeftEvents(): void {
    if (!this.leftEl) return

    const nameEl = this.q('[data-cd="name"]') as HTMLInputElement
    nameEl?.addEventListener('input', () => {
      globalState.updateProfile({ name: nameEl.value.trim() })
      this.resetToForm()
    })

    const ageEl = this.q('[data-cd="age"]') as HTMLSelectElement
    ageEl?.addEventListener('change', () => {
      globalState.updateProfile({ age: ageEl.value })
      this.resetToForm()
    })

    const classSelect = this.q('[data-cd="class-select"]') as HTMLSelectElement
    classSelect?.addEventListener('change', () => {
      const val = classSelect.value
      const update: Partial<import('./GlobalState').CharacterProfile> = { charClass: val }
      if (MELEE_CLASSES.has(val)) update.combatType = 'melee'
      else if (RANGED_CLASSES.has(val)) update.combatType = 'ranged'
      globalState.updateProfile(update)
      this.syncCombatUI()
      const customEl = this.q('[data-cd="class-custom"]') as HTMLInputElement
      if (customEl) customEl.value = ''
      this.resetToForm()
    })

    const npcOccupationSelect = this.q('[data-cd="npc-occupation-select"]') as HTMLSelectElement
    npcOccupationSelect?.addEventListener('change', () => {
      globalState.updateProfile({ npcOccupation: npcOccupationSelect.value })
      const customEl = this.q('[data-cd="npc-occupation-custom"]') as HTMLInputElement
      if (customEl) customEl.value = ''
      this.resetToForm()
    })

    const extraEl = this.q('[data-cd="extra"]') as HTMLTextAreaElement
    extraEl?.addEventListener('input', () => {
      globalState.updateProfile({ extraDesc: extraEl.value.trim() })
      this.resetToForm()
    })

    this.wireGroup('gender', val => {
      globalState.updateProfile({ gender: val as Gender })
      this.resetToForm()
    })
    this.wireGroup('image-model', val => {
      const model: ImageModel = val === 'gpt-image-2' ? 'gpt-image-2' : 'gemini'
      globalState.setImageModel(model)
      // 模型切换不 resetToForm——允许用户在看概念图 / 设定图中途只切换
      // 下一步生成要用的模型，已生成的结果保留。globalState.notify() 里会
      // 触发 buildLeft 重渲，chip 激活态会同步。
    })
    this.wireGroup('combat', val => {
      globalState.updateProfile({ combatType: val as CombatType })
      this.resetToForm()
    })
    this.wireGroup('class', val => {
      const update: Partial<import('./GlobalState').CharacterProfile> = { charClass: val }
      if (MELEE_CLASSES.has(val)) update.combatType = 'melee'
      else if (RANGED_CLASSES.has(val)) update.combatType = 'ranged'
      globalState.updateProfile(update)
      this.syncCombatUI()
      const customEl = this.q('[data-cd="class-custom"]') as HTMLInputElement
      if (customEl) customEl.value = ''
      this.resetToForm()
    })

    // 角色定位 4 大类的 tab 切换:DOM 渲染在 centerEl 顶部(roleTabBarHTML)
    // 由 wireRoleTabBar() 用事件委托处理,这里不再绑 leftEl 上的 chip。

    // ── 怪物形态字段 ───────────────────────────────────────────
    // 切主分类时要把次分类和种族清空，否则会出现「类人型 + 巨龙类」这种非法组合。
    const monsterCatSelect = this.q('[data-cd="monster-cat-select"]') as HTMLSelectElement
    monsterCatSelect?.addEventListener('change', () => {
      globalState.updateProfile({
        monsterCategory: monsterCatSelect.value,
        monsterSubCategory: '',
        monsterRace: '',
      })
      this.buildLeft()
      this.resetToForm()
    })
    const monsterSubSelect = this.q('[data-cd="monster-sub-select"]') as HTMLSelectElement
    monsterSubSelect?.addEventListener('change', () => {
      globalState.updateProfile({
        monsterSubCategory: monsterSubSelect.value,
        monsterRace: '',
      })
      this.buildLeft()
      this.resetToForm()
    })
    const monsterRaceSelect = this.q('[data-cd="monster-race-select"]') as HTMLSelectElement
    monsterRaceSelect?.addEventListener('change', () => {
      globalState.updateProfile({ monsterRace: monsterRaceSelect.value })
      const customEl = this.q('[data-cd="monster-race-custom"]') as HTMLInputElement
      if (customEl) customEl.value = ''
      this.resetToForm()
    })
    const monsterBodySelect = this.q('[data-cd="monster-body-select"]') as HTMLSelectElement
    monsterBodySelect?.addEventListener('change', () => {
      globalState.updateProfile({ monsterBodyType: monsterBodySelect.value })
      this.resetToForm()
    })
    const monsterThreatSelect = this.q('[data-cd="monster-threat-select"]') as HTMLSelectElement
    monsterThreatSelect?.addEventListener('change', () => {
      const v = monsterThreatSelect.value
      globalState.updateProfile({ monsterThreat: v === 'elite' || v === 'boss' ? v : 'normal' })
      this.resetToForm()
    })
    this.wireGroup('monster-cat', val => {
      globalState.updateProfile({
        monsterCategory: val,
        monsterSubCategory: '',
        monsterRace: '',
      })
      this.buildLeft()
      this.resetToForm()
    })
    this.wireGroup('monster-sub', val => {
      globalState.updateProfile({
        monsterSubCategory: val,
        monsterRace: '',
      })
      this.buildLeft()
      this.resetToForm()
    })
    this.wireGroup('monster-race', val => {
      globalState.updateProfile({ monsterRace: val })
      const customEl = this.q('[data-cd="monster-race-custom"]') as HTMLInputElement
      if (customEl) customEl.value = ''
      this.resetToForm()
    })
    const monsterRaceCustom = this.q('[data-cd="monster-race-custom"]') as HTMLInputElement
    monsterRaceCustom?.addEventListener('input', () => {
      const v = monsterRaceCustom.value.trim()
      if (v) {
        globalState.updateProfile({ monsterRace: v })
        this.leftEl?.querySelectorAll('[data-group="monster-race"] .cd-chip-sm').forEach(b => b.classList.remove('active'))
        this.resetToForm()
      }
    })
    this.wireGroup('monster-body', val => {
      globalState.updateProfile({ monsterBodyType: val })
      this.resetToForm()
    })
    this.wireGroup('monster-threat', val => {
      const v = val === 'elite' || val === 'boss' ? val : 'normal'
      globalState.updateProfile({ monsterThreat: v })
      this.resetToForm()
    })

    // ── 载具字段 ───────────────────────────────────────────────
    // 切大类时清空子类型 + 自定义文本，避免出现「空中载具 + 坦克」这种非法组合。
    const vehicleCatSelect = this.q('[data-cd="vehicle-cat-select"]') as HTMLSelectElement
    vehicleCatSelect?.addEventListener('change', () => {
      globalState.updateProfile({
        vehicleCategory: vehicleCatSelect.value,
        vehicleSubtype: undefined,
        vehicleSubtypeCustom: undefined,
      })
      this.buildLeft()
      this.resetToForm()
    })
    const vehicleSubtypeSelect = this.q('[data-cd="vehicle-subtype-select"]') as HTMLSelectElement
    vehicleSubtypeSelect?.addEventListener('change', () => {
      const val = vehicleSubtypeSelect.value
      globalState.updateProfile({ vehicleSubtype: val })
      if (val !== 'custom') {
        globalState.updateProfile({ vehicleSubtypeCustom: undefined })
      }
      this.buildLeft()
      this.resetToForm()
    })
    const vehicleStyleSelect = this.q('[data-cd="vehicle-style-select"]') as HTMLSelectElement
    vehicleStyleSelect?.addEventListener('change', () => {
      globalState.updateProfile({ vehicleStyle: vehicleStyleSelect.value || undefined })
      this.resetToForm()
    })
    const vehicleEraSelect = this.q('[data-cd="vehicle-era-select"]') as HTMLSelectElement
    vehicleEraSelect?.addEventListener('change', () => {
      globalState.updateProfile({ vehicleEra: vehicleEraSelect.value || undefined })
      this.resetToForm()
    })
    this.wireGroup('vehicle-cat', val => {
      globalState.updateProfile({
        vehicleCategory: val,
        vehicleSubtype: undefined,
        vehicleSubtypeCustom: undefined,
      })
      this.buildLeft()
      this.resetToForm()
    })
    this.wireGroup('vehicle-subtype', val => {
      globalState.updateProfile({ vehicleSubtype: val })
      // 切走 custom 时清空 custom 文本；切到 custom 时保留已有文本
      if (val !== 'custom') {
        globalState.updateProfile({ vehicleSubtypeCustom: undefined })
      }
      this.buildLeft()
      this.resetToForm()
    })
    const vehicleSubCustom = this.q('[data-cd="vehicle-subtype-custom"]') as HTMLTextAreaElement
    vehicleSubCustom?.addEventListener('input', () => {
      const v = vehicleSubCustom.value
      globalState.updateProfile({ vehicleSubtypeCustom: v })
      this.resetToForm()
    })
    this.wireGroup('vehicle-style', val => {
      globalState.updateProfile({ vehicleStyle: val || undefined })
      this.resetToForm()
    })
    this.wireGroup('vehicle-era', val => {
      globalState.updateProfile({ vehicleEra: val || undefined })
      this.resetToForm()
    })

    // ── NPC 职业网格：chip + 自定义输入 ───────────────────────────
    this.wireGroup('npc-occupation', val => {
      globalState.updateProfile({ npcOccupation: val })
      const customEl = this.q('[data-cd="npc-occupation-custom"]') as HTMLInputElement
      if (customEl) customEl.value = ''
      this.resetToForm()
    })
    const npcCustom = this.q('[data-cd="npc-occupation-custom"]') as HTMLInputElement
    npcCustom?.addEventListener('input', () => {
      const v = npcCustom.value.trim()
      if (v) {
        globalState.updateProfile({ npcOccupation: v })
        this.leftEl?.querySelectorAll('[data-group="npc-occupation"] .cd-chip-sm').forEach(b => b.classList.remove('active'))
        this.resetToForm()
      }
    })

    this.leftEl.querySelectorAll('[data-group="world"] [data-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.leftEl!.querySelectorAll('[data-group="world"] [data-val]').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        globalState.updateProfile({ worldSetting: (btn as HTMLElement).dataset.val! })
        const customEl = this.q('[data-cd="world-custom"]') as HTMLInputElement
        if (customEl) customEl.value = ''
        this.updateStatus()
        // NPC 路人职业词表是世界观相关的——切世界观时重渲左栏让 chip 网格
        // 自动换成新世界观下的候选职业，避免出现「现代都市的铁匠」这种怪异组合。
        if (globalState.profile.characterRole === 'npc') {
          this.buildLeft()
        }
        this.resetToForm()
      })
    })

    this.leftEl.querySelectorAll('[data-group="bodytype"] [data-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.leftEl!.querySelectorAll('[data-group="bodytype"] [data-val]').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        globalState.updateProfile({ bodyType: (btn as HTMLElement).dataset.val as BodyType })
        this.updateStatus()
        this.resetToForm()
      })
    })

    const worldCustom = this.q('[data-cd="world-custom"]') as HTMLInputElement
    worldCustom?.addEventListener('input', () => {
      const v = worldCustom.value.trim()
      if (v) {
        globalState.updateProfile({ worldSetting: v })
        this.leftEl?.querySelectorAll('[data-group="world"] [data-val]').forEach(b => b.classList.remove('active'))
        // NPC 模式下词表是世界观相关的——自定义世界观后重新渲染让候选回退到
        // 通用（现代都市）词表，避免用户卡在「旧世界的 chip 还亮着」。
        if (globalState.profile.characterRole === 'npc') {
          this.buildLeft()
        }
        this.resetToForm()
      }
    })

    const classCustom = this.q('[data-cd="class-custom"]') as HTMLInputElement
    classCustom?.addEventListener('input', () => {
      const v = classCustom.value.trim()
      if (v) {
        globalState.updateProfile({ charClass: v })
        this.leftEl?.querySelectorAll('[data-group="class"] .cd-chip-sm').forEach(b => b.classList.remove('active'))
        this.resetToForm()
      }
    })

    this.leftEl.querySelectorAll('[data-group="artstyle"] [data-val]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.leftEl!.querySelectorAll('[data-group="artstyle"] [data-val]').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        const val = (btn as HTMLElement).dataset.val as ArtStyle
        globalState.updateProfile({ artStyle: val || ('' as ArtStyle) })
        const customEl = this.q('[data-cd="artstyle-custom"]') as HTMLInputElement
        if (customEl) customEl.style.display = val === 'custom' ? '' : 'none'
        this.updateStatus()
        this.resetToForm()
      })
    })

    const artStyleCustom = this.q('[data-cd="artstyle-custom"]') as HTMLInputElement
    artStyleCustom?.addEventListener('input', () => {
      globalState.updateProfile({ artStyleCustom: artStyleCustom.value.trim() })
      this.resetToForm()
    })

    this.leftEl.querySelectorAll('.cd-method').forEach(btn => {
      btn.addEventListener('click', () => {
        this.leftEl!.querySelectorAll('.cd-method').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        this.activeMethod = (btn as HTMLElement).dataset.method as any
        this.leftEl!.querySelectorAll('.cd-method-body').forEach(el => (el as HTMLElement).style.display = 'none')
        const body = this.leftEl!.querySelector(`[data-body="${this.activeMethod}"]`) as HTMLElement
        if (body) body.style.display = ''
      })
    })

    this.setupDrop('ref')
    this.setupDrop('direct')
    this.setupDrop('complete')

    this.q('[data-action="gen-text"]')?.addEventListener('click', () => {
      this.phase = 'form'
      this.conceptImages = []
      this.selectedConcepts.clear()
      this.generateConcepts()
    })
    this.q('[data-action="gen-img2img"]')?.addEventListener('click', () => this.generateFromImage())
    this.q('[data-action="gen-complete"]')?.addEventListener('click', () => this.generateSheetFromUpload())
    this.q('[data-action="go-back"]')?.addEventListener('click', () => this.goBackPhase())
  }

  private syncCombatUI(): void {
    const ct = globalState.profile.combatType
    this.leftEl?.querySelectorAll('[data-group="combat"] [data-val]').forEach(b => {
      b.classList.toggle('active', (b as HTMLElement).dataset.val === ct)
    })
  }

  private wireGroup(groupName: string, onChange: (val: string) => void): void {
    this.leftEl?.querySelectorAll(`[data-group="${groupName}"] [data-val]`).forEach(btn => {
      btn.addEventListener('click', () => {
        btn.parentElement!.querySelectorAll('[data-val]').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        onChange((btn as HTMLElement).dataset.val!)
        this.updateStatus()
      })
    })
  }

  private wireCenterEvents(): void {
    // form-phase center events (not used in new two-stage flow)
  }

  private wireHistoryEvents(): void {
    this.q('[data-action="clear-history"]')?.addEventListener('click', () => {
      const currentRole: CharacterRole = globalState.profile?.characterRole ?? 'hero'
      const roleLabel = roleHistoryLabel(currentRole)
      if (!confirm(`确定清空「${roleLabel}」的历史概设？`)) return
      const all = loadHistory()
      const toRemove = all.filter(e => (e.role ?? 'hero') === currentRole)
      const keep = all.filter(e => (e.role ?? 'hero') !== currentRole)
      toRemove.forEach(e => { idbRemove(e.id).catch(() => {}) })
      saveHistory(keep)
      this.renderHistory()
      this.toast(`「${roleLabel}」历史已清空`)
    })
  }

  private async addToHistory(imageData: string): Promise<void> {
    const p = globalState.profile
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

    const thumb = await resizeImage(imageData, 80, 104, 0.6)

    try { await idbSave(id, imageData) } catch (e) {
      console.warn('[History] IndexedDB save failed:', e)
    }

    const entry: HistoryEntry = {
      id,
      name: p.name || p.charClass || '未命名',
      charClass: p.charClass || '',
      imageData: '',
      thumb,
      timestamp: Date.now(),
      role: p.characterRole ?? 'hero',
    }
    const history = loadHistory()
    history.unshift(entry)
    saveHistory(history)
    this.activeHistoryId = id
    this.renderHistory()
  }

  private renderHistory(): void {
    const container = this.q('[data-cd="history"]') as HTMLElement
    if (!container) return
    const currentRole: CharacterRole = globalState.profile?.characterRole ?? 'hero'
    // 历史按角色类型隔离：主角/NPC/怪物/载具各自只看到自己生成的记录，避免
    // 在 NPC 下点「使用此角色」却把主角也带过去。旧数据无 role，按 hero 兜底。
    const history = loadHistory().filter(e => (e.role ?? 'hero') === currentRole)

    if (!history.length) {
      container.innerHTML = '<div class="cd-history-empty">暂无历史记录，生成角色后会自动保存</div>'
      return
    }

    container.innerHTML = ''
    for (const entry of history) {
      const card = document.createElement('div')
      card.className = 'cd-history-card'

      const isActive = this.activeHistoryId === entry.id
      if (isActive) card.classList.add('cd-history-active')

      const time = new Date(entry.timestamp)
      const timeStr = `${time.getMonth() + 1}/${time.getDate()} ${time.getHours()}:${String(time.getMinutes()).padStart(2, '0')}`

      card.innerHTML = `
        <img class="cd-history-thumb" src="${entry.thumb || entry.imageData}" />
        <div class="cd-history-info">
          <div class="cd-history-name">${esc(entry.name)}</div>
          <div class="cd-history-meta">${esc(entry.charClass)}${entry.charClass ? ' · ' : ''}${timeStr}</div>
        </div>
        <div class="cd-history-actions">
          <button class="cd-history-btn cd-history-use" title="使用此角色">▶</button>
          <button class="cd-history-btn cd-history-del" title="删除">×</button>
        </div>
      `

      const useHandler = () => this.useHistoryEntry(entry)
      card.querySelector('.cd-history-thumb')!.addEventListener('click', useHandler)
      card.querySelector('.cd-history-use')!.addEventListener('click', useHandler)
      card.querySelector('.cd-history-del')!.addEventListener('click', () => {
        idbRemove(entry.id).catch(() => {})
        const h = loadHistory().filter(e => e.id !== entry.id)
        saveHistory(h)
        this.renderHistory()
      })

      container.appendChild(card)
    }
  }

  private useHistoryEntry(entry: HistoryEntry): void {
    this.activeHistoryId = entry.id
    this.renderHistory()

    const apply = (img: string) => {
      globalState.setCharacterImage(img)
      // 把历史图同步进内存 conceptImages[0]:renderFinalCenter 在 localStorage
      // quota 撑爆、characterImage 读空时会用 conceptImages[0] 兜底显示。若不更新,
      // 兜底会错显成上一个角色残留的概念图。selectedConcepts 同步勾选第 0 张。
      this.conceptImages = [img]
      this.selectedConcepts = new Set([0])
      // 历史可能在任意 phase（form/concepts/detail）下被点击，此时 center 还没有
      // [data-cd="preview"] 节点，直接 showPreview 会静默失败（按钮看似没反应）。
      // 切到 final 并 refreshCenter，让 center 重新渲染并自然挂载历史图片。
      this.phase = 'final'
      this.refreshCenter()
      this.refreshLeftActions()
      this.updateStatus()
      this.toast(`已加载「${entry.name}」`)
    }

    idbLoad(entry.id).then(fullImg => {
      apply(fullImg || entry.imageData || entry.thumb)
    }).catch(() => {
      apply(entry.imageData || entry.thumb)
    })
  }

  private setupDrop(mode: 'ref' | 'direct' | 'complete'): void {
    const zone = this.q(`[data-drop="${mode}"]`) as HTMLElement
    if (!zone) return
    zone.style.cursor = 'pointer'
    zone.addEventListener('click', () => this.pickFile(mode))
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover') })
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'))
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover')
      const file = e.dataTransfer?.files[0]
      if (file?.type.startsWith('image/')) this.handleFile(file, mode)
    })
  }

  private pickFile(mode: 'ref' | 'direct' | 'complete'): void {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/*'
    input.onchange = () => { if (input.files?.[0]) this.handleFile(input.files[0], mode) }
    input.click()
  }

  private handleFile(file: File, mode: 'ref' | 'direct' | 'complete'): void {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      if (mode === 'direct') {
        saveSelectedConcept(dataUrl)
        globalState.setCharacterImage(dataUrl)
        // 上传时 phase 多半还是 'form'，center 此刻没有 [data-cd="preview"] 节点，
        // 直接 showPreview 会静默失败（图不显示、看似「没接通」）。先切到 final
        // 并 refreshCenter 让 center 重渲染出预览/动作区，再走后续流程。
        this.conceptImages = [dataUrl]
        this.selectedConcepts = new Set([0])
        // 「直接上传」是用户主动行为,要先停在 final 让其看到结果 + 自己点进管线。
        // NPC 在 renderFinalCenter 里默认会 maybeAutoRouteNpcToPixel() 立刻跳走
        // (那是 AI 生成流程的预期),会让用户「看不到上传的图」。这里预先把本图标记
        // 为已路由,使 shouldAutoRouteNpcToPixel 返回 false,跳过自动跳转。
        this._npcAutoRoutedForImage = dataUrl
        // split-pane:上传发生在 left iframe,但预览区在 center iframe。center
        // 实例靠 broadcast(phase + conceptCount) + 共享存储拿图。characterImage
        // 走 localStorage,大图可能撑爆 quota → center 读空、永远卡"加载中"。所以把
        // 上传图也写进 IDB(与 AI 概念图同机制),让 center 的 handleBroadcast 能可靠
        // loadConceptsFromIDB() 读到。await 写完再 refresh/broadcast,避免竞态。
        void saveConceptsToIDB([dataUrl])
          .catch(() => {})
          .finally(() => {
            this.phase = 'final'
            this.refreshCenter()
            this.refreshLeftActions()
            this.addToHistory(dataUrl)
            this.updateStatus()
            this.toast('已上传，可进入后续管线')
          })
      } else if (mode === 'complete') {
        this.completeRefImage = dataUrl
        const zone = this.q('[data-drop="complete"]') as HTMLElement
        if (zone) {
          zone.innerHTML = `<img src="${dataUrl}" style="max-width:100%;max-height:120px;object-fit:contain;border-radius:4px;"><div class="cd-drop-sub" style="margin-top:4px;">点击重新上传</div>`
          zone.addEventListener('click', () => this.pickFile('complete'), { once: true })
        }
        const btn = this.q('[data-action="gen-complete"]') as HTMLButtonElement
        if (btn) btn.disabled = false
      } else {
        this.refImageData = dataUrl
        const zone = this.q('[data-drop="ref"]') as HTMLElement
        if (zone) {
          zone.innerHTML = `<img src="${dataUrl}" style="max-width:100%;max-height:100px;object-fit:contain;border-radius:4px;"><div class="cd-drop-sub" style="margin-top:4px;">点击重新上传</div>`
          zone.addEventListener('click', () => this.pickFile('ref'), { once: true })
        }
        const btn = this.q('[data-action="gen-img2img"]') as HTMLButtonElement
        if (btn) btn.disabled = false
      }
    }
    reader.readAsDataURL(file)
  }

  // ── AI Integration ────────────────────────────────────────────

  private buildCharacterBrief(): string {
    const p = globalState.profile
    const world = this.getWorldInfo()
    const artStyle = this.getArtStyleInfo()
    const parts: string[] = []
    if (p.name) parts.push(`角色名：${p.name}`)
    if (p.characterRole === 'npc') {
      // 路人 NPC 的 brief 刻意精简——不提「形态/战斗类型」这些英雄字段，
      // 避免 LLM 脑补出武器 / 大招 / 气势动作。
      parts.push('角色定位：职业 NPC / 路人（非战斗角色）')
      parts.push(`世界观：${world.zh}`)
      if (!getBodyType(p.bodyType).suppressGenderInPrompt) {
        parts.push(`性别：${p.gender === 'female' ? '女' : '男'}`)
      }
      if (p.age) parts.push(`年龄：${p.age}`)
      const occ = p.npcOccupation || '路人'
      parts.push(`NPC 职业：${occ}`)
      parts.push(`画风：${artStyle.zh}`)
      if (p.extraDesc) parts.push(`补充描述：${p.extraDesc}`)
      return parts.join('\n')
    }

    if (p.characterRole === 'monster') {
      // 怪物 brief：只列分类 / 体型 / 威胁 + 世界观，不走性别 / 战斗类型。
      // Gemini 拿到这个 brief 再配合 concept prompt 一起生图。
      parts.push('角色定位：怪物 / 敌人')
      if (p.monsterCategory) parts.push(`主分类：${p.monsterCategory}`)
      if (p.monsterSubCategory) parts.push(`次分类：${p.monsterSubCategory}`)
      if (p.monsterRace) parts.push(`种族：${p.monsterRace}`)
      if (p.monsterBodyType && p.monsterBodyType !== 'default') {
        const preset = MONSTER_BODY_PRESETS.find(b => b.id === p.monsterBodyType)
        if (preset) parts.push(`体型：${preset.label}（${preset.prompt}）`)
      }
      const threatLabel = p.monsterThreat === 'boss' ? 'BOSS' : p.monsterThreat === 'elite' ? '精英' : '普通小怪'
      parts.push(`威胁等级：${threatLabel}`)
      parts.push(`世界观：${world.zh}`)
      parts.push(`画风：${artStyle.zh}`)
      if (p.extraDesc) parts.push(`补充描述：${p.extraDesc}`)
      return parts.join('\n')
    }

    if (p.characterRole === 'vehicle') {
      // 载具 brief：只列大类 / 子型 / 风格 / 时代 + 世界观，不走性别 / 战斗类型 / 形态。
      const cat = getVehicleCategory(p.vehicleCategory)
      const sub = getVehicleSubtype(p.vehicleCategory, p.vehicleSubtype)
      const styleOpt = getVehicleStyle(p.vehicleStyle)
      const eraOpt = getVehicleEra(p.vehicleEra)
      parts.push('角色定位：载具（无人驾驶/可骑乘）')
      if (cat) parts.push(`载具大类：${cat.icon} ${cat.label}`)
      if (sub) {
        parts.push(`子类型：${sub.label}`)
        if (isCustomVehicleSubtype(sub) && p.vehicleSubtypeCustom) {
          parts.push(`自定义描述：${p.vehicleSubtypeCustom}`)
        }
      }
      if (styleOpt) parts.push(`美术风格：${styleOpt.label}`)
      if (eraOpt) parts.push(`时代：${eraOpt.label}`)
      parts.push(`世界观：${world.zh}`)
      parts.push(`画风：${artStyle.zh}`)
      if (p.extraDesc) parts.push(`补充描述：${p.extraDesc}`)
      return parts.join('\n')
    }

    const bodyType = getBodyType(p.bodyType)
    parts.push(`形态：${bodyType.label}（参考：${bodyType.references}）`)
    if (!bodyType.suppressGenderInPrompt) {
      parts.push(`性别：${p.gender === 'female' ? '女' : '男'}`)
    }
    if (p.age) parts.push(`年龄：${p.age}`)
    if (p.charClass) parts.push(`职业：${p.charClass}`)
    parts.push(`战斗类型：${p.combatType === 'ranged' ? '远程' : '近战'}`)
    parts.push(`世界观：${world.zh}`)
    parts.push(`画风：${artStyle.zh}`)
    if (p.extraDesc) parts.push(`补充描述：${p.extraDesc}`)
    return parts.join('\n')
  }

  /**
   * 路人 NPC 专用 system prompt。生成 **单人正面全身立绘**（与 buildSystemPrompt
   * 同样的调用点）但去掉：武器 / 大招 / 动态战斗姿态 / rim-lighting 史诗演出。
   *
   * 仍保留：世界观服饰、画风、配色 631。
   * 注意：NPC 只画正面单人立绘，不画 turnaround / reference sheet 多视图。
   */
  private buildNpcSystemPrompt(): string {
    const p = globalState.profile
    const charName = p.name || '未命名 NPC'
    const genderEn = p.gender === 'female' ? 'female' : 'male'
    const genderZh = p.gender === 'female' ? '女性' : '男性'
    const world = this.getWorldInfo()
    const artStyle = this.getArtStyleInfo()
    const occ = describeNpcOccupation(p.worldSetting, p.npcOccupation)

    const isDefault = !p.artStyle
    const styleDescZh = isDefault ? '自然质朴的 2D 角色插画' : `${artStyle.zh} 风格`
    const styleDescEn = isDefault
      ? 'clean 2D character illustration, soft cel shading, natural tones, reference-sheet quality, NOT splash art, NOT cinematic'
      : `${artStyle.en} style`

    return `## Role
你是一位世界顶级的**游戏 NPC / 路人角色设计师**，擅长把世界观里最普通的职业人物画成干净的 2D 立绘。

## 角色核心信息（必须严格遵守）
- **角色名**：${charName}
- **角色定位**：职业 NPC / 路人（**不是主角，不是战斗角色**）
- **性别**：${genderZh} (${genderEn})${p.age ? `\n- **年龄段**：${p.age}` : ''}
- **职业 / 身份**：${occ.zh}（${occ.en}）
- **世界观**：${world.zh} (${world.en}) — 服饰、配饰、道具必须贴合此世界观
- **画风**：${artStyle.zh}
${p.extraDesc ? `- **补充描述**：${p.extraDesc}` : ''}

## 风格强制要求
- 画风：${styleDescZh}
- ⚠️ **这是路人 / NPC，不是主角**：**不要**画成美宣、不要 splash art、不要戏剧灯光、不要战斗姿态、不要武器、不要技能特效、不要能量光效。
- ⚠️ **单人正面立绘**：画面中只有 **一个角色、一个视角（正面）、一个姿势**。绝对不要画成 reference sheet / turnaround / 多视图版式（不要出现同一角色的正面+侧面+背面）。
- ⚠️ **姿势**：自然放松的站立姿势（contrapposto / 略微侧身 / 低头 / 揣口袋 / 抱物品 均可），**不要摆战斗 pose**。
- ⚠️ **装备**：符合「${world.zh} + ${occ.zh}」的日常穿着，**不要**盔甲、不要巨剑、不要法杖。小道具允许：购物袋、工具、扫把、书本、围裙、挎包、便当盒、手机 / 翻译器 / 烟嘴（按世界观选）等。
- **完整全身像**：从头顶到脚底完整展示，留出舒适边距，绝不裁切。
- **配色准则 631**：主色 60%（服饰主色）、辅助色 30%、强调色 10%（贴合世界观的小点缀）。
- 背景：简洁底色 (#e6e6e6) 或轻度的世界观场景氛围，但**不要**英雄画那种全局光 / 粒子 / 烟雾。

## 输出格式
先输出 5 行中文设计策略（·开头），然后用 ---PROMPT--- 分隔，再输出一段英文提示词。

设计策略：
· 身份：[一句话，"${occ.zh}" 在 "${world.zh}" 世界下的典型面貌]
· 服装：[按世界观 + 职业写 3 个标志性穿搭细节]
· 配饰 / 道具：[2-3 件贴近职业日常的小物件（非武器）]
· 配色：[主色 / 辅助色 / 强调色]
· 气质：[性格 / 神态关键词，如 疲惫、热情、佝偻、文静]

---PROMPT---

英文提示词结构：
(masterpiece:1.2), (best quality:1.2), (single character portrait:1.4), 2D character illustration, ${styleDescEn}, (${world.en} setting:1.2), front-facing full body, no weapon, civilian NPC, ${occ.en}, ${genderEn}, natural relaxed standing pose, everyday clothing appropriate to ${world.en}, clean readable silhouette, neutral lighting, soft ambient light, (solo:1.5), (only one person:1.5), (NO action pose, NO combat stance, NO weapons, NO magic, NO dramatic lighting, NO particles, NO splash art:1.3), (NOT character sheet, NOT reference sheet, NOT turnaround, NOT multiple views:1.5), [服饰细节补充 / 道具 / 神态], light grey background #e6e6e6, no text, no watermark, no UI

不要输出任何其他解释文字。`
  }

  /**
   * 路人 NPC 专用 concept prompt。**只输出 1 段**——路人是世界里的背景群众，
   * 画 4 个变体纯属浪费模型调用，1 张「正面放松站立」就能承接后续的设定图生成
   * + 像素动画管线。
   *
   * 相应地，`generateConcepts()` 会在 NPC 模式下把 prompts 裁到 `slice(0, 1)`，
   * 并且在 concepts 阶段自动勾选这唯一一张，用户点一下「生成设定图」就进 final。
   */
  private buildNpcConceptSystemPrompt(): string {
    const p = globalState.profile
    const charName = p.name || '未命名 NPC'
    const genderEn = p.gender === 'female' ? 'female' : 'male'
    const genderZh = p.gender === 'female' ? '女性' : '男性'
    const world = this.getWorldInfo()
    const artStyle = this.getArtStyleInfo()
    const occ = describeNpcOccupation(p.worldSetting, p.npcOccupation)

    const isDefault = !p.artStyle
    const stylePrefix = isDefault
      ? '(masterpiece:1.2), (best quality:1.2), (single character portrait:1.4), 2D character illustration, clean cel shading, soft natural lighting, front-facing full body,'
      : `(masterpiece:1.2), (best quality:1.2), (single character portrait:1.4), ${artStyle.keywords} front-facing full body,`
    const styleSuffix = isDefault
      ? `natural daylight, subtle ambient occlusion, ${world.en} everyday atmosphere, (solo:1.5), (only one person:1.5), no text, no watermark, no UI, (NOT character sheet, NOT reference sheet, NOT turnaround, NOT multiple views, NOT multiple angles, NOT front and back, NOT side view:1.5), NEGATIVE: no weapon, no combat stance, no magic, no splash art, no dramatic rim light, no particles, no multiple characters, no multiple poses`
      : `${artStyle.en} rendering, ${world.en} everyday atmosphere, (solo:1.5), (only one person:1.5), no text, no watermark, no UI, (NOT character sheet, NOT reference sheet, NOT turnaround, NOT multiple views, NOT multiple angles, NOT front and back, NOT side view:1.5), NEGATIVE: no weapon, no combat stance, no magic, no splash art, no multiple characters, no multiple poses`

    return `## Role
你是一位擅长绘制**游戏路人 NPC 立绘**的插画师。
根据角色信息，输出 **1 段英文绘画提示词**（不要分隔、不要编号、不要多版本）。
对应生成一张 **16:9 横版单人正面全身立绘**，**绝不是战斗美宣**。

⚠️ 最重要的约束：**只画一个人、一个视角（正面）、一个姿势**。
绝对不要画成 reference sheet / turnaround / 多视图版式。不要出现同一角色的正面+侧面+背面。
这不是角色设定稿，这是 **一张单独的角色立绘**。

## 角色核心信息（必须严格遵守）
- **角色名**：${charName}
- **角色定位**：职业 NPC / 路人
- **性别**：${genderZh} (${genderEn})${p.age ? `\n- **年龄段**：${p.age}` : ''}
- **职业 / 身份**：${occ.zh}（${occ.en}）
- **世界观**：${world.zh} (${world.en})
- **画风**：${artStyle.zh}
${p.extraDesc ? `- **补充描述**：${p.extraDesc}` : ''}

## 画面质量与风格
- **高质量立绘渲染**：线条干净、cel shading、柔和日光、自然氛围
- **严格 solo / 单一主体**，画面中只有一个角色，绝不能出现第二个角色或同一角色的多个视角
- **完整全身像**，居中占画面 50%-65%，留出舒适边距
- **单一正面视角**：角色面朝观众，自然放松的站立姿势（微微侧身 / contrapposto 亦可），展示完整全身服饰
- **世界观服饰**：按 ${world.en} 还原职业 ${occ.zh} 的日常穿搭
- **没有武器、没有战斗姿态、没有特效、没有光效爆炸**
- ⚠️ **禁止多视图**：不要画成 character sheet / reference sheet / turnaround。不要在画面中出现同一角色的多个姿势或多个角度。

## 输出格式
只输出 1 段英文 prompt，不要任何分隔符 / 编号 / 解释。
必须以这个质量前缀开头（照搬不改）：
${stylePrefix}

结尾统一追加：
${styleSuffix}`
  }

  /**
   * 怪物专用「生成单张概念图（生成设定图）」的 system prompt——和英雄 /
   * NPC 的一样，要 Claude/ Gemini 输出「一段英文 prompt」，用来给 Gemini
   * 图像模型作为正向描述。
   *
   * 关键约束（与 NPC 一致 + 怪物额外项）：
   *   - solo creature / single monster / full body / centered
   *   - 中性背景（light grey），便于 pixel-char 管线后续切帧去背景；
   *   - 严禁多视图 / reference sheet / turnaround；
   *   - 按 threat 调整演出强度（BOSS 才给 rim light / volumetric）。
   */
  private buildMonsterSystemPrompt(): string {
    return this.buildMonsterConceptSystemPrompt()
  }

  private buildMonsterConceptSystemPrompt(): string {
    const p = globalState.profile
    const world = this.getWorldInfo()
    const artStyle = this.getArtStyleInfo()
    const race = (p.monsterRace || p.monsterSubCategory || p.monsterCategory || 'creature').trim()
    const bodyPreset = MONSTER_BODY_PRESETS.find(b => b.id === p.monsterBodyType)
    const threatZh = p.monsterThreat === 'boss' ? 'BOSS' : p.monsterThreat === 'elite' ? '精英' : '普通小怪'
    const basePrompt = buildMonsterConceptPrompt({
      name: p.name,
      monsterCategory: p.monsterCategory,
      monsterSubCategory: p.monsterSubCategory,
      monsterRace: p.monsterRace,
      monsterBodyType: p.monsterBodyType,
      monsterThreat: p.monsterThreat,
      worldSetting: p.worldSetting,
    })
    return `## Role
你是一位擅长绘制**2D 游戏怪物立绘**的概念画师。
根据怪物设定信息，输出 **1 段英文绘画提示词**（不要分隔、不要编号、不要多版本）。
对应生成一张 **单个怪物 / 全身 / 居中 / 中性背景** 的立绘，供后续 pixel-char 管线作为参考。

⚠️ 最重要的约束：**只画一个生物、一个视角、一个姿势**。
不要画成 character sheet / reference sheet / turnaround / 多视图版式。
不要画人类角色、不要画骑手、不要画多个生物。

## 怪物核心信息
- **名称**：${p.name || race}
- **分类**：${p.monsterCategory ?? '未定'} / ${p.monsterSubCategory ?? '未定'} / ${race}
- **体型**：${bodyPreset ? `${bodyPreset.label}（${bodyPreset.prompt}）` : '未指定'}
- **威胁等级**：${threatZh}
- **世界观**：${world.zh} (${world.en})
- **画风**：${artStyle.zh}
${p.extraDesc ? `- **补充描述**：${p.extraDesc}` : ''}

## 画面要求
- solo creature / single monster，**画面中只有一个怪物**
- full body，居中构图，正面朝向观众（轻微 3/4 视角亦可）
- **clean readable silhouette** 清晰轮廓
- **neutral plain light grey background #e6e6e6**（pixel-char 管线依赖干净背景切帧）
- 不要 UI / 文字 / 水印 / 战斗特效 / 多角度版式
${p.monsterThreat === 'boss' ? '- 允许 volumetric / rim lighting 提升压迫感' : '- 不加夸张光效，保持 gameplay readability'}

## 输出格式
只输出 1 段英文 prompt，不要任何分隔符 / 编号 / 解释。
推荐以这个模板开头，并根据怪物描述调整细节：
${basePrompt}`
  }

  /**
   * 载具专用「生成单张概念图」的 system prompt——和 NPC / 怪物的一样，让
   * Claude / Gemini 输出**一段英文 prompt**，给图像模型作为正向描述。
   *
   * 关键约束：
   *   - solo vehicle / single ${载具子类型} / full body / centered
   *   - 中性灰底背景，下游 wb-anim/vehicle-design 管线依赖干净背景切多视角；
   *   - 严禁画驾驶员 / 骑手 / 人物 —— 载具是工业产品，"角色 + 坐骑"那条
   *     线由 hero+vehicle 在 prompts 后期手动组合；
   *   - 严禁多视图 / reference sheet / turnaround——下游自己切。
   */
  private buildVehicleSystemPrompt(): string {
    const p = globalState.profile
    const world = this.getWorldInfo()
    const artStyle = this.getArtStyleInfo()
    const cat = getVehicleCategory(p.vehicleCategory)
    const sub = getVehicleSubtype(p.vehicleCategory, p.vehicleSubtype)
    const styleOpt = getVehicleStyle(p.vehicleStyle)
    const eraOpt = getVehicleEra(p.vehicleEra)
    const subjectZh = isCustomVehicleSubtype(sub)
      ? (p.vehicleSubtypeCustom?.trim() || cat?.label || '载具')
      : (sub?.label || cat?.label || '载具')
    const basePrompt = buildVehicleConceptPrompt({
      vehicleCategory: p.vehicleCategory,
      vehicleSubtype: p.vehicleSubtype,
      vehicleSubtypeCustom: p.vehicleSubtypeCustom,
      vehicleStyle: p.vehicleStyle,
      vehicleEra: p.vehicleEra,
      worldSetting: p.worldSetting,
      extraDesc: p.extraDesc,
    })
    return `## Role
你是一位擅长绘制**2D 游戏载具概念图**的载具设计师。
根据载具设定信息，输出 **1 段英文绘画提示词**（不要分隔、不要编号、不要多版本）。
对应生成一张 **单台载具 / 三视图角度（推荐 3/4 前侧视）/ 中性背景** 的概念图，供后续 wb-anim/vehicle-design 管线作为参考。

⚠️ 最重要的约束：**只画一台载具、一个角度、不要画驾驶员/骑手**。
不要画成 character sheet / reference sheet / turnaround / 多视图版式。

## 载具核心信息
- **大类**：${cat ? `${cat.icon} ${cat.label}` : '未指定'}
- **子类型**：${subjectZh}
- **风格**：${styleOpt ? styleOpt.label : '默认（沿用画风风格）'}
- **时代**：${eraOpt ? eraOpt.label : '默认'}
- **世界观**：${world.zh} (${world.en})
- **画风**：${artStyle.zh}
${p.extraDesc ? `- **补充描述**：${p.extraDesc}` : ''}

## 画面要求
- solo vehicle / single ${subjectZh}，**画面中只有一台载具**
- full body 完整车体，居中构图，3/4 前侧视角（front three-quarter）
- **clean readable silhouette** 清晰轮廓，独特造型语言
- **neutral plain light grey background #e6e6e6**（下游切多视角依赖干净背景）
- **NO 驾驶员，NO 骑手，NO 人物，NO 武器（被人类持握的）**
- 不要 UI / 文字 / 水印 / 多角度版式 / 速度线 / 排气尾迹

## 输出格式
只输出 1 段英文 prompt，不要任何分隔符 / 编号 / 解释。
推荐以这个模板开头，并根据载具描述调整细节：
${basePrompt}`
  }

  private getWorldInfo(): { zh: string; en: string } {
    const ws = globalState.profile.worldSetting
    if (!ws) return { zh: '中世纪奇幻', en: 'Medieval Fantasy' }
    const found = WORLD_OPTIONS.find(w => w.id === ws)
    return found ? { zh: found.label, en: found.en } : { zh: ws, en: ws }
  }

  private getArtStyleInfo(): { zh: string; en: string; keywords: string } {
    const p = globalState.profile
    if (!p.artStyle) {
      return { zh: '韩式写实', en: 'Korean realistic 2D', keywords: '' }
    }
    if (p.artStyle === 'custom') {
      return { zh: p.artStyleCustom || '自定义', en: p.artStyleCustom || 'custom style', keywords: p.artStyleCustom + ',' }
    }
    const found = ART_STYLE_OPTIONS.find(s => s.id === p.artStyle)
    const kw = STYLE_KEYWORDS[p.artStyle]
    return {
      zh: found?.label ?? p.artStyle,
      en: kw?.keywords.replace(/,$/, '').trim() ?? p.artStyle,
      keywords: kw?.keywords ?? '',
    }
  }

  private buildSystemPrompt(): string {
    const p = globalState.profile
    // 路人 NPC 走独立 prompt，绕开英雄管线那一大堆武器 / 战斗 / 非人形分支
    if (p.characterRole === 'npc') return this.buildNpcSystemPrompt()
    // 怪物走独立 prompt：复用 `buildMonsterConceptPrompt` 的正负面约束，
    // 配合 brief 给到 Gemini，保持「单个怪物 / 全身 / 居中 / 中性背景」。
    if (p.characterRole === 'monster') return this.buildMonsterSystemPrompt()
    // 载具走独立 prompt：复用 `buildVehicleConceptPrompt` 的正负面约束，
    // 保持「单个载具 / 三视角图 / 中性背景 / 无人无驾驶员」。
    if (p.characterRole === 'vehicle') return this.buildVehicleSystemPrompt()
    const charName = p.name || '未命名角色'
    const genderEn = p.gender === 'female' ? 'female' : 'male'
    const genderZh = p.gender === 'female' ? '女性' : '男性'
    const classEn = CLASS_EN[p.charClass] || p.charClass || 'Warrior'
    const classZh = p.charClass || '战士'
    const combatEn = p.combatType === 'ranged' ? 'ranged' : 'melee'
    const combatZh = p.combatType === 'ranged' ? '远程' : '近战'
    const world = this.getWorldInfo()
    const artStyle = this.getArtStyleInfo()
    const bodyType = getBodyType(p.bodyType)
    const isNonHumanoid = bodyType.id !== 'humanoid'
    const speciesProfessionEn = describeProfession(p.bodyType, p.charClass, classEn)

    const isDefault = !p.artStyle
    // 非人形主角默认走「indie game splash」风格而非 DNF，避免硬塞写实人体光影
    const styleDescZh = isDefault
      ? (isNonHumanoid
        ? `独立游戏宣传画风格（参考：${bodyType.references}）`
        : '韩式写实2D横版动作游戏风格 (DNF/地下城与勇士)')
      : `${artStyle.zh} 风格`
    const styleDescEn = isDefault
      ? (isNonHumanoid
        ? `indie game splash art, hand-painted 2D, ${bodyType.silhouetteEn}, NOT human, NOT DNF, NOT realistic human anatomy`
        : '2D Korean action game art, cel shaded, high definition, DNF Dungeon Fighter style, 4~5 head-to-body ratio, stylized realistic, NOT chibi')
      : `${artStyle.en} style`
    // 形态优先于画风的比例宣告
    const proportionRule = isNonHumanoid
      ? `头身比：${bodyType.proportionsEn}`
      : (p.artStyle === 'chibi'
        ? '头身比：2~3头身，Q版萌系比例，大头小身体'
        : isDefault
          ? '头身比：约4~5头身，写实帅气，肌肉线条分明，绝非Q版/SD'
          : '头身比：符合所选画风的标准比例')
    const lineRule = isDefault
      ? '线条：硬朗精致的2D手绘，cel shading，清晰轮廓线'
      : `线条：符合「${artStyle.zh}」画风的线条风格`

    // 非人形：用解剖/剪影/negative 替换默认的「双脚穿鞋 / 完整人体」断言
    const fullBodyRule = isNonHumanoid
      ? `⚠️ **完整全身像强制要求**：中心人物必须是从最高点到最低点的完整身体像，绝不裁切。${bodyType.anatomyEn ? `解剖结构：${bodyType.anatomyEn}。` : ''}${bodyType.silhouetteEn ? `剪影特征：${bodyType.silhouetteEn}。` : ''}头顶和最低点都留出舒适边距，任何身体部位不得接触画面边缘。`
      : '⚠️ **完整全身像强制要求**：中心人物必须是从头顶到脚底的完整全身像，绝不裁切。画面必须包含：完整头发（含发梢和发饰）、完整面部、双肩、双臂全长（上臂+前臂+手掌+手指）、完整躯干和服装细节、双腿全长（大腿+膝盖+小腿+脚踝）、双脚和鞋靴完整可见、手持武器从柄到尖完整展示。头顶和脚底留出舒适的边距，角色任何部分不得接触或被画面边缘裁切。'

    const negativeBlock = isNonHumanoid && bodyType.negativeEn
      ? `\n- ⚠️ **NEGATIVE（绝对禁止）**：${bodyType.negativeEn}`
      : ''

    // 中文核心信息里的「性别」「形态」呈现
    const speciesLine = isNonHumanoid
      ? `- **形态**：${bodyType.label}（${bodyType.references}）— **绝对不是人形 / 不要画成人**`
      : `- **形态**：人形 (humanoid)`
    const genderLine = bodyType.suppressGenderInPrompt
      ? '' // 非人形时性别只是审美倾向，不进 prompt 强约束
      : `- **性别**：${genderZh} (${genderEn})`

    // Center Main 的英文模板里把 `${genderEn} ${classEn}` 换成形态适配描述
    const centerSubject = isNonHumanoid
      ? `(MANDATORY complete full body — every limb / appendage / wing visible:1.6), ${speciesProfessionEn} in ${world.en} setting, anatomy: ${bodyType.anatomyEn}`
      : `(MANDATORY complete full body from head to feet:1.6), ${genderEn} ${classEn} in ${world.en} setting, [根据${classZh}职业和${world.zh}世界观填写：标志性武器、世界观风格的专属装备、战斗姿态、外貌细节], natural confident standing pose, clear silhouette, both feet with shoes/boots fully visible, comfortable margin above head and below feet, (NEVER crop any body part)`

    const equipNoteEn = isNonHumanoid
      ? `${bodyType.silhouetteEn}`
      : 'highly detailed outfit with material textures (fabric weave, leather grain, metal reflection)'

    const negativePromptLineEn = isNonHumanoid && bodyType.negativeEn
      ? `\n\nNegative prompt: ${bodyType.negativeEn}`
      : ''

    return `## Role
你是一位世界顶级的**角色概念设计师**，擅长多种画风的角色设计。
根据用户提供的角色信息，输出**设计分析**与**精准绘画提示词**。

## 角色核心信息（必须严格遵守）
- **角色名**：${charName}
${speciesLine}
- **职业**：${classZh} (${classEn}) — 这是最重要的设定，武器、装备、技能都必须与此职业完全匹配${isNonHumanoid ? `；本形态下职业的视觉表达：${speciesProfessionEn}` : ''}
- **世界观**：${world.zh} (${world.en}) — 装备、服饰、道具风格必须符合此世界观设定
- **画风**：${artStyle.zh} — 画面的视觉呈现必须严格遵循此画风
${genderLine}
- **战斗类型**：${combatZh} (${combatEn})
${p.age ? `- **年龄段**：${p.age}` : ''}
${p.extraDesc ? `- **补充描述**：${p.extraDesc}` : ''}

## 风格强制要求
- 画风：${styleDescZh}
- 世界观风格：**${world.zh} (${world.en})**，所有装备、道具、环境元素、色调都必须贴合该世界观
- ${proportionRule}
- ${lineRule}
- ${fullBodyRule}
- **配色准则 631**：主色调 60%（角色主题色）、辅助色 30%（互补色）、强调色 10%（高饱和点缀），确保视觉层次分明
- **材质与光影**：高度细致的服装材质纹理（布料编织、皮革纹理、金属反光），rim lighting 边缘光 + 柔和环境遮蔽营造立体感
- 左上角为**角色名 "${charName}" + 炫酷美宣战斗图**，名字下方标注职业 "${classZh}"
- 装备拆解必须是**全彩渲染图**，禁止线稿
- ⚠️ 武器和装备必须与「${classZh}」职业匹配，禁止出现其他职业的武器
- ⚠️ 世界观必须是「${world.zh}」，服饰和装备风格不得与世界观矛盾${negativeBlock}

## 输出格式
先输出5行中文设计策略（·开头），然后用 ---PROMPT--- 分隔，再输出一段英文提示词。

设计策略：
· 核心概念：[一句话，必须体现"${classZh}"在"${world.zh}"世界观下的职业特色]
· 关键装备：[3个与"${classZh}"匹配的核心装备]
· 核心配色：[主色 / 辅助色 / 强调色]
· 视觉特征：[3-4个标志性元素]
· 战斗风格：[${classZh}的战斗特点]

---PROMPT---

${buildFinalSheetLayoutTemplate({
    charName,
    classZh,
    classEn,
    combatEn,
    worldZh: world.zh,
    worldEn: world.en,
    speciesProfessionEn,
    centerSubject,
    equipNoteEn,
    styleDescEn,
    negativePromptLineEn,
  } satisfies FinalSheetTemplateCtx, globalState.getImageModel())}`
  }

  private buildConceptSystemPrompt(): string {
    const p = globalState.profile
    // 路人 NPC 走独立 4 张变体生成器——背景、姿态、视角模板都跟英雄不同
    if (p.characterRole === 'npc') return this.buildNpcConceptSystemPrompt()
    // 怪物走独立 4 张变体生成器，复用 `buildMonsterConceptPrompt` 做正负面约束。
    if (p.characterRole === 'monster') return this.buildMonsterConceptSystemPrompt()
    // 载具：4 张变体复用同一份 buildVehicleSystemPrompt——同 prompt 跑 4 次，
    // 让 Gemini 自己产生姿态/角度/配色微差，跟 NPC 同一处理思路。
    if (p.characterRole === 'vehicle') return this.buildVehicleSystemPrompt()
    const charName = p.name || '未命名角色'
    const genderEn = p.gender === 'female' ? 'female' : 'male'
    const genderZh = p.gender === 'female' ? '女性' : '男性'
    const classEn = CLASS_EN[p.charClass] || p.charClass || 'Warrior'
    const classZh = p.charClass || '战士'
    const combatEn = p.combatType === 'ranged' ? 'ranged' : 'melee'
    const combatZh = p.combatType === 'ranged' ? '远程' : '近战'
    const world = this.getWorldInfo()
    const artStyle = this.getArtStyleInfo()
    const bodyType = getBodyType(p.bodyType)
    const isNonHumanoid = bodyType.id !== 'humanoid'
    const speciesProfessionEn = describeProfession(p.bodyType, p.charClass, classEn)

    const isDefault = !p.artStyle
    const styleQualityBlock = isDefault
      ? (isNonHumanoid
        ? `- **独立游戏宣传画** 级别渲染质量（参考：${bodyType.references}）
- 视觉语言：${bodyType.silhouetteEn}
- 光影：手绘 2D rim light、柔光、indie art 调色，避免照片级写实
- 氛围：clean readable silhouette、storybook 质感、配色精炼`
        : `- **LOL splash art / game CG** 级别渲染质量
- 极致光影：全局光照、体积光（volumetric lighting）、rim light、subsurface scattering
- 材质质感：金属反光、皮革纹理、布料褶皱、皮肤毛孔级细节
- 氛围渲染：景深（depth of field）、粒子特效（particles）、光晕（lens flare）、烟雾、火花`)
      : `- **画风严格要求**：${artStyle.zh} (${artStyle.en})
- 画面质量：${artStyle.zh}风格下的最高品质渲染
- 光影氛围：符合${artStyle.zh}画风的光影处理和材质表现`

    // 注意：Claude 会照抄 stylePrefix/Suffix 到最终图像 prompt 里，所以这两
    // 段英文必须针对目标生图模型选择正确的语言风格（booru tag vs 自然语言）。
    // 见 conceptPromptStyles.ts。
    const conceptCtx: ConceptStyleCtx = {
      isNonHumanoid,
      isDefault,
      worldEn: world.en,
      bodyTypeSilhouetteEn: bodyType.silhouetteEn,
      bodyTypeReferences: bodyType.references,
      bodyTypeNegativeEn: bodyType.negativeEn ?? '',
      artStyleZh: artStyle.zh,
      artStyleEn: artStyle.en,
      artStyleKeywords: artStyle.keywords,
    }
    const { stylePrefix, styleSuffix } = buildConceptStyleDirectives(
      conceptCtx,
      globalState.getImageModel(),
    )

    // Solo descriptor — 人形是 1girl/1boy；非人形按物种走
    const soloDescriptor = isNonHumanoid
      ? `solo, single creature, ${bodyType.speciesEn}`
      : `solo, 1${p.gender === 'female' ? 'girl' : 'boy'}, ${classEn.toLowerCase()}, ${genderEn}`

    const subjectEn = isNonHumanoid
      ? `${speciesProfessionEn}, anatomy: ${bodyType.anatomyEn}, ${bodyType.silhouetteEn}`
      : `${classEn.toLowerCase()} ${genderEn}, [发型/发色/瞳色/体型/装备/武器等详细描述], highly detailed outfit with material textures (fabric weave, leather grain, metal reflection)`

    const fullBodyClause = isNonHumanoid
      ? '(complete full body — every limb / wing / appendage visible:1.5)'
      : '(complete full body from head to feet:1.5), both feet with shoes visible'

    const speciesLineZh = isNonHumanoid
      ? `- **形态**：${bodyType.label}（${bodyType.references}）— **不是人形 / 不要画成人**`
      : '- **形态**：人形 (humanoid)'
    const genderLineZh = bodyType.suppressGenderInPrompt
      ? ''
      : `- **性别**：${genderZh} (${genderEn})`

    return `## Role
你是一位世界顶级的**游戏美术概念设计师**，擅长多种画风的角色宣传画。
根据角色信息，输出 **4 段不同变体** 的英文绘画提示词，用 ---VAR--- 分隔。
每段提示词生成一张 **16:9 横版高品质单人美宣图**。

## 角色核心信息（必须严格遵守）
- **角色名**：${charName}
${speciesLineZh}
- **职业**：${classZh} (${classEn})${isNonHumanoid ? `；本形态下视觉表达：${speciesProfessionEn}` : ''}
- **世界观**：${world.zh} (${world.en})
- **画风**：${artStyle.zh}
${genderLineZh}
- **战斗类型**：${combatZh} (${combatEn})
${p.age ? `- **年龄段**：${p.age}` : ''}
${p.extraDesc ? `- **补充描述**：${p.extraDesc}` : ''}

## 画面质量与风格（最重要）
${styleQualityBlock}
- **严格 solo / 单一主体**，绝不能出现第二个角色
- 角色 **居中** 占据画面 60%~70%，必须是完整身体，绝不裁切任何部位
${isNonHumanoid
  ? `- 解剖结构：${bodyType.anatomyEn}\n- 剪影：${bodyType.silhouetteEn}\n- ⚠️ NEGATIVE：${bodyType.negativeEn}`
  : '- 画面必须包含：完整头发含发饰、完整面部、双臂全长含手掌手指、完整躯干、双腿全长、双脚鞋靴清晰可见、手持武器从柄到尖完整展示'}
- **配色遵循 631 法则**：60% 主色调（角色主题色）、30% 辅助色（互补色）、10% 强调色（高饱和点缀）
- 有精心设计的 ${world.en} 风格场景背景（不是纯色）
- 武器和装备必须与「${classZh}」职业匹配${isNonHumanoid ? '，且必须按本形态的物种语言重新设计（不是人形装备）' : ''}

## 4 个变体（每张独立美宣）
- 变体1：正面霸气站姿/微动态，展示全装备，${world.en}代表性场景背景，氛围光
- 变体2：标志性战斗爆发瞬间，技能释放，华丽能量特效，explosion particles，动态构图
- 变体3：3/4侧面仰视角，冷酷蓄力/回眸，武器细节特写，逆光剪影效果
- 变体4：全力冲刺攻击/跳斩，速度线、冲击波、碎片飞溅，极致力量感

## 输出格式
直接输出 4 段英文 prompt，用 ---VAR--- 分隔。
每段必须以这个质量前缀开头（照搬不改）：
${stylePrefix}

然后紧接角色描述（格式）：
${soloDescriptor}, ${fullBodyClause}, comfortable margin around all sides, ${subjectEn}, color palette following 631 ratio (60% dominant, 30% secondary, 10% accent),

然后紧接该变体独特的动作/姿态/场景/特效描述，最后以这些渲染品质词结尾（照搬不改）：
${styleSuffix}

要求每段 prompt 总长度在 150~280 个英文单词之间，主体外观/装备描述要极其详细具体${isNonHumanoid ? '（壳色 / 眼睛形态 / 标志性装饰等，禁止使用人体描述词）' : '（发色、瞳色、体型、标志性装饰等）'}，不能笼统。
不要输出任何解释，只输出 4 段 prompt。`
  }

  private async generateCharacter(): Promise<void> {
    const p = globalState.profile
    if (!p.name && !p.charClass && !p.extraDesc) {
      this.toast('请至少填写角色名称或职业')
      return
    }
    if (this.generating) return
    this.generating = true

    const aspect = '3:4'

    this.showProgress('progress', true, '1/2 Claude 正在设计角色方案...')
    this.setGenBtnState(true)

    try {
      const systemPrompt = this.buildSystemPrompt()
      const brief = this.buildCharacterBrief()

      const chatResult = await apiPost('/__ce-api__/chat', {
        messages: [{ role: 'user', content: systemPrompt + '\n\n## 角色信息\n' + brief }],
        maxTokens: 2000,
      })

      let imagePrompt: string
      if (chatResult.success && chatResult.text) {
        const fullText = chatResult.text.trim()
        const sepIdx = fullText.indexOf('---PROMPT---')

        if (sepIdx >= 0) {
          const analysis = fullText.substring(0, sepIdx).trim()
          imagePrompt = fullText.substring(sepIdx + 12).trim()
          this.showDesignAnalysis(analysis)
        } else {
          imagePrompt = fullText
        }
      } else {
        this.toast('Claude 设计失败: ' + (chatResult.error || '未知错误'))
        return
      }

      this.showProgress('progress', true, '2/2 正在绘制角色设计图...')

      const imgResult = await apiPost('/__ce-api__/generate-image', {
        prompt: imagePrompt,
        aspectRatio: aspect,
        model: apiModelIdForImageModel(globalState.getImageModel()),
      })

      if (imgResult.success && imgResult.imageBase64) {
        const dataUrl = `data:${imgResult.mimeType || 'image/png'};base64,${imgResult.imageBase64}`
        saveSelectedConcept(dataUrl)
        globalState.setCharacterImage(dataUrl)
        this.showPreview(dataUrl)
        this.addToHistory(dataUrl)
        this.updateStatus()
        this.toast('✅ 角色设定图生成成功')
      } else {
        this.toast('绘图失败: ' + (imgResult.error || imgResult.text || '未知错误'))
      }
    } catch (e: any) {
      this.toast('请求失败: ' + e.message)
    } finally {
      this.generating = false
      this.showProgress('progress', false)
      this.setGenBtnState(false)
    }
  }

  /**
   * 「补全设定」入口：用户上传任意尺寸/规格的图（头像、草图、片段、比例奇怪均可），
   * 系统 **把这张图本身当作角色设计的唯一事实来源**，只做版式扩展与缺失部分推断。
   *
   * 设计原则（与 generateFinalSheet 的关键区别）：
   *   - **不读** profile 的 职业 / 世界观 / 性别 / 战斗 / 年龄 / 画风 / 形态 / 补充描述
   *     —— 这些属性必须从图本身推断，否则会强行把图扭成 profile 的样子
   *   - **只读** profile.name 作为左上角标签（用户指定）
   *   - 不走 Claude 分析阶段（Claude 看不到图，没法真正理解参考；profile 都剥了也没输入）
   *   - 直接一次性把英文 layout prompt + 图交给 image-gen 模型
   */
  private async generateSheetFromUpload(): Promise<void> {
    if (!this.completeRefImage) { this.toast('请先上传参考图'); return }
    if (this.generating) return
    this.generating = true

    this.showProgress('progress-complete', true, '1/1 Gemini 正在补全为完整设定图...')
    this.setGenBtnState(true)

    try {
      const charName = (globalState.profile.name || '').trim()
      const nameLabel = charName
        ? `the character name "${charName}"`
        : 'a stylised character name inferred from the reference'

      const resized = await compressForUpload(this.completeRefImage, 400)
      const base64 = resized.replace(/^data:[^;]+;base64,/, '')
      console.log(`[Complete] compressed ref image: ${Math.round(base64.length / 1024)}KB`)

      // 这段 inline prompt 90% 是自然语言，两端模型都能吃；只有两行带
      // booru 权重语法 `(xxx:1.4)`—— gpt-image-2 会把括号当字面文本处理
      // 或忽略，所以按全局模型选一下渲染规则段。
      const model = globalState.getImageModel()
      const renderingRules = model === 'gpt-image-2'
        ? `RENDERING RULES:\n` +
          `- Solid light grey background #e6e6e6, frameless layout.\n` +
          `- Use black English labels connected by thin lines to identify each area of the sheet.\n` +
          `- Exactly one character in the whole sheet (no second character in any panel). No watermark, no UI chrome, no text beyond the sheet labels.`
        : `RENDERING RULES:\n` +
          `- Light grey background #e6e6e6, frameless layout.\n` +
          `- (Black English labels with connecting lines:1.4) identifying each area of the sheet.\n` +
          `- (only one character:1.5), no second character, no watermark, no UI chrome, no text beyond the sheet labels.`

      const prompt =
        `CRITICAL — REFERENCE COMPLETION TASK (THE IMAGE IS THE DESIGN SPEC):\n\n` +
        `The attached image is the ONLY source of truth for the character's appearance.\n` +
        `It may be a portrait crop, a rough sketch, an icon, a fragment, or have an odd aspect ratio — ` +
        `it is NOT a finished character design sheet yet.\n\n` +

        `YOUR JOB — READ CAREFULLY:\n` +
        `1. TREAT THIS REFERENCE AS CANONICAL. Preserve EVERY identifiable visual feature EXACTLY: ` +
        `face / hair / hairstyle / eye shape and color / skin or shell or fur / outfit silhouette and colors / ` +
        `signature accessories / rendering style / line weight / palette.\n` +
        `2. DO NOT INJECT ANY PRIOR ASSUMPTION. You MUST infer the character's gender, class, body type, ` +
        `world setting, and art style SOLELY from this image. Do NOT force DNF, LOL splash, anime, pixel, ` +
        `chibi, or any other style unless the reference itself is already in that style.\n` +
        `3. If the reference is anime → output stays anime. If it is a sketch → clean it up into a finished ` +
        `illustration in the SAME visual language. If it is pixel → keep pixel rendering. If it is realistic → ` +
        `keep realistic. Match the reference's rendering philosophy.\n` +
        `4. EXPAND the partial reference into a COMPLETE 3:4 character design sheet with this layout:\n` +
        `   • Top-Left: ${nameLabel} in stylish font, plus a cinematic battle splash of the SAME character in an action moment.\n` +
        `   • Center Main: full-body view (top to bottom, every limb / appendage visible) in a confident neutral pose. ` +
        `If the reference shows only a head or bust, INFER the rest of the body in a way consistent with the visible silhouette, ` +
        `outfit, and implied class. Do not fabricate contradictions.\n` +
        `   • Bottom-Left: equipment exploded view — fully rendered colored objects matching the ones in the reference, ` +
        `no line-art, no wireframe sketches.\n` +
        `   • Bottom-Left Edge: horizontal color palette strip derived from the reference colors.\n` +
        `   • Top-Right: signature skill cinematic action by the same character.\n` +
        `   • Mid-Right: inventory grid of themed key items / accessories implied by the reference.\n` +
        `   • Bottom-Right: side view + back view of the same character.\n` +
        `5. If the reference is low-res, upscale the INTERPRETATION cleanly — do NOT copy pixelation or compression artifacts.\n` +
        `6. If the reference aspect ratio differs from 3:4, REFRAME the character into a proper 3:4 sheet layout ` +
        `with comfortable margins around the body.\n\n` +

        renderingRules

      const imgResult = await apiPost('/__ce-api__/generate-image', {
        prompt,
        inputImageBase64: base64,
        aspectRatio: '3:4',
        model: apiModelIdForImageModel(globalState.getImageModel()),
      })

      if (imgResult.success && imgResult.imageBase64) {
        const dataUrl = `data:${imgResult.mimeType || 'image/png'};base64,${imgResult.imageBase64}`
        // 把原始上传图也保存为 selected concept，后续如果进 pixel 管线可作为参考
        if (this.completeRefImage) saveSelectedConcept(this.completeRefImage)
        globalState.setCharacterImage(dataUrl)
        this.generating = false
        this.showProgress('progress-complete', false)
        this.setGenBtnState(false)
        this.phase = 'final'
        this.refreshCenter()
        this.refreshLeftActions()
        this.addToHistory(dataUrl)
        this.updateStatus()
        this.toast('✅ 已基于参考图补全为完整设定')
      } else {
        this.toast('补全失败: ' + (imgResult.error || imgResult.text || '未知错误'))
      }
    } catch (e: any) {
      this.toast('请求失败: ' + e.message)
    } finally {
      this.generating = false
      this.showProgress('progress-complete', false)
      this.setGenBtnState(false)
    }
  }

  private async generateFromImage(): Promise<void> {
    if (!this.refImageData) { this.toast('请先上传参考图'); return }
    if (this.generating) return
    this.generating = true

    this.showProgress('progress-img', true, '正在风格转换...')
    this.setGenBtnState(true)

    try {
      const p = globalState.profile
      const charName = p.name || 'Character'
      const genderEn = p.gender === 'female' ? 'female' : 'male'
      const combatEn = p.combatType === 'ranged' ? 'ranged' : 'melee'

      const artStyle = this.getArtStyleInfo()
      const styleHint = artStyle.keywords
        ? `Style: ${artStyle.en}, `
        : `Style: Korean 2D RPG like DNF, 4~5 head ratio, stylized realistic, NOT chibi, badass cool. `

      const rawPrompt =
        `(masterpiece:1.4), (best quality), (character design sheet:1.5), ` +
        `Transform this image into a 2D action game character. ` +
        styleHint +
        `${genderEn} ${combatEn} fighter${p.charClass ? `, class: ${p.charClass}` : ''}. ` +
        `(Top-Left): Name "${charName}" with epic battle art. ` +
        `(Full body from head to toe:1.6), detailed equipment, clean lines. ` +
        `Light grey background #e6e6e6, frameless, black English labels.`
      const prompt = adaptPromptForImageModel(rawPrompt, globalState.getImageModel())

      const base64 = this.refImageData.replace(/^data:[^;]+;base64,/, '')

      const result = await apiPost('/__ce-api__/generate-image', {
        prompt,
        inputImageBase64: base64,
        aspectRatio: '3:4',
        model: apiModelIdForImageModel(globalState.getImageModel()),
      })

      if (result.success && result.imageBase64) {
        const dataUrl = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`
        if (this.refImageData) saveSelectedConcept(this.refImageData)
        globalState.setCharacterImage(dataUrl)
        this.showPreview(dataUrl)
        this.addToHistory(dataUrl)
        this.updateStatus()
        this.toast('✅ 风格转换成功')
      } else {
        this.toast('转换失败: ' + (result.error || '未知错误'))
      }
    } catch (e: any) {
      this.toast('请求失败: ' + e.message)
    } finally {
      this.generating = false
      this.showProgress('progress-img', false)
      this.setGenBtnState(false)
    }
  }

  // ── Two-Stage Generation ──────────────────────────────────────

  private async generateConcepts(): Promise<void> {
    const p = globalState.profile
    if (!p.name && !p.charClass && !p.extraDesc && p.characterRole !== 'monster' && p.characterRole !== 'vehicle') {
      this.toast('请至少填写角色名称或职业')
      return
    }
    if (p.characterRole === 'monster' && !p.monsterCategory) {
      this.toast('请先选择怪物主分类')
      return
    }
    if (p.characterRole === 'vehicle' && !p.vehicleCategory) {
      this.toast('请先选择载具大类')
      return
    }
    if (p.characterRole === 'vehicle' && !p.vehicleSubtype) {
      this.toast('请先选择载具子类型')
      return
    }
    if (this.generating) return
    this.generating = true
    const isNpc = p.characterRole === 'npc'
    const isMonster = p.characterRole === 'monster'
    const isVehicle = p.characterRole === 'vehicle'
    const variantCount = conceptVariantCount(p.characterRole)
    const designTargetLabel = isNpc
      ? '路人参考稿'
      : isMonster
        ? '4 种怪物变体'
        : isVehicle
          ? '载具设计图'
          : '4 种角色变体'
    this.showProgress('progress', true, `1/2 Claude 正在设计 ${designTargetLabel}...`)
    this.setGenBtnState(true)

    try {
      const sysPrompt = this.buildConceptSystemPrompt()
      const brief = this.buildCharacterBrief()

      const chatResult = await apiPost('/__ce-api__/chat', {
        messages: [{ role: 'user', content: sysPrompt + '\n\n## 角色信息\n' + brief }],
        maxTokens: 3000,
      })

      if (!chatResult.success || !chatResult.text) {
        this.toast('Claude 设计失败: ' + (chatResult.error || '未知错误'))
        return
      }

      let variants: string[]
      if (isNpc || isVehicle) {
        // NPC / vehicle prompt 模板里就只要 1 段，不做分隔/多变体推断——直接当成一整段 prompt 用。
        variants = [chatResult.text.trim()]
      } else {
        variants = chatResult.text.split('---VAR---').map((s: string) => s.trim()).filter(Boolean)

        if (variants.length < 2) {
          variants = chatResult.text.split(/---+\s*(?:VAR(?:IANT)?)?(?:\s*\d+)?\s*---+/i)
            .map((s: string) => s.trim()).filter(Boolean)
        }
        if (variants.length < 2) {
          variants = chatResult.text.split(/\n(?=(?:LOL style|(?:\(masterpiece)))/i)
            .map((s: string) => s.trim()).filter(Boolean)
        }
        if (variants.length < 2) {
          variants = chatResult.text.split(/\n{2,}(?=\d+[\.\)]\s)/)
            .map((s: string) => s.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean)
        }
        if (variants.length < 2) {
          console.warn('[Concepts] Could not split into variants, using full text as single prompt')
          variants = [chatResult.text.trim()]
        }
      }

      const prompts = variants.slice(0, variantCount)
      this.showProgress('progress', true, `2/2 正在绘制 ${prompts.length} 张概念图...`)

      this.conceptImages = []
      this.showProgress('progress', true, `2/2 正在${prompts.length === 1 ? '' : '并行'}绘制 ${prompts.length} 张概念图...`)
      const results = await Promise.allSettled(
        prompts.map((prompt: string) =>
          apiPost('/__ce-api__/generate-image', {
            prompt,
            aspectRatio: '16:9',
            model: apiModelIdForImageModel(globalState.getImageModel()),
          })
        )
      )
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value.success && res.value.imageBase64) {
          this.conceptImages.push(`data:${res.value.mimeType || 'image/png'};base64,${res.value.imageBase64}`)
        }
      }

      if (this.conceptImages.length === 0) {
        this.toast('所有概念图生成失败，请重试')
        return
      }

      // 必须 await IDB 写完再 refreshCenter()——refreshCenter 末尾会 broadcastState
      // 把 conceptCount 广播给 center iframe,center 端靠 IDB 重读这些图。如果这里
      // 不 await,center 可能在图落盘前就去读 IDB → 读空 → 永远卡在"正在加载概念图"。
      try { await saveConceptsToIDB(this.conceptImages) } catch (e) { console.warn('[Concepts] IDB save failed:', e) }
      void globalState.uploadConceptBatch(this.conceptImages)

      this.selectedConcepts.clear()
      this.fusionDesc = ''

      if ((p.characterRole === 'npc' || p.characterRole === 'vehicle') && shouldSkipFinalSheetForNpc(p.characterRole) && this.conceptImages.length >= 1) {
        const singleImage = this.conceptImages[0]
        saveSelectedConcept(singleImage)
        globalState.setCharacterImage(singleImage)
        this.addToHistory(singleImage)
        this.phase = 'final'
        this.refreshCenter()
        this.refreshLeftActions()
        this.updateStatus()
        this.toast(p.characterRole === 'vehicle'
          ? '载具设计图已生成，可在右侧预览，下游接 wb-anim/vehicle-design 多视角切帧'
          : 'NPC 参考稿已生成，进入像素动画管线')
        return
      }

      this.phase = 'concepts'
      this.refreshCenter()
      this.refreshLeftActions()
      this.toast(`生成了 ${this.conceptImages.length} 张概念图，请挑选`)
    } catch (e: any) {
      this.toast('请求失败: ' + e.message)
    } finally {
      this.generating = false
      this.showProgress('progress', false)
      this.setGenBtnState(false)
    }
  }

  private async fuseConcepts(): Promise<void> {
    if (this.selectedConcepts.size < 2) {
      this.toast('请至少选中 2 张图进行融合')
      return
    }
    if (this.generating) return
    this.generating = true
    this.showProgress('progress', true, '1/2 分析选中概念图...')
    this.setGenBtnState(true)

    try {
      const p = globalState.profile
      const world = this.getWorldInfo()
      const classEn = CLASS_EN[p.charClass] || p.charClass || 'Warrior'
      const genderEn = p.gender === 'female' ? 'female' : 'male'
      const indices = [...this.selectedConcepts].sort()
      const labels = 'ABCDEFGH'

      let userDesc = this.fusionDesc.trim()
      if (!userDesc) {
        userDesc = '将所有选中图的最佳视觉元素智能融合为一个统一的角色设计。'
      }

      const labelMap = indices.map((idx, li) => `图${labels[li]} = 原始 #${idx + 1}`).join(', ')

      const resizedImages = await Promise.all(
        indices.map(i => compressForUpload(this.conceptImages[i], 300))
      )

      const primaryBase64 = resizedImages[0].replace(/^data:[^;]+;base64,/, '')

      const fusionPromptRaw =
        `LOL style, game cg, (masterpiece:1.4), (best quality:1.4), (ultra detailed:1.3), 8k uhd, sharp focus, professional illustration, cinematic composition, ` +
        `solo, ${genderEn} ${classEn}, (${world.en} setting:1.3), ` +
        `Based on this reference image, create a new version that incorporates: ${userDesc} ` +
        `The character must be a single ${genderEn} ${classEn} in ${world.en} setting. ` +
        `dramatic cinematic lighting, volumetric light, rim lighting, depth of field, lens flare, particle effects, epic composition, (only one person:1.5), no text, no watermark, no UI`
      const fusionPrompt = adaptPromptForImageModel(fusionPromptRaw, globalState.getImageModel())

      if (resizedImages.length <= 2) {
        this.showProgress('progress', true, '2/2 Gemini 融合生成中...')
        const inputImages = resizedImages.map(img => ({
          base64: img.replace(/^data:[^;]+;base64,/, ''),
        }))
        const result = await apiPost('/__ce-api__/generate-image', {
          prompt: fusionPrompt,
          inputImages,
          aspectRatio: '16:9',
          model: apiModelIdForImageModel(globalState.getImageModel()),
        })

        if (result.success && result.imageBase64) {
          const dataUrl = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`
          this.conceptImages.push(dataUrl)
          saveConceptsToIDB(this.conceptImages).catch(() => {})
        void globalState.uploadConceptBatch(this.conceptImages)
          this.selectedConcepts.clear()
          this.fusionDesc = ''
          this.refreshCenter()
          this.toast('融合成功，新概念图已添加到末尾')
          return
        }
      }

      this.showProgress('progress', true, '2/2 使用主图参考融合...')
      const fallbackResult = await apiPost('/__ce-api__/generate-image', {
        prompt: fusionPrompt,
        inputImageBase64: primaryBase64,
        aspectRatio: '16:9',
        model: apiModelIdForImageModel(globalState.getImageModel()),
      })

      if (fallbackResult.success && fallbackResult.imageBase64) {
        const dataUrl = `data:${fallbackResult.mimeType || 'image/png'};base64,${fallbackResult.imageBase64}`
        this.conceptImages.push(dataUrl)
        saveConceptsToIDB(this.conceptImages).catch(() => {})
        void globalState.uploadConceptBatch(this.conceptImages)
        this.selectedConcepts.clear()
        this.fusionDesc = ''
        this.refreshCenter()
        this.toast('融合成功，新概念图已添加到末尾')
      } else {
        this.toast('融合失败: ' + (fallbackResult.error || '未知错误'))
      }
    } catch (e: any) {
      this.toast('融合失败: ' + e.message)
    } finally {
      this.generating = false
      this.showProgress('progress', false)
      this.setGenBtnState(false)
    }
  }

  private async generateFinalSheet(): Promise<void> {
    const sel = [...this.selectedConcepts]
    if (sel.length !== 1) {
      this.toast('请选中 1 张概念图作为参考')
      return
    }
    if (this.generating) return
    this.generating = true

    this.showProgress('progress', true, '1/2 正在压缩参考图...')
    this.setGenBtnState(true)

    try {
      const conceptData = this.conceptImages[sel[0]]
      saveSelectedConcept(conceptData)
      const resized = await compressForUpload(conceptData, 400)
      const base64 = resized.replace(/^data:[^;]+;base64,/, '')
      console.log(`[FinalSheet] compressed ref image: ${Math.round(base64.length / 1024)}KB`)

      this.showProgress('progress', true, '1/2 Claude 正在设计设定图方案...')

      const systemPrompt = this.buildSystemPrompt()
      const brief = this.buildCharacterBrief()

      const chatResult = await apiPost('/__ce-api__/chat', {
        messages: [{ role: 'user', content: systemPrompt + '\n\n## 角色信息\n' + brief + '\n\n注意：你将为一张已有的角色概念图扩展为完整角色设定图版式。角色外貌、装备、色彩必须与概念图保持一致。请重点关注版式布局（名字美宣、装备拆解、多视图等），生成精准的英文绘图提示词。' }],
        maxTokens: 2000,
      })

      let imagePrompt: string
      if (chatResult.success && chatResult.text) {
        const fullText = chatResult.text.trim()
        const sepIdx = fullText.indexOf('---PROMPT---')
        imagePrompt = sepIdx >= 0 ? fullText.substring(sepIdx + 12).trim() : fullText

        const analysisText = sepIdx >= 0 ? fullText.substring(0, sepIdx).trim() : ''
        if (analysisText) this.showDesignAnalysis(analysisText)
      } else {
        this.toast('Claude 设计失败: ' + (chatResult.error || '未知错误'))
        return
      }

      this.showProgress('progress', true, '2/2 正在基于概念图生成完整设定图...')

      imagePrompt = `IMPORTANT: The provided reference image is the character concept. The output character design sheet MUST depict the EXACT same character — identical face, hair, outfit, weapon, color scheme. Do NOT change the character design. \n` + imagePrompt

      const imageModel = globalState.getImageModel()
      const imgResult = await apiPost('/__ce-api__/generate-image', {
        prompt: imagePrompt,
        inputImageBase64: base64,
        aspectRatio: '3:4',
        ...(imageModel !== 'gpt-image-2' ? { imageSize: '2k' as const } : {}),
        model: apiModelIdForImageModel(imageModel),
      })

      if (imgResult.success && imgResult.imageBase64) {
        const dataUrl = `data:${imgResult.mimeType || 'image/png'};base64,${imgResult.imageBase64}`
        globalState.setCharacterImage(dataUrl)
        this.generating = false
        this.showProgress('progress', false)
        this.setGenBtnState(false)
        this.phase = 'final'
        this.refreshCenter()
        this.refreshLeftActions()
        this.addToHistory(dataUrl)
        this.updateStatus()
        this.toast('角色设定图生成成功')
      } else {
        this.toast('绘图失败: ' + (imgResult.error || imgResult.text || '未知错误'))
      }
    } catch (e: any) {
      this.toast('请求失败: ' + e.message)
    } finally {
      this.generating = false
      this.showProgress('progress', false)
      this.setGenBtnState(false)
    }
  }

  /**
   * 把当前选中的那张概念图直接当成"最终设定图"落地——跳过 Claude 布版 + Gemini
   * 生成 sheet 的第二步。用于怪物 / NPC 这类不需要完整设定版式（没有装备槽、不
   * 需要正反侧背分解）的角色：一张干净的立绘已经足够交给像素管线。
   */
  private acceptConceptAsFinal(): void {
    const sel = [...this.selectedConcepts]
    if (sel.length !== 1) {
      this.toast('请选中 1 张概念图')
      return
    }
    const conceptData = this.conceptImages[sel[0]]
    if (!conceptData) return
    saveSelectedConcept(conceptData)
    globalState.setCharacterImage(conceptData)
    this.addToHistory(conceptData).catch(() => {})
    this.phase = 'final'
    this.refreshCenter()
    this.refreshLeftActions()
    this.updateStatus()
    const role = globalState.profile?.characterRole
    this.toast(role === 'monster' ? '怪物设定图已确认，进入像素动画管线' : '已确认，进入像素动画管线')
  }

  private goBackPhase(): void {
    if (this.phase === 'detail') {
      this.phase = 'final'
    } else if (this.phase === 'final') {
      this.phase = 'concepts'
    } else if (this.phase === 'concepts') {
      this.phase = 'form'
      this.conceptImages = []
      this.selectedConcepts.clear()
    }
    this.refreshCenter()
    this.refreshLeftActions()
  }

  // ── Detail Phase (Part Modification) ─────────────────────────

  private enterDetailPhase(): void {
    if (!globalState.get().characterImage) return
    this.detailVersion = this.detailVersion || 1
    this.phase = 'detail'
    this.rebuildLeftForDetail()
    this.refreshCenter()
  }

  private rebuildLeftForDetail(): void {
    if (!this.leftEl) return

    const formPanel = this.leftEl.querySelector('.cd-panel') as HTMLElement
    if (!formPanel) return

    let detailPanel = this.leftEl.querySelector('[data-cd="detail-panel"]') as HTMLElement
    if (detailPanel) {
      detailPanel.style.display = ''
      detailPanel.innerHTML = ''
    } else {
      detailPanel = document.createElement('div')
      detailPanel.className = 'cd-detail-phase-panel'
      detailPanel.dataset.cd = 'detail-panel'
      formPanel.parentElement!.appendChild(detailPanel)
    }

    formPanel.style.display = 'none'

    let html = `
      <div class="cd-header">
        <span class="cd-header-icon">✏️</span>
        <span class="cd-header-title">局部修改</span>
      </div>
      <div class="cd-detail-parts-list">`

    for (const part of DETAIL_PARTS) {
      const active = this.detailCurrentPart === part.code
      const generated = !!this.detailParts[part.code]
      const cls = ['cd-detail-part-row', active ? 'active' : '', generated ? 'generated' : ''].filter(Boolean).join(' ')
      html += `<div class="${cls}" data-detail-part="${part.code}">
        <span class="cd-detail-part-icon">${part.icon}</span>
        <div class="cd-detail-part-info">
          <div class="cd-detail-part-name">${part.name}</div>
          <div class="cd-detail-part-pos">${part.position}</div>
        </div>
        <div class="cd-detail-part-dot"></div>
      </div>`
    }

    html += `</div>
      <div class="cd-detail-parts-count">已修改: ${Object.keys(this.detailParts).length} / ${DETAIL_PARTS.length}</div>
      <div class="cd-detail-actions">
        <button class="cd-btn" data-action="detail-back-final">← 返回设定图</button>
        <button class="cd-btn cd-btn-accent" data-action="detail-done">✅ 修改完成 → 生成动画</button>
      </div>`

    detailPanel.innerHTML = html
    this.wireDetailLeftEvents(detailPanel)
  }

  private wireDetailLeftEvents(panel: HTMLElement): void {
    panel.querySelectorAll('[data-detail-part]').forEach(el => {
      el.addEventListener('click', () => {
        const code = (el as HTMLElement).dataset.detailPart!
        this.detailCurrentPart = code
        panel.querySelectorAll('.cd-detail-part-row').forEach(r =>
          r.classList.toggle('active', (r as HTMLElement).dataset.detailPart === code)
        )
        this.refreshCenter()
      })
    })

    panel.querySelector('[data-action="detail-back-final"]')?.addEventListener('click', () => {
      this.exitDetailPhase()
      this.phase = 'final'
      this.refreshCenter()
      this.refreshLeftActions()
    })

    panel.querySelector('[data-action="detail-done"]')?.addEventListener('click', () => {
      this.exitDetailPhase()
      this.phase = 'final'
      this.refreshCenter()
      this.refreshLeftActions()
      // 修改完细节后直接进动画工作台——和「生成动画」主按钮一致，不再弹 picker。
      void this.navigateToAnim()
    })
  }

  private exitDetailPhase(): void {
    if (!this.leftEl) return
    const formPanel = this.leftEl.querySelector('.cd-panel') as HTMLElement
    const detailPanel = this.leftEl.querySelector('[data-cd="detail-panel"]') as HTMLElement
    if (formPanel) formPanel.style.display = ''
    if (detailPanel) detailPanel.style.display = 'none'
  }

  private renderDetailPhaseCenter(): void {
    if (!this.centerEl) return

    const charImg = globalState.get().characterImage
    if (!charImg) { this.phase = 'final'; this.refreshCenter(); return }

    let html = `<div class="cd-center-stack">${this.roleTabBarHTML()}<div class="cd-preview-wrap cd-detail-wrap">`

    html += `<div class="cd-detail-preview-area">
      <div class="cd-preview-title">角色立绘 <span class="cd-detail-ver">v${this.detailVersion}</span></div>
      <div class="cd-preview" data-cd="preview">
        <img src="${charImg}" class="cd-preview-img">
      </div>`

    if (this.detailHistory.length > 0) {
      html += `<div class="cd-detail-history-strip">`
      this.detailHistory.forEach((h, i) => {
        const isActive = charImg === h.dataUrl ? 'active' : ''
        html += `<div class="cd-detail-history-thumb ${isActive}" data-detail-hist="${i}" title="v${h.version} — ${h.partName}: ${h.description}">
          <img src="${h.dataUrl}" alt="v${h.version}">
          <span class="cd-detail-hist-badge">${h.partIcon}</span>
          <span class="cd-detail-hist-ver">v${h.version}</span>
        </div>`
      })
      html += `</div>`
    }

    html += `</div>`

    if (this.detailCurrentPart) {
      html += this.buildDetailPartEditor(this.detailCurrentPart)
    } else {
      html += `<div class="cd-detail-empty-hint">
        <div style="font-size:36px;opacity:0.3;margin-bottom:8px;">👈</div>
        <div style="font-size:13px;font-weight:500;">从左侧选择要修改的部件</div>
        <div style="font-size:11px;color:var(--text-secondary);">基于当前立绘，通过图生图修改指定部件</div>
      </div>`
    }

    html += `</div></div>`
    this.centerEl.innerHTML = html
    this.wireDetailCenterEvents()
    // Wrap the main立绘 preview with the hide/show overlay; the history
    // thumbnail strip stays plain so the user can still click through
    // versions while a take is recording.
    applyHideableTo(this.centerEl, 'img.cd-preview-img', {
      idFrom: () => 'character-design:detail',
    })
  }

  private buildDetailPartEditor(code: string): string {
    const part = DETAIL_PARTS.find(p => p.code === code)
    if (!part) return ''

    const existing = this.detailParts[code]
    const desc = existing?.description ?? ''

    let placeholder = '描述这个部件你想要的样子...'
    if (code === 'weapon') placeholder = '描述想在手中生成的武器道具...'
    if (code === 'outfit') placeholder = '描述想要替换的服装...'
    if (code === 'pose') placeholder = '描述想要的动作姿态...'

    let html = `<div class="cd-detail-editor">
      <div class="cd-detail-editor-header">
        <span style="font-size:20px;">${part.icon}</span>
        <span style="font-size:14px;font-weight:600;">${part.name}</span>
        <span style="font-size:11px;color:var(--text-secondary);">${part.position}</span>
      </div>
      <div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">描述你想要的造型</div>
      <textarea class="cd-textarea" data-detail-desc rows="3" placeholder="${placeholder}">${esc(desc)}</textarea>
      <div class="cd-detail-hints">`

    for (const h of part.hints) {
      html += `<span class="cd-detail-hint-tag">${h}</span>`
    }

    html += `</div>
      <div class="cd-detail-prompt-preview">
        <div class="cd-detail-prompt-header">
          📋 图生图提示词预览
          <button class="cd-btn" style="padding:2px 8px;font-size:10px;width:auto;" data-action="copy-detail-prompt">复制</button>
        </div>
        <div class="cd-detail-prompt-text" data-detail-prompt-text style="color:var(--text-secondary);">${desc ? esc(buildDetailPrompt(code, desc)) : '输入描述后实时预览提示词...'}</div>
      </div>
      <div style="margin-top:8px;">
        <button class="cd-btn cd-btn-primary" data-action="apply-detail-mod" ${desc ? '' : 'disabled'}>⚡ 应用修改</button>
      </div>
      <div class="cd-progress" data-cd="detail-progress" style="display:none">
        <div class="cd-progress-bar"><div class="cd-progress-fill"></div></div>
        <div class="cd-progress-text">修改中...</div>
      </div>
    </div>`

    return html
  }

  private wireDetailCenterEvents(): void {
    if (!this.centerEl) return

    this.centerEl.querySelectorAll('[data-detail-hist]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt((el as HTMLElement).dataset.detailHist!)
        this.revertToDetailHistory(idx)
      })
    })

    const textarea = this.centerEl.querySelector('[data-detail-desc]') as HTMLTextAreaElement
    const promptPreview = this.centerEl.querySelector('[data-detail-prompt-text]')
    const applyBtn = this.centerEl.querySelector('[data-action="apply-detail-mod"]') as HTMLButtonElement

    textarea?.addEventListener('input', () => {
      const desc = textarea.value.trim()
      if (promptPreview && this.detailCurrentPart) {
        promptPreview.textContent = desc
          ? buildDetailPrompt(this.detailCurrentPart, desc)
          : '输入描述后实时预览提示词...'
      }
      if (applyBtn) applyBtn.disabled = !desc
    })

    this.centerEl.querySelectorAll('.cd-detail-hint-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        if (!textarea) return
        const hint = tag.textContent ?? ''
        textarea.value = textarea.value ? textarea.value + '、' + hint : hint
        textarea.dispatchEvent(new Event('input'))
      })
    })

    applyBtn?.addEventListener('click', () => {
      const desc = textarea?.value.trim()
      if (!desc || !this.detailCurrentPart) return
      this.applyDetailMod(this.detailCurrentPart, desc)
    })

    this.centerEl.querySelector('[data-action="copy-detail-prompt"]')?.addEventListener('click', () => {
      const text = promptPreview?.textContent ?? ''
      navigator.clipboard.writeText(text).then(
        () => this.toast('已复制到剪贴板'),
        () => this.toast('复制失败'),
      )
    })
  }

  private async applyDetailMod(code: string, desc: string): Promise<void> {
    const charImg = globalState.get().characterImage
    if (!charImg) return

    const part = DETAIL_PARTS.find(p => p.code === code)
    if (!part) return

    if (this.generating) return
    this.generating = true

    this.showProgress('detail-progress', true, `正在修改「${part.name}」...`)
    const applyBtn = this.centerEl?.querySelector('[data-action="apply-detail-mod"]') as HTMLButtonElement
    if (applyBtn) applyBtn.disabled = true

    try {
      const rawPrompt = buildDetailPrompt(code, desc)
      const prompt = adaptPromptForImageModel(rawPrompt, globalState.getImageModel())

      const compressed = await compressForUpload(charImg, 400)
      const base64 = compressed.replace(/^data:[^;]+;base64,/, '')

      const result = await apiPost('/__ce-api__/generate-image', {
        prompt,
        inputImageBase64: base64,
        aspectRatio: '3:4',
        model: apiModelIdForImageModel(globalState.getImageModel()),
      })

      if (result.success && result.imageBase64) {
        const dataUrl = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`
        this.detailVersion++

        const entry: DetailHistoryEntry = {
          version: this.detailVersion,
          dataUrl,
          partCode: code,
          partIcon: part.icon,
          partName: part.name,
          description: desc,
        }
        this.detailHistory.push(entry)
        if (this.detailHistory.length > 8) this.detailHistory.shift()

        this.detailParts[code] = {
          code,
          description: desc,
          modifiedAt: this.detailVersion,
        }

        globalState.setCharacterImage(dataUrl)
        this.addToHistory(dataUrl)
        this.toast(`「${part.name}」修改成功！v${this.detailVersion}`)
      } else {
        this.toast('修改失败: ' + (result.error || result.text || '未知错误'))
      }
    } catch (e: any) {
      this.toast('请求失败: ' + e.message)
    } finally {
      this.generating = false
      this.showProgress('detail-progress', false)
    }

    this.rebuildLeftForDetail()
    this.refreshCenter()
  }

  private revertToDetailHistory(idx: number): void {
    const entry = this.detailHistory[idx]
    if (!entry) return
    globalState.setCharacterImage(entry.dataUrl)
    this.detailVersion = entry.version
    this.refreshCenter()
    this.toast(`已回退到 v${entry.version}（${entry.partName}）`)
  }

  // ── UI Helpers ────────────────────────────────────────────────

  private showDesignAnalysis(analysis: string): void {
    const preview = this.q('[data-cd="preview"]') as HTMLElement
    if (!preview) return
    const lines = analysis.split('\n').filter(l => l.trim())
    const html = lines.map(l => {
      const text = l.replace(/^[·\-*]\s*/, '')
      const [label, ...rest] = text.split('：')
      if (rest.length > 0) {
        return `<div class="cd-analysis-row"><span class="cd-analysis-label">${label}</span><span class="cd-analysis-val">${rest.join('：')}</span></div>`
      }
      return `<div class="cd-analysis-row"><span class="cd-analysis-val">${text}</span></div>`
    }).join('')

    preview.innerHTML = `
      <div class="cd-analysis">
        <div class="cd-analysis-title">🎯 设计策略</div>
        ${html}
        <div class="cd-analysis-hint">Gemini 正在根据此方案绘制...</div>
      </div>
    `
  }

  private applyProgressDom(id: string, show: boolean, text?: string): void {
    const el = this.q(`[data-cd="${id}"]`) as HTMLElement
    if (!el) return
    el.style.display = show ? '' : 'none'
    const label = text ?? this.progressText
    if (label) {
      const t = el.querySelector('.cd-progress-text')
      if (t) t.textContent = label
    }
  }

  private patchCenterGeneratingOverlay(text: string): void {
    if (!this.centerEl) return
    const preview = this.centerEl.querySelector('[data-cd="preview"]') as HTMLElement | null
    if (!preview) return
    if (preview.querySelector('.cd-generating-overlay')) return
    if (preview.querySelector('img.cd-preview-img, .cd-concept-card')) return
    preview.innerHTML = `
      <div class="cd-preview-empty cd-generating-overlay">
        <div class="cd-preview-empty-icon">⏳</div>
        <div>${esc(text)}</div>
        <div class="cd-preview-tip">生成进行中，切换模块后已恢复进度显示</div>
      </div>`
  }

  private showProgress(id: string, show: boolean, text?: string): void {
    if (show) {
      this.progressId = id
      this.progressText = text ?? this.progressText ?? '生成中...'
      this.patchCenterGeneratingOverlay(this.progressText)
    } else {
      this.progressId = null
      this.progressText = null
    }
    this.applyProgressDom(id, show, text)
    this.persistGenerationSnapshot()
    this.broadcastState()
  }

  private setGenBtnState(disabled: boolean): void {
    this.leftEl?.querySelectorAll('.cd-btn-gen').forEach(btn => (btn as HTMLButtonElement).disabled = disabled)

    const centerActions = [
      'gen-final', 'regen-final', 'fuse-selected', 'regen-concepts',
      'concept-edit-parts', 'back-concepts',
    ]
    for (const action of centerActions) {
      const btn = this.centerEl?.querySelector(`[data-action="${action}"]`) as HTMLButtonElement | null
      if (!btn) continue
      if (disabled) {
        if (!btn.dataset.origText) btn.dataset.origText = btn.textContent || ''
        btn.disabled = true
        if (action === 'gen-final' || action === 'regen-final' || action === 'fuse-selected') {
          btn.textContent = '⏳ 正在生成...'
        }
      } else {
        btn.disabled = false
        if (btn.dataset.origText) {
          btn.textContent = btn.dataset.origText
          delete btn.dataset.origText
        }
      }
    }
  }

  private showPreview(dataUrl: string): void {
    this.mountFinalPreviewImage(dataUrl)
  }

  private showEmptyPreview(): void {
    const preview = this.q('[data-cd="preview"]') as HTMLElement
    if (preview) {
      preview.innerHTML = `
        <div class="cd-preview-empty">
          <div class="cd-preview-empty-icon">🖼️</div>
          <div>填写左侧角色信息，点击「一键生成」</div>
          <div class="cd-preview-tip">Claude 设计 · Gemini 绘图</div>
        </div>
      `
    }
    const actions = this.q('[data-cd="actions"]') as HTMLElement
    if (actions) actions.style.display = 'none'
  }

  private syncFromState(): void {
    if (this.phase === 'detail') {
      this.refreshLeftActions()
    } else if (this.phase !== 'form') {
      this.refreshLeftActions()
    } else if (globalState.get().characterImage) {
      this.phase = 'final'
      this.refreshCenter()
      this.refreshLeftActions()
    }
  }

  private updateStatus(): void {
    const p = globalState.profile
    const el = this.q('[data-cd="status-summary"]')
    if (!el) return
    const parts: string[] = []
    if (p.name) parts.push(p.name)
    if (p.characterRole === 'vehicle') {
      const cat = getVehicleCategory(p.vehicleCategory)
      const sub = getVehicleSubtype(p.vehicleCategory, p.vehicleSubtype)
      parts.push('🚗 载具')
      if (cat) parts.push(cat.label)
      if (sub) parts.push(isCustomVehicleSubtype(sub) ? (p.vehicleSubtypeCustom?.trim() || '自定义') : sub.label)
    } else {
      parts.push(p.gender === 'female' ? '♀' : '♂')
      if (p.characterRole === 'npc') {
        parts.push('🚶 NPC')
        if (p.npcOccupation) parts.push(p.npcOccupation)
      } else if (p.characterRole === 'monster') {
        parts.push('👾 怪物')
        if (p.monsterCategory) parts.push(p.monsterCategory)
        if (p.monsterRace) parts.push(p.monsterRace)
      } else {
        if (p.charClass) parts.push(p.charClass)
        parts.push(p.combatType === 'ranged' ? '远程' : '近战')
      }
    }
    if (p.worldSetting) {
      const w = WORLD_OPTIONS.find(o => o.id === p.worldSetting)
      parts.push(w ? w.label : p.worldSetting)
    }
    if (p.artStyle) {
      const s = ART_STYLE_OPTIONS.find(o => o.id === p.artStyle)
      parts.push(s ? s.label : p.artStyle === 'custom' ? p.artStyleCustom : p.artStyle)
    }
    if (globalState.hasCharacter) parts.push('✅ 已生成')
    el.textContent = parts.join(' · ')
  }

  private toast(msg: string): void {
    let el = document.querySelector('.cd-toast') as HTMLElement
    if (!el) {
      el = document.createElement('div')
      el.className = 'cd-toast'
      document.body.appendChild(el)
    }
    el.textContent = msg
    el.classList.add('show')
    setTimeout(() => el.classList.remove('show'), 3000)
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function injectCSS(): void {
  const existing = document.getElementById(CSS_ID)
  if (existing) existing.remove()
  const s = document.createElement('style')
  s.id = CSS_ID
  s.textContent = DESIGN_CSS
  document.head.appendChild(s)
}

const DESIGN_CSS = `
.cd-panel {
  display: flex; flex-direction: column; height: 100%;
  font-family: system-ui, -apple-system, sans-serif;
}
.cd-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.07);
}
.cd-header-icon { font-size: 20px; }
.cd-header-title { font-size: 15px; font-weight: 700; color: #d4ff48; }
.cd-header-pill {
  margin-left: auto;
  padding: 3px 8px;
  border: 1px solid rgba(212,255,72,0.28);
  border-radius: 999px;
  background: rgba(212,255,72,0.08);
  color: #d4ff48;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.cd-form { padding: 10px 10px 8px; display: flex; flex-direction: column; gap: 8px; }
.cd-workflow-card {
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px;
  background: rgba(255,255,255,0.018);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.16);
  overflow: hidden;
}
.cd-workflow-card[open] {
  border-color: rgba(212,255,72,0.22);
  background: rgba(212,255,72,0.025);
}
.cd-workflow-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 4px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
.cd-workflow-head::-webkit-details-marker { display: none; }
.cd-workflow-title {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.03em;
}
.cd-step {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  color: #071007;
  font-size: 10px;
  font-weight: 900;
  box-shadow: 0 0 0 1px rgba(212,255,72,0.34), 0 0 10px rgba(212,255,72,0.12);
}
.cd-workflow-caret {
  margin-left: auto;
  color: rgba(212,255,72,0.72);
  font-size: 13px;
  transform: rotate(-90deg);
  transition: transform 0.15s ease, color 0.15s ease;
}
.cd-workflow-card[open] .cd-workflow-caret { transform: rotate(0); color: var(--accent); }
.cd-workflow-summary {
  padding: 0 10px 9px 35px;
  color: rgba(255,255,255,0.48);
  font-size: 11px;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cd-workflow-card[open] .cd-workflow-summary { color: rgba(212,255,72,0.68); }
.cd-workflow-body {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 0 10px 11px;
}
.cd-workflow-card:not([open]) .cd-workflow-body { display: none; }
.cd-field { display: flex; flex-direction: column; gap: 4px; }
.cd-field-row { display: flex; gap: 10px; }
.cd-field-half { flex: 1; min-width: 0; }
.cd-label {
  font-size: 11px; color: var(--text-secondary); text-transform: uppercase;
  letter-spacing: 0.3px;
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.cd-optional { text-transform: none; opacity: 0.5; letter-spacing: 0; }

/* breadcrumb 紧贴 label 右侧,让"主分类 › 次分类"的当前路径可见,
   减少用户在 drilldown 中迷路 */
.cd-crumb {
  margin-left: auto; padding: 1px 7px; border-radius: 9999px;
  background: var(--accent-dim, rgba(212,255,72,0.12));
  color: var(--accent); font-size: 10px; font-weight: 600;
  text-transform: none; letter-spacing: 0;
  display: inline-flex; align-items: center; gap: 4px;
}
.cd-crumb-sep { opacity: 0.5; font-weight: 400; }

/* ── 角色定位 4-tab 顶部条 ─────────────────────────────────────
 * 渲染在 centerEl 顶部(roleTabBarHTML),与 wb-anim 顶部的「像素角色 /
 * 载具设计 / Spine 骨骼 / 视频角色」同谱:深底 + lime brand active 态。
 * 4 个 tab 等宽铺满内容区顶部一行,在 form / concepts / final / detail
 * 4 个 phase 都保持可见,无论用户在生成流程的哪一步都能切大类。
 *
 * .cd-center-stack 是 wrapper:host 给的 .editor-center-overlay.active 是
 * row flex 居中,我们在里面塞一个 column flex 100% wide 容器,把 tab bar
 * 顶上 + preview-wrap 撑剩余高度,既保持 host 的居中策略又能上下分层。
 */
.cd-center-stack {
  display: flex; flex-direction: column;
  width: 100%; height: 100%;
  min-height: 0;
}
.cd-center-stack > .cd-preview-wrap { flex: 1; min-height: 0; }
.cd-role-tabbar {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-primary);
  flex-shrink: 0;
}
.cd-role-tab {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  padding: 8px 10px; border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: var(--text-secondary); font-size: 13px;
  font-family: inherit; cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.cd-role-tab:not(.active):hover {
  background: var(--bg-hover); color: var(--text-primary);
}
.cd-role-tab.active {
  background: var(--accent-dim, rgba(212,255,72,0.12));
  border-color: rgba(212,255,72,0.35);
  color: var(--accent); font-weight: 600;
}
.cd-role-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; line-height: 1; }
.cd-role-icon-svg { width: 16px; height: 16px; display: block; }
.cd-role-label { font-size: 13px; line-height: 1.2; }

.cd-input {
  padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-hover); color: var(--text-primary); font-size: 13px;
  font-family: inherit; outline: none; box-sizing: border-box; width: 100%;
}
.cd-input:focus { border-color: var(--accent); }
.cd-input::placeholder { color: var(--text-secondary); opacity: 0.5; }
.cd-input-sm { font-size: 11px; padding: 5px 8px; margin-top: 4px; }

.cd-select {
  padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-hover); color: var(--text-primary); font-size: 12px;
  font-family: inherit; outline: none; cursor: pointer; width: 100%;
  color-scheme: dark;
}
.cd-select option {
  background: #1f211d;
  color: #f5f7ef;
}
.cd-select option:checked {
  background: #35401b;
  color: #d4ff48;
}
.cd-select:focus { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(212,255,72,0.18); }

.cd-btn-group { display: flex; gap: 4px; flex-wrap: wrap; }
.cd-chip {
  flex: 1; padding: 6px 6px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-hover); color: var(--text-secondary); font-size: 12px;
  font-family: inherit; cursor: pointer; transition: all 0.15s; text-align: center;
  min-width: 0;
}
.cd-chip:hover { border-color: var(--accent); color: var(--text-primary); }
.cd-chip.active { background: var(--accent-dim, rgba(212,255,72,0.15)); border-color: var(--accent); color: var(--accent); font-weight: 600; }

/* 旧的 .cd-class-grid(flex-wrap)在 chip 数量多 / 文字长短不一时容易出
   现"一行 5 个 + 一行 1 个 + 一行 3 个"的乱序列。.cd-grid-auto 用
   auto-fit + minmax,所有 chip 等宽,行内整齐;窄面板自动换行,宽面板
   自动多列。 */
.cd-class-grid,
.cd-grid-auto {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
  gap: 4px;
}
.cd-chip-sm {
  padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg-hover); color: var(--text-secondary); font-size: 11px;
  font-family: inherit; cursor: pointer; transition: all 0.15s;
  text-align: center; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cd-chip-sm:hover { border-color: var(--accent); color: var(--text-primary); }
.cd-chip-sm.active { background: var(--accent-dim, rgba(212,255,72,0.15)); border-color: var(--accent); color: var(--accent); font-weight: 600; }

.cd-world-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(86px, 1fr));
  gap: 4px;
}
.cd-world-chip {
  display: inline-flex; align-items: center; justify-content: center; gap: 3px;
  padding: 5px 6px; border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg-hover); color: var(--text-secondary); font-size: 11px;
  font-family: inherit; cursor: pointer; transition: all 0.15s;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  min-width: 0;
}
.cd-world-icon { font-size: 13px; flex-shrink: 0; }
.cd-world-chip:hover { border-color: var(--accent); color: var(--text-primary); }
.cd-world-chip.active { background: var(--accent-dim, rgba(212,255,72,0.15)); border-color: var(--accent); color: var(--accent); font-weight: 600; }

.cd-section { padding: 0; }

.cd-method-row { display: flex; gap: 4px; margin-top: 4px; }
.cd-method {
  flex: 1; padding: 7px 4px; border: 1px solid var(--border); border-radius: var(--radius);
  background: transparent; color: var(--text-secondary); font-size: 11px;
  font-family: inherit; cursor: pointer; transition: all 0.15s; text-align: center;
}
.cd-method:hover { background: var(--bg-hover); color: var(--text-primary); }
.cd-method.active { background: var(--bg-active); color: var(--accent); border-color: var(--accent); }

.cd-method-body { padding: 8px 0 0; }
.cd-textarea {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-hover); color: var(--text-primary); font-family: inherit; font-size: 12px;
  resize: vertical; outline: none; box-sizing: border-box;
}
.cd-textarea::placeholder { color: var(--text-secondary); opacity: 0.5; }
.cd-textarea:focus { border-color: var(--accent); }

.cd-gen-row { display: flex; gap: 6px; align-items: center; }

.cd-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px 14px; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--bg-hover); color: var(--text-primary); font-size: 12px;
  font-family: inherit; cursor: pointer; transition: all 0.15s; width: 100%;
}
.cd-btn:hover { background: var(--bg-active); }
.cd-btn:active { transform: scale(0.98); }
.cd-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cd-btn-primary { background: var(--accent); color: #0b0c0a; border-color: var(--accent); font-weight: 600; }
.cd-btn-primary:hover { background: var(--accent-hover); }
.cd-btn-accent { background: rgba(46,204,113,0.15); border-color: rgba(46,204,113,0.4); color: var(--success); }
.cd-btn-accent:hover { background: rgba(46,204,113,0.25); border-color: rgba(46,204,113,0.6); }
.cd-btn-xl {
  padding: 14px 18px; font-size: 14px; font-weight: 800; letter-spacing: 0.4px;
  box-shadow: 0 0 0 1px rgba(46,204,113,0.35), 0 3px 14px rgba(46,204,113,0.25);
}
.cd-btn-xl:hover { transform: translateY(-1px); box-shadow: 0 0 0 1px rgba(46,204,113,0.55), 0 5px 20px rgba(46,204,113,0.4); }
.cd-btn-xl:active { transform: translateY(0); }
.cd-btn-gen { flex: 1; }

.cd-progress { margin-top: 10px; }
.cd-progress-bar { height: 3px; border-radius: 2px; background: var(--border); overflow: hidden; }
.cd-progress-fill {
  height: 100%; width: 30%; background: var(--accent); border-radius: 2px;
  animation: cd-progress-anim 1.5s ease-in-out infinite;
}
@keyframes cd-progress-anim {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
.cd-progress-text { font-size: 11px; color: var(--text-secondary); margin-top: 4px; text-align: center; }

.cd-drop {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 20px; border: 2px dashed var(--border); border-radius: var(--radius);
  color: var(--text-secondary); font-size: 12px; text-align: center;
  transition: all 0.15s; margin-bottom: 10px; min-height: 80px;
}
.cd-drop:hover, .cd-drop.dragover { border-color: var(--accent); background: var(--accent-dim, rgba(212,255,72,0.08)); }
.cd-drop-icon { font-size: 24px; margin-bottom: 4px; }
.cd-drop-sub { font-size: 10px; opacity: 0.5; }

.cd-status {
  display: flex; gap: 16px; padding: 10px 16px; margin-top: auto;
  border-top: 1px solid var(--border); font-size: 12px; color: var(--text-secondary);
}

/* Center preview */
.cd-preview-wrap {
  display: flex; flex-direction: column; width: 100%; height: 100%;
  padding: 20px 24px; box-sizing: border-box;
  font-family: system-ui, sans-serif;
  max-width: 1400px; margin: 0 auto;
  overflow-y: auto;
}
.cd-preview-wrap::-webkit-scrollbar { width: 4px; }
.cd-preview-wrap::-webkit-scrollbar-track { background: transparent; }
.cd-preview-wrap::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
.cd-preview-title {
  font-size: 14px; font-weight: 600; color: var(--text-secondary);
  margin-bottom: 12px; text-align: center; letter-spacing: 0.3px;
}
.cd-preview {
  flex: 1 1 0; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.3); border-radius: 12px; border: 1px solid var(--border);
  overflow: hidden; min-height: clamp(240px, 42vh, 680px);
  position: relative;
}
.cd-preview-img {
  width: 100%; height: 100%;
  object-fit: contain; object-position: center;
}
/* 有 3D 四视图时：设定图占主画面，四视图缩为下方参考条 */
.cd-preview-wrap:has(.cd-turnaround-grid) .cd-preview {
  min-height: clamp(300px, 52vh, 680px);
}
.cd-preview-empty { text-align: center; color: var(--text-secondary); font-size: 13px; padding: 30px; }
.cd-preview-empty-icon { font-size: 56px; margin-bottom: 16px; opacity: 0.3; }
.cd-preview-tip { font-size: 11px; opacity: 0.5; margin-top: 8px; }

.cd-preview-actions {
  display: flex; gap: 10px; margin-top: 14px;
  padding: 12px 16px; border-radius: 10px;
  background: rgba(18,18,26,0.6); backdrop-filter: blur(8px);
  border: 1px solid var(--border);
}
.cd-preview-actions .cd-btn { flex: 1; text-align: center; }

.cd-pipeline-picker {
  display: flex; flex-direction: column; gap: 12px;
  margin-top: 14px; padding: 16px;
  border-radius: 12px;
  background: rgba(18,18,26,0.75); backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  animation: cd-picker-in 0.25s ease;
}
@keyframes cd-picker-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.cd-picker-title {
  font-size: 13px; font-weight: 600; color: var(--text-secondary);
  text-align: center; letter-spacing: 1px;
}
.cd-picker-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;
}
.cd-picker-grid-3 {
  grid-template-columns: repeat(3, 1fr);
}
.cd-picker-card {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 18px 10px 14px; border-radius: 10px;
  background: rgba(255,255,255,0.04); border: 1px solid var(--border);
  cursor: pointer; transition: all 0.2s;
  color: var(--text); font-family: inherit;
}
.cd-picker-card:hover {
  background: rgba(255,255,255,0.1); border-color: var(--accent);
  transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}
.cd-picker-card:active { transform: scale(0.97); }
.cd-picker-icon { font-size: 36px; }
.cd-picker-name { font-size: 15px; font-weight: 700; color: #fff; }
.cd-picker-desc { font-size: 12px; color: rgba(255,255,255,0.65); text-align: center; line-height: 1.4; }

.cd-toast {
  position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%) translateY(20px);
  padding: 10px 24px; background: rgba(20,20,30,0.95); color: #fff; border-radius: 8px;
  font-size: 13px; z-index: 9999; opacity: 0; transition: all 0.3s; pointer-events: none;
  backdrop-filter: blur(8px); border: 1px solid var(--border);
}
.cd-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* Design analysis */
.cd-analysis {
  padding: 24px; text-align: left; width: 100%; max-width: 560px;
  margin: 0 auto;
}
.cd-analysis-title { font-size: 16px; font-weight: 700; color: var(--accent); margin-bottom: 16px; text-align: center; }
.cd-analysis-row {
  display: flex; gap: 8px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
  font-size: 13px; line-height: 1.6;
}
.cd-analysis-label { color: var(--accent); font-weight: 600; white-space: nowrap; min-width: 70px; }
.cd-analysis-val { color: var(--text-primary); }
.cd-analysis-hint {
  margin-top: 16px; padding: 10px 14px; border-radius: var(--radius);
  background: rgba(108,92,231,0.1); border: 1px solid rgba(108,92,231,0.2);
  color: var(--accent); font-size: 12px; text-align: center;
}

/* History section (left sidebar) */
.cd-history-section {
  margin-top: auto; border-top: 1px solid var(--border);
  padding: 8px 16px 4px; flex-shrink: 0;
}
.cd-history-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.cd-history-title {
  font-size: 11px; font-weight: 600; color: var(--text-secondary);
  text-transform: uppercase; letter-spacing: 0.3px;
}
.cd-history-clear {
  background: none; border: none; color: var(--text-secondary); font-size: 10px;
  cursor: pointer; padding: 2px 6px; border-radius: 4px; font-family: inherit;
}
.cd-history-clear:hover { color: var(--danger); background: rgba(231,76,60,0.1); }

.cd-history-list {
  display: flex; flex-direction: column; gap: 4px;
  max-height: 200px; overflow-y: auto;
}
.cd-history-list::-webkit-scrollbar { width: 3px; }
.cd-history-list::-webkit-scrollbar-track { background: transparent; }
.cd-history-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.cd-history-card {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 6px; border: 1px solid transparent; border-radius: var(--radius);
  background: transparent; cursor: pointer;
  transition: background 0.15s, border-color 0.15s; position: relative;
}
.cd-history-card:hover { background: var(--bg-hover); border-color: var(--border); }
.cd-history-card.cd-history-active { background: var(--bg-active); border-color: var(--accent); }

.cd-history-thumb {
  width: 36px; height: 36px; object-fit: cover; display: block;
  border-radius: 4px; background: rgba(0,0,0,0.2); flex-shrink: 0;
}

.cd-history-info { flex: 1; min-width: 0; }
.cd-history-name {
  font-size: 11px; font-weight: 600; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cd-history-meta {
  font-size: 10px; color: var(--text-secondary); opacity: 0.7;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.cd-history-actions {
  display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; flex-shrink: 0;
}
.cd-history-card:hover .cd-history-actions { opacity: 1; }

.cd-history-btn {
  width: 20px; height: 20px; border: none; border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; font-size: 11px; transition: background 0.15s;
}
.cd-history-use {
  background: rgba(46,204,113,0.15); color: var(--success);
}
.cd-history-use:hover { background: rgba(46,204,113,0.3); }
.cd-history-del {
  background: rgba(231,76,60,0.15); color: var(--danger);
}
.cd-history-del:hover { background: rgba(231,76,60,0.3); }

.cd-history-empty {
  font-size: 11px; color: var(--text-secondary); opacity: 0.5;
  padding: 6px 0; text-align: center;
}

/* ── Concept Grid (two-stage flow) ── */
.cd-concepts-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
  padding: 4px 0;
}
.cd-concept-card {
  position: relative; border-radius: 10px; overflow: hidden;
  border: 2px solid var(--border); cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
  background: rgba(0,0,0,0.25);
}
.cd-concept-card:hover { border-color: var(--text-secondary); transform: scale(1.02); }
.cd-concept-card.selected {
  border-color: var(--accent); box-shadow: 0 0 16px rgba(108,92,231,0.35);
}
.cd-concept-img {
  width: 100%; height: 100%; object-fit: cover; display: block;
}
.cd-concept-check {
  position: absolute; top: 6px; right: 6px;
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(0,0,0,0.5); border: 2px solid rgba(255,255,255,0.3);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: #fff; font-weight: 700;
  transition: all 0.2s;
}
.cd-concept-card.selected .cd-concept-check {
  background: var(--accent); border-color: var(--accent); color: #0b0c0a;
}
.cd-concept-label {
  position: absolute; bottom: 4px; left: 6px;
  font-size: 10px; color: rgba(255,255,255,0.6);
  background: rgba(0,0,0,0.4); padding: 1px 6px; border-radius: 3px;
}

.cd-concepts-actions {
  display: flex; gap: 8px; margin-top: 12px;
}
.cd-concepts-actions .cd-btn { flex: 1; }

.cd-sel-count {
  font-size: 12px; font-weight: 400; color: var(--accent); margin-left: 8px;
}

.cd-fusion-panel {
  margin-top: 10px; padding: 10px; border-radius: var(--radius);
  background: var(--accent-dim, rgba(212,255,72,0.06)); border: 1px solid rgba(212,255,72,0.15);
}
.cd-fusion-input { width: 100%; box-sizing: border-box; }

.cd-fusion-ref { margin-bottom: 8px; }
.cd-fusion-ref-title { font-size: 10px; color: var(--text-secondary); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.3px; }
.cd-fusion-thumbs { display: flex; gap: 8px; flex-wrap: wrap; }
.cd-fusion-thumb-item {
  position: relative; width: 56px; height: 56px; border-radius: 6px; overflow: hidden;
  border: 1px solid var(--border); flex-shrink: 0;
}
.cd-fusion-thumb-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cd-fusion-thumb-label {
  position: absolute; top: 2px; left: 2px;
  background: var(--accent); color: #0b0c0a; font-size: 10px; font-weight: 700;
  width: 16px; height: 16px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  line-height: 1;
}
.cd-fusion-thumb-num {
  position: absolute; bottom: 1px; right: 3px;
  font-size: 8px; color: rgba(255,255,255,0.6);
}

.cd-btn-back {
  width: 100%; background: transparent; border: 1px dashed var(--border);
  color: var(--text-secondary); font-size: 11px;
}
.cd-btn-back:hover { border-color: var(--accent); color: var(--accent); }

/* ── Detail Phase (Part Modification) ── */
.cd-detail-phase-panel {
  display: flex; flex-direction: column; height: 100%;
  font-family: system-ui, -apple-system, sans-serif;
}
.cd-detail-parts-list {
  flex: 1; overflow-y: auto; overflow-x: hidden; padding: 4px 8px;
}
.cd-detail-parts-list::-webkit-scrollbar { width: 3px; }
.cd-detail-parts-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.cd-detail-part-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-radius: var(--radius);
  cursor: pointer; transition: all 0.15s;
  border: 1px solid transparent; position: relative;
}
.cd-detail-part-row:hover { background: var(--bg-hover); }
.cd-detail-part-row.active { background: var(--bg-active); border-color: var(--accent); }
.cd-detail-part-icon { font-size: 16px; flex-shrink: 0; }
.cd-detail-part-info { flex: 1; min-width: 0; }
.cd-detail-part-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.cd-detail-part-pos { font-size: 10px; color: var(--text-secondary); opacity: 0.6; }
.cd-detail-part-dot {
  width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  background: transparent; transition: background 0.15s;
}
.cd-detail-part-row.generated .cd-detail-part-dot { background: var(--success, #2ecc71); }
.cd-detail-part-row.active .cd-detail-part-dot { background: var(--accent); }

.cd-detail-parts-count {
  font-size: 10px; color: var(--text-secondary); text-align: center;
  padding: 6px 8px; border-top: 1px solid var(--border);
}

.cd-detail-actions {
  display: flex; flex-direction: column; gap: 6px;
  padding: 10px 12px; border-top: 1px solid var(--border);
}

/* Detail center */
.cd-detail-wrap {
  display: flex; flex-direction: column; gap: 14px;
}
.cd-detail-preview-area {
  display: flex; flex-direction: column;
}
.cd-detail-ver {
  font-size: 11px; color: var(--accent); font-weight: 600; margin-left: 6px;
}

.cd-detail-history-strip {
  display: flex; gap: 6px; padding: 8px 0; overflow-x: auto;
}
.cd-detail-history-strip::-webkit-scrollbar { height: 3px; }
.cd-detail-history-strip::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

.cd-detail-history-thumb {
  position: relative; width: 48px; height: 48px; border-radius: 6px;
  overflow: hidden; border: 2px solid var(--border); cursor: pointer;
  flex-shrink: 0; transition: border-color 0.15s;
}
.cd-detail-history-thumb:hover { border-color: var(--text-secondary); }
.cd-detail-history-thumb.active { border-color: var(--accent); }
.cd-detail-history-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cd-detail-hist-badge {
  position: absolute; top: 1px; left: 1px;
  background: rgba(0,0,0,0.6); font-size: 10px; padding: 0 3px;
  border-radius: 3px;
}
.cd-detail-hist-ver {
  position: absolute; bottom: 0; right: 1px;
  font-size: 8px; color: rgba(255,255,255,0.7);
}

.cd-detail-empty-hint {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  flex: 1; min-height: 180px; color: var(--text-secondary); text-align: center;
}

.cd-detail-editor {
  padding: 12px 16px; border-radius: 10px;
  background: rgba(18,18,26,0.5); border: 1px solid var(--border);
}
.cd-detail-editor-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
}

.cd-detail-hints {
  display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0 10px;
}
.cd-detail-hint-tag {
  padding: 3px 8px; font-size: 11px; border-radius: 4px;
  background: var(--bg-hover); color: var(--text-secondary);
  border: 1px solid var(--border); cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.cd-detail-hint-tag:hover { border-color: var(--accent); color: var(--accent); }

.cd-detail-prompt-preview {
  padding: 8px 10px; border-radius: var(--radius);
  background: rgba(0,0,0,0.2); border: 1px solid var(--border);
  margin-bottom: 4px;
}
.cd-detail-prompt-header {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px; color: var(--text-secondary); margin-bottom: 6px;
}
.cd-detail-prompt-text {
  font-size: 11px; line-height: 1.5; color: var(--text-secondary);
  max-height: 80px; overflow-y: auto; word-break: break-word;
}

/* ── Concept Detail (part edit in concept phase) ── */
.cd-cdetail-panel {
  margin-top: 12px; padding: 12px 14px; border-radius: 10px;
  background: rgba(18,18,26,0.6); border: 1px solid var(--border);
  animation: cd-picker-in 0.2s ease;
}
.cd-cdetail-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
}
.cd-cdetail-parts {
  display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;
}
.cd-cdetail-part-btn {
  width: 36px; height: 36px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--bg-hover);
  font-size: 16px; cursor: pointer; transition: all 0.15s;
  display: flex; align-items: center; justify-content: center;
  font-family: inherit; padding: 0;
}
.cd-cdetail-part-btn:hover { border-color: var(--accent); background: var(--bg-active); }
.cd-cdetail-part-btn.active {
  border-color: var(--accent); background: var(--accent-dim, rgba(212,255,72,0.15));
  box-shadow: 0 0 8px rgba(212,255,72,0.2);
}

.cd-cdetail-editor { margin-top: 4px; }
.cd-cdetail-editor-head {
  display: flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 6px;
}
.cd-cdetail-hints {
  display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;
}
.cd-cdetail-hint {
  padding: 2px 7px; font-size: 11px; border-radius: 4px;
  background: var(--bg-hover); color: var(--text-secondary);
  border: 1px solid var(--border); cursor: pointer; transition: all 0.15s;
  font-family: inherit;
}
.cd-cdetail-hint:hover { border-color: var(--accent); color: var(--accent); }

.cd-turnaround-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
  margin: 10px 0 0; padding: 10px;
  width: 100%; max-width: 100%;
  flex-shrink: 0;
  border-radius: 10px; border: 1px solid var(--border);
  background: rgba(0,0,0,0.25);
  box-sizing: border-box;
}
.cd-turnaround-cell {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  border-radius: 6px; overflow: hidden; background: rgba(0,0,0,0.35);
  border: 1px solid var(--border);
  min-width: 0;
}
.cd-turnaround-cell img {
  width: 100%; height: auto;
  max-height: 200px; min-height: 140px;
  object-fit: contain; background: #fff;
}
.cd-turnaround-cell span {
  font-size: 11px; color: var(--text-secondary); padding: 0 0 6px;
}
.cd-turnaround-empty { min-height: 140px; justify-content: center; opacity: 0.4; }
`
