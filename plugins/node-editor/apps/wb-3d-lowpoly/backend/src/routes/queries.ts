import type { FastifyInstance } from 'fastify'
import { getPipeline, getNode, listNodes, listEdges, getNodeOutput, getHistory, listOps, getGroup, listGroups } from '@forgeax/node-runtime'
import { getRuntime } from '../runtime.js'
import { getBatteryCategories } from './batteryCategories.js'

export async function registerQueryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/pipeline', async () => getPipeline(await getRuntime()))
  app.get('/api/v1/nodes', async (req) => listNodes(await getRuntime(), (req.query as { filter?: unknown }).filter as never))
  app.get('/api/v1/nodes/:id', async (req) => getNode(await getRuntime(), (req.params as { id: string }).id))
  app.get('/api/v1/edges', async () => listEdges(await getRuntime()))
  app.get('/api/v1/nodes/:id/outputs/:portId', async (req) => {
    const { id, portId } = req.params as { id: string; portId: string }
    return { value: getNodeOutput(await getRuntime(), id, portId) }
  })
  app.get('/api/v1/history', async () => getHistory(await getRuntime()))
  // Re-attach the UI hints the kernel strips from OpSpec, derived from the
  // on-disk battery layout, so the editor palette groups faithfully and panel
  // batteries (e.g. g_preview → name_list_panel) render with the right node
  // component. The kernel mapper (opSpecToBattery) reads these as TOP-LEVEL
  // fields off the wire spec (category/displayGroup/type), so nodeType /
  // hideOutputs are attached the same way.
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
}
