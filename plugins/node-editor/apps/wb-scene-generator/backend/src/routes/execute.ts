import type { FastifyInstance } from 'fastify'
import { executeNode } from '@forgeax/node-runtime'
import { getRuntime } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { summarizeExecutionResult } from '../execution-summary.js'

export async function registerExecuteRoutes(app: FastifyInstance): Promise<void> {
  // Kick off execution and await completion, returning the ExecutionResult.
  // Live exec:* events still stream over /ws (execution channel).
  //
  // This route intentionally returns the FULL ExecutionResult — every node/port
  // carries its DataTreeEntry[] with all voxel cells. UI / other REST callers
  // depend on the full payload, so it stays as-is.
  app.post('/api/v1/execute', async (req, reply) => {
    const access = await ensureMutationAccess(req)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const body = (req.body ?? {}) as { nodeId?: string }
    const handle = await executeNode(await getRuntime(), body.nodeId ? { nodeId: body.nodeId } : {})
    return handle.done
  })

  // Agent-facing execute: run the pipeline and return ONLY the KB-scale summary
  // (status + per-port child names / cell counts), never the raw cells. This is
  // what the `scene:pipeline.execute` tool calls by default. Summarizing on the
  // backend — before the result is serialized into an HTTP body — is what keeps
  // a huge scene (hundreds of subtree nodes) from ever materializing a multi-
  // hundred-MB JSON string at the Fastify seam, which would otherwise throw
  // `Invalid string length` exactly the way the full route can. The summary is
  // always tiny, so it serializes safely no matter how large the scene is.
  app.post('/api/v1/execute/summary', async (req, reply) => {
    const access = await ensureMutationAccess(req)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const body = (req.body ?? {}) as { nodeId?: string }
    const handle = await executeNode(await getRuntime(), body.nodeId ? { nodeId: body.nodeId } : {})
    const full = await handle.done
    return summarizeExecutionResult(full)
  })
}
