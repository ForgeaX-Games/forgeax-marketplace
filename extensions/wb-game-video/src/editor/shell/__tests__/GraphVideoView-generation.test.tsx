import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoGenSheetProps } from '../../assets/generation/VideoGenSheet'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  refresh: vi.fn(async () => {}),
  submit: vi.fn(),
  track: vi.fn(),
  useClipGeneration: vi.fn(),
  sheetProps: undefined as VideoGenSheetProps | undefined,
}))

vi.mock('../../persist/graphScenarioStore', () => ({
  useGraphScenario: (selector: (state: { game: string, graph: { nodes: never[], edges: never[] } }) => unknown) => (
    selector({ game: 'demo', graph: { nodes: [], edges: [] } })
  ),
}))

vi.mock('../../persist/gameScope', () => ({ getGameSlug: () => 'demo' }))

vi.mock('../../assets/useVideoAssets', () => ({
  useVideoAssets: () => ({
    loading: false,
    error: null,
    items: [{
      id: 'kino-generated-video',
      label: 'Generated video',
      url: '/kino-generated-video.mp4',
      type: 'GENERATION',
      updatedAt: 1_754_361_000_000,
    }],
    total: 1,
    page: 1,
    pageSize: 20,
    hasMore: false,
    uploadProgress: null,
    uploadError: null,
    canRetryComplete: false,
    uploading: false,
    mutating: false,
    refresh: mocks.refresh,
    loadPage: vi.fn(),
    loadMore: vi.fn(),
    upload: vi.fn(),
    replaceResource: vi.fn(),
    renameResource: vi.fn(),
    retryComplete: vi.fn(),
    deleteResource: vi.fn(),
    deleteResources: vi.fn(),
  }),
}))

vi.mock('../../assets/generation/useClipGeneration', () => ({
  useClipGeneration: (...args: unknown[]) => {
    mocks.useClipGeneration(...args)
    return {
      state: { phase: 'idle' },
      submit: mocks.submit,
      cancel: mocks.cancel,
      reset: mocks.cancel,
      track: mocks.track,
    }
  },
}))

vi.mock('../../assets/generation/VideoGenSheet', () => ({
  VideoGenSheet: (props: VideoGenSheetProps) => {
    mocks.sheetProps = props
    return <div data-testid="generation-sheet" />
  },
}))

vi.mock('../../assets/VideoAssetLibrary', () => ({
  VideoAssetLibrary: () => <div data-testid="video-library" />,
}))

vi.mock('../GraphVideoPreviewPanel', () => ({
  GraphVideoPreviewPanel: () => <div data-testid="preview" />,
}))

vi.mock('../media', () => ({
  listRegistryAssets: vi.fn(async () => ([
    {
      id: 'registry-kino-image',
      kind: 'image',
      productionType: 'scene_ref',
      status: 'ready',
      provider: {
        kind: 'kino',
        ref: 'https://media.example/reference.png',
        upstreamResourceId: 'kino-image-resource',
      },
      createdAt: 1,
      updatedAt: 2,
    },
    {
      id: 'registry-legacy-image',
      kind: 'image',
      productionType: 'scene_ref',
      status: 'ready',
      provider: {
        kind: 'kino',
        ref: 'https://media.example/legacy.png',
      },
      createdAt: 1,
      updatedAt: 2,
    },
  ])),
  resolveAssetSrc: () => '/reference.png',
  resolveMediaSrc: () => undefined,
  registryMediaUrl: () => '/registry-video.mp4',
}))

vi.mock('../../init', () => ({ bootEditorSkins: vi.fn() }))
vi.mock('../../../styles/injectStyle', () => ({ injectStyleOnce: vi.fn() }))

import { GraphVideoView } from '../GraphVideoView'

describe('GraphVideoView generation assembly', () => {
  beforeEach(() => {
    mocks.cancel.mockClear()
    mocks.refresh.mockClear()
    mocks.submit.mockClear()
    mocks.track.mockClear()
    mocks.useClipGeneration.mockClear()
    mocks.sheetProps = undefined
  })

  it('keeps registry and Kino identities distinct and wires recovery, refresh, cancel, and track', async () => {
    render(<GraphVideoView />)

    await waitFor(() => expect(mocks.sheetProps?.imageAssets).toHaveLength(2))
    expect(mocks.sheetProps?.imageAssets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'registry-kino-image', resourceId: 'kino-image-resource' }),
      expect.objectContaining({ id: 'registry-legacy-image', resourceId: undefined }),
    ]))
    expect(mocks.sheetProps?.recentClips).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'kino-generated-video',
        playbackUrl: '/kino-generated-video.mp4',
      }),
    ]))
    expect(mocks.sheetProps?.onCancel).toBe(mocks.cancel)
    expect(mocks.sheetProps?.onTrack).toBe(mocks.track)

    const [, options] = mocks.useClipGeneration.mock.calls.at(-1) as [unknown, {
      gameSlug: string
      onTerminal: () => Promise<void>
    }]
    expect(options.gameSlug).toBe('demo')
    await options.onTerminal()
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })
})
