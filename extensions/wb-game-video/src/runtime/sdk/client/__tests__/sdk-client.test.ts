import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAssetResolver } from '../asset-resolver'
import { fetchGamePackage, GamePackageError, readGameId } from '../game-package-client'

const blueprint = {
  graph: { nodes: [], edges: [] },
  manifest: { mainPackId: 'main', packs: {} },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('standalone SDK client', () => {
  it('requires a valid gameId query parameter', () => {
    expect(readGameId('?gameId=0728-02')).toBe('0728-02')
    expect(() => readGameId('')).toThrow(GamePackageError)
    expect(() => readGameId('?gameId=../../bad')).toThrow(GamePackageError)
  })

  it('loads and validates the game package endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        project: { id: '0728-02' },
        blueprint,
        assetsManifest: { version: 2, assets: [{ id: 'intro', kind: 'video' }] },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const gamePackage = await fetchGamePackage('0728-02')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/game-host/games/0728-02/package',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
    expect(gamePackage.assetsManifest.assets[0]?.id).toBe('intro')
  })

  it('resolves only assets declared by the manifest', () => {
    const resolveAsset = createAssetResolver({
      version: 2,
      assets: [
        { id: 'intro', kind: 'video' },
        { id: 'remote', kind: 'video', url: 'https://cdn.example.test/remote.mp4' },
      ],
    })

    expect(resolveAsset('intro', '0728-02')).toBe('/__gva__/media/intro?game=0728-02')
    expect(resolveAsset('remote', '0728-02')).toBe('https://cdn.example.test/remote.mp4')
    expect(resolveAsset('missing', '0728-02')).toBeUndefined()
  })

})
