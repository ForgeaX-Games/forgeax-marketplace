import type { VisualStyle } from '../scenario/types'
export type { VisualStyle } from '../scenario/types'

/**
 * 全局视觉风格预设 —— 作者在 Forge Tab 选一次，影响**所有**素材生成。
 *
 * 影响对象：
 *   - 场景图（sceneImageCache.startGenerate）
 *   - 角色立绘（CharactersPanel）
 *   - 参考图流水线（ForgeWizard）
 *   - 批量生图（batchImageGen）
 *
 * 设计原则：
 *   1. **Prompt 前缀**：每个风格一段 2-4 行的英文风格引导，
 *      附加在 raw prompt 前面，让 GPT-Image-2 / Gemini / SDXL 系列都能理解
 *   2. **纯数据**：没有依赖，易测试，可序列化
 *   3. **不追溯**：作者改风格只影响"今后"生成的图，现有图不重绘
 *   4. **可选**：字段缺失时 composeVisualPrompt 原样返回，保证向后兼容
 */

export interface VisualStylePreset {
  id: VisualStyle
  label: string
  /** 一句话作者描述（UI 下拉里显示的副标题） */
  hint: string
  /** 迷你色盘（UI 段式选择器的色标） */
  swatch: [string, string]
  /**
   * 注入 prompt 的风格前缀 —— 会放在 raw prompt 之前，中间用 "—— " 分隔。
   * 刻意使用英文 + 画面关键词，命中大多数文生图模型的训练语料习惯。
   */
  promptPrefix: string
  /**
   * 用于 LLM 文生文（锻造场景描述 / 锻造提示词）的"风格指令"，
   * 中文化一句，放进 system prompt，让措辞本身就带风格色彩。
   */
  authoringHint: string
  /**
   * 电影海报专用英文提示词 —— 竖版 one-sheet，强调海报构图 / 标题留白 / 光影氛围。
   * 末尾统一带 "no text, vertical 2:3" 之类，避免海报里出现乱码文字。
   * 「风格」模块的电影海报式选择器用它生成各风格的海报缩略图。
   */
  posterPrompt: string
  /** 中文一句宣传语 —— 海报式选择器上展示的标语 */
  tagline: string
}

export const VISUAL_STYLE_PRESETS: Record<VisualStyle, VisualStylePreset> = {
  photoreal: {
    id: 'photoreal',
    label: '写实',
    hint: '电影级真实质感 · 自然光影',
    swatch: ['#d9c2a6', '#2b2a28'],
    // v7（2026-06）· 写实风格不再在提示词里画人脸马赛克 ——
    //   作者看到的是**干净的写实真人图**（截图样式：白底、自然光、清晰五官）。
    //   下游视频模型(Seedance)所需的人脸打码已迁移到「上传期」的 faceMaskTool，
    //   只有图片真正塞进 Seedance 请求时才走一遍打码工具，不污染展示稿。
    promptPrefix:
      'Cinematic photorealistic photograph, shallow depth of field, natural lighting, realistic skin and textures, 8K ultra-detailed.',
    authoringHint: '风格为电影级写实摄影，措辞重质感、光线、镜头语言。',
    posterPrompt:
      'Cinematic theatrical movie poster, photorealistic, dramatic key lighting, lone hero silhouette, deep shadows, 35mm film grain, anamorphic flare, title-safe negative space in the bottom third, no text, professional one-sheet composition, vertical 2:3',
    tagline: '电影级真实质感 · 光影叙事',
  },
  anime: {
    id: 'anime',
    label: '二次元',
    hint: '日系动画风 · 赛璐珞上色',
    swatch: ['#ffb6c8', '#5b8cff'],
    // v6.4 · 去掉 "Makoto Shinkai / Kyoto Animation inspired"
    //   知名商业 IP 名字会让 Azure safety filter 额外收紧（IP 侵权预防）。
    //   改成纯风格描述，保留审美意图，classifier 无干扰。
    promptPrefix:
      'Japanese cel-shaded animation art style, clean linework, vibrant colors, expressive character eyes, high-quality 2D illustration',
    authoringHint: '风格为日系二次元动画，措辞重情绪、色彩、视觉张力。',
    posterPrompt:
      'Anime theatrical key visual poster, Japanese cel-shaded, vibrant saturated sky, expressive hero pose, bloom and lens flare, dynamic composition, title-safe negative space at bottom, no text, vertical 2:3',
    tagline: '日系动画 · 热血与情绪',
  },
  cartoon: {
    id: 'cartoon',
    label: '卡通',
    hint: '西式卡通 · 粗描边平色',
    swatch: ['#ffd84a', '#ff6ba3'],
    // v6.4 · 去掉 "Pixar / Disney inspired"（知名商业 IP）
    promptPrefix:
      'Western cartoon illustration, bold black outlines, flat vivid colors, exaggerated expressions, family-friendly stylized character design',
    authoringHint: '风格为西式卡通，措辞轻松夸张，突出角色性格。',
    posterPrompt:
      'Western animated feature movie poster, bold outlines, flat vivid colors, playful exaggerated characters, sunny palette, title-safe space at bottom, no text, vertical 2:3 one-sheet',
    tagline: '西式卡通 · 合家欢冒险',
  },
  pixelart: {
    id: 'pixelart',
    label: '像素',
    hint: '复古像素 · 16-bit 色板',
    swatch: ['#7cd8ff', '#222034'],
    // v6.4 · 去掉 "SNES / Genesis era" 主机名（classifier 对商业实体敏感）
    promptPrefix:
      'Retro 16-bit pixel art, limited color palette, crisp pixel edges, dithered shading, classic console-era game aesthetic',
    authoringHint: '风格为复古像素游戏，措辞简练，突出轮廓和标志性元素。',
    posterPrompt:
      'Retro 16-bit pixel art game cover poster, limited palette, crisp dithered shading, heroic sprite hero, parallax background, title-safe space at bottom, no text, vertical 2:3',
    tagline: '复古像素 · 街机黄金时代',
  },
  watercolor: {
    id: 'watercolor',
    label: '水彩',
    hint: '水彩晕染 · 柔和笔触',
    swatch: ['#c3d9e8', '#ffc9a8'],
    promptPrefix:
      'Traditional watercolor painting, soft wet-on-wet washes, visible paper texture, gentle pastel palette, loose brushwork',
    authoringHint: '风格为水彩画，措辞柔和抒情，突出色晕与留白。',
    posterPrompt:
      'Watercolor illustrated movie poster, soft wet-on-wet washes, paper texture, gentle pastel palette, lyrical mood, title-safe negative space at bottom, no text, vertical 2:3',
    tagline: '水彩晕染 · 治愈抒情',
  },
  ink: {
    id: 'ink',
    label: '水墨',
    hint: '东方水墨 · 留白写意',
    swatch: ['#e8e2d4', '#1a1a1a'],
    promptPrefix:
      'Traditional Chinese ink painting (shuǐ-mò), sumi-e brushstrokes, high contrast black ink on rice paper, abundant negative space, wabi-sabi atmosphere',
    authoringHint: '风格为东方水墨画，措辞凝练含蓄，突出意境与留白。',
    posterPrompt:
      'Chinese ink-wash (shuǐ-mò) movie poster, sumi-e brushstrokes, high contrast black ink on rice paper, abundant negative space, misty mountains, title-safe space at bottom, no text, vertical 2:3',
    tagline: '东方水墨 · 写意留白',
  },
}

export const VISUAL_STYLE_LIST: VisualStylePreset[] =
  Object.values(VISUAL_STYLE_PRESETS)

/** 默认视觉风格 —— 没选过时用 photoreal，向后兼容 */
export const DEFAULT_VISUAL_STYLE: VisualStyle = 'photoreal'

/**
 * 把视觉风格前缀注入到 raw prompt 前面。
 *
 * 契约：
 *   - style 为 undefined / null / 未知值 → 原样返回 rawPrompt（向后兼容）
 *   - rawPrompt 为空串 → 直接返回前缀，避免尾巴
 *   - 前缀与原文之间用 "\n\n" 双换行连接（v6.4 前是 "—— "）
 *     · 让模型自然把两段识别为"风格引导 + 具体画面"，而不是强行拼接
 *     · Azure safety classifier 对连续破折号 "—— " 后接大段文本有额外警惕
 *       （属于 prompt-injection 常见写法），改成段落分隔降低误判概率
 *   - 幂等：**注意**本函数不是幂等的 —— 调用方保证只在最终写 ImageRequest.prompt
 *     时调用一次，不要在已经有前缀的 prompt 上再套一次
 */
export function composeVisualPrompt(
  rawPrompt: string,
  style?: VisualStyle | null,
): string {
  if (!style) return rawPrompt
  const preset = VISUAL_STYLE_PRESETS[style]
  if (!preset) return rawPrompt
  if (!rawPrompt) return preset.promptPrefix
  return `${preset.promptPrefix}\n\n${rawPrompt}`
}

/**
 * 取出风格对应的"作者 LLM 指令"片段。
 *
 * 用于锻造场景描述 / 剧本 / 提示词等文生文任务：
 * 把这句话塞进 system prompt，让 LLM 输出的措辞天然带着风格色彩。
 * 不存在 / 未知 → 返回空串，由调用方决定是否回退到默认值。
 */
export function getAuthoringHint(style?: VisualStyle | null): string {
  if (!style) return ''
  return VISUAL_STYLE_PRESETS[style]?.authoringHint ?? ''
}
