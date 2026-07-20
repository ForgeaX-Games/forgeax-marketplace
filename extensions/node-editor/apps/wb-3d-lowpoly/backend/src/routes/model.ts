/**
 * model.* 路由 —— DSL-first 建模一体化接口（Workstream A/D 汇合点）。
 *
 *   POST /api/v1/projects/:projectId/model/apply   —— 校验 + 编译成图 + 导入 + 执行 + QC，
 *        返回**紧凑回执**：错误/QC 信号定位到 DSL 行号、mesh-aware 穿模硬信号、URDF 指纹。
 *   GET  /api/v1/projects/:projectId/model/get      —— 从当前图反解出等价 DSL（round-trip）。
 *
 * 设计：图执行的产物（QC / URDF）来自真实 pipeline 执行（复用 importPipelineGraph +
 * executeNode）；mesh-aware QC 额外用 parts.json 的真实 bbox 补参数化 AABB 的盲区。
 * 所有节点级 error / QC 信号都映射回 DSL 行号，让 agent 直接改那一行。
 */

import type { FastifyInstance } from 'fastify'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { executeNode, getNodeOutput, getPipeline, importPipelineGraph, type Runtime } from '@forgeax/node-runtime'
import { getProjectRegistry, getRuntimeForProject, getProjectDir } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { EXECUTE_BODY_LIMIT } from './body-limits.js'
import { compileDslToGraph, graphToDsl, type CompiledEdge } from '../services/dsl-to-graph.js'
import { meshAwareQc, type BakedPart, type MeshQcSignal } from '../services/mesh-qc.js'
import { readPartsList } from '../services/parts-registry.js'
import { withTimeout, executeTimeoutMs, TimeoutError } from '../services/timeout.js'

interface ProjectParams {
  projectId: string
}

interface QcSignalOut {
  code: string
  severity: string
  message: string
  line?: number
  lines?: number[]
  ids?: string[]
}

/** 把 DataTreeEntry[]（toJSON 形态：[{path, items:[value]}]）解出首个 item 值。 */
function firstItem(dt: unknown): unknown {
  if (Array.isArray(dt)) {
    for (const entry of dt) {
      const items = entry && typeof entry === 'object' ? (entry as { items?: unknown }).items : undefined
      if (Array.isArray(items) && items.length > 0) return items[0]
    }
    return undefined
  }
  return dt
}

/** 从 runtime 输出缓存读某节点某端口值（会重组 sharded 大 payload，如 URDF 字符串）。 */
function readPort(rt: Runtime, nodeId: string, port: string): unknown {
  return firstItem(getNodeOutput(rt, nodeId, port))
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

/** 生成不与已有 id 冲突的节点 id。 */
function uniqueId(base: string, used: readonly string[]): string {
  const set = new Set(used)
  if (!set.has(base)) return base
  let i = 1
  while (set.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

export async function registerModelRoutes(app: FastifyInstance): Promise<void> {
  const prefix = '/api/v1/projects/:projectId/model'

  app.post<{ Params: ProjectParams }>(`${prefix}/apply`, {
    bodyLimit: EXECUTE_BODY_LIMIT,
    schema: {
      body: {
        type: 'object',
        required: ['source'],
        properties: {
          source: { type: 'string' },
          name: { type: 'string' },
          execute: { type: 'boolean' },
          // string shape-id or boolean; left unconstrained to avoid ajv strict union-type warning.
          bake: {},
        },
        additionalProperties: true,
      },
    },
  }, async (req, reply) => {
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ status: 'rejected', reason: access.reason, code: access.code, projectId: access.projectId })

    const body = (req.body ?? {}) as { source?: string; name?: string; execute?: boolean; bake?: string | boolean }
    const source = typeof body.source === 'string' ? body.source : ''

    // bake 模式（阶段1 单件烘焙）：bake="shape_id" 或 true（=烘最后一条语句）。
    // 追加 g_bake_part 终端而非 QC/URDF，返回 <sha>.obj + bbox，并自动登记到 parts.json。
    const bakeTarget: string | undefined =
      typeof body.bake === 'string' ? body.bake : body.bake === true ? '' : undefined
    const baking = bakeTarget !== undefined

    // 1) 校验 + 编译成图（未知/未映射 op 在此显式报错并带行号）
    const compiled = compileDslToGraph(source, { graphName: body.name, appendTerminals: !baking })
    const errors = compiled.errors.map((e) => ({ line: e.line, message: e.message, kind: e.kind }))

    // 编译失败（parse / 重复 id / 未映射 op）→ 只回错误，不动图
    if (!compiled.graph) {
      return { ok: false, phase: 'compile', statements: compiled.statementNodeIds.length, errors }
    }

    // bake 模式：把 g_bake_part 挂到几何链末端
    let bakeNodeId = ''
    if (baking) {
      bakeNodeId = uniqueId('__bake__', compiled.statementNodeIds)
      const lastStmt = compiled.statementNodeIds[compiled.statementNodeIds.length - 1]
      compiled.graph.nodes.push({
        id: bakeNodeId,
        batteryId: 'g_bake_part',
        name: 'bake',
        position: { x: (compiled.statementNodeIds.length + 1) * 220, y: 0 },
        params: { shape_id: bakeTarget },
      })
      if (lastStmt) {
        compiled.graph.edges.push({
          id: `e_geom_${lastStmt}_${bakeNodeId}`,
          source: { nodeId: lastStmt, port: 'geometry' },
          target: { nodeId: bakeNodeId, port: 'geometry' },
        })
      }
    }

    const rt = await getRuntimeForProject(projectId)

    // 2) 导入图（替换）——可视化编辑器随即显示
    const importRes = await importPipelineGraph(
      rt,
      { format: 'legacy-pipeline-v1', graph: compiled.graph as never },
      { mode: 'replace', actor: 'model.apply' },
    )
    if (importRes.status !== 'ok') {
      return {
        ok: false,
        phase: 'import',
        statements: compiled.statementNodeIds.length,
        errors,
        import: { reason: importRes.reason, diagnostics: importRes.diagnostics },
      }
    }

    // 3) 执行（带超时；QC + URDF 是图里的终端节点）
    const shouldExecute = body.execute !== false
    let execStatus = 'skipped'
    let execError: { nodeId?: string; line?: number; message: string } | undefined
    let durationMs = 0
    if (shouldExecute) {
      try {
        const handle = await executeNode(rt, {})
        const result = await withTimeout(handle.done, executeTimeoutMs(), 'model.apply execute')
        execStatus = result.status
        durationMs = result.durationMs
        if (result.error) {
          const nodeId = result.error.nodeId
          execError = {
            nodeId,
            line: nodeId ? compiled.lineByNodeId[nodeId] : undefined,
            message: result.error.message,
          }
        }
      } catch (e) {
        execStatus = e instanceof TimeoutError ? 'timeout' : 'error'
        execError = { message: e instanceof Error ? e.message : String(e) }
      }
    }

    // bake 模式：读回 g_bake_part 产物（filename/sha/bbox），返回紧凑烘焙回执
    if (baking) {
      const bakeErr = readPort(rt, bakeNodeId, 'error')
      const filename = readPort(rt, bakeNodeId, 'filename')
      const bakeFatal = execStatus === 'error' || execStatus === 'timeout' || (typeof bakeErr === 'string' && bakeErr !== '')
      return {
        ok: !bakeFatal,
        mode: 'bake',
        statements: compiled.statementNodeIds.length,
        errors,
        execution: { status: execStatus, durationMs, ...(execError ? { error: execError } : {}) },
        baked: {
          filename: typeof filename === 'string' ? filename : '',
          sha256: strOrUndef(readPort(rt, bakeNodeId, 'sha256')),
          bbox_min: readPort(rt, bakeNodeId, 'bbox_min'),
          bbox_max: readPort(rt, bakeNodeId, 'bbox_max'),
          dims: readPort(rt, bakeNodeId, 'size'),
          note: strOrUndef(readPort(rt, bakeNodeId, 'note')),
          ...(typeof bakeErr === 'string' && bakeErr ? { error: bakeErr } : {}),
        },
      }
    }

    // 4) QC 信号 → 行号
    const qcSignalsRaw = readPort(rt, compiled.qcNodeId, 'signals')
    const qcSignals: QcSignalOut[] = Array.isArray(qcSignalsRaw)
      ? qcSignalsRaw.map((s) => mapSignalLines(s, compiled.lineByNodeId))
      : []
    const qc = {
      valid: readPort(rt, compiled.qcNodeId, 'valid') === true,
      islands: asNumber(readPort(rt, compiled.qcNodeId, 'islands')),
      missing_aabb: asNumber(readPort(rt, compiled.qcNodeId, 'missing_aabb')),
      overlaps: asNumber(readPort(rt, compiled.qcNodeId, 'overlaps')),
      floating_links: asNumber(readPort(rt, compiled.qcNodeId, 'floating_links')),
      orphan_profiles: asNumber(readPort(rt, compiled.qcNodeId, 'orphan_profiles')),
      signals: qcSignals,
    }

    // 5) mesh-aware QC（用 parts.json 真实 bbox）+ 可执行修正建议
    const meshQc = await runMeshQc(projectId, source)
    const meshSignals: QcSignalOut[] = meshQc.signals.map((s) => ({
      ...mapMeshSignalLines(s, compiled.lineByNodeId),
    }))

    // 6) URDF 指纹（用 g_to_urdf 自带的 report.fingerprint；无则回退到 sha256(urdf)）。
    //    g_to_urdf 没有 error 端口——错误经 diagnostics(severity=error) 与节点执行 error 暴露。
    const urdfStr = readPort(rt, compiled.urdfNodeId, 'urdf')
    const urdfReport = readPort(rt, compiled.urdfNodeId, 'report') as { fingerprint?: unknown } | undefined
    const urdfDiags = readPort(rt, compiled.urdfNodeId, 'diagnostics')
    const urdfErrs = Array.isArray(urdfDiags)
      ? urdfDiags.filter((d) => d && typeof d === 'object' && (d as { severity?: unknown }).severity === 'error')
      : []
    const fpFromReport = urdfReport && typeof urdfReport.fingerprint === 'string' ? urdfReport.fingerprint : undefined
    const urdf = {
      fingerprint:
        fpFromReport ?? (typeof urdfStr === 'string' ? createHash('sha256').update(urdfStr).digest('hex').slice(0, 16) : undefined),
      bytes: typeof urdfStr === 'string' ? urdfStr.length : undefined,
      ...(urdfErrs.length
        ? { errors: urdfErrs.map((d) => String((d as { message?: unknown }).message ?? 'urdf error')) }
        : {}),
    }

    const fatal =
      errors.length > 0 ||
      execStatus === 'error' ||
      execStatus === 'timeout' ||
      !!execError ||
      qc.valid === false ||
      !meshQc.clean ||
      (urdf.errors?.length ?? 0) > 0

    return {
      ok: !fatal,
      statements: compiled.statementNodeIds.length,
      errors,
      execution: { status: execStatus, durationMs, ...(execError ? { error: execError } : {}) },
      qc,
      meshQc: { clean: meshQc.clean, meshResolved: meshQc.meshResolved, signals: meshSignals },
      urdf,
    }
  })

  // 烘焙清单：廉价查询本项目已 bake 的 mesh（name → sha + bbox + dims）。
  app.get<{ Params: ProjectParams }>('/api/v1/projects/:projectId/parts', async (req, reply) => {
    const { projectId } = req.params
    const reg = await getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    const dir = await getProjectDir(projectId)
    const parts = dir ? readPartsList(join(dir, 'state')) : []
    return { count: parts.length, parts }
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/get`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    const rt = await getRuntimeForProject(projectId)
    const snap = getPipeline(rt)
    if (!snap) return { source: '', statements: 0 }

    const nodes = snapshotNodes(snap)
    const edges = snapshotEdges(snap)
    const source = graphToDsl(nodes, edges)
    return { source, statements: nodes.filter((n) => !n.id.startsWith('__')).length }
  })
}

/** 把 QC signal 的 ids 映射成 DSL 行号。 */
function mapSignalLines(raw: unknown, lineByNodeId: Record<string, number>): QcSignalOut {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const ids = Array.isArray(s.ids) ? (s.ids as unknown[]).filter((x): x is string => typeof x === 'string') : undefined
  const lines = ids?.map((id) => lineByNodeId[id]).filter((n): n is number => typeof n === 'number' && n > 0)
  return {
    code: String(s.code ?? 'signal'),
    severity: String(s.severity ?? 'warning'),
    message: String(s.message ?? ''),
    ...(ids && ids.length ? { ids } : {}),
    ...(lines && lines.length ? { lines, line: lines[0] } : {}),
  }
}

function mapMeshSignalLines(s: MeshQcSignal, lineByNodeId: Record<string, number>): QcSignalOut & { suggestion?: unknown } {
  const lines = s.ids?.map((id) => lineByNodeId[id]).filter((n): n is number => typeof n === 'number' && n > 0)
  return {
    code: s.code,
    severity: s.severity,
    message: s.message,
    ...(s.ids && s.ids.length ? { ids: s.ids } : {}),
    ...(lines && lines.length ? { lines, line: lines[0] } : {}),
    ...(s.suggestion ? { suggestion: s.suggestion } : {}),
  }
}

async function runMeshQc(projectId: string, source: string): Promise<{ clean: boolean; meshResolved: number; signals: MeshQcSignal[] }> {
  try {
    const dir = await getProjectDir(projectId)
    const baked = dir ? readPartsList(join(dir, 'state')) : []
    const byFile = new Map<string, BakedPart>()
    for (const p of baked) {
      if (p.filename) byFile.set(p.filename, { filename: p.filename, bbox_min: p.bbox_min, bbox_max: p.bbox_max })
    }
    return meshAwareQc(source, byFile)
  } catch {
    return { clean: true, meshResolved: 0, signals: [] }
  }
}

// ── snapshot → CompiledNode/Edge 适配（model.get 反解用）────────────────────

function snapshotNodes(snap: unknown): Array<{ id: string; batteryId: string; params?: Record<string, unknown> }> {
  const s = snap as { nodes?: unknown }
  const nodes = s.nodes
  const out: Array<{ id: string; batteryId: string; params?: Record<string, unknown> }> = []
  if (nodes && typeof nodes === 'object' && !Array.isArray(nodes)) {
    for (const [id, node] of Object.entries(nodes as Record<string, unknown>)) {
      const n = node as { opId?: string; batteryId?: string; params?: Record<string, unknown> }
      const batteryId = n.batteryId ?? n.opId
      if (typeof batteryId === 'string') out.push({ id, batteryId, params: n.params })
    }
  }
  return out
}

function snapshotEdges(snap: unknown): CompiledEdge[] {
  const s = snap as { edges?: unknown }
  const edges = s.edges
  const out: CompiledEdge[] = []
  const push = (id: string, e: unknown): void => {
    const edge = e as { source?: { nodeId?: string; port?: string }; target?: { nodeId?: string; port?: string } }
    if (edge.source?.nodeId && edge.source.port && edge.target?.nodeId && edge.target.port) {
      out.push({
        id,
        source: { nodeId: edge.source.nodeId, port: edge.source.port },
        target: { nodeId: edge.target.nodeId, port: edge.target.port },
      })
    }
  }
  if (Array.isArray(edges)) edges.forEach((e, i) => push(String(i), e))
  else if (edges && typeof edges === 'object') for (const [id, e] of Object.entries(edges as Record<string, unknown>)) push(id, e)
  return out
}
