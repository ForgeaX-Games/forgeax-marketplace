import { readFileSync } from 'node:fs'

type Caller = {
  kind: 'user' | 'ai' | 'skill' | 'workbench' | 'cli'
  sessionId?: string
  threadId?: string
  agentId?: string
}

type ToolCtx = {
  caller: Caller
  toolId: string
  env: Record<string, string | undefined>
  cwd: string
}

type ToolHandler = (args: unknown, ctx: ToolCtx) => Promise<unknown>

const PLUGIN_ID = '@forgeax-plugin/wb-3d-lowpoly'
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:9567'

function objectArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`missing string arg: ${key}`)
  }
  return value
}

function backendUrlFromOverrides(file: string | undefined): string | null {
  if (!file) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as {
      plugins?: Record<string, { backendPort?: unknown }>
    }
    const port = parsed.plugins?.[PLUGIN_ID]?.backendPort
    if (Number.isInteger(port) && Number(port) > 0 && Number(port) <= 65535) {
      return `http://127.0.0.1:${Number(port)}`
    }
  } catch {
    return null
  }
  return null
}

function backendBaseUrl(ctx: ToolCtx): string {
  const explicit = ctx.env.FORGEAX_LOWPOLY_BACKEND_URL
  if (explicit?.trim()) return explicit.replace(/\/+$/u, '')
  return backendUrlFromOverrides(ctx.env.FORGEAX_PLUGIN_DEV_PORTS_FILE) ?? DEFAULT_BACKEND_URL
}

function lowpolyCallerHeaders(ctx: ToolCtx, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'x-forgeax-caller-kind': ctx.caller.kind }
  if (hasBody) headers['content-type'] = 'application/json'
  if (ctx.caller.agentId) headers['x-forgeax-caller-agent-id'] = ctx.caller.agentId
  if (ctx.caller.sessionId) headers['x-forgeax-caller-session-id'] = ctx.caller.sessionId
  return headers
}

async function lowpolyRawFetch(
  ctx: ToolCtx,
  method: string,
  path: string,
  body: unknown,
): Promise<{ res: Response; payload: unknown; text: string }> {
  const res = await fetch(`${backendBaseUrl(ctx)}${path}`, {
    method,
    headers: lowpolyCallerHeaders(ctx, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  // A non-2xx response (or a proxy in front of the backend) may return a non-JSON
  // body — an HTML error page, plain text, etc. Guard the parse so that surfaces
  // as a null payload (the raw `text` still feeds the error message below) instead
  // of throwing and masking the real status.
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text) as unknown
    } catch {
      payload = null
    }
  }
  return { res, payload, text }
}

async function request(ctx: ToolCtx, method: string, path: string, body?: unknown): Promise<unknown> {
  let { res, payload, text } = await lowpolyRawFetch(ctx, method, path, body)

  // Transparent lock recovery after a backend restart wipes the in-memory lock
  // table: an AI mutation gets 403 `mutation-denied-not-open` (recoverable). Re-
  // `open` the active project once and replay. Genuine conflicts
  // (`mutation-denied-locked-by-other`) are NOT retried.
  if (res.status === 403 && ctx.caller.kind === 'ai' && ctx.caller.agentId) {
    const p = (payload ?? {}) as { code?: unknown; projectId?: unknown }
    if (p.code === 'mutation-denied-not-open' && typeof p.projectId === 'string' && p.projectId) {
      const reopen = await lowpolyRawFetch(
        ctx,
        'POST',
        `/api/v1/projects/${encodeURIComponent(p.projectId)}/activate`,
        {},
      )
      if (reopen.res.ok) {
        ;({ res, payload, text } = await lowpolyRawFetch(ctx, method, path, body))
      }
    }
  }

  if (!res.ok) {
    const reason =
      payload && typeof payload === 'object' && 'reason' in payload
        ? String((payload as { reason?: unknown }).reason)
        : text || `${res.status} ${res.statusText}`
    throw new Error(`lowpoly backend ${method} ${path} failed: ${reason}`)
  }
  return payload
}

function query(params: Record<string, unknown>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) qs.set(key, String(value))
  }
  const out = qs.toString()
  return out ? `?${out}` : ''
}

// `/api/v1/ops` may attach inline-image fields (battery `iconSvg`, preview
// thumbnails, data: URIs). The host tool bridge mis-reads ANY such string as an
// image content part and drops the rest of the (text) payload, so an agent
// calling `batteries.list` gets a blank / garbled result. Defensively strip
// every value that looks like inline image markup — agents only ever need
// ports / params, never pixels — so the op catalog is always clean text.
const INLINE_IMAGE_KEYS = new Set(['iconSvg', 'icon', 'iconPng', 'preview', 'thumbnail', 'thumbnailSvg'])

function looksLikeInlineImage(value: string): boolean {
  const head = value.trimStart().slice(0, 24).toLowerCase()
  return head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('data:image')
}

function stripInlineImages(value: unknown): unknown {
  if (typeof value === 'string') return looksLikeInlineImage(value) ? undefined : value
  if (Array.isArray(value)) return value.map(stripInlineImages).filter((v) => v !== undefined)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (INLINE_IMAGE_KEYS.has(key)) continue
      const cleaned = stripInlineImages(val)
      if (cleaned !== undefined) out[key] = cleaned
    }
    return out
  }
  return value
}

export function stripBatteryIcon(op: Record<string, unknown>): Record<string, unknown> {
  return stripInlineImages(op) as Record<string, unknown>
}

export const tools: Record<string, ToolHandler> = {
  'lowpoly:projects.list': async (_args, ctx) => request(ctx, 'GET', '/api/v1/projects'),
  'lowpoly:projects.create': async (args, ctx) => request(ctx, 'POST', '/api/v1/projects', objectArgs(args)),
  'lowpoly:projects.open': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/activate`, {})
  },
  'lowpoly:projects.remove': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    return request(ctx, 'DELETE', `/api/v1/projects/${encodeURIComponent(id)}${query({ assetPolicy: body.assetPolicy })}`)
  },
  'lowpoly:projects.close': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/close`, {})
  },
  'lowpoly:batteries.list': async (_args, ctx) => {
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    return Array.isArray(ops) ? ops.map(stripBatteryIcon) : ops
  },
  'lowpoly:batteries.get': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    const op = ops.find((candidate) => candidate.id === id)
    if (!op) throw new Error(`lowpoly battery not found: ${id}`)
    return stripBatteryIcon(op)
  },
  'lowpoly:pipeline.get': async (_args, ctx) => request(ctx, 'GET', '/api/v1/pipeline'),
  'lowpoly:pipeline.applyBatch': async (args, ctx) => request(ctx, 'POST', '/api/v1/batch', objectArgs(args)),
  // Defaults to the backend summary route (status + per-port shape notes), never
  // raw mesh buffers. Pass `nodeId` to run only that node's downstream closure
  // (incremental — the editor's hot-update path; upstream hydrated from cache).
  // Escape hatch `raw: true` returns the full result (Tier-4 spill guards size).
  'lowpoly:pipeline.execute': async (args, ctx) => {
    const body = objectArgs(args)
    const forward: Record<string, unknown> = {}
    if (typeof body.nodeId === 'string') forward.nodeId = body.nodeId
    const path = body.raw === true ? '/api/v1/execute' : '/api/v1/execute/summary'
    return request(ctx, 'POST', path, forward)
  },
  'lowpoly:pipeline.import': async (args, ctx) => request(ctx, 'POST', '/api/v1/pipeline/import', objectArgs(args)),
  'lowpoly:pipeline.export': async (args, ctx) => request(ctx, 'POST', '/api/v1/pipeline/export', objectArgs(args)),
  'lowpoly:assets.list': async (args, ctx) => request(ctx, 'GET', `/api/v1/assets${query(objectArgs(args))}`),
  'lowpoly:screenshot.capture': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/screenshot/capture', objectArgs(args)),
  'lowpoly:screenshot.latest': async (_args, ctx) => request(ctx, 'GET', '/api/v1/agent/screenshot/latest'),
  'lowpoly:screenshot.store': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/screenshot/store', objectArgs(args)),
  'lowpoly:export-glb': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/glb/export', objectArgs(args)),
}

export default tools
