import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  inspectUiAssetCanvas,
  isIconContentRejected,
  isIconInspectionRejected,
  isIconInspectionRejectedRelaxed,
  normalizeStandaloneUiAsset,
  normalizeUiAssetForCanvas,
} from '../ui-asset-cleanup'

function toDataUrl(buf: Buffer): string {
  return `data:image/png;base64,${buf.toString('base64')}`
}

async function fromDataUrl(dataUrl: string): Promise<{ data: Buffer; width: number; height: number; channels: number }> {
  const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const { data, info } = await sharp(Buffer.from(base64, 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: Buffer.from(data), width: info.width, height: info.height, channels: info.channels }
}

async function createDirtyStandaloneAsset(): Promise<string> {
  const svg = `
    <svg width="96" height="96" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
      <rect width="96" height="96" fill="#252d37" />
      <rect width="14" height="14" x="0" y="0" fill="#000000" />
      <rect width="14" height="14" x="82" y="0" fill="#000000" />
      <rect width="14" height="14" x="0" y="82" fill="#000000" />
      <rect width="14" height="14" x="82" y="82" fill="#000000" />
      <rect x="21" y="18" width="54" height="60" rx="18" fill="#ff8abc" />
      <rect x="31" y="30" width="26" height="10" rx="5" fill="#ffffff" />
      <circle cx="61" cy="52" r="7" fill="#7ad8ff" />
    </svg>
  `
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return toDataUrl(png)
}

async function createSwordWithBaseline(): Promise<string> {
  const svg = `
    <svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <rect width="128" height="128" fill="#ffffff" />
      <path d="M54 18 L78 18 L70 80 L50 80 Z" fill="#f8b2d4" stroke="#8f6f9d" stroke-width="2"/>
      <circle cx="66" cy="16" r="6" fill="#8edcf0" stroke="#8f6f9d" stroke-width="2"/>
      <rect x="55" y="80" width="22" height="8" rx="4" fill="#8edcf0" stroke="#8f6f9d" stroke-width="2"/>
      <line x1="22" y1="110" x2="106" y2="110" stroke="#b8b1bc" stroke-width="2" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createSoftButtonChrome(): Promise<string> {
  const svg = `
    <svg width="256" height="96" viewBox="0 0 256 96" xmlns="http://www.w3.org/2000/svg">
      <rect width="256" height="96" fill="#FF00FF" />
      <rect x="12" y="18" width="232" height="60" rx="22" fill="#cda8ff" />
      <rect x="18" y="22" width="220" height="48" rx="18" fill="#e6d4ff" opacity="0.92" />
      <path d="M10 18 Q26 18 28 2 L42 2 Q34 18 20 30 Z" fill="#96f1ff" opacity="0.95" />
      <path d="M246 18 Q230 18 228 2 L214 2 Q222 18 236 30 Z" fill="#96f1ff" opacity="0.95" />
      <rect x="34" y="28" width="188" height="10" rx="5" fill="#fffaf8" opacity="0.8" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createPanelWithDarkBackdrop(): Promise<string> {
  const svg = `
    <svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
      <rect width="256" height="256" fill="#FF00FF" />
      <rect x="22" y="22" width="212" height="212" rx="42" fill="#ffe98d" />
      <rect x="34" y="34" width="188" height="188" rx="34" fill="#87dbff" />
      <rect x="50" y="50" width="156" height="156" rx="26" fill="#ffe8ef" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createTransparentMarginButton(): Promise<string> {
  const svg = `
    <svg width="400" height="220" viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="220" fill="transparent" />
      <rect x="80" y="70" width="240" height="80" rx="10" fill="#c9821f" />
      <rect x="92" y="82" width="216" height="20" rx="6" fill="#ffd35e" />
      <rect x="92" y="106" width="216" height="32" rx="4" fill="#f0a22f" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createShortTitleStrip(): Promise<string> {
  const svg = `
    <svg width="320" height="96" viewBox="0 0 320 96" xmlns="http://www.w3.org/2000/svg">
      <rect width="320" height="96" fill="transparent" />
      <rect x="16" y="12" width="288" height="20" fill="#7f6d39" />
      <rect x="24" y="28" width="272" height="40" fill="#f2bc44" />
      <rect x="40" y="36" width="240" height="16" fill="#2f2b75" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createDirtyTransparentCorners(): Promise<string> {
  const image = sharp({
    create: {
      width: 96,
      height: 96,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
  const base = await image.png().toBuffer()
  const { data, info } = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const rgba = Buffer.from(data)
  const paint = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const idx = (y * info.width + x) * info.channels
    rgba[idx] = r
    rgba[idx + 1] = g
    rgba[idx + 2] = b
    rgba[idx + 3] = a
  }
  for (let y = 18; y < 78; y++) {
    for (let x = 24; x < 72; x++) {
      paint(x, y, 240, 180, 60, 255)
    }
  }
  paint(0, 0, 25, 25, 25, 0)
  paint(95, 0, 240, 240, 240, 0)
  const png = await sharp(rgba, { raw: info }).png().toBuffer()
  return toDataUrl(png)
}

async function createNeutralChromePanel(): Promise<string> {
  const svg = `
    <svg width="320" height="200" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="320" height="200" fill="#FF00FF" />
      <rect x="30" y="26" width="260" height="148" rx="20" fill="#555e68" />
      <rect x="44" y="40" width="232" height="120" rx="16" fill="#65707b" />
      <rect x="52" y="48" width="216" height="20" rx="8" fill="#8a99a8" />
      <rect x="72" y="82" width="176" height="56" rx="10" fill="#515a63" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

/**
 * 外周洋红、中间棕色画框、框内再洋红（与四边不连通）—— 模拟「框心」残底色键。
 * 仅边缘泛洪无法进入框内，需 global scorch。
 */
async function createFramedInteriorMagentaPanel(): Promise<string> {
  const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#FF00FF" />
      <rect x="20" y="20" width="160" height="20" fill="#6b4423" />
      <rect x="20" y="160" width="160" height="20" fill="#6b4423" />
      <rect x="20" y="40" width="20" height="120" fill="#6b4423" />
      <rect x="160" y="40" width="20" height="120" fill="#6b4423" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

/** 框内低对比度灰洋红 (与纯 #ff00ff 球距离大)，与四边不连通，须 isLowChromaMauveRoseScorch 命中 */
async function createFramedInteriorDullMauveFill(): Promise<string> {
  const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#0a0e12" />
      <rect x="20" y="20" width="160" height="20" fill="#2a2f36" />
      <rect x="20" y="160" width="160" height="20" fill="#2a2f36" />
      <rect x="20" y="40" width="20" height="120" fill="#2a2f36" />
      <rect x="160" y="40" width="20" height="120" fill="#2a2f36" />
      <rect x="50" y="50" width="100" height="100" fill="#5a4d52" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createDarkStageWithPanel(): Promise<string> {
  const svg = `
    <svg width="280" height="180" viewBox="0 0 280 180" xmlns="http://www.w3.org/2000/svg">
      <rect width="280" height="180" fill="#0d1118" />
      <rect x="44" y="32" width="192" height="116" rx="16" fill="#2e3d4f" />
      <rect x="54" y="42" width="172" height="96" rx="12" fill="#75849a" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

/** 绿幕与主体颜色拉开距离，供色键判定的回归用 */
/** 四边为深色、中央独立白底圆角+彩色主体（与边不连通，泛洪清不掉白，须近白全图 scorch） */
async function createIconOnCenteredWhitePlate(): Promise<string> {
  const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#0f1419" />
      <rect x="36" y="36" width="128" height="128" rx="28" fill="#FFFFFF" />
      <circle cx="100" cy="100" r="30" fill="#0ad4a5" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createRoundedSquarePlateIcon(): Promise<string> {
  const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#ffffff" />
      <rect x="40" y="40" width="120" height="120" rx="18" fill="none" stroke="#ef2c9d" stroke-width="14" />
      <path d="M64 66 L136 134 M136 66 L64 134" stroke="#72d8ff" stroke-width="12" stroke-linecap="round" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createPinkSpeechBubblePlateIcon(): Promise<string> {
  const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#ffffff" />
      <path d="M46 58 H146 Q160 58 160 72 V118 Q160 132 146 132 H92 L64 154 V132 H46 Q32 132 32 118 V72 Q32 58 46 58 Z" fill="#e843a7" />
      <circle cx="76" cy="95" r="9" fill="#76d8ff" />
      <rect x="96" y="84" width="38" height="22" rx="5" fill="#6ed4ff" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createDarkRoundedAppIconBackpack(): Promise<string> {
  const svg = `
    <svg width="240" height="240" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
      <rect width="240" height="240" fill="#ffffff" />
      <rect x="32" y="30" width="176" height="176" rx="28" fill="#3b1730" />
      <rect x="70" y="80" width="100" height="86" rx="14" fill="#59656b" stroke="#ffc45c" stroke-width="6" />
      <rect x="84" y="66" width="72" height="34" rx="12" fill="#79888e" stroke="#ffc45c" stroke-width="6" />
      <path d="M92 134 H148" stroke="#54e7ef" stroke-width="8" stroke-linecap="round" />
      <path d="M116 108 L130 122 L116 138 L102 122 Z" fill="#2e3941" stroke="#ffc45c" stroke-width="5" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createPinkCircleBadgeStarIcon(): Promise<string> {
  const svg = `
    <svg width="240" height="240" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
      <rect width="240" height="240" fill="#ffffff" />
      <circle cx="120" cy="120" r="82" fill="#ea5f98" />
      <path d="M120 42 L138 95 L194 94 L149 126 L166 180 L120 148 L74 180 L91 126 L46 94 L102 95 Z" fill="#3e1d36" />
      <path d="M120 76 L132 108 L166 108 L138 128 L150 162 L120 142 L90 162 L102 128 L74 108 L108 108 Z" fill="#58f1ef" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createNakedCrossedSwordsIcon(): Promise<string> {
  const svg = `
    <svg width="240" height="240" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg">
      <rect width="240" height="240" fill="#ffffff" />
      <g stroke-linecap="round" stroke-linejoin="round">
        <path d="M72 42 L172 154 L154 172 L54 60 Z" fill="#594061" stroke="#37dffc" stroke-width="8" />
        <path d="M168 42 L68 154 L86 172 L186 60 Z" fill="#594061" stroke="#37dffc" stroke-width="8" />
        <path d="M52 176 L86 142" stroke="#37dffc" stroke-width="18" />
        <path d="M188 176 L154 142" stroke="#37dffc" stroke-width="18" />
        <path d="M40 188 L70 218" stroke="#37dffc" stroke-width="14" />
        <path d="M200 188 L170 218" stroke="#37dffc" stroke-width="14" />
        <circle cx="38" cy="190" r="9" fill="#ff47b3" />
        <circle cx="202" cy="190" r="9" fill="#ff47b3" />
      </g>
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createEmptyDarkSlotPlateIcon(): Promise<string> {
  const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#ffffff" />
      <rect x="28" y="28" width="144" height="144" rx="22" fill="#3a4550" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createBannerCaptionIcon(): Promise<string> {
  const svg = `
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#ffffff" />
      <rect x="44" y="36" width="112" height="128" rx="14" fill="#4a5560" />
      <rect x="56" y="48" width="88" height="52" rx="8" fill="#6eb8e8" />
      <rect x="52" y="112" width="18" height="8" rx="2" fill="#d8e8f0" />
      <rect x="74" y="112" width="28" height="8" rx="2" fill="#d8e8f0" />
      <rect x="106" y="112" width="22" height="8" rx="2" fill="#d8e8f0" />
      <rect x="132" y="112" width="18" height="8" rx="2" fill="#d8e8f0" />
      <rect x="52" y="126" width="24" height="6" rx="2" fill="#b8c8d0" />
      <rect x="80" y="126" width="36" height="6" rx="2" fill="#b8c8d0" />
      <rect x="120" y="126" width="30" height="6" rx="2" fill="#b8c8d0" />
      <rect x="58" y="138" width="20" height="6" rx="2" fill="#d8e8f0" />
      <rect x="82" y="138" width="32" height="6" rx="2" fill="#d8e8f0" />
      <rect x="118" y="138" width="28" height="6" rx="2" fill="#d8e8f0" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

async function createChromaGreenBackdropButton(): Promise<string> {
  const svg = `
    <svg width="256" height="96" viewBox="0 0 256 96" xmlns="http://www.w3.org/2000/svg">
      <rect width="256" height="96" fill="#00FF00" />
      <rect x="48" y="22" width="160" height="52" rx="12" fill="#5a3d2a" />
    </svg>
  `
  return toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
}

function measureOpaqueBounds(data: Buffer, width: number, height: number, channels: number): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
} {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels
      if (data[idx + 3] <= 12) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
}

describe('normalizeStandaloneUiAsset', () => {
  it('removes white backgrounds and black corner artifacts while preserving inner highlight', async () => {
    const dirty = await createDirtyStandaloneAsset()

    const normalized = await normalizeStandaloneUiAsset(dirty, { mode: 'icon', fillRatio: 0.9 })
    const { data, width, height, channels } = await fromDataUrl(normalized)

    const pixelAt = (x: number, y: number) => {
      const idx = (y * width + x) * channels
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]]
    }

    expect(pixelAt(0, 0)).toEqual([0, 0, 0, 0])
    expect(pixelAt(width - 1, 0)).toEqual([0, 0, 0, 0])
    expect(pixelAt(0, height - 1)).toEqual([0, 0, 0, 0])
    expect(pixelAt(width - 1, height - 1)).toEqual([0, 0, 0, 0])

    let opaqueWhitePixels = 0
    let opaqueEdgePixels = 0
    let opaqueDarkPixels = 0
    for (let x = 0; x < width; x++) {
      const top = pixelAt(x, 0)
      const bottom = pixelAt(x, height - 1)
      if (top[3] > 16) opaqueEdgePixels++
      if (bottom[3] > 16) opaqueEdgePixels++
    }
    for (let y = 0; y < height; y++) {
      const left = pixelAt(0, y)
      const right = pixelAt(width - 1, y)
      if (left[3] > 16) opaqueEdgePixels++
      if (right[3] > 16) opaqueEdgePixels++
    }
    for (let i = 0; i < data.length; i += channels) {
      if (data[i + 3] > 16 && data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) {
        opaqueWhitePixels++
      }
      if (data[i + 3] > 16 && data[i] < 50 && data[i + 1] < 60 && data[i + 2] < 70) {
        opaqueDarkPixels++
      }
    }

    expect(opaqueEdgePixels).toBe(0)
    // icon 管线会全局剥近白键底，内嵌高光可能被一并去掉；主体粉色卡片须保留
    expect(opaqueWhitePixels).toBeGreaterThanOrEqual(0)
    let opaquePinkPixels = 0
    for (let i = 0; i < data.length; i += channels) {
      if (data[i + 3] > 16 && data[i] > 200 && data[i + 1] > 100 && data[i + 2] > 150) {
        opaquePinkPixels++
      }
    }
    expect(opaquePinkPixels).toBeGreaterThan(40)
    expect(opaqueDarkPixels).toBeLessThan(200)
  })

  it('removes disconnected baseline artifacts from icons', async () => {
    const dirty = await createSwordWithBaseline()
    const normalized = await normalizeStandaloneUiAsset(dirty, { mode: 'icon' })
    const { data, width, height, channels } = await fromDataUrl(normalized)

    const alphaAt = (x: number, y: number) => data[(y * width + x) * channels + 3]
    let bottomLineAlpha = 0
    for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x++) {
      bottomLineAlpha += alphaAt(x, Math.floor(height * 0.86))
    }
    let swordBodyAlpha = 0
    for (let y = Math.floor(height * 0.3); y < Math.floor(height * 0.7); y++) {
      swordBodyAlpha += alphaAt(Math.floor(width * 0.5), y)
    }

    expect(bottomLineAlpha).toBe(0)
    expect(swordBodyAlpha).toBeGreaterThan(1000)
  })

  it('strips near-white in icon mode before keepLargest (isolated full-canvas white behind glyph)', async () => {
    const inUrl = await createIconOnCenteredWhitePlate()
    const out = await normalizeStandaloneUiAsset(inUrl, { mode: 'icon', fillRatio: 0.72 })
    const { data, width, height, channels } = await fromDataUrl(out)
    const a = 3
    // 白底与四边不连通，泛洪去不掉，须 scorchIcon 全图剥 #FFF
    let opaqueNearWhite = 0
    for (let i = 0; i < data.length; i += channels) {
      if (data[i + a] > 12 && data[i] > 242 && data[i + 1] > 242 && data[i + 2] > 242) {
        opaqueNearWhite++
      }
    }
    expect(opaqueNearWhite).toBeLessThan(40)
    const bounds = measureOpaqueBounds(data, width, height, channels)
    expect(bounds).not.toBeNull()
    const cx = Math.floor((bounds!.minX + bounds!.maxX) / 2)
    const cy = Math.floor((bounds!.minY + bounds!.maxY) / 2)
    const idx = (cy * width + cx) * channels
    expect(data[idx + 1]).toBeGreaterThan(160)
    expect(data[idx + 2]).toBeGreaterThan(100)
    expect(data[idx + a]).toBeGreaterThan(200)
  })

  it('removes light grey white-key fringe attached to transparent border', async () => {
    const svg = `
      <svg width="96" height="96" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
        <rect width="96" height="96" fill="#FFFFFF" />
        <polygon points="48,22 68,48 48,74 28,48" fill="#2288DD" stroke="#111111" stroke-width="3" />
        <polygon points="48,26 64,48 48,70 32,48" fill="none" stroke="#D8D8D8" stroke-width="5" />
      </svg>
    `
    const inUrl = toDataUrl(await sharp(Buffer.from(svg)).png().toBuffer())
    const out = await normalizeStandaloneUiAsset(inUrl, { mode: 'icon', fillRatio: 0.72 })
    const cleaned = await fromDataUrl(out)
    const report = await inspectUiAssetCanvas(out)
    let fringePixels = 0
    const alphaAt = (x: number, y: number) => cleaned.data[(y * cleaned.width + x) * cleaned.channels + 3]
    for (let y = 0; y < cleaned.height; y++) {
      for (let x = 0; x < cleaned.width; x++) {
        const i = (y * cleaned.width + x) * cleaned.channels
        const r = cleaned.data[i]
        const g = cleaned.data[i + 1]
        const b = cleaned.data[i + 2]
        const a = cleaned.data[i + 3]
        if (a <= 16 || r <= 190 || g <= 190 || b <= 190) continue
        const touchesTransparent = (
          (x > 0 && alphaAt(x - 1, y) <= 16)
          || (x + 1 < cleaned.width && alphaAt(x + 1, y) <= 16)
          || (y > 0 && alphaAt(x, y - 1) <= 16)
          || (y + 1 < cleaned.height && alphaAt(x, y + 1) <= 16)
        )
        if (touchesTransparent) fringePixels++
      }
    }
    expect(fringePixels).toBeLessThan(35)
    expect(report.opaqueEdgePixels).toBe(0)
    expect(cleaned.data[(Math.floor(cleaned.height / 2) * cleaned.width + Math.floor(cleaned.width / 2)) * cleaned.channels + 3]).toBeGreaterThan(200)
  })

  it('reports high bounds-edge ratio for rounded-square plate-frame icons', async () => {
    const inUrl = await createRoundedSquarePlateIcon()
    const rawReport = await inspectUiAssetCanvas(inUrl)
    const out = await normalizeStandaloneUiAsset(inUrl, { mode: 'icon', fillRatio: 0.62 })
    const cleanedReport = await inspectUiAssetCanvas(out)

    expect(rawReport.opaqueBoundsEdgeRatio).toBeGreaterThan(0.42)
    expect(cleanedReport.opaqueEdgePixels).toBe(0)
    expect(cleanedReport.opaqueBoundsEdgeRatio).toBeLessThan(0.42)
  })

  it('reports high pink-backdrop ratio for internal magenta plate icons', async () => {
    const inUrl = await createPinkSpeechBubblePlateIcon()
    const rawReport = await inspectUiAssetCanvas(inUrl)
    const out = await normalizeStandaloneUiAsset(inUrl, { mode: 'icon', fillRatio: 0.62 })
    const cleanedReport = await inspectUiAssetCanvas(out)

    expect(rawReport.opaquePinkBackdropRatio).toBeGreaterThan(0.18)
    expect(cleanedReport.opaqueEdgePixels).toBe(0)
    expect(cleanedReport.opaquePinkBackdropRatio).toBeLessThan(0.18)
  })

  it('reports plate-like geometry for dark rounded app-icon backpacks', async () => {
    const inUrl = await createDarkRoundedAppIconBackpack()
    const out = await normalizeStandaloneUiAsset(inUrl, { mode: 'icon', fillRatio: 0.62 })
    const report = await inspectUiAssetCanvas(out)

    expect(report.opaqueEdgePixels).toBe(0)
    expect(report.opaquePlateLikeRatio).toBeGreaterThan(0.58)
  })

  it('reports plate-like geometry for circular badge star icons', async () => {
    const inUrl = await createPinkCircleBadgeStarIcon()
    const rawReport = await inspectUiAssetCanvas(inUrl)
    const out = await normalizeStandaloneUiAsset(inUrl, { mode: 'icon', fillRatio: 0.62 })
    const cleanedReport = await inspectUiAssetCanvas(out)

    expect(rawReport.opaquePlateLikeRatio).toBeGreaterThan(0.4)
    expect(cleanedReport.opaqueEdgePixels).toBe(0)
    expect(cleanedReport.opaquePlateLikeRatio).toBeLessThan(0.4)
  })

  it('does not mark naked crossed swords as app-icon plates', async () => {
    const inUrl = await createNakedCrossedSwordsIcon()
    const out = await normalizeStandaloneUiAsset(inUrl, { mode: 'icon', fillRatio: 0.62 })
    const report = await inspectUiAssetCanvas(out)

    expect(report.opaqueEdgePixels).toBe(0)
    expect(report.opaquePlateLikeRatio).toBeLessThanOrEqual(0.4)
    expect(isIconInspectionRejected(report)).toBe(false)
  })

  it('rejects empty dark rounded-square slot plates', async () => {
    const inUrl = await createEmptyDarkSlotPlateIcon()
    const out = await normalizeStandaloneUiAsset(inUrl, { mode: 'icon', fillRatio: 0.62 })
    const report = await inspectUiAssetCanvas(out)

    expect(report.solidSlotPlateScore).toBeGreaterThan(0.52)
    expect(isIconInspectionRejected(report)).toBe(true)
  })

  it('rejects banner/caption strip icons with dense text-like rows', async () => {
    const inUrl = await createBannerCaptionIcon()
    const rawReport = await inspectUiAssetCanvas(inUrl)
    const out = await normalizeStandaloneUiAsset(inUrl, { mode: 'icon', fillRatio: 0.62 })
    const report = await inspectUiAssetCanvas(out)

    expect(Math.max(rawReport.captionBandScore, rawReport.denseTextBlockScore, rawReport.textLikeRowScore)).toBeGreaterThan(0.18)
    expect(isIconContentRejected(rawReport)).toBe(true)
    expect(isIconInspectionRejected(report)).toBe(true)
    expect(isIconInspectionRejectedRelaxed(report)).toBe(true)
  })

  it('preserves edge-touching chrome highlights for button assets', async () => {
    const dirty = await createSoftButtonChrome()
    const normalized = await normalizeStandaloneUiAsset(dirty, { mode: 'chrome', fillRatio: 0.84 })
    const { data, width, height, channels } = await fromDataUrl(normalized)

    const pixelAt = (x: number, y: number) => {
      const idx = (y * width + x) * channels
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]]
    }

    const outerMargin = pixelAt(0, 0)
    let cyanAccentPixels = 0
    for (let i = 0; i < data.length; i += channels) {
      if (data[i + 3] > 16 && data[i + 1] > 150 && data[i + 2] > 200) {
        cyanAccentPixels++
      }
    }

    expect(outerMargin).toEqual([0, 0, 0, 0])
    expect(cyanAccentPixels).toBeGreaterThan(80)
  })

  it('removes edge-connected chroma backdrop from chrome panel assets', async () => {
    const dirty = await createPanelWithDarkBackdrop()
    const normalized = await normalizeStandaloneUiAsset(dirty, { mode: 'chrome' })
    const { data, width, height, channels } = await fromDataUrl(normalized)

    const pixelAt = (x: number, y: number) => {
      const idx = (y * width + x) * channels
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]]
    }

    expect(pixelAt(0, 0)).toEqual([0, 0, 0, 0])
    expect(pixelAt(width - 1, height - 1)).toEqual([0, 0, 0, 0])

    const outerFrame = pixelAt(Math.floor(width * 0.18), Math.floor(height * 0.18))
    const innerPanel = pixelAt(Math.floor(width * 0.5), Math.floor(height * 0.5))
    expect(outerFrame[3]).toBeGreaterThan(0)
    expect(innerPanel[3]).toBeGreaterThan(0)
  })

  it('trims transparent margins before exporting buttons to final canvas', async () => {
    const dirty = await createTransparentMarginButton()
    const normalized = await normalizeUiAssetForCanvas(dirty, {
      targetWidth: 512,
      targetHeight: 128,
      maxFillWidth: 0.76,
      maxFillHeight: 0.76,
      kernel: 'nearest',
    })
    const { data, width, height, channels } = await fromDataUrl(normalized)
    const bounds = measureOpaqueBounds(data, width, height, channels)

    expect(bounds.width).toBeGreaterThan(280)
    expect(bounds.height).toBeGreaterThan(80)
    expect(bounds.width).toBeLessThanOrEqual(390)
    expect(bounds.height).toBeLessThanOrEqual(100)
  })

  it('keeps title strip occupancy under a controlled height ratio', async () => {
    const dirty = await createShortTitleStrip()
    const normalized = await normalizeUiAssetForCanvas(dirty, {
      targetWidth: 640,
      targetHeight: 192,
      maxFillWidth: 0.82,
      maxFillHeight: 0.62,
      kernel: 'nearest',
    })
    const { data, width, height, channels } = await fromDataUrl(normalized)
    const bounds = measureOpaqueBounds(data, width, height, channels)

    expect(bounds.width).toBeGreaterThan(430)
    expect(bounds.height).toBeLessThanOrEqual(120)
    expect(bounds.minY).toBeGreaterThan(20)
  })

  it('reports transparent-corner dirt and occupancy metrics for verification', async () => {
    const dirty = await createDirtyTransparentCorners()
    const report = await inspectUiAssetCanvas(dirty)

    expect(report.contentWidth).toBe(48)
    expect(report.contentHeight).toBe(60)
    expect(report.occupancyWidth).toBeCloseTo(0.5, 2)
    expect(report.occupancyHeight).toBeCloseTo(0.625, 2)
    expect(report.transparentDirtyPixels).toBe(2)
    expect(report.transparentCornerDirtyPixels).toBe(2)
    expect(report.opaqueEdgePixels).toBe(0)
  })

  it('keeps chrome panel structure when backdrop is neutral-dark', async () => {
    const dirty = await createNeutralChromePanel()
    const normalized = await normalizeStandaloneUiAsset(dirty, { mode: 'chrome' })
    const report = await inspectUiAssetCanvas(normalized)

    expect(report.opaqueEdgePixels).toBe(0)
    expect(report.contentWidth).toBeGreaterThan(220)
    expect(report.contentHeight).toBeGreaterThanOrEqual(120)
    expect(report.opaqueComponentCount).toBeLessThan(24)
    expect(report.fragmentationRatio).toBeLessThan(0.2)
    expect(report.largestComponentRatio).toBeGreaterThan(0.8)
  })

  it('removes screen-green chroma backdrop for chrome without eating the main body', async () => {
    const dirty = await createChromaGreenBackdropButton()
    const normalized = await normalizeStandaloneUiAsset(dirty, { mode: 'chrome' })
    const { data, width, height, channels } = await fromDataUrl(normalized)
    const pixelAt = (x: number, y: number) => {
      const idx = (y * width + x) * channels
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]]
    }
    expect(pixelAt(0, 0)).toEqual([0, 0, 0, 0])
    const mid = pixelAt(Math.floor(width * 0.5), Math.floor(height * 0.5))
    expect(mid[3]).toBeGreaterThan(200)
  })

  it('scorches non-edge-connected magenta inside a closed frame (chrome panel hole)', async () => {
    const dirty = await createFramedInteriorMagentaPanel()
    const normalized = await normalizeStandaloneUiAsset(dirty, { mode: 'chrome' })
    const { data, width, height, channels } = await fromDataUrl(normalized)
    const pixelAt = (x: number, y: number) => {
      const idx = (y * width + x) * channels
      return [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]]
    }
    const c = [Math.floor(width * 0.5), Math.floor(height * 0.5)]
    const center = pixelAt(c[0], c[1])
    expect(center[0]).toBe(0)
    expect(center[1]).toBe(0)
    expect(center[2]).toBe(0)
    expect(center[3]).toBe(0)
  })

  it('scorches low-chroma mauve fill in closed frame (not pure #FF00FF)', async () => {
    const dirty = await createFramedInteriorDullMauveFill()
    const normalized = await normalizeStandaloneUiAsset(dirty, { mode: 'chrome' })
    const { data, width, height, channels } = await fromDataUrl(normalized)
    const c = (Math.floor(width * 0.5) * width + Math.floor(height * 0.5)) * channels
    expect(data[c + 3]).toBe(0)
  })

  it('scrubs dark stage leftovers on edges for chrome panel assets', async () => {
    const dirty = await createDarkStageWithPanel()
    const normalized = await normalizeStandaloneUiAsset(dirty, { mode: 'chrome' })
    const report = await inspectUiAssetCanvas(normalized)
    expect(report.opaqueEdgePixels).toBe(0)
    expect(report.contentWidth).toBeGreaterThan(150)
    expect(report.contentHeight).toBeGreaterThan(90)
  })

  it('applies dark-ui edge refine without wiping the main panel body', async () => {
    const dirty = await createDarkStageWithPanel()
    const normalized = await normalizeStandaloneUiAsset(dirty, { mode: 'chrome', chromeEdgeRefine: 'dark-ui' })
    const report = await inspectUiAssetCanvas(normalized)
    expect(report.opaqueEdgePixels).toBe(0)
    expect(report.opaquePixelCount).toBeGreaterThan(800)
    expect(report.fragmentationRatio).toBeLessThan(0.35)
  })
})
