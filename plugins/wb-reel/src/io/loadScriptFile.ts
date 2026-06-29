/**
 * loadScriptFile —— IdeaForge「贴剧本」模式的文件读取器
 *
 * 职责（仅此一项）：把作者拖入 / 上传的剧本文件读成纯字符串，
 * 并做"够小、不空、扩展名合法"三道前置校验。
 *
 * 支持格式：
 *   - .md / .markdown / .txt：直接读文本（UTF-8）
 *   - .docx：用 mammoth 提取纯文本（保留段落，丢样式）
 *
 * 大小上限 SCRIPT_MAX_BYTES = 2 MB（docx 解压后段落较多，比 md 略宽松）。
 *
 * **不**做的事：
 *   - 不解析 markdown / front-matter（让 LLM 自己识别结构）
 *   - 不裁剪长度（裁剪由 chunkPlanner / forgeScenarioFromScript 决定）
 *   - 不持久化（File API 一次性读完即丢）
 *
 * 错误模型：所有失败路径都抛 LoadScriptError，带稳定 code 让 UI 展示中文信息。
 */

import mammoth from 'mammoth'

export const SCRIPT_MAX_BYTES = 2 * 1024 * 1024

/**
 * 允许的扩展名 —— 顺序也是声明顺序，UI 错误信息按这个顺序拼接。
 *
 * 历史上 .docx 被拒绝过，本版本起把它纳入第一档支持（后端走 mammoth 解析）。
 * .pdf / .doc / .pages / .rtf 暂不支持，错误信息会引导作者另存为 md 或 txt。
 */
export const SCRIPT_ALLOWED_EXTENSIONS = ['.md', '.markdown', '.txt', '.docx'] as const
export type ScriptExtension = (typeof SCRIPT_ALLOWED_EXTENSIONS)[number]

export type LoadScriptErrorCode =
  | 'bad-extension'
  | 'too-large'
  | 'empty'
  | 'read-failed'
  | 'docx-parse-failed'

export class LoadScriptError extends Error {
  public readonly code: LoadScriptErrorCode

  constructor(code: LoadScriptErrorCode, message: string) {
    super(message)
    this.name = 'LoadScriptError'
    this.code = code
    Object.setPrototypeOf(this, LoadScriptError.prototype)
  }
}

export interface LoadScriptResult {
  /** 去除 BOM 后的剧本原文（保留所有换行/空白结构，让 LLM 看到节拍） */
  content: string
  filename: string
  /** 原始文件字节数（含 BOM，用于 UI 展示「N KB」） */
  bytes: number
  /** 文件来源类型，便于上层调试 / 显示 */
  sourceKind: 'text' | 'docx'
}

/**
 * 从 File 对象读取剧本文本。
 *
 * 校验顺序刻意按代价从低到高排：
 *   1. 扩展名（同步）
 *   2. 大小（同步）
 *   3. 实际读内容（异步 IO；docx 还要走 mammoth 解析）
 *   4. 去 BOM + 空白校验
 */
export async function loadScriptFile(file: File): Promise<LoadScriptResult> {
  const filename = file.name
  const ext = matchExtension(filename)
  if (!ext) {
    const lower = filename.toLowerCase()
    if (
      lower.endsWith('.doc') ||
      lower.endsWith('.pages') ||
      lower.endsWith('.rtf') ||
      lower.endsWith('.pdf')
    ) {
      throw new LoadScriptError(
        'bad-extension',
        `当前不支持 ${filename} —— 请用 Word/Pages 另存为「.md」「.txt」或「.docx」后再上传。\n（也可以直接复制全文粘贴到上方输入框，效果完全一样）`,
      )
    }
    throw new LoadScriptError(
      'bad-extension',
      `不支持的剧本扩展名 · ${filename}（仅支持 ${SCRIPT_ALLOWED_EXTENSIONS.join(' / ')}）`,
    )
  }

  if (file.size > SCRIPT_MAX_BYTES) {
    throw new LoadScriptError(
      'too-large',
      `剧本文件过大 · ${formatBytes(file.size)}（上限 ${formatBytes(SCRIPT_MAX_BYTES)}）`,
    )
  }

  let content: string
  if (ext === '.docx') {
    content = await readDocx(file)
  } else {
    content = await readText(file)
  }

  content = stripBom(content)
  if (content.trim().length === 0) {
    throw new LoadScriptError('empty', '剧本内容为空（或仅含空白字符）')
  }

  return {
    content,
    filename,
    bytes: file.size,
    sourceKind: ext === '.docx' ? 'docx' : 'text',
  }
}

async function readText(file: File): Promise<string> {
  try {
    return await file.text()
  } catch (e) {
    throw new LoadScriptError(
      'read-failed',
      `读取文件失败 · ${(e as Error).message}`,
    )
  }
}

/**
 * 读 .docx 并提取纯文本。
 *
 * mammoth.extractRawText 把段落用 \n\n 分隔，列表项 / 表格行用 \n。
 * 我们对它不做二次结构化处理 —— 让下游 chunkPlanner / structurer 像处理
 * markdown 一样按段落语义切分即可。
 */
async function readDocx(file: File): Promise<string> {
  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch (e) {
    throw new LoadScriptError(
      'read-failed',
      `读取 docx 文件失败 · ${(e as Error).message}`,
    )
  }
  try {
    // mammoth 的入口在浏览器和 node 下接受不同 input 形态：
    //   - 浏览器版（vite browser 字段会替换 unzip）认 { arrayBuffer }
    //   - node 版只认 { buffer }
    // 这里两手都给，让运行环境自己挑能用的；任意一个被 mammoth 接住即可。
    const input = makeMammothInput(buffer)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await mammoth.extractRawText(input as any)
    return typeof result.value === 'string' ? result.value : ''
  } catch (e) {
    throw new LoadScriptError(
      'docx-parse-failed',
      `docx 解析失败（文件可能损坏或受密码保护）· ${(e as Error).message}\n建议用 Word 另存为 .md / .txt 后再上传，或直接复制全文粘贴。`,
    )
  }
}

/**
 * 构造同时满足浏览器版 mammoth（{ arrayBuffer }）和 node 版 mammoth（{ buffer }）的输入。
 *
 * 在 Vite 浏览器构建里，mammoth 的 unzip 模块被 browser 字段重定向到只读 arrayBuffer
 * 的版本；在 vitest（node）里则需要 Node Buffer。
 *
 * 我们都给，多一个无关字段对两边都安全。
 */
function makeMammothInput(arrayBuffer: ArrayBuffer): {
  arrayBuffer: ArrayBuffer
  buffer?: unknown
} {
  const out: { arrayBuffer: ArrayBuffer; buffer?: unknown } = { arrayBuffer }
  // 仅在 node 环境（globalThis.Buffer 存在）下挂 buffer 字段。
  // 浏览器没有 Buffer，硬塞会报 ReferenceError。
  const g = globalThis as unknown as { Buffer?: { from: (b: ArrayBuffer) => unknown } }
  if (typeof g.Buffer?.from === 'function') {
    try {
      out.buffer = g.Buffer.from(arrayBuffer)
    } catch {
      // ignore — 留 arrayBuffer 给浏览器版即可
    }
  }
  return out
}

function matchExtension(filename: string): ScriptExtension | null {
  const lower = filename.toLowerCase()
  for (const ext of SCRIPT_ALLOWED_EXTENSIONS) {
    if (lower.endsWith(ext)) return ext
  }
  return null
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}
