import { useEffect, useState } from 'react'
import { getLocale, onLocaleChange, registerCatalog, setLocale, t, type Locale } from '@forgeax/i18n'

const EN = {
  title: 'Projects',
  countTitle: '{count} total',
  countActiveTitle: '{count} total · {active} active',
  countActive: ' · {active} active',
  new: '+ New',
  filterPlaceholder: 'Filter projects…',
  filterAria: 'Filter projects',
  scopeLabel: 'Scope',
  scopeAllGames: 'All games',
  scopeToggleToAll: 'Show projects from all games',
  scopeToggleToGame: 'Scope to game "{game}"',
  statusExecuting: 'Executing',
  statusPipeline: 'Pipeline',
  statusViewCanvas: '{name} — click to view canvas',
  statusExpand: '{count} active — show',
  statusCollapse: 'Hide activity',
  emptyNone: 'No projects yet — create one.',
  emptyFilter: 'No projects match filter.',
  created: 'Created {when}',
  edited: 'Edited {when}',
  rename: 'Rename',
  delete: 'Delete',
  deleteDisabled: 'Cannot delete the last project',
  save: 'Save project as JSON',
} as const

const ZH = {
  title: '项目',
  countTitle: '共 {count} 个',
  countActiveTitle: '共 {count} 个 · {active} 个活动中',
  countActive: ' · {active} 个活动中',
  new: '+ 新建',
  filterPlaceholder: '筛选项目…',
  filterAria: '筛选项目',
  scopeLabel: '范围',
  scopeAllGames: '全部游戏',
  scopeToggleToAll: '显示所有游戏的项目',
  scopeToggleToGame: '仅显示游戏「{game}」的项目',
  statusExecuting: '执行中',
  statusPipeline: '管线',
  statusViewCanvas: '{name} — 点击查看画布',
  statusExpand: '{count} 个活动中 — 展开',
  statusCollapse: '收起活动状态',
  emptyNone: '暂无项目 — 请新建一个。',
  emptyFilter: '没有匹配的项目。',
  created: '创建于 {when}',
  edited: '编辑于 {when}',
  rename: '重命名',
  delete: '删除',
  deleteDisabled: '无法删除最后一个项目',
  save: '保存项目为 JSON',
} as const

/** Studio interface persists locale here — stay in sync, never guess from navigator. */
const STUDIO_LOCALE_KEY = 'forgeax.locale'

let registered = false

function readStudioLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  try {
    const raw = window.localStorage.getItem(STUDIO_LOCALE_KEY)
    if (raw === 'zh' || raw === 'en') return raw
  } catch {
    /* private mode */
  }
  return 'en'
}

function syncLocaleFromStudio(): void {
  setLocale(readStudioLocale())
}

export function ensureProjectI18n(): void {
  if (registered) return
  registered = true
  registerCatalog('en', 'projects', EN)
  registerCatalog('zh', 'projects', ZH)
  syncLocaleFromStudio()
}

export function useProjectLocale(): Locale {
  ensureProjectI18n()
  const [locale, setLocaleState] = useState(getLocale)
  useEffect(() => {
    const unsub = onLocaleChange(setLocaleState)
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === STUDIO_LOCALE_KEY) syncLocaleFromStudio()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      unsub()
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return locale
}

export function pt(key: keyof typeof EN, vars?: Record<string, string | number>): string {
  ensureProjectI18n()
  return t(`projects.${key}`, vars)
}

export function intlLocaleOf(locale: Locale): string {
  return locale === 'zh' ? 'zh-CN' : 'en'
}

/** Locale-aware relative or short date for project cards. */
export function formatWhen(iso: string | undefined, locale: Locale): string | null {
  if (!iso?.trim()) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  const intlLocale = intlLocaleOf(locale)
  const diffMs = Date.now() - date.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffDays < 7) {
    const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: 'auto' })
    const diffSec = Math.round((date.getTime() - Date.now()) / 1000)
    if (Math.abs(diffSec) < 45) return rtf.format(0, 'second')
    const diffMin = Math.round(diffSec / 60)
    if (Math.abs(diffMin) < 60) return rtf.format(diffMin, 'minute')
    const diffHr = Math.round(diffSec / 3_600)
    if (Math.abs(diffHr) < 24) return rtf.format(diffHr, 'hour')
    return rtf.format(Math.round(diffSec / 86_400), 'day')
  }

  return new Intl.DateTimeFormat(intlLocale, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  }).format(date)
}

export function formatWhenFull(iso: string | undefined, locale: Locale): string | null {
  if (!iso?.trim()) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(intlLocaleOf(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatProjectTimestamp(
  iso: string | undefined,
  kind: 'created' | 'edited',
  locale: Locale,
): string | null {
  const when = formatWhen(iso, locale)
  if (!when) return null
  return pt(kind, { when })
}
