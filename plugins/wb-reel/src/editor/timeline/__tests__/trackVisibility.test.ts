import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  TRACK_KEYS,
  TRACK_PREFS_LEGACY_DIA_KEY,
  TRACK_PREFS_STORAGE_KEY,
  defaultTrackPrefs,
  loadTrackPrefs,
  parseTrackPrefs,
  saveTrackPrefs,
  serializeTrackPrefs,
  withTrack,
} from '../trackVisibility'

/**
 * 语义契约:
 *   1) 默认:视觉/音频/QTE 可见;trig/game/br 默认隐藏(沿用旧 VISIBLE_TRACKS)
 *   2) parse 容错:脏 JSON / 缺字段一律回默认,不抛
 *   3) 旧 DIA key 向后兼容:主 key 没写过 dia 时吃旧值;写过则以主 key 为准
 *   4) save → load round-trip;save 同步回写旧 DIA key
 *   5) localStorage 不可用时返回默认、不崩
 */

function installMemoryLocalStorage(): Map<string, string> {
  const store = new Map<string, string>()
  const mock: Storage = {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(k) {
      return store.has(k) ? (store.get(k) as string) : null
    },
    key(i) {
      return Array.from(store.keys())[i] ?? null
    },
    removeItem(k) {
      store.delete(k)
    },
    setItem(k, v) {
      store.set(k, String(v))
    },
  }
  Object.defineProperty(window, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  })
  return store
}

describe('defaultTrackPrefs · 默认三态', () => {
  it('视觉/音频/QTE 默认可见,trig/game/br 默认隐藏', () => {
    const d = defaultTrackPrefs()
    expect(d.video.visible).toBe(true)
    expect(d.dia.visible).toBe(true)
    expect(d.audio.visible).toBe(true)
    expect(d.qte.visible).toBe(true)
    expect(d.trig.visible).toBe(false)
    expect(d.game.visible).toBe(false)
    expect(d.br.visible).toBe(false)
  })

  it('默认 muted / locked 全 false', () => {
    const d = defaultTrackPrefs()
    for (const k of TRACK_KEYS) {
      expect(d[k].muted).toBe(false)
      expect(d[k].locked).toBe(false)
    }
  })
})

describe('parseTrackPrefs · 容错与合并', () => {
  it('null → 全默认', () => {
    const p = parseTrackPrefs(null)
    expect(p.video.visible).toBe(true)
    expect(p.trig.visible).toBe(false)
  })

  it('脏 JSON → 全默认,不抛', () => {
    expect(() => parseTrackPrefs('{not json')).not.toThrow()
    expect(parseTrackPrefs('{not json').dia.visible).toBe(true)
  })

  it('部分字段 → 仅覆盖给定字段,其余回默认', () => {
    const raw = serializeTrackPrefs(
      withTrack(defaultTrackPrefs(), 'audio', { muted: true }),
    )
    const p = parseTrackPrefs(raw)
    expect(p.audio.muted).toBe(true)
    expect(p.audio.visible).toBe(true)
    expect(p.video.muted).toBe(false)
  })

  it('旧 DIA key:主 key 没写过 dia → 吃旧值', () => {
    expect(parseTrackPrefs(null, 'false').dia.visible).toBe(false)
    expect(parseTrackPrefs(null, 'true').dia.visible).toBe(true)
  })

  it('旧 DIA key:主 key 写过 dia → 以主 key 为准', () => {
    const raw = serializeTrackPrefs(
      withTrack(defaultTrackPrefs(), 'dia', { visible: true }),
    )
    expect(parseTrackPrefs(raw, 'false').dia.visible).toBe(true)
  })
})

describe('loadTrackPrefs / saveTrackPrefs · localStorage 集成', () => {
  let storage: Map<string, string>
  beforeEach(() => {
    storage = installMemoryLocalStorage()
  })
  afterEach(() => {
    storage.clear()
  })

  it('首次 → 默认', () => {
    expect(loadTrackPrefs().video.visible).toBe(true)
  })

  it('save → load round-trip', () => {
    const next = withTrack(defaultTrackPrefs(), 'stk', { visible: false })
    saveTrackPrefs(next)
    expect(loadTrackPrefs().stk.visible).toBe(false)
  })

  it('save 同步回写旧 DIA key(Player 字幕兼容)', () => {
    saveTrackPrefs(withTrack(defaultTrackPrefs(), 'dia', { visible: false }))
    expect(storage.get(TRACK_PREFS_LEGACY_DIA_KEY)).toBe('false')
  })

  it('手动污染主 key → load 回退默认', () => {
    storage.set(TRACK_PREFS_STORAGE_KEY, 'garbage')
    expect(loadTrackPrefs().dia.visible).toBe(true)
  })
})
