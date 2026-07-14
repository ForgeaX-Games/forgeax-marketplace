// @source wb-character/src/lib/image-normalize.ts
const BG_THRESHOLD = 240

function findCharBounds(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const data = ctx.getImageData(0, 0, w, h).data
  let minX = w, maxX = 0, minY = h, maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
      if (a > 20 && (r < BG_THRESHOLD || g < BG_THRESHOLD || b < BG_THRESHOLD)) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return null
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

/**
 * Normalize character onto a square white canvas:
 * top 25% empty, character 65% height, bottom 10% empty, centered horizontally.
 */
export async function normalizeCharacterLayout(dataUrl: string, canvasSize = 1024): Promise<string> {
  const img = await loadImage(dataUrl)
  const tmpCanvas = document.createElement('canvas')
  tmpCanvas.width = img.width
  tmpCanvas.height = img.height
  const tmpCtx = tmpCanvas.getContext('2d')!
  tmpCtx.drawImage(img, 0, 0)

  const bounds = findCharBounds(tmpCtx, img.width, img.height)
  if (!bounds) return dataUrl

  const targetH = Math.round(canvasSize * 0.65)
  const scale = targetH / bounds.h
  const targetW = Math.round(bounds.w * scale)

  const out = document.createElement('canvas')
  out.width = canvasSize
  out.height = canvasSize
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  const topPad = Math.round(canvasSize * 0.25)
  const leftPad = Math.round((canvasSize - targetW) / 2)

  ctx.drawImage(img, bounds.x, bounds.y, bounds.w, bounds.h, leftPad, topPad, targetW, targetH)
  return out.toDataURL('image/png')
}

/**
 * Build a 16:9 ultimate frame: character centered-left at 35%, 65% height.
 */
export async function buildUltimateFrame(dataUrl: string): Promise<string> {
  const W = 1920, H = 1080
  const img = await loadImage(dataUrl)

  const tmpCanvas = document.createElement('canvas')
  tmpCanvas.width = img.width
  tmpCanvas.height = img.height
  const tmpCtx = tmpCanvas.getContext('2d')!
  tmpCtx.drawImage(img, 0, 0)

  const bounds = findCharBounds(tmpCtx, img.width, img.height)

  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)

  if (!bounds) {
    ctx.drawImage(img, 0, 0, W, H)
  } else {
    const targetH = Math.round(H * 0.65)
    const scale = targetH / bounds.h
    const targetW = Math.round(bounds.w * scale)
    const charCenterX = Math.round(W * 0.35)
    const left = Math.max(0, Math.round(charCenterX - targetW / 2))
    const top = Math.round(H * 0.3)
    ctx.drawImage(img, bounds.x, bounds.y, bounds.w, bounds.h, left, top, targetW, targetH)
  }

  return out.toDataURL('image/png')
}

/**
 * Build a 16:9 cinematic starting frame for power-awakening cutscenes.
 * Dark dramatic gradient background with the character centered,
 * plus subtle rim-glow and radial vignette to prime the AI to generate
 * a dramatic environment rather than a flat solid-color background.
 */
export async function buildCinematicFrame(dataUrl: string): Promise<string> {
  const W = 1920, H = 1080
  const img = await loadImage(dataUrl)

  const tmpCanvas = document.createElement('canvas')
  tmpCanvas.width = img.width
  tmpCanvas.height = img.height
  const tmpCtx = tmpCanvas.getContext('2d')!
  tmpCtx.drawImage(img, 0, 0)
  const bounds = findCharBounds(tmpCtx, img.width, img.height)

  const out = document.createElement('canvas')
  out.width = W
  out.height = H
  const ctx = out.getContext('2d')!

  // 1) Dark radial gradient background (deep blue-purple to near-black)
  const bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.45, H * 0.1, W * 0.5, H * 0.5, H * 0.9)
  bgGrad.addColorStop(0, '#1a1a3e')
  bgGrad.addColorStop(0.4, '#0d0d2b')
  bgGrad.addColorStop(1, '#030308')
  ctx.fillStyle = bgGrad
  ctx.fillRect(0, 0, W, H)

  // 2) Subtle ground-level atmospheric glow
  const floorGrad = ctx.createLinearGradient(0, H * 0.75, 0, H)
  floorGrad.addColorStop(0, 'rgba(60, 40, 120, 0)')
  floorGrad.addColorStop(0.5, 'rgba(60, 40, 120, 0.15)')
  floorGrad.addColorStop(1, 'rgba(30, 20, 60, 0.3)')
  ctx.fillStyle = floorGrad
  ctx.fillRect(0, H * 0.75, W, H * 0.25)

  // 3) Place the character (centered, 70% height)
  if (bounds) {
    const targetH = Math.round(H * 0.70)
    const scale = targetH / bounds.h
    const targetW = Math.round(bounds.w * scale)
    const left = Math.round((W - targetW) / 2)
    const top = Math.round(H * 0.22)

    // Soft glow behind the character
    const glowSize = Math.max(targetW, targetH) * 0.7
    const glowGrad = ctx.createRadialGradient(
      left + targetW / 2, top + targetH * 0.4, glowSize * 0.05,
      left + targetW / 2, top + targetH * 0.4, glowSize,
    )
    glowGrad.addColorStop(0, 'rgba(100, 80, 200, 0.25)')
    glowGrad.addColorStop(0.5, 'rgba(60, 40, 160, 0.08)')
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = glowGrad
    ctx.fillRect(0, 0, W, H)

    ctx.drawImage(img, bounds.x, bounds.y, bounds.w, bounds.h, left, top, targetW, targetH)
  } else {
    ctx.drawImage(img, 0, 0, W, H)
  }

  // 4) Radial vignette overlay (dark edges, bright center on character)
  const vigGrad = ctx.createRadialGradient(W * 0.5, H * 0.45, H * 0.25, W * 0.5, H * 0.5, H * 0.85)
  vigGrad.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vigGrad.addColorStop(0.7, 'rgba(0, 0, 0, 0.2)')
  vigGrad.addColorStop(1, 'rgba(0, 0, 0, 0.55)')
  ctx.fillStyle = vigGrad
  ctx.fillRect(0, 0, W, H)

  return out.toDataURL('image/png')
}
