import type { JSX } from 'react'
import { MATERIAL_DND_MIME } from '../video/MaterialTimeline'
import type { MaterialTemplate, SchemeMountTab } from '../video/graphMaterialOps'
import {
  DEFAULT_STYLE_SLOTS,
  ICON_COMPONENT,
  type DefaultStyleSlot,
} from './defaultStyleSlots'

interface GraphMaterialLibraryPanelProps {
  addTab: string
  schemeMountTabs: SchemeMountTab[]
  defaultSlotDisabledReason: Record<DefaultStyleSlot['id'], string | undefined>
  addDisabledReason?: string
  onAddTabChange: (tab: string) => void
  onAddMaterial: (template: MaterialTemplate) => void
}

export function GraphMaterialLibraryPanel({
  addTab,
  schemeMountTabs,
  defaultSlotDisabledReason,
  addDisabledReason,
  onAddTabChange,
  onAddMaterial,
}: GraphMaterialLibraryPanelProps): JSX.Element {
  const activeAddTab = schemeMountTabs.some((tab) => tab.mountId === addTab) ? addTab : 'default'
  const activeMountComponents = schemeMountTabs.find((tab) => tab.mountId === activeAddTab)?.components ?? []

  return (
    <div className="gvv-toolpanel">
      <span className="gvv-toolpanel-head">添加控件</span>
      {schemeMountTabs.length > 0 ? (
        <div className="gvv-toolseg" role="group" aria-label="添加控件分类">
          <button
            type="button"
            className={activeAddTab === 'default' ? 'is-on' : ''}
            aria-pressed={activeAddTab === 'default'}
            onClick={() => onAddTabChange('default')}
          >
            默认样式
          </button>
          {schemeMountTabs.map((tab) => (
            <button
              key={tab.mountId}
              type="button"
              className={activeAddTab === tab.mountId ? 'is-on' : ''}
              aria-pressed={activeAddTab === tab.mountId}
              onClick={() => onAddTabChange(tab.mountId)}
            >
              {tab.title}
            </button>
          ))}
        </div>
      ) : null}
      {activeAddTab === 'default' ? (
        <div className="gc-lib-grid">
          {DEFAULT_STYLE_SLOTS.map((slot) => (
            <MaterialCard
              key={slot.id}
              icon={slot.icon}
              title={slot.title}
              template={slot.id}
              desc={slot.desc}
              disabledReason={defaultSlotDisabledReason[slot.id]}
              onClick={() => onAddMaterial(slot.id)}
            />
          ))}
        </div>
      ) : (
        <div className="gc-lib-grid">
          {activeMountComponents.length > 0 ? activeMountComponents.map((component) => (
            <MaterialCard
              key={component.id}
              icon={ICON_COMPONENT}
              title={component.label}
              template={component.id}
              desc={`从挂载方案克隆「${component.label}」（${component.componentId} · ${component.id}）到时间轴，保留其绑定等输入。`}
              disabledReason={addDisabledReason}
              onClick={() => onAddMaterial(component.id)}
            />
          )) : (
            <span className="gc-lib-empty">这个方案目录里还没有组件。</span>
          )}
        </div>
      )}
    </div>
  )
}

function MaterialCard({
  icon,
  title,
  desc,
  template,
  disabledReason,
  onClick,
}: {
  icon: JSX.Element
  title: string
  desc: string
  template: MaterialTemplate
  disabledReason?: string
  onClick: () => void
}): JSX.Element {
  const enabled = !disabledReason
  return (
    <button
      type="button"
      className={`gc-lib-item${disabledReason ? ' is-disabled' : ''}`}
      disabled={!enabled}
      title={disabledReason ?? `${desc}（点击添加，或按住拖入时间轴落点）`}
      draggable={enabled}
      onClick={enabled ? onClick : undefined}
      onDragStart={
        enabled
          ? (event) => {
              event.dataTransfer.setData(MATERIAL_DND_MIME, template)
              event.dataTransfer.effectAllowed = 'copy'
            }
          : undefined
      }
    >
      <span className="gc-lib-ico">{icon}</span>
      <strong>{title}</strong>
    </button>
  )
}
