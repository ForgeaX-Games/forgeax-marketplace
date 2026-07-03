import { UI_CATALOGS, type Locale } from './ui';

export type { Locale };

let current: Locale = 'en';
const listeners = new Set<() => void>();

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
  try {
    document.documentElement.lang = next;
  } catch { /* SSR */ }
  emit();
}

export function readHostLocale(): Locale {
  try {
    const url = new URLSearchParams(location.search).get('locale');
    if (url === 'en' || url === 'zh') return url;
  } catch { /* */ }
  try {
    const raw = window.localStorage.getItem('forgeax.locale');
    if (raw === 'zh' || raw === 'en') return raw;
  } catch { /* private mode */ }
  return 'en';
}

export function initLocaleFromHost(locale?: string): void {
  const next: Locale = locale === 'zh' ? 'zh' : locale === 'en' ? 'en' : readHostLocale();
  setLocale(next);
}

let storageWired = false;

export function initLocaleSync(): void {
  initLocaleFromHost();
  if (storageWired || typeof window === 'undefined') return;
  storageWired = true;
  window.addEventListener('storage', (e) => {
    if (e.key === 'forgeax.locale' && (e.newValue === 'en' || e.newValue === 'zh')) {
      setLocale(e.newValue);
    }
  });
  window.addEventListener('message', (e) => {
    const d = e.data as { type?: string; locale?: string } | null;
    if (!d || d.type !== 'forgeax:locale-changed') return;
    if (d.locale === 'en' || d.locale === 'zh') setLocale(d.locale);
  });
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: string): string {
  return UI_CATALOGS[current][key] ?? UI_CATALOGS.en[key] ?? key;
}

export function tf(key: string, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return s;
}

export function pipelineLabel(id: string, fallback: string): string {
  const key = `pipeline.${id}.name`;
  const hit = t(key);
  return hit === key ? fallback : hit;
}
