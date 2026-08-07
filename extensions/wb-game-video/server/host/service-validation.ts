import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'
import generateKeyframeSchema from '../../schemas/generate-keyframe.args.json'
import generateNodeVideoSchema from '../../schemas/generate-node-video.args.json'
import generateShotScriptSchema from '../../schemas/generate-shot-script.args.json'
import generateVideoSchema from '../../schemas/generate-video.args.json'
import generateVideoClipSchema from '../../schemas/generate-video-clip.args.json'
import getAssetSchema from '../../schemas/get-asset.args.json'
import getGraphSchema from '../../schemas/get-graph.args.json'
import importCharacterRefsSchema from '../../schemas/import-character-refs.args.json'
import importSceneRefsSchema from '../../schemas/import-scene-refs.args.json'
import listAssetsSchema from '../../schemas/list-assets.args.json'
import listVideosSchema from '../../schemas/list-videos.args.json'
import patchGraphSchema from '../../schemas/patch-graph.args.json'
import saveGraphSchema from '../../schemas/save-graph.args.json'

export type ServiceSchemaName =
  | 'getGraph'
  | 'saveGraph'
  | 'patchGraph'
  | 'listAssets'
  | 'listVideos'
  | 'getAsset'
  | 'importCharacterRefs'
  | 'importSceneRefs'
  | 'generateShotScript'
  | 'generateKeyframe'
  | 'generateVideo'
  | 'generateVideoClip'
  | 'generateNodeVideo'

const ajv = new Ajv2020({ allErrors: true, strict: true })
const validators: Record<ServiceSchemaName, ValidateFunction> = {
  getGraph: ajv.compile(getGraphSchema),
  saveGraph: ajv.compile(saveGraphSchema),
  patchGraph: ajv.compile(patchGraphSchema),
  listAssets: ajv.compile(listAssetsSchema),
  listVideos: ajv.compile(listVideosSchema),
  getAsset: ajv.compile(getAssetSchema),
  importCharacterRefs: ajv.compile(importCharacterRefsSchema),
  importSceneRefs: ajv.compile(importSceneRefsSchema),
  generateShotScript: ajv.compile(generateShotScriptSchema),
  generateKeyframe: ajv.compile(generateKeyframeSchema),
  generateVideo: ajv.compile(generateVideoSchema),
  generateVideoClip: ajv.compile(generateVideoClipSchema),
  generateNodeVideo: ajv.compile(generateNodeVideoSchema),
}

function message(error: ErrorObject): string {
  const target = error.instancePath || 'input'
  return `${target} ${error.message ?? 'is invalid'}`
}

export function validateServiceInput(
  schema: ServiceSchemaName,
  value: unknown,
): string[] {
  const validate = validators[schema]
  return validate(value) ? [] : (validate.errors ?? []).map(message)
}
