#!/usr/bin/env node
/**
 * Produce installable, self-contained release directories for the three
 * node-editor workbenches. Development deliberately stays a pnpm workspace;
 * this script is the only place that turns it into standalone Bun packages.
 */
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureWorkspacePackages } from './ensure-workspace-packages.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
ensureWorkspacePackages(ROOT)
const RELEASE_ROOT = resolve(ROOT, 'release')
const APPS = [
  { slug: 'wb-scene-generator', backendPort: 9557 },
  { slug: 'wb-3d-lowpoly', backendPort: 9567 },
  { slug: 'wb-2d-scene-asset-generator', backendPort: 9577 },
]
const INTERNAL_RUNTIME_PACKAGES = [
  'node-runtime',
  'editor-host',
  'batteries-common',
  'scene-authoring',
  'i18n',
  'node-runtime-react',
]
const BATTERY_EXTERNALS = ['chokidar', 'pino', 'pino-pretty', 'zod', 'typescript']

rmSync(RELEASE_ROOT, { recursive: true, force: true })
mkdirSync(RELEASE_ROOT, { recursive: true })

for (const app of APPS) buildRelease(app)
console.log(`[release] built ${APPS.length} standalone plugin package(s) in ${RELEASE_ROOT}`)

function buildRelease({ slug, backendPort }) {
  const appRoot = join(ROOT, 'apps', slug)
  const releaseRoot = join(RELEASE_ROOT, slug)
  const backendRoot = join(appRoot, 'backend')
  const frontendRoot = join(appRoot, 'frontend')
  const backendManifest = readJson(join(backendRoot, 'package.json'))
  const sourceManifest = readJson(join(appRoot, 'forgeax-extension.json'))

  run('pnpm', ['-C', frontendRoot, 'build'], ROOT)
  run('pnpm', ['-C', appRoot, 'build:vendor'], ROOT)

  mkdirSync(releaseRoot, { recursive: true })
  copyIfPresent(join(frontendRoot, 'dist'), join(releaseRoot, 'dist/frontend'))
  copyIfPresent(join(appRoot, 'batteries'), join(releaseRoot, 'batteries'))
  copyIfPresent(join(ROOT, 'packages/batteries-common/batteries'), join(releaseRoot, 'shared-batteries'))
  copyIfPresent(join(appRoot, 'assets'), join(releaseRoot, 'assets'))
  copyIfPresent(join(appRoot, 'templates'), join(releaseRoot, 'templates'))
  copyIfPresent(join(appRoot, 'skills'), join(releaseRoot, 'skills'))
  copyIfPresent(join(appRoot, 'vendor/dist'), join(releaseRoot, 'vendor/dist'))
  copyIfPresent(join(backendRoot, 'src/scene-export/assets'), join(releaseRoot, 'backend/scene-export-assets'))
  copyIfPresent(join(appRoot, 'SKILL.md'), join(releaseRoot, 'SKILL.md'))
  writeFileSync(join(releaseRoot, 'README.md'), releaseReadme(slug, sourceManifest), 'utf8')

  // App batteries are dynamically discovered at runtime. Compile every entry
  // individually so the loader sees index.js and no source workspace import is
  // needed after installation.
  createBuildWorkspaceLinks(releaseRoot)
  compileBatteryEntries(join(releaseRoot, 'batteries'))
  compileBatteryEntries(join(releaseRoot, 'shared-batteries'))
  rmSync(join(releaseRoot, 'node_modules'), { recursive: true, force: true })

  const internalRuntimeDependencies = Object.assign(
    {},
    ...INTERNAL_RUNTIME_PACKAGES.map((name) => Object.fromEntries(
      Object.entries(readJson(join(ROOT, 'packages', name, 'package.json')).dependencies ?? {})
        .filter(([dependency]) => !dependency.startsWith('@forgeax/')),
    )),
  )
  const dependencies = {
    ...internalRuntimeDependencies,
    ...Object.fromEntries(Object.entries(backendManifest.dependencies ?? {}).filter(([name]) => !name.startsWith('@forgeax/'))),
  }
  const external = Object.keys(dependencies).filter((name) => !name.startsWith('@forgeax/'))
  run('bun', [
    'build',
    join(backendRoot, 'src/main.ts'),
    join(backendRoot, 'src/tool-handlers.ts'),
    '--outdir',
    join(releaseRoot, 'dist/server'),
    '--target',
    'bun',
    '--format',
    'esm',
    '--sourcemap=linked',
    '--naming=[name].js',
    ...external.map((name) => `--external=${name}`),
  ], ROOT)
  removeFilesBySuffix(releaseRoot, '.map')

  const manifest = structuredClone(sourceManifest)
  manifest.id = manifest.id.replace('@forgeax-plugin/', '@forgeax-extension/')
  manifest.entry.frontend = './dist/frontend/index.html'
  manifest.entry.backend = './dist/server/tool-handlers.js'
  manifest.entry.standalone = {
    ...manifest.entry.standalone,
    start: 'bun run serve',
    backendPort,
  }
  if (manifest.contributes?.panelTypes) {
    for (const panel of manifest.contributes.panelTypes) panel.entry = './dist/frontend/index.html'
  }
  writeJson(join(releaseRoot, 'forgeax-extension.json'), manifest)

  const packageJson = {
    name: `@forgeax-extension/${slug}`,
    version: sourceManifest.version,
    private: false,
    type: 'module',
    packageManager: 'bun@1.3.13',
    description: `${sourceManifest.displayName.en} standalone release`,
    repository: {
      type: 'git',
      url: 'git+https://github.com/ForgeaX-Games/forgeax-wb-node-editor.git',
    },
    license: 'Apache-2.0',
    files: ['dist', 'batteries', 'shared-batteries', 'assets', 'templates', 'skills', 'vendor', 'backend', 'SKILL.md', 'README.md', 'serve.mjs', 'forgeax-extension.json', 'bun.lock'],
    scripts: {
      serve: 'bun serve.mjs',
      'check:release': 'node -e "const p=require(\'./package.json\');if(Object.values(p.dependencies||{}).some(v=>/^(file:|link:|workspace:|git\\+)/.test(v)))throw new Error(\'release dependencies must be registry versions\')"',
    },
    dependencies,
  }
  writeJson(join(releaseRoot, 'package.json'), packageJson)
  writeFileSync(join(releaseRoot, 'serve.mjs'), serverScript(backendPort), 'utf8')
  run('bun', ['install'], releaseRoot)
}

function compileBatteryEntries(root) {
  if (!existsSync(root)) return
  for (const indexPath of walk(root).filter((path) => path.endsWith('/index.ts'))) {
    const outputDir = dirname(indexPath)
    run('bun', [
      'build',
      indexPath,
      '--outdir',
      outputDir,
      '--target',
      'bun',
      '--format',
      'esm',
      '--naming=[name].js',
      ...BATTERY_EXTERNALS.map((name) => `--external=${name}`),
    ], ROOT)
    rmSync(indexPath, { force: true })
  }
}

function createBuildWorkspaceLinks(releaseRoot) {
  const forgeax = join(releaseRoot, 'node_modules/@forgeax')
  mkdirSync(forgeax, { recursive: true })
  symlinkSync(
    join(ROOT, 'packages/node-runtime'),
    join(forgeax, 'node-runtime'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
}

function walk(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function removeFilesBySuffix(dir, suffix) {
  for (const path of walk(dir)) {
    if (path.endsWith(suffix)) rmSync(path, { force: true })
  }
}

function serverScript(defaultBackendPort) {
  return `import { createServer, request } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve(import.meta.dirname)
const frontend = join(root, 'dist/frontend')
const frontendPort = Number(process.env.VITE_DEV_PORT ?? ${defaultBackendPort - 2})
const backendPort = Number(process.env.PORT ?? ${defaultBackendPort})
const backend = Bun.spawn(['bun', 'dist/server/main.js'], { cwd: root, env: { ...process.env, PORT: String(backendPort) }, stdout: 'inherit', stderr: 'inherit' })
const mime = new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.json','application/json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.webp','image/webp']])
const server = createServer((req, res) => {
  if (req.url === '/health' || req.url?.startsWith('/api/') || req.url?.startsWith('/ws')) {
    const upstream = request({ hostname: '127.0.0.1', port: backendPort, path: req.url, method: req.method, headers: req.headers }, (upstreamRes) => { res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers); upstreamRes.pipe(res) })
    upstream.on('error', (error) => { res.writeHead(502, {'content-type':'application/json'}); res.end(JSON.stringify({error: error.message})) })
    req.pipe(upstream)
    return
  }
  const requested = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)).replace(/^(\\.\\.[/\\\\])+/, '')
  let file = resolve(frontend, '.' + requested)
  if (!file.startsWith(frontend) || !existsSync(file) || statSync(file).isDirectory()) file = join(frontend, 'index.html')
  res.writeHead(200, {'content-type': mime.get(extname(file)) ?? 'application/octet-stream'})
  createReadStream(file).pipe(res)
})
server.listen(frontendPort, '0.0.0.0', () => console.log('[standalone] listening on :' + frontendPort))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { backend.kill(); server.close(() => process.exit(0)) })
`
}

function releaseReadme(slug, manifest) {
  return `# ${manifest.displayName.en}

Standalone ForgeaX workbench extension.

## Install

\`\`\`bash
bun add @forgeax-extension/${slug}
\`\`\`

The package is self-contained: it has no \`file:\`, \`link:\`, or
\`workspace:\` dependencies. To run the installed package outside Studio:

\`\`\`bash
bun --cwd node_modules/@forgeax-extension/${slug} run serve
\`\`\`

For Studio, install through the Marketplace / ForgeaX extension installer so
the manifest is discovered and the standalone process receives its assigned
ports and project root.
`
}

function copyIfPresent(from, to) {
  if (existsSync(from)) cpSync(from, to, { recursive: true })
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function run(command, args, cwd) {
  console.log(`[release] ${command} ${args.map((arg) => JSON.stringify(arg)).join(' ')}`)
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

function fail(message) {
  console.error(`[release] ${message}`)
  process.exit(1)
}
