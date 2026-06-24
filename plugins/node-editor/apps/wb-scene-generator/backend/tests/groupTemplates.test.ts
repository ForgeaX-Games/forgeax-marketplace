import Fastify, { type FastifyInstance } from 'fastify'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registerGroupTemplateRoutes } from '../src/routes/groupTemplates.js'

let app: FastifyInstance
const writtenDirs: string[] = []

beforeEach(async () => {
  app = Fastify({ logger: false })
  await registerGroupTemplateRoutes(app)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  // Clean up any files this test wrote under batteries/groups/<cat>/<name>/.
  for (const dir of writtenDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('POST /api/v1/group-templates/save', () => {
  it('saves a group battery and returns the written path (200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save',
      payload: {
        group: { id: 'g-test-1', name: 'tmp', nodes: [], edges: [] },
        categoryName: '__test_cat__',
        batteryName: '__test_battery__',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { filePath: string; groupId: string; categoryName: string }
    expect(body.groupId).toBe('g-test-1')
    expect(body.categoryName).toBe('__test_cat__')
    const written = JSON.parse(await readFile(body.filePath, 'utf8'))
    expect(written.name).toBe('__test_battery__')
    expect(written.nameEn).toBe('__test_battery__')
    // record the category dir for cleanup
    writtenDirs.push(body.filePath.replace(/__test_battery__\/[^/]+$/, '__test_battery__'))
    writtenDirs.push(body.filePath.replace(/__test_cat__\/.*$/, '__test_cat__'))
  })

  it('returns 400 (not 500) when categoryName is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save',
      payload: { group: { id: 'g2', name: 'x' }, batteryName: 'B' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/categoryName/)
  })

  it('returns 400 (not 500) when group is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save',
      payload: { categoryName: 'C', batteryName: 'B' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/group/)
  })

  it('returns 400 (not 500) when batteryName is a non-string', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save',
      payload: { group: { id: 'g3' }, categoryName: 'C', batteryName: 123 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/batteryName/)
  })
})

describe('DELETE /api/v1/group-templates/groups/:id', () => {
  it('removes the entire battery folder including README sidecars', async () => {
    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save',
      payload: {
        group: { id: 'g-del-1', name: 'tmp', nodes: [], edges: [] },
        categoryName: '__test_del_cat__',
        batteryName: '__test_del_battery__',
      },
    })
    expect(save.statusCode).toBe(200)
    const { filePath, groupId } = save.json() as { filePath: string; groupId: string }
    const batteryDir = filePath.replace(/[/\\][^/\\]+\.json$/, '')
    writtenDirs.push(batteryDir)
    writtenDirs.push(batteryDir.replace(/[/\\][^/\\]+$/, ''))

    const readmePath = join(batteryDir, 'README.md')
    await writeFile(readmePath, '# doc\n', 'utf8')

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/group-templates/groups/${encodeURIComponent(groupId)}`,
    })
    expect(del.statusCode).toBe(200)
    expect(existsSync(filePath)).toBe(false)
    expect(existsSync(readmePath)).toBe(false)
    expect(existsSync(batteryDir)).toBe(false)
  })

  it('deletes README-only orphan folders by battery folder name', async () => {
    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save',
      payload: {
        group: { id: 'g-orphan-1', name: 'tmp', nodes: [], edges: [] },
        categoryName: '__test_orphan_cat__',
        batteryName: '__test_orphan_battery__',
      },
    })
    expect(save.statusCode).toBe(200)
    const { filePath } = save.json() as { filePath: string }
    const batteryDir = filePath.replace(/[/\\][^/\\]+\.json$/, '')
    writtenDirs.push(batteryDir)
    writtenDirs.push(batteryDir.replace(/[/\\][^/\\]+$/, ''))

    await rm(filePath)
    await writeFile(join(batteryDir, 'README.md'), '# orphan\n', 'utf8')

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/v1/group-templates/groups/__test_orphan_battery__',
    })
    expect(del.statusCode).toBe(200)
    expect(existsSync(batteryDir)).toBe(false)
  })
})

describe('GET /api/v1/group-templates scope', () => {
  it('scope=templates excludes groups-only develop batteries', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/group-templates?scope=templates' })
    expect(res.statusCode).toBe(200)
    const items = res.json() as Array<{ id: string; displayGroup?: string; sourcePath?: string }>
    expect(items.some((i) => i.displayGroup?.startsWith('templates/'))).toBe(true)
    expect(items.every((i) => i.displayGroup?.startsWith('templates/'))).toBe(true)
    expect(items.some((i) => i.id === 'ObjectAssetName')).toBe(false)
  })

  it('scope=groups excludes published templates', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/group-templates?scope=groups' })
    expect(res.statusCode).toBe(200)
    const items = res.json() as Array<{ displayGroup?: string }>
    expect(items.every((i) => i.displayGroup?.startsWith('groups/'))).toBe(true)
  })

  it('scope=all lists both kinds when the same id exists in groups/ and templates/', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/group-templates?scope=all' })
    expect(res.statusCode).toBe(200)
    const items = res.json() as Array<{ id: string; displayGroup?: string; sourcePath?: string }>
    const lake = items.filter((i) => i.id === 'group_1781238394903_rz71v' || i.sourcePath?.includes('LakeRegions'))
    expect(lake.some((i) => i.displayGroup?.startsWith('groups/'))).toBe(true)
    expect(lake.some((i) => i.displayGroup?.startsWith('templates/'))).toBe(true)
  })
})

describe('POST /api/v1/group-templates/save-user', () => {
  let ws: string
  const prevRoot = process.env.FORGEAX_PROJECT_ROOT

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'wb-user-tpl-'))
    process.env.FORGEAX_PROJECT_ROOT = ws
  })
  afterEach(() => {
    if (prevRoot === undefined) delete process.env.FORGEAX_PROJECT_ROOT
    else process.env.FORGEAX_PROJECT_ROOT = prevRoot
    rmSync(ws, { recursive: true, force: true })
  })

  it('writes user content under "My templates"/<smallTag> and lists it as a template (200)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save-user',
      payload: {
        group: { id: 'u-test-1', name: 'whatever', nodes: [], edges: [] },
        smallTag: 'my_tag',
        templateName: 'My Template',
      },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { filePath: string; groupId: string; smallTag: string; templateName: string }
    expect(body.groupId).toBe('u-test-1')
    expect(body.smallTag).toBe('my_tag')
    // File lands under <ws>/user-content/templates/My templates/my_tag/My Template.json
    expect(body.filePath.replace(/\\/g, '/')).toContain('/user-content/templates/My templates/my_tag/My Template.json')
    const written = JSON.parse(await readFile(body.filePath, 'utf8'))
    expect(written.name).toBe('My Template')

    // It surfaces in the unified listing as a template under big-label "My templates".
    const list = await app.inject({ method: 'GET', url: '/api/v1/group-templates' })
    const items = list.json() as Array<{ id: string; category: string; displayGroup: string; sourcePath?: string }>
    const found = items.find((i) => i.id === 'u-test-1')
    expect(found).toBeTruthy()
    expect(found!.category).toBe('My templates')
    expect(found!.displayGroup).toBe('templates/My templates')
    // sourcePath contains a literal `templates` segment so the frontend can derive the small tag.
    expect(found!.sourcePath?.replace(/\\/g, '/')).toContain('templates/My templates/my_tag/')
  })

  it('marks user templates builtin:false and deletes them by id', async () => {
    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save-user',
      payload: {
        group: { id: 'u-del-1', name: 'whatever', nodes: [], edges: [] },
        smallTag: 'del_tag',
        templateName: 'Deletable',
      },
    })
    expect(save.statusCode).toBe(200)

    // Listed as a user template (builtin:false); any preset stays read-only.
    const list = await app.inject({ method: 'GET', url: '/api/v1/group-templates' })
    const items = list.json() as Array<{ id: string; category: string; builtin?: boolean }>
    const mine = items.find((i) => i.id === 'u-del-1')
    expect(mine?.builtin).toBe(false)
    expect(
      items.every((i) => i.builtin !== false || i.id === 'u-del-1' || i.category === 'My templates'),
    ).toBe(true)

    // Delete by id → disappears from the listing.
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/group-templates/user/u-del-1' })
    expect(del.statusCode).toBe(200)
    expect((del.json() as { ok: boolean }).ok).toBe(true)
    const after = await app.inject({ method: 'GET', url: '/api/v1/group-templates' })
    expect((after.json() as Array<{ id: string }>).map((i) => i.id)).not.toContain('u-del-1')
  })

  it('404s when deleting a missing/preset (non-user) template', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/v1/group-templates/user/does-not-exist' })
    expect(del.statusCode).toBe(404)
  })

  it('returns 400 when smallTag is empty', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save-user',
      payload: { group: { id: 'u2', name: 'x' }, smallTag: '  ', templateName: 'T' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/smallTag/)
  })

  it('reads any .png in the template folder as preview (not just icon.png)', async () => {
    const save = await app.inject({
      method: 'POST',
      url: '/api/v1/group-templates/save-user',
      payload: {
        group: { id: 'u-png-1', name: 'whatever', nodes: [], edges: [] },
        smallTag: 'png_tag',
        templateName: 'Preview Template',
      },
    })
    expect(save.statusCode).toBe(200)
    const { filePath } = save.json() as { filePath: string }
    // Drop a non-`icon.png` image beside the template json (1×1 PNG).
    const onePxPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    )
    await writeFile(join(dirname(filePath), '下载.png'), onePxPng)

    const list = await app.inject({ method: 'GET', url: '/api/v1/group-templates' })
    const items = list.json() as Array<{ id: string; iconPng?: string }>
    const found = items.find((i) => i.id === 'u-png-1')
    expect(found?.iconPng).toMatch(/^data:image\/png;base64,/)
  })
})
