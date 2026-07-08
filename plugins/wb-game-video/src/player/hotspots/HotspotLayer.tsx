import type { Hotspot } from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'

/**
 * HotspotLayer —— 画面可点按热点层(v9 玩法系统 M7)。
 *
 * 与 v7 的 SearchLayer(拾物搜查) 区分：这里是「点画面进子流程」(call/return)。
 * 每个热点按 appearAt/endMs 时间窗 + condition 解锁条件决定是否出现；点击后由
 * Player 负责 call(压栈跳子流程) / return(子流程末尾弹回) / goto(单向跳)。
 *
 * 纯展示 + 事件冒泡：可见性过滤(时间窗/解锁)由调用方算好传入 visible 列表，
 * 本层只画圈 + 派发点击，保持与运行时状态解耦。
 */
export function HotspotLayer({
  hotspots,
  onActivate,
}: {
  hotspots: Hotspot[]
  onActivate: (h: Hotspot) => void
}) {
  injectStyleOnce('player-hotspot-layer', HOTSPOT_CSS)
  if (hotspots.length === 0) return null
  return (
    <div className="ks-hotspots" data-testid="hotspot-layer">
      {hotspots.map((h) => {
        const r = h.r ?? 0.08
        return (
          <button
            key={h.id}
            type="button"
            className="ks-hotspot"
            style={{
              left: `${h.x * 100}%`,
              top: `${h.y * 100}%`,
              width: `${r * 2 * 100}%`,
              paddingBottom: `${r * 2 * 100}%`,
            }}
            onClick={() => onActivate(h)}
            title={h.label}
            aria-label={h.label ?? '热点'}
          >
            <span className="ks-hotspot-ring" aria-hidden />
            {h.label && <span className="ks-hotspot-label">{h.label}</span>}
          </button>
        )
      })}
    </div>
  )
}

const HOTSPOT_CSS = `
.ks-hotspots {
  position: absolute; inset: 0;
  z-index: 40;
  pointer-events: none;
}
.ks-hotspot {
  position: absolute;
  transform: translate(-50%, -50%);
  height: 0;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  pointer-events: auto;
  display: flex; align-items: center; justify-content: center;
}
.ks-hotspot-ring {
  position: absolute; inset: 0;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.7);
  box-shadow: 0 0 18px rgba(255,255,255,0.4), inset 0 0 18px rgba(255,255,255,0.18);
  animation: ks-hotspot-pulse 1.6s ease-in-out infinite;
}
@keyframes ks-hotspot-pulse {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.12); opacity: 1; }
}
.ks-hotspot:hover .ks-hotspot-ring {
  border-color: #fff;
  box-shadow: 0 0 26px rgba(255,255,255,0.7), inset 0 0 22px rgba(255,255,255,0.3);
}
.ks-hotspot-label {
  position: absolute;
  bottom: -22px; left: 50%; transform: translateX(-50%);
  white-space: nowrap;
  font-size: 12px; letter-spacing: 0.06em;
  color: #fff;
  background: rgba(0,0,0,0.55);
  padding: 2px 8px; border-radius: 10px;
  text-shadow: 0 1px 4px rgba(0,0,0,0.8);
}
`
