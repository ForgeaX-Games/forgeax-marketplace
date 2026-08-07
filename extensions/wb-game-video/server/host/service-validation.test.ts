import { describe, expect, test } from 'vitest'
import {
  validateServiceInput,
  type ServiceSchemaName,
} from './service-validation'

const accepted: Array<[ServiceSchemaName, unknown]> = [
  ['getGraph', {}],
  ['saveGraph', { project: {} }],
  ['listAssets', {
    kind: 'image',
    productionType: 'shot_image',
    sceneNodeId: 'node-1',
  }],
  ['listVideos', {}],
  ['getAsset', { id: 'asset-1' }],
  ['importCharacterRefs', {}],
  ['importSceneRefs', {}],
  ['generateShotScript', {
    nodeName: 'Opening',
    storyText: 'Hero enters',
    durationSeconds: 1.5,
    interactive: false,
    characters: [{ name: 'Hero', desc: 'Coat' }],
  }],
  ['generateKeyframe', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    beat: 'Hero enters',
    grid: { panelLabels: true, nodeRole: 'regular' },
  }],
  ['generateVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    durationSeconds: 8.5,
    characterRefIds: ['character'],
    sceneRefIds: ['scene'],
    generateAudio: false,
  }],
  ['generateNodeVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    durationSeconds: 120,
    characterRefIds: ['character'],
    sceneRefIds: ['scene'],
  }],
]

const rejected: Array<[ServiceSchemaName, unknown]> = [
  ['getGraph', { cwd: '/private/secret' }],
  ['listAssets', { gameSlug: '游戏一' }],
  ['importSceneRefs', { gameSlug: '游戏一' }],
  ['saveGraph', { project: {}, cwd: '/private/secret' }],
  ['saveGraph', {}],
  ['listAssets', { kind: 'audio' }],
  ['listAssets', { productionType: 'grid_storyboard' }],
  ['listVideos', { extensionDir: '/private/secret' }],
  ['getAsset', { id: 'asset-1', extra: true }],
  ['getAsset', { id: 1 }],
  ['importCharacterRefs', { characterIds: ['hero'] }],
  ['importSceneRefs', { files: ['scene.png'] }],
  ['generateShotScript', {
    nodeName: 'Opening',
    storyText: 'Hero enters',
    interactive: 'false',
  }],
  ['generateShotScript', {
    nodeName: 'Opening',
    storyText: 'Hero enters',
    characters: [{ name: 'Hero', sourceUrl: 'https://secret.invalid' }],
  }],
  ['generateKeyframe', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    beat: 'Hero enters',
    grid: { panelLabels: 'true' },
  }],
  ['generateKeyframe', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    beat: 'Hero enters',
    styleAxes: { artMedia: 'ink', extra: true },
  }],
  ['generateVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    durationSeconds: 61,
    characterRefIds: ['character'],
    sceneRefIds: ['scene'],
  }],
  ['generateVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    characterRefIds: [],
    sceneRefIds: ['scene'],
  }],
  ['generateNodeVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    durationSeconds: 121,
    characterRefIds: ['character'],
    sceneRefIds: ['scene'],
  }],
  ['generateNodeVideo', {
    sceneNodeId: 'node-1',
    nodeName: 'Opening',
    characterRefIds: ['character'],
    sceneRefIds: ['scene'],
    extend: true,
  }],
]

describe('published service schemas', () => {
  test.each(accepted)('accepts %s contract input', (schema, input) => {
    expect(validateServiceInput(schema, input)).toEqual([])
  })

  test.each(rejected)('rejects %s contract drift', (schema, input) => {
    expect(validateServiceInput(schema, input).length).toBeGreaterThan(0)
  })
})
