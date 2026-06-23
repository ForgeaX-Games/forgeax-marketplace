import type { Episode, Scenario } from './types'
import { DEFAULT_EPISODE_ID } from './schemaMigrate'

/**
 * 空白剧本工厂 —— 作者点顶栏 ➕「新的故事」时用。
 *
 * 和 demoScenario 的区别：
 *   - 没有预置角色、场所、对话、QTE、分支
 *   - 只有一个占位 scene（rootSceneId 指向它），让 StagePane / StoryTree
 *     都能正常渲染（如果 scenes 为空，rootSceneId 会指向未定义场景，会崩）
 *   - id 基于时间戳生成，避免和 demo / 历史条目撞 id
 *   - schemaVersion = 7（最新），避免首次加载就走迁移
 *
 * 为什么不复用 getDemoScenario().scenes + 清空？
 *   demo 是"想把第一印象做得漂亮"的样例；新故事是"一张白纸"。语义不同，
 *   独立的工厂函数让两边都能安心演进，互不影响。
 */

export interface MakeBlankOpts {
  /** 作者可在对话框里填自定义标题，不传则默认 */
  title?: string
  /** 测试注入固定时间戳；生产走 Date.now() */
  now?: number
}

const DEFAULT_TITLE = '新的故事'

export function makeBlankScenario(opts: MakeBlankOpts = {}): Scenario {
  const now = opts.now ?? Date.now()
  // 后缀防止同一毫秒连点两次"新建剧本"撞 id 把前一个空白挤掉。
  // 测试如果传了固定 now (mock 时钟), 就跳过随机, 保证可重现。
  const suffix = opts.now == null ? `-${Math.random().toString(36).slice(2, 6)}` : ''
  const id = `scn-${now}${suffix}`
  const rootSceneId = 'scene-1'

  const defaultEpisode: Episode = {
    id: DEFAULT_EPISODE_ID,
    title: '第一集',
    rootSceneId,
    order: 0,
    createdAt: now,
  }

  return {
    id,
    title: opts.title ?? DEFAULT_TITLE,
    rootSceneId,
    defaultCharMs: 32,
    schemaVersion: 8,
    variables: {},
    items: {},
    characters: {},
    locations: {},
    episodes: [defaultEpisode],
    outline: [],
    characterRelations: [],
    scenes: {
      [rootSceneId]: {
        id: rootSceneId,
        title: '01 · 开始',
        media: {
          kind: 'IMAGE_PROMPT',
          prompt: '',
          meta: {},
        },
        durationMs: 50000,
        pos: { x: 80, y: 200 },
        dialogue: [],
        branches: [],
        episodeId: DEFAULT_EPISODE_ID,
      },
    },
  }
}
