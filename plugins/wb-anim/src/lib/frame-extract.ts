// @source wb-character/src/lib/frame-extract.ts
export interface FrameData {
  dataUrl: string
  index: number
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
 * Extract frames from a video URL using hidden video+canvas seek-capture.
 */
export async function extractFrames(
  videoUrl: string,
  fps = 12,
  onProgress?: (current: number, total: number) => void,
): Promise<FrameData[]> {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = videoUrl

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('Video load failed'))
  })

  await new Promise<void>((resolve) => {
    if (video.readyState >= 4) return resolve()
    video.oncanplaythrough = () => resolve()
    setTimeout(resolve, 10_000)
  })

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const duration = video.duration
  const totalFrames = Math.max(1, Math.floor(duration * fps))
  const frames: FrameData[] = []

  for (let i = 0; i < totalFrames; i++) {
    const t = Math.min(i / fps, duration - 0.001)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 5_000)
      video.onseeked = () => {
        clearTimeout(timeout)
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0)
        frames.push({ dataUrl: canvas.toDataURL('image/png'), index: i })
        onProgress?.(i + 1, totalFrames)
        resolve()
      }
      video.currentTime = t
    })
  }

  video.src = ''
  return frames
}

/**
 * Compose frames into a single spritesheet PNG (grid layout).
 */
export async function composeSpriteSheet(
  frames: FrameData[],
  columns?: number,
): Promise<string> {
  if (frames.length === 0) throw new Error('No frames')

  const first = await loadImage(frames[0].dataUrl)
  const fw = first.width
  const fh = first.height
  const cols = columns ?? Math.ceil(Math.sqrt(frames.length))
  const rows = Math.ceil(frames.length / cols)

  const canvas = document.createElement('canvas')
  canvas.width = cols * fw
  canvas.height = rows * fh
  const ctx = canvas.getContext('2d')!

  const images = await Promise.all(frames.map((f) => loadImage(f.dataUrl)))
  images.forEach((img, i) => {
    ctx.drawImage(img, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh)
  })

  return canvas.toDataURL('image/png')
}

function loadGifJs(): Promise<any> {
  return new Promise((resolve, reject) => {
    if ((window as any).GIF) return resolve((window as any).GIF)
    const script = document.createElement('script')
    script.src = '/gif.js'
    script.onload = () => resolve((window as any).GIF)
    script.onerror = () => reject(new Error('Failed to load gif.js'))
    document.head.appendChild(script)
  })
}

/**
 * Export frames as an animated GIF using gif.js Web Worker.
 */
export async function exportGif(
  frames: FrameData[],
  fps = 12,
): Promise<Blob> {
  if (frames.length === 0) throw new Error('No frames')

  const GIF = await loadGifJs()
  const first = await loadImage(frames[0].dataUrl)
  const w = first.width
  const h = first.height
  const delay = Math.round(1000 / fps)

  const gif = new GIF({
    workers: 2,
    quality: 10,
    width: w,
    height: h,
    workerScript: '/gif.worker.js',
  })

  for (const frame of frames) {
    const img = await loadImage(frame.dataUrl)
    const offscreen = document.createElement('canvas')
    offscreen.width = w
    offscreen.height = h
    offscreen.getContext('2d')!.drawImage(img, 0, 0, w, h)
    gif.addFrame(offscreen, { delay, copy: true })
  }

  return new Promise<Blob>((resolve, reject) => {
    gif.on('finished', (blob: Blob) => resolve(blob))
    gif.on('error', (err: Error) => reject(err))
    gif.render()
  })
}

/**
 * Export frames as a ZIP of numbered PNGs.
 */
export async function exportPngZip(frames: FrameData[]): Promise<Blob> {
  if (frames.length === 0) throw new Error('No frames')

  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  const folder = zip.folder(`sprite_sequence_${Date.now()}`)!

  frames.forEach((frame, idx) => {
    const base64 = frame.dataUrl.split(',')[1]
    const fileName = `frame_${String(idx + 1).padStart(3, '0')}.png`
    folder.file(fileName, base64, { base64: true })
  })

  return zip.generateAsync({ type: 'blob' })
}

/**
 * Client-side background removal using flood-fill from corners.
 * Samples the dominant background color from the four corners, then
 * flood-fills all connected similar-color regions starting from edges.
 * Much better than simple white-threshold for non-white backgrounds.
 */
export async function removeBackgroundCanvas(dataUrl: string): Promise<string> {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  const w = img.width
  const h = img.height
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, w, h)
  const d = imageData.data
  const visited = new Uint8Array(w * h)

  const colorAt = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return [d[i], d[i + 1], d[i + 2]]
  }

  const sampleCorners = () => {
    const s = 4
    const corners: number[][] = []
    for (let dy = 0; dy < s; dy++)
      for (let dx = 0; dx < s; dx++) {
        corners.push(colorAt(dx, dy))
        corners.push(colorAt(w - 1 - dx, dy))
        corners.push(colorAt(dx, h - 1 - dy))
        corners.push(colorAt(w - 1 - dx, h - 1 - dy))
      }
    const avg = [0, 0, 0]
    for (const c of corners) { avg[0] += c[0]; avg[1] += c[1]; avg[2] += c[2] }
    const n = corners.length
    return [Math.round(avg[0] / n), Math.round(avg[1] / n), Math.round(avg[2] / n)]
  }

  const bgColor = sampleCorners()
  const tolerance = 45

  const isBg = (x: number, y: number) => {
    const i = (y * w + x) * 4
    return (
      Math.abs(d[i] - bgColor[0]) < tolerance &&
      Math.abs(d[i + 1] - bgColor[1]) < tolerance &&
      Math.abs(d[i + 2] - bgColor[2]) < tolerance
    )
  }

  const queue: number[] = []
  const enqueue = (x: number, y: number) => {
    const idx = y * w + x
    if (x >= 0 && x < w && y >= 0 && y < h && !visited[idx] && isBg(x, y)) {
      visited[idx] = 1
      queue.push(x, y)
    }
  }

  for (let x = 0; x < w; x++) { enqueue(x, 0); enqueue(x, h - 1) }
  for (let y = 0; y < h; y++) { enqueue(0, y); enqueue(w - 1, y) }

  while (queue.length > 0) {
    const cy = queue.pop()!
    const cx = queue.pop()!
    enqueue(cx - 1, cy)
    enqueue(cx + 1, cy)
    enqueue(cx, cy - 1)
    enqueue(cx, cy + 1)
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (visited[y * w + x]) {
        d[(y * w + x) * 4 + 3] = 0
      }
    }
  }

  // Soften edges: semi-transparent pixels at the boundary
  const edgeData = new Uint8Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x
      if (!visited[idx]) {
        const neighbors = [
          visited[idx - 1], visited[idx + 1],
          visited[idx - w], visited[idx + w],
        ]
        const bgCount = neighbors.reduce((a, b) => a + b, 0)
        if (bgCount > 0) edgeData[idx] = bgCount
      }
    }
  }
  for (let i = 0; i < edgeData.length; i++) {
    if (edgeData[i] > 0) {
      d[i * 4 + 3] = Math.round(d[i * 4 + 3] * (1 - edgeData[i] * 0.2))
    }
  }

  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}
