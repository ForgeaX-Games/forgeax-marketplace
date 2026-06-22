// API adapter: the legacy editor's `apiService` surface, rewired onto the
// kernel ApiClient. Only the methods the GENERIC editor stores call are
// implemented. App-level methods (projects / workspace / config / frames /
// assets / saved-file browser) are omitted; the few the stores still reference
// are kept as thin no-op stubs and called out in the doc comments.
//
// The adapter returns plain values (not the legacy `{ data }` envelope); the
// stores ported in this stage are updated to consume these shapes directly.

import type { ActivateProjectResult, ApiClient, CreateProjectRequest, GroupTemplateBattery, PromptDto, TextPresetDto } from '../../api/ApiClient.js'
import type {
  AssetDeletePolicy,
  ExecutionResult,
  HistoryEntryV1,
  HistoryQuery,
  ImportPipelineExecuteOptions,
  ImportPipelineResponse,
  ImportTemplate,
  NodeGroup as KernelNodeGroup,
  Op,
  ProjectMeta,
  ProjectRecord,
  WorkspaceState,
} from '@forgeax/node-runtime'

import type {
  Battery,
  BatteryCategory,
  BatteryOrder,
  NodeGroup,
  Pipeline,
} from '../types.js'
import {
  diffPipelineToOps,
  editorGroupToKernelGroup,
  kernelGroupToEditorGroup,
  legacyPipelineToOps,
  opSpecToBattery,
  snapshotToPipeline,
} from './mappers.js'

/** Result of an in-editor inline import (built client-side, applied via applyBatch). */
export interface ImportPipelineResult extends ApplyResult {
  nodeIdMap?: Record<string, string>
}

/**
 * Structured diagnostic surfaced by a rejected apply / import. Unifies the two
 * producers: the kernel `applyBatch` (opIndex + severity) and the editor import
 * mapper (`legacyPipelineToOps`, nodeId + opId). `message` is always present;
 * the rest are producer-specific and optional. Replaces the former `unknown[]`
 * so downstream logging (pipelineStore.persistSession) stays type-safe.
 */
export interface ApplyDiagnostic {
  message: string
  /** Kernel applyBatch: index of the failing op in the batch. */
  opIndex?: number
  /** Kernel applyBatch: severity of the diagnostic. */
  severity?: 'error' | 'warn'
  /** Editor import: the offending node id. */
  nodeId?: string
  /** Editor import: the offending op id. */
  opId?: string
}

export interface ApplyResult {
  status: 'ok' | 'rejected'
  newHash?: string
  /** History batchId on ok (echoes a client-supplied batchId when provided). */
  batchId?: string
  reason?: string
  diagnostics?: ApplyDiagnostic[]
}

function groupTemplateToBattery(template: GroupTemplateBattery): Battery {
  return {
    id: template.id,
    name: template.name,
    nameEn: template.nameEn,
    type: 'group',
    category: template.category,
    description: template.description ?? `Group template: ${template.name}`,
    descriptionEn: template.descriptionEn,
    version: template.version ?? '1.0.0',
    inputs: [],
    outputs: [],
    params: [],
    ...(template.iconSvg !== undefined ? { iconSvg: template.iconSvg } : {}),
    ...(template.iconPng !== undefined ? { iconPng: template.iconPng } : {}),
    displayGroup: template.displayGroup ?? template.category,
    ...(template.sourcePath !== undefined ? { sourcePath: template.sourcePath } : {}),
    ...(template.tags !== undefined ? { tags: template.tags } : {}),
    ...(template.tagLabels !== undefined ? { tagLabels: template.tagLabels } : {}),
    ...(template.builtin !== undefined ? { builtin: template.builtin } : {}),
  }
}

/**
 * Project a saved prompt into a draggable palette battery. Each `[xxx]`
 * placeholder becomes a `str` input port named `xxx`; the single output is
 * `prompt`. The node renders via the `prompt` nodeType (PromptNode), which reads
 * the template / vars / name from the dropped node's params — carried here as
 * `dropParams` so the instance is self-contained and survives reload.
 */
function promptToBattery(prompt: PromptDto): Battery {
  // `prompt/<tag>` → big label 'prompt' ("Prompts"), small label = the user's tag.
  const tag = prompt.tag?.trim() || 'saved'
  const group = `prompt/${tag}`
  return {
    id: `prompt:${prompt.id}`,
    name: prompt.name,
    nameEn: prompt.name,
    type: 'special',
    category: group,
    description: prompt.template,
    descriptionEn: prompt.template,
    version: '1.0.0',
    inputs: prompt.vars.map((v) => ({ name: v, type: 'string', label: v })),
    outputs: [{ name: 'prompt', type: 'string', label: 'prompt' }],
    params: [],
    displayGroup: group,
    nodeType: 'prompt',
    builtin: prompt.builtin,
    ...(prompt.iconSvg ? { iconSvg: prompt.iconSvg } : {}),
    dropParams: {
      template: prompt.template,
      _promptName: prompt.name,
      _promptVars: prompt.vars,
    },
  }
}

/** Adapts the kernel ApiClient to the legacy editor's data-service surface. */
export class EditorApiAdapter {
  /**
   * Cached battery order — populated only by explicit editor saves. On the
   * kernel backend there is no persisted order store, so saves stay in-memory.
   */
  private orderCache: BatteryOrder | null = null

  constructor(private readonly client: ApiClient) {}

  // ── Batteries (catalog) ────────────────────────────────────────────────

  /** All batteries, derived from the kernel op registry. */
  async getBatteries(): Promise<Battery[]> {
    const specs = await this.client.listOps()
    const batteries = specs.map(opSpecToBattery)
    const templates = await this.safeListGroupTemplates()
    const prompts = await this.safeListPrompts()
    return [...batteries, ...templates.map(groupTemplateToBattery), ...prompts.map(promptToBattery)]
  }

  /**
   * Category structure for the palette. The battery `category` is a
   * "bigTag/smallTag" path (e.g. "scene30/aw_mountain"); split it so the
   * BatteryBar's rail (big) + accordion (small) line up with getBigLabel /
   * getSmallLabel. Categories are typed `'ts'` to match the catalog the
   * BatteryBar expects for non-template (Develop) grouping.
   */
  async getCategories(): Promise<BatteryCategory[]> {
    const batteries = await this.getBatteries()
    const byBig = new Map<string, Set<string>>()
    for (const b of batteries) {
      const source = b.displayGroup ?? b.category
      const parts = source.split('/')
      const big = parts[0] || source
      const small = parts.length >= 2 ? parts[1] : (parts[0] || source)
      if (!byBig.has(big)) byBig.set(big, new Set())
      byBig.get(big)!.add(small)
    }
    return Array.from(byBig.entries()).map(([bigTag, smalls]) => ({
      type: 'ts',
      bigTag,
      smallTags: Array.from(smalls),
    }))
  }

  /** Battery palette order. Defaults include only raw big labels; small labels use curated UI sorting until explicitly saved. */
  async getBatteryOrder(): Promise<BatteryOrder> {
    if (this.orderCache) return this.orderCache
    const cats = await this.getCategories()
    const order: BatteryOrder = {
      bigLabels: cats.map(c => c.bigTag),
      smallLabels: {},
    }
    this.orderCache = order
    return order
  }

  /**
   * Persist the palette order. STUB: the kernel has no order store, so this
   * only updates the in-memory cache (the store also keeps an optimistic copy).
   */
  async saveBatteryOrder(order: BatteryOrder): Promise<void> {
    this.orderCache = order
  }

  // ── Pipeline (graph) ───────────────────────────────────────────────────

  /** The current pipeline projected into the editor model. */
  async getPipeline(name?: string): Promise<Pipeline | null> {
    const snap = await this.client.getPipeline()
    if (!snap) return null
    const groups = await this.safeListGroups()
    return snapshotToPipeline(snap, { name, groups })
  }

  /**
   * Session restore. The kernel binds a client to a single pipeline, so the
   * "session" IS the current pipeline snapshot — same as getPipeline().
   */
  async getSession(): Promise<Pipeline | null> {
    return this.getPipeline()
  }

  /**
   * Cheap content hash of the current kernel pipeline (no group projection).
   * Used by the live-sync reconciler poll to detect a graph change whose
   * `graph:applied` WS frame was missed (WS reconnect after a backend restart,
   * a rebind window, or a dropped frame) so the canvas still converges — the
   * same resilience the polling image-preview surface already has. Returns null
   * when there is no pipeline yet.
   */
  async getPipelineHash(): Promise<string | null> {
    const snap = await this.client.getPipeline()
    return snap?.hash ?? null
  }

  /**
   * Persist a desired pipeline state: diff against the current kernel snapshot
   * and submit the minimal Op[] through applyBatch. A graph:applied event is
   * announced by the kernel, driving the live-sync refetch.
   */
  async updatePipeline(desired: Pipeline, actor = 'editor', batchId?: string): Promise<ApplyResult> {
    const current = await this.client.getPipeline()
    // Group exposed-port overlay (hide/reorder/rename) is persisted on the
    // kernel group, not in the node/edge snapshot, so the diff needs the live
    // group set to emit only real overlay changes (and stay a no-op otherwise).
    // Also fetch it when the CURRENT kernel graph still holds group shadows even
    // if `desired` has none — that is the ungroup-the-last-group case, where the
    // diff must see the kernel group to emit `ungroup` (preserving boundary
    // edges) instead of a cascade `deleteGroup` that strands the wires.
    const kernelHasGroups = current
      ? Object.values(current.nodes).some((n) => n.opId === '__group__')
      : false
    const currentGroups =
      (desired.groups?.length ?? 0) > 0 || kernelHasGroups ? await this.safeListGroups() : undefined
    const ops = diffPipelineToOps(desired, current, currentGroups)
    if (ops.length === 0) return { status: 'ok', newHash: current?.hash }
    return this.applyOps(ops, actor, undefined, batchId)
  }

  /**
   * Hot-path param write for live interactive edits (slider drag, inspector
   * scrub). Submits a SINGLE targeted `updateNode` op as an EPHEMERAL batch:
   *
   *   - No `getPipeline()` + `safeListGroups()` + `diffPipelineToOps(whole graph)`
   *     round-trip (the avalanche source in updatePipeline). Just one op.
   *   - `ephemeral: true` → the kernel persists graph.json + invalidates the
   *     output cache + emits graph:applied EXACTLY like a normal batch (so the
   *     backend stays SSOT and the next execute computes with the new value),
   *     but writes NO history audit line. The settled value on pointer-up is
   *     committed by a normal updatePipeline, which records the single audit row.
   *
   * Generic: works for any node/any param. Returns the kernel ApplyResult so the
   * caller can correlate the graph:applied self-echo via the supplied batchId.
   */
  async applyParamOp(
    nodeId: string,
    params: Record<string, unknown>,
    actor = 'editor',
    batchId?: string,
  ): Promise<ApplyResult> {
    const res = await this.client.applyBatch([{ type: 'updateNode', nodeId, params }], {
      actor,
      ephemeral: true,
      ...(batchId !== undefined ? { batchId } : {}),
    })
    return {
      status: res.status,
      newHash: res.newHash,
      batchId: res.batchId,
      reason: res.reason,
      diagnostics: res.diagnostics ? [...res.diagnostics] : undefined,
    }
  }

  /** Submit a raw Op[] batch. Lower-level escape hatch used by group / import ops. */
  async applyOps(ops: readonly Op[], actor = 'editor', label?: string, batchId?: string): Promise<ApplyResult> {
    const res = await this.client.applyBatch(ops, {
      actor,
      ...(label !== undefined ? { label } : {}),
      // A client-supplied batchId lets the caller correlate the eventual
      // `graph:applied` self-echo with this exact write (used to suppress the
      // redundant local-param-edit reload). Kernel default is a random UUID.
      ...(batchId !== undefined ? { batchId } : {}),
    })
    return {
      status: res.status,
      newHash: res.newHash,
      batchId: res.batchId,
      reason: res.reason,
      diagnostics: res.diagnostics ? [...res.diagnostics] : undefined,
    }
  }

  // ── Graph import / export ──────────────────────────────────────────────

  /**
   * Import a whole editor Pipeline INLINE: build the ordered Op[] client-side
   * (delete-all → createNode → connect → createGroup → setMetadata) and submit
   * it as a single applyBatch. The kernel announces graph:applied, driving the
   * standard live-sync cascade (loadPipeline → reconcile → preview refresh) —
   * the same path every other actor uses. For loading a template FILE
   * headlessly, prefer importPipelineFile (the server reads + applies it).
   */
  async importPipeline(
    pipeline: Pipeline,
    opts: { mode?: 'replace' | 'merge'; remapIds?: boolean; actor?: string; label?: string; validateOps?: (opId: string) => boolean } = {},
  ): Promise<ImportPipelineResult> {
    const current = await this.client.getPipeline()
    const { ops, nodeIdMap, diagnostics } = legacyPipelineToOps(pipeline, {
      mode: opts.mode ?? 'replace',
      current,
      remapIds: opts.remapIds,
      validateOps: opts.validateOps,
    })
    if (diagnostics.length > 0) {
      return { status: 'rejected', reason: diagnostics.map((d) => d.message).join('; '), diagnostics }
    }
    if (ops.length === 0) return { status: 'ok', newHash: current?.hash, nodeIdMap }
    const res = await this.applyOps(ops, opts.actor ?? 'import', opts.label)
    return { ...res, nodeIdMap }
  }

  /**
   * Import a template FILE the server reads from its templates directory and
   * applies (the faithful headless path). Delegates to the optional transport
   * capability; throws a clear error when the transport does not expose it.
   */
  async importPipelineFile(req: {
    path: string
    source?: string
    options?: ImportPipelineExecuteOptions
  }): Promise<ImportPipelineResponse> {
    if (!this.client.importPipelineFile) {
      throw new Error('[editor] transport does not support importPipelineFile (no server import route)')
    }
    return this.client.importPipelineFile(req)
  }

  /** List server-side graph templates. Returns [] when the transport has no template route. */
  async listImportTemplates(): Promise<readonly ImportTemplate[]> {
    if (!this.client.listImportTemplates) return []
    try {
      return await this.client.listImportTemplates()
    } catch {
      return []
    }
  }

  /** Export the current graph to a server-side template file. */
  async exportPipeline(req: { name?: string; source?: string } = {}): Promise<{ path: string; name: string }> {
    if (!this.client.exportPipelineFile) {
      throw new Error('[editor] transport does not support exportPipelineFile (no server export route)')
    }
    return this.client.exportPipelineFile(req)
  }

  // ── History (kernel audit log) ─────────────────────────────────────────

  /**
   * The kernel `history.jsonl` audit log (`actor` + `ops[]` per committed
   * batch). The editor uses this to BRIDGE programmatic mutations (AI / CLI /
   * another client) into the visible history panel: a `graph:applied` event
   * carries only a batchId, so the live-sync handler looks the batch up here to
   * derive an actor-aware label. Local UI ops are recorded by the canvas hooks
   * directly and are skipped by the bridge (see pipelineStore.subscribeLiveSync).
   */
  async getHistory(opts?: HistoryQuery): Promise<readonly HistoryEntryV1[]> {
    return this.client.getHistory(opts)
  }

  // ── Execution ──────────────────────────────────────────────────────────

  /** Run the pipeline, or a node's upstream closure when startNodeId is given. */
  async executePipeline(opts?: { startNodeId?: string }): Promise<ExecutionResult> {
    return this.client.execute(opts?.startNodeId ? { nodeId: opts.startNodeId } : undefined)
  }

  /**
   * Read the last-computed value of a node's output port. This is the generic
   * mechanism the editor uses to populate its `nodeOutputs` cache (driving the
   * wire data-probe, port tooltips and preview nodes) — the kernel-native
   * replacement for the legacy WS `NODE_OUTPUT` push. Returns `undefined` when
   * the port has not produced a value yet (e.g. before the first execution).
   */
  async getNodeOutput(nodeId: string, portId: string): Promise<unknown> {
    return this.client.getNodeOutput(nodeId, portId)
  }

  /**
   * Probe a group's INNER sub-graph for per-inner-node outputs so the internal
   * view can draw real data + types on inner wires (a group runs as a black box
   * and discards its inner intermediates). Returns null when the transport does
   * not support probing — callers fall back to the prior empty internal view.
   */
  async probeGroupInner(groupId: string): Promise<Record<string, Record<string, unknown>> | null> {
    if (!this.client.probeGroupInner) return null
    return this.client.probeGroupInner(groupId)
  }

  /**
   * Stop execution. STUB: the kernel ApiClient exposes no abort handle, so this
   * is a no-op placeholder. (Cancellation flows through the executor's
   * AbortSignal server-side; a client-facing abort lands in a later phase.)
   */
  async stopPipeline(): Promise<void> {
    // no-op — see doc comment.
  }

  // ── Groups ─────────────────────────────────────────────────────────────

  /** Load a single group sub-graph by id (kernel-native shape). */
  async loadGroup(
    groupId: string,
    opts?: { scope?: 'groups' | 'templates' },
  ): Promise<NodeGroup | null> {
    const live = await this.client.getGroup(groupId)
    if (live) return kernelGroupToEditorGroup(live)
    if (!this.client.loadGroupTemplate) return null
    const template = await this.client.loadGroupTemplate(groupId, opts)
    return template ? kernelGroupToEditorGroup(template) : null
  }

  /** List all group sub-graphs. */
  async listGroups(): Promise<readonly KernelNodeGroup[]> {
    return this.safeListGroups()
  }

  /**
   * Create a group from a set of member nodes via a createGroup op. The legacy
   * saveGroup also wrote a catalog entry to disk; on the kernel that catalog is
   * derived from the live graph, so we only emit the structural op here.
   */
  async saveGroup(group: { id: string; name: string; nameEn?: string; position: { x: number; y: number }; memberNodeIds: readonly string[] }): Promise<ApplyResult> {
    return this.applyOps([
      {
        type: 'createGroup',
        groupId: group.id,
        name: group.name,
        nameEn: group.nameEn,
        position: group.position,
        memberNodeIds: group.memberNodeIds,
      },
    ])
  }

  /** Persist a collapsed group as a reusable template battery file. */
  async saveGroupTemplate(req: {
    group: NodeGroup
    categoryName: string
    batteryName: string
  }): Promise<{ filePath: string; groupId: string; categoryName: string; batteryName: string }> {
    if (!this.client.saveGroupTemplate) {
      throw new Error('[editor] transport does not support saveGroupTemplate (no group template route)')
    }
    return this.client.saveGroupTemplate({
      ...req,
      group: editorGroupToKernelGroup(req.group),
    })
  }

  /** Whether the transport can persist user templates (Save to templates). */
  get supportsUserTemplates(): boolean {
    return typeof this.client.saveUserTemplate === 'function'
  }

  /** Persist a collapsed group as a USER template file (My templates/<smallTag>). */
  async saveUserTemplate(req: {
    group: NodeGroup
    smallTag: string
    templateName: string
  }): Promise<{ filePath: string; groupId: string; smallTag: string; templateName: string }> {
    if (!this.client.saveUserTemplate) {
      throw new Error('[editor] transport does not support saveUserTemplate (no user template route)')
    }
    return this.client.saveUserTemplate({
      ...req,
      group: editorGroupToKernelGroup(req.group),
    })
  }

  /** Whether the transport can delete user templates (right-click delete). */
  get supportsDeleteUserTemplate(): boolean {
    return typeof this.client.deleteUserTemplate === 'function'
  }

  /** Delete a USER template by group id. Returns false when unsupported or rejected. */
  async deleteUserTemplate(groupId: string): Promise<boolean> {
    if (!this.client.deleteUserTemplate) return false
    const res = await this.client.deleteUserTemplate(groupId)
    return res.ok
  }

  /** Template category folders, including empty dirs when the backend supports them. */
  async listTemplateCategories(): Promise<readonly string[]> {
    if (!this.client.listTemplateCategories) return []
    try {
      return await this.client.listTemplateCategories()
    } catch {
      return []
    }
  }

  /** templates/ subfolders (incl. empty) for the Templates palette rail. */
  async listTemplateOnlyCategories(): Promise<readonly string[]> {
    if (!this.client.listTemplateOnlyCategories) return []
    try {
      return await this.client.listTemplateOnlyCategories()
    } catch {
      return []
    }
  }

  /** Restore a group's sub-graph to the outer view via an ungroup op. */
  async ungroup(groupId: string): Promise<ApplyResult> {
    return this.applyOps([{ type: 'ungroup', groupId }])
  }

  private async safeListGroups(): Promise<readonly KernelNodeGroup[]> {
    try {
      return await this.client.listGroups()
    } catch {
      return []
    }
  }

  private async safeListGroupTemplates(): Promise<readonly GroupTemplateBattery[]> {
    if (!this.client.listGroupTemplates) return []
    try {
      return await this.client.listGroupTemplates()
    } catch {
      return []
    }
  }

  private async safeListPrompts(): Promise<readonly PromptDto[]> {
    if (!this.client.listPrompts) return []
    try {
      return await this.client.listPrompts()
    } catch {
      return []
    }
  }

  // ── Projects / workspace (multi-project management) ─────────────────────
  // Thin delegations to the optional transport capabilities. The projectStore
  // drives these for the faithful open/create/delete cascade. They throw a
  // clear error when the transport does not front the project routes, so a
  // misconfigured app fails loudly rather than silently single-pipeline.

  /** List projects in the workspace. Returns [] when the transport has no project routes. */
  async listProjects(): Promise<readonly ProjectMeta[]> {
    if (!this.client.listProjects) return []
    return this.client.listProjects()
  }

  /** Fetch one project's manifest. */
  async getProject(id: string): Promise<ProjectRecord | null> {
    if (!this.client.getProject) return null
    return this.client.getProject(id)
  }

  /**
   * Produced-asset summary for one project. Falls back to `{ producedCount: 0 }`
   * when the transport can't probe assets, so callers can treat "unknown" the
   * same as "none" (the delete dialog then disables the asset-policy options).
   */
  async getProjectAssetsSummary(id: string): Promise<{ producedCount: number }> {
    if (!this.client.getProjectAssetsSummary) return { producedCount: 0 }
    return this.client.getProjectAssetsSummary(id)
  }

  /** Create a project (optionally seeded from a server-side template). */
  async createProject(req: CreateProjectRequest): Promise<ProjectMeta> {
    if (!this.client.createProject) {
      throw new Error('[editor] transport does not support createProject (no project routes)')
    }
    return this.client.createProject(req)
  }

  /** Patch a project's metadata. */
  async updateProject(
    id: string,
    patch: { name?: string; description?: string; thumbnail?: string; type?: string },
  ): Promise<ProjectMeta> {
    if (!this.client.updateProject) {
      throw new Error('[editor] transport does not support updateProject (no project routes)')
    }
    return this.client.updateProject(id, patch)
  }

  /** Delete a project. The server keeps the workspace non-empty and returns it. */
  async deleteProject(id: string, opts?: { assetPolicy?: AssetDeletePolicy }): Promise<{ ok: true; workspace: WorkspaceState }> {
    if (!this.client.deleteProject) {
      throw new Error('[editor] transport does not support deleteProject (no project routes)')
    }
    return this.client.deleteProject(id, opts)
  }

  /**
   * Open / activate a project — the server step of the open cascade. The
   * backend swaps the active runtime + broadcasts graph:applied; the
   * projectStore then loadPipeline()s (→ pipelineRevision++ → reconcile),
   * clearHistory()s, and resets node outputs.
   */
  async activateProject(id: string): Promise<ActivateProjectResult> {
    if (!this.client.activateProject) {
      throw new Error('[editor] transport does not support activateProject (no project routes)')
    }
    return this.client.activateProject(id)
  }

  /** Read the workspace doc. */
  async getWorkspace(): Promise<WorkspaceState | null> {
    if (!this.client.getWorkspace) return null
    return this.client.getWorkspace()
  }

  /** Patch the workspace doc. */
  async setWorkspace(patch: Partial<WorkspaceState>): Promise<WorkspaceState | null> {
    if (!this.client.setWorkspace) return null
    return this.client.setWorkspace(patch)
  }

  // ── Text presets ───────────────────────────────────────────────────────
  // Optional, app-level. When the client doesn't implement preset routes these
  // resolve to "unsupported" so the uiStore can fall back to localStorage.

  /** True when the bound client backs text presets with a server store. */
  get supportsTextPresets(): boolean {
    return typeof this.client.listTextPresets === 'function'
  }

  /** List all text presets (built-in + user). Null when unsupported. */
  async listTextPresets(): Promise<readonly TextPresetDto[] | null> {
    if (!this.client.listTextPresets) return null
    return this.client.listTextPresets()
  }

  /** Create a user text preset. Null when unsupported. */
  async createTextPreset(req: { title?: string; text: string }): Promise<TextPresetDto | null> {
    if (!this.client.createTextPreset) return null
    return this.client.createTextPreset(req)
  }

  /** Delete a user text preset by id. Returns false when unsupported. */
  async deleteTextPreset(id: string): Promise<boolean> {
    if (!this.client.deleteTextPreset) return false
    const res = await this.client.deleteTextPreset(id)
    return res.ok
  }

  // ── Prompts (saved Panel prompts → palette batteries) ──────────────────

  /** True when the bound client backs prompts with a server store. */
  get supportsPrompts(): boolean {
    return typeof this.client.listPrompts === 'function'
  }

  /** List all prompts (built-in + user). Null when unsupported. */
  async listPrompts(): Promise<readonly PromptDto[] | null> {
    if (!this.client.listPrompts) return null
    return this.client.listPrompts()
  }

  /** Create a user prompt. Null when unsupported. */
  async createPrompt(req: { name?: string; tag?: string; template: string }): Promise<PromptDto | null> {
    if (!this.client.createPrompt) return null
    return this.client.createPrompt(req)
  }

  /** Delete a user prompt by id. Returns false when unsupported. */
  async deletePrompt(id: string): Promise<boolean> {
    if (!this.client.deletePrompt) return false
    const res = await this.client.deletePrompt(id)
    return res.ok
  }
}
