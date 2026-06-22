import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { getScreenshotService } from '@forgeax/editor-host/backend'
import { getGlbService } from './glb.service.js'
import { broadcastToClients } from '../routes/ws.js'

// backend/src/agent/routes.ts → plugin repo root is three dirs up.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PROJECT_ROOT = process.env.FORGEAX_PROJECT_ROOT ?? resolve(REPO_ROOT, '.forgeax-runtime')

function safeName(raw: unknown): string {
  const base = (typeof raw === 'string' && raw.trim() ? raw : 'lowpoly-model')
    .replace(/\.glb$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._]+$/g, '')
  return base || 'lowpoly-model'
}

// Agent-facing screenshot view. We deliberately DROP the base64 `dataUrl`:
// handing it to an AI caller dumps hundreds of KB of base64 into the model's
// context as plain *text* (tokenized per-character, not as a vision tile) — one
// capture can blow the window past 100%. Instead we persist the PNG to disk and
// return its path; the agent opens it with the builtin `read_file` tool, which
// yields a proper image content-part and never re-inlines base64 into history.
type ScreenshotRecord = { captureId: string; dataUrl: string; width: number; height: number; capturedAt: string }
type AgentScreenshotView = Omit<ScreenshotRecord, 'dataUrl'> & { path: string; relPath: string }

function persistForAgent(rec: ScreenshotRecord): AgentScreenshotView {
  const base64 = rec.dataUrl.includes(',') ? rec.dataUrl.slice(rec.dataUrl.indexOf(',') + 1) : rec.dataUrl
  const dir = join(PROJECT_ROOT, '.cache', 'screenshots')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${rec.captureId}.png`)
  writeFileSync(file, Buffer.from(base64, 'base64'))
  return {
    captureId: rec.captureId,
    width: rec.width,
    height: rec.height,
    capturedAt: rec.capturedAt,
    path: file,
    relPath: relative(PROJECT_ROOT, file),
  }
}

// WS-coordinated agent routes: screenshot capture + glb export both broadcast a
// request to live renderer clients (the ?pane=urdf viewer / headless renderer)
// and await their /store callback.
export async function registerScreenshotRoutes(app: FastifyInstance): Promise<void> {
  const svc = getScreenshotService()
  const glb = getGlbService()

  app.post('/api/v1/agent/screenshot/capture', { bodyLimit: 20 * 1024 * 1024 }, async (req, reply) => {
    // Default 10s (was 5s): a cold render of a heavy URDF in the headless
    // renderer (re-sync graph → render → encode 600KB+ PNG → POST) can exceed
    // 5s and surface as a misleading "no renderer connected" timeout.
    const timeout = Math.min((req.body as { timeout?: number })?.timeout ?? 10000, 20000)
    const { captureId, promise } = svc.createCapture(timeout)
    broadcastToClients({ event: 'screenshot:request', payload: { captureId } })
    try {
      return persistForAgent(await promise)
    } catch {
      return reply.code(504).send({ error: 'capture timeout (no renderer connected?)' })
    }
  })

  app.post('/api/v1/agent/screenshot/store', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const b = req.body as { captureId: string; dataUrl: string; width: number; height: number }
    const ok = svc.resolveCapture(b.captureId, { ...b, capturedAt: new Date().toISOString() })
    return { ok }
  })

  app.get('/api/v1/agent/screenshot/latest', async (_req, reply) => {
    const latest = svc.getLatest()
    return latest ? persistForAgent(latest) : reply.code(404).send({ error: 'no screenshot yet' })
  })

  // ── GLB export ──────────────────────────────────────────────────────────
  // /export broadcasts `glb:request`; the live viewer bakes the current URDF
  // scene to binary glTF (with joint-preview animation) and POSTs it to /store,
  // which writes it under <projectRoot>/assets/3d/<name>.glb and resolves.
  app.post('/api/v1/agent/glb/export', { bodyLimit: 1 * 1024 * 1024 }, async (req, reply) => {
    const body = (req.body as { name?: string; animated?: boolean; timeout?: number }) ?? {}
    // glb bake (render + GLTFExporter parse + base64 + POST) is heavier than a
    // screenshot, so default 30s / cap 60s. (timeout is MILLISECONDS.)
    const timeout = Math.min(body.timeout ?? 30000, 60000)
    const name = safeName(body.name)
    const { requestId, promise } = glb.createExport(timeout)
    broadcastToClients({ event: 'glb:request', payload: { requestId, name, animated: body.animated !== false } })
    try {
      return await promise
    } catch (e) {
      return reply
        .code(504)
        .send({ error: `glb export failed/timeout after ${timeout}ms: ${(e as Error).message} (renderer connected? graph executed so g_to_urdf has output?)` })
    }
  })

  app.post('/api/v1/agent/glb/store', { bodyLimit: 128 * 1024 * 1024 }, async (req, reply) => {
    const b = req.body as { requestId: string; name?: string; dataUrl?: string; bytes?: number; error?: string }
    if (!b?.requestId) return reply.code(400).send({ error: 'missing requestId' })
    if (b.error) {
      glb.rejectExport(b.requestId, b.error)
      return { ok: false }
    }
    if (typeof b.dataUrl !== 'string') {
      glb.rejectExport(b.requestId, 'missing dataUrl')
      return reply.code(400).send({ error: 'missing dataUrl' })
    }
    const base64 = b.dataUrl.includes(',') ? b.dataUrl.slice(b.dataUrl.indexOf(',') + 1) : b.dataUrl
    const buf = Buffer.from(base64, 'base64')
    const outDir = join(PROJECT_ROOT, 'assets', '3d')
    mkdirSync(outDir, { recursive: true })
    const file = join(outDir, `${safeName(b.name)}.glb`)
    writeFileSync(file, buf)
    const ok = glb.resolveExport(b.requestId, {
      requestId: b.requestId,
      path: file,
      relPath: relative(PROJECT_ROOT, file),
      bytes: buf.length,
    })
    return { ok }
  })
}
