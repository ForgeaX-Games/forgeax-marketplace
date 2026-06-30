import type { CameraStore } from '../core/CameraStore'
import type { PreviewControls } from './PreviewControls'

export class CameraEditor {
  private overlay: HTMLElement
  private previewControls: PreviewControls
  private cameraStore: CameraStore
  private visible = false
  private liveUpdateId: number | null = null

  constructor(parent: HTMLElement, previewControls: PreviewControls, cameraStore: CameraStore) {
    this.previewControls = previewControls
    this.cameraStore = cameraStore

    this.overlay = document.createElement('div')
    this.overlay.className = 'camera-editor-overlay'
    this.overlay.innerHTML = this.buildHTML()
    parent.appendChild(this.overlay)

    this.bindEvents()

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyC') {
        e.preventDefault()
        this.toggle()
      }
    })
  }

  private buildHTML(): string {
    return `
      <h3>相机编辑器</h3>
      <div class="cam-hint">在场景中自由浏览，找到满意角度后保存视角。</div>

      <div class="cam-live-info">
        <div class="cam-row"><span class="cam-label">位置</span><span data-live="pos">—</span></div>
        <div class="cam-row"><span class="cam-label">目标</span><span data-live="tgt">—</span></div>
        <div class="cam-row"><span class="cam-label">视野角</span><span data-live="fov">—</span></div>
      </div>

      <div class="cam-save-row">
        <input data-cam="preset-name" type="text" placeholder="预设名称" value="default" />
        <button data-action="save-preset">保存视角</button>
      </div>

      <div class="cam-actions">
        <button data-action="copy">复制 JSON</button>
        <button data-action="reset">恢复默认</button>
      </div>

      <div class="cam-presets-section">
        <div class="cam-presets-title">已保存的预设</div>
        <div data-presets></div>
      </div>

      <div class="cam-manual-toggle">
        <button data-action="toggle-manual">手动输入 ▸</button>
      </div>
      <div class="cam-manual" data-manual-section style="display:none">
        <div class="field"><label>位置 X</label><input data-cam="px" type="number" step="0.1" /></div>
        <div class="field"><label>位置 Y</label><input data-cam="py" type="number" step="0.1" /></div>
        <div class="field"><label>位置 Z</label><input data-cam="pz" type="number" step="0.1" /></div>
        <div class="field"><label>目标 X</label><input data-cam="tx" type="number" step="0.1" /></div>
        <div class="field"><label>目标 Y</label><input data-cam="ty" type="number" step="0.1" /></div>
        <div class="field"><label>目标 Z</label><input data-cam="tz" type="number" step="0.1" /></div>
        <div class="field"><label>视野角</label><input data-cam="fov" type="number" step="1" min="10" max="120" /></div>
        <button data-action="apply" style="width:100%;margin-top:6px;">应用数值</button>
      </div>
    `
  }

  private bindEvents(): void {
    this.overlay.querySelector('[data-action="save-preset"]')?.addEventListener('click', () => {
      const nameInput = this.overlay.querySelector('[data-cam="preset-name"]') as HTMLInputElement
      const name = nameInput?.value?.trim() || 'default'
      const preset = this.previewControls.getCurrentPreset(name)
      this.cameraStore.save(preset)
      this.renderPresets()
      this.flashButton('[data-action="save-preset"]', '已保存!')
    })

    this.overlay.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
      const preset = this.previewControls.getCurrentPreset('export')
      const json = JSON.stringify({ position: preset.position, target: preset.target, fov: preset.fov }, null, 2)
      navigator.clipboard.writeText(json).then(() => {
        this.flashButton('[data-action="copy"]', '已复制!')
      }).catch(() => {})
    })

    this.overlay.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
      const defaultPreset = this.cameraStore.getDefault()
      if (defaultPreset) {
        this.previewControls.applyPreset(defaultPreset)
      }
    })

    this.overlay.querySelector('[data-action="toggle-manual"]')?.addEventListener('click', () => {
      const section = this.overlay.querySelector('[data-manual-section]') as HTMLElement
      const btn = this.overlay.querySelector('[data-action="toggle-manual"]') as HTMLElement
      if (!section || !btn) return
      const hidden = section.style.display === 'none'
      section.style.display = hidden ? '' : 'none'
      btn.textContent = hidden ? '手动输入 ▾' : '手动输入 ▸'

      if (hidden) {
        const preset = this.previewControls.getCurrentPreset('manual')
        this.setInput('[data-cam="px"]', preset.position[0])
        this.setInput('[data-cam="py"]', preset.position[1])
        this.setInput('[data-cam="pz"]', preset.position[2])
        this.setInput('[data-cam="tx"]', preset.target[0])
        this.setInput('[data-cam="ty"]', preset.target[1])
        this.setInput('[data-cam="tz"]', preset.target[2])
        this.setInput('[data-cam="fov"]', preset.fov)
      }
    })

    this.overlay.querySelector('[data-action="apply"]')?.addEventListener('click', () => {
      const getVal = (sel: string) => parseFloat((this.overlay.querySelector(sel) as HTMLInputElement)?.value || '0')
      this.previewControls.applyPreset({
        name: 'manual',
        position: [getVal('[data-cam="px"]'), getVal('[data-cam="py"]'), getVal('[data-cam="pz"]')],
        target: [getVal('[data-cam="tx"]'), getVal('[data-cam="ty"]'), getVal('[data-cam="tz"]')],
        fov: getVal('[data-cam="fov"]'),
      })
    })
  }

  toggle(): void {
    this.visible = !this.visible
    this.overlay.classList.toggle('visible', this.visible)
    this.previewControls.setEnabled(this.visible)

    if (this.visible) {
      this.renderPresets()
      this.updateLiveInfo()
      this.liveUpdateId = window.setInterval(() => this.updateLiveInfo(), 200)
    } else if (this.liveUpdateId !== null) {
      clearInterval(this.liveUpdateId)
      this.liveUpdateId = null
    }
  }

  private updateLiveInfo(): void {
    const preset = this.previewControls.getCurrentPreset('_live')
    const fmt = (v: number) => v.toFixed(2)
    const setLive = (key: string, value: string) => {
      const el = this.overlay.querySelector(`[data-live="${key}"]`)
      if (el) el.textContent = value
    }
    setLive('pos', `${fmt(preset.position[0])}, ${fmt(preset.position[1])}, ${fmt(preset.position[2])}`)
    setLive('tgt', `${fmt(preset.target[0])}, ${fmt(preset.target[1])}, ${fmt(preset.target[2])}`)
    setLive('fov', `${fmt(preset.fov)}°`)
  }

  private renderPresets(): void {
    const container = this.overlay.querySelector('[data-presets]')
    if (!container) return

    const presets = this.cameraStore.getAll()
    if (presets.length === 0) {
      container.innerHTML = '<div style="color:var(--text-secondary);font-size:11px;padding:4px 0;">暂无保存的预设</div>'
      return
    }

    container.innerHTML = ''
    for (const p of presets) {
      const row = document.createElement('div')
      row.className = 'cam-preset-row'

      const label = document.createElement('span')
      label.className = 'cam-preset-name'
      label.textContent = p.name
      label.addEventListener('click', () => {
        this.previewControls.applyPreset(p)
      })

      const del = document.createElement('button')
      del.className = 'cam-preset-del'
      del.textContent = '×'
      del.addEventListener('click', () => {
        this.cameraStore.remove(p.name)
        this.renderPresets()
      })

      row.appendChild(label)
      row.appendChild(del)
      container.appendChild(row)
    }
  }

  private setInput(selector: string, value: number): void {
    const el = this.overlay.querySelector(selector) as HTMLInputElement
    if (el) el.value = value.toFixed(2)
  }

  private flashButton(selector: string, text: string): void {
    const btn = this.overlay.querySelector(selector) as HTMLElement
    if (!btn) return
    const original = btn.textContent
    btn.textContent = text
    setTimeout(() => {
      if (btn) btn.textContent = original
    }, 1000)
  }

  dispose(): void {
    if (this.liveUpdateId !== null) clearInterval(this.liveUpdateId)
    this.overlay.remove()
  }
}
