import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bootScenarioPersist,
  __resetScenarioPersistForTest,
} from '../scenarioPersistBoot'
import { loadDb } from '../scenarioPersist'
import { useScenarioStore } from '../scenarioStore'
import { getDemoScenario, BUNDLED_DEMO_ID } from '../demoScenario'
import { __resetGameScopeForTest } from '../../shell/gameScope'

/**
 * 防污染回归 —— 对应用户反馈：
 *   "我新建了 1234 这个工程，但被之前的剧本素材污染了"
 *
 * 根因：新建 game（per-game 作用域、磁盘/本地库都为空）时，store 初值仍停在
 * **共享内置 demo（demo-001）**。用户在这张"看起来是新工程其实是 demo"的画布上
 * 生成图/视频，assetStore 把它们打上 meta.scenarioId='demo-001' 落进该 game 的
 * assets 目录 —— 于是新工程凭空多出几百张 demo-001 资产（1234 工程 745 张的来源）。
 *
 * 修复不变式：per-game 作用域、库为空、store 仍是 bundled demo 时，boot 必须把
 * store 换成一份**全新、id 唯一的空白剧本**（'新的故事'），绝不留在 demo-001 上。
 * 无 slug 的全局库行为保持不变（仍是 demo 体验）。
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
    getItem(k: string) {
      return store.has(k) ? (store.get(k) as string) : null
    },
    key(i: number) {
      return Array.from(store.keys())[i] ?? null
    },
    removeItem(k: string) {
      store.delete(k)
    },
    setItem(k: string, v: string) {
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

describe('scenarioPersistBoot · per-game 新建工程防污染', () => {
  let storage: Map<string, string>

  afterEach(() => {
    __resetScenarioPersistForTest()
    window.history.replaceState({}, '', '/')
    __resetGameScopeForTest()
    storage?.clear()
  })

  it('per-game 作用域 + 空库：store 从 demo-001 切到全新空白剧本（不留在 demo）', () => {
    window.history.replaceState({}, '', '/?slug=testgame')
    __resetGameScopeForTest()
    storage = installMemoryLocalStorage()
    __resetScenarioPersistForTest()
    useScenarioStore.getState().loadScenario(getDemoScenario())

    const dispose = bootScenarioPersist()
    try {
      const cur = useScenarioStore.getState().scenario
      expect(cur.id).not.toBe(BUNDLED_DEMO_ID)
      expect(cur.title).toBe('新的故事')

      // 库里入的是这份空白剧本，且 activeId 指向它 —— 后续生成的资产会被打上
      // 这份新 id，绝不会污染成 demo-001。
      const db = loadDb()
      expect(db.activeId).toBe(cur.id)
      expect(db.items.some((it) => it.id === BUNDLED_DEMO_ID)).toBe(false)
      expect(db.items.some((it) => it.id === cur.id)).toBe(true)
    } finally {
      dispose()
    }
  })

  it('无 slug 全局库：保持历史 demo 行为（仍是 demo-001）', () => {
    window.history.replaceState({}, '', '/')
    __resetGameScopeForTest()
    storage = installMemoryLocalStorage()
    __resetScenarioPersistForTest()
    useScenarioStore.getState().loadScenario(getDemoScenario())

    const dispose = bootScenarioPersist()
    try {
      expect(useScenarioStore.getState().scenario.id).toBe(BUNDLED_DEMO_ID)
    } finally {
      dispose()
    }
  })
})
