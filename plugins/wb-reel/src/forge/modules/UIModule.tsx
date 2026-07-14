import { useState } from 'react'
import { UIStyleSelector } from '../UIStyleSelector'
import { UIAssetLibrary } from './UIAssetLibrary'
import { HudLayoutEditor } from './HudLayoutEditor'
import { TreeThemeEditor } from './TreeThemeEditor'
import { injectStyleOnce } from '../../styles/injectStyle'

type UITab = 'style' | 'library' | 'hud' | 'tree'

const TABS: { id: UITab; label: string; hint: string }[] = [
  { id: 'style', label: '风格', hint: '按钮 / 字幕条 / HUD 的整体视觉规范' },
  { id: 'library', label: 'UI 部件', hint: '好感度 / 姓名条 / 血条等叠加式 UI 部件' },
  { id: 'hud', label: 'HUD 布局', hint: '常驻 HUD(血条/技能框) + 全屏页面(背包/主菜单/宝箱)模块化布局' },
  { id: 'tree', label: '剧情树主题', hint: '游戏内剧情树的节点框 / 背景 / 连线风格 + 关卡选择' },
]

/**
 * UIModule —— Forge「界面」分区的四合一工作台(v11)。
 *
 *   风格     = 原 UIStyleSelector(全局 UI 风格海报选择 + 自定义 prompt)。
 *   UI 部件  = UIAssetLibrary(叠加式 UI 部件 CRUD / 生成 / 去背 / 拖入时间轴的来源)。
 *   HUD 布局 = HudLayoutEditor(布局中枢):子分区「常驻 HUD」绑跨场血条/技能框 +
 *              子分区「全屏页面」模块化拼装真背包 / 主菜单 / 开宝箱 / 搜刮页等整页 UI + 玩法。
 *   剧情树主题 = TreeThemeEditor(游戏内剧情树 per-scenario 主题 + 章节/关卡选择导航)。
 */
export function UIModule() {
  const [tab, setTab] = useState<UITab>('style')
  const active = TABS.find((t) => t.id === tab) ?? TABS[0]!

  return (
    <div className="ks-uimod">
      <div className="ks-uimod-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`ks-uimod-tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="ks-uimod-hint">{active.hint}</span>
      </div>
      <div className="ks-uimod-body">
        {tab === 'style' && <UIStyleSelector />}
        {tab === 'library' && <UIAssetLibrary />}
        {tab === 'hud' && <HudLayoutEditor />}
        {tab === 'tree' && <TreeThemeEditor />}
      </div>
    </div>
  )
}

const css = `
.ks-uimod { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.ks-uimod-tabs {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-bottom: 1px solid var(--color-border-default);
  flex: 0 0 auto;
}
.ks-uimod-tab {
  padding: 6px 14px; border-radius: 999px; cursor: pointer; font-family: inherit;
  font-size: 12.5px; font-weight: 600;
  border: 1px solid var(--color-border-subtle); background: transparent; color: var(--color-text-secondary);
}
.ks-uimod-tab:hover { color: var(--color-text-primary); border-color: var(--color-border-default); }
.ks-uimod-tab.is-active {
  color: var(--color-brand-primary);
  border-color: color-mix(in srgb, var(--color-brand-primary) 50%, transparent);
  background: color-mix(in srgb, var(--color-brand-primary) 12%, transparent);
}
.ks-uimod-hint { margin-left: 8px; font-size: 11px; color: var(--color-text-tertiary); }
.ks-uimod-body {
  flex: 1 1 0; min-height: 0; display: flex; flex-direction: column;
  container-type: inline-size; container-name: ksmod;
}
`
injectStyleOnce('ui-module', css)
