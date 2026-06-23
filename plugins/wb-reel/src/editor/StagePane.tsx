import { useEffect, useMemo, useRef, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { useSceneImageCache } from '../media/sceneImageCache'
import { createImageProvider } from '../llm'
import type { ImageClient } from '../llm/types'
import type { QTECue, QTEHitWindow, Shot } from '../scenario/types'
import { CUE_RING_TARGET_SCALE, cuePhase, cueProgress, cueRingScale } from '../qte/QTEEngine'
import { Timeline } from './Timeline'
import { injectStyleOnce } from '../styles/injectStyle'
import { FOCUS_STAGE_EVENT } from './storygraph/sceneNodeHandlers'
import { useShellStore } from '../shell/shellStore'
import { regenerateShotKeyframe } from '../forge/keyframeQueueTrigger'
import {
  decideSeekFromHoverWithTrim,
  decideHoverFromVideoWithTrim,
  isAtTrimEnd,
  resolveTrimRange,
} from './videoTimelineSync'
import {
  previewedCue as projectCue,
  previewedDialogue as projectDialogue,
  type TimelinePreview,
} from './timeline/timelinePreview'

/**
 * 中栏 · STAGE PANE —— 编辑器主舞台
 *
 * 区域：
 *   ┌────────────────────────────────────────┐
 *   │  画面（视频 / 占位生成图）               │
 *   │  + 当前 hover 字幕预览                  │
 *   │  + QTE 标记打点                         │
 *   ├────────────────────────────────────────┤
 *   │  时间轴 · 字幕带 · QTE 带 · 分支带       │
 *   └────────────────────────────────────────┘
 *
 * 接收来自左栏 ScenesList 的拖入：放下 = 切换选中。
 */
interface StagePaneProps {
  /**
   * 受控 sceneId —— 画面要渲染哪个场景。
   *
   * 历史 bug（2026-06-19 作者反馈「切节点后预览仍显示上一节点的视频」）：
   *   StagePane 过去**只**读 `store.selectedSceneId`，而 SceneDetailDrawer 的
   *   Timeline 走的是 drawer 自己的 `sceneId` prop（= `stageSceneId ?? selectedSceneId`）。
   *   节点图在独立 left iframe 里，靠 BroadcastChannel + store 镜像同步，
   *   `stageSceneId` 与 `selectedSceneId` 可能短暂错位 —— 于是时间轴已切到新节点
   *   （无视频），画面却还停在旧的视频节点。
   *   让 drawer 把同一个 sceneId 直接喂给画面，preview 与 timeline 永远同源。
   * 省略时回退到 store.selectedSceneId（保持独立使用时的旧行为）。
   */
  sceneId?: string
  hideHeader?: boolean
  /**
   * 不渲染内部 Timeline —— 在 SceneDetailDrawer 新布局里 Timeline 被提升到
   * 外部 grid row2，让 Prompt 面板能在画面右侧常驻。
   */
  hideTimeline?: boolean
  /**
   * 受控 hoverMs —— Timeline 被抽到外部时，由外部提供 hoverMs 让画面叠层
   *（字幕预览 / QTE 打点）仍能跟随时间轴光标。
   */
  hoverMs?: number
  /**
   * 受控 setHoverMs —— v3.9 新增。
   * 早期仅受控 hoverMs 时，StagePane 内部把 setHoverMs 置为 no-op；结果视频
   * `onTimeUpdate → setHoverMs(next)` 什么都没做，Timeline 光标不会随播放右移。
   * 父组件（drawer）必须把自己的 setHoverMs 也喂下来，才能闭环。
   */
  setHoverMs?: (ms: number) => void
  /** 受控 preview —— 同 hoverMs；Timeline 外置后由父组件在两者间桥接。 */
  preview?: TimelinePreview | null
  /** 画面右侧常驻 slot（可选）—— drawer 放 Prompt 面板用。 */
  rightSlot?: React.ReactNode
  /**
   * 是否在画面上叠字幕预览 —— 默认 true 保持历史行为。
   * SceneDetailDrawer 会跟 Timeline 的 DIA 轨开关联动（默认隐藏）。
   */
  showDialogue?: boolean
}

export function StagePane({
  sceneId: extSceneId,
  hideHeader = false,
  hideTimeline = false,
  hoverMs: extHoverMs,
  setHoverMs: extSetHoverMs,
  preview: extPreview,
  rightSlot,
  showDialogue = true,
}: StagePaneProps = {}) {
  const scenario = useScenarioStore((s) => s.scenario)
  const storeSceneId = useScenarioStore((s) => s.selectedSceneId)
  // 受控优先：drawer 直接指定要渲染的节点，避免与时间轴各读各的源造成错位。
  const sceneId = extSceneId ?? storeSceneId
  const select = useScenarioStore((s) => s.selectScene)
  const scene = scenario.scenes[sceneId]
  const togglePromptFloater = useShellStore((s) => s.togglePromptFloater)

  const media = scene?.media
  const mediaEntry = useMediaStore((s) =>
    media?.kind === 'VIDEO' && media.ref ? s.entries[media.ref] : undefined,
  )

  const [localHoverMs, setLocalHoverMs] = useState(0)
  const hoverMs = extHoverMs ?? localHoverMs
  // v3.9：受控时优先走父传的 setHoverMs；没传时就 fallback 到内部 state。
  // 之前这里给的是 no-op，结果视频 onTimeUpdate 再怎么调都没效果（光标不动）。
  const setHoverMs: (ms: number) => void =
    extSetHoverMs ?? (extHoverMs !== undefined ? () => { /* 受控但父未接 setter：静默 */ } : setLocalHoverMs)

  /*
   * 视频 / 时间轴联动 —— 见 editor/videoTimelineSync.ts 的纯函数决策。
   *
   * 这里只负责：持有 <video> ref、暴露 isPlaying 状态、绑几个事件把两侧串起来。
   * 所有"该不该 seek / 该不该 setHoverMs"都走纯函数，无分支写进组件。
   *
   * 为什么不把 isPlaying 提到 store：暂只有"本场景的视频"需要，StagePane 内部
   * 状态就够；切场景时由 scene 变化 reset。
   */
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [isVideoPlaying, setIsVideoPlaying] = useState(false)
  /*
   * 图像节点（无视频）也要能「播放」时间轴：游标按真实时间推进，画面随之切关键帧、
   * 跟字幕/QTE。视频节点不用它（由 <video> 自身驱动 hoverMs）。
   */
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false)
  // seek guard：我们每次调 video.currentTime=x 时，video 会触发一次 seeked，
  // 接着触发 timeupdate —— 那次 timeupdate 要忽略，避免"暂停下 seek → 自己把 hoverMs
  // 拉回来"的回环。记录"最近一次程序 seek 目标"，在差距小于 EPSILON 时跳过。
  const lastProgrammaticSeekRef = useRef<number | null>(null)
  /**
   * 时间轴里正在拖拽的「视觉镜像」——非 store 状态。
   * Timeline 用 onPreviewChange 把当前 patch 同步上来；
   * 画面层渲染 cue / dialogue 时把 preview 投影上去，做到「拖谁谁立刻动」。
   * pointerup 时 Timeline 会 dispatch 真正的 update，并把 preview 清空。
   */
  const [localPreview, setLocalPreview] = useState<TimelinePreview | null>(null)
  const preview = extPreview !== undefined ? extPreview : localPreview
  const setPreview: (p: TimelinePreview | null) => void =
    extPreview !== undefined ? () => { /* 受控 */ } : setLocalPreview

  // 双击 StoryGraph 节点 → 滚舞台进入视野 + 短暂闪一下边框。
  // 新路径：订阅 shellStore.focusIntent（tick 递增触发）。
  // 旧路径：保留 FOCUS_STAGE_EVENT window 事件（过渡期兼容，可同时触发）。
  const stageRef = useRef<HTMLDivElement>(null)
  const [focusFlash, setFocusFlash] = useState(false)
  const focusIntent = useShellStore((s) => s.focusIntent)
  useEffect(() => {
    let timer: number | null = null
    function runFocus(): void {
      const el = stageRef.current
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setFocusFlash(true)
      if (timer != null) window.clearTimeout(timer)
      timer = window.setTimeout(() => setFocusFlash(false), 720)
    }
    window.addEventListener(FOCUS_STAGE_EVENT, runFocus)
    return () => {
      window.removeEventListener(FOCUS_STAGE_EVENT, runFocus)
      if (timer != null) window.clearTimeout(timer)
    }
  }, [])
  // 订阅 shellStore.focusIntent：tick 变就聚焦（即使 sceneId 相同）
  useEffect(() => {
    if (!focusIntent) return
    const el = stageRef.current
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFocusFlash(true)
    const t = window.setTimeout(() => setFocusFlash(false), 720)
    return () => window.clearTimeout(t)
  }, [focusIntent?.tick, focusIntent?.sceneId])

  const imgClient = useMemo<ImageClient>(() => createImageProvider(), [])
  const canvasRef = useRef<HTMLDivElement>(null)
  const updateQTECue = useScenarioStore((s) => s.updateQTECue)

  // 走全局磁盘持久化的 sceneImageCache —— 切场景再回来不丢、刷新不丢
  const cacheRecord = useSceneImageCache((s) => s.records[sceneId])
  const loadFromDisk = useSceneImageCache((s) => s.loadFromDisk)
  const retry = useSceneImageCache((s) => s.retry)

  // v3 · 当 shotboard 选中某 shot 时，画面改播该 shot 的关键帧
  //     （否则继续播 scene 级 cache）——这是 MVP 分镜的"浏览"路径，
  //     正式切镜还要等下一轮的 Timeline shot 支持。
  const selectedShotId = useShellStore((s) => s.selectedShotId)
  // v5 · 多镜节点：上方预览跟随「活动分镜」——优先时间轴选中的镜，未选中时
  //      默认 keyShot（回退第 0 镜）。单镜 / 未分镜节点 activeShot = undefined，
  //      画面与提示词完全保持 scene 级旧行为（兼容老剧本）。
  const sortedShots = useMemo(
    () => (scene?.shots ?? []).slice().sort((a, b) => a.order - b.order),
    [scene],
  )
  const isMultiShot = sortedShots.length >= 2
  const activeShot = useMemo(() => {
    if (!isMultiShot) return undefined
    const bySelected = selectedShotId
      ? sortedShots.find((sh) => sh.id === selectedShotId)
      : undefined
    if (bySelected) return bySelected
    const byKey = scene?.keyShotId
      ? sortedShots.find((sh) => sh.id === scene.keyShotId)
      : undefined
    return byKey ?? sortedShots[0]
  }, [isMultiShot, selectedShotId, sortedShots, scene?.keyShotId])
  // ab 镜首帧用 startFrameMediaRef，single 镜用 keyframeMediaRef。
  const activeShotFrameRef =
    activeShot?.keyframeStrategy === 'ab'
      ? activeShot.startFrameMediaRef ?? activeShot.keyframeMediaRef
      : activeShot?.keyframeMediaRef
  const shotMediaEntry = useMediaStore((s) =>
    activeShotFrameRef ? s.entries[activeShotFrameRef] : undefined,
  )
  const shotImageUrl = shotMediaEntry?.url
  // v4 · shot-level 视频优先：拖动时间轴 / 点 shot 缩略图切到一镜时，
  //     如果该 shot 有独立生成的视频（shot.videoMediaRef），画面直接播它；
  //     否则 fallback 到 scene.media（VIDEO / IMAGE / scene cache）。
  const shotVideoEntry = useMediaStore((s) =>
    activeShot?.videoMediaRef
      ? s.entries[activeShot.videoMediaRef]
      : undefined,
  )
  const shotVideoUrl = shotVideoEntry?.url

  /*
   * v6 · 多镜连播（对齐 Player.tsx 的 MultiShotLayer）：
   *
   * 历史 bug（作者反馈）：一个节点里三段分镜视频，时间轴预览只播第一段就跳到末尾，
   *   后面两段播不了。根因——StagePane 过去只挂「单个活动镜」的 <video>，它 onEnded
   *   时直接 setHoverMs(scene.durationMs)（snap 到场景末尾），既不切下一镜也没有跨镜
   *   主时钟。
   *
   * 修法——与运行时 Player 同一套模型：
   *   · 判定多镜场景：scene.media 非整场视频 + ≥2 个带合法时间码(startMs<endMs)的镜 +
   *     至少一镜有 videoMediaRef。
   *   · 主时钟 = 墙钟推进的 hoverMs（复用下方 isTimelinePlaying 的 RAF 循环）。
   *   · 画面按 hoverMs 在 shots 时间轴里选「当前镜」，给该镜的 <video key=shot.id>，
   *     key 变 → 自动 remount + 从本地偏移 seek + 自动播；游标跨过镜边界即切下一段。
   *   这样三段视频会被墙钟串起来连续播放，而不是停在第一段。
   */
  const timedShots = useMemo(
    () =>
      sortedShots
        .filter(
          (s) =>
            Number.isFinite(s.startMs) &&
            Number.isFinite(s.endMs) &&
            (s.endMs as number) > (s.startMs as number),
        )
        .slice()
        .sort((a, b) => (a.startMs as number) - (b.startMs as number)),
    [sortedShots],
  )
  const isMultiShotVideo =
    scene?.media.kind !== 'VIDEO' &&
    timedShots.length >= 2 &&
    timedShots.some((s) => !!s.videoMediaRef)
  // 多镜连播时：画面跟随播放头(hoverMs)选当前镜，而非手选的 selectedShotId。
  const playbackShot = useMemo(
    () => (isMultiShotVideo ? resolveActiveShotByMs(timedShots, hoverMs) : undefined),
    [isMultiShotVideo, timedShots, hoverMs],
  )

  // 是否存在可播放的视频（shot 级 / scene 级）。无视频时播放走时间轴游标推进。
  const hasVideo = !!shotVideoUrl || (scene?.media.kind === 'VIDEO' && !!mediaEntry)

  // 切场景时只查磁盘历史 —— 编辑器**绝不**自动联网生图，避免每次刷新/选关都消耗 token。
  // 想要新图？用户必须主动点占位上的「生成」按钮。
  useEffect(() => {
    if (!scene || scene.media.kind === 'VIDEO') return
    loadFromDisk(sceneId, scene.media.prompt)
  }, [sceneId, scene, loadFromDisk])

  /*
   * 切 scene 时复位视频：paused + currentTime = offset（裁剪入点）。
   * 这样作者切完场景看到的永远是裁剪段的首帧 + 游标在 0。
   * v3.9 加入裁剪语义：过去硬编码 currentTime=0，裁剪场景下首帧对不上。
   */
  useEffect(() => {
    setIsVideoPlaying(false)
    setIsTimelinePlaying(false)
    const v = videoRef.current
    if (v) {
      try {
        v.pause()
        const offsetMs = scene?.videoOffsetMs ?? 0
        v.currentTime = offsetMs / 1000
      } catch {
        /* 元素未就绪时静默：onLoadedMetadata 里还会再 sync 一次 */
      }
    }
  }, [sceneId, scene?.videoOffsetMs])

  /*
   * hoverMs → video.seek（仅暂停时）。
   * 作者在时间轴上拖游标时，hoverMs 高频变化，这里把"该不该 seek"交给纯函数。
   * v3.9 走带裁剪变体：videoTargetMs = hoverMs + offset，夹到裁剪段内。
   */
  useEffect(() => {
    const v = videoRef.current
    if (!v || !scene || scene.media.kind !== 'VIDEO') return
    const target = decideSeekFromHoverWithTrim(
      {
        hoverMs,
        videoMs: (v.currentTime || 0) * 1000,
        isPlaying: isVideoPlaying,
        sceneMs: scene.durationMs,
      },
      {
        offsetMs: scene.videoOffsetMs,
        clipDurationMs: scene.videoClipDurationMs,
      },
    )
    if (target !== null) {
      lastProgrammaticSeekRef.current = target * 1000
      try {
        v.currentTime = target
      } catch {
        /* seek 失败：让下一次 hover 再试 */
      }
    }
  }, [hoverMs, isVideoPlaying, scene])

  /*
   * 视频播放 / 暂停 —— 按播放前把 currentTime 同步到 hoverMs（裁剪语义见内部注释）。
   * 供画面 ▶ 按钮与空格/ k 快捷键共用。
   */
  function toggleVideo(): void {
    const v = videoRef.current
    if (!v || !scene) return
    if (v.paused) {
      const trim = {
        offsetMs: scene.videoOffsetMs,
        clipDurationMs: scene.videoClipDurationMs,
      }
      const { startMs, endMs } = resolveTrimRange(trim, scene.durationMs)
      const hoverVideoMs = startMs + Math.max(0, hoverMs)
      const atEnd = isAtTrimEnd(
        { hoverMs, videoMs: (v.currentTime || 0) * 1000, isPlaying: false, sceneMs: scene.durationMs },
        trim,
      )
      const targetVideoMs = atEnd
        ? startMs
        : Math.min(endMs - 1, Math.max(startMs, hoverVideoMs))
      try {
        if (Math.abs(v.currentTime * 1000 - targetVideoMs) > 30) {
          v.currentTime = targetVideoMs / 1000
          lastProgrammaticSeekRef.current = targetVideoMs
        }
      } catch {
        /* ignore */
      }
      void v.play().catch(() => { /* autoplay 策略拒绝时静默 */ })
    } else {
      v.pause()
    }
  }

  /*
   * 统一播放切换：有视频走 toggleVideo；纯图像节点切换时间轴游标推进（isTimelinePlaying）。
   * 这样无论节点是视频还是图像，画面上都有 ▶ 按钮、空格都能播。
   */
  function togglePlay(): void {
    if (!scene) return
    // 多镜连播：主时钟走墙钟（isTimelinePlaying），各镜 <video> 由 hoverMs 切换 + 自动播。
    if (isMultiShotVideo) {
      setIsTimelinePlaying((p) => !p)
      return
    }
    if (hasVideo) {
      toggleVideo()
    } else {
      setIsTimelinePlaying((p) => !p)
    }
  }

  /*
   * 图像节点的时间轴游标推进循环：按真实时间从当前 hoverMs 推进到节点总时长，
   * 到尾即停。视频节点不进此循环（hasVideo 时 togglePlay 不会置 isTimelinePlaying）。
   */
  useEffect(() => {
    if (!isTimelinePlaying || !scene) return
    const total = scene.durationMs
    const startWall = performance.now()
    // 在末尾按播放则从头开始；否则从当前游标继续。
    const startFrom = hoverMs >= total ? 0 : Math.max(0, hoverMs)
    let raf = 0
    const tick = (now: number): void => {
      const next = startFrom + (now - startWall)
      if (next >= total) {
        setHoverMs(total)
        setIsTimelinePlaying(false)
        return
      }
      setHoverMs(next)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // hoverMs 仅作起点快照，不入依赖（否则每帧重启循环）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTimelinePlaying, sceneId])

  /*
   * 快捷键：空格 / k 切换播放。window 级监听，作者不用聚焦按钮；输入框中不响应。
   * 用 ref 持有最新 togglePlay，订阅只建一次，避免 hoverMs 每帧变动导致反复重订阅。
   */
  const togglePlayRef = useRef<() => void>(() => {})
  togglePlayRef.current = togglePlay
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== ' ' && e.key !== 'k' && e.key !== 'K') return
      const t = e.target as HTMLElement | null
      if (t) {
        const tag = t.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable) return
      }
      e.preventDefault()
      togglePlayRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function regenImage(): void {
    if (!scene) return
    // 多镜节点：按钮只补「当前活动分镜」的关键帧，走与队列一致的关键帧链
    //（含写实打码、跨镜参考图）；单镜 / 未分镜节点回落到 scene 级生图。
    if (activeShot) {
      void regenerateShotKeyframe(sceneId, activeShot.id)
      return
    }
    if (!scene.media.prompt) return
    void retry(sceneId, scene.media.prompt, imgClient)
  }

  const isPending = cacheRecord?.status === 'pending'
  const isError = cacheRecord?.status === 'error'
  // v3 · 优先级：选中 shot 的关键帧 > scene 级 cache
  const readyDataUrl =
    shotImageUrl ??
    (cacheRecord?.status === 'ready' ? cacheRecord.dataUrl : undefined)
  const errorMessage =
    cacheRecord?.status === 'error' ? cacheRecord.message : ''

  if (!scene) {
    return (
      <div className="ks-stage-empty ks-mono">
        ⚠ 未选中场景
      </div>
    )
  }

  // 拖动期间用 previewed 副本来命中「当前活跃台词」，让画面字幕跟手。
  //
  // 选词规则（跟随 playhead 的"当前帧"语义）：
  //   1) 优先：hoverMs 落在 [startMs, endMs] 区间内的台词；多条重叠时取「最晚开始」
  //      的那条（最贴近当前帧的说话）。
  //   2) 间隙回退：没有区间命中时，取「已开始且开始时间最大」的那条（最近一句台词
  //      余韵），而不是数组里的第一条 —— 否则 scrub 到后面时字幕会卡在开头那句。
  const projectedDialogue = scene.dialogue.map((d) => projectDialogue(d, preview))
  const latestStart = (
    a: (typeof projectedDialogue)[number],
    b: (typeof projectedDialogue)[number],
  ) => (b.startMs > a.startMs ? b : a)
  const inRangeDialogue = projectedDialogue.filter(
    (d) => hoverMs >= d.startMs && (d.endMs == null ? true : hoverMs <= d.endMs),
  )
  const startedDialogue = projectedDialogue.filter((d) => d.startMs <= hoverMs)
  const activeDialogue =
    inRangeDialogue.length > 0
      ? inRangeDialogue.reduce(latestStart)
      : startedDialogue.length > 0
        ? startedDialogue.reduce(latestStart)
        : undefined

  return (
    <div
      ref={stageRef}
      className={`ks-stage ${focusFlash ? 'is-focus-flash' : ''} ${hideHeader ? 'is-noheader' : ''} ${hideTimeline ? 'is-notimeline' : ''} ${rightSlot ? 'has-rightslot' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/x-reel-scene-id')) {
          e.preventDefault()
        }
      }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('text/x-reel-scene-id')
        if (id) {
          e.preventDefault()
          select(id)
        }
      }}
    >
      {!hideHeader && (
        <div className="ks-stage-header">
          <div className="ks-stage-title ks-cn">{scene.title}</div>
          <div className="ks-stage-meta ks-mono">
            {scene.id} · {(scene.durationMs / 1000).toFixed(1)}s ·{' '}
            {scene.media.kind}
          </div>
        </div>
      )}

      <div className="ks-stage-canvas" ref={canvasRef}>
        <span className="ks-corner ks-corner-tl" />
        <span className="ks-corner ks-corner-tr" />
        <span className="ks-corner ks-corner-bl" />
        <span className="ks-corner ks-corner-br" />

        {/*
         * v4 · 画面层渲染优先级：
         *   1) 当前选中 shot 有 videoMediaRef → 播该 shot 的视频（shot 级视频）
         *   2) scene.media.kind === 'VIDEO' → 播 scene 视频（旧路径）
         *   3) 其他（scene 是 IMAGE）→ 走下面的图像渲染分支
         *
         * shot 级视频优先是 2026-05-07 作者反馈的核心需求：
         *   "1 个节点内的三张分镜，拖动时间轴，预览没跳转到对应图像" ——
         *   既然 shot 已经有自己的视频/关键帧，画面就该跟着 selectedShotId 切。
         */}
        {isMultiShotVideo ? (
          <>
            <ShotSequenceVideo
              shot={playbackShot ?? timedShots[0]!}
              scene={scene}
              hoverMs={hoverMs}
              isPlaying={isTimelinePlaying}
              videoRef={videoRef}
            />
            <VideoPlayToggle isPlaying={isTimelinePlaying} onToggle={togglePlay} />
          </>
        ) : (shotVideoUrl || (scene.media.kind === 'VIDEO' && mediaEntry)) ? (
          (() => {
            const activeVideoUrl = shotVideoUrl ?? mediaEntry!.url
            return (
          <>
            <video
              ref={videoRef}
              className="ks-stage-video"
              src={activeVideoUrl}
              preload="metadata"
              onLoadedMetadata={(e) => {
                /*
                 * v3.9 · 新加载的视频立即 seek 到裁剪入点，首帧就是裁剪段的起点。
                 * 否则作者第一次打开看到的永远是视频原 0s 帧，不直观。
                 */
                const offsetMs = scene.videoOffsetMs ?? 0
                if (offsetMs > 0) {
                  try {
                    e.currentTarget.currentTime = offsetMs / 1000
                    lastProgrammaticSeekRef.current = offsetMs
                  } catch {
                    /* 某些 codec 还没就绪，下一次 hover 会再 seek */
                  }
                }
              }}
              onPlay={() => setIsVideoPlaying(true)}
              onPause={() => setIsVideoPlaying(false)}
              onEnded={() => {
                // 视频播到尾 —— 停在末帧，游标 snap 到 sceneMs。
                setIsVideoPlaying(false)
                setHoverMs(scene.durationMs)
              }}
              onTimeUpdate={(e) => {
                const el = e.currentTarget
                const videoMs = (el.currentTime || 0) * 1000
                /*
                 * 屏蔽"程序化 seek 刚落下产生的第一次 timeupdate" —— 否则
                 * 暂停下拖游标时会立刻被这次 timeupdate 再拉回去一次，手感很碎。
                 */
                const seekTgt = lastProgrammaticSeekRef.current
                if (
                  seekTgt !== null &&
                  Math.abs(videoMs - seekTgt) < 120
                ) {
                  lastProgrammaticSeekRef.current = null
                  return
                }
                const trim = {
                  offsetMs: scene.videoOffsetMs,
                  clipDurationMs: scene.videoClipDurationMs,
                }
                const next = decideHoverFromVideoWithTrim(
                  {
                    hoverMs,
                    videoMs,
                    isPlaying: isVideoPlaying,
                    sceneMs: scene.durationMs,
                  },
                  trim,
                )
                if (next !== null) setHoverMs(next)
                // v3.9：裁剪场景下到"裁剪出点"就该停，不等整个视频文件结束
                if (
                  isVideoPlaying &&
                  isAtTrimEnd(
                    {
                      hoverMs,
                      videoMs,
                      isPlaying: true,
                      sceneMs: scene.durationMs,
                    },
                    trim,
                  )
                ) {
                  try {
                    el.pause()
                  } catch {
                    /* ignore */
                  }
                }
              }}
            />
            <VideoPlayToggle isPlaying={isVideoPlaying} onToggle={toggleVideo} />
          </>
            )
          })()
        ) : readyDataUrl ? (
          <img
            className={`ks-stage-img ${hideHeader ? 'is-clickable' : ''}`}
            src={readyDataUrl}
            alt={scene.title}
            draggable={false}
            onClick={hideHeader ? togglePromptFloater : undefined}
            title={hideHeader ? '点击切换提示词编辑浮层' : undefined}
          />
        ) : (
          <div
            className={`ks-stage-placeholder ${isPending ? 'is-pending' : ''} ${
              isError ? 'is-error' : ''
            } ${hideHeader ? 'is-clickable' : ''}`}
            onClick={
              hideHeader
                ? (e) => {
                    // 占位图内部有"生成"按钮 —— 按钮冒泡上来会误触；
                    // 让按钮自己 stopPropagation，外层只处理背景区域点击
                    if (e.target === e.currentTarget) togglePromptFloater()
                  }
                : undefined
            }
          >
            <div className="ks-ph-strip" />
            {activeShot && (
              <div className="ks-ph-shotmeta ks-mono">
                {scene.title} · 镜 {(activeShot.order ?? 0) + 1}/{sortedShots.length}
                {activeShot.framing ? ` · ${activeShot.framing}` : ''}
              </div>
            )}
            <div className="ks-ph-headline">
              {isPending
                ? '生成中…'
                : isError
                  ? 'GENERATION FAILED'
                  : 'NO IMAGE · 点击下方按钮生成'}
            </div>
            <div className="ks-ph-prompt ks-cn">
              {activeShot?.prompt ??
                scene.media.prompt ??
                '尚无提示词 — 在左侧 FORGE 锻造或在 Inspector 直接编辑。'}
            </div>
            {isError && <div className="ks-ph-err ks-mono">{errorMessage}</div>}
            <button
              type="button"
              className="ks-ph-action"
              onClick={regenImage}
              disabled={isPending || (!activeShot && !scene.media.prompt)}
            >
              {isPending
                ? '↻ 渲染中'
                : isError
                  ? '↻ 重试生成'
                  : activeShot
                    ? `↻ 生成镜 ${(activeShot.order ?? 0) + 1} 关键帧`
                    : `↻ 用 ${imgClient.getModel()} 生成`}
            </button>
          </div>
        )}

        {/* 图像节点（无视频）也给一个 ▶ 播放键：播放时游标按真实时间推进，
            画面随之切关键帧、字幕/QTE 跟随。视频节点的播放键在上面的 <video> 分支里。
            多镜连播分支已自带播放键，这里排除以免出现两个。 */}
        {!hasVideo && !isMultiShotVideo && (
          <VideoPlayToggle isPlaying={isTimelinePlaying} onToggle={togglePlay} />
        )}

        {/* QTE 打点 —— 跟随 hoverMs 出现，跟音游一致的"飞入命中线"视觉。
            正在拖动的 cue 走 previewed 副本，让作者拖到哪一帧就看到哪一帧。
            编辑器模式下支持直接拖动圆点改写 cue.x / cue.y（画面坐标）。 */}
        {scene.qte?.cues.map((rawC) => {
          const c = projectCue(rawC, preview)
          return (
            <EditorCueMarker
              key={c.id}
              cue={c}
              hoverMs={hoverMs}
              window={scene.qte!.window}
              canvasRef={canvasRef}
              onMoveCue={(patch) => updateQTECue(scene.id, c.id, patch)}
            />
          )
        })}

        {/* 字幕预览（hover 当前时刻有台词时显示）
            v3.9.11：受 Timeline DIA 开关联动，关闭时不渲染，画面保持干净。 */}
        {showDialogue && activeDialogue && (
          <div className="ks-caption-band">
            {activeDialogue.speaker && (
              <span className="ks-caption-speaker ks-mono">
                {activeDialogue.speaker}
              </span>
            )}
            <span className="ks-caption ks-cn">{activeDialogue.text}</span>
          </div>
        )}

        {/*
         * 2026-04-29：移除右下 .ks-img-stamp 徽章（"● GPT-IMAGE-2 · 426702ms ↻"）。
         * 作者反馈这是"旧的生图按钮"，和抽屉里的其他入口重复；生图入口已统一
         * 到 StagePromptFloater（P 浮层）内的"重新生成"按钮，不再在画面角落放
         * 冗余徽章/按钮。
         *
         * 2026-04-30：同理移除 <AssetLibrary />（图片上方的"历史版本"小胶囊按钮）。
         * 作者反馈"右侧这个白色按钮，点击会显示之前的图像"—— 即这个旧资产库入口。
         * 画面角落保持只剩 P 浮层一个开关，没有其他悬浮按钮。
         * 历史版本如需查看，走 PromptTabs/Inspector，从数据层恢复而非画面叠浮层。
         */}
      </div>

      {rightSlot}

      {!hideTimeline && (
        <Timeline
          scene={scene}
          hoverMs={hoverMs}
          setHoverMs={setHoverMs}
          onPreviewChange={setPreview}
        />
      )}
    </div>
  )
}

/*
 * VideoPlayToggle —— 画面左下角的悬浮播放/暂停按钮（视频场景专属）。
 *
 * 交互边界：
 *   - 只做"播放 / 暂停"两态；-10s/+10s/seek 走时间轴 playhead 拖拽，避免功能重复
 *   - 悬浮在画布内，不挤进 header/底栏的工具带 —— 作者视线从视频本体到按钮很近
 *   - 点击完全不阻塞视频自身区域（button 只占角落）
 */
function VideoPlayToggle({
  isPlaying,
  onToggle,
}: {
  isPlaying: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`ks-stage-play-toggle ${isPlaying ? 'is-playing' : 'is-paused'}`}
      onClick={onToggle}
      aria-label={isPlaying ? '暂停' : '播放'}
      title={isPlaying ? '暂停 (space)' : '播放 (space)'}
    >
      <span aria-hidden>{isPlaying ? '⏸' : '▶'}</span>
    </button>
  )
}

/**
 * 按播放头(ms)在带时间码的 shots 里选「当前镜」。
 * 命中 [startMs,endMs) 的镜；越界则夹到首/末镜。与 Player.resolveActiveShot 同义。
 */
function resolveActiveShotByMs(shots: Shot[], currentMs: number): Shot | undefined {
  if (shots.length === 0) return undefined
  for (const s of shots) {
    if (currentMs >= (s.startMs as number) && currentMs < (s.endMs as number)) return s
  }
  return currentMs < (shots[0]!.startMs as number) ? shots[0] : shots[shots.length - 1]
}

/**
 * 多镜连播的画面层 —— 给「当前镜」挂一个 <video key=shot.id>。
 *
 * 对齐运行时 Player.MultiShotLayer 的模型：
 *   · key=shot.id —— 播放头跨过镜边界时父组件传入新 shot，<video> 自然 remount，
 *     新元素挂到共享 videoRef，从本地偏移 seek 后自动播。
 *   · 主时钟是父级墙钟推进的 hoverMs，这里不把 video.timeupdate 写回 hoverMs，
 *     避免与墙钟打架（否则一个 video 播完就把游标拽到别处）。
 *   · 暂停态(scrub)下跟随 hoverMs seek 到镜内对应帧；播放态不每帧 seek，让视频自走。
 *   · 镜只有关键帧(无视频)时退化为静帧图；都没有则占位条。
 */
function ShotSequenceVideo({
  shot,
  scene,
  hoverMs,
  isPlaying,
  videoRef,
}: {
  shot: Shot
  scene: { title: string }
  hoverMs: number
  isPlaying: boolean
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
}) {
  const entries = useMediaStore((s) => s.entries)
  const videoUrl = shot.videoMediaRef ? entries[shot.videoMediaRef]?.url : undefined
  const imgUrl = shot.keyframeMediaRef ? entries[shot.keyframeMediaRef]?.url : undefined
  const startMs = (shot.startMs as number) ?? 0

  // 镜切换(key 变 → remount)：seek 到本地偏移；播放态则自动播。
  // 只依赖 shot.id / videoUrl —— hoverMs/isPlaying 在挂载瞬间取快照即可。
  useEffect(() => {
    const v = videoRef.current
    if (!v || !videoUrl) return
    const seek = (): void => {
      try {
        v.currentTime = Math.max(0, (hoverMs - startMs) / 1000)
      } catch {
        /* metadata 未就绪：loadedmetadata 时再 seek */
      }
    }
    if (v.readyState >= 1) seek()
    else v.addEventListener('loadedmetadata', seek, { once: true })
    if (isPlaying) void v.play().catch(() => { /* autoplay 策略拒绝时静默 */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.id, videoUrl])

  // 播放/暂停切换：跟随父级 isPlaying。
  useEffect(() => {
    const v = videoRef.current
    if (!v || !videoUrl) return
    if (isPlaying) void v.play().catch(() => { /* ignore */ })
    else {
      try {
        v.pause()
      } catch {
        /* ignore */
      }
    }
  }, [isPlaying, videoUrl, videoRef])

  // 暂停态 scrub：跟随 hoverMs seek 到镜内对应帧（播放态不 seek，避免抖动）。
  useEffect(() => {
    if (isPlaying) return
    const v = videoRef.current
    if (!v || !videoUrl) return
    const target = Math.max(0, (hoverMs - startMs) / 1000)
    if (Math.abs((v.currentTime || 0) - target) > 0.08) {
      try {
        v.currentTime = target
      } catch {
        /* ignore */
      }
    }
  }, [hoverMs, isPlaying, videoUrl, startMs, videoRef])

  if (videoUrl) {
    return (
      <video
        key={shot.id}
        ref={videoRef}
        className="ks-stage-video"
        src={videoUrl}
        preload="metadata"
        playsInline
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      />
    )
  }
  if (imgUrl) {
    return (
      <img
        key={shot.id}
        className="ks-stage-img"
        src={imgUrl}
        alt={scene.title}
        draggable={false}
      />
    )
  }
  return (
    <div className="ks-stage-placeholder">
      <div className="ks-ph-strip" />
      <div className="ks-ph-headline">镜 {(shot.order ?? 0) + 1} · 暂无素材</div>
    </div>
  )
}

/**
 * 编辑器画面叠层的"音游打点" —— 完全由 hoverMs 驱动可见性。
 *
 *   before  → 不渲染（连 DOM 都不在，避免鬼影/事件命中）
 *   incoming→ 外环从大向内收缩，progress=1 时撞进目标环（PERFECT 时机）
 *   window  → 命中尾窗，整体快速脉冲
 *   after   → 不渲染
 *
 * 视觉**与玩家 QTEOverlay 完全一致**：白色玻璃质感外环 + 类型色内核 +
 * 触发徽章 + hold 提示 + sweep 箭头。复用 QTEOverlay 注入的 .ks-cue-*
 * class，编辑器与运行时同款，作者拖到哪一帧 = 玩家看到的那一帧。
 *
 * 编辑器特殊处理：
 *   - 整层 pointer-events: none（不接受点击，避免抢拖拽手势）
 *   - 触发徽章淡化（不是要让作者按键，只是告知玩家会看到啥）
 */
function EditorCueMarker({
  cue,
  hoverMs,
  window: hitWindow,
  canvasRef,
  onMoveCue,
}: {
  cue: QTECue
  hoverMs: number
  window: QTEHitWindow
  canvasRef: React.RefObject<HTMLDivElement | null>
  /** 提交 patch（只改 x/y），父组件写入 store */
  onMoveCue: (patch: Partial<QTECue>) => void
}) {
  const phase = cuePhase(cue, hitWindow, hoverMs)
  if (phase === 'before' || phase === 'after') return null

  const p = cueProgress(cue, hoverMs)
  const ringScale = cueRingScale(p)
  const peakDistance = Math.abs(p - 1)
  // 编辑器 peak 半径放宽到 0.2，让作者预览更容易看到"对齐高亮"
  const peakIntensity = Math.max(0, 1 - peakDistance / 0.2)
  const isNearPerfect = peakIntensity > 0
  const isTrigger = !!cue.slowMo

  /*
   * 画面内拖动 cue —— 把圆点按在 canvas 任意位置。
   *
   * 写入字段：cue.x / cue.y（都是 [0,1] 归一化坐标，相对 canvas 尺寸）。
   * 在 pointerdown 时记录"鼠标与 cue 中心的偏移"，pointermove 时按 canvas
   * rect 重算百分比，pointerup 时一次性 commit（避免 60Hz 写入 + undo 噪声）。
   *
   * 不依赖 useTimelineDrag —— 那是时间轴的一维拖拽工具，这里是二维 + 坐标
   * 空间不同，单独写一份短小的纯 DOM pointer 处理更直观。
   */
  function onCuePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const canvas = canvasRef.current
    if (!canvas) return
    e.stopPropagation()
    e.preventDefault()

    const startRect = canvas.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    const startCueX = cue.x
    const startCueY = cue.y
    let pending: { x: number; y: number } | null = null

    function clamp01(v: number): number {
      return Math.max(0, Math.min(1, v))
    }
    function compute(ev: PointerEvent): { x: number; y: number } {
      // 读最新 rect，拖拽中窗口缩放也能跟
      const r = canvas!.getBoundingClientRect()
      const dx = (ev.clientX - startX) / Math.max(1, r.width)
      const dy = (ev.clientY - startY) / Math.max(1, r.height)
      return { x: clamp01(startCueX + dx), y: clamp01(startCueY + dy) }
    }

    function onMove(ev: PointerEvent): void {
      const next = compute(ev)
      // 本地 DOM 即时反馈（绕开 React state，和时间轴拖拽一致的 60Hz 节流思路）
      const el = ev.target as HTMLElement
      // 找到对应的 .ks-cue 节点（ev.target 可能是 tick/ring 子元素）
      const cueEl = el.closest('.ks-cue') as HTMLElement | null
      if (cueEl) {
        cueEl.style.left = `${next.x * 100}%`
        cueEl.style.top = `${next.y * 100}%`
      }
      pending = next
    }
    function onUp(ev: PointerEvent): void {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      try {
        ;(e.target as HTMLElement).releasePointerCapture(ev.pointerId)
      } catch {
        /* noop */
      }
      const next = pending ?? compute(ev)
      if (next.x !== startCueX || next.y !== startCueY) {
        onMoveCue({ x: next.x, y: next.y })
      }
    }
    function onCancel(): void {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      // canvas 坐标复位（不 commit）
    }

    try {
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
  }

  return (
    <div
      className={`ks-cue ks-cue-editor shape-${cue.shape} phase-${phase} ${
        isTrigger ? 'is-trigger' : ''
      }`}
      style={
        {
          left: `${cue.x * 100}%`,
          top: `${cue.y * 100}%`,
          '--ks-target-scale': CUE_RING_TARGET_SCALE,
          '--ks-peak': peakIntensity.toFixed(3),
          '--ks-hold-progress': '0',
        } as React.CSSProperties
      }
      title={`${cue.shape} · appear ${cue.appearAt}ms · target ${cue.targetAt}ms · 拖动改位置`}
      onPointerDown={onCuePointerDown}
    >
      {/* v3.3 · 结构与 QTEOverlay 对齐：
            - 无 glow / 无 core
            - target-ring 虚线靶圈，shape-specific 内容嵌入圈内
            - SWEEP 箭头放进 target-ring 里（不再跑出容器）
         */}
      <span
        className="ks-cue-ring"
        style={{ transform: `translate(-50%, -50%) scale(${ringScale})` }}
        aria-hidden
      />
      <span
        className={`ks-cue-target shape-${cue.shape} ${isNearPerfect ? 'is-peak' : ''}`}
        aria-hidden
      >
        <span className="ks-cue-target-ring">
          <span className="ks-cue-tick ks-cue-tick-n" />
          <span className="ks-cue-tick ks-cue-tick-s" />
          <span className="ks-cue-tick ks-cue-tick-e" />
          <span className="ks-cue-tick ks-cue-tick-w" />
          {cue.shape === 'tap' && (
            <span className="ks-cue-inner-tap" aria-hidden />
          )}
          {cue.shape === 'hold' && (
            <span className="ks-cue-inner-hold ks-mono" aria-hidden>HOLD</span>
          )}
          {cue.shape === 'sweep' && (
            <span
              className={`ks-cue-sweep-arrow dir-${cue.sweepDir ?? 'right'}`}
              aria-hidden
            >
              <span className="ks-cue-sweep-arrow-trail" />
              <span className="ks-cue-sweep-arrow-head" />
            </span>
          )}
        </span>
      </span>
      {cue.label && <span className="ks-cue-label ks-mono">{cue.label}</span>}
    </div>
  )
}

const stageCss = `
.ks-stage {
  flex: 1; min-height: 0;
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr) auto;
  padding: 14px 18px 12px;
  gap: 12px;
  position: relative;
  transition: box-shadow 220ms;
}
/*
 * 抽屉态（hideHeader=true）去掉 header 行 —— 否则 grid 仍保留 44px 空行，
 * canvas 会被挤进该行"缩上去"（作者 2026-04-30 反馈"图像预览的展位没了"）。
 *
 * v3.1：Shot/Audio 已下沉到 Timeline 多轨，Stage 不再嵌 ShotBoard；
 * 抽屉态 grid 只剩 canvas + timeline 两行。
 *
 * v3.9.8：抽屉里的 Stage 和下方 timeline cell **必须共用同一左右缘线**。
 *   原来 .ks-stage 有 'padding: 14px 18px 12px'（编辑器主界面场景需要这个留白），
 *   但 .ks-scene-detail-cell-timeline 只有 '6px 10px'。两者水平 padding 差 8px,
 *   导致视频窗比下方时间轴**更内收**，视觉上左右都错位。
 *   抽屉态下把 Stage 水平 padding 压到 10px，和时间轴 cell 对齐。
 */
.ks-stage.is-noheader {
  grid-template-rows: minmax(0, 1fr) auto;
  padding: 8px 10px 10px;
}
/*
 * v3.2 · SceneDetailDrawer 新布局
 *   · is-notimeline  → Timeline 已提升到抽屉 body grid，StagePane 内不再渲染
 *     此时 StagePane 瘦身为"只画画面"的单行 grid；外部 drawer 把 Prompt 和
 *     Dock 各自安放到 body 的对应 cell。
 *
 * （has-rightslot / rightSlot prop 仍保留给未来可能的 Stage Tab 使用；
 *  drawer 目前不走这条路径。）
 */
.ks-stage.is-notimeline {
  grid-template-rows: minmax(0, 1fr);
  padding: 8px 10px 10px;
}
.ks-stage.has-rightslot {
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 12px;
}
.ks-stage.has-rightslot > .ks-stage-canvas {
  grid-column: 1;
}
.ks-stage.has-rightslot > .ks-prompt-panel {
  grid-column: 2;
  grid-row: 1 / -1;
  align-self: stretch;
}
.ks-stage.is-focus-flash {
  box-shadow: inset 0 0 0 2px var(--ks-amber-glow), 0 0 24px rgba(232, 162, 58, 0.35);
  animation: ks-stage-focus-flash 720ms ease-out;
}
@keyframes ks-stage-focus-flash {
  0% { box-shadow: inset 0 0 0 0 rgba(232, 162, 58, 0); }
  35% { box-shadow: inset 0 0 0 3px rgba(232, 162, 58, 0.85), 0 0 36px rgba(232, 162, 58, 0.55); }
  100% { box-shadow: inset 0 0 0 1px rgba(232, 162, 58, 0.0); }
}
.ks-stage-empty {
  flex: 1;
  display: flex; align-items: center; justify-content: center;
  color: var(--ks-text-faint);
  letter-spacing: 0.22em;
}
.ks-stage-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 4px;
}
.ks-stage-title { font-family: var(--ks-font-display); font-size: 19px; font-weight: 600; color: var(--ks-text); letter-spacing: -0.01em; }
.ks-stage-meta {
  font-family: var(--ks-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.2em;
  color: var(--ks-text-dim);
  text-transform: uppercase;
}

.ks-stage-canvas {
  position: relative;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  overflow: hidden;
  min-height: 0;
  background:
    radial-gradient(ellipse at 50% 30%, rgba(125, 211, 252, 0.04), transparent 60%),
    #02050a;
  box-shadow: var(--ks-shadow-soft);
}
.ks-corner {
  position: absolute;
  width: 12px; height: 12px;
  border: 0 solid var(--ks-amber);
  pointer-events: none;
  opacity: 0.6;
}
.ks-corner-tl { top: -1px; left: -1px; border-top-width: 2px; border-left-width: 2px; }
.ks-corner-tr { top: -1px; right: -1px; border-top-width: 2px; border-right-width: 2px; }
.ks-corner-bl { bottom: -1px; left: -1px; border-bottom-width: 2px; border-left-width: 2px; }
.ks-corner-br { bottom: -1px; right: -1px; border-bottom-width: 2px; border-right-width: 2px; }

.ks-stage-video, .ks-stage-img {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
}
/*
 * VideoPlayToggle —— 舞台画面左下角的圆形播放按钮。
 *   - absolute + z-index:3 压在 video 之上，但只占角落，不挡画面
 *   - 悬停整体亮一度；按下缩 92%；playing 态颜色加冷色调（琥珀主题里用冷色表示"运行中"）
 *   - 半透明 + backdrop-filter 让任何背景底下都能看清图标
 */
.ks-stage-play-toggle {
  position: absolute;
  left: 14px;
  bottom: 14px;
  z-index: 3;
  width: 44px;
  height: 44px;
  padding: 0;
  border-radius: 50%;
  background: rgba(18, 16, 12, 0.55);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 200, 128, 0.35);
  color: var(--ks-amber, #f0b661);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform .12s var(--ks-ease, ease),
    background .2s var(--ks-ease, ease),
    border-color .2s var(--ks-ease, ease);
  user-select: none;
}
.ks-stage-play-toggle:hover {
  background: rgba(18, 16, 12, 0.78);
  border-color: rgba(255, 200, 128, 0.65);
}
.ks-stage-play-toggle:active {
  transform: scale(0.92);
}
.ks-stage-play-toggle.is-playing {
  color: var(--ks-cyan, #7dd3fc);
  border-color: rgba(125, 211, 252, 0.55);
}
/* 详情抽屉内点击图像 → 切换 Prompt 浮层（用户要求"点图 = 回收按钮同效果"） */
.ks-stage-img.is-clickable,
.ks-stage-placeholder.is-clickable {
  cursor: zoom-in;
}
.ks-stage-img.is-clickable:hover,
.ks-stage-placeholder.is-clickable:hover {
  filter: brightness(1.04);
}

.ks-stage-placeholder {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px;
  padding: 36px;
  text-align: center;
  background:
    repeating-linear-gradient(45deg, transparent 0 14px, rgba(255,255,255,0.02) 14px 15px);
}
.ks-stage-placeholder.is-pending { background-color: rgba(125,211,252,0.04); }
.ks-stage-placeholder.is-error { background-color: rgba(251, 113, 133, 0.04); }
.ks-ph-strip {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(232, 162, 58, 0.06) 50%,
    transparent 100%
  );
  pointer-events: none;
  animation: ks-strip-scan 3.4s ease-in-out infinite;
}
@keyframes ks-strip-scan {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}
.ks-ph-shotmeta {
  position: relative; z-index: 2;
  font-size: 11px;
  letter-spacing: 0.16em;
  color: var(--ks-cyan);
  opacity: 0.85;
}
.ks-ph-headline {
  position: relative; z-index: 2;
  font-family: var(--ks-font-mono);
  font-size: 13px;
  letter-spacing: 0.32em;
  color: var(--ks-amber);
}
.ks-ph-prompt {
  position: relative; z-index: 2;
  max-width: 64ch;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ks-text-soft);
}
.ks-ph-err {
  position: relative; z-index: 2;
  font-size: 11px;
  color: var(--ks-rose);
  max-width: 80%;
  word-break: break-all;
}
.ks-ph-action {
  position: relative; z-index: 2;
  font-family: var(--ks-font-mono);
  font-size: 11px;
  letter-spacing: 0.18em;
  padding: 8px 18px;
  border-color: var(--ks-cyan);
  color: var(--ks-cyan);
}
.ks-ph-action:hover:not(:disabled) {
  background: rgba(125, 211, 252, 0.08);
  box-shadow: var(--ks-shadow-glow-cyan);
  border-color: var(--ks-cyan);
  color: var(--ks-cyan);
}

/* ── QTE 打点（编辑器画面叠层）──────────────────────────
 * 视觉骨架完全复用 QTEOverlay 注入的 .ks-cue / .ks-cue-ring / ...
 * 这里只做编辑器特有的覆盖：
 *   - pointer-events 打开在 .ks-cue 容器本体上，让圆点可拖拽改 x/y；
 *     外环 / 刻度 / glow 全部 pointer-events:none，避免它们独立响应点击
 *     （否则用户点到"外环"会被当成 ring 的事件，不走 cue 容器的拖拽）
 *   - 整体 95% 透明度（提示作者"这是预览"）
 *   - phase-window 时整圈快速脉冲，强化"现在是命中尾窗"
 *   - 显式 background: transparent / outline: none / box-shadow: none —— 压平
 *     任何"容器方形背景"的可能来源（作者反馈"方形背景存在"）：
 *     容器本身是 96×96 div，若浏览器 UA 或 focus 给了默认 outline/box-shadow，
 *     就会在圆形内容周围画出方框。此处全部清零，只留内部圆形组件可见。
 */
.ks-cue.ks-cue-editor {
  pointer-events: auto;
  cursor: grab;
  opacity: 0.95;
  z-index: 4;
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  outline: none !important;
  border: 0 !important;
  box-shadow: none !important;
  /* 容器只负责定位，视觉全靠子元素 → 显式声明 isolation 防止被父级 filter 污染 */
  isolation: isolate;
}
.ks-cue.ks-cue-editor:focus,
.ks-cue.ks-cue-editor:focus-visible,
.ks-cue.ks-cue-editor:hover {
  outline: none !important;
  background: transparent !important;
  box-shadow: none !important;
}
.ks-cue.ks-cue-editor.is-dragging,
.ks-cue.ks-cue-editor:active {
  cursor: grabbing;
}
/* 内部装饰层一律不吃事件，让 .ks-cue 容器统一接管 pointerdown 用于拖拽 */
.ks-cue.ks-cue-editor .ks-cue-glow,
.ks-cue.ks-cue-editor .ks-cue-ring,
.ks-cue.ks-cue-editor .ks-cue-target,
.ks-cue.ks-cue-editor .ks-cue-target-ring,
.ks-cue.ks-cue-editor .ks-cue-tick,
.ks-cue.ks-cue-editor .ks-cue-core,
.ks-cue.ks-cue-editor .ks-cue-inner-tap,
.ks-cue.ks-cue-editor .ks-cue-inner-hold,
.ks-cue.ks-cue-editor .ks-cue-label,
.ks-cue.ks-cue-editor .ks-cue-sweep-arrow,
.ks-cue.ks-cue-editor .ks-cue-sweep-arrow-trail,
.ks-cue.ks-cue-editor .ks-cue-sweep-arrow-head {
  pointer-events: none;
}
.ks-cue.ks-cue-editor.phase-window {
  animation: ks-cue-editor-window 360ms ease-in-out infinite alternate;
}
@keyframes ks-cue-editor-window {
  from { filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.4)); }
  to   { filter: drop-shadow(0 0 18px rgba(255, 255, 255, 0.85)); }
}

/* 字幕带 */
.ks-caption-band {
  position: absolute;
  left: 0; right: 0; bottom: 18px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 0 36px;
  z-index: 3;
  pointer-events: none;
}
.ks-caption-speaker {
  font-size: 9.5px;
  letter-spacing: 0.32em;
  color: var(--ks-amber-glow);
}
.ks-caption {
  font-size: 17px;
  line-height: 1.55;
  color: #f4f7ff;
  text-shadow: 0 1px 4px rgba(0,0,0,0.6), 0 0 18px rgba(232,162,58,0.18);
  text-align: center;
  max-width: 60ch;
}

.ks-img-stamp,
.ks-img-stamp-btn { display: none !important; }
`
injectStyleOnce('stage-pane', stageCss)
