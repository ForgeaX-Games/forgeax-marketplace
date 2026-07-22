import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { writeProject, readProject, readVersionProject } from '../blueprint-store-fs'
import { NODIA_DEMO_PROJECT } from '../../demo/demo'
import { documentFromBlueprints, MAIN_ID } from '../blueprint-project'
import type { GraphLibraryDocument } from '../../../runtime/schema/graph-schema'

let dir = ''
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = '' })

function twoBlueprintDoc(): GraphLibraryDocument {
  const node = (id: string) => ({ id, type: 'perf' as const, position: { x: 0, y: 0 }, inputs: [], outputs: [], data: { name: id } })
  const main = { id: 'bp-main', title: 'Main', entry: 'e', graph: { nodes: [node('e')], edges: [] } }
  const sub = { id: 'bp-sub', title: 'Sub', entry: 'e', graph: { nodes: [node('e')], edges: [] } }
  return documentFromBlueprints({ 'bp-main': main, 'bp-sub': sub }, 'bp-main', {})
}

const snapshotFiles = (d: string): string[] =>
  readdirSync(resolve(d, 'scenarios.graph.versions')).filter((f) => f !== 'index.json' && f.endsWith('.json'))

describe('blueprint-store-fs (single-file SSOT)', () => {
  it('writeProject writes scenarios.graph.json with manifest (no blueprints/ folder)', () => {
    dir = mkdtempSync(join(tmpdir(), 'bp-'))
    const versions = writeProject(dir, NODIA_DEMO_PROJECT, 'demo')
    expect(existsSync(resolve(dir, 'blueprints'))).toBe(false)
    expect(existsSync(resolve(dir, 'scenarios.graph.json'))).toBe(true)
    expect(versions.length).toBe(1)
    const canon = JSON.parse(readFileSync(resolve(dir, 'scenarios.graph.json'), 'utf-8'))
    expect(canon.items[0].scenario.manifest.mainPackId).toBe(MAIN_ID)
    expect(canon.items[0].scenario.manifest.packs[MAIN_ID]).toBeTruthy()
    expect(canon.items[0].scenario.graph).toBeTruthy()
    expect(canon.items[0].scenario.variables).toBeTruthy()
  })
  it('readProject round-trips', () => {
    dir = mkdtempSync(join(tmpdir(), 'bp-'))
    writeProject(dir, NODIA_DEMO_PROJECT, 'demo')
    const { project } = readProject(dir)
    expect(project?.manifest.mainPackId).toBe(MAIN_ID)
    expect(Object.keys(project!.manifest.packs)).toContain(MAIN_ID)
    expect(project?.entities).toEqual(NODIA_DEMO_PROJECT.entities)
    expect(project?.variables).toEqual(NODIA_DEMO_PROJECT.variables)
  })
  it('readProject returns null when empty', () => {
    dir = mkdtempSync(join(tmpdir(), 'bp-'))
    expect(readProject(dir).project).toBeNull()
  })
  it('version snapshot round-trips full document', () => {
    dir = mkdtempSync(join(tmpdir(), 'bp-'))
    const versions = writeProject(dir, twoBlueprintDoc(), 'x')
    const snap = readVersionProject(dir, versions[0]!.id)
    expect(Object.keys(snap!.manifest.packs).sort()).toEqual(['bp-main', 'bp-sub'])
  })
  it('keeps at most 10 version snapshots', () => {
    dir = mkdtempSync(join(tmpdir(), 'bp-'))
    for (let i = 0; i < 12; i++) writeProject(dir, twoBlueprintDoc(), `v${i}`)
    expect(snapshotFiles(dir).length).toBeLessThanOrEqual(10)
  })
})
