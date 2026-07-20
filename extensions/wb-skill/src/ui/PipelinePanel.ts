import type { IPipeline, PipelineContext, PipelinePanels, PipelineMeta } from '../core/types'
import type { PipelineRegistry } from '../core/PipelineRegistry'
import type { Engine } from '../core/Engine'
import type { CameraStore } from '../core/CameraStore'
import type { PreviewControls } from './PreviewControls'
import { globalState } from '../shared/GlobalState'
import { t, tf, pipelineLabel, pipelineDescription, onLocaleChange } from '../i18n'

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
  private localeUnsub: (() => void) | null = null
  private mainMetas: PipelineMeta[] = []
  private drawerMetas: PipelineMeta[] = []
  private drawerWrap: HTMLElement | null = null
  private drawerPanel: HTMLElement | null = null

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

    const MAIN_TAB_ORDER = ['vfx']
    const mainMetas = this.registry.getByPlacement('main').sort((a, b) => {
      const ai = MAIN_TAB_ORDER.indexOf(a.id)
      const bi = MAIN_TAB_ORDER.indexOf(b.id)
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi)
    })
    this.mainMetas = mainMetas
    this.drawerMetas = this.registry.getByPlacement('drawer')
    for (const m of mainMetas) {
      const tab = document.createElement('button')
      tab.className = 'pipeline-tab main-tab'
      tab.innerHTML = `<span class="tab-icon">${m.icon}</span>${pipelineLabel(m.id, m.name)}`
      tab.addEventListener('click', () => { void this.activate(m) })
      this.tabsContainer.appendChild(tab)
      this.tabEls.set(m.id, tab)
    }

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

    this.localeUnsub = onLocaleChange(() => this.refreshTabLabels())

    const defaultMeta = mainMetas[0]
    if (defaultMeta) {
      void this.activate(defaultMeta)
    }
  }

  private buildMoreDrawer(): void {
    const drawerPipelines = this.drawerMetas.length ? this.drawerMetas : this.registry.getByPlacement('drawer')
    if (drawerPipelines.length === 0) return

    const wrap = document.createElement('div')
    wrap.className = 'pipeline-drawer-wrap'
    this.drawerWrap = wrap

    const trigger = document.createElement('button')
    trigger.className = 'pipeline-tab drawer-trigger'
    trigger.innerHTML = `<span class="tab-icon">⋯</span>${t('drawer.more')} <span class="drawer-chevron">▾</span>`
    wrap.appendChild(trigger)

    const panel = document.createElement('div')
    panel.className = 'pipeline-drawer'
    panel.style.display = 'none'
    this.drawerPanel = panel

    const groupHead = (text: string) => {
      const h = document.createElement('div')
      h.className = 'pipeline-drawer-group'
      h.textContent = text
      return h
    }
    const item = (meta: PipelineMeta, onClick: () => void) => {
      const it = document.createElement('button')
      it.className = 'pipeline-drawer-item'
      it.dataset.pipelineId = meta.id
      it.innerHTML = `<span class="pipeline-drawer-icon">${meta.icon}</span>` +
        `<span class="pipeline-drawer-text"><span class="pipeline-drawer-name">${pipelineLabel(meta.id, meta.name)}</span>` +
        `<span class="pipeline-drawer-desc">${pipelineDescription(meta.id, meta.description)}</span></span>`
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
      panel.appendChild(groupHead(t('drawer.variant')))
      for (const m of variantGroup) {
        panel.appendChild(item(m, () => { void this.activate(m) }))
        this.tabEls.set(m.id, trigger)
      }
    }

    if (auxGroup.length) {
      panel.appendChild(groupHead(t('drawer.aux')))
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
    }
    this.clearLoadingHint()
    pipeline.createUI(this.leftPanel, panels)
  }

  private showLoadingHint(meta: PipelineMeta): void {
    const name = pipelineLabel(meta.id, meta.name)
    this.leftPanel.innerHTML = `
      <div class="pipeline-loading">
        <div class="pipeline-loading-spinner"></div>
        <div class="pipeline-loading-text">${meta.icon} ${tf('loading.pipeline', { name })}</div>
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
        ⚠️ ${t('loading.failed')}:${meta.id}
        ${detail ? `<div style="margin-top:8px;font-size:12px;color:#ff8888;word-break:break-all;max-width:420px">${escapeHtml(detail)}</div>` : ''}
        ${stack ? `<details style="margin-top:8px;max-width:440px"><summary style="font-size:11px;opacity:0.7;cursor:pointer">${t('loading.stackDetails')}</summary><pre style="font-size:10px;opacity:0.7;white-space:pre-wrap;word-break:break-all;text-align:left">${escapeHtml(stack)}</pre></details>` : `<div style="margin-top:8px;font-size:12px;opacity:0.7">${t('loading.checkConsole')}</div>`}
      </div>
    `
  }

  private refreshTabLabels(): void {
    for (const m of this.mainMetas) {
      const tab = this.tabEls.get(m.id)
      if (tab) tab.innerHTML = `<span class="tab-icon">${m.icon}</span>${pipelineLabel(m.id, m.name)}`
    }
    if (this.drawerWrap) {
      const trigger = this.drawerWrap.querySelector('.drawer-trigger') as HTMLElement | null
      if (trigger) trigger.innerHTML = `<span class="tab-icon">⋯</span>${t('drawer.more')} <span class="drawer-chevron">▾</span>`
    }
    if (this.drawerPanel) {
      const groups = this.drawerPanel.querySelectorAll('.pipeline-drawer-group')
      let gi = 0
      const variantGroup = this.drawerMetas.filter(m => m.group !== 'aux')
      const auxGroup = this.drawerMetas.filter(m => m.group === 'aux')
      if (variantGroup.length && groups[gi]) { (groups[gi] as HTMLElement).textContent = t('drawer.variant'); gi++ }
      if (auxGroup.length && groups[gi]) { (groups[gi] as HTMLElement).textContent = t('drawer.aux') }
      for (const it of this.drawerPanel.querySelectorAll('.pipeline-drawer-item')) {
        const id = (it as HTMLElement).dataset.pipelineId
        const meta = id ? this.drawerMetas.find(m => m.id === id) : undefined
        if (!meta) continue
        const nameEl = it.querySelector('.pipeline-drawer-name')
        const descEl = it.querySelector('.pipeline-drawer-desc')
        if (nameEl) nameEl.textContent = pipelineLabel(meta.id, meta.name)
        if (descEl) descEl.textContent = pipelineDescription(meta.id, meta.description)
      }
    }
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
    this.localeUnsub?.()
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
