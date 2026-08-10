import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { setLocale } from '../../../../i18n'
import {
  VideoGenSheet,
  type VideoGenSheetProps,
} from '../VideoGenSheet'
import type { ClipGenerationRequest } from '../generation-api'
import { VideoAssetLibrary } from '../../VideoAssetLibrary'

const IMAGE_ASSETS: VideoGenSheetProps['imageAssets'] = [
  { id: 'char-1', resourceId: 'kino-char-1', label: 'Hero', kind: 'character_ref', thumbUrl: '/hero.png' },
  { id: 'scene-1', resourceId: 'kino-scene-1', label: 'Street', kind: 'scene_ref', thumbUrl: '/street.png' },
  { id: 'key-1', resourceId: 'kino-key-1', label: 'Keyframe', kind: 'keyframe', thumbUrl: '/key.png' },
]

function renderSheet(overrides: Partial<VideoGenSheetProps> = {}) {
  const onSubmit = vi.fn<(request: ClipGenerationRequest) => void>()
  const onClose = vi.fn()
  const onCancel = vi.fn()
  const onTrack = vi.fn()
  const onLocateAsset = vi.fn()
  const props: VideoGenSheetProps = {
    open: true,
    gameSlug: 'demo',
    imageAssets: IMAGE_ASSETS,
    recentClips: [],
    genState: { phase: 'idle' },
    availableModels: [],
    onSubmit,
    onCancel,
    onTrack,
    onClose,
    onLocateAsset,
    ...overrides,
  }
  const view = render(<VideoGenSheet {...props} />)
  return { ...view, props, onSubmit, onCancel, onTrack, onClose, onLocateAsset }
}

function chooseMode(mode: 'strict' | 'firstref' | 'ref' | 't2v'): void {
  fireEvent.change(screen.getByLabelText('生成模式'), { target: { value: mode } })
}

function fillPrompt(value = '雨夜街道上的追逐镜头'): void {
  fireEvent.change(screen.getByRole('textbox', { name: '视频提示词' }), { target: { value } })
}

function pickImage(assetName: string): void {
  fireEvent.click(screen.getByRole('button', { name: assetName }))
}

describe('VideoGenSheet', () => {
  beforeEach(() => {
    setLocale('zh')
  })

  it('does not render a closed panel and renders the titled two-column workbench when open', () => {
    const { rerender, props, container } = renderSheet({ open: false })
    expect(screen.queryByRole('dialog', { name: '生成视频素材' })).not.toBeInTheDocument()

    rerender(<VideoGenSheet {...props} open />)

    expect(screen.getByRole('dialog', { name: '生成视频素材' })).toBeInTheDocument()
    expect(container.querySelector('.vgen-body')).toBeInTheDocument()
    expect(container.querySelectorAll('.vgen-column')).toHaveLength(2)
  })

  it('keeps the page variant as a route workspace instead of the sheet dialog', () => {
    const { container } = renderSheet({ variant: 'page' })

    expect(screen.getByRole('main', { name: '生成视频素材' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(container.querySelector('.vgen-settings')).toBeInTheDocument()
    expect(container.querySelector('.vgen-preview-stage')).toBeInTheDocument()
    expect(container.querySelector('.vgen-composer')).toBeInTheDocument()
    expect(container.querySelector('form')).not.toBeInTheDocument()
  })

  it('uses React button handlers instead of native form submission inside the sandboxed iframe', () => {
    const { container, onSubmit } = renderSheet({ variant: 'page' })
    expect(container.querySelector('form')).not.toBeInTheDocument()

    fillPrompt('雨夜街道上的追逐镜头')
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '雨夜街道上的追逐镜头',
      mode: 't2v',
    }))
  })

  it('restores the durable Kino prompt when reopening an active task', () => {
    renderSheet({
      variant: 'page',
      genState: {
        phase: 'generating',
        generationId: 'generation-1',
        prompt: '刷新前保存的提示词',
      },
    })

    expect(screen.getByRole('textbox', { name: '视频提示词' })).toHaveValue('刷新前保存的提示词')
    expect(screen.getByRole('button', { name: '生成中' })).toBeDisabled()
  })

  it('maps the Figma page controls onto the real generation request', () => {
    const { onSubmit } = renderSheet({ variant: 'page' })

    expect(screen.getByRole('tab', { name: '文生视频' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('开始创造独属自己的资源，建造独一无二的游戏体验')).toBeInTheDocument()
    expect(screen.getByLabelText('生成音频')).toBeChecked()

    fireEvent.click(screen.getByRole('tab', { name: '文生视频' }))
    fillPrompt('海港中的追逐镜头')
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: '海港中的追逐镜头',
      mode: 't2v',
      durationSeconds: 5,
      generateAudio: true,
    }))
  })

  it('keeps the page submit action responsive and shows prompt validation when empty', () => {
    const { onSubmit } = renderSheet({ variant: 'page' })
    const submit = screen.getByRole('button', { name: '生成视频' })
    expect(submit).toBeEnabled()

    fireEvent.click(submit)

    expect(screen.getByRole('alert')).toHaveTextContent('请输入视频提示词。')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('loads Kino visual styles on demand and submits the selected style key', async () => {
    const loadVisualStyles = vi.fn(async () => [{
      key: 'bwcinema',
      label: '黑白电影风格',
      cdnUrl: 'https://example.com/bwcinema.jpg',
      tags: ['真人'],
      order: 1,
    }])
    const { onSubmit } = renderSheet({ variant: 'page', loadVisualStyles })

    fireEvent.click(screen.getByRole('button', { name: '风格' }))
    expect(await screen.findByRole('dialog', { name: '风格选择' })).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: '黑白电影风格' }))
    expect(loadVisualStyles).toHaveBeenCalledTimes(1)

    fillPrompt('黑白雨夜中的追逐镜头')
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mode: 't2v',
      visualStyleKey: 'bwcinema',
    }))
  })

  it('shows the real generated video in the designed player and applies its asset id', () => {
    const { onLocateAsset } = renderSheet({
      variant: 'page',
      genState: { phase: 'succeeded', transport: 'kino', assetId: 'host-video-1' },
      recentClips: [{
        id: 'host-video-1',
        label: 'Generated Host asset',
        createdAt: 100,
        status: 'ready',
        playbackUrl: '/host-video-1.mp4',
      }],
    })

    expect(screen.getByTestId('generation-preview')).toHaveAttribute('src', '/host-video-1.mp4')
    expect(screen.getByRole('button', { name: '播放' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '视频播放进度' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '应用' }))
    expect(onLocateAsset).toHaveBeenCalledWith('host-video-1')
  })

  it('renders the English generation resource without falling back to translation keys', () => {
    setLocale('en')
    renderSheet()
    expect(screen.getByRole('dialog', { name: 'Generate video asset' })).toBeInTheDocument()
    expect(screen.getByLabelText('Generation mode')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate video' })).toBeInTheDocument()
  })

  it('localizes the full-page Figma controls and player labels', () => {
    setLocale('en')
    renderSheet({ variant: 'page' })
    expect(screen.getByRole('tab', { name: 'Text to video' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Reference to video' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Style' })).toBeInTheDocument()
    expect(screen.getByLabelText('Video generator')).toBeInTheDocument()
    expect(screen.getByText('Prompt tools')).toBeInTheDocument()
  })

  it.each([
    ['strict', true, true, false, '严格使用首帧与尾帧控制镜头起止。'],
    ['firstref', true, false, false, '使用首帧作为画面起点，其余内容由提示词生成。'],
    ['ref', false, false, true, '参考图用于保持角色、场景或风格一致，最多 9 张。'],
    ['t2v', false, false, false, '仅依据提示词生成视频，不使用图片参考。'],
  ] as const)('switches %s mode fields and guidance', (mode, first, last, refs, tip) => {
    renderSheet()
    chooseMode(mode)

    expect(screen.queryByRole('button', { name: '选择首帧' }) !== null).toBe(first)
    expect(screen.queryByRole('button', { name: '选择尾帧' }) !== null).toBe(last)
    expect(screen.queryByText('参考图') !== null).toBe(refs)
    expect(screen.getByText(tip)).toBeInTheDocument()
  })

  it('offers the four Kino sizes and both resolutions as user-selectable values', () => {
    renderSheet()

    const ratio = screen.getByLabelText('画幅') as HTMLSelectElement
    const resolution = screen.getByLabelText('清晰度') as HTMLSelectElement
    const duration = screen.getByLabelText('时长（秒）') as HTMLInputElement
    expect(ratio).toBeEnabled()
    expect(within(ratio).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '16:9 (2560×1440)',
      '9:16 (1440×2560)',
      '3:2 (2496×1664)',
      '2:3 (1664×2496)',
    ])
    expect(within(ratio).queryByRole('option', { name: /1:1|4:3/ })).not.toBeInTheDocument()
    expect(ratio.value).toBe('2560x1440')
    expect(screen.getByText('2560×1440')).toBeInTheDocument()

    expect(resolution).toBeEnabled()
    expect(within(resolution).getAllByRole('option').map((option) => option.textContent)).toEqual([
      '720p',
      '1080p',
    ])
    expect(resolution.value).toBe('720p')

    fireEvent.change(ratio, { target: { value: '2496x1664' } })
    expect(screen.getByText('2496×1664')).toBeInTheDocument()
    expect(duration).toHaveAttribute('min', '1')
    expect(duration).toHaveAttribute('max', '15')
    expect(duration.value).toBe('8')
    expect(screen.getByRole('button', { name: '生成视频' })).toBeDisabled()
  })

  it('locks model selection until more than one model is advertised', () => {
    const view = renderSheet()
    const serverManaged = screen.getByLabelText('模型') as HTMLSelectElement
    expect(serverManaged).toBeDisabled()
    expect(serverManaged).toHaveValue('')
    expect(within(serverManaged).getByRole('option')).toHaveTextContent('服务端默认')
    expect(screen.getByText('模型由服务端配置')).toBeInTheDocument()
    chooseMode('t2v')
    fillPrompt()
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(view.onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('model')
    view.onSubmit.mockClear()

    view.rerender(<VideoGenSheet {...view.props} availableModels={['video-primary']} />)
    const singleModel = screen.getByLabelText('模型') as HTMLSelectElement
    expect(singleModel).toBeDisabled()
    expect(singleModel).toHaveValue('video-primary')
    chooseMode('t2v')
    fillPrompt()
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(view.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: 'video-primary' }))
    view.onSubmit.mockClear()

    view.rerender(<VideoGenSheet {...view.props} availableModels={['video-primary', 'video-fast']} />)
    const multipleModels = screen.getByLabelText('模型') as HTMLSelectElement
    expect(multipleModels).toBeEnabled()
    chooseMode('t2v')
    fillPrompt()
    fireEvent.change(multipleModels, { target: { value: 'video-fast' } })
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(view.onSubmit).toHaveBeenCalledWith(expect.objectContaining({ model: 'video-fast' }))
  })

  it('validates strict inputs and submits the complete request after both frames are selected', () => {
    const { onSubmit } = renderSheet()
    fillPrompt()

    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(screen.getByRole('alert')).toHaveTextContent('严格首尾帧模式需要同时选择首帧和尾帧。')
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '选择首帧' }))
    pickImage('Hero')
    fireEvent.click(screen.getByRole('button', { name: '选择尾帧' }))
    pickImage('Street')
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '12' } })
    fireEvent.click(screen.getByLabelText('生成音频'))
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))

    expect(onSubmit).toHaveBeenCalledWith({
      gameSlug: 'demo',
      prompt: '雨夜街道上的追逐镜头',
      durationSeconds: 12,
      generateAudio: true,
      mode: 'strict',
      size: '2560x1440',
      resolution: '720p',
      firstFrameResourceId: 'kino-char-1',
      lastFrameResourceId: 'kino-scene-1',
    })
  })

  it('clamps duration and lets the user drive the Kino provider parameters', () => {
    const { onSubmit } = renderSheet({
      genState: { phase: 'idle', transport: 'kino' },
      availableModels: ['seedance2', 'seedance2-fast'],
    })
    chooseMode('t2v')
    fillPrompt()

    expect(screen.getByLabelText('画幅')).toBeEnabled()
    expect(screen.getByLabelText('清晰度')).toBeEnabled()
    expect(screen.getByLabelText('模型')).toBeEnabled()
    expect(screen.getByLabelText('时长（秒）')).toHaveAttribute('max', '15')

    fireEvent.change(screen.getByLabelText('画幅'), { target: { value: '1440x2560' } })
    fireEvent.change(screen.getByLabelText('清晰度'), { target: { value: '1080p' } })
    fireEvent.change(screen.getByLabelText('时长（秒）'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      durationSeconds: 15,
      size: '1440x2560',
      resolution: '1080p',
      model: 'seedance2',
    }))
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('firstFrameResourceId')
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('lastFrameResourceId')
  })

  it.each([
    [{ phase: 'generating', transport: 'kino', assetId: 'clip-1' } as const, '生成中', true],
    [{ phase: 'succeeded', assetId: 'clip-1' } as const, '已完成', false],
    [{ phase: 'failed', assetId: 'clip-1', error: '上游拒绝请求' } as const, '失败', false],
  ])('renders output state $1', (genState, status, running) => {
    renderSheet({
      genState,
      recentClips: [{
        id: 'clip-1',
        label: 'Rain chase',
        createdAt: 100,
        status: genState.phase === 'succeeded' ? 'ready' : genState.phase === 'failed' ? 'failed' : 'generating',
        playbackUrl: '/clip-1.mp4',
      }],
    })

    expect(screen.getByTestId('generation-status')).toHaveTextContent(status)
    expect(screen.queryByTestId('generation-progress') !== null).toBe(running)
    if (genState.phase === 'generating') {
      expect(screen.getByRole('button', { name: '生成中' })).toBeDisabled()
      expect(screen.getByRole('button', { name: '生成中' })).toHaveClass('running')
    }
    if (genState.phase === 'succeeded') {
      expect(screen.getByTestId('generation-preview')).toHaveAttribute('src', '/clip-1.mp4')
      fillPrompt()
      expect(screen.getByRole('button', { name: '再次生成' })).toBeEnabled()
    }
    if (genState.phase === 'failed') {
      expect(screen.getByRole('alert')).toHaveTextContent('上游拒绝请求')
    }
  })

  it('offers local cancellation while truthfully warning that the cloud task may continue', () => {
    const { onCancel } = renderSheet({
      genState: { phase: 'generating', transport: 'kino', assetId: 'clip-1' },
    })

    fireEvent.click(screen.getByRole('button', { name: '取消跟踪' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(screen.getByText('仅停止本地跟踪，云端任务可能继续运行并最终进入素材库。')).toBeInTheDocument()
  })

  it('previews the generated Host registry asset by asset id', () => {
    renderSheet({
      genState: { phase: 'succeeded', transport: 'kino', assetId: 'host-video-1' },
      recentClips: [{
        id: 'host-video-1',
        label: 'Generated Host asset',
        createdAt: 100,
        status: 'ready',
        playbackUrl: '/host-video-1.mp4',
      }],
    })
    expect(screen.getByTestId('generation-preview')).toHaveAttribute('src', '/host-video-1.mp4')
  })

  it('closes with Escape and backdrop clicks, preserving a background-task notice', () => {
    const { onClose, container } = renderSheet({
      genState: { phase: 'generating', assetId: 'clip-1' },
    })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('生成中，可关闭面板，完成后出现在素材库')

    fireEvent.click(container.querySelector('.vgen-backdrop')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('locates a recent clip through the existing asset selection callback', () => {
    const { onLocateAsset } = renderSheet({
      recentClips: [{ id: 'clip-1', label: 'Rain chase', createdAt: 100, status: 'ready' }],
    })
    const history = screen.getByRole('region', { name: '历史记录' })
    fireEvent.click(within(history).getByRole('button', { name: /Rain chase/ }))
    expect(onLocateAsset).toHaveBeenCalledWith('clip-1')
  })

  it('caps reference images at nine and submits all selected ids', () => {
    const nineAssets: VideoGenSheetProps['imageAssets'] = Array.from({ length: 10 }, (_, index) => ({
      id: `ref-${index + 1}`,
      resourceId: `kino-ref-${index + 1}`,
      label: `Reference ${index + 1}`,
      kind: 'keyframe',
      thumbUrl: `/ref-${index + 1}.png`,
    }))
    const { onSubmit } = renderSheet({ imageAssets: nineAssets })
    chooseMode('ref')
    fillPrompt('多图一致性镜头')

    for (const asset of nineAssets.slice(0, 9)) {
      fireEvent.click(screen.getByRole('button', { name: '添加参考图' }))
      pickImage(asset.label)
    }

    expect(screen.queryByRole('button', { name: '添加参考图' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /移除参考图/ })).toHaveLength(9)
    fireEvent.click(screen.getByRole('button', { name: '生成视频' }))
    expect(onSubmit.mock.calls[0]?.[0].referenceImageResourceIds).toEqual(
      nineAssets.slice(0, 9).map((asset) => asset.resourceId),
    )
    expect(onSubmit.mock.calls[0]?.[0]).not.toHaveProperty('referenceImageAssetIds')
  })

  it('keeps the generation entry visible and disables it until a handler is supplied', () => {
    const onOpenGenerate = vi.fn()
    const controller = {
      loading: false,
      error: null,
      items: [],
      total: 0,
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
      importExternal: vi.fn(async () => undefined),
      replaceResource: vi.fn(async () => undefined),
      renameResource: vi.fn(async () => undefined),
      retryComplete: vi.fn(async () => undefined),
      deleteResource: vi.fn(async () => {}),
      deleteResources: vi.fn(async () => ({ completed: 0 })),
    }
    const view = render(
      <VideoAssetLibrary
        gameId="demo"
        scenario={{ version: 'wb-game-video.graph.v1', graph: { nodes: [], edges: [] } }}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
        onOpenGenerate={onOpenGenerate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '生成' }))
    expect(onOpenGenerate).toHaveBeenCalledTimes(1)

    view.rerender(
      <VideoAssetLibrary
        gameId="demo"
        scenario={{ version: 'wb-game-video.graph.v1', graph: { nodes: [], edges: [] } }}
        controller={controller}
        selectedId=""
        onSelect={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '生成' })).toBeDisabled()
  })
})
