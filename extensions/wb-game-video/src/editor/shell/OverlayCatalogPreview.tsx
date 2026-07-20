/**
 * Overlay 目录纯 UI 预览 —— 界面 tab 用；无视频底、无时间轴，节点无关。
 * 通用渲染方案里的**每一个** child（HUD / 交互 / 表现），不写死具体皮肤。
 */
import { useMemo, useState } from 'react'
import type { Entity, Overlay, Variable } from '../../runtime/schema/graph-schema'
import { bootEditorSkins } from '../init'
import { createCoreSkinRegistry } from '../../runtime/skins/components'
import type { SkinCtx } from '../../runtime/skins/rendererRegistry'
import { injectStyleOnce } from '../../styles/injectStyle'
import { renderOverlayChildPreview } from './overlayChildPreview'

const PREVIEW_CSS = `
.ocp-root { display: flex; flex-direction: column; gap: 6px; }
.ocp-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(165deg, #1a1510 0%, #0a0908 55%, #12100e 100%);
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: inset 0 0 40px rgba(0,0,0,.45);
}
.ocp-stage::after {
  content: '界面预览';
  position: absolute; left: 8px; top: 6px;
  font-size: 10px; letter-spacing: .06em; opacity: .45; pointer-events: none; z-index: 999;
}
.ocp-empty {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 11px; opacity: .45;
}
.ocp-scrub { display: flex; align-items: center; gap: 8px; font-size: 10px; opacity: .7; }
.ocp-scrub input { flex: 1; }
`

function mockHudCtx(entities: Record<string, Entity> | undefined, variables: Record<string, Variable> | undefined): SkinCtx {
  const ents: SkinCtx['hud']['entities'] = {}
  const pack = (attrs: Record<string, number>, attrMeta?: Record<string, { max?: number; initial?: number }>) => {
    const attrMax: Record<string, number> = {}
    for (const [k, v] of Object.entries(attrs)) attrMax[k] = attrMeta?.[k]?.max ?? v
    return { hp: attrs.hp ?? 0, maxHp: attrMeta?.hp?.max ?? attrs.hp ?? 0, attrs: { ...attrs }, attrMax }
  }
  for (const [id, e] of Object.entries(entities ?? {})) {
    const hp = e.attrs?.hp ?? e.attrMeta?.hp?.initial ?? 100
    const attrs = { ...(e.attrs ?? {}), hp }
    ents[id] = pack(attrs, e.attrMeta)
  }
  // 保底给两个常见战斗实体样例血量，好让血条皮肤在无实体数据时也有内容。
  if (!ents['ent-player']) ents['ent-player'] = pack({ hp: 72 }, { hp: { max: 100 } })
  if (!ents['ent-boss']) ents['ent-boss'] = pack({ hp: 58 }, { hp: { max: 100 } })
  const vars: Record<string, number> = { qi: 3 }
  for (const [id, v] of Object.entries(variables ?? {})) vars[id] = v.initial ?? 0
  return { hud: { entities: ents, vars, flags: {}, score: 1200 } }
}

export function OverlayCatalogPreview({
  overlay,
  entities,
  variables,
}: {
  overlay: Overlay
  entities: Record<string, Entity> | undefined
  variables: Record<string, Variable> | undefined
}): JSX.Element {
  injectStyleOnce('overlay-catalog-preview', PREVIEW_CSS)
  bootEditorSkins()
  const reg = useMemo(() => createCoreSkinRegistry(), [])
  const ctx = useMemo(() => mockHudCtx(entities, variables), [entities, variables])
  const [timeMs, setTimeMs] = useState(400)

  return (
    <div className="ocp-root">
      <div className="ocp-stage">
        {overlay.children.length === 0 ? (
          <div className="ocp-empty">此方案暂无组件</div>
        ) : (
          overlay.children.map((child) => (
            <div key={child.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {renderOverlayChildPreview(child, reg, ctx, timeMs)}
            </div>
          ))
        )}
      </div>
      <label className="ocp-scrub">
        <span>预览时刻</span>
        <input type="range" min={0} max={3000} step={50} value={timeMs} onChange={(e) => setTimeMs(Number(e.target.value))} />
        <span>{(timeMs / 1000).toFixed(2)}s</span>
      </label>
    </div>
  )
}
