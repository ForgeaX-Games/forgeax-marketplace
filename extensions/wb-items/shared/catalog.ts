import type { StylePreset } from './types';

export const DEFAULT_ICON_SIZE = 48;
/** 图标规范化管线版本；逻辑变更时递增 */
export const ICON_NORMALIZE_REV = 7;

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'lucide-line',
    label: { zh: 'Lucide 线稿', en: 'Lucide line' },
    delivery: 'svg-lucide',
    targetSize: 24,
    promptSuffix: 'Lucide icon style, 2px stroke, round caps, minimal line art, no fill colors',
  },
  {
    id: 'pixel-48',
    label: { zh: '像素 48', en: 'Pixel 48' },
    delivery: 'png-pixel',
    targetSize: 48,
    promptSuffix: 'True pixel art RPG inventory icon at 1024×1024: hard 90° edges, NO anti-aliasing, NO smooth gradients, flat color blocks like upscaled 48px sprite, limited palette per material, high contrast silhouette',
  },
  {
    id: 'pixel-32',
    label: { zh: '像素 32', en: 'Pixel 32' },
    delivery: 'png-pixel',
    targetSize: 32,
    promptSuffix: 'Pixel art inventory icon, 32x32 logical pixels, retro RPG style',
  },
  {
    id: 'painted-flat',
    label: { zh: '平面彩绘', en: 'Painted flat' },
    delivery: 'png-transparent',
    targetSize: 48,
    promptSuffix: 'Flat painted game item icon, bold silhouette, soft shading, no UI frame',
  },
  {
    id: 'fantasy-painted',
    label: { zh: '奇幻手绘', en: 'Fantasy painted' },
    delivery: 'png-transparent',
    targetSize: 48,
    promptSuffix: 'Fantasy RPG hand-painted item icon, gold accents, readable at small size',
  },
  {
    id: 'sci-fi-hud',
    label: { zh: '科幻 HUD', en: 'Sci-fi HUD' },
    delivery: 'png-transparent',
    targetSize: 48,
    promptSuffix: 'Sci-fi HUD item icon, cyan accent glow, dark metal hints, clean silhouette',
  },
];

export function getStylePreset(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => p.id === id);
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
      : 'Object must fill ~70–85% of the square frame (minimal empty margin).',
    'NOT an app icon, NOT a badge, NOT a card frame, NOT UI screenshot.',
    'No text, no labels, no drop shadow stage, no rounded-square plate.',
    `Must remain readable after downscaling to ${style.targetSize}px inventory slot.`,
  ].join(' ');
}
