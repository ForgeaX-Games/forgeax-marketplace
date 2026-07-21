import { describe, expect, it } from 'vitest'
import {
  analyzeRestChainTopology,
  buildTopologyIssues,
  detectIllegalLocalMerge,
  formatLocalMergeViolation,
  type TopologyGraphEdge,
  type TopologyGraphNode,
} from '../src/lib/topologyGate.js'

function group(name: string): TopologyGraphNode {
  return { opId: '__group__', name, params: {} }
}

describe('analyzeRestChainTopology', () => {
  it('is ok (not a violation) when there is no AddBaseGrid group at all', () => {
    const nodeById = new Map<string, TopologyGraphNode>([['a', group('IslandRegions')]])
    const report = analyzeRestChainTopology([], nodeById)
    expect(report.ok).toBe(true)
    expect(report.addBaseGridNodeId).toBeNull()
  })

  it('does not flag a single AddBaseGrid.out_1 -> one template group connection', () => {
    const nodeById = new Map<string, TopologyGraphNode>([
      ['grid', group('AddBaseGrid')],
      ['a', group('IslandRegions')],
    ])
    const edges: TopologyGraphEdge[] = [
      { id: 'e1', source: { nodeId: 'grid', port: 'out_1' }, target: { nodeId: 'a', port: 'in_0' } },
    ]
    expect(analyzeRestChainTopology(edges, nodeById).ok).toBe(true)
  })

  it('flags a Rest-chain fan-out one level downstream (group A Rest output feeding two siblings)', () => {
    const nodeById = new Map<string, TopologyGraphNode>([
      ['grid', group('AddBaseGrid')],
      ['a', group('IslandRegions')],
      ['b', group('LakeRegions')],
      ['c', group('SiheyuanCourtyard')],
    ])
    const edges: TopologyGraphEdge[] = [
      { id: 'e0', source: { nodeId: 'grid', port: 'out_1' }, target: { nodeId: 'a', port: 'in_0' } },
      // a's Rest output (out_2, by convention) fans out to BOTH b and c — illegal.
      { id: 'e1', source: { nodeId: 'a', port: 'out_2' }, target: { nodeId: 'b', port: 'in_0' } },
      { id: 'e2', source: { nodeId: 'a', port: 'out_2' }, target: { nodeId: 'c', port: 'in_0' } },
    ]
    const report = analyzeRestChainTopology(edges, nodeById)
    expect(report.ok).toBe(false)
    expect(report.restFanOutViolations).toHaveLength(1)
    expect(report.restFanOutViolations[0]!.sourceNodeId).toBe('a')
    expect(report.restFanOutViolations[0]!.consumers).toHaveLength(2)
  })

  it('does not treat preview/export merge targets (item_N ports) as Rest-chain consumers', () => {
    const nodeById = new Map<string, TopologyGraphNode>([
      ['grid', group('AddBaseGrid')],
      ['a', group('IslandRegions')],
      ['m0_merge', { opId: 'tree_merge', params: {} }],
    ])
    const edges: TopologyGraphEdge[] = [
      { id: 'e1', source: { nodeId: 'grid', port: 'out_1' }, target: { nodeId: 'a', port: 'in_0' } },
      { id: 'e2', source: { nodeId: 'a', port: 'out_0' }, target: { nodeId: 'm0_merge', port: 'item_0' } },
    ]
    expect(analyzeRestChainTopology(edges, nodeById).ok).toBe(true)
  })
})

describe('detectIllegalLocalMerge', () => {
  it('does not flag a tree_merge with only a single item source', () => {
    const nodeById = new Map<string, TopologyGraphNode>([
      ['a', group('IslandRegions')],
      ['m', { opId: 'tree_merge', params: {} }],
    ])
    const edges: TopologyGraphEdge[] = [
      { id: 'e1', source: { nodeId: 'a', port: 'out_0' }, target: { nodeId: 'm', port: 'item_0' } },
    ]
    expect(detectIllegalLocalMerge(edges, nodeById, null)).toEqual([])
  })

  it('does not flag the root merge itself even with 2+ item sources', () => {
    const nodeById = new Map<string, TopologyGraphNode>([
      ['a', group('IslandRegions')],
      ['b', group('LakeRegions')],
      ['root', { opId: 'tree_merge', params: { portCount: 2 } }],
    ])
    const edges: TopologyGraphEdge[] = [
      { id: 'e1', source: { nodeId: 'a', port: 'out_0' }, target: { nodeId: 'root', port: 'item_0' } },
      { id: 'e2', source: { nodeId: 'b', port: 'out_0' }, target: { nodeId: 'root', port: 'item_1' } },
    ]
    expect(detectIllegalLocalMerge(edges, nodeById, 'root')).toEqual([])
  })
})

describe('formatLocalMergeViolation', () => {
  it('omits suggestedOps (but still gives reason/fix) when the root merge portCount is not readable', () => {
    const nodeById = new Map<string, TopologyGraphNode>([
      ['a', group('IslandRegions')],
      ['b', group('LakeRegions')],
      ['root', { opId: 'tree_merge', params: {} }], // no portCount on root
    ])
    const violation = {
      mergeNodeId: 'local',
      itemCount: 2,
      sources: [
        { nodeId: 'a', batteryName: 'IslandRegions', port: 'out_0' },
        { nodeId: 'b', batteryName: 'LakeRegions', port: 'out_0' },
      ],
    }
    const { reason, fix, suggestedOps } = formatLocalMergeViolation(violation, nodeById, 'root')
    expect(reason).toContain('local')
    expect(fix).toBeTruthy()
    expect(suggestedOps).toBeUndefined()
  })
})

describe('buildTopologyIssues', () => {
  it('always returns an array, never throws on an empty graph', () => {
    expect(buildTopologyIssues([], new Map())).toEqual([])
  })
})
