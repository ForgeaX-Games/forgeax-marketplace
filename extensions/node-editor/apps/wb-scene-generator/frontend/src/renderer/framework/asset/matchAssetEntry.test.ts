import { describe, expect, it } from 'vitest'
import { matchAssetEntry, type AliasMeta } from './matchAssetEntry'

const aliasA = '[room-a]_[室内]__[住宅]_[客厅]_[盆栽]_[无]_[西式奇幻]_[正常]_[抠图]_[16]__[静态]_[]_[0]'
const aliasB = '[room-b]_[室内]__[学校]_[办公室]_[盆栽]_[无]_[现代日常]_[正常]_[抠图]_[32]__[静态]_[]_[0]'

describe('matchAssetEntry', () => {
  it('prefers an exact asset alias over duplicate display names', () => {
    const aliases: AliasMeta[] = [
      { alias: aliasA, widthPx: 16 },
      { alias: aliasB, widthPx: 32 },
    ]

    const match = matchAssetEntry({ assetName: '盆栽', assetType: 'object', assetAlias: aliasB } as never, aliases, false)

    expect(match?.primary).toBe(aliasB)
    expect(match?.widthPx).toBe(32)
  })
})
