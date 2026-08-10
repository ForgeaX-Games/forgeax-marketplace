import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlueprintDoc, GameGraph } from '../../../runtime/schema/graph-schema'
import { writeVideoLibraryEntryTag, writeVideoLibraryFolderName } from '../../assets/video-library-metadata'
import { setLocale } from '../../../i18n'
import { useGraphScenario } from '../../persist/graphScenarioStore'
import { useGraphView } from '../../persist/graphViewStore'
import { useVideoLibraryNav } from '../../persist/videoLibraryNavStore'
import { NewSidebar } from '../NewSidebar'

const videos = vi.hoisted(() => [
  { id: 'video-outdoor', label: '户外运镜.mp4', url: '/outdoor.mp4' },
  { id: 'video-root', label: '无标签视频.mp4', url: '/root.mp4' },
])

vi.mock('../../assets/useVideoAssets', () => ({
  useVideoAssets: () => ({ items: videos }),
}))

vi.mock('../../assets/use-asset-browser', () => ({
  useAssetBrowser: () => ({
    entries: [],
    directory: {
      assetLibrary: { version: 1, folders: [], placements: {} },
      loading: false,
      saving: false,
      error: null,
      refresh: vi.fn(),
      save: vi.fn(),
    },
  }),
}))

const initialScenario = useGraphScenario.getState()
const emptyGraph: GameGraph = { nodes: [], edges: [] }
const main: BlueprintDoc = { id: 'main', title: '主蓝图', entry: 'entry', graph: emptyGraph }

beforeEach(() => {
  setLocale('zh')
  localStorage.clear()
  useGraphView.setState({ view: 'graph' })
  useVideoLibraryNav.setState({ folder: { kind: 'all' }, entryId: null })
  useGraphScenario.setState({
    game: 'demo',
    booted: true,
    blueprints: { main },
    mainBlueprintId: 'main',
    activeBlueprintId: 'main',
    graph: emptyGraph,
    meta: {},
  })
  writeVideoLibraryFolderName('demo', '户外')
  writeVideoLibraryEntryTag('demo', 'video-outdoor', '户外')
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  useGraphScenario.setState(initialScenario, true)
  useVideoLibraryNav.setState({ folder: { kind: 'all' }, entryId: null })
})

describe('NewSidebar video asset hierarchy', () => {
  it('matches the Figma rail and groups tagged videos below first-level folders', () => {
    render(<NewSidebar />)

    const sidebar = screen.getByRole('complementary', { name: /视频游戏工坊/ })
    const css = document.querySelector('style[data-reel-style="new-sidebar"]')?.textContent
    expect(css).toContain('width: 196px')
    expect(css).toContain('padding: 0')
    expect(css).toContain('.ns-leading svg { display: block; width: 12px; height: 12px; }')
    const assetLibraryIcon = sidebar.querySelector('.ns-leading > svg')
    expect(sidebar.querySelector('.ns-leading img')).toBeNull()
    expect(assetLibraryIcon).toHaveAttribute('width', '12')
    expect(assetLibraryIcon).toHaveAttribute('height', '12')
    expect(assetLibraryIcon?.querySelector('path')).toHaveAttribute('fill', 'currentColor')

    const folderRow = screen.getByText('户外').closest<HTMLElement>('.ns-row')!
    const untaggedRow = screen.getByText('无标签视频.mp4').closest<HTMLElement>('.ns-row')!
    expect(folderRow.style.paddingLeft).toBe('16px')
    expect(untaggedRow.style.paddingLeft).toBe('16px')
    expect(untaggedRow.querySelector('.ns-chev-spacer')).toBeTruthy()
    expect(screen.queryByText('户外运镜.mp4')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '展开 户外' }))
    const taggedVideoRow = screen.getByText('户外运镜.mp4').closest<HTMLElement>('.ns-row')!
    expect(taggedVideoRow.style.paddingLeft).toBe('24px')
    expect(taggedVideoRow.querySelector('.ns-chev-spacer')).toBeTruthy()
  })

  it('routes video roots, folders, and real entries to the video material page', () => {
    render(<NewSidebar />)

    fireEvent.click(screen.getByText('视频').closest<HTMLElement>('.ns-row')!)
    expect(useGraphView.getState().view).toBe('video')
    expect(useVideoLibraryNav.getState()).toMatchObject({ folder: { kind: 'all' }, entryId: null })

    fireEvent.click(screen.getByText('户外').closest<HTMLElement>('.ns-row')!)
    expect(useVideoLibraryNav.getState()).toMatchObject({ folder: { kind: 'tag', name: '户外' }, entryId: null })

    fireEvent.click(screen.getByText('户外运镜.mp4').closest<HTMLElement>('.ns-row')!)
    expect(useVideoLibraryNav.getState()).toMatchObject({
      folder: { kind: 'tag', name: '户外' },
      entryId: 'video-outdoor',
    })

    fireEvent.click(screen.getByText('无标签视频.mp4').closest<HTMLElement>('.ns-row')!)
    expect(useVideoLibraryNav.getState()).toMatchObject({
      folder: { kind: 'untagged' },
      entryId: 'video-root',
    })
  })

  it('refreshes first-level folders after same-document metadata writes', () => {
    render(<NewSidebar />)
    expect(screen.queryByText('战斗')).toBeNull()

    act(() => {
      writeVideoLibraryFolderName('demo', '战斗')
    })

    expect(screen.getByText('战斗')).toBeTruthy()
  })

  it('creates a video folder from the sidebar on Enter and validates only after an attempt', () => {
    render(<NewSidebar videoItems={videos} />)

    fireEvent.click(screen.getByText('新增文件夹').closest<HTMLElement>('.ns-row')!)
    const input = screen.getByLabelText('文件夹名称')
    expect(input.closest('form')).toBeNull()
    expect(screen.queryByText('文件夹名称不能为空')).toBeNull()

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert')).toHaveTextContent('文件夹名称不能为空')

    fireEvent.change(input, { target: { value: '剧情' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(screen.queryByLabelText('文件夹名称')).toBeNull()
    expect(screen.getByText('剧情')).toBeInTheDocument()
    expect(useGraphView.getState().view).toBe('video')
    expect(useVideoLibraryNav.getState()).toMatchObject({
      folder: { kind: 'tag', name: '剧情' },
      entryId: null,
    })
  })
})
