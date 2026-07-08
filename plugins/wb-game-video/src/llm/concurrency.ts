/**
 * Reel Studio 全局并发配置 —— 批量/流水线任务的默认 concurrency。
 *
 * 为什么统一集中：
 *   - 之前并发值散落在 8 个文件里（batchImageGen / forgeImagePipeline /
 *     batchVideoGen / BatchGenBar / IdeaForge / PromptTabs / forgePasses /
 *     videoPipelineRunner），调一次要改 7-8 处，很容易漏
 *   - 任何"API quota 调整"、"作者体验反馈并发太低/太高"的调整都是**同时影响所有批量路径**，
 *     强制集中在一个文件里强迫我们一致
 *
 * 值怎么定：
 *   - 图像 8：Azure gpt-image-2 的 rate-limit 实测 ~10 QPS/每 deployment；
 *     留 1-2 余量给 timeline 即时生图，作者实际场景下 8 条并发很顺畅
 *   - 视频 4：Seedance 单任务 60-120s，配额是"队列里并存任务数"而非 QPS；
 *     4 条并发下用户能看到"接连开工"的流动感，又不打爆配额
 *
 * 覆盖方式：
 *   调用方仍可以显式传 `{ concurrency: N }` 覆盖；常量只是 default。
 *
 * 后续可能的演进：
 *   - 从 settingsStore 读用户自定义并发（让 Power User 自己调）
 *   - 按 provider 能力表（modelCapabilities）动态取 recommendedConcurrency
 *   现在先做集中常量，下一步再抽。
 */

import { getGenConcurrency } from '../scenario/settingsStore'

/**
 * 图像批量生成（Forge 参考图 / 关键帧 / 分镜）默认并发。
 *
 * 历史：
 *   - v3.7 默认 4（纯文生图 /images/generations）
 *   - v3.8 提到 8（作者反馈"感觉太慢"）
 *   - v3.8 再降回 4（切换到 /images/edits 后发现 8 并发打爆 429；
 *     edits 端点的 rate limit 比 generations 紧，且每请求 payload 大一个量级）
 *   - v3.9 降到 3，并新增 `imageRateLimiter` 全局令牌桶 —— 多条批量路径
 *     （BatchGenBar / Timeline 即时生图 / Forge 参考图）共用同一个 Azure deployment，
 *     各自并发 4 时加起来能到 12+，会连续 429 打爆；现在全局硬限到 3，
 *     并用令牌桶控制 rps ≤ 1.5，外加 429 冷却。
 *
 * 如果未来 Azure 调整配额，或者退回 /images/generations 文生图路径，
 * 可以在这里单点调高；同时记得同步 imageRateLimiter 的默认值。
 */
export const IMAGE_BATCH_CONCURRENCY = 3

/** 视频批量生成（Seedance / Sora-like）默认并发 */
export const VIDEO_BATCH_CONCURRENCY = 4

/**
 * v6.13 · 从 settingsStore.genConcurrency 读取用户自定义并发，回落到上面的常量。
 *
 * 为什么是函数而非常量：队列/编排（generationQueueStore / orchestrateVideos）
 * 需要"运行时可调"——litellm 统一代理内置并发 100 后，瓶颈从单 deployment 限速
 * 转移到代理侧，作者可以把并发开大；旧的批量路径仍可继续用常量默认。
 *
 * 注意：图像仍受 imageRateLimiter 全局令牌桶约束（除非显式 relax，见 imageRateLimiter.ts）。
 * 直连 Azure 时把并发开到 8 也会被令牌桶压回 rps≤1.5；只有切到 litellm 才真正放开。
 */
export function getImageConcurrency(fallback = IMAGE_BATCH_CONCURRENCY): number {
  return readGenConc('image', fallback)
}

export function getVideoConcurrency(fallback = VIDEO_BATCH_CONCURRENCY): number {
  return readGenConc('video', fallback)
}

export function getAudioConcurrency(fallback = 4): number {
  return readGenConc('audio', fallback)
}

function readGenConc(key: 'image' | 'video' | 'audio', fallback: number): number {
  try {
    const v = getGenConcurrency()[key]
    return Number.isFinite(v) && v >= 1 ? v : fallback
  } catch {
    return fallback
  }
}

/**
 * LLM 文本批量调用（长文档分段、Act 合批）默认并发。
 *
 * 取 3 是经验值：
 *   - DeepSeek / Claude / Gemini 三家文本端点对单 deployment 的 rps 都能稳吃 3 条并发；
 *     再高（5+）容易撞 429 或服务端排队，反而拖慢首批；
 *   - 长文档分段抽 beats 时，3 条并发在 9-15 段量级下能让总耗时落在 30-60s，
 *     与"作者前 Act 内可预览"的目标一致。
 *
 * 调用方仍可显式覆盖。
 */
export const LLM_TEXT_BATCH_CONCURRENCY = 3
