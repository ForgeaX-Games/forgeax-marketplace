import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoAssetLibraryProps } from '../../assets/VideoAssetLibrary'

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  refresh: vi.fn(async () => {}),
  submit: vi.fn(),
  track: vi.fn(),
  useClipGeneration: vi.fn(),
  libraryProps: undefined as VideoAssetLibraryProps | undefined,
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

vi.mock('../../assets/VideoAssetLibrary', () => ({
  VideoAssetLibrary: (props: VideoAssetLibraryProps) => {
    mocks.libraryProps = props
    return <div data-testid="video-library" />
  },
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
    {
      id: 'registry-generated-video',
      kind: 'video',
      productionType: 'video_clip',
      status: 'ready',
      label: 'Registry generated video',
      durationMs: 3200,
      createdAt: 3,
      updatedAt: 4,
    },
  ])),
  resolveAssetSrc: () => '/reference.png',
  resolveMediaSrc: () => undefined,
  registryMediaUrl: () => '/registry-video.mp4',
}))

vi.mock('../../init', () => ({
  ['boot' + 'EditorSkins']: vi.fn(),
}))
vi.mock('../../../styles/injectStyle', () => ({ injectStyleOnce: vi.fn() }))

import { GraphVideoView } from '../GraphVideoView'
import { useVideoLibraryNav } from '../../persist/videoLibraryNavStore'
import { useGraphView } from '../../persist/graphViewStore'
import { useVideoGenerationStore } from '../../assets/generation/videoGenerationStore'

describe('GraphVideoView generation assembly', () => {
  beforeEach(() => {
    mocks.cancel.mockClear()
    mocks.refresh.mockClear()
    mocks.submit.mockClear()
    mocks.track.mockClear()
    mocks.useClipGeneration.mockClear()
    mocks.libraryProps = undefined
    useVideoLibraryNav.setState({ folder: { kind: 'all' }, entryId: null })
    useGraphView.setState({ view: 'video' })
    useVideoGenerationStore.setState({ byGame: {} })
  })

  it('feeds globally active Kino tasks to the real library and reopens the selected generation', async () => {
    useVideoGenerationStore.setState({
      byGame: {
        demo: {
          tasks: [{
            generationId: 'generation-1',
            status: 'polling',
            prompt: '雨夜追逐镜头',
            createdAt: 123,
          }],
          loading: false,
          error: null,
          revision: 1,
          completionRevision: 0,
        },
      },
    })
    render(<GraphVideoView />)

    await waitFor(() => expect(mocks.libraryProps?.supplementalEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'generation:generation-1',
        generationId: 'generation-1',
        label: '雨夜追逐镜头',
        status: 'generating',
      }),
    ])))

    act(() => mocks.libraryProps?.onOpenGeneration?.('generation-1'))
    expect(useGraphView.getState().view).toBe('video-generate')
    expect(useVideoGenerationStore.getState().byGame.demo?.selectedGenerationId).toBe('generation-1')
  })

  it('applies sidebar folder and entry navigation to the real video library surface', async () => {
    useVideoLibraryNav.setState({ folder: { kind: 'tag', name: '户外' }, entryId: null })
    render(<GraphVideoView />)

    await waitFor(() => expect(mocks.libraryProps?.requestedFolder).toBe('户外'))
    act(() => mocks.libraryProps?.onSelect('kino-generated-video'))
    expect(useVideoLibraryNav.getState().entryId).toBe('kino-generated-video')

    act(() => mocks.libraryProps?.onFolderChange?.('untagged'))
    expect(useVideoLibraryNav.getState()).toMatchObject({
      folder: { kind: 'untagged' },
      entryId: null,
    })
  })
})
