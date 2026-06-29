import type { FastifyInstance } from 'fastify'
import type { NodeGroup, Op } from '@forgeax/node-runtime'
import { applyBatch } from '@forgeax/node-runtime'
import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, relative, resolve, sep } from 'node:path'
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
  /** True for preset templates shipped in the plugin (read-only); false for user templates under `.forgeax`. */
  builtin?: boolean
}

// Templates 模式预览图：template 文件夹内若含图片（任意 png/jpg/jpeg/webp/gif），
// 优先 icon.png，否则取首张（按名排序，确定性），编码为 data URL 当前端 thumb。
// 与 wb-2d-scene-asset-generator 的 readPreviewImage 行为保持一致。
const PREVIEW_EXT_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Read the first supported preview image beside the template json (prefer icon.png). */
async function readIconPng(file: string): Promise<string | undefined> {
  const dir = dirname(file)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return undefined
  }
  const images = entries
    .filter((e) => e.isFile() && PREVIEW_EXT_MIME[extname(e.name).toLowerCase()] !== undefined)
    .map((e) => e.name)
    .sort((a, b) => (a === 'icon.png' ? -1 : b === 'icon.png' ? 1 : a.localeCompare(b)))
  const picked = images[0]
  if (!picked) return undefined
  try {
    const buf = await readFile(resolve(dir, picked))
    const mime = PREVIEW_EXT_MIME[extname(picked).toLowerCase()]
    return `data:${mime};base64,${buf.toString('base64')}`
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

/**
 * Locate a develop group battery folder by its on-disk folder name when the json
 * is already gone (README-only orphans after a partial delete).
 */
async function findGroupBatteryFolder(batteryFolderName: string): Promise<string | null> {
  for (const root of groupRoots) {
    let categories: import('node:fs').Dirent[]
    try {
      categories = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const cat of categories) {
      if (!cat.isDirectory()) continue
      const dir = resolve(root, cat.name, batteryFolderName)
      if (!existsSync(dir)) continue
      try {
        const info = await stat(dir)
        if (info.isDirectory()) return dir
      } catch {
        continue
      }
    }
  }
  return null
}

/** Remove a group battery folder (<cat>/<name>/) and prune an empty category dir. */
async function removeGroupBatteryDirectory(dir: string, owningRoot: string): Promise<void> {
  const resolvedDir = resolve(dir)
  if (resolvedDir === resolve(owningRoot)) return
  await rm(resolvedDir, { recursive: true, force: true })
  const categoryDir = dirname(resolvedDir)
  if (resolve(categoryDir) === resolve(owningRoot)) return
  const remaining = await readdir(categoryDir).catch(() => null)
  if (remaining !== null && remaining.length === 0) {
    await rmdir(categoryDir).catch(() => {})
  }
}

async function collectCatalogItems(scope: GroupCatalogScope): Promise<GroupTemplateBattery[]> {
  const items: GroupTemplateBattery[] = []
  const seenPaths = new Set<string>()
  const userRoot = userTemplateRoot()
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
          // 用户内容（userTemplateRoot 下）= builtin:false（可右击删除）；
          // 其余 groups/ 与内置 templates/ = builtin:true（只读，不可删除）。
          builtin: root !== userRoot,
          ...(iconSvg !== undefined ? { iconSvg } : {}),
          ...(iconPng !== undefined ? { iconPng } : {}),
        })
      }
    }
  }
  return items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
}

// 只在用户模板根（workspace `.forgeax`）下按 group id 定位文件，用于删除。
// 刻意不搜内置 templates/ 与 groups/，从根上保证预设模板永不可删。
async function findUserTemplateFile(groupId: string): Promise<string | null> {
  const root = userTemplateRoot()
  const files: string[] = []
  await collectJsonFiles(root, files)
  for (const file of files) {
    const group = await readGroup(file)
    if (group?.id === groupId || basename(file, '.json') === groupId) return file
  }
  return null
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

  // 删除 GROUPS 标签下的成组电池：从本地电池目录（groups/<cat>/<name>/）物理删除。
  // 只允许删 groupRoots 范围内的文件（templates/ 与项目外路径一律拒绝），删掉 json
  // 后顺手清理只剩 icon 边车或已空的电池文件夹，保持 GROUPS 目录整洁。
  app.delete('/api/v1/group-templates/groups/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id?.trim()
    if (!id) return reply.code(400).send({ error: 'missing id' })
    const file = await findGroupFile(id, 'groups')
    const orphanDir = file ? null : await findGroupBatteryFolder(id)
    if (!file && !orphanDir) return reply.code(404).send({ error: 'group battery not found' })

    const batteryDir = file ? dirname(file) : orphanDir!
    const resolvedDir = resolve(batteryDir)

    // Defense-in-depth: resolved path must stay inside a groupRoot — never let a
    // crafted id escape into templates/ or outside the battery tree.
    const owningRoot = groupRoots.find(
      (root) => resolvedDir === resolve(root) || resolvedDir.startsWith(resolve(root) + sep),
    )
    if (!owningRoot) return reply.code(403).send({ error: 'group battery is outside the deletable battery roots' })
    if (resolve(batteryDir) === resolve(owningRoot)) {
      return reply.code(403).send({ error: 'refusing to delete a group root directory' })
    }

    try {
      await removeGroupBatteryDirectory(batteryDir, owningRoot)
    } catch (err) {
      app.log.error({ err, dir: resolvedDir }, 'failed to delete group battery')
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: `Failed to delete group battery: ${message}` })
    }
    return { ok: true }
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

  // 删除用户模板：仅限 userTemplateRoot 下的内容（预设模板只读，不在此可达）。
  // 删除 json 后顺手清理变空的小标签目录（保持「My templates」整洁，不留空分组）。
  app.delete('/api/v1/group-templates/user/:id', async (req, reply) => {
    const id = (req.params as { id?: string }).id?.trim()
    if (!id) return reply.code(400).send({ error: 'missing id' })
    const file = await findUserTemplateFile(id)
    if (!file) return reply.code(404).send({ error: 'user template not found' })
    try {
      await rm(file)
      const dir = dirname(file)
      const remaining = await readdir(dir).catch(() => [] as string[])
      if (remaining.length === 0) await rmdir(dir).catch(() => {})
    } catch (err) {
      app.log.error({ err, file }, 'failed to delete user template')
      const message = err instanceof Error ? err.message : String(err)
      return reply.code(500).send({ error: `Failed to delete user template: ${message}` })
    }
    return { ok: true }
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
