import { useScenarioStore } from '../../scenario/scenarioStore'
import { isModuleEnabled } from '../../scenario/moduleFlags'
import { injectStyleOnce } from '../../styles/injectStyle'
import type { HudElement, HudRule, StatusSpec } from '../../scenario/types'
import { coerceHudRules } from '../../scenario/gameplayTypes'
import { ModuleShell } from './ModuleShell'

/**
 * RulesModule —— 「模块」中枢里的全局规则面板（对应原型「规则」栏目）。
 *
 * 编辑两类全局玩法规则，落 Scenario.ui / Scenario.statuses（SSOT）：
 *   - HUD 元素显隐：玩家/Boss 血条、积分、状态、背包、计时器各自的显示时机；
 *     缺省（智能）= 由 HudLayer 按 SceneKind 自动决定，不写死。
 *   - 状态效果注册表：中毒/增益/眩晕等的词汇表（HUD 图标 + 条件判定用）。
 *
 * 数值公式 / 胜负条件归「数值系统」模块（变量 + 分支 condition），这里只放
 * 「显隐 + 状态」两类真正缺少编辑入口的全局规则，避免与数值模块重复。
 */
const HUD_ELEMENTS: { element: HudElement; label: string }[] = [
  { element: 'playerHp', label: '玩家血条' },
  { element: 'bossHp', label: 'Boss 血条' },
  { element: 'score', label: '积分' },
  { element: 'status', label: '状态图标' },
  { element: 'inventory', label: '背包' },
  { element: 'timer', label: '计时器' },
]

const SHOW_OPTIONS: { value: HudRule['show'] | 'auto'; label: string }[] = [
  { value: 'auto', label: '智能（默认）' },
  { value: 'always', label: '全程显示' },
  { value: 'battle', label: '仅 Boss 战' },
  { value: 'qte', label: '仅 QTE / 限时' },
  { value: 'never', label: '隐藏' },
]

export function RulesModule() {
  const modules = useScenarioStore((s) => s.scenario.modules)
  const ui = useScenarioStore((s) => s.scenario.ui)
  const statuses = useScenarioStore((s) => s.scenario.statuses)
  const setModuleEnabled = useScenarioStore((s) => s.setModuleEnabled)
  const setHudRule = useScenarioStore((s) => s.setHudRule)
  const removeHudRule = useScenarioStore((s) => s.removeHudRule)
  const setHudAccent = useScenarioStore((s) => s.setHudAccent)
  const upsertStatus = useScenarioStore((s) => s.upsertStatus)
  const removeStatus = useScenarioStore((s) => s.removeStatus)

  const enabled = isModuleEnabled({ modules }, 'rules')
  const hudByElement = new Map(coerceHudRules(ui?.hud).map((r) => [r.element, r.show]))
  const statusList = Object.values(statuses ?? {})

  function setShow(element: HudElement, value: HudRule['show'] | 'auto'): void {
    if (value === 'auto') removeHudRule(element)
    else setHudRule(element, value)
  }

  function addStatus(): void {
    const id = `st_${Date.now().toString(36)}`
    upsertStatus({ id, name: '新状态', kind: 'buff' })
  }

  return (
    <ModuleShell
      title="RULES · 规则"
      subtitle="全局玩法规则：HUD 元素显隐 + 状态效果注册表。数值/胜负条件见「数值系统」模块。"
      enabled={enabled}
      onToggle={(next) => setModuleEnabled('rules', next)}
    >
      <div className="ks-rules">
        {/* HUD 显隐 */}
        <section className="ks-rules-sec">
          <div className="ks-rules-sec-head">
            <h3 className="ks-rules-sec-title">HUD 元素显隐</h3>
            <p className="ks-rules-sec-desc">各 HUD 元素的显示时机；「智能」= 按场景类别自动决定。</p>
          </div>
          <div className="ks-rules-hud">
            {HUD_ELEMENTS.map(({ element, label }) => (
              <label key={element} className="ks-rules-hud-row">
                <span className="ks-rules-hud-label">{label}</span>
                <select
                  className="ks-rules-input"
                  value={hudByElement.get(element) ?? 'auto'}
                  onChange={(e) => setShow(element, e.target.value as HudRule['show'] | 'auto')}
                >
                  {SHOW_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="ks-rules-accent">
            <span className="ks-rules-hud-label">HUD 主题色</span>
            <input
              type="color"
              className="ks-rules-color"
              value={ui?.accentColor ?? '#d4ff48'}
              onChange={(e) => setHudAccent(e.target.value)}
            />
            {ui?.accentColor ? (
              <button type="button" className="ks-rules-clear" onClick={() => setHudAccent(undefined)}>
                重置
              </button>
            ) : (
              <span className="ks-rules-muted">默认</span>
            )}
          </label>
        </section>

        {/* 状态效果 */}
        <section className="ks-rules-sec">
          <div className="ks-rules-sec-head">
            <h3 className="ks-rules-sec-title">状态效果</h3>
            <p className="ks-rules-sec-desc">中毒 / 增益 / 眩晕等的注册表，供 HUD 状态图标与条件判定引用。</p>
          </div>
          {statusList.length === 0 ? (
            <p className="ks-rules-empty">还没有状态效果。</p>
          ) : (
            <div className="ks-rules-status-list">
              {statusList.map((st) => (
                <StatusRow
                  key={st.id}
                  status={st}
                  onChange={(patch) => upsertStatus({ ...st, ...patch })}
                  onRemove={() => removeStatus(st.id)}
                />
              ))}
            </div>
          )}
          <button type="button" className="ks-rules-add" onClick={addStatus}>
            + 添加状态效果
          </button>
        </section>
      </div>
    </ModuleShell>
  )
}

function StatusRow({
  status,
  onChange,
  onRemove,
}: {
  status: StatusSpec
  onChange: (patch: Partial<StatusSpec>) => void
  onRemove: () => void
}) {
  return (
    <div className="ks-rules-status">
      <input
        className="ks-rules-input ks-rules-status-name"
        type="text"
        placeholder="状态名"
        value={status.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <select
        className="ks-rules-input ks-rules-status-kind"
        value={status.kind}
        onChange={(e) => onChange({ kind: e.target.value as StatusSpec['kind'] })}
      >
        <option value="buff">增益</option>
        <option value="debuff">减益</option>
      </select>
      <input
        className="ks-rules-input ks-rules-status-desc"
        type="text"
        placeholder="备注（可选）"
        value={status.desc ?? ''}
        onChange={(e) => onChange({ desc: e.target.value || undefined })}
      />
      <button type="button" className="ks-rules-del" title="删除状态" onClick={onRemove}>
        ✕
      </button>
    </div>
  )
}

const RULES_CSS = `
.ks-rules {
  display: flex; flex-direction: column; gap: 20px;
  padding: 16px 18px 24px;
  max-width: 720px;
}
.ks-rules-sec { display: flex; flex-direction: column; gap: 10px; }
.ks-rules-sec-head { display: flex; flex-direction: column; gap: 2px; }
.ks-rules-sec-title { margin: 0; font-size: 14px; font-weight: 700; color: var(--color-text-primary, #fff); }
.ks-rules-sec-desc { margin: 0; font-size: 12px; color: var(--color-text-tertiary, rgba(255,255,255,0.5)); line-height: 1.5; }
.ks-rules-input {
  padding: 6px 8px;
  background: var(--color-background-base, rgba(0,0,0,0.35));
  border: 1px solid var(--color-border-default, rgba(255,255,255,0.14));
  border-radius: 6px;
  color: var(--color-text-primary, #fff);
  font-size: 12px;
  box-sizing: border-box;
}
.ks-rules-hud { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
.ks-rules-hud-row { display: grid; grid-template-columns: 80px 1fr; align-items: center; gap: 8px; }
.ks-rules-hud-label { font-size: 12px; color: var(--color-text-secondary, rgba(255,255,255,0.7)); }
.ks-rules-accent { display: flex; align-items: center; gap: 10px; margin-top: 2px; }
.ks-rules-color { width: 40px; height: 26px; padding: 0; border: 1px solid var(--color-border-default, rgba(255,255,255,0.2)); border-radius: 6px; background: none; cursor: pointer; }
.ks-rules-clear, .ks-rules-muted { font-size: 11px; color: var(--color-text-tertiary, rgba(255,255,255,0.5)); }
.ks-rules-clear { background: none; border: none; cursor: pointer; text-decoration: underline; }
.ks-rules-empty { font-size: 12px; color: var(--color-text-tertiary, rgba(255,255,255,0.5)); margin: 0; }
.ks-rules-status-list { display: flex; flex-direction: column; gap: 6px; }
.ks-rules-status { display: grid; grid-template-columns: 1fr 84px 1.4fr 24px; gap: 6px; align-items: center; }
.ks-rules-del {
  background: none; border: none; color: rgba(248,113,113,0.8);
  cursor: pointer; font-size: 13px; padding: 0;
}
.ks-rules-add {
  align-self: flex-start;
  padding: 6px 12px; border-radius: 6px; cursor: pointer;
  background: var(--color-background-base, rgba(255,255,255,0.06));
  border: 1px dashed var(--color-border-default, rgba(255,255,255,0.22));
  color: var(--color-text-secondary, rgba(255,255,255,0.75)); font-size: 12px;
}
`
injectStyleOnce('ks-rules-module', RULES_CSS)
