import { describe, expect, it } from 'vitest'
import { buildBakeLayersFromExecutionResult, collectTerminalPorts } from '../src/baked/snapshot-from-execute.js'

// Mirrors execution-summary.test.ts's fixture shape: outputs[nodeId][port] =
// DataTreeEntry[] whose items are ScenePortValue { tree: SceneNodeSnapshot, focus }.
function cells(n: number, token = 'wall') {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: 0, token }))
}

describe('buildBakeLayersFromExecutionResult', () => {
  it('projects a scene port item into DFS-ordered bake layers with asset metadata', () => {
    const full = {
      executionId: 'exec_1',
      status: 'completed' as const,
      durationMs: 10,
      outputs: {
        g_arch: {
          out_0: [
            {
              path: [0],
              items: [
                {
                  focus: '/',
                  tree: {
                    name: '',
                    path: '/',
                    version: 3,
                    cells: [],
                    children: [
                      {
                        name: 'House',
                        path: '/House',
                        version: 3,
                        cells: cells(4, 'wall'),
                        attributes: { asset_name: '橡木屋', asset_type: 'object' },
                        children: [
                          {
                            name: 'Roof',
                            path: '/House/Roof',
                            version: 4,
                            cells: cells(2, 'roof'),
                            attributes: { asset_name: '屋顶' },
                            children: [],
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
          // Non-scene port (plain string) must be skipped, never throw.
          out_1: [{ path: [0], items: ['石路'] }],
        },
      },
    }

    const layers = buildBakeLayersFromExecutionResult(full)
    expect(layers).toHaveLength(2)
    // Parent (House) before child (Roof) — bakeLayersForProject relies on this order.
    expect(layers[0]).toMatchObject({
      nodePath: '/House',
      nodeName: 'House',
      assetName: '橡木屋',
      assetType: 'object',
    })
    expect(layers[0]!.cells).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ])
    expect(layers[1]).toMatchObject({ nodePath: '/House/Roof', nodeName: 'Roof', assetName: '屋顶' })
  })

  it('is defensive: unexpected outputs/ports/items shapes yield no layers instead of throwing', () => {
    expect(buildBakeLayersFromExecutionResult({ outputs: {} })).toEqual([])
    expect(
      buildBakeLayersFromExecutionResult({
        outputs: { n: { p: [{ path: [0], items: [42, 'x', null, { foo: 'bar' }] }] } },
      }),
    ).toEqual([])
    // Malformed port (not an array) is skipped, not thrown.
    expect(
      buildBakeLayersFromExecutionResult({ outputs: { n: { p: { not: 'an array' } } } }),
    ).toEqual([])
  })

  it('whitelist-scoped to graph edges: only bakes the port(s) directly feeding scene_output, even across nested-group boundaries the edge list never sees', () => {
    const full = {
      executionId: 'exec_3',
      status: 'completed' as const,
      durationMs: 1,
      outputs: {
        step1: { scene: [{ path: [0], items: [{ focus: '/', tree: { name: '', path: '/', version: 1, cells: [], children: [{ name: 'A', path: '/A', version: 1, cells: cells(1), children: [] }] } }] }] },
        step2: { scene: [{ path: [0], items: [{ focus: '/', tree: { name: '', path: '/', version: 1, cells: [], children: [{ name: 'B', path: '/B', version: 1, cells: cells(1), children: [] }] } }] }] },
        dangling: { scene: [{ path: [0], items: [{ focus: '/', tree: { name: '', path: '/', version: 1, cells: [], children: [{ name: 'C', path: '/C', version: 1, cells: cells(1), children: [] }] } }] }] },
      },
    }
    // step1.scene -> step2.scene (intermediate composition, must be excluded — this
    // is exactly the shape a __group__'s internal wiring takes, invisible here too)
    // step2.scene -> sink.scene (the ONE edge feeding scene_output — the whitelist)
    // dangling.scene has NO outgoing edge at all — not wired to scene_output, so it
    // is NOT part of the final scene and must be excluded too (unlike the old
    // blacklist approach, which had no way to distinguish "not yet wired" from
    // "the terminal output").
    const nodes = [
      { id: 'step1', opId: 'grid2node' },
      { id: 'step2', opId: 'add_child' },
      { id: 'dangling', opId: 'grid2node' },
      { id: 'sink', opId: 'scene_output' },
    ]
    const edges = [
      { source: { nodeId: 'step1', port: 'scene' }, target: { nodeId: 'step2', port: 'nodes' } },
      { source: { nodeId: 'step2', port: 'scene' }, target: { nodeId: 'sink', port: 'scene' } },
    ]
    const terminal = collectTerminalPorts(nodes, edges)
    expect(terminal).toEqual(new Set(['step2:scene']))

    const layers = buildBakeLayersFromExecutionResult(full, terminal)
    const paths = layers.map((l) => l.nodePath).sort()
    expect(paths).toEqual(['/B'])
  })

  it('falls back to bake-all when there is no wired scene_output (empty terminal set)', () => {
    const full = {
      executionId: 'exec_4',
      status: 'completed' as const,
      durationMs: 1,
      outputs: {
        step1: { scene: [{ path: [0], items: [{ focus: '/', tree: { name: '', path: '/', version: 1, cells: [], children: [{ name: 'A', path: '/A', version: 1, cells: cells(1), children: [] }] } }] }] },
      },
    }
    const nodes = [{ id: 'step1', opId: 'grid2node' }]
    const terminal = collectTerminalPorts(nodes, [])
    expect(terminal.size).toBe(0)

    const layers = buildBakeLayersFromExecutionResult(full, terminal)
    expect(layers.map((l) => l.nodePath)).toEqual(['/A'])
  })

  it('supports a bare SceneNodeSnapshot item (no {tree,focus} wrapper), rooted at its own path', () => {
    const full = {
      executionId: 'exec_2',
      status: 'completed' as const,
      durationMs: 5,
      outputs: {
        n: {
          out: [
            {
              path: [0],
              items: [
                { name: 'Wall', path: '/Wall', version: 1, cells: cells(1, 'wall'), children: [] },
              ],
            },
          ],
        },
      },
    }
    const layers = buildBakeLayersFromExecutionResult(full)
    expect(layers).toHaveLength(1)
    expect(layers[0]).toMatchObject({ nodePath: '/Wall', nodeName: 'Wall' })
  })
})
