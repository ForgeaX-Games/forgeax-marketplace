// @source wb-character/src/vfx/effects/hit/DamageNumber.ts
/**
 * DamageNumber — 
 *
 *  DOM overlay （CSS ），
 *  Three.js drawcall， 。
 *  Three.js canvas  position:relative。
 */

import type { WorldStyleEntry } from '../../style/WorldStylePalette'

export type DamageType =
  | 'normal'    //
  | 'critical'  //
  | 'skill'     //
  | 'heal'      //
  | 'block'     //
  | 'miss'      //

export interface DamageNumberOptions {
  /** （  / ） */
  value: number | string
  /**  */
  type: DamageType
  /** （canvas ）*/
  screenX: number
  screenY: number
  /** （ ， ） */
  worldStyle?: WorldStyleEntry['particleStyle']
  /** （ ，skill ） */
  elementHex?: string
}

interface ActiveLabel {
  el: HTMLElement
  startTime: number
  duration: number
}

const STYLE_ID = 'damage-number-styles-vfx2'

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return
  const s = document.createElement('style')
  s.id = STYLE_ID
  s.textContent = `
    .dmg-num {
      position: absolute;
      pointer-events: none;
      font-weight: 900;
      text-shadow: 0 1px 4px rgba(0,0,0,0.8), 0 0 8px currentColor;
      white-space: nowrap;
      user-select: none;
      transform-origin: center bottom;
      animation: dmgFloat 0.8s cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
    }
    .dmg-num.critical {
      animation: dmgCrit 1.2s cubic-bezier(0.2, 1.2, 0.4, 1) forwards;
    }
    .dmg-num.heal {
      animation: dmgHeal 1.0s ease-out forwards;
    }
    @keyframes dmgFloat {
      0%   { opacity: 1; transform: translateY(0) scale(1); }
      20%  { opacity: 1; transform: translateY(-18px) scale(1.1); }
      100% { opacity: 0; transform: translateY(-50px) scale(0.8); }
    }
    @keyframes dmgCrit {
      0%   { opacity: 1; transform: translateY(0) scale(1.5); }
      15%  { opacity: 1; transform: translateY(-10px) scale(1.8); }
      40%  { opacity: 1; transform: translateY(-30px) scale(1.4); }
      100% { opacity: 0; transform: translateY(-70px) scale(0.9); }
    }
    @keyframes dmgHeal {
      0%   { opacity: 0.9; transform: translateY(0) scale(1); }
      30%  { opacity: 1; transform: translateY(-20px) scale(1.05); }
      100% { opacity: 0; transform: translateY(-55px) scale(0.85); }
    }
    /* cyberpunk style: glitch effect */
    .dmg-num.style-hex {
      font-family: 'Courier New', monospace;
      letter-spacing: 2px;
      animation-timing-function: steps(8, end);
    }
    /* steam/mech: bold serif */
    .dmg-num.style-gear {
      font-family: Georgia, serif;
      letter-spacing: 1px;
    }
  `
  document.head.appendChild(s)
}

export class DamageNumber {
  private container: HTMLElement
  private active: ActiveLabel[] = []

  constructor(container: HTMLElement) {
    injectStyles()
    this.container = container
    //
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative'
    }
  }

  /**  */
  spawn(opts: DamageNumberOptions): void {
    const el = document.createElement('div')
    el.className = 'dmg-num'

    const { text, color, size, duration } = this.buildStyle(opts)
    el.textContent = text
    el.style.color    = color
    el.style.fontSize = `${size}px`
    el.style.left     = `${opts.screenX - size}px`
    el.style.top      = `${opts.screenY - size * 0.5}px`

    if (opts.type === 'critical') el.classList.add('critical')
    if (opts.type === 'heal')     el.classList.add('heal')
    if (opts.worldStyle)          el.classList.add(`style-${opts.worldStyle}`)

    el.style.animationDuration = `${duration}s`

    this.container.appendChild(el)
    this.active.push({ el, startTime: performance.now(), duration: duration * 1000 })
  }

  /** （  update  requestAnimationFrame ） */
  cleanup(): void {
    const now = performance.now()
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i]
      if (now - a.startTime > a.duration + 100) {
        a.el.remove()
        this.active.splice(i, 1)
      }
    }
  }

  /**  Three.js  */
  static worldToScreen(
    worldPos: { x: number; y: number; z: number },
    camera: THREE.Camera,
    canvas: HTMLCanvasElement,
  ): { x: number; y: number } {
    const v = new (window as any).THREE.Vector3(worldPos.x, worldPos.y, worldPos.z)
    v.project(camera)
    return {
      x: (v.x * 0.5 + 0.5) * canvas.clientWidth,
      y: (-v.y * 0.5 + 0.5) * canvas.clientHeight,
    }
  }

  // ───  ──────────────────────────────────────────────────

  private buildStyle(opts: DamageNumberOptions): {
    text: string; color: string; size: number; duration: number
  } {
    const v = opts.value

    switch (opts.type) {
      case 'normal':
        return { text: String(v), color: '#ffffff', size: 18, duration: 0.8 }
      case 'critical':
        return { text: `${v}!!`, color: '#ff6600', size: 28, duration: 1.2 }
      case 'skill':
        return {
          text: String(v),
          color: opts.elementHex ?? '#aa44ff',
          size: 22,
          duration: 1.0,
        }
      case 'heal':
        return { text: `+${v}`, color: '#44ff88', size: 20, duration: 1.0 }
      case 'block':
        return { text: 'BLOCK', color: '#ffdd44', size: 16, duration: 0.8 }
      case 'miss':
        return { text: 'MISS', color: '#888888', size: 14, duration: 0.7 }
    }
  }
}

// Three.js （ ，  window ）
declare namespace THREE {
  class Camera {}
  class Vector3 {
    constructor(x: number, y: number, z: number)
    x: number; y: number; z: number
    project(camera: Camera): this
  }
}
