/**
 * audioEngine.ts —— 场景音频预览引擎（WebAudio）。
 *
 * 背景：Player / StagePane 一直**只放画面、不放声音**——作者给场景配了 BGM/旁白/
 * 音效（`scene.audio[]` + `scene.sceneBgm`），却只能在时间轴上看条、听不到，
 * 也无从校对淡入淡出、起止点、音量。本引擎按场景时间轴调度音频片段，给预览补上声音；
 * 同一套 plan 还能被节点→MP4 导出（OfflineAudioContext）复用，保证"所见 = 所听 = 导出"。
 *
 * 拆分：
 *   - `buildSceneAudioPlan` / `gainAtLocalMs` 是**纯函数**（无 WebAudio），可单测；
 *   - `SceneAudioEngine` 是薄薄一层 WebAudio 调度（解码缓存 + 起止/淡变包络）。
 *
 * 时间模型：所有 *Ms 均为"场景相对时间"（scene 0 点起算），与 Player 的 elapsed 对齐。
 */

import type { Scene } from '../scenario/types'

export interface AudioPlanEntry {
  /** clip id（sceneBgm 用 `scenebgm-<mediaId>`） */
  id: string
  /** mediaStore 音频实体 id */
  mediaId: string
  /** 在场景时间轴上的起点（ms） */
  startMs: number
  /** 在场景时间轴上的占用时长（ms） */
  durationMs: number
  /** 源音频里的入点（ms） */
  offsetMs: number
  /** 0..1 目标音量 */
  volume: number
  /** 淡入时长（ms） */
  fadeInMs: number
  /** 淡出时长（ms） */
  fadeOutMs: number
  role: 'bgm' | 'sfx' | 'vo'
  /** 是否循环铺满 durationMs（sceneBgm 整场铺底用） */
  loop: boolean
}

/** 各音轨默认增益 —— BGM 压低给人声让路，VO 满音量。仅当 clip 未显式给 volume 时兜底。 */
const ROLE_DEFAULT_GAIN: Record<AudioPlanEntry['role'], number> = {
  bgm: 0.55,
  sfx: 0.9,
  vo: 1,
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

function nonNegMs(n: number | undefined): number {
  return Number.isFinite(n) && (n as number) > 0 ? (n as number) : 0
}

/**
 * 从场景构建音频调度计划（纯函数）。
 *
 * - `scene.audio[]`：逐条映射，volume 缺省回落到该 role 的默认增益；
 * - `scene.sceneBgm`：作者锚定的整场 BGM，铺成 [0, scene.durationMs) 的循环 bgm 条，
 *   带默认淡入/淡出，避免开场/结尾音乐生硬切断。
 */
export function buildSceneAudioPlan(scene: Scene | undefined | null): AudioPlanEntry[] {
  if (!scene) return []
  const out: AudioPlanEntry[] = []

  for (const clip of scene.audio ?? []) {
    if (!clip || !clip.ref) continue
    const durationMs = nonNegMs(clip.durationMs)
    if (durationMs <= 0) continue
    out.push({
      id: clip.id,
      mediaId: clip.ref,
      startMs: nonNegMs(clip.startMs),
      durationMs,
      offsetMs: nonNegMs(clip.offsetMs),
      volume: clamp01(clip.volume ?? ROLE_DEFAULT_GAIN[clip.role] ?? 1),
      fadeInMs: nonNegMs(clip.fadeInMs),
      fadeOutMs: nonNegMs(clip.fadeOutMs),
      role: clip.role,
      loop: false,
    })
  }

  const bgm = scene.sceneBgm
  if (bgm?.mediaId) {
    const sceneDur = nonNegMs(scene.durationMs)
    if (sceneDur > 0) {
      out.push({
        id: `scenebgm-${bgm.mediaId}`,
        mediaId: bgm.mediaId,
        startMs: 0,
        durationMs: sceneDur,
        offsetMs: 0,
        volume: ROLE_DEFAULT_GAIN.bgm,
        // 整场铺底：淡入避免硬起，结尾淡出避免被场景切换硬掐。
        fadeInMs: Math.min(600, sceneDur),
        fadeOutMs: Math.min(800, sceneDur),
        role: 'bgm',
        loop: true,
      })
    }
  }

  return out
}

/**
 * 计算某条 clip 在其"本地时间 localMs"（从 clip 起点 0 起算）应有的增益（含淡入/淡出）。
 * 纯函数，供单测 + OfflineAudioContext 离线渲染复用。
 */
export function gainAtLocalMs(entry: AudioPlanEntry, localMs: number): number {
  if (localMs < 0 || localMs > entry.durationMs) return 0
  let g = entry.volume
  if (entry.fadeInMs > 0 && localMs < entry.fadeInMs) {
    g *= localMs / entry.fadeInMs
  }
  const fadeOutStart = entry.durationMs - entry.fadeOutMs
  if (entry.fadeOutMs > 0 && localMs > fadeOutStart) {
    g *= Math.max(0, (entry.durationMs - localMs) / entry.fadeOutMs)
  }
  return clamp01(g)
}

type ResolveUrl = (mediaId: string) => string | undefined

interface ActiveNode {
  entry: AudioPlanEntry
  src: AudioBufferSourceNode
  gain: GainNode
}

/**
 * 场景音频调度器（WebAudio）。
 *
 * 用法：
 *   const eng = new SceneAudioEngine(id => useMediaStore.getState().entries[id]?.url)
 *   eng.setScene(scene)          // 解码缓存 + 重建 plan
 *   eng.play(elapsedMs)          // 从某场景时间起播
 *   eng.pause()                  // 暂停（记录位置）
 *   eng.seek(ms)                 // 跳转（播放中重排，暂停态只记录）
 *   eng.setMuted(true)           // 静音（不拆调度）
 *   eng.dispose()                // 释放
 *
 * 锚点模型：play/seek 时把 `ctx.currentTime ↔ 场景 ms` 钉成一对锚点，之后任何时刻的
 * 场景位置 = anchorMs + (ctx.currentTime - anchorCtx)*1000，无需逐帧 setState 驱动。
 */
export class SceneAudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private buffers = new Map<string, AudioBuffer>()
  private decoding = new Map<string, Promise<AudioBuffer | null>>()
  private active: ActiveNode[] = []
  private plan: AudioPlanEntry[] = []
  private playing = false
  private posMs = 0
  private anchorCtx = 0
  private anchorMs = 0
  private muted = false
  /** 每次 setScene 自增，async 解码回调据此判断 plan 是否已过期。 */
  private planEpoch = 0
  private disposed = false

  constructor(private resolveUrl: ResolveUrl) {}

  private ensureCtx(): AudioContext | null {
    if (this.disposed) return null
    if (this.ctx) return this.ctx
    const Ctor =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext)
        : undefined
    if (!Ctor) return null
    try {
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 1
      this.master.connect(this.ctx.destination)
      return this.ctx
    } catch {
      this.ctx = null
      return null
    }
  }

  private ensureBuffer(mediaId: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(mediaId)
    if (cached) return Promise.resolve(cached)
    const pending = this.decoding.get(mediaId)
    if (pending) return pending
    const ctx = this.ensureCtx()
    const url = this.resolveUrl(mediaId)
    if (!ctx || !url) return Promise.resolve(null)
    const p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((ab) => ctx.decodeAudioData(ab.slice(0)))
      .then((buf) => {
        this.buffers.set(mediaId, buf)
        this.decoding.delete(mediaId)
        return buf
      })
      .catch(() => {
        this.decoding.delete(mediaId)
        return null
      })
    this.decoding.set(mediaId, p)
    return p
  }

  /**
   * 切换/重建场景音频：停掉旧调度、重建 plan、预解码所有音频。
   * 不在此自动起播 —— 由调用方（hook）在 setScene 后按真实播放头 play()/pause()，
   * 这样"编辑中改音频"也能从当前播放头续上，而不是被重置到 0。
   */
  setScene(scene: Scene | undefined | null): void {
    this.stopAll()
    this.plan = buildSceneAudioPlan(scene)
    this.playing = false
    this.planEpoch++
    // 预解码（best-effort，不阻塞）。
    for (const e of this.plan) void this.ensureBuffer(e.mediaId)
  }

  play(fromMs: number): void {
    if (this.disposed) return
    const ctx = this.ensureCtx()
    if (!ctx) return
    void ctx.resume?.()
    this.playing = true
    this.schedule(Math.max(0, fromMs))
  }

  pause(): void {
    if (!this.playing) return
    this.posMs = this.currentMs()
    this.playing = false
    this.stopAll()
  }

  seek(ms: number): void {
    const at = Math.max(0, ms)
    if (this.playing) {
      this.schedule(at)
    } else {
      this.posMs = at
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    if (this.master) this.master.gain.value = muted ? 0 : 1
  }

  /** 当前场景播放位置（ms）。 */
  currentMs(): number {
    if (this.playing && this.ctx) {
      return this.anchorMs + (this.ctx.currentTime - this.anchorCtx) * 1000
    }
    return this.posMs
  }

  dispose(): void {
    this.disposed = true
    this.stopAll()
    this.buffers.clear()
    this.decoding.clear()
    try {
      void this.ctx?.close()
    } catch {
      /* ignore */
    }
    this.ctx = null
    this.master = null
  }

  private stopAll(): void {
    for (const a of this.active) {
      try {
        a.src.onended = null
        a.src.stop()
      } catch {
        /* already stopped */
      }
      try {
        a.src.disconnect()
        a.gain.disconnect()
      } catch {
        /* ignore */
      }
    }
    this.active = []
  }

  /** 从场景时间 fromMs 起，重排所有仍在窗口内的 clip。 */
  private schedule(fromMs: number): void {
    const ctx = this.ensureCtx()
    if (!ctx || !this.master) return
    this.stopAll()
    this.anchorCtx = ctx.currentTime
    this.anchorMs = fromMs
    this.posMs = fromMs
    const epoch = this.planEpoch
    for (const entry of this.plan) {
      const endMs = entry.startMs + entry.durationMs
      if (endMs <= fromMs) continue // 这条已经放完
      const buf = this.buffers.get(entry.mediaId)
      if (buf) {
        this.startEntry(entry, buf, fromMs)
      } else {
        // 尚未解码：解完若 plan 未变且仍在播，补排这一条。
        void this.ensureBuffer(entry.mediaId).then((b) => {
          if (!b || this.disposed) return
          if (this.planEpoch !== epoch || !this.playing) return
          const nowMs = this.currentMs()
          if (entry.startMs + entry.durationMs <= nowMs) return
          this.startEntry(entry, b, nowMs)
        })
      }
    }
  }

  private startEntry(entry: AudioPlanEntry, buf: AudioBuffer, fromMs: number): void {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return

    const endMs = entry.startMs + entry.durationMs
    const whenSceneMs = Math.max(entry.startMs, fromMs)
    if (whenSceneMs >= endMs) return
    const ctxWhen = this.anchorCtx + (whenSceneMs - this.anchorMs) / 1000
    const intoClipMs = whenSceneMs - entry.startMs // 已经走过的 clip 本地时间
    const playDurSec = (endMs - whenSceneMs) / 1000

    const src = ctx.createBufferSource()
    src.buffer = buf
    const gain = ctx.createGain()
    src.connect(gain)
    gain.connect(master)

    const startGain = gainAtLocalMs(entry, intoClipMs)
    const t0 = Math.max(ctx.currentTime, ctxWhen)
    try {
      gain.gain.cancelScheduledValues(t0)
      gain.gain.setValueAtTime(startGain, t0)
      // 淡入剩余段（若起播点仍在淡入窗内）
      if (entry.fadeInMs > 0 && intoClipMs < entry.fadeInMs) {
        const fadeInEnd = ctxWhen + (entry.fadeInMs - intoClipMs) / 1000
        gain.gain.linearRampToValueAtTime(entry.volume, Math.max(t0, fadeInEnd))
      } else {
        gain.gain.setValueAtTime(entry.volume, t0)
      }
      // 淡出段
      if (entry.fadeOutMs > 0) {
        const fadeOutStartMs = entry.durationMs - entry.fadeOutMs
        const fadeOutStartCtx =
          ctxWhen + Math.max(0, fadeOutStartMs - intoClipMs) / 1000
        gain.gain.setValueAtTime(entry.volume, Math.max(t0, fadeOutStartCtx))
        gain.gain.linearRampToValueAtTime(0, ctxWhen + playDurSec)
      }
    } catch {
      /* 自动化失败不致命，至少有声音 */
    }

    const srcOffsetSec = (entry.offsetMs + intoClipMs) / 1000
    if (entry.loop) {
      src.loop = true
      // 循环范围：源音频 [offset, 全长)。loopEnd=0 时 WebAudio 用整段。
      src.loopStart = entry.offsetMs / 1000
    }
    try {
      if (entry.loop) {
        // 循环条：起播后播 playDurSec 再停（gain 已含结尾淡出）。
        src.start(t0, srcOffsetSec)
        src.stop(ctxWhen + playDurSec)
      } else {
        // 非循环：最多放 min(剩余 clip 时长, 源音频可用长度)。
        const avail = Math.max(0, buf.duration - srcOffsetSec)
        const dur = Math.min(playDurSec, avail)
        if (dur <= 0) {
          src.disconnect()
          gain.disconnect()
          return
        }
        src.start(t0, srcOffsetSec, dur)
      }
    } catch {
      try {
        src.disconnect()
        gain.disconnect()
      } catch {
        /* ignore */
      }
      return
    }

    const node: ActiveNode = { entry, src, gain }
    src.onended = () => {
      this.active = this.active.filter((a) => a !== node)
      try {
        src.disconnect()
        gain.disconnect()
      } catch {
        /* ignore */
      }
    }
    this.active.push(node)
  }
}
