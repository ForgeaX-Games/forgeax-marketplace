import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from './App'
import { useScenarioStore } from './scenario/scenarioStore'
import { useShellStore } from './shell/shellStore'
import type { Scenario } from './scenario/types'
import './styles/global.css'

/**
 * Reel Studio —— workbench / 外部宿主集成入口。
 *
 * 典型用法：
 * ```ts
 * import { mount } from '@your-scope/reel-studio'
 * const handle = mount(document.getElementById('reel-host')!, {
 *   initialScenario: savedScenario,
 *   persistence: 'memory', // 不要把数据写回宿主的 localStorage
 * })
 * // 宿主 tab 切走时清理
 * handle.unmount()
 * ```
 *
 * 设计要点：
 *   - `mount()` 接受**宿主提供的 root 元素**（而不是像独立站点那样抓 #root）
 *   - 样式用 `.ks-app-host`，高度 100% 填满宿主容器（而不是 100vh）
 *   - `initialScenario` 立即 loadScenario 注入，避免闪烁出 demo 数据
 *   - `persistence: 'memory'` 跳过 bootScenarioPersist，让宿主决定持久化策略；
 *     `persistence: 'local'` 仍用内置 localStorage（默认行为）
 *   - `unmount()` 调 React root.unmount() 清 DOM，**不**重置 zustand store
 *     —— store 是模块单例，下次 mount 时自然复用；宿主需要完全重置可在调用
 *     unmount 后再手动 loadScenario(emptyScenario)
 */

export interface ReelMountOptions {
  initialScenario?: Scenario
  /**
   * 持久化策略：
   *   - 'local'（默认）：维持现 bootScenarioPersist 的 localStorage 行为
   *   - 'memory'：跳过持久化 boot，宿主自己管
   */
  persistence?: 'local' | 'memory'
}

export interface ReelMountHandle {
  unmount(): void
  /** 运行时替换 scenario —— 宿主切项目时不卸载整棵 React 树 */
  loadScenario(next: Scenario): void
  /** 单一函数出入口，避免宿主 import 内部 store */
  getSnapshot(): { scenario: Scenario; activeTab: string }
}

export function mount(rootEl: HTMLElement, opts: ReelMountOptions = {}): ReelMountHandle {
  if (!rootEl) {
    throw new Error('[reel-studio] mount() requires a non-null host element')
  }

  rootEl.classList.add('ks-app-host')

  if (opts.initialScenario) {
    useScenarioStore.getState().loadScenario(opts.initialScenario)
  }

  const reactRoot: Root = createRoot(rootEl)
  reactRoot.render(
    <StrictMode>
      <App hostOptions={{ persistence: opts.persistence ?? 'local' }} />
    </StrictMode>,
  )

  return {
    unmount: () => {
      reactRoot.unmount()
      rootEl.classList.remove('ks-app-host')
      // 关闭可能残留的 Inspector 抽屉，避免下次 mount 时状态漂移
      useShellStore.getState().setInspectorOpen(false)
    },
    loadScenario: (next) => {
      useScenarioStore.getState().loadScenario(next)
    },
    getSnapshot: () => ({
      scenario: useScenarioStore.getState().scenario,
      activeTab: useShellStore.getState().activeTab,
    }),
  }
}

export type { Scenario } from './scenario/types'
