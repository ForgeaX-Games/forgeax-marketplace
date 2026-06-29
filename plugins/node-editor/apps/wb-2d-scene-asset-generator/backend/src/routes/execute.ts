import type { FastifyInstance } from 'fastify'
import { executeNode } from '@forgeax/node-runtime'
import { getRuntime } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { summarizeExecutionResult } from '../execution-summary.js'

export async function registerExecuteRoutes(app: FastifyInstance): Promise<void> {
  // Kick off execution and await completion, returning the FULL ExecutionResult.
  // UI / REST callers depend on the full payload, so this route stays as-is.
  // Live exec:* events still stream over /ws (execution channel).
  app.post('/api/v1/execute', async (req, reply) => {
    const access = await ensureMutationAccess(req)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const body = (req.body ?? {}) as { nodeId?: string }
    const handle = await executeNode(await getRuntime(), body.nodeId ? { nodeId: body.nodeId } : {})
    return handle.done
  })

  // Agent-facing execute: run the pipeline and return ONLY a KB-scale summary
  // (status + per-port item/shape notes), never raw image/base64 payloads. This
  // is what `asset2d:pipeline.execute` calls by default. Summarizing on the
  // backend — before the result is serialized into an HTTP body — keeps the
  // payload tiny regardless of how many assets the graph emits.
  app.post('/api/v1/execute/summary', async (req, reply) => {
    const access = await ensureMutationAccess(req)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const body = (req.body ?? {}) as { nodeId?: string }
    const handle = await executeNode(await getRuntime(), body.nodeId ? { nodeId: body.nodeId } : {})
    const full = await handle.done
    return summarizeExecutionResult(full)
  })
}
