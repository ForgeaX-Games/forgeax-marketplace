import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { resetRuntimeForTests } from '../src/runtime.js'
import { compactPipeline, guardApplyBatchSize, tools } from '../src/tool-handlers.js'

let root: string
let portsFile: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wb3d-tools-'))
  portsFile = join(root, 'plugin-dev-ports.json')
  process.env.FORGEAX_PROJECT_ROOT = root
})

afterEach(() => {
  resetRuntimeForTests()
  rmSync(root, { recursive: true, force: true })
  delete process.env.FORGEAX_PROJECT_ROOT
})

describe('ToolRegistry lowpoly handlers', () => {
  it('keeps legacy pipeline/battery tools out of the AI manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../forgeax-plugin.json', import.meta.url), 'utf8'))
    const entries = manifest.provides.tools as Array<{ id: string; exposedToAI: boolean }>
    const legacy = entries.filter((entry) => /lowpoly:(?:batteries|pipeline)\./u.test(entry.id))
    expect(legacy.length).toBeGreaterThan(0)
    expect(legacy.every((entry) => entry.exposedToAI === false)).toBe(true)
    expect(entries.find((entry) => entry.id === 'lowpoly:model.bakeBatch')?.exposedToAI).toBe(true)
    expect(entries.find((entry) => entry.id === 'lowpoly:model.patch')?.exposedToAI).toBe(true)
  })

  it('registers the batch and source-hash patch handlers', () => {
    expect(tools['lowpoly:model.bakeBatch']).toBeTypeOf('function')
    expect(tools['lowpoly:model.patch']).toBeTypeOf('function')
  })

  it('uses the Studio plugin dev backendPort override when proxying tool calls', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-3d-lowpoly': { frontendPort: 5001, backendPort: port } } }),
    )

    try {
      const result = await tools['lowpoly:projects.list'](
        {},
        {
          caller: { kind: 'ai' },
          toolId: 'lowpoly:projects.list',
          env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
          cwd: process.cwd(),
        },
      )

      expect(result).toEqual([
        expect.objectContaining({ id: 'main', type: 'lowpoly', name: 'Default Lowpoly' }),
      ])
    } finally {
      await app.close()
    }
  })

  it('resolves a single battery by op id', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-3d-lowpoly': { backendPort: port } } }),
    )

    try {
      const all = await tools['lowpoly:batteries.list'](
        {},
        {
          caller: { kind: 'ai' },
          toolId: 'lowpoly:batteries.list',
          env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
          cwd: process.cwd(),
        },
      ) as Array<Record<string, unknown>>
      expect(all.length).toBeGreaterThan(0)

      // `list` must stay a COMPACT catalog: the full op catalog is ~200k+ tokens
      // and overflows the model context on the next turn (calling batteries.list
      // used to reliably end the run with reason:'error'). No inline icons, and
      // ports are projected to bare name strings — never the full bilingual port
      // objects (which carry description/descriptionEn/label/default).
      for (const op of all) {
        expect(op).not.toHaveProperty('iconSvg')
        if (op.inputs !== undefined) {
          expect(Array.isArray(op.inputs)).toBe(true)
          for (const p of op.inputs as unknown[]) expect(typeof p).toBe('string')
        }
        if (op.outputs !== undefined) {
          expect(Array.isArray(op.outputs)).toBe(true)
          for (const p of op.outputs as unknown[]) expect(typeof p).toBe('string')
        }
      }

      const one = (await tools['lowpoly:batteries.get'](
        { id: all[0].id as string },
        {
          caller: { kind: 'ai' },
          toolId: 'lowpoly:batteries.get',
          env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
          cwd: process.cwd(),
        },
      )) as Record<string, unknown>
      expect(one).toEqual(expect.objectContaining({ id: all[0].id }))
      // `get` stays FULL detail: ports keep their structured (object) form so an
      // agent can read types/defaults/descriptions for the op it chose.
      const detailInputs = one.inputs
      if (Array.isArray(detailInputs) && detailInputs.length > 0) {
        expect(typeof detailInputs[0]).toBe('object')
      }
    } finally {
      await app.close()
    }
  })
})

describe('compactPipeline', () => {
  it('drops per-node position + redundant id but keeps opId/params/edges', () => {
    const snapshot = {
      id: 'p1',
      hash: 'abc',
      createdAt: 't0',
      updatedAt: 't1',
      nodes: {
        n1: { id: 'n1', opId: 'g_box', position: { x: 260, y: 0 }, params: { size: [1, 1, 1] }, status: 'completed' },
        n2: { id: 'n2', opId: 'g_part', position: { x: 520, y: 160 }, params: {} },
      },
      edges: {
        e1: { id: 'e1', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'shape' } },
      },
    }
    const out = compactPipeline(snapshot) as Record<string, any>

    // Node projection: layout + duplicate id gone, modeling fields verbatim.
    expect(out.nodes.n1).not.toHaveProperty('position')
    expect(out.nodes.n1).not.toHaveProperty('id')
    expect(out.nodes.n1).toEqual({ opId: 'g_box', params: { size: [1, 1, 1] }, status: 'completed' })
    expect(out.nodes.n2).toEqual({ opId: 'g_part', params: {} })

    // Top-level graph metadata + edges pass through untouched (the agent wires by
    // node id, which survives as the nodes-map key), plus a discoverable marker.
    expect(out.id).toBe('p1')
    expect(out.hash).toBe('abc')
    expect(out.edges).toEqual(snapshot.edges)
    expect(out.projected).toBe(true)
  })

  it('passes non-graph / empty payloads through unchanged', () => {
    expect(compactPipeline(null)).toBeNull()
    expect(compactPipeline({ nodes: {} })).toEqual({ nodes: {}, projected: true })
    expect(compactPipeline({ error: 'not found' })).toEqual({ error: 'not found' })
  })
})

describe('guardApplyBatchSize', () => {
  it('passes a normal multi-node batch with small profiles', () => {
    const batch = {
      ops: [
        { type: 'createNode', nodeId: 'bp_prof', opId: 'g_profile_rounded_rect', params: { w: 0.2, d: 0.08, radius: 0.01 } },
        // A hand-authored polygon: a short flat point list is fine.
        { type: 'createNode', nodeId: 'bs_prof', opId: 'g_profile_polygon', params: { points: [0, 0, 0.02, 0, 0.02, 0.03, 0, 0.03] } },
        { type: 'createNode', nodeId: 'am_bp', opId: 'g_mesh', params: { filename: '1b261c36abcdef.obj', scale: 1 } },
      ],
    }
    expect(() => guardApplyBatchSize(batch)).not.toThrow()
  })

  it('rejects an op param that inlines a large numeric buffer', () => {
    // 3000 numbers = a vertex/point buffer that belongs in a baked OBJ, not params.
    const points = Array.from({ length: 3000 }, (_, i) => i * 0.001)
    const batch = { ops: [{ type: 'createNode', nodeId: 'm', opId: 'g_profile_polygon', params: { points } }] }
    expect(() => guardApplyBatchSize(batch)).toThrow(/inline numeric array of 3000/)
    expect(() => guardApplyBatchSize(batch)).toThrow(/g_bake_part/)
  })

  it('finds an oversized buffer nested inside vertices/indices objects', () => {
    const verts = Array.from({ length: 2048 }, () => 0.5)
    const batch = { ops: [{ type: 'updateNode', nodeId: 'm', params: { mesh: { vertices: verts, indices: [0, 1, 2] } } }] }
    expect(() => guardApplyBatchSize(batch)).toThrow(/inline numeric array of 2048/)
  })

  it('does not false-positive on a moderate array of non-numbers (e.g. id list)', () => {
    const ids = Array.from({ length: 2000 }, (_, i) => `node_${i}`)
    const batch = { ops: [{ type: 'updateNode', nodeId: 'm', params: { children: ids } }] }
    // A string id list is not a geometry buffer, and stays well under the total
    // backstop — the numeric-buffer guard must not trip on it.
    expect(() => guardApplyBatchSize(batch)).not.toThrow()
  })

  it('trips the total-size backstop on bulk inlined data the per-array cap misses', () => {
    // Many arrays each just under the numeric-element cap → no single oversized
    // array, but the batch as a whole is huge.
    const chunk = () => Array.from({ length: 1000 }, () => 0.123456)
    const ops = Array.from({ length: 20 }, (_, i) => ({ type: 'updateNode', nodeId: `n${i}`, params: { pts: chunk() } }))
    expect(() => guardApplyBatchSize({ ops })).toThrow(/serializes to \d+ chars/)
  })
})
