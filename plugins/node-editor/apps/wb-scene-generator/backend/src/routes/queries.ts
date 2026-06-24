import type { FastifyInstance } from 'fastify'
import { getPipeline, getNode, listNodes, listEdges, getNodeOutput, getHistory, listOps, getGroup, listGroups, probeGroupInner } from '@forgeax/node-runtime'
import { getRuntime } from '../runtime.js'
import { getBatteryCategories } from './batteryCategories.js'
import { logOutputFetch } from '../lib/persistTrace.js'

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/pipeline', async () => getPipeline(await getRuntime()))
  // Lightweight hash — derived from getPipeline so this route stays compatible
  // even when an older @forgeax/node-runtime dist is linked momentarily.
  app.get('/api/v1/pipeline/hash', async () => {
    const snap = getPipeline(await getRuntime())
    return { hash: snap?.hash ?? null }
  })
  app.get('/api/v1/nodes', async (req) => listNodes(await getRuntime(), (req.query as { filter?: unknown }).filter as never))
  app.get('/api/v1/nodes/:id', async (req) => getNode(await getRuntime(), (req.params as { id: string }).id))
  app.get('/api/v1/edges', async () => listEdges(await getRuntime()))
  app.get('/api/v1/nodes/:id/outputs/:portId/meta', async (req) => {
    const { id, portId } = req.params as { id: string; portId: string }
    const rt = await getRuntime()
    const readMeta = (rt.outputs as { readMeta?: (n: string, p: string) => unknown }).readMeta
    const meta = readMeta?.call(rt.outputs, id, portId) ?? null
    return meta ?? { missing: true }
  })
  app.get('/api/v1/nodes/:id/outputs/:portId', async (req, reply) => {
    const { id, portId } = req.params as { id: string; portId: string }
    const t0 = performance.now()
    const rt = await getRuntime()
    const readMeta = (rt.outputs as { readMeta?: (n: string, p: string) => { sharded?: boolean; dataChunks?: number } | null }).readMeta
    const meta = readMeta?.call(rt.outputs, id, portId) ?? null
    // Sharded outputs (e.g. tree_merge with 800+ scene subtrees) cannot be
    // reassembled + JSON.stringify'd in one HTTP body — V8 throws "Invalid string
    // length". Clients must skip these for preview/tooltip hydration; scene_output
    // layers/names are the renderer SSOT and stay inline-sized.
    if (meta?.sharded) {
      logOutputFetch(id, portId, performance.now() - t0, 0, {
        sharded: true,
        dataChunks: meta.dataChunks,
        skipped: true,
      })
      reply.code(413)
      reply.header('content-type', 'application/json; charset=utf-8')
      return reply.send(
        JSON.stringify({
          error: 'output too large for inline fetch',
          sharded: true,
          dataChunks: meta.dataChunks ?? null,
          value: null,
        }),
      )
    }
    const value = getNodeOutput(rt, id, portId)
    const body = JSON.stringify({ value })
    const bytesOut = Buffer.byteLength(body, 'utf-8')
    logOutputFetch(id, portId, performance.now() - t0, bytesOut, {
      sharded: meta?.sharded,
      dataChunks: meta?.dataChunks,
    })
    reply.header('content-type', 'application/json; charset=utf-8')
    return reply.send(body)
  })
  app.get('/api/v1/history', async () => getHistory(await getRuntime()))
  // Re-attach the UI category hint the kernel strips from OpSpec, derived from
  // the on-disk battery layout, so the editor palette groups faithfully.
  app.get('/api/v1/ops', async () => {
    const [ops, categories] = await Promise.all([
      Promise.resolve(listOps(await getRuntime())),
      getBatteryCategories(),
    ])
    return ops.map((op) => {
      const ui = categories.get(op.id)
      if (!ui) return op
      return {
        ...op,
        category: ui.category,
        displayGroup: ui.displayGroup ?? ui.category,
        type: ui.type,
        ...(ui.iconSvg !== undefined ? { iconSvg: ui.iconSvg } : {}),
        ...(ui.nodeType !== undefined ? { nodeType: ui.nodeType } : {}),
        ...(ui.hideOutputs !== undefined ? { hideOutputs: ui.hideOutputs } : {}),
      }
    })
  })
  app.get('/api/v1/groups', async () => listGroups(await getRuntime()))
  app.get('/api/v1/groups/:id', async (req) => getGroup(await getRuntime(), (req.params as { id: string }).id))
  app.get('/api/v1/groups/:id/probe', async (req) => probeGroupInner(await getRuntime(), (req.params as { id: string }).id))
}
