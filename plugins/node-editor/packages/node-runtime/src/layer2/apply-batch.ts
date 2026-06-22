// applyBatch: the single atomic mutation entry-point.
//
// Every editor operation — UI drag, AI tool call, CLI command — translates
// into one or more Op records and submits them as a single batch. All-or-
// nothing semantics: validation runs over a copy of the live graph, and
// only on full success does the kernel swap graph.json + append a single
// history.jsonl entry.

import { randomUUID } from 'node:crypto'

import type { GraphFileV1 } from '../layer1/storage/types.js'
import type { GraphEdge, GraphNode, ExposedPort, Position } from '../layer1/types/graph.js'
import type { OpRegistry } from '../layer1/op-registry.js'
import type { OpAccess } from '../layer1/types/op-spec.js'
import { getDownstreamNodeIds } from '../layer1/index.js'
import { deriveGroupPorts } from './derive-group-ports.js'
import { gcOrphanGroups } from './group-reachability.js'
import { busFor } from './event-bus.js'
import { markGraphSelfWrite } from './graph-external-sync.js'
import { GROUP_OP_ID } from './group-constants.js'
import type { Runtime } from './runtime.js'

export { GROUP_OP_ID } from './group-constants.js'

/**
 * Incremental presentation-overlay patch for one exposed group port, keyed by
 * `portName`. Only the optional overlay fields are patchable; the wiring
 * authority (portType / access / sourceNodeId / sourcePortName) is owned by
 * createGroup derivation and never mutated here. A field set to `undefined` is
 * treated as "no change"; clearing an override is done by writing its default
 * (e.g. `hidden: false`).
 */
export interface ExposedPortPatch {
  portName: string
  hidden?: boolean
  order?: number
  customLabel?: string
  customLabelEn?: string
}

/**
 * One entry of a createGroup AUTHORITATIVE port contract. Unlike
 * `ExposedPortPatch` (a presentation overlay keyed by an already-derived
 * portName), this is the stable external identity of a boundary port that the
 * caller OWNS — used by the "drag a saved group template back onto the canvas"
 * path so a group behaves like a first-class battery: its `portName` is a
 * topology-independent stable id (assigned once at the group's birth and stored
 * in the template), NOT a name re-derived from the (volatile) inner node id.
 *
 * The kernel binds `portName` → `(sourceNodeId, sourcePortName)` and rewrites
 * boundary edges to this `portName`; the wiring tier (portType / access) is
 * still resolved from the inner member's OpSpec so the boundary mirrors the
 * inner battery exactly. The presentation overlay fields ride along.
 *
 * `sourceNodeId` must reference a (post-remap) member node and `sourcePortName`
 * one of its ports; an entry that resolves to neither is dropped (the contract
 * is advisory for unknown ports, never fatal).
 */
export interface ExposedPortContract {
  portName: string
  sourceNodeId: string
  sourcePortName: string
  /**
   * Caller-owned port type override. When provided it is honoured verbatim;
   * when absent the boundary type is derived from the inner member's OpSpec
   * (`resolveBoundaryPort`). This lets a saved group carry a user-set boundary
   * type across the drag-out / re-instantiation path instead of the kernel
   * always re-deriving it (which reverted the type and flipped status to
   * `unsaved*`).
   */
  portType?: string
  hidden?: boolean
  order?: number
  customLabel?: string
  customLabelEn?: string
}

/** Op record — discriminated union over edit primitives. */
export type Op =
  | {
      type: 'createNode'
      nodeId: string
      opId: string
      position: { x: number; y: number }
      params: Record<string, unknown>
      // Optional display name (additive; preserves labels on graph import).
      name?: string
    }
  | { type: 'updateNode'; nodeId: string; params?: Record<string, unknown>; position?: { x: number; y: number }; name?: string }
  | { type: 'deleteNode'; nodeId: string }
  | {
      type: 'connect'
      edgeId: string
      source: { nodeId: string; port: string }
      target: { nodeId: string; port: string }
    }
  | { type: 'disconnect'; edgeId: string }
  | { type: 'setMetadata'; key: string; value: unknown }
  | {
      // Delete a composite group as a single battery: remove the shadow node,
      // its packed sub-graph entry, and all outer boundary edges. Unlike
      // `ungroup`, this intentionally does not restore inner members.
      type: 'deleteGroup'
      groupId: string
    }
  | {
      // Wraps a set of currently top-level nodes into a single composite
      // group node. The group appears in `graph.nodes` with the special
      // opId `__group__`; its sub-graph (member nodes + internal edges +
      // auto-derived exposed ports) lives in `graph.groups[groupId]`.
      // Edges that crossed the boundary are rewritten to reference the
      // group node id and a synthetic exposed-port name. v0.2.0 supports
      // single-level groups only — members must be plain nodes (not
      // already-grouped or themselves group nodes); nested groups land
      // in a follow-up.
      type: 'createGroup'
      groupId: string
      name: string
      memberNodeIds: readonly string[]
      position: { x: number; y: number }
      nameEn?: string
      // AUTHORITATIVE exposed-port contract. When present, the caller OWNS the
      // boundary identity of the group: each entry binds a STABLE `portName`
      // (a topology-independent id minted once at the group's birth and stored
      // in its template — e.g. `in_0`, `out_1`) to its inner mapping
      // `(sourceNodeId, sourcePortName)`. The kernel rewrites boundary edges to
      // these stable names instead of re-deriving names from the (volatile,
      // post-remap) inner node ids. This is what lets a group behave like a
      // first-class battery: its outward port names never shift when it is
      // re-instantiated from a template (the original "drop a saved group →
      // ports disconnect / no result" bug). The wiring tier (portType/access)
      // is still resolved from the inner OpSpec so the boundary mirrors the
      // inner battery; presentation overlay (hidden/order/customLabel*) rides
      // along. Entries whose (sourceNodeId, sourcePortName) resolves to no
      // live member port are dropped (advisory, never fatal). Members/ports
      // present in the topology but absent from the contract still get a
      // freshly-allocated stable name so nothing is silently lost.
      //
      // When ABSENT (ordinary "select nodes → group"), the kernel derives the
      // ports from topology and mints fresh sequential stable names itself.
      exposedPorts?: {
        inputs?: readonly ExposedPortContract[]
        outputs?: readonly ExposedPortContract[]
      }
    }
  | {
      // Mutate an existing group's metadata. Member reshuffling is
      // intentionally out of scope for v0.2.0 — use ungroup + createGroup
      // for now. Provided fields replace; omitted fields preserve.
      type: 'updateGroup'
      groupId: string
      name?: string
      nameEn?: string
      position?: { x: number; y: number }
      // Incremental presentation-overlay patch for already-exposed ports,
      // keyed by portName. Only the overlay fields (hidden/order/customLabel*)
      // are patched; the wiring authority (portType/access/source*) is never
      // touched. Unknown portNames are ignored (the port set is owned by
      // createGroup/ungroup, not this op).
      exposedPorts?: {
        inputs?: readonly ExposedPortPatch[]
        outputs?: readonly ExposedPortPatch[]
      }
      // FULL exposed-port set replacement (wiring authority + overlay). The
      // overlay-only `exposedPorts` patch above cannot express the group inner
      // view's "shell" structural edits — adding a brand-new port (`+新建端口`),
      // true-deleting one, or rebinding it to a different inner port. When
      // present, the provided direction REPLACES
      // `graph.groups[groupId].exposed{Inputs,Outputs}` wholesale, so the
      // editor's post-edit port set becomes the new SSOT (mirrors how
      // `nodes`/`edges` below replace the inner sub-graph). A placeholder port
      // created by `+新建端口` carries an empty source mapping until it is wired.
      exposedWiring?: {
        inputs?: readonly ExposedPort[]
        outputs?: readonly ExposedPort[]
      }
      // Inner sub-graph edits made in the group's internal view. When present,
      // each REPLACES the corresponding field of `graph.groups[groupId]`
      // wholesale (the editor flushes the full, post-edit inner arrays on exit):
      //   - `nodes`   — member node objects (param/name edits inside the view)
      //   - `edges`   — member-to-member internal edges (connect/disconnect)
      //   - `innerLayout` — display-only inner positions
      // Without this, internal-view connection edits were flushed to the client
      // store but never persisted to the kernel sub-graph, so the next
      // getPipeline re-pull reverted them.
      nodes?: readonly GraphNode[]
      edges?: readonly GraphEdge[]
      innerLayout?: Record<string, Position>
    }
  | {
      // Restore the group's sub-graph to the outer view. Member nodes
      // and internal edges are re-introduced into graph.nodes /
      // graph.edges; outer edges referencing the group via exposed
      // ports are rewritten back to the inner endpoints. The group
      // shadow node and graph.groups entry are deleted.
      type: 'ungroup'
      groupId: string
    }

export interface ApplyBatchOptions {
  // Run full validation but do not write. Useful for dry-run / preview.
  dryRun?: boolean
  // Optimistic concurrency token. Reject if current graph hash differs.
  expectedPrevHash?: string
  // Audit field — who is performing this batch. Default 'unknown'.
  actor?: string
  // Optional human-readable annotation persisted on the history entry, letting AI / CLI callers describe a batch (e.g. "AI: 创建山脉 ×2") so editors can show a meaningful label.
  label?: string
  // Override the timestamp used for history.ts. Default new Date().toISOString().
  ts?: string
  // Override the batchId used in history. Default random UUID.
  batchId?: string
  /**
   * Ephemeral (high-frequency intermediate) batch — e.g. a live slider-drag
   * tick. Persists graph.json + invalidates the output cache + emits
   * graph:applied EXACTLY like a normal batch (so SSOT and live consumers stay
   * correct), but writes NO audit line to history.jsonl. The settled value is
   * committed by a later non-ephemeral batch, so the audit log records the
   * final state — not every drag tick. Default false.
   */
  ephemeral?: boolean
}

export type Diagnostic = { opIndex: number; severity: 'error' | 'warn'; message: string }

export interface ApplyBatchResult {
  status: 'ok' | 'rejected'
  // New graph hash if status === 'ok'.
  newHash?: string
  // Rejection reason if status === 'rejected'.
  reason?: string
  // Per-op validation findings (for UI surfacing).
  diagnostics?: ReadonlyArray<Diagnostic>
  // History batchId on ok.
  batchId?: string
}

// A batch that only repositions things or updates presentation metadata (viewport / frames /
// annotations) changes nothing the executor or renderer depends on. It is still persisted and
// recorded in history, but must NOT emit a `graph:applied` data-change event — otherwise every
// live client re-pulls the snapshot and rebuilds previews on each node drag. Mirrors the legacy
// model where moving a node was a plain position save, never a re-exec/re-pull trigger.
function isLayoutOnlyBatch(ops: readonly Op[]): boolean {
  if (ops.length === 0) return false
  return ops.every((op) => {
    switch (op.type) {
      case 'updateNode':
        return op.position !== undefined && op.params === undefined && op.name === undefined
      case 'updateGroup':
        // Position and/or inner display layout are presentation-only. Any of
        // name/nameEn/exposedPorts/nodes/edges changes the rendered face or the
        // computation, so those are NOT layout-only (they must emit graph:applied
        // → re-pull + re-exec).
        return (
          (op.position !== undefined || op.innerLayout !== undefined) &&
          op.name === undefined &&
          op.nameEn === undefined &&
          op.exposedPorts === undefined &&
          op.exposedWiring === undefined &&
          op.nodes === undefined &&
          op.edges === undefined
        )
      case 'setMetadata':
        return op.key === 'viewport' || op.key === 'frames' || op.key === 'annotations'
      default:
        return false
    }
  })
}

// Bootstrap an empty graph file — used by the first applyBatch on a fresh project.
function emptyGraph(pipelineId: string, ts: string): Omit<GraphFileV1, 'hash'> {
  return {
    schemaVersion: 1,
    id: pipelineId,
    createdAt: ts,
    updatedAt: ts,
    nodes: {},
    edges: {},
  }
}

function applyOps(
  graph: GraphFileV1,
  ops: readonly Op[],
  registry?: OpRegistry,
): { ok: true } | { ok: false; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    switch (op.type) {
      case 'createNode': {
        if (graph.nodes[op.nodeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `node ${op.nodeId} already exists` })
          break
        }
        graph.nodes[op.nodeId] = {
          id: op.nodeId,
          opId: op.opId,
          position: op.position,
          params: op.params ?? {},
          ...(op.name !== undefined ? { name: op.name } : {}),
        }
        break
      }
      case 'updateNode': {
        const node = graph.nodes[op.nodeId]
        if (node) {
          if (op.params !== undefined) node.params = { ...node.params, ...op.params }
          if (op.position !== undefined) node.position = op.position
          if (op.name !== undefined) node.name = op.name
          break
        }
        // Group-aware fallback: the node may be a member of a group's inner
        // sub-graph (groups are not flattened into graph.nodes). This lets an
        // external mapped Run button / AI route persist a manual-trigger inner
        // battery's result (`_gen_image` / `_gen_result` / `_gen_error`) onto the
        // inner node by its globally-unique id, the SAME op a top-level node uses.
        let innerNode: GraphNode | undefined
        for (const grp of Object.values(graph.groups ?? {})) {
          const found = grp.nodes.find((n) => n.id === op.nodeId)
          if (found) {
            innerNode = found
            break
          }
        }
        if (!innerNode) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `node ${op.nodeId} does not exist` })
          break
        }
        if (op.params !== undefined) innerNode.params = { ...innerNode.params, ...op.params }
        if (op.position !== undefined) innerNode.position = op.position
        if (op.name !== undefined) innerNode.name = op.name
        break
      }
      case 'deleteNode': {
        if (!graph.nodes[op.nodeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `node ${op.nodeId} does not exist` })
          break
        }
        delete graph.nodes[op.nodeId]
        // Cascade-remove edges that referenced this node.
        for (const [edgeId, edge] of Object.entries(graph.edges)) {
          if (edge.source.nodeId === op.nodeId || edge.target.nodeId === op.nodeId) {
            delete graph.edges[edgeId]
          }
        }
        break
      }
      case 'connect': {
        if (graph.edges[op.edgeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `edge ${op.edgeId} already exists` })
          break
        }
        if (!graph.nodes[op.source.nodeId]) {
          diagnostics.push({
            opIndex: i,
            severity: 'error',
            message: `connect.source.nodeId ${op.source.nodeId} does not exist`,
          })
          break
        }
        if (!graph.nodes[op.target.nodeId]) {
          diagnostics.push({
            opIndex: i,
            severity: 'error',
            message: `connect.target.nodeId ${op.target.nodeId} does not exist`,
          })
          break
        }
        graph.edges[op.edgeId] = { id: op.edgeId, source: op.source, target: op.target }
        break
      }
      case 'disconnect': {
        if (!graph.edges[op.edgeId]) {
          diagnostics.push({ opIndex: i, severity: 'error', message: `edge ${op.edgeId} does not exist` })
          break
        }
        delete graph.edges[op.edgeId]
        break
      }
      case 'setMetadata': {
        graph.metadata = { ...(graph.metadata ?? {}), [op.key]: op.value }
        break
      }
      case 'deleteGroup': {
        const result = applyDeleteGroup(graph, op, i)
        if (result.error) diagnostics.push(result.error)
        break
      }
      case 'createGroup': {
        const result = applyCreateGroup(graph, op, i, registry)
        if (result.error) diagnostics.push(result.error)
        break
      }
      case 'updateGroup': {
        const result = applyUpdateGroup(graph, op, i)
        if (result.error) diagnostics.push(result.error)
        break
      }
      case 'ungroup': {
        const result = applyUngroup(graph, op, i)
        if (result.error) diagnostics.push(result.error)
        break
      }
    }
  }
  if (diagnostics.some((d) => d.severity === 'error')) return { ok: false, diagnostics }
  return { ok: true }
}

type CreateGroupOp = Extract<Op, { type: 'createGroup' }>
type UpdateGroupOp = Extract<Op, { type: 'updateGroup' }>
type DeleteGroupOp = Extract<Op, { type: 'deleteGroup' }>
type UngroupOp = Extract<Op, { type: 'ungroup' }>

/**
 * Stable exposed-port name resolver, scoped to a single createGroup. A group is
 * a first-class battery: its outward port names are STABLE ids that do not
 * encode (and therefore never shift with) the inner node ids.
 *
 * Two modes:
 *   - CONTRACT mode (caller passed `op.exposedPorts`): the authoritative
 *     `portName` is whatever the contract bound to `(sourceNodeId,
 *     sourcePortName)`. This is the "drop a saved group template" path — the
 *     template carries the stable names minted at the group's birth, and we
 *     honour them verbatim so edges/overlay/exec all line up after id remap.
 *   - DERIVE mode (no contract — ordinary "select nodes → group"): mint a fresh
 *     sequential id per direction (`in_0`, `in_1`, … / `out_0`, `out_1`, …).
 *
 * In either mode the returned name is stable for a given `(sourceNodeId,
 * sourcePortName)` within this group: the resolver memoises so the boundary-edge
 * pass and the unconnected-port pass agree on one name per inner port.
 */
interface ExposedNameResolver {
  resolve(direction: 'in' | 'out', sourceNodeId: string, sourcePortName: string): string
}

function makeExposedNameResolver(
  contract: { inputs?: readonly ExposedPortContract[]; outputs?: readonly ExposedPortContract[] } | undefined,
): ExposedNameResolver {
  // key: `${direction}\0${sourceNodeId}\0${sourcePortName}` → portName
  const contractByMapping = new Map<string, string>()
  // Track taken names per direction so DERIVE-mode allocation never collides
  // with a contract-supplied name (and so suffix counters stay monotonic).
  const takenIn = new Set<string>()
  const takenOut = new Set<string>()
  const memo = new Map<string, string>()
  let nextIn = 0
  let nextOut = 0

  const ingest = (direction: 'in' | 'out', entries: readonly ExposedPortContract[] | undefined): void => {
    if (!entries) return
    for (const e of entries) {
      contractByMapping.set(`${direction}\0${e.sourceNodeId}\0${e.sourcePortName}`, e.portName)
      ;(direction === 'in' ? takenIn : takenOut).add(e.portName)
    }
  }
  ingest('in', contract?.inputs)
  ingest('out', contract?.outputs)

  return {
    resolve(direction, sourceNodeId, sourcePortName) {
      const memoKey = `${direction}\0${sourceNodeId}\0${sourcePortName}`
      const cached = memo.get(memoKey)
      if (cached !== undefined) return cached
      const fromContract = contractByMapping.get(memoKey)
      if (fromContract !== undefined) {
        memo.set(memoKey, fromContract)
        return fromContract
      }
      // No contract entry for this mapping → mint a fresh stable id.
      const taken = direction === 'in' ? takenIn : takenOut
      let name: string
      do {
        name = direction === 'in' ? `in_${nextIn++}` : `out_${nextOut++}`
      } while (taken.has(name))
      taken.add(name)
      memo.set(memoKey, name)
      return name
    },
  }
}

// Resolve a member node's port to its real { type, access } from the OpSpec so the group
// boundary mirrors the inner tier instead of a hardcoded `any`, falling back to { type: 'any' }
// when the registry or the port/op is unknown.
function resolveBoundaryPort(
  registry: OpRegistry | undefined,
  node: GraphFileV1['nodes'][string] | undefined,
  portName: string,
  direction: 'in' | 'out',
  groups?: GraphFileV1['groups'],
): { portType: string; access?: OpAccess } {
  if (!node) return { portType: 'any' }
  // A __group__ member's wiring tier lives on its sub-group's exposed ports,
  // not in the OpRegistry (which has no per-instance __group__ spec). The child
  // group id is stored on the shadow node's params.groupId (see applyCreateGroup).
  if (node.opId === GROUP_OP_ID) {
    const childId = typeof node.params?.groupId === 'string' ? node.params.groupId : ''
    const child = groups?.[childId]
    const list = direction === 'in' ? child?.exposedInputs : child?.exposedOutputs
    const ep = list?.find((p) => p.portName === portName)
    if (ep) return ep.access !== undefined ? { portType: ep.portType, access: ep.access } : { portType: ep.portType }
    return { portType: 'any' }
  }
  if (!registry) return { portType: 'any' }
  const spec = registry.get(node.opId)
  if (!spec) return { portType: 'any' }
  const ports = direction === 'in' ? spec.inputs : spec.outputs
  const port = ports.find((p) => p.name === portName)
  if (port) {
    return port.access !== undefined ? { portType: port.type, access: port.access } : { portType: port.type }
  }
  // Dynamic ports (e.g. tree_merge's `item_0`) aren't enumerated statically;
  // derive their tier from the dynamic-port template instead.
  const dyn = direction === 'in' ? spec.dynamicInputs : spec.dynamicOutputs
  if (dyn && portName.startsWith(dyn.prefix)) {
    return dyn.access !== undefined ? { portType: dyn.type, access: dyn.access } : { portType: dyn.type }
  }
  return { portType: 'any' }
}

function applyCreateGroup(
  graph: GraphFileV1,
  op: CreateGroupOp,
  opIndex: number,
  registry?: OpRegistry,
): { error?: Diagnostic } {
  if (graph.nodes[op.groupId]) {
    return { error: { opIndex, severity: 'error', message: `node ${op.groupId} already exists` } }
  }
  if (graph.groups?.[op.groupId]) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} already exists` } }
  }
  if (op.memberNodeIds.length === 0) {
    return { error: { opIndex, severity: 'error', message: 'createGroup requires at least one member' } }
  }
  for (const id of op.memberNodeIds) {
    const node = graph.nodes[id]
    if (!node) {
      return { error: { opIndex, severity: 'error', message: `member ${id} does not exist` } }
    }
  }

  // Move members out of graph.nodes. Keep a lookup so boundary-port type/access
  // can still be resolved from the inner OpSpec after deletion.
  const memberById = new Map<string, GraphFileV1['nodes'][string]>()
  const innerNodes = op.memberNodeIds.map((id) => {
    const n = graph.nodes[id]!
    memberById.set(id, n)
    delete graph.nodes[id]
    return n
  })

  // Stable port-name resolver: honour the caller's authoritative contract when
  // present (template re-instantiation), else mint fresh sequential ids.
  const nameResolver = makeExposedNameResolver(op.exposedPorts)

  // Partition edges by boundary and track internal wiring for port exposure.
  const innerEdges: GraphFileV1['edges'][string][] = []
  const exposedInputs: Array<{
    portName: string
    portType: string
    access?: OpAccess
    sourceNodeId: string
    sourcePortName: string
  }> = []
  const exposedOutputs: typeof exposedInputs = []
  const hasInternalOutgoing = new Set<string>()
  const portHasInternalIn = new Set<string>()
  const exposedInputSet = new Set<string>()
  const exposedOutputSet = new Set<string>()

  // Shared derivation (single authority, reused by the editor). Wiring tier is
  // resolved from the inner member's OpSpec via resolveBoundaryPort.
  const derived = deriveGroupPorts({
    memberNodeIds: op.memberNodeIds,
    nodes: new Map(op.memberNodeIds.map((id) => [id, { id, opId: memberById.get(id)!.opId }])),
    edges: Object.entries(graph.edges).map(([id, e]) => ({ id, source: e.source, target: e.target })),
    resolvePortTier: (nodeId, port, dir) => resolveBoundaryPort(registry, memberById.get(nodeId), port, dir, graph.groups),
  })

  for (const id of derived.internalEdgeIds) {
    const e = graph.edges[id]!
    hasInternalOutgoing.add(e.source.nodeId)
    portHasInternalIn.add(`${e.target.nodeId}\0${e.target.port}`)
    innerEdges.push(e)
    delete graph.edges[id]
  }

  // CONTRACT is AUTHORITATIVE: when present, MATERIALIZE every contract port up
  // front (not just rename derived ones). A freshly-dropped template has NO
  // boundary edges, so `derived` is empty — yet its ports must still surface.
  // Each contract entry's wiring tier is resolved from the inner member's OpSpec
  // (never trusted off the contract); a stale entry whose sourceNodeId is not a
  // member is dropped (advisory). We record the mapping key -> portName so the
  // derived boundary pass below reuses the contract name (no dupes) for ports
  // that DO have a boundary edge.
  const contractInName = new Map<string, string>() // `${sourceNodeId}\0${sourcePortName}` -> portName
  const contractOutName = new Map<string, string>()
  if (op.exposedPorts) {
    for (const c of op.exposedPorts.inputs ?? []) {
      const member = memberById.get(c.sourceNodeId)
      if (!member) continue // genuinely stale entry (sourceNodeId not a member)
      const tier = resolveBoundaryPort(registry, member, c.sourcePortName, 'in', graph.groups)
      if (exposedInputSet.has(c.portName)) continue
      exposedInputSet.add(c.portName)
      contractInName.set(`${c.sourceNodeId}\0${c.sourcePortName}`, c.portName)
      exposedInputs.push({
        portName: c.portName,
        portType: c.portType ?? tier.portType,
        ...(tier.access !== undefined ? { access: tier.access } : {}),
        sourceNodeId: c.sourceNodeId,
        sourcePortName: c.sourcePortName,
      })
    }
    for (const c of op.exposedPorts.outputs ?? []) {
      const member = memberById.get(c.sourceNodeId)
      if (!member) continue
      const tier = resolveBoundaryPort(registry, member, c.sourcePortName, 'out', graph.groups)
      if (exposedOutputSet.has(c.portName)) continue
      exposedOutputSet.add(c.portName)
      contractOutName.set(`${c.sourceNodeId}\0${c.sourcePortName}`, c.portName)
      exposedOutputs.push({
        portName: c.portName,
        portType: c.portType ?? tier.portType,
        ...(tier.access !== undefined ? { access: tier.access } : {}),
        sourceNodeId: c.sourceNodeId,
        sourcePortName: c.sourcePortName,
      })
    }
  }

  // Honour an authoritative contract's port NAMES (template re-instantiation) by
  // remapping derived sequential names -> contract names per boundary mapping.
  // A derived boundary port already materialized from the contract reuses its
  // contract portName (so the rewrite below points at it) and is NOT re-added.
  const renameIn = new Map<string, string>()
  const renameOut = new Map<string, string>()
  for (const p of derived.exposedInputs) {
    const contractName = contractInName.get(`${p.sourceNodeId}\0${p.sourcePortName}`)
    if (contractName !== undefined) {
      // Already materialized from the contract; reuse its name for the rewrite,
      // don't add a duplicate exposed entry.
      renameIn.set(p.portName, contractName)
      continue
    }
    const name = nameResolver.resolve('in', p.sourceNodeId, p.sourcePortName)
    renameIn.set(p.portName, name)
    if (exposedInputSet.has(name)) continue
    exposedInputSet.add(name)
    exposedInputs.push({ ...p, portName: name })
  }
  for (const p of derived.exposedOutputs) {
    const contractName = contractOutName.get(`${p.sourceNodeId}\0${p.sourcePortName}`)
    if (contractName !== undefined) {
      renameOut.set(p.portName, contractName)
      continue
    }
    const name = nameResolver.resolve('out', p.sourceNodeId, p.sourcePortName)
    renameOut.set(p.portName, name)
    if (exposedOutputSet.has(name)) continue
    exposedOutputSet.add(name)
    exposedOutputs.push({ ...p, portName: name })
  }
  for (const rw of derived.boundaryRewrites) {
    const e = graph.edges[rw.edgeId]
    if (!e) continue
    if (rw.endpoint === 'source') {
      graph.edges[rw.edgeId] = { ...e, source: { nodeId: op.groupId, port: renameOut.get(rw.portName)! } }
    } else {
      graph.edges[rw.edgeId] = { ...e, target: { nodeId: op.groupId, port: renameIn.get(rw.portName)! } }
    }
  }

  // Expose unconnected input ports (no internal upstream) and all output
  // ports of sink nodes (no internal outgoing edge). This is a FALLBACK only:
  // when the caller hands an authoritative `exposedPorts` contract (frontend
  // "select nodes → group" and template re-instantiation BOTH do), that contract
  // is the single source of truth for the boundary — the kernel must NOT invent
  // extra ports beyond it. Auto-supplementing here previously leaked every
  // member's unconnected input port as a phantom `any` slot (e.g. inner Panel
  // `input` ports surfaced as in_2/in_3/in_4), polluting the group surface and
  // showing "any / no result". Only derive a surface when NO contract is given
  // (bare createGroup: some tests, or grouping nodes with zero connections).
  if (registry && !op.exposedPorts) {
    const sinkNodes = new Set(op.memberNodeIds.filter((id) => !hasInternalOutgoing.has(id)))
    for (const id of op.memberNodeIds) {
      const node = memberById.get(id)
      if (!node) continue
      const spec = registry.get(node.opId)
      if (!spec) continue
      for (const inp of spec.inputs) {
        if (portHasInternalIn.has(`${id}\0${inp.name}`)) continue
        const portName = nameResolver.resolve('in', id, inp.name)
        if (exposedInputSet.has(portName)) continue
        exposedInputSet.add(portName)
        exposedInputs.push({
          portName,
          portType: inp.type,
          ...(inp.access !== undefined ? { access: inp.access } : {}),
          sourceNodeId: id,
          sourcePortName: inp.name,
        })
      }
      if (sinkNodes.has(id)) {
        for (const out of spec.outputs) {
          const portName = nameResolver.resolve('out', id, out.name)
          if (exposedOutputSet.has(portName)) continue
          exposedOutputSet.add(portName)
          exposedOutputs.push({
            portName,
            portType: out.type,
            ...(out.access !== undefined ? { access: out.access } : {}),
            sourceNodeId: id,
            sourcePortName: out.name,
          })
        }
      }
    }
  }

  // Create the group shadow node + sub-graph entry.
  graph.nodes[op.groupId] = {
    id: op.groupId,
    opId: GROUP_OP_ID,
    name: op.name,
    position: op.position,
    params: { groupId: op.groupId },
  }
  if (!graph.groups) graph.groups = {}
  graph.groups[op.groupId] = {
    id: op.groupId,
    name: op.name,
    nameEn: op.nameEn,
    nodes: innerNodes,
    edges: innerEdges,
    position: op.position,
    exposedInputs,
    exposedOutputs,
  }
  // Seed the persisted presentation overlay from the authoritative contract
  // (drag-a-saved-group-back path). The contract's stable portNames are exactly
  // the names just assigned above (nameResolver honoured them), so this lands by
  // portName. Wiring authority (portType/access/source*) stays derived from the
  // live topology. No-op for ordinary "select nodes → group" (op.exposedPorts
  // undefined).
  if (op.exposedPorts) {
    patchExposedPortOverlay(graph.groups[op.groupId]!.exposedInputs, op.exposedPorts.inputs)
    patchExposedPortOverlay(graph.groups[op.groupId]!.exposedOutputs, op.exposedPorts.outputs)
  }
  return {}
}

function applyUpdateGroup(graph: GraphFileV1, op: UpdateGroupOp, opIndex: number): { error?: Diagnostic } {
  const group = graph.groups?.[op.groupId]
  if (!group) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} does not exist` } }
  }
  const node = graph.nodes[op.groupId]
  if (!node) {
    return { error: { opIndex, severity: 'error', message: `group shadow node ${op.groupId} missing — graph corrupt` } }
  }
  if (op.name !== undefined) {
    group.name = op.name
    node.name = op.name
  }
  if (op.nameEn !== undefined) {
    group.nameEn = op.nameEn
  }
  if (op.position !== undefined) {
    group.position = op.position
    node.position = op.position
  }
  // Structural exposed-port replacement (shell add / true-delete / rebind) must
  // run BEFORE the overlay patch: it carries its own overlay inline, and the
  // editor only ever sends one of the two for a given direction.
  if (op.exposedWiring) {
    if (op.exposedWiring.inputs !== undefined) {
      group.exposedInputs = op.exposedWiring.inputs.map((p) => ({ ...p }))
    }
    if (op.exposedWiring.outputs !== undefined) {
      group.exposedOutputs = op.exposedWiring.outputs.map((p) => ({ ...p }))
    }
  }
  if (op.exposedPorts) {
    patchExposedPortOverlay(group.exposedInputs, op.exposedPorts.inputs)
    patchExposedPortOverlay(group.exposedOutputs, op.exposedPorts.outputs)
  }
  // Inner sub-graph edits (internal-view connect/disconnect, inner node param
  // edits, inner node moves). Each provided field replaces the group's wholesale
  // so the editor's flushed post-edit arrays become the new SSOT. Member ids are
  // owned by createGroup/ungroup; this op only rewrites the wiring/params/layout
  // of an existing group's interior, so exposed ports are left untouched (their
  // overlay is patched via `exposedPorts` above; their wiring authority stays as
  // derived at createGroup time).
  if (op.nodes !== undefined) {
    group.nodes = op.nodes.map((n) => ({ ...n }))
  }
  if (op.edges !== undefined) {
    group.edges = op.edges.map((e) => ({ ...e }))
  }
  if (op.innerLayout !== undefined) {
    group.innerLayout = { ...op.innerLayout }
  }
  return {}
}

/**
 * Apply presentation-overlay patches onto an exposed-port array in place,
 * matching by `portName`. Only the overlay fields are written; the wiring
 * authority is left untouched. Unknown portNames are ignored (the port set is
 * owned by createGroup/ungroup). A patch field left `undefined` is a no-op so
 * callers can send sparse patches.
 */
function patchExposedPortOverlay(
  ports: ExposedPort[],
  patches: readonly ExposedPortPatch[] | undefined,
): void {
  if (!patches || patches.length === 0) return
  const byName = new Map(ports.map((p) => [p.portName, p] as const))
  for (const patch of patches) {
    const port = byName.get(patch.portName)
    if (!port) continue
    if (patch.hidden !== undefined) port.hidden = patch.hidden
    if (patch.order !== undefined) port.order = patch.order
    if (patch.customLabel !== undefined) port.customLabel = patch.customLabel
    if (patch.customLabelEn !== undefined) port.customLabelEn = patch.customLabelEn
  }
}function applyDeleteGroup(graph: GraphFileV1, op: DeleteGroupOp, opIndex: number): { error?: Diagnostic } {
  const group = graph.groups?.[op.groupId]
  const node = graph.nodes[op.groupId]
  if (!group && !node) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} does not exist` } }
  }
  if (node && node.opId !== GROUP_OP_ID) {
    return { error: { opIndex, severity: 'error', message: `node ${op.groupId} is not a group` } }
  }

  delete graph.nodes[op.groupId]
  if (graph.groups) delete graph.groups[op.groupId]
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (edge.source.nodeId === op.groupId || edge.target.nodeId === op.groupId) {
      delete graph.edges[edgeId]
    }
  }
  return {}
}

function applyUngroup(graph: GraphFileV1, op: UngroupOp, opIndex: number): { error?: Diagnostic } {
  const group = graph.groups?.[op.groupId]
  if (!group) {
    return { error: { opIndex, severity: 'error', message: `group ${op.groupId} does not exist` } }
  }
  // Restore inner nodes.
  for (const inner of group.nodes) {
    if (graph.nodes[inner.id]) {
      return { error: { opIndex, severity: 'error', message: `cannot ungroup: node ${inner.id} re-introduced collides with existing top-level node` } }
    }
    graph.nodes[inner.id] = inner
  }
  // Restore inner edges.
  for (const inner of group.edges) {
    if (graph.edges[inner.id]) {
      return { error: { opIndex, severity: 'error', message: `cannot ungroup: edge ${inner.id} collides` } }
    }
    graph.edges[inner.id] = inner
  }
  // Rewrite outer edges that referenced the group via exposed ports.
  const inMap = new Map(group.exposedInputs.map((p) => [p.portName, p] as const))
  const outMap = new Map(group.exposedOutputs.map((p) => [p.portName, p] as const))
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (edge.source.nodeId === op.groupId) {
      const exposed = outMap.get(edge.source.port)
      if (exposed) {
        graph.edges[edgeId] = {
          ...edge,
          source: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName },
        }
      }
    }
    if (edge.target.nodeId === op.groupId) {
      const exposed = inMap.get(edge.target.port)
      if (exposed) {
        graph.edges[edgeId] = {
          ...edge,
          target: { nodeId: exposed.sourceNodeId, port: exposed.sourcePortName },
        }
      }
    }
  }
  // Delete the group shadow node + entry.
  delete graph.nodes[op.groupId]
  if (graph.groups) delete graph.groups[op.groupId]
  return {}
}

/**
 * Collect the nodes whose INPUT topology a batch changes — the seeds for output-
 * cache invalidation. Deleting / adding an incoming edge, or deleting a node /
 * group, changes what a target node (and everything downstream of it) resolves
 * for its inputs, so any persisted output cache for that subtree is now stale.
 *
 * `disconnect` targets must be resolved against the PRE-batch graph (`before`),
 * because by the time invalidation runs the edge is already gone from `after`.
 * For node/group deletion we seed the deleted node id itself plus its direct
 * downstream targets (read from `before`); the deleted node's own cache is
 * removed too, and the downstream BFS over `after.edges` covers the rest.
 */
function collectInvalidationSeeds(
  before: GraphFileV1,
  ops: readonly Op[],
): Set<string> {
  const seeds = new Set<string>()
  const addDownstreamTargetsOf = (nodeId: string): void => {
    for (const edge of Object.values(before.edges)) {
      if (edge.source.nodeId === nodeId) seeds.add(edge.target.nodeId)
    }
  }
  for (const op of ops) {
    switch (op.type) {
      case 'connect':
        seeds.add(op.target.nodeId)
        break
      case 'disconnect': {
        const edge = before.edges[op.edgeId]
        if (edge) seeds.add(edge.target.nodeId)
        break
      }
      case 'deleteNode':
        seeds.add(op.nodeId)
        addDownstreamTargetsOf(op.nodeId)
        break
      case 'deleteGroup':
      case 'ungroup':
        seeds.add(op.groupId)
        addDownstreamTargetsOf(op.groupId)
        break
      default:
        break
    }
  }
  return seeds
}

/** Deep-clone a graph for applyBatch trial application without mutating SSOT on failure. */
function cloneGraph(graph: GraphFileV1): GraphFileV1 {
  if (typeof structuredClone === 'function') return structuredClone(graph)
  return JSON.parse(JSON.stringify(graph)) as GraphFileV1
}

/**
 * Apply a batch of ops atomically to a pipeline. Runs every op against an
 * in-memory copy first; only on full success does the kernel write
 * graph.json and append the history entry.
 */
export async function applyBatch(
  runtime: Runtime,
  ops: readonly Op[],
  opts: ApplyBatchOptions = {},
): Promise<ApplyBatchResult> {
  const ts = opts.ts ?? new Date().toISOString()
  const batchId = opts.batchId ?? randomUUID()
  const actor = opts.actor ?? 'unknown'

  // Load existing graph or bootstrap.
  let current: GraphFileV1
  let prevHash: string
  if (runtime.graph.exists()) {
    const loaded = runtime.graph.load()
    if (!loaded) {
      return { status: 'rejected', reason: 'graph.json exists but failed to load' }
    }
    current = loaded
    prevHash = loaded.hash
  } else {
    const seed = emptyGraph(runtime.config.pipelineId, ts)
    current = { ...(seed as GraphFileV1), hash: 'EMPTY' }
    prevHash = 'EMPTY'
  }

  if (opts.expectedPrevHash !== undefined && opts.expectedPrevHash !== prevHash) {
    return {
      status: 'rejected',
      reason: `concurrent-write: expected prevHash=${opts.expectedPrevHash}, current=${prevHash}`,
    }
  }

  // Deep-clone so failed ops do not corrupt the live in-memory graph.
  const next = cloneGraph(current)
  next.updatedAt = ts

  const apply = applyOps(next, ops, runtime.registry)
  if (!apply.ok) {
    return {
      status: 'rejected',
      reason: 'op validation failed',
      diagnostics: apply.diagnostics,
    }
  }

  if (opts.dryRun) {
    // No write. Caller gets a hypothetical newHash for preview.
    return {
      status: 'ok',
      diagnostics: [],
      batchId,
    }
  }

  // Sweep sub-groups no longer reachable from any top-level shadow node
  // (e.g. an ungroup/deleteGroup stranded a nested child). Shared sub-groups
  // referenced elsewhere stay alive.
  gcOrphanGroups(next)

  // Persist: GraphStore.save handles canonical-hash + atomic rename.
  let written: GraphFileV1
  try {
    written = runtime.graph.save(
      { ...next, hash: undefined as unknown as string },
      {
        expectedPrevHash: prevHash === 'EMPTY' ? undefined : prevHash,
        compact: opts.ephemeral === true,
      },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('concurrent-write:')) {
      return { status: 'rejected', reason: message }
    }
    throw err
  }
  markGraphSelfWrite(runtime, written.hash)

  // Ephemeral batches (live drag ticks) persist + announce like a normal batch
  // but skip the audit line — the settled value is recorded by a later
  // non-ephemeral commit, so history.jsonl logs the final state, not every tick.
  if (!opts.ephemeral) {
    runtime.history.append({
      schemaVersion: 1,
      ts,
      actor,
      batchId,
      prevHash,
      newHash: written.hash,
      ops: ops as ReadonlyArray<Record<string, unknown>>,
      ...(opts.label !== undefined ? { label: opts.label } : {}),
    })
  }

  // Invalidate the output cache for every node whose input topology this batch
  // changed — and everything downstream of it. Without this, deleting an input
  // edge (or a node/group) leaves the persisted outputs/ cache untouched, so the
  // next execute re-hydrates stale values: most visibly for manualTrigger ops
  // (the executor skips re-running them and reads their cached output straight
  // back), which is why "删除输入边后输出没变". Seeds come from the PRE-batch graph
  // (disconnect targets are already gone from `next`); the BFS walks `next.edges`.
  const seeds = collectInvalidationSeeds(current, ops)
  if (seeds.size > 0) {
    const nextEdges: GraphEdge[] = Object.values(next.edges)
    const allNodeIds = Object.keys(next.nodes)
    const toInvalidate = new Set<string>()
    for (const seed of seeds) {
      toInvalidate.add(seed)
      for (const id of getDownstreamNodeIds(seed, allNodeIds, nextEdges)) {
        toInvalidate.add(id)
      }
    }
    for (const id of toInvalidate) runtime.outputs.invalidate(id)
  }

  // Announce the mutation so consumers on the 'graph' channel learn about it —
  // except for layout-only batches (reposition / viewport / frames), which are
  // not data changes and must not drive a re-pull / preview rebuild.
  if (!isLayoutOnlyBatch(ops)) {
    busFor(runtime).emit({
      kind: 'graph:applied',
      pipelineId: runtime.config.pipelineId,
      batchId,
      newHash: written.hash,
    })
  }

  return { status: 'ok', newHash: written.hash, batchId }
}
