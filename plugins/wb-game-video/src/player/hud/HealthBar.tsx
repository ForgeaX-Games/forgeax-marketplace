import type { EntityRuntime } from '../entities'
import { hpRatio } from '../entities'

/**
 * 玩家血条（空藏）—— HUD 右下角，仿黑神话水墨笔触。
 *
 * 复刻自「新影游平台交互原型」的 .pvb-me-unit：
 *   题字名牌（水墨字体）+ 镜像水墨血条（深墨底 ::before + 残影 ghost + 蓝色 fill）
 *   + 气力珠（金/灰圆点）。血条毛边由全局 #inkRough 滤镜提供。
 *
 * 低血(<30%)变红 + 脉冲，给玩家危险反馈（纯 CSS，无运行时依赖）。
 */
export function HealthBar({
  entity,
  accent,
  energy,
}: {
  entity: EntityRuntime
  accent?: string
  energy?: { current: number; max: number }
}) {
  const ratio = hpRatio(entity)
  const low = ratio <= 0.3
  const pips = energy ? Array.from({ length: energy.max }, (_, i) => i < energy.current) : []
  return (
    <div className={`ks-hud-hp ks-hud-me-unit${low ? ' is-low' : ''}`} data-testid="hud-player-hp">
      <div className="ks-hud-hp-name">{entity.name}</div>
      <div className="ks-hud-hp-bar">
        <span className="ks-hud-hp-ghost" style={{ width: `${ratio * 100}%` }} />
        <span
          className="ks-hud-hp-fill me"
          style={{ width: `${ratio * 100}%`, ...(accent ? { background: accent } : null) }}
        />
      </div>
      {energy && (
        <div className="ks-hud-rage" aria-label={`气力 ${energy.current}/${energy.max}`}>
          {pips.map((on, i) => (
            <span key={i} className={`ks-hud-pip${on ? ' on' : ''}`} aria-hidden />
          ))}
        </div>
      )}
    </div>
  )
}
