import { useSyncExternalStore } from 'react';
import type { ItemRecord, StylePreset } from '@shared/types';

export type Locale = 'en' | 'zh';

let current: Locale = 'en';
const listeners = new Set<() => void>();

const EN: Record<string, string> = {
  'page.title': 'Items & Icons',
  'form.title': 'Items & Icons',
  'form.requirementsLabel': 'Which icons do you want?',
  'form.requirementsPlaceholder': 'e.g.\nHealing potion, magic bread, iron ore\nLegendary weapon: dragon fang sword',
  'form.styleLabel': 'Art style',
  'form.stylePixelGroup': 'Pixel',
  'form.stylePaintedGroup': 'Painted / UI-aligned ({count})',
  'form.sizeLabel': 'Icon size',
  'form.refLabel': 'Reference images',
  'form.refHint': 'Upload style references — generation will follow their look and palette.',
  'form.refDrop': 'Drop or click to upload (max 5)',
  'form.refUploading': 'Uploading…',
  'form.refRemove': 'Remove reference',
  'form.refUploaded': 'Reference image uploaded',
  'form.confirm': 'Generate',
  'form.confirmBusy': 'Generating…',
  'messages.done': 'Done — {count} icon(s) added to the library',
  'messages.partial': 'Completed {saved}/{total}; retry the rest later',
  'messages.noOutput': 'No icons were generated. Check your description and try again.',
  'messages.failed': '{count} failed to generate — please retry',
  'messages.failedDetail': '{count} failed — {detail}',
  'messages.genFailed': 'Image generation failed. Check LiteLLM / image API settings.',
  'empty.noGame': 'Open a game project in Studio first.',
  'empty.noItems': 'No icons yet. Describe what you need on the left and click Generate.',
  'library.title': 'Icon library',
  'library.subtitle': '{count} items · {size}×{size}px · {style}',
  'library.searchPlaceholder': 'Search icons…',
  'library.noMatch': 'No matching icons. Try another keyword.',
  'preview.title': 'Icon preview',
  'preview.open': 'Click to enlarge',
  'preview.close': 'Close preview',
  'preview.hint': 'Transparent icon · Press Esc to close',
  'preview.ariaSep': ': ',
  'role.ui-glyph': 'UI',
  'role.consumable': 'Consumable',
  'role.equipment': 'Equipment',
  'role.weapon': 'Weapon',
  'role.material': 'Material',
  'role.currency': 'Currency',
  'role.quest': 'Quest',
  'role.key-item': 'Key item',
  'editor.title': 'Edit item',
  'editor.edit': 'Edit',
  'editor.nameZh': 'Chinese name',
  'editor.nameEn': 'English name',
  'editor.depicts': 'Icon description',
  'editor.styleLabel': 'Art style',
  'editor.promptLabel': 'Generation prompt',
  'editor.promptPlaceholder': 'Custom prompt overrides auto-generated text. Leave empty to use description + style.',
  'editor.promptHint': 'Click “Optimize” to refine the prompt with AI.',
  'editor.optimizePrompt': 'Optimize',
  'editor.optimizing': 'Optimizing…',
  'editor.regenerate': 'Regenerate icon ({size}px)',
  'editor.regenerating': 'Regenerating…',
  'editor.regenerated': 'Icon regenerated',
  'editor.refActive': 'Using reference images from the left panel',
  'editor.role': 'Item type',
  'editor.rarity': 'Rarity',
  'editor.stackable': 'Stackable',
  'editor.maxStack': 'Max stack',
  'editor.slugNote': 'Identifier (read-only)',
  'editor.save': 'Save',
  'editor.saving': 'Saving…',
  'editor.openInUi': 'Use in UI workshop',
  'editor.saved': 'Saved',
  'editor.delete': 'Delete item',
  'editor.deleteConfirm': 'Delete “{name}”? The icon file will be removed. This cannot be undone.',
  'editor.deleted': 'Deleted',
  'rarity.common': 'Common',
  'rarity.uncommon': 'Uncommon',
  'rarity.rare': 'Rare',
  'rarity.epic': 'Epic',
  'rarity.legendary': 'Legendary',
  'error.pluginReload': 'Plugin needs reload — refresh the page or restart Studio.',
  'error.toolNotFound': 'New tools are not loaded yet. Reloading plugins… If this persists, restart Studio.',
  'error.saveFailed': 'Failed to save icon file. Retry or use an English description.',
};

const ZH: Record<string, string> = {
  'page.title': '道具、图标',
  'form.title': '道具、图标',
  'form.requirementsLabel': '你想要哪些图标？',
  'form.requirementsPlaceholder': '例如：\n治疗药水、魔法面包、铁矿石\n传说武器：龙牙剑',
  'form.styleLabel': '画风',
  'form.stylePixelGroup': '像素',
  'form.stylePaintedGroup': '彩绘 / 对齐 UI 工坊（{count} 种）',
  'form.sizeLabel': '图标尺寸',
  'form.refLabel': '参考图',
  'form.refHint': '上传风格参考图，生成时会参考其造型与配色。',
  'form.refDrop': '拖拽或点击上传（最多 5 张）',
  'form.refUploading': '上传中…',
  'form.refRemove': '移除参考图',
  'form.refUploaded': '参考图已上传',
  'form.confirm': '确认生成',
  'form.confirmBusy': '正在生成…',
  'messages.done': '已完成，{count} 个图标已加入右侧图标库',
  'messages.partial': '完成了 {saved}/{total} 个，其余请稍后重试',
  'messages.noOutput': '暂时没能生成图标，请检查描述后重试',
  'messages.failed': '{count} 个未能生成，请重试',
  'messages.failedDetail': '{count} 个失败：{detail}',
  'messages.genFailed': '生图失败，请检查 Studio 的 LiteLLM / 图像 API 配置',
  'empty.noGame': '请先在 Studio 里打开一个游戏工程。',
  'empty.noItems': '还没有图标。在左侧写下需求并点击「确认生成」。',
  'library.title': '图标库',
  'library.subtitle': '共 {count} 个 · {size}×{size} 像素 · {style}',
  'library.searchPlaceholder': '搜索已有图标…',
  'library.noMatch': '没有匹配的图标，试试其他关键词。',
  'preview.title': '图标预览',
  'preview.open': '点击放大查看',
  'preview.close': '关闭预览',
  'preview.hint': '透明底图标 · 按 Esc 关闭',
  'preview.ariaSep': '：',
  'role.ui-glyph': '界面',
  'role.consumable': '消耗品',
  'role.equipment': '装备',
  'role.weapon': '武器',
  'role.material': '材料',
  'role.currency': '货币',
  'role.quest': '任务',
  'role.key-item': '关键道具',
  'editor.title': '编辑道具',
  'editor.edit': '编辑',
  'editor.nameZh': '中文名',
  'editor.nameEn': '英文名',
  'editor.depicts': '图标描述',
  'editor.styleLabel': '画风',
  'editor.promptLabel': '生图提示词',
  'editor.promptPlaceholder': '自定义提示词会覆盖自动生成的内容；留空则使用描述 + 画风。',
  'editor.promptHint': '点击「优化提示词」可用 AI 润色。',
  'editor.optimizePrompt': '优化提示词',
  'editor.optimizing': '优化中…',
  'editor.regenerate': '重新生成图标（{size}px）',
  'editor.regenerating': '正在重新生成…',
  'editor.regenerated': '图标已重新生成',
  'editor.refActive': '将使用左侧上传的参考图',
  'editor.role': '道具类型',
  'editor.rarity': '稀有度',
  'editor.stackable': '可堆叠',
  'editor.maxStack': '堆叠上限',
  'editor.slugNote': '标识符（只读）',
  'editor.save': '保存',
  'editor.saving': '保存中…',
  'editor.openInUi': '在 UI 工坊使用',
  'editor.saved': '已保存',
  'editor.delete': '删除道具',
  'editor.deleteConfirm': '确定删除「{name}」？图标文件也会一并删除，此操作不可撤销。',
  'editor.deleted': '已删除',
  'rarity.common': '普通',
  'rarity.uncommon': '优秀',
  'rarity.rare': '稀有',
  'rarity.epic': '史诗',
  'rarity.legendary': '传说',
  'error.pluginReload': '插件需要重新加载，请刷新页面或重启 Studio 后重试',
  'error.toolNotFound': '新功能尚未加载，正在尝试重载插件…若仍失败请重启 Studio',
  'error.saveFailed': '保存图标文件失败，请重试或换一个英文描述',
};

const LOCALE_KEY = 'forgeax.locale';
const LOCALE_MSG = 'forgeax:locale-changed';

function emit(): void {
  for (const fn of listeners) fn();
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next !== 'en' && next !== 'zh') return;
  if (next === current) return;
  current = next;
  emit();
}

function readInitialLocale(): Locale {
  try {
    const url = new URLSearchParams(location.search).get('locale');
    if (url === 'en' || url === 'zh') return url;
  } catch { /* */ }
  try {
    const raw = localStorage.getItem(LOCALE_KEY);
    if (raw === 'zh' || raw === 'en') return raw;
  } catch { /* */ }
  return 'en';
}

let wired = false;

export function initLocaleSync(): void {
  setLocale(readInitialLocale());
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('storage', (e) => {
    if (e.key === LOCALE_KEY && (e.newValue === 'en' || e.newValue === 'zh')) {
      setLocale(e.newValue);
    }
  });
  window.addEventListener('message', (e) => {
    const d = e.data as { type?: string; locale?: string } | null;
    if (!d || d.type !== LOCALE_MSG) return;
    if (d.locale === 'en' || d.locale === 'zh') setLocale(d.locale);
  });
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string): string {
  const cat = current === 'zh' ? ZH : EN;
  return cat[key] ?? EN[key] ?? key;
}

export function tf(key: string, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return s;
}

/** Re-render when host locale changes (React components). */
export function useT(): (key: string) => string {
  useSyncExternalStore(onLocaleChange, getLocale, getLocale);
  return t;
}

export function localizedItemName(item: Pick<ItemRecord, 'name'>): string {
  return getLocale() === 'zh' ? item.name.zh : (item.name.en || item.name.zh);
}

export function localizedStyleLabel(style: StylePreset): string {
  return getLocale() === 'zh' ? style.label.zh : style.label.en;
}

export function roleLabel(role: string): string {
  return t(`role.${role}`) !== `role.${role}` ? t(`role.${role}`) : role;
}

export function rarityLabel(rarity: string): string {
  return t(`rarity.${rarity}`) !== `rarity.${rarity}` ? t(`rarity.${rarity}`) : rarity;
}
