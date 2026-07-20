import type { Scenario } from './types'

/**
 * 锻造意图判定 —— 决定 adoptForgedScenario 该走 'replace-current' 还是 'create-new'。
 *
 * 用户的真实心智模型:
 *   - 我在「雨夜样板」/「空白新故事」上点 forge → 我是想新建一个独立的剧本,
 *     不要把样板/空白覆盖掉
 *   - 我在「我自己写到一半的剧本」上点 forge → 我是想让 AI 重写/优化它,
 *     保留我的 id 和已经生成的资产命名空间
 *
 * 这个工具就是把这个判定收敛在一个地方, 调用方 (ForgeChatPanel / IdeaForge / TopBar)
 * 不用重复推断。
 *
 * 历史 bug 上下文: v6.7 之前 adoptForgedScenario 无脑用 current.id, 导致
 * 用户在内置 demo 上 forge 出的新剧本会 "烙成" demo-001, 把雨夜样板从磁盘上挤掉,
 * 还让两个 scenario 在 .reel-assets/manifest.json 里共享同一个 scenarioId 命名空间,
 * 旧 intro 图会污染新剧本。
 */

const BUILTIN_DEMO_ID = 'demo-001'
const BUILTIN_DEMO_TITLE = '雨夜·门前'

/**
 * 是否就是我们内置的雨夜样板 demo (没被用户改过)。
 *
 * 判定: id + title 双匹配, 都对得上才算样板; 这样用户即使把 title 改了,
 * 我们仍然认为它已经被"占用", 走 replace-current 不会丢失用户改名意图。
 */
export function isBuiltinDemo(scenario: Scenario): boolean {
  return scenario.id === BUILTIN_DEMO_ID && scenario.title === BUILTIN_DEMO_TITLE
}

/**
 * 是否是 makeBlankScenario 出来的空白新故事 (用户还没 forge 过任何东西)。
 *
 * 判定标准:
 *   - 只有一个 scene (rootSceneId 指向它)
 *   - 那个 scene 没有对话 / 分支 / QTE
 *   - 没有任何角色 / 场所 / 道具
 *
 * 不靠 title 判定, 因为 makeBlankScenario 允许用户自定义 title。
 */
export function isPristineBlankScenario(scenario: Scenario): boolean {
  const sceneIds = Object.keys(scenario.scenes ?? {})
  if (sceneIds.length !== 1) return false
  const root = scenario.scenes[scenario.rootSceneId]
  if (!root) return false
  const noDialogue = (root.dialogue?.length ?? 0) === 0
  const noBranches = (root.branches?.length ?? 0) === 0
  const noQTE = !root.qte
  const noChars = Object.keys(scenario.characters ?? {}).length === 0
  const noLocs = Object.keys(scenario.locations ?? {}).length === 0
  return noDialogue && noBranches && noQTE && noChars && noLocs
}

/**
 * 推断 adoptForgedScenario 的 mode。
 *
 *   - current 是内置雨夜样板 → 'create-new' (避免覆盖样板)
 *   - current 是干净的空白新故事 → 'create-new' (用户刚点过"新建剧本",
 *     接下来的 forge 应该独立, 不复用占位 id)
 *   - 其他情况 (用户自己的工作中剧本) → 'replace-current'
 */
export function inferAdoptMode(
  current: Scenario,
): 'replace-current' | 'create-new' {
  if (isBuiltinDemo(current)) return 'create-new'
  if (isPristineBlankScenario(current)) return 'create-new'
  return 'replace-current'
}
