/**
 * 按钮底图（border-image 九宫格）—— 以「文字内容区 : 底版装饰框」占比为主轴。
 * 人类可读全文：packages/marketplace/extensions/wb-ui/docs/button-chrome-generation-spec.md
 */

/** 与 border-image-slice 一致：垂直 32%、水平左右各 20% 为固定装饰（源图像素比例） */
export const BUTTON_CHROME_SLICE = '32% 20% fill'

export const BUTTON_CHROME_REPEAT = 'stretch'

/** 9-slice 语义长宽比（CSS 铺陈档位用，勿写入 MCP prompt —— Gemini 只接受 21:9 等固定画布） */
export const BUTTON_SOURCE_ASPECT = '4:1'

/** Gemini MCP / 直连生图实际画布比例（最宽档） */
export const BUTTON_MCP_CANVAS_ASPECT = '21:9'

/** 对话长选项专用源图：与菜单按钮共用 MCP 21:9 超宽画布 */
export const BUTTON_LONG_SOURCE_ASPECT = BUTTON_MCP_CANVAS_ASPECT

/** 长条 9-slice：左右 cap 更窄，中间 plain 区占源图宽度 ≥76% */
export const BUTTON_LONG_CHROME_SLICE = '32% 6% fill'

/** 铺陈档位：同一源图，不同宿主尺寸用不同 border-width，保证内容区占比恒定 */
export type ButtonChromeTier = 'compact' | 'medium' | 'wide' | 'long'

export interface ButtonChromeTierSpec {
  tier: ButtonChromeTier
  /** 宿主典型尺寸（CSS px） */
  deployWidth: number
  deployHeight: number
  /** HTML 叠字规格（非画进底图） */
  overlayFontPx: number
  overlayGlyphs: string
  /** 内容安全区占底版比例（宽×高）—— 生图与 CSS 对齐的核心 */
  contentZoneWidthRatio: number
  contentZoneHeightRatio: number
  /** 装饰框（四边 cap 合计）占底版比例上限 */
  frameWidthRatioMax: number
  frameHeightRatioMax: number
  /** 装饰线粗细占底版高度上限（分页 scale 下 cap 不能抢字） */
  ornamentLineHeightRatioMax: number
  /** 视觉质量：中间 plain 区视觉重量下限 */
  plainVisualMassMin: number
  borderWidth: string
}

export const BUTTON_CHROME_TIERS: Record<ButtonChromeTier, ButtonChromeTierSpec> = {
  compact: {
    tier: 'compact',
    deployWidth: 52,
    deployHeight: 44,
    overlayFontPx: 10,
    overlayGlyphs: '1 digit 0-9 or chevron ‹ ›',
    contentZoneWidthRatio: 0.56,
    contentZoneHeightRatio: 0.48,
    frameWidthRatioMax: 0.42,
    frameHeightRatioMax: 0.52,
    ornamentLineHeightRatioMax: 0.07,
    plainVisualMassMin: 0.68,
    /** 分页专用：比 generic compact 再收一点 cap，避免 52px 格子上 cap 抢高度 */
    borderWidth: '8px 10px',
  },
  medium: {
    tier: 'medium',
    deployWidth: 72,
    deployHeight: 40,
    overlayFontPx: 9,
    overlayGlyphs: '2-3 chars tab label or segment chip',
    contentZoneWidthRatio: 0.58,
    contentZoneHeightRatio: 0.46,
    frameWidthRatioMax: 0.42,
    frameHeightRatioMax: 0.54,
    ornamentLineHeightRatioMax: 0.1,
    plainVisualMassMin: 0.62,
    borderWidth: '11px 14px',
  },
  wide: {
    tier: 'wide',
    deployWidth: 220,
    deployHeight: 68,
    overlayFontPx: 14,
    overlayGlyphs: '2-4 Chinese chars or menu label',
    contentZoneWidthRatio: 0.6,
    contentZoneHeightRatio: 0.5,
    frameWidthRatioMax: 0.4,
    frameHeightRatioMax: 0.5,
    ornamentLineHeightRatioMax: 0.12,
    plainVisualMassMin: 0.6,
    borderWidth: '16px 22px',
  },
  long: {
    tier: 'long',
    deployWidth: 640,
    deployHeight: 54,
    overlayFontPx: 16,
    overlayGlyphs: '8-24 Chinese chars full-width dialogue choice',
    contentZoneWidthRatio: 0.78,
    contentZoneHeightRatio: 0.52,
    frameWidthRatioMax: 0.12,
    frameHeightRatioMax: 0.48,
    ornamentLineHeightRatioMax: 0.08,
    plainVisualMassMin: 0.78,
    borderWidth: '12px 24px',
  },
}

/** @deprecated 别名：宽档 menu CTA */
export const BUTTON_CHROME_BORDER_WIDTH = BUTTON_CHROME_TIERS.wide.borderWidth

export const TAB_CHROME_MIN_WIDTH = '84px'
export const TAB_CHROME_MIN_HEIGHT = '40px'
export const TAB_CHROME_BORDER_WIDTH = BUTTON_CHROME_TIERS.medium.borderWidth

/** tabs-section 分页格：medium 档同 border-width；格宽对齐 medium deploy（72px） */
export const PAGER_CHROME_MIN_WIDTH = `${BUTTON_CHROME_TIERS.medium.deployWidth}px`
export const PAGER_CHROME_MIN_HEIGHT = TAB_CHROME_MIN_HEIGHT
export const PAGER_CHROME_BORDER_WIDTH = TAB_CHROME_BORDER_WIDTH
export const PAGER_CHROME_OVERLAY_FONT_PX = '10px'

export const SEGMENT_CHROME_MIN_WIDTH = '60px'
export const SEGMENT_CHROME_MIN_HEIGHT = '36px'
export const SEGMENT_CHROME_BORDER_WIDTH = BUTTON_CHROME_TIERS.medium.borderWidth

export const MENU_CTA_CHROME_MIN_WIDTH = `${BUTTON_CHROME_TIERS.wide.deployWidth}px`
export const MENU_CTA_CHROME_MAX_WIDTH = '420px'

export const DIALOG_STRIP_CHROME_MIN_HEIGHT = `${BUTTON_CHROME_TIERS.long.deployHeight}px`
export const DIALOG_STRIP_CHROME_BORDER_WIDTH = BUTTON_CHROME_TIERS.long.borderWidth

/** 源图 cap 比例 — 与 BUTTON_CHROME_SLICE 对齐 */
export const BUTTON_CAP_WIDTH_RATIO = '18-22%'
export const BUTTON_CAP_HEIGHT_RATIO = '28-32%'

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

function tierContentBoxPx(t: ButtonChromeTierSpec): { w: number; h: number } {
  const [tb, lr] = t.borderWidth.split(/\s+/).map((s) => parseInt(s, 10))
  return {
    w: Math.round(t.deployWidth - lr * 2),
    h: Math.round(t.deployHeight - tb * 2),
  }
}

export function buildButtonChromeContentRatioPrompt(): string {
  const c = BUTTON_CHROME_TIERS.compact
  const m = BUTTON_CHROME_TIERS.medium
  const w = BUTTON_CHROME_TIERS.wide
  const cc = tierContentBoxPx(c)
  const mc = tierContentBoxPx(m)
  const wc = tierContentBoxPx(w)

  return [
    'CONTENT-TO-PLATE RATIO (mandatory — design from overlay text size, not from cap aesthetics alone):',
    'Output is a BLANK button plate only; HTML overlays text afterward — NEVER paint digits, arrows, chevrons, or labels inside the image.',
    `Pagination compact cell ${c.deployWidth}×${c.deployHeight}px:`,
    `  overlay ${c.overlayGlyphs} at ~${c.overlayFontPx}px centered;`,
    `  plain content safe zone ≥${pct(c.contentZoneWidthRatio)} plate width × ≥${pct(c.contentZoneHeightRatio)} plate height`,
    `  (≈${cc.w}×${cc.h}px inner box); combined ornamental frame ≤${pct(c.frameWidthRatioMax)} width & ≤${pct(c.frameHeightRatioMax)} height;`,
    `  cap line/ornament weight ≤${pct(c.ornamentLineHeightRatioMax)} of plate height; plain center visual mass ≥${pct(c.plainVisualMassMin)}.`,
    `Tab/segment medium ~${m.deployWidth}×${m.deployHeight}px:`,
    `  overlay ${m.overlayGlyphs} at ~${m.overlayFontPx}px; safe zone ≥${pct(m.contentZoneWidthRatio)}×≥${pct(m.contentZoneHeightRatio)} (≈${mc.w}×${mc.h}px).`,
    `Menu wide ${w.deployWidth}×${w.deployHeight}px:`,
    `  overlay ${w.overlayGlyphs} at ~${w.overlayFontPx}px; safe zone ≥${pct(w.contentZoneWidthRatio)}×≥${pct(w.contentZoneHeightRatio)} (≈${wc.w}×${wc.h}px).`,
    `Dialog long strip ${BUTTON_CHROME_TIERS.long.deployWidth}×${BUTTON_CHROME_TIERS.long.deployHeight}px reference (${BUTTON_LONG_SOURCE_ASPECT} source):`,
    `  overlay ${BUTTON_CHROME_TIERS.long.overlayGlyphs} at ~${BUTTON_CHROME_TIERS.long.overlayFontPx}px LEFT-aligned;`,
    `  plain readable band ≥${pct(BUTTON_CHROME_TIERS.long.contentZoneWidthRatio)} plate width — low ornament density, NO busy gold filigree in text band;`,
    `  side caps ≤${pct(BUTTON_CHROME_TIERS.long.frameWidthRatioMax)} width each; center must stay legible when stretched to full dialogue row width.`,
    'Frame caps stay thin at ALL tiers — widening caps on the source canvas is forbidden if it shrinks the plain center below these ratios at pagination scale.',
  ].join(' ')
}

export const SKILL_GRADE_BUTTON_CHROME = [
  'Output quality bar: shipped high-end game UI art at real pixel scale, sharp edges, readable PBR material,',
  'no heavy blur, no watercolor wash, no stock-photo texture, no Figma wireframe, no “UI kit mockup page”,',
  'no reference collage, no black/gray stage behind the object, no screenshot crop.',
  buildButtonChromeContentRatioPrompt(),
  `Same source ${BUTTON_SOURCE_ASPECT} asset pair (normal+primary) is 9-sliced at compact/medium/wide host sizes via CSS border-width tiers.`,
  `Primary and normal MUST share identical cap geometry — only material/color/glow may differ.`,
].join(' ')

export function buildButtonChrome9SlicePrompt(): string {
  const c = BUTTON_CHROME_TIERS.compact
  return [
    `9-SLICE LAYOUT (must match CSS slice ${BUTTON_CHROME_SLICE}):`,
    `LEFT/RIGHT caps ~${BUTTON_CAP_WIDTH_RATIO} of source canvas width each; TOP/BOTTOM bands ~${BUTTON_CAP_HEIGHT_RATIO} of source height each, vertically symmetric.`,
    `CENTER plain band must occupy ~${pct(c.contentZoneWidthRatio)} of source width at pagination scale — repeatable grain/wood/metal only, NO corner ornaments, NO full-width gradient.`,
    `When mentally scaled to ${c.deployWidth}×${c.deployHeight}px, the plain center must still read as the dominant surface (≥${pct(c.plainVisualMassMin)} visual mass), not tiny lines under oversized empty space.`,
  ].join(' ')
}

export function buildButtonChromeDeploymentPrompt(): string {
  const c = BUTTON_CHROME_TIERS.compact
  return [
    `MULTI-TIER REUSE: one normal/primary pair serves pagination (${c.deployWidth}×${c.deployHeight}), tabs/segments, and menu CTAs (${MENU_CTA_CHROME_MIN_WIDTH}-${MENU_CTA_CHROME_MAX_WIDTH}).`,
    `Design so plain content zone ratios hold at the SMALLEST tier first (${pct(c.contentZoneWidthRatio)}×${pct(c.contentZoneHeightRatio)}); wider hosts only stretch the plain center horizontally.`,
    `Canvas aspect ratio ${BUTTON_MCP_CANVAS_ASPECT} ultrawide rectangle (9-slice caps emulate ${BUTTON_SOURCE_ASPECT} menu strip when deployed).`,
  ].join(' ')
}

/** 分页器：所有格（含 current）必须同高同宽；active 仅 CSS 强调，禁止换 primary 底图 */
export function buildButtonChromePagerPrompt(): string {
  const m = BUTTON_CHROME_TIERS.medium
  const mc = tierContentBoxPx(m)
  return [
    `PAGINATION IN TABS-SECTION (same semantic group as bag-tab / segment):`,
    `ALL cells including current page use buttonNormal border-image — identical plate silhouette as inactive tabs.`,
    `Active/current state: CSS emphasis ONLY (opacity, brightness, font-weight) — forbidden to swap to buttonPrimary plate.`,
    `Pager cells are narrower (${PAGER_CHROME_MIN_WIDTH}×${TAB_CHROME_MIN_HEIGHT}) but MUST share the same cap geometry as tab plates at ${m.deployWidth}×${m.deployHeight}px (inner ≈${mc.w}×${mc.h}px).`,
    `Forbidden: separate pager-only template, background-fill shortcut, or primary plate on .active switch cells.`,
  ].join(' ')
}

export function buildButtonChromeDialogStripPrompt(): string {
  const l = BUTTON_CHROME_TIERS.long
  const lc = tierContentBoxPx(l)
  return [
    `DIALOG LONG-STRIP PLATE (${BUTTON_LONG_SOURCE_ASPECT} — NOT the 4:1 menu button asset):`,
    `Full-width NPC dialogue choice row ~100% panel width × ${l.deployHeight}px host.`,
    `Design a HORIZONTAL strip with thin left/right end caps only; center plain band ≥${pct(l.contentZoneWidthRatio)} width (≈${lc.w}px inner at reference width).`,
    `Plain center: low-contrast wood/metal/leather grain ONLY — forbidden: dense gold scrollwork, radial glow, or high-frequency pattern under left-aligned text.`,
    `Primary variant: accent warmth via subtle edge tint or cap recolor — forbidden: filling entire center with bright gold that destroys text contrast.`,
    `HTML overlays 8-24 Chinese chars on the LEFT; image must stay readable under white text + dark scrim.`,
    `Slice ${BUTTON_LONG_CHROME_SLICE}: caps ~6% source width each side.`,
  ].join(' ')
}

export function buildButtonChromePrimaryPairPrompt(): string {
  return [
    `PRIMARY / NORMAL PAIR RULE: identical silhouette and content-zone proportions; ONLY recolor/glow/material may differ.`,
    `Forbidden: primary as square badge, holographic panel, or glowing capsule while normal is a flat strip;`,
    `forbidden: primary caps thicker than normal; forbidden: different corner language or cap width between the pair.`,
  ].join(' ')
}

/** 同屏竖排菜单（如 确认成长 + 返回主菜单）—— 用户感知为同一层级底版 */
export function buildButtonChromeSiblingContextPrompt(role: 'normal' | 'primary'): string {
  const other = role === 'primary' ? 'normal/secondary' : 'primary/CTA'
  return [
    `SIBLING MENU CONTEXT: this ${role} plate stacks vertically beside its ${other} partner in the same interactive preview`,
    `(results/pause/start columns — e.g. confirm action above return-to-menu).`,
    `Users expect BOTH plates to share the same outer width, cap thickness, corner shape, and plain-center ratio;`,
    `ONLY emphasis (accent brightness / glow intensity / fill warmth) may differ — NOT a different button species.`,
  ].join(' ')
}

/** 把 STYLE_BUTTON_ART 的单条描述包进「同模板、仅强调色」语义，避免模型当成两种控件 */
export function wrapStyleButtonArtDesc(desc: string, role: 'normal' | 'primary'): string {
  return [
    buildButtonChromeSiblingContextPrompt(role),
    `STYLE ACCENT (${role} variant — do NOT change plate geometry): ${desc}`,
  ].join(' ')
}

export function buildButtonChromeFrameFitPrompt(): string {
  return 'Frame-fit: button plate spans 88-96% canvas width × 78-92% canvas height; plain center visibly larger than any single cap segment; margins keep all caps inside frame.'
}
