/**
 * 通用「按全局生图模型偏好挑一套 prompt」的路由器。
 *
 * ## 为什么抽这个
 *
 * 整个 character-editor 有 19 处生图调用，如果不统一路由，每个调用点都要写一次
 * `if (model === 'gpt-image-2') {...} else {...}`，重复且容易漏掉一处导致
 * gpt-image-2 分支里串到 Gemini 的 booru 标签语法上（gpt-image-2 反而会被
 * 权重语法 `(xxx:1.4)` 干扰）。
 *
 * 两个纯函数：
 * - {@link pickPromptForImageModel}：从 `{ gemini, 'gpt-image-2' }` 的 bundle 里
 *   按当前模型挑一个值。Generic，可以容纳字符串 prompt、对象 payload、甚至函数。
 * - {@link apiModelIdForImageModel}：把语义模型（'gemini' / 'gpt-image-2'）转成
 *   **真实发给后端的 model 字符串**。这一步必须显式返回非空串，因为后端
 *   `/__ce-api__/generate-image` 的路由是「空 model → Azure 抢」，如果前端漏
 *   set model 字段，用户选的 Gemini 会静默变成 gpt-image-2（见 api-plugin.ts:2221）。
 */

import type { ImageModel } from './ImageModel'

export interface PromptBundle<T> {
  gemini: T
  'gpt-image-2': T
}

export function pickPromptForImageModel<T>(bundle: PromptBundle<T>, model: ImageModel): T {
  return bundle[model]
}

/**
 * 把全局语义模型转成真正发给后端的 model 字符串。
 *
 * 后端路由规则（见 api-plugin.ts 的 /__ce-api__/generate-image case）：
 * - `body.model.startsWith('gemini')` → 走 geminiGenerateImage
 * - 否则 → 走 Azure（azureImageGenerate / azureImageEdit），失败 fallback Gemini
 *
 * 所以：
 * - `'gemini'`     → `'gemini-3-pro-image-preview'`（唯一能真正路由到 Gemini 的前缀）
 * - `'gpt-image-2'` → `'gpt-image-2'`（不以 gemini 开头，走 Azure 分支）
 */
export function apiModelIdForImageModel(model: ImageModel): string {
  return model === 'gpt-image-2' ? 'gpt-image-2' : 'gemini-3-pro-image-preview'
}
