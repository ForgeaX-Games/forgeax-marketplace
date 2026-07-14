// @source wb-character/src/vfx/VFXManager.ts
import * as THREE from 'three'
import { ParticleSystem, MistParticleSystem, SnowflakeParticleSystem } from './core/ParticleSystems'
import { PoisonProjectile, PoisonPoolEffect, PoisonCloudEffect } from './effects/Poison'
import { ShieldEffect } from './effects/Shield'
import { DissolveEffect } from './effects/Dissolve'
import { MagicTeleportEffect } from './effects/Teleport'
import { HealAura } from './effects/HealAura'
import { IceProjectile } from './effects/IceProjectile'
import { GroundFrostEffect } from './effects/GroundFrost'
import { ComboSystem } from './effects/SlashEffect'
import { StarBladeEffect } from './effects/StarBladeEffect'
import type { ElementKey } from './effects/SlashEffect'
import { BigFireballEffect } from './effects/BigFireballEffect'
import { MeteorEffect } from './effects/MeteorEffect'
import { MagicCannonEffect } from './effects/MagicCannonEffect'
import { LightningAttackSystem } from './effects/LightningEffect'
import { HitExplosion, createHitExplosionPool } from './effects/HitExplosionEffect'
import { Shockwave, createShockwavePool } from './effects/ShockwaveEffect'
import { VineStrikeEffect } from './effects/VineStrikeEffect'
import { ArcaneBlastEffect } from './effects/ArcaneBlastEffect'
import { WeaponSlashEffect } from './effects/WeaponSlashEffect'
import { DashTrailEffect }   from './effects/DashTrailEffect'
import { CharDummy }         from './effects/CharDummy'
import type { MountAdapter } from './mount/MountAdapter'
import { MountPointId }      from './mount/MountPointTypes'
import { getAdapter }        from './mount/SharedAdapter'
import { getCharWorldPos }   from './mount/CharPosTracker'
import { getCharacterController } from './CharacterControllerBridge'
import type { TargetAcquisitionSystem } from './targeting/TargetAcquisitionSystem'
import { calcSkillDamage } from './combat/CombatFormula'
import { DEFAULT_SKILL_COEFFS } from './combat/CombatStats'
import type { BaseStats } from './combat/CombatStats'

const CHAR_POS = new THREE.Vector3(0, 0.67, 0)

// ── （  pixel-char pipeline → ）─────
let _vfxManagerInstance: VFXManager | null = null
/**  VFXManager （  vfx pipeline ） */
export function getVFXManager(): VFXManager | null { return _vfxManagerInstance }

// ──  ────────────────────────────────────────────────
export interface VFXParams {
  slash: {
    elementOverride: ElementKey | ''
    radiusScale:    number   // 0.4 - 2.5
    speedScale:     number   // 0.3 - 2.5  (< 1 )
    particleMult:   number   // 0.2 - 3.0
    glowScale:      number   // 0.2 - 4.0
    colorMix:       number   // 0.0 - 1.0
  }
  starBlade: {
    chargeDuration:    number  // 0.3 - 3.0 s
    bladeWidth:        number  // 0.2 - 2.0
    bladeHeight:       number  // 2.0 - 12.0
    fallHeight:        number  // 5 - 25
    impactParticles:   number  // 10 - 120
    bladeFallDuration: number  // 0.2 - 1.5 s
    bladeDelay:        number  // 0.1 - 0.8 s
  }
  poison: {
    speed:        number  // 3 - 18
    poolDuration: number  // 1 - 12 s
  }
  shield: {
    scale:       number  // 0.5 - 2.5
    gridScale:   number  // 1.0 - 8.0
    brightness:  number  // 0.2 - 3.0
    flowSpeed:   number  // 0.2 - 4.0
    hue:         number  // 0.0 - 1.0
    distortion:  number  // 0.0 - 3.0
  }
  dissolve: {
    duration: number  // 0.5 - 4.0 s
  }
  healAura: {
    radius:    number  // 0.5 - 4.0
    speed:     number  // 0.3 - 6.0
    hue:       number  // 0.0 - 1.0  （0=  0.5=  0.75= …）
    intensity: number  // 0.3 - 3.0
  }
  ice: {
    speed: number  // 5 - 20
  }
  groundFrost: {
    duration: number  // 1 - 10 s
    radius:   number  // 1 - 10（ ）
    density:  number  // 0.3 - 3.0（ ）
  }
  screenFrost: {
    duration: number  // 0.5 - 8.0 s
  }
  bigFireball: {
    chargeTime:       number  // 0.1 - 2.0 s
    hitRadius:        number  // 0.3 - 3.0
    impactDuration:   number  // 0.5 - 4.0 s
    explosionMaxScale:number  // 1.0 - 7.0
    flowSpeed:        number  // 0.3 - 4.0
    explosionAlpha:   number  // 0.15 - 1.0
    brightness:       number  // 0.2 - 2.0
    hue:              number  // 0.0 - 1.0
    colorMix:         number  // 0.0 - 1.0
  }
  meteor: {
    warningTime:    number  // 0.5 - 2.5 s
    fallHeight:     number  // 15 - 50
    impactRadius:   number  // 1 - 6
    explosionScale: number  // 0.3 - 3.0
    shockwaveScale: number  // 1.0 - 12.0
    smokeScale:     number  // 0.1 - 2.0
    traumaAmount:   number  // 0 - 1.0
    flashIntensity: number  // 0 - 1.0
    burnDuration:   number  // 1 - 15 s
  }
  magicCannon: {
    chargeTime: number  // 0.3 - 1.5 s
    beamWidth:  number  // 0.3 - 2.0
  }
  lightning: {
    chargeTime: number  // 0.5 - 3.0 s
  }
  vineStrike: {
    vineRadius: number  // 1.0 - 4.0
    vineHeight: number  // 1.5 - 5.0
  }
  weaponSlash: {
    ringRadius:  number  // 0.5 - 3.0
    slashLength: number  // 0.5 - 2.0
    vortexSize:  number  // 0.5 - 2.0
    duration:    number  // 0.3 - 1.2 s
  }
  dashTrail: {
    streakCount: number  // 1 - 7
    maxLength:   number  // 1.5 - 6.0
    duration:    number  // 0.2 - 1.0 s
    hue:         number  // 0.0 - 1.0 （0= , 0.5= , 0.33= …）
    scale:       number  // 0.3 - 3.0
  }
}

export class VFXManager {
  private sparkPS: ParticleSystem
  private magicPS: ParticleSystem
  private smokePS: MistParticleSystem
  private snowflakePS: SnowflakeParticleSystem

  /**  Shield / Teleport / Dissolve  */
  private dummyMesh: THREE.Mesh

  // ──  ───────────────────────────────────────────────────
  private _dashActive = false
  private _dashTarget = new THREE.Vector3()
  private _dashOrigin = new THREE.Vector3()
  private _dashAge    = 0
  private readonly DASH_DUR = 0.28  //  (s)

  private poisonPool: PoisonPoolEffect
  private poisonProjectile: PoisonProjectile
  private poisonCloud: PoisonCloudEffect
  private shield: ShieldEffect
  private dissolve: DissolveEffect
  private teleport: MagicTeleportEffect
  private healAura: HealAura
  private iceProjectile: IceProjectile
  private groundFrost: GroundFrostEffect
  private combo: ComboSystem
  private starBlade: StarBladeEffect
  private comboTimeouts: ReturnType<typeof setTimeout>[] = []

  private bigFireball: BigFireballEffect
  private meteor: MeteorEffect
  private magicCannon: MagicCannonEffect
  private lightning: LightningAttackSystem
  private hitExplosions: HitExplosion[]
  private shockwaves: Shockwave[]
  private vineStrike: VineStrikeEffect
  private arcaneBlast: ArcaneBlastEffect
  private weaponSlash: WeaponSlashEffect
  private dashTrail:   DashTrailEffect
  private charDummy:   CharDummy

  /** （  VFX Pipeline  mount() ） */
  private _adapter: MountAdapter | null = null

  // ── （overlayScene）──────────────────────────────────────
  // overlayScene  Engine  clearDepth() ，  world.scene 。
  //  sprite  mesh （renderOrder > 100）。
  // （mesh.visible=false） ，  _cleanupFgObjects() 。
  private _overlayScene: THREE.Scene | null = null
  private _fgObjects: THREE.Object3D[] = []

  /**  VFXPipeline  Engine  overlayScene */
  setOverlayScene(scene: THREE.Scene): void {
    this._overlayScene = scene
    // ，
    if (this._charMesh) this._setupHitFlashOverlay(this._charMesh, this._charWorldHeight)
  }

  /** / （  sprite ，Additive Blend ） */
  private _setupHitFlashOverlay(mesh: THREE.Mesh | null, height: number): void {
    //
    if (this._hitFlashOverlay) {
      this._overlayScene?.remove(this._hitFlashOverlay)
      this._hitFlashOverlayMat?.dispose()
      this._hitFlashOverlay = null
      this._hitFlashOverlayMat = null
    }
    if (!mesh || !this._overlayScene) return
    const w = height * 0.75   //
    const geo = new THREE.PlaneGeometry(w, height)
    this._hitFlashOverlayMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1, 1, 1),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    })
    this._hitFlashOverlay = new THREE.Mesh(geo, this._hitFlashOverlayMat)
    this._hitFlashOverlay.renderOrder = 9300   //  sprite(100)
    this._hitFlashOverlay.visible = false
    this._overlayScene.add(this._hitFlashOverlay)
  }

  /**  objects  overlayScene ，  renderOrder  */
  private _pushToFg(objects: THREE.Object3D[]): void {
    if (!this._overlayScene) return
    for (const obj of objects) {
      obj.renderOrder = 9100  // > sprite(100)，  overlayScene  =
      this._overlayScene.add(obj)  // Three.js  world.scene
      this._fgObjects.push(obj)
    }
  }

  /** ：  renderOrder */
  private _cleanupFgObjects(): void {
    const stillFg: THREE.Object3D[] = []
    for (const obj of this._fgObjects) {
      if (!obj.visible) {
        obj.renderOrder = 0
        this.scene.add(obj)  //
      } else {
        stillFg.push(obj)
      }
    }
    this._fgObjects = stillFg
  }

  /**  sprite （'down' ） */
  private _charFacingCamera(): boolean {
    return getCharacterController()?.getSpriteDirection() === 'down'
  }

  /**
   * （'up'/'down' ）  X 。
   * ， / ，
   *  × offset（ ） 。
   *   offset > 0 = ，< 0 = 
   */
  private _dashSpineOffset(spriteDir?: string | null): THREE.Vector3 {
    if (spriteDir === 'up' || spriteDir === 'down') {
      // ：  =
      const offset = spriteDir === 'up' ? -0.08 : -0.08
      const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0)
      return camRight.multiplyScalar(offset)
    }
    return new THREE.Vector3()
  }

  // ── （  overlayScene， ）────────
  private _healAuraFg: THREE.Object3D[] = []

  /**
   *  sprite mesh （  pixel-char pipeline  setCharacterSprite ）。
   * ：
   *   -  dummyMesh  sprite  → 
   *   - /  sprite （  charDummy ）
   */
  private _charMesh: THREE.Mesh | null = null

  /**  sprite （ ）；  1.2（  dummyMesh  0.6 ） */
  private _charWorldHeight = 1.2

  /** sprite dissolve ：'out' = ，'in' = ，null =  */
  private _spriteDissolveMode: 'out' | 'in' | null = null
  private _spriteDissolveAge = 0
  private _spriteDissolveDuration = 1500
  /** （triggerDissolve  out→pause→in ） */
  private _spriteDissolveAutoReverse = false
  /** dissolve  sprite material color（ ） */
  private _spriteOrigColor = new THREE.Color(1, 1, 1)
  /** sprite  MeshBasicMaterial  opacity，  */
  private _spriteOrigOpacity = 1.0
  /** sprite  scale/visible  */
  private _spriteOrigScale = 1.0
  private _spriteOrigVisible = true

  /** sprite teleport ：'out' = ，'in' = ，null =  */
  private _spriteTeleportMode: 'out' | 'in' | null = null
  private _spriteTeleportAge = 0
  private _spriteTeleportDuration = 600

  // ── （Hit Flash）——  dissolve，  ──────────────
  /** （ms）；-1 =  */
  private _hitFlashAge = -1
  private _hitFlashDuration = 160
  /** （ ） */
  private _hitFlashBaseColor = new THREE.Color(1, 1, 1)
  /** （  + ）  */
  private _onImpactCallback: ((scale: number) => void) | null = null
  /** （  pixel-char pipeline ，  hurt ） */
  private _playActionCallback: ((actionId: string) => void) | null = null
  /** ：  SpriteAnimator.flashIntensity （  pixel-char ） */
  private _setFlashIntensityCb: ((intensity: number) => void) | null = null
  /** ：  VFX ，  acquire */
  private _targetSys: TargetAcquisitionSystem | null = null
  /** ：(targetId, damage, isCrit, worldPos) →  */
  private _onHitTargetCb: ((targetId: string, dmg: number, isCrit: boolean, worldPos: THREE.Vector3) => void) | null = null
  /** （  Lv.1） */
  private readonly _testStats: BaseStats = { ATK:120, MATK:10, DEF:40, MDEF:30, HP:1500, HP_CUR:1500, SPD:70, CRIT_RATE:0.12, CRIT_DMG:1.8 }
  /** （Additive Blend ，  clamp ） */
  private _hitFlashOverlay: THREE.Mesh | null = null
  private _hitFlashOverlayMat: THREE.MeshBasicMaterial | null = null

  /**
   *  scale：  dummyMesh (  0.6) 。
   *  scale = baseScale × params.shield.scale，  UI 。
   */
  private _shieldBaseScale(): number {
    // ， 。1.2  → scale 1；1.8  → scale 1.5
    return Math.max(0.8, this._charWorldHeight / 1.2)
  }

  /** ，  CHAR_POS + offset */
  private _mount(id: MountPointId, fallback?: THREE.Vector3): THREE.Vector3 {
    // Level 0：  CharPosTracker  sprite mesh （ ，  adapter ）
    const direct = getCharWorldPos(this._yFracForMount(id))
    if (direct) return direct

    // Level 1+：  adapter （SpriteAnchor / Spine / Geometric）
    const adapter = this._adapter ?? getAdapter()
    if (adapter) {
      try {
        const pos = adapter.getMount(id)
        const src = (adapter as any).mountSource ?? '?'
        console.log(`[VFX_MOUNT] L1+ id=${id} pos=(${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}) src=${src}`)
        return pos
      } catch (e) {
        console.warn('[VFXManager] getMount error, fallback to CHAR_POS:', e)
      }
    } else {
      console.warn('[VFX_MOUNT] adapter=null + CharPosTracker=null, place character before triggering effects')
    }
    return fallback ?? CHAR_POS.clone()
  }

  /**  id → yFrac （  CharPosTracker ） */
  private _yFracForMount(id: MountPointId): number {
    switch (id) {
      case MountPointId.HEAD:
      case MountPointId.HEAD_TOP:   return 0.92
      case MountPointId.NECK:       return 0.82
      case MountPointId.CHEST:      return 0.65
      case MountPointId.WAIST:      return 0.48
      case MountPointId.ANKLE:
      case MountPointId.GROUND:     return 0.04
      case MountPointId.HAND_L:
      case MountPointId.HAND_R:     return 0.55
      case MountPointId.SKY_PROJ:   return 2.5   //
      default:                      return 0.50
    }
  }

  /**
   *  Y （  CharacterController probeGround ）
   *  Y=0，  Y=0 。
   * ：  footY（yFrac=0），  probeGround 
   */
  private _groundY(): number {
    return getCharWorldPos(0.0)?.y ?? 0
  }

  /**  MountAdapter，  */
  setAdapter(adapter: MountAdapter): void {
    this._adapter = adapter
  }

  /**
   *  sprite mesh（pixel-char pipeline ，  null）。
   * / / " " 。
   */
  setCharacterSprite(mesh: THREE.Mesh | null, worldHeight = 1.5): void {
    console.log('[VFX] setCharacterSprite', mesh?.name ?? null, 'h=', worldHeight)
    // ：  sprite， /opacity/scale
    if (this._charMesh && this._charMesh !== mesh) {
      this._restoreSpriteFromEffects(this._charMesh)
    }

    this._charMesh = mesh
    this._spriteDissolveMode = null
    this._spriteTeleportMode = null

    if (mesh) {
      this._charWorldHeight = worldHeight
      //  dummyMesh （ ）
      const initPos = getCharWorldPos(0.5)
      if (initPos) this.dummyMesh.position.copy(initPos)
      //  sprite：targetMesh = sprite mesh
      // teleport.update()  scale/visible，  material，
      this.teleport.targetMesh = mesh
      this.teleport.targetBaseScale = mesh.scale.x || 1.0
      this.charDummy.hide()                  //
      //  sprite  scale/visible/opacity。
      // visible  true：sprite " " ，  pipeline
      //  hide （await animator.ready） ；
      // false， / 。
      this._spriteOrigScale   = mesh.scale.x
      this._spriteOrigVisible = true
      const smat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshBasicMaterial
      this._spriteOrigOpacity = (smat && typeof smat.opacity === 'number') ? smat.opacity : 1.0
      //  sprite （dissolve ）
      if (smat?.color) this._spriteOrigColor.copy(smat.color)
      else this._spriteOrigColor.set(1, 1, 1)
      // dissolve  sprite material color/opacity
      // （  overlayScene ）
      this._setupHitFlashOverlay(mesh, worldHeight)
    } else {
      this._charWorldHeight = 1.2
      this.teleport.targetMesh = this.dummyMesh
      this.teleport.targetBaseScale = 1.0
      //
      this._spriteDissolveMode = null
      // Reset hit-flash state before overlay teardown. Without this the
      // next sprite we bind could inherit a stale _hitFlashAge ≥ 0 and see
      // a half-decayed overlay pulse on arrival. Also proactively drive
      // flashIntensity back to 0 so any still-live SpriteAnimator redraws
      // to a clean (non-white-overlaid) frame on its way out.
      this._setFlashIntensityCb?.(0)
      this._hitFlashAge = -1
      //
      this._setupHitFlashOverlay(null, 1.2)
    }
  }

  /**
   *  sprite  dissolve/teleport 。
   *  setCharacterSprite(null)  sprite ， " " 。
   */
  private _restoreSpriteFromEffects(mesh: THREE.Mesh): void {
    mesh.scale.setScalar(this._spriteOrigScale)
    mesh.visible = this._spriteOrigVisible
    //  dissolve ，  color / opacity
    if (this._spriteDissolveMode !== null) {
      const rawMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
      const mat = rawMat as THREE.MeshBasicMaterial
      if (mat && mat.color) {
        mat.color.copy(this._spriteOrigColor)
        mat.opacity = this._spriteOrigOpacity
        mat.transparent = false
        mat.needsUpdate = true
      }
    }
    this._spriteDissolveMode = null
  }

  /**  sprite（ ） */
  getCharacterSprite(): THREE.Mesh | null { return this._charMesh }

  /**
   * → 。 （  SpriteAnimator / CharacterController）
   * " " ， ：
   *   -  skill/ultimate/special： 
   *   -  run /  dash： （ ）
   *   -  attack： ；  COMBO_FINISHER_THRESHOLD 
   *      5 （ ）
   * （ ）。
   */
  onCharacterAction(actionId: string): void {
    const id = (actionId || '').toLowerCase()
    if (!id) return
    //  →  +  + （ ，  attack/hit ）
    if (id === 'hurt' || id.includes('hurt') || id.includes('damage') || id.includes('stagger')) {
      this.triggerHurt()
      return
    }
    //  /  /  →
    if (id.includes('ultimate') || id.includes('skill') || id.includes('special') ||
        id === 'ult' || id.endsWith('_big') || id.includes('finisher')) {
      this.fireWeaponSlash()
      return
    }
    // （shift）/  → （ ）
    // ： (J/ ) ** ** ，
    if (id === 'run' || id.includes('dash') || id.includes('roll')) {
      this.fireDashTrail()
      return
    }
    //  → ，  5
    if (id === 'attack' || id.startsWith('attack') || id.includes('hit') || id.includes('slash')) {
      const now = performance.now()
      // （ ）→
      if (now - this._lastAttackTime > this.COMBO_FINISHER_WINDOW_MS) {
        this._attackCount = 0
      }
      this._lastAttackTime = now
      this._attackCount++
      if (this._attackCount >= this.COMBO_FINISHER_THRESHOLD) {
        this._attackCount = 0
        this.attackFullCombo()   // ：  5
      } else {
        this.attack()            //
      }
      return
    }
  }
  /** （ ） */
  private _attackCount = 0
  private _lastAttackTime = 0
  /**  */
  private readonly COMBO_FINISHER_THRESHOLD = 5
  /** （ " "） */
  private readonly COMBO_FINISHER_WINDOW_MS = 1500

  /** DOM  */
  private frostOverlay: HTMLDivElement
  private frostTimer = 0
  private frostDuration = 2

  /**  — VFXPanel  */
  public readonly params: VFXParams = {
    slash: {
      elementOverride: '',
      radiusScale:   1.0,
      speedScale:    1.0,
      particleMult:  1.0,
      glowScale:     1.0,
      colorMix:      1.0,
    },
    starBlade: {
      chargeDuration:    0.8,
      bladeWidth:        0.6,
      bladeHeight:       5.0,
      fallHeight:        12.0,
      impactParticles:   50,
      bladeFallDuration: 0.4,
      bladeDelay:        0.25,
    },
    poison: {
      speed:        7,
      poolDuration: 5.0,
    },
    shield: {
      scale:      1.0,
      gridScale:  3.5,
      brightness: 1.0,
      flowSpeed:  1.0,
      hue:        0.0,
      distortion: 1.0,
    },
    dissolve: {
      duration: 1.5,
    },
    healAura: {
      radius:    1.2,
      speed:     1.5,
      hue:       0.0,
      intensity: 0.8,
    },
    ice: {
      speed: 10,
    },
    groundFrost: {
      duration: 4.0,
      radius:   4.5,
      density:  1.0,
    },
    screenFrost: {
      duration: 2.5,
    },
    bigFireball: {
      chargeTime:        0.35,
      hitRadius:         1.0,
      impactDuration:    1.60,
      explosionMaxScale: 3.8,
      flowSpeed:         1.5,
      explosionAlpha:    0.55,
      brightness:        0.72,
      hue:               0.0,
      colorMix:          0.0,
    },
    meteor: {
      warningTime:    1.2,
      fallHeight:     30,
      impactRadius:   2.2,
      explosionScale: 1.2,
      shockwaveScale: 5.5,
      smokeScale:     0.5,
      traumaAmount:   0.5,
      flashIntensity: 0.6,
      burnDuration:   5.0,
    },
    magicCannon: {
      chargeTime: 0.6,
      beamWidth:  0.8,
    },
    lightning: {
      chargeTime: 1.5,
    },
    vineStrike: {
      vineRadius: 2.2,
      vineHeight: 3.0,
    },
    weaponSlash: {
      ringRadius:  1.2,
      slashLength: 1.0,
      vortexSize:  1.0,
      duration:    0.60,
    },
    dashTrail: {
      streakCount: 5,
      maxLength:   3.8,
      duration:    0.42,
      hue:         0.0,
      scale:       1.4,
    },
  }

  constructor(private scene: THREE.Scene, private camera: THREE.Camera) {
    //
    this.sparkPS = new ParticleSystem(scene, 2000)
    this.magicPS = new ParticleSystem(scene, 3000)
    this.smokePS = new MistParticleSystem(scene, 500)
    this.snowflakePS = new SnowflakeParticleSystem(scene, 1000)

    // （ ）
    const geo = new THREE.SphereGeometry(0.6, 8, 8)
    const mat = new THREE.MeshStandardMaterial({ color: 0x8888ff, transparent: true, opacity: 0.0, depthWrite: false })
    this.dummyMesh = new THREE.Mesh(geo, mat)
    this.dummyMesh.position.copy(CHAR_POS)
    scene.add(this.dummyMesh)

    // （ ），  1.5
    this.charDummy = new CharDummy(scene)
    this.charDummy.group.scale.setScalar(1.5)
    this.charDummy.hide()   // ， /  show()

    //
    const poisonCfg = {
      magicPS: this.magicPS,
      smokePS: this.smokePS,
      addTrauma: (_a: number) => {},
      triggerFlash: (_r: number, _g: number, _b: number, _d: number, _i: number) => {},
    }
    this.poisonPool = new PoisonPoolEffect(scene, poisonCfg)
    this.poisonCloud = new PoisonCloudEffect(scene, poisonCfg)
    // ，
    this.poisonProjectile = new PoisonProjectile(scene, poisonCfg, this.poisonPool, (pos) => {
      // ，
      const cloudDur = this.params.poison.poolDuration * 0.5
      this.poisonCloud.trigger(pos, cloudDur)
    })

    //
    this.shield = new ShieldEffect(scene, this.dummyMesh, {
      sparkPS: this.sparkPS,
      magicPS: this.magicPS,
      camera: this.camera,
      addTrauma: (_a: number) => {},
      triggerFlash: (_r: number, _g: number, _b: number, _d: number, _i: number) => {},
    })

    //
    this.dissolve = new DissolveEffect()

    //
    this.teleport = new MagicTeleportEffect(scene, this.charDummy.group, {
      sparkPS: this.sparkPS,
      magicPS: this.magicPS,
      addTrauma: (_a: number) => {},
      triggerFlash: (_r: number, _g: number, _b: number, _d: number, _i: number) => {},
    })
    this.teleport.targetBaseScale = 1.5   //  charDummy.group

    //
    this.healAura = new HealAura(scene, this.magicPS)

    //
    this.iceProjectile = new IceProjectile(scene, {
      sparkPS: this.sparkPS,
      snowflakePS: this.snowflakePS,
      addTrauma: (_a: number) => {},
      triggerFlash: (_r: number, _g: number, _b: number, _d: number, _i: number) => {},
      triggerFrostScreen: (duration: number, _intensity: number) => {
        this.triggerScreenFrost(this.params.screenFrost.duration)
        void duration
      },
    })

    //
    this.groundFrost = new GroundFrostEffect(scene, this.snowflakePS)

    //
    this.combo = new ComboSystem(scene, {
      sparkPS: this.sparkPS,
      onFlash: (_r, _g, _b) => {},
      onTrauma: (_a) => {},
    })

    // ：  +  onTrauma  GameFeel
    this.starBlade = new StarBladeEffect(scene, {
      sparkPS: this.sparkPS,
      magicPS: this.magicPS,
      onTrauma: (a: number) => this._onImpactCallback?.(a),
      onFlash: (_r, _g, _b, _d, _i) => {},
    })

    //
    this.bigFireball = new BigFireballEffect(scene, camera)

    // （  addTrauma × 4 = （×2 ×2 ）， ）
    this.meteor = new MeteorEffect(scene, camera, {
      addTrauma: (amount: number) => this._onImpactCallback?.(amount * 4),
      triggerFlash: (_r, _g, _b, _d, _i) => {},
      // （ 3 ， 300ms）
      emitAsh: (pos: THREE.Vector3) => {
        for (let wave = 0; wave < 4; wave++) {
          setTimeout(() => {
            const wavePos = pos.clone().add(new THREE.Vector3(
              (Math.random() - 0.5) * 4,
              0.1,
              (Math.random() - 0.5) * 4,
            ))
            this.smokePS.emit({
              position: wavePos,
              count: 18,
              speed: [1.0, 3.5],
              lifetime: [1800, 3500],
              size: [0.4, 1.0],
              colorFrom: new THREE.Color(0.18, 0.15, 0.12),
              colorTo:   new THREE.Color(0.04, 0.03, 0.02),
              direction: new THREE.Vector3(0, 1, 0),
              spread: 0.6,
            })
            this.sparkPS.emit({
              position: wavePos.clone().add(new THREE.Vector3(0, 0.2, 0)),
              count: 8,
              speed: [2.0, 5.0],
              lifetime: [600, 1200],
              size: [0.15, 0.35],
              colorFrom: new THREE.Color(0.6, 0.4, 0.2),
              colorTo:   new THREE.Color(0.1, 0.08, 0.06),
              direction: new THREE.Vector3(0, 1, 0),
              spread: 0.9,
            })
          }, wave * 250)
        }
      },
    })

    //
    this.magicCannon = new MagicCannonEffect(scene, camera, {
      addTrauma: (amount: number) => this._onImpactCallback?.(amount),
      triggerFlash: (_r, _g, _b, _d, _i) => {},
    })

    // （ ：addTrauma × 2 ）
    this.lightning = new LightningAttackSystem(scene, {
      sparkPS: this.sparkPS,
      addTrauma: (amount: number) => this._onImpactCallback?.(amount * 2),
      triggerFlash: (_r, _g, _b, _d, _i) => {},
      triggerShockwave: (pos: THREE.Vector3, _color: THREE.Color) => {
        const sw = this.shockwaves.find(s => !s.active)
        sw?.trigger(pos)
      },
    }, camera)

    // （6 ）
    this.hitExplosions = createHitExplosionPool(scene, {
      sparkPS: this.sparkPS,
      smokePS: this.smokePS,
    }, 6)

    // （4 ）
    this.shockwaves = createShockwavePool(scene, 4)

    //
    this.vineStrike = new VineStrikeEffect(scene)

    //
    this.arcaneBlast = new ArcaneBlastEffect(scene, camera, {
      sparkPS: this.sparkPS,
      magicPS: this.magicPS,
      onTrauma: (amount: number) => this._onImpactCallback?.(amount),
      onFlash:  (_r, _g, _b, _d, _i) => {},
    })

    //
    this.weaponSlash = new WeaponSlashEffect(scene, camera)
    this.dashTrail   = new DashTrailEffect(scene, camera)

    // （  DOM）——  CSS，  styles.css
    VFXManager._injectFrostCSS()
    this.frostOverlay = document.createElement('div')
    this.frostOverlay.className = 'vfx-screen-frost'
    //  SVG ，
    const frostSVG = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    frostSVG.setAttribute('width', '100%')
    frostSVG.setAttribute('height', '100%')
    frostSVG.style.cssText = 'position:absolute;inset:0;overflow:hidden;filter:blur(7px);'
    frostSVG.innerHTML = `
      <defs>
        <filter id="vfx-frost-tex" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">
          <!-- ：  turbulence，  -->
          <feTurbulence type="turbulence" baseFrequency="0.006 0.045" numOctaves="5" seed="5" stitchTiles="stitch" result="streaks"/>
          <feColorMatrix in="streaks" type="matrix"
            values="0 0 0 0 0.78
                    0 0 0 0 0.92
                    0 0 0 0 1.00
                    0 0 0 5 -2.8"
            result="frostFilaments"/>
          <!-- ：  -->
          <feTurbulence type="fractalNoise" baseFrequency="0.06 0.04" numOctaves="3" seed="17" result="grain"/>
          <feColorMatrix in="grain" type="matrix"
            values="0 0 0 0 0.85
                    0 0 0 0 0.95
                    0 0 0 0 1.00
                    0 0 0 3 -1.7"
            result="frostGrain"/>
          <feMerge>
            <feMergeNode in="frostFilaments"/>
            <feMergeNode in="frostGrain"/>
          </feMerge>
        </filter>
        <!-- ：  0.38，  -->
        <radialGradient id="vfx-fc1" cx="0" cy="0" r="0.38" gradientUnits="objectBoundingBox">
          <stop offset="0%"   stop-color="white" stop-opacity="1"/>
          <stop offset="55%"  stop-color="white" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="white" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="vfx-fc2" cx="1" cy="0" r="0.38" gradientUnits="objectBoundingBox">
          <stop offset="0%"   stop-color="white" stop-opacity="1"/>
          <stop offset="55%"  stop-color="white" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="white" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="vfx-fc3" cx="0" cy="1" r="0.38" gradientUnits="objectBoundingBox">
          <stop offset="0%"   stop-color="white" stop-opacity="1"/>
          <stop offset="55%"  stop-color="white" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="white" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="vfx-fc4" cx="1" cy="1" r="0.38" gradientUnits="objectBoundingBox">
          <stop offset="0%"   stop-color="white" stop-opacity="1"/>
          <stop offset="55%"  stop-color="white" stop-opacity="0.5"/>
          <stop offset="100%" stop-color="white" stop-opacity="0"/>
        </radialGradient>
        <mask id="vfx-frost-mask">
          <rect width="100%" height="100%" fill="url(#vfx-fc1)"/>
          <rect width="100%" height="100%" fill="url(#vfx-fc2)"/>
          <rect width="100%" height="100%" fill="url(#vfx-fc3)"/>
          <rect width="100%" height="100%" fill="url(#vfx-fc4)"/>
        </mask>
      </defs>
      <rect width="100%" height="100%" filter="url(#vfx-frost-tex)" mask="url(#vfx-frost-mask)" opacity="0.92"/>
    `
    this.frostOverlay.appendChild(frostSVG)
    document.body.appendChild(this.frostOverlay)

    // （supply pixel-char pipeline → ）
    _vfxManagerInstance = this
    ;(window as any).__vfxManager = this
  }

  // ──────────────────────────────────────────────
  // （  params ）
  // ──────────────────────────────────────────────

  firePoison(): void {
    const start  = new THREE.Vector3(4, 4, 4)
    const target = new THREE.Vector3(0, 0.1, 0)
    this.poisonPool.duration = this.params.poison.poolDuration
    //  onImpact ，  setTimeout
    this.poisonProjectile.fire(start, target, this.params.poison.speed)
  }

  toggleShield(): void {
    this.dummyMesh.scale.setScalar(this._shieldBaseScale() * this.params.shield.scale)
    if (this.shield.state === 'idle') {
      this.shield.appear()
    } else {
      this.shield.break()
    }
  }

  hitShield(): void {
    if (this.shield.state === 'idle') {
      //
      this.dummyMesh.scale.setScalar(this._shieldBaseScale() * this.params.shield.scale)
      this.shield.appear()
      setTimeout(() => {
        const hitPos = this.shield.mesh.position.clone()
          .add(new THREE.Vector3(1.2 + Math.random() * 0.4, (Math.random() - 0.5) * 1.0, 0))
        this.shield.hit(hitPos)
      }, 1600)
    } else if (this.shield.state === 'active') {
      const hitPos = this.shield.mesh.position.clone()
        .add(new THREE.Vector3(1.2 + Math.random() * 0.4, (Math.random() - 0.5) * 1.0, 0))
      this.shield.hit(hitPos)
    }
  }

  breakShield(): void {
    if (this.shield.state === 'idle') {
      this.dummyMesh.scale.setScalar(this._shieldBaseScale() * this.params.shield.scale)
      this.shield.appear()
      setTimeout(() => this.shield.break(), 1600)
    } else {
      this.shield.break()
    }
  }

  /**  →  → （ ，  sprite） */
  triggerDissolve(): void {
    if (!this._charMesh) return
    if (this._spriteDissolveMode !== null) return
    const durMs = this.params.dissolve.duration * 1000
    this._spriteDissolveAutoReverse = true   // 'out'  'in'
    this._beginSpriteDissolve('out', durMs)
  }

  triggerDissolveOut(): void {
    console.log('[VFX] triggerDissolveOut _charMesh=', this._charMesh?.name, 'dissolveMode=', this._spriteDissolveMode)
    if (!this._charMesh) return
    if (this._spriteDissolveMode !== null) return
    const durMs = this.params.dissolve.duration * 1000
    this._spriteDissolveAutoReverse = false
    this._beginSpriteDissolve('out', durMs)
  }

  triggerDissolveIn(): void {
    console.log('[VFX] triggerDissolveIn _charMesh=', this._charMesh?.name, 'dissolveMode=', this._spriteDissolveMode)
    if (!this._charMesh) return
    if (this._spriteDissolveMode !== null) return
    const durMs = this.params.dissolve.duration * 1000
    this._spriteDissolveAutoReverse = false
    this._beginSpriteDissolve('in', durMs * 0.7)
  }

  /**
   *  sprite dissolve：  MeshBasicMaterial  color + opacity，
   *  ShaderMaterial， 。
   *
   *  (out)： （color → ）， （opacity → 0）。
   *  (in)： （opacity 0→1）， 。
   */
  private _beginSpriteDissolve(mode: 'out' | 'in', durationMs: number): void {
    const mesh = this._charMesh!
    // ：mesh.material
    const rawMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    const mat = rawMat as THREE.MeshBasicMaterial
    if (!mat || !mat.color) {
      console.warn('[VFXManager] dissolve: material has no color, type=', (rawMat as any)?.type ?? typeof rawMat)
      return
    }

    //  transparent （opacity ）
    if (!mat.transparent) {
      mat.transparent = true
      mat.needsUpdate = true
    }

    //  color/opacity（ ，  HealAura ）
    this._spriteOrigColor.copy(mat.color)
    this._spriteOrigOpacity = typeof mat.opacity === 'number' ? mat.opacity : 1.0

    this._spriteDissolveMode = mode
    this._spriteDissolveAge = 0
    this._spriteDissolveDuration = Math.max(100, durationMs)

    if (mode === 'in') {
      mesh.visible = true
      mat.opacity = 0
      mat.color.setRGB(1.6, 1.6, 1.6)   //
    } else {
      mesh.visible = true
      mat.opacity = 1.0
      mat.color.copy(this._spriteOrigColor)
    }

    console.log(`[VFX] dissolve ${mode} start — mesh=${mesh.name}`)
  }

  /**  sprite dissolve （color + opacity ），  update()  */
  private _updateSpriteDissolve(dtMs: number): void {
    if (!this._spriteDissolveMode || !this._charMesh) return
    const mesh = this._charMesh
    const rawMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    const mat = rawMat as THREE.MeshBasicMaterial
    if (!mat || !mat.color) return

    this._spriteDissolveAge += dtMs
    const t = Math.min(this._spriteDissolveAge / this._spriteDissolveDuration, 1)

    const WHITE = 1.6  // （ 1  ACESFilmic ）

    if (this._spriteDissolveMode === 'out') {
      // Phase 1 (t: 0→0.45): ，opacity  1
      // Phase 2 (t: 0.45→1.0): opacity  0，
      if (t <= 0.45) {
        const p = t / 0.45
        const w = p * p  // ease-in quad
        mat.color.setRGB(
          this._spriteOrigColor.r + (WHITE - this._spriteOrigColor.r) * w,
          this._spriteOrigColor.g + (WHITE - this._spriteOrigColor.g) * w,
          this._spriteOrigColor.b + (WHITE - this._spriteOrigColor.b) * w,
        )
        mat.opacity = 1.0
      } else {
        const p = (t - 0.45) / 0.55
        const fade = 1.0 - p * p * p  // ease-in cubic
        mat.color.setRGB(WHITE, WHITE, WHITE)
        mat.opacity = Math.max(0, fade)
      }

      if (t >= 1) {
        mesh.visible = false
        mat.color.copy(this._spriteOrigColor)
        mat.opacity = this._spriteOrigOpacity
        mat.transparent = false
        mat.needsUpdate = true
        this._spriteDissolveMode = null

        if (this._spriteDissolveAutoReverse) {
          this._spriteDissolveAutoReverse = false
          const durIn = this._spriteDissolveDuration * 0.7
          setTimeout(() => {
            if (this._charMesh) this._beginSpriteDissolve('in', durIn)
          }, 400)
        }
      }
    } else {
      // 'in'：Phase 1 (t: 0→0.5): opacity 0→1，
      // Phase 2 (t: 0.5→1.0):
      if (t <= 0.5) {
        const p = t / 0.5
        mat.opacity = 1 - (1 - p) * (1 - p)  // ease-out quad
        mat.color.setRGB(WHITE, WHITE, WHITE)
      } else {
        const p = (t - 0.5) / 0.5
        mat.opacity = 1.0
        const q = 1 - (1 - p) * (1 - p)  // ease-out quad
        mat.color.setRGB(
          WHITE + (this._spriteOrigColor.r - WHITE) * q,
          WHITE + (this._spriteOrigColor.g - WHITE) * q,
          WHITE + (this._spriteOrigColor.b - WHITE) * q,
        )
      }

      if (t >= 1) {
        mat.color.copy(this._spriteOrigColor)
        mat.opacity = this._spriteOrigOpacity
        mat.transparent = false
        mat.needsUpdate = true
        mesh.visible = true
        this._spriteDissolveMode = null
        this._spriteDissolveAutoReverse = false
      }
    }
  }

  /** ：  →  600ms →  */
  triggerTeleportOut(): void {
    console.log('[VFX] triggerTeleportOut _charMesh=', this._charMesh?.name, 'teleport.state=', this.teleport.state, 'pos=', this._charMesh?.position)
    if (this.teleport.state !== 'idle') return
    if (!this._charMesh) return
    this.teleport.groundY = this._groundY()
    //  600ms （ ）
    this.teleport.autoReappearAfterMs = 600
    this.teleport.disappear()
  }

  /** （ ， ） */
  triggerTeleportIn(): void {
    console.log('[VFX] triggerTeleportIn _charMesh=', this._charMesh?.name, 'teleport.state=', this.teleport.state)
    if (this.teleport.state !== 'idle') return
    if (!this._charMesh) return
    this.teleport.autoReappearAfterMs = 0
    this.teleport.groundY = this._groundY()
    this.teleport.appear()
  }

  /** VFXManager  sprite ：  sprite  scale/visible，  material */
  private _beginSpriteTeleport(mode: 'out' | 'in', durationMs: number): void {
    this._spriteTeleportMode = mode
    this._spriteTeleportAge = 0
    this._spriteTeleportDuration = Math.max(100, durationMs)
    const mesh = this._charMesh!
    if (mode === 'in') {
      // "  + "
      mesh.visible = true
      mesh.scale.setScalar(0.01 * this._spriteOrigScale)
    }
  }

  private _updateSpriteTeleport(dtMs: number): void {
    if (!this._spriteTeleportMode || !this._charMesh) return
    const mesh = this._charMesh
    this._spriteTeleportAge += dtMs
    const t = Math.min(this._spriteTeleportAge / this._spriteTeleportDuration, 1)

    if (this._spriteTeleportMode === 'out') {
      //  30% ；  ~0.7 * origScale，
      if (t > 0.3) {
        const k = (t - 0.3) / 0.5
        const scale = (1.0 - Math.min(k, 1) * 0.3) * this._spriteOrigScale
        mesh.scale.setScalar(scale)
      }
      if (t >= 1) {
        mesh.visible = false
        mesh.scale.setScalar(this._spriteOrigScale)   // ，  in
        this._spriteTeleportMode = null
      }
    } else {
      // 'in'：progress>0.2 ，progress<0.8  easeOutBack  1
      if (t > 0.2 && t < 0.8) {
        const a = (t - 0.2) / 0.6
        // easeOutBack(x): x<1
        const eb = (() => {
          const c1 = 1.70158
          const c3 = c1 + 1
          const x = Math.min(a, 1)
          return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
        })()
        mesh.scale.setScalar(eb * this._spriteOrigScale)
      }
      if (t >= 1) {
        mesh.visible = true
        mesh.scale.setScalar(this._spriteOrigScale)
        this._spriteTeleportMode = null
      }
    }
  }

  toggleHealAura(): void {
    const nowActive = !this.healAura.active
    this.healAura.setActive(nowActive)
    if (nowActive) {
      // ： （ / / / ） ，
      this._healAuraFg = this.healAura.getForegroundObjects()
      for (const obj of this._healAuraFg) {
        obj.renderOrder = 9050  // > sprite(100)，  overlayScene
        this._overlayScene?.add(obj)
      }
    } else {
      // ： ，  renderOrder
      for (const obj of this._healAuraFg) {
        obj.renderOrder = 0
        this.scene.add(obj)
      }
      this._healAuraFg = []
      //  sprite （  .color ）
      if (this._charMesh) {
        const rawMat = Array.isArray(this._charMesh.material) ? this._charMesh.material[0] : this._charMesh.material
        const mat = rawMat as THREE.MeshBasicMaterial
        if (mat && mat.color) mat.color.setRGB(1, 1, 1)
      }
    }
  }

  fireIceCombo(): void {
    const gY    = this._groundY()
    const chest = this._mount(MountPointId.CHEST)
    const start  = new THREE.Vector3(chest.x - 5, gY + 3, chest.z - 5)
    const target = new THREE.Vector3(chest.x, gY + 0.5, chest.z)
    this.iceProjectile.fire(start, target, this.params.ice.speed)
    //
    setTimeout(() => {
      this.groundFrost.duration = this.params.groundFrost.duration
      this.groundFrost.trigger(new THREE.Vector3(chest.x, gY, chest.z))
      // （ ）
      this._onImpactCallback?.(1.0)
    }, 400)
    //
    setTimeout(() => {
      this.triggerScreenFrost(this.params.screenFrost.duration)
    }, 600)
  }

  triggerGroundFrost(): void {
    const chest = this._mount(MountPointId.CHEST)
    this.groundFrost.duration = this.params.groundFrost.duration
    this.groundFrost.trigger(new THREE.Vector3(chest.x, this._groundY(), chest.z))
  }

  /**
   * " "yaw（  +Y，0  +Z）。
   * ：
   *   1) CharacterController.getAimYaw() —  WASD （  sprite ）
   *   2)  xz  — VFX 
   * ， ， 。
   */
  private _computeAimYaw(): number {
    const fromChar = getCharacterController()?.getAimYaw()
    if (fromChar != null) return fromChar
    const fwd = new THREE.Vector3()
    this.camera.getWorldDirection(fwd)
    fwd.y = 0
    if (fwd.lengthSq() < 1e-6) return 0
    return Math.atan2(fwd.x, fwd.z)
  }

  attack(): void {
    Object.assign(this.combo.params, this.params.slash)
    const waist = this._mount(MountPointId.WAIST)
    const aimYaw = this._computeAimYaw()
    const gY = this._groundY()
    const fired = this.combo.attack(waist.x, waist.z, gY, aimYaw)
    // ，  overlayScene
    if (this._charFacingCamera()) this._pushToFg(fired)
    // ：0.3
    this._onImpactCallback?.(0.3)
  }

  /** 5 ： ，  */
  attackFullCombo(): void {
    // 1.
    for (const t of this.comboTimeouts) clearTimeout(t)
    this.comboTimeouts = []
    // 2. ，
    this.combo.stopAllTrails()

    Object.assign(this.combo.params, this.params.slash)
    this.combo.resetCombo()

    // ： （  0 =  multiplier=1.0）
    this._acquireAndDamage(0)

    // （ms），  80ms
    const SLASH_MS = [160, 150, 180, 90, 210]
    // （ ： ， 5 ）
    const IMPACT_SCALE = [0.35, 0.40, 0.45, 0.50, 0.55]
    let delay = 0
    const fireOne = (idx: number): void => {
      const waist = this._mount(MountPointId.WAIST)
      const aimYaw = this._computeAimYaw()
      const gY = this._groundY()
      const fired = this.combo.attack(waist.x, waist.z, gY, aimYaw)
      if (this._charFacingCamera()) this._pushToFg(fired)
      this._onImpactCallback?.(IMPACT_SCALE[idx] ?? 0.3)
    }
    for (let i = 0; i < SLASH_MS.length; i++) {
      if (delay === 0) {
        fireOne(i)
      } else {
        const idx = i
        this.comboTimeouts.push(setTimeout(() => fireOne(idx), delay))
      }
      delay += SLASH_MS[i] + 80
    }
  }

  fireStarBlade(): void {
    Object.assign(this.starBlade.params, this.params.starBlade)
    const origin = this._mount(MountPointId.HEAD_TOP)
    this.starBlade.fire(new THREE.Vector3(origin.x, this._groundY(), origin.z))
    // onTrauma  cfg.onTrauma (0.6) (3.0) ，
    this._acquireAndDamage(5)   //  5，multiplier=8.0
  }

  fireBigFireball(): void {
    if (this.bigFireball.active) return
    const bp = this.params.bigFireball
    this.bigFireball.chargeTime        = bp.chargeTime
    this.bigFireball.hitRadius         = bp.hitRadius
    this.bigFireball.impactDuration    = bp.impactDuration
    this.bigFireball.explosionMaxScale = bp.explosionMaxScale
    this.bigFireball.flowSpeed         = bp.flowSpeed
    this.bigFireball.explosionAlpha    = bp.explosionAlpha
    this.bigFireball.brightness        = bp.brightness
    this.bigFireball.hue               = bp.hue
    this.bigFireball.colorMix          = bp.colorMix
    const chest  = this._mount(MountPointId.CHEST)
    const gY     = this._groundY()
    const start  = new THREE.Vector3(chest.x + 10, gY + 5, chest.z + 10)
    const target = new THREE.Vector3(chest.x, gY + 0.5, chest.z)
    this.bigFireball.fire(start, target)
  }

  fireMeteor(): void {
    if (this.meteor.active) return
    this.meteor.warningTime    = this.params.meteor.warningTime
    this.meteor.fallHeight     = this.params.meteor.fallHeight
    this.meteor.impactRadius   = this.params.meteor.impactRadius
    this.meteor.explosionScale = this.params.meteor.explosionScale
    this.meteor.shockwaveScale = this.params.meteor.shockwaveScale
    this.meteor.smokeScale     = this.params.meteor.smokeScale
    this.meteor.traumaAmount   = this.params.meteor.traumaAmount
    this.meteor.flashIntensity = this.params.meteor.flashIntensity
    this.meteor.burnDecalDuration = this.params.meteor.burnDuration
    const chest = this._mount(MountPointId.CHEST)
    this.meteor.cast(new THREE.Vector3(chest.x, this._groundY(), chest.z))
    //  MeteorEffect.cbs.addTrauma （× 2 ）
  }

  fireMagicCannon(): void {
    if (this.magicCannon.active) return
    this.magicCannon.chargeTime = this.params.magicCannon.chargeTime
    this.magicCannon.beamWidth  = this.params.magicCannon.beamWidth
    const chest = this._mount(MountPointId.CHEST)
    const gY    = this._groundY()
    const start  = new THREE.Vector3(chest.x, gY + 1.2, chest.z - 3)
    const target = new THREE.Vector3(chest.x, gY + 0.5, chest.z + 5)
    this.magicCannon.fire(start, target)
    // ： （ ）
    const delay = (this.params.magicCannon.chargeTime ?? 0.8) * 1000
    setTimeout(() => this._onImpactCallback?.(1.0), delay)
  }

  fireLightning(): void {
    if (this.lightning.state !== 'idle') return
    this.lightning.maxChargeTime = this.params.lightning.chargeTime
    const handPos = this._mount(MountPointId.HAND_R, CHAR_POS.clone().add(new THREE.Vector3(0, 0.8, 0)))
    this.lightning.startCharging(handPos, new THREE.Vector3(handPos.x, this._groundY(), handPos.z))
    // ： （ ）
    const delay = (this.params.lightning.chargeTime ?? 1.0) * 1000
    setTimeout(() => this._onImpactCallback?.(1.0), delay)
  }

  triggerHitExplosion(triggerImpact = true): void {
    const hit = this.hitExplosions.find(h => !h.active)
    if (!hit) return
    const chest = this._mount(MountPointId.CHEST, CHAR_POS.clone().add(new THREE.Vector3(0, 0.3, 0)))
    hit.trigger(chest.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 0.8)), this.camera)
    if (triggerImpact) this._onImpactCallback?.(1.0)   // ：
  }

  /** （  vfx pipeline  GameFeelSystem ）
   *  @param cb   scale （0.0–1.0） ，  GameFeelSystem.triggerImpact(scale) 
   */
  setImpactCallback(cb: ((scale: number) => void) | null): void {
    this._onImpactCallback = cb
  }

  /** （  pixel-char pipeline ，  VFXManager  sprite ）
   *   idle（ ）。
   */
  setPlayActionCallback(cb: ((actionId: string) => void) | null): void {
    this._playActionCallback = cb
  }

  /**
   * 「 」 ，  pixel-char  SpriteAnimator 。
   *  animator.flashIntensity  redrawCurrentFrame()。
   */
  setFlashIntensityCallback(cb: ((intensity: number) => void) | null): void {
    this._setFlashIntensityCb = cb
  }

  /** ， /  acquire  */
  setTargetSystem(sys: TargetAcquisitionSystem | null): void {
    this._targetSys = sys
  }

  /** （ ） */
  getTargetSystem(): TargetAcquisitionSystem | null { return this._targetSys }

  /**
   * 「 」 ，  VFX 。
   * ：targetId, damage, isCrit, 
   */
  setHitTargetCallback(cb: ((targetId: string, dmg: number, isCrit: boolean, pos: THREE.Vector3) => void) | null): void {
    this._onHitTargetCb = cb
  }

  /**
   * / ：  +  + 
   * @param skillIdx  DEFAULT_SKILL_COEFFS （0= ，5= ）
   */
  private _acquireAndDamage(skillIdx: number): void {
    if (!this._targetSys) return
    const charPos = getCharWorldPos() ?? CHAR_POS.clone()
    const ctrl = getCharacterController()
    // ： ，  z
    const faceYaw  = ctrl?.getAimYaw?.() ?? Math.PI
    const forward  = new THREE.Vector3(-Math.sin(faceYaw), 0, -Math.cos(faceYaw))
    const result   = this._targetSys.acquire({
      attackerPos:     charPos,
      attackerForward: forward,
      maxRange:        12,
      fovDeg:          360,   // （ ）
      enemyOnly:       true,
    })
    const target = result.locked
    if (!target) return
    //
    const skill  = DEFAULT_SKILL_COEFFS[skillIdx] ?? DEFAULT_SKILL_COEFFS[0]
    const dmgResult = calcSkillDamage(this._testStats, skill)
    this._onHitTargetCb?.(
      target.id,
      dmgResult.final,
      dmgResult.isCritical,
      target.position.clone().add(new THREE.Vector3(0, target.height * 0.8, 0)),
    )
  }

  /** @deprecated  setImpactCallback */
  setHurtCallback(cb: (() => void) | null): void {
    this._onImpactCallback = cb ? (_s: number) => cb() : null
  }

  /**
   * ：  sprite （  160ms ），
   *  +  GameFeel  + 。
   *  onCharacterAction('hurt') ， 。
   */
  triggerHurt(): void {
    // ①  hurt （  sprite  playAction ）
    this._playActionCallback?.('hurt')

    // ② ：  canvas source-atop （ ）+ Additive overlay（ ）
    if (this._charMesh && this._spriteDissolveMode === null) {
      // A) Canvas （ ： ，  alpha ）
      this._setFlashIntensityCb?.(1.0)
      // B) Additive overlay （ ）
      if (this._hitFlashOverlay && this._hitFlashOverlayMat) {
        this._hitFlashOverlay.position.copy(this._charMesh.position)
        this._hitFlashOverlay.quaternion.copy(this._charMesh.quaternion)
        this._hitFlashOverlay.scale.copy(this._charMesh.scale)
        this._hitFlashOverlayMat.opacity = 0.9
        this._hitFlashOverlay.visible = true
      } else if (!this._hitFlashOverlay && this._overlayScene) {
        this._setupHitFlashOverlay(this._charMesh, this._charWorldHeight)
      }
      this._hitFlashAge = 0
    }

    // ③ / （  impact， ）
    this.triggerHitExplosion(false)

    // ④  GameFeel（  + ），  0.75
    this._onImpactCallback?.(0.75)
  }

  triggerShockwave(): void {
    const sw = this.shockwaves.find(s => !s.active)
    if (!sw) return
    const chest = this._mount(MountPointId.CHEST)
    sw.trigger(new THREE.Vector3(chest.x, this._groundY() + 0.05, chest.z))
  }

  fireVineStrike(): void {
    if (this.vineStrike.active) return
    this.vineStrike.vineRadius = this.params.vineStrike.vineRadius
    this.vineStrike.vineHeight = this.params.vineStrike.vineHeight
    const chest = this._mount(MountPointId.CHEST)
    this.vineStrike.cast(new THREE.Vector3(chest.x, this._groundY(), chest.z))
  }

  fireArcaneBlast(): void {
    this.arcaneBlast.fire()
  }

  fireWeaponSlash(): void {
    //  active —— （ ）
    const ws = this.params.weaponSlash
    this.weaponSlash.ringRadius  = ws.ringRadius
    this.weaponSlash.slashLength = ws.slashLength
    this.weaponSlash.vortexSize  = ws.vortexSize
    this.weaponSlash.duration    = ws.duration
    const chest = this._mount(MountPointId.CHEST)
    console.log(`[fireWeaponSlash] cast at (${chest.x.toFixed(2)}, ${chest.z.toFixed(2)}) groundY=${this._groundY().toFixed(2)}`)
    this.weaponSlash.cast(new THREE.Vector3(chest.x, this._groundY(), chest.z))
    // ：
    this._onImpactCallback?.(0.3)
    this._acquireAndDamage(0)   //
  }

  fireDashTrail(): void {
    const gY = this._groundY()
    const mountY = gY + 0.70
    const waist  = this._mount(MountPointId.WAIST)
    const spriteDir = getCharacterController()?.getSpriteDirection()

    // ，
    const spineOff = this._dashSpineOffset(spriteDir)
    const mount = new THREE.Vector3(waist.x + spineOff.x, mountY, waist.z + spineOff.z)

    const aimYaw   = this._computeAimYaw()
    const trailDir = new THREE.Vector3(Math.sin(aimYaw), 0, Math.cos(aimYaw))
    this.dashTrail.fire(mount, trailDir)

    // （Shift+W, 'up'） ，
    if (spriteDir === 'up' && this._overlayScene) {
      this._pushToFg(this.dashTrail.getForegroundObjects())
    }
  }

  /** 。dirX/dirZ  -1 / 0 / 1 */
  startDash(dirX: number, dirZ: number): void {
    const dist  = 2.4
    const origin = this._mount(MountPointId.WAIST, CHAR_POS.clone())
    const tx = origin.x + dirX * dist
    const tz = origin.z + dirZ * dist
    this._dashOrigin.copy(origin)
    this._dashTarget.set(tx, origin.y, tz)
    this._dashActive = true
    this._dashAge    = 0
    const dir = new THREE.Vector3(tx - origin.x, 0, tz - origin.z).normalize()
    if (dir.lengthSq() > 0.001) this.dashTrail.fire(origin.clone(), dir)
  }

  /**  */
  resetDummyPos(): void {
    CHAR_POS.set(0, 0.67, 0)
    this._syncDummyMesh()
    this._dashActive = false
  }

  private _syncDummyMesh(): void {
    this.dummyMesh.position.copy(CHAR_POS)
    this.charDummy.group.position.set(CHAR_POS.x, this._groundY(), CHAR_POS.z)
  }

  triggerScreenFrost(duration = this.params.screenFrost.duration): void {
    this.frostTimer    = duration
    this.frostDuration = duration
    this.frostOverlay.style.opacity = '1'
    this.frostOverlay.classList.add('active')
  }

  // ──────────────────────────────────────────────
  // （dt ： ）
  // ──────────────────────────────────────────────

  update(dt: number): void {
    const ms = dt * 1000

    //  __pixel_sprite mesh（  HMR  pipeline ）。
    // ：
    //  - selective / scene ：sprite  world.scene
    //  - overlay ：sprite  overlayScene
    if (!this._charMesh) {
      const candidates: THREE.Scene[] = []
      if (this.scene) candidates.push(this.scene)
      if (this._overlayScene && this._overlayScene !== this.scene) candidates.push(this._overlayScene)
      for (const s of candidates) {
        if (this._charMesh) break
        s.traverse((obj) => {
          if (!this._charMesh && obj instanceof THREE.Mesh && obj.name === '__pixel_sprite') {
            console.log('[VFX] auto-discovered __pixel_sprite, calling setCharacterSprite')
            this.setCharacterSprite(obj as THREE.Mesh)
          }
        })
      }
    }

    //  dummyMesh（ / ）
    if (this._charMesh) {
      const charCenter = getCharWorldPos(0.5)
      if (charCenter) this.dummyMesh.position.copy(charCenter)
    }

    this.sparkPS.update(ms)
    this.magicPS.update(ms)
    this.smokePS.update(ms)
    this.snowflakePS.update(ms)

    this.poisonProjectile.update(ms)
    this.poisonPool.update(ms)
    this.poisonCloud.update(ms)
    //  shader
    if (this.shield.active) {
      const su = this.shield.mat.uniforms
      su.uGridScale.value  = this.params.shield.gridScale
      su.uBrightness.value = this.params.shield.brightness
      su.uFlowSpeed.value  = this.params.shield.flowSpeed
      su.uHue.value        = this.params.shield.hue
      su.uDistortion.value = this.params.shield.distortion
    }
    this.shield.update(ms)
    this.dissolve.update(ms)
    // sprite dissolve （overlay + sprite opacity fade，  sprite material）
    this._updateSpriteDissolve(ms)
    this.teleport.update(ms)  //  _charMesh.scale/visible（targetMesh = _charMesh）
    this.healAura.applyColor(this.params.healAura.hue, this.params.healAura.intensity)
    // ：  getCharWorldPos(0) ，  =
    // （_charMesh.position  overlayScene ， ）
    const _charFeet2 = getCharWorldPos(0.0)
    const _healPos = new THREE.Vector3(
      _charFeet2?.x ?? CHAR_POS.x,
      this._groundY(),
      _charFeet2?.z ?? CHAR_POS.z,
    )
    this.healAura.update(ms, _healPos, this.params.healAura.radius, this.params.healAura.speed)

    // ── Sprite ：  ──────
    // ，  tint
    // ：  mesh  ShaderMaterial / ，  .color ，  setRGB
    if (this.healAura.active && this._charMesh && this._hitFlashAge < 0) {
      const rawMat = Array.isArray(this._charMesh.material) ? this._charMesh.material[0] : this._charMesh.material
      const mat = rawMat as THREE.MeshBasicMaterial
      if (mat && mat.color) {
        const pulse = this.healAura.getPulse()   // 0.0 – 1.0 breathing rhythm
        // ：R/B ，G ，
        const tintR = 0.80 + 0.12 * pulse
        const tintG = 0.92 + 0.08 * pulse
        const tintB = 0.82 + 0.10 * pulse
        mat.color.setRGB(tintR, tintG, tintB)
      }
    }
    this.iceProjectile.update(ms)
    //
    const gfMat = this.groundFrost.mesh.material as import('three').ShaderMaterial
    gfMat.uniforms.uRadius.value  = this.params.groundFrost.radius
    gfMat.uniforms.uDensity.value = this.params.groundFrost.density
    this.groundFrost.update(ms)
    this.combo.update(dt)
    this.starBlade.update(dt)

    this.bigFireball.update(dt)
    //  uniform（slider ， ）
    if (this.bigFireball.active) {
      const bp = this.params.bigFireball
      this.bigFireball.explosionMat.uniforms.uFlowSpeed.value = bp.flowSpeed
      this.bigFireball.explosionMat.uniforms.uAlpha.value     = bp.explosionAlpha
    }
    this.meteor.update(dt)
    this.magicCannon.update(dt)
    this.lightning.update(ms)
    const time = performance.now() * 0.001
    this.hitExplosions.forEach(h => h.update(ms, this.camera, time))
    this.shockwaves.forEach(s => s.update(ms))
    this.vineStrike.update(dt)
    this.arcaneBlast.update(ms)
    this.weaponSlash.update(dt)
    this.dashTrail.setHue(this.params.dashTrail.hue)
    this.dashTrail.setScale(this.params.dashTrail.scale)
    // ：  getCharWorldPos （_charMesh.position  overlayScene ）
    const _charFeet = getCharWorldPos(0.0)
    const _spineOff = this._dashSpineOffset(getCharacterController()?.getSpriteDirection())
    const _dashPos = new THREE.Vector3(
      (_charFeet?.x ?? CHAR_POS.x) + _spineOff.x,
      this._groundY() + 0.70,
      (_charFeet?.z ?? CHAR_POS.z) + _spineOff.z,
    )
    this.dashTrail.update(dt, _dashPos)

    // ：
    this._cleanupFgObjects()

    //
    if (this._dashActive) {
      this._dashAge += dt
      const t = Math.min(this._dashAge / this.DASH_DUR, 1)
      // easeOutQuart
      const e = 1 - Math.pow(1 - t, 4)
      CHAR_POS.lerpVectors(this._dashOrigin, this._dashTarget, e)
      this._syncDummyMesh()
      if (t >= 1) this._dashActive = false
    }

    //
    if (this.frostTimer > 0) {
      this.frostTimer -= dt
      const intensity = Math.min(this.frostTimer / this.frostDuration, 1)
      this.frostOverlay.style.opacity = String(intensity.toFixed(3))
      if (this.frostTimer <= 0) {
        this.frostOverlay.classList.remove('active')
        this.frostOverlay.style.opacity = '0'
      }
    }

    // ：canvas flashIntensity  + overlay
    if (this._hitFlashAge >= 0 && this._charMesh && this._spriteDissolveMode === null) {
      this._hitFlashAge += ms
      const t = Math.min(this._hitFlashAge / this._hitFlashDuration, 1)
      // A)  SpriteAnimator  canvas （  redraw）
      this._setFlashIntensityCb?.(1.0 - t)
      // B) overlay
      if (this._hitFlashOverlay && this._hitFlashOverlayMat) {
        this._hitFlashOverlay.position.copy(this._charMesh.position)
        this._hitFlashOverlay.quaternion.copy(this._charMesh.quaternion)
        this._hitFlashOverlay.scale.copy(this._charMesh.scale)
        this._hitFlashOverlayMat.opacity = 0.9 * (1 - t)
      }
      if (t >= 1) {
        this._setFlashIntensityCb?.(0)
        if (this._hitFlashOverlay && this._hitFlashOverlayMat) {
          this._hitFlashOverlay.visible = false
          this._hitFlashOverlayMat.opacity = 0  // ：visible=false  alpha
        }
        this._hitFlashAge = -1
      }
    } else if (this._hitFlashAge >= 0) {
      // dissolve
      this._setFlashIntensityCb?.(0)
      if (this._hitFlashOverlay && this._hitFlashOverlayMat) {
        this._hitFlashOverlay.visible = false
        this._hitFlashOverlayMat.opacity = 0
      }
      this._hitFlashAge = -1
    }

    // ── Safety net: overlay  _hitFlashAge  ───────────────
    //
    //  bug：  _hitFlashOverlay （visible=true + opacity≈0.9）
    //  _hitFlashAge  >=1 （  _charMesh 、dissolve
    // 、update  tick ）， 。
    //
    // ：  _hitFlashAge < 0（" "）  overlay ，
    // 。  triggerHurt  overlay 。
    if (this._hitFlashAge < 0 && this._hitFlashOverlay && this._hitFlashOverlayMat) {
      if (this._hitFlashOverlay.visible || this._hitFlashOverlayMat.opacity > 0) {
        this._hitFlashOverlay.visible = false
        this._hitFlashOverlayMat.opacity = 0
      }
    }
  }

  dispose(): void {
    this.sparkPS.dispose()
    this.magicPS.dispose()
    this.smokePS.dispose()
    this.snowflakePS.dispose()
    this.poisonProjectile.dispose()
    this.poisonPool.dispose()
    this.poisonCloud.dispose()
    this.shield.dispose()
    this.dissolve.material.dispose()
    this.teleport.dispose()
    this.healAura.dispose()
    this.iceProjectile.dispose()
    this.groundFrost.dispose()
    this.combo.dispose()
    this.starBlade.dispose()
    this.bigFireball.dispose()
    this.meteor.dispose()
    this.magicCannon.dispose()
    this.lightning.dispose()
    this.hitExplosions.forEach(h => h.dispose())
    this.shockwaves.forEach(s => s.dispose())
    this.vineStrike.dispose()
    this.arcaneBlast.dispose()
    this.dashTrail.dispose()
    this.charDummy.dispose()
    this.scene.remove(this.dummyMesh)
    this.dummyMesh.geometry.dispose()
    ;(this.dummyMesh.material as THREE.Material).dispose()
    this.frostOverlay.remove()
    //
    if (this._hitFlashOverlay) {
      this._overlayScene?.remove(this._hitFlashOverlay)
      this._hitFlashOverlayMat?.dispose()
      this._hitFlashOverlay = null
      this._hitFlashOverlayMat = null
    }
    if (_vfxManagerInstance === this) {
      _vfxManagerInstance = null
      try { delete (window as any).__vfxManager } catch {}
    }
  }

  // ── ：  frost overlay CSS（ ）──────────
  private static _frostCSSInjected = false
  private static _injectFrostCSS(): void {
    if (VFXManager._frostCSSInjected) return
    VFXManager._frostCSSInjected = true
    const style = document.createElement('style')
    style.id = 'vfx-frost-style'
    style.textContent = `
      .vfx-screen-frost {
        display: none;
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 9999;
        opacity: 0;
        overflow: hidden;
        background:
          radial-gradient(ellipse 38% 38% at 0% 0%,   rgba(120,195,255,.28) 0%, rgba(100,170,255,.08) 50%, transparent 70%),
          radial-gradient(ellipse 38% 38% at 100% 0%,  rgba(120,195,255,.28) 0%, rgba(100,170,255,.08) 50%, transparent 70%),
          radial-gradient(ellipse 38% 38% at 0% 100%,  rgba(120,195,255,.28) 0%, rgba(100,170,255,.08) 50%, transparent 70%),
          radial-gradient(ellipse 38% 38% at 100% 100%,rgba(120,195,255,.28) 0%, rgba(100,170,255,.08) 50%, transparent 70%);
      }
      .vfx-screen-frost.active { display: block; }
    `
    document.head.appendChild(style)
  }
}
