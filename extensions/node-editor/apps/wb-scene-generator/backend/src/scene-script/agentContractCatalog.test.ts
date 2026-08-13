import { describe, expect, it } from 'vitest'

import {
  isSinoApprovedContract,
  projectSinoContractCatalog,
  SINO_TEMPLATE_GUIDANCE,
  SINO_UTILITY_FUNCTIONS,
} from './agentContractCatalog.js'
import { getSceneContractRegistry } from './contracts.js'

describe('Sino progressive Scene Contract disclosure', () => {
  it('returns only the explicit scene-design utilities and published Template surface', async () => {
    const contracts = (await getSceneContractRegistry()).list()
    const result = projectSinoContractCatalog(contracts, { mode: 'summary' })

    expect(result.mode).toBe('summary')
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(20 * 1024)
    expect(result.functions).toHaveLength(
      SINO_UTILITY_FUNCTIONS.length + Object.keys(SINO_TEMPLATE_GUIDANCE).length,
    )
    expect(result.functions.every((summary) => {
      const source = contracts.find((contract) => contract.functionName === summary.functionName)
      return source ? isSinoApprovedContract(source) : false
    })).toBe(true)
    expect(result.functions.some((item) => item.functionName === 'addBaseGrid')).toBe(true)
    expect(result.functions.find((item) => item.functionName === 'areaPartition')).toEqual(
      expect.objectContaining({
        stage: 'Blockout',
        description: expect.stringContaining('voxel-bearing parent region'),
      }),
    )
    expect(result.functions.some((item) => item.functionName === 'rectangularGrid')).toBe(false)
    expect(result.functions.some((item) => item.functionName === 'nodeExplode')).toBe(false)
    expect(result.functions.some((item) => item.functionName === 'adaptiveRoomFurniturePlacerTemplate')).toBe(false)
    expect(result.functions.some((item) => item.functionName === 'cellularNoise')).toBe(false)
    expect(JSON.stringify(result)).not.toContain('"definition"')
  })

  it('returns full public signatures only for a bounded exact-name selection', async () => {
    const contracts = (await getSceneContractRegistry()).list()
    const result = projectSinoContractCatalog(contracts, {
      mode: 'detail',
      functionNames: ['addBaseGrid', 'areaPartition', 'sceneOutput', 'rectangularGrid'],
    })

    expect(result.mode).toBe('detail')
    expect(result.functions.map((item) => item.functionName)).toEqual([
      'addBaseGrid',
      'areaPartition',
      'sceneOutput',
    ])
    expect(result.notFound).toEqual(['rectangularGrid'])
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(32 * 1024)
    expect(result.functions[0]).toEqual(expect.objectContaining({
      stage: 'Blockout',
      description: expect.stringContaining('base region'),
    }))
    expect(result.functions[1]?.inputs[0]).toEqual(expect.objectContaining({
      name: 'scene',
      description: expect.stringContaining('base.baseNode'),
    }))
  })

  it('keeps both whitelists explicit, minimal, and auditable', () => {
    expect(SINO_UTILITY_FUNCTIONS).toEqual([
      'emptyScene',
      'manualPoint',
      'mergeNumbers',
      'mergePoints',
      'mergeScenes',
      'mergeStrings',
      'sceneFocusChildren',
      'sceneMergeSubtrees',
      'sceneOutput',
      'seed',
      'stringConcat',
      'treeFlatten',
    ])
    expect(Object.keys(SINO_TEMPLATE_GUIDANCE)).toEqual([
      'addBaseGrid',
      'areaPartition',
      'pickOneBuilding',
      'pickMultiBuildings',
      'buildingStructures',
      'pathConnectionLink',
      'pathConnectionRandomWalk',
      'placeOneDecoration',
      'localPreciseDecoration',
      'naturalDecorationDistribution',
      'randomLakeRegions',
      'mountainContourGenerateTemplate',
    ])

    expect(SINO_UTILITY_FUNCTIONS).not.toContain('cellularNoise')
    expect(SINO_UTILITY_FUNCTIONS).not.toContain('fieldGrow')
    expect(SINO_UTILITY_FUNCTIONS).not.toContain('astarPath')
    expect(SINO_UTILITY_FUNCTIONS).not.toContain('aStarPath')
    expect(SINO_UTILITY_FUNCTIONS).not.toContain('regionAreaPartition')
  })


})
