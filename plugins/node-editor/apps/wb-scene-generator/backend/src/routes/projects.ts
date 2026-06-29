// Thin Fastify routes over the kernel ProjectRegistry — multi-project
// management for the scene-generator app. Faithful to the legacy project
// routes (GET/POST/PUT/DELETE /projects, POST /projects/:id/activate,
// GET/PUT /workspace), but the storage + cascade now live KERNEL-side so the
// 3d-lowpoly plugin and a future third task type inherit them by bumping the
// kernel submodule. Responses are raw JSON (the scene-gen convention — no
// `{ data }` envelope).

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { getPipeline } from '@forgeax/node-runtime'
import type { CallerIdentity, ImportGraphFormat, ImportGraphInput } from '@forgeax/node-runtime'
import { getProjectRegistry, getRuntime, getProjectDir } from '../runtime.js'
import { countLivePrivateAssets } from '../library/privateStore.js'
import { broadcastToClients, rebindWsSubscriptions } from './ws.js'

interface ProjectIdParams {
  id: string
}

const CALLER_KINDS: ReadonlyArray<CallerIdentity['kind']> = ['ai', 'user', 'workbench', 'cli', 'skill']

/**
 * Parse the caller identity forwarded by the tool proxy (tool-handlers.ts). When
 * the headers are absent — i.e. a direct UI REST call — default to kind 'user'
 * so humans are never subject to the per-agent lock.
 */
export function extractCaller(req: FastifyRequest): CallerIdentity {
  const rawKind = req.headers['x-forgeax-caller-kind']
  const kind = (CALLER_KINDS as readonly string[]).includes(rawKind as string)
    ? (rawKind as CallerIdentity['kind'])
    : 'user'
  const agentId = req.headers['x-forgeax-caller-agent-id']
  const sessionId = req.headers['x-forgeax-caller-session-id']
  return {
    kind,
    ...(typeof agentId === 'string' ? { agentId } : {}),
    ...(typeof sessionId === 'string' ? { sessionId } : {}),
  }
}

/**
 * Gate a graph mutation against the per-agent lock: an AI caller may only mutate
 * the active project it has opened. Humans always pass. Used by the batch /
 * execute / import routes.
 */
export async function ensureMutationAccess(
  req: FastifyRequest,
): Promise<{ ok: true } | { ok: false; reason: string; code: string; projectId: string | null }> {
  const reg = await getProjectRegistry()
  const projectId = reg.getActiveProjectId()
  const result = reg.checkMutationAccess(projectId, extractCaller(req))
  if (result.ok) return result
  return { ok: false, reason: result.reason, code: result.code, projectId }
}

function detectFormat(graph: unknown, declared?: string): ImportGraphFormat {
  if (declared === 'kernel-graph-v1' || declared === 'legacy-pipeline-v1') return declared
  const g = graph as { nodes?: unknown }
  const nodes = Array.isArray(g?.nodes)
    ? (g.nodes as Array<Record<string, unknown>>)
    : g?.nodes && typeof g.nodes === 'object'
      ? Object.values(g.nodes as Record<string, Record<string, unknown>>)
      : []
  const first = nodes[0]
  if (first && 'batteryId' in first && !('opId' in first)) return 'legacy-pipeline-v1'
  return 'kernel-graph-v1'
}

/** Resolve a flat template file under <workspaceRoot>/templates → ImportGraphInput. */
async function resolveTemplate(rel: string): Promise<ImportGraphInput | null> {
  const rt = await getRuntime()
  const dir = resolve(rt.config.projectRoot, 'templates')
  const full = resolve(dir, basename(rel))
  if (!full.startsWith(resolve(dir)) || !existsSync(full)) return null
  const parsed = JSON.parse(readFileSync(full, 'utf-8')) as { format?: string; graph?: unknown }
  const graph = parsed.graph ?? parsed
  return { format: detectFormat(graph, parsed.format), graph } as ImportGraphInput
}

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  // List projects.
  app.get('/api/v1/projects', async () => {
    const reg = await getProjectRegistry()
    return reg.listProjects()
  })

  // Fetch one project's manifest.
  app.get<{ Params: ProjectIdParams }>('/api/v1/projects/:id', async (req, reply) => {
    const reg = await getProjectRegistry()
    const record = reg.getProject(req.params.id)
    if (!record) return reply.code(404).send({ reason: `project not found: ${req.params.id}` })
    return record
  })

  // Read-only produced-asset summary for ONE project — drives the delete dialog's
  // asset-policy gating. `producedCount` is the live private-asset count (any
  // zone except trash) under the project's own private store; 0 means deleting
  // touches no assets, so both policy options are moot.
  app.get<{ Params: ProjectIdParams }>('/api/v1/projects/:id/assets/summary', async (req, reply) => {
    const reg = await getProjectRegistry()
    if (!reg.getProject(req.params.id)) {
      return reply.code(404).send({ reason: `project not found: ${req.params.id}` })
    }
    const dir = await getProjectDir(req.params.id)
    const producedCount = dir ? countLivePrivateAssets(dir) : 0
    return { producedCount }
  })

  // Create a project (optionally seeded from a server-side template).
  app.post('/api/v1/projects', async (req, reply) => {
    const reg = await getProjectRegistry()
    const body = (req.body ?? {}) as {
      type?: string
      name?: string
      description?: string
      fromTemplate?: string
    }
    if (!body.name || !body.name.trim()) {
      return reply.code(400).send({ reason: 'project name is required' })
    }
    let fromTemplate: ImportGraphInput | undefined
    if (body.fromTemplate) {
      const resolved = await resolveTemplate(body.fromTemplate)
      if (!resolved) return reply.code(404).send({ reason: `template not found: ${body.fromTemplate}` })
      fromTemplate = resolved
    }
    try {
      const meta = await reg.createProject({
        name: body.name,
        ...(body.type ? { type: body.type } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(fromTemplate ? { fromTemplate } : {}),
      })
      return reply.code(201).send(meta)
    } catch (e) {
      return reply.code(400).send({ reason: (e as Error).message })
    }
  })

  // Patch a project's metadata.
  app.put<{ Params: ProjectIdParams }>('/api/v1/projects/:id', async (req, reply) => {
    const reg = await getProjectRegistry()
    const patch = (req.body ?? {}) as { name?: string; description?: string; thumbnail?: string; type?: string }
    try {
      return reg.updateProject(req.params.id, patch)
    } catch (e) {
      return reply.code(404).send({ reason: (e as Error).message })
    }
  })

  // Delete a project (workspace never left empty).
  app.delete<{ Params: ProjectIdParams; Querystring: { assetPolicy?: string } }>(
    '/api/v1/projects/:id',
    async (req, reply) => {
      const reg = await getProjectRegistry()
      const assetPolicy = req.query.assetPolicy === 'delete' ? 'delete' : 'detach'
      try {
        await reg.deleteProject(req.params.id, { assetPolicy })
        // The active project may have changed (fallback). Re-point live clients.
        await rebindWsSubscriptions()
        return { ok: true, assetPolicy, workspace: reg.getWorkspace() }
      } catch (e) {
        return reply.code(404).send({ reason: (e as Error).message })
      }
    },
  )

  // Open / activate a project — the server step of the open cascade.
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/activate', async (req, reply) => {
    const reg = await getProjectRegistry()
    // Enforce the exclusive open-then-operate lock for AI callers (humans bypass).
    const lock = reg.acquireProjectLock(req.params.id, extractCaller(req))
    if (!lock.ok) return reply.code(409).send({ reason: lock.reason })
    try {
      const rt = reg.activateProject(req.params.id)
      // Re-point live WS subscriptions at the now-active runtime, then tell ALL
      // clients the active project changed so each re-syncs (sibling iframes +
      // renderer). One project:activated drives one reload — replaces the old
      // synthetic graph:applied.
      await rebindWsSubscriptions()
      const snap = getPipeline(rt)
      broadcastToClients({
        event: 'runtime',
        payload: {
          kind: 'project:activated',
          projectId: req.params.id,
          pipelineId: rt.config.pipelineId,
          newHash: snap?.hash ?? '',
        },
      })
      return { project: reg.getProject(req.params.id), pipeline: snap }
    } catch (e) {
      return reply.code(404).send({ reason: (e as Error).message })
    }
  })

  // Release an AI agent's exclusive lock so it (or another agent) can open a
  // different project. Idempotent; humans are a no-op (never locked).
  app.post<{ Params: ProjectIdParams }>('/api/v1/projects/:id/close', async (req, reply) => {
    const reg = await getProjectRegistry()
    const res = reg.releaseProjectLock(req.params.id, extractCaller(req))
    if (!res.ok) return reply.code(409).send({ reason: res.reason })
    return { ok: true }
  })

  // Workspace doc.
  app.get('/api/v1/workspace', async () => {
    const reg = await getProjectRegistry()
    return reg.getWorkspace()
  })

  app.put('/api/v1/workspace', async (req) => {
    const reg = await getProjectRegistry()
    const patch = (req.body ?? {}) as { activeProjectId?: string; recentProjectIds?: string[] }
    const ws = reg.setWorkspace(patch)
    if (patch.activeProjectId) await rebindWsSubscriptions()
    return ws
  })
}
