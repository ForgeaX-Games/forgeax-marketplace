import type { IPipeline, PipelineContext, PipelinePanels, PipelineMeta } from '../core/types'
import type { PipelineRegistry } from '../core/PipelineRegistry'
import type { Engine } from '../core/Engine'
import type { CameraStore } from '../core/CameraStore'
import type { PreviewControls } from './PreviewControls'
import type { CharacterDesign as CharacterDesignType } from '../shared/CharacterDesign'
import { globalState } from '../shared/GlobalState'

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
  private activeDesign = false
  private charDesign: CharacterDesignType | null = null
  private charDesignLoader: Promise<CharacterDesignType> | null = null
  private designTab!: HTMLElement
  private tabEls: Map<string, HTMLElement> = new Map()
  private unsub: (() => void) | null = null

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

    // 隐藏的"角色设计"入口按钮——保留 button 元素是因为 setActiveTab() /
    // updateBadge() 仍引用 this.designTab 控制 has-char / active class，
    // 把它从 DOM 摘掉但内存里留着，省得把那两条引用改成空检查。
    // wb-character 启动时直接 showDesign() 默认进入设计模式，顶栏不再
    // 显示这个孤零零的 tab——反正只有一个主入口，按钮纯粹是 noise。
    this.designTab = document.createElement('button')
    this.designTab.className = 'pipeline-tab design-tab main-tab'
    this.designTab.style.display = 'none'

    // 主 tab（placement='main'）—— wb-character 当前没有 main 管线，只有「角色设计」入口；
    // 留着这块循环是为了未来如果再加图像类主流水线（比如 portrait/turnaround tab）能直接生效。
    const MAIN_TAB_ORDER: string[] = []
    const mainMetas = this.registry.getByPlacement('main').sort((a, b) => {
      const ai = MAIN_TAB_ORDER.indexOf(a.id)
      const bi = MAIN_TAB_ORDER.indexOf(b.id)
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
    })
    for (const m of mainMetas) {
      const tab = document.createElement('button')
      tab.className = 'pipeline-tab main-tab'
      tab.innerHTML = `<span class="tab-icon">${m.icon}</span>${m.name}`
      tab.addEventListener('click', () => { void this.activate(m) })
      this.tabsContainer.appendChild(tab)
      this.tabEls.set(m.id, tab)
    }

    // 右侧弹性撑开，让「更多模块」贴右
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

    this.showDesign()
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
    const item = (icon: string, name: string, desc: string, onClick: () => void) => {
      const it = document.createElement('button')
      it.className = 'pipeline-drawer-item'
      it.innerHTML = `<span class="pipeline-drawer-icon">${icon}</span>` +
        `<span class="pipeline-drawer-text"><span class="pipeline-drawer-name">${name}</span>` +
        `<span class="pipeline-drawer-desc">${desc}</span></span>`
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
        panel.appendChild(item(m.icon, m.name, m.description, () => { void this.activate(m) }))
        this.tabEls.set(m.id, trigger)
      }
    }

    if (auxGroup.length) {
      panel.appendChild(groupHead('辅助工具'))
      for (const m of auxGroup) {
        panel.appendChild(item(m.icon, m.name, m.description, () => { void this.activate(m) }))
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

  private showDesign(): void {
    this.leaveCurrentMode()
    this.activeDesign = true
    this.clearPanels()
    this.setActiveTab('__design__')

    this.extra.center.classList.add('active')
    this.leftPanel.innerHTML =
      '<div class="pipeline-loading"><div class="pipeline-loading-spinner"></div>' +
      '<div class="pipeline-loading-text">🎨 角色设计 加载中…</div></div>'

    void this.ensureCharDesign().then(cd => {
      // 用户可能在 await 期间切到别的 tab —— 不再是 design 模式就不挂载
      if (!this.activeDesign) return
      this.leftPanel.innerHTML = ''
      cd.mount(this.leftPanel, this.extra.center)
    }).catch(err => {
      if (!this.activeDesign) return
      console.warn('[PipelinePanel] CharacterDesign load failed:', err)
      this.leftPanel.innerHTML = '<div class="pipeline-loading pipeline-loading-error">⚠️ 角色设计模块加载失败</div>'
    })
  }

  private ensureCharDesign(): Promise<CharacterDesignType> {
    if (this.charDesign) return Promise.resolve(this.charDesign)
    if (!this.charDesignLoader) {
      this.charDesignLoader = import('../shared/CharacterDesign').then(m => {
        this.charDesign = new m.CharacterDesign()
        return this.charDesign
      })
    }
    return this.charDesignLoader
  }

  private async activate(meta: PipelineMeta, opts: { reset?: boolean } = {}): Promise<void> {
    this.leaveCurrentMode()
    this.clearPanels()
    this.setActiveTab(meta.id)
    this.activeId = meta.id
    this.showLoadingHint(meta)

    let pipeline: IPipeline | undefined
    try {
      pipeline = await this.registry.load(meta.id)
    } catch (err) {
      console.warn('[PipelinePanel] load failed:', meta.id, err)
    }
    if (!pipeline) {
      this.showLoadError(meta)
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
    await pipeline.init(this.context)
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
        <div class="pipeline-loading-text">${meta.icon} ${meta.name} 加载中…</div>
      </div>
    `
  }

  private clearLoadingHint(): void {
    this.leftPanel.innerHTML = ''
  }

  private showLoadError(meta: PipelineMeta): void {
    this.leftPanel.innerHTML = `
      <div class="pipeline-loading pipeline-loading-error">
        ⚠️ 加载失败:${meta.id}
        <div style="margin-top:8px;font-size:12px;opacity:0.7">查看控制台获取详情</div>
      </div>
    `
  }

  private leaveCurrentMode(): void {
    if (this.activeDesign) {
      this.charDesign?.unmount()
      this.activeDesign = false
    }
    if (this.activePipeline) {
      this.activePipeline.destroyUI()
      this.activePipeline.dispose()
      this.activePipeline = null
    }
    this.activeId = null
  }

  private setActiveTab(id: string): void {
    this.designTab.classList.toggle('active', id === '__design__')
    this.tabEls.forEach((el, tid) => {
      el.classList.toggle('active', tid === id)
    })
  }

  private updateBadge(): void {
    const has = globalState.hasCharacter
    this.designTab.classList.toggle('has-char', has)
    this.tabEls.forEach(el => el.classList.toggle('needs-char', !has))
  }

  private clearPanels(): void {
    this.leftPanel.innerHTML = ''
    this.extra.center.innerHTML = ''
    this.extra.center.classList.remove('active')
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
