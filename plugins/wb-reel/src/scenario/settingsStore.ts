import { create } from 'zustand'
import type { VideoConfig } from './types'

/**
 * 全局运行时设置 —— 与 Scenario JSON 解耦，存 localStorage。
 *
 * 主要承载：
 *   - 视频模型 API（key/base/model）：用户在 UI 里填，下次还在
 *   - 未来可加：UI 主题、自动生图开关、外部代理等
 *
 * 用户在剧本里 (Scenario.videoConfig) 也能配置；优先级：
 *   Scenario.videoConfig > settingsStore.videoConfig
 * 这样剧本 JSON 里可以固化每个剧本独立的视频参数；全局 settings 是默认兜底。
 *
 * build-time 注入的默认值（由 vite.config.ts 的 `define` 提供）：
 *   __RS_VIDEO_KEY__ / __RS_VIDEO_BASE__ / __RS_VIDEO_MODEL__
 * 这样作者新装机器打开 → 视频 key 已自动配好，
 * 不必再去"视频模型"面板手填。用户仍可以覆盖。
 *
 * 安全边界：
 *   - __RS_VIDEO_KEY__ 来自本机 `key/llm_key.json`（.gitignore 屏蔽）
 *   - build 产物里会以原文嵌入（和 __RS_GEMINI_KEY__ 等同一策略）
 *   - 公共分发（`npm run build:standalone` + RS_NO_KEY=1）会清空这些常量
 */

const STORAGE_KEY = 'reel-studio.settings.v1'

/**
 * 批量/编排生成的客户端并发（按媒体类型分池）。
 *
 * 语义：同一时刻最多并行多少个该类型的"生成任务"。
 *   - litellm 统一代理内置并发 100，瓶颈从单 deployment 限速转移到代理侧，
 *     因此这里默认值比历史 imageRateLimiter 时代（图像 3）显著提高。
 *   - 视频是异步长任务（Seedance 60-180s），并发指"同时在飞的任务数"，
 *     受上游队列配额约束，默认保守。
 * Power User 可在设置里调。
 */
export interface GenConcurrency {
  image: number
  video: number
  audio: number
}

export interface ReelSettings {
  videoConfig: VideoConfig
  genConcurrency: GenConcurrency
}

const DEFAULT_GEN_CONCURRENCY: GenConcurrency = {
  image: 6,
  video: 6,
  audio: 4,
}

const DEFAULT: ReelSettings = {
  genConcurrency: { ...DEFAULT_GEN_CONCURRENCY },
  videoConfig: {
    // 默认 'seedance'（直连火山方舟）。但嵌入宿主时 createVideoProvider 恒走
    // 宿主 litellm 视频网关（HostGatewayVideoProvider），key 留 server、前端拿不到。
    // 仅在「独立打开 + 显式配了 apiKey」时才用此处的直连配置。
    provider: 'seedance',
    apiKey: typeof __RS_VIDEO_KEY__ !== 'undefined' ? __RS_VIDEO_KEY__ : '',
    apiBase:
      typeof __RS_VIDEO_BASE__ !== 'undefined' && __RS_VIDEO_BASE__
        ? __RS_VIDEO_BASE__
        : 'https://ark.cn-beijing.volces.com/api/v3',
    model:
      typeof __RS_VIDEO_MODEL__ !== 'undefined' && __RS_VIDEO_MODEL__
        ? __RS_VIDEO_MODEL__
        : 'doubao-seedance-2-0-260128',
    durationSec: 5,
    size: '1080p',
  },
}

function load(): ReelSettings {
  if (typeof window === 'undefined') return DEFAULT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw) as Partial<ReelSettings>
    const savedVid: Partial<VideoConfig> = parsed.videoConfig ?? {}
    // 合并：用户在 UI 里填的非空 apiKey 优先；没填就用 build-time 的默认值兜底。
    //   - 老的历史数据是 `apiKey: ''`（从未填过）→ 应走默认值（新装机器打开就能用）
    //   - 用户主动填过值 → 其值胜出（可覆盖 build-time 默认）
    //   - 用户主动点过"清除 KEY"（apiKey='') → 确实是想清；但下次 reload 又会从 build-time 恢复
    //     （这是合理取舍：我们倾向于"有默认值的 UX" 多于"清除意图的持久性"）
    const merged: VideoConfig = {
      ...DEFAULT.videoConfig,
      ...savedVid,
    }
    if (!savedVid.apiKey || !String(savedVid.apiKey).trim()) {
      merged.apiKey = DEFAULT.videoConfig.apiKey
    }
    if (!savedVid.apiBase || !String(savedVid.apiBase).trim()) {
      merged.apiBase = DEFAULT.videoConfig.apiBase
    }
    // 模型默认/迁移：空 → 用默认；历史写死的 1.0（doubao-seedance-1-0-pro-250528）
    //   自动升级到 2.0 默认（R2V）。否则老 localStorage 会一直把 1.0 盖回来，
    //   作者明明已改用 seedance 2.0，快照里却仍显示 1.0。
    if (
      !savedVid.model ||
      !String(savedVid.model).trim() ||
      String(savedVid.model).trim() === 'doubao-seedance-1-0-pro-250528'
    ) {
      merged.model = DEFAULT.videoConfig.model
    }
    const savedConc: Partial<GenConcurrency> = parsed.genConcurrency ?? {}
    const clamp = (n: unknown, def: number): number => {
      const v = Number(n)
      return Number.isFinite(v) && v >= 1 ? Math.min(64, Math.floor(v)) : def
    }
    const mergedConc: GenConcurrency = {
      image: clamp(savedConc.image, DEFAULT_GEN_CONCURRENCY.image),
      video: clamp(savedConc.video, DEFAULT_GEN_CONCURRENCY.video),
      audio: clamp(savedConc.audio, DEFAULT_GEN_CONCURRENCY.audio),
    }
    return { videoConfig: merged, genConcurrency: mergedConc }
  } catch {
    return DEFAULT
  }
}

function save(s: ReelSettings): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch (e) {
    console.warn('[settingsStore] save failed:', e)
  }
}

interface SettingsState extends ReelSettings {
  setVideoConfig: (patch: Partial<VideoConfig>) => void
  setGenConcurrency: (patch: Partial<GenConcurrency>) => void
  reset: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...load(),
  setVideoConfig: (patch) => {
    const next: VideoConfig = { ...get().videoConfig, ...patch }
    set({ videoConfig: next })
    save({ videoConfig: next, genConcurrency: get().genConcurrency })
  },
  setGenConcurrency: (patch) => {
    const cur = get().genConcurrency
    const clamp = (n: number | undefined, def: number): number =>
      n != null && Number.isFinite(n) && n >= 1 ? Math.min(64, Math.floor(n)) : def
    const next: GenConcurrency = {
      image: clamp(patch.image, cur.image),
      video: clamp(patch.video, cur.video),
      audio: clamp(patch.audio, cur.audio),
    }
    set({ genConcurrency: next })
    save({ videoConfig: get().videoConfig, genConcurrency: next })
  },
  reset: () => {
    set(DEFAULT)
    save(DEFAULT)
  },
}))

/** 非 React 读取（队列/编排模块用）。回落到默认值。 */
export function getGenConcurrency(): GenConcurrency {
  try {
    return useSettingsStore.getState().genConcurrency ?? { ...DEFAULT_GEN_CONCURRENCY }
  } catch {
    return { ...DEFAULT_GEN_CONCURRENCY }
  }
}
