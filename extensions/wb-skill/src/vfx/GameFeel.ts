// @source wb-character/src/vfx/GameFeel.ts
/**
 * GameFeel — 
 *
 * impact ：
 *   1. Camera Shake —  camera.position 
 *   2. Exposure Pulse —  renderer.toneMappingExposure 
 *   3. Hit Flash —  exposure （  PostProcess setHitFlash）
 *
 * ，  bloom ； 
 * renderer  toneMappingExposure，  forward render 。
 */

import * as THREE from 'three'

export interface GameFeelConfig {
  shakeAmplitude:  number
  shakeDuration:   number
  /**  toneMappingExposure （0–1） */
  bloomBoost:      number
  /** （0–1） */
  flashIntensity:  number
  flashDuration:   number
}

export const DEFAULT_GAMEFEEL: GameFeelConfig = {
  shakeAmplitude: 0.06,
  shakeDuration:  0.18,
  bloomBoost:     0.10,
  flashIntensity: 0.12,
  flashDuration:  0.10,
}

export class GameFeelSystem {
  private camera:   THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer

  public config: GameFeelConfig = { ...DEFAULT_GAMEFEEL }

  // ── Camera Shake state ──────────────────────────────────────────
  private shakeAmp     = 0
  private shakeDur     = 0
  private shakeT       = -1
  private shakeOffset  = new THREE.Vector3()

  // ── Exposure Pulse state ────────────────────────────────────────
  private exposureBase = 1.0
  private exposureExtra = 0

  // ── Screen Hit Flash state ──────────────────────────────────────
  private hitFlashT   = -1
  private hitFlashDur = 0
  private hitFlashPeak = 0

  constructor(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
    this.camera = camera
    this.renderer = renderer
    this.exposureBase = renderer.toneMappingExposure
  }

  /**
   * 
   * @param scale  0.0–1.0+
   */
  triggerImpact(scale = 1.0): void {
    const s = Math.max(0, scale)
    const { shakeAmplitude, shakeDuration, bloomBoost, flashIntensity, flashDuration } = this.config

    this.camera.position.sub(this.shakeOffset)
    this.shakeOffset.set(0, 0, 0)
    this.shakeAmp = shakeAmplitude * s
    this.shakeDur = shakeDuration
    this.shakeT   = 0

    if (bloomBoost > 0) {
      this.exposureBase = this.renderer.toneMappingExposure
      this.exposureExtra = bloomBoost * s
      this._applyExposure()
    }

    if (flashIntensity > 0) {
      this.triggerHitFlash(flashDuration, flashIntensity * s)
    }
  }

  triggerHitFlash(duration = 0.16, peakIntensity = 0.35): void {
    this.hitFlashT    = 0
    this.hitFlashDur  = duration
    this.hitFlashPeak = peakIntensity
  }

  update(dt: number): void {
    this._updateShake(dt)
    this._updateExposure(dt)
    this._updateHitFlash(dt)
  }

  private _updateShake(dt: number): void {
    if (this.shakeT < 0) return

    this.camera.position.sub(this.shakeOffset)

    this.shakeT += dt
    const progress = Math.min(this.shakeT / this.shakeDur, 1.0)

    if (progress >= 1.0) {
      this.shakeOffset.set(0, 0, 0)
      this.shakeT = -1
      return
    }

    const decay = 1 - progress * progress * progress
    const amp   = this.shakeAmp * decay

    const t = this.shakeT * 30
    this.shakeOffset.set(
      (Math.sin(t * 2.3 + 0.5) * 0.65 + Math.sin(t * 4.1 + 1.3) * 0.35) * amp,
      (Math.sin(t * 1.9 + 2.1) * 0.50 + Math.sin(t * 3.7 + 0.7) * 0.50) * amp * 0.4,
      (Math.sin(t * 2.7 + 1.8) * 0.60 + Math.sin(t * 5.3 + 0.2) * 0.40) * amp,
    )

    this.camera.position.add(this.shakeOffset)
  }

  private _updateExposure(dt: number): void {
    if (this.exposureExtra <= 0) return
    this.exposureExtra = Math.max(0, this.exposureExtra - dt * 5.5)
    this._applyExposure()
  }

  private _applyExposure(): void {
    //  hit-flash  _updateHitFlash
    this.renderer.toneMappingExposure = this.exposureBase + this.exposureExtra
  }

  private _updateHitFlash(dt: number): void {
    if (this.hitFlashT < 0) return

    this.hitFlashT += dt
    const p    = this.hitFlashT / this.hitFlashDur
    const peak = this.hitFlashPeak

    let intensity: number
    if (p < 0.12) {
      const tri = 1 - Math.abs(p / 0.06 - 1)
      intensity = peak * Math.max(tri, 0)
    } else if (p < 1.0) {
      const fadeP = (p - 0.12) / 0.88
      intensity = peak * 0.15 * (1 - fadeP * fadeP * fadeP)
    } else {
      this.hitFlashT = -1
      this.renderer.toneMappingExposure = this.exposureBase + this.exposureExtra
      return
    }

    this.renderer.toneMappingExposure = this.exposureBase + this.exposureExtra + intensity
  }
}
