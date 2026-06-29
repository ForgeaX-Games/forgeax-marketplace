// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'

/**
 * crossPaneSync · imageSection 跨 pane 镜像契约测试
 *
 * 「图像」视图下左侧栏切「风格/参考图/UI」时, center iframe 必须跟着切.
 * 根因曾是 crossPaneSync 漏同步 shellStore.imageSection, 这里把它固化下来.
 *
 * 用 happy-dom 是因为依赖浏览器原生 BroadcastChannel.
 */

const CHANNEL = 'forgeax:wb-reel:pane-sync'

// happy-dom 的 localStorage 在本环境被禁用 (启动日志: `--localstorage-file`
// 无有效路径), 而 shellStore 用 zustand persist(localStorage), 且
// createJSONStorage 在 store 创建(import)那一刻就抓住 storage 引用.
// 所以必须在 import store 之前把 localStorage 替换成内存实现; 用动态
// import + beforeAll 来保证顺序.
function installMemoryLocalStorage(): void {
  const mem = new Map<string, string>()
  const shim: Storage = {
    get length() {
      return mem.size
    },
    clear: () => mem.clear(),
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    key: (i: number) => Array.from(mem.keys())[i] ?? null,
    removeItem: (k: string) => void mem.delete(k),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
  }
  for (const target of [
    globalThis,
    (globalThis as { window?: unknown }).window,
  ]) {
    if (!target) continue
    try {
      Object.defineProperty(target, 'localStorage', {
        value: shim,
        configurable: true,
        writable: true,
      })
    } catch {
      /* non-configurable; ignore */
    }
  }
}

installMemoryLocalStorage()

type CrossPaneMod = typeof import('../crossPaneSync')
type ShellMod = typeof import('../shellStore')

let installCrossPaneSync: CrossPaneMod['installCrossPaneSync']
let useShellStore: ShellMod['useShellStore']

beforeAll(async () => {
  installMemoryLocalStorage()
  ;({ installCrossPaneSync } = await import('../crossPaneSync'))
  ;({ useShellStore } = await import('../shellStore'))
})

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('crossPaneSync · imageSection', () => {
  let dispose: () => void

  beforeEach(() => {
    useShellStore.setState({ imageSection: 'refs' })
    dispose = installCrossPaneSync()
  })

  afterEach(() => {
    dispose()
  })

  it('本地 setImageSection 后广播到其它 BroadcastChannel 实例', async () => {
    const peer = new BroadcastChannel(CHANNEL)
    const received: Array<{ imageSection?: string }> = []
    peer.addEventListener('message', (e: MessageEvent) => {
      const data = e.data as { patch?: { imageSection?: string } }
      if (data?.patch) received.push(data.patch)
    })

    useShellStore.getState().setImageSection('style')
    await nextTick()

    expect(received.some((p) => p.imageSection === 'style')).toBe(true)
    peer.close()
  })

  it('收到远端 patch.imageSection 后套用到本地 shellStore', async () => {
    const peer = new BroadcastChannel(CHANNEL)
    peer.postMessage({
      senderId: 'peer-fake',
      seq: 1,
      patch: { imageSection: 'ui' },
    })
    await nextTick()

    expect(useShellStore.getState().imageSection).toBe('ui')
    peer.close()
  })
})
