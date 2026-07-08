import { useEffect, useRef, useState } from 'react'
import type { BlueprintQte } from '../blueprint/blueprint-schema'
import type { QteOutcome, Scene } from '../scenario/types'
import { injectInkFilterOnce, injectStyleOnce } from '../styles/injectStyle'
import { injectBrushFontOnce } from '../styles/brushFont'

interface Props {
  qte: BlueprintQte
  onResolve: (outcome: QteOutcome) => void
}

/**
 * 只显示 A、B 两个按钮。C（fail）是玩家不操作时的默认结局——超时即 finish('fail')，
 * 无需在画面上给一个"主动选失败"的按钮。
 */
const PARRY_OPTIONS: Array<{ key: 'A' | 'B'; outcome: QteOutcome }> = [
  { key: 'A', outcome: 'pass' },
  { key: 'B', outcome: 'good' },
]

export function isBattleParryQte(scene: Scene | undefined): boolean {
  return scene?.qte?.ui === 'battleParry'
}

/**
 * 防反 QTE —— 严格复刻「新影游平台交互原型」的按键收圈计时：
 *   两个墨章按键（A 左下 / B 右上）各自「间歇出现」，其外圈 .pvb-key-ring 由
 *   RAF 逐帧从 scale(2.4) 向正中 scale(1) 收束（A、B 错峰：中心分别落在窗口的
 *   32% / 72%）；环收到正中即命中时机（此刻按键点亮为 sweet 绿）。收圈的 scale 与
 *   armed/sweet 类均按原型的 JS 计算直接写 DOM，不用 CSS 动画。
 */
export function BattleParryLayer({ qte, onResolve }: Props) {
  injectStyleOnce('battle-parry-layer', PARRY_CSS)
  injectInkFilterOnce()
  injectBrushFontOnce()
  const resolvedRef = useRef(false)
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([])
  // 仅记录「最终结算态」，用于一次性渲染 hit/miss；收圈过程态全部走 RAF 直写 DOM。
  const [settled, setSettled] = useState<
    { kind: 'hit'; index: number } | { kind: 'miss' } | null
  >(null)

  function finish(outcome: QteOutcome): void {
    if (resolvedRef.current) return
    resolvedRef.current = true
    onResolve(outcome)
  }

  function hit(index: number): void {
    if (resolvedRef.current) return
    setSettled({ kind: 'hit', index })
    window.setTimeout(() => finish(PARRY_OPTIONS[index]?.outcome ?? 'fail'), 180)
  }

  useEffect(() => {
    const D = qte.timeoutMs ?? 2600
    // 复刻原型：接近时长 / 命中容差 / 两键错峰的收圈中心（窗口的 32% 与 72%）。
    const approach = Math.min(750, D * 0.24)
    const tol = Math.min(240, D * 0.13)
    const centers = PARRY_OPTIONS.map((_, i) => (i === 0 ? D * 0.32 : D * 0.72))
    const start = performance.now()
    let raf = 0

    function setRing(el: HTMLButtonElement, scale: number): void {
      const ring = el.querySelector<HTMLElement>('.pvb-key-ring')
      if (ring) ring.style.transform = `scale(${scale.toFixed(3)})`
    }

    function loop(): void {
      if (resolvedRef.current) return
      const now = performance.now() - start
      btnRefs.current.forEach((el, i) => {
        if (!el) return
        const c = centers[i] ?? D * 0.5
        if (now < c - approach) {
          // 尚未进入本键窗口：暗置、环复位到最外圈
          el.classList.remove('armed', 'sweet')
          setRing(el, 2.4)
        } else if (now <= c + tol + 160) {
          // 收圈中：scale 从 2.4 逼近 1，再略微内缩；命中窗口内点亮 sweet
          el.classList.add('armed')
          const s =
            now <= c
              ? 1 + 1.4 * ((c - now) / approach)
              : 1 - 0.3 * Math.min(1, (now - c) / (tol + 160))
          setRing(el, s)
          if (now >= c - tol && now <= c + tol) el.classList.add('sweet')
          else el.classList.remove('sweet')
        } else {
          // 本键窗口已过：熄灭（超时统一收尾）
          el.classList.remove('armed', 'sweet')
          setRing(el, 1)
        }
      })
      if (now >= D + 200) {
        setSettled({ kind: 'miss' })
        window.setTimeout(() => finish('fail'), 180)
        return
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    function onKeyDown(e: KeyboardEvent): void {
      const index = PARRY_OPTIONS.findIndex((o) => o.key.toLowerCase() === e.key.toLowerCase())
      if (index < 0) return
      e.preventDefault()
      hit(index)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('keydown', onKeyDown, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qte.timeoutMs])

  return (
    <div className="pvb-parry show" aria-label="防反 QTE">
      <div className="pvb-parry-tip">防反 QTE</div>
      <div className="pvb-parry-keys">
        {PARRY_OPTIONS.map((option, index) => {
          const hitHere = settled?.kind === 'hit' && settled.index === index
          const missed = settled?.kind === 'miss'
          const cls = hitHere ? 'good hit' : missed ? 'miss' : ''
          return (
            <button
              key={option.key}
              ref={(el) => {
                btnRefs.current[index] = el
              }}
              type="button"
              className={`pvb-key ${cls}`}
              onClick={() => hit(index)}
              disabled={!!settled}
            >
              <span className="pvb-key-ring" />
              <span className="pvb-key-label">{option.key}</span>
              {hitHere && <span className="pvb-key-spark" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const PARRY_CSS = `
.pvb-parry {
  position: absolute;
  right: 8%;
  top: 48%;
  transform: translateY(-50%);
  z-index: 46;
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  user-select: none;
  pointer-events: auto;
}
.pvb-parry.show { display: flex; }
.pvb-parry-tip { display: none !important; }
.pvb-parry-keys { position: relative; width: 190px; height: 158px; }
.pvb-parry-keys .pvb-key:nth-child(1) { position: absolute; left: 0; bottom: 0; }
.pvb-parry-keys .pvb-key:nth-child(2) { position: absolute; right: 0; top: 0; }
.pvb-key {
  position: relative;
  width: 62px; height: 62px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: .5;
  transform: scale(.86);
  transition: opacity .14s, transform .14s, filter .14s;
  background: none;
  border: none;
  padding: 0;
}
/* 防反按键：与技能墨章一致的水墨圆章（深墨底 + inkRough 毛边） */
.pvb-key::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: 52% 48% 50% 50% / 50% 52% 48% 50%;
  background: linear-gradient(180deg, #2b2620, #0c0a08);
  border: 1.5px solid rgba(239,231,214,.5);
  box-shadow: 0 2px 6px rgba(0,0,0,.5) inset, 0 2px 7px rgba(0,0,0,.6);
  filter: url(#inkRough);
  transition: border-color .14s, background-color .14s;
}
.pvb-key.armed { opacity: 1; transform: scale(1); }
.pvb-key.armed::before {
  border-color: #ffd9a8;
  box-shadow: 0 0 16px rgba(255,200,120,.5), 0 2px 6px rgba(0,0,0,.5) inset;
}
/* 收圈计时环：细淡墨环，scale 由 RAF 逐帧写入（复刻原型，不用 CSS 动画） */
.pvb-key-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid rgba(243,234,216,.55);
  transform: scale(2.4);
  transform-origin: center;
  pointer-events: none;
  opacity: 0;
  z-index: 1;
}
.pvb-key.armed .pvb-key-ring { opacity: .9; }
.pvb-key.sweet .pvb-key-ring {
  border-color: rgba(95,224,138,.9);
  box-shadow: 0 0 12px rgba(95,224,138,.6);
}
.pvb-key.sweet { transform: scale(1.08); }
.pvb-key.sweet::before {
  border-color: #5fe08a;
  box-shadow: 0 0 20px rgba(95,224,138,.8), 0 2px 6px rgba(0,0,0,.5) inset;
}
.pvb-key.good { opacity: 1; transform: scale(1.16); }
.pvb-key.good::before {
  border-color: #5fe08a;
  background: linear-gradient(180deg, #234a32, #0e2417);
  box-shadow: 0 0 22px rgba(95,224,138,.95);
}
.pvb-key.hit { animation: pvbKeyHit .4s ease; }
@keyframes pvbKeyHit {
  0% { transform: scale(1.5); }
  45% { transform: scale(.92); }
  100% { transform: scale(1.16); }
}
.pvb-key-spark {
  position: absolute;
  inset: -12px;
  border-radius: 50%;
  border: 2.5px solid #7dffae;
  pointer-events: none;
  z-index: 3;
  box-shadow: 0 0 18px rgba(125,255,174,.8);
  animation: pvbKeySpark .5s ease forwards;
}
@keyframes pvbKeySpark {
  0% { transform: scale(.45); opacity: .95; }
  100% { transform: scale(2); opacity: 0; }
}
.pvb-key.miss { opacity: .4; }
.pvb-key.miss::before {
  border-color: #ff6a5a;
  background: linear-gradient(180deg, #3a201d, #16100e);
}
.pvb-key-label {
  font-family: 'HYShangWei', 'STKaiti', 'KaiTi', serif;
  font-size: 1.45rem;
  font-weight: 800;
  color: #efe7d6;
  z-index: 2;
  text-shadow: 0 2px 6px rgba(0,0,0,.85);
  pointer-events: none;
}
`
