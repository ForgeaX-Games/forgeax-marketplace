import { afterEach, describe, expect, it } from 'vitest'
import { registerPlugin, unregisterPlugin } from '../registry/kind-registry'
import { validateScenario } from '../validate/validate'
import type { GameScenario } from '../schema/graph-schema'

afterEach(() => {
  unregisterPlugin('demo-pack')
})

const base = (): GameScenario => ({
  schemaVersion: 't',
  graph: { nodes: [], edges: [] },
})

describe('requiredPlugins', () => {
  it('errors when required plugin is not registered', () => {
    const scn = { ...base(), requiredPlugins: [{ id: 'demo-pack' }] }
    const errs = validateScenario(scn).filter((i) => i.code === 'plugin.missing')
    expect(errs).toHaveLength(1)
  })

  it('passes when plugin is registered', () => {
    registerPlugin('demo-pack', { version: '1.0.0' })
    const scn = { ...base(), requiredPlugins: [{ id: 'demo-pack', version: '1.0.0' }] }
    expect(validateScenario(scn).filter((i) => i.code === 'plugin.missing')).toEqual([])
  })

  it('errors on version mismatch', () => {
    registerPlugin('demo-pack', { version: '1.0.0' })
    const scn = { ...base(), requiredPlugins: [{ id: 'demo-pack', version: '2.0.0' }] }
    expect(validateScenario(scn).some((i) => i.code === 'plugin.missing')).toBe(true)
  })
})

describe('lethal.no-exit warning', () => {
  it('warns when hp is mutated without rules or attrRatio exit', () => {
    const scn: GameScenario = {
      schemaVersion: 't',
      entities: {
        'ent-boss': { attrs: { hp: 10 }, attrMeta: { hp: { min: 0, max: 10 } } },
      },
      graph: {
        nodes: [
          {
            id: 'a',
            type: 'perf',
            position: { x: 0, y: 0 },
            inputs: [],
            outputs: [],
            data: {
              name: 'a',
              timeline: [
                {
                  id: 's',
                  role: 'logic',
                  kind: 'settle',
                  trigger: { when: 'enter' },
                  params: {
                    effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -5 }],
                  },
                },
              ],
            },
          },
        ],
        edges: [],
      },
    }
    expect(validateScenario(scn).filter((i) => i.code === 'lethal.no-exit').length).toBeGreaterThanOrEqual(1)
  })

  it('no lethal warn when rules cover attrRatio hp', () => {
    const scn: GameScenario = {
      schemaVersion: 't',
      entities: {
        'ent-boss': { attrs: { hp: 10 }, attrMeta: { hp: { min: 0, max: 10 } } },
      },
      rules: [
        {
          id: 'win',
          when: { all: [{ type: 'attrRatio', entityId: 'ent-boss', attr: 'hp', op: 'lte', value: 0 }] },
          goto: 'win',
        },
      ],
      graph: {
        nodes: [
          {
            id: 'a',
            type: 'perf',
            position: { x: 0, y: 0 },
            inputs: [],
            outputs: [],
            data: {
              name: 'a',
              timeline: [
                {
                  id: 's',
                  role: 'logic',
                  kind: 'settle',
                  trigger: { when: 'enter' },
                  params: {
                    effects: [{ kind: 'attr', entityId: 'ent-boss', attr: 'hp', op: 'add', value: -5 }],
                  },
                },
              ],
            },
          },
          {
            id: 'win',
            type: 'perf',
            position: { x: 0, y: 0 },
            inputs: [],
            outputs: [],
            data: { name: 'win', timeline: [], end: 'victory' },
          },
        ],
        edges: [],
      },
    }
    expect(validateScenario(scn).filter((i) => i.code === 'lethal.no-exit')).toEqual([])
  })
})
