/**
 * cutoutToTransparent —— 把「纯色背景的道具图」抠成透明底 PNG。
 *
 * 用途（背包系统物品图标）：图标用受约束的提示词生成在**单一纯色背景**上
 * （默认洋红 chroma key #ff00ff，或退而求其次的纯白）。本函数从四角采样背景色，
 * 做基于队列的「边缘洪泛填充」把与背景相近、且从边缘连通的像素 alpha 置 0，
 * 内部同色区域不会被误删（不是全图阈值删除）。边缘做 1px 羽化减少锯齿。
 *
 * 纯 Canvas 实现，无外部依赖；浏览器环境运行（mediaStore ingest 前调用）。
 */

export interface CutoutOptions {
  /** 颜色距离阈值（0~255，越大删得越狠）。默认 42。 */
  tolerance?: number
  /** 边缘羽化半透明带宽（像素）。默认 1。 */
  feather?: number
}

interface RGB {
  r: number
  g: number
  b: number
}

function sampleCorners(data: Uint8ClampedArray, w: number, h: number): RGB {
  const pts: Array<[number, number]> = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ]
  let r = 0
  let g = 0
  let b = 0
  for (const [x, y] of pts) {
    const i = (y * w + x) * 4
    r += data[i] ?? 0
    g += data[i + 1] ?? 0
    b += data[i + 2] ?? 0
  }
  return { r: r / pts.length, g: g / pts.length, b: b / pts.length }
}

function dist(data: Uint8ClampedArray, i: number, bg: RGB): number {
  const dr = (data[i] ?? 0) - bg.r
  const dg = (data[i + 1] ?? 0) - bg.g
  const db = (data[i + 2] ?? 0) - bg.b
  // 用欧氏距离的近似（不开方，比较时配平方阈值）
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

/**
 * 抠图主入口。输入图像 data URL，返回透明底 PNG 的 data URL。
 * 失败（无法加载/无 canvas）时返回原图，绝不抛错打断生成流程。
 */
export async function cutoutToTransparent(
  srcDataUrl: string,
  opts: CutoutOptions = {},
): Promise<string> {
  const tolerance = opts.tolerance ?? 42
  const feather = opts.feather ?? 1
  try {
    const img = await loadImage(srcDataUrl)
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    if (!w || !h) return srcDataUrl
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return srcDataUrl
    ctx.drawImage(img, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data
    const bg = sampleCorners(data, w, h)

    // 边缘洪泛：从四条边的每个像素入队，BFS 把连通的背景像素 alpha=0。
    const visited = new Uint8Array(w * h)
    const queue: number[] = []
    const pushIfBg = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= w || y >= h) return
      const p = y * w + x
      if (visited[p]) return
      visited[p] = 1
      if (dist(data, p * 4, bg) <= tolerance) {
        data[p * 4 + 3] = 0
        queue.push(p)
      }
    }
    for (let x = 0; x < w; x++) {
      pushIfBg(x, 0)
      pushIfBg(x, h - 1)
    }
    for (let y = 0; y < h; y++) {
      pushIfBg(0, y)
      pushIfBg(w - 1, y)
    }
    while (queue.length) {
      const p = queue.pop() as number
      const x = p % w
      const y = (p / w) | 0
      pushIfBg(x - 1, y)
      pushIfBg(x + 1, y)
      pushIfBg(x, y - 1)
      pushIfBg(x, y + 1)
    }

    // 羽化：对仍不透明、但紧邻透明像素的边缘像素降一点 alpha，减轻硬锯齿。
    if (feather > 0) {
      const copy = new Uint8ClampedArray(data)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = (y * w + x) * 4
          if (copy[p + 3] === 0) continue
          let near = false
          for (let dy = -feather; dy <= feather && !near; dy++) {
            for (let dx = -feather; dx <= feather; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
              if (copy[(ny * w + nx) * 4 + 3] === 0) {
                near = true
                break
              }
            }
          }
          if (near) data[p + 3] = Math.min(data[p + 3] ?? 255, 150)
        }
      }
    }

    ctx.putImageData(imageData, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return srcDataUrl
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}
