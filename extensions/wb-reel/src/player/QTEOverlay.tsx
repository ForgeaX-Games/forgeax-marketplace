import { useEffect, useMemo, useRef, useState } from 'react'
import type { QTECue, QTECueShape, QTESpec } from '../scenario/types'
import {
  CUE_RING_TARGET_SCALE,
  cueIsExpired,
  cueProgress,
  cueRingScale,
  shouldRenderCue,
  shouldRunExpiryCheck,
  type HitVerdict,
} from '../qte/QTEEngine'
import { isQTEKeyEvent, pickKeyboardCue } from '../qte/cueKeybinding'
import {
  resolveSweep,
  startSweep,
  updateSweep,
  type SweepState,
  type SweepUpdate,
} from '../qte/sweepGesture'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * splash 飘字时间窗——cue 在判定窗口结束后还会保留这么久播 PERFECT/MISS 字样。
 * 必须 ≥ `@keyframes ks-splash` 的总时长（720ms）+ 一点冗余，否则飘字会被中途裁掉。
 */
const SPLASH_TAIL_MS = 800

/**
 * 进入"绝佳判定圈"的 progress 半径。
 *
 * 飞入环在 |progress - 1| ≤ 这个值时被视为"接近最佳命中"，目标框
 * （PERFECT 框）应该高亮提示玩家"就是这一刻"。15% 对应大约 GREAT
 * 评级宽度的视觉提示，比纯 PERFECT 窗口宽一点点（让玩家看得见）。
 */
const NEAR_PERFECT_RADIUS = 0.15

interface ActiveSweep {
  cueId: string
  pointerId: number
}
interface Props {
  spec: QTESpec
  elapsed: number
  verdicts: HitVerdict[]
  /**
   * 玩家触发判定回调。
   * deltaMs = clickAt - cue.targetAt  （可正可负）
   * holdMs（hold 类型才传）= 实际按住时长
   */
  onResolve: (cue: QTECue, deltaMs: number, holdMs?: number) => void
  /**
   * 根容器的 ambient modifier class，由调用方根据"背景是否有画面"决定。
   * 见 ./qteAmbient.ts —— 没画面时传 'is-bg-empty'，CSS 据此关掉循环
   * 脉动，避免 cue 在黑底上"闪蓝"。
   */
  ambientClass?: string
}

interface ActiveHold {
  cueId: string
  startMs: number
  /** 由谁开始：'mouse' 用于鼠标按下，'keyboard' 用于 Space/Enter 按住 */
  source: 'mouse' | 'keyboard'
}

/**
 * QTEOverlay —— 节奏点视觉层
 *
 * 视觉语言：
 *   - 一个**外环**从大向内收缩（飞入命中点）—— 白色玻璃质感
 *   - 中心**类型色**实心点：tap=cyan / hold=magenta / sweep=amber / trigger(slowMo)=rose
 *   - **目标环**固定不动：飞入环撞进它身上 = PERFECT 时机
 *   - **触发提示徽章**："Space / 左键" 浮在 cue 下方，未命中前持续脉冲
 *   - **hold 进度弧**：玩家按住后沿目标环画进度，达成 durationMs → 自动 release
 *   - **sweep 方向箭头**：cue.sweepDir 决定箭头朝向
 *   - 玩家点击 → 立即出现一个 0.4s 的判定 splash（PERFECT/GREAT/...）
 *   - 错过 → 红色一闪
 *
 * 输入支持：
 *   - 鼠标左键：mousedown / mouseup（hold 用）
 *   - 触屏：touchstart / touchend
 *   - 键盘：Space 或 Enter（hold = keydown→keyup 计时）
 *     键盘命中策略见 ../qte/cueKeybinding.ts —— 选当前 |targetAt − now| 最近的 live cue。
 */
export function QTEOverlay({ spec, elapsed, verdicts, onResolve, ambientClass }: Props) {
  const resolvedIds = useMemo(
    () => new Set(verdicts.map((v) => v.cueId)),
    [verdicts],
  )
  const now = elapsed

  /** 鼠标 hold 开始时间表 —— 用 ref 避免每次 mousedown 都触发重渲 */
  const holdStartRef = useRef<Map<string, number>>(new Map())

  /**
   * 当前正在被「按住」的 cue（hold 类型专用）。
   * 单一槽位 —— 同一时刻只允许一个 hold 处于活跃。
   * 写入 React state 是为了让进度弧能跟着 elapsed 重渲。
   */
  const [activeHold, setActiveHold] = useState<ActiveHold | null>(null)
  const activeHoldRef = useRef<ActiveHold | null>(null)
  activeHoldRef.current = activeHold

  /**
   * 当前正在拖动的 sweep（sweep 类型专用）。
   * 同样单槽位；state 驱动 trail 重渲。
   */
  const [activeSweep, setActiveSweep] = useState<ActiveSweep | null>(null)
  const sweepStateRef = useRef<SweepState | null>(null)
  const [sweepUpdate, setSweepUpdate] = useState<SweepUpdate | null>(null)

  /**
   * 桥接最新的 spec / verdicts / onResolve / now → 让键盘 effect 只挂载一次，
   * 否则每帧 elapsed 变都要重新 add/removeEventListener，键盘事件容易丢。
   */
  const ctxRef = useRef({ spec, verdicts, now, onResolve })
  ctxRef.current = { spec, verdicts, now, onResolve }

  /**
   * 上一拍的 elapsed，用于过滤"场景切换瞬间 elapsed 还没归零"的脏帧。
   * 详见 shouldRunExpiryCheck 的注释。
   */
  const lastSeenNowRef = useRef<number | null>(null)
  const lastSpecRef = useRef<QTESpec | null>(null)

  useEffect(() => {
    if (lastSpecRef.current !== spec) {
      lastSpecRef.current = spec
      lastSeenNowRef.current = null
      // 切场景时清掉残留的 hold / sweep 状态，避免新场景里飘一道"幽灵进度"
      activeHoldRef.current = null
      setActiveHold(null)
      holdStartRef.current.clear()
      sweepStateRef.current = null
      setActiveSweep(null)
      setSweepUpdate(null)
    }
    const prev = lastSeenNowRef.current
    lastSeenNowRef.current = now
    if (!shouldRunExpiryCheck(prev, now)) return
    for (const c of spec.cues) {
      if (resolvedIds.has(c.id)) continue
      // hold 类不走超时 MISS：作者反馈"保持到时间就行"，没按也不该弹 miss；
      // 玩家不按则 hold 静默掠过（不进结算，不扣分），视觉上也没有外圈收缩暗示时机。
      if (c.shape === 'hold') continue
      if (cueIsExpired(c, spec.window, now)) {
        ctxRef.current.onResolve(c, Number.POSITIVE_INFINITY, 0)
      }
    }
  }, [now, spec, resolvedIds])

  /** hold 自动释放：按住时长 ≥ cue.durationMs 时立刻 commit verdict，省得玩家继续按 */
  useEffect(() => {
    if (!activeHold) return
    const cue = spec.cues.find((c) => c.id === activeHold.cueId)
    if (!cue || cue.shape !== 'hold' || cue.durationMs == null) return
    if (now - activeHold.startMs < cue.durationMs) return
    // 已达成目标长度 —— 自动释放
    const delta = activeHold.startMs - cue.targetAt
    const holdMs = now - activeHold.startMs
    holdStartRef.current.delete(cue.id)
    activeHoldRef.current = null
    setActiveHold(null)
    ctxRef.current.onResolve(cue, delta, holdMs)
  }, [now, activeHold, spec])

  // ── 键盘绑定（Space / Enter） ──────────────────────────────────────
  useEffect(() => {
    let keyDown = false
    function onKeyDown(e: KeyboardEvent): void {
      if (!isQTEKeyEvent(e)) return
      // 浏览器在 hold 时会持续触发 keydown（auto-repeat）—— 必须自己去重
      if (e.repeat || keyDown) {
        e.preventDefault()
        return
      }
      const ctx = ctxRef.current
      const cue = pickKeyboardCue(ctx.spec.cues, ctx.verdicts, ctx.spec.window, ctx.now)
      if (!cue) return
      e.preventDefault()
      keyDown = true
      if (cue.shape === 'hold') {
        // 已经有别的 hold 占用 → 不抢（避免乱）
        if (activeHoldRef.current) return
        holdStartRef.current.set(cue.id, ctx.now)
        const next: ActiveHold = {
          cueId: cue.id,
          startMs: ctx.now,
          source: 'keyboard',
        }
        activeHoldRef.current = next
        setActiveHold(next)
      } else {
        const delta = ctx.now - cue.targetAt
        ctx.onResolve(cue, delta)
      }
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (!isQTEKeyEvent(e)) return
      keyDown = false
      const held = activeHoldRef.current
      if (!held || held.source !== 'keyboard') return
      const cue = ctxRef.current.spec.cues.find((c) => c.id === held.cueId)
      if (!cue || cue.shape !== 'hold') return
      const start = holdStartRef.current.get(cue.id)
      if (start == null) return
      holdStartRef.current.delete(cue.id)
      activeHoldRef.current = null
      setActiveHold(null)
      const delta = start - cue.targetAt
      const holdMs = ctxRef.current.now - start
      ctxRef.current.onResolve(cue, delta, holdMs)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  return (
    <div className={`ks-qte-layer${ambientClass ? ` ${ambientClass}` : ''}`}>
      {spec.cues.map((cue) => {
        const verdict = verdicts.find((v) => v.cueId === cue.id)
        if (!shouldRenderCue(cue, spec.window, now, !!verdict, SPLASH_TAIL_MS)) {
          return null
        }
        const p = cueProgress(cue, now)
        const isHolding = activeHold?.cueId === cue.id
        const holdProgress =
          isHolding && cue.durationMs != null && cue.durationMs > 0
            ? Math.min(1, (now - activeHold!.startMs) / cue.durationMs)
            : 0
        const isSweeping = activeSweep?.cueId === cue.id
        const sweepUpd = isSweeping ? sweepUpdate : null
        return (
          <Cue
            key={cue.id}
            cue={cue}
            progress={p}
            verdict={verdict ?? null}
            disabled={!!verdict}
            isHolding={isHolding}
            holdProgress={holdProgress}
            isSweeping={isSweeping}
            sweepUpdate={sweepUpd}
            onPointerDown={(e) => {
              if (verdict) return
              if (cue.shape === 'hold') {
                if (activeHoldRef.current) return
                holdStartRef.current.set(cue.id, now)
                const next: ActiveHold = {
                  cueId: cue.id,
                  startMs: now,
                  source: 'mouse',
                }
                activeHoldRef.current = next
                setActiveHold(next)
              } else if (cue.shape === 'sweep') {
                // 起点取 cue 中心（cue.x/y 归一化），sweep 相对位移看 pointer 位置
                // pointercapture 保证拖到 cue 外部也能继续收到 move 事件
                const el = e.currentTarget
                try {
                  el.setPointerCapture(e.pointerId)
                } catch {
                  /* Safari 早期偶尔失败，不致命 */
                }
                sweepStateRef.current = startSweep(
                  e.clientX,
                  e.clientY,
                  cue.sweepDir ?? 'right',
                  { minDistancePx: 56 },
                )
                setActiveSweep({ cueId: cue.id, pointerId: e.pointerId })
                setSweepUpdate({
                  distance: 0,
                  progress: 0,
                  reachedThreshold: false,
                  onAxis: true,
                })
              } else {
                const delta = now - cue.targetAt
                onResolve(cue, delta)
              }
            }}
            onPointerMove={(e) => {
              if (!isSweeping) return
              const s = sweepStateRef.current
              if (!s) return
              const { next, update } = updateSweep(s, e.clientX, e.clientY)
              sweepStateRef.current = next
              setSweepUpdate(update)
            }}
            onPointerUp={(e) => {
              if (verdict) return
              if (cue.shape === 'hold') {
                const held = activeHoldRef.current
                if (!held || held.source !== 'mouse' || held.cueId !== cue.id) return
                const start = holdStartRef.current.get(cue.id)
                if (start == null) return
                holdStartRef.current.delete(cue.id)
                activeHoldRef.current = null
                setActiveHold(null)
                const delta = start - cue.targetAt
                const holdMs = now - start
                onResolve(cue, delta, holdMs)
              } else if (cue.shape === 'sweep') {
                const s = sweepStateRef.current
                if (!s) return
                const resolution = resolveSweep(s)
                try {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                } catch {
                  /* 已释放 */
                }
                sweepStateRef.current = null
                setActiveSweep(null)
                setSweepUpdate(null)
                if (resolution === 'HIT') {
                  const delta = now - cue.targetAt
                  onResolve(cue, delta)
                } else {
                  // WRONG_DIR / TOO_SHORT 按 MISS 处理（deltaMs=Infinity 让 judgeTap
                  // 走 MISS 分支，与"完全错过"语义一致）
                  onResolve(cue, Number.POSITIVE_INFINITY)
                }
              }
            }}
            onPointerCancel={() => {
              // 鼠标离开窗口 / 系统手势抢占 → 清 sweep / hold，避免卡死
              if (cue.shape === 'sweep' && isSweeping) {
                sweepStateRef.current = null
                setActiveSweep(null)
                setSweepUpdate(null)
              }
              if (cue.shape === 'hold' && isHolding) {
                holdStartRef.current.delete(cue.id)
                activeHoldRef.current = null
                setActiveHold(null)
              }
            }}
          />
        )
      })}
    </div>
  )
}

interface CueProps {
  cue: QTECue
  progress: number
  verdict: HitVerdict | null
  disabled: boolean
  isHolding: boolean
  /** 0..1，hold 完成度（hold cue 才用得上） */
  holdProgress: number
  /** sweep cue 当前是否在被拖动 */
  isSweeping: boolean
  /** sweep cue 当前的拖动状态（距离/方向等），未拖动时为 null */
  sweepUpdate: SweepUpdate | null
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => void
}

/** 英文 verdict → 中文副标，跟玩家口语一致 */
const JUDGE_CN: Record<HitVerdict['judgement'], string> = {
  PERFECT: '完美',
  GREAT: '良好',
  GOOD: '普通',
  MISS: '错过',
}

/** shape → 触发徽章上的中文动作动词 */
const SHAPE_VERB: Record<QTECueShape, string> = {
  tap: '点击',
  hold: '保持',
  sweep: '划动',
}

/**
 * 触发提示的"动作符号"—— 作者 2026-05-07 反馈：原来挂了 `SPACE / 左键 · 点击`
 *   三段文字外加两个方框键帽，太啰嗦。改成一个鼠标图标 + 单个形状缩略符：
 *     tap   → 🖱 ·    （瞬时点一下）
 *     hold  → 🖱 ━    （按住）
 *     sweep → 🖱 → / ← / ↑ / ↓  （按 sweepDir 走的箭头）
 *   键盘 SPACE 也照常工作（cueKeybinding），只是不在画面上宣告；视觉干净是主。
 */
const SHAPE_GLYPH: Record<QTECueShape, string> = {
  tap: '·',
  hold: '━',
  sweep: '→', // 默认向右；sweep 下方在渲染时用 sweepDir 覆盖
}
const SWEEP_ARROW: Record<'up' | 'down' | 'left' | 'right', string> = {
  right: '→',
  left: '←',
  up: '↑',
  down: '↓',
}

function Cue({
  cue,
  progress,
  verdict,
  disabled,
  isHolding,
  holdProgress,
  isSweeping,
  sweepUpdate,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: CueProps) {
  // 飞入环 scale —— progress=1 时正好等于 CUE_RING_TARGET_SCALE，与目标框完全重合 = PERFECT 时机
  const ringScale = cueRingScale(progress)
  // 飞入环离目标框越近，目标框越亮；|progress-1| 在 NEAR_PERFECT_RADIUS 内进入高亮
  const peakDistance = Math.abs(progress - 1)
  const peakIntensity = Math.max(0, 1 - peakDistance / NEAR_PERFECT_RADIUS)
  const isNearPerfect = peakIntensity > 0
  const judgement = verdict?.judgement ?? null
  const splashClass = judgement
    ? judgement === 'PERFECT'
      ? 'splash-perfect'
      : judgement === 'GREAT'
        ? 'splash-great'
        : judgement === 'GOOD'
          ? 'splash-good'
          : 'splash-miss'
    : ''
  const isTrigger = !!cue.slowMo
  const sweepProgress = sweepUpdate?.progress ?? 0
  const sweepOnAxis = sweepUpdate ? sweepUpdate.onAxis : true

  return (
    <div
      role="button"
      tabIndex={-1}
      draggable={false}
      aria-disabled={disabled}
      className={`ks-cue shape-${cue.shape} ${disabled ? 'is-resolved' : ''} ${
        isTrigger ? 'is-trigger' : ''
      } ${isHolding ? 'is-holding' : ''} ${isSweeping ? 'is-sweeping' : ''} ${
        isSweeping && !sweepOnAxis ? 'is-offaxis' : ''
      }`}
      style={
        {
          left: `${cue.x * 100}%`,
          top: `${cue.y * 100}%`,
          // 把 CUE_RING_TARGET_SCALE 暴露给 CSS（命中环与飞入环 scale=1 严格对齐）
          '--ks-target-scale': CUE_RING_TARGET_SCALE,
          '--ks-peak': peakIntensity.toFixed(3),
          '--ks-hold-progress': holdProgress.toFixed(3),
          '--ks-sweep-progress': sweepProgress.toFixed(3),
          // 给 hold 进度弧的 CSS 动画用：按下后以严格 durationMs 画满圈。
          // 非 hold 或没设 durationMs 时该 var 不会被消费，写上也不副作用。
          '--ks-cue-hold-duration':
            cue.shape === 'hold' && cue.durationMs != null && cue.durationMs > 0
              ? `${cue.durationMs}ms`
              : '0ms',
        } as React.CSSProperties
      }
      onPointerDown={(e) => {
        if (disabled) return
        // 按下瞬间：浏览器仍可能把这一下解释成"拖拽锚点"，直接 preventDefault
        // （pointerdown 的默认行为里包含 mouse-focused drag init）
        e.preventDefault()
        onPointerDown(e)
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={(e) => {
        // 只对 hold 起作用——拖出按钮也算释放，避免卡死 hold
        // sweep 有 pointercapture 保护，不走这里
        if (cue.shape === 'hold') onPointerUp(e)
      }}
      // 彻底禁掉原生拖拽（cue 上偶尔有图标/文字节点，浏览器会当可拖）
      onDragStart={(e) => e.preventDefault()}
    >
      {/*
       * 飞入外环 —— 白色细环从 2x 缩小到 1x（撞进 target-ring = PERFECT）。
       * 只在"incoming"阶段有感，到达目标后由 CSS 透明度弱化。
       *
       * hold 不渲染外环：作者反馈"保持到时间就行，别加啥收缩了"。hold 本质
       * 是"按住凑时长"的节奏点，玩家不需要对时机——外环收缩反而误导玩家
       * 以为存在卡帧的 timing 窗口。视觉只保留 target-ring + HOLD 字样 + 进度弧。
       */}
      {cue.shape !== 'hold' && (
        <span
          className="ks-cue-ring"
          style={{ transform: `translate(-50%, -50%) scale(${ringScale})` }}
          aria-hidden
        />
      )}

      {/*
       * 最佳触发靶圈 —— **虚线 dashed** 常驻，明确告知"这就是 PERFECT 圈"。
       * 接近 peak 时变实线金色并脉冲。4 个 tick 放在圈上当定向指示。
       * 类型专属内容（HOLD 大字 / SWEEP 箭头）都渲染到这个圈的内部，
       * 让"最佳触发 + 触发方式"视觉上是同一个锚点。
       */}
      <span
        className={`ks-cue-target shape-${cue.shape} ${isNearPerfect ? 'is-peak' : ''}`}
        aria-hidden
      >
        <span className="ks-cue-target-ring">
          <span className="ks-cue-tick ks-cue-tick-n" />
          <span className="ks-cue-tick ks-cue-tick-s" />
          <span className="ks-cue-tick ks-cue-tick-e" />
          <span className="ks-cue-tick ks-cue-tick-w" />

          {/* TAP：中心小点，轻量指示"点击此处" */}
          {cue.shape === 'tap' && (
            <span className="ks-cue-inner-tap" aria-hidden />
          )}

          {/* HOLD：中心 "HOLD" 字样 + 长按图标，让玩家一眼识别"按住而非单击" */}
          {cue.shape === 'hold' && (
            <span className="ks-cue-inner-hold ks-mono" aria-hidden>HOLD</span>
          )}

          {/* SWEEP：箭头放在圈内，从中心朝 dir 方向指出；不再跑到圈外 */}
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

      {/*
       * HOLD 进度弧 —— 时长严格对齐 cue.durationMs。
       *
       * 早期实现：每帧从 React 读 holdProgress 改 strokeDashoffset。
       * 问题：Player 的 elapsed 以 33ms 为周期 commit（性能限频），再套
       * 80ms 的 CSS transition 做"平滑"，结果是：
       *   1) 弧每 33ms 跳一档，肉眼可见颗粒
       *   2) transition 永远滞后真值一个窗口，"1s 按住结束"时弧还差一截
       * 作者反馈"调到 1s 就 1s 刚好转满" —— 真正诉求是"时长严格 = durationMs"，
       * 而不是"每帧都重新计算进度"。
       *
       * 新方案（v3.9.12）：按下瞬间 dashoffset 从 C（空圈）直接跳到 0（满圈），
       * 配合 `transition: stroke-dashoffset <durationMs> linear` —— 浏览器 GPU
       * 合成器用 durationMs 做插值，既平滑又严格（1000ms 动画 = 1000ms 实时）。
       * 松手时 isHolding → false，dashoffset 瞬间回到 C（空圈），无尾动画。
       * 进度真值仍由 judgeHold 独立判定（holdMs/durationMs），视觉与判定解耦。
       */}
      {cue.shape === 'hold' && (
        <svg className="ks-cue-hold-arc" viewBox="0 0 100 100" aria-hidden>
          <circle className="ks-cue-hold-arc-track" cx="50" cy="50" r="46" />
          <circle
            className="ks-cue-hold-arc-fill"
            cx="50"
            cy="50"
            r="46"
            style={{
              strokeDasharray: 2 * Math.PI * 46,
              strokeDashoffset: isHolding ? 0 : 2 * Math.PI * 46,
              // 按下时用 durationMs 做 transition；松手瞬间复位不要 transition
              transitionProperty: 'stroke-dashoffset',
              transitionDuration: isHolding ? 'var(--ks-cue-hold-duration, 0ms)' : '0ms',
              transitionTimingFunction: 'linear',
            }}
          />
        </svg>
      )}

      {cue.label && <span className="ks-cue-label ks-mono">{cue.label}</span>}

      {/*
       * 触发提示 —— v3.9.11 极简化（作者反馈）：一个鼠标图标 + 动作缩略符，
       *   不再写"SPACE / 左键 点击"这种带方框的长串。
       *   SHAPE_VERB 仍保留做 aria-label，给读屏用户兜底；视觉层只有俩字符。
       */}
      {!verdict && (
        <span
          className="ks-cue-key-hint ks-mono"
          aria-label={`鼠标左键 · ${SHAPE_VERB[cue.shape]}`}
        >
          <span className="ks-cue-key-hint-mouse" aria-hidden>🖱</span>
          <span className="ks-cue-key-hint-glyph" aria-hidden>
            {cue.shape === 'sweep'
              ? SWEEP_ARROW[cue.sweepDir ?? 'right']
              : SHAPE_GLYPH[cue.shape]}
          </span>
        </span>
      )}

      {judgement && (
        <span className={`ks-cue-splash ${splashClass}`}>
          <span className="ks-cue-splash-en">{judgement}</span>
          <span className="ks-cue-splash-cn ks-cn">{JUDGE_CN[judgement]}</span>
        </span>
      )}

      {/*
       * HOLD · 按下瞬间涨潮涟漪（CSS keyframes 驱动）。
       * is-holding class 一加上，.ks-cue-ripple 的 animation 就跑一次。
       * 玩家松手 → is-holding 去掉 → 元素 remount，ripple 自动复位。
       */}
      {cue.shape === 'hold' && isHolding && (
        <span className="ks-cue-ripple" aria-hidden />
      )}

      {/*
       * HOLD · 持续按住期间的"能量聚集"反馈（v3.6）。
       * 两层：
       *   - aura：脚下柔光圈，持续呼吸（scale + opacity 周期脉动）
       *   - core：内部实心光核，跟 holdProgress 同步增长 → 强化"能量在聚集"
       * 松手立即消失，玩家一眼能看出"按住中"和"没按住"。
       */}
      {cue.shape === 'hold' && isHolding && (
        <>
          <span className="ks-cue-hold-aura" aria-hidden />
          <span className="ks-cue-hold-core" aria-hidden />
        </>
      )}

      {/*
       * SWEEP · 拖动 trail —— 从 cue 中心沿 sweepDir 伸出一段淡色长条，
       * 长度由 sweepProgress（0..1）驱动；方向错时 trail 变红提示。
       * 只在正在拖动时渲染，以免干扰静态视觉。
       */}
      {cue.shape === 'sweep' && isSweeping && (
        <span
          className={`ks-cue-sweep-trail dir-${cue.sweepDir ?? 'right'} ${
            !sweepOnAxis ? 'is-offaxis' : ''
          }`}
          aria-hidden
        />
      )}
    </div>
  )
}

const layerCss = `
.ks-qte-layer {
  position: absolute; inset: 0;
  z-index: 25;
  pointer-events: none;
}

/* ── cue 容器 + 类型 token ─────────────────────────────
 * 每种 shape 有两套色 token：
 *   --ks-cue-tint        柔光底色（透明）
 *   --ks-cue-tint-strong 实心强调色（核心 / 触发徽章高亮）
 */
.ks-cue {
  --ks-cue-tint: rgba(255, 255, 255, 0.55);
  --ks-cue-tint-strong: #ffffff;
  position: absolute;
  width: 96px; height: 96px;
  transform: translate(-50%, -50%);
  background: transparent;
  border: 0;
  pointer-events: auto;
  cursor: pointer;
  outline: 0;
  animation: ks-cue-fade-in 220ms ease-out both;
}
/*
 * 透明命中扩展区 —— 视觉仍是 96×96，但实际可点击区域扩到 160×160。
 * 作者反馈"点击热区太小不容易打中"。这里用 ::before 而不是改 .ks-cue
 * 自身尺寸是为了不影响内部所有 % 布局的元素（target-ring / arrow / hold-core
 * 全都按百分比写，父容器变大 = 视觉跟着变大）。
 * 注意：resolved 后父元素 pointer-events:none 会让 ::before 也失效，符合预期。
 */
.ks-cue::before {
  content: '';
  position: absolute;
  left: 50%; top: 50%;
  width: 160px; height: 160px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: transparent;
  pointer-events: auto;
  z-index: 0;
}
.ks-cue.shape-tap {
  --ks-cue-tint: rgba(125, 211, 252, 0.55);
  --ks-cue-tint-strong: #7dd3fc;
}
.ks-cue.shape-hold {
  --ks-cue-tint: rgba(244, 114, 182, 0.55);
  --ks-cue-tint-strong: #f472b6;
}
.ks-cue.shape-sweep {
  --ks-cue-tint: rgba(232, 162, 58, 0.55);
  --ks-cue-tint-strong: #e8a23a;
}
/* trigger（slowMo）覆写所有 shape，用红色统一警示 */
.ks-cue.is-trigger {
  --ks-cue-tint: rgba(251, 113, 133, 0.55);
  --ks-cue-tint-strong: #fb7185;
}
.ks-cue.is-resolved { pointer-events: none; cursor: default; }
@keyframes ks-cue-fade-in {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
  to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}

/*
 * 类型色柔光底 & 中心核 —— v3.3 已废弃。
 * 作者反馈"圆形太多"，glow + ring + target-ring + core 四层圆叠加视觉混乱，
 * 无法判断"哪一圈是最佳触发时机"。现在只保留两层：
 *   ks-cue-ring       —— 飞入外环（弱淡白，仅做"节奏飞入"动效）
 *   ks-cue-target-ring —— 最佳触发圈（虚线，is-peak 时实线金色脉冲）
 * glow / core 的 DOM 节点已从 JSX 移除；为了防止未来外部注入的样式再次启用，
 * 用 display:none 显式屏蔽。
 */
.ks-cue-glow, .ks-cue-core { display: none !important; }

/*
 * 飞入外环 —— 弱化为"淡白细圈"。它不再是主视觉焦点，目的只是给玩家
 * 一个"节奏正在靠近"的收缩动画。撞进 target-ring 就是 PERFECT 时机。
 */
.ks-cue-ring {
  position: absolute;
  left: 50%; top: 50%;
  width: 100%; height: 100%;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.55);
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.25);
  background: transparent;
  transition: transform 70ms linear, opacity 120ms;
  pointer-events: none;
}

/* ── PERFECT 命中环（主视觉：虚线靶圈） ────────────────
 * 常驻显示"这就是最佳触发点"的虚线圆圈，玩家无需猜测。
 * 飞入环撞上这一圈 → is-peak → 切到实心金色，并脉冲放大。
 */
.ks-cue-target {
  position: absolute;
  left: 50%; top: 50%;
  width: 100%; height: 100%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.ks-cue-target-ring {
  position: absolute;
  left: 50%; top: 50%;
  width: calc(100% * var(--ks-target-scale, 0.6));
  height: calc(100% * var(--ks-target-scale, 0.6));
  border-radius: 50%;
  /* 虚线 —— 作者明确要求"最佳触发圈用虚线" */
  border: 2px dashed var(--ks-cue-tint-strong);
  background: radial-gradient(
    circle,
    transparent 62%,
    rgba(255, 255, 255, calc(0.05 + 0.18 * var(--ks-peak, 0))) 82%,
    transparent 100%
  );
  box-shadow:
    0 0 calc(4px + 14px * var(--ks-peak, 0)) var(--ks-cue-tint),
    inset 0 0 calc(3px + 8px * var(--ks-peak, 0)) rgba(255, 255, 255, 0.2);
  transform: translate(-50%, -50%) scale(calc(1 + 0.06 * var(--ks-peak, 0)));
  transition:
    border-style 80ms linear,
    border-color 80ms linear,
    border-width 80ms linear,
    box-shadow 60ms linear,
    transform 60ms linear;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}
.ks-cue-target.is-peak .ks-cue-target-ring {
  /* 命中瞬间：虚线 → 实线金色，并放大一档 */
  border-style: solid;
  border-color: var(--ks-perfect, #fde047);
  border-width: 2.75px;
  animation: ks-cue-target-peak 360ms ease-out infinite alternate;
}
@keyframes ks-cue-target-peak {
  from { box-shadow: 0 0 12px rgba(253, 224, 71, 0.55), inset 0 0 6px rgba(253, 224, 71, 0.3); }
  to   { box-shadow: 0 0 28px rgba(253, 224, 71, 0.95), inset 0 0 10px rgba(253, 224, 71, 0.55); }
}

/* 4 个定位刻度 —— 贴在 target-ring 的 4 个方位，相当于"准星"
 * is-peak 时变金色+变长，强化"就是这一刻"的视觉冲击。
 * 注意：与旧版不同，tick 位置固定在 target-ring 的边缘（其父容器是 target-ring 而非 target），
 * 由于我们用 flex 居中子元素，这里改成 absolute 直接定位在 ring 的 0%/100% 边界。
 */
.ks-cue-tick {
  position: absolute;
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 calc(3px + 10px * var(--ks-peak, 0)) rgba(255, 255, 255, 0.7);
  opacity: calc(0.55 + 0.45 * var(--ks-peak, 0));
  pointer-events: none;
}
.ks-cue-tick-n, .ks-cue-tick-s {
  left: 50%;
  width: 2px;
  height: 7px;
  transform: translateX(-50%);
}
.ks-cue-tick-e, .ks-cue-tick-w {
  top: 50%;
  width: 7px;
  height: 2px;
  transform: translateY(-50%);
}
.ks-cue-tick-n { top: -9px; }
.ks-cue-tick-s { bottom: -9px; }
.ks-cue-tick-w { left: -9px; }
.ks-cue-tick-e { right: -9px; }
.ks-cue-target.is-peak .ks-cue-tick-n,
.ks-cue-target.is-peak .ks-cue-tick-s {
  height: 10px;
  background: var(--ks-perfect, #fde047);
}
.ks-cue-target.is-peak .ks-cue-tick-e,
.ks-cue-target.is-peak .ks-cue-tick-w {
  width: 10px;
  background: var(--ks-perfect, #fde047);
}

/* ── TAP 内圈小点 ──────────────────────────────────────
 * 轻量指示"点击此处"，一个 6px 的小圆点放在 target-ring 中央。
 * 不喧宾夺主，只是告诉玩家有个触点。
 */
.ks-cue-inner-tap {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--ks-cue-tint-strong);
  box-shadow:
    0 0 8px var(--ks-cue-tint-strong),
    0 0 14px var(--ks-cue-tint);
  animation: ks-cue-inner-tap-pulse 1.1s ease-in-out infinite;
  pointer-events: none;
}
@keyframes ks-cue-inner-tap-pulse {
  0%, 100% { transform: scale(1);   opacity: 0.85; }
  50%      { transform: scale(1.8); opacity: 1;    }
}

/* ── HOLD 内圈字样 ─────────────────────────────────────
 * 圈内直接写 "HOLD"，让玩家绝不会误以为是单击。
 * 不用 ::before 在圈上方悬浮 —— 旧版就是那样，作者反馈"我还以为是单机"。
 */
.ks-cue-inner-hold {
  font-family: var(--ks-font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.34em;
  color: var(--ks-cue-tint-strong);
  text-shadow:
    0 0 8px var(--ks-cue-tint-strong),
    0 1px 2px rgba(0, 0, 0, 0.7);
  animation: ks-cue-inner-hold-breathe 1.2s ease-in-out infinite;
  pointer-events: none;
  user-select: none;
  /* 补偿 letter-spacing 右侧空白，让字符视觉居中 */
  padding-left: 0.34em;
}
@keyframes ks-cue-inner-hold-breathe {
  0%, 100% { opacity: 0.75; transform: scale(1);    }
  50%      { opacity: 1;    transform: scale(1.08); }
}
/* 玩家已经按住时：改显进度状态（外圈有 arc，内部字样淡出让位） */
.ks-cue.shape-hold.is-holding .ks-cue-inner-hold {
  opacity: 0.35;
  animation: none;
}

/* ── HOLD 进度弧 ──────────────────────────────────────
 * 沿目标环外圈画一道发光圆弧；玩家按住后由 0 → 1 顺时针填满。
 * track 总是常驻提示「这里要保持」。
 */
.ks-cue-hold-arc {
  position: absolute;
  left: 50%; top: 50%;
  width: calc(100% * var(--ks-target-scale, 0.6) + 14px);
  height: calc(100% * var(--ks-target-scale, 0.6) + 14px);
  transform: translate(-50%, -50%) rotate(-90deg);
  pointer-events: none;
}
.ks-cue-hold-arc-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.22);
  stroke-width: 3;
  stroke-dasharray: 4 3;
}
.ks-cue-hold-arc-fill {
  fill: none;
  stroke: var(--ks-cue-tint-strong);
  stroke-width: 3.5;
  stroke-linecap: round;
  filter: drop-shadow(0 0 6px var(--ks-cue-tint-strong));
  /*
   * stroke-dashoffset 的 transition 由 inline style 注入：
   *   · 按下时 transitionDuration = --ks-cue-hold-duration（= cue.durationMs）
   *     → 弧在 cue.durationMs 内从空圈平滑画到满圈，时长严格 1:1。
   *   · 松手时 transitionDuration = 0，offset 瞬时回到空圈，无尾动画。
   * 不能把 transition 写在类选择器上再用 CSS var 覆盖——部分浏览器对
   * transition-duration 取 CSS var 的级联优先级仍有坑，inline 最可靠。
   */
}
/* 旧版"HOLD 字样" ::before 已移除 —— 改成内嵌 .ks-cue-inner-hold */

/* ── SWEEP 方向箭头 ───────────────────────────────────
 * v3.3 · 箭头迁移到 target-ring **内部**（JSX 中已挪）
 *
 * 旧版把箭头放在 cue 顶层，长度 70% 从中心射出 —— 箭头头实际跑到
 * cue 容器外 35%，作者反馈"箭头都去外面了"。
 *
 * 新版做法：
 *   - 箭头放进 .ks-cue-target-ring（虚线靶圈）的 flex 容器里
 *   - 总长度 <= 靶圈直径 * 0.8，头尾都不会越出靶圈
 *   - trail 从左侧透明渐变到右端实色；head 紧贴 trail 右端
 *   - 整体按 cue.sweepDir 围绕自身中心旋转
 */
.ks-cue-sweep-arrow {
  position: relative;
  /* 80% 当前靶圈宽（即 100% 的 ring width，因为 ring 是 flex 容器撑满） */
  width: 80%;
  height: 10px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  transform: rotate(var(--sweep-rot, 0deg));
  pointer-events: none;
  --sweep-rot: 0deg;
}
.ks-cue-sweep-arrow.dir-right { --sweep-rot:   0deg; }
.ks-cue-sweep-arrow.dir-down  { --sweep-rot:  90deg; }
.ks-cue-sweep-arrow.dir-left  { --sweep-rot: 180deg; }
.ks-cue-sweep-arrow.dir-up    { --sweep-rot: 270deg; }
.ks-cue-sweep-arrow-trail {
  position: absolute;
  left: 0; right: 10px;
  top: 50%;
  height: 3px;
  transform: translateY(-50%);
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.15) 25%,
    var(--ks-cue-tint-strong) 90%,
    var(--ks-cue-tint-strong) 100%
  );
  border-radius: 2px;
  filter: drop-shadow(0 0 6px var(--ks-cue-tint-strong));
  animation: ks-cue-sweep-flow 1.2s ease-in-out infinite;
}
.ks-cue-sweep-arrow-head {
  position: relative;
  width: 0; height: 0;
  border-top: 7px solid transparent;
  border-bottom: 7px solid transparent;
  border-left: 10px solid var(--ks-cue-tint-strong);
  filter: drop-shadow(0 0 8px var(--ks-cue-tint-strong));
}
@keyframes ks-cue-sweep-flow {
  0%, 100% { opacity: 0.7; }
  50%      { opacity: 1; }
}

/* ── 中心核 ──────────────────────────────────────────── */
.ks-cue-core {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  width: 18px; height: 18px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    #ffffff 0%,
    var(--ks-cue-tint-strong) 38%,
    transparent 80%
  );
  box-shadow:
    0 0 18px var(--ks-cue-tint-strong),
    0 0 32px var(--ks-cue-tint);
  animation: ks-glow-pulse 1.2s ease-in-out infinite;
  pointer-events: none;
}

.ks-cue-label {
  position: absolute;
  left: 50%; top: -22px;
  transform: translateX(-50%);
  font-size: 11px;
  letter-spacing: 0.26em;
  color: rgba(255, 255, 255, 0.92);
  text-shadow:
    0 0 6px var(--ks-cue-tint-strong),
    0 1px 2px rgba(0,0,0,0.85);
  white-space: nowrap;
  pointer-events: none;
}

/* ── 触发提示徽章 ─────────────────────────────────────
 * v3.9.11：极简两个字符，去掉了原来的方框 kbd 键帽 + "SPACE / 左键" 文字
 *   + 动词（"点击/保持/划动"）。现在就是「🖱 + 缩略符」靠在一起浮在 cue 下方。
 *   靠父元素 ks-cue.shape-* 的 --ks-cue-tint-strong 做颜色适配
 *   （tap=青 / hold=品红 / sweep=琥珀 / slowMo 触发色）。
 * - incoming 阶段柔脉冲吸引注意
 * - hold 状态隐藏（玩家已经在按了）
 */
.ks-cue-key-hint {
  position: absolute;
  left: 50%;
  bottom: -26px;
  transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px;
  line-height: 1;
  color: var(--ks-cue-tint-strong);
  text-shadow: 0 0 6px rgba(0, 0, 0, 0.75);
  pointer-events: none;
  white-space: nowrap;
  animation: ks-cue-hint-pulse 1.4s ease-in-out infinite;
}
.ks-cue-key-hint-mouse {
  font-size: 11px;
  opacity: 0.85;
  filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.6));
}
.ks-cue-key-hint-glyph {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  text-shadow: 0 0 6px var(--ks-cue-tint-strong);
}
.ks-cue.is-holding .ks-cue-key-hint { display: none; }
@keyframes ks-cue-hint-pulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}

/* ── 命中判定 splash ──────────────────────────────────── */
.ks-cue-splash {
  position: absolute;
  left: 50%; top: 50%;
  transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  pointer-events: none;
  animation: ks-splash 720ms cubic-bezier(0.18, 0.89, 0.32, 1.28) forwards;
}
.ks-cue-splash-en {
  font-family: var(--ks-font-mono);
  font-size: 38px;
  letter-spacing: 0.18em;
  font-weight: 800;
  line-height: 1;
  -webkit-text-stroke: 1px rgba(0, 0, 0, 0.6);
}
.ks-cue-splash-cn {
  font-size: 13px;
  letter-spacing: 0.42em;
  font-weight: 500;
  opacity: 0.92;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}
.splash-perfect .ks-cue-splash-en {
  color: var(--ks-perfect);
  text-shadow:
    0 0 6px #fff,
    0 0 18px var(--ks-perfect),
    0 0 36px rgba(253, 224, 71, 0.45);
}
.splash-perfect .ks-cue-splash-cn { color: var(--ks-perfect); }
.splash-great .ks-cue-splash-en {
  color: var(--ks-great);
  text-shadow: 0 0 14px var(--ks-great), 0 0 26px rgba(110, 231, 183, 0.45);
}
.splash-great .ks-cue-splash-cn { color: var(--ks-great); }
.splash-good .ks-cue-splash-en {
  color: var(--ks-good);
  text-shadow: 0 0 14px var(--ks-good), 0 0 26px rgba(125, 211, 252, 0.45);
}
.splash-good .ks-cue-splash-cn { color: var(--ks-good); }
.splash-miss .ks-cue-splash-en {
  color: var(--ks-miss);
  text-shadow: 0 0 14px var(--ks-miss), 0 0 26px rgba(251, 113, 133, 0.45);
  animation: ks-miss-jitter 320ms ease-out forwards;
}
.splash-miss .ks-cue-splash-cn { color: var(--ks-miss); }

@keyframes ks-splash {
  0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
  18%  { transform: translate(-50%, -50%) scale(1.35); opacity: 1; }
  60%  { transform: translate(-50%, -90%) scale(1); opacity: 1; }
  100% { transform: translate(-50%, -140%) scale(0.95); opacity: 0; }
}
@keyframes ks-miss-jitter {
  0%   { transform: translateX(0); }
  25%  { transform: translateX(-3px); }
  50%  { transform: translateX(3px); }
  75%  { transform: translateX(-2px); }
  100% { transform: translateX(0); }
}

/* ============================================================
 * HOLD · 按下瞬间反馈
 *   - cue 整体轻微缩放一下（0.92 → 1），告诉玩家"按住了"
 *   - 目标环加粗 + 金光浮起
 *   - ripple：一圈涟漪从中心涨出去，~600ms 内扩散消散
 * SWEEP · 拖动状态
 *   - 整体微放大 + 发光
 *   - trail 从中心朝 sweepDir 延展，长度跟 sweepProgress
 * ============================================================ */
.ks-cue.shape-hold.is-holding {
  animation: ks-cue-press 180ms var(--ks-ease, cubic-bezier(0.2, 0.8, 0.2, 1)) both;
}
.ks-cue.shape-hold.is-holding .ks-cue-target-ring {
  border-style: solid;
  border-width: 3px;
  box-shadow:
    0 0 18px var(--ks-cue-tint-strong),
    inset 0 0 14px var(--ks-cue-tint-strong);
}
.ks-cue.shape-hold.is-holding .ks-cue-hold-arc-fill {
  stroke-width: 5;
  filter: drop-shadow(0 0 10px var(--ks-cue-tint-strong));
}
@keyframes ks-cue-press {
  0%   { transform: translate(-50%, -50%) scale(1);    }
  40%  { transform: translate(-50%, -50%) scale(0.92); }
  100% { transform: translate(-50%, -50%) scale(1);    }
}

/* ripple：HOLD 按下瞬间涨出一圈涟漪，一次性动画 */
.ks-cue-ripple {
  position: absolute;
  left: 50%; top: 50%;
  width: calc(100% * var(--ks-target-scale, 0.6));
  height: calc(100% * var(--ks-target-scale, 0.6));
  border-radius: 50%;
  border: 2px solid var(--ks-cue-tint-strong);
  transform: translate(-50%, -50%) scale(0.6);
  opacity: 0.8;
  pointer-events: none;
  animation: ks-cue-ripple 720ms cubic-bezier(0.22, 0.68, 0.36, 1) forwards;
}
@keyframes ks-cue-ripple {
  0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0.75; }
  60%  { opacity: 0.35; }
  100% { transform: translate(-50%, -50%) scale(2.2); opacity: 0;    }
}

/* ── HOLD 持续反馈（v3.6） ─────────────────────────────
 * 解决作者反馈："保持持续的效果不够明显"。
 * 两层元素只在 is-holding 状态下被挂进 DOM，一松手就 remount，
 * 所以状态切换非常锐利。
 *
 * 1) aura —— 脚下柔光圈
 *    绕 cue 外圈扩散的大光环，跑 ~1200ms 循环 breathe
 *    scale 从 1.0 涨到 1.35 再回缩，opacity 同步起伏
 *    → 视觉上像"能量波在持续吐息"
 *
 * 2) core —— 内部实心光核
 *    用 --ks-hold-progress 驱动尺寸：按住越久越大
 *    同时自身叠一层快节奏呼吸（~600ms），强化"正在聚集"
 *    → 玩家看到"中心在膨胀 + 光在脉动"，一秒不差能感受到持续压力
 */
.ks-cue-hold-aura {
  position: absolute;
  left: 50%; top: 50%;
  width: calc(100% * var(--ks-target-scale, 0.6) + 32px);
  height: calc(100% * var(--ks-target-scale, 0.6) + 32px);
  border-radius: 50%;
  background: radial-gradient(
    circle,
    var(--ks-cue-tint-strong) 0%,
    var(--ks-cue-tint-soft, rgba(255, 215, 128, 0.25)) 40%,
    transparent 70%
  );
  filter: blur(4px);
  pointer-events: none;
  transform: translate(-50%, -50%) scale(1);
  opacity: 0.55;
  animation: ks-cue-hold-aura-breathe 1100ms ease-in-out infinite;
}
@keyframes ks-cue-hold-aura-breathe {
  0%, 100% { transform: translate(-50%, -50%) scale(1);    opacity: 0.45; }
  50%      { transform: translate(-50%, -50%) scale(1.35); opacity: 0.85; }
}

.ks-cue-hold-core {
  position: absolute;
  left: 50%; top: 50%;
  /* 核心大小随 holdProgress (0..1) 从 18% → 64% 增长 */
  width:  calc(18% + 46% * var(--ks-hold-progress, 0));
  height: calc(18% + 46% * var(--ks-hold-progress, 0));
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(255, 255, 255, 0.95) 0%,
    var(--ks-cue-tint-strong) 55%,
    transparent 100%
  );
  pointer-events: none;
  transform: translate(-50%, -50%) scale(1);
  filter: drop-shadow(0 0 14px var(--ks-cue-tint-strong));
  animation: ks-cue-hold-core-pulse 560ms ease-in-out infinite;
  /* 尺寸跟 progress 平滑变化，避免数值跳帧造成的颗粒感 */
  transition: width 80ms linear, height 80ms linear;
}
@keyframes ks-cue-hold-core-pulse {
  0%, 100% { transform: translate(-50%, -50%) scale(0.92); opacity: 0.88; }
  50%      { transform: translate(-50%, -50%) scale(1.08); opacity: 1;    }
}

/* SWEEP 拖动中整体放大 + 目标环柔光加强 */
.ks-cue.shape-sweep.is-sweeping {
  transform: translate(-50%, -50%) scale(1.04);
  transition: transform 100ms var(--ks-ease, cubic-bezier(0.2, 0.8, 0.2, 1));
}
.ks-cue.shape-sweep.is-sweeping .ks-cue-target-ring {
  border-style: solid;
  border-width: 2.5px;
}
.ks-cue.shape-sweep.is-sweeping.is-offaxis .ks-cue-target-ring {
  /* 拖歪了 —— 目标环变红，明确告诉玩家"方向不对" */
  border-color: var(--ks-miss, #fb7185);
  box-shadow: 0 0 16px rgba(251, 113, 133, 0.55);
}

/* SWEEP 拖动 trail —— 从 cue 中心伸出的淡色长条，长度随 sweepProgress */
.ks-cue-sweep-trail {
  position: absolute;
  left: 50%; top: 50%;
  width: 140px;
  height: 10px;
  pointer-events: none;
  transform-origin: 0% 50%;
  transform:
    translate(0, -50%)
    rotate(var(--sweep-trail-rot, 0deg))
    scaleX(var(--ks-sweep-progress, 0));
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.18) 30%,
    var(--ks-cue-tint-strong) 100%
  );
  border-radius: 6px;
  filter: blur(0.3px) drop-shadow(0 0 10px var(--ks-cue-tint-strong));
  opacity: 0.78;
  transition: transform 80ms linear, opacity 100ms linear;
  --sweep-trail-rot: 0deg;
}
.ks-cue-sweep-trail.dir-right { --sweep-trail-rot:   0deg; }
.ks-cue-sweep-trail.dir-down  { --sweep-trail-rot:  90deg; }
.ks-cue-sweep-trail.dir-left  { --sweep-trail-rot: 180deg; }
.ks-cue-sweep-trail.dir-up    { --sweep-trail-rot: 270deg; }
.ks-cue-sweep-trail.is-offaxis {
  /* 方向错 —— trail 褪成红色，告诉玩家"拖错方向了" */
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(251, 113, 133, 0.25) 30%,
    rgba(251, 113, 133, 0.95) 100%
  );
  filter: blur(0.3px) drop-shadow(0 0 10px rgba(251, 113, 133, 0.75));
}

/* ============================================================
 * 屏蔽原生拖拽的兜底
 * cue 层 & 子节点统统不接受 HTML5 DnD；
 * player 的背景视频/图片由 Player 组件自己处理。
 * ============================================================ */
.ks-cue, .ks-cue * {
  -webkit-user-drag: none;
  user-select: none;
  -webkit-user-select: none;
}

/* ============================================================
 * ambient modifier: .is-bg-empty
 * ------------------------------------------------------------
 * 当场景没有预生成画面（IMAGE_PROMPT + 无 ref）时由调用方挂上。
 * 语义：黑底上 cue 的循环青蓝/品红脉冲对比度过大，感官就是"一直闪"。
 * 策略：保留一次性进入动画（fade-in / splash / press），把所有 infinite
 * 循环动画按下，让 cue 在黑底上以静态形态存在。出现画面后移除此 class
 * 即恢复原设计语言。
 * ============================================================ */
.ks-qte-layer.is-bg-empty .ks-cue-inner-tap,
.ks-qte-layer.is-bg-empty .ks-cue-inner-hold,
.ks-qte-layer.is-bg-empty .ks-cue-target.is-peak .ks-cue-target-ring,
.ks-qte-layer.is-bg-empty .ks-cue-hint,
.ks-qte-layer.is-bg-empty .ks-cue-sweep-arrow {
  animation: none !important;
}
/* 静态形态微调：去掉 pulse 后 tap 小点保持"中等亮度"而不是停在最暗帧 */
.ks-qte-layer.is-bg-empty .ks-cue-inner-tap {
  opacity: 0.92;
  transform: scale(1.15);
}
.ks-qte-layer.is-bg-empty .ks-cue-inner-hold {
  opacity: 0.88;
}
`
injectStyleOnce('qte-overlay', layerCss)
