import { createRuntime, createBatteryLoader, OpRegistry, ProjectRegistry } from '@forgeax/node-runtime'
import type { Runtime, BatteryLoader, LoaderEvent } from '@forgeax/node-runtime'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

/** Workspace root holding all projects. Read at call-time so tests/smokes that
 *  set FORGEAX_PROJECT_ROOT before the first backend call get isolation. */
function resolveWorkspaceRoot(): string {
  return process.env.FORGEAX_PROJECT_ROOT ?? resolve(repoRoot, '.forgeax-runtime')
}

const PLUGIN_ID = '@forgeax-plugin/wb-scene-generator'

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

// Scan the plugin's batteries ONCE into a shared OpRegistry; every per-project
// runtime reuses it, so opening a project never re-scans ops. In dev the same
// loader keeps a chokidar watch so battery edits hot-reload the registry.
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

/**
 * The workspace's multi-project registry. Backs every route: project CRUD,
 * activate, and `getRuntime()` (the active project's runtime). On first init it
 * backfills a default project ('main') that points at the existing implicit
 * `<workspaceRoot>/state/graph.json`, so current users keep their work.
 */
export async function getProjectRegistry(): Promise<ProjectRegistry> {
  if (registry) return registry
  // Read FORGEAX_PROJECT_ROOT at build time (not module-load) so tests/smokes
  // that set it before the first backend call get their isolated workspace.
  const workspaceRoot = resolveWorkspaceRoot()
  sharedOps = sharedOps ?? (await buildSharedOps())
  const ops = sharedOps
  const reg = new ProjectRegistry({
    workspaceRoot,
    defaultType: 'scene',
    defaultProjectName: 'Default Scene',
    defaultProjectId: 'main',
    legacyStateDir: 'state',
    createRuntime: (req) =>
      createRuntime({
        projectRoot: workspaceRoot,
        pipelineId: req.pipelineId,
        pluginId: PLUGIN_ID,
        registry: ops,
        // Each project owns isolated graph/history/outputs; assets stay shared
        // at <workspaceRoot>/assets (the runtime's default assetsDir).
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

/** The active project's Runtime. All existing routes funnel through this. */
export async function getRuntime(): Promise<Runtime> {
  const reg = await getProjectRegistry()
  return reg.getActiveRuntime()
}

/**
 * Absolute directory of the active project — the parent of its `state/` dir,
 * derived from the manifest's graphFile (`<projDir>/state/graph.json`). Works
 * for both the legacy `main` project (dir = workspaceRoot) and new projects
 * (dir = `<workspaceRoot>/projects/<id>`). Other services (e.g. the baked
 * scene-layer store) persist per-project files here, alongside `state/`.
 */
export async function getActiveProjectDir(): Promise<string> {
  const reg = await getProjectRegistry()
  const ws = resolveWorkspaceRoot()
  const id = reg.getActiveProjectId()
  const rec = id ? reg.getProject(id) : null
  const graphRel = rec?.manifest.storage.graphFile ?? join('state', 'graph.json')
  const graphAbs = isAbsolute(graphRel) ? graphRel : join(ws, graphRel)
  return dirname(dirname(graphAbs))
}

/**
 * Absolute directory of ANY project by id (not just the active one) — same
 * `<projDir>/state/graph.json` → `<projDir>` derivation as `getActiveProjectDir`.
 * Returns null when the id is unknown. Lets read-only probes (e.g. the delete
 * dialog's produced-asset check) inspect a project without activating it.
 */
export async function getProjectDir(id: string): Promise<string | null> {
  const reg = await getProjectRegistry()
  const rec = reg.getProject(id)
  if (!rec) return null
  const ws = resolveWorkspaceRoot()
  const graphRel = rec.manifest.storage.graphFile
  const graphAbs = isAbsolute(graphRel) ? graphRel : join(ws, graphRel)
  return dirname(dirname(graphAbs))
}
