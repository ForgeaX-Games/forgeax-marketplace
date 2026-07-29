import type { FastifyInstance } from 'fastify'
import { registerProjectPipelineRoutes } from '@forgeax/editor-host/backend'
import { getPipeline } from '@forgeax/node-runtime'
import { getProjectRegistry, getRuntimeForProject } from '../runtime.js'
import { extractCaller } from './projects.js'
import { getBatteryCategories } from './batteryCategories.js'
import { logOutputFetch, logPersistBatch } from '../lib/persistTrace.js'
import { checkPlaceOneSeedOnPointMiswire, checkSinoOpAllowlist, isSinoBatch } from './sinoOpGate.js'
import { pipelineHashOnly, summarizePipeline } from '../pipeline-summary.js'

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  await registerProjectPipelineRoutes(app, {
    getProjectRegistry,
    getRuntimeForProject,
    extractCaller,
    getBatteryCategories: async () =>
      (await getBatteryCategories()) as unknown as Map<string, Record<string, unknown>>,
    logOutputFetch,
    beforeApplyBatch: async (req, projectId, ops) => {
      const opts = (req.body as { opts?: { actor?: string } })?.opts
      if (isSinoBatch(opts, req.headers['x-forgeax-caller-agent-id'])) {
        const rejection = checkSinoOpAllowlist(ops)
        if (rejection) {
          return {
            status: 403,
            body: {
              reason: rejection.reason,
              fix: rejection.fix,
              opIndex: rejection.opIndex,
              opId: rejection.opId,
              channel: 'applyBatch channel B — use instantiateTemplate (channel A) for template groups',
            },
          }
        }
        try {
          const snap = getPipeline(await getRuntimeForProject(projectId))
          const miswire = checkPlaceOneSeedOnPointMiswire(ops, snap?.nodes ?? null)
          if (miswire) {
            return {
              status: 422,
              body: {
                reason: miswire.reason,
                fix: miswire.fix,
                opIndex: miswire.opIndex,
                opId: miswire.opId,
                channel: 'applyBatch PlaceOne Point≠Seed',
              },
            }
          }
        } catch {
          // Gate is best-effort; never block unrelated batches if snapshot read fails.
        }
      }
      return null
    },
    logPersistBatch: (ops, result, meta) => {
      logPersistBatch(
        ops as never,
        result as never,
        meta as { actor?: string; label?: string; batchId?: string; durationMs: number },
      )
    },
  })

  app.get<{
    Params: { projectId: string }
    Querystring: { mode?: string; groupId?: string; nodeIds?: string; nameContains?: string; opIdIn?: string }
  }>(
    '/api/v1/projects/:projectId/pipeline/summary',
    async (req, reply) => {
      const { projectId } = req.params
      const reg = await getProjectRegistry()
      if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
      const snap = getPipeline(await getRuntimeForProject(projectId))
      if (req.query.mode === 'hash') return pipelineHashOnly(snap)
      const nodeIds = req.query.nodeIds?.split(',').map((s) => s.trim()).filter(Boolean)
      const opIdIn = req.query.opIdIn?.split(',').map((s) => s.trim()).filter(Boolean)
      return summarizePipeline(snap, {
        ...(req.query.groupId ? { groupId: req.query.groupId } : {}),
        ...(nodeIds?.length ? { nodeIds } : {}),
        ...(req.query.nameContains ? { nameContains: req.query.nameContains } : {}),
        ...(opIdIn?.length ? { opIdIn } : {}),
      })
    },
  )
}
