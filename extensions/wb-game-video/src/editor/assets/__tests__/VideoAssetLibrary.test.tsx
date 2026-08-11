import { createRef } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { GameScenario } from '../../../runtime/schema/graph-schema'
import { setLocale } from '../../../i18n'
import * as videoAssetLibraryModule from '../VideoAssetLibrary'
import { VideoAssetLibrary, type VideoAssetsController, type VideoLibraryEntry } from '../VideoAssetLibrary'
import type { KinoResourceDTO } from '../kino-api'
import { writeVideoLibraryEntryTag, writeVideoLibraryFolderName } from '../video-library-metadata'

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

function openCardMenu(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: `打开 ${label} 操作菜单` }))
}

function uploadedResource(id: string): KinoResourceDTO {
  return {
    resource_id: id,
    game_id: 'demo',
    media_type: 'video',
    url: `http://object/${id}`,
    name: id,
    source: 'upload',
    created_at: 1,
    updated_at: 1,
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
    deleteResources: vi.fn(async () => ({ completed: 0 })),
    ...overrides,
  } as VideoAssetsController
}

describe('VideoAssetLibrary', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    setLocale('zh')
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
    expect(screen.getByRole('button', { name: 'Clip one' })).toHaveClass('is-on')
  })

  it('renders an active generation first and reopens its durable task instead of video preview', () => {
    const onOpenGeneration = vi.fn()
    const onSelect = vi.fn()
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        supplementalEntries={[{
          id: 'generation:generation-1',
          generationId: 'generation-1',
          label: '雨夜追逐镜头',
          url: '',
          group: '生成视频',
          status: 'generating',
        }]}
        controller={makeController()}
        selectedId=""
        onSelect={onSelect}
        onOpenGeneration={onOpenGeneration}
      />,
    )

    const buttons = screen.getAllByRole('button')
    expect(buttons.findIndex((button) => button.getAttribute('aria-label') === '生成视频 · 雨夜追逐镜头'))
      .toBeLessThan(buttons.findIndex((button) => button.getAttribute('aria-label') === 'Clip one'))
    fireEvent.click(screen.getByRole('button', { name: '生成视频 · 雨夜追逐镜头' }))
    expect(onOpenGeneration).toHaveBeenCalledWith('generation-1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('applies sidebar folder requests and reports local folder changes', () => {
    const onFolderChange = vi.fn()
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        controller={makeController()}
        selectedId=""
        requestedFolder="untagged"
        onFolderChange={onFolderChange}
        onSelect={() => {}}
      />,
    )

    expect(screen.getByLabelText('视频素材路径')).toHaveTextContent('未分类')
    fireEvent.click(screen.getByRole('button', { name: '视频素材' }))
    expect(onFolderChange).toHaveBeenCalledWith('all')
  })

  it('validates a new folder only after blur or submit and creates it on Enter', () => {
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        controller={makeController({ items: [] })}
        selectedId=""
        onSelect={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    const input = screen.getByLabelText('文件夹名称')
    expect(input.closest('form')).toBeNull()
    expect(screen.queryByText('文件夹名称不能为空')).toBeNull()

    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toHaveTextContent('文件夹名称不能为空')

    fireEvent.change(input, { target: { value: '战斗镜头' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByLabelText('视频素材路径')).toHaveTextContent('战斗镜头')
  })

  it('places first-level folders beside untagged videos and opens a folder into its flat real-video list', () => {
    writeVideoLibraryFolderName('demo', '户外')
    writeVideoLibraryEntryTag('demo', 'tagged-video', '户外')
    const controller = makeController({
      items: [apiEntry('untagged-video', '未分类视频'), apiEntry('tagged-video', '户外视频')],
    })
    const onFolderChange = vi.fn()
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        controller={controller}
        selectedId=""
        onFolderChange={onFolderChange}
        onSelect={() => {}}
      />,
    )

    expect(screen.getByRole('button', { name: '户外 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '未分类视频' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '户外视频' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '户外 1' }))
    expect(onFolderChange).toHaveBeenCalledWith('户外')
    expect(screen.getByRole('button', { name: '户外视频' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '未分类视频' })).not.toBeInTheDocument()
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

    expect(labels).toEqual(['Clip one', '战斗 · idle01'])
  })

  it('reacts to host locale changes', () => {
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={makeController()}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    expect(screen.getByLabelText('上传视频')).toBeTruthy()

    act(() => setLocale('en'))

    expect(screen.getByLabelText('Upload video')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open actions for Clip one' }))
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy()
  })

  it('groups generation, local upload, and external import before library status', () => {
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
    const head = container.querySelector('.val-library-head')
    expect(head).toBeTruthy()
    const children = [...head!.children]
    const sources = head!.querySelector('.val-library-sources')
    const upload = head!.querySelector('.val-head-upload')
    const actions = head!.querySelector('.val-library-actions')
    const statusRow = container.querySelector('.val-library-status-row')
    const status = statusRow!.querySelector('.val-head-status')
    const count = statusRow!.querySelector('.val-library-count')

    expect(children[0]).toBe(sources)
    expect(children[1]).toBe(actions)
    expect(within(sources as HTMLElement).getByRole('button', { name: '生成' })).toBeTruthy()
    expect(within(sources as HTMLElement).getByRole('button', { name: '外部视频导入' })).toBeDisabled()
    expect(sources as HTMLElement).toContainElement(upload as HTMLElement)
    expect(status).toBeTruthy()
    expect(statusRow).toContainElement(status as HTMLElement)
    expect(statusRow).toContainElement(count as HTMLElement)
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
    expect(input).toHaveAttribute('multiple')
    expect(input).not.toHaveAttribute('hidden')
    expect(input).not.toHaveStyle({ display: 'none' })
    expect(input).toHaveClass('val-head-upload-input')
    expect(label).toHaveClass('val-head-upload')
    expect(label).toContainElement(input)
    expect(container.querySelector('.val-library-head')?.firstElementChild).toHaveClass('val-library-sources')
    expect(input.tabIndex).toBe(0)
  })

  it('opens the host-owned external import entry when supplied', () => {
    const onOpenExternalImport = vi.fn()
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={makeController()}
        selectedId=""
        onSelect={() => {}}
        onOpenExternalImport={onOpenExternalImport}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '外部视频导入' }))
    expect(onOpenExternalImport).toHaveBeenCalledTimes(1)
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

  it('uploads multiple selected videos in order and selects each completed resource', async () => {
    const onSelect = vi.fn()
    const upload = vi.fn(async (file: File) => uploadedResource(file.name))
    const controller = makeController({ upload })
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={onSelect}
      />,
    )
    const input = screen.getByLabelText('上传视频') as HTMLInputElement
    const first = new File(['first'], 'first.mp4', { type: 'video/mp4' })
    const second = new File(['second'], 'second.mp4', { type: 'video/mp4' })

    fireEvent.change(input, { target: { files: [first, second] } })

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(upload.mock.calls.map(([file]) => file)).toEqual([first, second])
    expect(onSelect.mock.calls).toEqual([['first.mp4'], ['second.mp4']])
    await waitFor(() => expect(screen.queryByText(/批量 \d+\/2/)).toBeNull())
  })

  it('stops a batch on failure and reports the completed file count', async () => {
    const upload = vi.fn()
      .mockResolvedValueOnce(uploadedResource('first'))
      .mockResolvedValueOnce(undefined)
    const controller = makeController({ upload })
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
    const files = [
      new File(['first'], 'first.mp4', { type: 'video/mp4' }),
      new File(['second'], 'second.mp4', { type: 'video/mp4' }),
      new File(['third'], 'third.mp4', { type: 'video/mp4' }),
    ]

    fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('alert')).toHaveTextContent(
      '批量上传在「second.mp4」失败，已完成 1/3 个文件。请处理失败项后重新选择剩余文件。',
    )
    expect(screen.getByRole('status')).toHaveTextContent('批量 2/3')
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
    const statusRow = container.querySelector('.val-library-status-row')
    const status = within(statusRow as HTMLElement).getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('上传 42%')
    expect(status).toHaveTextContent('完成失败')
    expect(within(statusRow as HTMLElement).getByRole('button', { name: '重试完成上传' })).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: '更多视频操作' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '刷新视频库' }))
    await waitFor(() => expect(controller.refresh).toHaveBeenCalledOnce())
  })

  it('exposes rename and delete for api entries', () => {
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
    openCardMenu('Clip one')
    const renameButton = screen.getByRole('menuitem', { name: '重命名' })
    const deleteButton = screen.getByRole('menuitem', { name: '删除' })
    const assetButton = screen.getByRole('button', { name: 'Clip one' })
    const row = deleteButton.closest('.val-row')

    expect(row).toHaveClass('is-on')
    expect(assetButton.parentElement).toBe(row)
    expect(deleteButton.closest('.val-card-actions')?.parentElement).toBe(row)
    expect(renameButton.closest('.val-card-menu')).toBe(deleteButton.closest('.val-card-menu'))
    expect(assetButton.querySelector('.gc-row-mark')).toBeNull()

    fireEvent.click(deleteButton)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(container.querySelector('.val-row-actions')).toBeNull()
  })

  it('renames an api entry without selecting it', async () => {
    const controller = makeController({ items: [apiEntry('res-1', 'Old name')] })
    const onSelect = vi.fn()
    render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={EMPTY_SCENARIO}
        bundledEntries={[]}
        controller={controller}
        selectedId=""
        onSelect={onSelect}
      />,
    )

    openCardMenu('Old name')
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const input = screen.getByLabelText('名称')
    expect(input).toHaveValue('Old name')
    fireEvent.change(input, { target: { value: '  New name  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(controller.renameResource).toHaveBeenCalledWith('res-1', 'New name'))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the card menu from outside or Escape and restores keyboard focus', () => {
    const controller = makeController({ items: [apiEntry('res-1', 'Clip one')] })
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

    const trigger = screen.getByRole('button', { name: '打开 Clip one 操作菜单' })
    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('keeps the rename dialog open and validates errors', async () => {
    const controller = makeController({
      items: [apiEntry('res-1', 'Old name')],
      renameResource: vi.fn(async () => {
        throw new Error('Rename failed')
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

    openCardMenu('Old name')
    fireEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
    const input = screen.getByLabelText('名称')
    fireEvent.change(input, { target: { value: ' ' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.getByText('视频名称不能为空')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'New name' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(controller.renameResource).toHaveBeenCalledOnce())
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('alert')).toHaveTextContent('Rename failed')
  })

  it('keeps row actions out of the label layout until pointer or keyboard interaction', async () => {
    await import('../../shell/GraphVideoView')
    const css = document.querySelector<HTMLStyleElement>(
      'style[data-reel-style="graph-video-view"]',
    )?.textContent ?? ''

    expect(css).toMatch(/\.val-row\s*\{[^}]*position:\s*relative/)
    expect(css).toMatch(/\.val-row\s*>\s*\.gc-row\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.val-row\s+\.gc-row-label\s*\{[^}]*text-overflow:\s*ellipsis/)
    expect(css).toMatch(/\.val-card-actions\s*\{[^}]*position:\s*absolute/)
    expect(css).toMatch(/\.val-card-more\s*\{[^}]*width:\s*18px/)
    expect(css).toMatch(/\.val-card-menu\s*\{[^}]*width:\s*130px/)
    expect(css).toMatch(/\.val-row:hover\s*>\s*\.gc-row[^}]*padding-right:\s*0/)
    expect(css).toMatch(/\.val-row:hover\s+\.val-card-actions[^}]*opacity:\s*1/)
    expect(css).toMatch(/\.val-row\.has-open-menu\s+\.val-card-actions[^}]*opacity:\s*1/)
    expect(css).toMatch(/\.val-row:hover\s+\.val-card-thumb::after[^}]*opacity:\s*1/)
    expect(css).not.toMatch(/\.val-row\.is-on\s+\.val-card-actions/)
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
    openCardMenu('Used clip')
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
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
    openCardMenu('Unused clip')
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
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
    openCardMenu('Old name')
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
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
    const trigger = screen.getByRole('button', { name: '打开 Old name 操作菜单' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))

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
    expect(screen.getByRole('button', { name: '打开 Clip 操作菜单' })).toBeDisabled()

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
    expect(screen.getByRole('button', { name: '打开 Clip 操作菜单' })).toBeDisabled()
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
    expect(screen.queryByRole('button', { name: /打开.*idle01.*操作菜单/ })).toBeNull()
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
    expect(screen.queryByRole('button', { name: /打开.*Generated clip.*操作菜单/ })).toBeNull()
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
