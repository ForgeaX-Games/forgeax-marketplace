import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { IEngine } from './types'

export interface SpriteDisplayParams {
  posX: number
  posY: number
  posZ: number
  scale: number
  opacity: number
}

const DEFAULT_PARAMS: SpriteDisplayParams = {
  posX: 0,
  posY: 0.75,
  posZ: 0,
  scale: 1.5,
  opacity: 1,
}

const STORAGE_KEY = 'ce_pixel_sprite_params_v1'

let _globalInstance: SpriteEditPanel | null = null

export function initSpriteEditPanel(engine: IEngine): SpriteEditPanel {
  if (!_globalInstance) {
    _globalInstance = new SpriteEditPanel(engine)
  }
  return _globalInstance
}

export function getSpriteEditPanel(): SpriteEditPanel | null {
  return _globalInstance
}

/**
 * In-game sprite rendering controls.
 *
 * Renders a trigger button + floating panel inside #game-hud so it
 * naturally appears only when the scene preview (game view) is active,
 * and is hidden when pipeline overlays cover the viewport.
 */
export class SpriteEditPanel {
  private engine: IEngine
  private mesh: THREE.Mesh | null = null
  private params: SpriteDisplayParams

  private hudContainer!: HTMLElement
  private panel!: HTMLElement
  private panelVisible = false

  private orbitControls: OrbitControls | null = null
  private savedCamPos = new THREE.Vector3()
  private savedCamTarget = new THREE.Vector3()
  private savedCamFov = 60
  private orbitActive = false

  constructor(engine: IEngine) {
    this.engine = engine
    this.params = this.loadParams()
    this.injectStyles()
    this.buildHudUI()
  }

  /* ── Public API ─────────────────────────────────────────── */

  attach(mesh: THREE.Mesh): void {
    this.mesh = mesh
    this.applyTransform()
    this.refreshPanel()
  }

  detach(): void {
    this.exitOrbit()
    this.mesh = null
    this.hidePanel()
    this.refreshPanel()
  }

  hasMesh(): boolean { return this.mesh !== null }
  getParams(): SpriteDisplayParams { return { ...this.params } }

  updateParam(key: keyof SpriteDisplayParams, value: number): void {
    this.params[key] = value
    this.applyTransform()
  }

  resetParams(): void {
    Object.assign(this.params, DEFAULT_PARAMS)
    this.applyTransform()
    this.syncSliders()
  }

  focusCharacter(): void {
    if (!this.mesh) return
    if (!this.orbitActive) {
      this.enterOrbit()
    } else if (this.orbitControls) {
      const charPos = new THREE.Vector3(this.params.posX, this.params.posY, this.params.posZ)
      this.orbitControls.target.copy(charPos)
      const dist = Math.max(3 * this.params.scale, 2)
      this.engine.camera.position.set(charPos.x, charPos.y + dist * 0.3, charPos.z + dist)
      this.orbitControls.update()
    }
  }

  exitOrbitMode(): void { this.exitOrbit() }

  dispose(): void {
    this.exitOrbit()
    this.hudContainer.remove()
    this.mesh = null
  }

  /* ── HUD UI ─────────────────────────────────────────────── */

  private buildHudUI(): void {
    const gameHud = document.getElementById('game-hud')
    if (!gameHud) return
    const battleHud = gameHud

    this.hudContainer = document.createElement('div')
    this.hudContainer.className = 'ce-hud-sprite'

    const triggerBtn = document.createElement('div')
    triggerBtn.className = 'ce-hud-sprite-btn'
    triggerBtn.innerHTML = '🎮'
    triggerBtn.title = '角色渲染控制'
    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.togglePanel()
    })
    this.hudContainer.appendChild(triggerBtn)

    // Panel
    this.panel = document.createElement('div')
    this.panel.className = 'ce-hud-sprite-panel'
    this.panel.style.display = 'none'
    this.buildPanelContent()
    this.hudContainer.appendChild(this.panel)

    battleHud.appendChild(this.hudContainer)
  }

  private buildPanelContent(): void {
    const hasMesh = this.mesh !== null
    const p = this.params

    const sliders: { label: string; key: keyof SpriteDisplayParams; min: number; max: number; step: number }[] = [
      { label: '水平 X', key: 'posX', min: -20, max: 20, step: 0.1 },
      { label: '高度 Y', key: 'posY', min: -10, max: 20, step: 0.1 },
      { label: '深度 Z', key: 'posZ', min: -20, max: 20, step: 0.1 },
      { label: '缩放', key: 'scale', min: 0.1, max: 10, step: 0.1 },
      { label: '不透明度', key: 'opacity', min: 0, max: 1, step: 0.01 },
    ]

    this.panel.innerHTML = `
      <div class="ce-hp-header">
        <span>🎮 角色渲染</span>
        <button class="ce-hp-close" data-action="close">×</button>
      </div>
      ${hasMesh ? `
        <div class="ce-hp-body">
          ${sliders.map(s => {
            const val = p[s.key]
            const dec = s.step < 1 ? 2 : 0
            return `<div class="ce-hp-row">
              <label>${s.label}</label>
              <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${val}" />
              <span data-val="${s.key}">${val.toFixed(dec)}</span>
            </div>`
          }).join('')}
          <div class="ce-hp-btns">
            <button data-action="reset">↩️ 重置</button>
            <button data-action="focus" class="accent">🎯 聚焦</button>
          </div>
        </div>
      ` : `
        <div class="ce-hp-empty">尚未放入角色</div>
      `}
    `
    this.bindPanelEvents()
  }

  private bindPanelEvents(): void {
    this.panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.hidePanel())

    this.panel.querySelectorAll('input[type="range"]').forEach(input => {
      const el = input as HTMLInputElement
      const key = el.dataset.key as keyof SpriteDisplayParams
      el.addEventListener('input', () => {
        const v = parseFloat(el.value)
        this.params[key] = v
        this.applyTransform()
        const valSpan = this.panel.querySelector(`[data-val="${key}"]`)
        if (valSpan) valSpan.textContent = v.toFixed(parseFloat(el.step) < 1 ? 2 : 0)
      })
    })

    this.panel.querySelector('[data-action="reset"]')?.addEventListener('click', () => {
      this.resetParams()
    })

    this.panel.querySelector('[data-action="focus"]')?.addEventListener('click', () => {
      this.focusCharacter()
    })
  }

  private syncSliders(): void {
    for (const key of Object.keys(this.params) as (keyof SpriteDisplayParams)[]) {
      const el = this.panel.querySelector(`input[data-key="${key}"]`) as HTMLInputElement | null
      if (!el) continue
      el.value = String(this.params[key])
      const valSpan = this.panel.querySelector(`[data-val="${key}"]`)
      if (valSpan) valSpan.textContent = this.params[key].toFixed(parseFloat(el.step) < 1 ? 2 : 0)
    }
  }

  private togglePanel(): void {
    if (this.panelVisible) this.hidePanel()
    else this.showPanel()
  }

  private showPanel(): void {
    this.refreshPanel()
    this.panel.style.display = ''
    this.panelVisible = true
  }

  private hidePanel(): void {
    this.panel.style.display = 'none'
    this.panelVisible = false
    this.exitOrbit()
  }

  private refreshPanel(): void {
    this.buildPanelContent()
  }

  /* ── Orbit camera ─────────────────────────────────────────── */

  private enterOrbit(): void {
    if (this.orbitActive || !this.mesh) return
    const cam = this.engine.camera

    this.savedCamPos.copy(cam.position)
    const dir = new THREE.Vector3()
    cam.getWorldDirection(dir)
    this.savedCamTarget.copy(cam.position).addScaledVector(dir, 10)
    this.savedCamFov = cam.fov

    const charPos = new THREE.Vector3(this.params.posX, this.params.posY, this.params.posZ)
    const dist = Math.max(3 * this.params.scale, 2)
    cam.position.set(charPos.x, charPos.y + dist * 0.3, charPos.z + dist)
    cam.lookAt(charPos)

    this.orbitControls = new OrbitControls(cam, this.engine.renderer.domElement)
    this.orbitControls.target.copy(charPos)
    this.orbitControls.enableDamping = true
    this.orbitControls.dampingFactor = 0.1
    this.orbitControls.enableRotate = true
    this.orbitControls.enablePan = true
    this.orbitControls.enableZoom = true
    this.orbitControls.minDistance = 0.5
    this.orbitControls.maxDistance = 20
    this.orbitControls.update()

    this.engine.onUpdate(this.orbitUpdate)
    this.orbitActive = true
  }

  private exitOrbit(): void {
    if (!this.orbitActive) return
    this.engine.removeUpdate(this.orbitUpdate)
    this.orbitControls?.dispose()
    this.orbitControls = null

    const cam = this.engine.camera
    cam.position.copy(this.savedCamPos)
    cam.lookAt(this.savedCamTarget)
    cam.fov = this.savedCamFov
    cam.updateProjectionMatrix()
    this.orbitActive = false
  }

  private orbitUpdate = (_dt: number): void => {
    this.orbitControls?.update()
  }

  /* ── Transform ────────────────────────────────────────────── */

  private applyTransform(): void {
    if (!this.mesh) return
    const p = this.params
    this.mesh.position.set(p.posX, p.posY, p.posZ)
    const geo = this.mesh.geometry as THREE.PlaneGeometry
    const baseSize = geo.parameters?.width ?? 1.5
    const ratio = p.scale / baseSize
    this.mesh.scale.set(ratio, ratio, 1)
    const mat = this.mesh.material as THREE.MeshBasicMaterial
    if ('opacity' in mat) { mat.opacity = p.opacity; mat.transparent = p.opacity < 1 }
    this.saveParams()

    if (this.orbitActive && this.orbitControls) {
      this.orbitControls.target.set(p.posX, p.posY, p.posZ)
    }
  }

  /* ── Persistence ──────────────────────────────────────────── */

  private loadParams(): SpriteDisplayParams {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return { ...DEFAULT_PARAMS, ...JSON.parse(raw) }
    } catch { /* ignore */ }
    return { ...DEFAULT_PARAMS }
  }

  private saveParams(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.params)) } catch { /* ignore */ }
  }

  /* ── Styles ───────────────────────────────────────────────── */

  private static stylesInjected = false

  private injectStyles(): void {
    if (SpriteEditPanel.stylesInjected) return
    SpriteEditPanel.stylesInjected = true

    const s = document.createElement('style')
    s.textContent = `
      /* Container — positioned inside #game-hud, bottom-right, above utility buttons */
      .ce-hud-sprite {
        position: absolute;
        bottom: 90px;
        right: 12px;
        pointer-events: auto;
        z-index: 2;
      }

      /* Trigger button — matches bui-util-btn style */
      .ce-hud-sprite-btn {
        width: 34px; height: 34px;
        border-radius: 4px;
        border: 1px solid rgba(255,215,100,0.25);
        background: rgba(12,10,8,0.85);
        backdrop-filter: blur(8px);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.6);
        transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
        margin-left: auto;
      }
      .ce-hud-sprite-btn:hover {
        transform: translateY(-2px);
        border-color: #ff6b35;
        box-shadow: 0 4px 12px rgba(255,107,53,0.4);
      }

      /* Panel — game HUD style floating panel */
      .ce-hud-sprite-panel {
        position: absolute;
        bottom: 42px;
        right: 0;
        width: 260px;
        background: rgba(12,10,8,0.92);
        border: 1px solid rgba(255,215,100,0.2);
        border-radius: 6px;
        backdrop-filter: blur(12px);
        box-shadow: 0 8px 32px rgba(0,0,0,0.6);
        font-family: 'Cinzel', system-ui, sans-serif;
        font-size: 12px;
        color: #e8e4d8;
        overflow: hidden;
        user-select: none;
      }
      .ce-hp-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        background: rgba(255,215,100,0.06);
        border-bottom: 1px solid rgba(255,215,100,0.1);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.03em;
      }
      .ce-hp-close {
        background: none; border: none;
        color: rgba(255,255,255,0.4);
        font-size: 16px; cursor: pointer;
        line-height: 1; padding: 0 2px;
      }
      .ce-hp-close:hover { color: #ff4444; }

      .ce-hp-empty {
        padding: 14px;
        text-align: center;
        color: rgba(255,255,255,0.35);
        font-size: 11px;
      }
      .ce-hp-body { padding: 6px 10px 8px; }
      .ce-hp-row {
        display: flex;
        align-items: center;
        gap: 5px;
        margin-bottom: 3px;
      }
      .ce-hp-row label {
        min-width: 50px;
        font-size: 11px;
        color: rgba(255,255,255,0.5);
        flex-shrink: 0;
      }
      .ce-hp-row input[type="range"] {
        flex: 1; height: 3px;
        -webkit-appearance: none; appearance: none;
        background: rgba(255,215,100,0.15);
        border-radius: 2px; outline: none;
      }
      .ce-hp-row input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 10px; height: 10px;
        border-radius: 50%;
        background: #ff6b35;
        cursor: pointer;
      }
      .ce-hp-row span[data-val] {
        min-width: 34px;
        text-align: right;
        font-size: 10px;
        color: rgba(255,255,255,0.4);
        font-family: monospace;
      }
      .ce-hp-btns {
        display: flex; gap: 4px; margin-top: 6px;
      }
      .ce-hp-btns button {
        flex: 1;
        background: rgba(255,215,100,0.06);
        border: 1px solid rgba(255,215,100,0.15);
        border-radius: 3px;
        color: #e8e4d8;
        padding: 4px 6px;
        font-size: 11px;
        cursor: pointer;
        font-family: inherit;
      }
      .ce-hp-btns button:hover {
        background: rgba(255,215,100,0.12);
        border-color: rgba(255,215,100,0.3);
      }
      .ce-hp-btns button.accent {
        background: rgba(255,107,53,0.15);
        border-color: rgba(255,107,53,0.3);
        color: #ff6b35;
      }
      .ce-hp-btns button.accent:hover {
        background: rgba(255,107,53,0.25);
      }
    `
    document.head.appendChild(s)
  }
}
