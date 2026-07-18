import { describe, expect, it } from 'vitest'
import {
  checkSinoOpAllowlist,
  filterComposerUtilityOps,
  isSinoBatch,
  SINO_FORBIDDEN_BATCH_TYPES,
  SINO_TOP_LEVEL_OPID_ALLOWLIST,
} from '../src/routes/sinoOpGate.js'

describe('isSinoBatch', () => {
  it('detects sino via opts.actor', () => {
    expect(isSinoBatch({ actor: 'ai:sino' }, undefined)).toBe(true)
    expect(isSinoBatch({ actor: 'sino' }, undefined)).toBe(true)
  })

  it('detects sino via caller agent-id header', () => {
    expect(isSinoBatch(undefined, 'sino')).toBe(true)
    expect(isSinoBatch({ actor: 'ui' }, 'sino-whitebox')).toBe(true)
  })

  it('is OFF for non-sino callers', () => {
    expect(isSinoBatch(undefined, undefined)).toBe(false)
    expect(isSinoBatch({ actor: 'editor' }, undefined)).toBe(false)
  })
})

describe('checkSinoOpAllowlist', () => {
  it('allows whitelisted composer utilities + connect', () => {
    const ops = [
      { type: 'createNode', nodeId: 'seed', opId: 'seed_control', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'out', opId: 'scene_output', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'm', opId: 'tree_merge', position: { x: 0, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'm', port: 'tree' }, target: { nodeId: 'out', port: 'scene' } },
    ]
    expect(checkSinoOpAllowlist(ops)).toBeNull()
  })

  it('rejects template-internal opIds at top level', () => {
    for (const opId of ['alg_random_rect_zone_gen', 'rect_grid', 'grid2node', 'add_child']) {
      const ops = [{ type: 'createNode', nodeId: 'bad', opId, position: { x: 0, y: 0 }, params: {} }]
      const r = checkSinoOpAllowlist(ops)
      expect(r?.opId).toBe(opId)
      expect(r?.fix).toMatch(/instantiateTemplate|composerUtilities/)
    }
  })

  it('rejects createGroup even when batch includes group-private members (no hand-built templates)', () => {
    const ops = [
      {
        type: 'createGroup',
        groupId: 'g_arch',
        name: 'HandBuilt',
        memberNodeIds: ['ar_n1', 'ar_n2'],
        position: { x: 0, y: 0 },
        exposedPorts: { inputs: [], outputs: [] },
      },
      { type: 'createNode', nodeId: 'ar_n1', opId: 'scene_passthrough', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'ar_n2', opId: 'alg_random_rect_zone_gen', position: { x: 0, y: 0 }, params: {} },
    ]
    const r = checkSinoOpAllowlist(ops)
    expect(r?.opId).toBe('createGroup')
    expect(SINO_FORBIDDEN_BATCH_TYPES.has('createGroup')).toBe(true)
  })

  it('allows POI derivation utilities for PathConnection wiring', () => {
    for (const opId of ['scene_focus_path', 'node_explode', 'building_footprint_mask']) {
      expect(SINO_TOP_LEVEL_OPID_ALLOWLIST.has(opId)).toBe(true)
    }
  })

  it('allows scene_focus_children for sub-zone fanout (AreaPartition output consumption)', () => {
    expect(SINO_TOP_LEVEL_OPID_ALLOWLIST.has('scene_focus_children')).toBe(true)
  })

  it('rejects template-private / structural opIds from allowlist', () => {
    for (const opId of ['scene_passthrough', '__group__', 'rect_grid', 'grid2node']) {
      expect(SINO_TOP_LEVEL_OPID_ALLOWLIST.has(opId)).toBe(false)
    }
  })

  it('never gates structural connect/update/delete ops', () => {
    const ops = [
      { type: 'connect', edgeId: 'e', source: { nodeId: 'a', port: 'x' }, target: { nodeId: 'b', port: 'y' } },
      { type: 'updateNode', nodeId: 'a', params: { foo: 1 } },
      { type: 'deleteNode', nodeId: 'a' },
      { type: 'deleteEdge', edgeId: 'e' },
    ]
    expect(checkSinoOpAllowlist(ops)).toBeNull()
  })
})

describe('filterComposerUtilityOps', () => {
  it('filterComposerUtilityOps returns only allowlisted ops from full catalog', () => {
    const catalog = [
      { id: 'text_panel', name: 'Text' },
      { id: 'rect_grid', name: 'Grid' },
      { id: 'tree_merge', name: 'Merge' },
      { id: 'scene_focus_path', name: 'Focus' },
      { id: 'node_explode', name: 'Explode' },
      { id: 'building_footprint_mask', name: 'Mask' },
    ]
    const filtered = filterComposerUtilityOps(catalog)
    expect(filtered.map((o) => o.id)).toEqual([
      'text_panel',
      'tree_merge',
      'scene_focus_path',
      'node_explode',
      'building_footprint_mask',
    ])
  })
})
