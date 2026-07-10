import type { StylePreset, StylePresetHint } from './types';
import { ICON_TO_UI_STYLE } from './ui-style-map';

export const DEFAULT_ICON_SIZE = 48;
/** 图标规范化管线版本；逻辑变更时递增 */
export const ICON_NORMALIZE_REV = 11;

/**
 * 道具图标画风目录 — 保留原有 preset，并补缺对齐 wb-ui 的 9 种界面风格。
 * 每条可带 uiStyleId 与 UI 工坊互通；delivery 决定生图 brief / 质检 / 规范化分支。
 */
export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'lucide-line',
    label: { zh: 'Lucide 线稿', en: 'Lucide line' },
    delivery: 'svg-lucide',
    targetSize: 24,
    promptSuffix: 'Lucide icon style, 2px stroke, round caps, minimal line art, no fill colors',
    showInPicker: false,
  },
  // ── 原有像素类（金标管线）────────────────────────────
  {
    id: 'pixel-48',
    label: { zh: '像素 48', en: 'Pixel 48' },
    delivery: 'png-pixel',
    targetSize: 48,
    uiStyleId: ICON_TO_UI_STYLE['pixel-48'],
    promptSuffix: 'True pixel art RPG inventory icon at 1024×1024: hard 90° edges, NO anti-aliasing, NO smooth gradients, flat color blocks like upscaled 48px sprite, limited palette per material, high contrast silhouette',
  },
  {
    id: 'pixel-32',
    label: { zh: '像素 32', en: 'Pixel 32' },
    delivery: 'png-pixel',
    targetSize: 32,
    uiStyleId: ICON_TO_UI_STYLE['pixel-32'],
    promptSuffix: 'Pixel art inventory icon, 32x32 logical pixels, retro RPG style, hard edges, flat color blocks',
  },
  // ── 彩绘 / UI 工坊对齐（常用风格靠前）────────────────
  {
    id: 'ui-anime',
    label: { zh: '动画风', en: 'Anime' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: 'anime',
    promptSuffix: 'Anime / cel-shaded game item icon, bold clean outline, bright saturated colors, Japanese mobile RPG inventory style, expressive silhouette',
  },
  {
    id: 'ui-modern-minimal',
    label: { zh: '简约', en: 'Minimal' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: 'modern-minimal',
    promptSuffix: 'Minimalist flat item icon, simple geometric silhouette, 2–3 flat colors, thin accent stroke, lots of negative space, modern app-game inventory',
  },
  {
    id: 'painted-flat',
    label: { zh: '平面彩绘', en: 'Painted flat' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: ICON_TO_UI_STYLE['painted-flat'],
    promptSuffix: 'Flat painted game item icon, bold silhouette, soft cel shading, saturated colors, no UI frame, readable at 48px',
  },
  {
    id: 'fantasy-painted',
    label: { zh: '奇幻手绘', en: 'Fantasy painted' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: ICON_TO_UI_STYLE['fantasy-painted'],
    promptSuffix: 'Fantasy RPG hand-painted item icon, gold accents, ornate edges, rich warm palette, readable at small size',
  },
  {
    id: 'sci-fi-hud',
    label: { zh: '科幻 HUD', en: 'Sci-fi HUD' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: ICON_TO_UI_STYLE['sci-fi-hud'],
    promptSuffix: 'Sci-fi HUD item icon, cyan accent glow, dark metal hints, clean silhouette, holographic edge highlights',
  },
  {
    id: 'ui-cyber-neon',
    label: { zh: '赛博霓虹', en: 'Cyber neon' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: 'sci-fi',
    promptSuffix: 'Cyberpunk neon item icon, magenta and cyan glow edges, dark chrome body, high contrast, blade-runner inventory aesthetic',
  },
  {
    id: 'ui-modern-dark',
    label: { zh: '现代暗色', en: 'Modern dark' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: 'modern-dark',
    promptSuffix: 'Modern dark UI game item icon, glassy highlights, cold black base, amber accent rim light, crisp silhouette for inventory slot',
  },
  {
    id: 'ui-cute-cartoon',
    label: { zh: '可爱卡通', en: 'Cute cartoon' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: 'cute-cartoon',
    promptSuffix: 'Cute cartoon item icon, rounded shapes, pastel and candy colors, soft outline, friendly mobile game style',
  },
  {
    id: 'ui-fresh-pastoral',
    label: { zh: '清新田园', en: 'Fresh pastoral' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: 'fresh-pastoral',
    promptSuffix: 'Fresh pastoral hand-painted item icon, soft green and cream palette, gentle watercolor feel, cozy life-sim inventory',
  },
  {
    id: 'ui-watercolor',
    label: { zh: '水墨淡彩', en: 'Watercolor' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: 'fresh-pastoral',
    promptSuffix: 'Soft watercolor item icon, ink wash edges, muted earth tones, paper texture hint, elegant Asian fantasy inventory',
  },
  {
    id: 'ui-low-poly',
    label: { zh: '低多边形', en: 'Low poly' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: 'modern-minimal',
    promptSuffix: 'Low-poly 3D item icon, faceted geometric surfaces, flat shaded triangles, bold color blocks, indie game inventory',
  },
  {
    id: 'ui-realistic-military',
    label: { zh: '写实军事', en: 'Military realistic' },
    delivery: 'png-transparent',
    targetSize: 48,
    uiStyleId: 'realistic-military',
    promptSuffix: 'Realistic military item icon, matte olive and gunmetal, worn metal texture, tactical gear silhouette, muted palette',
  },
];

export function getStylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => p.id === id);
}

export function isPixelStyleId(id: string | undefined): boolean {
  if (!id) return false;
  return getStylePreset(id)?.delivery === 'png-pixel';
}

export function pickerStylePresets(): StylePreset[] {
  return STYLE_PRESETS.filter(
    (p) => p.showInPicker !== false
      && (p.delivery === 'png-pixel' || p.delivery === 'png-transparent'),
  );
}

/** 前端画风列表：以本地 catalog 为准，避免 Studio 未重载时 API 仍返回旧 5 项 */
export function resolvePickerStyles(serverStyles: StylePreset[] | undefined): StylePreset[] {
  const catalog = pickerStylePresets();
  if (!serverStyles?.length) return catalog;
  const serverById = new Map(serverStyles.map((s) => [s.id, s]));
  const merged = catalog.map((c) => ({ ...c, ...serverById.get(c.id) }));
  for (const s of serverStyles) {
    if (!merged.some((m) => m.id === s.id) && s.showInPicker !== false
      && (s.delivery === 'png-pixel' || s.delivery === 'png-transparent')) {
      merged.push(s);
    }
  }
  return merged;
}

export function toStylePresetHint(preset: StylePreset): StylePresetHint {
  return {
    id: preset.id,
    label: preset.label,
    delivery: preset.delivery,
    targetSize: preset.targetSize,
    promptSuffix: preset.promptSuffix,
    uiStyleId: preset.uiStyleId,
  };
}

function shortHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

/** ASCII-only slug safe for cross-platform file paths. */
export function toAsciiSlug(label: string, index = 0): string {
  const ascii = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (ascii.length >= 2) return ascii.slice(0, 48);
  return `item-${shortHash(`${label.trim()}#${index}`)}`;
}

export function slugifyFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/_+/g, '-');
  return toAsciiSlug(base);
}

export function inferAssetRole(slug: string): import('./types').AssetRole {
  if (slug.startsWith('weapon') || slug.includes('weapon')) return 'weapon';
  if (/^(armor|helmet|accessory|leo-armor)/.test(slug)) return 'equipment';
  if (/(pill|potion|fruit|flower|honey|dewdrop|spark|judgment)/.test(slug)) return 'consumable';
  if (/(ore|herb|grass)/.test(slug)) return 'material';
  if (/(proof|heart)/.test(slug)) return 'key-item';
  return 'consumable';
}

export function buildItemFromSlug(slug: string, iconPath: string): import('./types').ItemRecord {
  const en = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const role = inferAssetRole(slug);
  return {
    id: slug,
    slug,
    name: { zh: en, en },
    icon: iconPath,
    asset_role: role,
    categories: [role === 'weapon' ? 'weapons' : role === 'equipment' ? 'equipment' : role === 'material' ? 'materials' : 'consumables'],
    tags: slug.split('-').filter((t) => t && !/^\d+$/.test(t)),
    rarity: 'common',
    stackable: role === 'consumable' || role === 'material',
    maxStack: role === 'consumable' || role === 'material' ? 99 : 1,
    depicts: en,
  };
}

export function buildStylePrompt(depicts: string, style: StylePreset): string {
  const isPixel = style.delivery === 'png-pixel';
  return [
    `Single game inventory item icon: ${depicts}.`,
    style.promptSuffix,
    'Centered on solid #FFFFFF background for extraction. ONE object only.',
    isPixel
      ? 'Draw at FULL 1024×1024 as native pixel art (each color block is a solid square of pixels, zero blur); object fills 75–85% of the square frame.'
      : [
        'Painted illustration at 1024×1024 with smooth shading and clean outlines; object fills 70–85% of the square frame.',
        'ABSOLUTELY NOT pixel art — no retro sprite blocks, no chunky square pixels, no 8-bit mosaic.',
      ].join(' '),
    'NOT an app icon, NOT a badge, NOT a card frame, NOT UI screenshot.',
    'No text, no labels, no drop shadow stage, no rounded-square plate.',
    isPixel
      ? ''
      : 'No outer glow cloud, no magic aura halo, no colored light blob bleeding into the background.',
    `Must remain readable after downscaling to ${style.targetSize}px inventory slot.`,
  ].join(' ');
}
