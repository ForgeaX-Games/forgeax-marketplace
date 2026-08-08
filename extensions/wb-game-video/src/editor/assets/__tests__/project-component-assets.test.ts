import { describe, expect, it } from 'vitest'
import { collectProjectComponentAssets } from '../project-component-assets'

describe('collectProjectComponentAssets', () => {
  it('collects project controls from a default catalog module', () => {
    const assets = collectProjectComponentAssets({
      default: [
        {
          component: () => null,
          manifest: {
            id: 'battle-hp',
            label: '战斗血条',
            inputs: [{ key: 'value', valueType: 'number', default: 100 }],
            events: [],
          },
        },
      ],
    })

    expect(assets).toHaveLength(1)
    expect(assets[0]).toMatchObject({
      source: 'project-component',
      componentId: 'battle-hp',
      manifest: { label: '战斗血条' },
    })
  })

  it('returns empty when module is not a catalog', () => {
    const assets = collectProjectComponentAssets({
      register() {},
    })

    expect(assets).toEqual([])
  })
})
