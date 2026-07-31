import { act, fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipSnap } from '../../engine/session'
import { GameStage, type GameStageProps } from '../GameStage'

function clip(nodeId: string, mediaId = nodeId): ClipSnap {
  return { nodeId, mediaId, name: nodeId, loop: false }
}

function props(overrides: Partial<GameStageProps> = {}): GameStageProps {
  return {
    videoSrc: '/a.mp4',
    clip: clip('a'),
    overlayMounts: [],
    skins: undefined,
    skinCtx: undefined,
    onEmit: vi.fn(),
    onTick: vi.fn(),
    onPerformanceEnd: vi.fn(),
    ...overrides,
  }
}

function videoFor(container: HTMLElement, src: string): HTMLVideoElement {
  const video = [...container.querySelectorAll('video')]
    .find((element) => element.getAttribute('src') === src)
  if (!video) throw new Error(`video not found: ${src}`)
  return video
}

const frameCallbacks = new WeakMap<HTMLVideoElement, VideoFrameRequestCallback>()

function submitFrame(video: HTMLVideoElement): void {
  const callback = frameCallbacks.get(video)
  if (!callback) throw new Error('video frame callback not registered')
  act(() => callback(0, {} as VideoFrameCallbackMetadata))
}

describe('GameStage buffered playback', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', {
      configurable: true,
      value(this: HTMLVideoElement, callback: VideoFrameRequestCallback) {
        frameCallbacks.set(this, callback)
        return 1
      },
    })
  })

  it('keeps the current frame visible until the next video reaches the compositor', () => {
    const current = props()
    const { container, rerender } = render(<GameStage {...current} />)
    const first = videoFor(container, '/a.mp4')
    fireEvent.loadedData(first)

    rerender(<GameStage {...props({ videoSrc: '/b.mp4', clip: clip('b') })} />)
    const next = videoFor(container, '/b.mp4')

    expect(first).toHaveStyle({ opacity: '1' })
    expect(next).toHaveStyle({ opacity: '0' })

    fireEvent.loadedData(next)

    expect(first).toHaveStyle({ opacity: '1' })
    expect(next).toHaveStyle({ opacity: '0' })

    submitFrame(next)

    expect(first).toHaveStyle({ opacity: '0' })
    expect(next).toHaveStyle({ opacity: '1' })
  })

  it('pauses and resumes the active video while applying playback rate', () => {
    const pause = vi.spyOn(window.HTMLMediaElement.prototype, 'pause')
    const play = vi.spyOn(window.HTMLMediaElement.prototype, 'play')
    const { container, rerender } = render(<GameStage {...props({ paused: true, playbackRate: 2 })} />)
    const video = videoFor(container, '/a.mp4')
    fireEvent.loadedData(video)

    expect(video.playbackRate).toBe(2)
    expect(pause).toHaveBeenCalled()
    const playsWhilePaused = play.mock.calls.length

    rerender(<GameStage {...props({ paused: false, playbackRate: 0.5 })} />)
    expect(video.playbackRate).toBe(0.5)
    expect(play.mock.calls.length).toBeGreaterThan(playsWhilePaused)
  })

  it('reuses a preloaded video element instead of assigning its src during the switch', () => {
    const nextClip = clip('b')
    const { container, rerender } = render(
      <GameStage
        {...props({
          preloadVideos: [{ videoSrc: '/b.mp4', clip: nextClip }],
        })}
      />,
    )
    const first = videoFor(container, '/a.mp4')
    const preloaded = videoFor(container, '/b.mp4')
    fireEvent.loadedData(first)
    fireEvent.loadedData(preloaded)

    rerender(
      <GameStage
        {...props({
          videoSrc: '/b.mp4',
          clip: nextClip,
          preloadVideos: [],
        })}
      />,
    )

    const promoted = videoFor(container, '/b.mp4')
    expect(promoted).toBe(preloaded)
    expect(first).toHaveStyle({ opacity: '1' })

    fireEvent.loadedData(promoted)
    submitFrame(promoted)
    expect(promoted).toHaveStyle({ opacity: '1' })
  })

  it('only enables audio on the visible video slot', () => {
    const nextClip = clip('b')
    const { container, rerender } = render(
      <GameStage
        {...props({
          videoAudioEnabled: true,
          preloadVideos: [{ videoSrc: '/b.mp4', clip: nextClip }],
        })}
      />,
    )
    const first = videoFor(container, '/a.mp4')
    const preloaded = videoFor(container, '/b.mp4')

    expect(first.muted).toBe(false)
    expect(preloaded.muted).toBe(true)

    fireEvent.loadedData(first)
    fireEvent.loadedData(preloaded)
    rerender(
      <GameStage
        {...props({
          videoSrc: '/b.mp4',
          clip: nextClip,
          videoAudioEnabled: true,
        })}
      />,
    )
    fireEvent.loadedData(preloaded)
    submitFrame(preloaded)

    expect(first.muted).toBe(true)
    expect(preloaded.muted).toBe(false)
  })

  it('keeps the foreground video muted until audio is explicitly enabled', () => {
    const { container, rerender } = render(<GameStage {...props()} />)
    const video = videoFor(container, '/a.mp4')

    expect(video.muted).toBe(true)
    rerender(<GameStage {...props({ videoAudioEnabled: true })} />)
    expect(video.muted).toBe(false)
  })

  it('ignores media events from the retained old video', () => {
    const onTick = vi.fn()
    const onPerformanceEnd = vi.fn()
    const { container, rerender } = render(
      <GameStage {...props({ onTick, onPerformanceEnd })} />,
    )
    const first = videoFor(container, '/a.mp4')
    fireEvent.loadedData(first)

    rerender(
      <GameStage
        {...props({
          videoSrc: '/b.mp4',
          clip: clip('b'),
          onTick,
          onPerformanceEnd,
        })}
      />,
    )
    const next = videoFor(container, '/b.mp4')

    fireEvent.timeUpdate(first)
    fireEvent.ended(first)
    expect(onTick).not.toHaveBeenCalled()
    expect(onPerformanceEnd).not.toHaveBeenCalled()

    fireEvent.loadedData(next)
    submitFrame(next)
    fireEvent.ended(next)
    expect(onPerformanceEnd).toHaveBeenCalledTimes(1)
  })

  it('keeps looping video independent from the node duration cap', () => {
    const onTick = vi.fn()
    const onPerformanceEnd = vi.fn()
    const loopingClip = { ...clip('a'), loop: true, durationMs: 500 }
    const { container } = render(
      <GameStage {...props({ clip: loopingClip, onTick, onPerformanceEnd })} />,
    )
    const video = videoFor(container, '/a.mp4')
    Object.defineProperty(video, 'duration', { configurable: true, value: 1000 / 1000 })
    video.currentTime = 0.6

    fireEvent.timeUpdate(video)

    expect(onTick).toHaveBeenCalledWith(600)
    expect(onPerformanceEnd).not.toHaveBeenCalled()
  })

  it('does not activate a stale background load after a newer switch', () => {
    const { container, rerender } = render(<GameStage {...props()} />)
    const first = videoFor(container, '/a.mp4')
    fireEvent.loadedData(first)

    rerender(<GameStage {...props({ videoSrc: '/b.mp4', clip: clip('b') })} />)
    const stale = videoFor(container, '/b.mp4')
    rerender(<GameStage {...props({ videoSrc: '/c.mp4', clip: clip('c') })} />)
    const latest = videoFor(container, '/c.mp4')

    fireEvent.loadedData(stale)
    expect(first).toHaveStyle({ opacity: '1' })
    expect(latest).toHaveStyle({ opacity: '0' })

    fireEvent.loadedData(latest)
    submitFrame(latest)
    expect(first).toHaveStyle({ opacity: '0' })
    expect(latest).toHaveStyle({ opacity: '1' })
  })

  it('loads the alternate slot when the same URL is replayed with a new key', () => {
    const { container, rerender } = render(<GameStage {...props({ videoKey: 'run-1' })} />)
    const first = videoFor(container, '/a.mp4')
    fireEvent.loadedData(first)

    rerender(<GameStage {...props({ videoKey: 'run-2' })} />)

    const videos = container.querySelectorAll('video')
    expect(videos).toHaveLength(2)
    const replay = [...videos].find((video) => video !== first)!
    expect(replay).toHaveAttribute('src', '/a.mp4')
    expect(first).toHaveStyle({ opacity: '1' })
    expect(replay).toHaveStyle({ opacity: '0' })

    fireEvent.loadedData(replay)
    submitFrame(replay)
    expect(replay).toHaveStyle({ opacity: '1' })
  })

  it('renews an expired gateway URL before showing a missing-video notice', () => {
    const source = '/__gva__/media/m-narr-open?game=0728-04'
    const { container } = render(
      <GameStage {...props({ videoSrc: source, clip: clip('intro', 'm-narr-open') })} />,
    )
    const video = videoFor(container, source)
    video.currentTime = 12

    fireEvent.error(video)

    const refreshed = videoFor(
      container,
      '/__gva__/media/m-narr-open?game=0728-04&__gva_refresh=1',
    )
    expect(container).not.toHaveTextContent('无法播放视频资源')

    fireEvent.loadedMetadata(refreshed)
    expect(refreshed.currentTime).toBe(12)
    fireEvent.error(refreshed)

    expect(container).toHaveTextContent('无法播放视频资源')
    expect(container).toHaveTextContent('m-narr-open')
  })

  it('does not mutate a direct provider URL when playback fails', () => {
    const source = 'https://cdn.example.test/video.mp4?signature=stable'
    const { container } = render(
      <GameStage {...props({ videoSrc: source, clip: clip('intro', 'm-narr-open') })} />,
    )

    fireEvent.error(videoFor(container, source))

    expect(container).toHaveTextContent('无法播放视频资源')
    expect(videoFor(container, source)).toBeInTheDocument()
  })
})
