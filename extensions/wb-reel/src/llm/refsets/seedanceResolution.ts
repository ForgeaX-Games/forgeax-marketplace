/**
 * seedanceResolution —— 豆包 Seedance 视频分辨率 / 比例 & 像素表唯一事实源
 *
 * 背景（2026-06 重新核对火山官方文档后修订）：
 *   Seedance 视频 API 顶层字段：
 *     body.model       = 'doubao-seedance-*' 或 endpoint id
 *     body.resolution  = '480p' | '720p' | '1080p'   ← **真字段**，默认 720p；
 *                          1080p 仅部分模型（如 doubao-seedance-2.0 / *-pro）支持
 *     body.ratio       = '16:9'|'9:16'|'1:1'|'4:3'|'3:4'|'21:9'|'adaptive'  ← 顶层字段
 *     body.duration    = <秒>
 *     body.generate_audio = bool
 *     body.watermark      = bool
 *
 *   订正：早期（2026-05）误判“无 resolution 字段、档位由 endpoint 决定”。
 *   当前官方文档明确 `resolution` 为可发送字段，故现在直接下发。
 *   `adaptive` 比例：模型按首帧/参考媒体自动选最接近比例，无固定像素。
 *
 * `VideoSize` 是**客户端历史档位表达**（tier+ratio 合一），保留用于：
 *     - 兼容已持久化 scenario.json
 *     - tail-frame canvas 尺寸 pxWidth × pxHeight
 *   新代码优先用独立的 `SeedanceResolutionTier` + `SeedanceRatio` 两个维度
 *   （见 SEEDANCE_RESOLUTION_CHOICES / SEEDANCE_RATIO_CHOICES）。
 *
 * 下游（只读）：
 *   - VideoProvider.createTask：读 resolution + ratio 拼进 request body
 *   - videoPipelineRunner：读 pxWidth/pxHeight 给 tail frame canvas
 *   - AssetCard / VideoModelConfig.tsx：UI 下拉
 */

// ─────────────────────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 视频 size 表达式（**客户端概念**，不直接进 API）。
 *
 * 三类合法形态：
 *   - **档位**（推荐）：`'1080p' | '1080p-portrait' | '720p' | '720p-portrait' | '720p-square' | '480p'`
 *   - **旧像素串**（别名，仅为兼容已持久化 scenario）：`'1280x720' | '720x1280' | '1024x1024'`
 *
 * 未来迁移：把所有旧像素串一次性替换为档位字符串；届时可把旧 union 删掉。
 */
export type VideoSize =
  | '1080p'
  | '1080p-portrait'
  | '720p'
  | '720p-portrait'
  | '720p-square'
  | '480p'
  // 旧像素字符串 · 不推荐新增使用，仅兼容已持久化数据
  | '1280x720'
  | '720x1280'
  | '1024x1024'

export type SeedanceResolutionTier = '480p' | '720p' | '1080p'
export type SeedanceRatio =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:3'
  | '3:4'
  | '21:9'
  | 'adaptive'

export interface SeedanceResolutionSpec {
  /**
   * 档位标签（**仅用于 UI 展示 / 日志**；不作为 API 参数发送）。
   * 真实档位取决于 endpoint。
   */
  resolution: SeedanceResolutionTier
  /**
   * API 顶层字段 `ratio` 的真实取值。**唯一**会被写进请求 body 的字段。
   */
  ratio: SeedanceRatio
  /** 实际像素宽度（tail frame canvas 用） */
  pxWidth: number
  /** 实际像素高度 */
  pxHeight: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 别名归一化
// ─────────────────────────────────────────────────────────────────────────────

interface NormalizedSize {
  tier: SeedanceResolutionTier
  ratio: SeedanceRatio
}

/**
 * 把任意合法 VideoSize（含旧像素串别名）归一化为 { tier, ratio }。
 *
 * 旧像素串映射：
 *   1280x720  → 720p 16:9
 *   720x1280  → 720p 9:16
 *   1024x1024 → 720p-square（Seedance 1:1 实际像素 960×960 ≈ 720p 档）
 */
function normalizeSize(size: VideoSize | undefined): NormalizedSize {
  switch (size) {
    case '1080p':
      return { tier: '1080p', ratio: '16:9' }
    case '1080p-portrait':
      return { tier: '1080p', ratio: '9:16' }
    case '720p':
    case '1280x720':
      return { tier: '720p', ratio: '16:9' }
    case '720p-portrait':
    case '720x1280':
      return { tier: '720p', ratio: '9:16' }
    case '720p-square':
    case '1024x1024':
      return { tier: '720p', ratio: '1:1' }
    case '480p':
      return { tier: '480p', ratio: '16:9' }
    default:
      // 默认 1080p 16:9
      return { tier: '1080p', ratio: '16:9' }
  }
}

/**
 * 不同 tier × ratio 的实际像素（tail frame canvas 用）。
 * 来源：火山方舟官方文档 2026-05 抓取。
 */
const PIXEL_TABLE: Record<
  SeedanceResolutionTier,
  Record<SeedanceRatio, [number, number]>
> = {
  '480p': {
    '16:9': [864, 480],
    '9:16': [480, 864],
    '1:1': [640, 640],
    '4:3': [736, 544],
    '3:4': [544, 736],
    '21:9': [1120, 480],
    // adaptive 无固定像素 —— 回落该 tier 的 16:9（仅 tail-frame canvas 用）
    adaptive: [864, 480],
  },
  '720p': {
    '16:9': [1280, 720],
    '9:16': [720, 1280],
    '1:1': [960, 960],
    '4:3': [1104, 832],
    '3:4': [832, 1104],
    '21:9': [1680, 720],
    adaptive: [1280, 720],
  },
  '1080p': {
    // 1088 是官方表里的实际值（16 的倍数），不是 1080
    '16:9': [1920, 1088],
    '9:16': [1088, 1920],
    '1:1': [1440, 1440],
    '4:3': [1664, 1248],
    '3:4': [1248, 1664],
    '21:9': [2560, 1088],
    adaptive: [1920, 1088],
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// 主解析函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 把 VideoSize 解析为完整的 Seedance 调用规格。
 *
 * 纯函数——不读 DOM、不打网络、不 log。
 *
 * **注意 2026-05 后**：本函数不再执行 I2V 1080p→720p 降级（档位由 endpoint
 * 决定，client 猜不到也不该猜）。`resolution` 字段也不会被发给 API，
 * 仅用于 UI 标签。
 *
 * @example
 *   resolveSeedanceResolution('1080p')
 *   // → { resolution:'1080p', ratio:'16:9', pxWidth:1920, pxHeight:1088 }
 */
export function resolveSeedanceResolution(
  size: VideoSize | undefined,
): SeedanceResolutionSpec {
  const { tier, ratio } = normalizeSize(size)
  const [pxWidth, pxHeight] = PIXEL_TABLE[tier][ratio]
  return { resolution: tier, ratio, pxWidth, pxHeight }
}

// ─────────────────────────────────────────────────────────────────────────────
// UI 展示
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UI 下拉每个 option 的显示标签。
 */
export function toDisplayLabel(size: VideoSize): string {
  switch (size) {
    case '1080p':
      return '1080p · 横屏 16:9（1920×1088）'
    case '1080p-portrait':
      return '1080p · 竖屏 9:16（1088×1920）'
    case '720p':
    case '1280x720':
      return '720p · 横屏 16:9（1280×720）'
    case '720p-portrait':
    case '720x1280':
      return '720p · 竖屏 9:16（720×1280）'
    case '720p-square':
    case '1024x1024':
      return '720p · 方形 1:1（960×960）'
    case '480p':
      return '480p · 横屏 16:9（864×480）'
    default:
      return String(size)
  }
}

/**
 * UI 下拉候选顺序（不含旧像素串别名）。
 */
export const VIDEO_SIZE_CHOICES: readonly VideoSize[] = [
  '1080p',
  '1080p-portrait',
  '720p',
  '720p-portrait',
  '720p-square',
  '480p',
] as const

/**
 * 默认视频 size —— 1080p 横屏。新代码请用 DEFAULT_RESOLUTION / DEFAULT_RATIO。
 */
export const DEFAULT_VIDEO_SIZE: VideoSize = '1080p'

// ─────────────────────────────────────────────────────────────────────────────
// 独立维度：分辨率 × 比例（新 UI / 新请求体推荐）
// ─────────────────────────────────────────────────────────────────────────────

/** 默认分辨率档位 —— 官方默认 720p，这里沿用工程偏好 1080p。 */
export const DEFAULT_RESOLUTION: SeedanceResolutionTier = '1080p'
/** 默认比例 —— 横屏 16:9。 */
export const DEFAULT_RATIO: SeedanceRatio = '16:9'

/** UI 分辨率下拉候选（含 1080p 说明：仅部分模型支持）。 */
export const SEEDANCE_RESOLUTION_CHOICES: readonly {
  value: SeedanceResolutionTier
  label: string
}[] = [
  { value: '1080p', label: '1080p · 全高清（仅部分模型）' },
  { value: '720p', label: '720p · 高清' },
  { value: '480p', label: '480p · 标清' },
] as const

/** UI 比例下拉候选（官方全集）。 */
export const SEEDANCE_RATIO_CHOICES: readonly {
  value: SeedanceRatio
  label: string
}[] = [
  { value: '16:9', label: '16:9 · 横屏' },
  { value: '9:16', label: '9:16 · 竖屏' },
  { value: '1:1', label: '1:1 · 方形' },
  { value: '4:3', label: '4:3 · 横屏传统' },
  { value: '3:4', label: '3:4 · 竖屏传统' },
  { value: '21:9', label: '21:9 · 宽银幕' },
  { value: 'adaptive', label: 'adaptive · 自适应（按首帧/参考自动）' },
] as const

/**
 * 由独立的 (resolution, ratio) 解析完整规格（tail-frame canvas 用）。
 * adaptive 无固定像素，回落该 tier 的 16:9 像素仅供 canvas 兜底。
 */
export function resolveExplicit(
  resolution: SeedanceResolutionTier | undefined,
  ratio: SeedanceRatio | undefined,
): SeedanceResolutionSpec {
  const tier: SeedanceResolutionTier = resolution ?? DEFAULT_RESOLUTION
  const r: SeedanceRatio = ratio ?? DEFAULT_RATIO
  const [pxWidth, pxHeight] = PIXEL_TABLE[tier][r]
  return { resolution: tier, ratio: r, pxWidth, pxHeight }
}
