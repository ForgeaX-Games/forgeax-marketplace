import {
  readdir,
  readFile,
  realpath,
  stat,
} from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const PACKAGE_NAME = '@forgeax/wb-game-video'
const PLATFORM_PACKAGE = '@forgeax/extension-platform'
const PLATFORM_VERSION = '0.0.2'
const WORKBENCH_HOST_PACKAGE = '@forgeax/workbench-host'
const WORKBENCH_HOST_VERSION = '0.1.0'
const REVIEWED_WORKBENCH_HOST_COMMIT = '15a573679ad058e4d04fadea2f5c90abb29d2245'
const WORKBENCH_HOST_ARCHIVE = 'vendor/forgeax-workbench-host-0.1.0.tgz'
const WORKBENCH_HOST_PROVENANCE = 'vendor/forgeax-workbench-host-0.1.0.provenance.json'
const HOST_BACKEND_ENTRY = './dist/server/host.js'
const REQUIRED_PACKAGE_EXPORTS = {
  '.': './dist/index.js',
  './host': HOST_BACKEND_ENTRY,
}
const TEXT_EXTENSIONS = new Set([
  '.css',
  '.env',
  '.html',
  '.js',
  '.jsx',
  '.json',
  '.lock',
  '.md',
  '.mjs',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])
const TEXT_FILENAMES = new Set([
  '.env.example',
  '.gitignore',
  'AGENTS.md',
  'README.md',
  'SKILL.md',
])
const SCAN_EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
])
const SCAN_EXCLUDED_FILES = new Set([
  'src/bootMigrateLegacyKeys.ts',
  'src/__tests__/bootMigrateLegacyKeys.test.ts',
])
const compactLegacyName = ['game', 'video'].join('')
const compactLegacyReelName = ['reel', 'studio'].join('-')
const oldToolNamespaces = [['gv', 'id'].join(''), ['g', 'en'].join('')]
const oldEnvironmentNames = [
  ['PORT', 'REEL', 'STUDIO'].join('_'),
  ['PORT', ['GAME', 'VIDEO'].join(''), 'STUDIO'].join('_'),
  ['WB', ['GAME', 'VIDEO'].join(''), 'PLUGIN', 'BUILD'].join('_'),
]
const OLD_ACTIVE_IDENTITIES = [
  new RegExp(['@forgeax-', 'extension/wb-game-', 'video'].join('')),
  new RegExp(`\\b(?:${oldToolNamespaces.join('|')})(?::[a-z]|\\.)`, 'i'),
  new RegExp(`\\b${compactLegacyReelName}\\b`, 'i'),
  new RegExp(`\\b${compactLegacyName}(?:[:.\\-\\]]|\\b)`, 'i'),
  new RegExp(`\\b(?:${oldEnvironmentNames.join('|')})\\b`),
  new RegExp(`emit:${compactLegacyName}`),
  new RegExp(`/${compactLegacyName}\\b`),
]
const OLD_ACTIVE_PATH_ROOTS = [
  compactLegacyName,
  ['game', 'video'].join('-'),
  ['wb', 'video', 'game'].join('-'),
  compactLegacyReelName,
  oldToolNamespaces[0],
  ['g', 'vid'].join('-'),
]
const GENERATED_MIGRATION_PREFIX_LIST = new RegExp(
  `\\[\\s*(["'])${compactLegacyReelName}\\1\\s*,\\s*(["'])${compactLegacyName}\\2\\s*,\\s*(["'])${oldToolNamespaces[0]}\\3\\s*\\]`,
  'g',
)

function isWithinRoot(root, candidate) {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`)
  )
}

async function readJson(path, label, errors) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    errors.push(`${label} is not readable JSON: ${error.message}`)
    return null
  }
}

async function checkPackagePath(root, label, entry, errors) {
  if (typeof entry !== 'string' || entry.length === 0) {
    errors.push(`${label} must be a non-empty package-relative path`)
    return null
  }

  const candidate = resolve(root, entry)
  if (!isWithinRoot(root, candidate)) {
    errors.push(`${label} resolves outside the package root: ${entry}`)
    return null
  }

  try {
    const info = await stat(candidate)
    if (!info.isFile()) {
      errors.push(`${label} must resolve to a file within the package root: ${entry}`)
      return null
    }
    const realCandidate = await realpath(candidate)
    const realRoot = await realpath(root)
    if (!isWithinRoot(realRoot, realCandidate)) {
      errors.push(`${label} resolves outside the package root through a symlink: ${entry}`)
      return null
    }
    return candidate
  } catch {
    errors.push(`${label} does not exist within the package root: ${entry}`)
    return null
  }
}

function isTextFile(path) {
  const name = path.split('/').at(-1)
  return TEXT_FILENAMES.has(name) || TEXT_EXTENSIONS.has(extname(path))
}

function identityScanSource(packagePath, source) {
  if (!packagePath.startsWith('dist/')) return source
  return source.replace(
    GENERATED_MIGRATION_PREFIX_LIST,
    '["generated-legacy-migration-prefixes"]',
  )
}

function normalizePathComponent(component) {
  return component.toLowerCase().replaceAll(/[_-]+/g, '-')
}

function oldIdentityPathMatch(packagePath) {
  const components = packagePath.split('/').map(normalizePathComponent)
  for (const [index, component] of components.entries()) {
    for (const oldRoot of OLD_ACTIVE_PATH_ROOTS) {
      if (
        component === oldRoot ||
        component.startsWith(`${oldRoot}.`) ||
        component.startsWith(`${oldRoot}-`)
      ) {
        return components.slice(0, index + 1).join('/')
      }
    }

    if (
      component === '@forgeax-extension' &&
      components[index + 1] === 'wb-game-video'
    ) {
      return components.slice(0, index + 2).join('/')
    }
  }
  return null
}

async function findOldActiveIdentities(root, errors) {
  const pending = ['']
  while (pending.length > 0) {
    const directory = pending.pop()
    const entries = await readdir(resolve(root, directory), { withFileTypes: true })
    for (const entry of entries) {
      const packagePath = directory ? `${directory}/${entry.name}` : entry.name
      const isRootHistoricalDocs = (
        directory === '' &&
        entry.isDirectory() &&
        entry.name === 'docs'
      )
      const isExcludedDirectory = (
        entry.isDirectory() &&
        (isRootHistoricalDocs || SCAN_EXCLUDED_DIRS.has(entry.name))
      )

      if (isExcludedDirectory) continue

      const oldPathMatch = oldIdentityPathMatch(packagePath)
      if (oldPathMatch) {
        errors.push(
          `old active identity ${JSON.stringify(oldPathMatch)} in relative path ${packagePath}`,
        )
      }

      if (entry.isDirectory()) {
        pending.push(packagePath)
        continue
      }
      if (
        !entry.isFile() ||
        SCAN_EXCLUDED_FILES.has(packagePath) ||
        !isTextFile(packagePath)
      ) {
        continue
      }

      const source = identityScanSource(
        packagePath,
        await readFile(resolve(root, packagePath), 'utf8'),
      )
      for (const pattern of OLD_ACTIVE_IDENTITIES) {
        const match = pattern.exec(source)
        if (!match) continue
        const line = source.slice(0, match.index).split('\n').length
        errors.push(
          `old active identity ${JSON.stringify(match[0])} in ${packagePath}:${line}`,
        )
        break
      }
    }
  }
}

function hasLocalAbsolutePath(value) {
  if (typeof value === 'string') {
    return (
      value.startsWith('/')
      || /^file:\/(?!\.?\/vendor\/)/.test(value)
      || /\/(?:Users|private|var\/folders)\//.test(value)
      || /^[A-Za-z]:[\\/]/.test(value)
    )
  }
  if (Array.isArray(value)) return value.some(hasLocalAbsolutePath)
  if (value && typeof value === 'object') {
    return Object.values(value).some(hasLocalAbsolutePath)
  }
  return false
}

async function validateNoLocalAbsolutePaths(packageRoot, pkg, errors) {
  if (hasLocalAbsolutePath(pkg)) {
    errors.push('package.json contains a local absolute path')
  }

  try {
    const lockSource = await readFile(resolve(packageRoot, 'bun.lock'), 'utf8')
    if (hasLocalAbsolutePath(lockSource)) {
      errors.push('bun.lock contains a local absolute path')
    }
  } catch {
    errors.push('bun.lock is not readable')
  }
}

async function validateHostVendorProvenance(packageRoot, errors) {
  const provenance = await readJson(
    resolve(packageRoot, WORKBENCH_HOST_PROVENANCE),
    WORKBENCH_HOST_PROVENANCE,
    errors,
  )
  if (!provenance) return

  const expectedFields = {
    schemaVersion: 1,
    package: WORKBENCH_HOST_PACKAGE,
    version: WORKBENCH_HOST_VERSION,
    sourceCommit: REVIEWED_WORKBENCH_HOST_COMMIT,
    archive: WORKBENCH_HOST_ARCHIVE,
  }
  for (const [field, expected] of Object.entries(expectedFields)) {
    if (provenance[field] !== expected) {
      errors.push(
        `${WORKBENCH_HOST_PROVENANCE}.${field} must be ${JSON.stringify(expected)}; received ${JSON.stringify(provenance[field])}`,
      )
    }
  }

  let archive
  try {
    archive = await readFile(resolve(packageRoot, WORKBENCH_HOST_ARCHIVE))
  } catch {
    errors.push(`${WORKBENCH_HOST_ARCHIVE} is not readable`)
    return
  }
  const sha256 = createHash('sha256').update(archive).digest('hex')
  const sha512 = createHash('sha512').update(archive).digest('hex')
  const integrity = `sha512-${createHash('sha512').update(archive).digest('base64')}`
  for (const [field, expected] of Object.entries({ sha256, sha512, integrity })) {
    if (provenance[field] !== expected) {
      errors.push(
        `${WORKBENCH_HOST_PROVENANCE}.${field} does not match ${WORKBENCH_HOST_ARCHIVE}`,
      )
    }
  }

  try {
    const lockSource = await readFile(resolve(packageRoot, 'bun.lock'), 'utf8')
    if (!lockSource.includes(integrity)) {
      errors.push(`bun.lock does not contain ${WORKBENCH_HOST_ARCHIVE} integrity`)
    }
  } catch {
    errors.push('bun.lock is not readable')
  }
}

function validatePackage(pkg, errors) {
  if (pkg.name !== PACKAGE_NAME) {
    errors.push(`package name must be ${PACKAGE_NAME}; received ${JSON.stringify(pkg.name)}`)
  }

  for (const [dependencyPackage, dependencyVersion] of [
    [PLATFORM_PACKAGE, PLATFORM_VERSION],
    [WORKBENCH_HOST_PACKAGE, WORKBENCH_HOST_VERSION],
  ]) {
    for (const dependencyKind of ['peerDependencies', 'devDependencies']) {
      const actual = pkg[dependencyKind]?.[dependencyPackage]
      if (actual !== dependencyVersion) {
        errors.push(
          `${dependencyKind}.${dependencyPackage} must be exactly ${dependencyVersion}; received ${JSON.stringify(actual)}`,
        )
      }
    }
  }

  for (const [exportName, expectedPath] of Object.entries(REQUIRED_PACKAGE_EXPORTS)) {
    const actual = pkg.exports?.[exportName]
    if (actual !== expectedPath) {
      errors.push(
        `exports[${JSON.stringify(exportName)}] must be exactly ${expectedPath}; received ${JSON.stringify(actual)}`,
      )
    }
  }

  if (!Array.isArray(pkg.files) || !pkg.files.includes('dist') || pkg.files.includes('vendor')) {
    errors.push('package files must include dist and exclude vendor')
  }
}

async function validateManifest(packageRoot, manifest, errors) {
  if (manifest.id !== PACKAGE_NAME) {
    errors.push(
      `manifest ID must be ${PACKAGE_NAME}; received ${JSON.stringify(manifest.id)}`,
    )
  }

  if (manifest.entry?.backend !== HOST_BACKEND_ENTRY) {
    errors.push(`entry.backend must be exactly ${HOST_BACKEND_ENTRY}; received ${JSON.stringify(manifest.entry?.backend)}`)
  }

  const backendPath = await checkPackagePath(
    packageRoot,
    'entry.backend',
    manifest.entry?.backend,
    errors,
  )
  await checkPackagePath(
    packageRoot,
    'entry.frontend',
    manifest.entry?.frontend,
    errors,
  )

  const skills = Array.isArray(manifest.provides?.skills)
    ? manifest.provides.skills
    : []
  for (const [index, skill] of skills.entries()) {
    await checkPackagePath(
      packageRoot,
      `provides.skills[${index}].entry`,
      skill?.entry,
      errors,
    )
  }

  const tools = Array.isArray(manifest.provides?.tools)
    ? manifest.provides.tools
    : []
  for (const [index, tool] of tools.entries()) {
    await checkPackagePath(
      packageRoot,
      `provides.tools[${index}].args`,
      tool?.args,
      errors,
    )
    await checkPackagePath(
      packageRoot,
      `provides.tools[${index}].returns`,
      tool?.returns,
      errors,
    )
  }

  if (backendPath) {
    try {
      const backend = await import(/* @vite-ignore */ pathToFileURL(backendPath).href)
      const manifestToolIds = tools.map((tool) => tool?.id)
      if (backend.host === undefined) {
        errors.push('compiled backend must export named host')
      }
      const handlerKeys = Object.keys(backend.tools ?? {})
      if (
        handlerKeys.length !== manifestToolIds.length ||
        handlerKeys.some((key, index) => key !== manifestToolIds[index])
      ) {
        errors.push(
          `compiled backend named tools keys ${JSON.stringify(handlerKeys)} must equal manifest tool IDs in order ${JSON.stringify(manifestToolIds)}`,
        )
      }
    } catch (error) {
      errors.push(`entry.backend could not be imported as ESM: ${error.message}`)
    }
  }
}

export async function validateRelease(root) {
  const packageRoot = resolve(root)
  const errors = []
  const pkg = await readJson(resolve(packageRoot, 'package.json'), 'package.json', errors)
  const manifest = await readJson(
    resolve(packageRoot, 'forgeax-extension.json'),
    'forgeax-extension.json',
    errors,
  )

  if (pkg) {
    validatePackage(pkg, errors)
    await validateNoLocalAbsolutePaths(packageRoot, pkg, errors)
  }
  await validateHostVendorProvenance(packageRoot, errors)
  if (manifest) await validateManifest(packageRoot, manifest, errors)
  if (pkg && manifest) {
    const expectedTag = `v${pkg.version}`
    if (manifest.version !== pkg.version) {
      errors.push(
        `manifest version ${JSON.stringify(manifest.version)} must equal package version ${JSON.stringify(pkg.version)} for tag ${expectedTag}`,
      )
    }
  }

  try {
    await findOldActiveIdentities(packageRoot, errors)
  } catch (error) {
    errors.push(`old active identity scan failed: ${error.message}`)
  }

  return errors
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = await validateRelease(process.cwd())
  if (errors.length === 0) {
    console.log('Release package is complete and internally consistent.')
  } else {
    for (const error of errors) console.error(`- ${error}`)
    process.exitCode = 1
  }
}
