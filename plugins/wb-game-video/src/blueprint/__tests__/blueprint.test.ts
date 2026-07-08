import { describe, expect, test } from 'vitest'
import {
  BLUEPRINT_HUD_MODES,
  GAME_VIDEO_BLUEPRINT_SCHEMA_VERSION,
} from '../blueprint-schema'
import { scenarioToBlueprint } from '../scenarioToBlueprint'
import { toFXGraph } from '../blueprint-reactflow'
import { makeDemoScenario, makeSubflowScenario } from './fixtures'

describe('scenarioToBlueprint', () => {
  test('compiles a renderer-agnostic BPMN graph (no position/data on nodes)', () => {
    const graph = scenarioToBlueprint(makeDemoScenario())
    expect(graph.schemaVersion).toBe(GAME_VIDEO_BLUEPRINT_SCHEMA_VERSION)
    expect(graph.nodes.length).toBe(6)

    const start = graph.nodes.find((n) => n.id === 'start')
    expect(start?.elementType).toBe('start')
    expect('position' in (start ?? {})).toBe(false)
    expect('data' in (start ?? {})).toBe(false)

    const choose = graph.nodes.find((n) => n.id === 'choose')
    expect(choose?.elementType).toBe('userTask')
    const boss = graph.nodes.find((n) => n.id === 'boss')
    expect(boss?.elementType).toBe('serviceTask')
    const goodEnd = graph.nodes.find((n) => n.id === 'goodEnd')
    expect(goodEnd?.elementType).toBe('end')
  })

  test('keeps gameplay in extensionElements (Loop / 转场 / QTE / Boss / options)', () => {
    const graph = scenarioToBlueprint(makeDemoScenario())
    const start = graph.nodes.find((n) => n.id === 'start')
    expect(start?.extensionElements.mediaPlayMode).toBe('loop')
    expect(start?.extensionElements.transition?.kind).toBe('crossfade')

    const choose = graph.nodes.find((n) => n.id === 'choose')
    expect(choose?.extensionElements.options?.map((o) => o.key)).toEqual(['opt-qte', 'opt-rush'])

    const qte = graph.nodes.find((n) => n.id === 'qte')
    expect(qte?.extensionElements.qte?.cueMs).toEqual([800, 1600])

    const boss = graph.nodes.find((n) => n.id === 'boss')
    expect(boss?.extensionElements.boss?.rounds.length).toBe(2)
    expect(boss?.extensionElements.boss?.winTarget).toBe('goodEnd')
  })

  test('every node hud is a valid blueprint hud mode', () => {
    const graph = scenarioToBlueprint(makeDemoScenario())
    expect(graph.nodes.every((n) => BLUEPRINT_HUD_MODES.includes(n.extensionElements.hud))).toBe(true)
  })

  test('flow references are internally consistent (incoming/outgoing ↔ edges)', () => {
    const graph = scenarioToBlueprint(makeDemoScenario())
    const ids = new Set(graph.nodes.map((n) => n.id))
    expect(graph.edges.every((e) => ids.has(e.sourceRef) && ids.has(e.targetRef))).toBe(true)

    const choose = graph.nodes.find((n) => n.id === 'choose')
    const outIds = choose?.outgoing ?? []
    for (const fid of outIds) {
      expect(graph.edges.some((e) => e.id === fid && e.sourceRef === 'choose')).toBe(true)
    }
    const boss = graph.nodes.find((n) => n.id === 'boss')
    expect(boss?.incoming.length).toBeGreaterThan(0)
  })

  test('derives readable conditionExpression on qte edges', () => {
    const graph = scenarioToBlueprint(makeDemoScenario())
    const pass = graph.edges.find((e) => e.sourceRef === 'qte' && e.targetRef === 'boss')
    expect(pass?.conditionExpression).toBe('qte.passed')
    expect(pass?.extension?.kind).toBe('qte_pass')
  })

  test('drops unfinished hotspots without target or detour from runtime blueprint', () => {
    const scenario = makeDemoScenario()
    scenario.scenes.start!.hotspots = [
      { id: 'hs-empty', x: 0.5, y: 0.5, mode: 'return' },
      { id: 'hs-detour', x: 0.4, y: 0.4, detour: { dialogue: ['看一眼'] } },
    ]

    const graph = scenarioToBlueprint(scenario)
    const start = graph.nodes.find((n) => n.id === 'start')
    expect(start?.extensionElements.hotspots?.map((h) => h.id)).toEqual(['hs-detour'])
  })

  test('compiles nested subflow graphs without flattening child nodes into the parent view', () => {
    const graph = scenarioToBlueprint(makeSubflowScenario())

    expect(graph.nodes.map((n) => n.id)).toEqual(['start', 'container', 'after'])
    expect(graph.nodes.some((n) => n.id === 'innerStart')).toBe(false)
    expect(graph.subflows?.['g-inner']?.rootNodeId).toBe('innerStart')
    expect(graph.subflows?.['g-inner']?.nodes.map((n) => n.id)).toEqual(['innerStart', 'innerEnd'])

    const container = graph.nodes.find((n) => n.id === 'container')
    expect(container?.elementType).toBe('subflow')
    expect(container?.extensionElements.subFlowRef).toBe('g-inner')
  })
})

describe('blueprint → reactflow', () => {
  test('derives handles from incoming/outgoing and aligns by flow id', () => {
    const graph = scenarioToBlueprint(makeDemoScenario())
    const fx = toFXGraph(graph)

    const start = fx.nodes.find((n) => n.id === 'start')
    const goodEnd = fx.nodes.find((n) => n.id === 'goodEnd')
    expect(start?.type).toBe('input')
    expect(goodEnd?.type).toBe('output')

    const edge = fx.edges[0]
    expect(edge?.sourceHandle).toBe(`source:${edge?.id}`)
    expect(edge?.targetHandle).toBe(`target:${edge?.id}`)

    const choose = fx.nodes.find((n) => n.id === 'choose')
    expect(choose?.outputs.map((o) => o.data?.flowId).every((id) => typeof id === 'string')).toBe(true)
  })
})
