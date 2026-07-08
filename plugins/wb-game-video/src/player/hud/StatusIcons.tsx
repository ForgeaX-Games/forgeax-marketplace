import type { StatusSpec } from '../../scenario/types'

/**
 * 状态效果图标行 —— HUD 玩家血条上方。展示某实体当前生效的 buff/debuff。
 *
 * M2(本轮):运行时状态尚未驱动(实体 statusIds 恒为空)，本组件先就位，
 * 传入空列表时不渲染。M5/M6 接上状态 tick 后传入实际生效的 StatusSpec 即可。
 */
export function StatusIcons({ statuses }: { statuses: StatusSpec[] }) {
  if (statuses.length === 0) return null
  return (
    <div className="ks-hud-status" data-testid="hud-status">
      {statuses.map((s) => (
        <span
          key={s.id}
          className={`ks-hud-status-chip ks-${s.kind}`}
          title={s.desc || s.name}
        >
          {s.name}
        </span>
      ))}
    </div>
  )
}
