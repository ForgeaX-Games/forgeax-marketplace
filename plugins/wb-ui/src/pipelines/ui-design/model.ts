// ─── Storage ──────────────────────────────────────────────────────────────────
import {
  iconLabelsFromModuleSpecs,
  resolveIconSlotCount,
} from './icon-semantics'

export const STORAGE_KEY = 'character-editor:ui-design-state'
export const RUNTIME_STORAGE_KEY = 'character-editor:ui-design-runtime'

export interface UiDesignRuntimeSnapshot {
  version: 1
  activeScreen: ScreenKind
  genreSelectionConfirmed: boolean
  layoutReviewedScreens: string[]
  layoutBaselineMergedScreens: string[]
  prototypeHTML: string | null
  previewBg: Record<string, string>
  liveAssets: {
    icons: string[]
    buttonNormal?: string
    buttonPrimary?: string
    titleDeco?: string
    panelTexture?: string
  }
  savedAt: number
}

// ─── Primitive Types ──────────────────────────────────────────────────────────
export type GenrePresetId =
  | 'open-world'
  | 'action-rpg'
  | 'fps'
  | 'survival'
  | 'mmo'
  | 'life-sim'
  | 'racing'
  | 'puzzle'

export type StylePresetId =
  | 'modern-dark'
  | 'fantasy'
  | 'anime'
  | 'sci-fi'
  | 'pixel'
  | 'cute-cartoon'
  | 'fresh-pastoral'
  | 'realistic-military'
  | 'modern-minimal'

export type StagePresetId =
  | 'entry'
  | 'hub'
  | 'exploration'
  | 'combat'
  | 'progression'
  | 'economy'
  | 'social'
  | 'results'

export type ScreenKind =
  | 'start'
  | 'hud'
  | 'bag'
  | 'dialog'
  | 'character'
  | 'results'
  | 'end'
  | 'pause'
  | 'level-select'
  | 'weapon-select'
  | 'map'
  | 'shop'

export type ModulePriority = 'required' | 'recommended' | 'optional'

export type ConflictType =
  | 'style-mismatch'
  | 'dependency-missing'
  | 'mutual-exclusive'
  | 'scope-mismatch'
  | 'layout-overflow'

export type ConflictSeverity = 'error' | 'warning' | 'info'

export type PreviewDeviceId = 'pc' | 'mobile' | 'console'
export type PreviewModeId = 'hud' | 'menu' | 'shop' | 'dialog' | 'results'
export type ParameterTabId = 'color' | 'font' | 'style' | 'layout'
export type ThemeModeId = 'dark' | 'light'
export type FontFlavorId = 'modern' | 'fantasy' | 'arcade' | 'clean'
export type UISurfaceId = 'glass' | 'metal' | 'painted' | 'minimal'
export type DensityId = 'airy' | 'balanced' | 'dense'
export type ModuleLayerId = 'permanent-hud' | 'context-hud' | 'active-menu' | 'depth-settings'
export type AssetKindId = 'buttonNormal' | 'buttonPrimary' | 'titleDeco' | 'panelTexture' | 'icons' | 'background'
export type WorkflowStepId =
  | 'genre'
  | 'layout'
  | 'style'
  | 'component-preview'
  | 'prototype'

// ─── Core Preset Interfaces ───────────────────────────────────────────────────
export interface GenrePreset {
  id: GenrePresetId
  label: string
  tagline: string
  summary: string
  playerFantasy: string
  exampleGames: string[]
  suggestedStage: StagePresetId
  recommendedFeatures: string[]
  aiHints: string[]
}

export interface StylePreset {
  id: StylePresetId
  label: string
  tone: string
  palette: string[]
  fontFlavor: FontFlavorId
  uiSurface: UISurfaceId
}

export interface StagePreset {
  id: StagePresetId
  label: string
  focus: string
  playerGoal: string
  layout: string
  cta: string
  preview: PreviewModeId
}

export interface FeatureModule {
  id: string
  label: string
  layer: ModuleLayerId
  category: string
  zone: string
  description: string
  aiHint: string
  isRequired?: boolean
  defaultOn?: boolean
}

// ─── Screen Flow ──────────────────────────────────────────────────────────────
export interface ScreenNode {
  kind: ScreenKind
  label: string
  /** Whether this screen requires a dedicated preview pane */
  isPreviewable?: boolean
}

/** Ordered list of screens a player flows through for a given genre (PDF Step 1) */
export type ScreenFlow = ScreenNode[]

// ─── Screen Module Rules ──────────────────────────────────────────────────────
export interface PriorityModule {
  id: string
  label: string
  priority: ModulePriority
  isRequired: boolean
  defaultOn: boolean
}

export interface ScreenModuleSet {
  required: PriorityModule[]
  recommended: PriorityModule[]
  optional: PriorityModule[]
}

// ─── Style Recommendation ─────────────────────────────────────────────────────
export interface StyleRecommendation {
  id: StylePresetId
  label: string
  reason: string
}

// ─── Conflict ─────────────────────────────────────────────────────────────────
export interface ConflictWarning {
  type: ConflictType
  severity: ConflictSeverity
  message: string
  /** Feature IDs or state keys involved */
  involves?: string[]
}

export interface StyleBoardSection {
  id:
    | 'buttons'
    | 'tabs'
    | 'panels'
    | 'bars'
    | 'icons'
    | 'cards'
    | 'lists'
    | 'notifications'
  label: string
  description: string
  items: string[]
  /** 与 items 同序的模块 id，供 icon 槽位语义映射 */
  moduleIds?: string[]
}

export interface GenreComponentKit {
  genre: GenrePresetId
  className: string
  tokens: {
    accent: string
    danger: string
    success: string
    surface: string
    shape: string
    density: 'dense' | 'balanced' | 'airy'
    feedbackTone: string
    iconMetaphor: string
  }
  promptGuidance: string[]
  tabs: {
    primary: string[]
    activeIndex: number
    filters: string[]
    segment: [string, string, string]
    pagerLabel: string
  }
  bars: Array<{
    label: string
    value: number
    tone: 'primary' | 'danger' | 'success' | 'energy'
    meta: string
  }>
  lists: Array<{
    icon: string
    label: string
    meta: string
    status: string
  }>
  notifications: {
    notice: { icon: string; label: string; meta: string; tone: 'primary' | 'danger' | 'success' | 'energy' }
    prompt: { label: string; action: string }
    badge: { label: string; count: string }
    state: { label: string; value: number; tone: 'primary' | 'danger' | 'success' | 'energy' }
  }
}

export interface StyleBoardPreviewScreen {
  slot: 'entry' | 'gameplay' | 'menu' | 'settlement'
  screen: ScreenKind
  label: string
}

export interface ComponentVerificationStep {
  id: 'chain' | 'purity' | 'consistency' | 'size-compression' | 'preview'
  label: string
  items: string[]
}

export interface StyleAssetPreview {
  buttonPrimary?: string
  buttonNormal?: string
  titleDeco?: string
  panelTexture?: string
  icon?: string
  icons?: string[]
}

export interface StyleAssetHistoryItem {
  id: string
  label: string
  genrePreset: GenrePresetId
  style: StylePresetId
  sceneDesc: string
  confirmedAt: number
  /** Full-size assets used when reopening a historical preview. */
  assets?: StyleAssetPreview
  /** Downscaled thumbnails used only for history cards. */
  preview?: StyleAssetPreview
}

export const ASSET_KIND_LABELS: Record<AssetKindId, string> = {
  buttonNormal: '次按钮',
  buttonPrimary: '主按钮',
  titleDeco: '标题条',
  panelTexture: '面板纹理',
  icons: '图标组',
  background: '背景',
}

export const COMPONENT_VERIFICATION_STEPS: ComponentVerificationStep[] = [
  {
    id: 'chain',
    label: '链路完整',
    items: ['MCP生成', '风格统一', '后处理完成'],
  },
  {
    id: 'purity',
    label: '素材纯度',
    items: ['无参考图残留', '无白块黑底', '无页面截图碎片'],
  },
  {
    id: 'consistency',
    label: '家族一致',
    items: ['按钮/标题/面板同材质世界', 'icon 轮廓统一', '状态色不漂移'],
  },
  {
    id: 'size-compression',
    label: '尺寸与压缩',
    items: ['统一尺寸', '压缩完成', '不引用 source 图'],
  },
  {
    id: 'preview',
    label: '预览验收',
    items: ['仅使用 final 资产', '失败项必须标记 blocked', '可进入预览/运行时'],
  },
]

export function getStyleBoardPreviewScreens(genre: GenrePresetId): StyleBoardPreviewScreen[] {
  const flow = getScreenFlow(genre)
  const first = flow[0]
  const gameplay = flow.find(screen => screen.kind === 'hud') ?? flow[1] ?? first
  const menuKinds: ScreenKind[] = ['bag', 'character', 'dialog', 'shop', 'map', 'pause', 'weapon-select', 'level-select']
  const menu = flow.find(screen => menuKinds.includes(screen.kind)) ?? flow.find(screen => screen.kind !== first?.kind && screen.kind !== gameplay?.kind)
  const settlementKinds: ScreenKind[] = ['results', 'end']
  const settlement = [...flow].reverse().find(screen => settlementKinds.includes(screen.kind))
    ?? [...flow].reverse().find(screen => screen.kind !== first?.kind && screen.kind !== gameplay?.kind && screen.kind !== menu?.kind)
    ?? flow[flow.length - 1]

  return [
    { slot: 'entry', screen: first?.kind ?? 'start', label: first?.label ?? '开始界面' },
    { slot: 'gameplay', screen: gameplay?.kind ?? 'hud', label: gameplay?.label ?? 'HUD游玩' },
    { slot: 'menu', screen: menu?.kind ?? gameplay?.kind ?? 'hud', label: menu?.label ?? '功能菜单' },
    { slot: 'settlement', screen: settlement?.kind ?? gameplay?.kind ?? 'results', label: settlement?.label ?? '结算界面' },
  ]
}

// ─── PC Layout Rules ──────────────────────────────────────────────────────────
export interface PCLayoutRules {
  /** Base design width in px */
  designWidth: number
  /** Base design height in px */
  designHeight: number
  /** Minimum supported width */
  minWidth: number
  /** Minimum supported height */
  minHeight: number
  /** General safe margin from edge */
  safeMargin: number
  /** Margin for important/critical info */
  importantMargin: number
  /** Minimum click target for any interactive element */
  minClickTarget: number
  /** Minimum click target for high-frequency actions */
  freqClickTarget: number
  /** Maximum height for top HUD bars */
  maxTopbarHeight: number
  /** Maximum height for bottom HUD bars */
  maxBottombarHeight: number
  /** Sidebar width range */
  sidebarMinWidth: number
  sidebarMaxWidth: number
}

// ─── State ────────────────────────────────────────────────────────────────────
export interface UIDesignState {
  genrePreset: GenrePresetId
  workflowStep: WorkflowStepId
  customGameType: string
  style: StylePresetId
  stage: StagePresetId
  platform: PreviewDeviceId
  previewDevice: PreviewDeviceId
  previewMode: PreviewModeId
  parameterTab: ParameterTabId
  themeMode: ThemeModeId
  fontFlavor: FontFlavorId
  uiSurface: UISurfaceId
  cornerRadius: number
  surfaceTransparency: number
  hudScale: number
  immersion: number
  minimapPosition: string
  healthPosition: string
  density: DensityId
  selectedFeatures: string[]
  keywords: string
  notes: string
  /** 用户输入的场景描述，用于辅助背景生图 */
  sceneDesc: string
  /** 风格拆解板总提示词，可由 AI 推荐后再人工微调 */
  styleBoardPrompt: string
  /** 对按钮 / 面板 / 图标等拆解资产的额外约束 */
  assetPromptNotes: string
  /** 当前布局是否已被作者确认 */
  layoutApproved: boolean
  /** 当前风格拆解是否已确认可进入原型阶段 */
  styleBoardApproved: boolean
  /** 最近一次确认的风格包 ID */
  confirmedStylePackId: string
  /** 过往确认过的风格包记录 */
  assetHistory: StyleAssetHistoryItem[]
  /** 已锁定的素材种类，局部重生时会跳过 */
  lockedAssetKinds: AssetKindId[]
  /** 当前用于对比的历史风格包 ID */
  compareHistoryPackId: string
}

// ─── Blueprint ────────────────────────────────────────────────────────────────
export interface UIBlueprint {
  title: string
  summary: string
  genre: GenrePreset
  style: StylePreset
  stage: StagePreset
  features: string[]
  modulesByLayer: Record<ModuleLayerId, FeatureModule[]>
  recommendations: string[]
  conflicts: string[]
}

// ─── Genre Presets ────────────────────────────────────────────────────────────
export const GENRE_PRESETS: GenrePreset[] = [
  {
    id: 'open-world',
    label: '开放世界',
    tagline: '地图常驻、任务导向、自由探索',
    summary: '面向自由探索与任务推进的多层 HUD。',
    playerFantasy: '在巨大的世界中边探索边接收任务与系统反馈。',
    exampleGames: ['GTA', '赛博风都市冒险'],
    suggestedStage: 'exploration',
    recommendedFeatures: ['minimap', 'quest-tracker', 'interaction-hints', 'main-nav', 'map-screen'],
    aiHints: ['强调地图存在感', '保留任务推进节奏', '需要世界事件提示'],
  },
  {
    id: 'action-rpg',
    label: '动作角色扮演',
    tagline: '技能循环、资源反馈、战斗与成长并重',
    summary: '面向技能释放、资源管理与目标推进的战斗型布局。',
    playerFantasy: '在高压战斗中兼顾技能轮转、目标推进与成长反馈。',
    exampleGames: ['暗黑式刷宝', '动作冒险 RPG'],
    suggestedStage: 'combat',
    recommendedFeatures: ['health-status', 'skill-bar', 'quest-tracker', 'inventory-grid', 'reward-summary'],
    aiHints: ['强化技能条中心感', '资源读数要清晰', '战斗后奖励承接自然'],
  },
  {
    id: 'fps',
    label: '第一人称射击',
    tagline: '武器读数、准星、即时反馈优先',
    summary: '围绕视野中心与射击反馈展开的轻量 HUD。',
    playerFantasy: '保持视线清爽，同时精准掌握弹药、准星与危险反馈。',
    exampleGames: ['现代射击', '战术突入'],
    suggestedStage: 'combat',
    recommendedFeatures: ['weapon-hud', 'ammo-counter', 'reticle', 'health-status', 'interaction-hints', 'pause-menu'],
    aiHints: ['限制 HUD 厚度', '战斗反馈要瞬时', '高优先级信息靠近视野中心'],
  },
  {
    id: 'survival',
    label: '生存建造',
    tagline: '状态条、资源包、制作链路并行',
    summary: '持续暴露生存状态、资源与制作入口的稳态界面。',
    playerFantasy: '在危险环境中维持状态、采集资源并扩张基地。',
    exampleGames: ['野外生存', '废土建造'],
    suggestedStage: 'progression',
    recommendedFeatures: ['health-status', 'resource-tracker', 'crafting-panel', 'inventory-grid', 'map-screen'],
    aiHints: ['状态条不可缺失', '资源系统要常驻可读', '制作入口要低摩擦'],
  },
  {
    id: 'mmo',
    label: '大型多人在线',
    tagline: '聊天、公会、任务、技能并存',
    summary: '高密度、多系统并存的协作型界面骨架。',
    playerFantasy: '在多人团队环境中同时处理战斗、社交、经济与成长。',
    exampleGames: ['传统 MMO', '多人副本社交'],
    suggestedStage: 'social',
    recommendedFeatures: ['chat-panel', 'quest-tracker', 'skill-bar', 'character-panel', 'main-nav'],
    aiHints: ['允许更高密度', '社交通道不能被埋', '快捷入口要成组'],
  },
  {
    id: 'life-sim',
    label: '生活模拟',
    tagline: '轻压力、信息柔和、菜单引导明确',
    summary: '围绕日程、对话与经营反馈的温和信息结构。',
    playerFantasy: '在低压节奏里完成社交、经营与空间布置。',
    exampleGames: ['农场经营', '小镇生活'],
    suggestedStage: 'hub',
    recommendedFeatures: ['main-nav', 'dialog-box', 'shop-panel', 'resource-tracker', 'character-panel'],
    aiHints: ['弱化战斗压迫感', '按钮命名生活化', '保留柔和留白'],
  },
  {
    id: 'racing',
    label: '竞速驾驶',
    tagline: '速度读数、路线、名次与圈速优先',
    summary: '围绕高速度反馈、路线提醒与成绩结算组织界面。',
    playerFantasy: '在高速移动中快速读取速度、路线和比赛结果。',
    exampleGames: ['街头竞速', '赛道挑战'],
    suggestedStage: 'results',
    recommendedFeatures: ['scoreboard', 'resource-tracker', 'map-screen', 'reward-summary', 'main-nav'],
    aiHints: ['速度和排名要突出', '路线信息要简洁', '结算页可更夸张'],
  },
  {
    id: 'puzzle',
    label: '解谜/三消',
    tagline: '棋盘为主、目标简洁、关卡递进',
    summary: '以谜题棋盘为核心，配合关卡选择、目标展示与结果反馈的轻量 UI。',
    playerFantasy: '专注破解谜题，在明确目标中体验进度感与成就感。',
    exampleGames: ['三消消除', '解谜冒险'],
    suggestedStage: 'hub',
    recommendedFeatures: ['game-board', 'score-display', 'level-counter', 'pause-menu', 'reward-summary'],
    aiHints: ['棋盘空间优先', '目标数值始终可见', '关卡选择需要清晰的难度曲线展示'],
  },
]

export const STYLE_PRESETS: StylePreset[] = [
  { id: 'modern-dark', label: '现代暗色', tone: '冷黑玻璃 + 亮色强调', palette: ['#10141d', '#f5f7fa', '#ffb24a'], fontFlavor: 'modern', uiSurface: 'glass' },
  { id: 'fantasy', label: '幻想史诗', tone: '金边、纹章、厚重面板', palette: ['#1a1420', '#efe3c3', '#d7a85b'], fontFlavor: 'fantasy', uiSurface: 'painted' },
  { id: 'anime', label: '二次元战斗', tone: '亮色描边、轻量卡片、速度线感', palette: ['#161824', '#ffffff', '#6ddcff'], fontFlavor: 'clean', uiSurface: 'glass' },
  { id: 'sci-fi', label: '科幻未来', tone: '霓虹描边、冷色 HUD、扫描感', palette: ['#0b1018', '#d5f6ff', '#4fd6ff'], fontFlavor: 'modern', uiSurface: 'metal' },
  { id: 'pixel', label: '像素街机', tone: '块面、对比色、怀旧清晰度', palette: ['#141414', '#f6e7b7', '#83ff6a'], fontFlavor: 'arcade', uiSurface: 'minimal' },
  { id: 'cute-cartoon', label: '可爱卡通', tone: '圆润线条、鲜艳饱和、轻描边', palette: ['#fffbf0', '#ffb7d5', '#5bc8f0'], fontFlavor: 'clean', uiSurface: 'painted' },
  { id: 'fresh-pastoral', label: '清新田园', tone: '柔和绿意、自然纹理、手绘感', palette: ['#f0f7ec', '#8dc26a', '#f7c948'], fontFlavor: 'clean', uiSurface: 'painted' },
  { id: 'realistic-military', label: '写实军事', tone: '暗绿哑光、金属质感、实战显示', palette: ['#1c2218', '#8a9b72', '#d4b96b'], fontFlavor: 'modern', uiSurface: 'metal' },
  { id: 'modern-minimal', label: '极简现代', tone: '大留白、线性图标、黑白主调', palette: ['#f5f5f5', '#1a1a1a', '#6c6cff'], fontFlavor: 'modern', uiSurface: 'minimal' },
]

export const STAGE_PRESETS: StagePreset[] = [
  { id: 'entry', label: '入口页', focus: '首次进入', playerGoal: '快速理解世界与开始动作', layout: '主 CTA + 副入口', cta: '开始游戏', preview: 'menu' },
  { id: 'hub', label: '主城/大厅', focus: '系统导航', playerGoal: '在安全区切换系统与角色操作', layout: '导航优先 + 辅助信息', cta: '进入功能', preview: 'menu' },
  { id: 'exploration', label: '探索中', focus: '地图与目标', playerGoal: '边移动边接收导航与交互提示', layout: '轻 HUD + 地图线索', cta: '前往目标', preview: 'hud' },
  { id: 'combat', label: '战斗中', focus: '生命、技能、火力反馈', playerGoal: '实时判断资源与行动窗口', layout: '中心战斗读数 + 侧向任务', cta: '击败敌人', preview: 'hud' },
  { id: 'progression', label: '成长/养成', focus: '数值与解锁', playerGoal: '比较升级收益并分配资源', layout: '面板主导 + 局部预览', cta: '确认成长', preview: 'menu' },
  { id: 'economy', label: '经济/商店', focus: '货币、价格、背包切换', playerGoal: '快速比较购买与收益', layout: '货架 + 背包双栏', cta: '购买/出售', preview: 'shop' },
  { id: 'social', label: '社交互动', focus: '聊天、队伍、关系选择', playerGoal: '快速沟通并处理多人上下文', layout: '社交栏 + 对话焦点', cta: '发送/回应', preview: 'dialog' },
  { id: 'results', label: '结算反馈', focus: '结果展示与下一步引导', playerGoal: '理解成绩并进入下一轮', layout: '大结果卡 + 奖励汇总', cta: '继续', preview: 'results' },
]

export const FEATURE_MODULES: FeatureModule[] = [
  { id: 'main-nav', label: '主导航', layer: 'active-menu', category: '基础导航', zone: '顶部', description: '切换地图、背包、社交等核心入口。', aiHint: '适合大厅、主城或重系统场景。' },
  { id: 'minimap', label: '小地图', layer: 'permanent-hud', category: '基础导航', zone: '左上/右上', description: '提供方位、目标与危险区域认知。', aiHint: '开放世界、探索和生存类常驻。' },
  { id: 'quest-tracker', label: '任务追踪', layer: 'context-hud', category: '目标引导', zone: '右侧', description: '显示当前目标、距离与阶段状态。', aiHint: '适合探索、战斗、剧情推进。' },
  { id: 'interaction-hints', label: '交互提示', layer: 'context-hud', category: '目标引导', zone: '底部中心', description: '显示按键提示、可互动物体与环境反馈。', aiHint: '适合新手引导和复杂场景交互。' },
  { id: 'health-status', label: '生命状态', layer: 'permanent-hud', category: '战斗与反馈', zone: '左下', description: '生命、护甲、异常状态等生存信息。', aiHint: '战斗与生存类不可缺失。' },
  { id: 'skill-bar', label: '技能条', layer: 'permanent-hud', category: '战斗与反馈', zone: '底部中心', description: '技能冷却、快捷键与循环节奏反馈。', aiHint: '动作 RPG、MMO、多人战斗常用。' },
  { id: 'weapon-hud', label: '武器面板', layer: 'permanent-hud', category: '战斗与反馈', zone: '右下', description: '当前武器、切换位与姿态信息。', aiHint: '射击或动作武器类适合。' },
  { id: 'ammo-counter', label: '弹药计数', layer: 'permanent-hud', category: '战斗与反馈', zone: '右下', description: '显示弹夹、备弹与补给状态。', aiHint: 'FPS 与枪械驱动界面优先。' },
  { id: 'reticle', label: '准星', layer: 'permanent-hud', category: '战斗与反馈', zone: '视野中心', description: '射击准星与命中反馈指示器。', aiHint: 'FPS 必选模块。' },
  { id: 'scoreboard', label: '比分/圈速', layer: 'context-hud', category: '系统反馈', zone: '顶部', description: '比赛名次、圈速、比分或阶段成绩。', aiHint: '竞速和竞技结果页效果最佳。' },
  { id: 'inventory-grid', label: '背包网格', layer: 'active-menu', category: '成长与资源', zone: '中央面板', description: '物品、装备与资源容量管理。', aiHint: '生存、RPG、经济系统常见。' },
  { id: 'item-detail', label: '道具详情', layer: 'active-menu', category: '成长与资源', zone: '侧栏', description: '道具属性、效果描述与操作入口。', aiHint: '配合背包网格使用，RPG 必需。' },
  { id: 'item-slot', label: '道具格子', layer: 'permanent-hud', category: '成长与资源', zone: '底部', description: '快捷道具槽位，支持拖拽与快捷键。', aiHint: '需要货币或道具系统支撑。' },
  { id: 'character-panel', label: '角色属性面板', layer: 'active-menu', category: '成长与资源', zone: '侧栏', description: '展示等级、属性、天赋和装备总览。', aiHint: '成长驱动界面需要。' },
  { id: 'crafting-panel', label: '制作面板', layer: 'active-menu', category: '世界系统', zone: '主面板', description: '合成配方、材料缺口与制作结果。', aiHint: '生存建造和装备制作类使用。' },
  { id: 'resource-tracker', label: '资源追踪', layer: 'permanent-hud', category: '成长与资源', zone: '顶部', description: '金币、材料、时间或耐久等常驻读数。', aiHint: '经营、竞速、生活模拟适合常驻。' },
  { id: 'currency', label: '货币显示', layer: 'permanent-hud', category: '经济系统', zone: '顶部', description: '当前持有货币与货币变化反馈。', aiHint: '有道具或商店系统时必须存在。' },
  { id: 'map-screen', label: '全屏地图', layer: 'depth-settings', category: '世界系统', zone: '全屏', description: '世界地图、分区标记与路线规划。', aiHint: '开放世界与生存类重要深层页面。' },
  { id: 'shop-panel', label: '商店面板', layer: 'active-menu', category: '经济系统', zone: '主面板', description: '购买、出售、比价与推荐商品。', aiHint: '经济和生活模拟高频。' },
  { id: 'reward-summary', label: '奖励结算', layer: 'depth-settings', category: '系统反馈', zone: '全屏弹层', description: '结果分解、奖励明细与下一步 CTA。', aiHint: '关卡结束或竞速结果页使用。' },
  { id: 'chat-panel', label: '聊天频道', layer: 'context-hud', category: '社交系统', zone: '左下', description: '世界、队伍、公会与系统消息。', aiHint: 'MMO 与社交驱动场景需要。' },
  { id: 'dialog-box', label: '对话框', layer: 'depth-settings', category: '社交系统', zone: '底部', description: 'NPC 对话、选项分支与关系反馈。', aiHint: '剧情、生活模拟、社交流程常用。' },
  { id: 'pause-menu', label: '暂停菜单', layer: 'depth-settings', category: '基础导航', zone: '全屏', description: '暂停、设置、任务与退出入口。', aiHint: '几乎所有游戏都需要标准化存在。' },
  { id: 'settings-panel', label: '设置面板', layer: 'depth-settings', category: '系统反馈', zone: '全屏弹层', description: '显示、音频、控制与辅助功能。', aiHint: '作为深层系统壳使用。' },
  { id: 'modal-dialog', label: '确认弹窗', layer: 'depth-settings', category: '系统反馈', zone: '中心弹层', description: '二次确认、解锁提示与结果中断层。', aiHint: '提供明确的决策中断。' },
  // Puzzle-specific
  { id: 'game-board', label: '游戏棋盘', layer: 'permanent-hud', category: '核心玩法', zone: '中央', description: '解谜/三消核心棋盘或谜题区域。', aiHint: '解谜类必选，优先级最高。' },
  { id: 'score-display', label: '当前得分', layer: 'permanent-hud', category: '核心玩法', zone: '顶部', description: '实时得分与目标得分显示。', aiHint: '三消/解谜类主要目标反馈。' },
  { id: 'level-counter', label: '关卡/步数', layer: 'permanent-hud', category: '核心玩法', zone: '顶部', description: '当前关卡编号或剩余步数/时间。', aiHint: '三消关卡必须可见。' },
  { id: 'step-counter', label: '剩余步数', layer: 'permanent-hud', category: '核心玩法', zone: '顶部', description: '当前关卡剩余操作次数倒计时。', aiHint: '与无限步数模式互斥。' },
  { id: 'endless-mode', label: '无限步数模式', layer: 'permanent-hud', category: '核心玩法', zone: '顶部', description: '无步数限制的轻松模式标识。', aiHint: '与剩余步数互斥。' },
  { id: 'tech-tree', label: '科技树', layer: 'depth-settings', category: '成长与资源', zone: '全屏', description: '复杂的研究与解锁树状结构。', aiHint: '不适合三消/解谜等轻量级玩法，体量不匹配。' },
  { id: 'level-select', label: '关卡选择', layer: 'active-menu', category: '基础导航', zone: '全屏', description: '展示关卡地图或章节列表，支持星级评分。', aiHint: '三消、塔防等章节制游戏适用。' },
  // FPS-specific
  { id: 'weapon-select', label: '武器选择', layer: 'active-menu', category: '战斗与反馈', zone: '全屏', description: '开局武器套装选择界面。', aiHint: 'FPS 与战斗类开局阶段。' },
]

// ─── Step 2 layout modules → Step 3 component generation ─────────────────────

export type ModuleAssetRole =
  | 'button-base'
  | 'tab'
  | 'modal-panel'
  | 'card'
  | 'panel'
  | 'list-row'
  | 'bar'
  | 'counter'
  | 'icon'
  | 'notification'

export interface ModuleAssetSpec {
  id: string
  label: string
  category: string
  layer: string
  zone: string
  description: string
  aiHint: string
  assetRoles: ModuleAssetRole[]
}

export interface ComponentLibraryStep {
  kind: AssetKindId
  label: string
}

/** 第二步布局模块与第三步 8 类风格板组件的关联 */
export const SECTION_FEATURE_HINTS: Record<StyleBoardSection['id'], string[]> = {
  buttons: ['main-nav', 'pause-menu', 'modal-dialog', 'dialog-box', 'level-select', 'settings-panel', 'weapon-select'],
  tabs: ['main-nav', 'pause-menu', 'level-select', 'weapon-select', 'shop-panel', 'character-panel', 'inventory-grid'],
  panels: ['shop-panel', 'inventory-grid', 'settings-panel', 'character-panel', 'crafting-panel', 'map-screen', 'pause-menu', 'modal-dialog', 'dialog-box', 'reward-summary', 'item-detail', 'tech-tree', 'level-select', 'weapon-select'],
  bars: ['health-status', 'skill-bar', 'ammo-counter', 'resource-tracker', 'score-display', 'level-counter', 'step-counter', 'endless-mode'],
  icons: ['weapon-hud', 'ammo-counter', 'item-slot', 'currency', 'map-screen', 'game-board', 'shop-panel', 'minimap', 'reticle', 'interaction-hints', 'resource-tracker'],
  cards: ['reward-summary', 'character-panel', 'item-detail', 'inventory-grid', 'tech-tree', 'level-select', 'shop-panel', 'crafting-panel'],
  lists: ['quest-tracker', 'shop-panel', 'chat-panel', 'inventory-grid', 'level-select', 'scoreboard', 'weapon-select', 'tech-tree'],
  notifications: ['interaction-hints', 'modal-dialog', 'chat-panel', 'dialog-box', 'pause-menu', 'reward-summary', 'quest-tracker'],
}

const MODULE_ASSET_ROLE_OVERRIDES: Partial<Record<string, ModuleAssetRole[]>> = {
  'main-nav': ['button-base', 'tab', 'icon'],
  'pause-menu': ['button-base', 'panel', 'modal-panel'],
  'settings-panel': ['panel', 'button-base', 'list-row'],
  'modal-dialog': ['modal-panel', 'button-base', 'notification'],
  'dialog-box': ['panel', 'button-base', 'notification'],
  'shop-panel': ['card', 'panel', 'list-row', 'button-base', 'icon'],
  'inventory-grid': ['card', 'panel', 'list-row', 'icon'],
  'item-detail': ['card', 'panel'],
  'character-panel': ['card', 'panel', 'list-row'],
  'crafting-panel': ['card', 'panel', 'list-row'],
  'level-select': ['card', 'button-base', 'list-row'],
  'weapon-select': ['card', 'list-row', 'icon'],
  'tech-tree': ['card', 'panel', 'list-row'],
  'health-status': ['bar', 'counter'],
  'skill-bar': ['bar', 'icon'],
  'ammo-counter': ['counter', 'icon', 'bar'],
  'resource-tracker': ['bar', 'counter', 'icon'],
  'score-display': ['counter', 'bar'],
  'level-counter': ['counter'],
  'step-counter': ['counter'],
  'endless-mode': ['counter'],
  'reward-summary': ['card', 'panel', 'notification', 'list-row'],
  'quest-tracker': ['list-row', 'notification'],
  'chat-panel': ['list-row', 'panel', 'notification'],
  'scoreboard': ['list-row', 'bar'],
  'minimap': ['icon', 'panel'],
  'map-screen': ['panel', 'icon'],
  'game-board': ['panel'],
  'currency': ['icon', 'counter'],
  'item-slot': ['icon', 'card'],
  'weapon-hud': ['icon', 'panel'],
  'reticle': ['icon'],
  'interaction-hints': ['notification', 'icon'],
}

const CATEGORY_ASSET_ROLE_FALLBACK: Array<{ match: (category: string) => boolean; roles: ModuleAssetRole[] }> = [
  { match: category => category.includes('经济'), roles: ['icon', 'counter', 'card'] },
  { match: category => category.includes('成长'), roles: ['icon', 'card', 'bar'] },
  { match: category => category.includes('核心'), roles: ['panel', 'counter', 'icon'] },
  { match: category => category.includes('战斗'), roles: ['icon', 'bar', 'counter'] },
  { match: category => category.includes('社交'), roles: ['panel', 'notification', 'list-row'] },
  { match: category => category.includes('世界'), roles: ['panel', 'list-row'] },
  { match: category => category.includes('基础'), roles: ['button-base', 'tab'] },
  { match: category => category.includes('目标'), roles: ['list-row', 'notification', 'icon'] },
  { match: category => category.includes('系统'), roles: ['notification', 'panel', 'list-row'] },
]

export function assetRolesForFeature(id: string, category: string): ModuleAssetRole[] {
  const explicit = MODULE_ASSET_ROLE_OVERRIDES[id]
  if (explicit?.length) return [...explicit]
  const roles = new Set<ModuleAssetRole>()
  for (const rule of CATEGORY_ASSET_ROLE_FALLBACK) {
    if (rule.match(category)) rule.roles.forEach(role => roles.add(role))
  }
  if (roles.size === 0) roles.add('panel')
  return [...roles]
}

export function confirmedLayoutFeatureIds(
  genre: GenrePresetId,
  selectedFeatures: string[],
): Set<string> {
  const ids = new Set(selectedFeatures)
  getScreenFlow(genre).forEach(screen => {
    getScreenModules(genre, screen.kind).required.forEach(module => ids.add(module.id))
  })
  return ids
}

export function buildModuleAssetSpecs(
  genre: GenrePresetId,
  selectedFeatures: string[],
): ModuleAssetSpec[] {
  const selected = confirmedLayoutFeatureIds(genre, selectedFeatures)
  return FEATURE_MODULES
    .filter(module => selected.has(module.id))
    .map(module => ({
      id: module.id,
      label: module.label,
      category: module.category,
      layer: module.layer,
      zone: module.zone,
      description: module.description,
      aiHint: module.aiHint,
      assetRoles: assetRolesForFeature(module.id, module.category),
    }))
}

export function getActiveStyleBoardSectionIds(
  genre: GenrePresetId,
  selectedFeatures: string[],
): StyleBoardSection['id'][] {
  const selected = confirmedLayoutFeatureIds(genre, selectedFeatures)
  return (Object.keys(SECTION_FEATURE_HINTS) as StyleBoardSection['id'][])
    .filter(sectionId => SECTION_FEATURE_HINTS[sectionId].some(id => selected.has(id)))
}

export {
  activeIconModuleSpecs,
  collectIconModuleSpecs,
  iconLabelsFromModuleSpecs,
  iconSlotDescriptorsFromModuleSpecs,
  iconSlotIndexForModuleId,
  moduleNeedsFunctionalIcon,
  resolveIconSlotCount,
} from './icon-semantics'

const DEFAULT_COMPONENT_LIBRARY_STEPS: ComponentLibraryStep[] = [
  { kind: 'buttonPrimary', label: '主按钮' },
  { kind: 'buttonNormal', label: '次按钮' },
  { kind: 'titleDeco', label: '标题条' },
  { kind: 'panelTexture', label: '面板纹理' },
  { kind: 'icons', label: '图标组' },
]

function specsNeedButtons(specs: ModuleAssetSpec[]): boolean {
  return specs.some(spec => spec.assetRoles.some(role => role === 'button-base' || role === 'tab'))
}

function specsNeedPanels(specs: ModuleAssetSpec[]): boolean {
  return specs.some(spec => spec.assetRoles.some(role => (
    role === 'panel' || role === 'card' || role === 'modal-panel' || role === 'list-row' || role === 'bar'
  )))
}

function specsNeedIcons(specs: ModuleAssetSpec[]): boolean {
  return iconLabelsFromModuleSpecs(specs).length > 0
}

export function buildComponentLibrarySteps(
  genre: GenrePresetId,
  selectedFeatures: string[],
): ComponentLibraryStep[] {
  const specs = buildModuleAssetSpecs(genre, selectedFeatures)
  if (specs.length === 0) return [...DEFAULT_COMPONENT_LIBRARY_STEPS]

  const steps: ComponentLibraryStep[] = []
  const buttonModules = specs
    .filter(spec => spec.assetRoles.includes('button-base') || spec.assetRoles.includes('tab'))
    .map(spec => spec.label)
    .slice(0, 3)
  const panelModules = specs
    .filter(spec => spec.assetRoles.some(role => role === 'panel' || role === 'card' || role === 'modal-panel' || role === 'list-row' || role === 'bar'))
    .map(spec => spec.label)
    .slice(0, 4)
  const iconLabels = iconLabelsFromModuleSpecs(specs)

  if (specsNeedButtons(specs)) {
    const hint = buttonModules.length > 0 ? `（${buttonModules.join('、')}）` : ''
    steps.push({ kind: 'buttonPrimary', label: `主按钮${hint}` })
    steps.push({ kind: 'buttonNormal', label: `次按钮${hint}` })
  }
  if (specsNeedPanels(specs)) {
    const hint = panelModules.length > 0 ? `（${panelModules.slice(0, 2).join('、')}）` : ''
    steps.push({ kind: 'titleDeco', label: `标题条${hint}` })
    steps.push({ kind: 'panelTexture', label: `面板纹理${hint}` })
  }
  if (specsNeedIcons(specs)) {
    const count = resolveIconSlotCount(specs)
    const hint = iconLabels.length > 0 ? `（${iconLabels.slice(0, 3).join('、')}）` : ''
    steps.push({ kind: 'icons', label: `功能图标 ${count} 个${hint}` })
  }

  return steps.length > 0 ? steps : [...DEFAULT_COMPONENT_LIBRARY_STEPS]
}

export function resolveStyleBoardSectionsForLayout(
  genre: GenrePresetId,
  selectedFeatures: string[],
): StyleBoardSection[] {
  const selected = confirmedLayoutFeatureIds(genre, selectedFeatures)
  const labelFor = (id: string): string => FEATURE_MAP.get(id)?.label ?? id
  return getStyleBoardSections(genre).filter(section => {
    if (section.id === 'buttons' || section.id === 'panels' || section.id === 'icons') return false
    return SECTION_FEATURE_HINTS[section.id].some(id => selected.has(id))
  }).map(section => {
    const moduleIds = SECTION_FEATURE_HINTS[section.id].filter(id => selected.has(id))
    const items = moduleIds.map(labelFor)
    return { ...section, items, moduleIds }
  })
}

// ─── PC Layout Rules (PDF Step 4) ─────────────────────────────────────────────
export const PC_LAYOUT_RULES: PCLayoutRules = {
  designWidth: 1920,
  designHeight: 1080,
  minWidth: 1280,
  minHeight: 720,
  safeMargin: 24,
  importantMargin: 40,
  minClickTarget: 32,
  freqClickTarget: 48,
  maxTopbarHeight: 64,
  maxBottombarHeight: 80,
  sidebarMinWidth: 240,
  sidebarMaxWidth: 320,
}

// ─── Style Recommendations (PDF Step 3) ──────────────────────────────────────
export const STYLE_RECOMMENDATIONS: Record<GenrePresetId, StyleRecommendation[]> = {
  'open-world': [
    { id: 'modern-dark', label: '现代暗色', reason: '开放世界 HUD 信息密集，暗色基底降低干扰' },
    { id: 'realistic-military', label: '写实军事', reason: '犯罪/战争题材开放世界吻合' },
    { id: 'sci-fi', label: '科幻未来', reason: '科幻开放世界具有沉浸感' },
  ],
  'action-rpg': [
    { id: 'fantasy', label: '幻想史诗', reason: '剑与魔法题材的主流风格' },
    { id: 'modern-minimal', label: '极简现代', reason: '现代/克苏鲁 RPG 清爽选择' },
    { id: 'anime', label: '二次元战斗', reason: '日式动作 RPG 强匹配' },
  ],
  fps: [
    { id: 'sci-fi', label: '科幻未来', reason: '未来射击常用霓虹 HUD' },
    { id: 'realistic-military', label: '写实军事', reason: '战术射击写实风格契合' },
    { id: 'modern-dark', label: '现代暗色', reason: '通用现代射击底色' },
  ],
  survival: [
    { id: 'realistic-military', label: '写实军事', reason: '野外/末日生存哑光质感' },
    { id: 'pixel', label: '像素街机', reason: '独立生存像素风常见' },
    { id: 'modern-dark', label: '现代暗色', reason: '3D 生存类通用底色' },
  ],
  mmo: [
    { id: 'fantasy', label: '幻想史诗', reason: '传统 MMO 主流风格' },
    { id: 'sci-fi', label: '科幻未来', reason: '科幻 MMO 强匹配' },
    { id: 'modern-dark', label: '现代暗色', reason: '现代 MMO 简洁选择' },
  ],
  'life-sim': [
    { id: 'cute-cartoon', label: '可爱卡通', reason: '生活模拟类玩家受众高度匹配' },
    { id: 'fresh-pastoral', label: '清新田园', reason: '农场/小镇题材自然匹配' },
    { id: 'modern-minimal', label: '极简现代', reason: '都市生活模拟极简风格' },
  ],
  racing: [
    { id: 'sci-fi', label: '科幻未来', reason: '未来赛车速度感强' },
    { id: 'realistic-military', label: '写实军事', reason: '拟真赛车仪表盘风格' },
    { id: 'modern-dark', label: '现代暗色', reason: '街头竞速暗色UI' },
  ],
  puzzle: [
    { id: 'cute-cartoon', label: '可爱卡通', reason: '三消/解谜用户群最契合' },
    { id: 'fresh-pastoral', label: '清新田园', reason: '清新风格降低视觉疲劳' },
    { id: 'pixel', label: '像素街机', reason: '像素解谜独立风格' },
  ],
}

// ─── Screen Flows (PDF Step 1) ─────────────────────────────────────────────────
const SCREEN_FLOWS: Record<GenrePresetId, ScreenFlow> = {
  'open-world': [
    { kind: 'start', label: '开始界面' },
    { kind: 'hud', label: '游玩 HUD', isPreviewable: true },
    { kind: 'bag', label: '背包/道具', isPreviewable: true },
    { kind: 'dialog', label: 'NPC 对话' },
    { kind: 'character', label: '角色属性' },
    { kind: 'pause', label: '暂停菜单' },
    { kind: 'map', label: '全屏地图' },
    { kind: 'results', label: '任务结算', isPreviewable: true },
  ],
  'action-rpg': [
    { kind: 'start', label: '开始界面' },
    { kind: 'hud', label: '战斗 HUD', isPreviewable: true },
    { kind: 'pause', label: '暂停菜单' },
    { kind: 'bag', label: '背包/道具', isPreviewable: true },
    { kind: 'dialog', label: '剧情对话' },
    { kind: 'character', label: '角色属性' },
    { kind: 'results', label: '战斗结算', isPreviewable: true },
  ],
  fps: [
    { kind: 'start', label: '开始界面' },
    { kind: 'weapon-select', label: '武器选择' },
    { kind: 'hud', label: '射击 HUD', isPreviewable: true },
    { kind: 'map', label: '战术地图' },
    { kind: 'dialog', label: '简报/对话' },
    { kind: 'pause', label: '暂停菜单' },
    { kind: 'results', label: '对局结算', isPreviewable: true },
  ],
  survival: [
    { kind: 'start', label: '开始界面' },
    { kind: 'hud', label: '生存 HUD', isPreviewable: true },
    { kind: 'bag', label: '背包/制作', isPreviewable: true },
    { kind: 'character', label: '角色属性' },
    { kind: 'shop', label: '商人/交易' },
    { kind: 'map', label: '世界地图' },
    { kind: 'pause', label: '暂停菜单' },
    { kind: 'results', label: '结算/死亡', isPreviewable: true },
  ],
  mmo: [
    { kind: 'start', label: '登录/选角' },
    { kind: 'hud', label: '游玩 HUD', isPreviewable: true },
    { kind: 'bag', label: '背包/装备', isPreviewable: true },
    { kind: 'dialog', label: '社交/剧情' },
    { kind: 'character', label: '角色属性' },
    { kind: 'shop', label: '商店/拍卖' },
    { kind: 'map', label: '世界地图' },
    { kind: 'pause', label: '暂停菜单' },
    { kind: 'results', label: '副本结算', isPreviewable: true },
  ],
  'life-sim': [
    { kind: 'start', label: '开始界面' },
    { kind: 'hud', label: '生活 HUD', isPreviewable: true },
    { kind: 'dialog', label: 'NPC 对话' },
    { kind: 'bag', label: '背包/道具' },
    { kind: 'map', label: '地图/传送' },
    { kind: 'shop', label: '商店界面' },
    { kind: 'pause', label: '暂停菜单' },
    { kind: 'results', label: '日结算', isPreviewable: true },
  ],
  racing: [
    { kind: 'start', label: '开始/车库' },
    { kind: 'level-select', label: '赛道选择' },
    { kind: 'hud', label: '竞速 HUD', isPreviewable: true },
    { kind: 'pause', label: '暂停菜单' },
    { kind: 'results', label: '比赛结算', isPreviewable: true },
  ],
  puzzle: [
    { kind: 'start', label: '开始界面' },
    { kind: 'level-select', label: '关卡选择', isPreviewable: true },
    { kind: 'hud', label: '游玩 HUD', isPreviewable: true },
    { kind: 'dialog', label: '剧情/提示' },
    { kind: 'results', label: '关卡结算', isPreviewable: true },
    { kind: 'end', label: '结束界面', isPreviewable: true },
  ],
}

// ─── Screen Module Rules (对齐 character-editor-ui-design-module SKILL.md 屏幕矩阵) ─
type ScreenModuleRule = {
  required: string[]
  recommended: string[]
  optional: string[]
}

/** 通用 screen：某类型未单独写 start/pause/results/end 时复用（Skill「通用 screen 规则」） */
const COMMON_SCREEN_RULES: Partial<Record<ScreenKind, ScreenModuleRule>> = {
  start: {
    required: ['main-nav'],
    recommended: ['settings-panel', 'modal-dialog'],
    optional: [],
  },
  pause: {
    required: ['pause-menu'],
    recommended: ['settings-panel', 'modal-dialog'],
    optional: [],
  },
  results: {
    required: ['reward-summary'],
    recommended: ['level-counter', 'score-display'],
    optional: ['main-nav'],
  },
  end: {
    required: ['reward-summary'],
    recommended: ['level-counter', 'main-nav'],
    optional: [],
  },
}

/**
 * 仅列出与 COMMON 不同、或非通用的界面；查询顺序：
 * SCREEN_MODULE_RULES[genre][screen] ?? COMMON_SCREEN_RULES[screen] ?? 空
 */
const SCREEN_MODULE_RULES: Record<GenrePresetId, Partial<Record<ScreenKind, ScreenModuleRule>>> = {
  'open-world': {
    hud: {
      required: ['health-status', 'minimap', 'quest-tracker', 'interaction-hints', 'skill-bar'],
      recommended: ['resource-tracker', 'currency'],
      optional: ['scoreboard', 'chat-panel', 'level-select', 'reward-summary'],
    },
    map: {
      required: ['map-screen'],
      recommended: ['quest-tracker', 'minimap'],
      optional: ['main-nav'],
    },
    dialog: {
      required: ['dialog-box'],
      recommended: ['interaction-hints', 'quest-tracker'],
      optional: [],
    },
    bag: {
      required: ['inventory-grid', 'item-detail'],
      recommended: ['resource-tracker', 'currency'],
      optional: ['crafting-panel'],
    },
    character: {
      required: ['character-panel'],
      recommended: ['item-detail'],
      optional: ['reward-summary'],
    },
  },
  'action-rpg': {
    hud: {
      required: ['health-status', 'skill-bar', 'quest-tracker'],
      recommended: ['resource-tracker', 'interaction-hints', 'weapon-hud', 'minimap'],
      optional: ['chat-panel', 'shop-panel'],
    },
    bag: {
      required: ['inventory-grid', 'item-detail'],
      recommended: ['currency', 'resource-tracker'],
      optional: [],
    },
    character: {
      required: ['character-panel'],
      recommended: ['item-detail'],
      optional: ['reward-summary'],
    },
    dialog: {
      required: ['dialog-box'],
      recommended: ['interaction-hints', 'quest-tracker'],
      optional: [],
    },
    results: {
      required: ['reward-summary'],
      recommended: ['level-counter', 'scoreboard'],
      optional: ['main-nav'],
    },
  },
  fps: {
    hud: {
      required: ['reticle', 'ammo-counter', 'health-status', 'weapon-hud', 'minimap'],
      recommended: ['scoreboard', 'interaction-hints'],
      optional: ['chat-panel', 'reward-summary', 'quest-tracker'],
    },
    'weapon-select': {
      required: ['weapon-select'],
      recommended: ['weapon-hud', 'ammo-counter'],
      optional: ['main-nav'],
    },
    map: {
      required: ['map-screen'],
      recommended: ['quest-tracker'],
      optional: ['minimap'],
    },
    dialog: {
      required: ['dialog-box'],
      recommended: ['quest-tracker'],
      optional: ['interaction-hints'],
    },
    results: {
      required: ['reward-summary', 'scoreboard'],
      recommended: ['level-counter'],
      optional: ['main-nav'],
    },
  },
  survival: {
    hud: {
      required: ['health-status', 'resource-tracker', 'interaction-hints', 'item-slot'],
      recommended: ['minimap', 'quest-tracker'],
      optional: ['weapon-hud', 'ammo-counter', 'crafting-panel'],
    },
    bag: {
      required: ['inventory-grid', 'item-detail'],
      recommended: ['resource-tracker'],
      optional: ['crafting-panel'],
    },
    character: {
      required: ['character-panel'],
      recommended: ['inventory-grid'],
      optional: ['item-detail'],
    },
    shop: {
      required: ['shop-panel'],
      recommended: ['currency', 'item-detail'],
      optional: ['inventory-grid'],
    },
    map: {
      required: ['map-screen'],
      recommended: ['minimap'],
      optional: ['quest-tracker'],
    },
  },
  mmo: {
    hud: {
      required: ['health-status', 'skill-bar', 'chat-panel', 'quest-tracker', 'minimap'],
      recommended: ['character-panel', 'scoreboard'],
      optional: ['shop-panel', 'map-screen', 'reward-summary', 'resource-tracker'],
    },
    bag: {
      required: ['inventory-grid', 'item-detail'],
      recommended: ['currency'],
      optional: ['crafting-panel', 'shop-panel'],
    },
    character: {
      required: ['character-panel'],
      recommended: ['resource-tracker', 'inventory-grid'],
      optional: ['item-detail'],
    },
    dialog: {
      required: ['chat-panel', 'dialog-box'],
      recommended: ['quest-tracker'],
      optional: ['interaction-hints'],
    },
    shop: {
      required: ['shop-panel'],
      recommended: ['currency', 'item-detail'],
      optional: ['inventory-grid'],
    },
    map: {
      required: ['map-screen'],
      recommended: ['quest-tracker', 'minimap'],
      optional: [],
    },
    results: {
      required: ['reward-summary', 'scoreboard'],
      recommended: ['level-counter'],
      optional: ['main-nav'],
    },
  },
  'life-sim': {
    hud: {
      required: ['resource-tracker', 'currency', 'item-slot'],
      recommended: ['interaction-hints'],
      optional: ['minimap', 'quest-tracker', 'main-nav'],
    },
    dialog: {
      required: ['dialog-box'],
      recommended: ['resource-tracker'],
      optional: ['quest-tracker'],
    },
    bag: {
      required: ['inventory-grid', 'item-detail'],
      recommended: ['currency'],
      optional: ['resource-tracker'],
    },
    map: {
      required: ['map-screen'],
      recommended: ['level-select', 'quest-tracker'],
      optional: ['main-nav'],
    },
    shop: {
      required: ['shop-panel'],
      recommended: ['currency'],
      optional: ['inventory-grid', 'item-detail'],
    },
  },
  racing: {
    hud: {
      required: ['scoreboard', 'level-counter', 'minimap', 'resource-tracker'],
      recommended: ['interaction-hints'],
      optional: ['chat-panel', 'map-screen', 'weapon-select'],
    },
    'level-select': {
      required: ['level-select'],
      recommended: ['reward-summary'],
      optional: ['main-nav'],
    },
    results: {
      required: ['reward-summary', 'scoreboard'],
      recommended: ['level-counter'],
      optional: ['main-nav'],
    },
  },
  puzzle: {
    hud: {
      required: ['game-board', 'score-display', 'level-counter', 'step-counter', 'item-slot'],
      recommended: ['interaction-hints'],
      optional: ['endless-mode', 'reward-summary', 'pause-menu'],
    },
    'level-select': {
      required: ['level-select'],
      recommended: ['reward-summary'],
      optional: ['main-nav', 'resource-tracker'],
    },
    dialog: {
      required: ['dialog-box'],
      recommended: ['interaction-hints'],
      optional: [],
    },
    results: {
      required: ['reward-summary', 'score-display'],
      recommended: ['level-counter'],
      optional: ['main-nav'],
    },
  },
}

// ─── Conflict Rules ───────────────────────────────────────────────────────────
/** Pairs of feature IDs that cannot coexist */
const MUTUAL_EXCLUSIVE_PAIRS: [string, string][] = [
  ['step-counter', 'endless-mode'],
]

/** feature -> genres where it causes a scope mismatch */
const SCOPE_MISMATCH_RULES: Record<string, GenrePresetId[]> = {
  'tech-tree': ['puzzle', 'racing', 'fps'],
  'character-panel': ['racing', 'puzzle'],
}

/** feature -> required companion features */
const DEPENDENCY_RULES: Record<string, string[]> = {
  'item-slot': ['currency'],
  'shop-panel': ['currency'],
  'crafting-panel': ['inventory-grid'],
}

/** Styles that are inappropriate for certain genres */
const STYLE_MISMATCH_RULES: Partial<Record<GenrePresetId, StylePresetId[]>> = {
  puzzle: ['realistic-military', 'sci-fi'],
  'life-sim': ['realistic-military'],
  racing: ['cute-cartoon', 'fresh-pastoral'],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const GENRE_MAP = new Map(GENRE_PRESETS.map(item => [item.id, item]))
const STYLE_MAP = new Map(STYLE_PRESETS.map(item => [item.id, item]))
const STAGE_MAP = new Map(STAGE_PRESETS.map(item => [item.id, item]))
const FEATURE_MAP = new Map(FEATURE_MODULES.map(item => [item.id, item]))

const DEFAULT_STATE: UIDesignState = {
  genrePreset: 'open-world',
  workflowStep: 'genre',
  customGameType: '',
  style: 'modern-dark',
  stage: 'exploration',
  platform: 'pc',
  previewDevice: 'pc',
  previewMode: 'hud',
  parameterTab: 'style',
  themeMode: 'dark',
  fontFlavor: 'modern',
  uiSurface: 'glass',
  cornerRadius: 16,
  surfaceTransparency: 0.72,
  hudScale: 1,
  immersion: 0.68,
  minimapPosition: '左上',
  healthPosition: '左下',
  density: 'balanced',
  selectedFeatures: ['minimap', 'quest-tracker', 'interaction-hints', 'resource-tracker', 'pause-menu'],
  keywords: '',
  notes: '',
  sceneDesc: '',
  styleBoardPrompt: '',
  assetPromptNotes: '',
  layoutApproved: false,
  styleBoardApproved: false,
  confirmedStylePackId: '',
  assetHistory: [],
  lockedAssetKinds: [],
  compareHistoryPackId: '',
}

const STAGE_ESSENTIALS: Record<StagePresetId, string[]> = {
  entry: ['main-nav', 'modal-dialog'],
  hub: ['main-nav', 'resource-tracker', 'character-panel'],
  exploration: ['minimap', 'quest-tracker', 'interaction-hints'],
  combat: ['health-status', 'skill-bar', 'quest-tracker'],
  progression: ['character-panel', 'inventory-grid', 'reward-summary'],
  economy: ['shop-panel', 'resource-tracker', 'inventory-grid'],
  social: ['chat-panel', 'dialog-box', 'main-nav'],
  results: ['reward-summary', 'scoreboard', 'main-nav'],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback
}

function pickNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(id => FEATURE_MAP.has(id)))]
}

function makePriorityModule(id: string, priority: ModulePriority): PriorityModule {
  const module = FEATURE_MAP.get(id)
  return {
    id,
    label: module?.label ?? id,
    priority,
    isRequired: priority === 'required',
    defaultOn: priority !== 'optional',
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function createDefaultState(): UIDesignState {
  const next: UIDesignState = {
    ...DEFAULT_STATE,
    selectedFeatures: [...DEFAULT_STATE.selectedFeatures],
    assetHistory: [...DEFAULT_STATE.assetHistory],
  }
  next.styleBoardPrompt = defaultStyleBoardPrompt(next)
  return next
}

export function stageEssentialFeatures(stage: StagePresetId): string[] {
  return [...(STAGE_ESSENTIALS[stage] ?? [])]
}

export function recommendedFeatures(state: UIDesignState): string[] {
  const genre = GENRE_MAP.get(state.genrePreset) ?? GENRE_PRESETS[0]
  return uniqueIds([...genre.recommendedFeatures, ...stageEssentialFeatures(state.stage), 'pause-menu'])
}

/** PDF Step 1 — ordered screen flow for a given genre */
export function getScreenFlow(genre: GenrePresetId): ScreenFlow {
  return SCREEN_FLOWS[genre] ?? SCREEN_FLOWS['open-world']
}

/** PDF Step 2 — module priority set（Skill 屏幕矩阵 + 通用 start/pause/results/end 回退） */
export function getScreenModules(genre: GenrePresetId, screen: ScreenKind): ScreenModuleSet {
  const rule =
    SCREEN_MODULE_RULES[genre]?.[screen]
    ?? COMMON_SCREEN_RULES[screen]
    ?? { required: [], recommended: [], optional: [] }
  return {
    required: rule.required.map(id => makePriorityModule(id, 'required')),
    recommended: rule.recommended.map(id => makePriorityModule(id, 'recommended')),
    optional: rule.optional.map(id => makePriorityModule(id, 'optional')),
  }
}

/**
 * 布局验证 Skill：当前屏「必选 ∪ 推荐」，不含可选模块。
 * 可选模块仅在用户点选并入 `selectedFeatures` 后才参与预览。
 */
export function getScreenBaselineFeatureIds(genre: GenrePresetId, screen: ScreenKind): string[] {
  const rule = SCREEN_MODULE_RULES[genre]?.[screen]
  if (!rule) return []
  return uniqueIds([...rule.required, ...rule.recommended])
}

/** 将当前屏基线并入 selection（幂等合并，用于第二步首次进入某屏时补齐推荐模块） */
export function mergeScreenBaselineIntoSelection(
  genre: GenrePresetId,
  screen: ScreenKind,
  selectedFeatures: string[],
): string[] {
  const baseline = getScreenBaselineFeatureIds(genre, screen)
  return uniqueIds([...selectedFeatures, ...baseline])
}

/** PDF Step 3 — 2-3 recommended styles for a given genre */
export function recommendedStyles(genre: GenrePresetId): StyleRecommendation[] {
  return STYLE_RECOMMENDATIONS[genre] ?? []
}

const STYLE_BOARD_BASE: StyleBoardSection[] = [
  {
    id: 'buttons',
    label: '按钮',
    description: '主按钮、次按钮、危险按钮、禁用态、CTA 按钮的整套风格语言。',
    items: ['主按钮', '次按钮', '危险按钮', '禁用按钮', '确认按钮'],
  },
  {
    id: 'tabs',
    label: '标签与分段',
    description: '页签、筛选、分段控件、分页等切换类组件。',
    items: ['普通标签', '选中标签', '分段切换', '分页器'],
  },
  {
    id: 'panels',
    label: '面板与弹窗',
    description: '大中小面板、标题栏、弹窗、底框纹理等主要骨架资产。',
    items: ['大型面板', '中型面板', '小型弹窗', '标题条', '底框纹理'],
  },
  {
    id: 'bars',
    label: '条类状态',
    description: '资源条、进度条、血条、经验条、任务进度等读数系统。',
    items: ['资源条', '进度条', '状态条', '经验条'],
  },
  {
    id: 'icons',
    label: '图标体系',
    description: '导航、功能、货币、道具、技能等功能 icon 家族。',
    items: ['导航图标', '功能图标', '货币图标', '道具图标'],
  },
  {
    id: 'cards',
    label: '卡片与横幅',
    description: '角色卡、奖励卡、活动横幅、商品卡等信息承载组件。',
    items: ['角色卡', '奖励卡', '商城卡', '活动横幅'],
  },
  {
    id: 'lists',
    label: '列表与分页',
    description: '任务列表、商店列表、排行列表、筛选和分页组件。',
    items: ['任务列表', '商城列表', '排行榜', '排序与筛选'],
  },
  {
    id: 'notifications',
    label: '提示与反馈',
    description: 'Toast、提示框、徽章、角标、通知卡与状态反馈。',
    items: ['通知条', '提示框', '徽章角标', '状态反馈'],
  },
]

const GENRE_STYLE_BOARD_OVERRIDES: Partial<Record<GenrePresetId, Partial<Record<StyleBoardSection['id'], string[]>>>> = {
  'open-world': {
    tabs: ['地图页签', '任务筛选', '探索分段', '区域分页'],
    bars: ['生命状态', '耐力条', '任务进度', '声望经验'],
    lists: ['任务追踪', '探索清单', '资源列表', '地区筛选'],
    notifications: ['发现提示', '交互提示', '探索徽章', '状态反馈'],
  },
  fps: {
    tabs: ['武器页签', '战术筛选', '火力分段', '小队分页'],
    bars: ['弹药条', '血量条', '护甲条', '命中反馈'],
    icons: ['武器图标', '危险提示', '导航图标', '道具图标'],
    lists: ['任务目标', '武器列表', '小队排行', '战术筛选'],
    notifications: ['危险警报', '交互提示', '击杀徽章', '受击反馈'],
  },
  'action-rpg': {
    tabs: ['装备页签', '技能筛选', '成长分段', '背包分页'],
    bars: ['血量条', '法力条', '冷却条', '经验条'],
    cards: ['装备卡', '技能卡', '奖励卡', 'Boss 横幅'],
    lists: ['任务追踪', '背包装备', '技能排行', '属性筛选'],
    notifications: ['拾取提示', '对话框', '稀有徽章', '技能反馈'],
  },
  survival: {
    tabs: ['物资页签', '状态筛选', '制作分段', '营地分页'],
    bars: ['生命状态', '饥饿值', '耐久条', '制作进度'],
    lists: ['物资清单', '制作队列', '威胁列表', '资源筛选'],
    notifications: ['生存警报', '交互提示', '风险徽章', '环境反馈'],
  },
  mmo: {
    tabs: ['队伍页签', '职业筛选', '副本分段', '公会分页'],
    bars: ['生命状态', '法力条', '仇恨条', '经验条'],
    lists: ['任务列表', '队伍列表', '副本排行', '职业筛选'],
    notifications: ['团队提示', '对话框', '公会徽章', '施法反馈'],
  },
  'life-sim': {
    tabs: ['生活页签', '关系筛选', '日程分段', '房间分页'],
    bars: ['心情条', '体力条', '关系进度', '日程进度'],
    lists: ['日程列表', '商店列表', '好友排行', '生活筛选'],
    notifications: ['日程提示', '对话框', '好感徽章', '心情反馈'],
  },
  puzzle: {
    tabs: ['关卡页签', '目标筛选', '活动分段', '章节分页'],
    bars: ['得分条', '步数条', '目标进度', '连击反馈'],
    cards: ['关卡卡片', '奖励卡', '道具卡', '目标条'],
    lists: ['关卡目标', '道具列表', '星级排行', '难度筛选'],
    notifications: ['连击提示', '提示框', '星级徽章', '目标反馈'],
  },
  racing: {
    tabs: ['赛事页签', '车辆筛选', '赛段分段', '车库分页'],
    bars: ['速度条', '名次条', '圈速条', '氮气条'],
    icons: ['路线提示', '速度提示', '奖杯图标', '道具图标'],
    lists: ['赛道列表', '车辆列表', '圈速排行', '赛事筛选'],
    notifications: ['超车提示', '维修提示', '奖杯徽章', '氮气反馈'],
  },
}

const DEFAULT_COMPONENT_KIT: GenreComponentKit = {
  genre: 'open-world',
  className: 'uid-genre-open-world',
  tokens: {
    accent: '#f6b04c',
    danger: '#ff5d5d',
    success: '#79d67b',
    surface: 'exploration parchment glass',
    shape: 'soft rectangular panels with map-pin corners',
    density: 'balanced',
    feedbackTone: '探索发现、交互距离、任务推进',
    iconMetaphor: '罗盘、地图钉、背包、卷轴',
  },
  promptGuidance: [
    'Open-world components must feel like exploration tools: map pins, quest trail, compass, stamina, discovery feedback.',
    'Use medium-density panels, readable travel objectives, and warm discovery accents rather than generic web tabs.',
  ],
  tabs: {
    primary: ['地图', '任务', '背包'],
    activeIndex: 1,
    filters: ['区域', '可追踪', '未完成'],
    segment: ['探索', '进行中', '已完成'],
    pagerLabel: '地区分页',
  },
  bars: [
    { label: '生命状态', value: 78, tone: 'success', meta: 'HP' },
    { label: '耐力条', value: 64, tone: 'energy', meta: 'STA' },
    { label: '任务进度', value: 46, tone: 'primary', meta: 'QUEST' },
  ],
  lists: [
    { icon: '◇', label: '任务追踪', meta: '740m · 北方遗迹', status: '追踪中' },
    { icon: '⌖', label: '探索清单', meta: '3/8 地标', status: '发现' },
    { icon: '◈', label: '资源列表', meta: '草药 · 矿石', status: '采集' },
  ],
  notifications: {
    notice: { icon: '!', label: '发现新地标', meta: '+25 探索经验', tone: 'success' },
    prompt: { label: '长按 E 采集资源', action: '交互' },
    badge: { label: '探索徽章', count: '2' },
    state: { label: '任务反馈', value: 62, tone: 'primary' },
  },
}

export const GENRE_COMPONENT_KITS: Record<GenrePresetId, GenreComponentKit> = {
  'open-world': DEFAULT_COMPONENT_KIT,
  fps: {
    genre: 'fps',
    className: 'uid-genre-fps',
    tokens: {
      accent: '#ffb34a',
      danger: '#ff4d3f',
      success: '#7dd46a',
      surface: 'tactical matte metal HUD',
      shape: 'hard bevels, clipped corners, compact weapon readouts',
      density: 'dense',
      feedbackTone: '命中、受击、弹药不足、危险方向',
      iconMetaphor: '武器剪影、准星、弹匣、警戒三角',
    },
    promptGuidance: [
      'FPS components must be tactical combat HUD parts: ammo, armor, squad objective, damage warning, loadout switching.',
      'Use dense data, clipped-corner geometry, military labels, red/orange threat feedback; avoid rounded casual web controls.',
    ],
    tabs: {
      primary: ['主武器', '副武器', '投掷物'],
      activeIndex: 0,
      filters: ['近战', '中距', '压制'],
      segment: ['战术', '装填中', '可开火'],
      pagerLabel: '小队分页',
    },
    bars: [
      { label: '弹药条', value: 38, tone: 'danger', meta: 'AMMO' },
      { label: '护甲条', value: 72, tone: 'primary', meta: 'ARMOR' },
      { label: '命中反馈', value: 58, tone: 'energy', meta: 'HIT' },
    ],
    lists: [
      { icon: '▸', label: '任务目标', meta: 'A 点 · 12m', status: '推进' },
      { icon: '⌁', label: '武器列表', meta: 'AR-17 · 30/90', status: '装填' },
      { icon: '△', label: '小队排行', meta: 'K/D 8:2', status: '领先' },
    ],
    notifications: {
      notice: { icon: '!', label: '危险警报', meta: '左翼受击', tone: 'danger' },
      prompt: { label: '按 R 快速换弹', action: '确认' },
      badge: { label: '击杀徽章', count: '5' },
      state: { label: '受击反馈', value: 34, tone: 'danger' },
    },
  },
  'action-rpg': {
    genre: 'action-rpg',
    className: 'uid-genre-action-rpg',
    tokens: {
      accent: '#d9a85f',
      danger: '#d94f63',
      success: '#68d188',
      surface: 'ornate fantasy metal and magic glass',
      shape: 'ornate frames, gemstone caps, layered stat panels',
      density: 'balanced',
      feedbackTone: '技能冷却、稀有掉落、生命法力、任务推进',
      iconMetaphor: '剑、盾、法术纹章、宝石、卷轴',
    },
    promptGuidance: [
      'Action-RPG components must prioritize HP/MP, cooldown, equipment rarity, loot, quest and skill states.',
      'Use layered ornate panels, badge-like tabs, rarity colors and magical glow; avoid tactical military UI.',
    ],
    tabs: {
      primary: ['装备', '技能', '天赋'],
      activeIndex: 1,
      filters: ['稀有', '可升级', '套装'],
      segment: ['成长', '进行中', '已完成'],
      pagerLabel: '背包分页',
    },
    bars: [
      { label: '血量条', value: 82, tone: 'danger', meta: 'HP' },
      { label: '法力条', value: 66, tone: 'primary', meta: 'MP' },
      { label: '冷却条', value: 48, tone: 'energy', meta: 'CD' },
    ],
    lists: [
      { icon: '◆', label: '任务追踪', meta: '讨伐首领', status: '史诗' },
      { icon: '✦', label: '背包装备', meta: 'Lv.42 长剑', status: '可强化' },
      { icon: '✧', label: '技能排行', meta: '火焰爆发', status: '冷却' },
    ],
    notifications: {
      notice: { icon: '!', label: '拾取稀有装备', meta: '史诗长剑', tone: 'energy' },
      prompt: { label: '确认学习技能', action: '确认' },
      badge: { label: '稀有徽章', count: 'S' },
      state: { label: '技能反馈', value: 70, tone: 'primary' },
    },
  },
  survival: {
    genre: 'survival',
    className: 'uid-genre-survival',
    tokens: {
      accent: '#b7a86a',
      danger: '#d65b45',
      success: '#7ca66a',
      surface: 'worn survival canvas and scratched metal',
      shape: 'rugged strips, taped labels, low saturation survival panels',
      density: 'dense',
      feedbackTone: '饥饿、耐久、感染、温度和制作状态',
      iconMetaphor: '罐头、绷带、火堆、工具、警告标记',
    },
    promptGuidance: [
      'Survival components must feel resource-scarce: hunger, durability, crafting, infection, temperature and threat warnings.',
      'Use rugged taped labels, worn metal/canvas surfaces, desaturated colors and urgent danger states.',
    ],
    tabs: {
      primary: ['物资', '制作', '状态'],
      activeIndex: 0,
      filters: ['可用', '缺材料', '危险'],
      segment: ['生存', '制作中', '安全'],
      pagerLabel: '营地分页',
    },
    bars: [
      { label: '生命状态', value: 61, tone: 'danger', meta: 'HP' },
      { label: '饥饿值', value: 42, tone: 'energy', meta: 'HUNGER' },
      { label: '耐久条', value: 54, tone: 'primary', meta: 'DUR' },
    ],
    lists: [
      { icon: '▣', label: '物资清单', meta: '木材 x12', status: '可用' },
      { icon: '⚒', label: '制作队列', meta: '营火 02:10', status: '制作中' },
      { icon: '!', label: '威胁列表', meta: '感染区', status: '高危' },
    ],
    notifications: {
      notice: { icon: '!', label: '体温过低', meta: '寻找热源', tone: 'danger' },
      prompt: { label: '长按制作绷带', action: '制作' },
      badge: { label: '风险徽章', count: '!' },
      state: { label: '环境反馈', value: 42, tone: 'danger' },
    },
  },
  mmo: {
    genre: 'mmo',
    className: 'uid-genre-mmo',
    tokens: {
      accent: '#b8a0ff',
      danger: '#ff6678',
      success: '#70d99c',
      surface: 'massive multiplayer raid panels',
      shape: 'multi-slot party frames, dense rows, guild badges',
      density: 'dense',
      feedbackTone: '队伍、仇恨、施法、公会和副本状态',
      iconMetaphor: '队伍头像、职业徽记、公会旗帜、副本门',
    },
    promptGuidance: [
      'MMO components must support party, guild, raid, aggro, casting and social density.',
      'Use dense multi-row lists, party frame rhythm, role badges and raid-status colors.',
    ],
    tabs: {
      primary: ['队伍', '副本', '公会'],
      activeIndex: 1,
      filters: ['坦克', '治疗', '输出'],
      segment: ['组队', '进行中', '已通关'],
      pagerLabel: '副本分页',
    },
    bars: [
      { label: '生命状态', value: 76, tone: 'success', meta: 'PARTY' },
      { label: '仇恨条', value: 69, tone: 'danger', meta: 'AGGRO' },
      { label: '施法条', value: 52, tone: 'primary', meta: 'CAST' },
    ],
    lists: [
      { icon: '●', label: '任务列表', meta: '团队副本', status: '集结' },
      { icon: '◆', label: '队伍列表', meta: '5/5 在线', status: '就绪' },
      { icon: '◇', label: '副本排行', meta: 'DPS 12.4k', status: '统计' },
    ],
    notifications: {
      notice: { icon: '!', label: '团队集合', meta: '世界 Boss', tone: 'primary' },
      prompt: { label: '确认进入副本', action: '进入' },
      badge: { label: '公会徽章', count: 'G' },
      state: { label: '施法反馈', value: 58, tone: 'primary' },
    },
  },
  'life-sim': {
    genre: 'life-sim',
    className: 'uid-genre-life-sim',
    tokens: {
      accent: '#8dcf89',
      danger: '#e58a74',
      success: '#79c98d',
      surface: 'cozy life simulation cards',
      shape: 'soft rounded cards, diary tabs, calendar chips',
      density: 'airy',
      feedbackTone: '心情、日程、好感、生活目标',
      iconMetaphor: '日历、爱心、家居、咖啡、礼物',
    },
    promptGuidance: [
      'Life-sim components must feel cozy and low pressure: mood, schedule, relationship and household actions.',
      'Use soft rounded cards, diary/calendar metaphors, warm natural colors and gentle feedback.',
    ],
    tabs: {
      primary: ['日程', '好友', '家园'],
      activeIndex: 0,
      filters: ['今天', '可互动', '礼物'],
      segment: ['生活', '进行中', '已完成'],
      pagerLabel: '房间分页',
    },
    bars: [
      { label: '心情条', value: 88, tone: 'success', meta: 'MOOD' },
      { label: '体力条', value: 57, tone: 'energy', meta: 'ENERGY' },
      { label: '关系进度', value: 64, tone: 'primary', meta: 'BOND' },
    ],
    lists: [
      { icon: '♡', label: '日程列表', meta: '下午茶 15:00', status: '预约' },
      { icon: '☕', label: '商店列表', meta: '新家具', status: '上新' },
      { icon: '✿', label: '好友排行', meta: '亲密度 72', status: '可赠礼' },
    ],
    notifications: {
      notice: { icon: '!', label: '好友来访', meta: '+5 好感', tone: 'success' },
      prompt: { label: '赠送手作礼物', action: '赠送' },
      badge: { label: '好感徽章', count: '3' },
      state: { label: '心情反馈', value: 78, tone: 'success' },
    },
  },
  racing: {
    genre: 'racing',
    className: 'uid-genre-racing',
    tokens: {
      accent: '#52d6ff',
      danger: '#ff5d4f',
      success: '#8cff66',
      surface: 'racing dashboard and telemetry HUD',
      shape: 'slanted panels, gauge arcs, speed strips',
      density: 'dense',
      feedbackTone: '速度、氮气、圈速、超车、名次',
      iconMetaphor: '速度表、旗帜、轮胎、氮气瓶、奖杯',
    },
    promptGuidance: [
      'Racing components must use speed, lap, rank, nitro and telemetry metaphors.',
      'Use slanted motion shapes, gauge arcs, blue nitro accents and high-speed feedback; avoid RPG inventory language.',
    ],
    tabs: {
      primary: ['赛事', '车库', '排行'],
      activeIndex: 0,
      filters: ['竞速', '漂移', '计时'],
      segment: ['赛段', '进行中', '已完成'],
      pagerLabel: '车库分页',
    },
    bars: [
      { label: '速度条', value: 91, tone: 'primary', meta: 'KM/H' },
      { label: '氮气条', value: 63, tone: 'energy', meta: 'N2O' },
      { label: '圈速条', value: 44, tone: 'success', meta: 'LAP' },
    ],
    lists: [
      { icon: '▰', label: '赛道列表', meta: '湾岸高速', status: '热身' },
      { icon: '◢', label: '车辆列表', meta: 'S 级赛车', status: '调校' },
      { icon: '🏁', label: '圈速排行', meta: '01:24.08', status: 'PB' },
    ],
    notifications: {
      notice: { icon: '!', label: '完成超车', meta: '+120 分', tone: 'success' },
      prompt: { label: '按 Shift 释放氮气', action: '确认' },
      badge: { label: '奖杯徽章', count: '1' },
      state: { label: '氮气反馈', value: 72, tone: 'primary' },
    },
  },
  puzzle: {
    genre: 'puzzle',
    className: 'uid-genre-puzzle',
    tokens: {
      accent: '#ffb7d5',
      danger: '#ff7a7a',
      success: '#76db89',
      surface: 'rounded candy puzzle UI',
      shape: 'bubbly pills, high-radius cards, playful star badges',
      density: 'airy',
      feedbackTone: '步数、目标、连击、星级奖励',
      iconMetaphor: '星星、糖果块、灯泡、钥匙、计时器',
    },
    promptGuidance: [
      'Puzzle components must feel level-based and approachable: moves, target, combo, star score and boosters.',
      'Use bubbly rounded shapes, high-saturation candy colors, large touch targets and cheerful feedback.',
    ],
    tabs: {
      primary: ['关卡', '活动', '奖励'],
      activeIndex: 0,
      filters: ['全部', '困难', '未满星'],
      segment: ['目标', '进行中', '已完成'],
      pagerLabel: '章节分页',
    },
    bars: [
      { label: '目标进度', value: 74, tone: 'primary', meta: 'GOAL' },
      { label: '步数条', value: 41, tone: 'danger', meta: 'MOVES' },
      { label: '连击反馈', value: 68, tone: 'energy', meta: 'COMBO' },
    ],
    lists: [
      { icon: '★', label: '关卡目标', meta: '消除 24 个', status: '2/3 星' },
      { icon: '✦', label: '道具列表', meta: '彩虹球 x2', status: '可用' },
      { icon: '☘', label: '星级排行', meta: '好友第 3', status: '追赶' },
    ],
    notifications: {
      notice: { icon: '!', label: '连击成功', meta: 'Combo x4', tone: 'energy' },
      prompt: { label: '使用提示道具', action: '使用' },
      badge: { label: '星级徽章', count: '3' },
      state: { label: '目标反馈', value: 76, tone: 'primary' },
    },
  },
}

export function defaultStyleBoardPrompt(state: Pick<UIDesignState, 'genrePreset' | 'style' | 'sceneDesc'>): string {
  const genre = GENRE_MAP.get(state.genrePreset)?.label ?? state.genrePreset
  const style = STYLE_MAP.get(state.style)?.label ?? state.style
  const kit = GENRE_COMPONENT_KITS[state.genrePreset] ?? DEFAULT_COMPONENT_KIT
  const scene = state.sceneDesc.trim() ? `场景气质：${state.sceneDesc.trim()}。` : ''
  return [
    `为${genre}生成一整套可拆解的游戏 UI 风格板。`,
    `风格方向：${style}。${scene}`,
    `游戏类型组件语言：${kit.tokens.feedbackTone}。`,
    `组件形状：${kit.tokens.shape}；信息密度：${kit.tokens.density}；图标隐喻：${kit.tokens.iconMetaphor}。`,
    ...kit.promptGuidance.map(line => `- ${line}`),
    '必须包含：按钮、标签、面板、底框纹理、图标、资源条、弹窗、卡片、列表、通知。',
    '同名组件在不同游戏类型中必须改变信息优先级、形状、状态反馈和交互暗示；禁止输出通用 Web/SaaS/Dashboard UI。',
    '输出应能拆成 tokens：accent、danger、success、barShape、tabShape、listDensity、feedbackTone、iconMetaphor。',
    '要求：同一套视觉系统，适合直接组装成最终游戏 UI，而不是展示海报或插画板。',
  ].join('\n')
}

export function getGenreComponentKit(genre: GenrePresetId): GenreComponentKit {
  return GENRE_COMPONENT_KITS[genre] ?? DEFAULT_COMPONENT_KIT
}

export function getStyleBoardSections(genre: GenrePresetId): StyleBoardSection[] {
  const overrides = GENRE_STYLE_BOARD_OVERRIDES[genre] ?? {}
  return STYLE_BOARD_BASE.map((section) => ({
    ...section,
    items: overrides[section.id] ?? section.items,
  }))
}

/** 按类型+风格推荐的场景描述关键词 */
type SceneSuggestionStyleKey = StylePresetId | 'dark-fantasy' | 'neon-cyber' | 'default'

const SCENE_SUGGESTIONS: Record<GenrePresetId, Partial<Record<SceneSuggestionStyleKey, string[]>>> = {
  'open-world': {
    'dark-fantasy':   ['暗夜森林与远处的火光', '废墟城市中的孤独探索者', '雾气弥漫的山谷', '巨型遗迹前的骑士'],
    'realistic-military': ['战后焦土废墟', '沙漠中的军事基地', '破败的城市街道', '战场烟雾中的士兵'],
    'neon-cyber':     ['霓虹灯下的赛博街道', '高空悬浮城市', '地下数据中心', '雨夜的摩天大楼'],
    'default':        ['广阔草原与远山', '古老城堡遗迹', '海边悬崖营地', '黎明前的荒野小镇'],
  },
  fps: {
    'realistic-military': ['城市巷战废墟', '直升机俯瞰战场', '雪地掩体作战', '核电站厂房走廊'],
    'neon-cyber':     ['霓虹地下竞技场', '未来城市屋顶追逐', '数据中心服务器走廊', '反重力战场'],
    'dark-fantasy':   ['地下城堡密室', '恶魔巢穴', '魔法阵战场', '末世神殿'],
    'default':        ['工业仓库内战', '森林特种作战', '港口夜间突袭', '实验室设施'],
  },
  'action-rpg': {
    'dark-fantasy':   ['魔王城堡门前', '龙巢洞穴入口', '古代神殿大厅', '月光下的魔法森林'],
    'cute-cartoon':   ['糖果色魔法学院', '云端城堡冒险', '五彩森林与精灵', '梦幻海底王国'],
    'fresh-pastoral': ['春日村庄边境', '花海中的古老神殿', '河畔农场远眺山脉', '晨雾中的精灵树屋'],
    'default':        ['城镇广场出发前', '古老神殿内部', '魔法森林深处', '决战山顶'],
  },
  survival: {
    'realistic-military': ['末日后城市废墟', '感染区隔离带', '地下避难所出口', '辐射沙漠营地'],
    'dark-fantasy':   ['受诅咒的荒原', '腐化沼泽边缘', '末世祭坛废墟', '侵蚀的古堡'],
    'default':        ['孤岛丛林基地', '雪山山洞庇护所', '核冬天旷野', '废弃超市据点'],
  },
  mmo: {
    'dark-fantasy':   ['帝都广场万人集会', '公会城堡集结', '世界Boss战场远景', '跨服战场'],
    'cute-cartoon':   ['节日嘉年华广场', '玩家聚集的浮空岛', '彩色世界交汇处', '交易集市'],
    'default':        ['奇幻都市中央广场', '多种族聚居地', '战场边缘营地', '传送门枢纽'],
  },
  'life-sim': {
    'fresh-pastoral': ['午后咖啡馆窗边', '自家农场清晨', '小镇集市傍晚', '海边度假小屋'],
    'cute-cartoon':   ['明亮卧室工作台', '社区公园野餐', '学校走廊', '小镇主街'],
    'default':        ['温馨客厅', '城市公寓阳台', '宠物店内', '料理厨房'],
  },
  racing: {
    'neon-cyber':     ['霓虹赛道弯道', '未来城市高架赛道', '地下隧道加速段', '飞天赛道起跑线'],
    'realistic-military': ['山地拉力赛道', '沙漠越野赛段', '城市街道赛', '雨天赛道'],
    'default':        ['赛道起跑线', '山路激弯', '港口赛道', '赛场观众台'],
  },
  puzzle: {
    'cute-cartoon':   ['色彩缤纷的拼图世界', '童话城堡谜题室', '糖果迷宫入口', '魔法图书馆'],
    'fresh-pastoral': ['花园迷宫', '古朴村庄谜题现场', '森林中的机关道具', '晴天庭院解谜'],
    'modern-minimal': ['极简白色解谜空间', '几何图形世界', '数字迷宫', '抽象空间关卡'],
    'default':        ['悬浮谜题关卡', '古典机关室', '神秘图腾阵', '光影解谜空间'],
  },
}

/** 根据类型和风格返回推荐场景描述，优先匹配 style，无匹配则用 default */
export function sceneSuggestions(genre: GenrePresetId, style: StylePresetId): string[] {
  const byGenre = SCENE_SUGGESTIONS[genre] ?? {}
  return (byGenre[style] ?? byGenre['default']) ?? []
}

export function hydrateState(raw: unknown): UIDesignState {
  const next = createDefaultState()
  if (!isRecord(raw)) return next

  next.genrePreset = pickEnum(raw.genrePreset, GENRE_PRESETS.map(item => item.id), next.genrePreset)
  {
    const STEP_IDS: WorkflowStepId[] = [
      'genre', 'layout', 'style', 'component-preview', 'prototype',
    ]
    let rawStep = (raw as { workflowStep?: string }).workflowStep
    if (rawStep === 'style-board' || rawStep === 'prompt-library' || rawStep === 'component-refine') {
      rawStep = 'component-preview'
    }
    next.workflowStep = pickEnum(
      rawStep,
      STEP_IDS,
      next.workflowStep,
    )
  }
  next.style = pickEnum(raw.style, STYLE_PRESETS.map(item => item.id), next.style)
  next.stage = pickEnum(raw.stage, STAGE_PRESETS.map(item => item.id), next.stage)
  next.platform = pickEnum(raw.platform, ['pc', 'mobile', 'console'], next.platform)
  next.previewDevice = pickEnum(raw.previewDevice, ['pc', 'mobile', 'console'], next.previewDevice)
  next.previewMode = pickEnum(raw.previewMode, ['hud', 'menu', 'shop', 'dialog', 'results'], next.previewMode)
  next.parameterTab = pickEnum(raw.parameterTab, ['color', 'font', 'style', 'layout'], next.parameterTab)
  next.themeMode = pickEnum(raw.themeMode, ['dark', 'light'], next.themeMode)
  next.fontFlavor = pickEnum(raw.fontFlavor, ['modern', 'fantasy', 'arcade', 'clean'], next.fontFlavor)
  next.uiSurface = pickEnum(raw.uiSurface, ['glass', 'metal', 'painted', 'minimal'], next.uiSurface)
  next.density = pickEnum(raw.density, ['airy', 'balanced', 'dense'], next.density)
  next.cornerRadius = pickNumber(raw.cornerRadius, next.cornerRadius, 0, 32)
  next.surfaceTransparency = pickNumber(raw.surfaceTransparency, next.surfaceTransparency, 0.2, 0.96)
  next.hudScale = pickNumber(raw.hudScale, next.hudScale, 0.72, 1.4)
  next.immersion = pickNumber(raw.immersion, next.immersion, 0, 1)

  if (typeof raw.customGameType === 'string') next.customGameType = raw.customGameType
  if (typeof raw.minimapPosition === 'string') next.minimapPosition = raw.minimapPosition
  if (typeof raw.healthPosition === 'string') next.healthPosition = raw.healthPosition
  if (typeof raw.keywords === 'string') next.keywords = raw.keywords
  if (typeof raw.notes === 'string') next.notes = raw.notes
  if (typeof raw.sceneDesc === 'string') next.sceneDesc = raw.sceneDesc
  if (typeof raw.styleBoardPrompt === 'string') next.styleBoardPrompt = raw.styleBoardPrompt
  if (typeof raw.assetPromptNotes === 'string') next.assetPromptNotes = raw.assetPromptNotes
  if (typeof raw.layoutApproved === 'boolean') next.layoutApproved = raw.layoutApproved
  if (typeof raw.styleBoardApproved === 'boolean') next.styleBoardApproved = raw.styleBoardApproved
  if (typeof raw.confirmedStylePackId === 'string') next.confirmedStylePackId = raw.confirmedStylePackId
  if (typeof raw.compareHistoryPackId === 'string') next.compareHistoryPackId = raw.compareHistoryPackId
  if (Array.isArray(raw.selectedFeatures)) {
    next.selectedFeatures = uniqueIds(
      raw.selectedFeatures.filter((item): item is string => typeof item === 'string'),
    )
  }
  if (Array.isArray(raw.assetHistory)) {
    next.assetHistory = raw.assetHistory
      .filter((item): item is StyleAssetHistoryItem => isRecord(item)
        && typeof item.id === 'string'
        && typeof item.label === 'string'
        && typeof item.genrePreset === 'string'
        && typeof item.style === 'string'
        && typeof item.sceneDesc === 'string'
        && typeof item.confirmedAt === 'number')
      .map((item) => ({
        ...item,
        assets: isRecord(item.assets) ? {
          buttonPrimary: typeof item.assets.buttonPrimary === 'string' ? item.assets.buttonPrimary : undefined,
          buttonNormal: typeof item.assets.buttonNormal === 'string' ? item.assets.buttonNormal : undefined,
          titleDeco: typeof item.assets.titleDeco === 'string' ? item.assets.titleDeco : undefined,
          panelTexture: typeof item.assets.panelTexture === 'string' ? item.assets.panelTexture : undefined,
          icon: typeof item.assets.icon === 'string' ? item.assets.icon : undefined,
          icons: Array.isArray(item.assets.icons)
            ? item.assets.icons.filter((icon): icon is string => typeof icon === 'string').slice(0, 4)
            : undefined,
        } : undefined,
        preview: isRecord(item.preview) ? {
          buttonPrimary: typeof item.preview.buttonPrimary === 'string' ? item.preview.buttonPrimary : undefined,
          buttonNormal: typeof item.preview.buttonNormal === 'string' ? item.preview.buttonNormal : undefined,
          titleDeco: typeof item.preview.titleDeco === 'string' ? item.preview.titleDeco : undefined,
          panelTexture: typeof item.preview.panelTexture === 'string' ? item.preview.panelTexture : undefined,
          icon: typeof item.preview.icon === 'string' ? item.preview.icon : undefined,
          icons: Array.isArray(item.preview.icons)
            ? item.preview.icons.filter((icon): icon is string => typeof icon === 'string').slice(0, 4)
            : undefined,
        } : undefined,
      }))
      .slice(0, 12)
  }
  if (Array.isArray(raw.lockedAssetKinds)) {
    next.lockedAssetKinds = raw.lockedAssetKinds
      .filter((item): item is AssetKindId => typeof item === 'string'
        && ['buttonNormal', 'buttonPrimary', 'titleDeco', 'panelTexture', 'icons', 'background'].includes(item))
  }
  if (next.selectedFeatures.length === 0) {
    next.selectedFeatures = recommendedFeatures(next)
  }
  if (!next.styleBoardPrompt.trim()) {
    next.styleBoardPrompt = defaultStyleBoardPrompt(next)
  }

  return next
}

/** PDF AI Conflict Detection Rules */
export function detectConflicts(state: UIDesignState): ConflictWarning[] {
  const conflicts: ConflictWarning[] = []
  const features = new Set(state.selectedFeatures)
  const genre = state.genrePreset

  // Style mismatch
  const badStyles = STYLE_MISMATCH_RULES[genre] ?? []
  if (badStyles.includes(state.style as StylePresetId)) {
    conflicts.push({
      type: 'style-mismatch',
      severity: 'warning',
      message: `"${STYLE_MAP.get(state.style as StylePresetId)?.label ?? state.style}"风格与"${GENRE_MAP.get(genre)?.label ?? genre}"类型视觉调性不匹配。`,
      involves: ['style', 'genrePreset'],
    })
  }

  // Dependency missing
  for (const [feature, deps] of Object.entries(DEPENDENCY_RULES)) {
    if (features.has(feature)) {
      for (const dep of deps) {
        if (!features.has(dep)) {
          conflicts.push({
            type: 'dependency-missing',
            severity: 'error',
            message: `"${FEATURE_MAP.get(feature)?.label ?? feature}"需要"${FEATURE_MAP.get(dep)?.label ?? dep}"模块支撑，但当前未选中。`,
            involves: [feature, dep],
          })
        }
      }
    }
  }

  // Mutual exclusive
  for (const [a, b] of MUTUAL_EXCLUSIVE_PAIRS) {
    if (features.has(a) && features.has(b)) {
      conflicts.push({
        type: 'mutual-exclusive',
        severity: 'error',
        message: `"${FEATURE_MAP.get(a)?.label ?? a}"与"${FEATURE_MAP.get(b)?.label ?? b}"不能同时存在，二者互斥。`,
        involves: [a, b],
      })
    }
  }

  // Scope mismatch
  for (const [feature, badGenres] of Object.entries(SCOPE_MISMATCH_RULES)) {
    if (features.has(feature) && badGenres.includes(genre as GenrePresetId)) {
      conflicts.push({
        type: 'scope-mismatch',
        severity: 'warning',
        message: `"${FEATURE_MAP.get(feature)?.label ?? feature}"体量过重，与"${GENRE_MAP.get(genre)?.label ?? genre}"轻量玩法体量不匹配。`,
        involves: [feature, 'genrePreset'],
      })
    }
  }

  // Legacy layout conflicts (retained for backward compat)
  if (state.previewMode === 'dialog' && features.has('scoreboard')) {
    conflicts.push({
      type: 'layout-overflow',
      severity: 'info',
      message: '当前预览是对话场景，比分模块会挤压对话焦点。',
      involves: ['scoreboard'],
    })
  }
  if (state.previewDevice === 'mobile' && state.density === 'dense') {
    conflicts.push({
      type: 'layout-overflow',
      severity: 'warning',
      message: '移动端高密度布局会降低触控可读性。',
      involves: ['density', 'previewDevice'],
    })
  }
  if (features.has('shop-panel') && features.has('crafting-panel') && state.stage === 'combat') {
    conflicts.push({
      type: 'layout-overflow',
      severity: 'info',
      message: '战斗阶段同时强调商店与制作会打断节奏。',
      involves: ['shop-panel', 'crafting-panel', 'stage'],
    })
  }

  return conflicts
}

export function buildBlueprint(state: UIDesignState): UIBlueprint {
  const genre = GENRE_MAP.get(state.genrePreset) ?? GENRE_PRESETS[0]
  const style = STYLE_MAP.get(state.style as StylePresetId) ?? STYLE_PRESETS[0]
  const stage = STAGE_MAP.get(state.stage) ?? STAGE_PRESETS[0]
  const features = uniqueIds([...stageEssentialFeatures(state.stage), ...state.selectedFeatures])
  const modulesByLayer: UIBlueprint['modulesByLayer'] = {
    'permanent-hud': [],
    'context-hud': [],
    'active-menu': [],
    'depth-settings': [],
  }

  for (const id of features) {
    const module = FEATURE_MAP.get(id)
    if (module) modulesByLayer[module.layer].push(module)
  }

  const conflictWarnings = detectConflicts(state)

  return {
    title: `${genre.label} · ${stage.label} UI骨架`,
    summary: `${genre.label}在${stage.label}阶段使用${style.label}风格，围绕${stage.focus}组织核心信息与操作入口。`,
    genre,
    style,
    stage,
    features,
    modulesByLayer,
    recommendations: recommendedFeatures(state),
    conflicts: conflictWarnings.map(c => c.message),
  }
}

export function buildFramework(blueprint: UIBlueprint): string {
  return [
    `${blueprint.title}`,
    `核心目标：${blueprint.stage.playerGoal}`,
    `布局策略：${blueprint.stage.layout}`,
    `常驻信息：${blueprint.modulesByLayer['permanent-hud'].map(item => item.label).join(' / ') || '无'}`,
    `情境提示：${blueprint.modulesByLayer['context-hud'].map(item => item.label).join(' / ') || '无'}`,
    `主动菜单：${blueprint.modulesByLayer['active-menu'].map(item => item.label).join(' / ') || '无'}`,
    `深层壳层：${blueprint.modulesByLayer['depth-settings'].map(item => item.label).join(' / ') || '无'}`,
  ].join('\n')
}

export function buildPrompt(state: UIDesignState): string {
  const blueprint = buildBlueprint(state)
  const customType = state.customGameType.trim() ? `自定义游戏类型：${state.customGameType}` : ''
  const keywords = state.keywords.trim() ? `关键词：${state.keywords.trim()}` : ''
  const notes = state.notes.trim() ? `补充说明：${state.notes.trim()}` : ''

  return [
    `请为${blueprint.genre.label}设计一个${blueprint.stage.label}阶段的玩家 UI。`,
    `视觉风格：${blueprint.style.label}，语气：${blueprint.style.tone}。`,
    `平台：${state.previewDevice}，预览模式：${state.previewMode}。`,
    `必须模块：${blueprint.features.join('、')}。`,
    `布局目标：${blueprint.stage.layout}。`,
    customType,
    keywords,
    notes,
  ].filter(Boolean).join('\n')
}

export function buildPreviewTemplatePlan(state: UIDesignState): string {
  const stage = STAGE_MAP.get(state.stage) ?? STAGE_PRESETS[0]
  const modeLabels: Record<PreviewModeId, string> = {
    hud: '常驻 HUD',
    menu: '主菜单/系统菜单',
    shop: '商店界面',
    dialog: '对话界面',
    results: '结算界面',
  }
  return `${stage.label}阶段建议使用「${modeLabels[state.previewMode]}」模板，主 CTA 为「${stage.cta}」。`
}

export function saveState(state: UIDesignState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore persistence failures in sandbox/dev.
  }
}

export function loadState(): UIDesignState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? hydrateState(JSON.parse(raw)) : createDefaultState()
  } catch {
    return createDefaultState()
  }
}

function readRuntimeStorage(): string | null {
  try {
    return sessionStorage.getItem(RUNTIME_STORAGE_KEY) ?? localStorage.getItem(RUNTIME_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeRuntimeStorage(payload: string): void {
  try {
    sessionStorage.setItem(RUNTIME_STORAGE_KEY, payload)
    localStorage.setItem(RUNTIME_STORAGE_KEY, payload)
  } catch {
    try {
      sessionStorage.setItem(RUNTIME_STORAGE_KEY, payload)
    } catch {
      // Ignore persistence failures when preview assets exceed quota.
    }
  }
}

export function saveRuntimeSnapshot(snapshot: UiDesignRuntimeSnapshot): void {
  try {
    writeRuntimeStorage(JSON.stringify(snapshot))
  } catch {
    // Ignore persistence failures in sandbox/dev.
  }
}

export function loadRuntimeSnapshot(): UiDesignRuntimeSnapshot | null {
  try {
    const raw = readRuntimeStorage()
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UiDesignRuntimeSnapshot>
    if (parsed.version !== 1) return null
    return {
      version: 1,
      activeScreen: pickEnum(parsed.activeScreen, [
        'start', 'hud', 'bag', 'dialog', 'character', 'results', 'end', 'pause', 'level-select', 'weapon-select', 'map', 'shop',
      ] as ScreenKind[], 'start'),
      genreSelectionConfirmed: Boolean(parsed.genreSelectionConfirmed),
      layoutReviewedScreens: Array.isArray(parsed.layoutReviewedScreens)
        ? parsed.layoutReviewedScreens.filter((item): item is string => typeof item === 'string')
        : [],
      layoutBaselineMergedScreens: Array.isArray(parsed.layoutBaselineMergedScreens)
        ? parsed.layoutBaselineMergedScreens.filter((item): item is string => typeof item === 'string')
        : [],
      prototypeHTML: typeof parsed.prototypeHTML === 'string' ? parsed.prototypeHTML : null,
      previewBg: isRecord(parsed.previewBg)
        ? Object.fromEntries(Object.entries(parsed.previewBg).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {},
      liveAssets: {
        icons: Array.isArray(parsed.liveAssets?.icons)
          ? parsed.liveAssets.icons.filter((item): item is string => typeof item === 'string')
          : [],
        buttonNormal: typeof parsed.liveAssets?.buttonNormal === 'string' ? parsed.liveAssets.buttonNormal : undefined,
        buttonPrimary: typeof parsed.liveAssets?.buttonPrimary === 'string' ? parsed.liveAssets.buttonPrimary : undefined,
        titleDeco: typeof parsed.liveAssets?.titleDeco === 'string' ? parsed.liveAssets.titleDeco : undefined,
        panelTexture: typeof parsed.liveAssets?.panelTexture === 'string' ? parsed.liveAssets.panelTexture : undefined,
      },
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    }
  } catch {
    return null
  }
}

export function clearRuntimeSnapshot(): void {
  try {
    sessionStorage.removeItem(RUNTIME_STORAGE_KEY)
    localStorage.removeItem(RUNTIME_STORAGE_KEY)
  } catch {
    // Ignore persistence failures in sandbox/dev.
  }
}

/** 清空工作流 localStorage + 运行时快照，回到默认初始状态。 */
export function wipePersistedSession(): void {
  clearRuntimeSnapshot()
  saveState(createDefaultState())
}
