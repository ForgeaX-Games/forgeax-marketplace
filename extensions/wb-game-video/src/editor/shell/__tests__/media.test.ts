import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZHANDOU_VIDEOS } from '../../assets/catalog'
import { requestGenerateVideo, resolveMediaSrc } from '../media'

const client = {
  context: {
    gameId: 'demo-game',
    endpoints: { gamePackage: 'https://host.test/__workbench__/v1/games/demo-game/package' },
  },
  extension: {
    fetch: vi.fn(),
    url: vi.fn((path: string) => `https://host.test/extension/runtime/${path.replace(/^\//, '')}`),
  },
  tool: { call: vi.fn() },
}

vi.mock('../../../lib/workbench-host', () => ({
  getWorkbenchHost: () => client,
}))

afterEach(() => {
  client.extension.fetch.mockReset()
  client.extension.url.mockClear()
  client.tool.call.mockReset()
})

describe('resolveMediaSrc', () => {
  it('keeps bundled videos ahead of remote resolvers, including m- refs', () => {
    expect(resolveMediaSrc('idle01', 'demo')).toBe(ZHANDOU_VIDEOS.idle01)
    expect(resolveMediaSrc('m-idle01', 'demo')).toBe(ZHANDOU_VIDEOS.idle01)
  })

  it('routes generated a-vid resources through the registry playback endpoint', () => {
    expect(resolveMediaSrc('a-vid-generated', 'demo game')).toBe(
      'https://host.test/extension/runtime/media/resources/a-vid-generated/content?game_id=demo%20game',
    )
  })

  it('routes registry audio ids through the same media endpoint as video (BGM 决策 A)', () => {
    // 媒体二进制归 Kino；资产类型只保留在 wb-game-video 的 manifest 记录中。
    expect(resolveMediaSrc('a-aud-bgm-battle', 'demo game')).toBe(
      'https://host.test/extension/runtime/media/resources/a-aud-bgm-battle/content?game_id=demo%20game',
    )
  })

  it('routes stable Kino ids through the Kino content endpoint', () => {
    expect(resolveMediaSrc('res/123', 'demo game')).toBe(
      'https://host.test/extension/runtime/media/resources/res%2F123/content?game_id=demo%20game',
    )
  })

  it('delegates generation to the host tool instead of constructing an API request', async () => {
    client.tool.call.mockResolvedValue({ asset: { id: 'generated-1' } })

    await expect(requestGenerateVideo('query-game', {
      sceneNodeId: 'node-1',
      nodeName: 'Opening',
      characterRefIds: ['character-1'],
      sceneRefIds: ['scene-1'],
    })).resolves.toEqual({ asset: { id: 'generated-1' } })

    expect(client.tool.call).toHaveBeenCalledWith('wb-game-video:generate-video', expect.objectContaining({
      sceneNodeId: 'node-1',
    }))
    expect(client.extension.fetch).not.toHaveBeenCalled()
  })
})
