import type { IPipeline, PipelineContext } from '../../core/types'
import { meta } from './meta'
import { globalState } from '../../shared/GlobalState'
import {
  VEHICLE_CATEGORIES, VEHICLE_STYLES, VEHICLE_ERAS,
  getVehicleCategory, getVehicleSubtype, getVehicleStyle, getVehicleEra,
  isCustomVehicleSubtype,
} from '../../shared/VehicleClassification'

// ── View modes (subset of wb-anim vehicle-types, id-compatible) ──────

interface ViewMode { id: string; label: string; description: string; views: string[] }

const VIEW_MODES: ViewMode[] = [
  { id: 'four-dir',     label: '四方向',   description: '前·左·右·后',          views: ['front','left','right','back'] },
  { id: 'topdown-plus', label: '俯视+四向', description: '俯视+前·左·右·后',     views: ['top','front','left','right','back'] },
  { id: 'side-only',    label: '侧视双向', description: '左·右两个侧视角',        views: ['left','right'] },
  { id: 'isometric',    label: '等距四向', description: 'ISO 前左/前右/后左/后右', views: ['iso-nw','iso-ne','iso-sw','iso-se'] },
]

// ── Config ────────────────────────────────────────────────────────────

const STORAGE_KEY = 'wb-char:vehicle-design:cfg'

interface VehicleDesignConfig {
  categoryId: string
  subtypeId: string
  customSubtype: string
  styleId: string
  eraId: string
  viewModeId: string
  userDesc: string
  activeStep: 1 | 2
}

const DEFAULTS: VehicleDesignConfig = {
  categoryId: 'ground',
  subtypeId: 'sedan',
  customSubtype: '',
  styleId: 'pixel',
  eraId: 'modern',
  viewModeId: 'four-dir',
  userDesc: '',
  activeStep: 1,
}

function loadCfg(): VehicleDesignConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { ...DEFAULTS }
}

function saveCfg(c: VehicleDesignConfig): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)) } catch { /* ignore */ }
}

// ── Helpers ───────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function apiPost(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json() as Promise<Record<string, unknown>>
}

async function compressRefImage(dataUrl: string, maxPx = 1200): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = reject
    i.src = dataUrl
  })
  const scale = Math.min(1, maxPx / Math.max(img.width, img.height))
  const nw = Math.round(img.width * scale)
  const nh = Math.round(img.height * scale)
  const cv = document.createElement('canvas')
  cv.width = nw; cv.height = nh
  cv.getContext('2d')!.drawImage(img, 0, 0, nw, nh)
  return cv.toDataURL('image/png').replace(/^data:[^;]+;base64,/, '')
}

const GEMINI_RATIOS: [number, number, string][] = [
  [1,1,'1:1'],[1,4,'1:4'],[2,3,'2:3'],[3,2,'3:2'],
  [4,1,'4:1'],[4,3,'4:3'],[16,9,'16:9'],[9,16,'9:16'],
]
function nearestRatio(w: number, h: number): string {
  const t = w / h
  let best = '1:1', bestD = Infinity
  for (const [rw, rh, label] of GEMINI_RATIOS) {
    const d = Math.abs(rw / rh - t)
    if (d < bestD) { bestD = d; best = label }
  }
  return best
}

function resolveSubject(cfg: VehicleDesignConfig): string {
  const cat = getVehicleCategory(cfg.categoryId)
  const sub = getVehicleSubtype(cfg.categoryId, cfg.subtypeId)
  if (isCustomVehicleSubtype(sub)) return cfg.customSubtype.trim() || (cat?.label ?? 'vehicle')
  return sub?.prompt || cat?.label || 'vehicle'
}

function buildDesignPrompt(cfg: VehicleDesignConfig): string {
  const style = getVehicleStyle(cfg.styleId)
  const era = getVehicleEra(cfg.eraId)
  const subject = resolveSubject(cfg)
  const extra = cfg.userDesc ? `\nAdditional design details: ${cfg.userDesc}` : ''
  return (
    `TASK: Generate a single vehicle concept image for a ${subject}.${extra}\n\n` +
    `ERA: ${era?.prompt || cfg.eraId}\n` +
    `STYLE: ${style?.prompt || cfg.styleId}\n\n` +
    `OUTPUT: ONE clean vehicle on a SOLID GREEN (#00FF00) background.\n` +
    `Show from a clear 3/4 front perspective. Full vehicle visible.\n` +
    `⚠️ Background MUST be flat solid green. No shadows, no floor, no particles.`
  )
}

function buildViewsPrompt(cfg: VehicleDesignConfig, vm: ViewMode): string {
  const style = getVehicleStyle(cfg.styleId)
  const subject = resolveSubject(cfg)
  const views = vm.views
  const count = views.length
  let cols: number, rows: number
  if (count <= 2) { cols = count; rows = 1 }
  else if (count <= 4) { cols = 2; rows = 2 }
  else { cols = 3; rows = Math.ceil(count / 3) }

  const VIEW_LABELS: Record<string, string> = {
    front:'前',left:'左',right:'右',back:'后',top:'俯',
    'iso-nw':'等距前左','iso-ne':'等距前右','iso-sw':'等距后左','iso-se':'等距后右',
  }
  const cellDescs = views.map((v, i) => `  Cell ${i+1}: ${VIEW_LABELS[v] || v}`).join('\n')

  return (
    `Draw a ${cols}×${rows} sprite-sheet reference of a ${subject}.\n` +
    `Style: ${style?.prompt || cfg.styleId}\n\n` +
    `GRID (${cols} cols × ${rows} rows, ${count} cells):\n${cellDescs}\n\n` +
    `Rules:\n` +
    `- Same vehicle, same proportions/colours in every cell.\n` +
    `- Solid GREEN (#00FF00) background, no shadows, no floor.\n` +
    `- Vehicle centred in each cell, full body visible.\n` +
    `- Do NOT draw grid lines or borders.`
  )
}

// ── UI class ──────────────────────────────────────────────────────────

let _ctx: PipelineContext

class VehicleDesignUI {
  private cfg: VehicleDesignConfig = loadCfg()
  private leftEl: HTMLElement | null = null
  private generating = false
  private designImage: string | null = null
  private viewsImage: string | null = null
  private progressEl: HTMLElement | null = null

  mount(left: HTMLElement): void {
    this.leftEl = left
    this.syncFromGlobal()
    this.render()
    this.wire()
  }

  unmount(): void {
    this.leftEl = null
    this.progressEl = null
  }

  private syncFromGlobal(): void {
    const p = globalState.profile
    if (p?.vehicleCategory) this.cfg.categoryId = p.vehicleCategory
    if (p?.vehicleSubtype)  this.cfg.subtypeId  = p.vehicleSubtype
    if (p?.vehicleSubtypeCustom) this.cfg.customSubtype = p.vehicleSubtypeCustom
    if (p?.vehicleStyle)    this.cfg.styleId    = p.vehicleStyle
    if (p?.vehicleEra)      this.cfg.eraId      = p.vehicleEra
    // Restore cached images from localStorage if present
    try {
      const cachedDesign = localStorage.getItem('wb-char:vehicle-design:designImage')
      const cachedViews  = localStorage.getItem('wb-char:vehicle-design:viewsImage')
      if (cachedDesign) this.designImage = cachedDesign
      if (cachedViews)  this.viewsImage  = cachedViews
    } catch { /* ignore */ }
  }

  private saveToGlobal(): void {
    globalState.updateProfile({
      characterRole: 'vehicle',
      vehicleCategory:    this.cfg.categoryId,
      vehicleSubtype:     this.cfg.subtypeId,
      vehicleStyle:       this.cfg.styleId,
      vehicleEra:         this.cfg.eraId,
    } as Parameters<typeof globalState.updateProfile>[0])
    saveCfg(this.cfg)
  }

  private toast(msg: string): void {
    const t = document.createElement('div')
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e1e2e;color:#cdd6f4;padding:8px 16px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 2px 12px #0008'
    t.textContent = msg
    document.body.appendChild(t)
    setTimeout(() => t.remove(), 3500)
  }

  private showProgress(active: boolean, msg = ''): void {
    if (!this.leftEl) return
    let el = this.leftEl.querySelector<HTMLElement>('[data-vd-progress]')
    if (!el) {
      el = document.createElement('div')
      el.setAttribute('data-vd-progress', '')
      el.style.cssText = 'padding:12px 16px;font-size:13px;color:#89dceb;display:none'
      this.leftEl.prepend(el)
    }
    this.progressEl = el
    el.style.display = active ? '' : 'none'
    el.textContent = msg
  }

  private render(): void {
    if (!this.leftEl) return
    const c = this.cfg
    const cat = getVehicleCategory(c.categoryId)
    const sub = getVehicleSubtype(c.categoryId, c.subtypeId)
    const vm = VIEW_MODES.find(m => m.id === c.viewModeId) || VIEW_MODES[0]

    this.leftEl.innerHTML = `
<div style="padding:8px;display:flex;flex-direction:column;gap:10px;overflow-y:auto;height:100%">

  ${this.designImage ? `
  <div style="text-align:center">
    <img src="${this.designImage}" style="max-width:100%;max-height:160px;border-radius:6px;border:1px solid #313244"/>
    <div style="font-size:11px;color:#6c7086;margin-top:4px">设定图</div>
  </div>` : ''}

  <div>
    <div style="font-size:11px;color:#6c7086;margin-bottom:4px">载具大类</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${VEHICLE_CATEGORIES.map(ct => `
        <button data-vd-cat="${ct.id}" style="padding:4px 8px;border-radius:6px;font-size:12px;border:1px solid ${ct.id===c.categoryId?'#89b4fa':'#313244'};background:${ct.id===c.categoryId?'#1e3a5f':'#1e1e2e'};color:${ct.id===c.categoryId?'#89b4fa':'#cdd6f4'};cursor:pointer">
          ${ct.icon} ${ct.label}
        </button>`).join('')}
    </div>
  </div>

  <div>
    <div style="font-size:11px;color:#6c7086;margin-bottom:4px">子类型</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${(cat?.subtypes||[]).map(st => `
        <button data-vd-sub="${st.id}" style="padding:3px 8px;border-radius:6px;font-size:12px;border:1px solid ${st.id===c.subtypeId?'#89b4fa':'#313244'};background:${st.id===c.subtypeId?'#1e3a5f':'#1e1e2e'};color:${st.id===c.subtypeId?'#89b4fa':'#cdd6f4'};cursor:pointer">
          ${st.label}
        </button>`).join('')}
    </div>
    ${isCustomVehicleSubtype(sub) ? `
    <input data-vd="custom-sub" value="${esc(c.customSubtype)}" placeholder="例：装甲越野车 / cyberpunk pizza bike"
      style="margin-top:6px;width:100%;box-sizing:border-box;padding:5px 8px;border-radius:6px;border:1px solid #313244;background:#181825;color:#cdd6f4;font-size:12px"/>` : ''}
  </div>

  <div>
    <div style="font-size:11px;color:#6c7086;margin-bottom:4px">画面风格</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${VEHICLE_STYLES.map(s => `
        <button data-vd-style="${s.id}" style="padding:3px 8px;border-radius:6px;font-size:12px;border:1px solid ${s.id===c.styleId?'#a6e3a1':'#313244'};background:${s.id===c.styleId?'#1e3a2f':'#1e1e2e'};color:${s.id===c.styleId?'#a6e3a1':'#cdd6f4'};cursor:pointer">
          ${s.label}
        </button>`).join('')}
    </div>
  </div>

  <div>
    <div style="font-size:11px;color:#6c7086;margin-bottom:4px">时代背景</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px">
      ${VEHICLE_ERAS.map(e => `
        <button data-vd-era="${e.id}" style="padding:3px 8px;border-radius:6px;font-size:12px;border:1px solid ${e.id===c.eraId?'#f38ba8':'#313244'};background:${e.id===c.eraId?'#3a1e2f':'#1e1e2e'};color:${e.id===c.eraId?'#f38ba8':'#cdd6f4'};cursor:pointer">
          ${e.label}
        </button>`).join('')}
    </div>
  </div>

  <div>
    <div style="font-size:11px;color:#6c7086;margin-bottom:4px">自定义描述（可选）</div>
    <textarea data-vd="user-desc" rows="2" placeholder="额外设计细节..."
      style="width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #313244;background:#181825;color:#cdd6f4;font-size:12px;resize:vertical">${esc(c.userDesc)}</textarea>
  </div>

  <div>
    <div style="font-size:11px;color:#6c7086;margin-bottom:4px">视角模式</div>
    <div style="display:flex;flex-direction:column;gap:4px">
      ${VIEW_MODES.map(m => `
        <button data-vd-vm="${m.id}" style="padding:6px 10px;border-radius:6px;font-size:12px;text-align:left;border:1px solid ${m.id===c.viewModeId?'#cba6f7':'#313244'};background:${m.id===c.viewModeId?'#2e1e4f':'#1e1e2e'};color:${m.id===c.viewModeId?'#cba6f7':'#cdd6f4'};cursor:pointer">
          <strong>${m.label}</strong> <span style="opacity:.7;font-size:11px">${m.description}</span>
        </button>`).join('')}
    </div>
  </div>

  <div style="display:flex;flex-direction:column;gap:6px;padding-top:4px">
    <button data-vd-action="gen-all" style="padding:8px;border-radius:8px;background:#89b4fa;color:#1e1e2e;font-weight:600;font-size:13px;border:none;cursor:pointer">
      🎨 生成设定图 → 多视角
    </button>
    ${this.designImage ? `
    <button data-vd-action="gen-design" style="padding:6px;border-radius:8px;background:#313244;color:#cdd6f4;font-size:12px;border:none;cursor:pointer">
      🔄 仅重新生成设定图
    </button>` : ''}
    ${this.viewsImage ? `
    <button data-vd-action="go-anim" style="padding:8px;border-radius:8px;background:#a6e3a1;color:#1e1e2e;font-weight:600;font-size:13px;border:none;cursor:pointer">
      🎬 前往动画工作台
    </button>` : ''}
  </div>

</div>`

    this.wire()
  }

  private wire(): void {
    const el = this.leftEl
    if (!el) return

    el.querySelectorAll<HTMLButtonElement>('[data-vd-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.cfg.categoryId = btn.dataset.vdCat!
        this.cfg.subtypeId = getVehicleCategory(this.cfg.categoryId)?.subtypes[0]?.id || ''
        this.render()
      })
    })
    el.querySelectorAll<HTMLButtonElement>('[data-vd-sub]').forEach(btn => {
      btn.addEventListener('click', () => { this.cfg.subtypeId = btn.dataset.vdSub!; this.render() })
    })
    el.querySelectorAll<HTMLButtonElement>('[data-vd-style]').forEach(btn => {
      btn.addEventListener('click', () => { this.cfg.styleId = btn.dataset.vdStyle!; this.render() })
    })
    el.querySelectorAll<HTMLButtonElement>('[data-vd-era]').forEach(btn => {
      btn.addEventListener('click', () => { this.cfg.eraId = btn.dataset.vdEra!; this.render() })
    })
    el.querySelectorAll<HTMLButtonElement>('[data-vd-vm]').forEach(btn => {
      btn.addEventListener('click', () => { this.cfg.viewModeId = btn.dataset.vdVm!; this.render() })
    })

    const customSub = el.querySelector<HTMLInputElement>('[data-vd="custom-sub"]')
    if (customSub) customSub.addEventListener('input', () => { this.cfg.customSubtype = customSub.value })

    const userDesc = el.querySelector<HTMLTextAreaElement>('[data-vd="user-desc"]')
    if (userDesc) userDesc.addEventListener('input', () => { this.cfg.userDesc = userDesc.value })

    el.querySelector('[data-vd-action="gen-all"]')?.addEventListener('click', () => void this.execGenAll())
    el.querySelector('[data-vd-action="gen-design"]')?.addEventListener('click', () => void this.execGenDesign())
    el.querySelector('[data-vd-action="go-anim"]')?.addEventListener('click', () => void this.navigateToAnim())
  }

  // ── Generation ──────────────────────────────────────────────────────

  private async execGenAll(): Promise<void> {
    if (this.generating) { this.toast('正在生成中...'); return }
    await this.execGenDesign()
    if (!this.designImage) return
    await this.execGenViews()
  }

  private async execGenDesign(): Promise<void> {
    if (this.generating) return
    this.generating = true
    this.showProgress(true, '正在生成载具设定图...')
    try {
      this.saveToGlobal()
      const prompt = buildDesignPrompt(this.cfg)
      const upstreamIsVehicle = globalState.profile?.characterRole === 'vehicle'
      const refImage = upstreamIsVehicle ? globalState.get().characterImage : null

      const body: Record<string, unknown> = { prompt, aspectRatio: '1:1' }
      if (refImage) {
        body.inputImageBase64 = refImage.replace(/^data:[^;]+;base64,/, '')
        this.showProgress(true, '正在基于你的载具参考生成设定图...')
      }

      const result = await apiPost('/__ce-api__/generate-image', body)
      if (result.success && result.imageBase64) {
        this.designImage = `data:${result.mimeType||'image/png'};base64,${result.imageBase64}`
        try { localStorage.setItem('wb-char:vehicle-design:designImage', this.designImage) } catch { /* ignore */ }
        void globalState.uploadAsset('vehicle/design.png', this.designImage)
        this.toast('设定图生成完成')
        this.render()
      } else {
        this.toast('生成失败: ' + ((result.error || result.message || '未知错误') as string))
      }
    } catch (e: unknown) {
      this.toast('请求失败: ' + (e as Error).message)
    } finally {
      this.generating = false
      this.showProgress(false)
    }
  }

  private async execGenViews(): Promise<void> {
    if (this.generating) return
    if (!this.designImage) { this.toast('请先生成设定图'); return }
    this.generating = true
    this.showProgress(true, '正在生成多视角参考图...')
    try {
      const vm = VIEW_MODES.find(m => m.id === this.cfg.viewModeId) || VIEW_MODES[0]
      const prompt = buildViewsPrompt(this.cfg, vm)
      const base64 = await compressRefImage(this.designImage, 1200)
      const count = vm.views.length
      const isWide = count <= 2
      const aspect = nearestRatio(isWide ? count : 2, isWide ? 1 : 2)

      const result = await apiPost('/__ce-api__/generate-image', {
        prompt, inputImageBase64: base64, aspectRatio: aspect,
      })
      if (result.success && result.imageBase64) {
        this.viewsImage = `data:${result.mimeType||'image/png'};base64,${result.imageBase64}`
        try { localStorage.setItem('wb-char:vehicle-design:viewsImage', this.viewsImage) } catch { /* ignore */ }
        void globalState.uploadAsset('vehicle/views.png', this.viewsImage)
        this.toast('多视角参考图完成！点击「前往动画工作台」开始制作动画')
        this.render()
      } else {
        this.toast('视角图生成失败: ' + ((result.error || result.message || '未知错误') as string))
      }
    } catch (e: unknown) {
      this.toast('请求失败: ' + (e as Error).message)
    } finally {
      this.generating = false
      this.showProgress(false)
    }
  }

  // ── Navigate ────────────────────────────────────────────────────────

  private async navigateToAnim(): Promise<void> {
    this.saveToGlobal()
    const slug = globalState.getSlug()
    let charId = ''
    try {
      const r = await globalState.writeManifest('vehicle/design.png')
      if (r) charId = r.charId
    } catch { /* best-effort */ }
    if (charId) {
      try { await globalState.setActiveCharacter(charId, 'vehicle') } catch { /* best-effort */ }
    }
    try {
      window.parent?.postMessage({
        type: 'FORGEAX_NAVIGATE',
        targetPluginId: '@forgeax-plugin/wb-anim',
        payload: { charId, role: 'vehicle', slug },
      }, '*')
    } catch { /* not embedded */ }
  }
}

// ── IPipeline export ─────────────────────────────────────────────────

const ui = new VehicleDesignUI()

const pipeline: IPipeline = {
  meta,

  async init(context: PipelineContext) {
    _ctx = context
  },

  dispose() {
    ui.unmount()
  },

  createUI(container: HTMLElement) {
    ui.mount(container)
  },

  destroyUI() {
    ui.unmount()
  },

  getDefaultParams() { return {} },

  resetForNewCharacter() {
    // Keep vehicle params but clear generated images so Step 1 reruns
    try { localStorage.removeItem('wb-char:vehicle-design:cfg') } catch { /* ignore */ }
  },
}

export default pipeline
