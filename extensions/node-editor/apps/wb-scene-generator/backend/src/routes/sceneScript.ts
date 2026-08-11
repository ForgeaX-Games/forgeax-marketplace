import type { FastifyInstance } from 'fastify'

import {
  applyAuthoringCommands,
  applyProjectAuthoringCommands,
  artifactHash,
  createSceneArtifact,
  compiledOpsToKernelGraph,
  liftLegacyRuntimeGraph,
  parseSceneModule,
  printSceneModule,
  SCENE_SCRIPT_VERSION,
  stableEntityId,
  toPublicSceneDiagnostics,
  type AuthoringCommand,
  type SceneDiagnostic,
} from '@forgeax/scene-authoring'
import {
  createRuntime,
  executeNode,
  getPipeline,
  importPipelineGraph,
  listGroups,
  type KernelGraphV1,
} from '@forgeax/node-runtime'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { getProjectDir, getRuntimeForProject } from '../runtime.js'
import { getProjectSceneContractRegistry, getSceneContractRegistry } from '../scene-script/contracts.js'
import {
  NOT_APPLIED,
  rejectedSceneScriptPayload,
  revisionConflictDiagnostic,
  runtimeImportDiagnostics,
} from '../scene-script/diagnostics.js'
import { compileStoredSceneProject, resolveSceneImport } from '../scene-script/projectCompiler.js'
import {
  createSceneModuleFile,
  deleteSceneModuleFile,
  layoutKey,
  listSceneProjectFiles,
  moveSceneModuleFile,
  readSceneArtifactBundle,
  readAuthoringLayout,
  readSceneModule,
  SceneModuleInUseError,
  writeSceneModule,
  writeSceneArtifactBundle,
  writeSceneProjectTransaction,
} from '../scene-script/store.js'
import { ensureMutationAccess, extractCaller } from './projects.js'
import { queryResultLineage } from '../scene-script/lineage.js'
import {
  applyAuthoringHistory,
  captureAuthoringSourceSnapshot,
  getAuthoringHistoryStatus,
  recordAuthoringTransaction,
  restoreAuthoringSourceSnapshot,
  type AuthoringSourceSnapshot,
} from '../scene-script/transactionHistory.js'

interface ProjectParams {
  projectId: string
}

interface SceneScriptQuery {
  file?: string
}

interface SceneScriptBody {
  file?: string
  source?: string
  expectedRevision?: string
  canonicalize?: boolean
  label?: string
}

interface SceneCommandBody {
  file?: string
  expectedRevision?: string
  expectedProjectRevision?: string
  expectedModuleRevisions?: Record<string, string>
  commands: AuthoringCommand[]
  label?: string
}

async function canonicalSnapshot(projectDir: string): Promise<AuthoringSourceSnapshot | null> {
  const stored = await readSceneModule(projectDir)
  if (!stored.source.trim() || !stored.state) return null
  return captureAuthoringSourceSnapshot(projectDir, stored.file)
}

async function rollbackSourceSnapshot(
  projectId: string,
  projectDir: string,
  snapshot: AuthoringSourceSnapshot | null,
  label: string,
): Promise<void> {
  if (!snapshot) return
  await restoreAuthoringSourceSnapshot(projectId, projectDir, snapshot, {
    actor: 'scene-script:rollback',
    label,
  })
}

function uniqueBinding(functionName: string, existing: Set<string>): string {
  const normalized = functionName.replace(/[^A-Za-z0-9_$]/g, '') || 'definition'
  const base = /^[A-Za-z_$]/.test(normalized) ? normalized : `definition${normalized}`
  if (!existing.has(base)) return base
  let suffix = 2
  while (existing.has(`${base}${suffix}`)) suffix += 1
  return `${base}${suffix}`
}

function hasErrors(diagnostics: readonly SceneDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error')
}

function applyStoredLayout(
  graph: KernelGraphV1,
  layout: Record<string, { x: number; y: number }> | undefined,
  sourceMap?: Array<{ moduleId: string; statementId: string; entityId: string; runtimeNodeIds: string[] }>,
): KernelGraphV1 {
  if (!layout) return graph
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : Object.values(graph.nodes)
  const groups = graph.groups
    ? (Array.isArray(graph.groups) ? graph.groups : Object.values(graph.groups))
    : []
  for (const node of nodes) {
    const mapped = sourceMap?.find((entry) => entry.entityId === node.id || entry.runtimeNodeIds.includes(node.id))
    const position = (mapped ? layout[layoutKey(mapped.moduleId, mapped.statementId)] : undefined) ?? layout[node.id]
    if (position) node.position = { ...position }
  }
  for (const group of groups) {
    const mapped = sourceMap?.find((entry) => entry.entityId === group.id || entry.runtimeNodeIds.includes(group.id))
    const position = (mapped ? layout[layoutKey(mapped.moduleId, mapped.statementId)] : undefined) ?? layout[group.id]
    if (position) group.position = { ...position }
  }
  return graph
}

function remapStatementLayout(
  layout: Record<string, { x: number; y: number }>,
  before: Array<{ moduleId: string; statementId: string }>,
  after: Array<{ moduleId: string; statementId: string }>,
): Record<string, { x: number; y: number }> {
  const result = { ...layout }
  for (const next of after) {
    const previous = before.find((item) => item.statementId === next.statementId)
    if (!previous) continue
    const position = layout[layoutKey(previous.moduleId, previous.statementId)]
    if (!position) continue
    delete result[layoutKey(previous.moduleId, previous.statementId)]
    result[layoutKey(next.moduleId, next.statementId)] = position
  }
  return result
}

async function currentRuntimeGraph(projectId: string): Promise<KernelGraphV1 | undefined> {
  const runtime = await getRuntimeForProject(projectId)
  const pipeline = getPipeline(runtime)
  if (!pipeline) return undefined
  const groups = listGroups(runtime)
  return {
    nodes: pipeline.nodes,
    edges: pipeline.edges,
    ...(groups.length ? { groups } : {}),
    ...(pipeline.metadata ? { metadata: pipeline.metadata } : {}),
  }
}

async function executeLiftCandidate(projectId: string, graph: KernelGraphV1): Promise<{ resultHash: string }> {
  const sourceRuntime = await getRuntimeForProject(projectId)
  const scratch = await mkdtemp(resolve(tmpdir(), 'forgeax-scene-lift-'))
  const runtime = createRuntime({
    projectRoot: scratch,
    pipelineId: `lift-${projectId}`,
    pluginId: sourceRuntime.config.pluginId,
    registry: sourceRuntime.registry,
    ...(sourceRuntime.config.gameRoot ? { gameRoot: sourceRuntime.config.gameRoot } : {}),
    ...(sourceRuntime.config.createExecutionContext
      ? { createExecutionContext: sourceRuntime.config.createExecutionContext }
      : {}),
    layout: {
      assetsDir: sourceRuntime.config.layout?.assetsDir
        ?? resolve(sourceRuntime.config.projectRoot, 'assets'),
    },
  })
  try {
    const imported = await importPipelineGraph(runtime, { format: 'kernel-graph-v1', graph }, {
      mode: 'replace',
      actor: 'scene-lift:verify',
    })
    if (imported.status !== 'ok') return { resultHash: artifactHash({ status: 'import-rejected', reason: imported.reason }) }
    const result = await (await executeNode(runtime, {})).done
    const outputs = Object.values(result.outputs ?? {}).flatMap((ports) =>
      Object.entries(ports).map(([port, value]) => ({ port, valueHash: artifactHash(value) })))
      .sort((left, right) => left.port.localeCompare(right.port) || left.valueHash.localeCompare(right.valueHash))
    return { resultHash: artifactHash({ status: result.status, outputs }) }
  } finally {
    runtime.dispose()
    await rm(scratch, { recursive: true, force: true })
  }
}

export async function registerSceneScriptRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId/scene-script'

  app.get<{ Params: ProjectParams }>(`${prefix}/project-info`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const stored = await readSceneModule(projectDir)
    const files = await listSceneProjectFiles(projectDir)
    const history = await getAuthoringHistoryStatus(projectDir)
    return {
      projectId: req.params.projectId,
      canonical: stored.source.trim().length > 0,
      authoringSource: stored.source.trim().length > 0 ? 'scene-project' : 'legacy-runtime-graph',
      runtimeGraphRole: 'cache-debug-export',
      migrationRequired: stored.source.trim().length === 0,
      canonicalModule: stored.file,
      revision: stored.revision,
      projectRevision: stored.state?.projectRevision ?? stored.state?.sourceRevision ?? stored.revision,
      moduleRevisions: stored.state?.moduleRevisions ?? {},
      moduleCount: files.filter((file) => file.kind === 'module').length,
      files,
      sourceMapEntries: stored.state?.sourceMap.length ?? 0,
      updatedAt: stored.state?.updatedAt ?? null,
      history,
    }
  })

  app.post<{
    Params: ProjectParams
    Body: { expectedProjectRevision?: string }
  }>(`${prefix}/undo`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.body?.expectedProjectRevision !== 'string') {
      return reply.code(400).send({ reason: 'expectedProjectRevision is required' })
    }
    try {
      return await applyAuthoringHistory(
        req.params.projectId,
        projectDir,
        'undo',
        req.body.expectedProjectRevision,
      )
    } catch (error) {
      const item = error as Error & { code?: string; actualRevision?: string }
      const status = item.code === 'SCENE_REVISION_CONFLICT' || item.code === 'SCENE_HISTORY_DIVERGED'
        ? 409
        : item.code === 'SCENE_UNDO_EMPTY' ? 409 : 422
      return reply.code(status).send({
        status: 'rejected',
        code: item.code,
        reason: item.message,
        transaction: { applied: false, rolledBack: true },
        ...(item.actualRevision ? { actualProjectRevision: item.actualRevision } : {}),
      })
    }
  })

  app.post<{
    Params: ProjectParams
    Body: { expectedProjectRevision?: string }
  }>(`${prefix}/redo`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.body?.expectedProjectRevision !== 'string') {
      return reply.code(400).send({ reason: 'expectedProjectRevision is required' })
    }
    try {
      return await applyAuthoringHistory(
        req.params.projectId,
        projectDir,
        'redo',
        req.body.expectedProjectRevision,
      )
    } catch (error) {
      const item = error as Error & { code?: string; actualRevision?: string }
      const status = item.code === 'SCENE_REVISION_CONFLICT' || item.code === 'SCENE_HISTORY_DIVERGED'
        ? 409
        : item.code === 'SCENE_REDO_EMPTY' ? 409 : 422
      return reply.code(status).send({
        status: 'rejected',
        code: item.code,
        reason: item.message,
        transaction: { applied: false, rolledBack: true },
        ...(item.actualRevision ? { actualProjectRevision: item.actualRevision } : {}),
      })
    }
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/raw-graph`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const stored = await readSceneModule(projectDir)
    if (stored.source.trim()) {
      return reply.code(410).send({
        status: 'rejected',
        code: 'raw-graph-not-authoring-source',
        reason: 'Canonical projects expose Runtime Graph only through cache/debug/export endpoints.',
      })
    }
    const rawGraph = await currentRuntimeGraph(req.params.projectId)
    if (!rawGraph) return reply.code(404).send({ reason: 'legacy Runtime Graph not found' })
    return {
      readOnly: true,
      newProjectsAllowed: false,
      authoringSource: 'legacy-runtime-graph',
      rawGraph,
    }
  })

  app.post<{ Params: ProjectParams; Body: { confirmMedium?: boolean } }>(`${prefix}/lift`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const stored = await readSceneModule(projectDir)
    if (stored.source.trim()) {
      return reply.code(409).send({
        status: 'rejected',
        code: 'scene-project-already-canonical',
        reason: 'This project already has a canonical Scene Project.',
      })
    }
    const rawGraph = await currentRuntimeGraph(req.params.projectId)
    if (!rawGraph) return reply.code(404).send({ reason: 'legacy Runtime Graph not found' })
    const registry = await getProjectSceneContractRegistry(projectDir)
    const lifted = await liftLegacyRuntimeGraph(rawGraph, registry, {
      projectId: req.params.projectId,
      file: stored.file,
      execute: (candidate) => executeLiftCandidate(req.params.projectId, candidate),
    })
    if (!lifted.canonical || !lifted.source || !lifted.module) {
      return reply.code(lifted.status === 'read-only' ? 422 : 409).send(lifted)
    }
    const compiled = await compileStoredSceneProject(projectDir, {
      entryFile: stored.file,
      entrySource: lifted.source,
      projectId: req.params.projectId,
      registry,
    })
    if (hasErrors(compiled.diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Lifted Scene Project failed canonical compilation.',
        compiled.diagnostics,
      ))
    }
    const next = await writeSceneModule(
      projectDir,
      stored.file,
      lifted.source,
      compiled.compiled.sourceMap,
      lifted.semanticParity.liftedGraphHash,
    )
    return {
      ...lifted,
      revision: next.revision,
      sourceMap: compiled.compiled.sourceMap,
    }
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/artifact`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const artifact = await readSceneArtifactBundle(projectDir)
    if (!artifact) return reply.code(404).send({ reason: 'Scene artifact has not been generated' })
    return artifact
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/artifact`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const stored = await readSceneModule(projectDir)
    if (!stored.source.trim()) {
      return reply.code(409).send({
        status: 'rejected',
        code: 'scene-script-not-canonical',
        reason: 'Legacy projects must be lifted before a Scene artifact can be generated.',
      })
    }
    const registry = await getSceneContractRegistry()
    const project = await compileStoredSceneProject(projectDir, {
      entryFile: stored.file,
      entrySource: stored.source,
      projectId: req.params.projectId,
      registry,
    })
    if (hasErrors(project.diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload('Scene artifact compilation failed.', project.diagnostics))
    }
    const sources = Object.fromEntries(await Promise.all(Object.values(project.modules).map(async (module) => [
      module.file,
      (await readSceneModule(projectDir, module.file)).source,
    ])))
    const runtimeSnapshot = await currentRuntimeGraph(req.params.projectId)
    const bundle = createSceneArtifact({
      projectId: req.params.projectId,
      project: { entryModuleId: project.compiled.module.moduleId, modules: project.modules },
      sources,
      entityIds: project.compiled.entityIds,
      layout: await readAuthoringLayout(projectDir),
      sourceMap: project.compiled.sourceMap,
      compilerVersion: 'scene-authoring-0.1',
      sceneScriptVersion: SCENE_SCRIPT_VERSION,
      contractVersions: Object.fromEntries(registry.list().map((contract) => [
        contract.functionName,
        contract.definitionVersion ?? contract.contractVersion,
      ])),
      captures: project.compiled.resultEntityIds,
      resultLineage: stored.state?.resultLineage ?? [],
      ...(runtimeSnapshot ? { runtimeSnapshot } : {}),
      diagnostics: project.diagnostics,
    })
    await writeSceneArtifactBundle(projectDir, bundle)
    return bundle
  })

  app.get<{ Params: ProjectParams; Querystring: SceneScriptQuery }>(prefix, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    try {
      return await readSceneModule(projectDir, req.query.file)
    } catch (error) {
      return reply.code(400).send({ reason: error instanceof Error ? error.message : String(error) })
    }
  })

  app.post<{ Params: ProjectParams; Body: { file?: string; source?: string } }>(`${prefix}/files`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.body?.file !== 'string') return reply.code(400).send({ reason: 'file is required' })
    const before = await canonicalSnapshot(projectDir)
    try {
      const module = await createSceneModuleFile(projectDir, req.body.file, req.body.source)
      if (before) {
        const after = await captureAuthoringSourceSnapshot(projectDir, before.entryFile)
        await restoreAuthoringSourceSnapshot(req.params.projectId, projectDir, after, {
          actor: 'scene-script:user',
          label: `Create Scene module ${module.file}`,
        })
        await recordAuthoringTransaction(projectDir, before, after, `Create Scene module ${module.file}`)
      }
      return reply.code(201).send(module)
    } catch (error) {
      await rollbackSourceSnapshot(req.params.projectId, projectDir, before, 'Rollback failed Scene module creation')
      return reply.code(409).send({ reason: error instanceof Error ? error.message : String(error) })
    }
  })

  app.patch<{ Params: ProjectParams; Body: { from?: string; to?: string } }>(`${prefix}/files`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.body?.from !== 'string' || typeof req.body?.to !== 'string') {
      return reply.code(400).send({ reason: 'from and to are required' })
    }
    const before = await canonicalSnapshot(projectDir)
    try {
      const module = await moveSceneModuleFile(projectDir, req.body.from, req.body.to)
      if (before) {
        const after = await captureAuthoringSourceSnapshot(projectDir, before.entryFile)
        await restoreAuthoringSourceSnapshot(req.params.projectId, projectDir, after, {
          actor: 'scene-script:user',
          label: `Move Scene module ${req.body.from} to ${req.body.to}`,
        })
        await recordAuthoringTransaction(
          projectDir,
          before,
          after,
          `Move Scene module ${req.body.from} to ${req.body.to}`,
        )
      }
      return module
    } catch (error) {
      await rollbackSourceSnapshot(req.params.projectId, projectDir, before, 'Rollback failed Scene module move')
      return reply.code(409).send({ reason: error instanceof Error ? error.message : String(error) })
    }
  })

  app.delete<{ Params: ProjectParams; Querystring: { file?: string } }>(`${prefix}/files`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    if (typeof req.query.file !== 'string') return reply.code(400).send({ reason: 'file is required' })
    const before = await canonicalSnapshot(projectDir)
    try {
      await deleteSceneModuleFile(projectDir, req.query.file)
      if (before) {
        const after = await captureAuthoringSourceSnapshot(projectDir, before.entryFile)
        await restoreAuthoringSourceSnapshot(req.params.projectId, projectDir, after, {
          actor: 'scene-script:user',
          label: `Delete Scene module ${req.query.file}`,
        })
        await recordAuthoringTransaction(projectDir, before, after, `Delete Scene module ${req.query.file}`)
      }
      return reply.code(204).send()
    } catch (error) {
      await rollbackSourceSnapshot(req.params.projectId, projectDir, before, 'Rollback failed Scene module deletion')
      if (error instanceof SceneModuleInUseError) {
        return reply.code(409).send({
          status: 'rejected',
          code: error.code,
          reason: error.message,
          impact: { module: error.file, importers: error.importers },
        })
      }
      return reply.code(409).send({ reason: error instanceof Error ? error.message : String(error) })
    }
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/contracts`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const registry = await getProjectSceneContractRegistry(projectDir)
    return {
      version: '0.1',
      functions: registry.list()
        .filter((contract) => contract.agentVisible !== false)
        .map(({ definition: _definition, ...contract }) => contract),
    }
  })

  app.get<{
    Params: ProjectParams
    Querystring: SceneScriptQuery & {
      statementId?: string
      entityId?: string
      sceneNodeId?: string
      path?: string
      bakedLayerId?: string
      runtimeNodeId?: string
    }
  }>(`${prefix}/lens`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const stored = await readSceneModule(projectDir, req.query.file)
    const lineageQuery = req.query.sceneNodeId ?? req.query.path ?? req.query.bakedLayerId ?? req.query.runtimeNodeId
    if (lineageQuery) {
      const matches = queryResultLineage(stored.state?.resultLineage ?? [], req.query)
      if (!matches.length) {
        return reply.code(404).send({ reason: `lineage not found: ${lineageQuery}` })
      }
      return {
        revision: stored.revision,
        query: {
          ...(req.query.sceneNodeId ? { sceneNodeId: req.query.sceneNodeId } : {}),
          ...(req.query.path ? { path: req.query.path } : {}),
          ...(req.query.bakedLayerId ? { bakedLayerId: req.query.bakedLayerId } : {}),
          ...(req.query.runtimeNodeId ? { runtimeNodeId: req.query.runtimeNodeId } : {}),
        },
        count: matches.length,
        lineage: matches,
        summary: {
          sceneNodeCount: matches.reduce((count, item) => count + item.summary.sceneNodeCount, 0),
          bakedLayerCount: matches.reduce((count, item) => count + item.summary.bakedLayerCount, 0),
          payload: 'reference-only',
        },
      }
    }
    const registry = await getProjectSceneContractRegistry(projectDir)
    const parsed = parseSceneModule(stored.source, {
      file: stored.file,
      registry,
    })
    const mappedStatementId = req.query.entityId
      ? stored.state?.sourceMap.find((item) => item.entityId === req.query.entityId)?.statementId
      : undefined
    const statementId = req.query.statementId ?? mappedStatementId
    const target = parsed.module.statements.find((item) => item.statementId === statementId)
    if (!target) return reply.code(404).send({ reason: `authoring entity not found: ${statementId ?? req.query.entityId ?? ''}` })
    const referencedBindings = new Set(
      Object.values(target.args)
        .filter((item) => item.kind === 'reference')
        .map((item) => item.kind === 'reference' ? item.binding : ''),
    )
    const upstream = parsed.module.statements.filter((item) => item.binding && referencedBindings.has(item.binding))
    const downstream = target.binding
      ? parsed.module.statements.filter((item) =>
          Object.values(item.args).some((arg) => arg.kind === 'reference' && arg.binding === target.binding),
        )
      : []
    const contract = registry.get(target.functionName)
    const { definition: _definition, ...publicContract } = contract ?? {}
    return {
      revision: stored.revision,
      file: stored.file,
      target,
      upstream,
      downstream,
      contract: contract ? publicContract : null,
      sealed: contract?.kind !== 'atomic',
      allowedAgentActions: contract?.capabilities?.agent ?? ['configure', 'connect', 'move', 'replace', 'remove'],
      diagnostics: parsed.diagnostics,
    }
  })

  app.post<{
    Params: ProjectParams & { functionName: string }
    Body: { position?: { x?: number; y?: number } }
  }>(`${prefix}/definitions/:functionName/instantiate`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const stored = await readSceneModule(projectDir)
    if (!stored.source.trim()) {
      return reply.code(409).send({
        status: 'rejected',
        code: 'scene-script-not-canonical',
        reason: 'This project has no canonical Scene Script. Native Definition instantiation is unavailable.',
      })
    }
    const beforeSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)

    const registry = await getProjectSceneContractRegistry(projectDir)
    const contract = registry.get(req.params.functionName)
    if (!contract || (contract.kind !== 'group' && contract.kind !== 'template') || !contract.definitionId) {
      return reply.code(404).send({
        status: 'rejected',
        code: 'native-definition-not-found',
        reason: `Published native Definition not found: ${req.params.functionName}`,
      })
    }

    const parsed = parseSceneModule(stored.source, {
      file: stored.file,
      registry,
    })
    if (hasErrors(parsed.diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Canonical Scene Script has structured diagnostics.',
        parsed.diagnostics,
      ))
    }
    const bindings = new Set(parsed.module.statements.flatMap((statement) => statement.binding ? [statement.binding] : []))
    const statementIds = new Set(parsed.module.statements.map((statement) => statement.statementId))
    let nonce = parsed.module.statements.length
    let statementId = stableEntityId(
      'stmt',
      `${req.params.projectId}:${stored.file}:${contract.functionName}:${nonce}`,
    )
    while (statementIds.has(statementId)) {
      nonce += 1
      statementId = stableEntityId(
        'stmt',
        `${req.params.projectId}:${stored.file}:${contract.functionName}:${nonce}`,
      )
    }
    const transformed = applyAuthoringCommands(
      parsed.module,
      [{
        type: 'addCall',
        functionName: contract.functionName,
        binding: uniqueBinding(contract.functionName, bindings),
        statementId,
      }],
      { actor: 'user', registry },
    )
    const source = printSceneModule(transformed.module)
    const projectCompile = await compileStoredSceneProject(projectDir, {
      entryFile: stored.file,
      entrySource: source,
      projectId: req.params.projectId,
      registry: await getSceneContractRegistry(),
    })
    const diagnostics = [...transformed.diagnostics, ...projectCompile.diagnostics]
    if (hasErrors(diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Native Definition authoring transaction was rejected.',
        diagnostics,
      ))
    }
    const sourceEntry = projectCompile.compiled.sourceMap.find((entry) => entry.statementId === statementId)
    if (!sourceEntry) {
      return reply.code(422).send({
        status: 'rejected',
        reason: `Native Definition call '${statementId}' produced no public authoring entity.`,
      })
    }
    const position = {
      x: typeof req.body?.position?.x === 'number' ? req.body.position.x : 0,
      y: typeof req.body?.position?.y === 'number' ? req.body.position.y : 0,
    }
    const layout = {
      ...await readAuthoringLayout(projectDir),
      [layoutKey(sourceEntry.moduleId, sourceEntry.statementId)]: position,
    }
    const graph = applyStoredLayout(compiledOpsToKernelGraph(projectCompile.compiled.ops), layout, projectCompile.compiled.sourceMap)
    const imported = await importPipelineGraph(
      await getRuntimeForProject(req.params.projectId),
      { format: 'kernel-graph-v1', graph },
      {
        mode: 'replace',
        actor: 'scene-script:user',
        label: `Add native Definition ${contract.functionName}`,
      },
    )
    if (imported.status !== 'ok') {
      return reply.code(422).send(rejectedSceneScriptPayload(
        imported.reason ?? 'Runtime Graph import was rejected.',
        runtimeImportDiagnostics(imported.diagnostics),
        { transaction: { applied: false, rolledBack: true } },
      ))
    }
    const next = await writeSceneModule(
      projectDir,
      stored.file,
      source,
      projectCompile.compiled.sourceMap,
      imported.newHash,
      layout,
    )
    try {
      const afterSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)
      await recordAuthoringTransaction(
        projectDir,
        beforeSnapshot,
        afterSnapshot,
        `Add native Definition ${contract.functionName}`,
      )
    } catch (error) {
      await rollbackSourceSnapshot(
        req.params.projectId,
        projectDir,
        beforeSnapshot,
        'Rollback unrecorded native Definition transaction',
      )
      throw error
    }
    return {
      status: 'ok',
      entityId: sourceEntry.entityId,
      statementId,
      revision: next.revision,
      graphHash: imported.newHash,
      transaction: {
        applied: true,
        rolledBack: false,
        ...(imported.batchId ? { undoToken: imported.batchId } : {}),
      },
    }
  })

  app.post<{ Params: ProjectParams; Body: SceneScriptBody }>(`${prefix}/validate`, async (req, reply) => {
    const source = req.body?.source
    if (typeof source !== 'string') return reply.code(400).send({ reason: 'source must be a string' })
    const file = req.body.file ?? 'main.scene.ts'
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const registry = await getSceneContractRegistry()
    const parsed = parseSceneModule(source, { file, registry })
    const { compiled, diagnostics } = await compileStoredSceneProject(projectDir, {
      entryFile: file,
      entrySource: source,
      projectId: req.params.projectId,
      registry,
    })
    const parseFailed = diagnostics.some((item) => item.phase === 'parse' && item.severity === 'error')
    return {
      valid: !hasErrors(diagnostics),
      diagnostics: toPublicSceneDiagnostics(diagnostics, NOT_APPLIED),
      canonicalSource: printSceneModule(parsed.module),
      transaction: NOT_APPLIED,
      ...(!parseFailed
        ? {
            sourceMap: compiled.sourceMap,
            entityCount: compiled.entityIds.length,
            operationCount: compiled.ops.length,
          }
        : {}),
    }
  })

  app.put<{ Params: ProjectParams; Body: SceneScriptBody }>(prefix, async (req, reply) => {
    const source = req.body?.source
    if (typeof source !== 'string') return reply.code(400).send({ reason: 'source must be a string' })
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)

    const current = await readSceneModule(projectDir, req.body.file)
    if (req.body.expectedRevision && req.body.expectedRevision !== current.revision) {
      const diagnostic = revisionConflictDiagnostic(req.body.expectedRevision, current.revision)
      return reply.code(409).send(rejectedSceneScriptPayload(
        diagnostic.message,
        [diagnostic],
        {
          code: diagnostic.code,
          compatibility: {
            expectedRevision: req.body.expectedRevision,
            actualRevision: current.revision,
          },
        },
      ))
    }
    const beforeSnapshot = await canonicalSnapshot(projectDir)

    const registry = await getSceneContractRegistry()
    const file = req.body.file ?? 'main.scene.ts'
    const parsed = parseSceneModule(source, { file, registry })
    const canonicalSource = req.body.canonicalize === false || hasErrors(parsed.diagnostics)
      ? source
      : printSceneModule(parsed.module)
    const projectCompile = await compileStoredSceneProject(projectDir, {
      entryFile: file,
      entrySource: canonicalSource,
      projectId: req.params.projectId,
      registry,
    })
    const compiled = projectCompile.compiled
    const diagnostics = projectCompile.diagnostics
    if (hasErrors(diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Scene Script has structured diagnostics.',
        diagnostics,
      ))
    }

    const currentLayout = await readAuthoringLayout(projectDir)
    const runtimeGraph = applyStoredLayout(
      compiledOpsToKernelGraph(compiled.ops),
      currentLayout,
      compiled.sourceMap,
    )
    const previousRuntimeGraph = await currentRuntimeGraph(req.params.projectId)
    const caller = extractCaller(req)
    const imported = await importPipelineGraph(
      await getRuntimeForProject(req.params.projectId),
      { format: 'kernel-graph-v1', graph: runtimeGraph },
      {
        mode: 'replace',
        actor: caller.kind === 'ai' ? 'scene-script:agent' : 'scene-script:user',
        label: req.body.label ?? 'Compile Scene Script',
      },
    )
    if (imported.status !== 'ok') {
      return reply.code(422).send(rejectedSceneScriptPayload(
        imported.reason ?? 'Runtime Graph import was rejected.',
        [...diagnostics, ...runtimeImportDiagnostics(imported.diagnostics)],
        { transaction: { applied: false, rolledBack: true } },
      ))
    }

    const dependencyGraph = Object.fromEntries(Object.entries(projectCompile.incremental.modules).map(
      ([moduleId, item]) => [moduleId, {
        dependencies: item.dependencies,
        dependents: item.dependents,
        publicSignatureHash: item.publicSignatureHash,
        semanticHash: item.semanticHash,
      }],
    ))
    let stored
    try {
      const state = await writeSceneProjectTransaction(
        projectDir,
        file,
        [{ file, source: canonicalSource }],
        compiled.sourceMap,
        imported.newHash,
        dependencyGraph,
        currentLayout,
      )
      stored = await readSceneModule(projectDir, file)
      stored.state = state
      if (beforeSnapshot) {
        const afterSnapshot = await captureAuthoringSourceSnapshot(projectDir, beforeSnapshot.entryFile)
        await recordAuthoringTransaction(
          projectDir,
          beforeSnapshot,
          afterSnapshot,
          req.body.label ?? 'Compile Scene Script',
        )
      }
    } catch (error) {
      if (previousRuntimeGraph) {
        await importPipelineGraph(
          await getRuntimeForProject(req.params.projectId),
          { format: 'kernel-graph-v1', graph: previousRuntimeGraph },
          { mode: 'replace', actor: 'scene-script:rollback', label: 'Rollback failed Scene Script transaction' },
        )
      }
      await rollbackSourceSnapshot(
        req.params.projectId,
        projectDir,
        beforeSnapshot,
        'Rollback unrecorded Scene Script transaction',
      )
      throw error
    }
    return {
      status: 'ok',
      revision: stored.revision,
      graphHash: imported.newHash,
      diagnostics: toPublicSceneDiagnostics(diagnostics),
      transaction: {
        applied: true,
        rolledBack: false,
        ...(imported.batchId ? { undoToken: imported.batchId } : {}),
      },
      sourceMap: compiled.sourceMap,
      canonicalSource,
      entityCount: compiled.entityIds.length,
      operationCount: compiled.ops.length,
    }
  })

  app.post<{ Params: ProjectParams; Body: SceneCommandBody }>(`${prefix}/commands`, async (req, reply) => {
    if (!Array.isArray(req.body?.commands)
      || (typeof req.body.expectedRevision !== 'string' && typeof req.body.expectedProjectRevision !== 'string')) {
      return reply.code(400).send({ reason: 'commands and expectedProjectRevision are required' })
    }
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: `project not found: ${req.params.projectId}` })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const stored = await readSceneModule(projectDir, req.body.file)
    const state = stored.state
    const beforeSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)
    const actualProjectRevision = state?.projectRevision ?? state?.sourceRevision ?? stored.revision
    const expectedProjectRevision = req.body.expectedProjectRevision ?? req.body.expectedRevision!
    const comparedActualRevision = req.body.expectedProjectRevision ? actualProjectRevision : stored.revision
    const conflictedModules = Object.entries(req.body.expectedModuleRevisions ?? {}).flatMap(([key, expected]) => {
      const match = Object.entries(state?.moduleRevisions ?? {}).find(
        ([file, item]) => file === key || item.moduleId === key,
      )
      return match && match[1].revision !== expected
        ? [{ file: match[0], moduleId: match[1].moduleId, expectedRevision: expected, actualRevision: match[1].revision }]
        : []
    })
    if (comparedActualRevision !== expectedProjectRevision || conflictedModules.length) {
      const diagnostic = revisionConflictDiagnostic(expectedProjectRevision, comparedActualRevision)
      const conflictStatements = req.body.commands
        .flatMap((command) => 'statementId' in command
          ? [command.statementId]
          : 'statementIds' in command ? command.statementIds : [])
      return reply.code(409).send(rejectedSceneScriptPayload(
        diagnostic.message,
        [diagnostic],
        {
          code: diagnostic.code,
          compatibility: {
            expectedRevision: expectedProjectRevision,
            actualRevision: comparedActualRevision,
            conflict: {
              expectedProjectRevision,
              actualProjectRevision: comparedActualRevision,
              modules: conflictedModules,
              statements: conflictStatements,
            },
          },
        },
      ))
    }
    const baseRegistry = await getSceneContractRegistry()
    const currentProject = await compileStoredSceneProject(projectDir, {
      entryFile: stored.file,
      entrySource: stored.source,
      projectId: req.params.projectId,
      registry: baseRegistry,
    })
    if (hasErrors(currentProject.diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Current Scene Script project has structured diagnostics.',
        currentProject.diagnostics,
      ))
    }
    const caller = extractCaller(req)
    const moduleByFile = new Map(Object.values(currentProject.modules).map((module) => [module.file, module]))
    const sourceMap = state?.sourceMap ?? currentProject.compiled.sourceMap
    const routedCommands: AuthoringCommand[] = []
    for (const command of req.body.commands) {
      const statementId = 'statementId' in command ? command.statementId : undefined
      const mapped = statementId ? sourceMap.find((item) =>
        item.statementId === statementId
        || item.entityId === statementId
        || item.runtimeNodeIds.includes(statementId)) : undefined
      const mappedSelectionOwner = 'statementIds' in command
        ? sourceMap.find((item) => command.statementIds.some((id) =>
            item.statementId === id || item.entityId === id || item.runtimeNodeIds.includes(id)))
        : undefined
      const module = (command.moduleId ? currentProject.modules[command.moduleId] : undefined)
        ?? (command.file ? moduleByFile.get(command.file) : undefined)
        ?? (mapped ? currentProject.modules[mapped.moduleId] : undefined)
        ?? (mappedSelectionOwner ? currentProject.modules[mappedSelectionOwner.moduleId] : undefined)
        ?? (command.moduleId === state?.moduleRevisions?.[stored.file]?.moduleId
          ? moduleByFile.get(stored.file)
          : undefined)
        ?? (!statementId ? moduleByFile.get(req.body.file ?? stored.file) : undefined)
      if (!module) {
        return reply.code(422).send(rejectedSceneScriptPayload(
          `Authoring command target '${statementId ?? command.file ?? command.moduleId ?? ''}' has no owning module.`,
          [{
            code: 'SCENE_COMMAND_MODULE_NOT_FOUND',
            phase: 'resolve',
            severity: 'error',
            message: `No owning Scene Script module was found for '${statementId ?? ''}'.`,
            statementId,
          }],
        ))
      }
      const mappedSelection = 'statementIds' in command
        ? command.statementIds.map((id) => sourceMap.find((item) =>
            item.statementId === id || item.entityId === id || item.runtimeNodeIds.includes(id))?.statementId ?? id)
        : undefined
      routedCommands.push({
        ...command,
        ...('statementId' in command && mapped ? { statementId: mapped.statementId } : {}),
        ...(mappedSelection ? { statementIds: mappedSelection } : {}),
        moduleId: module.moduleId,
      } as AuthoringCommand)
    }
    const fileToModuleId = new Map(Object.values(currentProject.modules).map((module) => [module.file, module.moduleId]))
    const transformed = applyProjectAuthoringCommands(
      { entryModuleId: currentProject.compiled.module.moduleId, modules: currentProject.modules },
      routedCommands,
      {
        actor: caller.kind === 'ai' ? 'agent' : 'user',
        registry: currentProject.registry,
        resolveImport: (fromModuleId, specifier) => {
          const fromFile = currentProject.modules[fromModuleId]?.file ?? fromModuleId
          return fileToModuleId.get(resolveSceneImport(fromFile, specifier)) ?? specifier
        },
      },
    )
    if (transformed.confirmations.length > 0) {
      return reply.code(409).send({
        status: 'confirmation-required',
        code: 'scene-authoring-confirmation-required',
        confirmations: transformed.confirmations,
        transaction: { applied: false, rolledBack: true },
      })
    }
    const writes = transformed.changedModuleIds.map((moduleId) => ({
      file: transformed.project.modules[moduleId].file,
      source: printSceneModule(transformed.project.modules[moduleId]),
    }))
    const overrides = Object.fromEntries(writes.map((write) => [write.file, write.source]))
    const projectCompile = await compileStoredSceneProject(projectDir, {
      entryFile: stored.file,
      entrySource: overrides[stored.file] ?? stored.source,
      sourceOverrides: overrides,
      projectId: req.params.projectId,
      registry: baseRegistry,
    })
    const compiled = projectCompile.compiled
    const diagnostics = [...transformed.diagnostics, ...projectCompile.diagnostics]
    if (hasErrors(diagnostics)) {
      return reply.code(422).send(rejectedSceneScriptPayload(
        'Authoring transaction was rejected.',
        diagnostics,
        { compatibility: { appliedBeforeValidation: transformed.applied } },
      ))
    }
    const currentLayout = await readAuthoringLayout(projectDir)
    const remappedLayout = remapStatementLayout(
      currentLayout,
      sourceMap,
      compiled.sourceMap,
    )
    const previousRuntimeGraph = applyStoredLayout(
      compiledOpsToKernelGraph(currentProject.compiled.ops),
      currentLayout,
      currentProject.compiled.sourceMap,
    )
    const imported = await importPipelineGraph(
      await getRuntimeForProject(req.params.projectId),
      {
        format: 'kernel-graph-v1',
        graph: applyStoredLayout(
          compiledOpsToKernelGraph(compiled.ops),
          remappedLayout,
          compiled.sourceMap,
        ),
      },
      {
        mode: 'replace',
        actor: caller.kind === 'ai' ? 'scene-script:agent' : 'scene-script:user',
        label: req.body.label ?? 'Apply Scene Authoring Commands',
      },
    )
    if (imported.status !== 'ok') {
      return reply.code(422).send(rejectedSceneScriptPayload(
        imported.reason ?? 'Runtime Graph import was rejected.',
        runtimeImportDiagnostics(imported.diagnostics),
        { transaction: { applied: false, rolledBack: true } },
      ))
    }
    const dependencyGraph = Object.fromEntries(Object.entries(projectCompile.incremental.modules).map(
      ([moduleId, item]) => [moduleId, {
        dependencies: item.dependencies,
        dependents: item.dependents,
        publicSignatureHash: item.publicSignatureHash,
        semanticHash: item.semanticHash,
      }],
    ))
    let next
    try {
      next = await writeSceneProjectTransaction(
        projectDir,
        stored.file,
        writes,
        compiled.sourceMap,
        imported.newHash,
        dependencyGraph,
        remappedLayout,
      )
      const afterSnapshot = await captureAuthoringSourceSnapshot(projectDir, stored.file)
      await recordAuthoringTransaction(
        projectDir,
        beforeSnapshot,
        afterSnapshot,
        req.body.label ?? 'Apply Scene Authoring Commands',
      )
    } catch (error) {
      await importPipelineGraph(
        await getRuntimeForProject(req.params.projectId),
        { format: 'kernel-graph-v1', graph: previousRuntimeGraph },
        { mode: 'replace', actor: 'scene-script:rollback', label: 'Rollback failed Scene Authoring transaction' },
      )
      await rollbackSourceSnapshot(
        req.params.projectId,
        projectDir,
        beforeSnapshot,
        'Rollback unrecorded Scene Authoring transaction',
      )
      throw error
    }
    return {
      status: 'ok',
      revision: next.projectRevision,
      projectRevision: next.projectRevision,
      moduleRevisions: next.moduleRevisions,
      graphHash: imported.newHash,
      sources: Object.fromEntries(writes.map((write) => [write.file, write.source])),
      sourceMap: compiled.sourceMap,
      diagnostics: toPublicSceneDiagnostics(diagnostics),
      applied: transformed.applied,
      incremental: projectCompile.incremental,
      transaction: {
        applied: true,
        rolledBack: false,
        ...(imported.batchId ? { undoToken: imported.batchId } : {}),
      },
    }
  })
}
