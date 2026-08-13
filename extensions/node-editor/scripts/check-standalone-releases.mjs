#!/usr/bin/env node
/**
 * Release gate for the generated standalone packages. It intentionally checks
 * the files that `npm pack` would publish, rather than the pnpm workspace.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const packageArgument = process.argv.indexOf('--package')
const packages = packageArgument >= 0
  ? [resolve(process.argv[packageArgument + 1] ?? '')]
  : ['wb-scene-generator', 'wb-3d-lowpoly', 'wb-2d-scene-asset-generator'].map((slug) => join(ROOT, 'release', slug))
const forbiddenDependency = /^(?:file:|link:|workspace:|git\+)/u
const forbiddenPath = /(?:^|\/)(?:node_modules|\.env(?:\.|$))(?:\/|$)/iu
const forbiddenText = [
  /(?:^|[^A-Za-z0-9_])(?:api[_-]?key|access[_-]?token|secret(?:[_-]?key)?|password)\s*[:=]\s*["'][^"']+["']/iu,
  /(?:^|[\s"'`=])(?:\/(?:tmp|var|etc|usr|opt|Users|private|home|workspace|mnt|root|srv|app|build|Volumes|Library)(?:\/|$)|[A-Za-z]:[\\/])/u,
]

for (const packageRoot of packages) checkPackage(packageRoot)
if (packages.length > 1) {
  const versions = packages.map((packageRoot) => readJson(packageRoot, 'package.json').version)
  assert(
    versions.every((version) => version === versions[0]),
    `release trio versions must match: ${versions.join(', ')}`,
  )
}
console.log(`[release] release contract passed for ${packages.length} package(s)`)

function checkPackage(packageRoot) {
  assert(existsSync(packageRoot), `release package is missing: ${packageRoot}`)
  const pkg = readJson(packageRoot, 'package.json')
  const manifest = readJson(packageRoot, 'forgeax-extension.json')
  assert(pkg.private !== true, `${pkg.name} must be publishable`)
  assert(/^bun@\d/u.test(pkg.packageManager ?? ''), `${pkg.name} must declare a pinned Bun package manager`)
  assert(manifest.id.startsWith('@forgeax-extension/'), `${pkg.name} must use the @forgeax-extension namespace`)
  assert(pkg.version === manifest.version, `${pkg.name} package and manifest versions must match`)
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, specifier] of Object.entries(pkg[section] ?? {})) {
      assert(typeof specifier === 'string' && !forbiddenDependency.test(specifier),
        `${pkg.name} ${section}.${name} must not use a local or Git dependency`)
    }
  }
  for (const [label, entry] of Object.entries({
    frontend: manifest.entry?.frontend,
    backend: manifest.entry?.backend,
    standalone: './serve.mjs',
  })) {
    assert(typeof entry === 'string' && entry.startsWith('.'), `${pkg.name} ${label} entry is invalid`)
    const absolute = resolve(packageRoot, entry)
    assert(absolute === packageRoot || absolute.startsWith(`${packageRoot}${sep}`), `${pkg.name} ${label} escapes the package`)
    assert(existsSync(absolute), `${pkg.name} ${label} entry is missing: ${entry}`)
  }
  assert(typeof pkg.scripts?.serve === 'string', `${pkg.name} must expose scripts.serve`)
  assert(!pkg.scripts?.dev, `${pkg.name} must not expose scripts.dev`)
  assert(existsSync(join(packageRoot, 'bun.lock')), `${pkg.name} must include bun.lock`)
  assert(existsSync(join(packageRoot, 'batteries')), `${pkg.name} app batteries are missing`)
  assert(existsSync(join(packageRoot, 'shared-batteries')), `${pkg.name} common batteries are missing`)

  const packed = packDryRun(packageRoot)
  const packedPaths = new Set(packed.map((file) => file.path.replaceAll('\\', '/')))
  for (const required of [
    'package.json',
    'bun.lock',
    'README.md',
    'forgeax-extension.json',
    String(manifest.entry.frontend).replace(/^\.\//u, ''),
    String(manifest.entry.backend).replace(/^\.\//u, ''),
    'serve.mjs',
  ]) {
    assert(packedPaths.has(required), `${pkg.name} does not publish required file: ${required}`)
  }
  for (const file of packed) {
    const normalized = file.path.replaceAll('\\', '/')
    assert(!forbiddenPath.test(normalized), `${pkg.name} publishes forbidden path: ${normalized}`)
    const absolute = resolve(packageRoot, normalized)
    assert(absolute === packageRoot || absolute.startsWith(`${packageRoot}${sep}`), `${pkg.name} packed file escapes its package`)
    if (!isTextFile(normalized)) continue
    const text = readFileSync(absolute, 'utf8')
    for (const pattern of forbiddenText) {
      assert(!pattern.test(text), `${pkg.name} packed file contains a credential or absolute path: ${normalized}`)
    }
  }
}

function packDryRun(packageRoot) {
  const destination = mkdtempSync(join(tmpdir(), 'forgeax-release-pack-'))
  try {
    const output = execFileSync('npm', ['pack', '--dry-run', '--json', '--pack-destination', destination], {
      cwd: packageRoot,
      encoding: 'utf8',
    })
    const result = JSON.parse(output)
    assert(Array.isArray(result) && result.length === 1 && Array.isArray(result[0]?.files), 'npm pack returned no file list')
    return result[0].files
  } finally {
    rmSync(destination, { recursive: true, force: true })
  }
}

function isTextFile(path) {
  return !/\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf|otf|wasm|glb|zip|gz|mp3|mp4)$/iu.test(path)
}

function readJson(root, file) {
  return JSON.parse(readFileSync(join(root, file), 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
