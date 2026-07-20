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

const PLUGIN_ID = '@forgeax-extension/wb-scene-generator'

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

export function stopBatteryWatch(): void {
  if (stopWatch) {
    stopWatch()
    stopWatch = null
  }
  batteryLoader = null
}

export async function getProjectRegistry(): Promise<ProjectRegistry> {
  if (registry) return registry
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
  reg.init()
  registry = reg
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
