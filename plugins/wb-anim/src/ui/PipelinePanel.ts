import type { IPipeline, PipelineContext, PipelinePanels, PipelineMeta } from '../core/types'
import type { PipelineRegistry } from '../core/PipelineRegistry'
import type { Engine } from '../core/Engine'
import type { CameraStore } from '../core/CameraStore'
import type { PreviewControls } from './PreviewControls'
import { globalState } from '../shared/GlobalState'

function pipelineIcon(id: string, cls = 'pipeline-icon-svg'): string {
  const paths: Record<string, string> = {
    'pixel-char': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    spine: '<path d="M12 2v20"/><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/><path d="M12 12 6 8M12 12l6-4M12 19l-5 3M12 19l5 3"/>',
    video: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 5v14M16 5v14M4 9h16M4 15h16"/>',
    'vehicle-design': '<path d="M4 14h16l-2-5H6l-2 5Z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M7 9V6h10v3"/>',
    default: '<path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="M3 13l9 5 9-5"/>',
  }
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[id] ?? paths.default}</svg>`
}

export interface ExtraPanels {
  center: HTMLElement
  right: HTMLElement
  bottom: HTMLElement
  toolbar: HTMLElement
}

export interface SceneDeps {
  engine: Engine
  previewControls: PreviewControls
  cameraStore: CameraStore
  sceneManager: import('../core/SceneManager').SceneManager
}

export class PipelinePanel {
  private tabsContainer: HTMLElement
  private leftPanel: HTMLElement
  private extra: ExtraPanels
  private registry: PipelineRegistry
  private context: PipelineContext
  private scene: SceneDeps
  private activePipeline: IPipeline | null = null
  private activeId: string | null = null
  private tabEls: Map<string, HTMLElement> = new Map()
  private unsub: (() => void) | null = null

  // Module 16 split-pane sync — wb-anim 在 Studio 主壳里被切成两个同源 iframe
  // (?pane=left, ?pane=center)，每个 iframe 都跑独立的 PipelinePanel。
  // 用户在任一 iframe 点 tab，必须把切换信号广播给另一份实例，否则两个面板
  // 各自激活不同的 pipeline，左侧编辑 UI 与中间画布不匹配。
  // 详见 pixel-char/index.ts 同名注释。
  private _bc: BroadcastChannel | null = null
  private _bcSelfId = Math.random().toString(36).slice(2, 10)
  private _applyingBroadcast = false

  constructor(
    topbar: HTMLElement,
    leftPanel: HTMLElement,
    extra: ExtraPanels,
    registry: PipelineRegistry,
    context: PipelineContext,
    sceneDeps: SceneDeps,
  ) {
    this.leftPanel = leftPanel
    this.extra = extra
    this.registry = registry
    this.context = context
    this.scene = sceneDeps

    this.tabsContainer = document.createElement('div')
    this.tabsContainer.className = 'pipeline-tabs'
    topbar.appendChild(this.tabsContainer)
  }

  render(): void {
    this.tabsContainer.innerHTML = ''
    this.tabEls.clear()

    // 主 tab（placement='main'）—— 动画工作台主流水线全部平铺到顶栏。
    // 顺序与角色设计（wb-character）的角色 tab 对齐：角色类（主角/NPC/怪物 →
    // 像素角色 / Spine / 视频）在前，载具单独成类、排最后，和设计端「…/载具」
    // 的末位一致，避免用户在两个工作台间切换时载具位置跳来跳去。
    const MAIN_TAB_ORDER = ['pixel-char', 'spine', 'video', 'vehicle-design']
    const mainMetas = this.registry.getByPlacement('main').sort((a, b) => {
      const ai = MAIN_TAB_ORDER.indexOf(a.id)
      const bi = MAIN_TAB_ORDER.indexOf(b.id)
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
    })
    for (const m of mainMetas) {
      const tab = document.createElement('button')
      tab.className = 'pipeline-tab main-tab'
      tab.innerHTML = `<span class="tab-icon">${pipelineIcon(m.id)}</span>${m.name}`
      tab.addEventListener('click', () => { void this.activate(m) })
      this.tabsContainer.appendChild(tab)
      this.tabEls.set(m.id, tab)
    }

    // 右侧弹性撑开——历史上「更多模块」贴右；现在 drawer 已经全部展开
    // 到主 tab，spacer 留着保险，未来再加 placement='drawer' 的管线时
    // buildMoreDrawer() 会自然回来。
    const spacer = document.createElement('div')
    spacer.className = 'tab-spacer'
    this.tabsContainer.appendChild(spacer)

    this.buildMoreDrawer()

    this.updateBadge()
    this.unsub = globalState.subscribe(() => this.updateBadge())

    window.addEventListener('ce:switch-pipeline', ((e: CustomEvent) => {
      const id = e.detail?.id
      const target = id
        ? this.registry.getMeta(id)
        : this.registry.getByPlacement('main')[0]
      if (!target) return
      void this.activate(target, { reset: true })
    }) as EventListener)

    this.setupSplitPaneSync()

    // 默认激活第一个 main 管线。但若宿主已写入跨工作台交接信号且 role=vehicle,
    // 直接默认激活「载具动画」——避免先激活 pixel-char 再被 consumeAnimHandoff
    // 的 switch 事件覆盖时出现竞态(切不过去就停在像素角色)。
    if (mainMetas.length > 0) {
      const initial = this.resolveInitialPipeline(mainMetas)
      void this.activate(initial, { reset: true })
    }
  }

  /** 读 localStorage 交接信号,若标记 role=vehicle 且 vehicle-design 已注册,
   *  则把它作为初始管线;否则用第一个 main 管线(pixel-char)。 */
  private resolveInitialPipeline(mainMetas: PipelineMeta[]): PipelineMeta {
    try {
      const raw = localStorage.getItem('forgeax:anim-handoff')
      if (raw) {
        const sig = JSON.parse(raw) as { role?: string }
        if (sig?.role === 'vehicle') {
          // 同步标记 upstream,确保 vehicle-design.mount() 立刻能把
          // characterImage 同步成 designImage(consumeAnimHandoff 是 async,
          // 此处 mount 早于它执行,不能依赖它来设 upstreamRole)。
          globalState.setUpstreamRole('vehicle')
          const vd = this.registry.getMeta('vehicle-design')
          if (vd) return vd
        }
      }
    } catch { /* 信号不可读 — 退回默认 */ }
    return mainMetas[0]
  }

  /** 跨同源 iframe (?pane=left | ?pane=center) 同步活跃 tab。
   *  广播自己 activate 的 pipeline id；收到对方广播时静默切到对应 tab，
   *  不再回播（用 _applyingBroadcast guard）。 */
  private setupSplitPaneSync(): void {
    try {
      this._bc = new BroadcastChannel('forgeax-plugin.@forgeax-plugin/wb-anim.active-pipeline')
    } catch {
      this._bc = null
      return
    }
    this._bc.onmessage = (e: MessageEvent) => {
      const data = e.data
      if (!data || data.from === this._bcSelfId) return
      const id = data.id
      if (!id || id === this.activeId) return
      const target = this.registry.getMeta(id)
      if (!target) return
      this._applyingBroadcast = true
      void this.activate(target).finally(() => { this._applyingBroadcast = false })
    }
  }

  private broadcastActive(id: string): void {
    if (!this._bc || this._applyingBroadcast) return
    try { this._bc.postMessage({ from: this._bcSelfId, id }) } catch { /* ignore */ }
  }

  /**
   * 「⋯ 更多模块 ▾」抽屉——右上角一个按钮，点开后列出所有 `placement='drawer'`
   * 的管线，按 `meta.group` 分到「生产变体」/「辅助工具」两组（缺省 `'variant'`）。
   */
  private buildMoreDrawer(): void {
    const drawerPipelines = this.registry.getByPlacement('drawer')
    if (drawerPipelines.length === 0) return

    const wrap = document.createElement('div')
    wrap.className = 'pipeline-drawer-wrap'

    const trigger = document.createElement('button')
    trigger.className = 'pipeline-tab drawer-trigger'
    trigger.innerHTML = '<span class="tab-icon">⋯</span>更多模块 <span class="drawer-chevron">▾</span>'
    wrap.appendChild(trigger)

    const panel = document.createElement('div')
    panel.className = 'pipeline-drawer'
    panel.style.display = 'none'

    const groupHead = (text: string) => {
      const h = document.createElement('div')
      h.className = 'pipeline-drawer-group'
      h.textContent = text
      return h
    }
    const item = (meta: PipelineMeta, onClick: () => void) => {
      const it = document.createElement('button')
      it.className = 'pipeline-drawer-item'
      it.innerHTML = `<span class="pipeline-drawer-icon">${pipelineIcon(meta.id)}</span>` +
        `<span class="pipeline-drawer-text"><span class="pipeline-drawer-name">${meta.name}</span>` +
        `<span class="pipeline-drawer-desc">${meta.description}</span></span>`
      it.addEventListener('click', () => { panel.style.display = 'none'; onClick() })
      return it
    }

    const variantGroup: PipelineMeta[] = []
    const auxGroup: PipelineMeta[] = []
    for (const m of drawerPipelines) {
      if (m.group === 'aux') auxGroup.push(m)
      else variantGroup.push(m)
    }

    if (variantGroup.length) {
      panel.appendChild(groupHead('生产变体'))
      for (const m of variantGroup) {
        panel.appendChild(item(m, () => { void this.activate(m) }))
        this.tabEls.set(m.id, trigger)
      }
    }

    if (auxGroup.length) {
      panel.appendChild(groupHead('辅助工具'))
      for (const m of auxGroup) {
        panel.appendChild(item(m, () => { void this.activate(m) }))
        this.tabEls.set(m.id, trigger)
      }
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation()
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none'
    })
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target as Node)) panel.style.display = 'none'
    }, true)

    wrap.appendChild(panel)
    this.tabsContainer.appendChild(wrap)
  }

  private async activate(meta: PipelineMeta, opts: { reset?: boolean } = {}): Promise<void> {
    this.leaveCurrentMode()
    this.clearPanels()
    this.setActiveTab(meta.id)
    this.activeId = meta.id
    this.broadcastActive(meta.id)
    this.showLoadingHint(meta)

    let pipeline: IPipeline | undefined
    let loadErr: unknown
    try {
      pipeline = await this.registry.load(meta.id)
    } catch (err) {
      loadErr = err
      console.warn('[PipelinePanel] load failed:', meta.id, err)
    }
    if (!pipeline) {
      this.showLoadError(meta, loadErr)
      return
    }

    // 用户在 await 期间可能已经切到别的 tab/设计页 —— 放弃这次 mount。
    if (this.activeId !== meta.id) return

    if (opts.reset) {
      try { await pipeline.resetForNewCharacter?.() }
      catch (err) { console.warn('[PipelinePanel] resetForNewCharacter failed:', err) }
      if (this.activeId !== meta.id) return
    }

    this.activePipeline = pipeline
    try {
      await pipeline.init(this.context)
    } catch (err) {
      // init() 抛错以前会冒泡成未处理 rejection、UI 卡在「加载中…」转圈,
      // 用户只看到永远转圈、不知所以。现在显式兜底 → 展示真实错误。
      console.error('[PipelinePanel] init failed:', meta.id, err)
      this.activePipeline = null
      this.showLoadError(meta, err)
      return
    }
    if (this.activeId !== meta.id) {
      pipeline.dispose()
      this.activePipeline = null
      return
    }

    const panels: PipelinePanels = {
      left: this.leftPanel,
      center: this.extra.center,
      right: this.extra.right,
      bottom: this.extra.bottom,
      toolbar: this.extra.toolbar,
    }
    this.clearLoadingHint()
    pipeline.createUI(this.leftPanel, panels)
  }

  /** 懒加载期间在左面板里给一个轻量「加载中」提示,大模块第一次 import
   *  可能要 0.5–1s,空白会让人以为卡死。 */
  private showLoadingHint(meta: PipelineMeta): void {
    this.leftPanel.innerHTML = `
      <div class="pipeline-loading">
        <div class="pipeline-loading-spinner"></div>
        <div class="pipeline-loading-text">${pipelineIcon(meta.id)}${meta.name} 加载中…</div>
      </div>
    `
  }

  private clearLoadingHint(): void {
    this.leftPanel.innerHTML = ''
  }

  private showLoadError(meta: PipelineMeta, err?: unknown): void {
    const detail = err
      ? (err instanceof Error ? `${err.name}: ${err.message}` : String(err))
      : ''
    const stack = err instanceof Error && err.stack ? err.stack : ''
    this.leftPanel.innerHTML = `
      <div class="pipeline-loading pipeline-loading-error">
        ⚠️ 加载失败:${meta.id}
        ${detail ? `<div style="margin-top:8px;font-size:12px;color:#ff8888;word-break:break-all;max-width:420px">${escapeHtml(detail)}</div>` : ''}
        ${stack ? `<details style="margin-top:8px;max-width:440px"><summary style="font-size:11px;opacity:0.7;cursor:pointer">堆栈详情</summary><pre style="font-size:10px;opacity:0.7;white-space:pre-wrap;word-break:break-all;text-align:left">${escapeHtml(stack)}</pre></details>` : '<div style="margin-top:8px;font-size:12px;opacity:0.7">查看控制台获取详情</div>'}
      </div>
    `
  }

  private leaveCurrentMode(): void {
    if (this.activePipeline) {
      this.activePipeline.destroyUI()
      this.activePipeline.dispose()
      this.activePipeline = null
    }
    this.activeId = null
  }

  private setActiveTab(id: string): void {
    this.tabEls.forEach((el, tid) => {
      el.classList.toggle('active', tid === id)
    })
  }

  private updateBadge(): void {
    const has = globalState.hasCharacter
    this.tabEls.forEach(el => el.classList.toggle('needs-char', !has))
  }

  private clearPanels(): void {
    this.leftPanel.innerHTML = ''
    this.extra.center.innerHTML = ''
    this.extra.center.classList.remove('active')
    this.extra.center.classList.remove('has-toolbar')
    this.extra.center.classList.remove('has-bottom')
    this.extra.toolbar.innerHTML = ''
    this.extra.toolbar.classList.remove('active')
    this.extra.right.innerHTML = ''
    this.extra.right.classList.remove('visible')
    this.extra.bottom.innerHTML = ''
    this.extra.bottom.classList.remove('visible')

    const centerParent = this.extra.center.parentElement
    if (centerParent) centerParent.classList.remove('has-right')
    this.extra.bottom.classList.remove('has-right')
  }

  dispose(): void {
    this.unsub?.()
    this.leaveCurrentMode()
    this.clearPanels()
    this.tabsContainer.remove()
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
