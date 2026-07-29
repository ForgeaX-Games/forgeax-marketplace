import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginApps = [
  'wb-2d-scene-asset-generator',
  'wb-3d-lowpoly',
  'wb-scene-generator',
]

test('standalone plugin manifests resolve node-runtime without a workspace protocol', async () => {
  for (const appName of pluginApps) {
    const appRoot = join(repoRoot, 'apps', appName)
    const manifest = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
    const runtimeSpec = manifest.dependencies?.['@forgeax/node-runtime']

    assert.equal(
      runtimeSpec,
      'file:../../packages/node-runtime',
      `${appName} must resolve the in-repository runtime when Studio installs the plugin directly`,
    )
    assert.equal(
      JSON.parse(await readFile(resolve(appRoot, runtimeSpec.slice('file:'.length), 'package.json'), 'utf8')).name,
      '@forgeax/node-runtime',
      `${appName} runtime dependency must target the node-runtime package`,
    )
  }
})
