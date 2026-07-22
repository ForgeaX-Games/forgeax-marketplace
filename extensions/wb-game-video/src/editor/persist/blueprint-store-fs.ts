/**
 * 蓝图库 node 侧序列化（Vite + tool-handlers 共用）。
 * 单文件 SSOT = `scenarios.graph.json`（原 scenario 形状 + `manifest`，含 main 与全部子蓝图）。
 * 不再读写 `blueprints/` 文件夹。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { GraphLibraryDocument } from '../../runtime/schema/graph-schema'
import { normalizeDocument } from './blueprint-project'

export interface VersionEntry { id: string; savedAt: number }
const VERSION_LIMIT = 10
const SAFE_ID_RE = /^[A-Za-z0-9._-]+$/
const CANON_ITEM_ID = 'nodia-graph'

function assertSafeId(id: string, kind: string): void {
  if (!SAFE_ID_RE.test(id)) {
    throw new Error(`[blueprint-store-fs] illegal ${kind} id（仅允许 [A-Za-z0-9._-]，拒绝路径穿越）：${JSON.stringify(id)}`)
  }
}

function tryReadJson<T>(p: string): { value: T | null; existed: boolean; parseError: boolean } {
  if (!existsSync(p)) return { value: null, existed: false, parseError: false }
  try {
    return { value: JSON.parse(readFileSync(p, 'utf-8')) as T, existed: true, parseError: false }
  } catch {
    return { value: null, existed: true, parseError: true }
  }
}

function readJson<T>(p: string): T | null {
  return tryReadJson<T>(p).value
}

type CanonFile = {
  version: number
  activeId: string
  items: { id: string; title: string; scenario: GraphLibraryDocument }[]
}

/** 读权威文档：scenarios.graph.json 的 items[0].scenario（含 manifest）。 */
export function readDocument(dir: string): { document: GraphLibraryDocument | null; versions: VersionEntry[] } {
  const versions = readJson<VersionEntry[]>(resolve(dir, 'scenarios.graph.versions', 'index.json')) ?? []
  const canonPath = resolve(dir, 'scenarios.graph.json')
  const canonRead = tryReadJson<CanonFile>(canonPath)
  if (canonRead.parseError) {
    console.warn(`[blueprint-store-fs] scenarios.graph.json 解析失败：${canonPath}`)
    return { document: null, versions }
  }
  const raw = canonRead.value?.items?.[0]?.scenario
  if (!raw) return { document: null, versions }
  try {
    return { document: normalizeDocument(raw), versions }
  } catch (e) {
    console.warn(`[blueprint-store-fs] scenario 规范化失败：`, e)
    return { document: null, versions }
  }
}

/** @deprecated 用 readDocument */
export function readProject(dir: string): { project: GraphLibraryDocument | null; versions: VersionEntry[] } {
  const { document, versions } = readDocument(dir)
  return { project: document, versions }
}

let _vseq = 0

export function writeDocument(dir: string, document: GraphLibraryDocument, title = 'graph'): VersionEntry[] {
  const normalized = normalizeDocument(document)
  for (const id of Object.keys(normalized.manifest.packs)) assertSafeId(id, 'blueprint')

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const canon: CanonFile = {
    version: 1,
    activeId: CANON_ITEM_ID,
    items: [{ id: CANON_ITEM_ID, title, scenario: normalized }],
  }
  writeFileSync(resolve(dir, 'scenarios.graph.json'), JSON.stringify(canon, null, 2))

  const vDir = resolve(dir, 'scenarios.graph.versions')
  if (!existsSync(vDir)) mkdirSync(vDir, { recursive: true })
  const vid = `v-${Date.now().toString(36)}-${(_vseq++).toString(36)}`
  assertSafeId(vid, 'version')
  writeFileSync(resolve(vDir, `${vid}.json`), JSON.stringify(normalized))
  const indexPath = resolve(vDir, 'index.json')
  const prev = readJson<VersionEntry[]>(indexPath) ?? []
  const index = [{ id: vid, savedAt: Date.now() }, ...prev].slice(0, VERSION_LIMIT)
  writeFileSync(indexPath, JSON.stringify(index))
  const live = new Set(index.map((v) => `${v.id}.json`))
  for (const f of readdirSync(vDir)) {
    if (f !== 'index.json' && f.endsWith('.json') && !live.has(f)) {
      try { rmSync(resolve(vDir, f)) } catch { /* best-effort */ }
    }
  }
  return index
}

/** @deprecated 用 writeDocument */
export function writeProject(dir: string, project: GraphLibraryDocument, title = 'graph'): VersionEntry[] {
  return writeDocument(dir, project, title)
}

export function readVersionDocument(dir: string, id: string): GraphLibraryDocument | null {
  assertSafeId(id, 'version')
  const raw = readJson<GraphLibraryDocument>(resolve(dir, 'scenarios.graph.versions', `${id}.json`))
  if (!raw) return null
  try { return normalizeDocument(raw) } catch { return null }
}

/** @deprecated 用 readVersionDocument */
export function readVersionProject(dir: string, id: string): GraphLibraryDocument | null {
  return readVersionDocument(dir, id)
}
