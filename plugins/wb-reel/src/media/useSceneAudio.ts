/**
 * useSceneAudio —— 把 SceneAudioEngine 接进 React 预览（Player / StagePane）。
 *
 * 之前预览只放画面不放声音；本 hook 让 `scene.audio[]` + `scene.sceneBgm` 跟着
 * 播放头出声，并处理 播放/暂停/跳转/换场/编辑中改音频/静音 的同步。
 *
 * 设计：
 *   - 播放头用 `getPlayheadMs()` 取（调用方传 ref-getter），**不进依赖**，避免 30Hz
 *     重渲/重排；
 *   - 起播后音频走 WebAudio 自身时钟，再用 500ms 低频 drift 校正对齐画面；
 *   - `scene` 对象变化（编辑中改音频）会重建 plan 并从当前播放头续播。
 */
import { useEffect, useRef } from 'react'
import { SceneAudioEngine } from './audioEngine'
import { useMediaStore } from './mediaStore'
import type { Scene } from '../scenario/types'

export interface UseSceneAudioOptions {
  scene: Scene | undefined | null
  sceneId: string
  /** 画面是否在推进（!paused 且无 minigame/search/choice 等暂停态） */
  playing: boolean
  /** 取当前场景播放头（ms）。用 ref-getter 避免把高频 elapsed 塞进依赖。 */
  getPlayheadMs: () => number
  /** 静音（预览静音开关 / 工坊后台运行时） */
  muted?: boolean
  /** 整体关闭音频预览（如导出渲染模式下另走离线音轨） */
  disabled?: boolean
}

const DRIFT_TOLERANCE_MS = 300
const DRIFT_CHECK_INTERVAL_MS = 500

export function useSceneAudio(opts: UseSceneAudioOptions): void {
  const { scene, sceneId, playing, getPlayheadMs, muted = false, disabled = false } = opts

  const engineRef = useRef<SceneAudioEngine | null>(null)
  const getPlayheadRef = useRef(getPlayheadMs)
  getPlayheadRef.current = getPlayheadMs

  // 懒建引擎 + 卸载释放。
  useEffect(() => {
    if (disabled) return
    const eng = new SceneAudioEngine((id) => useMediaStore.getState().entries[id]?.url)
    engineRef.current = eng
    return () => {
      eng.dispose()
      engineRef.current = null
    }
  }, [disabled])

  // 静音开关。
  useEffect(() => {
    engineRef.current?.setMuted(muted)
  }, [muted])

  // 换场 / 编辑中改音频 → 重建 plan，并按当前播放头与 playing 状态续上。
  useEffect(() => {
    const eng = engineRef.current
    if (!eng) return
    eng.setScene(scene)
    if (playing) eng.play(getPlayheadRef.current())
    else eng.pause()
    // playing 故意不进依赖：它的起停由下面的 effect 负责，这里只在换场/改音频时跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, scene])

  // 播放 / 暂停。
  useEffect(() => {
    const eng = engineRef.current
    if (!eng) return
    if (playing) eng.play(getPlayheadRef.current())
    else eng.pause()
  }, [playing])

  // 低频 drift 校正：画面播放头（视频 currentTime / 墙钟）与音频 ctx 时钟会缓慢漂移，
  // 超过容差就 reseek 对齐。
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      const eng = engineRef.current
      if (!eng) return
      const target = getPlayheadRef.current()
      if (Math.abs(target - eng.currentMs()) > DRIFT_TOLERANCE_MS) {
        eng.seek(target)
      }
    }, DRIFT_CHECK_INTERVAL_MS)
    return () => clearInterval(t)
  }, [playing])
}
