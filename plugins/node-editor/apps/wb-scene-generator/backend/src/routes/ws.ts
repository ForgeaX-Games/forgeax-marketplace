import type { FastifyInstance } from 'fastify'
import type { RuntimeChannel, RuntimeEvent } from '@forgeax/node-runtime'
import { getRuntime } from '../runtime.js'
import { isCanvasPerfVerbose, logWsRuntimeEvent } from '../lib/canvasPerfDebug.js'

interface Socketish {
  send: (data: string) => void
}

interface ClientEntry {
  socket: Socketish
  channels: RuntimeChannel[] | null
  unsub: (() => void) | null
}

// Registry of all connected sockets, for server-initiated broadcasts +
// re-binding their runtime-bus subscriptions when the active project changes.
const clients = new Map<Socketish, ClientEntry>()

// Broadcast a message to every connected client. Returns the number of
// sockets the message was sent to; sockets that throw on send are skipped.
export function broadcastToClients(msg: unknown): number {
  const data = JSON.stringify(msg)
  let n = 0
  for (const entry of clients.values()) {
    try {
      entry.socket.send(data)
      n++
    } catch {
      /* drop */
    }
  }
  return n
}

// (Re)bind one client's runtime-bus subscription to the CURRENTLY ACTIVE
// runtime. The active runtime swaps when a project is opened, so graph:applied
// (on the 'graph' channel) and exec:* / asset events all follow the active
// project's bus. graph:applied now flows over THIS bus binding — the mutation
// and import routes intentionally no longer broadcast a second copy (the kernel
// applyBatch / importPipelineGraph emit it on the bus). Only the project
// activate route still calls broadcastToClients directly, because switching the
// active runtime happens outside any applyBatch and so emits no bus event.
async function bind(entry: ClientEntry): Promise<void> {
  entry.unsub?.()
  entry.unsub = null
  if (!entry.channels) return
  const rt = await getRuntime()
  entry.unsub = rt.subscriptions.subscribe(rt.config.pipelineId, entry.channels, (event) => {
    if (isCanvasPerfVerbose()) {
      const e = event as RuntimeEvent
      const kind = typeof e === 'object' && e !== null && 'kind' in e ? String((e as { kind: unknown }).kind) : 'unknown'
      let extra = ''
      if (kind === 'node:output' && typeof e === 'object' && e !== null) {
        const { nodeId, portId } = e as { nodeId?: string; portId?: string }
        if (nodeId && portId) extra = `node=${nodeId} port=${portId}`
      }
      if (kind === 'exec:completed' || kind === 'exec:started' || kind === 'node:output' || kind === 'graph:applied') {
        if (kind === 'graph:applied' && typeof e === 'object' && e !== null) {
          const { batchId, newHash } = e as { batchId?: string; newHash?: string }
          const parts = [extra, batchId ? `batchId=${batchId}` : '', newHash ? `newHash=${newHash.slice(0, 12)}…` : ''].filter(Boolean)
          logWsRuntimeEvent('runtime', kind, parts.join(' ') || undefined)
        } else {
          logWsRuntimeEvent('runtime', kind, extra || undefined)
        }
      }
    }
    try {
      entry.socket.send(JSON.stringify({ event: 'runtime', payload: event }))
    } catch {
      /* drop */
    }
  })
}

/** Re-point every connected client's subscription at the active runtime. */
export async function rebindWsSubscriptions(): Promise<void> {
  await Promise.all([...clients.values()].map((entry) => bind(entry)))
}

// Client opens /ws and sends {action:'subscribe', channels:[...]}; the server
// forwards every RuntimeEvent on those channels as {event:'runtime', payload}.
export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(import('@fastify/websocket'))
  app.get('/ws', { websocket: true }, async (socket) => {
    await getRuntime()
    const entry: ClientEntry = { socket, channels: null, unsub: null }
    clients.set(socket, entry)
    socket.on('message', (raw: Buffer) => {
      let msg: { action?: string; channels?: RuntimeChannel[] }
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.action === 'subscribe') {
        entry.channels = (msg.channels ?? ['graph', 'execution', 'asset']) as RuntimeChannel[]
        void bind(entry)
      }
    })
    socket.on('close', () => {
      entry.unsub?.()
      clients.delete(socket)
    })
  })
}
