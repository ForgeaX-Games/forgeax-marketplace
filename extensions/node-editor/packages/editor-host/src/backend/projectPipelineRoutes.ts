// Shared project-scoped pipeline routes for all workbench backends.
// Replaces the legacy global `/api/v1/batch`, `/api/v1/pipeline`, etc.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  applyBatch,
  clearOutputCache,
  getGroup,
  getHistory,
  getNode,
  getNodeOutput,
  getPipeline,
  listEdges,
  listGroups,
  listNodes,
  listOps,
  probeGroupInner,
} from '@forgeax/node-runtime'
import type { CallerIdentity, ProjectRegistry, Runtime } from '@forgeax/node-runtime'

export interface ProjectPipelineRouteDeps {
  getProjectRegistry: () => Promise<ProjectRegistry>
  getRuntimeForProject: (projectId: string) => Promise<Runtime>
  extractCaller: (req: FastifyRequest) => CallerIdentity
  /** Optional pre-batch hook (e.g. sino op gate). Return a 403 body to reject. */
  beforeApplyBatch?: (
    req: FastifyRequest,
    projectId: string,
    ops: unknown[],
  ) => Promise<{ status: number; body: unknown } | null>
  getBatteryCategories?: () => Promise<Map<string, Record<string, unknown>>>
  logOutputFetch?: (
    nodeId: string,
    portId: string,
    durationMs: number,
    bytesOut: number,
    meta: Record<string, unknown>,
  ) => void
  logPersistBatch?: (
    ops: unknown[],
    result: unknown,
    meta: Record<string, unknown>,
  ) => void
}

interface ProjectParams {
  projectId: string
}

export async function ensureProjectMutationAccess(
  deps: Pick<ProjectPipelineRouteDeps, 'getProjectRegistry' | 'extractCaller'>,
  req: FastifyRequest,
  projectId: string,
): Promise<{ ok: true; projectId: string } | { ok: false; reason: string; code: string; projectId: string }> {
  const reg = await deps.getProjectRegistry()
  const result = reg.checkMutationAccess(projectId, deps.extractCaller(req))
  if (result.ok) return { ok: true, projectId }
  return { ok: false, reason: result.reason, code: result.code, projectId }
}

/** Max assembled output JSON over HTTP (sharded ports reassemble server-side). */
const MAX_INLINE_OUTPUT_RESPONSE_BYTES = 128 * 1024 * 1024

export async function registerProjectPipelineRoutes(
  app: FastifyInstance,
  deps: ProjectPipelineRouteDeps,
): Promise<void> {
  const prefix = '/api/v1/projects/:projectId'

  app.get<{ Params: ProjectParams }>(`${prefix}/pipeline`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return getPipeline(await deps.getRuntimeForProject(projectId))
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/pipeline/hash`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    const snap = getPipeline(await deps.getRuntimeForProject(projectId))
    return { hash: snap?.hash ?? null }
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/nodes`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return listNodes(await deps.getRuntimeForProject(projectId), (req.query as { filter?: unknown }).filter as never)
  })

  app.get<{ Params: ProjectParams & { id: string } }>(`${prefix}/nodes/:id`, async (req, reply) => {
    const { projectId, id } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return getNode(await deps.getRuntimeForProject(projectId), id)
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/edges`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return listEdges(await deps.getRuntimeForProject(projectId))
  })

  app.get<{ Params: ProjectParams & { id: string; portId: string } }>(
    `${prefix}/nodes/:id/outputs/:portId/meta`,
    async (req, reply) => {
      const { projectId, id, portId } = req.params
      const reg = await deps.getProjectRegistry()
      if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
      const rt = await deps.getRuntimeForProject(projectId)
      const readMeta = (rt.outputs as { readMeta?: (n: string, p: string) => unknown }).readMeta
      const meta = readMeta?.call(rt.outputs, id, portId) ?? null
      return meta ?? { missing: true }
    },
  )

  app.get<{ Params: ProjectParams & { id: string; portId: string } }>(
    `${prefix}/nodes/:id/outputs/:portId`,
    async (req, reply) => {
      const { projectId, id, portId } = req.params
      const reg = await deps.getProjectRegistry()
      if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
      const t0 = performance.now()
      const rt = await deps.getRuntimeForProject(projectId)
      const readMeta = (rt.outputs as { readMeta?: (n: string, p: string) => { sharded?: boolean; dataChunks?: number } | null }).readMeta
      const meta = readMeta?.call(rt.outputs, id, portId) ?? null
      const value = getNodeOutput(rt, id, portId)
      const body = JSON.stringify({ value })
      const bytesOut = Buffer.byteLength(body, 'utf-8')
      if (meta?.sharded && bytesOut > MAX_INLINE_OUTPUT_RESPONSE_BYTES) {
        deps.logOutputFetch?.(id, portId, performance.now() - t0, bytesOut, {
          sharded: true,
          dataChunks: meta.dataChunks,
          skipped: true,
          tooLarge: true,
        })
        reply.code(413)
        reply.header('content-type', 'application/json; charset=utf-8')
        return reply.send(
          JSON.stringify({
            error: 'output too large for inline fetch',
            sharded: true,
            dataChunks: meta.dataChunks ?? null,
            value: null,
          }),
        )
      }
      deps.logOutputFetch?.(id, portId, performance.now() - t0, bytesOut, {
        sharded: meta?.sharded,
        dataChunks: meta?.dataChunks,
      })
      reply.header('content-type', 'application/json; charset=utf-8')
      return reply.send(body)
    },
  )

  app.get<{ Params: ProjectParams }>(`${prefix}/history`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return getHistory(await deps.getRuntimeForProject(projectId))
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/groups`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return listGroups(await deps.getRuntimeForProject(projectId))
  })

  app.get<{ Params: ProjectParams & { id: string } }>(`${prefix}/groups/:id`, async (req, reply) => {
    const { projectId, id } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return getGroup(await deps.getRuntimeForProject(projectId), id)
  })

  app.get<{ Params: ProjectParams & { id: string } }>(`${prefix}/groups/:id/probe`, async (req, reply) => {
    const { projectId, id } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return probeGroupInner(await deps.getRuntimeForProject(projectId), id)
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/outputs/clear`, async (req, reply) => {
    const { projectId } = req.params
    console.log(`[sync-trace] backend:outputs-clear`, { projectId })
    const access = await ensureProjectMutationAccess(deps, req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return clearOutputCache(await deps.getRuntimeForProject(projectId))
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/batch`, async (req, reply) => {
    const t0 = performance.now()
    const { projectId } = req.params
    const access = await ensureProjectMutationAccess(deps, req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const { ops, opts } = req.body as {
      ops: unknown[]
      opts?: { actor?: string; label?: string; batchId?: string; ephemeral?: boolean; expectedPrevHash?: string }
    }
    const rejection = await deps.beforeApplyBatch?.(req, projectId, ops)
    if (rejection) return reply.code(rejection.status).send(rejection.body)
    const rt = await deps.getRuntimeForProject(projectId)
    const result = await applyBatch(rt, ops as never, {
      actor: opts?.actor ?? 'ui',
      ...(opts?.label !== undefined ? { label: opts.label } : {}),
      ...(opts?.batchId !== undefined ? { batchId: opts.batchId } : {}),
      ...(opts?.ephemeral !== undefined ? { ephemeral: opts.ephemeral } : {}),
      ...(opts?.expectedPrevHash !== undefined ? { expectedPrevHash: opts.expectedPrevHash } : {}),
    })
    if (result.status === 'rejected' && result.reason?.startsWith('concurrent-write:')) {
      return reply.code(409).send(result)
    }
    deps.logPersistBatch?.(ops, result, {
      actor: opts?.actor,
      label: opts?.label,
      batchId: opts?.batchId,
      durationMs: performance.now() - t0,
      projectId,
    })
    return result
  })

  // Global ops catalog (not project-scoped) — batteries are shared across projects.
  app.get('/api/v1/ops', async () => {
    const reg = await deps.getProjectRegistry()
    const viewingId = reg.getViewingProjectId()
    const list = reg.listProjects()
    const rt = viewingId
      ? reg.getRuntimeFor(viewingId)
      : list[0]
        ? reg.getRuntimeFor(list[0].id)
        : null
    if (!rt) return []
    const [ops, categories] = await Promise.all([
      Promise.resolve(listOps(rt)),
      deps.getBatteryCategories?.() ?? Promise.resolve(new Map()),
    ])
    return ops.map((op) => {
      const ui = categories.get(op.id)
      if (!ui) return op
      return { ...op, ...ui }
    })
  })
}
