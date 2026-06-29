import { describe, expect, it } from 'vitest'
import { summarizeExecutionResult } from '../src/execution-summary.js'

// Build a fake scene tree with a heavy `cells` array so we can assert the summary
// strips it down to a count instead of carrying the voxel payload.
function bigCells(n: number): Array<{ x: number; y: number; z: number; token: string }> {
  return Array.from({ length: n }, (_, i) => ({ x: i, y: 0, z: 0, token: 'wall' }))
}

const fullResult = {
  executionId: 'exec_1',
  status: 'completed' as const,
  durationMs: 1234,
  outputs: {
    g_arch: {
      // scene port: DataTreeEntry[] whose items are ScenePortValue { tree, focus }
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
                cells: bigCells(50),
                children: [
                  {
                    name: 'block_ground',
                    path: '/block_ground',
                    version: 3,
                    cells: bigCells(1600),
                    children: [
                      { name: 'architecture_0', path: '/block_ground/architecture_0', version: 3, cells: bigCells(200), children: [] },
                      { name: 'rest', path: '/block_ground/rest', version: 3, children: [] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
      // string port: small scalar should pass through
      out_1: [{ path: [0], items: ['石路'] }],
    },
    size_node: {
      // number port
      value: [{ path: [0], items: [50] }],
    },
  },
}

describe('summarizeExecutionResult', () => {
  it('strips full voxel cells but keeps status, child names and cell counts', () => {
    const summary = summarizeExecutionResult(fullResult) as Record<string, any>

    // status / executionId / durationMs preserved verbatim — sino judges on these.
    expect(summary.status).toBe('completed')
    expect(summary.executionId).toBe('exec_1')
    expect(summary.durationMs).toBe(1234)
    expect(summary.summarized).toBe(true)

    const scenePort = summary.outputs.g_arch.out_0
    expect(scenePort.branchCount).toBe(1)
    expect(scenePort.itemCount).toBe(1)
    // direct child NAMES are kept — sino's primary "what did this group produce" signal.
    expect(scenePort.items[0].tree.childNames).toEqual(['block_ground'])
    // descendant names surface NESTED asset names (real graphs nest them a level down).
    expect(scenePort.items[0].tree.descendantNames).toEqual(
      expect.arrayContaining(['block_ground', 'architecture_0', 'rest']),
    )
    // cell COUNTS, not the cells themselves.
    expect(scenePort.items[0].tree.cellCount).toBe(50) // self only
    expect(scenePort.items[0].tree.subtreeCellCount).toBe(50 + 1600 + 200)
    expect(scenePort.totalCellCount).toBe(50 + 1600 + 200)

    // string / number ports pass through their small scalar value.
    expect(summary.outputs.g_arch.out_1.items[0].value).toBe('石路')
    expect(summary.outputs.size_node.value.items[0].value).toBe(50)

    // Crucially: the serialized summary must NOT contain any raw cell object.
    const serialized = JSON.stringify(summary)
    expect(serialized).not.toContain('"token"')
    // KB-scale, not MB: 1850 fake cells would be ~tens of KB if leaked.
    expect(serialized.length).toBeLessThan(2000)
  })

  it('is defensive: malformed ports collapse to a note instead of throwing', () => {
    const weird = {
      executionId: 'exec_2',
      status: 'completed' as const,
      durationMs: 1,
      outputs: {
        n: {
          p_array_notentries: [1, 2, 3],
          p_obj: { unexpected: true },
          p_null: null,
        },
      },
    }
    expect(() => summarizeExecutionResult(weird)).not.toThrow()
    const summary = summarizeExecutionResult(weird) as Record<string, any>
    expect(summary.status).toBe('completed')
    expect(summary.outputs.n).toBeDefined()
  })

  it('preserves error verbatim', () => {
    const errored = {
      executionId: 'exec_3',
      status: 'error' as const,
      durationMs: 0,
      error: { nodeId: 'x', message: 'boom' },
      outputs: {},
    }
    const summary = summarizeExecutionResult(errored) as Record<string, any>
    expect(summary.status).toBe('error')
    expect(summary.error).toEqual({ nodeId: 'x', message: 'boom' })
  })
})
