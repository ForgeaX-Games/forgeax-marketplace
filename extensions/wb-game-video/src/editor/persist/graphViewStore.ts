/**
 * 新引擎（graph-only）的**视图路由 store** —— 左右两个 split-pane iframe
 * （`?pane=left` 侧栏 / `?pane=center` 主区）各是一个独立文档，靠这个 store +
 * BroadcastChannel 把「当前 tab」镜像同步：在 left pane 点「视频」，center pane
 * 立刻切到视频视图。对齐旧 App 的 crossPaneSync，但只同步 graph 视图这一个字段，
 * 完全不依赖旧 FMV（scenarioStore / shellStore）。
 */
import { create } from 'zustand'

export type GraphView = 'graph' | 'video' | 'ui' | 'rule' | 'play'
const VIEWS: readonly GraphView[] = ['graph', 'video', 'ui', 'rule', 'play']

const LS_KEY = 'gamevideo:graph:view'
const CHANNEL = 'gamevideo:graph:view-sync'

function readInitial(): GraphView {
  try {
    const v = localStorage.getItem(LS_KEY)
    if (v && (VIEWS as readonly string[]).includes(v)) return v as GraphView
  } catch { /* sandbox / SSR */ }
  return 'graph'
}

interface GraphViewStore {
  view: GraphView
  setView: (v: GraphView) => void
}

export const useGraphView = create<GraphViewStore>((set) => ({
  view: readInitial(),
  setView: (v) =>
    set((s) => {
      if (s.view === v) return s
      try { localStorage.setItem(LS_KEY, v) } catch { /* best-effort */ }
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
  if (typeof BroadcastChannel === 'undefined') return () => {}
  channel = new BroadcastChannel(CHANNEL)
  channel.onmessage = (e: MessageEvent) => {
    const v = e.data
    if (!(VIEWS as readonly string[]).includes(v)) return
    applyingRemote = true
    try {
      try { localStorage.setItem(LS_KEY, v) } catch { /* best-effort */ }
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
