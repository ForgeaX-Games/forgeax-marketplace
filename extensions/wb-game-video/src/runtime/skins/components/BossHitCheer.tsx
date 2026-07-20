/**
 * 受击加油横幅（component id: `bossHitCheer`）—— 右上角，展示「加油，boss扣了 X 血量，还剩 Y 血量」。
 *
 * - 由 watch(小怪掉血) → spawn 触发，`ttlMs` 控制显示时长（demo 用 3000ms）。
 * - 数值（dmg / remain）在 spawn 时用 expr 求值后作为 inputs 传入（本组件只读 inputs，不读实时态）。
 * - 「加油」可点击（组件内事件，manifest 暴露 `cheer`）：点击后在文案后追加**传入的英雄名**（`heroName`）。
 */
import { useState } from 'react'
import type { OverlayProps } from '../rendererRegistry'
import type { ComponentDef } from '../../registry/component-registry'

/** 组件入参（In）；dmg/remain 由 spawn 时 expr 求值传入，heroName 由节点配置传入。 */
export interface BossHitCheerParams {
  /** 传入的英雄名；点击「加油」后追加显示。 */
  heroName?: string
  /** 本次扣血（spawn 时以 `{expr:'abs(delta)'}` 求值传入）。 */
  dmg?: number
  /** 剩余血量（spawn 时以 `{expr:'entity.ent-boss.attr.hp'}` 求值传入）。 */
  remain?: number
}

/**
 * 组件的注册契约（引擎/编辑器识别用）——**与渲染实现同文件**，组件即"包"。
 * 由 `skins/components/index.ts` 统一注册进组件表 + 渲染表。
 */
export const bossHitCheerComponent: ComponentDef<BossHitCheerParams> = {
  role: 'presentation',
  label: '受击加油横幅',
  // 输入契约（In · SSOT）：编辑器据此渲染配置控件；dmg/remain 通常由 spawn 时 expr 注入。
  inputs: [
    { key: 'heroName', label: '英雄名', valueType: 'string', default: '' },
    { key: 'dmg', label: '扣血', valueType: 'number' },
    { key: 'remain', label: '剩余', valueType: 'number' },
  ],
  // 暴露点击事件（Out），供节点配置发现/绑定；demo 中点击追加英雄名由组件自身处理。
  events: [{ id: 'cheer', label: '加油点击' }],
}

export function BossHitCheer({ overlay }: OverlayProps): JSX.Element {
  const p = overlay.inputs as { dmg?: number; remain?: number; heroName?: string }
  const [cheered, setCheered] = useState(false)
  const dmg = typeof p.dmg === 'number' ? p.dmg : 0
  const remain = typeof p.remain === 'number' ? p.remain : 0
  const hero = typeof p.heroName === 'string' ? p.heroName : ''
  return (
    <div
      style={{
        maxWidth: '100%',
        padding: '10px 14px',
        borderRadius: 10,
        background: 'rgba(12,14,18,0.86)',
        border: '1px solid rgba(255,255,255,0.14)',
        color: '#efe7d6',
        fontSize: 15,
        lineHeight: 1.5,
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        role="button"
        tabIndex={0}
        onClick={() => setCheered(true)}
        style={{ color: '#ffd54a', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}
      >
        加油
      </span>
      <span>，boss 扣了 </span>
      <b style={{ color: '#ff6b6b' }}>{dmg}</b>
      <span> 血量，还剩 </span>
      <b style={{ color: '#7aa6d8' }}>{remain}</b>
      <span> 血量</span>
      {cheered && hero ? <span style={{ marginLeft: 6, color: '#9be29b', fontWeight: 700 }}>{hero}</span> : null}
    </div>
  )
}
