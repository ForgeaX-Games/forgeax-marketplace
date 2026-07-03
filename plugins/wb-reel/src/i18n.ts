import { useSyncExternalStore } from 'react';

export type Locale = 'en' | 'zh';

let current: Locale = 'en';
const listeners = new Set<() => void>();

const EN: Record<string, string> = {
  'workshop.title': 'FMV Workshop',
  'doc.unnamed': 'Untitled script',
  'doc.scenes': 'Scenes',
  'section.beats': 'Beats',
  'section.modules': 'Modules',
  'import.full': 'Import full script',
  'forge.hint': 'Script forge · edit in center pane',
  'tab.script': 'Script',
  'tab.image': 'Modules',
  'tab.tree': 'Story tree',
  'blank.title': 'New story',
  'blank.episode': 'Episode 1',
  'blank.scene': '01 · Start',
  'fx.title': 'Post-effects',
  'fx.expand': 'Expand effects panel',
  'fx.collapse': 'Collapse effects panel',
  'fx.effects': 'Effects',
  'fx.tab.transition': 'Transition',
  'fx.tab.effect': 'Effects',
  'fx.tab.sticker': 'Stickers',
  'fx.tab.filter': 'Filters',
  'fx.tab.adjust': 'Adjust',
  'fx.tab.clipAnim': 'Clip animation',
  'fx.tab.speed': 'Speed',
  'fx.tab.mine': 'Mine',
  'tree.legend.choice': 'Choice',
  'tree.legend.qtePass': 'QTE pass',
  'tree.legend.qteFail': 'QTE fail',
  'tree.legend.auto': 'Auto',
  'tree.addAfter': 'Create after this',
  'tree.addNode': 'New node',
  'tree.duplicate': 'Duplicate',
  'tree.ending': 'Ending',
  'tree.delete': 'Delete',
  'stage.noImage': 'NO IMAGE · Click the button below to generate',
  'stage.generating': 'Generating…',
  'stage.rendering': '↻ Rendering',
  'stage.regenerate': 'Generate',
  'timeline.videoEmpty': '· Video not generated yet · will align with the image track after generation ·',
  'timeline.shotsEmpty': '· No shots yet · auto-generated when splitting script in Forge ·',
  'assets.openLibrary': 'Open asset library',
  'assets.openLibraryTitle': 'Open asset library · generate and manage image/video assets for this node',
  'assets.emptyUpload': 'Click blank area / drag files here to upload',
  'assets.emptySub': 'Or generate in the asset library — items auto-save here',
  'assets.count': '{count} items · drag onto timeline',
};

const ZH: Record<string, string> = {
  'workshop.title': '影游工坊',
  'doc.unnamed': '未命名剧本',
  'doc.scenes': '场景',
  'section.beats': '段子',
  'section.modules': '模块',
  'import.full': '导入完整剧本',
  'forge.hint': '剧本锻造工作台 · 在中央内容区编辑/查看',
  'tab.script': '剧本',
  'tab.image': '模块',
  'tab.tree': '剧情树',
  'blank.title': '新的故事',
  'blank.episode': '第一集',
  'blank.scene': '01 · 开始',
  'fx.title': '后期效果',
  'fx.expand': '展开后期效果栏',
  'fx.collapse': '收起效果栏',
  'fx.effects': '效果',
  'fx.tab.transition': '转场',
  'fx.tab.effect': '特效',
  'fx.tab.sticker': '贴纸',
  'fx.tab.filter': '滤镜',
  'fx.tab.adjust': '调节',
  'fx.tab.clipAnim': '首尾动画',
  'fx.tab.speed': '变速',
  'fx.tab.mine': '我的',
  'tree.legend.choice': '选择',
  'tree.legend.qtePass': 'QTE 通过',
  'tree.legend.qteFail': 'QTE 失败',
  'tree.legend.auto': '自动',
  'tree.addAfter': '在此后新建',
  'tree.addNode': '新建节点',
  'tree.duplicate': '复制',
  'tree.ending': '结局',
  'tree.delete': '删除',
  'stage.noImage': 'NO IMAGE · 点击下方按钮生成',
  'stage.generating': '生成中…',
  'stage.rendering': '↻ 渲染中',
  'stage.regenerate': '生成',
  'timeline.videoEmpty': '· 尚未生成视频 · 生成后将铺到本轨（与下方图像对齐）·',
  'timeline.shotsEmpty': '· 尚未分镜 · 在 Forge 拆剧本时自动生成 ·',
  'assets.openLibrary': '打开素材库',
  'assets.openLibraryTitle': '打开素材库 · 为本节点智能生成/管理图像与视频素材',
  'assets.emptyUpload': '点击空白处 / 拖文件到这里上传',
  'assets.emptySub': '也可在「打开素材库」里生成后自动入库',
  'assets.count': '{count} 项 · 可拖入时间轴',
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
