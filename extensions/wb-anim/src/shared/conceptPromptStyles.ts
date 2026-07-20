/**
 * 概设 / 完整设定图 的「风格指令」模块。
 *
 * 为什么抽成独立模块？
 * ---------------------
 * `CharacterDesign.buildConceptSystemPrompt()` 里混杂了 3 件事：
 *   1. 角色信息表（中文给 Claude 看）
 *   2. "画面质量与风格" 的直接指令（英文让 Claude 照抄塞进图像 prompt）
 *   3. 4 个变体的场景 brief
 *
 * 第 2 件事在 Gemini 和 gpt-image-2 之间**必须完全不同**：
 * - Gemini（= nanobanana-pro）是 booru/LoRA 训练来的，吃 `(masterpiece:1.4)`
 *   权重语法 + 逗号分隔 tag 堆 + `1girl` 这类 count tag。
 * - gpt-image-2 用 OpenAI DALL·E 路线训练，权重语法直接被忽略甚至干扰，
 *   吃**自然语言完整句子** + 结构化描述（"one character, front view, …"）。
 *
 * 如果用同一套指令喂两个模型，gpt-image-2 那条路永远在劣化。所以抽成纯函数
 * + TDD 保证两套风格分支互不污染。
 */

import type { ImageModel } from './ImageModel'

// ── 上下文 ─────────────────────────────────────────────────────────

/**
 * 概设风格指令需要的上下文——从 `CharacterDesign.buildConceptSystemPrompt`
 * 的局部变量里抽出来的最小子集。只保留"会影响风格前/后缀"的字段，其它
 * （角色名 / 职业 / 世界观文本等）留在 system prompt 主体里组装。
 */
export interface ConceptStyleCtx {
  isNonHumanoid: boolean
  isDefault: boolean
  /** 世界观英文短标签，如 `fantasy medieval` / `cyberpunk`。 */
  worldEn: string
  bodyTypeSilhouetteEn: string
  bodyTypeReferences: string
  bodyTypeNegativeEn: string
  artStyleZh: string
  artStyleEn: string
  artStyleKeywords: string
}

export interface ConceptStyleDirectives {
  /** Claude 必须照抄到每段图像 prompt 开头的"质量前缀"。 */
  stylePrefix: string
  /** Claude 必须照抄到每段图像 prompt 结尾的"渲染/约束后缀"。 */
  styleSuffix: string
}

// ── 概设 4 变体 风格指令 ───────────────────────────────────────────

export function buildConceptStyleDirectives(
  ctx: ConceptStyleCtx,
  model: ImageModel,
): ConceptStyleDirectives {
  return model === 'gpt-image-2' ? gptConceptStyle(ctx) : geminiConceptStyle(ctx)
}

function geminiConceptStyle(ctx: ConceptStyleCtx): ConceptStyleDirectives {
  const {
    isNonHumanoid, isDefault, worldEn, bodyTypeSilhouetteEn, bodyTypeNegativeEn,
    artStyleZh, artStyleEn, artStyleKeywords,
  } = ctx

  const stylePrefix = isDefault
    ? (isNonHumanoid
      ? `(masterpiece:1.4), (best quality:1.4), (ultra detailed:1.3), indie game splash art, hand-painted 2D, ${bodyTypeSilhouetteEn}, (highres), sharp focus, professional illustration, cinematic composition,`
      : 'LOL style, game cg, (masterpiece:1.4), (best quality:1.4), (ultra detailed:1.3), (highres), 8k uhd, sharp focus, professional illustration, cinematic composition,')
    : `(masterpiece:1.4), (best quality:1.4), (ultra detailed:1.3), ${artStyleKeywords} (highres), sharp focus, professional illustration, cinematic composition,`

  const negativeTail = isNonHumanoid && bodyTypeNegativeEn
    ? `, NEGATIVE: ${bodyTypeNegativeEn}`
    : ''
  const styleSuffix = isDefault
    ? `dramatic cinematic lighting, volumetric light, rim lighting, depth of field, lens flare, particle effects, ${worldEn} atmosphere, epic composition, (only one creature:1.5), no text, no watermark, no UI${negativeTail}`
    : `${artStyleEn} rendering, dramatic lighting, ${worldEn} atmosphere, epic composition, (only one creature:1.5), no text, no watermark, no UI${negativeTail}`

  // artStyleZh 字段保留——当前 Gemini 分支不直接消费，避免 tsc 警告
  void artStyleZh

  return { stylePrefix, styleSuffix }
}

function gptConceptStyle(ctx: ConceptStyleCtx): ConceptStyleDirectives {
  const {
    isNonHumanoid, isDefault, worldEn, bodyTypeSilhouetteEn, bodyTypeReferences,
    bodyTypeNegativeEn, artStyleEn,
  } = ctx

  // gpt-image-2 吃自然语言——句子式、短句叠加。不用括号权重。不用 booru count tag。
  const quality = isDefault
    ? (isNonHumanoid
      ? `Professional indie game splash art, masterpiece quality, ultra-detailed hand-painted 2D illustration with ${bodyTypeSilhouetteEn}${bodyTypeReferences ? ` reminiscent of ${bodyTypeReferences}` : ''}, sharp focus, cinematic composition.`
      : `Professional AAA-quality game splash art in LOL / game CG style, masterpiece-level illustration, 8K ultra-detailed, sharp focus, cinematic composition with dramatic framing.`)
    : `Professional high-quality illustration, masterpiece ${artStyleEn} rendering, ultra-detailed, sharp focus, cinematic composition.`

  const suffixBase = isDefault
    ? `Dramatic cinematic lighting, volumetric light, rim light, depth of field, subtle lens flare, particle effects evoking ${worldEn} atmosphere, epic composition. `
    : `${artStyleEn} rendering with dramatic lighting, evoking ${worldEn} atmosphere, epic composition. `

  const soloClause = 'Strictly only one character in the frame — no duplicates, no companions, no crowd. '
  const noText = 'No text, no watermark, no UI overlay, no logo.'
  const nonHumanoidClause = isNonHumanoid
    ? ` The subject is explicitly not human and must not exhibit humanoid features${bodyTypeNegativeEn ? `; avoid: ${bodyTypeNegativeEn}` : ''}.`
    : ''

  return {
    stylePrefix: quality,
    styleSuffix: `${suffixBase}${soloClause}${noText}${nonHumanoidClause}`,
  }
}

// ── 完整设定图（final sheet / character reference sheet）───────────

export interface FinalSheetStyleCtx {
  isNonHumanoid: boolean
  /** 纯色背景色，`#RRGGBB`。默认白或浅灰。 */
  backgroundColor: string
  bodyTypeSilhouetteEn: string
  bodyTypeNegativeEn: string
}

/**
 * 生成"角色完整设定图"的风格+格式指令字符串。
 *
 * 用法：调用方把 {角色信息文本 + 这个字符串} 一起塞给图像模型。
 * 字符串本身不包含角色信息，只负责"画成 sheet 的格式 + 模型期望的语言风格"。
 */
export function buildFinalSheetStyleDirectives(
  ctx: FinalSheetStyleCtx,
  model: ImageModel,
): string {
  return model === 'gpt-image-2' ? gptFinalSheetStyle(ctx) : geminiFinalSheetStyle(ctx)
}

function geminiFinalSheetStyle(ctx: FinalSheetStyleCtx): string {
  const { isNonHumanoid, backgroundColor, bodyTypeSilhouetteEn, bodyTypeNegativeEn } = ctx
  const neg = isNonHumanoid && bodyTypeNegativeEn ? `, NEGATIVE: ${bodyTypeNegativeEn}` : ''
  const silhouette = isNonHumanoid ? `, ${bodyTypeSilhouetteEn}` : ''
  return `(character sheet:1.5), (T-pose:1.3), (full body:1.5), ${isNonHumanoid ? 'single creature' : 'solo, 1 character'}${silhouette}, centered, symmetric pose, neutral expression, clean solid ${backgroundColor} background, flat studio lighting, no shadows on background, sharp focus, game asset, no text, no watermark, no UI${neg}`
}

function gptFinalSheetStyle(ctx: FinalSheetStyleCtx): string {
  const { isNonHumanoid, backgroundColor, bodyTypeSilhouetteEn, bodyTypeNegativeEn } = ctx
  const silhouette = isNonHumanoid ? ` (${bodyTypeSilhouetteEn})` : ''
  const neg = isNonHumanoid && bodyTypeNegativeEn ? ` Explicitly avoid: ${bodyTypeNegativeEn}.` : ''
  return [
    `A professional character reference sheet, character design sheet style.`,
    `Show exactly one ${isNonHumanoid ? 'creature' : 'character'}${silhouette} standing upright in a neutral T-pose, facing the camera, full body fully visible from head to toe, centered in the frame with comfortable margin on all sides.`,
    `Solid ${backgroundColor} background, flat even studio lighting, no cast shadows on the background, high sharpness.`,
    `No text, no watermark, no UI overlays, no logos.${neg}`,
  ].join(' ')
}
