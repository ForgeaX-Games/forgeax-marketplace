import type { WorkbenchExtensionContext } from '@forgeax/workbench-host/node'
import type { ServiceCapability, VideoGenerationGateway } from '@forgeax/workbench-host/contracts'
import { describe, expect, test } from 'vitest'
import { makeNodiaDemo } from '../src/editor/demo/demo'
import tools from './tool-handlers'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const unavailableVideoGeneration: VideoGenerationGateway = {
  async start() { throw new Error('Video generation is unavailable in this test context') },
  async get() { throw new Error('Video generation is unavailable in this test context') },
  async cancel() { throw new Error('Video generation is unavailable in this test context') },
  async generateVideo() { throw new Error('Video generation is unavailable in this test context') },
}

const unavailableServices: ServiceCapability = {
  async scope() { throw new Error('Services are unavailable in this test context') },
  async request() { throw new Error('Services are unavailable in this test context') },
  async stageMedia() { throw new Error('Services are unavailable in this test context') },
}

function createContext(gameId = 'contract-game') {
  const entries = new Map<string, Uint8Array>([
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
  ])
  const context: WorkbenchExtensionContext = {
    gameId,
    gameRoot: '/host/injected-game-root',
    files: {
      async list(path) {
        const prefix = `${path.replace(/\/+$/, '')}/`
        return [...new Set([...entries.keys()]
          .filter((entry) => entry.startsWith(prefix))
          .map((entry) => entry.slice(prefix.length).split('/', 1)[0]!)
          .filter(Boolean))].sort()
      },
      async read(path) {
        const bytes = entries.get(path)
        return bytes ? new Uint8Array(bytes) : null
      },
      async write(path, bytes) {
        entries.set(path, new Uint8Array(bytes))
      },
      async delete(path) {
        entries.delete(path)
      },
      async withLocks(_keys, operation) {
        return operation()
      },
    },
    media: {
      async list() { return [] },
      async read() { return null },
      async put() { throw new Error('not needed by graph contract') },
      async delete() {},
    },
    models: {
      async generateText() { throw new Error('not needed by graph contract') },
      async generateImage() { throw new Error('not needed by graph contract') },
      async generateVideo() { throw new Error('not needed by graph contract') },
    },
    videoGeneration: unavailableVideoGeneration,
    services: unavailableServices,
    capabilities: { async invoke() { throw new Error('Capabilities are unavailable in this test context') } },
  }
  return { context, entries }
}

describe('host tool context contract', () => {
  test('persists graph data only through its injected bounded host context', async () => {
    const { context, entries } = createContext()
    const project = makeNodiaDemo()

    await expect(tools['wb-game-video:save-graph']!(
      context,
      { project, title: 'must not create a snapshot' },
    )).resolves.toEqual({ ok: true, versions: [], gameSlug: 'contract-game' })
    expect(JSON.parse(decoder.decode(entries.get('blueprint.json')))).toEqual(project)
  })

  test('lists extension-owned bundled media without a filesystem host field', async () => {
    const { context } = createContext()

    await expect(tools['wb-game-video:list-videos']!(context, {})).resolves.toMatchObject({
      videos: expect.arrayContaining(['idle01']),
    })
  })

  test('uses the injected game binding, including Unicode and single-character ids', async () => {
    for (const gameId of ['中', 'a']) {
      const { context } = createContext(gameId)
      await expect(tools['wb-game-video:get-graph']!(
        context,
        {},
      )).resolves.toMatchObject({ gameSlug: gameId })
    }
  })

  test('rejects host-specific path and caller-selected game fields', async () => {
    const { context } = createContext('bound')

    await expect(tools['wb-game-video:get-graph']!(
      context,
      { cwd: '/private/secret' },
    )).rejects.toThrow('additional properties')
    await expect(tools['wb-game-video:get-graph']!(
      context,
      { gameSlug: 'other' },
    )).rejects.toThrow('additional properties')
    await expect(tools['wb-game-video:generate-video-clip']!(
      context,
      { gameSlug: 'other', prompt: 'A rainy alley', mode: 't2v' },
    )).rejects.toThrow('additional properties')
  })
})
