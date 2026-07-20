/**
 * 通用 prompt 清洗器：把 Gemini/nanobanana-pro 的 booru/LoRA 风格 prompt
 * 转换成 gpt-image-2 友好的自然语言风格。
 *
 * ## 为什么需要这个
 *
 * pixel-char 和 vehicle-design 的 prompt-engine 各自有 4-7 个硬编码模板，
 * 每个模板都嵌入了大量 `(masterpiece:1.4)` 类的权重语法——这是 booru/LoRA
 * 生态的做法，Gemini（训练数据里有大量这类标注）能识别并强化该 tag，但
 * gpt-image-2 一是忽略、二是可能把括号当成 ASCII 艺术或文字提示，导致画质
 * 下降。
 *
 * 全部重写成自然语言工程量巨大；做一个"清洗器"把 Gemini 版本转 gpt-image-2
 * 版本，能用一半的代码覆盖 90% 的场景。剩余 10%（比如 NPC 背景指令差异）
 * 交给每个调用点自行判断。
 *
 * ## 契约
 *
 * - `model === 'gemini'`     → 原样返回
 * - `model === 'gpt-image-2'` → 去权重 + 压缩连续逗号 + 修空白
 */

import type { ImageModel } from './ImageModel'

/**
 * 去掉 `(xxx:1.4)` / `(foo:2)` 这类 booru 权重语法，保留 xxx。
 *
 * 只识别**闭合括号前刚好接 `:数字`** 的模式，普通英文括号里的冒号（例如
 * `"(colon: like this)"` 人类注释）不会被误伤。
 */
export function stripWeightSyntax(input: string): string {
  // 匹配：`( 内容 : 数字(.数字)? )`，数字可以是整数或小数，内容不含 `(`
  return input.replace(/\(([^()]*?):(\d+(?:\.\d+)?)\)/g, (_, inner) => inner.trim())
}

export function adaptPromptForImageModel(prompt: string, model: ImageModel): string {
  if (model === 'gemini') return prompt
  let out = stripWeightSyntax(prompt)
  // 合并连续逗号：",,, " / ",   ,," → ", "
  out = out.replace(/,(\s*,)+/g, ',')
  // 清理逗号前多余空白、句子末尾多余空白
  out = out.replace(/\s+,/g, ',')
  // 规范化多重空白（但保留换行，因为很多模板依赖段落结构）
  out = out.replace(/[ \t]{2,}/g, ' ')
  return out
}
