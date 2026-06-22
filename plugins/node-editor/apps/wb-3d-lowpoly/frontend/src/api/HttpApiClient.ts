import type { ActivateProjectResult, ApiClient, CreateProjectRequest } from '@forgeax/node-runtime-react'
import type {
  ApplyBatchOptions,
  ApplyBatchResult,
  AssetDeletePolicy,
  ExecutionResult,
  GraphEdge,
  GraphNode,
  HistoryEntryV1,
  HistoryQuery,
  ImportPipelineExecuteOptions,
  ImportPipelineResponse,
  ImportTemplate,
  NodeFilter,
  NodeGroup,
  Op,
  OpSpec,
  PipelineSnapshot,
  ProjectMeta,
  ProjectRecord,
  RuntimeChannel,
  RuntimeEvent,
  WorkspaceState,
} from '@forgeax/node-runtime'

type Listener = (e: RuntimeEvent) => void

interface GroupTemplateBattery {
  id: string
  name: string
  nameEn?: string
  category: string
  description?: string
  version?: string
  iconSvg?: string
  displayGroup?: string
  sourcePath?: string
}

export interface HttpApiClientOptions {
  baseUrl?: string
  pipelineId: string
}

/**
 * Concrete ApiClient that talks to the backend bridge over fetch + WebSocket.
 *
 * Graph reactivity has a SINGLE source: the kernel bus emits `graph:applied` on
 * a committed `applyBatch` (and suppresses it for layout-only batches), the
 * backend `/ws` binding fans it out, and our socket forwards it to the 'graph'
 * listeners. This client deliberately does NOT synthesize a local `graph:applied`
 * after a batch POST — that was a redundant second source that double-fired
 * `loadPipeline` (and reset previews) on every mutation.
 */
export class HttpApiClient implements ApiClient {
  readonly pipelineId: string
  private base: string
  private ws: WebSocket | null = null
  private listeners = new Map<RuntimeChannel, Set<Listener>>()
  private disposed = false
  private wsReconnectAttempts = 0
  private wsReconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: HttpApiClientOptions) {
    this.pipelineId = opts.pipelineId
    this.base = opts.baseUrl ?? ''
  }

  private async get<T>(path: string): Promise<T> {
    const r = await fetch(`${this.base}${path}`, { method: 'GET' })
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
    return (await r.json()) as T
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
    return (await r.json()) as T
  }

  private async put<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.base}${path}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
    return (await r.json()) as T
  }

  private async del<T>(path: string): Promise<T> {
    const r = await fetch(`${this.base}${path}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`${path} → ${r.status}`)
    return (await r.json()) as T
  }

  async applyBatch(ops: readonly Op[], opts?: ApplyBatchOptions): Promise<ApplyBatchResult> {
    // No local graph:applied synthesis — the backend WS forwards the kernel's
    // single graph:applied (layout-only batches emit none). See the class doc.
    return this.post<ApplyBatchResult>('/api/v1/batch', { ops, opts })
  }

  getPipeline(): Promise<PipelineSnapshot | null> {
    return this.get<PipelineSnapshot | null>('/api/v1/pipeline')
  }

  getNode(nodeId: string): Promise<GraphNode | null> {
    return this.get<GraphNode | null>(`/api/v1/nodes/${encodeURIComponent(nodeId)}`)
  }

  listNodes(_filter?: NodeFilter): Promise<readonly GraphNode[]> {
    return this.get<readonly GraphNode[]>('/api/v1/nodes')
  }

  listEdges(): Promise<readonly GraphEdge[]> {
    return this.get<readonly GraphEdge[]>('/api/v1/edges')
  }

  async getNodeOutput(nodeId: string, portId: string): Promise<unknown> {
    const r = await this.get<{ value: unknown }>(
      `/api/v1/nodes/${encodeURIComponent(nodeId)}/outputs/${encodeURIComponent(portId)}`,
    )
    return r.value
  }

  getHistory(_opts?: HistoryQuery): Promise<readonly HistoryEntryV1[]> {
    return this.get<readonly HistoryEntryV1[]>('/api/v1/history')
  }

  listOps(): Promise<readonly OpSpec[]> {
    return this.get<readonly OpSpec[]>('/api/v1/ops')
  }

  getGroup(groupId: string): Promise<NodeGroup | null> {
    return this.get<NodeGroup | null>(`/api/v1/groups/${encodeURIComponent(groupId)}`)
  }

  listGroups(): Promise<readonly NodeGroup[]> {
    return this.get<readonly NodeGroup[]>('/api/v1/groups')
  }

  async resolveAssetPath(template: string, _vars?: Record<string, string>): Promise<string> {
    return template
  }

  listImportTemplates(): Promise<readonly ImportTemplate[]> {
    return this.get<readonly ImportTemplate[]>('/api/v1/pipeline/templates')
  }

  importPipelineFile(req: {
    path: string
    source?: string
    options?: ImportPipelineExecuteOptions
  }): Promise<ImportPipelineResponse> {
    return this.post<ImportPipelineResponse>('/api/v1/pipeline/import', {
      file: { path: req.path, source: req.source },
      options: req.options,
    })
  }

  exportPipelineFile(req: { name?: string; source?: string }): Promise<{ path: string; name: string }> {
    return this.post<{ path: string; name: string }>('/api/v1/pipeline/export', req)
  }

  listGroupTemplates(scope: 'all' | 'groups' | 'templates' = 'all'): Promise<readonly GroupTemplateBattery[]> {
    return this.get<readonly GroupTemplateBattery[]>(`/api/v1/group-templates?scope=${scope}`)
  }

  loadGroupTemplate(
    groupId: string,
    opts?: { scope?: 'groups' | 'templates' },
  ): Promise<NodeGroup | null> {
    const scope = opts?.scope
    const suffix = scope ? `?scope=${scope}` : ''
    return this.get<NodeGroup | null>(`/api/v1/group-templates/${encodeURIComponent(groupId)}${suffix}`)
  }

  saveGroupTemplate(req: {
    group: NodeGroup
    categoryName: string
    batteryName: string
  }): Promise<{ filePath: string; groupId: string; categoryName: string; batteryName: string }> {
    return this.post('/api/v1/group-templates/save', req)
  }

  listTemplateCategories(): Promise<readonly string[]> {
    return this.get<readonly string[]>('/api/v1/group-templates/categories')
  }

  /** Execute the pipeline (or a single node) via the backend bridge. */
  execute(request?: { nodeId?: string }): Promise<ExecutionResult> {
    return this.post('/api/v1/execute', request ?? {}) as Promise<ExecutionResult>
  }

  listProjects(): Promise<readonly ProjectMeta[]> {
    return this.get<readonly ProjectMeta[]>('/api/v1/projects')
  }

  getProject(id: string): Promise<ProjectRecord | null> {
    return this.get<ProjectRecord | null>(`/api/v1/projects/${encodeURIComponent(id)}`)
  }

  createProject(req: CreateProjectRequest): Promise<ProjectMeta> {
    return this.post<ProjectMeta>('/api/v1/projects', req)
  }

  updateProject(
    id: string,
    patch: { name?: string; description?: string; thumbnail?: string; type?: string },
  ): Promise<ProjectMeta> {
    return this.put<ProjectMeta>(`/api/v1/projects/${encodeURIComponent(id)}`, patch)
  }

  deleteProject(id: string, opts?: { assetPolicy?: AssetDeletePolicy }): Promise<{ ok: true; workspace: WorkspaceState }> {
    const q = opts?.assetPolicy ? `?assetPolicy=${encodeURIComponent(opts.assetPolicy)}` : ''
    return this.del<{ ok: true; workspace: WorkspaceState }>(`/api/v1/projects/${encodeURIComponent(id)}${q}`)
  }

  activateProject(id: string): Promise<ActivateProjectResult> {
    return this.post<ActivateProjectResult>(`/api/v1/projects/${encodeURIComponent(id)}/activate`, {})
  }

  getWorkspace(): Promise<WorkspaceState> {
    return this.get<WorkspaceState>('/api/v1/workspace')
  }

  setWorkspace(patch: Partial<WorkspaceState>): Promise<WorkspaceState> {
    return this.put<WorkspaceState>('/api/v1/workspace', patch)
  }

  subscribe(channel: RuntimeChannel, listener: (e: RuntimeEvent) => void): () => void {
    if (!this.listeners.has(channel)) this.listeners.set(channel, new Set())
    this.listeners.get(channel)!.add(listener)
    this.ensureSocket()
    return () => {
      this.listeners.get(channel)?.delete(listener)
    }
  }

  private ensureSocket(): void {
    // Defensive: in test/non-browser envs there may be no WebSocket global or
    // no `location`; skip socket creation there. Graph reactivity then requires
    // the host to deliver runtime events through this socket once available.
    if (this.ws || typeof WebSocket === 'undefined') return
    if (!this.base.startsWith('http') && typeof location === 'undefined') return
    const wsBase = this.base.startsWith('http')
      ? this.base.replace(/^http/, 'ws')
      : `${location.origin.replace(/^http/, 'ws')}`
    const sock = new WebSocket(`${wsBase}/ws`)
    this.ws = sock
    sock.onopen = () => {
      this.wsReconnectAttempts = 0
      sock.send(JSON.stringify({ action: 'subscribe', channels: ['graph', 'execution', 'asset'] }))
    }
    sock.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { event: string; payload: RuntimeEvent }
        if (msg.event !== 'runtime') return
        const kind = (msg.payload as { kind?: string }).kind ?? ''
        const channel: RuntimeChannel = kind.startsWith('exec')
          ? 'execution'
          : kind.startsWith('asset')
            ? 'asset'
            : 'graph'
        this.listeners.get(channel)?.forEach((l) => l(msg.payload))
      } catch {
        /* ignore malformed frames */
      }
    }
    sock.onerror = () => { try { sock.close() } catch { /* noop */ } }
    sock.onclose = () => {
      this.ws = null
      // Reconnect on drop so graph/exec reactivity (URDF live-sync in the
      // headless renderer + the human panel) survives a stack restart or WS
      // blip. Without this, a single drop permanently stops exec:completed →
      // the viewer never loads the model → screenshot/glb export see an empty
      // scene. Backoff capped at 5s; only while there are listeners.
      if (this.disposed || this.listeners.size === 0 || this.wsReconnectTimer) return
      const delay = Math.min(5000, 500 * 2 ** this.wsReconnectAttempts)
      this.wsReconnectAttempts += 1
      this.wsReconnectTimer = setTimeout(() => {
        this.wsReconnectTimer = null
        if (!this.disposed && !this.ws && this.listeners.size > 0) this.ensureSocket()
      }, delay)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.wsReconnectTimer) { clearTimeout(this.wsReconnectTimer); this.wsReconnectTimer = null }
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
  }
}
