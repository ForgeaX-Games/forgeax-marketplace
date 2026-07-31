/**
 * 防反抉择（component id: `battleParry`）—— 组件只发出「防反」或「闪避」事件。
 * 位置与显示时段由外部 Overlay 编排；组件内部只负责显示与点击交互。
 */
import { useEffect, useRef, useState } from 'react'
import type { OverlayProps } from '../../rendererRegistry'
import type { ComponentDef } from '../../../registry/component-registry'
import { injectCss, ensureInkFilters, ensureBrushFont } from './skinRuntime'

export const battleParryComponent: ComponentDef = {
  label: '防反抉择',
  events: [{ id: 'parry', label: '防反' }, { id: 'dodge', label: '闪避' }, { id: 'fail', label: '受击' }],
  inputs: [],
}

export function BattleParryLayer({ emit, preview }: OverlayProps) {
  injectCss('battle-parry-layer', PARRY_CSS)
  ensureInkFilters()
  ensureBrushFont()
  const pickedRef = useRef(false)
  const emitRef = useRef(emit)
  const previewRef = useRef(preview)
  const [picked, setPicked] = useState<string | null>(null)
  emitRef.current = emit
  previewRef.current = preview

  function pick(id: string): void {
    if (preview || pickedRef.current) return
    pickedRef.current = true
    setPicked(id)
    emit?.(id)
  }

  useEffect(() => {
    return () => {
      if (previewRef.current || pickedRef.current) return
      pickedRef.current = true
      emitRef.current?.('fail')
    }
  }, [])

  return (
    <div className="pvb-parry" aria-label="防反抉择">
      <div className="pvb-parry-keys">
        <button type="button" className={`pvb-key${picked === 'parry' ? ' selected' : ''}`} aria-label="防反" disabled={preview || !!picked} onClick={() => pick('parry')}>
          <span className="pvb-key-label">A</span>
          <span className="pvb-key-name">防反</span>
        </button>
        <button type="button" className={`pvb-key${picked === 'dodge' ? ' selected' : ''}`} aria-label="闪避" disabled={preview || !!picked} onClick={() => pick('dodge')}>
          <span className="pvb-key-label">B</span>
          <span className="pvb-key-name">闪避</span>
        </button>
      </div>
    </div>
  )
}

const PARRY_CSS = `
.pvb-parry{position:relative;inline-size:100%;block-size:100%;z-index:46;display:flex;align-items:center;justify-content:center;pointer-events:none}
.pvb-parry-keys{display:flex;gap:3cqmin;pointer-events:auto}
.pvb-key{position:relative;inline-size:8cqmin;block-size:8cqmin;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.4cqh;cursor:pointer;background:none;border:none;padding:0;color:#efe7d6;transition:transform .14s,opacity .14s}
.pvb-key::before{content:'';position:absolute;inset:0;z-index:-1;border-radius:52% 48% 50% 50%/50% 52% 48% 50%;background:linear-gradient(180deg,#2b2620,#0c0a08);border:1.5px solid rgba(239,231,214,.5);box-shadow:0 2px 6px rgba(0,0,0,.5) inset,0 2px 7px rgba(0,0,0,.6);filter:url(#inkRough)}
.pvb-key:hover:not(:disabled){transform:translateY(-2px) scale(1.03)}
.pvb-key.selected{transform:scale(1.08)}
.pvb-key.selected::before{border-color:#5fe08a;background:linear-gradient(180deg,#234a32,#0e2417);box-shadow:0 0 20px rgba(95,224,138,.8),0 2px 6px rgba(0,0,0,.5) inset}
.pvb-key:disabled{opacity:.38;cursor:not-allowed}
.pvb-key-label{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:2.6cqh;font-weight:800;line-height:1;text-shadow:0 2px 6px rgba(0,0,0,.85)}
.pvb-key-name{font-family:'HYShangWei','STKaiti','KaiTi',serif;font-size:1.5cqh;letter-spacing:.06em;text-shadow:0 2px 5px rgba(0,0,0,.85)}
`
