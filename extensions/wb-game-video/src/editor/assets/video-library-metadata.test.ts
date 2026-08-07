import { beforeEach, describe, expect, it } from 'vitest'
import {
  VIDEO_LIBRARY_METADATA_MAX_FOLDER_NAME_LENGTH,
  listVideoLibraryFolderNames,
  readVideoLibraryMetadata,
  resolveVideoLibraryEntryTag,
  videoLibraryMetadataStorageKey,
  writeVideoLibraryFolderName,
  writeVideoLibraryEntryTag,
  type VideoLibraryMetadataStorage,
} from './video-library-metadata'

class MemoryStorage implements VideoLibraryMetadataStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

describe('video-library-metadata', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
  })

  it('keeps tags local, game-scoped, and separate from Kino DTO fields', () => {
    const gameA = 'game/a'
    const gameB = 'game-b'

    expect(writeVideoLibraryEntryTag(gameA, 'resource-1', '  cutscenes  ', storage)).toMatchObject({
      status: 'written',
      tagsByEntryId: { 'resource-1': 'cutscenes' },
    })
    expect(readVideoLibraryMetadata(gameA, storage)).toMatchObject({
      status: 'ready',
      tagsByEntryId: { 'resource-1': 'cutscenes' },
    })
    expect(readVideoLibraryMetadata(gameB, storage)).toMatchObject({
      status: 'ready',
      tagsByEntryId: {},
    })
    expect(videoLibraryMetadataStorageKey(gameA)).toBe('wb-game-video:video-library-metadata:v1:game%2Fa')
  })

  it('uses root for blank tags and removes empty metadata from storage', () => {
    writeVideoLibraryEntryTag('demo', 'resource-1', 'combat', storage)
    const result = writeVideoLibraryEntryTag('demo', 'resource-1', '   ', storage)

    expect(result).toMatchObject({ status: 'written', tagsByEntryId: {} })
    expect(storage.getItem(videoLibraryMetadataStorageKey('demo'))).toBeNull()
    expect(resolveVideoLibraryEntryTag('resource-1', { tagsByEntryId: {}, folderNames: [] })).toBeNull()
  })

  it('persists empty folders and keeps them when the last tag is removed', () => {
    expect(writeVideoLibraryFolderName('demo', '  combat  ', storage)).toMatchObject({
      status: 'written',
      folderNames: ['combat'],
    })
    writeVideoLibraryEntryTag('demo', 'resource-1', 'combat', storage)
    writeVideoLibraryEntryTag('demo', 'resource-1', null, storage)

    expect(readVideoLibraryMetadata('demo', storage)).toMatchObject({
      status: 'ready',
      tagsByEntryId: {},
      folderNames: ['combat'],
    })
  })

  it('rejects overlong tags without deleting an existing assignment', () => {
    writeVideoLibraryEntryTag('demo', 'resource-1', 'combat', storage)

    expect(() => writeVideoLibraryEntryTag(
      'demo',
      'resource-1',
      'x'.repeat(VIDEO_LIBRARY_METADATA_MAX_FOLDER_NAME_LENGTH + 1),
      storage,
    )).toThrow(RangeError)
    const metadata = readVideoLibraryMetadata('demo', storage)
    if (metadata.status !== 'ready') throw new Error('expected available test storage')
    expect(resolveVideoLibraryEntryTag('resource-1', metadata)).toBe('combat')
  })

  it('drops invalid persisted values and lists valid folder names once', () => {
    storage.setItem(videoLibraryMetadataStorageKey('demo'), JSON.stringify({
      version: 1,
      tagsByEntryId: {
        valid: '  cutscenes  ',
        blank: ' ',
        tooLong: 'x'.repeat(VIDEO_LIBRARY_METADATA_MAX_FOLDER_NAME_LENGTH + 1),
        nonString: 1,
        another: 'combat',
        duplicate: 'combat',
      },
    }))

    const metadata = readVideoLibraryMetadata('demo', storage)
    expect(metadata).toMatchObject({
      status: 'ready',
      tagsByEntryId: { valid: 'cutscenes', another: 'combat', duplicate: 'combat' },
    })
    if (metadata.status !== 'ready') throw new Error('expected available test storage')
    expect(listVideoLibraryFolderNames(metadata)).toEqual(['combat', 'cutscenes'])
    expect(resolveVideoLibraryEntryTag('blank', metadata)).toBeNull()
  })

  it('reports storage denial explicitly and preserves the underlying error', () => {
    const denied = new Error('storage denied')
    const unavailableStorage: VideoLibraryMetadataStorage = {
      getItem: () => { throw denied },
      setItem: () => { throw denied },
      removeItem: () => { throw denied },
    }

    expect(readVideoLibraryMetadata('demo', unavailableStorage)).toMatchObject({
      status: 'unavailable',
      reason: 'storage-unavailable',
      operation: 'read',
      error: denied,
    })
    expect(writeVideoLibraryEntryTag('demo', 'resource-1', 'combat', unavailableStorage)).toMatchObject({
      status: 'unavailable',
      reason: 'storage-unavailable',
      operation: 'read',
      error: denied,
    })
  })
})
