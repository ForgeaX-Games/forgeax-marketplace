import { describe, expect, it } from 'vitest'

import { buildAssetPrompt } from '../../../../server/api-plugin'

describe('buildAssetPrompt pixel component isolation', () => {
  it('forces pixel panel textures to be a single intact standalone frame', () => {
    const prompt = buildAssetPrompt(
      'panel_texture',
      'ui',
      'puzzle',
      'pixel',
      '16-bit arcade pixel UI for PC',
      'retro arcade puzzle cabinet',
      'pixel family only',
    )

    expect(prompt).toContain('SINGLE intact standalone panel frame only')
    expect(prompt).toContain('Do NOT output a whole menu page')
    expect(prompt).toContain('Do NOT include extra buttons, bottom bars, side icons, inventory slots, HUD fragments, or multiple panels')
    expect(prompt).toContain('The frame itself should be the only UI object in the image')
    expect(prompt).toContain('continuous unbroken pixel border')
    expect(prompt).toContain('not ruined, not fragmented')
  })

  it('forces pixel button prompts to reject page fragments and adjacent UI pieces', () => {
    const prompt = buildAssetPrompt(
      'button_primary',
      'ui',
      'puzzle',
      'pixel',
      '16-bit arcade pixel UI for PC',
      'retro arcade puzzle cabinet',
      'pixel family only',
    )

    expect(prompt).toContain('SINGLE standalone button only')
    expect(prompt).toContain('Do NOT output surrounding menu layout, grid background, adjacent UI pieces, or page fragments')
  })

  it('forces pixel title prompts to stay isolated from other UI controls', () => {
    const prompt = buildAssetPrompt(
      'title_deco',
      'ui',
      'puzzle',
      'pixel',
      '16-bit arcade pixel UI for PC',
      'retro arcade puzzle cabinet',
      'pixel family only',
    )

    expect(prompt).toContain('SINGLE standalone title strip only')
    expect(prompt).toContain('Do NOT include buttons, icons, panel frames, HUD bars, or full menu composition')
  })

  it('forces icon prompts to reject app-icon plates and colored containers', () => {
    const prompt = buildAssetPrompt(
      'icon_0',
      'ui',
      'action-rpg',
      'anime',
      'anime fantasy action UI',
      'skill bar icons',
      '',
      'anime',
      'action-rpg',
    )

    expect(prompt).toContain('app-icon plates')
    expect(prompt).toContain('No rounded-square container')
    expect(prompt).toContain('FUNCTIONAL GAME UI GLYPH')
    expect(prompt).toContain('#FFFFFF')
    expect(prompt).toContain('NO TEXT IN IMAGE')
  })

  it('maps layout modules to concrete readable icon metaphors without painting Chinese labels', () => {
    const specs = [
      { id: 'main-nav', label: '主导航', category: '基础导航', layer: 'active-menu', zone: '顶部', assetRoles: ['icon'], description: '切换地图、背包、社交等核心入口。', aiHint: '适合大厅、主城或重系统场景。' },
      { id: 'minimap', label: '小地图', category: '基础导航', layer: 'permanent-hud', zone: '左上/右上', assetRoles: ['icon'], description: '提供方位、目标与危险区域认知。' },
      { id: 'interaction-hints', label: '交互提示', category: '目标引导', layer: 'context-hud', zone: '底部中心', assetRoles: ['icon'], description: '显示按键提示。' },
      { id: 'skill-bar', label: '技能条', category: '战斗与反馈', layer: 'permanent-hud', zone: '底部中心', assetRoles: ['icon'], description: '技能冷却与快捷键。' },
    ]

    const slot0 = buildAssetPrompt('icon_0', 'ui', '大型多人在线', 'sci-fi', 'neon sci-fi UI', '', '', 'sci-fi', 'mmo', specs)
    const slot1 = buildAssetPrompt('icon_1', 'ui', '大型多人在线', 'sci-fi', 'neon sci-fi UI', '', '', 'sci-fi', 'mmo', specs)
    const slot2 = buildAssetPrompt('icon_2', 'ui', '大型多人在线', 'sci-fi', 'neon sci-fi UI', '', '', 'sci-fi', 'mmo', specs)
    const slot3 = buildAssetPrompt('icon_3', 'ui', '大型多人在线', 'sci-fi', 'neon sci-fi UI', '', '', 'sci-fi', 'mmo', specs)

    expect(slot0).toContain('NO TEXT IN IMAGE')
    expect(slot0).toContain('MODULE ID (metadata only')
    expect(slot0).not.toMatch(/[\u3400-\u9fff]/)
    expect([slot0, slot1, slot2, slot3].join('\n')).not.toContain('主导航')
    expect([slot0, slot1, slot2, slot3].join('\n')).toContain('Hamburger menu')
    expect([slot0, slot1, slot2, slot3].join('\n')).toContain('three thick parallel horizontal bars')
    expect([slot0, slot1, slot2, slot3].join('\n')).toContain('single horizontal dash')
    expect([slot0, slot1, slot2, slot3].join('\n')).toContain('Corner minimap widget')
    expect([slot0, slot1, slot2, slot3].join('\n')).not.toContain('提供方位、目标与危险区域认知')
    expect([slot0, slot1, slot2, slot3].join('\n')).toContain('Press-E keycap')
    expect([slot0, slot1, slot2, slot3].join('\n')).toContain('Skill hotbar')
    expect([slot0, slot1, slot2, slot3].join('\n')).toContain('lightning bolt')
    expect([slot0, slot1, slot2, slot3].join('\n')).toContain('hollow circles')
    expect([slot0, slot1, slot2, slot3].join('\n')).toContain('DISTINCT from sibling icons')
    expect([slot0, slot1, slot2, slot3].join('\n')).toContain('main-nav')
  })

  it('forces item and weapon prompts through naked glyph constraints', () => {
    const itemPrompt = buildAssetPrompt('item-0', 'shop', 'action-rpg', 'sci-fi', 'neon sci-fi UI', '', '', 'sci-fi', 'action-rpg')
    const weaponPrompt = buildAssetPrompt('weapon-0', 'weapon-select', 'fps', 'sci-fi', 'neon sci-fi UI', '', '', 'sci-fi', 'fps')

    expect(itemPrompt).toContain('Single naked item glyph')
    expect(itemPrompt).toContain('no app-icon plate')
    expect(itemPrompt).toContain('no colored background card')
    expect(weaponPrompt).toContain('Single naked weapon glyph')
    expect(weaponPrompt).toContain('no rounded-square container')
    expect(weaponPrompt).toContain('no circular badge')
  })
})
