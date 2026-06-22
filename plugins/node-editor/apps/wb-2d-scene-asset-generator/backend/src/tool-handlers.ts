import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

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

const PLUGIN_ID = '@forgeax-plugin/wb-2d-scene-asset-generator'
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
  const explicit = ctx.env.FORGEAX_ASSET2D_BACKEND_URL
  if (explicit?.trim()) return explicit.replace(/\/+$/u, '')
  return backendUrlFromOverrides(ctx.env.FORGEAX_PLUGIN_DEV_PORTS_FILE) ?? DEFAULT_BACKEND_URL
}

function callerHeaders(ctx: ToolCtx, hasBody: boolean): Record<string, string> {
  // Forward the caller identity so the backend can enforce the per-agent project
  // lock (open-then-operate). Humans (UI) call the REST API directly without
  // these headers and are never locked.
  const headers: Record<string, string> = { 'x-forgeax-caller-kind': ctx.caller.kind }
  if (hasBody) headers['content-type'] = 'application/json'
  if (ctx.caller.agentId) headers['x-forgeax-caller-agent-id'] = ctx.caller.agentId
  if (ctx.caller.sessionId) headers['x-forgeax-caller-session-id'] = ctx.caller.sessionId
  return headers
}

async function rawFetch(
  ctx: ToolCtx,
  method: string,
  path: string,
  body: unknown,
): Promise<{ res: Response; payload: unknown; text: string }> {
  const res = await fetch(`${backendBaseUrl(ctx)}${path}`, {
    method,
    headers: callerHeaders(ctx, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const payload = text ? (JSON.parse(text) as unknown) : null
  return { res, payload, text }
}

async function request(ctx: ToolCtx, method: string, path: string, body?: unknown): Promise<unknown> {
  let { res, payload, text } = await rawFetch(ctx, method, path, body)

  // Transparent lock recovery: a backend restart wipes the in-memory project
  // lock table, so an AI caller's next mutation gets HTTP 403 with the
  // RECOVERABLE code `mutation-denied-not-open`. Re-`open` (re-acquire) the
  // active project once and replay the original request — the agent never sees
  // the restart. We do NOT retry `mutation-denied-locked-by-other` (a genuine
  // conflict held by a different agent) — that surfaces as before.
  if (res.status === 403 && ctx.caller.kind === 'ai' && ctx.caller.agentId) {
    const p = (payload ?? {}) as { code?: unknown; projectId?: unknown }
    if (p.code === 'mutation-denied-not-open' && typeof p.projectId === 'string' && p.projectId) {
      const reopen = await rawFetch(
        ctx,
        'POST',
        `/api/v1/projects/${encodeURIComponent(p.projectId)}/activate`,
        {},
      )
      if (reopen.res.ok) {
        ;({ res, payload, text } = await rawFetch(ctx, method, path, body))
      }
    }
  }

  if (!res.ok) {
    const reason =
      payload && typeof payload === 'object' && 'reason' in payload
        ? String((payload as { reason?: unknown }).reason)
        : payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : text || `${res.status} ${res.statusText}`
    throw new Error(`asset2d backend ${method} ${path} failed: ${reason}`)
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

// `/api/v1/ops` attaches each battery's inline `icon.svg` as `iconSvg`, and a
// battery could expose other inline-image fields too (preview thumbnails, data:
// URIs, …). The host tool bridge mis-reads ANY such string as an image content
// part and drops the rest of the (text) payload, so an agent calling
// `batteries.list` gets a blank / garbled result. Defensively strip every value
// that looks like inline image markup — agents only ever need ports / params,
// never pixels — so the op catalog is always clean, parseable text.
const INLINE_IMAGE_KEYS = new Set(['iconSvg', 'icon', 'preview', 'thumbnail', 'thumbnailSvg'])

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

function mimeExt(mimeType: unknown): string {
  if (typeof mimeType !== 'string') return 'bin'
  if (mimeType.includes('png')) return 'png'
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg'
  if (mimeType.includes('webp')) return 'webp'
  if (mimeType.includes('gif')) return 'gif'
  if (mimeType.includes('svg')) return 'svg'
  return 'bin'
}

export const tools: Record<string, ToolHandler> = {
  'asset2d:projects.list': async (_args, ctx) => request(ctx, 'GET', '/api/v1/projects'),
  'asset2d:projects.create': async (args, ctx) => request(ctx, 'POST', '/api/v1/projects', objectArgs(args)),
  'asset2d:projects.open': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/activate`, {})
  },
  'asset2d:projects.close': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/close`, {})
  },
  'asset2d:projects.remove': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    return request(ctx, 'DELETE', `/api/v1/projects/${encodeURIComponent(id)}${query({ assetPolicy: body.assetPolicy })}`)
  },
  'asset2d:batteries.list': async (_args, ctx) => {
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    return Array.isArray(ops) ? ops.map(stripBatteryIcon) : ops
  },
  'asset2d:batteries.get': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    const op = ops.find((candidate) => candidate.id === id)
    if (!op) throw new Error(`asset2d battery not found: ${id}`)
    return stripBatteryIcon(op)
  },
  'asset2d:pipeline.get': async (_args, ctx) => request(ctx, 'GET', '/api/v1/pipeline'),
  'asset2d:pipeline.applyBatch': async (args, ctx) => request(ctx, 'POST', '/api/v1/batch', objectArgs(args)),
  // By default we hit the backend's summary route, which projects the result to a
  // KB-scale summary (status + per-port shape notes) BEFORE it is serialized —
  // never pouring image/base64 payloads into the agent context. Pass a `nodeId`
  // to run ONLY that node's downstream closure (incremental — the editor's "Run"
  // / hot-update path; everything upstream is hydrated from the output cache),
  // instead of re-running the whole graph each time. Escape hatch: `raw: true`
  // hits the full route (the caller then owns the size; Tier-4 spill protects
  // the context if it's large).
  'asset2d:pipeline.execute': async (args, ctx) => {
    const body = objectArgs(args)
    const forward: Record<string, unknown> = {}
    if (typeof body.nodeId === 'string') forward.nodeId = body.nodeId
    const path = body.raw === true ? '/api/v1/execute' : '/api/v1/execute/summary'
    return request(ctx, 'POST', path, forward)
  },
  'asset2d:pipeline.import': async (args, ctx) => request(ctx, 'POST', '/api/v1/pipeline/import', objectArgs(args)),
  'asset2d:pipeline.export': async (args, ctx) => request(ctx, 'POST', '/api/v1/pipeline/export', objectArgs(args)),
  'asset2d:assets.list': async (args, ctx) => request(ctx, 'GET', `/api/v1/generated-assets${query(objectArgs(args))}`),
  'asset2d:assets.get': async (args, ctx) => {
    const alias = stringArg(objectArgs(args), 'alias')
    return request(ctx, 'GET', `/api/v1/generated-assets/${encodeURIComponent(alias)}`)
  },
  // Cross-app byte hand-off for the texture pipeline. The 2D project's files live
  // under a separate FORGEAX_PROJECT_ROOT and are NOT visible to the scene agent's
  // filesystem, so we fetch the bytes from the backend and SPILL THEM TO DISK under
  // the workspace cache, returning only a `path` (never inline base64 — a single
  // PNG is hundreds of KB of base64 that would blow up the LLM context + chat DOM).
  // The agent can read_file the path if it truly needs the pixels (vision).
  // Preferred publish path: `scene:library.publishExternal({ from2dAlias })`, which
  // moves the bytes server-to-server and never touches the agent context at all.
  'asset2d:assets.getBytes': async (args, ctx) => {
    const alias = stringArg(objectArgs(args), 'alias')
    const r = (await request(
      ctx,
      'GET',
      `/api/v1/generated-assets/${encodeURIComponent(alias)}/base64`,
    )) as { alias?: string; blobId?: string; mimeType?: string; sizeBytes?: number; dataBase64?: string }
    const dataBase64 = typeof r?.dataBase64 === 'string' ? r.dataBase64 : ''
    const safeAlias = alias.replace(/[^a-zA-Z0-9_-]/g, '_')
    const relPath = `.cache/asset-bytes/${safeAlias}.${mimeExt(r?.mimeType)}`
    const absPath = resolve(ctx.cwd, relPath)
    try {
      mkdirSync(dirname(absPath), { recursive: true })
      writeFileSync(absPath, Buffer.from(dataBase64, 'base64'))
    } catch {
      // Disk write best-effort; metadata below is still useful even if it fails.
    }
    return {
      alias: r?.alias ?? alias,
      blobId: r?.blobId,
      mimeType: r?.mimeType,
      sizeBytes: r?.sizeBytes ?? Buffer.byteLength(dataBase64, 'base64'),
      path: absPath,
      relPath,
      note: '字节已落盘，不再内联 base64。要发布到场景请优先用 scene:library.publishExternal({ from2dAlias })（服务端直传，无需经过 agent）；只有确需像素时才 read_file 这个 path。',
    }
  },
  // Publish a finished 2D asset into the SHARED GAME SANDBOX
  // (<projectRoot>/.forgeax/games/<gameSlug>/textures), where the scene workbench
  // reads it alongside its built-in library. The host tool process resolves the
  // sandbox path from its cwd (= project root); the 2D backend writes its own
  // local bytes there (no base64 through the agent, no app-internal writes).
  'asset2d:publishToGame': async (args, ctx) => {
    const a = objectArgs(args)
    const alias = stringArg(a, 'alias')
    const gameSlug = stringArg(a, 'gameSlug')
    const root = typeof a.projectRoot === 'string' && a.projectRoot.trim() ? a.projectRoot.trim() : ctx.cwd
    const base = isAbsolute(root) ? root : resolve(ctx.cwd, root)
    const targetDir = resolve(base, '.forgeax', 'games', gameSlug, 'textures')
    return request(ctx, 'POST', '/api/v1/publish-to-game', {
      alias,
      targetDir,
      assetName: a.assetName,
      assetType: a.assetType,
      ...(a.autotileKind !== undefined ? { autotileKind: a.autotileKind } : {}),
      ...(a.anchorX !== undefined ? { anchorX: a.anchorX } : {}),
      ...(a.anchorY !== undefined ? { anchorY: a.anchorY } : {}),
      ...(a.geometryJson !== undefined ? { geometryJson: a.geometryJson } : {}),
    })
  },
  'asset2d:assets.openFolder': async (args, ctx) => {
    const body = objectArgs(args)
    return request(ctx, 'GET', `/api/v1/generated-assets${query({ folder: body.folder })}`)
  },
  'asset2d:preview.latest': async (_args, ctx) => request(ctx, 'GET', '/api/v1/preview/latest'),
  'asset2d:preview.capture': async (_args, ctx) => request(ctx, 'GET', '/api/v1/preview/latest'),
  'asset2d:preview.selectAsset': async (args, ctx) => request(ctx, 'POST', '/api/v1/preview/select-asset', objectArgs(args)),
  'asset2d:generation.generateImage': async (args, ctx) => request(ctx, 'POST', '/api/v1/ai/image', objectArgs(args)),
}

export default tools
