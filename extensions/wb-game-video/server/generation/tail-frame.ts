/**
 * 服务端视频尾帧提取。
 *
 * wb-reel 在浏览器里用 HTMLVideoElement + canvas；wb-game-video 的生成编排运行在
 * forgeax-server 进程中，因此这里用无 shell 的 ffmpeg 子进程读取已经落盘的成片。
 * 抽帧失败必须向上抛错：续接段不能在没有真实尾帧时仅靠 prompt 假装连续。
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

export interface TailFrameResult {
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
}

export type TailFrameExtractor = (videoPath: string) => Promise<TailFrameResult>
export type TailFrameAvailabilityCheck = () => Promise<void>

const MAX_STDERR_CHARS = 4_000
const DEFAULT_TIMEOUT_MS = 30_000

function ffmpegError(command: string, code: number | null, stderr: string): Error {
  const detail = stderr.trim().slice(-MAX_STDERR_CHARS)
  return new Error(
    `真实尾帧提取失败：${command} 退出码 ${code ?? 'unknown'}${detail ? ` · ${detail}` : ''}`,
  )
}

async function runFfmpeg(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolvePromise()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(`真实尾帧提取超时（>${timeoutMs}ms）`))
    }, timeoutMs)

    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_STDERR_CHARS)
    })
    child.once('error', (error) => {
      const message = (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? `找不到 ffmpeg。生成多段连续视频需要服务端 PATH 中可执行的 ffmpeg。`
        : `无法启动 ffmpeg：${error.message}`
      finish(new Error(message, { cause: error }))
    })
    child.once('close', (code) => {
      if (code === 0) finish()
      else finish(ffmpegError(command, code, stderr))
    })
  })
}

/** 从视频结尾前 100ms 取一帧，避开容器尾部黑帧及过短 seek 窗口无法解码。 */
export async function extractVideoTailFrame(
  videoPath: string,
  options: { ffmpegPath?: string; timeoutMs?: number } = {},
): Promise<TailFrameResult> {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'wb-game-video-tail-'))
  const outputPath = resolve(tempDir, 'tail.jpg')
  try {
    await runFfmpeg(
      options.ffmpegPath ?? 'ffmpeg',
      [
        '-hide_banner',
        '-loglevel', 'error',
        '-sseof', '-0.10',
        '-i', videoPath,
        '-map', '0:v:0',
        '-frames:v', '1',
        '-pix_fmt', 'yuvj420p',
        '-q:v', '2',
        '-update', '1',
        '-y',
        outputPath,
      ],
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
    if (statSync(outputPath).size === 0) {
      throw new Error('真实尾帧提取失败：ffmpeg 没有产出图像')
    }
    return { bytes: new Uint8Array(readFileSync(outputPath)), mime: 'image/jpeg' }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

/** Fail before the first paid segment when local tail-frame continuity is unavailable. */
export async function assertVideoTailFrameExtractionAvailable(
  options: { ffmpegPath?: string; timeoutMs?: number } = {},
): Promise<void> {
  try {
    await runFfmpeg(
      options.ffmpegPath ?? 'ffmpeg',
      ['-hide_banner', '-version'],
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      `当前 provider 不支持原生视频续接，且本地尾帧提取不可用：${detail}`,
      { cause: error },
    )
  }
}
