// @source wb-character/src/vfx2-bootstrap.ts
/**
 * VFX2 Bootstrap —  VFX 
 *
 *  engine ready ，  .vp 
 *  Phase 2/3/4 。
 *
 * ： ，  DOM 。
 */

import * as THREE from 'three'
// TrailMaster
import { TrailMasterEffect } from './vfx/trailmaster/TrailMasterEffect'
import { TRAIL_PRESETS, TRAIL_PRESET_LABELS } from './vfx/trailmaster/TrailMasterPresets'
import { HitImpactEffect }   from './vfx/effects/hit/HitImpactEffect'
import { DamageNumber }      from './vfx/effects/hit/DamageNumber'
import { ModernWeaponVFX }   from './vfx/effects/modern/ModernWeaponVFX'
import { resolveVFXColors, colorPackToHex } from './vfx/style/VFXColorResolver'
import { WORLD_STYLE_PALETTE } from './vfx/style/WorldStylePalette'
import { CLASS_AFFINITY }    from './vfx/style/ClassElementAffinity'
import { MODERN_WEAPON_CONFIGS, inferWeaponCategory } from './vfx/effects/modern/ModernWeaponTypes'
import { characterState }    from './CharacterState'
//  3： 
import { TargetAcquisitionSystem, createDemoTargets } from './vfx/targeting/TargetAcquisitionSystem'
import type { AcquisitionParams } from './vfx/targeting/TargetTypes'
//  4： 
import { getStatPack, CLASS_LIST, getClassNote } from './vfx/combat/CombatPresets'
import { calcSkillDamage, calcGunDamage, damageToVFXScale } from './vfx/combat/CombatFormula'
//  5： （  adapter）
import { MountPointId, MOUNT_META } from './vfx/mount/MountPointTypes'
import { MountPointResolver, dimsFromDummy } from './vfx/mount/MountPointResolver'
import { MountPointVisualizer } from './vfx/mount/MountPointVisualizer'
import { MountAdapter } from './vfx/mount/MountAdapter'
import { confidenceColor, confidenceLabel } from './vfx/mount/CharacterAutoDetector'
import type { CharacterDimensions } from './vfx/mount/MountPointTypes'
import type { HitType, HitElement } from './vfx/effects/hit/HitTypes'
import type { ModernWeaponCategory, ImpactSurface } from './vfx/effects/modern/ModernWeaponTypes'
import type { IEngine } from './EngineTypes'

// （  -Z ）
const FIRE_DIR = new THREE.Vector3(0, 0, -1).normalize()

// ──  ───────────────────────────────────────────────────────────────
let hitFX:     HitImpactEffect | null = null
let modernVFX: ModernWeaponVFX | null = null
let dmgNum:    DamageNumber    | null = null
let vfxCanvas: HTMLCanvasElement | null = null
//  3
let targetSys: TargetAcquisitionSystem | null = null
let demoTargetMeshes: THREE.Mesh[] = []
//  4
let combatLevel = 1
let combatClass = ' '

//  5： （MountAdapter ）
let mountAdapter: MountAdapter | null = null
let mountViz:     MountPointVisualizer | null = null

// TrailMaster
let activeTrails: TrailMasterEffect[] = []
let currentTrailKey = 'fire'

let currentHitType: HitType       = 'heavy'
let currentElement: HitElement    = 'fire'
let currentWeapon:  ModernWeaponCategory = 'handgun'
let currentSurface: ImpactSurface = 'concrete'

const INJECT_ID = 'vfx2-inject-root'
let observer: MutationObserver | null = null
let injectedOnce = false

// ── ：  engine ready ──────────────────────────────────────────────
window.addEventListener('__ce:ready', (e: Event) => {
  const { engine } = (e as CustomEvent).detail as { engine: IEngine }
  boot(engine)
})

//  import（HMR ）
if ((window as any).__ceEngine) {
  boot((window as any).__ceEngine as IEngine)
}

function boot(engine: IEngine): void {
  if ((window as any).__vfx2BootInit) return
  ;(window as any).__vfx2BootInit = true

  const scene  = engine.scene
  const camera = engine.camera

  // ，  scene
  hitFX     = new HitImpactEffect(scene)
  modernVFX = new ModernWeaponVFX(scene)

  //  3： 
  targetSys = new TargetAcquisitionSystem(scene)
  const demoResult = createDemoTargets(scene, 3)
  demoTargetMeshes = demoResult.meshes
  demoResult.infos.forEach(t => targetSys!.addTarget(t))

  //  5：  —  adapter 
  mountAdapter = new MountAdapter(scene)
  window.__mountAdapter = mountAdapter
  mountViz = new MountPointVisualizer(scene)

  // adapter 
  mountAdapter.onChanged(dims => {
    mountViz?.updateDimensions(dims)
    refreshMountStatusUI()
  })

  // （adapter.tick() ， ）
  engine.onUpdate((dt: number) => {
    hitFX?.update(dt)
    modernVFX?.update(dt, camera)
    const attackerPos = mountAdapter?.waist ?? new THREE.Vector3(0, 0.67, 0)
    targetSys?.update(dt, camera, attackerPos)
    mountAdapter?.tick()
    // TrailMaster update
    for (let i = activeTrails.length - 1; i >= 0; i--) {
      activeTrails[i].update(dt)
      if (!activeTrails[i].isAlive()) {
        activeTrails[i].dispose()
        activeTrails.splice(i, 1)
      }
    }
  })

  //  DamageNumber （game-hud ，  canvas ）
  const hudEl = document.getElementById('game-hud') ?? document.getElementById('app')
  if (hudEl) dmgNum = new DamageNumber(hudEl)

  //  characterState / 
  syncProfile()
  characterState.subscribe(() => syncProfile())

  // 
  startObserver()
}

function syncProfile(): void {
  const { charClass, worldSetting } = characterState.profile
  if (modernVFX && (charClass || worldSetting)) {
    currentWeapon = inferWeaponCategory(charClass, worldSetting)
    modernVFX.setFromProfile(charClass, worldSetting)
  }
}

// ── MutationObserver：  .vp  ────────────────────────────────

function startObserver(): void {
  const leftPanel = document.querySelector('.editor-left') as HTMLElement | null
  if (!leftPanel) {
    // editor ，50ms 
    setTimeout(startObserver, 50)
    return
  }

  if (observer) observer.disconnect()
  observer = new MutationObserver(() => {
    // render() （ ） ，  innerHTML 
    queueMicrotask(tryInject)
  })
  observer.observe(leftPanel, { childList: true, subtree: true })

  // （  VFX tab ）
  tryInject()
}

function tryInject(): void {
  const vp = document.querySelector('.vp') as HTMLElement | null
  if (!vp) return  //  VFX 

  // （render() ）
  if (document.getElementById(INJECT_ID)) return

  injectPanel(vp)
}

// ──  VFX2  ──────────────────────────────────────────────────────────

function injectPanel(vp: HTMLElement): void {
  injectStyles()

  const root = document.createElement('div')
  root.id = INJECT_ID

  const profile = characterState.profile
  const pack    = resolveVFXColors(profile.worldSetting, profile.charClass)
  const hex     = colorPackToHex(pack)

  root.innerHTML = `
<!-- ── ：  +  ── -->
<div id="v2b-style-strip">
  <span class="v2b-ss-char">${profile.charClass || '—'}</span>
  <span class="v2b-ss-world">${profile.worldSetting || '—'}</span>
  <span class="v2b-ss-dots">
    <span id="v2b-sw-p"  class="v2b-ss-dot" style="background:${hex.primary}"   title="  ${hex.primary}"></span>
    <span id="v2b-sw-s"  class="v2b-ss-dot" style="background:${hex.secondary}" title="  ${hex.secondary}"></span>
    <span id="v2b-sw-f"  class="v2b-ss-dot" style="background:${hex.fade}"      title="  ${hex.fade}"></span>
  </span>
  <span class="v2b-ss-bloom-wrap">
    <span class="v2b-ss-bloom-bg"><span id="v2b-bloom-fill" style="width:${(pack.bloomIntensity / 1.8 * 100).toFixed(0)}%"></span></span>
  </span>
  <span class="v2b-ss-elem">主元素: ${pack._meta.primaryElement}</span>
</div>

<div class="v2b-cat">命中反馈</div>

<!-- ──  ── -->
<div class="v2b-group">
  <div class="v2b-gh" data-v2sec="hit">
    <span class="v2b-dot" style="background:#4a90e2"></span>
    <span class="v2b-gh-label">命中类型 / 伤害数字</span>
    <span class="v2b-arrow">▾</span>
  </div>
  <div class="v2b-body" id="v2b-body-hit">
    <div class="v2b-row">
      <span class="v2b-lbl">类型</span>
      <div class="v2b-chips" id="v2b-hit-chips">
        ${(['light','heavy','critical','elemental','blocked'] as HitType[]).map(t =>
          `<button class="v2b-chip ${t===currentHitType?'act':''}" data-hit="${t}">${hitLabel(t)}</button>`
        ).join('')}
      </div>
    </div>
    <div class="v2b-row" id="v2b-elem-row" style="opacity:${currentHitType==='elemental'?1:.35}">
      <span class="v2b-lbl">元素</span>
      <div class="v2b-chips" id="v2b-elem-chips">
        ${(['fire','ice','lightning','poison','dark'] as HitElement[]).map(e =>
          `<button class="v2b-chip ${e===currentElement?'act':''}" data-elem="${e}">${elemLabel(e)}</button>`
        ).join('')}
      </div>
    </div>
    <div class="v2b-btn-row">
      <button class="v2b-btn v2b-btn-hit" id="v2b-hit-once">单次命中</button>
      <button class="v2b-btn v2b-btn-hit" id="v2b-hit-combo">连击 ×3</button>
    </div>
    <div class="v2b-row">
      <span class="v2b-lbl">数值</span>
      <input type="number" id="v2b-dmg-val" value="999" class="v2b-num" />
      <select id="v2b-dmg-type" class="v2b-sel">
        <option value="normal">普通</option>
        <option value="critical">暴击</option>
        <option value="skill">技能</option>
        <option value="heal">治疗</option>
        <option value="block">格挡</option>
        <option value="miss">未命中</option>
      </select>
      <button class="v2b-btn v2b-btn-small" id="v2b-dmg-btn">显示</button>
    </div>
  </div>
</div>

<div class="v2b-cat">轨迹与弹道</div>

<!-- ── TrailMaster  ── -->
<div class="v2b-group">
  <div class="v2b-gh" data-v2sec="trail">
    <span class="v2b-dot" style="background:#e8a020"></span>
    <span class="v2b-gh-label">刀光轨迹</span>
    <span class="v2b-gh-hint">轨迹系统</span>
    <span class="v2b-arrow">▾</span>
  </div>
  <div class="v2b-body" id="v2b-body-trail">
    <div class="v2b-row">
      <span class="v2b-lbl">预设</span>
      <select id="v2b-trail-preset" class="v2b-sel v2b-sel-full">
        ${Object.entries(TRAIL_PRESET_LABELS).map(([k, label]) =>
          `<option value="${k}">${label}</option>`
        ).join('')}
      </select>
    </div>
    <div class="v2b-btn-row">
      <button class="v2b-btn" id="v2b-trail-fire"
        style="background:rgba(232,160,32,.12);border-color:rgba(232,160,32,.4);color:#e8a020;flex:2">
        触发轨迹
      </button>
      <button class="v2b-btn" id="v2b-trail-clear"
        style="background:rgba(255,255,255,.04);color:#555;flex:1">
        清理
      </button>
    </div>
    <div id="v2b-trail-info" class="v2b-ai-hint" style="min-height:18px"></div>
  </div>
</div>

<div class="v2b-group">
  <div class="v2b-gh" data-v2sec="modern">
    <span class="v2b-dot" style="background:#ff8844"></span>
    <span class="v2b-gh-label">现代武器 / 弹道</span>
    <span class="v2b-arrow">▾</span>
  </div>
  <div class="v2b-body" id="v2b-body-modern">
    <div class="v2b-row">
      <span class="v2b-lbl">武器</span>
      <select id="v2b-weapon" class="v2b-sel v2b-sel-full">
        ${Object.entries(MODERN_WEAPON_CONFIGS).map(([k, c]) =>
          `<option value="${k}" ${k===currentWeapon?'selected':''}>${weaponLabel(k as ModernWeaponCategory)} · ${c.projectileType}</option>`
        ).join('')}
      </select>
    </div>
    <div id="v2b-weapon-info" class="v2b-ai-hint"></div>
    <div class="v2b-row">
      <span class="v2b-lbl">材质</span>
      <div class="v2b-chips">
        ${(['concrete','metal','flesh','explosive'] as ImpactSurface[]).map(s =>
          `<button class="v2b-chip ${s===currentSurface?'act':''}" data-surface="${s}">${surfaceLabel(s)}</button>`
        ).join('')}
      </div>
    </div>
    <div class="v2b-btn-row">
      <button class="v2b-btn v2b-btn-fire" id="v2b-fire">单发</button>
      <button class="v2b-btn v2b-btn-fire" id="v2b-burst">连射 ×5</button>
    </div>
    <div class="v2b-btn-row">
      <button class="v2b-btn v2b-btn-impact" id="v2b-impact">冲击</button>
      <button class="v2b-btn v2b-btn-auto" id="v2b-auto">自动</button>
    </div>
  </div>
</div>
`

  // ──  3：  ─────────────────────────────────────────────
  const locked    = targetSys?.lockedTarget
  const allTgts   = targetSys?.allTargets ?? []
  root.innerHTML += `
<div class="v2b-cat">目标与数值</div>

<!-- ──  ── -->
<div class="v2b-group">
  <div class="v2b-gh" data-v2sec="targeting">
    <span class="v2b-dot" style="background:#ff4466"></span>
    <span class="v2b-gh-label">目标锁定</span>
    <span class="v2b-gh-hint">${allTgts.length} 个目标</span>
    <span class="v2b-arrow">▾</span>
  </div>
  <div class="v2b-body" id="v2b-body-targeting">
    <div class="v2b-row">
      <span class="v2b-lbl">目标</span>
      <div class="v2b-chips" id="v2b-tgt-chips">
        ${allTgts.map(t => {
          const isLocked = t.id === locked?.id
          const relColor: Record<string, string> = { enemy:'#ff4444', neutral:'#aaa', friendly:'#44ff88', interactive:'#ffcc00' }
          return `<button class="v2b-chip ${isLocked ? 'act' : ''}" data-tgtid="${t.id}"
            style="${isLocked ? `border-color:${relColor[t.relation]}44;color:${relColor[t.relation]}` : ''}"
          >目标 ${t.id.replace('demo-enemy-','')} 生命:${Math.round(t.hpRatio*100)}%</button>`
        }).join('')}
      </div>
    </div>
    <div id="v2b-lock-info" class="v2b-ai-hint">${locked ? `当前锁定: ${locked.id} · ${targetSys?.state}` : '未锁定目标'}</div>
    <div class="v2b-btn-row">
      <button class="v2b-btn" style="background:rgba(255,68,102,.1);border-color:rgba(255,68,102,.3);color:#ff6688" id="v2b-acquire">自动获取</button>
      <button class="v2b-btn" style="background:rgba(255,68,102,.15);border-color:rgba(255,68,102,.4);color:#ff4466" id="v2b-hard-lock">硬锁定</button>
    </div>
    <div class="v2b-btn-row">
      <button class="v2b-btn v2b-btn-auto" id="v2b-cycle-tgt">切换目标</button>
      <button class="v2b-btn v2b-btn-auto" id="v2b-unlock">解除锁定</button>
    </div>
    <div class="v2b-row">
      <span class="v2b-lbl" style="min-width:42px">距离</span>
      <input type="range" id="v2b-range-slider" min="1" max="10" value="5" step="0.5" style="flex:1;accent-color:#ff4466" />
      <span id="v2b-range-val" style="font-size:10px;color:#888;min-width:24px">5</span>
    </div>
    <div class="v2b-row">
      <span class="v2b-lbl" style="min-width:42px">视野</span>
      <input type="range" id="v2b-fov-slider" min="30" max="360" value="120" step="10" style="flex:1;accent-color:#ff4466" />
      <span id="v2b-fov-val" style="font-size:10px;color:#888;min-width:32px">120°</span>
    </div>
  </div>
</div>
`

  // ──  4：  ──────────────────────────────────────────
  combatClass = profile.charClass || ' '
  combatLevel = 1
  const pack0 = getStatPack(combatClass, combatLevel)

  root.innerHTML += `
<div class="v2b-group">
  <div class="v2b-gh" data-v2sec="stats">
    <span class="v2b-dot" style="background:#aa88ff"></span>
    <span class="v2b-gh-label">职业数值 / 伤害计算</span>
    <span class="v2b-gh-hint">${combatClass} 等级 ${combatLevel}</span>
    <span class="v2b-arrow">▾</span>
  </div>
  <div class="v2b-body" id="v2b-body-stats">
    <div class="v2b-row">
      <span class="v2b-lbl">职业</span>
      <select id="v2b-stat-class" class="v2b-sel v2b-sel-full">
        ${CLASS_LIST.map(c => `<option value="${c}" ${c === combatClass ? 'selected':''}>${c}（${getClassNote(c)}）</option>`).join('')}
      </select>
    </div>
    <div class="v2b-row">
      <span class="v2b-lbl">等级</span>
      <input type="range" id="v2b-level-slider" min="1" max="50" value="1" step="1" style="flex:1;accent-color:#aa88ff" />
      <span id="v2b-level-val" style="font-size:10px;color:#888;min-width:36px">等级 1</span>
    </div>
    <div id="v2b-stat-table" class="v2b-stat-tbl">
      ${renderStatTable(pack0)}
    </div>
    <div class="v2b-row">
      <span class="v2b-lbl">技能</span>
      <select id="v2b-skill-sel" class="v2b-sel v2b-sel-full">
        ${pack0.skills.map(s => `<option value="${s.slotIndex}">[${s.slotIndex}] ${s.name} ×${s.multiplier}  ${s.hitCount} </option>`).join('')}
      </select>
    </div>
    <div id="v2b-dmg-result" class="v2b-dmg-result">选择技能后计算伤害</div>
    <div class="v2b-btn-row">
      <button class="v2b-btn" style="background:rgba(170,136,255,.1);border-color:rgba(170,136,255,.3);color:#cc99ff" id="v2b-calc-dmg">计算伤害</button>
      <button class="v2b-btn" style="background:rgba(170,136,255,.08);border-color:rgba(170,136,255,.2);color:#9977dd" id="v2b-calc-crit">暴击预估</button>
    </div>
    ${pack0.gun ? `
    <div class="v2b-ai-hint" id="v2b-gun-info">
      枪械参数: 射速 ${pack0.gun.firerate}/s · 弹速 ${pack0.gun.bulletSpeed} · 弹匣 ${pack0.gun.magSize}
    </div>
    <div class="v2b-btn-row">
      <button class="v2b-btn v2b-btn-auto" id="v2b-calc-gun">计算每秒伤害</button>
    </div>` : ''}
  </div>
</div>
`

  // ──  5：  ──────────────────────────────────────────────────
  const initDims = mountAdapter?.getDims() ?? dimsFromDummy()
  const mountRows = MOUNT_META.map(m => {
    const colorHex = '#' + m.color.toString(16).padStart(6, '0')
    return `<div class="v2b-mp-chip" data-mpid="${m.id}" style="border-color:${colorHex}55;color:${colorHex}">
      <span class="v2b-mp-dot" style="background:${colorHex}"></span>${m.label}
    </div>`
  }).join('')

  root.innerHTML += `
<div class="v2b-cat">挂点检测</div>

<div class="v2b-group" id="v2b-mount-group">
  <div class="v2b-gh" data-v2sec="mount">
    <span class="v2b-dot" style="background:#00e5cc"></span>
    <span class="v2b-gh-label">角色挂点 / 尺寸</span>
    <span class="v2b-gh-hint" id="v2b-mp-hint">检测中...</span>
    <span class="v2b-arrow">▾</span>
  </div>
  <div class="v2b-body" id="v2b-body-mount">

    <!--  -->
    <div id="v2b-mp-status" class="v2b-mp-status">
      <div class="v2b-mp-status-row">
        <span class="v2b-lbl">状态</span>
        <span id="v2b-mp-status-text" style="color:#00e5cc">检测中...</span>
      </div>
      <div class="v2b-mp-status-row">
        <span class="v2b-lbl">高度</span>
        <span id="v2b-mp-s-height">${initDims.height.toFixed(2)}u</span>
        <span class="v2b-lbl" style="margin-left:8px">比例</span>
        <span id="v2b-mp-s-ratio" style="color:#00e5cc;font-weight:bold">${initDims.bodyRatio.toFixed(1)}</span>
      </div>
    </div>

    <!-- （ ） -->
    <div class="v2b-row" style="margin-top:6px">
      <span class="v2b-lbl">武器</span>
      <input id="v2b-mp-weapon" type="range" min="0" max="1.2" step="0.05" value="${initDims.weaponLength ?? 0}"
             style="flex:1;accent-color:#00e5cc" />
      <span id="v2b-mp-weapon-val" class="v2b-val" style="width:2.5em;text-align:right">${(initDims.weaponLength ?? 0).toFixed(2)}</span>
    </div>

    <!-- （ ） -->
    <div class="v2b-row">
      <span class="v2b-lbl">体型</span>
      <input id="v2b-mp-ratio" type="range" min="1" max="10" step="0.5" value="${initDims.bodyRatio}"
             style="flex:1;accent-color:#6677ff" />
      <span id="v2b-mp-ratio-val" class="v2b-val" style="width:2.5em;text-align:right;color:#6677ff">${initDims.bodyRatio.toFixed(1)}</span>
    </div>

    <div class="v2b-btn-row">
      <button class="v2b-btn" id="v2b-mp-toggle"
              style="background:rgba(0,229,204,.08);border-color:rgba(0,229,204,.2);color:#00c4ae">
        显示挂点
      </button>
      <button class="v2b-btn" id="v2b-mp-force"
              style="background:rgba(0,229,204,.06);border-color:rgba(0,229,204,.15);color:#009988;font-size:10px">
        重新检测
      </button>
    </div>

    <div id="v2b-mp-chips" class="v2b-mp-chips">${mountRows}</div>
    <div id="v2b-mp-coord" class="v2b-ai-hint" style="font-size:10px;line-height:1.6;margin-top:4px">
      挂点坐标将在检测后显示
    </div>
  </div>
</div>
`

  // 挂到第 3 步「参数调试」里；旧容器不存在时回退到 .vp。
  const debugBody = vp.querySelector('.vp-debug-body') as HTMLElement | null
  ;(debugBody ?? vp).appendChild(root)

  updateWeaponInfo()
  bindPanelEvents(root)
  injectedOnce = true

  // ：  adapter  dims  UI
  requestAnimationFrame(() => {
    if (mountAdapter) {
      mountViz?.updateDimensions(mountAdapter.getDims())
      refreshMountStatusUI()
    }
  })
}

// ──  ─────────────────────────────────────────────────────────────────

function bindPanelEvents(root: HTMLElement): void {

  // 
  root.querySelectorAll('[data-v2sec]').forEach(hd => {
    hd.addEventListener('click', () => {
      const sec  = hd.getAttribute('data-v2sec')!
      const body = document.getElementById(`v2b-body-${sec}`)
      const arr  = hd.querySelector('.v2b-arrow')
      if (body) {
        const hide = body.style.display !== 'none'
        body.style.display = hide ? 'none' : ''
        if (arr) arr.textContent = hide ? '▸' : '▾'
      }
    })
  })

  // ── TrailMaster ────────────────────────────────────────────────────
  const trailPresetSel = document.getElementById('v2b-trail-preset') as HTMLSelectElement | null
  if (trailPresetSel) {
    trailPresetSel.addEventListener('change', () => {
      currentTrailKey = trailPresetSel.value
    })
  }
  document.getElementById('v2b-trail-fire')?.addEventListener('click', () => {
    const scene = (window as any).__ceEngine?.scene as THREE.Scene | undefined
    if (!scene) return
    const preset = TRAIL_PRESETS[currentTrailKey]
    if (!preset) return
    //  origin
    const waist = mountAdapter?.waist ?? new THREE.Vector3(0, 0, 0)
    const fx = new TrailMasterEffect(scene, preset, waist.clone())
    activeTrails.push(fx)
    const info = document.getElementById('v2b-trail-info')
    if (info) info.textContent = `▶ ${preset.name} ·  ${preset.particleCount}`
  })
  document.getElementById('v2b-trail-clear')?.addEventListener('click', () => {
    activeTrails.forEach(t => t.dispose())
    activeTrails = []
    const info = document.getElementById('v2b-trail-info')
    if (info) info.textContent = ' '
  })

  // 
  root.querySelectorAll('[data-hit]').forEach(b => {
    b.addEventListener('click', () => {
      currentHitType = b.getAttribute('data-hit') as HitType
      root.querySelectorAll('[data-hit]').forEach(x => x.classList.remove('act'))
      b.classList.add('act')
      const row = document.getElementById('v2b-elem-row')
      if (row) row.style.opacity = currentHitType === 'elemental' ? '1' : '0.35'
    })
  })

  // 
  root.querySelectorAll('[data-elem]').forEach(b => {
    b.addEventListener('click', () => {
      currentElement = b.getAttribute('data-elem') as HitElement
      root.querySelectorAll('[data-elem]').forEach(x => x.classList.remove('act'))
      b.classList.add('act')
    })
  })

  // 
  document.getElementById('v2b-hit-once')?.addEventListener('click', () => doHit())
  document.getElementById('v2b-hit-combo')?.addEventListener('click', () => {
    const types: HitType[] = ['light', 'heavy', 'critical']
    types.forEach((t, i) => setTimeout(() => { currentHitType = t; doHit() }, i * 260))
    setTimeout(() => {
      currentHitType = 'heavy'
      root.querySelectorAll('[data-hit]').forEach(b => {
        b.classList.toggle('act', b.getAttribute('data-hit') === 'heavy')
      })
    }, 800)
  })

  // 
  document.getElementById('v2b-dmg-btn')?.addEventListener('click', () => {
    if (!dmgNum) return
    const val  = (document.getElementById('v2b-dmg-val') as HTMLInputElement)?.value ?? '999'
    const type = (document.getElementById('v2b-dmg-type') as HTMLSelectElement)?.value as any ?? 'normal'
    const pack = resolveVFXColors(characterState.profile.worldSetting, characterState.profile.charClass)
    const h    = colorPackToHex(pack)
    const canvas = document.getElementById('viewport') as HTMLCanvasElement
    const rect   = canvas?.getBoundingClientRect()
    const cx     = rect ? rect.left + rect.width  * (0.45 + (Math.random() - .5) * .15) : window.innerWidth  * .5
    const cy     = rect ? rect.top  + rect.height * (0.30 + (Math.random() - .5) * .10) : window.innerHeight * .4
    dmgNum.spawn({ value: val, type, screenX: cx, screenY: cy, elementHex: h.primary })
  })

  // 
  document.getElementById('v2b-weapon')?.addEventListener('change', e => {
    currentWeapon = (e.target as HTMLSelectElement).value as ModernWeaponCategory
    modernVFX?.setWeapon(currentWeapon, characterState.profile.worldSetting, characterState.profile.charClass)
    updateWeaponInfo()
  })

  // 
  root.querySelectorAll('[data-surface]').forEach(b => {
    b.addEventListener('click', () => {
      currentSurface = b.getAttribute('data-surface') as ImpactSurface
      root.querySelectorAll('[data-surface]').forEach(x => x.classList.remove('act'))
      b.classList.add('act')
    })
  })

  // （  + ）
  document.getElementById('v2b-fire')?.addEventListener('click', () => {
    const origin = mountAdapter?.getMountForEffect('muzzle_flash') ?? new THREE.Vector3(0.45, 1.0, -0.3)
    const dir    = mountAdapter?.weaponDirection ?? FIRE_DIR
    modernVFX?.fire(origin, dir)
  })
  document.getElementById('v2b-burst')?.addEventListener('click', () => {
    const cfg = MODERN_WEAPON_CONFIGS[currentWeapon]
    const interval = Math.max(1000 / Math.max(cfg.fireRate, 1), 55)
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        const origin = mountAdapter?.getMountForEffect('muzzle_flash') ?? new THREE.Vector3(0.45, 1.0, -0.3)
        const dir    = mountAdapter?.weaponDirection ?? FIRE_DIR
        modernVFX?.fire(origin, dir)
      }, i * interval)
    }
  })

  // （ ）
  document.getElementById('v2b-impact')?.addEventListener('click', () => {
    const normal = new THREE.Vector3(0, 0, 1)
    const pos = mountAdapter?.getMountForEffect('hit_body') ?? new THREE.Vector3(0, 1.05, 0.15)
    modernVFX?.onImpact(pos, normal, currentSurface, 1.0)
  })

  // 
  document.getElementById('v2b-auto')?.addEventListener('click', () => {
    currentWeapon = inferWeaponCategory(characterState.profile.charClass, characterState.profile.worldSetting)
    const sel = document.getElementById('v2b-weapon') as HTMLSelectElement
    if (sel) sel.value = currentWeapon
    modernVFX?.setWeapon(currentWeapon, characterState.profile.worldSetting, characterState.profile.charClass)
    updateWeaponInfo()
  })

  // ──  3：  ─────────────────────────────────────────────

  root.querySelectorAll('[data-tgtid]').forEach(b => {
    b.addEventListener('click', () => {
      targetSys?.softLock(b.getAttribute('data-tgtid')!)
      refreshLockInfo()
    })
  })

  document.getElementById('v2b-acquire')?.addEventListener('click', () => {
    if (!targetSys) return
    const rangeVal = parseFloat((document.getElementById('v2b-range-slider') as HTMLInputElement)?.value ?? '5')
    const fovVal   = parseFloat((document.getElementById('v2b-fov-slider')   as HTMLInputElement)?.value ?? '120')
    const params: AcquisitionParams = {
      attackerPos: new THREE.Vector3(0, 0.67, 0),
      attackerForward: new THREE.Vector3(0, 0, -1),
      maxRange: rangeVal, fovDeg: fovVal, enemyOnly: true,
    }
    targetSys.acquire(params)
    refreshLockInfo()
  })

  document.getElementById('v2b-hard-lock')?.addEventListener('click', () => {
    targetSys?.confirmHardLock(); refreshLockInfo()
  })

  document.getElementById('v2b-cycle-tgt')?.addEventListener('click', () => {
    if (!targetSys) return
    const r = parseFloat((document.getElementById('v2b-range-slider') as HTMLInputElement)?.value ?? '5')
    const f = parseFloat((document.getElementById('v2b-fov-slider') as HTMLInputElement)?.value ?? '120')
    targetSys.cycleTarget({ attackerPos: new THREE.Vector3(0, 0.67, 0), attackerForward: new THREE.Vector3(0, 0, -1), maxRange: r, fovDeg: f, enemyOnly: false })
    refreshLockInfo()
  })

  document.getElementById('v2b-unlock')?.addEventListener('click', () => {
    targetSys?.clearLock(); refreshLockInfo()
  })

  document.getElementById('v2b-range-slider')?.addEventListener('input', e => {
    const v = (e.target as HTMLInputElement).value
    const el = document.getElementById('v2b-range-val'); if (el) el.textContent = v
  })
  document.getElementById('v2b-fov-slider')?.addEventListener('input', e => {
    const v = (e.target as HTMLInputElement).value
    const el = document.getElementById('v2b-fov-val'); if (el) el.textContent = v + '°'
  })

  // ──  4：  ─────────────────────────────────────────────

  document.getElementById('v2b-stat-class')?.addEventListener('change', e => {
    combatClass = (e.target as HTMLSelectElement).value; refreshStatTable()
  })

  document.getElementById('v2b-level-slider')?.addEventListener('input', e => {
    combatLevel = parseInt((e.target as HTMLInputElement).value)
    const lv = document.getElementById('v2b-level-val'); if (lv) lv.textContent = `等级 ${combatLevel}`
    refreshStatTable()
  })

  document.getElementById('v2b-calc-dmg')?.addEventListener('click',  () => calcAndShowDamage(false))
  document.getElementById('v2b-calc-crit')?.addEventListener('click', () => calcAndShowDamage(true))
  document.getElementById('v2b-calc-gun')?.addEventListener('click', () => {
    const pack = getStatPack(combatClass, combatLevel)
    if (!pack.gun) return
    const r = calcGunDamage(pack.base, pack.gun, undefined, false)
    const el = document.getElementById('v2b-dmg-result')
    if (el) el.innerHTML = `
      <div class="v2b-dmg-row"><span>单发伤害</span><span style="color:#ffaa44">${r.single}</span></div>
      <div class="v2b-dmg-row"><span>理论每秒伤害</span><span style="color:#ff8844">${r.dps}/s</span></div>
      <div class="v2b-dmg-row"><span>换弹后每秒伤害</span><span style="color:#ffcc44">${r.reloadDps}/s</span></div>
      <div class="v2b-dmg-row"><span>暴击</span><span style="color:#${r.isCritical?'ff6600':'666'}">${r.isCritical?'是':'—'}</span></div>
    `
  })

  // ──  5：  ──────────────────────────────────────────────

  // （  adapter ）
  document.getElementById('v2b-mp-ratio')?.addEventListener('input', e => {
    const v = parseFloat((e.target as HTMLInputElement).value)
    const label = document.getElementById('v2b-mp-ratio-val')
    if (label) label.textContent = v.toFixed(1)
    if (!mountAdapter) return
    const dims = { ...mountAdapter.getDims(), bodyRatio: v }
    mountAdapter.setDims(dims)
    mountViz?.updateDimensions(dims)
  })

  // 
  document.getElementById('v2b-mp-weapon')?.addEventListener('input', e => {
    const v = parseFloat((e.target as HTMLInputElement).value)
    const label = document.getElementById('v2b-mp-weapon-val')
    if (label) label.textContent = v.toFixed(2)
    if (!mountAdapter) return
    const dims = { ...mountAdapter.getDims(), weaponLength: v }
    mountAdapter.setDims(dims)
    mountViz?.updateDimensions(dims)
  })

  // / 
  document.getElementById('v2b-mp-toggle')?.addEventListener('click', () => {
    if (!mountViz) return
    mountViz.toggle()
    const btn = document.getElementById('v2b-mp-toggle')
    if (btn) {
      btn.textContent = mountViz.isVisible() ? '隐藏挂点' : '显示挂点'
      btn.style.background = mountViz.isVisible()
        ? 'rgba(0,229,204,.28)' : 'rgba(0,229,204,.08)'
    }
    // 
    if (mountViz.isVisible() && mountAdapter) {
      mountViz.updateDimensions(mountAdapter.getDims())
    }
  })

  // 
  document.getElementById('v2b-mp-force')?.addEventListener('click', () => {
    const btn = document.getElementById('v2b-mp-force') as HTMLButtonElement | null
    if (btn) { btn.textContent = '检测中...'; btn.disabled = true }
    requestAnimationFrame(() => {
      mountAdapter?.forceDetect()
      if (btn) { btn.textContent = '重新检测'; btn.disabled = false }
    })
  })

  // ：  + 
  root.querySelectorAll('[data-mpid]').forEach(chip => {
    const id = chip.getAttribute('data-mpid') as MountPointId
    chip.addEventListener('mouseenter', () => {
      const pos = mountAdapter?.getMount(id) ?? new THREE.Vector3()
      const coordEl = document.getElementById('v2b-mp-coord')
      if (coordEl) coordEl.textContent = `${id} 坐标 → (${pos.x.toFixed(3)}, ${pos.y.toFixed(3)}, ${pos.z.toFixed(3)})`
      mountViz?.highlight([id])
    })
    chip.addEventListener('mouseleave', () => {
      const coordEl = document.getElementById('v2b-mp-coord')
      if (coordEl) coordEl.textContent = '挂点坐标将在检测后显示'
      mountViz?.clearHighlight()
    })
  })
}

// ──  5 ：  UI  ────────────────────────────────────────────

function refreshMountStatusUI(): void {
  const result = mountAdapter?.lastDetection
  const dims   = mountAdapter?.getDims()
  if (!dims) return

  const hint = document.getElementById('v2b-mp-hint')
  const statusText = document.getElementById('v2b-mp-status-text')
  const sHeight = document.getElementById('v2b-mp-s-height')
  const sRatio  = document.getElementById('v2b-mp-s-ratio')
  const ratioSlider = document.getElementById('v2b-mp-ratio') as HTMLInputElement | null
  const ratioLabel  = document.getElementById('v2b-mp-ratio-val')

  if (hint) hint.textContent = `比例 ${dims.bodyRatio.toFixed(1)} · 高度 ${dims.height.toFixed(2)}`
  if (sHeight) sHeight.textContent = `${dims.height.toFixed(2)}u`
  if (sRatio)  sRatio.textContent  = dims.bodyRatio.toFixed(1)

  // （  input ）
  if (ratioSlider) ratioSlider.value = String(dims.bodyRatio)
  if (ratioLabel)  ratioLabel.textContent = dims.bodyRatio.toFixed(1)

  const source = mountAdapter?.mountSource ?? 'static'
  const sourceLabel: Record<string, string> = {
    spine:      '🦴 Spine ',
    geometric:  '📐 ',
    static:     '📊 ',
  }
  const sourceColor: Record<string, string> = {
    spine:      '#00e5cc',
    geometric:  '#ffcc44',
    static:     '#888888',
  }

  if (statusText) {
    statusText.style.color = sourceColor[source] ?? '#888'
    if (source === 'spine') {
      const profile = (mountAdapter as any)?.rigProfile
      const wt = profile?.weaponType ?? '—'
      const gender = profile?.gender ?? '—'
      statusText.textContent = `${sourceLabel[source]} · ${gender} · ${wt}`
    } else if (result) {
      const cColor = confidenceColor(result.confidence)
      const cLabel = confidenceLabel(result.confidence)
      statusText.style.color = cColor
      statusText.textContent = `${sourceLabel[source]} · ${cLabel} · ${result.meshCount}  mesh`
    } else {
      statusText.textContent = ' …'
    }
    if (sRatio) sRatio.style.color = sourceColor[source] ?? '#888'
  }
}

// ──  ──────────────────────────────────────────────────────────────────

function doHit(): void {
  if (!hitFX) return
  const elem = currentHitType === 'elemental' ? currentElement : undefined
  //  adapter （ ）
  const hint = currentHitType === 'critical' ? 'hit_critical' : 'hit_body'
  const contactPoint = mountAdapter?.getMountForEffect(hint) ?? new THREE.Vector3(0, 1.05, 0.15)
  hitFX.trigger(
    { type: currentHitType, contactPoint, hitDirection: new THREE.Vector3(0, 0, 1), element: elem },
    undefined,
    1.0,
  )
}

function updateWeaponInfo(): void {
  const cfg = MODERN_WEAPON_CONFIGS[currentWeapon]
  const el  = document.getElementById('v2b-weapon-info')
  if (el) el.textContent = `射速 ${cfg.fireRate}/s · 弹体 ${cfg.projectileType} · 扩散 ${cfg.spreadAngle}° · 范围 ${cfg.blastRadius}`
  modernVFX?.setWeapon(currentWeapon, characterState.profile.worldSetting, characterState.profile.charClass)
}

// ──  ─────────────────────────────────────────────────────────────────

function hitLabel(t: HitType) {
  return ({ light:'轻击', heavy:'重击', critical:'暴击', elemental:'元素', blocked:'格挡', heal:'治疗' } as Record<HitType, string>)[t] ?? t
}
function elemLabel(e: string) {
  return ({ fire:'火焰', ice:'冰霜', lightning:'闪电', poison:'毒素', dark:'暗影' } as Record<string, string>)[e] ?? e
}
function surfaceLabel(s: ImpactSurface) {
  return ({ concrete:'混凝土', metal:'金属', flesh:'生物', explosive:'爆炸物' } as Record<ImpactSurface, string>)[s]
}
function weaponLabel(k: ModernWeaponCategory) {
  return ({ handgun:'手枪', smg:'冲锋枪', assault_rifle:'突击步枪', sniper:'狙击枪',
    shotgun:'霰弹枪', rpg:'RPG', minigun:'转轮机枪', flamethrower:'喷火器',
    railgun:'电磁炮', grenade:'榴弹' } as Record<ModernWeaponCategory, string>)[k] ?? k
}

// ── CSS  ─────────────────────────────────────────────────────────────────

const CSS_ID = 'vfx2-bootstrap-css'
function injectStyles(): void {
  if (document.getElementById(CSS_ID)) return
  const s = document.createElement('style')
  s.id = CSS_ID
  s.textContent = `
/* ── VFX2 Bootstrap Styles ───────────────────────────────
 * 注:本面板挂在 host viewport 上,host 已经提供 design SSOT 的 token,
 *    所以这里的中性色/lime 强调色直接走 var(--color-*) + 旧 alias 兜底。
 *    功能色编码(蓝=hit/橙=fire/金=impact/红=chip-act)为信息载体,保留原色不动。
 * ──────────────────────────────────────────────────────── */
#${INJECT_ID} {
  font-family: inherit;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 1px 0 2px;
}
/* ──  ── */
#v2b-style-strip {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 6px 8px;
  margin: 0 0 2px;
  background: rgba(212,255,72,.035);
  border-radius: 7px;
  border: 1px solid var(--color-divider-subtle, rgba(255,255,255,.05));
  font-size: 10px;
}
.v2b-ss-char  { color: var(--color-text-primary, #fff); font-weight: 600; }
.v2b-ss-world { color: var(--color-text-tertiary, rgba(255,255,255,.30)); }
.v2b-ss-dots  { display: flex; gap: 3px; margin-left: 2px; }
.v2b-ss-dot   { display: inline-block; width: 10px; height: 10px; border-radius: 2px; }
.v2b-ss-bloom-wrap { flex: 1; height: 3px; background: var(--color-divider-default, rgba(255,255,255,.10)); border-radius: 2px; overflow: hidden; }
#v2b-bloom-fill { height: 100%; background: rgba(200,168,64,.7); border-radius: 2px; transition: width .3s; }
.v2b-ss-elem { color: var(--color-text-secondary, rgba(255,255,255,.60)); font-size: 9px; white-space: nowrap; }

/* ──  ── */
.v2b-group {
  border: 1px solid rgba(255,255,255,.065);
  border-radius: 7px;
  background: linear-gradient(180deg, rgba(255,255,255,.026), rgba(255,255,255,.012));
  overflow: hidden;
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.14);
}
.v2b-gh {
  padding: 6px 8px;
  display: flex; align-items: center; gap: 6px;
  cursor: pointer; user-select: none;
  font-size: 11px; font-weight: 600; color: var(--color-text-secondary, rgba(255,255,255,.60));
  letter-spacing: .3px;
  min-height: 28px;
  box-sizing: border-box;
}
.v2b-gh:hover { background: var(--color-interaction-hover, rgba(255,255,255,.05)); }
.v2b-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.v2b-gh-label { color: var(--color-text-primary, #fff); }
.v2b-gh-hint { font-size: 10px; color: var(--color-text-tertiary, rgba(255,255,255,.30)); margin-left: 4px; }
.v2b-arrow { margin-left: auto; font-size: 9px; color: var(--color-text-tertiary, rgba(255,255,255,.30)); }
.v2b-body {
  padding: 6px 8px 8px;
  display: flex; flex-direction: column; gap: 5px;
  background: rgba(0,0,0,.08);
  border-top: 1px solid rgba(255,255,255,.04);
}
.v2b-row {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  min-height: 24px;
}
.v2b-lbl {
  font-size: 10px; color: var(--color-text-tertiary, rgba(255,255,255,.30)); min-width: 34px; flex-shrink: 0;
  text-align: right;
}
.v2b-chips { display: flex; flex-wrap: wrap; gap: 3px; flex: 1 1 0; min-width: 0; }
.v2b-chip {
  padding: 2px 6px; border-radius: 8px;
  font-size: 10px; background: var(--color-interaction-hover, rgba(255,255,255,.05));
  border: 1px solid var(--color-divider-default, rgba(255,255,255,.10));
  color: var(--color-text-secondary, rgba(255,255,255,.60));
  cursor: pointer; font-family: inherit; transition: all .1s;
}
.v2b-chip:hover { background: var(--color-interaction-selected-neutral, rgba(255,255,255,.10)); color: var(--color-text-primary, #fff); }
.v2b-chip.act {
  background: var(--color-interaction-selected-brand, rgba(212,255,72,.10));
  border-color: rgba(212,255,72,.35);
  color: var(--color-brand-primary, #d4ff48);
}
/*  CSS  #v2b-style-strip  */

/* ──  ── */
.v2b-cat {
  display: flex; align-items: center; gap: 7px;
  padding: 4px 2px 1px;
  font-size: 9px; font-weight: 700;
  color: var(--color-text-tertiary, rgba(255,255,255,.30));
  letter-spacing: 1.2px; text-transform: uppercase;
  border-top: none;
  margin-top: 3px;
}
.v2b-cat::after { content:""; flex:1; height:1px; background:rgba(255,255,255,.055); }
.v2b-ai-hint {
  font-size: 10px; color: var(--color-text-tertiary, rgba(255,255,255,.30)); line-height: 1.4;
  background: rgba(255,255,255,.035); border-radius: 5px;
  padding: 4px 6px;
}
.v2b-btn-row { display: flex; gap: 5px; }
.v2b-btn {
  flex: 1; padding: 5px 7px; border-radius: 5px;
  font-size: 10px; font-weight: 600; font-family: inherit;
  cursor: pointer; border: 1px solid transparent; transition: all .1s;
}
/* 功能色编码(蓝=hit/橙=fire/金=impact)为信息载体,保留原色不动 */
.v2b-btn-hit    { background: rgba(74,144,226,.1); border-color: rgba(74,144,226,.3); color: #6aaeff; }
.v2b-btn-hit:hover  { background: rgba(74,144,226,.2); }
.v2b-btn-fire   { background: rgba(255,136,68,.1); border-color: rgba(255,136,68,.3); color: #ffaa66; }
.v2b-btn-fire:hover { background: rgba(255,136,68,.2); }
.v2b-btn-impact { background: rgba(200,168,64,.1); border-color: rgba(200,168,64,.3); color: #e8c850; }
.v2b-btn-impact:hover { background: rgba(200,168,64,.2); }
.v2b-btn-auto   { background: var(--color-interaction-hover, rgba(255,255,255,.05)); border-color: var(--color-divider-default, rgba(255,255,255,.10)); color: var(--color-text-secondary, rgba(255,255,255,.60)); }
.v2b-btn-auto:hover  { color: var(--color-text-primary, #fff); }
.v2b-btn-small  { flex: none; padding: 3px 7px; background: var(--color-interaction-hover, rgba(255,255,255,.05)); border-color: var(--color-divider-default, rgba(255,255,255,.10)); color: var(--color-text-secondary, rgba(255,255,255,.60)); }
.v2b-num {
  width: 60px; background: var(--color-interaction-hover, rgba(255,255,255,.05)); color: var(--color-text-primary, #fff);
  border: 1px solid var(--color-divider-default, rgba(255,255,255,.10)); border-radius: 3px;
  padding: 4px 5px; font-size: 10px; font-family: inherit;
}
.v2b-sel {
  flex: 1; background: var(--color-interaction-hover, rgba(255,255,255,.05)); color: var(--color-text-primary, #fff);
  border: 1px solid var(--color-divider-default, rgba(255,255,255,.10)); border-radius: 3px;
  padding: 4px 5px; font-size: 10px; font-family: inherit; cursor: pointer;
  min-width: 0;
}
.v2b-sel-full { width: 100%; flex: none; }
/*  3/4  */
.v2b-chips { display: flex; flex-wrap: wrap; gap: 3px; flex: 1; }
.v2b-chip {
  padding: 2px 6px; border-radius: 8px; font-size: 10px; cursor: pointer;
  background: var(--color-interaction-hover, rgba(255,255,255,.05));
  border: 1px solid var(--color-divider-default, rgba(255,255,255,.10));
  color: var(--color-text-secondary, rgba(255,255,255,.60));
  font-family: inherit; transition: all .1s;
}
/* 红=危险/移除 信息色,保留 */
.v2b-chip.act { background: rgba(255,68,102,.12); color: #ff6688; }
.v2b-chip:hover { color: var(--color-text-primary, #fff); }
.v2b-stat-tbl {
  display: grid; grid-template-columns: repeat(4,1fr); gap: 3px;
  padding: 2px 0; font-size: 10px;
}
.v2b-stat-cell {
  background: rgba(255,255,255,.04); border-radius: 5px;
  padding: 4px 5px; display: flex; flex-direction: column; gap: 1px;
  min-width: 0;
}
.v2b-stat-name { color: var(--color-text-tertiary, rgba(255,255,255,.30)); font-size: 9px; }
.v2b-stat-val  { color: var(--color-text-primary, #fff); font-weight: 600; }
.v2b-dmg-result {
  font-size: 10px; background: rgba(170,136,255,.055);
  border: 1px solid rgba(170,136,255,.12);
  border-radius: 6px; padding: 5px 7px; min-height: 26px;
  color: var(--color-text-secondary, rgba(255,255,255,.60)); line-height: 1.6;
}
.v2b-dmg-row { display: flex; justify-content: space-between; }
.v2b-mp-chips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
.v2b-mp-chip {
  display: flex; align-items: center; gap: 4px;
  padding: 2px 6px; border-radius: 8px;
  border: 1px solid; font-size: 10px; cursor: default;
  transition: background .15s;
}
.v2b-mp-chip:hover { background: var(--color-interaction-hover, rgba(255,255,255,.05)) !important; }
.v2b-mp-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.v2b-mp-status {
  /* 青绿=挂载点在线状态(信息色),保留 */
  background: rgba(0,229,204,.06); border: 1px solid rgba(0,229,204,.18);
  border-radius: 6px; padding: 5px 7px; margin-bottom: 2px;
}
.v2b-mp-status-row { display: flex; align-items: center; gap: 6px; font-size: 10px; line-height: 1.55; }
#v2b-body-hit .v2b-row:has(.v2b-num),
#v2b-body-targeting .v2b-row:has(input[type="range"]),
#v2b-body-stats .v2b-row:has(input[type="range"]),
#v2b-body-mount .v2b-row:has(input[type="range"]) { flex-wrap: nowrap; }
#v2b-body-targeting .v2b-btn-row,
#v2b-body-modern .v2b-btn-row,
#v2b-body-stats .v2b-btn-row,
#v2b-body-mount .v2b-btn-row { gap: 4px; }
#v2b-body-stats .v2b-sel-full,
#v2b-body-modern .v2b-sel-full,
#v2b-body-trail .v2b-sel-full { flex: 1 1 0; width: auto; }
`
  document.head.appendChild(s)
}

// ──  3  ───────────────────────────────────────────────────────────────

function refreshLockInfo(): void {
  const locked = targetSys?.lockedTarget
  const state  = targetSys?.state ?? 'none'
  const el = document.getElementById('v2b-lock-info')
  if (el) el.textContent = locked
    ? `${state === 'hard' ? '硬锁定' : '软锁定'}: ${locked.id} · 生命 ${Math.round(locked.hpRatio * 100)}% · 威胁 ${locked.threat}`
    : '未锁定目标'

  //  chip 
  document.querySelectorAll('[data-tgtid]').forEach(b => {
    b.classList.toggle('act', b.getAttribute('data-tgtid') === locked?.id)
  })
}

// ──  4  ───────────────────────────────────────────────────────────────

function renderStatTable(pack: ReturnType<typeof getStatPack>): string {
  const b = pack.base
  const rows: [string, number | string][] = [
    ['物攻',   b.ATK],  ['魔攻', b.MATK], ['物防',  b.DEF],
    ['魔防',  b.MDEF], ['生命',   b.HP],   ['速度',  b.SPD],
    ['暴击率', Math.round(b.CRIT_RATE * 100) + '%'],
    ['暴伤',  b.CRIT_DMG + 'x'],
  ]
  return rows.map(([n, v]) => `
    <div class="v2b-stat-cell">
      <span class="v2b-stat-name">${n}</span>
      <span class="v2b-stat-val">${v}</span>
    </div>`).join('')
}

function refreshStatTable(): void {
  const pack = getStatPack(combatClass, combatLevel)
  const tbl = document.getElementById('v2b-stat-table')
  if (tbl) tbl.innerHTML = renderStatTable(pack)

  const skills = pack.skills
  const sel = document.getElementById('v2b-skill-sel') as HTMLSelectElement | null
  if (sel) {
    sel.innerHTML = skills.map(s =>
      `<option value="${s.slotIndex}">[${s.slotIndex}] ${s.name} ×${s.multiplier} · ${s.hitCount} 段 · 冷却 ${s.cooldown}s</option>`
    ).join('')
  }

  const gunInfo = document.getElementById('v2b-gun-info')
  if (gunInfo) {
    gunInfo.textContent = pack.gun
      ? `枪械参数: 射速 ${pack.gun.firerate}/s · 弹速 ${pack.gun.bulletSpeed} · 弹匣 ${pack.gun.magSize} · 伤害 ${pack.gun.damage}`
      : ''
    gunInfo.style.display = pack.gun ? '' : 'none'
  }
  const gunBtn = document.getElementById('v2b-calc-gun')?.parentElement
  if (gunBtn) (gunBtn as HTMLElement).style.display = pack.gun ? '' : 'none'

  const hint = document.querySelector('.v2b-gh[data-v2sec="stats"] .v2b-gh-hint') as HTMLElement | null
  if (hint) hint.textContent = `${combatClass} 等级 ${combatLevel}`
}

function calcAndShowDamage(forceCrit: boolean): void {
  const pack = getStatPack(combatClass, combatLevel)
  const sel  = document.getElementById('v2b-skill-sel') as HTMLSelectElement | null
  const idx  = sel ? parseInt(sel.value) : 0
  const skill = pack.skills[idx]
  if (!skill) return

  const r    = calcSkillDamage(pack.base, skill, undefined, forceCrit)
  const scale = damageToVFXScale(r.final)
  const el   = document.getElementById('v2b-dmg-result')
  if (!el) return

  el.innerHTML = `
    <div class="v2b-dmg-row"><span>${skill.name}</span><span style="color:#${r.isCritical?'ff6600':'aa88ff'}">${r.isCritical ? '暴击 ' : ''}${r.final}</span></div>
    <div class="v2b-dmg-row"><span>分段</span><span style="color:#888">${r.perHit.join(' + ')}</span></div>
    <div class="v2b-dmg-row"><span>减免后</span><span style="color:#666">${r.reduced}</span></div>
    <div class="v2b-dmg-row"><span>特效缩放</span><span style="color:#44ccff">${scale.toFixed(2)}x</span></div>
    <div class="v2b-dmg-row"><span>击退</span><span style="color:#888">${Math.round(skill.knockback*100)}%</span></div>
  `
}
