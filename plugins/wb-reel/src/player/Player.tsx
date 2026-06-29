import { useEffect, useMemo, useRef, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useShellStore } from '../shell/shellStore'
import { useMediaStore } from '../media/mediaStore'
import { useSceneImageCache } from '../media/sceneImageCache'
import { useSceneAudio } from '../media/useSceneAudio'
import { createImageProvider } from '../llm'
import type { ImageClient } from '../llm/types'
import type {
  Branch,
  MinigameClip,
  Scene,
  SearchHotspot,
  SearchSegmentClip,
  Shot,
  QTECue,
} from '../scenario/types'
import { DialogueBox } from './DialogueBox'
import { QTEOverlay } from './QTEOverlay'
import { ChoiceLayer } from './ChoiceLayer'
import { PlayerMenu } from './PlayerMenu'
import { PlaybackControls } from './PlaybackControls'
import { SettlementOverlay } from './SettlementOverlay'
import { MinigameOverlay } from './MinigameOverlay'
import { SearchLayer, InventoryHUD } from './SearchLayer'
import { TextOverlayLayer } from './TextOverlayLayer'
import { FxOverlayLayer, FadeLayer, StickerLayer } from './SceneFxLayers'
import { useTrackPrefsStore } from '../editor/timeline/trackPrefsStore'
import { composeStageFx } from '../fx/fxPresets'
import { isModuleEnabled } from '../scenario/moduleFlags'
import { nextMinigameToTrigger, pendingMinigamesAtEnd } from './minigameHit'
import { nextSearchToTrigger, segmentHotspots, isSegmentComplete } from './searchSegmentHit'
import {
  applyEffects,
  applyItemEffects,
  evaluateGate,
  initVarState,
  isBranchAvailable,
  type ItemState,
  type VarState,
} from './conditionEval'
import type { MinigameEvent } from './minigameMessage'
import {
  DIALOGUE_PREF_STORAGE_KEY,
  loadDialoguePref,
  saveDialoguePref,
} from '../editor/timeline/dialoguePref'
import {
  judgeHold,
  judgeTap,
  tallyQTE,
  type HitVerdict,
} from '../qte/QTEEngine'
import {
  firstFailedSlowMoCue,
  resolveActiveSlowMo,
  type SlowMoState,
} from '../qte/slowMo'
import { injectStyleOnce } from '../styles/injectStyle'
import { useCinemaHold } from './cinemaGate'
import { computeEffectiveEndMs } from './sceneEndTime'
import { placeholderBgClass } from './placeholderBg'
import { qteOverlayAmbientClass } from './qteAmbient'

/**
 * Player —— 互动影游运行时（纯净沉浸版 + 触发点 / 子弹时间）
 *
 * 屏幕上**默认只有画面**：视频 / GPT-Image-2 占位 + 必要时台词框。
 * 全部"游戏内 UI"（HUD、工具栏、进度条、分数槽）都已删除——这些应当由
 * 视频本身（或作者后期）承担。引擎只在玩家"做选择"或"打节奏点"那一瞬间
 * 出现必要的反馈：
 *
 *   - DialogueBox       台词框（按需出现）
 *   - QTEOverlay        节奏点 + PERFECT/MISS 飘字
 *   - ChoiceLayer       选项面板（场景结束需要选择时全屏接管）
 *   - SlowMoHUD         触发点慢放氛围层（边缘高光 + BULLET TIME 文字 + 进度条）
 *   - SettlementOverlay 触发点失败结算屏（带分数 / 重试 / 返回 / 跳分支）
 *   - PlayerMenu (FAB)  右上发光圆形按钮 → 呼出剧情树/主页/重播/起点/退出
 *
 * **触发点 / 子弹时间**：QTECue 上挂 `slowMo` 字段时升级为视频时间轴上的
 * 触发点。进入区间 → 视频 playbackRate 降为 rate；命中 → 立刻恢复并继续
 * 播放；超时 / MISS → 走失败结算（跳 failSceneId、qte_fail 分支或弹通用屏）。
 *
 * **时钟真源**：
 *   - VIDEO 场景以 `<video>.currentTime` 作为 elapsed 的真源（这样
 *     playbackRate 慢放时 elapsed 自然跟着变慢，cue 判定窗仍然对齐画面）；
 *   - 其他场景（IMAGE_PROMPT / PLACEHOLDER）退化为墙钟累积 + 当前速率，
 *     语义上等价于"内容时间"。
 */
export function Player() {
  const scenario = useScenarioStore((s) => s.scenario)
  const setMode = useScenarioStore((s) => s.setMode)
  const [sceneId, setSceneId] = useState<string>(scenario.rootSceneId)
  const [visited, setVisited] = useState<string[]>([scenario.rootSceneId])
  const scene = scenario.scenes[sceneId]

  /*
   * player-only 预览(主工程 iframe)的"加载中"守卫。
   *
   * 启动瞬间 store 可能是内置 demo 空壳 / 一份陈旧无根副本,真正的剧本要等磁盘水合
   * (probe + fetch `/__reel__/scenarios?game=`) 才落进 store。这个窗口里直接显示
   * "无可播放场景"会让用户误以为内容丢了。所以 player-only 下水合期显示"加载中…",
   * 超时(6s 仍无 scene)才退化为明确的失败提示——避免真·损坏时无限转圈。
   */
  const playerOnly = useMemo<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).get('surface') === 'player'
    } catch {
      return false
    }
  }, [])
  const [loadTimedOut, setLoadTimedOut] = useState(false)
  useEffect(() => {
    if (scene) {
      setLoadTimedOut(false)
      return
    }
    const t = window.setTimeout(() => setLoadTimedOut(true), 6000)
    return () => window.clearTimeout(t)
  }, [scene])
  useEffect(() => {
    if (scene) return
    // eslint-disable-next-line no-console
    console.warn('[reel-player] 无可播放场景 —— 诊断信息', {
      scenarioId: scenario.id,
      title: scenario.title,
      rootSceneId: scenario.rootSceneId,
      sceneId,
      sceneKeys: Object.keys(scenario.scenes ?? {}),
      playerOnly,
    })
  }, [scene, scenario, sceneId, playerOnly])

  // 数值系统运行时状态（好感度 / flag / 积分）。
  //   - vars：当前数值，初始化自 Scenario.variables 的 initial
  //   - varsRef / visitedRef：给 handleSceneEnd 等回调读最新值（避免闭包过期）
  //   - appliedEnterRef：记录已应用过 onEnterEffects 的 sceneId，避免重复累加；
  //     仅在 restart()（从头玩）时清空，replayScene 单场重播不清。
  const [vars, setVars] = useState<VarState>(() => initVarState(scenario))
  const varsRef = useRef(vars)
  varsRef.current = vars
  // 背包系统运行时状态：itemId -> 拥有数量。搜索拾取 / 分支与进入效果增减。
  const [ownedItems, setOwnedItems] = useState<ItemState>({})
  const ownedItemsRef = useRef(ownedItems)
  ownedItemsRef.current = ownedItems
  const visitedRef = useRef(visited)
  visitedRef.current = visited
  const appliedEnterRef = useRef<Set<string>>(new Set())
  // 搜索热点「已拾取」去重：`${sceneId}:${hotspotId}` 一轮只能拾取一次。
  const [lootedKeys, setLootedKeys] = useState<Set<string>>(new Set())
  const lootedRef = useRef<Set<string>>(lootedKeys)
  lootedRef.current = lootedKeys
  // 搜索模式开关（放大镜光标 + 热点可点）。换场时自动退出。
  const [searching, setSearching] = useState(false)

  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [verdicts, setVerdicts] = useState<HitVerdict[]>([])
  const [choiceOpen, setChoiceOpen] = useState(false)
  const [endingScreen, setEndingScreen] = useState(false)
  const [resetTick, setResetTick] = useState(0)
  const [slowMo, setSlowMo] = useState<SlowMoState>({
    active: false,
    rate: 1,
    activeCueId: null,
    windowProgress: 0,
  })
  const [settlement, setSettlement] = useState<{ failedCue: QTECue } | null>(null)
  /**
   * 进入门槛被阻断时的瞬时提示（数值/物品不足、且门槛 onFail='block' 又没配改道）。
   * 几秒后自动消失，纯反馈，不改导航。
   */
  const [gateNotice, setGateNotice] = useState<string | null>(null)
  // 小游戏触发状态：当前正在玩哪一条 clip / 已玩过哪些（不再重触）
  const [activeMinigame, setActiveMinigame] = useState<MinigameClip | null>(null)
  const triggeredMinigamesRef = useRef<Set<string>>(new Set())
  // 搜索段触发状态：当前正卡在哪一段 / 已完成过哪些（不再重触）
  const [activeSearch, setActiveSearch] = useState<SearchSegmentClip | null>(null)
  const completedSearchRef = useRef<Set<string>>(new Set())
  /*
   * 字幕（DialogueBox）可见性 —— 与时间轴的 "DIA 轨" 开关同步。
   *
   * 作者反馈："我在时间轴里隐藏台词了，Player 里还有字幕"。
   * 这个 pref 是剧本级 UX 偏好（存 localStorage），两端共用：
   *   · Timeline DIA 轨（显示/隐藏字幕轨道方便编辑其它轨）
   *   · Player DialogueBox（预览时是否叠字幕）
   *
   * 默认 false（隐藏）—— 和 Timeline 默认值对齐，避免"Player 有但 Timeline 没有"的割裂。
   *
   * 跨 tab / 跨视图同步：用 storage 事件 + 周期性 re-read 兜底（storage 事件只在
   * 不同 tab 间触发，同 tab 内 localStorage.setItem 不会触发；所以额外加一个 effect
   * 去订阅 Timeline 组件的变更）。
   *
   * 这里选择"监听 storage 事件"策略 —— Timeline 内部改值时也 dispatch 一次 storage
   * 事件兜底；对大多数用户只需要刷新前一次生效就够。最保险：下面会在 Player 可见期
   * 周期性 re-read 一次（200ms 轮询，代价极低）。
   */
  const [showSubtitles, setShowSubtitles] = useState<boolean>(() => loadDialoguePref())
  // 轨头眼睛(trackPrefs)同步 —— 编辑器内试玩时,隐藏的文字轨在画面里也不叠。
  const txtTrackVisible = useTrackPrefsStore((s) => s.prefs.txt.visible)
  useEffect(() => {
    function syncFromStorage(): void {
      setShowSubtitles(loadDialoguePref())
    }
    function onStorage(e: StorageEvent): void {
      if (e.key === DIALOGUE_PREF_STORAGE_KEY) syncFromStorage()
    }
    window.addEventListener('storage', onStorage)
    // 同 tab 兜底：200ms 轮询。代价：一次 localStorage.getItem，微秒级。
    const poll = window.setInterval(syncFromStorage, 200)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.clearInterval(poll)
    }
  }, [])
  function toggleSubtitles(): void {
    setShowSubtitles((v) => {
      const next = !v
      saveDialoguePref(next)
      return next
    })
  }

  // 门槛阻断提示 2.6s 后自动消失。
  useEffect(() => {
    if (!gateNotice) return
    const t = window.setTimeout(() => setGateNotice(null), 2600)
    return () => window.clearTimeout(t)
  }, [gateNotice])

  // 换场自动退出搜索模式（搜查是「当前现场」的动作）。
  useEffect(() => {
    setSearching(false)
  }, [sceneId])

  /*
   * 剧本在播放器底下被「换掉」时,把播放状态复位到新剧本的根节点。
   *
   * 根因(2026-06-19):`sceneId` 用 `useState(scenario.rootSceneId)` 初始化,只在
   * 首次挂载取一次。player-only 预览首帧 store 还是内置 demo(根=`intro`),磁盘
   * 水合随后把剧本换成真本(如《破阵子》根=`1.1`),但 `sceneId` 仍卡在 `intro` →
   * `scenes['intro']` 取不到 → 一直「无可播放场景」。
   *
   * 这里用 ref 跟踪上一次的 scenario.id;一旦 id 变化(整本被替换,而非同本内跳幕),
   * 就像 restart 一样把导航/数值/计时全部复位到新根。注意只认「id 变化」,不影响
   * 正常的幕间跳转与编辑器里同本的实时改动。
   */
  const loadedScenarioIdRef = useRef<string>(scenario.id)
  useEffect(() => {
    if (loadedScenarioIdRef.current === scenario.id) return
    loadedScenarioIdRef.current = scenario.id
    setSceneId(scenario.rootSceneId)
    setVisited([scenario.rootSceneId])
    setVars(initVarState(scenario))
    setOwnedItems({})
    setLootedKeys(new Set())
    setSearching(false)
    appliedEnterRef.current = new Set()
    setElapsed(0)
    setVerdicts([])
    setChoiceOpen(false)
    setEndingScreen(false)
    setSettlement(null)
    setActiveMinigame(null)
    triggeredMinigamesRef.current = new Set()
    setActiveSearch(null)
    completedSearchRef.current = new Set()
    setResetTick((t) => t + 1)
  }, [scenario])

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const sceneStartedAtRef = useRef<number>(performance.now())
  const lastTickWallRef = useRef<number>(performance.now())
  const elapsedRef = useRef<number>(0)
  const rafRef = useRef<number | null>(null)
  const verdictsRef = useRef<HitVerdict[]>([])
  verdictsRef.current = verdicts
  const failTriggeredRef = useRef<boolean>(false)
  /**
   * v3.8 · 下一幕视频预拉相关 refs。
   *
   * prefetchedUrlsRef —— 已预拉过的 asset URL 集合，避免同一 URL 多轮 scene
   *   切换时重复请求（HTTP 缓存层面虽然不会真下载，但省 request lifecycle）。
   * prefetchControllersRef —— 仍在飞的 AbortController，切下一 scene 时逐一 abort，
   *   省 CVM 出带宽。
   */
  const prefetchedUrlsRef = useRef<Set<string>>(new Set())
  const prefetchControllersRef = useRef<AbortController[]>([])

  // setPaused 暂未对外暴露；保留 setter 让 React 不警告（未来可接菜单暂停）
  void setPaused

  // 音频预览：画面推进时（无 minigame/search/choice/结算等暂停态）按场景音频出声。
  // 播放头用 elapsedRef（高频、不进依赖），避免触发重渲。
  const audioPlaying =
    !!scene &&
    !paused &&
    !activeMinigame &&
    !activeSearch &&
    !choiceOpen &&
    !endingScreen
  useSceneAudio({
    scene,
    sceneId,
    playing: audioPlaying,
    getPlayheadMs: () => elapsedRef.current,
  })

  /**
   * 跳进 / 跳退 —— delta 正值前进、负值后退（ms）。
   *
   * 时间真源分两种：
   *   - VIDEO 场景：`<video>.currentTime` 是真源，直接把 currentTime 改掉；
   *     下一帧 RAF 会从 video 读到新值写回 elapsedRef → UI / QTE 窗自然对齐
   *   - 其它场景（IMAGE_PROMPT / PLACEHOLDER）：elapsedRef 是真源，改它即可；
   *     同时必须刷新 lastTickWallRef，否则下一帧 dt 会把跳过的墙钟间隔再补进去
   *
   * 额外：
   *   - 钳到 [0, effectiveEnd]（超过就是"直接到底"）
   *   - 用户主动 seek 时清掉 failTriggeredRef —— 后退到已过的 cue 再让它重新参与
   *     判定（否则之前 MISS 的 cue 锁死，后退过去也触发不了）
   *   - verdicts 不清空：保留历史判定结果，防止已经打过的 cue 倒带后重复计分
   */
  function handleSeekBy(deltaMs: number): void {
    if (!scene) return
    const duration = scene.durationMs
    const effectiveEnd = computeEffectiveEndMs(scene)
    const cap = Math.min(duration, effectiveEnd)
    const cur = elapsedRef.current
    const next = Math.max(0, Math.min(cap, cur + deltaMs))
    if (Math.abs(next - cur) < 1) return

    if (scene.media.kind === 'VIDEO' && videoRef.current) {
      try {
        videoRef.current.currentTime = next / 1000
      } catch {
        // readyState 不够时会抛 InvalidStateError；先把 ref 推到目标，
        // 等 video metadata loaded 的下一帧自然对齐。
      }
    }
    elapsedRef.current = next
    lastTickWallRef.current = performance.now()
    setElapsed(next)
    failTriggeredRef.current = false
  }

  /**
   * 暂停 / 继续 —— 翻转 paused state。RAF 主循环在 deps=[paused] 变化时
   * 重新建立；video 的实际 pause/play 调用分两路：
   *   1) VIDEO 场景：操作 videoRef 的 pause()/play()
   *   2) 非 VIDEO：RAF 停转即"暂停"，不需要别的
   *
   * 切场景时 paused 不会自动复位（当前设计里 Player 整个组件仍活着），
   * 所以在这里显式：暂停态下切场景会保留暂停？—— 不会，useEffect(sceneId)
   * 会重置 elapsed/verdicts 等，但 paused 不重置。若发现体验不佳，可加到
   * scene 重置 effect 里。目前先按"最小变更"处理。
   */
  function handleTogglePause(): void {
    setPaused((p) => {
      const next = !p
      // v3 · 多 shot 切镜：当前 shot 的 <video> 也挂在 videoRef 上（即使
      // scene.media.kind 不是 VIDEO）。改为「只要有挂载的 <video> 就 pause/play」，
      // null-guard 保证图像场景（videoRef.current 为空）无副作用。
      if (videoRef.current) {
        try {
          if (next) videoRef.current.pause()
          else void videoRef.current.play().catch(() => { /* autoplay policy */ })
        } catch {
          /* readyState 不够，忽略 */
        }
      }
      // 恢复播放时刷新墙钟基准，避免把暂停期间的"墙钟 delta"补进 elapsed
      if (!next) lastTickWallRef.current = performance.now()
      return next
    })
  }

  useEffect(() => {
    if (!scene) return
    sceneStartedAtRef.current = performance.now()
    lastTickWallRef.current = performance.now()
    elapsedRef.current = 0
    failTriggeredRef.current = false
    // 同步清空 verdictsRef，避免 RAF 第一帧仍读到上一场景的 verdicts —— setVerdicts([])
    // 是异步的，要等下一次 render 才会反映到 verdictsRef.current 的同步赋值。
    verdictsRef.current = []
    setElapsed(0)
    setVerdicts([])
    setChoiceOpen(false)
    setEndingScreen(false)
    setSettlement(null)
    setSlowMo({ active: false, rate: 1, activeCueId: null, windowProgress: 0 })
    setActiveMinigame(null)
    triggeredMinigamesRef.current = new Set()
    setActiveSearch(null)
    completedSearchRef.current = new Set()
    // 进新场景时把 video 的速率/currentTime 复位
    if (videoRef.current) {
      try {
        videoRef.current.playbackRate = 1
        videoRef.current.currentTime = 0
      } catch {
        // 视频未 metadata 就绪：保持默认行为
      }
    }
    setVisited((prev) => (prev.includes(sceneId) ? prev : [...prev, sceneId]))
    // 数值系统：进入节点的数值副作用（如「经过这一节点 +好感」）。
    // 用 appliedEnterRef 去重，保证每个 sceneId 一轮游玩只累加一次。
    const hasEnterVar = scene.onEnterEffects && scene.onEnterEffects.length > 0
    const hasEnterItem = scene.onEnterItemEffects && scene.onEnterItemEffects.length > 0
    if ((hasEnterVar || hasEnterItem) && !appliedEnterRef.current.has(sceneId)) {
      appliedEnterRef.current.add(sceneId)
      if (hasEnterVar) {
        const effects = scene.onEnterEffects!
        setVars((v) => applyEffects(effects, v, scenario))
      }
      if (hasEnterItem) {
        const itemEffects = scene.onEnterItemEffects!
        setOwnedItems((o) => applyItemEffects(itemEffects, o))
      }
    }
  }, [sceneId, scene, resetTick, scenario])

  /**
   * v3.8 · 下一幕视频预拉 —— 大视频切换"卡顿等待"的关键优化。
   *
   * 背景：
   *   - 单幕视频可达 227 MiB；切下一幕时才开始下载，用户感觉明显卡顿
   *   - vite 服务端已支持 HTTP Range + `Cache-Control: immutable`
   *     → 后台用 fetch 提前拉"头几 MB"进浏览器 HTTP 缓存
   *     → 选项卡片里 `<video preload="metadata">` 秒出首帧；真正切幕时 `<video>`
   *       命中缓存的头部，再边播边后台继续补全
   *
   * 策略（v3.8.2 调优）：
   *   - 进入 scene 后 500ms 启动（之前 2s 太慢，选项弹出时还没拉到）
   *   - 两阶段：
   *     Phase 1：仅拉"头 3 MB"（Range: bytes=0-3145727），覆盖 mp4 moov + 几秒画面，
   *              足以让 ChoiceLayer 的 preview video 和切幕首帧秒开
   *     Phase 2：Phase 1 完成后继续拉"尾部直到 EOF"，让播放时不用再下载
   *   - 并发而非串行（branches 通常 2-3 条，一起发）
   *   - 已预拉过的 url 去重
   *   - cleanup: 切下一 scene 前 abort 全部
   */
  useEffect(() => {
    if (!scene) return
    const timer = setTimeout(() => {
      const scenario = useScenarioStore.getState().scenario
      const mediaEntries = useMediaStore.getState().entries
      const branches = scene.branches ?? []
      const urls: string[] = []
      for (const b of branches) {
        const target = scenario.scenes[b.targetSceneId]
        if (!target || target.media.kind !== 'VIDEO') continue
        const mref = target.media.ref
        if (!mref) continue
        const entry = mediaEntries[mref]
        if (!entry) continue
        // 只预拉走 HTTP 的资产（/__reel__/assets/...）；blob: / data: 已在本地
        if (!entry.url.startsWith('/__reel__/assets/')) continue
        if (prefetchedUrlsRef.current.has(entry.url)) continue
        urls.push(entry.url)
        prefetchedUrlsRef.current.add(entry.url)
      }
      if (urls.length === 0) return

      const controller = new AbortController()
      prefetchControllersRef.current.push(controller)

      // 并发跑所有分支；每条先拉 Phase 1（头 3MB），再 Phase 2（剩余部分）
      const HEAD_BYTES = 3 * 1024 * 1024 - 1 // 3 MiB 头部，够 mp4 moov + 几秒画面
      void Promise.all(
        urls.map(async (url) => {
          if (controller.signal.aborted) return
          try {
            // Phase 1: 头 3MB —— 触发浏览器缓存条目、让 ChoiceLayer preview 秒出
            await fetch(url, {
              cache: 'force-cache',
              signal: controller.signal,
              headers: { Range: `bytes=0-${HEAD_BYTES}` },
              priority: 'low',
            })
          } catch {
            // 网络抖动 / 取消：静默；下次 scene 再尝试
            return
          }
          if (controller.signal.aborted) return
          try {
            // Phase 2: 全量（浏览器会按 HTTP 缓存的增量拉 moov 之外的 mdat）
            // cache: 'force-cache' 让已有部分不重下；Range: undefined 让浏览器自行决定
            await fetch(url, {
              cache: 'force-cache',
              signal: controller.signal,
              priority: 'low',
            })
          } catch {
            /* ignore */
          }
        }),
      )
    }, 500)

    return () => {
      clearTimeout(timer)
      // 切到下一 scene 时把还在飞的预拉全部 abort，省带宽
      for (const c of prefetchControllersRef.current) c.abort()
      prefetchControllersRef.current = []
    }
  }, [sceneId, scene])

  useEffect(() => {
    if (!scene) return
    if (paused) return
    if (activeMinigame) return
    if (activeSearch) return
    const duration = scene.durationMs
    const effectiveEnd = computeEffectiveEndMs(scene)
    const isVideo = scene.media.kind === 'VIDEO'

    /**
     * 性能：原实现每帧（~60Hz）都 setElapsed，引发整棵 Player 子树
     * 跟着每秒重渲数十次。Player 内 elapsed 唯一的"消费者"是 DialogueBox
     * 找当前活跃台词（秒级粒度即可）和 QTEOverlay 判断 cue 进度 / 是否过期
     * （需要 sub-frame 精度，但 ~30ms 误差对玩家完全不可感）。
     *
     * 折中：rAF 内仍然每帧推进 ref（保证下次 setState 时拿到最新值），
     * 但 setState 限频 33ms（约 30Hz），让 React 提交频次降到一半。
     * 场景结束的最后一帧无论如何都强制 commit 一次。
     *
     * 慢放新增：每帧都解算 slowMo 并写 video.playbackRate；setSlowMo 同样限频。
     */
    const COMMIT_INTERVAL_MS = 33
    let lastCommitElapsed = -COMMIT_INTERVAL_MS
    let lastSlowSig = ''

    function step(): void {
      const now = performance.now()
      const dt = Math.max(0, now - lastTickWallRef.current)
      lastTickWallRef.current = now

      // 1) 解算当前应有的播放速率（基于上一帧 elapsed 已足够，误差一帧不可感）
      const cues = scene!.qte?.cues ?? []
      const window = scene!.qte?.window ?? { perfect: 80, great: 160, good: 280 }
      const slow = resolveActiveSlowMo(
        cues,
        window,
        verdictsRef.current,
        elapsedRef.current,
      )
      const rate = slow.active ? slow.rate : 1

      // 2) 推进 elapsed —— VIDEO 场景以 video.currentTime 为真源；其他场景墙钟 × rate
      if (isVideo && videoRef.current) {
        try {
          if (Math.abs(videoRef.current.playbackRate - rate) > 0.001) {
            videoRef.current.playbackRate = rate
          }
        } catch {
          // ignore
        }
        const ct = videoRef.current.currentTime
        if (Number.isFinite(ct) && ct >= 0) {
          elapsedRef.current = Math.min(duration, ct * 1000)
        } else {
          elapsedRef.current = Math.min(duration, elapsedRef.current + dt * rate)
        }
      } else {
        elapsedRef.current = Math.min(duration, elapsedRef.current + dt * rate)
      }
      const e = elapsedRef.current
      // 场景结束判定：以 effectiveEndMs 为准。
      // 理由：作者的 scene.durationMs 常常是默认 30s，但实际拖入的视频/分镜
      // 可能只有 10s；等满 30s 再 end 会让玩家空坐 20s。effectiveEndMs 给出
      // "画面轨都播完了"的那一刻（无有时长 shot 时退化 = durationMs，保持旧行为）。
      const reachedEnd = e >= effectiveEnd

      // 3) 限频 commit elapsed
      if (reachedEnd || e - lastCommitElapsed >= COMMIT_INTERVAL_MS) {
        lastCommitElapsed = e
        setElapsed(e)
      }

      // 4) commit slowMo（签名变了再 setState，避免每帧重渲 HUD）
      const sig = `${slow.active ? 1 : 0}|${slow.activeCueId ?? ''}|${slow.rate.toFixed(3)}|${(slow.windowProgress * 1000).toFixed(0)}`
      if (sig !== lastSlowSig) {
        lastSlowSig = sig
        setSlowMo(slow)
      }

      // 5) fail 检测：只触发一次，否则会反复弹结算
      if (!failTriggeredRef.current) {
        const failed = firstFailedSlowMoCue(
          cues,
          window,
          verdictsRef.current,
          e,
        )
        if (failed) {
          failTriggeredRef.current = true
          rafRef.current = null
          handleSlowMoFail(failed)
          return
        }
      }

      // 6) 小游戏触发检测：到达某个未触发过的 minigame clip 的 startMs → 暂停
      {
        const mg = nextMinigameToTrigger({
          clips: scene!.minigames ?? [],
          elapsedMs: e,
          triggeredIds: triggeredMinigamesRef.current,
        })
        if (mg) {
          triggeredMinigamesRef.current.add(mg.id)
          console.log('[Player] minigame trigger (inline)', { id: mg.id, minigameId: mg.minigameId, startMs: mg.startMs, elapsedMs: e })
          // 把 video 停住（若是 VIDEO 场景），切 activeMinigame → 触发 overlay
          if (isVideo && videoRef.current) {
            try {
              videoRef.current.pause()
            } catch { /* 还没 ready */ }
          }
          rafRef.current = null
          setActiveMinigame(mg)
          return
        }
      }

      // 6.5) 搜索段触发检测：到达某未完成搜索段 startMs → 定格循环 + 进搜查态
      {
        const sg = nextSearchToTrigger({
          clips: scene!.searchSegments ?? [],
          elapsedMs: e,
          completedIds: completedSearchRef.current,
        })
        if (sg) {
          if (isVideo && videoRef.current) {
            try {
              // 跳到循环段起点定格，等待玩家搜寻
              videoRef.current.currentTime = (sg.loopStartMs ?? sg.startMs) / 1000
              videoRef.current.pause()
            } catch { /* 还没 ready */ }
          }
          rafRef.current = null
          setActiveSearch(sg)
          setSearching(true)
          return
        }
      }

      if (!reachedEnd) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
        // scene 正常播完之前：先弹所有未触发过的 minigame（它们可能被作者
        // 放在 effectiveEnd 之后的时间点，正常 step 轨道永远打不到）
        const pending = pendingMinigamesAtEnd({
          clips: scene!.minigames ?? [],
          triggeredIds: triggeredMinigamesRef.current,
        })
        if (pending) {
          triggeredMinigamesRef.current.add(pending.id)
          console.log('[Player] minigame trigger (scene-end gate)', { id: pending.id, minigameId: pending.minigameId, startMs: pending.startMs })
          if (isVideo && videoRef.current) {
            try { videoRef.current.pause() } catch { /* ignore */ }
          }
          setActiveMinigame(pending)
          return
        }
        console.log('[Player] scene end (no pending minigame)', { sceneId, effectiveEnd })
        handleSceneEnd()
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, paused, resetTick, activeMinigame, activeSearch])

  /** 搜索段结束 → 标记完成、视频跳到段末继续播放、退出搜查态。 */
  function resumeFromSearch(sg: SearchSegmentClip): void {
    completedSearchRef.current.add(sg.id)
    setSearching(false)
    setActiveSearch(null)
    elapsedRef.current = Math.max(elapsedRef.current, sg.endMs)
    const v = videoRef.current
    if (scene?.media.kind === 'VIDEO' && v) {
      try {
        v.currentTime = sg.endMs / 1000
        void v.play().catch(() => {})
      } catch {
        /* 还没 ready */
      }
    }
  }

  // 搜索段进行中：把视频在 [loopStart, loopEnd] 之间循环（首尾相同的静态可循环段）
  useEffect(() => {
    if (!activeSearch) return
    if (scene?.media.kind !== 'VIDEO') return
    const v = videoRef.current
    if (!v) return
    const loopStart = (activeSearch.loopStartMs ?? activeSearch.startMs) / 1000
    const loopEnd = (activeSearch.loopEndMs ?? activeSearch.endMs) / 1000
    let raf = 0
    const tick = (): void => {
      if (v.paused) void v.play().catch(() => {})
      if (v.currentTime >= loopEnd || v.currentTime < loopStart - 0.05) {
        try {
          v.currentTime = loopStart
        } catch {
          /* ignore */
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [activeSearch, scene])

  // 搜索段完成检测：本段热点按完成条件搜完 → 自动续播
  useEffect(() => {
    if (!activeSearch || !scene) return
    const hs = segmentHotspots(activeSearch, scene.searchLoot ?? [])
    if (isSegmentComplete(activeSearch, scene.id, hs, lootedKeys)) {
      resumeFromSearch(activeSearch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSearch, lootedKeys, scene])

  function handleSceneEnd(): void {
    if (!scene) return

    // 场景结束时只要有「可见」choice 分支就弹；不再用 showAt<=durationMs 过滤。
    // 数值系统：条件不满足且 gateMode='hide' 的 choice 视为不可见；若所有 choice
    // 都被隐藏，则继续往下走 auto / qte / FIN，避免弹出空选择层卡死。
    const evalCtx = {
      vars: varsRef.current,
      visitedSceneIds: new Set(visitedRef.current),
      ownedItems: ownedItemsRef.current,
    }
    const hasVisibleChoice = scene.branches.some(
      (b) =>
        b.kind === 'choice' &&
        (isBranchAvailable(b, evalCtx) || (b.gateMode ?? 'hide') === 'lock'),
    )
    if (hasVisibleChoice) {
      // 弹选择时把 VIDEO 场景定格：这样 ChoiceLayer 的半透黑玻璃背后仍有
      // 画面可看，玩家在剧情关键点能看清"在哪儿做抉择"，避免背景一片黑。
      // effectiveEnd 可能早于 video duration（短素材占长 scene 的情况），
      // 这时视频仍在播——必须显式 pause 才能定格。
      if (scene.media.kind === 'VIDEO' && videoRef.current) {
        try { videoRef.current.pause() } catch { /* ignore */ }
      }
      setChoiceOpen(true)
      return
    }

    const auto = scene.branches.find((b) => b.kind === 'auto')
    if (auto) {
      navigateTo(auto.targetSceneId)
      return
    }

    if (scene.qte && scene.branches.some((b) => b.kind === 'qte_pass' || b.kind === 'qte_fail')) {
      const run = tallyQTE(scene.qte, verdictsRef.current)
      const targetBranch = scene.branches.find((b) =>
        run.passed ? b.kind === 'qte_pass' : b.kind === 'qte_fail',
      )
      if (targetBranch) {
        navigateTo(targetBranch.targetSceneId)
        return
      }
    }
    setEndingScreen(true)
  }

  function handleSlowMoFail(cue: QTECue): void {
    if (!scene) return
    // 失败时把视频暂停 + 速率复位 —— 给玩家一个清晰停顿
    if (videoRef.current) {
      try {
        videoRef.current.playbackRate = 1
        videoRef.current.pause()
      } catch {
        // ignore
      }
    }
    // 优先级：cue.failSceneId > scene.branches.qte_fail > 通用结算屏
    const explicit = cue.slowMo?.failSceneId
    if (explicit && scenario.scenes[explicit]) {
      navigateTo(explicit)
      return
    }
    const failBranch = scene.branches.find((b) => b.kind === 'qte_fail')
    if (failBranch && scenario.scenes[failBranch.targetSceneId]) {
      navigateTo(failBranch.targetSceneId)
      return
    }
    setSettlement({ failedCue: cue })
  }

  function handleCueResolve(cue: QTECue, verdict: HitVerdict): void {
    setVerdicts((prev) =>
      prev.some((v) => v.cueId === cue.id) ? prev : [...prev, verdict],
    )
  }

  /**
   * 小游戏通关 —— 语义同 QTE 通过：
   *   1. 若 scene 有 qte_pass 分支 → 跳过去
   *   2. 否则直接走 scene.end（auto 分支 / choice 弹窗 / ending screen）
   */
  function handleMinigameWin(_event: MinigameEvent): void {
    if (!scene) return
    setActiveMinigame(null)
    const pass = scene.branches.find((b) => b.kind === 'qte_pass')
    if (pass && scenario.scenes[pass.targetSceneId]) {
      navigateTo(pass.targetSceneId)
      return
    }
    // 没有 pass 分支 → 当作"场景完成"走正常的 end 流程
    // （而不是让 video 继续播 —— 视频多半已经 ended）
    handleSceneEnd()
  }

  /**
   * 小游戏失败 —— 优先走 qte_fail 分支；没有的话就保留 overlay 供玩家重试。
   * （MinigameOverlay 本身已经提供内置"重来"按钮；调用方不关这个 overlay）
   */
  function handleMinigameLose(_event: MinigameEvent): void {
    if (!scene) return
    const fail = scene.branches.find((b) => b.kind === 'qte_fail')
    if (fail && scenario.scenes[fail.targetSceneId]) {
      setActiveMinigame(null)
      navigateTo(fail.targetSceneId)
      return
    }
    // 没配 fail 分支：保留 overlay（玩家可以继续重试或点"放弃"）
  }

  /**
   * 小游戏"放弃" —— 强制走 qte_fail 分支；没有 fail 分支则当作"跳过"继续 scene。
   */
  function handleMinigameAbort(): void {
    if (!scene) return
    setActiveMinigame(null)
    const fail = scene.branches.find((b) => b.kind === 'qte_fail')
    if (fail && scenario.scenes[fail.targetSceneId]) {
      navigateTo(fail.targetSceneId)
      return
    }
    // 无 fail 分支：当作"场景完成"走 end 流程，不重启视频
    handleSceneEnd()
  }

  /**
   * 解析进入门槛 —— 从 targetId 出发，按 entryGate 链式求值：
   *   - 条件满足 / 无门槛 → 返回该 scene。
   *   - 不满足 + redirect → 跳到改道目标继续解析（防环 + 限深）。
   *   - 不满足 + block（或改道目标缺失/成环）→ 返回 null（阻断进入）。
   *
   * varsOverride 用于「刚选完分支、效果还没异步落进 varsRef」的场景：
   * 用同步算好的 nextVars 求门槛，避免迟一拍误判。
   */
  function resolveGateTarget(
    targetId: string,
    varsOverride?: VarState,
    ownedOverride?: ItemState,
  ): { sceneId: string } | { blocked: true; hint?: string } {
    const ctx = {
      vars: varsOverride ?? varsRef.current,
      visitedSceneIds: new Set(visitedRef.current),
      ownedItems: ownedOverride ?? ownedItemsRef.current,
    }
    let cur = targetId
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const sc = scenario.scenes[cur]
      // scene 缺失交给上层「无可播放场景」兜底，这里直接放行。
      if (!sc || !sc.entryGate) return { sceneId: cur }
      const res = evaluateGate(sc.entryGate, ctx)
      if (res.allowed) return { sceneId: cur }
      if (res.redirectSceneId && !seen.has(res.redirectSceneId)) {
        seen.add(cur)
        cur = res.redirectSceneId
        continue
      }
      return { blocked: true, hint: res.hint }
    }
    return { sceneId: cur }
  }

  /**
   * 门槛感知的换场 —— 所有「剧情推进型」跳转都走这里（分支/auto/QTE/小游戏/失败改道）。
   * 被阻断时停在当前场景并弹出瞬时提示，不让玩家凭空消失。
   * 作者调试用的 PlayerMenu「跳到场景」与 restart 不走门槛（保留自由跳转）。
   */
  function navigateTo(
    targetId: string,
    varsOverride?: VarState,
    ownedOverride?: ItemState,
  ): void {
    const r = resolveGateTarget(targetId, varsOverride, ownedOverride)
    if ('blocked' in r) {
      setGateNotice(r.hint ?? '条件不足，暂时无法进入这一节点')
      return
    }
    setSceneId(r.sceneId)
  }

  function takeBranch(branch: Branch): void {
    setChoiceOpen(false)
    // 数值系统：选中分支的副作用（如「安慰她 → 好感+10」）先落地再跳转。
    // 同步算出 nextVars 既写回 state，又喂给门槛求值，避免「刚 +的好感」这一拍读不到。
    let nextVars = varsRef.current
    if (branch.effects && branch.effects.length > 0) {
      nextVars = applyEffects(branch.effects, varsRef.current, scenario)
      setVars(nextVars)
    }
    // 背包系统：选中分支的物品增减（如「用钥匙开门 → 消耗钥匙」）同步落地再喂门槛。
    let nextOwned = ownedItemsRef.current
    if (branch.itemEffects && branch.itemEffects.length > 0) {
      nextOwned = applyItemEffects(branch.itemEffects, ownedItemsRef.current)
      setOwnedItems(nextOwned)
    }
    navigateTo(branch.targetSceneId, nextVars, nextOwned)
  }

  /** 搜索拾取：把热点对应物品入袋、标记已拾取，并弹出获得提示。 */
  function handlePickup(hotspot: SearchHotspot): void {
    const key = `${sceneId}:${hotspot.id}`
    if (lootedRef.current.has(key)) return
    setLootedKeys((s) => new Set(s).add(key))
    setOwnedItems((o) =>
      applyItemEffects([{ itemId: hotspot.itemId, op: 'give', count: 1 }], o),
    )
    const itemName = scenario.items?.[hotspot.itemId]?.name ?? '物品'
    setGateNotice(`获得「${itemName}」`)
  }

  function replayScene(): void {
    setResetTick((t) => t + 1)
  }

  function restart(): void {
    setVisited([scenario.rootSceneId])
    // 数值系统：从头玩 → 数值复位到初始、清空「进入效果已应用」记录，
    // 这样 root 的 onEnterEffects 会在重进时重新累加一次。
    setVars(initVarState(scenario))
    // 背包系统：从头玩 → 清空已拾取物品与搜索去重记录。
    setOwnedItems({})
    setLootedKeys(new Set())
    setSearching(false)
    setActiveSearch(null)
    completedSearchRef.current = new Set()
    appliedEnterRef.current = new Set()
    if (sceneId === scenario.rootSceneId) {
      setResetTick((t) => t + 1)
    } else {
      setSceneId(scenario.rootSceneId)
    }
  }

  /**
   * v3.8.4 · 回到上一个分叉点 —— FIN 页替代"重新开始"的主按钮。
   *
   * 语义：从**剧本拓扑**反查（而不是 visited 访问历史），找"能到达当前 scene
   * 的最近一个有 choice 的祖先 scene"。
   *
   * 为什么不用 visited：
   *   - 用户可能通过 PlayerMenu 的"跳转到场景"直接进到死路分支，
   *     visited 不包含真正的路径前驱，会误判"没 choice 可回"
   *   - 剧本锻造时就知道 choice 节点在哪，按拓扑反查最权威
   *
   * 算法（BFS 反向）：
   *   - 构建 child→parent 映射：遍历所有 scene.branches，target→source
   *   - 从当前 sceneId 开始反向 BFS，遇到第一个 branches 含 choice 的祖先 → 返回
   *   - 找不到（root 也没 choice 祖先，或 scene 孤立）→ null
   */
  function findNearestChoiceAncestor(startId: string): string | null {
    const scenes = scenario.scenes
    // 反向邻接：targetSceneId → 指向它的 source scene id 集合
    const parents: Record<string, string[]> = {}
    for (const s of Object.values(scenes)) {
      for (const b of s.branches ?? []) {
        const t = b.targetSceneId
        if (!t) continue
        if (!parents[t]) parents[t] = []
        parents[t]!.push(s.id)
      }
    }
    // BFS 向上找
    const visited = new Set<string>([startId])
    const queue: string[] = [...(parents[startId] ?? [])]
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (visited.has(cur)) continue
      visited.add(cur)
      const s = scenes[cur]
      if (s?.branches?.some((b) => b.kind === 'choice')) return cur
      for (const p of parents[cur] ?? []) {
        if (!visited.has(p)) queue.push(p)
      }
    }
    return null
  }

  function jumpToLastChoice(): void {
    const choiceId = findNearestChoiceAncestor(sceneId)
    if (!choiceId) {
      // 剧本拓扑上也没有 choice 祖先 → 退化为重新开始
      restart()
      return
    }
    // 截断 visited 到那一幕（如果存在则截断，不存在则忽略；新路径会自己 append）
    setVisited((prev) => {
      const idx = prev.lastIndexOf(choiceId)
      if (idx < 0) return [choiceId]
      return prev.slice(0, idx + 1)
    })
    setEndingScreen(false)
    setSceneId(choiceId)
  }

  function exit(): void {
    // activeTab 是唯一真相源（App 里 mode 已改为由 activeTab 单向派生）。
    // 退出试玩 = 切回锻造台；mode 会被 App 的 activeTab→mode effect 镜像成
    // 'editor'。这里同时直接 setMode('editor') 让旧 mode 读者立刻拿到正确值。
    useShellStore.getState().setActiveTab('forge')
    setMode('editor')
  }

  if (!scene) {
    if (playerOnly && !loadTimedOut) {
      return <div className="ks-player-empty">加载中…</div>
    }
    return <div className="ks-player-empty">无可播放场景</div>
  }

  // 背包系统：仅当模块开启时叠加搜查/HUD。当前场景还有未拾取热点才显示放大镜。
  const inventoryEnabled = isModuleEnabled(scenario, 'inventory')
  const hasUnlootedHere = (scene.searchLoot ?? []).some(
    (h) => !lootedKeys.has(`${scene.id}:${h.id}`),
  )
  // 搜索段进行中：把搜寻热点限定为本段参与的热点。
  const searchHotspotFilter = activeSearch
    ? new Set(segmentHotspots(activeSearch, scene.searchLoot ?? []).map((h) => h.id))
    : undefined

  return (
    <div className="ks-player">
      <SceneCanvas
        scene={scene}
        videoRef={videoRef}
        currentMs={elapsed}
        // v3.8 · 视频自然结束兜底 —— scene.durationMs 可能略大于视频实际可播时长
        // （例如作者填 36502，但素材只有 36156ms），此时 RAF 的
        // `elapsed = min(durationMs, video.currentTime*1000)` 永远摸不到
        // durationMs → handleSceneEnd 不被触发 → auto/choice 永不出现 → 卡住。
        // 只要视频本身 ended，立刻推进。但要跳过已经在交互态的情况
        // （choice 已弹、minigame 激活、settlement 已弹）——这些态下 scene 已经
        // "冻结"在结束点，不该被 video ended 再次穿透。
        onVideoEnded={() => {
          if (choiceOpen || activeMinigame || settlement || endingScreen) return
          handleSceneEnd()
        }}
      />

      {showSubtitles && <DialogueBox scene={scene} elapsed={elapsed} />}

      {txtTrackVisible && <TextOverlayLayer scene={scene} elapsed={elapsed} />}

      {scene.qte && (
        <QTEOverlay
          spec={scene.qte}
          elapsed={elapsed}
          verdicts={verdicts}
          ambientClass={qteOverlayAmbientClass(scene)}
          onResolve={(cue, deltaMs, holdMs) => {
            const v =
              cue.shape === 'hold'
                ? judgeHold(cue, scene.qte!.window, scene.qte!.score, deltaMs, holdMs ?? 0)
                : judgeTap(cue, scene.qte!.window, scene.qte!.score, deltaMs)
            handleCueResolve(cue, v)
          }}
        />
      )}

      {slowMo.active && <SlowMoHUD state={slowMo} />}

      {gateNotice && (
        <div className="ks-gate-notice" role="status" aria-live="polite">
          <span className="ks-gate-notice-ico" aria-hidden>
            {gateNotice.startsWith('获得') ? '🎒' : '⛔'}
          </span>
          {gateNotice}
        </div>
      )}

      {inventoryEnabled && (
        <>
          <SearchLayer
            scene={scene}
            items={scenario.items ?? {}}
            lootedKeys={lootedKeys}
            active={(searching || !!activeSearch) && !choiceOpen && !activeMinigame && !endingScreen}
            hotspotFilter={searchHotspotFilter}
            onPickup={handlePickup}
          />
          <InventoryHUD
            items={scenario.items ?? {}}
            owned={ownedItems}
            canSearch={hasUnlootedHere && !activeSearch}
            searching={searching}
            onToggleSearch={() => setSearching((v) => !v)}
          />
        </>
      )}

      {activeSearch && (
        <div className="ks-search-banner" role="status" aria-live="polite">
          <span className="ks-search-banner-ico" aria-hidden>🔍</span>
          <span className="ks-search-banner-txt">
            {activeSearch.label || '仔细搜寻画面中的可疑之处'}
          </span>
          {activeSearch.allowSkip && (
            <button
              type="button"
              className="ks-search-banner-skip"
              onClick={() => resumeFromSearch(activeSearch)}
            >
              跳过 ›
            </button>
          )}
        </div>
      )}

      {choiceOpen && (
        <ChoiceLayer
          scene={scene}
          onPick={takeBranch}
          vars={vars}
          visitedSceneIds={visited}
          ownedItems={ownedItems}
        />
      )}

      {activeMinigame && (
        <MinigameOverlay
          clip={activeMinigame}
          onWin={handleMinigameWin}
          onLose={handleMinigameLose}
          onAbort={handleMinigameAbort}
        />
      )}

      {settlement && (
        <SettlementOverlay
          score={tallyQTE(scene.qte ?? defaultQTESpec(), verdictsRef.current).total}
          failedLabel={settlement.failedCue.label ?? settlement.failedCue.shape}
          onReplay={() => {
            setSettlement(null)
            replayScene()
          }}
          onBackEditor={exit}
        />
      )}

      {endingScreen && (() => {
        // v3.8.4 · FIN 页语义：
        //   - 真结局（scene.isEnding === true，作者明确设为结局）→ "回到起点"
        //   - 断头但剧本拓扑上能找到 choice 祖先 → "换条路走"
        //   - 断头且剧本拓扑上整条全 auto（极端）→ 退化"回到起点"
        //
        // 为什么不用 visited：PlayerMenu 的"跳转到场景"功能会让 visited 只含
        // 当前幕本身，漏掉真正的路径前驱。按剧本拓扑反查更权威。
        const isRealEnding = scene.isEnding === true
        const hasChoiceAncestor = !isRealEnding && findNearestChoiceAncestor(scene.id) !== null
        const mode = isRealEnding
          ? 'ending'
          : hasChoiceAncestor
            ? 'deadend-has-choice'
            : 'deadend-no-choice'
        // 诊断日志
        // eslint-disable-next-line no-console
        console.info('[reel-player] FIN decision', {
          sceneId: scene.id,
          title: scene.title,
          isEnding: scene.isEnding,
          hasChoiceAncestor,
          mode,
          visited: [...visited],
        })
        return (
          <EndingScreen
            mode={mode}
            onJumpLastChoice={jumpToLastChoice}
            onReplay={restart}
            onBackEditor={exit}
          />
        )
      })()}

      <PlayerMenu
        scenarioTitle={scenario.title}
        currentSceneTitle={scene.title}
        currentSceneId={scene.id}
        visitedSceneIds={visited}
        onJumpScene={(id) => setSceneId(id)}
        onHome={exit}
        onReplayScene={replayScene}
        onRestart={restart}
        onExit={exit}
        subtitlesVisible={showSubtitles}
        onToggleSubtitles={toggleSubtitles}
      />

      <PlaybackControls
        paused={paused}
        onSeekBy={handleSeekBy}
        onTogglePause={handleTogglePause}
      />

    </div>
  )
}

function defaultQTESpec(): {
  cues: QTECue[]
  window: { perfect: number; great: number; good: number }
  score: { perfect: number; great: number; good: number; miss: number }
} {
  return {
    cues: [],
    window: { perfect: 80, great: 160, good: 280 },
    score: { perfect: 100, great: 60, good: 25, miss: -30 },
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 多 shot 切镜（v3 · Player 落地）
//
// 当一个 scene 已经被分镜化（>= 2 个 shot，且各 shot 写了 startMs/endMs 时间码，
// 至少一个有 videoMediaRef/keyframeMediaRef），Player 不再只播 scene 级一张
// 代表帧/一条整场视频，而是**按当前播放时间在 shots 时间轴里切镜**：渲染落点
// shot 的 videoMediaRef（视频）或 keyframeMediaRef（图）。
//
// 设计要点（为什么安全）：
//   · 仅在 scene.media.kind !== 'VIDEO' 时启用 —— 已绑定整场视频的老剧本走旧分支，
//     完全向后兼容。
//   · 主时钟仍是 Player 顶层的 elapsed（墙钟驱动，因为 scene.media 非 VIDEO），
//     本层只做"按 elapsed 选当前镜"的纯渲染，不引入第二个时钟、不改场景结束判定
//     （结束仍由 computeEffectiveEndMs = 最晚 shot.endMs 决定）。
//   · 当前镜的 <video> 仍挂到共享 videoRef，全局暂停/继续照常生效。
// ─────────────────────────────────────────────────────────────────────────

/** 取出带合法时间码（endMs>startMs）的 shots，按 startMs 升序。 */
function timedShots(scene: Scene): Shot[] {
  return (scene.shots ?? [])
    .filter(
      (s) =>
        Number.isFinite(s.startMs) &&
        Number.isFinite(s.endMs) &&
        (s.endMs as number) > (s.startMs as number),
    )
    .slice()
    .sort((a, b) => (a.startMs as number) - (b.startMs as number))
}

/** 是否走多 shot 切镜：非整场视频 + >=2 个有时间码的 shot + 至少一镜有媒体。 */
function isMultiShotScene(scene: Scene): boolean {
  if (scene.media.kind === 'VIDEO') return false
  const shots = timedShots(scene)
  if (shots.length < 2) return false
  return shots.some((s) => s.videoMediaRef || s.keyframeMediaRef)
}

/**
 * 按当前播放时间选落点 shot：命中 [startMs,endMs) 的镜；落在镜间空隙 / 首镜前 /
 * 末镜后返回 undefined —— 调用方据此渲染黑场（留白）。
 *
 * 历史（2026-06 作者反馈「中间剪空了还在正常播」）：过去空隙就近夹到首/末镜，
 * 导致作者剪出的空档、把镜头挪到后面留出的留白，全被相邻镜头顶上，看起来像「没生效」。
 * 现在严格按时间码取镜，空隙=黑场，所见即所得。
 */
function resolveActiveShot(scene: Scene, currentMs: number): Shot | undefined {
  const shots = timedShots(scene)
  if (shots.length === 0) return undefined
  for (const s of shots) {
    if (currentMs >= (s.startMs as number) && currentMs < (s.endMs as number)) return s
  }
  return undefined
}

function MultiShotLayer({
  scene,
  currentMs,
  videoRef,
  onLastShotEnded,
}: {
  scene: Scene
  currentMs: number
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  onLastShotEnded?: () => void
}) {
  const entries = useMediaStore((s) => s.entries)
  const shots = timedShots(scene)
  const active = resolveActiveShot(scene, currentMs)
  // 落在镜间空隙 / 首镜前 / 末镜后:渲染纯黑场 —— 尊重作者在时间轴上剪出的留白。
  if (!active) {
    return <div className="ks-player-gap" aria-hidden />
  }
  const isLast = active.id === shots[shots.length - 1]?.id
  const videoUrl = active.videoMediaRef ? entries[active.videoMediaRef]?.url : undefined
  const imgUrl = active.keyframeMediaRef ? entries[active.keyframeMediaRef]?.url : undefined

  if (videoUrl) {
    return (
      <PlayerVideo
        key={active.id}
        videoRef={videoRef}
        src={videoUrl}
        // 仅末镜自然播完时上抛场景结束兜底（与单视频分支同义）；中间镜结束由
        // 主时钟切到下一镜，不触发场景跳转。
        onEnded={isLast ? onLastShotEnded : undefined}
      />
    )
  }
  if (imgUrl) {
    return (
      <img
        key={active.id}
        className="ks-player-img"
        src={imgUrl}
        alt={scene.title}
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      />
    )
  }
  return (
    <div className={placeholderBgClass('idle')}>
      <div className="ks-player-bg-strip" />
    </div>
  )
}

export function SceneCanvas({
  scene,
  videoRef,
  currentMs = 0,
  onVideoEnded,
}: {
  scene: Scene
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  /** 当前场景已播放时长（ms）—— 多 shot 切镜按它在 shots 时间轴里选当前镜。 */
  currentMs?: number
  onVideoEnded?: () => void
}) {
  const mediaEntry = useMediaStore((s) =>
    scene.media.kind === 'VIDEO' && scene.media.ref
      ? s.entries[scene.media.ref]
      : undefined,
  )
  // 轨头眼睛(trackPrefs):隐藏的特效/贴纸轨在试玩画面里也不叠。
  const fxTrackVisible = useTrackPrefsStore((s) => s.prefs.fx.visible)
  const stkTrackVisible = useTrackPrefsStore((s) => s.prefs.stk.visible)
  const multiShot = isMultiShotScene(scene)
  const imgClient = useMemo<ImageClient>(() => createImageProvider(), [])
  const cacheRecord = useSceneImageCache((s) => s.records[scene.id])
  const ensure = useSceneImageCache((s) => s.ensure)

  useEffect(() => {
    if (scene.media.kind !== 'IMAGE_PROMPT' || !scene.media.prompt) return
    void ensure(scene.id, scene.media.prompt, imgClient)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id, scene.media.prompt])

  // v3 · shot 切镜已落地：当 scene 被分镜化（>=2 个带时间码的 shot、至少一镜有
  //   媒体且未绑定整场视频）时，改走 <MultiShotLayer>，按 currentMs 在 shots
  //   时间轴里切镜（视频优先 shot.videoMediaRef，回落 keyframeMediaRef）。
  //   否则继续走下面的 scene 级代表帧/整场视频分支（向后兼容）。
  //   相关代码：MultiShotLayer / editor/Timeline.tsx（SHOT 轨）/ scenario.setSceneShotKeyframe

  const dataUrl =
    cacheRecord?.status === 'ready' ? cacheRecord.dataUrl : undefined
  const isPending = cacheRecord?.status === 'pending'
  const isError = cacheRecord?.status === 'error'

  /*
   * 长文本分段管线 · 三态装饰（id: p3-player）
   *
   *   - skeleton       Act 骨架已落 store，此节点 prompts 尚空
   *                   → 画面层叠"骨架占位"动画 + 文案"剧情骨架就位 · 等 prompts"
   *   - prompts-ready  prompts 已注入，作者可以"生素材"了
   *                   → 右上角小标徽 "PROMPTS · 等素材"
   *   - assets-ready   关键帧 / 视频齐了
   *                   → 不再显示装饰（与普通节点一致）
   *
   * 选择条件渲染而不是改 placeholderBgClass：
   *   - 三态是非持久化运行时层；SceneStage 现有的 pending/error/idle 是另一回事（生图状态）
   *   - 三态信号即时性更强，作者切到"前 Act 预览"时希望第一时间看到"嗯，第三幕还在跑"
   */
  const streamingStatus = useScenarioStore(
    (s) => s.streaming?.nodeStatus[scene.id] ?? null,
  )
  const isSkeleton = streamingStatus === 'skeleton'
  const isPromptsReady = streamingStatus === 'prompts-ready'

  // 剪映式后期效果：媒体 filter/transform（CSS 变量注入）+ 抖动 wrapper class。
  const stageFx = composeStageFx(scene, currentMs, scene.durationMs)
  const canvasStyle = {
    '--ks-fx-filter': stageFx.mediaFilter || 'none',
    '--ks-fx-transform': stageFx.mediaTransform || 'none',
  } as React.CSSProperties

  return (
    <div
      className={`ks-player-canvas ${stageFx.wrapperClass}`}
      style={canvasStyle}
      // 防止浏览器把 <video>/<img>/<div bg-image> 当可拖资源拖走干扰 QTE
      // draggable=false 对 div 已经足够，子节点 <img>/<video> 单独再关一次
      onDragStart={(e) => e.preventDefault()}
    >
      {multiShot ? (
        <MultiShotLayer
          scene={scene}
          currentMs={currentMs}
          videoRef={videoRef}
          onLastShotEnded={onVideoEnded}
        />
      ) : scene.media.kind === 'VIDEO' && mediaEntry ? (
        <PlayerVideo videoRef={videoRef} src={mediaEntry.url} onEnded={onVideoEnded} />
      ) : dataUrl ? (
        <img
          className="ks-player-img"
          src={dataUrl}
          alt={scene.title}
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
        />
      ) : (
        <div
          className={placeholderBgClass(
            isPending ? 'pending' : isError ? 'error' : 'idle',
          )}
        >
          <div className="ks-player-bg-strip" />
        </div>
      )}
      {isSkeleton && (
        <div className="ks-player-skeleton" role="status" aria-live="polite">
          <div className="ks-player-skeleton-shimmer" />
          <div className="ks-player-skeleton-text">
            <div className="ks-player-skeleton-dot">◐</div>
            <div>
              <div className="ks-player-skeleton-title">剧情骨架就位</div>
              <div className="ks-player-skeleton-sub">
                正在为这一幕生成画面 / 分镜 / 视频提示词…
              </div>
            </div>
          </div>
        </div>
      )}
      {isPromptsReady && (
        <div
          className="ks-player-promptsbadge"
          role="status"
          aria-label="提示词已就绪，等待素材生成"
        >
          PROMPTS · 等素材
        </div>
      )}
      {/* 剪映式后期效果叠层：暗角/颗粒/特效 → 贴纸 → 渐显渐隐遮罩（默认黑底）
          特效/贴纸轨被轨头眼睛隐藏时不叠(与时间轴/预览一致)。 */}
      {fxTrackVisible && <FxOverlayLayer frame={stageFx} />}
      {stkTrackVisible && <StickerLayer scene={scene} ms={currentMs} />}
      <FadeLayer color={stageFx.fadeColor} opacity={stageFx.fadeOpacity} />
      <div className="ks-player-vignette" />
    </div>
  )
}

/*
 * PlayerVideo —— 带 autoplay 策略降级的视频层。
 *
 * 产品选择：作者希望"进场景=自动带声播放"。浏览器 autoplay 策略（Chrome/Safari/Firefox）
 * 要求要么 muted，要么该 origin 有过用户手势。玩家点"开始游玩"已经产生过一次手势，
 * 通常能过；但我们仍然做**双保险**：
 *
 *   1) 先按 unmuted 直接 load + play
 *   2) 如果 play() 抛 NotAllowedError，降级为 muted 再 play（一定能成），
 *      左上角显示"🔇 点击恢复声音"按钮；用户点一下就 unmute + 原位继续
 *
 * 实现要点：
 *   - video.muted 必须在**调 play 之前**设置好，否则"先 unmuted play 失败、
 *     再 muted play"这一跳里有一帧静音但还没定位，会少播一瞬间声音
 *   - autoPlay 属性本身我们不再用，改走手动 videoEl.play() 以便捕获 reject
 *   - key={src} 让 src 切换时 video 元素重建，避免上一场景视频缓存的 paused 状态
 */
function PlayerVideo({
  videoRef,
  src,
  onEnded,
}: {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
  src: string
  /**
   * 视频自然播完回调 —— 由 Player 顶层负责调 handleSceneEnd。
   *
   * 为什么不在 PlayerVideo 里直接判断 scene 结束：
   *   - scene 的切换/分支逻辑在 Player 里；PlayerVideo 只是 UI 层
   *   - Player 需要在 onEnded 时筛掉"已经弹了 choice/minigame"的情况
   */
  onEnded?: () => void
}) {
  const [needsUnmute, setNeedsUnmute] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    setNeedsUnmute(false)
    setLoadError(null)
    setStalled(false)
    v.muted = false
    v.volume = 1
    let cancelled = false

    async function tryPlay() {
      if (!v) return
      try {
        await v.play()
      } catch {
        if (cancelled) return
        // autoplay 策略拒绝带声播放 —— 降级为静音，保留"播"
        try {
          v.muted = true
          await v.play()
          if (!cancelled) setNeedsUnmute(true)
        } catch {
          // 连静音都被拒：极少见（无交互 iframe 场景），让用户手动点播放。
          if (!cancelled) setNeedsUnmute(true)
        }
      }
    }
    void tryPlay()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  function onUnmuteClick(): void {
    const v = videoRef.current
    if (!v) return
    v.muted = false
    v.volume = 1
    // 万一还处于 paused（极端降级分支）再 play 一次
    if (v.paused) {
      void v.play().catch(() => { /* 真不让播就算了 */ })
    }
    setNeedsUnmute(false)
  }

  return (
    <>
      <video
        key={src}
        ref={videoRef}
        className="ks-player-video"
        src={src}
        playsInline
        // preload="auto" 让浏览器尽早缓冲；大视频加载慢时 stalled/waiting 事件能被捕获
        preload="auto"
        // 禁用浏览器原生拖拽，避免拖走视频干扰上层 QTE
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        // 视频自然结束 → 上抛给 Player 触发 scene 切换
        // 真实场景：scene.durationMs 略大于视频实际可播时长（作者填 36502 但素材仅 36156ms），
        // 若不挂 onEnded，RAF 的 elapsed 永远摸不到 durationMs → scene 切换永不触发 → 卡死
        onEnded={() => onEnded?.()}
        // 网络/格式错误 → 提示作者"这个素材加载失败"，避免静默黑屏
        onError={() => {
          const e = videoRef.current?.error
          const code = e?.code ?? 0
          const msg =
            code === 1
              ? '视频加载中止'
              : code === 2
                ? '网络错误 · 视频加载失败'
                : code === 3
                  ? '视频解码失败 · 可能格式不支持'
                  : code === 4
                    ? '视频源无法获取 · 资产可能已失效'
                    : '视频加载失败'
          setLoadError(msg)
        }}
        // 缓冲不够 / 带宽不足 → 显示"加载中"提示，避免作者以为卡死
        onStalled={() => setStalled(true)}
        onWaiting={() => setStalled(true)}
        onPlaying={() => setStalled(false)}
        onCanPlay={() => setStalled(false)}
        // 不写 autoPlay，走 effect 手动 play 以便捕获 NotAllowedError
      />
      {loadError && (
        <div className="ks-player-video-error" role="alert">
          ⚠ {loadError}
        </div>
      )}
      {stalled && !loadError && (
        <div className="ks-player-video-stall" aria-live="polite">
          <span className="ks-player-video-stall-spinner" aria-hidden>⟳</span>
          <span>加载中…大视频需要多等一会</span>
        </div>
      )}
      {needsUnmute && (
        <button
          type="button"
          className="ks-player-unmute"
          onClick={onUnmuteClick}
          aria-label="恢复声音"
          title="浏览器拒绝自动带声播放 · 点击恢复声音"
        >
          <span aria-hidden>🔇</span>
          <span className="ks-mono">点击恢复声音</span>
        </button>
      )}
    </>
  )
}

function SlowMoHUD({ state }: { state: SlowMoState }) {
  const ratePct = `${state.rate.toFixed(2)}×`
  return (
    <div className="ks-slowmo">
      <div className="ks-slowmo-frame" />
      <div className="ks-slowmo-tag ks-mono">
        <span className="ks-slowmo-dot" />
        BULLET&nbsp;TIME&nbsp;·&nbsp;{ratePct}
      </div>
      <div className="ks-slowmo-bar">
        <div
          className="ks-slowmo-bar-fill"
          style={{ width: `${(1 - state.windowProgress) * 100}%` }}
        />
      </div>
    </div>
  )
}

function EndingScreen({
  mode,
  onJumpLastChoice,
  onReplay,
  onBackEditor,
}: {
  /**
   * v3.8.4 · FIN 页三种语义：
   *   - 'ending'                真结局（作者标了 scene.isEnding）→ 主按钮"回到起点"
   *   - 'deadend-has-choice'    断头 + 已走过 choice → 主按钮"换条路走"（回到最近分叉）
   *   - 'deadend-no-choice'     断头 + 整条全 auto → 主按钮退化成"回到起点"
   */
  mode: 'ending' | 'deadend-has-choice' | 'deadend-no-choice'
  /** 跳到最近一次有分叉选择的 scene；仅 'deadend-has-choice' 时会被调 */
  onJumpLastChoice: () => void
  onReplay: () => void
  onBackEditor: () => void
}) {
  // 结尾屏挂着时阻止电影模式 —— 玩家要点按钮，UI 必须可见
  useCinemaHold(true)

  const isJump = mode === 'deadend-has-choice'
  const primaryLabel = isJump ? '换条路走' : '回到起点'
  const primaryTitle = isJump
    ? '回到最近一个分叉点，选择另一条路线'
    : '从第一幕重新开始'
  const primaryOnClick = isJump ? onJumpLastChoice : onReplay

  return (
    <div className="ks-ending">
      <div className="ks-ending-title ks-cn" aria-label="FIN">
        <span className="ks-ending-letters">FIN</span>
        <span className="ks-ending-dot" aria-hidden />
      </div>
      <div className="ks-ending-actions">
        <button
          type="button"
          className="ks-ending-primary"
          onClick={primaryOnClick}
          title={primaryTitle}
        >
          {primaryLabel}
        </button>
        <button type="button" onClick={onBackEditor}>
          返回编辑器
        </button>
      </div>
    </div>
  )
}

const playerCss = `
.ks-player {
  position: relative;
  flex: 1;
  min-height: 0;
  background: #000;
  overflow: hidden;
  border-radius: var(--ks-radius-xl);
  box-shadow: var(--ks-shadow-lift);
}
.ks-player-empty {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: var(--ks-text-dim);
}
.ks-player-canvas {
  position: absolute; inset: 0;
  /*
   * 防止浏览器把 player 画面当"可选中 / 可拖资源"。没有这两行的话，
   * 玩家按住鼠标拖动就会触发 native drag（<img>/<video>/文本选择），
   * 覆盖在上面的 QTE 交互被抢走。
   */
  user-select: none;
  -webkit-user-select: none;
  -webkit-user-drag: none;
}
.ks-player-video, .ks-player-img {
  width: 100%; height: 100%;
  object-fit: cover;
  /* 即使 canvas 已关 user-drag，部分浏览器仍对 <img>/<video> 单独处理 */
  -webkit-user-drag: none;
  user-drag: none;
  pointer-events: none;
  /* 剪映式后期效果：滤镜/调节合成的 filter + 转场/首尾动画 transform（CSS 变量由 SceneCanvas 注入） */
  filter: var(--ks-fx-filter, none);
  transform: var(--ks-fx-transform, none);
}
/*
 * Unmute 按钮：autoplay 策略把视频降级为 muted 时浮出，点一下恢复声音。
 * 位置放左上角（避免挤对白/选项 UI）；颜色用琥珀主题，hover 稍亮。
 * pointer-events 自动；整个按钮做到手机也能点大一点。
 */
.ks-player-unmute {
  position: absolute;
  top: 18px;
  left: 18px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(12, 10, 8, 0.72);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 200, 128, 0.45);
  color: var(--ks-amber, #f0b661);
  font-size: 12px;
  letter-spacing: 0.08em;
  cursor: pointer;
  user-select: none;
  transition: background .18s ease, border-color .18s ease, transform .1s ease;
  animation: ks-player-unmute-pop 240ms ease-out both;
}
.ks-player-unmute:hover {
  background: rgba(28, 20, 12, 0.85);
  border-color: rgba(255, 200, 128, 0.75);
}
.ks-player-unmute:active {
  transform: scale(0.96);
}
@keyframes ks-player-unmute-pop {
  from { opacity: 0; transform: translateY(-4px) scale(0.95); }
  to   { opacity: 1; transform: translateY(0)    scale(1); }
}
.ks-player-bg {
  position: absolute; inset: 0;
  /* 中性低对比深色底 —— 没有图时尽量不抢戏，等真正画面进来 */
  background:
    radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.025), transparent 65%),
    #07090e;
  overflow: hidden;
}
.ks-player-bg.is-pending {
  /* 曾用青蓝径向渐变 + 4s 扫描条做"正在生成"动效 —— 切场景时就是"闪蓝"。
   * 现在换成静止的深灰底，只用配色暗示"空"；动态反馈改由 DialogueBox /
   * PlayerMenu 等独立 UI 承担，不再让整屏跟着脉动。 */
  background-image:
    radial-gradient(ellipse at 50% 50%, rgba(255, 255, 255, 0.025), transparent 60%),
    linear-gradient(135deg, #07090e, #0c1018);
}
.ks-player-bg.is-error {
  background-image:
    radial-gradient(ellipse at 50% 50%, rgba(251, 113, 133, 0.06), transparent 60%),
    linear-gradient(135deg, #07090e, #14090b);
}
.ks-player-bg-strip {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(255, 255, 255, 0.018) 50%,
    transparent 100%
  );
  /* 取消自动扫描 —— 周期性移动 = 视觉闪烁，占位底必须静止 */
  animation: none;
}
.ks-player-vignette {
  position: absolute; inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse at 50% 50%, transparent 50%, rgba(0,0,0,0.8) 100%);
}
/* 镜间空隙(留白)：纯黑场，对标剪映时间轴上「没有片段」的那一段播放时显黑。 */
.ks-player-gap {
  position: absolute; inset: 0;
  background: #000;
}

/* 子弹时间 HUD —— 边缘高光 + 单条文字 + 倒计时进度 */
.ks-slowmo {
  position: absolute; inset: 0;
  pointer-events: none;
  z-index: 30;
}
.ks-slowmo-frame {
  position: absolute; inset: 0;
  box-shadow:
    inset 0 0 0 2px rgba(125, 211, 252, 0.55),
    inset 0 0 80px rgba(125, 211, 252, 0.25),
    inset 0 0 220px rgba(232, 162, 58, 0.12);
  animation: ks-slowmo-pulse 1.6s ease-in-out infinite;
}
@keyframes ks-slowmo-pulse {
  0%, 100% { box-shadow: inset 0 0 0 2px rgba(125, 211, 252, 0.45), inset 0 0 80px rgba(125, 211, 252, 0.2), inset 0 0 220px rgba(232, 162, 58, 0.10); }
  50%      { box-shadow: inset 0 0 0 2px rgba(125, 211, 252, 0.7),  inset 0 0 110px rgba(125, 211, 252, 0.32), inset 0 0 260px rgba(232, 162, 58, 0.16); }
}
.ks-slowmo-tag {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 10px;
  padding: 8px 16px;
  font-size: 11px;
  letter-spacing: 0.36em;
  color: var(--ks-cyan);
  background: rgba(0,0,0,0.55);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(125, 211, 252, 0.45);
  border-radius: 2px;
  text-shadow: 0 0 12px rgba(125, 211, 252, 0.7);
}
.ks-slowmo-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--ks-cyan);
  box-shadow: 0 0 8px var(--ks-cyan);
  animation: ks-glow-pulse 1.2s ease-in-out infinite;
}
.ks-slowmo-bar {
  position: absolute;
  bottom: 76px; left: 50%;
  transform: translateX(-50%);
  width: 280px; height: 3px;
  border-radius: 2px;
  background: rgba(125, 211, 252, 0.16);
  overflow: hidden;
}
.ks-slowmo-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--ks-cyan), var(--ks-amber));
  box-shadow: 0 0 12px rgba(125, 211, 252, 0.5);
  transition: width 60ms linear;
}

/* 结尾屏 —— 极简，只有 FIN + 终止圆点 + 两个按钮，不再显示分数
 *
 * 作者原话："fin 虽然后标点，但是感觉没对齐中线"
 *
 * 诊断：CSS 的 letter-spacing 会加在**每个字符后面**（包括最后一个），
 *   所以 "FIN." 的视觉框是  F·space·I·space·N·space·.（N 后面还有 0.42em 空隙）。
 *   句号又是字体里最小、最贴下基线的字符，所以它在视觉上**既偏左又偏下**
 *   ——整个标题重心落在 "FIN" 上，点孤零零被甩出去。
 *
 * 修法：
 *   1) 把 "FIN" 和 "." 拆开。字母段仍然用 ks-cn 字体 + 0.42em letter-spacing，
 *      并用 'padding-left: 0.42em' 在左边补一个等宽偏移，抵消右边 letter-spacing
 *      带来的"右侧空隙"——这样字母段本身在容器里真正**水平居中**。
 *   2) "." 换成一个独立的实心小圆 <span>，尺寸固定、垂直居中到字母 x-high 附近。
 *      这是电影排版 + bauhaus 海报里标准的"终止圆点"写法，比字体 "." 稳定得多。
 */
.ks-ending {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 24px;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(20px);
  z-index: 60;
}
.ks-ending-title {
  display: inline-flex;
  align-items: center;
  gap: 0.18em;
  animation: ks-fade-up 720ms ease-out;
}
.ks-ending-letters {
  font-family: var(--ks-font-cn);
  font-size: 88px;
  font-weight: 300;
  /* 字母间距 0.42em 会在每个字符后"尾随"一份；
     在左侧补同样大小的 padding，让字母段在自身盒子里水平居中 */
  letter-spacing: 0.42em;
  padding-left: 0.42em;
  color: rgba(255, 255, 255, 0.94);
  /* 极细薄阴影，电影片尾感；去掉金色发光 */
  text-shadow: 0 1px 24px rgba(0, 0, 0, 0.5);
  line-height: 1;
}
.ks-ending-dot {
  /* 独立的终止圆点：尺寸固定，垂直和字母 x-height 对齐 */
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 1px 16px rgba(0, 0, 0, 0.5);
  /* 字母 line-height:1 时基线大约在盒子 82% 高度；
     把圆点推到字母 x-high 水平，观感才"对中线" */
  transform: translateY(-0.16em);
}
@keyframes ks-fade-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
.ks-ending-actions { display: flex; gap: 14px; }
.ks-ending-actions button {
  font-family: var(--ks-font-mono);
  font-size: 11.5px;
  letter-spacing: 0.24em;
  padding: 10px 22px;
}
/* v3.8.3 · 主按钮"换条路走" —— 在 FIN 页最吸引眼球的位置做一点暖光强调 */
.ks-ending-actions .ks-ending-primary {
  border-color: rgba(255, 123, 61, 0.55);
  background: rgba(255, 123, 61, 0.10);
  color: rgba(255, 205, 170, 0.96);
  transition:
    background var(--ks-dur-fast) var(--ks-ease),
    border-color var(--ks-dur-fast) var(--ks-ease),
    color var(--ks-dur-fast) var(--ks-ease),
    transform var(--ks-dur-fast) var(--ks-ease);
}
.ks-ending-actions .ks-ending-primary:hover {
  background: rgba(255, 123, 61, 0.85);
  border-color: rgba(255, 123, 61, 0.92);
  color: #fff;
  transform: translateY(-1px);
}

/* v3.8 · 视频加载错误提示（大视频/网络问题/格式不支持时的可见化） */
.ks-player-video-error {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 18px;
  background: rgba(239, 68, 68, 0.92);
  color: #fff;
  border-radius: 10px;
  font-size: 13px;
  font-family: var(--ks-font-ui);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 30;
  backdrop-filter: blur(8px);
}
.ks-player-video-stall {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: rgba(18, 18, 22, 0.78);
  color: rgba(255, 255, 255, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  font-size: 12px;
  font-family: var(--ks-font-ui);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  z-index: 25;
}
.ks-player-video-stall-spinner {
  display: inline-block;
  animation: ks-video-stall-spin 1.1s linear infinite;
}
@keyframes ks-video-stall-spin {
  to { transform: rotate(360deg); }
}

/* 进入门槛阻断提示 —— 顶部居中的瞬时 toast（数值/物品不足时） */
.ks-gate-notice {
  position: absolute;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 80%;
  padding: 10px 18px;
  border-radius: 999px;
  background: rgba(18, 16, 14, 0.82);
  border: 1px solid rgba(255, 200, 128, 0.4);
  color: rgba(255, 226, 188, 0.96);
  font-size: 13px;
  letter-spacing: 0.02em;
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  animation: ks-gate-notice-pop 220ms ease-out both;
}
.ks-gate-notice-ico { font-size: 14px; }
@keyframes ks-gate-notice-pop {
  from { opacity: 0; transform: translate(-50%, -6px); }
  to   { opacity: 1; transform: translate(-50%, 0); }
}

/* 搜索段提示横幅 */
.ks-search-banner {
  position: absolute;
  top: 22px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 45;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  max-width: 86%;
  padding: 9px 14px 9px 16px;
  border-radius: 999px;
  background: rgba(14, 14, 20, 0.8);
  border: 1px solid rgba(255, 210, 120, 0.42);
  color: #ffe9bd;
  font-size: 13px;
  backdrop-filter: blur(10px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  animation: ks-gate-notice-pop 240ms ease-out both;
}
.ks-search-banner-ico { font-size: 15px; animation: ks-search-pulse 1.6s ease-in-out infinite; }
.ks-search-banner-skip {
  margin-left: 4px;
  padding: 4px 12px;
  border-radius: 999px;
  border: 1px solid rgba(255, 210, 120, 0.5);
  background: transparent;
  color: #ffe9bd;
  font-size: 12px;
  cursor: pointer;
}
.ks-search-banner-skip:hover { background: rgba(255, 210, 120, 0.16); }
@keyframes ks-search-pulse {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.18); opacity: 1; }
}

/* ─── 长文本分段管线 · 三态装饰（id: p3-player） ───────────────────── */

.ks-player-skeleton {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  pointer-events: none;
  z-index: 18;
}
.ks-player-skeleton-shimmer {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(
      115deg,
      rgba(255, 240, 215, 0.04) 0 12px,
      rgba(108, 143, 184, 0.10) 12px 24px
    );
  mask-image: linear-gradient(
    100deg,
    transparent 0%,
    rgba(0, 0, 0, 0.6) 20%,
    rgba(0, 0, 0, 0.9) 50%,
    rgba(0, 0, 0, 0.6) 80%,
    transparent 100%
  );
  animation: ks-player-skeleton-pan 2.4s linear infinite;
}
@keyframes ks-player-skeleton-pan {
  0%   { transform: translateX(-30%); }
  100% { transform: translateX(30%); }
}
.ks-player-skeleton-text {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 28px;
  background: rgba(20, 18, 14, 0.55);
  border: 1px solid rgba(255, 240, 215, 0.18);
  border-radius: 999px;
  color: rgba(245, 236, 217, 0.92);
  font-family: var(--ks-font-ui);
  letter-spacing: 0.04em;
  backdrop-filter: blur(14px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}
.ks-player-skeleton-dot {
  font-size: 22px;
  color: var(--ks-amber);
  animation: ks-skeleton-dot 1.2s ease-in-out infinite;
}
@keyframes ks-skeleton-dot {
  0%, 100% { opacity: 0.4; transform: scale(0.95); }
  50%      { opacity: 1;   transform: scale(1.05); }
}
.ks-player-skeleton-title {
  font-size: 14px;
  font-weight: 600;
  color: rgba(255, 240, 215, 0.96);
  margin-bottom: 2px;
}
.ks-player-skeleton-sub {
  font-size: 11.5px;
  color: rgba(245, 236, 217, 0.62);
  letter-spacing: 0.02em;
}

.ks-player-promptsbadge {
  position: absolute;
  top: 14px;
  right: 14px;
  padding: 5px 12px;
  font-family: var(--ks-font-ui);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--ks-cyan);
  background: rgba(20, 18, 14, 0.48);
  border: 1px solid rgba(108, 143, 184, 0.45);
  border-radius: 999px;
  text-transform: uppercase;
  pointer-events: none;
  z-index: 19;
  backdrop-filter: blur(10px);
}
`
injectStyleOnce('player', playerCss)
