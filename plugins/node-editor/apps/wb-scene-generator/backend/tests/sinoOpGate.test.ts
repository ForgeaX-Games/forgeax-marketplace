import { describe, expect, it } from 'vitest'
import { checkSinoOpAllowlist, isSinoBatch, SINO_TOP_LEVEL_OPID_ALLOWLIST } from '../src/routes/sinoOpGate.js'

describe('isSinoBatch', () => {
  it('detects sino via opts.actor', () => {
    expect(isSinoBatch({ actor: 'ai:sino' }, undefined)).toBe(true)
    expect(isSinoBatch({ actor: 'sino' }, undefined)).toBe(true)
    expect(isSinoBatch({ actor: 'ai:sino-2' }, undefined)).toBe(true)
  })

  it('detects sino via caller agent-id header', () => {
    expect(isSinoBatch(undefined, 'sino')).toBe(true)
    expect(isSinoBatch({ actor: 'ui' }, 'sino')).toBe(true)
  })

  it('is OFF for any non-sino caller (default behaviour preserved)', () => {
    expect(isSinoBatch(undefined, undefined)).toBe(false)
    expect(isSinoBatch({ actor: 'ui' }, undefined)).toBe(false)
    expect(isSinoBatch({ actor: 'editor' }, undefined)).toBe(false)
    expect(isSinoBatch({ actor: 'ai:scene' }, undefined)).toBe(false)
    expect(isSinoBatch({ actor: 'cli' }, 'lowpoly')).toBe(false)
  })
})

describe('checkSinoOpAllowlist', () => {
  it('allows whitelisted top-level createNodes', () => {
    const ops = [
      { type: 'createNode', nodeId: 'seed', opId: 'seed_control', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'out', opId: 'scene_output', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'm', opId: 'tree_merge', position: { x: 0, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e1', source: { nodeId: 'm', port: 'tree' }, target: { nodeId: 'out', port: 'scene' } },
    ]
    expect(checkSinoOpAllowlist(ops)).toBeNull()
  })

  it('rejects a top-level createNode whose opId is outside the whitelist', () => {
    const ops = [
      { type: 'createNode', nodeId: 'bad', opId: 'alg_random_rect_zone_gen', position: { x: 0, y: 0 }, params: {} },
    ]
    const r = checkSinoOpAllowlist(ops)
    expect(r).not.toBeNull()
    expect(r!.opIndex).toBe(0)
    expect(r!.opId).toBe('alg_random_rect_zone_gen')
    expect(r!.reason).toMatch(/sino-op-not-allowed/)
  })

  it('exempts group-private member createNodes (alg_* allowed inside a template group)', () => {
    const ops = [
      // group-private members use arbitrary opIds — exempt because adopted below
      { type: 'createNode', nodeId: 'ar_n1', opId: 'scene_passthrough', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'ar_n2', opId: 'alg_random_rect_zone_gen', position: { x: 0, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'ar_e1', source: { nodeId: 'ar_n1', port: 'scene' }, target: { nodeId: 'ar_n2', port: 'grid' } },
      {
        type: 'createGroup',
        groupId: 'g_arch',
        name: 'ArchitectureRegions',
        memberNodeIds: ['ar_n1', 'ar_n2'],
        position: { x: 0, y: 0 },
        exposedPorts: { inputs: [], outputs: [] },
      },
      // top-level whitelisted utility
      { type: 'createNode', nodeId: 'out', opId: 'scene_output', position: { x: 0, y: 0 }, params: {} },
    ]
    expect(checkSinoOpAllowlist(ops)).toBeNull()
  })

  it('still rejects a non-member alg_* even when other ops include a createGroup', () => {
    const ops = [
      { type: 'createNode', nodeId: 'm1', opId: 'scene_passthrough', position: { x: 0, y: 0 }, params: {} },
      { type: 'createGroup', groupId: 'g', name: 'G', memberNodeIds: ['m1'], position: { x: 0, y: 0 } },
      // NOT a member of any group → must be gated
      { type: 'createNode', nodeId: 'loose', opId: 'alg_topology_connect_points', position: { x: 0, y: 0 }, params: {} },
    ]
    const r = checkSinoOpAllowlist(ops)
    expect(r).not.toBeNull()
    expect(r!.opId).toBe('alg_topology_connect_points')
  })

  it('never gates structural ops (connect/updateNode/deleteGroup/...)', () => {
    const ops = [
      { type: 'connect', edgeId: 'e', source: { nodeId: 'a', port: 'x' }, target: { nodeId: 'b', port: 'y' } },
      { type: 'updateNode', nodeId: 'a', params: { foo: 1 } },
      { type: 'deleteNode', nodeId: 'a' },
      { type: 'deleteGroup', groupId: 'g' },
      { type: 'ungroup', groupId: 'g' },
      { type: 'setMetadata', key: 'viewport', value: {} },
    ]
    expect(checkSinoOpAllowlist(ops)).toBeNull()
  })

  it('whitelist contains the 6-template-group sentinel and core utilities', () => {
    expect(SINO_TOP_LEVEL_OPID_ALLOWLIST.has('__group__')).toBe(true)
    expect(SINO_TOP_LEVEL_OPID_ALLOWLIST.has('seed_control')).toBe(true)
    expect(SINO_TOP_LEVEL_OPID_ALLOWLIST.has('tree_merge')).toBe(true)
    expect(SINO_TOP_LEVEL_OPID_ALLOWLIST.has('scene_output')).toBe(true)
    expect(SINO_TOP_LEVEL_OPID_ALLOWLIST.has('alg_random_rect_zone_gen')).toBe(false)
  })
})
