import type { EntityRuntime } from '../entities'
import { hpRatio } from '../entities'

/**
 * 敌方血条（小怪）—— HUD 顶部居中，仿黑神话水墨笔触。
 *
 * 复刻自「新影游平台交互原型」的 .pvb-foe-unit：
 *   居中题字名牌 + 水墨血条（深墨底 ::before + 残影 ghost + 红色 fill），
 *   微微倾斜、毛边由全局 #inkRough 滤镜提供。Boss 战（scene.kind='battle'）时出现。
 */
export function BossBar({ entity }: { entity: EntityRuntime }) {
  const ratio = hpRatio(entity)
  return (
    <div className="ks-hud-boss ks-hud-foe-unit" data-testid="hud-boss-hp">
      <div className="ks-hud-boss-name">{entity.name}</div>
      <div className="ks-hud-boss-bar">
        <span className="ks-hud-boss-ghost" style={{ width: `${ratio * 100}%` }} />
        <span className="ks-hud-boss-fill foe" style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  )
}
