/**
 * modelCapabilities —— 视频模型能力位清单（v3.8 新增 · 单一事实源）
 *
 * 目的：
 *   把"这个视频模型最多能一次生多久 / 支不支持首尾帧 / 默认档位是什么"
 *   **集中**在这里。所有策略层（forgeVideoPlan、videoSchedule、kineticVideoPrompt skill）
 *   都**只读**本文件，不自行猜测。
 *
 * 这让未来升级变得透明：
 *   - Seedance 从 10s 升到 15s？只改 `maxSingleClipSec`
 *   - Sora 2 公开 API？加一条记录
 *   - 作者想并存 Seedance + Veo？两条记录 + UI 选择器
 *
 * 设计约束：
 *   1) 纯数据 + 纯函数，不 import provider / scenario / React
 *   2) 值基于"**写本文件时的官方公开规格**"，写入日期在字段上
 *   3) 能力位用**保守值**——宁可低估不要高估（Seedance 官方 12s 实测 10s 稳，就写 10）
 *
 * 数据新鲜度：2026-05 实测 · 若模型方升级，改值时请同步更新 `asOf` 字段
 */

/**
 * 视频模型 id —— 与 VideoConfig.model 对齐，**这里不做新增**；
 * 新模型先在 VideoConfig 里加，再到本文件补能力条目。
 */
export type VideoModelId =
  | 'seedance-doubao'
  | 'seedance-2-0'
  | 'seedance-2-0-fast'
  | 'sora-2'
  | 'kling-1.6'
  | 'veo-3'
  | 'runway-gen4'

export interface ModelCapability {
  id: VideoModelId
  displayName: string
  /** 规格快照日期，提醒后人"这份值是何时的行情" */
  asOf: string
  /**
   * 单次生成最长秒数。
   * **保守值**：实测稳定可用的上限，不是官方标称极限。
   * Planner 会按此值切分镜（durationSec > 本值 → 必须拆成多段）。
   */
  maxSingleClipSec: number
  /**
   * 最小有意义秒数。
   * **大部分模型 <3s 会忽略 prompt 里的运镜指令**，直接输出静态微抖；
   * Planner 遇到 durationSec < 本值会告警，但不强制改（UI 层可选"静图代替"）。
   */
  minUsefulClipSec: number
  /**
   * 是否支持首尾帧 (A/B keyframe) 首尾约束。
   * 支持 → `keyframeStrategy='ab'` 的 shot 可以把 A/B 两张图直接喂模型
   * 不支持 → 只能 image-to-video（单图起手），结尾靠 prompt 约束
   */
  supportsStartEndFrame: boolean
  /**
   * 是否支持 image-to-video（最基础的）。几乎都是 true，但 Veo 3 早期只有 text-to-video。
   */
  supportsImageToVideo: boolean
  /**
   * 是否支持 text-to-video（无参考图）。
   */
  supportsTextToVideo: boolean
  /**
   * 建议并发数：同时提交多少个任务不会被 rate-limit 打。
   * VideoSchedule 并行分支时会取此值为上限。
   */
  recommendedConcurrency: number
  /**
   * 单任务平均时长（秒）—— Planner UI 估算总耗时时用；不影响功能。
   */
  typicalJobLatencySec: number
  /**
   * 备注 —— "实测：prompt 里写 'cut to' 会被忽略" 这种真经验。
   */
  notes: string
  // ── 以下为 2026-06 按官方文档补充的能力位（可选，未填表示未登记/不适用）──
  /** 支持的分辨率档位（下发 body.resolution）。 */
  resolutions?: ('480p' | '720p' | '1080p')[]
  /** 支持的比例（下发 body.ratio）。 */
  ratios?: ('16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' | 'adaptive')[]
  /** 官方时长区间 [min,max]（秒）；UI 滑杆范围。 */
  durationRangeSec?: [number, number]
  /** 多模态参考模式上限：参考图 / 参考视频 / 参考音频各自最多个数。 */
  maxRefImages?: number
  maxRefVideos?: number
  maxRefAudios?: number
  /** 是否支持「生成同步音轨」(body.generate_audio)。 */
  supportsGenerateAudio?: boolean
  /**
   * 是否支持「返回尾帧」(body.return_last_frame)：生成完直接回传末帧，
   * 供「设为下一段首帧」做一镜到底续接（P3-D 尾帧交互的优选来源）。
   */
  supportsReturnLastFrame?: boolean
  /**
   * 是否支持「原生视频延长」(video extend)：把上一段视频 + 尾帧作输入，
   * 让模型在同一镜头语义里向后续写，实现「一镜到底」跨段连续（P3-C）。
   */
  supportsVideoExtend?: boolean
}

/**
 * 能力表 —— 真值库。
 *
 * 添加新模型三步：
 *   ① `VideoModelId` union 加 id
 *   ② 本表加一条（asOf + notes 必填）
 *   ③ 如果 VideoProvider 接入了新模型，记得 ping 成功后用 getCapability() 测一次
 */
export const MODEL_CAPABILITIES: Record<VideoModelId, ModelCapability> = {
  'seedance-doubao': {
    id: 'seedance-doubao',
    displayName: 'Seedance（火山豆包）',
    asOf: '2026-06',
    // 自动拆段的稳定上限保持 10s（实测 12s 易崩）；官方时长区间见 durationRangeSec。
    maxSingleClipSec: 10,
    minUsefulClipSec: 3,
    // 订正（2026-06 官方文档）：支持首尾帧（image role=first_frame/last_frame，
    // 尾帧必须配首帧）；首尾帧模式与多模态参考模式互斥。
    supportsStartEndFrame: true,
    supportsImageToVideo: true,
    supportsTextToVideo: true,
    recommendedConcurrency: 2,
    typicalJobLatencySec: 45,
    resolutions: ['480p', '720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    durationRangeSec: [2, 12],
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    supportsGenerateAudio: true,
    notes:
      '官方：resolution 480p/720p/1080p（1080p 仅部分模型）、ratio 7 种含 adaptive、时长 2~12s。' +
      '首尾帧（first_frame/last_frame，尾帧需配首帧）与多模态参考（reference_image≤9 + reference_video≤3 + reference_audio≤3）互斥，不可混用。',
  },
  'seedance-2-0': {
    id: 'seedance-2-0',
    displayName: 'Seedance 2.0（火山方舟）',
    asOf: '2026-06',
    // Seedance 2.0 官方时长区间 4~15s，单段稳定上限按官方上限 15s。
    maxSingleClipSec: 15,
    minUsefulClipSec: 4,
    supportsStartEndFrame: true,
    supportsImageToVideo: true,
    supportsTextToVideo: true,
    recommendedConcurrency: 2,
    typicalJobLatencySec: 50,
    resolutions: ['480p', '720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    durationRangeSec: [4, 15],
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    supportsGenerateAudio: true,
    supportsReturnLastFrame: true,
    supportsVideoExtend: true,
    notes:
      '官方：时长 4~15s、24fps；多模态参考（reference_image≤9 + reference_video≤3 + reference_audio≤3）。' +
      '支持 return_last_frame（回传尾帧做续接）+ 原生视频延长（一镜到底）。' +
      '首尾帧（first_frame/last_frame，尾帧需配首帧）与多模态参考互斥。',
  },
  'seedance-2-0-fast': {
    id: 'seedance-2-0-fast',
    displayName: 'Seedance 2.0 Fast（火山方舟）',
    asOf: '2026-06',
    // Fast 档单段上限 12s，无 1080p。
    maxSingleClipSec: 12,
    minUsefulClipSec: 4,
    supportsStartEndFrame: true,
    supportsImageToVideo: true,
    supportsTextToVideo: true,
    recommendedConcurrency: 3,
    typicalJobLatencySec: 30,
    resolutions: ['480p', '720p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    durationRangeSec: [4, 12],
    maxRefImages: 9,
    maxRefVideos: 3,
    maxRefAudios: 3,
    supportsGenerateAudio: true,
    supportsReturnLastFrame: true,
    supportsVideoExtend: true,
    notes:
      'Fast 档：时长 4~12s、24fps、无 1080p（480p/720p）；其余能力同 Seedance 2.0。' +
      '支持 return_last_frame + 原生视频延长。',
  },
  'sora-2': {
    id: 'sora-2',
    displayName: 'Sora 2（OpenAI）',
    asOf: '2026-05',
    maxSingleClipSec: 20,
    minUsefulClipSec: 3,
    supportsStartEndFrame: true,
    supportsImageToVideo: true,
    supportsTextToVideo: true,
    recommendedConcurrency: 3,
    typicalJobLatencySec: 60,
    notes:
      '20s 单段可用但 tier 额度紧；首尾帧需走 storyboard 接口。prompt 里的 cut-to 会被模型忠实执行。',
  },
  'kling-1.6': {
    id: 'kling-1.6',
    displayName: 'Kling 1.6（可灵）',
    asOf: '2026-05',
    maxSingleClipSec: 10,
    minUsefulClipSec: 3,
    supportsStartEndFrame: true,
    supportsImageToVideo: true,
    supportsTextToVideo: true,
    recommendedConcurrency: 2,
    typicalJobLatencySec: 90,
    notes:
      'pro 档位支持 "extend" 2 段接续（2×5s），工程侧仍按 10s 上限处理。支持首尾帧参数 endImage。',
  },
  'veo-3': {
    id: 'veo-3',
    displayName: 'Veo 3（Google）',
    asOf: '2026-05',
    maxSingleClipSec: 8,
    minUsefulClipSec: 2,
    supportsStartEndFrame: false,
    supportsImageToVideo: true,
    supportsTextToVideo: true,
    recommendedConcurrency: 2,
    typicalJobLatencySec: 40,
    notes:
      '短但画质顶；2s 起可用，prompt 对运镜术语（Dolly Zoom / FPV）敏感度最高。',
  },
  'runway-gen4': {
    id: 'runway-gen4',
    displayName: 'Runway Gen-4',
    asOf: '2026-05',
    maxSingleClipSec: 10,
    minUsefulClipSec: 3,
    supportsStartEndFrame: true,
    supportsImageToVideo: true,
    supportsTextToVideo: false,
    recommendedConcurrency: 2,
    typicalJobLatencySec: 55,
    notes:
      'text-to-video 已废弃，必须 image-to-video；supports start+end frame (Motion Brush).',
  },
}

/**
 * 默认模型 —— 没配置时回退。
 * 当前项目默认 Seedance 2.0（settingsStore 默认模型 doubao-seedance-2-0-260128，
 * 即梦 Seedance 2.0），能力回退也对齐 2.0（单段 15s、1080p、return_last_frame）。
 */
export const DEFAULT_MODEL: VideoModelId = 'seedance-2-0'

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers · 可单测
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 安全取 capability —— 未知 id → 回退 DEFAULT_MODEL。
 * 绝不抛异常，让调用方可以 always 用到一份能力位。
 */
export function getCapability(id?: VideoModelId | string): ModelCapability {
  if (id && id in MODEL_CAPABILITIES) {
    return MODEL_CAPABILITIES[id as VideoModelId]
  }
  return MODEL_CAPABILITIES[DEFAULT_MODEL]
}

/**
 * 这个 shot 的 durationSec 是否能"一次生成不拆段"？
 *
 * 规则：
 *   - durationSec ≤ 模型 max  → 一次生
 *   - durationSec >  模型 max  → 必须拆（videoSchedule 负责拆 DAG）
 *
 * **不做 minUseful 判断**——1 秒快切也 allowed，由 skill/Planner 自行
 * 把"1 秒结束动作"写进 prompt；本函数只判物理可生。
 */
export function fitsInSingleClip(
  durationSec: number,
  cap: ModelCapability,
): boolean {
  return durationSec > 0 && durationSec <= cap.maxSingleClipSec
}

/**
 * 把超长 durationSec 拆成"最多 N 段、每段 ≤ maxSingleClipSec"的秒数数组。
 *
 * 分配策略：**均匀就近**——
 *   30s / 10s 上限 → [10, 10, 10]
 *   25s / 10s 上限 → [9, 8, 8]（不留 "1s 尾巴"）
 *   12s / 10s 上限 → [6, 6]
 *
 * 每段至少 `cap.minUsefulClipSec`，否则并入下一段。
 *
 * 返回 [] 表示输入非法（<= 0）。
 */
export function splitDurationToSegments(
  totalSec: number,
  cap: ModelCapability,
): number[] {
  if (totalSec <= 0 || !Number.isFinite(totalSec)) return []
  const t = Math.round(totalSec)
  const max = cap.maxSingleClipSec
  const min = cap.minUsefulClipSec

  if (t <= max) return [t]

  // 最少需要几段
  const count = Math.ceil(t / max)
  const base = Math.floor(t / count)
  const remainder = t - base * count

  // 均匀分配，前 remainder 段各 +1
  const segs: number[] = []
  for (let i = 0; i < count; i++) {
    segs.push(base + (i < remainder ? 1 : 0))
  }

  // 合并任何 < min 的末段进前一段（防出现 "1s 尾巴"）
  while (segs.length > 1) {
    const last = segs[segs.length - 1]!
    if (last < min) {
      segs[segs.length - 2]! += last
      segs.pop()
    } else {
      break
    }
  }

  // 如果合并后单段又超了 max（极端：min 很大、count 刚好），重新夹回
  return segs.map((s) => Math.min(s, max))
}

/**
 * 列出所有已登记的模型（UI 下拉用）。
 * 顺序稳定：先默认模型，再按 displayName 字典序。
 */
export function listCapabilities(): ModelCapability[] {
  const all = Object.values(MODEL_CAPABILITIES)
  const def = MODEL_CAPABILITIES[DEFAULT_MODEL]
  const rest = all
    .filter((c) => c.id !== DEFAULT_MODEL)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh'))
  return [def, ...rest]
}
