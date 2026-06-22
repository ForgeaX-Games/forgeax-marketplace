import { createRuntime, createBatteryLoader, OpRegistry, ProjectRegistry } from '@forgeax/node-runtime'
import type { Runtime, BatteryLoader, LoaderEvent } from '@forgeax/node-runtime'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'
import { createBakerServices } from './services/baker-context.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const PLUGIN_ID = '@forgeax-plugin/wb-3d-lowpoly'

let registry: ProjectRegistry | null = null
let sharedOps: OpRegistry | null = null
// Retained so the dev-mode chokidar watcher keeps running for the process
// lifetime; without a reference it would be GC-eligible and stop emitting.
let batteryLoader: BatteryLoader | null = null
// The chokidar watcher's teardown fn (closes the fs watch). Held so a graceful
// shutdown can release it — an OPEN watcher keeps the Node event loop alive, so
// short-lived processes (smoke scripts, ephemeral backends) would otherwise hang
// after `app.close()`. Wired to the app's onClose hook in main.ts.
let stopWatch: (() => void) | null = null

/**
 * Whether to hot-reload batteries during development. The kernel loader already
 * supports chokidar watch; we enable it outside production/test so editing a
 * battery's meta.json / index.ts live-refreshes the shared OpRegistry without a
 * backend restart. `FORGEAX_BATTERY_WATCH=1|0` force-overrides the heuristic.
 */
function batteryWatchEnabled(): boolean {
  const flag = process.env.FORGEAX_BATTERY_WATCH
  if (flag === '1' || flag === 'true') return true
  if (flag === '0' || flag === 'false') return false
  const env = process.env.NODE_ENV
  return env !== 'production' && env !== 'test'
}

// Mirror the loader's registry diff to every connected WS client so the editor
// can refetch /api/v1/ops. Lazy-imported to avoid a circular module load
// (routes/ws.js imports getRuntime from here).
function broadcastLoaderEvent(event: LoaderEvent): void {
  if (event.kind === 'scan-error') {
    console.warn(`[battery watch] scan error ${event.error.dir}: ${event.error.reason}`)
    return
  }
  console.log(`[battery watch] ${event.kind} ${event.opId}`)
  void import('./routes/ws.js')
    .then((m) => m.broadcastToClients({ event: 'ops:changed', payload: { kind: event.kind, opId: event.opId } }))
    .catch(() => {})
}

async function buildSharedOps(): Promise<OpRegistry> {
  const ops = new OpRegistry()
  const watch = batteryWatchEnabled()
  const loader = createBatteryLoader(ops, {
    pluginId: PLUGIN_ID,
    scanDirs: resolveBatteryScanRoots(repoRoot),
    layout: 'flexible',
    watch,
  })
  const res = await loader.scan()
  for (const e of res.errors) console.warn(`[battery skip] ${e.dir}: ${e.reason}`)
  console.log(`[runtime] loaded ${res.added} ops (${res.errors.length} skipped)${watch ? ' [hot-reload on]' : ''}`)
  if (watch) {
    batteryLoader = loader
    loader.subscribe(broadcastLoaderEvent)
    stopWatch = loader.startWatching()
  }
  return ops
}

/**
 * Stop the dev battery watcher (closes the chokidar fs watch). Idempotent.
 * Registered on the Fastify `onClose` hook so `app.close()` lets the process
 * exit cleanly instead of being held open by the watcher's event loop handles.
 */
export function stopBatteryWatch(): void {
  if (stopWatch) {
    stopWatch()
    stopWatch = null
  }
  batteryLoader = null
}

export async function getProjectRegistry(): Promise<ProjectRegistry> {
  if (registry) return registry
  const projectRoot = process.env.FORGEAX_PROJECT_ROOT ?? resolve(repoRoot, '.forgeax-runtime')
  // Content-addressed blob root for baked meshes; served by GET /api/v1/library/blob.
  const libRoot = join(projectRoot, 'library')
  const bakerServices = createBakerServices(libRoot)
  sharedOps = sharedOps ?? (await buildSharedOps())
  const ops = sharedOps
  const reg = new ProjectRegistry({
    workspaceRoot: projectRoot,
    defaultType: 'lowpoly',
    defaultProjectName: 'Default Lowpoly',
    defaultProjectId: 'main',
    legacyStateDir: 'state',
    createRuntime: (req) =>
      createRuntime({
        projectRoot,
        pipelineId: req.pipelineId,
        pluginId: PLUGIN_ID,
        registry: ops,
        // Inject the baker/library bag so g_to_urdf can tessellate composites into
        // real OBJ meshes instead of falling back to AABB boxes. Generic kernel seam.
        createExecutionContext: (base) => ({ ...base, services: { ...bakerServices } }),
        layout: {
          graphFile: req.graphFile,
          historyFile: req.historyFile,
          outputsDir: req.outputsDir,
        },
      }),
  })
  reg.init()
  registry = reg
  return reg
}

export async function getRuntime(): Promise<Runtime> {
  const reg = await getProjectRegistry()
  return reg.getActiveRuntime()
}

export function resetRuntimeForTests(): void {
  registry = null
  sharedOps = null
  stopBatteryWatch()
}
