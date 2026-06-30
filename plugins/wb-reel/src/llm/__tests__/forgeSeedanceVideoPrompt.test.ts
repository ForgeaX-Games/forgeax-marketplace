import { describe, it, expect } from 'vitest'
import {
  decidePromptPath,
  pickCameraMove,
  composeSubjectBindings,
  composeShotBlock,
  composeGuardrails,
  composeSeedanceDraft,
  type ForgeSeedancePromptArgs,
} from '../forgeSeedanceVideoPrompt'
import type { SeedanceReferenceSet } from '../buildSeedanceReferenceSet'
import { PERSONAS } from '../directorPersonas'
import type { Shot } from '../../scenario/types'

/**
 * forgeSeedanceVideoPrompt 纯函数层测试（P2，TDD）。
 *
 * 覆盖 sd2-pe 工程约束：
 *   - 路径分流（单镜 A / 多镜 B；编辑/延长/组合恒 A）
 *   - 零绝对秒数（正则断言）
 *   - 一镜一运镜
 *   - 主体绑定语法 <主体N>@图片N，无裸 [asset-xxx]
 *   - 兜底包齐全 + 多主体双胞胎兜底 + 非写实风格锚定
 */

const persona = PERSONAS['villeneuve-epic']

function shot(order: number, overrides: Partial<Shot> = {}): Shot {
  return {
    id: `s-sh${order}`,
    order,
    framing: 'medium',
    prompt: `镜头${order} 的画面内容`,
    ...overrides,
  }
}

/** 6 种规范运镜短语，用于「一镜一运镜」计数断言。 */
const MOVE_PHRASES = [
  '镜头缓慢向前推进',
  '镜头缓慢向后拉远',
  '镜头水平摇移',
  '镜头跟拍移动',
  '固定机位',
  '镜头垂直升降',
]
function countMoves(text: string): number {
  return MOVE_PHRASES.filter((p) => text.includes(p)).length
}

/** 无绝对秒数断言（0–3s / 3秒 / 5s 等都应缺席）。 */
function expectNoAbsoluteSeconds(text: string) {
  expect(text).not.toMatch(/\d+\s*[-–~至到]\s*\d+\s*s/i)
  expect(text).not.toMatch(/\d+\s*秒/)
  expect(text).not.toMatch(/(?<![A-Za-z])\d{1,3}\s*s\b/i)
}

function refSet(partial: Partial<SeedanceReferenceSet> = {}): SeedanceReferenceSet {
  return {
    images: [],
    subjects: [],
    droppedReasons: [],
    ...partial,
  }
}

/** 单角色（大头照 ord1 + 全身照 ord2）的锚点集。 */
const oneCharRefSet = refSet({
  images: [
    { ord: 1, url: 'u1', kind: 'character', subject: '李建', charRole: 'headshot', frameRole: 'reference_image' },
    { ord: 2, url: 'u2', kind: 'character', subject: '李建', charRole: 'fullbody', frameRole: 'reference_image' },
  ],
  subjects: [{ subject: '李建', headshotOrd: 1, fullbodyOrd: 2 }],
})

/** 双角色锚点集（驱动双胞胎兜底）。 */
const twoCharRefSet = refSet({
  images: [
    { ord: 1, url: 'u1', kind: 'character', subject: '甲', charRole: 'headshot', frameRole: 'reference_image' },
    { ord: 2, url: 'u2', kind: 'character', subject: '乙', charRole: 'headshot', frameRole: 'reference_image' },
    { ord: 3, url: 'u3', kind: 'character', subject: '甲', charRole: 'fullbody', frameRole: 'reference_image' },
    { ord: 4, url: 'u4', kind: 'character', subject: '乙', charRole: 'fullbody', frameRole: 'reference_image' },
    { ord: 5, url: 'u5', kind: 'location', label: '楼道', frameRole: 'reference_image' },
  ],
  subjects: [
    { subject: '甲', headshotOrd: 1, fullbodyOrd: 3 },
    { subject: '乙', headshotOrd: 2, fullbodyOrd: 4 },
  ],
})

function args(partial: Partial<ForgeSeedancePromptArgs>): ForgeSeedancePromptArgs {
  return {
    shots: [shot(0)],
    refSet: oneCharRefSet,
    persona,
    visualStyle: 'photoreal',
    taskType: 'multimodal',
    ...partial,
  }
}

describe('decidePromptPath', () => {
  it('0/1 镜 → A；≥2 镜 → B', () => {
    expect(decidePromptPath([])).toBe('A')
    expect(decidePromptPath([shot(0)])).toBe('A')
    expect(decidePromptPath([shot(0), shot(1)])).toBe('B')
    expect(decidePromptPath([shot(0), shot(1), shot(2)])).toBe('B')
  })
})

describe('composeSeedanceDraft · 路径分流', () => {
  it('多模态参考 + 多镜 → 路径 B 三段论', () => {
    const d = composeSeedanceDraft(args({ shots: [shot(0), shot(1), shot(2)] }))
    expect(d.path).toBe('B')
    expect(d.prompt).toContain('【第一段 · 总体设定 + 主体定义】')
    expect(d.prompt).toContain('【第二段 · 镜头分镜】')
    expect(d.prompt).toContain('【第三段 · 风格 + 约束包】')
  })

  it('编辑 / 延长 / 组合任务即使多镜也恒走路径 A', () => {
    for (const taskType of ['edit', 'extend', 'compose'] as const) {
      const d = composeSeedanceDraft(args({ shots: [shot(0), shot(1), shot(2)], taskType }))
      expect(d.path).toBe('A')
      expect(d.prompt).not.toContain('【第二段 · 镜头分镜】')
    }
  })

  it('编辑任务句式用「严格编辑 @视频1」，延长用「向后延长 @视频1」', () => {
    expect(composeSeedanceDraft(args({ taskType: 'edit' })).prompt).toContain('严格编辑 @视频1')
    expect(composeSeedanceDraft(args({ taskType: 'extend' })).prompt).toContain('向后延长 @视频1')
  })

  it('单镜多模态参考 → 路径 A，主语句绑定 <主体1>@图片N', () => {
    const d = composeSeedanceDraft(args({ shots: [shot(0)] }))
    expect(d.path).toBe('A')
    expect(d.prompt).toContain('<主体1>（李建）')
    expect(d.prompt).toMatch(/@图片[12]/)
  })
})

describe('零绝对秒数（镜头序号优先）', () => {
  it('路径 B 草稿不含任何绝对秒数', () => {
    const d = composeSeedanceDraft(
      args({
        shots: [
          shot(0, { durationSec: 3, cameraHint: 'slow dolly-in' }),
          shot(1, { durationSec: 15, cameraHint: 'whip pan' }),
        ],
      }),
    )
    expectNoAbsoluteSeconds(d.prompt)
    expect(d.prompt).toContain('镜头1')
    expect(d.prompt).toContain('镜头2')
  })
})

describe('一镜一运镜', () => {
  it('单个分镜块只含一种运镜短语', () => {
    const block = composeShotBlock(shot(0, { cameraHint: 'slow dolly-in from low angle' }), persona)
    expect(countMoves(block)).toBe(1)
    expect(block).toContain('镜头缓慢向前推进')
    expect(block).toContain('不叠加')
  })

  it('pickCameraMove 关键词映射到唯一 token', () => {
    expect(pickCameraMove(shot(0, { cameraHint: 'dolly-in push' }), persona)).toBe('推进')
    expect(pickCameraMove(shot(0, { cameraHint: 'pull out' }), persona)).toBe('拉远')
    expect(pickCameraMove(shot(0, { cameraHint: 'whip pan' }), persona)).toBe('摇移')
    expect(pickCameraMove(shot(0, { cameraHint: 'handheld follow' }), persona)).toBe('跟移')
    expect(pickCameraMove(shot(0, { cameraHint: 'locked static' }), persona)).toBe('固定')
  })

  it('无 cameraHint 时回退 persona 默认运镜', () => {
    expect(pickCameraMove(shot(0), PERSONAS['villeneuve-epic'])).toBe('推进')
    expect(pickCameraMove(shot(0), PERSONAS['fincher-noir'])).toBe('固定')
    expect(pickCameraMove(shot(0), PERSONAS['miller-kinetic'])).toBe('跟移')
  })

  it('多镜全程每镜恰好一种运镜', () => {
    const shots = [
      shot(0, { cameraHint: 'dolly-in' }),
      shot(1, { cameraHint: 'whip pan' }),
      shot(2, { cameraHint: 'static lock' }),
    ]
    for (const s of shots) {
      expect(countMoves(composeShotBlock(s, persona))).toBe(1)
    }
  })
})

describe('composeShotBlock · 音频特殊符号', () => {
  it('台词用 {}、音效用 <>', () => {
    const block = composeShotBlock(
      shot(0, { dialogueText: '你来了', audioHint: '远处传来钟声' }),
      persona,
    )
    expect(block).toContain('{你来了}')
    expect(block).toContain('<远处传来钟声>')
  })

  it('无台词无音效 → 环境氛围音兜底', () => {
    expect(composeShotBlock(shot(0), persona)).toContain('环境氛围音')
  })
})

describe('composeSubjectBindings · 绑定语法', () => {
  it('大头照 + 全身照双图绑定句正确', () => {
    const text = composeSubjectBindings(oneCharRefSet)
    expect(text).toContain('<主体1>（李建）的面部特征参考 @图片1（大头照），妆造参考 @图片2（全身照）')
  })

  it('多主体编号递增，并声明场景锚点', () => {
    const text = composeSubjectBindings(twoCharRefSet)
    expect(text).toContain('<主体1>（甲）')
    expect(text).toContain('<主体2>（乙）')
    expect(text).toContain('将 @图片5 中的场景 定义为 <场景1>')
  })

  it('绝不裸写 [asset-xxx]', () => {
    const text = composeSubjectBindings(twoCharRefSet)
    expect(text).not.toMatch(/\[asset-/)
  })

  it('@图片N 后均为括号/标点隔断，不紧接动词（防数字粘连歧义）', () => {
    const text = composeSubjectBindings(twoCharRefSet)
    // @图片N 后不得直接紧跟「中」以外的中文字符（防裸接动词/方位词）
    const m = text.match(/@图片\d+(.)/g) ?? []
    for (const seg of m) {
      const after = seg.slice(-1)
      const isOffendingCjk = /[\u4e00-\u9fa5]/.test(after) && after !== '中'
      expect(isOffendingCjk).toBe(false)
    }
  })
})

describe('composeGuardrails · 兜底包', () => {
  it('画质包 / 稳定包 / 字幕兜底 / 水印兜底 默认必挂', () => {
    const g = composeGuardrails(args({}))
    expect(g).toContain('画质包：高清，细节丰富，电影质感')
    expect(g).toContain('稳定包：人物面部稳定不变形')
    expect(g).toContain('字幕兜底：保持无字幕')
    expect(g).toContain('水印兜底：不要生成水印；不要生成 Logo')
  })

  it('单主体不挂双胞胎兜底', () => {
    expect(composeGuardrails(args({ refSet: oneCharRefSet }))).not.toContain('双胞胎兜底')
  })

  it('多主体必挂双胞胎兜底', () => {
    expect(composeGuardrails(args({ refSet: twoCharRefSet }))).toContain('双胞胎兜底')
  })

  it('写实风格不挂风格锚定；非写实风格必挂', () => {
    expect(composeGuardrails(args({ visualStyle: 'photoreal' }))).not.toContain('风格锚定')
    const anime = composeGuardrails(args({ visualStyle: 'anime' }))
    expect(anime).toContain('风格锚定')
    expect(anime).toContain('2D 日漫风格')
  })

  // P2.6 · 防千篇一律：差异化行对所有风格必挂（含写实，且不触发「风格锚定」误判）
  it('差异化行所有风格必挂；写实挂差异化但仍不挂风格锚定', () => {
    const photo = composeGuardrails(args({ visualStyle: 'photoreal' }))
    expect(photo).toContain('差异化')
    expect(photo).toContain('避免千篇一律的默认套路')
    expect(photo).not.toContain('风格锚定')
    expect(composeGuardrails(args({ visualStyle: 'anime' }))).toContain('差异化')
  })
})

describe('disclosures · 透明披露', () => {
  it('披露路径、兜底挂载、无秒数、低缓动作', () => {
    const d = composeSeedanceDraft(args({ shots: [shot(0), shot(1)], refSet: twoCharRefSet, visualStyle: 'anime' }))
    const joined = d.disclosures.join('\n')
    expect(joined).toContain('路径 B')
    expect(joined).toContain('画质包')
    expect(joined).toMatch(/未写绝对秒数|发送层结算/)
    expect(joined).toContain('低缓连续小动作')
    expect(joined).toContain('双胞胎兜底')
    expect(joined).toContain('2D 日漫风格')
  })

  it('转发锚点装配告警', () => {
    const rs = refSet({ subjects: [{ subject: '甲', headshotOrd: 1 }], droppedReasons: ['参考图超过上限 9'] })
    const d = composeSeedanceDraft(args({ refSet: rs }))
    expect(d.disclosures.join('\n')).toContain('参考图超过上限 9')
  })
})
