import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  SNAP_PREF_DEFAULT,
  SNAP_PREF_STORAGE_KEY,
  loadSnapPref,
  parseSnapPref,
  saveSnapPref,
  serializeSnapPref,
} from '../snapPref'

/**
 * 语义契约：
 *   1) 默认 enabled = true（新装用户拖东西有吸附，更符合不踩坑期望）
 *   2) parse 容错宽松 —— 'true'/'1'/'false'/'0' 都能识别；其它全回默认
 *   3) save → load 是身份映射（round-trip）
 *   4) localStorage 不可用（SSR / 抛异常）时返回默认、不崩
 */

// 内存 mock localStorage —— happy-dom 的 localStorage 在 vitest 下不稳定
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

describe('parseSnapPref · 磁盘字符串 → 布尔', () => {
  it('null（从未写过）→ 默认 true', () => {
    expect(parseSnapPref(null)).toBe(true)
  })

  it("'true' / '1' → true", () => {
    expect(parseSnapPref('true')).toBe(true)
    expect(parseSnapPref('1')).toBe(true)
  })

  it("'false' / '0' → false", () => {
    expect(parseSnapPref('false')).toBe(false)
    expect(parseSnapPref('0')).toBe(false)
  })

  it('大小写与空白不敏感', () => {
    expect(parseSnapPref('  TRUE  ')).toBe(true)
    expect(parseSnapPref('False')).toBe(false)
  })

  it('其它脏值 → 回退默认，不抛异常', () => {
    expect(parseSnapPref('yes')).toBe(SNAP_PREF_DEFAULT)
    expect(parseSnapPref('{}')).toBe(SNAP_PREF_DEFAULT)
    expect(parseSnapPref('')).toBe(SNAP_PREF_DEFAULT)
  })
})

describe('serializeSnapPref · 布尔 → 磁盘字符串', () => {
  it('"true" / "false"（人类可读，devtool 里能直接改）', () => {
    expect(serializeSnapPref(true)).toBe('true')
    expect(serializeSnapPref(false)).toBe('false')
  })

  it('serialize → parse round-trip 保身份', () => {
    for (const v of [true, false]) {
      expect(parseSnapPref(serializeSnapPref(v))).toBe(v)
    }
  })
})

describe('loadSnapPref / saveSnapPref · localStorage 集成', () => {
  let storage: Map<string, string>
  beforeEach(() => {
    storage = installMemoryLocalStorage()
  })

  afterEach(() => {
    storage.clear()
  })

  it('首次访问 → 返回默认 true', () => {
    expect(loadSnapPref()).toBe(true)
  })

  it('save(false) 后 load() 得到 false（会话间持久）', () => {
    saveSnapPref(false)
    expect(loadSnapPref()).toBe(false)
  })

  it('save(true) 后再 save(false) → 覆盖生效', () => {
    saveSnapPref(true)
    saveSnapPref(false)
    expect(loadSnapPref()).toBe(false)
  })

  it('手动污染存储为脏值 → load 回退默认', () => {
    storage.set(SNAP_PREF_STORAGE_KEY, 'maybe')
    expect(loadSnapPref()).toBe(SNAP_PREF_DEFAULT)
  })
})
