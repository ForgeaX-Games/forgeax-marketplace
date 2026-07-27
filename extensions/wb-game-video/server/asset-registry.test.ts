import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { deleteAsset, listAssets, setStyleAxes, upsertAsset } from './asset-registry'

let dir: string

const providerVideo = {
  id: 'provider-video',
  kind: 'video',
  name: 'provider-video.mp4',
  status: 'ready',
  mimeType: 'video/mp4',
  bytes: 10,
  createdAt: 1,
  updatedAt: 1,
  provider: { kind: 'cos', ref: 'videos/provider-video.mp4' },
}

const providerImage = {
  id: 'provider-image',
  kind: 'image',
  name: 'hero.png',
  productionType: 'character_ref',
  sourceModule: 'wb-game-video',
  status: 'ready',
  mimeType: 'image/png',
  bytes: 10,
  createdAt: 1,
  updatedAt: 1,
  provider: { kind: 'local', ref: 'blobs/provider-image.png' },
  meta: {},
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gva-asset-registry-'))
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ version: 2, assets: [providerVideo, providerImage] }),
  )
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('shared asset manifest coexistence', () => {
  test('registry mutations preserve provider-backed video records and v2', () => {
    setStyleAxes(dir, { artMedia: 'ink' })
    upsertAsset(dir, {
      id: 'generated-image',
      kind: 'image',
      productionType: 'shot_image',
      status: 'ready',
      file: 'media/generated-image.png',
      createdAt: 1,
      updatedAt: 1,
    })

    const raw = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf-8'))
    expect(raw.version).toBe(2)
    expect(raw.styleAxes).toEqual({ artMedia: 'ink' })
    expect(raw.assets).toContainEqual(providerVideo)
    expect(raw.assets).toContainEqual(providerImage)
    expect(listAssets(dir).map((asset) => asset.id)).toEqual(['provider-image', 'generated-image'])
    expect(listAssets(dir)[0]).toMatchObject({
      label: 'hero.png',
      mime: 'image/png',
      meta: { upload: true },
    })
  })

  test('registry cannot overwrite or delete an id owned by another asset domain', () => {
    expect(() =>
      upsertAsset(dir, {
        id: 'provider-video',
        kind: 'video',
        productionType: 'video_clip',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toThrow('owned by another asset domain')
    expect(deleteAsset(dir, 'provider-video')).toBe(false)
    expect(() =>
      upsertAsset(dir, {
        id: 'provider-image',
        kind: 'image',
        productionType: 'character_ref',
        status: 'ready',
        createdAt: 1,
        updatedAt: 1,
      }),
    ).toThrow('owned by another asset domain')
    expect(deleteAsset(dir, 'provider-image')).toBe(false)
  })

  test('registry fails loudly instead of replacing a malformed shared manifest', () => {
    writeFileSync(join(dir, 'manifest.json'), '{"version":2,"assets":{}}')
    expect(() => setStyleAxes(dir, { artMedia: 'ink' })).toThrow(
      'Unsupported shared asset manifest',
    )
    expect(readFileSync(join(dir, 'manifest.json'), 'utf-8')).toBe(
      '{"version":2,"assets":{}}',
    )
  })
})
