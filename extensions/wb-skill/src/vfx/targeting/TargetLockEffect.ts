// @source wb-character/src/vfx/targeting/TargetLockEffect.ts
/**
 * TargetLockEffect — 
 *
 * ：
 *   L1  4  L （ ，Billboard）
 *   L2  （ ， ）
 *   L3  （ ： → ）
 *
 * （ ） （ + ） 。
 */

import * as THREE from 'three'
import { type TargetInfo, type LockState, LOCK_COLORS, getLockColor } from './TargetTypes'

// ───  ─────────────────────────────────────────────────────────────────

function makeCornerLine(size: number, mat: THREE.LineBasicMaterial): THREE.Line {
  // 4  L （  2 ）
  const s = size
  const g = size * 0.35
  const pts = [
    //
    new THREE.Vector3(-s,  s, 0), new THREE.Vector3(-s + g,  s, 0),
    new THREE.Vector3(-s,  s, 0), new THREE.Vector3(-s,  s - g, 0),
    //
    new THREE.Vector3( s,  s, 0), new THREE.Vector3( s - g,  s, 0),
    new THREE.Vector3( s,  s, 0), new THREE.Vector3( s,  s - g, 0),
    //
    new THREE.Vector3(-s, -s, 0), new THREE.Vector3(-s + g, -s, 0),
    new THREE.Vector3(-s, -s, 0), new THREE.Vector3(-s, -s + g, 0),
    //
    new THREE.Vector3( s, -s, 0), new THREE.Vector3( s - g, -s, 0),
    new THREE.Vector3( s, -s, 0), new THREE.Vector3( s, -s + g, 0),
  ]
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  return new THREE.LineSegments(geo, mat)
}

// ───  ──────────────────────────────────────────────────────────────

function makeTriangle(size: number, mat: THREE.LineBasicMaterial): THREE.Line {
  const s = size
  const pts = [
    new THREE.Vector3(0, s, 0),
    new THREE.Vector3(-s * 0.6, 0, 0),
    new THREE.Vector3( s * 0.6, 0, 0),
    new THREE.Vector3(0, s, 0),
  ]
  const geo = new THREE.BufferGeometry().setFromPoints(pts)
  return new THREE.Line(geo, mat)
}

// ───  ──────────────────────────────────────────────────────────────────────

export class TargetLockEffect {
  private group:     THREE.Group
  private frame:     THREE.Line
  private frameMat:  THREE.LineBasicMaterial
  private indicator: THREE.Line
  private indMat:    THREE.LineBasicMaterial
  private connLine:  THREE.Line
  private connMat:   THREE.LineBasicMaterial

  private lockState:  LockState = 'none'
  private lockTimer:  number = 0
  private lockTarget: TargetInfo | null = null
  private lockDuration = 0.35  // （ ）

  private scanAngle = 0  //

  constructor(private scene: THREE.Scene) {
    // （ ）
    this.frameMat = new THREE.LineBasicMaterial({
      color: 0xff2222, transparent: true, opacity: 0, depthTest: false,
    })
    this.indMat = new THREE.LineBasicMaterial({
      color: 0xff2222, transparent: true, opacity: 0, depthTest: false,
    })
    this.connMat = new THREE.LineBasicMaterial({
      color: 0xff2222, transparent: true, opacity: 0, depthTest: false,
      linewidth: 1,
    })

    this.frame     = makeCornerLine(0.5, this.frameMat)
    this.indicator = makeTriangle(0.18, this.indMat)
    this.connLine  = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(), new THREE.Vector3(),
    ]), this.connMat)

    this.frame.renderOrder     = 3000
    this.indicator.renderOrder = 3000
    this.connLine.renderOrder  = 2999

    this.group = new THREE.Group()
    this.group.add(this.frame, this.indicator)
    scene.add(this.group)
    scene.add(this.connLine)
  }

  /**  */
  lock(target: TargetInfo): void {
    this.lockTarget = target
    this.lockState  = 'soft'
    this.lockTimer  = 0
  }

  /** （ ） */
  hardLock(): void {
    if (this.lockState === 'soft' || this.lockTarget) {
      this.lockState = 'hard'
    }
  }

  /**  */
  unlock(): void {
    this.lockState  = 'none'
    this.lockTarget = null
    this.frameMat.opacity = 0
    this.indMat.opacity   = 0
    this.connMat.opacity  = 0
  }

  update(dt: number, camera: THREE.Camera, attackerPos?: THREE.Vector3): void {
    if (!this.lockTarget || this.lockState === 'none') {
      this.frameMat.opacity = 0
      this.indMat.opacity   = 0
      this.connMat.opacity  = 0
      return
    }

    const target = this.lockTarget
    const progress = this.lockState === 'hard' ? 1.0
                   : Math.min(this.lockTimer / this.lockDuration, 1.0)

    // ：
    if (this.lockState === 'soft') {
      this.lockTimer += dt
      if (this.lockTimer >= this.lockDuration) this.lockState = 'hard'
    }

    //  &
    const col = getLockColor(target.relation, progress)
    this.frameMat.color.copy(col)
    this.indMat.color.copy(col)
    this.connMat.color.copy(col)

    // ：0.6s
    const blink = this.lockState === 'hard'
      ? 0.7 + Math.sin(Date.now() * 0.008) * 0.3
      : 0.4 + progress * 0.5
    this.frameMat.opacity = blink
    this.indMat.opacity   = blink * 0.9

    // ── （ ），Billboard  ──
    const framePos = target.position.clone().setY(target.position.y + target.height * 0.5)
    this.group.position.copy(framePos)
    this.group.quaternion.copy(camera.quaternion)

    //
    if (this.lockState === 'soft') {
      this.scanAngle += dt * 120  // /
      this.frame.rotation.z = (this.scanAngle * Math.PI / 180)
    } else {
      this.frame.rotation.z = 0
    }

    // （ ）
    const scaleStart = 1.6
    const scaleEnd   = 1.0
    const scale = scaleStart + (scaleEnd - scaleStart) * progress
    this.frame.scale.setScalar(scale)

    // ── （  + 0.25， ）──
    const indPos = target.position.clone().setY(target.position.y + target.height + 0.25)
    this.indicator.position.copy(indPos)
    this.indicator.quaternion.copy(camera.quaternion)
    //
    this.indicator.position.y += Math.sin(Date.now() * 0.003) * 0.04

    // ── （ → ）──
    if (this.lockState === 'hard' && attackerPos) {
      const from = attackerPos.clone().setY(attackerPos.y + 1.0)
      const to   = framePos
      const pts  = [from, to]
      this.connLine.geometry.setFromPoints(pts)
      this.connLine.geometry.attributes.position.needsUpdate = true
      this.connMat.opacity = blink * 0.3
    } else {
      this.connMat.opacity = 0
    }
  }

  dispose(): void {
    this.scene.remove(this.group, this.connLine)
    this.frameMat.dispose()
    this.indMat.dispose()
    this.connMat.dispose()
  }

  get currentTarget(): TargetInfo | null { return this.lockTarget }
  get state(): LockState { return this.lockState }
}
