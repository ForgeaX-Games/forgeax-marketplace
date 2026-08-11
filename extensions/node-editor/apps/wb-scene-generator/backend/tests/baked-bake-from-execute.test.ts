import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { applyBatch } from '@forgeax/node-runtime'
import { getRuntimeForProject } from '../src/runtime.js'

// Isolated workspace — module-level singleton registry (see runtime.ts), must be
// set before the first buildApp()/getRuntime() call in this file.
const ws = mkdtempSync(join(tmpdir(), 'baked-bake-from-execute-'))
process.env.FORGEAX_PROJECT_ROOT = ws

describe('POST /api/v1/projects/:id/baked/bake-from-execute', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    const { buildApp } = await import('../src/main.js')
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('rejects with 422 when the empty graph has nothing to bake (either execute status or zero layers)', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/projects/main/baked/bake-from-execute' })
    expect(r.statusCode).toBe(422)
    expect(r.json().error).toMatch(/did not complete|zero scene layers/)
  })

  it('rejects with 422 when execute completes but the scene subtree has zero cells to bake', async () => {
    const batch = await applyBatch(await getRuntimeForProject('main'), [
          {
            type: 'createNode',
            nodeId: 'empty_g2n',
            opId: 'grid2node',
            position: { x: 0, y: 0 },
            params: { name: 'Empty', grid: [[0, 0], [0, 0]] },
          },
        ], { actor: 'test-runtime-fixture' })
    expect(batch.status).toBe('ok')

    const bake = await app.inject({ method: 'POST', url: '/api/v1/projects/main/baked/bake-from-execute' })
    expect(bake.statusCode).toBe(422)
    expect(bake.json().error).toMatch(/zero scene layers/)

    await applyBatch(await getRuntimeForProject('main'), [{ type: 'deleteNode', nodeId: 'empty_g2n' }], {
      actor: 'test-runtime-fixture',
    })
  })

  it('executes the graph, snapshots scene output ports into baked layers, and bakes them', async () => {
    const batch = await applyBatch(await getRuntimeForProject('main'), [
          {
            type: 'createNode',
            nodeId: 'g2n',
            opId: 'grid2node',
            position: { x: 0, y: 0 },
            params: { name: 'House', grid: [[1, 1], [1, 1]] },
          },
        ], { actor: 'test-runtime-fixture' })
    expect(batch.status).toBe('ok')

    const bake = await app.inject({ method: 'POST', url: '/api/v1/projects/main/baked/bake-from-execute' })
    expect(bake.statusCode, bake.body).toBe(200)
    const body = bake.json() as { paths: string[]; layerCount: number; executionId: string }
    expect(body.layerCount).toBeGreaterThan(0)
    expect(body.paths).toEqual(expect.arrayContaining(['/House']))

    const layers = await app.inject({ method: 'GET', url: '/api/v1/projects/main/baked/layers' })
    expect(layers.statusCode).toBe(200)
    const houseLayer = (layers.json().layers as Array<{ nodePath: string; cells: unknown[] }>).find(
      (l) => l.nodePath === '/House',
    )
    expect(houseLayer).toBeTruthy()
    expect(houseLayer!.cells.length).toBe(4)
  })
})
