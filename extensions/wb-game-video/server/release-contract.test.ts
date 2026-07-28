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
    expect(pkg.name).toBe('@forgeax/wb-game-video')
    expect(pkg.version).toBe('0.1.2')
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
})
