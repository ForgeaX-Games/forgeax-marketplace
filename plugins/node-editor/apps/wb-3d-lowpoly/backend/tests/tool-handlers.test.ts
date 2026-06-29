import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { resetRuntimeForTests } from '../src/runtime.js'
import { tools } from '../src/tool-handlers.js'

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
      ) as Array<{ id: string }>
      expect(all.length).toBeGreaterThan(0)

      const one = await tools['lowpoly:batteries.get'](
        { id: all[0].id },
        {
          caller: { kind: 'ai' },
          toolId: 'lowpoly:batteries.get',
          env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
          cwd: process.cwd(),
        },
      )
      expect(one).toEqual(expect.objectContaining({ id: all[0].id }))
    } finally {
      await app.close()
    }
  })
})
