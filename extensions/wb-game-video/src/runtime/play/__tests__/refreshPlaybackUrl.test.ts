import { describe, expect, it } from 'vitest'
import { refreshPlaybackUrl } from '../refreshPlaybackUrl'

describe('refreshPlaybackUrl', () => {
  it('refreshes stable runtime media gateways', () => {
    expect(refreshPlaybackUrl('/__workbench__/v1/extension/rt-local/media/assets/clip?gameId=demo', 2)).toBe(
      '/__workbench__/v1/extension/rt-local/media/assets/clip?gameId=demo&__gva_refresh=2',
    )
    expect(refreshPlaybackUrl('/api/v1/kino/resources/clip/content?game_id=demo', 3)).toBe(
      '/api/v1/kino/resources/clip/content?game_id=demo&__gva_refresh=3',
    )
    expect(refreshPlaybackUrl(
      'https://host.test/extension/runtime/media/resources/clip/content',
      4,
    )).toBe(
      'https://host.test/extension/runtime/media/resources/clip/content?__gva_refresh=4',
    )
    expect(refreshPlaybackUrl(
      'https://host.test/extension/runtime/media/assets/generated',
      5,
    )).toBe(
      'https://host.test/extension/runtime/media/assets/generated?__gva_refresh=5',
    )
  })

  it('does not touch direct provider URLs', () => {
    expect(refreshPlaybackUrl('https://cos.example.test/video.mp4?q-signature=secret', 1)).toBeNull()
  })
})
