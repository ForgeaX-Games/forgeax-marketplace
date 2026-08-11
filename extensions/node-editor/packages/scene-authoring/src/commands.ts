import { hasGroupCapability } from './contracts.js'
import { createSceneDiagnostic } from './diagnostics.js'
import { stableEntityId } from './identity.js'
import { parseSceneModule } from './parser.js'
import { printSceneModule } from './printer.js'
import type {
  ActorKind,
  ContractRegistry,
  NodeFunctionContract,
  SceneAuthoringConfirmation,
  SceneCallStatement,
  SceneDefinitionAuthoringMeta,
  SceneDefinitionPort,
  SceneDiagnostic,
  SceneDiagnosticFix,
  SceneExpression,
  SceneGroupDefinition,
  SceneImport,
  SceneModuleAst,
  ScenePortTypeName,
  SceneProjectAst,
} from './types.js'

export type AuthoringCommand =
  | {
      type: 'addCall'
      /** Explicit destination for project transactions. */
      moduleId?: string
      file?: string
      functionName: string
      binding?: string
      args?: Record<string, SceneExpression>
      afterStatementId?: string
      statementId?: string
    }
  | {
      type: 'updateArguments'
      moduleId?: string
      file?: string
      statementId: string
      set?: Record<string, SceneExpression>
      unset?: string[]
    }
  | {
      type: 'connectValue'
      moduleId?: string
      file?: string
      statementId: string
      input: string
      sourceStatementId: string
      sourceModuleId?: string
      sourceFile?: string
      output?: string
      append?: boolean
    }
  | { type: 'disconnectValue'; moduleId?: string; file?: string; statementId: string; input: string; sourceStatementId?: string; sourceModuleId?: string; sourceFile?: string; output?: string }
  | { type: 'removeCall'; moduleId?: string; file?: string; statementId: string }
  | { type: 'renameBinding'; moduleId?: string; file?: string; statementId: string; binding: string }
  | {
      type: 'moveStatement'
      moduleId?: string
      file?: string
      statementId: string
      targetModuleId?: string
      targetFile?: string
      afterStatementId?: string
    }
  | (({ type: 'extractDefinition' } | { type: 'wrapInGroup' }) & {
      moduleId?: string
      file?: string
      statementIds: string[]
      meta?: Partial<SceneDefinitionAuthoringMeta>
    })
  | (({ type: 'inlineDefinition' } | { type: 'ungroup' }) & {
      moduleId?: string
      file?: string
      statementId: string
      strategy?: 'current-instance' | 'shared-definition'
    })
  | {
      type: 'setCapturedOutput'
      moduleId?: string
      file?: string
      statementId: string
      sourceStatementId: string
      output?: string
      input?: string
    }
  | {
      type: 'editSealedInternal'
      moduleId?: string
      file?: string
      statementId: string
      runtimeNodeId: string
      patch: Record<string, unknown>
    }

export interface ApplyAuthoringCommandsResult {
  module: SceneModuleAst
  diagnostics: SceneDiagnostic[]
  applied: number
}

export interface ApplyProjectAuthoringCommandsResult {
  project: SceneProjectAst
  diagnostics: SceneDiagnostic[]
  applied: number
  changedModuleIds: string[]
  confirmations: SceneAuthoringConfirmation[]
}

function referencesBinding(expression: SceneExpression, binding: string): boolean {
  if (expression.kind === 'reference') return expression.binding === binding
  if (expression.kind === 'array') return expression.items.some((item) => referencesBinding(item, binding))
  if (expression.kind === 'object') return Object.values(expression.properties).some((item) => referencesBinding(item, binding))
  return false
}

function removeReference(
  expression: SceneExpression,
  binding: string,
  output?: string,
): SceneExpression | undefined {
  if (expression.kind === 'reference') {
    return expression.binding === binding && (output === undefined || expression.output === output)
      ? undefined
      : expression
  }
  if (expression.kind === 'array') {
    const items = expression.items.flatMap((item) => {
      const next = removeReference(item, binding, output)
      return next ? [next] : []
    })
    return items.length ? { ...expression, items } : undefined
  }
  if (expression.kind === 'object') {
    const properties = Object.fromEntries(Object.entries(expression.properties).flatMap(([name, item]) => {
      const next = removeReference(item, binding, output)
      return next ? [[name, next]] : []
    }))
    return Object.keys(properties).length ? { ...expression, properties } : undefined
  }
  return expression
}

function commandDiagnostic(
  code: string,
  message: string,
  phase: SceneDiagnostic['phase'],
  statementId?: string,
): SceneDiagnostic {
  return createSceneDiagnostic({
    code,
    phase,
    severity: 'error',
    message,
    ...(statementId ? { statementId } : {}),
  })
}

function cloneExpression(expression: SceneExpression): SceneExpression {
  if (expression.kind === 'array') return { kind: 'array', items: expression.items.map(cloneExpression) }
  if (expression.kind === 'object') {
    return {
      kind: 'object',
      properties: Object.fromEntries(Object.entries(expression.properties).map(([key, value]) => [key, cloneExpression(value)])),
    }
  }
  return { ...expression }
}

function rewriteExpression(
  expression: SceneExpression,
  rewrite: (reference: Extract<SceneExpression, { kind: 'reference' }>) => SceneExpression | undefined,
): SceneExpression {
  if (expression.kind === 'reference') return rewrite(expression) ?? expression
  if (expression.kind === 'array') return { ...expression, items: expression.items.map((item) => rewriteExpression(item, rewrite)) }
  if (expression.kind === 'object') {
    return {
      ...expression,
      properties: Object.fromEntries(
        Object.entries(expression.properties).map(([key, value]) => [key, rewriteExpression(value, rewrite)]),
      ),
    }
  }
  return expression
}

function cloneModule(input: SceneModuleAst): SceneModuleAst {
  return {
    ...input,
    imports: input.imports.map((item) => ({
      ...item,
      names: [...item.names],
      specifiers: item.specifiers.map((specifier) => ({ ...specifier })),
      source: { ...item.source },
    })),
    exports: input.exports.map((item) => ({ ...item, source: { ...item.source } })),
    definitions: input.definitions.map((definition) => ({
      ...definition,
      meta: {
        ...definition.meta,
        inputs: Object.fromEntries(Object.entries(definition.meta.inputs).map(([name, port]) => [name, { ...port }])),
        outputs: Object.fromEntries(Object.entries(definition.meta.outputs).map(([name, port]) => [name, { ...port }])),
      },
      paramNames: [...definition.paramNames],
      body: definition.body.map((statement) => ({
        ...statement,
        args: Object.fromEntries(Object.entries(statement.args).map(([name, value]) => [name, cloneExpression(value)])),
        source: { ...statement.source },
      })),
      returnOutputs: Object.fromEntries(
        Object.entries(definition.returnOutputs).map(([name, value]) => [name, cloneExpression(value)]),
      ),
      source: { ...definition.source },
    })),
    statements: input.statements.map((statement) => ({
      ...statement,
      args: Object.fromEntries(Object.entries(statement.args).map(([name, value]) => [name, cloneExpression(value)])),
      source: { ...statement.source },
    })),
  }
}

function validBinding(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
}

function uniqueName(base: string, used: Set<string>): string {
  const normalized = base.replace(/[^A-Za-z0-9_$]/g, '') || 'value'
  const candidate = /^[A-Za-z_$]/.test(normalized) ? normalized : `value${normalized}`
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }
  let suffix = 2
  while (used.has(`${candidate}${suffix}`)) suffix += 1
  const result = `${candidate}${suffix}`
  used.add(result)
  return result
}

function moduleSpecifier(fromFile: string, toFile: string): string {
  const from = fromFile.replace(/\\/g, '/').split('/')
  const to = toFile.replace(/\\/g, '/').split('/')
  from.pop()
  while (from.length && to.length && from[0] === to[0]) {
    from.shift()
    to.shift()
  }
  const relative = `${'../'.repeat(from.length)}${to.join('/')}`
  return relative.startsWith('.') ? relative : `./${relative}`
}

function resolveModuleFile(fromFile: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  const parts = [...fromFile.replace(/\\/g, '/').split('/').slice(0, -1), ...specifier.split('/')]
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return normalized.join('/')
}

function addImport(module: SceneModuleAst, from: string, imported: string, preferredLocal = imported): string {
  const existing = module.imports
    .flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
    .find(({ item, specifier }) => item.from === from && specifier.imported === imported)
  if (existing) return existing.specifier.local
  const used = new Set([
    ...module.imports.flatMap((item) => item.specifiers.map((specifier) => specifier.local)),
    ...module.definitions.map((item) => item.exportName),
    ...module.statements.flatMap((item) => item.binding ? [item.binding] : []),
  ])
  const local = uniqueName(preferredLocal, used)
  const target = module.imports.find((item) => item.from === from)
  if (target) {
    target.specifiers.push({ imported, local })
    target.names.push(local)
  } else {
    module.imports.push({
      names: [local],
      specifiers: [{ imported, local }],
      from,
      source: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
    })
  }
  return local
}

function addExport(module: SceneModuleAst, local: string, exported = local): void {
  if (!module.exports.some((item) => item.local === local && item.exported === exported)) {
    module.exports.push({
      local,
      exported,
      source: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
    })
  }
}

function contractPortType(contract: NodeFunctionContract | undefined, direction: 'input' | 'output', port: string): SceneDefinitionPort {
  const candidate = (direction === 'input' ? contract?.inputs : contract?.outputs)?.find((item) => item.name === port)
  const runtimeType = candidate?.type
  const catalog: Array<[RegExp, ScenePortTypeName]> = [
    [/scene/i, 'Scene'],
    [/number|float|double|int/i, 'NumberValue'],
    [/string|text/i, 'StringValue'],
    [/bool/i, 'BooleanValue'],
    [/grid/i, 'Grid'],
    [/point/i, 'Point2d'],
  ]
  const type = catalog.find(([pattern]) => pattern.test(runtimeType ?? ''))?.[1] ?? 'Any'
  return {
    type,
    ...(type === 'Any' && runtimeType ? { runtimeType } : {}),
    ...(candidate?.access ? { access: candidate.access } : {}),
  }
}

function semanticModule(module: SceneModuleAst): unknown {
  return {
    moduleId: module.moduleId,
    file: module.file,
    imports: module.imports.map(({ from, specifiers }) => ({ from, specifiers })),
    exports: module.exports.map(({ local, exported }) => ({ local, exported })),
    definitions: module.definitions.map((definition) => ({
      definitionId: definition.definitionId,
      exportName: definition.exportName,
      meta: definition.meta,
      paramNames: definition.paramNames,
      body: definition.body.map(({ source: _source, contractKind: _contractKind, ...statement }) => statement),
      returnOutputs: definition.returnOutputs,
    })),
    statements: module.statements.map(({ source: _source, contractKind: _contractKind, ...statement }) => statement),
  }
}

function stableSemantic(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSemantic).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSemantic(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function verifyCanonicalRoundTrip(module: SceneModuleAst, registry: ContractRegistry): SceneDiagnostic[] {
  const printed = printSceneModule(module)
  const reparsed = parseSceneModule(printed, { file: module.file, moduleId: module.moduleId, registry })
  const diagnostics = reparsed.diagnostics.filter((item) => item.severity === 'error')
  if (diagnostics.length) return diagnostics
  if (stableSemantic(semanticModule(reparsed.module)) !== stableSemantic(semanticModule(module))) {
    return [{
      ...commandDiagnostic(
        'SCENE_COMMAND_ROUNDTRIP_MISMATCH',
        `Canonical print/reparse changed the semantics of module '${module.file}'.`,
        'verify',
      ),
      expected: semanticModule(module),
      actual: semanticModule(reparsed.module),
    }]
  }
  return []
}

export function expressionFromJson(value: unknown): SceneExpression {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'literal', value: value as string | number | boolean | null }
  }
  if (Array.isArray(value)) return { kind: 'array', items: value.map(expressionFromJson) }
  if (typeof value === 'object') {
    return {
      kind: 'object',
      properties: Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, expressionFromJson(item)])),
    }
  }
  throw new Error(`Scene Script values must be JSON-compatible; received ${typeof value}`)
}

export function applyAuthoringCommands(
  input: SceneModuleAst,
  commands: readonly AuthoringCommand[],
  options: { actor: ActorKind; registry: ContractRegistry },
): ApplyAuthoringCommandsResult {
  const module = cloneModule(input)
  const diagnostics: SceneDiagnostic[] = []
  let applied = 0

  for (const command of commands) {
    if (command.type === 'addCall') {
      const contract = options.registry.get(command.functionName)
      if (!contract) {
        diagnostics.push(
          commandDiagnostic('SCENE_COMMAND_UNKNOWN_FUNCTION', `Unknown Scene function '${command.functionName}'.`, 'resolve'),
        )
        continue
      }
      const statementId =
        command.statementId ??
        stableEntityId('stmt', `${module.moduleId}:${command.functionName}:${command.binding ?? ''}:${module.statements.length}`)
      const statement = {
        kind: 'call' as const,
        statementId,
        ...(command.binding ? { binding: command.binding } : {}),
        functionName: command.functionName,
        args: { ...(command.args ?? {}) },
        contractKind: contract.kind,
        source: { file: module.file, start: 0, end: 0, line: 1, column: 1 },
      }
      const afterIndex = command.afterStatementId
        ? module.statements.findIndex((item) => item.statementId === command.afterStatementId)
        : -1
      module.statements.splice(afterIndex >= 0 ? afterIndex + 1 : module.statements.length, 0, statement)
      applied += 1
      continue
    }

    if (command.type === 'moveStatement'
      || command.type === 'extractDefinition'
      || command.type === 'wrapInGroup'
      || command.type === 'inlineDefinition'
      || command.type === 'ungroup') {
      diagnostics.push(commandDiagnostic(
        'SCENE_COMMAND_PROJECT_CONTEXT_REQUIRED',
        `Command '${command.type}' requires a Scene Project transaction.`,
        'capability',
        'statementId' in command ? command.statementId : command.statementIds[0],
      ))
      continue
    }

    const index = module.statements.findIndex((item) => item.statementId === command.statementId)
    const statement = module.statements[index]
    if (!statement) {
      diagnostics.push(
        commandDiagnostic(
          'SCENE_COMMAND_TARGET_NOT_FOUND',
          `Authoring entity '${command.statementId}' does not exist.`,
          'resolve',
          command.statementId,
        ),
      )
      continue
    }
    const contract = options.registry.get(statement.functionName)

    if (command.type === 'renameBinding') {
      if (!statement.binding) {
        diagnostics.push(commandDiagnostic(
          'SCENE_COMMAND_SOURCE_NOT_BINDABLE',
          `Authoring entity '${statement.statementId}' has no binding.`,
          'resolve',
          statement.statementId,
        ))
        continue
      }
      if (!validBinding(command.binding)) {
        diagnostics.push(commandDiagnostic(
          'SCENE_COMMAND_INVALID_BINDING',
          `'${command.binding}' is not a valid Scene Script binding.`,
          'parse',
          statement.statementId,
        ))
        continue
      }
      if (module.statements.some((item) => item !== statement && item.binding === command.binding)
        || module.definitions.some((item) => item.exportName === command.binding)
        || module.imports.some((item) => item.specifiers.some((specifier) => specifier.local === command.binding))) {
        diagnostics.push(commandDiagnostic(
          'SCENE_COMMAND_DUPLICATE_BINDING',
          `Binding '${command.binding}' already exists in module '${module.file}'.`,
          'resolve',
          statement.statementId,
        ))
        continue
      }
      const previous = statement.binding
      statement.binding = command.binding
      for (const candidate of module.statements) {
        candidate.args = Object.fromEntries(
          Object.entries(candidate.args).map(([name, value]) => [
            name,
            rewriteExpression(value, (reference) =>
              reference.binding === previous ? { ...reference, binding: command.binding } : reference),
          ]),
        )
      }
      for (const exported of module.exports) if (exported.local === previous) exported.local = command.binding
      applied += 1
      continue
    }

    if (command.type === 'setCapturedOutput') {
      const source = module.statements.find((item) => item.statementId === command.sourceStatementId)
      if (!source?.binding) {
        diagnostics.push(commandDiagnostic(
          'SCENE_COMMAND_SOURCE_NOT_BINDABLE',
          `Source entity '${command.sourceStatementId}' has no binding.`,
          'resolve',
          command.sourceStatementId,
        ))
        continue
      }
      statement.args[command.input ?? 'scene'] = {
        kind: 'reference',
        binding: source.binding,
        ...(command.output ? { output: command.output } : {}),
      }
      applied += 1
      continue
    }

    if (command.type === 'editSealedInternal') {
      const canEdit =
        contract?.kind === 'atomic' ||
        (contract ? hasGroupCapability(contract, options.actor, 'editInstanceOverride') : false)
      if (!canEdit) {
        diagnostics.push({
          ...commandDiagnostic(
            'SCENE_CAPABILITY_SEALED_INTERNAL',
            `Actor '${options.actor}' cannot edit the internal topology of sealed entity '${statement.functionName}'. Configure or replace the entity through its public contract.`,
            'capability',
            statement.statementId,
          ),
          expected: 'A public configure, connect, move, replace, or remove command.',
          actual: { command: command.type, runtimeNodeId: command.runtimeNodeId },
        })
        continue
      }
      diagnostics.push(
        commandDiagnostic(
          'SCENE_COMMAND_OVERRIDE_UNSUPPORTED',
          'Internal instance overrides are not represented by the current Scene Script version.',
          'capability',
          statement.statementId,
        ),
      )
      continue
    }

    if (command.type === 'removeCall') {
      const referenced = module.statements.some((candidate) =>
        Object.values(candidate.args).some((expression) =>
          statement.binding ? referencesBinding(expression, statement.binding) : false),
      )
      if (referenced && statement.binding) {
        diagnostics.push(
          commandDiagnostic(
            'SCENE_COMMAND_REFERENCED_ENTITY',
            `Cannot remove '${statement.binding}' while another entity references it.`,
            'type',
            statement.statementId,
          ),
        )
        continue
      }
      module.statements.splice(index, 1)
      applied += 1
      continue
    }

    if (command.type === 'updateArguments') {
      for (const key of command.unset ?? []) delete statement.args[key]
      Object.assign(statement.args, command.set ?? {})
      applied += 1
      continue
    }

    if (command.type === 'disconnectValue') {
      if (!command.sourceStatementId) {
        delete statement.args[command.input]
      } else {
        const source = module.statements.find((item) => item.statementId === command.sourceStatementId)
        const current = statement.args[command.input]
        if (source?.binding && current) {
          const next = removeReference(current, source.binding, command.output)
          if (next) statement.args[command.input] = next
          else delete statement.args[command.input]
        }
      }
      applied += 1
      continue
    }

    const source = module.statements.find((item) => item.statementId === command.sourceStatementId)
    if (!source?.binding) {
      diagnostics.push(
        commandDiagnostic(
          'SCENE_COMMAND_SOURCE_NOT_BINDABLE',
          `Source entity '${command.sourceStatementId}' has no binding.`,
          'resolve',
          command.sourceStatementId,
        ),
      )
      continue
    }
    const reference: SceneExpression = {
      kind: 'reference',
      binding: source.binding,
      ...(command.output ? { output: command.output } : {}),
    }
    const current = statement.args[command.input]
    if (command.append && current) {
      const items = current.kind === 'array' ? [...current.items] : [current]
      if (!items.some((item) =>
        item.kind === 'reference' && item.binding === source.binding && item.output === command.output)) {
        items.push(reference)
      }
      statement.args[command.input] = { kind: 'array', items }
    } else {
      statement.args[command.input] = reference
    }
    applied += 1
  }

  return { module, diagnostics, applied }
}

function referencesOf(expression: SceneExpression): Array<Extract<SceneExpression, { kind: 'reference' }>> {
  if (expression.kind === 'reference') return [expression]
  if (expression.kind === 'array') return expression.items.flatMap(referencesOf)
  if (expression.kind === 'object') return Object.values(expression.properties).flatMap(referencesOf)
  return []
}

function extractProposal(
  modules: Record<string, SceneModuleAst>,
  module: SceneModuleAst,
  statementIds: readonly string[],
  registry: ContractRegistry,
): SceneDefinitionAuthoringMeta {
  const selected = module.statements.filter((statement) => statementIds.includes(statement.statementId))
  const selectedBindings = new Set(selected.flatMap((statement) => statement.binding ? [statement.binding] : []))
  const allBindings = new Map(module.statements.flatMap((statement) => statement.binding ? [[statement.binding, statement] as const] : []))
  const inputReferences = selected.flatMap((statement) => Object.values(statement.args).flatMap(referencesOf))
    .filter((reference) => !selectedBindings.has(reference.binding))
  const inputs: SceneDefinitionAuthoringMeta['inputs'] = []
  const inputKeys = new Set<string>()
  for (const reference of inputReferences) {
    const key = `${reference.binding}\0${reference.output ?? ''}`
    if (inputKeys.has(key)) continue
    inputKeys.add(key)
    const source = allBindings.get(reference.binding)
    const contract = source ? registry.get(source.functionName) : undefined
    const sourcePort = reference.output ?? contract?.outputs[0]?.name ?? 'value'
    const descriptor = contractPortType(contract, 'output', sourcePort)
    inputs.push({
      name: reference.output ? `${reference.binding}_${reference.output}` : reference.binding,
      ...descriptor,
      sourceStatementId: source?.statementId ?? `import:${reference.binding}`,
      sourcePort,
    })
  }
  const outside = module.statements.filter((statement) => !statementIds.includes(statement.statementId))
  const outputs: SceneDefinitionAuthoringMeta['outputs'] = []
  const outputKeys = new Set<string>()
  for (const consumer of outside) {
    for (const reference of Object.values(consumer.args).flatMap(referencesOf)) {
      if (!selectedBindings.has(reference.binding)) continue
      const source = allBindings.get(reference.binding)!
      const contract = registry.get(source.functionName)
      const sourcePort = reference.output ?? contract?.outputs[0]?.name ?? 'value'
      const key = `${source.statementId}\0${sourcePort}`
      if (outputKeys.has(key)) continue
      outputKeys.add(key)
      const descriptor = contractPortType(contract, 'output', sourcePort)
      outputs.push({
        name: outputs.length === 0 && outside.length === 1 ? sourcePort : `${reference.binding}_${sourcePort}`,
        ...descriptor,
        sourceStatementId: source.statementId,
        sourcePort,
      })
    }
  }
  const selectedExports = module.exports.filter((item) => {
    const statement = allBindings.get(item.local)
    return statement ? statementIds.includes(statement.statementId) : false
  })
  for (const exported of selectedExports) {
    const source = allBindings.get(exported.local)!
    const contract = registry.get(source.functionName)
    const sourcePort = contract?.outputs[0]?.name ?? 'value'
    const key = `${source.statementId}\0${sourcePort}`
    if (!outputKeys.has(key)) {
      outputKeys.add(key)
      outputs.push({
        name: `${exported.exported}_${sourcePort}`,
        ...contractPortType(contract, 'output', sourcePort),
        sourceStatementId: source.statementId,
        sourcePort,
      })
    }
    for (const importer of Object.values(modules)) {
      if (importer.moduleId === module.moduleId) continue
      const expected = moduleSpecifier(importer.file, module.file)
      const importSpecifiers = importer.imports
        .filter((item) => item.from === expected)
        .flatMap((item) => item.specifiers)
        .filter((specifier) => specifier.imported === exported.exported)
      if (importSpecifiers.length === 0) continue
      // The exported binding is a single-output value unless consumers
      // explicitly select another output after import.
      for (const specifier of importSpecifiers) {
        for (const reference of importer.statements.flatMap((statement) =>
          Object.values(statement.args).flatMap(referencesOf))) {
          if (reference.binding !== specifier.local) continue
          const referencedPort = reference.output ?? sourcePort
          const referenceKey = `${source.statementId}\0${referencedPort}`
          if (outputKeys.has(referenceKey)) continue
          outputKeys.add(referenceKey)
          outputs.push({
            name: `${exported.exported}_${referencedPort}`,
            ...contractPortType(contract, 'output', referencedPort),
            sourceStatementId: source.statementId,
            sourcePort: referencedPort,
          })
        }
      }
    }
  }
  const base = 'ExtractedGroup'
  return {
    name: base,
    file: 'groups/extracted-group.scene.ts',
    definitionId: stableEntityId('def', `${module.moduleId}:${statementIds.join(':')}`),
    version: '1.0.0',
    inputs,
    outputs,
    seal: true,
    confirmed: false,
  }
}

function applyExtractDefinition(
  modules: Record<string, SceneModuleAst>,
  owner: SceneModuleAst,
  command: Extract<AuthoringCommand, { type: 'extractDefinition' | 'wrapInGroup' }>,
  registry: ContractRegistry,
): { changed: string[]; confirmation?: SceneAuthoringConfirmation; diagnostic?: SceneDiagnostic } {
  const selected = owner.statements.filter((statement) => command.statementIds.includes(statement.statementId))
  if (selected.length !== command.statementIds.length || selected.length === 0) {
    return {
      changed: [],
      diagnostic: commandDiagnostic(
        'SCENE_COMMAND_SELECTION_NOT_FOUND',
        'Extract Definition requires existing statements from one module.',
        'resolve',
        command.statementIds[0],
      ),
    }
  }
  const selectedSet = new Set(command.statementIds)
  const selectedBindings = new Set(selected.flatMap((statement) => statement.binding ? [statement.binding] : []))
  for (const statement of selected) {
    for (const reference of Object.values(statement.args).flatMap(referencesOf)) {
      const source = owner.statements.find((item) => item.binding === reference.binding)
      if (source && !selectedSet.has(source.statementId)) continue
      if (!source && owner.imports.some((item) => item.specifiers.some((specifier) => specifier.local === reference.binding))) continue
      if (!selectedBindings.has(reference.binding)) continue
    }
  }
  const proposal = extractProposal(modules, owner, command.statementIds, registry)
  const meta: SceneDefinitionAuthoringMeta = {
    ...proposal,
    ...command.meta,
    inputs: command.meta?.inputs ?? proposal.inputs,
    outputs: command.meta?.outputs ?? proposal.outputs,
    confirmed: command.meta?.confirmed === true,
  }
  if (!meta.confirmed) {
    return {
      changed: [],
      confirmation: {
        kind: 'extract-definition',
        commandIndex: -1,
        selectedStatementIds: [...command.statementIds],
        meta,
      },
    }
  }
  if (!validBinding(meta.name) || !meta.file.endsWith('.scene.ts') || Object.values(modules).some((item) => item.file === meta.file)) {
    return {
      changed: [],
      diagnostic: commandDiagnostic(
        'SCENE_COMMAND_INVALID_DEFINITION_META',
        `Definition metadata name/file is invalid or already exists: '${meta.name}' / '${meta.file}'.`,
        'resolve',
      ),
    }
  }
  const inputByKey = new Map(meta.inputs.map((port) => [`${port.sourceStatementId}\0${port.sourcePort}`, port]))
  const sourceByBinding = new Map(owner.statements.flatMap((statement) => statement.binding ? [[statement.binding, statement] as const] : []))
  const body = selected.map((statement) => ({
    ...statement,
    source: { ...statement.source, file: meta.file },
    args: Object.fromEntries(Object.entries(statement.args).map(([name, expression]) => [
      name,
      rewriteExpression(cloneExpression(expression), (reference) => {
        if (selectedBindings.has(reference.binding)) return reference
        const source = sourceByBinding.get(reference.binding)
        const contract = source ? registry.get(source.functionName) : undefined
        const sourcePort = reference.output ?? contract?.outputs[0]?.name ?? 'value'
        const port = inputByKey.get(`${source?.statementId ?? `import:${reference.binding}`}\0${sourcePort}`)
        return port ? { kind: 'reference', binding: port.name } : reference
      }),
    ])),
  }))
  const outputByKey = new Map(meta.outputs.map((port) => [`${port.sourceStatementId}\0${port.sourcePort}`, port]))
  const definition: SceneGroupDefinition = {
    kind: 'group-definition',
    definitionId: meta.definitionId,
    exportName: meta.name,
    meta: {
      id: meta.definitionId,
      version: meta.version,
      sealed: meta.seal,
      inputs: Object.fromEntries(meta.inputs.map((port) => [
        port.name,
        { type: port.type, ...(port.runtimeType ? { runtimeType: port.runtimeType } : {}), ...(port.access ? { access: port.access } : {}) },
      ])),
      outputs: Object.fromEntries(meta.outputs.map((port) => [
        port.name,
        { type: port.type, ...(port.runtimeType ? { runtimeType: port.runtimeType } : {}), ...(port.access ? { access: port.access } : {}) },
      ])),
    },
    paramNames: meta.inputs.map((port) => port.name),
    body,
    returnOutputs: Object.fromEntries(meta.outputs.map((port) => {
      const source = owner.statements.find((statement) => statement.statementId === port.sourceStatementId)
      return [port.name, {
        kind: 'reference',
        binding: source?.binding ?? port.name,
        output: port.sourcePort,
      } as SceneExpression]
    })),
    source: { file: meta.file, start: 0, end: 0, line: 1, column: 1 },
  }
  const definitionImports: SceneImport[] = []
  for (const statement of selected) {
    const imported = owner.imports
      .flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
      .find(({ specifier }) => specifier.local === statement.functionName)
    if (!imported) continue
    const importFrom = imported.item.from.startsWith('.')
      ? moduleSpecifier(meta.file, resolveModuleFile(owner.file, imported.item.from))
      : imported.item.from
    let target = definitionImports.find((item) => item.from === importFrom
      && item.specifiers.some((specifier) => specifier.imported === imported.specifier.imported))
    if (!target) {
      target = {
        names: [],
        specifiers: [],
        from: importFrom,
        source: { file: meta.file, start: 0, end: 0, line: 1, column: 1 },
      }
      definitionImports.push(target)
    }
    target.names.push(statement.functionName)
    target.specifiers.push({ imported: imported.specifier.imported, local: statement.functionName })
  }
  const definitionModuleId = stableEntityId('module', meta.definitionId)
  const definitionModule: SceneModuleAst = {
    moduleId: definitionModuleId,
    file: meta.file,
    imports: definitionImports,
    exports: [{ local: meta.name, exported: meta.name, source: { file: meta.file, start: 0, end: 0, line: 1, column: 1 } }],
    definitions: [definition],
    statements: [],
  }
  modules[definitionModuleId] = definitionModule

  const used = new Set(owner.statements.flatMap((statement) => statement.binding ? [statement.binding] : []))
  const instanceBinding = uniqueName(meta.name.charAt(0).toLowerCase() + meta.name.slice(1), used)
  const firstIndex = Math.min(...selected.map((statement) => owner.statements.indexOf(statement)))
  const call: SceneCallStatement = {
    kind: 'call',
    statementId: stableEntityId('stmt', `${owner.moduleId}:${meta.definitionId}:instance`),
    binding: instanceBinding,
    functionName: addImport(owner, moduleSpecifier(owner.file, meta.file), meta.name, meta.name),
    args: Object.fromEntries(meta.inputs.map((port) => {
      const source = owner.statements.find((statement) => statement.statementId === port.sourceStatementId)
      const importedBinding = port.sourceStatementId.startsWith('import:') ? port.sourceStatementId.slice(7) : undefined
      return [port.name, {
        kind: 'reference',
        binding: source?.binding ?? importedBinding ?? port.name,
        ...(port.sourcePort ? { output: port.sourcePort } : {}),
      } as SceneExpression]
    })),
    contractKind: 'group',
    source: { file: owner.file, start: 0, end: 0, line: 1, column: 1 },
  }
  owner.statements = owner.statements.filter((statement) => !selectedSet.has(statement.statementId))
  owner.statements.splice(firstIndex, 0, call)
  for (const statement of owner.statements) {
    if (statement === call) continue
    statement.args = Object.fromEntries(Object.entries(statement.args).map(([name, expression]) => [
      name,
      rewriteExpression(expression, (reference) => {
        const source = sourceByBinding.get(reference.binding)
        if (!source || !selectedSet.has(source.statementId)) return reference
        const contract = registry.get(source.functionName)
        const sourcePort = reference.output ?? contract?.outputs[0]?.name ?? 'value'
        const output = outputByKey.get(`${source.statementId}\0${sourcePort}`)
        return output ? { kind: 'reference', binding: instanceBinding, output: output.name } : reference
      }),
    ]))
  }
  const changedImporters = new Set<string>()
  for (const exported of owner.exports) {
    const source = sourceByBinding.get(exported.local)
    if (!source || !selectedSet.has(source.statementId)) continue
    const contract = registry.get(source.functionName)
    const sourcePort = contract?.outputs[0]?.name ?? 'value'
    const output = outputByKey.get(`${source.statementId}\0${sourcePort}`)
    if (!output) continue
    exported.local = instanceBinding
    const expectedSpecifier = moduleSpecifier('', owner.file).replace(/^\.\//, '')
    for (const importer of Object.values(modules)) {
      if (importer.moduleId === owner.moduleId) continue
      for (const item of importer.imports) {
        const resolvedPath = item.from.replace(/^\.\//, '')
        const relativeOwner = moduleSpecifier(importer.file, owner.file).replace(/^\.\//, '')
        if (resolvedPath !== relativeOwner && resolvedPath !== expectedSpecifier) continue
        for (const specifier of item.specifiers.filter((candidate) => candidate.imported === exported.exported)) {
          changedImporters.add(importer.moduleId)
          for (const consumer of importer.statements) {
            consumer.args = Object.fromEntries(Object.entries(consumer.args).map(([name, expression]) => [
              name,
              rewriteExpression(expression, (reference) => {
                if (reference.binding !== specifier.local) return reference
                const referencedPort = reference.output ?? sourcePort
                const referencedOutput = outputByKey.get(`${source.statementId}\0${referencedPort}`)
                return referencedOutput ? { ...reference, output: referencedOutput.name } : reference
              }),
            ]))
          }
        }
      }
    }
  }
  return { changed: [owner.moduleId, definitionModuleId, ...changedImporters] }
}

function applyMoveStatement(
  modules: Record<string, SceneModuleAst>,
  owner: SceneModuleAst,
  command: Extract<AuthoringCommand, { type: 'moveStatement' }>,
): { changed: string[]; diagnostic?: SceneDiagnostic } {
  const index = owner.statements.findIndex((statement) => statement.statementId === command.statementId)
  const statement = owner.statements[index]
  if (!statement) return { changed: [], diagnostic: commandDiagnostic('SCENE_COMMAND_TARGET_NOT_FOUND', `Authoring entity '${command.statementId}' does not exist.`, 'resolve', command.statementId) }
  const target = (command.targetModuleId ? modules[command.targetModuleId] : undefined)
    ?? (command.targetFile ? Object.values(modules).find((module) => module.file === command.targetFile) : undefined)
    ?? owner
  if (target.moduleId === owner.moduleId) {
    owner.statements.splice(index, 1)
    const after = command.afterStatementId
      ? owner.statements.findIndex((item) => item.statementId === command.afterStatementId)
      : owner.statements.length - 1
    owner.statements.splice(after >= 0 ? after + 1 : 0, 0, statement)
    return { changed: [owner.moduleId] }
  }
  if (statement.binding && target.statements.some((item) => item.binding === statement.binding)) {
    return {
      changed: [],
      diagnostic: commandDiagnostic(
        'SCENE_COMMAND_DUPLICATE_BINDING',
        `Binding '${statement.binding}' already exists in destination module '${target.file}'.`,
        'resolve',
        statement.statementId,
      ),
    }
  }
  const sourceBindings = new Map(owner.statements.flatMap((item) => item.binding ? [[item.binding, item] as const] : []))
  statement.args = Object.fromEntries(Object.entries(statement.args).map(([name, expression]) => [
    name,
    rewriteExpression(expression, (reference) => {
      const source = sourceBindings.get(reference.binding)
      if (!source || source.statementId === statement.statementId) return reference
      addExport(owner, source.binding!)
      const local = addImport(target, moduleSpecifier(target.file, owner.file), source.binding!)
      return { ...reference, binding: local }
    }),
  ]))
  const functionImport = owner.imports
    .flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
    .find(({ specifier }) => specifier.local === statement.functionName)
  if (functionImport) {
    const importedFile = resolveModuleFile(owner.file, functionImport.item.from)
    statement.functionName = addImport(
      target,
      functionImport.item.from.startsWith('.') ? moduleSpecifier(target.file, importedFile) : functionImport.item.from,
      functionImport.specifier.imported,
      statement.functionName,
    )
  }
  if (statement.binding) {
    const remainingConsumers = owner.statements.some((candidate) =>
      candidate.statementId !== statement.statementId
      && Object.values(candidate.args).some((expression) => referencesBinding(expression, statement.binding!)))
    const existingExports = owner.exports.filter((item) => item.local === statement.binding)
    if (remainingConsumers || existingExports.length) {
      addExport(target, statement.binding)
      const imported = addImport(owner, moduleSpecifier(owner.file, target.file), statement.binding)
      for (const candidate of owner.statements) {
        if (candidate.statementId === statement.statementId) continue
        candidate.args = Object.fromEntries(Object.entries(candidate.args).map(([name, expression]) => [
          name,
          rewriteExpression(expression, (reference) =>
            reference.binding === statement.binding ? { ...reference, binding: imported } : reference),
        ]))
      }
      for (const exported of existingExports) exported.local = imported
    }
  }
  owner.statements.splice(index, 1)
  statement.source = { ...statement.source, file: target.file }
  const after = command.afterStatementId
    ? target.statements.findIndex((item) => item.statementId === command.afterStatementId)
    : target.statements.length - 1
  target.statements.splice(after >= 0 ? after + 1 : 0, 0, statement)
  return { changed: [owner.moduleId, target.moduleId] }
}

function findDefinition(
  modules: Record<string, SceneModuleAst>,
  owner: SceneModuleAst,
  functionName: string,
  resolveImport: (fromModuleId: string, specifier: string) => string,
): { module: SceneModuleAst; definition: SceneGroupDefinition } | undefined {
  const local = owner.definitions.find((definition) => definition.exportName === functionName)
  if (local) return { module: owner, definition: local }
  const imported = owner.imports
    .flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
    .find(({ specifier }) => specifier.local === functionName)
  if (!imported) return undefined
  const module = modules[resolveImport(owner.moduleId, imported.item.from)]
  const definition = module?.definitions.find((item) => item.exportName === imported.specifier.imported)
  return module && definition ? { module, definition } : undefined
}

function inlineInstance(
  modules: Record<string, SceneModuleAst>,
  owner: SceneModuleAst,
  instance: SceneCallStatement,
  registry: ContractRegistry,
  actor: ActorKind,
  resolveImport: (fromModuleId: string, specifier: string) => string,
): { changed: string[]; diagnostic?: SceneDiagnostic } {
  const found = findDefinition(modules, owner, instance.functionName, resolveImport)
  if (!found) {
    const external = registry.get(instance.functionName)
    if (external?.kind === 'group' || external?.kind === 'template') {
      return {
        changed: [],
        diagnostic: commandDiagnostic(
          'SCENE_CAPABILITY_SEALED_INTERNAL',
          `Definition internals for '${instance.functionName}' are sealed outside this Scene Project.`,
          'capability',
          instance.statementId,
        ),
      }
    }
    return {
      changed: [],
      diagnostic: commandDiagnostic(
        'SCENE_COMMAND_DEFINITION_NOT_FOUND',
        `Definition for '${instance.functionName}' is unavailable for inline.`,
        'resolve',
        instance.statementId,
      ),
    }
  }
  const contract = registry.get(instance.functionName)
  const sealed = found.definition.meta.sealed !== false
  const canInspect = !sealed || actor === 'template-maintainer' || actor === 'compiler'
    || (contract ? hasGroupCapability(contract, actor, 'inspectDefinition') : actor === 'user')
  if (!canInspect) {
    return {
      changed: [],
      diagnostic: commandDiagnostic(
        'SCENE_CAPABILITY_SEALED_INTERNAL',
        `Actor '${actor}' cannot inline sealed Definition '${instance.functionName}'.`,
        'capability',
        instance.statementId,
      ),
    }
  }
  const definitionUses = Object.values(modules).flatMap((module) =>
    module.statements.filter((statement) => {
      const resolved = findDefinition(modules, module, statement.functionName, resolveImport)
      return resolved?.definition.definitionId === found.definition.definitionId
    }))
  const used = new Set(owner.statements.flatMap((statement) => statement.binding ? [statement.binding] : []))
  const bindingMap = new Map<string, string>()
  for (const inner of found.definition.body) {
    if (!inner.binding) continue
    bindingMap.set(inner.binding, uniqueName(inner.binding, used))
  }
  const argumentByParam = new Map(found.definition.paramNames.map((name) => [name, instance.args[name]]))
  const preserveInternalIds = definitionUses.length === 1
  const expanded = found.definition.body.map((inner) => ({
    ...inner,
    statementId: preserveInternalIds
      ? inner.statementId
      : stableEntityId('stmt', `${instance.statementId}:${inner.statementId}`),
    ...(inner.binding ? { binding: bindingMap.get(inner.binding)! } : {}),
    source: { ...inner.source, file: owner.file },
    args: Object.fromEntries(Object.entries(inner.args).map(([name, expression]) => [
      name,
      rewriteExpression(cloneExpression(expression), (reference) => {
        const argument = argumentByParam.get(reference.binding)
        if (argument) return cloneExpression(argument)
        const binding = bindingMap.get(reference.binding)
        return binding ? { ...reference, binding } : reference
      }),
    ])),
  }))
  for (const inner of expanded) {
    const original = found.definition.body.find((item) =>
      item.statementId === inner.statementId
      || stableEntityId('stmt', `${instance.statementId}:${item.statementId}`) === inner.statementId)
    if (!original) continue
    const imported = found.module.imports
      .flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
      .find(({ specifier }) => specifier.local === original.functionName)
    if (imported) {
      const importedFile = resolveModuleFile(found.module.file, imported.item.from)
      inner.functionName = addImport(
        owner,
        imported.item.from.startsWith('.') ? moduleSpecifier(owner.file, importedFile) : imported.item.from,
        imported.specifier.imported,
        original.functionName,
      )
    }
  }
  if (instance.binding) {
    const outputExpressions = new Map(Object.entries(found.definition.returnOutputs).map(([name, expression]) => [
      name,
      rewriteExpression(cloneExpression(expression), (reference) => {
        const argument = argumentByParam.get(reference.binding)
        if (argument) return cloneExpression(argument)
        const binding = bindingMap.get(reference.binding)
        return binding ? { ...reference, binding } : reference
      }),
    ]))
    for (const statement of owner.statements) {
      if (statement === instance) continue
      statement.args = Object.fromEntries(Object.entries(statement.args).map(([name, expression]) => [
        name,
        rewriteExpression(expression, (reference) => {
          if (reference.binding !== instance.binding) return reference
          const outputName = reference.output ?? Object.keys(found.definition.meta.outputs)[0]
          return outputExpressions.get(outputName) ?? reference
        }),
      ]))
    }
    for (const exported of owner.exports.filter((item) => item.local === instance.binding)) {
      const first = outputExpressions.values().next().value as SceneExpression | undefined
      if (first?.kind === 'reference') exported.local = first.binding
    }
  }
  const index = owner.statements.indexOf(instance)
  owner.statements.splice(index, 1, ...expanded)
  return { changed: [owner.moduleId] }
}

/** Route one atomic command list across project modules, including imported value connections. */
export function applyProjectAuthoringCommands(
  input: SceneProjectAst,
  commands: readonly AuthoringCommand[],
  options: {
    actor: ActorKind
    registry: ContractRegistry
    resolveImport?: (fromModuleId: string, specifier: string) => string
  },
): ApplyProjectAuthoringCommandsResult {
  const modules = Object.fromEntries(Object.entries(input.modules).map(([id, module]) => [id, cloneModule(module)]))
  const diagnostics: SceneDiagnostic[] = []
  const confirmations: SceneAuthoringConfirmation[] = []
  const changed = new Set<string>()
  let applied = 0
  const resolveImport = options.resolveImport ?? ((_from: string, specifier: string) => specifier)

  for (const [commandIndex, command] of commands.entries()) {
    const statementId = 'statementId' in command ? command.statementId : undefined
    const owner = (command.moduleId ? modules[command.moduleId] : undefined)
      ?? (command.file ? Object.values(modules).find((module) => module.file === command.file) : undefined)
      ?? (statementId
        ? Object.values(modules).find((module) => module.statements.some((item) => item.statementId === statementId))
        : modules[input.entryModuleId])
    if (!owner) {
      diagnostics.push(commandDiagnostic(
        'SCENE_COMMAND_MODULE_NOT_FOUND',
        `No owning Scene Script module was found for '${statementId ?? ''}'.`,
        'resolve',
        statementId,
      ))
      continue
    }

    if (command.type === 'moveStatement') {
      const result = applyMoveStatement(modules, owner, command)
      if (result.diagnostic) diagnostics.push(result.diagnostic)
      else {
        result.changed.forEach((moduleId) => changed.add(moduleId))
        applied += 1
      }
      continue
    }

    if (command.type === 'extractDefinition' || command.type === 'wrapInGroup') {
      const result = applyExtractDefinition(modules, owner, command, options.registry)
      if (result.diagnostic) diagnostics.push(result.diagnostic)
      if (result.confirmation) confirmations.push({ ...result.confirmation, commandIndex })
      if (!result.diagnostic && !result.confirmation) {
        result.changed.forEach((moduleId) => changed.add(moduleId))
        applied += 1
      }
      continue
    }

    if (command.type === 'inlineDefinition' || command.type === 'ungroup') {
      const target = owner.statements.find((statement) => statement.statementId === command.statementId)
      if (!target) {
        diagnostics.push(commandDiagnostic(
          'SCENE_COMMAND_TARGET_NOT_FOUND',
          `Authoring entity '${command.statementId}' does not exist.`,
          'resolve',
          command.statementId,
        ))
        continue
      }
      const found = findDefinition(modules, owner, target.functionName, resolveImport)
      const instances = command.strategy === 'shared-definition' && found
        ? Object.values(modules).flatMap((module) => module.statements.flatMap((statement) => {
            const candidate = findDefinition(modules, module, statement.functionName, resolveImport)
            return candidate?.definition.definitionId === found.definition.definitionId ? [{ module, statement }] : []
          }))
        : [{ module: owner, statement: target }]
      let successful = true
      for (const candidate of instances) {
        const result = inlineInstance(
          modules,
          candidate.module,
          candidate.statement,
          options.registry,
          options.actor,
          resolveImport,
        )
        if (result.diagnostic) {
          diagnostics.push(result.diagnostic)
          successful = false
          break
        }
        result.changed.forEach((moduleId) => changed.add(moduleId))
      }
      if (successful) applied += 1
      continue
    }

    let commandInput = owner
    let syntheticStatementId: string | undefined
    if ((command.type === 'connectValue' || command.type === 'disconnectValue' || command.type === 'setCapturedOutput')
      && command.sourceStatementId) {
      const localSource = owner.statements.find((item) => item.statementId === command.sourceStatementId)
      if (!localSource) {
        const sourceModule = Object.values(modules).find((module) =>
          module.statements.some((item) => item.statementId === command.sourceStatementId))
        const source = sourceModule?.statements.find((item) => item.statementId === command.sourceStatementId)
        const exported = source?.binding
          ? sourceModule?.exports.find((item) => item.local === source.binding)
          : undefined
        const imported = sourceModule && exported
          ? owner.imports.flatMap((item) => item.specifiers.map((specifier) => ({ item, specifier })))
            .find(({ item, specifier }) =>
              resolveImport(owner.moduleId, item.from) === sourceModule.moduleId
              && specifier.imported === exported.exported)
          : undefined
        if (source && imported) {
          syntheticStatementId = source.statementId
          commandInput = {
            ...owner,
            statements: [
              ...owner.statements,
              { ...source, binding: imported.specifier.local, source: { ...source.source, file: owner.file } },
            ],
          }
        }
      }
    }
    const result = applyAuthoringCommands(commandInput, [command], options)
    const module = syntheticStatementId
      ? { ...result.module, statements: result.module.statements.filter((item) => item.statementId !== syntheticStatementId) }
      : result.module
    diagnostics.push(...result.diagnostics)
    if (result.applied) {
      modules[owner.moduleId] = module
      changed.add(owner.moduleId)
      applied += result.applied
    }
  }
  if (!diagnostics.some((item) => item.severity === 'error') && confirmations.length === 0) {
    for (const moduleId of changed) diagnostics.push(...verifyCanonicalRoundTrip(modules[moduleId], options.registry))
  }
  const rejected = diagnostics.some((item) => item.severity === 'error') || confirmations.length > 0
  return {
    project: rejected ? input : { ...input, modules },
    diagnostics,
    applied: rejected ? 0 : applied,
    changedModuleIds: rejected ? [] : [...changed],
    confirmations,
  }
}

/** Minimal executable Fix path: reference rewrites reuse the canonical command transaction. */
export function applySceneDiagnosticFix(
  input: SceneModuleAst,
  fix: SceneDiagnosticFix,
  options: { actor: ActorKind; registry: ContractRegistry },
): ApplyAuthoringCommandsResult {
  const commands: AuthoringCommand[] = []
  for (const edit of fix.edits) {
    if (edit.type === 'ReplaceReference') {
      commands.push({
        type: 'connectValue',
        statementId: edit.statementId,
        input: edit.argument,
        sourceStatementId: edit.sourceStatementId,
        ...(edit.sourceOutput ? { output: edit.sourceOutput } : {}),
      })
      continue
    }
    return {
      module: input,
      applied: 0,
      diagnostics: [commandDiagnostic(
        'SCENE_FIX_SOURCE_EDIT_UNSUPPORTED',
        `Fix '${fix.fixId}' requires a source text edit; apply it through the source revision route.`,
        'capability',
      )],
    }
  }
  return applyAuthoringCommands(input, commands, options)
}
