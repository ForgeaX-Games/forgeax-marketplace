import { describe, expect, it } from 'vitest'
import { assetPlaybackLocation } from '../game-media-middleware'

describe('standalone media manifest resolution', () => {
  it('uses the current game for assets owned by that game', () => {
    expect(assetPlaybackLocation({ id: 'clip' }, '0728-02')).toBe(
      '/api/v1/kino/resources/clip/content?game_id=0728-02',
    )
  })

  it('keeps a manifest playback URL ahead of provider routing', () => {
    expect(assetPlaybackLocation({
      id: 'clip',
      url: 'https://cdn.example.test/clip.mp4',
    }, '0728-02')).toBe('https://cdn.example.test/clip.mp4')
  })

})
