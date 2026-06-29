/**
 * 全局生图模型偏好。
 *
 * 角色编辑器原本所有生图调用都硬编码到 `gemini-3-pro-image-preview`
 * （= nanobanana-pro），只有 pixel-char 的四方向 turnaround 那一步能在 UI 上
 * 切换到 `gpt-image-2`。现在把「全链路生图用哪个模型」抽成一个全局偏好，
 * 让概设 / 完整设定 / 视角 / 动作 sheet / 载具 全部跟随同一个选择，
 * 每个阶段为 gpt-image-2 额外维护一套更贴 GPT 自然语言风格的提示词。
 *
 * ## 存储
 *
 * 用**独立** localStorage key（`character-editor:image-model`），不塞进
 * `character-editor:global-design`——因为角色资料（profile + image）和用户
 * 偏好是两种生命周期：换角色不该换模型偏好，换模型偏好也不该触发角色重渲。
 *
 * ## 值域
 *
 * 只有两个合法值：
 * - `'gemini'`     → 后端路由到 Gemini 3 Pro Image（nanobanana-pro）
 * - `'gpt-image-2'` → 后端路由到 Azure OpenAI gpt-image-2 deployment
 *
 * 历史存档里的旧值（例如 `'nanobanana-pro'`、`'gpt-4o'`、空串）都回落
 * 到默认 `'gemini'`，避免把非法值送进 prompt 选择器。
 */

export type ImageModel = 'gemini' | 'gpt-image-2'

export const IMAGE_MODEL_STORAGE_KEY = 'character-editor:image-model'

export const DEFAULT_IMAGE_MODEL: ImageModel = 'gemini'

/**
 * 把 localStorage 里读出来的字符串（可能是 null / 空 / 非法值）解析为
 * 合法的 ImageModel。遇到不认识的值一律返回默认值，避免污染后续流程。
 *
 * 单独抽成纯函数的原因：单测不用 mock localStorage。
 */
export function parseImageModelFromStorage(raw: string | null | undefined): ImageModel {
  if (raw === 'gemini' || raw === 'gpt-image-2') return raw
  return DEFAULT_IMAGE_MODEL
}
