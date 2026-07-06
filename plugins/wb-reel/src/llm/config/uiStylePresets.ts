/**
 * UI 风格预设 —— 「UI」模块的海报式预设卡选择器数据源。
 *
 * 作者在 UI 模块选一张海报式预设卡，写入 `scenario.uiStyle.prompt`，
 * 作为后续视频制作中按钮 / 字幕条 / HUD 等游戏化 UI 元素的视觉基准。
 *
 * 设计原则：
 *   1. **纯数据**：无依赖，易测试，可序列化
 *   2. `promptText` 为中文描述，落入 scenario，参与下游措辞
 *   3. `posterPrompt` 为英文海报样张提示词，横版 16:9、no text
 *   4. `swatch` 两个 hex，占位海报渐变兜底（生图前的缩略色块）
 */

export interface UIStylePreset {
  /** 唯一 id（kebab-case），写入 scenario / 选择器 key */
  id: string
  /** 选择器卡片标题（中文） */
  label: string
  /** 卡片副标题宣传语（中文） */
  tagline: string
  /** 选中后写入 scenario.uiStyle.prompt 的中文风格描述 */
  promptText: string
  /** 海报样张生成用英文提示词（横版 16:9、no text） */
  posterPrompt: string
  /** 占位海报渐变用的两个 hex 颜色 */
  swatch: [string, string]
}

export const UI_STYLE_PRESETS: UIStylePreset[] = [
  {
    id: 'obsidian-glass',
    label: '黑曜石玻璃',
    tagline: '深夜电影 · 琥珀金描边',
    promptText:
      '深夜电影质感的 UI —— 黑曜石玻璃面板 + 极薄琥珀金描边 + 衬线中文 + 微弱胶片噪点，按钮悬浮投影柔和',
    posterPrompt:
      'Game UI style sheet poster: obsidian frosted-glass panels, thin amber-gold strokes, serif typography, subtle film grain, dark cinematic mood board, horizontal 16:9 widescreen game UI screenshot, no text',
    swatch: ['#1b1b1f', '#d4a34a'],
  },
  {
    id: 'retro-pixel',
    label: '复古像素',
    tagline: '街机 HUD · 8-bit 描边',
    promptText:
      '复古像素游戏 UI —— 8-bit 描边按钮 + 点阵字体 + 高饱和原色 HUD + 硬阴影，街机风',
    posterPrompt:
      'Retro pixel game UI mockup poster: chunky 8-bit bordered buttons, bitmap font, saturated primary HUD, hard drop shadows, arcade vibe, horizontal 16:9 widescreen game UI screenshot, no text',
    swatch: ['#222034', '#7cd8ff'],
  },
  {
    id: 'shoujo-manga',
    label: '少女漫',
    tagline: '柔光泡泡 · 粉系花边',
    promptText:
      '少女漫 UI —— 柔光圆角面板 + 粉系花边 + 闪光星点 + 手写体中文，浪漫梦幻',
    posterPrompt:
      'Shoujo manga game UI mockup poster: soft rounded pastel panels, pink lace frames, sparkle stars, handwriting font, dreamy romantic, horizontal 16:9 widescreen game UI screenshot, no text',
    swatch: ['#ffd6e7', '#ff8fb1'],
  },
  {
    id: 'cyber-neon',
    label: '赛博霓虹',
    tagline: '故障辉光 · 霓虹边框',
    promptText:
      '赛博朋克 UI —— 霓虹青紫描边 + 故障辉光 + 等宽数字字体 + 半透明扫描线 HUD',
    posterPrompt:
      'Cyberpunk neon game UI mockup poster: cyan-magenta neon strokes, glitch glow, monospace digits, translucent scanline HUD, horizontal 16:9 widescreen game UI screenshot, no text',
    swatch: ['#0c0c1a', '#23e6e0'],
  },
  {
    id: 'minimal-theatrical',
    label: '极简院线',
    tagline: '留白克制 · 院线字幕',
    promptText:
      '极简院线 UI —— 大留白 + 细线分隔 + 克制中性灰 + 院线式底部字幕条，安静高级',
    posterPrompt:
      'Minimal theatrical game UI mockup poster: generous whitespace, hairline dividers, neutral grays, cinema-style bottom subtitle bar, calm premium, horizontal 16:9 widescreen game UI screenshot, no text',
    swatch: ['#101012', '#e8e8e8'],
  },
]

/** 按 id 取预设，找不到返回 null */
export function getUIStylePreset(id: string): UIStylePreset | null {
  return UI_STYLE_PRESETS.find((p) => p.id === id) ?? null
}
