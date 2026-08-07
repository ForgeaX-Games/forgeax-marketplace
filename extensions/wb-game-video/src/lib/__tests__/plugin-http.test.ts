import { describe, expect, it } from 'vitest'
import { pluginUrl } from '../plugin-http'

describe('pluginUrl', () => {
  const pluginBase = '/__fx-plugin/wb-game-video/'

  it('keeps host API requests rooted at the origin', () => {
    expect(pluginUrl('/api/game-host/games/demo/package/status', pluginBase))
      .toBe('/api/game-host/games/demo/package/status')
    expect(pluginUrl('/api/v1/kino/assets', pluginBase)).toBe('/api/v1/kino/assets')
  })

  it('prefixes plugin-local routes with the plugin mount', () => {
    expect(pluginUrl('/__gva__/assets?game=demo', pluginBase))
      .toBe('/__fx-plugin/wb-game-video/__gva__/assets?game=demo')
  })

  it('does not double-prefix existing or standalone paths', () => {
    expect(pluginUrl('/__fx-plugin/wb-game-video/__gva__/assets', pluginBase))
      .toBe('/__fx-plugin/wb-game-video/__gva__/assets')
    expect(pluginUrl('/__gva__/assets', './')).toBe('/__gva__/assets')
  })
})
