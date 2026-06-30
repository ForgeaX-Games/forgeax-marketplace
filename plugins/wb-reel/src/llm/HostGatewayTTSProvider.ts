import type { TtsClient, TtsRequest, TtsResult } from './TTSProvider'

/**
 * HostGatewayTtsProvider —— 把 TTS（角色音色 / 旁白合成）委托给宿主 forgeax-server
 * 的 litellm 网关（`/__ce-api__/reel-tts`，OpenAI 兼容 /audio/speech），而不是浏览器
 * 直连豆包并把 key 打进 bundle。
 *
 * 为什么（作者 2026-06 · 全部走 litellm + 密钥红线）：
 *   · 原 createTtsClient 用 `__RS_TTS_KEY__` 编译期注入，key 进前端 bundle —— 违反
 *     「key 不进前端」红线。
 *   · 改走宿主后，TTS key 全程留在 server（litellm 代理），浏览器只发同源
 *     `/__ce-api__/reel-tts`。
 *
 * voice 沿用原 voice_type 编码（BV001_streaming 等），litellm 透传不映射。
 */

interface ReelTtsResp {
  success?: boolean
  base64?: string
  mimeType?: string
  error?: string
}

export class HostGatewayTtsProvider implements TtsClient {
  private readonly base: string
  private readonly model?: string

  constructor(opts: { base?: string; model?: string } = {}) {
    this.base = (opts.base ?? '/__ce-api__').replace(/\/$/, '')
    this.model = opts.model
  }

  getProviderName(): string {
    return 'HostGatewayTTS'
  }

  async synth(req: TtsRequest): Promise<TtsResult> {
    const start = Date.now()
    const resp = await fetch(`${this.base}/reel-tts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: req.text,
        voice: req.voiceType,
        speed: req.speedRatio,
        model: this.model,
      }),
    })
    const raw = await resp.text()
    if (!resp.ok) {
      throw new Error(`[tts] host gateway HTTP ${resp.status}: ${raw.slice(0, 240)}`)
    }
    let data: ReelTtsResp
    try {
      data = JSON.parse(raw) as ReelTtsResp
    } catch {
      throw new Error(`[tts] host gateway non-JSON · ${raw.slice(0, 200)}`)
    }
    if (!data.success || !data.base64) {
      throw new Error(data.error || '宿主 TTS 网关合成失败')
    }
    const mime = data.mimeType && data.mimeType.includes('audio') ? data.mimeType : 'audio/mpeg'
    return {
      dataUrl: `data:${mime};base64,${data.base64}`,
      mimeType: 'audio/mpeg',
      base64: data.base64,
      voiceType: req.voiceType,
      text: req.text,
      latencyMs: Date.now() - start,
    }
  }
}

/**
 * 是否走宿主 TTS 网关（litellm）。
 *   - 嵌入宿主（path 含 /plugins/wb-reel）→ 默认开
 *   - localStorage `reel-studio.ttsProvider`：'host' 强制开 / 'direct' 强制关
 */
export function shouldUseHostTtsGateway(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const override = window.localStorage.getItem('reel-studio.ttsProvider')
    if (override === 'host') return true
    if (override === 'direct') return false
  } catch {
    /* ignore */
  }
  // 同 HostGatewayImageProvider：独立插件 dev 把 wb-reel iframe 到自己端口
  // （路径 '/'），仍经宿主 /__ce-api__ 反代到 forgeax-server → litellm。
  // 「被 iframe 嵌入」即默认走宿主网关；真正独立打开才回落直连。
  if (window.location.pathname.includes('/plugins/wb-reel')) return true
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}
