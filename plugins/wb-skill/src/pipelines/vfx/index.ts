// @source wb-character/src/pipelines/vfx/index.ts
import * as THREE from 'three'
import type { IPipeline, PipelineContext, PipelinePanels } from '../../core/types'
import { meta } from './meta'
import type { VFXParams } from '../../vfx/VFXManager'
import { VFXManager } from '../../vfx/VFXManager'
import { readCharacterProfile, hasCharacter } from './CharacterState'
import { studioSave, studioLoad } from './StudioStorage'
import { EFFECT_TEMPLATES, SLOT_META, createDefaultSkills } from './VFXTypes'
import type { SkillSlot } from './VFXTypes'
import { autoMatchSkills } from './SkillMatcher'
import {
  vfxSkillsToExported,
  listWorkspaceGames,
  mergeSkillsToWorkspaceGame,
  manifestSkillsToSkillSlots,
  type WorkspaceGame,
} from './publishSkills'
import type { CharacterManifest } from '../../types/CharacterManifest'
import type { ElementKey } from '../../vfx/effects/SlashEffect'
import { spawnTemplate, generateFromDescription, TEMPLATE_REGISTRY } from '../../vfx/templates/TemplateRegistry'
import type { ITemplate, TemplateParams } from '../../vfx/templates/TemplateRegistry'
import { composeEffect } from '../../vfx/composer/ComponentComposer'
import type { ComponentInstanceConfig } from '../../vfx/composer/ComponentComposer'
import { GameFeelSystem, DEFAULT_GAMEFEEL } from '../../vfx/GameFeel'
import { getCharWorldPos, hasTrackedSprite } from '../../vfx/mount/CharPosTracker'
import type { GameFeelConfig } from '../../vfx/GameFeel'
import { getOrCreateAdapter } from '../../vfx/mount/SharedAdapter'
import type { MountAdapter } from '../../vfx/mount/MountAdapter'
import { TargetAcquisitionSystem } from '../../vfx/targeting/TargetAcquisitionSystem'
import { DamageNumber } from '../../vfx/effects/hit/DamageNumber'

const CSS_ID = 'vfx-pipeline-css'
const VFX_STATE_KEY = 'vfx-editor-state'

interface SkillPack { id: string; name: string; profession: string; skills: SkillSlot[]; timestamp: number }

interface VFXState {
  skills: SkillSlot[]
  activeSlot: number
  packs: SkillPack[]
  activePack: string
}

function createDefault(): VFXState {
  return { skills: createDefaultSkills(), activeSlot: 0, packs: [], activePack: '' }
}

// ── Effect definitions ─────────────────────────────────────────────

interface EffectDef {
  id: string; icon: string; label: string; group: string
  toggleable?: boolean; hasParams?: boolean
  isGroupHeader?: boolean; parentGroup?: string
  fire: (v: VFXManager) => void
  deactivate?: (v: VFXManager) => void
  /**
   * Default skill slot for this effect when assigned via the down-arrow button.
   * Each effect declares its own "home" slot so the assign button always writes
   * to the correct slot regardless of which slot is currently active.
   * D-8: no reactive GlobalState -- slot assignment is purely event-driven.
   */
  defaultSlot: SkillSlot['id']
}

// Per-group color themes: [headerBg, headerText, borderColor, cardBg, accentDot]
const GROUP_THEMES: Record<string, { bg: string; text: string; border: string; cardBg: string; dot: string }> = {
  'attack':  { bg: 'rgba(255,120,60,.12)',  text: '#ff8844', border: 'rgba(255,120,60,.35)',  cardBg: 'rgba(255,120,60,.04)',  dot: '#ff8844' },
  'status':  { bg: 'rgba(100,220,160,.10)', text: '#55cc88', border: 'rgba(100,220,160,.30)', cardBg: 'rgba(100,220,160,.03)', dot: '#55cc88' },
  'vanish':  { bg: 'rgba(160,130,240,.10)', text: '#a882f0', border: 'rgba(160,130,240,.30)', cardBg: 'rgba(160,130,240,.03)', dot: '#a882f0' },
  'ice':     { bg: 'rgba(80,180,255,.12)',  text: '#55bbff', border: 'rgba(80,180,255,.35)',  cardBg: 'rgba(80,180,255,.04)',  dot: '#55bbff' },
  'advance': { bg: 'rgba(255,200,60,.10)',  text: '#eebb33', border: 'rgba(255,200,60,.30)',  cardBg: 'rgba(255,200,60,.03)',  dot: '#eebb33' },
}
const DEFAULT_THEME = { bg: 'var(--bg-hover)', text: 'var(--accent)', border: 'var(--border)', cardBg: 'transparent', dot: 'var(--accent)' }
const GROUP_LABELS: Record<string, string> = {
  attack: '攻击特效',
  status: '状态 / 回复',
  vanish: '位移 / 消失',
  ice: '冰霜控制',
  advance: '高级爆发',
}
const SLOT_LABELS: Record<SkillSlot['id'], string> = {
  normal: '普通攻击',
  skill1: '技能 1',
  skill2: '技能 2',
  skill3: '技能 3',
  skill4: '技能 4',
  ultimate: '终极技',
}
const EFFECT_LABELS: Record<string, string> = {
  attack: '基础连击',
  dashtrail: '冲刺拖尾',
  starblade: '星刃斩击',
  weaponslash: '武器斩击',
  poison: '毒雾 / 中毒',
  shield: '召唤护盾',
  heal: '治疗光环',
  'dissolve-out': '溶解消失',
  'dissolve-in': '溶解出现',
  teleport: '传送',
  'teleport-in': '传送出现',
  ice: '冰锥连击',
  groundfrost: '地面冰霜',
  screenfrost: '屏幕冰霜',
  bigfireball: '巨型火球',
  meteor: '陨石打击',
  magiccannon: '魔法炮',
  lightning: '闪电攻击',
  arcaneblast: '奥术爆破',
  hitexplosion: '命中爆炸',
  hurt: '受击反馈',
  shockwave: '冲击波',
  vinestrike: '藤蔓突刺',
}
const PARAM_LABELS: Record<string, string> = {
  Element: '元素',
  Glow: '辉光',
  Mix: '混合',
  Radius: '半径',
  Speed: '速度',
  Parts: '粒子',
  Charge: '蓄力',
  Width: '宽度',
  Height: '高度',
  Drop: '落差',
  Pool: '毒池',
  Scale: '缩放',
  Grid: '网格',
  Flow: '流动',
  Bright: '亮度',
  Hue: '色相',
  Dur: '时长',
  Freeze: '冻结',
  Screen: '屏幕',
  Explode: '爆炸',
  Warn: '预警',
  Impact: '冲击',
  Shock: '冲击波',
  Smoke: '烟雾',
  Shake: '震屏',
  Flash: '闪光',
  Burn: '燃烧',
  Ring: '圆环',
  Length: '长度',
  Vortex: '旋涡',
  Streaks: '拖痕',
  MaxLen: '最大长度',
  Intense: '强度',
  Cracks: '裂纹',
}

/**
 * defaultSlot design intent:
 *   normal   -- most frequent left-click action, must have the most visible VFX
 *               -> basic attack combo
 *   skill1   -- strong single melee hit
 *               -> weapon slash
 *   skill2   -- ranged / AoE
 *               -> shockwave / lightning / vine
 *   skill3   -- status / persistent
 *               -> shield / heal / ice spike
 *   skill4   -- AoE control / DoT
 *               -> poison / groundfrost / screenfrost
 *   ultimate -- most spectacular
 *               -> starblade / meteor / big fireball
 *
 * Each effect has exactly one default to avoid choice fatigue.
 */
// Order matters: EFFECTS.find(d => d.defaultSlot === slotId) hits the first match,
// so the preferred effect for each slot comes first. 'attack' must precede 'dashtrail'
// so the normal slot gets the combo slash, not the drift trail.
const EFFECTS: EffectDef[] = [
  { id: 'attack',      icon: '⚔',  label: 'Basic Attack Combo', group: 'attack',  hasParams: true, defaultSlot: 'normal',   fire: v => v.attackFullCombo() },
  { id: 'dashtrail',   icon: '💨', label: 'Dash Trail',         group: 'attack',  hasParams: true, defaultSlot: 'skill2',   fire: v => v.fireDashTrail() },
  { id: 'starblade',   icon: '🌟', label: 'Star Blade',         group: 'attack',  hasParams: true, defaultSlot: 'ultimate', fire: v => v.fireStarBlade() },
  { id: 'weaponslash', icon: '🗡', label: 'Weapon Slash',       group: 'attack',  hasParams: true, defaultSlot: 'skill1',   fire: v => v.fireWeaponSlash() },
  { id: 'poison',      icon: '☠',  label: 'Poison',             group: 'status',  hasParams: true, defaultSlot: 'skill4',   fire: v => v.firePoison() },
  { id: 'shield',      icon: '🛡', label: 'Shield',             group: 'status',  hasParams: true, defaultSlot: 'skill3',   toggleable: true, fire: v => v.toggleShield(), deactivate: v => v.toggleShield() },
  { id: 'heal',        icon: '✚',  label: 'Heal Aura',          group: 'status',  hasParams: true, defaultSlot: 'skill3',   toggleable: true, fire: v => v.toggleHealAura(), deactivate: v => v.toggleHealAura() },
  { id: 'dissolve-out',icon: '↘',  label: 'Dissolve Out',       group: 'vanish',  hasParams: true, defaultSlot: 'skill4',   fire: v => v.triggerDissolveOut() },
  { id: 'dissolve-in', icon: '↗',  label: 'Dissolve In',        group: 'vanish',  hasParams: true, defaultSlot: 'skill4',   fire: v => v.triggerDissolveIn() },
  { id: 'teleport',    icon: '✨', label: 'Teleport (full)',    group: 'vanish',                   defaultSlot: 'skill3',   fire: v => v.triggerTeleportOut() },
  { id: 'teleport-in', icon: '⬆',  label: 'Teleport Appear',    group: 'vanish',                   defaultSlot: 'skill3',   fire: v => v.triggerTeleportIn() },
  { id: 'ice',         icon: '❄',  label: 'Ice Spike Combo',    group: 'ice',     hasParams: true, defaultSlot: 'skill2',   fire: v => v.fireIceCombo() },
  { id: 'groundfrost', icon: '🧊', label: 'Ground Frost',       group: 'ice',     hasParams: true, defaultSlot: 'skill4',   fire: v => v.triggerGroundFrost() },
  { id: 'screenfrost', icon: '🌨', label: 'Screen Frost',       group: 'ice',     hasParams: true, defaultSlot: 'skill4',   fire: v => v.triggerScreenFrost() },
  { id: 'bigfireball', icon: '🔥', label: 'Big Fireball',       group: 'advance', hasParams: true, defaultSlot: 'ultimate', fire: v => v.fireBigFireball() },
  { id: 'meteor',      icon: '☄',  label: 'Meteor',             group: 'advance', hasParams: true, defaultSlot: 'ultimate', fire: v => v.fireMeteor() },
  { id: 'magiccannon', icon: '💠', label: 'Magic Cannon',       group: 'advance', hasParams: true, defaultSlot: 'skill2',   fire: v => v.fireMagicCannon() },
  { id: 'lightning',   icon: '⚡',  label: 'Lightning',          group: 'advance', hasParams: true, defaultSlot: 'skill2',   fire: v => v.fireLightning() },
  { id: 'arcaneblast', icon: '🔮', label: 'Arcane Blast',       group: 'advance',                  defaultSlot: 'skill2',   fire: v => v.fireArcaneBlast() },
  { id: 'hitexplosion',icon: '💥', label: 'Hit Explosion',      group: 'advance',                  defaultSlot: 'skill1',   fire: v => v.triggerHitExplosion() },
  { id: 'hurt',        icon: '❤',    label: 'Hurt Feedback',     group: 'status',                   defaultSlot: 'skill3',   fire: v => v.triggerHurt() },
  { id: 'shockwave',   icon: '🌊', label: 'Shockwave',          group: 'advance',                  defaultSlot: 'skill2',   fire: v => v.triggerShockwave() },
  { id: 'vinestrike',  icon: '🌿', label: 'Vine Strike',        group: 'advance', hasParams: true, defaultSlot: 'skill1',   fire: v => v.fireVineStrike() },
]
console.log('[VFX_MODULE] loaded, effect count:', EFFECTS.length, ', ids:', EFFECTS.map(e=>e.id).join(','))

// Force Vite to do a full-page reload when this file changes instead of HMR.
// Reason: PipelineRegistry caches the vfxPipeline reference with { eager:true };
// HMR only updates module variables but cannot refresh a cached object reference,
// so newly added effects would not appear without a full reload.
if ((import.meta as any).hot) {
  (import.meta as any).hot.decline()
}

// ── Main UI ────────────────────────────────────────────────────────

class VFXPipelineUI {
  private st: VFXState
  private left: HTMLElement | null = null
  private panels: PipelinePanels | null = null
  private vfx: VFXManager | null = null
  private ctx: PipelineContext | null = null
  private updateCb: ((dt: number) => void) | null = null
  private unsub: (() => void) | null = null
  private activeEffect: string | null = null
  private toggleOn = new Set<string>()
  private loopTimer: ReturnType<typeof setInterval> | null = null
  private _posUpdateTimer: ReturnType<typeof setInterval> | null = null
  // Default collapsed groups: packs, ai-tmpl, status, vanish, ice, advance
  private collapsed = new Set<string>(['packs', 'ai-tmpl', 'status', 'vanish', 'ice', 'advance'])
  private workflowOpen = new Set<string>(['1'])
  private chatHistory: { role: string; text: string }[] = []
  private vfxGroup: THREE.Group | null = null
  private adapter: MountAdapter | null = null
  // AI template generation state
  private tmplInstances: ITemplate[] = []
  private tmplUpdateCb: ((dt: number) => void) | null = null
  private gameFeel: GameFeelSystem | null = null
  private gameFeelCb: ((dt: number) => void) | null = null
  private gameFeelCfg: GameFeelConfig = { ...DEFAULT_GAMEFEEL }
  // Demo targeting: 3 geometry enemies
  private _targeting: TargetAcquisitionSystem | null = null
  private _demoMeshes: THREE.Mesh[] = []
  private _dmgNumbers: DamageNumber | null = null
  private lastTmplResult: {
    mode:        'template' | 'compose'
    template?:   string
    label:       string
    params?:     TemplateParams
    components?: Record<string, ComponentInstanceConfig>
    attackDir?:  [number, number]
  } | null = null
  private tmplGenerating = false

  // Module 16 split-pane: left iframe carries the controls, center iframe owns the
  // visible THREE canvas. Each iframe spins up its own VFXManager so a `def.fire(v)`
  // call from the left pane only fires effects in the (hidden) left scene. We
  // broadcast every fire intent over BroadcastChannel; the receiving pane re-runs
  // the effect on its own VFXManager so the user actually sees explosions in the
  // center viewport. Self-id dedupe prevents the ping-ponging echo.
  private _bcVfx: BroadcastChannel | null = null
  private _bcVfxSelfId = Math.random().toString(36).slice(2, 10)
  private _applyingIntent = false

  // D-8: no reactive GlobalState subscription -- unsub stays null (R1 known risk).
  constructor() { injectCSS(); this.st = createDefault(); this.unsub = null; this.setupVfxIntentBus() }

  private setupVfxIntentBus(): void {
    if (this._bcVfx) return
    try { this._bcVfx = new BroadcastChannel('forgeax-plugin.@forgeax-plugin/wb-skill.vfx-intent') } catch { this._bcVfx = null }
    if (!this._bcVfx) return
    this._bcVfx.onmessage = (e: MessageEvent) => {
      const data = (e.data ?? {}) as { kind?: string; source?: string; defId?: string }
      if (data.source === this._bcVfxSelfId) return
      if (!this.vfx) return
      if (data.kind === 'fire-effect' && data.defId) {
        const def = EFFECTS.find(d => d.id === data.defId)
        if (!def) return
        this._applyingIntent = true
        try { def.fire(this.vfx) } finally { this._applyingIntent = false }
      } else if (data.kind === 'deactivate-effect' && data.defId) {
        const def = EFFECTS.find(d => d.id === data.defId)
        if (def?.deactivate) {
          this._applyingIntent = true
          try { def.deactivate(this.vfx) } finally { this._applyingIntent = false }
        }
      }
    }
  }

  /**
   * Local fire + cross-pane broadcast. Always runs the effect on this pane's
   * VFXManager (so standalone-mode and the center pane both work) and ALSO
   * posts an intent so the sibling pane mirrors the call.
   */
  private fireEffect(def: EffectDef): void {
    if (this.vfx) { try { def.fire(this.vfx) } catch (e) { console.warn('[VFXPipeline] def.fire threw:', e) } }
    if (this._applyingIntent || !this._bcVfx) return
    try { this._bcVfx.postMessage({ kind: 'fire-effect', defId: def.id, source: this._bcVfxSelfId }) } catch {}
  }

  private deactivateEffect(def: EffectDef): void {
    if (this.vfx && def.deactivate) { try { def.deactivate(this.vfx) } catch (e) { console.warn('[VFXPipeline] def.deactivate threw:', e) } }
    if (this._applyingIntent || !this._bcVfx) return
    try { this._bcVfx.postMessage({ kind: 'deactivate-effect', defId: def.id, source: this._bcVfxSelfId }) } catch {}
  }

  async restore(): Promise<void> {
    try {
      const s = await studioLoad<any>(VFX_STATE_KEY)
      if (s?.skills) this.st.skills = s.skills
      if (s?.activeSlot != null) this.st.activeSlot = s.activeSlot
      if (s?.packs) this.st.packs = s.packs
      if (s?.activePack) this.st.activePack = s.activePack
    } catch {}
  }

  mount(left: HTMLElement, panels: PipelinePanels, ctx: PipelineContext): void {
    this.left = left; this.panels = panels; this.ctx = ctx
    // Guard: skip re-init when vfx or vfxGroup already exists to avoid orphaned groups
    if (!this.vfx && !this.vfxGroup) {
      const group = new THREE.Group()
      group.name = '__vfx_effects__'
      ctx.engine.scene.add(group)

      let mgr: VFXManager
      try {
        mgr = new VFXManager(group as any, ctx.engine.camera)
      } catch (e) {
        console.error('[VFXPipeline] VFXManager init FAILED:', e)
        ctx.engine.scene.remove(group)
        return
      }

      this.vfxGroup = group
      this.vfx = mgr

      // Pass overlayScene to support foreground rendering (slash/trail occlude character)
      this.vfx.setOverlayScene(ctx.engine.overlayScene)

      // Mount-point adapter: init singleton and inject VFXManager
      this.adapter = getOrCreateAdapter(ctx.engine.scene)
      this.vfx.setAdapter(this.adapter)

      this.updateCb = (dt: number) => {
        this.vfx?.update(dt)
        // Let adapter run scene-hash detection each frame (throttled internally, lightweight)
        this.adapter?.tick()
        // Demo targeting: rotate targets + update lock effects
        this._updateDemoTargets(dt, ctx)
      }
      ctx.engine.onUpdate(this.updateCb)

      // GameFeel system (Camera Shake + Exposure Pulse + Hit Flash via toneMappingExposure)
      if (!this.gameFeel) {
        this.gameFeel = new GameFeelSystem(ctx.engine.camera, ctx.engine.renderer)
        this.gameFeel.config = this.gameFeelCfg
        this.gameFeelCb = (dt: number) => this.gameFeel?.update(dt)
        ctx.engine.onUpdate(this.gameFeelCb)
      }

      // Inject impact callback: VFXManager notifies GameFeel on attack/hurt events.
      // scale: normal (basic attack/slash) x0.3, medium (combo) x0.35-0.55,
      //        heavy (meteor/cannon/lightning/explosion/starblade) x1.0, hurt x0.75
      this.vfx.setImpactCallback((scale) => this.gameFeel?.triggerImpact(scale))

      // Demo targeting: 3 rotating geometry enemies
      this._setupDemoTargets(ctx)

      // Template instance update callback (independent of VFXManager)
      this.tmplUpdateCb = (dt: number) => {
        for (let i = this.tmplInstances.length - 1; i >= 0; i--) {
          this.tmplInstances[i].update(dt, ctx.engine.camera)
          if (!this.tmplInstances[i].isAlive()) {
            this.tmplInstances[i].dispose()
            this.tmplInstances.splice(i, 1)
          }
        }
      }
      ctx.engine.onUpdate(this.tmplUpdateCb)
    }
    // Auto-fill skills from profile when slots are all empty (soft hint -- VFX still usable without character)
    if (this.st.skills.every(s => !s.effectId)) { this.st.skills = autoMatchSkills(readCharacterProfile()); this.save() }
    this.render()
    // Scroll to top each time the VFX tab opens so newly-added top effects are visible
    if (this.left) {
      this.left.scrollTop = 0
      const vp = this.left.querySelector('.vp') as HTMLElement | null
      if (vp) vp.scrollTop = 0
    }
  }

  unmount(): void { this.stopLoop(); if (this._posUpdateTimer) { clearInterval(this._posUpdateTimer); this._posUpdateTimer = null }; this.save(); this.left = null; this.panels = null }
  dispose(): void {
    this.stopLoop()
    if (this.updateCb && this.ctx) { this.ctx.engine.removeUpdate(this.updateCb); this.updateCb = null }
    if (this.tmplUpdateCb && this.ctx) { this.ctx.engine.removeUpdate(this.tmplUpdateCb); this.tmplUpdateCb = null }
    if (this.gameFeelCb && this.ctx) { this.ctx.engine.removeUpdate(this.gameFeelCb); this.gameFeelCb = null }
    this.gameFeel = null
    this._disposeDemoTargets()
    this.tmplInstances.forEach(t => t.dispose()); this.tmplInstances = []
    if (this.vfxGroup) {
      this.vfxGroup.parent?.remove(this.vfxGroup)
      this.vfxGroup = null
    }
    this.unsub?.(); this.vfx?.dispose(); this.vfx = null; this.save()
  }

  private refresh(): void { if (this.left && this.panels && this.ctx) this.mount(this.left, this.panels, this.ctx) }

  // ── Demo targeting: three rotating geometry enemies ─────────────────────────

  /**
   * Create 3 demo enemies (box/sphere/octahedron), register them with
   * TargetAcquisitionSystem, and inject the system + damage-number callback
   * into VFXManager.
   */
  private _setupDemoTargets(ctx: PipelineContext): void {
    if (this._targeting || !this.vfx) return

    this._targeting = new TargetAcquisitionSystem(ctx.engine.scene)

    // Damage float numbers (bound to canvas parent container)
    const canvasParent = ctx.engine.renderer.domElement.parentElement
    if (canvasParent) {
      this._dmgNumbers = new DamageNumber(canvasParent)
    }

    // 3 geometry types + colors + positions (fan-spread in front of character)
    const defs: { geo: THREE.BufferGeometry; color: number; pos: THREE.Vector3; hpRatio: number; threat: number }[] = [
      {
        geo:     new THREE.BoxGeometry(0.55, 0.55, 0.55),
        color:   0xcc3322,   // dark red -- melee trooper
        pos:     new THREE.Vector3(-2.2, 0.55, -2.0),
        hpRatio: 0.8,
        threat:  3,
      },
      {
        geo:     new THREE.SphereGeometry(0.35, 12, 8),
        color:   0xdd6600,   // orange -- magic orb
        pos:     new THREE.Vector3(0.0, 0.55, -3.2),
        hpRatio: 0.5,
        threat:  6,
      },
      {
        geo:     new THREE.OctahedronGeometry(0.42),
        color:   0x882299,   // purple -- boss elemental
        pos:     new THREE.Vector3(2.2, 0.55, -2.0),
        hpRatio: 0.3,
        threat:  9,
      },
    ]

    defs.forEach((d, i) => {
      const mat  = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.6, metalness: 0.3, emissive: d.color, emissiveIntensity: 0.15 })
      const mesh = new THREE.Mesh(d.geo, mat)
      mesh.position.copy(d.pos)
      mesh.castShadow = true
      mesh.name = `__demo_enemy_${i}`
      ctx.engine.scene.add(mesh)
      this._demoMeshes.push(mesh)

      this._targeting!.addTarget({
        id:       `demo-${i}`,
        position: d.pos.clone(),
        height:   1.2,
        relation: 'enemy',
        hpRatio:  d.hpRatio,
        threat:   d.threat,
        lockable: true,
      })
    })

    // Inject into VFXManager
    this.vfx.setTargetSystem(this._targeting)

    // Damage number callback: render floating numbers above target world position
    this.vfx.setHitTargetCallback((targetId, dmg, isCrit, worldPos) => {
      if (!this._dmgNumbers || !ctx.engine.camera) return
      // Project to screen coordinates
      const v = worldPos.clone().project(ctx.engine.camera)
      const canvas = ctx.engine.renderer.domElement as HTMLCanvasElement
      if (!canvas) return
      const sw = canvas.clientWidth
      const sh = canvas.clientHeight
      const sx = (v.x * 0.5 + 0.5) * sw
      const sy = (-v.y * 0.5 + 0.5) * sh
      this._dmgNumbers.spawn({
        value:   dmg,
        type:    isCrit ? 'critical' : 'skill',
        screenX: sx,
        screenY: sy,
      })
      // Visually reduce HP ratio by damage amount
      const maxHp = 5000
      const info = this._targeting?.allTargets.find(t => t.id === targetId)
      if (info) {
        info.hpRatio = Math.max(0, info.hpRatio - dmg / maxHp)
        this._targeting?.updateTarget(targetId, { hpRatio: info.hpRatio })
      }
    })
  }

  /** Per-frame: rotate targets + update lock effects */
  private _updateDemoTargets(dt: number, ctx: PipelineContext): void {
    if (!this._targeting || this._demoMeshes.length === 0) return
    const axes: [number, number, number][] = [
      [0.8, 1.2, 0.3],   // box: mostly Y-axis with slight tilt
      [0.3, 0.5, 0.8],   // sphere: XZ tumble
      [1.0, 0.7, 1.0],   // octahedron: even spin
    ]
    this._demoMeshes.forEach((m, i) => {
      const a = axes[i] ?? [1, 1, 1]
      m.rotation.x += a[0] * dt
      m.rotation.y += a[1] * dt
      m.rotation.z += a[2] * dt
      // Sync TargetInfo position (targets are stationary but kept in sync)
      this._targeting?.updateTarget(`demo-${i}`, { position: m.position.clone() })
    })
    const charPos = (ctx.engine.camera as any)?.position as THREE.Vector3 | undefined
    this._targeting.update(dt, ctx.engine.camera, charPos)
    this._dmgNumbers?.cleanup()
  }

  /** Dispose demo targets and targeting system */
  private _disposeDemoTargets(): void {
    if (this._targeting) {
      this._targeting.dispose()
      this._targeting = null
    }
    if (this.ctx) {
      for (const m of this._demoMeshes) {
        this.ctx.engine.scene.remove(m)
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    }
    this._demoMeshes = []
    this._dmgNumbers = null
    this.vfx?.setTargetSystem(null)
    this.vfx?.setHitTargetCallback(null)
  }

  // ════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════

  private render(): void {
    if (!this.left) return
    const oldVp = this.left.querySelector('.vp') as HTMLElement | null
    const savedScroll = oldVp?.scrollTop ?? this.left.scrollTop
    this.left.innerHTML = ''
    const root = mk('div', 'vp')

    root.appendChild(this.renderSidebarHeader())

    // Character status banner
    root.appendChild(this.renderCharacterBanner())
    const configuredCount = this.st.skills.filter(s => s.effectId).length
    const slotBody = this.workflowBody(root, '1', '技能槽配置', `${configuredCount}/${this.st.skills.length} 个技能已绑定`, true)
    const effectBody = this.workflowBody(root, '2', '特效选择', '按类型选择模板并绑定到默认技能槽')
    const debugBody = this.workflowBody(root, '3', '参数调试', '高级手感、命中、轨迹和挂点调试')
    debugBody.classList.add('vp-debug-body')
    const aiBody = this.workflowBody(root, '4', 'AI 生成与技能包', '自然语言生成、保存和复用技能包')

    // Top quick-action bar (two rows):
    //   Row 1 (primary, enlarged): Auto-match -> Import to game -- highest frequency for new users.
    //   Row 2 (secondary, small):  Default assign / Sync from game / Play all / Stop.
    const bar = mk('div', 'vp-btn-row vp-btn-row-primary')
    // NOTE: "Auto-match" reads profile from localStorage (single slot storage --
    // designing a new character in wb-character overwrites it, so the 6 slots will
    // be rewritten to the new character's template on next click).
    bar.appendChild(this.btn('自动匹配技能', 'accent xl', () => {
      this.st.skills = autoMatchSkills(readCharacterProfile()); this.save(); this.render()
    }))
    // Import to game: downgrade st.skills into manifest.skills[] and merge.
    // Prerequisite: character must have been published via pixel-char pipeline first
    // (skills need to bind to actionIds).
    bar.appendChild(this.btn('导入到游戏', 'primary xl', () => void this.onClickPublishVfxToGame()))
    slotBody.appendChild(bar)

    const bar2 = mk('div', 'vp-btn-row vp-btn-row-secondary')
    // Default assign: fill all 6 slots by each effect's defaultSlot field.
    // Does not depend on profile, so switching characters does not change it.
    bar2.appendChild(this.btn('默认绑定', '', () => {
      for (const sk of this.st.skills) {
        const def = EFFECTS.find(d => d.defaultSlot === sk.id)
        if (def) { sk.effectId = def.id; sk.effectLabel = def.label; sk.isAIGenerated = false }
      }
      this.save(); this.render(); toast('已按默认方案绑定 6 个技能')
    }))
    // Sync from game: reverse-map the currently published character.manifest.json.skills[]
    // back into editor SkillSlots so the user can see "what is actually in game right now".
    bar2.appendChild(this.btn('从游戏同步', '', () => void this.onClickPullFromGame()))
    bar2.appendChild(this.btn('全部预览', '', () => this.playAll()))
    if (this.activeEffect || this.toggleOn.size > 0) {
      bar2.appendChild(this.btn('全部停止', '', () => {
        this.stopLoop(); this.activeEffect = null; this.toggleOn.clear(); this.render()
      }))
    }
    slotBody.appendChild(bar2)

    // AI template effect generation section
    aiBody.appendChild(this.renderAITemplateSection())

    // Game-feel parameters section
    debugBody.appendChild(this.renderGameFeelSection())

    // All effect modules (grouped, each group collapsible)
    let lastGroup = ''
    let groupContainer: HTMLElement | null = null
    let curTheme = DEFAULT_THEME
    for (const def of EFFECTS) {
      try {
        if (def.group !== lastGroup) {
          lastGroup = def.group
          curTheme = GROUP_THEMES[def.group] ?? DEFAULT_THEME
          const isGroupOpen = !this.collapsed.has(def.group)

          const grpHdr = mk('div', 'vp-gh')
          grpHdr.style.cssText = `background:${curTheme.bg};border-left:3px solid ${curTheme.dot};`
          grpHdr.innerHTML = `<span class="vp-gh-dot" style="background:${curTheme.dot}"></span><span class="vp-gh-label" style="color:${curTheme.text}">${GROUP_LABELS[def.group] ?? def.group}</span><span class="vp-gh-count" style="color:${curTheme.text}">${EFFECTS.filter(e => e.group === def.group).length}</span><span class="vp-shv" style="color:${curTheme.text}">${isGroupOpen ? '▾' : '▸'}</span>`
          grpHdr.addEventListener('click', () => {
            this.collapsed.has(def.group) ? this.collapsed.delete(def.group) : this.collapsed.add(def.group)
            this.render()
          })
          effectBody.appendChild(grpHdr)

          groupContainer = isGroupOpen ? mk('div', 'vp-grp-body') : null
          if (groupContainer) {
            groupContainer.style.borderLeft = `3px solid ${curTheme.border}`
            groupContainer.style.marginLeft = '0'
            groupContainer.style.background = curTheme.cardBg
            effectBody.appendChild(groupContainer)
          }
        }

        if (!groupContainer) continue

        const isAct = this.activeEffect === def.id
        const isTog = this.toggleOn.has(def.id)
        const card = mk('div', `vp-ecard${isAct ? ' act' : ''}${isTog ? ' tog' : ''}`)
        if (isAct) card.style.borderColor = curTheme.dot
        if (isTog) card.style.borderColor = '#55cc88'

        const head = mk('div', 'vp-ecard-head')
        if (isAct) head.style.background = curTheme.bg
        const iconEl = mk('span', 'vp-ei'); iconEl.textContent = def.icon
        const nameEl = mk('span', 'vp-en'); nameEl.textContent = EFFECT_LABELS[def.id] ?? def.label
        head.appendChild(iconEl)
        head.appendChild(nameEl)

        if (!def.toggleable && isAct) {
          const lp = mk('span', 'vp-looping'); lp.textContent = '循环'; head.appendChild(lp)
        }
        if (def.toggleable) {
          const bd = mk('span', 'vp-badge')
          bd.textContent = isTog ? '已开启' : '已关闭'
          if (isTog) bd.style.cssText = 'background:rgba(100,255,100,.15);color:#55cc88;'
          else bd.style.cssText = `background:${curTheme.bg};color:${curTheme.text};`
          head.appendChild(bd)
        }

        const playBtn = document.createElement('button')
        playBtn.className = `vp-btn${isAct || isTog ? ' accent' : ''}`
        playBtn.style.cssText = 'padding:2px 8px;font-size:10px;flex-shrink:0;min-width:40px;'
        if (isAct || isTog) playBtn.style.cssText += `background:${curTheme.dot};border-color:${curTheme.dot};`
        playBtn.textContent = def.toggleable ? (isTog ? '关闭' : '开启') : (isAct ? '重播' : '预览')
        playBtn.addEventListener('click', e => { e.stopPropagation(); this.selectEffect(def) })
        head.appendChild(playBtn)

        // Down-arrow button: always assigns to this effect's defaultSlot, not activeSlot.
        // If activeSlot matches defaultSlot, show a star to indicate alignment.
        const targetSlotId = def.defaultSlot
        const targetSkill  = this.st.skills.find(s => s.id === targetSlotId)
        const targetLabel  = SLOT_META.find(m => m.id === targetSlotId)?.label ?? targetSlotId
        const activeMatches = this.st.skills[this.st.activeSlot]?.id === targetSlotId

        const assBtn = document.createElement('button')
        assBtn.className = 'vp-btn'
        assBtn.style.cssText = 'padding:2px 6px;font-size:9px;flex-shrink:0;opacity:.8;'
        assBtn.textContent = activeMatches ? '绑定★' : '绑定'
        assBtn.title = `绑定到「${SLOT_LABELS[targetSlotId] ?? targetLabel}」`
        assBtn.addEventListener('click', e => {
          e.stopPropagation()
          if (!targetSkill) { toast(`未找到技能槽 ${targetSlotId}`); return }
          targetSkill.effectId = def.id
          targetSkill.effectLabel = def.label
          targetSkill.isAIGenerated = false
          // Also switch activeSlot to the target so the right panel focuses the assigned skill.
          this.st.activeSlot = this.st.skills.findIndex(s => s.id === targetSlotId)
          this.save(); toast(`${EFFECT_LABELS[def.id] ?? def.label} -> ${SLOT_LABELS[targetSlotId] ?? targetLabel}`)
          this.render()
        })
        head.appendChild(assBtn)

        card.appendChild(head)

        if (def.hasParams) {
          try {
            card.appendChild(this.buildParams(def.id))
          } catch (e) {
            console.error(`[VFX_DEBUG] buildParams error for "${def.id}":`, e)
          }
        }

        ;(groupContainer ?? root).appendChild(card)
      } catch (e) {
        console.error(`[VFX_DEBUG] render error for "${def.id}":`, e)
      }
    }

    // Skill slots section (expanded by default)
    slotBody.appendChild(this.sectionHeader('技能槽', 'slots'))
    if (!this.collapsed.has('slots')) {
      const profile = readCharacterProfile()
      const info = mk('div', 'vp-info')
      info.textContent = `${profile.name || '未命名角色'} · ${profile.charClass || '未设定职业'} · ${profile.worldSetting || '默认世界观'} · ${profile.combatType === 'ranged' ? '远程' : '近战'}`
      slotBody.appendChild(info)
      for (let i = 0; i < this.st.skills.length; i++) {
        const sk = this.st.skills[i], meta = SLOT_META[i], isSel = this.st.activeSlot === i
        const tmpl = EFFECT_TEMPLATES.find(t => t.id === sk.effectId)
        const displayName = sk.name === meta.label ? (SLOT_LABELS[meta.id] ?? sk.name) : sk.name
        const card = mk('div', `vp-card${isSel ? ' sel' : ''}`)
        card.innerHTML = `
          <div class="vp-card-head">
            <span class="vp-card-icon">${meta.icon}</span>
            <input class="vp-card-name" value="${displayName}" data-i="${i}" />
            <span class="vp-card-effect">${tmpl ? `${tmpl.icon} ${EFFECT_LABELS[tmpl.id] ?? tmpl.label}` : '未绑定'}</span>
            <button class="vp-card-play" ${sk.effectId ? '' : 'disabled'} title="预览">▶</button>
            <button class="vp-card-clear" ${sk.effectId ? '' : 'disabled'} title="清空">✕</button>
          </div>
        `
        const nameInp = card.querySelector('.vp-card-name') as HTMLInputElement
        nameInp.addEventListener('change', () => { sk.name = nameInp.value; this.save() })
        nameInp.addEventListener('click', e => e.stopPropagation())
        card.querySelector('.vp-card-play')?.addEventListener('click', e => { e.stopPropagation(); this.playSkill(i) })
        card.querySelector('.vp-card-clear')?.addEventListener('click', e => {
          e.stopPropagation(); sk.effectId = ''; sk.effectLabel = ''; this.save(); this.render()
        })
        card.addEventListener('click', () => { this.st.activeSlot = i; this.render() })
        slotBody.appendChild(card)
      }
    }

    // Skill packs section (collapsed by default)
    aiBody.appendChild(this.sectionHeader('技能包', 'packs'))
    if (!this.collapsed.has('packs')) {
      const sec = mk('div', 'vp-sec')
      sec.appendChild(this.btn('保存为技能包', 'accent', () => this.savePack()))
      for (const pk of this.st.packs) {
        const r = mk('div', `vp-pkrow${pk.id === this.st.activePack ? ' act' : ''}`)
        r.innerHTML = `<div class="vp-pkinfo"><b>${pk.name}</b><span>${pk.profession} · ${pk.skills.filter(s => s.effectId).length} 个技能</span></div>`
        const loadB = mk('button', 'vp-pkbtn'); loadB.textContent = '载入'
        loadB.addEventListener('click', () => { this.st.skills = JSON.parse(JSON.stringify(pk.skills)); this.st.activePack = pk.id; this.save(); this.render(); toast(`已载入 ${pk.name}`) })
        const delB = mk('button', 'vp-pkbtn del'); delB.textContent = '✕'
        delB.addEventListener('click', () => { this.st.packs = this.st.packs.filter(x => x.id !== pk.id); this.save(); this.render() })
        r.appendChild(loadB); r.appendChild(delB); sec.appendChild(r)
      }
      aiBody.appendChild(sec)
    }

    // AI assistant section (collapsed by default)
    aiBody.appendChild(this.sectionHeader('AI 助手 (Gemini 3.0 Pro)', 'chat'))
    if (!this.collapsed.has('chat')) {
      const sec = mk('div', 'vp-sec vp-chat')
      const log = mk('div', 'vp-chatlog'); log.id = 'vp-chatlog'
      for (const m of this.chatHistory) { const b = mk('div', `vp-msg ${m.role}`); b.textContent = m.text; log.appendChild(b) }
      sec.appendChild(log)
      const irow = mk('div', 'vp-chatrow')
      const ta = document.createElement('textarea'); ta.className = 'vp-chatin'; ta.placeholder = '描述你想要的特效...'; ta.rows = 2
      const send = mk('button', 'vp-btn accent'); send.textContent = '发送'
      send.addEventListener('click', () => this.chat(ta))
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.chat(ta) } })
      irow.appendChild(ta); irow.appendChild(send); sec.appendChild(irow)
      aiBody.appendChild(sec)
    }

    this.left.appendChild(root)
    root.scrollTop = savedScroll
  }

  // ── UI helpers ──

  private sectionHeader(text: string, key: string | null, collapsible = true): HTMLElement {
    const h = mk('div', `vp-sh${key && !this.collapsed.has(key) ? ' open' : ''}`)
    h.innerHTML = `<span>${text}</span>${collapsible ? `<span class="vp-shv">${key && this.collapsed.has(key!) ? '▶' : '▼'}</span>` : ''}`
    if (collapsible && key) h.addEventListener('click', e => {
      e.stopPropagation()
      if (this.collapsed.has(key)) this.collapsed.delete(key); else this.collapsed.add(key)
      this.render()
    })
    return h
  }

  private workflowBody(root: HTMLElement, step: string, title: string, summary: string, open = false): HTMLElement {
    const card = document.createElement('details')
    card.className = 'vp-workflow-card'
    if (open || this.workflowOpen.has(step)) card.open = true
    card.addEventListener('toggle', () => {
      if (card.open) this.workflowOpen.add(step)
      else this.workflowOpen.delete(step)
    })
    const head = document.createElement('summary')
    head.className = 'vp-workflow-head'
    const titleEl = document.createElement('span')
    titleEl.className = 'vp-workflow-title'
    const stepEl = document.createElement('span')
    stepEl.className = 'vp-step'
    stepEl.textContent = step
    const nameEl = document.createElement('span')
    nameEl.textContent = title
    titleEl.append(stepEl, nameEl)
    const caret = document.createElement('span')
    caret.className = 'vp-workflow-caret'
    caret.textContent = '⌄'
    head.append(titleEl, caret)
    const summaryEl = document.createElement('div')
    summaryEl.className = 'vp-workflow-summary'
    summaryEl.textContent = summary
    const body = document.createElement('div')
    body.className = 'vp-workflow-body'
    card.append(head, summaryEl, body)
    root.appendChild(card)
    return body
  }

  private btn(text: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = mk('button', `vp-btn ${cls}`) as HTMLButtonElement; b.textContent = text
    b.addEventListener('click', fn); return b
  }

  // ── Params ──

  private buildParams(eid: string): HTMLElement {
    if (!this.vfx) return mk('div', '')
    const p = this.vfx.params, w = mk('div', 'vp-par')
    const a = (l: string, mn: number, mx: number, s: number, v: number, cb: (n: number) => void) => w.appendChild(sld(l, mn, mx, s, v, cb))
    switch (eid) {
      case 'attack':
        w.appendChild(sel('Element', [{ v: '', l: '默认' }, { v: 'fire', l: '火焰' }, { v: 'ice', l: '冰霜' }, { v: 'magic', l: '魔法' }, { v: 'plant', l: '植物' }, { v: 'light', l: '光明' }], p.slash.elementOverride, v => { p.slash.elementOverride = v as ElementKey | '' }))
        a('Glow',    0.2, 4,   0.1,  p.slash.glowScale,   v => { p.slash.glowScale   = v })
        a('Mix',     0,   1,   0.05, p.slash.colorMix,    v => { p.slash.colorMix    = v })
        a('Radius',  0.4, 2.5, 0.05, p.slash.radiusScale, v => { p.slash.radiusScale = v })
        a('Speed',   0.3, 2.5, 0.05, p.slash.speedScale,  v => { p.slash.speedScale  = v })
        a('Parts',   0.2, 3,   0.1,  p.slash.particleMult, v => { p.slash.particleMult = v }); break
      case 'starblade':
        a('Charge', 0.3, 3,  0.1,  p.starBlade.chargeDuration, v => { p.starBlade.chargeDuration = v })
        a('Width',  0.2, 2,  0.05, p.starBlade.bladeWidth,     v => { p.starBlade.bladeWidth     = v })
        a('Height', 2,   12, 0.5,  p.starBlade.bladeHeight,    v => { p.starBlade.bladeHeight    = v })
        a('Drop',   5,   25, 1,    p.starBlade.fallHeight,     v => { p.starBlade.fallHeight     = v }); break
      case 'poison':
        a('Speed', 3,  18, 0.5, p.poison.speed,        v => { p.poison.speed        = v })
        a('Pool',  1,  12, 0.5, p.poison.poolDuration, v => { p.poison.poolDuration = v }); break
      case 'shield':
        a('Scale',  0.5, 2.5, 0.05, p.shield.scale,      v => { p.shield.scale      = v })
        a('Grid',   1,   8,   0.1,  p.shield.gridScale,  v => { p.shield.gridScale  = v })
        a('Flow',   0.2, 4,   0.1,  p.shield.flowSpeed,  v => { p.shield.flowSpeed  = v })
        a('Bright', 0.2, 3,   0.05, p.shield.brightness, v => { p.shield.brightness = v })
        a('Hue',    0,   1,   0.01, p.shield.hue,        v => { p.shield.hue        = v }); break
      case 'heal':
        a('Radius', 0.5, 4,   0.1,  p.healAura.radius,    v => { p.healAura.radius    = v })
        a('Speed',  0.3, 6,   0.1,  p.healAura.speed,     v => { p.healAura.speed     = v })
        a('Hue',    0,   1,   0.01, p.healAura.hue,       v => { p.healAura.hue       = v })
        a('Bright', 0.3, 3,   0.05, p.healAura.intensity, v => { p.healAura.intensity = v }); break
      case 'dissolve-out': case 'dissolve-in':
        a('Dur', 0.5, 4, 0.1, p.dissolve.duration, v => { p.dissolve.duration = v }); break
      case 'ice':
        a('Speed',  5,   20, 0.5, p.ice.speed,            v => { p.ice.speed            = v })
        a('Freeze', 1,   10, 0.5, p.groundFrost.duration, v => { p.groundFrost.duration = v })
        a('Screen', 0.5, 8,  0.5, p.screenFrost.duration, v => { p.screenFrost.duration = v }); break
      case 'groundfrost': a('Dur', 1,   10, 0.5, p.groundFrost.duration, v => { p.groundFrost.duration = v }); break
      case 'screenfrost': a('Dur', 0.5, 8,  0.5, p.screenFrost.duration, v => { p.screenFrost.duration = v }); break
      case 'bigfireball':
        a('Charge',  0.1, 2,   0.05, p.bigFireball.chargeTime,        v => { p.bigFireball.chargeTime        = v })
        a('Radius',  0.3, 3,   0.1,  p.bigFireball.hitRadius,         v => { p.bigFireball.hitRadius         = v })
        a('Explode', 1,   7,   0.2,  p.bigFireball.explosionMaxScale, v => { p.bigFireball.explosionMaxScale = v })
        a('Flow',    0.3, 4,   0.1,  p.bigFireball.flowSpeed,         v => { p.bigFireball.flowSpeed         = v })
        a('Bright',  0.2, 2.0, 0.05, p.bigFireball.brightness,        v => { p.bigFireball.brightness        = v })
        a('Hue',     0.0, 1.0, 0.01, p.bigFireball.hue,               v => { p.bigFireball.hue               = v })
        a('Mix',     0.0, 1.0, 0.01, p.bigFireball.colorMix,          v => { p.bigFireball.colorMix          = v }); break
      case 'meteor':
        a('Warn',    0.5, 2.5, 0.1,  p.meteor.warningTime,   v => { p.meteor.warningTime   = v })
        a('Height',  15,  50,  1,    p.meteor.fallHeight,     v => { p.meteor.fallHeight    = v })
        a('Impact',  1,   6,   0.1,  p.meteor.impactRadius,  v => { p.meteor.impactRadius  = v })
        a('Explode', 0.3, 3,   0.1,  p.meteor.explosionScale, v => { p.meteor.explosionScale = v })
        a('Shock',   1,   12,  0.5,  p.meteor.shockwaveScale, v => { p.meteor.shockwaveScale = v })
        a('Smoke',   0.1, 2,   0.1,  p.meteor.smokeScale,    v => { p.meteor.smokeScale    = v })
        a('Shake',   0,   1,   0.05, p.meteor.traumaAmount,  v => { p.meteor.traumaAmount  = v })
        a('Flash',   0,   1,   0.05, p.meteor.flashIntensity, v => { p.meteor.flashIntensity = v })
        a('Burn',    1,   15,  0.5,  p.meteor.burnDuration,  v => { p.meteor.burnDuration  = v }); break
      case 'magiccannon':
        a('Charge', 0.3, 1.5, 0.05, p.magicCannon.chargeTime, v => { p.magicCannon.chargeTime = v })
        a('Width',  0.3, 2,   0.05, p.magicCannon.beamWidth,  v => { p.magicCannon.beamWidth  = v }); break
      case 'lightning': a('Charge', 0.5, 3, 0.1, p.lightning.chargeTime, v => { p.lightning.chargeTime = v }); break
      case 'vinestrike':
        a('Radius', 1,   4,   0.1, p.vineStrike.vineRadius, v => { p.vineStrike.vineRadius = v })
        a('Height', 1.5, 5,   0.1, p.vineStrike.vineHeight, v => { p.vineStrike.vineHeight = v }); break
      case 'weaponslash':
        a('Ring',     0.5, 3.0, 0.05, p.weaponSlash.ringRadius,  v => { p.weaponSlash.ringRadius  = v })
        a('Length',   0.5, 2.0, 0.05, p.weaponSlash.slashLength, v => { p.weaponSlash.slashLength = v })
        a('Vortex',   0.5, 2.0, 0.05, p.weaponSlash.vortexSize,  v => { p.weaponSlash.vortexSize  = v })
        a('Dur',      0.3, 1.2, 0.05, p.weaponSlash.duration,    v => { p.weaponSlash.duration    = v }); break
      case 'dashtrail':
        a('Scale',    0.3, 3.0, 0.05, p.dashTrail.scale,       v => { p.dashTrail.scale       = v })
        a('Streaks',  1,   7,   1,    p.dashTrail.streakCount, v => { p.dashTrail.streakCount  = v })
        a('MaxLen',   1.5, 6.0, 0.1,  p.dashTrail.maxLength,   v => { p.dashTrail.maxLength    = v })
        a('Dur',      0.2, 1.0, 0.05, p.dashTrail.duration,    v => { p.dashTrail.duration     = v }); break
    }
    return w
  }

  // ── Character banner ──────────────────────────────────────────────────────

  private renderSidebarHeader(): HTMLElement {
    const header = mk('div', 'vp-header')
    header.innerHTML = `
      <span class="vp-title">技能特效工作台</span>
      <span class="vp-header-pill">技能特效</span>
    `
    return header
  }

  private renderCharacterBanner(): HTMLElement {
    const profile  = readCharacterProfile()
    const hasChar  = hasCharacter()
    const adapter  = this.adapter
    const src      = adapter?.mountSource ?? 'static'
    const det      = adapter?.lastDetection
    const conf     = det?.confidence ?? 'static'
    const ratio    = adapter?.getDims().bodyRatio?.toFixed(1) ?? '-'
    const height   = adapter?.getDims().height?.toFixed(2) ?? '-'

    // CharPosTracker live state
    const tracked = hasTrackedSprite()
    const pos     = getCharWorldPos(0.5)
    const posStr  = pos ? `(${pos.x.toFixed(2)}, ${pos.z.toFixed(2)})` : '未跟踪'
    const trackerColor = tracked ? '#55cc88' : '#ff6655'

    const srcColor: Record<string, string> = {
      sprite:    '#55cc88',
      spine:     '#55cc88',
      geometric: '#55bbff',
      static:    '#aaaaaa',
    }
    const confBadge: Record<string, string> = {
      high:    '● 高',
      medium:  '◐ 中',
      low:     '○ 低',
      static:  '-',
    }

    const banner = mk('div', 'vp-char-banner')
    banner.innerHTML = `
      <div class="vp-cb-row">
        <span class="vp-cb-name">${hasChar ? (profile.name || '未命名') : '未检测到角色'}</span>
        <span class="vp-cb-class">${profile.charClass || '未设定职业'}</span>
        <span class="vp-cb-world">${profile.worldSetting || '默认世界观'}</span>
        <span class="vp-cb-type">${profile.combatType === 'ranged' ? '远程' : '近战'}</span>
      </div>
      <div class="vp-cb-row vp-cb-mount">
        <span style="color:${srcColor[src] ?? '#aaa'}">挂点源: ${src.toUpperCase()}</span>
        <span style="opacity:.7">置信度: ${confBadge[conf] ?? conf}</span>
        <span style="opacity:.7">比例: ${ratio}</span>
        <span style="opacity:.7">高度: ${height}u</span>
      </div>
      <div class="vp-cb-row" id="vp-pos-tracker" style="font-family:monospace;font-size:9px;gap:6px">
        <span style="color:${trackerColor}">● 位置跟踪: ${tracked ? '开启' : '关闭'}</span>
        <span style="opacity:.8">XZ: ${posStr}</span>
        ${!tracked ? `<span style="color:#ffaa33">请先把角色放入场景</span>` : ''}
      </div>
    `

    // Update position display every 500ms
    const updatePos = (): void => {
      const el = this.left?.querySelector('#vp-pos-tracker')
      if (!el) return
      const t = hasTrackedSprite()
      const p = getCharWorldPos(0.5)
      const s = p ? `(${p.x.toFixed(2)}, ${p.z.toFixed(2)})` : '未跟踪'
      const c = t ? '#55cc88' : '#ff6655'
      el.innerHTML = `
        <span style="color:${c}">● 位置跟踪: ${t ? '开启' : '关闭'}</span>
        <span style="opacity:.8">XZ: ${s}</span>
        ${!t ? `<span style="color:#ffaa33">请先把角色放入场景</span>` : ''}
      `
    }
    if (this._posUpdateTimer) clearInterval(this._posUpdateTimer)
    this._posUpdateTimer = setInterval(updatePos, 500)

    return banner
  }

  // ── AI template effect generation UI ────────────────────────────────────────

  private renderAITemplateSection(): HTMLElement {
    const sec = mk('div', 'vp-tmpl-sec')

    // Collapsible header
    const isOpen = !this.collapsed.has('ai-tmpl')
    const hdr = mk('div', 'vp-sh')
    hdr.innerHTML = `<span>AI 模板特效生成器</span><span class="vp-shv">${isOpen ? '▾' : '▸'}</span>`
    hdr.addEventListener('click', e => {
      e.stopPropagation()
      this.collapsed.has('ai-tmpl') ? this.collapsed.delete('ai-tmpl') : this.collapsed.add('ai-tmpl')
      this.render()
    })
    sec.appendChild(hdr)
    if (!isOpen) return sec

    const body = mk('div', 'vp-sec')

    // Description textarea
    const ta = document.createElement('textarea')
    ta.className = 'vp-chatin'
    ta.rows = 2
    ta.placeholder = '描述技能特效，例如：地狱火爆破、巨大范围爆炸'
    ta.style.cssText = 'width:100%;box-sizing:border-box;resize:none;'
    body.appendChild(ta)

    // Generate button row
    const btnRow = mk('div', 'vp-btn-row')

    const genBtn = document.createElement('button')
    genBtn.className = 'vp-btn accent'
    genBtn.textContent = this.tmplGenerating ? '生成中...' : 'AI 生成'
    genBtn.disabled = this.tmplGenerating
    genBtn.addEventListener('click', async () => {
      const desc = ta.value.trim()
      if (!desc) { toast('请先描述想要的特效'); return }
      this.tmplGenerating = true; this.render()
      const res = await generateFromDescription(desc)
      console.log('[VFX Compose] AI result:', JSON.stringify(res, null, 2))
      this.tmplGenerating = false
      if (!res.success) {
        toast(`${res.error || '生成失败'}`); this.render(); return
      }
      if (res.mode === 'compose') {
        if (!res.components) { toast('组合结果缺少组件'); this.render(); return }
        this.lastTmplResult = {
          mode: 'compose',
          label: res.label ?? '组合特效',
          components: res.components as Record<string, ComponentInstanceConfig>,
          attackDir: res.attackDir,
        }
      } else {
        if (!res.template || !res.params) { toast('响应格式无效'); this.render(); return }
        this.lastTmplResult = {
          mode: 'template',
          template: res.template,
          label: res.label ?? res.template,
          params: res.params,
        }
      }
      this.spawnLastTemplate()
      this.render()
      toast(`已生成: ${this.lastTmplResult.label}`)
    })
    btnRow.appendChild(genBtn)

    if (this.lastTmplResult) {
      const replayBtn = document.createElement('button')
      replayBtn.className = 'vp-btn'
      replayBtn.textContent = '重播'
      replayBtn.addEventListener('click', () => this.spawnLastTemplate())
      btnRow.appendChild(replayBtn)
    }
    body.appendChild(btnRow)

    // Last result preview
    if (this.lastTmplResult) {
      const r = this.lastTmplResult
      const isCompose = r.mode === 'compose'
      const meta = isCompose ? null : TEMPLATE_REGISTRY.find(t => t.id === r.template)
      const card = mk('div', 'vp-tmpl-card')
      // compose mode: show component list; template mode: show params
      const modeTag = isCompose
        ? `<span style="font-size:9px;color:#a78bfa;margin-left:auto">组合</span>`
        : `<span style="font-size:9px;color:var(--accent);margin-left:auto">${r.template}</span>`
      const paramLine = (!isCompose && r.params)
        ? `<div style="font-size:9px;color:var(--text-secondary);line-height:1.5">
            缩放 <b style="color:var(--accent)">${r.params.scale}</b> ·
            时长 <b style="color:var(--accent)">${r.params.duration}</b> ·
            强度 <b style="color:var(--accent)">${r.params.intensity}</b>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle;margin-left:4px;background:rgb(${r.params.primaryColor.map(v=>Math.round(v*255)).join(',')})"></span>
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:middle;margin-left:2px;background:rgb(${r.params.secondaryColor.map(v=>Math.round(v*255)).join(',')})"></span>
           </div>`
        : `<div style="font-size:9px;color:var(--text-secondary);line-height:1.5">
            ${Object.keys(r.components ?? {}).join(' · ')}
           </div>`
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
          <span style="font-size:16px">${meta?.emoji ?? '✨'}</span>
          <span style="font-size:11px;font-weight:600;color:var(--text-primary)">${r.label}</span>
          ${modeTag}
        </div>
        ${paramLine}
      `
      // Assign to current skill slot (template mode only)
      if (!isCompose) {
        const assignBtn = document.createElement('button')
        assignBtn.className = 'vp-pkbtn'
        assignBtn.textContent = `绑定到「${this.st.skills[this.st.activeSlot]?.name ?? '技能'}」`
        assignBtn.style.cssText = 'margin-top:6px;width:100%;'
        assignBtn.addEventListener('click', () => {
          const sk = this.st.skills[this.st.activeSlot]
          if (!sk) return
          sk.effectId = `tmpl:${r.template}`
          sk.tmplParams = r.params
          this.save(); this.render()
          toast(`已绑定「${r.label}」->「${sk.name}」`)
        })
        card.appendChild(assignBtn)
      }
      body.appendChild(card)

      // Parameter tuning panel (live sliders, template mode only)
      const tuneWrap = mk('div', 'vp-par')
      tuneWrap.style.cssText = 'border-radius:4px;margin-top:4px;'

      // Debounce replay: auto-replay 300ms after slider change
      let _replayTimer = 0
      const scheduleReplay = () => {
        clearTimeout(_replayTimer)
        _replayTimer = window.setTimeout(() => this.spawnLastTemplate(), 280)
      }

      const addP = (label: string, min: number, max: number, step: number, key: keyof TemplateParams) => {
        if (!r.params) return
        const cur = (r.params as unknown as Record<string, number>)[key as string] ?? min
        tuneWrap.appendChild(sld(label, min, max, step, cur, v => {
          if (this.lastTmplResult?.params) {
            ;(this.lastTmplResult.params as unknown as Record<string, number>)[key as string] = v
          }
          scheduleReplay()
        }))
      }

      if (!isCompose) {
        addP('缩放', 0.3, 3.0, 0.1, 'scale')
        addP('时长', 0.5, 2.5, 0.1, 'duration')
        addP('强度', 0.3, 2.0, 0.1, 'intensity')
        if (r.params?.crackCount    !== undefined) addP('裂纹', 4,  14, 1, 'crackCount')
        if (r.params?.particleCount !== undefined) addP('粒子', 8,  48, 2, 'particleCount')
        body.appendChild(tuneWrap)
      }
    }

    sec.appendChild(body)
    return sec
  }

  // ── Game-feel parameter panel ────────────────────────────────────────────────

  private renderGameFeelSection(): HTMLElement {
    const KEY = 'game-feel'
    const isOpen = !this.collapsed.has(KEY)
    const sec = mk('div', 'vp-tmpl-sec')

    const hdr = mk('div', 'vp-sh')
    hdr.style.cssText = 'font-size:11px;font-weight:700;cursor:pointer;'
    hdr.innerHTML = `<span>打击手感</span><span class="vp-shv" style="font-size:10px">${isOpen ? '▾' : '▸'}</span>`
    hdr.addEventListener('click', e => {
      e.stopPropagation()
      this.collapsed.has(KEY) ? this.collapsed.delete(KEY) : this.collapsed.add(KEY)
      this.render()
    })
    sec.appendChild(hdr)
    if (!isOpen) return sec

    const body = mk('div', 'vp-grp-body')
    body.style.cssText = 'padding:4px 0;'

    // Multiplier reference info for users
    const gameFeelTip = mk('div', '')
    gameFeelTip.style.cssText = 'font-size:9px;color:var(--text-secondary);padding:2px 4px 6px;line-height:1.4;'
    gameFeelTip.textContent = '普通斩击 x0.3 · 连击 x0.35-0.55 · 重击/陨石/炮击/闪电/爆破 x1.0 · 受击 x0.75'
    body.appendChild(gameFeelTip)

    const cfg = this.gameFeelCfg

    const mkSld = (label: string, min: number, max: number, step: number, key: keyof GameFeelConfig) => {
      body.appendChild(sld(label, min, max, step, cfg[key], (v) => {
        cfg[key] = v
        // Sync to GameFeelSystem in real-time (no re-render needed)
        if (this.gameFeel) this.gameFeel.config = cfg
      }))
    }

    // Usage tip
    const tip = mk('div', '')
    tip.style.cssText = 'font-size:9px;color:var(--text-secondary);padding:2px 4px 6px;line-height:1.6;'
    tip.textContent = '触发任意特效后生效。全部设为 0 可关闭打击手感。'
    body.appendChild(tip)

    mkSld('闪光', 0,    1.0,  0.05, 'flashIntensity')
    mkSld('闪光时长', 0.05, 0.4, 0.01, 'flashDuration')
    mkSld('震屏', 0,    0.30, 0.01, 'shakeAmplitude')
    mkSld('震屏时长', 0.05, 0.5, 0.01, 'shakeDuration')
    mkSld('辉光', 0,    0.50, 0.02, 'bloomBoost')

    // Quick preset buttons
    const presets = mk('div', '')
    presets.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-top:6px;padding:0 2px;'

    const applyPreset = (label: string, c: GameFeelConfig) => {
      const b = document.createElement('button')
      b.className = 'vp-pkbtn'; b.textContent = label
      b.style.cssText = 'flex:1;min-width:60px;font-size:9px;'
      b.addEventListener('click', () => {
        this.gameFeelCfg = { ...c }
        if (this.gameFeel) this.gameFeel.config = this.gameFeelCfg
        this.render()
      })
      presets.appendChild(b)
    }

    applyPreset('关闭', { shakeAmplitude:0,    shakeDuration:0.18, bloomBoost:0,    flashIntensity:0,    flashDuration:0.16 })
    applyPreset('轻量', { shakeAmplitude:0.03, shakeDuration:0.15, bloomBoost:0.06, flashIntensity:0.20, flashDuration:0.14 })
    applyPreset('标准', { ...DEFAULT_GAMEFEEL })
    applyPreset('重击', { shakeAmplitude:0.14, shakeDuration:0.28, bloomBoost:0.22, flashIntensity:0.55, flashDuration:0.20 })

    body.appendChild(presets)
    sec.appendChild(body)
    return sec
  }

  private spawnLastTemplate(): void {
    if (!this.lastTmplResult || !this.ctx) return
    // y=0.2: safe ground anchor, avoids depth conflict with 3D floor
    const pos  = new THREE.Vector3(0, 0.2, 0)
    const scene = this.ctx.engine.scene
    let inst: ITemplate | null = null

    if (this.lastTmplResult.mode === 'compose' && this.lastTmplResult.components) {
      inst = composeEffect(
        scene, pos,
        {
          components: this.lastTmplResult.components,
          attackDir:  this.lastTmplResult.attackDir ?? [1, 0],
        },
        this.lastTmplResult.params?.scale,
        this.lastTmplResult.params?.duration,
        this.lastTmplResult.params?.intensity,
        { onImpact: () => this.gameFeel?.triggerImpact() },
      )
    } else if (this.lastTmplResult.template && this.lastTmplResult.params) {
      inst = spawnTemplate(scene, this.lastTmplResult.template, this.lastTmplResult.params, pos)
      // Template mode: trigger game-feel immediately on spawn
      this.gameFeel?.triggerImpact()
    }

    if (inst) this.tmplInstances.push(inst)
  }

  // ── Effect selection + loop play ──

  private selectEffect(def: EffectDef): void {
    this.stopLoop()

    if (def.toggleable) {
      if (this.toggleOn.has(def.id)) { this.toggleOn.delete(def.id); this.deactivateEffect(def) }
      else { this.toggleOn.add(def.id); this.fireEffect(def) }
      this.activeEffect = def.id
      this.render()
      return
    }

    if (this.activeEffect === def.id) {
      this.activeEffect = null
      this.render()
      return
    }

    this.activeEffect = def.id
    this.fireEffect(def)
    this.loopTimer = setInterval(() => { if (this.vfx) this.fireEffect(def) }, 3000)
    this.render()
  }

  private stopLoop(): void {
    if (this.loopTimer) { clearInterval(this.loopTimer); this.loopTimer = null }
  }

  private renderSlots(): void {
    const slotsContainer = this.left?.querySelector('.vp-slots')
    if (slotsContainer) {
      this.render()
    }
  }

  // ── Actions ──

  private playSkill(i: number): void {
    if (!this.vfx || !this.ctx) return
    const sk = this.st.skills[i]; if (!sk?.effectId) return
    // Template effect (y=0.2: safe visible anchor above 3D floor, avoids Z-fighting)
    if (sk.effectId.startsWith('tmpl:') && sk.tmplParams) {
      const tmplId = sk.effectId.slice(5)
      const inst = spawnTemplate(this.ctx.engine.scene, tmplId, sk.tmplParams as TemplateParams, new THREE.Vector3(0, 0.2, 0))
      if (inst) this.tmplInstances.push(inst)
      return
    }
    const def = EFFECTS.find(d => d.id === sk.effectId)
    if (def) this.fireEffect(def)
  }

  private async playAll(): Promise<void> {
    for (const sk of this.st.skills) { if (sk.effectId) { const d = EFFECTS.find(x => x.id === sk.effectId); if (d && this.vfx) { this.fireEffect(d); await new Promise(r => setTimeout(r, 2200)) } } }
  }

  private savePack(): void {
    const pr = readCharacterProfile()
    const name = prompt('技能包名称:', `${pr.charClass || '未知职业'}技能包`)
    if (!name) return
    this.st.packs.push({ id: `pk_${Date.now()}`, name, profession: pr.charClass || '未知职业', skills: JSON.parse(JSON.stringify(this.st.skills)), timestamp: Date.now() })
    this.save(); this.render(); toast(`已保存「${name}」`)
  }

  private async chat(ta: HTMLTextAreaElement): Promise<void> {
    const t = ta.value.trim(); if (!t) return; ta.value = ''
    this.chatHistory.push({ role: 'user', text: t }); this.updateChatLog()
    try {
      const pr = readCharacterProfile()
      const r = await apiPost('/__ce-api__/gemini-text', {
        prompt: `You are a Three.js VFX expert. Character: ${pr.charClass || 'Unknown'} (${pr.worldSetting || 'fantasy'}, ${pr.combatType === 'ranged' ? 'ranged' : 'melee'}).\nUser: ${t}`,
        model: 'gemini-3-pro-image-preview',
      })
      this.chatHistory.push({ role: 'ai', text: r.success && r.text ? r.text : (r.error || '没有响应') })
    } catch (e: any) { this.chatHistory.push({ role: 'ai', text: '错误: ' + e.message }) }
    this.updateChatLog()
  }

  private updateChatLog(): void {
    const log = document.getElementById('vp-chatlog'); if (!log) return
    log.innerHTML = ''; for (const m of this.chatHistory) { const b = mk('div', `vp-msg ${m.role}`); b.textContent = m.text; log.appendChild(b) }
    log.scrollTop = log.scrollHeight
  }

  private save(): void {
    studioSave(VFX_STATE_KEY, { skills: this.st.skills, activeSlot: this.st.activeSlot, packs: this.st.packs, activePack: this.st.activePack, timestamp: Date.now() }).catch(() => {})
  }

  /**
   * "Import VFX to Game" button flow:
   *   1. At least one slot must have effectId set
   *   2. List workspace games, let user pick gameId + slot (localStorage remembers last)
   *   3. Fetch published character.manifest.json (needs actions list to bind skills)
   *   4. Call vfxSkillsToExported to downgrade-map (returns skills + skipped)
   *   5. POST to /__ce-api__/merge-skills-to-workspace-game
   *   6. Toast result (applied count / skipped count + first skip reason)
   *
   * Intentionally shares two localStorage keys with pixel-char pipeline so both
   * pipelines remember the same gameId/slot across switches.
   */
  /**
   * "Sync from Game" -- reverse-map published character.manifest.json.skills[]
   * back to editor SkillSlots, overwriting this.st.skills.
   *
   * Solves the "banner shows wrong character, did VFX get overwritten?" confusion --
   * one click shows exactly what is in game right now.
   *
   * Reverse-map is lossy (runtime only stores slash/impact/aura/projectile),
   * so effectId is best-match by color+type; not guaranteed exact.
   * Display/fallback only, does not affect publish.
   */
  private async onClickPullFromGame(): Promise<void> {
    let games: WorkspaceGame[] = []
    try { games = await listWorkspaceGames() }
    catch (e: any) { toast(`获取工作区游戏失败: ${e.message}`); return }
    if (games.length === 0) { toast('工作区里没有游戏项目'); return }

    const LS_GAME_KEY = 'pixelchar.lastWorkspaceGameId'
    const LS_SLOT_KEY = 'pixelchar.lastWorkspaceSlot'
    const remembered = localStorage.getItem(LS_GAME_KEY) || ''
    let gameId: string
    if (games.length === 1) {
      gameId = games[0].gameId
    } else {
      const opts = games.map((g, i) => `${i + 1}) ${g.gameId}`).join('\n')
      const defaultIdx = Math.max(1, games.findIndex(g => g.gameId === remembered) + 1)
      const input = prompt(`从哪个游戏同步技能？\n\n${opts}`, String(defaultIdx))
      if (!input) return
      const asNum = parseInt(input, 10)
      if (!isNaN(asNum) && asNum >= 1 && asNum <= games.length) gameId = games[asNum - 1].gameId
      else { const m = games.find(g => g.gameId === input.trim()); if (!m) { toast('无效的游戏 ID'); return } gameId = m.gameId }
    }
    const slot = (localStorage.getItem(LS_SLOT_KEY) || 'player').trim()

    const resp = await fetch(`/__ce-api__/workspace-game-manifest?gameId=${encodeURIComponent(gameId)}&characterId=${encodeURIComponent(slot)}`)
    const data = await resp.json()
    if (!data?.success) { toast(`游戏 ${gameId} 中找不到角色槽「${slot}」(${data?.error ?? '未知错误'})`); return }

    const manifest = data.manifest as CharacterManifest
    const derived = manifestSkillsToSkillSlots(manifest.skills ?? [])
    if (derived.length === 0) { toast('游戏中的角色 skills[] 为空'); return }

    // Overwrite editor effectIds; keep user-given names intact
    for (const d of derived) {
      const sk = this.st.skills.find(s => s.id === d.slotId)
      if (!sk) continue
      sk.effectId = d.effectId
      sk.effectLabel = d.effectLabel
      sk.isAIGenerated = false
    }
    localStorage.setItem(LS_GAME_KEY, gameId)
    this.save(); this.render()
    const summary = derived.map(d => `${d.slotId}=${d.effectLabel}`).join(' · ')
    toast(`已从 ${gameId}/${slot} 同步 ${derived.length} 个技能: ${summary}`)
  }

  private async onClickPublishVfxToGame(): Promise<void> {
    const filled = this.st.skills.filter(s => s.effectId)
    if (filled.length === 0) {
      toast('还没有配置技能，请先给技能槽绑定特效')
      return
    }

    let games: WorkspaceGame[] = []
    try { games = await listWorkspaceGames() }
    catch (e: any) { toast(`获取工作区游戏失败: ${e.message}`); return }
    if (games.length === 0) { toast('工作区里没有游戏项目'); return }

    // Shares localStorage keys with pixel-char pipeline so selection persists
    const LS_GAME_KEY = 'pixelchar.lastWorkspaceGameId'
    const LS_SLOT_KEY = 'pixelchar.lastWorkspaceSlot'
    const remembered = localStorage.getItem(LS_GAME_KEY) || ''

    let gameId: string
    if (games.length === 1) {
      gameId = games[0].gameId
    } else {
      const opts = games.map((g, i) => `${i + 1}) ${g.gameId}${g.hasPlayerSlot ? '  (has player)' : ''}`).join('\n')
      const defaultIdx = Math.max(1, games.findIndex(g => g.gameId === remembered) + 1)
      const input = prompt(`把技能导入到哪个游戏？请输入序号或 UUID:\n\n${opts}`, String(defaultIdx))
      if (!input) return
      const asNum = parseInt(input, 10)
      if (!isNaN(asNum) && asNum >= 1 && asNum <= games.length) {
        gameId = games[asNum - 1].gameId
      } else {
        const match = games.find(g => g.gameId === input.trim())
        if (!match) { toast('无效的游戏 ID'); return }
        gameId = match.gameId
      }
    }

    const defaultSlot = localStorage.getItem(LS_SLOT_KEY) || 'player'
    const slot = prompt('把技能合并到哪个角色槽？通常是 "player"', defaultSlot)
    if (!slot) return
    const trimmed = slot.trim()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/.test(trimmed)) {
      toast('无效的角色槽 ID，只能使用 a-zA-Z0-9_-')
      return
    }

    // Fetch target manifest. If missing, prompt user to publish via pixel-char first.
    const manifestUrl = `/__ce-api__/workspace-game-manifest?gameId=${encodeURIComponent(gameId)}&characterId=${encodeURIComponent(trimmed)}`
    let manifest: CharacterManifest | null = null
    try {
      const resp = await fetch(manifestUrl)
      const data = await resp.json()
      if (data?.success && data.manifest) manifest = data.manifest as CharacterManifest
    } catch { /* fall through */ }

    if (!manifest) {
      toast(`${gameId} 中的角色槽「${trimmed}」尚未发布，请先到像素角色流程导入主角`)
      return
    }

    const { skills, skipped } = vfxSkillsToExported(this.st.skills, manifest)
    if (skills.length === 0) {
      const first = skipped[0]
      toast(`没有可导出的技能（跳过 ${skipped.length} 个: ${first?.reason ?? '未知原因'}）`)
      return
    }

    try {
      const result = await mergeSkillsToWorkspaceGame({ gameId, characterId: trimmed, skills })
      localStorage.setItem(LS_GAME_KEY, gameId)
      localStorage.setItem(LS_SLOT_KEY, trimmed)
      const tail = result.skillsSkipped > 0 ? ` | 跳过 ${result.skillsSkipped}` : ''
      toast(`已合并 ${result.skillsApplied} 个技能到 ${gameId}/${trimmed}${tail}`)
    } catch (e: any) {
      toast(`导入失败: ${e.message}`)
    }
  }
}

// ── Pipeline export ────────────────────────────────────────────────

let ui: VFXPipelineUI | null = null, pCtx: PipelineContext | null = null
const vfxPipeline: IPipeline = {
  meta,
  async init(c) { pCtx = c; if (!ui) { ui = new VFXPipelineUI(); await ui.restore() } },
  dispose() { ui?.dispose(); ui = null; pCtx = null },
  createUI(c, p) { if (ui && pCtx && p) ui.mount(c, p, pCtx); else c.innerHTML = '<div style="padding:16px;color:var(--text-secondary)">需要面板容器</div>' },
  destroyUI() { ui?.unmount() },
  getDefaultParams() { return {} },
}
export default vfxPipeline

// ── Util ───────────────────────────────────────────────────────────

function mk(t: string, c: string): HTMLElement { const e = document.createElement(t); e.className = c; return e }

function sld(label: string, min: number, max: number, step: number, val: number, cb: (n: number) => void): HTMLElement {
  const r = mk('div', 'vp-sld')
  r.innerHTML = `<span class="vp-sl">${PARAM_LABELS[label] ?? label}</span>`
  const i = document.createElement('input'); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(val); i.className = 'vp-sr'
  const v = mk('span', 'vp-sv'); v.textContent = String(val)
  i.addEventListener('input', () => { v.textContent = i.value; cb(parseFloat(i.value)) })
  r.appendChild(i); r.appendChild(v); return r
}

function sel(label: string, opts: { v: string; l: string }[], cur: string, cb: (s: string) => void): HTMLElement {
  const r = mk('div', 'vp-sld'); r.innerHTML = `<span class="vp-sl">${PARAM_LABELS[label] ?? label}</span>`
  const s = document.createElement('select'); s.className = 'vp-sel'
  for (const o of opts) { const op = document.createElement('option'); op.value = o.v; op.textContent = o.l; if (o.v === cur) op.selected = true; s.appendChild(op) }
  s.addEventListener('change', () => cb(s.value)); r.appendChild(s); return r
}

async function apiPost(u: string, b: any): Promise<any> {
  const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
  if (!r.ok) return { success: false, error: `HTTP ${r.status}` }; return r.json()
}

function toast(m: string): void {
  let t = document.querySelector('.vp-toast') as HTMLElement
  if (!t) { t = document.createElement('div'); t.className = 'vp-toast'; document.body.appendChild(t) }
  t.textContent = m; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3000)
}

function injectCSS(): void {
  let s = document.getElementById(CSS_ID) as HTMLStyleElement | null
  if (!s) { s = document.createElement('style'); s.id = CSS_ID; document.head.appendChild(s) }
  s.textContent = `
.vp { display:flex;flex-direction:column;width:100%;min-height:max-content;overflow:visible;font-family:system-ui,sans-serif;padding:0 10px 28px;gap:8px;box-sizing:border-box; }
.vp::-webkit-scrollbar { width:6px;height:6px; }
.vp::-webkit-scrollbar-track { background:transparent; }
.vp::-webkit-scrollbar-thumb { background:rgba(212,255,72,.18);border-radius:999px; }
.vp::-webkit-scrollbar-thumb:hover { background:rgba(212,255,72,.34); }
.vp-empty { display:flex;flex-direction:column;align-items:center;gap:8px;padding:40px 20px;color:var(--text-secondary);text-align:center;font-size:13px; }
.vp-header { display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.07); }
.vp-title { font-size:15px;font-weight:700;color:#d4ff48;line-height:normal; }
.vp-header-pill { margin-left:auto;padding:3px 8px;border:1px solid rgba(212,255,72,.28);border-radius:999px;background:rgba(212,255,72,.08);color:#d4ff48;font-size:11px;font-weight:700;line-height:1.2;letter-spacing:.04em;white-space:nowrap; }
.vp-char-banner { padding:8px 10px;background:rgba(255,255,255,.018);border:1px solid rgba(255,255,255,.07);border-radius:10px;font-size:11px; }
.vp-cb-row { display:flex;align-items:center;gap:8px;flex-wrap:wrap;line-height:1.6; }
.vp-cb-name { font-weight:700;color:var(--text-primary);font-size:12px; }
.vp-cb-class { color:#c8a840;background:rgba(200,168,64,.12);padding:1px 6px;border-radius:3px; }
.vp-cb-world { color:#88bbff;background:rgba(100,160,255,.10);padding:1px 6px;border-radius:3px; }
.vp-cb-type  { color:#aaaaaa; }
.vp-cb-mount { margin-top:2px;gap:10px;color:var(--text-secondary); }

/* workflow cards */
.vp-workflow-card { border:1px solid rgba(255,255,255,.07);border-radius:10px;background:rgba(255,255,255,.018);box-shadow:inset 0 0 0 1px rgba(0,0,0,.16);overflow:hidden;flex:0 0 auto; }
.vp-workflow-card[open] { border-color:rgba(212,255,72,.22);background:rgba(212,255,72,.025); }
.vp-workflow-head { display:flex;align-items:center;gap:8px;padding:10px 10px 4px;cursor:pointer;list-style:none;user-select:none; }
.vp-workflow-head::-webkit-details-marker { display:none; }
.vp-workflow-title { display:grid;grid-template-columns:18px minmax(0,1fr);align-items:center;gap:7px;min-width:0;color:var(--text-primary);font-size:12px;font-weight:800;letter-spacing:.03em; }
.vp-step { display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--accent);color:#071007;font-size:10px;font-weight:900;box-shadow:0 0 0 1px rgba(212,255,72,.34),0 0 10px rgba(212,255,72,.12); }
.vp-workflow-caret { margin-left:auto;color:rgba(212,255,72,.72);font-size:13px;transform:rotate(-90deg);transition:transform .15s ease,color .15s ease; }
.vp-workflow-card[open] .vp-workflow-caret { transform:rotate(0);color:var(--accent); }
.vp-workflow-summary { padding:0 10px 9px 35px;color:rgba(255,255,255,.48);font-size:11px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.vp-workflow-card[open] .vp-workflow-summary { color:rgba(212,255,72,.68); }
.vp-workflow-body { display:flex;flex-direction:column;gap:8px;padding:0 10px 11px;min-height:0; }
.vp-workflow-card:not([open]) .vp-workflow-body { display:none; }
.vp-workflow-card[open] .vp-workflow-body { max-height:280px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(212,255,72,.24) transparent;overscroll-behavior:contain; }
.vp-workflow-card[open] .vp-workflow-body::-webkit-scrollbar { width:6px;height:6px; }
.vp-workflow-card[open] .vp-workflow-body::-webkit-scrollbar-track { background:transparent; }
.vp-workflow-card[open] .vp-workflow-body::-webkit-scrollbar-thumb { background:rgba(212,255,72,.18);border-radius:999px; }
.vp-workflow-card[open] .vp-workflow-body::-webkit-scrollbar-thumb:hover { background:rgba(212,255,72,.34); }
.vp-workflow-card[open] .vp-debug-body { max-height:min(680px, calc(100dvh - 96px)); }
.vp-debug-body { max-height:min(680px, calc(100dvh - 96px));overflow-y:auto;padding-right:4px;scrollbar-width:thin;scrollbar-color:rgba(212,255,72,.24) transparent;overscroll-behavior:contain; }
.vp-debug-body::-webkit-scrollbar { width:6px;height:6px; }
.vp-debug-body::-webkit-scrollbar-track { background:transparent; }
.vp-debug-body::-webkit-scrollbar-thumb { background:rgba(212,255,72,.18);border-radius:999px; }
.vp-debug-body::-webkit-scrollbar-thumb:hover { background:rgba(212,255,72,.34); }

/* section header */
.vp-sh { display:flex;align-items:center;justify-content:space-between;padding:8px 10px;font-size:12px;font-weight:700;color:var(--accent);cursor:pointer;border:1px solid rgba(255,255,255,.07);background:rgba(255,255,255,.02);border-radius:8px;user-select:none;position:relative;top:auto;z-index:1; }
.vp-sh:first-child { border-top:none; }
.vp-sh:hover { background:var(--bg-active); }
.vp-shv { font-size:10px;color:var(--text-secondary); }
.vp-info { font-size:10px;color:var(--text-secondary);padding:4px 12px;background:rgba(0,0,0,0.15);margin:0 8px 4px;border-radius:4px; }

/* group header (themed) */
.vp-gh { display:flex;align-items:center;gap:6px;padding:7px 10px;cursor:pointer;user-select:none;position:relative;top:auto;z-index:1;border-top:1px solid rgba(255,255,255,.04);border-radius:7px;transition:filter .12s; }
.vp-gh:hover { filter:brightness(1.15); }
.vp-gh-dot { width:7px;height:7px;border-radius:50%;flex-shrink:0; }
.vp-gh-label { flex:1;font-size:11px;font-weight:700;letter-spacing:.4px; }
.vp-gh-count { font-size:9px;opacity:.6;margin-right:2px; }

/* btn */
.vp-btn-row { display:flex;gap:4px;padding:0; }
.vp-btn-row.vp-btn-row-primary { gap:8px;padding:2px 0 0; }
.vp-btn-row.vp-btn-row-secondary { gap:6px;padding:0;border-bottom:none;margin-bottom:0; }
.vp-btn { padding:5px 10px;border:1px solid var(--border);border-radius:4px;background:var(--bg-hover);color:var(--text-primary);font-size:10px;font-family:inherit;cursor:pointer;transition:all .12s;flex:1;text-align:center; }
.vp-btn:hover { background:var(--bg-active); }
.vp-btn.accent { background:var(--accent);color:#0b0c0a;border-color:var(--accent);font-weight:600; }
.vp-btn.primary { background: color-mix(in srgb, var(--accent) 88%, #fff 12%); color:#0b0c0a; border-color:var(--accent); font-weight:700; }
.vp-btn.primary:hover { filter:brightness(1.08); }
.vp-btn.xl {
  padding:14px 12px;font-size:14px;font-weight:800;letter-spacing:.6px;border-radius:8px;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent), 0 3px 14px color-mix(in srgb, var(--accent) 28%, transparent);
}
.vp-btn.xl:hover { transform:translateY(-1px); box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent), 0 5px 20px color-mix(in srgb, var(--accent) 42%, transparent); }
.vp-btn.xl:active { transform:translateY(0); }

/* skill cards */
.vp-card { margin:0;border-radius:8px;border:1px solid var(--border);transition:all .15s;cursor:pointer; }
.vp-card:hover { background:var(--bg-hover);border-color:rgba(255,255,255,.12); }
.vp-card.sel { background:rgba(100,180,255,.08);border-color:rgba(100,180,255,.5);box-shadow:0 0 0 1px rgba(100,180,255,.15); }
.vp-card-head { display:flex;align-items:center;gap:4px;padding:6px 8px; }
.vp-card-icon { font-size:16px;width:22px;text-align:center;flex-shrink:0; }
.vp-card-name { font-size:11px;font-weight:600;color:var(--text-primary);background:transparent;border:none;outline:none;width:72px;font-family:inherit;padding:1px 2px; }
.vp-card-name:focus { background:var(--bg-hover);border-radius:2px; }
.vp-card-effect { flex:1;font-size:9px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;padding-right:4px; }
.vp-card-play,.vp-card-clear { width:22px;height:22px;border:1px solid var(--border);border-radius:4px;background:var(--bg-hover);font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;padding:0;transition:all .12s; }
.vp-card-play { color:#55cc88; }
.vp-card-play:hover:not(:disabled) { background:rgba(100,255,100,.15);border-color:rgba(100,255,100,.3); }
.vp-card-clear { color:var(--text-secondary); }
.vp-card-clear:hover:not(:disabled) { color:#f88;background:rgba(255,80,80,.1);border-color:rgba(255,80,80,.3); }
.vp-card-play:disabled,.vp-card-clear:disabled { opacity:.25;cursor:not-allowed; }

/* effect cards (themed per-group) */
.vp-grp-hdr { font-size:9px;font-weight:700;color:var(--accent);opacity:.7;padding:10px 12px 3px;text-transform:uppercase;letter-spacing:.6px; }
.vp-ecard { margin:0 4px 3px;border:1px solid var(--border);border-radius:6px;overflow:hidden;transition:all .15s; }
.vp-ecard:hover { border-color:rgba(255,255,255,.15); }
.vp-ecard-head { display:flex;align-items:center;gap:4px;padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);transition:background .12s; }
.vp-ei { font-size:15px;width:22px;text-align:center;flex-shrink:0;filter:drop-shadow(0 0 2px rgba(255,255,255,.2)); }
.vp-en { flex:1;font-size:11px;font-weight:600;color:var(--text-primary); }
.vp-badge { font-size:8px;padding:1px 6px;border-radius:8px;line-height:15px;font-weight:600; }
.vp-looping { font-size:10px;color:var(--success);animation:vp-pulse 1s infinite;flex-shrink:0; }
@keyframes vp-pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }

/* params */
.vp-par { padding:5px 10px 7px;display:flex;flex-direction:column;gap:2px;background:rgba(0,0,0,.08); }
.vp-sld { display:flex;align-items:center;gap:4px;padding:1px 0; }
.vp-sl { font-size:9px;color:var(--text-secondary);width:36px;flex-shrink:0; }
.vp-sr { flex:1;accent-color:var(--accent);height:12px; }
.vp-sv { font-size:8px;color:var(--accent);font-family:monospace;width:28px;text-align:right; }
.vp-sel { flex:1;padding:1px 3px;font-size:9px;background:var(--bg-base);border:1px solid var(--border);color:var(--text-primary);border-radius:3px; }

/* section */
.vp-sec { padding:0;display:flex;flex-direction:column;gap:6px; }

/* packs */
.vp-pkrow { display:flex;align-items:center;gap:4px;padding:5px 8px;border-radius:4px;border:1px solid var(--border); }
.vp-pkrow.act { border-color:var(--accent);background:var(--bg-active); }
.vp-pkinfo { flex:1;min-width:0;font-size:11px;color:var(--text-primary);display:flex;flex-direction:column; }
.vp-pkinfo span { font-size:9px;color:var(--text-secondary); }
.vp-pkbtn { font-size:9px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-hover);color:var(--text-secondary);cursor:pointer;font-family:inherit; }
.vp-pkbtn:hover { background:var(--accent);color:#fff;border-color:var(--accent); }
.vp-pkbtn.del:hover { background:rgba(255,80,80,.15);color:#f88;border-color:rgba(255,80,80,.3); }

/* checkbox */
.vp-ck { display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);padding:2px 0;cursor:pointer; }
.vp-ck input { accent-color:var(--accent); }

/* chat */
.vp-chat { min-height:120px; }
.vp-chatlog { max-height:160px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;padding:2px 0; }
.vp-msg { padding:4px 8px;border-radius:6px;font-size:10px;line-height:1.4;max-width:92%;word-break:break-word; }
.vp-msg.user { align-self:flex-end;background:var(--accent);color:#fff;border-bottom-right-radius:1px; }
.vp-msg.ai { align-self:flex-start;background:var(--bg-hover);color:var(--text-primary);border:1px solid var(--border);border-bottom-left-radius:1px;white-space:pre-wrap; }
.vp-chatrow { display:flex;gap:4px;margin-top:4px; }
.vp-chatin { flex:1;padding:4px 6px;font-size:10px;background:var(--bg-hover);border:1px solid var(--border);color:var(--text-primary);border-radius:4px;font-family:inherit;resize:none;outline:none; }
.vp-chatin:focus { border-color:var(--accent); }

/* toast */
.vp-toast { position:fixed;bottom:30px;left:50%;transform:translateX(-50%) translateY(20px);padding:10px 24px;background:rgba(20,20,30,.95);color:#fff;border-radius:8px;font-size:13px;z-index:9999;opacity:0;transition:all .3s;pointer-events:none;backdrop-filter:blur(8px);border:1px solid var(--border); }
.vp-toast.show { opacity:1;transform:translateX(-50%) translateY(0); }

/* AI template generator */
.vp-tmpl-sec { border-bottom:1px solid var(--border); }
.vp-tmpl-card { margin:4px 0 2px;padding:8px 10px;background:var(--bg-hover);border:1px solid var(--border);border-radius:6px;border-left:2px solid var(--accent); }
/* group body */
.vp-grp-body { padding:3px 0 6px;margin-bottom:2px; }
`
}
