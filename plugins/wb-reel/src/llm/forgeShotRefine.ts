/**
 * forgeShotRefine —— 单镜 LLM 修改流水线
 *
 * 工作流：
 *   1. 拼装上下文（前/当/后镜 prompt + scene.background + 出场角色）
 *   2. 调已有 forgeImagePrompt（cinema-image-prompt skill）重写 shot.prompt
 *   3. 用新 prompt + 角色参考图（若有）重新调 imgClient.generate()
 *   4. 结果通过回调返给调用方写回 store
 *
 * 此模块**纯逻辑**，不读 store，不操作 DOM，便于单测。
 */

import type { Scene, Shot, Character } from '../scenario/types'
import type { TextClient, ImageClient, ImageResult } from './types'
import { forgeImagePrompt } from './promptForge'

export interface ForgeShotRefineArgs {
  /** 当前场景（background + prompts.scene + characterIds 均需要） */
  scene: Scene
  /** 当前正在修改的镜头 */
  currentShot: Shot
  /** 上一镜（提供叙事连贯性上下文，可选） */
  prevShot?: Shot
  /** 下一镜（提供转场方向上下文，可选） */
  nextShot?: Shot
  /** 出场角色完整信息（从 scenario.characters 里根据 characterIds 提取） */
  characters: Character[]
  /** 用户输入的修改意图，例如"让她靠近镜头，表情更紧张" */
  userIntent: string
}

export interface ForgeShotRefineResult {
  /** LLM 重写后的新 shot.prompt */
  newPrompt: string
  /** 重新生成的关键帧图片 */
  imageResult: ImageResult
}

/**
 * 把前/当/后镜上下文组装成 `forgeImagePrompt` 的 `storyContext` 字符串。
 */
function buildShotRefineContext(args: ForgeShotRefineArgs): string {
  const lines: string[] = []

  if (args.scene.background?.trim()) {
    lines.push(`【场景舞美】${args.scene.background.trim()}`)
  }

  if (args.scene.prompts?.scene?.trim()) {
    lines.push(`【场景整体画面基调】${args.scene.prompts.scene.trim()}`)
  }

  if (args.prevShot?.prompt?.trim()) {
    lines.push(`【上一镜 (${args.prevShot.framing})】${args.prevShot.prompt.trim()}`)
  }

  lines.push(
    `【当前镜 (${args.currentShot.framing}) · 待修改】${args.currentShot.prompt?.trim() || '（暂无描述）'}`,
  )

  if (args.currentShot.cameraHint?.trim()) {
    lines.push(`　机位：${args.currentShot.cameraHint.trim()}`)
  }

  if (args.nextShot?.prompt?.trim()) {
    lines.push(`【下一镜 (${args.nextShot.framing})】${args.nextShot.prompt.trim()}`)
  }

  lines.push(`\n【作者修改意图】${args.userIntent.trim()}`)
  lines.push('请在保持前后镜叙事连贯的前提下，按照修改意图重写当前镜的画面描述（80-150 字）。')

  return lines.join('\n')
}

/**
 * 执行单镜 LLM 修改：
 *   1. 调 forgeImagePrompt 重写 prompt
 *   2. 用新 prompt 重新生图
 */
export async function forgeShotRefine(
  llm: TextClient,
  imgClient: ImageClient,
  args: ForgeShotRefineArgs,
): Promise<ForgeShotRefineResult> {
  const storyContext = buildShotRefineContext(args)
  const characterRefs = args.characters.map((c) => ({
    name: c.name,
    prompt: c.prompt,
  }))

  // Step 1：LLM 重写 prompt
  const forged = await forgeImagePrompt(llm, {
    intent: args.userIntent,
    storyContext,
    characters: characterRefs.length > 0 ? characterRefs : undefined,
  })

  // Step 2：用新 prompt 重新生图（参考图暂不注入 —— 调用方如需 reference 可扩展此函数）
  const imageResult = await imgClient.generate({
    prompt: forged.prompt,
    size: '1536x1024',
  })

  return {
    newPrompt: forged.prompt,
    imageResult,
  }
}
