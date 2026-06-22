// @vitest-environment happy-dom
/**
 * 载具形态（`characterRole === 'vehicle'`）在角色设计里的行为。
 *
 * 载具是「角色定位」chip 组里跟 hero / npc / monster 并列的第 4 档——
 * 但产线分支跟前 3 档不一样：
 *
 *   - 概念图张数：hero = 4 / npc = 1 / monster = 4 / vehicle = 1
 *     （载具是工业产品，4 张细微差别在 gameplay 里没意义；下游 wb-anim/
 *     vehicle-design 管线自己负责切多视角，1 张概念图够了）
 *   - 是否跳过「修改局部细节」：vehicle 跳过
 *     （载具走"画完 → 直接当 final sheet → 接下游切多视角"那条线，没有
 *     hero 那种部件抠图的概念）
 *   - 是否自动跳到像素管线：vehicle 不自动跳
 *     （hero/monster 不跳，npc 才跳——载具下游是 vehicle-design 不是 pixel）
 *   - 概念 prompt：必须是「单台载具 solo vehicle / 中性背景 / 无人无驾驶
 *     员」，不能出现 `reference sheet` / `turnaround` 等多视图禁词。
 */
import { describe, expect, it } from 'vitest'
import {
  buildVehicleConceptPrompt,
  conceptGenButtonLabel,
  conceptVariantCount,
  NPC_PROMPT_FORBIDDEN_KEYWORDS,
  shouldAutoRouteNpcToPixel,
  shouldSkipFinalSheetForNpc,
} from '../CharacterDesign'

describe('conceptVariantCount() — vehicle', () => {
  it('载具产 1 张概念图（下游 vehicle-design 自己切多视角）', () => {
    expect(conceptVariantCount('vehicle')).toBe(1)
  })

  it('既有 hero / npc / monster 行为不变', () => {
    expect(conceptVariantCount('hero')).toBe(4)
    expect(conceptVariantCount('npc')).toBe(1)
    expect(conceptVariantCount('monster')).toBe(4)
  })
})

describe('conceptGenButtonLabel() — vehicle', () => {
  it('载具按钮显示「生成载具设计图」', () => {
    expect(conceptGenButtonLabel('vehicle')).toBe('🎨 生成载具设计图')
  })
})

describe('shouldSkipFinalSheetForNpc() — vehicle', () => {
  it('载具跳过修改局部细节这一步', () => {
    expect(shouldSkipFinalSheetForNpc('vehicle')).toBe(true)
  })
})

describe('shouldAutoRouteNpcToPixel() — vehicle', () => {
  it('载具不自动跳到像素管线（下游是 vehicle-design 不是 pixel-char）', () => {
    expect(shouldAutoRouteNpcToPixel('vehicle', null, 'data:image/png;base64,AAA')).toBe(false)
  })
})

describe('buildVehicleConceptPrompt()', () => {
  it('包含 solo vehicle + 中性背景 + 无人无驾驶员 关键约束', () => {
    const out = buildVehicleConceptPrompt({
      vehicleCategory: 'ground',
      vehicleSubtype: 'sedan',
      worldSetting: 'modern',
    })
    expect(out).toMatch(/solo vehicle/)
    expect(out).toMatch(/single sedan car/)
    expect(out).toMatch(/neutral plain background/)
    expect(out).toMatch(/no rider/i)
    expect(out).toMatch(/no driver/i)
    expect(out).toMatch(/no human in or on the vehicle/i)
  })

  it('禁词约束：不出现 reference sheet / turnaround / multi-view 等多视图触发词', () => {
    const out = buildVehicleConceptPrompt({
      vehicleCategory: 'air',
      vehicleSubtype: 'helicopter',
    })
    // 正向部分一定不能出现这些词；负面里以否定形式提及是允许的（"no reference sheet"），
    // 所以这里只检查不会被 Gemini 当作正向触发的形式：完全裸的 reference sheet/turnaround/multiple views
    // 在 negative 区段以"no reference sheet"形式出现是 OK 的。
    for (const kw of NPC_PROMPT_FORBIDDEN_KEYWORDS) {
      // 走个粗筛——所有禁词出现的位置都必须有"no "前缀（在 negative 段里）
      const idx = out.toLowerCase().indexOf(kw.toLowerCase())
      if (idx >= 0) {
        const prefix = out.slice(Math.max(0, idx - 4), idx).toLowerCase()
        expect(prefix.includes('no ')).toBe(true)
      }
    }
  })

  it('subtype === custom 时使用 customSubtype 文本作为主体描述', () => {
    const out = buildVehicleConceptPrompt({
      vehicleCategory: 'scifi',
      vehicleSubtype: 'custom',
      vehicleSubtypeCustom: '六足蜘蛛形机甲，前端搭载激光炮塔',
    })
    expect(out).toMatch(/六足蜘蛛形机甲/)
    expect(out).toMatch(/single 六足蜘蛛形机甲/)
  })

  it('subtype === custom 但 customSubtype 为空时退化到大类标签', () => {
    const out = buildVehicleConceptPrompt({
      vehicleCategory: 'fantasy',
      vehicleSubtype: 'custom',
      vehicleSubtypeCustom: '',
    })
    // 退化到大类 label「奇幻载具」
    expect(out).toMatch(/single 奇幻载具/)
  })

  it('提供 vehicleStyle / vehicleEra 时把对应的 prompt 片段拼上', () => {
    const out = buildVehicleConceptPrompt({
      vehicleCategory: 'ground',
      vehicleSubtype: 'tank',
      vehicleStyle: 'cyberpunk',
      vehicleEra: 'far-future',
    })
    expect(out).toMatch(/cyberpunk style/)
    expect(out).toMatch(/far-future/)
  })

  it('extraDesc 拼到正向 tag 列表里', () => {
    const out = buildVehicleConceptPrompt({
      vehicleCategory: 'ground',
      vehicleSubtype: 'sedan',
      extraDesc: 'matte black paint with gold trim',
    })
    expect(out).toMatch(/matte black paint with gold trim/)
  })

  it('全空 input 也不崩，退化到「vehicle」泛主体', () => {
    const out = buildVehicleConceptPrompt({})
    expect(out).toMatch(/single vehicle/)
    expect(out).toMatch(/fantasy setting/)
  })
})
