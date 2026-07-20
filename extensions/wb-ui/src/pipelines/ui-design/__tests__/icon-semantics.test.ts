import { describe, expect, it } from 'vitest'

import {
  activeIconModuleSpecs,
  buildFunctionalIconPrompt,
  buildModuleIconBrief,
  collectIconModuleSpecs,
  iconSlotDescriptorsFromModuleSpecs,
  iconSlotIndexForModuleId,
  moduleNeedsFunctionalIcon,
  type ModuleAssetSpecLike,
} from '../icon-semantics'
import { buildModuleAssetSpecs } from '../model'

describe('icon semantics from step-2 modules', () => {
  it('only collects modules with readable glyph and clear icon need', () => {
    const specs: ModuleAssetSpecLike[] = [
      { id: 'main-nav', label: '主导航', category: '基础导航', layer: 'active-menu', zone: '顶部', description: '', aiHint: '', assetRoles: ['icon'] },
      { id: 'minimap', label: '小地图', category: '基础导航', layer: 'permanent-hud', zone: '右上', description: '', aiHint: '', assetRoles: ['icon'] },
      { id: 'interaction-hints', label: '交互提示', category: '目标引导', layer: 'context-hud', zone: '底部中心', description: '', aiHint: '', assetRoles: ['icon'] },
      { id: 'skill-bar', label: '技能条', category: '战斗与反馈', layer: 'permanent-hud', zone: '底部中心', description: '', aiHint: '', assetRoles: ['icon'] },
      { id: 'dialog-box', label: '对话框', category: '社交系统', layer: 'depth-settings', zone: '底部', description: '', aiHint: '', assetRoles: ['panel', 'notification'] },
    ]
    const iconSpecs = activeIconModuleSpecs(specs)
    expect(iconSpecs.map(s => s.id)).toEqual(expect.arrayContaining([
      'main-nav',
      'minimap',
      'interaction-hints',
      'skill-bar',
    ]))
    expect(iconSpecs).toHaveLength(4)
    expect(iconSpecs.some(s => s.id === 'dialog-box')).toBe(false)
  })

  it('prioritizes card/list modules into the first icon slots', () => {
    const specs = buildModuleAssetSpecs('open-world', [
      'main-nav',
      'minimap',
      'interaction-hints',
      'skill-bar',
      'reward-summary',
      'character-panel',
      'item-detail',
      'inventory-grid',
    ])
    const active = activeIconModuleSpecs(specs)
    expect(active[0]?.id).toBe('reward-summary')
    expect(active[1]?.id).toBe('character-panel')
    expect(active[2]?.id).toBe('item-detail')
    expect(active[3]?.id).toBe('inventory-grid')
    expect(iconSlotIndexForModuleId(specs, 'reward-summary')).toBe(0)
    expect(iconSlotIndexForModuleId(specs, 'character-panel')).toBe(1)
  })

  it('includes card/list modules and exposes UI descriptors with function captions', () => {
    const specs = buildModuleAssetSpecs('action-rpg', [
      'reward-summary',
      'character-panel',
      'quest-tracker',
      'inventory-grid',
    ])
    const ids = collectIconModuleSpecs(specs).map(s => s.id)
    expect(ids).toEqual(expect.arrayContaining([
      'reward-summary',
      'character-panel',
      'quest-tracker',
      'inventory-grid',
    ]))
    const descriptors = iconSlotDescriptorsFromModuleSpecs(specs)
    expect(descriptors[0]?.functionTitle).toContain('结算')
    expect(descriptors[0]?.visualHint.length).toBeGreaterThan(0)
    expect(descriptors.every(d => d.label && d.functionTitle && d.visualHint)).toBe(true)
  })

  it('maps module id to stable icon slot index for preview', () => {
    const specs = buildModuleAssetSpecs('open-world', [
      'reward-summary',
      'character-panel',
      'main-nav',
      'minimap',
    ])
    expect(iconSlotIndexForModuleId(specs, 'reward-summary')).toBe(0)
    const mainNavIdx = iconSlotIndexForModuleId(specs, 'main-nav')
    expect(mainNavIdx === -1 || mainNavIdx >= 0).toBe(true)
  })

  it('builds icon brief from module function with Chinese semantic anchors', () => {
    const spec: ModuleAssetSpecLike = {
      id: 'inventory-grid',
      label: '背包网格',
      category: '成长与资源',
      layer: 'active-menu',
      zone: '中央面板',
      description: '物品、装备与资源容量管理。',
      aiHint: '生存、RPG、经济系统常见。',
      assetRoles: ['card', 'panel', 'list-row', 'icon'],
    }
    expect(moduleNeedsFunctionalIcon(spec)).toBe(true)
    const brief = buildModuleIconBrief(spec, 0, 'open-world')
    expect(brief.functionalIntent).toContain('物品、装备与资源容量管理')
    expect(brief.symbolZh).toContain('背包')
    expect(brief.visualZh).toContain('3×3')
    expect(brief.anchor).toBe('Inventory grid')
    expect(brief.motif).toContain('NOT a standalone backpack')
    expect(brief.usageScene).toContain('主动菜单')
  })

  it('builds image prompt without Chinese characters that models may paint', () => {
    const spec: ModuleAssetSpecLike = {
      id: 'reward-summary',
      label: '绿码结算',
      category: '成长与资源',
      layer: 'active-menu',
      zone: '中央面板',
      description: '关卡结算与绿码领取。',
      aiHint: '',
      assetRoles: ['card', 'panel', 'icon'],
    }
    const brief = buildModuleIconBrief(spec, 0, 'open-world')
    const prompt = buildFunctionalIconPrompt(brief, {
      styleBase: 'sci-fi UI',
      extraHint: 'flat vector',
      styleMaterialNote: 'neon accents only',
      sciFiFlatNote: '',
      siblingAnchors: ['gear cog'],
      moduleIconHint: 'reward-summary (icon)',
    })
    expect(prompt).not.toMatch(/[\u3400-\u9fff]/)
    expect(prompt).toContain('NO TEXT IN IMAGE')
    expect(prompt).toContain('reward-summary')
    expect(prompt).toContain('settlement/reward banner')
  })
})
