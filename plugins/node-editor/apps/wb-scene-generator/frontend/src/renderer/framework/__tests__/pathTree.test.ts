import { describe, expect, it } from 'vitest'
import { buildPathTree, flattenVisiblePathTree } from '../pathTree'

describe('path tree', () => {
  const layers = {
    'baked:/Root': { nodePath: '/Root', nodeName: 'Root' },
    'baked:/Root/Child': { nodePath: '/Root/Child', nodeName: 'Child' },
    'baked:/Root/Child/Leaf': { nodePath: '/Root/Child/Leaf', nodeName: 'Leaf' },
  }

  it('builds rows with parent/child nesting even when parents are real layers', () => {
    const tree = buildPathTree(Object.keys(layers), (key) => layers[key as keyof typeof layers])
    expect(tree).toHaveLength(1)
    expect(tree[0].layerKey).toBe('baked:/Root')
    expect(tree[0].children[0].layerKey).toBe('baked:/Root/Child')
  })

  it('preserves backend layer order instead of sorting siblings by name', () => {
    const orderedLayers = {
      'baked:/B': { nodePath: '/B', nodeName: 'B' },
      'baked:/A': { nodePath: '/A', nodeName: 'A' },
    }
    const tree = buildPathTree(Object.keys(orderedLayers), (key) => orderedLayers[key as keyof typeof orderedLayers])
    expect(tree.map((node) => node.pathKey)).toEqual(['/B', '/A'])
  })

  it('flattens visible rows while hiding descendants of collapsed parents', () => {
    const tree = buildPathTree(Object.keys(layers), (key) => layers[key as keyof typeof layers])
    expect(flattenVisiblePathTree(tree, new Set()).map((r) => r.node.pathKey)).toEqual([
      '/Root',
      '/Root/Child',
      '/Root/Child/Leaf',
    ])
    expect(flattenVisiblePathTree(tree, new Set(['/Root'])).map((r) => r.node.pathKey)).toEqual(['/Root'])
  })
})
