import { useEffect, useRef, useState } from 'react'

/**
 * 音频波形：解码音频 → 归一 min/max 峰值桶 → canvas 绘制（像剪辑软件那样的填充波形）。
 *
 * 峰值按 `src` 缓存（module 级），解码只做一次；缩放/改宽只重绘、不重解。
 * 解码失败（无音轨 / 跨域 / 不支持）→ 返回 null，宿主回退到 clip 的底纹背景。
 */
export interface WavePeaks {
  min: Float32Array
  max: Float32Array
  buckets: number
}

const BUCKETS = 2048
const peaksCache = new Map<string, Promise<WavePeaks | null>>()
let sharedCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!sharedCtx) sharedCtx = new AC()
  return sharedCtx
}

async function computePeaks(src: string): Promise<WavePeaks | null> {
  const ctx = getAudioCtx()
  if (!ctx) return null
  const res = await fetch(src)
  if (!res.ok) return null
  const raw = await res.arrayBuffer()
  const audio = await ctx.decodeAudioData(raw)
  if (audio.numberOfChannels === 0) return null
  const ch = audio.getChannelData(0)
  const min = new Float32Array(BUCKETS)
  const max = new Float32Array(BUCKETS)
  const per = Math.max(1, Math.floor(ch.length / BUCKETS))
  for (let b = 0; b < BUCKETS; b++) {
    const start = b * per
    const end = Math.min(ch.length, start + per)
    let lo = 0
    let hi = 0
    for (let i = start; i < end; i++) {
      const v = ch[i]!
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[b] = lo
    max[b] = hi
  }
  return { min, max, buckets: BUCKETS }
}

export function getWavePeaks(src: string): Promise<WavePeaks | null> {
  let p = peaksCache.get(src)
  if (!p) {
    p = computePeaks(src).catch(() => null)
    peaksCache.set(src, p)
  }
  return p
}

/** clip 内的波形层：绝对铺满、透明背景（clip 底纹从空隙透出）、不吃指针事件。 */
export function AudioWaveform({
  src,
  width,
  height,
  color = '#7ff0dc',
}: {
  src: string | undefined
  width: number
  height: number
  color?: string
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [peaks, setPeaks] = useState<WavePeaks | null>(null)

  useEffect(() => {
    let alive = true
    setPeaks(null)
    if (!src) return
    void getWavePeaks(src).then((p) => {
      if (alive) setPeaks(p)
    })
    return () => {
      alive = false
    }
  }, [src])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!peaks) return
    const mid = h / 2
    const amp = mid - 1
    ctx.fillStyle = color
    for (let x = 0; x < w; x++) {
      const i = Math.min(peaks.buckets - 1, Math.floor((x / w) * peaks.buckets))
      const yTop = mid - peaks.max[i]! * amp
      const yBot = mid - peaks.min[i]! * amp
      ctx.fillRect(x, yTop, 1, Math.max(1, yBot - yTop))
    }
  }, [peaks, width, height, color])

  return <canvas ref={canvasRef} className="gc-audio-wave" aria-hidden />
}
