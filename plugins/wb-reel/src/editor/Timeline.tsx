import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  AudioClip,
  Branch,
  DialogueLine,
  QTECue,
  Scene,
  SearchSegmentClip,
  Shot,
  TextOverlayClip,
} from '../scenario/types'
import { injectStyleOnce } from '../styles/injectStyle'
import { rafThrottle } from '../lib/rafThrottle'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useMediaStore } from '../media/mediaStore'
import { useShellStore } from '../shell/shellStore'
import { useTimelineDrag } from './timeline/useTimelineDrag'
import { useDialogueSelection } from './timeline/dialogueSelection'
import { useClipSelection } from './timeline/clipSelection'
import { resolveShotAtMs } from './timeline/shotResolver'
import {
  moveDialoguePatch,
  resizeDialogueLeftPatch,
  resizeDialogueRightPatch,
} from './timeline/dialogueDrag'
import {
  moveCuePatch,
  resizeTrigBandLeadInPatch,
} from './timeline/cueDrag'
import { moveBranchShowAtPatch } from './timeline/branchDrag'
import {
  describeSnapGrid,
  formatDelta,
  formatTimeCode,
  previewKeyTimeMs,
} from './timeline/timelineFormat'
import type { SnapModifiers } from './timeline/timelineMath'
import {
  previewedBranch as projectBranch,
  previewedCue as projectCue,
  previewedDialogue as projectDialogue,
  type TimelinePreview,
} from './timeline/timelinePreview'
import {
  duplicateDialogue,
  makeInsertBranch,
  makeInsertCue,
  makeInsertDialogue,
  makeInsertMinigame,
  makeInsertTextOverlay,
  makeInsertSearchSegment,
  makeInsertFilterClip,
  makeInsertAdjustClip,
  makeInsertEffectClip,
  makeInsertStickerClip,
} from './timeline/insertFactories'
import {
  TimelineContextMenu,
  type ContextTarget,
} from './timeline/TimelineContextMenu'
import {
  TimelineToolbar,
  type ToolbarSelection,
} from './timeline/TimelineToolbar'
import { DOCK_MIME, parseDockPayload } from './timeline/dndTypes'
import { getEffectPreset, getFilterPreset, getStickerPreset, getTransitionPreset } from '../fx/fxPresets'
import { clampToScene, moveTo } from './timeline/editOps'
import { planVideoDrop } from './timeline/videoDropPlan'
import { probeVideoDurationMs } from './timeline/probeVideoDuration'
import { loadSnapPref, saveSnapPref } from './timeline/snapPref'
import { loadDialoguePref, saveDialoguePref } from './timeline/dialoguePref'
import { computeVideoTrim } from './timeline/computeVideoTrim'
import { nudgeVideoOffset } from './timeline/nudgeVideoOffset'
import { GenRequestDialog } from '../forge/GenRequestDialog'
import { jobForShot, jobForMedia, type GenJob } from '../forge/generationQueueStore'
import { useToastStore } from '../ui/toastStore'

/**
 * 轨道可见性开关 —— v3.9。
 * 用户诉求「只保留 视频/图像/音频/台词/QTE 五行」，这里把历史上的 TRIG / GAME /
 * BRANCH 三行统一关闭。保留代码是为了：
 *   1. 数据层 scene.qte.slowMo / scene.minigames / scene.branches 都还在用；
 *   2. 将来接回"跨 scene 分支编辑"视图时，直接把 flag 打开即可。
 * 不要把它变成运行时可切换的 store 字段 —— 现阶段它就是个编辑期死开关。
 */
const VISIBLE_TRACKS = {
  trig: false,
  game: false,
  branch: false,
} as const

interface Props {
  scene: Scene
  hoverMs: number
  setHoverMs: (ms: number) => void
  /**
   * 拖拽实时回调 —— 抬到 StagePane 用，让画面层（QTE 标记、字幕预览、分支 pin）
   * 跟着鼠标即时移动，不必等 pointerup 才看到结果。
   *
   * 设计要点：
   *   - 仅做"视觉镜像"：父组件接到 preview 后只用来调整渲染，不写 store
   *   - pointerup 时 Timeline 自己 dispatch updateXxx，单步 undo 仍然成立
   *   - 不再需要时（取消 / 释放）会发 null
   */
  onPreviewChange?: (preview: TimelinePreview | null) => void
  /**
   * 台词 / 字幕轨的可见性变化回调 —— 作者默认藏掉 DIA 轨（见 dialoguePref），
   * 同一开关还要影响上方画面的字幕预览。Timeline 自己持有状态（从 localStorage
   * 读，点击工具条切换），通过这个回调把最新值丢给父组件（StagePane 的字幕预览
   * 消费）。不给父组件就只控自己的轨道显隐。
   */
  onShowDialogueChange?: (visible: boolean) => void
}

/**
 * 时间轴 · 字幕带 / QTE 带 / 触发轨 / 分支带 四轨叠加
 *
 *  ──────────────── 0:00 ─────────── 1:30 ──────────── 3:00 ────────────
 *  Dialogue  ▭▭▭▭▭     ▭▭▭▭▭▭▭▭                ▭▭▭
 *  QTE                       ◆               ◆     ◆
 *  TRIG                  [══0.30×══]                          ← 子弹时间区间
 *  Branch                                          ▾ choice  ▾ choice
 *
 * 鼠标在轴上 hover 滚动 → 触发上方画面字幕/QTE 的"当前时刻"预览。
 *
 * 阶段 C 起：
 *   - clip / pin / band 上的 PointerDown 启动拖拽（useTimelineDrag）
 *   - 拖动期间走本地 preview 状态（不污染 scenarioStore，避免 60Hz 写入 + undo 噪声）
 *   - 释放时一次 dispatch updateXxx，得到「一拖一格 undo」
 *   - 修饰键 Shift = 10ms 精细 / Alt = 500ms 粗（参见 timelineMath.resolveSnapGridMs）
 *   - 顶栏 SNAP 按钮是全局吸附总开关：关掉后拖拽走 rawDeltaMs（1ms 自由位移），
 *     修饰键仍会被记录但不参与吸附。偏好持久化到 localStorage（见 snapPref.ts）。
 */
/**
 * 时间轴「可编辑画布长度」canvasMs = max(scene.durationMs, 50s)。
 *
 * 一劳永逸 —— 时间轴默认 50s，绝不被生成的素材秒数压缩：
 *   - scene.durationMs = 节点「素材播放时长」估计：player 据此/或按视频真实时长播放，
 *     播完就跳下一节点（视频靠 <video> onEnded；图像/占位按 durationMs）。剧本锻造时
 *     LLM 给的短估计（如 6s）、或生成的短视频，只影响**播放**，不影响时间轴长度。
 *   - canvasMs = 时间轴渲染 / 拖拽基准 = max(durationMs, CANVAS_DEFAULT_MS=50s)。
 *     每个节点起步就有 ≥50s 的可编辑画布；生成 6s 视频也不会把时间轴压成 6s —— 视频
 *     只是画布里一段 6/50 宽的 clip。所有轨道（含 VIDEO 条）一律按 canvasMs 定位。
 *     工具条「总长」显示/调整的就是这条画布长度（可向上加长，下限 50s）。
 *   - zoom = 纯视觉放大倍率，不改变任何秒数。
 */
const CANVAS_DEFAULT_MS = 50_000
/** 缩放倍率范围 —— 1× = 整段刚好铺满面板（无横向滚动），放大才出现滚动条 */
const ZOOM_MIN = 1
const ZOOM_MAX = 20

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return ZOOM_MIN
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z))
}

/**
 * 生成刻度尺的 tick 列表。
 *   - 已知 pps（像素/秒）时按「nice step」自适应密度，让相邻标签间隔 ≥ ~64px；
 *   - 拿不到 pps（首帧未测量）时退回均分 5 格，保持旧观感。
 */
function buildRuleTicks(
  totalMs: number,
  pps: number,
): Array<{ sec: number; label: string }> {
  const totalSec = totalMs / 1000
  if (!(pps > 0) || !(totalSec > 0)) {
    return Array.from({ length: 5 }, (_, i) => {
      const sec = (totalSec * i) / 4
      return { sec, label: `${sec.toFixed(1)}s` }
    })
  }
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600]
  const minPx = 64
  const step = steps.find((s) => s * pps >= minPx) ?? 600
  const ticks: Array<{ sec: number; label: string }> = []
  for (let s = 0; s <= totalSec + 1e-6; s += step) {
    ticks.push({ sec: s, label: formatTickLabel(s) })
  }
  return ticks
}

function formatTickLabel(sec: number): string {
  const r = Math.round(sec)
  if (r < 60) return `${r}s`
  const m = Math.floor(r / 60)
  const s = r % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function Timeline({ scene, hoverMs, setHoverMs, onPreviewChange, onShowDialogueChange }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // 横向滚动视口（包住 .ks-timeline-tracks）—— 量它的宽度来推算画布像素宽
  const scrollRef = useRef<HTMLDivElement>(null)

  // 缩放（剪映式，纯视觉）：1× = 适配宽度，放大 → 画布变宽 + 横向滚动
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  // 视口可用宽度（px）——由 ResizeObserver 持续测量
  const [viewportW, setViewportW] = useState(0)

  // 画布长度（ms）= max(节点素材时长, 50s 默认画布)；保证时间轴起步 ≥50s，
  // 不被生成的短视频/短估计压缩。zoom 只是视觉放大，不改秒数。
  const canvasMs = Math.max(scene.durationMs, CANVAS_DEFAULT_MS)
  const total = canvasMs
  // 画布像素宽 = 视口宽 × 缩放（box-sizing:border-box，含边框，1× 时正好不出现滚动条）
  const canvasPx = viewportW > 0 ? Math.floor(viewportW * zoom) : null
  const pps = canvasPx ? canvasPx / (total / 1000) : 0
  const ruleTicks = useMemo(() => buildRuleTicks(total, pps), [total, pps])

  // DIA 轨「多行」：时间上重叠的台词分配到不同行，避免在单行里糊成一团。
  // 贪心区间分行（lane = 第一条"上一段已结束"的行），返回每条台词的行号 + 总行数。
  const dialogueLanes = useMemo(
    () => assignDialogueLanes(scene.dialogue),
    [scene.dialogue],
  )

  const totalRef = useRef(total)
  totalRef.current = total
  const setHoverMsRef = useRef(setHoverMs)
  setHoverMsRef.current = setHoverMs

  const lastCommitRef = useRef(-1)

  // track RAF 回调里要"实时读最新 shots / 调度 setSelectedShotId"。
  // track 本身是 useMemo + rafThrottle，只创建一次，因此必须通过 ref 注入当前值，
  // 否则会闭包锁死在首次 render 的 scene.shots。
  // lastCommittedShotIdRef 同时用来去重：ms 在同一个 shot 的区间里小幅抖动不应反复 set。
  const shotsRef = useRef(scene.shots)
  shotsRef.current = scene.shots
  // setSelectedShotIdRef 在下方 `setSelectedShotId = useShellStore(...)` 出现之后
  // 再初始化；之前顺手放在这里导致 TDZ ReferenceError，Timeline 直接白屏 ——
  // 这就是 2026-05-11 作者反馈"tree 详情打不开"的原因。ref 对象本身不需要
  // 跟着 setSelectedShotId 声明走，所以只拆出 useRef(null)，真正赋值放到
  // setSelectedShotId 拿到之后（见下方 useLayoutEffect / 直接赋值）。
  const setSelectedShotIdRef = useRef<((id: string | null) => void) | null>(null)
  const lastCommittedShotIdRef = useRef<string | null | undefined>(undefined)

  const updateDialogue = useScenarioStore((s) => s.updateDialogue)
  const updateQTECue = useScenarioStore((s) => s.updateQTECue)
  const updateBranch = useScenarioStore((s) => s.updateBranch)
  const addDialogue = useScenarioStore((s) => s.addDialogue)
  const addQTECue = useScenarioStore((s) => s.addQTECue)
  const addBranch = useScenarioStore((s) => s.addBranch)
  const removeDialogue = useScenarioStore((s) => s.removeDialogue)
  const removeEmptyDialogue = useScenarioStore((s) => s.removeEmptyDialogue)
  const removeQTECue = useScenarioStore((s) => s.removeQTECue)
  const removeBranch = useScenarioStore((s) => s.removeBranch)
  const rootSceneId = useScenarioStore((s) => s.scenario.rootSceneId)
  const updateShot = useScenarioStore((s) => s.updateShot)
  const removeShot = useScenarioStore((s) => s.removeShot)
  const splitShot = useScenarioStore((s) => s.splitShot)
  const compactShotsLeft = useScenarioStore((s) => s.compactShotsLeft)
  const addAudioClip = useScenarioStore((s) => s.addAudioClip)
  const updateAudioClip = useScenarioStore((s) => s.updateAudioClip)
  const removeAudioClip = useScenarioStore((s) => s.removeAudioClip)
  const splitAudioClip = useScenarioStore((s) => s.splitAudioClip)
  const compactAudioLeft = useScenarioStore((s) => s.compactAudioLeft)
  const addMinigameClip = useScenarioStore((s) => s.addMinigameClip)
  const removeMinigameClip = useScenarioStore((s) => s.removeMinigameClip)
  const addTextOverlay = useScenarioStore((s) => s.addTextOverlay)
  const removeTextOverlay = useScenarioStore((s) => s.removeTextOverlay)
  const updateTextOverlay = useScenarioStore((s) => s.updateTextOverlay)
  const addSearchSegment = useScenarioStore((s) => s.addSearchSegment)
  const removeSearchSegment = useScenarioStore((s) => s.removeSearchSegment)
  const updateSearchSegment = useScenarioStore((s) => s.updateSearchSegment)
  const addFilterClip = useScenarioStore((s) => s.addFilterClip)
  const removeFilterClip = useScenarioStore((s) => s.removeFilterClip)
  const updateFilterClip = useScenarioStore((s) => s.updateFilterClip)
  const addAdjustClip = useScenarioStore((s) => s.addAdjustClip)
  const removeAdjustClip = useScenarioStore((s) => s.removeAdjustClip)
  const updateAdjustClip = useScenarioStore((s) => s.updateAdjustClip)
  const addEffectClip = useScenarioStore((s) => s.addEffectClip)
  const removeEffectClip = useScenarioStore((s) => s.removeEffectClip)
  const updateEffectClip = useScenarioStore((s) => s.updateEffectClip)
  const addStickerClip = useScenarioStore((s) => s.addStickerClip)
  const removeStickerClip = useScenarioStore((s) => s.removeStickerClip)
  const updateStickerClip = useScenarioStore((s) => s.updateStickerClip)
  const clearSceneTimeline = useScenarioStore((s) => s.clearSceneTimeline)
  const addShot = useScenarioStore((s) => s.addShot)
  const setSceneMediaRef = useScenarioStore((s) => s.setSceneMediaRef)
  const updateScene = useScenarioStore((s) => s.updateScene)
  const setSelectedShotId = useShellStore((s) => s.setSelectedShotId)
  const shellSelectedShotId = useShellStore((s) => s.selectedShotId)
  // 现在 setSelectedShotId 已就绪，把它灌进之前声明的 ref。
  // 每次 render 执行，等价于旧代码里紧跟 useRef 的那行 `.current = setter`。
  setSelectedShotIdRef.current = setSelectedShotId

  const drag = useTimelineDrag({
    getTrackEl: () => ref.current,
    getTotalMs: () => totalRef.current,
  })

  /**
   * 拖拽期间的「即时预览」——只影响视觉，不进 store。
   * 释放后一次性 dispatch 才落盘 + 进 undo 栈。
   *
   * 同步通过 onPreviewChange 镜像给 StagePane，画面层会一起跟随。
   */
  type Preview = TimelinePreview

  const [preview, setPreviewLocal] = useState<Preview | null>(null)
  const onPreviewChangeRef = useRef(onPreviewChange)
  onPreviewChangeRef.current = onPreviewChange
  function setPreview(p: Preview | null): void {
    setPreviewLocal(p)
    onPreviewChangeRef.current?.(p)
  }

  /** 右键菜单状态 —— null 表示菜单未打开 */
  const [ctxMenu, setCtxMenu] = useState<{
    x: number
    y: number
    target: ContextTarget
  } | null>(null)

  /**
   * Toolbar 选中 clip —— SHOT / AUDIO 二选一或无
   * Shot 选中与 shellStore.selectedShotId 双向同步：选 shot 会同时写 shell
   * （让抽屉内其他地方如 PromptTabs 的 Shot tab 跟随），反之亦然。
   */
  const [toolbarSel, setToolbarSel] = useState<ToolbarSelection | null>(null)
  /**
   * 当前打开「生成请求详情」弹窗的 job —— 双击/右键时间轴上的视频片段时填入，
   * 复用 GenRequestDialog 展示提示词 / 上传的参考素材 / 参数 / 报错。
   */
  const [inspectJob, setInspectJob] = useState<GenJob | null>(null)
  /*
   * 当前选中的 dialogue id —— 同步给 TimelineDock 的"字幕"tab 渲染详情面板。
   *
   * 入口现在改成"右侧 Dock 详情"而非旧的"双击 clip 进 inline 编辑"。
   * Timeline 单击 dialogue clip → setToolbarSel({kind:'dialogue', id}) → 同步写入
   * dialogueSelection store；切场景或选其它 kind 的 clip 时清空。
   */
  const setSelectedDialogue = useDialogueSelection((s) => s.setSelected)
  const setSelectedTextOverlay = useClipSelection((s) => s.setTextOverlay)
  const setSelectedSearchSegment = useClipSelection((s) => s.setSearchSegment)
  const setFxSelection = useClipSelection((s) => s.setFxSelection)
  // toolbarSel 变化时单向同步到各 selection store（DRY 选中逻辑）
  useEffect(() => {
    if (toolbarSel?.kind === 'dialogue') setSelectedDialogue(toolbarSel.id)
    else setSelectedDialogue(null)
    if (toolbarSel?.kind === 'textOverlay') setSelectedTextOverlay(toolbarSel.id)
    else setSelectedTextOverlay(null)
    if (toolbarSel?.kind === 'searchSegment') setSelectedSearchSegment(toolbarSel.id)
    else setSelectedSearchSegment(null)
    if (
      toolbarSel?.kind === 'filter' ||
      toolbarSel?.kind === 'adjust' ||
      toolbarSel?.kind === 'effect' ||
      toolbarSel?.kind === 'sticker' ||
      toolbarSel?.kind === 'transition'
    ) {
      setFxSelection({ kind: toolbarSel.kind, id: toolbarSel.id })
    } else {
      setFxSelection(null)
    }
  }, [toolbarSel, setSelectedDialogue, setSelectedTextOverlay, setSelectedSearchSegment, setFxSelection])
  // 切场景时清空选中 dialogue
  useEffect(() => {
    setSelectedDialogue(null)
  }, [scene.id, setSelectedDialogue])

  // 持续测量滚动视口宽度 —— 缩放与刻度密度都依赖它。
  //
  // ⚠️ 反馈环防护：setViewportW 会改变画布像素宽（canvasPx = viewportW × zoom），
  // 而画布在被观测的 scroll 视口内部，宽度变化又可能改变滚动条 → wrap.clientWidth →
  // ResizeObserver 再次回调。若在 RO 回调里同步 setState，会在 layout 提交阶段触发
  // React「Maximum update depth exceeded」崩溃。因此：
  //   1) RO 回调与首测都走 requestAnimationFrame 合帧延后，把任何 setState 都移出
  //      layout 提交阶段 —— 这是「Maximum update depth exceeded」这一类崩溃的结构性
  //      根因（在 commitLayoutEffect 里同步 setState → 再 commit → 再 setState…）。
  //      绝不在 effect body / RO 回调里同步调用 setViewportW。
  //   2) 仅当测得宽度真正变化（≥1px）时才 setState，宽度稳定后立即停环。
  useLayoutEffect(() => {
    const wrap = scrollRef.current
    if (!wrap) return
    let raf = 0
    const apply = (): void => {
      const w = wrap.clientWidth
      setViewportW((prev) => (Math.abs(prev - w) < 1 ? prev : w))
    }
    // 首测也延后到下一帧：避免在 layout 提交阶段同步 setState。
    raf = requestAnimationFrame(apply)
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(apply)
    })
    ro.observe(wrap)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  // 滚轮交互：Ctrl/⌘ + 滚轮 = 以光标为锚点缩放；普通滚轮 = 横向滚动。
  // 用原生非 passive 监听，才能 preventDefault 阻止页面缩放/纵向滚动。
  useEffect(() => {
    const wrap = scrollRef.current
    if (!wrap) return
    function onWheel(e: WheelEvent): void {
      if (!wrap) return
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const rect = wrap.getBoundingClientRect()
        const w = wrap.clientWidth
        if (w <= 0) return
        const cursorX = e.clientX - rect.left + wrap.scrollLeft
        const curPx = Math.max(1, w * zoomRef.current)
        const ratio = cursorX / curPx
        const next = clampZoom(zoomRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15))
        if (next === zoomRef.current) return
        setZoom(next)
        const nextPx = w * next
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollLeft = ratio * nextPx - (e.clientX - rect.left)
          }
        })
      } else if (wrap.scrollWidth > wrap.clientWidth + 1) {
        const primary =
          Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
        if (primary !== 0) {
          wrap.scrollLeft += primary
          e.preventDefault()
        }
      }
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => {
    if (shellSelectedShotId) {
      setToolbarSel((cur) =>
        cur?.kind === 'shot' && cur.id === shellSelectedShotId
          ? cur
          : { kind: 'shot', id: shellSelectedShotId },
      )
    }
  }, [shellSelectedShotId])

  function selectShotFromTimeline(shotId: string): void {
    setToolbarSel({ kind: 'shot', id: shotId })
    setSelectedShotId(shotId)
  }
  function selectAudio(clipId: string): void {
    setToolbarSel({ kind: 'audio', id: clipId })
  }

  /**
   * v3.2 · dialogue / cue / branch 的点选 —— 统一写入 toolbarSel，
   * 和 shot/audio 共用工具条的"删除 / 左移右移"行为。
   *
   * pointerdown 时就选中（不是等 pointerup），这样用户"按下即高亮"；
   * 若随后发生拖拽，selection 不会被 drop 端重置。
   */
  function selectDialogue(id: string): void {
    setToolbarSel({ kind: 'dialogue', id })
  }
  function selectCue(id: string): void {
    setToolbarSel({ kind: 'cue', id })
  }
  function selectBranch(id: string): void {
    setToolbarSel({ kind: 'branch', id })
  }
  function selectMinigame(id: string): void {
    setToolbarSel({ kind: 'minigame', id })
  }

  /**
   * v3.9.8 · VIDEO 轨选中。video 每 scene 唯一，id 用 `scene:<sceneId>` 保证
   *   调试 / 键盘 handler 里的"选中归属"可读。点中 .ks-video-clip 走此处，
   *   stopPropagation 在 caller 做；这里只负责写 selection。
   */
  function selectVideo(): void {
    setToolbarSel({ kind: 'video', id: `scene:${scene.id}` })
  }

  /**
   * 双击/右键时间轴上的视频片段 → 打开「这段视频是怎么生成的」请求详情。
   *   · 逐镜视频：按 sceneId+shotId 反查最近一次 job（兜底按结果 mediaId 反查）。
   *   · 场景级单条视频：按 scene.media.ref 结果 mediaId 反查。
   * 找不到生成记录（如外部拖入 / 已清理队列）时给个轻提示，不打断。
   */
  function inspectShotRequest(shot: Shot, prefer?: 'image' | 'video'): void {
    // prefer：图像轨(关键帧)传 'image'、视频轨传 'video'，命中同一镜下对应类型的 job；
    // 兜底按「偏好 → 不分类型 → 按产物 mediaId 反查」逐级回退。
    const byKind = prefer ? jobForShot(scene.id, shot.id, prefer) : undefined
    const job =
      byKind ??
      jobForShot(scene.id, shot.id) ??
      (shot.videoMediaRef ? jobForMedia(shot.videoMediaRef) : undefined) ??
      (shot.keyframeMediaRef ? jobForMedia(shot.keyframeMediaRef) : undefined)
    if (job) setInspectJob(job)
    else
      useToastStore
        .getState()
        .fire(
          prefer === 'image'
            ? '没找到这一镜关键帧的生成记录（可能已清理队列或为外部导入）'
            : '没找到这段视频的生成记录（可能已清理队列或为外部导入）',
          { kind: 'info' },
        )
  }
  function inspectMediaRequest(mediaId: string | undefined): void {
    const job = mediaId ? jobForMedia(mediaId) : undefined
    if (job) setInspectJob(job)
    else
      useToastStore
        .getState()
        .fire('没找到这段视频的生成记录（可能已清理队列或为外部导入）', { kind: 'info' })
  }

  /**
   * 「在素材库查看」—— 时间轴 clip 右键跳转到素材库并定位卡片。
   *   · 分镜（图像 keyframe / 逐镜视频）→ 落到「分镜」页签、高亮滚动到该镜，
   *     卡片里能看到提示词 + 关键帧 + （有则）视频缩略。
   *   · 场景级单条视频 → 落到「视频」页签。
   * 先 selectScene 让素材库跟随到当前节点，再 openAssetFocus 切视图 + 写聚焦意图。
   */
  function openShotInAssets(shot: Shot): void {
    useScenarioStore.getState().selectScene(scene.id)
    useShellStore.getState().openAssetFocus({
      sceneId: scene.id,
      trayKind: 'shot',
      shotId: shot.id,
    })
  }
  function openSceneVideoInAssets(): void {
    useScenarioStore.getState().selectScene(scene.id)
    useShellStore.getState().openAssetFocus({
      sceneId: scene.id,
      trayKind: 'video',
      shotId: null,
    })
  }

  /**
   * shot/audio clip 拖拽的本地预览（不写 store），pointerup 一次性 commit。
   * 与 dialogue/cue/branch 的 preview 并行维护，这样彼此不会互相覆盖。
   */
  type ShotPreview = { id: string; startMs: number; endMs: number }
  type AudioPreview = { id: string; startMs: number; durationMs: number }
  /**
   * 视频裁剪预览 —— v3.9。拖 VIDEO 轨 handle 时本地维护入/出点（ms，
   * 视频文件坐标），pointerup 一次性写 scene.videoOffsetMs / videoClipDurationMs。
   */
  type VideoTrimPreview = { offsetMs: number; clipDurationMs: number }
  const [shotPreview, setShotPreview] = useState<ShotPreview | null>(null)
  const [audioPreview, setAudioPreview] = useState<AudioPreview | null>(null)
  const [videoTrimPreview, setVideoTrimPreview] = useState<VideoTrimPreview | null>(null)

  /**
   * SNAP 吸附开关 —— 全局布尔，控制拖拽时是否走 resolveSnapGridMs 网格。
   *
   * 初值从 localStorage 读（默认 true）；每次切换都立即落盘，刷新不丢。
   * 切成 false 后，拖 dialogue/cue/branch/shot/audio 时
   * `deltaMs == rawDeltaMs`，可实现 1ms 自由位移——用于对精帧的极细调整。
   *
   * 修饰键（Shift=10ms / Alt=500ms）只在 snap=true 时生效；
   * snap=false 时修饰键仍会被记录到 state.modifiers，但不参与吸附。
   */
  const [snapEnabled, setSnapEnabled] = useState<boolean>(() => loadSnapPref())
  function toggleSnap(): void {
    setSnapEnabled((v) => {
      const next = !v
      saveSnapPref(next)
      return next
    })
  }

  /**
   * DIA（台词 / 字幕）轨可见性 —— 作者 2026-05-07 需求：
   *   默认藏掉，让编辑时时间轴更安静；画面预览也同步不叠字幕。
   * 值从 localStorage 读（默认 false），切换立即落盘并通过回调告知父组件，
   * 父组件再把这个 flag 灌到 StagePane 控制画面上的字幕 band。
   */
  const [showDialogue, setShowDialogue] = useState<boolean>(() => loadDialoguePref())
  const onShowDialogueChangeRef = useRef(onShowDialogueChange)
  onShowDialogueChangeRef.current = onShowDialogueChange
  useEffect(() => {
    onShowDialogueChangeRef.current?.(showDialogue)
  }, [showDialogue])
  function toggleDialogue(): void {
    setShowDialogue((v) => {
      const next = !v
      saveDialoguePref(next)
      return next
    })
  }

  /**
   * 光标跟随模式 —— 2026-04-30 作者需求（v3.9 默认改为 off）。
   *
   *   on  鼠标 hover 时间轴，时间线（hoverMs）实时跟随鼠标；StagePane
   *             同步预览该时刻的对白 / QTE / 镜头画面。交互上"所见即所得"，
   *             但鼠标稍微一晃，时间线就"乱飞"。
   *
   *   off (默认) 鼠标 hover 时不再改 hoverMs；时间线只在点击时间轴空白时才跳过去。
   *             作者想"先把光标定在 3.2 秒，再去右边拖一个字幕进来"的时候，
   *             不会被鼠标途中经过的位置覆盖。
   *
   * 两种模式下拖入落点都统一取 hoverMs（见 onTrackDrop），
   * 因此关闭跟随后，落点 100% 可控。
   */
  const [followCursor, setFollowCursor] = useState<boolean>(false)
  function toggleFollow(): void {
    setFollowCursor((v) => !v)
  }

  /**
   * 鼠标移动是 60Hz+ 高频事件；如果每次都直接 setState，
   * 父组件 StagePane 整个画面（视频 / QTE 标记 / 字幕预览）
   * 都跟着每秒重渲数十次。这里做两层防抖：
   *   1. rAF 节流：一帧最多触发一次
   *   2. 值未变化时跳过（鼠标在原地颤动 / 滚轮触摸板抖动）
   */
  const track = useMemo(
    () =>
      rafThrottle((clientX: number) => {
        const el = ref.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const ratio = Math.min(
          1,
          Math.max(0, (clientX - rect.left) / rect.width),
        )
        const next = Math.round(ratio * totalRef.current)
        if (next === lastCommitRef.current) return
        lastCommitRef.current = next
        setHoverMsRef.current(next)

        // 顺带把 "当前 ms 落在哪个 shot" 同步给 shellStore，
        // 让 PromptTabs / StagePane 这类关心 selectedShot 的组件自动切到对应分镜。
        // 只在 shot 真正变化时 dispatch，避免每帧都触发订阅者重渲。
        const shotId = resolveShotAtMs(shotsRef.current, next, totalRef.current)
        if (shotId !== lastCommittedShotIdRef.current) {
          lastCommittedShotIdRef.current = shotId
          if (shotId) setSelectedShotIdRef.current?.(shotId)
        }
      }),
    [],
  )

  useEffect(() => () => track.cancel(), [track])

  /**
   * 拖动 scrub —— 在时间轴空白处（非 clip）按下并拖动，playhead 实时跟随，松手停。
   *
   * 作者反馈（2026-06-19）："拖动时间轴没有实时预览到当前画面 / 字幕"。根因：
   * 过去鼠标移动只有在 followCursor 打开时才更新 hoverMs（默认关），单击也只在
   * 落点设一次，所以"按住拖动"不会连续刷新 hoverMs，画面/字幕自然不跟手。
   *
   * 这里给"空白处按下"补一段标准的拖拽 scrub：pointerdown → 捕获 → pointermove
   * 持续 track(clientX) → pointerup 释放。命中 clip 时不启动（clip 有自己的拖拽，
   * 见 onPointerDown 里的 hitClip 判定），所以不会和拖动 clip 互相打架。
   * 与 followCursor 无关：这是显式拖拽手势，不是 hover 跟随。
   */
  function beginScrub(e: React.PointerEvent): void {
    const el = ref.current
    if (!el) return
    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      /* 某些环境无 pointer capture：仍可靠 document 监听 scrub */
    }
    function onMove(ev: PointerEvent): void {
      track(ev.clientX)
    }
    function onUp(ev: PointerEvent): void {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
      try {
        el?.releasePointerCapture(ev.pointerId)
      } catch {
        /* noop */
      }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  /**
   * hoverMs 受多方来源驱动（track 鼠标 hover、Player 播放 playhead、拖放落点…），
   * 所以"拖动时间轴就切当前 shot"这一语义，除了在 track 里尽早同步之外，
   * 还需要在 hoverMs 作为 effect 依赖时**兜底**重算一次。
   * 这样 Player 自动前进、或者外部代码改 hoverMs，也能联动 selectedShotId。
   * resolveShotAtMs 是纯函数，O(N) 且 shots 一般 ≤ 10，成本可忽略。
   */
  useEffect(() => {
    const shotId = resolveShotAtMs(scene.shots, hoverMs, total)
    // 幂等 + 重挂载安全：除了本地 lastCommittedShotIdRef 去重，还要和 shell 现值比对。
    // 组件一旦重挂载（key 变），lastCommittedShotIdRef 会重置为 undefined，若只看它
    // 就会在每次挂载时把 shell 里**本就相等**的值再写一遍 → 触发订阅者（含本组件
    // 的 shell→toolbar effect）重渲，叠加重挂载会演变成同步 setState 风暴
    // （React「Maximum update depth exceeded」）。加上 `shotId !== shellSelectedShotId`
    // 这一条：shell 已经是该值时绝不重复写，挂载/重挂载都不会再发起多余更新。
    if (
      shotId &&
      shotId !== lastCommittedShotIdRef.current &&
      shotId !== shellSelectedShotId
    ) {
      lastCommittedShotIdRef.current = shotId
      setSelectedShotId(shotId)
    }
  }, [hoverMs, scene.shots, total, setSelectedShotId, shellSelectedShotId])

  /**
   * 键盘快捷键 —— v3.2 让时间轴"感觉像个剪辑器"：
   *   · Delete / Backspace → 删除选中 clip
   *   · Esc → 取消选中
   *   · ← / → → 左右移动选中 clip（默认 100ms · Shift=10ms · Alt=500ms）
   *
   * 严格只在"编辑器的可输入控件没聚焦时"响应，避免文本域里按退格就把台词删了。
   */
  const tbDeleteRef = useRef<() => void>(() => {})
  const tbNudgeRef = useRef<(dir: -1 | 1, step: number) => void>(() => {})
  useEffect(() => {
    function isTypingTarget(t: EventTarget | null): boolean {
      if (!(t instanceof HTMLElement)) return false
      const tag = t.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (t.isContentEditable) return true
      return false
    }
    function onKey(e: KeyboardEvent): void {
      if (isTypingTarget(e.target)) return
      if (!toolbarSel) {
        // 没有选中时不接管，避免吞掉页面级快捷键
        return
      }
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          tbDeleteRef.current()
          break
        case 'Escape':
          e.preventDefault()
          setToolbarSel(null)
          break
        case 'ArrowLeft':
        case 'ArrowRight': {
          const step = e.shiftKey ? 10 : e.altKey ? 500 : 100
          const dir = e.key === 'ArrowLeft' ? -1 : 1
          e.preventDefault()
          tbNudgeRef.current(dir as -1 | 1, step)
          break
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toolbarSel])

  /** 把当前 preview 投影到对应实体上，得到「视觉用」的最新值（StagePane 共用） */
  const previewedDialogue = (d: DialogueLine): DialogueLine => projectDialogue(d, preview)
  const previewedCue = (c: QTECue): QTECue => projectCue(c, preview)
  const previewedBranch = (b: Branch): Branch => projectBranch(b, preview)

  // ── Dialogue 拖拽 ───────────────────────────────────────────────────
  function onDialoguePointerDown(
    e: React.PointerEvent,
    line: DialogueLine,
    handle: 'whole' | 'left' | 'right',
  ): void {
    e.stopPropagation()
    selectDialogue(line.id)
    drag.beginDrag<{ snapshot: DialogueLine }>(e, {
      onStart: () => ({ snapshot: line }),
      onMove: (s, ctx) => {
        const patch = computeDialoguePatch(handle, ctx.snapshot, s.deltaMs, total)
        setPreview({
          kind: 'dialogue',
          id: line.id,
          patch,
          deltaMs: s.deltaMs,
          modifiers: s.modifiers,
        })
      },
      onEnd: (s, ctx) => {
        const patch = computeDialoguePatch(handle, ctx.snapshot, s.deltaMs, total)
        setPreview(null)
        if (Object.keys(patch).length > 0) {
          updateDialogue(scene.id, line.id, patch)
        }
      },
      onCancel: () => setPreview(null),
      snap: snapEnabled,
    })
  }

  // ── QTE Cue 拖拽 ────────────────────────────────────────────────────
  //
  // v3.9.11 · 作者需求：时间轴只能"平移 QTE 位置"，不能"改 QTE 持续时长"。
  //   对应 handle 只保留：
  //     'whole'  —— 整条 pin 拖，appearAt/targetAt 同步平移（间距不变）
  //     'leadIn' —— TRIG band 的 slowMo leadInMs 微调，属于子弹时间带边缘，
  //                 不是 QTE 本体的持续时长，保留（TRIG 带默认还是隐藏的）
  //   被拿掉的是 'target'：之前 pin 上有一小块独立 handle 能只拖 targetAt，
  //   等价于在时间轴上改 "appear→target 间距"，作者认定这就是"改持续时间"。
  //   持续时长（hold）和方向（sweep）统一在右侧 Dock 拖入之前预设。
  function onCuePointerDown(
    e: React.PointerEvent,
    cue: QTECue,
    handle: 'whole' | 'leadIn',
  ): void {
    e.stopPropagation()
    selectCue(cue.id)
    drag.beginDrag<{ snapshot: QTECue }>(e, {
      onStart: () => ({ snapshot: cue }),
      onMove: (s, ctx) => {
        const patch = computeCuePatch(handle, ctx.snapshot, s.deltaMs, total)
        setPreview({
          kind: 'cue',
          id: cue.id,
          patch,
          deltaMs: s.deltaMs,
          modifiers: s.modifiers,
        })
      },
      onEnd: (s, ctx) => {
        const patch = computeCuePatch(handle, ctx.snapshot, s.deltaMs, total)
        setPreview(null)
        if (Object.keys(patch).length > 0) {
          updateQTECue(scene.id, cue.id, patch)
        }
      },
      onCancel: () => setPreview(null),
      snap: snapEnabled,
    })
  }

  // ── 文字叠加 / 搜索段 拖拽（whole/left/right）──────────────────────────
  function spanMovePatch(
    handle: 'whole' | 'left' | 'right',
    snap: { startMs: number; endMs: number },
    deltaMs: number,
  ): { startMs?: number; endMs?: number } {
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
    if (handle === 'left') {
      return { startMs: clamp(snap.startMs + deltaMs, 0, snap.endMs - 100) }
    }
    if (handle === 'right') {
      return { endMs: clamp(snap.endMs + deltaMs, snap.startMs + 100, total) }
    }
    const span = snap.endMs - snap.startMs
    const startMs = clamp(snap.startMs + deltaMs, 0, Math.max(0, total - span))
    return { startMs, endMs: startMs + span }
  }

  function onOverlayPointerDown(
    e: React.PointerEvent,
    clip: TextOverlayClip,
    handle: 'whole' | 'left' | 'right',
  ): void {
    e.stopPropagation()
    setToolbarSel({ kind: 'textOverlay', id: clip.id })
    const snap = { startMs: clip.startMs, endMs: clip.endMs ?? Math.min(total, clip.startMs + 2500) }
    drag.beginDrag<{ snap: typeof snap }>(e, {
      onStart: () => ({ snap }),
      onMove: () => {},
      onEnd: (s, ctx) => {
        const patch = spanMovePatch(handle, ctx.snap, s.deltaMs)
        if (Object.keys(patch).length > 0) updateTextOverlay(scene.id, clip.id, patch)
      },
      onCancel: () => {},
      snap: snapEnabled,
    })
  }

  function onSearchPointerDown(
    e: React.PointerEvent,
    clip: SearchSegmentClip,
    handle: 'whole' | 'left' | 'right',
  ): void {
    e.stopPropagation()
    setToolbarSel({ kind: 'searchSegment', id: clip.id })
    const snap = { startMs: clip.startMs, endMs: clip.endMs }
    drag.beginDrag<{ snap: typeof snap }>(e, {
      onStart: () => ({ snap }),
      onMove: () => {},
      onEnd: (s, ctx) => {
        const patch = spanMovePatch(handle, ctx.snap, s.deltaMs)
        if (Object.keys(patch).length > 0) updateSearchSegment(scene.id, clip.id, patch)
      },
      onCancel: () => {},
      snap: snapEnabled,
    })
  }

  // ── 后期效果 clip 拖拽（filter/adjust/effect/sticker，复用 spanMovePatch）──
  function onFxPointerDown(
    e: React.PointerEvent,
    kind: 'filter' | 'adjust' | 'effect' | 'sticker',
    clip: { id: string; startMs: number; endMs: number },
    handle: 'whole' | 'left' | 'right',
  ): void {
    e.stopPropagation()
    setToolbarSel({ kind, id: clip.id })
    const snap = { startMs: clip.startMs, endMs: clip.endMs }
    drag.beginDrag<{ snap: typeof snap }>(e, {
      onStart: () => ({ snap }),
      onMove: () => {},
      onEnd: (s, ctx) => {
        const patch = spanMovePatch(handle, ctx.snap, s.deltaMs)
        if (Object.keys(patch).length === 0) return
        if (kind === 'filter') updateFilterClip(scene.id, clip.id, patch)
        else if (kind === 'adjust') updateAdjustClip(scene.id, clip.id, patch)
        else if (kind === 'effect') updateEffectClip(scene.id, clip.id, patch)
        else updateStickerClip(scene.id, clip.id, patch)
      },
      onCancel: () => {},
      snap: snapEnabled,
    })
  }

  // ── 右键菜单 ─────────────────────────────────────────────────────────
  /** 给定 client X，反算"轨道相对" ms 和"容器内"局部坐标 */
  function clientToTrackInfo(clientX: number, clientY: number): {
    ms: number
    localX: number
    localY: number
  } | null {
    const el = ref.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const ms = Math.round(ratio * total)
    return {
      ms,
      localX: clientX - rect.left,
      localY: clientY - rect.top,
    }
  }

  function openCtxMenu(
    e: React.MouseEvent,
    pickTarget: (ms: number) => ContextTarget,
  ): void {
    e.preventDefault()
    e.stopPropagation()
    const info = clientToTrackInfo(e.clientX, e.clientY)
    if (!info) return
    setCtxMenu({
      // v3.9.3：用视口坐标 + 菜单 position:fixed，彻底摆脱
      // .ks-timeline-tracks 的 overflow:hidden 裁切。之前传 localX/localY
      // 菜单会被轨道容器 overflow 剪掉下半截。
      x: e.clientX,
      y: e.clientY,
      target: pickTarget(info.ms),
    })
  }

  /**
   * 分镜 clip（图像轨 ShotClip / VIDEO 轨逐镜视频）右键 → 打开统一菜单
   *   「查看生成参数 / 在素材库查看此镜 / 拷贝时间码」。
   * 图像与视频走同一套菜单 —— 作者要求「统一」。
   */
  function onShotContextMenu(e: React.MouseEvent, shot: Shot): void {
    openCtxMenu(e, (ms) => ({
      kind: 'shot',
      ms,
      shot,
      hasVideo: !!shot.videoMediaRef,
    }))
  }
  /** 场景级单条视频右键 → 同款菜单（查看生成参数 / 在素材库查看视频） */
  function onSceneVideoContextMenu(e: React.MouseEvent): void {
    openCtxMenu(e, (ms) => ({ kind: 'video', ms }))
  }

  async function copyTimecode(ms: number): Promise<void> {
    const code = formatTimeCode(ms)
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(code)
      }
    } catch {
      // 复制失败（无权限 / 不安全上下文）→ 静默退化
    }
  }

  // ── Branch pin 拖拽 ─────────────────────────────────────────────────
  function onBranchPointerDown(e: React.PointerEvent, branch: Branch): void {
    e.stopPropagation()
    selectBranch(branch.id)
    drag.beginDrag<{ snapshot: Branch }>(e, {
      onStart: () => ({ snapshot: branch }),
      onMove: (s, ctx) => {
        const patch = moveBranchShowAtPatch(ctx.snapshot, s.deltaMs, total)
        setPreview({
          kind: 'branch',
          id: branch.id,
          patch,
          deltaMs: s.deltaMs,
          modifiers: s.modifiers,
        })
      },
      onEnd: (s, ctx) => {
        const patch = moveBranchShowAtPatch(ctx.snapshot, s.deltaMs, total)
        setPreview(null)
        if (Object.keys(patch).length > 0) {
          updateBranch(scene.id, branch.id, patch)
        }
      },
      onCancel: () => setPreview(null),
      snap: snapEnabled,
    })
  }

  // ── Shot clip 拖拽 ────────────────────────────────────────────────
  /**
   * Shot clip 按 order 均分 total 得到 fallback 时间区间（作者未显式填 startMs/endMs 时）；
   * 显式区间优先，保证拖了一次后从此走显式值。
   */
  function shotSpan(shot: Shot): { startMs: number; endMs: number } {
    const shotsLen = scene.shots?.length || 1
    const idx = shot.order
    const start = shot.startMs ?? Math.round((idx * total) / shotsLen)
    const end = shot.endMs ?? Math.round(((idx + 1) * total) / shotsLen)
    return { startMs: start, endMs: end }
  }

  function onShotPointerDown(
    e: React.PointerEvent,
    shot: Shot,
    handle: 'whole' | 'left' | 'right',
  ): void {
    e.stopPropagation()
    selectShotFromTimeline(shot.id)
    const span0 = shotSpan(shot)
    drag.beginDrag<{ span: { startMs: number; endMs: number } }>(e, {
      onStart: () => ({ span: span0 }),
      onMove: (s, ctx) => {
        const next = computeShotSpan(handle, ctx.span, s.deltaMs, total)
        setShotPreview({ id: shot.id, ...next })
      },
      onEnd: (s, ctx) => {
        const next = computeShotSpan(handle, ctx.span, s.deltaMs, total)
        setShotPreview(null)
        if (next.startMs !== span0.startMs || next.endMs !== span0.endMs) {
          updateShot(scene.id, shot.id, {
            startMs: next.startMs,
            endMs: next.endMs,
          })
        }
      },
      onCancel: () => setShotPreview(null),
      snap: snapEnabled,
    })
  }

  // ── Video trim handle 拖拽 ───────────────────────────────────────
  /**
   * VIDEO 轨 · v3.9 新增。
   *
   * 轨道上只画一段"视频条"，代表裁剪后的有效视频段；左右 handle 分别改：
   *   · 左 handle → videoOffsetMs（视频入点 +）
   *     规则："向右拖 = 入点右移（丢视频头几秒）"，等价 offset 增加
   *           "向左拖 = 入点左移（恢复被丢的头）"，等价 offset 减少
   *     同时 clipDurationMs 等额反向变化，保证"出点时刻不动"。
   *   · 右 handle → videoClipDurationMs（视频长度）
   *     规则："向右拖 = 裁剪段变长（恢复尾部）"
   *           "向左拖 = 裁剪段变短（丢尾）"
   *     offset 保持不动。
   *
   * 时间轴像素坐标：整条视频条始终从 0 画到 sceneMs（100%），拖 handle
   * 不改条本身位置、只改"视频文件里哪一段被用"。
   *
   * 为什么这里不走 TimelineDrag.beginDrag 的 snap：snap 按时间轴网格吸附
   * 会让"视频精确入点"失去 1 帧级精度。保留原始 deltaMs 即可。
   */
  function onVideoTrimPointerDown(
    e: React.PointerEvent,
    handle: 'left' | 'right',
  ): void {
    e.stopPropagation()
    const offset0 = Math.max(0, scene.videoOffsetMs ?? 0)
    const clip0 =
      scene.videoClipDurationMs != null && scene.videoClipDurationMs > 0
        ? scene.videoClipDurationMs
        : scene.durationMs
    // v3.9.1：原视频时长上限，右 handle 拖拽时不得越界
    const naturalMs = scene.videoNaturalDurationMs
    drag.beginDrag<{ offset: number; clip: number }>(e, {
      onStart: () => ({ offset: offset0, clip: clip0 }),
      onMove: (s, ctx) => {
        const next = computeVideoTrim(
          handle,
          ctx.offset,
          ctx.clip,
          s.deltaMs,
          naturalMs,
        )
        setVideoTrimPreview(next)
      },
      onEnd: (s, ctx) => {
        const next = computeVideoTrim(
          handle,
          ctx.offset,
          ctx.clip,
          s.deltaMs,
          naturalMs,
        )
        setVideoTrimPreview(null)
        if (next.offsetMs !== offset0 || next.clipDurationMs !== clip0) {
          updateScene(scene.id, {
            videoOffsetMs: next.offsetMs,
            videoClipDurationMs: next.clipDurationMs,
          })
        }
      },
      onCancel: () => setVideoTrimPreview(null),
      snap: false,
    })
  }

  // ── Audio clip 拖拽 ───────────────────────────────────────────────
  function onAudioPointerDown(
    e: React.PointerEvent,
    clip: AudioClip,
    handle: 'whole' | 'left' | 'right',
  ): void {
    e.stopPropagation()
    selectAudio(clip.id)
    const span0 = { startMs: clip.startMs, endMs: clip.startMs + clip.durationMs }
    drag.beginDrag<{ span: { startMs: number; endMs: number } }>(e, {
      onStart: () => ({ span: span0 }),
      onMove: (s, ctx) => {
        const next = computeShotSpan(handle, ctx.span, s.deltaMs, total)
        setAudioPreview({
          id: clip.id,
          startMs: next.startMs,
          durationMs: next.endMs - next.startMs,
        })
      },
      onEnd: (s, ctx) => {
        const next = computeShotSpan(handle, ctx.span, s.deltaMs, total)
        setAudioPreview(null)
        const dur = next.endMs - next.startMs
        if (next.startMs !== span0.startMs || dur !== clip.durationMs) {
          updateAudioClip(scene.id, clip.id, {
            startMs: next.startMs,
            durationMs: dur,
          })
        }
      },
      onCancel: () => setAudioPreview(null),
      snap: snapEnabled,
    })
  }

  // ── Toolbar actions ───────────────────────────────────────────────
  function tbSplit(): void {
    if (!toolbarSel) return
    // 剪切只对时间段类 clip 有意义；dialogue/cue/branch 没有"在 hoverMs 切两段"的语义。
    if (toolbarSel.kind === 'shot') {
      splitShot(scene.id, toolbarSel.id, hoverMs)
    } else if (toolbarSel.kind === 'audio') {
      splitAudioClip(scene.id, toolbarSel.id, hoverMs)
    }
  }
  function tbDelete(): void {
    if (!toolbarSel) return
    switch (toolbarSel.kind) {
      case 'shot':
        removeShot(scene.id, toolbarSel.id)
        setSelectedShotId(null)
        break
      case 'audio':
        removeAudioClip(scene.id, toolbarSel.id)
        break
      case 'dialogue':
        removeDialogue(scene.id, toolbarSel.id)
        break
      case 'cue':
        removeQTECue(scene.id, toolbarSel.id)
        break
      case 'branch':
        removeBranch(scene.id, toolbarSel.id)
        break
      case 'minigame':
        removeMinigameClip(scene.id, toolbarSel.id)
        break
      case 'textOverlay':
        removeTextOverlay(scene.id, toolbarSel.id)
        break
      case 'searchSegment':
        removeSearchSegment(scene.id, toolbarSel.id)
        break
      case 'filter':
        removeFilterClip(scene.id, toolbarSel.id)
        break
      case 'adjust':
        removeAdjustClip(scene.id, toolbarSel.id)
        break
      case 'effect':
        removeEffectClip(scene.id, toolbarSel.id)
        break
      case 'sticker':
        removeStickerClip(scene.id, toolbarSel.id)
        break
      case 'transition':
        // 转场存在镜上（shot.transitionIn）；删除 = 清掉该镜的入场转场。
        updateShot(scene.id, toolbarSel.id, { transitionIn: undefined })
        break
      case 'video':
        // v3.9.8：把 scene.media 归到 PLACEHOLDER + 清 video trim 字段。
        //   与 clearSceneTimeline 的视频清理逻辑对齐（见 scenarioStore
        //   l.835-840）。只动 media + trim，不动 sceneVideos 历史素材。
        updateScene(scene.id, {
          media: { kind: 'PLACEHOLDER' },
          videoOffsetMs: undefined,
          videoClipDurationMs: undefined,
          videoNaturalDurationMs: undefined,
        })
        break
    }
    setToolbarSel(null)
  }

  /**
   * 一键清空时间轴 —— 不可逆（undo 仍可通过 temporal middleware 回退），
   * 先用原生 confirm 拦一下，避免误点。
   *
   * 清理范围见 scenarioStore.clearSceneTimeline：
   *   dialogue / qte / shots / audio / keyShotId / minigames
   *   + VIDEO 媒体（media.kind='VIDEO' → PLACEHOLDER）
   * 保留：title / IMAGE 系 media / background / characterIds / locationId
   *       / durationMs / pos / branches（剧情树连线）/
   *       sceneImages / sceneVideos（v3.9.4 · 作者历史素材，不再连坐）。
   *
   * 完成后清掉选中 + selectedShotId，避免 toolbar 还指向已删 id。
   */
  function tbClearAll(): void {
    const ok = window.confirm(
      '确认清空当前场景的时间轴？\n\n会删除：字幕 / QTE / 镜头 / 音频 / 小游戏 / 当前视频。\n保留：场景画面、背景描述、角色 / 场景绑定、剧情分支、素材库（图像 & 视频）。\n\n可通过撤销（⌘/Ctrl + Z）恢复。',
    )
    if (!ok) return
    clearSceneTimeline(scene.id)
    setToolbarSel(null)
    setSelectedShotId(null)
  }

  /**
   * v3.2 · 左移 / 右移当前选中 clip。step 由 Toolbar 端按 Shift/Alt 计出。
   *
   * 不同 kind 的"位置"字段不同 —— shot 的 start/end、audio 的 startMs、
   * dialogue 的 start/end、cue 的 target/appear、branch 的 showAt。
   * 每类维护独立的时域边界，防止 clip 被推到 scene 外。
   */
  function tbNudge(dir: -1 | 1, step: number): void {
    if (!toolbarSel) return
    const delta = dir * step
    switch (toolbarSel.kind) {
      case 'shot': {
        const sh = scene.shots?.find((x) => x.id === toolbarSel.id)
        if (!sh) return
        const span = shotSpan(sh)
        const next = moveTo(span, span.startMs + delta, total)
        if (next.startMs === span.startMs) return
        updateShot(scene.id, sh.id, {
          startMs: next.startMs,
          endMs: next.endMs,
        })
        break
      }
      case 'audio': {
        const clip = scene.audio?.find((x) => x.id === toolbarSel.id)
        if (!clip) return
        const span = { startMs: clip.startMs, endMs: clip.startMs + clip.durationMs }
        const next = moveTo(span, span.startMs + delta, total)
        if (next.startMs === clip.startMs) return
        updateAudioClip(scene.id, clip.id, { startMs: next.startMs })
        break
      }
      case 'dialogue': {
        const d = scene.dialogue.find((x) => x.id === toolbarSel.id)
        if (!d) return
        const endMs = d.endMs ?? Math.min(total, d.startMs + 2000)
        const span = { startMs: d.startMs, endMs }
        const next = moveTo(span, span.startMs + delta, total)
        if (next.startMs === d.startMs) return
        updateDialogue(scene.id, d.id, {
          startMs: next.startMs,
          endMs: next.endMs,
        })
        break
      }
      case 'cue': {
        const c = scene.qte?.cues.find((x) => x.id === toolbarSel.id)
        if (!c) return
        const gap = c.targetAt - c.appearAt
        const nextTarget = Math.min(total, Math.max(gap, c.targetAt + delta))
        if (nextTarget === c.targetAt) return
        updateQTECue(scene.id, c.id, {
          targetAt: nextTarget,
          appearAt: nextTarget - gap,
        })
        break
      }
      case 'branch': {
        const b = scene.branches.find((x) => x.id === toolbarSel.id)
        if (!b) return
        const cur = b.showAt ?? 0
        const next = Math.min(total, Math.max(0, cur + delta))
        if (next === cur) return
        updateBranch(scene.id, b.id, { showAt: next })
        break
      }
      case 'textOverlay': {
        const t = scene.textOverlays?.find((x) => x.id === toolbarSel.id)
        if (!t) return
        const endMs = t.endMs ?? Math.min(total, t.startMs + 2500)
        const next = moveTo({ startMs: t.startMs, endMs }, t.startMs + delta, total)
        if (next.startMs === t.startMs) return
        updateTextOverlay(scene.id, t.id, { startMs: next.startMs, endMs: next.endMs })
        break
      }
      case 'searchSegment': {
        const sg = scene.searchSegments?.find((x) => x.id === toolbarSel.id)
        if (!sg) return
        const next = moveTo({ startMs: sg.startMs, endMs: sg.endMs }, sg.startMs + delta, total)
        if (next.startMs === sg.startMs) return
        updateSearchSegment(scene.id, sg.id, { startMs: next.startMs, endMs: next.endMs })
        break
      }
      case 'filter':
      case 'adjust':
      case 'effect':
      case 'sticker': {
        const list =
          toolbarSel.kind === 'filter'
            ? scene.filterClips
            : toolbarSel.kind === 'adjust'
              ? scene.adjustClips
              : toolbarSel.kind === 'effect'
                ? scene.effectClips
                : scene.stickerClips
        const c = list?.find((x) => x.id === toolbarSel.id)
        if (!c) return
        const next = moveTo({ startMs: c.startMs, endMs: c.endMs }, c.startMs + delta, total)
        if (next.startMs === c.startMs) return
        const patch = { startMs: next.startMs, endMs: next.endMs }
        if (toolbarSel.kind === 'filter') updateFilterClip(scene.id, c.id, patch)
        else if (toolbarSel.kind === 'adjust') updateAdjustClip(scene.id, c.id, patch)
        else if (toolbarSel.kind === 'effect') updateEffectClip(scene.id, c.id, patch)
        else updateStickerClip(scene.id, c.id, patch)
        break
      }
      case 'video': {
        // v3.9.8：视频"左移右移"= 挪视频入点（videoOffsetMs）。
        //   裁剪长度不变；约束见 nudgeVideoOffset（offset≥0、offset+clip≤natural）。
        if (scene.media.kind !== 'VIDEO') return
        const cur = scene.videoOffsetMs ?? 0
        const clip = scene.videoClipDurationMs ?? scene.durationMs
        const next = nudgeVideoOffset({
          currentOffsetMs: cur,
          clipDurationMs: clip,
          deltaMs: delta,
          naturalDurationMs: scene.videoNaturalDurationMs,
        })
        if (next === cur) return
        updateScene(scene.id, { videoOffsetMs: next })
        break
      }
    }
  }

  // 把最新的 tbDelete/tbNudge 同步到 ref，键盘 handler 里读 ref 即可拿到最新闭包。
  tbDeleteRef.current = tbDelete
  tbNudgeRef.current = tbNudge

  // ── 拖入外部素材（TimelineDock）────────────────────────────────────
  function onTrackDrop(e: React.DragEvent): void {
    const raw = e.dataTransfer.getData(DOCK_MIME)
    if (!raw) return
    const payload = parseDockPayload(raw)
    if (!payload) return
    e.preventDefault()
    // 统一用"当前时间线位置（hoverMs）"作为落点，而不是 dataTransfer 的 clientX。
    // follow-on 时 hoverMs 自然跟随鼠标；follow-off 时作者先点定位置、再拖入，
    // 落点稳定可控，避免"鼠标漂移到哪就丢到哪"。
    const ms = Math.max(0, Math.min(total, hoverMs))
    switch (payload.kind) {
      case 'dialogue': {
        const dur = payload.defaultDurationMs ?? 2000
        const newId = makeId('d')
        addDialogue(scene.id, {
          id: newId,
          role: payload.role,
          speaker: payload.speaker,
          text: payload.text,
          startMs: ms,
          endMs: Math.min(total, ms + dur),
        })
        // 落地即选中：让右侧 Dock 字幕详情面板立即显示新建 clip 的 speaker/text，
        // 作者拖入后能直接修改文字/署名，避免"再去时间轴上找一下点击"的多余动作。
        setToolbarSel({ kind: 'dialogue', id: newId })
        break
      }
      case 'cue': {
        const base = makeInsertCue({ ms, sceneDurationMs: total })
        addQTECue(scene.id, {
          ...base,
          shape: payload.shape,
          label: payload.label,
          durationMs:
            payload.shape === 'hold' ? payload.holdDurationMs ?? 600 : undefined,
          sweepDir: payload.shape === 'sweep' ? payload.sweepDir ?? 'right' : undefined,
        })
        break
      }
      case 'branch': {
        const base = makeInsertBranch({
          ms,
          sceneDurationMs: total,
          defaultTargetSceneId: payload.targetSceneId,
        })
        addBranch(scene.id, {
          ...base,
          kind: payload.branchKind ?? base.kind,
          label: payload.label ?? base.label,
        })
        break
      }
      case 'audio': {
        const dur = Math.max(200, Math.min(total - ms, payload.durationMs))
        const id = makeId('aud')
        addAudioClip(scene.id, {
          id,
          role: payload.role,
          ref: payload.mediaId,
          startMs: ms,
          durationMs: dur,
          label: payload.label,
          volume: 1,
        })
        selectAudio(id)
        break
      }
      case 'image': {
        // 图像素材拖入时间轴：新建一个 shot，把 keyframeMediaRef 指向该图。
        // 默认 duration 取当前场景剩余空间或 2 秒，插到末尾。
        const DEFAULT_SHOT_MS = 2000
        const dur = Math.max(500, Math.min(total - ms, DEFAULT_SHOT_MS))
        const newId = addShot(scene.id, {
          framing: 'medium',
          prompt: payload.label ?? '拖入图片生成的分镜',
          keyframeMediaRef: payload.mediaId,
          startMs: ms,
          endMs: ms + dur,
        })
        if (newId) selectShotFromTimeline(newId)
        break
      }
      case 'video': {
        /*
         * 视频拖入时间轴（v3.9 · 五轨重构）：
         *
         *   新语义：视频**只占 VIDEO 轨**（scene.media = VIDEO），不在 IMAGE 轨
         *   建 shot。原因：
         *     - 作者原话"先生成图像占位，点击生成视频后在图像上方覆盖"；
         *     - 让 IMAGE 轨只承载 Forge/用户拖入的图像 keyframe；
         *     - VIDEO 轨的裁剪 handle 是视频时长的唯一编辑入口
         *       （避免"SHOT handle 拖短 vs videoClipDurationMs"两套时长互相打架）。
         *
         *   步骤：
         *     1) 同步：setSceneMediaRef(VIDEO) + 用 payload.durationMs 估算场景时长
         *     2) 把 videoOffsetMs/videoClipDurationMs 写成"整段播"（0 → dur）
         *     3) 异步 probe 真时长后再校正 scene.durationMs + videoClipDurationMs
         *
         *   如果以后需要"一个 scene 拼多段视频"，再把这里改成 shot.videoMediaRef。
         */
        const mediaUrl = useMediaStore.getState().entries[payload.mediaId]?.url
        const firstPlan = planVideoDrop({
          startMs: 0,
          requestedMs: payload.durationMs ?? 0,
          sceneDurationMs: total,
        })
        const firstDurMs = firstPlan.endMs - firstPlan.startMs
        if (firstPlan.nextSceneDurationMs !== total) {
          updateScene(scene.id, { durationMs: firstPlan.nextSceneDurationMs })
        }
        setSceneMediaRef(scene.id, { kind: 'VIDEO', ref: payload.mediaId })
        updateScene(scene.id, {
          videoOffsetMs: 0,
          videoClipDurationMs: firstDurMs > 0 ? firstDurMs : undefined,
          videoNaturalDurationMs:
            payload.durationMs && payload.durationMs > 0
              ? payload.durationMs
              : undefined,
        })

        // 异步 probe 真时长 —— 拿不到（或拿到 == payload.durationMs）就不改
        if (mediaUrl) {
          void probeVideoDurationMs(mediaUrl).then((probedMs) => {
            if (probedMs <= 0) return
            if (probedMs === (payload.durationMs ?? 0)) return
            const curSceneDur =
              useScenarioStore.getState().scenario.scenes[scene.id]?.durationMs ??
              firstPlan.nextSceneDurationMs
            const finalPlan = planVideoDrop({
              startMs: 0,
              requestedMs: probedMs,
              sceneDurationMs: curSceneDur,
            })
            const finalDurMs = finalPlan.endMs - finalPlan.startMs
            if (finalPlan.nextSceneDurationMs !== curSceneDur) {
              updateScene(scene.id, {
                durationMs: finalPlan.nextSceneDurationMs,
              })
            }
            updateScene(scene.id, {
              videoClipDurationMs: finalDurMs > 0 ? finalDurMs : undefined,
              videoNaturalDurationMs: probedMs,
            })
          })
        }
        break
      }
      case 'minigame': {
        const clip = makeInsertMinigame({
          ms,
          sceneDurationMs: total,
          minigameId: payload.minigameId,
          defaultDurationMs: payload.defaultDurationMs,
          label: payload.label,
        })
        addMinigameClip(scene.id, clip)
        selectMinigame(clip.id)
        break
      }
      case 'textOverlay': {
        const clip = makeInsertTextOverlay({
          ms,
          sceneDurationMs: total,
          text: payload.text,
          defaultDurationMs: payload.defaultDurationMs,
        })
        addTextOverlay(scene.id, clip)
        setToolbarSel({ kind: 'textOverlay', id: clip.id })
        break
      }
      case 'searchSegment': {
        const clip = makeInsertSearchSegment({
          ms,
          sceneDurationMs: total,
          label: payload.label,
          defaultDurationMs: payload.defaultDurationMs,
        })
        addSearchSegment(scene.id, clip)
        setToolbarSel({ kind: 'searchSegment', id: clip.id })
        break
      }
      case 'filter': {
        const clip = makeInsertFilterClip({
          ms,
          sceneDurationMs: total,
          presetId: payload.presetId,
          defaultDurationMs: payload.defaultDurationMs,
        })
        addFilterClip(scene.id, clip)
        setToolbarSel({ kind: 'filter', id: clip.id })
        break
      }
      case 'adjust': {
        const clip = makeInsertAdjustClip({
          ms,
          sceneDurationMs: total,
          params: payload.params,
          defaultDurationMs: payload.defaultDurationMs,
        })
        addAdjustClip(scene.id, clip)
        setToolbarSel({ kind: 'adjust', id: clip.id })
        break
      }
      case 'effect': {
        const clip = makeInsertEffectClip({
          ms,
          sceneDurationMs: total,
          presetId: payload.presetId,
          defaultDurationMs: payload.defaultDurationMs,
        })
        addEffectClip(scene.id, clip)
        setToolbarSel({ kind: 'effect', id: clip.id })
        break
      }
      case 'sticker': {
        const clip = makeInsertStickerClip({
          ms,
          sceneDurationMs: total,
          stickerKind: payload.stickerKind,
          text: payload.text,
          presetId: payload.presetId,
          mediaId: payload.mediaId,
          defaultDurationMs: payload.defaultDurationMs,
        })
        addStickerClip(scene.id, clip)
        setToolbarSel({ kind: 'sticker', id: clip.id })
        break
      }
    }
  }

  function onTrackDragOver(e: React.DragEvent): void {
    if (e.dataTransfer.types.includes(DOCK_MIME)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  return (
    <div className="ks-timeline">
      <TimelineToolbar
        hoverMs={hoverMs}
        selection={toolbarSel}
        onSplit={tbSplit}
        onCompactShots={() => compactShotsLeft(scene.id)}
        onCompactAudio={() => compactAudioLeft(scene.id)}
        onDelete={tbDelete}
        onClearAll={tbClearAll}
        onNudge={tbNudge}
        snapEnabled={snapEnabled}
        onToggleSnap={toggleSnap}
        followCursor={followCursor}
        onToggleFollow={toggleFollow}
        showDialogue={showDialogue}
        onToggleDialogue={toggleDialogue}
        zoom={zoom}
        onZoomChange={(z) => setZoom(clampZoom(z))}
        onZoomFit={() => setZoom(1)}
        durationSec={Math.round(total / 1000)}
        onDurationSecChange={(sec) =>
          updateScene(scene.id, {
            durationMs: Math.max(1000, Math.round(sec) * 1000),
          })
        }
      />
      <div className="ks-timeline-scroll" ref={scrollRef}>
      <div
        ref={ref}
        className={`ks-timeline-tracks ${preview || shotPreview || audioPreview ? 'is-dragging' : ''}`}
        style={{ width: canvasPx ? `${canvasPx}px` : undefined }}
        onMouseMove={(e) => {
          if (followCursor) track(e.clientX)
        }}
        /*
         * v3.3 · 点击"轨道空白"清空选中 —— 用 pointerdown 而不是 click。
         *
         * 为什么从 click 迁到 pointerdown：
         *   - click 是 mouseup 后的合成事件，pointer capture 会把它的 target
         *     retarget 到捕获元素（trackEl 本身），导致"点 clip 也被当成点空白"。
         *   - pointerdown 发生在 capture 开始之前，event.target 就是真实点到的
         *     DOM 节点，用 closest 判定最稳。
         *
         * 命中白名单（任何 clip / pin / 刻度）→ 不清 selection，交给 clip 自身的
         * onPointerDown（已经 setToolbarSel）。真空白才清。
         *
         * 额外把 hoverMs 也同步到点击位置，保留"点哪里光标跳哪里"的肌肉记忆。
         */
        onPointerDown={(e) => {
          track(e.clientX)
          const t = e.target as HTMLElement | null
          const hitClip = !!t?.closest(
            '.ks-clip, .ks-cue-pin, .ks-branch-pin',
          )
          if (!hitClip) {
            setToolbarSel(null)
            // 空白处按下 → 进入拖拽 scrub，playhead 实时跟手（画面 / 字幕同步刷新）。
            beginScrub(e)
          }
        }}
        onContextMenu={(e) => openCtxMenu(e, (ms) => ({ kind: 'empty', ms }))}
        onDragOver={onTrackDragOver}
        onDrop={onTrackDrop}
      >
        {/* 刻度 —— 缩放后按像素密度自适应（剪映式），位置仍是相对画布宽度的百分比 */}
        <div className="ks-timeline-rule">
          {ruleTicks.map((t, i) => (
            <span
              key={i}
              className="ks-rule-tick ks-mono"
              style={{ left: `${Math.min(100, (t.sec * 1000) / total * 100)}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>

        {/* ── 后期效果轨（画面 / 贴纸）—— 摆在 VIDEO 轨「上方」，对标剪映
           「覆盖层在主视频之上」。仅在有对应 clip 时出现，避免空轨占高度。
           转场不在这里：它直接画在 VIDEO 轨两段视频的衔接处（剪映式）。 ── */}

        {/* FX 轨 —— 画面后期（滤镜 / 调节 / 特效），按 kind 着色 */}
        {((scene.filterClips?.length ?? 0) +
          (scene.adjustClips?.length ?? 0) +
          (scene.effectClips?.length ?? 0)) > 0 && (
          <div className="ks-track ks-track-fx">
            <span className="ks-track-label ks-mono">特效</span>
            {(scene.filterClips ?? []).map((c) => {
              const start = (c.startMs / total) * 100
              const end = (c.endMs / total) * 100
              const isSelected = toolbarSel?.kind === 'filter' && toolbarSel.id === c.id
              const label = getFilterPreset(c.presetId)?.label ?? '滤镜'
              return (
                <div
                  key={c.id}
                  className={`ks-clip ks-clip-fx is-filter ${isSelected ? 'is-selected' : ''}`}
                  style={{ left: `${start}%`, width: `${Math.max(2, end - start)}%` }}
                  title={`滤镜 · ${label}（点击在右侧效果栏调强度/时长）`}
                  onPointerDown={(e) => onFxPointerDown(e, 'filter', c, 'whole')}
                >
                  <span className="ks-clip-handle ks-clip-handle-l" onPointerDown={(e) => onFxPointerDown(e, 'filter', c, 'left')} aria-label="拖左 handle 改开始" />
                  <span className="ks-clip-text">◐ {label}</span>
                  <span className="ks-clip-handle ks-clip-handle-r" onPointerDown={(e) => onFxPointerDown(e, 'filter', c, 'right')} aria-label="拖右 handle 改结束" />
                </div>
              )
            })}
            {(scene.adjustClips ?? []).map((c) => {
              const start = (c.startMs / total) * 100
              const end = (c.endMs / total) * 100
              const isSelected = toolbarSel?.kind === 'adjust' && toolbarSel.id === c.id
              return (
                <div
                  key={c.id}
                  className={`ks-clip ks-clip-fx is-adjust ${isSelected ? 'is-selected' : ''}`}
                  style={{ left: `${start}%`, width: `${Math.max(2, end - start)}%` }}
                  title="画面调节（点击在右侧效果栏调色彩参数）"
                  onPointerDown={(e) => onFxPointerDown(e, 'adjust', c, 'whole')}
                >
                  <span className="ks-clip-handle ks-clip-handle-l" onPointerDown={(e) => onFxPointerDown(e, 'adjust', c, 'left')} aria-label="拖左 handle 改开始" />
                  <span className="ks-clip-text">⚙ 调节</span>
                  <span className="ks-clip-handle ks-clip-handle-r" onPointerDown={(e) => onFxPointerDown(e, 'adjust', c, 'right')} aria-label="拖右 handle 改结束" />
                </div>
              )
            })}
            {(scene.effectClips ?? []).map((c) => {
              const start = (c.startMs / total) * 100
              const end = (c.endMs / total) * 100
              const isSelected = toolbarSel?.kind === 'effect' && toolbarSel.id === c.id
              const label = getEffectPreset(c.presetId)?.label ?? '特效'
              return (
                <div
                  key={c.id}
                  className={`ks-clip ks-clip-fx is-effect ${isSelected ? 'is-selected' : ''}`}
                  style={{ left: `${start}%`, width: `${Math.max(2, end - start)}%` }}
                  title={`特效 · ${label}（点击在右侧效果栏调强度/时长）`}
                  onPointerDown={(e) => onFxPointerDown(e, 'effect', c, 'whole')}
                >
                  <span className="ks-clip-handle ks-clip-handle-l" onPointerDown={(e) => onFxPointerDown(e, 'effect', c, 'left')} aria-label="拖左 handle 改开始" />
                  <span className="ks-clip-text">✦ {label}</span>
                  <span className="ks-clip-handle ks-clip-handle-r" onPointerDown={(e) => onFxPointerDown(e, 'effect', c, 'right')} aria-label="拖右 handle 改结束" />
                </div>
              )
            })}
          </div>
        )}

        {/* STK 轨 —— 贴纸（数值花字 / 图标 / emoji / 图片） */}
        {(scene.stickerClips?.length ?? 0) > 0 && (
          <div className="ks-track ks-track-sticker">
            <span className="ks-track-label ks-mono">贴纸</span>
            {(scene.stickerClips ?? []).map((c) => {
              const start = (c.startMs / total) * 100
              const end = (c.endMs / total) * 100
              const isSelected = toolbarSel?.kind === 'sticker' && toolbarSel.id === c.id
              const glyph =
                c.kind === 'emoji'
                  ? c.text
                  : c.kind === 'builtin'
                    ? getStickerPreset(c.presetId ?? '')?.glyph ?? '★'
                    : c.kind === 'image'
                      ? '🖼'
                      : '✚'
              const label = c.kind === 'numeric' ? c.text || '花字' : getStickerPreset(c.presetId ?? '')?.label ?? '贴纸'
              return (
                <div
                  key={c.id}
                  className={`ks-clip ks-clip-sticker ${isSelected ? 'is-selected' : ''}`}
                  style={{ left: `${start}%`, width: `${Math.max(2, end - start)}%` }}
                  title={`贴纸 · ${label}（点击在右侧效果栏调位置/大小/动画）`}
                  onPointerDown={(e) => onFxPointerDown(e, 'sticker', c, 'whole')}
                >
                  <span className="ks-clip-handle ks-clip-handle-l" onPointerDown={(e) => onFxPointerDown(e, 'sticker', c, 'left')} aria-label="拖左 handle 改开始" />
                  <span className="ks-clip-text">{glyph} {label}</span>
                  <span className="ks-clip-handle ks-clip-handle-r" onPointerDown={(e) => onFxPointerDown(e, 'sticker', c, 'right')} aria-label="拖右 handle 改结束" />
                </div>
              )
            })}
          </div>
        )}

        {/* VIDEO 轨 —— v3.9：始终显示，占一行画一条"裁剪段"条
           · scene.media.kind=VIDEO → 左右 handle 拉 → 改 scene.videoOffsetMs / videoClipDurationMs
           · scene.media.kind=IMAGE 或空 → 显示空占位（"未生成视频"），等着后续点"生成视频"覆盖图像
           视觉上始终在 IMAGE 轨上方，对标剪映的"视频层 > 图像层"。 */}
        <VideoTrimTrack
          scene={scene}
          totalMs={total}
          preview={videoTrimPreview}
          isSelected={toolbarSel?.kind === 'video'}
          onSelect={selectVideo}
          onPointerDown={onVideoTrimPointerDown}
          shotSpanOf={shotSpan}
          selectedShotId={toolbarSel?.kind === 'shot' ? toolbarSel.id : null}
          onSelectShot={selectShotFromTimeline}
          onInspectShot={(shot) => inspectShotRequest(shot, 'video')}
          onInspectSceneVideo={() => inspectMediaRequest(scene.media.ref)}
          onContextMenuShot={onShotContextMenu}
          onContextMenuSceneVideo={onSceneVideoContextMenu}
          selectedTransitionShotId={toolbarSel?.kind === 'transition' ? toolbarSel.id : null}
          onTransitionClick={(shot) => {
            // 无转场 → 加默认闪黑并选中；有 → 仅选中（去右侧效果栏改预设/时长）。
            if (!shot.transitionIn) {
              updateShot(scene.id, shot.id, { transitionIn: { presetId: 'flashBlack', durationMs: 500 } })
            }
            setToolbarSel({ kind: 'transition', id: shot.id })
          }}
        />

        {/* IMAGE 轨 —— v3 镜头带：每段是一个 shot clip，显示关键帧缩略 + framing 标签
           （shot.keyframeMediaRef 是图像，作为占位；视频在上方 VIDEO 轨覆盖） */}
        <ShotTrack
          scene={scene}
          totalMs={total}
          preview={shotPreview}
          selectedShotId={toolbarSel?.kind === 'shot' ? toolbarSel.id : null}
          onSelect={selectShotFromTimeline}
          onPointerDown={onShotPointerDown}
          onInspect={(shot) => inspectShotRequest(shot, 'image')}
          onContextMenuShot={onShotContextMenu}
          spanOf={shotSpan}
        />

        {/* 字幕带 —— v3 只画 dialogue，不含 scene.background
           2026-06-19：默认显示（dialoguePref 默认值改为 true）；时间重叠的台词分行
           堆叠（assignDialogueLanes），不再糊成一团；空文本台词显示占位并可一键清理。 */}
        {showDialogue && (() => {
          const LANE_H = 16
          const LANE_GAP = 2
          const PAD = 4
          const { laneOf, laneCount } = dialogueLanes
          const trackH =
            PAD * 2 + laneCount * LANE_H + Math.max(0, laneCount - 1) * LANE_GAP
          const emptyCount = scene.dialogue.filter(
            (d) => (d.text ?? '').trim() === '',
          ).length
          return (
        <div className="ks-track ks-track-dialogue" style={{ height: trackH }}>
          <span className="ks-track-label ks-mono">DIA</span>
          {emptyCount > 0 && (
            <button
              type="button"
              className="ks-dia-clean-btn"
              title={`清理 ${emptyCount} 条空台词（无文本的残留 clip）`}
              onClick={() => removeEmptyDialogue(scene.id)}
            >
              清理空台词 ✕{emptyCount}
            </button>
          )}
          {scene.dialogue.map((rawD) => {
            const d = previewedDialogue(rawD)
            const start = (d.startMs / total) * 100
            const end =
              ((d.endMs ?? Math.min(total, d.startMs + 2000)) / total) * 100
            const isPreviewing = preview?.kind === 'dialogue' && preview.id === d.id
            const isSelected =
              toolbarSel?.kind === 'dialogue' && toolbarSel.id === d.id
            const isEmpty = (rawD.text ?? '').trim() === ''
            const lane = laneOf[rawD.id] ?? 0
            return (
              <div
                key={d.id}
                className={`ks-clip ks-clip-dialogue role-${d.role} ${isPreviewing ? 'is-dragging' : ''} ${isSelected ? 'is-selected' : ''} ${isEmpty ? 'is-empty-dialogue' : ''}`}
                style={{
                  left: `${start}%`,
                  width: `${Math.max(2, end - start)}%`,
                  top: PAD + lane * (LANE_H + LANE_GAP),
                  height: LANE_H,
                  bottom: 'auto',
                }}
                title={
                  isEmpty
                    ? '空台词（无文本）· 右键可删除，或点轨道上的「清理空台词」'
                    : `${d.speaker ?? d.role} · ${d.text}（点击选中后在右侧字幕面板修改）`
                }
                onPointerDown={(e) => onDialoguePointerDown(e, rawD, 'whole')}
                onContextMenu={(e) =>
                  openCtxMenu(e, (ms) => ({ kind: 'dialogue', ms, line: rawD }))
                }
              >
                <span
                  className="ks-clip-handle ks-clip-handle-l"
                  onPointerDown={(e) => onDialoguePointerDown(e, rawD, 'left')}
                  aria-label="拖左 handle 改 startMs"
                />
                <span className="ks-clip-text">
                  {isEmpty ? '（空台词）' : d.text}
                </span>
                <span
                  className="ks-clip-handle ks-clip-handle-r"
                  onPointerDown={(e) => onDialoguePointerDown(e, rawD, 'right')}
                  aria-label="拖右 handle 改 endMs"
                />
              </div>
            )
          })}
        </div>
          )
        })()}

        {/* QTE 带 */}
        <div className="ks-track ks-track-qte">
          <span className="ks-track-label ks-mono">QTE</span>
          {scene.qte?.cues.map((rawC) => {
            const c = previewedCue(rawC)
            const isPreviewing = preview?.kind === 'cue' && preview.id === c.id
            const isSelected =
              toolbarSel?.kind === 'cue' && toolbarSel.id === c.id
            return (
              <div
                key={c.id}
                className={`ks-cue-pin shape-${c.shape} ${isPreviewing ? 'is-dragging' : ''} ${isSelected ? 'is-selected' : ''}`}
                style={{ left: `${(c.targetAt / total) * 100}%` }}
                title={`${c.shape} · target ${c.targetAt}ms · appear ${c.appearAt}ms · 持续时长/方向在 Dock 里预设，时间轴只负责移动位置`}
                onPointerDown={(e) => onCuePointerDown(e, rawC, 'whole')}
                onContextMenu={(e) =>
                  openCtxMenu(e, (ms) => ({ kind: 'cue', ms, cue: rawC }))
                }
              >
                <span className="ks-cue-pin-bar" />
                {/*
                 * v3.9.11：作者反馈"时间轴不应能编辑 QTE 的持续时长 / 方向，
                 *   这些应该在右侧 Dock 拖入前就定好"。
                 *   所以拿掉了原来挂在 pin 上的"单独拖 target"手柄
                 *   （它唯一的作用就是在时间轴上改 appear→target 间距，
                 *   也就是事实上的"持续时间"）。整条 pin 的 'whole' 拖动
                 *   保留——那是纯位置平移，appearAt/targetAt 同步、间距不变，
                 *   不属于"改持续时间"。
                 *   方向（sweepDir）原本就没时间轴入口，依旧在 Dock 里选。
                 */}
                <span className="ks-cue-pin-tag ks-mono">
                  {c.label ?? c.shape}
                </span>
              </div>
            )
          })}
        </div>

        {/* TXT 轨 —— 富文本文字叠加（剪映/PR 式贴字） */}
        {(scene.textOverlays?.length ?? 0) > 0 && (
          <div className="ks-track ks-track-text">
            <span className="ks-track-label ks-mono">TXT</span>
            {(scene.textOverlays ?? []).map((t) => {
              const endMs = t.endMs ?? Math.min(total, t.startMs + 2500)
              const start = (t.startMs / total) * 100
              const end = (endMs / total) * 100
              const isSelected = toolbarSel?.kind === 'textOverlay' && toolbarSel.id === t.id
              return (
                <div
                  key={t.id}
                  className={`ks-clip ks-clip-text ${isSelected ? 'is-selected' : ''}`}
                  style={{ left: `${start}%`, width: `${Math.max(2, end - start)}%` }}
                  title={`${t.text}（点击选中后在右侧「文字」面板编辑字体/字号/旋转等）`}
                  onPointerDown={(e) => onOverlayPointerDown(e, t, 'whole')}
                >
                  <span
                    className="ks-clip-handle ks-clip-handle-l"
                    onPointerDown={(e) => onOverlayPointerDown(e, t, 'left')}
                    aria-label="拖左 handle 改出现时刻"
                  />
                  <span className="ks-clip-text">字 {t.text}</span>
                  <span
                    className="ks-clip-handle ks-clip-handle-r"
                    onPointerDown={(e) => onOverlayPointerDown(e, t, 'right')}
                    aria-label="拖右 handle 改消失时刻"
                  />
                </div>
              )
            })}
          </div>
        )}

        {/* SEARCH 轨 —— 道具搜索段（视频定格循环 + 放大镜搜寻） */}
        {(scene.searchSegments?.length ?? 0) > 0 && (
          <div className="ks-track ks-track-search">
            <span className="ks-track-label ks-mono">SRCH</span>
            {(scene.searchSegments ?? []).map((sg) => {
              const start = (sg.startMs / total) * 100
              const end = (sg.endMs / total) * 100
              const isSelected = toolbarSel?.kind === 'searchSegment' && toolbarSel.id === sg.id
              return (
                <div
                  key={sg.id}
                  className={`ks-clip ks-clip-search ${isSelected ? 'is-selected' : ''}`}
                  style={{ left: `${start}%`, width: `${Math.max(2, end - start)}%` }}
                  title={`搜索段${sg.label ? ' · ' + sg.label : ''}（视频在此段定格循环，玩家搜寻拾取）`}
                  onPointerDown={(e) => onSearchPointerDown(e, sg, 'whole')}
                >
                  <span
                    className="ks-clip-handle ks-clip-handle-l"
                    onPointerDown={(e) => onSearchPointerDown(e, sg, 'left')}
                    aria-label="拖左 handle 改段开始"
                  />
                  <span className="ks-clip-text">🔍 {sg.label || '搜索段'}</span>
                  <span
                    className="ks-clip-handle ks-clip-handle-r"
                    onPointerDown={(e) => onSearchPointerDown(e, sg, 'right')}
                    aria-label="拖右 handle 改段结束"
                  />
                </div>
              )
            })}
          </div>
        )}

        {/* 触发轨 · 子弹时间区间（v3.9：按五轨极简需求默认隐藏） */}
        {VISIBLE_TRACKS.trig && (
          <div className="ks-track ks-track-trig">
          <span className="ks-track-label ks-mono">TRIG</span>
          {scene.qte?.cues
            .map(previewedCue)
            .filter((c) => c.slowMo && c.slowMo.rate < 1)
            .map((c) => {
              const goodMs = scene.qte?.window.good ?? 280
              const leadIn = c.slowMo!.leadInMs ?? 0
              const start = Math.max(0, c.appearAt - leadIn)
              const end = Math.min(total, c.targetAt + goodMs)
              const startPct = (start / total) * 100
              const widthPct = Math.max(0.6, ((end - start) / total) * 100)
              const requireHit = c.slowMo!.requireHit !== false
              return (
                <div
                  key={c.id}
                  className={`ks-trig-band ${requireHit ? 'is-hard' : 'is-soft'}`}
                  style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                  title={
                    `slowMo · rate ${c.slowMo!.rate}× · ` +
                    `enter ${start}ms · fail ${end}ms` +
                    (requireHit ? ' · 必命中' : ' · 氛围')
                  }
                >
                  <span
                    className="ks-trig-edge ks-trig-edge-l"
                    onPointerDown={(e) => onCuePointerDown(e, c, 'leadIn')}
                    aria-label="拖左缘改 leadInMs"
                  />
                  <span className="ks-trig-edge ks-trig-edge-r" />
                  <span className="ks-trig-fail" aria-hidden>
                    ×
                  </span>
                  <span className="ks-trig-rate ks-mono">
                    {c.slowMo!.rate.toFixed(2)}×
                  </span>
                </div>
              )
            })}
        </div>
        )}

        {/* AUDIO 轨 —— BGM / SFX / VO 三色。每条 clip 可拖、可剪切、可左对齐 */}
        <AudioTrack
          scene={scene}
          totalMs={total}
          preview={audioPreview}
          selectedClipId={toolbarSel?.kind === 'audio' ? toolbarSel.id : null}
          onSelect={selectAudio}
          onPointerDown={onAudioPointerDown}
        />

        {/* MINIGAME 轨 —— 每个 clip 表示一次"到点暂停、弹出 iframe 小游戏"
           v3.9：按五轨极简需求默认隐藏（数据层仍在，flag 打开即恢复编辑） */}
        {VISIBLE_TRACKS.game && (
          <div className="ks-track ks-track-minigame">
            <span className="ks-track-label ks-mono">GAME</span>
            {(scene.minigames ?? []).map((mg) => {
              const left = (mg.startMs / total) * 100
              const width = Math.max(
                2,
                ((Math.min(mg.durationMs, total - mg.startMs)) / total) * 100,
              )
              const isSelected =
                toolbarSel?.kind === 'minigame' && toolbarSel.id === mg.id
              return (
                <div
                  key={mg.id}
                  className={`ks-minigame-block ${isSelected ? 'is-selected' : ''}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                  title={`小游戏 · ${mg.label ?? mg.minigameId}（${Math.round(mg.startMs)}ms）`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    selectMinigame(mg.id)
                  }}
                >
                  <span className="ks-minigame-block-icon" aria-hidden>▶</span>
                  <span className="ks-minigame-block-label">
                    {mg.label || mg.minigameId}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* 分支带（v3.9：按五轨极简需求默认隐藏） */}
        {VISIBLE_TRACKS.branch && (
          <div className="ks-track ks-track-branch">
            <span className="ks-track-label ks-mono">BR</span>
            {scene.branches
              .filter((b) => b.kind === 'choice')
              .map((rawB) => {
                const b = previewedBranch(rawB)
                const isPreviewing = preview?.kind === 'branch' && preview.id === b.id
                const isSelected =
                  toolbarSel?.kind === 'branch' && toolbarSel.id === b.id
                return (
                  <div
                    key={b.id}
                    className={`ks-branch-pin ${isPreviewing ? 'is-dragging' : ''} ${isSelected ? 'is-selected' : ''}`}
                    style={{
                      left: `${((b.showAt ?? total) / total) * 100}%`,
                    }}
                    title={`${b.label ?? b.kind} → ${b.targetSceneId}`}
                    onPointerDown={(e) => onBranchPointerDown(e, rawB)}
                    onContextMenu={(e) =>
                      openCtxMenu(e, (ms) => ({ kind: 'branch', ms, branch: rawB }))
                    }
                  >
                    <span className="ks-branch-pin-tag ks-mono">
                      ↗ {b.label ?? b.targetSceneId}
                    </span>
                  </div>
                )
              })}
          </div>
        )}

        {/* 游标 */}
        <div
          className="ks-cursor"
          style={{ left: `${(hoverMs / total) * 100}%` }}
        />

        {/* 拖拽吸附辅助线（drag 中才显示，落点在 keyTimeMs 处） */}
        {preview && <SnapGuide preview={preview} totalMs={total} />}

        {/* 拖拽时间码浮提 */}
        {preview && <DragHud preview={preview} totalMs={total} />}

        {/* 右键菜单 —— floating popover，绝对定位在容器局部坐标 */}
        {ctxMenu && (
          <TimelineContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            target={ctxMenu.target}
            onClose={() => setCtxMenu(null)}
            onInsertDialogue={(ms) =>
              addDialogue(
                scene.id,
                makeInsertDialogue({ ms, sceneDurationMs: total }),
              )
            }
            onInsertCue={(ms) =>
              addQTECue(
                scene.id,
                makeInsertCue({ ms, sceneDurationMs: total }),
              )
            }
            onInsertBranch={(ms) =>
              addBranch(
                scene.id,
                makeInsertBranch({
                  ms,
                  sceneDurationMs: total,
                  defaultTargetSceneId: rootSceneId,
                }),
              )
            }
            onDuplicateDialogue={(line, offset) =>
              addDialogue(scene.id, duplicateDialogue(line, offset, total))
            }
            onRemoveDialogue={(id) => removeDialogue(scene.id, id)}
            onRemoveCue={(id) => removeQTECue(scene.id, id)}
            onRemoveBranch={(id) => removeBranch(scene.id, id)}
            onCopyTimecode={copyTimecode}
            onInspectShot={inspectShotRequest}
            onOpenShotInAssets={openShotInAssets}
            onInspectSceneVideo={() => inspectMediaRequest(scene.media.ref)}
            onOpenSceneVideoInAssets={openSceneVideoInAssets}
          />
        )}
      </div>
      </div>

      {/* 视频片段「生成请求详情」弹窗 —— 双击/右键 VIDEO 轨视频片段时打开 */}
      {inspectJob && (
        <GenRequestDialog job={inspectJob} onClose={() => setInspectJob(null)} />
      )}
    </div>
  )
}

/** 把 dialogue handle 类型分发到对应 patch 函数 */
function computeDialoguePatch(
  handle: 'whole' | 'left' | 'right',
  snapshot: DialogueLine,
  deltaMs: number,
  totalMs: number,
): Partial<DialogueLine> {
  switch (handle) {
    case 'whole':
      return moveDialoguePatch(snapshot, deltaMs, totalMs)
    case 'left':
      return resizeDialogueLeftPatch(snapshot, deltaMs, totalMs)
    case 'right':
      return resizeDialogueRightPatch(snapshot, deltaMs, totalMs)
  }
}

/** DIA 轨多行布局：台词缺省可见宽度（与 endMs 缺省时的占用区间口径一致）。 */
const DIA_FALLBACK_WIDTH_MS = 2000

/**
 * 把一组台词按时间重叠关系分配到「行」（贪心区间分行 / interval partitioning）。
 *
 * 同一时刻最多有 k 条台词重叠时，就需要 k 行。每条台词放进「上一段已经结束」的
 * 第一行；没有可用行就新开一行。返回 id→行号 映射与总行数，供渲染算 top/height。
 *
 * 排序键用 startMs（稳定）；endMs 缺省按 DIA_FALLBACK_WIDTH_MS 估算，和时间轴
 * 渲染、addDialogue 避让的口径保持一致。
 */
function assignDialogueLanes(lines: readonly DialogueLine[]): {
  laneOf: Record<string, number>
  laneCount: number
} {
  const sorted = [...lines].sort((a, b) => a.startMs - b.startMs)
  const laneEnds: number[] = []
  const laneOf: Record<string, number> = {}
  for (const d of sorted) {
    const start = d.startMs
    const end = d.endMs ?? d.startMs + DIA_FALLBACK_WIDTH_MS
    let lane = laneEnds.findIndex((e) => e <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }
    laneOf[d.id] = lane
  }
  return { laneOf, laneCount: Math.max(1, laneEnds.length) }
}

function computeCuePatch(
  handle: 'whole' | 'leadIn',
  snapshot: QTECue,
  deltaMs: number,
  totalMs: number,
): Partial<QTECue> {
  switch (handle) {
    case 'whole':
      return moveCuePatch(snapshot, deltaMs, totalMs)
    case 'leadIn':
      return resizeTrigBandLeadInPatch(snapshot, deltaMs)
  }
}

/**
 * Shot / Audio clip 的统一拖拽位移算子 —— 按 handle 类别分别 move / resize。
 *
 * 复用 editOps.moveTo：move-whole 保持 duration 平移；resize-left/right 只改一端，
 * 且夹进 [0, totalMs] 并保证 endMs > startMs + 1。
 */
function computeShotSpan(
  handle: 'whole' | 'left' | 'right',
  span: { startMs: number; endMs: number },
  deltaMs: number,
  totalMs: number,
): { startMs: number; endMs: number } {
  if (handle === 'whole') {
    const moved = moveTo(
      { startMs: span.startMs, endMs: span.endMs },
      span.startMs + deltaMs,
      totalMs,
    )
    return { startMs: moved.startMs, endMs: moved.endMs }
  }
  if (handle === 'left') {
    const nextStart = Math.max(0, Math.min(span.endMs - 100, span.startMs + deltaMs))
    return { startMs: nextStart, endMs: span.endMs }
  }
  const nextEnd = Math.min(totalMs, Math.max(span.startMs + 100, span.endMs + deltaMs))
  return { startMs: span.startMs, endMs: nextEnd }
}

/**
 * VIDEO 裁剪拖拽 —— 纯函数（v3.9）定义在 ./timeline/computeVideoTrim.ts。
 * 不在这里重新 re-export，避免 React Fast Refresh 对"组件 + 非组件"
 * 混 export 报 "incompatible export" 警告。
 */

let _idSeq = 0
function makeId(prefix: string): string {
  _idSeq++
  return `${prefix}_${Date.now().toString(36)}_${_idSeq}`
}

/**
 * 拖拽时浮在轨道顶部的时间码徽章 ——
 *   - 显示绝对时间码（如有 keyTimeMs）+ 相对增量
 *   - 显示当前吸附粒度（受修饰键影响）
 *
 *   ┌─────────────────────────────────┐
 *   │ DIALOGUE · 1.500s   +250ms       │
 *   │ snap 100ms                       │
 *   └─────────────────────────────────┘
 */

/**
 * DragHud —— 拖拽时的浮动 HUD，显示当前 clip 类型 / 时间码 / Δ。
 */
function DragHud({
  preview,
}: {
  preview: {
    kind: 'dialogue' | 'cue' | 'branch'
    deltaMs: number
    patch: Partial<DialogueLine> | Partial<QTECue> | Partial<Branch>
    modifiers: SnapModifiers
  }
  totalMs: number
}): JSX.Element {
  const keyMs = previewKeyTimeMs(preview)
  const labelMap: Record<typeof preview.kind, string> = {
    dialogue: 'DIALOGUE',
    cue: 'QTE',
    branch: 'BRANCH',
  }
  return (
    <div className="ks-tl-hud ks-mono">
      <span className="ks-tl-hud-kind">{labelMap[preview.kind]}</span>
      {keyMs != null && (
        <>
          <span className="ks-tl-hud-sep">·</span>
          <span className="ks-tl-hud-time">{formatTimeCode(keyMs)}</span>
        </>
      )}
      <span className="ks-tl-hud-sep">·</span>
      <span className="ks-tl-hud-delta">{formatDelta(preview.deltaMs)}</span>
      <span className="ks-tl-hud-snap">{describeSnapGrid(preview.modifiers)}</span>
    </div>
  )
}

/**
 * 拖拽吸附辅助线 —— 在落点位置画一条竖线，
 * 让作者直观看到"被吸到的网格上"。
 *
 * 仅当能解出 keyTimeMs 时显示（leadIn 拖动等场景没有"落点"，跳过）。
 */
function SnapGuide({
  preview,
  totalMs,
}: {
  preview: {
    kind: 'dialogue' | 'cue' | 'branch'
    patch: Partial<DialogueLine> | Partial<QTECue> | Partial<Branch>
  }
  totalMs: number
}): JSX.Element | null {
  const keyMs = previewKeyTimeMs(preview)
  if (keyMs == null) return null
  const left = totalMs > 0 ? (keyMs / totalMs) * 100 : 0
  return (
    <div className="ks-tl-snap-guide" style={{ left: `${left}%` }} aria-hidden />
  )
}

// ─────────────────────────────────────────────────────────────────────
// VIDEO 轨 · v3.9
//
// scene.media.kind === 'VIDEO' 时显示。整条轨道是一个"视频裁剪条"：
//   - 条按画布坐标（canvasMs，起步 50s）定位：clip 段 = clipMs / canvasMs 宽，
//     所以一段 6s 视频在 50s 画布里只占 ~12% 宽，时间轴不被压成视频长度
//   - 左 handle 拖 → 改 videoOffsetMs（视频文件入点）
//   - 右 handle 拖 → 改 videoClipDurationMs（裁剪段长度）
//   - 中间显示 [offset → offset+clip] 文本 + 视频 thumb（poster）
//
// 坐标系：用户的时间轴坐标始终 0..canvasMs，拉 handle 改的是"从视频文件哪一段
// 取素材 / 这段在时间轴上占多长"，与播放（player 按视频真实时长 onEnded 跳转）解耦。
// ─────────────────────────────────────────────────────────────────────

function VideoTrimTrack({
  scene,
  totalMs,
  preview,
  isSelected,
  onSelect,
  onPointerDown,
  shotSpanOf,
  selectedShotId,
  onSelectShot,
  onInspectShot,
  onInspectSceneVideo,
  onContextMenuShot,
  onContextMenuSceneVideo,
  selectedTransitionShotId,
  onTransitionClick,
}: {
  scene: Scene
  totalMs: number
  preview: { offsetMs: number; clipDurationMs: number } | null
  isSelected: boolean
  onSelect: () => void
  onPointerDown: (e: React.PointerEvent, handle: 'left' | 'right') => void
  shotSpanOf: (shot: Shot) => { startMs: number; endMs: number }
  selectedShotId: string | null
  onSelectShot: (shotId: string) => void
  onInspectShot: (shot: Shot) => void
  onInspectSceneVideo: () => void
  onContextMenuShot: (e: React.MouseEvent, shot: Shot) => void
  onContextMenuSceneVideo: (e: React.MouseEvent) => void
  /** 当前选中的「转场」所属镜 id（toolbarSel.kind==='transition' 时） */
  selectedTransitionShotId: string | null
  /** 点击两段视频之间的转场徽标：无转场则加默认闪黑并选中，有则仅选中 */
  onTransitionClick: (shot: Shot) => void
}) {
  const entries = useMediaStore((s) => s.entries)
  const entry = scene.media.ref ? entries[scene.media.ref] : undefined
  // v3.9 五轨重构：VIDEO 轨始终显示，但仅在 scene.media.kind='VIDEO' 时
  // 才是真正的"视频裁剪条"；否则当作空占位，提示用户"未生成视频，待点击
  // 生成按钮后在此轨上覆盖图像"。
  const hasVideo = scene.media.kind === 'VIDEO' && !!entry?.url
  const offsetMs = preview?.offsetMs ?? scene.videoOffsetMs ?? 0
  const clipMs =
    preview?.clipDurationMs ??
    scene.videoClipDurationMs ??
    scene.durationMs

  if (!hasVideo) {
    // v6.x 修复（作者反馈「生成的视频跑到图像轴了」）：逐镜生成的视频写在
    // shot.videoMediaRef（多段拼一个 scene 的情况），过去没接到 VIDEO 轨 ——
    // 这里按镜窗把每段生成视频铺到 VIDEO 轨上，与下方 IMAGE 轨的关键帧时间对齐。
    // 双击 / 右键任一段 → 打开该镜视频的生成请求详情（提示词 / 参考素材 / 参数）。
    const shotVideos = (scene.shots ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .filter((s) => s.videoMediaRef && entries[s.videoMediaRef]?.url)

    if (shotVideos.length > 0) {
      return (
        <div className="ks-track ks-track-video">
          <span className="ks-track-label ks-mono">VIDEO</span>
          {shotVideos.map((shot, i) => {
            const span = shotSpanOf(shot)
            const leftPct = (span.startMs / totalMs) * 100
            const widthPct = Math.max(1.5, ((span.endMs - span.startMs) / totalMs) * 100)
            const url = entries[shot.videoMediaRef!]!.url
            const sel = shot.id === selectedShotId
            // 剪映式转场徽标：画在「上一段视频 → 本段」的衔接处（本段左边缘），
            // 直接坐落在 VIDEO 轨上，把两段视频「重链接」起来。仅 i≥1 有衔接点。
            const tr = shot.transitionIn
            const trSel = shot.id === selectedTransitionShotId
            const trLabel = tr ? getTransitionPreset(tr.presetId)?.label ?? '转场' : ''
            return (
              <Fragment key={shot.id}>
                <div
                  className={`ks-clip ks-video-clip ks-shot-video-clip ${sel ? 'is-selected' : ''}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  title={`镜${shot.order + 1} 视频 · 双击 / 右键查看生成参数（提示词 / 参考素材）`}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    onSelectShot(shot.id)
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    onInspectShot(shot)
                  }}
                  onContextMenu={(e) => onContextMenuShot(e, shot)}
                >
                  <video
                    className="ks-video-clip-thumb"
                    src={url}
                    muted
                    playsInline
                    preload="metadata"
                    aria-hidden
                  />
                  <span className="ks-shot-video-tag">
                    {String(shot.order + 1).padStart(2, '0')}
                    <span className="ks-shot-video-tag-play" aria-hidden>▶</span>
                  </span>
                </div>
                {i >= 1 && (
                  <button
                    type="button"
                    className={`ks-trans-badge ${tr ? 'has-trans' : ''} ${trSel ? 'is-selected' : ''}`}
                    style={{ left: `${leftPct}%` }}
                    title={tr ? `转场 · ${trLabel}（点击编辑，Del 删除）` : '点击在两段视频间加转场（闪黑等）'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      onTransitionClick(shot)
                    }}
                  >
                    {tr ? '⇄' : '+'}
                  </button>
                )}
              </Fragment>
            )
          })}
        </div>
      )
    }

    return (
      <div className="ks-track ks-track-video is-empty">
        <span className="ks-track-label ks-mono">VIDEO</span>
        <span className="ks-track-empty-hint ks-mono">
          · 尚未生成视频 · 生成后将铺到本轨（与下方图像对齐）·
        </span>
      </div>
    )
  }

  // v3.9.1：bar 按"画布时间轴坐标"（canvasMs，与 ShotClip/刻度尺同基准）定位。
  //   · left  = offset / canvasMs · 100%
  //   · width = clip   / canvasMs · 100%
  // 用 canvasMs（≥50s）而非 scene.durationMs，保证 6s 视频在 50s 画布里只占一小段，
  // 时间轴不被压缩；拖 handle 时位置/宽度仍正确反映在画布上。
  const sceneDur = Math.max(1, totalMs)
  const leftPct = Math.max(0, Math.min(100, (offsetMs / sceneDur) * 100))
  const widthPct = Math.max(
    2,
    Math.min(100 - leftPct, (clipMs / sceneDur) * 100),
  )
  const stopAndBegin = (
    e: React.PointerEvent,
    handle: 'left' | 'right',
  ): void => {
    // 关键：handle 的 pointerdown 必须 stopPropagation，否则父层的
    // `track(e.clientX)`（改 hoverMs + setToolbarSel(null)）会抢走焦点。
    e.stopPropagation()
    onPointerDown(e, handle)
  }
  return (
    <div
      className={`ks-track ks-track-video ${preview ? 'is-dragging' : ''}`}
    >
      <span className="ks-track-label ks-mono">VIDEO</span>
      <div
        className={`ks-clip ks-video-clip ${isSelected ? 'is-selected' : ''}`}
        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        title={`IN ${(offsetMs / 1000).toFixed(2)}s · CLIP ${(clipMs / 1000).toFixed(
          2,
        )}s`}
        /*
         * v3.9.8 · 作者反馈"视频单击就跳时间线，而且工具栏永远灰"——
         *   根因：clip 本体没 pointerdown，点中直接冒泡到外层 track，
         *   track 的 pointerdown 会 `track(e.clientX)`（跳 playhead）+
         *   `setToolbarSel(null)`（清选中）。
         *   修复：clip 自己 stopPropagation + 调 onSelect 写 toolbarSel，
         *   跟 ShotClip 的选中语义完全对齐。
         *   视频裁剪 handle 的 stopPropagation 保持不变 —— 拖 handle 不触发
         *   "选中 video"，因为拖本身是"编辑"，而"编辑中"语义比"选中"更强。
         */
        onPointerDown={(e) => {
          e.stopPropagation()
          onSelect()
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onInspectSceneVideo()
        }}
        onContextMenu={onContextMenuSceneVideo}
      >
        {/* 首帧预览：pointer-events:none 让拖拽穿透到外层 clip */}
        <video
          className="ks-video-clip-thumb"
          src={entry!.url}
          muted
          playsInline
          preload="metadata"
          aria-hidden
        />
        <span
          className="ks-clip-handle ks-clip-handle-l"
          onPointerDown={(e) => stopAndBegin(e, 'left')}
          aria-label="拖左改视频入点（offsetMs）"
        />
        <span className="ks-video-clip-label ks-mono" aria-hidden>
          {(offsetMs / 1000).toFixed(2)}s → {((offsetMs + clipMs) / 1000).toFixed(2)}s
        </span>
        <span
          className="ks-clip-handle ks-clip-handle-r"
          onPointerDown={(e) => stopAndBegin(e, 'right')}
          aria-label="拖右改视频裁剪时长（clipDurationMs）"
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// SHOT 轨 · v3.1
//
// 每个 shot 渲染一个 .ks-shot-clip：缩略图背景 + framing 小徽章 + 左右 resize
// handle。选中高亮走 is-selected；key shot 额外挂一颗 ★。
// ─────────────────────────────────────────────────────────────────────

function ShotTrack({
  scene,
  totalMs,
  preview,
  selectedShotId,
  onSelect,
  onPointerDown,
  onInspect,
  onContextMenuShot,
  spanOf,
}: {
  scene: Scene
  totalMs: number
  preview: { id: string; startMs: number; endMs: number } | null
  selectedShotId: string | null
  onSelect: (shotId: string) => void
  onPointerDown: (
    e: React.PointerEvent,
    shot: Shot,
    handle: 'whole' | 'left' | 'right',
  ) => void
  onInspect: (shot: Shot) => void
  onContextMenuShot: (e: React.MouseEvent, shot: Shot) => void
  spanOf: (shot: Shot) => { startMs: number; endMs: number }
}) {
  const shots = useMemo(
    () => (scene.shots ?? []).slice().sort((a, b) => a.order - b.order),
    [scene.shots],
  )
  const keyShotId = scene.keyShotId ?? shots[0]?.id

  if (shots.length === 0) {
    return (
      <div className="ks-track ks-track-shot is-empty">
        <span className="ks-track-label ks-mono">IMAGE</span>
        <span className="ks-track-empty-hint ks-mono">
          · 尚未分镜 · 在 Forge 拆剧本时自动生成 ·
        </span>
      </div>
    )
  }

  return (
    <div className="ks-track ks-track-shot">
      <span className="ks-track-label ks-mono">IMAGE</span>
      {shots.map((shot) => {
        const isPreviewing = preview?.id === shot.id
        const base = spanOf(shot)
        const span = isPreviewing ? { startMs: preview!.startMs, endMs: preview!.endMs } : base
        const leftPct = (span.startMs / totalMs) * 100
        const widthPct = Math.max(1.5, ((span.endMs - span.startMs) / totalMs) * 100)
        const isKey = shot.id === keyShotId
        const isSelected = shot.id === selectedShotId
        return (
          <ShotClip
            key={shot.id}
            shot={shot}
            leftPct={leftPct}
            widthPct={widthPct}
            isKey={isKey}
            isSelected={isSelected}
            isPreviewing={isPreviewing}
            onSelect={() => onSelect(shot.id)}
            onPointerDown={onPointerDown}
            onInspect={() => onInspect(shot)}
            onContextMenuShot={(e) => onContextMenuShot(e, shot)}
          />
        )
      })}
    </div>
  )
}

function ShotClip({
  shot,
  leftPct,
  widthPct,
  isKey,
  isSelected,
  isPreviewing,
  onSelect,
  onPointerDown,
  onInspect,
  onContextMenuShot,
}: {
  shot: Shot
  leftPct: number
  widthPct: number
  isKey: boolean
  isSelected: boolean
  isPreviewing: boolean
  onSelect: () => void
  onPointerDown: (
    e: React.PointerEvent,
    shot: Shot,
    handle: 'whole' | 'left' | 'right',
  ) => void
  onInspect: () => void
  onContextMenuShot: (e: React.MouseEvent) => void
}) {
  const entry = useMediaStore((s) =>
    shot.keyframeMediaRef ? s.entries[shot.keyframeMediaRef] : undefined,
  )
  const framingTag = shortFraming(shot.framing)
  const isVideo = !!entry?.mimeType?.startsWith('video/')
  return (
    <div
      className={`ks-clip ks-shot-clip ${isSelected ? 'is-selected' : ''} ${
        isPreviewing ? 'is-dragging' : ''
      } ${isKey ? 'is-key' : ''} ${isVideo ? 'is-video' : ''}`}
      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
      onClick={onSelect}
      onPointerDown={(e) => onPointerDown(e, shot, 'whole')}
      onDoubleClick={(e) => {
        e.stopPropagation()
        onInspect()
      }}
      onContextMenu={onContextMenuShot}
      title={`${framingTag} · ${shot.prompt.slice(0, 60)}${isVideo ? ' · 视频镜头' : ''} · 双击看生成参数 · 右键跳素材库`}
    >
      <span
        className="ks-clip-handle ks-clip-handle-l"
        onPointerDown={(e) => {
          e.stopPropagation()
          onPointerDown(e, shot, 'left')
        }}
        aria-label="拖左改 startMs"
      />
      {isVideo && entry ? (
        // 视频镜头：用 <video> 做缩略；muted + preload=metadata 只抓首帧，
        // 不会自动播更不会吃性能。pointer-events:none 交给外层 clip 走拖拽。
        <video
          className="ks-shot-clip-thumb is-video"
          src={entry.url}
          muted
          playsInline
          preload="metadata"
          aria-hidden
        />
      ) : (
        <span
          className="ks-shot-clip-thumb"
          style={entry?.url ? { backgroundImage: `url(${entry.url})` } : undefined}
          aria-hidden
        >
          {!entry && (
            <span className="ks-shot-clip-ph ks-mono">{framingTag}</span>
          )}
        </span>
      )}
      <span className="ks-shot-clip-tag ks-mono">
        {isKey && <span className="ks-shot-clip-star" aria-label="代表帧">★</span>}
        {String(shot.order + 1).padStart(2, '0')} · {framingTag}
        {isVideo && <span className="ks-shot-clip-vbadge">▶</span>}
      </span>
      <span
        className="ks-clip-handle ks-clip-handle-r"
        onPointerDown={(e) => {
          e.stopPropagation()
          onPointerDown(e, shot, 'right')
        }}
        aria-label="拖右改 endMs"
      />
    </div>
  )
}

function shortFraming(f: Shot['framing']): string {
  switch (f) {
    case 'wide': return 'WIDE'
    case 'medium': return 'MED'
    case 'close': return 'CU'
    case 'insert': return 'INS'
    case 'ots': return 'OTS'
    case 'pov': return 'POV'
  }
}

// ─────────────────────────────────────────────────────────────────────
// AUDIO 轨 · v3.1
//
// 三种 role（bgm / sfx / vo）共享同一轨 UI，用颜色区分；clip 显示一个
// 条状占位（简易"波形"）+ label。播放集成留给下一轮 Player。
// ─────────────────────────────────────────────────────────────────────

function AudioTrack({
  scene,
  totalMs,
  preview,
  selectedClipId,
  onSelect,
  onPointerDown,
}: {
  scene: Scene
  totalMs: number
  preview: { id: string; startMs: number; durationMs: number } | null
  selectedClipId: string | null
  onSelect: (clipId: string) => void
  onPointerDown: (
    e: React.PointerEvent,
    clip: AudioClip,
    handle: 'whole' | 'left' | 'right',
  ) => void
}) {
  const clips = scene.audio ?? []

  return (
    <div className="ks-track ks-track-audio">
      <span className="ks-track-label ks-mono">AUDIO</span>
      {clips.length === 0 && (
        <span className="ks-track-empty-hint ks-mono">
          · 把右侧「音频」拖到这里 ·
        </span>
      )}
      {clips.map((clip) => {
        const isPreviewing = preview?.id === clip.id
        const start = isPreviewing ? preview!.startMs : clip.startMs
        const dur = isPreviewing ? preview!.durationMs : clip.durationMs
        const leftPct = (start / totalMs) * 100
        const widthPct = Math.max(1, (dur / totalMs) * 100)
        const isSelected = clip.id === selectedClipId
        return (
          <div
            key={clip.id}
            className={`ks-clip ks-audio-clip role-${clip.role} ${
              isSelected ? 'is-selected' : ''
            } ${isPreviewing ? 'is-dragging' : ''}`}
            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
            onClick={() => onSelect(clip.id)}
            onPointerDown={(e) => onPointerDown(e, clip, 'whole')}
            title={`${clip.role.toUpperCase()} · ${clip.label ?? clip.ref}`}
          >
            <span
              className="ks-clip-handle ks-clip-handle-l"
              onPointerDown={(e) => {
                e.stopPropagation()
                onPointerDown(e, clip, 'left')
              }}
            />
            <span className="ks-audio-clip-wave" aria-hidden />
            <span className="ks-audio-clip-label ks-mono">
              {clip.label ?? clip.role.toUpperCase()}
            </span>
            <span
              className="ks-clip-handle ks-clip-handle-r"
              onPointerDown={(e) => {
                e.stopPropagation()
                onPointerDown(e, clip, 'right')
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

const tlCss = `
.ks-timeline {
  display: flex; flex-direction: column; gap: 6px;
  padding: 6px 4px 10px;
  min-height: 0;
}
.ks-timeline-meta {
  display: flex; justify-content: space-between;
  font-size: 9.5px;
  letter-spacing: 0.24em;
  color: var(--ks-text-dim);
}
/* 横向滚动视口 —— 包住 .ks-timeline-tracks；缩放 > 1× 时画布变宽，这里出现滚动条 */
.ks-timeline-scroll {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-x: auto;
  /* 轨道变多（叠加转场/画面/贴纸轨）时纵向可滚，避免底部 VIDEO/IMAGE/AUDIO 被裁切 */
  overflow-y: auto;
  border-radius: var(--ks-radius-md);
  scrollbar-width: thin;
}
.ks-timeline-tracks {
  position: relative;
  box-sizing: border-box;
  min-height: 220px;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-elev);
  box-shadow: var(--ks-shadow-inset-hi);
  cursor: ew-resize;
  overflow: hidden;
  user-select: none;
  touch-action: none;
}
.ks-timeline-tracks.is-dragging { cursor: grabbing; }
.ks-timeline-rule {
  position: relative;
  height: 16px;
  border-bottom: 1px solid var(--ks-border-soft);
  background: var(--ks-surface-warm);
}
.ks-rule-tick {
  position: absolute;
  top: 2px;
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--ks-text-faint);
  transform: translateX(-50%);
}
.ks-track {
  position: relative;
  height: 24px;
  border-bottom: 1px solid var(--ks-border);
}
.ks-track:last-of-type { border-bottom: 0; }
.ks-track-label {
  position: absolute; left: 6px; top: 50%;
  transform: translateY(-50%);
  font-size: 8.5px;
  letter-spacing: 0.18em;
  color: var(--ks-text-faint);
  z-index: 4;
  pointer-events: none;
}

/* ── Dialogue clip + 左右 handle ─────────────────────────────── */
.ks-clip {
  position: absolute; top: 4px; bottom: 4px;
  border: 1px solid currentColor;
  border-radius: 2px;
  padding: 0 6px;
  display: flex; align-items: center;
  font-size: 10px;
  white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis;
  cursor: grab;
  transition: filter 120ms;
}
.ks-clip.is-dragging {
  cursor: grabbing;
  filter: drop-shadow(0 0 8px currentColor);
  z-index: 6;
}
.ks-clip-handle {
  position: absolute;
  top: -1px; bottom: -1px;
  width: 6px;
  cursor: ew-resize;
  background: currentColor;
  opacity: 0;
  transition: opacity 120ms;
}
.ks-clip:hover .ks-clip-handle,
.ks-clip.is-dragging .ks-clip-handle { opacity: 0.55; }
.ks-clip-handle-l { left: -1px; }
.ks-clip-handle-r { right: -1px; }
.ks-clip-dialogue { color: var(--ks-cyan); background: rgba(125,211,252,0.06); }
.ks-clip-dialogue.role-protagonist { color: var(--ks-amber); background: rgba(232,162,58,0.08); }
.ks-clip-dialogue.role-character { color: var(--ks-magenta); background: rgba(232,121,249,0.08); }
/* 空文本台词：虚线、淡显，提示是残留 clip（可右键删 / 用「清理空台词」批量删）。 */
.ks-clip-dialogue.is-empty-dialogue {
  color: var(--ks-text-faint);
  background: rgba(148, 163, 184, 0.06);
  border-style: dashed;
  opacity: 0.7;
}
.ks-clip-dialogue.is-empty-dialogue .ks-clip-text { font-style: italic; }
/* DIA 轨右上角的「清理空台词」按钮（轨 label 是 pointer-events:none，这里单独可点）。 */
.ks-dia-clean-btn {
  position: absolute;
  right: 6px; top: 3px;
  z-index: 5;
  padding: 1px 6px;
  font-size: 9px;
  letter-spacing: 0.05em;
  color: var(--ks-amber);
  background: rgba(232, 162, 58, 0.1);
  border: 1px solid var(--ks-amber-soft, rgba(232, 162, 58, 0.4));
  border-radius: 3px;
  cursor: pointer;
}
.ks-dia-clean-btn:hover { background: rgba(232, 162, 58, 0.2); }
.ks-clip-text {
  font-family: var(--ks-font-cn);
  font-size: 10.5px;
  pointer-events: none;
}

/* ── QTE Cue pin + 目标 handle ───────────────────────────────── */
.ks-cue-pin {
  position: absolute; top: 0; bottom: 0;
  width: 16px;
  margin-left: -8px;
  cursor: grab;
}
.ks-cue-pin.is-dragging { cursor: grabbing; }
.ks-cue-pin-bar {
  position: absolute; top: 4px; bottom: 14px; left: 7px;
  width: 2px;
  background: var(--ks-amber);
  box-shadow: 0 0 6px var(--ks-amber);
  pointer-events: none;
}
.ks-cue-pin.shape-hold .ks-cue-pin-bar { background: var(--ks-magenta); box-shadow: 0 0 6px var(--ks-magenta); }
.ks-cue-pin.shape-sweep .ks-cue-pin-bar { background: var(--ks-cyan); box-shadow: 0 0 6px var(--ks-cyan); }
.ks-cue-pin.is-dragging .ks-cue-pin-bar { box-shadow: 0 0 12px currentColor; }
.ks-cue-pin-tag {
  position: absolute; bottom: 1px; left: 12px;
  font-size: 8.5px;
  letter-spacing: 0.18em;
  color: var(--ks-amber);
  pointer-events: none;
}

/* 触发轨 · 子弹时间区间 */
.ks-track-trig { background: rgba(125, 211, 252, 0.025); }
.ks-trig-band {
  position: absolute; top: 4px; bottom: 4px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 2px;
  background:
    repeating-linear-gradient(
      135deg,
      rgba(125, 211, 252, 0.18) 0 6px,
      rgba(232, 162, 58, 0.10) 6px 12px
    );
  border: 1px solid rgba(125, 211, 252, 0.45);
  box-shadow: inset 0 0 8px rgba(125, 211, 252, 0.18);
  overflow: hidden;
}
.ks-trig-band.is-soft {
  border-color: rgba(110, 231, 183, 0.35);
  background:
    repeating-linear-gradient(
      135deg,
      rgba(110, 231, 183, 0.10) 0 6px,
      transparent 6px 12px
    );
  box-shadow: none;
}
.ks-trig-edge {
  position: absolute; top: 0; bottom: 0;
  width: 4px;
  background: var(--ks-cyan);
  box-shadow: 0 0 8px var(--ks-cyan);
}
.ks-trig-edge-l {
  left: -2px;
  cursor: ew-resize;
}
.ks-trig-edge-l::after {
  content: '';
  position: absolute;
  top: 0; bottom: 0;
  left: -3px; right: -3px;
}
.ks-trig-edge-r { right: -2px; background: var(--ks-rose); box-shadow: 0 0 8px var(--ks-rose); }
.ks-trig-band.is-soft .ks-trig-edge { background: var(--ks-mint); box-shadow: 0 0 6px var(--ks-mint); }
.ks-trig-band.is-soft .ks-trig-edge-r { background: var(--ks-mint); }
.ks-trig-fail {
  position: absolute; right: 4px; top: 50%;
  transform: translateY(-50%);
  font-size: 11px; line-height: 1;
  color: var(--ks-rose);
  text-shadow: 0 0 4px var(--ks-rose);
  pointer-events: none;
}
.ks-trig-band.is-soft .ks-trig-fail { display: none; }
.ks-trig-rate {
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--ks-cyan);
  text-shadow: 0 0 4px rgba(125, 211, 252, 0.6);
  white-space: nowrap;
  pointer-events: none;
}
.ks-trig-band.is-soft .ks-trig-rate { color: var(--ks-mint); }

.ks-branch-pin {
  position: absolute; top: 0; bottom: 0;
  width: 16px;
  margin-left: -8px;
  cursor: grab;
}
.ks-branch-pin.is-dragging { cursor: grabbing; }
.ks-branch-pin-tag {
  position: absolute; left: 12px; top: 50%;
  transform: translateY(-50%);
  font-size: 9px;
  letter-spacing: 0.14em;
  color: var(--ks-mint);
  border-left: 2px solid var(--ks-mint);
  padding-left: 6px;
  text-shadow: 0 0 4px rgba(110,231,183,0.4);
  white-space: nowrap;
  pointer-events: none;
}
.ks-branch-pin.is-dragging .ks-branch-pin-tag {
  text-shadow: 0 0 10px rgba(110,231,183,0.7);
}

.ks-cursor {
  position: absolute; top: 0; bottom: 0;
  width: 1px;
  background: var(--ks-amber-glow);
  box-shadow: 0 0 8px var(--ks-amber-glow);
  pointer-events: none;
}

/* 拖拽时间码 HUD */
.ks-tl-hud {
  position: absolute;
  top: 4px; right: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: var(--ks-text);
  background: var(--ks-panel-elev);
  backdrop-filter: var(--ks-glass-blur);
  -webkit-backdrop-filter: var(--ks-glass-blur);
  border: 1px solid var(--ks-border-strong);
  border-radius: var(--ks-radius-pill);
  pointer-events: none;
  z-index: 8;
  box-shadow: var(--ks-shadow-soft);
  font-family: var(--ks-font-mono);
}
.ks-tl-hud-kind { color: var(--ks-amber-glow); letter-spacing: 0.22em; }
.ks-tl-hud-time { color: var(--ks-cyan); }
.ks-tl-hud-delta { color: var(--ks-amber-glow); text-shadow: 0 0 4px rgba(232, 162, 58, 0.55); }
.ks-tl-hud-sep { color: var(--ks-text-faint); }
.ks-tl-hud-snap {
  margin-left: 4px;
  padding-left: 8px;
  border-left: 1px solid rgba(125, 211, 252, 0.25);
  font-size: 9px;
  color: var(--ks-text-dim);
  letter-spacing: 0.18em;
}

/* 吸附辅助线 */
.ks-tl-snap-guide {
  position: absolute; top: 0; bottom: 0;
  width: 1px;
  background: var(--ks-amber-glow);
  box-shadow: 0 0 14px rgba(232, 162, 58, 0.6);
  opacity: 0.8;
  pointer-events: none;
  z-index: 7;
  animation: ks-tl-snap-pulse 0.42s ease-out;
}
@keyframes ks-tl-snap-pulse {
  from { opacity: 1; box-shadow: 0 0 26px rgba(232, 162, 58, 0.95); }
  to { opacity: 0.8; }
}

/* ── v3.1 · SHOT 轨 / AUDIO 轨 ─────────────────────────────── */
.ks-track-video {
  height: 44px;
  background: rgba(99, 179, 237, 0.05);
}
.ks-track-video.is-empty {
  background: rgba(99, 179, 237, 0.02);
}
.ks-video-clip {
  /* 用 .ks-clip 基类就已经有 position: absolute; top/bottom: 4px;
     cursor: grab; hover 时 handle 显示等行为 —— 这里只做视频色调 */
  color: rgba(99, 179, 237, 0.95);
  background: linear-gradient(
    90deg,
    rgba(99, 179, 237, 0.22),
    rgba(99, 179, 237, 0.10)
  );
  border-color: rgba(99, 179, 237, 0.7);
  overflow: hidden;
  padding: 0;
}
/* v3.9.8：选中视频 clip 的 amber 环 —— 跟 .ks-shot-clip.is-selected 同款，
   让作者选中视频 / 图像的视觉反馈一致。 */
.ks-video-clip.is-selected {
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 2px var(--ks-amber-soft), 0 0 14px rgba(232, 162, 58, 0.3);
}
.ks-video-clip-thumb {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  opacity: 0.35;
  pointer-events: none;
  filter: saturate(0.8);
}
.ks-video-clip-label {
  position: relative;
  margin: 0 auto;
  z-index: 1;
  padding: 2px 8px;
  background: rgba(10, 14, 22, 0.7);
  border-radius: var(--ks-radius-pill);
  font-size: 10px;
  color: var(--ks-text);
  letter-spacing: 0.04em;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}
/* 逐镜视频片段（多段拼一个 scene）：铺在 VIDEO 轨上、按镜窗定位。
   与下方图像轨 .ks-shot-clip 用同一套"画框 + 左下角标"视觉语言，只用冷蓝描边 + ▶
   区分"这是视频"，让上下两轨观感统一（作者要求「统一一下」）；双击看参数 / 右键跳素材库。 */
.ks-shot-video-clip {
  cursor: pointer;
  /* 盖掉 .ks-clip 默认 padding，让缩略图铺满画框（与图像 clip 一致） */
  padding: 0;
  border-radius: 4px;
  border-color: rgba(125, 211, 252, 0.6);
}
.ks-shot-video-clip .ks-video-clip-thumb {
  opacity: 0.92;
  filter: none;
}
/* 左下角镜号标 —— 复刻 .ks-shot-clip-tag 的样式（位置 / 药丸 / 毛玻璃），
   仅把 ▶ 染成冷蓝表明是视频。 */
.ks-shot-video-tag {
  position: absolute;
  left: 8px; bottom: 3px; z-index: 1;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 6px;
  font-size: 9px;
  letter-spacing: 0.18em;
  color: #fff;
  background: rgba(2, 5, 10, 0.6);
  border-radius: 999px;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.ks-shot-video-tag-play {
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(125, 211, 252, 0.18);
  color: var(--ks-cyan);
  font-size: 9px;
  letter-spacing: 0;
}
.ks-track-shot {
  height: 52px;
  background: rgba(232, 162, 58, 0.04);
}
.ks-track-shot.is-empty {
  height: 24px;
}
.ks-track-audio {
  height: 34px;
  background: rgba(110, 231, 183, 0.04);
}
.ks-track-empty-hint {
  position: absolute; left: 40px; top: 50%;
  transform: translateY(-50%);
  font-size: 9.5px;
  letter-spacing: 0.2em;
  color: var(--ks-text-faint);
}

.ks-shot-clip {
  position: absolute;
  top: 3px; bottom: 3px;
  display: grid;
  grid-template-columns: 8px 1fr 8px;
  align-items: stretch;
  border-radius: 4px;
  border: 1px solid var(--ks-border-strong);
  background: var(--ks-panel-solid);
  overflow: hidden;
  cursor: grab;
  color: var(--ks-amber);
  transition: box-shadow var(--ks-dur-fast) var(--ks-ease), border-color var(--ks-dur-fast) var(--ks-ease);
}
.ks-shot-clip.is-dragging { cursor: grabbing; z-index: 5; }
.ks-shot-clip.is-selected {
  border-color: var(--ks-amber);
  box-shadow: 0 0 0 2px var(--ks-amber-soft), 0 0 14px rgba(232, 162, 58, 0.3);
}
.ks-shot-clip.is-key::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px dashed rgba(232, 162, 58, 0.5);
  border-radius: inherit;
  pointer-events: none;
}
.ks-shot-clip-thumb {
  position: relative;
  background: #0a0e17 center/cover no-repeat;
  background-image:
    linear-gradient(180deg, rgba(0,0,0,0.0), rgba(0,0,0,0.35));
}
.ks-shot-clip-thumb {
  grid-column: 1 / -1;
  grid-row: 1;
  border-radius: inherit;
}
/*
 * shot clip 里用 <video> 承载视频首帧：pointer-events:none 让拖拽事件直穿到
 * 外层 clip；object-fit:cover 保持和 CSS background 的 cover 视觉一致。
 */
.ks-shot-clip-thumb.is-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  pointer-events: none;
  background: #0a0e17;
}
.ks-shot-clip.is-video {
  /* 视频镜头用冷蓝色描边区分于图片镜头（琥珀色） */
  border-color: rgba(125, 211, 252, 0.55);
}
.ks-shot-clip.is-video.is-selected {
  border-color: var(--ks-cyan);
  box-shadow: 0 0 0 2px rgba(125, 211, 252, 0.35), 0 0 14px rgba(125, 211, 252, 0.28);
}
.ks-shot-clip-vbadge {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(125, 211, 252, 0.18);
  color: var(--ks-cyan);
  font-size: 9px;
}
.ks-shot-clip-ph {
  position: absolute;
  inset: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px;
  letter-spacing: 0.22em;
  color: var(--ks-text-faint);
  background: repeating-linear-gradient(45deg, #02050a 0 8px, #0a0e17 8px 9px);
}
.ks-shot-clip-tag {
  position: absolute;
  left: 8px; bottom: 3px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  font-size: 9px;
  letter-spacing: 0.18em;
  color: #fff;
  background: rgba(2, 5, 10, 0.6);
  border-radius: 999px;
  pointer-events: none;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.ks-shot-clip-star { color: var(--ks-amber); font-size: 10px; }

.ks-audio-clip {
  position: absolute;
  top: 4px; bottom: 4px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  border-radius: 3px;
  border: 1px solid currentColor;
  background: rgba(110, 231, 183, 0.1);
  color: var(--ks-mint);
  cursor: grab;
  overflow: hidden;
  transition: box-shadow var(--ks-dur-fast) var(--ks-ease);
}
.ks-audio-clip.is-dragging { cursor: grabbing; z-index: 5; }
.ks-audio-clip.is-selected {
  box-shadow: 0 0 0 2px rgba(110, 231, 183, 0.3);
}
.ks-audio-clip.role-bgm { color: var(--ks-mint); background: rgba(110, 231, 183, 0.1); }
.ks-audio-clip.role-sfx { color: var(--ks-cyan); background: rgba(125, 211, 252, 0.10); }
.ks-audio-clip.role-vo  { color: var(--ks-amber); background: rgba(232, 162, 58, 0.10); }
.ks-audio-clip-wave {
  position: absolute; inset: 0;
  background:
    repeating-linear-gradient(
      90deg,
      currentColor 0 1px,
      transparent 1px 4px
    );
  opacity: 0.3;
  pointer-events: none;
  mask-image: linear-gradient(180deg, transparent 10%, black 30%, black 70%, transparent 90%);
  -webkit-mask-image: linear-gradient(180deg, transparent 10%, black 30%, black 70%, transparent 90%);
}
.ks-audio-clip-label {
  font-family: var(--ks-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  pointer-events: none;
  position: relative;
  white-space: nowrap;
}

/* ── v3.2 · 选中态 ─────────────────────────────────────────
 * dialogue / cue / branch 三类小 clip 在被点选后加 is-selected，
 * 用描边 + 轻微光晕突出"当前焦点"，和 shot/audio 已有的 is-selected
 * 视觉统一。颜色不改，只强化边界，保留原有 role 配色语义。
 */
.ks-clip-dialogue.is-selected {
  outline: 2px solid var(--ks-amber);
  outline-offset: 1px;
  box-shadow: 0 0 0 2px var(--ks-amber-soft), 0 2px 10px rgba(255, 123, 61, 0.28);
  z-index: 4;
}
.ks-cue-pin.is-selected {
  outline: 2px solid var(--ks-amber);
  outline-offset: 2px;
  z-index: 4;
}
.ks-cue-pin.is-selected .ks-cue-pin-bar {
  box-shadow: 0 0 10px var(--ks-amber);
}
.ks-branch-pin.is-selected {
  outline: 2px solid var(--ks-amber);
  outline-offset: 2px;
  z-index: 4;
}
.ks-branch-pin.is-selected .ks-branch-pin-tag {
  background: var(--ks-amber-soft);
  color: var(--ks-amber);
  border-color: var(--ks-amber);
}

/* ── TXT 轨（文字叠加）─────────────────────────────── */
.ks-track-text { background: rgba(196, 166, 255, 0.05); }
.ks-clip-text {
  position: absolute;
  top: 4px; bottom: 4px;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(196,166,255,0.30), rgba(196,166,255,0.16));
  border: 1px solid rgba(196,166,255,0.5);
  color: #efe7ff;
  display: flex; align-items: center;
  overflow: hidden;
  cursor: grab;
}
.ks-clip-text.is-selected {
  border-color: #c4a6ff;
  box-shadow: 0 0 0 2px rgba(196,166,255,0.4);
}

/* ── SRCH 轨（搜索段）──────────────────────────────── */
.ks-track-search { background: rgba(103, 212, 166, 0.05); }
.ks-clip-search {
  position: absolute;
  top: 4px; bottom: 4px;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(103,212,166,0.30), rgba(103,212,166,0.15));
  border: 1px solid rgba(103,212,166,0.5);
  color: #d8fff0;
  display: flex; align-items: center;
  overflow: hidden;
  cursor: grab;
}
.ks-clip-search.is-selected {
  border-color: #67d4a6;
  box-shadow: 0 0 0 2px rgba(103,212,166,0.4);
}

/* ── FX 轨（画面：滤镜 / 调节 / 特效）──────────────────── */
.ks-track-fx { background: rgba(120, 190, 255, 0.05); }
.ks-clip-fx {
  position: absolute;
  top: 4px; bottom: 4px;
  border-radius: 6px;
  display: flex; align-items: center;
  overflow: hidden;
  cursor: grab;
  color: #eaf4ff;
  border: 1px solid rgba(120,190,255,0.5);
  background: linear-gradient(180deg, rgba(120,190,255,0.28), rgba(120,190,255,0.14));
}
.ks-clip-fx.is-adjust {
  border-color: rgba(120,210,200,0.5);
  background: linear-gradient(180deg, rgba(120,210,200,0.28), rgba(120,210,200,0.14));
  color: #e6fff8;
}
.ks-clip-fx.is-effect {
  border-color: rgba(255,170,120,0.5);
  background: linear-gradient(180deg, rgba(255,170,120,0.28), rgba(255,170,120,0.14));
  color: #fff1e6;
}
.ks-clip-fx.is-selected {
  box-shadow: 0 0 0 2px rgba(120,190,255,0.45);
  filter: brightness(1.1);
}

/* ── 剪映式镜间转场徽标（画在 VIDEO 轨两段视频衔接处）───────────── */
.ks-trans-badge {
  all: unset;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 7;
  width: 18px; height: 18px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 5px;
  font-size: 11px; line-height: 1;
  cursor: pointer;
  color: var(--ks-text-dim);
  background: rgba(10, 12, 18, 0.82);
  border: 1px solid var(--ks-border-strong, rgba(180,150,255,0.5));
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  transition: all 120ms;
}
.ks-trans-badge:hover {
  color: #f0eaff;
  border-color: #b496ff;
  transform: translate(-50%, -50%) scale(1.12);
}
.ks-trans-badge.has-trans {
  color: #f0eaff;
  background: linear-gradient(180deg, rgba(180,150,255,0.55), rgba(140,110,230,0.4));
  border-color: rgba(180,150,255,0.8);
}
.ks-trans-badge.is-selected {
  border-color: #b496ff;
  box-shadow: 0 0 0 2px rgba(180,150,255,0.55);
}

/* ── STK 轨（贴纸）─────────────────────────────────── */
.ks-track-sticker { background: rgba(255, 140, 190, 0.05); }
.ks-clip-sticker {
  position: absolute;
  top: 4px; bottom: 4px;
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(255,140,190,0.30), rgba(255,140,190,0.15));
  border: 1px solid rgba(255,140,190,0.5);
  color: #ffe6f1;
  display: flex; align-items: center;
  overflow: hidden;
  cursor: grab;
}
.ks-clip-sticker.is-selected {
  border-color: #ff8cbe;
  box-shadow: 0 0 0 2px rgba(255,140,190,0.4);
}

/* ── MINIGAME 轨 ───────────────────────────────────── */
.ks-track-minigame {
  background: rgba(255, 181, 80, 0.04);
}
.ks-minigame-block {
  position: absolute;
  top: 4px;
  bottom: 4px;
  border-radius: 6px;
  background: linear-gradient(
    135deg,
    rgba(255, 181, 80, 0.28),
    rgba(255, 120, 200, 0.24) 60%,
    rgba(170, 130, 255, 0.22)
  );
  border: 1px solid rgba(255, 181, 80, 0.55);
  color: #fff;
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 0 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  overflow: hidden;
  box-shadow: 0 0 0 1px rgba(0,0,0,0.18), 0 2px 12px rgba(255, 140, 200, 0.15);
  user-select: none;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.ks-minigame-block:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.2), 0 4px 16px rgba(255, 140, 200, 0.28);
}
.ks-minigame-block.is-selected {
  outline: 2px solid var(--ks-amber);
  outline-offset: 1px;
}
.ks-minigame-block-icon {
  flex-shrink: 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.82);
}
.ks-minigame-block-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

`
injectStyleOnce('timeline', tlCss)
