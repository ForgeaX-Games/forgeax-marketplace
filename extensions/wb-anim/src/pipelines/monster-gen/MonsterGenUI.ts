import type { PipelinePanels } from '../../core/types'
import {
  MONSTER_TREE, CATEGORY_ICONS, CATEGORY_DESCRIPTIONS, SUBCATEGORY_ICONS,
  BODY_TYPES, MORPH_LABELS,
  getMorph, getRaces, getBodyType,
} from './classification'
import {
  generateHero, startPipeline, connectSSE, getHistory, heroUrl, gifUrl,
  type HistoryEntry,
} from './monster-api'
import { injectStyles, removeStyles } from './styles'

/* ── Constants ──────────────────────────────────────────────────── */

const STORAGE_KEY = 'monster-gen:cfg'

const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
const DIR_LABELS: Record<string, string> = {
  N: '北', NE: '东北', E: '东', SE: '东南',
  S: '南', SW: '西南', W: '西', NW: '西北',
}
const MIRROR_DIRS = new Set(['W', 'NW', 'SW'])
const ANIMS = ['idle', 'walk', 'atk', 'hit', 'die'] as const

/*
 * 不同游戏视角下需要的方向数量完全不同：
 *   1 = 单方向（仅正面立绘，美术型）
 *   2 = 横版 2 方向（L / R，side-scroller）
 *   4 = 四方向（N/E/S/W，老式 RPG / Zelda 俯视）
 *   8 = 八方向（完整方向，Hades / 暗黑类）
 * 选 2 / 4 时前端只渲染对应行，后端也只对这些方向跑动画。
 */
type DirCount = 1 | 2 | 4 | 8
const DIR_PRESETS: Record<DirCount, readonly string[]> = {
  1: ['S'],
  2: ['E', 'W'],
  4: ['N', 'E', 'S', 'W'],
  8: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
}

function isMirrorDir(dir: string, count: DirCount): boolean {
  if (count === 2) return dir === 'W'
  if (count === 8) return MIRROR_DIRS.has(dir)
  return false
}

const STYLES = [
  { v: 'CEL_2D', label: 'CEL 2D' },
  { v: 'PIXEL', label: '像素风' },
  /*
   * 原图画风 — 必须配合「上传参考图」使用。Gemini 会保留上传图的
   * 线稿 / 着色 / 调色 / 渲染语言；下游逐帧动画也会引用该 hero 作为
   * 参考，因此整套序列帧会沿用同一风格。
   */
  { v: 'MATCH_REFERENCE', label: '🪞 原图画风' },
]

type DirStatus = 'waiting' | 'generating' | 'done' | 'mirror' | 'error'
type Step = 1 | 2

/* ── State ──────────────────────────────────────────────────────── */

interface MgState {
  name: string
  desc: string
  color1: string; color2: string; color3: string
  body: string
  bodyPreset: string
  palette: string
  cat1: string; cat2: string; cat3: string
  style: string; morph: string; angle: string
  /**
   * 生成的立绘目标分辨率（正方形边长）。Gemini 本身输出约 1024 左右；
   * 512 = 兼容旧数据 / 游戏资源直出，1024 = 默认高清，2048 = 配合
   * `upscale` 做 AI 高清化后再缩放。
   */
  heroSize: 512 | 1024 | 2048
  /** true 时在后端用 LANCZOS 升采样到目标尺寸，视觉上更锐利。 */
  upscale: boolean
  /** 动画阶段的方向数，见 DirCount */
  dirCount: DirCount
  model: string; apiKey: string; apiBase: string
  currentStep: Step
  currentMonster: string
}

function loadState(): MgState {
  const defaults: MgState = {
    name: '', desc: '',
    color1: '', color2: '', color3: '',
    body: '', bodyPreset: '',
    palette: '',
    cat1: '', cat2: '', cat3: '',
    // '' == 让模型自由发挥 / 不强制视角
    style: '', morph: 'quadruped', angle: '',
    heroSize: 1024,
    upscale: false,
    dirCount: 2,
    model: 'nanobanana-pro',
    apiKey: '',
    apiBase: '',
    currentStep: 1,
    currentMonster: '',
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return defaults
}

function saveState(s: MgState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

/*
 * Shrink a dataURL image to something Gemini can chew on (and that won't
 * blow up the Vite → Flask JSON proxy — multi-MB base64 bodies were causing
 * "socket hang up" errors). We cascade 768 / 512 / 384 until the base64
 * payload is under maxKB. Falls back to the original if anything fails.
 */
function resizeDataUrl(dataUrl: string, maxW: number, maxH: number, quality: number): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(maxW / img.width, maxH / img.height, 1)
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const c = document.createElement('canvas')
        c.width = w; c.height = h
        c.getContext('2d')!.drawImage(img, 0, 0, w, h)
        const out = c.toDataURL('image/jpeg', quality)
        resolve(out && out.length > 50 ? out : dataUrl)
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

async function compressUploadForMonsterApi(dataUrl: string, maxKB = 300): Promise<string> {
  let out = await resizeDataUrl(dataUrl, 768, 768, 0.75)
  let b64Len = out.replace(/^data:[^;]+;base64,/, '').length
  if (b64Len > maxKB * 1370) out = await resizeDataUrl(dataUrl, 512, 512, 0.65)
  b64Len = out.replace(/^data:[^;]+;base64,/, '').length
  if (b64Len > maxKB * 1370) out = await resizeDataUrl(dataUrl, 384, 384, 0.55)
  return out
}

/* ── Main UI Class ──────────────────────────────────────────────── */

export class MonsterGenUI {
  private panels!: PipelinePanels
  private container!: HTMLElement
  private state: MgState
  private es: EventSource | null = null
  private generating = false
  private dirStatus: Record<string, DirStatus> = {}
  private history: HistoryEntry[] = []

  /*
   * 用户上传的 boss 参考图（dataURL）。有意不走 localStorage —— base64 图
   * 动辄几 MB，塞进 localStorage 容易撑爆配额；刷新后丢失是可以接受的
   * UX，用户重新上传即可。这个字段只在当前会话里，作为生成立绘时的
   * 可选 multimodal 输入。
   */
  private uploadImage: string | null = null

  // DOM refs
  private heroBtn!: HTMLButtonElement
  private animBtn!: HTMLButtonElement
  private logEl!: HTMLElement
  private progressFill!: HTMLElement
  private progressPct!: HTMLElement
  private stageEl!: HTMLElement
  private historyList!: HTMLElement
  private previewImg!: HTMLImageElement
  private previewLabel!: HTMLElement
  private previewPlaceholder!: HTMLElement
  private dirRows: Record<string, HTMLElement> = {}
  private dirAnimContainers: Record<string, HTMLElement> = {}
  private dirBadges: Record<string, HTMLElement> = {}

  constructor() {
    this.state = loadState()
    // 初始状态按当前 dirCount 初始化——后面 refreshDirList 会覆盖重置。
    for (const d of DIR_PRESETS[this.state.dirCount]) {
      this.dirStatus[d] = isMirrorDir(d, this.state.dirCount) ? 'mirror' : 'waiting'
    }
  }

  mount(container: HTMLElement, panels: PipelinePanels): void {
    injectStyles()
    this.container = container
    this.panels = panels
    // Center / right / bottom MUST build first: buildLeftPanel may restore
    // a previously-generated hero via showHeroInCenter, which needs the
    // center panel's previewImg element to already exist.
    this.buildCenterPanel()
    this.buildRightPanel()
    this.buildBottomPanel()
    this.buildLeftPanel()
    this.loadHistory()

    this.panels.center.classList.add('active', 'mg-with-bottom')
    this.panels.center.parentElement?.classList.add('has-right')
    this.panels.right.classList.add('visible')
    this.panels.bottom.classList.add('visible', 'has-right')

    if (this.state.currentMonster) {
      this.loadMonsterPreview(this.state.currentMonster)
    }
  }

  unmount(): void {
    this.es?.close()
    this.es = null
    if (this.panels) {
      this.panels.center.classList.remove('active', 'mg-with-bottom')
      this.panels.center.parentElement?.classList.remove('has-right')
      this.panels.center.innerHTML = ''
      this.panels.right.classList.remove('visible')
      this.panels.right.innerHTML = ''
      this.panels.bottom.classList.remove('visible', 'has-right')
      this.panels.bottom.innerHTML = ''
    }
    removeStyles()
  }

  /* ══════════════════════════════════════════════════════════════════
     LEFT PANEL: Config Form
     ══════════════════════════════════════════════════════════════════ */

  private buildLeftPanel(): void {
    const s = this.state
    const el = this.container
    el.innerHTML = ''

    const form = document.createElement('div')
    form.className = 'mg-config'

    form.innerHTML = `
      <div class="mg-section-title">基本信息</div>
      <div><label>怪物名称 <span class="mg-label-hint">(可选，留空自动生成)</span></label>
        <input id="mgName" value="${esc(s.name)}" placeholder="例: 变异狼"></div>

      <div class="mg-section-title">分类 <span class="mg-label-hint" style="text-transform:none;letter-spacing:0">点选即可，无需手写</span></div>
      <div class="mg-subsection">
        <div class="mg-label">大类</div>
        <div class="mg-cat-grid" id="mgCat1Cards">${this.renderCat1Cards()}</div>
      </div>
      <div class="mg-subsection">
        <div class="mg-label">
          <span>子类</span>
          <span class="mg-label-hint" id="mgCat2Hint">${esc(s.cat1 || '先选大类')}</span>
          <span class="mg-morph-pill" id="mgMorphPill" style="${s.cat1 && s.cat2 ? '' : 'display:none'}">${esc(MORPH_LABELS[s.morph] || s.morph)}</span>
        </div>
        <div class="mg-chips" id="mgCat2Chips">${this.renderCat2Chips()}</div>
      </div>
      <div class="mg-subsection">
        <div class="mg-label">
          <span>种族</span>
          <span class="mg-label-hint" id="mgCat3Hint">${esc(s.cat2 || '先选子类')}</span>
        </div>
        <div class="mg-chips" id="mgCat3Chips">${this.renderCat3Chips()}</div>
      </div>

      <div class="mg-section-title">体型</div>
      <div class="mg-chips" id="mgBodyChips">${this.renderBodyChips()}</div>
      <div><label>自定义体型 <span class="mg-label-hint">(可选，覆盖上方选择)</span></label>
        <input id="mgBody" value="${esc(s.body)}" placeholder="留空则使用上方选择"></div>

      <div class="mg-section-title">视角 <span class="mg-label-hint" style="text-transform:none;letter-spacing:0">(可选，不选则由模型/参考图决定)</span></div>
      <div><label>视角模式</label><select id="mgAngle">
        <option value="" ${!s.angle ? 'selected' : ''}>— 不指定（尊重参考图 / 模型自由发挥）—</option>
        <optgroup label="俯视角">
          <option value="topdown_45" ${s.angle === 'topdown_45' ? 'selected' : ''}>俯视 45° (类 Hades / 暗黑)</option>
          <option value="topdown_60" ${s.angle === 'topdown_60' ? 'selected' : ''}>俯视 60° (高俯角 / RTS)</option>
          <option value="topdown_30" ${s.angle === 'topdown_30' ? 'selected' : ''}>俯视 30° (低俯角 / 近透视)</option>
        </optgroup>
        <optgroup label="横版 (侧面)">
          <option value="side" ${s.angle === 'side' ? 'selected' : ''}>横板侧面 (平台跳跃 / 横版动作)</option>
        </optgroup>
      </select></div>

      <div class="mg-section-title">动画方向数 <span class="mg-label-hint" style="text-transform:none;letter-spacing:0">(序列帧阶段用)</span></div>
      <div class="mg-chips" data-field="dirCount">
        <div class="mg-chip ${s.dirCount === 1 ? 'on' : ''}" data-v="1">1 方向</div>
        <div class="mg-chip ${s.dirCount === 2 ? 'on' : ''}" data-v="2">2 方向 · 横版 L/R</div>
        <div class="mg-chip ${s.dirCount === 4 ? 'on' : ''}" data-v="4">4 方向</div>
        <div class="mg-chip ${s.dirCount === 8 ? 'on' : ''}" data-v="8">8 方向</div>
      </div>

      <div class="mg-section-title">立绘尺寸 <span class="mg-label-hint" style="text-transform:none;letter-spacing:0">(可放大高清化)</span></div>
      <div class="mg-chips" data-field="heroSize">
        <div class="mg-chip ${s.heroSize === 512 ? 'on' : ''}" data-v="512">512 px</div>
        <div class="mg-chip ${s.heroSize === 1024 ? 'on' : ''}" data-v="1024">1024 px · 推荐</div>
        <div class="mg-chip ${s.heroSize === 2048 ? 'on' : ''}" data-v="2048">2048 px · 2K</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
        <input type="checkbox" id="mgUpscale" ${s.upscale ? 'checked' : ''} />
        <label for="mgUpscale" style="margin:0;cursor:pointer">AI 高清化（LANCZOS 升采样，按上方目标尺寸放大）</label>
      </div>

      <div class="mg-section-title">风格 <span class="mg-label-hint" style="text-transform:none;letter-spacing:0">(可选，不选则跟随参考图或默认 CEL_2D)</span></div>
      <div class="mg-chips" data-field="style">
        <div class="mg-chip ${!s.style ? 'on' : ''}" data-v="">— 不指定 —</div>
        ${STYLES.map(st => `<div class="mg-chip ${s.style === st.v ? 'on' : ''}" data-v="${st.v}">${st.label}</div>`).join('')}
      </div>

      <div class="mg-section-title">附加描述 <span class="mg-label-hint" style="text-transform:none;letter-spacing:0">(可选，留空仅使用上方分类)</span></div>
      <div><textarea id="mgDesc" rows="3" placeholder="可留空。需要特定细节 (如额外肢体、武器、氛围) 时在此补充...">${esc(s.desc)}</textarea></div>

      <div class="mg-section-title">参考图 <span class="mg-label-hint" style="text-transform:none;letter-spacing:0">(可选，上传 boss 概念图 / 截图)</span></div>
      <div class="mg-upload-area" id="mgUploadArea">
        <div class="mg-upload-empty" id="mgUploadEmpty">
          <div style="font-size:20px;margin-bottom:4px">📤</div>
          <div>点击或拖拽上传参考图</div>
          <div class="mg-label-hint" style="text-transform:none;letter-spacing:0;margin-top:4px">
            上传后 AI 会对齐 silhouette / 配色 / 标记；<br/>配合「🪞 原图画风」可保留原图的线稿与画风
          </div>
        </div>
        <div class="mg-upload-filled" id="mgUploadFilled" style="display:none">
          <img id="mgUploadThumb" class="mg-upload-thumb" alt="参考图" />
          <button type="button" class="mg-upload-clear" id="mgUploadClear" title="移除参考图">✕</button>
        </div>
        <input type="file" id="mgUploadInput" accept="image/*" style="display:none" />
      </div>

      <div class="mg-section-title">操作</div>
      <button class="mg-btn" id="mgHeroBtn">🎨 第一步：生成立绘</button>
      <button class="mg-btn mg-btn-secondary" id="mgAnimBtn" disabled>▶ 第二步：生成序列帧 (需先有立绘)</button>
    `

    el.appendChild(form)

    this.heroBtn = form.querySelector('#mgHeroBtn') as HTMLButtonElement
    this.animBtn = form.querySelector('#mgAnimBtn') as HTMLButtonElement
    this.heroBtn.addEventListener('click', () => this.onGenerateHero())
    this.animBtn.addEventListener('click', () => this.onGenerateAnimation())

    const inputIds = ['mgName', 'mgDesc', 'mgBody', 'mgAngle']
    for (const id of inputIds) {
      form.querySelector(`#${id}`)?.addEventListener('input', () => this.syncState())
    }

    this.bindCat1Cards()
    this.bindCat2Chips()
    this.bindCat3Chips()
    this.bindBodyChips()

    // 单选 chip 组——点击即切换 on，支持 `""` 作为"不指定"。
    const wireSingleSelectChips = (field: string) => {
      form.querySelectorAll(`[data-field="${field}"]`).forEach(group => {
        group.querySelectorAll<HTMLElement>('.mg-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            group.querySelectorAll('.mg-chip').forEach(c => c.classList.remove('on'))
            chip.classList.add('on')
            this.syncState()
          })
        })
      })
    }
    wireSingleSelectChips('style')
    wireSingleSelectChips('dirCount')
    wireSingleSelectChips('heroSize')

    form.querySelector<HTMLInputElement>('#mgUpscale')?.addEventListener('change', () => this.syncState())

    this.wireUploadZone()

    if (s.currentMonster) {
      this.showHeroInCenter(heroUrl(s.currentMonster))
      this.animBtn.disabled = false
      this.animBtn.textContent = `▶ 第二步：生成序列帧 (${s.currentMonster})`
    }
  }

  /* ── Upload zone wiring ───────────────────────────────────────── */

  private wireUploadZone(): void {
    const area = this.container.querySelector<HTMLElement>('#mgUploadArea')
    const input = this.container.querySelector<HTMLInputElement>('#mgUploadInput')
    const empty = this.container.querySelector<HTMLElement>('#mgUploadEmpty')
    const filled = this.container.querySelector<HTMLElement>('#mgUploadFilled')
    const thumb = this.container.querySelector<HTMLImageElement>('#mgUploadThumb')
    const clear = this.container.querySelector<HTMLButtonElement>('#mgUploadClear')
    if (!area || !input || !empty || !filled || !thumb || !clear) return

    const readFile = (f: File | undefined | null) => {
      if (!f) {
        this.appendLog('未选取文件', 'info')
        return
      }
      if (!f.type.startsWith('image/')) {
        this.appendLog(`仅支持图片文件（当前：${f.type || '未知类型'}）`, 'error')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = reader.result as string
        this.uploadImage = dataUrl
        thumb.src = dataUrl
        empty.style.display = 'none'
        filled.style.display = ''
        this.appendLog(`参考图已加载: ${f.name} (${Math.round(f.size / 1024)}KB)`, 'info')
      }
      reader.onerror = () => this.appendLog(`文件读取失败: ${reader.error?.message || '未知错误'}`, 'error')
      reader.readAsDataURL(f)
    }

    empty.addEventListener('click', () => input.click())
    input.addEventListener('change', () => {
      readFile(input.files?.[0])
      // Reset so selecting the same file twice still fires `change`.
      input.value = ''
    })

    clear.addEventListener('click', (e) => {
      e.stopPropagation()
      this.uploadImage = null
      input.value = ''
      empty.style.display = ''
      filled.style.display = 'none'
    })

    /*
     * Drag-and-drop wiring.
     *
     * HTML5 drag events fire on every child element as you move across
     * them, so a naive `dragleave` handler on `area` will constantly
     * flicker the highlight and — worse — clear it prematurely right
     * before `drop` fires. We track enter/leave with a counter so the
     * highlight only disappears once the cursor has truly left the zone.
     */
    let dragDepth = 0
    const setDragging = (on: boolean) => {
      if (on) area.classList.add('drag')
      else area.classList.remove('drag')
    }
    area.addEventListener('dragenter', (e) => {
      e.preventDefault()
      dragDepth++
      setDragging(true)
    })
    area.addEventListener('dragover', (e) => {
      // Must preventDefault for the `drop` event to fire.
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    })
    area.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1)
      if (dragDepth === 0) setDragging(false)
    })
    area.addEventListener('drop', (e) => {
      e.preventDefault()
      dragDepth = 0
      setDragging(false)
      const dt = e.dataTransfer
      if (!dt) return
      // Prefer files from DataTransfer.files, fall back to items iterator.
      const file = dt.files?.[0] || Array.from(dt.items || [])
        .filter(it => it.kind === 'file')
        .map(it => it.getAsFile())
        .find(f => f && f.type.startsWith('image/')) || null
      readFile(file)
    })

    /*
     * Bonus UX: paste clipboard image when the upload zone is focused or
     * hovered. Many users copy a boss screenshot and paste — supporting
     * this costs almost nothing.
     */
    area.setAttribute('tabindex', '0')
    area.addEventListener('paste', (e) => {
      const items = (e as ClipboardEvent).clipboardData?.items
      if (!items) return
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          e.preventDefault()
          readFile(it.getAsFile())
          return
        }
      }
    })

    /*
     * Stop the browser from navigating away when the user drops an image
     * outside the zone by accident. Registered once per UI instance; we
     * do NOT stop propagation so scoped listeners inside `area` still win.
     */
    if (!(window as any).__mgGlobalDropGuarded) {
      ;(window as any).__mgGlobalDropGuarded = true
      window.addEventListener('dragover', (e) => { e.preventDefault() })
      window.addEventListener('drop', (e) => { e.preventDefault() })
    }
  }

  /* ── Classification renderers ─────────────────────────────────── */

  private renderCat1Cards(): string {
    const s = this.state
    return Object.keys(MONSTER_TREE).map(k => `
      <button class="mg-cat-card ${k === s.cat1 ? 'on' : ''}" data-cat1="${esc(k)}" type="button">
        <span class="mg-cat-icon">${CATEGORY_ICONS[k] || '❓'}</span>
        <span class="mg-cat-name">${esc(k)}</span>
        <span class="mg-cat-desc">${esc(CATEGORY_DESCRIPTIONS[k] || '')}</span>
      </button>
    `).join('')
  }

  private renderCat2Chips(): string {
    const s = this.state
    if (!s.cat1 || !MONSTER_TREE[s.cat1]) {
      return '<div class="mg-chips-empty">请先选择大类</div>'
    }
    return Object.keys(MONSTER_TREE[s.cat1]).map(k => `
      <button class="mg-chip ${k === s.cat2 ? 'on' : ''}" data-cat2="${esc(k)}" type="button">
        ${SUBCATEGORY_ICONS[k] || ''} ${esc(k)}
      </button>
    `).join('')
  }

  private renderCat3Chips(): string {
    const s = this.state
    const races = getRaces(s.cat1, s.cat2)
    if (!races.length) {
      return '<div class="mg-chips-empty">请先选择子类</div>'
    }
    return races.map(r => `
      <button class="mg-chip ${r === s.cat3 ? 'on' : ''}" data-cat3="${esc(r)}" type="button">${esc(r)}</button>
    `).join('')
  }

  private renderBodyChips(): string {
    const s = this.state
    return BODY_TYPES.map(b => `
      <button class="mg-chip ${b.id === s.bodyPreset ? 'on' : ''}" data-body="${b.id}" type="button">${esc(b.label)}</button>
    `).join('')
  }

  /* ── Classification bindings ──────────────────────────────────── */

  private bindCat1Cards(): void {
    this.container.querySelectorAll<HTMLButtonElement>('[data-cat1]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.cat1 || ''
        if (this.state.cat1 === v) return
        this.state.cat1 = v
        this.state.cat2 = ''
        this.state.cat3 = ''
        this.state.morph = 'quadruped'
        this.refreshCat1()
        this.refreshCat2()
        this.refreshCat3()
        this.refreshMorphPill()
        this.syncState()
      })
    })
  }

  private bindCat2Chips(): void {
    this.container.querySelectorAll<HTMLButtonElement>('[data-cat2]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.cat2 || ''
        if (this.state.cat2 === v) return
        this.state.cat2 = v
        this.state.cat3 = ''
        this.state.morph = getMorph(this.state.cat1, v)
        this.refreshCat2()
        this.refreshCat3()
        this.refreshMorphPill()
        this.syncState()
      })
    })
  }

  private bindCat3Chips(): void {
    this.container.querySelectorAll<HTMLButtonElement>('[data-cat3]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.cat3 || ''
        if (this.state.cat3 === v) return
        this.state.cat3 = v
        this.refreshCat3()
        this.syncState()
      })
    })
  }

  private bindBodyChips(): void {
    this.container.querySelectorAll<HTMLButtonElement>('[data-body]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.body || ''
        const toggledOff = this.state.bodyPreset === id
        this.state.bodyPreset = toggledOff ? '' : id
        this.container.querySelectorAll('[data-body]').forEach(b => {
          b.classList.toggle('on', b === btn && !toggledOff)
        })
        this.syncState()
      })
    })
  }

  private refreshCat1(): void {
    this.container.querySelectorAll<HTMLButtonElement>('[data-cat1]').forEach(btn => {
      btn.classList.toggle('on', btn.dataset.cat1 === this.state.cat1)
    })
  }

  private refreshCat2(): void {
    const hint = this.container.querySelector('#mgCat2Hint')
    if (hint) hint.textContent = this.state.cat1 || '先选大类'
    const wrap = this.container.querySelector('#mgCat2Chips')
    if (wrap) wrap.innerHTML = this.renderCat2Chips()
    this.bindCat2Chips()
  }

  private refreshCat3(): void {
    const hint = this.container.querySelector('#mgCat3Hint')
    if (hint) hint.textContent = this.state.cat2 || '先选子类'
    const wrap = this.container.querySelector('#mgCat3Chips')
    if (wrap) wrap.innerHTML = this.renderCat3Chips()
    this.bindCat3Chips()
  }

  private refreshMorphPill(): void {
    const pill = this.container.querySelector<HTMLElement>('#mgMorphPill')
    if (!pill) return
    if (this.state.cat1 && this.state.cat2) {
      pill.style.display = ''
      pill.textContent = MORPH_LABELS[this.state.morph] || this.state.morph
    } else {
      pill.style.display = 'none'
    }
  }

  private syncState(): void {
    const $ = (id: string) => (this.container.querySelector(`#${id}`) as HTMLInputElement)?.value ?? ''
    this.state.name = $('mgName')
    this.state.desc = $('mgDesc')
    this.state.body = $('mgBody')
    this.state.angle = $('mgAngle')

    const styleChip = this.container.querySelector('[data-field="style"] .mg-chip.on') as HTMLElement | null
    // style 允许为空字符串（"不指定"）。
    this.state.style = styleChip ? (styleChip.dataset.v || '') : ''

    const dirChip = this.container.querySelector('[data-field="dirCount"] .mg-chip.on') as HTMLElement | null
    if (dirChip) {
      const n = Number(dirChip.dataset.v) as DirCount
      if ([1, 2, 4, 8].includes(n)) this.state.dirCount = n
    }

    const sizeChip = this.container.querySelector('[data-field="heroSize"] .mg-chip.on') as HTMLElement | null
    if (sizeChip) {
      const n = Number(sizeChip.dataset.v)
      if (n === 512 || n === 1024 || n === 2048) this.state.heroSize = n
    }

    const upCheckbox = this.container.querySelector<HTMLInputElement>('#mgUpscale')
    if (upCheckbox) this.state.upscale = upCheckbox.checked

    saveState(this.state)
    this.refreshDirList()
  }

  private buildFeatureLock(): string {
    const s = this.state
    const morphLabel = s.morph === 'humanoid' ? 'humanoid biped' :
                       s.morph === 'quadruped' ? 'four-legged beast' :
                       s.morph === 'insectoid' ? 'insect/arachnid multi-legged' :
                       s.morph === 'floating' ? 'floating ethereal' :
                       s.morph === 'amorphous' ? 'amorphous blob' : s.morph
    const species = [s.cat3, s.cat2 ? `(${s.cat1}/${s.cat2})` : ''].filter(Boolean).join(' ')
    const bodyText = s.body.trim() || getBodyType(s.bodyPreset)?.prompt || ''
    return [
      species ? `SPECIES: ${species}` : '',
      s.desc,
      bodyText ? `BODY TYPE: ${bodyText}` : '',
      `FORM: ${morphLabel}`,
    ].filter(Boolean).join('. ')
  }

  /** True when the user has provided enough signal to meaningfully generate a monster. */
  private hasGenerationIntent(): boolean {
    const s = this.state
    // Uploading a reference is by itself sufficient — the image IS the design signal.
    if (this.uploadImage) return true
    return !!(s.desc.trim() || s.cat3 || s.cat2 || (s.cat1 && s.bodyPreset))
  }

  private showHeroInCenter(url: string, label = '立绘'): void {
    // Defensive — center DOM may not be wired yet (e.g. mount order, or
    // SSE callback firing before the user has focused this tab).
    if (!this.previewImg || !this.previewPlaceholder || !this.previewLabel) return
    // 立绘加时间戳防缓存，保证每次"重新生成"后大图即时更新。
    const bust = url.includes('?') ? url : `${url}?t=${Date.now()}`
    this.previewImg.src = bust
    this.previewImg.style.display = 'block'
    this.previewPlaceholder.style.display = 'none'
    this.previewLabel.textContent = label
  }

  /* ══════════════════════════════════════════════════════════════════
     CENTER PANEL: Large preview (click a thumbnail to enlarge)
     ══════════════════════════════════════════════════════════════════ */

  private buildCenterPanel(): void {
    const center = this.panels.center
    center.innerHTML = ''

    const wrapper = document.createElement('div')
    wrapper.className = 'mg-preview-center'
    wrapper.innerHTML = `
      <div class="mg-preview-placeholder" id="mgPreviewPlaceholder">点击右侧缩略图放大查看</div>
      <img class="mg-preview-img" id="mgPreviewImg" style="display:none" alt="Preview">
      <div class="mg-preview-label" id="mgPreviewLabel"></div>
    `
    center.appendChild(wrapper)

    this.previewImg = wrapper.querySelector('#mgPreviewImg') as HTMLImageElement
    this.previewLabel = wrapper.querySelector('#mgPreviewLabel') as HTMLElement
    this.previewPlaceholder = wrapper.querySelector('#mgPreviewPlaceholder') as HTMLElement
  }

  private showPreview(url: string, label: string): void {
    this.previewImg.src = url
    this.previewImg.style.display = 'block'
    this.previewPlaceholder.style.display = 'none'
    this.previewLabel.textContent = label
  }

  /* ══════════════════════════════════════════════════════════════════
     RIGHT PANEL: Direction Grid + History
     ══════════════════════════════════════════════════════════════════ */

  private buildRightPanel(): void {
    const right = this.panels.right
    right.innerHTML = ''
    const wrapper = document.createElement('div')
    wrapper.className = 'mg-sidebar'

    wrapper.innerHTML = `
      <div class="mg-sidebar-section mg-dir-list">
        <div class="mg-sidebar-title" id="mgDirTitle">序列帧 · ${this.state.dirCount} 方向</div>
        <div id="mgDirListBody"></div>
      </div>
      <div class="mg-sidebar-section mg-sidebar-history">
        <div class="mg-sidebar-title">生成历史</div>
        <div id="mgHistoryList"></div>
      </div>
    `
    right.appendChild(wrapper)

    this.historyList = wrapper.querySelector('#mgHistoryList') as HTMLElement
    this.refreshDirList()
  }

  /**
   * 根据当前 `state.dirCount` 重建方向列表。切方向数时前端只渲染
   * 本次需要的方向；镜像列（L/R 模式下 W 由 E 翻转）仍会被标注。
   */
  private refreshDirList(): void {
    const body = this.container.ownerDocument?.querySelector('#mgDirListBody')
      || this.panels.right.querySelector('#mgDirListBody')
    const title = this.panels.right.querySelector('#mgDirTitle')
    if (!body || !title) return

    title.textContent = `序列帧 · ${this.state.dirCount} 方向`
    const dirs = DIR_PRESETS[this.state.dirCount]

    // 2 方向横版：W 由 E 镜像生成。4 / 8 方向仍沿用原 MIRROR_DIRS。
    const mirrorSet: Set<string> = this.state.dirCount === 2
      ? new Set(['W'])
      : this.state.dirCount === 8 ? MIRROR_DIRS : new Set()

    // 清掉旧 refs，避免事件重复绑定
    this.dirRows = {}
    this.dirBadges = {}
    this.dirAnimContainers = {}

    let html = ''
    for (const dir of dirs) {
      const isMirror = mirrorSet.has(dir)
      const status = isMirror ? 'mirror' : 'waiting'
      html += `
        <div class="mg-dir-row" data-dir="${dir}">
          <div class="mg-dir-row-header">
            <span class="mg-dir-name">${DIR_LABELS[dir]}(${dir})</span>
            <span class="mg-dir-badge ${status}" data-badge="${dir}">${isMirror ? '镜像' : '等待'}</span>
          </div>
          <div class="mg-dir-thumbs" data-anims="${dir}"></div>
        </div>`
    }
    body.innerHTML = html

    for (const dir of dirs) {
      this.dirRows[dir] = body.querySelector(`[data-dir="${dir}"]`) as HTMLElement
      this.dirBadges[dir] = body.querySelector(`[data-badge="${dir}"]`) as HTMLElement
      this.dirAnimContainers[dir] = body.querySelector(`[data-anims="${dir}"]`) as HTMLElement
      this.dirStatus[dir] = isMirrorDir(dir, this.state.dirCount) ? 'mirror' : 'waiting'
    }
  }

  private updateDirBadge(dir: string, status: DirStatus): void {
    this.dirStatus[dir] = status
    const badge = this.dirBadges[dir]
    if (!badge) return
    badge.className = `mg-dir-badge ${status}`
    const labels: Record<DirStatus, string> = {
      waiting: '等待', generating: '生成中', done: '完成', mirror: '镜像', error: '失败',
    }
    badge.textContent = labels[status] || status
    this.dirRows[dir]?.classList.toggle('generating', status === 'generating')
  }

  private addAnimThumb(dir: string, anim: string, url: string): void {
    const container = this.dirAnimContainers[dir]
    if (!container) return
    const existing = container.querySelector(`[data-anim="${anim}"]`) as HTMLImageElement
    if (existing) { existing.src = url + '?t=' + Date.now(); return }
    const img = document.createElement('img')
    img.className = 'mg-thumb'
    img.dataset.anim = anim
    img.src = url
    img.title = `${DIR_LABELS[dir]} - ${anim}`
    img.addEventListener('click', () => {
      this.showPreview(url, `${DIR_LABELS[dir]}(${dir}) — ${anim}`)
    })
    container.appendChild(img)
  }

  /* ── History ── */

  private async loadHistory(): Promise<void> {
    try {
      this.history = await getHistory()
      this.renderHistory()
    } catch { /* ignore */ }
  }

  private renderHistory(): void {
    if (!this.historyList) return
    if (!this.history.length) {
      this.historyList.innerHTML = '<div style="color:var(--text-secondary);font-size:11px;padding:6px">暂无记录</div>'
      return
    }
    this.historyList.innerHTML = this.history.map(h => `
      <div class="mg-hist-item ${h.name === this.state.currentMonster ? 'active' : ''}" data-monster="${esc(h.name)}">
        <img class="mg-hist-thumb" src="${heroUrl(h.name)}" onerror="this.style.display='none'" alt="">
        <div class="mg-hist-info">
          <div class="mg-hist-name">${esc(h.name)}</div>
          <div class="mg-hist-time">${h.timestamp || ''}</div>
        </div>
      </div>
    `).join('')

    this.historyList.querySelectorAll('.mg-hist-item').forEach(item => {
      item.addEventListener('click', () => {
        const monster = (item as HTMLElement).dataset.monster || ''
        this.loadMonsterPreview(monster)
      })
    })
  }

  private loadMonsterPreview(monster: string): void {
    this.state.currentMonster = monster
    saveState(this.state)
    this.showHeroInCenter(heroUrl(monster))

    this.animBtn.disabled = false
    this.animBtn.textContent = `▶ 第二步：生成序列帧 (${monster})`

    const dirs = DIR_PRESETS[this.state.dirCount]
    for (const dir of dirs) {
      const container = this.dirAnimContainers[dir]
      if (container) container.innerHTML = ''
      for (const anim of ANIMS) {
        this.addAnimThumb(dir, anim, gifUrl(monster, dir, anim))
      }
      this.updateDirBadge(dir, isMirrorDir(dir, this.state.dirCount) ? 'mirror' : 'done')
    }
    this.renderHistory()
  }

  /* ══════════════════════════════════════════════════════════════════
     BOTTOM PANEL: Progress / Log
     ══════════════════════════════════════════════════════════════════ */

  private buildBottomPanel(): void {
    const bottom = this.panels.bottom
    bottom.innerHTML = ''
    const wrapper = document.createElement('div')
    wrapper.className = 'mg-progress'
    wrapper.innerHTML = `
      <div class="mg-progress-header">
        <span class="mg-progress-stage" id="mgStage">就绪</span>
        <span class="mg-progress-pct" id="mgPct"></span>
      </div>
      <div class="mg-progress-bar-track">
        <div class="mg-progress-bar-fill" id="mgProgressFill"></div>
      </div>
      <div class="mg-log" id="mgLog"></div>
    `
    bottom.appendChild(wrapper)
    this.stageEl = wrapper.querySelector('#mgStage') as HTMLElement
    this.progressPct = wrapper.querySelector('#mgPct') as HTMLElement
    this.progressFill = wrapper.querySelector('#mgProgressFill') as HTMLElement
    this.logEl = wrapper.querySelector('#mgLog') as HTMLElement
  }

  private appendLog(msg: string, cls = ''): void {
    const line = document.createElement('div')
    line.className = `mg-log-line ${cls}`
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
    this.logEl.appendChild(line)
    this.logEl.scrollTop = this.logEl.scrollHeight
  }

  private setProgress(pct: number, stage: string): void {
    this.progressFill.style.width = `${Math.min(100, pct)}%`
    this.progressPct.textContent = `${Math.round(pct)}%`
    if (stage) this.stageEl.textContent = stage
  }

  /* ══════════════════════════════════════════════════════════════════
     STEP 1: Generate Hero Art Only
     ══════════════════════════════════════════════════════════════════ */

  private async onGenerateHero(): Promise<void> {
    if (this.generating) return
    this.syncState()
    const s = this.state

    if (!this.hasGenerationIntent()) {
      alert('请先选择一个怪物种类 (大类/子类/种族)，或在「附加描述」里写点什么，或上传一张参考图')
      return
    }

    this.generating = true
    this.heroBtn.disabled = true
    this.heroBtn.textContent = '⏳ 立绘生成中...'
    this.animBtn.disabled = true
    this.logEl.innerHTML = ''
    this.setProgress(10, '生成立绘...')
    this.appendLog('正在生成怪物立绘...', 'info')

    const defaultNameSlug = s.cat3 || s.cat2 || s.cat1 || 'monster'
    const monsterName = s.name || `${defaultNameSlug}_${Date.now()}`
    const displayName = s.desc.trim().slice(0, 20) || s.cat3 || s.cat2 || s.name || monsterName
    const featureLock = this.buildFeatureLock()

    if (s.style === 'MATCH_REFERENCE' && !this.uploadImage) {
      this.appendLog('「🪞 原图画风」需要先上传参考图，已临时回退到 CEL_2D', 'info')
    }

    // 参考图压到 ~300KB，避免 socket hang up——完整分辨率对 Gemini 多模态无意义
    let uploadPayload = ''
    if (this.uploadImage) {
      try {
        uploadPayload = await compressUploadForMonsterApi(this.uploadImage, 300)
        const kb = Math.round(uploadPayload.length / 1024)
        this.appendLog(`参考图已压缩: ~${kb}KB`, 'info')
      } catch (err: any) {
        this.appendLog(`参考图压缩失败，使用原图: ${err.message}`, 'info')
        uploadPayload = this.uploadImage
      }
    }

    try {
      const result = await generateHero({
        monster_name: monsterName,
        feature_lock: featureLock,
        display_name: displayName,
        api_key: s.apiKey,
        api_base: s.apiBase,
        model: s.model,
        style: s.style,
        morphology: s.morph,
        angle: s.angle,
        hero_size: s.heroSize,
        upscale: s.upscale,
        upload_image_base64: uploadPayload,
      })

      this.state.currentMonster = result.monster_name
      saveState(this.state)

      this.setProgress(100, '立绘完成')
      this.appendLog(`立绘生成成功: ${result.monster_name}`, 'success')
      this.showHeroInCenter(heroUrl(result.monster_name))

      this.animBtn.disabled = false
      this.animBtn.textContent = `▶ 第二步：生成序列帧 (${result.monster_name})`

      this.loadHistory()
    } catch (err: any) {
      this.appendLog(`立绘生成失败: ${err.message}`, 'error')
      this.setProgress(0, '失败')
    } finally {
      this.generating = false
      this.heroBtn.disabled = false
      this.heroBtn.textContent = '🎨 第一步：生成立绘'
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     STEP 2: Generate Animations (Full Pipeline)
     ══════════════════════════════════════════════════════════════════ */

  private async onGenerateAnimation(): Promise<void> {
    if (this.generating) return
    this.syncState()
    const s = this.state

    if (!s.currentMonster) { alert('请先生成立绘'); return }

    this.generating = true
    this.heroBtn.disabled = true
    this.animBtn.disabled = true
    this.animBtn.textContent = '⏳ 动画生成中...'
    this.logEl.innerHTML = ''
    this.setProgress(0, '启动动画管线...')

    // Reset direction statuses in sidebar
    const dirs = DIR_PRESETS[this.state.dirCount]
    for (const dir of dirs) {
      const container = this.dirAnimContainers[dir]
      if (container) container.innerHTML = ''
      this.updateDirBadge(dir, isMirrorDir(dir, this.state.dirCount) ? 'mirror' : 'waiting')
    }

    const featureLock = this.buildFeatureLock()

    // 序列帧阶段：把 dirCount 明确传给后端，让它只跑当前选的方向。
    const payload = {
      mode: 'api',
      monster_name: s.currentMonster,
      feature_lock: featureLock,
      display_name: s.desc.trim().slice(0, 20) || s.cat3 || s.cat2 || s.currentMonster,
      morphology: s.morph,
      camera_angle: angleToNumber(s.angle),
      genre: s.dirCount === 2 || isSideView(s.angle) ? 'PLATFORMER' : 'RPG_TOPDOWN',
      api_key: s.apiKey,
      api_base: s.apiBase,
      model: s.model,
      style: s.style,
      dir_count: s.dirCount,
      directions: DIR_PRESETS[s.dirCount],
    }

    try {
      this.appendLog('启动动画管线...', 'info')
      const result = await startPipeline(payload as any)
      this.appendLog(`管线已启动 (PID: ${result.pid})`, 'info')
      this.connectToSSE(result.pid)
    } catch (err: any) {
      this.appendLog(`启动失败: ${err.message}`, 'error')
      this.finishGeneration()
    }
  }

  private connectToSSE(pid: string): void {
    this.es?.close()

    const prevGenStatus: Record<string, string> = {}
    const prevAssembleStatus: Record<string, string> = {}
    let prevHeroPath: string | null = null
    let prevStatus = ''

    this.es = connectSSE(pid, (snapshot: any) => {
      const { status, stage_name, progress, hero_path, gen_status, assemble_status, flip_status, new_logs, error } = snapshot

      if (new_logs && Array.isArray(new_logs)) {
        for (const log of new_logs) {
          const msg = typeof log === 'string' ? log : log.msg || ''
          const cls = msg.includes('失败') || msg.includes('错误') ? 'error' :
                      msg.includes('完成') ? 'success' :
                      msg.includes('启动') || msg.includes('开始') ? 'info' : ''
          this.appendLog(msg, cls)
        }
      }

      if (progress !== undefined) {
        this.setProgress(progress * 100, stage_name || '')
      }

      if (hero_path && hero_path !== prevHeroPath) {
        prevHeroPath = hero_path
        this.showHeroInCenter(heroUrl(this.state.currentMonster))
      }

      if (gen_status) {
        for (const [key, val] of Object.entries(gen_status as Record<string, string>)) {
          if (val !== prevGenStatus[key]) {
            prevGenStatus[key] = val
            const dir = key.split('_')[0]
            if (val === 'running') this.updateDirBadge(dir, 'generating')
          }
        }
      }

      if (assemble_status) {
        for (const [dir, val] of Object.entries(assemble_status as Record<string, string>)) {
          if (val !== prevAssembleStatus[dir]) {
            prevAssembleStatus[dir] = val as string
            if (val === 'done') {
              this.updateDirBadge(dir, 'done')
              for (const anim of ANIMS) this.addAnimThumb(dir, anim, gifUrl(this.state.currentMonster, dir, anim))
            } else if (val === 'error') {
              this.updateDirBadge(dir, 'error')
            }
          }
        }
      }

      if (flip_status) {
        for (const [dir, val] of Object.entries(flip_status as Record<string, string>)) {
          if (val === 'done') {
            this.updateDirBadge(dir, 'mirror')
            for (const anim of ANIMS) this.addAnimThumb(dir, anim, gifUrl(this.state.currentMonster, dir, anim))
          }
        }
      }

      if (status !== prevStatus) {
        prevStatus = status
        if (status === 'done') {
          this.setProgress(100, '完成')
          this.appendLog('全部完成！', 'success')
          this.finishGeneration()
          this.loadHistory()
        } else if (status === 'error') {
          this.appendLog(`管线错误: ${error || '未知错误'}`, 'error')
          this.finishGeneration()
        }
      }
    })
  }

  private finishGeneration(): void {
    this.generating = false
    this.heroBtn.disabled = false
    this.heroBtn.textContent = '🎨 第一步：生成立绘'
    this.animBtn.disabled = false
    this.animBtn.textContent = `▶ 第二步：生成序列帧 (${this.state.currentMonster})`
    this.es?.close()
    this.es = null
  }
}

/* ── Helpers ────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function angleToNumber(angle: string): number {
  switch (angle) {
    case 'topdown_30': return 30
    case 'topdown_45': return 45
    case 'topdown_60': return 60
    case 'side': return 0
    default: return 45
  }
}

function isSideView(angle: string): boolean {
  return angle === 'side'
}
