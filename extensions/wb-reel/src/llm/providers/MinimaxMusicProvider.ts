/**
 * MiniMax Music Generation Provider —— 文本/歌词 → 整曲音乐生成
 *
 * 官方文档:
 *   https://platform.minimaxi.com/docs/api-reference/music-generation
 *
 * 端点 (HTTP REST, 同步):
 *   POST `${apiBase}/v1/music_generation`
 *   Header:
 *     Authorization: Bearer <api_key>      (官方文档明确要求 Bearer 鉴权; 注意和 doubao-tts 的 "Bearer; <key>" 风格不一样)
 *     Content-Type:  application/json
 *
 *   Body 关键字段 (完整字段见官方文档):
 *   ```json
 *   {
 *     "model": "music-2.6" | "music-2.6-free" | "music-cover" | "music-cover-free",
 *     "prompt": "...",                      // 风格 / 情绪 / 场景描述 (1-2000 字)
 *     "lyrics": "[Verse]\n...\n[Chorus]\n...",  // 1-3500 字; is_instrumental 时可省
 *     "is_instrumental": false,             // 纯音乐 (无人声), 仅 music-2.6 系列支持
 *     "lyrics_optimizer": false,            // 自动写歌词; 与 lyrics 二选一
 *     "stream": false,
 *     "output_format": "hex" | "url",       // 默认 hex; stream=true 时仅支持 hex
 *     "audio_setting": {
 *       "sample_rate": 16000 | 24000 | 32000 | 44100,
 *       "bitrate":     32000 | 64000 | 128000 | 256000,
 *       "format":      "mp3" | "wav" | "pcm"
 *     }
 *   }
 *   ```
 *
 *   响应 (output_format=hex):
 *   ```json
 *   {
 *     "data": { "status": 2, "audio": "<hex 编码字符串>" },
 *     "trace_id": "...",
 *     "extra_info": { "music_duration": 25364, "music_sample_rate": 44100, "music_channel": 2, "bitrate": 256000, "music_size": 813651 },
 *     "base_resp": { "status_code": 0, "status_msg": "success" }
 *   }
 *   ```
 *   - `data.status = 2` 表示已完成；status=1 是流式中间态 (本 client 不走 stream)
 *   - `audio` 字段是 16 进制编码 (注意: 不是 base64), 需要 hex → bytes 转换
 *
 * 错误码:
 *   - 0     成功
 *   - 1002  限流, 稍后重试
 *   - 1004  鉴权失败
 *   - 1008  余额不足
 *   - 2013  入参异常 (常见: model 不在 enum / lyrics 长度超限)
 *   - 2049  无效 api key
 *
 * Mock 兜底:
   *   apiKey 为空 → 返回 silent mp3 占位 (与 TTSProvider 同套占位字节流), 让 UI
 *   流转测试不阻塞.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  HostGatewayMusicProvider,
  shouldUseHostMusicGateway,
} from './HostGatewayMusicProvider'

export type MinimaxMusicModel =
  | 'music-2.6'
  | 'music-2.6-free'
  | 'music-cover'
  | 'music-cover-free'

export interface MusicGenRequest {
  model?: MinimaxMusicModel
  /** 风格 / 情绪 / 场景描述。是否必填取决于 model 与 is_instrumental，详见官方表 */
  prompt?: string
  /** 歌词；含 [Verse]/[Chorus] 等结构标签。1-3500 字。 */
  lyrics?: string
  /** 纯音乐 (无人声)，仅 music-2.6 系列支持 */
  isInstrumental?: boolean
  /** lyrics 为空时由 prompt 自动生成歌词；仅 music-2.6 系列支持 */
  lyricsOptimizer?: boolean
  /** 翻唱模型用：参考音频 url；与 audioBase64 / coverFeatureId 互斥 */
  audioUrl?: string
  /** 翻唱模型用：参考音频 base64；与 audioUrl / coverFeatureId 互斥 */
  audioBase64?: string
  /** 翻唱模型用：cover_preprocess 返回的 feature id */
  coverFeatureId?: string
  audioSetting?: {
    sampleRate?: 16000 | 24000 | 32000 | 44100
    bitrate?: 32000 | 64000 | 128000 | 256000
    format?: 'mp3' | 'wav' | 'pcm'
  }
}

export interface MusicGenResult {
  /** data:audio/mpeg;base64,... 直接喂给 <audio src> 或 mediaStore.ingestDataUrl */
  dataUrl: string
  mimeType: 'audio/mpeg' | 'audio/wav'
  /** 真实媒体字节 (Uint8Array)；mediaStore 长视频走 ingestBlob 时用 */
  bytes: Uint8Array
  /** 原始 base64 (从 hex 转换而来)，落到 ingestDataUrl */
  base64: string
  durationMs?: number
  sampleRate?: number
  channel?: number
  bitrate?: number
  /** 文件字节数 */
  fileSizeBytes?: number
  model: string
  traceId?: string
  /** mock=true 时表示走的是无 key 占位路径 */
  mock?: boolean
}

/**
 * MiniMax Music 生成进度事件 —— v6.7 新增。
 *
 * 设计意图:
 *   官方 `/v1/music_generation` 是同步阻塞接口 (`stream=false`),
 *   一首 60–180s 的曲子端到端常常要 60–150s。期间浏览器只能"默默等",
 *   作者不知道是 key 错了 / 网卡了 / 模型在跑, 体验非常差。
 *
 *   解决: 在客户端发出请求 / 收到响应 / 解码完成 三个时刻各发一次事件,
 *   再用一个 5s 的 setInterval 在等待中持续 emit `kind: 'tick'` 心跳,
 *   UI 可以拿来转 spinner / 显示"已等待 87s" / 用户取消按钮。
 *
 * UI 用法 (示例):
 *   ```ts
 *   const ctrl = new AbortController()
 *   client.generate({ prompt, ... }, {
 *     signal: ctrl.signal,
 *     onProgress: (e) => setStatus(e),
 *   })
 *   // 用户点取消 → ctrl.abort()
 *   ```
 *
 * 事件契约:
 *   - 'request_sent'  HTTP POST 已发出, 在等服务端响应
 *   - 'tick'          每 5s 一次心跳, elapsedMs 单调递增
 *   - 'response_received'  服务端 200, 开始解码 hex
 *   - 'decoded'       hex → bytes → dataUrl 完成, 即将 resolve
 *   - 'cancelled'     调用方触发 abort; resolve 路径不会再走
 *   - 'failed'        HTTP 非 200 / API 错误码 / 网络错误; reject 之前发一次
 */
export type MusicProgressEvent =
  | { kind: 'request_sent'; elapsedMs: number }
  | { kind: 'tick'; elapsedMs: number }
  | { kind: 'response_received'; elapsedMs: number; httpStatus: number }
  | { kind: 'decoded'; elapsedMs: number; bytes: number }
  | { kind: 'cancelled'; elapsedMs: number }
  | { kind: 'failed'; elapsedMs: number; message: string }

export interface MusicGenOptions {
  /** AbortController.signal —— 用户点"取消"时 abort, 客户端会停 fetch + 停心跳 */
  signal?: AbortSignal
  /** 进度回调 —— 见 MusicProgressEvent 契约 */
  onProgress?: (event: MusicProgressEvent) => void
  /**
   * 心跳间隔 (ms), 默认 5000。
   * 测试可调短到 50–100, 真线 UI 走 5s 即够 (太频繁会刷爆 React render)。
   */
  tickIntervalMs?: number
}

export interface MusicClient {
  generate: (req: MusicGenRequest, opts?: MusicGenOptions) => Promise<MusicGenResult>
  getProviderName: () => string
}

interface MinimaxMusicConfig {
  apiKey: string
  /** 默认 'https://api.minimaxi.com'。海外站点用 'https://api.minimax.io' */
  apiBase?: string
  /** 默认 'music-2.6-free' (所有 API key 都能用)。Token Plan / 付费用户可换 'music-2.6' */
  defaultModel?: MinimaxMusicModel
}

/**
 * 内置音乐风格 preset —— 给作者一个一键切换的下拉。
 *
 * 设计原则:
 *   · prompt 用英文 (官方 demo 风格), 避免中文词被模型理解偏
 *   · 覆盖剧本里最常用的 BGM 用途: 紧张 / 温情 / 悬疑 / 战斗 / 抒情 / 片尾
 *   · 同时给一段示例 lyrics, 让作者点 "试听" 立刻能听到完整歌而不是空 prompt
 */
export interface MusicStylePreset {
  id: string
  label: string
  prompt: string
  /** 示例歌词；作者可改写 */
  lyrics: string
  isInstrumental?: boolean
}

export const MINIMAX_MUSIC_PRESETS: MusicStylePreset[] = [
  {
    id: 'cinematic-tense',
    label: '电影 · 紧张追逐',
    prompt:
      'Cinematic, tense thriller score, fast pulsing strings, subtle electronic percussion, building suspense, no vocals',
    lyrics: '',
    isInstrumental: true,
  },
  {
    id: 'cinematic-emotional',
    label: '电影 · 温情抒情',
    prompt:
      'Cinematic emotional ballad, slow piano, warm strings, heartfelt, hopeful, late afternoon light',
    lyrics:
      '[Verse]\nIn the quiet of the evening light\nMemories drift like falling snow\n[Chorus]\nHold on to the warmth we know\nLet the silence tell us where to go',
  },
  {
    id: 'mystery-noir',
    label: '悬疑 · 黑色电影',
    prompt:
      'Noir mystery, smoky jazz, muted trumpet, upright bass, slow walking tempo, rainy city night',
    lyrics: '',
    isInstrumental: true,
  },
  {
    id: 'battle-epic',
    label: '战斗 · 史诗交响',
    prompt:
      'Epic orchestral battle theme, taiko drums, brass fanfare, choir, heroic, large hall reverb',
    lyrics: '',
    isInstrumental: true,
  },
  {
    id: 'chinese-pop',
    label: '中文流行 · 主题曲',
    prompt: 'Mandopop ballad, gentle guitar, smooth male vocal, melodic, modern',
    lyrics:
      '[Verse]\n夜色慢慢落下来\n你的笑还在我脑海\n[Chorus]\n如果可以重来一遍\n我会更勇敢一点',
  },
  {
    id: 'indie-folk-melancholy',
    label: '独立民谣 · 忧郁',
    prompt:
      'Indie folk, melancholic, introspective, longing, solitary walk, coffee shop',
    lyrics:
      '[Verse]\n街灯微亮晚风轻抚\n影子拉长独自漫步\n[Chorus]\n推开木门香气弥漫\n熟悉的角落陌生人看',
  },
  {
    id: 'lofi-relaxed',
    label: 'Lo-fi · 放松日常',
    prompt:
      'Lo-fi hip hop, jazzy electric piano, soft drums, vinyl crackle, late night study mood',
    lyrics: '',
    isInstrumental: true,
  },
  {
    id: 'horror-ambient',
    label: '惊悚 · 黑暗氛围',
    prompt:
      'Dark ambient horror, drone pads, eerie metallic resonance, distant heartbeat, no rhythm',
    lyrics: '',
    isInstrumental: true,
  },
]

/**
 * 把 MiniMax 返回的 hex 字符串解码为 Uint8Array。
 *
 * 实现单独导出方便单测 — hex 解码很容易写错 (奇数长度 / 非法字符), 测试要保证
 * 对边界情况健壮.
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  if (clean.length % 2 !== 0) {
    throw new Error(`[minimax-music] invalid hex length: ${clean.length}`)
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substr(i * 2, 2), 16)
    if (Number.isNaN(byte)) {
      throw new Error(`[minimax-music] invalid hex char at offset ${i * 2}`)
    }
    out[i] = byte
  }
  return out
}

/** 把 Uint8Array 转 base64 (浏览器环境用 btoa) */
function bytesToBase64(bytes: Uint8Array): string {
  // 大文件 (~1MB) 一次 fromCharCode 会爆栈; 分块转换更稳
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  // 浏览器有 btoa；Node 18+ 也有；happy-dom (vitest 默认) 也有
  return btoa(bin)
}

/* —— silent mp3 (与 TTSProvider 同), 占位用 ————————————————————— */
const SILENT_MP3_BASE64 =
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAA' +
  'AAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAGAAAGgABBQUFBQUFBQUFBQ' +
  'UFBVlZWVlZWVlZWVlZWVlZWVlZWampqampqampqampqampqaqenp6enp6enp6enp6en' +
  'p7Kysv//////////////////////////////////////////////8AAAAATGF2YzU4Lj' +
  'EzAAAAAAAAAAAAAAAAJAAAAAAAAAAABoCAhxIAAAAAAAAAAAAAAAAAAP/7UMAAA8AABp' +
  'AAAACAAADSAAAAEAA='

/**
 * 创建 MiniMax Music client。
 *
 * 字段缺失策略:
 *   - apiKey 为空 → 返回 mock client (不打网络), 所有合成调用返回 SILENT_MP3
 *   - 配置完整 → 返回真 client
 *
 * 模型选择策略:
 *   - 调用方传 req.model 直接使用; 否则用 cfg.defaultModel; 再否则用 'music-2.6-free'
 *     (所有 API key 都能用, 不看 token plan)
 */
export function createMinimaxMusicClient(cfg: MinimaxMusicConfig): MusicClient {
  const apiKey = cfg.apiKey?.trim() ?? ''
  if (!apiKey) {
    return {
      generate: async (req, opts) => {
        const t0 = Date.now()
        const emit = (e: MusicProgressEvent): void => {
          try {
            opts?.onProgress?.(e)
          } catch {
            /* swallow user callback throw, 不影响主流程 */
          }
        }
        // mock 路径仍按真实事件序列回放 (request_sent → response_received → decoded)
        // 让 UI 在没 key 的本地开发环境也能完整测进度条 / 取消按钮交互。
        emit({ kind: 'request_sent', elapsedMs: 0 })
        if (opts?.signal?.aborted) {
          emit({ kind: 'cancelled', elapsedMs: Date.now() - t0 })
          throw new DOMException('Aborted', 'AbortError')
        }
        // mock 不解码 base64 (SILENT_MP3 字符串包含 padding/换行环境差异),
        // 占位 bytes 给 1 个非空 Uint8Array 即可, 业务侧只看 dataUrl.
        const bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00])
        emit({ kind: 'response_received', elapsedMs: Date.now() - t0, httpStatus: 200 })
        emit({ kind: 'decoded', elapsedMs: Date.now() - t0, bytes: bytes.length })
        return {
          dataUrl: `data:audio/mpeg;base64,${SILENT_MP3_BASE64}`,
          mimeType: 'audio/mpeg',
          bytes,
          base64: SILENT_MP3_BASE64,
          model: req.model ?? 'music-2.6-free',
          mock: true,
        }
      },
      getProviderName: () => 'minimax-music(mock)',
    }
  }

  const apiBase = (cfg.apiBase ?? '/__minimax_music__').replace(/\/$/, '')
  const defaultModel: MinimaxMusicModel = cfg.defaultModel ?? 'music-2.6-free'
  const url = `${apiBase}/v1/music_generation`

  return {
    generate: async (req, opts) => {
      const t0 = Date.now()
      const elapsed = (): number => Date.now() - t0
      const emit = (e: MusicProgressEvent): void => {
        try {
          opts?.onProgress?.(e)
        } catch {
          /* 用户回调抛错也不影响生成主流程 */
        }
      }

      const model = req.model ?? defaultModel
      const audioFmt = req.audioSetting?.format ?? 'mp3'

      const body: Record<string, unknown> = {
        model,
        output_format: 'hex',
        stream: false,
        audio_setting: {
          sample_rate: req.audioSetting?.sampleRate ?? 44100,
          bitrate: req.audioSetting?.bitrate ?? 256000,
          format: audioFmt,
        },
      }
      if (req.prompt !== undefined) body.prompt = req.prompt
      if (req.lyrics !== undefined && req.lyrics !== '') body.lyrics = req.lyrics
      if (req.isInstrumental) body.is_instrumental = true
      if (req.lyricsOptimizer) body.lyrics_optimizer = true
      if (req.audioUrl) body.audio_url = req.audioUrl
      if (req.audioBase64) body.audio_base64 = req.audioBase64
      if (req.coverFeatureId) body.cover_feature_id = req.coverFeatureId

      // —— 心跳 setInterval ————————————————————————————————————————
      // 设计原因:
      //   官方 music_generation 是单次同步阻塞请求, 60–150s 才回包。
      //   浏览器 fetch 期间没有任何中间事件可以转发给 UI; 我们用客户端
      //   定时器主动 emit `tick`, 让 UI 知道"还在等, 已经等了 N 秒"。
      // 注意:
      //   - tick 仅在 request_sent 之后启动, 在 response_received / failed
      //     / cancelled 之一发生时立即停掉。
      //   - 间隔默认 5s; 测试调小到 50ms 仍可观察到 ≥1 次 tick。
      const tickMs = Math.max(50, opts?.tickIntervalMs ?? 5000)
      let tickHandle: ReturnType<typeof setInterval> | null = null
      const stopTicks = (): void => {
        if (tickHandle !== null) {
          clearInterval(tickHandle)
          tickHandle = null
        }
      }

      // —— Abort 处理 ————————————————————————————————————————————
      // 把外部 signal 直接透传给 fetch; 同时挂一个 abort listener
      // 在用户主动取消时 emit 'cancelled' (区别于网络/服务器错误的 'failed')。
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

      try {
        emit({ kind: 'request_sent', elapsedMs: elapsed() })
        tickHandle = setInterval(() => {
          emit({ kind: 'tick', elapsedMs: elapsed() })
        }, tickMs)

        let resp: Response
        try {
          resp = await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            signal,
          })
        } catch (err) {
          // fetch 抛错 (网络断 / abort): 区分 abort vs 真错误
          stopTicks()
          if (cancelled || (err instanceof Error && err.name === 'AbortError')) {
            // onAbort 里已经 emit 过 cancelled, 这里直接 rethrow
            throw err
          }
          const msg = err instanceof Error ? err.message : String(err)
          emit({ kind: 'failed', elapsedMs: elapsed(), message: msg })
          throw err
        }
        stopTicks()
        emit({
          kind: 'response_received',
          elapsedMs: elapsed(),
          httpStatus: resp.status,
        })

        if (!resp.ok) {
          const txt = await resp.text().catch(() => '')
          const msg = `HTTP ${resp.status}: ${txt.slice(0, 300)}`
          emit({ kind: 'failed', elapsedMs: elapsed(), message: msg })
          throw new Error(`[minimax-music] ${msg}`)
        }
        const json = (await resp.json()) as {
          data?: { status?: number; audio?: string }
          trace_id?: string
          extra_info?: {
            music_duration?: number
            music_sample_rate?: number
            music_channel?: number
            bitrate?: number
            music_size?: number
          }
          base_resp?: { status_code?: number; status_msg?: string }
        }
        const code = json.base_resp?.status_code ?? -1
        if (code !== 0) {
          const msg = `code=${code} ${json.base_resp?.status_msg ?? 'unknown error'}`.trim()
          emit({ kind: 'failed', elapsedMs: elapsed(), message: msg })
          throw new Error(`[minimax-music] ${msg}`)
        }
        const audioHex = json.data?.audio
        if (!audioHex) {
          const msg = 'empty audio in response'
          emit({ kind: 'failed', elapsedMs: elapsed(), message: msg })
          throw new Error(`[minimax-music] ${msg}`)
        }
        const bytes = hexToBytes(audioHex)
        const base64 = bytesToBase64(bytes)
        const mimeType = audioFmt === 'wav' ? 'audio/wav' : 'audio/mpeg'
        emit({ kind: 'decoded', elapsedMs: elapsed(), bytes: bytes.length })

        return {
          dataUrl: `data:${mimeType};base64,${base64}`,
          mimeType: mimeType as 'audio/mpeg' | 'audio/wav',
          bytes,
          base64,
          model,
          traceId: json.trace_id,
          durationMs: json.extra_info?.music_duration,
          sampleRate: json.extra_info?.music_sample_rate,
          channel: json.extra_info?.music_channel,
          bitrate: json.extra_info?.bitrate,
          fileSizeBytes: json.extra_info?.music_size,
        }
      } finally {
        stopTicks()
        if (signal) {
          signal.removeEventListener('abort', onAbort)
        }
      }
    },
    getProviderName: () => 'minimax-music',
  }
}

/**
 * 全局 Music client 单例 —— 直接读 build-time 注入的 __RS_MUSIC_*__ 常量。
 * 没注入时返回 mock client。
 */
let _instance: MusicClient | null = null

export function getMinimaxMusicClient(): MusicClient {
  if (_instance) return _instance
  // 嵌入宿主时优先走 MiniMax 音乐网关（key 留 server）；独立 dev 回落编译期注入/mock。
  if (shouldUseHostMusicGateway()) {
    _instance = new HostGatewayMusicProvider()
    return _instance
  }
  const apiKey = typeof __RS_MUSIC_KEY__ !== 'undefined' ? __RS_MUSIC_KEY__ : ''
  const apiBase =
    typeof __RS_MUSIC_BASE__ !== 'undefined' && __RS_MUSIC_BASE__
      ? __RS_MUSIC_BASE__
      : undefined
  const defaultModel =
    (typeof __RS_MUSIC_MODEL__ !== 'undefined' && __RS_MUSIC_MODEL__
      ? (__RS_MUSIC_MODEL__ as MinimaxMusicModel)
      : undefined) ?? undefined
  _instance = createMinimaxMusicClient({ apiKey, apiBase, defaultModel })
  return _instance
}

/** 测试用：注入假 client / 重置单例 */
export function _setMusicClientForTest(c: MusicClient | null): void {
  _instance = c
}
