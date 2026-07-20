import { describe, expect, it } from 'vitest'
import { registerCoreComponents } from '../registry/core-components'
import { getComponentManifest } from '../registry/component-registry'
import type { Overlay, Reaction } from '../schema/node-config-schema'
import {
  aggregateOverlayEvents,
  aggregateNodeOverlayEvents,
  resolveEventReactionDo,
} from '../schema/overlay-events'
import { GraphRuntime } from '../engine/engine'
import { scnOf, node, rid } from './test-fixtures'
import type { GameGraph } from '../schema/graph-schema'

registerCoreComponents()

describe('overlay events / reactions', () => {
  const overlay: Overlay = {
    id: 'battleHud',
    children: [
      { id: 'hp', component: 'battleHpBar', inputs: { bind: 'ent-player' } },
      {
        id: 'parry',
        component: 'battleParry',
        inputs: {
          events: [
            { id: 'A', label: '防反' },
            { id: 'B', label: '闪避' },
            { id: 'miss', label: '失手' },
          ],
        },
      },
    ],
  }

  it('aggregates events from inputs.events when single emitter', () => {
    const refs = aggregateOverlayEvents(overlay, getComponentManifest)
    expect(refs.map((r) => r.eventId)).toEqual(['A', 'B', 'miss'])
    expect(refs[0]?.componentId).toBe('battleParry')
  })

  it('namespaces when multiple emitters', () => {
    const multi: Overlay = {
      id: 'm',
      children: [
        {
          id: 'q1',
          component: 'qte',
          inputs: { events: [{ id: 'pass' }, { id: 'fail' }] },
        },
        {
          id: 'q2',
          component: 'qte',
          inputs: { events: [{ id: 'pass' }, { id: 'fail' }] },
        },
      ],
    }
    const refs = aggregateOverlayEvents(multi, getComponentManifest)
    expect(refs.map((r) => r.eventId)).toEqual(['q1:pass', 'q1:fail', 'q2:pass', 'q2:fail'])
  })

  it('resolveEventReactionDo matches bare and namespaced keys', () => {
    const actions = [{ kind: 'advance' as const, edgeId: 'e2' }]
    const bare: Reaction[] = [{ when: { type: 'event', id: 'A' }, do: actions }]
    const ns: Reaction[] = [{ when: { type: 'event', id: 'parry:A' }, do: actions }]
    expect(resolveEventReactionDo(bare, 'A')?.[0]).toEqual(actions[0])
    expect(resolveEventReactionDo(ns, 'A', 'parry')?.[0]).toEqual(actions[0])
  })

  it('event reaction applies effects; edge (by handle) decides routing', () => {
    const graph: GameGraph = {
      nodes: [
        node('a', {
          durationMs: 1000,
          overlayNodes: [{
            overlay: 'ov-a',
            reactions: [{
              when: { type: 'event', id: 'pass' },
              do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 3 }] }],
            }],
          }],
        }),
        node('b', { durationMs: 500 }),
      ],
      edges: [
        { id: 'e-pass', source: 'a', target: 'b', sourceHandle: 'pass', targetHandle: 'in' },
      ],
    }
    const scn = scnOf(graph, {
      ui: {
        overlays: {
          'ov-a': {
            id: 'ov-a',
            children: [
              {
                id: 'q',
                component: 'qte',
                trigger: { when: 'enter' },
                inputs: {},
              },
            ],
          },
        },
      },
    })
    const a = scn.graph.nodes.find((n) => n.id === 'a')!
    a.data.overlayNodes = [{
      overlay: 'ov-a',
      reactions: [{
        when: { type: 'event', id: 'pass' },
        do: [{ kind: 'effect', effects: [{ kind: 'var', varId: 'qi', op: 'add', value: 3 }] }],
      }],
    }]
    const rt = new GraphRuntime(scn.graph, scn)
    rt.start()
    expect(rt.state.phase).toBe('awaitInteraction')
    rt.submitInteraction(rid('a', 'q'), 'pass')
    expect(rt.state.currentNodeId).toBe('b')
    expect(rt.state.vars.qi).toBe(3)
  })

  it('multi-mount namespaces event ids', () => {
    const mounts = [
      { overlay: 'hudA' },
      { overlay: 'hudB' },
    ]
    const overlays = {
      hudA: {
        id: 'hudA',
        children: [{ id: 'q', component: 'qte', inputs: { events: [{ id: 'A' }] } }],
      },
      hudB: {
        id: 'hudB',
        children: [{ id: 'q', component: 'qte', inputs: { events: [{ id: 'A' }] } }],
      },
    }
    const refs = aggregateNodeOverlayEvents(mounts, overlays, getComponentManifest)
    expect(refs.map((r) => r.eventId)).toEqual(['hudA:A', 'hudB:A'])
  })
})
