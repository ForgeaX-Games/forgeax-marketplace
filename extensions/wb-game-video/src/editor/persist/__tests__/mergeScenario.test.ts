/**
 * 回归：草稿缺 entities 时不得抹掉 demo 实体（否则挂载血条 bind 全空、试玩看不见 HUD）。
 */
import { describe, expect, it } from 'vitest'
import { mergeScenario, type ScenarioMetaFields } from '../graphScenarioStore'
import type { GameScenario } from '../../../runtime/schema/graph-schema'

const demo = {
  schemaVersion: 'wb-game-video.graph.v1',
  graph: { nodes: [], edges: [] },
  entities: {
    'ent-player': { id: 'ent-player', attrs: { hp: 100 }, attrMeta: { hp: { max: 100 } } },
    'ent-boss': { id: 'ent-boss', attrs: { hp: 500 }, attrMeta: { hp: { max: 500 } } },
  },
  variables: { qi: { id: 'qi', initial: 0 } },
} as unknown as GameScenario

describe('mergeScenario', () => {
  it('meta.entities 为 undefined 时保留 demo 实体', () => {
    const meta: ScenarioMetaFields = {
      entities: undefined,
      variables: undefined,
      ui: { overlays: { 'scheme-static': { id: 'scheme-static', children: [] } } },
    }
    const scn = mergeScenario(demo, meta, { nodes: [{ id: 'n1' } as never], edges: [] })
    expect(Object.keys(scn.entities ?? {})).toEqual(['ent-player', 'ent-boss'])
    expect(scn.variables?.qi).toBeTruthy()
    expect(scn.ui?.overlays?.['scheme-static']).toBeTruthy()
    expect(scn.graph.nodes).toHaveLength(1)
  })

  it('meta 显式 entities:{} 表示用户清空，予以保留', () => {
    const scn = mergeScenario(demo, { entities: {} }, demo.graph)
    expect(scn.entities).toEqual({})
  })
})
