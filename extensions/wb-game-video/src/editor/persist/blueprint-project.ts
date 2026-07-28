/**
 * 蓝图库文档纯函数（无 fs）：单文件 SSOT = 原 scenario 形状 + `manifest`（含 main 与全部子蓝图）。
 * - 根上 `graph` = 运行开跑入口（主图）；variables / entities / … 与 nodia 同构。
 * - `manifest.packs` 含主蓝图（编辑库）+ 子蓝图；engine 执行中遇依赖从此表取；无根级 `packs` 数组。
 */
import type {
  BlueprintDoc, BlueprintManifest, GameGraph, GraphLibraryDocument, ScenarioMetaFields, SubFlowPackDef,
} from '../../runtime/schema/graph-schema'
import { resolveGraphEntry } from '../../runtime/schema/graph-schema'
import type { EditorScenarioDocument } from './formula-authoring'
import { findReferenceCycle } from '../../graph/edit/blueprint-refs'

export const MAIN_ID = 'bp-main'

let _seq = 0
export function newBlueprintId(): string {
  _seq += 1
  return `bp-${Date.now().toString(36)}-${_seq}`
}

export function emptyBlueprintDoc(opts: { id?: string; title?: string } = {}): BlueprintDoc {
  const id = opts.id ?? newBlueprintId()
  const entry = 'entry'
  return {
    id, title: opts.title ?? '新蓝图', entry,
    graph: { nodes: [{ id: entry, type: 'perf', position: { x: 80, y: 80 }, inputs: [], outputs: [], data: { name: '入口' } }], edges: [] },
  }
}

/** 从 scenario 根摘出共享 meta（不含 graph / manifest）。 */
export function metaFromDocument(scn: EditorScenarioDocument | GraphLibraryDocument): ScenarioMetaFields {
  const m: ScenarioMetaFields = {}
  if (scn.variables !== undefined) m.variables = scn.variables
  if (scn.entities !== undefined) m.entities = scn.entities
  if (scn.ui !== undefined) m.ui = scn.ui
  if (scn.textStylePresets !== undefined) m.textStylePresets = scn.textStylePresets
  if (scn.bgm !== undefined) m.bgm = scn.bgm
  const formulas = (scn as EditorScenarioDocument).formulas
  if (formulas !== undefined) m.formulas = formulas
  return m
}

export function packToDoc(p: SubFlowPackDef): BlueprintDoc {
  return { id: p.id, title: p.title ?? p.id, version: p.version, entry: p.entry, graph: p.graph, requires: p.requires }
}
export function docToPack(d: BlueprintDoc): SubFlowPackDef {
  const entry = resolveGraphEntry(d.graph, d.entry) ?? d.entry
  return { id: d.id, version: d.version ?? '1', title: d.title, entry, graph: d.graph, requires: d.requires }
}

export function buildManifest(blueprints: Record<string, BlueprintDoc>, mainId: string): BlueprintManifest {
  // 写入前对齐各图 entry（悬空 entry 回退到根节点）。
  const next: Record<string, BlueprintDoc> = {}
  for (const [id, d] of Object.entries(blueprints)) {
    const entry = resolveGraphEntry(d.graph, d.entry) ?? d.entry
    next[id] = entry === d.entry ? d : { ...d, entry }
  }
  return {
    version: 'wb-game-video.blueprint-manifest.v1',
    mainPackId: mainId,
    packs: next,
  }
}

/** 由蓝图表 + 根 meta 拼出完整落盘文档（graph=主图镜像，manifest 含 main+子）。 */
export function documentFromBlueprints(
  blueprints: Record<string, BlueprintDoc>,
  mainId: string,
  meta: ScenarioMetaFields,
): GraphLibraryDocument {
  const manifest = buildManifest(blueprints, mainId)
  const main = manifest.packs[mainId]
  return {
    version: 'wb-game-video.graph.v1',
    ...meta,
    graph: main?.graph ?? { nodes: [], edges: [] },
    manifest,
  }
}

/**
 * 单图 scenario（如内置 demo json）→ 库文档：根 graph 变主蓝图写入 manifest。
 * 子蓝图须已在 `manifest.packs` 或另行 `documentFromBlueprints`。
 */
export function documentFromScenario(scn: EditorScenarioDocument, opts: { mainId?: string } = {}): GraphLibraryDocument {
  const mainId = opts.mainId ?? MAIN_ID
  const main: BlueprintDoc = {
    id: mainId,
    title: '主蓝图',
    entry: resolveGraphEntry(scn.graph, scn.graph.nodes[0]?.id) ?? scn.graph.nodes[0]?.id ?? 'entry',
    graph: scn.graph,
  }
  return documentFromBlueprints({ [mainId]: main }, mainId, metaFromDocument(scn))
}

/**
 * 规范化：以 manifest.packs 为准同步根 graph；缺 manifest 时把根 graph 收成仅含 main 的库文档。
 * 不读旧字段（mainBlueprintId / blueprints / schemaVersion）。
 */
export function normalizeDocument(doc: GraphLibraryDocument | EditorScenarioDocument): GraphLibraryDocument {
  const any = doc as GraphLibraryDocument
  if (any.manifest?.packs && any.manifest.mainPackId) {
    const mainId = any.manifest.mainPackId
    const bps = { ...any.manifest.packs }
    // 双源：编辑库以 manifest 内 main 为准，再镜像到根 graph。
    const main = bps[mainId]
    if (main) bps[mainId] = { ...main, graph: main.graph, entry: resolveGraphEntry(main.graph, main.entry) ?? main.entry }
    return documentFromBlueprints(bps, mainId, metaFromDocument(any))
  }
  return documentFromScenario(doc as EditorScenarioDocument)
}

/**
 * 试玩用：开跑图换成指定蓝图（默认主蓝图）；保留完整 manifest 供执行中解析依赖。
 */
export function playDocument(doc: GraphLibraryDocument, rootBlueprintId?: string): GraphLibraryDocument {
  const normalized = normalizeDocument(doc)
  const mainId = normalized.manifest.mainPackId
  const rootId = rootBlueprintId ?? mainId
  const root = normalized.manifest.packs[rootId]
  return {
    ...normalized,
    graph: root?.graph ?? { nodes: [], edges: [] },
  }
}

export function validateDocument(doc: GraphLibraryDocument): string[] {
  const normalized = normalizeDocument(doc)
  const errors: string[] = []
  const blueprints = normalized.manifest.packs
  const mainId = normalized.manifest.mainPackId
  for (const [bpId, bp] of Object.entries(blueprints)) {
    const seen = new Set<string>()
    for (const n of bp.graph.nodes) {
      if (seen.has(n.id)) errors.push(`蓝图「${bp.title}」(${bpId}) 内节点 id 重复：'${n.id}'`)
      seen.add(n.id)
    }
    for (const e of bp.graph.edges) {
      if (!seen.has(e.source)) errors.push(`蓝图「${bp.title}」(${bpId}) 边 '${e.id}' source 指向不存在的节点 '${e.source}'`)
      if (!seen.has(e.target)) errors.push(`蓝图「${bp.title}」(${bpId}) 边 '${e.id}' target 指向不存在的节点 '${e.target}'`)
    }
    if (bp.graph.nodes.length > 0 && !bp.graph.nodes.some((n) => n.id === bp.entry)) {
      const fallback = resolveGraphEntry(bp.graph) ?? '∅'
      errors.push(`蓝图「${bp.title}」(${bpId}) entry '${bp.entry}' 不在图中（将回退到 ${fallback}）`)
    }
  }
  if (!blueprints[mainId]) {
    errors.push(`manifest.mainPackId '${mainId}' 不在 manifest.packs 中`)
  }
  const cycle = findReferenceCycle(blueprints)
  if (cycle) errors.push(`蓝图引用成环：${cycle.join(' → ')}`)
  return errors
}

export function emptyGraph(): GameGraph {
  return { nodes: [], edges: [] }
}
