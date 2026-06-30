import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'

let app: Awaited<ReturnType<typeof buildApp>>
let projectRoot: string

beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wb-3d-common-test-'))
  process.env.FORGEAX_PROJECT_ROOT = projectRoot
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('common batteries', () => {
  it('exposes shared common batteries in the catalog with stable op ids', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/ops' })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toContainEqual(expect.objectContaining({
      id: 'number_const',
      category: 'common/input',
      type: 'common',
      nodeType: 'number_const',
    }))
    expect(r.json()).toContainEqual(expect.objectContaining({
      id: 'tree_merge',
      category: 'common/datatree',
      type: 'common',
    }))
  })

  it('creates and executes a common range_list battery through the API', async () => {
    const batch = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        ops: [
          { type: 'createNode', nodeId: 'range', opId: 'range_list', position: { x: 0, y: 0 }, params: { start: 1, end: 3, step: 1 } },
        ],
      },
    })
    expect(batch.json().status).toBe('ok')

    const exec = await app.inject({ method: 'POST', url: '/api/v1/execute', payload: { nodeId: 'range' } })
    expect(exec.statusCode).toBe(200)
    expect(exec.json()).toMatchObject({ status: 'completed' })
    expect(exec.json().outputs.range.list).toEqual([
      { path: [0, 0], items: [1] },
      { path: [0, 1], items: [2] },
      { path: [0, 2], items: [3] },
    ])
  })

  it('persists AI/CLI batch labels and caller batch ids in history', async () => {
    const batch = await app.inject({
      method: 'POST',
      url: '/api/v1/batch',
      payload: {
        ops: [
          { type: 'createNode', nodeId: 'labeled', opId: 'relu', position: { x: 0, y: 0 }, params: { value: 1 } },
        ],
        opts: { actor: 'ai:staged', label: 'Stage 1: labeled batch', batchId: 'stage-batch-1' },
      },
    })
    expect(batch.json()).toMatchObject({ status: 'ok', batchId: 'stage-batch-1' })

    const history = await app.inject({ method: 'GET', url: '/api/v1/history' })
    expect(history.json()).toContainEqual(expect.objectContaining({
      actor: 'ai:staged',
      label: 'Stage 1: labeled batch',
      batchId: 'stage-batch-1',
    }))
  })
})
