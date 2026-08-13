import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { formatExecuteVerificationFailure, summarizeProjectOpen, tools } from '../src/tool-handlers.js'
import { applyBatch } from '@forgeax/node-runtime'
import { getRuntimeForProject } from '../src/runtime.js'

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

function ctx(toolId: string, agentId?: string, kind: 'ai' | 'user' = 'ai') {
  return {
    caller: { kind, ...(agentId ? { agentId } : {}) },
    toolId,
    env: { FORGEAX_PLUGIN_DEV_PORTS_FILE: portsFile },
    cwd: process.cwd(),
  }
}

describe('ToolRegistry scene handlers', () => {
  it('keeps AI project-open results to project and pipeline state', () => {
    expect(summarizeProjectOpen({
      project: { id: 'p1', name: 'Town', type: 'scene', description: 'large' },
      pipeline: { id: 'pipe1', hash: 'abc', nodes: { a: {}, b: {} }, edges: { e: {} } },
      workspace: { projects: [{ id: 'other' }] },
      openMode: 'shared',
      writeLockedBy: 'other-agent',
    })).toEqual({
      project: { id: 'p1', name: 'Town', type: 'scene' },
      pipeline: { id: 'pipe1', hash: 'abc', nodeCount: 2, edgeCount: 1 },
      openMode: 'shared',
      writeLockedBy: 'other-agent',
    })
  })

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

  it('keeps only the human battery catalog and renderer metadata', async () => {
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

      expect(tools).not.toHaveProperty('scene:composerUtilities.list')
      expect(tools).not.toHaveProperty('scene:composerUtilities.get')
      expect(tools).not.toHaveProperty('scene:templates.list')
      expect(tools).not.toHaveProperty('scene:templates.get')
      expect(tools).not.toHaveProperty('scene:pipeline.instantiateTemplate')
      expect(tools).not.toHaveProperty('scene:pipeline.applyBatch')
      expect(tools).not.toHaveProperty('scene:pipeline.import')

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
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
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
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
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
      const graph = await tools['scene:pipeline.get']({}, ctx('scene:pipeline.get', agentId)) as {
        id?: string
        hashOnly?: boolean
        nodes?: unknown[]
      }
      expect(graph?.id).toBe(otherId)
      expect(graph?.hashOnly).toBe(true)
      expect(graph?.nodes).toBeUndefined()
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
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
    )

    try {
      const agentId = 'test-agent'
      await tools['scene:projects.open']({ id: 'main' }, ctx('scene:projects.open', agentId))
      const summary = await tools['scene:pipeline.execute'](
        { projectId: 'main', narrativeLocationNames: ['Default Scene'] },
        ctx('scene:pipeline.execute', agentId),
      ) as { status?: string; outputs?: unknown }
      expect(summary.status).toBeDefined()
      expect(summary.outputs).toBeUndefined()
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
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
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
      await applyBatch(
        await getRuntimeForProject(projectId),
        [
            {
              type: 'createNode',
              nodeId: 'g2n_tool',
              opId: 'grid2node',
              position: { x: 0, y: 0 },
              params: { name: 'ToolHouse', grid: [[1, 1]] },
            },
          ],
        { actor: 'test-runtime-fixture' },
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

  // Shared open + write write lock: many agents may open/analyze; only writers queue.
  describe('scene:projects.open shared + write write lock', () => {
    async function withApp(fn: (portsFile: string) => Promise<void>) {
      const app = await buildApp()
      await app.listen({ host: '127.0.0.1', port: 0 })
      const addr = app.server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(
        portsFile,
        JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
      )
      try {
        await fn(portsFile)
      } finally {
        await app.close()
      }
    }

    it('two agents can both open the same project for analysis', async () => {
      await withApp(async () => {
        const created = await tools['scene:projects.create'](
          { name: 'Shared Open Test' },
          ctx('scene:projects.create'),
        ) as { id?: string }
        const projectId = created.id!
        const agentA = 'queue-test-a-1'
        const agentB = 'queue-test-b-1'

        const openA = await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentA)) as {
          openMode?: string
        }
        const openB = await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentB)) as {
          openMode?: string
        }
        expect(openA.openMode).toBe('shared')
        expect(openB.openMode).toBe('shared')

        // Soft open alone does not take the write lock — queue stays empty.
        const status = await tools['scene:projects.queue.status'](
          { id: projectId },
          ctx('scene:projects.queue.status', agentB),
        ) as { queue: unknown[] }
        expect(status.queue).toEqual([])

        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentA))
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentB))
      })
    })

    it('mutation waits for write lock while peer may keep analyzing via open', async () => {
      await withApp(async () => {
        const created = await tools['scene:projects.create'](
          { name: 'Write Wait Test' },
          ctx('scene:projects.create'),
        ) as { id?: string }
        const projectId = created.id!
        const agentA = 'queue-test-a-2'
        const agentB = 'queue-test-b-2'

        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentA))
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentB))

        // A claims write via the canonical Scene Script mutation.
        await tools['scene:script.put'](
          { projectId, source: 'const root = emptyScene({})\nsceneOutput({ scene: root.scene })' },
          ctx('scene:script.put', agentA),
        )

        // B can still soft-open / stay attached — open is shared.
        await expect(
          tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentB)),
        ).resolves.toMatchObject({ openMode: 'shared' })

        const pending = tools['scene:script.put'](
          { projectId, source: 'const root = emptyScene({})\nsceneOutput({ scene: root.scene })' },
          ctx('scene:script.put', agentB),
        )
        await new Promise((r) => setTimeout(r, 120))
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentA))

        await expect(pending).resolves.toBeTruthy()
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentB))
      })
    })

    it('non-writer close detaches session without releasing the writer lock', async () => {
      await withApp(async () => {
        const created = await tools['scene:projects.create'](
          { name: 'Detach Non Writer Test' },
          ctx('scene:projects.create'),
        ) as { id?: string }
        const projectId = created.id!
        const agentA = 'queue-test-a-3'
        const agentB = 'queue-test-b-3'

        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentA))
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentB))
        await tools['scene:script.put'](
          { projectId, source: 'const root = emptyScene({})\nsceneOutput({ scene: root.scene })' },
          ctx('scene:script.put', agentA),
        )

        // B leaves without holding write — A must still be able to mutate.
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentB))
        await tools['scene:script.put'](
          { projectId, source: 'const root = emptyScene({})\nsceneOutput({ scene: root.scene })' },
          ctx('scene:script.put', agentA),
        )
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentA))
      })
    })

    it('scene:projects.heartbeat renews the lease for the write-lock holder', async () => {
      await withApp(async () => {
        const created = await tools['scene:projects.create'](
          { name: 'Heartbeat Test' },
          ctx('scene:projects.create'),
        ) as { id?: string }
        const projectId = created.id!
        const agentA = 'queue-test-a-4'
        const agentB = 'queue-test-b-4'

        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentA))
        // Write lock is claimed by the first mutation, not by soft open.
        await tools['scene:script.put'](
          { projectId, source: 'const root = emptyScene({})\nsceneOutput({ scene: root.scene })' },
          ctx('scene:script.put', agentA),
        )
        const res = await tools['scene:projects.heartbeat'](
          { id: projectId },
          ctx('scene:projects.heartbeat', agentA),
        ) as { ok?: boolean }
        expect(res.ok).toBe(true)

        // Some other agent heartbeating a project it doesn't hold is rejected.
        await expect(
          tools['scene:projects.heartbeat']({ id: projectId }, ctx('scene:projects.heartbeat', agentB)),
        ).rejects.toThrow()
        await tools['scene:projects.close']({ id: projectId }, ctx('scene:projects.close', agentA))
      })
    })
  })

  it('rejects AI pipeline.execute without narrativeLocationNames when no run dir', async () => {
    await expect(
      tools['scene:pipeline.execute'](
        { projectId: 'p_unknown_project' },
        ctx('scene:pipeline.execute', 'no-names-agent'),
      ),
    ).rejects.toThrow(/narrativeLocationNames/)
  })

  describe('formatExecuteVerificationFailure (root-cause priority)', () => {
    it('prefers structural over locationNameAlignment when both fail', () => {
      const msg = formatExecuteVerificationFailure({
        status: 'completed',
        verification: {
          ok: false,
          primaryFailure: 'structural',
          hints: [
            'Node pob out_1 is empty after completed execute — check incoming connect',
            '[stage3.location_names] missing 望江客栈、市集、清水镇',
          ],
          locationNameAlignment: {
            ok: false,
            missing: [{ name: '望江客栈' }, { name: '市集' }, { name: '清水镇' }],
            fix: 'Wire Name ports',
            actualNodeNames: ['root'],
          },
        },
      })
      expect(msg).toMatch(/^\[primaryFailure: structural\]/)
      expect(msg).toMatch(/empty\/disconnected group outputs/)
      expect(msg).toMatch(/\[secondary: locationNameAlignment\]/)
      expect(msg).toContain('望江客栈')
      expect(msg).toContain('市集')
      expect(msg).toContain('清水镇')
    })

    it('reports location-names as primary when structural hints are absent', () => {
      const msg = formatExecuteVerificationFailure({
        status: 'completed',
        verification: {
          ok: false,
          primaryFailure: 'location-names',
          hints: ['[stage3.location_names] missing 望江客栈'],
          locationNameAlignment: {
            ok: false,
            missing: [{ name: '望江客栈' }],
            fix: 'Wire Name ports',
          },
        },
      })
      expect(msg).toMatch(/^\[primaryFailure: location-names\]/)
      expect(msg).toMatch(/locationNameAlignment failed/)
    })
  })

  // P0-3 (2026-07-15 tool 升级方案): pipeline.get 的 nameContains/opIdIn grep 式
  // 模糊过滤。
  describe('pipeline.get nameContains/opIdIn (P0-3)', () => {
    it('filters by name substring and reports search.matchCount', async () => {
      const app = await buildApp()
      await app.listen({ host: '127.0.0.1', port: 0 })
      const addr = app.server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(
        portsFile,
        JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
      )
      try {
        const agentId = 'search-agent'
        const created = await tools['scene:projects.create']({ name: 'Search Test' }, ctx('scene:projects.create')) as { id?: string }
        const projectId = created.id!
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentId))
        await applyBatch(
          await getRuntimeForProject(projectId),
          [
              { type: 'createNode', nodeId: 'house_1', opId: 'grid2node', name: '望江客栈_主楼', position: { x: 0, y: 0 }, params: {} },
              { type: 'createNode', nodeId: 'house_2', opId: 'grid2node', name: '望江客栈_偏房', position: { x: 200, y: 0 }, params: {} },
              { type: 'createNode', nodeId: 'unrelated', opId: 'grid2node', name: 'Something Else', position: { x: 400, y: 0 }, params: {} },
            ],
          { actor: 'test-runtime-fixture' },
        )

        const result = await tools['scene:pipeline.get'](
          { projectId, nameContains: '望江客栈' },
          ctx('scene:pipeline.get', agentId),
        ) as { nodes: Array<{ id: string }>; search?: { matchCount: number } }
        expect(result.search?.matchCount).toBe(2)
        expect(result.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['house_1', 'house_2']))
        expect(result.nodes.map((n) => n.id)).not.toContain('unrelated')
      } finally {
        await app.close()
      }
    })

    it('filters by opIdIn and reports matchCount:0 (not the whole graph) when nothing matches', async () => {
      const app = await buildApp()
      await app.listen({ host: '127.0.0.1', port: 0 })
      const addr = app.server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(
        portsFile,
        JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
      )
      try {
        const agentId = 'search-opid-agent'
        const created = await tools['scene:projects.create']({ name: 'Search OpId Test' }, ctx('scene:projects.create')) as { id?: string }
        const projectId = created.id!
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentId))
        await applyBatch(
          await getRuntimeForProject(projectId),
          [{ type: 'createNode', nodeId: 'g1', opId: 'grid2node', position: { x: 0, y: 0 }, params: {} }],
          { actor: 'test-runtime-fixture' },
        )

        const hit = await tools['scene:pipeline.get'](
          { projectId, opIdIn: ['grid2node'] },
          ctx('scene:pipeline.get', agentId),
        ) as { search?: { matchCount: number }; nodes: Array<{ id: string }> }
        expect(hit.search?.matchCount).toBeGreaterThanOrEqual(1)
        expect(hit.nodes.map((n) => n.id)).toContain('g1')

        const miss = await tools['scene:pipeline.get'](
          { projectId, opIdIn: ['no_such_op_anywhere'] },
          ctx('scene:pipeline.get', agentId),
        ) as { search?: { matchCount: number } }
        expect(miss.search?.matchCount).toBe(0)
      } finally {
        await app.close()
      }
    })
  })
})
