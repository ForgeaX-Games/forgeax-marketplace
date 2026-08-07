import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GraphVideoPreviewPanel } from '../GraphVideoPreviewPanel'

afterEach(cleanup)

describe('GraphVideoPreviewPanel', () => {
  it('在全屏弹窗中复用自定义播放组件，而不是再渲染原生控制条', async () => {
    render(
      <GraphVideoPreviewPanel
        timelineEntry={{
          id: 'video-1',
          label: '开场动画',
          url: '/assets/intro.mp4',
          group: '上传',
        }}
        previewSrc="/assets/intro.mp4"
        maxMs={65_000}
        fullscreenRequest={1}
        fullscreenOnly
        uploading={false}
        onReplace={vi.fn(async () => undefined)}
        onDurationChange={vi.fn()}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: '开场动画' })
    const video = dialog.querySelector('video')

    expect(video).not.toBeNull()
    expect(video?.classList.contains('gc-video')).toBe(true)
    expect(video?.hasAttribute('controls')).toBe(false)
    expect(dialog.querySelector('.gvv-controls')).not.toBeNull()
    expect(document.querySelectorAll('.gvv-video-col')).toHaveLength(1)
  })
})
