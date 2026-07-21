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
      JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
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

  // P0-2 (2026-07-15 tool 升级方案): applyBatch 的 connect op 除了 in_N/out_N
  // 编号 port 外，还能用 `{ label: "..." }` 按 instantiateTemplate 返回的语义
  // 名字寻址——这里用真实的 IslandRegions 模板（batteries/templates/scene/
  // IslandRegions）端到端验证：resolve 出来的是正确的底层 in_N/out_N。
  describe('applyBatch connect-by-label (P0-2)', () => {
    async function withProject(fn: (p: { projectId: string; agentId: string }) => Promise<void>) {
      const app = await buildApp()
      await app.listen({ host: '127.0.0.1', port: 0 })
      const addr = app.server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(
        portsFile,
        JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
      )
      try {
        const agentId = `label-test-${Math.random().toString(36).slice(2)}`
        const created = await tools['scene:projects.create']({ name: 'Label Addr Test' }, ctx('scene:projects.create')) as { id?: string }
        const projectId = created.id!
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentId))
        await fn({ projectId, agentId })
      } finally {
        await app.close()
      }
    }

    it('resolves source/target { label } into the underlying in_N/out_N port names', async () => {
      await withProject(async ({ projectId, agentId }) => {
        const a = await tools['scene:pipeline.instantiateTemplate'](
          { projectId, templateId: 'IslandRegions', position: { x: 0, y: 0 } },
          ctx('scene:pipeline.instantiateTemplate', agentId),
        ) as { groupId?: string }
        const b = await tools['scene:pipeline.instantiateTemplate'](
          { projectId, templateId: 'IslandRegions', position: { x: 400, y: 0 } },
          ctx('scene:pipeline.instantiateTemplate', agentId),
        ) as { groupId?: string }
        expect(a.groupId).toBeTruthy()
        expect(b.groupId).toBeTruthy()

        await tools['scene:pipeline.applyBatch'](
          {
            projectId,
            ops: [
              {
                type: 'connect',
                edgeId: 'e_label_test',
                source: { nodeId: a.groupId, port: { label: 'Island' } },
                target: { nodeId: b.groupId, port: { label: 'Scene' } },
              },
            ],
          },
          ctx('scene:pipeline.applyBatch', agentId),
        )

        const summary = await tools['scene:pipeline.get'](
          { projectId, nodeIds: [a.groupId, b.groupId] },
          ctx('scene:pipeline.get', agentId),
        ) as { edges: Array<{ id?: string; source: { port: string }; target: { port: string } }> }
        const edge = summary.edges.find((e) => e.id === 'e_label_test')
        expect(edge).toBeDefined()
        // "Island" is out_1, "Scene" is in_0 on IslandRegions (see the template JSON).
        expect(edge!.source.port).toBe('out_1')
        expect(edge!.target.port).toBe('in_0')
      })
    })

    it('rejects an unknown label with the list of available labels', async () => {
      await withProject(async ({ projectId, agentId }) => {
        const a = await tools['scene:pipeline.instantiateTemplate'](
          { projectId, templateId: 'IslandRegions', position: { x: 0, y: 0 } },
          ctx('scene:pipeline.instantiateTemplate', agentId),
        ) as { groupId?: string }
        const b = await tools['scene:pipeline.instantiateTemplate'](
          { projectId, templateId: 'IslandRegions', position: { x: 400, y: 0 } },
          ctx('scene:pipeline.instantiateTemplate', agentId),
        ) as { groupId?: string }

        await expect(
          tools['scene:pipeline.applyBatch'](
            {
              projectId,
              ops: [
                {
                  type: 'connect',
                  source: { nodeId: a.groupId, port: { label: 'Island' } },
                  target: { nodeId: b.groupId, port: { label: 'NotARealLabel' } },
                },
              ],
            },
            ctx('scene:pipeline.applyBatch', agentId),
          ),
        ).rejects.toThrow(/label "NotARealLabel" not found.*Available labels/s)
      })
    })

    it('rejects a label on a node that is not a __group__', async () => {
      await withProject(async ({ projectId, agentId }) => {
        await tools['scene:pipeline.applyBatch'](
          {
            projectId,
            ops: [
              { type: 'createNode', nodeId: 'plain1', opId: 'grid2node', position: { x: 0, y: 0 }, params: {} },
            ],
          },
          ctx('scene:pipeline.applyBatch', agentId),
        )
        await expect(
          tools['scene:pipeline.applyBatch'](
            {
              projectId,
              ops: [
                {
                  type: 'connect',
                  source: { nodeId: 'plain1', port: { label: 'Whatever' } },
                  target: { nodeId: 'plain1', port: 'in_0' },
                },
              ],
            },
            ctx('scene:pipeline.applyBatch', agentId),
          ),
        ).rejects.toThrow(/not a __group__/)
      })
    })

    it('leaves plain string ports untouched (no extra HTTP round-trip needed)', async () => {
      await withProject(async ({ projectId, agentId }) => {
        await tools['scene:pipeline.applyBatch'](
          {
            projectId,
            ops: [
              { type: 'createNode', nodeId: 'p1', opId: 'grid2node', position: { x: 0, y: 0 }, params: { name: 'P1', grid: [[1]] } },
              { type: 'createNode', nodeId: 'p2', opId: 'grid2node', position: { x: 200, y: 0 }, params: { name: 'P2', grid: [[1]] } },
            ],
          },
          ctx('scene:pipeline.applyBatch', agentId),
        )
        const result = await tools['scene:pipeline.get'](
          { projectId, nodeIds: ['p1', 'p2'] },
          ctx('scene:pipeline.get', agentId),
        ) as { nodes: Array<{ id: string }> }
        expect(result.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(['p1', 'p2']))
      })
    })
  })

  // P0-4 (2026-07-15 tool 升级方案): applyBatch 的 `appendMergeItem` 复合操作——
  // 一次调用即可把 updateNode(portCount+1) + connect(item_N) 两步都做对，不用
  // 自己数当前 portCount。
  describe('applyBatch appendMergeItem (P0-4)', () => {
    it('increments portCount and wires sequential item_N slots, including across repeated calls in one batch', async () => {
      const app = await buildApp()
      await app.listen({ host: '127.0.0.1', port: 0 })
      const addr = app.server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(
        portsFile,
        JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
      )
      try {
        const agentId = 'append-merge-agent'
        const created = await tools['scene:projects.create']({ name: 'Append Merge Test' }, ctx('scene:projects.create')) as { id?: string }
        const projectId = created.id!
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentId))

        await tools['scene:pipeline.applyBatch'](
          {
            projectId,
            ops: [
              { type: 'createNode', nodeId: 'm0_merge', opId: 'tree_merge', position: { x: 0, y: 0 }, params: { portCount: 1 } },
              { type: 'createNode', nodeId: 'src_a', opId: 'grid2node', position: { x: -200, y: 0 }, params: { name: 'SrcA', grid: [[1]] } },
              { type: 'createNode', nodeId: 'src_b', opId: 'grid2node', position: { x: -200, y: 100 }, params: { name: 'SrcB', grid: [[1]] } },
            ],
          },
          ctx('scene:pipeline.applyBatch', agentId),
        )

        await tools['scene:pipeline.applyBatch'](
          {
            projectId,
            ops: [
              { type: 'appendMergeItem', mergeNodeId: 'm0_merge', source: { nodeId: 'src_a', port: 'out_0' } },
              { type: 'appendMergeItem', mergeNodeId: 'm0_merge', source: { nodeId: 'src_b', port: 'out_0' } },
            ],
          },
          ctx('scene:pipeline.applyBatch', agentId),
        )

        const raw = await tools['scene:pipeline.get'](
          { projectId, raw: true },
          ctx('scene:pipeline.get', agentId),
        ) as { nodes: Record<string, { id: string; params?: Record<string, unknown> }> | Array<{ id: string; params?: Record<string, unknown> }>; edges: Record<string, unknown> | unknown[] }
        const nodes = Array.isArray(raw.nodes) ? raw.nodes : Object.values(raw.nodes)
        const merge = nodes.find((n) => n.id === 'm0_merge')
        expect(merge?.params?.portCount).toBe(3) // started at 1, +2 appends

        const edges = Array.isArray(raw.edges) ? raw.edges : Object.values(raw.edges as Record<string, unknown>)
        const toMerge = (edges as Array<{ source: { nodeId: string; port: string }; target: { nodeId: string; port: string } }>).filter(
          (e) => e.target.nodeId === 'm0_merge',
        )
        expect(toMerge.map((e) => e.target.port).sort()).toEqual(['item_1', 'item_2'])
      } finally {
        await app.close()
      }
    })

    it('rejects appendMergeItem targeting a node that is not tree_merge', async () => {
      const app = await buildApp()
      await app.listen({ host: '127.0.0.1', port: 0 })
      const addr = app.server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      writeFileSync(
        portsFile,
        JSON.stringify({ plugins: { '@forgeax-plugin/wb-scene-generator': { backendPort: port } } }),
      )
      try {
        const agentId = 'append-merge-reject-agent'
        const created = await tools['scene:projects.create']({ name: 'Append Merge Reject Test' }, ctx('scene:projects.create')) as { id?: string }
        const projectId = created.id!
        await tools['scene:projects.open']({ id: projectId }, ctx('scene:projects.open', agentId))
        await tools['scene:pipeline.applyBatch'](
          {
            projectId,
            ops: [
              { type: 'createNode', nodeId: 'not_a_merge', opId: 'grid2node', position: { x: 0, y: 0 }, params: {} },
              { type: 'createNode', nodeId: 'src', opId: 'grid2node', position: { x: -200, y: 0 }, params: {} },
            ],
          },
          ctx('scene:pipeline.applyBatch', agentId),
        )
        await expect(
          tools['scene:pipeline.applyBatch'](
            {
              projectId,
              ops: [{ type: 'appendMergeItem', mergeNodeId: 'not_a_merge', source: { nodeId: 'src', port: 'out_0' } }],
            },
            ctx('scene:pipeline.applyBatch', agentId),
          ),
        ).rejects.toThrow(/not "tree_merge"/)
      } finally {
        await app.close()
      }
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
        await tools['scene:pipeline.applyBatch'](
          {
            projectId,
            ops: [
              { type: 'createNode', nodeId: 'house_1', opId: 'grid2node', name: '望江客栈_主楼', position: { x: 0, y: 0 }, params: {} },
              { type: 'createNode', nodeId: 'house_2', opId: 'grid2node', name: '望江客栈_偏房', position: { x: 200, y: 0 }, params: {} },
              { type: 'createNode', nodeId: 'unrelated', opId: 'grid2node', name: 'Something Else', position: { x: 400, y: 0 }, params: {} },
            ],
          },
          ctx('scene:pipeline.applyBatch', agentId),
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
        await tools['scene:pipeline.applyBatch'](
          {
            projectId,
            ops: [{ type: 'createNode', nodeId: 'g1', opId: 'grid2node', position: { x: 0, y: 0 }, params: {} }],
          },
          ctx('scene:pipeline.applyBatch', agentId),
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
