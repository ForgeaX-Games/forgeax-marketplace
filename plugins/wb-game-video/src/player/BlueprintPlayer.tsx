/**
 * BlueprintPlayer —— 「试玩」运行时的 React 驱动层，对齐 cinegame runtime 的走法：
 * 全屏舞台 + 真实视频演出 + 由纯引擎 `BlueprintRuntime` 决定的 Loop/转场/QTE/状态机/
 * Boss 走向；本组件只把 RuntimeDirective[] 翻译成画面、把玩家输入回灌引擎。
 *
 * 渲染设施复用旧 `Player.tsx` 的成熟组件（HUD 血条 / 电影字幕 / 富文本叠字 / 选项层 /
 * 热点层）——蓝图节点 id 恒等于 scene id，可直接取回原始 Scene 喂给这些层，并用 runtime
 * 的实体/数值/背包状态驱动它们。
 *
 * 与 cinegame 对齐的运行时设施：真实 `<video>` 播放（mediaStore / 固定视频库解析）、
 * `dmgPoints` 到点飘字+扣血（floatDamage）、蓝图面板 + 节点 JSON inspector、战斗日志、
 * 自动演示、重开。
 */

import { memo, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useShellStore } from '../shell/shellStore'
import { useMediaStore } from '../media/mediaStore'
import { getVideoClip } from '../scenario/gameAssetCatalog'
import { primeNodiaNarrationMedia } from '../scenario/nodiaNarrationMedia'
import { scenarioToBlueprint } from '../blueprint/scenarioToBlueprint'
import { toFXGraph } from '../blueprint/blueprint-reactflow'
import type { FXNode } from '../blueprint/react-flow-schema'
import { BPG_TYPE_ACCENTS } from '../editor/storygraph/blueprintGraphStyle'
import { BlueprintRuntime } from '../blueprint/runtime/engine'
import type { RuntimeDirective } from '../blueprint/runtime/directives'
import type {
  BlueprintBossRound,
  BlueprintDamagePoint,
  GameVideoBlueprintGraph,
  GameVideoBlueprintNode,
  BlueprintHotspot,
  BlueprintOption,
  BlueprintQte,
} from '../blueprint/blueprint-schema'
import type { Effect, EntityStatEffect, Hotspot, QTECue, QTESpec, Scene } from '../scenario/types'
import { HudLayer } from './hud/HudLayer'
import { DialogueBox } from './DialogueBox'
import { OverlayLayer } from './OverlayLayer'
import { ChoiceLayer } from './ChoiceLayer'
import { BattleSkillLayer, isBattleSkillChoice } from './BattleSkillLayer'
import { BattleParryLayer, isBattleParryQte } from './BattleParryLayer'
import { InkKouLayer, isInkKouQte } from './InkKouLayer'
import { InkYingMoLayer, isInkYingMoChoice } from './InkYingMoLayer'
import { NarrativeStatsLayer } from './NarrativeStatsLayer'
import { HotspotLayer } from './hotspots/HotspotLayer'
import { initEntities, type EntitiesState } from './entities'
import { evaluateCondition } from './conditionEval'
import { injectStyleOnce } from '../styles/injectStyle'
import { choiceWindowEnd, choiceWindowStart, resolvePlaybackCapMs, shouldActivateTimedQte, shouldOpenChoiceDuringPlayback } from './choiceTiming'
import { dueOverlaySettlements } from './performanceRuntime'
import { resolveScenePlaybackDurationMs } from './scenePlaybackDuration'
import { QTEOverlay } from './QTEOverlay'
import { qteOverlayAmbientClass } from './qteAmbient'
import { resolveSceneQte } from '../qte/qteKindPresets'
import { computeVideoContentRect, type VideoContentRect as ContentRect } from './videoContentRect'
import {
  judgeHold,
  judgeTap,
  qteAllResolved,
  qtePassed,
  qteTimeoutDeadlineMs,
  type HitVerdict,
} from '../qte/QTEEngine'

const STYLE_ID = 'bpx-style'
// 真实视频以 <video> 的 onEnded 为主推进；此超时只是「视频不结束（loop/加载失败）」
// 时的安全兜底，故取节点时长 + 缓冲，并设一个较大的封顶避免无限等待。
const AUTO_ADVANCE_CAP_MS = 15000
const ELAPSED_COMMIT_MS = 33
const DEMO_STEP_MS = 900
const MAX_LOGS = 24

type Interaction =
  | { type: 'none' }
  | { type: 'qte'; qte: BlueprintQte }
  | { type: 'choice'; options: BlueprintOption[] }
  | { type: 'boss'; round: BlueprintBossRound; index: number; total: number }
  | { type: 'hotspots'; hotspots: BlueprintHotspot[] }
  | { type: 'banner'; kind: 'victory' | 'defeat' | 'ending'; title: string }

interface ClipView {
  nodeId: string
  label: string
  /** 固定视频库直链（scene.clipId → gameAssetCatalog）。 */
  url?: string
  type?: string
  loop: boolean
  hud: string
  transition?: string
  durationMs?: number
  mediaId?: string
  dmgPoints: BlueprintDamagePoint[]
}

interface Snapshot {
  clip?: ClipView
  interaction: Interaction
}

interface FloatItem {
  id: number
  text: string
  x: number
  y: number
  kind: 'dmg' | 'hurt' | 'note' | 'heal'
}

interface StableBlueprintVideoProps {
  nodeId?: string
  runKey: number
  src: string
  loop: boolean
  videoRef: MutableRefObject<HTMLVideoElement | null>
  onEnded: () => void
  onNeedsUnmuteChange: (needsUnmute: boolean) => void
  onActiveVideoChange: () => void
  onVideoReady: (token: string) => void
}

const EMPTY: Snapshot = { interaction: { type: 'none' } }

type VideoSlot = 'a' | 'b'

interface VideoSlotData {
  token: string
  nodeId?: string
  runKey: number
  src: string
  loop: boolean
}

function videoToken(args: { nodeId?: string; runKey: number; src: string }): string {
  return `${args.runKey}:${args.nodeId ?? ''}:${args.src}`
}

const StableBlueprintVideo = memo(function StableBlueprintVideo({
  nodeId,
  runKey,
  src,
  loop,
  videoRef,
  onEnded,
  onNeedsUnmuteChange,
  onActiveVideoChange,
  onVideoReady,
}: StableBlueprintVideoProps) {
  const slotARef = useRef<HTMLVideoElement | null>(null)
  const slotBRef = useRef<HTMLVideoElement | null>(null)
  const [frontSlot, setFrontSlot] = useState<VideoSlot>('a')
  const frontSlotRef = useRef<VideoSlot>('a')
  const initialToken = videoToken({ nodeId, runKey, src })
  const currentTokenRef = useRef(initialToken)
  const [slots, setSlots] = useState<Record<VideoSlot, VideoSlotData | null>>({
    a: { token: initialToken, nodeId, runKey, src, loop },
    b: null,
  })

  useEffect(() => {
    frontSlotRef.current = frontSlot
    const active = frontSlot === 'a' ? slotARef.current : slotBRef.current
    if (active) {
      videoRef.current = active
      onActiveVideoChange()
    }
  }, [frontSlot, onActiveVideoChange, videoRef])

  useEffect(() => {
    const nextToken = videoToken({ nodeId, runKey, src })
    if (currentTokenRef.current === nextToken) {
      const active = frontSlotRef.current
      setSlots((prev) => ({
        ...prev,
        [active]: prev[active] ? { ...prev[active], loop } : prev[active],
      }))
      return
    }
    currentTokenRef.current = nextToken
    const backSlot: VideoSlot = frontSlotRef.current === 'a' ? 'b' : 'a'
    setSlots((prev) => ({
      ...prev,
      [backSlot]: { token: nextToken, nodeId, runKey, src, loop },
    }))
  }, [nodeId, runKey, src, loop])

  // 双缓冲激活兜底：activateSlot 只由 <video onCanPlay> 触发，但当某 slot 复用
  // 一个 src 未变的 <video> 元素时（如重开后 n_open→n_door，n_door 回到它原来的
  // slot），浏览器不重发 canplay → 该 slot 永不 activate、升不上 front。这里在 slots
  // 变化后补一刀：目标 slot 的 video 已 ready（readyState ≥ HAVE_CURRENT_DATA）却
  // 还没成为 front，就主动激活。
  useEffect(() => {
    for (const slot of ['a', 'b'] as VideoSlot[]) {
      const data = slots[slot]
      if (!data || data.token !== currentTokenRef.current) continue
      if (frontSlotRef.current === slot) continue
      const video = slot === 'a' ? slotARef.current : slotBRef.current
      if (video && video.readyState >= 2) void activateSlot(slot)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots])

  async function activateSlot(slot: VideoSlot): Promise<void> {
    const data = slots[slot]
    if (!data || data.token !== currentTokenRef.current) return
    const video = slot === 'a' ? slotARef.current : slotBRef.current
    if (!video) return

    videoRef.current = video
    onNeedsUnmuteChange(false)
    video.muted = false
    video.volume = 1

    try {
      await video.play()
    } catch {
      try {
        video.muted = true
        await video.play()
        onNeedsUnmuteChange(true)
      } catch {
        // Keep the latest frame visible even if the browser refuses autoplay entirely.
      }
    } finally {
      // 双缓冲只切显示不停旧视频：QTE 中途跳场景时旧 slot 仍在播，声音不断。
      // 新 slot 成为 front 前，暂停并重置旧 front slot 的 <video>。
      const prevSlot = frontSlotRef.current
      if (prevSlot !== slot) {
        const prevVideo = prevSlot === 'a' ? slotARef.current : slotBRef.current
        if (prevVideo) {
          prevVideo.pause()
          prevVideo.currentTime = 0
        }
      }
      frontSlotRef.current = slot
      setFrontSlot(slot)
      onVideoReady(data.token)
      onActiveVideoChange()
    }
  }

  function renderSlot(slot: VideoSlot, data: VideoSlotData | null) {
    if (!data) return null
    const isFront = frontSlot === slot
    return (
      <video
        key={slot}
        ref={slot === 'a' ? slotARef : slotBRef}
        className={`bpx-video bpx-video-buffer ${isFront ? 'is-front' : 'is-back'}`}
        src={data.src}
        playsInline
        preload="auto"
        loop={data.loop}
        onCanPlay={() => activateSlot(slot)}
        onEnded={() => {
          if (frontSlotRef.current === slot && !data.loop) onEnded()
        }}
      />
    )
  }

  return (
    <>
      {renderSlot('a', slots.a)}
      {renderSlot('b', slots.b)}
    </>
  )
}, (prev, next) => (
  prev.nodeId === next.nodeId &&
  prev.runKey === next.runKey &&
  prev.src === next.src &&
  prev.loop === next.loop
))

function autoAdvanceDelayMs(nodeId: string | null, clip: ClipView | undefined): number {
  const live = useScenarioStore.getState().scenario
  const sc = nodeId && live ? live.scenes[nodeId] : undefined
  return Math.min(
    resolveScenePlaybackDurationMs(sc, {
      fallbackMs: clip?.durationMs,
      loop: clip?.loop ?? sc?.mediaPlayMode === 'loop',
    }) + 300,
    AUTO_ADVANCE_CAP_MS,
  )
}

export function BlueprintPlayer(): JSX.Element {
  const scenario = useScenarioStore((s) => s.scenario)
  const setMode = useScenarioStore((s) => s.setMode)
  const mediaEntries = useMediaStore((s) => s.entries)

  const [runKey, setRunKey] = useState(0)
  const runtime = useMemo(() => {
    if (!scenario) return null
    return new BlueprintRuntime(scenarioToBlueprint(scenario), scenario)
    // 仅 runKey / scenario.id 重建引擎——时间栏等编辑会换 scenario 引用，但不能把试玩打回起点。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey, scenario?.id])
  const graph = useMemo(() => (scenario ? scenarioToBlueprint(scenario) : null), [scenario])

  // 作者/AI 工作台里的「试玩」才挂调试工具（clip 标签 + 工具条）。
  // `?surface=player`（主工作室嵌入预览）/ `?src=pack`（已发布试玩）是给终端玩家看的
  // 纯播放表面，不该露出这些开发向控件。
  const playerOnly = useMemo<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).get('surface') === 'player'
    } catch {
      return false
    }
  }, [])

  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY)
  const [, force] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [floats, setFloats] = useState<FloatItem[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [showBlueprint, setShowBlueprint] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [demoRunning, setDemoRunning] = useState(false)
  const [needsUnmute, setNeedsUnmute] = useState(false)
  const [contentRect, setContentRect] = useState<ContentRect | null>(null)
  const [readyVideoToken, setReadyVideoToken] = useState<string | null>(null)
  const [videoBufferVersion, setVideoBufferVersion] = useState(0)
  const [qteVerdicts, setQteVerdicts] = useState<HitVerdict[]>([])
  const qteFailTriggeredRef = useRef(false)
  const advancedRef = useRef<string | null>(null)
  /** loop 待机：选项窗一旦打开就保持，避免 video.currentTime 回卷把技能栏闪灭（对齐 Player.tsx）。 */
  const [choiceLatched, setChoiceLatched] = useState(false)
  const floatSeq = useRef(0)
  const perfFiredRef = useRef(new Set<string>())
  const clipNodeIdRef = useRef<string | undefined>(undefined)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const clip = snapshot.clip
  const videoSrc = clip?.url || (clip?.mediaId && mediaEntries[clip.mediaId]?.url)
  const currentVideoToken = videoSrc ? videoToken({ nodeId: clip?.nodeId, runKey, src: videoSrc }) : null
  const videoReady = !currentVideoToken || readyVideoToken === currentVideoToken

  injectStyles()

  useEffect(() => {
    primeNodiaNarrationMedia()
  }, [])

  useEffect(() => {
    if (!videoSrc) {
      videoRef.current = null
      setContentRect(null)
      setNeedsUnmute(false)
      return
    }
    const v = videoRef.current
    if (!v) return
    let frame = 0
    const update = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const rect = computeVideoContentRect(v)
        if (rect) setContentRect(rect)
      })
    }
    update()
    v.addEventListener('loadedmetadata', update)
    window.addEventListener('resize', update)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      v.removeEventListener('loadedmetadata', update)
      window.removeEventListener('resize', update)
    }
  }, [clip?.nodeId, videoSrc, videoBufferVersion])

  const dispatch = (dirs: RuntimeDirective[]): void => {
    const playClipDir = dirs.find((d) => d.type === 'playClip')
    const resetElapsed = !!playClipDir
    if (playClipDir) {
      advancedRef.current = null
      if (playClipDir.nodeId !== clipNodeIdRef.current) {
        clipNodeIdRef.current = playClipDir.nodeId
        setChoiceLatched(false)
        perfFiredRef.current = new Set()
        qteFailTriggeredRef.current = false
        setQteVerdicts([])
      }
    }
    setSnapshot((prev) => applyDirectives(prev, dirs))
    if (resetElapsed) setElapsed(0)
    setLogs((prev) => [...prev, ...dirs.map(logLine).filter((l): l is string => !!l)].slice(-MAX_LOGS))
    for (const d of dirs) {
      if (d.type === 'floatEffects') spawnOnEnterFloats(d.effects)
    }
    force((n) => n + 1)
  }

  // boot / restart
  useEffect(() => {
    if (!runtime) return
    advancedRef.current = null
    clipNodeIdRef.current = undefined
    setChoiceLatched(false)
    perfFiredRef.current = new Set()
    qteFailTriggeredRef.current = false
    setQteVerdicts([])
    setSnapshot(EMPTY)
    setLogs([])
    dispatch(runtime.start())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime])

  // 场景内时钟 —— 与 <video>.currentTime 对齐，驱动字幕 / 贴纸 / 热点窗口（同 Player.tsx）。
  useEffect(() => {
    if (!runtime || !videoReady) return
    let raf = 0
    let lastCommit = -ELAPSED_COMMIT_MS
    let wallAnchor = performance.now()
    let wallBaseMs = 0

    function sceneDurationMs(): number {
      const nodeId = runtime!.state.currentNodeId
      const sc = nodeId ? scenario?.scenes[nodeId] : undefined
      const base = resolveScenePlaybackDurationMs(sc, {
        fallbackMs: snapshot.clip?.durationMs,
        videoEl: videoRef.current,
        loop: snapshot.clip?.loop ?? sc?.mediaPlayMode === 'loop',
      })
      return sc ? resolvePlaybackCapMs(sc, base) : base
    }

    function tick(): void {
      const durationMs = sceneDurationMs()
      const video = videoRef.current
      let ms: number
      if (videoSrc && video && Number.isFinite(video.currentTime) && video.currentTime >= 0) {
        const videoMs = video.currentTime * 1000
        const videoDurMs =
          Number.isFinite(video.duration) && video.duration > 0.1 ? video.duration * 1000 : durationMs
        const atVideoEnd = video.ended || videoMs >= videoDurMs - 50
        if (atVideoEnd && durationMs > videoDurMs + 50) {
          // 多 cue QTE 窗可能超出视频物理时长：片尾定格，逻辑时钟继续走
          ms = Math.min(durationMs, videoDurMs + (performance.now() - wallAnchor))
        } else {
          ms = Math.min(durationMs, videoMs)
          wallAnchor = performance.now()
          wallBaseMs = ms
        }
      } else {
        ms = Math.min(durationMs, wallBaseMs + (performance.now() - wallAnchor))
      }
      const now = performance.now()
      if (now - lastCommit >= ELAPSED_COMMIT_MS) {
        lastCommit = now
        setElapsed(ms)
      }
      raf = requestAnimationFrame(tick)
    }

    wallAnchor = performance.now()
    wallBaseMs = 0
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [runtime, snapshot.clip?.nodeId, videoReady, videoSrc, scenario, snapshot.clip?.durationMs])

  // 飘字结算：读 live scene.overlays[].settlement，到 startMs 触发全 effect（引擎侧 applyRuntimeEffects）。
  // 可见飘字由 OverlayLayer 自身渲染（含 enter 动画），不再 spawn transient DOM float。
  useEffect(() => {
    if (!runtime || !scenario || !snapshot.clip) return
    const nodeId = runtime.state.currentNodeId
    const sc = nodeId ? scenario.scenes[nodeId] : undefined
    const due = dueOverlaySettlements(sc?.overlays, elapsed, perfFiredRef.current)
    if (due.length === 0) return
    for (const ov of due) {
      perfFiredRef.current.add(ov.id)
      const point: BlueprintDamagePoint = {
        t: ov.startMs / 1000,
        x: ov.x * 100,
        y: ov.y * 100,
        note: ov.label ?? (ov.content || '结算'),
        effects: ov.settlement!.effects,
      }
      dispatch(runtime.applyDamagePoint(point))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, snapshot.clip?.nodeId, runtime])

  // 自动推进：纯演出节点（无交互）按时长/视频结束走到下一节点。
  useEffect(() => {
    if (!runtime) return
    if (snapshot.interaction.type !== 'none') return
    if (runtime.state.phase !== 'playing' && runtime.state.phase !== 'awaitHotspot') return
    // Loop 演出 = 背景视频持续播放，逻辑节点立即叠加执行；非 loop 仍按时长/onEnded 推进。
    const ms = snapshot.clip?.loop
      ? 0
      : autoAdvanceDelayMs(runtime.state.currentNodeId, snapshot.clip)
    const timer = window.setTimeout(() => advanceClip(), ms)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.clip?.nodeId, snapshot.interaction.type, runtime, snapshot.clip?.loop, snapshot.clip?.durationMs])

  // QTE 整段超时：按 live scenario.qte 的 appearAt + timeoutMs 判定（对齐 Player.tsx）。
  useEffect(() => {
    if (!runtime || !scenario) return
    const nodeId = runtime.state.currentNodeId
    const sc = nodeId ? scenario.scenes[nodeId] : undefined
    if (!sc || snapshot.interaction.type !== 'qte') return
    const liveQte = resolveSceneQte(sc)
    if (!liveQte || !shouldActivateTimedQte(sc, elapsed)) return
    if (shouldUseBattleParryUi(sc, liveQte)) return

    const deadline = qteTimeoutDeadlineMs(liveQte)
    if (deadline == null || elapsed < deadline) return
    if (qteAllResolved(liveQte, qteVerdicts)) return
    if (qteFailTriggeredRef.current) return
    qteFailTriggeredRef.current = true

    const bpQte = blueprintQteFromScene(sc, liveQte)
    if (bpQte && hasTieredQteOutcomes(bpQte)) {
      dispatch(runtime.submitQteOutcome('fail'))
    } else {
      const hits = qteVerdicts.filter((v) => v.judgement !== 'MISS').length
      dispatch(runtime.submitQte(hits))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, snapshot.interaction.type, snapshot.clip?.nodeId, qteVerdicts, runtime, scenario])

  // 自动演示：每步挑第一个可行输入推进，直到结局。
  useEffect(() => {
    if (!runtime || !demoRunning) return
    const it = snapshot.interaction
    if (it.type === 'banner') {
      setDemoRunning(false)
      return
    }
    const timer = window.setTimeout(() => {
      if (it.type === 'choice' && it.options[0]) dispatch(runtime.chooseOption(it.options[0].key))
      else if (it.type === 'qte') {
        const sc = runtime.state.currentNodeId ? scenario?.scenes[runtime.state.currentNodeId] : undefined
        const liveQte = sc ? resolveSceneQte(sc) : undefined
        if (sc && liveQte && shouldUseBattleParryUi(sc, liveQte)) {
          dispatch(runtime.submitQteOutcome('pass'))
        } else {
          dispatch(runtime.submitQte(liveQte?.cues?.length ?? it.qte.cueMs.length))
        }
      }
      else if (it.type === 'boss') dispatch(runtime.submitBossRound(true))
      else if (it.type === 'hotspots' && it.hotspots[0]) dispatch(runtime.clickHotspot(it.hotspots[0].id))
      else advanceClip()
    }, DEMO_STEP_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoRunning, snapshot, runtime])

  useEffect(() => {
    if (!runtime || !scenario) return
    const nodeId = runtime.state.currentNodeId
    const sc = nodeId ? scenario.scenes[nodeId] : undefined
    if (!sc || snapshot.interaction.type !== 'choice' || choiceLatched) return
    if (shouldOpenChoiceDuringPlayback(sc, elapsed)) {
      setChoiceLatched(true)
    }
  }, [runtime, scenario, snapshot.interaction.type, elapsed, choiceLatched])

  if (!scenario || !runtime) {
    return <div className="bpx-empty">无可播放剧本</div>
  }

  function advanceClip(): void {
    if (!runtime) return
    const id = runtime.state.currentNodeId
    if (id && advancedRef.current === id) return
    advancedRef.current = id
    dispatch(runtime.onClipEnded())
  }

  function spawnFloats(p: BlueprintDamagePoint): void {
    const items: FloatItem[] = []
    for (const effect of p.effects) {
      if (effect.kind !== 'entityStat' || effect.stat !== 'hp') continue
      const value = Number(effect.value)
      if (!Number.isFinite(value) || value === 0) continue
      items.push({
        id: floatSeq.current++,
        text: value > 0 ? `+${value}` : `${value}`,
        x: p.x,
        y: p.y + items.length * 8,
        kind: value < 0 ? 'dmg' : 'heal',
      })
    }
    if (items.length === 0) items.push({ id: floatSeq.current++, text: p.note, x: p.x, y: p.y, kind: 'note' })
    setFloats((prev) => [...prev, ...items])
    for (const it of items) window.setTimeout(() => setFloats((prev) => prev.filter((f) => f.id !== it.id)), 1100)
  }

  /**
   * 进入节点即时结算的实体 HP 效果（onEnter，如冥想回血 +30）弹飘字。
   * 无 clip 时间坐标，按实体（Boss 顶部血条 / 我方右下血条）就近安置。
   * 与 OverlayLayer 正交：clip 坐标飘字走 overlays[].settlement + OverlayLayer；
   * 这里只兜 onEnter 无坐标的即时 HP 结算（runtime 发 floatEffects 指令）。
   */
  function spawnOnEnterFloats(effects: Effect[]): void {
    const hp = effects.filter(
      (e): e is EntityStatEffect => e.kind === 'entityStat' && e.stat === 'hp' && Number(e.value) !== 0,
    )
    const first = hp[0]
    if (!first) return
    const isBoss = scenario?.entities?.[first.entityId]?.kind === 'boss'
    const at = isBoss ? { x: 50, y: 22 } : { x: 80, y: 72 }
    spawnFloats({ t: 0, x: at.x, y: at.y, note: '', effects: hp })
  }

  const exit = (): void => {
    useShellStore.getState().setForgeView('blueprint')
    setMode('editor')
  }

  function handleCueResolve(cue: QTECue, verdict: HitVerdict): void {
    if (!runtime || !scene || !activeQte) return
    setQteVerdicts((prev) => {
      const next = prev.some((v) => v.cueId === cue.id) ? prev : [...prev, verdict]
      if (!qteAllResolved(activeQte, next)) return next
      window.setTimeout(() => {
        const hasQteBranches = scene.branches.some((b) => b.kind === 'qte_pass' || b.kind === 'qte_fail')
        if (hasQteBranches) {
          const passed = qtePassed(activeQte, next)
          dispatch(runtime.submitQteOutcome(passed ? 'pass' : 'fail'))
        } else {
          const hits = next.filter((v) => v.judgement !== 'MISS').length
          dispatch(runtime.submitQte(hits))
        }
      }, 400)
      return next
    })
  }

  const interaction = snapshot.interaction
  const scene: Scene | undefined = runtime.state.currentNodeId
    ? scenario.scenes[runtime.state.currentNodeId]
    : undefined
  const activeQte = useMemo(() => (scene ? resolveSceneQte(scene) : undefined), [scene])
  const liveParryQte =
    scene && activeQte ? blueprintQteFromScene(scene, activeQte) : undefined
  const qteLayerActive =
    !!(
      scene &&
      interaction.type === 'qte' &&
      activeQte &&
      shouldActivateTimedQte(scene, elapsed)
    )
  const firstQteAppearMs =
    activeQte?.cues?.length ? Math.min(...activeQte.cues.map((c) => c.appearAt)) : 0
  const showBattleParry =
    qteLayerActive &&
    !!scene &&
    !!activeQte &&
    shouldUseBattleParryUi(scene, activeQte) &&
    elapsed >= firstQteAppearMs

  function onUnmuteClick(): void {
    const v = videoRef.current
    if (!v) return
    v.muted = false
    v.volume = 1
    setNeedsUnmute(false)
    if (v.paused) {
      void v.play().catch(() => setNeedsUnmute(true))
    }
  }

  const choiceVisible =
    scene &&
    interaction.type === 'choice' &&
    (choiceLatched ||
      (elapsed >= choiceWindowStart(scene) && elapsed < choiceWindowEnd(scene)))

  const hudEntities = deriveEntities(scenario, runtime)
  const score = runtime.state.score
  const vars = runtime.state.vars
  const ownedItems = runtime.state.items
  const visitedList = Array.from(runtime.state.visited)
  const hudVisible = clip?.hud && clip.hud !== 'hidden'
  const currentBpNode = findBlueprintNode(graph, runtime.state.currentNodeId)
  const contentStyle = contentRect
    ? {
      left: `${contentRect.left}px`,
      top: `${contentRect.top}px`,
      width: `${contentRect.width}px`,
      height: `${contentRect.height}px`,
    }
    : undefined

  return (
    <div className="bpx-root" tabIndex={0}>
      <div className="bpx-stage" data-transition={clip?.transition ?? 'cut'}>
        {videoSrc && (
          <StableBlueprintVideo
            nodeId={clip?.nodeId}
            runKey={runKey}
            src={videoSrc}
            loop={clip?.loop ?? false}
            videoRef={videoRef}
            onNeedsUnmuteChange={setNeedsUnmute}
            onVideoReady={setReadyVideoToken}
            onActiveVideoChange={() => setVideoBufferVersion((n) => n + 1)}
            onEnded={() => {
              if (!clip?.loop) advanceClip()
            }}
          />
        )}
        {!playerOnly && needsUnmute && (
          <button type="button" className="bpx-unmute" onClick={onUnmuteClick}>
            🔇 点击恢复声音
          </button>
        )}
        <div className="bpx-vignette" aria-hidden />
        {!playerOnly && (
          <div className="bpx-content-anchor" style={contentStyle}>
            <div className="bpx-clip-tag">
              <span>{clip?.type ?? '演出'}{clip?.loop ? ' · Loop' : ''}</span>
              <strong>{clip?.label ?? '—'}</strong>
            </div>
          </div>
        )}

        {/* onEnter 无坐标即时结算（如冥想回血）的 transient 飘字层；clip 坐标飘字走 OverlayLayer */}
        <div className="bpx-floats" aria-hidden>
          {floats.map((f) => (
            <span key={f.id} className={`bpx-float bpx-float--${f.kind}`} style={{ left: `${f.x}%`, top: `${f.y}%` }}>
              {f.text}
            </span>
          ))}
        </div>

        {/* ── 复用旧 Player 的成熟渲染设施 ── */}
        {scene && <DialogueBox scene={scene} elapsed={elapsed} />}
        {scene && <OverlayLayer scene={scene} elapsed={elapsed} />}
        {scene && hudVisible && (
          <div className="bpx-content-ui" style={contentStyle}>
            <HudLayer scenario={scenario} scene={scene} entities={hudEntities} vars={vars} score={score} />
            {scene && clip?.hud === 'narrative' && (
              <NarrativeStatsLayer scenario={scenario} vars={vars} />
            )}
          </div>
        )}

        {choiceVisible && isBattleSkillChoice(scene) && (
          <BattleSkillLayer
            key={scene.id}
            scene={scene}
            onPick={(b) => dispatch(runtime.chooseOption(b.id))}
            vars={vars}
            visitedSceneIds={visitedList}
            ownedItems={ownedItems}
            entities={hudEntities}
            score={score}
          />
        )}

        {choiceVisible && isInkYingMoChoice(scene) && (
          <InkYingMoLayer
            scene={scene}
            onPick={(b) => dispatch(runtime.chooseOption(b.id))}
            vars={vars}
            visitedSceneIds={visitedList}
            ownedItems={ownedItems}
            entities={hudEntities}
            score={score}
          />
        )}

        {choiceVisible && !isBattleSkillChoice(scene) && !isInkYingMoChoice(scene) && (
          <ChoiceLayer
            scene={scene}
            onPick={(b) => dispatch(runtime.chooseOption(b.id))}
            vars={vars}
            visitedSceneIds={visitedList}
            ownedItems={ownedItems}
            entities={hudEntities}
            score={score}
          />
        )}

        {scene && interaction.type === 'hotspots' && (
          <HotspotLayer
            hotspots={visibleHotspots(scene, elapsed, {
              vars,
              visitedSceneIds: new Set(visitedList),
              ownedItems,
              entities: hudEntities,
              score,
            })}
            onActivate={(h) => dispatch(runtime.clickHotspot(h.id))}
          />
        )}

        {/* ── QTE / Boss：锚定到视频内容矩形（与血条同坐标系），letterbox 时不漂到黑边 ── */}
        <div className="bpx-content-anchor" style={contentStyle}>
          {showBattleParry && liveParryQte && runtime && (
            <BattleParryLayer
              qte={liveParryQte}
              onResolve={(outcome) => dispatch(runtime.submitQteOutcome(outcome))}
            />
          )}

          {scene && qteLayerActive && !showBattleParry && elapsed >= firstQteAppearMs && isInkKouQte(scene) && liveParryQte && runtime && (
            <InkKouLayer
              qte={liveParryQte}
              anchorX={activeQte?.cues?.[0]?.x ?? 0.58}
              anchorY={activeQte?.cues?.[0]?.y ?? 0.39}
              glyph={activeQte?.cues?.[0]?.label || '叩'}
              onResolve={(outcome) => dispatch(runtime.submitQteOutcome(outcome))}
            />
          )}

          {qteLayerActive && !showBattleParry && (!scene || !isInkKouQte(scene)) && activeQte && (activeQte.cues?.length ?? 0) > 0 && (
            <QTEOverlay
              spec={activeQte}
              elapsed={elapsed}
              verdicts={qteVerdicts}
              ambientClass={scene ? qteOverlayAmbientClass(scene) : ''}
              onResolve={(cue, deltaMs, holdMs) => {
                const v =
                  cue.shape === 'hold'
                    ? judgeHold(cue, activeQte.tolerance, activeQte.score, deltaMs, holdMs ?? 0)
                    : judgeTap(cue, activeQte.tolerance, activeQte.score, deltaMs)
                handleCueResolve(cue, v)
              }}
            />
          )}

          {interaction.type === 'boss' && (
            <div className="bpx-boss">
              <p>
                {interaction.round.label ?? '回合'} ({interaction.index + 1}/{interaction.total})
              </p>
              <div className="bpx-boss-actions">
                <button onClick={() => dispatch(runtime.submitBossRound(true))}>命中</button>
                <button className="bpx-boss-miss" onClick={() => dispatch(runtime.submitBossRound(false))}>
                  失手
                </button>
              </div>
            </div>
          )}
        </div>

        {interaction.type === 'banner' && (
          <div className={`bpx-banner bpx-banner--${interaction.kind}`}>
            <strong>{interaction.title}</strong>
            <div className="bpx-banner-actions">
              <button onClick={() => setRunKey((k) => k + 1)}>重新开始</button>
              <button className="bpx-banner-exit" onClick={exit}>返回蓝图</button>
            </div>
          </div>
        )}

        {!playerOnly && (
          <div className="bpx-content-anchor" style={contentStyle}>
            <div className="bpx-tools">
              <button className={demoRunning ? 'is-on' : ''} onClick={() => setDemoRunning((v) => !v)}>
                {demoRunning ? '停止演示' : '自动演示'}
              </button>
              <button onClick={() => setRunKey((k) => k + 1)}>重开</button>
              <button className={showLogs ? 'is-on' : ''} onClick={() => setShowLogs((v) => !v)}>日志</button>
              <button className={showBlueprint ? 'is-on' : ''} onClick={() => setShowBlueprint((v) => !v)}>蓝图</button>
              <button onClick={exit}>退出</button>
            </div>
          </div>
        )}

        {showBlueprint && graph && (
          <DraggablePanel title="蓝图状态机">
            <BlueprintStateGraph
              graph={graph}
              currentNodeId={runtime.state.currentNodeId}
              visited={runtime.state.visited}
              traversedEdges={runtime.state.traversedEdgeIds}
              onJump={(id) => dispatch(runtime.jumpTo(id))}
            />
          </DraggablePanel>
        )}

        {showLogs && (
          <div className="bpx-logs">
            <h3>运行日志</h3>
            <ol>
              {logs.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ol>
            <pre>{JSON.stringify(currentBpNode, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── 蓝图状态机图（试玩内的图形化状态总览 + 单步执行 + 子流程下钻） ──────────
 * 把整张蓝图（顶层 + 全部子流程）摊平到**同一张画布**：顶层流程在上，每个子流程
 * （如「我方回合」）打包成一个带标题的虚线分组框堆在下方，并从引用它的父节点拉虚线
 * 连过去——整体过程一屏可见，无需来回下钻。节点/连线按类型上色（对齐编辑器
 * BlueprintTab 的 BPG_TYPE_ACCENTS）。
 *
 * 运行轨迹：跑过的节点(visited)/连线(traversedEdgeIds)标绿，当前节点额外加高光脉冲并
 * 滚动居中——在全局图上就能看到「一步步走过的路线」。点任意节点 = 直接跳到该节点
 * 执行（onJump → runtime.jumpTo）。图形化取代原纯文案列表。 */

type PanelGesture =
  | { type: 'move'; ox: number; oy: number }
  | { type: 'resize-ne'; sx: number; sy: number; sw: number; sh: number; sb: number }
  | { type: 'resize-se'; sx: number; sy: number; sw: number; sh: number }

/**
 * 可拖拽 + 可缩放的浮层容器：标题栏按住可拖到页面任意处；右上角的把手按住可任意拉伸
 * 大小（右上角缩放 = 锚定左下角：向右加宽、向上增高）。宽高完全受控，位置/尺寸都用
 * delta 计算，故不受容器在视口里的偏移影响。
 */
function DraggablePanel({ title, children }: { title: string; children: ReactNode }) {
  const [box, setBox] = useState({ x: 22, y: 96, w: 480, h: 460 })
  const gesture = useRef<PanelGesture | null>(null)

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current
      if (!g) return
      if (g.type === 'move') {
        setBox((b) => ({ ...b, x: Math.max(0, e.clientX - g.ox), y: Math.max(0, e.clientY - g.oy) }))
        return
      }
      const maxW = window.innerWidth * 0.96
      const maxH = window.innerHeight * 0.92
      if (g.type === 'resize-se') {
        // 右下角：锚定左上角，向右/下拉伸。
        const w = Math.max(300, Math.min(g.sw + (e.clientX - g.sx), maxW))
        const h = Math.max(220, Math.min(g.sh + (e.clientY - g.sy), maxH))
        setBox((b) => ({ ...b, w, h }))
        return
      }
      // resize-ne 右上角：锚定左下角，向右加宽、向上增高。
      const w = Math.max(300, Math.min(g.sw + (e.clientX - g.sx), maxW))
      const h = Math.max(220, Math.min(g.sh - (e.clientY - g.sy), maxH))
      setBox((b) => ({ ...b, w, h, y: Math.max(0, g.sb - h) }))
    }
    const onUp = () => {
      gesture.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  return (
    <div
      className="bpx-blueprint"
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, bottom: 'auto', maxHeight: 'none' }}
    >
      <div
        className="bpx-panel-head"
        onPointerDown={(e) => {
          gesture.current = { type: 'move', ox: e.clientX - box.x, oy: e.clientY - box.y }
        }}
      >
        <span>{title}</span>
      </div>
      <div
        className="bpx-panel-resize bpx-panel-resize--ne"
        title="按住拖拽缩放"
        onPointerDown={(e) => {
          e.stopPropagation()
          gesture.current = { type: 'resize-ne', sx: e.clientX, sy: e.clientY, sw: box.w, sh: box.h, sb: box.y + box.h }
        }}
      />
      <div
        className="bpx-panel-resize bpx-panel-resize--se"
        title="按住拖拽缩放"
        onPointerDown={(e) => {
          e.stopPropagation()
          gesture.current = { type: 'resize-se', sx: e.clientX, sy: e.clientY, sw: box.w, sh: box.h }
        }}
      />
      {children}
    </div>
  )
}

const SG_NODE_W = 150
const SG_NODE_H = 46
const SG_PAD = 28
/** 子流程分组容器内边距 / 标题栏高度 / 分组之间的纵向间距。 */
const SG_GROUP_PAD = 18
const SG_GROUP_HEADER = 26
const SG_GROUP_GAP = 52

/** fxGraph 节点 → 视觉 accent（对齐编辑器：起点/结局/子蓝图/演出/逻辑）。 */
function stateNodeAccent(node: FXNode): string {
  if (node.type === 'input') return BPG_TYPE_ACCENTS.root
  if (node.type === 'output' || node.data.hud === 'ending') return BPG_TYPE_ACCENTS.end
  if (node.type === 'group') return BPG_TYPE_ACCENTS.open
  const badge = node.data.badge
  if (badge === 'boss' || badge === 'qte') return BPG_TYPE_ACCENTS.perf
  if (badge === 'choice') return BPG_TYPE_ACCENTS.open
  return BPG_TYPE_ACCENTS.loop
}

interface SGNode {
  id: string
  label: string
  accent: string
  isSubflow: boolean
  x: number
  y: number
}
interface SGEdge {
  id: string
  source: string
  sx: number
  sy: number
  tx: number
  ty: number
}
interface SGGroup {
  id: string
  title: string
  x: number
  y: number
  w: number
  h: number
}
interface SGConnector {
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
}
interface SGModel {
  nodes: SGNode[]
  edges: SGEdge[]
  groups: SGGroup[]
  connectors: SGConnector[]
  viewBox: { x: number; y: number; w: number; h: number }
}

/** fx 图节点列表 → 局部包围盒（含节点尺寸）。 */
function bboxOf(fxNodes: FXNode[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of fxNodes) {
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + SG_NODE_W)
    maxY = Math.max(maxY, n.position.y + SG_NODE_H)
  }
  if (!fxNodes.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { minX, minY, maxX, maxY }
}

/**
 * 把整张蓝图（顶层 + 全部子流程）摊平到**同一张画布**：顶层节点按 autoLayout 排在上方，
 * 每个子流程的内层图打包进一个带标题的虚线分组框，依次堆叠在下方，并从引用它的父节点
 * （subFlowRef）拉一条虚线连过去。这样整体流程一屏可见、无需来回下钻。
 */
function buildCombined(graph: GameVideoBlueprintGraph): SGModel {
  const posMap = new Map<string, { x: number; y: number }>()
  const nodes: SGNode[] = []
  const rawEdges: { id: string; source: string; target: string }[] = []
  const groups: SGGroup[] = []

  const top = toFXGraph(graph)
  for (const n of top.nodes) {
    posMap.set(n.id, { x: n.position.x, y: n.position.y })
    nodes.push({
      id: n.id,
      label: n.data.label || n.id,
      accent: stateNodeAccent(n),
      isSubflow: n.type === 'group',
      x: n.position.x,
      y: n.position.y,
    })
  }
  for (const e of top.edges) rawEdges.push({ id: e.id, source: e.source, target: e.target })
  const topBox = bboxOf(top.nodes)

  let cursorY = topBox.maxY + SG_GROUP_GAP
  const groupX = topBox.minX
  for (const sub of Object.values(graph.subflows ?? {})) {
    const fx = toFXGraph({ ...graph, nodes: sub.nodes, edges: sub.edges, subflows: undefined })
    const box = bboxOf(fx.nodes)
    const originX = groupX + SG_GROUP_PAD - box.minX
    const originY = cursorY + SG_GROUP_HEADER - box.minY
    for (const n of fx.nodes) {
      const x = originX + n.position.x
      const y = originY + n.position.y
      posMap.set(n.id, { x, y })
      nodes.push({
        id: n.id,
        label: n.data.label || n.id,
        accent: stateNodeAccent(n),
        isSubflow: n.type === 'group',
        x,
        y,
      })
    }
    for (const e of fx.edges) rawEdges.push({ id: e.id, source: e.source, target: e.target })
    const gW = box.maxX - box.minX + SG_GROUP_PAD * 2
    const gH = box.maxY - box.minY + SG_GROUP_HEADER + SG_GROUP_PAD
    groups.push({ id: sub.id, title: sub.title, x: groupX, y: cursorY, w: gW, h: gH })
    cursorY += gH + SG_GROUP_GAP
  }

  const edges: SGEdge[] = []
  for (const e of rawEdges) {
    const s = posMap.get(e.source)
    const t = posMap.get(e.target)
    if (!s || !t) continue
    edges.push({ id: e.id, source: e.source, sx: s.x + SG_NODE_W, sy: s.y + SG_NODE_H / 2, tx: t.x, ty: t.y + SG_NODE_H / 2 })
  }

  const groupById = new Map(groups.map((g) => [g.id, g]))
  const connectors: SGConnector[] = []
  for (const node of graph.nodes) {
    const ref = node.extensionElements.subFlowRef
    const g = ref ? groupById.get(ref) : undefined
    const p = posMap.get(node.id)
    if (!g || !p) continue
    connectors.push({ key: `${node.id}->${g.id}`, x1: p.x + SG_NODE_W / 2, y1: p.y + SG_NODE_H, x2: g.x + g.w / 2, y2: g.y })
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + SG_NODE_W)
    maxY = Math.max(maxY, n.y + SG_NODE_H)
  }
  for (const g of groups) {
    minX = Math.min(minX, g.x)
    minY = Math.min(minY, g.y)
    maxX = Math.max(maxX, g.x + g.w)
    maxY = Math.max(maxY, g.y + g.h)
  }
  if (!nodes.length && !groups.length) {
    minX = minY = 0
    maxX = maxY = 0
  }
  return {
    nodes,
    edges,
    groups,
    connectors,
    viewBox: { x: minX - SG_PAD, y: minY - SG_PAD, w: maxX - minX + SG_PAD * 2, h: maxY - minY + SG_PAD * 2 },
  }
}

const BlueprintStateGraph = memo(function BlueprintStateGraph({
  graph,
  currentNodeId,
  visited,
  traversedEdges,
  onJump,
}: {
  graph: GameVideoBlueprintGraph
  currentNodeId: string | null | undefined
  visited: Set<string>
  traversedEdges: Set<string>
  onJump: (nodeId: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const currentRef = useRef<SVGGElement | null>(null)

  const model = useMemo(() => buildCombined(graph), [graph])

  // 跟踪容器可视尺寸（面板缩放时变化），用于「自适应铺满 + 保底最小尺寸」。
  const [vp, setVp] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const sync = () => setVp({ w: el.clientWidth, h: el.clientHeight })
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // svg 尺寸 = max(内容真实包围盒, 容器)：容器更大就放大铺满（viewBox 缩放，节点变大）；
  // 容器更小就保持内容尺寸并滚动——绝不缩到比内容还小，避免节点挤成一团。
  const svgW = Math.max(model.viewBox.w, vp.w)
  const svgH = Math.max(model.viewBox.h, vp.h)

  // 当前节点变化 → 滚动居中。用 getBoundingClientRect（屏幕像素）算偏移，兼容 viewBox 缩放。
  useEffect(() => {
    const box = scrollRef.current
    const cur = currentRef.current
    if (!box || !cur) return
    const br = cur.getBoundingClientRect()
    const cr = box.getBoundingClientRect()
    box.scrollTo({
      left: box.scrollLeft + (br.left - cr.left) + br.width / 2 - box.clientWidth / 2,
      top: box.scrollTop + (br.top - cr.top) + br.height / 2 - box.clientHeight / 2,
      behavior: 'smooth',
    })
  }, [currentNodeId, svgW, svgH])

  return (
    <>
      <div className="bpx-sg-scroll" ref={scrollRef}>
        <svg
          className="bpx-sg-svg"
          width={svgW}
          height={svgH}
          viewBox={`${model.viewBox.x} ${model.viewBox.y} ${model.viewBox.w} ${model.viewBox.h}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <marker id="bpx-sg-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#9aa7b4" opacity="0.7" />
            </marker>
            <marker id="bpx-sg-arrow-done" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#3ec98a" />
            </marker>
          </defs>
          <g className="bpx-sg-groups">
            {model.groups.map((g) => (
              <g key={g.id}>
                <rect className="bpx-sg-group" x={g.x} y={g.y} width={g.w} height={g.h} rx={10} />
                <text className="bpx-sg-group-title" x={g.x + 10} y={g.y + 17}>
                  ▣ {g.title}
                </text>
              </g>
            ))}
          </g>
          <g className="bpx-sg-connectors">
            {model.connectors.map((c) => {
              const midY = (c.y1 + c.y2) / 2
              return (
                <path
                  key={c.key}
                  className="bpx-sg-connector"
                  d={`M ${c.x1},${c.y1} C ${c.x1},${midY} ${c.x2},${midY} ${c.x2},${c.y2}`}
                />
              )
            })}
          </g>
          <g className="bpx-sg-edges">
            {model.edges.map((e) => {
              const dx = Math.max(30, Math.abs(e.tx - e.sx) * 0.5)
              const d = `M ${e.sx},${e.sy} C ${e.sx + dx},${e.sy} ${e.tx - dx},${e.ty} ${e.tx},${e.ty}`
              const done = traversedEdges.has(e.id)
              return <path key={e.id} className={`bpx-sg-edge${done ? ' is-done' : ''}`} d={d} />
            })}
          </g>
          {model.nodes.map((n) => {
            const active = n.id === currentNodeId
            const ran = visited.has(n.id) && !active
            const label = n.label
            const cls = ['bpx-sg-node', active ? 'is-active' : '', ran ? 'is-ran' : '']
              .filter(Boolean)
              .join(' ')
            return (
              <g
                key={n.id}
                ref={active ? currentRef : undefined}
                className={cls}
                transform={`translate(${n.x},${n.y})`}
                onClick={() => onJump(n.id)}
              >
                <rect
                  className="bpx-sg-box"
                  width={SG_NODE_W}
                  height={SG_NODE_H}
                  rx={8}
                  style={{ ['--sgc' as string]: n.accent }}
                />
                <rect className="bpx-sg-bar" width={SG_NODE_W} height={6} rx={3} style={{ fill: n.accent }} />
                <text className="bpx-sg-label" x={10} y={26}>
                  {label.length > 12 ? `${label.slice(0, 11)}…` : label}
                </text>
                {n.isSubflow && (
                  <text className="bpx-sg-badge is-subflow" x={10} y={39}>
                    子流程 ↓
                  </text>
                )}
              </g>
            )
          })}
        </svg>
        {model.nodes.length === 0 && <div className="bpx-sg-empty">还没有可展示的玩法结构</div>}
      </div>
      <div className="bpx-sg-hint">
        <span className="bpx-sg-lg bpx-sg-lg-ran" />跑过的路线
        <span className="bpx-sg-lg bpx-sg-lg-cur" />正在执行 · 点节点直接执行
      </div>
    </>
  )
})

/** 把 runtime 的实体血量合并进 initEntities（保留名字/头像/状态词汇），供 HudLayer/ChoiceLayer 用。 */
function deriveEntities(
  scenario: NonNullable<ReturnType<typeof useScenarioStore.getState>['scenario']>,
  runtime: BlueprintRuntime,
): EntitiesState {
  const base = initEntities(scenario)
  for (const [id, e] of Object.entries(runtime.state.entities)) {
    const prev = base[id]
    base[id] = prev
      ? { ...prev, hp: e.hp, maxHp: e.maxHp, statusIds: e.statusIds }
      : { id, name: id, kind: e.kind as EntitiesState[string]['kind'], hp: e.hp, maxHp: e.maxHp, statusIds: e.statusIds }
  }
  return base
}

function visibleHotspots(
  scene: Scene,
  elapsed: number,
  ctx: Parameters<typeof evaluateCondition>[1],
): Hotspot[] {
  return (scene.hotspots ?? []).filter((h) => {
    const appeared = elapsed >= (h.appearAt ?? 0)
    const notEnded = h.endMs == null || elapsed <= h.endMs
    return appeared && notEnded && evaluateCondition(h.condition, ctx)
  })
}

function logLine(d: RuntimeDirective): string | undefined {
  switch (d.type) {
    case 'playClip':
      return `▶ ${getVideoClip(d.clipId)?.label ?? d.name}${d.loop ? ' (Loop)' : ''}`
    case 'dialogue':
      return `💬 ${d.lines.join(' / ')}`
    case 'openQte':
      return `⏱ QTE ×${d.qte.cueMs.length}`
    case 'openChoice':
      return `❓ 选择 ×${d.options.length}`
    case 'openBossRound':
      return `☠ 回合 ${d.roundIndex + 1}/${d.totalRounds}`
    case 'openHotspots':
      return `⊕ 热点 ×${d.hotspots.length}`
    case 'banner':
      return `🏁 ${d.kind}: ${d.title}`
    case 'log':
      return d.message
    default:
      return undefined
  }
}

function hasTieredQteOutcomes(qte: BlueprintQte): boolean {
  return !!qte.outcomeLabels?.good
}

function shouldUseBattleParryUi(scene: Scene, spec: QTESpec): boolean {
  if (!isBattleParryQte(scene)) return false
  if ((spec.cues?.length ?? 0) > 1) return false
  return !!spec.outcomeLabels?.good
}

function blueprintQteFromScene(scene: Scene, spec: QTESpec): BlueprintQte {
  const cues = spec.cues ?? []
  const sequence = spec.sequence === true
  const kind = spec.template ?? 'timing'
  return {
    kind: kind === 'parry' ? 'parry' : kind === 'mash' ? 'mash' : sequence ? 'sequence' : 'timing',
    windowMs: spec.tolerance?.good ?? 200,
    cueMs: cues.map((c) => c.appearAt),
    cues: cues.map((c) => ({
      id: c.id,
      triggerKey: c.triggerKey,
      shape: c.shape,
      durationMs: c.durationMs,
      sweepDir: c.sweepDir,
      label: c.label,
    })),
    sequence,
    timeoutMs: spec.window?.timeoutMs ?? scene.choice?.window?.timeoutMs,
    passingHits: sequence ? cues.length : Math.max(1, Math.ceil(cues.length / 2)),
    outcomeLabels: spec.outcomeLabels,
  }
}

function applyDirectives(prev: Snapshot, dirs: RuntimeDirective[]): Snapshot {
  let next: Snapshot = { ...prev }
  for (const d of dirs) {
    switch (d.type) {
      case 'playClip':
        next = {
          clip: {
            nodeId: d.nodeId,
            label: getVideoClip(d.clipId)?.label ?? d.clipId ?? d.name ?? d.nodeId,
            url: getVideoClip(d.clipId)?.url,
            type: getVideoClip(d.clipId)?.type,
            loop: d.loop,
            hud: d.hud,
            transition: d.transition?.kind,
            durationMs: d.durationMs,
            mediaId: d.mediaId,
            dmgPoints: d.dmgPoints ?? [],
          },
          interaction: { type: 'none' },
        }
        break
      case 'openQte':
        next = { ...next, interaction: { type: 'qte', qte: d.qte } }
        break
      case 'openChoice':
        next = { ...next, interaction: { type: 'choice', options: d.options } }
        break
      case 'openBossRound':
        next = {
          ...next,
          interaction: { type: 'boss', round: d.round, index: d.roundIndex, total: d.totalRounds },
        }
        break
      case 'openHotspots':
        next = { ...next, interaction: { type: 'hotspots', hotspots: d.hotspots } }
        break
      case 'banner':
        next = { ...next, interaction: { type: 'banner', kind: d.kind, title: d.title } }
        break
      default:
        break
    }
  }
  return next
}

function findBlueprintNode(
  graph: GameVideoBlueprintGraph | null,
  nodeId: string | null,
): GameVideoBlueprintNode | undefined {
  if (!graph || !nodeId) return undefined
  return (
    graph.nodes.find((n) => n.id === nodeId) ??
    Object.values(graph.subflows ?? {})
      .flatMap((subflow) => subflow.nodes)
      .find((n) => n.id === nodeId)
  )
}

function injectStyles(): void {
  injectStyleOnce(STYLE_ID, `
    .bpx-root{position:absolute;inset:0;background:#05060a;color:#f4eee2;font-family:Inter,ui-sans-serif,system-ui,sans-serif;overflow:hidden;outline:none}
    .bpx-empty{display:grid;place-items:center;height:100%;color:#9aa}
    .bpx-stage{position:absolute;inset:0}
    .bpx-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#05060a}
    .bpx-video-buffer{opacity:0;z-index:0;transition:opacity 120ms linear}
    .bpx-video-buffer.is-front{opacity:1;z-index:1}
    .bpx-video-buffer.is-back{opacity:0;z-index:0;pointer-events:none}
    .bpx-content-ui{position:absolute;inset:0;z-index:24;pointer-events:none}
    /* 视频内容矩形锚点层：定位基准=当前 contain 视频的内容矩形（同血条），z-index:auto 不建栈、子元素分层不变；容器不吃指针，交互子元素各自 pointer-events:auto */
    .bpx-content-anchor{position:absolute;inset:0;pointer-events:none}
    .bpx-unmute{position:absolute;left:20px;top:20px;z-index:65;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,224,160,.42);background:rgba(24,20,14,.82);color:#ffe6b5;font-weight:900;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.35)}
    .bpx-vignette{position:absolute;inset:0;box-shadow:inset 0 0 160px rgba(0,0,0,.82);pointer-events:none}
    .bpx-clip-tag{position:absolute;left:20px;bottom:18px;z-index:20;padding:8px 12px;border-radius:10px;background:rgba(6,8,12,.6);border:1px solid rgba(255,230,180,.16);backdrop-filter:blur(4px)}
    .bpx-clip-tag span{display:block;font-size:11px;letter-spacing:.06em;color:#ffe6b5}
    .bpx-clip-tag strong{font-size:15px}
    .bpx-floats{position:absolute;inset:0;pointer-events:none;z-index:30}
    .bpx-float{position:absolute;transform:translate(-50%,-50%);font-size:34px;font-weight:900;text-shadow:0 3px 8px #000;animation:bpx-float 1s ease-out forwards}
    .bpx-float--dmg{color:#fff3db}.bpx-float--hurt{color:#ff5656}.bpx-float--note{color:#ffe35b;font-size:22px}.bpx-float--heal{color:#66e29a}
    .bpx-qte{position:absolute;right:9%;top:34%;text-align:center;z-index:40;pointer-events:auto}
    .bpx-qte-btn{width:120px;height:120px;border-radius:50%;border:2px solid rgba(158,255,202,.9);background:radial-gradient(circle,rgba(84,255,170,.24),rgba(5,15,10,.84));color:#ddffed;font-size:18px;font-weight:900;cursor:pointer;box-shadow:0 0 28px rgba(85,255,180,.32);margin:0 6px}
    .bpx-qte-btn--good{border-color:rgba(130,190,255,.9);background:radial-gradient(circle,rgba(75,145,255,.22),rgba(5,10,22,.84));color:#dcecff;box-shadow:0 0 24px rgba(85,150,255,.28)}
    .bpx-qte-btn--fail{border-color:rgba(255,120,120,.85);background:radial-gradient(circle,rgba(255,90,90,.18),rgba(25,5,5,.86));color:#ffd9d9;box-shadow:0 0 24px rgba(255,90,90,.24)}
    .bpx-qte p{margin-top:10px;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.55);font-weight:700;font-size:13px}
    .bpx-boss{position:absolute;left:50%;bottom:130px;transform:translateX(-50%);text-align:center;z-index:40;pointer-events:auto}
    .bpx-boss p{margin:0 0 10px;font-weight:800}
    .bpx-boss-actions{display:flex;gap:14px;justify-content:center}
    .bpx-boss-actions button{padding:12px 26px;border-radius:12px;border:1px solid rgba(158,255,202,.7);background:rgba(20,40,30,.8);color:#ddffed;font-weight:900;cursor:pointer}
    .bpx-boss-miss{border-color:rgba(255,120,120,.7)!important;background:rgba(40,16,16,.8)!important;color:#ffd9d9!important}
    .bpx-banner{position:absolute;inset:0;display:grid;place-content:center;text-align:center;background:rgba(0,0,0,.5);backdrop-filter:blur(2px);z-index:50}
    .bpx-banner strong{display:block;font-size:56px;text-shadow:0 0 24px rgba(255,210,90,.6)}
    .bpx-banner--defeat strong{text-shadow:0 0 24px rgba(255,90,90,.6)}
    .bpx-banner-actions{margin-top:20px;display:flex;gap:12px;justify-content:center}
    .bpx-banner button{padding:10px 22px;border-radius:10px;border:1px solid rgba(255,224,160,.4);background:rgba(24,20,14,.8);color:#ffe6b5;font-weight:800;cursor:pointer}
    .bpx-banner-exit{background:rgba(14,14,18,.8)!important;color:#cfd6dd!important}
    .bpx-tools{position:absolute;right:20px;top:20px;display:flex;gap:8px;z-index:60;pointer-events:auto}
    .bpx-tools button{padding:8px 12px;border-radius:10px;border:1px solid rgba(255,224,160,.32);background:rgba(24,20,14,.72);color:#ffe6b5;font-weight:800;cursor:pointer}
    .bpx-tools button.is-on{background:rgba(92,255,178,.18);border-color:rgba(92,255,178,.6);color:#ddffed}
    .bpx-blueprint,.bpx-logs{position:absolute;bottom:22px;max-height:56vh;overflow:auto;padding:14px;border-radius:14px;border:1px solid rgba(255,230,180,.18);background:rgba(5,7,10,.92);z-index:60}
    .bpx-blueprint{left:22px;overflow:hidden;max-height:none;display:flex;flex-direction:column}
    .bpx-logs{right:22px;width:min(420px,40vw)}
    .bpx-logs h3{margin:0 0 10px}
    .bpx-panel-head{display:flex;align-items:center;gap:8px;margin:0 30px 10px 0;font-size:15px;font-weight:800;cursor:move;user-select:none;flex:none}
    .bpx-panel-resize{position:absolute;width:16px;height:16px;cursor:nesw-resize;z-index:3;border-color:rgba(255,224,160,.85);border-style:solid}
    .bpx-panel-resize:hover{border-color:#ffe6b5}
    .bpx-panel-resize--ne{top:8px;right:8px;border-width:2px 2px 0 0;border-radius:0 5px 0 0;cursor:nesw-resize}
    .bpx-panel-resize--se{bottom:8px;right:8px;border-width:0 2px 2px 0;border-radius:0 0 5px 0;cursor:nwse-resize}
    .bpx-sg-scroll{position:relative;flex:1;min-height:0;overflow:auto;border-radius:10px;border:1px solid rgba(255,255,255,.07);background:rgba(150,165,190,.04);background-image:linear-gradient(rgba(150,165,190,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(150,165,190,.05) 1px,transparent 1px);background-size:16px 16px}
    .bpx-sg-svg{display:block}
    .bpx-sg-group{fill:rgba(224,168,58,.05);stroke:rgba(224,168,58,.4);stroke-width:1.5;stroke-dasharray:5 4}
    .bpx-sg-group-title{fill:#e0a83a;font-size:11px;font-weight:800;font-family:inherit}
    .bpx-sg-connector{fill:none;stroke:rgba(224,168,58,.5);stroke-width:1.5;stroke-dasharray:3 3}
    .bpx-sg-edge{fill:none;stroke:#9aa7b4;stroke-width:2;opacity:.5;marker-end:url(#bpx-sg-arrow)}
    .bpx-sg-edge.is-done{stroke:#3ec98a;stroke-width:2.6;opacity:.95;marker-end:url(#bpx-sg-arrow-done)}
    .bpx-sg-node{cursor:pointer}
    .bpx-sg-box{fill:rgba(22,26,34,.96);stroke:color-mix(in srgb,var(--sgc,#4a90d8) 55%,#000);stroke-width:1.5;transition:stroke-width .1s}
    .bpx-sg-node:hover .bpx-sg-box{stroke:var(--sgc,#4a90d8);stroke-width:2.2}
    .bpx-sg-node.is-ran .bpx-sg-box{fill:rgba(30,70,52,.9);stroke:#3ec98a;stroke-width:1.8}
    .bpx-sg-node.is-active .bpx-sg-box{fill:rgba(24,60,44,.95);stroke:#5cffb2;stroke-width:2.6;filter:drop-shadow(0 0 8px rgba(92,255,178,.9));animation:bpx-sg-pulse 1.4s ease-in-out infinite}
    .bpx-sg-label{fill:#f4eee2;font-size:12px;font-weight:700;font-family:inherit;pointer-events:none}
    .bpx-sg-node.is-active .bpx-sg-label{fill:#eafff5}
    .bpx-sg-badge{fill:#9aa6b6;font-size:10px;font-family:inherit;pointer-events:none}
    .bpx-sg-badge.is-subflow{fill:#e0a83a}
    .bpx-sg-empty{position:absolute;inset:0;display:grid;place-items:center;color:#9aa6b6;font-size:12px}
    .bpx-sg-hint{margin-top:8px;font-size:11px;color:rgba(255,255,255,.5);display:flex;align-items:center;gap:5px}
    .bpx-sg-lg{display:inline-block;width:9px;height:9px;border-radius:2px;margin-left:6px}
    .bpx-sg-lg-ran{background:#3ec98a}
    .bpx-sg-lg-cur{background:#5cffb2;box-shadow:0 0 6px rgba(92,255,178,.9)}
    @keyframes bpx-sg-pulse{0%,100%{filter:drop-shadow(0 0 5px rgba(92,255,178,.55))}50%{filter:drop-shadow(0 0 11px rgba(92,255,178,.95))}}
    @keyframes bpx-float{0%{opacity:0;transform:translate(-50%,10px) scale(.8)}20%{opacity:1}100%{opacity:0;transform:translate(-50%,-82px) scale(1.12)}}
    .bpx-logs ol{margin:0 0 10px;padding-left:18px;display:flex;flex-direction:column;gap:4px;font-size:12px}
    .bpx-logs pre{white-space:pre-wrap;font-size:11px;color:#bfe4ff;background:rgba(255,255,255,.05);padding:10px;border-radius:10px;margin:0}
  `)
}
