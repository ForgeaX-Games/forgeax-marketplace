import { useEffect, useMemo, useRef, useState } from 'react'
import type { Branch, ChoiceSpec, Scene } from '../scenario/types'
import { injectStyleOnce } from '../styles/injectStyle'
import { isBranchAvailable, type EntityHpView, type ItemState, type VarState } from './conditionEval'
import { ensureInkRoughFilter } from './inkRoughFilter'

interface Props {
  scene: Scene
  onPick: (b: Branch) => void
  vars?: VarState
  visitedSceneIds?: string[]
  ownedItems?: ItemState
  entities?: Record<string, EntityHpView>
  score?: number
}

// 應 = A/左键，默 = B/右键（对齐原型 pvn-opt--ying data-key）
const KEY_LABELS = ['A', 'B'] as const

export function isInkYingMoChoice(scene: Scene | undefined): boolean {
  return scene?.choice?.ui === 'inkYingMo'
}

export function InkYingMoLayer({ scene, onPick, vars, visitedSceneIds, ownedItems, entities, score }: Props) {
  injectStyleOnce('ink-yingmo-layer', YINGMO_CSS)
  ensureInkRoughFilter()
  const decision: ChoiceSpec | undefined = scene.choice
  const timeoutMs = decision?.window?.timeoutMs
  const timed = decision?.timed === true && (timeoutMs ?? 0) > 0
  const pickedRef = useRef(false)

  const ctx = useMemo(
    () => ({
      vars: vars ?? {},
      visitedSceneIds: new Set(visitedSceneIds ?? []),
      ownedItems: ownedItems ?? {},
      entities: entities ?? {},
      score: score ?? 0,
    }),
    [vars, visitedSceneIds, ownedItems, entities, score],
  )
  const choices = useMemo(
    () => scene.branches.filter((b) => b.kind === 'choice' && isBranchAvailable(b, ctx)),
    [scene.branches, ctx],
  )

  function pick(b: Branch): void {
    if (pickedRef.current) return
    pickedRef.current = true
    onPick(b)
  }

  // 键盘：A/E→應，B/Q→默（第 0/1 个可选分支）
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const k = e.key.toLowerCase()
      let idx = -1
      if (k === 'a' || k === 'e') idx = 0
      else if (k === 'b' || k === 'q') idx = 1
      const target = idx >= 0 ? choices[idx] : undefined
      if (!target) return
      e.preventDefault()
      pick(target)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices])

  // 限时倒计时：归零未选 → 落 defaultBranchId(默)，兜底第一个可选（对齐 ChoiceLayer）
  useEffect(() => {
    if (!timed) return
    const total = timeoutMs ?? 0
    const start = performance.now()
    let raf = 0
    function tick(now: number): void {
      if (pickedRef.current) return
      if (now - start >= total) {
        const fallback =
          choices.find((c) => c.id === decision?.defaultBranchId) ?? choices[choices.length - 1]
        if (fallback) pick(fallback)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, choices])

  return (
    <div className="pvn-opts pvn-opts--yingmo show" aria-label="应默抉择">
      <div className="pvn-yingmo-pair">
        {choices.map((b, i) => (
          <button
            key={b.id}
            type="button"
            className="pvn-opt pvn-opt--kou pvn-opt--ying"
            data-key={KEY_LABELS[i] ?? ''}
            aria-label={`${b.label}，${KEY_LABELS[i] ?? ''}键或点击确认`}
            onClick={() => pick(b)}
          >
            <span className="pvn-kou-orn" aria-hidden="true">
              <i className="pvn-kou-dot" />
              <i className="pvn-kou-diamond" />
              <i className="pvn-kou-dot" />
            </span>
            <span className="pvn-kou-glyph">{b.label}</span>
            <span className="pvn-kou-hint" aria-hidden="true">
              <span className="pvn-kou-key">{KEY_LABELS[i] ?? ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// 对齐原型 新影游平台交互原型.html 的 .pvn-opts--yingmo / .pvn-kou-* 样式
const YINGMO_CSS = `
.pvn-opts--yingmo{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:flex-end;
  padding:0 8% 16% 0;pointer-events:none;}
.pvn-opts--yingmo.show{pointer-events:auto;}
.pvn-yingmo-pair{display:flex;flex-direction:row;align-items:flex-end;justify-content:center;gap:clamp(32px,9vw,64px);}
.pvn-opts--yingmo .pvn-opt--kou{position:relative;padding:0;border:none;background:none;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;gap:2px;color:#f8f4ec;}
.pvn-opts--yingmo .pvn-opt--kou:hover{transform:translateY(-2px) scale(1.03);}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-orn{animation-delay:.28s;}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-glyph{animation-delay:.2s;}
.pvn-yingmo-pair .pvn-opt--ying:nth-child(2) .pvn-kou-hint{animation-delay:.46s;}
.pvn-kou-orn{width:18px;height:28px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;opacity:.94;
  animation:pvnYmKouOrnIn .5s ease both;}
.pvn-kou-dot{width:3px;height:3px;border-radius:50%;background:rgba(255,255,255,.88);box-shadow:0 0 6px rgba(255,255,255,.35);}
.pvn-kou-diamond{width:10px;height:10px;position:relative;transform:rotate(45deg);border:1.5px solid rgba(255,255,255,.9);border-radius:1px;}
.pvn-kou-diamond::after{content:'';position:absolute;left:50%;top:50%;width:5px;height:5px;transform:translate(-50%,-50%);background:rgba(255,255,255,.92);border-radius:1px;}
.pvn-kou-glyph{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:clamp(2rem,5.5vw,3.2rem);font-weight:800;line-height:1;letter-spacing:.08em;
  color:#f8f4ec;text-shadow:0 0 16px rgba(255,248,235,.28),0 0 2px rgba(255,255,255,.35);
  animation:pvnYmKouGlyphIn .48s cubic-bezier(.22,.92,.28,1) .12s both;}
.pvn-opts--yingmo .pvn-opt--kou:hover .pvn-kou-glyph{text-shadow:0 0 22px rgba(255,248,235,.38),0 0 2px rgba(255,255,255,.45);}
.pvn-kou-hint{display:flex;align-items:center;justify-content:center;margin-top:4px;pointer-events:none;
  opacity:0;animation:pvnYmKouHintIn .5s ease .38s forwards;}
.pvn-kou-key{display:flex;align-items:center;justify-content:center;width:1.42em;height:1.42em;
  font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:.68rem;font-weight:800;line-height:1;color:rgba(248,244,236,.92);
  position:relative;filter:url(#inkRoughNarr);}
.pvn-kou-key::before{content:'';position:absolute;inset:0;z-index:0;border-radius:52% 48% 50% 50%/50% 52% 48% 50%;
  background:linear-gradient(180deg,#2b2620,#0c0a08);border:1.5px solid rgba(239,231,214,.44);
  box-shadow:0 2px 6px rgba(0,0,0,.5) inset,0 2px 7px rgba(0,0,0,.45);}
@keyframes pvnYmKouOrnIn{from{opacity:0;transform:translateY(10px)}to{opacity:.94;transform:translateY(0)}}
@keyframes pvnYmKouGlyphIn{from{opacity:0;transform:scale(1.1) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes pvnYmKouHintIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
`
