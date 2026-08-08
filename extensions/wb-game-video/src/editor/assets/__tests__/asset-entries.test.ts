import { describe, expect, it } from 'vitest'
import {
  assetEntries,
  assetEntryKey,
  assetEntryRoot,
  parentFolderIdForAssetEntry,
} from '../asset-entries'

describe('asset entries', () => {
  it('uses the same stable keys and roots as the asset library', () => {
    const entries = assetEntries(
      [{ id: 'image-1', kind: 'image', name: '背景' }],
      [{ id: 'video-1', kind: 'video', name: '开场' }],
      [{ componentId: 'health-bar', manifest: { label: '生命条' } } as any],
    )

    expect(entries.map(assetEntryKey)).toEqual(['image-1', 'video-1', 'component:health-bar'])
    expect(entries.map(assetEntryRoot)).toEqual(['image', 'video', 'control'])
    expect(parentFolderIdForAssetEntry(entries[1]!, { 'video-1': 'folder-video' })).toBe('folder-video')
    expect(parentFolderIdForAssetEntry(entries[2]!, {})).toBe('root:control')
  })
})
