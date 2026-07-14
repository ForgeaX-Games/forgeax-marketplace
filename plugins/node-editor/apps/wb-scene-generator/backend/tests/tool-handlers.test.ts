import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { tools } from '../src/tool-handlers.js'

// 复盘(2026-07-01):runtime.ts 的 ProjectRegistry 是模块级单例，`resolveWorkspaceRoot()`
// 只在它首次被 buildApp() 触发初始化时读一次 FORGEAX_PROJECT_ROOT——本文件之前从未设置，
// 于是每次跑测试都会在 REPO 里真实的 `.forgeax-runtime`（而不是每个 test 的 tmp root）
// 下创建一个个"Lock Drift Test" project 且永不清理，长期跑测试会真实累积磁盘占用，还会
// 污染 scene:projects.list 让下游依赖"只有 main 项目"的测试随机失败。这里在模块加载时
// （即本文件任何 buildApp() 调用之前）设一次隔离 tmpdir，与 scene-export-routes.test.ts
// 等文件的既有约定一致（单例只在整个文件第一次用到时读一次，per-test 重设不生效）。
process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-scene-tools-runtime-'))

let root: string
let portsFile: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wb-scene-tools-'))
  portsFile = join(root, 'plugin-dev-ports.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function ctx(toolId: string, agentId?: string) {
  return {
    caller: { kind: 'ai' as const, ...(agentId ? { agentId } : {}) },
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
      JSON.stringify({ plugins: { '@forgeax-extension/wb-scene-generator': { frontendPort: 5001, backendPort: port } } }),
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
      JSON.stringify({ plugins: { '@forgeax-extension/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const all = await tools['scene:batteries.list']({}, ctx('scene:batteries.list')) as Array<{ id: string }>
      expect(all.length).toBeGreaterThan(0)

      const one = await tools['scene:batteries.get']({ id: all[0].id }, ctx('scene:batteries.get'))
      expect(one).toEqual(expect.objectContaining({ id: all[0].id }))

      const composer = await tools['scene:composerUtilities.list']({}, ctx('scene:composerUtilities.list')) as Array<{ id: string }>
      expect(composer.length).toBeGreaterThan(0)
      expect(composer.length).toBeLessThan(all.length)
      expect(composer.every((op) => !op.id.startsWith('alg_'))).toBe(true)

      const util = await tools['scene:composerUtilities.get']({ id: 'tree_merge' }, ctx('scene:composerUtilities.get'))
      expect(util).toEqual(expect.objectContaining({ id: 'tree_merge' }))

      await expect(
        tools['scene:composerUtilities.get']({ id: 'rect_grid' }, ctx('scene:composerUtilities.get')),
      ).rejects.toThrow(/not exposed/)

      const renderer = await tools['scene:renderer.info']({}, ctx('scene:renderer.info'))
      expect(renderer).toEqual(expect.objectContaining({ pane: 'renderer', paneUrl: '/?pane=renderer' }))
    } finally {
      await app.close()
    }
  })

  it('rejects pipeline.get without projectId for AI when no agent lock is held', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-extension/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      await expect(tools['scene:pipeline.get']({}, ctx('scene:pipeline.get', 'unlocked-agent')))
        .rejects.toThrow(/missing projectId/i)
    } finally {
      await app.close()
    }
  })

  it('resolves pipeline.get from agent lock, not viewingProjectId', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-extension/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const created = await tools['scene:projects.create'](
        { name: 'Lock Drift Test' },
        ctx('scene:projects.create'),
      ) as { id?: string }
      const otherId = created.id
      expect(otherId).toBeTruthy()

      const agentId = 'lock-drift-agent'
      await tools['scene:projects.open']({ id: otherId! }, ctx('scene:projects.open', agentId))
      const graph = await tools['scene:pipeline.get']({}, ctx('scene:pipeline.get', agentId)) as { id?: string }
      expect(graph?.id).toBe(otherId)
    } finally {
      await app.close()
    }
  })

  it('accepts explicit projectId on pipeline.execute after open', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-extension/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const agentId = 'test-agent'
      await tools['scene:projects.open']({ id: 'main' }, ctx('scene:projects.open', agentId))
      const summary = await tools['scene:pipeline.execute'](
        { projectId: 'main', narrativeLocationNames: ['Default Scene'] },
        ctx('scene:pipeline.execute', agentId),
      ) as { status?: string }
      expect(summary.status).toBeDefined()
    } finally {
      await app.close()
    }
  })

  // 复盘(2026-07-01 sino bake/export 工具缺口):agent 侧路径——不是直接打后端路由，
  // 是走 tool-handlers 的 HTTP 代理，确认两个新工具能正确转发到新路由。
  it('bakeFromExecute + sceneExport.cook: agent-facing M7 bake/export tools proxy correctly', async () => {
    const app = await buildApp()
    await app.listen({ host: '127.0.0.1', port: 0 })
    const addr = app.server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    writeFileSync(
      portsFile,
      JSON.stringify({ plugins: { '@forgeax-extension/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const agentId = 'bake-tool-agent'
      // Own project (not 'main') — 'main' may still be locked by an earlier test
      // in this file's shared registry singleton (see FORGEAX_PROJECT_ROOT note above).
      const created = await tools['scene:projects.create'](
        { name: 'Bake Tool Test' },
        ctx('scene:projects.create'),
      ) as { id?: string }
      const projectId = created.id!
      expect(projectId).toBeTruthy()
      await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentId))
      await tools['scene:pipeline.applyBatch'](
        {
          projectId,
          ops: [
            {
              type: 'createNode',
              nodeId: 'g2n_tool',
              opId: 'grid2node',
              position: { x: 0, y: 0 },
              params: { name: 'ToolHouse', grid: [[1, 1]] },
            },
          ],
        },
        ctx('scene:pipeline.applyBatch', agentId),
      )

      const baked = await tools['scene:baked.bakeFromExecute'](
        { projectId },
        ctx('scene:baked.bakeFromExecute', agentId),
      ) as { paths?: string[]; layerCount?: number }
      expect(baked.layerCount).toBeGreaterThan(0)
      expect(baked.paths).toEqual(expect.arrayContaining(['/ToolHouse']))

      const cooked = await tools['scene:sceneExport.cook'](
        { projectId, sceneName: 'Tool Export Demo' },
        ctx('scene:sceneExport.cook', agentId),
      ) as { bundleId?: string; downloadUrl?: string; warnings?: unknown[] }
      expect(cooked.bundleId).toMatch(/^tool-export-demo-/)
      expect(cooked.downloadUrl).toBeTruthy()
    } finally {
      await app.close()
    }
  })

  it('rejects AI pipeline.execute without narrativeLocationNames when no run dir', async () => {
    await expect(
      tools['scene:pipeline.execute'](
        { projectId: 'p_unknown_project' },
        ctx('scene:pipeline.execute', 'no-names-agent'),
      ),
    ).rejects.toThrow(/narrativeLocationNames/)
  })

})
