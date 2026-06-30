import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { tools } from '../src/tool-handlers.js'

let root: string
let portsFile: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wb-scene-tools-'))
  portsFile = join(root, 'plugin-dev-ports.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function ctx(toolId: string) {
  return {
    caller: { kind: 'ai' as const },
    toolId,
    env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
    cwd: process.cwd(),
  }
}

describe('ToolRegistry scene handlers', () => {
  it('uses the Studio plugin dev backendPort override when proxying tool calls', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { frontendPort: 5001, backendPort: port } } }),
    )

    try {
      const result = await tools['scene:projects.list']({}, ctx('scene:projects.list'))

      expect(result).toEqual([
        expect.objectContaining({ id: 'main', type: 'scene', name: 'Default Scene' }),
      ])
    } finally {
      await app.close()
    }
  })

  it('resolves a single battery and exposes renderer metadata', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const all = await tools['scene:batteries.list']({}, ctx('scene:batteries.list')) as Array<{ id: string }>
      expect(all.length).toBeGreaterThan(0)

      const one = await tools['scene:batteries.get']({ id: all[0].id }, ctx('scene:batteries.get'))
      expect(one).toEqual(expect.objectContaining({ id: all[0].id }))

      const renderer = await tools['scene:renderer.info']({}, ctx('scene:renderer.info'))
      expect(renderer).toEqual(expect.objectContaining({ pane: 'renderer', paneUrl: '/?pane=renderer' }))
    } finally {
      await app.close()
    }
  })
})
