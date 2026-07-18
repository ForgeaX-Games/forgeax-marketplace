import type {
  TreeEdgeStyle,
  TreeTheme,
  TreeThemePreset,
} from '../../scenario/types'

/**
 * 剧情树主题预设 —— 游戏内剧情树(BranchTreeOverlay)的 per-scenario 皮肤基线。
 *
 * 每个预设给出:
 *   - edge:连线默认样式(色/宽/虚实)。
 *   - direction:dagre 布局默认方向。
 *   - bgPrompt / nodeFramePrompt:交给 UI 部件生成管线(role=tree-background /
 *     tree-node-frame)的英文提示词基调,作者点「生成」时作为 prompt 起底。
 *   - promptHint:调色/氛围一句话(拼进上面两个 prompt,保证风格一致)。
 *
 * 'custom' 不在此表:选 custom 时只用作者显式字段,不套任何默认。
 * 版权安全:全部原创描述,禁真实品牌/知名 IP。
 */
export interface TreeThemePresetDef {
  /** 中文显示名。 */
  label: string
  /** 连线默认样式。 */
  edge: TreeEdgeStyle
  /** 布局方向默认。 */
  direction: 'TB' | 'LR'
  /** 风格氛围提示(英文,拼进生成 prompt)。 */
  promptHint: string
}

export const TREE_THEME_PRESETS: Record<
  Exclude<TreeThemePreset, 'custom'>,
  TreeThemePresetDef
> = {
  default: {
    label: '默认(深色)',
    edge: { color: '#ffb347', width: 2.2, dashed: false },
    direction: 'LR',
    promptHint:
      'sleek modern dark game UI, cool cinematic tones, subtle amber accents',
  },
  chinese: {
    label: '中式(金线水墨)',
    edge: { color: '#d9b45b', width: 2.4, dashed: false },
    direction: 'TB',
    promptHint:
      'traditional East-Asian ink-wash aesthetic, gold filigree linework, silk-scroll texture, elegant vermilion and jade accents',
  },
  cartoon: {
    label: '卡通(明快描边)',
    edge: { color: '#4dc3ff', width: 3, dashed: false },
    direction: 'LR',
    promptHint:
      'playful cartoon UI, bold clean outlines, bright saturated candy colors, rounded shapes, cheerful sticker style',
  },
  scifi: {
    label: '科幻(霓虹 HUD)',
    edge: { color: '#39f0d0', width: 2, dashed: true },
    direction: 'LR',
    promptHint:
      'futuristic sci-fi HUD, glowing neon circuitry, holographic cyan and magenta glow, sleek techno-panel frames',
  },
}

/** 内置默认连线样式(无主题/未配 edge 时的回落)。 */
export const DEFAULT_TREE_EDGE: Required<TreeEdgeStyle> = {
  color: '#ffb347',
  width: 2.2,
  dashed: false,
}

/**
 * 按预设产出一份可直接落库的基线 TreeTheme(不含生成的图,assetId 留空由作者生成)。
 * 保留已有主题里作者已配的背景/节点框 asset 引用(仅换风格基线时不丢图)。
 */
export function makeTreeThemeForPreset(
  preset: TreeThemePreset,
  prev?: TreeTheme,
): TreeTheme {
  if (preset === 'custom') {
    return { ...(prev ?? {}), preset: 'custom' }
  }
  const def = TREE_THEME_PRESETS[preset]
  return {
    ...(prev ?? {}),
    preset,
    edge: { ...def.edge },
    direction: def.direction,
    showThumbnails: prev?.showThumbnails ?? true,
    navMode: prev?.navMode ?? 'map',
    jumpScope: prev?.jumpScope ?? 'visited',
  }
}

/** 拼一份剧情树背景的生成 prompt(基调 = 预设 promptHint)。 */
export function treeBackgroundPrompt(preset: TreeThemePreset): string {
  const hint =
    preset !== 'custom' ? TREE_THEME_PRESETS[preset].promptHint : ''
  return [
    'a full-screen chapter-select / story-map background: an atmospheric decorative empty backdrop with soft depth and a gentle vignette, no characters, no readable text, generous empty space for overlaid node cards',
    hint,
  ]
    .filter(Boolean)
    .join(', ')
}

/** 拼一份剧情树节点框的生成 prompt(基调 = 预设 promptHint)。 */
export function treeNodeFramePrompt(preset: TreeThemePreset): string {
  const hint =
    preset !== 'custom' ? TREE_THEME_PRESETS[preset].promptHint : ''
  return [
    'an empty decorative rectangular node frame / border for a story-map card: an ornate hollow bezel with corner flourishes and a clear empty center window to overlay a scene thumbnail, symmetric UI card frame, nothing in the middle',
    hint,
  ]
    .filter(Boolean)
    .join(', ')
}
