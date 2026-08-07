/**
 * Manifest-facing tool adapters.
 *
 * Each handler receives a capability-bounded host context from the Workbench
 * runtime and forwards its published schema input to the shared service.
 */
import type { WorkbenchToolHandler } from '@forgeax/workbench-host/node'
import {
  createWbGameVideoService,
  getAssetIdFromArgs,
} from './host/wb-service'

const getGraph: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).getGraph(args)
)

const saveGraph: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).saveGraph(args)
)

const patchGraph: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).patchGraph(args)
)

const listVideos: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).listVideos(args)
)

const generateShotScript: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).generateShotScript(args)
)

const generateKeyframe: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).generateKeyframe(args)
)

const generateVideo: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).generateVideo(args)
)

const generateVideoClip: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).generateVideoClip(args)
)

const listVideoVisualStyles: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).listVideoVisualStyles(args)
)

const generateNodeVideo: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).generateNodeVideo(args)
)

const listAssets: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).listAssets(args)
)

const getAsset: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).getAsset(
    getAssetIdFromArgs(args),
  )
)

const importCharacterRefs: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).importCharacterRefs(args)
)

const importSceneRefs: WorkbenchToolHandler = async (context, args) => (
  createWbGameVideoService(context).importSceneRefs(args)
)

/** Ordered to exactly match `forgeax-extension.json`'s public tool contract. */
export const tools: Record<string, WorkbenchToolHandler> = {
  'wb-game-video:get-graph': getGraph,
  'wb-game-video:save-graph': saveGraph,
  'wb-game-video:patch-graph': patchGraph,
  'wb-game-video:list-videos': listVideos,
  'wb-game-video:generate-shot-script': generateShotScript,
  'wb-game-video:generate-keyframe': generateKeyframe,
  'wb-game-video:generate-video': generateVideo,
  'wb-game-video:generate-video-clip': generateVideoClip,
  'wb-game-video:list-video-visual-styles': listVideoVisualStyles,
  'wb-game-video:generate-node-video': generateNodeVideo,
  'wb-game-video:list-assets': listAssets,
  'wb-game-video:get-asset': getAsset,
  'wb-game-video:import-character-refs': importCharacterRefs,
  'wb-game-video:import-scene-refs': importSceneRefs,
}

export default tools
