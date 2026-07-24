import { createRef } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { GameScenario } from '../../../runtime/schema/graph-schema'
import * as videoAssetLibraryModule from '../VideoAssetLibrary'
import { VideoAssetLibrary, type VideoAssetsController, type VideoLibraryEntry } from '../VideoAssetLibrary'

const EMPTY_SCENARIO: GameScenario = {
  version: 'wb-game-video.graph.v1',
  graph: { nodes: [], edges: [] },
}

function bundledEntry(id: string): VideoLibraryEntry {
  return { id, label: id, url: `/bundled/${id}.mp4`, group: '战斗', bundled: true }
}

function apiEntry(id: string, label = id): VideoLibraryEntry {
  return {
    id,
    label,
    url: `/api/v1/kino/resources/${id}/content?game_id=demo`,
    group: '上传',
    fromApi: true,
  }
}

function makeController(
  overrides: Partial<VideoAssetsController> & {
    uploading?: boolean
    mutating?: boolean
  } = {},
): VideoAssetsController {
  return {
    loading: false,
    error: null,
    items: [apiEntry('api-1', 'Clip one')],
    total: 1,
    page: 1,
    pageSize: 20,
    hasMore: false,
    uploadProgress: null,
    uploadError: null,
    canRetryComplete: false,
    uploading: false,
    mutating: false,
    refresh: vi.fn(async () => {}),
    loadPage: vi.fn(async () => {}),
    loadMore: vi.fn(async () => {}),
    upload: vi.fn(async () => undefined),
    replaceResource: vi.fn(async () => undefined),
    renameResource: vi.fn(async () => undefined),
    retryComplete: vi.fn(async () => undefined),
    deleteResource: vi.fn(async () => {}),
    ...overrides,
  }
}

describe('VideoAssetLibrary', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('shows loading state', () => {
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={makeController({ loading: true, items: [] })}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent(/加载/)
  })

  it('lists bundled and api entries', () => {
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[bundledEntry('idle01')]}
        controller={makeController()}
        selectedId="api-1"
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /idle01/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '上传 · Clip one' })).toHaveClass('is-on')
  })

  it('places Kino entries before bundled videos', () => {
    const { container } = render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[bundledEntry('idle01')]}
        controller={makeController()}
        selectedId=""
        onSelect={() => {}}
      />,
    )

    const labels = [...container.querySelectorAll('.gc-list-body .gc-row-label')]
      .map((element) => element.textContent)

    expect(labels).toEqual(['上传 · Clip one', '战斗 · idle01'])
  })

  it('renames an uploaded video on double click', async () => {
    const controller = makeController()
    vi.spyOn(window, 'prompt').mockReturnValue('Renamed clip')
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: '上传 · Clip one' }))

    await waitFor(() => expect(controller.renameResource).toHaveBeenCalledWith('api-1', 'Renamed clip'))
  })

  it('orders header controls as title, upload, status, count, refresh', () => {
    const controller = makeController({
      uploadProgress: 42,
      uploadError: 'Failed to finalize upload',
      canRetryComplete: true,
    })
    const { container } = render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    const head = container.querySelector('.gc-list-head')
    expect(head).toBeTruthy()
    const children = [...head!.children]
    const title = head!.querySelector('.gc-list-title')
    const upload = head!.querySelector('.val-head-upload')
    const status = head!.querySelector('.val-head-status')
    const count = head!.querySelector('.gc-list-count')
    const refresh = head!.querySelector('.val-head-refresh')

    expect(children.indexOf(upload!)).toBe(children.indexOf(title!) + 1)
    expect(children.indexOf(status!)).toBeGreaterThan(children.indexOf(upload!))
    expect(children.indexOf(count!)).toBeGreaterThan(children.indexOf(status!))
    expect(children.indexOf(refresh!)).toBeGreaterThan(children.indexOf(count!))
  })

  it('uses the file input itself as the single accessible upload control', () => {
    const { container } = render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={makeController()}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    const uploadControls = screen.getAllByLabelText('上传视频')
    expect(uploadControls).toHaveLength(1)
    const input = uploadControls[0] as HTMLInputElement
    const label = input.closest('label')

    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', 'video/mp4')
    expect(input).not.toHaveAttribute('hidden')
    expect(input).not.toHaveStyle({ display: 'none' })
    expect(input).toHaveClass('val-head-upload-input')
    expect(label).toHaveClass('val-head-upload')
    expect(label).toContainElement(input)
    expect(container.querySelector('.gc-list-title')?.nextElementSibling).toBe(label)
    expect(input.tabIndex).toBe(0)
  })

  it('keeps the upload input above a 30 by 28 pixel hit area', async () => {
    await import('../../shell/GraphVideoView')
    const css = document.querySelector<HTMLStyleElement>(
      'style[data-reel-style="graph-video-view"]',
    )?.textContent ?? ''

    expect(css).toMatch(/\.val-head-upload\s*\{[^}]*min-width:\s*30px/)
    expect(css).toMatch(/\.val-head-upload\s*\{[^}]*min-height:\s*28px/)
    expect(css).toMatch(/\.val-head-upload-input\s*\{[^}]*display:\s*block/)
    expect(css).toMatch(/\.val-head-upload-input\s*\{[^}]*z-index:\s*1/)
    expect(css).toMatch(/\.val-head-upload-input::file-selector-button\s*\{[^}]*width:\s*100%/)
    expect(css).toMatch(/\.val-head-upload-input::file-selector-button\s*\{[^}]*height:\s*100%/)
  }, 15_000)

  it('uploads the selected file from the real file input', async () => {
    const controller = makeController()
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    const input = screen.getByLabelText('上传视频') as HTMLInputElement
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(controller.upload).toHaveBeenCalledWith(file))
    expect(input.value).toBe('')
  })

  it('shows compact upload status and retry in the header', async () => {
    const controller = makeController({
      uploadProgress: 42,
      uploadError: 'Failed to finalize upload',
      canRetryComplete: true,
    })
    const { container } = render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    const head = container.querySelector('.gc-list-head')
    const status = within(head as HTMLElement).getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('上传 42%')
    expect(status).toHaveTextContent('完成失败')
    expect(within(head as HTMLElement).getByRole('button', { name: '重试完成上传' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试完成上传' }))
    await waitFor(() => expect(controller.retryComplete).toHaveBeenCalledOnce())
  })

  it('keeps upload status out of the list body', () => {
    const { container } = render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={makeController({
          uploadProgress: 42,
          uploadError: 'Failed to finalize upload',
          canRetryComplete: true,
        })}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    const listBody = container.querySelector('.gc-list-body')
    expect(listBody).toBeTruthy()
    expect(within(listBody as HTMLElement).queryByRole('progressbar')).toBeNull()
    expect(within(listBody as HTMLElement).queryByText(/完成失败/)).toBeNull()
    expect(within(listBody as HTMLElement).queryByRole('button', { name: '重试完成上传' })).toBeNull()
  })

  it('calls refresh from manual refresh button', async () => {
    const controller = makeController()
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '刷新视频库' }))
    await waitFor(() => expect(controller.refresh).toHaveBeenCalledOnce())
  })

  it('exposes delete but not rename for api entries', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={makeController({ items: [apiEntry('res-1', 'Clip one')] })}
        selectedId="res-1"
        onSelect={onSelect}
      />,
    )
    expect(screen.queryByRole('button', { name: /重命名/ })).toBeNull()
    const deleteButton = screen.getByRole('button', { name: '删除 Clip one' })
    const assetButton = screen.getByRole('button', { name: '上传 · Clip one' })
    const row = deleteButton.closest('.val-row')

    expect(row).toHaveClass('is-on')
    expect(assetButton.parentElement).toBe(row)
    expect(deleteButton.parentElement).toBe(row)
    expect([...row!.children]).toEqual([assetButton, deleteButton])

    fireEvent.click(deleteButton)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(container.querySelector('.val-row-actions')).toBeNull()
  })

  it('keeps delete inline, compact, and discoverable for pointer and keyboard users', async () => {
    await import('../../shell/GraphVideoView')
    const css = document.querySelector<HTMLStyleElement>(
      'style[data-reel-style="graph-video-view"]',
    )?.textContent ?? ''

    expect(css).toMatch(/\.val-row\s*\{[^}]*display:\s*grid/)
    expect(css).toMatch(/\.val-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/)
    expect(css).toMatch(/\.val-row\s*>\s*\.gc-row\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.val-row\s+\.gc-row-label\s*\{[^}]*text-overflow:\s*ellipsis/)
    expect(css).toMatch(/\.val-row-delete\s*\{[^}]*min-width:\s*44px/)
    expect(css).toMatch(/\.val-row-delete\s*\{[^}]*min-height:\s*28px/)
    expect(css).toMatch(/\.val-row:hover\s+\.val-row-delete[^}]*opacity:\s*1/)
    expect(css).toMatch(/\.val-row:focus-within\s+\.val-row-delete[^}]*opacity:\s*1/)
    expect(css).toMatch(/\.val-row\.is-on\s+\.val-row-delete[^}]*opacity:\s*1/)
  })

  it('delete with references shows graph and node names in confirm dialog', async () => {
    const controller = makeController({ items: [apiEntry('vid-used', 'Used clip')] })
    const scenario: GameScenario = {
      version: 'wb-game-video.graph.v1',
      graph: {
        nodes: [{
          id: 'n1',
          type: 'perf',
          position: { x: 0, y: 0 },
          inputs: [],
          outputs: [],
          data: { name: 'Boss intro', media: { kind: 'video', ref: 'vid-used' } },
        }],
        edges: [],
      },
    }
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={scenario}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '删除 Used clip' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Boss intro')
    expect(screen.getByRole('dialog')).toHaveTextContent('主图')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(controller.deleteResource).toHaveBeenCalledWith('vid-used'))
  })

  it('uses a single confirmation for an unreferenced delete', async () => {
    const controller = makeController({ items: [apiEntry('unused', 'Unused clip')] })
    const onDeleted = vi.fn()
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
        onDeleted={onDeleted}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '删除 Unused clip' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(controller.deleteResource).toHaveBeenCalledOnce())
    expect(onDeleted).toHaveBeenCalledWith('unused')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps delete dialog open when delete fails', async () => {
    const controller = makeController({
      items: [apiEntry('res-1', 'Old name')],
      error: 'Delete failed',
      deleteResource: vi.fn(async () => {
        throw new Error('Delete failed')
      }),
    })
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '删除 Old name' }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(controller.deleteResource).toHaveBeenCalledOnce())
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('alert')).toHaveTextContent('Delete failed')
  })

  it('focuses the safe action, traps Tab, closes on Escape, and restores trigger focus', () => {
    const controller = makeController({ items: [apiEntry('res-1', 'Old name')] })
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    const trigger = screen.getByRole('button', { name: '删除 Old name' })
    trigger.focus()
    fireEvent.click(trigger)

    const cancel = screen.getByRole('button', { name: '取消' })
    const confirm = screen.getByRole('button', { name: '确认删除' })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(confirm).toHaveFocus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(cancel).toHaveFocus()
    fireEvent.keyDown(cancel, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('disables conflicting actions while upload or mutation is active', () => {
    const controller = makeController({
      items: [apiEntry('res-1', 'Clip')],
      uploadProgress: 25,
      uploading: true,
      mutating: false,
    })
    const { rerender } = render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    expect(screen.getByLabelText('上传视频')).toBeDisabled()
    expect(screen.getByLabelText('上传视频').closest('label')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: '删除 Clip' })).toBeDisabled()

    rerender(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={makeController({
          items: [apiEntry('res-1', 'Clip')],
          uploading: false,
          mutating: true,
        })}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    expect(screen.getByLabelText('上传视频')).toBeDisabled()
    expect(screen.getByLabelText('上传视频').closest('label')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('button', { name: '删除 Clip' })).toBeDisabled()
  })

  it('does not expose delete for bundled entries', () => {
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[bundledEntry('idle01')]}
        controller={makeController({ items: [] })}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: /重命名 idle01/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /删除 idle01/ })).toBeNull()
  })

  it('does not expose mutations for generated registry entries', () => {
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        supplementalEntries={[{
          id: 'a-vid-generated',
          label: 'Generated clip',
          url: '/__gva__/media/a-vid-generated?game=demo',
          group: '生成',
          fromRegistry: true,
        }]}
        controller={makeController({ items: [] })}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '生成 · Generated clip' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '重命名 Generated clip' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除 Generated clip' })).toBeNull()
  })

  it('forwards the list body ref to the scroll container', () => {
    const listBodyRef = createRef<HTMLDivElement>()
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[bundledEntry('idle01')]}
        controller={makeController({ items: [] })}
        selectedId=""
        onSelect={() => {}}
        listBodyRef={listBodyRef}
      />,
    )
    expect(listBodyRef.current).toHaveClass('gc-list-body')
    expect(listBodyRef.current?.querySelector('[data-clip-id="idle01"]')).toBeTruthy()
  })

  it('shows error without leaking provider tokens', () => {
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={makeController({
          error: 'Unauthorized',
          items: [],
        })}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Unauthorized')
    expect(screen.getByRole('alert').textContent).not.toMatch(/token|bearer/i)
  })

  it('shows empty state when no entries', () => {
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={makeController({ items: [], total: 0 })}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    expect(screen.getByText(/暂无视频素材/)).toBeTruthy()
  })
})

describe('VideoReplaceUpload', () => {
  const VideoReplaceUpload = (
    videoAssetLibraryModule as typeof videoAssetLibraryModule & {
      VideoReplaceUpload?: (props: {
        entry?: VideoLibraryEntry
        uploading: boolean
        onReplace: (resourceId: string, file: File) => Promise<unknown>
      }) => JSX.Element | null
    }
  ).VideoReplaceUpload

  it('replaces an API preview through a real file input using the same resource id', async () => {
    expect(VideoReplaceUpload).toBeTypeOf('function')
    if (!VideoReplaceUpload) return
    const onReplace = vi.fn(async () => undefined)
    const entry = apiEntry('res-existing', 'Existing clip')
    render(<VideoReplaceUpload entry={entry} uploading={false} onReplace={onReplace} />)
    const input = screen.getByLabelText('重新上传 Existing clip') as HTMLInputElement
    const file = new File(['video'], 'replacement.mp4', { type: 'video/mp4' })

    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', 'video/mp4')
    expect(input).not.toHaveAttribute('hidden')
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(onReplace).toHaveBeenCalledWith('res-existing', file))
    expect(input.value).toBe('')
  })

  it('does not render replacement for bundled or generated previews', () => {
    expect(VideoReplaceUpload).toBeTypeOf('function')
    if (!VideoReplaceUpload) return
    const { rerender } = render(
      <VideoReplaceUpload
        entry={bundledEntry('idle01')}
        uploading={false}
        onReplace={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText(/重新上传/)).toBeNull()

    rerender(
      <VideoReplaceUpload
        entry={{
          id: 'generated',
          label: 'Generated',
          url: '/generated.mp4',
          group: '生成',
          fromRegistry: true,
        }}
        uploading={false}
        onReplace={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText(/重新上传/)).toBeNull()
  })
})
