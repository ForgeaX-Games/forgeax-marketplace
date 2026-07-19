import { create } from 'zustand'
import type { AdjustParams } from '../scenario/types'

/**
 * fxPresetStore —— 后期效果的「我的预设 / 收藏」全局库。
 *
 * 与 Scenario 解耦，存 localStorage：作者在 A 节点调好的滤镜/调节可以「存为我的预设」，
 * 到 B 节点（甚至别的项目）一键复用；收藏是对内置/自定义预设的置顶标记。
 */

const STORAGE_KEY = 'reel-studio.fx-presets.v1'

/** 作者自定义的画面预设（滤镜/调节合一，存一组 AdjustParams）。 */
export interface CustomFxPreset {
  id: string
  label: string
  params: AdjustParams
  createdAt: number
}

interface PersistShape {
  custom: CustomFxPreset[]
  /** 收藏的预设 id（内置或自定义）。 */
  favorites: string[]
}

const DEFAULT: PersistShape = { custom: [], favorites: [] }

function load(): PersistShape {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw) as Partial<PersistShape>
    return {
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
    }
  } catch {
    return DEFAULT
  }
}

function save(s: PersistShape): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch (e) {
    console.warn('[fxPresetStore] save failed:', e)
  }
}

interface FxPresetState extends PersistShape {
  /** 存一个新的自定义预设，返回其 id。 */
  addCustom: (label: string, params: AdjustParams) => string
  removeCustom: (id: string) => void
  renameCustom: (id: string, label: string) => void
  toggleFavorite: (id: string) => void
  isFavorite: (id: string) => boolean
}

export const useFxPresetStore = create<FxPresetState>((set, get) => ({
  ...load(),
  addCustom: (label, params) => {
    const id = `myfx_${Date.now().toString(36)}`
    const next = [
      ...get().custom,
      { id, label: label.trim() || '我的预设', params, createdAt: Date.now() },
    ]
    set({ custom: next })
    save({ custom: next, favorites: get().favorites })
    return id
  },
  removeCustom: (id) => {
    const next = get().custom.filter((p) => p.id !== id)
    const fav = get().favorites.filter((f) => f !== id)
    set({ custom: next, favorites: fav })
    save({ custom: next, favorites: fav })
  },
  renameCustom: (id, label) => {
    const next = get().custom.map((p) => (p.id === id ? { ...p, label } : p))
    set({ custom: next })
    save({ custom: next, favorites: get().favorites })
  },
  toggleFavorite: (id) => {
    const cur = get().favorites
    const next = cur.includes(id) ? cur.filter((f) => f !== id) : [...cur, id]
    set({ favorites: next })
    save({ custom: get().custom, favorites: next })
  },
  isFavorite: (id) => get().favorites.includes(id),
}))
