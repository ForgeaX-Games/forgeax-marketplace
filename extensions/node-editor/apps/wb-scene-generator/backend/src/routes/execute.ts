import type { FastifyInstance } from 'fastify'
import { executeNode, type ExecuteNodeRequest } from '@forgeax/node-runtime'
import { getRuntimeForProject } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { summarizeExecutionResult } from '../execution-summary.js'
import { syncTrace } from '../debug/syncTrace.js'

interface ProjectParams {
  projectId: string
}

function parseExecuteBody(body: unknown): ExecuteNodeRequest {
  const b = (body ?? {}) as { nodeId?: string; quietErrors?: boolean }
  return {
    ...(b.nodeId ? { nodeId: b.nodeId } : {}),
    ...(b.quietErrors ? { quietErrors: true } : {}),
  }
}

export async function registerExecuteRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId'

  app.post<{ Params: ProjectParams }>(`${prefix}/execute`, async (req, reply) => {
    const { projectId } = req.params
    const body = parseExecuteBody(req.body)
    syncTrace('backend:execute', { projectId, nodeId: (body as { nodeId?: string }).nodeId ?? '(full)', quietErrors: body.quietErrors })
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const handle = await executeNode(await getRuntimeForProject(projectId), body)
    const result = await handle.done
    syncTrace('backend:execute-done', {
      projectId,
      status: result.status,
      outputNodes: result.outputs ? Object.keys(result.outputs).length : 0,
    })
    return result
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/execute/summary`, async (req, reply) => {
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const handle = await executeNode(await getRuntimeForProject(projectId), parseExecuteBody(req.body))
    const full = await handle.done
    // 2026-07-01：可选的上游叙事/契约地点名单——传了就顺带跑一遍 stage3.location_names
    // 硬门控（见 execution-summary.ts / lib/locationNameGate.ts）。不传则完全不变。
    const narrativeLocationNames = (req.body as { narrativeLocationNames?: unknown } | undefined)?.narrativeLocationNames
    return summarizeExecutionResult(
      full,
      Array.isArray(narrativeLocationNames) ? narrativeLocationNames.filter((n): n is string => typeof n === 'string') : undefined,
    )
  })
}
