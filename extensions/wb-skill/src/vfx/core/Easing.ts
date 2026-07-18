// @source wb-character/src/vfx/core/Easing.ts
/**
 * 
 *  vfxtex/demo.ts ， 
 */

export const Easing = {
  linear: (t: number) => t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInQuad: (t: number) => t * t,
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  easeOutCubic: (t: number) => { const s = t - 1; return s * s * s + 1 },
  easeInCubic: (t: number) => t * t * t,
  easeOutElastic: (t: number) => {
    if (t === 0 || t === 1) return t
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1
  },
  easeOutBack: (t: number) => {
    const c = 1.70158
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
  },
  easeOutBounce: (t: number) => {
    if (t < 1 / 2.75) return 7.5625 * t * t
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375
  },
  easeOutExpo: (t: number) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  easeInExpo: (t: number) => t === 0 ? 0 : Math.pow(2, 10 * (t - 1)),
}
