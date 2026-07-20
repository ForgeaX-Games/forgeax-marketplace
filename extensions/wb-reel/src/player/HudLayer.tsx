import type { CSSProperties } from 'react'
import { useMediaStore } from '../media/mediaStore'
import { injectStyleOnce } from '../styles/injectStyle'
import type { HudElement, Scenario, UIAsset, UIValueBind } from '../scenario/types'
import { uiBlendModeToCss } from '../forge/modules/uiAssetArt'
import { evaluateCondition, type ItemState, type VarState } from './conditionEval'

/**
 * HudLayer —— Tier C 跨场常驻 HUD 渲染层（Player 顶层，独立于单场时间轴）。
 *
 * 与 SceneFxLayers.StickerLayer(单场瞬时/常驻)不同：这一层由 scenario.hud
 * 驱动，跨多个 scene 节点持续存在，随游戏运行时状态显隐 / 实时更新：
 *   - visibleWhen 命中(复用分支条件：var/flag/visited/hasItem)才显示，缺省恒显。
 *   - valueBind 把 GameVariable 实时映射到血条填充(fill)或数字(number)。
 *   - blendMode 复用 UI 素材去背规则(纯黑+screen / 纯白+multiply…)盖在画面上。
 *
 * 纯展示、pointer-events:none —— 不拦截 QTE / 选择等交互。
 */
export function HudLayer({
  scenario,
  vars,
  visited,
  ownedItems,
}: {
  scenario: Scenario
  vars: VarState
  visited: readonly string[]
  ownedItems: ItemState
}) {
  const entries = useMediaStore((s) => s.entries)
  const hud = scenario.hud ?? []
  if (hud.length === 0) return null

  const ctx = {
    vars,
    visitedSceneIds: new Set(visited),
    ownedItems,
  }

  const shown = hud
    .filter((el) => evaluateCondition(el.visibleWhen, ctx))
    .slice()
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))

  if (shown.length === 0) return null

  return (
    <div className="ks-hudlayer" aria-hidden>
      {shown.map((el) => {
        const asset = scenario.uiAssets?.[el.uiAssetId]
        if (!asset) return null
        const url = asset.mediaId ? entries[asset.mediaId]?.url : undefined
        if (!url) return null
        return (
          <HudItem
            key={el.id}
            el={el}
            asset={asset}
            url={url}
            scenario={scenario}
            vars={vars}
          />
        )
      })}
    </div>
  )
}

function HudItem({
  el,
  asset,
  url,
  scenario,
  vars,
}: {
  el: HudElement
  asset: UIAsset
  url: string
  scenario: Scenario
  vars: VarState
}) {
  const anchor = el.anchor ?? asset.defaultAnchor ?? { x: 0.5, y: 0.5 }
  const scale = anchor.scale ?? asset.defaultAnchor?.scale ?? 16
  const blend = uiBlendModeToCss(el.blendMode ?? asset.blendMode) as CSSProperties['mixBlendMode']
  const bind = el.valueBind ?? asset.valueBind

  const boxStyle: CSSProperties = {
    left: `${anchor.x * 100}%`,
    top: `${anchor.y * 100}%`,
    height: `${scale}cqh`,
    zIndex: el.z ?? 0,
  }

  // fill 绑定：按归一化比例从左揭开图像(血条常见做法),保持布局尺寸不变。
  const ratio = bind?.kind === 'fill' ? valueRatio(bind, scenario, vars) : null
  const imgStyle: CSSProperties = {
    mixBlendMode: blend,
    ...(ratio != null ? { clipPath: `inset(0 ${(1 - ratio) * 100}% 0 0)` } : null),
  }

  const numberText =
    bind?.kind === 'number' ? String(Math.round(vars[bind.varId] ?? 0)) : null

  return (
    <div className="ks-hud-item" style={boxStyle}>
      <img className="ks-hud-img" src={url} alt="" draggable={false} style={imgStyle} />
      {numberText != null && (
        // 字号以整个 HUD 层高度(cqh)为基准,取本元素高度的 ~60% —— 与 boxStyle.height 一致。
        <span className="ks-hud-number" style={{ fontSize: `${scale * 0.6}cqh` }}>
          {numberText}
        </span>
      )}
    </div>
  )
}

/** 把绑定变量归一化成 0~1 填充比例（血条）。 */
function valueRatio(bind: UIValueBind, scenario: Scenario, vars: VarState): number {
  const def = scenario.variables?.[bind.varId]
  const raw = vars[bind.varId] ?? def?.initial ?? 0
  const min = bind.min ?? def?.min ?? 0
  const max = bind.max ?? def?.max ?? 100
  if (max <= min) return 0
  const r = (raw - min) / (max - min)
  return Math.max(0, Math.min(1, r))
}

const css = `
.ks-hudlayer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  container-type: size;
  z-index: 21;
}
.ks-hud-item {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ks-hud-img {
  height: 100%;
  width: auto;
  display: block;
  pointer-events: none;
}
.ks-hud-number {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--ks-font-mono, monospace);
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 4px rgba(0,0,0,0.7);
  pointer-events: none;
}
`
injectStyleOnce('hud-layer', css)
