import type {
  MusicClient,
  MusicGenOptions,
  MusicGenRequest,
  MusicGenResult,
  MusicProgressEvent,
} from './MinimaxMusicProvider'

/**
 * HostGatewayMusicProvider —— 把 BGM（场景音乐）生成委托给宿主 forgeax-server
 * 的 MiniMax 音乐网关（`/__ce-api__/reel-music`），而不是浏览器直连 MiniMax
 * 并把 music key 打进 bundle。
 *
 * 为什么（作者 2026-06 · key 不进前端红线）：
 *   · 原 getMinimaxMusicClient 用 `__RS_MUSIC_KEY__` 编译期注入，嵌入 iframe 时
 *     无注入 → 回落静音占位（mock），BGM 形同没接。
 *   · 改走宿主后，music key 全程留 server，浏览器只发同源 /reel-music。
 *
 * 进度：music_generation 同步阻塞 60–150s，期间无中间事件可转发，
 *   故沿用真 client 的心跳策略——本地 setInterval emit 'tick'，让 UI 显示
 *   "已等待 N 秒 · 取消"。
 */

interface ReelMusicResp {
  success?: boolean
  base64?: string
  mimeType?: string
  model?: string
  traceId?: string
  durationMs?: number
  sampleRate?: number
  channel?: number
  bitrate?: number
  fileSizeBytes?: number
  error?: string
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export class HostGatewayMusicProvider implements MusicClient {
  private readonly base: string

  constructor(opts: { base?: string } = {}) {
    this.base = (opts.base ?? '/__ce-api__').replace(/\/$/, '')
  }

  getProviderName(): string {
    return 'HostGatewayMusic'
  }

  async generate(req: MusicGenRequest, opts?: MusicGenOptions): Promise<MusicGenResult> {
    const t0 = Date.now()
    const elapsed = (): number => Date.now() - t0
    const emit = (e: MusicProgressEvent): void => {
      try {
        opts?.onProgress?.(e)
      } catch {
        /* 用户回调抛错不影响主流程 */
      }
    }

    const signal = opts?.signal
    let cancelled = false
    const onAbort = (): void => {
      cancelled = true
      stopTicks()
      emit({ kind: 'cancelled', elapsedMs: elapsed() })
    }
    if (signal) {
      if (signal.aborted) {
        emit({ kind: 'cancelled', elapsedMs: 0 })
        throw new DOMException('Aborted', 'AbortError')
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    const tickMs = Math.max(50, opts?.tickIntervalMs ?? 5000)
    let tickHandle: ReturnType<typeof setInterval> | null = null
    function stopTicks(): void {
      if (tickHandle !== null) {
        clearInterval(tickHandle)
        tickHandle = null
      }
    }

    try {
      emit({ kind: 'request_sent', elapsedMs: elapsed() })
      tickHandle = setInterval(() => {
        emit({ kind: 'tick', elapsedMs: elapsed() })
      }, tickMs)

      let resp: Response
      try {
        resp = await fetch(`${this.base}/reel-music`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: req.model,
            prompt: req.prompt,
            lyrics: req.lyrics,
            isInstrumental: req.isInstrumental,
            lyricsOptimizer: req.lyricsOptimizer,
            audioSetting: req.audioSetting,
          }),
          signal,
        })
      } catch (err) {
        stopTicks()
        if (cancelled || (err instanceof Error && err.name === 'AbortError')) throw err
        const msg = err instanceof Error ? err.message : String(err)
        emit({ kind: 'failed', elapsedMs: elapsed(), message: msg })
        throw err
      }
      stopTicks()
      emit({ kind: 'response_received', elapsedMs: elapsed(), httpStatus: resp.status })

      const raw = await resp.text()
      if (!resp.ok) {
        const msg = `host gateway HTTP ${resp.status}: ${raw.slice(0, 240)}`
        emit({ kind: 'failed', elapsedMs: elapsed(), message: msg })
        throw new Error(`[music] ${msg}`)
      }
      let data: ReelMusicResp
      try {
        data = JSON.parse(raw) as ReelMusicResp
      } catch {
        const msg = `host gateway non-JSON · ${raw.slice(0, 200)}`
        emit({ kind: 'failed', elapsedMs: elapsed(), message: msg })
        throw new Error(`[music] ${msg}`)
      }
      if (!data.success || !data.base64) {
        const msg = data.error || '宿主音乐网关生成失败'
        emit({ kind: 'failed', elapsedMs: elapsed(), message: msg })
        throw new Error(`[music] ${msg}`)
      }

      const bytes = base64ToBytes(data.base64)
      const mimeType = data.mimeType === 'audio/wav' ? 'audio/wav' : 'audio/mpeg'
      emit({ kind: 'decoded', elapsedMs: elapsed(), bytes: bytes.length })

      return {
        dataUrl: `data:${mimeType};base64,${data.base64}`,
        mimeType,
        bytes,
        base64: data.base64,
        model: data.model ?? req.model ?? 'music-2.6-free',
        traceId: data.traceId,
        durationMs: data.durationMs,
        sampleRate: data.sampleRate,
        channel: data.channel,
        bitrate: data.bitrate,
        fileSizeBytes: data.fileSizeBytes,
      }
    } finally {
      stopTicks()
      if (signal) signal.removeEventListener('abort', onAbort)
    }
  }
}

/**
 * 是否走宿主音乐网关（MiniMax 音乐）。
 *   - 嵌入宿主（path 含 /plugins/wb-reel，或被 iframe 嵌入）→ 默认开
 *   - localStorage `reel-studio.musicProvider`：'host' 强制开 / 'direct' 强制关
 */
export function shouldUseHostMusicGateway(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const override = window.localStorage.getItem('reel-studio.musicProvider')
    if (override === 'host') return true
    if (override === 'direct') return false
  } catch {
    /* ignore */
  }
  if (window.location.pathname.includes('/plugins/wb-reel')) return true
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
