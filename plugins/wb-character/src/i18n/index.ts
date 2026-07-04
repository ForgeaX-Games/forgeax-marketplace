import { UI_CATALOGS, type Locale } from './ui';

export type { Locale };

let current: Locale = 'en';

export function getLocale(): Locale {
  return current;
}

export function setLocale(next: Locale): void {
  if (next !== 'en' && next !== 'zh') return;
  if (next === current) return;
  current = next;
  try { document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'; } catch { /* */ }
  emit();
}

const listeners = new Set<() => void>();
function emit(): void { for (const fn of listeners) fn(); }

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initLocaleSync(): void {
  wireHostLocaleSync(setLocale);
}

const LOCALE_KEY = 'forgeax.locale';
const LOCALE_MSG = 'forgeax:locale-changed';

function readUrlLocale(): Locale | null {
  try {
    const url = new URLSearchParams(location.search).get('locale');
    if (url === 'en' || url === 'zh') return url;
  } catch { /* */ }
  return null;
}

function wireHostLocaleSync(apply: (l: Locale) => void): void {
  const url = readUrlLocale();
  if (url) apply(url);
  else {
    try {
      const raw = localStorage.getItem(LOCALE_KEY);
      if (raw === 'zh' || raw === 'en') apply(raw);
    } catch { /* */ }
  }
  if (typeof window === 'undefined') return;
  window.addEventListener('storage', (e) => {
    if (e.key === LOCALE_KEY && (e.newValue === 'en' || e.newValue === 'zh')) {
      apply(e.newValue);
    }
  });
  window.addEventListener('message', (e) => {
    const d = e.data as { type?: string; locale?: string } | null;
    if (!d || d.type !== LOCALE_MSG) return;
    if (d.locale === 'en' || d.locale === 'zh') apply(d.locale);
  });
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = UI_CATALOGS[current][key] ?? UI_CATALOGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}
