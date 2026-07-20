// @source wb-character/src/pipelines/video/index.ts
import type { IPipeline, PipelineContext } from '../../core/types'
import { globalState } from '../../shared/GlobalState'
import { loadSelectedConcept } from '../../shared/CharacterDesign'
import {
  saveAction,
  loadAllActions,
  removeAction,
  clearActionLib,
  type ActionLibEntry,
} from './action-lib'
import {
  videoGenerate,
  videoQuery,
  videoProxyUrl,
  analyzeUltimate,
  removeBg,
  checkRemoveBgAvailable,
  characterTurnaround,
  regenerateSingleView,
} from '../../lib/api-client'
import {
  SPRITE_ACTION_PRESETS,
  VIEW_LABELS,
  buildContextPrompt,
  type CharacterView,
} from '../../lib/sprite-action-presets'
import { buildUltimateFrame } from '../../lib/image-normalize'
import {
  extractFrames,
  composeSpriteSheet,
  exportGif,
  exportPngZip,
  removeBackgroundCanvas,
  type FrameData,
} from '../../lib/frame-extract'
import {
  displayVideoInScene,
  displayUltimateInScene,
  clearDisplayPlanes,
  type VideoDisplayHandle,
} from '../../lib/scene-video-display'

import { meta } from './meta'

// ── Types ────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | 5 | 6
type TaskStatus = 'idle' | 'submitting' | 'processing' | 'succeed' | 'failed'

interface ViewResult { base64: string; mime: string }

interface TaskState {
  status: TaskStatus
  taskId: string
  pollAttempt: number
  startedAt: number
  videoUrl: string
  videoDuration: string
  error: string
}

const EMPTY_TASK: TaskState = {
  status: 'idle', taskId: '', pollAttempt: 0, startedAt: 0,
  videoUrl: '', videoDuration: '', error: '',
}

const MAX_POLL_SECONDS = 300

interface HistoryRecord {
  id: string
  presetId: string
  view: string
  videoUrl: string
  createdAt: number
}

const HISTORY_KEY = 'ce-video-history'
const MAX_HISTORY = 30

function vpIcon(name: string, cls = 'vp-icon-svg'): string {
  const paths: Record<string, string> = {
    refresh: '<path d="M21 12a9 9 0 0 1-15.3 6.4"/><path d="M3 12A9 9 0 0 1 18.3 5.6"/><path d="M3 19v-5h5"/><path d="M21 5v5h-5"/>',
    box: '<path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>',
    film: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 5v14M16 5v14M4 9h16M4 15h16"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-5-5L5 19"/>',
    screen: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
    wand: '<path d="m15 4 5 5"/><path d="M14 5 3 16l5 5L19 10"/><path d="M4 4h.01M9 2h.01M2 9h.01M20 16h.01M16 21h.01"/>',
  }
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] ?? paths.film}</svg>`
}

function loadHistory(): HistoryRecord[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') } catch { return [] }
}
function saveHistory(r: HistoryRecord) {
  try {
    const prev = loadHistory()
    localStorage.setItem(HISTORY_KEY, JSON.stringify([r, ...prev].slice(0, MAX_HISTORY)))
  } catch {}
}

// ── Turnaround IndexedDB Cache ────────────────────────────────────────
const TA_IDB_NAME = 'ce-turnaround'
const TA_IDB_STORE = 'views'
let _taDb: IDBDatabase | null = null

function taGetDB(): Promise<IDBDatabase> {
  if (_taDb) return Promise.resolve(_taDb)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TA_IDB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(TA_IDB_STORE) }
    req.onsuccess = () => { _taDb = req.result; resolve(_taDb!) }
    req.onerror = () => reject(req.error)
  })
}

interface TurnaroundCache {
  fingerprint: string
  views: Record<CharacterView, ViewResult>
  timestamp: number
}

function charFingerprint(charImage: string): string {
  return charImage.slice(0, 120)
}

async function saveTurnaroundCache(charImage: string, views: Record<CharacterView, ViewResult>): Promise<void> {
  try {
    const db = await taGetDB()
    const data: TurnaroundCache = {
      fingerprint: charFingerprint(charImage),
      views,
      timestamp: Date.now(),
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TA_IDB_STORE, 'readwrite')
      tx.objectStore(TA_IDB_STORE).put(data, 'latest')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {}
}

async function loadTurnaroundCache(charImage: string): Promise<Record<CharacterView, ViewResult> | null> {
  try {
    const db = await taGetDB()
    return new Promise((resolve) => {
      const tx = db.transaction(TA_IDB_STORE, 'readonly')
      const req = tx.objectStore(TA_IDB_STORE).get('latest')
      req.onsuccess = () => {
        const cached = req.result as TurnaroundCache | undefined
        if (cached && cached.fingerprint === charFingerprint(charImage) && cached.views) {
          resolve(cached.views)
        } else {
          resolve(null)
        }
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

// ── Main UI Class ────────────────────────────────────────────────────

class VideoUI {
  private ctx!: PipelineContext
  private container!: HTMLElement
  private unsub: (() => void) | null = null
  private pollTimer: number | null = null
  private uiRefreshTimer: number | null = null
  private static readonly CSS_ID = '__vp-video-css__'

  // State
  private charImage: string | null = null
  private charName = ''
  private charClass = ''
  private charWorld = ''
  private currentStep: Step = 1
  private maxStep: Step = 1

  // Step 2 — Turnaround
  private turnaroundViews: Record<CharacterView, ViewResult> | null = null
  private turnaroundGenerating = false
  private turnaroundError = ''
  private turnaroundStylePrompt = ''

  // Step 3 — Action & View
  private selectedPreset = 'idle'
  private selectedView: CharacterView = 'front'
  private customPrompt = ''
  private useCustomPrompt = false
  private ultimatePrompt = ''
  private ultimateAnalyzing = false

  // Step 4 — Video Generation
  private task: TaskState = { ...EMPTY_TASK }
  private history: HistoryRecord[] = []

  // Step 5 — Post-process
  private extractFps = 12
  private frames: FrameData[] = []
  private extracting = false
  private extractProgress = ''
  private removingBg = false
  private removeBgProgress = ''
  private bgRemoved = false
  private removeBgAvailable = false
  private spritesheetUrl = ''
  private composing = false

  // Step 6 — Scene Display
  private videoHandle: VideoDisplayHandle | null = null
  private sceneScale = 1.0
  /**
   * Fullscreen & trim flags: opt-in for ultimate presets so the VFX artist
   * can still see the classic "plane in front of camera" preview by toggling
   * the checkbox off. Default values are assigned per-preset in
   * `applySceneDefaultsForPreset()` (called whenever the user swaps preset).
   */
  private sceneFullscreen = false
  private sceneTrimHalf = false

  // Action Library
  private actionLib: ActionLibEntry[] = []
  private actionLibExpanded = false

  init(ctx: PipelineContext) { this.ctx = ctx }

  mount(container: HTMLElement) {
    this.container = container
    this.injectCSS()
    this.history = loadHistory()
    this.refreshActionLib()
    this.syncFromGlobal()
    this.unsub = globalState.subscribe(() => this.syncFromGlobal())
    checkRemoveBgAvailable().then(ok => { this.removeBgAvailable = ok })
    if (this.task.status === 'processing' && this.task.taskId && !this.pollTimer) {
      this.startPoll()
    }
    this.loadCachedTurnaround()
    this.applySceneDefaultsForPreset()
    this.render()
  }

  unmount() {
    this.unsub?.()
    this.unsub = null
    this.stopPoll()
    if (this.container) this.container.innerHTML = ''
  }

  resetToFirstStep() {
    this.currentStep = 1
    this.maxStep = 1
  }

  private syncFromGlobal() {
    const gs = globalState.get()
    const changed = gs.characterImage !== this.charImage
    this.charImage = gs.characterImage
    this.charName = gs.profile.name || ''
    this.charClass = gs.profile.charClass || ''
    this.charWorld = gs.profile.worldSetting || ''
    if (changed) {
      if (this.charImage && this.maxStep < 2) this.maxStep = 2
      this.turnaroundViews = null
      this.loadCachedTurnaround()
      this.render()
    }
  }

  private goStep(s: Step) {
    if (s > this.maxStep) return
    this.currentStep = s
    this.render()
  }

  private unlockStep(s: Step) {
    if (s > this.maxStep) this.maxStep = s
  }

  // ── Render ───────────────────────────────────────────────────────

  private render() {
    if (!this.container) return
    let html = `<div class="vp-panel">`

    html += this.renderHeader()
    html += this.renderStepNav()

    switch (this.currentStep) {
      case 1: html += this.renderStep1(); break
      case 2: html += this.renderStep2(); break
      case 3: html += this.renderStep3(); break
      case 4: html += this.renderStep4(); break
      case 5: html += this.renderStep5(); break
      case 6: html += this.renderStep6(); break
    }

    html += `</div>`
    this.container.innerHTML = html
    this.wireEvents()
  }

  private renderHeader(): string {
    return `<div class="vp-header"><span class="vp-title">视频角色工作台</span><span class="vp-header-pill">视频角色</span></div>`
  }

  private renderStepNav(): string {
    const steps: [Step, string][] = [
      [1, '角色'], [2, '三视图'], [3, '动作'], [4, '生成'], [5, '后处理'], [6, '展示'],
    ]
    let h = `<div class="vp-steps">`
    for (const [num, label] of steps) {
      const active = this.currentStep === num
      const locked = num > this.maxStep
      const done = num < this.currentStep && num < this.maxStep
      const cls = active ? 'active' : locked ? 'locked' : done ? 'done' : ''
      h += `<button class="vp-step-btn ${cls}" data-vp-step="${num}" ${locked ? 'disabled' : ''}>`
      h += `<span class="vp-step-num">${num}</span><span class="vp-step-label">${label}</span>`
      h += `</button>`
    }
    h += `</div>`
    return h
  }

  // ── Step 1: Character Preview ──────────────────────────────────

  private renderStep1(): string {
    let h = `<div class="vp-body">`

    if (!this.charImage) {
      h += `<div class="vp-empty">`
      h += `<div class="vp-empty-icon">👤</div>`
      h += `<div class="vp-empty-text">请先在「角色设计」中生成角色立绘</div>`
      h += `</div>`
    } else {
      h += `<div class="vp-char-preview">`
      h += `<img class="vp-char-img" src="${this.charImage}" />`
      h += `<div class="vp-char-info">`
      if (this.charName) h += `<div class="vp-char-name">${this.charName}</div>`
      if (this.charClass) h += `<div class="vp-char-meta">${this.charClass}</div>`
      if (this.charWorld) h += `<div class="vp-char-meta">${this.charWorld}</div>`
      h += `</div></div>`

      // 风格描述提前到 step1 末尾——step1 原本只有"角色缩略图 + 一个按钮"
      // 视觉太单薄；把 step2 同名 textarea 复制一份过来，两边复用同一个
      // `data-vp-action="ta-style"` 选择器（wireEvents 用 querySelector
      // 抓单个，每次 render 后重新绑定，所以 step1/step2 切换时都能正确联动
      // 同一个 `this.turnaroundStylePrompt` 字段）。
      h += `<div class="vp-section"><div class="vp-section-title">风格描述（可选）</div>`
      h += `<textarea class="vp-textarea" data-vp-action="ta-style" placeholder="例如：Q版风格、写实风格...">${this.turnaroundStylePrompt}</textarea>`
      h += `</div>`

      h += `<button class="vp-btn vp-btn-primary" data-vp-action="go-step2">生成三视图 →</button>`
    }

    h += `</div>`
    return h
  }

  // ── Step 2: Turnaround ───────────────────────────────────────

  private renderStep2(): string {
    let h = `<div class="vp-body">`

    if (!this.charImage) {
      h += `<div class="vp-empty"><div class="vp-empty-text">请先在「角色设计」中生成角色立绘</div></div>`
      h += `</div>`
      return h
    }

    h += `<div class="vp-section"><div class="vp-section-title">角色参考</div>`
    h += `<div class="vp-char-preview" style="text-align:center"><img class="vp-char-img" src="${this.charImage}" style="max-height:120px" /></div>`
    h += `</div>`

    h += `<div class="vp-section"><div class="vp-section-title">风格描述（可选）</div>`
    h += `<textarea class="vp-textarea" data-vp-action="ta-style" placeholder="例如：Q版风格、写实风格...">${this.turnaroundStylePrompt}</textarea>`
    h += `</div>`

    if (this.turnaroundError) {
      h += `<div class="vp-error">${this.turnaroundError}</div>`
    }

    if (this.turnaroundGenerating) {
      h += `<div class="vp-status-card"><div class="vp-spinner"></div><div>三视图生成中，请稍候…</div></div>`
    } else if (this.turnaroundViews) {
      h += `<div class="vp-section">`
      h += `<div class="vp-section-title">三视图结果 <span style="font-weight:400;color:var(--text-secondary);text-transform:none">（已缓存）</span></div>`
      h += `<div class="vp-ta-grid">`
      for (const [key, label] of [['front', '正面'], ['side', '侧面'], ['back', '背面'], ['idle', '待机(45°)']] as const) {
        const v = this.turnaroundViews[key as CharacterView]
        h += `<div class="vp-ta-card">`
        h += `<div class="vp-ta-label">${label}</div>`
        if (v) {
          h += `<img class="vp-ta-img" src="data:${v.mime};base64,${v.base64}" />`
        } else {
          h += `<div style="flex:1;display:flex;align-items:center;justify-content:center;opacity:0.3;font-size:20px">⏳</div>`
        }
        h += `<div class="vp-ta-actions">`
        h += `<input class="vp-ta-desc-input" data-vp-view-desc="${key}" placeholder="补充描述..." />`
        h += `<button class="vp-ta-regen-btn" data-vp-regen-view="${key}">${vpIcon('refresh')}</button>`
        h += `</div>`
        h += `</div>`
      }
      h += `</div></div>`

      h += `<div style="display:flex;gap:6px;margin-top:8px">`
      h += `<button class="vp-btn" data-vp-action="gen-turnaround" style="flex:0 0 auto;width:auto;padding:8px 14px">${vpIcon('refresh')}重新生成</button>`
      h += `<button class="vp-btn vp-btn-primary" data-vp-action="go-step3" style="flex:1">选择动作 →</button>`
      h += `</div>`
    } else {
      h += `<button class="vp-btn vp-btn-primary" data-vp-action="gen-turnaround">${vpIcon('refresh')}生成三视图</button>`
    }

    h += `</div>`
    return h
  }

  // ── Step 3: Choose Action ─────────────────────────────────────

  private renderStep3(): string {
    let h = `<div class="vp-body">`

    const donePresets = new Set(this.actionLib.map(a => a.presetId))
    const totalPresets = SPRITE_ACTION_PRESETS.length
    const doneCount = new Set(this.actionLib.map(a => a.presetId)).size

    h += `<div class="vp-section"><div class="vp-section-title">动作预设 <span class="vp-lib-stats">${doneCount}/${totalPresets}</span></div>`
    h += `<div class="vp-presets">`
    for (const p of SPRITE_ACTION_PRESETS) {
      const active = this.selectedPreset === p.id
      const done = donePresets.has(p.id)
      h += `<button class="vp-preset${active ? ' active' : ''}${done ? ' done' : ''}" data-vp-preset="${p.id}">`
      if (done) h += `<span class="vp-preset-badge">✓</span>`
      h += `<span class="vp-preset-icon">${p.icon}</span>`
      h += `<span class="vp-preset-name">${p.nameZh}</span>`
      h += `</button>`
    }
    h += `</div></div>`

    const preset = SPRITE_ACTION_PRESETS.find(p => p.id === this.selectedPreset)

    if (preset?.viewPrompts) {
      const moveLocked = preset.id === 'move'
      if (moveLocked) this.selectedView = 'side'
      h += `<div class="vp-section"><div class="vp-section-title">视角（使用三视图）</div>`
      if (moveLocked) {
        h += `<div class="vp-hint" style="margin:4px 0">🔒 移动动作仅使用侧面视图，左右方向由程序翻转</div>`
      } else {
        h += `<div class="vp-view-row">`
        for (const v of ['front', 'side', 'back', 'idle'] as CharacterView[]) {
          const active = this.selectedView === v
          const taView = this.turnaroundViews?.[v]
          const thumbSrc = taView ? `data:${taView.mime};base64,${taView.base64}` : ''
          h += `<button class="vp-view-btn${active ? ' active' : ''}" data-vp-view="${v}">`
          if (thumbSrc) h += `<img class="vp-view-thumb" src="${thumbSrc}" />`
          h += `<span>${VIEW_LABELS[v].zh}</span>`
          h += `</button>`
        }
        h += `</div>`
      }
      if (!this.turnaroundViews) {
        h += `<div class="vp-hint">⚠ 未生成三视图，将使用原始角色图</div>`
      }
      h += `</div>`
    }

    if (preset) {
      h += `<div class="vp-section"><div class="vp-section-title">描述</div>`
      h += `<div class="vp-desc">${preset.descZh}</div></div>`
    }

    // Ultimate: auto-analyze option
    if (preset?.id === 'ultimate' && this.ultimatePrompt) {
      h += `<div class="vp-section"><div class="vp-section-title">AI 大招提示词</div>`
      h += `<div class="vp-prompt-result">${this.ultimatePrompt}</div></div>`
    }

    // Custom prompt toggle
    h += `<div class="vp-section">`
    h += `<label class="vp-toggle">`
    h += `<input type="checkbox" data-vp-action="toggle-custom" ${this.useCustomPrompt ? 'checked' : ''} />`
    h += `<span>自定义提示词（高级）</span></label>`
    if (this.useCustomPrompt) {
      h += `<textarea class="vp-textarea" data-vp-action="custom-prompt" placeholder="输入自定义视频生成提示词...">${this.customPrompt}</textarea>`
    }
    h += `</div>`

    h += `<button class="vp-btn vp-btn-primary" data-vp-action="generate">${vpIcon('film')}生成视频</button>`

    // Action Library panel
    h += `<div class="vp-lib-section">`
    h += `<button class="vp-lib-toggle" data-vp-action="toggle-lib-panel">`
    h += `${vpIcon('box')}动作库 (${doneCount}/${totalPresets}) ${this.actionLibExpanded ? '▾' : '▸'}</button>`
    if (this.actionLibExpanded) {
      if (this.actionLib.length === 0) {
        h += `<div class="vp-lib-empty">暂无已收录的动作</div>`
      } else {
        h += `<div class="vp-lib-list">`
        for (const a of this.actionLib) {
          const viewZh = a.view === 'front' ? '正面' : a.view === 'side' ? '侧面' : '背面'
          const date = new Date(a.addedAt)
          const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
          h += `<div class="vp-lib-item">`
          h += `<span class="vp-lib-item-name">${a.presetNameZh}</span>`
          h += `<span class="vp-lib-item-view">${viewZh}</span>`
          h += `<span class="vp-lib-item-type">${a.isCinematic ? 'CG' : '序列帧'}</span>`
          h += `<span class="vp-lib-item-date">${dateStr}</span>`
          h += `<button class="vp-lib-item-rm" data-vp-rm-action="${a.presetId}:${a.view}" title="移除">✕</button>`
          h += `</div>`
        }
        h += `</div>`
        h += `<button class="vp-btn vp-btn-sm" data-vp-action="clear-lib" style="margin-top:4px;width:auto">清空动作库</button>`
      }
    }
    h += `</div>`

    h += `</div>`
    return h
  }

  // ── Step 4: Generation Progress ────────────────────────────────

  private renderStep4(): string {
    const t = this.task
    let h = `<div class="vp-body">`

    if (t.status === 'submitting') {
      h += `<div class="vp-status-card"><div class="vp-spinner"></div><div>提交中...</div></div>`
    } else if (t.status === 'processing') {
      const elapsed = t.startedAt ? Math.floor((Date.now() - t.startedAt) / 1000) : 0
      const elapsedStr = elapsed >= 60 ? `${Math.floor(elapsed / 60)}分${elapsed % 60}秒` : `${elapsed}秒`
      const pct = Math.min(elapsed / (MAX_POLL_SECONDS * 0.01), 95)
      h += `<div class="vp-status-card">`
      h += `<div class="vp-spinner"></div>`
      h += `<div style="font-size:12px;font-weight:600">视频生成中</div>`
      h += `<div style="font-size:11px;color:var(--text-secondary)">已等待 ${elapsedStr} · 通常需要 1~3 分钟</div>`
      h += `<div class="vp-progress"><div class="vp-progress-bar" style="width:${pct}%"></div></div>`
      h += `<button class="vp-btn vp-btn-sm" data-vp-action="cancel-poll" style="margin-top:8px;width:auto">⏹ 取消等待</button>`
      h += `</div>`
    } else if (t.status === 'succeed' && t.videoUrl) {
      const proxied = videoProxyUrl(t.videoUrl)
      const currentPreset = SPRITE_ACTION_PRESETS.find(p => p.id === this.selectedPreset)
      const isCinematic = currentPreset?.isCinematic
      h += `<div class="vp-video-wrap"><video src="${proxied}" controls autoplay ${isCinematic ? '' : 'loop'} class="vp-video"></video></div>`
      if (isCinematic) {
        h += `<div class="vp-hint" style="margin:8px 0;text-align:center">这是大招演出 CG，用于独立过场，无需后处理抠图</div>`
      }
      const alreadyInLib = this.isInLib(this.selectedPreset, this.selectedView)
      h += `<div class="vp-actions-row">`
      if (alreadyInLib) {
        h += `<button class="vp-btn vp-btn-sm vp-btn-done" disabled>✓ 已收录</button>`
      } else {
        h += `<button class="vp-btn vp-btn-sm vp-btn-accent" data-vp-action="add-to-lib">${vpIcon('box')}收录到动作库</button>`
      }
      h += `<a class="vp-btn vp-btn-sm" href="${proxied}" download="video.mp4">${vpIcon('download')}下载视频</a>`
      h += `<button class="vp-btn vp-btn-sm" data-vp-action="regenerate">${vpIcon('refresh')}重新生成</button>`
      if (!isCinematic) {
        h += `<button class="vp-btn vp-btn-sm vp-btn-primary" data-vp-action="go-step5">后处理 →</button>`
      }
      h += `<button class="vp-btn vp-btn-sm" data-vp-action="go-step6">场景展示 →</button>`
      h += `</div>`
    } else if (t.status === 'failed') {
      h += `<div class="vp-error">${t.error || '生成失败'}</div>`
      h += `<button class="vp-btn vp-btn-sm" data-vp-action="regenerate">重试</button>`
    } else {
      h += `<div class="vp-empty"><div class="vp-empty-text">请先选择动作并生成视频</div></div>`
      h += `<button class="vp-btn" data-vp-action="back-step3">← 返回选择动作</button>`
    }

    // History
    if (this.history.length > 0) {
      h += `<div class="vp-section" style="margin-top:12px"><div class="vp-section-title">历史记录 (${this.history.length})</div>`
      for (const r of this.history.slice(0, 8)) {
        const preset = SPRITE_ACTION_PRESETS.find(p => p.id === r.presetId)
        const label = preset ? `${preset.icon} ${preset.nameZh}` : r.presetId
        const time = new Date(r.createdAt).toLocaleTimeString()
        h += `<div class="vp-history-row">`
        h += `<span class="vp-history-label">${label} · ${r.view}</span>`
        h += `<span class="vp-history-time">${time}</span>`
        h += `<button class="vp-btn vp-btn-xs" data-vp-history-url="${r.videoUrl}">使用</button>`
        h += `</div>`
      }
      h += `</div>`
    }

    h += `</div>`
    return h
  }

  // ── Step 5: Post-Process ───────────────────────────────────────

  private renderStep5(): string {
    let h = `<div class="vp-body">`

    // 4a: Extract frames
    h += `<div class="vp-section"><div class="vp-section-title">1. 抽取帧</div>`
    h += `<div class="vp-param-row"><label>FPS</label>`
    h += `<input type="range" min="4" max="30" value="${this.extractFps}" data-vp-action="fps-slider" class="vp-slider" />`
    h += `<span class="vp-fps-val">${this.extractFps}</span></div>`

    if (this.extracting) {
      h += `<div class="vp-status-inline">${this.extractProgress || '抽帧中...'}</div>`
    } else if (this.frames.length > 0) {
      h += `<div class="vp-frame-count">${this.frames.length} 帧已抽取</div>`
    }

    h += `<button class="vp-btn${this.extracting ? ' vp-btn-disabled' : ''}" data-vp-action="extract" ${this.extracting ? 'disabled' : ''}>${vpIcon('film')}抽取帧</button>`
    h += `</div>`

    // 4b: Frame strip
    if (this.frames.length > 0) {
      h += `<div class="vp-section"><div class="vp-section-title">帧预览</div>`
      h += `<div class="vp-frame-strip">`
      for (let i = 0; i < Math.min(this.frames.length, 20); i++) {
        h += `<img class="vp-frame-thumb" src="${this.frames[i].dataUrl}" title="Frame ${i + 1}" />`
      }
      if (this.frames.length > 20) {
        h += `<div class="vp-frame-more">+${this.frames.length - 20}</div>`
      }
      h += `</div></div>`

      // 4c: Remove background
      h += `<div class="vp-section"><div class="vp-section-title">2. 去除背景</div>`
      if (this.bgRemoved) {
        h += `<div class="vp-status-inline vp-success">✓ 背景已移除</div>`
      } else if (this.removingBg) {
        h += `<div class="vp-status-inline">${this.removeBgProgress || '抠图中...'}</div>`
      }
      if (this.removeBgAvailable) {
        h += `<button class="vp-btn${this.removingBg || this.bgRemoved ? ' vp-btn-disabled' : ''}" data-vp-action="remove-bg" ${this.removingBg || this.bgRemoved ? 'disabled' : ''}>${vpIcon('wand')}MCP 专业抠图</button>`
      }
      h += `<button class="vp-btn vp-btn-sm${this.removingBg || this.bgRemoved ? ' vp-btn-disabled' : ''}" data-vp-action="remove-bg-canvas" style="margin-top:4px" ${this.removingBg || this.bgRemoved ? 'disabled' : ''}>快速抠图（本地）</button>`
      if (this.bgRemoved) {
        h += `<button class="vp-btn vp-btn-sm" data-vp-action="reset-bg" style="margin-top:4px">↩ 恢复原始帧</button>`
      }
      h += `</div>`

      // 4d: Compose & Export
      h += `<div class="vp-section"><div class="vp-section-title">3. 合成导出</div>`

      if (this.composing) {
        h += `<div class="vp-status-inline">合成中...</div>`
      } else if (this.spritesheetUrl) {
        h += `<div class="vp-spritesheet-wrap"><img class="vp-spritesheet-img" src="${this.spritesheetUrl}" /></div>`
      }

      h += `<div class="vp-export-row">`
      h += `<button class="vp-btn vp-btn-sm" data-vp-action="compose">${vpIcon('image')}合成序列图</button>`
      h += `<button class="vp-btn vp-btn-sm" data-vp-action="export-gif">GIF</button>`
      h += `<button class="vp-btn vp-btn-sm" data-vp-action="export-zip">ZIP</button>`
      if (this.spritesheetUrl) {
        h += `<button class="vp-btn vp-btn-sm" data-vp-action="download-sheet">⬇ PNG</button>`
      }
      h += `</div></div>`

      const s5InLib = this.isInLib(this.selectedPreset, this.selectedView)
      h += `<div class="vp-actions-row" style="margin-top:8px">`
      if (s5InLib) {
        h += `<button class="vp-btn vp-btn-sm vp-btn-done" disabled>✓ 已收录</button>`
      } else {
        h += `<button class="vp-btn vp-btn-sm vp-btn-accent" data-vp-action="add-to-lib">${vpIcon('box')}收录到动作库</button>`
      }
      h += `<button class="vp-btn vp-btn-sm vp-btn-primary" data-vp-action="go-step6">场景展示 →</button>`
      h += `</div>`
    }

    h += `</div>`
    return h
  }

  // ── Step 6: Scene Preview ──────────────────────────────────────

  private renderStep6(): string {
    let h = `<div class="vp-body">`

    h += `<div class="vp-section"><div class="vp-section-title">场景内展示</div>`
    h += `<div class="vp-desc">将视频放置在 3D 场景中相机前方进行预览</div>`

    // Fullscreen cinematic toggle (on-by-default for ultimate presets).
    // When on, the plane is camera-attached and sized to COVER the frustum,
    // so the cinematic occludes the 3D scene — this is the intended
    // presentation for the "大招演出". When off, the classic scene-placed
    // plane honours the scale slider below.
    h += `<div class="vp-param-row" style="gap:6px;">`
    h += `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex:1;">`
    h += `<input type="checkbox" data-vp-action="scene-fullscreen" ${this.sceneFullscreen ? 'checked' : ''}/>`
    h += `<span>全屏覆盖场景</span>`
    h += `</label>`
    h += `<label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex:1;${this.sceneFullscreen ? '' : 'opacity:0.5;pointer-events:none;'}">`
    h += `<input type="checkbox" data-vp-action="scene-trim-half" ${this.sceneTrimHalf ? 'checked' : ''} ${this.sceneFullscreen ? '' : 'disabled'}/>`
    h += `<span>只播前半段</span>`
    h += `</label>`
    h += `</div>`

    // Scale slider only matters in non-fullscreen mode. Greyed out instead of
    // hidden so the UI shape stays predictable when toggling.
    h += `<div class="vp-param-row" style="${this.sceneFullscreen ? 'opacity:0.4;pointer-events:none;' : ''}"><label>缩放</label>`
    h += `<input type="range" min="0.2" max="5" step="0.1" value="${this.sceneScale}" data-vp-action="scene-scale" class="vp-slider" ${this.sceneFullscreen ? 'disabled' : ''}/>`
    h += `<span>${this.sceneScale.toFixed(1)}</span></div>`

    h += `<div class="vp-export-row">`
    h += `<button class="vp-btn vp-btn-primary" data-vp-action="show-in-scene">${vpIcon(this.sceneFullscreen ? 'film' : 'screen')}${this.sceneFullscreen ? '全屏播放大招' : '放入场景'}</button>`
    h += `<button class="vp-btn vp-btn-sm" data-vp-action="clear-scene">移除</button>`
    h += `</div></div>`

    h += `<div class="vp-section"><div class="vp-section-title">不满意？</div>`
    h += `<button class="vp-btn" data-vp-action="back-step3">← 重新选择动作</button>`
    h += `</div>`

    h += `</div>`
    return h
  }

  // ── Event Wiring ───────────────────────────────────────────────

  private wireEvents() {
    // Step navigation
    this.container.querySelectorAll('[data-vp-step]').forEach(btn =>
      btn.addEventListener('click', () => {
        const s = Number((btn as HTMLElement).dataset.vpStep) as Step
        this.goStep(s)
      }),
    )

    // Step 1
    this.container.querySelector('[data-vp-action="go-step2"]')?.addEventListener('click', () => {
      this.unlockStep(2)
      this.goStep(2)
    })

    // Step 2: turnaround
    const taStyleTa = this.container.querySelector('[data-vp-action="ta-style"]') as HTMLTextAreaElement
    taStyleTa?.addEventListener('input', () => { this.turnaroundStylePrompt = taStyleTa.value })
    this.container.querySelector('[data-vp-action="gen-turnaround"]')?.addEventListener('click', () => this.generateTurnaround())
    this.container.querySelectorAll<HTMLButtonElement>('[data-vp-regen-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        const viewKey = btn.dataset.vpRegenView!
        const descInput = this.container.querySelector(`input[data-vp-view-desc="${viewKey}"]`) as HTMLInputElement
        const extraDesc = descInput?.value?.trim() || ''
        this.regenSingleView(viewKey, extraDesc)
      })
    })
    this.container.querySelector('[data-vp-action="go-step3"]')?.addEventListener('click', () => {
      this.unlockStep(3)
      this.goStep(3)
    })

    // Step 3: presets
    this.container.querySelectorAll('[data-vp-preset]').forEach(btn =>
      btn.addEventListener('click', () => {
        this.selectedPreset = (btn as HTMLElement).dataset.vpPreset!
        if (this.selectedPreset === 'move') this.selectedView = 'side'
        this.ultimatePrompt = ''
        this.applySceneDefaultsForPreset()
        this.render()
      }),
    )
    this.container.querySelectorAll('[data-vp-view]').forEach(btn =>
      btn.addEventListener('click', () => {
        this.selectedView = (btn as HTMLElement).dataset.vpView as CharacterView
        this.render()
      }),
    )

    // Custom prompt
    this.container.querySelector('[data-vp-action="toggle-custom"]')?.addEventListener('change', (e) => {
      this.useCustomPrompt = (e.target as HTMLInputElement).checked
      this.render()
    })
    const ta = this.container.querySelector('[data-vp-action="custom-prompt"]') as HTMLTextAreaElement
    ta?.addEventListener('input', () => { this.customPrompt = ta.value })

    // Generate
    this.container.querySelector('[data-vp-action="generate"]')?.addEventListener('click', () => this.generateVideo())

    // Step 4
    this.container.querySelector('[data-vp-action="cancel-poll"]')?.addEventListener('click', () => {
      this.stopPoll()
      this.task.status = 'failed'
      this.task.error = '已取消'
      this.render()
    })
    this.container.querySelector('[data-vp-action="regenerate"]')?.addEventListener('click', () => {
      this.task = { ...EMPTY_TASK }
      this.stopPoll()
      this.frames = []
      this.bgRemoved = false
      this.spritesheetUrl = ''
      this.goStep(3)
    })
    this.container.querySelector('[data-vp-action="go-step5"]')?.addEventListener('click', () => {
      this.unlockStep(5)
      this.goStep(5)
    })
    this.container.querySelector('[data-vp-action="go-step6"]')?.addEventListener('click', () => {
      this.unlockStep(6)
      this.goStep(6)
    })
    this.container.querySelector('[data-vp-action="back-step3"]')?.addEventListener('click', () => this.goStep(3))

    // History: use a previous video
    this.container.querySelectorAll('[data-vp-history-url]').forEach(btn =>
      btn.addEventListener('click', () => {
        const url = (btn as HTMLElement).dataset.vpHistoryUrl!
        this.task = { ...EMPTY_TASK, status: 'succeed', videoUrl: url }
        this.unlockStep(5)
        this.render()
      }),
    )

    // Step 5
    const fpsSlider = this.container.querySelector('[data-vp-action="fps-slider"]') as HTMLInputElement
    fpsSlider?.addEventListener('input', () => {
      this.extractFps = Number(fpsSlider.value)
      const valSpan = fpsSlider.parentElement?.querySelector('.vp-fps-val')
      if (valSpan) valSpan.textContent = String(this.extractFps)
    })
    this.container.querySelector('[data-vp-action="extract"]')?.addEventListener('click', () => this.doExtractFrames())
    this.container.querySelector('[data-vp-action="remove-bg"]')?.addEventListener('click', () => this.doRemoveBg(false))
    this.container.querySelector('[data-vp-action="remove-bg-canvas"]')?.addEventListener('click', () => this.doRemoveBg(true))
    this.container.querySelector('[data-vp-action="reset-bg"]')?.addEventListener('click', () => {
      this.bgRemoved = false
      this.doExtractFrames()
    })
    this.container.querySelector('[data-vp-action="compose"]')?.addEventListener('click', () => this.doCompose())
    this.container.querySelector('[data-vp-action="export-gif"]')?.addEventListener('click', () => this.doExportGif())
    this.container.querySelector('[data-vp-action="export-zip"]')?.addEventListener('click', () => this.doExportZip())
    this.container.querySelector('[data-vp-action="download-sheet"]')?.addEventListener('click', () => {
      if (this.spritesheetUrl) {
        const a = document.createElement('a')
        a.href = this.spritesheetUrl
        a.download = 'spritesheet.png'
        a.click()
      }
    })

    // Action Library
    this.container.querySelector('[data-vp-action="add-to-lib"]')?.addEventListener('click', () => this.addToActionLib())
    this.container.querySelector('[data-vp-action="toggle-lib-panel"]')?.addEventListener('click', () => {
      this.actionLibExpanded = !this.actionLibExpanded
      this.render()
    })
    this.container.querySelector('[data-vp-action="clear-lib"]')?.addEventListener('click', () => {
      if (confirm('确定清空所有已收录的动作？')) this.clearAllActions()
    })
    this.container.querySelectorAll('[data-vp-rm-action]').forEach(btn =>
      btn.addEventListener('click', () => {
        const key = (btn as HTMLElement).dataset.vpRmAction!
        const [pid, v] = key.split(':')
        this.removeFromActionLib(pid, v)
      }),
    )

    // Step 6
    const scaleSlider = this.container.querySelector('[data-vp-action="scene-scale"]') as HTMLInputElement
    scaleSlider?.addEventListener('input', () => {
      this.sceneScale = Number(scaleSlider.value)
      this.videoHandle?.setScale(this.sceneScale)
      const valSpan = scaleSlider.parentElement?.querySelector('span:last-child')
      if (valSpan) valSpan.textContent = this.sceneScale.toFixed(1)
    })
    this.container.querySelector('[data-vp-action="show-in-scene"]')?.addEventListener('click', () => this.showInScene())
    this.container.querySelector('[data-vp-action="clear-scene"]')?.addEventListener('click', () => {
      this.videoHandle?.remove()
      this.videoHandle = null
      clearDisplayPlanes(this.ctx.engine)
    })

    const fsBox = this.container.querySelector('[data-vp-action="scene-fullscreen"]') as HTMLInputElement | null
    fsBox?.addEventListener('change', () => {
      this.sceneFullscreen = fsBox.checked
      // When the user turns fullscreen OFF we also force trim off, because
      // the trim option is tied to the ultimate-cinematic experience and
      // makes no sense for a scaled preview plane.
      if (!this.sceneFullscreen) this.sceneTrimHalf = false
      this.render()
    })
    const trimBox = this.container.querySelector('[data-vp-action="scene-trim-half"]') as HTMLInputElement | null
    trimBox?.addEventListener('change', () => {
      this.sceneTrimHalf = trimBox.checked
    })
  }

  /**
   * When the user switches action preset (Step 3), reset the Step-6 scene
   * display toggles to sensible per-preset defaults. Ultimate presets ship
   * with the cinematic fullscreen + first-half trim turned on; everything
   * else keeps the classic "plane in front of camera" behaviour.
   * This runs BEFORE render(), so the checkboxes reflect the new defaults.
   */
  private applySceneDefaultsForPreset() {
    const preset = SPRITE_ACTION_PRESETS.find(p => p.id === this.selectedPreset)
    const isUltimate = preset?.id === 'ultimate' || preset?.id === 'ultimate-cinematic'
    this.sceneFullscreen = isUltimate
    this.sceneTrimHalf = isUltimate
  }

  // ── Actions ────────────────────────────────────────────────────

  private async loadCachedTurnaround() {
    if (!this.charImage || this.turnaroundViews) return
    try {
      const cached = await loadTurnaroundCache(this.charImage)
      if (cached) {
        this.turnaroundViews = cached
        if (this.charImage && this.maxStep < 3) this.maxStep = 3 as Step
        this.render()
      }
    } catch {}
  }

  private async generateTurnaround() {
    if (!this.charImage) return
    this.turnaroundGenerating = true
    this.turnaroundError = ''
    this.turnaroundViews = null
    this.render()

    try {
      const b64 = this.charImage.includes(',') ? this.charImage.split(',')[1] : this.charImage
      const result = await characterTurnaround(b64, this.turnaroundStylePrompt || undefined)
      if (result.success && result.views) {
        this.turnaroundViews = result.views
        saveTurnaroundCache(this.charImage!, result.views)
      } else {
        this.turnaroundError = result.error || '三视图生成失败'
      }
    } catch (err: any) {
      this.turnaroundError = err.message || '请求失败'
    }

    this.turnaroundGenerating = false
    this.render()
  }

  private async regenSingleView(viewKey: string, extraDesc: string) {
    if (!this.charImage) return
    const labels: Record<string, string> = { front: '正面', side: '侧面', back: '背面', idle: '待机(45°)' }
    this.turnaroundError = ''

    const card = this.container.querySelector(`[data-vp-regen-view="${viewKey}"]`)
    if (card) { card.textContent = '⏳'; (card as HTMLButtonElement).disabled = true }

    try {
      const b64 = this.charImage.includes(',') ? this.charImage.split(',')[1] : this.charImage
      const result = await regenerateSingleView(b64, viewKey, {
        style: this.turnaroundStylePrompt || undefined,
        extraDesc: extraDesc || undefined,
      })
      if (result.success && result.viewResult) {
        if (!this.turnaroundViews) this.turnaroundViews = {} as any
        ;(this.turnaroundViews as any)[viewKey] = result.viewResult
        saveTurnaroundCache(this.charImage!, this.turnaroundViews!)
      } else {
        this.turnaroundError = `${labels[viewKey]}: ${result.error || '生成失败'}`
      }
    } catch (e: any) {
      this.turnaroundError = e.message || '请求失败'
    }
    this.render()
  }

  private getViewImageBase64(): string {
    const tv = this.turnaroundViews?.[this.selectedView]
    if (tv) return tv.base64
    const src = this.charImage || ''
    return src.includes(',') ? src.split(',')[1] : src
  }

  private async generateVideo() {
    if (!this.charImage) return
    const preset = SPRITE_ACTION_PRESETS.find(p => p.id === this.selectedPreset)
    if (!preset && !this.useCustomPrompt) return

    this.task = { ...EMPTY_TASK, status: 'submitting' }
    this.frames = []
    this.bgRemoved = false
    this.spritesheetUrl = ''
    this.unlockStep(4)
    this.goStep(4)

    try {
      let promptText: string
      const isUltimateType = preset?.id === 'ultimate' || preset?.id === 'ultimate-cinematic'
      if (this.useCustomPrompt && this.customPrompt) {
        promptText = this.customPrompt
      } else if (preset) {
        if (isUltimateType) {
          const gs = globalState.get()
          const ctxPrompt = buildContextPrompt(preset.id, this.selectedView, {
            name: gs.profile.name,
            charClass: gs.profile.charClass,
            combatType: gs.profile.combatType,
            worldSetting: gs.profile.worldSetting,
            gender: gs.profile.gender,
            extraDesc: gs.profile.extraDesc,
          })
          if (!this.ultimatePrompt && preset.id === 'ultimate-cinematic') {
            await this.analyzeUltimateInline()
          }
          promptText = (preset.id === 'ultimate-cinematic' ? this.ultimatePrompt : null)
            || ctxPrompt || preset.viewPrompts?.[this.selectedView] || preset.prompt
        } else {
          promptText = preset.viewPrompts?.[this.selectedView] || preset.prompt
        }
      } else {
        return
      }

      let imageBase64 = this.getViewImageBase64()
      let endFrameBase64: string | undefined
      if (preset?.useEndFrame) endFrameBase64 = imageBase64
      let aspectRatio = preset?.isCinematic ? '16:9' : '1:1'

      if (preset?.isCinematic) {
        const conceptImg = await loadSelectedConcept()
        const raw = conceptImg || this.charImage
        if (raw) {
          imageBase64 = raw.includes(',') ? raw.split(',')[1] : raw
          endFrameBase64 = undefined
          aspectRatio = '16:9'
        }
      } else if (isUltimateType && this.charImage) {
        const viewSrc = this.turnaroundViews?.[this.selectedView]
          ? `data:${this.turnaroundViews[this.selectedView].mime};base64,${this.turnaroundViews[this.selectedView].base64}`
          : this.charImage
        const frameDataUrl = await buildUltimateFrame(viewSrc)
        imageBase64 = frameDataUrl.includes(',') ? frameDataUrl.split(',')[1] : frameDataUrl
        if (preset.useEndFrame) endFrameBase64 = imageBase64
        aspectRatio = '16:9'
      }

      const result = await videoGenerate({
        prompt: promptText,
        image_base64: imageBase64,
        end_frame_base64: endFrameBase64,
        mode: 'std',
        aspect_ratio: aspectRatio,
        duration: preset?.duration || '5',
      })

      if (!result.success || !result.task_id) {
        this.task = { ...EMPTY_TASK, status: 'failed', error: result.error || '提交失败' }
        this.render()
        return
      }

      this.task.status = 'processing'
      this.task.taskId = result.task_id
      this.task.startedAt = Date.now()
      this.render()
      this.startPoll()
    } catch (err: any) {
      this.task = { ...EMPTY_TASK, status: 'failed', error: err.message }
      this.render()
    }
  }

  private async analyzeUltimateInline() {
    if (!this.charImage || this.ultimateAnalyzing) return
    this.ultimateAnalyzing = true
    try {
      const b64 = this.charImage.includes(',') ? this.charImage.split(',')[1] : this.charImage
      const result = await analyzeUltimate(b64)
      if (result.success && result.prompt) {
        this.ultimatePrompt = result.prompt
      }
    } catch {}
    this.ultimateAnalyzing = false
  }

  private async doExtractFrames() {
    if (!this.task.videoUrl || this.extracting) return
    this.extracting = true
    this.extractProgress = '准备中...'
    this.frames = []
    this.bgRemoved = false
    this.spritesheetUrl = ''
    this.render()

    try {
      const proxied = videoProxyUrl(this.task.videoUrl)
      this.frames = await extractFrames(proxied, this.extractFps, (cur, total) => {
        this.extractProgress = `抽帧 ${cur}/${total}`
        this.render()
      })
    } catch (err: any) {
      this.extractProgress = `抽帧失败: ${err.message}`
    }

    this.extracting = false
    this.render()

    if (this.frames.length > 0 && !this.bgRemoved) {
      this.autoRemoveBg()
    }
  }

  private async autoRemoveBg() {
    if (this.removeBgAvailable) {
      this.doRemoveBg(false)
    } else {
      this.doRemoveBg(true)
    }
  }

  private async doRemoveBg(canvasFallback: boolean) {
    if (this.frames.length === 0 || this.removingBg) return
    this.removingBg = true
    this.removeBgProgress = '抠图 0/' + this.frames.length
    this.render()

    const updated = [...this.frames]
    for (let i = 0; i < updated.length; i++) {
      this.removeBgProgress = `抠图 ${i + 1}/${updated.length}`
      this.render()

      try {
        if (canvasFallback) {
          updated[i] = {
            ...updated[i],
            dataUrl: await removeBackgroundCanvas(updated[i].dataUrl),
          }
        } else {
          const base64 = updated[i].dataUrl.split(',')[1]
          const result = await removeBg(base64)
          if (result.success && result.image) {
            updated[i] = { ...updated[i], dataUrl: `data:image/png;base64,${result.image}` }
          }
        }
      } catch {}
    }

    this.frames = updated
    this.bgRemoved = true
    this.removingBg = false
    this.spritesheetUrl = ''
    this.render()
  }

  private async doCompose() {
    if (this.frames.length === 0 || this.composing) return
    this.composing = true
    this.render()

    try {
      this.spritesheetUrl = await composeSpriteSheet(this.frames)
    } catch {}

    this.composing = false
    this.render()
  }

  private async doExportGif() {
    if (this.frames.length === 0) return
    try {
      const blob = await exportGif(this.frames, this.extractFps)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `animation_${Date.now()}.gif`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err: any) {
      console.error('GIF export failed', err)
    }
  }

  private async doExportZip() {
    if (this.frames.length === 0) return
    try {
      const blob = await exportPngZip(this.frames)
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `sprite_sequence_${Date.now()}.zip`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (err: any) {
      console.error('ZIP export failed', err)
    }
  }

  private showInScene() {
    if (!this.task.videoUrl) return
    this.videoHandle?.remove()
    clearDisplayPlanes(this.ctx.engine)
    const proxied = videoProxyUrl(this.task.videoUrl)
    if (this.sceneFullscreen) {
      // Fullscreen path: camera-attached, covers viewport, optionally trims
      // to the first half of the clip. Scale slider is intentionally
      // bypassed — the plane auto-sizes to the frustum.
      this.videoHandle = displayUltimateInScene(this.ctx.engine, proxied, {
        fit: 'cover',
        trimFirstHalf: this.sceneTrimHalf,
      })
    } else {
      this.videoHandle = displayVideoInScene(this.ctx.engine, proxied)
      this.videoHandle.setScale(this.sceneScale)
    }
  }

  // ── Polling ────────────────────────────────────────────────────

  private startPoll() {
    this.stopPoll()
    this.pollTimer = window.setInterval(() => this.pollOnce(), 5000)
    this.uiRefreshTimer = window.setInterval(() => this.render(), 1000)
  }

  private stopPoll() {
    if (this.pollTimer !== null) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.uiRefreshTimer !== null) { clearInterval(this.uiRefreshTimer); this.uiRefreshTimer = null }
  }

  private async pollOnce() {
    if (!this.task.taskId || this.task.status !== 'processing') { this.stopPoll(); return }
    this.task.pollAttempt++

    const elapsed = this.task.startedAt ? (Date.now() - this.task.startedAt) / 1000 : 0
    if (elapsed > MAX_POLL_SECONDS) {
      this.task.status = 'failed'
      this.task.error = `超时（已等待 ${Math.floor(elapsed / 60)} 分钟）`
      this.stopPoll()
      this.render()
      return
    }

    try {
      const result = await videoQuery(this.task.taskId)
      if (!result.success) {
        if (this.task.pollAttempt > 60) {
          this.task.status = 'failed'
          this.task.error = result.error || '查询失败'
          this.stopPoll()
        }
        this.render()
        return
      }

      if (result.task_status === 'succeed' && result.videos?.length) {
        this.task.status = 'succeed'
        this.task.videoUrl = result.videos[0].url
        this.task.videoDuration = result.videos[0].duration
        this.stopPoll()
        this.unlockStep(4)

        saveHistory({
          id: this.task.taskId,
          presetId: this.selectedPreset,
          view: this.selectedView,
          videoUrl: this.task.videoUrl,
          createdAt: Date.now(),
        })
        this.history = loadHistory()
      } else if (result.task_status === 'failed') {
        this.task.status = 'failed'
        this.task.error = result.task_status_msg || '生成失败'
        this.stopPoll()
      }
    } catch (err: any) {
      console.warn('[VideoUI] poll error:', err.message)
    }

    this.render()
  }

  // ── Action Library ──────────────────────────────────────────────

  private async refreshActionLib() {
    try { this.actionLib = await loadAllActions() } catch { this.actionLib = [] }
  }

  private isInLib(presetId: string, view: string): boolean {
    return this.actionLib.some(a => a.presetId === presetId && a.view === view)
  }

  private async addToActionLib() {
    const preset = SPRITE_ACTION_PRESETS.find(p => p.id === this.selectedPreset)
    if (!preset || !this.task.videoUrl) return
    const entry: ActionLibEntry = {
      presetId: preset.id,
      presetNameZh: preset.nameZh,
      view: this.selectedView,
      videoUrl: this.task.videoUrl,
      spritesheetUrl: this.spritesheetUrl || undefined,
      isCinematic: !!preset.isCinematic,
      addedAt: Date.now(),
    }
    await saveAction(entry)
    await this.refreshActionLib()
    this.render()
  }

  private async removeFromActionLib(presetId: string, view: string) {
    await removeAction(presetId, view)
    await this.refreshActionLib()
    this.render()
  }

  private async clearAllActions() {
    await clearActionLib()
    await this.refreshActionLib()
    this.render()
  }

  // ── CSS ────────────────────────────────────────────────────────

  private injectCSS() {
    const existing = document.getElementById(VideoUI.CSS_ID)
    if (existing) existing.remove()
    const s = document.createElement('style')
    s.id = VideoUI.CSS_ID
    s.textContent = VP_CSS
    document.head.appendChild(s)
  }
}

// ── Styles ───────────────────────────────────────────────────────────

const VP_CSS = `
.vp-panel { font-family: system-ui, sans-serif; font-size: 12px; color: var(--text-primary); }
.vp-header { display: flex; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.07); }
.vp-title { font-size: 15px; font-weight: 700; color: #d4ff48; line-height: normal; }
.vp-header-pill {
  margin-left: auto; padding: 3px 8px;
  border: 1px solid rgba(212,255,72,0.28);
  border-radius: 999px; background: rgba(212,255,72,0.08);
  color: #d4ff48; font-size: 11px; font-weight: 700;
  line-height: 1.2; letter-spacing: .04em; white-space: nowrap;
}
.vp-icon-svg {
  width: 16px; height: 16px;
  display: inline-block; flex: 0 0 auto;
  fill: none; stroke: currentColor; stroke-width: 2;
  stroke-linecap: round; stroke-linejoin: round;
  vertical-align: -0.22em;
}

/* Step navigation */
.vp-steps { display: flex; gap: 4px; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.07); }
.vp-step-btn { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 7px 2px; border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; background: rgba(255,255,255,0.018); color: var(--text-secondary); font-size: 10px; cursor: pointer; font-family: inherit; transition: all 0.15s; }
.vp-step-btn:hover:not(.locked) { background: var(--bg-hover); color: var(--text-primary); }
.vp-step-btn.active { color: var(--accent); border-color: rgba(212,255,72,0.26); background: rgba(212,255,72,0.08); font-weight: 600; }
.vp-step-btn.locked { opacity: 0.35; cursor: not-allowed; }
.vp-step-btn.done { color: var(--text-primary); }
.vp-step-num { width: 20px; height: 20px; border-radius: 50%; background: var(--bg-hover); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 600; }
.vp-step-btn.active .vp-step-num { background: var(--accent); color: var(--color-text-on-bright-primary); }
.vp-step-btn.done .vp-step-num { background: var(--accent); color: var(--color-text-on-bright-primary); }
.vp-step-label { white-space: nowrap; }

/* Body */
.vp-body { padding: 0 0 10px; }
.vp-section { margin: 8px 10px 0; padding: 10px; border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; background: rgba(255,255,255,0.018); box-shadow: inset 0 0 0 1px rgba(0,0,0,0.16); }
.vp-section:last-child { border-bottom: none; }
.vp-section-title { font-size: 12px; font-weight: 800; color: var(--accent); letter-spacing: 0.03em; margin-bottom: 7px; }
.vp-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.5; }

/* Empty state */
.vp-empty { padding: 40px 0; text-align: center; }
.vp-empty-icon { font-size: 36px; margin-bottom: 8px; }
.vp-empty-text { color: var(--text-secondary); font-size: 12px; }

/* Character preview */
.vp-char-preview { display: flex; gap: 10px; align-items: center; padding: 8px 0; margin-bottom: 10px; }
.vp-char-img { width: 80px; height: 80px; object-fit: cover; border-radius: var(--radius); border: 1px solid var(--border); }
.vp-char-info { flex: 1; }
.vp-char-name { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.vp-char-meta { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }

/* Presets grid */
.vp-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.vp-preset { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-hover); color: var(--text-secondary); cursor: pointer; font-size: 10px; font-family: inherit; transition: all 0.15s; }
.vp-preset:hover { background: var(--bg-active); color: var(--text-primary); }
.vp-preset.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim, rgba(212,255,72,0.1)); }
.vp-preset.done { border-color: var(--color-status-success); }
.vp-preset-badge { position: absolute; top: -4px; right: -4px; width: 16px; height: 16px; border-radius: 50%; background: var(--color-status-success); color: var(--color-text-primary); font-size: 9px; line-height: 16px; text-align: center; font-weight: 700; }
.vp-preset-icon { font-size: 18px; }
.vp-preset-name { font-size: 10px; white-space: nowrap; }
.vp-lib-stats { font-weight: 400; color: var(--accent); font-size: 10px; margin-left: 4px; }

/* Turnaround grid */
.vp-ta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.vp-ta-card { text-align: center; }
.vp-ta-label { font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
.vp-ta-img { width: 100%; border-radius: var(--radius); border: 1px solid var(--border); }
.vp-ta-actions {
  display: flex; gap: 4px; margin-top: 4px; align-items: center;
}
.vp-ta-desc-input {
  flex: 1; padding: 4px 6px; font-size: 10px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--bg-hover); color: var(--text-primary);
  font-family: inherit; outline: none; min-width: 0;
}
.vp-ta-desc-input:focus { border-color: var(--accent); }
.vp-ta-regen-btn {
  flex-shrink: 0; width: 26px; height: 26px; border: 1px solid var(--border);
  border-radius: 4px; background: var(--bg-hover); cursor: pointer;
  display: flex; align-items: center; justify-content: center; font-size: 12px;
  transition: background 0.15s;
}
.vp-ta-regen-btn .vp-icon-svg { width: 13px; height: 13px; }
.vp-ta-regen-btn:hover { background: var(--accent); }
.vp-hint { font-size: 10px; color: var(--text-secondary); opacity: 0.7; margin-top: 4px; }

/* View row */
.vp-view-row { display: flex; gap: 4px; }
.vp-view-btn { flex: 1; padding: 6px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-hover); color: var(--text-secondary); cursor: pointer; font-size: 11px; font-family: inherit; transition: all 0.15s; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.vp-view-btn:hover { background: var(--bg-active); }
.vp-view-btn.active { border-color: var(--accent); color: var(--accent); background: var(--accent-dim, rgba(212,255,72,0.1)); }
.vp-view-thumb { width: 100%; max-height: 60px; object-fit: contain; border-radius: 3px; }

/* Toggle */
.vp-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 11px; color: var(--text-secondary); margin-bottom: 6px; }
.vp-toggle input { accent-color: var(--accent); }

/* Textarea */
.vp-textarea { width: 100%; min-height: 60px; background: var(--bg-hover); border: 1px solid var(--border); color: var(--text-primary); padding: 8px; border-radius: var(--radius); font-size: 12px; resize: vertical; outline: none; font-family: inherit; box-sizing: border-box; }
.vp-textarea:focus { border-color: var(--accent); }

/* Prompt result */
.vp-prompt-result { background: var(--bg-hover); padding: 8px; border-radius: var(--radius); font-size: 11px; line-height: 1.6; white-space: pre-wrap; border: 1px solid var(--border); }

/* Buttons */
.vp-btn { display: inline-flex; align-items:center; justify-content:center; gap:6px; width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-hover); color: var(--text-primary); font-size: 13px; cursor: pointer; text-align: center; text-decoration: none; transition: background 0.15s; font-family: inherit; box-sizing: border-box; }
.vp-btn:hover { background: var(--bg-active); }
.vp-btn-primary { background: var(--accent); color: var(--color-text-on-bright-primary); border-color: var(--accent); font-weight: 600; }
.vp-btn-primary:hover { background: var(--accent-hover); }
.vp-btn-disabled { opacity: 0.5; pointer-events: none; }
.vp-btn-sm { display: inline-flex; width: auto; padding: 5px 10px; font-size: 11px; }
.vp-btn-xs { display: inline-flex; width: auto; padding: 3px 8px; font-size: 10px; }
.vp-btn-accent { background: var(--accent); color: var(--color-text-on-bright-primary); border-color: var(--accent); font-weight: 600; }
.vp-btn-accent:hover { background: var(--accent-hover); }
.vp-btn-done { background: var(--color-status-success); color: var(--color-text-primary); border-color: var(--color-status-success); opacity: 0.8; cursor: default; }
.vp-actions-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.vp-export-row { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }

/* Action Library panel */
.vp-lib-section { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 8px; }
.vp-lib-toggle { display: inline-flex; align-items:center; gap:6px; width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-hover); color: var(--text-primary); font-size: 12px; cursor: pointer; text-align: left; font-family: inherit; transition: background 0.15s; }
.vp-lib-toggle:hover { background: var(--bg-active); }
.vp-lib-empty { padding: 16px 0; text-align: center; color: var(--text-secondary); font-size: 11px; }
.vp-lib-list { margin-top: 6px; display: flex; flex-direction: column; gap: 2px; }
.vp-lib-item { display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: var(--radius); background: var(--bg-hover); font-size: 11px; }
.vp-lib-item-name { font-weight: 600; color: var(--text-primary); min-width: 48px; }
.vp-lib-item-view { color: var(--accent); font-size: 10px; }
.vp-lib-item-type { color: var(--text-secondary); font-size: 10px; background: var(--bg-active); padding: 1px 5px; border-radius: 3px; }
.vp-lib-item-date { flex: 1; text-align: right; color: var(--text-secondary); font-size: 10px; }
.vp-lib-item-rm { border: none; background: transparent; color: var(--text-secondary); cursor: pointer; font-size: 12px; padding: 2px 4px; border-radius: 3px; }
.vp-lib-item-rm:hover { background: color-mix(in srgb, var(--color-status-error) 18%, transparent); color: var(--color-status-error); }

/* Status */
.vp-status-card { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 32px 0; }
.vp-status-inline { font-size: 11px; color: var(--text-secondary); padding: 4px 0; }
.vp-success { color: var(--accent); }
.vp-error { padding: 8px 0; color: var(--danger); font-size: 11px; }

/* Spinner */
.vp-spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: vp-spin 0.8s linear infinite; }
@keyframes vp-spin { to { transform: rotate(360deg); } }

/* Progress */
.vp-progress { height: 4px; background: var(--bg-hover); border-radius: 2px; overflow: hidden; width: 100%; max-width: 200px; }
.vp-progress-bar { height: 100%; background: var(--accent); transition: width 0.3s; }

/* Video */
.vp-video-wrap { margin-bottom: 8px; }
.vp-video { width: 100%; border-radius: var(--radius); border: 1px solid var(--border); }

/* Param row */
.vp-param-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.vp-param-row label { font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
.vp-slider { flex: 1; accent-color: var(--accent); }
.vp-fps-val { font-size: 11px; color: var(--text-primary); min-width: 20px; text-align: right; }

/* Frames */
.vp-frame-count { font-size: 11px; color: var(--accent); margin-bottom: 4px; }
.vp-frame-strip { display: flex; gap: 3px; overflow-x: auto; padding: 4px 0; }
.vp-frame-thumb { width: 48px; height: 48px; object-fit: cover; border-radius: 3px; border: 1px solid var(--border); flex-shrink: 0; }
.vp-frame-more { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border-radius: 3px; background: var(--bg-hover); color: var(--text-secondary); font-size: 10px; flex-shrink: 0; }

/* Spritesheet */
.vp-spritesheet-wrap { margin: 6px 0; overflow: hidden; border-radius: var(--radius); border: 1px solid var(--border); }
.vp-spritesheet-img { width: 100%; display: block; image-rendering: pixelated; }

/* History */
.vp-history-row { display: flex; align-items: center; gap: 6px; padding: 3px 0; font-size: 11px; }
.vp-history-label { flex: 1; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vp-history-time { color: var(--text-secondary); font-size: 10px; }
`

// ── Pipeline Export ──────────────────────────────────────────────────

const ui = new VideoUI()

const pipeline: IPipeline = {
  meta,
  async init(ctx) { ui.init(ctx) },
  dispose() { ui.unmount() },
  resetForNewCharacter() { ui.resetToFirstStep() },
  createUI(container) { ui.mount(container) },
  destroyUI() { ui.unmount() },
  getDefaultParams() { return {} },
}

export default pipeline
