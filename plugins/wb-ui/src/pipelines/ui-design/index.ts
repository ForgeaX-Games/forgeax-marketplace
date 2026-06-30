import type { IPipeline, PipelineContext, PipelinePanels } from '../../core/types'
import {
  FEATURE_MODULES,
  GENRE_PRESETS,
  STYLE_PRESETS,
  STAGE_PRESETS,
  buildBlueprint,
  buildComponentLibrarySteps,
  buildModuleAssetSpecs,
  confirmedLayoutFeatureIds,
  createDefaultState,
  defaultStyleBoardPrompt,
  getGenreComponentKit,
  getScreenFlow,
  getScreenModules,
  iconLabelsFromModuleSpecs,
  iconSlotDescriptorsFromModuleSpecs,
  iconSlotIndexForModuleId,
  mergeScreenBaselineIntoSelection,
  recommendedFeatures,
  recommendedStyles,
  resolveIconSlotCount,
  resolveStyleBoardSectionsForLayout,
  loadState,
  saveState,
  saveRuntimeSnapshot,
  loadRuntimeSnapshot,
  clearRuntimeSnapshot,
  wipePersistedSession,
  type UiDesignRuntimeSnapshot,
  ASSET_KIND_LABELS,
  type AssetKindId,
  type ComponentLibraryStep,
  type GenrePresetId,
  type GenreComponentKit,
  type ModuleAssetSpec,
  type PreviewModeId,
  type ScreenKind,
  type StyleBoardSection,
  type StyleAssetPreview,
  type StylePresetId,
  type UIDesignState,
  type WorkflowStepId,
} from './model'
import { getLayoutSpec } from './layout-engine'
import {
  renderLayoutPreviewFromSpec,
  renderLayoutSceneBody,
  renderScreenPreviewMarkup,
  GENRE_LAYOUT_PROTO_CSS,
  GENRE_PROTO_WIRE_SCRIPT,
  WORKBENCH_LAYOUT_SCENE_CSS,
} from './layout-templates'
import { buildPrototypeChromeCss } from './prototype-assets'
import { createUiGenerationNonce } from './ui-design-generation-nonce'

const CSS_ID = 'ui-design-pipeline-css'

interface GeneratedAssets {
  backgrounds: Record<string, string>
  npc?: string
  shopItems: string[]
  weapons: string[]
  panelTexture?: string
  icons: string[]
  buttonNormal?: string
  buttonPrimary?: string
  titleDeco?: string
}

/** 第三步 chrome 素材互不依赖，可并行生成 */
const PARALLEL_CHROME_ASSET_KINDS = new Set<AssetKindId>([
  'buttonPrimary',
  'buttonNormal',
  'titleDeco',
  'panelTexture',
])
/** Chrome 并行路数（Gemini 直连通常可承受 3 路） */
const CHROME_GENERATION_CONCURRENCY = 3
/** 功能图标按槽位并行生成 */
const ICON_GENERATION_CONCURRENCY = 3
/** 组件素材单请求超时：避免某一路挂死后进度永远卡住 */
const COMPONENT_ASSET_REQUEST_TIMEOUT_MS = 45_000
/** 布局/原型场景背景单请求超时 */
const PREVIEW_BG_REQUEST_TIMEOUT_MS = 30_000
/** 原型生成前并行预拉背景：单屏最多等待这么久，超时则用 CSS 占位先出原型 */
const PROTOTYPE_BG_PREFETCH_TIMEOUT_MS = 12_000

interface GenerateAssetsResponse {
  success: boolean
  assets?: GeneratedAssets
  error?: string
}

interface ComponentPreviewProgress {
  /** 已完成粗粒度步骤数（步骤列表勾选） */
  done: number
  /** 当前正在生成的粗粒度步（0-based） */
  stepIndex: number
  /** 粗粒度步骤总数 */
  total: number
  /** 已完成生成单元（chrome 各 1 + 每个图标槽 1） */
  completedUnits: number
  /** 生成单元总数 */
  totalUnits: number
  percent: number
  currentLabel: string
}

interface UiDesignStateSyncMessage {
  type: 'ui-design:state-sync'
  sourceId: string
  state: UIDesignState
  activeScreen: ScreenKind
  genreSelectionConfirmed: boolean
  layoutBaselineMergedScreens: string[]
  layoutReviewedScreens: string[]
  prototypeHTML: string | null
  prototypeGenerating: boolean
  prototypeGenerateHint: string | null
  prototypeGenerateError: string | null
  componentPreviewLoading: boolean
  componentPreviewProgress: ComponentPreviewProgress | null
  componentPreviewError: string | null
  loadComponentLibraryRunning: boolean
  liveAssets: StyleAssetPreview
}

interface UiDesignRequestSyncMessage {
  type: 'ui-design:request-sync'
  sourceId: string
}

type UiDesignChannelMessage = UiDesignStateSyncMessage | UiDesignRequestSyncMessage

/** 界面流屏幕 → 最合适的 previewMode */
const SCREEN_TO_PREVIEW: Partial<Record<ScreenKind, PreviewModeId>> = {
  start: 'menu',
  hud: 'hud',
  bag: 'menu',
  dialog: 'dialog',
  character: 'menu',
  results: 'results',
  end: 'results',
  pause: 'menu',
  'level-select': 'menu',
  'weapon-select': 'menu',
  map: 'hud',
  shop: 'shop',
}

const WORKFLOW_STEPS: Array<{ id: WorkflowStepId; label: string }> = [
  { id: 'genre', label: '游戏类型' },
  { id: 'layout', label: '布局验证' },
  { id: 'style', label: '风格与组件生成' },
  { id: 'component-preview', label: '素材微调' },
  { id: 'prototype', label: '生成可交互原型' },
]

function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}

class UIDesignPipelineUI {
  // 工作流状态持久化到 localStorage；切换工作台后通过 restorePersistedSession 恢复。
  private state: UIDesignState = loadState()
  private left: HTMLElement | null = null
  private panels: PipelinePanels | null = null
  private activeScreen: ScreenKind = 'start'
  /** null = 设计模式, string = 生成的原型 HTML */
  private prototypeHTML: string | null = null
  /** 当前预览背景图 data URL，按 screenKind 缓存 */
  private previewBg: Record<string, string> = {}
  /** 正在生图的 screenKind set */
  private bgLoading: Set<string> = new Set()
  /** 上次生图时的 genre+style key，用于失效检测 */
  private bgCacheKey = ''
  /** UI 素材缓存，切风格时清空 */
  private liveAssets: {
    panelTexture?: string
    icons: string[]
    buttonNormal?: string
    buttonPrimary?: string
    titleDeco?: string
  } = { icons: [] }
  /** liveAssets 是否已在拉取中 */
  private liveAssetsLoading = false
  /** 组件素材预览：全量拉取主按钮/次按钮/标题/面板/图标，中央显示「生成预览中」 */
  private componentPreviewLoading = false
  private componentPreviewProgress: ComponentPreviewProgress | null = null
  private componentPreviewError: string | null = null
  private loadComponentLibraryRunning = false
  /** 第五步可交互原型组装中（双 iframe 同步，中央预览立即显示 loading） */
  private prototypeGenerating = false
  private prototypeGenerateHint: string | null = null
  private prototypeGenerateError: string | null = null
  /** 生成进行中禁止从历史包静默灌回旧素材 */
  private skipLiveAssetHydration = false
  private componentProgressPulseTimer: ReturnType<typeof setInterval> | null = null
  /** 同一风格自动拉取一次，避免 render 循环重复请求 */
  private componentLibraryAutoRequestKey = ''
  /** 核心缺失补拉：最多自动重试 N 次，超出则显示失败并允许手动重试 */
  private componentCoreBackfillAttempts: Record<string, number> = {}
  private componentCoreBackfillRunning = false
  private readonly componentCoreBackfillMaxAttempts = 3
  /** 第4步历史记录是否占用中央预览区 */
  private componentHistoryOpen = false
  /** 当前放大查看的单个组件素材或动态组件族 */
  private componentAssetLightbox: {
    kind: 'asset' | 'section'
    token: string
    title: string
    src?: string
    html?: string
  } | null = null
  /** 进入后续步骤被拦截时给用户的明确提示 */
  private workflowGateNotice: string | null = null
  /** 下一次 render 后需要滚动聚焦的字段，用于“微调素材”入口 */
  private pendingFocusField: 'styleBoardPrompt' | 'assetPromptNotes' | null = null
  /** 第2步模块点选反馈：用于让“新增/移除”有明确可视回执 */
  private lastFeatureAction: { id: string; label: string; active: boolean; at: number } | null = null
  /** 已对哪些「类型::界面」合并过必选+推荐基线，避免用户关掉推荐后来回切屏又被强行加回 */
  private layoutBaselineMergedScreens = new Set<string>()
  /** 用户逐页点击「确认本页」后才计入，全部确认后才允许「确认布局」 */
  private layoutReviewedScreens = new Set<string>()
  /** 左侧流程区可单独收起，避免低优先级步骤长期占据空间 */
  private collapsedWorkflowSections = new Set<WorkflowStepId>(['style', 'component-preview', 'prototype'])
  /** 默认 state 有 genrePreset，但只有用户主动选择游戏类型后才允许右侧布局预览启动。 */
  private genreSelectionConfirmed = false
  private readonly instanceId = Math.random().toString(36).slice(2)
  /** 硬刷新 / ?ui-fresh=1 时为 false：不恢复 localStorage 与 runtime 里的旧会话。 */
  private acceptPersistedSessionOnThisLoad = true
  private runtimeSaveTimer: ReturnType<typeof setTimeout> | null = null
  private readonly restartActions = new Set(['generate-component-preview', 'regen-style-board', 'reset-component-assets'])
  private stateChannel: BroadcastChannel | null = null
  private actionBindingAbort: AbortController | null = null
  private documentActionBindingAbort: AbortController | null = null
  /** 本轮组件库生成步骤（由第二步选中模块推导） */
  private activeComponentLibrarySteps: ComponentLibraryStep[] = []

  private getComponentLibrarySteps(): ComponentLibraryStep[] {
    if (this.activeComponentLibrarySteps.length > 0) return this.activeComponentLibrarySteps
    return buildComponentLibrarySteps(this.state.genrePreset, this.state.selectedFeatures)
  }

  private getModuleAssetSpecs(): ModuleAssetSpec[] {
    return buildModuleAssetSpecs(this.state.genrePreset, this.state.selectedFeatures)
  }

  private getIconSlotCount(): number {
    return resolveIconSlotCount(this.getModuleAssetSpecs())
  }

  /** 进度条按「chrome 各 1 单元 + 每个功能图标槽 1 单元」计，避免并行批次一步跳到 78%。 */
  private getComponentGenerationUnitTotal(steps: ComponentLibraryStep[] = this.getComponentLibrarySteps()): number {
    let total = 0
    for (const step of steps) {
      if (step.kind === 'icons') total += Math.max(1, this.getIconSlotCount())
      else total += 1
    }
    return Math.max(1, total)
  }

  private percentFromGenerationUnits(completedUnits: number, totalUnits: number): number {
    if (totalUnits <= 0) return 0
    return Math.min(99, Math.max(0, Math.round((completedUnits / totalUnits) * 100)))
  }

  private displayProgressPercent(percent: number): number {
    const safe = Number.isFinite(percent) ? percent : 0
    return Math.min(100, Math.max(0, Math.round(safe)))
  }

  private formatProgressPercentLabel(percent: number): string {
    return `${this.displayProgressPercent(percent)}%`
  }

  private getComponentLibraryStepVisualState(
    step: ComponentLibraryStep,
    index: number,
    progress: ComponentPreviewProgress | null,
  ): 'done' | 'active' | 'pending' {
    if (step.kind === 'icons') {
      const iconTotal = this.getIconSlotCount()
      const iconDone = this.liveAssets.icons.filter(Boolean).length
      if (iconTotal > 0 && iconDone >= iconTotal) return 'done'
      if (this.loadComponentLibraryRunning && iconDone > 0) return 'active'
      if (progress?.stepIndex === index && this.loadComponentLibraryRunning) return 'active'
      return 'pending'
    }
    if (this.isAssetKindComplete(step.kind)) return 'done'
    if (!this.loadComponentLibraryRunning) return 'pending'
    if (PARALLEL_CHROME_ASSET_KINDS.has(step.kind)) {
      const inChromeBatch = Boolean(progress?.currentLabel?.startsWith('并行生成'))
      if (inChromeBatch && !this.isAssetKindComplete(step.kind)) return 'active'
    }
    if (progress?.stepIndex === index) return 'active'
    return 'pending'
  }

  private ensureIconSlots(count = this.getIconSlotCount()): string[] {
    const icons = [...this.liveAssets.icons]
    return Array.from({ length: count }, (_, index) => icons[index] ?? '')
  }

  private iconAssetReady(index: number): boolean {
    return Boolean(this.liveAssets.icons[index])
  }

  private renderIconGlyphWell(
    iconClass: string,
    slotIndex: number,
    options: {
      slotted?: boolean
      size?: 'lg' | 'md' | 'sm'
      viewable?: boolean
      assetView?: string
      ariaLabel?: string
    } = {},
  ): string {
    const slotted = options.slotted !== false
    const size = options.size ?? 'md'
    const ready = slotIndex >= 0 && this.iconAssetReady(slotIndex)
    const missing = slotIndex >= 0 && !ready
    const unslotted = !slotted ? ' uid-clib-icon-unslotted' : ''
    const missingCls = missing ? ' uid-clib-icon-missing' : ''
    const readyCls = ready ? ' uid-clib-icon-ready' : ''
    const viewable = options.viewable ? ' uid-clib-viewable' : ''
    const dataView = options.assetView ? ` data-uid-asset-view="${options.assetView}"` : ''
    const aria = options.ariaLabel
      ? ` role="img" aria-label="${esc(options.ariaLabel)}" tabindex="0"`
      : ''
    return `
      <div class="uid-clib-glyph-well uid-clib-glyph-well-${size}">
        <div class="uid-board-icon ${iconClass} uid-clib-chrome-silent${viewable}${unslotted}${missingCls}${readyCls}"${dataView}${aria}></div>
      </div>
    `
  }

  mount(container: HTMLElement, panels: PipelinePanels): void {
    injectCSS()
    this.left = container
    this.panels = panels
    this.setupStateSync()
    this.acceptPersistedSessionOnThisLoad = !this.shouldStartFreshSession()
    if (this.acceptPersistedSessionOnThisLoad) {
      this.restorePersistedSession()
      this.stateChannel?.postMessage({
        type: 'ui-design:request-sync',
        sourceId: this.instanceId,
      } satisfies UiDesignRequestSyncMessage)
    } else {
      this.beginFreshSession()
    }
    this.panels.center.classList.add('active')
    // 覆盖框架的 justify-content:center，让预览 shell 撑满整个面板
    this.panels.center.style.justifyContent = 'stretch'
    this.panels.center.style.alignItems = 'stretch'
    // No right panel for this pipeline
    this.panels.center.parentElement?.classList.remove('has-right')
    this.panels.right.innerHTML = ''
    this.panels.right.classList.remove('visible')
    this.syncActiveScreen()
    this.render()
  }

  unmount(): void {
    this.flushRuntimeSnapshot()
    this.stopLoadingProgressPulse()
    this.actionBindingAbort?.abort()
    this.actionBindingAbort = null
    this.documentActionBindingAbort?.abort()
    this.documentActionBindingAbort = null
    if (!this.panels) return
    this.stateChannel?.close()
    this.stateChannel = null
    this.panels.center.innerHTML = ''
    this.panels.center.classList.remove('active')
    // 恢复框架默认样式
    this.panels.center.style.justifyContent = ''
    this.panels.center.style.alignItems = ''
    this.panels.center.parentElement?.classList.remove('has-right')
    this.panels.right.innerHTML = ''
    this.panels.right.classList.remove('visible')
    this.left = null
    this.panels = null
  }

  reset(): void {
    this.beginFreshSession()
    this.syncActiveScreen()
    this.render()
    this.broadcastState()
  }

  private beginFreshSession(): void {
    this.stopLoadingProgressPulse()
    wipePersistedSession()
    this.state = loadState()
    this.bgCacheKey = `${this.state.genrePreset}::${this.state.style}`
    this.activeScreen = 'start'
    this.genreSelectionConfirmed = false
    this.prototypeHTML = null
    this.previewBg = {}
    this.bgLoading.clear()
    this.liveAssets = { icons: [] }
    this.liveAssetsLoading = false
    this.componentPreviewError = null
    this.componentPreviewLoading = false
    this.componentPreviewProgress = null
    this.loadComponentLibraryRunning = false
    this.componentLibraryAutoRequestKey = ''
    this.componentCoreBackfillAttempts = {}
    this.componentCoreBackfillRunning = false
    this.componentHistoryOpen = false
    this.componentAssetLightbox = null
    this.prototypeGenerating = false
    this.prototypeGenerateHint = null
    this.prototypeGenerateError = null
    this.workflowGateNotice = null
    this.pendingFocusField = null
    this.lastFeatureAction = null
    this.skipLiveAssetHydration = false
    this.layoutBaselineMergedScreens.clear()
    this.layoutReviewedScreens.clear()
    this.collapsedWorkflowSections = new Set<WorkflowStepId>(['style', 'component-preview', 'prototype'])
  }

  private syncActiveScreen(): void {
    const flow = getScreenFlow(this.state.genrePreset)
    const found = flow.find(s => s.kind === this.activeScreen)
    if (!found) this.activeScreen = flow[0]?.kind ?? 'start'
  }

  private layoutScreenKey(screen: ScreenKind): string {
    return `${this.state.genrePreset}::${screen}`
  }

  private allLayoutScreensReviewed(): boolean {
    const flow = getScreenFlow(this.state.genrePreset)
    return flow.length > 0 && flow.every(screen => this.layoutReviewedScreens.has(this.layoutScreenKey(screen.kind)))
  }

  /** 布局步骤：聚焦第一个尚未「确认本页」的界面；若都已确认则停在第一页。 */
  private ensureLayoutScreenFocus(): void {
    if (this.state.workflowStep !== 'layout' || this.state.layoutApproved) return
    const flow = getScreenFlow(this.state.genrePreset)
    if (flow.length === 0) return
    const firstPending = flow.find(screen => !this.layoutReviewedScreens.has(this.layoutScreenKey(screen.kind)))
    this.activeScreen = firstPending?.kind ?? flow[0]!.kind
  }

  private hasStartedLayoutWorkflow(): boolean {
    return this.genreSelectionConfirmed
      || this.state.workflowStep !== 'genre'
      || this.state.layoutApproved
      || this.state.styleBoardApproved
      || Boolean(this.state.confirmedStylePackId)
  }

  private setupStateSync(): void {
    if (this.stateChannel || typeof BroadcastChannel === 'undefined') return
    this.stateChannel = new BroadcastChannel('forgeax-plugin.@forgeax-plugin/wb-ui.ui-design-state')
    this.stateChannel.onmessage = (event: MessageEvent<UiDesignChannelMessage>) => {
      const msg = event.data
      if (!msg || msg.sourceId === this.instanceId) return
      if (msg.type === 'ui-design:request-sync') {
        this.broadcastState()
        return
      }
      if (msg.type !== 'ui-design:state-sync') return
      if (!this.acceptPersistedSessionOnThisLoad) return
      this.state = msg.state
      this.activeScreen = msg.activeScreen
      this.prototypeHTML = msg.prototypeHTML ?? null
      this.genreSelectionConfirmed = msg.genreSelectionConfirmed
      this.layoutBaselineMergedScreens = new Set(msg.layoutBaselineMergedScreens)
      this.layoutReviewedScreens = new Set(msg.layoutReviewedScreens ?? [])
      this.componentPreviewLoading = msg.componentPreviewLoading
      this.componentPreviewProgress = msg.componentPreviewProgress
      this.componentPreviewError = msg.componentPreviewError
      this.loadComponentLibraryRunning = msg.loadComponentLibraryRunning
      this.prototypeGenerating = msg.prototypeGenerating
      this.prototypeGenerateHint = msg.prototypeGenerateHint
      this.prototypeGenerateError = msg.prototypeGenerateError
      if (this.componentPreviewLoading || this.loadComponentLibraryRunning) {
        this.clearComponentLibraryLiveAssets()
      }
      this.mergeLiveAssetPreview(msg.liveAssets)
      this.syncActiveScreen()
      if (
        !this.loadComponentLibraryRunning
        && !this.skipLiveAssetHydration
        && this.hydrateLiveAssetsFromConfirmedPack()
        && this.hasFullComponentLibrary()
      ) {
        this.componentPreviewLoading = false
        this.componentPreviewProgress = null
        this.componentPreviewError = null
      }
      this.render()
    }
  }

  private buildRuntimeSnapshot(): UiDesignRuntimeSnapshot {
    return {
      version: 1,
      activeScreen: this.activeScreen,
      genreSelectionConfirmed: this.genreSelectionConfirmed,
      layoutReviewedScreens: [...this.layoutReviewedScreens],
      layoutBaselineMergedScreens: [...this.layoutBaselineMergedScreens],
      prototypeHTML: this.prototypeHTML,
      previewBg: { ...this.previewBg },
      liveAssets: {
        icons: [...this.liveAssets.icons],
        buttonNormal: this.liveAssets.buttonNormal,
        buttonPrimary: this.liveAssets.buttonPrimary,
        titleDeco: this.liveAssets.titleDeco,
        panelTexture: this.liveAssets.panelTexture,
      },
      savedAt: Date.now(),
    }
  }

  private scheduleRuntimeSnapshotSave(): void {
    if (this.runtimeSaveTimer) clearTimeout(this.runtimeSaveTimer)
    this.runtimeSaveTimer = setTimeout(() => {
      this.runtimeSaveTimer = null
      saveRuntimeSnapshot(this.buildRuntimeSnapshot())
    }, 400)
  }

  private flushRuntimeSnapshot(): void {
    if (this.runtimeSaveTimer) {
      clearTimeout(this.runtimeSaveTimer)
      this.runtimeSaveTimer = null
    }
    saveRuntimeSnapshot(this.buildRuntimeSnapshot())
  }

  private restorePersistedSession(): void {
    this.state = loadState()
    this.bgCacheKey = `${this.state.genrePreset}::${this.state.style}`
    const runtime = loadRuntimeSnapshot()
    if (runtime) {
      this.activeScreen = runtime.activeScreen
      this.genreSelectionConfirmed = runtime.genreSelectionConfirmed
      this.layoutReviewedScreens = new Set(runtime.layoutReviewedScreens)
      this.layoutBaselineMergedScreens = new Set(runtime.layoutBaselineMergedScreens)
      this.prototypeHTML = runtime.prototypeHTML
      this.previewBg = { ...runtime.previewBg }
      if (runtime.liveAssets.icons.length > 0 || runtime.liveAssets.buttonNormal || runtime.liveAssets.buttonPrimary
        || runtime.liveAssets.titleDeco || runtime.liveAssets.panelTexture) {
        this.liveAssets.icons = this.ensureIconSlots(Math.max(runtime.liveAssets.icons.length, this.getIconSlotCount()))
        if (runtime.liveAssets.buttonNormal) this.liveAssets.buttonNormal = runtime.liveAssets.buttonNormal
        if (runtime.liveAssets.buttonPrimary) this.liveAssets.buttonPrimary = runtime.liveAssets.buttonPrimary
        if (runtime.liveAssets.titleDeco) this.liveAssets.titleDeco = runtime.liveAssets.titleDeco
        if (runtime.liveAssets.panelTexture) this.liveAssets.panelTexture = runtime.liveAssets.panelTexture
        runtime.liveAssets.icons.forEach((src, index) => {
          if (src) this.liveAssets.icons[index] = src
        })
      }
    }
    if (!this.hasUsableComponentLibrary()) {
      this.hydrateLiveAssetsFromConfirmedPack()
    }
    if (!this.genreSelectionConfirmed && this.hasStartedLayoutWorkflow()) {
      this.genreSelectionConfirmed = true
    }
    this.syncActiveScreen()
  }

  private shouldStartFreshSession(): boolean {
    if (this.isHardReload()) return true
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('ui-fresh') === '1' || params.get('fresh') === '1') return true
    } catch {
      // Ignore URL parse failures in non-browser contexts.
    }
    return false
  }

  private isHardReload(): boolean {
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      return nav?.type === 'reload'
    } catch {
      return false
    }
  }

  private broadcastState(): void {
    this.stateChannel?.postMessage({
      type: 'ui-design:state-sync',
      sourceId: this.instanceId,
      state: this.state,
      activeScreen: this.activeScreen,
      genreSelectionConfirmed: this.genreSelectionConfirmed,
      layoutBaselineMergedScreens: [...this.layoutBaselineMergedScreens],
      layoutReviewedScreens: [...this.layoutReviewedScreens],
      prototypeHTML: this.prototypeHTML,
      componentPreviewLoading: this.componentPreviewLoading,
      componentPreviewProgress: this.componentPreviewProgress,
      componentPreviewError: this.componentPreviewError,
      loadComponentLibraryRunning: this.loadComponentLibraryRunning,
      prototypeGenerating: this.prototypeGenerating,
      prototypeGenerateHint: this.prototypeGenerateHint,
      prototypeGenerateError: this.prototypeGenerateError,
      liveAssets: this.getLivePreviewAssets(),
    } satisfies UiDesignStateSyncMessage)
    this.scheduleRuntimeSnapshotSave()
  }

  private setState(next: UIDesignState): void {
    const newKey = `${next.genrePreset}::${next.style}`
    if (newKey !== this.bgCacheKey) {
      this.previewBg = {}
      this.bgLoading.clear()
      this.bgCacheKey = newKey
      this.liveAssets = { icons: [], buttonNormal: undefined, buttonPrimary: undefined, titleDeco: undefined, panelTexture: undefined }
      this.liveAssetsLoading = false
      this.componentPreviewError = null
      this.componentLibraryAutoRequestKey = ''
      this.componentCoreBackfillAttempts = {}
      this.componentCoreBackfillRunning = false
      this.componentAssetLightbox = null
    }
    this.state = next
    saveState(this.state)
    this.syncActiveScreen()
    this.render()
    this.broadcastState()
  }

  private invalidateComponentVisualCache(): void {
    this.componentPreviewError = null
    this.componentPreviewLoading = false
    this.componentPreviewProgress = null
    this.loadComponentLibraryRunning = false
    this.componentLibraryAutoRequestKey = ''
    this.componentCoreBackfillAttempts = {}
    this.componentCoreBackfillRunning = false
    this.componentAssetLightbox = null
  }

  private resetGeneratedWorkflowRuntime(): void {
    this.stopLoadingProgressPulse()
    this.prototypeHTML = null
    this.previewBg = {}
    this.bgLoading.clear()
    this.bgCacheKey = ''
    this.liveAssets = { icons: [] }
    this.liveAssetsLoading = false
    this.componentPreviewLoading = false
    this.componentPreviewProgress = null
    this.componentPreviewError = null
    this.loadComponentLibraryRunning = false
    this.componentLibraryAutoRequestKey = ''
    this.componentCoreBackfillAttempts = {}
    this.componentCoreBackfillRunning = false
    this.componentHistoryOpen = false
    this.componentAssetLightbox = null
    this.workflowGateNotice = null
    this.pendingFocusField = null
  }

  private focusPendingField(): void {
    const fieldName = this.pendingFocusField
    if (!fieldName || !this.left) return
    this.pendingFocusField = null
    requestAnimationFrame(() => {
      const activeSection = this.left?.querySelector<HTMLElement>('.uid-section.active')
      const field = activeSection?.querySelector<HTMLTextAreaElement>(`[data-uid-field="${fieldName}"]`)
        ?? this.left?.querySelector<HTMLTextAreaElement>(`[data-uid-field="${fieldName}"]`)
      if (!field) return
      field.scrollIntoView({ block: 'center', behavior: 'smooth' })
      field.focus()
      const end = field.value.length
      field.setSelectionRange(end, end)
      field.classList.add('uid-input-attention')
      window.setTimeout(() => field.classList.remove('uid-input-attention'), 1400)
    })
  }

  private toggleFeature(id: string): void {
    const selected = new Set(this.state.selectedFeatures)
    let becameActive = false
    if (selected.has(id)) {
      selected.delete(id)
      becameActive = false
    } else {
      selected.add(id)
      becameActive = true
    }
    const module = FEATURE_MODULES.find(m => m.id === id)
    this.lastFeatureAction = {
      id,
      label: module?.label ?? id,
      active: becameActive,
      at: Date.now(),
    }
    this.layoutReviewedScreens.delete(this.layoutScreenKey(this.activeScreen))
    this.setState({
      ...this.state,
      selectedFeatures: [...selected],
      layoutApproved: false,
      styleBoardApproved: false,
      confirmedStylePackId: '',
      workflowStep: 'layout',
    })
  }

  private applyRecommended(): void {
    this.setState({
      ...this.state,
      selectedFeatures: recommendedFeatures(this.state),
      layoutApproved: false,
      styleBoardApproved: false,
      confirmedStylePackId: '',
    })
  }

  private resetScreenFeatures(): void {
    const modules = getScreenModules(this.state.genrePreset, this.activeScreen)
    const screenModuleIds = new Set([
      ...modules.required.map(m => m.id),
      ...modules.recommended.map(m => m.id),
      ...modules.optional.map(m => m.id),
    ])
    const kept = this.state.selectedFeatures.filter(id => !screenModuleIds.has(id))
    const selectedFeatures = mergeScreenBaselineIntoSelection(this.state.genrePreset, this.activeScreen, kept)
    this.layoutBaselineMergedScreens.add(this.layoutScreenKey(this.activeScreen))
    this.layoutReviewedScreens.delete(this.layoutScreenKey(this.activeScreen))
    this.lastFeatureAction = null
    this.setState({
      ...this.state,
      selectedFeatures,
      layoutApproved: false,
      styleBoardApproved: false,
      confirmedStylePackId: '',
      workflowStep: 'layout',
    })
  }

  private toggleAssetLock(kind: AssetKindId): void {
    const next = new Set(this.state.lockedAssetKinds)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    this.setState({ ...this.state, lockedAssetKinds: [...next] })
  }

  private setComparePack(packId: string): void {
    this.setState({
      ...this.state,
      compareHistoryPackId: this.state.compareHistoryPackId === packId ? '' : packId,
    })
  }

  private goToStep(step: WorkflowStepId): void {
    this.componentHistoryOpen = false
    this.componentAssetLightbox = null
    if (step === 'layout' && !this.hasStartedLayoutWorkflow()) {
      this.genreSelectionConfirmed = true
    }
    if (step !== 'genre' && !this.hasStartedLayoutWorkflow()) {
      this.workflowGateNotice = '请先在第 1 步选择游戏类型，然后再配置页面布局。'
      this.collapsedWorkflowSections.delete('genre')
      this.setState({ ...this.state, workflowStep: 'genre' })
      return
    }
    if (!this.canEnterComponentWorkflow(step)) {
      this.workflowGateNotice = '请先完成第 1 步游戏类型，并在第 2 步点击「确认布局」后，再进入风格选择与组件生成。'
      this.collapsedWorkflowSections.delete('layout')
      this.setState({ ...this.state, workflowStep: 'layout' })
      return
    }
    this.workflowGateNotice = null
    this.collapsedWorkflowSections.delete(step)
    if (step === 'layout') {
      this.ensureLayoutScreenFocus()
      const key = this.layoutScreenKey(this.activeScreen)
      if (!this.layoutBaselineMergedScreens.has(key)) {
        const merged = mergeScreenBaselineIntoSelection(
          this.state.genrePreset,
          this.activeScreen,
          this.state.selectedFeatures,
        )
        this.layoutBaselineMergedScreens.add(key)
        this.setState({ ...this.state, workflowStep: step, selectedFeatures: merged })
        return
      }
    }
    this.setState({ ...this.state, workflowStep: step })
  }

  /** 切换界面流节点或中央 Tab：在布局步骤下首次进入某屏时合并必选+推荐基线 */
  private handleScreenNavigation(screen: ScreenKind, forceLayoutPreview = false): void {
    if (forceLayoutPreview && !this.hasStartedLayoutWorkflow()) {
      this.genreSelectionConfirmed = true
    }
    this.activeScreen = screen
    let next = { ...this.state }
    if (forceLayoutPreview) {
      this.workflowGateNotice = null
      this.collapsedWorkflowSections.delete('layout')
      next.workflowStep = 'layout'
    }
    if (next.workflowStep === 'layout') {
      const key = `${next.genrePreset}::${screen}`
      if (!this.layoutBaselineMergedScreens.has(key)) {
        next.selectedFeatures = mergeScreenBaselineIntoSelection(next.genrePreset, screen, next.selectedFeatures)
        this.layoutBaselineMergedScreens.add(key)
      }
    }
    const mapped = SCREEN_TO_PREVIEW[screen]
    if (mapped && mapped !== next.previewMode) {
      next.previewMode = mapped
    }
    this.setState(next)
  }

  private nextStep(): void {
    const idx = WORKFLOW_STEPS.findIndex(step => step.id === this.state.workflowStep)
    const next = WORKFLOW_STEPS[idx + 1]
    if (next) this.goToStep(next.id)
  }

  private advanceToExpandedStep(step: WorkflowStepId, nextState: UIDesignState): void {
    this.collapsedWorkflowSections.delete(step)
    this.setState({ ...nextState, workflowStep: step })
  }

  private canEnterComponentWorkflow(step: WorkflowStepId): boolean {
    if (step === 'genre' || step === 'layout') return true
    if (step === 'prototype') return this.canGeneratePrototype()
    return this.state.layoutApproved
  }

  private canGeneratePrototype(): boolean {
    // 强制支持“全链路重生”：只要布局与风格已确认即可开始生成，
    // 生成时会重新拉取/重生组件与背景，而不是复用旧 liveAssets。
    return Boolean(this.state.layoutApproved && this.state.styleBoardApproved)
  }

  private confirmCurrentLayoutScreen(): void {
    const flow = getScreenFlow(this.state.genrePreset)
    const key = this.layoutScreenKey(this.activeScreen)
    this.layoutReviewedScreens.add(key)
    this.workflowGateNotice = null
    const nextPending = flow.find(screen => !this.layoutReviewedScreens.has(this.layoutScreenKey(screen.kind)))
    if (nextPending) {
      this.handleScreenNavigation(nextPending.kind, true)
      return
    }
    this.render()
    this.broadcastState()
  }

  private confirmLayout(): void {
    if (!this.allLayoutScreensReviewed()) {
      const flow = getScreenFlow(this.state.genrePreset)
      const pending = flow.filter(screen => !this.layoutReviewedScreens.has(this.layoutScreenKey(screen.kind)))
      const label = pending[0]?.label ?? '未确认页面'
      this.workflowGateNotice = `还有 ${pending.length} 个页面未确认，请先完成「${label}」并点击「确认本页」。`
      this.collapsedWorkflowSections.delete('layout')
      this.render()
      return
    }
    this.workflowGateNotice = null
    this.collapsedWorkflowSections.add('genre')
    this.collapsedWorkflowSections.add('layout')
    this.advanceToExpandedStep('style', { ...this.state, layoutApproved: true })
  }

  private async makeThumbnail(src: string | undefined, width: number, height: number): Promise<string | undefined> {
    if (!src) return undefined
    try {
      const img = new Image()
      img.decoding = 'async'
      const loaded = new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = reject
      })
      img.src = src
      await loaded
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return src
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
      return canvas.toDataURL('image/jpeg', 0.74)
    } catch {
      return src
    }
  }

  private async buildHistoryPreview(): Promise<StyleAssetPreview | undefined> {
    if (!this.liveAssets.buttonPrimary && !this.liveAssets.buttonNormal && !this.liveAssets.titleDeco
      && !this.liveAssets.panelTexture && !this.liveAssets.icons.some(Boolean)) {
      return undefined
    }
    const iconSrc = this.liveAssets.icons.find(Boolean)
    const iconThumbs = await Promise.all(
      this.liveAssets.icons
        .filter(Boolean)
        .slice(0, 4)
        .map((icon) => this.makeThumbnail(icon, 56, 56)),
    )
    return {
      buttonPrimary: await this.makeThumbnail(this.liveAssets.buttonPrimary, 180, 56),
      buttonNormal: await this.makeThumbnail(this.liveAssets.buttonNormal, 180, 56),
      titleDeco: await this.makeThumbnail(this.liveAssets.titleDeco, 220, 72),
      panelTexture: await this.makeThumbnail(this.liveAssets.panelTexture, 160, 96),
      icon: await this.makeThumbnail(iconSrc, 56, 56),
      icons: iconThumbs.filter((icon): icon is string => typeof icon === 'string'),
    }
  }

  private async confirmStyleBoard(skipToPrototype = false): Promise<void> {
    const now = Date.now()
    const label = [
      GENRE_PRESETS.find(item => item.id === this.state.genrePreset)?.label ?? this.state.genrePreset,
      STYLE_PRESETS.find(item => item.id === this.state.style)?.label ?? this.state.style,
      this.state.assetPromptNotes.trim() || '默认组件风格',
    ].join(' · ')
    const preview = await this.buildHistoryPreview()
    const pack = {
      id: `${this.state.genrePreset}:${this.state.style}:${now}`,
      label,
      genrePreset: this.state.genrePreset,
      style: this.state.style,
      sceneDesc: this.state.sceneDesc.trim(),
      confirmedAt: now,
      assets: this.getLivePreviewAssets(),
      preview,
    }
    const targetStep: WorkflowStepId = skipToPrototype ? 'prototype' : 'component-preview'
    this.advanceToExpandedStep(targetStep, {
      ...this.state,
      styleBoardApproved: true,
      confirmedStylePackId: pack.id,
      assetHistory: this.compactAssetHistoryForStorage([pack, ...this.state.assetHistory.filter(item => item.id !== pack.id)]),
    })
  }

  private hasAnyLiveComponentAsset(): boolean {
    return Boolean(
      this.liveAssets.buttonPrimary
      || this.liveAssets.buttonNormal
      || this.liveAssets.titleDeco
      || this.liveAssets.panelTexture
      || this.liveAssets.icons.some(Boolean),
    )
  }

  private preserveCurrentComponentPack(): void {
    if (!this.hasAnyLiveComponentAsset()) return
    const existingId = this.state.confirmedStylePackId
    if (existingId && this.state.assetHistory.some(item => item.id === existingId && (item.assets || item.preview))) {
      return
    }
    const now = Date.now()
    const packId = existingId || `${this.state.genrePreset}:${this.state.style}:preserved:${now}`
    const pack = {
      id: packId,
      label: [
        GENRE_PRESETS.find(item => item.id === this.state.genrePreset)?.label ?? this.state.genrePreset,
        STYLE_PRESETS.find(item => item.id === this.state.style)?.label ?? this.state.style,
        this.state.assetPromptNotes.trim() || '上一次组件风格',
      ].join(' · '),
      genrePreset: this.state.genrePreset,
      style: this.state.style,
      sceneDesc: this.state.sceneDesc.trim(),
      confirmedAt: now,
      assets: this.getLivePreviewAssets(),
      preview: undefined,
    }
    this.state = {
      ...this.state,
      assetHistory: this.compactAssetHistoryForStorage([pack, ...this.state.assetHistory.filter(item => item.id !== pack.id)]),
      confirmedStylePackId: existingId || pack.id,
    }
    saveState(this.state)
    this.broadcastState()
  }

  private compactAssetHistoryForStorage(items: UIDesignState['assetHistory']): UIDesignState['assetHistory'] {
    return items.slice(0, 8).map((item, index) => index === 0 ? item : { ...item, assets: undefined })
  }

  private showComponentGenerationLoadingNow(): void {
    const steps = this.getComponentLibrarySteps()
    const total = steps.length
    if (!this.componentPreviewProgress) {
      const totalUnits = this.getComponentGenerationUnitTotal(steps)
      this.setComponentPreviewProgress(0, total, steps[0]?.label ?? '', {
        stepIndex: 0,
        completedUnits: 0,
        totalUnits,
      })
    }
    this.componentPreviewLoading = true
    this.componentPreviewError = null
    if (this.panels) {
      this.panels.center.innerHTML = this.renderComponentLibraryLoadingCenter()
    }
  }

  private handleRestartActionClick(event: MouseEvent): boolean {
    if (!(event.target instanceof Element)) return false
    const btn = event.target.closest<HTMLElement>('[data-uid-action]')
    const action = btn?.dataset.uidAction
    if (!btn || !action || !this.restartActions.has(action)) return false
    event.preventDefault()
    event.stopImmediatePropagation()
    if (btn.hasAttribute('disabled') || btn.dataset.uidDisabled === 'true') {
      this.workflowGateNotice = '请先完成前两步：选择游戏类型，并在第 2 步确认布局后才能生成组件素材。'
      this.setState({ ...this.state, workflowStep: 'layout' })
      return true
    }
    void this.restartComponentGeneration()
    return true
  }

  private async restartComponentGeneration(): Promise<void> {
    if (this.loadComponentLibraryRunning) {
      this.collapsedWorkflowSections.delete('component-preview')
      this.showComponentGenerationLoadingNow()
      this.broadcastState()
      return
    }
    if (!this.state.layoutApproved) {
      this.workflowGateNotice = '请先完成前两步：选择游戏类型，并在第 2 步确认布局后才能生成组件素材。'
      this.setState({ ...this.state, workflowStep: 'layout' })
      return
    }
    this.preserveCurrentComponentPack()
    this.componentHistoryOpen = false
    this.componentAssetLightbox = null
    this.prototypeHTML = null
    this.componentPreviewError = null
    this.componentPreviewLoading = true
    this.componentPreviewProgress = null
    this.loadComponentLibraryRunning = false
    this.componentLibraryAutoRequestKey = ''
    this.componentCoreBackfillAttempts = {}
    this.componentCoreBackfillRunning = false
    this.activeComponentLibrarySteps = buildComponentLibrarySteps(this.state.genrePreset, this.state.selectedFeatures)
    const steps = this.activeComponentLibrarySteps
    this.skipLiveAssetHydration = true
    this.clearComponentLibraryLiveAssets()
    this.collapsedWorkflowSections.add('style')
    this.collapsedWorkflowSections.delete('component-preview')
    this.collapsedWorkflowSections.delete('prototype')
    const restartSteps = this.activeComponentLibrarySteps
    const restartTotalUnits = this.getComponentGenerationUnitTotal(restartSteps)
    this.setComponentPreviewProgress(0, restartSteps.length, restartSteps[0]?.label ?? '', {
      stepIndex: 0,
      completedUnits: 0,
      totalUnits: restartTotalUnits,
    })
    this.setState({
      ...this.state,
      styleBoardApproved: false,
      confirmedStylePackId: '',
      workflowStep: 'component-preview',
    })
    this.showComponentGenerationLoadingNow()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await this.loadComponentLibrary(true)
  }

  private applyHistoryPack(packId: string): void {
    const pack = this.state.assetHistory.find(item => item.id === packId)
    if (!pack) return
    this.advanceToExpandedStep('component-preview', {
      ...this.state,
      genrePreset: pack.genrePreset,
      style: pack.style,
      sceneDesc: pack.sceneDesc,
      styleBoardPrompt: defaultStyleBoardPrompt({
        genrePreset: pack.genrePreset,
        style: pack.style,
        sceneDesc: pack.sceneDesc,
      }),
    })
  }

  private applyHistoryAssetKinds(packId: string, kinds: Array<'buttonPrimary' | 'buttonNormal' | 'titleDeco' | 'panelTexture' | 'icons'>): void {
    const pack = this.state.assetHistory.find(item => item.id === packId)
    const assets = pack?.assets ?? pack?.preview
    if (!assets) return
    if (kinds.includes('buttonPrimary') && assets.buttonPrimary) this.liveAssets.buttonPrimary = assets.buttonPrimary
    if (kinds.includes('buttonNormal') && assets.buttonNormal) this.liveAssets.buttonNormal = assets.buttonNormal
    if (kinds.includes('titleDeco') && assets.titleDeco) this.liveAssets.titleDeco = assets.titleDeco
    if (kinds.includes('panelTexture') && assets.panelTexture) this.liveAssets.panelTexture = assets.panelTexture
    if (kinds.includes('icons')) {
      const icons = assets.icons?.length ? assets.icons : (assets.icon ? [assets.icon] : [])
      if (icons.length) {
        this.liveAssets.icons = this.ensureIconSlots(icons.length)
        icons.forEach((src, index) => {
          if (src) this.liveAssets.icons[index] = src
        })
      }
    }
    this.render()
    requestAnimationFrame(() => this.injectLiveAssets())
  }

  private openHistoryPreview(packId: string): void {
    const pack = this.state.assetHistory.find(item => item.id === packId)
    if (!pack) return
    this.componentHistoryOpen = false
    this.componentPreviewError = null
    this.componentPreviewLoading = false
    this.loadComponentLibraryRunning = false
    this.setState({
      ...this.state,
      genrePreset: pack.genrePreset,
      style: pack.style,
      sceneDesc: pack.sceneDesc,
      confirmedStylePackId: pack.id,
      styleBoardApproved: true,
      workflowStep: 'component-preview',
      styleBoardPrompt: defaultStyleBoardPrompt({
        genrePreset: pack.genrePreset,
        style: pack.style,
        sceneDesc: pack.sceneDesc,
      }),
    })
    this.applyHistoryAssetKinds(packId, ['buttonPrimary', 'buttonNormal', 'titleDeco', 'panelTexture', 'icons'])
  }

  private deleteHistoryPack(packId: string): void {
    this.setState({
      ...this.state,
      assetHistory: this.state.assetHistory.filter(item => item.id !== packId),
      confirmedStylePackId: this.state.confirmedStylePackId === packId ? '' : this.state.confirmedStylePackId,
      compareHistoryPackId: this.state.compareHistoryPackId === packId ? '' : this.state.compareHistoryPackId,
    })
  }

  private getLivePreviewAssets(): StyleAssetPreview {
    return {
      buttonPrimary: this.liveAssets.buttonPrimary,
      buttonNormal: this.liveAssets.buttonNormal,
      titleDeco: this.liveAssets.titleDeco,
      panelTexture: this.liveAssets.panelTexture,
      icon: this.liveAssets.icons.find(Boolean),
      icons: this.liveAssets.icons.filter(Boolean),
    }
  }

  private mergeLiveAssetPreview(assets: StyleAssetPreview | undefined): void {
    if (!assets) return
    if (assets.buttonPrimary) this.liveAssets.buttonPrimary = assets.buttonPrimary
    if (assets.buttonNormal) this.liveAssets.buttonNormal = assets.buttonNormal
    if (assets.titleDeco) this.liveAssets.titleDeco = assets.titleDeco
    if (assets.panelTexture) this.liveAssets.panelTexture = assets.panelTexture
    const icons = assets.icons?.length ? assets.icons : (assets.icon ? [assets.icon] : [])
    if (icons.length) {
      this.liveAssets.icons = this.ensureIconSlots(icons.length)
      icons.forEach((src, index) => {
        if (src) this.liveAssets.icons[index] = src
      })
    }
  }

  private hydrateLiveAssetsFromConfirmedPack(): boolean {
    if (this.skipLiveAssetHydration) return false
    if (!this.state.confirmedStylePackId) return false
    const pack = this.state.assetHistory.find(item => item.id === this.state.confirmedStylePackId)
    if (!pack) return false
    const assets = pack.assets ?? pack.preview
    if (!assets) return false
    let changed = false
    if (assets.buttonPrimary && !this.liveAssets.buttonPrimary) {
      this.liveAssets.buttonPrimary = assets.buttonPrimary
      changed = true
    }
    if (assets.buttonNormal && !this.liveAssets.buttonNormal) {
      this.liveAssets.buttonNormal = assets.buttonNormal
      changed = true
    }
    if (assets.titleDeco && !this.liveAssets.titleDeco) {
      this.liveAssets.titleDeco = assets.titleDeco
      changed = true
    }
    if (assets.panelTexture && !this.liveAssets.panelTexture) {
      this.liveAssets.panelTexture = assets.panelTexture
      changed = true
    }
    const icons = assets.icons?.length ? assets.icons : (assets.icon ? [assets.icon] : [])
    if (icons.length && this.liveAssets.icons.filter(Boolean).length < this.getIconSlotCount()) {
      this.liveAssets.icons = this.ensureIconSlots(icons.length)
      icons.forEach((src, index) => {
        if (src) this.liveAssets.icons[index] = src
      })
      changed = true
    }
    return changed
  }

  /** 开始分步生成前清空 chrome，避免第 1 步完成后 hasFull 误判并提前结束进度 UI */
  private clearComponentLibraryLiveAssets(): void {
    this.liveAssets = {
      icons: [],
      buttonNormal: undefined,
      buttonPrimary: undefined,
      titleDeco: undefined,
      panelTexture: undefined,
    }
  }

  private mergeGeneratedAssets(assets: Partial<GeneratedAssets> | undefined): void {
    if (!assets) return
    if (assets.buttonNormal) this.liveAssets.buttonNormal = assets.buttonNormal
    if (assets.buttonPrimary) this.liveAssets.buttonPrimary = assets.buttonPrimary
    if (assets.titleDeco) this.liveAssets.titleDeco = assets.titleDeco
    if (assets.panelTexture) this.liveAssets.panelTexture = assets.panelTexture
    if (Array.isArray(assets.icons)) {
      this.liveAssets.icons = this.ensureIconSlots(Math.max(assets.icons.length, this.getIconSlotCount()))
      assets.icons.forEach((src, index) => {
        if (src) this.liveAssets.icons[index] = src
      })
    }
  }

  private renderHistoryPreviewMarkup(preview?: StyleAssetPreview): string {
    const iconList = (preview?.icons?.length ? preview.icons : preview?.icon ? [preview.icon] : []).slice(0, 4)
    return `
      <div class="uid-history-preview">
        <div class="uid-history-title" ${preview?.titleDeco ? `style="background-image:url('${esc(preview.titleDeco)}')"` : ''}>标题条</div>
        <div class="uid-history-panel" ${preview?.panelTexture ? `style="background-image:url('${esc(preview.panelTexture)}')"` : ''}>面板纹理</div>
        <div class="uid-history-button-row">
          <span class="uid-history-btn primary" ${preview?.buttonPrimary ? `style="background-image:url('${esc(preview.buttonPrimary)}')"` : ''}></span>
          <span class="uid-history-btn" ${preview?.buttonNormal ? `style="background-image:url('${esc(preview.buttonNormal)}')"` : ''}></span>
          <div class="uid-history-icons">
            ${iconList.length > 0
              ? iconList.map(icon => `<span class="uid-history-icon" style="background-image:url('${esc(icon)}')"></span>`).join('')
              : '<span class="uid-history-icon"></span>'}
          </div>
        </div>
      </div>
    `
  }

  private resolveComponentAssetView(token: string): { title: string; src: string } | null {
    if (token === 'titleDeco' && this.liveAssets.titleDeco) {
      return { title: '标题条', src: this.liveAssets.titleDeco }
    }
    if (token === 'buttonPrimary' && this.liveAssets.buttonPrimary) {
      return { title: '主按钮', src: this.liveAssets.buttonPrimary }
    }
    if (token === 'buttonNormal' && this.liveAssets.buttonNormal) {
      return { title: '次按钮', src: this.liveAssets.buttonNormal }
    }
    if (token === 'panelTexture' && this.liveAssets.panelTexture) {
      return { title: '面板底纹', src: this.liveAssets.panelTexture }
    }
    if (token.startsWith('icon:')) {
      const index = Number(token.slice('icon:'.length))
      const src = Number.isFinite(index) ? this.liveAssets.icons[index] : undefined
      const slots = iconSlotDescriptorsFromModuleSpecs(this.getModuleAssetSpecs())
      const slot = Number.isFinite(index) ? slots[index] : undefined
      if (src) {
        return {
          title: slot ? `${slot.label} — ${slot.functionTitle}` : `功能图标 ${index + 1}`,
          src,
        }
      }
    }
    return null
  }

  private resolveDynamicSectionView(sectionId: StyleBoardSection['id']): { title: string; html: string } | null {
    const section = resolveStyleBoardSectionsForLayout(this.state.genrePreset, this.state.selectedFeatures)
      .find(item => item.id === sectionId)
    if (!section) return null
    return {
      title: section.label,
      html: `
        <div class="uid-clib-extra-card uid-asset-section-zoom uid-asset-section-zoom-${section.id}">
          <div class="uid-clib-extra-head">
            <span>${esc(section.label)}</span>
            <em>${esc(section.description)}</em>
          </div>
          ${this.renderDynamicSectionZoomPreview(section)}
        </div>
      `,
    }
  }

  private buildAssetLightboxGallery(): Array<{ token: string; title: string; src: string }> {
    const items: Array<{ token: string; title: string; src: string }> = []
    const steps = this.getComponentLibrarySteps()
    const stepKinds = new Set(steps.map(step => step.kind))

    if (stepKinds.has('titleDeco') && this.liveAssets.titleDeco) {
      items.push({ token: 'titleDeco', title: '标题条', src: this.liveAssets.titleDeco })
    }
    if (stepKinds.has('buttonPrimary') && this.liveAssets.buttonPrimary) {
      items.push({ token: 'buttonPrimary', title: '主按钮', src: this.liveAssets.buttonPrimary })
    }
    if (stepKinds.has('buttonNormal') && this.liveAssets.buttonNormal) {
      items.push({ token: 'buttonNormal', title: '次按钮', src: this.liveAssets.buttonNormal })
    }
    if (stepKinds.has('panelTexture') && this.liveAssets.panelTexture) {
      items.push({ token: 'panelTexture', title: '面板底纹', src: this.liveAssets.panelTexture })
    }
    const slots = iconSlotDescriptorsFromModuleSpecs(this.getModuleAssetSpecs())
    for (const slot of slots) {
      const src = this.liveAssets.icons[slot.slotIndex]
      if (src) {
        items.push({
          token: `icon:${slot.slotIndex}`,
          title: `${slot.label} — ${slot.functionTitle}`,
          src,
        })
      }
    }
    return items
  }

  private buildSectionLightboxGallery(): Array<{ token: string; title: string; html: string }> {
    const sections = resolveStyleBoardSectionsForLayout(this.state.genrePreset, this.state.selectedFeatures)
    const items: Array<{ token: string; title: string; html: string }> = []
    for (const section of sections) {
      const view = this.resolveDynamicSectionView(section.id)
      if (view) {
        items.push({ token: section.id, title: view.title, html: view.html })
      }
    }
    return items
  }

  private openComponentAssetLightbox(kind: 'asset' | 'section', token: string): void {
    if (kind === 'asset') {
      const asset = this.resolveComponentAssetView(token)
      if (!asset) return
      this.componentAssetLightbox = { kind: 'asset', token, ...asset }
    } else {
      const section = this.resolveDynamicSectionView(token as StyleBoardSection['id'])
      if (!section) return
      this.componentAssetLightbox = { kind: 'section', token, ...section }
    }
    this.render()
    requestAnimationFrame(() => this.injectLiveAssets())
  }

  private stepComponentAssetLightbox(delta: -1 | 1): void {
    if (!this.componentAssetLightbox) return
    const gallery = this.componentAssetLightbox.kind === 'asset'
      ? this.buildAssetLightboxGallery()
      : this.buildSectionLightboxGallery()
    if (gallery.length <= 1) return
    const currentIndex = gallery.findIndex(item => item.token === this.componentAssetLightbox!.token)
    if (currentIndex < 0) return
    const nextIndex = (currentIndex + delta + gallery.length) % gallery.length
    const next = gallery[nextIndex]
    if (this.componentAssetLightbox.kind === 'asset') {
      this.componentAssetLightbox = {
        kind: 'asset',
        token: next.token,
        title: next.title,
        src: next.src,
      }
    } else {
      this.componentAssetLightbox = {
        kind: 'section',
        token: next.token,
        title: next.title,
        html: next.html,
      }
    }
    this.render()
    requestAnimationFrame(() => this.injectLiveAssets())
  }

  private closeComponentAssetLightbox(): void {
    this.componentAssetLightbox = null
    this.render()
    requestAnimationFrame(() => this.injectLiveAssets())
  }

  private renderDynamicSectionZoomPreview(section: StyleBoardSection): string {
    return this.renderDynamicSectionPreview(section)
  }

  private renderComponentAssetLightbox(): string {
    if (!this.componentAssetLightbox) return ''
    const htmlMode = Boolean(this.componentAssetLightbox.html)
    const gallery = this.componentAssetLightbox.kind === 'asset'
      ? this.buildAssetLightboxGallery()
      : this.buildSectionLightboxGallery()
    const galleryIndex = gallery.findIndex(item => item.token === this.componentAssetLightbox!.token)
    const showNav = gallery.length > 1
    const counter = showNav && galleryIndex >= 0 ? `${galleryIndex + 1} / ${gallery.length}` : ''
    return `
      <div class="${cls('uid-asset-lightbox', htmlMode && 'uid-asset-lightbox-html')}" role="dialog" aria-modal="true" aria-label="${esc(this.componentAssetLightbox.title)}">
        <button class="uid-asset-lightbox-backdrop" data-uid-action="close-component-asset-view" aria-label="关闭放大查看"></button>
        <div class="uid-asset-lightbox-card">
          <div class="uid-asset-lightbox-head">
            <div class="uid-asset-lightbox-head-main">
              ${showNav ? `
                <div class="uid-asset-lightbox-nav">
                  <button type="button" class="uid-asset-lightbox-arrow" data-uid-action="prev-component-asset-view" aria-label="上一项">‹</button>
                  <span class="uid-asset-lightbox-counter">${esc(counter)}</span>
                  <button type="button" class="uid-asset-lightbox-arrow" data-uid-action="next-component-asset-view" aria-label="下一项">›</button>
                </div>
              ` : ''}
              <span class="uid-asset-lightbox-title">${esc(this.componentAssetLightbox.title)}</span>
            </div>
            <button class="uid-clib-retry-btn" data-uid-action="close-component-asset-view">关闭</button>
          </div>
          <div class="${cls('uid-asset-lightbox-canvas', htmlMode && 'uid-preview-stage')}">
            ${showNav ? `
              <button type="button" class="uid-asset-lightbox-side uid-asset-lightbox-side-prev" data-uid-action="prev-component-asset-view" aria-label="上一项">‹</button>
              <button type="button" class="uid-asset-lightbox-side uid-asset-lightbox-side-next" data-uid-action="next-component-asset-view" aria-label="下一项">›</button>
            ` : ''}
            ${this.componentAssetLightbox.src
              ? `<img src="${esc(this.componentAssetLightbox.src)}" alt="${esc(this.componentAssetLightbox.title)}" />`
              : this.componentAssetLightbox.html ?? ''}
          </div>
        </div>
      </div>
    `
  }

  private async regenerateAssetKinds(kinds: AssetKindId[]): Promise<boolean> {
    if (!this.panels) return false
    const unlockedKinds = kinds.filter(kind => !this.state.lockedAssetKinds.includes(kind))
    if (unlockedKinds.length === 0) return false

    const genreLabel = GENRE_PRESETS.find(g => g.id === this.state.genrePreset)?.label ?? ''
    const stylePreset = STYLE_PRESETS.find(s => s.id === this.state.style)
    const generationNonce = createUiGenerationNonce()
    this.skipLiveAssetHydration = true
    try {
      const resp = await fetch('/__ce-api__/ui-design/generate-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          genre: genreLabel,
          style: stylePreset?.label ?? this.state.style,
          styleTone: stylePreset?.tone ?? '',
          styleKey: this.state.style,
          genreKey: this.state.genrePreset,
          screens: unlockedKinds.includes('background') ? [this.activeScreen] : [],
          sceneDesc: '',
          styleBoardPrompt: this.state.styleBoardPrompt,
          assetPromptNotes: this.state.assetPromptNotes,
          assetKinds: unlockedKinds,
          generationNonce,
          moduleAssetSpecs: this.getModuleAssetSpecs(),
          iconSlotCount: this.getIconSlotCount(),
        }),
      })
      const json = await this.parseGenerateAssetsResponse(resp, '组件素材补全')
      if (!json.success || !json.assets) return false

      if (unlockedKinds.includes('background') && json.assets.backgrounds[this.activeScreen]) {
        this.previewBg[this.activeScreen] = json.assets.backgrounds[this.activeScreen]
      }
      if (unlockedKinds.includes('buttonNormal')) this.liveAssets.buttonNormal = json.assets.buttonNormal
      if (unlockedKinds.includes('buttonPrimary')) this.liveAssets.buttonPrimary = json.assets.buttonPrimary
      if (unlockedKinds.includes('titleDeco')) this.liveAssets.titleDeco = json.assets.titleDeco
      if (unlockedKinds.includes('panelTexture')) this.liveAssets.panelTexture = json.assets.panelTexture
      if (unlockedKinds.includes('icons') && Array.isArray(json.assets.icons)) {
        this.liveAssets.icons = this.ensureIconSlots(json.assets.icons.length)
        json.assets.icons.forEach((src, index) => {
          if (src) this.liveAssets.icons[index] = src
        })
      }
      this.render()
      return true
    } catch {
      // keep silent in authoring flow
      return false
    } finally {
      this.skipLiveAssetHydration = false
    }
  }

  /** 主按钮/次按钮/标题/面板/功能图标齐全，第四步预览可结束 loading */
  private hasFullComponentLibrary(): boolean {
    return this.getComponentLibrarySteps().every(step => this.isAssetKindComplete(step.kind))
  }

  /** 预览可用阈值：有任意核心素材即可先展示，避免长期停留在“生成中” */
  private hasUsableComponentLibrary(): boolean {
    return !!(
      this.liveAssets.buttonNormal
      || this.liveAssets.buttonPrimary
      || this.liveAssets.titleDeco
      || this.liveAssets.panelTexture
      || this.liveAssets.icons.filter(Boolean).length > 0
    )
  }

  private missingCoreAssetKinds(): AssetKindId[] {
    const missing: AssetKindId[] = []
    const stepKinds = new Set(this.getComponentLibrarySteps().map(step => step.kind))
    if (stepKinds.has('buttonPrimary') && !this.liveAssets.buttonPrimary) missing.push('buttonPrimary')
    if (stepKinds.has('buttonNormal') && !this.liveAssets.buttonNormal) missing.push('buttonNormal')
    if (stepKinds.has('titleDeco') && !this.liveAssets.titleDeco) missing.push('titleDeco')
    return missing
  }

  private coreBackfillAttemptKey(missing: AssetKindId[]): string {
    const sig = [...missing].sort().join(',')
    return `${this.componentVisualRequestKey()}::${sig}`
  }

  /** 风格组件生图缓存签名：风格元素提示词 + 第二步布局模块都会影响视觉 */
  private componentVisualRequestKey(): string {
    const features = [...confirmedLayoutFeatureIds(this.state.genrePreset, this.state.selectedFeatures)].sort().join(',')
    return [
      this.state.genrePreset,
      this.state.style,
      this.state.styleBoardPrompt.trim(),
      this.state.assetPromptNotes.trim(),
      features,
    ].join('::')
  }

  private isAssetKindComplete(kind: AssetKindId): boolean {
    if (kind === 'buttonPrimary') return !!this.liveAssets.buttonPrimary
    if (kind === 'buttonNormal') return !!this.liveAssets.buttonNormal
    if (kind === 'titleDeco') return !!this.liveAssets.titleDeco
    if (kind === 'panelTexture') return !!this.liveAssets.panelTexture
    if (kind === 'icons') return this.liveAssets.icons.filter(Boolean).length >= this.getIconSlotCount()
    return true
  }

  private setComponentPreviewProgress(
    done: number,
    total: number,
    currentLabel: string,
    options?: {
      stepIndex?: number
      percent?: number
      completedUnits?: number
      totalUnits?: number
    },
  ): void {
    const clampedDone = Math.max(0, Math.min(done, total))
    const stepIndex = options?.stepIndex ?? Math.min(clampedDone, Math.max(0, total - 1))
    const totalUnits = options?.totalUnits ?? this.getComponentGenerationUnitTotal()
    const completedUnits = Math.max(0, Math.min(options?.completedUnits ?? 0, totalUnits))
    const percent = this.displayProgressPercent(
      options?.percent ?? this.percentFromGenerationUnits(completedUnits, totalUnits),
    )
    this.componentPreviewProgress = {
      done: clampedDone,
      stepIndex,
      total,
      completedUnits,
      totalUnits,
      percent,
      currentLabel,
    }
  }

  private stopLoadingProgressPulse(): void {
    if (this.componentProgressPulseTimer) {
      clearInterval(this.componentProgressPulseTimer)
      this.componentProgressPulseTimer = null
    }
  }

  /** 图生耗时较长：在当前已完成单元与在途单元上限之间缓动，仅 patch 进度 DOM。 */
  private startLoadingProgressPulse(
    completedUnits: number,
    totalUnits: number,
    currentLabel: string,
    options?: { stepIndex?: number; done?: number; total?: number; inFlightUnits?: number },
  ): void {
    this.stopLoadingProgressPulse()
    if (totalUnits <= 0) return
    const inFlight = Math.max(1, options?.inFlightUnits ?? 1)
    const startedCompleted = completedUnits
    const started = Date.now()
    this.componentProgressPulseTimer = setInterval(() => {
      if (!this.loadComponentLibraryRunning || !this.componentPreviewProgress) return
      const progress = this.componentPreviewProgress
      const liveCompleted = progress.completedUnits
      const inflightRemaining = Math.max(1, inFlight - (liveCompleted - startedCompleted))
      const fromPct = this.percentFromGenerationUnits(liveCompleted, totalUnits)
      const capUnits = Math.min(totalUnits, liveCompleted + inflightRemaining * 0.9)
      const capPct = this.percentFromGenerationUnits(capUnits, totalUnits)
      const elapsed = Date.now() - started
      const t = Math.min(1, elapsed / 90_000)
      const eased = 1 - (1 - t) ** 2
      const pct = this.displayProgressPercent(fromPct + (capPct - fromPct) * eased)
      this.setComponentPreviewProgress(
        options?.done ?? progress.done,
        options?.total ?? progress.total,
        currentLabel,
        {
          stepIndex: options?.stepIndex ?? progress.stepIndex,
          completedUnits: liveCompleted,
          totalUnits,
          percent: pct,
        },
      )
      this.patchComponentLibraryLoadingUi()
    }, 350)
  }

  private patchComponentLibraryLoadingUi(): void {
    if (!this.panels || !this.componentPreviewProgress) return
    const root = this.panels.center.querySelector('.uid-clib-loading')
    if (!root) return
    const { percent, done, stepIndex, total, currentLabel, completedUnits, totalUnits } = this.componentPreviewProgress
    const pct = this.displayProgressPercent(percent)
    const pctEl = root.querySelector('.uid-loading-percent')
    const fill = root.querySelector<HTMLElement>('.uid-progress-fill')
    const track = root.querySelector<HTMLElement>('.uid-progress-track')
    const sub = root.querySelector('.uid-loading-sub')
    if (pctEl) pctEl.textContent = this.formatProgressPercentLabel(percent)
    if (fill) {
      fill.style.width = `${pct}%`
      fill.classList.toggle('is-pulsing', this.loadComponentLibraryRunning)
    }
    if (track) track.setAttribute('aria-valuenow', String(pct))
    const unitDone = Math.min(completedUnits + (this.loadComponentLibraryRunning ? 1 : 0), totalUnits)
    if (sub) sub.textContent = `第 ${unitDone}/${totalUnits} 项 · 正在生成：${currentLabel}`
    const steps = this.getComponentLibrarySteps()
    root.querySelectorAll<HTMLElement>('.uid-loading-step').forEach((row, index) => {
      const step = steps[index]
      const state = step
        ? this.getComponentLibraryStepVisualState(step, index, this.componentPreviewProgress)
        : index < done ? 'done' : index === stepIndex ? 'active' : 'pending'
      row.className = `uid-loading-step uid-loading-step-${state}`
      const icon = row.querySelector('span')
      if (icon) {
        icon.innerHTML = state === 'done' ? '&#10003;' : state === 'active' ? '&#9656;' : '&#8226;'
      }
    })
  }

  private async parseGenerateAssetsResponse(resp: Response, context: string): Promise<GenerateAssetsResponse> {
    const text = await resp.text()
    if (!text.trim()) {
      throw new Error(
        resp.ok
          ? `${context}：服务端返回空响应（可能请求超时或 image-gemini MCP 未启动）`
          : `${context}：HTTP ${resp.status}，无响应正文`,
      )
    }
    try {
      return JSON.parse(text) as GenerateAssetsResponse
    } catch {
      const snippet = text.slice(0, 120).replace(/\s+/g, ' ')
      throw new Error(`${context}：响应不是有效 JSON（${snippet}）`)
    }
  }

  private isTransportGenerateError(message: string): boolean {
    return message.includes('HTTP ')
      || message.includes('空响应')
      || message.includes('有效 JSON')
      || message.includes('Failed to fetch')
      || message.includes('NetworkError')
      || message.includes('请求超时')
      || message.includes('AbortError')
  }

  private async postGenerateAssetsRequest(
    payload: Record<string, unknown>,
    timeoutMs = COMPONENT_ASSET_REQUEST_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetch('/__ce-api__/ui-design/generate-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  private async fetchComponentAssetWithTimeout(payload: Record<string, unknown>): Promise<Response> {
    return this.postGenerateAssetsRequest(payload, COMPONENT_ASSET_REQUEST_TIMEOUT_MS)
  }

  private async fetchComponentAssetKind(
    kind: AssetKindId,
    cacheKey: string,
    requestBase: Record<string, unknown>,
    options: { iconIndex?: number } = {},
  ): Promise<boolean> {
    const maxAttempts = kind === 'icons' ? 4 : 3
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const payload: Record<string, unknown> = {
          ...requestBase,
          assetKinds: [kind],
          generationAttempt: attempt,
          generationNonce: `${String(requestBase.generationNonce ?? createUiGenerationNonce())}-${kind}-${options.iconIndex ?? 'x'}-a${attempt}`,
        }
        if (kind === 'icons' && typeof options.iconIndex === 'number') {
          const slots = iconSlotDescriptorsFromModuleSpecs(this.getModuleAssetSpecs())
          const slot = slots[options.iconIndex]
          payload.iconIndex = options.iconIndex
          payload.iconModuleId = slot?.moduleId
        }
        const resp = await this.fetchComponentAssetWithTimeout(payload)
        const json = await this.parseGenerateAssetsResponse(resp, ASSET_KIND_LABELS[kind] ?? kind)
        if (cacheKey !== this.componentVisualRequestKey()) return false
        if (json.assets) {
          this.mergeGeneratedAssets(json.assets)
          this.broadcastState()
          if (this.loadComponentLibraryRunning) {
            this.patchComponentLibraryLoadingUi()
          } else {
            this.render()
            requestAnimationFrame(() => this.injectLiveAssets())
          }
          if (kind === 'icons' && typeof options.iconIndex === 'number') {
            return Boolean(this.liveAssets.icons[options.iconIndex])
          }
          if (this.isAssetKindComplete(kind)) return true
        }
        if (!json.success) {
          if (attempt >= maxAttempts) throw new Error(json.error || `${kind} 生成失败`)
        } else if (!json.assets) {
          if (attempt >= maxAttempts) throw new Error(json.error || `${kind} 生成失败`)
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e)
        if (this.isTransportGenerateError(message) && attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 900 * attempt))
          continue
        }
        throw e
      }
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 600 * attempt))
      }
    }
    if (kind === 'icons' && typeof options.iconIndex === 'number') {
      return Boolean(this.liveAssets.icons[options.iconIndex])
    }
    return this.isAssetKindComplete(kind)
  }

  /** 功能图标按槽位并行拉取，每槽单独 HTTP，服务端亦并行生图。 */
  private async runIconSlotsWithConcurrency(
    iconCount: number,
    concurrency: number,
    cacheKey: string,
    requestBase: Record<string, unknown>,
    onSlotDone: (doneCount: number, iconIndex: number) => void,
  ): Promise<boolean> {
    if (iconCount <= 0) return true
    this.liveAssets.icons = this.ensureIconSlots(iconCount)
    let nextIndex = 0
    let doneCount = 0
    const worker = async (): Promise<boolean> => {
      let workerOk = true
      while (nextIndex < iconCount) {
        const iconIndex = nextIndex
        nextIndex += 1
        const slotOk = await this.fetchComponentAssetKind('icons', cacheKey, requestBase, { iconIndex })
        if (cacheKey !== this.componentVisualRequestKey()) return false
        if (!slotOk) workerOk = false
        doneCount += 1
        onSlotDone(doneCount, iconIndex)
      }
      return workerOk
    }
    const workers = Array.from(
      { length: Math.min(concurrency, iconCount) },
      () => worker(),
    )
    const results = await Promise.all(workers)
    return results.every(Boolean) && this.isAssetKindComplete('icons')
  }

  /** 多路 chrome 素材并行拉取（每类单独 HTTP，限制并发避免 MCP 被打满）。 */
  private async runAssetKindTasksWithConcurrency(
    steps: ComponentLibraryStep[],
    concurrency: number,
    cacheKey: string,
    requestBase: Record<string, unknown>,
    onTaskDone: (doneInBatch: number, step: ComponentLibraryStep) => void,
  ): Promise<boolean> {
    if (steps.length === 0) return true
    let nextIndex = 0
    let doneInBatch = 0
    const worker = async (): Promise<boolean> => {
      let workerOk = true
      while (nextIndex < steps.length) {
        const index = nextIndex
        nextIndex += 1
        const step = steps[index]
        const stepOk = await this.fetchComponentAssetKind(step.kind, cacheKey, requestBase)
        if (cacheKey !== this.componentVisualRequestKey()) return false
        if (!stepOk) workerOk = false
        doneInBatch += 1
        onTaskDone(doneInBatch, step)
      }
      return workerOk
    }
    const workers = Array.from(
      { length: Math.min(concurrency, steps.length) },
      () => worker(),
    )
    const results = await Promise.all(workers)
    return results.every(Boolean) && steps.every(step => this.isAssetKindComplete(step.kind))
  }

  /** 按当前类型+风格拉取 UI 组件库：chrome 受控并行，图标等其余步骤串行。 */
  private async loadComponentLibrary(force = false): Promise<void> {
    if (this.loadComponentLibraryRunning) return
    if (!this.panels) return
    if (force) {
      this.componentLibraryAutoRequestKey = ''
      this.componentCoreBackfillAttempts = {}
      this.componentCoreBackfillRunning = false
      this.componentAssetLightbox = null
      this.componentPreviewProgress = null
      this.activeComponentLibrarySteps = []
    }
    this.clearComponentLibraryLiveAssets()
    this.skipLiveAssetHydration = true
    this.loadComponentLibraryRunning = true
    this.componentPreviewLoading = true
    this.componentPreviewError = null
    this.activeComponentLibrarySteps = buildComponentLibrarySteps(this.state.genrePreset, this.state.selectedFeatures)
    const steps = this.activeComponentLibrarySteps
    const total = steps.length
    const totalUnits = this.getComponentGenerationUnitTotal(steps)
    this.setComponentPreviewProgress(0, total, steps[0]?.label ?? '', {
      stepIndex: 0,
      completedUnits: 0,
      totalUnits,
    })
    this.render()
    const genreLabel = GENRE_PRESETS.find(g => g.id === this.state.genrePreset)?.label ?? ''
    const stylePreset = STYLE_PRESETS.find(s => s.id === this.state.style)
    const cacheKey = this.componentVisualRequestKey()
    const requestBase = {
      genre: genreLabel,
      style: stylePreset?.label ?? this.state.style,
      styleTone: stylePreset?.tone ?? '',
      styleKey: this.state.style,
      genreKey: this.state.genrePreset,
      generationNonce: createUiGenerationNonce(),
      screens: [],
      sceneDesc: '',
      styleBoardPrompt: this.state.styleBoardPrompt,
      assetPromptNotes: this.state.assetPromptNotes,
      moduleAssetSpecs: this.getModuleAssetSpecs(),
      iconSlotCount: this.getIconSlotCount(),
    }
    try {
      let doneCount = 0
      let completedUnits = 0
      const chromeSteps = steps.filter(step => PARALLEL_CHROME_ASSET_KINDS.has(step.kind))
      const remainingSteps = steps.filter(step => !PARALLEL_CHROME_ASSET_KINDS.has(step.kind))

      if (chromeSteps.length > 0) {
        const batchLabel = chromeSteps.map(step => step.label).join('、')
        this.setComponentPreviewProgress(doneCount, total, `并行生成：${batchLabel}`, {
          stepIndex: 0,
          completedUnits,
          totalUnits,
        })
        this.render()
        this.startLoadingProgressPulse(completedUnits, totalUnits, `并行生成：${batchLabel}`, {
          stepIndex: 0,
          done: doneCount,
          total,
          inFlightUnits: chromeSteps.length,
        })
        try {
          const ok = await this.runAssetKindTasksWithConcurrency(
            chromeSteps,
            CHROME_GENERATION_CONCURRENCY,
            cacheKey,
            requestBase,
            (doneInBatch, step) => {
              completedUnits = doneInBatch
              const stepIdx = steps.findIndex(item => item.kind === step.kind)
              this.setComponentPreviewProgress(doneInBatch, total, `并行生成：${step.label}`, {
                stepIndex: stepIdx >= 0 ? stepIdx : Math.min(doneInBatch - 1, total - 1),
                completedUnits,
                totalUnits,
              })
              this.patchComponentLibraryLoadingUi()
            },
          )
          if (cacheKey !== this.componentVisualRequestKey()) return
          if (!ok) throw new Error(`组件素材生成失败：${batchLabel}`)
          doneCount = chromeSteps.length
          completedUnits = chromeSteps.length
          const nextLabel = remainingSteps[0]?.label ?? '完成'
          const nextStepIdx = remainingSteps.length > 0
            ? steps.findIndex(item => item.kind === remainingSteps[0].kind)
            : total - 1
          this.setComponentPreviewProgress(doneCount, total, nextLabel, {
            stepIndex: nextStepIdx >= 0 ? nextStepIdx : Math.min(doneCount, total - 1),
            completedUnits,
            totalUnits,
          })
          this.patchComponentLibraryLoadingUi()
        } finally {
          this.stopLoadingProgressPulse()
        }
      }

      for (let i = 0; i < remainingSteps.length; i += 1) {
        const step = remainingSteps[i]
        const stepIndex = doneCount + i
        this.setComponentPreviewProgress(stepIndex, total, step.label, {
          stepIndex,
          completedUnits,
          totalUnits,
        })
        this.render()
        const inFlightUnits = step.kind === 'icons' ? Math.max(1, this.getIconSlotCount()) : 1
        this.startLoadingProgressPulse(completedUnits, totalUnits, step.label, {
          stepIndex,
          done: stepIndex,
          total,
          inFlightUnits,
        })
        try {
          const ok = step.kind === 'icons'
            ? await this.runIconSlotsWithConcurrency(
              this.getIconSlotCount(),
              ICON_GENERATION_CONCURRENCY,
              cacheKey,
              requestBase,
              (doneInIcons, iconIndex) => {
                const slots = iconSlotDescriptorsFromModuleSpecs(this.getModuleAssetSpecs())
                const slotLabel = slots[iconIndex]?.label ?? `图标 ${iconIndex + 1}`
                const slotFn = slots[iconIndex]?.functionTitle ?? ''
                completedUnits = chromeSteps.length + doneInIcons
                this.setComponentPreviewProgress(
                  stepIndex,
                  total,
                  `功能图标：${slotLabel}${slotFn ? `（${slotFn}）` : ''}`,
                  {
                    stepIndex,
                    completedUnits,
                    totalUnits,
                  },
                )
                this.patchComponentLibraryLoadingUi()
              },
            )
            : await this.fetchComponentAssetKind(step.kind, cacheKey, requestBase)
          if (cacheKey !== this.componentVisualRequestKey()) return
          if (!ok) throw new Error(`${step.label}生成失败`)
          completedUnits += inFlightUnits
          const nextLabel = remainingSteps[i + 1]?.label ?? '完成'
          const nextDone = stepIndex + 1
          const nextStepIdx = remainingSteps[i + 1]
            ? steps.findIndex(item => item.kind === remainingSteps[i + 1].kind)
            : total - 1
          this.setComponentPreviewProgress(nextDone, total, nextLabel, {
            stepIndex: nextStepIdx >= 0 ? nextStepIdx : Math.min(nextDone, total - 1),
            completedUnits,
            totalUnits,
          })
          this.patchComponentLibraryLoadingUi()
        } finally {
          this.stopLoadingProgressPulse()
        }
      }
      if (!this.hasFullComponentLibrary()) throw new Error('组件库生成未完成')
      this.setComponentPreviewProgress(total, total, '完成', {
        stepIndex: total - 1,
        completedUnits: totalUnits,
        totalUnits,
        percent: 100,
      })
      this.render()
      await new Promise(resolve => setTimeout(resolve, 350))
      this.componentPreviewError = null
      this.collapsedWorkflowSections.add('style')
      this.collapsedWorkflowSections.delete('component-preview')
      this.collapsedWorkflowSections.delete('prototype')
      const now = Date.now()
      const packId = `${this.state.genrePreset}:${this.state.style}:${now}`
      this.advanceToExpandedStep('component-preview', {
        ...this.state,
        styleBoardApproved: true,
        confirmedStylePackId: packId,
      assetHistory: this.compactAssetHistoryForStorage([{
          id: packId,
          label: [
            GENRE_PRESETS.find(item => item.id === this.state.genrePreset)?.label ?? this.state.genrePreset,
            STYLE_PRESETS.find(item => item.id === this.state.style)?.label ?? this.state.style,
            this.state.assetPromptNotes.trim() || '默认组件风格',
          ].join(' · '),
          genrePreset: this.state.genrePreset,
          style: this.state.style,
          sceneDesc: this.state.sceneDesc.trim(),
          confirmedAt: now,
          assets: this.getLivePreviewAssets(),
          preview: undefined,
        }, ...this.state.assetHistory]),
      })
    } catch (e: unknown) {
      this.componentPreviewError = e instanceof Error ? e.message : String(e)
    } finally {
      this.stopLoadingProgressPulse()
      if (this.hasFullComponentLibrary()) {
        this.componentPreviewLoading = false
        this.componentPreviewProgress = null
      } else if (this.componentPreviewError) {
        this.componentPreviewLoading = false
      }
      this.loadComponentLibraryRunning = false
      this.skipLiveAssetHydration = false
      this.render()
      this.broadcastState()
      requestAnimationFrame(() => this.injectLiveAssets())
    }
  }

  /** 把 liveAssets 注入到当前预览 DOM：按钮图、标题装饰、panel 纹理、icon */
  private injectLiveAssets(): void {
    if (!this.panels) return
    const root = this.panels.center
    const styleTargets = [
      root,
      ...Array.from(root.querySelectorAll<HTMLElement>('.uid-preview-shell, .uid-preview-stage')),
    ]

    // ── CSS 变量注入（让所有后代元素用 var() 引用）──────────────
    styleTargets.forEach(target => {
      if (this.liveAssets.buttonNormal)  target.style.setProperty('--uid-btn-normal',   `url("${this.liveAssets.buttonNormal}")`)
      if (this.liveAssets.buttonPrimary) target.style.setProperty('--uid-btn-primary',  `url("${this.liveAssets.buttonPrimary}")`)
      if (this.liveAssets.titleDeco)     target.style.setProperty('--uid-title-deco',   `url("${this.liveAssets.titleDeco}")`)
      if (this.liveAssets.panelTexture)  target.style.setProperty('--uid-panel-texture',`url("${this.liveAssets.panelTexture}")`)
    })

    // ── icon → 直接替换元素 backgroundImage ─────────────────────
    this.liveAssets.icons.forEach((src, i) => {
      root.querySelectorAll<HTMLElement>(`.uid-live-icon-${i}`).forEach(el => {
        if (!src) {
          el.style.backgroundImage = ''
          el.classList.remove('uid-clib-icon-ready')
          el.classList.add('uid-clib-icon-missing')
          return
        }
        el.style.backgroundImage = `url("${src}")`
        el.style.backgroundSize = 'contain'
        el.style.backgroundRepeat = 'no-repeat'
        el.style.backgroundPosition = 'center'
        el.textContent = ''
        el.classList.add('uid-clib-icon-ready')
        el.classList.remove('uid-clib-icon-missing')
      })
    })
  }

  /** 异步拉取当前屏幕的背景图，完成后局部注入，不触发整体 render */
  private async fetchPreviewBg(screenKind: string): Promise<void> {
    const cacheKey = this.componentVisualRequestKey()
    if (this.previewBg[screenKind] || this.bgLoading.has(screenKind)) return
    this.bgLoading.add(screenKind)

    const genreLabel = GENRE_PRESETS.find(g => g.id === this.state.genrePreset)?.label ?? ''
    const stylePreset = STYLE_PRESETS.find(s => s.id === this.state.style)

    try {
      const resp = await this.postGenerateAssetsRequest({
        genre: genreLabel,
        style: stylePreset?.label ?? this.state.style,
        styleTone: stylePreset?.tone ?? '',
        styleKey: this.state.style,
        genreKey: this.state.genrePreset,
        generationNonce: createUiGenerationNonce(),
        assetKinds: ['background'],
        screens: [screenKind],
        sceneDesc: '',
        styleBoardPrompt: this.state.styleBoardPrompt,
        assetPromptNotes: this.state.assetPromptNotes,
        moduleAssetSpecs: this.getModuleAssetSpecs(),
        iconSlotCount: this.getIconSlotCount(),
      }, PREVIEW_BG_REQUEST_TIMEOUT_MS)
      const json = await this.parseGenerateAssetsResponse(resp, `背景图 ${screenKind}`)
      if (json.success && json.assets) {
        const stillValid = cacheKey === this.componentVisualRequestKey()
        if (!stillValid) return

        // ── 背景图注入 ───────────────────────────────────────
        if (json.assets.backgrounds[screenKind]) {
          this.previewBg[screenKind] = json.assets.backgrounds[screenKind]
          if (this.panels) {
            const scene = this.panels.center.querySelector('.uid-preview-scene')
            if (scene) {
              let bgEl = scene.querySelector<HTMLImageElement>('img.screen-bg-img')
              if (!bgEl) {
                bgEl = document.createElement('img')
                bgEl.className = 'screen-bg-img'
                bgEl.alt = ''
                bgEl.setAttribute('aria-hidden', 'true')
                scene.insertBefore(bgEl, scene.firstChild)
              }
              bgEl.src = this.previewBg[screenKind]
              scene.querySelector('.uid-preview-bg-hint')?.remove()
            }
          }
        }

        // ── UI 素材写入（仅非组件库生成流程；避免背景请求灌回旧 chrome）────────────────
        if (!this.skipLiveAssetHydration && !this.loadComponentLibraryRunning) {
          let changed = false
          if (!this.liveAssets.buttonNormal  && json.assets.buttonNormal)  { this.liveAssets.buttonNormal  = json.assets.buttonNormal;  changed = true }
          if (!this.liveAssets.buttonPrimary && json.assets.buttonPrimary) { this.liveAssets.buttonPrimary = json.assets.buttonPrimary; changed = true }
          if (!this.liveAssets.titleDeco     && json.assets.titleDeco)     { this.liveAssets.titleDeco     = json.assets.titleDeco;     changed = true }
          if (!this.liveAssets.panelTexture  && json.assets.panelTexture)  { this.liveAssets.panelTexture  = json.assets.panelTexture;  changed = true }
          if (Array.isArray(json.assets.icons)) {
            this.liveAssets.icons = json.assets.icons
            changed = true
          }
          if (changed) this.injectLiveAssets()
        }
      }
    } catch {
      // 静默失败，不影响交互
    } finally {
      this.bgLoading.delete(screenKind)
    }
  }

  private collectPrototypeAssets(): GeneratedAssets {
    return {
      backgrounds: { ...this.previewBg },
        shopItems: [],
        weapons: [],
        panelTexture: this.liveAssets.panelTexture,
      icons: [...this.liveAssets.icons],
        buttonNormal: this.liveAssets.buttonNormal,
        buttonPrimary: this.liveAssets.buttonPrimary,
        titleDeco: this.liveAssets.titleDeco,
      }
  }

  /** 并行预拉各屏背景，单屏超时后跳过，不阻塞原型组装 */
  private async prefetchPrototypeBackgrounds(onProgress: (hint: string) => void): Promise<void> {
    const flow = getScreenFlow(this.state.genrePreset)
    const missing = flow.filter(screen => !this.previewBg[screen.kind])
    if (missing.length === 0) return
    let done = 0
    onProgress(`正在准备场景背景 (0/${missing.length})…`)
    await Promise.all(missing.map(async (screen) => {
      await Promise.race([
        this.fetchPreviewBg(screen.kind),
        new Promise<void>(resolve => setTimeout(resolve, PROTOTYPE_BG_PREFETCH_TIMEOUT_MS)),
      ])
      done += 1
      onProgress(`正在准备场景背景 (${done}/${missing.length})…`)
    }))
  }

  private patchPrototypeGeneratingUi(): void {
    if (!this.panels || !this.prototypeGenerating) return
    const root = this.panels.center.querySelector('.uid-proto-loading')
    if (!root) return
    const sub = root.querySelector('.uid-loading-sub')
    if (sub && this.prototypeGenerateHint) sub.textContent = this.prototypeGenerateHint
  }

  private beginPrototypeGeneration(): void {
    const flow = getScreenFlow(this.state.genrePreset)
    this.prototypeGenerating = true
    this.prototypeGenerateError = null
    this.prototypeGenerateHint = flow.length > 0
      ? `正在准备 ${flow.length} 个界面场景，请稍候…`
      : '正在组合已确认的布局和组件素材…'
    this.prototypeHTML = null
    this.workflowGateNotice = null
    this.collapsedWorkflowSections.delete('prototype')
    if (this.state.workflowStep !== 'prototype') {
      this.state = { ...this.state, workflowStep: 'prototype' }
      saveState(this.state)
    }
    this.render()
    this.broadcastState()
  }

  private async generatePrototype(): Promise<void> {
    if (!this.panels || this.prototypeGenerating) return
    // 1) 全链路重生：不要复用已生成的 chrome/liveAssets（包括 hard reload 复用的问题）
    //    - 组件素材：重新拉取/重生
    //    - 背景：后面统一清空后重生
    this.prototypeHTML = null
    this.prototypeGenerateError = null
    this.prototypeGenerateHint = null
    this.previewBg = {}
    this.bgLoading.clear()
    await this.loadComponentLibrary(true)

    // 2) 进入原型组装流程
    this.beginPrototypeGeneration()

    const reportProgress = (hint: string): void => {
      this.prototypeGenerateHint = hint
      this.patchPrototypeGeneratingUi()
      this.broadcastState()
    }

    try {
      await this.prefetchPrototypeBackgrounds(reportProgress)
      reportProgress('正在组装可交互原型页面…')
      const confirmedAssets = this.collectPrototypeAssets()
      this.prototypeHTML = buildPrototypeHTML(this.state, confirmedAssets)
      this.prototypeGenerateError = null
    } catch (err: unknown) {
      this.prototypeGenerateError = err instanceof Error ? err.message : String(err)
      this.prototypeHTML = null
    } finally {
      this.prototypeGenerating = false
      this.prototypeGenerateHint = null
      this.broadcastState()
      this.render()
    }
  }

  private renderPrototypeGeneratingCenter(): string {
    const genreLabel = GENRE_PRESETS.find(g => g.id === this.state.genrePreset)?.label ?? ''
    const hint = this.prototypeGenerateHint ?? '正在组合已确认的布局和组件素材，请稍候…'
    return `
      <div class="uid-loading-shell uid-proto-loading">
        <div class="uid-loading-inner">
          <div class="uid-loading-spinner"></div>
          <div class="uid-loading-title">正在生成「${esc(genreLabel)}」可交互原型</div>
          <div class="uid-loading-sub">${esc(hint)}</div>
          <div class="uid-loading-hint">生成需要 30 秒～2 分钟（多屏背景图较慢）。右侧预览会在完成后自动切换，请勿重复点击。</div>
        </div>
      </div>
    `
  }

  private renderLoading(genreLabel: string, total: number): string {
    return `
      <div class="uid-loading-shell">
        <div class="uid-loading-inner">
          <div class="uid-loading-spinner"></div>
          <div class="uid-loading-title">正在生成「${esc(genreLabel)}」原型素材</div>
          <div class="uid-loading-sub">${total > 0 ? `正在准备 ${total} 张素材，请稍候…` : '正在组合已确认的布局和组件素材，请稍候…'}</div>
          <div class="uid-loading-hint">原型会优先使用你在前面确认过的组件素材。</div>
        </div>
      </div>
    `
  }

  private renderGenerateError(msg: string): string {
    return `
      <div class="uid-loading-shell">
        <div class="uid-loading-inner">
          <div class="uid-loading-title" style="color:#ff8080">生成失败</div>
          <div class="uid-loading-sub">${esc(msg)}</div>
          <button class="uid-proto-back" data-uid-action="back" style="margin-top:16px">← 返回编辑</button>
        </div>
      </div>
    `
  }

  /** 第四步中央：整屏「生成预览中」+ 5 步百分比进度 */
  private renderComponentLibraryLoadingCenter(): string {
    const g = GENRE_PRESETS.find(x => x.id === this.state.genrePreset)?.label ?? ''
    const s = STYLE_PRESETS.find(x => x.id === this.state.style)?.label ?? ''
    const progress = this.componentPreviewProgress
    const steps = this.getComponentLibrarySteps()
    const total = progress?.total ?? steps.length
    const totalUnits = progress?.totalUnits ?? this.getComponentGenerationUnitTotal(steps)
    const completedUnits = progress?.completedUnits ?? 0
    const stepIndex = progress?.stepIndex ?? 0
    const percent = this.displayProgressPercent(progress?.percent ?? 0)
    const currentLabel = progress?.currentLabel ?? steps[0]?.label ?? ''
    const unitDone = Math.min(completedUnits + (this.loadComponentLibraryRunning ? 1 : 0), totalUnits)
    const pulsing = this.loadComponentLibraryRunning ? ' is-pulsing' : ''
    const stepRows = steps.map((step, index) => {
      const state = this.getComponentLibraryStepVisualState(step, index, progress)
      const prefix = state === 'done' ? '&#10003;' : state === 'active' ? '&#9656;' : '&#8226;'
      return `<li class="uid-loading-step uid-loading-step-${state}"><span>${prefix}</span>${esc(step.label)}</li>`
    }).join('')
    return `
      <div class="uid-loading-shell uid-clib-loading">
        <div class="uid-loading-inner uid-loading-inner-progress">
          <div class="uid-loading-head">
            <div class="uid-loading-title">生成预览中</div>
            <div class="uid-loading-percent">${this.formatProgressPercentLabel(progress?.percent ?? 0)}</div>
          </div>
          <div class="uid-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
            <div class="uid-progress-fill${pulsing}" style="width:${percent}%"></div>
          </div>
          <div class="uid-loading-sub">第 ${unitDone}/${totalUnits} 项 · 正在生成：${esc(currentLabel)}</div>
          <div class="uid-loading-sub uid-loading-sub-muted">正在按「${esc(g)} / ${esc(s)}」与第二步已选模块拉取组件素材</div>
          <ul class="uid-loading-steps" aria-label="生成步骤">${stepRows}</ul>
          <div class="uid-loading-hint">${totalUnits} 项全部完成前不会展示组件库，失败后可重试。</div>
        </div>
      </div>
    `
  }

  private renderComponentLibraryErrorCenter(msg: string): string {
    return `
      <div class="uid-loading-shell">
        <div class="uid-loading-inner">
          <div class="uid-loading-title" style="color:#ff8a80">组件库生成失败</div>
          <div class="uid-loading-sub">${esc(msg)}</div>
          <button class="uid-proto-back" data-uid-action="retry-component-library" style="margin-top:16px">重试</button>
        </div>
      </div>
    `
  }

  private renderComponentLibraryIdleCenter(): string {
    return `
      <div class="uid-loading-shell">
        <div class="uid-loading-inner">
          <div class="uid-loading-title">等待生成 UI 组件素材</div>
          <div class="uid-loading-sub">请在左侧第 3 步点击「生成 UI 组件素材」。进入步骤、展开微调面板或切换流程不会自动开始生成。</div>
        </div>
      </div>
    `
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  private render(): void {
    if (!this.left || !this.panels) return
    this.left.innerHTML = this.renderLeft()
    this.panels.center.innerHTML = this.renderCenter()
    this.panels.right.innerHTML = ''
    this.panels.right.classList.remove('visible')
    this.panels.center.parentElement?.classList.remove('has-right')
    this.bind()
    this.focusPendingField()
    // 异步拉取当前屏幕背景（已有缓存则立即跳过）
    if (!this.prototypeHTML) {
      // 组件素材由 loadComponentLibrary 或局部重生拉取，避免 fetchPreviewBg 全量任务重复打 MCP
      if (this.state.workflowStep === 'style') {
        void this.fetchPreviewBg(this.activeScreen)
      }
      // 如果 liveAssets 已有，立即注入（render 后 DOM 刷新了需要重新注入）
      const hasLive = this.liveAssets.panelTexture || this.liveAssets.buttonNormal
        || this.liveAssets.buttonPrimary || this.liveAssets.titleDeco
        || this.liveAssets.icons.some(Boolean)
      if (hasLive) requestAnimationFrame(() => this.injectLiveAssets())
    }
    if (
      this.state.workflowStep === 'component-preview'
      && !this.prototypeHTML
      && !this.componentPreviewLoading
      && !this.loadComponentLibraryRunning
      && !this.componentCoreBackfillRunning
      && this.hasUsableComponentLibrary()
    ) {
      const missing = this.missingCoreAssetKinds()
      if (missing.length > 0) {
        const key = this.coreBackfillAttemptKey(missing)
        const attempts = this.componentCoreBackfillAttempts[key] ?? 0
        if (attempts < this.componentCoreBackfillMaxAttempts) {
          this.componentCoreBackfillAttempts[key] = attempts + 1
          this.componentCoreBackfillRunning = true
          void this.regenerateAssetKinds(missing).finally(() => {
            this.componentCoreBackfillRunning = false
            this.render()
          })
        }
      }
    }
  }

  // ── LEFT PANEL ──────────────────────────────────────────────────────────────
  private workflowSectionClass(step: WorkflowStepId): string {
    const isActive = this.state.workflowStep === step
    const isCollapsed = this.collapsedWorkflowSections.has(step)
    return cls('uid-section', isActive && 'active', isCollapsed && 'collapsed')
  }

  private renderWorkflowSectionHeader(step: WorkflowStepId, index: number, title: string, summary: string): string {
    const isCollapsed = this.collapsedWorkflowSections.has(step)
    return `
      <button class="uid-section-toggle" type="button" data-uid-toggle-section="${step}" aria-expanded="${!isCollapsed}">
        <span class="uid-section-title"><span class="uid-step">${index}</span><span class="uid-section-title-text">${esc(title)}</span></span>
        <span class="uid-section-caret">⌄</span>
      </button>
      <div class="uid-section-summary">${esc(summary)}</div>
    `
  }

  private renderLayoutScreenChecklist(flow: ReturnType<typeof getScreenFlow>): string {
    const activeIndex = Math.max(0, flow.findIndex(screen => screen.kind === this.activeScreen))
    return `
      <div class="uid-layout-flow-panel">
        <div class="uid-layout-flow-head">
          <span>页面流程确认</span>
          <b>${activeIndex + 1}/${flow.length}</b>
        </div>
        <div class="uid-helper-copy">请从第 1 页开始逐页配置模块，每页点击「确认本页」；全部页面确认后才可「确认布局」。</div>
        <div class="uid-layout-screen-list">
          ${flow.map((screen, index) => {
            const modules = getScreenModules(this.state.genrePreset, screen.kind)
            const isActive = screen.kind === this.activeScreen
            const isReviewed = this.layoutReviewedScreens.has(this.layoutScreenKey(screen.kind))
            return `
              <button class="${cls('uid-layout-screen-item', isActive && 'active', isReviewed && 'configured')}"
                      data-uid-screen="${screen.kind}">
                <span class="uid-layout-screen-index">${index + 1}</span>
                <span class="uid-layout-screen-main">
                  <b>${esc(screen.label)}</b>
                  <small>${modules.required.length} 必选 · ${modules.recommended.length} 推荐 · ${modules.optional.length} 可选</small>
                </span>
                <span class="uid-layout-screen-state">${isActive ? '正在配置' : isReviewed ? '已确认' : '待查看'}</span>
              </button>
            `
          }).join('')}
        </div>
      </div>
    `
  }

  private renderLeft(): string {
    const flow = getScreenFlow(this.state.genrePreset)
    const styles = recommendedStyles(this.state.genrePreset)
    const styleLocked = !this.state.layoutApproved
    const prototypeReady = this.canGeneratePrototype()
    const prototypePreparing = this.state.layoutApproved
      && !prototypeReady
      && !this.prototypeGenerating
      && (this.componentPreviewLoading || this.loadComponentLibraryRunning || Boolean(this.componentPreviewProgress) || this.state.workflowStep === 'component-preview')
    const prototypeLocked = !prototypeReady && !this.prototypeGenerating
    const prototypeStatus = this.prototypeGenerating
      ? '生成中'
      : prototypeReady ? '可生成' : prototypePreparing ? '原型准备中' : '未就绪'
    const componentStatus = prototypeReady ? '已确认' : prototypePreparing ? '同步中' : this.hasFullComponentLibrary() ? '已生成，待同步' : '未确认'
    const prototypeGateNotice = !this.state.layoutApproved
      ? '请先在第 2 步确认页面布局。'
      : prototypePreparing
        ? '组件素材已生成，正在同步到原型预览。请稍候，准备完成后按钮会自动点亮。'
        : '请先在第 3 步生成组件素材；素材准备完成后即可生成可交互原型。'
    const currentSet = getScreenModules(this.state.genrePreset, this.activeScreen)
    const currentIds = new Set([
      ...currentSet.required.map(m => m.id),
      ...currentSet.recommended.map(m => m.id),
      ...currentSet.optional.map(m => m.id),
    ])
    const activeLabels = this.state.selectedFeatures
      .filter(id => currentIds.has(id))
      .map(id => FEATURE_MODULES.find(m => m.id === id)?.label ?? id)
      .slice(0, 8)
    const currentGenre = GENRE_PRESETS.find(genre => genre.id === this.state.genrePreset)
    const currentStyle = STYLE_PRESETS.find(style => style.id === this.state.style)
    const currentScreen = flow.find(screen => screen.kind === this.activeScreen)
    const layoutScreensReviewed = this.allLayoutScreensReviewed()
    const currentScreenReviewed = this.layoutReviewedScreens.has(this.layoutScreenKey(this.activeScreen))

    return `
      <div class="uid-shell">
        <div class="uid-header">
          <span class="uid-title">玩家界面工作台</span>
          <button type="button" class="uid-header-clear" data-uid-action="clear-session" title="清除布局确认、历史素材与生成缓存">清除会话</button>
          <span class="uid-header-pill">UI 工坊</span>
        </div>
        <section class="${this.workflowSectionClass('genre')}" data-uid-section="genre">
          ${this.renderWorkflowSectionHeader('genre', 1, '游戏类型', currentGenre ? `${currentGenre.label} · ${currentGenre.tagline}` : '未选择游戏类型')}
          <div class="uid-section-body">
            <details class="uid-dropdown-details">
              <summary>
                <span>${esc(currentGenre?.label ?? '选择游戏类型')}</span>
                <span class="uid-dropdown-details-arrow">⌄</span>
              </summary>
              <div class="uid-dropdown-menu-like">
                ${GENRE_PRESETS.map(genre => `
                  <button class="${cls('uid-dropdown-option-like', this.state.genrePreset === genre.id && 'active')}"
                          data-uid-genre="${genre.id}" title="${esc(genre.summary)}">
                    <span>${esc(genre.label)}</span>
                    <small>${esc(genre.tagline)}</small>
                  </button>
                `).join('')}
              </div>
            </details>
            ${currentGenre ? `<div class="uid-option-detail">${esc(currentGenre.summary)}</div>` : ''}
            <div class="uid-helper-copy">先定游戏类型，下面的页面流、模块优先级和整套风格组件都会跟着重算。</div>
          </div>
        </section>

        <section class="${this.workflowSectionClass('layout')}" data-uid-section="layout">
          ${this.renderWorkflowSectionHeader('layout', 2, '页面布局', `${currentScreen?.label ?? this.activeScreen} · ${this.state.layoutApproved ? '已确认' : '待确认'}`)}
          <div class="uid-section-body">
            ${this.workflowGateNotice ? `<div class="uid-gate-notice">${esc(this.workflowGateNotice)}</div>` : ''}
            ${this.renderLayoutScreenChecklist(flow)}
            <div class="uid-layout-modules-split">
              <div class="uid-layout-modules-pick">
                <div class="uid-screen-modules">${this.renderScreenModules()}</div>
              </div>
              <div class="uid-layout-modules-enabled">
                <div class="uid-module-live-heading">本屏已启用模块：</div>
                <div class="uid-module-live-panel">
                  <div class="uid-module-live-chips">
                    ${activeLabels.length > 0
                      ? activeLabels.map(label => `<span class="uid-module-live-chip">${esc(label)}</span>`).join('')
                      : '<span class="uid-module-live-empty">暂无（点选左侧推荐/可选模块）</span>'}
                  </div>
                </div>
              </div>
            </div>
            <div class="uid-layout-actions">
              <button class="uid-scene-regen uid-layout-reset" data-uid-action="reset-features">重置</button>
              <button class="uid-next-btn uid-layout-screen-confirm" data-uid-action="confirm-layout-screen"
                      ${this.state.layoutApproved || currentScreenReviewed ? 'disabled' : ''}>${currentScreenReviewed ? '本页已确认' : '确认本页'}</button>
              <button class="uid-next-btn uid-layout-confirm" data-uid-action="confirm-layout"
                      ${this.state.layoutApproved || !layoutScreensReviewed ? 'disabled' : ''}>${this.state.layoutApproved ? '布局已确认' : '确认布局'}</button>
            </div>
          </div>
        </section>

        <section class="${cls(this.workflowSectionClass('style'), styleLocked && 'uid-section-disabled')}" data-uid-section="style">
          ${this.renderWorkflowSectionHeader('style', 3, '风格选择', `${currentStyle?.label ?? this.state.style}${styles.length > 0 ? ' · AI推荐' : ''}`)}
          <div class="uid-section-body">
            ${styleLocked ? '<div class="uid-gate-notice">请先完成前两步：选择游戏类型，并在第 2 步确认布局后才能选择风格和生成组件。</div>' : ''}
            ${styles.length > 0 ? `
              <div class="uid-recommend-strip">
                ${styles.map(s => `
                  <button class="${cls('uid-chip uid-chip-sm', this.state.style === s.id && 'active')}"
                          data-uid-style="${s.id}" title="${esc(s.reason)}" ${styleLocked ? 'disabled' : ''}>
                    <span>${esc(s.label)}</span>
                    <small>${esc(s.reason)}</small>
                  </button>
                `).join('')}
              </div>
            ` : ''}
            <details class="uid-details">
              <summary>全部风格（${STYLE_PRESETS.length}种）</summary>
              <div class="uid-grid uid-grid-2 uid-mt8">
                ${STYLE_PRESETS.map(style => `
                  <button class="${cls('uid-chip uid-chip-sm', this.state.style === style.id && 'active')}"
                          data-uid-style="${style.id}" ${styleLocked ? 'disabled' : ''}>
                    <span>${esc(style.label)}</span>
                    <small>${esc(style.tone)}</small>
                  </button>
                `).join('')}
              </div>
            </details>
            <div class="uid-section-subtitle">风格元素提示词（可选）</div>
            <div class="uid-helper-copy">这里只描述视觉元素，例如材质、边框、发光、纹理、图标气质。它会影响本步组件素材生图，但不会改变第 2 步确认过的布局框架。</div>
            <div class="uid-scene-suggestions">
              ${[
                STYLE_PRESETS.find(style => style.id === this.state.style)?.tone ?? '',
                '按钮更厚重，边框更清晰',
                '标题条更有装饰性，图标统一亮度',
                '面板减少噪点，保留材质纹理',
                '整体更高对比，适合最终游戏 UI',
              ].filter(Boolean).map(s => `
                <button class="uid-scene-tag" data-uid-style-note="${esc(s)}" ${styleLocked ? 'disabled' : ''}>${esc(s)}</button>
              `).join('')}
            </div>
            <textarea class="uid-scene-input" rows="3" data-uid-field="assetPromptNotes"
              placeholder="例如：金属描边、低饱和蓝色发光、按钮更厚重、icon 统一为写实雕刻感；只改视觉样式，不改模块位置和大框架。" ${styleLocked ? 'disabled' : ''}>${esc(this.state.assetPromptNotes)}</textarea>
            <div class="uid-inline uid-inline-wrap uid-action-row">
              <button class="${cls('uid-next-btn', styleLocked && 'uid-action-disabled')}" data-uid-action="generate-component-preview"
                      ${styleLocked ? 'aria-disabled="true" data-uid-disabled="true"' : ''}>${this.hasFullComponentLibrary() ? '重新生成' : '生成 UI 组件素材'}</button>
            </div>
          </div>
        </section>

        <section class="${this.workflowSectionClass('component-preview')}" data-uid-section="component-preview">
          ${this.renderWorkflowSectionHeader('component-preview', 4, '素材微调', this.hasFullComponentLibrary() ? '已有组件素材' : '可选步骤')}
          <div class="uid-section-body">
            <div class="uid-helper-copy">这里仅在需要调整素材时使用；修改提示词后重生组件，中央会保留同一套组件预览。</div>
            <div class="uid-section-subtitle">风格提示词</div>
            <textarea class="uid-scene-input uid-long-input" rows="4" data-uid-field="styleBoardPrompt">${esc(this.state.styleBoardPrompt)}</textarea>
            <div class="uid-section-subtitle">组件样式追加微调</div>
            <div class="uid-helper-copy">这里会沿用第 3 步填写的风格元素提示词；继续修改会触发下一次组件重生的视觉调整，不改变布局结构。</div>
            <textarea class="uid-scene-input" rows="3" data-uid-field="assetPromptNotes" placeholder="例如：按钮更厚重、标题装饰更克制、icon 更写实并统一亮度、通知卡减少描边……">${esc(this.state.assetPromptNotes)}</textarea>
            <div class="uid-inline uid-inline-wrap uid-action-row">
              <button class="uid-scene-regen" data-uid-action="regen-style-board">按微调提示词重新生成</button>
              <button class="uid-next-btn" data-uid-action="open-asset-history">历史记录</button>
            </div>
          </div>
        </section>

        <section class="${this.workflowSectionClass('prototype')}" data-uid-section="prototype">
          ${this.renderWorkflowSectionHeader('prototype', 5, '生成可交互原型', prototypeStatus)}
          <div class="uid-section-body">
            ${prototypeLocked ? `<div class="uid-gate-notice">${esc(prototypeGateNotice)}</div>` : ''}
            <div class="uid-summary-card">
              <div><b>布局确认：</b>${this.state.layoutApproved ? '已确认' : '未确认'}</div>
              <div><b>组件素材：</b>${componentStatus}</div>
              <div><b>当前风格：</b>${esc(STYLE_PRESETS.find(item => item.id === this.state.style)?.label ?? this.state.style)}</div>
            </div>
            <div class="uid-generate-bar">
              <button class="uid-generate-btn${this.prototypeGenerating ? ' is-generating' : ''}" data-uid-action="generate" ${prototypeLocked || this.prototypeGenerating ? 'disabled' : ''}>
                <span class="uid-generate-icon">${this.prototypeGenerating ? '⏳' : '▶'}</span>
                ${this.prototypeGenerating ? '正在生成可交互原型…' : '生成可交互原型'}
              </button>
            </div>
          </div>
        </section>
      </div>
    `
  }

  /** Render current screen's module priority table */
  private renderScreenModules(): string {
    const { required, recommended, optional } = getScreenModules(
      this.state.genrePreset,
      this.activeScreen,
    )
    if (required.length + recommended.length + optional.length === 0) {
      return '<div class="uid-empty">该屏幕暂无模块规则。</div>'
    }

    const row = (label: string, modules: typeof required, variant: string) => {
      if (modules.length === 0) return ''
      const chips = modules.map(m => {
        const sel = variant === 'required' || this.state.selectedFeatures.includes(m.id)
        return `<button class="${cls('uid-chip uid-chip-sm uid-chip-priority', `uid-chip-${variant}`, sel && 'active', m.isRequired && 'locked')}"
                        data-uid-feature="${m.id}" ${m.isRequired ? 'disabled' : ''} title="${esc(m.label)}">
                  ${esc(m.label)}
                </button>`
      }).join('')
      return `
        <div class="uid-module-row">
          <span class="uid-module-label uid-module-${variant}">${label}</span>
          <div class="uid-module-chips">${chips}</div>
        </div>
      `
    }

    return `
      <div class="uid-module-table">
        ${row('必选', required, 'required')}
        ${row('推荐', recommended, 'recommended')}
        ${row('可选', optional, 'optional')}
      </div>
    `
  }

  private renderPrototype(): string {
    const blob = new Blob([this.prototypeHTML!], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    return `
      <div class="uid-proto-shell">
        <div class="uid-proto-bar">
          <button class="uid-proto-back" data-uid-action="back">← 返回编辑</button>
          <span class="uid-proto-title">可交互原型 · ${esc(GENRE_PRESETS.find(g => g.id === this.state.genrePreset)?.label ?? '')}</span>
          <a class="uid-proto-open" href="${url}" target="_blank" rel="noopener">↗ 新标签页打开</a>
        </div>
        <iframe class="uid-proto-frame" src="${url}" frameborder="0" allowfullscreen></iframe>
      </div>
    `
  }

  // ── CENTER PANEL ────────────────────────────────────────────────────────────
  private renderCenter(): string {
    if (this.prototypeHTML) return this.renderPrototype()
    if (this.prototypeGenerating) return this.renderPrototypeGeneratingCenter()
    if (this.prototypeGenerateError) {
      return this.renderGenerateError(this.prototypeGenerateError)
    }
    if (this.state.workflowStep === 'genre' || !this.hasStartedLayoutWorkflow()) {
      return this.renderSetupPlaceholderCenter()
    }
    const blueprint = buildBlueprint(this.state)
    if (this.state.workflowStep === 'layout') {
      return this.renderLayoutValidationCenter(blueprint)
    }
    if (!this.loadComponentLibraryRunning && !this.skipLiveAssetHydration && !this.hasFullComponentLibrary()) {
      const hydrated = this.hydrateLiveAssetsFromConfirmedPack()
      if (hydrated && this.hasFullComponentLibrary()) {
        this.componentPreviewLoading = false
        this.componentPreviewProgress = null
        this.componentPreviewError = null
      }
    }
    if (this.loadComponentLibraryRunning || this.componentPreviewLoading) {
      if (this.componentPreviewError) {
        return this.renderComponentLibraryErrorCenter(this.componentPreviewError)
      }
      return this.renderComponentLibraryLoadingCenter()
    }
    if (this.state.workflowStep === 'style' && (this.componentPreviewLoading || this.componentPreviewError || this.hasFullComponentLibrary())) {
      if (this.hasFullComponentLibrary()) {
        return this.renderComponentLibraryOnlyCenter(blueprint, true)
      }
      if (this.componentPreviewError) {
        return this.renderComponentLibraryErrorCenter(this.componentPreviewError)
      }
      return this.renderComponentLibraryLoadingCenter()
    }
    if (this.componentHistoryOpen) {
      return this.renderAssetHistoryCenter()
    }
    if (this.state.workflowStep === 'component-preview') {
      if (this.hasFullComponentLibrary()) {
        return this.renderComponentLibraryOnlyCenter(blueprint)
      }
      if (this.componentPreviewError) {
        return this.renderComponentLibraryErrorCenter(this.componentPreviewError)
      }
      return this.renderComponentLibraryIdleCenter()
    }
    if (this.state.workflowStep === 'prototype' && this.hasFullComponentLibrary() && !this.componentPreviewLoading && !this.componentPreviewError) {
      return this.renderComponentLibraryOnlyCenter(blueprint)
    }
    // 组件素材生成前，右侧始终保持第 2 步的布局验证预览。
    // 这样第 3 步调整风格/提示词时不会掉回一套“预制静态预览”。
    return this.renderLayoutValidationCenter(blueprint)
  }

  private renderSetupPlaceholderCenter(): string {
    return `
      <div class="uid-setup-empty">
        <div class="uid-setup-empty-inner">
          <div class="uid-setup-empty-kicker">UI WORKSHOP</div>
          <div class="uid-setup-empty-title">先在左侧选择游戏类型</div>
          <div class="uid-setup-empty-copy">右侧预览会在进入「页面布局」后生成，并随左侧屏幕流程、必选/推荐/可选模块实时变化。</div>
        </div>
      </div>
    `
  }

  /**
   * 布局预览用模块元数据：规则表里的 ID 必须在预览中有占位；缺失 FEATURE_MODULES 时不静默丢弃。
   */
  private layoutModuleMeta(id: string): {
    id: string
    label: string
    layer: 'permanent-hud' | 'context-hud' | 'active-menu' | 'depth-settings'
    zone: string
  } {
    const m = FEATURE_MODULES.find(x => x.id === id)
    if (m) return { id: m.id, label: m.label, layer: m.layer, zone: m.zone }
    return { id, label: id, layer: 'permanent-hud', zone: '未注册' }
  }

  /** 第二步布局验证：只展示玩家侧 UI 预览，左侧模块点选只控制预览内模块显隐 */
  private renderLayoutValidationCenter(blueprint: ReturnType<typeof buildBlueprint>): string {
    const flow = getScreenFlow(this.state.genrePreset)
    const bgSrc = this.previewBg[this.activeScreen] ?? ''
    const isLoading = this.bgLoading.has(this.activeScreen)
    const bgHint = isLoading
      ? `<div class="uid-preview-bg-hint"><span class="uid-preview-bg-spinner"></span>生成背景中…</div>`
      : !bgSrc
        ? `<div class="uid-preview-bg-hint uid-preview-bg-hint-idle">选风格后自动生成场景背景</div>`
        : ''
    const sceneBody = renderLayoutSceneBody({
      bgSrc: bgSrc || undefined,
      markup: this.renderPreviewMarkup(blueprint),
      bgHintHtml: bgHint,
    })
    return `
      <div class="uid-preview-shell uid-style-${this.state.style}">
        <div class="uid-preview-topbar">
          <span class="uid-preview-genre">${esc(blueprint.genre.label)}</span>
          <div class="uid-preview-flow-tabs">
            ${flow.map(s => `
              <button class="${cls('uid-preview-tab', s.kind === this.activeScreen && 'active')}"
                      data-uid-screen="${s.kind}">${esc(s.label)}</button>
            `).join('')}
          </div>
          <span class="uid-preview-mode">布局预览</span>
        </div>
        <div class="uid-preview-stage uid-mode-${this.state.previewMode}">
          <div class="uid-preview-scene">${sceneBody}</div>
        </div>
      </div>
    `
  }

  private getLayoutAnchorClass(
    moduleId: string,
    layer: 'permanent-hud' | 'context-hud' | 'active-menu' | 'depth-settings',
    zone: string,
  ): string {
    if (moduleId === 'main-nav') return 'anchor-right-top'
    if (moduleId === 'health-status') return 'anchor-left-bottom'
    if (moduleId === 'minimap') return 'anchor-left-top'
    if (moduleId === 'quest-tracker') return 'anchor-right-top'
    if (moduleId === 'interaction-hints') return 'anchor-bottom-center'
    if (moduleId === 'skill-bar') return 'anchor-bottom-center'
    if (moduleId === 'weapon-hud' || moduleId === 'ammo-counter') return 'anchor-right-bottom'
    if (moduleId === 'reticle') return 'anchor-center'
    if (moduleId === 'currency' || moduleId === 'resource-tracker' || moduleId === 'score-display' || moduleId === 'level-counter') return 'anchor-top-center'
    if (moduleId === 'dialog-box') return 'anchor-bottom-wide'
    if (moduleId === 'pause-menu' || moduleId === 'settings-panel' || moduleId === 'modal-dialog') return 'anchor-center-wide'
    if (moduleId === 'inventory-grid' || moduleId === 'shop-panel' || moduleId === 'character-panel' || moduleId === 'item-detail' || moduleId === 'crafting-panel' || moduleId === 'reward-summary' || moduleId === 'level-select' || moduleId === 'weapon-select') return 'anchor-right-mid'
    if (zone.includes('左上')) return 'anchor-left-top'
    if (zone.includes('右上')) return 'anchor-right-top'
    if (zone.includes('左下')) return 'anchor-left-bottom'
    if (zone.includes('右下')) return 'anchor-right-bottom'
    if (zone.includes('顶部')) return 'anchor-top-center'
    if (zone.includes('底部')) return 'anchor-bottom-center'
    if (zone.includes('中心') || zone.includes('中央')) return 'anchor-center'
    if (layer === 'depth-settings') return 'anchor-center-wide'
    if (layer === 'active-menu') return 'anchor-right-mid'
    if (layer === 'context-hud') return 'anchor-right-top'
    return 'anchor-left-top'
  }

  /**
   * 第 4/5 步中央：只展陈与 generate-assets 一致的一套 chrome（无整屏 upv 假界面、无流程背景 Tab）
   * 使用与 injectLiveAssets 相同的 `.uid-preview-stage` 与 `uid-live-icon-*` 钩子。
   */
  private renderComponentLibraryOnlyCenter(blueprint: ReturnType<typeof buildBlueprint>, showDecisionActions = false): string {
    const styleLabel = STYLE_PRESETS.find(s => s.id === this.state.style)?.label ?? ''
    const missTitle = !this.liveAssets.titleDeco
    const missPrimaryBtn = !this.liveAssets.buttonPrimary
    const missNormalBtn = !this.liveAssets.buttonNormal
    const missingCore = this.missingCoreAssetKinds()
    const missingKey = this.coreBackfillAttemptKey(missingCore)
    const backfillAttempts = this.componentCoreBackfillAttempts[missingKey] ?? 0
    const backfillFailed = missingCore.length > 0
      && !this.componentPreviewLoading
      && !this.loadComponentLibraryRunning
      && !this.componentCoreBackfillRunning
      && backfillAttempts >= this.componentCoreBackfillMaxAttempts
    const missingHint = backfillFailed ? '生成失败，点击重试' : '生成中...'
    const steps = this.getComponentLibrarySteps()
    const stepKinds = new Set(steps.map(step => step.kind))
    const specs = this.getModuleAssetSpecs()
    const iconCount = this.getIconSlotCount()
    const iconSlots = iconSlotDescriptorsFromModuleSpecs(specs)
    const buttonModules = specs
      .filter(spec => spec.assetRoles.includes('button-base') || spec.assetRoles.includes('tab'))
      .map(spec => spec.label)
    const panelModules = specs
      .filter(spec => spec.assetRoles.some(role => role === 'panel' || role === 'card' || role === 'modal-panel' || role === 'list-row' || role === 'bar'))
      .map(spec => spec.label)
    const dynamicSections = resolveStyleBoardSectionsForLayout(this.state.genrePreset, this.state.selectedFeatures)
    const moduleChipRow = (labels: string[]) => labels.length > 0
      ? `<div class="uid-clib-extra-tags uid-clib-linked-modules">${labels.slice(0, 4).map(label => `<span>${esc(label)}</span>`).join('')}</div>`
      : ''
    const dynamicSectionHtml = dynamicSections.map(section => `
      <div class="uid-clib-extra-card uid-clib-viewable" data-uid-section-view="${section.id}" tabindex="0" role="button" aria-label="放大查看${esc(section.label)}">
        <div class="uid-clib-extra-head">
          <span>${esc(section.label)}</span>
          <em>${esc(section.description)}</em>
        </div>
        ${this.renderDynamicSectionPreview(section)}
      </div>
    `).join('')

    return `
      <div class="uid-preview-shell uid-style-${this.state.style}">
        <div class="uid-clib-pure-topbar">
          <span class="uid-clib-pure-meta">${esc(blueprint.genre.label)} · ${esc(styleLabel)}</span>
          <span class="uid-clib-pure-badge">组件物料</span>
        </div>
        <div class="uid-preview-stage uid-style-board-stage uid-clib-mat-only">
          <div class="uid-clib-pure-wrap">
            ${stepKinds.has('titleDeco') ? `
            <div class="uid-clib-pure-sec">
              <div class="uid-clib-pure-label">标题条</div>
              ${moduleChipRow(panelModules)}
              <div class="uid-sb-title-deco uid-clib-chrome-silent uid-clib-viewable ${missTitle ? 'uid-clib-missing' : ''}" role="img" aria-label="标题装饰条素材" data-uid-asset-view="titleDeco" tabindex="0">${missTitle ? `标题条${missingHint}` : ''}</div>
            </div>
            ` : ''}
            ${stepKinds.has('buttonPrimary') || stepKinds.has('buttonNormal') ? `
            <div class="uid-clib-pure-sec">
              <div class="uid-clib-pure-label">主 / 次按钮</div>
              ${moduleChipRow(buttonModules)}
              <div class="uid-sb-button-row">
                ${stepKinds.has('buttonPrimary') ? `<button type="button" class="upv-start-item primary uid-clib-chrome-silent uid-clib-viewable ${missPrimaryBtn ? 'uid-clib-missing' : ''}" aria-label="主按钮底图" data-uid-asset-view="buttonPrimary">${missPrimaryBtn ? `主按钮${missingHint}` : ''}</button>` : ''}
                ${stepKinds.has('buttonNormal') ? `<button type="button" class="upv-start-item uid-clib-chrome-silent uid-clib-viewable ${missNormalBtn ? 'uid-clib-missing' : ''}" aria-label="次按钮底图" data-uid-asset-view="buttonNormal">${missNormalBtn ? `次按钮${missingHint}` : ''}</button>` : ''}
              </div>
              ${backfillFailed ? `<button class="uid-clib-retry-btn" data-uid-action="retry-missing-core">重新生成缺失组件</button>` : ''}
            </div>
            ` : ''}
            ${stepKinds.has('panelTexture') ? `
            <div class="uid-clib-pure-sec">
              <div class="uid-clib-pure-label">面板底纹</div>
              ${moduleChipRow(panelModules)}
              <div class="uid-clib-panel-preview uid-clib-viewable" role="img" aria-label="面板框体纹理" data-uid-asset-view="panelTexture" tabindex="0"></div>
            </div>
            ` : ''}
            ${stepKinds.has('icons') ? `
            <div class="uid-clib-pure-sec uid-clib-icon-sec">
              <div class="uid-clib-pure-label">功能图标（${iconCount} 个）</div>
              <p class="uid-clib-icon-legend">每个图标为独立符号素材；左侧小方框仅作预览底色，右侧为模块名与功能说明，不是游戏内空槽位。</p>
              <div class="uid-clib-icon-chip-list">
                ${iconSlots.map((slot) => `
                  <div class="uid-clib-icon-chip">
                    ${this.renderIconGlyphWell(`uid-live-icon-${slot.slotIndex}`, slot.slotIndex, {
                      size: 'lg',
                      viewable: true,
                      assetView: `icon:${slot.slotIndex}`,
                      ariaLabel: `${slot.label}：${slot.functionTitle}`,
                    })}
                    <div class="uid-clib-icon-chip-copy">
                      <strong class="uid-sb-icon-fn-title">${esc(slot.label)}</strong>
                      <span class="uid-sb-icon-fn-desc">${esc(slot.functionTitle)}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
            ` : ''}
          </div>
          <div class="uid-clib-extra-wrap">
            ${dynamicSectionHtml}
          </div>
        </div>
        ${showDecisionActions ? `
          <div class="uid-clib-decision-bar">
            <button class="uid-next-btn" data-uid-action="confirm-component-assets">确认组件素材</button>
            <button class="uid-scene-regen" data-uid-action="open-component-preview">微调素材</button>
            <button class="uid-scene-regen" data-uid-action="reset-component-assets">重新生成素材</button>
          </div>
        ` : ''}
        ${this.renderComponentAssetLightbox()}
      </div>
    `
  }

  private renderAssetHistoryCenter(): string {
    const history = this.state.assetHistory
    return `
      <div class="uid-preview-shell uid-style-${this.state.style}">
        <div class="uid-clib-pure-topbar">
          <span class="uid-clib-pure-meta">过往生成记录</span>
          <button class="uid-clib-retry-btn" data-uid-action="close-asset-history">返回组件预览</button>
        </div>
        <div class="uid-preview-stage uid-history-stage">
          ${history.length > 0 ? `
            <div class="uid-history-center-grid">
              ${history.map(item => `
                <article class="${cls('uid-history-center-card', item.id === this.state.confirmedStylePackId && 'active')}">
                  ${this.renderHistoryPreviewMarkup(item.preview ?? item.assets)}
                  <div class="uid-history-center-meta">
                    <span>${esc(item.label)}</span>
                    <small>${new Date(item.confirmedAt).toLocaleString('zh-CN')}</small>
                  </div>
                  <div class="uid-history-center-actions">
                    <button class="uid-next-btn" data-uid-open-history-preview="${item.id}">打开预览</button>
                    <button class="uid-history-link danger" data-uid-delete-history="${item.id}">删除</button>
                  </div>
                </article>
              `).join('')}
            </div>
          ` : `
            <div class="uid-history-empty">
              <div class="uid-loading-title">暂无历史记录</div>
              <div class="uid-loading-sub">确认过的组件素材会出现在这里。</div>
            </div>
          `}
        </div>
      </div>
    `
  }

  private renderDynamicSectionPreview(section: StyleBoardSection): string {
    const sectionId = section.id
    const kit: GenreComponentKit = getGenreComponentKit(this.state.genrePreset)
    const kitClass = kit.className
    const specs = this.getModuleAssetSpecs()
    const iconSlotFor = (moduleId: string) => iconSlotIndexForModuleId(specs, moduleId)
    const iconCellClass = (moduleId: string) => {
      const idx = iconSlotFor(moduleId)
      return idx >= 0 ? `uid-live-icon-${idx}` : 'uid-clib-icon-unslotted'
    }
    if (sectionId === 'tabs') {
      return `
        <div class="uid-clib-extra-preview uid-clib-tabs-preview uid-clib-genre-preview ${kitClass}" data-genre-kit="${esc(kit.genre)}">
          <div class="uid-clib-tab-line uid-clib-tab-line-primary">
            ${kit.tabs.primary.map((label, idx) => `
              <button class="upv-bag-tab ${idx === kit.tabs.activeIndex ? 'active' : ''}">${esc(label)}</button>
            `).join('')}
          </div>
          <div class="uid-clib-tab-line uid-clib-filter-line">
            ${kit.tabs.filters.map((label, idx) => `
              <button class="upv-bag-tab ${idx === 0 ? 'active' : ''}">${esc(label)}</button>
            `).join('')}
          </div>
          <div class="uid-clib-segment">
            ${kit.tabs.segment.map((label, idx) => `<span class="${idx === 1 ? 'active' : ''}">${esc(label)}</span>`).join('')}
          </div>
          <div class="uid-clib-pager">
            <button aria-label="上一页">‹</button>
            <button class="active">1</button>
            <button>2</button>
            <button>3</button>
            <button aria-label="下一页">›</button>
            <em>${esc(kit.tabs.pagerLabel)}</em>
          </div>
        </div>
      `
    }
    if (sectionId === 'bars') {
      return `
        <div class="uid-clib-extra-preview uid-clib-bars-preview uid-clib-genre-preview ${kitClass}" data-genre-kit="${esc(kit.genre)}">
          ${kit.bars.map((bar) => `
            <div class="uid-clib-bar-row uid-clib-bar-row-${bar.tone}">
              <span class="uid-clib-bar-label">${esc(bar.label)}<em>${esc(bar.meta)}</em></span>
              <div class="uid-clib-bar"><span style="width:${bar.value}%"></span></div>
            </div>
          `).join('')}
        </div>
      `
    }
    if (sectionId === 'cards') {
      const moduleIds = section.moduleIds ?? []
      const labels = section.items.length > 0 ? section.items : ['主卡片', '副卡片']
      const rows = moduleIds.length > 0
        ? moduleIds.map((moduleId, idx) => ({
            label: labels[idx] ?? moduleId,
            iconClass: iconCellClass(moduleId),
            slotIndex: iconSlotFor(moduleId),
            slotted: iconSlotFor(moduleId) >= 0,
          }))
        : labels.map((label, idx) => ({ label, iconClass: `uid-live-icon-${idx}`, slotIndex: idx, slotted: true }))
      return `
        <div class="uid-clib-extra-preview uid-clib-cards-preview">
          ${rows.map(({ label, iconClass, slotIndex, slotted }) => `
            <div class="uid-clib-card-chip">
              ${this.renderIconGlyphWell(iconClass, slotIndex, { slotted, size: 'sm' })}
              <span class="uid-clib-card-chip-label">${esc(label)}</span>
            </div>
          `).join('')}
        </div>
      `
    }
    if (sectionId === 'lists') {
      const moduleIds = section.moduleIds ?? []
      const listRows = moduleIds.length > 0
        ? moduleIds.map((moduleId, idx) => ({
            label: section.items[idx] ?? moduleId,
            meta: kit.lists[idx]?.meta ?? '',
            status: kit.lists[idx]?.status ?? '',
            iconClass: iconCellClass(moduleId),
            slotIndex: iconSlotFor(moduleId),
            slotted: iconSlotFor(moduleId) >= 0,
          }))
        : kit.lists.map((item, idx) => ({
            label: item.label,
            meta: item.meta,
            status: item.status,
            iconClass: `uid-live-icon-${idx}`,
            slotIndex: idx,
            slotted: true,
          }))
      return `
        <div class="uid-clib-extra-preview uid-clib-lists-preview uid-clib-genre-preview ${kitClass}" data-genre-kit="${esc(kit.genre)}">
          ${listRows.map((item) => `
            <div class="uid-clib-list-row">
              ${this.renderIconGlyphWell(item.iconClass, item.slotIndex, { slotted: item.slotted, size: 'sm' })}
              <span>${esc(item.label)}<small>${esc(item.meta)}</small></span>
              <em>${esc(item.status)}</em>
            </div>
          `).join('')}
        </div>
      `
    }
    if (sectionId === 'notifications') {
      const notice = kit.notifications.notice
      const prompt = kit.notifications.prompt
      const badge = kit.notifications.badge
      const state = kit.notifications.state
      return `
        <div class="uid-clib-extra-preview uid-clib-notify-preview uid-clib-genre-preview ${kitClass}" data-genre-kit="${esc(kit.genre)}">
          <div class="uid-clib-notice banner uid-clib-notice-${notice.tone}">
            <b>${esc(notice.icon)}</b>
            <span>${esc(notice.label)}<small>${esc(notice.meta)}</small></span>
          </div>
          <div class="uid-clib-notice prompt">
            <span>${esc(prompt.label)}</span>
            <button>${esc(prompt.action)}</button>
          </div>
          <div class="uid-clib-notice badge-row">
            <span class="uid-clib-badge-pill">${esc(badge.label)}</span>
            <span class="uid-clib-badge-dot">${esc(badge.count)}</span>
          </div>
          <div class="uid-clib-notice state uid-clib-notice-${state.tone}">
            <span>${esc(state.label)}</span>
            <div class="uid-clib-state-bar"><i style="width:${state.value}%"></i></div>
          </div>
        </div>
      `
    }
    return ''
  }

  private screenLabel(): string {
    const flow = getScreenFlow(this.state.genrePreset)
    return flow.find(s => s.kind === this.activeScreen)?.label ?? this.activeScreen
  }

  private renderPreviewMarkup(blueprint: ReturnType<typeof buildBlueprint>, screenKind = this.activeScreen): string {
    return renderScreenPreviewMarkup(this.state, blueprint, screenKind, {
      includeSupplemental: this.state.workflowStep === 'layout',
      esc,
    })
  }


  // ── Event Binding ───────────────────────────────────────────────────────────
  private bind(): void {
    if (!this.left || !this.panels) return
    const root = this.left
    const sharedRoots = [root, this.panels.center]
    const queryShared = <T extends Element>(selector: string): T[] =>
      sharedRoots.flatMap(node => Array.from(node.querySelectorAll<T>(selector)))

    this.actionBindingAbort?.abort()
    this.actionBindingAbort = new AbortController()
    const captureRestartAction = (event: MouseEvent): void => {
      void this.handleRestartActionClick(event)
    }
    if (!this.documentActionBindingAbort) {
      this.documentActionBindingAbort = new AbortController()
      document.addEventListener('click', captureRestartAction, {
        capture: true,
        signal: this.documentActionBindingAbort.signal,
      })
    }
    sharedRoots.forEach(node => {
      node.addEventListener('click', captureRestartAction, {
        capture: true,
        signal: this.actionBindingAbort?.signal,
      })
    })

    if (this.componentAssetLightbox) {
      document.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          this.stepComponentAssetLightbox(-1)
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          this.stepComponentAssetLightbox(1)
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          this.closeComponentAssetLightbox()
        }
      }, { signal: this.actionBindingAbort?.signal })
    }

    root.querySelectorAll<HTMLElement>('[data-uid-workflow]').forEach(btn => {
      btn.onclick = () => {
        const step = btn.dataset.uidWorkflow as WorkflowStepId
        this.goToStep(step)
      }
    })

    root.querySelectorAll<HTMLElement>('[data-uid-toggle-section]').forEach(btn => {
      btn.onclick = () => {
        const step = btn.dataset.uidToggleSection as WorkflowStepId
        if (this.state.workflowStep !== step) {
          this.collapsedWorkflowSections.delete(step)
          this.goToStep(step)
          return
        }
        const wasCollapsed = this.collapsedWorkflowSections.has(step)
        if (wasCollapsed) {
          this.collapsedWorkflowSections.delete(step)
        } else {
          this.collapsedWorkflowSections.add(step)
        }
        if (wasCollapsed) {
          this.goToStep(step)
          return
        }
        this.render()
      }
    })

    root.querySelectorAll<HTMLElement>('[data-uid-genre]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.uidGenre as GenrePresetId
        this.genreSelectionConfirmed = true
        this.resetGeneratedWorkflowRuntime()
        this.collapsedWorkflowSections.delete('layout')
        this.collapsedWorkflowSections.delete('style')
        this.collapsedWorkflowSections.delete('component-preview')
        this.collapsedWorkflowSections.add('prototype')
        const firstScreen = getScreenFlow(id)[0]?.kind ?? this.activeScreen
        const nextStyle = recommendedStyles(id)[0]?.id ?? this.state.style
        const nextStage = GENRE_PRESETS.find(item => item.id === id)?.suggestedStage ?? this.state.stage
        this.activeScreen = firstScreen
        const next = {
          ...this.state,
          genrePreset: id,
          style: nextStyle,
          stage: nextStage,
          previewMode: STAGE_PRESETS.find(item => item.id === nextStage)?.preview ?? this.state.previewMode,
          sceneDesc: '',
          assetPromptNotes: '',
          layoutApproved: false,
          styleBoardApproved: false,
          confirmedStylePackId: '',
          assetHistory: [],
          lockedAssetKinds: [],
          compareHistoryPackId: '',
          workflowStep: 'layout' as WorkflowStepId,
          styleBoardPrompt: defaultStyleBoardPrompt({
            genrePreset: id,
            style: nextStyle,
            sceneDesc: '',
          }),
        }
        next.selectedFeatures = recommendedFeatures(next)
        this.layoutBaselineMergedScreens.clear()
        this.layoutReviewedScreens.clear()
        next.selectedFeatures = mergeScreenBaselineIntoSelection(id, firstScreen, next.selectedFeatures)
        this.layoutBaselineMergedScreens.add(`${id}::${firstScreen}`)
        this.activeScreen = firstScreen
        this.setState(next)
      }
    })

    queryShared<HTMLElement>('[data-uid-screen]').forEach(btn => {
      btn.onclick = () => {
        const screen = btn.dataset.uidScreen as ScreenKind
        const fromLayoutPanel = Boolean(btn.closest('[data-uid-section="layout"]'))
        this.handleScreenNavigation(screen, fromLayoutPanel)
      }
    })

    root.querySelectorAll<HTMLElement>('[data-uid-screen-dropdown]').forEach(wrap => {
      const trigger = wrap.querySelector<HTMLButtonElement>('[data-uid-screen-trigger]')
      const menu = wrap.querySelector<HTMLElement>('.uid-screen-select-menu')
      if (!trigger || !menu) return
      const closeMenu = () => {
        menu.hidden = true
        trigger.setAttribute('aria-expanded', 'false')
      }
      const openMenu = () => {
        menu.hidden = false
        trigger.setAttribute('aria-expanded', 'true')
      }
      trigger.onclick = (event) => {
        event.stopPropagation()
        if (menu.hidden) openMenu()
        else closeMenu()
      }
      wrap.querySelectorAll<HTMLElement>('.uid-screen-select-item[data-uid-screen]').forEach(item => {
        item.onclick = (event) => {
          event.stopPropagation()
          closeMenu()
          this.handleScreenNavigation(item.dataset.uidScreen as ScreenKind, true)
        }
      })
    })

    root.querySelectorAll<HTMLElement>('[data-uid-stage]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.uidStage as UIDesignState['stage']
        this.setState({
          ...this.state,
          stage: id,
          previewMode: STAGE_PRESETS.find(s => s.id === id)?.preview ?? this.state.previewMode,
        })
      }
    })

    root.querySelectorAll<HTMLElement>('[data-uid-style]').forEach(btn => {
      btn.onclick = () => {
        if (btn.hasAttribute('disabled')) {
          this.workflowGateNotice = '请先完成前两步：选择游戏类型，并在第 2 步确认布局后才能选择风格和生成组件。'
          this.setState({ ...this.state, workflowStep: 'layout' })
          return
        }
        const style = btn.dataset.uidStyle as UIDesignState['style']
        this.setState({
          ...this.state,
          style,
          styleBoardPrompt: defaultStyleBoardPrompt({
            genrePreset: this.state.genrePreset,
            style,
            sceneDesc: '',
          }),
        })
      }
    })

    root.querySelectorAll<HTMLElement>('[data-uid-preview]').forEach(btn => {
      btn.onclick = () => {
        this.setState({
          ...this.state,
          previewMode: (btn.dataset.uidPreview ?? 'hud') as UIDesignState['previewMode'],
        })
      }
    })

    root.querySelectorAll<HTMLElement>('[data-uid-feature]').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.uidFeature
        if (id && !btn.hasAttribute('disabled')) {
          if (!this.hasStartedLayoutWorkflow()) {
            this.genreSelectionConfirmed = true
          }
          this.toggleFeature(id)
          // 点选模块就是在配置页面布局，右侧必须实时重绘当前页面预览。
          this.collapsedWorkflowSections.delete('layout')
          this.setState({ ...this.state, workflowStep: 'layout' })
        }
      }
    })

    queryShared<HTMLElement>('[data-uid-asset-view]').forEach(el => {
      const open = () => {
        const token = el.dataset.uidAssetView ?? ''
        if (!token) return
        this.openComponentAssetLightbox('asset', token)
      }
      el.onclick = (event) => {
        event.stopPropagation()
        open()
      }
      el.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        open()
      }
    })

    queryShared<HTMLElement>('[data-uid-section-view]').forEach(el => {
      const open = () => {
        const token = el.dataset.uidSectionView ?? ''
        if (!token) return
        this.openComponentAssetLightbox('section', token)
      }
      el.onclick = (event) => {
        event.stopPropagation()
        open()
      }
      el.onkeydown = (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        event.stopPropagation()
        open()
      }
    })

    queryShared<HTMLElement>('[data-uid-action]').forEach(btn => {
      btn.onclick = () => {
        if (btn.hasAttribute('disabled')) {
          this.workflowGateNotice = '请先完成前两步：选择游戏类型，并在第 2 步确认布局后才能继续。'
          this.setState({ ...this.state, workflowStep: 'layout' })
          return
        }
        const action = btn.dataset.uidAction
        if (action === 'recommend') this.applyRecommended()
        if (action === 'reset-features') this.resetScreenFeatures()
        if (action === 'reset') this.reset()
        if (action === 'clear-session') this.reset()
        if (action === 'back') {
          this.prototypeHTML = null
          this.prototypeGenerateError = null
          this.broadcastState()
          this.render()
          return
        }
        if (action === 'next-step') this.nextStep()
        if (action === 'confirm-layout-screen') this.confirmCurrentLayoutScreen()
        if (action === 'confirm-layout') this.confirmLayout()
        if (action === 'open-component-preview') {
          this.pendingFocusField = 'assetPromptNotes'
          this.goToStep('component-preview')
        }
        if (action === 'open-asset-history') {
          this.componentHistoryOpen = true
          this.setState({ ...this.state, workflowStep: 'component-preview' })
        }
        if (action === 'close-asset-history') {
          this.componentHistoryOpen = false
          this.render()
          requestAnimationFrame(() => this.injectLiveAssets())
        }
        if (action === 'close-component-asset-view') {
          this.closeComponentAssetLightbox()
        }
        if (action === 'prev-component-asset-view') {
          this.stepComponentAssetLightbox(-1)
        }
        if (action === 'next-component-asset-view') {
          this.stepComponentAssetLightbox(1)
        }
        if (action === 'generate-component-preview') {
          void this.restartComponentGeneration()
        }
        if (action === 'confirm-component-assets') {
          void this.confirmStyleBoard(true)
        }
        if (action === 'reset-component-assets') {
          void this.restartComponentGeneration()
        }
        if (action === 'retry-component-library') {
          this.componentPreviewError = null
          this.componentPreviewProgress = null
          this.render()
          void this.loadComponentLibrary(true)
        }
        if (action === 'retry-missing-core') {
          const missing = this.missingCoreAssetKinds()
          if (missing.length > 0) {
            this.componentCoreBackfillAttempts[this.coreBackfillAttemptKey(missing)] = 0
            this.componentCoreBackfillRunning = true
            this.render()
            void this.regenerateAssetKinds(missing).finally(() => {
              this.componentCoreBackfillRunning = false
              this.render()
            })
          }
        }
        if (action === 'generate') {
          if (this.prototypeGenerating) return
          if (!this.canGeneratePrototype()) {
            this.workflowGateNotice = this.state.layoutApproved
              ? '组件素材已生成后还需要同步到原型预览。请稍候，按钮会在准备完成后自动点亮。'
              : '请先确认页面布局后，再生成可交互原型。'
            this.setState({ ...this.state, workflowStep: this.state.layoutApproved ? 'prototype' : 'layout' })
            return
          }
          void this.generatePrototype()
        }
        if (action === 'regen-bg') {
          // 清除当前屏幕的背景缓存，强制重新生成
          delete this.previewBg[this.activeScreen]
          this.bgLoading.delete(this.activeScreen)
          this.prototypeHTML = null
          this.broadcastState()
          this.render()
        }
        if (action === 'regen-style-board') {
          void this.restartComponentGeneration()
        }
        if (action === 'regen-buttons') {
          this.prototypeHTML = null
          this.broadcastState()
          void this.regenerateAssetKinds(['buttonPrimary', 'buttonNormal', 'titleDeco'])
        }
        if (action === 'regen-icons') {
          this.prototypeHTML = null
          this.broadcastState()
          void this.regenerateAssetKinds(['icons'])
        }
        if (action === 'regen-panel') {
          this.prototypeHTML = null
          this.broadcastState()
          void this.regenerateAssetKinds(['panelTexture'])
        }
        if (action === 'regen-background') {
          delete this.previewBg[this.activeScreen]
          this.bgLoading.delete(this.activeScreen)
          void this.regenerateAssetKinds(['background'])
        }
        if (action === 'confirm-style-board') { void this.confirmStyleBoard(this.state.workflowStep === 'component-preview') }
        if (action === 'open-prototype-step') this.goToStep('prototype')
      }
    })

    queryShared<HTMLTextAreaElement>('[data-uid-field]').forEach(field => {
      field.oninput = () => {
        const key = field.dataset.uidField as 'keywords' | 'notes' | 'styleBoardPrompt' | 'assetPromptNotes'
        clearTimeout((this as any)._fieldTimer)
        const value = field.value
        ;(this as any)._fieldTimer = setTimeout(() => {
          this.state = { ...this.state, [key]: value }
          if (key === 'assetPromptNotes' || key === 'styleBoardPrompt') {
            this.invalidateComponentVisualCache()
          }
          saveState(this.state)
          this.broadcastState()
        }, 400)
      }
    })

    // 风格元素提示词快捷标签：追加到 assetPromptNotes，参与组件生图视觉，不改变布局框架
    root.querySelectorAll<HTMLElement>('[data-uid-style-note]').forEach(tag => {
      tag.onclick = () => {
        const val = tag.dataset.uidStyleNote ?? ''
        const current = this.state.assetPromptNotes.trim()
        const nextNotes = current.includes(val)
          ? current
          : [current, val].filter(Boolean).join('；')
        this.liveAssets = { icons: [] }
        this.componentPreviewError = null
        this.componentPreviewLoading = false
        this.componentPreviewProgress = null
        this.loadComponentLibraryRunning = false
        this.componentLibraryAutoRequestKey = ''
        this.componentCoreBackfillAttempts = {}
        this.componentCoreBackfillRunning = false
        this.setState({
          ...this.state,
          assetPromptNotes: nextNotes,
        })
      }
    })

    queryShared<HTMLElement>('[data-uid-history]').forEach(btn => {
      btn.onclick = () => {
        const packId = btn.dataset.uidHistory
        if (packId) this.applyHistoryPack(packId)
      }
    })

    queryShared<HTMLElement>('[data-uid-open-history-preview]').forEach(btn => {
      btn.onclick = (event) => {
        event.stopPropagation()
        const packId = btn.dataset.uidOpenHistoryPreview
        if (packId) this.openHistoryPreview(packId)
      }
    })

    queryShared<HTMLElement>('[data-uid-lock]').forEach(btn => {
      btn.onclick = () => {
        const kind = btn.dataset.uidLock as AssetKindId
        this.toggleAssetLock(kind)
      }
    })

    queryShared<HTMLElement>('[data-uid-compare]').forEach(btn => {
      btn.onclick = (event) => {
        event.stopPropagation()
        const packId = btn.dataset.uidCompare
        if (packId) this.setComparePack(packId)
      }
    })

    queryShared<HTMLElement>('[data-uid-apply-buttons]').forEach(btn => {
      btn.onclick = (event) => {
        event.stopPropagation()
        const packId = btn.dataset.uidApplyButtons
        if (packId) this.applyHistoryAssetKinds(packId, ['buttonPrimary', 'buttonNormal'])
      }
    })

    queryShared<HTMLElement>('[data-uid-apply-icons]').forEach(btn => {
      btn.onclick = (event) => {
        event.stopPropagation()
        const packId = btn.dataset.uidApplyIcons
        if (packId) this.applyHistoryAssetKinds(packId, ['icons'])
      }
    })

    queryShared<HTMLElement>('[data-uid-apply-title]').forEach(btn => {
      btn.onclick = (event) => {
        event.stopPropagation()
        const packId = btn.dataset.uidApplyTitle
        if (packId) this.applyHistoryAssetKinds(packId, ['titleDeco'])
      }
    })

    queryShared<HTMLElement>('[data-uid-apply-panel]').forEach(btn => {
      btn.onclick = (event) => {
        event.stopPropagation()
        const packId = btn.dataset.uidApplyPanel
        if (packId) this.applyHistoryAssetKinds(packId, ['panelTexture'])
      }
    })

    queryShared<HTMLElement>('[data-uid-delete-history]').forEach(btn => {
      btn.onclick = (event) => {
        event.stopPropagation()
        const packId = btn.dataset.uidDeleteHistory
        if (packId) this.deleteHistoryPack(packId)
      }
    })
  }
}

// ── Prototype Builder ──────────────────────────────────────────────────────────
/** Style palette tokens per StylePresetId */
const STYLE_TOKENS: Record<StylePresetId, { bg: string; panel: string; accent: string; text: string; border: string; font: string }> = {
  'modern-dark':        { bg: '#0d1016', panel: 'rgba(18,24,32,.88)', accent: '#ffb24a', text: '#f2f4f7', border: 'rgba(255,255,255,.1)', font: 'system-ui,sans-serif' },
  'fantasy':            { bg: '#130f18', panel: 'rgba(30,22,28,.9)', accent: '#d7a85b', text: '#efe3c3', border: 'rgba(215,168,91,.2)', font: 'Georgia,serif' },
  'anime':              { bg: '#10121e', panel: 'rgba(20,22,40,.88)', accent: '#6ddcff', text: '#ffffff', border: 'rgba(109,220,255,.18)', font: 'system-ui,sans-serif' },
  'sci-fi':             { bg: '#070d14', panel: 'rgba(8,18,28,.9)', accent: '#4fd6ff', text: '#d5f6ff', border: 'rgba(79,214,255,.2)', font: '"Courier New",monospace' },
  'pixel':              { bg: '#141414', panel: 'rgba(20,20,20,.92)', accent: '#83ff6a', text: '#f6e7b7', border: 'rgba(131,255,106,.2)', font: '"Courier New",monospace' },
  'cute-cartoon':       { bg: '#fff5f9', panel: 'rgba(255,230,240,.9)', accent: '#ff6baa', text: '#4a2040', border: 'rgba(255,107,170,.25)', font: 'system-ui,sans-serif' },
  'fresh-pastoral':     { bg: '#f4f9f0', panel: 'rgba(220,240,210,.9)', accent: '#4a9e3f', text: '#2a3d24', border: 'rgba(74,158,63,.22)', font: 'Georgia,serif' },
  'realistic-military': { bg: '#141a10', panel: 'rgba(28,38,22,.9)', accent: '#c8a84b', text: '#c8c8b0', border: 'rgba(200,168,75,.2)', font: '"Courier New",monospace' },
  'modern-minimal':     { bg: '#f5f5f5', panel: 'rgba(255,255,255,.92)', accent: '#3d3dff', text: '#111111', border: 'rgba(0,0,0,.1)', font: 'system-ui,sans-serif' },
}

function buildPrototypeHTML(state: UIDesignState, assets: GeneratedAssets): string {
  const flow = getScreenFlow(state.genrePreset)
  const tok = STYLE_TOKENS[state.style as StylePresetId] ?? STYLE_TOKENS['modern-dark']
  const blueprint = buildBlueprint(state)
  const genre = blueprint.genre

  const btnP = assets.buttonPrimary
  const btnN = assets.buttonNormal
  const titleD = assets.titleDeco
  const pTex = assets.panelTexture
  const styleBtnPri = btnP
    ? `background-image:url('${btnP}');background-size:100% 100%;background-color:transparent !important;border-color:transparent !important;color:#fff!important;text-shadow:0 2px 6px rgba(0,0,0,.85);`
    : ''
  const styleBtnNorm = btnN
    ? `background-image:url('${btnN}');background-size:100% 100%;background-color:transparent !important;border-color:transparent !important;color:#fff!important;text-shadow:0 2px 5px rgba(0,0,0,.78);`
    : ''
  const styleTitleStrip = titleD
    ? `min-height:58px;background-image:url('${titleD}');background-size:100% 100%;background-repeat:no-repeat;background-position:center;display:flex;align-items:center;justify-content:center;padding:6px 24px;box-sizing:border-box;`
    : ''
  const styleSceneBtn = btnP
    ? `background-image:url('${btnP}');background-size:100% 100%;background-color:transparent !important;border:1px solid rgba(255,255,255,.25) !important;color:#fff;`
    : ''
  const skillSlot = (key: string, i: number) => {
    const ic = assets.icons[i]
    const sk = ic
      ? `background-image:url('${ic}');background-size:contain;background-repeat:no-repeat;background-position:center;`
      : ''
    return `<div class="skill-slot${pTex ? ' proto-skin-panel' : ''}" style="position:relative;${sk}"><span style="position:absolute;right:3px;bottom:2px;font-size:9px;opacity:.65;font-weight:700">${key}</span></div>`
  }
  const protoPanelCss = pTex
    ? `.proto-skin-panel{position:relative;background-color:color-mix(in srgb,var(--panel) 78%,var(--bg))!important;background-image:url('${pTex}')!important;background-size:100% 100%!important;background-repeat:no-repeat!important;background-position:center!important;background-blend-mode:soft-light;border-color:transparent!important;overflow:hidden}.proto-skin-panel::after{content:'';position:absolute;inset:0;z-index:0;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(0,0,0,.18));pointer-events:none}.proto-skin-panel > *{position:relative;z-index:1}.dialog-bubble.proto-skin-panel,.panel-screen.proto-skin-panel,.shop-shelf.proto-skin-panel,.shop-bag.proto-skin-panel{background-image:none!important;background-color:color-mix(in srgb,var(--panel) 88%,var(--bg))!important;border:1px solid color-mix(in srgb,var(--accent) 30%,var(--border))!important;box-shadow:0 22px 72px rgba(0,0,0,.36), inset 0 1px 0 rgba(255,255,255,.08)!important}.dialog-bubble.proto-skin-panel::before,.panel-screen.proto-skin-panel::before,.shop-shelf.proto-skin-panel::before,.shop-bag.proto-skin-panel::before{content:'';position:absolute;inset:10px;z-index:0;background-image:url('${pTex}');background-size:100% 100%;background-repeat:no-repeat;background-position:center;opacity:.16;mix-blend-mode:screen;pointer-events:none}.dialog-bubble.proto-skin-panel::after,.panel-screen.proto-skin-panel::after,.shop-shelf.proto-skin-panel::after,.shop-bag.proto-skin-panel::after{background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(0,0,0,.24)),radial-gradient(circle at 20% 0%,color-mix(in srgb,var(--accent) 12%,transparent),transparent 48%)}`
    : ''
  const protoAssetCss = [
    btnN ? `.nav-btn,.panel-nav-item{background-image:url('${btnN}');background-size:100% 100%;background-color:transparent!important;border-color:transparent!important;color:#fff!important;text-shadow:0 1px 4px rgba(0,0,0,.75)}` : '',
    btnP ? `.nav-btn:hover,.panel-nav-item.active{background-image:url('${btnP}');background-size:100% 100%;background-color:transparent!important;border-color:transparent!important;color:#fff!important}` : '',
    titleD ? `.shop-title,.weapon-title,.level-title,.pause-title,.panel-title{min-height:38px;padding:8px 22px;background-image:url('${titleD}');background-size:100% 100%;background-repeat:no-repeat;background-position:center;display:inline-flex;align-items:center;justify-content:center;color:#fff!important;text-shadow:0 2px 8px rgba(0,0,0,.82)}` : '',
  ].join('')
  const protoGenreChromeCss = buildPrototypeChromeCss({
    buttonPrimary: btnP,
    buttonNormal: btnN,
    titleDeco: titleD,
    panelTexture: pTex,
    icons: assets.icons,
  })
  const panelClass = (base: string) => `${base}${pTex ? ' proto-skin-panel' : ''}`
  const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const itemIconSrcs = [
    svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff2bd"/><stop offset="1" stop-color="${tok.accent}"/></linearGradient></defs><path d="M85 10l33 33-13 13-12-12-36 36 10 10-15 15-29-29 15-15 10 10 36-36-12-12z" fill="url(#g)" stroke="#1b2230" stroke-width="6" stroke-linejoin="round"/><path d="M25 91l12 12-15 15-12-12z" fill="#9fb7c7" stroke="#1b2230" stroke-width="5"/></svg>`),
    svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M50 12h28v20l15 18v50c0 11-9 20-20 20H55c-11 0-20-9-20-20V50l15-18z" fill="#dc5a73" stroke="#1b2230" stroke-width="6"/><path d="M43 66h42v32c0 6-5 11-11 11H54c-6 0-11-5-11-11z" fill="#ff87a0"/><path d="M48 12h32v18H48z" fill="#ffd9a6" stroke="#1b2230" stroke-width="5"/></svg>`),
    svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M64 10l44 16v31c0 29-18 50-44 61-26-11-44-32-44-61V26z" fill="#5b88a8" stroke="#1b2230" stroke-width="6" stroke-linejoin="round"/><path d="M64 22l29 11v24c0 20-10 35-29 45z" fill="#8fd0e8"/><path d="M64 22v80" stroke="#1b2230" stroke-width="5" opacity=".35"/></svg>`),
    svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M64 12l36 24 14 31-50 49-50-49 14-31z" fill="${tok.accent}" stroke="#1b2230" stroke-width="6" stroke-linejoin="round"/><path d="M28 36h72L82 66H46z" fill="#fff3bf" opacity=".62"/><path d="M46 66l18 50 18-50" fill="none" stroke="#1b2230" stroke-width="5" opacity=".35"/></svg>`),
    svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M23 92c19-7 32-25 39-51 23 10 36 28 43 55-27 21-55 24-82-4z" fill="#62b36f" stroke="#1b2230" stroke-width="6" stroke-linejoin="round"/><path d="M37 89c20-8 38-20 53-39" fill="none" stroke="#d7ffd2" stroke-width="7" stroke-linecap="round"/><circle cx="78" cy="45" r="10" fill="#ffd76a" stroke="#1b2230" stroke-width="5"/></svg>`),
    svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path d="M48 58a28 28 0 1 1 21 18l-8 8 8 8-10 10-8-8-12 12-17-17z" fill="#f0c36d" stroke="#1b2230" stroke-width="6" stroke-linejoin="round"/><circle cx="73" cy="43" r="11" fill="none" stroke="#1b2230" stroke-width="6"/><path d="M37 89l14 14" stroke="#fff0b5" stroke-width="5" stroke-linecap="round"/></svg>`),
  ]
  const itemIcon = (index: number) => itemIconSrcs[index % itemIconSrcs.length]
  const enabledModulesForScreen = (kind: ScreenKind): Set<string> => {
    const rule = getScreenModules(state.genrePreset, kind)
    const requiredIds = new Set(rule.required.map(m => m.id))
    const allowedIds = new Set([
      ...rule.required.map(m => m.id),
      ...rule.recommended.map(m => m.id),
      ...rule.optional.map(m => m.id),
    ])
    const enabled = new Set<string>(requiredIds)
    state.selectedFeatures.forEach(id => {
      if (allowedIds.has(id)) enabled.add(id)
    })
    return enabled
  }

  /* Build per-screen HTML */
  const screens = flow.map((screen, idx) => {
    const mods = getScreenModules(state.genrePreset, screen.kind)
    const enabled = enabledModulesForScreen(screen.kind)
    const hasModule = (id: string) => enabled.has(id)
    const allMods = [...mods.required, ...mods.recommended, ...mods.optional].filter(m => enabled.has(m.id))
    const modChips = allMods.map(m => `<div class="mod-chip">${m.label}</div>`).join('')

    const nextScreen = flow[idx + 1]
    const prevScreen = flow[idx - 1]

    let body = ''

    const shellDataAttrs = nextScreen ? ` data-next-screen="${nextScreen.kind}"` : ''
    const bgSrc = assets.backgrounds[screen.kind]
    const layoutSpec = getLayoutSpec(state.genrePreset, screen.kind)
    if (layoutSpec) {
      const layoutInner = renderLayoutPreviewFromSpec({
        spec: layoutSpec,
        hasModule,
        esc: (v) => v,
        genreLabel: genre.label,
        playerFantasy: genre.playerFantasy,
        blueprint,
        renderModuleFeedback: () => '',
      })
      if (layoutInner) {
        body = renderLayoutSceneBody({ bgSrc, markup: layoutInner, shellDataAttrs })
      }
    }

    if (!body) {
      const previewMarkup = renderScreenPreviewMarkup(state, blueprint, screen.kind, { esc: (v) => v })
      body = renderLayoutSceneBody({ bgSrc, markup: previewMarkup, shellDataAttrs })
    }

    return `
      <div class="screen" id="screen-${screen.kind}" data-screen="${screen.kind}" style="display:${idx===0?'flex':'none'}">
        <div class="screen-nav">
          ${prevScreen ? `<button class="nav-btn" onclick="go('${prevScreen.kind}')">← ${prevScreen.label}</button>` : '<span></span>'}
          <span class="nav-title">${screen.label}</span>
          ${nextScreen ? `<button class="nav-btn" onclick="go('${nextScreen.kind}')">${nextScreen.label} →</button>` : '<span></span>'}
        </div>
        <div class="screen-body">${body}</div>
        <div class="screen-flow-bar">
          ${flow.map(s => `<button class="flow-dot ${s.kind===screen.kind?'active':''}" onclick="go('${s.kind}')" title="${s.label}"></button>`).join('')}
        </div>
      </div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${genre.label} UI 原型</title>
<style>
${protoPanelCss}
${protoAssetCss}
${protoGenreChromeCss}
${GENRE_LAYOUT_PROTO_CSS}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: ${tok.bg};
  --panel: ${tok.panel};
  --accent: ${tok.accent};
  --text: ${tok.text};
  --border: ${tok.border};
  --font: ${tok.font};
}
html, body { width: 100%; height: 100%; background: var(--bg); color: var(--text); font-family: var(--font); overflow: hidden; }
body.proto-style-fantasy { --ornament: drop-shadow(0 0 10px rgba(215,168,91,.28)); }
body.proto-style-fantasy .proto-skin-panel { border-radius: 16px!important; filter: var(--ornament); }
body.proto-style-anime .proto-skin-panel { border-radius: 18px!important; box-shadow: 0 10px 32px rgba(109,220,255,.14)!important; }
body.proto-style-sci-fi .proto-skin-panel { border-radius: 3px!important; clip-path: polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px); box-shadow: 0 0 18px rgba(79,214,255,.18)!important; }
body.proto-style-pixel .proto-skin-panel { border-radius: 0!important; image-rendering: pixelated; box-shadow: 4px 4px 0 rgba(0,0,0,.38)!important; }
body.proto-style-cute-cartoon .proto-skin-panel { border-radius: 22px!important; box-shadow: 0 8px 0 rgba(74,32,64,.14)!important; }
body.proto-style-cute-cartoon .proto-skin-panel::after,
body.proto-style-fresh-pastoral .proto-skin-panel::after,
body.proto-style-modern-minimal .proto-skin-panel::after { background: linear-gradient(180deg,rgba(255,255,255,.34),rgba(255,255,255,.12)); }
body.proto-style-fresh-pastoral .proto-skin-panel { border-radius: 18px!important; box-shadow: 0 14px 30px rgba(74,158,63,.12)!important; }
body.proto-style-realistic-military .proto-skin-panel { border-radius: 4px!important; filter: contrast(1.08) saturate(.86); box-shadow: inset 0 0 0 1px rgba(200,168,75,.16)!important; }
body.proto-style-modern-minimal .proto-skin-panel { border-radius: 12px!important; box-shadow: 0 8px 24px rgba(0,0,0,.08)!important; }
.screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: stretch; background: var(--bg); }
.screen-body { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.screen-nav { display: flex; align-items: center; justify-content: space-between; min-height: 52px; padding: 10px 22px; background: color-mix(in srgb,var(--panel) 88%,var(--bg)); border-bottom: 1px solid color-mix(in srgb,var(--border) 70%,transparent); flex-shrink: 0; box-shadow: 0 10px 28px rgba(0,0,0,.14); position: relative; z-index: 5; }
.nav-btn { background: color-mix(in srgb,var(--panel) 82%,transparent); border: 1px solid var(--border); color: var(--text); padding: 7px 16px; cursor: pointer; border-radius: 8px; font-family: var(--font); opacity: .86; transition: opacity .15s, transform .15s, border-color .15s; }
.nav-btn:hover { opacity: 1; }
.nav-title { font-size: 13px; font-weight: 900; color: var(--accent); letter-spacing: .12em; text-shadow: 0 1px 8px rgba(0,0,0,.42); }
.screen-flow-bar { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 42px; padding: 10px; background: color-mix(in srgb,var(--panel) 88%,var(--bg)); border-top: 1px solid color-mix(in srgb,var(--border) 70%,transparent); flex-shrink: 0; position: relative; z-index: 5; }
.flow-dot { width: 24px; height: 6px; border-radius: 999px; background: color-mix(in srgb,var(--text) 16%,transparent); border: none; cursor: pointer; transition: background .15s, transform .15s, width .15s; }
.flow-dot.active { width: 38px; background: var(--accent); transform: none; box-shadow: 0 0 16px color-mix(in srgb,var(--accent) 36%,transparent); }
.overlay-content { position: relative; z-index: 1; }
/* Item / weapon images */
.shop-item-img { width: 48px; height: 48px; object-fit: contain; display: block; margin: 0 auto 6px; }
.weapon-img { width: 60px; height: 60px; object-fit: contain; display: block; margin: 0 auto 8px; }

/* Hero / Start */
.screen-hero { display: flex; align-items: center; justify-content: center; height: 100%; padding: 56px; text-align: center; }
.hero-card { width: min(680px, 86vw); min-height: 360px; padding: 46px 54px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background: color-mix(in srgb,var(--panel) 82%,var(--bg)); border: 1px solid color-mix(in srgb,var(--border) 80%,transparent); border-radius: 24px; box-shadow: 0 30px 90px rgba(0,0,0,.28), inset 0 1px 0 rgba(255,255,255,.08); backdrop-filter: blur(14px); }
.hero-card.proto-skin-panel { background-color: color-mix(in srgb,var(--panel) 76%,var(--bg))!important; background-blend-mode: soft-light; }
.hero-card.proto-skin-panel::before { content: ''; position: absolute; inset: 10px; border-radius: inherit; background: radial-gradient(circle at 50% 0%, color-mix(in srgb,var(--accent) 18%,transparent), transparent 42%), linear-gradient(180deg, rgba(0,0,0,.06), rgba(0,0,0,.22)); z-index: 0; pointer-events: none; }
.kicker { font-size: 12px; letter-spacing: .24em; text-transform: uppercase; color: var(--accent); font-weight: 900; text-shadow: 0 1px 10px rgba(0,0,0,.34); }
.proto-title-strip { width: min(440px, 90%); filter: drop-shadow(0 12px 28px rgba(0,0,0,.28)); }
.proto-title-strip .main-title { margin: 0; color: #fff; font-size: clamp(30px, 4vw, 48px); font-weight: 950; line-height: 1.05; letter-spacing: .08em; text-shadow: 0 2px 10px rgba(0,0,0,.92), 0 0 2px rgba(0,0,0,.85); }
.main-title { font-size: clamp(38px, 5vw, 64px); font-weight: 950; line-height: 1; color: var(--text); text-shadow: 0 2px 18px rgba(0,0,0,.32); }
.subtitle { max-width: 540px; line-height: 1.75; opacity: .88; font-size: 16px; background: color-mix(in srgb,var(--bg) 36%,transparent); border: 1px solid color-mix(in srgb,var(--border) 56%,transparent); border-radius: 14px; padding: 12px 18px; }
.hero-mod-row { max-width: 520px; }
.cta-row { display: flex; gap: 14px; margin-top: 10px; justify-content: center; flex-wrap: wrap; }
.cta-btn { min-width: 148px; min-height: 52px; padding: 15px 32px; border: 1px solid color-mix(in srgb,var(--border) 92%,transparent); background: color-mix(in srgb,var(--panel) 88%,transparent); color: var(--text); font-family: var(--font); font-size: 16px; cursor: pointer; border-radius: 10px; transition: all .15s; font-weight: 800; box-shadow: 0 10px 28px rgba(0,0,0,.14); background-size: 100% 100%; background-position: center; background-repeat: no-repeat; }
.cta-btn.primary { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 22%, var(--panel)); color: #fff; font-weight: 900; min-height: 58px; min-width: 180px; font-size: 17px; }
.cta-btn:hover { opacity: .85; transform: translateY(-1px); }
.cta-btn.sm { padding: 9px 18px; font-size: 12px; }
.mod-row { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 4px; }
.mod-chip { padding: 4px 10px; background: var(--panel); border: 1px solid var(--border); border-radius: 20px; font-size: 11px; opacity: .7; }

/* HUD */
.hud-wrap { position: absolute; inset: 0; z-index: 1; }
.hud-tl { position: absolute; top: 16px; left: 16px; }
.hud-tr { position: absolute; top: 16px; right: 16px; }
.hud-bl { position: absolute; bottom: 16px; left: 16px; }
.hud-bc { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); }
.hud-br { position: absolute; bottom: 16px; right: 16px; }
.hud-br-upper { bottom: 78px; }
.hud-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; }
.hud-panel { background: var(--panel); border: 1px solid var(--border); padding: 10px 14px; border-radius: 6px; backdrop-filter: blur(4px); }
.hud-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); margin-bottom: 4px; }
.hud-value { font-size: 14px; font-weight: 600; }
.minimap-panel { width: 120px; height: 120px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; opacity: .6; }
.hp-bar { width: 120px; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; }
.hp-fill { height: 100%; width: 72%; background: #4caf50; }
.skill-panel { display: flex; gap: 8px; }
.skill-slot { width: 64px; height: 64px; border: 1px solid var(--border); background: var(--panel); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 14px; color: var(--accent); border-radius: 6px; cursor: pointer; background-size: contain; background-repeat: no-repeat; background-position: center; }
.skill-slot:hover { border-color: var(--accent); }
.quest-panel { min-width: 160px; }
.res-panel { min-width: 100px; }
.scene-text { max-width: 380px; text-align: center; line-height: 1.6; opacity: .4; padding: 16px; border: 1px solid var(--border); background: color-mix(in srgb, var(--bg) 60%, transparent); border-radius: 6px; }
.scene-btn { padding: 10px 22px; border: 1px solid var(--accent); background: color-mix(in srgb,var(--accent) 14%,transparent); color: var(--accent); cursor: pointer; font-family: var(--font); border-radius: 4px; font-weight: 700; transition: all .15s; }
.scene-btn:hover { background: color-mix(in srgb,var(--accent) 26%,transparent); }

/* Panel screen (bag / character) */
.panel-screen { display: flex; height: 100%; }
.panel-sidebar { width: 180px; background: var(--panel); border-right: 1px solid var(--border); padding: 20px 14px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; }
.panel-title { font-size: 14px; font-weight: 700; color: var(--accent); }
.panel-nav { display: flex; flex-direction: column; gap: 4px; }
.panel-nav-item { padding: 8px 10px; cursor: pointer; border-radius: 4px; font-size: 13px; opacity: .65; transition: all .12s; }
.panel-nav-item:hover, .panel-nav-item.active { opacity: 1; background: color-mix(in srgb,var(--accent) 12%,transparent); color: var(--accent); }
.panel-main { flex: 1; padding: 20px; overflow: auto; }
.panel-grid { display: grid; grid-template-columns: repeat(5,1fr); gap: 8px; }
.inv-cell { aspect-ratio: 1; border: 1px solid var(--border); background: var(--panel); display: flex; align-items: center; justify-content: center; font-size: 22px; border-radius: 4px; cursor: pointer; transition: border-color .12s; }
.inv-cell img { width: 64%; height: 64%; object-fit: contain; display: block; }
.inv-cell.has-item:hover { border-color: var(--accent); }
.panel-detail { width: 180px; background: var(--panel); border-left: 1px solid var(--border); padding: 20px 14px; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; }
.detail-title { font-size: 15px; font-weight: 700; color: var(--accent); }
.detail-stat { font-size: 13px; opacity: .75; }
.craft-block { display: grid; gap: 8px; padding-top: 10px; margin-top: 4px; border-top: 1px solid color-mix(in srgb,var(--border) 70%,transparent); }

/* Dialog */
.dialog-screen { height: 100%; padding: 32px; display: flex; align-items: center; justify-content: center; background: radial-gradient(circle at 50% 10%, color-mix(in srgb,var(--accent) 12%,transparent), transparent 45%), linear-gradient(180deg,var(--bg),color-mix(in srgb,var(--bg) 78%,#000)); }
.dialog-bubble { width: min(900px, 94vw); min-height: 280px; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 24px; display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 24px; align-items: stretch; }
.dialog-content { display: grid; align-content: start; gap: 16px; min-width: 0; }
.dialog-speaker { display: flex; align-items: center; gap: 12px; }
.dialog-portrait { width: 58px; height: 58px; border-radius: 12px; border: 1px solid var(--border); background: color-mix(in srgb,var(--accent) 10%,transparent); display: flex; align-items: center; justify-content: center; overflow: hidden; color: var(--accent); font-size: 12px; font-weight: 800; flex-shrink: 0; }
.dialog-portrait img { width: 76%; height: 76%; object-fit: contain; }
.dialog-name { font-size: 13px; font-weight: 800; color: var(--accent); letter-spacing: .06em; }
.dialog-role { margin-top: 4px; font-size: 11px; opacity: .52; }
.dialog-text { line-height: 1.65; font-size: 17px; font-weight: 650; max-width: 560px; }
.dialog-line { line-height: 1.6; opacity: .72; }
.dialog-choices { display: grid; align-content: center; gap: 10px; min-width: 0; }
.choice-btn { min-height: 44px; padding: 10px 16px; background: none; border: 1px solid var(--border); color: var(--text); cursor: pointer; font-family: var(--font); text-align: center; border-radius: 7px; transition: all .12s; white-space: normal; }
.choice-btn:hover { border-color: var(--accent); background: color-mix(in srgb,var(--accent) 8%,transparent); }
.choice-btn.primary { border-color: var(--accent); color: var(--accent); font-weight: 600; }

/* Shop */
.shop-screen { display: flex; height: 100%; }
.shop-shelf { flex: 1; padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.shop-title { font-size: 14px; font-weight: 700; color: var(--accent); display: flex; align-items: center; gap: 10px; }
.currency { font-size: 13px; font-weight: 600; }
.shop-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; }
.shop-item { background: var(--panel); border: 1px solid var(--border); padding: 14px; border-radius: 6px; cursor: pointer; transition: border-color .12s; }
.shop-item:hover, .shop-item.selected { border-color: var(--accent); }
.shop-item-name { font-size: 13px; font-weight: 600; margin-bottom: 6px; }
.shop-item-price { font-size: 12px; color: var(--accent); }
.shop-bag { width: 200px; background: var(--panel); border-left: 1px solid var(--border); padding: 20px 14px; display: flex; flex-direction: column; gap: 12px; flex-shrink: 0; }
.bag-slots { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; }
.bag-slot { aspect-ratio: 1; border: 1px solid var(--border); border-radius: 4px; background: color-mix(in srgb,var(--bg) 50%,transparent); display: flex; align-items: center; justify-content: center; }
.bag-slot img { width: 68%; height: 68%; object-fit: contain; display: block; }
.bag-slot.filled { background: color-mix(in srgb,var(--accent) 14%,transparent); border-color: var(--accent); }

/* Results */
.results-screen { display: flex; align-items: center; justify-content: center; height: 100%; }
.results-main { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 40px 56px; display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; min-width: 340px; }
.results-kicker { font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: var(--accent); }
.results-grade { font-size: 80px; font-weight: 900; color: var(--accent); line-height: 1; }
.results-sub { opacity: .6; }
.results-stats { display: flex; gap: 28px; margin: 4px 0; }
.rstat { display: flex; flex-direction: column; gap: 4px; align-items: center; }
.rstat span { font-size: 11px; opacity: .55; }
.rstat strong { font-size: 18px; font-weight: 700; }

/* Pause */
.pause-screen { display: flex; align-items: center; justify-content: center; height: 100%; background: color-mix(in srgb,var(--bg) 80%,transparent); backdrop-filter: blur(6px); }
.pause-card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 32px 40px; min-width: 260px; }
.pause-title { font-size: 20px; font-weight: 800; color: var(--accent); margin-bottom: 18px; text-align: center; }
.pause-nav { display: flex; flex-direction: column; gap: 6px; }
.pause-item { padding: 12px 16px; background: none; border: 1px solid var(--border); color: var(--text); font-family: var(--font); font-size: 14px; cursor: pointer; border-radius: 4px; text-align: left; transition: all .12s; }
.pause-item:hover { border-color: var(--accent); color: var(--accent); }

/* Level select */
.level-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 24px; padding: 32px; }
.level-title { font-size: 20px; font-weight: 800; color: var(--accent); }
.level-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 12px; }
.level-node { width: 80px; height: 80px; border-radius: 8px; border: 1px solid var(--border); background: var(--panel); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; font-family: var(--font); color: var(--text); transition: all .12s; }
.level-node.locked { opacity: .35; cursor: not-allowed; }
.level-node.current { border-color: var(--accent); background: color-mix(in srgb,var(--accent) 14%,transparent); }
.level-node:not(.locked):hover { border-color: var(--accent); }
.level-num { font-size: 18px; font-weight: 700; }
.level-stars { font-size: 11px; color: var(--accent); }

/* Weapon select */
.weapon-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 24px; padding: 32px; }
.weapon-title { font-size: 20px; font-weight: 800; color: var(--accent); }
.weapon-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12px; }
.weapon-card { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 18px 14px; cursor: pointer; text-align: center; transition: all .12s; min-width: 110px; }
.weapon-card:hover, .weapon-card.selected { border-color: var(--accent); background: color-mix(in srgb,var(--accent) 12%,transparent); }
.weapon-name { font-size: 14px; font-weight: 700; color: var(--accent); margin-bottom: 4px; }
.weapon-type { font-size: 11px; opacity: .6; }
</style>
</head>
<body class="proto-style-${state.style}">
${screens}
<script>
function go(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.style.display = s.dataset.screen === id ? 'flex' : 'none'
  })
}
// keyboard nav
document.addEventListener('keydown', e => {
  const cur = Array.from(document.querySelectorAll('.screen')).find(s => s.style.display !== 'none')
  if (!cur) return
  const dots = Array.from(cur.querySelectorAll('.flow-dot'))
  const idx = dots.findIndex(d => d.classList.contains('active'))
  if (e.key === 'ArrowRight' && dots[idx+1]) dots[idx+1].click()
  if (e.key === 'ArrowLeft' && dots[idx-1]) dots[idx-1].click()
})
${GENRE_PROTO_WIRE_SCRIPT}
<\/script>
</body>
</html>`
}

// ── CSS ────────────────────────────────────────────────────────────────────────
function injectCSS(): void {
  let style = document.getElementById(CSS_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = CSS_ID
    document.head.appendChild(style)
  }

  style.textContent = `
    /* ── Shell & Header ── */
    .uid-shell { padding: 0 10px 8px; display: grid; gap: 8px; }
    .uid-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 -10px 8px;
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .uid-title { font-size: 15px; font-weight: 700; color: #d4ff48; line-height: normal; }
    .uid-header-clear {
      margin-left: auto;
      padding: 4px 10px;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 999px;
      background: rgba(255,255,255,.04);
      color: rgba(255,255,255,.72);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: border-color .12s ease, color .12s ease, background .12s ease;
    }
    .uid-header-clear:hover {
      border-color: rgba(255,138,128,.45);
      color: #ffb4ae;
      background: rgba(255,90,80,.08);
    }
    .uid-header-pill {
      margin-left: 8px;
      padding: 3px 8px;
      border: 1px solid rgba(212,255,72,.28);
      border-radius: 999px;
      background: rgba(212,255,72,.08);
      color: #d4ff48;
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
    }

    /* ── Section ── */
    .uid-section { display: grid; gap: 10px; padding: 10px; border: 1px solid var(--border); background: rgba(255,255,255,.02); border-radius: 8px; transition: border-color .16s ease, background .16s ease, box-shadow .16s ease; }
    .uid-section.active { border-color: rgba(212,255,72,.28); box-shadow: 0 0 0 1px rgba(212,255,72,.1) inset; background: rgba(212,255,72,.03); }
    .uid-section-toggle {
      appearance: none;
      width: 100%;
      border: 0;
      background: transparent;
      color: inherit;
      padding: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 16px;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }
    .uid-section-toggle:hover .uid-section-title { color: var(--text-primary); }
    .uid-section-toggle:focus-visible { outline: 1px solid rgba(212,255,72,.55); outline-offset: 4px; border-radius: 6px; }
    .uid-section-caret {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      color: rgba(212,255,72,.78);
      font-size: 13px;
      line-height: 1;
      transition: transform .16s ease, color .16s ease;
    }
    .uid-section.collapsed {
      gap: 5px;
      border-color: rgba(255,255,255,.06);
      background: rgba(255,255,255,.012);
    }
    .uid-section.collapsed .uid-section-body { display: none; }
    .uid-section.collapsed .uid-section-caret { transform: rotate(-90deg); color: rgba(242,244,247,.46); }
    .uid-section.collapsed .uid-step { background: rgba(212,255,72,.78); color: #0b120b; }
    .uid-section-body { display: grid; gap: 10px; min-width: 0; }
    .uid-section-disabled { opacity: 1; }
    .uid-section-disabled .uid-chip,
    .uid-section-disabled .uid-scene-tag,
    .uid-section-disabled textarea {
      cursor: not-allowed;
    }
    .uid-section-title {
      min-width: 0;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-secondary);
      letter-spacing: .08em;
      text-transform: uppercase;
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr);
      align-items: center;
      gap: 6px;
      overflow: hidden;
    }
    .uid-section-title-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .uid-section-summary { color: rgba(242,244,247,.48); font-size: 11px; line-height: 1.45; padding-left: 24px; }
    .uid-section:not(.collapsed) .uid-section-summary { color: rgba(212,255,72,.68); }
    .uid-section-subtitle { font-size: 11px; font-weight: 600; color: var(--text-secondary); letter-spacing: .06em; text-transform: uppercase; margin-top: 4px; opacity: .7; }
    .uid-step { display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: var(--accent); color: #000; font-size: 10px; font-weight: 800; flex-shrink: 0; }
    .uid-section:not(.collapsed) .uid-step {
      background: #d4ff48;
      color: #050805;
      box-shadow: 0 0 0 1px rgba(212,255,72,.42), 0 0 10px rgba(212,255,72,.18);
    }
    .uid-ai-label { margin-left: auto; font-size: 10px; padding: 2px 6px; background: rgba(212,255,72,.15); color: #d4ff48; border-radius: 4px; letter-spacing: .04em; }
    .uid-helper-copy { color: var(--text-secondary); line-height: 1.5; font-size: 10px; }
    .uid-gate-notice {
      padding: 8px 10px;
      border: 1px solid rgba(255,188,94,.36);
      border-radius: 8px;
      background: rgba(255,188,94,.08);
      color: #ffd8b0;
      font-size: 12px;
      line-height: 1.45;
    }
    .uid-cta-row { display: flex; gap: 8px; }
    .uid-next-btn {
      min-height: 28px;
      padding: 5px 12px;
      border: 1px solid rgba(212,255,72,.88);
      background: rgba(212,255,72,.16);
      color: #d4ff48;
      border-radius: 6px;
      cursor: pointer;
      font: inherit;
      font-size: 11px;
      line-height: 1.2;
      font-weight: 700;
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.24), 0 0 10px rgba(212,255,72,.10);
      transition: border-color .14s ease, background .14s ease, color .14s ease, box-shadow .14s ease, transform .14s ease;
    }
    .uid-next-btn:hover {
      opacity: 1;
      border-color: #d4ff48;
      background: rgba(212,255,72,.24);
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.34), 0 0 14px rgba(212,255,72,.16);
    }
    .uid-next-btn:disabled,
    .uid-next-btn.uid-action-disabled {
      border-color: rgba(140,148,156,.28);
      background: rgba(120,128,136,.08);
      color: rgba(170,178,186,.42);
      opacity: 1;
      cursor: not-allowed;
      filter: grayscale(1);
      box-shadow: none;
    }
    .uid-summary-card { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: rgba(255,255,255,.02); font-size: 12px; color: var(--text-secondary); }

    /* ── Authoring Board Lists ── */
    .uid-board-list { display: grid; gap: 8px; }
    .uid-board-item { display: grid; gap: 5px; padding: 10px; border: 1px solid var(--border); border-radius: 8px; background: rgba(255,255,255,.02); }
    .uid-board-title { font-size: 12px; font-weight: 700; color: var(--text-primary); }
    .uid-board-lock { margin-left: 8px; display: inline-flex; padding: 2px 6px; border-radius: 999px; font-size: 10px; color: var(--accent); background: var(--accent-dim); border: 1px solid rgba(212,255,72,.2); }
    .uid-board-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
    .uid-board-tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .uid-board-tag { display: inline-flex; padding: 3px 8px; border-radius: 999px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); font-size: 10px; color: rgba(242,244,247,.72); }
    .uid-verify-list { display: grid; gap: 8px; }
    .uid-verify-item { display: grid; gap: 6px; padding: 10px; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; background: rgba(255,255,255,.025); }
    .uid-verify-title { font-size: 11px; font-weight: 700; color: var(--text-primary); }
    .uid-history-list { display: grid; gap: 6px; }
    .uid-history-item { display: grid; gap: 2px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 8px; background: rgba(255,255,255,.02); color: var(--text-primary); text-align: left; cursor: pointer; font: inherit; }
    .uid-history-item small { color: var(--text-secondary); font-size: 10px; }
    .uid-history-item.active { border-color: var(--accent); background: var(--accent-dim); }
    .uid-history-preview { display: grid; gap: 6px; margin-bottom: 4px; }
    .uid-history-title { min-height: 36px; border-radius: 8px; background: rgba(255,255,255,.05); background-size: cover; background-repeat: no-repeat; background-position: center; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,.5); }
    .uid-history-panel { min-height: 44px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); background-size: cover; background-repeat: no-repeat; background-position: center; display: flex; align-items: center; justify-content: center; color: rgba(255,255,255,.72); font-size: 10px; }
    .uid-history-button-row { display: grid; grid-template-columns: 1fr 1fr 64px; gap: 6px; }
    .uid-history-btn { min-height: 32px; border-radius: 7px; background: rgba(255,255,255,.05); background-size: 100% 100%; background-repeat: no-repeat; background-position: center; border: 1px solid rgba(255,255,255,.08); }
    .uid-history-icons { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
    .uid-history-icon { min-height: 28px; border-radius: 7px; background: rgba(255,255,255,.05); background-size: 76% 76%; background-repeat: no-repeat; background-position: center; border: 1px solid rgba(255,255,255,.08); }
    .uid-history-actions { margin-top: 4px; }
    .uid-history-link { font-size: 11px; color: var(--accent); cursor: pointer; }
    button.uid-history-link { border: 0; background: transparent; padding: 0; font: inherit; }
    .uid-history-link.danger { color: #ff8080; }
    .uid-history-stage { overflow: auto; padding: 18px; box-sizing: border-box; }
    .uid-history-center-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; align-content: start; }
    .uid-history-center-card {
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 14px;
      background: rgba(8,12,16,.72);
      box-shadow: 0 14px 36px rgba(0,0,0,.26);
    }
    .uid-history-center-card.active { border-color: rgba(212,255,72,.62); box-shadow: 0 0 0 1px rgba(212,255,72,.18), 0 14px 36px rgba(0,0,0,.28); }
    .uid-history-center-meta { display: grid; gap: 3px; }
    .uid-history-center-meta span { color: rgba(242,244,247,.92); font-size: 13px; font-weight: 700; }
    .uid-history-center-meta small { color: rgba(242,244,247,.46); font-size: 11px; }
    .uid-history-center-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .uid-history-empty { height: 100%; min-height: 320px; display: grid; place-content: center; gap: 8px; text-align: center; }
    .uid-lock-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .uid-lock-chip { padding: 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(255,255,255,.03); color: var(--text-secondary); font: inherit; text-align: left; cursor: pointer; }
    .uid-lock-chip.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }
    .uid-lock-summary { display: flex; flex-wrap: wrap; gap: 6px; }
    .uid-lock-summary-chip { display: inline-flex; align-items: center; padding: 4px 9px; border-radius: 999px; border: 1px solid rgba(212,255,72,.22); background: rgba(212,255,72,.08); color: var(--accent); font-size: 11px; }
    .uid-compare-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .uid-compare-card { padding: 10px; border-radius: 8px; border: 1px solid var(--border); background: rgba(255,255,255,.02); display: grid; gap: 8px; }
    .uid-compare-label { font-size: 11px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: .08em; }
    .uid-long-input { min-height: 112px; }

    /* ── Grid / Inline ── */
    .uid-grid { display: grid; gap: 8px; }
    .uid-grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .uid-inline { display: flex; gap: 6px; }
    .uid-inline-wrap { flex-wrap: wrap; }
    .uid-action-row {
      justify-content: flex-end;
      padding-top: 8px;
      border-top: 1px solid rgba(212,255,72,.18);
    }
    .uid-layout-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
      width: 100%;
      padding-top: 8px;
      border-top: 1px solid rgba(212,255,72,.18);
    }
    .uid-layout-actions .uid-layout-reset { flex: 0 0 auto; margin-top: 0; align-self: center; }
    .uid-layout-actions .uid-layout-confirm {
      flex: 1;
      min-width: 0;
      box-sizing: border-box;
      text-align: center;
      padding: 10px 16px;
      border-radius: 8px;
      border-color: rgba(212,255,72,.95);
      background: rgba(212,255,72,.18);
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.32), 0 0 12px rgba(212,255,72,.14);
    }
    .uid-layout-actions .uid-layout-confirm:hover {
      background: rgba(212,255,72,.24);
      border-color: #d4ff48;
    }
    .uid-layout-confirm-btn {
      border-color: rgba(212,255,72,.95);
      background: rgba(212,255,72,.18);
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.32), 0 0 12px rgba(212,255,72,.14);
    }
    .uid-layout-confirm-btn:hover {
      opacity: 1;
      background: rgba(212,255,72,.24);
      border-color: #d4ff48;
    }
    .uid-mt4 { margin-top: 4px; }
    .uid-mt8 { margin-top: 8px; }
    .uid-empty { color: var(--text-secondary); font-size: 12px; padding: 4px 0; }

    /* ── Chips ── */
    .uid-chip {
      border: 1px solid rgba(242,244,247,.16);
      background: rgba(255,255,255,.055);
      color: rgba(242,244,247,.78);
      padding: 10px 12px;
      text-align: left;
      cursor: pointer;
      display: grid;
      gap: 4px;
      border-radius: 6px;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.025);
      transition: border-color .14s ease, background .14s ease, color .14s ease, box-shadow .14s ease, transform .14s ease;
    }
    .uid-chip small { color: var(--text-secondary); font-size: 11px; line-height: 1.4; }
    .uid-chip:hover:not(:disabled) {
      border-color: rgba(212,255,72,.38);
      background: rgba(212,255,72,.075);
      color: rgba(242,244,247,.95);
    }
    .uid-chip.active {
      border-color: rgba(212,255,72,.88);
      background: rgba(212,255,72,.16);
      color: #d4ff48;
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.28), 0 0 10px rgba(212,255,72,.10);
      font-weight: 700;
    }
    .uid-chip:disabled {
      border-color: rgba(140,148,156,.22);
      background: rgba(120,128,136,.06);
      color: rgba(170,178,186,.38);
      cursor: not-allowed;
      filter: grayscale(1);
      box-shadow: none;
    }
    .uid-chip:disabled small { color: rgba(170,178,186,.3); }
    .uid-chip.active:disabled {
      border-color: rgba(140,148,156,.28);
      background: rgba(120,128,136,.08);
      color: rgba(170,178,186,.45);
    }
    .uid-chip.active small { color: var(--accent); opacity: .72; }
    .uid-chip.locked { opacity: .7; cursor: not-allowed; }
    .uid-chip-sm { padding: 8px 10px; }
    .uid-chip-inline { padding: 6px 10px; }

    /* ── Module priority chips ── */
    .uid-chip-required { border-color: rgba(255,80,80,.4); }
    .uid-chip-required.active { border-color: #ff5050; background: rgba(255,80,80,.12); color: #ff8080; }
    .uid-chip-recommended { border-color: rgba(212,255,72,.3); }
    .uid-chip-recommended.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }
    .uid-chip-optional { border-color: rgba(255,255,255,.1); }
    .uid-module-chips .uid-chip-priority.active.uid-chip-required {
      border-color: rgba(255,128,128,.62);
      background: rgba(255,80,80,.13);
      color: #ff9a9a;
      box-shadow: inset 0 0 0 1px rgba(255,128,128,.20);
    }

    /* ── Screen Flow ── */
    .uid-flow { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
    .uid-flow-node { display: flex; align-items: center; gap: 5px; padding: 5px 10px; border: 1px solid var(--border); border-radius: 20px; background: rgba(255,255,255,.03); cursor: pointer; color: var(--text-secondary); font-size: 12px; transition: all .12s; }
    .uid-flow-node.active { border-color: var(--accent); background: var(--accent-dim); color: var(--accent); }
    .uid-flow-idx { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 50%; background: currentColor; color: #000; font-size: 9px; font-weight: 800; opacity: .85; }
    .uid-flow-label { }
    .uid-flow-arrow { color: var(--text-secondary); opacity: .4; font-size: 12px; }
    .uid-screen-select-wrap { display: block; margin-top: 2px; position: relative; }
    .uid-screen-select-custom { z-index: 4; }
    .uid-screen-select-trigger {
      width: 100%;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 12px;
      border: 1px solid rgba(242,244,247,.14);
      border-radius: 8px;
      background: rgba(255,255,255,.04);
      color: rgba(242,244,247,.9);
      font: inherit;
      font-size: 13px;
      cursor: pointer;
      outline: none;
      text-align: left;
      transition: border-color .12s, background .12s, box-shadow .12s;
    }
    .uid-screen-select-trigger:hover,
    .uid-screen-select-trigger[aria-expanded="true"] {
      border-color: rgba(212,255,72,.35);
      background: rgba(212,255,72,.075);
    }
    .uid-screen-select-trigger:focus-visible {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-dim);
    }
    .uid-screen-select-value { flex: 1; min-width: 0; }
    .uid-screen-select-caret {
      width: 8px;
      height: 8px;
      border-right: 2px solid rgba(242,244,247,.52);
      border-bottom: 2px solid rgba(242,244,247,.52);
      transform: rotate(45deg) translateY(-2px);
      flex-shrink: 0;
      transition: transform .12s, border-color .12s;
    }
    .uid-screen-select-trigger[aria-expanded="true"] .uid-screen-select-caret {
      transform: rotate(225deg) translateY(2px);
      border-color: var(--accent);
    }
    .uid-screen-select-menu {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      margin: 0;
      padding: 4px;
      border: 1px solid rgba(242,244,247,.14);
      border-radius: 8px;
      background: #131510;
      box-shadow: 0 12px 32px rgba(0,0,0,.45);
      max-height: 148px;
      overflow-y: auto;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      gap: 2px;
      color-scheme: dark;
      z-index: 20;
      scrollbar-width: thin;
      scrollbar-color: #3f463a #171a15;
    }
    .uid-screen-select-menu[hidden] { display: none !important; }
    .uid-screen-select-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 10px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: rgba(242,244,247,.56);
      font: inherit;
      font-size: 13px;
      text-align: left;
      cursor: pointer;
      transition: background .1s, color .1s;
    }
    .uid-screen-select-item:hover { background: rgba(212,255,72,.075); color: rgba(242,244,247,.9); }
    .uid-screen-select-item.active { background: rgba(212,255,72,.16); color: #d4ff48; }
    .uid-screen-select-item-idx {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      border-radius: 50%;
      background: rgba(255,255,255,.08);
      color: rgba(242,244,247,.48);
      font-size: 10px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .uid-screen-select-item.active .uid-screen-select-item-idx { background: #d4ff48; color: #0b0c0a; }
    .uid-screen-select-item-label { flex: 1; min-width: 0; }
    .uid-layout-modules-split {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      align-items: start;
      margin-top: 8px;
    }
    .uid-layout-modules-pick,
    .uid-layout-modules-enabled { min-width: 0; }
    .uid-layout-modules-pick .uid-screen-modules { border-top: none; padding-top: 0; }
    .uid-section-layout .uid-layout-modules-pick .uid-module-row {
      display: grid;
      grid-template-columns: max-content minmax(0, 1fr);
      column-gap: 8px;
      align-items: center;
    }
    .uid-section-layout .uid-layout-modules-pick .uid-module-label {
      width: auto;
      min-width: 0;
      margin: 0;
      padding: 0 0 0 12px;
      text-align: left;
      justify-self: start;
    }
    .uid-layout-modules-enabled {
      min-height: 72px;
      align-self: stretch;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .uid-module-live-heading {
      font-size: 10px;
      font-weight: 700;
      color: rgba(242,244,247,.46);
      letter-spacing: .06em;
      text-transform: uppercase;
      line-height: 1.2;
    }
    .uid-module-live-panel {
      flex: 1;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid rgba(242,244,247,.14);
      border-radius: 8px;
      background: rgba(255,255,255,.035);
      min-height: 56px;
    }
    .uid-module-live-chips { display: flex; flex-wrap: wrap; gap: 6px; }
    @media (max-width: 420px) {
      .uid-layout-modules-split { grid-template-columns: 1fr; }
    }
    .uid-dropdown-details {
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 9px;
      background: rgba(0,0,0,.18);
      overflow: hidden;
    }
    .uid-dropdown-details summary {
      list-style: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 38px;
      padding: 0 12px;
      color: rgba(242,244,247,.9);
      cursor: pointer;
      font-size: 13px;
      font-weight: 700;
    }
    .uid-dropdown-details summary::-webkit-details-marker { display: none; }
    .uid-dropdown-details[open] { border-color: rgba(212,255,72,.26); box-shadow: 0 0 0 1px rgba(212,255,72,.08) inset; }
    .uid-dropdown-details[open] .uid-dropdown-details-arrow { transform: rotate(180deg); }
    .uid-dropdown-details-arrow { color: rgba(212,255,72,.78); transition: transform .16s ease; }
    .uid-dropdown-menu-like {
      display: grid;
      gap: 4px;
      padding: 6px;
      border-top: 1px solid rgba(255,255,255,.08);
      background: rgba(7,14,8,.86);
    }
    .uid-dropdown-option-like {
      appearance: none;
      display: grid;
      gap: 2px;
      width: 100%;
      border: 1px solid rgba(242,244,247,.14);
      border-radius: 7px;
      background: rgba(255,255,255,.04);
      color: rgba(242,244,247,.74);
      padding: 8px 9px;
      text-align: left;
      cursor: pointer;
      font: inherit;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.02);
      transition: border-color .14s ease, background .14s ease, color .14s ease, box-shadow .14s ease;
    }
    .uid-dropdown-option-like span { font-size: 12px; font-weight: 700; }
    .uid-dropdown-option-like small { color: rgba(242,244,247,.42); font-size: 10px; line-height: 1.35; }
    .uid-dropdown-option-like:hover { border-color: rgba(212,255,72,.38); background: rgba(212,255,72,.075); color: rgba(242,244,247,.92); }
    .uid-dropdown-option-like.active {
      border-color: rgba(212,255,72,.88);
      background: rgba(212,255,72,.16);
      color: #d4ff48;
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.28), 0 0 10px rgba(212,255,72,.10);
    }
    .uid-option-detail {
      padding: 8px 10px;
      border: 1px solid rgba(212,255,72,.14);
      border-radius: 8px;
      background: rgba(212,255,72,.045);
      color: rgba(223,235,201,.68);
      font-size: 11px;
      line-height: 1.5;
    }
    .uid-layout-flow-panel {
      display: grid;
      gap: 8px;
      padding: 9px;
      border: 1px solid rgba(212,255,72,.16);
      border-radius: 9px;
      background: rgba(0,0,0,.18);
    }
    .uid-layout-flow-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      color: rgba(242,244,247,.86);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .04em;
    }
    .uid-layout-flow-head b { color: #d4ff48; font-size: 11px; }
    .uid-layout-screen-list { display: grid; gap: 5px; }
    .uid-layout-screen-item {
      display: grid;
      grid-template-columns: 20px minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 9px;
      border: 1px solid rgba(242,244,247,.14);
      border-radius: 7px;
      background: rgba(255,255,255,.04);
      color: rgba(242,244,247,.72);
      text-align: left;
      cursor: pointer;
      font: inherit;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.02);
      transition: border-color .14s ease, background .14s ease, color .14s ease, box-shadow .14s ease;
    }
    .uid-layout-screen-index {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      color: rgba(242,244,247,.5);
      font-size: 10px;
      font-weight: 900;
    }
    .uid-layout-screen-item:hover {
      border-color: rgba(212,255,72,.38);
      background: rgba(212,255,72,.075);
      color: rgba(242,244,247,.95);
    }
    .uid-layout-screen-item.active {
      border-color: rgba(212,255,72,.88);
      background: rgba(212,255,72,.16);
      color: #d4ff48;
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.28), 0 0 10px rgba(212,255,72,.10);
    }
    .uid-layout-screen-item.active .uid-layout-screen-index {
      border-color: rgba(212,255,72,.72);
      background: #d4ff48;
      color: #050805;
    }
    .uid-layout-screen-item.configured:not(.active) {
      border-color: rgba(121,255,145,.32);
      background: rgba(121,255,145,.07);
    }
    .uid-layout-screen-item.configured:not(.active) .uid-layout-screen-index {
      border-color: rgba(121,255,145,.32);
      color: #9dffad;
      background: rgba(121,255,145,.08);
    }
    .uid-layout-screen-main { display: grid; gap: 2px; min-width: 0; }
    .uid-layout-screen-main b { font-size: 12px; line-height: 1.25; }
    .uid-layout-screen-main small { color: rgba(242,244,247,.44); font-size: 10px; line-height: 1.35; }
    .uid-layout-screen-state {
      flex-shrink: 0;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.10);
      color: rgba(242,244,247,.48);
      font-size: 10px;
      font-weight: 800;
      white-space: nowrap;
    }
    .uid-layout-screen-item.active .uid-layout-screen-state {
      border-color: rgba(212,255,72,.36);
      color: #d4ff48;
    }
    .uid-layout-screen-item.configured:not(.active) .uid-layout-screen-state {
      border-color: rgba(121,255,145,.28);
      color: #9dffad;
    }

    /* ── Screen Module Table ── */
    .uid-screen-modules { border-top: 1px solid var(--border); padding-top: 8px; }
    .uid-module-table { display: grid; gap: 6px; }
    .uid-module-row { display: flex; align-items: baseline; gap: 8px; }
    .uid-module-label { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; flex-shrink: 0; width: 36px; }
    .uid-module-required { color: #ff8080; }
    .uid-module-recommended { color: var(--accent); }
    .uid-module-optional { color: var(--text-secondary); }
    .uid-module-chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .uid-chip-priority { padding: 4px 8px; font-size: 11px; }
    .uid-module-live { margin-top: 8px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
    .uid-module-live-label { font-size: 10px; color: var(--text-secondary); letter-spacing: .06em; text-transform: uppercase; }
    .uid-module-live-chip {
      font-size: 10px;
      color: #d9ffe3;
      border: 1px solid rgba(121,255,145,.35);
      background: rgba(121,255,145,.1);
      border-radius: 999px;
      padding: 1px 7px;
    }
    .uid-module-live-empty { font-size: 10px; color: rgba(242,244,247,.45); }

    /* ── Recommend Strip ── */
    .uid-recommend-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }

    /* ── Details ── */
    .uid-details { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
    .uid-details summary { padding: 8px 12px; cursor: pointer; font-size: 12px; color: var(--text-secondary); background: rgba(255,255,255,.02); }
    .uid-details summary:hover { background: rgba(255,255,255,.04); }
    .uid-details > div { padding: 8px 12px 12px; }

    /* ── Actions / Buttons ── */
    .uid-actions { display: flex; gap: 8px; }
    .uid-btn {
      min-height: 28px;
      border: 1px solid rgba(242,244,247,.16);
      background: rgba(255,255,255,.055);
      color: rgba(242,244,247,.78);
      padding: 5px 12px;
      cursor: pointer;
      border-radius: 6px;
      font: inherit;
      font-size: 11px;
      font-weight: 700;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.025);
      transition: border-color .14s ease, background .14s ease, color .14s ease, box-shadow .14s ease;
    }
    .uid-btn:hover { border-color: rgba(212,255,72,.38); background: rgba(212,255,72,.075); color: rgba(242,244,247,.95); }
    .uid-btn-primary {
      border-color: rgba(212,255,72,.88);
      color: #d4ff48;
      background: rgba(212,255,72,.16);
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.28), 0 0 10px rgba(212,255,72,.10);
    }
    .uid-btn-primary:hover { border-color: #d4ff48; background: rgba(212,255,72,.24); }

    /* ── Feature Grid ── */
    .uid-feature-grid .uid-chip { min-height: 60px; }

    /* ── Textarea ── */
    .uid-textarea { width: 100%; box-sizing: border-box; resize: vertical; border: 1px solid var(--border); background: rgba(0,0,0,.2); color: var(--text-primary); padding: 10px; border-radius: 6px; font: inherit; }
    .uid-scene-input.uid-input-attention {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(212,255,72,.18), 0 0 28px rgba(212,255,72,.12);
      background: rgba(212,255,72,.055);
    }

    /* ── PC Rules ── */
    .uid-pc-rules { background: rgba(79,214,255,.04); }
    .uid-rules-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 11px; }
    .uid-rules-grid > span:nth-child(odd) { color: var(--text-secondary); }
    .uid-rules-grid > span:nth-child(even) { color: var(--text-primary); font-variant-numeric: tabular-nums; }

    /* ── Preview Shell ── */
    .uid-preview-shell { position: relative; width: 100%; height: 100%; align-self: stretch; flex: 1 1 0; background: linear-gradient(180deg, #0d1016, #06070a); color: #f2f4f7; display: flex; flex-direction: column; overflow: hidden; }
    .uid-setup-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      background: linear-gradient(180deg, #0d1016, #06070a);
      color: #f2f4f7;
    }
    .uid-setup-empty-inner {
      max-width: 360px;
      padding: 28px;
      text-align: center;
      border: 1px solid rgba(212,255,72,.12);
      border-radius: 14px;
      background: rgba(255,255,255,.025);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.018);
    }
    .uid-setup-empty-kicker { margin-bottom: 8px; color: rgba(212,255,72,.66); font-size: 10px; font-weight: 800; letter-spacing: .16em; }
    .uid-setup-empty-title { font-size: 16px; font-weight: 800; color: rgba(242,244,247,.92); }
    .uid-setup-empty-copy { margin-top: 10px; color: rgba(242,244,247,.54); font-size: 12px; line-height: 1.65; }
    .uid-preview-topbar { display: flex; align-items: center; gap: 10px; padding: 8px 16px; border-bottom: 1px solid rgba(255,255,255,.06); background: rgba(0,0,0,.24); flex-wrap: wrap; }
    .uid-preview-genre { font-size: 12px; font-weight: 700; color: var(--uid-accent, #ffb24a); flex-shrink: 0; }
    .uid-preview-flow-tabs { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; flex: 1; }
    .uid-preview-tab { padding: 4px 10px; border: 1px solid rgba(255,255,255,.1); border-radius: 20px; background: transparent; color: rgba(242,244,247,.5); font-size: 11px; cursor: pointer; transition: all .12s; }
    .uid-preview-tab:hover { color: rgba(242,244,247,.85); border-color: rgba(255,255,255,.25); }
    .uid-preview-tab.active { border-color: var(--uid-accent, #ffb24a); background: rgba(255,178,74,.12); color: var(--uid-accent, #ffb24a); font-weight: 600; }
    .uid-preview-mode { flex-shrink: 0; font-size: 10px; letter-spacing: .12em; color: rgba(242,244,247,.3); padding: 2px 6px; border: 1px solid rgba(255,255,255,.08); border-radius: 4px; }
    .uid-preview-stage { flex: 1; background: #090b0e; position: relative; overflow: hidden; margin: 0; border-radius: 0; border: none; --bg: #090b0e; display: flex; flex-direction: column; min-height: 0; }
    .uid-preview-stage > .uid-preview-scene { flex: 1; min-height: 0; }
    .uid-preview-bg-hint { display: flex; align-items: center; gap: 7px; padding: 5px 12px; background: rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.1); border-radius: 20px; font-size: 11px; color: rgba(242,244,247,.5); white-space: nowrap; }
    .uid-preview-bg-hint-idle { opacity: .45; }
    .uid-preview-bg-spinner { width: 12px; height: 12px; border: 2px solid rgba(255,255,255,.15); border-top-color: var(--uid-accent, #ffb24a); border-radius: 50%; animation: uid-spin-preview 0.7s linear infinite; flex-shrink: 0; }
    @keyframes uid-spin-preview { to { transform: rotate(360deg); } }

    /* ── Style Tokens ── */
    .uid-style-modern-dark .uid-preview-stage, .uid-style-modern-dark .uid-preview-topbar { --uid-accent: #ffb24a; --uid-panel: rgba(12,16,22,.82); }
    .uid-style-fantasy .uid-preview-stage, .uid-style-fantasy .uid-preview-topbar { --uid-accent: #d7a85b; --uid-panel: rgba(24,18,24,.84); }
    .uid-style-anime .uid-preview-stage, .uid-style-anime .uid-preview-topbar { --uid-accent: #6ddcff; --uid-panel: rgba(18,20,34,.84); }
    .uid-style-sci-fi .uid-preview-stage, .uid-style-sci-fi .uid-preview-topbar { --uid-accent: #4fd6ff; --uid-panel: rgba(9,16,24,.86); }
    .uid-style-pixel .uid-preview-stage, .uid-style-pixel .uid-preview-topbar { --uid-accent: #83ff6a; --uid-panel: rgba(18,18,18,.88); }
    .uid-style-cute-cartoon .uid-preview-stage, .uid-style-cute-cartoon .uid-preview-topbar { --uid-accent: #ffb7d5; --uid-panel: rgba(255,251,240,.12); }
    .uid-style-fresh-pastoral .uid-preview-stage, .uid-style-fresh-pastoral .uid-preview-topbar { --uid-accent: #8dc26a; --uid-panel: rgba(240,247,236,.10); }
    .uid-style-realistic-military .uid-preview-stage, .uid-style-realistic-military .uid-preview-topbar { --uid-accent: #d4b96b; --uid-panel: rgba(28,34,24,.88); }
    .uid-style-modern-minimal .uid-preview-stage, .uid-style-modern-minimal .uid-preview-topbar { --uid-accent: #6c6cff; --uid-panel: rgba(245,245,245,.06); }
    .uid-board-header { color: rgba(242,244,247,.72); font-size: 12px; }

    /* 第4/5步：纯组件物料展陈 */
    .uid-clib-pure-topbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,.08); background: rgba(6,8,12,.5); }
    .uid-clib-pure-meta { font-size: 12px; color: rgba(242,244,247,.72); }
    .uid-clib-pure-badge { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: rgba(212,255,72,.7); }
    .uid-clib-mat-only {
      min-height: 0;
      flex: 1 1 auto;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: thin;
      scrollbar-color: rgba(212,255,72,.22) transparent;
    }
    .uid-clib-mat-only::-webkit-scrollbar { width: 8px; }
    .uid-clib-mat-only::-webkit-scrollbar-track { background: transparent; }
    .uid-clib-mat-only::-webkit-scrollbar-thumb {
      background: rgba(212,255,72,.18);
      border-radius: 999px;
    }
    .uid-clib-mat-only::-webkit-scrollbar-thumb:hover {
      background: rgba(212,255,72,.32);
    }
    .uid-clib-decision-bar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      flex-wrap: wrap;
      gap: 10px;
      padding: 10px 14px;
      border-top: 1px solid rgba(255,255,255,.08);
      background: rgba(6,8,10,.92);
      flex-shrink: 0;
    }
    .uid-clib-mat-only .upv-start-item { min-width: 112px; padding: 10px 14px; }
    .uid-clib-pure-wrap { max-width: 520px; margin: 0 auto; padding: 20px 18px 28px; display: grid; gap: 20px; box-sizing: border-box; }
    .uid-clib-pure-sec { display: grid; gap: 8px; }
    .uid-clib-pure-label { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: rgba(242,244,247,.38); }
    .uid-clib-viewable {
      cursor: zoom-in;
      transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease;
    }
    .uid-clib-viewable:hover,
    .uid-clib-viewable:focus-visible {
      transform: translateY(-1px);
      box-shadow: 0 0 0 1px rgba(212,255,72,.34), 0 14px 32px rgba(0,0,0,.3);
      outline: none;
    }
    /* 组件库：素材上不要叠假字，仅保留区外小标签与无障碍 aria */
    .uid-clib-chrome-silent { color: transparent !important; text-shadow: none !important; font-size: 0 !important; line-height: 0 !important; }
    .uid-clib-chrome-silent.uid-clib-missing {
      color: rgba(242,244,247,.72) !important;
      font-size: 11px !important;
      line-height: 1.2 !important;
      text-shadow: none !important;
      border: 1px dashed rgba(255,188,94,.55) !important;
      background-image: none !important;
      background-color: rgba(255,188,94,.08) !important;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 6px 10px !important;
    }
    .uid-clib-retry-btn {
      justify-self: start;
      font-size: 11px;
      color: #ffd8b0;
      border: 1px solid rgba(255,188,94,.45);
      background: rgba(255,188,94,.12);
      border-radius: 6px;
      padding: 4px 10px;
      cursor: pointer;
    }
    .uid-sb-title-deco.uid-clib-chrome-silent {
      min-height: 84px;
      aspect-ratio: 3 / 1;
      width: min(100%, 560px);
      margin: 0 auto;
      background-size: contain !important;
      background-repeat: no-repeat !important;
      background-position: center !important;
    }
    .uid-clib-mat-only .uid-clib-chrome-silent.upv-start-item { min-width: 120px; min-height: 42px; padding: 0; }
    /* 面板：整面铺纹理（不用 uid-sb-card 的淡色 ::before，避免只露一条底边） */
    .uid-clib-panel-preview {
      min-height: 152px; width: 100%; border-radius: 10px; border: 1px solid rgba(255,255,255,.1);
      box-sizing: border-box; overflow: hidden;
      background-color: rgba(0,0,0,.2);
      background-image: var(--uid-panel-texture, none);
      background-size: contain; background-position: center; background-repeat: no-repeat;
    }
    .uid-clib-mat-only .uid-clib-extra-card .uid-clib-glyph-well {
      width: 24px;
      height: 24px;
      min-width: 24px;
      max-width: 24px;
    }
    .uid-clib-icon-sec .uid-clib-glyph-well {
      width: 52px;
      height: 52px;
      min-width: 52px;
      max-width: 52px;
      border-radius: 6px;
    }
    .uid-clib-icon-sec .uid-clib-glyph-well .uid-board-icon {
      width: 46px;
      height: 46px;
    }
    .uid-clib-icon-sec .uid-clib-icon-legend {
      margin: 0 0 10px;
      font-size: 11px;
      line-height: 1.45;
      color: rgba(255,255,255,.55);
    }
    .uid-clib-icon-chip-list {
      display: grid;
      gap: 6px;
    }
    .uid-clib-icon-chip {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(0,0,0,.16);
    }
    .uid-clib-icon-chip-copy {
      display: grid;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .uid-clib-icon-chip .uid-sb-icon-fn-title {
      text-align: left;
      font-size: 12px;
    }
    .uid-clib-icon-chip .uid-sb-icon-fn-desc {
      text-align: left;
      font-size: 10px;
      color: rgba(242,244,247,.62);
    }
    .uid-clib-glyph-well {
      width: 28px;
      height: 28px;
      min-width: 28px;
      max-width: 28px;
      margin: 0;
      border-radius: 5px;
      border: 1px solid rgba(255,255,255,.12);
      background-color: rgba(0,0,0,.28);
      background-image:
        linear-gradient(45deg, rgba(255,255,255,.04) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(255,255,255,.04) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(255,255,255,.04) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.04) 75%);
      background-position: 0 0, 0 5px, 5px -5px, -5px 0;
      background-size: 10px 10px;
      display: grid;
      place-items: center;
      overflow: hidden;
      flex-shrink: 0;
      box-sizing: border-box;
    }
    .uid-clib-glyph-well-md { width: 36px; height: 36px; min-width: 36px; max-width: 36px; }
    .uid-clib-glyph-well-sm { width: 28px; height: 28px; min-width: 28px; max-width: 28px; border-radius: 4px; }
    .uid-clib-glyph-well-lg { width: 52px; height: 52px; min-width: 52px; max-width: 52px; border-radius: 6px; }
    .uid-clib-glyph-well .uid-board-icon {
      width: 20px;
      height: 20px;
      border-radius: 0;
      background-size: contain;
      background-position: center;
      background-repeat: no-repeat;
    }
    .uid-clib-glyph-well-sm .uid-board-icon { width: 24px; height: 24px; }
    .uid-clib-glyph-well-md .uid-board-icon { width: 30px; height: 30px; }
    .uid-clib-glyph-well-lg .uid-board-icon { width: 46px; height: 46px; }
    .uid-sb-icon-fn-title {
      font-size: 12px;
      font-weight: 700;
      color: #f2f4f7;
      line-height: 1.3;
    }
    .uid-sb-icon-fn-desc {
      font-size: 10px;
      line-height: 1.4;
      color: rgba(242,244,247,.62);
      display: block;
    }
    .uid-board-icon.uid-clib-icon-missing {
      background-image: none !important;
      opacity: .72;
    }
    .uid-board-icon.uid-clib-icon-missing::after {
      content: '';
      display: block;
      width: 12px;
      height: 12px;
      border-radius: 2px;
      border: 1.5px dashed rgba(255,255,255,.28);
      background: rgba(255,255,255,.04);
    }
    .uid-clib-icon-unslotted {
      opacity: .35;
      border: none;
      border-radius: 0;
      background: transparent !important;
    }
    .uid-asset-lightbox {
      position: absolute;
      inset: 0;
      z-index: 90;
      display: grid;
      place-items: center;
      padding: 24px;
      box-sizing: border-box;
    }
    .uid-asset-lightbox-backdrop {
      position: absolute;
      inset: 0;
      border: 0;
      background: rgba(0,0,0,.72);
      cursor: zoom-out;
    }
    .uid-asset-lightbox-card {
      position: relative;
      z-index: 1;
      width: min(760px, 94%);
      max-height: 88%;
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 12px;
      padding: 14px;
      border-radius: 18px;
      border: 1px solid rgba(255,255,255,.14);
      background: #080b10;
      box-shadow: 0 28px 90px rgba(0,0,0,.58);
    }
    .uid-asset-lightbox-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: rgba(242,244,247,.92);
      font-size: 13px;
      font-weight: 700;
    }
    .uid-asset-lightbox-head-main {
      display: grid;
      gap: 6px;
      min-width: 0;
      flex: 1;
    }
    .uid-asset-lightbox-nav {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .uid-asset-lightbox-arrow,
    .uid-asset-lightbox-side {
      display: grid;
      place-items: center;
      border: 1px solid rgba(255,255,255,.18);
      background: rgba(255,255,255,.06);
      color: rgba(242,244,247,.92);
      cursor: pointer;
      transition: background .16s ease, border-color .16s ease;
    }
    .uid-asset-lightbox-arrow {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      font-size: 20px;
      line-height: 1;
      padding: 0;
    }
    .uid-asset-lightbox-counter {
      min-width: 52px;
      text-align: center;
      font-size: 12px;
      font-weight: 600;
      color: rgba(242,244,247,.68);
    }
    .uid-asset-lightbox-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .uid-asset-lightbox-arrow:hover,
    .uid-asset-lightbox-side:hover {
      background: rgba(255,255,255,.12);
      border-color: rgba(255,255,255,.28);
    }
    .uid-asset-lightbox-canvas {
      position: relative;
      min-height: 260px;
      display: grid;
      place-items: center;
      overflow: auto;
      border-radius: 12px;
      background:
        linear-gradient(45deg, rgba(255,255,255,.035) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(255,255,255,.035) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(255,255,255,.035) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(255,255,255,.035) 75%),
        #030508;
      background-position: 0 0, 0 10px, 10px -10px, -10px 0;
      background-size: 20px 20px;
    }
    .uid-asset-lightbox-html .uid-asset-lightbox-canvas {
      background:
        radial-gradient(circle at 22% 18%, rgba(255,255,255,.05), transparent 24%),
        linear-gradient(180deg, rgba(18,22,30,.96), rgba(8,10,15,.98));
      padding: 18px;
      box-sizing: border-box;
    }
    .uid-asset-lightbox-canvas img {
      max-width: 100%;
      max-height: 70vh;
      object-fit: contain;
      image-rendering: auto;
    }
    .uid-asset-lightbox-side {
      position: absolute;
      top: 50%;
      z-index: 2;
      width: 42px;
      height: 72px;
      margin-top: -36px;
      border-radius: 12px;
      font-size: 28px;
      line-height: 1;
      padding: 0;
      opacity: .82;
    }
    .uid-asset-lightbox-side-prev { left: 10px; }
    .uid-asset-lightbox-side-next { right: 10px; }
    .uid-asset-lightbox-side:hover { opacity: 1; }
    .uid-asset-section-zoom {
      width: min(620px, 100%);
      display: grid;
      gap: 14px;
      padding: 16px;
      box-sizing: border-box;
    }
    .uid-asset-section-zoom .uid-clib-extra-preview {
      margin: 0;
      width: 100%;
    }
    .uid-asset-section-zoom.uid-clib-extra-card {
      width: min(460px, 100%);
      padding: 18px;
      gap: 10px;
      background: rgba(10,14,20,.78);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.04), 0 18px 46px rgba(0,0,0,.28);
    }
    .uid-asset-section-zoom-cards .uid-clib-extra-preview {
      transform: none;
      width: 100%;
      margin: 8px 0 0;
    }
    .uid-clib-cards-preview-zoom {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .uid-clib-zoom-card {
      min-height: 118px;
      border-radius: 16px;
      border: 1px solid rgba(79,214,255,.22);
      background: linear-gradient(180deg, rgba(14,20,28,.94), rgba(7,10,14,.98));
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      gap: 10px;
      padding: 12px;
      box-sizing: border-box;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.06), 0 16px 34px rgba(0,0,0,.28);
      overflow: hidden;
    }
    .uid-clib-zoom-card-kind {
      justify-self: start;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid rgba(79,214,255,.24);
      background: rgba(79,214,255,.08);
      color: rgba(176,232,255,.78);
      font-size: 10px;
      line-height: 1.5;
    }
    .uid-clib-zoom-card-content {
      display: grid;
      grid-template-columns: 72px minmax(0, 1fr);
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .uid-clib-zoom-card-art {
      width: 72px;
      height: 72px;
      border-radius: 14px;
      border: 1px solid rgba(255,255,255,.12);
      background-color: rgba(0,0,0,.28);
      background-repeat: no-repeat;
      background-position: center;
      background-size: 62%;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.04);
    }
    .uid-clib-zoom-card-body {
      display: grid;
      align-content: center;
      gap: 5px;
      min-width: 0;
    }
    .uid-clib-zoom-card-body b { color: rgba(242,244,247,.96); font-size: 15px; }
    .uid-clib-zoom-card-body span { color: rgba(242,244,247,.54); font-size: 12px; line-height: 1.45; }
    .uid-clib-extra-wrap {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
      padding: 0 18px 28px;
      box-sizing: border-box;
    }
    .uid-clib-extra-card {
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 10px;
      background: rgba(10,14,20,.62);
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .uid-clib-extra-head { display: grid; gap: 2px; }
    .uid-clib-extra-head span { font-size: 11px; color: rgba(242,244,247,.92); font-weight: 600; }
    .uid-clib-extra-head em { font-size: 10px; color: rgba(242,244,247,.44); font-style: normal; }
    .uid-clib-extra-tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .uid-clib-extra-tags span {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.04);
      color: rgba(242,244,247,.62);
    }
    .uid-clib-extra-preview { min-height: 58px; display: grid; gap: 8px; align-items: center; }
    .uid-clib-tabs-preview { display: grid; gap: 9px; align-items: center; }
    .uid-clib-tab-line { display: flex; gap: 8px; flex-wrap: wrap; }
    .uid-clib-tabs-preview .upv-bag-tab {
      min-width: 68px;
      min-height: 32px;
      padding: 4px 14px;
      font-size: 9px;
      line-height: 1.15;
      letter-spacing: 0.02em;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: rgba(242,244,247,.72);
    }
    .uid-clib-tabs-preview .upv-bag-tab.active { color: var(--uid-accent, #ffb24a); }
    .uid-clib-segment {
      display: inline-flex;
      width: fit-content;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 999px;
      overflow: hidden;
      background: rgba(255,255,255,.04);
      min-height: 32px;
      align-items: stretch;
    }
    .uid-clib-segment span {
      font-size: 9px;
      line-height: 1.15;
      letter-spacing: 0.02em;
      color: rgba(242,244,247,.66);
      padding: 6px 16px;
      min-width: 52px;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-right: 1px solid rgba(255,255,255,.08);
    }
    .uid-clib-segment span:last-child { border-right: 0; }
    .uid-clib-segment span.active { color: #0f1a26; background: var(--uid-accent, #ffb24a); font-weight: 700; }
    .uid-clib-pager {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }
    .uid-clib-pager button {
      min-width: 28px;
      height: 28px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.05);
      color: rgba(242,244,247,.78);
      font-size: 9px;
      line-height: 1;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .uid-clib-pager button.active {
      border-color: var(--uid-accent, #ffb24a);
      color: var(--uid-accent, #ffb24a);
      background: color-mix(in srgb, var(--uid-accent, #ffb24a) 12%, transparent);
    }
    .uid-clib-pager em {
      margin-left: 6px;
      font-style: normal;
      font-size: 10px;
      color: rgba(242,244,247,.56);
    }
    .uid-clib-bars-preview { display: grid; gap: 6px; }
    .uid-clib-bar-row { display: grid; gap: 4px; }
    .uid-clib-bar-label { font-size: 10px; color: rgba(242,244,247,.66); }
    .uid-clib-bars-preview .uid-clib-bar {
      width: 100%;
      height: 10px;
      border-radius: 999px;
      background: rgba(255,255,255,.12);
      overflow: hidden;
      border: 1px solid rgba(255,255,255,.08);
    }
    .uid-clib-bars-preview .uid-clib-bar > span {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--uid-accent, #ffb24a), color-mix(in srgb, var(--uid-accent, #ffb24a) 60%, #fff));
    }
    .uid-clib-cards-preview { display: grid; grid-template-columns: 1fr; gap: 6px; }
    .uid-clib-card-chip {
      min-height: 36px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.03);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
    }
    .uid-clib-card-chip-label {
      font-size: 11px;
      color: rgba(242,244,247,.86);
      line-height: 1.35;
      flex: 1;
      min-width: 0;
    }
    .uid-clib-card-chip .uid-clib-glyph-well { margin: 0; }
    .uid-clib-mini-card {
      min-height: 68px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,.1);
      background-image: var(--uid-panel-texture, none);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      display: grid;
      place-items: center;
      gap: 4px;
      align-content: center;
    }
    .uid-clib-mini-card .uid-board-icon { width: 26px; height: 26px; }
    .uid-clib-mini-card span { font-size: 10px; color: rgba(242,244,247,.84); }
    .uid-clib-cards-preview .uid-clib-mini-card:nth-child(odd) { box-shadow: inset 0 0 0 1px rgba(121,255,145,.12); }
    .uid-clib-cards-preview .uid-clib-mini-card:nth-child(even) { box-shadow: inset 0 0 0 1px rgba(79,214,255,.12); }
    .uid-clib-lists-preview { display: grid; gap: 6px; }
    .uid-clib-list-row {
      min-height: 30px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.04);
      display: flex;
      align-items: center;
      padding: 4px 8px;
      gap: 8px;
    }
    .uid-clib-list-row .uid-clib-glyph-well { margin: 0; flex-shrink: 0; }
    .uid-clib-list-row .uid-board-icon { width: 24px; height: 24px; flex-shrink: 0; }
    .uid-clib-list-row span {
      font-size: 11px;
      color: rgba(242,244,247,.84);
      letter-spacing: .01em;
    }
    .uid-clib-notify-preview {
      display: grid;
      gap: 6px;
    }
    .uid-clib-notify-preview .uid-clib-notice {
      min-height: 26px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,.12);
      background-image: var(--uid-panel-texture, none);
      background-size: cover;
      opacity: .76;
      display: flex;
      align-items: center;
      padding: 0 10px;
    }
    .uid-clib-notify-preview .uid-clib-notice span {
      font-size: 11px;
      color: rgba(242,244,247,.86);
      font-weight: 600;
    }
    .uid-clib-notify-preview .uid-clib-notice.banner { gap: 8px; }
    .uid-clib-notify-preview .uid-clib-notice.banner b {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: rgba(255,188,94,.2);
      border: 1px solid rgba(255,188,94,.55);
      color: #ffd9ab;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
    }
    .uid-clib-notify-preview .uid-clib-notice.prompt {
      justify-content: space-between;
      gap: 8px;
    }
    .uid-clib-notify-preview .uid-clib-notice.prompt button {
      border: 1px solid rgba(79,214,255,.5);
      background: rgba(79,214,255,.14);
      color: #dff6ff;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 10px;
    }
    .uid-clib-notify-preview .uid-clib-notice.badge-row {
      justify-content: flex-start;
      gap: 8px;
    }
    .uid-clib-badge-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 72px;
      border-radius: 999px;
      border: 1px solid rgba(121,255,145,.45);
      background: rgba(121,255,145,.14);
      padding: 2px 8px;
      font-size: 10px;
      color: #d6ffe3;
    }
    .uid-clib-badge-dot {
      min-width: 18px;
      height: 18px;
      border-radius: 999px;
      border: 1px solid rgba(255,188,94,.5);
      background: rgba(255,188,94,.2);
      color: #ffe0b8;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 700;
    }
    .uid-clib-notify-preview .uid-clib-notice.state {
      border-color: rgba(79,214,255,.45);
      box-shadow: inset 0 0 0 1px rgba(79,214,255,.16);
      justify-content: space-between;
      gap: 8px;
    }
    .uid-clib-state-bar {
      width: 86px;
      height: 7px;
      border-radius: 999px;
      background: rgba(255,255,255,.16);
      overflow: hidden;
    }
    .uid-clib-state-bar i {
      display: block;
      width: 64%;
      height: 100%;
      background: linear-gradient(90deg, #4fd6ff, #9fe9ff);
    }
    .uid-clib-genre-preview {
      --uid-kit-accent: var(--uid-accent, #ffb24a);
      --uid-kit-danger: #ff5d5d;
      --uid-kit-success: #78d879;
      --uid-kit-energy: #ffd166;
      --uid-kit-radius: 8px;
      --uid-kit-border: rgba(255,255,255,.12);
      --uid-kit-surface: rgba(255,255,255,.045);
      --uid-kit-text: rgba(242,244,247,.86);
    }
    .uid-clib-genre-preview .upv-bag-tab,
    .uid-clib-genre-preview .uid-clib-segment,
    .uid-clib-genre-preview .uid-clib-pager button,
    .uid-clib-genre-preview .uid-clib-list-row,
    .uid-clib-genre-preview .uid-clib-notice,
    .uid-clib-genre-preview .uid-clib-bar {
      border-color: var(--uid-kit-border);
      background: var(--uid-kit-surface);
      border-radius: var(--uid-kit-radius);
    }
    .uid-clib-genre-preview .upv-bag-tab.active,
    .uid-clib-genre-preview .uid-clib-pager button.active,
    .uid-clib-genre-preview .uid-clib-segment span.active {
      border-color: color-mix(in srgb, var(--uid-kit-accent) 65%, transparent);
      color: var(--uid-kit-accent);
      background: color-mix(in srgb, var(--uid-kit-accent) 18%, transparent);
    }
    .uid-clib-genre-preview .uid-clib-bar-label {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      text-transform: uppercase;
    }
    .uid-clib-genre-preview .uid-clib-bar-label em,
    .uid-clib-list-row em,
    .uid-clib-list-row small,
    .uid-clib-notice small {
      font-style: normal;
      font-size: 9px;
      color: rgba(242,244,247,.48);
      letter-spacing: .04em;
    }
    .uid-clib-list-row span,
    .uid-clib-notice span {
      display: grid;
      gap: 1px;
      min-width: 0;
    }
    .uid-clib-list-row em {
      margin-left: auto;
      white-space: nowrap;
      color: var(--uid-kit-accent);
    }
    .uid-clib-bar-row-primary .uid-clib-bar > span,
    .uid-clib-notice-primary .uid-clib-state-bar i { background: linear-gradient(90deg, var(--uid-kit-accent), color-mix(in srgb, var(--uid-kit-accent) 45%, #fff)); }
    .uid-clib-bar-row-danger .uid-clib-bar > span,
    .uid-clib-notice-danger .uid-clib-state-bar i { background: linear-gradient(90deg, var(--uid-kit-danger), #ffb09f); }
    .uid-clib-bar-row-success .uid-clib-bar > span,
    .uid-clib-notice-success .uid-clib-state-bar i { background: linear-gradient(90deg, var(--uid-kit-success), #d6ffc2); }
    .uid-clib-bar-row-energy .uid-clib-bar > span,
    .uid-clib-notice-energy .uid-clib-state-bar i { background: linear-gradient(90deg, var(--uid-kit-energy), #fff2ad); }
    .uid-clib-notice-danger.banner b { color: #ffd4ce; background: color-mix(in srgb, var(--uid-kit-danger) 25%, transparent); border-color: color-mix(in srgb, var(--uid-kit-danger) 70%, transparent); }
    .uid-clib-notice-success.banner b { color: #e2ffda; background: color-mix(in srgb, var(--uid-kit-success) 20%, transparent); border-color: color-mix(in srgb, var(--uid-kit-success) 62%, transparent); }
    .uid-clib-notice-energy.banner b { color: #fff5b8; background: color-mix(in srgb, var(--uid-kit-energy) 22%, transparent); border-color: color-mix(in srgb, var(--uid-kit-energy) 66%, transparent); }
    .uid-clib-genre-preview.uid-genre-fps {
      --uid-kit-accent: #ffb34a;
      --uid-kit-danger: #ff4d3f;
      --uid-kit-success: #7dd46a;
      --uid-kit-radius: 2px;
      --uid-kit-border: rgba(255,179,74,.28);
      --uid-kit-surface: linear-gradient(90deg, rgba(255,179,74,.09), rgba(45,55,46,.16));
      gap: 5px;
    }
    .uid-genre-fps .upv-bag-tab,
    .uid-genre-fps .uid-clib-list-row,
    .uid-genre-fps .uid-clib-notice {
      clip-path: polygon(7px 0, 100% 0, calc(100% - 7px) 100%, 0 100%);
      text-transform: uppercase;
    }
    .uid-genre-fps .uid-clib-bar { height: 8px; border-radius: 1px; }
    .uid-genre-fps .uid-clib-list-row { min-height: 24px; }
    .uid-clib-genre-preview.uid-genre-action-rpg {
      --uid-kit-accent: #d9a85f;
      --uid-kit-danger: #d94f63;
      --uid-kit-success: #68d188;
      --uid-kit-radius: 10px;
      --uid-kit-border: rgba(217,168,95,.32);
      --uid-kit-surface: radial-gradient(circle at 20% 0, rgba(217,168,95,.18), rgba(35,24,45,.22));
    }
    .uid-genre-action-rpg .upv-bag-tab.active,
    .uid-genre-action-rpg .uid-clib-badge-pill {
      box-shadow: inset 0 0 0 1px rgba(255,236,178,.18), 0 0 14px rgba(217,168,95,.16);
    }
    .uid-genre-action-rpg .uid-clib-list-row { min-height: 30px; }
    .uid-genre-action-rpg .uid-clib-bar { height: 11px; }
    .uid-clib-genre-preview.uid-genre-puzzle {
      --uid-kit-accent: #ffb7d5;
      --uid-kit-danger: #ff7a7a;
      --uid-kit-success: #76db89;
      --uid-kit-energy: #ffd65a;
      --uid-kit-radius: 999px;
      --uid-kit-border: rgba(255,183,213,.34);
      --uid-kit-surface: linear-gradient(180deg, rgba(255,255,255,.13), rgba(255,183,213,.13));
      gap: 9px;
    }
    .uid-genre-puzzle .uid-clib-tab-line { gap: 8px; }
    .uid-genre-puzzle .upv-bag-tab { min-height: 36px; min-width: 72px; }
    .uid-genre-puzzle .uid-clib-list-row,
    .uid-genre-puzzle .uid-clib-notice { min-height: 32px; padding-inline: 10px; }
    .uid-genre-puzzle .uid-clib-bar { height: 12px; border-radius: 999px; }
    .uid-clib-genre-preview.uid-genre-racing {
      --uid-kit-accent: #52d6ff;
      --uid-kit-danger: #ff5d4f;
      --uid-kit-success: #8cff66;
      --uid-kit-energy: #7bf6ff;
      --uid-kit-radius: 4px;
      --uid-kit-border: rgba(82,214,255,.34);
      --uid-kit-surface: linear-gradient(100deg, rgba(82,214,255,.11), rgba(255,255,255,.035));
      transform: skewX(-4deg);
    }
    .uid-genre-racing > * { transform: skewX(4deg); }
    .uid-genre-racing .uid-clib-bar { height: 9px; }
    .uid-genre-racing .uid-clib-pager button,
    .uid-genre-racing .upv-bag-tab,
    .uid-genre-racing .uid-clib-list-row,
    .uid-genre-racing .uid-clib-notice { border-radius: 3px; }
    .uid-clib-genre-preview.uid-genre-survival {
      --uid-kit-accent: #b7a86a;
      --uid-kit-danger: #d65b45;
      --uid-kit-success: #7ca66a;
      --uid-kit-radius: 3px;
      --uid-kit-border: rgba(183,168,106,.3);
      --uid-kit-surface: linear-gradient(180deg, rgba(183,168,106,.09), rgba(39,34,25,.25));
      filter: saturate(.82);
    }
    .uid-genre-survival .uid-clib-list-row,
    .uid-genre-survival .uid-clib-notice {
      border-style: dashed;
    }
    .uid-clib-genre-preview.uid-genre-mmo {
      --uid-kit-accent: #b8a0ff;
      --uid-kit-danger: #ff6678;
      --uid-kit-success: #70d99c;
      --uid-kit-radius: 7px;
      --uid-kit-border: rgba(184,160,255,.3);
      --uid-kit-surface: linear-gradient(90deg, rgba(184,160,255,.09), rgba(85,112,255,.08));
      gap: 5px;
    }
    .uid-genre-mmo .uid-clib-list-row { min-height: 24px; }
    .uid-genre-mmo .uid-clib-bar { height: 8px; }
    .uid-clib-genre-preview.uid-genre-life-sim {
      --uid-kit-accent: #8dcf89;
      --uid-kit-danger: #e58a74;
      --uid-kit-success: #79c98d;
      --uid-kit-radius: 14px;
      --uid-kit-border: rgba(141,207,137,.28);
      --uid-kit-surface: linear-gradient(180deg, rgba(141,207,137,.12), rgba(255,255,255,.055));
      gap: 9px;
    }
    .uid-genre-life-sim .uid-clib-list-row,
    .uid-genre-life-sim .uid-clib-notice { min-height: 31px; }
    .uid-genre-life-sim .uid-clib-bar { height: 11px; }
    /* ── Step2: 布局框架验证 ── */
    .uid-layout-shell { background: linear-gradient(180deg, rgba(9,12,18,.98), rgba(12,14,20,.98)); }
    .uid-layout-topbar { border-bottom: 1px solid rgba(255,255,255,.08); }
    .uid-layout-stage { height: 100%; padding: 16px; box-sizing: border-box; }
    .uid-layout-canvas {
      height: 100%;
      border: 1px dashed rgba(255,255,255,.16);
      border-radius: 12px;
      background: rgba(4,7,12,.58);
      padding: 14px;
      display: grid;
      gap: 10px;
      align-content: start;
      overflow: auto;
    }
    .uid-layout-title { color: rgba(242,244,247,.9); font-size: 13px; font-weight: 700; letter-spacing: .04em; }
    .uid-layout-summary { color: rgba(242,244,247,.55); font-size: 12px; margin-bottom: 2px; }
    .uid-layout-count { color: rgba(212,255,72,.82); font-size: 11px; margin-bottom: 4px; }
    .uid-layout-count span { color: rgba(242,244,247,.42); margin-left: 8px; }
    .uid-layout-action-tip {
      font-size: 12px;
      margin-bottom: 6px;
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid rgba(255,255,255,.14);
      background: rgba(255,255,255,.04);
      color: rgba(242,244,247,.9);
      width: fit-content;
    }
    .uid-layout-action-tip.add { border-color: rgba(121,255,145,.4); color: #c2ffd0; }
    .uid-layout-action-tip.remove { border-color: rgba(255,169,121,.38); color: #ffd8c2; }
    .uid-layout-selected-strip {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      font-size: 11px;
      color: rgba(242,244,247,.72);
      margin-bottom: 4px;
      max-height: 78px;
      overflow: auto;
    }
    .uid-layout-selected-strip span {
      border: 1px solid rgba(121,255,145,.35);
      background: rgba(121,255,145,.1);
      color: #d9ffe3;
      border-radius: 999px;
      padding: 1px 7px;
      font-size: 10px;
    }
    .uid-layout-selected-strip em { color: rgba(242,244,247,.4); font-style: normal; }
    .uid-layout-unknown-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 10px;
      color: #ffd8c2;
      margin: 2px 0 8px;
    }
    .uid-layout-unknown-strip span {
      border: 1px solid rgba(255,169,121,.45);
      background: rgba(255,169,121,.12);
      border-radius: 999px;
      padding: 1px 7px;
    }
    .uid-layout-live-stage {
      position: relative;
      height: 220px;
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 10px;
      overflow: hidden;
      background: #090d14;
      margin-bottom: 8px;
    }
    .uid-layout-live-bg {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at 70% 20%, rgba(79,214,255,.16), transparent 35%),
        radial-gradient(circle at 20% 80%, rgba(212,255,72,.14), transparent 38%),
        linear-gradient(180deg, rgba(8,12,18,.95), rgba(6,9,14,.98));
    }
    .uid-layout-live-node {
      position: absolute;
      min-width: 82px;
      max-width: 180px;
      min-height: 28px;
      padding: 6px 9px;
      border-radius: 8px;
      border: 1px solid rgba(212,255,72,.42);
      background: rgba(212,255,72,.1);
      color: #e9ffd3;
      font-size: 11px;
      line-height: 1.2;
      box-sizing: border-box;
      z-index: 1;
    }
    .uid-layout-live-node strong { display: block; color: #f4ffe6; font-size: 11px; }
    .uid-layout-live-node small { display: block; color: rgba(233,255,211,.75); font-size: 10px; margin-top: 2px; }
    .uid-layout-live-node.source-selected-extra {
      border-color: rgba(79,214,255,.62);
      background: rgba(79,214,255,.14);
      color: #e8f8ff;
    }
    .uid-layout-live-node.is-hidden {
      display: none;
    }
    .uid-layout-live-node.anchor-left-top { left: 10px; top: calc(10px + (var(--slot) * 34px)); }
    .uid-layout-live-node.anchor-right-top { right: 10px; top: calc(10px + (var(--slot) * 34px)); }
    .uid-layout-live-node.anchor-left-bottom { left: 10px; bottom: calc(10px + (var(--slot) * 34px)); }
    .uid-layout-live-node.anchor-right-bottom { right: 10px; bottom: calc(10px + (var(--slot) * 34px)); }
    .uid-layout-live-node.anchor-top-center { left: 50%; top: calc(10px + (var(--slot) * 34px)); transform: translateX(-50%); }
    .uid-layout-live-node.anchor-bottom-center { left: 50%; bottom: calc(10px + (var(--slot) * 34px)); transform: translateX(-50%); }
    .uid-layout-live-node.anchor-center { left: 50%; top: calc(50% + (var(--slot) * 34px)); transform: translate(-50%, -50%); }
    .uid-layout-live-node.anchor-center-wide { left: 50%; top: calc(50% + (var(--slot) * 34px)); width: 220px; transform: translate(-50%, -50%); }
    .uid-layout-live-node.anchor-right-mid { right: 10px; top: calc(50% + (var(--slot) * 34px)); transform: translateY(-50%); }
    .uid-layout-live-node.anchor-bottom-wide { left: 50%; bottom: calc(10px + (var(--slot) * 34px)); width: 220px; transform: translateX(-50%); }
    .uid-layout-layer {
      border: 1px solid rgba(255,255,255,.08);
      border-radius: 10px;
      background: rgba(255,255,255,.02);
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .uid-layout-layer-title { font-size: 11px; color: var(--uid-accent, #ffb24a); letter-spacing: .06em; text-transform: uppercase; }
    .uid-layout-module-grid { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
    .uid-layout-module-box {
      min-height: 52px;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 8px;
      padding: 8px 10px;
      background: rgba(255,255,255,.03);
      display: grid;
      gap: 4px;
      align-content: center;
    }
    .uid-layout-module-box span { color: rgba(242,244,247,.88); font-size: 12px; }
    .uid-layout-module-box small { color: rgba(242,244,247,.45); font-size: 10px; }
    .uid-layout-module-box.empty { border-style: dashed; }
    .uid-layout-module-box.active {
      border-color: rgba(212,255,72,.45);
      background: color-mix(in srgb, var(--uid-accent, #ffb24a) 14%, rgba(255,255,255,.03));
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.14);
    }
    .uid-layout-module-box.inactive {
      opacity: .48;
      border-style: dashed;
      background: rgba(255,255,255,.01);
    }
    .uid-layout-module-box.priority-required { opacity: 1; }
    .uid-layout-module-box.source-selected-extra {
      border-color: rgba(79,214,255,.42);
      box-shadow: inset 0 0 0 1px rgba(79,214,255,.16);
    }
    .uid-layout-module-box.just-added {
      animation: uid-layout-flash-add .9s ease-out 1;
    }
    .uid-layout-candidate-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      border-top: 1px dashed rgba(255,255,255,.09);
      padding-top: 8px;
      margin-top: 4px;
    }
    .uid-layout-candidate-row span {
      font-size: 10px;
      color: rgba(242,244,247,.38);
      border: 1px dashed rgba(255,255,255,.14);
      border-radius: 999px;
      padding: 1px 6px;
    }
    .uid-layout-candidate-row span.just-removed {
      border-color: rgba(255,175,130,.45);
      color: rgba(255,215,190,.92);
      animation: uid-layout-flash-remove .9s ease-out 1;
    }
    @keyframes uid-layout-flash-add {
      0% { transform: scale(.96); box-shadow: 0 0 0 0 rgba(122,255,162,.55); }
      100% { transform: scale(1); box-shadow: 0 0 0 10px rgba(122,255,162,0); }
    }
    @keyframes uid-layout-flash-remove {
      0% { background: rgba(255,150,120,.18); }
      100% { background: transparent; }
    }

    /* ── Preview Panels ── */
    .uid-preview-card, .uid-floating { border: 1px solid rgba(255,255,255,.08); background: var(--uid-panel, rgba(12,16,22,.82)); box-shadow: 0 20px 40px rgba(0,0,0,.28); border-radius: 6px; position: relative; z-index: 2; }
    /* 有 panel 纹理时叠加纹理层 */
    .uid-preview-stage[style*="--uid-panel-texture"] .uid-preview-card::before,
    .uid-preview-stage[style*="--uid-panel-texture"] .uid-floating::before,
    .uid-preview-stage[style*="--uid-panel-texture"] .upv-bag-left::before,
    .uid-preview-stage[style*="--uid-panel-texture"] .upv-dialog-box::before,
    .uid-preview-stage[style*="--uid-panel-texture"] .upv-pause-panel::before,
    .uid-preview-stage[style*="--uid-panel-texture"] .upv-hud-quest::before,
    .uid-preview-stage[style*="--uid-panel-texture"] .upv-hud-health::before,
    .uid-preview-stage[style*="--uid-panel-texture"] .upv-hud-ammo::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background-image: var(--uid-panel-texture);
      background-size: cover;
      opacity: .18;
      pointer-events: none;
      z-index: 0;
    }
    .uid-preview-kicker { color: var(--uid-accent); font-size: 11px; letter-spacing: .16em; text-transform: uppercase; }
    .uid-preview-title { font-size: 34px; font-weight: 800; line-height: 1; }
    .uid-preview-copy { color: rgba(242,244,247,.78); line-height: 1.6; }
    .uid-preview-foot { color: rgba(242,244,247,.56); font-size: 12px; }
    .uid-preview-menu, .uid-preview-shop, .uid-preview-results { display: grid; grid-template-columns: 1.3fr .8fr; gap: 18px; padding: 22px; height: 100%; position: relative; z-index: 1; }
    .uid-preview-menu .hero, .uid-preview-results .result-main { display: grid; align-content: end; gap: 12px; padding: 28px; }
    .uid-preview-menu .side, .uid-preview-results .result-side { display: grid; gap: 10px; align-content: start; padding: 20px; }
    .uid-preview-list, .uid-preview-grid, .uid-preview-options { display: grid; gap: 8px; }
    .uid-preview-list span, .uid-preview-grid span, .uid-preview-options span, .uid-preview-results .result-side span { padding: 10px 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.05); border-radius: 4px; }
    .uid-preview-shop .shelf, .uid-preview-shop .bag { padding: 22px; display: grid; gap: 14px; }
    .uid-preview-dialog { display: grid; grid-template-columns: 160px 1fr; gap: 18px; padding: 22px; align-items: end; height: 100%; position: relative; z-index: 1; }
    .uid-preview-dialog .npc { min-height: 240px; display: grid; place-items: center; font-size: 20px; color: var(--uid-accent); }
    .uid-preview-dialog .speech { padding: 22px; display: grid; gap: 14px; }

    /* ── Style Board Center ── */
    .uid-style-board-stage { background:
      radial-gradient(circle at 18% 14%, rgba(255,255,255,.05), transparent 22%),
      linear-gradient(180deg, rgba(18,22,30,.96), rgba(10,12,18,1)); }
    .uid-style-board-shell { position: relative; z-index: 2; display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 14px; padding: 16px; height: 100%; box-sizing: border-box; }
    .uid-sb-panel { position: relative; display: grid; gap: 10px; align-content: start; padding: 14px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; background: rgba(10,14,20,.62); overflow: hidden; }
    .uid-style-board-stage[style*="--uid-panel-texture"] .uid-sb-panel::before,
    .uid-style-board-stage[style*="--uid-panel-texture"] .uid-sb-card::before,
    .uid-style-board-stage[style*="--uid-panel-texture"] .uid-sb-toast::before,
    .uid-style-board-stage[style*="--uid-panel-texture"] .uid-sb-list-item::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image: var(--uid-panel-texture);
      background-size: cover;
      opacity: .16;
      pointer-events: none;
    }
    .uid-sb-flow-panel { grid-column: 1 / 2; }
    .uid-sb-workbench-panel { grid-column: 2 / 3; align-content: start; overflow: auto; }
    .uid-sb-title { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--uid-accent, #ffb24a); }
    .uid-sb-section-title { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: rgba(242,244,247,.56); margin-top: 2px; }
    .uid-sb-title-deco { min-height: 62px; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 800; color: #fff; text-shadow: 0 1px 8px rgba(0,0,0,.45); background-image: var(--uid-title-deco, none); background-size: 100% 100%; background-position: center; background-repeat: no-repeat; }
    .uid-sb-button-row { display: flex; flex-wrap: wrap; gap: 8px; }
    .uid-sb-button-row .upv-start-item,
    .uid-sb-button-row .upv-results-btn { min-width: 106px; }
    .uid-sb-panel-row { display: grid; grid-template-columns: 1.1fr .9fr .9fr; gap: 8px; }
    .uid-sb-card { position: relative; min-height: 120px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.04); display: flex; align-items: center; justify-content: center; color: rgba(242,244,247,.82); }
    .uid-sb-card.small { min-height: 72px; }
    .uid-sb-icon-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .uid-sb-icon-grid-standalone { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .uid-board-icon { aspect-ratio: 1; border: none; border-radius: 0; background-color: transparent; background-size: contain; background-repeat: no-repeat; background-position: center; }
    .uid-sb-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
    .uid-sb-toast { position: relative; min-height: 44px; display: flex; align-items: center; padding: 0 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(255,255,255,.04); color: rgba(242,244,247,.88); font-size: 12px; overflow: hidden; }
    .uid-sb-toast.success { border-color: rgba(76,222,122,.3); }
    .uid-sb-toast.warn { border-color: rgba(255,178,74,.3); }
    .uid-sb-bars { display: grid; gap: 8px; }
    .uid-sb-bar-inline { position: relative !important; left: auto !important; bottom: auto !important; top: auto !important; right: auto !important; }
    .uid-sb-list { display: grid; gap: 8px; }
    .uid-sb-list-item { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border: 1px solid rgba(255,255,255,.08); border-radius: 10px; background: rgba(255,255,255,.03); overflow: hidden; }
    .uid-sb-board-tags { display: flex; flex-wrap: wrap; gap: 5px; }
    .uid-sb-flow-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .uid-sb-flow-card { display: grid; gap: 10px; }
    .uid-sb-flow-head { display: flex; align-items: center; gap: 10px; }
    .uid-sb-flow-step { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; background: rgba(212,255,72,.16); color: var(--uid-accent, #ffb24a); font-size: 11px; font-weight: 800; }
    .uid-sb-flow-label { font-size: 12px; font-weight: 700; color: #fff; }
    .uid-sb-flow-slot { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: rgba(242,244,247,.42); }
    .uid-sb-flow-stage { position: relative; min-height: 220px; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; overflow: hidden; background:
      radial-gradient(circle at 50% 0%, rgba(255,255,255,.06), transparent 28%),
      linear-gradient(180deg, rgba(7,10,15,.96), rgba(14,18,24,.92)); }
    .uid-sb-flow-stage > * { position: relative; z-index: 1; }
    .uid-sb-flow-stage .uid-preview-menu,
    .uid-sb-flow-stage .uid-preview-shop,
    .uid-sb-flow-stage .uid-preview-results,
    .uid-sb-flow-stage .uid-preview-dialog { padding: 14px; gap: 12px; }
    .uid-sb-flow-stage .upv-start:not(.upv-start--racing):not(.upv-start--puzzle),
    .uid-sb-flow-stage .upv-bag:not(.upv-bag--open-world):not(.upv-bag--arpg),
    .uid-sb-flow-stage .upv-dialog:not(.upv-dialog--open-world):not(.upv-dialog--mmo):not(.upv-dialog--arpg),
    .uid-sb-flow-stage .upv-shop,
    .uid-sb-flow-stage .upv-levelsel:not(.upv-levelsel--racing),
    .uid-sb-flow-stage .upv-weaponwheel:not(.upv-weaponwheel--fps),
    .uid-sb-flow-stage .upv-map,
    .uid-sb-flow-stage .upv-pause:not(.upv-pause--arpg),
    .uid-sb-flow-stage .upv-results:not(.upv-results--arpg) { transform: scale(.78); transform-origin: top left; width: 128%; height: 128%; }
    .uid-sb-flow-stage .upv-hud:not(.upv-hud--racing):not(.upv-hud--puzzle) { transform: scale(.82); transform-origin: top left; width: 122%; height: 122%; }
    .uid-history-list-compact { max-height: 320px; overflow: auto; padding-right: 4px; }

    /* ── HUD ── */
    .uid-preview-hud { position: absolute; inset: 0; z-index: 1; }
    .uid-floating { position: absolute; padding: 8px 12px; color: #fff; font-size: 12px; }
    .uid-hud-required-strip { position: absolute; bottom: 8px; right: 8px; display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; max-width: 280px; }
    .uid-hud-badge { font-size: 10px; padding: 3px 7px; border-radius: 4px; border: 1px solid; }
    .uid-hud-badge.required { border-color: rgba(255,80,80,.5); background: rgba(255,80,80,.12); color: #ff8080; }

    /* ── upv: 屏幕布局组件 ─────────────────────────────── */
    /* 公共 */
    [class^="upv-"] button { cursor: pointer; border: none; border-radius: 5px; font-size: 12px; transition: opacity .15s; }
    [class^="upv-"] button:hover { opacity: .8; }
    .upv-dialog .upv-dialog-opt { font-size: 15px; min-height: 44px; padding: 10px 20px; border-radius: 6px; }
    .upv-pause .upv-pause-item { font-size: 16px; min-height: 50px; padding: 12px 24px; border-radius: 8px; }
    .upv-map .upv-map-filter button { font-size: 14px; min-height: 42px; padding: 8px 20px; border-radius: 8px; }
    .upv-results .upv-results-btn { font-size: 16px; min-height: 52px; padding: 12px 24px; border-radius: 8px; }
    .upv-start--arpg .gl-arpg-enter { font-size: 17px; min-height: 56px; padding: 14px 36px; }
    .upv-start--arpg .gl-arpg-tabs button { font-size: 14px; min-height: 44px; padding: 10px 24px; }
    .upv-start--fps .gl-fps-topnav button { font-size: 14px; min-height: 44px; }
    .upv-start--fps .gl-fps-mode { background-image: none !important; }
    .upv-start--fps .gl-fps-mode.active { background-image: none !important; }
    .upv-weaponwheel--fps .gl-fps-loadout-card { background-image: none !important; }
    .upv-start--fps .gl-fps-mode strong { font-size: clamp(18px, 2.2vw, 24px); }
    .upv-start--fps .gl-fps-mode span { font-size: clamp(13px, 1.6vw, 16px); }
    .upv-start--fps .gl-fps-match-btn,
    .upv-start--fps .gl-fps-footer .upv-start-item.primary { font-size: 17px; min-height: 56px; min-width: 220px; }
    .upv-weaponwheel--fps .gl-fps-loadout-tabs button { font-size: 14px; min-height: 44px; }
    .upv-weaponwheel--fps .gl-fps-loadout-confirm { font-size: 16px; min-height: 52px; min-width: 200px; }
    .upv-start--survival .gl-surv-brand { font-size: 46px; }
    .upv-start--survival .gl-surv-tagline { font-size: 15px; }
    .upv-start--survival .gl-surv-rail .upv-start-item { font-size: 15px; min-height: 52px; }
    .upv-start--survival .gl-surv-rail .upv-start-item.primary { font-size: 16px; min-height: 58px; }
    .upv-start--survival .gl-surv-topnav button { font-size: 13px; min-height: 40px; }
    .upv-hud--survival .gl-surv-minimap { width: 92px !important; height: 92px !important; }
    .upv-hud--survival .gl-surv-hotbar .gl-hotbar-slot { width: 48px; height: 48px; font-size: 12px; }
    .upv-hud--survival .gl-surv-vital-body .upv-hud-bar { height: 8px; }
    .upv-start--mmo .gl-mmo-server { font-size: 14px; }
    .upv-start--mmo .gl-mmo-slot { font-size: 14px; min-height: 148px; }
    .upv-start--mmo .gl-mmo-class { font-size: 36px; }
    .upv-start--mmo .gl-mmo-enter { font-size: 17px; min-height: 54px; }
    .upv-supplemental-main-nav button { font-size: 14px; min-width: 72px; height: 44px; }
    .upv-hud--mmo .gl-mmo-minimap { width: 92px !important; height: 92px !important; }
    .upv-hud--mmo .gl-mmo-skill { width: 46px; height: 46px; font-size: 12px; }
    .upv-hud--mmo .gl-mmo-chat { font-size: 12px; }
    .upv-dialog--mmo .gl-mmo-dialog-dock { max-height: min(42vh, 320px); }
    .upv-start--lifesim .gl-life-title { font-size: 36px; }
    .upv-start--lifesim .gl-life-continue { font-size: 16px; min-height: 52px; }
    .upv-start--racing .gl-race-hero { width: min(1160px, 96vw) !important; max-height: min(64vh, 560px) !important; top: 50% !important; transform: translate(-50%, -50%) !important; }
    .upv-start--racing .gl-race-car-frame { max-height: min(64vh, 560px) !important; }
    .upv-start--racing .gl-race-nav .upv-start-item { font-size: 15px; min-height: 48px; }
    .upv-levelsel--racing .gl-race-track-map-panel { min-height: min(56vh, 420px) !important; max-height: min(72vh, 560px) !important; }
    .upv-levelsel--racing .gl-race-track-card { padding: 16px 18px !important; }
    .upv-levelsel--racing .gl-race-track-card-name { font-size: 17px !important; }
    .upv-levelsel--racing .gl-race-track-start { min-height: 58px !important; font-size: 18px !important; }
    .upv-hud--racing .gl-race-dash-radar { width: min(160px, 24vw) !important; height: min(160px, 24vw) !important; }
    .upv-hud--racing .gl-race-dash-speed-val { font-size: clamp(64px, 10vw, 96px) !important; }
    .upv-hud--racing .gl-race-dash-pos-num { font-size: clamp(48px, 7vw, 60px) !important; }
    .upv-start--puzzle .gl-puzzle-hero-card { width: min(100%, 680px) !important; }
    .upv-start--puzzle .gl-puzzle-cta { min-height: 58px !important; font-size: 18px !important; }
    .upv-start--puzzle .gl-puzzle-chip strong { font-size: 18px !important; }
    .upv-start--puzzle .gl-puzzle-dock-btn { min-height: 54px !important; font-size: 15px !important; }
    .upv-hud--puzzle .gl-puzzle-board { width: min(78vw, 540px) !important; max-height: min(70vh, 540px) !important; }
    .upv-hud--puzzle .gl-puzzle-booster { min-height: 76px !important; min-width: 96px !important; }
    .upv-hud--puzzle .gl-puzzle-hud-score strong { font-size: 30px !important; }
    .upv-bag--open-world .gl-ow-bag-grid { grid-template-columns: repeat(6, minmax(0, 1fr)) !important; grid-auto-rows: minmax(100px, auto) !important; }
    .upv-bag--open-world .gl-ow-bag-slot { min-height: 100px !important; }
    .upv-bag--open-world .gl-ow-bag-detail-art { max-height: min(40vh, 300px) !important; }
    .upv-bag--arpg .gl-arpg-bag-grid { grid-template-columns: repeat(5, minmax(0, 1fr)) !important; grid-auto-rows: minmax(104px, auto) !important; }
    .upv-bag--arpg .gl-arpg-bag-slot { min-height: 104px !important; }
    .upv-bag--arpg .gl-arpg-bag-action.primary { min-height: 54px !important; font-size: 16px !important; }
    .upv-bag.upv-bag--arpg { grid-template-columns: minmax(0, 1fr) minmax(260px, 32vw) !important; padding: 0 !important; gap: 0 !important; }
    .upv-dialog--open-world .gl-ow-dialog-portrait { width: min(260px, 32vw) !important; height: min(340px, 44vh) !important; }
    .upv-dialog--open-world .gl-ow-dialog-text { font-size: 18px !important; }
    .upv-dialog--open-world .upv-dialog-opt { min-height: 52px !important; font-size: 16px !important; }
    .upv-dialog--arpg .gl-arpg-dialog-portrait { width: min(400px, 44vw) !important; height: min(540px, 64vh) !important; }
    .upv-dialog--arpg .gl-arpg-dialog-text { font-size: 19px !important; }
    .upv-dialog--arpg .gl-arpg-dialog-opt { min-height: 54px !important; font-size: 16px !important; }
    .upv-char--open-world .gl-ow-char-model { min-height: min(48vh, 380px) !important; }
    .upv-char--open-world .gl-ow-char-stat dd { font-size: 19px !important; }
    .upv-char--open-world .gl-ow-char-equip { min-height: 76px !important; }
    .upv-char--open-world .gl-ow-char-gear-action { min-height: 52px !important; font-size: 16px !important; }
    .upv-char--arpg .gl-arpg-char-hero { min-height: min(50vh, 400px) !important; }
    .upv-char--arpg .gl-arpg-char-stat dd { font-size: 19px !important; }
    .upv-char--arpg .gl-arpg-char-relic { min-height: 76px !important; }
    .upv-char--arpg .gl-arpg-char-btn.primary { min-height: 52px !important; }
    .upv-pause--arpg .gl-arpg-pause-quick-btn { min-height: 68px !important; }
    .upv-pause--arpg .gl-arpg-pause-action { min-height: 56px !important; font-size: 16px !important; }
    .upv-pause--arpg .gl-arpg-pause-action.primary { min-height: 60px !important; font-size: 17px !important; }
    .upv-results--arpg .gl-arpg-results-rank { width: min(148px, 24vw) !important; height: min(148px, 24vw) !important; font-size: 56px !important; }
    .upv-results--arpg .gl-arpg-results-title { font-size: 32px !important; }
    .upv-results--arpg .gl-arpg-results-btn { min-height: 54px !important; font-size: 16px !important; }
    .upv-results--arpg .gl-arpg-results-btn.primary { min-height: 58px !important; min-width: 200px !important; }

    /* ── 按钮图片注入（CSS 变量有值时覆盖背景色）── */
    /* 普通按钮 */
    .uid-preview-stage .upv-start-item:not(.primary),
    .uid-preview-stage .upv-pause-item:not(.primary),
    .uid-preview-stage .upv-results-btn:not(.primary),
    .uid-preview-stage .upv-bag-tab,
    .uid-preview-stage .uid-clib-segment span,
    .uid-preview-stage .uid-clib-pager button,
    .uid-preview-stage .uid-clib-notify-preview .uid-clib-notice.prompt button,
    .uid-preview-stage .upv-shop-tabs button,
    .uid-preview-stage .upv-map-filter button,
    .uid-preview-stage .upv-dialog-opt {
      background-image: var(--uid-btn-normal, none);
      background-size: 100% 100%;
      background-color: transparent;
      border-color: transparent;
      color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,.7);
    }
    .uid-preview-stage .gl-fps-topnav button,
    .uid-preview-stage .gl-fps-loadout-tabs button,
    .uid-preview-stage .gl-surv-topnav button,
    .uid-preview-stage .gl-arpg-tabs button {
      background-image: var(--uid-btn-normal, none);
      background-size: 100% 100%;
      background-color: transparent;
      border-color: transparent;
      color: #fff;
      text-shadow: 0 1px 3px rgba(0,0,0,.7);
    }
    /* 主按钮 */
    .uid-preview-stage .upv-start-item.primary,
    .uid-preview-stage .gl-fps-match-btn,
    .uid-preview-stage .gl-fps-loadout-confirm,
    .uid-preview-stage .upv-pause-item.primary,
    .uid-preview-stage .upv-results-btn.primary,
    .uid-preview-stage .uid-clib-genre-preview .upv-bag-tab.active,
    .uid-preview-stage .uid-clib-genre-preview .uid-clib-segment span.active,
    .uid-preview-stage .uid-clib-genre-preview .uid-clib-pager button.active,
    .uid-preview-stage .upv-shop-buy {
      background-image: var(--uid-btn-primary, none);
      background-size: 100% 100%;
      background-color: transparent;
      border-color: transparent;
      color: #fff;
      font-weight: 700;
      text-shadow: 0 1px 4px rgba(0,0,0,.8);
    }
    /* 标签与分段：注入按钮底图时放大底版、缩小文字，避免字撑满底纹 */
    .uid-preview-stage .uid-clib-tabs-preview .upv-bag-tab {
      min-width: 84px;
      min-height: 40px;
      padding: 7px 22px;
      font-size: 8px;
      line-height: 1.1;
      letter-spacing: 0.04em;
    }
    .uid-preview-stage .uid-clib-segment span {
      min-width: 60px;
      min-height: 36px;
      padding: 7px 20px;
      font-size: 8px;
      letter-spacing: 0.04em;
    }
    .uid-preview-stage .uid-clib-pager button {
      min-width: 32px;
      height: 32px;
      font-size: 8px;
    }
    .uid-preview-stage .uid-clib-pager em {
      font-size: 9px;
    }
    /* 标题装饰 */
    .uid-preview-stage .upv-start-logo {
      background-image: var(--uid-title-deco, none);
      background-size: 100% 100%;
      padding: 8px 24px;
      border-radius: 4px;
    }

    ${WORKBENCH_LAYOUT_SCENE_CSS}

    /* ── Summary (inlined into left panel) ── */
    .uid-side-copy { color: var(--text-secondary); line-height: 1.6; }
    .uid-side-flow { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
    .uid-side-flow-node { cursor: pointer; font-size: 11px; color: var(--text-secondary); padding: 2px 6px; border-radius: 4px; }
    .uid-side-flow-node:hover { color: var(--text-primary); }
    .uid-side-flow-node.active { color: var(--accent); font-weight: 700; }
    .uid-side-flow-sep { color: var(--text-secondary); opacity: .4; font-size: 11px; }
    .uid-rec-styles { display: grid; gap: 6px; }
    .uid-rec-style { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: rgba(255,255,255,.02); }
    .uid-rec-style.active { border-color: var(--accent); background: var(--accent-dim); }
    .uid-rec-style span { font-size: 12px; font-weight: 600; color: var(--text-primary); }
    .uid-rec-style small { font-size: 11px; color: var(--text-secondary); line-height: 1.4; }
    .uid-rec-style.active span { color: var(--accent); }
    .uid-list { margin: 0; padding-left: 0; list-style: none; color: var(--text-secondary); line-height: 1.6; display: grid; gap: 6px; }
    .uid-list li { font-size: 12px; line-height: 1.5; }
    .uid-conflict-error { color: #ff8080; }
    .uid-conflict-warn { color: #ffd080; }
    .uid-conflict-info { color: rgba(242,244,247,.56); }
    .uid-conflict-ok { color: #80d48a; }
    .uid-badge-error { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 4px; background: rgba(255,80,80,.15); color: #ff8080; font-size: 10px; font-weight: 700; }
    .uid-badge-warn { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 4px; background: rgba(255,208,80,.15); color: #ffd080; font-size: 10px; font-weight: 700; }
    .uid-pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: var(--text-primary); font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
    .uid-pre-compact { font-size: 11px; color: var(--text-secondary); }

    /* ── Loading Shell ── */
    .uid-loading-shell { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: linear-gradient(180deg, #0d1016, #06070a); }
    .uid-loading-inner { display: flex; flex-direction: column; align-items: center; gap: 14px; max-width: 380px; text-align: center; }
    .uid-loading-spinner { width: 36px; height: 36px; border: 3px solid rgba(255,255,255,.1); border-top-color: var(--accent); border-radius: 50%; animation: uid-spin 0.8s linear infinite; }
    @keyframes uid-spin { to { transform: rotate(360deg); } }
    .uid-loading-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
    .uid-loading-sub { color: var(--text-secondary); line-height: 1.6; }
    .uid-loading-sub-muted { font-size: 11px; opacity: .68; }
    .uid-loading-hint { font-size: 11px; color: var(--text-secondary); opacity: .6; }
    .uid-clib-loading .uid-loading-hint code { font-size: 10px; color: rgba(212,255,72,.75); }
    .uid-loading-inner-progress { align-items: stretch; width: min(420px, 78vw); max-width: 420px; padding: 22px; border: 1px solid rgba(255,255,255,.08); border-radius: 18px; background: rgba(255,255,255,.035); box-shadow: 0 20px 60px rgba(0,0,0,.35); }
    .uid-loading-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .uid-loading-percent { color: var(--accent); font-size: 20px; font-weight: 800; letter-spacing: .02em; }
    .uid-progress-track { height: 8px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.08); box-shadow: inset 0 0 0 1px rgba(255,255,255,.04); }
    .uid-progress-fill { position: relative; height: 100%; border-radius: inherit; background: linear-gradient(90deg, rgba(212,255,72,.78), rgba(212,255,72,1)); box-shadow: 0 0 18px rgba(212,255,72,.25); transition: width .35s ease; overflow: hidden; }
    .uid-progress-fill.is-pulsing::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.32), transparent); animation: uid-progress-shimmer 1.15s ease-in-out infinite; }
    @keyframes uid-progress-shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
    .uid-loading-steps { display: grid; gap: 7px; margin: 4px 0 0; padding: 0; list-style: none; text-align: left; }
    .uid-loading-step { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 6px 9px; border: 1px solid rgba(255,255,255,.07); border-radius: 9px; background: rgba(0,0,0,.16); color: var(--text-secondary); font-size: 12px; }
    .uid-loading-step span { display: inline-flex; width: 14px; justify-content: center; color: currentColor; }
    .uid-loading-step-done { border-color: rgba(212,255,72,.28); color: rgba(212,255,72,.92); background: rgba(212,255,72,.08); }
    .uid-loading-step-active { border-color: rgba(212,255,72,.5); color: var(--text-primary); background: rgba(212,255,72,.12); box-shadow: 0 0 0 1px rgba(212,255,72,.08) inset; }
    .uid-loading-step-pending { opacity: .72; }
    .uid-skill-hint { margin: 0 0 10px; font-size: 12px; line-height: 1.65; color: var(--text-secondary); }
    .uid-skill-hint code { font-size: 11px; color: rgba(212,255,72,.88); }

    /* ── Generate Button ── */
    /* ── 场景描述 ── */
    .uid-scene-suggestions { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 8px; }
    .uid-scene-tag {
      padding: 4px 10px;
      background: rgba(255,255,255,.055);
      border: 1px solid rgba(242,244,247,.16);
      border-radius: 20px;
      font-size: 11px;
      color: rgba(242,244,247,.72);
      cursor: pointer;
      transition: border-color .14s ease, background .14s ease, color .14s ease, box-shadow .14s ease;
      white-space: nowrap;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.025);
    }
    .uid-scene-tag:hover {
      border-color: rgba(212,255,72,.38);
      background: rgba(212,255,72,.075);
      color: rgba(242,244,247,.95);
    }
    .uid-scene-tag.active {
      background: rgba(212,255,72,.16);
      border-color: rgba(212,255,72,.88);
      color: #d4ff48;
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.28), 0 0 10px rgba(212,255,72,.10);
    }
    .uid-scene-tag:disabled {
      border-color: rgba(140,148,156,.2);
      background: rgba(120,128,136,.06);
      color: rgba(170,178,186,.34);
      cursor: not-allowed;
      filter: grayscale(1);
    }
    .uid-scene-tag:disabled:hover {
      border-color: rgba(140,148,156,.2);
      background: rgba(120,128,136,.06);
      color: rgba(170,178,186,.34);
    }
    .uid-scene-input-wrap { position: relative; }
    .uid-scene-input { width: 100%; padding: 8px 10px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.1); border-radius: 6px; color: var(--text-primary); font: inherit; font-size: 12px; resize: none; line-height: 1.5; outline: none; box-sizing: border-box; }
    .uid-scene-input:focus { border-color: var(--accent); background: rgba(255,255,255,.06); }
    .uid-scene-input::placeholder { color: rgba(242,244,247,.25); }
    .uid-scene-input:disabled {
      border-color: rgba(140,148,156,.18);
      background: rgba(120,128,136,.055);
      color: rgba(170,178,186,.38);
      cursor: not-allowed;
      filter: grayscale(1);
    }
    .uid-scene-charcount { position: absolute; bottom: 6px; right: 8px; font-size: 9px; color: rgba(242,244,247,.25); pointer-events: none; }
    .uid-scene-regen {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 6px;
      min-height: 28px;
      padding: 5px 12px;
      background: rgba(255,255,255,.055);
      border: 1px solid rgba(242,244,247,.16);
      border-radius: 6px;
      font-size: 11px;
      line-height: 1.2;
      font-weight: 700;
      color: rgba(242,244,247,.72);
      cursor: pointer;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.025);
      transition: border-color .14s ease, background .14s ease, color .14s ease, box-shadow .14s ease;
    }
    .uid-scene-regen:hover {
      border-color: rgba(212,255,72,.38);
      background: rgba(212,255,72,.075);
      color: rgba(242,244,247,.95);
    }

    .uid-generate-bar {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      padding: 12px 0 4px;
    }
    .uid-generate-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: auto;
      max-width: 100%;
      min-height: 32px;
      padding: 7px 12px;
      border: 1px solid rgba(212,255,72,.88);
      background: rgba(212,255,72,.16);
      color: #d4ff48;
      font: 700 12px/1.2 inherit;
      cursor: pointer;
      border-radius: 6px;
      letter-spacing: .03em;
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.28), 0 0 12px rgba(212,255,72,.12);
      transition: border-color .14s ease, background .14s ease, box-shadow .14s ease, transform .1s ease;
    }
    .uid-generate-btn:hover {
      border-color: #d4ff48;
      background: rgba(212,255,72,.24);
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.34), 0 0 16px rgba(212,255,72,.18);
      transform: translateY(-1px);
    }
    .uid-generate-btn:active { transform: translateY(0); }
    .uid-generate-btn:disabled {
      background: linear-gradient(180deg, rgba(132,140,148,.18), rgba(86,94,102,.12));
      color: rgba(190,198,206,.42);
      border: 1px solid rgba(140,148,156,.24);
      cursor: not-allowed;
      opacity: 1;
      transform: none;
      filter: grayscale(1);
      box-shadow: none;
    }
    .uid-generate-btn:disabled:hover,
    .uid-generate-btn:disabled:active {
      opacity: 1;
      transform: none;
    }
    .uid-generate-btn.is-generating:disabled {
      background: rgba(212,255,72,.12);
      color: rgba(212,255,72,.92);
      border-color: rgba(212,255,72,.55);
      filter: none;
      cursor: wait;
      box-shadow: inset 0 0 0 1px rgba(212,255,72,.2), 0 0 14px rgba(212,255,72,.08);
    }
    .uid-generate-icon { font-size: 16px; }
    .uid-generate-hint { text-align: right; font-size: 11px; color: var(--text-secondary); }

    /* ── Prototype Shell ── */
    .uid-proto-shell { display: flex; flex-direction: column; width: 100%; height: 100%; }
    .uid-proto-bar { display: flex; align-items: center; gap: 12px; padding: 10px 18px; background: rgba(0,0,0,.3); border-bottom: 1px solid rgba(255,255,255,.08); flex-shrink: 0; }
    .uid-proto-back { padding: 6px 14px; border: 1px solid rgba(255,255,255,.15); background: none; color: rgba(242,244,247,.8); font: inherit; cursor: pointer; border-radius: 4px; transition: all .12s; }
    .uid-proto-back:hover { border-color: var(--accent); color: var(--accent); }
    .uid-proto-title { font-size: 13px; font-weight: 600; color: rgba(242,244,247,.7); flex: 1; text-align: center; }
    .uid-proto-open { font-size: 12px; color: var(--accent); text-decoration: none; padding: 6px 12px; border: 1px solid rgba(255,255,255,.1); border-radius: 4px; }
    .uid-proto-open:hover { border-color: var(--accent); }
    .uid-proto-frame { flex: 1; width: 100%; border: none; }
  `
}

// ── Pipeline Export ────────────────────────────────────────────────────────────
let ui: UIDesignPipelineUI | null = null

const pipeline: IPipeline = {
  meta: {
    id: 'ui-design',
    name: 'UI设计',
    icon: '🧩',
    description: '按游戏类型、阶段与模块组合生成玩家界面蓝图。',
    version: '2.0.0',
  },

  async init(_context: PipelineContext) {
    if (!ui) ui = new UIDesignPipelineUI()
  },

  dispose() {},

  createUI(container: HTMLElement, panels?: PipelinePanels) {
    if (!ui) ui = new UIDesignPipelineUI()
    if (!panels) {
      container.innerHTML = '<div style="padding:12px;color:var(--text-secondary)">UI设计管线缺少面板上下文。</div>'
      return
    }
    ui.mount(container, panels)
  },

  destroyUI() {
    ui?.unmount()
  },

  getDefaultParams() {
    return {}
  },

  resetForNewCharacter() {
    if (!ui) ui = new UIDesignPipelineUI()
    ui.reset()
  },
}

export default pipeline
