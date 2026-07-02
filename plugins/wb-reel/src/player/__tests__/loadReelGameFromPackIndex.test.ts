import { describe, it, expect } from 'vitest'
import { loadReelGameFromPackIndex } from '../loadReelGameFromPackIndex'
import { buildReelGameAsset } from '../../scenario/pkg/buildReelGameAsset'

/**
 * 一棵满足 reelScenario.schema.json 骨架的最小合法剧本。
 * loadReelGameFromPackIndex 走 fail-fast 的 extractValidatedScenario，
 * 因此夹具必须是 schema 合法的整棵 Scenario（不能再用 { id:'s1' } 这种裸壳）。
 */
function validScenario(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    title: 'demo',
    rootSceneId: '1.1',
    schemaVersion: 8,
    defaultCharMs: 30,
    scenes: {
      '1.1': {
        id: '1.1',
        title: '镜头一',
        media: { kind: 'VIDEO', ref: 'm-aaa' },
        durationMs: 6000,
        dialogue: [],
        branches: [],
      },
    },
    ...over,
  }
}

describe('loadReelGameFromPackIndex', () => {
  it('finds the reel-game entry and returns its (schema-validated) scenario', async () => {
    const sc = validScenario()
    const fetchJson = async (url: string): Promise<unknown> => {
      if (url === './pack-index.json') {
        return [{ guid: 'g1', kind: 'reel-game', relativeUrl: './ReelLevel.pack.json' }]
      }
      if (url === './ReelLevel.pack.json') {
        return { assets: [{ guid: 'g1', kind: 'reel-game', payload: { schemaVersion: 1, scenario: sc } }] }
      }
      throw new Error(`unexpected ${url}`)
    }
    const scenario = await loadReelGameFromPackIndex('./pack-index.json', { fetchJson })
    expect(scenario).toEqual(sc)
  })

  it('rebases a relative pack url against the pack-index location', async () => {
    const sc = validScenario({ id: 's9' })
    const seen: string[] = []
    const fetchJson = async (url: string): Promise<unknown> => {
      seen.push(url)
      if (url.endsWith('pack-index.json')) {
        return [{ guid: 'g1', kind: 'reel-game', relativeUrl: './ReelLevel.pack.json' }]
      }
      return { assets: [{ guid: 'g1', payload: { schemaVersion: 1, scenario: sc } }] }
    }
    const scenario = await loadReelGameFromPackIndex('/games/123/pack-index.json', { fetchJson })
    expect(scenario).toEqual(sc)
    expect(seen).toContain('/games/123/ReelLevel.pack.json')
  })

  it('throws when there is no reel-game asset in the index', async () => {
    const fetchJson = async (): Promise<unknown> => [
      { guid: 'g1', kind: 'scene', relativeUrl: './x.pack.json' },
    ]
    await expect(loadReelGameFromPackIndex('./pack-index.json', { fetchJson })).rejects.toThrow(
      /no reel-game/,
    )
  })

  it('fail-fast: throws when the payload has no scenario object', async () => {
    const fetchJson = async (url: string): Promise<unknown> => {
      if (url === './pack-index.json') {
        return [{ guid: 'g1', kind: 'reel-game', relativeUrl: './ReelLevel.pack.json' }]
      }
      return { assets: [{ guid: 'g1', payload: { schemaVersion: 1 } }] }
    }
    await expect(loadReelGameFromPackIndex('./pack-index.json', { fetchJson })).rejects.toThrow(
      /缺少 scenario/,
    )
  })

  it('fail-fast: throws when the scenario violates the schema backbone', async () => {
    const fetchJson = async (url: string): Promise<unknown> => {
      if (url === './pack-index.json') {
        return [{ guid: 'g1', kind: 'reel-game', relativeUrl: './ReelLevel.pack.json' }]
      }
      return { assets: [{ guid: 'g1', payload: { schemaVersion: 1, scenario: { id: 'x' } } }] }
    }
    await expect(loadReelGameFromPackIndex('./pack-index.json', { fetchJson })).rejects.toThrow(
      /schema 校验失败/,
    )
  })

  /**
   * 单一来源闭环（Route A 落盘契约）：导出器写出的 ReelLevel.pack.json 经独立站点
   * 读取器取回后，必须还原成「与作者态字节级一致」的整棵 Scenario（媒体引用已被
   * 改写成 ./reel-media/<hash>.<ext>）。这坐实了「导出 == 预览」：built 资产喂进
   * scenarioStore 的那棵剧本，就是 buildReelGameAsset 蒸馏出来的那一棵。
   */
  it('round-trips build → ReelLevel.pack.json → load into the identical scenario', async () => {
    const guid = '0190a0b1-0000-7000-8000-0000000000aa'
    const built = await buildReelGameAsset(validScenario() as never, {
      guid,
      resolveBlob: async () => ({ kind: 'blob', bytes: new Uint8Array([1, 2, 3]), ext: 'mp4' }),
    })
    const packJson = built.packJson
    const fetchJson = async (url: string): Promise<unknown> => {
      if (url === './pack-index.json') {
        return [{ guid, kind: 'reel-game', relativeUrl: './ReelLevel.pack.json' }]
      }
      if (url === './ReelLevel.pack.json') return packJson
      throw new Error(`unexpected ${url}`)
    }
    const loaded = await loadReelGameFromPackIndex('./pack-index.json', { fetchJson })
    expect(loaded).toEqual(packJson.assets[0]!.payload.scenario)
    // 媒体引用确已被蒸馏成 bundle 相对 URL（作者态的 m-aaa 不应泄漏到成品）
    const mediaRef = (loaded.scenes as Record<string, { media: { ref: string } }>)['1.1']!.media.ref
    expect(mediaRef).toMatch(/^\.\/reel-media\/[0-9a-f]{16}\.mp4$/)
  })
})
