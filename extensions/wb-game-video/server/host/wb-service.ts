import type { WorkbenchExtensionContext } from '@forgeax/workbench-host/node'
import type { GraphLibraryDocument } from '../../src/runtime/schema/graph-schema'
import type {
  MediaKind,
  MediaProductionType,
  StyleAxes,
} from '../../src/editor/assets/registry-types'
import {
  normalizeDocument,
  validateDocument,
} from '../../src/editor/persist/blueprint-project'
import {
  createHostAssetRegistry,
  sanitizePublicText,
  type AssetFilter,
} from '../asset-registry'
import {
  createHostGenerationOrchestrator,
  type KeyframeInput,
  type VideoGenInput,
} from '../generation/orchestrate'
import { generateVideoClip, type GenerateVideoClipArgs } from '../generation/clip'
import {
  importCharacterRefsFromHost,
  importSceneRefsFromHost,
} from '../intake'
import {
  validateServiceInput,
  type ServiceSchemaName,
} from './service-validation'
import { NODIA_ASSETS_MANIFEST } from './nodia-assets'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const BLUEPRINT_FILE = 'blueprint.json'
const PROJECT_FILE = 'project.json'
const GRAPH_SAVE_LOCK = 'wb-game-video-graph-save'

export class WbServiceInputError extends TypeError {
  readonly code = 'invalid_input'
}

export interface WbGameVideoService {
  getGraph(input?: unknown): Promise<unknown>
  saveGraph(input: unknown): Promise<unknown>
  listVideos(input: unknown): Promise<unknown>
  listAssets(query: unknown): Promise<unknown>
  getAsset(assetId: string): Promise<unknown>
  importCharacterRefs(input: unknown): Promise<unknown>
  importSceneRefs(input: unknown): Promise<unknown>
  generateShotScript(input: unknown): Promise<unknown>
  generateKeyframe(input: unknown): Promise<unknown>
  generateVideo(input: unknown): Promise<unknown>
  generateVideoClip(input: unknown): Promise<unknown>
  generateNodeVideo(input: unknown): Promise<unknown>
}

function assertSchema(schema: ServiceSchemaName, value: unknown): void {
  const errors = validateServiceInput(schema, value)
  if (errors.length) throw new WbServiceInputError(errors.join('; '))
}

function publicErrorMessage(error: unknown): string {
  const raw = error instanceof Error && typeof error.message === 'string'
    ? error.message
    : 'Operation failed'
  return sanitizePublicText(raw).slice(0, 400)
}

function record(value: unknown, label = 'Input'): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new WbServiceInputError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function stringValue(
  value: unknown,
  name: string,
  required = false,
): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new WbServiceInputError(`${name} must be a non-empty string`)
  }
  return value
}

function numberValue(
  value: unknown,
  name: string,
  fallback: number,
  maximum = Number.POSITIVE_INFINITY,
): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new WbServiceInputError(`${name} must be a positive number`)
  }
  if (value > maximum) {
    throw new WbServiceInputError(`${name} must be at most ${maximum}`)
  }
  return value
}

function stringArray(value: unknown, name: string, minimum = 0): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new WbServiceInputError(`${name} must be an array of strings`)
  }
  const result = value.filter(Boolean)
  if (result.length < minimum) {
    throw new WbServiceInputError(`${name} must contain at least ${minimum} item`)
  }
  return result
}

function assertLogicalIdentifier(value: string, label: string): string {
  if (
    value === '.'
    || value === '..'
    || value.includes('/')
    || value.includes('\\')
    || /^(?:\/|[A-Za-z]:[\\/])/.test(value)
  ) {
    throw new WbServiceInputError(`${label} must be a relative identifier`)
  }
  return value
}

/**
 * Tool/router adapter for the published get-asset object schema. The business
 * service itself keeps the established `getAsset(assetId)` interface.
 */
export function getAssetIdFromArgs(value: unknown): string {
  assertSchema('getAsset', value)
  const input = record(value)
  return assertLogicalIdentifier(
    stringValue(input.id, 'id', true)!,
    'assetId',
  )
}

function assertOnlyKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed)
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new WbServiceInputError('Input contains unsupported path or selector fields')
  }
}

function optionalStyleAxes(value: unknown): StyleAxes | undefined {
  if (value === undefined) return undefined
  const input = record(value, 'styleAxes')
  assertOnlyKeys(input, ['artMedia', 'director', 'filmLook'])
  const axes: StyleAxes = {}
  const artMedia = stringValue(input.artMedia, 'styleAxes.artMedia')
  const director = stringValue(input.director, 'styleAxes.director')
  const filmLook = stringValue(input.filmLook, 'styleAxes.filmLook')
  if (artMedia !== undefined) axes.artMedia = artMedia
  if (director !== undefined) axes.director = director
  if (filmLook !== undefined) axes.filmLook = filmLook
  return Object.keys(axes).length > 0 ? axes : undefined
}

function perspective(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (value === 'first') return '第一人称'
  if (value === 'third') return '第三人称'
  throw new WbServiceInputError('perspective must be first or third')
}

function characters(value: unknown): Array<{ name: string; appearance?: string }> | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new WbServiceInputError('characters must be an array')
  }
  return value.map((item) => {
    const input = record(item, 'character')
    assertOnlyKeys(input, ['name', 'desc'])
    const name = stringValue(input.name, 'character.name', true)!
    const description = stringValue(input.desc, 'character.desc')
    return description ? { name, appearance: description } : { name }
  })
}

function projectMetadata(gameId: string): Record<string, unknown> {
  return {
    id: gameId,
    title: gameId,
    platform: 'wb-game-video',
    platformVersion: '1',
    entry: {
      blueprint: BLUEPRINT_FILE,
      components: 'dist/components',
    },
  }
}

function parseGraph(bytes: Uint8Array | null): GraphLibraryDocument | null {
  if (!bytes) return null
  try {
    return normalizeDocument(
      JSON.parse(decoder.decode(bytes)) as GraphLibraryDocument,
    )
  } catch {
    return null
  }
}

function shotScriptInput(value: unknown) {
  const input = record(value)
  assertOnlyKeys(input, [
    'sceneNodeId', 'nodeName', 'storyText', 'durationSeconds',
    'artStyle', 'styleKeywords', 'perspective', 'tone', 'characters',
    'location', 'interactive', 'choiceCount', 'styleAxes',
  ])
  if (input.interactive !== undefined && typeof input.interactive !== 'boolean') {
    throw new WbServiceInputError('interactive must be a boolean')
  }
  return {
    nodeName: stringValue(input.nodeName, 'nodeName', true)!,
    storyText: stringValue(input.storyText, 'storyText', true)!,
    durationSeconds: numberValue(input.durationSeconds, 'durationSeconds', 8, 60),
    artStyle: stringValue(input.artStyle, 'artStyle'),
    styleKeywords: stringArray(input.styleKeywords, 'styleKeywords'),
    perspective: perspective(input.perspective),
    tone: stringValue(input.tone, 'tone'),
    characters: characters(input.characters),
    location: stringValue(input.location, 'location'),
    choicesLength: input.choiceCount === undefined
      ? input.interactive === true ? 2 : undefined
      : numberValue(input.choiceCount, 'choiceCount', 2),
    styleAxes: optionalStyleAxes(input.styleAxes),
  }
}

function keyframeInput(value: unknown): KeyframeInput {
  const input = record(value)
  assertOnlyKeys(input, [
    'sceneNodeId', 'nodeName', 'beat', 'variant', 'perspective',
    'characters', 'location', 'refAssetIds', 'label', 'styleAxes', 'mode', 'grid',
  ])
  const mode = input.mode
  if (mode !== undefined && mode !== 'keyframe' && mode !== 'grid_storyboard') {
    throw new WbServiceInputError('mode must be keyframe or grid_storyboard')
  }
  const variant = input.variant
  if (
    variant !== undefined
    && variant !== 'video_first_frame'
    && variant !== 'choice_pressure_frame'
  ) {
    throw new WbServiceInputError('variant is invalid')
  }
  return {
    sceneNodeId: stringValue(input.sceneNodeId, 'sceneNodeId', true)!,
    nodeName: stringValue(input.nodeName, 'nodeName', true)!,
    beat: stringValue(input.beat, 'beat', true)!,
    variant,
    perspective: perspective(input.perspective),
    characters: characters(input.characters),
    location: stringValue(input.location, 'location'),
    refAssetIds: stringArray(input.refAssetIds, 'refAssetIds')
      .map((id) => assertLogicalIdentifier(id, 'refAssetIds item')),
    label: stringValue(input.label, 'label'),
    styleAxes: optionalStyleAxes(input.styleAxes),
    mode,
    grid: input.grid === undefined ? undefined : (() => {
      const grid = record(input.grid, 'grid')
      assertOnlyKeys(grid, [
        'panelLabels', 'nodeRole', 'endingKind', 'choiceRevealMoment',
        'atmosphereOverride', 'nodeTimeOfDay',
      ])
      if (grid.panelLabels !== undefined && typeof grid.panelLabels !== 'boolean') {
        throw new WbServiceInputError('grid.panelLabels must be a boolean')
      }
      return grid as KeyframeInput['grid']
    })(),
  }
}

function videoClipInput(value: unknown): GenerateVideoClipArgs {
  const input = record(value)
  assertOnlyKeys(input, [
    'prompt', 'durationSeconds', 'generateAudio', 'mode',
    'firstFrameAssetId', 'lastFrameAssetId', 'referenceImageAssetIds',
    'label', 'requestId',
  ])
  return {
    prompt: stringValue(input.prompt, 'prompt', true)!,
    durationSeconds: numberValue(input.durationSeconds, 'durationSeconds', 8, 15),
    generateAudio: input.generateAudio === true,
    mode: input.mode as GenerateVideoClipArgs['mode'],
    firstFrameAssetId: stringValue(input.firstFrameAssetId, 'firstFrameAssetId'),
    lastFrameAssetId: stringValue(input.lastFrameAssetId, 'lastFrameAssetId'),
    referenceImageAssetIds: input.referenceImageAssetIds === undefined
      ? undefined
      : stringArray(input.referenceImageAssetIds, 'referenceImageAssetIds'),
    label: stringValue(input.label, 'label'),
    requestId: stringValue(input.requestId, 'requestId'),
  }
}

function videoInput(value: unknown, maximumDuration: number): VideoGenInput {
  const input = record(value)
  assertOnlyKeys(input, [
    'sceneNodeId', 'nodeName', 'seedancePrompt', 'storyText',
    'durationSeconds', 'artStyle', 'styleKeywords', 'characterRefIds',
    'sceneRefIds', 'continuityFirstFrameId', 'label', 'generateAudio',
    'styleAxes', 'extend', 'transitionHint',
  ])
  for (const name of ['generateAudio', 'extend'] as const) {
    if (input[name] !== undefined && typeof input[name] !== 'boolean') {
      throw new WbServiceInputError(`${name} must be a boolean`)
    }
  }
  return {
    sceneNodeId: stringValue(input.sceneNodeId, 'sceneNodeId', true)!,
    nodeName: stringValue(input.nodeName, 'nodeName', true)!,
    seedancePrompt: stringValue(input.seedancePrompt, 'seedancePrompt'),
    storyText: stringValue(input.storyText, 'storyText'),
    durationSeconds: numberValue(
      input.durationSeconds,
      'durationSeconds',
      8,
      maximumDuration,
    ),
    artStyle: stringValue(input.artStyle, 'artStyle'),
    styleKeywords: stringArray(input.styleKeywords, 'styleKeywords'),
    characterRefIds: stringArray(input.characterRefIds, 'characterRefIds', 1)
      .map((id) => assertLogicalIdentifier(id, 'characterRefIds item')),
    sceneRefIds: stringArray(input.sceneRefIds, 'sceneRefIds', 1)
      .map((id) => assertLogicalIdentifier(id, 'sceneRefIds item')),
    continuityFirstFrameId: input.continuityFirstFrameId === undefined
      ? undefined
      : assertLogicalIdentifier(
          stringValue(input.continuityFirstFrameId, 'continuityFirstFrameId', true)!,
          'continuityFirstFrameId',
        ),
    label: stringValue(input.label, 'label'),
    generateAudio: input.generateAudio === true,
    styleAxes: optionalStyleAxes(input.styleAxes),
    extend: input.extend === true,
    transitionHint: stringValue(input.transitionHint, 'transitionHint'),
  }
}

export function createWbGameVideoService(
  context: WorkbenchExtensionContext,
): WbGameVideoService {
  const registry = createHostAssetRegistry(context)
  const generation = createHostGenerationOrchestrator(context, registry)

  return {
    async getGraph(value = {}) {
      assertSchema('getGraph', value)
      record(value)
      const [blueprint] = await Promise.all([
        context.files.read(BLUEPRINT_FILE),
        context.files.read(PROJECT_FILE),
      ])
      return {
        project: parseGraph(blueprint),
        gameSlug: context.gameId,
      }
    },
    async saveGraph(value) {
      assertSchema('saveGraph', value)
      const input = record(value)
      if (input.project === undefined) {
        return { ok: false, errors: ['缺少 project'] }
      }
      let project: GraphLibraryDocument
      try {
        project = normalizeDocument(input.project as GraphLibraryDocument)
      } catch (error) {
        return { ok: false, errors: [(error as Error).message], gameSlug: context.gameId }
      }
      const errors = validateDocument(project)
      if (errors.length) return { ok: false, errors, gameSlug: context.gameId }
      await context.files.withLocks([GRAPH_SAVE_LOCK], async () => {
        await context.files.write(
          BLUEPRINT_FILE,
          encoder.encode(JSON.stringify(project, null, 2)),
        )
        if (!await context.files.read(PROJECT_FILE)) {
          await context.files.write(
            PROJECT_FILE,
            encoder.encode(JSON.stringify(projectMetadata(context.gameId), null, 2)),
          )
        }
      })
      return { ok: true, versions: [], gameSlug: context.gameId }
    },
    async listVideos(value) {
      assertSchema('listVideos', value)
      record(value)
      return {
        videos: NODIA_ASSETS_MANIFEST.assets.map((asset) => asset.id),
      }
    },
    async listAssets(value) {
      assertSchema('listAssets', value)
      const input = record(value)
      const filter: AssetFilter = {}
      if (input.kind !== undefined) {
        if (!['image', 'video', 'audio'].includes(String(input.kind))) {
          throw new WbServiceInputError('kind is invalid')
        }
        filter.kind = input.kind as MediaKind
      }
      if (input.productionType !== undefined) {
        if (![
          'character_ref',
          'scene_ref',
          'shot_image',
          'grid_storyboard',
          'video_clip',
        ].includes(String(input.productionType))) {
          throw new WbServiceInputError('productionType is invalid')
        }
        filter.productionType = input.productionType as MediaProductionType
      }
      if (input.sceneNodeId !== undefined) {
        filter.sceneNodeId = stringValue(input.sceneNodeId, 'sceneNodeId', true)
      }
      return { assets: await registry.list(filter) }
    },
    async getAsset(value) {
      const id = assertLogicalIdentifier(
        stringValue(value, 'assetId', true)!,
        'assetId',
      )
      return { asset: await registry.get(id) }
    },
    async importCharacterRefs(value) {
      assertSchema('importCharacterRefs', value)
      const input = record(value)
      assertOnlyKeys(input, [])
      try {
        return { refs: await importCharacterRefsFromHost(context, registry) }
      } catch (error) {
        return { refs: [], error: publicErrorMessage(error) }
      }
    },
    async importSceneRefs(value) {
      assertSchema('importSceneRefs', value)
      const input = record(value)
      assertOnlyKeys(input, [])
      try {
        return { refs: await importSceneRefsFromHost(context, registry) }
      } catch (error) {
        return { refs: [], error: publicErrorMessage(error) }
      }
    },
    async generateShotScript(value) {
      assertSchema('generateShotScript', value)
      const input = shotScriptInput(value)
      try {
        return { shots: await generation.generateShotScript(input) }
      } catch (error) {
        return { shots: [], error: publicErrorMessage(error) }
      }
    },
    async generateKeyframe(value) {
      assertSchema('generateKeyframe', value)
      const input = keyframeInput(value)
      try {
        return { asset: await generation.generateKeyframe(input) }
      } catch (error) {
        return { asset: null, error: publicErrorMessage(error) }
      }
    },
    async generateVideo(value) {
      assertSchema('generateVideo', value)
      const input = videoInput(value, 60)
      try {
        return { asset: await generation.generateVideo(input) }
      } catch (error) {
        return { asset: null, error: publicErrorMessage(error) }
      }
    },
    async generateVideoClip(value) {
      assertSchema('generateVideoClip', value)
      return generateVideoClip(context, videoClipInput(value), registry)
    },
    async generateNodeVideo(value) {
      assertSchema('generateNodeVideo', value)
      const input = videoInput(value, 120)
      try {
        return { assets: await generation.generateNodeVideo(input) }
      } catch (error) {
        return { assets: [], error: publicErrorMessage(error) }
      }
    },
  }
}
