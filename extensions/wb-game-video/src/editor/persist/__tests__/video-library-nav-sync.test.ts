import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  installVideoLibraryNavSync,
  useVideoLibraryNav,
} from '../videoLibraryNavStore'

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  postMessage = vi.fn()
  close = vi.fn()

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this)
  }
}

beforeEach(() => {
  FakeBroadcastChannel.instances = []
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  useVideoLibraryNav.setState({ folder: { kind: 'all' }, entryId: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  useVideoLibraryNav.setState({ folder: { kind: 'all' }, entryId: null })
})

describe('video library navigation sync', () => {
  it('broadcasts local locations and applies remote locations without echoing', () => {
    const dispose = installVideoLibraryNavSync()
    const channel = FakeBroadcastChannel.instances[0]!

    useVideoLibraryNav.getState().setLocation({
      folder: { kind: 'tag', name: '户外' },
      entryId: 'video-1',
    })
    expect(channel.postMessage).toHaveBeenCalledWith({
      folder: { kind: 'tag', name: '户外' },
      entryId: 'video-1',
    })

    channel.onmessage?.({
      data: { folder: { kind: 'untagged' }, entryId: 'video-2' },
    } as MessageEvent)
    expect(useVideoLibraryNav.getState()).toMatchObject({
      folder: { kind: 'untagged' },
      entryId: 'video-2',
    })
    expect(channel.postMessage).toHaveBeenCalledTimes(1)

    dispose()
    expect(channel.close).toHaveBeenCalledOnce()
  })
})
