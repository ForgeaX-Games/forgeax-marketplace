import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bootScenarioPersist,
  flushScenarioPersist,
  __resetScenarioPersistForTest,
} from '../scenarioPersistBoot'
import {
  loadDb,
  saveDb,
  upsertScenario,
  __PERSIST_KEY__,
} from '../scenarioPersist'
import { useScenarioStore } from '../scenarioStore'
import { getDemoScenario } from '../demoScenario'
import type { Scenario } from '../types'

/**
 * happy-dom 20.x 的 localStorage 需要 --localstorage-file，不便配置；
 * 直接替换为内存 Mock —— 只要 API 兼容，saveDb/loadDb 都能正常工作
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

/**
 * 数据不丢失的回归测试 —— 对应用户反馈：
 *   "上传剧本后切 tab / 刷新回来东西全丢了，变回 demo 默认剧情树"
 *
 * 覆盖三条关键不变式：
 *   1. loadScenario / importJSON 后**立刻**落盘（不等 debounce），这样哪怕用户
 *      切完 tab 立刻刷新，新剧本也已经进了 localStorage
 *   2. boot 第二次调用（StrictMode 双调用 / HMR）不能覆盖用户刚刚改过的 store
 *      —— 检测到 store.scenario.id 不在 db.activeId 或 db 里没这份，要把 store
 *      作为真源 upsert 进 db，而不是反过来
 *   3. beforeunload 兜底刷盘：关页面/F5 前 flush 一次
 */

function makeScenario(id: string, title = `Scenario ${id}`): Scenario {
  return {
    id,
    title,
    version: 2,
    rootSceneId: 's1',
    scenes: {
      s1: {
        id: 's1',
        title: '起点',
        media: { kind: 'PLACEHOLDER' },
        branches: [],
      },
    },
    characters: {},
    locations: {},
    uiStyle: { prompt: '' },
    videoConfig: { provider: 'mock' },
    originIdea: '',
  } as unknown as Scenario
}

function rawDb(): string | null {
  try {
    return window.localStorage.getItem(__PERSIST_KEY__)
  } catch {
    return null
  }
}

describe('scenarioPersistBoot · 数据不丢失回归', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = installMemoryLocalStorage()
    __resetScenarioPersistForTest()
    // store 是模块级单例，前一个测试可能留下污染
    useScenarioStore.getState().loadScenario(getDemoScenario())
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    __resetScenarioPersistForTest()
    storage.clear()
  })

  it('loadScenario 后 —— 不等 debounce，立刻就有持久化痕迹', () => {
    const dispose = bootScenarioPersist()

    const next = makeScenario('new-scenario-1', '用户上传的剧本')
    useScenarioStore.getState().loadScenario(next)

    // 关键：此时还没推进时钟、debounce 还没触发，但 localStorage 已经有新剧本
    const persisted = rawDb()
    expect(persisted).not.toBeNull()
    expect(persisted).toContain('new-scenario-1')
    expect(persisted).toContain('用户上传的剧本')

    // activeId 也应该立刻切到新 id（否则下次 boot 又会加载旧的）
    const db = loadDb()
    expect(db.activeId).toBe('new-scenario-1')

    dispose()
  })

  it('importJSON 后 —— 立刻落盘，activeId 同步切换', () => {
    const dispose = bootScenarioPersist()

    const uploaded = makeScenario('imported-xyz', '从 JSON 导入')
    const err = useScenarioStore.getState().importJSON(JSON.stringify(uploaded))
    expect(err).toBeNull()

    const db = loadDb()
    expect(db.activeId).toBe('imported-xyz')
    expect(db.items.find((i) => i.id === 'imported-xyz')).toBeDefined()

    dispose()
  })

  it('StrictMode 双调用：重复 boot 不会用旧 active 覆盖 store 里的新剧本', () => {
    // 先铺一份"旧" active 到 localStorage（模拟上一次会话留下的）
    let db = upsertScenario(loadDb(), makeScenario('old-demo', '旧 demo'))
    saveDb(db)

    // 模拟"首次进入页面"——此时 store 是 demo 初值，db.active 是 old-demo。
    // 我们需要让 store 里的 scenario.id 不等于 old-demo，且 old-demo 在 db 里，
    // 这样才能走"用 active 恢复"分支。把 store 重置到一个 id 不存在于 db 的状态，
    // 等价于"真正的首次打开应用时 demo-001 还没写过"。
    // 方案：先把 store 临时换成 old-demo，然后 clear + 再放回 db —— 这样
    // boot 里的 storeInDb 会是 true（因为 store id 和 db id 都是 old-demo）。
    // 不，更简单：直接用 old-demo 当 store 当前值模拟"已经在 old-demo 上工作过"。
    useScenarioStore.getState().loadScenario(makeScenario('old-demo', '旧 demo'))

    // 第一次 boot：store = old-demo，db.active = old-demo，一致，什么都不做
    const dispose1 = bootScenarioPersist()
    expect(useScenarioStore.getState().scenario.id).toBe('old-demo')

    // 用户动作：importJSON 新剧本
    const newOne = makeScenario('fresh-upload', '刚上传的新剧本')
    useScenarioStore.getState().loadScenario(newOne)
    expect(useScenarioStore.getState().scenario.id).toBe('fresh-upload')
    // 立刻落盘应已发生
    db = loadDb()
    expect(db.activeId).toBe('fresh-upload')

    // 模拟 StrictMode cleanup → remount 的 boot 再跑一次
    dispose1()
    const dispose2 = bootScenarioPersist()

    // 关键断言：store 里仍是新剧本，没有被 boot 覆盖回 old-demo
    expect(useScenarioStore.getState().scenario.id).toBe('fresh-upload')

    dispose2()
  })

  it('手动 flushScenarioPersist —— beforeunload / 刷新前兜底', () => {
    const dispose = bootScenarioPersist()
    const s = makeScenario('pending-write', '待刷盘')
    useScenarioStore.getState().loadScenario(s)

    // 假设某个 action 只改了字段而没有调 loadScenario（比如拖节点），
    // 此时走 debounce 路径；但用户按 F5，beforeunload 要兜底 flush
    useScenarioStore.getState().setScenePos('s1', { x: 100, y: 200 })
    flushScenarioPersist()

    const db = loadDb()
    const persisted = db.items.find((i) => i.id === 'pending-write')
    expect(persisted).toBeDefined()
    // 单机实时同步模型：pos 直接写在 scenario 上
    expect(persisted!.scenario.scenes.s1!.pos).toEqual({ x: 100, y: 200 })

    dispose()
  })
})

/*
 * preferredScenarioId 选项 —— 对应"刷新别再跳到磁盘最新剧本"修复。
 *
 * 覆盖三件事：
 *   A. 提供 preferred 且 db 里有 → 加载 preferred 而不是 db.activeId
 *   B. 提供 preferred 但 db 里没有 → 静默回落到 pickActive 的 activeId（不抛）
 *   C. 不提供 preferred → 维持旧行为（pickActive）
 */
describe('scenarioPersistBoot · preferredScenarioId 选项', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = installMemoryLocalStorage()
    __resetScenarioPersistForTest()
    useScenarioStore.getState().loadScenario(getDemoScenario())
  })
  afterEach(() => {
    __resetScenarioPersistForTest()
    storage.clear()
  })

  it('A. preferred 在 db 里 → 加载 preferred，覆盖 db.activeId 默认', () => {
    // 铺三条进 db：demo-001（让 storeInDb=true）+ disk-active（被磁盘指为 active）+
    // prefer（用户意图加载这条）
    let db = upsertScenario(loadDb(), getDemoScenario())
    db = upsertScenario(db, makeScenario('scn-disk-active', '磁盘 activeId 那条'))
    db = upsertScenario(db, makeScenario('scn-prefer', '我刚才在编辑这条'))
    // 显式把 activeId 设回 disk-active（模拟"另一个客户端写过 activeId"的场景）
    db = { ...db, activeId: 'scn-disk-active' }
    saveDb(db)
    // store 保持 demo-001 模拟初始挂载
    useScenarioStore.getState().loadScenario(getDemoScenario())

    const dispose = bootScenarioPersist({ preferredScenarioId: 'scn-prefer' })
    try {
      expect(useScenarioStore.getState().scenario.id).toBe('scn-prefer')
      expect(useScenarioStore.getState().scenario.title).toBe('我刚才在编辑这条')
      expect(loadDb().activeId).toBe('scn-prefer')
    } finally {
      dispose()
    }
  })

  it('B. preferred 不在 db 里 → 静默回落到 db.activeId', () => {
    let db = upsertScenario(loadDb(), getDemoScenario())
    db = upsertScenario(db, makeScenario('scn-active', '磁盘 active'))
    db = { ...db, activeId: 'scn-active' }
    saveDb(db)
    useScenarioStore.getState().loadScenario(getDemoScenario())

    const dispose = bootScenarioPersist({
      preferredScenarioId: 'scn-does-not-exist',
    })
    try {
      // 回落到 active：scn-active
      expect(useScenarioStore.getState().scenario.id).toBe('scn-active')
    } finally {
      dispose()
    }
  })

  it('C. 不提供 preferred → 维持旧行为：加载 db.activeId', () => {
    let db = upsertScenario(loadDb(), getDemoScenario())
    db = upsertScenario(db, makeScenario('scn-active', '磁盘 active'))
    db = { ...db, activeId: 'scn-active' }
    saveDb(db)
    useScenarioStore.getState().loadScenario(getDemoScenario())

    const dispose = bootScenarioPersist()
    try {
      expect(useScenarioStore.getState().scenario.id).toBe('scn-active')
    } finally {
      dispose()
    }
  })
})

/*
 * bundled demo 不得抢占 activeId —— 对应用户反馈：
 *   "重启工程 / 刷新浏览器后，影游工坊回退成默认 demo 剧本，之前做的剧情树没了"
 *
 * 根因（日志证实）：boot 首屏 store=bundled demo-001；当 db.activeId 已被
 * 之前某轮污染成 demo-001（或 store 仍停在 demo 时 subscribe 写回 demo），
 * upsertScenario 无条件把 activeId 设成 demo-001 → 覆盖作者真实 active →
 * 自我强化的腐蚀循环，作者剧本永久丢失。
 *
 * 修复不变式：只要 db 里还存在 demo 之外的真实剧本，bundled demo 就不得成为
 * activeId（不论是 boot 读取还是写回）。
 */
describe('scenarioPersistBoot · bundled demo 不得抢占 activeId', () => {
  let storage: Map<string, string>

  beforeEach(() => {
    storage = installMemoryLocalStorage()
    __resetScenarioPersistForTest()
    useScenarioStore.getState().loadScenario(getDemoScenario())
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    __resetScenarioPersistForTest()
    storage.clear()
  })

  it('db.activeId 已被污染成 demo-001 但存在真实剧本 → boot 自愈到真实剧本', () => {
    // 模拟已被污染的磁盘/localStorage：有真实剧本「已读不回」，但 activeId 错指 demo
    let db = upsertScenario(loadDb(), makeScenario('narr-real', '已读不回'))
    db = upsertScenario(db, getDemoScenario())
    db = { ...db, activeId: 'demo-001' } // 污染
    saveDb(db)
    useScenarioStore.getState().loadScenario(getDemoScenario())

    const dispose = bootScenarioPersist()
    try {
      // 期望：boot 不被 demo 锁死，自愈加载真实剧本
      expect(useScenarioStore.getState().scenario.id).toBe('narr-real')
      // 且 db.activeId 被修正为真实剧本，不再是 demo
      expect(loadDb().activeId).toBe('narr-real')
    } finally {
      dispose()
    }
  })

  it('store 停在 bundled demo 时的写回 → 不得把 activeId 改成 demo-001', () => {
    // db 有真实剧本且 active 指向它
    let db = upsertScenario(loadDb(), makeScenario('narr-real', '已读不回'))
    db = upsertScenario(db, getDemoScenario())
    db = { ...db, activeId: 'narr-real' }
    saveDb(db)
    // boot 会把 store 切到 narr-real（active）。模拟之后又因某种原因 store 回到 demo：
    const dispose = bootScenarioPersist()
    try {
      // 直接 loadScenario(demo) 模拟"首屏 demo 被 subscribe 捕获写回"
      useScenarioStore.getState().loadScenario(getDemoScenario())
      vi.runAllTimers()
      // activeId 不应被 demo 抢占（db 里有真实剧本时）
      expect(loadDb().activeId).toBe('narr-real')
    } finally {
      dispose()
    }
  })
})
