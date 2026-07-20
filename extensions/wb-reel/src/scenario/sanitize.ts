/**
 * Scenario sanitize —— 单一职责的"安全围栏"
 *
 * 设计动机：
 *   1. 视频模型 apiKey、apiBase 都是 USER SECRET，**绝不能**进入剧本 JSON
 *      （JSON 会被导出、git commit、bug report、外发分享 → 一旦泄露代价巨大）
 *   2. 但 Scenario.videoConfig 里允许保留 model / durationSec / size 这种
 *      "项目级配置"信息，方便不同机器打开仍走同一套生成参数
 *   3. 防御纵深：
 *        a) setVideoConfig action 里就拒收 apiKey/apiBase（store 层兜底）
 *        b) exportJSON 再 sanitize 一遍（IO 层兜底）
 *        c) importJSON 也 sanitize（防止外部剧本注入恶意 endpoint / key）
 *
 * 凡是涉及 secret 的修改，**必须**经过这里，不要绕过。
 */

import type { Scenario, VideoConfig } from './types'

/**
 * 允许进入 Scenario JSON 的 videoConfig 字段（白名单）。
 * apiKey / apiBase 永远不在这里。
 */
const PUBLIC_VIDEO_FIELDS = [
  'provider',
  'model',
  'durationSec',
  'size',
  'generateAudio',
  'watermark',
] as const

/**
 * 从一份"任意来源"的 VideoConfig 中只挑公共字段。
 * 用于 setVideoConfig（写入 store）和 exportJSON（落到 JSON）。
 */
export function pickPublicVideoConfig(
  cfg: Partial<VideoConfig> | undefined,
): Partial<VideoConfig> {
  if (!cfg) return {}
  const out: Partial<VideoConfig> = {}
  for (const k of PUBLIC_VIDEO_FIELDS) {
    if (cfg[k] !== undefined) {
      out[k] = cfg[k] as never
    }
  }
  return out
}

/**
 * 导出 / 导入剧本 JSON 时使用：
 *   - 强制清掉 videoConfig.apiKey / apiBase
 *   - 未来若再加敏感字段（如 webhookSecret、authToken），都加到这里
 *
 * 返回**新对象**，不修改入参。
 */
export function sanitizeScenarioForIO(scenario: Scenario): Scenario {
  const next: Scenario = { ...scenario }
  if (scenario.videoConfig) {
    next.videoConfig = {
      provider: scenario.videoConfig.provider ?? 'seedance',
      ...pickPublicVideoConfig(scenario.videoConfig),
    }
  }
  return next
}

/**
 * 真要在日志/调试里展示 key 时，掩码到只剩前 4 + 后 4 字符。
 * 永远不要 console.log 原文 key。
 */
export function maskSecret(s: string | undefined): string {
  if (!s) return '(empty)'
  if (s.length <= 8) return '*'.repeat(s.length)
  return `${s.slice(0, 4)}…${s.slice(-4)} (len=${s.length})`
}
