// @source wb-character/src/vfx2-entry.ts
/**
 * VFX2 Entry — Phase 2/3/4 
 *
 *  vfx2.html ，  Three.js ，
 * ， 。
 */

import * as THREE from 'three'
import { HitImpactEffect }    from './vfx/effects/hit/HitImpactEffect'
import { DamageNumber }       from './vfx/effects/hit/DamageNumber'
import { ModernWeaponVFX, createModernWeaponVFX } from './vfx/effects/modern/ModernWeaponVFX'
import { resolveVFXColors, colorPackToHex } from './vfx/style/VFXColorResolver'
import { WORLD_STYLE_PALETTE } from './vfx/style/WorldStylePalette'
import { CLASS_AFFINITY }      from './vfx/style/ClassElementAffinity'
import { MODERN_WEAPON_CONFIGS, inferWeaponCategory } from './vfx/effects/modern/ModernWeaponTypes'
import type { HitType, HitElement } from './vfx/effects/hit/HitTypes'
import type { ModernWeaponCategory, ImpactSurface } from './vfx/effects/modern/ModernWeaponTypes'

// ───  ────────────────────────────────────────────────────────────────

const canvas  = document.getElementById('vfx2-canvas') as HTMLCanvasElement
const wrap    = document.getElementById('vfx2-viewport') as HTMLElement

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.4
renderer.shadowMap.enabled = true

const scene  = new THREE.Scene()
scene.background = new THREE.Color(0x0b0c0e)
scene.fog = new THREE.Fog(0x0b0c0e, 10, 35)

const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
camera.position.set(0, 1.6, 3.8)
camera.lookAt(0, 0.9, 0)

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
resize()
new ResizeObserver(resize).observe(wrap)

// ───  ──────────────────────────────────────────────────────────────────

// 
const groundGeo = new THREE.PlaneGeometry(20, 20)
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.9, metalness: 0.1 })
const ground    = new THREE.Mesh(groundGeo, groundMat)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

// 
const grid = new THREE.GridHelper(16, 24, 0x2a2c30, 0x1e2025)
grid.position.y = 0.001
scene.add(grid)

// ： ，  hitFX.trigger （ ）
const dummyGroup = new THREE.Group()
scene.add(dummyGroup)

// （ ）
const weaponTip  = new THREE.Vector3(0.45, 1.05, -0.3)
const weaponDir  = new THREE.Vector3(0, 0, -1).normalize()
const hitContact = new THREE.Vector3(0, 0.9, 0.25)
const hitDir     = new THREE.Vector3(0, 0, 1).normalize()  // 

// （ ， ）
const tipMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.03),
  new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.0 }),
)
tipMarker.position.copy(weaponTip)
scene.add(tipMarker)

// 
const ambient = new THREE.AmbientLight(0x334455, 1.2)
scene.add(ambient)
const keyLight = new THREE.DirectionalLight(0xffffff, 1.5)
keyLight.position.set(2, 6, 3)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(1024, 1024)
scene.add(keyLight)
const fillLight = new THREE.DirectionalLight(0x4466aa, 0.4)
fillLight.position.set(-3, 2, -2)
scene.add(fillLight)
const rimLight  = new THREE.DirectionalLight(0xaaccff, 0.6)
rimLight.position.set(0, 3, -5)
scene.add(rimLight)

// ─── VFX2  ────────────────────────────────────────────────────────────────

const hitFX  = new HitImpactEffect(scene)
const dmgNum = new DamageNumber(wrap)
let modernVFX: ModernWeaponVFX = createModernWeaponVFX(scene, ' ', 'modern-urban')

// ───  ──────────────────────────────────────────────────────────────────

let currentClass   = ' '
let currentWorld   = 'modern-urban'
let currentWeapon: ModernWeaponCategory = 'handgun'
let currentHitType: HitType   = 'heavy'
let currentElement: HitElement = 'fire'
let currentSurface: ImpactSurface = 'concrete'

// ─── UI  ───────────────────────────────────────────────────────────────────

function buildPanel() {
  const panel = document.getElementById('vfx2-panel')!

  // ── Section 3:  ─────────────────────────────────────────
  panel.innerHTML = `
  <div class="v2-section">
    <div class="v2-section-hd" data-sec="style">
      <span class="v2-dot" style="background:#c8a840"></span>
      Phase 3 — 
      <span class="v2-arrow">▾</span>
    </div>
    <div class="v2-section-body" id="sec-style">
      <div class="v2-field">
        <label> </label>
        <select id="v2-class">${CLASS_AFFINITY.map(c =>
          `<option value="${c.className}" ${c.className === currentClass ? 'selected' : ''}>${c.className} · ${c.classNameEn}</option>`
        ).join('')}</select>
      </div>
      <div class="v2-field">
        <label> </label>
        <select id="v2-world">${WORLD_STYLE_PALETTE.map(w =>
          `<option value="${w.id}" ${w.id === currentWorld ? 'selected' : ''}>${w.id === currentWorld ? '▶ ' : ''}${w.en}</option>`
        ).join('')}</select>
      </div>
      <div class="v2-colors" id="v2-color-row">
        <div class="v2-swatch-wrap"><div class="v2-swatch" id="sw-p" title=" "></div><span> </span></div>
        <div class="v2-swatch-wrap"><div class="v2-swatch" id="sw-s" title=" "></div><span> </span></div>
        <div class="v2-swatch-wrap"><div class="v2-swatch" id="sw-f" title=" "></div><span> </span></div>
      </div>
      <div id="v2-color-info" class="v2-info-row"></div>
      <div id="v2-ai-prompt" class="v2-prompt-box"></div>
    </div>
  </div>

  <div class="v2-section">
    <div class="v2-section-hd" data-sec="hit">
      <span class="v2-dot" style="background:#4a90e2"></span>
      Phase 2 — 
      <span class="v2-arrow">▾</span>
    </div>
    <div class="v2-section-body" id="sec-hit">
      <div class="v2-field">
        <label> </label>
        <div class="v2-chip-row" id="hit-type-chips">
          ${(['light','heavy','critical','elemental','blocked'] as HitType[]).map(t =>
            `<button class="v2-chip ${t === currentHitType ? 'active' : ''}" data-hittype="${t}">${hitTypeLabel(t)}</button>`
          ).join('')}
        </div>
      </div>
      <div class="v2-field" id="element-row" style="${currentHitType === 'elemental' ? '' : 'opacity:.4'}">
        <label> </label>
        <div class="v2-chip-row" id="element-chips">
          ${(['fire','ice','lightning','poison','dark'] as HitElement[]).map(e =>
            `<button class="v2-chip ${e === currentElement ? 'active' : ''}" data-elem="${e}">${elemLabel(e)}</button>`
          ).join('')}
        </div>
      </div>
      <div class="v2-btn-row">
        <button class="v2-btn v2-btn-hit" id="btn-hit-once">💥 </button>
        <button class="v2-btn v2-btn-hit" id="btn-hit-combo">⚡  ×3</button>
      </div>
      <div class="v2-field">
        <label> </label>
        <div class="v2-inline-row">
          <input type="number" id="dmg-val" value="1337" class="v2-input" style="width:90px" />
          <select id="dmg-type" class="v2-select-sm">
            <option value="normal"> </option>
            <option value="critical"> </option>
            <option value="skill"> </option>
            <option value="heal"> </option>
            <option value="block"> </option>
            <option value="miss">Miss</option>
          </select>
          <button class="v2-btn v2-btn-small" id="btn-dmg"> </button>
        </div>
      </div>
    </div>
  </div>

  <div class="v2-section">
    <div class="v2-section-hd" data-sec="modern">
      <span class="v2-dot" style="background:#ff8844"></span>
      Phase 4 — 
      <span class="v2-arrow">▾</span>
    </div>
    <div class="v2-section-body" id="sec-modern">
      <div class="v2-field">
        <label> </label>
        <select id="v2-weapon">${Object.entries(MODERN_WEAPON_CONFIGS).map(([k, c]) =>
          `<option value="${k}" ${k === currentWeapon ? 'selected' : ''}>${weaponLabel(k as ModernWeaponCategory)} · ${c.projectileType}</option>`
        ).join('')}</select>
      </div>
      <div class="v2-field">
        <label> </label>
        <div class="v2-chip-row">
          ${(['concrete','metal','flesh','explosive'] as ImpactSurface[]).map(s =>
            `<button class="v2-chip ${s === currentSurface ? 'active' : ''}" data-surface="${s}">${surfaceLabel(s)}</button>`
          ).join('')}
        </div>
      </div>
      <div id="v2-weapon-info" class="v2-info-row"></div>
      <div class="v2-btn-row">
        <button class="v2-btn v2-btn-fire" id="btn-fire">🔫 </button>
        <button class="v2-btn v2-btn-fire" id="btn-burst">🔥 Burst ×5</button>
      </div>
      <div class="v2-btn-row">
        <button class="v2-btn v2-btn-impact" id="btn-impact">💣 </button>
        <button class="v2-btn v2-btn-auto" id="btn-auto" data-on="0">🤖 </button>
      </div>
    </div>
  </div>
  `

  updateColorDisplay()
  updateWeaponInfo()
  bindEvents()
}

// ───  ─────────────────────────────────────────────────────

function hitTypeLabel(t: HitType) {
  const m: Record<HitType, string> = {
    light:' ', heavy:' ', critical:' ', elemental:' ', blocked:' ',
    heal:' '
  }
  return m[t] ?? t
}
function elemLabel(e: HitElement | string) {
  const m: Record<string, string> = { fire:'🔥 ', ice:'❄ ', lightning:'⚡ ', poison:'☠ ', dark:'🌑 ', light:'✨ ', physical:'⚔ ' }
  return m[e] ?? e
}
function surfaceLabel(s: ImpactSurface) {
  const m: Record<ImpactSurface, string> = { concrete:' ', metal:' ', flesh:' ', explosive:' ' }
  return m[s]
}
function weaponLabel(k: ModernWeaponCategory) {
  const m: Record<ModernWeaponCategory, string> = {
    handgun:'🔫 ', smg:'🔫 ', assault_rifle:'🔫 ', sniper:'🎯 ',
    shotgun:'💥 ', rpg:'🚀RPG', minigun:'🌀 ', flamethrower:'🔥 ',
    railgun:'⚡ ', grenade:'💣 '
  }
  return m[k] ?? k
}

// ───  ─────────────────────────────────────────────────────

function updateColorDisplay() {
  const pack = resolveVFXColors(currentWorld, currentClass)
  const hex  = colorPackToHex(pack)

  const swP = document.getElementById('sw-p')
  const swS = document.getElementById('sw-s')
  const swF = document.getElementById('sw-f')
  if (swP) swP.style.background = hex.primary
  if (swS) swS.style.background = hex.secondary
  if (swF) swF.style.background = hex.fade

  const infoEl = document.getElementById('v2-color-info')
  if (infoEl) infoEl.textContent = ` : ${hex.primary}  : ${hex.secondary}  Bloom: ${(pack.bloomIntensity * 100).toFixed(0)}%`

  const promptEl = document.getElementById('v2-ai-prompt')
  if (promptEl) {
    const hints = pack.aiPromptHints.slice(0, 5).join(', ')
    promptEl.textContent = `AI: ${pack._meta.primaryElement} · ${pack._meta.worldStyle} · ${hints}`
  }

}

// ───  ─────────────────────────────────────────────────────

function updateWeaponInfo() {
  const cfg = MODERN_WEAPON_CONFIGS[currentWeapon]
  const el  = document.getElementById('v2-weapon-info')
  if (el) {
    el.textContent = `  ${cfg.fireRate}/s ·  ${cfg.projectileType} ·  ${cfg.spreadAngle}° · AOE  ${cfg.blastRadius}`
  }
  modernVFX.dispose()
  modernVFX = new ModernWeaponVFX(scene)
  modernVFX.setWeapon(currentWeapon, currentWorld, currentClass)
}

// ───  ─────────────────────────────────────────────────────

function bindEvents() {
  // ── /  ────────────────────────────────────────────────
  document.getElementById('v2-class')?.addEventListener('change', e => {
    currentClass = (e.target as HTMLSelectElement).value
    updateColorDisplay()
    updateWeaponInfo()
  })
  document.getElementById('v2-world')?.addEventListener('change', e => {
    currentWorld = (e.target as HTMLSelectElement).value
    updateColorDisplay()
    updateWeaponInfo()
  })

  // ──  ───────────────────────────────────────────────────
  document.querySelectorAll('[data-hittype]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentHitType = btn.getAttribute('data-hittype') as HitType
      document.querySelectorAll('[data-hittype]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      const elemRow = document.getElementById('element-row')
      if (elemRow) elemRow.style.opacity = currentHitType === 'elemental' ? '1' : '0.4'
    })
  })

  // ──  ──────────────────────────────────────────────────────
  document.querySelectorAll('[data-elem]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentElement = btn.getAttribute('data-elem') as HitElement
      document.querySelectorAll('[data-elem]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
    })
  })

  // ──  ──────────────────────────────────────────────────
  document.getElementById('btn-hit-once')?.addEventListener('click', () => {
    triggerHit()
  })
  document.getElementById('btn-hit-combo')?.addEventListener('click', () => {
    triggerHit()
    setTimeout(() => { currentHitType = 'heavy'; triggerHit() }, 250)
    setTimeout(() => { currentHitType = 'critical'; triggerHit() }, 550)
  })

  // ──  ──────────────────────────────────────────────────────
  document.getElementById('btn-dmg')?.addEventListener('click', () => {
    const val  = (document.getElementById('dmg-val') as HTMLInputElement)?.value ?? '999'
    const type = (document.getElementById('dmg-type') as HTMLSelectElement)?.value as any ?? 'normal'
    const pack = resolveVFXColors(currentWorld, currentClass)
    const hex  = colorPackToHex(pack)
    // 
    const proj = hitContact.clone().project(camera)
    const x = (proj.x * 0.5 + 0.5) * wrap.clientWidth  + (Math.random() - 0.5) * 60
    const y = (-proj.y * 0.5 + 0.5) * wrap.clientHeight + (Math.random() - 0.5) * 30
    dmgNum.spawn({ value: val, type, screenX: x, screenY: y, elementHex: hex.primary })
  })

  // ──  ──────────────────────────────────────────────────
  document.getElementById('v2-weapon')?.addEventListener('change', e => {
    currentWeapon = (e.target as HTMLSelectElement).value as ModernWeaponCategory
    updateWeaponInfo()
  })

  // ──  ────────────────────────────────────────────────────
  document.querySelectorAll('[data-surface]').forEach(btn => {
    btn.addEventListener('click', () => {
      currentSurface = btn.getAttribute('data-surface') as ImpactSurface
      document.querySelectorAll('[data-surface]').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
    })
  })

  // ──  ──────────────────────────────────────────────────────
  document.getElementById('btn-fire')?.addEventListener('click', () => {
    modernVFX.fire(weaponTip, weaponDir)
  })
  document.getElementById('btn-burst')?.addEventListener('click', () => {
    const cfg = MODERN_WEAPON_CONFIGS[currentWeapon]
    const interval = Math.max(1000 / cfg.fireRate, 60)
    for (let i = 0; i < 5; i++) {
      setTimeout(() => modernVFX.fire(weaponTip, weaponDir), i * interval)
    }
  })

  // ──  ────────────────────────────────────────────────────
  document.getElementById('btn-impact')?.addEventListener('click', () => {
    const normal = new THREE.Vector3(0, 0, 1)
    modernVFX.onImpact(hitContact, normal, currentSurface, 1.0)
  })

  // ──  ──────────────────────────────────────────────
  document.getElementById('btn-auto')?.addEventListener('click', () => {
    currentWeapon = inferWeaponCategory(currentClass, currentWorld)
    const sel = document.getElementById('v2-weapon') as HTMLSelectElement
    if (sel) sel.value = currentWeapon
    updateWeaponInfo()
  })

  // ──  ──────────────────────────────────────────────────
  document.querySelectorAll('.v2-section-hd').forEach(hd => {
    hd.addEventListener('click', () => {
      const sec = hd.getAttribute('data-sec')!
      const body = document.getElementById(`sec-${sec}`)
      const arrow = hd.querySelector('.v2-arrow')
      if (body) {
        const isCollapsed = body.style.display === 'none'
        body.style.display = isCollapsed ? '' : 'none'
        if (arrow) arrow.textContent = isCollapsed ? '▾' : '▸'
      }
    })
  })
}

// ───  ─────────────────────────────────────────────────────

function triggerHit() {
  const elem = currentHitType === 'elemental' ? currentElement : undefined
  hitFX.trigger(
    { type: currentHitType, contactPoint: hitContact, hitDirection: hitDir, element: elem },
    dummyGroup,  // 
    1.0,
  )
}

// ─── Render Loop ──────────────────────────────────────────────────

let last = performance.now()
let angle = 0

function loop() {
  requestAnimationFrame(loop)
  const now = performance.now()
  const dt  = Math.min((now - last) / 1000, 0.05)
  last = now

  // 
  angle += dt * 0.08
  camera.position.x = Math.sin(angle) * 3.8
  camera.position.z = Math.cos(angle) * 3.8
  camera.lookAt(0, 0.9, 0)

  hitFX.update(dt)
  dmgNum.cleanup()
  modernVFX.update(dt, camera)

  renderer.render(scene, camera)
}

// ───  ─────────────────────────────────────────────────────────

buildPanel()
loop()

//  DevTools 
;(window as any).__vfx2 = { hitFX, modernVFX, resolveVFXColors, scene, camera }

