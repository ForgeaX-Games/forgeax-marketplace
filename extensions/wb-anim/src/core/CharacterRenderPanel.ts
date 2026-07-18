import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { IEngine } from './types'
import { forgeaxHost } from '../platform/HostSdkBridge'

/* ── Types ────────────────────────────────────────────────────────── */

export interface ChromaKeyParams {
  greenHue: number
  greenRange: number
  greenSoft: number
  greenMinSat: number
  whiteEnabled: number
  whiteBright: number
  whiteMaxSat: number
  whiteSoft: number
  spillStrength: number
  edgeCrop: number
}

export const DEFAULT_CHROMA: ChromaKeyParams = {
  greenHue: 0.33,
  greenRange: 0.12,
  greenSoft: 0.06,
  greenMinSat: 0.15,
  whiteEnabled: 1,
  whiteBright: 0.85,
  whiteMaxSat: 0.15,
  whiteSoft: 0.08,
  spillStrength: 0.5,
  edgeCrop: 0.005,
}

export interface CharacterRenderParams {
  posX: number
  posY: number
  posZ: number
  scale: number
  rotY: number
  billboard: boolean
  opacity: number
  brightness: number
  contrast: number
  saturation: number
  tintColor: string
  tintStrength: number
  chromaKey: ChromaKeyParams | null
}

const DEFAULT_PARAMS: CharacterRenderParams = {
  posX: 0,
  posY: 0.75,
  posZ: 0,
  scale: 1.5,
  rotY: 0,
  billboard: true,
  opacity: 1,
  brightness: 0,
  contrast: 1,
  saturation: 1,
  tintColor: '#ffffff',
  tintStrength: 0,
  chromaKey: null,
}

const STORAGE_KEY = 'ce_char_render_v1'

type CameraView = 'orbit' | 'front' | 'side' | 'top'

export interface AnimatorHandle {
  getActionIds(): string[]
  getAction(id: string): { actionLabel: string } | undefined
  getDirections(): string[]
  getCurrentActionId(): string | null
  getCurrentDirection(): string
  isPlaying(): boolean
  playAction(actionId: string, direction?: string): void
  setDirection(dir: string): void
  stop(): void
  resume(): void
}

export interface AnimatorCallbacks {
  animator: AnimatorHandle
  dirLabels?: Record<string, string>
  onRemove?: () => void
  onControl?: () => void
  isControlActive?: () => boolean
}

export interface AttachOptions {
  chromaKey?: ChromaKeyParams
  /** If true, panel skips material upgrade (caller manages material) */
  externalMaterial?: boolean
  aspect?: number
  /** Animator-based scene control (action/direction/playback/remove/control) */
  animatorCallbacks?: AnimatorCallbacks
}

/* ── Shaders ─────────────────────────────────────────────────────── */

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG_STANDARD = `
uniform sampler2D map;
uniform float opacity;
uniform float brightness;
uniform float contrast;
uniform float saturation;
uniform vec3 tintColor;
uniform float tintStrength;
varying vec2 vUv;

void main() {
  vec4 texColor = texture2D(map, vUv);
  if (texColor.a < 0.01) discard;
  vec3 c = texColor.rgb;
  c += brightness;
  c = (c - 0.5) * contrast + 0.5;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, saturation);
  c = mix(c, c * tintColor, tintStrength);
  c = clamp(c, 0.0, 1.0);
  gl_FragColor = vec4(c, texColor.a * opacity);
}
`

const FRAG_CHROMA = `
uniform sampler2D map;
uniform float opacity;
uniform float brightness;
uniform float contrast;
uniform float saturation;
uniform vec3 tintColor;
uniform float tintStrength;
uniform float greenHue;
uniform float greenRange;
uniform float greenSoft;
uniform float greenMinSat;
uniform float whiteEnabled;
uniform float whiteBright;
uniform float whiteMaxSat;
uniform float whiteSoft;
uniform float spillStrength;
uniform float edgeCrop;
varying vec2 vUv;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

void main() {
  if (edgeCrop > 0.0) {
    if (vUv.x < edgeCrop || vUv.x > 1.0 - edgeCrop ||
        vUv.y < edgeCrop || vUv.y > 1.0 - edgeCrop) {
      gl_FragColor = vec4(0.0);
      return;
    }
  }

  vec4 texColor = texture2D(map, vUv);
  vec3 hsv = rgb2hsv(texColor.rgb);
  float hue = hsv.x; float sat = hsv.y; float val = hsv.z;

  float hueDist = abs(hue - greenHue);
  hueDist = min(hueDist, 1.0 - hueDist);
  float greenMask = (1.0 - smoothstep(greenRange - greenSoft, greenRange + greenSoft, hueDist))
                  * smoothstep(greenMinSat - 0.05, greenMinSat + 0.05, sat);
  float alpha = 1.0 - greenMask;

  if (whiteEnabled > 0.5) {
    float whiteMask = smoothstep(whiteBright - whiteSoft, whiteBright + whiteSoft, val)
                    * (1.0 - smoothstep(whiteMaxSat - 0.05, whiteMaxSat + 0.05, sat));
    alpha *= (1.0 - whiteMask);
  }

  vec3 c = texColor.rgb;
  if (spillStrength > 0.0 && alpha > 0.01) {
    float avgRB = (c.r + c.b) * 0.5;
    float spill = c.g - avgRB;
    if (spill > 0.0) { c.g -= spill * spillStrength; }
  }

  c += brightness;
  c = (c - 0.5) * contrast + 0.5;
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, saturation);
  c = mix(c, c * tintColor, tintStrength);
  c = clamp(c, 0.0, 1.0);

  gl_FragColor = vec4(c, texColor.a * alpha * opacity);
}
`

/* ── Singleton ────────────────────────────────────────────────────── */

let _globalInstance: CharacterRenderPanel | null = null

export function initCharacterRenderPanel(engine: IEngine): CharacterRenderPanel {
  if (!_globalInstance) {
    _globalInstance = new CharacterRenderPanel(engine)
  }
  return _globalInstance
}

export function getCharacterRenderPanel(): CharacterRenderPanel | null {
  return _globalInstance
}

/* ── Panel class ──────────────────────────────────────────────────── */

export class CharacterRenderPanel {
  private engine: IEngine
  private mesh: THREE.Mesh | null = null
  private originalMaterial: THREE.Material | null = null
  private shaderMaterial: THREE.ShaderMaterial | null = null
  private params: CharacterRenderParams
  private chromaMode = false
  private externalMaterial = false
  private aspect = 1

  private hudContainer!: HTMLElement
  private panel!: HTMLElement
  private panelVisible = false
  private animatorCbs: AnimatorCallbacks | null = null

  private orbitControls: OrbitControls | null = null
  private savedCamPos = new THREE.Vector3()
  private savedCamTarget = new THREE.Vector3()
  private savedCamFov = 60
  private orbitActive = false
  private currentView: CameraView = 'orbit'

  constructor(engine: IEngine) {
    this.engine = engine
    this.params = this.loadParams()
    this.injectStyles()
    this.buildHudUI()
  }

  /* ── Public API ─────────────────────────────────────────── */

  attach(mesh: THREE.Mesh, opts?: AttachOptions): void {
    this.mesh = mesh
    this.originalMaterial = mesh.material as THREE.Material
    this.externalMaterial = opts?.externalMaterial ?? false
    this.aspect = opts?.aspect ?? 1
    this.animatorCbs = opts?.animatorCallbacks ?? null

    if (opts?.chromaKey) {
      this.params.chromaKey = { ...opts.chromaKey }
      this.chromaMode = true
    } else {
      this.chromaMode = false
    }

    if (!this.externalMaterial) {
      this.upgradeMaterial()
    } else {
      this.shaderMaterial = mesh.material instanceof THREE.ShaderMaterial ? mesh.material : null
    }
    this.applyTransform()
    this.applyMaterial()
    this.refreshPanel()
  }

  detach(): void {
    this.exitOrbit()
    if (this.mesh && this.originalMaterial && !this.externalMaterial) {
      this.mesh.material = this.originalMaterial
    }
    if (!this.externalMaterial) {
      this.shaderMaterial?.dispose()
    }
    this.shaderMaterial = null
    this.originalMaterial = null
    this.mesh = null
    this.chromaMode = false
    this.externalMaterial = false
    this.animatorCbs = null
    this.hidePanel()
    this.refreshPanel()
  }

  hasMesh(): boolean { return this.mesh !== null }
  getParams(): CharacterRenderParams { return { ...this.params } }
  isBillboard(): boolean { return this.params.billboard }

  updateParam<K extends keyof CharacterRenderParams>(key: K, value: CharacterRenderParams[K]): void {
    (this.params as unknown as Record<string, unknown>)[key] = value
    this.applyTransform()
    this.applyMaterial()
  }

  updateChromaParam<K extends keyof ChromaKeyParams>(key: K, value: number): void {
    if (!this.params.chromaKey) return
    this.params.chromaKey[key] = value
    this.applyMaterial()
  }

  resetParams(): void {
    const hadChroma = this.chromaMode
    Object.assign(this.params, DEFAULT_PARAMS)
    if (hadChroma) this.params.chromaKey = { ...DEFAULT_CHROMA }
    this.applyTransform()
    this.applyMaterial()
    this.syncSliders()
  }

  focusCharacter(view?: CameraView): void {
    if (!this.mesh) return
    const v = view ?? this.currentView
    this.currentView = v

    const charPos = new THREE.Vector3(this.params.posX, this.params.posY, this.params.posZ)
    const dist = Math.max(3 * this.params.scale, 2)

    if (!this.orbitActive) this.enterOrbit()
    if (!this.orbitControls) return

    this.orbitControls.target.copy(charPos)

    switch (v) {
      case 'front':
        this.engine.camera.position.set(charPos.x, charPos.y, charPos.z + dist)
        break
      case 'side':
        this.engine.camera.position.set(charPos.x + dist, charPos.y, charPos.z)
        break
      case 'top':
        this.engine.camera.position.set(charPos.x, charPos.y + dist, charPos.z + 0.01)
        break
      default:
        this.engine.camera.position.set(charPos.x, charPos.y + dist * 0.3, charPos.z + dist)
    }

    this.orbitControls.update()
    this.updateViewButtons()
  }

  exitOrbitMode(): void { this.exitOrbit() }

  dispose(): void {
    this.exitOrbit()
    this.hudContainer.remove()
    if (!this.externalMaterial) this.shaderMaterial?.dispose()
    this.mesh = null
  }

  syncTexture(texture: THREE.Texture): void {
    if (this.shaderMaterial) {
      this.shaderMaterial.uniforms.map.value = texture
    }
  }

  /* ── Material ──────────────────────────────────────────────── */

  private upgradeMaterial(): void {
    if (!this.mesh) return
    const oldMat = this.mesh.material as THREE.MeshBasicMaterial
    const texture = oldMat.map
    if (!texture) return

    // Dispose old material (but NOT its texture — we reuse that)
    oldMat.map = null
    oldMat.dispose()

    const uniforms: Record<string, THREE.IUniform> = {
      map: { value: texture },
      opacity: { value: this.params.opacity },
      brightness: { value: this.params.brightness },
      contrast: { value: this.params.contrast },
      saturation: { value: this.params.saturation },
      tintColor: { value: new THREE.Color(this.params.tintColor) },
      tintStrength: { value: this.params.tintStrength },
    }

    if (this.chromaMode && this.params.chromaKey) {
      const ck = this.params.chromaKey
      Object.assign(uniforms, {
        greenHue: { value: ck.greenHue },
        greenRange: { value: ck.greenRange },
        greenSoft: { value: ck.greenSoft },
        greenMinSat: { value: ck.greenMinSat },
        whiteEnabled: { value: ck.whiteEnabled },
        whiteBright: { value: ck.whiteBright },
        whiteMaxSat: { value: ck.whiteMaxSat },
        whiteSoft: { value: ck.whiteSoft },
        spillStrength: { value: ck.spillStrength },
        edgeCrop: { value: ck.edgeCrop },
      })
    }

    this.shaderMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: this.chromaMode ? FRAG_CHROMA : FRAG_STANDARD,
      side: THREE.FrontSide,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: false,
    })

    this.mesh.material = this.shaderMaterial
  }

  private applyMaterial(): void {
    if (!this.shaderMaterial) return
    const u = this.shaderMaterial.uniforms
    u.opacity.value = this.params.opacity
    if (u.brightness) u.brightness.value = this.params.brightness
    if (u.contrast) u.contrast.value = this.params.contrast
    if (u.saturation) u.saturation.value = this.params.saturation
    if (u.tintColor) u.tintColor.value.set(this.params.tintColor)
    if (u.tintStrength) u.tintStrength.value = this.params.tintStrength

    if (this.params.chromaKey) {
      const ck = this.params.chromaKey
      if (u.greenHue) u.greenHue.value = ck.greenHue
      if (u.greenRange) u.greenRange.value = ck.greenRange
      if (u.greenSoft) u.greenSoft.value = ck.greenSoft
      if (u.greenMinSat) u.greenMinSat.value = ck.greenMinSat
      if (u.whiteEnabled) u.whiteEnabled.value = ck.whiteEnabled
      if (u.whiteBright) u.whiteBright.value = ck.whiteBright
      if (u.whiteMaxSat) u.whiteMaxSat.value = ck.whiteMaxSat
      if (u.whiteSoft) u.whiteSoft.value = ck.whiteSoft
      if (u.spillStrength) u.spillStrength.value = ck.spillStrength
      if (u.edgeCrop) u.edgeCrop.value = ck.edgeCrop
    }
    this.saveParams()
  }

  /* ── HUD UI ─────────────────────────────────────────────── */

  private buildHudUI(): void {
    const gameHud = document.getElementById('game-hud')
    if (!gameHud) return
    const battleHud = gameHud

    this.hudContainer = document.createElement('div')
    this.hudContainer.className = 'ce-rp-container'

    const triggerBtn = document.createElement('div')
    triggerBtn.className = 'ce-rp-trigger'
    triggerBtn.innerHTML = '🎨'
    triggerBtn.title = '角色渲染控制'
    triggerBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.togglePanel()
    })
    this.hudContainer.appendChild(triggerBtn)

    this.panel = document.createElement('div')
    this.panel.className = 'ce-rp-panel'
    this.panel.style.display = 'none'
    this.buildPanelContent()
    this.hudContainer.appendChild(this.panel)

    battleHud.appendChild(this.hudContainer)
  }

  private buildPanelContent(): void {
    const hasMesh = this.mesh !== null
    const p = this.params

    if (!hasMesh) {
      this.panel.innerHTML = `
        <div class="ce-rp-header">
          <span>🎨 角色渲染</span>
          <button class="ce-rp-close" data-action="close">\u00d7</button>
        </div>
        <div class="ce-rp-empty">尚未放入角色</div>`
      this.bindHeaderEvents()
      return
    }

    const row = (label: string, key: string, min: number, max: number, step: number, val: number) => {
      const dec = step < 1 ? (step < 0.1 ? 2 : 1) : 0
      return `<div class="ce-rp-row">
        <label>${label}</label>
        <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${val}" />
        <span data-val="${key}">${val.toFixed(dec)}</span>
      </div>`
    }

    const ck = p.chromaKey
    const chromaHTML = ck ? `
        <div class="ce-rp-section">
          <div class="ce-rp-section-title" data-toggle="chroma-green">绿幕抠像</div>
          <div class="ce-rp-section-body" data-section="chroma-green">
            ${row('色相中心', 'ck.greenHue', 0, 1, 0.01, ck.greenHue)}
            ${row('色相范围', 'ck.greenRange', 0, 0.5, 0.01, ck.greenRange)}
            ${row('边缘柔化', 'ck.greenSoft', 0, 0.2, 0.01, ck.greenSoft)}
            ${row('最低饱和', 'ck.greenMinSat', 0, 1, 0.01, ck.greenMinSat)}
          </div>
        </div>
        <div class="ce-rp-section">
          <div class="ce-rp-section-title" data-toggle="chroma-white">白底去除</div>
          <div class="ce-rp-section-body" data-section="chroma-white">
            <div class="ce-rp-row">
              <label>启用</label>
              <div class="ce-rp-toggle">
                <button class="ce-rp-toggle-btn${ck.whiteEnabled > 0.5 ? ' active' : ''}" data-white="1">开</button>
                <button class="ce-rp-toggle-btn${ck.whiteEnabled <= 0.5 ? ' active' : ''}" data-white="0">关</button>
              </div>
            </div>
            ${row('亮度阈值', 'ck.whiteBright', 0.5, 1, 0.01, ck.whiteBright)}
            ${row('最大饱和', 'ck.whiteMaxSat', 0, 0.5, 0.01, ck.whiteMaxSat)}
            ${row('柔化', 'ck.whiteSoft', 0, 0.3, 0.01, ck.whiteSoft)}
          </div>
        </div>
        <div class="ce-rp-section">
          <div class="ce-rp-section-title" data-toggle="chroma-post">抠像后处理</div>
          <div class="ce-rp-section-body" data-section="chroma-post">
            ${row('绿溢抑制', 'ck.spillStrength', 0, 1, 0.01, ck.spillStrength)}
            ${row('边缘裁切', 'ck.edgeCrop', 0, 0.05, 0.001, ck.edgeCrop)}
          </div>
        </div>` : ''

    const animCtrlHTML = this.buildAnimatorSection()

    this.panel.innerHTML = `
      <div class="ce-rp-header">
        <span>🎨 角色渲染</span>
        <button class="ce-rp-close" data-action="close">\u00d7</button>
      </div>
      <div class="ce-rp-body">
        ${animCtrlHTML}
        <div class="ce-rp-section">
          <div class="ce-rp-section-title" data-toggle="transform">变换</div>
          <div class="ce-rp-section-body" data-section="transform">
            ${row('X 位置', 'posX', -20, 20, 0.1, p.posX)}
            ${row('Y 高度', 'posY', -10, 20, 0.1, p.posY)}
            ${row('Z 深度', 'posZ', -20, 20, 0.1, p.posZ)}
            ${row('缩放', 'scale', 0.1, 15, 0.1, p.scale)}
            ${row('Y旋转', 'rotY', -180, 180, 1, p.rotY)}
          </div>
        </div>

        <div class="ce-rp-section">
          <div class="ce-rp-section-title" data-toggle="display">显示</div>
          <div class="ce-rp-section-body" data-section="display">
            <div class="ce-rp-row">
              <label>朝向</label>
              <div class="ce-rp-toggle">
                <button class="ce-rp-toggle-btn${p.billboard ? ' active' : ''}" data-billboard="true">跟随相机</button>
                <button class="ce-rp-toggle-btn${!p.billboard ? ' active' : ''}" data-billboard="false">轴向固定</button>
              </div>
            </div>
            ${row('不透明', 'opacity', 0, 1, 0.01, p.opacity)}
          </div>
        </div>

        <div class="ce-rp-section">
          <div class="ce-rp-section-title" data-toggle="material">材质调节</div>
          <div class="ce-rp-section-body" data-section="material">
            ${row('亮度', 'brightness', -1, 1, 0.01, p.brightness)}
            ${row('对比度', 'contrast', 0, 2, 0.01, p.contrast)}
            ${row('饱和度', 'saturation', 0, 2, 0.01, p.saturation)}
            <div class="ce-rp-row">
              <label>色调</label>
              <input type="color" data-key="tintColor" value="${p.tintColor}" class="ce-rp-color" />
              <input type="range" data-key="tintStrength" min="0" max="1" step="0.01" value="${p.tintStrength}" style="flex:1" />
              <span data-val="tintStrength">${p.tintStrength.toFixed(2)}</span>
            </div>
          </div>
        </div>

        ${chromaHTML}

        <div class="ce-rp-section">
          <div class="ce-rp-section-title" data-toggle="camera">相机视角</div>
          <div class="ce-rp-section-body" data-section="camera">
            <div class="ce-rp-views">
              <button class="ce-rp-view-btn${this.currentView === 'orbit' ? ' active' : ''}" data-view="orbit">自由</button>
              <button class="ce-rp-view-btn${this.currentView === 'front' ? ' active' : ''}" data-view="front">正面</button>
              <button class="ce-rp-view-btn${this.currentView === 'side' ? ' active' : ''}" data-view="side">侧面</button>
              <button class="ce-rp-view-btn${this.currentView === 'top' ? ' active' : ''}" data-view="top">俯视</button>
            </div>
          </div>
        </div>

        <div class="ce-rp-footer">
          <button data-action="reset">↩ 重置</button>
          <button data-action="focus" class="accent">聚焦</button>
          <button data-action="save-project" class="accent">保存项目</button>
        </div>
      </div>`
    this.bindAllEvents()
  }

  private buildAnimatorSection(): string {
    const ac = this.animatorCbs
    if (!ac) return ''

    const anim = ac.animator
    const actions = anim.getActionIds()
    const currentAction = anim.getCurrentActionId() ?? actions[0]
    const dirs = anim.getDirections()
    const currentDir = anim.getCurrentDirection()
    const labels = ac.dirLabels ?? {}
    const isCtrl = ac.isControlActive?.() ?? false

    return `
      <div class="ce-rp-section">
        <div class="ce-rp-section-title" data-toggle="anim-ctrl">动画控制</div>
        <div class="ce-rp-section-body" data-section="anim-ctrl">
          <div class="ce-rp-row">
            <label>动作</label>
            <select data-anim="action" class="ce-rp-select">
              ${actions.map(a => {
                const d = anim.getAction(a)
                return `<option value="${a}" ${a === currentAction ? 'selected' : ''}>${d?.actionLabel ?? a}</option>`
              }).join('')}
            </select>
          </div>
          <div class="ce-rp-row">
            <label>方向</label>
            <select data-anim="dir" class="ce-rp-select">
              ${dirs.map(d => `<option value="${d}" ${d === currentDir ? 'selected' : ''}>${labels[d] ?? d}</option>`).join('')}
            </select>
          </div>
          <div class="ce-rp-row" style="gap:4px">
            <button class="ce-rp-anim-btn" data-anim="playpause">${anim.isPlaying() ? '⏸' : '▶'}</button>
            <button class="ce-rp-anim-btn" data-anim="stop">⏹</button>
            <button class="ce-rp-anim-btn ce-rp-anim-remove" data-anim="remove">移除</button>
          </div>
          ${ac.onControl ? `
          <div class="ce-rp-row" style="margin-top:4px">
            <button class="ce-rp-anim-ctrl-btn ${isCtrl ? 'active' : ''}" data-anim="control">
              ${isCtrl ? '⏹ 退出控制 (Tab)' : '🕹️ 控制角色 (Tab)'}
            </button>
          </div>` : ''}
        </div>
      </div>`
  }

  private bindAnimatorEvents(): void {
    const ac = this.animatorCbs
    if (!ac) return
    const anim = ac.animator

    this.panel.querySelector('[data-anim="action"]')?.addEventListener('change', (e) => {
      anim.playAction((e.target as HTMLSelectElement).value)
      this.refreshPanel()
    })

    this.panel.querySelector('[data-anim="dir"]')?.addEventListener('change', (e) => {
      anim.setDirection((e.target as HTMLSelectElement).value)
    })

    this.panel.querySelector('[data-anim="playpause"]')?.addEventListener('click', () => {
      if (anim.isPlaying()) anim.stop()
      else anim.resume()
      const btn = this.panel.querySelector('[data-anim="playpause"]') as HTMLElement
      if (btn) btn.textContent = anim.isPlaying() ? '⏸' : '▶'
    })

    this.panel.querySelector('[data-anim="stop"]')?.addEventListener('click', () => {
      anim.stop()
      anim.playAction(anim.getCurrentActionId()!)
      anim.stop()
      const btn = this.panel.querySelector('[data-anim="playpause"]') as HTMLElement
      if (btn) btn.textContent = '▶'
    })

    this.panel.querySelector('[data-anim="remove"]')?.addEventListener('click', () => {
      ac.onRemove?.()
    })

    this.panel.querySelector('[data-anim="control"]')?.addEventListener('click', () => {
      ac.onControl?.()
      this.refreshPanel()
    })
  }

  private bindHeaderEvents(): void {
    this.panel.querySelector('[data-action="close"]')?.addEventListener('click', () => this.hidePanel())
  }

  private bindAllEvents(): void {
    this.bindHeaderEvents()
    this.bindAnimatorEvents()

    this.panel.querySelectorAll<HTMLElement>('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const sectionName = el.dataset.toggle!
        const body = this.panel.querySelector(`[data-section="${sectionName}"]`) as HTMLElement
        if (!body) return
        const hidden = body.style.display === 'none'
        body.style.display = hidden ? '' : 'none'
        el.classList.toggle('collapsed', !hidden)
      })
    })

    this.panel.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(el => {
      const key = el.dataset.key
      if (!key) return
      el.addEventListener('input', () => {
        const v = parseFloat(el.value)
        if (key.startsWith('ck.') && this.params.chromaKey) {
          const ckKey = key.slice(3) as keyof ChromaKeyParams
          this.params.chromaKey[ckKey] = v
          this.applyMaterial()
        } else {
          (this.params as unknown as Record<string, unknown>)[key] = v
          this.applyTransform()
          this.applyMaterial()
        }
        const valSpan = this.panel.querySelector(`[data-val="${key}"]`)
        if (valSpan) valSpan.textContent = v.toFixed(parseFloat(el.step) < 1 ? (parseFloat(el.step) < 0.1 ? 2 : 1) : 0)
      })
    })

    this.panel.querySelector<HTMLInputElement>('input[data-key="tintColor"]')?.addEventListener('input', (e) => {
      this.params.tintColor = (e.target as HTMLInputElement).value
      this.applyMaterial()
    })

    this.panel.querySelectorAll<HTMLButtonElement>('[data-billboard]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.params.billboard = btn.dataset.billboard === 'true'
        this.applyTransform()
        this.panel.querySelectorAll<HTMLButtonElement>('[data-billboard]').forEach(b => {
          b.classList.toggle('active', b.dataset.billboard === String(this.params.billboard))
        })
      })
    })

    this.panel.querySelectorAll<HTMLButtonElement>('[data-white]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.params.chromaKey) return
        this.params.chromaKey.whiteEnabled = parseFloat(btn.dataset.white!)
        this.applyMaterial()
        this.panel.querySelectorAll<HTMLButtonElement>('[data-white]').forEach(b => {
          b.classList.toggle('active', b.dataset.white === String(this.params.chromaKey!.whiteEnabled))
        })
      })
    })

    this.panel.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.focusCharacter(btn.dataset.view as CameraView)
      })
    })

    this.panel.querySelector('[data-action="reset"]')?.addEventListener('click', () => this.resetParams())
    this.panel.querySelector('[data-action="focus"]')?.addEventListener('click', () => this.focusCharacter())
    this.panel.querySelector('[data-action="save-project"]')?.addEventListener('click', () => this.saveToProject())
  }

  private updateViewButtons(): void {
    this.panel.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === this.currentView)
    })
  }

  private syncSliders(): void {
    const numKeys: (keyof CharacterRenderParams)[] = [
      'posX', 'posY', 'posZ', 'scale', 'rotY', 'opacity',
      'brightness', 'contrast', 'saturation', 'tintStrength',
    ]
    for (const key of numKeys) {
      const el = this.panel.querySelector(`input[type="range"][data-key="${key}"]`) as HTMLInputElement | null
      if (!el) continue
      const v = this.params[key] as number
      el.value = String(v)
      const valSpan = this.panel.querySelector(`[data-val="${key}"]`)
      if (valSpan) valSpan.textContent = v.toFixed(parseFloat(el.step) < 1 ? (parseFloat(el.step) < 0.1 ? 2 : 1) : 0)
    }

    if (this.params.chromaKey) {
      const ck = this.params.chromaKey
      for (const ckKey of Object.keys(ck) as (keyof ChromaKeyParams)[]) {
        const dataKey = `ck.${ckKey}`
        const el = this.panel.querySelector(`input[data-key="${dataKey}"]`) as HTMLInputElement | null
        if (!el) continue
        el.value = String(ck[ckKey])
        const valSpan = this.panel.querySelector(`[data-val="${dataKey}"]`)
        if (valSpan) valSpan.textContent = (ck[ckKey] as number).toFixed(parseFloat(el.step) < 1 ? 2 : 0)
      }
    }

    const colorEl = this.panel.querySelector('input[data-key="tintColor"]') as HTMLInputElement | null
    if (colorEl) colorEl.value = this.params.tintColor

    this.panel.querySelectorAll<HTMLButtonElement>('[data-billboard]').forEach(b => {
      b.classList.toggle('active', b.dataset.billboard === String(this.params.billboard))
    })
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

    if (this.aspect !== 1) {
      this.mesh.scale.set(p.scale * this.aspect, p.scale, 1)
    } else {
      const geo = this.mesh.geometry as THREE.PlaneGeometry
      const baseSize = geo.parameters?.width ?? 1.5
      const ratio = p.scale / baseSize
      this.mesh.scale.set(ratio, ratio, 1)
    }

    if (!p.billboard) {
      this.mesh.rotation.set(0, p.rotY * Math.PI / 180, 0)
    }

    this.saveParams()
  }

  /* ── Persistence ──────────────────────────────────────────── */

  private loadParams(): CharacterRenderParams {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return { ...DEFAULT_PARAMS, ...JSON.parse(raw) }
    } catch { /* ignore */ }
    return { ...DEFAULT_PARAMS }
  }

  private saveParams(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.params)) } catch { /* ignore */ }
  }

  private async saveToProject(): Promise<void> {
    // Doc 01 §P4 funnel: host.tool.call when iframe-embedded, fall through
    // to direct PUT for legacy standalone (`npm run dev`) scenarios.
    let saved = false
    if (forgeaxHost.available) {
      try {
        const r = await forgeaxHost.tool.call('character:save-render-config', this.params)
        if (r.ok) saved = true
      } catch { /* fall through */ }
    }
    if (!saved) {
      try {
        await fetch('/__ce-api__/character-render-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.params),
        })
        saved = true
      } catch { /* silent */ }
    }
    if (saved) this.flashButton('[data-action="save-project"]')
  }

  async loadFromProject(): Promise<void> {
    try {
      const res = await fetch('/__ce-api__/character-render-config')
      if (!res.ok) return
      const data = await res.json()
      Object.assign(this.params, data)
      this.applyTransform()
      this.applyMaterial()
      this.syncSliders()
    } catch { /* silent */ }
  }

  private flashButton(selector: string): void {
    const btn = this.panel.querySelector(selector) as HTMLElement
    if (!btn) return
    btn.classList.add('flash')
    setTimeout(() => btn.classList.remove('flash'), 800)
  }

  /* ── Styles ────────────────────────────────────────────────── */

  private static stylesInjected = false

  private injectStyles(): void {
    if (CharacterRenderPanel.stylesInjected) return
    CharacterRenderPanel.stylesInjected = true

    const s = document.createElement('style')
    s.textContent = `
.ce-rp-container {
  position: absolute; bottom: 90px; right: 12px;
  pointer-events: auto; z-index: 2;
}
.ce-rp-trigger {
  width: 34px; height: 34px; border-radius: 4px;
  border: 1px solid rgba(255,215,100,0.25);
  background: rgba(12,10,8,0.85); backdrop-filter: blur(8px);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  font-size: 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.6);
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s;
  margin-left: auto;
}
.ce-rp-trigger:hover {
  transform: translateY(-2px); border-color: #ff6b35;
  box-shadow: 0 4px 12px rgba(255,107,53,0.4);
}
.ce-rp-panel {
  position: absolute; bottom: 42px; right: 0; width: 280px;
  background: rgba(12,10,8,0.94); border: 1px solid rgba(255,215,100,0.2);
  border-radius: 8px; backdrop-filter: blur(12px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  font-family: system-ui, -apple-system, sans-serif; font-size: 12px;
  color: #e8e4d8; overflow: hidden; user-select: none;
  max-height: 70vh; overflow-y: auto;
  scrollbar-width: thin; scrollbar-color: rgba(255,215,100,0.2) transparent;
}
.ce-rp-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 10px; background: rgba(255,215,100,0.06);
  border-bottom: 1px solid rgba(255,215,100,0.1);
  font-size: 12px; font-weight: 600; letter-spacing: 0.03em;
  position: sticky; top: 0; z-index: 1; backdrop-filter: blur(12px);
}
.ce-rp-close {
  background: none; border: none; color: rgba(255,255,255,0.4);
  font-size: 16px; cursor: pointer; line-height: 1; padding: 0 2px;
}
.ce-rp-close:hover { color: #ff4444; }
.ce-rp-empty {
  padding: 14px; text-align: center; color: rgba(255,255,255,0.35); font-size: 11px;
}
.ce-rp-body { padding: 0; }
.ce-rp-section { border-bottom: 1px solid rgba(255,215,100,0.06); }
.ce-rp-section-title {
  padding: 6px 10px; font-size: 10px; font-weight: 700;
  color: rgba(255,215,100,0.6); text-transform: uppercase;
  letter-spacing: 0.08em; cursor: pointer;
  display: flex; align-items: center; gap: 4px;
}
.ce-rp-section-title::before { content: '\\25BE'; font-size: 8px; }
.ce-rp-section-title.collapsed::before { content: '\\25B8'; }
.ce-rp-section-body { padding: 2px 10px 8px; }
.ce-rp-row {
  display: flex; align-items: center; gap: 5px; margin-bottom: 3px;
}
.ce-rp-row label {
  min-width: 44px; font-size: 10px; color: rgba(255,255,255,0.45); flex-shrink: 0;
}
.ce-rp-row input[type="range"] {
  flex: 1; height: 3px; -webkit-appearance: none; appearance: none;
  background: rgba(255,215,100,0.15); border-radius: 2px; outline: none;
}
.ce-rp-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none; width: 10px; height: 10px;
  border-radius: 50%; background: #ff6b35; cursor: pointer;
}
.ce-rp-row span[data-val] {
  min-width: 32px; text-align: right; font-size: 9px;
  color: rgba(255,255,255,0.4); font-family: monospace;
}
.ce-rp-color {
  width: 22px; height: 18px; padding: 0; border: 1px solid rgba(255,215,100,0.2);
  border-radius: 3px; background: none; cursor: pointer; flex-shrink: 0;
}
.ce-rp-toggle {
  display: flex; gap: 2px; flex: 1;
}
.ce-rp-toggle-btn {
  flex: 1; padding: 3px 6px; border: 1px solid rgba(255,215,100,0.15);
  border-radius: 3px; background: transparent; color: rgba(255,255,255,0.45);
  font-size: 10px; cursor: pointer; font-family: inherit; transition: all 0.15s;
  text-align: center;
}
.ce-rp-toggle-btn:hover { background: rgba(255,215,100,0.06); }
.ce-rp-toggle-btn.active {
  background: rgba(255,107,53,0.15); border-color: rgba(255,107,53,0.4);
  color: #ff6b35; font-weight: 600;
}
.ce-rp-views {
  display: flex; gap: 4px;
}
.ce-rp-view-btn {
  flex: 1; padding: 4px 4px; border: 1px solid rgba(255,215,100,0.15);
  border-radius: 4px; background: rgba(255,215,100,0.04); color: #e8e4d8;
  font-size: 10px; cursor: pointer; font-family: inherit; text-align: center;
  transition: all 0.15s;
}
.ce-rp-view-btn:hover { background: rgba(255,215,100,0.1); }
.ce-rp-view-btn.active {
  background: rgba(255,107,53,0.2); border-color: rgba(255,107,53,0.4);
  color: #ff6b35; font-weight: 600;
}
.ce-rp-footer {
  display: flex; gap: 4px; padding: 6px 10px 8px;
  border-top: 1px solid rgba(255,215,100,0.08);
}
.ce-rp-footer button {
  flex: 1; background: rgba(255,215,100,0.06);
  border: 1px solid rgba(255,215,100,0.15); border-radius: 4px;
  color: #e8e4d8; padding: 5px 4px; font-size: 10px;
  cursor: pointer; font-family: inherit; transition: all 0.15s;
  position: relative; overflow: hidden;
}
.ce-rp-footer button:hover {
  background: rgba(255,215,100,0.12); border-color: rgba(255,215,100,0.3);
}
.ce-rp-footer button.accent {
  background: rgba(255,107,53,0.12); border-color: rgba(255,107,53,0.25);
  color: #ff6b35;
}
.ce-rp-footer button.accent:hover { background: rgba(255,107,53,0.22); }
.ce-rp-footer button.flash::after {
  content: '\\2713'; position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(80,200,120,0.2); color: #50c878;
  font-weight: 700; animation: ce-rp-flash 0.3s ease;
}
@keyframes ce-rp-flash {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}
.ce-rp-select {
  flex: 1; background: rgba(12,10,8,0.7); border: 1px solid rgba(255,215,100,0.15);
  border-radius: 3px; color: #e8e4d8; font-size: 10px; padding: 3px 5px;
  font-family: inherit; cursor: pointer; outline: none;
}
.ce-rp-select:hover { border-color: rgba(255,215,100,0.3); }
.ce-rp-select:focus { border-color: #ff6b35; }
.ce-rp-anim-btn {
  flex: 1; padding: 4px 6px; border: 1px solid rgba(255,215,100,0.15);
  border-radius: 3px; background: rgba(255,215,100,0.06); color: #e8e4d8;
  font-size: 11px; cursor: pointer; font-family: inherit; text-align: center;
  transition: all 0.15s;
}
.ce-rp-anim-btn:hover { background: rgba(255,215,100,0.12); }
.ce-rp-anim-remove { color: #ff4444 !important; border-color: rgba(255,68,68,0.2) !important; }
.ce-rp-anim-remove:hover { background: rgba(255,68,68,0.12) !important; }
.ce-rp-anim-ctrl-btn {
  flex: 1; width: 100%; padding: 5px 8px; border-radius: 4px; font-size: 11px;
  cursor: pointer; font-family: inherit; font-weight: 600; text-align: center;
  transition: all 0.15s; border: 1px solid rgba(100,200,255,0.35);
  background: rgba(100,200,255,0.12); color: #64c8ff;
}
.ce-rp-anim-ctrl-btn:hover { background: rgba(100,200,255,0.2); }
.ce-rp-anim-ctrl-btn.active {
  background: rgba(100,255,100,0.15); border-color: rgba(100,255,100,0.4); color: #7fff7f;
}
.ce-rp-anim-ctrl-btn.active:hover { background: rgba(100,255,100,0.25); }
`
    document.head.appendChild(s)
  }
}
