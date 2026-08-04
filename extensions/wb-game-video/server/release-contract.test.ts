import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import tools from '../server/tool-handlers'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(
  readFileSync(resolve(root, 'forgeax-extension.json'), 'utf8'),
)
const expectedTools = [
  'wb-game-video:get-graph',
  'wb-game-video:save-graph',
  'wb-game-video:list-videos',
  'wb-game-video:generate-shot-script',
  'wb-game-video:generate-keyframe',
  'wb-game-video:generate-video',
  'wb-game-video:generate-node-video',
  'wb-game-video:list-assets',
  'wb-game-video:get-asset',
  'wb-game-video:import-character-refs',
  'wb-game-video:import-scene-refs',
]

describe('release identity', () => {
  it('uses one package, manifest, workbench, skill, and tool namespace', () => {
    expect(pkg.name).toBe('@forgeax-extension/wb-game-video')
    expect(pkg.version).toBe('0.1.5')
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

  it('declares the host platform as an exact peer and dev dependency', () => {
    expect(pkg.peerDependencies['@forgeax/extension-platform']).toBe('0.0.2')
    expect(pkg.devDependencies['@forgeax/extension-platform']).toBe('0.0.2')
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
    expect(contract).toContain('.forgeax/games/<slug>/blueprint.json')
    expect(contract).toContain('wb-game-video:generate-node-video')
    expect(contract).toContain('wb-game-video:import-scene-refs')
  })

  it('uses the same safe Unicode game-id contract in every tool args schema', () => {
    const schemaFiles = [
      'generate-keyframe.args.json',
      'generate-node-video.args.json',
      'generate-shot-script.args.json',
      'generate-video.args.json',
      'get-asset.args.json',
      'get-graph.args.json',
      'import-character-refs.args.json',
      'import-scene-refs.args.json',
      'list-assets.args.json',
      'save-graph.args.json',
    ]

    for (const file of schemaFiles) {
      const schema = JSON.parse(readFileSync(resolve(root, 'schemas', file), 'utf8'))
      const gameSlug = schema.properties.gameSlug
      const pattern = new RegExp(gameSlug.pattern)
      expect(pattern.test('中'), file).toBe(true)
      expect(pattern.test('a'), file).toBe(true)
      expect(pattern.test(''), file).toBe(false)
      expect(pattern.test('.'), file).toBe(false)
      expect(pattern.test('..'), file).toBe(false)
      expect(pattern.test('a/b'), file).toBe(false)
      expect(pattern.test('a\\b'), file).toBe(false)
      expect(gameSlug.description, file).toContain('host-bound game')
      expect(gameSlug.description, file).not.toMatch(/active game|active-game/)
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
      'fs:read:{gameRoot}/characters/**',
      'fs:read:{gameRoot}/textures/**',
    ])
    expect(manifest.permissions.some((entry: string) => entry.startsWith('emit:')))
      .toBe(false)
    expect(manifest.requestedEnv).toEqual([
      'FORGEAX_SERVER_URL',
      'FORGEAX_SERVER_PORT',
    ])
  })
})
