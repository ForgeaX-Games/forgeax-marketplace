import { describe, expect, it } from 'vitest'
import { collectProjectComponentAssets } from '../project-component-assets'

describe('collectProjectComponentAssets', () => {
  it('collects project controls from a default register module', () => {
    const assets = collectProjectComponentAssets({
      default(host) {
        host.registerComponent('battle-hp', {
          label: '战斗血条',
          inputs: [{ key: 'value', valueType: 'number', default: 100 }],
        })
        host.registerOverlayRenderer(
          'battle-hp',
          () => null,
          { id: 'battle-hp', label: '战斗血条', events: [] },
        )
      },
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      source: 'project-component',
      componentId: 'battle-hp',
      manifest: { label: '战斗血条' },
    })
  })

  it('omits declarations without a renderer because controls must be previewable', () => {
    const assets = collectProjectComponentAssets({
      register(host) {
        host.registerComponent('metadata-only', { label: '仅元数据' })
      },
    })

    expect(assets).toEqual([])
  })
})
