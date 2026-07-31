/**
 * BgmPlayer —— 把「栈顶此刻该响什么」（`SessionSnapshot.bgm`）落成真实声音的**唯一**壳层件。
 *
 * 分工（SPEC §4.1）：引擎只抛资产 id + 播放意图，URL 与音频元素归壳层；解析器由调用方
 * 注入（同 `GamePlayer` 给视频注入 `resolveAsset` 的路子），故本文件不 import editor/宿主。
 * 与 `<video muted>` 无关：床轨是**独立通道**，不搭视频音轨（视频恒静音，见 GameStage）。
 *
 * 无 UI（返回 `null`）：音频元素由本件自己 `createElement` 并挂到 `document.body`——
 * 挂上去而非游离，是为了 devtools 能看见「有几条轨在响」，测试也能直接查 DOM；
 * 卸载时全部回收。React 不参与 `src` 的 diff，播放头是我们自己的状态。
 *
 * ## 三条不可违的语义（`BgmPlaybackCommand` 的定义，非本件自选）
 * - `fadeOutMs` 说的是**离场那条**，`ref`/`volume`/`fadeInMs`/`loop` 说的是**将要响那条**：
 *   一条指令 = 一次交叉淡变。故换轨时**两条轨同时在线**（单元素做不到交叉，只能把作者
 *   写在 `combat.data.bgm.fadeOutMs` 上的淡出悄悄吃掉——那正是它唯一被作者写的地方）。
 * - `ref === null` = 停播；此时 `volume: 0` 是钉死的填充，**不是**「静音但继续播」。
 * - `restart: false` = 同一条轨继续响，**别碰播放头**：不 `load()`、不 `currentTime = 0`。
 *   多回合战斗每回合都会重新走到同一条 `bgm` 指令，重载一次就断一次，本能力就废了。
 */
import { useEffect, useRef } from 'react'
import type { BgmSnapshot } from '../engine/session'

/** 淡变步长；50ms ≈ 20 步/秒，耳朵听不出台阶，也不至于把主线程铺满 timer。 */
const FADE_STEP_MS = 50

export interface BgmPlayerProps {
  /** 当前床轨指令（= `SessionSnapshot.bgm`）；`null` = 本局还没发过 bgm 指令，什么都别做。 */
  bgm: BgmSnapshot | null
  /** 资产 id → 可播 url（宿主注入）。引擎只给 id，URL 只住 manifest。 */
  resolveAsset: (id: string | undefined) => string | undefined
}

/**
 * 「这条指令已经施加过了吗」——**逐字段比**，不比引用。
 *
 * 快照一旦被序列化（宿主把 session 快照 `postMessage` 进 iframe 是最现成的路子），每次到手
 * 都是**新对象**：靠引用判等于每一帧都当新指令施加一遍，`restart: true` 的床轨于是每帧回零，
 * 等于没在播。反过来只比播放字段也不行：回合循环里每轮那条重开指令逐字段相同，却真的是
 * 两次「从头播」。`seq` 是引擎发了第几条的凭据，把两头都兜住（见 `BgmSnapshot`）。
 */
function isSameCommand(a: BgmSnapshot | null, b: BgmSnapshot): boolean {
  return a !== null
    && a.seq === b.seq
    && a.ref === b.ref
    && a.volume === b.volume
    && a.fadeInMs === b.fadeInMs
    && a.fadeOutMs === b.fadeOutMs
    && a.loop === b.loop
    && a.restart === b.restart
}

/** 一条正在响（或正在淡出）的轨：元素 + 它播的 id + 它自己那条淡变 timer。 */
interface Deck {
  el: HTMLAudioElement
  ref: string
  timer: ReturnType<typeof setInterval> | null
}

/** HTMLMediaElement.volume 越界会抛 DOMException；schema 已校验 0..1，这里兜底不让它炸播放器。 */
function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
}

function cancelRamp(deck: Deck): void {
  if (deck.timer === null) return
  clearInterval(deck.timer)
  deck.timer = null
}

/** 线性淡变到目标音量；`ms <= 0` 即刻落值（硬切）。`done` 在到点后跑（淡出收尾用）。 */
function ramp(deck: Deck, to: number, ms: number, done?: () => void): void {
  cancelRamp(deck)
  const target = clamp01(to)
  if (ms <= 0) {
    deck.el.volume = target
    done?.()
    return
  }
  const from = deck.el.volume
  const steps = Math.max(1, Math.ceil(ms / FADE_STEP_MS))
  let step = 0
  deck.timer = setInterval(() => {
    step += 1
    deck.el.volume = clamp01(from + ((target - from) * step) / steps)
    if (step < steps) return
    cancelRamp(deck)
    done?.()
  }, FADE_STEP_MS)
}

function newDeck(ref: string, url: string, loop: boolean, volume: number): Deck {
  const el = document.createElement('audio')
  el.setAttribute('data-gv-bgm', 'active')
  el.preload = 'auto'
  el.loop = loop
  el.volume = clamp01(volume)
  el.src = url
  document.body.appendChild(el)
  el.load()
  return { el, ref, timer: null }
}

/** 彻底下线一条轨：停 + 断源（否则清了 src 缓冲/解码器还挂着）+ 移出 DOM。 */
function dispose(deck: Deck): void {
  cancelRamp(deck)
  deck.el.pause()
  deck.el.removeAttribute('src')
  deck.el.load()
  deck.el.remove()
}

/**
 * 试播。浏览器在用户手势前拒绝有声自动播放（`NotAllowedError`）是**常态**，不是 bug：
 * 既不能让 rejection 冒成 unhandled，也不能每条指令刷一行 warn。故每挂载一次只喊一声；
 * 其余错误（解码 / 网络 / 404）照喊——不然「没声音」就成了查不动的哑失败。
 */
function tryPlay(deck: Deck, blockedWarned: { current: boolean }): void {
  const started = deck.el.play() as Promise<void> | undefined
  void started?.catch((e: unknown) => {
    if ((e as { name?: string } | undefined)?.name === 'NotAllowedError') {
      if (blockedWarned.current) return
      blockedWarned.current = true
      console.warn('[bgm] 浏览器拒绝无手势自动播放，首个用户手势后自动重试：', deck.ref)
      return
    }
    console.warn('[bgm] 床轨播放失败：', deck.ref, e)
  })
}

export function BgmPlayer({ bgm, resolveAsset }: BgmPlayerProps): null {
  const soundingRef = useRef<Deck | null>(null)
  const retiringRef = useRef<Deck[]>([])
  /** 已施加的那条指令；同一条重复到达（父组件重渲染 / 解析器换引用 / 快照被序列化）不得二次施加。 */
  const appliedRef = useRef<BgmSnapshot | null>(null)
  const blockedWarned = useRef(false)

  // 卸载 = 收摊。引擎在 `phase === 'ended'` **刻意不发**停播（SPEC D6：win 节点仍带着床轨），
  // 所以「停」这件事只由壳层生命周期负责：试玩面关掉 / 重开时别把声音漏到下一局。
  useEffect(() => () => {
    for (const deck of [soundingRef.current, ...retiringRef.current]) if (deck) dispose(deck)
    soundingRef.current = null
    retiringRef.current = []
    appliedRef.current = null
  }, [])

  // 自动播放被拒后的最小补救：下一次用户手势时重试当前轨。刻意**不**建 unlock 系统——
  // 我们从不主动 pause 正响的轨（停播会把它整条下线），故「paused 的 active 轨」只可能是被策略拦下的。
  useEffect(() => {
    const retry = (): void => {
      const deck = soundingRef.current
      if (deck && deck.el.paused) tryPlay(deck, blockedWarned)
    }
    window.addEventListener('pointerdown', retry)
    window.addEventListener('keydown', retry)
    return () => {
      window.removeEventListener('pointerdown', retry)
      window.removeEventListener('keydown', retry)
    }
  }, [])

  useEffect(() => {
    // `null` = 还没发过指令：连元素都别建（别拿它当停播令）。
    if (!bgm || isSameCommand(appliedRef.current, bgm)) return
    appliedRef.current = bgm

    /** 让一条轨按离场淡出时长下线；`fadeOutMs <= 0` = 硬切（数据说的，不是意外）。 */
    const retire = (deck: Deck, fadeOutMs: number): void => {
      deck.el.setAttribute('data-gv-bgm', 'retiring')
      retiringRef.current = [...retiringRef.current, deck]
      ramp(deck, 0, fadeOutMs, () => {
        dispose(deck)
        retiringRef.current = retiringRef.current.filter((d) => d !== deck)
      })
    }

    const sounding = soundingRef.current

    // 停播：只有 fadeOutMs 有意义。
    if (bgm.ref === null) {
      if (sounding) {
        soundingRef.current = null
        retire(sounding, bgm.fadeOutMs)
      }
      return
    }

    const url = resolveAsset(bgm.ref)
    if (!url) {
      // 解析不到就**保持原样**：把正响的床轨换成静音，只会让「资产没登记」表现成随机断曲。
      console.warn('[bgm] 音频 id 解析不到 url，床轨保持原样：', bgm.ref)
      return
    }

    if (sounding && sounding.ref === bgm.ref) {
      if (!bgm.restart) {
        // 续播：绝不 load()/seek。这一条就是多回合战斗床跨回合连续的全部原因。
        sounding.el.loop = bgm.loop
        ramp(sounding, bgm.volume, bgm.fadeInMs)
        if (sounding.el.paused) tryPlay(sounding, blockedWarned)
        return
      }
      // 同轨显式从头：没必要跟自己交叉淡变，就地回 0 秒。
      cancelRamp(sounding)
      sounding.el.currentTime = 0
      sounding.el.loop = bgm.loop
      sounding.el.volume = clamp01(bgm.fadeInMs > 0 ? 0 : bgm.volume)
      tryPlay(sounding, blockedWarned)
      if (bgm.fadeInMs > 0) ramp(sounding, bgm.volume, bgm.fadeInMs)
      return
    }

    // 换轨：旧轨吃离场帧的 fadeOutMs、新轨吃新栈顶的 fadeInMs —— 一条指令一次交叉淡变。
    if (sounding) retire(sounding, bgm.fadeOutMs)
    // 要起的这条若还有一份在淡出（作用域短进短出），先让它即刻下线：同曲跟自己叠只会听出重影。
    for (const stale of retiringRef.current) if (stale.ref === bgm.ref) dispose(stale)
    retiringRef.current = retiringRef.current.filter((d) => d.ref !== bgm.ref)
    const deck = newDeck(bgm.ref, url, bgm.loop, bgm.fadeInMs > 0 ? 0 : bgm.volume)
    soundingRef.current = deck
    tryPlay(deck, blockedWarned)
    if (bgm.fadeInMs > 0) ramp(deck, bgm.volume, bgm.fadeInMs)
  }, [bgm, resolveAsset])

  return null
}
