import { describe, expect, it } from 'vitest'
import { sniffScenarioJson } from '../scenarioJsonSniff'

/**
 * 真实流入的 JSON 片段往往是残缺的 —— 这套测试覆盖各种"写到一半"的形态。
 */
describe('sniffScenarioJson', () => {
  it('空串 / 极短串 → 基本全空', () => {
    const r = sniffScenarioJson('')
    expect(r.title).toBeNull()
    expect(r.characterCount).toBe(0)
    expect(r.sceneCount).toBe(0)
  })

  it('只写到 title → 抽出标题', () => {
    const raw = '{"title":"雨夜归人","synopsis":"暂'
    const r = sniffScenarioJson(raw)
    expect(r.title).toBe('雨夜归人')
    expect(r.synopsis).toBeNull() // synopsis 还没闭合，取不到
  })

  it('title + synopsis + uiStyle 都完整', () => {
    const raw =
      '{"title":"雨夜归人","synopsis":"他回到旧居","uiStyle":{"prompt":"胶片颗粒 · 低饱和"},"characters":[]'
    const r = sniffScenarioJson(raw)
    expect(r.title).toBe('雨夜归人')
    expect(r.synopsis).toBe('他回到旧居')
    expect(r.styleNote).toBe('胶片颗粒 · 低饱和')
  })

  it('characters 数组完整 → 名字列表和数量正确', () => {
    const raw =
      '{"characters":[{"id":"a","name":"他","prompt":"..."},{"id":"b","name":"她","prompt":"..."}]'
    const r = sniffScenarioJson(raw)
    expect(r.characterCount).toBe(2)
    expect(r.characterNames).toEqual(['他', '她'])
  })

  it('characters 数组"正在写第 3 个" → 名字列表准确、count 反映已完结的', () => {
    const raw =
      '{"characters":[{"name":"他"},{"name":"她"},{"name":"门外的人'
    const r = sniffScenarioJson(raw)
    // 前两个对象已完结，第三个在写：数组未闭合，count 计作 2（已完结）
    expect(r.characterCount).toBe(2)
    // 第三个名字已经吐出来了 —— 我们能抓到
    expect(r.characterNames).toEqual(['他', '她', '门外的人'])
  })

  it('scenes 数组正在写最后一场 → currentSceneTitle 取最后一个', () => {
    const raw =
      '{"title":"X","scenes":[{"id":"s1","title":"门前","dialogue":[]},{"id":"s2","title":"地铁站台"'
    const r = sniffScenarioJson(raw)
    expect(r.sceneCount).toBe(1)
    expect(r.currentSceneTitle).toBe('地铁站台')
  })

  it('scenes 完整 → count 与 title 一致', () => {
    const raw =
      '{"scenes":[{"title":"A"},{"title":"B"},{"title":"C"}]}'
    const r = sniffScenarioJson(raw)
    expect(r.sceneCount).toBe(3)
    expect(r.currentSceneTitle).toBe('C')
  })

  it('JSON 里带转义双引号不会炸', () => {
    const raw = '{"title":"她说\\"不\\"","characters":[{"name":"她"}]'
    const r = sniffScenarioJson(raw)
    expect(r.title).toBe('她说"不"')
    expect(r.characterNames).toEqual(['她'])
  })

  it('characters 和 scenes 共存不混淆（都有 title/name）', () => {
    const raw =
      '{"title":"全局","characters":[{"name":"A"},{"name":"B"}],"scenes":[{"title":"场景 1"},{"title":"场景 2"'
    const r = sniffScenarioJson(raw)
    expect(r.title).toBe('全局')
    expect(r.characterNames).toEqual(['A', 'B'])
    expect(r.currentSceneTitle).toBe('场景 2')
    expect(r.sceneCount).toBe(1)
  })

  it('tailPreview 总是最后 240 字符', () => {
    const raw = 'x'.repeat(500) + 'END'
    const r = sniffScenarioJson(raw)
    expect(r.tailPreview.length).toBeLessThanOrEqual(240)
    expect(r.tailPreview.endsWith('END')).toBe(true)
  })

  it('角色名去重：同名只留一份', () => {
    const raw = '{"characters":[{"name":"他"},{"name":"他"},{"name":"她"}]'
    const r = sniffScenarioJson(raw)
    expect(r.characterNames).toEqual(['他', '她'])
  })
})
