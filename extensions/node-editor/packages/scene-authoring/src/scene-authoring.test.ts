import { describe, expect, it } from 'vitest'

import {
  applyAuthoringCommands,
  applySceneDiagnosticFix,
  compileSceneModule,
  compileSceneGroupDefinition,
  compileSceneProject,
  hasGroupCapability,
  parseSceneModule,
  printSceneModule,
  SceneContractRegistry,
} from './index.js'
import type { NodeFunctionContract, RawTemplateGroup } from './index.js'

const template: RawTemplateGroup = {
  id: 'template_root',
  name: 'Settlement',
  nodes: [
    { id: 'inner_a', opId: 'scene_passthrough', params: {}, position: { x: 0, y: 0 } },
  ],
  edges: [],
  exposedInputs: [
    {
      portName: 'in_0',
      portType: 'scene',
      sourceNodeId: 'inner_a',
      sourcePortName: 'scene',
    },
  ],
  exposedOutputs: [
    {
      portName: 'out_0',
      portType: 'scene',
      sourceNodeId: 'inner_a',
      sourcePortName: 'scene',
    },
  ],
}

const contracts: NodeFunctionContract[] = [
  {
    functionName: 'scenePassthrough',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'scene_passthrough',
    description: 'Internal primitive.',
    agentVisible: false,
    definitionScope: 'group-body',
    inputs: [{ name: 'scene', type: 'scene' }],
    outputs: [{ name: 'scene', type: 'scene' }],
  },
  {
    functionName: 'numberValue',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'number_const',
    description: 'Create a number.',
    inputs: [{ name: 'value', type: 'number', mode: 'parameter' }],
    outputs: [{ name: 'value', type: 'number' }],
  },
  {
    functionName: 'manualPoints',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'manual_points',
    description: 'Create one point.',
    inputs: [],
    outputs: [{ name: 'points', type: 'point2d', runtimePort: 'point' }],
  },
  {
    functionName: 'placeBuilding',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'place_one_seed_on_point',
    description: 'Place a building.',
    inputs: [{ name: 'points', type: 'point2d', required: true, runtimePort: 'points' }],
    outputs: [{ name: 'scene', type: 'scene' }],
  },
  {
    functionName: 'settlement',
    kind: 'template',
    contractVersion: '1',
    definitionId: 'settlement',
    definitionVersion: '1',
    definition: template,
    description: 'Build a sealed settlement.',
    inputs: [{ name: 'base', type: 'scene', required: true, runtimePort: 'in_0' }],
    outputs: [{ name: 'scene', type: 'scene', runtimePort: 'out_0' }],
  },
  {
    functionName: 'sceneOutput',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'scene_output',
    description: 'Capture the final scene.',
    inputs: [{ name: 'scene', type: 'scene', required: true }],
    outputs: [],
  },
]

function registry(): SceneContractRegistry {
  return new SceneContractRegistry(contracts)
}

describe('Scene Script', () => {
  it('parses, prints, and lowers a restricted native group definition', () => {
    const source = `export const Wrapper = defineGroup(
  {
    id: "wrapper",
    version: "1.0.0",
    inputs: { value: { type: NumberValue, runtimePort: "in_2", access: "item", required: true, mode: "parameter", label: "Value", order: 2, defaultValue: 3 } },
    outputs: { value: { type: NumberValue, runtimePort: "out_1", access: "item", hidden: true, label: "Result", order: 1 } },
  },
  ({ value }) => {
    const inner = numberValue({ value })
    return { value: inner.value }
  },
)`
    const parsed = parseSceneModule(source, { file: 'groups/wrapper.scene.ts', registry: registry() })
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.module.definitions).toHaveLength(1)
    const printed = printSceneModule(parsed.module)
    const reparsed = parseSceneModule(printed, { file: 'groups/wrapper.scene.ts', registry: registry() })
    expect(reparsed.diagnostics).toEqual([])
    expect(reparsed.module.definitions[0].meta).toEqual(parsed.module.definitions[0].meta)
    const result = compileSceneGroupDefinition(parsed.module.definitions[0], registry())
    expect(result.diagnostics).toEqual([])
    expect(result.contract?.definition?.exposedInputs?.[0]).toEqual(expect.objectContaining({
      portName: 'in_2',
      order: 2,
      customLabel: 'Value',
    }))
    expect(result.contract?.definition?.exposedOutputs?.[0]).toEqual(expect.objectContaining({
      portName: 'out_1',
      hidden: true,
      order: 1,
      customLabel: 'Result',
    }))
  })

  it('rejects raw graph payloads in Definitions', () => {
    const source = `export const generated = defineGroup({
  id: "native.generated",
  version: "1.0.0",
  inputs: { root: { type: Scene, runtimeType: "scene", runtimePort: "in_0", access: "tree", order: 2, labelEn: "Root" } },
  outputs: { result: { type: Any, runtimeType: "custom", runtimePort: "out_0", hidden: true } },
  rawDefinition: ${JSON.stringify(template)},
})`
    const parsed = parseSceneModule(source, { file: 'generated.scene.ts', registry: registry() })
    expect(parsed.module.definitions).toEqual([])
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ code: 'SCENE_DEFINE_RAW_FORBIDDEN' }),
    ])
  })

  it('rejects compiler-only primitives at scene top level', () => {
    const parsed = parseSceneModule('const result = scenePassthrough({ scene: root.scene })', {
      file: 'main.scene.ts',
      registry: registry(),
    })
    const compiled = compileSceneModule(parsed.module, registry())
    expect(compiled.diagnostics.some((item) => item.code === 'SCENE_COMPILE_DEFINITION_SCOPE')).toBe(true)
  })
  it('parses and canonically prints stable statement anchors', () => {
    const parsed = parseSceneModule(
      `const points = manualPoints({ x: 1, y: 2 })\nconst placed = placeBuilding({ points })\nsceneOutput({ scene: placed })\n`,
      { file: 'main.scene.ts', registry: registry() },
    )
    expect(parsed.diagnostics).toEqual([])
    const printed = printSceneModule(parsed.module)
    expect(printed).toContain('@scene-id')
    const reparsed = parseSceneModule(printed, { file: 'main.scene.ts', registry: registry() })
    expect(reparsed.module.statements.map((item) => item.statementId)).toEqual(
      parsed.module.statements.map((item) => item.statementId),
    )
  })

  it('compiles typed value lineage into stable nodes and edges', () => {
    const parsed = parseSceneModule(
      `const points = manualPoints({ x: 1, y: 2 })\nconst placed = placeBuilding({ points })\nconst town = settlement({ base: placed })\nsceneOutput({ scene: town })\n`,
      { file: 'main.scene.ts', registry: registry() },
    )
    const compiled = compileSceneModule(parsed.module, registry())
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.entityIds).toHaveLength(4)
    expect(compiled.resultEntityIds).toHaveLength(1)
    expect(compiled.ops.filter((op) => op.type === 'createGroup')).toHaveLength(1)
    expect(compiled.ops.filter((op) => op.type === 'connect')).toHaveLength(3)
    expect(compileSceneModule(parsed.module, registry()).ops).toEqual(compiled.ops)
  })

  it('seals template internals from agents', () => {
    const contract = registry().get('settlement')!
    expect(hasGroupCapability(contract, 'agent', 'configure')).toBe(true)
    expect(hasGroupCapability(contract, 'agent', 'editInstanceOverride')).toBe(false)
    expect(hasGroupCapability(contract, 'user', 'editInstanceOverride')).toBe(true)
  })

  it('applies scoped authoring commands but rejects agent access to sealed internals', () => {
    const parsed = parseSceneModule(
      `const root = placeBuilding({ points: missing })\nconst town = settlement({ base: root })\n`,
      { file: 'main.scene.ts', registry: registry() },
    )
    const town = parsed.module.statements[1]!
    const edited = applyAuthoringCommands(
      parsed.module,
      [
        {
          type: 'updateArguments',
          statementId: town.statementId,
          set: { label: { kind: 'literal', value: 'Harbor' } },
        },
        {
          type: 'editSealedInternal',
          statementId: town.statementId,
          runtimeNodeId: 'inner_a',
          patch: { params: { seed: 2 } },
        },
      ],
      { actor: 'agent', registry: registry() },
    )
    expect(edited.applied).toBe(1)
    expect(edited.module.statements[1]?.args.label).toEqual({ kind: 'literal', value: 'Harbor' })
    expect(edited.diagnostics[0]?.code).toBe('SCENE_CAPABILITY_SEALED_INTERNAL')
  })

  it('compiles recursively imported modules as one complete authoring graph', () => {
    const points = parseSceneModule(`export const points = manualPoints({ x: 4, y: 8 })\n`, {
      file: 'parts/points.scene.ts',
      moduleId: 'parts/points.scene.ts',
      registry: registry(),
    }).module
    const main = parseSceneModule(
      `import { points } from "./parts/points.scene.ts"\nconst placed = placeBuilding({ points })\nsceneOutput({ scene: placed })\n`,
      { file: 'main.scene.ts', moduleId: 'main.scene.ts', registry: registry() },
    ).module
    const compiled = compileSceneProject(
      {
        entryModuleId: 'main.scene.ts',
        modules: { 'main.scene.ts': main, 'parts/points.scene.ts': points },
      },
      registry(),
      (_from, specifier) => specifier.replace(/^\.\//, ''),
    )
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.entityIds).toHaveLength(3)
    expect(compiled.ops.filter((op) => op.type === 'connect')).toHaveLength(2)
  })

  it('writes back multiple list connections and disconnects one reference without data loss', () => {
    const parsed = parseSceneModule(
      `const first = manualPoints({ x: 1, y: 2 })
const second = manualPoints({ x: 3, y: 4 })
const placed = placeBuilding({})
`,
      { file: 'main.scene.ts', registry: registry() },
    )
    const first = parsed.module.statements[0]!
    const second = parsed.module.statements[1]!
    const placed = parsed.module.statements[2]!
    const connected = applyAuthoringCommands(parsed.module, [
      { type: 'connectValue', statementId: placed.statementId, input: 'points', sourceStatementId: first.statementId, append: true },
      { type: 'connectValue', statementId: placed.statementId, input: 'points', sourceStatementId: second.statementId, append: true },
    ], { actor: 'user', registry: registry() })
    expect(connected.module.statements[2]?.args.points).toMatchObject({
      kind: 'array',
      items: [{ binding: 'first' }, { binding: 'second' }],
    })
    const disconnected = applyAuthoringCommands(connected.module, [
      { type: 'disconnectValue', statementId: placed.statementId, input: 'points', sourceStatementId: first.statementId },
    ], { actor: 'user', registry: registry() })
    expect(disconnected.module.statements[2]?.args.points).toMatchObject({
      kind: 'array',
      items: [{ binding: 'second' }],
    })
  })

  it('applies a structured ReplaceReference fix through canonical commands', () => {
    const parsed = parseSceneModule(
      `const first = manualPoints({})\nconst second = manualPoints({})\nconst placed = placeBuilding({ points: first })\n`,
      { file: 'main.scene.ts', registry: registry() },
    )
    const fixed = applySceneDiagnosticFix(parsed.module, {
      fixId: 'use-second',
      title: 'Use second points',
      edits: [{
        type: 'ReplaceReference',
        statementId: parsed.module.statements[2].statementId,
        argument: 'points',
        sourceStatementId: parsed.module.statements[1].statementId,
      }],
    }, { actor: 'agent', registry: registry() })
    expect(fixed.diagnostics).toEqual([])
    expect(fixed.applied).toBe(1)
    expect(fixed.module.statements[2].args.points).toEqual({ kind: 'reference', binding: 'second' })
  })
})
