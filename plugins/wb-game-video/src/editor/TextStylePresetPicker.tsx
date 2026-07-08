/**
 * TextStylePresetPicker —— 字幕 / 花字共享的「预设样式网格 + 实例微调 + 自定义」控件。
 *
 * · 点预设格 = 快照应用（拷 preset.style 到目标，之后独立微调）。
 * · 「+」= 从当前样式新建自定义预设，持久化到 scenario.textStylePresets 并立即应用。
 * · 自定义预设可删（× 角标）；内置只读。
 * · 「微调样式」展开逐字段编辑（字体 / 字号 / 字色 / 描边 / 对齐 / 粗细 / 斜体）。
 *
 * value = 目标当前 TextStyle（字幕取 line.style；花字从 clip 扁平字段组装）；
 * onChange 回传新 TextStyle，由调用方落回各自的数据形态。
 */
import { useState } from 'react'
import type { TextStyle, TextStylePreset } from '../scenario/types'
import { useScenarioStore } from '../scenario/scenarioStore'
import {
  matchPresetId,
  resolveOverlayPresets,
  resolveSubtitlePresets,
  snapshotPresetStyle,
} from '../scenario/textStylePresets'
import { resolveTextCss } from './textStyle'
import { FONT_PRESETS } from './timeline/fontPresets'
import { injectStyleOnce } from '../styles/injectStyle'

interface Props {
  kind: 'subtitle' | 'overlay'
  value: TextStyle | undefined
  onChange: (next: TextStyle) => void
}

export function TextStylePresetPicker({ kind, value, onChange }: Props) {
  const scenario = useScenarioStore((s) => s.scenario)
  const savePreset = useScenarioStore((s) => s.saveTextStylePreset)
  const removePreset = useScenarioStore((s) => s.removeTextStylePreset)
  const presets = kind === 'subtitle' ? resolveSubtitlePresets(scenario) : resolveOverlayPresets(scenario)
  const style: TextStyle = value ?? {}
  const [expanded, setExpanded] = useState(false)
  // 高亮 = 你这次点的那格，仅此而已（点哪个高亮哪个）。
  // 唯一的自动取消条件：当前值不再等于那格的 style（切到别的字幕、或你微调改了样式），
  // 此时清空高亮——绝不按 style 去猜、也绝不高亮到另一格。
  const [lastPresetId, setLastPresetId] = useState<string | undefined>(undefined)
  const lastPreset = lastPresetId !== undefined ? presets.find((x) => x.id === lastPresetId) : undefined
  const activeId =
    lastPreset && matchPresetId([lastPreset], value) === lastPreset.id ? lastPreset.id : undefined

  const set = (patch: Partial<TextStyle>): void => onChange({ ...style, ...patch })
  const applyPreset = (p: TextStylePreset): void => {
    setLastPresetId(p.id)
    onChange(snapshotPresetStyle(p))
  }

  const addCustom = (): void => {
    const n = (scenario.textStylePresets?.[kind]?.length ?? 0) + 1
    const preset: TextStylePreset = {
      id: `${kind}-custom-${Date.now().toString(36)}`,
      name: `自定义 ${n}`,
      builtin: false,
      style: structuredClone(style),
    }
    savePreset(kind, preset)
    applyPreset(preset)
  }

  return (
    <div className="gc-tsp">
      <div className="gc-tsp-grid">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`gc-tsp-tile${activeId === p.id ? ' is-active' : ''}`}
            onClick={() => applyPreset(p)}
            title={p.name}
          >
            <span className="gc-tsp-aa" style={{ ...resolveTextCss(p.style, { fillDefaults: true }), fontSize: 22 }}>
              Aa
            </span>
            <span className="gc-tsp-name">{p.name}</span>
            {!p.builtin && (
              <span
                className="gc-tsp-del"
                role="button"
                aria-label="删除预设"
                onClick={(e) => {
                  e.stopPropagation()
                  removePreset(kind, p.id)
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button type="button" className="gc-tsp-tile gc-tsp-add" onClick={addCustom} title="从当前样式新建预设">
          +
        </button>
      </div>
      <button type="button" className="gc-tsp-toggle" onClick={() => setExpanded((v) => !v)}>
        {expanded ? '收起微调 ▴' : '微调样式 ▾'}
      </button>
      {expanded && (
        <div className="gc-tsp-fields">
          <label className="gc-tsp-field">
            <span>字体</span>
            <select value={style.fontFamily ?? 'sans'} onChange={(e) => set({ fontFamily: e.target.value })}>
              {FONT_PRESETS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label className="gc-tsp-field">
            <span>字号 {(style.fontSizePct ?? 5).toFixed(1)}</span>
            <input
              type="range"
              min={2}
              max={14}
              step={0.2}
              value={style.fontSizePct ?? 5}
              onChange={(e) => set({ fontSizePct: Number(e.target.value) })}
            />
          </label>
          <label className="gc-tsp-field">
            <span>字色</span>
            <input type="text" value={style.color ?? ''} placeholder="#ffffff" onChange={(e) => set({ color: e.target.value || undefined })} />
          </label>
          <label className="gc-tsp-field">
            <span>描边色</span>
            <input type="text" value={style.strokeColor ?? ''} placeholder="#000000" onChange={(e) => set({ strokeColor: e.target.value || undefined })} />
          </label>
          <label className="gc-tsp-field">
            <span>描边宽 {style.strokeWidth ?? 0}</span>
            <input
              type="range"
              min={0}
              max={8}
              step={0.5}
              value={style.strokeWidth ?? 0}
              onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
            />
          </label>
          <label className="gc-tsp-field">
            <span>粗细</span>
            <select value={style.fontWeight ?? 500} onChange={(e) => set({ fontWeight: Number(e.target.value) })}>
              {[300, 400, 500, 600, 700, 800, 900].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label className="gc-tsp-field">
            <span>对齐</span>
            <select value={style.align ?? 'center'} onChange={(e) => set({ align: e.target.value as TextStyle['align'] })}>
              <option value="left">左</option>
              <option value="center">中</option>
              <option value="right">右</option>
            </select>
          </label>
          <label className="gc-tsp-check">
            <input type="checkbox" checked={style.italic ?? false} onChange={(e) => set({ italic: e.target.checked || undefined })} />
            <span>斜体</span>
          </label>
          <label className="gc-tsp-check">
            <input type="checkbox" checked={style.underline ?? false} onChange={(e) => set({ underline: e.target.checked || undefined })} />
            <span>下划线</span>
          </label>
        </div>
      )}
    </div>
  )
}

const css = `
.gc-tsp { display: flex; flex-direction: column; gap: 8px; }
.gc-tsp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(58px, 1fr));
  gap: 6px;
}
.gc-tsp-tile {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  height: 54px; padding: 4px;
  border: 1px solid var(--gc-border, rgba(255,255,255,.14));
  border-radius: 8px;
  background: rgba(255,255,255,.03);
  color: var(--gc-text, #e8ecf4);
  cursor: pointer;
  overflow: hidden;
}
.gc-tsp-tile:hover { border-color: var(--gc-accent, #f08840); }
.gc-tsp-tile.is-active { border-color: var(--gc-accent, #f08840); box-shadow: 0 0 0 1px var(--gc-accent, #f08840); }
.gc-tsp-aa { line-height: 1; display: block; }
.gc-tsp-name { font-size: 10px; opacity: .8; white-space: nowrap; }
.gc-tsp-del {
  position: absolute; top: 1px; right: 3px; font-size: 12px; line-height: 1;
  color: rgba(255,140,140,.9); cursor: pointer;
}
.gc-tsp-add { font-size: 20px; color: var(--gc-muted, #9aa4b5); }
.gc-tsp-toggle {
  align-self: flex-start; font-size: 11px; color: var(--gc-muted, #9aa4b5);
  background: none; border: none; cursor: pointer; padding: 0;
}
.gc-tsp-fields {
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px;
  padding: 8px; border: 1px solid var(--gc-border, rgba(255,255,255,.1)); border-radius: 8px;
}
.gc-tsp-field { display: flex; flex-direction: column; gap: 2px; font-size: 11px; }
.gc-tsp-field > span { color: var(--gc-muted, #9aa4b5); }
.gc-tsp-field select, .gc-tsp-field input[type=text] {
  width: 100%; background: rgba(0,0,0,.25); color: inherit;
  border: 1px solid var(--gc-border, rgba(255,255,255,.14)); border-radius: 6px; padding: 3px 6px; font-size: 12px;
}
.gc-tsp-check { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--gc-muted, #9aa4b5); }

/* 主题化滑杆（覆盖浏览器默认蓝白）—— 与页面 accent 对齐 */
.gc-tsp input[type=range] {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 4px; border-radius: 999px;
  background: rgba(255,255,255,.14); outline: none; cursor: pointer;
}
.gc-tsp input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 13px; height: 13px; border-radius: 50%;
  background: var(--gc-accent, #f08840); border: 2px solid rgba(0,0,0,.35);
}
.gc-tsp input[type=range]::-moz-range-thumb {
  width: 13px; height: 13px; border-radius: 50%; border: 2px solid rgba(0,0,0,.35);
  background: var(--gc-accent, #f08840);
}
.gc-tsp input[type=range]::-moz-range-track {
  height: 4px; border-radius: 999px; background: rgba(255,255,255,.14);
}
`
injectStyleOnce('text-style-preset-picker', css)
