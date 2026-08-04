/**
 * 视频游戏工坊 —— 宿主在**进程内**嵌入时的挂载入口（graph-only）。
 *
 * 说明：主界面（interface）常规是通过 iframe 加载 `dist/index.html`（见 manifest
 * `entry.frontend` + split panes，URL 带 `?pane=left|center`）。这个 `mount()` 只服务
 * 于「宿主想在自己的 React 树里直接挂载」的备用路径，渲染的就是 `GraphApp`。
 *
 * 典型用法：
 * ```ts
 * import { mount } from '@forgeax-extension/wb-game-video'
 * const handle = mount(document.getElementById('host')!)
 * handle.unmount()
 * ```
 */
import { createRoot, type Root } from 'react-dom/client'
import { GraphApp } from './GraphApp'
import { initLocaleSync } from './i18n'
import './styles/global.css'

export interface GameVideoMountHandle {
  unmount(): void
}

export function mount(rootEl: HTMLElement): GameVideoMountHandle {
  if (!rootEl) {
    throw new Error('[wb-game-video] mount() requires a non-null host element')
  }
  initLocaleSync()
  rootEl.classList.add('ks-app-host')
  const reactRoot: Root = createRoot(rootEl)
  reactRoot.render(<GraphApp />)
  return {
    unmount: () => {
      reactRoot.unmount()
      rootEl.classList.remove('ks-app-host')
    },
  }
}
