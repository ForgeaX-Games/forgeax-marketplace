import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

export const ASSET_CANVAS_PACKAGE = '@forgeax-extension/wb-asset-canvas'
export const ASSET_CANVAS_VERSION = '0.2.0'
export const ASSET_CANVAS_DIRECTORY = 'vendor/wb-asset-canvas-generation'
export const ASSET_CANVAS_DEV_SPEC = `file:${ASSET_CANVAS_DIRECTORY}`
export const GENERATION_EXPORT = {
  types: './dist/generation-lib.d.ts',
  import: './dist/generation-lib.js',
}

const ALLOWED_FILES = [
  'dist/generation-lib.d.ts',
  'dist/generation-lib.js',
  'package.json',
]
const DEPENDENCY_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'bundledDependencies',
  'bundleDependencies',
]

export function createGenerationPackageManifest() {
  return {
    name: ASSET_CANVAS_PACKAGE,
    version: ASSET_CANVAS_VERSION,
    type: 'module',
    exports: {
      './generation': GENERATION_EXPORT,
    },
  }
}

function isWithinRoot(root, candidate) {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (
    pathFromRoot !== '..' &&
    !pathFromRoot.startsWith(`..${sep}`)
  )
}

async function listPackageFiles(root) {
  const files = []
  const pending = ['']
  while (pending.length > 0) {
    const directory = pending.pop()
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const packagePath = directory ? `${directory}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) {
        throw new Error(`${packagePath} must not be a symbolic link`)
      }
      if (entry.isDirectory()) {
        pending.push(packagePath)
        continue
      }
      if (!entry.isFile()) {
        throw new Error(`${packagePath} must be a regular file`)
      }
      files.push(packagePath)
    }
  }
  return files.sort()
}

function isEmptyDependencySection(value) {
  if (value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  return value !== null && typeof value === 'object' && Object.keys(value).length === 0
}

function findExternalModuleImports(source) {
  const matches = new Set()
  const patterns = [
    /(?:^|\n)\s*import\s+(?:type\s+)?(?:[^'"\n]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+(?:type\s+)?[^'"\n]+?\s+from\s+['"]([^'"]+)['"]/g,
    /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) matches.add(match[1])
  }
  return [...matches]
}

export async function validateGenerationPackage(packagePath) {
  const errors = []
  let packageRoot
  try {
    const info = await lstat(packagePath)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      return ['generation package must be a regular directory']
    }
    packageRoot = await realpath(packagePath)
    if (!isWithinRoot(await realpath(resolve(packagePath, '..')), packageRoot)) {
      return ['generation package resolves outside its vendor directory']
    }
  } catch (error) {
    return [`generation package directory is not readable: ${error.message}`]
  }

  try {
    const actualFiles = await listPackageFiles(packageRoot)
    if (JSON.stringify(actualFiles) !== JSON.stringify(ALLOWED_FILES)) {
      errors.push(
        `generation package files ${JSON.stringify(actualFiles)} must equal whitelist ${JSON.stringify(ALLOWED_FILES)}`,
      )
    }
  } catch (error) {
    errors.push(`generation package file scan failed: ${error.message}`)
  }

  let manifest
  try {
    manifest = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'))
  } catch (error) {
    errors.push(`generation package package.json is not readable JSON: ${error.message}`)
  }
  if (manifest) {
    const expectedManifest = createGenerationPackageManifest()
    if (!isDeepStrictEqual(manifest, expectedManifest)) {
      errors.push(
        `generation package manifest must exactly equal ${JSON.stringify(expectedManifest)}; received ${JSON.stringify(manifest)}`,
      )
    }
    if (manifest.name !== ASSET_CANVAS_PACKAGE) {
      errors.push(
        `generation package name must be ${ASSET_CANVAS_PACKAGE}; received ${JSON.stringify(manifest.name)}`,
      )
    }
    if (manifest.version !== ASSET_CANVAS_VERSION) {
      errors.push(
        `generation package version must be ${ASSET_CANVAS_VERSION}; received ${JSON.stringify(manifest.version)}`,
      )
    }
    const expectedExports = expectedManifest.exports
    if (JSON.stringify(manifest.exports) !== JSON.stringify(expectedExports)) {
      errors.push(
        `generation package exports must equal ${JSON.stringify(expectedExports)}; received ${JSON.stringify(manifest.exports)}`,
      )
    }
    for (const section of DEPENDENCY_SECTIONS) {
      if (!isEmptyDependencySection(manifest[section])) {
        errors.push(`generation package ${section} must be empty or absent`)
      }
    }
  }

  for (const [path, label] of [
    ['dist/generation-lib.js', 'generation runtime'],
    ['dist/generation-lib.d.ts', 'generation declarations'],
  ]) {
    try {
      const imports = findExternalModuleImports(
        await readFile(resolve(packageRoot, path), 'utf8'),
      )
      if (imports.length > 0) {
        errors.push(`${label} must not import external modules: ${JSON.stringify(imports)}`)
      }
    } catch (error) {
      errors.push(`${label} is not readable: ${error.message}`)
    }
  }
  return errors
}
