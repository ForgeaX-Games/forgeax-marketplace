import type { FastifyInstance, FastifyReply } from 'fastify'
import { executeNode, getGroup, getPipeline, type ExecuteNodeRequest } from '@forgeax/node-runtime'
import { getProjectDir, getRuntimeForProject } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { summarizeExecutionResult } from '../execution-summary.js'
import { syncTrace } from '../debug/syncTrace.js'
import type { TopologyGraphEdge, TopologyGraphNode } from '../lib/topologyGate.js'
import { buildExecutionLineage } from '../scene-script/lineage.js'
import { compileStoredSceneProject } from '../scene-script/projectCompiler.js'
import { getSceneContractRegistry } from '../scene-script/contracts.js'
import { readAuthoringState, readSceneModule, writeResultLineage } from '../scene-script/store.js'
import { createSceneDiagnostic, toPublicSceneDiagnostics, type SceneDiagnostic } from '@forgeax/scene-authoring'

/** Adapt `getPipeline`'s PipelineSnapshot (nodes may be an array or a map) into the edges+nodeById shape `summarizeExecutionResult`'s topology check expects. */
function currentGraphForTopologyCheck(
  runtime: Awaited<ReturnType<typeof getRuntimeForProject>>,
): { edges: readonly TopologyGraphEdge[]; nodeById: Map<string, TopologyGraphNode> } | undefined {
  const snap = getPipeline(runtime)
  if (!snap) return undefined
  const nodeById = new Map<string, TopologyGraphNode>()
  const rawNodes = snap.nodes
  if (Array.isArray(rawNodes)) {
    for (const n of rawNodes) {
      if (!n?.id) continue
      const group = n.opId === '__group__' ? getGroup(runtime, n.id) : null
      nodeById.set(n.id, { ...n, ...(group ? { exposedOutputs: group.exposedOutputs } : {}) })
    }
  } else if (rawNodes && typeof rawNodes === 'object') {
    for (const [id, n] of Object.entries(rawNodes as Record<string, TopologyGraphNode>)) {
      const nodeId = n.id ?? id
      const group = n.opId === '__group__' ? getGroup(runtime, nodeId) : null
      nodeById.set(id, { ...n, id: nodeId, ...(group ? { exposedOutputs: group.exposedOutputs } : {}) })
    }
  }
  const rawEdges = snap.edges
  const edges: TopologyGraphEdge[] = Array.isArray(rawEdges)
    ? rawEdges
    : rawEdges && typeof rawEdges === 'object'
      ? Object.values(rawEdges as Record<string, TopologyGraphEdge>)
      : []
  return { edges, nodeById }
}

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

async function canonicalExecutionCapture(
  projectId: string,
): Promise<{
  resultEntityIds: string[]
  resultCaptures: Array<{ entityId: string; kind: string; functionName: string; opId: string }>
  diagnostics: SceneDiagnostic[]
} | undefined> {
  const projectDir = await getProjectDir(projectId)
  if (!projectDir) return undefined
  const stored = await readSceneModule(projectDir)
  if (!stored.source.trim()) return undefined
  const project = await compileStoredSceneProject(projectDir, {
    entryFile: stored.file,
    entrySource: stored.source,
    projectId,
    registry: await getSceneContractRegistry(),
  })
  return {
    resultEntityIds: project.compiled.resultEntityIds,
    resultCaptures: project.compiled.resultCaptures ?? [],
    diagnostics: project.diagnostics,
  }
}

function rejectInvalidCanonicalExecution(
  reply: FastifyReply,
  capture: {
    resultEntityIds: string[]
    resultCaptures: Array<{ entityId: string; kind: string }>
    diagnostics: SceneDiagnostic[]
  } | undefined,
): unknown {
  if (!capture) return null
  const compileErrors = capture.diagnostics.filter((item) => item.severity === 'error')
  const missingCapture = compileErrors.length === 0 && capture.resultEntityIds.length === 0
  const sceneOutputs = capture.resultCaptures.filter((c) => c.kind === 'sceneOutput')
  const pairingErrors: SceneDiagnostic[] = []
  if (compileErrors.length === 0 && sceneOutputs.length !== 1) {
    pairingErrors.push(createSceneDiagnostic({
      code: 'SCENE_RESULT_CAPTURE_BLOCKOUT',
      phase: 'compile',
      severity: 'error',
      message: 'Canonical projects must declare exactly one sceneOutput.',
      expected: 'Exactly one sceneOutput',
      actual: `sceneOutput=${sceneOutputs.length}`,
      operation: 'sceneOutput',
    }))
  }
  const errors = compileErrors.length > 0
    ? compileErrors
    : missingCapture
      ? [createSceneDiagnostic({
          code: 'SCENE_RESULT_CAPTURE_REQUIRED',
          phase: 'compile',
          severity: 'error',
          message: 'Canonical Scene Script projects must declare a sceneOutput({ scene }) capture before execution.',
          expected: 'At least one compiled resultEntityId.',
          actual: 'No compiled resultEntityIds.',
          operation: 'sceneOutput',
          howToFix: [
            'Add sceneOutput({ scene: finalScene.scene }), then validate and put again.',
          ],
        })]
      : pairingErrors
  if (errors.length === 0) return null
  return reply.code(422).send({
    status: 'rejected',
    code: missingCapture ? 'scene-script-result-capture-required' : 'scene-script-execution-invalid',
    reason: errors[0]?.message ?? 'Canonical Scene Script is not executable.',
    diagnostics: toPublicSceneDiagnostics(errors, { applied: false, rolledBack: false }),
    verification: {
      ok: false,
      primaryFailure: 'structural',
      finalOutput: {
        ok: false,
        resultEntityIds: capture.resultEntityIds,
        totalSceneCells: 0,
      },
    },
  })
}

export async function registerExecuteRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId'

  app.post<{ Params: ProjectParams }>(`${prefix}/execute`, async (req, reply) => {
    const { projectId } = req.params
    const body = parseExecuteBody(req.body)
    syncTrace('backend:execute', { projectId, nodeId: (body as { nodeId?: string }).nodeId ?? '(full)', quietErrors: body.quietErrors })
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const capture = await canonicalExecutionCapture(projectId)
    const rejected = rejectInvalidCanonicalExecution(reply, capture)
    if (rejected) return rejected
    const __t0 = Date.now()
    const runtime = await getRuntimeForProject(projectId)
    const handle = await executeNode(runtime, body)
    const result = await handle.done
    syncTrace('backend:execute-done', {
      projectId,
      status: result.status,
      outputNodes: result.outputs ? Object.keys(result.outputs).length : 0,
    })
    // Unconditional (not gated behind FORGEAX_DEBUG_SYNC, same rationale as
    // [output-batch-trace]): a cold project's first open runs autoExecuteOnOpen()
    // — an actual full-graph *compute*, not a fetch — whenever any visible output
    // is missing from cache. That's real CPU/IO work (re-running every op, including
    // whatever produces the multi-hundred-MB g_veg_*/n_merge/n_flatten intermediates
    // documented in wb-scene-generator-project-switch.md §2.10-§2.12) and, unlike
    // every other step in that doc, had no default timing visibility at all —
    // `result.durationMs` was computed but only ever returned in the HTTP body,
    // never printed anywhere.
    const mem = process.memoryUsage()
    console.log(
      `[execute-trace] project=${projectId} nodeId=${(body as { nodeId?: string }).nodeId ?? '(full)'} ` +
        `status=${result.status} outputNodes=${result.outputs ? Object.keys(result.outputs).length : 0} ` +
        `runtimeDurationMs=${result.durationMs} routeTotalMs=${Date.now() - __t0} ` +
        `rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
    )
    const projectDir = await getProjectDir(projectId)
    const authoring = projectDir ? await readAuthoringState(projectDir) : null
    if (!authoring) return result
    const lineage = buildExecutionLineage(
      result,
      authoring.sourceMap,
      (nodeId, port) => runtime.outputs.read(nodeId, port)?.data,
    )
    await writeResultLineage(projectDir!, lineage)
    const byPort = new Map(lineage.map((entry) => [`${entry.runtime.nodeId}\0${entry.runtime.port}`, entry]))
    const resultMetadata = Object.fromEntries(Object.entries(result.resultMetadata ?? {}).map(([nodeId, ports]) => [
      nodeId,
      Object.fromEntries(Object.entries(ports).map(([port, metadata]) => {
        const entry = byPort.get(`${nodeId}\0${port}`)
        return [port, entry ? { ...metadata, authoring: entry.authoring, lineageRef: entry.lineageId } : metadata]
      })),
    ]))
    return { ...result, resultMetadata, lineage }
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/execute/summary`, async (req, reply) => {
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const capture = await canonicalExecutionCapture(projectId)
    const rejected = rejectInvalidCanonicalExecution(reply, capture)
    if (rejected) return rejected
    const runtime = await getRuntimeForProject(projectId)
    const handle = await executeNode(runtime, parseExecuteBody(req.body))
    const full = await handle.done
    // 2026-07-01：可选的上游叙事/契约地点名单——传了就顺带跑一遍 stage3.location_names
    // 硬门控（见 execution-summary.ts / lib/locationNameGate.ts）。不传则完全不变。
    const narrativeLocationNames = (req.body as { narrativeLocationNames?: unknown } | undefined)?.narrativeLocationNames
    // 2026-07-15：同一次 execute 顺带跑拓扑检测（Rest fan-out / 非法局部
    // merge / 领域口直连根 merge / manual_points 零默认），见
    // lib/topologyGate.ts 的模块文档。
    // 图本身已经在手（刚 execute 完的这个 runtime），零额外开销地顺带跑一次。
    return summarizeExecutionResult(
      full,
      Array.isArray(narrativeLocationNames) ? narrativeLocationNames.filter((n): n is string => typeof n === 'string') : undefined,
      currentGraphForTopologyCheck(runtime),
      capture?.resultEntityIds,
    )
  })
}
