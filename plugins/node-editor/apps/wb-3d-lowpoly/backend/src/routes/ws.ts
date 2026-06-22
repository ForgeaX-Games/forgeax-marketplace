import type { FastifyInstance } from 'fastify'
import type { RuntimeChannel } from '@forgeax/node-runtime'
import { getRuntime } from '../runtime.js'

interface Socketish {
  send: (data: string) => void
}

interface ClientEntry {
  socket: Socketish
  channels: RuntimeChannel[] | null
  unsub: (() => void) | null
}

const clients = new Map<Socketish, ClientEntry>()

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

async function bind(entry: ClientEntry): Promise<void> {
  entry.unsub?.()
  entry.unsub = null
  if (!entry.channels) return
  const rt = await getRuntime()
  entry.unsub = rt.subscriptions.subscribe(rt.config.pipelineId, entry.channels, (event) => {
    try {
      entry.socket.send(JSON.stringify({ event: 'runtime', payload: event }))
    } catch {
      /* drop */
    }
  })
}

export async function rebindWsSubscriptions(): Promise<void> {
  await Promise.all([...clients.values()].map((entry) => bind(entry)))
}

export async function registerWsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(import('@fastify/websocket'))
  app.get('/ws', { websocket: true }, async (socket) => {
    await getRuntime()
    const entry: ClientEntry = { socket, channels: null, unsub: null }
    clients.set(socket, entry)
    socket.on('message', (raw: Buffer) => {
      let msg: { action?: string; channels?: RuntimeChannel[] }
      try { msg = JSON.parse(raw.toString()) } catch { return }
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
