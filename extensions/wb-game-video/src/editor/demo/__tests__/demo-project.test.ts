import { describe, it, expect } from 'vitest'
import { NODIA_DEMO_PROJECT } from '../demo'
import { MAIN_ID } from '../../persist/blueprint-project'
import demoJson from '../nodia.graph.json'

describe('NODIA_DEMO_PROJECT', () => {
  it('disk json is GraphLibraryDocument (manifest.packs + mainPackId, no legacy fields)', () => {
    const raw = demoJson as Record<string, unknown>
    expect(raw.version).toBe('wb-game-video.graph.v1')
    expect(raw.rng).toBeUndefined()
    expect(raw.reactions).toBeUndefined()
    expect(raw.packs).toBeUndefined()
    expect(raw.schemaVersion).toBeUndefined()
    const manifest = raw.manifest as { mainPackId: string; packs: Record<string, unknown>; version: string }
    expect(manifest.version).toBe('wb-game-video.blueprint-manifest.v1')
    expect(manifest.mainPackId).toBe(MAIN_ID)
    expect(manifest.packs[MAIN_ID]).toBeTruthy()
  })
  it('has a main blueprint in manifest', () => {
    expect(NODIA_DEMO_PROJECT.manifest.mainPackId).toBe(MAIN_ID)
    expect(NODIA_DEMO_PROJECT.manifest.packs[MAIN_ID]!.graph.nodes.length).toBeGreaterThan(0)
  })
  it('root meta carries entities; root graph mirrors main pack', () => {
    expect(NODIA_DEMO_PROJECT.entities).toBeTruthy()
    expect(NODIA_DEMO_PROJECT.graph).toEqual(NODIA_DEMO_PROJECT.manifest.packs[MAIN_ID]!.graph)
  })
  it('starts with an empty custom overlay catalog and base-backed mounts', () => {
    const overlays = NODIA_DEMO_PROJECT.ui?.overlays ?? {}
    expect(Object.keys(overlays).filter((id) => !id.startsWith('base:') && !id.startsWith('node:'))).toEqual([])
    for (const node of NODIA_DEMO_PROJECT.graph.nodes) {
      expect((node.data.overlayNodes ?? []).every((mount) =>
        mount.overlay.startsWith('base:') || mount.overlay.startsWith('node:'),
      )).toBe(true)
    }
  })
  it('stores direct value expressions for every new hp bar instance', () => {
    const bars: Array<{ component?: string; inputs?: Record<string, unknown> }> = []
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      if (!value || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (record.component === 'BattlePlayerHpBar' || record.component === 'BattleEnemyHpBar') {
        bars.push(record)
      }
      Object.values(record).forEach(visit)
    }
    visit(demoJson)

    expect(bars.length).toBeGreaterThan(0)
    expect(bars.every((bar) => {
      const current = bar.inputs?.current as { expr?: unknown } | undefined
      const max = bar.inputs?.max as { expr?: unknown } | undefined
      return typeof current?.expr === 'string'
        && typeof max?.expr === 'string'
        && bar.inputs?.bind === undefined
        && bar.inputs?.attr === undefined
    })).toBe(true)
  })
  it('turn containers have lethal edge exits (replaces old scenario.reactions)', () => {
    const outs = (id: string) => NODIA_DEMO_PROJECT.graph.edges.filter((e) => e.source === id)
    expect(outs('a_my').some((e) => e.id === 'e-amy-win')).toBe(true)
    expect(outs('a_my').some((e) => e.id === 'e-amy-lose')).toBe(true)
    expect(outs('b_ai').some((e) => e.id === 'e-bai-win')).toBe(true)
    expect(outs('b_ai').some((e) => e.id === 'e-bai-lose')).toBe(true)
  })
})
