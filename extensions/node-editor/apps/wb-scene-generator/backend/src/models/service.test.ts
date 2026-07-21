import { describe, expect, it } from 'vitest'
import { getObjectModel, listObjectModels, resolveObjectModelPath } from './service.js'

describe('object models service', () => {
  it('lists imported mountain layer packs', () => {
    const names = listObjectModels().map((i) => i.name)
    expect(names).toContain('firtree1')
    expect(names).toContain('firtree6')
    expect(names).toContain('bushtree1')
    expect(names).toContain('shrub_01_1')
    expect(names).toContain('shrub_sorrel_01_1')
    expect(names).toContain('rock1')
    expect(names).toContain('moss_rock1')
  })

  it('exact-name get returns file url', () => {
    const m = getObjectModel('firtree1')
    expect(m).not.toBeNull()
    expect(m!.fileUrl).toBe('/api/v1/models/firtree1/file')
    expect(m!.targetHeightCells).toBe(4)
    expect(m!.tags).toContain('mountain')
  })

  it('resolves glb on disk', () => {
    const p = resolveObjectModelPath('firtree2')
    expect(p).toBeTruthy()
    expect(p!.endsWith('.glb')).toBe(true)
  })

  it('unknown / path escape → null', () => {
    expect(getObjectModel('NoSuchTree')).toBeNull()
    expect(resolveObjectModelPath('../etc')).toBeNull()
  })
})
