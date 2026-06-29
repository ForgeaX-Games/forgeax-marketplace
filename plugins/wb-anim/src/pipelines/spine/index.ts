// @source wb-character/src/pipelines/spine/index.ts
import type { IPipeline, PipelineContext, PipelinePanels } from '../../core/types'
import { meta } from './meta'
import { injectCSS } from './editor/SpineEditor'
import { createDefaultState, TAB_META } from './editor/StudioState'
import type { StudioState, StudioTab, TabId } from './editor/StudioState'
import { ExplosionTab } from './editor/ExplosionTab'
import { AutoBindTab } from './editor/AutoBindTab'
import { AnimWorkshopTab } from './editor/AnimWorkshopTab'
import { GameUploadTab } from './editor/GameUploadTab'
import { studioSave, studioLoad, EDITOR_STATE_KEY } from './editor/StudioStorage'
import { parseSpineJson, computeWorldTransforms, applyIKConstraints } from './editor/SpineDataParser'
import { globalState } from '../../shared/GlobalState'
import { forgeaxHost } from '../../platform/HostSdkBridge'
import { spineIcon } from './editor/spine-icons'

let ctx: PipelineContext

class SpineInlineUI {
  private state: StudioState
  private tabs: StudioTab[] = []
  private panels: PipelinePanels | null = null
  private stepBtns: Map<TabId, HTMLElement> = new Map()
  private navEl: HTMLElement | null = null
  private bodyEl: HTMLElement | null = null
  private currentTabId: TabId = 'explosion'
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private ready = false
  private dummyParent: HTMLDivElement
  private unsubGlobal: (() => void) | null = null
  private tabBc: BroadcastChannel | null = null
  private tabBcSelfId = Math.random().toString(36).slice(2, 10)
  private applyingTabBroadcast = false

  constructor() {
    injectCSS()
    this.state = createDefaultState()
    this.dummyParent = document.createElement('div')
    this.dummyParent.style.display = 'none'
    document.body.appendChild(this.dummyParent)

    this.createTabs()
    this.setupTabSync()
    this.syncGlobalDesign()
    this.asyncRestore()

    this.unsubGlobal = globalState.subscribe(() => this.syncGlobalDesign())
    window.addEventListener('beforeunload', () => this.autoSave())
  }

  private syncGlobalDesign(): void {
    const design = globalState.get()
    this.state.profession = design.profile.combatType
    if (design.characterImage) {
      this.state.characterImage = design.characterImage
    }
    this.state.characterDescription = design.profile.extraDesc
    void globalState.hydrateCharacterImage(true).then((ok) => {
      if (!ok) return
      const img = globalState.get().characterImage
      if (img) {
        this.state.characterImage = img
        for (const tab of this.tabs) {
          if (tab.id === 'explosion') tab.activate(this.state)
        }
      }
    })
  }

  private createTabs(): void {
    const onChange = () => this.onStateChange()
    const animTab = new AnimWorkshopTab(this.dummyParent, onChange)
    const uploadTab = new GameUploadTab(this.dummyParent, onChange)
    uploadTab.setAnimWorkshopRef(animTab)

    this.tabs = [
      new ExplosionTab(this.dummyParent, onChange),
      new AutoBindTab(this.dummyParent, onChange),
      animTab,
      uploadTab,
    ]
  }

  private async asyncRestore(): Promise<void> {
    let saved: any = null

    try {
      saved = await studioLoad<any>(EDITOR_STATE_KEY)
      if (saved) console.log('[Spine] Found editor state in IndexedDB')
    } catch {}

    if (!saved || !saved.characterImage) {
      try {
        const res = await fetch('/__ce-api__/load-spine-session')
        const data = await res.json()
        if (data.success && data.session) {
          saved = data.session
          console.log('[Spine] Restored editor state from project files')
        }
      } catch (e) {
        console.warn('[Spine] File restore failed:', e)
      }
    }

    if (saved) {
      this.applyRestoredState(saved)
    }

    this.syncGlobalDesign()
    this.ready = true
    if (this.panels) this.switchTab(this.state.activeTab)
  }

  private applyRestoredState(saved: any): void {
    if (saved.profession) this.state.profession = saved.profession
    if (saved.characterImage) this.state.characterImage = saved.characterImage
    if (saved.explosionImage) this.state.explosionImage = saved.explosionImage
    if (saved.characterDescription) this.state.characterDescription = saved.characterDescription
    if (saved.activeTab && !pendingReset) {
      const validTab = TAB_META.find(m => m.id === saved.activeTab)
      this.state.activeTab = validTab ? saved.activeTab : 'explosion'
    }
    pendingReset = false
    if (saved.partRegions) this.state.partRegions = saved.partRegions
    if (saved.bindingJson) {
      this.state.bindingJson = saved.bindingJson
      try {
        const skel = parseSpineJson(saved.bindingJson)
        computeWorldTransforms(skel.bones, skel.boneOrder)
        if (skel.ik.length > 0) applyIKConstraints(skel.bones, skel.boneOrder, skel.ik)
        this.state.bindingSkeleton = skel
      } catch {}
    }
    if (saved.attachmentImages) {
      this.state.attachmentImages = saved.attachmentImages instanceof Map
        ? saved.attachmentImages
        : new Map(Object.entries(saved.attachmentImages))
    }
    if (saved.animations) {
      this.state.animations = saved.animations instanceof Map
        ? saved.animations
        : new Map(Object.entries(saved.animations))
    }
    if (saved.exportPath) this.state.exportPath = saved.exportPath
  }

  mount(leftPanel: HTMLElement, panels: PipelinePanels): void {
    this.panels = panels
    leftPanel.innerHTML = ''

    // 软提示：未完成角色设计时仍渲染全部步骤 UI，只在顶部插一条警告条
    // （详见 pixel-char 同名方法）。让用户能调试每步细节面板。

    const header = document.createElement('div')
    header.className = 'spine-header'
    header.innerHTML = '<span class="spine-header-title">Spine 动画工作台</span><span class="spine-header-pill">Spine</span>'
    leftPanel.appendChild(header)

    this.navEl = document.createElement('div')
    this.navEl.className = 'spine-step-nav'

    for (const meta of TAB_META) {
      const btn = document.createElement('button')
      btn.className = 'spine-step-btn'
      btn.innerHTML = `<span class="step-icon">${spineIcon(meta.id)}</span>${meta.label}`
      btn.addEventListener('click', () => this.switchTab(meta.id))
      this.navEl.appendChild(btn)
      this.stepBtns.set(meta.id, btn)
    }

    if (!globalState.hasCharacter) {
      const banner = document.createElement('div')
      banner.style.cssText = 'padding:10px 12px;margin:0 0 8px 0;background:rgba(255,170,40,0.08);border:1px solid rgba(255,170,40,0.35);border-radius:6px;color:var(--text-secondary);font-size:12px;line-height:1.5;'
      banner.innerHTML = `<strong style="color:#ffb84d;">提示：还未完成角色设计</strong><br>
        去 <code style="background:rgba(255,255,255,0.08);padding:1px 5px;border-radius:3px;">wb-character</code> 生成角色后再跑 Spine 流水线；当前可预览/调试各步骤 UI。`
      leftPanel.appendChild(banner)
    }

    leftPanel.appendChild(this.navEl)

    this.bodyEl = document.createElement('div')
    this.bodyEl.className = 'spine-left-body'
    leftPanel.appendChild(this.bodyEl)

    if (this.ready) this.switchTab(this.state.activeTab)
  }

  private switchTab(id: TabId): void {
    if (!this.panels || !this.bodyEl) return

    this.state.activeTab = id
    this.currentTabId = id
    this.broadcastActiveTab(id)

    this.tabs.forEach(t => t.deactivate())

    this.bodyEl!.innerHTML = ''
    this.panels.center.innerHTML = ''
    this.panels.center.classList.remove('active')
    this.panels.center.classList.remove('has-toolbar')
    this.panels.center.classList.remove('has-bottom')
    this.panels.toolbar.innerHTML = ''
    this.panels.toolbar.classList.remove('active')
    this.panels.right.innerHTML = ''
    this.panels.right.classList.remove('visible')
    this.panels.bottom.innerHTML = ''
    this.panels.bottom.classList.remove('visible')

    const centerParent = this.panels.center.parentElement
    if (centerParent) centerParent.classList.remove('has-right')
    this.panels.bottom.classList.remove('has-right')

    const activeIdx = TAB_META.findIndex(m => m.id === id)
    this.stepBtns.forEach((btn, tabId) => {
      const idx = TAB_META.findIndex(m => m.id === tabId)
      btn.classList.toggle('active', tabId === id)
      btn.classList.toggle('completed', idx < activeIdx)
    })

    const tab = this.tabs.find(t => t.id === id)
    if (!tab) return

    tab.activate(this.state)

    this.bodyEl!.appendChild(tab.sidePanel)

    if (tab.centerView) {
      this.panels.center.appendChild(tab.centerView)
      this.panels.center.classList.add('active')
    }

    if (tab.centerToolbar) {
      this.panels.toolbar.appendChild(tab.centerToolbar)
      this.panels.toolbar.classList.add('active')
      this.panels.center.classList.add('has-toolbar')
    }

    if (tab.rightPanel) {
      this.panels.right.appendChild(tab.rightPanel)
      this.panels.right.classList.add('visible')
      if (centerParent) centerParent.classList.add('has-right')
      this.panels.bottom.classList.add('has-right')
    }

    if (tab.bottomPanel) {
      this.panels.bottom.appendChild(tab.bottomPanel)
      this.panels.bottom.classList.add('visible')
      this.panels.center.classList.add('has-bottom')
    }

    window.dispatchEvent(new Event('resize'))
  }

  private onStateChange(): void {
    this.switchTab(this.state.activeTab)
    this.scheduleAutoSave()
  }

  private setupTabSync(): void {
    try {
      this.tabBc = new BroadcastChannel('forgeax-plugin.@forgeax-plugin/wb-anim.spine-active-tab')
    } catch {
      this.tabBc = null
      return
    }
    this.tabBc.onmessage = (e: MessageEvent) => {
      const data = e.data as { from?: string; tabId?: TabId } | null
      if (!data || data.from === this.tabBcSelfId || !data.tabId) return
      if (data.tabId === this.state.activeTab) return
      if (!TAB_META.some(m => m.id === data.tabId)) return
      this.applyingTabBroadcast = true
      try {
        this.switchTab(data.tabId)
      } finally {
        this.applyingTabBroadcast = false
      }
    }
  }

  private broadcastActiveTab(tabId: TabId): void {
    if (!this.tabBc || this.applyingTabBroadcast) return
    try { this.tabBc.postMessage({ from: this.tabBcSelfId, tabId }) } catch { /* ignore */ }
  }

  private scheduleAutoSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.autoSave(), 1500)
  }

  private autoSave(): void {
    const s = this.state
    const session: Record<string, unknown> = {
      profession: s.profession,
      characterImage: s.characterImage,
      explosionImage: s.explosionImage,
      activeTab: s.activeTab,
      partRegions: s.partRegions,
      bindingJson: s.bindingJson,
      exportPath: s.exportPath,
      characterDescription: s.characterDescription,
      timestamp: Date.now(),
    }
    if (s.attachmentImages.size > 0) {
      session.attachmentImages = Object.fromEntries(s.attachmentImages)
    }
    if (s.animations.size > 0) {
      session.animations = Object.fromEntries(s.animations)
    }
    studioSave(EDITOR_STATE_KEY, session).catch(e => {
      console.warn('Spine auto-save failed:', e)
    })
    this.saveToFile(session)
  }

  private fileSaveInFlight = false
  private fileSavePending = false
  private async saveToFile(session: Record<string, unknown>): Promise<void> {
    if (this.fileSaveInFlight) { this.fileSavePending = true; return }
    this.fileSaveInFlight = true
    try {
      // Doc 01 §P4 funnel: prefer host.tool.call, fall back to direct POST
      // for legacy standalone (npm run dev) and tests.
      let saved = false
      if (forgeaxHost.available) {
        try {
          const r = await forgeaxHost.tool.call('character:save-spine-session', session)
          if (r.ok) saved = true
        } catch { /* fall through */ }
      }
      if (!saved) {
        await fetch('/__ce-api__/save-spine-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session),
        })
      }
    } catch (e) {
      console.warn('[Spine] File save failed:', e)
    } finally {
      this.fileSaveInFlight = false
      if (this.fileSavePending) {
        this.fileSavePending = false
        this.saveToFile(session)
      }
    }
  }

  unmount(): void {
    this.tabs.forEach(t => t.deactivate())
    this.autoSave()
  }

  dispose(): void {
    this.unsubGlobal?.()
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.tabBc?.close()
    this.tabs.forEach(t => t.dispose())
    this.dummyParent.remove()
  }

  resetToFirstTab(): void {
    this.state.activeTab = 'explosion'
    this.currentTabId = 'explosion'
  }
}

let ui: SpineInlineUI | null = null
let pendingReset = false

const spine: IPipeline = {
  meta,

  async init(context) {
    ctx = context
    console.log('[Spine] Pipeline initialized')
  },

  dispose() {
    ui?.dispose()
    ui = null
  },

  resetForNewCharacter() {
    pendingReset = true
    ui?.resetToFirstTab()
  },

  createUI(container, panels) {
    if (!ui) {
      ui = new SpineInlineUI()
    }

    if (panels) {
      ui.mount(container, panels)
    } else {
      container.innerHTML = ''
      const msg = document.createElement('div')
      msg.style.cssText = 'padding:16px;color:var(--text-secondary);font-size:12px;'
      msg.textContent = 'Spine 管线需要完整的面板布局支持。'
      container.appendChild(msg)
    }
  },

  destroyUI() {
    ui?.unmount()
  },

  getDefaultParams() {
    return {
      prompt: '',
      profession: 'melee',
      templateId: 'male-warrior',
    }
  },
}

export default spine
