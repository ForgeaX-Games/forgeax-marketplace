// Multi-project registry — kernel-level CRUD + open/activate cascade.
//
// A generic, plugin-agnostic registry for managing many pipelines ("projects")
// inside one workspace. Every ForgeaX app (scene, 3d-lowpoly, and any future
// task type) consumes the SAME registry: the per-project `type` is just a tag,
// and per-domain extras (assets, thumbnails, asset-detach policy) stay in the
// app via the optional hooks.
//
// Storage layout (under `workspaceRoot`):
//
//   <workspaceRoot>/
//     workspace.json                      ← { viewingProjectId, recentProjectIds, lastOpenedAt }
//     projects/
//       index.json                        ← { schemaVersion, projects: ProjectMeta[] }
//       <id>/
//         manifest.json                   ← ProjectManifest (incl. storage ref)
//         state/
//           graph.json                    ← SSOT (per-project, isolated)
//           history.jsonl                 ← append-only log (per-project, isolated)
//           outputs/                       ← execution cache (per-project, isolated)
//
// Each project maps to its own Runtime (created lazily through an app-supplied
// factory that points the kernel storage classes at the project's `state/`
// dir). `viewProject(id)` sets the UI viewing target; agent `openProject`
// acquires an exclusive lock without changing viewing. Pipeline routes are
// project-scoped; per-project history
// isolation therefore falls out for free — each Runtime owns its own
// history.jsonl path.
//
// Default-project backfill: on first init (no projects/index.json) the registry
// adopts the legacy implicit pipeline — the existing
// `<workspaceRoot>/state/graph.json` — as a default project (no file moves, so
// current users keep their work). New projects get `projects/<id>/state/...`.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { importPipelineGraph } from './import-graph.js'
import type { ImportGraphInput, ImportGraphOptions } from './import-graph.js'
import { collectCachedNodeIds } from './apply-batch.js'
import type { Runtime } from './runtime.js'

// Asset deletion policy on project delete (app interprets it; kernel just forwards).
export type AssetDeletePolicy = 'detach' | 'delete'

// Identity of whoever drives a project op, forwarded by the app's route layer from the tool-call
// `caller`. The exclusive-lock rules apply ONLY to kind:'ai' callers — humans (UI: 'user'/
// 'workbench') are never locked (final authority).
export interface CallerIdentity {
  kind: 'ai' | 'user' | 'workbench' | 'cli' | 'skill'
  agentId?: string
  sessionId?: string
}

// Current holder of a project's exclusive lock (process-lifetime only).
export interface ProjectLockInfo {
  agentId: string
  kind: CallerIdentity['kind']
  acquiredAt: string
  sessionId?: string
}

// Machine-readable lock-denial codes. `mutation-denied-not-open` is the ONLY
// recoverable one: it means no agent currently holds the (existing, active)
// project — the normal state after a backend restart wiped the in-memory lock
// table. The AI tool seam can transparently re-`open` and retry on this code.
// Every other code is a genuine conflict (held by a different agent, no active
// project, etc.) and must surface to the caller.
export type LockDeniedCode =
  | 'lock-requires-agent-id'
  | 'project-not-found'
  | 'project-locked-by-other'
  | 'agent-holds-another'
  | 'lock-not-owned'
  | 'mutation-denied-no-project'
  | 'mutation-denied-not-open'
  | 'mutation-denied-locked-by-other'

// Result of a lock op — discriminated so callers can surface `reason` verbatim.
// The failure variant carries a machine-readable `code` for programmatic
// recovery (the human-readable `reason` stays for logs / direct surfacing).
export type LockResult = { ok: true } | { ok: false; reason: string; code: LockDeniedCode }

// Per-project storage paths, stored relative to the workspace root for portability.
export interface ProjectStorageRef {
  // graph.json path, relative to workspaceRoot.
  graphFile: string
  // history.jsonl path, relative to workspaceRoot.
  historyFile: string
  // outputs/ root, relative to workspaceRoot.
  outputsDir: string
}

// On-disk per-project manifest (`projects/<id>/manifest.json`).
export interface ProjectManifest {
  schemaVersion: 1
  id: string
  // Free-form domain tag, e.g. 'scene' | 'lowpoly'. Drives battery filtering.
  type: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  // Relative path to a thumbnail image, if any (app-managed).
  thumbnail?: string
  storage: ProjectStorageRef
}

// Lightweight project descriptor surfaced in the index + list responses.
export interface ProjectMeta {
  id: string
  type: string
  name: string
  description: string
  thumbnail?: string
  createdAt: string
  updatedAt: string
}

// On-disk index (`projects/index.json`).
export interface ProjectIndex {
  schemaVersion: 1
  projects: ProjectMeta[]
}

// Workspace-level state (`workspace.json`). Invariant: viewingProjectId ∈ index.
export interface WorkspaceState {
  viewingProjectId: string | null
  recentProjectIds: string[]
  lastOpenedAt: string
  /** Populated at read time from the in-memory lock table (not persisted). */
  executingProjectIds?: string[]
}

// A full project record (manifest only; the graph is fetched via the Runtime).
export interface ProjectRecord {
  manifest: ProjectManifest
}

// Create-project input. `fromTemplate` seeds the graph via importPipelineGraph.
export interface CreateProjectInput {
  // Domain type tag. Defaults to the registry's `defaultType`.
  type?: string
  name: string
  description?: string
  // Explicit id (tests / migration). Defaults to a generated id.
  id?: string
  // Seed the new project's graph from a template graph (kernel reuses importPipelineGraph).
  fromTemplate?: ImportGraphInput
  // Extra import options when `fromTemplate` is given.
  templateOptions?: ImportGraphOptions
}

export interface UpdateProjectPatch {
  name?: string
  description?: string
  thumbnail?: string
  type?: string
}

export interface DeleteProjectOptions {
  assetPolicy?: AssetDeletePolicy
}

// App-supplied per-project Runtime factory (lets the app share one OpRegistry).
export interface ProjectRuntimeRequest {
  projectId: string
  // pipelineId === projectId (faithful Project.id === Pipeline.id invariant).
  pipelineId: string
  // Absolute graph.json path for this project.
  graphFile: string
  // Absolute history.jsonl path for this project.
  historyFile: string
  // Absolute outputs/ dir for this project.
  outputsDir: string
}

export type ProjectRuntimeFactory = (req: ProjectRuntimeRequest) => Runtime

export interface ProjectRegistryOptions {
  // Absolute workspace root that holds projects/ + workspace.json.
  workspaceRoot: string
  // Builds a Runtime targeting one project's isolated storage.
  createRuntime: ProjectRuntimeFactory
  // Default domain tag for new + backfilled projects. Default 'default'.
  defaultType?: string
  // Default name for the backfilled default project. Default 'Default'.
  defaultProjectName?: string
  // Id assigned to the backfilled default project. Default 'main'.
  defaultProjectId?: string
  // Relative dir (under workspaceRoot) of the legacy implicit pipeline's state to adopt as the default project on backfill. Default 'state'.
  legacyStateDir?: string
  // Optional asset cleanup hook on delete (app owns its asset library).
  onDeleteProjectAssets?: (projectId: string, policy: AssetDeletePolicy) => void | Promise<void>
}

const RECENT_LIMIT = 10

function nowIso(): string {
  return new Date().toISOString()
}

function genProjectId(prefix = 'p'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function readJsonSafe<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const dir = join(path, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8')
  renameSync(tmp, path)
}

function metaFromManifest(m: ProjectManifest): ProjectMeta {
  const meta: ProjectMeta = {
    id: m.id,
    type: m.type,
    name: m.name,
    description: m.description,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }
  if (m.thumbnail !== undefined) meta.thumbnail = m.thumbnail
  return meta
}

// Generic multi-project registry. One instance owns one workspace: call init() once at startup,
// thereafter getViewingRuntime() returns the UI viewing project's Runtime.
export class ProjectRegistry {
  private readonly root: string
  private readonly factory: ProjectRuntimeFactory
  private readonly defaultType: string
  private readonly defaultName: string
  private readonly defaultId: string
  private readonly legacyStateDir: string
  private readonly onDeleteAssets?: ProjectRegistryOptions['onDeleteProjectAssets']

  private index: ProjectIndex = { schemaVersion: 1, projects: [] }
  private workspace: WorkspaceState = {
    viewingProjectId: null,
    recentProjectIds: [],
    lastOpenedAt: '',
  }
  private readonly pool = new Map<string, Runtime>()
  private viewing: Runtime | null = null
  private initialized = false

  // ── exclusive lock table ─────────────────────────────────────────────────
  // In-memory only: this single backend process owns the authoritative active
  // project, so the lock lives here too. A backend restart clears all locks —
  // an agent whose backend restarted must re-`open` its project. Invariant:
  // at most one entry per projectId AND at most one per agentId (kept in sync
  // via the reverse index). Humans never appear in either map.
  private readonly locks = new Map<string, ProjectLockInfo>()
  private readonly agentLock = new Map<string, string>()

  constructor(opts: ProjectRegistryOptions) {
    this.root = opts.workspaceRoot
    this.factory = opts.createRuntime
    this.defaultType = opts.defaultType ?? 'default'
    this.defaultName = opts.defaultProjectName ?? 'Default'
    this.defaultId = opts.defaultProjectId ?? 'main'
    this.legacyStateDir = opts.legacyStateDir ?? 'state'
    this.onDeleteAssets = opts.onDeleteProjectAssets
  }

  // ── paths ────────────────────────────────────────────────────────────────

  private get projectsDir(): string {
    return join(this.root, 'projects')
  }
  private get indexPath(): string {
    return join(this.projectsDir, 'index.json')
  }
  private get workspacePath(): string {
    return join(this.root, 'workspace.json')
  }
  private manifestPath(id: string): string {
    return join(this.projectsDir, id, 'manifest.json')
  }
  private abs(relOrAbs: string): string {
    return isAbsolute(relOrAbs) ? relOrAbs : join(this.root, relOrAbs)
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  // Load index + workspace; backfill a default project on first run.
  init(): void {
    if (this.initialized) return
    const loadedIndex = readJsonSafe<ProjectIndex>(this.indexPath)
    if (loadedIndex && Array.isArray(loadedIndex.projects)) {
      this.index = { schemaVersion: 1, projects: loadedIndex.projects }
    }
    const loadedWs = readJsonSafe<WorkspaceState & { activeProjectId?: string | null }>(this.workspacePath)
    if (loadedWs) {
      this.workspace = {
        viewingProjectId: loadedWs.viewingProjectId ?? loadedWs.activeProjectId ?? null,
        recentProjectIds: Array.isArray(loadedWs.recentProjectIds) ? loadedWs.recentProjectIds : [],
        lastOpenedAt: loadedWs.lastOpenedAt ?? nowIso(),
      }
    }

    if (this.index.projects.length === 0) {
      this.backfillDefault()
    }

    // Drop a stale viewing id that no longer resolves to a project.
    if (
      this.workspace.viewingProjectId &&
      !this.index.projects.some((p) => p.id === this.workspace.viewingProjectId)
    ) {
      this.workspace.viewingProjectId = null
    }
    if (!this.workspace.viewingProjectId && this.index.projects.length > 0) {
      this.workspace.viewingProjectId = this.index.projects[0]!.id
    }
    this.saveWorkspace()

    if (this.workspace.viewingProjectId) {
      this.viewing = this.getRuntimeFor(this.workspace.viewingProjectId)
    }
    this.initialized = true
  }

  // Adopt the legacy implicit pipeline (`<workspaceRoot>/state/graph.json`) as a default project, in place — no file moves, so existing work survives.
  private backfillDefault(): void {
    const ts = nowIso()
    const manifest: ProjectManifest = {
      schemaVersion: 1,
      id: this.defaultId,
      type: this.defaultType,
      name: this.defaultName,
      description: '',
      createdAt: ts,
      updatedAt: ts,
      storage: {
        graphFile: join(this.legacyStateDir, 'graph.json'),
        historyFile: join(this.legacyStateDir, 'history.jsonl'),
        outputsDir: join(this.legacyStateDir, 'outputs'),
      },
    }
    writeJsonAtomic(this.manifestPath(this.defaultId), manifest)
    this.index = { schemaVersion: 1, projects: [metaFromManifest(manifest)] }
    writeJsonAtomic(this.indexPath, this.index)
    this.workspace.viewingProjectId = this.defaultId
    this.workspace.recentProjectIds = [this.defaultId]
  }

  // ── queries ──────────────────────────────────────────────────────────────

  listProjects(): ProjectMeta[] {
    return this.index.projects.map((p) => ({ ...p }))
  }

  getProject(id: string): ProjectRecord | null {
    const manifest = readJsonSafe<ProjectManifest>(this.manifestPath(id))
    if (!manifest) return null
    return { manifest }
  }

  getWorkspace(): WorkspaceState {
    return {
      ...this.workspace,
      recentProjectIds: [...this.workspace.recentProjectIds],
      executingProjectIds: this.listLockedProjectIds(),
    }
  }

  getViewingProjectId(): string | null {
    return this.workspace.viewingProjectId
  }

  /** All project ids currently held by an AI agent lock. */
  listLockedProjectIds(): string[] {
    return [...this.locks.keys()]
  }

  // ── exclusive lock (open-then-operate, one agent ↔ one project) ──────────

  // Acquire an AI agent's exclusive lock on a project (humans always pass). For kind:'ai' the project must exist, must not be held by a different agent, and the agent must not already hold another project; re-opening the project the agent already holds is idempotent.
  acquireProjectLock(projectId: string, caller: CallerIdentity): LockResult {
    if (caller.kind !== 'ai') return { ok: true }
    if (!caller.agentId) {
      return { ok: false, code: 'lock-requires-agent-id', reason: 'lock-requires-agent-id: caller.kind is ai but agentId is missing' }
    }
    if (!this.index.projects.some((p) => p.id === projectId)) {
      return { ok: false, code: 'project-not-found', reason: `project-not-found: ${projectId}` }
    }
    const existing = this.locks.get(projectId)
    if (existing && existing.agentId !== caller.agentId) {
      return {
        ok: false,
        code: 'project-locked-by-other',
        reason: `project-locked-by-other: project ${projectId} is held by agent ${existing.agentId}`,
      }
    }
    const held = this.agentLock.get(caller.agentId)
    if (held && held !== projectId) {
      return {
        ok: false,
        code: 'agent-holds-another',
        reason: `agent-holds-another: agent ${caller.agentId} already holds project ${held}; close it first`,
      }
    }
    this.locks.set(projectId, {
      agentId: caller.agentId,
      kind: caller.kind,
      acquiredAt: nowIso(),
      ...(caller.sessionId ? { sessionId: caller.sessionId } : {}),
    })
    this.agentLock.set(caller.agentId, projectId)
    return { ok: true }
  }

  // Release an AI agent's lock. Idempotent; rejects a wrong-agent release.
  releaseProjectLock(projectId: string, caller: CallerIdentity): LockResult {
    if (caller.kind !== 'ai') return { ok: true }
    const lock = this.locks.get(projectId)
    if (!lock) return { ok: true }
    if (lock.agentId !== caller.agentId) {
      return {
        ok: false,
        code: 'lock-not-owned',
        reason: `lock-not-owned: project ${projectId} is held by agent ${lock.agentId}, not ${caller.agentId ?? '(none)'}`,
      }
    }
    this.locks.delete(projectId)
    this.agentLock.delete(lock.agentId)
    return { ok: true }
  }

  // Gate a mutation against the lock. Humans may mutate any existing project
  // when addressed by id (project-scoped routes). An AI caller may mutate ONLY
  // a project it holds an exclusive lock on — independent of the UI viewing
  // project, so multiple agents can execute different projects concurrently.
  checkMutationAccess(projectId: string | null, caller: CallerIdentity): LockResult {
    if (caller.kind !== 'ai') {
      if (!projectId) {
        return {
          ok: false,
          code: 'mutation-denied-no-project',
          reason: 'mutation-denied: project id is required',
        }
      }
      if (!this.index.projects.some((p) => p.id === projectId)) {
        return { ok: false, code: 'project-not-found', reason: `project-not-found: ${projectId}` }
      }
      return { ok: true }
    }
    if (!projectId) {
      return { ok: false, code: 'mutation-denied-no-project', reason: 'mutation-denied: project id is required' }
    }
    const lock = this.locks.get(projectId)
    if (!lock) {
      // RECOVERABLE: no agent holds this (existing, active) project. The normal
      // state after a backend restart wiped the in-memory lock table — the AI
      // tool seam re-`open`s and retries on this exact code. Distinct from
      // `locked-by-other` so a genuine conflict is never auto-retried.
      return {
        ok: false,
        code: 'mutation-denied-not-open',
        reason: `mutation-denied: project ${projectId} is not open by any agent`,
      }
    }
    if (!caller.agentId || lock.agentId !== caller.agentId) {
      return {
        ok: false,
        code: 'mutation-denied-locked-by-other',
        reason: `mutation-denied: project ${projectId} is locked by agent ${lock.agentId}`,
      }
    }
    return { ok: true }
  }

  // Current lock holder for a project (or null). For UI badges / diagnostics.
  getProjectLock(projectId: string): ProjectLockInfo | null {
    const lock = this.locks.get(projectId)
    return lock ? { ...lock } : null
  }

  /** All active agent locks — for workspace diagnostics / project panel. */
  listAllProjectLocks(): Array<{ projectId: string } & ProjectLockInfo> {
    return [...this.locks.entries()].map(([projectId, lock]) => ({ projectId, ...lock }))
  }

  // The UI viewing project's Runtime. Throws if init() has not run / no project.
  getViewingRuntime(): Runtime {
    if (!this.viewing) {
      throw new Error('[project-registry] no viewing runtime — call init() first')
    }
    return this.viewing
  }

  /** @deprecated Use getViewingRuntime(). */
  getActiveRuntime(): Runtime {
    return this.getViewingRuntime()
  }

  /** @deprecated Use getViewingProjectId(). */
  getActiveProjectId(): string | null {
    return this.getViewingProjectId()
  }

  // Get (or lazily build) the Runtime for a project by id.
  getRuntimeFor(id: string): Runtime {
    const cached = this.pool.get(id)
    if (cached) return cached
    const manifest = readJsonSafe<ProjectManifest>(this.manifestPath(id))
    if (!manifest) throw new Error(`[project-registry] project not found: ${id}`)
    const rt = this.factory({
      projectId: id,
      pipelineId: id,
      graphFile: this.abs(manifest.storage.graphFile),
      historyFile: this.abs(manifest.storage.historyFile),
      outputsDir: this.abs(manifest.storage.outputsDir),
    })
    this.pool.set(id, rt)
    return rt
  }

  // ── mutations ──────────────────────────────────────────────────────────

  // Create a project. With `fromTemplate`, the new project's graph is seeded by the kernel importPipelineGraph (single atomic batch → graph:applied), the same path the editor Open / CLI import use; without it, an empty graph is bootstrapped so getPipeline returns a (nodes:{}) snapshot.
  async createProject(input: CreateProjectInput): Promise<ProjectMeta> {
    const name = (input.name ?? '').trim()
    if (!name) throw new Error('[project-registry] project name is required')

    const id = input.id ?? genProjectId('p')
    if (this.index.projects.some((p) => p.id === id)) {
      throw new Error(`[project-registry] project id already exists: ${id}`)
    }
    const ts = nowIso()
    const type = input.type ?? this.defaultType
    const stateRel = join('projects', id, 'state')
    const manifest: ProjectManifest = {
      schemaVersion: 1,
      id,
      type,
      name,
      description: input.description ?? '',
      createdAt: ts,
      updatedAt: ts,
      storage: {
        graphFile: join(stateRel, 'graph.json'),
        historyFile: join(stateRel, 'history.jsonl'),
        outputsDir: join(stateRel, 'outputs'),
      },
    }
    mkdirSync(join(this.projectsDir, id), { recursive: true })
    writeJsonAtomic(this.manifestPath(id), manifest)
    this.index.projects.push(metaFromManifest(manifest))
    writeJsonAtomic(this.indexPath, this.index)

    try {
      const rt = this.getRuntimeFor(id)
      if (input.fromTemplate) {
        const res = await importPipelineGraph(rt, input.fromTemplate, {
          mode: 'replace',
          actor: 'project:template',
          label: `New project from template`,
          ...(input.templateOptions ?? {}),
        })
        if (res.status !== 'ok') {
          throw new Error(`template seed rejected: ${res.reason ?? 'unknown'}`)
        }
      } else {
        // Bootstrap an empty, hash-valid graph so reads succeed immediately.
        rt.graph.save({
          schemaVersion: 1,
          id,
          createdAt: ts,
          updatedAt: ts,
          nodes: {},
          edges: {},
        })
      }
    } catch (e) {
      // Roll back the half-created project so the index stays consistent.
      this.pool.delete(id)
      this.index.projects = this.index.projects.filter((p) => p.id !== id)
      writeJsonAtomic(this.indexPath, this.index)
      rmSync(join(this.projectsDir, id), { recursive: true, force: true })
      throw e
    }

    return metaFromManifest(manifest)
  }

  updateProject(id: string, patch: UpdateProjectPatch): ProjectMeta {
    const manifest = readJsonSafe<ProjectManifest>(this.manifestPath(id))
    if (!manifest) throw new Error(`[project-registry] project not found: ${id}`)
    if (patch.name !== undefined) manifest.name = patch.name.trim() || manifest.name
    if (patch.description !== undefined) manifest.description = patch.description
    if (patch.thumbnail !== undefined) manifest.thumbnail = patch.thumbnail
    if (patch.type !== undefined) manifest.type = patch.type
    manifest.updatedAt = nowIso()
    writeJsonAtomic(this.manifestPath(id), manifest)
    const meta = metaFromManifest(manifest)
    this.index.projects = this.index.projects.map((p) => (p.id === id ? meta : p))
    writeJsonAtomic(this.indexPath, this.index)
    return meta
  }

  // Set the UI viewing project: bumps recents and persists workspace. Does NOT
  // acquire or release agent locks.
  viewProject(id: string): Runtime {
    if (!readJsonSafe<ProjectManifest>(this.manifestPath(id))) {
      throw new Error(`[project-registry] project not found: ${id}`)
    }
    this.workspace.viewingProjectId = id
    this.workspace.recentProjectIds = [
      id,
      ...this.workspace.recentProjectIds.filter((rid) => rid !== id),
    ].slice(0, RECENT_LIMIT)
    this.saveWorkspace()
    const rt = this.getRuntimeFor(id)
    const graph = rt.graph.load()
    const pruned = rt.outputs.pruneByRetention(
      graph ? { protectedNodeIds: collectCachedNodeIds(graph) } : undefined,
    )
    if (pruned.removed > 0) {
      process.stderr.write(
        `[project-registry] pruned ${pruned.removed} output dir(s) (${Math.round(pruned.freedBytes / (1024 * 1024))}MB) on view ${id}\n`,
      )
    }
    this.viewing = rt
    return rt
  }

  /** @deprecated Use viewProject(). */
  activateProject(id: string): Runtime {
    return this.viewProject(id)
  }

  /**
   * Agent open: acquire exclusive lock and ensure the project's Runtime exists
   * in the pool. For an AI caller this ALSO makes the project the UI viewing
   * target (see `viewProject`).
   *
   * Why: every host app has exactly one shared render surface (the embedded
   * `?pane=urdf`-style viewer / headless renderer) and its screenshot-capture
   * and glb-export routes key their target project off `getViewingProjectId()`
   * — never off any agent's lock. Before this, `projects.open` deliberately
   * left viewing untouched, but no AI-facing tool exists to call `viewProject`
   * either (it's a human-UI-only route). Net effect: an agent's own
   * `projects.open` → `screenshot.capture`/`export-glb` calls permanently
   * 409'd with "project X is not the viewing project" (or silently rendered
   * some unrelated project) unless a human happened to already be looking at
   * exactly that project. Folding the view-switch into `openProject` for AI
   * callers makes the tool-documented "打开/查看的项目" (open/viewed project)
   * wording actually true, and lets a human watch the agent's project live
   * (the existing `project:viewing` WS broadcast cross-client sync already
   * supports this — it just never fired from here). A human's explicit
   * `viewProject` call still always wins the next time it's invoked; this only
   * changes what an AI `open` does on its own.
   */
  openProject(projectId: string, caller: CallerIdentity): LockResult {
    const lock = this.acquireProjectLock(projectId, caller)
    if (!lock.ok) return lock
    if (caller.kind === 'ai') {
      this.viewProject(projectId)
    } else {
      this.getRuntimeFor(projectId)
    }
    return { ok: true }
  }

  async deleteProject(id: string, opts: DeleteProjectOptions = {}): Promise<void> {
    const manifest = readJsonSafe<ProjectManifest>(this.manifestPath(id))
    if (!manifest) throw new Error(`[project-registry] project not found: ${id}`)

    if (this.onDeleteAssets) {
      await this.onDeleteAssets(id, opts.assetPolicy ?? 'detach')
    }

    // Drop any exclusive lock on the project being removed.
    const lock = this.locks.get(id)
    if (lock) {
      this.locks.delete(id)
      this.agentLock.delete(lock.agentId)
    }

    // Drop the runtime and remove every storage artefact this project owns.
    this.pool.get(id)?.dispose()
    this.pool.delete(id)
    rmSync(this.abs(manifest.storage.outputsDir), { recursive: true, force: true })
    rmSync(this.abs(manifest.storage.historyFile), { force: true })
    rmSync(this.abs(manifest.storage.graphFile), { force: true })
    rmSync(join(this.projectsDir, id), { recursive: true, force: true })

    this.index.projects = this.index.projects.filter((p) => p.id !== id)
    writeJsonAtomic(this.indexPath, this.index)
    this.workspace.recentProjectIds = this.workspace.recentProjectIds.filter((rid) => rid !== id)

    if (this.workspace.viewingProjectId === id) {
      const next = this.index.projects[0]
      if (next) {
        this.workspace.viewingProjectId = next.id
        this.viewing = this.getRuntimeFor(next.id)
      } else {
        // Never leave the workspace empty — mint a fresh default.
        const meta = await this.createProject({ type: this.defaultType, name: this.defaultName })
        this.workspace.viewingProjectId = meta.id
        this.viewing = this.getRuntimeFor(meta.id)
      }
    }
    this.saveWorkspace()
  }

  setWorkspace(patch: Partial<Pick<WorkspaceState, 'viewingProjectId' | 'recentProjectIds'>> & { activeProjectId?: string | null }): WorkspaceState {
    const viewingId = patch.viewingProjectId ?? patch.activeProjectId
    if (viewingId) {
      this.viewProject(viewingId)
    }
    if (patch.recentProjectIds !== undefined) {
      this.workspace.recentProjectIds = patch.recentProjectIds.slice(0, RECENT_LIMIT)
      this.saveWorkspace()
    }
    return this.getWorkspace()
  }

  // ── internals ──────────────────────────────────────────────────────────

  private saveWorkspace(): void {
    this.workspace.lastOpenedAt = nowIso()
    writeJsonAtomic(this.workspacePath, this.workspace)
  }
}
