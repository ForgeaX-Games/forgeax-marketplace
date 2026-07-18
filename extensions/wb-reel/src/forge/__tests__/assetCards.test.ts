import { describe, it, expect } from 'vitest'
import {
  cardTag,
  composeCardPrompt,
  computeNodeCards,
  resolveScenePrompt,
  collectScenePropIds,
  anchorRefMediaId,
  buildAnchorRefs,
  buildSeededCardRefs,
  type CardSpec,
} from '../assetCards'
import type { Scenario, Scene } from '../../scenario/types'

function makeScene(over: Partial<Scene> = {}): Scene {
  return {
    id: 's1',
    title: '咖啡店',
    media: { kind: 'IMAGE_PROMPT', prompt: 'a cafe interior' },
    durationMs: 9000,
    dialogue: [],
    branches: [],
    ...over,
  } as Scene
}

function makeScenario(over: Partial<Scenario> = {}): Scenario {
  return {
    id: 'sc1',
    title: 'demo',
    rootSceneId: 's1',
    scenes: {},
    defaultCharMs: 40,
    ...over,
  } as Scenario
}

describe('cardTag', () => {
  it('场景卡固定 tag', () => {
    expect(cardTag({ kind: 'scene', id: 'scene' })).toBe('reel:card:scene')
  })
  it('角色卡按 anchor + 变体区分', () => {
    expect(cardTag({ kind: 'character', id: 'char:c1', anchorId: 'c1' })).toBe(
      'reel:card:char:c1:main',
    )
    expect(cardTag({ kind: 'character', id: 'char:c1', anchorId: 'c1' }, 'v2')).toBe(
      'reel:card:char:c1:v2',
    )
  })
  it('道具卡 / 自由卡', () => {
    expect(cardTag({ kind: 'prop', id: 'prop:p1', anchorId: 'p1' }, 'vb')).toBe(
      'reel:card:prop:p1:vb',
    )
    expect(cardTag({ kind: 'free', id: 'free-xyz' })).toBe('reel:card:free:free-xyz')
  })
})

describe('resolveScenePrompt', () => {
  it('优先 prompts.scene，回退 media.prompt', () => {
    expect(resolveScenePrompt(makeScene({ prompts: { scene: 'P' } }))).toBe('P')
    expect(resolveScenePrompt(makeScene())).toBe('a cafe interior')
  })
})

describe('collectScenePropIds', () => {
  it('跨 shot 去重保序', () => {
    const scene = makeScene({
      shots: [
        { id: 'sh1', order: 0, framing: 'medium', prompt: '', propIds: ['p1', 'p2'] },
        { id: 'sh2', order: 1, framing: 'medium', prompt: '', propIds: ['p2', 'p3'] },
      ] as Scene['shots'],
    })
    expect(collectScenePropIds(scene)).toEqual(['p1', 'p2', 'p3'])
  })
})

describe('computeNodeCards', () => {
  it('播种: 场景卡 + 每出场角色 + 每关键道具', () => {
    const scene = makeScene({
      characterIds: ['c1', 'missing'],
      shots: [
        {
          id: 'sh1',
          order: 0,
          framing: 'medium',
          prompt: '',
          propIds: ['p1'],
          characterVariantIds: { c1: 'v-suit' },
        },
      ] as Scene['shots'],
    })
    const scenario = makeScenario({
      characters: {
        c1: {
          id: 'c1',
          name: '林叙',
          prompt: 'young man',
          appearanceVariants: [{ id: 'v-suit', label: '西装', prompt: 'in suit' }],
        },
      } as Scenario['characters'],
      props: {
        p1: { id: 'p1', name: '照片', prompt: 'old photo' },
      } as Scenario['props'],
    })

    const cards = computeNodeCards(scene, scenario)
    // 出场角色 c1 同时播种一张「配音」音色卡（音色锚点能力）；
    // 每个 shot 播种一张「镜头卡」(video)，候选 tag 对齐编排出片。
    expect(cards.map((c) => c.kind)).toEqual(['scene', 'character', 'prop', 'video', 'audio'])

    // 镜头卡：绑定 shot、tag 对齐 reel:orch:<sceneId>:<shotId>、标题含镜号+景别
    const shotCard = cards.find((c) => c.kind === 'video')!
    expect(shotCard.id).toBe('shot:sh1')
    expect(shotCard.shotId).toBe('sh1')
    expect(shotCard.tag).toBe('reel:orch:s1:sh1')
    expect(shotCard.title).toBe('镜1 · 中景')
    expect(cardTag(shotCard)).toBe('reel:orch:s1:sh1')

    const audioCard = cards.find((c) => c.kind === 'audio')!
    expect(audioCard.speakerId).toBe('c1')
    expect(audioCard.title).toBe('配音 · 林叙')

    const charCard = cards.find((c) => c.kind === 'character')!
    expect(charCard.anchorId).toBe('c1')
    expect(charCard.title).toBe('角色 · 林叙')
    expect(charCard.defaultVariantId).toBe('v-suit')
    expect(charCard.variants).toHaveLength(1)

    // 不存在的 character id 被跳过
    expect(cards.filter((c) => c.kind === 'character')).toHaveLength(1)
  })
})

describe('composeCardPrompt', () => {
  it('叠加选中变体增量', () => {
    const variants = [{ id: 'v1', label: 'A', prompt: 'wounded' }]
    expect(composeCardPrompt('hero', variants, 'v1')).toBe('hero. wounded')
    expect(composeCardPrompt('hero', variants, undefined)).toBe('hero')
  })
})

describe('anchorRefMediaId / buildAnchorRefs', () => {
  const scenario = makeScenario({
    characters: {
      c1: {
        id: 'c1',
        name: '林叙',
        prompt: 'p',
        refImageId: 'm-c1',
        turnaroundRefImageId: 'm-c1-turn',
        appearanceVariants: [{ id: 'v-suit', label: '西装', prompt: 'suit', mediaId: 'm-c1-suit' }],
      },
    } as Scenario['characters'],
    locations: {
      l1: { id: 'l1', name: '咖啡店', prompt: 'p', refImageId: 'm-l1' },
    } as Scenario['locations'],
    props: {
      p1: {
        id: 'p1',
        name: '照片',
        prompt: 'p',
        refImageId: 'm-p1',
        variants: [{ id: 'vb', label: '撕碎', prompt: 'torn', mediaId: 'm-p1-torn' }],
      },
    } as Scenario['props'],
  })

  it('角色变体优先，回退三视图再回退主图', () => {
    expect(anchorRefMediaId(scenario, { kind: 'character', id: 'c1', variantId: 'v-suit' })).toBe(
      'm-c1-suit',
    )
    expect(anchorRefMediaId(scenario, { kind: 'character', id: 'c1' })).toBe('m-c1-turn')
  })
  it('道具变体优先', () => {
    expect(anchorRefMediaId(scenario, { kind: 'prop', id: 'p1', variantId: 'vb' })).toBe('m-p1-torn')
    expect(anchorRefMediaId(scenario, { kind: 'prop', id: 'p1' })).toBe('m-p1')
  })
  it('buildAnchorRefs 丢弃无 URL 的锚点并去重', () => {
    const lookup = (id: string) => (id === 'm-c1-turn' || id === 'm-l1' ? `/__reel__/assets/${id}` : undefined)
    const refs = buildAnchorRefs(
      scenario,
      [
        { kind: 'character', id: 'c1' },
        { kind: 'location', id: 'l1' },
        { kind: 'prop', id: 'p1' }, // m-p1 无 url → 丢弃
      ],
      lookup,
    )
    expect(refs.map((r) => r.role)).toEqual(['character', 'location'])
    expect(refs[0]?.dataUrl).toBe('/__reel__/assets/m-c1-turn')
  })
  it('buildSeededCardRefs 场景卡聚合 location+角色+道具', () => {
    const scene = makeScene({ locationId: 'l1', characterIds: ['c1'] })
    const lookup = (id: string) => `/__reel__/assets/${id}`
    const spec: CardSpec = { id: 'scene', kind: 'scene', title: '场景画面', basePrompt: '' }
    const refs = buildSeededCardRefs({ spec, scene, scenario, mediaLookup: lookup })
    expect(refs.some((r) => r.role === 'location')).toBe(true)
    expect(refs.some((r) => r.role === 'character')).toBe(true)
  })
})
