/**
 * llmAuditLog —— LLM 调用审计日志（v3.8 新增）
 *
 * 目的：
 *   所有 LLM 调用（text / image / video）落一条 JSONL 记录到
 *   `.reel-scenarios/audit/<date>.jsonl`，方便作者出错后查：
 *     - 用了哪个模型 / provider / 传了什么 prompt
 *     - 耗时多久 / token / 报错原文
 *     - 关联到哪个 scenarioId / sceneId / shotId
 *
 * 架构：
 *   1) 本文件只定义 **格式 + 纯函数**（buildAuditRecord）
 *   2) 落盘由**调用方负责**（通常走 vite plugin route `/__reel_audit__`
 *      或 Node 端直接 writeFile；浏览器端 fetch 到 dev server）
 *   3) 不强制调用 —— 业务层自己决定哪些 call 要审计
 *
 * 为什么不自动 wrap 所有 TextClient？
 *   - wrapping 会让调用栈失真、错误吞并，调试更痛
 *   - 显式调用 `logAudit(...)` 让"我们要记什么"变成设计决策而非魔法
 */

export type AuditKind = 'text' | 'image' | 'video' | 'plan' | 'continuity'

export interface AuditRecord {
  /** ISO8601，创建时间 */
  at: string
  /** LLM 调用类别 */
  kind: AuditKind
  /** provider 名（如 'azure-openai' / 'anthropic' / 'seedance-doubao'） */
  provider: string
  /** 具体 model id（如 'claude-opus-4-6'） */
  model: string
  /** 调用场景定位 —— scenario / scene / shot 三级 id，按需填 */
  context: {
    scenarioId?: string
    sceneId?: string
    shotId?: string
    segmentId?: string
    /** 自定义 tag，如 'storyboard' / 'kineticVideo' / 'continuity-decision' */
    stage?: string
  }
  /** 成功/失败 */
  status: 'ok' | 'fail'
  /** 调用耗时毫秒 */
  durationMs: number
  /**
   * 请求摘要 —— 不存完整请求（prompt 可能很长且包含敏感），
   * 存摘要（systemPromptLen / userPromptLen / hash）便于排错但不膨胀磁盘
   */
  request: AuditRequestSummary
  /**
   * 响应摘要 —— 成功时存长度 + 前 200 字；失败时存错误消息
   */
  response: AuditResponseSummary
}

export interface AuditRequestSummary {
  systemPromptLen?: number
  userPromptLen?: number
  /** 前 200 字 preview，帮助肉眼辨认是哪次调用 */
  userPromptPreview?: string
  temperature?: number
  maxTokens?: number
  jsonMode?: boolean
  /** 图/视频调用的尺寸 / 时长 */
  size?: string
  durationSec?: number
  referenceImage?: boolean
}

export interface AuditResponseSummary {
  textLen?: number
  textPreview?: string
  warnings?: string[]
  error?: string
}

/**
 * 把输入包装成一条 AuditRecord（纯函数，可单测）。
 *
 * preview 默认截到 200 字。调用方传更长的 preview（比如完整 prompt）也可以，
 * 但建议不要——这个文件会**按天追加**，体积增长敏感。
 */
export function buildAuditRecord(args: {
  kind: AuditKind
  provider: string
  model: string
  context?: AuditRecord['context']
  status: 'ok' | 'fail'
  durationMs: number
  request?: AuditRequestSummary
  response?: AuditResponseSummary
  now?: Date
}): AuditRecord {
  const now = args.now ?? new Date()
  return {
    at: now.toISOString(),
    kind: args.kind,
    provider: args.provider,
    model: args.model,
    context: args.context ?? {},
    status: args.status,
    durationMs: Math.max(0, Math.round(args.durationMs)),
    request: {
      ...(args.request ?? {}),
      userPromptPreview: truncPreview(args.request?.userPromptPreview),
    },
    response: {
      ...(args.response ?? {}),
      textPreview: truncPreview(args.response?.textPreview),
    },
  }
}

/**
 * 序列化为 JSONL 行（末尾带 \n）。便于直接 append 到 .jsonl 文件。
 */
export function serializeAuditLine(rec: AuditRecord): string {
  return JSON.stringify(rec) + '\n'
}

/**
 * 默认审计文件名 —— 按天切，方便肉眼翻。
 * 例："2026-05-07.jsonl"
 */
export function defaultAuditFileName(d?: Date): string {
  const dd = d ?? new Date()
  const y = dd.getFullYear()
  const m = String(dd.getMonth() + 1).padStart(2, '0')
  const day = String(dd.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}.jsonl`
}

const PREVIEW_MAX = 200
function truncPreview(s?: string): string | undefined {
  if (!s) return undefined
  if (s.length <= PREVIEW_MAX) return s
  return s.slice(0, PREVIEW_MAX - 1) + '…'
}

/**
 * 浏览器适配器 —— 通过 fetch 把审计条发给 vite dev server。
 *
 * **当前版本**：没有真正的审计 server route，这里只做**本地 console + localStorage 环缓冲**
 * （保留最近 200 条以便开发者在 devtools 中肉眼查）。
 * 后续 vite plugin 落盘时，把这里换成 fetch('/__reel_audit__', {...}) 即可。
 */
export function createBrowserAuditSink(opts: { capacity?: number; storageKey?: string } = {}): (rec: AuditRecord) => void {
  const cap = Math.max(10, opts.capacity ?? 200)
  const key = opts.storageKey ?? '__reel_audit_buffer__'

  return (rec) => {
    try {
      // 控制台：方便开发时肉眼看
      if (typeof console !== 'undefined' && console.info) {
        console.info(`[reel-audit] ${rec.kind} ${rec.provider}/${rec.model} ${rec.status} ${rec.durationMs}ms`)
      }
      if (typeof localStorage === 'undefined') return
      const raw = localStorage.getItem(key)
      const buf: AuditRecord[] = raw ? JSON.parse(raw) : []
      buf.push(rec)
      while (buf.length > cap) buf.shift()
      localStorage.setItem(key, JSON.stringify(buf))
    } catch {
      // 审计不该影响业务，吞异常
    }
  }
}

/**
 * 读回本地缓冲（UI 的"后台查"页面用）。
 * 返回空数组 = 没有记录 / 无 localStorage。
 */
export function readBrowserAuditBuffer(storageKey = '__reel_audit_buffer__'): AuditRecord[] {
  try {
    if (typeof localStorage === 'undefined') return []
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
