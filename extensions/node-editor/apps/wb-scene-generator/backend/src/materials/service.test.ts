import { describe, expect, it } from 'vitest'
import { getPbrMaterial, listPbrMaterials, resolvePbrMapPath } from './service.js'

describe('pbr materials service', () => {
  it('lists seeded packs', () => {
    const items = listPbrMaterials()
    const names = items.map((i) => i.name)
    expect(names).toContain('Grass')
    expect(names).toContain('Rock')
    expect(names).toContain('Sand')
    expect(names).toContain('Water')
    expect(names).toContain('Water2')
    expect(names).toContain('Mount1')
  })

  it('Sand is textured with color/normal/roughness', () => {
    const s = getPbrMaterial('Sand')
    expect(s).not.toBeNull()
    expect(s!.shading).toBe('textured')
    expect(s!.maps).toEqual(expect.arrayContaining(['color', 'normal', 'roughness']))
    expect(s!.mapUrls.color).toBe('/api/v1/materials/Sand/maps/color')
  })

  it('Water2 is map-less physical water', () => {
    const w = getPbrMaterial('Water2')
    expect(w).not.toBeNull()
    expect(w!.shading).toBe('physicalWater')
    expect(w!.maps).toEqual([])
    expect(w!.water?.ior).toBeCloseTo(1.333)
  })

  it('Mount1 is map-less terrain biome', () => {
    const m = getPbrMaterial('Mount1')
    expect(m).not.toBeNull()
    expect(m!.shading).toBe('terrainBiome')
    expect(m!.maps).toEqual([])
    expect(m!.biome?.layers).toEqual(['Grass', 'Moss', 'Rock'])
    expect(m!.biome?.slopeRockStart).toBeCloseTo(0.32)
  })

  it('exact-name get returns map urls', () => {
    const g = getPbrMaterial('Grass')
    expect(g).not.toBeNull()
    expect(g!.maps).toContain('color')
    expect(g!.mapUrls.color).toBe('/api/v1/materials/Grass/maps/color')
  })

  it('unknown name returns null', () => {
    expect(getPbrMaterial('NoSuchMaterial')).toBeNull()
  })

  it('resolves color map path on disk', () => {
    const p = resolvePbrMapPath('Grass', 'color')
    expect(p).toBeTruthy()
    expect(p!.endsWith('.png')).toBe(true)
  })

  it('rejects path escape in name', () => {
    expect(resolvePbrMapPath('../etc', 'color')).toBeNull()
  })
})
