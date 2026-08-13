import type { GraphEdge, GraphNode, KernelGraphV1, NodeGroup, Op } from '@forgeax/node-runtime'

import { createSceneDiagnostic } from './diagnostics.js'
import { stableEntityId } from './identity.js'
import { literalValue, literalValueForAccess } from './literal-datatree.js'
import type {
  CompiledSceneModule,
  ContractRegistry,
  NodeFunctionContract,
  PortContract,
  RawTemplateGroup,
  SceneCallStatement,
  SceneDiagnostic,
  SceneExpression,
  SceneModuleAst,
  SceneProjectAst,
  SourceMapEntry,
} from './types.js'

interface CompiledEntity {
  statement: SceneCallStatement
  contract: NodeFunctionContract
  entityId: string
  runtimeNodeIds: string[]
  runtimeEdgeIds: string[]
  runtimeOrigins?: Record<string, string>
  runtimeEdgeOrigins?: Record<string, string>
}

function runtimePort(port: PortContract): string {
  return port.runtimePort ?? port.name
}

function compileDiagnostic(
  statement: SceneCallStatement,
  contract: NodeFunctionContract | undefined,
  code: string,
  message: string,
  phase: SceneDiagnostic['phase'] = 'compile',
): SceneDiagnostic {
  return createSceneDiagnostic({
    code,
    phase,
    severity: 'error',
    message,
    source: statement.source,
    statementId: statement.statementId,
    operation: statement.functionName,
    ...(contract
      ? {
          signature: `${contract.functionName}({ ${contract.inputs.map((input) => input.name).join(', ')} })`,
          documentationHint: contract.description,
        }
      : {}),
  })
}

function resolveOutput(contract: NodeFunctionContract, requested: string | undefined): PortContract | undefined {
  if (requested) return contract.outputs.find((output) => output.name === requested)
  return contract.outputs.length === 1 ? contract.outputs[0] : undefined
}

function groupTree(root: RawTemplateGroup): RawTemplateGroup[] {
  const result: RawTemplateGroup[] = []
  const visit = (group: RawTemplateGroup): void => {
    for (const child of group._nestedGroups ?? []) visit(child)
    result.push(group)
  }
  visit(root)
  return result
}

function compileGroup(
  statement: SceneCallStatement,
  contract: NodeFunctionContract,
  diagnostics: SceneDiagnostic[],
): {
  ops: Op[]
  entityId: string
  runtimeNodeIds: string[]
  runtimeEdgeIds: string[]
  runtimeOrigins: Record<string, string>
  runtimeEdgeOrigins: Record<string, string>
} {
  const definition = contract.definition
  if (!definition || !contract.definitionId) {
    diagnostics.push(
      compileDiagnostic(statement, contract, 'SCENE_COMPILE_GROUP_DEFINITION', 'Group contract has no definition.'),
    )
    return {
      ops: [],
      entityId: stableEntityId('group', statement.statementId),
      runtimeNodeIds: [],
      runtimeEdgeIds: [],
      runtimeOrigins: {},
      runtimeEdgeOrigins: {},
    }
  }
  const instanceId = stableEntityId('group', statement.statementId)
  const groups = groupTree(definition)
  const groupIds = new Map<string, string>()
  const nodeIds = new Map<string, string>()
  for (const group of groups) {
    groupIds.set(
      group.id,
      group.id === definition.id ? instanceId : stableEntityId('group', `${statement.statementId}:${group.id}`),
    )
  }
  for (const group of groups) {
    for (const node of group.nodes ?? []) {
      const nestedId =
        node.opId === '__group__'
          ? String(node.params?.groupId ?? node.id)
          : undefined
      nodeIds.set(
        node.id,
        nestedId
          ? (groupIds.get(nestedId) ?? stableEntityId('group', `${statement.statementId}:${nestedId}`))
          : stableEntityId('node', `${statement.statementId}:${node.id}`),
      )
    }
  }
  const mapNode = (id: string): string => nodeIds.get(id) ?? groupIds.get(id) ?? id
  const ops: Op[] = []
  const runtimeNodeIds: string[] = []
  const runtimeEdgeIds: string[] = []
  const runtimeOrigins: Record<string, string> = {}
  const runtimeEdgeOrigins: Record<string, string> = {}
  const parameterOverrides = new Map<string, Record<string, unknown>>()
  for (const input of contract.inputs) {
    if (input.mode !== 'parameter') continue
    const expression = statement.args[input.name]
    const value = expression ? literalValueForAccess(expression, input.access) : undefined
    if (value === undefined) continue
    const templateNodeId = input.parameterTarget?.templateNodeId
    const param = input.parameterTarget?.param ?? input.name
    if (!templateNodeId) {
      diagnostics.push(
        compileDiagnostic(
          statement,
          contract,
          'SCENE_COMPILE_PARAMETER_TARGET',
          `Group parameter '${input.name}' has no template node target.`,
        ),
      )
      continue
    }
    parameterOverrides.set(templateNodeId, {
      ...(parameterOverrides.get(templateNodeId) ?? {}),
      [param]: value,
    })
  }

  for (const group of groups) {
    for (const node of group.nodes ?? []) {
      if (node.opId === '__group__') continue
      const nodeId = mapNode(node.id)
      runtimeNodeIds.push(nodeId)
      runtimeOrigins[nodeId] = node.id
      ops.push({
        type: 'createNode',
        nodeId,
        opId: node.opId,
        position: node.position ?? { x: 0, y: 0 },
        params: { ...(node.params ?? {}), ...(parameterOverrides.get(node.id) ?? {}) },
        ...(node.name ? { name: node.name } : {}),
      })
    }
    for (const edge of group.edges ?? []) {
      const edgeId = stableEntityId('edge', `${statement.statementId}:${group.id}:${edge.id}`)
      runtimeEdgeIds.push(edgeId)
      runtimeEdgeOrigins[edgeId] = edge.id
      ops.push({
        type: 'connect',
        edgeId,
        source: { nodeId: mapNode(edge.source.nodeId), port: edge.source.port },
        target: { nodeId: mapNode(edge.target.nodeId), port: edge.target.port },
      })
    }
    const groupId = groupIds.get(group.id)!
    runtimeNodeIds.push(groupId)
    runtimeOrigins[groupId] = group.id
    const remapPorts = (ports: RawTemplateGroup['exposedInputs']) =>
      (ports ?? []).map((port) => ({
        portName: port.portName,
        sourceNodeId: mapNode(port.sourceNodeId),
        sourcePortName: port.sourcePortName,
        ...(port.portType ? { portType: port.portType } : {}),
        ...(port.access ? { access: port.access } : {}),
        ...(port.hidden !== undefined ? { hidden: port.hidden } : {}),
        ...(port.order !== undefined ? { order: port.order } : {}),
        ...(port.customLabel ? { customLabel: port.customLabel } : {}),
        ...(port.customLabelEn ? { customLabelEn: port.customLabelEn } : {}),
      }))
    const inputs = remapPorts(group.exposedInputs)
    const outputs = remapPorts(group.exposedOutputs)
    ops.push({
      type: 'createGroup',
      groupId,
      name: group.name ?? contract.functionName,
      ...(group.nameEn ? { nameEn: group.nameEn } : {}),
      position: group.id === definition.id ? { x: 0, y: 0 } : (group.position ?? { x: 0, y: 0 }),
      memberNodeIds: (group.nodes ?? []).map((node) => mapNode(node.id)),
      ...(inputs.length || outputs.length
        ? {
            exposedPorts: {
              ...(inputs.length ? { inputs } : {}),
              ...(outputs.length ? { outputs } : {}),
            },
          }
        : {}),
    })
    if (group.id === definition.id) {
      ops.push({
        type: 'updateNode',
        nodeId: groupId,
        params: {
          groupId,
          __sceneScriptFunctionName: contract.functionName,
          __sceneScriptDefinitionId: contract.definitionId,
          __sceneScriptDefinitionVersion: contract.definitionVersion ?? contract.contractVersion,
          __sceneScriptStatus: contract.sceneScriptStatus ?? 'script-callable',
          __sceneScriptSourceFile: `${contract.definitionId?.split('.').at(-1) ?? contract.functionName}.scene.ts`,
        },
      })
    }
  }
  return { ops, entityId: instanceId, runtimeNodeIds, runtimeEdgeIds, runtimeOrigins, runtimeEdgeOrigins }
}

function compileAtomic(statement: SceneCallStatement, contract: NodeFunctionContract): CompiledEntity & { ops: Op[] } {
  const entityId = stableEntityId('node', statement.statementId)
  const params: Record<string, unknown> = { ...(contract.runtimeDefaults ?? {}) }
  for (const [name, expression] of Object.entries(statement.args)) {
    const input = contract.inputs.find((candidate) => candidate.name === name)
    if (expression.kind !== 'reference' && input?.mode !== 'value') {
      params[name] = literalValueForAccess(expression, input?.access)
    } else if (!contract.inputs.some((input) => input.name === name) && expression.kind !== 'reference') {
      params[name] = literalValue(expression)
    }
  }
  return {
    statement,
    contract,
    entityId,
    runtimeNodeIds: [entityId],
    runtimeEdgeIds: [],
    ops: [
      {
        type: 'createNode',
        nodeId: entityId,
        opId: contract.opId!,
        params,
      },
    ],
  }
}

/**
 * Give a newly compiled Authoring Graph a readable deterministic layout.
 * Persisted layout (moduleId + statementId) still wins in the application
 * layer; this only prevents a first compile from placing every node at 0,0.
 */
function applyInitialAuthoringLayout(ops: Op[], entities: readonly CompiledEntity[]): void {
  const entityIds = new Set(entities.map((entity) => entity.entityId))
  const rank = new Map<string, number>([...entityIds].map((id) => [id, 0]))
  const edges = ops.filter((op): op is Extract<Op, { type: 'connect' }> => op.type === 'connect')

  // Graphs are expected to be DAGs. Bound iterations make malformed cycles
  // deterministic rather than allowing a layout pass to spin indefinitely.
  for (let iteration = 0; iteration < entityIds.size; iteration += 1) {
    let changed = false
    for (const edge of edges) {
      if (!entityIds.has(edge.source.nodeId) || !entityIds.has(edge.target.nodeId)) continue
      const next = (rank.get(edge.source.nodeId) ?? 0) + 1
      if (next > (rank.get(edge.target.nodeId) ?? 0)) {
        rank.set(edge.target.nodeId, next)
        changed = true
      }
    }
    if (!changed) break
  }

  const rowsByRank = new Map<number, number>()
  const positions = new Map<string, { x: number; y: number }>()
  for (const entity of entities) {
    const column = rank.get(entity.entityId) ?? 0
    const row = rowsByRank.get(column) ?? 0
    rowsByRank.set(column, row + 1)
    // Group nodes expand to fit their title and exposed ports, and commonly
    // exceed the old 280px column pitch. Keep enough horizontal clearance for
    // the rendered width so first-compile graphs do not overlap downstream nodes.
    positions.set(entity.entityId, { x: 80 + column * 360, y: 80 + row * 240 })
  }

  for (const op of ops) {
    if (op.type === 'createNode') {
      const position = positions.get(op.nodeId)
      if (position) op.position = position
    } else if (op.type === 'createGroup') {
      const position = positions.get(op.groupId)
      if (position) op.position = position
    }
  }
}

export function compileSceneModule(module: SceneModuleAst, registry: ContractRegistry): CompiledSceneModule {
  const diagnostics: SceneDiagnostic[] = []
  const entities: CompiledEntity[] = []
  const ops: Op[] = []
  const byBinding = new Map<string, CompiledEntity>()

  for (const statement of module.statements) {
    const contract = registry.get(statement.functionName)
    if (!contract) {
      diagnostics.push(
        compileDiagnostic(statement, undefined, 'SCENE_COMPILE_UNKNOWN_FUNCTION', `Unknown function '${statement.functionName}'.`, 'resolve'),
      )
      continue
    }
    if (contract.definitionScope === 'group-body') {
      diagnostics.push(
        compileDiagnostic(
          statement,
          contract,
          'SCENE_COMPILE_DEFINITION_SCOPE',
          `Function '${contract.functionName}' is an implementation detail and may only be called inside defineGroup.`,
          'capability',
        ),
      )
      continue
    }
    let entity: CompiledEntity
    if (contract.kind === 'atomic') {
      const atomic = compileAtomic(statement, contract)
      entity = atomic
      ops.push(...atomic.ops)
    } else {
      const group = compileGroup(statement, contract, diagnostics)
      entity = {
        statement,
        contract,
        entityId: group.entityId,
        runtimeNodeIds: group.runtimeNodeIds,
        runtimeEdgeIds: group.runtimeEdgeIds,
        runtimeOrigins: group.runtimeOrigins,
        runtimeEdgeOrigins: group.runtimeEdgeOrigins,
      }
      ops.push(...group.ops)
    }
    entities.push(entity)
    if (statement.binding) {
      if (byBinding.has(statement.binding)) {
        diagnostics.push(
          compileDiagnostic(statement, contract, 'SCENE_TYPE_DUPLICATE_BINDING', `Duplicate binding '${statement.binding}'.`, 'type'),
        )
      } else {
        byBinding.set(statement.binding, entity)
      }
    }
  }

  for (const entity of entities) {
    for (const input of entity.contract.inputs) {
      const expression = entity.statement.args[input.name]
      if (!expression) {
        if (input.required) {
          diagnostics.push(
            compileDiagnostic(
              entity.statement,
              entity.contract,
              'SCENE_TYPE_REQUIRED_INPUT',
              `Missing required input '${input.name}'.`,
              'type',
            ),
          )
        }
        continue
      }
      // Parameters accept both literal defaults and typed references. A literal
      // stays in the runtime node params; a reference must still become an edge
      // (e.g. stringValue(...) → gridSceneNode.name). Previously every
      // `parameter` input was skipped here, silently dropping those edges.
      const hasParameterReference =
        expression.kind === 'reference' ||
        (expression.kind === 'array' && expression.items.some((item) => item.kind === 'reference'))
      if (input.mode === 'parameter' && !hasParameterReference) continue
      const references =
        expression.kind === 'reference'
          ? [expression]
          : expression.kind === 'array'
            ? expression.items.filter((item): item is Extract<SceneExpression, { kind: 'reference' }> => item.kind === 'reference')
            : []
      if (references.length === 0) {
        diagnostics.push(
          compileDiagnostic(
            entity.statement,
            entity.contract,
            'SCENE_TYPE_EXPECTED_VALUE',
            `Input '${input.name}' expects a typed value from another node or group.`,
            'type',
          ),
        )
        continue
      }
      if (entity.contract.opId === 'tree_merge' && references.length > 0) {
        const create = ops.find(
          (op): op is Extract<Op, { type: 'createNode' }> =>
            op.type === 'createNode' && op.nodeId === entity.entityId,
        )
        if (create) create.params.portCount = references.length
      }
      references.forEach((reference, index) => {
        const sourceEntity = byBinding.get(reference.binding)
        if (!sourceEntity) {
          diagnostics.push(
            compileDiagnostic(
              entity.statement,
              entity.contract,
              'SCENE_RESOLVE_BINDING',
              `Unknown input binding '${reference.binding}'.`,
              'resolve',
            ),
          )
          return
        }
        const output = resolveOutput(sourceEntity.contract, reference.output)
        if (!output) {
          diagnostics.push(
            compileDiagnostic(
              entity.statement,
              entity.contract,
              'SCENE_TYPE_OUTPUT',
              reference.output
                ? `Function '${sourceEntity.contract.functionName}' has no output '${reference.output}'.`
                : `Function '${sourceEntity.contract.functionName}' has multiple outputs; select one by name.`,
              'type',
            ),
          )
          return
        }
        if (output.type !== input.type && output.type !== 'any' && input.type !== 'any') {
          diagnostics.push(
            compileDiagnostic(
              entity.statement,
              entity.contract,
              'SCENE_TYPE_MISMATCH',
              `Cannot connect ${sourceEntity.contract.functionName}.${output.name} (${output.type}) to ${entity.contract.functionName}.${input.name} (${input.type}).`,
              'type',
            ),
          )
          return
        }
        const edgeId = stableEntityId(
          'edge',
          `${sourceEntity.statement.statementId}:${output.name}:${entity.statement.statementId}:${input.name}:${index}`,
        )
        entity.runtimeEdgeIds.push(edgeId)
        sourceEntity.runtimeEdgeIds.push(edgeId)
        ops.push({
          type: 'connect',
          edgeId,
          source: { nodeId: sourceEntity.entityId, port: runtimePort(output) },
          target: {
            nodeId: entity.entityId,
            port: references.length > 1 ? `${runtimePort(input)}_${index}` : runtimePort(input),
          },
        })
      })
    }
  }

  const sourceMap: SourceMapEntry[] = entities.map((entity) => ({
    moduleId: module.moduleId,
    file: module.file,
    statementId: entity.statement.statementId,
    source: entity.statement.source,
    entityId: entity.entityId,
    runtimeNodeIds: entity.runtimeNodeIds,
    runtimeEdgeIds: [...new Set(entity.runtimeEdgeIds)],
    ...(entity.runtimeOrigins ? { runtimeOrigins: entity.runtimeOrigins } : {}),
    ...(entity.runtimeEdgeOrigins ? { runtimeEdgeOrigins: entity.runtimeEdgeOrigins } : {}),
    ...(entity.contract.definitionId ? { definitionId: entity.contract.definitionId } : {}),
    ...(entity.contract.definitionVersion ? { definitionVersion: entity.contract.definitionVersion } : {}),
    ...(entity.contract.kind !== 'atomic' ? { instancePath: entity.entityId } : {}),
  }))
  const resultCaptures = entities.flatMap((entity) => {
    const { opId, functionName } = entity.contract
    if (opId !== 'scene_output' && functionName !== 'sceneOutput') return []
    return [{
      entityId: entity.entityId,
      kind: 'sceneOutput' as const,
      functionName,
      opId: opId ?? functionName,
    }]
  })
  const resultEntityIds = resultCaptures.map((capture) => capture.entityId)

  applyInitialAuthoringLayout(ops, entities)

  return {
    module,
    ops,
    sourceMap,
    diagnostics,
    entityIds: entities.map((entity) => entity.entityId),
    resultEntityIds,
    resultCaptures,
  }
}

export function compiledOpsToKernelGraph(ops: readonly Op[]): KernelGraphV1 {
  const nodes = new Map<string, GraphNode>()
  const edges = new Map<string, GraphEdge>()
  const groups = new Map<string, NodeGroup>()
  for (const op of ops) {
    if (op.type === 'createNode') {
      nodes.set(op.nodeId, {
        id: op.nodeId,
        opId: op.opId,
        position: op.position ?? { x: 0, y: 0 },
        params: { ...op.params },
        ...(op.name ? { name: op.name } : {}),
      })
      continue
    }
    if (op.type === 'connect') {
      if (!op.edgeId) continue
      edges.set(op.edgeId, {
        id: op.edgeId,
        source: { ...op.source },
        target: { ...op.target },
      })
      continue
    }
    if (op.type === 'updateNode') {
      const node = nodes.get(op.nodeId)
      if (node) {
        if (op.params) node.params = { ...node.params, ...op.params }
        if (op.name !== undefined) node.name = op.name
        if (op.position !== undefined) node.position = { ...op.position }
      }
      continue
    }
    if (op.type !== 'createGroup') continue
    const members = op.memberNodeIds.map((id) => nodes.get(id)).filter((node): node is GraphNode => Boolean(node))
    const memberIds = new Set(members.map((node) => node.id))
    const innerEdges = [...edges.values()].filter(
      (edge) => memberIds.has(edge.source.nodeId) && memberIds.has(edge.target.nodeId),
    )
    for (const node of members) nodes.delete(node.id)
    for (const edge of innerEdges) edges.delete(edge.id)
    const position = op.position ?? { x: 0, y: 0 }
    const convertPorts = (
      ports: NonNullable<Extract<Op, { type: 'createGroup' }>['exposedPorts']>['inputs'] | undefined,
    ) =>
      (ports ?? []).map((port) => ({
        portName: port.portName,
        portType: port.portType ?? 'any',
        sourceNodeId: port.sourceNodeId,
        sourcePortName: port.sourcePortName,
        ...(port.access ? { access: port.access } : {}),
        ...(port.hidden !== undefined ? { hidden: port.hidden } : {}),
        ...(port.order !== undefined ? { order: port.order } : {}),
        ...(port.customLabel ? { customLabel: port.customLabel } : {}),
        ...(port.customLabelEn ? { customLabelEn: port.customLabelEn } : {}),
      }))
    const group: NodeGroup = {
      id: op.groupId,
      name: op.name,
      ...(op.nameEn ? { nameEn: op.nameEn } : {}),
      nodes: members,
      edges: innerEdges,
      position,
      exposedInputs: convertPorts(op.exposedPorts?.inputs),
      exposedOutputs: convertPorts(op.exposedPorts?.outputs),
    }
    groups.set(group.id, group)
    nodes.set(op.groupId, {
      id: op.groupId,
      opId: '__group__',
      name: op.name,
      position,
      params: { groupId: op.groupId },
    })
  }
  const childGroupIds = new Set<string>()
  for (const group of groups.values()) {
    for (const node of group.nodes) {
      if (node.opId === '__group__') childGroupIds.add(String(node.params.groupId ?? node.id))
    }
  }
  const embedGroup = (group: NodeGroup, visiting = new Set<string>()): NodeGroup => {
    if (visiting.has(group.id)) return group
    const nextVisiting = new Set(visiting).add(group.id)
    const nested = group.nodes
      .filter((node) => node.opId === '__group__')
      .map((node) => groups.get(String(node.params.groupId ?? node.id)))
      .filter((item): item is NodeGroup => Boolean(item))
      .map((item) => embedGroup(item, nextVisiting))
    return { ...group, ...(nested.length ? { _nestedGroups: nested } : {}) }
  }
  const rootGroups = [...groups.values()]
    .filter((group) => !childGroupIds.has(group.id))
    .map((group) => embedGroup(group))
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    groups: rootGroups,
  }
}

export function compileSceneProject(
  project: SceneProjectAst,
  registry: ContractRegistry,
  resolveImport: (fromModuleId: string, specifier: string) => string = (_from, specifier) => specifier,
): CompiledSceneModule {
  const ordered: SceneModuleAst[] = []
  const diagnostics: SceneDiagnostic[] = []
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const reportedCycles = new Set<string>()

  const visit = (moduleId: string): void => {
    if (visited.has(moduleId)) return
    if (visiting.has(moduleId)) {
      if (reportedCycles.has(moduleId)) return
      reportedCycles.add(moduleId)
      diagnostics.push(createSceneDiagnostic({
        code: 'SCENE_RESOLVE_IMPORT_CYCLE',
        phase: 'resolve',
        severity: 'error',
        message: `Scene module cycle detected at '${moduleId}'.`,
        expected: 'An acyclic Scene Script import graph.',
        actual: moduleId,
      }))
      return
    }
    const module = project.modules[moduleId]
    if (!module) {
      diagnostics.push(createSceneDiagnostic({
        code: 'SCENE_RESOLVE_MODULE',
        phase: 'resolve',
        severity: 'error',
        message: `Scene module '${moduleId}' was not found.`,
        expected: 'A readable imported .scene.ts module.',
        actual: moduleId,
      }))
      return
    }
    visiting.add(moduleId)
    for (const item of module.imports) visit(resolveImport(moduleId, item.from))
    visiting.delete(moduleId)
    visited.add(moduleId)
    ordered.push(module)
  }

  visit(project.entryModuleId)
  const entry = project.modules[project.entryModuleId] ?? {
    moduleId: project.entryModuleId,
    file: project.entryModuleId,
    imports: [],
    definitions: [],
    statements: [],
  }

  type LinkedSymbol =
    | { kind: 'value'; qualifiedBinding: string }
    | { kind: 'function'; registryName: string }

  const localSymbol = (module: SceneModuleAst, name: string): LinkedSymbol | undefined => {
    if (module.statements.some((statement) => statement.binding === name)) {
      return { kind: 'value', qualifiedBinding: `${module.moduleId}::${name}` }
    }
    if (module.definitions.some((definition) => definition.exportName === name)) {
      const qualified = `${module.moduleId}::${name}`
      return { kind: 'function', registryName: registry.get(qualified) ? qualified : name }
    }
    return undefined
  }

  const resolveExport = (
    moduleId: string,
    exportedName: string,
    resolving = new Set<string>(),
  ): LinkedSymbol | undefined => {
    const key = `${moduleId}::${exportedName}`
    if (resolving.has(key)) return undefined
    const module = project.modules[moduleId]
    if (!module) return undefined
    const exported = module.exports.find((item) => item.exported === exportedName)
    if (!exported) return undefined
    const local = localSymbol(module, exported.local)
    if (local) return local
    const imported = module.imports
      .flatMap((item) => (item.specifiers ?? item.names.map((name) => ({ imported: name, local: name })))
        .map((specifier) => ({ item, specifier })))
      .find(({ specifier }) => specifier.local === exported.local)
    if (!imported) return undefined
    return resolveExport(
      resolveImport(moduleId, imported.item.from),
      imported.specifier.imported,
      new Set(resolving).add(key),
    )
  }

  const importedSymbols = new Map<string, Map<string, LinkedSymbol>>()
  for (const module of ordered) {
    const symbols = new Map<string, LinkedSymbol>()
    for (const item of module.imports) {
      const targetId = resolveImport(module.moduleId, item.from)
      if (!project.modules[targetId]) continue
      for (const specifier of item.specifiers ?? item.names.map((name) => ({ imported: name, local: name }))) {
        const symbol = resolveExport(targetId, specifier.imported)
        if (!symbol) {
          diagnostics.push(createSceneDiagnostic({
            code: 'SCENE_RESOLVE_IMPORT_EXPORT',
            phase: 'resolve',
            severity: 'error',
            message: `Module '${targetId}' does not export '${specifier.imported}'.`,
            source: item.source,
            expected: 'An explicitly exported Scene symbol.',
            actual: specifier.imported,
          }))
          continue
        }
        symbols.set(specifier.local, symbol)
      }
    }
    importedSymbols.set(module.moduleId, symbols)
  }

  const statementOrigins = new Map<string, { moduleId: string; file: string; statementId: string }>()
  const linkedStatements = ordered.flatMap((module) => module.statements.map((statement) => {
    const qualifiedStatementId = `${module.moduleId}::${statement.statementId}`
    statementOrigins.set(qualifiedStatementId, {
      moduleId: module.moduleId,
      file: module.file,
      statementId: statement.statementId,
    })
    const imports = importedSymbols.get(module.moduleId) ?? new Map<string, LinkedSymbol>()
    const rewriteExpression = (expression: SceneExpression): SceneExpression => {
      if (expression.kind === 'reference') {
        const isLocal = module.statements.some((candidate) => candidate.binding === expression.binding)
        const symbol = isLocal
          ? { kind: 'value' as const, qualifiedBinding: `${module.moduleId}::${expression.binding}` }
          : imports.get(expression.binding)
        return {
          ...expression,
          binding: symbol?.kind === 'value'
            ? symbol.qualifiedBinding
            : `${module.moduleId}::${expression.binding}`,
        }
      }
      if (expression.kind === 'array') return { ...expression, items: expression.items.map(rewriteExpression) }
      if (expression.kind === 'object') {
        return {
          ...expression,
          properties: Object.fromEntries(
            Object.entries(expression.properties).map(([name, value]) => [name, rewriteExpression(value)]),
          ),
        }
      }
      return expression
    }
    const importedFunction = imports.get(statement.functionName)
    const localDefinition = localSymbol(module, statement.functionName)
    return {
      ...statement,
      statementId: qualifiedStatementId,
      ...(statement.binding ? { binding: `${module.moduleId}::${statement.binding}` } : {}),
      functionName: importedFunction?.kind === 'function'
        ? importedFunction.registryName
        : localDefinition?.kind === 'function'
          ? localDefinition.registryName
          : statement.functionName,
      args: Object.fromEntries(
        Object.entries(statement.args).map(([name, expression]) => [name, rewriteExpression(expression)]),
      ),
    }
  }))

  const combined: SceneModuleAst = {
    moduleId: project.entryModuleId,
    file: entry.file,
    imports: [],
    exports: [],
    definitions: [],
    statements: linkedStatements,
  }
  const compiled = compileSceneModule(combined, registry)
  const sourceMap = compiled.sourceMap.map((item) => {
    const origin = statementOrigins.get(item.statementId)
    return origin ? {
      ...item,
      moduleId: origin.moduleId,
      file: origin.file,
      statementId: origin.statementId,
    } : item
  })
  return { ...compiled, sourceMap, diagnostics: [...diagnostics, ...compiled.diagnostics] }
}
