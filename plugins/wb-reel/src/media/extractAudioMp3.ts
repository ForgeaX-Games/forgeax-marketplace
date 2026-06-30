/**
 * 视频音轨 → MP3（纯前端）—— 角色试镜视频「音色样本」抽取。
 *
 * 背景：角色试镜视频（Seedance 2.0 图生视频，~10s、带本人念白）生成后，需要把
 * **完整音轨**抽成一段 MP3，绑为该角色的「音色参考」。下游生成该角色镜头视频时直接
 * 作 Seedance `reference_audio` 喂入，避免再走 TTS / 声音克隆。
 *
 * 流程：
 *   fetch(videoUrl) → Blob → ArrayBuffer
 *   → AudioContext.decodeAudioData（解出 PCM，浏览器原生解码 mp4/webm 音轨）
 *   → 下混为单声道 + 重采样为 16-bit PCM
 *   → @breezystack/lamejs Mp3Encoder 编码为 MP3
 *   → 拼成 `data:audio/mpeg;base64,...` dataURL 返回
 *
 * 失败（无音轨 / 解码失败 / 浏览器不支持）时抛错；调用方据此提示「音色抽取失败，可重试」，
 * 试镜视频本身仍然保留（音色降级为不可用）。
 */

import { Mp3Encoder } from '@breezystack/lamejs'

export interface ExtractAudioMp3Options {
  /** 目标比特率（kbps），默认 128 —— 念白人声 128 足够清晰且体积小。 */
  kbps?: number
  /**
   * 强制单声道（默认 true）。音色参考只需人声，单声道体积减半，
   * 且大多数 reference_audio 通道对单声道更友好。
   */
  mono?: boolean
}

/** dataURL → ArrayBuffer（兼容 video 是 data: 形式时省去一次网络往返）。 */
async function fetchVideoBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch video failed: HTTP ${res.status}`)
  return res.arrayBuffer()
}

/** Float32 [-1,1] → Int16 PCM（带钳制，避免溢出爆音）。 */
function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

/** Uint8Array[] → base64（分块，避免超长 spread 触发栈溢出）。 */
function chunksToBase64(chunks: Uint8Array[]): string {
  let total = 0
  for (const c of chunks) total += c.length
  const merged = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    merged.set(c, off)
    off += c.length
  }
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < merged.length; i += CHUNK) {
    binary += String.fromCharCode(...merged.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * 从视频 URL 抽取整段音轨并编码为 MP3 dataURL。
 *
 * @returns `data:audio/mpeg;base64,...`
 * @throws 当视频无音轨 / 解码失败 / 浏览器不支持 AudioContext 时
 */
export async function extractAudioMp3(
  videoUrl: string,
  opts: ExtractAudioMp3Options = {},
): Promise<string> {
  const kbps = opts.kbps ?? 128
  const mono = opts.mono ?? true

  const AudioCtx: typeof AudioContext | undefined =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) throw new Error('AudioContext 不可用，无法抽取音轨')

  const bytes = await fetchVideoBytes(videoUrl)

  const ctx = new AudioCtx()
  let audioBuf: AudioBuffer
  try {
    // decodeAudioData 在部分浏览器是 callback 风格；用 Promise 包裹兼容两者。
    audioBuf = await new Promise<AudioBuffer>((resolve, reject) => {
      const p = ctx.decodeAudioData(bytes.slice(0), resolve, reject)
      // 现代实现返回 Promise；如果返回了就接上以捕获 reject。
      if (p && typeof (p as Promise<AudioBuffer>).then === 'function') {
        ;(p as Promise<AudioBuffer>).then(resolve, reject)
      }
    })
  } finally {
    // 编码不再需要 ctx；尽快释放。
    void ctx.close().catch(() => {})
  }

  if (!audioBuf || audioBuf.length === 0) {
    throw new Error('视频未解出可用音轨')
  }

  const sampleRate = audioBuf.sampleRate
  const channels = mono ? 1 : Math.min(2, audioBuf.numberOfChannels)

  // 取声道数据；mono 时把多声道下混平均。
  let left: Float32Array
  let right: Float32Array | undefined
  if (channels === 1) {
    if (audioBuf.numberOfChannels === 1) {
      left = audioBuf.getChannelData(0)
    } else {
      const a = audioBuf.getChannelData(0)
      const b = audioBuf.getChannelData(1)
      const mix = new Float32Array(a.length)
      for (let i = 0; i < a.length; i++) mix[i] = (a[i]! + b[i]!) / 2
      left = mix
    }
  } else {
    left = audioBuf.getChannelData(0)
    right = audioBuf.getChannelData(1)
  }

  const encoder = new Mp3Encoder(channels, sampleRate, kbps)
  const leftPcm = floatToInt16(left)
  const rightPcm = right ? floatToInt16(right) : undefined

  const out: Uint8Array[] = []
  const BLOCK = 1152 // MP3 帧样本数
  for (let i = 0; i < leftPcm.length; i += BLOCK) {
    const lChunk = leftPcm.subarray(i, i + BLOCK)
    const rChunk = rightPcm ? rightPcm.subarray(i, i + BLOCK) : undefined
    const mp3buf = rChunk
      ? encoder.encodeBuffer(lChunk, rChunk)
      : encoder.encodeBuffer(lChunk)
    if (mp3buf.length > 0) out.push(mp3buf)
  }
  const tail = encoder.flush()
  if (tail.length > 0) out.push(tail)

  if (out.length === 0) throw new Error('MP3 编码结果为空')

  return `data:audio/mpeg;base64,${chunksToBase64(out)}`
}
