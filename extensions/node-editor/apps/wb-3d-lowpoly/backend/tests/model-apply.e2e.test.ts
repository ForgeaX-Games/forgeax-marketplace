/**
 * model.apply / model.get / parts.list 端到端（Workstream A/C · verify）。
 *
 * 通过真实 fastify app 走完整链路：DSL → 编译成图 → 导入 → 执行 → QC → URDF，
 * 断言紧凑回执正确、错误定位到 DSL 行号、model.get 反解 round-trip 等价。
 * 用纯 primitive 装配（box/joint），避免依赖 OCCT baker WASM，保持快、稳。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { resetRuntimeForTests } from '../src/runtime.js'
import { parseDSL, type Statement, type Arg } from '../../vendor/dist/shared/types/index.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wb3d-model-apply-'))
  process.env.FORGEAX_PROJECT_ROOT = root
})

afterEach(() => {
  resetRuntimeForTests()
  rmSync(root, { recursive: true, force: true })
  delete process.env.FORGEAX_PROJECT_ROOT
})

const ASSEMBLY = [
  'mat = material(rgba=[0.2, 0.2, 0.2, 1])',
  'base = box(size=[0.2, 0.2, 0.1])',
  'p_base = part(shape=base, material=mat)',
  'top = box(size=[0.1, 0.1, 0.1])',
  'p_top = part(shape=top, material=mat)',
  'j = joint(type="fixed", parent=p_base, child=p_top, origin=[0, 0, 0.1])',
].join('\n')

function canon(statements: readonly Statement[]): Record<string, { op: string; args: string }> {
  const out: Record<string, { op: string; args: string }> = {}
  for (const s of statements) {
    const keys = Object.keys(s.args as Record<string, Arg>).sort()
    out[s.id] = { op: s.op, args: JSON.stringify(keys.map((k) => [k, (s.args as Record<string, Arg>)[k]])) }
  }
  return out
}

describe('model.apply e2e', () => {
  it('compiles + executes a primitive assembly and returns a compact receipt', async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: ASSEMBLY, name: 'stack' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.ok).toBe(true)
      expect(body.statements).toBe(6)
      expect(body.errors).toEqual([])
      expect(body.execution.status).toBe('completed')
      expect(body.qc.valid).toBe(true)
      expect(body.qc.islands).toBe(1)
      expect(typeof body.urdf.fingerprint).toBe('string')
      expect(body.urdf.fingerprint.length).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })

  it('model.get reconstructs an equivalent DSL (round-trip)', async () => {
    const app = await buildApp()
    try {
      await app.inject({ method: 'POST', url: '/api/v1/projects/main/model/apply', payload: { source: ASSEMBLY } })
      const got = await app.inject({ method: 'GET', url: '/api/v1/projects/main/model/get' })
      expect(got.statusCode).toBe(200)
      const source = got.json().source as string
      const reparsed = parseDSL(source)
      expect(reparsed.errors).toEqual([])
      expect(canon(reparsed.statements)).toEqual(canon(parseDSL(ASSEMBLY).statements))
    } finally {
      await app.close()
    }
  })

  it('maps an unknown op back to its DSL line without touching the graph', async () => {
    const app = await buildApp()
    try {
      const src = ['b = box(size=[1,1,1])', 'x = totally_unknown_op(foo=1)'].join('\n')
      const res = await app.inject({ method: 'POST', url: '/api/v1/projects/main/model/apply', payload: { source: src } })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.ok).toBe(false)
      expect(body.phase).toBe('compile')
      const unmapped = (body.errors as Array<{ line: number; kind: string; message: string }>).find(
        (e) => e.kind === 'unmapped-op',
      )
      expect(unmapped).toBeTruthy()
      expect(unmapped!.line).toBe(2)
    } finally {
      await app.close()
    }
  })

  it('parts.list is empty before any bake', async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/projects/main/parts' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ count: 0, parts: [] })
    } finally {
      await app.close()
    }
  })

  it('bake mode bakes a CSG shell, registers it in parts.json, and parts.list finds it', async () => {
    const app = await buildApp()
    try {
      const src = [
        'outer = cylinder(radius=0.04, length=0.1)',
        'cavity = cylinder(radius=0.035, length=0.09)',
        'shell = difference(base=outer, tool=cavity)',
      ].join('\n')
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/projects/main/model/apply',
        payload: { source: src, bake: 'shell' },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.mode).toBe('bake')
      expect(body.ok).toBe(true)
      expect(typeof body.baked.filename).toBe('string')
      expect(body.baked.filename).toMatch(/\.obj$/)
      expect(typeof body.baked.sha256).toBe('string')
      expect(Array.isArray(body.baked.bbox_min)).toBe(true)

      const parts = await app.inject({ method: 'GET', url: '/api/v1/projects/main/parts' })
      const listed = parts.json()
      expect(listed.count).toBe(1)
      expect(listed.parts[0].name).toBe('shell')
      expect(listed.parts[0].filename).toBe(body.baked.filename)
    } finally {
      await app.close()
    }
  })
})
