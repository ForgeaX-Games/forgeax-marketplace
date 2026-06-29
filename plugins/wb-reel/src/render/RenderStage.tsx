/**
 * RenderStage —— `?surface=render` 的离屏渲染面，给「节点 → MP4」录制器逐帧截图用。
 *
 * 设计目标（用户原话：「确保导出的视频是我们节点内时间轴当前的预览效果」）：
 *   - **像素级复用预览**：直接挂 Player 的 <SceneCanvas> + <DialogueBox>(字幕) +
 *     <TextOverlayLayer>(花字)，与试玩/编辑器预览同一套渲染管线，杜绝"导出和预览两套"。
 *   - **固定画布**：1080p（默认 1920×1080，可 query 覆盖），媒体 contain 居中，黑底信箱。
 *   - **帧步进时钟**：不跑 rAF；时间由录制器经 `window.__reelRender.seek(ms)` 设定。
 *   - **跳过交互层**：不渲染选项 / QTE / 小游戏 / 菜单 / 背包 / 播放控件。
 *   - **就绪信号**：`window.__reelRender.ready()` 在剧本/场景/当前帧媒体就绪后 resolve。
 *
 * 音频不在这里出声（视频静音）——导出音轨由录制器用 OfflineAudioContext 复用
 * buildSceneAudioPlan 单独离线渲染后由 ffmpeg 合轨，避免"边录屏边采声"的不确定性。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { useSceneImageCache } from '../media/sceneImageCache'
import { SceneCanvas } from '../player/Player'
import { DialogueBox } from '../player/DialogueBox'
import { TextOverlayLayer } from '../player/TextOverlayLayer'
import { injectStyleOnce } from '../styles/injectStyle'
import { parseRenderParams } from './renderTarget'
import type { Scene } from '../scenario/types'

interface ReelRenderApi {
  /** 渲染目标元信息（录制器据此算总帧数与画布尺寸）。 */
  meta(): {
    ready: boolean
    sceneId: string | null
    durationMs: number
    width: number
    height: number
    fps: number
    hasVideo: boolean
  }
  /** 跳到场景时间 ms，resolve 时该帧画面已就绪（视频已 seeked + 两帧 paint）。 */
  seek(ms: number): Promise<void>
  /** 剧本/场景/当前帧媒体就绪后 resolve（带超时兜底）。 */
  ready(timeoutMs?: number): Promise<boolean>
}

declare global {
  interface Window {
    __reelRender?: ReelRenderApi
  }
}

function rafTwice(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

export function RenderStage(): React.ReactElement {
  const params = useMemo(() => parseRenderParams(window.location.search), [])
  const scenario = useScenarioStore((s) => s.scenario)
  const sceneId = params.sceneId ?? scenario.rootSceneId
  const scene: Scene | undefined = scenario.scenes[sceneId]

  const [currentMs, setCurrentMs] = useState(0)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sceneIdRef = useRef(sceneId)
  sceneIdRef.current = sceneId

  // 媒体就绪查询：图像帧看 sceneImageCache / mediaStore，视频帧看 readyState。
  const cacheRecord = useSceneImageCache((s) => s.records[sceneId])
  const mediaEntries = useMediaStore((s) => s.entries)

  const isVideoScene =
    scene?.media.kind === 'VIDEO' ||
    (scene?.shots ?? []).some((sh) => sh.videoMediaRef)

  // 录屏模式：视频永远静音 + 暂停，由 seek 单帧定位。autoplay 的 PlayerVideo
  // 会尝试 play，这里持续把它摁回 paused。
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.muted = true
    const keepPaused = (): void => {
      if (!v.paused) {
        try {
          v.pause()
        } catch {
          /* ignore */
        }
      }
    }
    keepPaused()
    v.addEventListener('play', keepPaused)
    return () => v.removeEventListener('play', keepPaused)
  })

  // 暴露 window.__reelRender 给录制器。
  useEffect(() => {
    const isMediaReadyForFrame = (): boolean => {
      const sc = useScenarioStore.getState().scenario.scenes[sceneIdRef.current]
      if (!sc) return false
      const v = videoRef.current
      if (v) return v.readyState >= 2 // HAVE_CURRENT_DATA
      // 图像/占位场景：有缓存图或绑定的静态图媒体即算就绪；纯占位也算（无图可等）。
      const rec = useSceneImageCache.getState().records[sceneIdRef.current]
      if (rec?.status === 'ready') return true
      const ref = sc.media.kind === 'IMAGE_STATIC' && sc.media.ref ? sc.media.ref : undefined
      if (ref && useMediaStore.getState().entries[ref]) return true
      // 占位/prompt 尚未出图：也视为"可渲染"（导出占位帧），不无限等。
      return sc.media.kind !== 'VIDEO'
    }

    const api: ReelRenderApi = {
      meta() {
        const sc = useScenarioStore.getState().scenario.scenes[sceneIdRef.current]
        return {
          ready: !!sc,
          sceneId: sc ? sceneIdRef.current : null,
          durationMs: sc?.durationMs ?? 0,
          width: params.width,
          height: params.height,
          fps: params.fps,
          hasVideo: !!videoRef.current,
        }
      },
      async seek(ms: number) {
        setCurrentMs(Math.max(0, ms))
        const v = videoRef.current
        if (v) {
          try {
            v.muted = true
            if (!v.paused) v.pause()
          } catch {
            /* ignore */
          }
          await new Promise<void>((resolve) => {
            let done = false
            const finish = (): void => {
              if (done) return
              done = true
              v.removeEventListener('seeked', finish)
              resolve()
            }
            v.addEventListener('seeked', finish)
            try {
              v.currentTime = Math.max(0, ms) / 1000
            } catch {
              finish()
            }
            // 兜底：某些状态下 seeked 不触发
            setTimeout(finish, 1500)
          })
        }
        await rafTwice()
      },
      async ready(timeoutMs = 15000) {
        const start = Date.now()
        // 等剧本里有这一场戏
        while (!useScenarioStore.getState().scenario.scenes[sceneIdRef.current]) {
          if (Date.now() - start > timeoutMs) return false
          await new Promise((r) => setTimeout(r, 100))
        }
        // 等当前帧媒体就绪
        while (!isMediaReadyForFrame()) {
          if (Date.now() - start > timeoutMs) return false
          await new Promise((r) => setTimeout(r, 100))
        }
        await rafTwice()
        return true
      },
    }
    window.__reelRender = api
    // 标记 DOM，供录制器 page.waitForSelector('[data-reel-render-mounted]')
    document.documentElement.setAttribute('data-reel-render-mounted', '1')
    return () => {
      if (window.__reelRender === api) delete window.__reelRender
      document.documentElement.removeAttribute('data-reel-render-mounted')
    }
    // params 在挂载期固定；sceneId 通过 ref 取。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 仅用于触发 ready() 轮询无关的重渲染对齐（cacheRecord/mediaEntries 变化时让画面更新）。
  void cacheRecord
  void mediaEntries
  void isVideoScene

  if (!scene) {
    return (
      <div className="ks-render-root" data-reel-render="empty">
        <div className="ks-render-empty">无可渲染场景：{sceneId}</div>
      </div>
    )
  }

  return (
    <div
      className="ks-render-root"
      data-reel-render="stage"
      style={{ width: params.width, height: params.height }}
    >
      <div className="ks-render-canvas">
        <SceneCanvas scene={scene} videoRef={videoRef} currentMs={currentMs} />
        <DialogueBox scene={scene} elapsed={currentMs} />
        <TextOverlayLayer scene={scene} elapsed={currentMs} />
      </div>
    </div>
  )
}

const renderCss = `
/* 离屏渲染面：固定像素画布、纯黑信箱、媒体 contain 居中。 */
html:has(.ks-render-root),
body:has(.ks-render-root) {
  margin: 0;
  padding: 0;
  background: #000;
  overflow: hidden;
}
.ks-render-root {
  position: fixed;
  top: 0;
  left: 0;
  background: #000;
  overflow: hidden;
}
.ks-render-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  /* 与预览一致的容器查询基准（花字 cqh 单位依赖它）。 */
  container-type: size;
}
/* 媒体 contain：完整展示不裁切，黑边信箱。 */
.ks-render-canvas .ks-player-canvas,
.ks-render-canvas .ks-player {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.ks-render-canvas .ks-player-img,
.ks-render-canvas .ks-player-video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
}
.ks-render-empty {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.5);
  font-family: ui-monospace, monospace;
}
`
injectStyleOnce('reel-render-stage', renderCss)
