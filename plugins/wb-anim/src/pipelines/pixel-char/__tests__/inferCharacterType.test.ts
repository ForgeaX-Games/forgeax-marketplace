/**
 * @vitest-environment happy-dom
 *
 * 像素管线不再有独立的"角色类型"UI 字段，而是从角色设计阶段的 profile
 * 自动推导。这里测试那条推导规则，避免以后有人不小心改回到错误映射。
 */
import { describe, it, expect } from 'vitest'
import { pickCharacterTypeForProfile } from '../index'

describe('pickCharacterTypeForProfile', () => {
  it('hero / npc / 默认 → humanoid', () => {
    expect(pickCharacterTypeForProfile({ characterRole: 'hero' })).toBe('humanoid')
    expect(pickCharacterTypeForProfile({ characterRole: 'npc' })).toBe('humanoid')
    expect(pickCharacterTypeForProfile({})).toBe('humanoid')
    expect(pickCharacterTypeForProfile(null)).toBe('humanoid')
    expect(pickCharacterTypeForProfile(undefined)).toBe('humanoid')
  })

  it('monster + threat=boss → 大型 monster（带 humanoidGuards=false 的 BOSS 预设）', () => {
    expect(pickCharacterTypeForProfile({ characterRole: 'monster', monsterThreat: 'boss' }))
      .toBe('monster')
  })

  it('monster + threat=elite → 大型 monster', () => {
    expect(pickCharacterTypeForProfile({ characterRole: 'monster', monsterThreat: 'elite' }))
      .toBe('monster')
  })

  it('monster + giant / heavy 体型 → 大型 monster（即便威胁=normal）', () => {
    expect(pickCharacterTypeForProfile({
      characterRole: 'monster', monsterThreat: 'normal', monsterBodyType: 'giant',
    })).toBe('monster')
    expect(pickCharacterTypeForProfile({
      characterRole: 'monster', monsterThreat: 'normal', monsterBodyType: 'heavy',
    })).toBe('monster')
  })

  it('monster + normal 威胁 + 其他体型 → creature-small（小怪）', () => {
    expect(pickCharacterTypeForProfile({ characterRole: 'monster' })).toBe('creature-small')
    expect(pickCharacterTypeForProfile({
      characterRole: 'monster', monsterBodyType: 'default',
    })).toBe('creature-small')
    expect(pickCharacterTypeForProfile({
      characterRole: 'monster', monsterBodyType: 'agile',
    })).toBe('creature-small')
    expect(pickCharacterTypeForProfile({
      characterRole: 'monster', monsterBodyType: 'compact', monsterThreat: 'normal',
    })).toBe('creature-small')
  })

  it('旧数据兼容：没有 characterRole 字段 + bodyType!=humanoid 当作 monster', () => {
    expect(pickCharacterTypeForProfile({ bodyType: 'beast' })).toBe('monster')
    expect(pickCharacterTypeForProfile({ bodyType: 'humanoid' })).toBe('humanoid')
  })

  it('hero/npc 的 bodyType 不影响 characterType——mascot/beast/mecha 主角仍是 humanoid', () => {
    // 角色设计阶段的"形态"是美术风格输入，不是动画骨架——吉祥物主角还是按
    // 双足走 walk cycle。
    expect(pickCharacterTypeForProfile({ characterRole: 'hero', bodyType: 'mascot' })).toBe('humanoid')
    expect(pickCharacterTypeForProfile({ characterRole: 'hero', bodyType: 'beast' })).toBe('humanoid')
    expect(pickCharacterTypeForProfile({ characterRole: 'hero', bodyType: 'mecha' })).toBe('humanoid')
    expect(pickCharacterTypeForProfile({ characterRole: 'npc', bodyType: 'beast' })).toBe('humanoid')
  })

  it('characterRole 优先于 bodyType（monster role 覆盖旧字段）', () => {
    expect(pickCharacterTypeForProfile({
      characterRole: 'monster', bodyType: 'humanoid',
    })).toBe('creature-small')
  })
})
