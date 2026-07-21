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

  it('adds verification.hints when completed but zero scene cells (not whitelist)', () => {
    const empty = {
      executionId: 'exec_empty',
      status: 'completed' as const,
      durationMs: 10,
      outputs: {
        g: {
          out_0: [{ path: [0], items: [{ focus: '/', tree: { name: '', path: '/', version: 3, cells: [], children: [] } }] }],
        },
      },
    }
    const summary = summarizeExecutionResult(empty) as Record<string, any>
    expect(summary.verification.ok).toBe(false)
    expect(summary.verification.totalSceneCells).toBe(0)
    expect(summary.verification.hints[0]).toMatch(/NOT template whitelist/)
    expect(summary.verification.hints[0]).toMatch(/disconnected/)
  })

  it('verification ok when completed with cells', () => {
    const summary = summarizeExecutionResult(fullResult) as Record<string, any>
    expect(summary.verification.ok).toBe(true)
    expect(summary.verification.totalSceneCells).toBeGreaterThan(0)
    expect(summary.verification.hints).toBeUndefined()
  })

  // 2026-07-01: 硬门控 stage3.location_names — narrativeLocationNames 是可选的，
  // 不传时完全不跑（上面所有既有用例都印证了这点：不受影响）。
  describe('stage3.location_names alignment (expectedLocationNames)', () => {
    it('does nothing when expectedLocationNames is omitted (default-off, no regression)', () => {
      const summary = summarizeExecutionResult(fullResult) as Record<string, any>
      expect(summary.verification.locationNameAlignment).toBeUndefined()
    })

    it('passes when every narrative location name is found (possibly as a prefix/suffix) among scene node names', () => {
      // fullResult's scene tree has names: '', 'block_ground', 'architecture_0', 'rest'.
      const summary = summarizeExecutionResult(fullResult, ['block_ground', 'architecture_0']) as Record<string, any>
      expect(summary.verification.locationNameAlignment).toEqual({ ok: true, missing: [] })
      expect(summary.verification.hints).toBeUndefined()
    })

    it('fails and reports the missing narrative name when it truly is not in the scene graph', () => {
      const summary = summarizeExecutionResult(fullResult, ['block_ground', '望江客栈']) as Record<string, any>
      expect(summary.verification.ok).toBe(false)
      expect(summary.verification.locationNameAlignment.ok).toBe(false)
      expect(summary.verification.locationNameAlignment.missing).toEqual([
        expect.objectContaining({ name: '望江客栈' }),
      ])
      expect(summary.verification.hints[0]).toMatch(/stage3\.location_names/)
      expect(summary.verification.hints[0]).toContain('望江客栈')
    })

    // 2026-07-10 复盘：命名对齐失败时必须把实际场景节点名一并回传，agent 才能一次
    // summary 调用比对"预期 vs 实际"，不必再反复调用 raw execute 摸黑翻找输出名。
    it('surfaces actualNodeNames on failure so the agent never has to fall back to raw execute', () => {
      const summary = summarizeExecutionResult(fullResult, ['block_ground', '望江客栈']) as Record<string, any>
      const alignment = summary.verification.locationNameAlignment
      expect(alignment.ok).toBe(false)
      expect(alignment.actualNodeNames).toEqual(
        expect.arrayContaining(['block_ground', 'architecture_0', 'rest']),
      )
      expect(alignment.actualNodeNamesTruncated).toBeUndefined()
      expect(summary.verification.hints[0]).toMatch(/actualNodeNames/)
    })

    it('does not include actualNodeNames when alignment passes (nothing to look up)', () => {
      const summary = summarizeExecutionResult(fullResult, ['block_ground', 'architecture_0']) as Record<string, any>
      expect(summary.verification.locationNameAlignment).toEqual({ ok: true, missing: [] })
    })

    it('fuzzy match tolerates a scene node name that embeds the narrative name as a substring', () => {
      const withSuffix = {
        executionId: 'exec_fuzzy',
        status: 'completed' as const,
        durationMs: 5,
        outputs: {
          g: {
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
                        { name: '望江客栈_主楼', path: '/望江客栈_主楼', version: 3, cells: [{ x: 0, y: 0, z: 0 }], children: [] },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        },
      }
      const summary = summarizeExecutionResult(withSuffix, ['望江客栈']) as Record<string, any>
      expect(summary.verification.locationNameAlignment).toEqual({ ok: true, missing: [] })
    })
  })

  // P0-1 (2026-07-15 tool 升级方案): 三项拓扑检测原本只活在 aw-support 的续作
  // 消息里，现在顺带在 execute 里跑一次，通过可选的第三个参数 currentGraph 接入。
  describe('topology checks (currentGraph)', () => {
    it('does nothing when currentGraph is omitted (default-off, no regression)', () => {
      const summary = summarizeExecutionResult(fullResult) as Record<string, any>
      expect(summary.verification.topologyIssues).toBeUndefined()
    })

    it('reports [] (not omitted) when currentGraph is supplied but clean', () => {
      const nodeById = new Map([
        ['grid', { id: 'grid', opId: '__group__', name: 'AddBaseGrid', params: {} }],
        ['island', { id: 'island', opId: '__group__', name: 'IslandRegions', params: {} }],
      ])
      const edges = [{ id: 'e1', source: { nodeId: 'grid', port: 'out_1' }, target: { nodeId: 'island', port: 'in_0' } }]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.topologyIssues).toEqual([])
    })

    it('flags a Rest fan-out from AddBaseGrid.out_1 into two template groups', () => {
      const nodeById = new Map([
        ['grid', { id: 'grid', opId: '__group__', name: 'AddBaseGrid', params: {} }],
        ['a', { id: 'a', opId: '__group__', name: 'IslandRegions', params: {} }],
        ['b', { id: 'b', opId: '__group__', name: 'LakeRegions', params: {} }],
      ])
      const edges = [
        { id: 'e1', source: { nodeId: 'grid', port: 'out_1' }, target: { nodeId: 'a', port: 'in_0' } },
        { id: 'e2', source: { nodeId: 'grid', port: 'out_1' }, target: { nodeId: 'b', port: 'in_0' } },
      ]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.topologyIssues).toHaveLength(1)
      expect(summary.verification.topologyIssues[0].kind).toBe('rest-fan-out')
      expect(summary.verification.topologyIssues[0].reason).toContain('fan-out')
      // 非阻断:不参与 ok 判定(见 execution-summary.ts 的注释)。
      expect(summary.verification.ok).toBe(true)
    })

    it('flags an illegal local tree_merge and computes suggestedOps from the root merge portCount', () => {
      const nodeById = new Map([
        ['a', { id: 'a', opId: '__group__', name: 'IslandRegions', params: {} }],
        ['b', { id: 'b', opId: '__group__', name: 'LakeRegions', params: {} }],
        ['local_merge', { id: 'local_merge', opId: 'tree_merge', params: { portCount: 2 } }],
        ['root_merge', { id: 'root_merge', opId: 'tree_merge', params: { portCount: 1 } }],
        ['flatten', { id: 'flatten', opId: 'tree_flatten', params: {} }],
      ])
      const edges = [
        { id: 'e1', source: { nodeId: 'a', port: 'out_0' }, target: { nodeId: 'local_merge', port: 'item_0' } },
        { id: 'e2', source: { nodeId: 'b', port: 'out_0' }, target: { nodeId: 'local_merge', port: 'item_1' } },
        { id: 'e3', source: { nodeId: 'local_merge', port: 'out_0' }, target: { nodeId: 'root_merge', port: 'item_0' } },
        { id: 'e4', source: { nodeId: 'root_merge', port: 'out_0' }, target: { nodeId: 'flatten', port: 'in_0' } },
      ]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.topologyIssues).toHaveLength(1)
      const issue = summary.verification.topologyIssues[0]
      expect(issue.kind).toBe('illegal-local-merge')
      expect(issue.suggestedOps).toEqual([
        { type: 'deleteNode', nodeId: 'local_merge' },
        { type: 'updateNode', nodeId: 'root_merge', params: { portCount: 3 } },
        { type: 'connect', edgeId: 'e_fix_local_merge_0', source: { nodeId: 'a', port: 'out_0' }, target: { nodeId: 'root_merge', port: 'item_1' } },
        { type: 'connect', edgeId: 'e_fix_local_merge_1', source: { nodeId: 'b', port: 'out_0' }, target: { nodeId: 'root_merge', port: 'item_2' } },
      ])
    })

    it('flags a wired manual_points node whose x/y are both left at the silent zero default', () => {
      const nodeById = new Map([
        ['grid', { id: 'grid', opId: '__group__', name: 'AddBaseGrid', params: {} }],
        ['pts', { id: 'pts', opId: 'manual_points', params: {} }],
        ['a', { id: 'a', opId: '__group__', name: 'IslandRegions', params: {} }],
      ])
      const edges = [{ id: 'e1', source: { nodeId: 'pts', port: 'point' }, target: { nodeId: 'a', port: 'in_1' } }]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      const issue = summary.verification.topologyIssues.find((i: any) => i.kind === 'manual-points-zero-default')
      expect(issue).toBeDefined()
      expect(issue.reason).toContain('pts')
    })

    it('does not flag manual_points when x AND y are both explicitly wired via edges', () => {
      const nodeById = new Map([
        ['pts', { id: 'pts', opId: 'manual_points', params: {} }],
        ['xsrc', { id: 'xsrc', opId: 'number', params: { value: 12 } }],
        ['ysrc', { id: 'ysrc', opId: 'number', params: { value: 34 } }],
        ['a', { id: 'a', opId: '__group__', name: 'IslandRegions', params: {} }],
      ])
      const edges = [
        { id: 'e1', source: { nodeId: 'xsrc', port: 'out_0' }, target: { nodeId: 'pts', port: 'x' } },
        { id: 'e2', source: { nodeId: 'ysrc', port: 'out_0' }, target: { nodeId: 'pts', port: 'y' } },
        { id: 'e3', source: { nodeId: 'pts', port: 'point' }, target: { nodeId: 'a', port: 'in_1' } },
      ]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.topologyIssues).toEqual([])
    })

    it('does not flag manual_points when x/y params are explicit non-zero literals', () => {
      const nodeById = new Map([
        ['pts', { id: 'pts', opId: 'manual_points', params: { x: 5, y: -3 } }],
        ['a', { id: 'a', opId: '__group__', name: 'IslandRegions', params: {} }],
      ])
      const edges = [{ id: 'e1', source: { nodeId: 'pts', port: 'point' }, target: { nodeId: 'a', port: 'in_1' } }]
      const summary = summarizeExecutionResult(fullResult, undefined, { edges, nodeById }) as Record<string, any>
      expect(summary.verification.topologyIssues).toEqual([])
    })
  })
})
