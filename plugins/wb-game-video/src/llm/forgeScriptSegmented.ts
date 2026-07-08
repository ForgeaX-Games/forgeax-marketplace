/**
 * forgeScenarioFromScriptSegmented —— 长剧本「分段读取」结构化入口
 *
 * 问题：整本长剧本（> chunkPlanner.CHUNK_THRESHOLD_CHARS = 8000 字）塞进单次
 * forgeScenarioFromScript 时，下游 LLM 要么输出 token 截断（[EMPTY]），要么
 * 长连接被网关/上游重置（ECONNRESET，典型 ~136s）。
 *
 * 方案：planChunks 把原文按语义（标题/空行/句号）切成若干 ≤5000 字的段，
 * **逐段**调 forgeScenarioFromScript（每段都是一次小而稳的结构化），最后用
 * mergeChunkScenarios 把多段拼回一本完整剧本。
 *
 * 与 forgeScenarioFromScript **同签名同返回**，可作 drop-in 替换：
 *   - 短剧本（chunked=false）→ 原样走单次路径，零额外开销、行为不变。
 *   - 长剧本 → 分段 + 合并，逐段失败降级（跳过并 warning），不整本崩。
 *
 * 取舍：**串行**逐段跑（不并发），避免多个大请求同时打爆同一上游触发限流 /
 * 连接重置 —— 本函数存在的全部意义就是「稳」，可靠性优先于墙钟时间。每段都有
 * 进度事件，作者能看到「解析第 N/M 段」。
 */

import type { TextClient } from './types'
import type { Scenario } from '../scenario/types'
import {
  forgeScenarioFromScript,
  type ForgeScriptArgs,
  type ForgeScenarioResult,
  type ForgeScenarioStreamOpts,
} from './promptForge'
import { planChunks } from '../io/chunkPlanner'
import { mergeChunkScenarios } from './mergeChunkScenarios'

function isAbort(e: unknown): boolean {
  const err = e as { name?: string; message?: string }
  return err?.name === 'AbortError' || /aborted/i.test(err?.message ?? '')
}

/** 网络层瞬断（连接重置 / 超时）—— 这类对单段值得重试一次。 */
function isTransientNetworkError(e: unknown): boolean {
  const m = (e as Error)?.message ?? ''
  return /ECONNRESET|连接被重置|ETIMEDOUT|超时|timeout|fetch failed|network\s*error/i.test(
    m,
  )
}

async function forgeChunkWithRetry(
  llm: TextClient,
  args: ForgeScriptArgs,
  opts: ForgeScenarioStreamOpts,
  retries = 1,
): Promise<ForgeScenarioResult> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await forgeScenarioFromScript(llm, args, opts)
    } catch (e) {
      lastErr = e
      if (isAbort(e) || opts.signal?.aborted) throw e
      if (attempt < retries && isTransientNetworkError(e)) {
        opts.onProgress?.({ kind: 'stage', label: '连接被重置，1.5s 后重试…' })
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
      throw e
    }
  }
  throw lastErr
}

export async function forgeScenarioFromScriptSegmented(
  llm: TextClient,
  args: ForgeScriptArgs,
  opts: ForgeScenarioStreamOpts = {},
): Promise<ForgeScenarioResult> {
  const script = args.script.trim()
  const plan = planChunks(script)

  // 短剧本：不分段，直接走原单次路径（行为与改造前完全一致）。
  if (!plan.chunked) {
    return forgeScenarioFromScript(llm, args, opts)
  }

  const chunks = plan.chunks
  opts.onProgress?.({
    kind: 'stage',
    label: '长剧本 · 分段解析',
    detail: `${plan.totalChars} 字 → ${chunks.length} 段（逐段读取，避免超长被截断）`,
  })

  const partials: Scenario[] = []
  const warnings: string[] = []
  let rawAll = ''

  for (let i = 0; i < chunks.length; i++) {
    if (opts.signal?.aborted) {
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }
    const ch = chunks[i]!
    const ctx =
      ch.headingPath.length > 0 ? `（${ch.headingPath.join(' / ')}）` : ''
    opts.onProgress?.({
      kind: 'stage',
      label: `解析第 ${i + 1}/${chunks.length} 段${ctx}`,
      detail: `${ch.charCount} 字`,
    })
    try {
      const res = await forgeChunkWithRetry(
        llm,
        { script: ch.text, hint: args.hint },
        opts,
        1,
      )
      partials.push(res.scenario)
      rawAll += `\n\n===== chunk ${i + 1}/${chunks.length} =====\n${res.raw}`
    } catch (e) {
      if (isAbort(e) || opts.signal?.aborted) throw e
      // 单段失败不毁全本：跳过并记 warning，继续下一段。
      warnings.push(
        `第 ${i + 1}/${chunks.length} 段解析失败已跳过：${(e as Error).message.slice(0, 140)}`,
      )
      opts.onProgress?.({
        kind: 'stage',
        label: `第 ${i + 1} 段失败，已跳过`,
        detail: (e as Error).message.slice(0, 80),
      })
    }
  }

  if (partials.length === 0) {
    throw new Error(
      `[SEGMENTED] 全部 ${chunks.length} 段都解析失败，无法生成剧本。\n` +
        warnings.join('\n'),
    )
  }

  opts.onProgress?.({
    kind: 'stage',
    label: '合并分段为完整剧本',
    detail: `${partials.length}/${chunks.length} 段成功`,
  })
  const scenario = mergeChunkScenarios(partials)
  opts.onProgress?.({ kind: 'stage', label: '构建剧情树' })

  return { scenario, raw: rawAll.trim(), warnings }
}
