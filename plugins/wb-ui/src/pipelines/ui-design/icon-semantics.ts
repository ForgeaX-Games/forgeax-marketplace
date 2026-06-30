/**
 * 第二步所选模块 → 功能 icon 槽位分析与提示词语义构建。
 * 图标必须对应模块的可读功能语义，禁止生成无意义抽象图形。
 */
import type { GenrePresetId, ModuleAssetSpec } from './model'
import { SECTION_FEATURE_HINTS } from './model'

/** 每个模块对应一个明确、可读的 HUD 符号（禁止 OR 分支） */
export type ModuleIconGlyph = {
  anchor: string
  /** 英文具象 silhouette 描述，供生图模型执行 */
  motif: string
  /** 与本模块无关、或会稀释语义的形状 */
  forbidden: string
}

/** 中文功能说明：UI 展示 + 提示词语义锚点 */
export type ModuleIconFunctionZh = {
  /** 这个 icon 在游戏里代表什么（玩家视角） */
  symbol: string
  /** 图标必须画成什么样（形态描述） */
  visual: string
}

export const MODULE_ICON_GLYPHS: Record<string, ModuleIconGlyph> = {
  'main-nav': {
    anchor: 'Hamburger menu',
    motif: 'exactly three thick parallel horizontal bars with equal spacing, bold uniform stroke width, classic menu-launcher silhouette centered on canvas — all three bars must be visible',
    forbidden: 'single horizontal dash, one line only, wide button strip, header bar chrome, map pin, compass, 2x2 app grid tile, empty dark plate, neon bezel frame',
  },
  minimap: {
    anchor: 'Corner minimap widget',
    motif: 'small rounded-square frame containing simplified abstract terrain (one chunky L-shaped land mass + flat water tone) and one tiny player dot; compact minimap icon, not a full world poster',
    forbidden: 'full continent map, vertical map card, teardrop GPS pin alone, multiple orange location pins, realistic geography, empty dark square, plain letter L without map frame, standalone compass rose',
  },
  'interaction-hints': {
    anchor: 'Press-E keycap',
    motif: 'rounded-rectangle keyboard keycap with bold uppercase letter E centered inside, high legibility, classic "press to interact" prompt icon',
    forbidden: 'abstract neon squiggle, hand photo, map pin, empty dark plate, wide HUD bar, decorative frame without letter E',
  },
  'skill-bar': {
    anchor: 'Skill hotbar',
    motif: 'three separate filled circular ability-glyphs in a horizontal row: left circle contains sword, center circle contains lightning bolt, right circle contains shield; reads as action hotbar, not an empty slot frame or merged status pill',
    forbidden: 'hexagonal slot frame only, empty ability slots, horizontal neon bar chrome, merged pill badge, three empty hollow circles, diamond decorative frame, orbit ring, lone lightning on empty plate',
  },
  'quest-tracker': {
    anchor: 'Quest tracker',
    motif: 'rolled parchment scroll with bold exclamation mark on the face, quest objective tracker icon',
    forbidden: 'map pin, coin stack, compass alone, empty checklist plate, generic horizontal dash',
  },
  'health-status': {
    anchor: 'Health / HP',
    motif: 'bold filled heart shape with clean outer contour, life/HP status indicator',
    forbidden: 'map pin, coin, sword, shield cross, navigation symbols, empty plate',
  },
  'weapon-hud': {
    anchor: 'Equipped weapon',
    motif: 'single side-view assault rifle silhouette, bold readable weapon indicator',
    forbidden: 'map pin, heart, menu bars, compass, crosshair only',
  },
  'ammo-counter': {
    anchor: 'Ammunition',
    motif: 'vertical stack of three bullet cartridges with visible tips, ammunition counter icon',
    forbidden: 'map pin, heart, hamburger menu, compass, magazine strip chrome',
  },
  reticle: {
    anchor: 'Aim reticle',
    motif: 'simple crosshair plus sign with thin circle around center dot, FPS aiming reticle',
    forbidden: 'map pin, heart, menu icon, full weapon illustration, decorative neon frame',
  },
  scoreboard: {
    anchor: 'Leaderboard',
    motif: 'podium with numbers 1-2-3 on three steps, leaderboard rank icon',
    forbidden: 'map pin, compass, hamburger menu, empty trophy plate',
  },
  'inventory-grid': {
    anchor: 'Inventory grid',
    motif: '3x3 grid of nine equal square slots with one slot highlighted by brighter fill; reads as inventory grid storage — NOT a standalone backpack silhouette, NOT an empty frame, NOT three hollow circles',
    forbidden: 'standalone backpack bag, map pin, single coin alone, lone sword without grid, empty slot plate alone, skill hotbar circles',
  },
  'item-detail': {
    anchor: 'Item inspect',
    motif: 'magnifying glass overlapping a small gear cog, item inspection icon',
    forbidden: 'map pin, full inventory grid, menu bars, empty document plate, keyboard keycap letter E',
  },
  'item-slot': {
    anchor: 'Quick slot item',
    motif: 'single square slot containing a small potion bottle silhouette, hotbar item icon',
    forbidden: 'map pin, 3x3 grid, compass, empty slot plate alone',
  },
  'character-panel': {
    anchor: 'Character stats',
    motif: 'human bust silhouette from shoulders up with two small horizontal stat bars beside the shoulder, character panel icon',
    forbidden: 'map pin, coin stack, compass, hamburger menu, full body illustration, minimap frame, compass rose',
  },
  'crafting-panel': {
    anchor: 'Crafting',
    motif: 'hammer and wrench crossed in X shape with small spark, crafting/fabrication icon',
    forbidden: 'map pin, compass, menu bars, anvil chrome plate alone',
  },
  'resource-tracker': {
    anchor: 'Resource tracker',
    motif: 'three small resource silhouettes in a row: wood log, ore chunk, water drop, resource tracking icon',
    forbidden: 'standalone map pin, lone compass, hamburger menu, progress bar strip, empty square frame',
  },
  currency: {
    anchor: 'Currency',
    motif: 'stack of three gold coins with clear circular faces and slight offset, money/currency icon',
    forbidden: 'map pin, compass, sword, menu bars, coin on empty dark plate only',
  },
  'map-screen': {
    anchor: 'World map',
    motif: 'folded rectangular map sheet with simplified continent blobs and one dotted travel path, full-screen map icon (not a pin)',
    forbidden: 'single teardrop pin only, corner minimap widget, compass without map sheet, vertical map poster',
  },
  'shop-panel': {
    anchor: 'Shop',
    motif: 'simple shopping bag silhouette with small price tag hanging from handle, merchant shop icon',
    forbidden: 'map pin, compass, hamburger menu, storefront chrome strip',
  },
  'reward-summary': {
    anchor: 'Reward chest',
    motif: 'treasure chest slightly open with soft light glow from inside, reward/loot summary icon',
    forbidden: 'map pin, compass, menu bars, empty gift box plate, hamburger menu bars',
  },
  'chat-panel': {
    anchor: 'Chat',
    motif: 'single speech bubble with three dots inside, chat channel icon',
    forbidden: 'map pin, compass, sword, menu bars, overlapping bubble chrome strip',
  },
  'dialog-box': {
    anchor: 'Dialog box',
    motif: 'wide rounded dialogue panel shape with small triangular tail pointing downward, NPC dialog icon',
    forbidden: 'map pin, compass, hamburger menu, empty text box plate',
  },
  'pause-menu': {
    anchor: 'Pause',
    motif: 'two vertical parallel bars (pause symbol) inside a small circle, pause menu icon',
    forbidden: 'map pin, play triangle alone, compass, decorative neon ring',
  },
  'settings-panel': {
    anchor: 'Settings',
    motif: 'gear cog with six teeth and center hole, settings/options icon',
    forbidden: 'map pin, compass, hamburger menu, wrench alone without cog',
  },
  'modal-dialog': {
    anchor: 'Confirm modal',
    motif: 'alert triangle with exclamation mark inside, confirm/modal prompt icon',
    forbidden: 'map pin, compass, generic neon blob, empty circle plate',
  },
  'game-board': {
    anchor: 'Puzzle board',
    motif: '3x3 grid with three matching gem shapes aligned in one row, match-3 puzzle board icon',
    forbidden: 'map pin, compass, menu bars, empty grid plate',
  },
  'score-display': {
    anchor: 'Score',
    motif: 'bold five-point star with small score plaque beneath, current score icon',
    forbidden: 'map pin, compass, trophy alone without star, digital counter strip',
  },
  'level-counter': {
    anchor: 'Level flag',
    motif: 'flag on pole with small hash/number sign on the flag cloth, level/stage counter icon',
    forbidden: 'map pin, compass, hamburger menu, empty badge plate',
  },
  'step-counter': {
    anchor: 'Steps remaining',
    motif: 'pair of footprints side by side with three small dots below, steps-remaining icon',
    forbidden: 'map pin, compass, clock without footprint meaning, shoe on empty plate',
  },
  'endless-mode': {
    anchor: 'Endless mode',
    motif: 'infinity symbol loop (∞ shape), endless/infinite mode icon',
    forbidden: 'map pin, compass, finite step counter, circular arrow chrome strip',
  },
  'tech-tree': {
    anchor: 'Tech tree',
    motif: 'three circular nodes connected by lines forming a small branching tree, research tech-tree icon',
    forbidden: 'map pin, compass, plain grid without nodes, decorative network frame',
  },
  'level-select': {
    anchor: 'Level select',
    motif: 'path of three connected circular nodes with stars (one filled star, two outline stars), stage select icon',
    forbidden: 'map pin, compass, hamburger menu, empty node plate',
  },
  'weapon-select': {
    anchor: 'Weapon loadout',
    motif: 'three weapon silhouettes in a row (pistol, rifle, shotgun side profiles) with middle weapon highlighted brighter, loadout select icon',
    forbidden: 'map pin, compass, single crosshair only, empty weapon slot frame',
  },
}

export const MODULE_ICON_FUNCTION_ZH: Record<string, ModuleIconFunctionZh> = {
  'main-nav': { symbol: '打开主导航，切换地图/背包/社交等核心入口', visual: '三条等距粗横线（汉堡菜单）' },
  minimap: { symbol: '查看小地图，识别方位、目标与危险区域', visual: '圆角方框内简化地形 + 玩家圆点' },
  'interaction-hints': { symbol: '提示玩家按键交互（如按 E 拾取/对话）', visual: '键盘帽 + 字母 E' },
  'skill-bar': { symbol: '释放技能与查看冷却/快捷键', visual: '三个并排技能圆标（剑/闪电/盾）' },
  'quest-tracker': { symbol: '追踪当前任务目标与进度', visual: '卷轴 + 感叹号' },
  'health-status': { symbol: '显示生命值/生存状态', visual: '实心爱心' },
  'weapon-hud': { symbol: '显示当前装备武器', visual: '步枪侧视剪影' },
  'ammo-counter': { symbol: '显示弹药/备弹数量', visual: '三发子弹叠放' },
  reticle: { symbol: '瞄准与命中指示', visual: '十字准星 + 中心圆点' },
  scoreboard: { symbol: '查看排名/比分/圈速', visual: '领奖台 1-2-3' },
  'inventory-grid': { symbol: '打开背包，管理物品与装备格子', visual: '3×3 物品格子（一格高亮）' },
  'item-detail': { symbol: '查看道具属性、效果与操作', visual: '放大镜 + 齿轮' },
  'item-slot': { symbol: '快捷道具槽/消耗品', visual: '单格 + 药水瓶' },
  'character-panel': { symbol: '查看角色等级、属性与装备总览', visual: '人物 bust + 属性条' },
  'crafting-panel': { symbol: '合成/制作装备与道具', visual: '交叉锤子和扳手' },
  'resource-tracker': { symbol: '追踪木材/矿石/食物等资源存量', visual: '木段 + 矿石 + 水滴' },
  currency: { symbol: '显示持有货币与变化', visual: '三枚叠放金币' },
  'map-screen': { symbol: '打开全屏世界地图与路线', visual: '折页地图 + 路线虚线' },
  'shop-panel': { symbol: '进入商店购买/出售', visual: '购物袋 + 价签' },
  'reward-summary': { symbol: '关卡结算与奖励领取', visual: '半开宝箱 + 光效' },
  'chat-panel': { symbol: '打开聊天/频道消息', visual: '对话气泡 + 省略号' },
  'dialog-box': { symbol: 'NPC 对话与剧情选项', visual: '带尾巴的对话框' },
  'pause-menu': { symbol: '暂停游戏/打开系统菜单', visual: '圆圈内暂停双竖线' },
  'settings-panel': { symbol: '调整画面/音频/控制设置', visual: '六齿齿轮' },
  'modal-dialog': { symbol: '二次确认/警告弹窗', visual: '三角警示 + 感叹号' },
  'game-board': { symbol: '解谜/三消核心棋盘', visual: '3×3 宝石连线' },
  'score-display': { symbol: '显示当前得分/目标分', visual: '五角星 + 得分牌' },
  'level-counter': { symbol: '显示关卡编号/阶段', visual: '旗杆 + 数字旗面' },
  'step-counter': { symbol: '显示剩余步数/操作次数', visual: '并排脚印 + 圆点' },
  'endless-mode': { symbol: '无限模式标识', visual: '∞ 无穷符号' },
  'tech-tree': { symbol: '科技/天赋树研究', visual: '三节点分支连线' },
  'level-select': { symbol: '选择关卡/章节节点', visual: '路径节点 + 星星' },
  'weapon-select': { symbol: '切换武器/loadout', visual: '三把枪侧视（中间高亮）' },
}

const COUNTER_GLYPH_MODULES = new Set([
  'health-status',
  'score-display',
  'level-counter',
  'step-counter',
  'endless-mode',
  'ammo-counter',
])

const LAYER_READABLE: Record<string, string> = {
  'permanent-hud': '常驻 HUD，玩家随时可见',
  'context-hud': '情境 HUD，在相关玩法时出现',
  'active-menu': '主动菜单层，玩家打开面板时使用',
  'depth-settings': '深层/全屏系统页',
}

export type ModuleIconBrief = {
  moduleId: string
  label: string
  anchor: string
  motif: string
  forbidden: string
  /** 中文：玩家视角功能 */
  symbolZh: string
  /** 中文：必须画出的形态 */
  visualZh: string
  functionalIntent: string
  playerReadableMeaning: string
  usageScene: string
}

/** 第三步 UI：每个 icon 槽位的完整语义描述 */
export type IconSlotDescriptor = {
  slotIndex: number
  moduleId: string
  label: string
  /** 代表功能（主标题） */
  functionTitle: string
  /** 功能说明（副文案，来自模块 description） */
  functionDetail: string
  /** 图标形态说明 */
  visualHint: string
}

export type ModuleAssetSpecLike = Pick<
  ModuleAssetSpec,
  'id' | 'label' | 'category' | 'layer' | 'zone' | 'description' | 'aiHint' | 'assetRoles'
>

export function hasModuleIconGlyph(moduleId: string | undefined): boolean {
  return Boolean(moduleId && MODULE_ICON_GLYPHS[moduleId])
}

export function moduleNeedsFunctionalIcon(spec: ModuleAssetSpecLike): boolean {
  if (!hasModuleIconGlyph(spec.id)) return false
  if (spec.assetRoles.includes('icon')) return true
  if (SECTION_FEATURE_HINTS.icons.includes(spec.id)) return true
  if (SECTION_FEATURE_HINTS.cards.includes(spec.id)) return true
  if (SECTION_FEATURE_HINTS.lists.includes(spec.id)) return true
  if (spec.assetRoles.includes('counter') && COUNTER_GLYPH_MODULES.has(spec.id)) return true
  if (spec.category.includes('核心') && spec.assetRoles.includes('counter')) return true
  return false
}

/** 槽位优先级：卡片/列表模块优先进入前 8 槽，避免预览与生成错位 */
function iconModuleSortKey(spec: ModuleAssetSpecLike, originalIndex: number): [number, number, number] {
  let tier = 40
  if (SECTION_FEATURE_HINTS.cards.includes(spec.id)) tier = 0
  else if (SECTION_FEATURE_HINTS.lists.includes(spec.id)) tier = 10
  else if (spec.assetRoles.includes('icon')) tier = 20
  else if (SECTION_FEATURE_HINTS.icons.includes(spec.id)) tier = 30

  const hintOrder = [
    ...SECTION_FEATURE_HINTS.cards,
    ...SECTION_FEATURE_HINTS.lists,
    ...SECTION_FEATURE_HINTS.icons,
  ].indexOf(spec.id)
  const sectionOrder = hintOrder >= 0 ? hintOrder : 999
  return [tier, sectionOrder, originalIndex]
}

/** 按优先级排序的全部候选模块（最多 12） */
export function collectIconModuleSpecs(specs: ModuleAssetSpecLike[]): ModuleAssetSpecLike[] {
  const indexed = specs
    .map((spec, originalIndex) => ({ spec, originalIndex }))
    .filter(({ spec }) => moduleNeedsFunctionalIcon(spec))
  indexed.sort((a, b) => {
    const ka = iconModuleSortKey(a.spec, a.originalIndex)
    const kb = iconModuleSortKey(b.spec, b.originalIndex)
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]
  })
  return indexed.map(({ spec }) => spec).slice(0, 12)
}

/** 实际生成/展示用的 icon 槽（默认最多 8） */
export function activeIconModuleSpecs(specs: ModuleAssetSpecLike[]): ModuleAssetSpecLike[] {
  const max = resolveIconSlotCount(specs)
  return collectIconModuleSpecs(specs).slice(0, max)
}

export function iconLabelsFromModuleSpecs(specs: ModuleAssetSpecLike[]): string[] {
  return activeIconModuleSpecs(specs).map(spec => spec.label || spec.id)
}

export function resolveIconSlotCount(specs: ModuleAssetSpecLike[]): number {
  const count = collectIconModuleSpecs(specs).length
  if (count <= 0) return 4
  return Math.max(4, Math.min(8, count))
}

export function iconSlotIndexForModuleId(
  specs: ModuleAssetSpecLike[],
  moduleId: string,
): number {
  const iconSpecs = activeIconModuleSpecs(specs)
  const idx = iconSpecs.findIndex(spec => spec.id === moduleId)
  return idx >= 0 ? idx : -1
}

export function iconSlotDescriptorsFromModuleSpecs(specs: ModuleAssetSpecLike[]): IconSlotDescriptor[] {
  return activeIconModuleSpecs(specs).map((spec, slotIndex) => {
    const fn = MODULE_ICON_FUNCTION_ZH[spec.id] ?? {
      symbol: spec.description || spec.label,
      visual: MODULE_ICON_GLYPHS[spec.id]?.anchor ?? spec.label,
    }
    return {
      slotIndex,
      moduleId: spec.id,
      label: spec.label || spec.id,
      functionTitle: fn.symbol,
      functionDetail: spec.description || spec.aiHint || '',
      visualHint: fn.visual,
    }
  })
}

function resolveFunctionZh(spec: ModuleAssetSpecLike, glyph: ModuleIconGlyph): ModuleIconFunctionZh {
  const preset = MODULE_ICON_FUNCTION_ZH[spec.id]
  if (preset) return preset
  return {
    symbol: spec.description || spec.label,
    visual: glyph.anchor,
  }
}

function buildFunctionalIntent(spec: ModuleAssetSpecLike): string {
  const parts = [
    spec.description ? `功能：${spec.description}` : '',
    spec.aiHint ? `设计意图：${spec.aiHint}` : '',
    spec.zone ? `界面分区：${spec.zone}` : '',
    spec.category ? `系统分类：${spec.category}` : '',
  ].filter(Boolean)
  return parts.join(' ')
}

function buildUsageScene(spec: ModuleAssetSpecLike): string {
  const layerNote = LAYER_READABLE[spec.layer] ?? spec.layer
  return [layerNote, spec.zone ? `位于${spec.zone}` : ''].filter(Boolean).join('，')
}

export function buildModuleIconBrief(
  spec: ModuleAssetSpecLike | undefined,
  idx: number,
  _genreKey: GenrePresetId,
  genreIconFallback?: (idx: number) => { anchor: string; motif: string; forbidden: string },
): ModuleIconBrief {
  const moduleId = spec?.id || ''
  const label = spec?.label || moduleId || `图标 ${idx + 1}`
  const glyph = moduleId ? MODULE_ICON_GLYPHS[moduleId] : undefined

  if (glyph && spec) {
    const fnZh = resolveFunctionZh(spec, glyph)
    const functionalIntent = buildFunctionalIntent(spec)
    const usageScene = buildUsageScene(spec)
    const playerReadableMeaning = [
      `玩家必须在 56px 下立即识别：${fnZh.symbol}`,
      `图标形态必须是：${fnZh.visual}`,
      `符号英文名：${glyph.anchor}`,
    ].join(' ')
    const motif = [
      `DRAW LITERALLY: ${fnZh.visual} (${glyph.anchor}).`,
      glyph.motif,
      `Module id ${moduleId} — semantic function only, never render as readable text.`,
      functionalIntent ? `Context (do not paint as caption): ${glyph.anchor}.` : '',
      'Do NOT substitute unrelated shapes (no backpack for grid, no compass for character, no E key for item detail, no hollow circles for skill bar, no single dash for menu).',
    ].filter(Boolean).join(' ')

    return {
      moduleId,
      label,
      anchor: glyph.anchor,
      motif,
      forbidden: glyph.forbidden,
      symbolZh: fnZh.symbol,
      visualZh: fnZh.visual,
      functionalIntent,
      playerReadableMeaning,
      usageScene,
    }
  }

  const fallback = genreIconFallback?.(idx) ?? {
    anchor: 'gear cog',
    motif: 'single bold filled gear cog as a readable flat game HUD glyph silhouette, centered, no chrome frame',
    forbidden: 'map pin unless map-related, app-icon plate, badge tile, button strip, empty slot plate, decorative neon bezel, meaningless abstract dash',
  }

  return {
    moduleId,
    label,
    anchor: fallback.anchor,
    motif: `${fallback.motif} Module id ${moduleId}.`,
    forbidden: fallback.forbidden,
    symbolZh: spec?.description || label,
    visualZh: fallback.anchor,
    functionalIntent: spec ? buildFunctionalIntent(spec) : '',
    playerReadableMeaning: `玩家应识别为：${spec?.description || label}`,
    usageScene: spec ? buildUsageScene(spec) : '',
  }
}

export type FunctionalIconPromptContext = {
  styleBase: string
  extraHint: string
  /** 仅材质/配色，不含 genre 通用 icon 隐喻 */
  styleMaterialNote: string
  sciFiFlatNote: string
  siblingAnchors: string[]
  moduleIconHint: string
}

export function buildFunctionalIconPrompt(
  brief: ModuleIconBrief,
  ctx: FunctionalIconPromptContext,
): string {
  const motifEn = brief.motif
    .replace(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef「」（）【】：；，。、？！《》]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return [
    `=== FUNCTIONAL GAME UI GLYPH ===`,
    `SUBJECT: one flat "${brief.anchor}" symbol — ${motifEn}`,
    `MODULE ID (metadata only, never paint as text): ${brief.moduleId}`,
    `${ctx.styleBase}.${ctx.extraHint}`,
    ctx.styleMaterialNote,
    ctx.sciFiFlatNote,
    ctx.moduleIconHint,
    `STYLE RULE: Apply color/material from style ONLY — do NOT change the symbol semantics. Ignore unrelated genre icon metaphors (backpack, compass, map pin) unless this module is explicitly map/inventory related.`,
    `READABILITY: communicate "${brief.anchor}" in under 1 second at 56px (must stay legible at 48–64px HUD slots); 2-3 flat colors; filled recognizable symbol — NEVER a meaningless dash, blob, empty frame, hollow circles, or decorative geometry.`,
    ctx.siblingAnchors.length > 0
      ? `DISTINCT from sibling icons: ${ctx.siblingAnchors.join(' · ')}.`
      : '',
    `FORBIDDEN: ${brief.forbidden}; UI chrome strips; app-icon plates; sticker halos; unrelated metaphors; ANY readable characters (Chinese, English, digits), labels, captions, title bars, button strips, banners, ribbons with lettering.`,
    `CRITICAL — NO TEXT IN IMAGE: output must be a pure pictogram/symbol with zero letters and zero words anywhere in the pixels.`,
    `Output: ONE flat glyph centered on pure #FFFFFF, square 1:1, symbol 76-84% of canvas, modest white margin for cutout.`,
    `No rounded-square container, no colored plate, no avatar frame plate, no decorative bezel, no circuit-board panel behind the symbol, no settlement/reward banner.`,
  ].filter(Boolean).join(' ')
}
