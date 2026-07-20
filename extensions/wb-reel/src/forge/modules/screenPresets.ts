import type { UIScreen, UIScreenKind } from '../../scenario/types'

/**
 * 全屏 UI 页面预设(v11)—— 每种 kind 的默认标题/文案 + 背景生成 prompt 基调。
 *
 * 背景走 UI 部件生成管线(role 'screen-background'),这里给英文 prompt 起底。
 * 版权安全:全部原创描述,禁真实品牌/知名 IP。
 */
export interface ScreenPresetDef {
  /** 中文显示名。 */
  label: string
  /** 新建页面默认标题。 */
  defaultTitle: string
  /** 默认副标题。 */
  defaultSubtitle?: string
  /** 背景生成 prompt(英文,交给 generateUIAsset)。 */
  bgPrompt: string
  /** 一句话用途说明(编辑器展示)。 */
  blurb: string
}

export const SCREEN_PRESETS: Record<UIScreenKind, ScreenPresetDef> = {
  inventory: {
    label: '背包',
    defaultTitle: '背包',
    defaultSubtitle: 'INVENTORY',
    bgPrompt:
      'a full-screen inventory screen background: a dark elegant panel backdrop with a subtle grid area for item slots, soft depth, no items, no text, deep-game UI',
    blurb: '真背包 · 读运行时持有物,网格展示,可查看/丢弃',
  },
  mainMenu: {
    label: '主菜单',
    defaultTitle: '主菜单',
    defaultSubtitle: 'MAIN MENU',
    bgPrompt:
      'a full-screen main menu background: a cinematic atmospheric title-screen backdrop with generous empty space on one side for a vertical menu button list, no text, no characters',
    blurb: '主菜单 · 继续/重开/关卡选择/退出等按钮',
  },
  chest: {
    label: '开宝箱',
    defaultTitle: '宝箱',
    defaultSubtitle: 'TREASURE',
    bgPrompt:
      'a full-screen treasure chest reveal background: a dramatic focused spotlight on an empty central pedestal area with radiant golden glow and particles, no chest object, no text, reward screen backdrop',
    blurb: '开宝箱 · 点击开启一次性发放战利品',
  },
  search: {
    label: '搜刮页',
    defaultTitle: '搜刮',
    defaultSubtitle: 'SEARCH',
    bgPrompt:
      'a full-screen ransack / search scene background: a cluttered room or container interior with many nooks, atmospheric and detailed, empty of highlighted items, no text, loot-search backdrop',
    blurb: '搜刮页 · 整页热点点击拾取(搜打撤)',
  },
  custom: {
    label: '自定义',
    defaultTitle: '页面',
    bgPrompt:
      'a full-screen custom UI screen background: an atmospheric decorative empty backdrop with generous negative space for overlaid widgets, no text, deep-game interface',
    blurb: '自定义 · 部件 + 按钮自由拼装',
  },
}

/** 按 kind 造一个带默认值的空白 UIScreen(编辑器「新建」用)。 */
export function makeUIScreen(opts: { id: string; kind: UIScreenKind; name?: string }): UIScreen {
  const def = SCREEN_PRESETS[opts.kind]
  const base: UIScreen = {
    id: opts.id,
    name: opts.name?.trim() || def.label,
    kind: opts.kind,
    title: def.defaultTitle,
    ...(def.defaultSubtitle ? { subtitle: def.defaultSubtitle } : {}),
    dismissible: opts.kind !== 'mainMenu',
  }
  if (opts.kind === 'chest') base.loot = []
  if (opts.kind === 'search') base.hotspots = []
  if (opts.kind === 'custom') base.slots = []
  return base
}

/** 页面背景生成 prompt(基调 = kind 预设)。 */
export function screenBackgroundPrompt(kind: UIScreenKind): string {
  return SCREEN_PRESETS[kind].bgPrompt
}
