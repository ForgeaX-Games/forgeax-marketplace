import { readFileSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'

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

const PLUGIN_ID = '@forgeax-plugin/wb-scene-generator'
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:9557'
const ASSET2D_PLUGIN_ID = '@forgeax-plugin/wb-2d-scene-asset-generator'
const DEFAULT_ASSET2D_BACKEND_URL = 'http://127.0.0.1:9567'

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

function backendUrlFromOverrides(file: string | undefined, pluginId: string): string | null {
  if (!file) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as {
      plugins?: Record<string, { backendPort?: unknown }>
    }
    const port = parsed.plugins?.[pluginId]?.backendPort
    if (Number.isInteger(port) && Number(port) > 0 && Number(port) <= 65535) {
      return `http://127.0.0.1:${Number(port)}`
    }
  } catch {
    return null
  }
  return null
}

function backendBaseUrl(ctx: ToolCtx): string {
  const explicit = ctx.env.FORGEAX_SCENE_BACKEND_URL
  if (explicit?.trim()) return explicit.replace(/\/+$/u, '')
  return backendUrlFromOverrides(ctx.env.FORGEAX_PLUGIN_DEV_PORTS_FILE, PLUGIN_ID) ?? DEFAULT_BACKEND_URL
}

// The 2D asset generator runs as a separate Fastify backend on its own port.
// Resolve it from the same dev-ports file the host uses, so the publish bridge
// can pull bytes server-to-server (the agent must NEVER shuttle base64 — large
// base64 gets dropped by context auto-compaction, causing publish retry loops).
function asset2dBackendBaseUrl(ctx: ToolCtx): string {
  const explicit = ctx.env.FORGEAX_ASSET2D_BACKEND_URL
  if (explicit?.trim()) return explicit.replace(/\/+$/u, '')
  return backendUrlFromOverrides(ctx.env.FORGEAX_PLUGIN_DEV_PORTS_FILE, ASSET2D_PLUGIN_ID) ?? DEFAULT_ASSET2D_BACKEND_URL
}

// Fetch a generated 2D asset's raw bytes (by alias or blobId) from the asset2d
// backend and return base64. Runs in the host tool process (server-to-server),
// keeping pixels out of the agent context entirely.
async function fetch2dAssetBase64(
  ctx: ToolCtx,
  ref: { alias?: string; blobId?: string },
): Promise<string> {
  const base = asset2dBackendBaseUrl(ctx)
  const path = ref.alias
    ? `/api/v1/generated-assets/blob/${encodeURIComponent(ref.alias)}`
    : `/api/v1/library/blob/${encodeURIComponent(ref.blobId ?? '')}`
  const res = await fetch(`${base}${path}`)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`asset2d byte fetch ${path} failed: ${res.status} ${detail || res.statusText}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) throw new Error(`asset2d byte fetch ${path} returned empty bytes`)
  return buf.toString('base64')
}

function sceneCallerHeaders(ctx: ToolCtx, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'x-forgeax-caller-kind': ctx.caller.kind }
  if (hasBody) headers['content-type'] = 'application/json'
  if (ctx.caller.agentId) headers['x-forgeax-caller-agent-id'] = ctx.caller.agentId
  if (ctx.caller.sessionId) headers['x-forgeax-caller-session-id'] = ctx.caller.sessionId
  return headers
}

async function sceneRawFetch(
  ctx: ToolCtx,
  method: string,
  path: string,
  body: unknown,
): Promise<{ res: Response; payload: unknown; text: string }> {
  const res = await fetch(`${backendBaseUrl(ctx)}${path}`, {
    method,
    headers: sceneCallerHeaders(ctx, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const payload = text ? (JSON.parse(text) as unknown) : null
  return { res, payload, text }
}

async function request(ctx: ToolCtx, method: string, path: string, body?: unknown): Promise<unknown> {
  let { res, payload, text } = await sceneRawFetch(ctx, method, path, body)

  // Transparent lock recovery after a backend restart wipes the in-memory lock
  // table: an AI mutation gets 403 `mutation-denied-not-open` (recoverable). Re-
  // `open` the active project once and replay. Genuine conflicts
  // (`mutation-denied-locked-by-other`) are NOT retried.
  if (res.status === 403 && ctx.caller.kind === 'ai' && ctx.caller.agentId) {
    const p = (payload ?? {}) as { code?: unknown; projectId?: unknown }
    if (p.code === 'mutation-denied-not-open' && typeof p.projectId === 'string' && p.projectId) {
      const reopen = await sceneRawFetch(
        ctx,
        'POST',
        `/api/v1/projects/${encodeURIComponent(p.projectId)}/activate`,
        {},
      )
      if (reopen.res.ok) {
        ;({ res, payload, text } = await sceneRawFetch(ctx, method, path, body))
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
    throw new Error(`scene backend ${method} ${path} failed: ${reason}`)
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

function stripBatteryIcon(op: Record<string, unknown>): Record<string, unknown> {
  return stripInlineImages(op) as Record<string, unknown>
}

// agent 运行时（tool-normalizer.createToolResultMessage）对工具结果做 isContentPartArray
// 判定：命中则走多模态分支，让 LLM 真正“看到”图片。后端 REST 路由刻意只返回路径 JSON
// （避免 base64 污染上下文 / 供 UI 等非 agent 调用方复用），所以把它包装成 image_file
// ContentPart[] 是 agent 工具适配层（本文件）的职责，而非后端路由的职责。
type AgentScreenshotView = { captureId: string; width: number; height: number; path: string; relPath?: string; capturedAt?: string }

function screenshotContentParts(view: AgentScreenshotView): unknown[] {
  const { captureId, width, height, path } = view
  return [
    { type: 'image_file', path, mimeType: 'image/png' },
    {
      type: 'text',
      text:
        `以上是图片内容块，你的模型 claude-opus-4-8 完全支持图片输入，可以直接查看这张截图。` +
        `严禁声称“模型不支持图片输入 / 读不了图”而跳过视觉验证——那是修复前的错误旧认知，现已不成立。` +
        `请直接观察画面（布局/建筑/道路/装饰是否正确）判断对错。` +
        `（截图已捕获：${width}x${height}，captureId=${captureId}，path=${path}）`,
    },
  ]
}

/** Test-phase escape hatch (`FORGEAX_SCENE_SCREENSHOT_NO_VISION=1|true|on`): when
 *  set, screenshot tools return the plain capture metadata (path + size) WITHOUT
 *  the `image_file` content part, so the agent never ingests the screenshot into
 *  its context. The renderer still captures it (the human can open the path); the
 *  agent just doesn't "see" it. Default (unset) → vision ON, unchanged behaviour. */
function screenshotVisionDisabled(ctx: ToolCtx): boolean {
  const v = (ctx.env.FORGEAX_SCENE_SCREENSHOT_NO_VISION ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function screenshotResult(view: AgentScreenshotView, ctx: ToolCtx): unknown {
  if (screenshotVisionDisabled(ctx)) {
    return {
      ...view,
      visionDisabled: true,
      note:
        '截图视觉已按测试配置关闭（FORGEAX_SCENE_SCREENSHOT_NO_VISION）。本工具只返回截图路径与尺寸，' +
        '未把图片读进你的上下文。请勿声称“看过这张图”；改用 scene:pipeline.execute 的摘要 + names 投影来判定每组是否产出。',
    }
  }
  return screenshotContentParts(view)
}

export const tools: Record<string, ToolHandler> = {
  'scene:projects.list': async (_args, ctx) => request(ctx, 'GET', '/api/v1/projects'),
  'scene:projects.create': async (args, ctx) => request(ctx, 'POST', '/api/v1/projects', objectArgs(args)),
  'scene:projects.open': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/activate`, {})
  },
  'scene:projects.close': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/close`, {})
  },
  'scene:projects.remove': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    return request(ctx, 'DELETE', `/api/v1/projects/${encodeURIComponent(id)}${query({ assetPolicy: body.assetPolicy })}`)
  },
  // Strip inline-image fields so the catalog is always clean text (see
  // `stripBatteryIcon` / `stripInlineImages` above).
  'scene:batteries.list': async (_args, ctx) => {
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    return Array.isArray(ops) ? ops.map(stripBatteryIcon) : ops
  },
  'scene:batteries.get': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    const op = ops.find((candidate) => candidate.id === id)
    if (!op) throw new Error(`scene battery not found: ${id}`)
    return stripBatteryIcon(op)
  },
  // Group templates (the 6 prebuilt scene template groups + saved group
  // batteries). These let an AI discover available template groups and their
  // exposed in_N/out_N ports — what `batteries.get` (static ops only) can't show.
  // Strip inline-image fields (iconPng data URLs / iconSvg) so the catalog is
  // always clean, parseable text — the agent only needs the group's name +
  // exposed in_N/out_N ports, never the preview pixels (which are tens of KB of
  // base64 each and would pollute the context + chat DOM). See `stripInlineImages`.
  'scene:templates.list': async (_args, ctx) => {
    const list = await request(ctx, 'GET', '/api/v1/group-templates?scope=templates')
    return stripInlineImages(list)
  },
  'scene:templates.get': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    const group = await request(ctx, 'GET', `/api/v1/group-templates/${encodeURIComponent(id)}?scope=templates`)
    return stripInlineImages(group)
  },
  // One-shot instantiation of a template group into the active project's graph.
  // Forwards to the dedicated instantiate route (NOT /api/v1/batch), so the inner
  // alg_* member createNodes are never seen by the sino op gate.
  'scene:pipeline.instantiateTemplate': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'templateId')
    return request(ctx, 'POST', `/api/v1/group-templates/${encodeURIComponent(id)}/instantiate`, body)
  },
  'scene:pipeline.get': async (_args, ctx) => request(ctx, 'GET', '/api/v1/pipeline'),
  'scene:pipeline.applyBatch': async (args, ctx) => request(ctx, 'POST', '/api/v1/batch', objectArgs(args)),
  // The agent must never pour a full ExecutionResult into its context (a real
  // graph is ~28MB and a huge scene can exceed V8's single-string limit, which
  // would throw `Invalid string length` while serializing the HTTP body). So by
  // default we call the backend's summary route, which projects the result to a
  // KB-scale summary (status + per-port child names / cell counts) BEFORE it is
  // ever serialized into an HTTP body — keeping the payload tiny regardless of
  // scene size. Escape hatch: `raw: true` hits the full route (UI parity; the
  // caller then owns the size and accepts that a massive scene may be heavy).
  'scene:pipeline.execute': async (args, ctx) => {
    const body = objectArgs(args)
    const raw = body.raw === true
    const forward: Record<string, unknown> = {}
    if (typeof body.nodeId === 'string') forward.nodeId = body.nodeId
    const path = raw ? '/api/v1/execute' : '/api/v1/execute/summary'
    return request(ctx, 'POST', path, forward)
  },
  'scene:pipeline.import': async (args, ctx) => request(ctx, 'POST', '/api/v1/pipeline/import', objectArgs(args)),
  'scene:pipeline.export': async (args, ctx) => request(ctx, 'POST', '/api/v1/pipeline/export', objectArgs(args)),
  'scene:assets.list': async (args, ctx) => request(ctx, 'GET', `/api/v1/assets${query(objectArgs(args))}`),
  // Library listing (base ∪ project-private, paginated) — the ONLY way for an
  // agent to SEE/verify what it published via `scene:library.publishExternal`.
  // (`scene:assets.list` above lists the shared filesystem `assets/` dir, NOT
  // the private library DB, so it can't confirm a publish.) Defaults to the
  // `raw` zone (the publish bridge's landing zone).
  'scene:library.list': async (args, ctx) => {
    const a = objectArgs(args)
    return request(ctx, 'GET', `/api/v1/library/list${query({ zone: 'raw', ...a })}`)
  },
  // Texture-pipeline publish bridge. Lands a 2D-generated PNG (base64) into this
  // scene project's private `raw` zone so the billboard renderer can match it —
  // composing a renderer-shaped alias (field4=assetName, field8=type), binding a
  // tile's autotile rule (autotileKind), and recording provenance (sourceBlobId,
  // idempotent). Args: { assetName, assetType:'tile'|'object', dataBase64,
  // autotileKind?, sourceBlobId?, anchorX?, anchorY?, geometryJson?, extraFields? }.
  // Bind the shared-game-sandbox textures dir (where the 2D app publishes via
  // asset2d:publishToGame) so the scene workbench reads it as an asset source —
  // surfaced in the AssetStore view AND merged into the renderer matching pool.
  // The host tool process resolves the absolute dir from its cwd (= project root).
  'scene:library.useGameTextures': async (args, ctx) => {
    const a = objectArgs(args)
    const gameSlug = stringArg(a, 'gameSlug')
    const root = typeof a.projectRoot === 'string' && a.projectRoot.trim() ? a.projectRoot.trim() : ctx.cwd
    const base = isAbsolute(root) ? root : resolvePath(ctx.cwd, root)
    const dir = resolvePath(base, '.forgeax', 'games', gameSlug, 'textures')
    return request(ctx, 'POST', '/api/v1/library/use-game-textures', { dir })
  },
  'scene:library.publishExternal': async (args, ctx) => {
    const a = { ...objectArgs(args) }
    // Preferred path: agent passes a 2D asset reference (from2dAlias / from2dBlobId)
    // and we fetch the bytes server-to-server here. The agent NEVER carries the
    // base64 — large base64 in the conversation gets dropped by auto-compaction,
    // which previously caused publishExternal to loop (lost dataBase64 → re-fetch
    // → compact → repeat). Raw `dataBase64` is still accepted for back-compat.
    const from2dAlias = typeof a.from2dAlias === 'string' ? a.from2dAlias.trim() : ''
    const from2dBlobId = typeof a.from2dBlobId === 'string' ? a.from2dBlobId.trim() : ''
    if (!a.dataBase64 && (from2dAlias || from2dBlobId)) {
      a.dataBase64 = await fetch2dAssetBase64(ctx, { alias: from2dAlias || undefined, blobId: from2dBlobId || undefined })
      if (!a.sourceBlobId && from2dBlobId) a.sourceBlobId = from2dBlobId
    }
    // These are tool-layer-only hints; the backend route doesn't know them.
    delete a.from2dAlias
    delete a.from2dBlobId
    return request(ctx, 'POST', '/api/v1/library/publish-external', a)
  },
  // capture 成功 → 包装成 image_file ContentPart[]，经 host_tool_bridge 透传给 agent
  // 运行时，命中多模态分支让 sino 真正看到截图。无 renderer client 时后端返回 504，
  // request() 会抛错（"... capture timeout (no renderer connected?)"），sino 由此明确
  // 知道“没截到图”，绝不会被当成成功。
  'scene:screenshot.capture': async (args, ctx) => {
    const view = await request(ctx, 'POST', '/api/v1/agent/screenshot/capture', objectArgs(args)) as AgentScreenshotView
    return screenshotResult(view, ctx)
  },
  'scene:screenshot.latest': async (_args, ctx) => {
    const view = await request(ctx, 'GET', '/api/v1/agent/screenshot/latest') as AgentScreenshotView
    return screenshotResult(view, ctx)
  },
  'scene:screenshot.store': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/screenshot/store', objectArgs(args)),
  'scene:renderer.info': async (_args, ctx) => request(ctx, 'GET', '/api/v1/agent/renderer/info'),
  'scene:renderer.setViewMode': async (args, ctx) => request(ctx, 'PATCH', '/api/v1/agent/renderer/view-mode', objectArgs(args)),
  'scene:renderer.selectLayer': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/renderer/select-layer', objectArgs(args)),
  'scene:renderer.openAllSubLayers': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/renderer/open-all-sublayers', objectArgs(args)),
}

export default tools
