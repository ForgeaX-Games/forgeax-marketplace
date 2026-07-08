import { describe, it, expect } from 'vitest'
import { loadReelGameFromPackIndex } from '../loadReelGameFromPackIndex'

describe('loadReelGameFromPackIndex', () => {
  it('finds the reel-game entry and returns its scenario', async () => {
    const fetchJson = async (url: string): Promise<unknown> => {
      if (url === './pack-index.json') {
        return [{ guid: 'g1', kind: 'reel-game', relativeUrl: './reel-game.pack.json' }]
      }
      if (url === './reel-game.pack.json') {
        return {
          assets: [
            { guid: 'g1', kind: 'reel-game', payload: { schemaVersion: 1, scenario: { id: 's1' } } },
          ],
        }
      }
      throw new Error(`unexpected ${url}`)
    }
    const scenario = await loadReelGameFromPackIndex('./pack-index.json', { fetchJson })
    expect(scenario).toEqual({ id: 's1' })
  })

  it('rebases a relative pack url against the pack-index location', async () => {
    const seen: string[] = []
    const fetchJson = async (url: string): Promise<unknown> => {
      seen.push(url)
      if (url.endsWith('pack-index.json')) {
        return [{ guid: 'g1', kind: 'reel-game', relativeUrl: './reel-game.pack.json' }]
      }
      return {
        assets: [{ guid: 'g1', payload: { schemaVersion: 1, scenario: { id: 's9' } } }],
      }
    }
    const scenario = await loadReelGameFromPackIndex('/games/123/pack-index.json', { fetchJson })
    expect(scenario).toEqual({ id: 's9' })
    expect(seen).toContain('/games/123/reel-game.pack.json')
  })

  it('throws when there is no reel-game asset in the index', async () => {
    const fetchJson = async (): Promise<unknown> => [
      { guid: 'g1', kind: 'scene', relativeUrl: './x.pack.json' },
    ]
    await expect(loadReelGameFromPackIndex('./pack-index.json', { fetchJson })).rejects.toThrow(
      /no reel-game/,
    )
  })

  it('throws when the payload is malformed', async () => {
    const fetchJson = async (url: string): Promise<unknown> => {
      if (url === './pack-index.json') {
        return [{ guid: 'g1', kind: 'reel-game', relativeUrl: './reel-game.pack.json' }]
      }
      return { assets: [{ guid: 'g1', payload: { schemaVersion: 1 } }] }
    }
    await expect(loadReelGameFromPackIndex('./pack-index.json', { fetchJson })).rejects.toThrow(
      /malformed/,
    )
  })
})
