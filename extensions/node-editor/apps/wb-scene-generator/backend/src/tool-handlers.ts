import { readFileSync } from 'node:fs'
import { isAbsolute, resolve as resolvePath } from 'node:path'

import { resolveNarrativeLocationNames } from './resolve-narrative-names.js'

type Caller = {
  kind: 'user' | 'ai' | 'skill' | 'workbench' | 'cli'
  sessionId?: string
  threadId?: string
  agentId?: string
}

type ToolCtx = {
  caller: Caller
  toolId: string
  env: Record<string, string | undefined>
  cwd: string
}

type ToolHandler = (args: unknown, ctx: ToolCtx) => Promise<unknown>

const PLUGIN_ID = '@forgeax-plugin/wb-scene-generator'
const DEFAULT_BACKEND_URL = 'http://127.0.0.1:9557'
const ASSET2D_PLUGIN_ID = '@forgeax-plugin/wb-2d-scene-asset-generator'
const DEFAULT_ASSET2D_BACKEND_URL = 'http://127.0.0.1:9567'

function objectArgs(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {}
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`missing string arg: ${key}`)
  }
  return value
}

function backendUrlFromOverrides(file: string | undefined, pluginId: string): string | null {
  if (!file) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as {
      plugins?: Record<string, { backendPort?: unknown }>
    }
    const port = parsed.plugins?.[pluginId]?.backendPort
    if (Number.isInteger(port) && Number(port) > 0 && Number(port) <= 65535) {
      return `http://127.0.0.1:${Number(port)}`
    }
  } catch {
    return null
  }
  return null
}

function backendBaseUrl(ctx: ToolCtx): string {
  const explicit = ctx.env.FORGEAX_SCENE_BACKEND_URL
  if (explicit?.trim()) return explicit.replace(/\/+$/u, '')
  return backendUrlFromOverrides(ctx.env.FORGEAX_PLUGIN_DEV_PORTS_FILE, PLUGIN_ID) ?? DEFAULT_BACKEND_URL
}

// The 2D asset generator runs as a separate Fastify backend on its own port.
// Resolve it from the same dev-ports file the host uses, so the publish bridge
// can pull bytes server-to-server (the agent must NEVER shuttle base64 — large
// base64 gets dropped by context auto-compaction, causing publish retry loops).
function asset2dBackendBaseUrl(ctx: ToolCtx): string {
  const explicit = ctx.env.FORGEAX_ASSET2D_BACKEND_URL
  if (explicit?.trim()) return explicit.replace(/\/+$/u, '')
  return backendUrlFromOverrides(ctx.env.FORGEAX_PLUGIN_DEV_PORTS_FILE, ASSET2D_PLUGIN_ID) ?? DEFAULT_ASSET2D_BACKEND_URL
}

// Fetch a generated 2D asset's raw bytes (by alias or blobId) from the asset2d
// backend and return base64. Runs in the host tool process (server-to-server),
// keeping pixels out of the agent context entirely.
async function fetch2dAssetBase64(
  ctx: ToolCtx,
  ref: { alias?: string; blobId?: string },
): Promise<string> {
  const base = asset2dBackendBaseUrl(ctx)
  const path = ref.alias
    ? `/api/v1/generated-assets/blob/${encodeURIComponent(ref.alias)}`
    : `/api/v1/library/blob/${encodeURIComponent(ref.blobId ?? '')}`
  const res = await fetch(`${base}${path}`)
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`asset2d byte fetch ${path} failed: ${res.status} ${detail || res.statusText}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) throw new Error(`asset2d byte fetch ${path} returned empty bytes`)
  return buf.toString('base64')
}

function sceneCallerHeaders(ctx: ToolCtx, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { 'x-forgeax-caller-kind': ctx.caller.kind }
  if (hasBody) headers['content-type'] = 'application/json'
  if (ctx.caller.agentId) headers['x-forgeax-caller-agent-id'] = ctx.caller.agentId
  if (ctx.caller.sessionId) headers['x-forgeax-caller-session-id'] = ctx.caller.sessionId
  return headers
}

async function sceneRawFetch(
  ctx: ToolCtx,
  method: string,
  path: string,
  body: unknown,
): Promise<{ res: Response; payload: unknown; text: string }> {
  const res = await fetch(`${backendBaseUrl(ctx)}${path}`, {
    method,
    headers: sceneCallerHeaders(ctx, body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const payload = text ? (JSON.parse(text) as unknown) : null
  return { res, payload, text }
}

async function request(ctx: ToolCtx, method: string, path: string, body?: unknown): Promise<unknown> {
  let { res, payload, text } = await sceneRawFetch(ctx, method, path, body)

  // Transparent lock recovery after a backend restart wipes the in-memory lock
  // table: an AI mutation gets 403 `mutation-denied-not-open` (recoverable). Re-
  // `open` the active project once and replay. Genuine conflicts
  // (`mutation-denied-locked-by-other`) are NOT retried.
  if (res.status === 403 && ctx.caller.kind === 'ai' && ctx.caller.agentId) {
    const p = (payload ?? {}) as { code?: unknown; projectId?: unknown }
    if (p.code === 'mutation-denied-not-open' && typeof p.projectId === 'string' && p.projectId) {
      // Soft re-attach; write lock is reclaimed by the mutation route itself.
      const reopen = await sceneRawFetch(
        ctx,
        'POST',
        `/api/v1/projects/${encodeURIComponent(p.projectId)}/open`,
        {},
      )
      if (reopen.res.ok) {
        ;({ res, payload, text } = await sceneRawFetch(ctx, method, path, body))
      }
    }
  }

  if (!res.ok) {
    const reason =
      payload && typeof payload === 'object' && 'reason' in payload
        ? String((payload as { reason?: unknown }).reason)
        : payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : text || `${res.status} ${res.statusText}`
    throw new Error(`scene backend ${method} ${path} failed: ${reason}`)
  }
  return payload
}

function query(params: Record<string, unknown>): string {
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) qs.set(key, String(value))
  }
  const out = qs.toString()
  return out ? `?${out}` : ''
}

// `/api/v1/ops` attaches each battery's inline `icon.svg` as `iconSvg`, and a
// battery could expose other inline-image fields too (preview thumbnails, data:
// URIs, …). The host tool bridge mis-reads ANY such string as an image content
// part and drops the rest of the (text) payload, so an agent calling
// `batteries.list` gets a blank / garbled result. Defensively strip every value
// that looks like inline image markup — agents only ever need ports / params,
// never pixels — so the op catalog is always clean, parseable text.
const INLINE_IMAGE_KEYS = new Set(['iconSvg', 'icon', 'iconPng', 'preview', 'thumbnail', 'thumbnailSvg'])

function looksLikeInlineImage(value: string): boolean {
  const head = value.trimStart().slice(0, 24).toLowerCase()
  return head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('data:image')
}

function stripInlineImages(value: unknown): unknown {
  if (typeof value === 'string') return looksLikeInlineImage(value) ? undefined : value
  if (Array.isArray(value)) return value.map(stripInlineImages).filter((v) => v !== undefined)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (INLINE_IMAGE_KEYS.has(key)) continue
      const cleaned = stripInlineImages(val)
      if (cleaned !== undefined) out[key] = cleaned
    }
    return out
  }
  return value
}

function stripBatteryIcon(op: Record<string, unknown>): Record<string, unknown> {
  return stripInlineImages(op) as Record<string, unknown>
}

type WorkspaceSnapshot = {
  viewingProjectId?: string | null
  executingProjectIds?: string[]
}

type MineSnapshot = {
  openProjectId?: string | null
}

/** Explicit `projectId` in args, else soft-open session / write lock, else UI viewing (non-AI). */
async function resolveProjectId(ctx: ToolCtx, args: Record<string, unknown>): Promise<string> {
  const explicit = args.projectId
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim()

  if (ctx.caller.kind === 'ai') {
    const mine = (await request(ctx, 'GET', '/api/v1/workspace/mine')) as MineSnapshot
    if (typeof mine.openProjectId === 'string' && mine.openProjectId.trim()) {
      return mine.openProjectId.trim()
    }
    const ws = (await request(ctx, 'GET', '/api/v1/workspace')) as WorkspaceSnapshot
    const executing = ws.executingProjectIds ?? []
    if (executing.length === 1) return executing[0]!
    throw new Error(
      'missing projectId: AI must pass projectId on every pipeline tool call, ' +
      'or scene:projects.open first (shared attach — does not wait for write lock). ' +
      (executing.length > 0
        ? `Write locks currently held: [${executing.join(', ')}].`
        : 'No soft-open session found.'),
    )
  }

  const ws = (await request(ctx, 'GET', '/api/v1/workspace')) as WorkspaceSnapshot
  const viewing = ws.viewingProjectId
  if (typeof viewing === 'string' && viewing.trim()) return viewing.trim()

  throw new Error(
    'missing projectId: pass projectId in args, or scene:projects.open a project first (AI agents must open before mutating)',
  )
}

function projectPath(projectId: string, suffix: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}${suffix}`
}

// ── P0-2: applyBatch `connect` by semantic label ───────────────────────────
//
// 复盘（2026-07-15 tool 升级方案 P0-2）：`instantiateTemplate` 已经在返回值
// 的 exposedInputs/exposedOutputs 里带上了 label（见 templateOps.ts 的
// `portInfo()`），但 applyBatch 的 connect op 一直只认 `in_N`/`out_N` 这种
// 编号 port——agent 手上明明有语义化的名字，却还要在 in_N/out_N 和
// label 之间做一次心算映射，一旦模板端口顺序和直觉不一致（比如 Rest 不是
// out_1 而是 out_2）就容易接错。这里让 `connect` op 的 source.port /
// target.port 除了字符串外，还能写 `{ label: "IslandName" }`，由这层负责查
// 该节点的 exposedInputs/exposedOutputs 解出真实 portName 再转发给后端——
// 后端 /batch 收到的永远是解析好的字符串 port，不用改动核心 apply-batch。
// `{ label, portName? }` — portName is an optional constraint: when present it must
// match the port resolved from label, catching the classic out_0/out_1 swap.
type PortLabelRef = { label: string; portName?: string }

function isPortLabelRef(port: unknown): port is PortLabelRef {
  return Boolean(port) && typeof port === 'object' && typeof (port as { label?: unknown }).label === 'string'
}

interface ExposedPortLike {
  portName: string
  customLabel?: string
  customLabelEn?: string
}

interface NodeGroupLike {
  exposedInputs?: ExposedPortLike[]
  exposedOutputs?: ExposedPortLike[]
}

function exposedPortLabel(p: ExposedPortLike): string {
  return p.customLabelEn ?? p.customLabel ?? p.portName
}

function findExposedPortByLabel(candidates: ExposedPortLike[] | undefined, label: string): ExposedPortLike[] {
  return (candidates ?? []).filter((p) => p.customLabelEn === label || p.customLabel === label)
}

function findSceneOutputPort(group: NodeGroupLike): ExposedPortLike | undefined {
  return (group.exposedOutputs ?? []).find((p) => p.customLabelEn === 'Scene' || p.customLabel === 'Scene')
}

async function loadNodeGroup(
  ctx: ToolCtx,
  projectId: string,
  groupCache: Map<string, NodeGroupLike | null>,
  nodeId: string,
): Promise<NodeGroupLike | null> {
  let group = groupCache.get(nodeId)
  if (group === undefined) {
    group = (await request(ctx, 'GET', projectPath(projectId, `/groups/${encodeURIComponent(nodeId)}`))) as NodeGroupLike | null
    groupCache.set(nodeId, group)
  }
  return group
}

/** Resolve one connect endpoint's `{ label, portName? }` into a real portName. Returns `null` when `port` isn't a label ref. */
async function resolveConnectEndpointLabel(
  ctx: ToolCtx,
  projectId: string,
  groupCache: Map<string, NodeGroupLike | null>,
  opIndex: number,
  endpoint: unknown,
  direction: 'source' | 'target',
): Promise<{ nodeId: string; port: string } | null> {
  const e = endpoint as { nodeId?: unknown; port?: unknown } | undefined
  if (!e || typeof e.nodeId !== 'string' || !isPortLabelRef(e.port)) return null
  const nodeId = e.nodeId
  const label = e.port.label
  const expectedPortName =
    typeof e.port.portName === 'string' && e.port.portName.trim() ? e.port.portName.trim() : undefined

  const group = await loadNodeGroup(ctx, projectId, groupCache, nodeId)
  if (!group) {
    throw new Error(
      `applyBatch ops[${opIndex}].${direction}: cannot resolve port label "${label}" — node "${nodeId}" is not a __group__ ` +
      '(or does not exist in this project). Label addressing only works on group nodes returned by instantiateTemplate; ' +
      'for plain battery nodes, pass the raw port name instead.',
    )
  }
  const candidates = direction === 'target' ? group.exposedInputs : group.exposedOutputs
  const matches = findExposedPortByLabel(candidates, label)
  if (matches.length === 0) {
    const available = (candidates ?? []).map(exposedPortLabel).filter((l): l is string => Boolean(l))
    throw new Error(
      `applyBatch ops[${opIndex}].${direction}: label "${label}" not found on node "${nodeId}"'s exposed${direction === 'target' ? 'Inputs' : 'Outputs'}. ` +
      `Available labels: [${available.join(', ')}]. Re-check instantiateTemplate's return value for this group, or pass the raw in_N/out_N port name.`,
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `applyBatch ops[${opIndex}].${direction}: label "${label}" matches ${matches.length} ports on node "${nodeId}" ` +
      `(${matches.map((m) => m.portName).join(', ')}) — ambiguous, pass the raw port name instead.`,
    )
  }
  const resolvedPortName = matches[0]!.portName
  if (expectedPortName && expectedPortName !== resolvedPortName) {
    const available = (candidates ?? [])
      .map((p) => `${exposedPortLabel(p)}→${p.portName}`)
      .filter((l): l is string => Boolean(l))
    throw new Error(
      `applyBatch ops[${opIndex}].${direction}: port label "${label}" on node "${nodeId}" resolves to "${resolvedPortName}", ` +
      `but portName "${expectedPortName}" was specified — they must match. ` +
      `Available ports: [${available.join(', ')}].`,
    )
  }
  return { nodeId, port: resolvedPortName }
}

async function validateAppendMergeItemSceneSourceForAi(
  ctx: ToolCtx,
  projectId: string,
  groupCache: Map<string, NodeGroupLike | null>,
  opIndex: number,
  source: { nodeId: string; port: unknown },
): Promise<void> {
  if (ctx.caller.kind !== 'ai') return

  const group = await loadNodeGroup(ctx, projectId, groupCache, source.nodeId)
  if (!group) return

  const scenePort = findSceneOutputPort(group)
  if (!scenePort) return

  let resolvedPortName: string | undefined
  if (typeof source.port === 'string') {
    resolvedPortName = source.port
  } else if (isPortLabelRef(source.port)) {
    const matches = findExposedPortByLabel(group.exposedOutputs, source.port.label)
    if (matches.length === 1) resolvedPortName = matches[0]!.portName
    else if (source.port.label !== 'Scene') {
      const available = (group.exposedOutputs ?? [])
        .map((p) => `${exposedPortLabel(p)}→${p.portName}`)
        .filter((l): l is string => Boolean(l))
      throw new Error(
        `applyBatch ops[${opIndex}] appendMergeItem: source must use the Scene output for merge aggregation, not a domain port. ` +
        `Node "${source.nodeId}" exposes Scene at ${scenePort.portName}; you selected label "${source.port.label}". ` +
        `Use source.port={ label: "Scene", portName: "${scenePort.portName}" }. Available ports: [${available.join(', ')}].`,
      )
    }
  }

  if (!resolvedPortName || resolvedPortName === scenePort.portName) return

  const available = (group.exposedOutputs ?? [])
    .map((p) => `${exposedPortLabel(p)}→${p.portName}`)
    .filter((l): l is string => Boolean(l))
  throw new Error(
    `applyBatch ops[${opIndex}] appendMergeItem: source must use the Scene output for merge aggregation, not a domain port. ` +
    `Node "${source.nodeId}" exposes Scene at ${scenePort.portName}; you selected ${resolvedPortName}. ` +
    `Use source.port={ label: "Scene", portName: "${scenePort.portName}" }. Available ports: [${available.join(', ')}].`,
  )
}

async function resolvePortLabelsInOps(ctx: ToolCtx, projectId: string, ops: unknown[]): Promise<unknown[]> {
  const groupCache = new Map<string, NodeGroupLike | null>()
  const out: unknown[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as Record<string, unknown> | undefined
    if (!op || op.type !== 'connect') {
      out.push(ops[i])
      continue
    }
    const resolvedSource = await resolveConnectEndpointLabel(ctx, projectId, groupCache, i, op.source, 'source')
    const resolvedTarget = await resolveConnectEndpointLabel(ctx, projectId, groupCache, i, op.target, 'target')
    if (!resolvedSource && !resolvedTarget) {
      out.push(op)
      continue
    }
    out.push({
      ...op,
      ...(resolvedSource ? { source: resolvedSource } : {}),
      ...(resolvedTarget ? { target: resolvedTarget } : {}),
    })
  }
  return out
}

// ── P0-4: applyBatch `appendMergeItem` composite op ────────────────────────
//
// 复盘（2026-07-15 tool 升级方案 P0-4）：接一个新内容到 tree_merge（最典型是
// 根节点 aw_m0_merge）本来需要 agent 自己：1) 先 pipeline.get 读出当前
// portCount，2) updateNode 把 portCount+1，3) 再 connect 到新算出来的
// `item_N`——见 connect-node-task/SKILL.md 的「往 aw_m0_merge 追加一路」真实
// 案例，纯手动数数很容易因为漏算/图已经变了而接错 item 号。这里把三步压成一
// 个 op：`{ type: 'appendMergeItem', mergeNodeId, source: { nodeId, port } }`，
// 由这一层负责读当前 portCount、算出下一个 item_N、展开成
// updateNode+connect 两个真实 op 再转发——同一批里连续追加多个会正确地依次
// 递增，不会重复用同一个 item 号。展开后的 op 完全是后端已支持的
// updateNode/connect，不需要改动核心 apply-batch 或 sinoOpGate 白名单。
interface GraphNodeLike {
  opId?: string
  params?: Record<string, unknown>
}

async function loadMergePortCount(ctx: ToolCtx, projectId: string, mergeNodeId: string): Promise<number> {
  const node = (await request(ctx, 'GET', projectPath(projectId, `/nodes/${encodeURIComponent(mergeNodeId)}`))) as GraphNodeLike | null
  if (!node) {
    throw new Error(`appendMergeItem: mergeNodeId "${mergeNodeId}" was not found in this project's graph.`)
  }
  if (node.opId !== 'tree_merge') {
    throw new Error(
      `appendMergeItem: mergeNodeId "${mergeNodeId}" is opId "${node.opId ?? '?'}", not "tree_merge". ` +
      'appendMergeItem only targets tree_merge nodes (e.g. the root aw_m0_merge).',
    )
  }
  const count = node.params?.portCount
  return typeof count === 'number' && Number.isFinite(count) ? count : 0
}

let appendMergeItemEdgeSeq = 0

async function expandAppendMergeItemOps(ctx: ToolCtx, projectId: string, ops: unknown[]): Promise<unknown[]> {
  if (!ops.some((op) => op && typeof op === 'object' && (op as Record<string, unknown>).type === 'appendMergeItem')) {
    return ops
  }
  const portCountByMergeNode = new Map<string, number>()
  const groupCache = new Map<string, NodeGroupLike | null>()
  const out: unknown[] = []
  for (let i = 0; i < ops.length; i++) {
    const rawOp = ops[i]
    const op = rawOp as Record<string, unknown> | undefined
    if (!op || op.type !== 'appendMergeItem') {
      out.push(rawOp)
      continue
    }
    const mergeNodeId = typeof op.mergeNodeId === 'string' ? op.mergeNodeId.trim() : ''
    const source = op.source as { nodeId?: unknown; port?: unknown } | undefined
    const hasSourcePort = typeof source?.port === 'string' || isPortLabelRef(source?.port)
    if (!mergeNodeId || !source || typeof source.nodeId !== 'string' || !hasSourcePort) {
      throw new Error(
        'appendMergeItem op requires { mergeNodeId: string, source: { nodeId: string, port: string | { label, portName? } } } — got: ' +
        JSON.stringify(rawOp),
      )
    }
    await validateAppendMergeItemSceneSourceForAi(ctx, projectId, groupCache, i, {
      nodeId: source.nodeId,
      port: source.port,
    })
    let currentCount = portCountByMergeNode.get(mergeNodeId)
    if (currentCount === undefined) currentCount = await loadMergePortCount(ctx, projectId, mergeNodeId)
    const newCount = currentCount + 1
    portCountByMergeNode.set(mergeNodeId, newCount)

    const edgeId =
      typeof op.edgeId === 'string' && op.edgeId.trim()
        ? op.edgeId.trim()
        : `e_append_${mergeNodeId}_${currentCount}_${appendMergeItemEdgeSeq++}`
    out.push({ type: 'updateNode', nodeId: mergeNodeId, params: { portCount: newCount } })
    out.push({
      type: 'connect',
      edgeId,
      source: { nodeId: source.nodeId, port: source.port },
      target: { nodeId: mergeNodeId, port: `item_${currentCount}` },
    })
  }
  return out
}

export type ExecuteSummaryVerification = {
  ok?: boolean
  hints?: string[]
  primaryFailure?: 'structural' | 'location-names'
  locationNameAlignment?: {
    ok?: boolean
    missing?: Array<{ name: string }>
    fix?: string
    actualNodeNames?: string[]
    actualNodeNamesTruncated?: boolean
  }
  topologyIssues?: Array<{
    kind: 'rest-fan-out' | 'illegal-local-merge' | 'manual-points-zero-default'
    reason: string
    fix: string
    suggestedOps?: unknown[]
  }>
}

/** Build the Error message for AI execute when verification failed. Structural issues take priority over naming. */
export function formatExecuteVerificationFailure(summary: {
  status?: string
  verification?: ExecuteSummaryVerification
}): string | null {
  if (summary.status !== 'completed' || summary.verification?.ok !== false) return null

  const hints = summary.verification.hints ?? []
  const loc = summary.verification.locationNameAlignment
  const structuralHints = hints.filter((h) => !h.startsWith('[stage3.location_names]'))
  const hasStructural = structuralHints.length > 0 || summary.verification.primaryFailure === 'structural'
  const hasLocation = loc?.ok === false

  if (hasStructural) {
    const locationSection = hasLocation
      ? `\n\n[secondary: locationNameAlignment] missing narrative names: ${(loc!.missing ?? []).map((m) => m.name).join('、')}. ` +
        `${loc!.fix ?? 'Wire Name/BuildingName ports from checklist namePort, then re-execute.'}` +
        (loc!.actualNodeNames?.length
          ? ` 当前场景实际节点名（共 ${loc!.actualNodeNames.length}${loc!.actualNodeNamesTruncated ? '+' : ''} 个）：${loc!.actualNodeNames.join('、')}`
          : '')
      : ''
    return (
      `[primaryFailure: structural] pipeline.execute verification failed — empty/disconnected group outputs (fix wiring before checking names). ` +
      `Fix wiring via pipeline.get(groupId) + applyBatch, then re-execute. ` +
      (structuralHints[0] ?? 'See verification.hints') +
      locationSection
    )
  }

  if (hasLocation) {
    const missing = (loc!.missing ?? []).map((m) => m.name).join('、')
    const actualList = loc!.actualNodeNames ?? []
    const actualNote = actualList.length > 0
      ? ` 当前场景实际节点名（共 ${actualList.length}${loc!.actualNodeNamesTruncated ? '+' : ''} 个，无需再跑 raw execute 翻找）：${actualList.join('、')}`
      : ''
    return (
      `[primaryFailure: location-names] pipeline.execute locationNameAlignment failed — missing narrative names: ${missing}. ` +
      `${loc!.fix ?? 'Wire Name/BuildingName ports from checklist namePort, then re-execute.'}${actualNote}`
    )
  }

  return (
    `[primaryFailure: structural] pipeline.execute verification failed (empty/disconnected group outputs). ` +
    `Fix wiring via pipeline.get(groupId) + applyBatch, then re-execute. ` +
    (hints[0] ?? 'See verification.hints')
  )
}

export function summarizeProjectOpen(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const source = payload as Record<string, unknown>
  const project = source.project && typeof source.project === 'object' ? source.project as Record<string, unknown> : {}
  const pipeline = source.pipeline && typeof source.pipeline === 'object' ? source.pipeline as Record<string, unknown> : {}
  const count = (value: unknown): number => Array.isArray(value)
    ? value.length
    : value && typeof value === 'object'
      ? Object.keys(value).length
      : 0
  return {
    project: {
      id: project.id,
      ...(project.name !== undefined ? { name: project.name } : {}),
      ...(project.type !== undefined ? { type: project.type } : {}),
    },
    pipeline: {
      id: pipeline.id,
      hash: pipeline.hash,
      nodeCount: count(pipeline.nodes),
      edgeCount: count(pipeline.edges),
    },
    ...(source.openMode !== undefined ? { openMode: source.openMode } : {}),
    ...(source.writeLockedBy !== undefined ? { writeLockedBy: source.writeLockedBy } : {}),
  }
}

function executionVerificationResponse(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload
  const summary = payload as Record<string, unknown>
  return {
    executionId: summary.executionId,
    status: summary.status,
    durationMs: summary.durationMs,
    ...(summary.error !== undefined ? { error: summary.error } : {}),
    ...(summary.execFailures !== undefined ? { execFailures: summary.execFailures } : {}),
    summarized: true,
    verificationOnly: true,
    ...(summary.verification !== undefined ? { verification: summary.verification } : {}),
  }
}

export const tools: Record<string, ToolHandler> = {
  'scene:projects.list': async (_args, ctx) => request(ctx, 'GET', '/api/v1/projects'),
  'scene:projects.create': async (args, ctx) => request(ctx, 'POST', '/api/v1/projects', objectArgs(args)),
  // Shared session attach for analysis — multiple agents may open the same
  // project concurrently and call read tools. Exclusive write lock is claimed
  // later by applyBatch/execute/instantiateTemplate (those block/wait).
  'scene:projects.open': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    const opened = await request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/open`, {})
    return ctx.caller.kind === 'ai' ? summarizeProjectOpen(opened) : opened
  },
  'scene:projects.close': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/close`, {})
  },
  // Explicit lease renewal for a project you already hold — call this if
  // you expect a long non-mutating stretch (reading/reasoning) between
  // pipeline mutation calls so idle time alone never expires your lock.
  // Every successful applyBatch/execute/etc. already renews it automatically;
  // this is only needed for long gaps with no mutation in between.
  'scene:projects.heartbeat': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/heartbeat`, {})
  },
  // Check your (or anyone's) position in a project's wait queue without
  // side effects — unlike `projects.open`, this never joins the queue.
  'scene:projects.queue.status': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'GET', `/api/v1/projects/${encodeURIComponent(id)}/queue`)
  },
  // Voluntarily give up your place in a project's wait queue (e.g. you
  // decided to work on a different project instead). Idempotent.
  'scene:projects.queue.leave': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    return request(ctx, 'POST', `/api/v1/projects/${encodeURIComponent(id)}/queue/leave`, {})
  },
  'scene:projects.remove': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'id')
    return request(ctx, 'DELETE', `/api/v1/projects/${encodeURIComponent(id)}${query({ assetPolicy: body.assetPolicy })}`)
  },
  // Strip inline-image fields so the catalog is always clean text (see
  // `stripBatteryIcon` / `stripInlineImages` above).
  // Full battery catalog — human/workbench only (exposedToAI:false). Sino uses composerUtilities.*
  'scene:batteries.list': async (_args, ctx) => {
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    return Array.isArray(ops) ? ops.map(stripBatteryIcon) : ops
  },
  'scene:batteries.get': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    const op = ops.find((candidate) => candidate.id === id)
    if (!op) throw new Error(`scene battery not found: ${id}`)
    return stripBatteryIcon(op)
  },
  // Sino-facing catalog: composer wiring utilities only (matches sinoOpGate allowlist).
  'scene:composerUtilities.list': async (_args, ctx) => {
    const { filterComposerUtilityOps } = await import('./routes/sinoOpGate.js')
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    const list = Array.isArray(ops) ? filterComposerUtilityOps(ops) : []
    return list.map(stripBatteryIcon)
  },
  'scene:composerUtilities.get': async (args, ctx) => {
    const { filterComposerUtilityOps, SINO_TOP_LEVEL_OPID_ALLOWLIST } = await import('./routes/sinoOpGate.js')
    const id = stringArg(objectArgs(args), 'id')
    if (!SINO_TOP_LEVEL_OPID_ALLOWLIST.has(id)) {
      throw new Error(
        `composer utility not exposed to Sino: ${id}. Use instantiateTemplate for template groups.`,
      )
    }
    const ops = await request(ctx, 'GET', '/api/v1/ops') as Array<Record<string, unknown>>
    const op = filterComposerUtilityOps(Array.isArray(ops) ? ops : []).find((candidate) => candidate.id === id)
    if (!op) throw new Error(`composer utility not found: ${id}`)
    return stripBatteryIcon(op)
  },
  // Group templates (the 6 prebuilt scene template groups + saved group
  // batteries). These let an AI discover available template groups and their
  // exposed in_N/out_N ports — what `batteries.get` (static ops only) can't show.
  // Strip inline-image fields (iconPng data URLs / iconSvg) so the catalog is
  // always clean, parseable text — the agent only needs the group's name +
  // exposed in_N/out_N ports, never the preview pixels (which are tens of KB of
  // base64 each and would pollute the context + chat DOM). See `stripInlineImages`.
  'scene:templates.list': async (_args, ctx) => {
    const list = await request(ctx, 'GET', '/api/v1/group-templates?scope=templates')
    return stripInlineImages(list)
  },
  'scene:templates.get': async (args, ctx) => {
    const id = stringArg(objectArgs(args), 'id')
    const group = await request(ctx, 'GET', `/api/v1/group-templates/${encodeURIComponent(id)}?scope=templates`)
    return stripInlineImages(group)
  },
  // One-shot instantiation of a template group into the active project's graph.
  // Forwards to the dedicated instantiate route (NOT /api/v1/batch), so the inner
  // alg_* member createNodes are never seen by the sino op gate.
  'scene:pipeline.instantiateTemplate': async (args, ctx) => {
    const body = objectArgs(args)
    const id = stringArg(body, 'templateId')
    const projectId = await resolveProjectId(ctx, body)
    const result = await request(ctx, 'POST', `/api/v1/group-templates/${encodeURIComponent(id)}/instantiate`, {
      ...body,
      projectId,
    }) as Record<string, unknown>
    if (result.status !== 'ok' || typeof result.groupId !== 'string') {
      return result
    }
    const snap = await request(ctx, 'GET', projectPath(projectId, '/pipeline')) as {
      nodes?: Record<string, unknown> | unknown[]
    }
    const nodes = snap?.nodes
    const nodeIds = Array.isArray(nodes)
      ? nodes.map((n) => (n as { id?: string }).id).filter(Boolean)
      : nodes && typeof nodes === 'object'
        ? Object.keys(nodes)
        : []
    const graphVerified = nodeIds.includes(result.groupId)
    return {
      ...result,
      graphVerified,
      graphNodeCount: nodeIds.length,
      ...(graphVerified
        ? { verifyHint: `groupId ${result.groupId} confirmed in graph (${nodeIds.length} nodes)` }
        : {
          verifyError:
            `groupId ${result.groupId} NOT in graph after instantiate — call pipeline.get before applyBatch; do NOT fabricate wiring`,
        }),
    }
  },
  'scene:pipeline.get': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    if (body.raw === true) {
      return request(ctx, 'GET', projectPath(projectId, '/pipeline'))
    }
    const q = new URLSearchParams()
    const hasSelector = Boolean(
      (typeof body.groupId === 'string' && body.groupId.trim())
      || (Array.isArray(body.nodeIds) && body.nodeIds.length > 0)
      || (typeof body.nameContains === 'string' && body.nameContains.trim())
      || (Array.isArray(body.opIdIn) && body.opIdIn.length > 0),
    )
    if (body.mode === 'hash' || (ctx.caller.kind === 'ai' && !hasSelector)) q.set('mode', 'hash')
    if (typeof body.groupId === 'string' && body.groupId.trim()) q.set('groupId', body.groupId.trim())
    if (Array.isArray(body.nodeIds)) {
      const ids = body.nodeIds.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      if (ids.length > 0) q.set('nodeIds', ids.join(','))
    }
    // grep 式模糊过滤 —— nameContains 按节点 name 子串（大小写不敏感）匹配，
    // opIdIn 按 opId 精确匹配任意一个。命中的节点 + 其一跳邻居一起返回（跟
    // groupId/nodeIds 的行为一致），不用先 pipeline.get() 全图肉眼翻找再回填
    // 具体 nodeId。两者可以和 groupId/nodeIds 同时传，取并集。
    if (typeof body.nameContains === 'string' && body.nameContains.trim()) {
      q.set('nameContains', body.nameContains.trim())
    }
    if (Array.isArray(body.opIdIn)) {
      const ids = body.opIdIn.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      if (ids.length > 0) q.set('opIdIn', ids.join(','))
    }
    const suffix = q.size > 0 ? `/pipeline/summary?${q}` : '/pipeline/summary'
    return request(ctx, 'GET', projectPath(projectId, suffix))
  },
  'scene:pipeline.applyBatch': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...batchBody } = body
    const rawOps = Array.isArray(batchBody.ops) ? batchBody.ops : []
    // P0-4 先展开 appendMergeItem（复合操作 → updateNode+connect），再统一做
    // P0-2 的 label 端口寻址解析——这样 appendMergeItem 里 source.port 也能用
    // label 写，不用先查一次 in_N/out_N。两步都只在真的用到新写法时才发起额外
    // 的 HTTP 查询，普通 ops（全是字符串 port、没有 appendMergeItem）零额外开销。
    const expandedOps = await expandAppendMergeItemOps(ctx, projectId, rawOps)
    const resolvedOps = await resolvePortLabelsInOps(ctx, projectId, expandedOps)
    return request(ctx, 'POST', projectPath(projectId, '/batch'), { ...batchBody, ops: resolvedOps })
  },
  // The agent must never pour a full ExecutionResult into its context (a real
  // graph is ~28MB and a huge scene can exceed V8's single-string limit, which
  // would throw `Invalid string length` while serializing the HTTP body). So by
  // default we call the backend's summary route, which projects the result to a
  // KB-scale summary (status + per-port child names / cell counts) BEFORE it is
  // ever serialized into an HTTP body — keeping the payload tiny regardless of
  // scene size. Escape hatch: `raw: true` hits the full route (UI parity; the
  // caller then owns the size and accepts that a massive scene may be heavy).
  'scene:pipeline.execute': async (args, ctx) => {
    const body = objectArgs(args)
    const raw = body.raw === true
    const projectIdHint =
      typeof body.projectId === 'string' && body.projectId.trim() ? body.projectId.trim() : undefined
    let narrativeLocationNames = Array.isArray(body.narrativeLocationNames)
      ? body.narrativeLocationNames.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      : []
    if (!raw && ctx.caller.kind === 'ai' && narrativeLocationNames.length === 0) {
      narrativeLocationNames = resolveNarrativeLocationNames(ctx.env, [], projectIdHint)
    }
    const projectId = await resolveProjectId(ctx, body)
    if (!raw && ctx.caller.kind === 'ai' && narrativeLocationNames.length === 0) {
      narrativeLocationNames = resolveNarrativeLocationNames(ctx.env, [], projectId)
    }
    const forward: Record<string, unknown> = {}
    if (typeof body.nodeId === 'string') forward.nodeId = body.nodeId
    if (!raw && ctx.caller.kind === 'ai') {
      if (narrativeLocationNames.length === 0) {
        throw new Error(
          'pipeline.execute requires narrativeLocationNames:[...] (upstream location names). ' +
          'Copy the JSON array from the dispatch message — do not execute without it.',
        )
      }
      forward.narrativeLocationNames = narrativeLocationNames
    } else if (!raw && narrativeLocationNames.length > 0) {
      forward.narrativeLocationNames = narrativeLocationNames
    }
    const path = raw ? projectPath(projectId, '/execute') : projectPath(projectId, '/execute/summary')
    const payload = await request(ctx, 'POST', path, forward)
    if (!raw && ctx.caller.kind === 'ai' && payload && typeof payload === 'object') {
      const summary = payload as {
        status?: string
        verification?: {
          ok?: boolean
          hints?: string[]
          locationNameAlignment?: {
            ok?: boolean
            missing?: Array<{ name: string }>
            fix?: string
            actualNodeNames?: string[]
            actualNodeNamesTruncated?: boolean
          }
          topologyIssues?: Array<{
            kind: 'rest-fan-out' | 'illegal-local-merge' | 'manual-points-zero-default'
            reason: string
            fix: string
            suggestedOps?: unknown[]
          }>
        }
      }
      // 2026-07-15：topologyIssues 里 rest-fan-out / illegal-local-merge 这两类
      // 在拓扑上从来没有"暂时这样、后面再改"的合法中间态——一旦出现就是真的接错了
      // （不像"还没接完全部装饰"那种正常施工中的状态）。即便 status=completed 且
      // verification.ok=true（这两类目前不参与 ok 判定，见 execution-summary.ts），
      // 也在这里强制抛出，不能让 agent 只看 ok=true 就以为万事大吉——这正是
      // connect-node-task/SKILL.md 记录的真实翻车案例（fan-out/局部 merge 卡住
      // 几十 turn）本该被当场拦下的地方。manual-points-zero-default 允许有"确实
      // 就想放原点"的合法情况，不在这里强制抛出，只随 hints 一起返回。
      const blockingTopologyIssues = (summary.verification?.topologyIssues ?? []).filter(
        (i) => i.kind === 'rest-fan-out' || i.kind === 'illegal-local-merge',
      )
      if (blockingTopologyIssues.length > 0) {
        const detail = blockingTopologyIssues
          .map((i, idx) => `[${idx + 1}] ${i.reason}\n${i.fix}${i.suggestedOps ? `\nsuggestedOps: ${JSON.stringify(i.suggestedOps)}` : ''}`)
          .join('\n\n')
        throw new Error(
          `[primaryFailure: topology] pipeline.execute detected ${blockingTopologyIssues.length} topology violation(s) that are NEVER a legitimate mid-construction state ` +
          '(Rest fan-out / illegal local tree_merge) — fix these before doing anything else, do not adjust tree_merge params first:\n\n' +
          detail,
        )
      }
      const verificationError = formatExecuteVerificationFailure(summary)
      if (verificationError) {
        throw new Error(verificationError)
      }
    }
    return !raw && ctx.caller.kind === 'ai' && body.mode !== 'summary'
      ? executionVerificationResponse(payload)
      : payload
  },
  'scene:pipeline.import': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...importBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/pipeline/import'), importBody)
  },
  'scene:pipeline.export': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const { projectId: _omit, ...exportBody } = body
    return request(ctx, 'POST', projectPath(projectId, '/pipeline/export'), exportBody)
  },
  // 复盘(2026-07-01 sino bake/export 工具缺口):bake/export 一直只有 HTTP 路由 +
  // UI 按钮,agent 完全没有工具能触达——sino 走到"图搭完了"就没有下一步了。这两个
  // 工具补上 M7（收尾)：先 bakeFromExecute 把当前图的执行结果快照成可编辑的 baked
  // 图层（原地在服务端投影出体素,agent 不搬 cells),再 export.cook 把 baked 图层
  // 烘焙打包成 scene.zip。都不需要参数拼 cells——分别对应 SKILL.md 的 M7 步骤。
  'scene:baked.bakeFromExecute': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const forward: Record<string, unknown> = {}
    if (typeof body.nodeId === 'string') forward.nodeId = body.nodeId
    return request(ctx, 'POST', projectPath(projectId, '/baked/bake-from-execute'), forward)
  },
  'scene:sceneExport.cook': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const forward: Record<string, unknown> = {}
    if (typeof body.sceneName === 'string') forward.sceneName = body.sceneName
    if (body.allowMissingAssets === true) forward.allowMissingAssets = true
    return request(ctx, 'POST', projectPath(projectId, '/scene-export/cook'), forward)
  },
  'scene:mesh3dExport.cook': async (args, ctx) => {
    const body = objectArgs(args)
    const projectId = await resolveProjectId(ctx, body)
    const forward: Record<string, unknown> = {}
    if (typeof body.sceneName === 'string') forward.sceneName = body.sceneName
    if (typeof body.sceneId === 'string') forward.sceneId = body.sceneId
    if (typeof body.gameSlug === 'string') forward.gameSlug = body.gameSlug
    if (body.allowMissingAssets === true) forward.allowMissingAssets = true
    return request(ctx, 'POST', projectPath(projectId, '/mesh3d-export/cook'), forward)
  },
  'scene:assets.list': async (args, ctx) => request(ctx, 'GET', `/api/v1/assets${query(objectArgs(args))}`),
  // Library listing (base ∪ project-private, paginated) — the ONLY way for an
  // agent to SEE/verify what it published via `scene:library.publishExternal`.
  // (`scene:assets.list` above lists the shared filesystem `assets/` dir, NOT
  // the private library DB, so it can't confirm a publish.) Defaults to the
  // `raw` zone (the publish bridge's landing zone).
  'scene:library.list': async (args, ctx) => {
    const a = objectArgs(args)
    return request(ctx, 'GET', `/api/v1/library/list${query({ zone: 'raw', ...a })}`)
  },
  // Texture-pipeline publish bridge. Lands a 2D-generated PNG (base64) into this
  // scene project's private `raw` zone so the billboard renderer can match it —
  // composing a renderer-shaped alias (field4=assetName, field8=type), binding a
  // tile's autotile rule (autotileKind), and recording provenance (sourceBlobId,
  // idempotent). Args: { assetName, assetType:'tile'|'object', dataBase64,
  // autotileKind?, sourceBlobId?, anchorX?, anchorY?, geometryJson?, extraFields? }.
  // Bind the shared-game-sandbox textures dir (where the 2D app publishes via
  // asset2d:publishToGame) so the scene workbench reads it as an asset source —
  // surfaced in the AssetStore view AND merged into the renderer matching pool.
  // The host tool process resolves the absolute dir from its cwd (= project root).
  'scene:library.useGameTextures': async (args, ctx) => {
    const a = objectArgs(args)
    const gameSlug = stringArg(a, 'gameSlug')
    const root = typeof a.projectRoot === 'string' && a.projectRoot.trim() ? a.projectRoot.trim() : ctx.cwd
    const base = isAbsolute(root) ? root : resolvePath(ctx.cwd, root)
    const dir = resolvePath(base, '.forgeax', 'games', gameSlug, 'textures')
    return request(ctx, 'POST', '/api/v1/library/use-game-textures', { dir })
  },
  'scene:library.publishExternal': async (args, ctx) => {
    const a = { ...objectArgs(args) }
    // Preferred path: agent passes a 2D asset reference (from2dAlias / from2dBlobId)
    // and we fetch the bytes server-to-server here. The agent NEVER carries the
    // base64 — large base64 in the conversation gets dropped by auto-compaction,
    // which previously caused publishExternal to loop (lost dataBase64 → re-fetch
    // → compact → repeat). Raw `dataBase64` is still accepted for back-compat.
    const from2dAlias = typeof a.from2dAlias === 'string' ? a.from2dAlias.trim() : ''
    const from2dBlobId = typeof a.from2dBlobId === 'string' ? a.from2dBlobId.trim() : ''
    if (!a.dataBase64 && (from2dAlias || from2dBlobId)) {
      a.dataBase64 = await fetch2dAssetBase64(ctx, { alias: from2dAlias || undefined, blobId: from2dBlobId || undefined })
      if (!a.sourceBlobId && from2dBlobId) a.sourceBlobId = from2dBlobId
    }
    // These are tool-layer-only hints; the backend route doesn't know them.
    delete a.from2dAlias
    delete a.from2dBlobId
    return request(ctx, 'POST', '/api/v1/library/publish-external', a)
  },
  // screenshot.capture / screenshot.latest 已不再向 AI 注册（截图视觉验证模块退役）；
  // 仅保留 store 作为渲染器内部回写端点（exposedToAI:false，供 studio 截图按钮等非 agent 调用方使用）。
  'scene:screenshot.store': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/screenshot/store', objectArgs(args)),
  'scene:renderer.info': async (_args, ctx) => request(ctx, 'GET', '/api/v1/agent/renderer/info'),
  'scene:renderer.setViewMode': async (args, ctx) => request(ctx, 'PATCH', '/api/v1/agent/renderer/view-mode', objectArgs(args)),
  'scene:renderer.selectLayer': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/renderer/select-layer', objectArgs(args)),
  'scene:renderer.openAllSubLayers': async (args, ctx) => request(ctx, 'POST', '/api/v1/agent/renderer/open-all-sublayers', objectArgs(args)),
}

export default tools
