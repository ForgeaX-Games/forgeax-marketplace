import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { validateRelease } from '../scripts/check-release.mjs'

const fixtureBase = mkdtempSync(resolve(import.meta.dirname, '.check-release-'))
const toolId = 'wb-game-video:get-graph'
const oldToolId = ['gv', 'id:get-graph'].join('')
const oldStorageKey = ['game', 'video:graph:view'].join('')
const oldDottedStorageKey = ['gv', 'id.nodePanel.previewW'].join('')
const oldBrandName = ['reel', 'studio'].join('-')

interface FixtureOptions {
  backendKeys?: string[]
  malformedManifest?: boolean
  malformedPackage?: boolean
  manifestVersion?: string
  missingBackend?: boolean
  missingReturns?: boolean
  packageName?: string
  platformVersion?: string
  oldIdentityDistSource?: string
  oldIdentityFiles?: Record<string, string>
  oldIdentitySource?: string
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function createFixture(name: string, options: FixtureOptions = {}): string {
  const root = resolve(fixtureBase, name)
  mkdirSync(resolve(root, 'dist/assets'), { recursive: true })
  mkdirSync(resolve(root, 'dist/server'), { recursive: true })
  mkdirSync(resolve(root, 'schemas'), { recursive: true })
  mkdirSync(resolve(root, 'docs'), { recursive: true })
  mkdirSync(resolve(root, 'src/__tests__'), { recursive: true })

  if (options.malformedPackage) {
    writeFileSync(resolve(root, 'package.json'), '{ invalid package JSON\n')
  } else {
    writeJson(resolve(root, 'package.json'), {
      name: options.packageName ?? '@forgeax/wb-game-video',
      version: '0.1.2',
      peerDependencies: {
        '@forgeax/extension-platform': options.platformVersion ?? '0.0.2',
      },
      devDependencies: {
        '@forgeax/extension-platform': options.platformVersion ?? '0.0.2',
      },
    })
  }
  if (options.malformedManifest) {
    writeFileSync(resolve(root, 'forgeax-extension.json'), '{ invalid manifest JSON\n')
  } else {
    writeJson(resolve(root, 'forgeax-extension.json'), {
      id: '@forgeax/wb-game-video',
      version: options.manifestVersion ?? '0.1.2',
      entry: {
        frontend: './dist/index.html',
        backend: './dist/server/tool-handlers.js',
      },
      provides: {
        skills: [
          {
            id: 'wb-game-video:author-guide',
            entry: './SKILL.md',
          },
        ],
        tools: [
          {
            id: toolId,
            args: './schemas/get-graph.args.json',
            returns: './schemas/get-graph.returns.json',
          },
        ],
      },
    })
  }
  writeFileSync(resolve(root, 'dist/index.html'), '<!doctype html>\n')
  writeFileSync(resolve(root, 'SKILL.md'), '# Author guide\n')
  writeJson(resolve(root, 'schemas/get-graph.args.json'), { type: 'object' })
  if (!options.missingReturns) {
    writeJson(resolve(root, 'schemas/get-graph.returns.json'), { type: 'object' })
  }
  if (!options.missingBackend) {
    const keys = options.backendKeys ?? [toolId]
    writeFileSync(
      resolve(root, 'dist/server/tool-handlers.js'),
      `export default {${keys.map((key) => `${JSON.stringify(key)}: async () => ({})`).join(',')}}\n`,
    )
  }

  // Historical prose and the one-time migration are allowed to name legacy IDs.
  writeFileSync(resolve(root, 'docs/history.md'), `${oldToolId}\n`)
  writeFileSync(
    resolve(root, 'src/bootMigrateLegacyKeys.ts'),
    `${JSON.stringify(oldStorageKey)}\n`,
  )
  writeFileSync(
    resolve(root, 'src/__tests__/bootMigrateLegacyKeys.test.ts'),
    `${JSON.stringify(oldToolId)}\n`,
  )
  writeFileSync(
    resolve(root, 'dist/assets/migration.js'),
    `const prefixes = [${JSON.stringify(oldBrandName)}, ${JSON.stringify(['game', 'video'].join(''))}, ${JSON.stringify(['gv', 'id'].join(''))}]\n`,
  )
  if (options.oldIdentityDistSource) {
    writeFileSync(resolve(root, 'dist/assets/stale.js'), options.oldIdentityDistSource)
  }
  if (options.oldIdentitySource) {
    writeFileSync(resolve(root, 'src/active.ts'), options.oldIdentitySource)
  }
  for (const [path, source] of Object.entries(options.oldIdentityFiles ?? {})) {
    mkdirSync(resolve(root, dirname(path)), { recursive: true })
    writeFileSync(resolve(root, path), source)
  }

  return root
}

afterAll(() => {
  rmSync(fixtureBase, { recursive: true, force: true })
})

describe('validateRelease', () => {
  it('accepts a complete self-contained release package', async () => {
    const fixtureRoot = createFixture('valid')

    expect(await validateRelease(fixtureRoot)).toEqual([])
  })

  it('accumulates missing release entries without importing a missing backend', async () => {
    const missingBackendRoot = createFixture('missing-backend', {
      missingBackend: true,
      missingReturns: true,
    })

    const errors = await validateRelease(missingBackendRoot)
    expect(errors).toContainEqual(expect.stringContaining('entry.backend'))
    expect(errors).toContainEqual(expect.stringContaining('returns'))
  })

  it('still validates manifest paths when package JSON is malformed', async () => {
    const malformedPackageRoot = createFixture('malformed-package', {
      malformedPackage: true,
      missingBackend: true,
      missingReturns: true,
    })

    const errors = await validateRelease(malformedPackageRoot)
    expect(errors).toContainEqual(expect.stringContaining('package.json is not readable JSON'))
    expect(errors).toContainEqual(expect.stringContaining('entry.backend'))
    expect(errors).toContainEqual(expect.stringContaining('returns'))
  })

  it('still validates package identity and dependencies when manifest JSON is malformed', async () => {
    const malformedManifestRoot = createFixture('malformed-manifest', {
      malformedManifest: true,
      packageName: '@forgeax/wb-game-video-invalid',
      platformVersion: '0.0.1',
    })

    const errors = await validateRelease(malformedManifestRoot)
    expect(errors).toContainEqual(expect.stringContaining('forgeax-extension.json is not readable JSON'))
    expect(errors).toContainEqual(expect.stringContaining('package name'))
    expect(errors).toContainEqual(expect.stringContaining('peerDependencies'))
    expect(errors).toContainEqual(expect.stringContaining('devDependencies'))
  })

  it('reports the package-derived tag when manifest version differs', async () => {
    const badVersionRoot = createFixture('bad-version', {
      manifestVersion: '0.2.0',
    })

    expect(await validateRelease(badVersionRoot)).toContainEqual(
      expect.stringContaining('v0.1.2'),
    )
  })

  it('rejects compiled handlers that differ from manifest tool order', async () => {
    const badToolRoot = createFixture('bad-tools', {
      backendKeys: ['wb-game-video:save-graph'],
    })

    expect(await validateRelease(badToolRoot)).toContainEqual(
      expect.stringContaining('handler keys'),
    )
  })

  it('rejects legacy active identities outside historical and migration files', async () => {
    const oldIdentityRoot = createFixture('old-identity', {
      oldIdentitySource: `export const tool = ${JSON.stringify(oldToolId)}\n`,
    })

    expect(await validateRelease(oldIdentityRoot)).toContainEqual(
      expect.stringContaining('old active identity'),
    )
  })

  it('rejects legacy active identities in tracked dist files', async () => {
    const oldIdentityRoot = createFixture('old-dist-identity', {
      oldIdentityDistSource: `export const tool = ${JSON.stringify(oldToolId)}\n`,
    })

    expect(await validateRelease(oldIdentityRoot)).toContainEqual(
      expect.stringContaining('dist/assets/stale.js'),
    )
  })

  it('rejects a dotted legacy browser-key namespace', async () => {
    const oldIdentityRoot = createFixture('old-dotted-gvid', {
      oldIdentitySource: `export const key = ${JSON.stringify(oldDottedStorageKey)}\n`,
    })

    expect(await validateRelease(oldIdentityRoot)).toContainEqual(
      expect.stringContaining('src/active.ts'),
    )
  })

  it.each([
    ['bun.lock', `"name": ${JSON.stringify(oldBrandName)}\n`],
    ['server/engine/llm/skills/README.md', `# ${oldBrandName} Prompt Skills\n`],
  ])('rejects legacy package branding in %s', async (path, source) => {
    const oldIdentityRoot = createFixture(`old-brand-${path.replaceAll('/', '-')}`, {
      oldIdentityFiles: { [path]: source },
    })

    expect(await validateRelease(oldIdentityRoot)).toContainEqual(
      expect.stringContaining(path),
    )
  })

  it('allows legacy names only in the exact migration and historical-doc exemptions', async () => {
    const migrationRoot = createFixture('migration-exemptions')

    expect(await validateRelease(migrationRoot)).toEqual([])
  })
})
