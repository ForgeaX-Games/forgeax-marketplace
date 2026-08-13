import { createRuntime, createBatteryLoader, OpRegistry, ProjectRegistry } from '@forgeax/node-runtime'
import type { Runtime, BatteryLoader, LoaderEvent } from '@forgeax/node-runtime'
import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

export function resolveWorkspaceRoot(): string {
  return process.env.FORGEAX_PROJECT_ROOT ?? resolve(repoRoot, '.forgeax-runtime')
}

/**
 * Shared Studio games tree: `<instance>/.forgeax/games`.
 *
 * Workbench plugins get FORGEAX_PROJECT_ROOT = `.forgeax/workbench/<pluginId>/`.
 * Derive the sibling shared games dir from that layout alone — no host env vars.
 * Standalone / test (no workbench segment) falls back to `<workspace>/.forgeax/games`.
 */
export function resolveSharedGamesRoot(): string {
  const ws = resolveWorkspaceRoot()
  const norm = ws.replace(/\\/g, '/')
  // <instance>/.forgeax/workbench/<pluginId> → <instance>/.forgeax/games
  if (/(?:^|\/)\.forgeax\/workbench\//.test(norm)) {
    return resolve(ws, '..', '..', 'games')
  }
  return resolve(ws, '.forgeax', 'games')
}

const PLUGIN_ID = '@forgeax-plugin/wb-scene-generator'

let registry: ProjectRegistry | null = null
let sharedOps: OpRegistry | null = null
let batteryLoader: BatteryLoader | null = null
let stopWatch: (() => void) | null = null

function batteryWatchEnabled(): boolean {
  const flag = process.env.FORGEAX_BATTERY_WATCH
  if (flag === '1' || flag === 'true') return true
  if (flag === '0' || flag === 'false') return false
  const env = process.env.NODE_ENV
  return env !== 'production' && env !== 'test'
}

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
  // This runs exactly once per backend process lifetime, lazily on whichever
  // HTTP request first calls getProjectRegistry() — in practice that's
  // whatever the frontend fires first on initial page load (loadBatteries()
  // or the first /view). scan() sequentially `await import()`s every
  // battery's index.ts (300-500+ files across the shared + app batteries
  // dirs) — under a TS dev loader (tsx/ts-node, no prebuilt dist) each import
  // pays a real per-file transpile+eval cost, so this can add up to real
  // seconds. Nothing before this point has any timing, so "opening the very
  // first project after a backend restart feels slower than switching
  // between already-open ones later" was previously invisible in any trace
  // log — the switch-trace/output-batch-trace timers only start once this
  // promise has already resolved.
  const __t0 = Date.now()
  const ops = new OpRegistry()
  const watch = batteryWatchEnabled()
  const loader = createBatteryLoader(ops, {
    pluginId: PLUGIN_ID,
    scanDirs: resolveBatteryScanRoots(repoRoot),
    layout: 'flexible',
    watch,
  })
  const res = await loader.scan()
  const __t1 = Date.now()
  for (const e of res.errors) console.warn(`[battery skip] ${e.dir}: ${e.reason}`)
  const mem = process.memoryUsage()
  console.log(
    `[runtime] loaded ${res.added} ops (${res.errors.length} skipped)${watch ? ' [hot-reload on]' : ''} ` +
      `[cold-start-trace] batteryScan=${__t1 - __t0}ms rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
  )
  if (watch) {
    batteryLoader = loader
    loader.subscribe(broadcastLoaderEvent)
    stopWatch = loader.startWatching()
  }
  return ops
}

export function stopBatteryWatch(): void {
  if (stopWatch) {
    stopWatch()
    stopWatch = null
  }
  batteryLoader = null
}

export async function getProjectRegistry(): Promise<ProjectRegistry> {
  if (registry) return registry
  const __t0 = Date.now()
  const workspaceRoot = resolveWorkspaceRoot()
  sharedOps = sharedOps ?? (await buildSharedOps())
  const __t1 = Date.now()
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
        createExecutionContext: (base) => ({
          ...base,
          log: (level, message) => {
            if (level === 'error') console.error(`[exec] ${message}`)
            else if (level === 'warn') console.warn(`[exec] ${message}`)
            else if (process.env.FORGEAX_EXEC_DEBUG) console.log(`[exec:${level}] ${message}`)
          },
        }),
        layout: {
          graphFile: req.graphFile,
          historyFile: req.historyFile,
          outputsDir: req.outputsDir,
        },
      }),
  })
  const __t2 = Date.now()
  reg.init()
  const __t3 = Date.now()
  registry = reg
  // First-ever call in this process only (subsequent calls return the cached
  // `registry` before reaching this line at all) — this is the true
  // "opening the first project" cold-start cost, wholly separate from the
  // per-project-switch costs already covered by [switch-trace].
  console.log(
    `[cold-start-trace] getProjectRegistry TOTAL=${__t3 - __t0}ms (buildSharedOps=${__t1 - __t0}ms newProjectRegistry=${__t2 - __t1}ms reg.init=${__t3 - __t2}ms)`,
  )
  return reg
}

/** The UI viewing project's Runtime (legacy alias). */
export async function getRuntime(): Promise<Runtime> {
  const reg = await getProjectRegistry()
  return reg.getViewingRuntime()
}

export async function getRuntimeForProject(projectId: string): Promise<Runtime> {
  const reg = await getProjectRegistry()
  if (!reg.getProject(projectId)) throw new Error(`project not found: ${projectId}`)
  return reg.getRuntimeFor(projectId)
}

export async function getViewingProjectDir(): Promise<string> {
  const reg = await getProjectRegistry()
  const ws = resolveWorkspaceRoot()
  const id = reg.getViewingProjectId()
  const rec = id ? reg.getProject(id) : null
  const graphRel = rec?.manifest.storage.graphFile ?? join('state', 'graph.json')
  const graphAbs = isAbsolute(graphRel) ? graphRel : join(ws, graphRel)
  return dirname(dirname(graphAbs))
}

/** @deprecated Use getViewingProjectDir(). */
export async function getActiveProjectDir(): Promise<string> {
  return getViewingProjectDir()
}

export async function getProjectDir(id: string): Promise<string | null> {
  const reg = await getProjectRegistry()
  const rec = reg.getProject(id)
  if (!rec) return null
  const ws = resolveWorkspaceRoot()
  const graphRel = rec.manifest.storage.graphFile
  const graphAbs = isAbsolute(graphRel) ? graphRel : join(ws, graphRel)
  return dirname(dirname(graphAbs))
}
