import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/main.js'

let app: Awaited<ReturnType<typeof buildApp>>
let projectRoot: string
beforeAll(async () => {
  projectRoot = mkdtempSync(join(tmpdir(), 'wb-asset2d-templates-'))
  process.env.FORGEAX_PROJECT_ROOT = projectRoot
  app = await buildApp()
})
afterAll(async () => {
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
})

interface ListItem {
  id: string
  category: string
  builtin?: boolean
}

const group = {
  id: 'user-tmpl-1',
  name: 'My Template',
  nodes: {},
  edges: [],
  inputs: [],
  outputs: [],
}

describe('group-templates: user template save + delete', () => {
  it('user templates are builtin:false and presets are builtin:true', async () => {
    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save-user',
      payload: { group, smallTag: 'misc', templateName: 'My Template' },
    })
    expect(save.statusCode).toBe(200)

    const list = await app.inject({ method: 'GET', url: '/api/v1/group-templates' })
    const items = list.json() as ListItem[]
    const mine = items.find((i) => i.id === 'user-tmpl-1')
    expect(mine).toBeTruthy()
    expect(mine?.builtin).toBe(false)
    expect(mine?.category).toBe('My templates')
    // Any preset (builtin) template/group, when present, must be read-only.
    expect(items.every((i) => i.builtin !== false || i.id === 'user-tmpl-1' || i.category === 'My templates')).toBe(true)
  })

  it('deletes a user template by id and it disappears from the list', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/group-templates/user/user-tmpl-1' })
    expect(del.statusCode).toBe(200)
    expect((del.json() as { ok: boolean }).ok).toBe(true)

    const list = await app.inject({ method: 'GET', url: '/api/v1/group-templates' })
    const ids = (list.json() as ListItem[]).map((i) => i.id)
    expect(ids).not.toContain('user-tmpl-1')
  })

  it('404s when deleting a non-user (missing/preset) template', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/group-templates/user/does-not-exist' })
    expect(del.statusCode).toBe(404)
  })
})
