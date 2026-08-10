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
 * const handle = mount(document.getElementById('host')!, {
 *   host: workbenchClient,
 *   inspectorEl: document.getElementById('inspector')!,
 *   onNodeSelect: (id) => console.log(id),
 * })
 * handle.unmount()
 * ```
 *
 * 进程内没有 parent iframe 可握手，宿主必须经 `options.host` 注入一个已就绪的
 * workbench client，否则 GameBootstrap 会卡在 `host.ready()`。
 *
 * 可选 `inspectorEl`：节点配置面板 portal 到该 DOM（画布内不再嵌面板）；
 * `onNodeSelect` 在选中/取消选中时回调。再传 `previewEl` 时视频预览与开关拉片
 * 拆到该 DOM（宿主自己定位、自己控宽），`onPreviewOpenChange` 回报展开态。
 * `unmount()` 同时卸画布根与两个宿主 slot 的内容。
 *
 * 可选 `docActionSlotEl`：文档头动作槽由 DocumentLibraryView 挂到 `.gdx-header`；
 * `openDocument` / `setPendingDocumentTypes` 供宿主驱动文档视图与侧栏角标。
 */
import { createRoot, type Root } from 'react-dom/client'
import { GraphApp } from './GraphApp'
import {
  applyHostInit,
  releaseHostInit,
  setInspectorActive,
  type WorkbenchInitOptions,
} from './host-init'
import type { DocumentType } from './editor/assets/registry-types'
import { useDocumentNav } from './editor/persist/documentNavStore'
import { topViewOf, useGraphView, type TopView } from './editor/persist/graphViewStore'
import { setPendingDocumentTypes as writePendingDocumentTypes } from './editor/persist/pendingDocumentsStore'
import { initLocaleSync } from './i18n'
import './styles/global.css'

export type { WorkbenchInitOptions }
export { forgeaxHttp, type RewriteRule } from './lib/forgeax-http'
export { applyHostInit } from './host-init'
export type { WorkbenchHostClient } from './lib/workbench-host'

/** 宿主顶栏两档切换器的档位；所有编辑视图共用 `workfile`。 */
export type GameVideoTopView = TopView

export interface GameVideoMountHandle {
  unmount(): void
  openDocument(type: DocumentType): void
  setPendingDocumentTypes(types: readonly DocumentType[]): void
  /**
   * 宿主插槽页签的激活态。宿主把 Agent 页签切到前台时传 false：节点面板不可见，
   * 预览抽屉与挂在画布上的开关拉片一并收起（拉片在扩展 DOM 里，宿主藏不掉）。
   */
  setInspectorActive(active: boolean): void
  getTopView(): GameVideoTopView
  /**
   * 顶栏两档切换。与侧栏「试玩」写的是同一个 view store，所以两处入口天然同步；
   * `'workfile'` 回到进试玩前的那个编辑视图，不硬编码回蓝图。
   */
  setTopView(view: GameVideoTopView): void
  /** 只在档位真的换了时回调——侧栏在编辑视图之间跳不该惊动顶栏。 */
  subscribeTopView(listener: (view: GameVideoTopView) => void): () => void
}

export function mount(
  rootEl: HTMLElement,
  options: WorkbenchInitOptions = {},
): GameVideoMountHandle {
  if (!rootEl) {
    throw new Error('[wb-game-video] mount() requires a non-null host element')
  }
  applyHostInit(options)
  initLocaleSync()
  // Portaled panels live in host-owned slots outside the React root. Give
  // every extension-owned mount surface the same scope so tokens/resets keep
  // working there without leaking back to the host document.
  const scopeElements = Array.from(new Set([
    rootEl,
    options.inspectorEl,
    options.previewEl,
    options.docActionSlotEl,
  ].filter((element): element is HTMLElement => element !== undefined)))
  const addedScopeElements = scopeElements.filter((element) => {
    if (element.classList.contains('ks-app-host')) return false
    element.classList.add('ks-app-host')
    return true
  })
  const reactRoot: Root = createRoot(rootEl)
  reactRoot.render(
    <GraphApp
      pane={options.pane}
      gameId={options.slug ?? undefined}
      autoInitialize={options.autoInitialize}
    />,
  )
  const inspectorEl = options.inspectorEl
  const previewEl = options.previewEl
  const docActionSlotEl = options.docActionSlotEl
  return {
    openDocument(type: DocumentType): void {
      useDocumentNav.getState().setDocumentType(type)
      useGraphView.getState().setView('documents')
    },
    setPendingDocumentTypes(types: readonly DocumentType[]): void {
      writePendingDocumentTypes(types)
    },
    setInspectorActive,
    getTopView(): GameVideoTopView {
      return topViewOf(useGraphView.getState().view)
    },
    setTopView(view: GameVideoTopView): void {
      useGraphView.getState().setTopView(view)
    },
    subscribeTopView(listener: (view: GameVideoTopView) => void): () => void {
      let current = topViewOf(useGraphView.getState().view)
      return useGraphView.subscribe((state) => {
        const next = topViewOf(state.view)
        if (next === current) return
        current = next
        listener(next)
      })
    },
    unmount: () => {
      reactRoot.unmount()
      addedScopeElements.forEach((element) => element.classList.remove('ks-app-host'))
      // Portal content unmounts with the canvas root; clear the host slots for remounts.
      if (inspectorEl) inspectorEl.replaceChildren()
      if (previewEl) previewEl.replaceChildren()
      if (docActionSlotEl) docActionSlotEl.replaceChildren()
      releaseHostInit()
    },
  }
}
