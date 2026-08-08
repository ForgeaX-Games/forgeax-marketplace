import type {
  MediaCapability,
  ModelCapability,
  ServiceCapability,
  VideoGenerationGateway,
} from '@forgeax/workbench-host/contracts'
import type { WorkbenchExtensionContext } from '@forgeax/workbench-host/node'
import { afterEach, describe, expect, test, vi } from 'vitest'
import blueprint from './host/fixtures/nodia.blueprint.json'
import { getAssetIdFromArgs, createWbGameVideoService } from './host/wb-service'
import { host, tools } from './host'

const encoder = new TextEncoder()

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

afterEach(() => vi.restoreAllMocks())

class MemoryFiles {
  readonly entries = new Map<string, Uint8Array>([
    ['blueprint.json', encoder.encode(JSON.stringify(blueprint))],
    ['assets/manifest.json', encoder.encode(JSON.stringify({ version: 2, assets: [] }))],
  ])

  async list(path: string): Promise<string[]> {
    const prefix = `${path.replace(/\/+$/, '')}/`
    return [...new Set([...this.entries.keys()]
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => entry.slice(prefix.length).split('/', 1)[0]!)
      .filter(Boolean))].sort()
  }

  async read(path: string): Promise<Uint8Array | null> {
    const bytes = this.entries.get(path)
    return bytes ? new Uint8Array(bytes) : null
  }

  async write(path: string, contents: Uint8Array): Promise<void> {
    this.entries.set(path, new Uint8Array(contents))
  }

  async delete(path: string): Promise<void> {
    this.entries.delete(path)
  }

  async withLocks<T>(
    _keys: readonly string[],
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation()
  }
}

class TraceMedia implements MediaCapability {
  readonly calls: unknown[] = []

  async list(...args: Parameters<MediaCapability['list']>) {
    this.calls.push(['list', structuredClone(args)])
    return []
  }

  async read(...args: Parameters<MediaCapability['read']>) {
    this.calls.push(['read', structuredClone(args)])
    return null
  }

  async put(
    ...args: Parameters<MediaCapability['put']>
  ): Promise<Awaited<ReturnType<MediaCapability['put']>>> {
    this.calls.push(['put', structuredClone(args)])
    throw new Error('No media writes expected from this parity fixture')
  }

  async delete(...args: Parameters<MediaCapability['delete']>): Promise<void> {
    this.calls.push(['delete', structuredClone(args)])
  }
}

class TraceModels implements ModelCapability {
  readonly calls: unknown[] = []

  async generateText(...args: Parameters<ModelCapability['generateText']>) {
    this.calls.push(['text', structuredClone(args)])
    return { text: '[]', model: 'trace' }
  }

  async generateImage(...args: Parameters<ModelCapability['generateImage']>) {
    this.calls.push(['image', structuredClone(args)])
    return { assets: [], model: 'trace' }
  }

  async generateVideo(...args: Parameters<ModelCapability['generateVideo']>) {
    this.calls.push(['video', structuredClone(args)])
    return { assets: [], model: 'trace' }
  }
}

function createContext() {
  const files = new MemoryFiles()
  const media = new TraceMedia()
  const models = new TraceModels()
  return {
    context: {
      gameId: 'parity-game',
      gameRoot: '/host/parity-game',
      files,
      media,
      models,
      videoGeneration: unavailableVideoGeneration,
      services: unavailableServices,
      capabilities: { async invoke(id: string) {
        if (id === 'media.video.visual-styles.list') return { items: [] }
        throw new Error('Capabilities are unavailable in this test context')
      } },
    } satisfies WorkbenchExtensionContext,
    media,
    models,
  }
}

const manifestTools = [
  ['wb-game-video:get-graph', 'getGraph', {}],
  ['wb-game-video:save-graph', 'saveGraph', { project: blueprint }],
  ['wb-game-video:patch-graph', 'patchGraph', {
    ops: [{
      op: 'set-node-field',
      nodeId: blueprint.graph.nodes[0]!.id,
      field: 'name',
      value: 'Patched opening',
    }],
  }],
  ['wb-game-video:list-videos', 'listVideos', {}],
  ['wb-game-video:generate-shot-script', 'generateShotScript', {
    nodeName: 'Opening', storyText: 'Hero enters',
  }],
  ['wb-game-video:generate-keyframe', 'generateKeyframe', {
    sceneNodeId: 'node-1', nodeName: 'Opening', beat: 'Hero enters',
  }],
  ['wb-game-video:generate-video', 'generateVideo', {
    sceneNodeId: 'node-1', nodeName: 'Opening',
    characterRefIds: ['character-ref'], sceneRefIds: ['scene-ref'],
  }],
  ['wb-game-video:generate-video-clip', 'generateVideoClip', {
    prompt: 'A rainy alley',
  }],
  ['wb-game-video:list-video-visual-styles', 'listVideoVisualStyles', {}],
  ['wb-game-video:generate-node-video', 'generateNodeVideo', {
    sceneNodeId: 'node-1', nodeName: 'Opening',
    characterRefIds: ['character-ref'], sceneRefIds: ['scene-ref'],
  }],
  ['wb-game-video:list-assets', 'listAssets', {}],
  ['wb-game-video:get-asset', 'getAsset', { id: 'missing' }],
  ['wb-game-video:import-character-refs', 'importCharacterRefs', {}],
  ['wb-game-video:import-scene-refs', 'importSceneRefs', {}],
] as const

describe('wb-game-video host module', () => {
  test('exports the manifest-ordered tool map and host integrations', async () => {
    expect(Object.keys(tools)).toEqual(manifestTools.map(([id]) => id))
    expect(host.tools).toBe(tools)
    expect(host.gamePackage).toMatchObject({ platform: 'wb-game-video' })
    expect(await host.gamePackage!.createSeed(createContext().context))
      .toMatchObject({ project: { id: 'parity-game' } })
    await expect(host.gamePackage!.validateSeed({})).rejects.toThrow()
    expect(host.createRouter).toBeTypeOf('function')
  })

  test.each(manifestTools)(
    '%s delegates to its host-context service operation without adapter drift',
    async (toolId, serviceMethod, args) => {
      vi.spyOn(Date, 'now').mockReturnValue(1)
      vi.spyOn(Math, 'random').mockReturnValue(0.25)
      const toolRun = createContext()
      const serviceRun = createContext()

      const actual = await tools[toolId]!(toolRun.context, structuredClone(args))
      const service = createWbGameVideoService(serviceRun.context) as unknown as Record<
        string,
        (input: unknown) => Promise<unknown>
      >
      const expected = serviceMethod === 'getAsset'
        ? await service.getAsset!(getAssetIdFromArgs(args))
        : await service[serviceMethod]!(structuredClone(args))

      expect(actual).toEqual(expected)
      expect(toolRun.media.calls).toEqual(serviceRun.media.calls)
      expect(toolRun.models.calls).toEqual(serviceRun.models.calls)
    },
  )
})
