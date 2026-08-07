import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import {
  ASSET_CANVAS_DIRECTORY,
  ASSET_CANVAS_PACKAGE,
  ASSET_CANVAS_VERSION,
  GENERATION_EXPORT,
  createGenerationPackageManifest,
  validateGenerationPackage,
} from './asset-canvas-generation-package.mjs'

// Run after wb-asset-canvas builds. This package copies its reviewed, bundled
// generation facade verbatim and never becomes a second source of implementation.
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDirectory, '..')
const sourceRoot = resolve(packageRoot, '..', 'wb-asset-canvas')
const outputPath = resolve(packageRoot, ASSET_CANVAS_DIRECTORY)

async function main() {
  const sourceManifest = JSON.parse(
    await readFile(resolve(sourceRoot, 'package.json'), 'utf8'),
  )
  if (
    sourceManifest.name !== ASSET_CANVAS_PACKAGE ||
    sourceManifest.version !== ASSET_CANVAS_VERSION ||
    !isDeepStrictEqual(sourceManifest.exports?.['./generation'], GENERATION_EXPORT)
  ) {
    throw new Error(
      `expected ${ASSET_CANVAS_PACKAGE}@${ASSET_CANVAS_VERSION} with the reviewed ./generation export`,
    )
  }

  const vendorRoot = dirname(outputPath)
  await mkdir(vendorRoot, { recursive: true })
  const temporaryRoot = await mkdtemp(
    resolve(vendorRoot, '.generation-package-'),
  )
  try {
    await mkdir(resolve(temporaryRoot, 'dist'))
    await Promise.all([
      copyFile(
        resolve(sourceRoot, 'dist/generation-lib.js'),
        resolve(temporaryRoot, 'dist/generation-lib.js'),
      ),
      copyFile(
        resolve(sourceRoot, 'dist/generation-lib.d.ts'),
        resolve(temporaryRoot, 'dist/generation-lib.d.ts'),
      ),
      writeFile(
        resolve(temporaryRoot, 'package.json'),
        `${JSON.stringify(createGenerationPackageManifest(), null, 2)}\n`,
      ),
    ])
    const errors = await validateGenerationPackage(temporaryRoot)
    if (errors.length > 0) {
      throw new Error(`generated package failed validation:\n${errors.join('\n')}`)
    }

    await rm(outputPath, { recursive: true, force: true })
    await rename(temporaryRoot, outputPath)
    console.log(`Packed ${await realpath(outputPath)}`)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

await main()
