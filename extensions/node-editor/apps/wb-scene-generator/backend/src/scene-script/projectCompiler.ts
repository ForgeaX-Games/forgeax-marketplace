import { posix } from 'node:path'

import {
  compileSceneProject,
  compileSceneGroupDefinition,
  createSceneDiagnostic,
  parseSceneModule,
  stableHash,
  type CompiledSceneModule,
  type ContractRegistry,
  type ParseSceneModuleResult,
  type SceneDiagnostic,
  type SceneGroupDefinition,
  type SceneIncrementalCompileInfo,
  type SceneModuleAst,
} from '@forgeax/scene-authoring'

import { readSceneModule } from './store.js'

interface ProjectCompilerCache {
  parsedByFile: Map<string, { revision: string; result: ParseSceneModuleResult }>
  semanticHashes: Record<string, string>
}

const compilerCaches = new Map<string, ProjectCompilerCache>()

export function resolveSceneImport(fromModuleId: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  return posix.normalize(posix.join(posix.dirname(fromModuleId), specifier))
}

export async function compileStoredSceneProject(
  projectDir: string,
  options: {
    entryFile: string
    entrySource: string
    sourceOverrides?: Record<string, string>
    projectId: string
    registry: ContractRegistry
  },
): Promise<{
  compiled: CompiledSceneModule
  diagnostics: SceneDiagnostic[]
  modules: Record<string, SceneModuleAst>
  registry: ContractRegistry
  incremental: SceneIncrementalCompileInfo
}> {
  const modules: Record<string, SceneModuleAst> = {}
  const diagnostics: SceneDiagnostic[] = []
  const visitingFiles = new Set<string>()
  const loadedFiles = new Set<string>()
  const fileToModuleId = new Map<string, string>()
  const sourceByFile = new Map<string, string>()
  const reparsedModuleIds: string[] = []
  const cache: ProjectCompilerCache = compilerCaches.get(projectDir) ?? {
    parsedByFile: new Map(),
    semanticHashes: {},
  }
  compilerCaches.set(projectDir, cache)

  const visit = async (file: string, sourceOverride?: string): Promise<void> => {
    if (loadedFiles.has(file) || visitingFiles.has(file)) return
    visitingFiles.add(file)
    const override = sourceOverride ?? options.sourceOverrides?.[file]
    const stored = override === undefined ? await readSceneModule(projectDir, file) : undefined
    if (stored && !stored.exists) {
      visitingFiles.delete(file)
      return
    }
    const source = override ?? stored?.source ?? ''
    sourceByFile.set(file, source)
    const revision = stableHash(source)
    const cached = cache.parsedByFile.get(file)
    const parsed = cached?.revision === revision
      ? cached.result
      : parseSceneModule(source, { file, registry: options.registry })
    if (!cached || cached.revision !== revision) {
      cache.parsedByFile.set(file, { revision, result: parsed })
      reparsedModuleIds.push(parsed.module.moduleId)
    }
    const existing = modules[parsed.module.moduleId]
    if (existing && existing.file !== file) {
      diagnostics.push(createSceneDiagnostic({
        code: 'SCENE_RESOLVE_MODULE_ID',
        phase: 'resolve',
        severity: 'error',
        message: `Scene module id '${parsed.module.moduleId}' is declared by both '${existing.file}' and '${file}'.`,
        source: parsed.module.statements[0]?.source ?? parsed.module.definitions[0]?.source,
        expected: 'A unique stable @scene-module-id per module.',
        actual: parsed.module.moduleId,
      }))
      visitingFiles.delete(file)
      return
    }
    modules[parsed.module.moduleId] = parsed.module
    fileToModuleId.set(file, parsed.module.moduleId)
    loadedFiles.add(file)
    diagnostics.push(...parsed.diagnostics)
    for (const item of parsed.module.imports) {
      if (!item.from.startsWith('.')) continue
      const dependency = resolveSceneImport(file, item.from)
      if (!dependency.endsWith('.scene.ts')) {
        diagnostics.push(createSceneDiagnostic({
          code: 'SCENE_RESOLVE_IMPORT_EXTENSION',
          phase: 'resolve',
          severity: 'error',
          message: `Scene module import '${item.from}' must resolve to a .scene.ts file.`,
          source: item.source,
          expected: '.scene.ts',
          actual: item.from,
        }))
        continue
      }
      await visit(dependency)
    }
    visitingFiles.delete(file)
  }

  await visit(options.entryFile, options.entrySource)
  // Definitions are compiled before entry instances. This is intentionally a
  // separate pass: an imported .scene.ts declares reusable sealed contracts,
  // never scene nodes that should be flattened into the entry graph.
  const localContracts = new Map<string, import('@forgeax/scene-authoring').NodeFunctionContract>()
  const definitionRegistry: ContractRegistry = {
    get(functionName) {
      return localContracts.get(functionName) ?? options.registry.get(functionName)
    },
    list() {
      const base = options.registry.list()
      return [...base, ...localContracts.values()]
    },
  }

  const resolveModuleImport = (fromModuleId: string, specifier: string): string => {
    const from = modules[fromModuleId]?.file ?? fromModuleId
    const targetFile = resolveSceneImport(from, specifier)
    return fileToModuleId.get(targetFile) ?? targetFile
  }
  const definitionForExport = (
    moduleId: string,
    exportedName: string,
    resolving = new Set<string>(),
  ): { moduleId: string; definition: SceneGroupDefinition } | undefined => {
    const key = `${moduleId}::${exportedName}`
    if (resolving.has(key)) return undefined
    const module = modules[moduleId]
    const exported = module?.exports.find((item) => item.exported === exportedName)
    if (!module || !exported) return undefined
    const definition = module.definitions.find((item) => item.exportName === exported.local)
    if (definition) return { moduleId, definition }
    for (const item of module.imports) {
      const specifier = (item.specifiers ?? []).find((candidate) => candidate.local === exported.local)
      if (!specifier) continue
      return definitionForExport(
        resolveModuleImport(moduleId, item.from),
        specifier.imported,
        new Set(resolving).add(key),
      )
    }
    return undefined
  }
  const scopedRegistry = (module: SceneModuleAst): ContractRegistry => ({
    get(functionName) {
      const local = module.definitions.find((item) => item.exportName === functionName)
      if (local) return localContracts.get(`${module.moduleId}::${functionName}`)
      for (const item of module.imports) {
        const specifier = (item.specifiers ?? []).find((candidate) => candidate.local === functionName)
        if (!specifier) continue
        const target = definitionForExport(resolveModuleImport(module.moduleId, item.from), specifier.imported)
        if (target) return localContracts.get(`${target.moduleId}::${target.definition.exportName}`)
      }
      return definitionRegistry.get(functionName)
    },
    list: () => definitionRegistry.list(),
  })
  const pending = Object.values(modules).flatMap((module) =>
    module.definitions.map((definition) => ({ module, definition })),
  )
  while (pending.length) {
    let progressed = false
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const { module, definition } = pending[index]
      const result = compileSceneGroupDefinition(definition, scopedRegistry(module))
      const unresolved = result.diagnostics.some((item) => item.code === 'SCENE_DEFINE_CONTRACT')
      if (unresolved && pending.length > 1) continue
      for (const item of result.diagnostics) {
        diagnostics.push(createSceneDiagnostic({
          code: item.code,
          phase: 'compile',
          severity: 'error',
          message: item.message,
          source: definition.source,
        }))
      }
      pending.splice(index, 1)
      progressed = true
      if (!result.contract) continue
      const existingPlatform = options.registry.get(result.contract.functionName)
      if (existingPlatform) {
        const existingId = existingPlatform.definitionId
        diagnostics.push(createSceneDiagnostic({
          code: 'SCENE_DEFINE_CONFLICT',
          phase: 'resolve',
          severity: 'error',
          message: `Project definition '${result.contract.functionName}' conflicts with sealed platform Definition '${existingId ?? 'unknown'}'. Rename the project Definition; platform Definitions cannot be shadowed.`,
          source: definition.source,
          expected: 'A unique project Definition name that does not shadow sealed platform capabilities.',
          actual: result.contract.functionName,
        }))
        continue
      }
      localContracts.set(`${module.moduleId}::${result.contract.functionName}`, result.contract)
    }
    if (!progressed) break
  }
  const compiled = compileSceneProject(
    { entryModuleId: fileToModuleId.get(options.entryFile) ?? options.entryFile, modules },
    definitionRegistry,
    resolveModuleImport,
  )
  // Parsing happens before imported project-local Definitions are registered.
  // Once the second pass has resolved them, discard only that provisional
  // unknown-function diagnostic; all other parse diagnostics remain fatal.
  const resolvedDiagnostics = diagnostics.filter(
    (item) => !(item.code === 'SCENE_RESOLVE_FUNCTION' && item.operation),
  )
  const dependenciesByModule: Record<string, string[]> = {}
  const dependentsByModule: Record<string, string[]> = {}
  for (const module of Object.values(modules)) {
    dependenciesByModule[module.moduleId] = module.imports
      .filter((item) => item.from.startsWith('.'))
      .map((item) => resolveModuleImport(module.moduleId, item.from))
      .filter((id) => Boolean(modules[id]))
    dependentsByModule[module.moduleId] ??= []
  }
  for (const [moduleId, dependencies] of Object.entries(dependenciesByModule)) {
    for (const dependency of dependencies) (dependentsByModule[dependency] ??= []).push(moduleId)
  }
  const semanticHashes = Object.fromEntries(Object.values(modules).map((module) => [
    module.moduleId,
    stableHash(sourceByFile.get(module.file) ?? ''),
  ]))
  const changed = new Set(Object.keys(semanticHashes).filter(
    (moduleId) => cache.semanticHashes[moduleId] !== semanticHashes[moduleId],
  ))
  const invalidated = new Set(changed)
  const queue = [...changed]
  while (queue.length) {
    const moduleId = queue.shift()!
    for (const dependent of dependentsByModule[moduleId] ?? []) {
      if (!invalidated.has(dependent)) {
        invalidated.add(dependent)
        queue.push(dependent)
      }
    }
  }
  const incrementalModules = Object.fromEntries(Object.values(modules).map((module) => {
    const publicShape = {
      exports: module.exports.map(({ local, exported }) => ({ local, exported })),
      definitions: module.definitions.map((definition) => ({
        exportName: definition.exportName,
        definitionId: definition.definitionId,
        version: definition.meta.version,
        inputs: definition.meta.inputs,
        outputs: definition.meta.outputs,
      })),
    }
    return [module.moduleId, {
      moduleId: module.moduleId,
      file: module.file,
      dependencies: dependenciesByModule[module.moduleId] ?? [],
      dependents: dependentsByModule[module.moduleId] ?? [],
      publicSignatureHash: stableHash(JSON.stringify(publicShape)),
      semanticHash: semanticHashes[module.moduleId],
    }]
  }))
  cache.semanticHashes = semanticHashes
  const incremental: SceneIncrementalCompileInfo = {
    modules: incrementalModules,
    reparsedModuleIds,
    invalidatedModuleIds: [...invalidated].sort(),
  }
  return {
    compiled,
    diagnostics: [...resolvedDiagnostics, ...compiled.diagnostics],
    modules,
    registry: definitionRegistry,
    incremental,
  }
}
