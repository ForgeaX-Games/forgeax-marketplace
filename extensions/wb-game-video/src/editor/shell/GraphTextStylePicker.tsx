/**
 * GraphTextStylePicker —— 图原生的「预设网格 + 实例微调 + 自定义」文字样式控件。
 * 原生移植 legacy TextStylePresetPicker，但吃 GraphTextStyle、存 graphScenarioStore.
 *
 * · 点预设格 = 快照应用（拷 preset.style，之后独立微调）。
 * · 「+」= 从当前样式新建自定义预设，持久化到 GameScenario.textStylePresets 并立即应用。
 * · 自定义预设可删（× 角标）；内置只读。
 * · 「微调样式」展开逐字段编辑。
 */
import { useState } from 'react'
import type { GraphTextStyle, GraphTextStylePreset } from '../../runtime/schema/graph-schema'
import { useGraphScenario } from '../persist/graphScenarioStore'
import { matchPresetId, resolvePresets, snapshotPresetStyle, type TextStyleGroup } from '../text/text-style'
import { resolveGraphTextCss } from '../text/text-css'
import { FONT_PRESETS } from '../text/font-presets'
import { injectStyleOnce } from '../../styles/injectStyle'

export function GraphTextStylePicker({
  group,
  value,
  onChange,
}: {
  group: TextStyleGroup
  value: GraphTextStyle | undefined
  onChange: (next: GraphTextStyle) => void
}): JSX.Element {
  const textStylePresets = useGraphScenario((s) => s.meta.textStylePresets)
  const addPreset = useGraphScenario((s) => s.addTextStylePreset)
  const removePreset = useGraphScenario((s) => s.removeTextStylePreset)
  const presets = resolvePresets({ textStylePresets }, group)
  const style: GraphTextStyle = value ?? {}
  const [expanded, setExpanded] = useState(false)
  const [lastPresetId, setLastPresetId] = useState<string | undefined>(undefined)
  const lastPreset = lastPresetId !== undefined ? presets.find((x) => x.id === lastPresetId) : undefined
  const activeId = lastPreset && matchPresetId([lastPreset], value) === lastPreset.id ? lastPreset.id : undefined

  const set = (patch: Partial<GraphTextStyle>): void => onChange({ ...style, ...patch })
  const applyPreset = (p: GraphTextStylePreset): void => {
    setLastPresetId(p.id)
    onChange(snapshotPresetStyle(p))
  }
  const addCustom = (): void => {
    const n = (textStylePresets?.[group]?.length ?? 0) + 1
    const preset: GraphTextStylePreset = {
      id: `${group}-custom-${Date.now().toString(36)}`,
      name: `自定义 ${n}`,
      builtin: false,
      style: structuredClone(style),
    }
    addPreset(group, preset)
    applyPreset(preset)
  }

  return (
    <div className="gtsp">
      <div className="gtsp-grid">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`gtsp-tile${activeId === p.id ? ' is-active' : ''}`}
            onClick={() => applyPreset(p)}
            title={p.name}
          >
            <span className="gtsp-aa" style={{ ...resolveGraphTextCss(p.style, { fillDefaults: true }), fontSize: 22 }}>Aa</span>
            <span className="gtsp-name">{p.name}</span>
            {!p.builtin && (
              <span className="gtsp-del" role="button" aria-label="删除预设" onClick={(e) => { e.stopPropagation(); removePreset(group, p.id) }}>×</span>
            )}
          </button>
        ))}
        <button type="button" className="gtsp-tile gtsp-add" onClick={addCustom} title="从当前样式新建预设">+</button>
      </div>
      <button type="button" className="gtsp-toggle" onClick={() => setExpanded((v) => !v)}>
        {expanded ? '收起微调 ▴' : '微调样式 ▾'}
      </button>
      {expanded && (
        <div className="gtsp-fields">
          <label className="gtsp-field"><span>字体</span>
            <select value={style.fontFamily ?? 'sans'} onChange={(e) => set({ fontFamily: e.target.value })}>
              {FONT_PRESETS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          <label className="gtsp-field"><span>字号 {(style.fontSize ?? 5).toFixed(1)}</span>
            <input type="range" min={2} max={14} step={0.2} value={style.fontSize ?? 5} onChange={(e) => set({ fontSize: Number(e.target.value) })} />
          </label>
          <label className="gtsp-field"><span>字色</span>
            <input type="text" value={style.color ?? ''} placeholder="#ffffff" onChange={(e) => set({ color: e.target.value || undefined })} />
          </label>
          <label className="gtsp-field"><span>描边色</span>
            <input type="text" value={style.WebkitTextStrokeColor ?? ''} placeholder="#000000" onChange={(e) => set({ WebkitTextStrokeColor: e.target.value || undefined })} />
          </label>
          <label className="gtsp-field"><span>描边宽 {style.WebkitTextStrokeWidth ?? 0}</span>
            <input type="range" min={0} max={8} step={0.5} value={style.WebkitTextStrokeWidth ?? 0} onChange={(e) => set({ WebkitTextStrokeWidth: Number(e.target.value) })} />
          </label>
          <label className="gtsp-field"><span>粗细</span>
            <select value={style.fontWeight ?? 500} onChange={(e) => set({ fontWeight: Number(e.target.value) })}>
              {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </label>
          <label className="gtsp-field"><span>对齐</span>
            <select value={style.textAlign ?? 'center'} onChange={(e) => set({ textAlign: e.target.value as GraphTextStyle['textAlign'] })}>
              <option value="left">左</option><option value="center">中</option><option value="right">右</option>
            </select>
          </label>
          <label className="gtsp-check">
            <input type="checkbox" checked={style.textDecoration === 'underline'} onChange={(e) => set({ textDecoration: e.target.checked ? 'underline' : undefined })} /><span>下划线</span>
          </label>
        </div>
      )}
    </div>
  )
}

const css = `
.gtsp { display: flex; flex-direction: column; gap: 8px; }
.gtsp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(58px, 1fr)); gap: 6px; }
.gtsp-tile { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; height: 54px; padding: 4px; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; background: rgba(255,255,255,.03); color: #e8ecf4; cursor: pointer; overflow: hidden; }
.gtsp-tile:hover { border-color: #f08840; }
.gtsp-tile.is-active { border-color: #f08840; box-shadow: 0 0 0 1px #f08840; }
.gtsp-aa { line-height: 1; display: block; }
.gtsp-name { font-size: 10px; opacity: .8; white-space: nowrap; }
.gtsp-del { position: absolute; top: 1px; right: 3px; font-size: 12px; line-height: 1; color: rgba(255,140,140,.9); cursor: pointer; }
.gtsp-add { font-size: 20px; color: #9aa4b5; }
.gtsp-toggle { align-self: flex-start; font-size: 11px; color: #9aa4b5; background: none; border: none; cursor: pointer; padding: 0; }
.gtsp-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; padding: 8px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; }
.gtsp-field { display: flex; flex-direction: column; gap: 2px; font-size: 11px; }
.gtsp-field > span { color: #9aa4b5; }
.gtsp-field select, .gtsp-field input[type=text] { width: 100%; background: rgba(0,0,0,.25); color: inherit; border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 3px 6px; font-size: 12px; }
.gtsp-check { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #9aa4b5; }
.gtsp input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 4px; border-radius: 999px; background: rgba(255,255,255,.14); outline: none; cursor: pointer; }
.gtsp input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 13px; height: 13px; border-radius: 50%; background: #f08840; border: 2px solid rgba(0,0,0,.35); }
.gtsp input[type=range]::-moz-range-thumb { width: 13px; height: 13px; border-radius: 50%; border: 2px solid rgba(0,0,0,.35); background: #f08840; }
.gtsp input[type=range]::-moz-range-track { height: 4px; border-radius: 999px; background: rgba(255,255,255,.14); }
`
injectStyleOnce('graph-text-style-picker', css)
