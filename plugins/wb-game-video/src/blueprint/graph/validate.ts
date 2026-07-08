/**
 * 图 validator —— AI 时代刚需：graph 是 SSOT 且会被 AI 生成/编辑，落盘/加载/AI 写入时都要能
 * 静态发现结构性错误，给出可读诊断（而不是运行时炸）。
 *
 * 覆盖：悬空边、sourceHandle 与派生 outputs 不匹配、未注册 kind、kind 参数非法、不可达节点；
 * 传 `opts`（实体/变量/道具 id）后还查**引用**：condition/effect/expr 里引用的 entity/var/item/nodeId
 * 是否存在、rules.goto 是否指向真实节点；并对**纯瞬时环**（全为无演出/无交互节点 + 无条件边）给告警。
 */
import type { GameGraph, ReactiveRule } from './graph-schema'
import { deriveOutputs, getKind } from './kind-registry'

export interface Issue {
  level: 'error' | 'warn'
  code: string
  msg: string
  at?: string
}

/** 引用检查上下文：已声明的实体/变量/道具/节点 id。 */
export interface ValidateOpts {
  entities?: Iterable<string>
  vars?: Iterable<string>
  items?: Iterable<string>
  /** 图级反应规则（scenario.rules）——一并校验 when 引用与 goto 目标。 */
  rules?: ReactiveRule[]
}

/** 路由/网关 handle（out、else、cond:N）由 edge 声明、非某 kind 产出，始终合法。 */
function isRoutingHandle(h: string): boolean {
  return h === 'out' || h === 'else' || /^cond:\d+$/.test(h)
}

const EFFECT_KINDS = new Set(['attr', 'var', 'flag', 'item'])
const CLAUSE_TYPES = new Set(['var', 'flag', 'visited', 'attr', 'attrRatio', 'attrCompare', 'score', 'hasItem'])

interface RefCtx {
  entities: Set<string>
  vars: Set<string>
  items: Set<string>
  nodeIds: Set<string>
}

/** 检查表达式字符串里的 `entity.<id>.attr` / `var.<id>` 引用。 */
function checkExpr(expr: string, ctx: RefCtx, at: string, issues: Issue[]): void {
  for (const m of expr.matchAll(/entity\.([A-Za-z0-9_-]+)\.attr/g)) {
    const id = m[1]!
    if (!ctx.entities.has(id)) issues.push({ level: 'error', code: 'ref.entity.missing', msg: `expr 引用未知实体 '${id}'`, at })
  }
  for (const m of expr.matchAll(/\bvar\.([A-Za-z0-9_-]+)/g)) {
    const id = m[1]!
    if (!ctx.vars.has(id)) issues.push({ level: 'error', code: 'ref.var.missing', msg: `expr 引用未知变量 '${id}'`, at })
  }
}

/** 深度遍历任意值，凡遇 {expr} / GraphEffect / GraphClause 形状即校验其 id 引用（对任意 kind params 通用）。 */
function walkRefs(value: unknown, ctx: RefCtx, at: string, issues: Issue[]): void {
  if (value == null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const v of value) walkRefs(v, ctx, at, issues)
    return
  }
  const o = value as Record<string, unknown>
  if (typeof o.expr === 'string') checkExpr(o.expr, ctx, at, issues)
  if (typeof o.kind === 'string' && EFFECT_KINDS.has(o.kind)) {
    if (o.kind === 'attr' && typeof o.entityId === 'string' && !ctx.entities.has(o.entityId)) {
      issues.push({ level: 'error', code: 'ref.entity.missing', msg: `effect 引用未知实体 '${o.entityId}'`, at })
    }
    if ((o.kind === 'var' || o.kind === 'flag') && typeof o.varId === 'string' && !ctx.vars.has(o.varId)) {
      issues.push({ level: 'error', code: 'ref.var.missing', msg: `effect 引用未知变量 '${o.varId}'`, at })
    }
    if (o.kind === 'item' && typeof o.itemId === 'string' && ctx.items.size > 0 && !ctx.items.has(o.itemId)) {
      issues.push({ level: 'warn', code: 'ref.item.missing', msg: `effect 引用未声明道具 '${o.itemId}'`, at })
    }
  }
  if (typeof o.type === 'string' && CLAUSE_TYPES.has(o.type)) {
    if ((o.type === 'attr' || o.type === 'attrRatio') && typeof o.entityId === 'string' && !ctx.entities.has(o.entityId)) {
      issues.push({ level: 'error', code: 'ref.entity.missing', msg: `condition 引用未知实体 '${o.entityId}'`, at })
    }
    if (o.type === 'attrCompare') {
      for (const side of ['left', 'right'] as const) {
        if (typeof o[side] === 'string' && !ctx.entities.has(o[side] as string)) {
          issues.push({ level: 'error', code: 'ref.entity.missing', msg: `condition 引用未知实体 '${o[side] as string}'`, at })
        }
      }
    }
    if ((o.type === 'var' || o.type === 'flag') && typeof o.varId === 'string' && !ctx.vars.has(o.varId)) {
      issues.push({ level: 'error', code: 'ref.var.missing', msg: `condition 引用未知变量 '${o.varId}'`, at })
    }
    if (o.type === 'visited' && typeof o.nodeId === 'string' && !ctx.nodeIds.has(o.nodeId)) {
      issues.push({ level: 'error', code: 'ref.node.missing', msg: `condition visited 引用未知节点 '${o.nodeId}'`, at })
    }
  }
  for (const v of Object.values(o)) walkRefs(v, ctx, at, issues)
}

/** 纯瞬时环告警：环内全是「无演出时长 + 无交互元素」的节点、且构成环的边都无 condition → 可能同步空转。 */
function checkInstantCycle(graph: GameGraph, issues: Issue[]): void {
  const instant = new Set(
    graph.nodes
      .filter((n) => !n.data.durationMs && !n.data.timeline.some((el) => getKind(el.kind)?.role === 'interaction'))
      .map((n) => n.id),
  )
  const adj = new Map<string, string[]>()
  for (const e of graph.edges) {
    if (e.data?.condition) continue // 有条件的边不算恒真穿链
    if (!instant.has(e.source) || !instant.has(e.target)) continue
    const list = adj.get(e.source) ?? []
    list.push(e.target)
    adj.set(e.source, list)
  }
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  let found = false
  const dfs = (u: string): void => {
    color.set(u, GRAY)
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE
      if (c === GRAY) found = true
      else if (c === WHITE) dfs(v)
    }
    color.set(u, BLACK)
  }
  for (const id of instant) if ((color.get(id) ?? WHITE) === WHITE) dfs(id)
  if (found) {
    issues.push({ level: 'warn', code: 'cycle.instant', msg: '存在纯瞬时环（全无演出/交互 + 无条件边），运行时可能触发 anti-runaway 中断' })
  }
}

export function validateGraph(graph: GameGraph, opts?: ValidateOpts): Issue[] {
  const issues: Issue[] = []
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  // 1) 边：悬空 source/target + sourceHandle 是否在派生 outputs 内
  for (const e of graph.edges) {
    if (!byId.has(e.source)) {
      issues.push({ level: 'error', code: 'edge.source.missing', msg: `edge ${e.id} source '${e.source}' not found`, at: e.id })
    }
    if (!byId.has(e.target)) {
      issues.push({ level: 'error', code: 'edge.target.missing', msg: `edge ${e.id} target '${e.target}' not found`, at: e.id })
    }
    if (e.sourceHandle && !isRoutingHandle(e.sourceHandle)) {
      const src = byId.get(e.source)
      if (src) {
        const outs = deriveOutputs(src).map((h) => h.id)
        if (!outs.includes(e.sourceHandle)) {
          issues.push({
            level: 'error',
            code: 'edge.handle.missing',
            msg: `edge ${e.id} sourceHandle '${e.sourceHandle}' not in node ${e.source} outputs [${outs.join(', ')}]`,
            at: e.id,
          })
        }
      }
    }
  }

  // 2) 元素 kind：是否注册 + 参数校验
  for (const n of graph.nodes) {
    for (const el of n.data.timeline) {
      const plugin = getKind(el.kind)
      if (!plugin) {
        issues.push({ level: 'error', code: 'kind.unknown', msg: `unknown element kind '${el.kind}'`, at: `${n.id}/${el.id}` })
        continue
      }
      for (const problem of plugin.validate(el.params)) {
        issues.push({ level: 'error', code: 'kind.invalid', msg: `${el.kind}: ${problem}`, at: `${n.id}/${el.id}` })
      }
    }
  }

  // 3) 不可达节点（从 nodes[0] BFS）
  if (graph.nodes.length > 0) {
    const start = graph.nodes[0]!.id
    const adj = new Map<string, string[]>()
    for (const e of graph.edges) {
      const list = adj.get(e.source) ?? []
      list.push(e.target)
      adj.set(e.source, list)
    }
    const seen = new Set<string>([start])
    const queue = [start]
    while (queue.length > 0) {
      const id = queue.shift()!
      for (const next of adj.get(id) ?? []) {
        if (!seen.has(next)) {
          seen.add(next)
          queue.push(next)
        }
      }
    }
    for (const n of graph.nodes) {
      if (!seen.has(n.id)) {
        issues.push({ level: 'warn', code: 'node.unreachable', msg: `node '${n.id}' unreachable from start '${start}'`, at: n.id })
      }
    }
  }

  // 4) 纯瞬时环告警（静态）
  checkInstantCycle(graph, issues)

  // 5) 引用检查（需 opts 提供已声明的 entity/var/item id）：condition/effect/expr + rules
  if (opts) {
    const ctx: RefCtx = {
      entities: new Set(opts.entities ?? []),
      vars: new Set(opts.vars ?? []),
      items: new Set(opts.items ?? []),
      nodeIds: new Set(graph.nodes.map((n) => n.id)),
    }
    for (const n of graph.nodes) walkRefs(n.data, ctx, n.id, issues)
    for (const e of graph.edges) walkRefs(e.data, ctx, e.id, issues)
    for (let i = 0; i < (opts.rules ?? []).length; i++) {
      const r = opts.rules![i]!
      const at = `rules[${i}]`
      walkRefs(r.when, ctx, at, issues)
      if (!ctx.nodeIds.has(r.goto)) issues.push({ level: 'error', code: 'ref.node.missing', msg: `rule goto 指向未知节点 '${r.goto}'`, at })
    }
  }

  return issues
}
