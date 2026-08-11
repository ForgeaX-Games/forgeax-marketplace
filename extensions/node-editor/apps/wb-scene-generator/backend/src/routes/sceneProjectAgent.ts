import type { FastifyInstance, FastifyRequest } from 'fastify'

import {
  applyProjectAuthoringCommands,
  boundedUnique,
  commandModuleIds,
  commandTargetIds,
  compiledOpsToKernelGraph,
  parseSceneSemanticAddress,
  parseSceneModule,
  printSceneModule,
  requiresHumanGate,
  sceneSemanticAddress,
  SCENE_WORKFLOW_LIMITS,
  stableArtifactStringify,
  type AuthoringCommand,
  type SceneEditLens,
  type SceneEditPrecondition,
  type SceneEditTransaction,
  type SceneSemanticDiff,
  type SceneSemanticExpectation,
  type SceneTargetCandidate,
  type SceneTargetQuery,
  type SceneVerification,
  type SceneWorkNode,
  type SourceMapEntry,
} from '@forgeax/scene-authoring'
import { getPipeline, importPipelineGraph, listGroups, type KernelGraphV1 } from '@forgeax/node-runtime'

import { getProjectDir, getRuntimeForProject } from '../runtime.js'
import { getSceneContractRegistry } from '../scene-script/contracts.js'
import { compileStoredSceneProject, resolveSceneImport } from '../scene-script/projectCompiler.js'
import {
  layoutKey,
  readAuthoringLayout,
  readSceneModule,
  writeSceneProjectTransaction,
} from '../scene-script/store.js'
import {
  newWorkNode,
  readStoredTransaction,
  readWorkGraph,
  readWorkNodes,
  writeStoredTransaction,
  writeWorkNodeArtifacts,
  type StoredSceneTransaction,
} from '../scene-script/workflowStore.js'
import { ensureMutationAccess } from './projects.js'

interface ProjectParams { projectId: string }
interface TransactionParams extends ProjectParams { transactionId: string }

function now(): string {
  return new Date().toISOString()
}

function transactionId(): string {
  return `scene-edit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function hasErrors(diagnostics: Array<{ severity: string }>): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

function sourceLine(source: string, start: number, end: number): string {
  return source.slice(start, end).slice(0, SCENE_WORKFLOW_LIMITS.maxStringLength)
}

function allReferences(expression: unknown): string[] {
  if (!expression || typeof expression !== 'object') return []
  if ((expression as { kind?: string }).kind === 'reference') {
    const binding = (expression as { binding?: unknown }).binding
    return typeof binding === 'string' ? [binding] : []
  }
  if ((expression as { kind?: string }).kind === 'array') {
    return ((expression as { items?: unknown[] }).items ?? []).flatMap(allReferences)
  }
  if ((expression as { kind?: string }).kind === 'object') {
    return Object.values((expression as { properties?: Record<string, unknown> }).properties ?? {}).flatMap(allReferences)
  }
  return []
}

function copyCallerHeaders(req: FastifyRequest): Record<string, string> {
  const names = ['x-forgeax-caller-kind', 'x-forgeax-caller-agent-id', 'x-forgeax-caller-session-id']
  return Object.fromEntries(names.flatMap((name) => {
    const value = req.headers[name]
    return typeof value === 'string' ? [[name, value]] : []
  }))
}

async function currentGraph(projectId: string): Promise<KernelGraphV1 | undefined> {
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

function rankCandidate(
  entry: SourceMapEntry,
  query: SceneTargetQuery,
  lineage: Array<{
    authoring: { statementId: string; entityId: string }
    sceneNodes: Array<{ id: string; path: string }>
  }>,
): { confidence: number; evidence: string[] } | null {
  const evidence: Array<{ score: number; text: string }> = []
  const selection = query.selection
  if (selection?.authoringIds?.some((id) => id === entry.entityId || id === entry.statementId)) {
    evidence.push({ score: 1, text: 'ui-selection:authoring' })
  }
  if (selection?.runtimeNodeIds?.some((id) => entry.runtimeNodeIds.includes(id))) {
    evidence.push({ score: .99, text: 'ui-selection:runtime-source-map' })
  }
  if (selection?.sourceRanges?.some((range) =>
    range.file === entry.file && range.start <= entry.source.end && range.end >= entry.source.start)) {
    evidence.push({ score: .99, text: 'ui-selection:source-range' })
  }
  if (query.authoringId && (query.authoringId === entry.entityId || query.authoringId === entry.statementId)) {
    evidence.push({ score: .98, text: 'stable-authoring-id' })
  }
  const semantic = query.semanticAddress ? parseSceneSemanticAddress(query.semanticAddress) : null
  if (semantic?.moduleId === entry.moduleId && semantic.statementId === entry.statementId) {
    evidence.push({ score: .98, text: 'stable-semantic-address' })
  }
  const related = lineage.filter((item) =>
    item.authoring.entityId === entry.entityId || item.authoring.statementId === entry.statementId)
  const sceneNodeIds = boundedUnique([
    ...(query.sceneNodeId ? [query.sceneNodeId] : []),
    ...(selection?.sceneNodeIds ?? []),
  ], SCENE_WORKFLOW_LIMITS.maxTargets)
  if (sceneNodeIds.some((id) => related.some((item) => item.sceneNodes.some((node) => node.id === id)))) {
    evidence.push({ score: .95, text: 'scene-node-lineage' })
  }
  const paths = boundedUnique([...(query.path ? [query.path] : []), ...(selection?.paths ?? [])], SCENE_WORKFLOW_LIMITS.maxTargets)
  if (paths.some((path) => related.some((item) => item.sceneNodes.some((node) => node.path === path)))) {
    evidence.push({ score: .94, text: 'scene-path-lineage' })
  }
  const selectionAddresses = selection?.semanticAddresses ?? []
  if (selectionAddresses.some((address) => {
    const parsed = parseSceneSemanticAddress(address)
    return parsed?.moduleId === entry.moduleId && parsed.statementId === entry.statementId
  })) evidence.push({ score: .98, text: 'ui-selection:semantic-address' })
  const text = query.query?.trim().toLowerCase()
  if (text && [entry.statementId, entry.entityId, entry.moduleId, entry.file]
    .some((value) => value.toLowerCase().includes(text))) {
    evidence.push({ score: .62, text: 'query-metadata-match' })
  }
  if (!evidence.length) return null
  evidence.sort((left, right) => right.score - left.score || left.text.localeCompare(right.text))
  return {
    confidence: Math.min(1, evidence[0]!.score + Math.max(0, evidence.length - 1) * .005),
    evidence: evidence.map((item) => item.text).slice(0, SCENE_WORKFLOW_LIMITS.maxEvidence),
  }
}

function statementDigest(statement: unknown): string {
  return stableArtifactStringify(statement)
}

function semanticDiff(
  id: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  invalidatedModules: string[],
  allModuleIds: string[],
  expected: SceneSemanticExpectation[],
): SceneSemanticDiff {
  const created = Object.keys(after).filter((key) => !(key in before)).sort()
  const removed = Object.keys(before).filter((key) => !(key in after)).sort()
  const updated = Object.keys(after).filter((key) => key in before && statementDigest(after[key]) !== statementDigest(before[key])).sort()
  const directlyChanged = boundedUnique([...created, ...removed, ...updated], SCENE_WORKFLOW_LIMITS.maxTargets * 4)
  const recompiled = boundedUnique(invalidatedModules, SCENE_WORKFLOW_LIMITS.maxTargets * 4)
  const reexecuted = [...recompiled]
  const revalidated = [...recompiled]
  const unchanged = allModuleIds.filter((moduleId) => !recompiled.includes(moduleId)).sort()
  const actual = new Map<string, SceneSemanticExpectation['change']>([
    ...created.map((entityId) => [entityId, 'created'] as const),
    ...updated.map((entityId) => [entityId, 'updated'] as const),
    ...removed.map((entityId) => [entityId, 'removed'] as const),
  ])
  return {
    transactionId: id,
    directlyChanged,
    recompiled,
    reexecuted,
    revalidated,
    unchanged,
    created,
    updated,
    removed,
    expectedDeltaMatches: expected.every((item) =>
      item.change === 'unchanged' ? !actual.has(item.entityId) : actual.get(item.entityId) === item.change),
    payload: 'semantic-summary',
  }
}

async function restoreTransaction(
  projectId: string,
  projectDir: string,
  stored: StoredSceneTransaction,
): Promise<void> {
  const entry = await readSceneModule(projectDir)
  const registry = await getSceneContractRegistry()
  const compile = await compileStoredSceneProject(projectDir, {
    entryFile: entry.file,
    entrySource: stored.beforeSources[entry.file] ?? entry.source,
    sourceOverrides: stored.beforeSources,
    projectId,
    registry,
  })
  if (hasErrors(compile.diagnostics)) throw new Error('rollback source no longer compiles')
  const layout = await readAuthoringLayout(projectDir)
  const imported = await importPipelineGraph(
    await getRuntimeForProject(projectId),
    { format: 'kernel-graph-v1', graph: compiledOpsToKernelGraph(compile.compiled.ops) },
    { mode: 'replace', actor: 'scene-script:rollback', label: `Revert ${stored.transaction.transactionId}` },
  )
  if (imported.status !== 'ok') throw new Error(imported.reason ?? 'rollback runtime import failed')
  await writeSceneProjectTransaction(
    projectDir,
    entry.file,
    Object.entries(stored.beforeSources).map(([file, source]) => ({ file, source })),
    compile.compiled.sourceMap,
    imported.newHash,
    Object.fromEntries(Object.entries(compile.incremental.modules).map(([moduleId, item]) => [moduleId, {
      dependencies: item.dependencies,
      dependents: item.dependents,
      publicSignatureHash: item.publicSignatureHash,
      semanticHash: item.semanticHash,
    }])),
    layout,
  )
}

async function projectContext(projectId: string, projectDir: string) {
  const entry = await readSceneModule(projectDir)
  const baseRegistry = await getSceneContractRegistry()
  const project = await compileStoredSceneProject(projectDir, {
    entryFile: entry.file,
    entrySource: entry.source,
    projectId,
    registry: baseRegistry,
  })
  return { entry, registry: project.registry, project }
}

export async function registerSceneProjectAgentRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId/scene-agent'

  app.get<{ Params: ProjectParams }>(`${prefix}/work-graph`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    return readWorkGraph(projectDir, req.params.projectId)
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/resume`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const { entry } = await projectContext(req.params.projectId, projectDir)
    const nodes = await readWorkNodes(projectDir)
    const current = nodes.find((node) => !['accepted', 'reverted', 'failed'].includes(node.status))
    return {
      projectSummary: {
        projectId: req.params.projectId,
        projectRevision: entry.state?.projectRevision ?? entry.revision,
        modules: entry.state?.modules ?? [entry.file],
      },
      checkpoint: current?.checkpoint ?? null,
      currentWorkOrder: current ? current.artifacts.workOrder : null,
      health: { canonical: Boolean(entry.source.trim()), diagnostics: current?.diagnostics.slice(0, 3) ?? [] },
      payload: 'bounded-resume-context',
    }
  })

  app.post<{ Params: ProjectParams; Body: SceneTargetQuery }>(`${prefix}/locate`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const { entry, project } = await projectContext(req.params.projectId, projectDir)
    const sourceMap = entry.state?.sourceMap ?? project.compiled.sourceMap
    const lineage = entry.state?.resultLineage ?? []
    const candidates: SceneTargetCandidate[] = sourceMap.flatMap((item) => {
      const ranked = rankCandidate(item, req.body ?? {}, lineage)
      return ranked ? [{
        authoringId: item.entityId,
        statementId: item.statementId,
        semanticAddress: sceneSemanticAddress(item.moduleId, item.statementId),
        moduleId: item.moduleId,
        file: item.file,
        confidence: ranked.confidence,
        evidence: ranked.evidence,
        source: item.source,
      }] : []
    }).sort((left, right) =>
      right.confidence - left.confidence
      || left.semanticAddress.localeCompare(right.semanticAddress))
      .slice(0, SCENE_WORKFLOW_LIMITS.maxCandidates)
    const close = candidates.length > 1 && candidates[0]!.confidence - candidates[1]!.confidence < .08
    const weak = !candidates.length || candidates[0]!.confidence < .72
    return {
      query: req.body ?? {},
      candidates,
      requiresClarification: close || weak,
      ...((close || weak) ? {
        clarificationReason: close
          ? 'Multiple candidates have comparable evidence; select one stable semantic address.'
          : 'No candidate has sufficient evidence; provide a UI selection, stable id, scene node/path, or semantic address.',
      } : {}),
      bounded: true,
    }
  })

  app.post<{
    Params: ProjectParams
    Body: { targetIds: string[]; radius?: number; concerns?: string[]; expansionReason?: string }
  }>(`${prefix}/lens`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const targetIds = boundedUnique(req.body?.targetIds ?? [], SCENE_WORKFLOW_LIMITS.maxTargets)
    if (!targetIds.length) return reply.code(400).send({ reason: 'targetIds are required' })
    const depth = Math.min(Math.max(1, req.body.radius ?? 1), SCENE_WORKFLOW_LIMITS.maxLensExpansions)
    if (depth > 1 && !req.body.expansionReason) {
      return reply.code(400).send({ reason: 'Lens expansion requires compiler, impact, or verifier evidence.' })
    }
    const { entry, project } = await projectContext(req.params.projectId, projectDir)
    const sourceMap = entry.state?.sourceMap ?? project.compiled.sourceMap
    const selected = sourceMap.filter((item) =>
      targetIds.some((id) => id === item.entityId || id === item.statementId))
    if (!selected.length) return reply.code(404).send({ reason: 'targets not found' })
    const sourceByFile = Object.fromEntries(await Promise.all(
      [...new Set(selected.map((item) => item.file))].map(async (file) => [file, (await readSceneModule(projectDir, file)).source]),
    ))
    const modules = project.modules
    const statementById = new Map(Object.values(modules).flatMap((module) =>
      module.statements.map((statement) => [statement.statementId, { module, statement }] as const)))
    const targetStatements = selected.flatMap((item) => {
      const value = statementById.get(item.statementId)
      return value ? [value] : []
    })
    const dependencyBindings = new Set(targetStatements.flatMap(({ statement }) =>
      Object.values(statement.args).flatMap(allReferences)))
    const targetBindings = new Set(targetStatements.flatMap(({ statement }) => statement.binding ? [statement.binding] : []))
    const summarize = (relation: 'dependency' | 'consumer') => Object.values(modules).flatMap((module) =>
      module.statements.flatMap((statement) => {
        const refs = Object.values(statement.args).flatMap(allReferences)
        const match = relation === 'dependency'
          ? Boolean(statement.binding && dependencyBindings.has(statement.binding))
          : refs.some((binding) => targetBindings.has(binding))
        return match ? [{
          moduleId: module.moduleId,
          file: module.file,
          statementId: statement.statementId,
          functionName: statement.functionName,
          binding: statement.binding,
          relation,
        }] : []
      })).slice(0, SCENE_WORKFLOW_LIMITS.maxTargets * depth)
    const recent = (await readWorkNodes(projectDir))
      .filter((node) => node.targetIds.some((id) => targetIds.includes(id)))
      .slice(0, 10)
      .map((node) => ({
        transactionId: node.id,
        changedAt: node.updatedAt,
        moduleIds: node.scope,
        targetIds: node.targetIds,
        status: node.status,
      }))
    const spatialReferences = (entry.state?.resultLineage ?? []).filter((item) =>
      selected.some((target) => target.entityId === item.authoring.entityId))
      .flatMap((item) => item.sceneNodes.map((node) => ({ sceneNodeId: node.id, path: node.path })))
    const lens: SceneEditLens = {
      targetIds: selected.map((item) => item.entityId),
      sourceRanges: selected.map((item) => item.source),
      targetSources: selected.map((item) => ({
        moduleId: item.moduleId,
        file: item.file,
        statementId: item.statementId,
        source: sourceLine(sourceByFile[item.file] ?? '', item.source.start, item.source.end),
      })),
      owningModules: boundedUnique(selected.map((item) => item.moduleId), SCENE_WORKFLOW_LIMITS.maxTargets)
        .map((moduleId) => ({
          moduleId,
          file: modules[moduleId]?.file ?? selected.find((item) => item.moduleId === moduleId)!.file,
          relation: 'module',
        })),
      directDependencies: summarize('dependency'),
      directConsumers: summarize('consumer'),
      spatialNeighborhood: {
        references: spatialReferences.slice(0, SCENE_WORKFLOW_LIMITS.maxTargets),
        count: spatialReferences.length,
        truncated: spatialReferences.length > SCENE_WORKFLOW_LIMITS.maxTargets,
        payload: 'summary-only',
      },
      invariants: [
        { id: 'project-ast-integrity', description: 'Project AST must remain valid.', frozen: true, scope: 'global' },
        { id: 'stable-id-unique', description: 'Stable authoring ids must remain unique.', frozen: true, scope: 'global' },
        { id: 'import-dag', description: 'Scene module imports must remain acyclic and resolvable.', frozen: true, scope: 'global' },
        { id: 'acceptance-frozen', description: 'Frozen acceptance standards cannot be weakened by the verifier.', frozen: true, scope: 'global' },
      ],
      recentRelevantChanges: recent,
      allowedWriteScope: boundedUnique(selected.map((item) => item.moduleId), SCENE_WORKFLOW_LIMITS.maxTargets),
      expansion: { depth, ...(req.body.expansionReason ? { reason: req.body.expansionReason } : {}), maxDepth: SCENE_WORKFLOW_LIMITS.maxLensExpansions },
      payload: 'bounded-no-runtime-graph',
    }
    return lens
  })

  app.post<{
    Params: ProjectParams
    Body: {
      intent: string
      targetIds: string[]
      writableModuleIds?: string[]
      preconditions?: SceneEditPrecondition[]
      commands: AuthoringCommand[]
      expectedSemanticDelta?: SceneSemanticExpectation[]
      verificationProfile?: 'local' | 'global'
    }
  }>(`${prefix}/propose`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const commands = req.body?.commands ?? []
    if (!Array.isArray(commands) || commands.length > SCENE_WORKFLOW_LIMITS.maxCommands) {
      return reply.code(413).send({ reason: `commands must contain at most ${SCENE_WORKFLOW_LIMITS.maxCommands} items` })
    }
    const targets = boundedUnique(req.body?.targetIds ?? commands.flatMap(commandTargetIds), SCENE_WORKFLOW_LIMITS.maxTargets)
    const { entry } = await projectContext(req.params.projectId, projectDir)
    const sourceMap = entry.state?.sourceMap ?? []
    const inferredModules = boundedUnique([
      ...commands.flatMap(commandModuleIds),
      ...sourceMap.filter((item) => targets.includes(item.entityId) || targets.includes(item.statementId)).map((item) => item.moduleId),
    ], SCENE_WORKFLOW_LIMITS.maxTargets)
    const writableModuleIds = boundedUnique(req.body?.writableModuleIds ?? inferredModules, SCENE_WORKFLOW_LIMITS.maxTargets)
    const id = transactionId()
    const reasons = requiresHumanGate(commands, req.body?.intent ?? '')
    const transaction: SceneEditTransaction = {
      transactionId: id,
      workNodeId: id,
      intent: (req.body?.intent ?? '').slice(0, SCENE_WORKFLOW_LIMITS.maxStringLength),
      baseProjectRevision: entry.state?.projectRevision ?? entry.state?.sourceRevision ?? entry.revision,
      baseModuleRevisions: Object.fromEntries(Object.values(entry.state?.moduleRevisions ?? {})
        .map((item) => [item.moduleId, item.revision])),
      targetIds: targets,
      writableModuleIds,
      preconditions: (req.body?.preconditions ?? []).slice(0, SCENE_WORKFLOW_LIMITS.maxCommands),
      astCommands: commands,
      expectedSemanticDelta: (req.body?.expectedSemanticDelta ?? []).slice(0, SCENE_WORKFLOW_LIMITS.maxCommands),
      verificationProfile: req.body?.verificationProfile ?? 'local',
      humanGate: { required: reasons.length > 0, reasons },
    }
    const beforeSources = Object.fromEntries(await Promise.all((entry.state?.modules ?? [entry.file])
      .map(async (file) => [file, (await readSceneModule(projectDir, file)).source])))
    const stored: StoredSceneTransaction = {
      transaction,
      status: transaction.humanGate?.required ? 'blocked' : 'planned',
      beforeSources,
      retries: 0,
      createdAt: now(),
      updatedAt: now(),
    }
    const node = newWorkNode(id, targets, writableModuleIds, transaction.humanGate)
    await Promise.all([
      writeStoredTransaction(projectDir, stored),
      writeWorkNodeArtifacts(projectDir, node, {
        workOrder: transaction,
        result: { status: node.status },
        astPatch: { commands },
        semanticDiff: null,
        verification: null,
        progress: { at: now(), event: 'proposed' },
        checkpoint: { id: `checkpoint-${id}-proposed`, projectRevision: transaction.baseProjectRevision, createdAt: now() },
      }),
    ])
    return transaction
  })

  app.post<{
    Params: TransactionParams
    Body: { humanApproved?: boolean }
  }>(`${prefix}/transactions/:transactionId/apply`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const stored = await readStoredTransaction(projectDir, req.params.transactionId)
    if (!stored) return reply.code(404).send({ reason: 'transaction not found' })
    if (stored.retries >= SCENE_WORKFLOW_LIMITS.maxRetries) {
      return reply.code(429).send({
        code: 'scene-edit-circuit-open',
        reason: 'Retry budget exhausted; circuit breaker is open and human intervention is required.',
      })
    }
    if (!['planned', 'blocked'].includes(stored.status)) return reply.code(409).send({ reason: `transaction is ${stored.status}` })
    if (stored.transaction.humanGate?.required && !req.body?.humanApproved) {
      return reply.code(409).send({
        status: 'human-gate-required',
        reasons: stored.transaction.humanGate.reasons,
        transaction: { applied: false, rolledBack: false },
      })
    }
    if (stored.transaction.humanGate?.required) stored.transaction.humanGate.approvedAt = now()
    const { entry, project } = await projectContext(req.params.projectId, projectDir)
    const actualRevision = entry.state?.projectRevision ?? entry.state?.sourceRevision ?? entry.revision
    if (actualRevision !== stored.transaction.baseProjectRevision) {
      return reply.code(409).send({ code: 'scene-edit-stale', reason: 'Base project revision is stale.', transaction: { applied: false, rolledBack: false } })
    }
    const actualModuleRevisions = new Map(Object.values(entry.state?.moduleRevisions ?? {}).map((item) => [item.moduleId, item.revision]))
    const staleModule = Object.entries(stored.transaction.baseModuleRevisions)
      .find(([moduleId, revision]) => actualModuleRevisions.get(moduleId) !== revision)
    if (staleModule) {
      return reply.code(409).send({ code: 'scene-edit-module-conflict', reason: `Module ${staleModule[0]} changed.`, transaction: { applied: false, rolledBack: false } })
    }
    const sourceMap = entry.state?.sourceMap ?? project.compiled.sourceMap
    const commandModules = stored.transaction.astCommands.flatMap((command) => {
      const explicit = commandModuleIds(command)
      const targets = commandTargetIds(command)
      return [...explicit, ...sourceMap.filter((item) =>
        targets.includes(item.entityId) || targets.includes(item.statementId)).map((item) => item.moduleId)]
    })
    const unauthorized = boundedUnique(commandModules, SCENE_WORKFLOW_LIMITS.maxTargets)
      .filter((moduleId) => !stored.transaction.writableModuleIds.includes(moduleId))
    if (unauthorized.length) {
      return reply.code(403).send({ code: 'scene-edit-scope-violation', reason: `Write outside allowed scope: ${unauthorized.join(', ')}`, transaction: { applied: false, rolledBack: false } })
    }
    const missingTarget = stored.transaction.preconditions
      .filter((item): item is Extract<SceneEditPrecondition, { kind: 'target-exists' }> => item.kind === 'target-exists')
      .find((item) => !sourceMap.some((entry) => entry.entityId === item.targetId || entry.statementId === item.targetId))
    if (missingTarget) {
      return reply.code(409).send({ code: 'scene-edit-precondition-failed', reason: `Target no longer exists: ${missingTarget.targetId}` })
    }
    const signatureFailure = stored.transaction.preconditions
      .filter((item): item is Extract<SceneEditPrecondition, { kind: 'module-signature' }> => item.kind === 'module-signature')
      .find((item) => project.incremental.modules[item.moduleId]?.publicSignatureHash !== item.hash)
    if (signatureFailure) {
      return reply.code(409).send({
        code: 'scene-edit-precondition-failed',
        reason: `Module interface changed: ${signatureFailure.moduleId}`,
      })
    }
    const statements = Object.values(project.modules).flatMap((module) => module.statements)
    const argumentFailure = stored.transaction.preconditions
      .filter((item): item is Extract<SceneEditPrecondition, { kind: 'argument-equals' }> => item.kind === 'argument-equals')
      .find((item) => {
        const statement = statements.find((candidate) => candidate.statementId === item.statementId)
        return !statement || stableArtifactStringify(statement.args[item.argument]) !== stableArtifactStringify(item.value)
      })
    if (argumentFailure) {
      return reply.code(409).send({
        code: 'scene-edit-precondition-failed',
        reason: `Argument precondition changed: ${argumentFailure.statementId}.${argumentFailure.argument}`,
      })
    }
    const beforeStatements = Object.fromEntries(Object.values(project.modules).flatMap((module) =>
      module.statements.map((statement) => [statement.statementId, statement])))
    const commandResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${encodeURIComponent(req.params.projectId)}/scene-script/commands`,
      headers: { 'content-type': 'application/json', ...copyCallerHeaders(req) },
      payload: {
        expectedProjectRevision: stored.transaction.baseProjectRevision,
        expectedModuleRevisions: stored.transaction.baseModuleRevisions,
        commands: stored.transaction.astCommands,
        label: stored.transaction.intent,
      },
    })
    const commandPayload = commandResponse.json() as Record<string, unknown>
    if (commandResponse.statusCode >= 400) {
      stored.retries += 1
      stored.updatedAt = now()
      const failureNode = newWorkNode(
        stored.transaction.workNodeId,
        stored.transaction.targetIds,
        stored.transaction.writableModuleIds,
        stored.transaction.humanGate,
        stored.retries,
      )
      failureNode.kind = 'platform-recovery'
      failureNode.status = stored.retries >= SCENE_WORKFLOW_LIMITS.maxRetries ? 'failed' : 'planned'
      failureNode.budget.circuitOpen = stored.retries >= SCENE_WORKFLOW_LIMITS.maxRetries
      failureNode.budget.stopped = failureNode.budget.circuitOpen
      await Promise.all([
        writeStoredTransaction(projectDir, stored),
        writeWorkNodeArtifacts(projectDir, failureNode, {
          result: { status: failureNode.status, failure: commandPayload },
          progress: { at: now(), event: 'platform-recovery', retry: stored.retries },
        }),
      ])
      return reply.code(commandResponse.statusCode).send({
        ...commandPayload,
        retry: {
          attempted: stored.retries,
          maxRetries: SCENE_WORKFLOW_LIMITS.maxRetries,
          circuitOpen: failureNode.budget.circuitOpen,
        },
      })
    }
    const after = await projectContext(req.params.projectId, projectDir)
    const afterStatements = Object.fromEntries(Object.values(after.project.modules).flatMap((module) =>
      module.statements.map((statement) => [statement.statementId, statement])))
    const incremental = commandPayload.incremental as { invalidatedModuleIds?: string[] } | undefined
    const diff = semanticDiff(
      stored.transaction.transactionId,
      beforeStatements,
      afterStatements,
      incremental?.invalidatedModuleIds ?? stored.transaction.writableModuleIds,
      Object.keys(after.project.modules),
      stored.transaction.expectedSemanticDelta,
    )
    if (!diff.expectedDeltaMatches) {
      await restoreTransaction(req.params.projectId, projectDir, stored)
      stored.status = 'failed'
      stored.retries = SCENE_WORKFLOW_LIMITS.maxRetries
      stored.diff = diff
      stored.updatedAt = now()
      const failureNode = newWorkNode(
        stored.transaction.workNodeId,
        stored.transaction.targetIds,
        stored.transaction.writableModuleIds,
        stored.transaction.humanGate,
        stored.retries,
      )
      failureNode.status = 'failed'
      failureNode.budget.circuitOpen = true
      failureNode.budget.stopped = true
      await Promise.all([
        writeStoredTransaction(projectDir, stored),
        writeWorkNodeArtifacts(projectDir, failureNode, {
          result: { status: 'failed', rolledBack: true },
          semanticDiff: diff,
          progress: { at: now(), event: 'semantic-delta-mismatch-rollback' },
        }),
      ])
      return reply.code(422).send({
        code: 'scene-edit-semantic-delta-mismatch',
        reason: 'Actual semantic delta does not match the declared expectation; transaction was rolled back.',
        semanticDiff: diff,
        transaction: { applied: false, rolledBack: true },
      })
    }
    stored.status = 'preview'
    stored.diff = diff
    stored.afterSources = commandPayload.sources as Record<string, string> | undefined
    stored.undoToken = (commandPayload.transaction as { undoToken?: string } | undefined)?.undoToken
    stored.updatedAt = now()
    const node = newWorkNode(stored.transaction.workNodeId, stored.transaction.targetIds, stored.transaction.writableModuleIds, stored.transaction.humanGate)
    node.status = 'preview'
    node.updatedAt = now()
    node.checkpoint = { id: `checkpoint-${stored.transaction.transactionId}-preview`, projectRevision: String(commandPayload.projectRevision), createdAt: now() }
    await Promise.all([
      writeStoredTransaction(projectDir, stored),
      writeWorkNodeArtifacts(projectDir, node, {
        result: { status: 'preview', transaction: commandPayload.transaction },
        semanticDiff: diff,
        progress: { at: now(), event: 'applied-for-preview' },
        checkpoint: node.checkpoint,
      }),
    ])
    return { status: 'preview', semanticDiff: diff, transaction: commandPayload.transaction, checkpoint: node.checkpoint }
  })

  app.get<{ Params: TransactionParams }>(`${prefix}/transactions/:transactionId/diff`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const stored = await readStoredTransaction(projectDir, req.params.transactionId)
    if (!stored?.diff) return reply.code(409).send({ reason: 'semantic diff is not available before apply' })
    return stored.diff
  })

  app.post<{
    Params: TransactionParams
    Body: { profile?: 'local' | 'global' }
  }>(`${prefix}/transactions/:transactionId/verify`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const stored = await readStoredTransaction(projectDir, req.params.transactionId)
    if (!stored || stored.status !== 'preview') return reply.code(409).send({ reason: 'transaction is not awaiting verification' })
    const profile = req.body?.profile ?? stored.transaction.verificationProfile
    const { project } = await projectContext(req.params.projectId, projectDir)
    const diagnostics = project.diagnostics.slice(0, 20)
    const findings = [
      ...(!stored.diff?.expectedDeltaMatches ? ['Declared semantic delta does not match.'] : []),
      ...(hasErrors(diagnostics) ? ['Compile diagnostics contain errors.'] : []),
    ]
    const verification: SceneVerification = {
      transactionId: stored.transaction.transactionId,
      profile,
      ok: findings.length === 0,
      diagnostics,
      frozenStandardsPreserved: true,
      critic: {
        readOnly: true,
        verdict: findings.length ? 'request-changes' : 'approve',
        findings,
      },
    }
    stored.verification = verification
    stored.status = verification.ok ? 'verified' : 'preview'
    stored.updatedAt = now()
    const node = newWorkNode(stored.transaction.workNodeId, stored.transaction.targetIds, stored.transaction.writableModuleIds, stored.transaction.humanGate)
    node.status = stored.status
    node.budget.stopped = true
    node.diagnostics = diagnostics
    node.updatedAt = now()
    node.checkpoint = { id: `checkpoint-${stored.transaction.transactionId}-verify`, projectRevision: (await readSceneModule(projectDir)).state?.projectRevision ?? '', createdAt: now() }
    await Promise.all([
      writeStoredTransaction(projectDir, stored),
      writeWorkNodeArtifacts(projectDir, node, {
        result: { status: node.status },
        verification,
        progress: { at: now(), event: 'critic-review-completed', verdict: verification.critic.verdict },
        checkpoint: node.checkpoint,
      }),
    ])
    return verification
  })

  app.post<{
    Params: TransactionParams
    Body: { decision: 'accept' | 'revert' }
  }>(`${prefix}/transactions/:transactionId/decision`, async (req, reply) => {
    const projectDir = await getProjectDir(req.params.projectId)
    if (!projectDir) return reply.code(404).send({ reason: 'project not found' })
    const access = await ensureMutationAccess(req, req.params.projectId)
    if (!access.ok) return reply.code(403).send(access)
    const stored = await readStoredTransaction(projectDir, req.params.transactionId)
    if (!stored) return reply.code(404).send({ reason: 'transaction not found' })
    if (req.body?.decision === 'accept') {
      if (stored.status !== 'verified' || !stored.verification?.ok) {
        return reply.code(409).send({ reason: 'Only a successfully verified preview can be accepted.' })
      }
      stored.status = 'accepted'
    } else if (req.body?.decision === 'revert') {
      if (!['preview', 'verified'].includes(stored.status)) return reply.code(409).send({ reason: `Cannot revert ${stored.status}` })
      await restoreTransaction(req.params.projectId, projectDir, stored)
      stored.status = 'reverted'
    } else {
      return reply.code(400).send({ reason: 'decision must be accept or revert' })
    }
    stored.updatedAt = now()
    const module = await readSceneModule(projectDir)
    const node = newWorkNode(stored.transaction.workNodeId, stored.transaction.targetIds, stored.transaction.writableModuleIds, stored.transaction.humanGate)
    node.status = stored.status
    node.updatedAt = now()
    node.checkpoint = { id: `checkpoint-${stored.transaction.transactionId}-${stored.status}`, projectRevision: module.state?.projectRevision ?? module.revision, createdAt: now() }
    await Promise.all([
      writeStoredTransaction(projectDir, stored),
      writeWorkNodeArtifacts(projectDir, node, {
        result: { status: stored.status },
        progress: { at: now(), event: stored.status },
        checkpoint: node.checkpoint,
      }),
    ])
    return { status: stored.status, transactionId: stored.transaction.transactionId, checkpoint: node.checkpoint }
  })
}
