/**
 * text-client —— 把 vendored wb-reel 生成内核依赖的 `TextClient` 契约，实现到本插件
 * 服务端的 `/__ce-api__` 网关（generation/gateway-client 的 genText）。
 *
 * 为什么需要它：`forgeCinematicVideoPrompt` 等 forge 函数签名是 `(llm: TextClient, ...)`。
 * wb-reel 浏览器侧注入的是 HostGatewayTextProvider；studio 服务端 headless 侧改注入
 * 本适配器，直连同机 litellm shim。契约完全一致，forge 层零改动。
 *
 * 只实现 `generate`（+ 元信息）：forge 走 `streamOrFallback`，未实现 generateStream
 * 时自动 fallback 到 `generate()` 并合成 open/text/done 事件，语义等价（见
 * llm/config/types.ts streamOrFallback）。
 */
import type { GatewayCtx } from '../generation/gateway-client'
import { genText } from '../generation/gateway-client'
import type { TextClient, TextRequest } from './llm/config/types'

/** 用 `/__ce-api__` 网关支撑一个 wb-reel `TextClient`。 */
export function createGatewayTextClient(
  ctx: GatewayCtx,
  meta: { model?: string; provider?: string } = {},
): TextClient {
  const model = meta.model ?? 'host-gateway'
  const provider = meta.provider ?? 'forgeax-ce-api'
  return {
    async generate(req: TextRequest): Promise<string> {
      return genText(ctx, {
        system: req.systemPrompt,
        user: req.userPrompt,
        images: (req.images ?? []).map((i) => ({ dataUrl: i.dataUrl })),
        jsonMode: req.jsonMode,
        maxTokens: req.maxTokens,
        temperature: req.temperature,
      })
    },
    async ping() {
      const t0 = Date.now()
      try {
        const sample = await genText(ctx, { user: 'ping', maxTokens: 4 })
        return { ok: true, latencyMs: Date.now() - t0, sample }
      } catch (e) {
        return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message }
      }
    },
    getModel: () => model,
    getProviderName: () => provider,
  }
}
