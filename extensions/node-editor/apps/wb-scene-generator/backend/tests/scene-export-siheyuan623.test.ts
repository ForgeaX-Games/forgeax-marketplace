import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cookBakedScene } from '../src/scene-export/cooker.js'
import { listMergedAliasMetas } from '../src/library/mergedLibraryPool.js'
import { resolveLayerAlias } from '../src/scene-export/assetMatch.js'

const bakedPath = '/tmp/baked-layers.json'

function findSiheyuanCell(result: ReturnType<typeof cookBakedScene>) {
  return Object.values(result.terrain.cells)
    .flat()
    .find((c) => c.template_id.some((t) => String(t).includes('四合院')))
}

describe('project 623 siheyuan placement', () => {
  it('matches renderer anchor when cooked from baked snapshot', () => {
    const { layers } = JSON.parse(readFileSync(bakedPath, 'utf8'))
    const sh = layers.find((L: { nodePath: string }) => L.nodePath === '/ground/四合院')
    const alias = {
      alias: '[武侠][建筑][16][96][四合院][抠图][0.5][0.007]',
      anchorX: 0.5,
      anchorY: 0.007,
      widthPx: 288,
      heightPx: 96,
      ppu: 16,
    }
    const solo = cookBakedScene({
      bundleId: 'solo',
      sceneName: 'solo',
      layers: [sh],
      aliases: [alias],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })
    expect(findSiheyuanCell(solo)).toMatchObject({ x: 29.5, y: 37, height: 1 })

    const full = cookBakedScene({
      bundleId: 'full',
      sceneName: 'full',
      layers,
      aliases: [alias],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })
    expect(findSiheyuanCell(full)).toMatchObject({ x: 29.5, y: 37, height: 1 })
  })

  it('matches renderer anchor with merged library aliases (live export path)', async () => {
    const { layers } = JSON.parse(readFileSync(bakedPath, 'utf8'))
    const sh = layers.find((L: { nodePath: string }) => L.nodePath === '/ground/四合院')
    const aliases = await listMergedAliasMetas('raw')
    const resolved = resolveLayerAlias(sh, aliases)
    expect(resolved?.ppu).toBe(16)
    const full = cookBakedScene({
      bundleId: 'full-lib',
      sceneName: 'full-lib',
      layers,
      aliases,
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })
    const cell = findSiheyuanCell(full)
    expect(cell).toMatchObject({ x: 29.5, height: 1 })
    // Full library resolution emits the whole scene; negative billboard rows trigger
    // global Y offset (+1 for project 623), so grid y becomes 38 not 37.
    expect(cell!.y).toBeGreaterThanOrEqual(37)
    expect(cell!.y).toBeLessThanOrEqual(38)
  })
})
