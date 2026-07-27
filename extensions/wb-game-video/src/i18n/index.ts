import { useSyncExternalStore } from 'react'

export type Locale = 'en' | 'zh'

const EN: Record<string, string> = {
  'common.cancel': 'Cancel',
  'common.processing': 'Processing…',
  'common.save': 'Save',
  'videoAssets.libraryAria': 'Video asset library',
  'videoAssets.title': 'Video assets',
  'videoAssets.upload': 'Upload video',
  'videoAssets.batchProgress': 'Batch {current}/{total}',
  'videoAssets.batchFailed':
    'Batch upload failed at “{name}”. {completed}/{total} files completed. Resolve the failed item, then select the remaining files again.',
  'videoAssets.uploadProgress': 'Uploading {progress}%',
  'videoAssets.completeFailed': 'Completion failed',
  'videoAssets.retryComplete': 'Retry upload completion',
  'videoAssets.retry': 'Retry',
  'videoAssets.refresh': 'Refresh video library',
  'videoAssets.loading': 'Loading video assets…',
  'videoAssets.empty': 'No video assets. Upload an MP4 or use a bundled video.',
  'videoAssets.loadMore': 'Load more videos',
  'videoAssets.loadingMore': 'Loading…',
  'videoAssets.group.upload': 'Uploaded',
  'videoAssets.group.battle': 'Battle',
  'videoAssets.group.narrative': 'Narrative',
  'videoAssets.group.generated': 'Generated',
  'videoAssets.status.generating': 'Generating…',
  'videoAssets.status.failed': 'Failed',
  'videoAssets.status.placeholder': 'Placeholder',
  'videoAssets.replace': 'Replace upload',
  'videoAssets.replacing': 'Uploading…',
  'videoAssets.replaceAria': 'Replace upload for {name}',
  'videoAssets.rename': 'Rename',
  'videoAssets.renameAria': 'Rename {name}',
  'videoAssets.renameTitle': 'Rename video asset',
  'videoAssets.name': 'Name',
  'videoAssets.emptyName': 'Video name cannot be empty',
  'videoAssets.renameFailed': 'Rename failed',
  'videoAssets.delete': 'Delete',
  'videoAssets.deleteAria': 'Delete {name}',
  'videoAssets.deleteTitle': 'Delete video asset',
  'videoAssets.confirmDelete': 'Confirm delete',
  'videoAssets.deleteFailed': 'Delete failed',
  'videoAssets.deleteUnused': 'Delete “{name}”? This action cannot be undone.',
  'videoAssets.deleteReferenced':
    '“{name}” is still referenced by these nodes:\n{references}\nDeleting it will not clear graph bindings, but the asset will no longer play. Continue?',
  'videoAssets.unexpectedError': 'Unexpected error',
}

const ZH: Record<string, string> = {
  'common.cancel': '取消',
  'common.processing': '处理中…',
  'common.save': '保存',
  'videoAssets.libraryAria': '视频素材库',
  'videoAssets.title': '视频素材',
  'videoAssets.upload': '上传视频',
  'videoAssets.batchProgress': '批量 {current}/{total}',
  'videoAssets.batchFailed':
    '批量上传在「{name}」失败，已完成 {completed}/{total} 个文件。请处理失败项后重新选择剩余文件。',
  'videoAssets.uploadProgress': '上传 {progress}%',
  'videoAssets.completeFailed': '完成失败',
  'videoAssets.retryComplete': '重试完成上传',
  'videoAssets.retry': '重试',
  'videoAssets.refresh': '刷新视频库',
  'videoAssets.loading': '加载视频素材…',
  'videoAssets.empty': '暂无视频素材。可上传 MP4 或使用内置视频。',
  'videoAssets.loadMore': '加载更多视频',
  'videoAssets.loadingMore': '加载中…',
  'videoAssets.group.upload': '上传',
  'videoAssets.group.battle': '战斗',
  'videoAssets.group.narrative': '叙事',
  'videoAssets.group.generated': '生成',
  'videoAssets.status.generating': '生成中…',
  'videoAssets.status.failed': '失败',
  'videoAssets.status.placeholder': '占位',
  'videoAssets.replace': '重新上传',
  'videoAssets.replacing': '上传中…',
  'videoAssets.replaceAria': '重新上传 {name}',
  'videoAssets.rename': '改名',
  'videoAssets.renameAria': '重命名 {name}',
  'videoAssets.renameTitle': '重命名视频素材',
  'videoAssets.name': '名称',
  'videoAssets.emptyName': '视频名称不能为空',
  'videoAssets.renameFailed': '重命名失败',
  'videoAssets.delete': '删除',
  'videoAssets.deleteAria': '删除 {name}',
  'videoAssets.deleteTitle': '删除视频素材',
  'videoAssets.confirmDelete': '确认删除',
  'videoAssets.deleteFailed': '删除失败',
  'videoAssets.deleteUnused': '确定删除「{name}」？此操作不可撤销。',
  'videoAssets.deleteReferenced':
    '「{name}」仍被以下节点引用：\n{references}\n删除后图内绑定不会自动清除，但素材将无法播放。确定删除？',
  'videoAssets.unexpectedError': '发生未知错误',
}

const CATALOGS: Record<Locale, Record<string, string>> = { en: EN, zh: ZH }
const LOCALE_KEY = 'forgeax.locale'
const LOCALE_MSG = 'forgeax:locale-changed'
const listeners = new Set<() => void>()
let current: Locale = 'en'
let wired = false

export function getLocale(): Locale {
  return current
}

export function setLocale(next: Locale): void {
  if (next === current) return
  current = next
  try {
    document.documentElement.lang = next === 'zh' ? 'zh-CN' : 'en'
  } catch { /* SSR */ }
  for (const listener of listeners) listener()
}

function readInitialLocale(): Locale {
  try {
    const url = new URLSearchParams(location.search).get('locale')
    if (url === 'en' || url === 'zh') return url
  } catch { /* SSR */ }
  try {
    const stored = localStorage.getItem(LOCALE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch { /* private mode */ }
  return 'en'
}

export function initLocaleSync(): void {
  setLocale(readInitialLocale())
  if (wired || typeof window === 'undefined') return
  wired = true
  window.addEventListener('storage', (event) => {
    if (event.key === LOCALE_KEY && (event.newValue === 'en' || event.newValue === 'zh')) {
      setLocale(event.newValue)
    }
  })
  window.addEventListener('message', (event) => {
    const data = event.data as { type?: string; locale?: string } | null
    if (data?.type === LOCALE_MSG && (data.locale === 'en' || data.locale === 'zh')) {
      setLocale(data.locale)
    }
  })
}

export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function t(key: string): string {
  return CATALOGS[current][key] ?? EN[key] ?? key
}

export function tf(key: string, vars: Record<string, string | number>): string {
  let message = t(key)
  for (const [name, value] of Object.entries(vars)) {
    message = message.replace(new RegExp(`\\{${name}\\}`, 'g'), String(value))
  }
  return message
}

export function useT(): typeof t {
  useSyncExternalStore(onLocaleChange, getLocale, getLocale)
  return t
}
