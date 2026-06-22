import Fastify, { type FastifyInstance } from 'fastify'
import { registerQueryRoutes } from './routes/queries.js'
import { registerMutationRoutes } from './routes/mutations.js'
import { registerPipelineImportRoutes } from './routes/pipelineImport.js'
import { registerExecuteRoutes } from './routes/execute.js'
import { registerWsRoutes } from './routes/ws.js'
import { registerLibraryRoutes } from './routes/library.js'
import { registerScreenshotRoutes } from './agent/routes.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerGroupTemplateRoutes } from './routes/groupTemplates.js'
import { registerAssetRoutes } from './routes/assets.js'
import { getRuntime, stopBatteryWatch } from './runtime.js'
import { warmUpBaker } from './services/baker-context.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // Release the dev battery watcher on shutdown so `app.close()` lets the
  // process exit (an open chokidar watch keeps the event loop alive).
  app.addHook('onClose', async () => stopBatteryWatch())
  app.get('/health', async () => ({ status: 'ok' }))
  await registerQueryRoutes(app)
  await registerMutationRoutes(app)
  await registerPipelineImportRoutes(app)
  await registerExecuteRoutes(app)
  await registerWsRoutes(app)
  await registerLibraryRoutes(app)
  await registerScreenshotRoutes(app)
  await registerProjectRoutes(app)
  await registerGroupTemplateRoutes(app)
  await registerAssetRoutes(app)
  await getRuntime()
  // Non-blocking OCCT WASM warmup: the first bake otherwise pays the ~1-2s WASM
  // boot inline. Fire-and-forget so the server starts serving immediately; a
  // warmup failure is logged but never blocks startup (baker re-tries on demand).
  void warmUpBaker().catch((err) => {
    console.warn(`[baker] warmup skipped: ${err instanceof Error ? err.message : String(err)}`)
  })
  return app
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
if (isMain) {
  const app = await buildApp()
  const port = Number(process.env.PORT ?? 9567)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[wb-3d-lowpoly backend] listening on :${port}`)
}
