/**
 * "角色完整设定图 (character reference sheet)" 的版式模板纯函数。
 *
 * 由 Claude 组织后输出给图像模型；因此我们必须按目标图像模型的语言偏好写两套：
 *
 * - **Gemini 分支**：booru/LoRA 权重语法 + 位置 tag + 逗号分隔堆。保留原有
 *   `CharacterDesign.buildSystemPrompt()` 内联模板作为基线（已上线过，稳定）。
 *
 * - **gpt-image-2 分支**：自然语言段落式描述，按区域分句子。禁止权重语法
 *   `(xxx:1.4)`——gpt-image-2 会把它当字面文本或直接忽略，导致图像质量劣化。
 *   仍要严格锁定 9 大版式元素（名字美宣/主体居中/装备拆解/配色条/技能演出/
 *   物品栏/侧背视图/标签说明），否则 Claude 自由发挥会打乱版式。
 *
 * 两套模板都以最终字符串形式返回，直接嵌入 Claude 的 system prompt 里；
 * Claude 被要求照抄到最终图像 prompt 中。
 */

import type { ImageModel } from './ImageModel'

/**
 * 最终设定图版式模板的上下文。从 `buildSystemPrompt()` 内部局部变量抽出来——
 * 只保留会影响版式的字段，角色信息主干仍在上方的"角色核心信息"中文块里。
 */
export interface FinalSheetTemplateCtx {
  charName: string
  classZh: string
  classEn: string
  combatEn: string // 'melee' | 'ranged'
  worldZh: string
  worldEn: string
  /** "human swordsman" / "insect-like knight" 等按形态 + 职业的英文描述。 */
  speciesProfessionEn: string
  /** 主体区的英文描述块（由 buildSystemPrompt 组装好的 centerSubject）。 */
  centerSubject: string
  /** "装备材质"块，通常是 'highly detailed outfit with material textures (…)' 或 bodyType.silhouetteEn。 */
  equipNoteEn: string
  /** 画风英文短标签，来自 getArtStyleInfo 或 `indie game splash art / 2D Korean action game art`。 */
  styleDescEn: string
  /** 拖在最后的 `\n\nNegative prompt: …`，无 negative 时为空串。 */
  negativePromptLineEn: string
}

export function buildFinalSheetLayoutTemplate(
  ctx: FinalSheetTemplateCtx,
  model: ImageModel,
): string {
  return model === 'gpt-image-2' ? gptLayout(ctx) : geminiLayout(ctx)
}

function geminiLayout(ctx: FinalSheetTemplateCtx): string {
  const {
    charName, classEn, classZh, combatEn, worldEn, speciesProfessionEn,
    centerSubject, equipNoteEn, styleDescEn, negativePromptLineEn,
  } = ctx

  // 保留与历史基线完全一致的模板（见 CharacterDesign.buildSystemPrompt
  // 原始版本行 2122-2138）。只改的是"从 inline 改成纯函数"。
  return `英文提示词结构：
(masterpiece:1.4), (best quality), (character design sheet:1.5), ${styleDescEn}, (${worldEn} setting:1.3), ${worldEn}-themed equipment and clothing,

(Top-Left): Character name "${charName}" in stylish font, below the name the class title "${classEn}", accompanied by a (cool cinematic battle promotional art:1.5) showing the character as a ${speciesProfessionEn} in an epic ${combatEn} combat moment, ${worldEn} atmosphere, dramatic lighting, energy effects,

(Center Main): ${centerSubject}, ${equipNoteEn}, color palette following 631 ratio (60% dominant, 30% secondary, 10% accent), dramatic rim lighting and soft ambient occlusion,

(Bottom-Left): (Equipment exploded view:1.5), (Fully rendered colored objects:1.5), floating ${speciesProfessionEn} weapon parts and gear styled for ${worldEn}, (no sketch, no line art),

(Bottom-Left Edge): Horizontal color palette strip,

(Top-Right): Signature ${speciesProfessionEn} skill cinematic action, ${worldEn} energy effects,

(Mid-Right): (Inventory grid:1.3), ${speciesProfessionEn} key items and accessories,

(Bottom-Right): Side view and back view,

Light grey background #e6e6e6, frameless layout, (Black English labels with connecting lines:1.4)${negativePromptLineEn}

不要输出任何其他解释文字。`.replace(/\bclassZh\b/g, classZh) // classZh 内部已引用，这个 replace 是防呆兜底
}

function gptLayout(ctx: FinalSheetTemplateCtx): string {
  const {
    charName, classEn, classZh, combatEn, worldZh, worldEn, speciesProfessionEn,
    centerSubject, equipNoteEn, styleDescEn, negativePromptLineEn,
  } = ctx

  // 自然语言段落。每段对应一个版式分区，Claude 会原样贴到 image prompt。
  // gpt-image-2 对"按区域分块描述一张拼贴大图"响应很好。
  // 注意：把 centerSubject 里的权重语法在入口处去掉 —— 它原本写成
  // `(MANDATORY complete full body from head to feet:1.6), …`。
  const cleanCenter = centerSubject.replace(/\(([^()]*?):\d+(?:\.\d+)?\)/g, (_, inner) => inner)
  const cleanEquip = equipNoteEn.replace(/\(([^()]*?):\d+(?:\.\d+)?\)/g, (_, inner) => inner)
  const cleanStyle = styleDescEn.replace(/\(([^()]*?):\d+(?:\.\d+)?\)/g, (_, inner) => inner)
  const cleanNegative = negativePromptLineEn
    .replace(/\(([^()]*?):\d+(?:\.\d+)?\)/g, (_, inner) => inner)
    .trim()

  return `英文提示词结构（自然语言，一气呵成）：
A professional character reference sheet / design sheet layout on a solid light grey #e6e6e6 background, frameless clean layout, ${cleanStyle}, themed with ${worldEn} (${worldZh}) aesthetics in every piece of equipment and clothing.

Top-Left: the character's name "${charName}" written in a stylish game-title font, with the class title "${classEn}" directly below it. Next to the name, render a cool cinematic battle promotional illustration showing this character as a ${speciesProfessionEn} mid-action in an epic ${combatEn} combat moment, with ${worldEn} atmosphere, dramatic lighting, and energy effects.

Center Main: ${cleanCenter}, ${cleanEquip}. Apply a 631 color palette (60% dominant, 30% secondary, 10% accent). Use dramatic rim lighting and soft ambient occlusion to enhance form.

Bottom-Left: an equipment exploded view — fully rendered colored objects (no sketch, no line art), showing floating ${speciesProfessionEn} weapon parts and gear styled for the ${worldEn} world.

Along the bottom-left edge: a horizontal color palette strip that summarizes the three palette colors.

Top-Right: a signature ${speciesProfessionEn} skill cinematic in action, with ${worldEn} energy effects.

Middle-Right: an inventory grid displaying ${speciesProfessionEn} key items and accessories, arranged neatly.

Bottom-Right: side view and back view of the same character.

Use clean black English labels connected by thin lines to each subsection. No stray text, no watermark, no UI overlays, no logo.${cleanNegative ? ` Explicitly avoid: ${cleanNegative.replace(/^Negative prompt:\s*/i, '')}.` : ''}

Do not output any additional explanation.`
}
