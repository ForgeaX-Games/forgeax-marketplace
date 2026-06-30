import Fastify, { type FastifyInstance } from 'fastify'
import { registerQueryRoutes } from './routes/queries.js'
import { registerMutationRoutes } from './routes/mutations.js'
import { registerPipelineImportRoutes } from './routes/pipelineImport.js'
import { registerExecuteRoutes } from './routes/execute.js'
import { registerWsRoutes } from './routes/ws.js'
import { registerScreenshotRoutes } from './agent/routes.js'
import { registerRendererAgentRoutes } from './agent/rendererRoutes.js'
import { registerLibraryRoutes } from './library/routes.js'
import { registerPrivateLibraryRoutes } from './library/privateRoutes.js'
import { registerBakedRoutes } from './baked/routes.js'
import { registerSceneExportRoutes } from './scene-export/routes.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerGroupTemplateRoutes } from './routes/groupTemplates.js'
import { registerAssetRoutes } from './routes/assets.js'
import { registerCanvasPerfDebugRoutes } from './routes/canvasPerfDebug.js'
import { getRuntime, stopBatteryWatch } from './runtime.js'
import { isCanvasPerfDebugEnabled, logPerfDebugStartup } from './lib/canvasPerfDebug.js'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // Perf debug hooks must register before route handlers so every request is timed.
  await registerCanvasPerfDebugRoutes(app)
  logPerfDebugStartup()
  // Release the dev battery watcher on shutdown so `app.close()` lets the
  // process exit (an open chokidar watch keeps the event loop alive).
  app.addHook('onClose', async () => stopBatteryWatch())
  app.get('/health', async () => ({ status: 'ok' }))
  await registerQueryRoutes(app)
  await registerMutationRoutes(app)
  await registerPipelineImportRoutes(app)
  await registerExecuteRoutes(app)
  await registerWsRoutes(app)
  await registerScreenshotRoutes(app)
  await registerRendererAgentRoutes(app)
  await registerLibraryRoutes(app)
  await registerPrivateLibraryRoutes(app)
  await registerBakedRoutes(app)
  await registerSceneExportRoutes(app)
  await registerProjectRoutes(app)
  await registerGroupTemplateRoutes(app)
  await registerAssetRoutes(app)
  await getRuntime()
  return app
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')
if (isMain) {
  const app = await buildApp()
  const port = Number(process.env.PORT ?? 9557)
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`[wb-scene-generator backend] listening on :${port}`)
  if (isCanvasPerfDebugEnabled()) {
    console.log(
      `[wb-scene-generator backend] FORGEAX_CANVAS_PERF_DEBUG=${process.env.FORGEAX_CANVAS_PERF_DEBUG} — canvas perf logs on stdout`,
    )
  }
}
