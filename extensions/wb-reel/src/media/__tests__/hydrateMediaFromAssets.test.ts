import { describe, it, expect } from 'vitest'
import type { AssetRecord } from '../assetStore'
import { hydrateMediaFromAssets } from '../hydrateMediaFromAssets'

function asset(overrides: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id: 'a-1',
    kind: 'image',
    filename: 'a-1.png',
    mimeType: 'image/png',
    bytes: 1000,
    createdAt: 1_000,
    meta: {},
    ...overrides,
  }
}

const urlOf = (id: string): string => `/__reel__/assets/${id}`

describe('hydrateMediaFromAssets', () => {
  it('没有 meta.mediaId 的 asset 一律跳过', () => {
    const out = hydrateMediaFromAssets(
      [asset({ id: 'a-1' }), asset({ id: 'a-2', meta: { promptKind: 'scene' } })],
      urlOf,
    )
    expect(out).toEqual({})
  })

  it('为每个带 mediaId 的 asset 合成 MediaEntry，url 经 urlOf 拼接', () => {
    const out = hydrateMediaFromAssets(
      [
        asset({ id: 'a-1', filename: 'x.png', meta: { mediaId: 'm-1' } }),
        asset({ id: 'a-2', filename: 'y.png', meta: { mediaId: 'm-2' } }),
      ],
      urlOf,
    )
    expect(out['m-1']).toMatchObject({
      id: 'm-1',
      name: 'x.png',
      url: '/__reel__/assets/a-1',
    })
    expect(out['m-2']?.url).toBe('/__reel__/assets/a-2')
  })

  it('同一 mediaId 有多条 asset 时保留 createdAt 最新那条（作者重生了图）', () => {
    const out = hydrateMediaFromAssets(
      [
        asset({ id: 'old', createdAt: 100, meta: { mediaId: 'm-1' } }),
        asset({ id: 'new', createdAt: 200, meta: { mediaId: 'm-1' } }),
      ],
      urlOf,
    )
    expect(out['m-1']?.id).toBe('m-1')
    expect(out['m-1']?.url).toBe('/__reel__/assets/new')
    expect(out['m-1']?.createdAt).toBe(200)
  })

  it('输入顺序不影响结果（永远取最新的）', () => {
    const out1 = hydrateMediaFromAssets(
      [
        asset({ id: 'new', createdAt: 200, meta: { mediaId: 'm-1' } }),
        asset({ id: 'old', createdAt: 100, meta: { mediaId: 'm-1' } }),
      ],
      urlOf,
    )
    expect(out1['m-1']?.url).toBe('/__reel__/assets/new')
  })

  it('MediaEntry 字段完整（name/mimeType/size/createdAt 对齐 asset）', () => {
    const out = hydrateMediaFromAssets(
      [
        asset({
          id: 'a-1',
          filename: 'char.jpg',
          mimeType: 'image/jpeg',
          bytes: 54321,
          createdAt: 9_000,
          meta: { mediaId: 'm-7' },
        }),
      ],
      urlOf,
    )
    expect(out['m-7']).toEqual({
      id: 'm-7',
      name: 'char.jpg',
      mimeType: 'image/jpeg',
      size: 54321,
      url: '/__reel__/assets/a-1',
      createdAt: 9_000,
    })
  })

  /*
   * v6.8 · scenarioId 过滤 ——
   *   修复 v6.7 时代 adoptForgedScenario 烙旧 id 留下的跨剧本污染:
   *   一个 mediaId 在多个 scenarioId 下都有 record 时, 老实现按 createdAt 取最新,
   *   会把上一份剧本最新生成的图覆盖到当前剧本的同 mediaId 引用。
   */
  describe('filter.scenarioId', () => {
    const records = [
      asset({
        id: 'a-old',
        createdAt: 200,
        meta: { mediaId: 'm-1', scenarioId: 'demo-001' },
      }),
      asset({
        id: 'a-new',
        createdAt: 100,
        meta: { mediaId: 'm-1', scenarioId: 'sn-current' },
      }),
    ]

    it('不传 filter → 兼容老行为, 取 createdAt 最新 (即使跨剧本)', () => {
      const out = hydrateMediaFromAssets(records, urlOf)
      // a-old 创建时间更晚, 但属于 demo-001 而非当前剧本
      expect(out['m-1']?.url).toBe('/__reel__/assets/a-old')
    })

    it('传 scenarioId → 只 hydrate 该剧本下的 record, 即便 createdAt 较旧', () => {
      const out = hydrateMediaFromAssets(records, urlOf, {
        scenarioId: 'sn-current',
      })
      expect(out['m-1']?.url).toBe('/__reel__/assets/a-new')
    })

    it('meta.scenarioId 缺失的老 asset 在过滤模式下被跳过 (宁少勿错)', () => {
      const out = hydrateMediaFromAssets(
        [
          asset({ id: 'a-noscn', meta: { mediaId: 'm-1' } }),
          asset({
            id: 'a-curscn',
            meta: { mediaId: 'm-1', scenarioId: 'sn-current' },
          }),
        ],
        urlOf,
        { scenarioId: 'sn-current' },
      )
      expect(out['m-1']?.url).toBe('/__reel__/assets/a-curscn')
    })

    it('传不匹配任何 record 的 scenarioId → 返回空', () => {
      const out = hydrateMediaFromAssets(records, urlOf, {
        scenarioId: 'sn-nonexistent',
      })
      expect(out).toEqual({})
    })
  })
})
