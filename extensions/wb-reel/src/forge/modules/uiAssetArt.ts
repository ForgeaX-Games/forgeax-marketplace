import type { ImageClient, ImageReference, ImageRequest } from '../../llm/config/types'
import { supportsTransparentBackground } from '../../llm/providers/GptImageProvider'
import { useMediaStore } from '../../media/mediaStore'
import { cutoutToTransparent } from '../../media/cutoutToTransparent'
import type { UIAsset, UIAssetRole, UIBlendMode, UIMatte } from '../../scenario/types'
import type { GenRequestRef, GenRequestSnapshot } from '../generationQueueStore'

/**
 * UI 素材美术管线 —— UI 素材库(v9)。镜像 itemArt.ts,但去背策略不同。
 *
 * 影游 UI 覆盖层(好感度飘字 / 姓名条 / 血条 / 技能框……)几乎都带发光/粒子/半透明,
 * 无法硬抠图。实证(gpt-image-2 spike):模型**不支持原生透明底**,但能按需产出
 * **真·纯黑(#000)/近纯白(#fff)底**。因此去背用「图层混合模式」:
 *   - screen-black:纯黑底 + screen → 黑消失,辉光/金光/粒子加光叠加(发光类首选)。
 *   - multiply-white:纯白底 + multiply → 白消失,暗色线稿/描边保留(水墨边框类)。
 *   - chroma:洋红底 + cutoutToTransparent 手动抠图(硬边纯色主体)。
 *   - alpha:原生透明(能力探测通过才发;gpt-image-2 回落到 screen-black)。
 *   - opaque:不去背(整图,如结局卡)。
 *
 * 版权安全:prompt 全用原创描述,禁真实品牌/知名 IP。
 */

/** 每个 UI 角色的默认配方 —— 驱动模板生成 + 库 UI 的「新建」默认值 + curator 建议。 */
export interface UIRolePreset {
  /** 中文显示名。 */
  label: string
  /** 默认去背方式。 */
  matte: UIMatte
  /** 生成图尺寸。 */
  size: NonNullable<ImageRequest['size']>
  /** 默认锚点(归一化 0~1)。 */
  anchor: { x: number; y: number; scale?: number }
  /** 默认生命周期意图。 */
  lifecycle: UIAsset['lifecycle']
  /** 瞬时类默认时长(ms);hud/scene 类可为 undefined。 */
  durationMs?: number
  /** 是否典型绑数值(血条/数字);库 UI 据此默认展开 valueBind 表单。 */
  valueBound?: boolean
  /** 英文提示词核心(描述这类 UI 元素的外观),不含底色约束。 */
  promptCore: string
}

/**
 * 高频影游 UI 角色预设表。锚点约定:x/y 为归一化中心点,y 越大越靠下。
 * promptCore 刻意用英文 + 通用描述,兼容 gpt-image-2,版权安全。
 */
export const UI_ROLE_PRESETS: Record<UIAssetRole, UIRolePreset> = {
  affinity: {
    label: '好感度增减',
    matte: 'screen-black',
    size: '1536x1024',
    anchor: { x: 0.5, y: 0.4, scale: 22 },
    lifecycle: 'transient',
    durationMs: 2500,
    promptCore:
      'a floating game affinity/relationship notification badge: a glowing stylized heart symbol with a plus or minus sign, radiant warm gold light, sparkling particles and light streaks, elegant short caption text, award-popup style',
  },
  nameplate: {
    label: '人员出场姓名条',
    matte: 'screen-black',
    size: '1536x1024',
    anchor: { x: 0.5, y: 0.82, scale: 16 },
    lifecycle: 'transient',
    durationMs: 3200,
    promptCore:
      'a character introduction lower-third nameplate bar: a sleek glowing horizontal ribbon with an elegant name label area and a thin decorative underline, cinematic character-entrance UI',
  },
  'location-title': {
    label: '地域名称标题卡',
    matte: 'screen-black',
    size: '1536x1024',
    anchor: { x: 0.5, y: 0.5, scale: 20 },
    lifecycle: 'transient',
    durationMs: 3000,
    promptCore:
      'a location title card: large elegant place-name typography with a thin decorative rule and subtle ornamental flourishes, establishing-shot location label overlay',
  },
  'act-transition': {
    label: '幕次/时间流逝',
    matte: 'screen-black',
    size: '1536x1024',
    anchor: { x: 0.5, y: 0.5, scale: 24 },
    lifecycle: 'transient',
    durationMs: 3000,
    promptCore:
      'an act/chapter transition title: minimalist elegant caption such as a chapter number or a time-lapse label, refined serif typography with a thin divider line, cinematic interstitial card',
  },
  exposition: {
    label: '背景交代艺术字',
    matte: 'screen-black',
    size: '1536x1024',
    anchor: { x: 0.5, y: 0.5, scale: 26 },
    lifecycle: 'transient',
    durationMs: 4500,
    promptCore:
      'artistic expository narration text block: stylized cinematic backstory typography, elegant layout with subtle decorative accents, opening-crawl style exposition overlay',
  },
  'interaction-hint': {
    label: '交互点/QTE提示',
    matte: 'screen-black',
    size: '1024x1024',
    anchor: { x: 0.5, y: 0.5, scale: 14 },
    lifecycle: 'transient',
    durationMs: 2000,
    promptCore:
      'an interactive hotspot prompt indicator: a glowing pulsing ring or hand/tap icon with radiating highlight, quick-time-event interaction cue, clean luminous game UI marker',
  },
  'pip-silhouette': {
    label: '画中画卡通剪影',
    matte: 'screen-black',
    size: '1024x1024',
    anchor: { x: 0.82, y: 0.72, scale: 26 },
    lifecycle: 'scene',
    promptCore:
      'a picture-in-picture cartoon silhouette bust: a stylized bright character silhouette inside a small glowing rounded frame, corner commentary avatar, luminous outline on dark',
  },
  'hp-bar': {
    label: '角色/Boss血条',
    matte: 'screen-black',
    size: '1536x1024',
    anchor: { x: 0.24, y: 0.1, scale: 10 },
    lifecycle: 'hud',
    valueBound: true,
    promptCore:
      'a game health bar UI: a horizontal segmented HP gauge with a glowing energy fill and an ornate end-cap bracket, empty fillable track, no numbers, boss/character health bar',
  },
  'avatar-frame': {
    label: '角色/Boss头像框',
    matte: 'screen-black',
    size: '1024x1024',
    anchor: { x: 0.12, y: 0.12, scale: 16 },
    lifecycle: 'hud',
    promptCore:
      'a game portrait avatar frame: an empty ornate circular or hexagonal glowing bezel with decorative corner accents, hollow center for a face, HUD character avatar ring',
  },
  'skill-box': {
    label: '技能框',
    matte: 'screen-black',
    size: '1536x1024',
    anchor: { x: 0.82, y: 0.86, scale: 14 },
    lifecycle: 'scene',
    promptCore:
      'a game skill/ability bar: a row of glowing hexagonal or rounded skill slot frames with cooldown ring edges, empty ability icons, luminous HUD skill tray',
  },
  'attack-box': {
    label: '攻击框',
    matte: 'screen-black',
    size: '1536x1024',
    anchor: { x: 0.5, y: 0.86, scale: 14 },
    lifecycle: 'scene',
    promptCore:
      'a combat action prompt box: a glowing framed button cluster with directional attack cues and impact spark accents, action-command HUD panel',
  },
  'ending-card': {
    label: '结局卡',
    matte: 'opaque',
    size: '1536x1024',
    anchor: { x: 0.5, y: 0.5, scale: 100 },
    lifecycle: 'transient',
    durationMs: 5000,
    promptCore:
      'a full-screen ending title card: dramatic cinematic end-card composition with elegant large title typography and atmospheric backdrop, movie ending screen',
  },
  'tree-background': {
    label: '剧情树背景',
    matte: 'opaque',
    size: '1536x1024',
    anchor: { x: 0.5, y: 0.5, scale: 100 },
    lifecycle: 'scene',
    promptCore:
      'a full-screen chapter-select / story-map background: an atmospheric decorative empty backdrop with soft depth and gentle vignette, no characters, no text, ample negative space for overlaid node cards, game level-select screen background',
  },
  'tree-node-frame': {
    label: '剧情树节点框',
    matte: 'multiply-white',
    size: '1024x1024',
    anchor: { x: 0.5, y: 0.5, scale: 20 },
    lifecycle: 'scene',
    promptCore:
      'an empty decorative rectangular node frame / border for a story-map card: an ornate hollow bezel with corner flourishes and a clear empty center window (to overlay a scene thumbnail), symmetric UI card frame, nothing in the middle',
  },
  'screen-background': {
    label: '全屏页面背景',
    matte: 'opaque',
    size: '1536x1024',
    anchor: { x: 0.5, y: 0.5, scale: 100 },
    lifecycle: 'scene',
    promptCore:
      'a full-screen game menu / inventory / interface screen background: an atmospheric decorative empty backdrop with soft depth and gentle vignette, no characters, no readable text, generous empty space for overlaid panels and item grids, deep-game UI screen background',
  },
  'screen-frame': {
    label: '全屏页面外框',
    matte: 'multiply-white',
    size: '1536x1024',
    anchor: { x: 0.5, y: 0.5, scale: 100 },
    lifecycle: 'scene',
    promptCore:
      'an empty decorative full-screen UI border / frame overlay: ornate edge trim and corner flourishes around a large clear empty center, HUD screen bezel, nothing in the middle',
  },
  custom: {
    label: '自定义',
    matte: 'screen-black',
    size: '1024x1024',
    anchor: { x: 0.5, y: 0.5, scale: 20 },
    lifecycle: 'transient',
    durationMs: 3000,
    promptCore: 'a custom game UI overlay element, clean luminous interface graphic',
  },
}

/**
 * UIBlendMode → CSS mix-blend-mode 值。
 * 'add' 无同名 CSS 值,映射到 'plus-lighter'(现代浏览器支持,效果=加光)。
 */
export function uiBlendModeToCss(mode: UIBlendMode | undefined): string {
  switch (mode) {
    case 'screen':
      return 'screen'
    case 'multiply':
      return 'multiply'
    case 'overlay':
      return 'overlay'
    case 'hard-light':
      return 'hard-light'
    case 'lighten':
      return 'lighten'
    case 'add':
      return 'plus-lighter'
    case 'normal':
    default:
      return 'normal'
  }
}

/** matte → 默认叠加混合模式(去背核心)。 */
export function matteToBlendMode(matte: UIMatte): UIBlendMode {
  switch (matte) {
    case 'screen-black':
      return 'screen'
    case 'multiply-white':
      return 'multiply'
    case 'alpha':
    case 'chroma':
    case 'opaque':
    default:
      return 'normal'
  }
}

/** matte → 生成时强制的单色底提示词(空串 = 不约束底,opaque 用)。 */
export function matteBackgroundPrompt(matte: UIMatte): string {
  switch (matte) {
    case 'screen-black':
      return 'on a SOLID PURE BLACK (#000000) background, pure black backdrop, no scenery, no floor, nothing else, isolated element centered'
    case 'multiply-white':
      return 'dark ink linework on a SOLID PURE WHITE (#ffffff) background, pure white backdrop, no scenery, nothing else, isolated element centered'
    case 'chroma':
      return 'on a solid flat pure magenta (#ff00ff) chroma-key background, uniform magenta backdrop, no gradient, no scenery, no shadow on the backdrop'
    case 'alpha':
      return 'on a fully transparent background, no backdrop, isolated element centered'
    case 'opaque':
    default:
      return ''
  }
}

/** 全局风格上下文 —— 让 UI 素材契合当前剧本的美术/UI 基调。 */
export interface UIStyleContext {
  /** 剧情梗概 / 世界观(取前若干字做基调)。 */
  worldSynopsis?: string
  /** 全局美术风格提示(visualStyle authoringHint)。 */
  styleHint?: string
  /** 电影美学提示(filmLook)。 */
  filmLookHint?: string
  /** 全局 UI 风格描述(scenario.uiStyle.prompt)。 */
  uiStylePrompt?: string
}

function trimWorld(s: string | undefined, max = 160): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 通用负面约束 —— 版权安全 + 干净覆盖层。 */
const UI_NEGATIVES =
  'no real brand logos, no copyrighted characters, original design only, no watermark, ' +
  'clean crisp edges, high quality game UI overlay, HUD element, no photographic scene behind it'

/**
 * 组装某 UI 素材的生成提示词。
 *
 * 结构 = 角色核心外观 + 作者自定义 prompt/名称 + UI 风格 + 美术风格 + 世界观 +
 * 强制单色底(matte) + 通用负面/版权约束。
 */
export function buildUIAssetPrompt(asset: UIAsset, ctx?: UIStyleContext): string {
  const preset = UI_ROLE_PRESETS[asset.role] ?? UI_ROLE_PRESETS.custom
  const parts: string[] = [preset.promptCore]

  const custom = asset.prompt?.trim()
  if (custom) parts.push(`具体内容(detail): ${custom}`)
  else if (asset.name?.trim()) parts.push(`标签/主题(label): ${asset.name.trim()}`)

  if (ctx?.uiStylePrompt?.trim()) parts.push(`UI 风格(ui style): ${ctx.uiStylePrompt.trim()}`)
  if (ctx?.styleHint?.trim()) parts.push(`美术风格(art direction): ${ctx.styleHint.trim()}`)
  if (ctx?.filmLookHint?.trim()) parts.push(`色彩美学(color grade): ${ctx.filmLookHint.trim()}`)
  const world = trimWorld(ctx?.worldSynopsis)
  if (world) parts.push(`世界观基调(world tone): ${world}`)

  const bg = matteBackgroundPrompt(asset.matte)
  if (bg) parts.push(bg)
  parts.push(UI_NEGATIVES)
  return parts.join('. ') + '.'
}

/**
 * 按角色造一个带默认值的 UIAsset(库 UI「新建」/ curator 用)。
 * matte 默认取角色预设,blendMode 由 matte 推导。
 */
export function makeUIAsset(opts: {
  id: string
  role: UIAssetRole
  name?: string
  prompt?: string
  matte?: UIMatte
}): UIAsset {
  const preset = UI_ROLE_PRESETS[opts.role] ?? UI_ROLE_PRESETS.custom
  const matte = opts.matte ?? preset.matte
  return {
    id: opts.id,
    name: opts.name?.trim() || preset.label,
    role: opts.role,
    prompt: opts.prompt?.trim() || undefined,
    matte,
    blendMode: matteToBlendMode(matte),
    defaultAnchor: { ...preset.anchor },
    defaultDurationMs: preset.durationMs,
    lifecycle: preset.lifecycle,
    ...(preset.valueBound ? { valueBind: { varId: '', kind: 'fill' as const } } : {}),
  }
}

/**
 * 生成一个 UI 素材的图 —— 生图 →(chroma 抠图)→ ingest,返回 mediaId(失败抛错)。
 *
 * 去背处理:
 *   - chroma:cutoutToTransparent 抠洋红底 → 透明 PNG。
 *   - alpha:能力探测(模型支持原生透明)才发 background:transparent;否则**回落
 *     screen-black**(改用纯黑底 + screen,由调用方把 asset.matte/blendMode 同步修正)。
 *   - 其余:直接 ingest 原图,靠运行时 blendMode 去背。
 */
export async function generateUIAsset(opts: {
  asset: UIAsset
  client: ImageClient
  ctx?: UIStyleContext
  referenceImages?: ImageReference[]
  onRequest?: (req: GenRequestSnapshot) => void
}): Promise<{ mediaId: string; effectiveMatte: UIMatte; effectiveBlendMode: UIBlendMode }> {
  const preset = UI_ROLE_PRESETS[opts.asset.role] ?? UI_ROLE_PRESETS.custom

  // alpha 能力探测:模型不支持原生透明 → 回落 screen-black(纯黑底 + screen)。
  let effectiveMatte = opts.asset.matte
  const model = opts.client.getModel?.() ?? ''
  if (effectiveMatte === 'alpha' && !supportsTransparentBackground(model)) {
    effectiveMatte = 'screen-black'
  }
  const effectiveBlendMode = matteToBlendMode(effectiveMatte)

  const prompt = buildUIAssetPrompt({ ...opts.asset, matte: effectiveMatte }, opts.ctx)
  const refs = opts.referenceImages?.length ? opts.referenceImages : undefined

  if (opts.onRequest) {
    const reqRefs: GenRequestRef[] = (refs ?? []).map((r) => ({
      role: 'reference_image',
      url: r.dataUrl,
      label: r.label ?? 'UI 参考图',
    }))
    opts.onRequest({
      endpoint: `${opts.client.getModel?.() ?? opts.client.getProviderName?.() ?? '图像'} · ${
        refs ? '图生图' : '文生图'
      } · UI 素材`,
      prompt,
      params: {
        size: preset.size,
        provider: opts.client.getProviderName?.() ?? '(未知)',
        model: opts.client.getModel?.() ?? '(默认)',
        mode: refs ? '图生图' : '文生图',
        matte: effectiveMatte,
      },
      refs: reqRefs,
      at: Date.now(),
    })
  }

  const genReq: ImageRequest = {
    prompt,
    size: preset.size,
    quality: 'high',
    ...(refs ? { referenceImages: refs } : {}),
    ...(effectiveMatte === 'alpha' ? { background: 'transparent', outputFormat: 'png' } : {}),
  }
  const out = await opts.client.generate(genReq)

  const finalDataUrl =
    effectiveMatte === 'chroma' ? await cutoutToTransparent(out.dataUrl) : out.dataUrl

  const mediaId = useMediaStore.getState().ingestDataUrl(finalDataUrl, {
    promptKind: 'ui-asset',
    tags: [`ui:${opts.asset.id}`, `ui-role:${opts.asset.role}`],
    humanReadableName: `${opts.asset.name} · UI`,
    mimeType: 'image/png',
  })
  return { mediaId, effectiveMatte, effectiveBlendMode }
}
