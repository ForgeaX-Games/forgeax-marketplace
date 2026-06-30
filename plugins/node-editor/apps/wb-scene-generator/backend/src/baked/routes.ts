/**
 * Baked scene-layer routes — the editable, graph-independent layer service the
 * preview's edit mode reads & writes. Persists to `<activeProject>/baked-scene.json`
 * (see ./store.ts). Every mutation broadcasts `baked:changed` so the renderer
 * (and any other client) re-pulls. The node graph is never touched here.
 */
import type { FastifyInstance } from 'fastify'
import { broadcastToClients } from '../routes/ws.js'
import {
  addBakedLayer,
  bakeLayers,
  ensurePaintTarget,
  getBakedHistoryStatus,
  listBakedLayers,
  moveBakedLayer,
  patchBakedCustomAttributes,
  redoBakedHistory,
  removeBakedLayer,
  renameBakedLayer,
  setBakedCells,
  undoBakedHistory,
  type BakedCell,
} from './store.js'

// Broadcast + log every mutation so the baked-layer edit flow is traceable in
// the backend console (these are infrequent, user-driven actions).
function notifyChanged(msg: string): void {
  console.log(`[baked] ${msg}`)
  broadcastToClients({ event: 'baked:changed', payload: {} })
}

export async function registerBakedRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/baked/layers', async () => ({ layers: await listBakedLayers() }))

  app.get('/api/v1/baked/history', async () => getBakedHistoryStatus())

  app.post('/api/v1/baked/history/undo', async () => {
    const status = await undoBakedHistory()
    notifyChanged('undo baked edit')
    return status
  })

  app.post('/api/v1/baked/history/redo', async () => {
    const status = await redoBakedHistory()
    notifyChanged('redo baked edit')
    return status
  })

  app.post('/api/v1/baked/layers', async (req) => {
    const b = (req.body ?? {}) as { name?: string; parentPath?: string }
    const path = await addBakedLayer(b.name ?? 'Layer', b.parentPath ?? '/')
    notifyChanged(`+ layer ${path}`)
    return { path }
  })

  // Add a sub-layer (tree child) under an existing layer.
  app.post('/api/v1/baked/sublayer', async (req, reply) => {
    const b = (req.body ?? {}) as { parentPath?: string; name?: string }
    if (!b.parentPath) return reply.code(400).send({ error: 'parentPath is required' })
    const path = await addBakedLayer(b.name ?? 'Sub', b.parentPath)
    notifyChanged(`+ sub-layer ${path}`)
    return { path }
  })

  // Resolve which layer a paint stroke of `asset` under `parentPath` writes into,
  // creating a `layer-n` sub-layer if the asset differs from the active layer's.
  // Returns the target path; the renderer then PATCHes its cells to that path.
  app.post('/api/v1/baked/target', async (req, reply) => {
    const b = (req.body ?? {}) as { parentPath?: string; asset?: { name?: string; type?: string; alias?: string } }
    if (!b.parentPath || !b.asset?.name) return reply.code(400).send({ error: 'parentPath and asset.name are required' })
    const path = await ensurePaintTarget(b.parentPath, { name: b.asset.name, type: b.asset.type, alias: b.asset.alias })
    notifyChanged(`target ${b.parentPath} + ${b.asset.name} → ${path}`)
    return { path }
  })

  // Whole-layer cell overwrite (z=0 painting), plus optional asset (re)bind.
  app.patch('/api/v1/baked/layers/cells', async (req, reply) => {
    const b = (req.body ?? {}) as { path?: string; cells?: BakedCell[]; asset?: { name: string; type?: string; alias?: string } }
    if (!b.path) return reply.code(400).send({ error: 'path is required' })
    await setBakedCells(b.path, b.cells ?? [], b.asset)
    notifyChanged(`paint ${b.path} (${(b.cells ?? []).length} cells${b.asset ? `, asset=${b.asset.name}` : ''})`)
    return { ok: true }
  })

  // Move (reparent and/or reorder) a layer — drag-and-drop in the Editable panel.
  app.patch('/api/v1/baked/move', async (req, reply) => {
    const b = (req.body ?? {}) as { path?: string; destParentPath?: string; beforeName?: string }
    if (!b.path || !b.destParentPath) return reply.code(400).send({ error: 'path and destParentPath are required' })
    const dest = await moveBakedLayer(b.path, b.destParentPath, b.beforeName)
    notifyChanged(`move ${b.path} → ${dest ?? '(rejected)'}${b.beforeName ? ` before ${b.beforeName}` : ''}`)
    return { path: dest }
  })

  app.patch('/api/v1/baked/rename', async (req, reply) => {
    const b = (req.body ?? {}) as { path?: string; name?: string }
    if (!b.path || typeof b.name !== 'string') return reply.code(400).send({ error: 'path and name are required' })
    try {
      const path = await renameBakedLayer(b.path, b.name)
      if (!path) return reply.code(404).send({ error: 'layer not found' })
      notifyChanged(`rename ${b.path} → ${path}`)
      return { path }
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  app.delete('/api/v1/baked/layers', async (req, reply) => {
    const b = (req.body ?? {}) as { path?: string }
    if (!b.path) return reply.code(400).send({ error: 'path is required' })
    await removeBakedLayer(b.path)
    notifyChanged(`delete ${b.path}`)
    return { ok: true }
  })

  // Merge custom (non-reserved) attributes onto one or more baked layers.
  app.patch('/api/v1/baked/layers/attributes', async (req, reply) => {
    const b = (req.body ?? {}) as {
      paths?: string[]
      path?: string
      attributes?: Record<string, unknown>
      overwrite?: boolean
    }
    const paths = b.paths ?? (b.path ? [b.path] : [])
    if (paths.length === 0 || !b.attributes || typeof b.attributes !== 'object') {
      return reply.code(400).send({ error: 'paths (or path) and attributes are required' })
    }
    try {
      await patchBakedCustomAttributes(paths, b.attributes, { overwrite: b.overwrite })
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
    notifyChanged(`attrs ${paths.length} layer(s)`)
    return { ok: true }
  })

  // Snapshot transient graph layers into the baked tree as editable copies.
  app.post('/api/v1/baked/bake', async (req) => {
    const b = (req.body ?? {}) as {
      layers?: Array<{ nodePath?: string; nodeName?: string; cells?: BakedCell[]; assetName?: string; assetAlias?: string; assetType?: string; schema?: string }>
    }
    const paths = await bakeLayers((b.layers ?? []).map((l) => ({ ...l, cells: l.cells ?? [] })))
    notifyChanged(`bake ${paths.length} → [${paths.join(', ')}]`)
    return { paths }
  })
}
