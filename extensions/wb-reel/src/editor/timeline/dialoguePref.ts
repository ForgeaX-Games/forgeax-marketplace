/**
 * 时间轴「DIA（台词/字幕）轨可见性」的持久化偏好。
 *
 * 与 snapPref 并列的 UI 局部偏好。
 *
 * 默认值变更（2026-06-19）：原先默认 **隐藏**，导致作者生成/添加了台词却在时间轴
 * 与预览里都看不到（"时间轴为什么没台词"）。台词是影游的一等内容，理应默认可见，
 * 故改为默认 **显示**；不想看的作者点工具条 DIA 开关关掉即可，选择会被持久化。
 *
 * 同一开关同时作用于：
 *   · Timeline DIA 轨的渲染
 *   · StagePane 画面上方的字幕预览 band
 * 这样「时间轴里看不到 = 画面里也看不到」，符合直觉。
 *
 * key 命名沿用 "reel-studio.*.v1" 规范。注意：老用户若曾显式关过，localStorage 里
 * 存的是 'false'，仍会按其选择隐藏；只有"从未设置过"的才吃新默认值。
 */

const STORAGE_KEY = 'reel-studio.timeline.showDialogue.v1'

const DEFAULT_VISIBLE = true

export function parseDialoguePref(raw: string | null): boolean {
  if (raw === null) return DEFAULT_VISIBLE
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === 'true' || trimmed === '1') return true
  if (trimmed === 'false' || trimmed === '0') return false
  return DEFAULT_VISIBLE
}

export function serializeDialoguePref(visible: boolean): string {
  return visible ? 'true' : 'false'
}

export function loadDialoguePref(): boolean {
  if (typeof window === 'undefined') return DEFAULT_VISIBLE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return parseDialoguePref(raw)
  } catch {
    return DEFAULT_VISIBLE
  }
}

export function saveDialoguePref(visible: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeDialoguePref(visible))
  } catch {
    // 隐身 / 存储已满 —— 本轮会话仍按内存值工作
  }
}

export const DIALOGUE_PREF_STORAGE_KEY = STORAGE_KEY
export const DIALOGUE_PREF_DEFAULT = DEFAULT_VISIBLE
