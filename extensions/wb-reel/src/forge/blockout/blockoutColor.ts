/**
 * blockoutColor —— 角色占位的稳定配色。
 *
 * 同一角色 id 恒定取同一色（跨会话/跨场景一致）；不同角色尽量错开，便于在
 * 白模空间与渲染静帧里一眼区分谁是谁。配色同时驱动提示词「色彩图例」。
 */

export interface PaletteColor {
  hex: string
  /** 中文色名（用于提示词图例可读性） */
  name: string
}

/** 高对比、色相错开的调色板（12 色）。 */
export const BLOCKOUT_PALETTE_NAMED: readonly PaletteColor[] = [
  { hex: '#e6194b', name: '红' },
  { hex: '#4363d8', name: '蓝' },
  { hex: '#3cb44b', name: '绿' },
  { hex: '#f58231', name: '橙' },
  { hex: '#911eb4', name: '紫' },
  { hex: '#42d4f4', name: '青' },
  { hex: '#f032e6', name: '品红' },
  { hex: '#ffe119', name: '黄' },
  { hex: '#9a6324', name: '棕' },
  { hex: '#469990', name: '蓝绿' },
  { hex: '#bfef45', name: '黄绿' },
  { hex: '#dcbeff', name: '浅紫' },
] as const

export const BLOCKOUT_PALETTE: readonly string[] = BLOCKOUT_PALETTE_NAMED.map(
  (c) => c.hex,
)

/** djb2 字符串哈希（稳定、跨平台一致）。 */
function hashString(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i)
  }
  return h >>> 0
}

/** 角色 id → 稳定配色（hex）。 */
export function colorForCharacter(characterId: string): string {
  const idx = hashString(characterId) % BLOCKOUT_PALETTE.length
  return BLOCKOUT_PALETTE[idx] ?? '#e6194b'
}

/** hex → 中文色名；未知 hex 原样返回 hex。 */
export function colorNameOf(hex: string): string {
  const found = BLOCKOUT_PALETTE_NAMED.find(
    (c) => c.hex.toLowerCase() === hex.toLowerCase(),
  )
  return found ? found.name : hex
}
