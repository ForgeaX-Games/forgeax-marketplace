import type { FastifyInstance } from 'fastify'
import { executeNode } from '@forgeax/node-runtime'
import { getRuntime } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { EXECUTE_BODY_LIMIT } from './body-limits.js'
import { summarizeExecutionResult } from '../execution-summary.js'

export async function registerExecuteRoutes(app: FastifyInstance): Promise<void> {
  // FULL ExecutionResult — UI / REST callers depend on the full payload.
  app.post('/api/v1/execute', {
    bodyLimit: EXECUTE_BODY_LIMIT,
    schema: {
      body: {
        type: 'object',
        properties: { nodeId: { type: 'string' } },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
    const access = await ensureMutationAccess(req)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const body = (req.body ?? {}) as { nodeId?: string }
    const handle = await executeNode(await getRuntime(), body.nodeId ? { nodeId: body.nodeId } : {})
    return handle.done
  })

  // Agent-facing execute: run the pipeline and return ONLY a KB-scale summary
  // (status + per-port item/shape notes), never raw mesh / buffer payloads. This
  // is what `lowpoly:pipeline.execute` calls by default. Summarizing on the
  // backend — before serialization into an HTTP body — keeps the payload tiny
  // regardless of how heavy the produced meshes are.
  app.post('/api/v1/execute/summary', {
    bodyLimit: EXECUTE_BODY_LIMIT,
    schema: {
      body: {
        type: 'object',
        properties: { nodeId: { type: 'string' } },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
    const access = await ensureMutationAccess(req)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const body = (req.body ?? {}) as { nodeId?: string }
    const handle = await executeNode(await getRuntime(), body.nodeId ? { nodeId: body.nodeId } : {})
    const full = await handle.done
    return summarizeExecutionResult(full)
  })
}
