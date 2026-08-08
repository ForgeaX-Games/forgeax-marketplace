import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import tools from '../server/tool-handlers'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(
  readFileSync(resolve(root, 'forgeax-extension.json'), 'utf8'),
)
const expectedTools = [
  'wb-game-video:get-graph',
  'wb-game-video:save-graph',
  'wb-game-video:patch-graph',
  'wb-game-video:list-videos',
  'wb-game-video:generate-shot-script',
  'wb-game-video:generate-keyframe',
  'wb-game-video:generate-video',
  'wb-game-video:generate-video-clip',
  'wb-game-video:list-video-visual-styles',
  'wb-game-video:generate-node-video',
  'wb-game-video:list-assets',
  'wb-game-video:get-asset',
  'wb-game-video:import-character-refs',
  'wb-game-video:import-scene-refs',
  'wb-game-video:upsert-document',
]
let compiledBackendUrl: string

const forbiddenLegacyHostRoutes = [
  '/__gva__',
  '/__ce-api__',
  '/api/game-host',
  '__video-upload-proxy',
  'FORGEAX_SERVER_PORT',
  '.forgeax/active-game.json',
]

function containsForbiddenLegacyRoute(source: string, route: string): boolean {
  return source.includes(route)
}

// These routes belong to the current main-branch runtime/builders. They are
// intentionally not part of the migration surface being gated here.
const mainOwnedRuntimeFiles = new Set([
  'scripts/build-game-components.mjs',
  'src/runtime/component-host/index.ts',
  'src/runtime/play/GamePlayer.tsx',
])
const releaseGuardFiles = new Set([
  'scripts/check-release.mjs',
])

function productionSourceFiles(directory = root, relativeDirectory = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name
    const absolutePath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (['.git', '.worktrees', 'dist', 'docs', 'node_modules', '.superpowers'].includes(entry.name)) {
        return []
      }
      return productionSourceFiles(absolutePath, relativePath)
    }
    if (
      !entry.isFile()
      || !/\.(?:[cm]?[jt]sx?)$/.test(entry.name)
      || /(?:^|\/)__tests__\//.test(relativePath)
      || /\.test\.[cm]?[jt]sx?$/.test(relativePath)
      || ['server/dev-host.ts', 'vite.config.ts'].includes(relativePath)
      || relativePath.startsWith('src/runtime/sdk/')
      || mainOwnedRuntimeFiles.has(relativePath)
      || releaseGuardFiles.has(relativePath)
    ) {
      return []
    }
    return [relativePath]
  })
}

beforeAll(() => {
  const backendPath = resolve(root, 'dist/server/host.js')
  execFileSync('bun', ['run', 'build:backend'], { cwd: root, stdio: 'pipe' })
  compiledBackendUrl = pathToFileURL(backendPath).href
}, 60_000)

describe('release identity', () => {
  it('keeps legacy Vite-owned host routes out of production runtime source', () => {
    const violations = productionSourceFiles().flatMap((file) => {
      const source = readFileSync(resolve(root, file), 'utf8')
      return forbiddenLegacyHostRoutes
        .filter((route) => containsForbiddenLegacyRoute(source, route))
        .map((route) => `${file}: ${route}`)
    })

    expect(violations).toEqual([])
  })

  it('uses one package, manifest, workbench, skill, and tool namespace', () => {
    expect(pkg.name).toBe('@forgeax-extension/wb-game-video')
    expect(pkg.private).not.toBe(true)
    expect(manifest.id).toBe(pkg.name)
    expect(manifest.version).toBe(pkg.version)
    expect(manifest.provides.workbench.id).toBe('wb-game-video')
    expect(manifest.provides.skills.every(
      (entry: { id: string }) => entry.id.startsWith('wb-game-video:'),
    )).toBe(true)
    expect(manifest.provides.tools.map(
      (entry: { id: string }) => entry.id,
    )).toEqual(expectedTools)
    expect(Object.keys(tools)).toEqual(expectedTools)
  })

  it('pins the exact host dependency and installed extension URL API', () => {
    expect(pkg.peerDependencies['@forgeax/extension-platform']).toBe('0.0.3')
    expect(pkg.devDependencies['@forgeax/extension-platform']).toBe('0.0.3')
    expect(pkg.peerDependencies['@forgeax/workbench-host']).toBe('0.2.6')
    expect(pkg.devDependencies['@forgeax/workbench-host']).toBe('0.2.6')
    expect(pkg.overrides?.['@forgeax/workbench-host']).toBeUndefined()
  })

  it('resolves workbench host from the npm registry with an integrity pin', () => {
    const lock = readFileSync(resolve(root, 'bun.lock'), 'utf8')

    expect(lock).toContain('@forgeax/workbench-host@0.2.6')
    expect(lock).toMatch(/sha512-/)
    expect(lock).not.toMatch(/file:vendor\/forgeax-workbench-host/)
    expect(lock).not.toMatch(/@forgeax\/workbench-host[^\n]*(?:git\+ssh|github\.com|\/Users\/)/)
  })

  it('declares the Host video-generation capability for both generation tools', () => {
    const requiredCapability = [{ id: 'media.video.generate', version: 1 }]
    for (const toolId of [
      'wb-game-video:generate-video',
      'wb-game-video:generate-node-video',
    ]) {
      const tool = manifest.provides.tools.find(
        (entry: { id: string }) => entry.id === toolId,
      )
      expect(tool?.requiresCapabilities).toEqual(requiredCapability)
    }
  })

  it('exports the compiled host module with the declared tool map', async () => {
    expect(pkg.exports['.']).toBe('./dist/index.js')
    expect(pkg.exports['./host']).toBe('./dist/server/host.js')
    expect(pkg.exports['./standalone']).toBe('./dist/standalone/wb-game-video.html')
    expect(manifest.entry.backend).toBe('./dist/server/host.js')

    const backend = await import(compiledBackendUrl)
    expect(backend.host).toBeDefined()
    expect(Object.keys(backend.tools)).toEqual(expectedTools)
  })

  it('loads the compiled host module in Node ESM', () => {
    expect(() => execFileSync('node', [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(compiledBackendUrl)})`,
    ], { cwd: root, stdio: 'pipe' })).not.toThrow()
  })

  it('excludes the vendored development bootstrap from the published package', () => {
    expect(pkg.files).toEqual([
      'dist',
      'forgeax-extension.json',
      'schemas',
      'README.md',
      'SKILL.md',
      '!**/*.mp4',
      '!**/*.map',
      '!dist/HYShangWei-*.woff2',
      '!dist/**/*.map',
    ])
    expect(pkg.files).not.toContain('vendor')
  })

  it('publishes the canonical independent repository URL', () => {
    expect(pkg.repository).toEqual({
      type: 'git',
      url: 'git+https://github.com/ForgeaX-Games/forgeax-wb-game-video.git',
    })
  })

  it('keeps public persistence and generation documentation aligned with runtime behavior', () => {
    const surfaces = [
      'README.md',
      'SKILL.md',
      'AGENTS.md',
      'forgeax-extension.json',
      'schemas/save-graph.args.json',
      'schemas/save-graph.returns.json',
      'server/tool-handlers.ts',
    ]
    const contract = surfaces
      .map((file) => readFileSync(resolve(root, file), 'utf8'))
      .join('\n')

    expect(contract).not.toMatch(/scenarios\.graph\.json/)
    expect(contract).not.toMatch(/版本快照|version snapshot|keep-10|留\s*10|up to 10/i)
    expect(contract).not.toMatch(/\.forgeax\/games\/<slug>\/game-video/)
    expect(contract).not.toMatch(/(视频生成|video generation|generation).{0,24}(已删|deleted)/i)
    expect(contract).not.toContain('.forgeax/games/<slug>/blueprint.json')
    expect(contract).toContain('blueprint.json')
    expect(contract).toContain('wb-game-video:generate-node-video')
    expect(contract).toContain('wb-game-video:import-scene-refs')
  })

  it('derives game identity from the host binding for every public tool', () => {
    expect(manifest.provides.tools).toHaveLength(15)

    for (const tool of manifest.provides.tools) {
      const schemaPath = resolve(root, tool.args)
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
      expect(schema.properties ?? {}, tool.id).not.toHaveProperty('gameSlug')
      expect(schema.required ?? [], tool.id).not.toContain('gameSlug')
    }
  })

  it('declares logical game-root access and only runtime-used env keys', () => {
    const fsPermissions = manifest.permissions.filter((entry: string) =>
      entry.startsWith('fs:'),
    )
    expect(fsPermissions).toEqual([
      'fs:read:{gameRoot}/blueprint.json',
      'fs:write:{gameRoot}/blueprint.json',
      'fs:read:{gameRoot}/project.json',
      'fs:write:{gameRoot}/project.json',
      'fs:read:{gameRoot}/assets/**',
      'fs:write:{gameRoot}/assets/**',
      'fs:read:{gameRoot}/docs/**',
      'fs:write:{gameRoot}/docs/**',
      'fs:read:{gameRoot}/characters/**',
      'fs:read:{gameRoot}/textures/**',
    ])
    expect(manifest.permissions.some((entry: string) => entry.startsWith('emit:')))
      .toBe(false)
    expect(manifest.requestedEnv).toEqual([])
  })
})
