/**
 * 新引擎（graph-only）的**视图路由 store** —— 左右两个 split-pane iframe
 * （`?pane=left` 侧栏 / `?pane=center` 主区）各是一个独立文档，靠这个 store +
 * BroadcastChannel 把「当前 tab」镜像同步：在 left pane 点「视频」，center pane
 * 立刻切到视频视图。对齐旧 App 的 crossPaneSync，但只同步 graph 视图这一个字段，
 * 完全不依赖旧 FMV（scenarioStore / shellStore）。
 */
import { create } from 'zustand'
import { gameKeySuffix } from './gameScope'

export type GraphView = 'documents' | 'graph' | 'video' | 'video-generate' | 'assets' | 'ui' | 'rule' | 'play'
const VIEWS: readonly GraphView[] = ['documents', 'graph', 'video', 'video-generate', 'assets', 'ui', 'rule', 'play']

// 按 game 隔离键 / 频道，避免同源多开不同 game 时跨 tab 串台。
// 后缀惰性求值：进程内挂载的 game 标识由宿主注入，晚于本模块求值。
const LS_KEY_BASE = 'wb-game-video:graph:view'
const CHANNEL_BASE = 'wb-game-video:graph:view-sync'

function lsKey(): string {
  return `${LS_KEY_BASE}${gameKeySuffix()}`
}

function readStored(): GraphView | null {
  try {
    const v = localStorage.getItem(lsKey())
    if (v && (VIEWS as readonly string[]).includes(v)) return v as GraphView
  } catch { /* sandbox / SSR */ }
  return null
}

interface GraphViewStore {
  view: GraphView
  setView: (v: GraphView) => void
}

export const useGraphView = create<GraphViewStore>((set) => ({
  view: readStored() ?? 'graph',
  setView: (v) =>
    set((s) => {
      if (s.view === v) return s
      try { localStorage.setItem(lsKey(), v) } catch { /* best-effort */ }
      broadcast(v)
      return { view: v }
    }),
}))

/* ─── 跨 pane 同步桥 ──────────────────────────────────────────────── */

let channel: BroadcastChannel | null = null
// 收到远端广播时置位，避免 setView 里再往回广播成回环。
let applyingRemote = false

function broadcast(v: GraphView): void {
  if (applyingRemote) return
  channel?.postMessage(v)
}

/**
 * 启用跨 pane 同步（仅 split-pane 嵌入态调用）。返回 dispose。
 * 独立运行（pane=null）不需要，也就不开 channel、零开销。
 */
export function installGraphViewSync(): () => void {
  // 模块求值时宿主可能还没注入 game 标识，此刻的键才是最终的，补一次 hydrate。
  const stored = readStored()
  if (stored) useGraphView.setState({ view: stored })
  if (typeof BroadcastChannel === 'undefined') return () => {}
  channel = new BroadcastChannel(`${CHANNEL_BASE}${gameKeySuffix()}`)
  channel.onmessage = (e: MessageEvent) => {
    const v = e.data
    if (!(VIEWS as readonly string[]).includes(v)) return
    applyingRemote = true
    try {
      try { localStorage.setItem(lsKey(), v) } catch { /* best-effort */ }
      useGraphView.setState({ view: v as GraphView })
    } finally {
      applyingRemote = false
    }
  }
  return () => {
    channel?.close()
    channel = null
  }
}
