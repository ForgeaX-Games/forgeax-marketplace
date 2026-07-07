/**
 * wb-items 图标画风 ↔ wb-ui UI 工坊视觉风格 映射（合并补缺，互不覆盖）
 * wb-ui StylePresetId 见 wb-ui/src/pipelines/ui-design/model.ts
 */
export type UiStylePresetId =
  | 'modern-dark'
  | 'fantasy'
  | 'anime'
  | 'sci-fi'
  | 'pixel'
  | 'cute-cartoon'
  | 'fresh-pastoral'
  | 'realistic-military'
  | 'modern-minimal';

export const UI_STYLE_PRESET_IDS: UiStylePresetId[] = [
  'modern-dark',
  'fantasy',
  'anime',
  'sci-fi',
  'pixel',
  'cute-cartoon',
  'fresh-pastoral',
  'realistic-military',
  'modern-minimal',
];

export function isUiStylePresetId(id: string): id is UiStylePresetId {
  return (UI_STYLE_PRESET_IDS as string[]).includes(id);
}

/** iconStyleId → 首选 wb-ui 风格（旧 ID 保留，仅补映射） */
export const ICON_TO_UI_STYLE: Record<string, UiStylePresetId> = {
  'pixel-48': 'pixel',
  'pixel-32': 'pixel',
  'pixel-16': 'pixel',
  'pixel-64': 'pixel',
  'fantasy-painted': 'fantasy',
  'sci-fi-hud': 'sci-fi',
  'painted-flat': 'modern-minimal',
  'ui-modern-dark': 'modern-dark',
  'ui-anime': 'anime',
  'ui-cute-cartoon': 'cute-cartoon',
  'ui-fresh-pastoral': 'fresh-pastoral',
  'ui-realistic-military': 'realistic-military',
  'ui-modern-minimal': 'modern-minimal',
  'ui-cyber-neon': 'sci-fi',
  'ui-watercolor': 'fresh-pastoral',
  'ui-low-poly': 'modern-minimal',
};

/** wb-ui 风格 → 默认图标画风（UI 工坊跳转回道具台时用） */
export const UI_TO_ICON_STYLE: Partial<Record<UiStylePresetId, string>> = {
  'modern-dark': 'ui-modern-dark',
  fantasy: 'fantasy-painted',
  anime: 'ui-anime',
  'sci-fi': 'sci-fi-hud',
  pixel: 'pixel-48',
  'cute-cartoon': 'ui-cute-cartoon',
  'fresh-pastoral': 'ui-fresh-pastoral',
  'realistic-military': 'ui-realistic-military',
  'modern-minimal': 'ui-modern-minimal',
};

export function uiStyleForIconStyle(iconStyleId: string): UiStylePresetId | undefined {
  return ICON_TO_UI_STYLE[iconStyleId];
}

export function iconStyleForUiStyle(uiStyleId: string): string | undefined {
  if (!isUiStylePresetId(uiStyleId)) return undefined;
  return UI_TO_ICON_STYLE[uiStyleId];
}
