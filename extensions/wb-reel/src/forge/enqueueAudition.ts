/**
 * enqueueAudition —— 把「角色试镜视频 + 音色」生成统一投进 generationQueue。
 *
 * 为什么要它（2026-06）：
 *   作者反馈「点了生成等很久、卡片上什么都没有、失败也看不到」。根因是试镜原本
 *   直接 `await generateCharacterAudition`，绕过了带状态/进度/失败/重试的统一队列，
 *   所以角色卡毫无反馈。这里把三个入口（详情「重新生成」/ 批量 / 智能体队列）
 *   全部改成入队：
 *     · cardKey = `audition:<characterId>` —— 角色卡用 useCardJob 订阅自己的实时状态
 *     · kind = 'video'                    —— 走视频并发池
 *     · run 内 onStage → 队列 job.stage   —— 卡片浮层显示「生成试镜视频 / 提取音色…」
 *     · 抛错 → job.failed + error         —— 卡片显示红字原因 + 重试
 *   完成后 broadcast scenario，让其它 pane 的角色网格立即看到新视频。
 */
import { useScenarioStore } from '../scenario/scenarioStore'
import { broadcastScenarioAdopt } from '../shell/crossPaneSync'
import {
  useGenerationQueue,
  cardJobOf,
  registerGenRecipe,
  type GenJobInput,
} from './generationQueueStore'
import { generateCharacterAudition } from './generateCharacterAudition'
import type { Character } from '../scenario/types'

/** 角色试镜卡片的稳定 cardKey。角色网格 / 详情面板用它订阅状态。 */
export function auditionCardKey(characterId: string): string {
  return `audition:${characterId}`
}

const AUDITION_RECIPE = 'audition'

interface AuditionRecipeArgs {
  characterId: string
  name?: string
  force?: boolean
}

/** 组装一段试镜生成的 GenJobInput（带 recipe，可被刷新接盘）。 */
function buildAuditionInput(
  character: Pick<Character, 'id' | 'name'>,
  opts?: { group?: string; force?: boolean },
): GenJobInput {
  const cardKey = auditionCardKey(character.id)
  return {
    kind: 'video',
    label: `试镜 · ${character.name || character.id}`,
    cardKey,
    group: opts?.group,
    recipe: {
      type: AUDITION_RECIPE,
      args: {
        characterId: character.id,
        name: character.name,
        force: opts?.force,
      } satisfies AuditionRecipeArgs,
    },
    run: async ({ onStage, setRequest }) => {
      // 始终读 store 里最新的角色对象（定妆照/字段可能已更新）。
      const fresh =
        useScenarioStore.getState().scenario.characters?.[character.id] ??
        (character as Character)
      const res = await generateCharacterAudition(fresh, { onStage, onRequest: setRequest })
      return res.auditionVideoMediaId
    },
    onDone: () => {
      // 让其它 pane（角色网格 / 详情）立即刷新到新试镜视频。
      broadcastScenarioAdopt(useScenarioStore.getState().scenario)
    },
  }
}

/**
 * 给单个角色入队一段试镜生成。返回 jobId（已在跑同名 cardKey 的活跃 job 时复用，
 * 不重复入队，避免重复点击/多入口并发生成同一角色）。
 */
export function enqueueAudition(
  character: Pick<Character, 'id' | 'name'>,
  opts?: { group?: string; force?: boolean },
): string {
  const cardKey = auditionCardKey(character.id)

  // 去重：同卡已有排队/进行中的 job 就复用，不再入队。
  const existing = cardJobOf(cardKey)
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    return existing.id
  }

  return useGenerationQueue.getState().enqueue(buildAuditionInput(character, opts))
}

// 刷新/重开接盘：按 characterId 重建。已有试镜视频且未强制重生 → 跳过（幂等）。
registerGenRecipe(AUDITION_RECIPE, (raw) => {
  const args = raw as AuditionRecipeArgs | null
  if (!args || typeof args.characterId !== 'string') return null
  const ch = useScenarioStore.getState().scenario.characters?.[args.characterId]
  if (!ch) return null
  if (ch.auditionVideoMediaId && !args.force) return null
  return buildAuditionInput({ id: ch.id, name: ch.name }, { force: args.force })
})

/** 批量入队多个角色（每个独立 cardKey，独立状态/重试）。返回入队的 jobId 列表。 */
export function enqueueAuditions(
  characters: Pick<Character, 'id' | 'name'>[],
  opts?: { group?: string },
): string[] {
  return characters.map((c) => enqueueAudition(c, opts))
}
