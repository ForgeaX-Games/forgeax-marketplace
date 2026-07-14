/**
 * TTS Provider —— 文本转语音 HTTP 客户端
 *
 * 端点（同步合成 REST）：
 *   POST `<apiBase>/api/v1/tts`
 *   Header: `Authorization: Bearer; <api_key>`
 *           `Content-Type: application/json`
 *   Body 示例：
 *   ```json
 *   {
 *     "app":     { "appid": "<app_id>", "token": "ignored", "cluster": "volcano_tts" },
 *     "user":    { "uid": "reel-studio" },
 *     "audio":   { "voice_type": "BV001_streaming", "encoding": "mp3", "speed_ratio": 1.0 },
 *     "request": { "reqid": "<uuid>", "text": "...", "operation": "query" }
 *   }
 *   ```
 *   响应：
 *   ```json
 *   { "code": 3000, "message": "Success", "data": "<base64 mp3>" }
 *   ```
 *   code 3000 = success；其他 code 为业务错。
 *
 * 设计意图：
 *   - 角色音色锚点 / 后续旁白配音 / 字幕配音 都走它。
 *   - 当前仅用于"试听 + 锚定 voice_type"；真正的剧本配音批量合成等
 *     新需求来时再扩展。
 *
 * Mock 兜底：
 *   - apiKey 为空时返回一段极短的 silent mp3（base64），让 UI 流转测试不阻塞。
 *   - silent mp3 内容是 ID3 头 + 1 帧静音，浏览器 audio 标签能播 0.05 秒。
 *
 * 跨域：
 *   - 实际后端 `openspeech.bytedance.com` 不返回 CORS 头，浏览器直连必拒。
 *   - 默认 `apiBase = '/__tts__'`，由 vite dev server / nginx 反代到真实后端。
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { HostGatewayTtsProvider, shouldUseHostTtsGateway } from './HostGatewayTTSProvider'

export interface TtsRequest {
  text: string
  voiceType: string
  /** 0.5 - 2.0，默认 1.0 */
  speedRatio?: number
  /** UI 显示用，不影响合成 */
  label?: string
}

export interface TtsResult {
  /** data:audio/mp3;base64,... 格式，可直接 <audio src> 或落到 mediaStore */
  dataUrl: string
  mimeType: 'audio/mpeg'
  base64: string
  voiceType: string
  text: string
  /** 真实合成毫秒数（mock 时 = 0） */
  latencyMs: number
  /** mock=true 时表示走的是无 key 占位路径 */
  mock?: boolean
}

export interface TtsClient {
  synth: (req: TtsRequest) => Promise<TtsResult>
  getProviderName: () => string
}

interface TtsConfig {
  apiKey: string
  appId: string
  /** 默认 'volcano_tts'。某些 voice_type（如音乐合成）需要换 cluster */
  cluster?: string
  /** 默认 '/__tts__'（同源反代路径） */
  apiBase?: string
}

/**
 * 通用 TTS "通用场景"音色精选 —— 给作者一个收口的下拉。
 *
 * 完整音色 ID 体系沿用上游 voice_type 编码（BV001_streaming 等），
 * 以下挑了主流播音员级、覆盖男女老少 + 情绪向，足以应对 90% 的剧本角色。
 */
export interface VoicePreset {
  voiceType: string
  label: string
  /** 'male' | 'female' | 'child' | 'special' —— UI 分组用 */
  gender: 'male' | 'female' | 'child' | 'special'
  /** 一句话风格描述，UI 提示 */
  style: string
}

// 音色编码 = 豆包「大模型语音合成」(bigtts) voice_type，经宿主 /reel-tts → litellm
// `doubao-tts` 透传不映射。名字自带性别（zh_female_/zh_male_），保证卡片性别与
// 实际音色一致。2026-06 逐个实测过这些 ID 在代理上可正常合成。
export const TTS_VOICE_PRESETS: VoicePreset[] = [
  // 通用女声
  { voiceType: 'zh_female_zhixingnvsheng_mars_bigtts', label: '通用女声 · 知性', gender: 'female', style: '温和清晰，新闻播报感' },
  { voiceType: 'zh_female_cancan_mars_bigtts', label: '灿灿 · 多情感', gender: 'female', style: '青春有活力，自带情绪表达' },
  { voiceType: 'zh_female_tianmeixiaoyuan_moon_bigtts', label: '甜美小源 · 元气', gender: 'female', style: '元气少女，活泼跳脱' },
  { voiceType: 'zh_female_gaolengyujie_moon_bigtts', label: '高冷御姐 · 主持', gender: 'female', style: '沉稳大气，御姐质感' },
  // 通用男声
  { voiceType: 'zh_male_qingshuangnanda_mars_bigtts', label: '通用男声 · 标准', gender: 'male', style: '清爽普通话，沉稳大方' },
  { voiceType: 'zh_male_wennuanahu_moon_bigtts', label: '温暖阿虎 · 多情感', gender: 'male', style: '有磁性的男声，台词感强' },
  { voiceType: 'zh_male_yangguangqingnian_moon_bigtts', label: '阳光男声 · 青年', gender: 'male', style: '阳光开朗，二十出头的小生' },
  { voiceType: 'zh_male_jingqiangkanye_moon_bigtts', label: '醇厚男声 · 旁白', gender: 'male', style: '低沉醇厚，京味旁白质感' },
  // 童声
  { voiceType: 'zh_male_naiqimengwa_mars_bigtts', label: '奶气萌娃', gender: 'child', style: '童趣，五六岁的孩子' },
  // 特色
  { voiceType: 'zh_female_wanwanxiaohe_moon_bigtts', label: '台湾女声 · 软糯', gender: 'special', style: '台湾腔，软糯亲切' },
  { voiceType: 'zh_female_popo_mars_bigtts', label: '慈祥婆婆', gender: 'special', style: '年长女声，慈祥温厚' },
]

/**
 * 默认试听文本 —— 覆盖普通话语调 / 数字 / 英文，
 * 让作者在 5 秒内能判断这个音色"对不对味"。
 */
export const DEFAULT_TTS_SAMPLE_TEXT =
  '你好，欢迎使用 Reel-Studio 语音合成。今天的天气真好，我们一起去公园散步吧。1234567890。Welcome to Reel TTS.'

/* —— silent mp3（约 0.05s，ID3 + 单帧）——————————————————————————
   生成方式：`ffmpeg -f lavfi -i anullsrc=r=24000:cl=mono -t 0.05 -b:a 32k silent.mp3`
   再 base64-encode。这里硬编码避免编译期文件 IO，兼容浏览器构建。
   长度足以让 <audio> tag 触发 onloadeddata，UI 状态机能流转完整闭环。 */
const SILENT_MP3_BASE64 =
  'SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAA' +
  'AAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAGAAAGgABBQUFBQUFBQUFBQ' +
  'UFBVlZWVlZWVlZWVlZWVlZWVlZWampqampqampqampqampqaqenp6enp6enp6enp6en' +
  'p7Kysv//////////////////////////////////////////////8AAAAATGF2YzU4Lj' +
  'EzAAAAAAAAAAAAAAAAJAAAAAAAAAAABoCAhxIAAAAAAAAAAAAAAAAAAP/7UMAAA8AABp' +
  'AAAACAAADSAAAAEAA='

/**
 * 创建 TTS client。
 *
 * 字段缺失策略：
 *   - apiKey 或 appId 为空 → 返回 mock client（不打网络），所有合成
 *     调用返回 SILENT_MP3 占位，便于离线 UI 测试。
 *   - 配置完整 → 返回真 client。
 */
export function createTtsClient(cfg: TtsConfig): TtsClient {
  const apiKey = cfg.apiKey?.trim() ?? ''
  const appId = cfg.appId?.trim() ?? ''
  if (!apiKey || !appId) {
    return {
      synth: async (req) => ({
        dataUrl: `data:audio/mpeg;base64,${SILENT_MP3_BASE64}`,
        mimeType: 'audio/mpeg',
        base64: SILENT_MP3_BASE64,
        voiceType: req.voiceType,
        text: req.text,
        latencyMs: 0,
        mock: true,
      }),
      getProviderName: () => 'tts(mock)',
    }
  }

  const apiBase = (cfg.apiBase ?? '/__tts__').replace(/\/$/, '')
  const cluster = cfg.cluster ?? 'volcano_tts'
  const url = `${apiBase}/api/v1/tts`

  return {
    synth: async (req) => {
      const start = Date.now()
      const reqid =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? (crypto as any).randomUUID()
          : `req-${start}-${Math.random().toString(36).slice(2, 8)}`

      const body = {
        app: { appid: appId, token: 'ignored', cluster },
        user: { uid: 'reel-studio' },
        audio: {
          voice_type: req.voiceType,
          encoding: 'mp3',
          speed_ratio: req.speedRatio ?? 1.0,
        },
        request: {
          reqid,
          text: req.text,
          // 'query' = 一次性同步合成 (返回完整 base64 mp3)。流式走 'submit'。
          operation: 'query',
        },
      }

      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          // 上游鉴权约定: "Bearer; <token>" (注意分号，是字面量，不是笔误)
          Authorization: `Bearer; ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '')
        throw new Error(`[tts] HTTP ${resp.status}: ${txt.slice(0, 300)}`)
      }
      const json = (await resp.json()) as {
        code?: number
        message?: string
        data?: string
        sequence?: number
      }
      if (json.code !== 3000 || !json.data) {
        throw new Error(
          `[tts] code=${json.code} ${json.message ?? ''}`.trim(),
        )
      }
      return {
        dataUrl: `data:audio/mpeg;base64,${json.data}`,
        mimeType: 'audio/mpeg',
        base64: json.data,
        voiceType: req.voiceType,
        text: req.text,
        latencyMs: Date.now() - start,
      }
    },
    getProviderName: () => 'tts',
  }
}

/**
 * 全局 TTS client 单例 —— 直接读 build-time 注入的 __RS_TTS_*__ 常量。
 *
 * 没注入时返回 mock client，保证 UI 永远能调用 `tts.synth(...)` 拿到合法
 * dataUrl，不需要在调用点做"key 是否存在"的分支。
 */
let _instance: TtsClient | null = null

export function getTtsClient(): TtsClient {
  if (_instance) return _instance
  // 嵌入宿主时优先走 litellm 网关（key 不进前端）；独立 dev 回落到编译期注入/mock。
  if (shouldUseHostTtsGateway()) {
    _instance = new HostGatewayTtsProvider()
    return _instance
  }
  // build 时由 vite define 注入；未注入时全部回落到空串 → mock 路径
  const apiKey = typeof __RS_TTS_KEY__ !== 'undefined' ? __RS_TTS_KEY__ : ''
  const appId = typeof __RS_TTS_APP_ID__ !== 'undefined' ? __RS_TTS_APP_ID__ : ''
  const apiBase =
    typeof __RS_TTS_BASE__ !== 'undefined' && __RS_TTS_BASE__
      ? __RS_TTS_BASE__
      : undefined
  const cluster =
    typeof __RS_TTS_CLUSTER__ !== 'undefined' && __RS_TTS_CLUSTER__
      ? __RS_TTS_CLUSTER__
      : undefined
  _instance = createTtsClient({ apiKey, appId, apiBase, cluster })
  return _instance
}

/** 测试用：让单测能注入自己的 client（resetClient + setClient） */
export function _setTtsClientForTest(c: TtsClient | null): void {
  _instance = c
}
