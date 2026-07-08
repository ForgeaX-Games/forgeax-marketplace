import type { Scene } from '../../scenario/types'

/**
 * 新场景工厂 —— 给 StoryGraph 工具栏的「+ 新场景」按钮用。
 *
 * 默认值：
 *   - kind: PLACEHOLDER（不联网，不消耗 token；作者再点 STAGE 上的"生成"才生图）
 *   - duration: 6s（编辑期常见的中位数；后续作者可在 Inspector 调）
 *   - title: "新场景 N" 的伪本地化默认；id 用 `sc-` 前缀 + 短随机
 *
 * 不在工厂里挂 branch / characters：那些是 store 层的 addScene(linkFrom) 业务。
 */

export interface MakeBlankSceneOptions {
  title?: string
  durationMs?: number
}

const DEFAULT_DURATION_MS = 6000

let counter = 0

export function makeBlankScene(options?: MakeBlankSceneOptions): Scene {
  counter += 1
  const id = makeSceneId()
  return {
    id,
    title: options?.title ?? `新场景 ${counter}`,
    media: { kind: 'PLACEHOLDER' },
    durationMs: options?.durationMs ?? DEFAULT_DURATION_MS,
    dialogue: [],
    branches: [],
  }
}

function makeSceneId(): string {
  const t = Date.now().toString(36).slice(-4)
  const r = Math.random().toString(36).slice(2, 8)
  return `sc-${t}${r}`
}
