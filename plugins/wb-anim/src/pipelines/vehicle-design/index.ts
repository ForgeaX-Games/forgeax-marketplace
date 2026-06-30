import type { IPipeline, PipelineContext, PipelinePanels } from '../../core/types'
import { meta } from './meta'
import { globalState } from '../../shared/GlobalState'
import { apiModelIdForImageModel } from '../../shared/promptRouter'
import { adaptPromptForImageModel } from '../../shared/promptAdapter'
import {
  VEHICLE_CATEGORIES, VEHICLE_STYLES, VEHICLE_ERAS, VIEW_MODES, VIEW_LABELS,
  getCategory, getSubtype, getViewMode, getAnimationsForCategory, getAnimation,
  getEffectiveFrameCount, getUniqueViews, getMirrorMap, isCustomSubtype,
  type VehicleCategory, type VehicleSubtype, type VehicleView, type VehicleAnimation, type ViewMode,
} from './vehicle-types'
import { generateDesignPrompt, generateViewsPrompt, generateSingleViewAnimPrompt } from './prompt-engine'
import {
  expandGreenBackground, removeAnyBackground, ensureAllFramesBgRemoved,
  splitSheetByDirection, flipCanvasHorizontally,
  unifyActionFrames, autoCenterCanvases, canvasArrayToDataUrls,
  createGifPreview, normalizeFrameSize, normalizeAllActions,
  getMaxFrameSize, validateSheetGrid, ALIGN_MODES,
  buildVehicleAction, splitVehicleViews,
  type GifPreviewHandle,
} from './sprite-processor'
import {
  saveBatch, listBatches, deleteBatch,
  saveVehicleAnim, loadAllVehicleAnims, removeVehicleAnim,
  removeVehicleAnimsByAnimId, clearVehicleAnimLib, updateVehicleAnimScale,
  type VehicleBatchEntry, type VehicleBatchAnimResult, type VehicleAnimLibEntry,
} from './vehicle-lib'
// Reuse pixel-char's canvas-based scale helpers. They take Record<string,
// string[]> and don't care whether the keys are direction names or view names
// (front/back/side_*), which is exactly what we need here.
import {
  clampScale, measureActionContentHeight, rescaleDirections,
} from '../pixel-char/sprite-processor'
import { SpriteAnimator, type SpriteActionData } from '../../core/SpriteAnimator'
import {
  sessionAutoSave, sessionLoad,
} from '../../shared/PipelineSessionStore'

/* ── Constants ────────────────────────────────────────────────────── */

const CSS_ID = 'vehicle-pipeline-css'
const STORAGE_KEY = 'vehicle-pipeline:cfg'
const PIPELINE_ID = 'vehicle-design'

function vhIcon(name: string, cls = 'vh-icon'): string {
  const paths: Record<string, string> = {
    views: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M12 5v14M5 12h14"/>',
    film: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 5v14M16 5v14M4 9h16M4 15h16"/>',
    cross: '<path d="M12 3v18M3 12h18"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    side: '<path d="M4 12h16"/><path d="m8 8-4 4 4 4"/><path d="m16 8 4 4-4 4"/>',
    diamond: '<path d="m12 3 9 9-9 9-9-9 9-9Z"/>',
    paint: '<path d="M9 18c-2 0-4 1-5 3 3 0 6 0 7-2"/><path d="M20 4 10 14"/><path d="m14 6 4 4"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.3 6.4"/><path d="M3 12A9 9 0 0 1 18.3 5.6"/><path d="M3 19v-5h5"/><path d="M21 5v5h-5"/>',
    box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  }
  const icon = paths[name] ?? paths.views
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icon}</svg>`
}

/**
 * Translate `collectBlobs()` keys to disk paths under
 * <projectRoot>/.forgeax/games/<slug>/characters/<charId>/vehicle/.
 * Returns null for keys we don't want to mirror.
 */
function vehicleBlobKeyToRel(key: string): string | null {
  if (key === 'design') return 'vehicle/design.png'
  if (key === 'views') return 'vehicle/views.png'
  if (key.startsWith('viewsplit:')) return `vehicle/views/${key.slice('viewsplit:'.length)}.png`
  if (key.startsWith('sheet:')) return `vehicle/anim/${key.slice('sheet:'.length)}/sheet.png`
  if (key.startsWith('clean:')) return `vehicle/anim/${key.slice('clean:'.length)}/clean.png`
  if (key.startsWith('frames:')) {
    const rest = key.slice('frames:'.length).replace(/:/g, '/')
    return `vehicle/frames/${rest}.png`
  }
  return null
}

type Step = 1 | 2

/* ── State ────────────────────────────────────────────────────────── */

type LeftTab = 'edit' | 'history' | 'lib'

interface VehicleConfig {
  activeStep: Step
  categoryId: string
  subtypeId: string
  /** Free-text subject used when subtypeId === 'custom'. Otherwise ignored. */
  customSubtype: string
  styleId: string
  eraId: string
  viewModeId: string
  userDesc: string
  fps: number
  selectedAnims: string[]
  leftTab: LeftTab
  alignMode: string
  targetFrameSize: number
}

interface ImageCache {
  designImage: string | null
  viewsImage: string | null
  viewSplits: Record<string, string>
  animSheets: Record<string, string>
  cleanSheets: Record<string, string>
  splitFrames: Record<string, Record<string, string[]>>
  animPrompts: Record<string, Record<string, string>>
}

function loadConfig(): VehicleConfig {
  const defaults: VehicleConfig = {
    activeStep: 1,
    categoryId: 'ground',
    subtypeId: 'sedan',
    customSubtype: '',
    styleId: 'pixel',
    eraId: 'modern',
    viewModeId: 'four-dir',
    userDesc: '',
    fps: 8,
    selectedAnims: ['idle', 'move', 'fire', 'damaged'],
    leftTab: 'edit',
    alignMode: 'bbox-center',
    targetFrameSize: 0,
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return defaults
}

function saveConfig(c: VehicleConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)) } catch { /* ignore */ }
}

/**
 * Build the English vehicle-subject prompt fragment consumed by
 * `generateDesignPrompt` / `generateViewsPrompt` / `generateSingleViewAnimPrompt`.
 *
 * For preset subtypes (police, firetruck, dragon, …) we use the hand-tuned
 * `subtype.prompt`. For the "自定义..." option we fall back to the user's
 * free text — they own the prompt in that case. If the user leaves the custom
 * box empty we degrade gracefully to the category label (e.g. "ground vehicle")
 * so the pipeline still produces SOMETHING instead of erroring out.
 */
function resolveSubjectPrompt(
  cat: VehicleCategory | undefined,
  sub: VehicleSubtype | undefined,
  customText: string,
  fallback: string,
): string {
  if (isCustomSubtype(sub)) {
    const trimmed = customText.trim()
    if (trimmed) return trimmed
    return cat ? `${cat.label} vehicle` : fallback
  }
  return sub?.prompt || fallback
}

/* ── Utility ──────────────────────────────────────────────────────── */

async function apiPost(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function stitchStripsVertically(stripDataUrls: string[]): Promise<string> {
  if (stripDataUrls.length === 0) throw new Error('no strips to stitch')
  if (stripDataUrls.length === 1) return stripDataUrls[0]
  const imgs = await Promise.all(stripDataUrls.map(url => loadImageElement(url)))
  const maxW = Math.max(...imgs.map(i => i.naturalWidth))
  const rowH = Math.max(...imgs.map(i => i.naturalHeight))
  const cv = document.createElement('canvas')
  cv.width = maxW
  cv.height = rowH * imgs.length
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#00FF00'
  ctx.fillRect(0, 0, cv.width, cv.height)
  imgs.forEach((im, i) => {
    const scale = Math.min(maxW / im.naturalWidth, rowH / im.naturalHeight)
    const dw = im.naturalWidth * scale
    const dh = im.naturalHeight * scale
    const dx = (maxW - dw) / 2
    const dy = i * rowH + (rowH - dh) / 2
    ctx.drawImage(im, dx, dy, dw, dh)
  })
  return cv.toDataURL('image/png')
}

async function compressRefImage(dataUrl: string, maxDim: number): Promise<string> {
  const img = await loadImageElement(dataUrl)
  const { naturalWidth: w, naturalHeight: h } = img
  if (w <= maxDim && h <= maxDim) return dataUrl.replace(/^data:[^;]+;base64,/, '')
  const scale = Math.min(maxDim / w, maxDim / h)
  const nw = Math.round(w * scale), nh = Math.round(h * scale)
  const cv = document.createElement('canvas')
  cv.width = nw; cv.height = nh
  cv.getContext('2d')!.drawImage(img, 0, 0, nw, nh)
  return cv.toDataURL('image/png').replace(/^data:[^;]+;base64,/, '')
}

const GEMINI_RATIOS: [number, number, string][] = [
  [1, 1, '1:1'], [1, 4, '1:4'], [1, 8, '1:8'],
  [2, 3, '2:3'], [3, 2, '3:2'], [3, 4, '3:4'],
  [4, 1, '4:1'], [4, 3, '4:3'], [4, 5, '4:5'],
  [5, 4, '5:4'], [8, 1, '8:1'], [9, 16, '9:16'],
  [16, 9, '16:9'], [21, 9, '21:9'],
]

function nearestGeminiRatio(w: number, h: number): string {
  const target = w / h
  let best = GEMINI_RATIOS[0][2]
  let bestDist = Infinity
  for (const [rw, rh, label] of GEMINI_RATIOS) {
    const dist = Math.abs(rw / rh - target)
    if (dist < bestDist) { bestDist = dist; best = label }
  }
  return best
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* ── UI Class ─────────────────────────────────────────────────────── */

let pipeCtx: PipelineContext

class VehiclePipelineUI {
  private cfg: VehicleConfig
  private img: ImageCache = {
    designImage: null,
    viewsImage: null,
    viewSplits: {},
    animSheets: {},
    cleanSheets: {},
    splitFrames: {},
    animPrompts: {},
  }
  private panels: PipelinePanels | null = null
  private leftEl: HTMLElement | null = null
  private generating = false
  private regenQueue: Array<{ animId: string }> = []
  private gifHandles = new Map<string, GifPreviewHandle[]>()
  private batchHistory: VehicleBatchEntry[] = []
  private actionLib: VehicleAnimLibEntry[] = []
  private selectedLibAnimId: string | null = null
  private restoreReady = false
  private viewingBatchId: string | null = null
  // Scene-sprite state for the "放入场景" button. Mirrors pixel-char's
  // currentSpriteAnimator / spriteUpdateCb pattern so switching vehicles
  // cleans up the previous one.
  private currentSpriteAnimator: SpriteAnimator | null = null
  private spriteUpdateCb: ((dt: number) => void) | null = null

  // Module 16 split-pane sync — see CharacterDesign for full rationale.
  // Same pattern as pixel-char: BroadcastChannel for IDB-backed blob changes,
  // storage event for cfg-only changes. Without this the center iframe never
  // sees the new designImage / viewsImage and renders an empty step grid.
  private _bc: BroadcastChannel | null = null
  private _bcSelfId = Math.random().toString(36).slice(2, 10)
  private _applyingBroadcast = false

  private setupBroadcast(): void {
    if (this._bc) return
    try {
      this._bc = new BroadcastChannel('forgeax-plugin.@forgeax-plugin/wb-character.vehicle-design-state')
    } catch { this._bc = null }
    if (this._bc) this._bc.onmessage = (e) => { void this.handleBroadcast(e) }
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (ev: StorageEvent) => {
        if (ev.key !== STORAGE_KEY) return
        if (this._applyingBroadcast) return
        try { Object.assign(this.cfg, loadConfig()) } catch { /* ignore */ }
        if (this.panels && this.leftEl) this.refresh()
      })
    }
  }

  private async handleBroadcast(e: MessageEvent): Promise<void> {
    const data = (e.data ?? {}) as { type?: string; source?: string }
    if (data.source === this._bcSelfId) return
    if (data.type !== 'vehicle-design-state') return
    if (!this.leftEl || !this.panels) return
    this._applyingBroadcast = true
    try {
      try { Object.assign(this.cfg, loadConfig()) } catch { /* ignore */ }
      this.img = {
        designImage: null,
        viewsImage: null,
        viewSplits: {},
        animSheets: {},
        cleanSheets: {},
        splitFrames: {},
        animPrompts: {},
      }
      await this.restoreSession()
      await this.refreshBatchHistory()
      this.refresh()
    } finally {
      this._applyingBroadcast = false
    }
  }

  private broadcastState(): void {
    if (this._applyingBroadcast) return
    if (!this._bc) return
    try { this._bc.postMessage({ type: 'vehicle-design-state', source: this._bcSelfId }) } catch { /* ignore */ }
  }

  constructor() {
    injectCSS()
    this.cfg = loadConfig()
    this.setupBroadcast()
    Promise.all([
      this.refreshBatchHistory(),
      this.refreshActionLib(),
      this.restoreSession(),
    ]).then(() => {
      this.restoreReady = true
      if (this.panels) this.refresh()
    })
  }

  mount(left: HTMLElement, panels: PipelinePanels): void {
    this.leftEl = left
    this.panels = panels

    // 进入时：若上游是 vehicle role 且有设定图，则同步到 designImage
    const upstream = globalState.get()
    if (globalState.getUpstreamRole() === 'vehicle' && upstream.characterImage && !this.img.designImage) {
      this.img.designImage = upstream.characterImage
      this.autoSave()
    }

    if (!this.img.designImage && this.cfg.activeStep !== 1) {
      this.cfg.activeStep = 1
      saveConfig(this.cfg)
    }

    this.renderLeft()
    this.renderCenter()
  }

  unmount(): void {
    this.stopAllGifs()
    this.cleanupSceneSprite()
    saveConfig(this.cfg)
    this.leftEl = null
    this.panels = null
  }

  dispose(): void {
    this.stopAllGifs()
    this.cleanupSceneSprite()
    saveConfig(this.cfg)
  }

  /* ── Left Panel ──────────────────────────────────────────────────── */

  private renderLeft(): void {
    if (!this.leftEl) return
    const scrollTop = this.leftEl.scrollTop
    const c = this.cfg
    const histCount = this.batchHistory.length

    this.leftEl.innerHTML = `
      <div class="vh-panel">
        <div class="vh-header">
          <span class="vh-header-title">载具动画工作台</span>
          <span class="vh-header-pill">载具动画</span>
        </div>

        <div class="vh-tab-bar">
          <button class="vh-tab-btn${c.leftTab === 'edit' ? ' active' : ''}" data-vh-tab="edit">编辑</button>
          <button class="vh-tab-btn${c.leftTab === 'lib' ? ' active' : ''}" data-vh-tab="lib">动作库${this.actionLib.length ? ` (${new Set(this.actionLib.map(e => e.animId)).size})` : ''}</button>
          <button class="vh-tab-btn${c.leftTab === 'history' ? ' active' : ''}" data-vh-tab="history">历史记录${histCount ? ` (${histCount})` : ''}</button>
        </div>

        <div class="vh-tab-body" data-vh="tab-body"></div>

        <div class="vh-progress" data-vh="gen-progress" style="display:none;">
          <div class="vh-progress-bar"><div class="vh-progress-fill"></div></div>
          <div class="vh-progress-text" data-vh="gen-text"></div>
        </div>
      </div>
    `

    this.leftEl.querySelectorAll<HTMLButtonElement>('[data-vh-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        c.leftTab = btn.dataset.vhTab as LeftTab
        saveConfig(c)
        this.renderLeft()
        this.renderCenter()
      })
    })

    const body = this.leftEl.querySelector('[data-vh="tab-body"]')
    if (!body) return

    if (c.leftTab === 'history') {
      body.innerHTML = this.renderHistoryTab()
      this.bindHistoryEvents()
    } else if (c.leftTab === 'lib') {
      this.renderLeftLibTab(body as HTMLElement)
    } else {
      body.innerHTML = this.renderEditTab()
      this.bindLeftEvents()
    }

    this.leftEl.scrollTop = scrollTop
  }

  private renderEditTab(): string {
    const c = this.cfg
    const cat = getCategory(c.categoryId)
    const vm = getViewMode(c.viewModeId)

    return `
      <div class="vh-section">
        <div class="vh-label">步骤</div>
        <div class="vh-steps">
          ${this.renderStepItem(1, 'views', '多视角参考', this.isStepDone(1))}
          ${this.renderStepItem(2, 'film', '动画生成', this.isStepDone(2))}
        </div>
      </div>
      ${!this.img.designImage ? `
      <div class="vh-section">
        <div class="vh-hint vh-warn" style="padding:8px;border-radius:6px;background:color-mix(in srgb, var(--color-status-error) 14%, transparent);color:var(--color-status-error);font-size:12px">
          提示：请先在「角色设计」工作台完成载具设定，生成设定图后点击「前往动画工作台」跳转到此处。
        </div>
      </div>` : ''}
      ${this.img.designImage ? `
      <div class="vh-section" style="text-align:center">
        <img src="${this.img.designImage}" style="max-width:100%;max-height:140px;border-radius:6px;border:1px solid var(--color-border-default)"/>
        <div style="font-size:11px;color:var(--color-text-tertiary);margin-top:4px">载具设定图（来自角色设计）</div>
      </div>` : ''}
      ${c.activeStep === 1 ? this.renderStep2Left(vm) : ''}
      ${c.activeStep === 2 ? this.renderStep3Left(cat) : ''}
    `
  }

  private renderHistoryTab(): string {
    if (this.batchHistory.length === 0) {
      return `
        <div class="vh-history-empty">
          <div class="vh-history-empty-icon">${vhIcon('box', 'vh-icon vh-empty-svg')}</div>
          <div class="vh-history-empty-text">暂无历史记录</div>
          <div class="vh-history-empty-hint">生成动画后会自动保存到历史记录</div>
        </div>`
    }

    let html = '<div class="vh-history-list">'
    for (const batch of this.batchHistory) {
      const cat = getCategory(batch.categoryId)
      const sub = getSubtype(batch.categoryId, batch.subtypeId)
      const style = VEHICLE_STYLES.find(s => s.id === batch.styleId)
      const animCount = batch.animations.length
      const ts = new Date(batch.createdAt).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })

      html += `
        <div class="vh-history-card" data-vh-batch="${batch.id}">
          <div class="vh-history-card-top">
            ${batch.thumbnailUrl
              ? `<img class="vh-history-thumb" src="${batch.thumbnailUrl}" alt="">`
              : `<div class="vh-history-thumb-placeholder">${cat?.icon || '🚗'}</div>`
            }
            <div class="vh-history-card-info">
              <div class="vh-history-card-title">${cat?.icon || ''} ${sub?.label || batch.subtypeId}</div>
              <div class="vh-history-card-meta">${style?.label || ''} · ${animCount}个动画</div>
              <div class="vh-history-card-time">${ts}</div>
            </div>
          </div>
          <div class="vh-history-card-actions">
            <button class="vh-btn-mini" data-vh-batch-view="${batch.id}">查看</button>
            <button class="vh-btn-mini" data-vh-batch-apply="${batch.id}">应用</button>
            <button class="vh-btn-mini danger" data-vh-batch-del="${batch.id}">删除</button>
          </div>
        </div>`
    }
    html += '</div>'
    return html
  }

  private bindHistoryEvents(): void {
    if (!this.leftEl) return

    this.leftEl.querySelectorAll<HTMLElement>('[data-vh-batch-view]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.viewingBatchId = btn.dataset.vhBatchView!
        this.renderCenterBatchDetail()
      })
    })

    this.leftEl.querySelectorAll<HTMLElement>('[data-vh-batch-apply]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const batchId = btn.dataset.vhBatchApply!
        const batch = this.batchHistory.find(b => b.id === batchId)
        if (!batch) return
        this.applyBatch(batch)
        this.toast('已应用历史记录到工作区')
      })
    })

    this.leftEl.querySelectorAll<HTMLElement>('[data-vh-batch-del]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const batchId = btn.dataset.vhBatchDel!
        await deleteBatch(batchId)
        await this.refreshBatchHistory()
        if (this.viewingBatchId === batchId) this.viewingBatchId = null
        this.renderLeft()
        this.renderCenter()
        this.toast('已删除')
      })
    })
  }

  private applyBatch(batch: VehicleBatchEntry): void {
    this.cfg.categoryId = batch.categoryId
    this.cfg.subtypeId = batch.subtypeId
    this.cfg.styleId = batch.styleId
    this.cfg.eraId = batch.eraId
    this.cfg.viewModeId = batch.viewModeId
    this.cfg.activeStep = 3
    this.cfg.leftTab = 'edit'

    if (batch.designImageUrl) this.img.designImage = batch.designImageUrl
    if (batch.viewsImageUrl) this.img.viewsImage = batch.viewsImageUrl

    for (const anim of batch.animations) {
      if (anim.sheetDataUrl) this.img.animSheets[anim.animId] = anim.sheetDataUrl
      if (anim.cleanSheetDataUrl) this.img.cleanSheets[anim.animId] = anim.cleanSheetDataUrl
      if (anim.views) this.img.splitFrames[anim.animId] = anim.views
    }

    this.cfg.selectedAnims = batch.animations.map(a => a.animId)
    saveConfig(this.cfg)
    this.refresh()
  }

  private renderCenterBatchDetail(): void {
    const center = this.panels?.center
    if (!center || !this.viewingBatchId) return
    this.stopAllGifs()

    const batch = this.batchHistory.find(b => b.id === this.viewingBatchId)
    if (!batch) {
      center.innerHTML = '<div class="vh-center"><div class="vh-empty">批次未找到</div></div>'
      return
    }

    const cat = getCategory(batch.categoryId)
    const sub = getSubtype(batch.categoryId, batch.subtypeId)

    let html = `<div class="vh-center">
      <div class="vh-center-head-bar">
        <button class="vh-btn small" data-vh="back-from-batch">← 返回</button>
        <div class="vh-center-title" style="flex:1">${cat?.icon || ''} ${sub?.label || batch.subtypeId} — ${batch.label}</div>
      </div>
      <div class="vh-anim-results" data-vh="anim-results">`

    for (const a of batch.animations) {
      const anim = getAnimation(a.animId)
      const viewCount = Object.keys(a.views).length
      const frameCount = Object.values(a.views).reduce((n, arr) => n + arr.length, 0)

      html += `<div class="vh-anim-card">
        <div class="vh-card-head">
          <span class="vh-card-name">${anim?.label || a.animLabel}</span>
          <span class="vh-card-meta">${anim?.framesPerView || '?'}帧 × ${viewCount}视角 = ${frameCount}帧</span>
        </div>`

      for (const [viewKey, frameUrls] of Object.entries(a.views)) {
        if (!frameUrls || frameUrls.length === 0) continue
        const label = VIEW_LABELS[viewKey as VehicleView] || viewKey
        html += `<div class="vh-dir-strip">
          <div class="vh-dir-strip-left">
            <span class="vh-dir-strip-name">${label}</span>
            <div class="vh-dir-strip-gif" data-vh-gif="batch:${a.animId}:${viewKey}"></div>
          </div>
          <div class="vh-dir-strip-frames">`
        for (let i = 0; i < frameUrls.length; i++) {
          html += `<div class="vh-frame-cell">
            <img src="${frameUrls[i]}" class="vh-frame-img" draggable="false" />
            <span class="vh-frame-idx">#${i + 1}</span>
          </div>`
        }
        html += `</div></div>`
      }
      html += `</div>`
    }

    html += `</div></div>`
    center.innerHTML = html
    center.classList.add('active')

    center.querySelector('[data-vh="back-from-batch"]')?.addEventListener('click', () => {
      this.viewingBatchId = null
      this.renderCenter()
    })

    for (const a of batch.animations) {
      const delay = Math.round(1000 / this.cfg.fps)
      const anim = getAnimation(a.animId)
      for (const [viewKey, frameUrls] of Object.entries(a.views)) {
        if (!frameUrls || frameUrls.length === 0) continue
        const el = center.querySelector(`[data-vh-gif="batch:${a.animId}:${viewKey}"]`) as HTMLElement
        if (!el) continue
        this.loadGifInto(el, frameUrls, delay, anim?.looping ?? true, `batch:${a.animId}:${viewKey}`)
      }
    }
  }

  private renderStepItem(step: Step, icon: string, label: string, done: boolean): string {
    const active = this.cfg.activeStep === step
    const cls = `vh-step${active ? ' active' : ''}${done ? ' done' : ''}`
    return `
      <div class="${cls}" data-vh-step="${step}">
        <div class="vh-step-head">
          <span class="vh-step-icon">${vhIcon(done ? 'target' : icon, 'vh-icon vh-step-svg')}</span>
          <span class="vh-step-label">${label}</span>
          ${done ? '<span class="vh-step-done">✓</span>' : ''}
        </div>
      </div>
    `
  }

  private renderStep1Left(
    cat: VehicleCategory | undefined,
    sub: VehicleSubtype | undefined,
    style: { id: string; label: string } | undefined,
    era: { id: string; label: string } | undefined,
  ): string {
    const c = this.cfg
    return `
      <div class="vh-section">
        <div class="vh-label">载具大类</div>
        <div class="vh-cat-grid">
          ${VEHICLE_CATEGORIES.map(ct => `
            <button class="vh-cat-card${ct.id === c.categoryId ? ' active' : ''}" data-vh-cat="${ct.id}">
              <span class="vh-cat-icon">${ct.icon}</span>
              <span class="vh-cat-name">${ct.label}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="vh-section">
        <div class="vh-label">子类型 <span class="vh-label-hint">${cat ? cat.label : ''}</span></div>
        <div class="vh-chip-wrap">
          ${(cat?.subtypes || []).map(st => `
            <button class="vh-chip${st.id === c.subtypeId ? ' active' : ''}" data-vh-sub="${st.id}">${st.label}</button>
          `).join('')}
        </div>
        ${isCustomSubtype(sub) ? `
          <div style="margin-top:8px;">
            <input class="vh-input" data-vh="custom-subtype"
                   placeholder="输入载具类型，如：装甲警用越野车 / cyberpunk pizza delivery bike"
                   value="${esc(c.customSubtype)}" />
            <div class="vh-hint" style="margin-top:4px;">提示：越具体越好。示例：「带机枪炮塔的武装吉普」「粉色霓虹灯蒸汽摩托车」</div>
          </div>
        ` : ''}
      </div>
      <div class="vh-section">
        <div class="vh-label">画面风格</div>
        <div class="vh-chip-wrap">
          ${VEHICLE_STYLES.map(s => `
            <button class="vh-chip${s.id === c.styleId ? ' active' : ''}" data-vh-style="${s.id}">${s.label}</button>
          `).join('')}
        </div>
      </div>
      <div class="vh-section">
        <div class="vh-label">时代背景</div>
        <div class="vh-chip-wrap">
          ${VEHICLE_ERAS.map(e => `
            <button class="vh-chip${e.id === c.eraId ? ' active' : ''}" data-vh-era="${e.id}">${e.label}</button>
          `).join('')}
        </div>
      </div>
      <div class="vh-section">
        <div class="vh-label">自定义描述 <span class="vh-label-hint">(可选)</span></div>
        <textarea class="vh-textarea" data-vh="user-desc" rows="3" placeholder="输入额外设计要求...">${esc(c.userDesc)}</textarea>
      </div>
      <div class="vh-section">
        <div class="vh-label">视角模式</div>
        <div class="vh-viewmode-list">
          ${VIEW_MODES.map(m => `
            <button class="vh-viewmode-card${m.id === c.viewModeId ? ' active' : ''}" data-vh-vm="${m.id}">
              <span class="vh-viewmode-icon">${vhIcon(({ 'four-dir': 'cross', 'topdown-plus': 'grid', 'side-only': 'side', 'isometric': 'diamond' } as Record<string,string>)[m.id] || 'views')}</span>
              <div class="vh-viewmode-info">
                <span class="vh-viewmode-name">${m.label}</span>
                <span class="vh-viewmode-desc">${m.description}</span>
              </div>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="vh-section" style="display:flex;flex-direction:column;gap:6px;">
        <button class="vh-btn primary vh-btn-xl" data-vh="gen-design-and-views">
          ${vhIcon('paint', 'vh-icon vh-btn-svg')}生成设定图 → 多视角 → 动画
        </button>
        ${this.img.designImage ? '<button class="vh-btn" data-vh="gen-design">仅重新生成设定图</button>' : ''}
      </div>
    `
  }

  private renderStep2Left(vm: ViewMode | undefined): string {
    const c = this.cfg
    const viewIcons: Record<string, string> = {
      'four-dir': 'cross',
      'topdown-plus': 'grid',
      'side-only': 'side',
      'isometric': 'diamond',
    }
    return `
      <div class="vh-section">
        <div class="vh-label">视角模式</div>
        <div class="vh-viewmode-list">
          ${VIEW_MODES.map(m => `
            <button class="vh-viewmode-card${m.id === c.viewModeId ? ' active' : ''}" data-vh-vm="${m.id}">
              <span class="vh-viewmode-icon">${vhIcon(viewIcons[m.id] || 'views')}</span>
              <div class="vh-viewmode-info">
                <span class="vh-viewmode-name">${m.label}</span>
                <span class="vh-viewmode-desc">${m.description}</span>
              </div>
            </button>
          `).join('')}
        </div>
        ${vm ? `<div class="vh-hint" style="margin-top:8px;">包含视角: ${vm.views.map(v => VIEW_LABELS[v]).join(' · ')}</div>` : ''}
      </div>
      <div class="vh-section">
        <button class="vh-btn primary" data-vh="gen-views" ${!this.img.designImage ? 'disabled' : ''}>
          ${this.img.viewsImage ? '重新生成视角图' : '生成多视角参考图'}
        </button>
        ${!this.img.designImage ? '<div class="vh-hint vh-warn">请先在「角色设计」工作台完成载具设定</div>' : ''}
      </div>
    `
  }

  private renderStep3Left(cat: VehicleCategory | undefined): string {
    const c = this.cfg
    const anims = getAnimationsForCategory(c.categoryId)
    const vm = getViewMode(c.viewModeId)
    const viewCount = vm?.views.length || 4
    const allSelected = anims.length > 0 && anims.every(a => c.selectedAnims.includes(a.id))

    const hasSplit = Object.keys(this.img.splitFrames).length > 0
    const hasAnyResult = c.selectedAnims.some(id =>
      this.img.splitFrames[id] && Object.keys(this.img.splitFrames[id]).length > 0,
    )
    const allHaveResult = hasAnyResult && c.selectedAnims.every(id =>
      this.img.splitFrames[id] && Object.keys(this.img.splitFrames[id]).length > 0,
    )

    const pipelineDesc = `一键完成：生成 → 去背景 → 拆帧预览`

    let buttonsHtml: string
    buttonsHtml = `<div class="vh-section" style="display:flex;flex-direction:column;gap:6px;">`
    buttonsHtml += `<button class="vh-btn primary" data-vh="gen-all" ${!this.img.viewsImage ? 'disabled' : ''}>
      ${vhIcon('film', 'vh-icon vh-btn-svg')}生成选中动画
    </button>`
    if (hasAnyResult && !allHaveResult) {
      buttonsHtml += `<button class="vh-btn" data-vh="gen-continue" ${!this.img.viewsImage ? 'disabled' : ''}>
        ▶ 继续生成未完成项
      </button>`
    }
    if (hasAnyResult) {
      buttonsHtml += `<button class="vh-btn-pill accent" data-vh="export-all">
        <span class="vh-btn-pill-icon">${vhIcon('upload', 'vh-icon')}</span> 导出全部 (ZIP)
      </button>`
    }
    buttonsHtml += `</div>`

    const frameSizeOptions = [
      { v: 0, l: '自动（取最大帧）' },
      { v: 32, l: '32×32' }, { v: 48, l: '48×48' }, { v: 64, l: '64×64' },
      { v: 96, l: '96×96' }, { v: 128, l: '128×128' }, { v: 256, l: '256×256' },
    ]

    const resultSummary = hasAnyResult
      ? c.selectedAnims
          .filter(id => this.img.splitFrames[id])
          .map(id => {
            const anim = getAnimation(id)
            const df = this.img.splitFrames[id]
            const vc = Object.keys(df).length
            const fc = Object.values(df).reduce((n, arr) => n + arr.length, 0)
            return `${anim?.label || id}: ${vc}视角 ${fc}帧`
          })
          .join('\n')
      : ''

    return `
      <div class="vh-section"><div class="vh-hint">${pipelineDesc}</div></div>

      <div class="vh-section">
        <div class="vh-label">帧对齐方式</div>
        <select class="vh-select" data-vh="align-mode">
          ${ALIGN_MODES.map(m =>
            `<option value="${m.id}"${c.alignMode === m.id ? ' selected' : ''}>${m.label} — ${m.desc}</option>`,
          ).join('')}
        </select>
        ${hasSplit ? '<button class="vh-btn" data-vh="realign" style="margin-top:4px;font-size:10px">应用新对齐方式</button>' : ''}
      </div>

      <div class="vh-section">
        <div class="vh-label">帧输出尺寸</div>
        <select class="vh-select" data-vh="frame-size">
          ${frameSizeOptions.map(o =>
            `<option value="${o.v}"${c.targetFrameSize === o.v ? ' selected' : ''}>${o.l}</option>`,
          ).join('')}
        </select>
      </div>

      <div class="vh-section">
        <div class="vh-label" style="display:flex;justify-content:space-between;align-items:center;">
          <span>选择动作</span>
          <button class="vh-btn-mini" data-vh="toggle-all">${allSelected ? '取消全选' : '全选'}</button>
        </div>
        <div class="vh-anim-list">
          ${anims.map(a => {
            const checked = c.selectedAnims.includes(a.id)
            const effectiveFrames = vm ? getEffectiveFrameCount(a, vm) : a.framesPerView
            const hasDone = !!(this.img.splitFrames[a.id] && Object.keys(this.img.splitFrames[a.id]).length > 0)
            return `
            <label class="vh-checkbox-row${hasDone ? ' done' : ''}">
              <input type="checkbox" data-vh-anim="${a.id}" ${checked ? 'checked' : ''}>
              <span class="vh-anim-name">${a.label}</span>
              <span class="vh-anim-detail">${effectiveFrames}帧×${viewCount}视角</span>
              ${hasDone ? '<span class="vh-anim-done">✓已生成</span>' : ''}
            </label>`
          }).join('')}
        </div>
      </div>

      ${buttonsHtml}

      ${resultSummary ? `<div class="vh-section"><div class="vh-result-summary">${resultSummary.split('\n').map(l => `<div>${l}</div>`).join('')}</div></div>` : ''}

      <div class="vh-section">
        <div class="vh-label">GIF 播放速度</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="range" class="vh-range" data-vh="fps" min="2" max="20" value="${c.fps}" style="flex:1;">
          <span class="vh-hint" data-vh="fps-val">${c.fps} fps</span>
        </div>
      </div>

      ${!this.img.viewsImage ? '<div class="vh-section"><div class="vh-hint vh-warn">请先完成「多视角参考」步骤</div></div>' : ''}
    `
  }

  /* ── Left event bindings ────────────────────────────────────────── */

  private bindLeftEvents(): void {
    if (!this.leftEl) return
    const c = this.cfg

    this.leftEl.querySelectorAll<HTMLElement>('[data-vh-step]').forEach(el => {
      el.addEventListener('click', () => {
        c.activeStep = Number(el.dataset.vhStep) as Step
        saveConfig(c)
        this.renderLeft()
        this.renderCenter()
      })
    })

    this.leftEl.querySelectorAll<HTMLElement>('[data-vh-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        c.categoryId = btn.dataset.vhCat!
        const cat = getCategory(c.categoryId)
        if (cat && cat.subtypes.length > 0) c.subtypeId = cat.subtypes[0].id
        c.selectedAnims = ['idle', 'move', 'fire', 'damaged']
          .filter(id => getAnimationsForCategory(c.categoryId).some(a => a.id === id))
        saveConfig(c)
        this.renderLeft()
      })
    })

    this.leftEl.querySelectorAll<HTMLElement>('[data-vh-sub]').forEach(btn => {
      btn.addEventListener('click', () => {
        c.subtypeId = btn.dataset.vhSub!
        saveConfig(c)
        this.renderLeft()
      })
    })

    this.leftEl.querySelectorAll<HTMLElement>('[data-vh-style]').forEach(btn => {
      btn.addEventListener('click', () => {
        c.styleId = btn.dataset.vhStyle!
        saveConfig(c)
        this.renderLeft()
      })
    })

    this.leftEl.querySelectorAll<HTMLElement>('[data-vh-era]').forEach(btn => {
      btn.addEventListener('click', () => {
        c.eraId = btn.dataset.vhEra!
        saveConfig(c)
        this.renderLeft()
      })
    })

    this.leftEl.querySelector('[data-vh="user-desc"]')?.addEventListener('input', (e) => {
      c.userDesc = (e.target as HTMLTextAreaElement).value
      saveConfig(c)
    })

    this.leftEl.querySelector('[data-vh="custom-subtype"]')?.addEventListener('input', (e) => {
      c.customSubtype = (e.target as HTMLInputElement).value
      saveConfig(c)
    })

    this.leftEl.querySelectorAll<HTMLElement>('[data-vh-vm]').forEach(btn => {
      btn.addEventListener('click', () => {
        c.viewModeId = btn.dataset.vhVm!
        saveConfig(c)
        this.renderLeft()
      })
    })

    this.leftEl.querySelector('[data-vh="gen-views"]')?.addEventListener('click', () => this.execStep2())
    this.leftEl.querySelector('[data-vh="gen-continue"]')?.addEventListener('click', () => this.execStep3(false))
    this.leftEl.querySelector('[data-vh="gen-all"]')?.addEventListener('click', () => this.execStep3(true))
    this.leftEl.querySelector('[data-vh="export-all"]')?.addEventListener('click', () => this.exportAll())

    this.leftEl.querySelectorAll<HTMLInputElement>('[data-vh-anim]').forEach(cb => {
      cb.addEventListener('change', () => {
        const id = cb.dataset.vhAnim!
        if (cb.checked) {
          if (!c.selectedAnims.includes(id)) c.selectedAnims.push(id)
        } else {
          c.selectedAnims = c.selectedAnims.filter(a => a !== id)
        }
        saveConfig(c)
      })
    })

    this.leftEl.querySelector('[data-vh="toggle-all"]')?.addEventListener('click', () => {
      const anims = getAnimationsForCategory(c.categoryId)
      const allSelected = anims.every(a => c.selectedAnims.includes(a.id))
      c.selectedAnims = allSelected ? [] : anims.map(a => a.id)
      saveConfig(c)
      this.renderLeft()
    })

    this.leftEl.querySelector('[data-vh="fps"]')?.addEventListener('input', (e) => {
      c.fps = Number((e.target as HTMLInputElement).value)
      const valEl = this.leftEl?.querySelector('[data-vh="fps-val"]')
      if (valEl) valEl.textContent = `${c.fps} fps`
      saveConfig(c)
    })

    this.leftEl.querySelector('[data-vh="align-mode"]')?.addEventListener('change', (e) => {
      c.alignMode = (e.target as HTMLSelectElement).value
      saveConfig(c)
    })

    this.leftEl.querySelector('[data-vh="frame-size"]')?.addEventListener('change', (e) => {
      c.targetFrameSize = Number((e.target as HTMLSelectElement).value)
      saveConfig(c)
    })

    this.leftEl.querySelector('[data-vh="realign"]')?.addEventListener('click', () => {
      this.realignAllFrames()
    })
  }

  /* ── Center Panel ────────────────────────────────────────────────── */

  private renderCenter(): void {
    const center = this.panels?.center
    if (!center) return
    this.stopAllGifs()
    center.classList.add('active')

    if (this.cfg.leftTab === 'history' && this.viewingBatchId) {
      this.renderCenterBatchDetail()
      return
    }

    switch (this.cfg.activeStep) {
      case 1: this.renderCenterStep1(center); break
      case 2: this.renderCenterStep2(center); break
      case 3: this.renderCenterStep3(center); break
    }
  }

  private renderCenterStep1(el: HTMLElement): void {
    if (this.img.designImage) {
      el.innerHTML = `
        <div class="vh-center">
          <div class="vh-center-title">载具设定图</div>
          <div class="vh-preview-wrap">
            <img class="vh-preview-img" src="${this.img.designImage}" alt="设定图">
          </div>
        </div>
      `
    } else {
      el.innerHTML = `
        <div class="vh-center">
          <div class="vh-empty">
            <div style="font-size:48px;margin-bottom:12px;">🚗</div>
            <div>选择载具类型和风格，然后点击「生成设定图」</div>
          </div>
        </div>
      `
    }
  }

  private renderCenterStep2(el: HTMLElement): void {
    if (this.img.viewsImage) {
      const vm = getViewMode(this.cfg.viewModeId)
      const splitViews = this.img.viewSplits
      const hasSplits = Object.keys(splitViews).length > 0

      el.innerHTML = `
        <div class="vh-center">
          <div class="vh-center-title">多视角参考图</div>
          <div class="vh-preview-wrap">
            <img class="vh-preview-img" src="${this.img.viewsImage}" alt="多视角参考">
          </div>
          ${hasSplits && vm ? `
            <div class="vh-center-title" style="margin-top:16px;">拆分视角</div>
            <div class="vh-view-grid">
              ${vm.views.map(v => splitViews[v] ? `
                <div class="vh-view-cell">
                  <img src="${splitViews[v]}" alt="${VIEW_LABELS[v]}">
                  <div class="vh-view-label">${VIEW_LABELS[v]}</div>
                </div>
              ` : '').join('')}
            </div>
          ` : ''}
        </div>
      `
    } else {
      el.innerHTML = `
        <div class="vh-center">
          <div class="vh-empty">
            <div style="margin-bottom:12px;">${vhIcon('views', 'vh-icon vh-empty-svg')}</div>
            <div>${this.img.designImage ? '选择视角模式，然后点击「生成多视角参考图」' : '请先在「角色设计」工作台完成载具设定'}</div>
          </div>
        </div>
      `
    }
  }

  private renderCenterStep3(el: HTMLElement): void {
    const hasResults = Object.keys(this.img.splitFrames).length > 0
      || Object.keys(this.img.animSheets).length > 0

    if (!hasResults) {
      el.innerHTML = `
        <div class="vh-center">
          <div class="vh-empty">
            <div style="margin-bottom:12px;">${vhIcon('film', 'vh-icon vh-empty-svg')}</div>
            <div>${this.img.viewsImage ? '选择动画状态，然后点击「继续生成」或「全部重新生成」' : '请先完成「多视角参考」步骤'}</div>
          </div>
        </div>
      `
      return
    }

    this.initCenterStep3()
    const animIds = [
      ...Object.keys(this.img.splitFrames),
      ...Object.keys(this.img.animSheets).filter(id => !this.img.splitFrames[id]),
    ]
    for (const id of animIds) this.appendAnimResult(id)
  }

  private initCenterStep3(): void {
    this.panels!.center.innerHTML = `
      <div class="vh-center">
        <div class="vh-center-title">动画帧预览</div>
        <div class="vh-anim-results" data-vh="anim-results"></div>
      </div>`
  }

  private appendAnimResult(animId: string): void {
    const container = this.panels?.center?.querySelector('[data-vh="anim-results"]')
    if (!container) return

    const existing = container.querySelector(`[data-vh-card="${animId}"]`)
    if (existing) existing.remove()

    this.stopGifsForAnim(animId)

    const anim = getAnimation(animId)
    const dirFrames = this.img.splitFrames[animId]
    const rawSheetUrl = this.img.animSheets[animId]
    const cleanSheetUrl = this.img.cleanSheets[animId]

    let html = `<div class="vh-anim-card" data-vh-card="${animId}">`
    html += `<div class="vh-card-head">`
    html += `<span class="vh-card-name">${anim?.label || animId}</span>`

    if (dirFrames) {
      const viewCount = Object.keys(dirFrames).length
      const frameCount = Object.values(dirFrames).reduce((n, arr) => n + arr.length, 0)
      const vm = getViewMode(this.cfg.viewModeId)
      const effectiveFrames = anim && vm ? getEffectiveFrameCount(anim, vm) : anim?.framesPerView || '?'
      html += `<span class="vh-card-meta">${effectiveFrames}帧 × ${viewCount}视角 = ${frameCount}帧</span>`
    } else {
      html += `<span class="vh-card-meta">⏳ 处理中...</span>`
    }
    html += `</div>`

    const storedPrompts = this.img.animPrompts[animId] || {}
    const promptViews = Object.keys(storedPrompts)
    if (rawSheetUrl || cleanSheetUrl || promptViews.length > 0) {
      html += `<details class="vh-sheet-toggle"><summary>▶ 原始 Sheet 与 Prompt（点击展开，可编辑后重生成）</summary>`
      html += `<div class="vh-sheet-prompt-row">`
      html += `<div class="vh-sheet-col">`
      if (rawSheetUrl) {
        html += `<div class="vh-sheet-label">AI 原始输出（绿底）</div><img class="vh-preview-img vh-sheet-img" src="${rawSheetUrl}" alt="raw sheet">`
      }
      if (cleanSheetUrl) {
        html += `<div class="vh-sheet-label">去背景后</div><img class="vh-preview-img vh-sheet-img" src="${cleanSheetUrl}" alt="clean sheet">`
      }
      html += `</div>`
      if (promptViews.length > 0) {
        html += `<div class="vh-prompt-col">`
        html += `<div class="vh-sheet-label">提示词（每视角 1 个 · 可修改后重生成）</div>`
        html += `<div class="vh-prompt-tabs" data-vh-prompt-tabs="${animId}">`
        promptViews.forEach((v, idx) => {
          const label = VIEW_LABELS[v as VehicleView] || v
          html += `<button type="button" class="vh-prompt-tab${idx === 0 ? ' active' : ''}" data-vh-prompt-tab="${animId}:${v}">${label}</button>`
        })
        html += `</div>`
        promptViews.forEach((v, idx) => {
          const content = storedPrompts[v] || ''
          html += `<textarea class="vh-prompt-textarea" data-vh-prompt-text="${animId}:${v}" spellcheck="false"${idx === 0 ? '' : ' hidden'}>${esc(content)}</textarea>`
        })
        html += `<div class="vh-prompt-actions">`
        html += `<button class="vh-btn small" data-vh-regen-prompt="${animId}">${vhIcon('refresh', 'vh-icon')} 用当前提示词重生成</button>`
        html += `<button class="vh-btn small" data-vh-reset-prompt="${animId}" title="恢复默认模板生成的提示词">↺ 恢复默认</button>`
        html += `</div></div>`
      }
      html += `</div></details>`
    }

    if (dirFrames) {
      for (const [viewKey, frameUrls] of Object.entries(dirFrames)) {
        if (!frameUrls || frameUrls.length === 0) continue
        const label = VIEW_LABELS[viewKey as VehicleView] || viewKey
        html += `<div class="vh-dir-strip">`
        html += `<div class="vh-dir-strip-left">`
        html += `<span class="vh-dir-strip-name">${label}</span>`
        html += `<div class="vh-dir-strip-gif" data-vh-gif="${animId}:${viewKey}"></div>`
        html += `</div>`
        html += `<div class="vh-dir-strip-frames">`
        for (let i = 0; i < frameUrls.length; i++) {
          const fkey = `${animId}:${viewKey}:${i}`
          html += `<div class="vh-frame-cell" data-vh-frame="${fkey}">
            <div class="vh-frame-drag-zone" data-vh-drag="${fkey}" title="拖拽移动位置">
              <img src="${frameUrls[i]}" class="vh-frame-img" draggable="false" />
            </div>
            <span class="vh-frame-idx">#${i + 1}</span>
            <div class="vh-frame-ops">
              <button class="vh-btn tiny" data-vh-replace="${fkey}" title="上传替换">↻</button>
              <button class="vh-btn tiny" data-vh-copy="${fkey}" title="从其他帧复制">📋</button>
              <button class="vh-btn tiny" data-vh-flip="${fkey}" title="左右翻转">↔</button>
              <button class="vh-btn tiny" data-vh-autocenter="${fkey}" title="自动居中">⊙</button>
            </div>
          </div>`
        }
        html += `</div></div>`
      }

      html += `<div class="vh-card-footer">`
      html += `<button class="vh-btn small" data-vh-regen="${animId}">${vhIcon('refresh', 'vh-icon')} 重新生成</button>`
      html += `<button class="vh-btn small" data-vh-center-all="${animId}">⊙ 全部居中</button>`
      html += `<button class="vh-btn small" data-vh-add-lib="${animId}" title="把此动画加入动作库以便调缩放和放入场景">${vhIcon('box', 'vh-icon')} 加入动作库</button>`
      html += `<button class="vh-btn small" data-vh-export-one="${animId}">${vhIcon('upload', 'vh-icon')} 导出</button>`
      html += `</div>`
    }

    html += `</div>`

    const tmp = document.createElement('div')
    tmp.innerHTML = html
    const card = tmp.firstElementChild!
    container.appendChild(card)

    card.querySelector(`[data-vh-regen="${animId}"]`)?.addEventListener('click', () => {
      this.regenSingleAnim(animId)
    })

    card.querySelectorAll<HTMLButtonElement>(`[data-vh-prompt-tab^="${animId}:"]`).forEach(btn => {
      btn.addEventListener('click', () => {
        const [, view] = btn.dataset.vhPromptTab!.split(':')
        card.querySelectorAll<HTMLButtonElement>(`[data-vh-prompt-tab^="${animId}:"]`).forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        card.querySelectorAll<HTMLTextAreaElement>(`[data-vh-prompt-text^="${animId}:"]`).forEach(t => {
          t.hidden = t.dataset.vhPromptText !== `${animId}:${view}`
        })
      })
    })

    card.querySelector(`[data-vh-regen-prompt="${animId}"]`)?.addEventListener('click', () => {
      const edited: Record<string, string> = {}
      card.querySelectorAll<HTMLTextAreaElement>(`[data-vh-prompt-text^="${animId}:"]`).forEach(t => {
        const [, view] = t.dataset.vhPromptText!.split(':')
        edited[view] = t.value
      })
      this.img.animPrompts[animId] = edited
      this.regenSingleAnim(animId)
    })

    card.querySelector(`[data-vh-reset-prompt="${animId}"]`)?.addEventListener('click', () => {
      delete this.img.animPrompts[animId]
      this.appendAnimResult(animId)
    })

    card.querySelector(`[data-vh-center-all="${animId}"]`)?.addEventListener('click', () => {
      this.autoCenterAnim(animId)
    })

    card.querySelector(`[data-vh-export-one="${animId}"]`)?.addEventListener('click', () => {
      this.exportSingle(animId)
    })

    card.querySelector(`[data-vh-add-lib="${animId}"]`)?.addEventListener('click', (ev) => {
      ev.stopPropagation()
      void this.saveOneAnimToLib(animId)
    })

    card.querySelectorAll<HTMLButtonElement>('[data-vh-replace]').forEach(btn => {
      const [aid, view, idx] = btn.dataset.vhReplace!.split(':')
      btn.addEventListener('click', () => this.replaceFrame(aid, view, parseInt(idx)))
    })

    card.querySelectorAll<HTMLButtonElement>('[data-vh-copy]').forEach(btn => {
      const [aid, view, idx] = btn.dataset.vhCopy!.split(':')
      btn.addEventListener('click', () => this.copyFrameFrom(aid, view, parseInt(idx)))
    })

    card.querySelectorAll<HTMLButtonElement>('[data-vh-flip]').forEach(btn => {
      const [aid, view, idx] = btn.dataset.vhFlip!.split(':')
      btn.addEventListener('click', () => this.flipFrame(aid, view, parseInt(idx)))
    })

    card.querySelectorAll<HTMLButtonElement>('[data-vh-autocenter]').forEach(btn => {
      const [aid, view, idx] = btn.dataset.vhAutocenter!.split(':')
      btn.addEventListener('click', () => this.autoCenterFrame(aid, view, parseInt(idx)))
    })

    card.querySelectorAll<HTMLElement>('[data-vh-drag]').forEach(zone => {
      this.bindFrameDrag(zone)
    })

    this.createGifPreviewsForAnim(animId)
  }

  private createGifPreviewsForAnim(animId: string): void {
    const anim = getAnimation(animId)
    const dirFrames = this.img.splitFrames[animId]
    if (!anim || !dirFrames) return

    const delay = Math.round(1000 / this.cfg.fps)

    for (const [viewKey, frameUrls] of Object.entries(dirFrames)) {
      if (!frameUrls || frameUrls.length === 0) continue
      const el = this.panels?.center?.querySelector(`[data-vh-gif="${animId}:${viewKey}"]`) as HTMLElement
      if (!el) continue
      this.loadGifInto(el, frameUrls, delay, anim.looping, `${animId}:${viewKey}`)
    }
  }

  private loadGifInto(el: HTMLElement, frameUrls: string[], delay: number, looping: boolean, handleKey: string): void {
    const canvases: HTMLCanvasElement[] = new Array(frameUrls.length)
    let loaded = 0
    frameUrls.forEach((url, idx) => {
      const imgEl = new Image()
      imgEl.onload = () => {
        const cv = document.createElement('canvas')
        cv.width = imgEl.width; cv.height = imgEl.height
        cv.getContext('2d')!.drawImage(imgEl, 0, 0)
        canvases[idx] = cv
        loaded++
        if (loaded === frameUrls.length) {
          const handle = createGifPreview(canvases.filter(Boolean), {
            delay,
            pingPong: looping,
            holdLastFrameMs: 0,
          })
          handle.canvas.className = 'vh-gif-canvas'
          el.textContent = ''
          el.appendChild(handle.canvas)

          const arr = this.gifHandles.get(handleKey) || []
          arr.push(handle)
          this.gifHandles.set(handleKey, arr)
        }
      }
      imgEl.src = url
    })
  }

  private stopGifsForAnim(animId: string): void {
    for (const [key, handles] of this.gifHandles) {
      if (key === animId || key.startsWith(animId + ':')) {
        handles.forEach(h => h.stop())
        this.gifHandles.delete(key)
      }
    }
  }

  /* ── Per-frame micro-adjustment tools ────────────────────────── */

  private replaceFrame(animId: string, viewKey: string, idx: number): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        if (this.img.splitFrames[animId]?.[viewKey]) {
          this.img.splitFrames[animId][viewKey][idx] = dataUrl
          this.appendAnimResult(animId)
          this.autoSave()
          this.toast('帧已替换')
        }
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  private copyFrameFrom(animId: string, viewKey: string, idx: number): void {
    const dirFrames = this.img.splitFrames[animId]
    if (!dirFrames) return

    const allFrames: { label: string; view: string; idx: number }[] = []
    for (const [v, frames] of Object.entries(dirFrames)) {
      for (let i = 0; i < frames.length; i++) {
        if (v === viewKey && i === idx) continue
        allFrames.push({ label: `${VIEW_LABELS[v as VehicleView] || v} #${i + 1}`, view: v, idx: i })
      }
    }
    if (allFrames.length === 0) { this.toast('无可选帧'); return }

    const dialog = document.createElement('div')
    dialog.className = 'vh-copy-dialog'
    dialog.innerHTML = `
      <div class="vh-copy-dialog-inner">
        <div class="vh-copy-dialog-title">选择来源帧</div>
        <div class="vh-copy-dialog-list">
          ${allFrames.map((f, i) => `<button class="vh-btn small" data-copy-src="${i}">${f.label}</button>`).join('')}
        </div>
        <button class="vh-btn small" data-copy-cancel>取消</button>
      </div>`

    dialog.querySelector('[data-copy-cancel]')?.addEventListener('click', () => dialog.remove())
    dialog.querySelectorAll<HTMLButtonElement>('[data-copy-src]').forEach(btn => {
      btn.addEventListener('click', () => {
        const src = allFrames[parseInt(btn.dataset.copySrc!)]
        this.img.splitFrames[animId][viewKey][idx] = dirFrames[src.view][src.idx]
        this.appendAnimResult(animId)
        dialog.remove()
        this.autoSave()
        this.toast('帧已复制')
      })
    })

    document.body.appendChild(dialog)
  }

  private flipFrame(animId: string, viewKey: string, idx: number): void {
    const frames = this.img.splitFrames[animId]?.[viewKey]
    if (!frames || !frames[idx]) return

    const imgEl = new Image()
    imgEl.onload = () => {
      const c = document.createElement('canvas')
      c.width = imgEl.width; c.height = imgEl.height
      const ctx = c.getContext('2d')!
      ctx.translate(c.width, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(imgEl, 0, 0)
      frames[idx] = c.toDataURL('image/png')

      const cell = this.panels?.center?.querySelector(`[data-vh-frame="${animId}:${viewKey}:${idx}"]`)
      const img = cell?.querySelector('.vh-frame-img') as HTMLImageElement | null
      if (img) img.src = frames[idx]

      this.createGifPreviewsForAnim(animId)
      this.autoSave()
      this.toast('帧已翻转')
    }
    imgEl.src = frames[idx]
  }

  private autoCenterFrame(animId: string, viewKey: string, idx: number): void {
    const frames = this.img.splitFrames[animId]?.[viewKey]
    if (!frames || !frames[idx]) return

    const imgEl = new Image()
    imgEl.onload = () => {
      const src = document.createElement('canvas')
      src.width = imgEl.width; src.height = imgEl.height
      const srcCtx = src.getContext('2d')!
      srcCtx.drawImage(imgEl, 0, 0)

      const d = srcCtx.getImageData(0, 0, src.width, src.height).data
      let minX = src.width, maxX = 0, minY = src.height, maxY = 0
      for (let y = 0; y < src.height; y++) {
        for (let x = 0; x < src.width; x++) {
          if (d[(y * src.width + x) * 4 + 3] > 10) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX < minX) return

      const contentCx = (minX + maxX) / 2
      const contentCy = (minY + maxY) / 2
      const dx = Math.round(src.width / 2 - contentCx)
      const dy = Math.round(src.height / 2 - contentCy)

      if (dx === 0 && dy === 0) { this.toast('已经居中'); return }

      const out = document.createElement('canvas')
      out.width = src.width; out.height = src.height
      out.getContext('2d')!.drawImage(src, dx, dy)
      frames[idx] = out.toDataURL('image/png')

      const cell = this.panels?.center?.querySelector(`[data-vh-frame="${animId}:${viewKey}:${idx}"]`)
      const img = cell?.querySelector('.vh-frame-img') as HTMLImageElement | null
      if (img) img.src = frames[idx]

      this.createGifPreviewsForAnim(animId)
      this.autoSave()
      this.toast('已居中')
    }
    imgEl.src = frames[idx]
  }

  private autoCenterAnim(animId: string): void {
    const dirFrames = this.img.splitFrames[animId]
    if (!dirFrames) return

    for (const viewKey of Object.keys(dirFrames)) {
      const frames = dirFrames[viewKey]
      for (let i = 0; i < frames.length; i++) {
        this.autoCenterFrame(animId, viewKey, i)
      }
    }
    this.toast(`${getAnimation(animId)?.label || animId} 全部帧已居中`)
  }

  private async realignAllFrames(): Promise<void> {
    if (this.generating) { this.toast('正在生成中，请稍后'); return }
    const splitIds = Object.keys(this.img.splitFrames)
    if (splitIds.length === 0) { this.toast('无可重新对齐的帧'); return }

    this.generating = true
    this.showProgress(true, '重新对齐...')

    let done = 0
    for (const actionId of splitIds) {
      const dirUrls = this.img.splitFrames[actionId]
      if (!dirUrls) continue

      try {
        const rawCanvasFrames: Record<string, HTMLCanvasElement[]> = {}
        for (const [viewKey, urls] of Object.entries(dirUrls)) {
          const canvases: HTMLCanvasElement[] = []
          for (const url of urls) {
            const img = await loadImageElement(url)
            const cv = document.createElement('canvas')
            cv.width = img.width; cv.height = img.height
            cv.getContext('2d')!.drawImage(img, 0, 0)
            canvases.push(cv)
          }
          rawCanvasFrames[viewKey] = canvases
        }

        const unified = unifyActionFrames(rawCanvasFrames, this.cfg.alignMode || 'waist')
        const result: Record<string, string[]> = {}
        for (const [viewKey, frames] of Object.entries(unified)) {
          result[viewKey] = canvasArrayToDataUrls(autoCenterCanvases(frames))
        }

        if (this.cfg.targetFrameSize > 0) {
          this.img.splitFrames[actionId] = await normalizeFrameSize(result, this.cfg.targetFrameSize)
        } else {
          this.img.splitFrames[actionId] = result
        }
        done++
      } catch (e: any) {
        console.warn(`[Vehicle] realign failed ${actionId}:`, e)
      }
    }

    if (done > 0 && this.cfg.targetFrameSize === 0) {
      const maxSize = getMaxFrameSize(this.img.splitFrames)
      if (maxSize > 0) await normalizeAllActions(this.img.splitFrames, maxSize)
    }

    this.generating = false
    this.showProgress(false)
    this.autoSave()
    const modeLabel = ALIGN_MODES.find(m => m.id === this.cfg.alignMode)?.label || this.cfg.alignMode
    this.toast(`${done} 个动作已按「${modeLabel}」重新对齐`)
    this.refresh()
  }

  private bindFrameDrag(zone: HTMLElement): void {
    const key = zone.dataset.vhDrag!
    const [animId, viewKey, idxStr] = key.split(':')
    const idx = parseInt(idxStr)

    let startX = 0, startY = 0
    let dragging = false

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return
      const dx = e.clientX - startX
      const dy = e.clientY - startY
      const imgEl = zone.querySelector('.vh-frame-img') as HTMLImageElement | null
      if (imgEl) imgEl.style.transform = `translate(${dx}px, ${dy}px)`
    }

    const onMouseUp = (e: MouseEvent) => {
      if (!dragging) return
      dragging = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      zone.classList.remove('dragging')

      const dx = e.clientX - startX
      const dy = e.clientY - startY
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return

      const imgEl = zone.querySelector('.vh-frame-img') as HTMLImageElement | null
      if (imgEl) imgEl.style.transform = ''

      this.applyFrameShift(animId, viewKey, idx, dx, dy)
    }

    zone.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault()
      startX = e.clientX; startY = e.clientY
      dragging = true
      zone.classList.add('dragging')
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    })
  }

  private applyFrameShift(animId: string, viewKey: string, idx: number, dx: number, dy: number): void {
    const frames = this.img.splitFrames[animId]?.[viewKey]
    if (!frames || !frames[idx]) return

    const imgEl = new Image()
    imgEl.onload = () => {
      const c = document.createElement('canvas')
      c.width = imgEl.width; c.height = imgEl.height
      c.getContext('2d')!.drawImage(imgEl, dx, dy)
      frames[idx] = c.toDataURL('image/png')

      const cell = this.panels?.center?.querySelector(`[data-vh-frame="${animId}:${viewKey}:${idx}"]`)
      const img = cell?.querySelector('.vh-frame-img') as HTMLImageElement | null
      if (img) img.src = frames[idx]

      this.createGifPreviewsForAnim(animId)
      this.autoSave()
    }
    imgEl.src = frames[idx]
  }

  private regenSingleAnim(animId: string): void {
    if (this.generating) {
      this.regenQueue.push({ animId })
      this.toast(`已加入队列: ${getAnimation(animId)?.label || animId}`)
      return
    }
    const saved = [...this.cfg.selectedAnims]
    this.cfg.selectedAnims = [animId]
    this.execStep3(true).then(() => {
      this.cfg.selectedAnims = saved
      saveConfig(this.cfg)
    })
  }

  /* ── Step 1: Design Sheet ───────────────────────────────────────── */

  private async execStep1(): Promise<void> {
    if (this.generating) return
    this.generating = true
    this.showProgress(true, '正在生成载具设定图...')

    try {
      const c = this.cfg
      const cat = getCategory(c.categoryId)
      const sub = getSubtype(c.categoryId, c.subtypeId)
      const style = VEHICLE_STYLES.find(s => s.id === c.styleId)
      const era = VEHICLE_ERAS.find(e => e.id === c.eraId)
      const subject = resolveSubjectPrompt(cat, sub, c.customSubtype, c.subtypeId)

      const rawPrompt = generateDesignPrompt(
        subject,
        era?.prompt || c.eraId,
        style?.prompt || c.styleId,
        c.userDesc,
      )
      const prompt = adaptPromptForImageModel(rawPrompt, globalState.getImageModel())

      // 上游若是「载具」设定图(用户在角色设计里选了载具并生成了设定图,
      // 经 active-character 指针交接到这条管线),就把它作为参考图喂进去,让动画
      // 设定图延续用户已确定的载具外形/配色,而不是凭文字另画一台。
      //
      // 关键约束:只有 upstreamRole === 'vehicle' 时才挂参考图。早期 bug 是无条件
      // 挂 globalState.characterImage,把角色(hero/npc)的色板/剪影翻译到了载具上
      // (「战士的警车」),所以这里严格按 role 闸门,角色图绝不污染载具。
      const upstreamIsVehicle = globalState.getUpstreamRole() === 'vehicle'
      const upstreamVehicleImage = upstreamIsVehicle ? globalState.get().characterImage : null

      const body: Record<string, unknown> = {
        prompt,
        aspectRatio: '1:1',
        model: apiModelIdForImageModel(globalState.getImageModel()),
      }
      if (upstreamVehicleImage) {
        body.inputImageBase64 = upstreamVehicleImage.replace(/^data:[^;]+;base64,/, '')
        this.showProgress(true, '正在基于你的载具设定图生成多视角参考...')
      }

      const result = await apiPost('/__ce-api__/generate-image', body)

      if (result.success && result.imageBase64) {
        this.img.designImage = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`
        this.toast('设定图完成，自动进入视角生成')
        this.autoSave()
        this.cfg.activeStep = 2
        saveConfig(this.cfg)
        this.generating = false
        this.showProgress(false)
        this.refresh()
        return
      } else {
        this.toast('生成失败: ' + (result.error || result.message || '未知错误'))
      }
    } catch (e: any) {
      this.toast('请求失败: ' + e.message)
    }

    this.generating = false
    this.showProgress(false)
  }

  /* ── Step 2: Multi-view Reference ───────────────────────────────── */

  private async execStep2(): Promise<void> {
    if (this.generating) return
    if (!this.img.designImage) { this.toast('请先生成设定图'); return }

    this.generating = true
    this.showProgress(true, '正在生成多视角参考图...')

    try {
      const c = this.cfg
      const vm = getViewMode(c.viewModeId)!
      const style = VEHICLE_STYLES.find(s => s.id === c.styleId)
      const cat = getCategory(c.categoryId)
      const sub = getSubtype(c.categoryId, c.subtypeId)
      const subject = resolveSubjectPrompt(cat, sub, c.customSubtype, c.subtypeId)

      const rawPrompt = generateViewsPrompt(
        vm,
        style?.prompt || '',
        subject,
      )
      const prompt = adaptPromptForImageModel(rawPrompt, globalState.getImageModel())

      const base64 = await compressRefImage(this.img.designImage, 1200)
      const viewCount = vm.views.length
      const isWide = viewCount <= 2
      const aspect = nearestGeminiRatio(isWide ? viewCount : 2, isWide ? 1 : 2)

      const result = await apiPost('/__ce-api__/generate-image', {
        prompt,
        inputImageBase64: base64,
        aspectRatio: aspect,
        model: apiModelIdForImageModel(globalState.getImageModel()),
      })

      if (result.success && result.imageBase64) {
        this.img.viewsImage = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`

        this.showProgress(true, '拆分视角...')
        try {
          this.img.viewSplits = await splitVehicleViews(this.img.viewsImage, vm)
        } catch (e) {
          console.warn('[Vehicle] view split failed:', e)
        }

        this.toast('视角图完成，自动进入动画生成')
        this.autoSave()
        this.cfg.activeStep = 2
        saveConfig(this.cfg)
        this.generating = false
        this.showProgress(false)
        this.refresh()
        return
      } else {
        this.toast('生成失败: ' + (result.error || result.message || '未知错误'))
      }
    } catch (e: any) {
      this.toast('请求失败: ' + e.message)
    }

    this.generating = false
    this.showProgress(false)
  }

  /* ── Full Pipeline (Step 1 → 2 chained) ─────────────────────────── */

  private async execFullPipeline(): Promise<void> {
    if (this.generating) return
    if (!this.img.designImage) { this.toast('请先在「角色设计」工作台完成载具设定并跳转到此处'); return }

    this.cfg.activeStep = 1
    saveConfig(this.cfg)
    this.renderLeft()
    this.renderCenter()

    await this.execStep2()
    if (!this.img.viewsImage) return

    await this.execStep3(true)
  }

  /* ── Step 3: Animation Pipeline ─────────────────────────────────── */

  private async execStep3(forceAll = false): Promise<void> {
    if (this.generating) {
      this.toast('正在生成中，请等待完成')
      return
    }
    const c = this.cfg
    const img = this.img

    if (!img.viewsImage) { this.toast('请先完成多视角参考图'); return }
    if (c.selectedAnims.length === 0) { this.toast('请至少勾选一个动画状态'); return }

    this.generating = true

    const pendingAnims: string[] = []
    const skippedAnims: string[] = []

    if (forceAll) {
      for (const id of c.selectedAnims) {
        delete img.animSheets[id]
        delete img.cleanSheets[id]
        delete img.splitFrames[id]
        pendingAnims.push(id)
      }
      this.toast(`全部重新生成 ${pendingAnims.length} 个动画`)
    } else {
      for (const id of c.selectedAnims) {
        const hasSplitFrames = img.splitFrames[id] && Object.keys(img.splitFrames[id]).length > 0
        if (hasSplitFrames) {
          skippedAnims.push(id)
        } else {
          delete img.animSheets[id]
          delete img.cleanSheets[id]
          delete img.splitFrames[id]
          pendingAnims.push(id)
        }
      }

      if (skippedAnims.length > 0 && pendingAnims.length > 0) {
        const labels = skippedAnims.map(id => getAnimation(id)?.label || id).join('、')
        this.toast(`跳过已有结果: ${labels}，继续生成剩余 ${pendingAnims.length} 个`)
      }

      if (pendingAnims.length === 0) {
        this.toast('所有动画已有结果，点击「全部重新生成」可重新生成', 4000)
        this.generating = false
        return
      }
    }

    const vm = getViewMode(c.viewModeId)!
    const style = VEHICLE_STYLES.find(s => s.id === c.styleId)
    const cat = getCategory(c.categoryId)
    const sub = getSubtype(c.categoryId, c.subtypeId)
    const subject = resolveSubjectPrompt(cat, sub, c.customSubtype, c.subtypeId)

    this.panels!.center.classList.add('active')
    this.initCenterStep3()

    const total = pendingAnims.length
    let done = 0

    const refBase64 = await compressRefImage(img.viewsImage!, 1200)

    const uniqueViews = getUniqueViews(vm)
    const mirrorMap = getMirrorMap(vm)

    for (const animId of pendingAnims) {
      const anim = getAnimation(animId)
      if (!anim) continue

      if (done > 0) await sleep(1500)

      // 1. Generate sprite sheet — per-view (single-row) then stitch.
      // AI is much more reliable with "N frames in one row" than "N cols × M rows grid",
      // so we call once per unique view and stack the strips vertically ourselves.
      const cols = getEffectiveFrameCount(anim, vm)
      const stripAspect = nearestGeminiRatio(cols, 1)
      const MAX_RETRIES = 2
      const viewStrips: string[] = []
      let allViewsOk = true

      const savedPrompts = this.img.animPrompts[animId] || {}
      const usedPrompts: Record<string, string> = {}

      for (let vi = 0; vi < uniqueViews.length; vi++) {
        const view = uniqueViews[vi]
        this.showProgress(true,
          `[1/5 生成 ${anim.label}] 视角 ${vi + 1}/${uniqueViews.length} (${done + 1}/${total})`)

        let stripDataUrl: string | null = null
        const rawPrompt = savedPrompts[view] || generateSingleViewAnimPrompt(
          anim, view, vm,
          style?.prompt || '',
          subject,
        )
        const prompt = adaptPromptForImageModel(rawPrompt, globalState.getImageModel())
        usedPrompts[view] = rawPrompt
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          try {
            if (attempt > 0) {
              await sleep(1500)
              this.showProgress(true,
                `[1/5 重试 ${attempt}/${MAX_RETRIES}] ${anim.label} 视角 ${vi + 1}/${uniqueViews.length}`)
            }
            const result = await apiPost('/__ce-api__/generate-image', {
              prompt,
              inputImageBase64: refBase64,
              aspectRatio: stripAspect,
              model: apiModelIdForImageModel(globalState.getImageModel()),
            })
            if (result.success && result.imageBase64) {
              stripDataUrl = `data:${result.mimeType || 'image/png'};base64,${result.imageBase64}`
              break
            } else {
              const errMsg = result.error || '未知错误'
              console.warn(`[Vehicle] ${anim.label}/${view} attempt ${attempt + 1} failed: ${errMsg}`)
              if (attempt === MAX_RETRIES) {
                this.toast(`${anim.label} (${view}) 生成失败: ${errMsg}`)
              }
            }
          } catch (e: any) {
            console.error(`[Vehicle] gen failed ${animId}/${view} attempt ${attempt + 1}:`, e)
            if (attempt === MAX_RETRIES) {
              this.toast(`${anim.label} (${view}) 生成失败: ${e.message}`)
            }
          }
        }
        if (!stripDataUrl) { allViewsOk = false; break }
        viewStrips.push(stripDataUrl)
        if (vi < uniqueViews.length - 1) await sleep(800)
      }

      if (!allViewsOk) continue

      try {
        const stitched = await stitchStripsVertically(viewStrips)
        img.animSheets[animId] = stitched
        img.animPrompts[animId] = usedPrompts
      } catch (e: any) {
        console.error(`[Vehicle] stitch failed ${animId}:`, e)
        this.toast(`${anim.label} 拼接失败: ${e.message}`)
        continue
      }
      done++

      // 2. Validate grid (using unique views only)
      let dataUrl = img.animSheets[animId]
      if (dataUrl) {
        try {
          const action = buildVehicleAction(anim, vm, uniqueViews)
          const validation = await validateSheetGrid(dataUrl, action.framesPerDir, action.directions.length)
          if (!validation.valid) {
            console.warn(`[Vehicle] Grid mismatch for ${animId}:`, validation.warning)
            this.toast(`⚠️ ${anim.label}: ${validation.warning}`)
          }
        } catch (e) {
          console.warn(`[Vehicle] Grid validation failed for ${animId}:`, e)
        }
      }

      // 3. Expand green background (skip if factor <= 1)
      const factor = anim.expandFactor ?? 1
      if (dataUrl && factor > 1) {
        this.showProgress(true, `[2/5 扩图 ×${factor}] ${anim.label}`)
        try {
          const el = await loadImageElement(dataUrl)
          const srcCanvas = document.createElement('canvas')
          srcCanvas.width = el.naturalWidth
          srcCanvas.height = el.naturalHeight
          srcCanvas.getContext('2d')!.drawImage(el, 0, 0)
          const action = buildVehicleAction(anim, vm, uniqueViews)
          const expanded = expandGreenBackground(
            srcCanvas, action.framesPerDir, action.directions.length, factor,
          )
          dataUrl = expanded.toDataURL('image/png')
          img.animSheets[animId] = dataUrl
        } catch (e: any) {
          console.warn(`[Vehicle] expand failed ${animId}:`, e)
        }
      }

      // 4. Background removal
      if (dataUrl) {
        this.showProgress(true, `[3/5 去背景] ${anim.label}`)
        try {
          const el = await loadImageElement(dataUrl)
          const srcCanvas = document.createElement('canvas')
          srcCanvas.width = el.naturalWidth
          srcCanvas.height = el.naturalHeight
          srcCanvas.getContext('2d')!.drawImage(el, 0, 0)
          const cleaned = removeAnyBackground(srcCanvas, { tolerance: 50, shrinkPx: 2 })
          img.cleanSheets[animId] = cleaned.toDataURL('image/png')
        } catch (e: any) {
          console.warn(`[Vehicle] bg removal failed ${animId}:`, e)
          img.cleanSheets[animId] = dataUrl
        }
      }

      // 5. Split frames (unique views only) + auto-mirror + post-process
      const source = img.cleanSheets[animId] || img.animSheets[animId]
      if (source) {
        this.showProgress(true, `[4/5 拆帧+对齐] ${anim.label}`)
        try {
          const action = buildVehicleAction(anim, vm, uniqueViews)
          const dirFramesList = await splitSheetByDirection(source, action)

          let rawCanvasFrames: Record<string, HTMLCanvasElement[]> = {}
          for (let i = 0; i < dirFramesList.length && i < uniqueViews.length; i++) {
            rawCanvasFrames[uniqueViews[i]] = dirFramesList[i].frames
          }

          // 5a. Auto-mirror: derive right from left, iso-ne from iso-nw, etc.
          for (const [src, tgt] of mirrorMap) {
            if (rawCanvasFrames[src]) {
              rawCanvasFrames[tgt] = rawCanvasFrames[src].map(f => flipCanvasHorizontally(f))
            }
          }

          rawCanvasFrames = ensureAllFramesBgRemoved(rawCanvasFrames)

          // 5b. Unify + center
          this.showProgress(true, `[5/5 对齐] ${anim.label}`)
          const unified = unifyActionFrames(rawCanvasFrames, this.cfg.alignMode || 'waist')
          const result: Record<string, string[]> = {}
          for (const [viewKey, frames] of Object.entries(unified)) {
            result[viewKey] = canvasArrayToDataUrls(autoCenterCanvases(frames))
          }

          if (this.cfg.targetFrameSize > 0) {
            img.splitFrames[animId] = await normalizeFrameSize(result, this.cfg.targetFrameSize)
          } else {
            img.splitFrames[animId] = result
          }
        } catch (e: any) {
          console.warn(`[Vehicle] split/postprocess failed ${animId}:`, e)
        }
      }

      this.autoSave()
      this.appendAnimResult(animId)
    }

    // Normalize all actions to same frame size (pixel-char's approach)
    if (done > 0 && this.cfg.targetFrameSize === 0) {
      const maxSize = getMaxFrameSize(img.splitFrames)
      if (maxSize > 0) {
        this.showProgress(true, '统一帧尺寸...')
        await normalizeAllActions(img.splitFrames, maxSize)
      }
    }

    if (done > 0) {
      for (const animId of pendingAnims) {
        if (img.splitFrames[animId]) this.appendAnimResult(animId)
      }
      this.toast(`动画生成完成: ${done}/${total}`)
      await this.saveCurrentBatch(pendingAnims.filter(id => img.splitFrames[id]))
      this.renderLeft()
    }

    this.generating = false
    this.showProgress(false)
    this.drainRegenQueue()
  }

  private drainRegenQueue(): void {
    if (this.regenQueue.length === 0 || this.generating) return
    const next = this.regenQueue.shift()!
    this.cfg.selectedAnims = [next.animId]
    saveConfig(this.cfg)
    this.execStep3(true)
  }

  /* ── Persistence ────────────────────────────────────────────────── */

  private collectBlobs(): Record<string, string> {
    const blobs: Record<string, string> = {}
    if (this.img.designImage) blobs['design'] = this.img.designImage
    if (this.img.viewsImage) blobs['views'] = this.img.viewsImage

    for (const [view, url] of Object.entries(this.img.viewSplits)) {
      blobs[`viewsplit:${view}`] = url
    }
    for (const [id, url] of Object.entries(this.img.animSheets)) {
      blobs[`sheet:${id}`] = url
    }
    for (const [id, url] of Object.entries(this.img.cleanSheets)) {
      blobs[`clean:${id}`] = url
    }
    for (const [animId, dirs] of Object.entries(this.img.splitFrames)) {
      for (const [view, frames] of Object.entries(dirs)) {
        frames.forEach((url, idx) => {
          blobs[`frames:${animId}:${view}:${idx}`] = url
        })
      }
    }
    return blobs
  }

  private _uploadedBlobKeys: Map<string, string> = new Map()

  private async autoSave(): Promise<void> {
    try {
      const blobs = this.collectBlobs()
      const thumbnail = this.img.designImage || undefined
      await sessionAutoSave(PIPELINE_ID, { ...this.cfg } as any, blobs, undefined, thumbnail)
      this.broadcastState()
      // Mirror artifacts to <projectRoot>/.forgeax/games/<slug>/characters/
      // <charId>/vehicle/. Per-blob fingerprint dedupe so we don't re-POST the
      // same bytes on every config tweak.
      this.uploadBlobsToProject(blobs)
    } catch (e) {
      console.warn('[Vehicle] auto-save failed:', e)
    }
  }

  private uploadBlobsToProject(blobs: Record<string, string>): void {
    for (const [key, dataUrl] of Object.entries(blobs)) {
      if (!dataUrl) continue
      const fp = `${dataUrl.length}:${dataUrl.slice(-32)}`
      if (this._uploadedBlobKeys.get(key) === fp) continue
      this._uploadedBlobKeys.set(key, fp)
      const rel = vehicleBlobKeyToRel(key)
      if (!rel) continue
      void globalState.uploadAsset(rel, dataUrl)
    }
  }

  private async restoreSession(): Promise<void> {
    try {
      const data = await sessionLoad(`current:${PIPELINE_ID}`)
      if (!data) return

      const { meta, blobs } = data

      if (meta.config) {
        const forceStep = pendingReset ? 1 as Step : undefined
        Object.assign(this.cfg, meta.config)
        if (forceStep !== undefined) this.cfg.activeStep = forceStep
        pendingReset = false
        saveConfig(this.cfg)
      }

      this.restoreBlobs(blobs)
      this.checkPartialGeneration()
    } catch (e) {
      console.warn('[Vehicle] session restore failed:', e)
    }
  }

  private restoreBlobs(blobs: Record<string, string>): void {
    if (blobs['design']) this.img.designImage = blobs['design']
    if (blobs['views']) this.img.viewsImage = blobs['views']

    for (const [key, value] of Object.entries(blobs)) {
      if (key.startsWith('viewsplit:')) {
        this.img.viewSplits[key.slice(10)] = value
      } else if (key.startsWith('sheet:')) {
        this.img.animSheets[key.slice(6)] = value
      } else if (key.startsWith('clean:')) {
        this.img.cleanSheets[key.slice(6)] = value
      } else if (key.startsWith('frames:')) {
        const parts = key.split(':')
        const animId = parts[1]
        const view = parts[2]
        const idx = parseInt(parts[3])
        if (!this.img.splitFrames[animId]) this.img.splitFrames[animId] = {}
        if (!this.img.splitFrames[animId][view]) this.img.splitFrames[animId][view] = []
        this.img.splitFrames[animId][view][idx] = value
      }
    }
  }

  private checkPartialGeneration(): void {
    const selected = this.cfg.selectedAnims
    if (selected.length === 0) return

    const completed = selected.filter(id =>
      this.img.splitFrames[id] && Object.keys(this.img.splitFrames[id]).length > 0,
    )
    const missing = selected.filter(id => !completed.includes(id))

    if (completed.length > 0 && missing.length > 0) {
      const missingLabels = missing.map(id => getAnimation(id)?.label || id).join('、')
      this.toast(
        `检测到上次未完成的生成，已恢复 ${completed.length} 个动画。` +
        `点击「继续生成」可继续: ${missingLabels}`,
        6000,
      )
    }
  }

  /* ── Batch history ──────────────────────────────────────────────── */

  private async refreshBatchHistory(): Promise<void> {
    try {
      this.batchHistory = await listBatches()
    } catch (e) {
      console.warn('[Vehicle] batch list failed:', e)
      this.batchHistory = []
    }
  }

  private async saveCurrentBatch(animIds: string[]): Promise<void> {
    const c = this.cfg
    const img = this.img
    const animations: VehicleBatchAnimResult[] = []

    for (const id of animIds) {
      const anim = getAnimation(id)
      const viewFrames = img.splitFrames[id]
      if (!anim || !viewFrames) continue
      const viewsCopy: Record<string, string[]> = {}
      for (const [view, frames] of Object.entries(viewFrames)) {
        viewsCopy[view] = [...frames]
      }
      animations.push({
        animId: id,
        animLabel: anim.label,
        sheetDataUrl: img.animSheets[id] || '',
        cleanSheetDataUrl: img.cleanSheets[id],
        views: viewsCopy,
      })
    }
    if (animations.length === 0) return

    const now = Date.now()
    const ts = new Date(now).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    const names = animations.map(a => a.animLabel.replace(/\s*\(.*\)/, '')).join(', ')
    const batch: VehicleBatchEntry = {
      id: `batch:${now}`,
      createdAt: now,
      label: `${ts} (${names})`,
      categoryId: c.categoryId,
      subtypeId: c.subtypeId,
      styleId: c.styleId,
      eraId: c.eraId,
      viewModeId: c.viewModeId,
      thumbnailUrl: img.designImage || undefined,
      designImageUrl: img.designImage || undefined,
      viewsImageUrl: img.viewsImage || undefined,
      animations,
    }
    try {
      await saveBatch(batch)
      await this.refreshBatchHistory()
    } catch (e) {
      console.warn('[Vehicle] save batch failed:', e)
    }
  }

  /* ── Export ─────────────────────────────────────────────────────── */

  private async exportAll(): Promise<void> {
    if (Object.keys(this.img.splitFrames).length === 0) { this.toast('无可导出数据'); return }

    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      const meta: Record<string, any> = {}

      for (const [animId, dirMap] of Object.entries(this.img.splitFrames)) {
        const anim = getAnimation(animId)
        const label = anim?.label || animId
        const folder = zip.folder(label)!

        const dirMeta: Record<string, { frames: number }> = {}
        for (const [view, frames] of Object.entries(dirMap)) {
          const viewLabel = VIEW_LABELS[view as VehicleView] || view
          for (let i = 0; i < frames.length; i++) {
            const raw = frames[i].replace(/^data:[^;]+;base64,/, '')
            folder.file(`${viewLabel}_${String(i + 1).padStart(2, '0')}.png`, raw, { base64: true })
          }
          dirMeta[viewLabel] = { frames: frames.length }
        }

        const sheet = this.img.cleanSheets[animId] || this.img.animSheets[animId]
        if (sheet) {
          folder.file('_spritesheet.png', sheet.replace(/^data:[^;]+;base64,/, ''), { base64: true })
        }

        meta[label] = { animId, fps: this.cfg.fps, views: dirMeta }
      }

      zip.file('sprite-meta.json', JSON.stringify(meta, null, 2))
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'vehicle-sprites.zip'; a.click()
      URL.revokeObjectURL(url)
      this.toast('导出完成')
    } catch (e: any) {
      this.toast('导出失败: ' + e.message)
    }
  }

  private async exportSingle(animId: string): Promise<void> {
    const dirMap = this.img.splitFrames[animId]
    if (!dirMap) { this.toast('无帧数据'); return }

    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const anim = getAnimation(animId)
      const label = anim?.label || animId

      for (const [view, frames] of Object.entries(dirMap)) {
        const viewLabel = VIEW_LABELS[view as VehicleView] || view
        for (let i = 0; i < frames.length; i++) {
          const raw = frames[i].replace(/^data:[^;]+;base64,/, '')
          zip.file(`${viewLabel}_${String(i + 1).padStart(2, '0')}.png`, raw, { base64: true })
        }
      }

      const sheet = this.img.cleanSheets[animId] || this.img.animSheets[animId]
      if (sheet) {
        zip.file('_spritesheet.png', sheet.replace(/^data:[^;]+;base64,/, ''), { base64: true })
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `vehicle-${label}.zip`; a.click()
      URL.revokeObjectURL(url)
      this.toast(`${label} 导出完成`)
    } catch (e: any) {
      this.toast('导出失败: ' + e.message)
    }
  }

  /* ── Action Library ─────────────────────────────────────────────── */

  private async refreshActionLib(): Promise<void> {
    try {
      this.actionLib = await loadAllVehicleAnims()
    } catch (e) {
      console.warn('[VehicleDesign] anim-lib load failed:', e)
      this.actionLib = []
    }
  }

  /**
   * Save one animation from the current workspace into the action library.
   * If an entry with the same animId already exists we replace it — the user
   * almost never wants "library has 3 versions of idle"; they want "latest idle".
   */
  private async saveOneAnimToLib(animId: string): Promise<void> {
    const dirMap = this.img.splitFrames[animId]
    if (!dirMap || Object.keys(dirMap).length === 0) {
      this.toast('该动画无帧数据，请先生成后再加入动作库')
      return
    }
    const anim = getAnimation(animId)
    const sheetDataUrl = this.img.cleanSheets[animId] || this.img.animSheets[animId] || ''

    // Deep-copy so later edits in the workspace don't mutate the stored entry
    const views: Record<string, string[]> = {}
    for (const [v, frames] of Object.entries(dirMap)) views[v] = [...frames]

    const existing = this.actionLib.filter(e => e.animId === animId)
    for (const old of existing) await removeVehicleAnim(old.id)

    const now = Date.now()
    const entry: VehicleAnimLibEntry = {
      id: `${animId}:${now}`,
      animId,
      animLabel: anim?.label || animId,
      sheetDataUrl,
      views,
      addedAt: now,
    }
    await saveVehicleAnim(entry)
    await this.refreshActionLib()
    this.renderLeft()
    this.toast(`${entry.animLabel} 已加入动作库`)
  }

  private renderLeftLibTab(body: HTMLElement): void {
    const groups = new Map<string, VehicleAnimLibEntry[]>()
    for (const entry of this.actionLib) {
      if (!groups.has(entry.animId)) groups.set(entry.animId, [])
      groups.get(entry.animId)!.push(entry)
    }

    if (groups.size === 0) {
      body.innerHTML = `
        <div class="vh-lib-empty">
        <div class="vh-lib-empty-icon">${vhIcon('box', 'vh-icon vh-empty-svg')}</div>
          <div class="vh-lib-empty-text">动作库为空</div>
        <div class="vh-lib-empty-hint">在「编辑」标签页生成动画后，点击动画卡片上的「加入动作库」即可在此查看、调整缩放、放入场景</div>
        </div>`
      return
    }

    let cards = ''
    for (const [animId, entries] of groups) {
      const entry = entries[0]
      const label = entry.animLabel
      const firstView = Object.keys(entry.views)[0]
      const thumb = firstView ? entry.views[firstView]?.[0] : null
      const isSelected = this.selectedLibAnimId === animId
      const scale = clampScale(entry.scale ?? 1)
      const pct = Math.round(scale * 100)
      const scaleStyle = scale !== 1 ? ` style="transform: scale(${scale})"` : ''

      cards += `
        <div class="vh-lib-card${isSelected ? ' selected' : ''}" data-vh-lib-card="${animId}">
          <div class="vh-lib-card-thumb-box">
            ${thumb
              ? `<img src="${thumb}" class="vh-lib-card-thumb checkerboard" draggable="false"${scaleStyle} />`
              : '<div class="vh-lib-card-thumb-empty">?</div>'}
          </div>
          <div class="vh-lib-card-name">${label}</div>
          <div class="vh-lib-card-scale" title="缩放（双击百分比重置）">
            <button class="vh-scale-btn" data-vh-lib-scale-down="${entry.id}" title="缩小 5%">−</button>
            <span class="vh-scale-pct" data-vh-lib-scale-reset="${entry.id}">${pct}%</span>
            <button class="vh-scale-btn" data-vh-lib-scale-up="${entry.id}" title="放大 5%">+</button>
          </div>
          <div class="vh-lib-card-ops">
            <button class="vh-btn tiny" data-vh-lib-apply="${entry.id}" title="应用到工作区">↻</button>
            <button class="vh-btn tiny" data-vh-lib-del="${animId}" title="从动作库移除">×</button>
          </div>
        </div>`
    }

    body.innerHTML = `
      <div class="vh-lib-toolbar">
        <button class="vh-btn-pill" data-vh-lib="auto-align" title="以 idle 的载具尺寸为基准，自动统一所有动画的缩放">
          <span class="vh-btn-pill-icon">${vhIcon('target', 'vh-icon')}</span> 自动统一大小
        </button>
        <button class="vh-btn-pill" data-vh-lib="reset-scales" title="清除所有动画的缩放调整">重置缩放</button>
      </div>
      <div class="vh-lib-grid">${cards}</div>
      <div class="vh-lib-footer-bar">
        <button class="vh-btn-pill" data-vh-lib="inject-scene"><span class="vh-btn-pill-icon">${vhIcon('film', 'vh-icon')}</span> 放入场景</button>
        <button class="vh-btn-pill" data-vh-lib="export-zip"><span class="vh-btn-pill-icon">${vhIcon('upload', 'vh-icon')}</span> 导出 ZIP</button>
        <button class="vh-btn-pill danger" data-vh-lib="clear">清空</button>
      </div>`

    this.bindLibTabEvents(body)
  }

  private bindLibTabEvents(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-vh-lib-card]').forEach(card => {
      card.addEventListener('click', () => {
        const animId = card.dataset.vhLibCard!
        this.selectedLibAnimId = this.selectedLibAnimId === animId ? null : animId
        this.renderLeft()
      })
    })

    root.querySelectorAll<HTMLButtonElement>('[data-vh-lib-apply]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const entryId = btn.dataset.vhLibApply!
        const entry = this.actionLib.find(x => x.id === entryId)
        if (!entry) { this.toast('找不到该动画'); return }
        // Push back into workspace. Deep-copy so further workspace edits
        // don't mutate the stored library entry.
        const copy: Record<string, string[]> = {}
        for (const [v, fr] of Object.entries(entry.views)) copy[v] = [...fr]
        this.img.splitFrames[entry.animId] = copy
        if (entry.sheetDataUrl) this.img.animSheets[entry.animId] = entry.sheetDataUrl
        this.autoSave()
        this.toast(`${entry.animLabel} 已应用到工作区`)
      })
    })

    root.querySelectorAll<HTMLButtonElement>('[data-vh-lib-del]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const animId = btn.dataset.vhLibDel!
        const count = await removeVehicleAnimsByAnimId(animId)
        await this.refreshActionLib()
        if (this.selectedLibAnimId === animId) this.selectedLibAnimId = null
        this.renderLeft()
        this.toast(`已移除 ${count} 条`)
      })
    })

    const stepScale = (entryId: string, delta: number): void => {
      const entry = this.actionLib.find(e => e.id === entryId)
      if (!entry) return
      const next = clampScale((entry.scale ?? 1) + delta)
      entry.scale = next
      const pct = Math.round(next * 100)
      const card = root.querySelector(`[data-vh-lib-card="${entry.animId}"]`) as HTMLElement | null
      const img = card?.querySelector<HTMLImageElement>('.vh-lib-card-thumb')
      const pctEl = card?.querySelector<HTMLElement>('.vh-scale-pct')
      if (img) img.style.transform = next === 1 ? '' : `scale(${next})`
      if (pctEl) pctEl.textContent = `${pct}%`
      void updateVehicleAnimScale(entryId, next)
    }

    root.querySelectorAll<HTMLButtonElement>('[data-vh-lib-scale-down]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        stepScale(btn.dataset.vhLibScaleDown!, -0.05)
      })
    })
    root.querySelectorAll<HTMLButtonElement>('[data-vh-lib-scale-up]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        stepScale(btn.dataset.vhLibScaleUp!, 0.05)
      })
    })
    root.querySelectorAll<HTMLElement>('[data-vh-lib-scale-reset]').forEach(el => {
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        const entryId = el.dataset.vhLibScaleReset!
        const entry = this.actionLib.find(x => x.id === entryId)
        if (!entry) return
        stepScale(entryId, 1 - (entry.scale ?? 1))
      })
    })

    root.querySelector('[data-vh-lib="auto-align"]')?.addEventListener('click', async () => {
      await this.autoAlignLibScales()
    })

    root.querySelector('[data-vh-lib="reset-scales"]')?.addEventListener('click', async () => {
      for (const entry of this.actionLib) {
        entry.scale = 1
        await updateVehicleAnimScale(entry.id, 1)
      }
      this.renderLeft()
      this.toast(`已重置 ${this.actionLib.length} 条缩放`)
    })

    root.querySelector('[data-vh-lib="inject-scene"]')?.addEventListener('click', () => {
      void this.injectToScene()
    })

    root.querySelector('[data-vh-lib="export-zip"]')?.addEventListener('click', () => {
      void this.exportLibZip()
    })

    root.querySelector('[data-vh-lib="clear"]')?.addEventListener('click', async () => {
      if (!confirm('清空整个动作库？此操作不可撤销。')) return
      await clearVehicleAnimLib()
      await this.refreshActionLib()
      this.selectedLibAnimId = null
      this.renderLeft()
      this.toast('动作库已清空')
    })
  }

  /**
   * Auto-align per-entry scale. Same algorithm as pixel-char:
   *   1. Measure each entry's content height (median over sampled frames).
   *   2. Baseline = idle's height if present, else the median of all heights.
   *   3. scale = clamp(baseline / H_entry). Vehicles tend to drift much less
   *      than characters because the AI has a clearer "this is a car" mental
   *      model, so in practice adjustments are small — but idle/damaged can
   *      differ noticeably and this fixes that.
   */
  private async autoAlignLibScales(): Promise<void> {
    if (this.actionLib.length === 0) { this.toast('动作库为空'); return }

    const seen = new Set<string>()
    const entries: VehicleAnimLibEntry[] = []
    for (const e of this.actionLib) {
      if (seen.has(e.animId)) continue
      seen.add(e.animId)
      entries.push(e)
    }

    const measurements = new Map<string, number>()
    for (const e of entries) {
      const h = await measureActionContentHeight(e.views)
      if (h > 0) measurements.set(e.id, h)
    }
    if (measurements.size === 0) {
      this.toast('无法测量载具高度（帧全透明?）')
      return
    }

    const idleEntry = entries.find(e => e.animId === 'idle' && measurements.has(e.id))
    const reference = idleEntry
      ? measurements.get(idleEntry.id)!
      : (() => {
          const hs = [...measurements.values()].sort((a, b) => a - b)
          return hs[Math.floor(hs.length / 2)]
        })()

    let adjusted = 0
    for (const e of entries) {
      const h = measurements.get(e.id)
      const scale = h && h > 0 ? clampScale(reference / h) : 1
      if (Math.abs(scale - (e.scale ?? 1)) > 0.005) adjusted++
      e.scale = scale
      await updateVehicleAnimScale(e.id, scale)
    }
    // Propagate scale to any duplicate entries so version switches don't undo alignment
    for (const entry of this.actionLib) {
      const leader = entries.find(e => e.animId === entry.animId)
      if (leader && entry.id !== leader.id) {
        entry.scale = leader.scale
        await updateVehicleAnimScale(entry.id, leader.scale ?? 1)
      }
    }

    this.renderLeft()
    const basis = idleEntry ? 'idle' : '中位数'
    this.toast(`已对齐 ${entries.length} 条动画 (基准: ${basis}, 调整 ${adjusted} 项)`)
  }

  /**
   * Drop the action library into the 3D preview scene as a SpriteAnimator.
   *
   * Design notes:
   *   - Vehicles use view keys (front/back/side_*). SpriteAnimator defaults
   *     to the 'down' direction, so we remap each entry's views onto the
   *     cardinal direction names it understands. Missing views fall back to
   *     the first available view so the sprite never turns black.
   *   - Per-entry `scale` is baked into the frame pixels the same way
   *     exportLibToGame does — this is exactly what "放入场景后大小不一致"
   *     was asking us to fix.
   */
  private async injectToScene(): Promise<void> {
    if (this.actionLib.length === 0) { this.toast('动作库为空'); return }
    if (!pipeCtx?.engine) {
      this.toast('3D 引擎未就绪（请先在 character-editor 中打开一次场景预览）')
      return
    }

    const seen = new Set<string>()
    const spriteActions: SpriteActionData[] = []
    for (const entry of this.actionLib) {
      if (seen.has(entry.animId)) continue
      seen.add(entry.animId)
      const anim = getAnimation(entry.animId)
      const scale = clampScale(entry.scale ?? 1)
      const scaledViews = scale !== 1
        ? await rescaleDirections(entry.views, scale)
        : entry.views

      // Remap view keys → cardinal direction names SpriteAnimator expects.
      // Prefer front-facing for the default 'down' direction; fall back so
      // no direction ends up empty.
      const viewKeys = Object.keys(scaledViews)
      if (viewKeys.length === 0) continue
      const fallback = scaledViews[viewKeys[0]]
      const directions: Record<string, string[]> = {
        ...scaledViews,   // keep original keys so future code can switch to them
        down:  scaledViews['front']      || fallback,
        up:    scaledViews['back']       || fallback,
        left:  scaledViews['side_left']  || fallback,
        right: scaledViews['side_right'] || fallback,
      }

      spriteActions.push({
        actionId: entry.animId,
        actionLabel: entry.animLabel,
        directions,
        fps: this.cfg.fps,
        looping: anim?.looping !== false,
      })
    }

    if (spriteActions.length === 0) { this.toast('无有效动作数据'); return }

    this.cleanupSceneSprite()

    const engine = pipeCtx.engine
    const animator = new SpriteAnimator(spriteActions)
    this.currentSpriteAnimator = animator
    animator.mesh.position.set(0, 0.75, 0)
    animator.mesh.visible = false

    // Overlay scene bypasses post-processing (pixelate / bloom) — same place
    // pixel-char's inject-scene lands its sprite for the cleanest preview.
    engine.overlayScene.add(animator.mesh)
    animator.ready.then(() => {
      if (this.currentSpriteAnimator === animator) animator.mesh.visible = true
    })

    const spriteUpdate = (dt: number): void => {
      animator.update(dt)
      animator.mesh.quaternion.copy(engine.camera.quaternion)
    }
    this.spriteUpdateCb = spriteUpdate
    engine.onUpdate(spriteUpdate)

    animator.playAction(spriteActions[0].actionId)
    this.toast(`已放入场景 (${spriteActions.length} 个动作)`)
  }

  /**
   * Export everything in the action library as a ZIP with per-entry scale
   * baked into the frames. Mirrors pixel-char's exportLibToGame — the ZIP
   * shape matches what `exportAll` already produces so downstream consumers
   * keep working: `<animLabel>/<viewLabel>_NN.png` + `sprite-meta.json`.
   */
  private async exportLibZip(): Promise<void> {
    if (this.actionLib.length === 0) { this.toast('动作库为空'); return }
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const meta: Record<string, any> = {}

      const seen = new Set<string>()
      for (const entry of this.actionLib) {
        if (seen.has(entry.animId)) continue
        seen.add(entry.animId)
        const scale = clampScale(entry.scale ?? 1)
        const views = scale !== 1
          ? await rescaleDirections(entry.views, scale)
          : entry.views

        const label = entry.animLabel
        const folder = zip.folder(label)!
        const viewMeta: Record<string, { frames: number }> = {}

        for (const [view, frames] of Object.entries(views)) {
          const viewLabel = VIEW_LABELS[view as VehicleView] || view
          for (let i = 0; i < frames.length; i++) {
            const raw = frames[i].replace(/^data:[^;]+;base64,/, '')
            folder.file(`${viewLabel}_${String(i + 1).padStart(2, '0')}.png`, raw, { base64: true })
          }
          viewMeta[viewLabel] = { frames: frames.length }
        }
        if (entry.sheetDataUrl) {
          folder.file('_spritesheet.png', entry.sheetDataUrl.replace(/^data:[^;]+;base64,/, ''), { base64: true })
        }
        meta[label] = { animId: entry.animId, fps: this.cfg.fps, scale, views: viewMeta }
      }

      zip.file('sprite-meta.json', JSON.stringify(meta, null, 2))
      const blob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'vehicle-lib-sprites.zip'
      a.click()
      URL.revokeObjectURL(url)
      this.toast(`已导出 ${seen.size} 个动画 (已烘焙缩放)`)
    } catch (e: any) {
      this.toast('导出失败: ' + e.message)
    }
  }

  private cleanupSceneSprite(): void {
    const engine = pipeCtx?.engine
    if (this.currentSpriteAnimator && engine) {
      engine.overlayScene.remove(this.currentSpriteAnimator.mesh)
    }
    if (this.spriteUpdateCb && engine?.removeUpdate) {
      engine.removeUpdate(this.spriteUpdateCb)
    }
    this.spriteUpdateCb = null
    this.currentSpriteAnimator = null
  }

  /* ── Helpers ────────────────────────────────────────────────────── */

  private refresh(): void {
    if (this.leftEl && this.panels) this.mount(this.leftEl, this.panels)
  }

  private isStepDone(step: Step): boolean {
    switch (step) {
      case 1: return !!this.img.viewsImage
      case 2: return Object.keys(this.img.splitFrames).length > 0
    }
  }

  private stopAllGifs(): void {
    for (const handles of this.gifHandles.values()) handles.forEach(h => h.stop())
    this.gifHandles.clear()
  }

  private showProgress(show: boolean, text?: string): void {
    const el = this.leftEl?.querySelector('[data-vh="gen-progress"]') as HTMLElement
    if (!el) return
    el.style.display = show ? '' : 'none'
    if (text) {
      const t = el.querySelector('[data-vh="gen-text"]')
      const queueSuffix = this.regenQueue.length > 0 ? ` | 队列 ${this.regenQueue.length}` : ''
      if (t) t.textContent = text + queueSuffix
    }
  }

  private toast(msg: string, durationMs = 3000): void {
    let el = document.querySelector('.vh-toast') as HTMLElement
    if (!el) {
      el = document.createElement('div')
      el.className = 'vh-toast'
      document.body.appendChild(el)
    }
    el.textContent = msg
    el.classList.add('show')
    setTimeout(() => el.classList.remove('show'), durationMs)
  }
}

/* ── Pipeline Export ──────────────────────────────────────────────── */

let ui: VehiclePipelineUI | null = null
let pendingReset = false

const vehiclePipeline: IPipeline = {
  meta,

  async init(context) {
    pipeCtx = context
    console.log('[Vehicle] Pipeline initialized v1')
  },

  dispose() {
    ui?.dispose()
    ui = null
  },

  resetForNewCharacter() {
    pendingReset = true
    const cfg = loadConfig()
    cfg.activeStep = 1
    saveConfig(cfg)
  },

  createUI(container, panels) {
    if (!ui) ui = new VehiclePipelineUI()
    if (panels) {
      ui.mount(container, panels)
    } else {
      container.innerHTML = '<div style="padding:16px;color:var(--text-secondary);font-size:12px;">载具动画管线需要完整面板布局。</div>'
    }
  },

  destroyUI() {
    ui?.unmount()
  },

  getDefaultParams() {
    return { fps: 8 }
  },
}

export default vehiclePipeline

/* ── CSS ──────────────────────────────────────────────────────────── */

function injectCSS(): void {
  let s = document.getElementById(CSS_ID) as HTMLStyleElement | null
  if (!s) { s = document.createElement('style'); s.id = CSS_ID; document.head.appendChild(s) }
  s.textContent = `
.vh-panel {
  display: flex; flex-direction: column; min-height: 0; height: 100%;
  font-family: system-ui, -apple-system, sans-serif;
}
.vh-header {
  display: flex; align-items: center; gap: 8px;
  padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.07);
  flex-shrink: 0;
}
.vh-header-title { font-size: 15px; font-weight: 700; color: #d4ff48; line-height: normal; }
.vh-header-pill {
  margin-left: auto; padding: 3px 8px;
  border: 1px solid rgba(212,255,72,0.28);
  border-radius: 999px; background: rgba(212,255,72,0.08);
  color: #d4ff48; font-size: 11px; font-weight: 700;
  line-height: 1.2; letter-spacing: .04em; white-space: nowrap;
}
.vh-icon {
  width: 16px; height: 16px;
  display: inline-block; flex: 0 0 auto;
  fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round;
  vertical-align: -0.2em;
}

/* Tab Bar */
.vh-tab-bar {
  display: flex; gap: 6px; border-bottom: 1px solid rgba(255,255,255,0.07);
  padding: 8px 10px; flex-shrink: 0;
}
.vh-tab-btn {
  flex: 1; padding: 7px 8px; border: 1px solid rgba(255,255,255,0.07);
  border-radius: 8px; background: rgba(255,255,255,0.018);
  color: var(--text-secondary); font-size: 12px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.15s;
  text-align: center; position: relative;
}
.vh-tab-btn:hover { color: var(--text-primary); }
.vh-tab-btn.active { color: var(--accent); border-color: rgba(212,255,72,0.26); background: rgba(212,255,72,0.08); }
.vh-tab-body { flex: 1; overflow-y: auto; min-height: 0; }

.vh-section {
  margin: 8px 10px 0; padding: 10px;
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px; background: rgba(255,255,255,0.018);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.16);
}
.vh-label {
  font-size: 12px; font-weight: 800; color: var(--accent);
  margin-bottom: 7px; letter-spacing: 0.03em;
}
.vh-label-hint { font-weight: 400; text-transform: none; letter-spacing: 0; opacity: 0.7; }

/* Steps */
.vh-steps { display: flex; flex-direction: column; gap: 2px; }
.vh-step {
  border: 1px solid rgba(255,255,255,0.07); border-radius: 8px;
  background: rgba(255,255,255,0.015);
  transition: all 0.15s; cursor: pointer;
}
.vh-step:hover { background: var(--bg-hover); }
.vh-step.active { background: rgba(212,255,72,0.055); border-color: rgba(212,255,72,0.24); }
.vh-step.done .vh-step-label { color: var(--color-status-success); }
.vh-step-head {
  display: flex; align-items: center; gap: 8px; padding: 9px 10px;
}
.vh-step-icon {
  display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;
  background:var(--accent);color:#071007;font-size:10px;font-weight:900;
}
.vh-step-svg { width:11px; height:11px; stroke-width:2.4; }
.vh-step-label { font-size: 12px; font-weight: 600; color: var(--text-primary); flex: 1; }
.vh-step-done { font-size: 9px; color: var(--color-status-success); font-weight: 600; }

/* Category grid */
.vh-cat-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
}
.vh-cat-card {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  padding: 8px 4px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-primary); color: var(--text-primary);
  font-family: inherit; cursor: pointer; transition: all 0.15s;
}
.vh-cat-card:hover { background: var(--bg-hover); border-color: var(--text-secondary); }
.vh-cat-card.active {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent);
}
.vh-cat-icon { font-size: 20px; line-height: 1; }
.vh-cat-name { font-size: 10px; font-weight: 600; white-space: nowrap; }

/* Chip selectors */
.vh-chip-wrap { display: flex; flex-wrap: wrap; gap: 5px; }
.vh-chip {
  padding: 4px 10px; border: 1px solid var(--border); border-radius: 12px;
  background: var(--bg-primary); color: var(--text-secondary);
  font-size: 11px; font-weight: 500; font-family: inherit;
  cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.vh-chip:hover { background: var(--bg-hover); color: var(--text-primary); }
.vh-chip.active {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  border-color: var(--accent); color: var(--accent); font-weight: 600;
}

/* View mode cards */
.vh-viewmode-list { display: flex; flex-direction: column; gap: 4px; }
.vh-viewmode-card {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-primary); color: var(--text-primary);
  font-family: inherit; cursor: pointer; transition: all 0.15s;
  text-align: left;
}
.vh-viewmode-card:hover { background: var(--bg-hover); }
.vh-viewmode-card.active {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  border-color: var(--accent);
}
.vh-viewmode-icon { display:flex;align-items:center;justify-content:center;width:28px;text-align:center;flex-shrink:0;color:var(--text-secondary); }
.vh-viewmode-card.active .vh-viewmode-icon { color: var(--accent); }
.vh-empty-svg { width:34px; height:34px; opacity:0.45; }
.vh-btn-pill-icon .vh-icon { width:14px; height:14px; stroke-width:2.2; }
.vh-viewmode-info { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.vh-viewmode-name { font-size: 12px; font-weight: 600; }
.vh-viewmode-desc { font-size: 10px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Form elements */
.vh-textarea,
.vh-input {
  width: 100%; padding: 6px 8px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--bg-primary);
  color: var(--text-primary); font-size: 12px; font-family: inherit;
  resize: vertical; box-sizing: border-box;
}
.vh-input { resize: none; }
.vh-input:focus { outline: none; border-color: var(--accent); }
.vh-hint { font-size: 10px; color: var(--text-secondary); margin-top: 4px; }
.vh-warn { color: var(--color-status-warning); }

/* Buttons */
.vh-btn {
  display: inline-flex; align-items:center; justify-content:center; gap:6px;
  width: 100%; padding: 8px 12px;
  border: 1px solid var(--border); border-radius: 6px;
  background: var(--bg-hover); color: var(--text-primary);
  font-size: 12px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.2s; text-align: center;
  position: relative; overflow: hidden;
}
.vh-btn:hover { background: var(--bg-active); }
.vh-btn:active { transform: scale(0.98); }
.vh-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.vh-btn.primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 700; }
.vh-btn-svg { width:15px; height:15px; stroke-width:2.2; }
.vh-btn.primary:hover { filter: brightness(1.1); }
.vh-btn.primary:disabled { filter: none; }
.vh-btn.vh-btn-xl {
  padding: 14px 16px; font-size: 14px; font-weight: 800;
  letter-spacing: 0.5px; box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent), 0 2px 12px color-mix(in srgb, var(--accent) 25%, transparent);
}
.vh-btn.vh-btn-xl:hover { transform: translateY(-1px); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent), 0 4px 18px color-mix(in srgb, var(--accent) 40%, transparent); }
.vh-btn.small {
  padding: 5px 12px; font-size: 11px;
  width: auto; display: inline-flex; align-items: center; gap: 4px;
}
.vh-btn-mini {
  padding: 2px 8px; border: 1px solid var(--border); border-radius: 4px;
  background: var(--bg-hover); color: var(--text-secondary);
  font-size: 10px; font-family: inherit; cursor: pointer; transition: all 0.15s;
}
.vh-btn-mini:hover { background: var(--bg-active); color: var(--text-primary); }
.vh-btn-mini.danger { color: var(--color-status-error); }
.vh-btn-mini.danger:hover { background: color-mix(in srgb, var(--color-status-error) 15%, transparent); }

.vh-btn-pill {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  width: 100%; padding: 7px 14px; border: 1px solid var(--border); border-radius: 20px;
  background: var(--bg-hover); color: var(--text-primary);
  font-size: 11px; font-weight: 600; font-family: inherit;
  cursor: pointer; transition: all 0.2s;
}
.vh-btn-pill:hover { background: var(--bg-active); }
.vh-btn-pill.accent { background: color-mix(in srgb, var(--accent) 15%, transparent); border-color: var(--accent); color: var(--accent); }
.vh-btn-pill.accent:hover { background: color-mix(in srgb, var(--accent) 25%, transparent); }
.vh-btn-pill-icon { font-size: 13px; }

/* Animation checkbox list (Step 3) */
.vh-anim-list { display: flex; flex-direction: column; gap: 2px; }
.vh-checkbox-row {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 8px; border-radius: 6px; cursor: pointer;
  font-size: 12px; color: var(--text-primary);
  border: 1px solid transparent; transition: all 0.15s;
}
.vh-checkbox-row:hover { background: var(--bg-hover); }
.vh-checkbox-row.done { border-color: color-mix(in srgb, var(--color-status-success) 30%, transparent); }
.vh-anim-name { flex: 1; font-weight: 500; }
.vh-anim-detail {
  font-size: 10px; color: var(--text-secondary);
  background: var(--bg-primary); padding: 1px 6px; border-radius: 8px;
  white-space: nowrap;
}
.vh-anim-done {
  font-size: 9px; color: var(--color-status-success); font-weight: 600;
  white-space: nowrap;
}
.vh-range { accent-color: var(--accent); width: 100%; }
.vh-select {
  width: 100%; padding: 6px 10px;
  background: var(--bg-hover); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: 6px;
  font-size: 11px; font-family: inherit; cursor: pointer;
}
.vh-select:focus { border-color: var(--accent); outline: none; }
.vh-result-summary {
  font-size: 10px; color: var(--accent); line-height: 1.5;
  padding: 8px 10px; border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
}

/* Progress */
.vh-progress { padding: 8px 16px; flex-shrink: 0; }
.vh-progress-bar {
  height: 3px; background: var(--border); border-radius: 2px; overflow: hidden;
}
.vh-progress-fill {
  height: 100%; width: 30%; background: var(--accent);
  animation: vh-progress-anim 1.5s ease-in-out infinite;
}
@keyframes vh-progress-anim {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}
.vh-progress-text { font-size: 10px; color: var(--text-secondary); margin-top: 4px; }

/* Vehicle Action Library (mirrors pixel-char's lib UI) */
.vh-lib-empty {
  padding: 28px 20px; text-align: center; color: var(--text-secondary);
  display: flex; flex-direction: column; gap: 6px; align-items: center;
}
.vh-lib-empty-icon { font-size: 30px; opacity: 0.5; }
.vh-lib-empty-text { font-size: 13px; color: var(--text-primary); }
.vh-lib-empty-hint { font-size: 11px; line-height: 1.5; max-width: 260px; }
.vh-lib-toolbar {
  display: flex; gap: 6px; padding: 8px 16px 0; flex-wrap: wrap;
}
.vh-lib-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
  gap: 8px; padding: 12px 16px;
}
.vh-lib-card {
  display: flex; flex-direction: column; align-items: center;
  padding: 10px 6px 8px; border-radius: 6px; cursor: default;
  background: rgba(0,0,0,0.15); border: 1px solid var(--border);
  transition: all 0.15s; position: relative;
}
.vh-lib-card:hover { background: rgba(0,0,0,0.25); border-color: var(--accent); }
.vh-lib-card.selected {
  background: rgba(var(--accent-rgb, 100, 200, 255), 0.12);
  border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent);
}
.vh-lib-card-thumb-box {
  width: 56px; height: 56px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.vh-lib-card-thumb {
  width: 56px; height: 56px; image-rendering: pixelated;
  object-fit: contain; border-radius: 4px;
  transform-origin: center center;
  transition: transform 0.12s ease-out;
}
.vh-lib-card-thumb-empty {
  width: 56px; height: 56px; background: rgba(0,0,0,0.2); border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px; color: var(--text-secondary);
}
.vh-lib-card-name {
  font-size: 10px; margin-top: 6px; color: var(--text-primary);
  text-align: center; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; max-width: 100%;
}
.vh-lib-card-scale {
  display: flex; align-items: center; justify-content: center;
  gap: 4px; margin-top: 4px; font-size: 10px;
  color: var(--text-secondary); user-select: none;
}
.vh-scale-btn {
  width: 16px; height: 16px; line-height: 1; padding: 0;
  border: 1px solid var(--border); border-radius: 3px;
  background: rgba(255,255,255,0.05); color: var(--text-primary);
  cursor: pointer; font-size: 11px; font-family: inherit;
}
.vh-scale-btn:hover { background: rgba(255,255,255,0.12); border-color: var(--accent); }
.vh-scale-pct {
  min-width: 34px; text-align: center; font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.vh-scale-pct:hover { color: var(--accent); }
.vh-lib-card-ops {
  position: absolute; top: 3px; right: 3px;
  display: none; gap: 2px;
}
.vh-lib-card:hover .vh-lib-card-ops { display: flex; }
.vh-lib-footer-bar {
  display: flex; gap: 6px; padding: 10px 16px; flex-wrap: wrap;
  border-top: 1px solid var(--border);
}
.vh-btn-pill.danger {
  color: var(--color-status-error); border-color: color-mix(in srgb, var(--color-status-error) 40%, transparent);
}
.vh-btn-pill.danger:hover { background: color-mix(in srgb, var(--color-status-error) 15%, transparent); }

/* ── Center Panel ─────────────────────────────────────────────────── */
.vh-center {
  padding: 16px; display: flex; flex-direction: column; gap: 12px;
  width: 100%; height: 100%; min-height: 0;
  overflow-y: auto; overflow-x: hidden;
  box-sizing: border-box;
}
.vh-center-title {
  font-size: 14px; font-weight: 700; color: var(--text-primary);
}
.vh-center-head-bar {
  display: flex; align-items: center; gap: 10px;
}
.vh-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; color: var(--text-secondary); font-size: 13px; text-align: center;
}

.vh-preview-wrap {
  display: flex; justify-content: center; align-items: center;
  background: var(--color-background-elevated); border-radius: 8px; padding: 12px;
  border: 1px solid var(--border);
}
.vh-preview-img {
  max-width: 100%; max-height: 400px; object-fit: contain;
  border-radius: 4px; image-rendering: pixelated;
}

.vh-view-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}
.vh-view-cell {
  display: flex; flex-direction: column; align-items: center;
  background: var(--color-background-elevated); border: 1px solid var(--border);
  border-radius: 6px; padding: 8px; gap: 4px;
}
.vh-view-cell img {
  max-width: 100%; max-height: 120px; object-fit: contain;
  image-rendering: pixelated;
}
.vh-view-label {
  font-size: 10px; font-weight: 600; color: var(--text-secondary);
}

/* ── Animation result cards ───────────────────────────────────────── */
.vh-anim-results {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
@media (max-width: 1280px) {
  .vh-anim-results { grid-template-columns: 1fr; }
}

.vh-anim-card {
  border: 1px solid var(--border); border-radius: 10px;
  background: var(--color-background-elevated); overflow: hidden;
  transition: box-shadow 0.2s;
}
.vh-anim-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.2); }

.vh-card-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-bottom: 1px solid var(--border);
  background: var(--bg-primary);
}
.vh-card-name { font-size: 13px; font-weight: 700; color: var(--text-primary); }
.vh-card-meta { font-size: 11px; color: var(--text-secondary); }

.vh-sheet-toggle {
  margin: 8px 12px; cursor: pointer;
}
.vh-sheet-toggle summary {
  font-size: 11px; color: var(--text-secondary); padding: 4px 0;
  user-select: none;
}
.vh-sheet-toggle summary:hover { color: var(--text-primary); }
.vh-sheet-img { max-width: 100%; max-height: 280px; margin-top: 4px; display: block; }
.vh-sheet-label { font-size: 10px; color: var(--text-secondary); margin-top: 6px; opacity: 0.7; }
.vh-sheet-prompt-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
  margin-top: 6px;
  align-items: start;
}
@media (max-width: 900px) {
  .vh-sheet-prompt-row { grid-template-columns: 1fr; }
}
.vh-sheet-col, .vh-prompt-col { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.vh-prompt-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px; }
.vh-prompt-tab {
  padding: 3px 8px; font-size: 11px; border: 1px solid var(--border);
  background: transparent; color: var(--text-secondary); border-radius: 4px; cursor: pointer;
}
.vh-prompt-tab.active {
  background: var(--accent); color: var(--color-text-on-bright-primary); border-color: var(--accent);
}
.vh-prompt-textarea {
  width: 100%; box-sizing: border-box;
  min-height: 180px; max-height: 400px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; line-height: 1.45;
  background: var(--panel-alt, #1a1a1a); color: var(--text-primary);
  border: 1px solid var(--border); border-radius: 6px;
  padding: 6px 8px; resize: vertical; white-space: pre-wrap;
}
.vh-prompt-actions { display: flex; gap: 6px; margin-top: 4px; }

/* Direction strip — GIF left, frames right */
.vh-dir-strip {
  display: flex; align-items: stretch; gap: 12px;
  padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.04);
  min-height: 130px;
}
.vh-dir-strip:last-child { border-bottom: none; }

.vh-dir-strip-left {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  min-width: 140px; flex-shrink: 0;
}
.vh-dir-strip-name {
  font-size: 12px; font-weight: 700; color: var(--accent);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.vh-dir-strip-gif { flex-shrink: 0; }

.vh-dir-strip-frames,
.vh-dir-strip-right {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
  padding: 4px 0; flex: 1; min-width: 0;
}

/* Frame cells — dark checker background */
.vh-frame-cell {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.vh-frame-img {
  width: 88px; height: 88px; object-fit: contain;
  image-rendering: pixelated;
  background-image:
    linear-gradient(45deg, var(--color-background-floating) 25%, transparent 25%),
    linear-gradient(-45deg, var(--color-background-floating) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--color-background-floating) 75%),
    linear-gradient(-45deg, transparent 75%, var(--color-background-floating) 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  background-color: var(--color-background-canvas);
  border: 1px solid var(--border); border-radius: 6px;
  transition: transform 0.15s, border-color 0.15s;
}
.vh-frame-img:hover {
  transform: scale(1.08);
  border-color: var(--accent);
  z-index: 1;
}
.vh-frame-idx { font-size: 9px; color: var(--text-secondary); font-weight: 500; }

.vh-card-footer {
  display: flex; gap: 6px; padding: 8px 14px;
  border-top: 1px solid var(--border); background: var(--bg-primary);
}

/* GIF canvas */
.vh-gif-canvas {
  width: 120px; height: 120px;
  image-rendering: pixelated;
  border: 2px solid var(--accent); border-radius: 6px;
  background: rgba(0,0,0,0.3);
}

/* Per-frame micro-adjustment tools */
.vh-btn.tiny {
  display: inline-flex; align-items: center; justify-content: center;
  width: auto; min-width: 22px; padding: 3px 5px; font-size: 10px; line-height: 1;
  border-radius: 4px;
}
.vh-btn.tiny:hover { background: rgba(255,255,255,0.15); border-color: var(--accent); }

.vh-frame-ops {
  display: flex; gap: 2px; margin-top: 2px;
}
.vh-frame-drag-zone {
  cursor: grab; position: relative; overflow: hidden;
  border-radius: 6px; border: 1px solid var(--border);
  background-image:
    linear-gradient(45deg, var(--color-background-floating) 25%, transparent 25%),
    linear-gradient(-45deg, var(--color-background-floating) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--color-background-floating) 75%),
    linear-gradient(-45deg, transparent 75%, var(--color-background-floating) 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  background-color: var(--color-background-canvas);
  transition: border-color 0.15s;
}
.vh-frame-drag-zone:hover { border-color: var(--accent); }
.vh-frame-drag-zone.dragging { cursor: grabbing; border-color: var(--accent); }
.vh-frame-drag-zone .vh-frame-img {
  border: none; border-radius: 0; background: none;
  transition: none; pointer-events: none; display: block;
}

/* Copy frame dialog */
.vh-copy-dialog {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
}
.vh-copy-dialog-inner {
  background: var(--bg-primary, #1e1e1e); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px; min-width: 200px; max-width: 400px; max-height: 60vh;
  display: flex; flex-direction: column; gap: 10px; overflow-y: auto;
}
.vh-copy-dialog-title {
  font-size: 13px; font-weight: 700; color: var(--text-primary);
}
.vh-copy-dialog-list {
  display: flex; flex-wrap: wrap; gap: 6px;
}

/* ── History Tab ──────────────────────────────────────────────────── */
.vh-history-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 40px 16px; text-align: center;
}
.vh-history-empty-icon { font-size: 36px; opacity: 0.5; margin-bottom: 8px; }
.vh-history-empty-text { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.vh-history-empty-hint { font-size: 11px; color: var(--text-secondary); margin-top: 4px; }

.vh-history-list { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; }

.vh-history-card {
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-primary); overflow: hidden;
  transition: all 0.15s;
}
.vh-history-card:hover { border-color: var(--text-secondary); }
.vh-history-card-top {
  display: flex; gap: 10px; padding: 10px 12px; align-items: center;
}
.vh-history-thumb {
  width: 48px; height: 48px; object-fit: contain;
  border-radius: 6px; image-rendering: pixelated;
  background: var(--color-background-canvas); border: 1px solid var(--border);
  flex-shrink: 0;
}
.vh-history-thumb-placeholder {
  width: 48px; height: 48px; display: flex; align-items: center;
  justify-content: center; font-size: 22px;
  border-radius: 6px; background: var(--bg-hover); flex-shrink: 0;
}
.vh-history-card-info { flex: 1; min-width: 0; }
.vh-history-card-title {
  font-size: 12px; font-weight: 600; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.vh-history-card-meta { font-size: 10px; color: var(--text-secondary); }
.vh-history-card-time { font-size: 9px; color: var(--text-secondary); opacity: 0.7; }
.vh-history-card-actions {
  display: flex; gap: 4px; padding: 0 12px 8px;
}

/* Toast */
.vh-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px);
  padding: 10px 20px; border-radius: 8px;
  background: var(--color-background-elevated); color: var(--text-primary);
  font-size: 12px; font-weight: 500; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  border: 1px solid var(--border);
  opacity: 0; pointer-events: none; transition: all 0.3s ease;
  z-index: 9999;
}
.vh-toast.show { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
`
}
