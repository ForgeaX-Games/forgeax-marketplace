import type { FastifyInstance } from 'fastify'
import type { NodeGroup, Op } from '@forgeax/node-runtime'
import { applyBatch } from '@forgeax/node-runtime'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'
import { getRuntime } from '../runtime.js'
import { ensureMutationAccess } from './projects.js'
import { buildTemplateOps, splitTemplate } from '../lib/templateOps.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..', '..')

// 成组电池有两类，物理隔离、用途分离：
//   groups/<cat>    → Develop 可编辑开发版（保存默认落盘；Sino 不可见）
//   templates/<cat> → Templates 稳定发布版（Sino instantiateTemplate 唯一来源）
// GET ?scope=groups|templates|all 控制列表/读取范围；instantiate 仅扫 templates/。
const appGroupRoot = resolve(repoRoot, 'batteries', 'groups')
const appTemplateRoot = resolve(repoRoot, 'batteries', 'templates')
const groupRoots = [
  ...resolveBatteryScanRoots(repoRoot).map((root) => resolve(root, 'groups')),
  appGroupRoot,
]
const builtinTemplateRoots = [
  ...resolveBatteryScanRoots(repoRoot).map((root) => resolve(root, 'templates')),
  appTemplateRoot,
]

// 用户内容（「保存到模板」）写入 workspace 的 `.forgeax` 区域，跨项目共享，
// 并与内置模板一起被扫描、统一显示。运行时读 FORGEAX_PROJECT_ROOT（与
// runtime.ts 一致），保证测试隔离。固定大标签 = "My templates"，小标签为子目录。
// 路径刻意含字面量 `templates` 段，使前端 getTemplateSubfolder 能解析出小标签。
const USER_TEMPLATE_BIG_LABEL = 'My templates'
function resolveWorkspaceRoot(): string {
  return process.env.FORGEAX_PROJECT_ROOT ?? resolve(repoRoot, '.forgeax-runtime')
}
function userTemplateRoot(): string {
  return resolve(resolveWorkspaceRoot(), 'user-content', 'templates')
}
function templateRoots(): string[] {
  return [...builtinTemplateRoots, userTemplateRoot()]
}
// 大标签 → 对应磁盘根列表。displayGroup 前缀即此 kind。
function getKinds(): ReadonlyArray<{ kind: 'groups' | 'templates'; roots: string[] }> {
  return [
    { kind: 'groups', roots: groupRoots },
    { kind: 'templates', roots: templateRoots() },
  ]
}

interface GroupTemplateBattery {
  id: string
  name: string
  nameEn?: string
  category: string
  description?: string
  version?: string
  iconSvg?: string
  /** Base64 data URL loaded from icon.png beside the template json, when present. */
  iconPng?: string
  displayGroup?: string
  sourcePath?: string
}

/** Read icon.png beside the template json and encode it as a data URL. */
async function readIconPng(file: string): Promise<string | undefined> {
  const pngPath = resolve(dirname(file), 'icon.png')
  if (!existsSync(pngPath)) return undefined
  try {
    const buf = await readFile(pngPath)
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

async function collectJsonFiles(dir: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectJsonFiles(full, out)
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full)
  }
}

async function readGroup(file: string): Promise<NodeGroup | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as NodeGroup
  } catch {
    return null
  }
}

function categoryFor(root: string, file: string): string {
  const rel = relative(root, file).split(/[\\/]/)
  return rel[0] || 'templates'
}

type GroupCatalogScope = 'all' | 'groups' | 'templates'

function parseCatalogScope(raw: unknown): GroupCatalogScope {
  if (raw === 'groups' || raw === 'templates' || raw === 'all') return raw
  return 'all'
}

function kindsForScope(scope: GroupCatalogScope): ReadonlyArray<{ kind: 'groups' | 'templates'; roots: string[] }> {
  if (scope === 'groups') return [{ kind: 'groups', roots: groupRoots }]
  if (scope === 'templates') return [{ kind: 'templates', roots: templateRoots() }]
  return getKinds()
}

async function findGroupFile(groupId: string, scope: 'groups' | 'templates'): Promise<string | null> {
  for (const root of (scope === 'groups' ? groupRoots : templateRoots())) {
    const files: string[] = []
    await collectJsonFiles(root, files)
    for (const file of files) {
      const group = await readGroup(file)
      if (group?.id === groupId || basename(file, '.json') === groupId) return file
    }
  }
  return null
}

async function collectCatalogItems(scope: GroupCatalogScope): Promise<GroupTemplateBattery[]> {
  const items: GroupTemplateBattery[] = []
  const seenPaths = new Set<string>()
  for (const { kind, roots } of kindsForScope(scope)) {
    for (const root of roots) {
      const files: string[] = []
      await collectJsonFiles(root, files)
      for (const file of files) {
        const group = await readGroup(file)
        if (!group?.id) continue
        const sourcePath = relative(repoRoot, file)
        if (seenPaths.has(sourcePath)) continue
        seenPaths.add(sourcePath)
        const category = categoryFor(root, file)
        const iconSvg = kind === 'groups'
          ? (existsSync(resolve(dirname(file), 'icon.svg'))
              ? await readFile(resolve(dirname(file), 'icon.svg'), 'utf8').catch(() => undefined)
              : undefined)
          : undefined
        const iconPng = kind === 'templates' ? await readIconPng(file) : undefined
        items.push({
          id: group.id,
          name: group.name ?? basename(file, '.json'),
          nameEn: group.nameEn,
          category,
          displayGroup: `${kind}/${category}`,
          description: kind === 'templates'
            ? `Group template: ${group.name ?? group.id}`
            : `Group battery: ${group.name ?? group.id}`,
          version: '1.0.0',
          sourcePath,
          ...(iconSvg !== undefined ? { iconSvg } : {}),
          ...(iconPng !== undefined ? { iconPng } : {}),
        })
      }
    }
  }
  return items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

function safeName(value: unknown): string {
  // Tolerate non-string input (a malformed body would otherwise throw
  // `value.trim is not a function` → opaque 500). Coerce/skip before trimming.
  if (typeof value !== 'string') return 'Group'
  return value.trim().replace(/[\\/]/g, '-').replace(/\s+/g, ' ') || 'Group'
}

export async function registerGroupTemplateRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/group-templates/categories', async () => {
    // 保存按钮默认产出普通成组电池（写入 groups/），故分类候选取 groups/ 子目录。
    const cats = new Set<string>()
    for (const root of groupRoots) {
      try {
        const entries = await readdir(root, { withFileTypes: true })
        for (const entry of entries) if (entry.isDirectory()) cats.add(entry.name)
      } catch {
        /* ignore missing roots */
      }
    }
    return [...cats].sort()
  })

  // Templates 模式专用：扫 templates/ 子目录（含尚无模板电池的空占位目录），
  // 供 Templates 栏目大标签列表显示。与上面的 groups/ 分类（保存目标）严格区分。
  app.get('/api/v1/group-templates/template-categories', async () => {
    const cats = new Set<string>()
    for (const root of templateRoots()) {
      try {
        const entries = await readdir(root, { withFileTypes: true })
        for (const entry of entries) if (entry.isDirectory()) cats.add(entry.name)
      } catch {
        /* ignore missing roots */
      }
    }
    return [...cats].sort()
  })

  app.get<{ Querystring: { scope?: string } }>('/api/v1/group-templates', async (req) => {
    return collectCatalogItems(parseCatalogScope(req.query.scope))
  })

  app.get<{ Params: { id: string }; Querystring: { scope?: string } }>(
    '/api/v1/group-templates/:id',
    async (req, reply) => {
      const id = req.params.id
      const scopeRaw = req.query.scope
      const scope: 'groups' | 'templates' =
        scopeRaw === 'groups' || scopeRaw === 'templates' ? scopeRaw : 'templates'
      const file = await findGroupFile(id, scope)
      if (!file) return reply.code(404).send(null)
      return readGroup(file)
    },
  )

  app.post<{
    Body: { group: NodeGroup; categoryName: string; batteryName: string }
  }>('/api/v1/group-templates/save', async (req, reply) => {
    // Validate up front: a missing `group`, `categoryName`, or `batteryName`
    // previously threw a raw TypeError (e.g. `.trim` of undefined, `.nameEn` of
    // undefined) which Fastify surfaced as an opaque 500. Return a clear 400
    // instead so the client/user sees what is wrong.
    const body = req.body as Partial<{ group: NodeGroup; categoryName: unknown; batteryName: unknown }> | undefined
    if (!body || typeof body.group !== 'object' || body.group === null) {
      return reply.code(400).send({ error: 'Missing or invalid "group" in request body' })
    }
    if (typeof body.categoryName !== 'string' || body.categoryName.trim() === '') {
      return reply.code(400).send({ error: 'Missing or empty "categoryName" in request body' })
    }
    if (typeof body.batteryName !== 'string' || body.batteryName.trim() === '') {
      return reply.code(400).send({ error: 'Missing or empty "batteryName" in request body' })
    }

    const categoryName = safeName(body.categoryName)
    const batteryName = safeName(body.batteryName)
    // 保存按钮产出普通成组电池 → batteries/groups/<cat>/<name>/<name>.json
    const dir = resolve(appGroupRoot, categoryName, batteryName)
    const filePath = resolve(dir, `${batteryName}.json`)
    const group = { ...body.group, name: batteryName, nameEn: body.group.nameEn ?? batteryName }
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, `${JSON.stringify(group, null, 2)}\n`, 'utf8')
    } catch (err) {
      // Log the real failure (the app runs with logger:false, so without this
      // the cause of a write/serialize failure would be invisible) and return a
      // structured 500 carrying the message instead of a bare Internal Error.
      app.log.error({ err, dir, filePath }, 'failed to save group template')
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: `Failed to save group template: ${message}` })
    }
    return { filePath, groupId: group.id, categoryName, batteryName }
  })

  // 用户「保存到模板」：把成组电池作为用户内容写入 workspace `.forgeax` 区域，
  // 固定大标签 "My templates"，小标签为子目录：
  //   <workspaceRoot>/user-content/templates/My templates/<smallTag>/<name>.json
  // 列表接口 /api/v1/group-templates 会一并扫描该根，内置+用户模板统一显示。
  app.post<{
    Body: { group: NodeGroup; smallTag: string; templateName: string }
  }>('/api/v1/group-templates/save-user', async (req, reply) => {
    const body = req.body as Partial<{ group: NodeGroup; smallTag: unknown; templateName: unknown }> | undefined
    if (!body || typeof body.group !== 'object' || body.group === null) {
      return reply.code(400).send({ error: 'Missing or invalid "group" in request body' })
    }
    if (typeof body.smallTag !== 'string' || body.smallTag.trim() === '') {
      return reply.code(400).send({ error: 'Missing or empty "smallTag" in request body' })
    }
    if (typeof body.templateName !== 'string' || body.templateName.trim() === '') {
      return reply.code(400).send({ error: 'Missing or empty "templateName" in request body' })
    }

    const smallTag = safeName(body.smallTag)
    const templateName = safeName(body.templateName)
    const dir = resolve(userTemplateRoot(), USER_TEMPLATE_BIG_LABEL, smallTag)
    const filePath = resolve(dir, `${templateName}.json`)
    const group = { ...body.group, name: templateName, nameEn: body.group.nameEn ?? templateName }
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(filePath, `${JSON.stringify(group, null, 2)}\n`, 'utf8')
    } catch (err) {
      app.log.error({ err, dir, filePath }, 'failed to save user template')
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: `Failed to save user template: ${message}` })
    }
    return { filePath, groupId: group.id, smallTag, templateName }
  })

  // Instantiate a saved group template INTO the active project's graph as one
  // first-class `__group__` shadow node (the AI/headless twin of "drag a saved
  // group from the library onto the canvas"). Resolves the template by id /
  // file-basename, remaps every inner node/edge/group id to fresh ones (so the
  // same template can be dropped many times without collision) while keeping the
  // exposed `portName`s stable (in_N/out_N), then applies a single ordered batch
  // of createNode + connect + createGroup against the active runtime.
  //
  // Sino-gate relationship: this route does NOT route through POST /api/v1/batch,
  // so it never hits the sino op-allowlist hard gate (sinoOpGate). That is
  // correct by design — instantiating one of the 6 scene template groups is the
  // canonical *allowed* action, and the gate's only purpose is to block top-level
  // `createNode`s of non-whitelisted (e.g. alg_*) opIds, which here are always
  // adopted as group-private members anyway. The per-agent project lock IS still
  // enforced via ensureMutationAccess (same as /api/v1/batch).
  app.post<{
    Params: { id: string }
    Body: {
      templateId?: string
      position?: { x?: number; y?: number }
      groupId?: string
      opts?: { actor?: string; label?: string }
    }
  }>('/api/v1/group-templates/:id/instantiate', async (req, reply) => {
    const access = await ensureMutationAccess(req)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })

    const body = (req.body ?? {}) as {
      templateId?: string
      position?: { x?: number; y?: number }
      groupId?: string
      opts?: { actor?: string; label?: string }
    }
    const templateId = body.templateId ?? req.params.id
    if (typeof templateId !== 'string' || !templateId.trim()) {
      return reply.code(400).send({ error: 'missing templateId' })
    }

    const file = await findGroupFile(templateId, 'templates')
    if (!file) return reply.code(404).send({ error: `template not found: ${templateId}` })
    const parsed = await readGroup(file)
    const split = splitTemplate(parsed)
    if (!split) {
      return reply.code(422).send({ error: `template '${templateId}' is not a valid NodeGroup` })
    }

    const position = {
      x: typeof body.position?.x === 'number' ? body.position.x : 0,
      y: typeof body.position?.y === 'number' ? body.position.y : 0,
    }
    const explicitGroupId =
      typeof body.groupId === 'string' && body.groupId.trim() ? body.groupId : undefined

    const { ops, rootGroupId, exposedInputs, exposedOutputs } = buildTemplateOps(
      split.root,
      split.deps,
      position,
      explicitGroupId,
    )

    // Stamp template provenance on the shadow node so the editor renders the
    // locked purple template UI (same fields as drag-out from the Templates
    // palette). buildTemplateOps/createGroup only sets `{ groupId }`; without
    // this pass AI-instantiated templates look like ordinary group batteries.
    const batchOps = [...ops] as Op[]
    const templateRoot = templateRoots().find((root) => file.startsWith(resolve(root)))
    if (templateRoot) {
      const category = categoryFor(templateRoot, file)
      const batteryName = split.root.name ?? basename(file, '.json')
      batchOps.push({
        type: 'updateNode',
        nodeId: rootGroupId,
        params: {
          groupId: rootGroupId,
          __groupIsTemplate: true,
          __groupSourceGroupId: split.root.id,
          __groupSourceCategory: category,
          __groupSourceBatteryName: batteryName,
        },
      })
    }

    const rt = await getRuntime()
    const result = await applyBatch(rt, batchOps as never, {
      actor: typeof body.opts?.actor === 'string' ? body.opts.actor : 'instantiate-template',
      label:
        typeof body.opts?.label === 'string'
          ? body.opts.label
          : `instantiate template ${split.root.name ?? templateId}`,
    })

    if (result.status !== 'ok') {
      const detail = result.diagnostics?.[0]?.message ?? result.reason ?? 'unknown'
      return reply.code(422).send({ error: `instantiate rejected: ${detail}`, result })
    }

    return {
      ...result,
      groupId: rootGroupId,
      name: split.root.name ?? templateId,
      exposedInputs,
      exposedOutputs,
      opCount: ops.length,
    }
  })
}
