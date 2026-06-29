import type {
  ImageClient,
  ImageRequest,
  ImageResult,
  ImageReference,
} from './types'
import {
  computeBackoffMs,
  shouldRetryError,
  shouldRetryHttp,
} from './retryPolicy'
import { imageRateLimiter } from './imageRateLimiter'
import { HostGatewayImageProvider, shouldUseHostImageGateway } from './HostGatewayImageProvider'

/**
 * Azure OpenAI Image · gpt-image-2
 *
 * 端点（Azure 部署模式）：
 *   POST `<api_base>/openai/deployments/<deployment>/images/generations?api-version=<v>`
 * 认证：`api-key: <key>` header
 *
 * 请求 body：
 * ```
 * {
 *   prompt: "...",
 *   size: "1024x1024",
 *   n: 1,
 *   response_format: "b64_json"   // gpt-image-2 默认就走 b64
 * }
 * ```
 *
 * 响应：
 * ```
 * {
 *   data: [ { b64_json: "..." } ],
 *   created: 17xxxxx
 * }
 * ```
 *
 * 注意：
 *   - 实际 deployment 名以 Azure 后台为准；llm_key.json 没显式写，所以用 model 名兜底
 *   - 若 404 / DeploymentNotFound：把 vite define 中 __RS_IMG_DEPLOYMENT__ 换成实际部署名
 */

interface GptImageConfig {
  apiKey: string
  apiBase: string
  apiVersion: string
  /**
   * v3.8 · /images/edits 专用 api-version（preview 通道）。
   * 缺失时回落到 apiVersion（GA 版本通常不包含 edits 端点，会 404）。
   */
  editApiVersion?: string
  deployment: string
}

interface ImageGenResp {
  data?: { b64_json?: string; url?: string }[]
  error?: { code?: string; message?: string }
}

export class GptImageProvider implements ImageClient {
  private readonly apiKey: string
  private readonly apiBase: string
  private readonly apiVersion: string
  private readonly editApiVersion: string
  private readonly deployment: string

  constructor(cfg: GptImageConfig) {
    if (!cfg.apiKey) throw new Error('GptImageProvider: missing apiKey')
    if (!cfg.apiBase) throw new Error('GptImageProvider: missing apiBase')
    this.apiKey = cfg.apiKey
    this.apiBase = cfg.apiBase.replace(/\/$/, '')
    this.apiVersion = cfg.apiVersion
    // editApiVersion 缺失时回落 apiVersion —— 多半会 404，但至少不会抛
    this.editApiVersion = cfg.editApiVersion || cfg.apiVersion
    this.deployment = cfg.deployment
  }

  getModel(): string {
    return this.deployment
  }
  getProviderName(): string {
    return 'AzureOpenAI'
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    // v3.8 · 双通道 dispatcher：
    //   - 有参考图 → 走 /images/edits（multipart），真的把参考图数据发给模型
    //   - 没参考图 → 走 /images/generations（纯文本生图）
    // 参考图来源合并：
    //   - 旧字段 referenceImageDataUrl 视为 referenceImages[0] 的兼容路径
    //   - 新字段 referenceImages 按调用方传入的顺序保持
    const refs: ImageReference[] = []
    if (req.referenceImages) {
      for (const r of req.referenceImages) {
        if (r?.dataUrl) refs.push(r)
      }
    }
    if (req.referenceImageDataUrl && refs.length === 0) {
      refs.push({ dataUrl: req.referenceImageDataUrl })
    }
    if (refs.length > 0) {
      return this.generateEdit(req, refs)
    }
    return this.generateText(req)
  }

  /**
   * 纯文生图路径 —— /openai/deployments/<dep>/images/generations
   * body: application/json，字段 prompt/n/size/quality
   */
  private async generateText(req: ImageRequest): Promise<ImageResult> {
    const url =
      `${this.apiBase}/openai/deployments/${this.deployment}/images/generations` +
      `?api-version=${encodeURIComponent(this.apiVersion)}`

    // gpt-image-2 与 dall-e-3 的差异：
    //   - dall-e-3 接受 response_format；gpt-image-2 不接受（传了 400）
    //   - gpt-image-2 必须带 quality（'low'|'medium'|'high'），不传服务端静默挂死
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      n: req.n ?? 1,
      size: req.size ?? '1024x1024',
      quality: 'medium',
    }

    return this.postWithRetry(
      url,
      {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'api-key': this.apiKey,
      },
      JSON.stringify(body),
      req.prompt,
    )
  }

  /**
   * 图生图路径 —— /openai/deployments/<dep>/images/edits
   * body: multipart/form-data
   * 字段：prompt, model, size, n, quality, image[] (最多 16 张)
   *
   * Azure gpt-image-2 支持多图组合（最多 16 张 reference image）。
   * 我们用 FormData 构造，Content-Type 由 fetch 自动生成 boundary。
   */
  private async generateEdit(
    req: ImageRequest,
    refs: ImageReference[],
  ): Promise<ImageResult> {
    const url =
      `${this.apiBase}/openai/deployments/${this.deployment}/images/edits` +
      `?api-version=${encodeURIComponent(this.editApiVersion)}`

    const form = new FormData()
    form.append('prompt', req.prompt)
    form.append('model', 'gpt-image-2')
    form.append('n', String(req.n ?? 1))
    form.append('size', req.size ?? '1024x1024')
    form.append('quality', 'medium')

    const MAX_REFS = 16
    const effective = refs.slice(0, MAX_REFS)
    for (let i = 0; i < effective.length; i++) {
      const r = effective[i]!
      const blob = await dataUrlOrUrlToBlob(r.dataUrl)
      // 文件名影响 multipart boundary 标识，随便但要唯一 + 符合 png 扩展
      form.append('image[]', blob, `ref-${i}-${r.role ?? 'any'}.png`)
    }

    return this.postWithRetry(
      url,
      {
        // 注意：不要显式设 Content-Type，让 fetch 自动写 multipart boundary
        Authorization: `Bearer ${this.apiKey}`,
        'api-key': this.apiKey,
      },
      form,
      req.prompt,
    )
  }

  /**
   * POST + 指数退避重试的通用封装 —— 两个端点共用。
   *
   * 重试策略：
   *   - 429 (EngineOverloaded) / 5xx / 网络错 → 指数退避后再试
   *   - 封顶 5 次（首次 + 4 次重试）；Retry-After 头优先（429 通常带）
   *   - **内容审核拦截（moderation_blocked / safety_violations / content_policy_violation）
   *     不重试** —— 重试多少次 prompt 都会继续被拦，直接抛一条明确错误让作者改 prompt
   *   - **所有 POST 共享全局 imageRateLimiter** —— 削峰 + 429 冷却，防止 BatchGen
   *     / Timeline / Forge 三路人撞车把单个 deployment 打爆
   */
  private async postWithRetry(
    url: string,
    headers: Record<string, string>,
    body: string | FormData,
    promptForReturn: string,
  ): Promise<ImageResult> {
    // 从 5 提到 7：Azure S0 tier 对 gpt-image-2 的 RPM 很紧（典型 6 RPM），
    // 连 3 张批量就会连撞 429；给更多次数 + 更长退避 = 作者体感"稍等就出图"，
    // 而不是"红色错误 + 重新点一遍"。7 次 × 最坏 ~25s = 上限 ~3min，可接受。
    const MAX_ATTEMPTS = 7
    const t0 = performance.now()
    let resp: Response | null = null
    let raw = ''
    let lastErr: unknown
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // 全局令牌桶：拿到位置才 fetch，出函数必 release
      const release = await imageRateLimiter.acquire()
      try {
        resp = await fetch(url, { method: 'POST', headers, body })
        raw = await resp.text()
      } catch (e) {
        release()
        lastErr = e
        if (e instanceof Error && e.message.startsWith('[HTTP ')) throw e
        if (!shouldRetryError(e) || attempt === MAX_ATTEMPTS - 1) {
          throw new Error(`[NET] image fetch failed: ${(e as Error).message}`)
        }
        const wait = computeBackoffMs(attempt)
        console.warn(
          `[GptImageProvider] network err: ${(e as Error).message} · ` +
            `attempt ${attempt + 1}/${MAX_ATTEMPTS}, wait ${wait}ms then retry`,
        )
        await sleep(wait)
        continue
      }
      release()

      if (resp.ok) break

      // 识别"内容审核拦截" —— 这类错误重试不会变好，必须第一时间抛给用户改 prompt
      //
      // v6.1（2026-05-11）· 作者友好化错误消息：
      //   之前错误里塞了一大坨 Azure 原始 JSON（含 request ID），对作者毫无信息
      //   量——他们看不懂 moderation_blocked + request ID 到底该改哪儿。现在改成：
      //     · message 只说"被安全系统拦截，建议修改哪类描述"
      //     · 附上被拦 prompt 的前 500 字符，让作者直接看到嫌疑段
      //     · 完整 JSON 仍 console.error，开发者调试时能看到
      //     · prompt 完整原文通过 Error 上的 prompt 字段暴露，UI 可做"展开查看"
      //
      // v6.2（2026-05-11）· preview 智能化：
      //   Forge/Batch 拼出的最终 prompt 前面通常是固定的"视觉风格模板"（比如
      //   "Japanese anime illustration, clean cel shading, ..." × 数百字），
      //   真正触发 moderation 的几乎永远是后面作者填的 character/location/prop
      //   描述。简单 slice(0, 180) 会把整个 preview 全被视觉模板吃掉，作者看不
      //   到嫌疑段。extractAuthorPromptSlice 会跳过已知模板前缀，直接截到
      //   "Description:/Details:/This shot shows:/角色外观/…" 这些作者输入开始
      //   的位置，给 500 字预览——既保住了关键信息，又不至于把完整 prompt 全塞
      //   进消息（UI 仍有"展开查看"可看全文）。
      // v6.3（2026-05-11）· 误判场景的"风格联合评估"提示：
      //   实际生产中遇到：作者切换 visualStyle（photoreal → anime）后批量重跑
      //   Forge 参考图，很多 location/prop 被拦了。但把 preview 完整展开后能
      //   看到 "Empty location reference ... Description: 普通现代场景 ... no
      //   people, no text." 这种完全无害的内容。真正原因是 Azure 对 prompt 做
      //   **整体评估**，"Japanese anime illustration" 前缀 + 作者原为写实风格
      //   而写的描述，组合起来会命中"卡通化真人 / 未成年化"等误判。
      //
      //   当 preview 把完整 prompt 都展示了（长度 < 阈值、不需要省略），基本可以
      //   判定"单段敏感词"不是根因，建议作者优先考虑：换风格重写描述 / 换回原风
      //   格 / 简化描述。两种情境走不同建议文案，让消息真的"可行动"。
      if (isModerationBlocked(resp.status, raw)) {
        const promptPreview = extractAuthorPromptSlice(promptForReturn, 500)
        console.error(
          `[GptImageProvider] 内容审核拦截（不重试） · HTTP ${resp.status}`,
          { promptPreview, azureResponse: raw },
        )
        // 启发式：preview 不含省略号且长度 < 600，说明完整 prompt 都能看到，
        //   很可能是风格+描述的整体评估触发的，不是某段敏感词。
        const likelyStyleInteraction =
          !promptPreview.includes('…') && promptPreview.length < 600
        const advice = likelyStyleInteraction
          ? `\n\n看起来 prompt 内容并无明显敏感词——很可能是当前视觉风格与描述的组合` +
            `触发了 Azure 的整体评估（常见于切换风格后）。建议：\n` +
            `  1) 让 LLM 按当前视觉风格重写 character/location/prop 的描述字段；\n` +
            `  2) 或换回之前能过审的视觉风格；\n` +
            `  3) 或把描述改得更简洁、减少可能被误判的细节（伤口/紧身/写实肖像等）。`
          : `\n\n请修改上方片段里的措辞后重试。常见触发：暴力/血腥、性暗示、` +
            `真人政治人物、未成年人相关、知名商业 IP。`
        const err = new Error(
          `[MODERATION] 被 Azure 安全系统拦截。\n\n触发的 prompt 片段：\n` +
            `「${promptPreview}」${advice}`,
        )
        // 结构化上下文：调用方（ForgeWizard / BatchGenBar）可读出 prompt 全文展示给作者
        Object.assign(err, {
          kind: 'moderation_blocked' as const,
          prompt: promptForReturn,
          azureRequestId: extractAzureRequestId(raw),
          // UI 可根据此 hint 决定要不要高亮"风格建议"而非"措辞建议"
          likelyStyleInteraction,
        })
        throw err
      }

      if (!shouldRetryHttp(resp.status) || attempt === MAX_ATTEMPTS - 1) {
        // 400/413 等业务错误：把完整 response body 单独打一行 error log
        // 方便作者从 DevTools Console 直接看到服务端真实错误信息
        console.error(
          `[GptImageProvider] HTTP ${resp.status} ${resp.statusText} · response body:`,
          raw,
        )
        throw new Error(
          `[HTTP ${resp.status}] ${resp.statusText} · ${raw.slice(0, 240)}` +
            (attempt > 0 ? ` · attempt=${attempt + 1}/${MAX_ATTEMPTS}` : ''),
        )
      }

      // 429 命中：通知全局限流器进入冷却期，所有正在队列里的任务一起等
      //
      // v6（2026-05-11）· Azure AOAI 的 Retry-After **经常不给 header**，但会把
      //   "Please retry after 16 seconds"
      // 写进 response body（见 parseRetryAfterFromBody 注释）。我们两路都看，取
      // 更大的那个作为等待下限，保证"宁多等一秒、不空转白撞"。
      const retryAfterHeaderMs = parseRetryAfter(resp.headers.get('retry-after'))
      const retryAfterBodyMs = parseRetryAfterFromBody(raw)
      const retryAfterMs =
        retryAfterHeaderMs && retryAfterBodyMs
          ? Math.max(retryAfterHeaderMs, retryAfterBodyMs)
          : (retryAfterHeaderMs ?? retryAfterBodyMs)
      if (resp.status === 429) {
        imageRateLimiter.noteRateLimitHit(retryAfterMs)
      }
      // 退避时长：
      //   - 若服务端给了时长（header 或 body） → 用它 + 500ms 缓冲（避免擦边
      //     又撞）+ 10-25% jitter（防惊群）；
      //   - 否则对 429 单独抬高下限：首次 ≥ 2s，随 attempt 递增，封顶 20s。
      let wait = computeBackoffMs(attempt, resp.headers.get('retry-after'))
      if (resp.status === 429) {
        if (retryAfterMs) {
          const jitter = Math.round(retryAfterMs * (0.1 + Math.random() * 0.15))
          wait = retryAfterMs + 500 + jitter
        } else {
          const floor = Math.min(20_000, 2000 * 2 ** attempt)
          wait = Math.max(wait, floor)
        }
      }
      console.warn(
        `[GptImageProvider] HTTP ${resp.status} ${resp.statusText} · ` +
          `attempt ${attempt + 1}/${MAX_ATTEMPTS}, wait ${wait}ms then retry` +
          (retryAfterBodyMs && !retryAfterHeaderMs
            ? ` (body said ${Math.round(retryAfterBodyMs / 1000)}s)`
            : ''),
      )
      await sleep(wait)
    }
    if (!resp) {
      throw new Error(
        `[RETRY] all ${MAX_ATTEMPTS} attempts failed: ${(lastErr as Error)?.message ?? 'unknown'}`,
      )
    }
    const latencyMs = Math.round(performance.now() - t0)
    let data: ImageGenResp
    try {
      data = JSON.parse(raw) as ImageGenResp
    } catch {
      throw new Error(`[PARSE] non-JSON · head=${raw.slice(0, 200)}`)
    }
    if (data.error) {
      throw new Error(
        `[API ${data.error.code ?? '?'}] ${data.error.message ?? raw.slice(0, 200)}`,
      )
    }
    const item = data.data?.[0]
    if (!item) {
      throw new Error(`[EMPTY] no data in response · head=${raw.slice(0, 200)}`)
    }

    if (item.b64_json) {
      return {
        base64: item.b64_json,
        mimeType: 'image/png',
        dataUrl: `data:image/png;base64,${item.b64_json}`,
        prompt: promptForReturn,
        latencyMs,
      }
    }
    if (item.url) {
      const fetched = await fetch(item.url)
      const blob = await fetched.blob()
      const buf = await blob.arrayBuffer()
      const b64 = bufferToBase64(buf)
      return {
        base64: b64,
        mimeType: blob.type || 'image/png',
        dataUrl: `data:${blob.type || 'image/png'};base64,${b64}`,
        prompt: promptForReturn,
        latencyMs,
      }
    }
    throw new Error('[EMPTY] response item has neither b64_json nor url')
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const t0 = performance.now()
    try {
      await this.generate({
        prompt: '一个白色立方体置于纯黑背景，体积感，极简，工作室灯光',
        size: '1024x1024',
      })
      return { ok: true, latencyMs: Math.round(performance.now() - t0) }
    } catch (e) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        error: (e as Error).message,
      }
    }
  }
}

/** 离线占位 —— 用 Canvas 画一个带 prompt 文字的渐变图，便于编辑器里实时预览。 */
export class MockImageProvider implements ImageClient {
  getModel(): string {
    return 'mock-image'
  }
  getProviderName(): string {
    return 'Mock'
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const t0 = performance.now()
    const dataUrl = await renderPlaceholder(req.prompt)
    const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
    return {
      dataUrl,
      base64,
      mimeType: 'image/png',
      prompt: req.prompt,
      latencyMs: Math.round(performance.now() - t0),
    }
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number }> {
    return { ok: true, latencyMs: 0 }
  }
}

async function renderPlaceholder(prompt: string): Promise<string> {
  const w = 1024
  const h = 576
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, w, h)
  grad.addColorStop(0, '#0a1929')
  grad.addColorStop(0.5, '#1a2942')
  grad.addColorStop(1, '#2d1b4e')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  for (let i = 0; i < 80; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1)
  }

  ctx.fillStyle = 'rgba(255, 220, 180, 0.85)'
  ctx.font = '500 22px "Inter", sans-serif'
  ctx.fillText('● MOCK · 占位画面', 36, 56)

  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.font = '300 20px "Noto Serif SC", serif'
  const lines = wrap(ctx, prompt, w - 96)
  let y = 130
  for (const ln of lines.slice(0, 12)) {
    ctx.fillText(ln, 48, y)
    y += 32
  }

  ctx.strokeStyle = 'rgba(255, 109, 44, 0.7)'
  ctx.lineWidth = 2
  ctx.strokeRect(8, 8, w - 16, h - 16)

  return c.toDataURL('image/png')
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = []
  let line = ''
  for (const ch of text) {
    const test = line + ch
    if (ctx.measureText(test).width > maxW) {
      if (line) out.push(line)
      line = ch
    } else {
      line = test
    }
  }
  if (line) out.push(line)
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 识别 Azure OpenAI 的"内容审核拦截"错误。
 *
 * Azure 在以下几种情况会返回 400 + 结构化 error：
 *   - {"error":{"code":"moderation_blocked", "message":"...", "type":"image_generation_user_error"}}
 *   - 对 prompt 里的人名/场景触发 sexual / violence / hate / self_harm 等 safety filter
 *     → `safety_violations=[sexual]` 片段会出现在 message 里
 *   - 较早资源返回 `content_policy_violation`
 *
 * 这些错误**重试多少次都不会变好**，必须一次性 bubble 给上层让作者改 prompt。
 */
export function isModerationBlocked(status: number, body: string): boolean {
  if (status !== 400) return false
  const lower = body.toLowerCase()
  return (
    lower.includes('moderation_blocked') ||
    lower.includes('content_policy_violation') ||
    lower.includes('safety_violations') ||
    lower.includes('safety system') ||
    lower.includes('image_generation_user_error')
  )
}

/**
 * 从 Azure 拦截响应 body 里挑出 request ID，供作者走 support ticket 时引用。
 *
 * 典型消息片段：
 *   "contact us at Azure support ticket and include the request ID 8170f6bd-...-..."
 *
 * 挑不到返回 undefined —— 调用方绝不该把它当强契约用。
 */
export function extractAzureRequestId(body: string): string | undefined {
  // UUID v4 形状；Azure 文本模板固定是"include the request ID <uuid>"
  const m = body.match(/request\s*id[^0-9a-f]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
  return m?.[1]
}

/**
 * 从"Forge/Batch 最终 prompt"里挑出作者原写内容的片段用于错误 preview。
 *
 * 为什么要挑：
 *   Forge/Batch pipeline 拼出来的 prompt 通常形如：
 *     "Japanese anime illustration, clean cel shading, ...（visualStyle 模板，~200 字）
 *      —— Location: XX. Description: <作者原写 200 字>. ..."
 *   moderation 几乎永远是作者原写那部分触发的，但简单 `slice(0, 180)` 会把整个
 *   preview 全让给前缀模板，作者看不到嫌疑段。
 *
 * 策略：
 *   1. 寻找已知锚点关键词（大小写不敏感）：Description / Details / This shot shows /
 *      Characters present / Prop name / Scene action / 外观 / 描述…
 *   2. 找到最早的那个，从它开始截 maxLen 字符
 *   3. 一个都没找到 → 退回"裸截前 maxLen 字符"的兜底
 *   4. 如果命中点不是 0，preview 头加 "…" 暗示前面还有被跳过的内容
 *
 * 锚点故意写得宽泛 —— 不同语言模型/不同调用点的模板会有细微差异，宁可多命中
 * 也不要漏掉（漏掉的后果只是回退到 slice，不影响正确性）。
 */
export function extractAuthorPromptSlice(prompt: string, maxLen = 500): string {
  if (prompt.length <= maxLen) return prompt
  const anchors = [
    'Description:',
    'Details:',
    'This shot shows:',
    'Scene action',
    'Characters present',
    'Prop name:',
    'Location:',
    '外观',
    '描述：',
    '描述:',
  ]
  const lower = prompt.toLowerCase()
  let earliest = -1
  for (const a of anchors) {
    const idx = lower.indexOf(a.toLowerCase())
    if (idx >= 0 && (earliest < 0 || idx < earliest)) {
      earliest = idx
    }
  }
  if (earliest < 0) {
    // 没锚点，老老实实截前 maxLen
    return `${prompt.slice(0, maxLen)}…`
  }
  const tail = prompt.slice(earliest, earliest + maxLen)
  const prefix = earliest > 0 ? '…' : ''
  const suffix = earliest + maxLen < prompt.length ? '…' : ''
  return `${prefix}${tail}${suffix}`
}

/**
 * 内容审核拦截错误的"结构化上下文"。
 *
 * 每个被 Azure safety system 挡下的调用，Provider 会在抛出的 Error 上 Object.assign
 * 这三字段（kind/prompt/azureRequestId）。UI 层可用 `getModerationContext(err)`
 * 把它挑出来展示给作者（比如加"查看完整 prompt"按钮）。
 *
 * 故意不 subclass Error —— 走 duck typing 能穿过 structuredClone / 旧代码不改。
 */
export interface ModerationErrorContext {
  kind: 'moderation_blocked'
  prompt: string
  azureRequestId?: string
  /**
   * 启发式提示：当 preview 能把整段 prompt 都展示时（长度够短、不含省略号），
   * 很可能触发是"视觉风格 + 描述"的整体评估，而非某段敏感词。UI 可据此高亮
   * "换风格重写"建议而非"改措辞"建议。
   */
  likelyStyleInteraction?: boolean
}

/**
 * 从 Error 里读出 ModerationErrorContext；非 moderation 错误返回 undefined。
 *
 * 用法（ForgeWizard / BatchGenBar）：
 * ```
 *   const ctx = getModerationContext(failure.error)
 *   if (ctx) { showPromptDetailButton(ctx.prompt) }
 * ```
 */
export function getModerationContext(
  err: unknown,
): ModerationErrorContext | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as {
    kind?: unknown
    prompt?: unknown
    azureRequestId?: unknown
    likelyStyleInteraction?: unknown
  }
  if (e.kind !== 'moderation_blocked') return undefined
  if (typeof e.prompt !== 'string') return undefined
  return {
    kind: 'moderation_blocked',
    prompt: e.prompt,
    azureRequestId: typeof e.azureRequestId === 'string' ? e.azureRequestId : undefined,
    likelyStyleInteraction:
      typeof e.likelyStyleInteraction === 'boolean' ? e.likelyStyleInteraction : undefined,
  }
}

/**
 * 解析 Retry-After 头成毫秒（供 imageRateLimiter 冷却用）。
 * Retry-After 可以是"秒数"或 HTTP-date，两种都兼容。
 */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined
  const seconds = parseFloat(header)
  if (Number.isFinite(seconds) && seconds > 0) return Math.round(seconds * 1000)
  const date = Date.parse(header)
  if (Number.isFinite(date) && date > Date.now()) return date - Date.now()
  return undefined
}

/**
 * 从 HTTP 响应正文里提取 Azure OpenAI 的"请 X 秒后重试"字样。
 *
 * 背景（真实 bug · 2026-05-11）：作者连撞 429，Azure 的 response body 明明写了：
 *   "Please retry after 16 seconds."
 * 但**没有**给标准的 `Retry-After` 头。我们原本只看 header，fallback 走指数退避，
 * 最长才 15s，偶尔就比 Azure 要求的 16s 少一点点，第 5 次重试又撞回来，最终抛 UI。
 *
 * 这里把 body 里的秒数也抽出来，和 header 一起 max，确保我们给的等待时间
 * **至少**是 Azure 明示的时长，不做人为二次贪心。
 *
 * 匹配模式（大小写不敏感，容忍"s"/"sec"/"seconds"）：
 *   - "retry after 16 seconds"   ← Azure OpenAI 官方文案
 *   - "retry after 16s"
 *   - "Please retry in 5 seconds"（部分 AOAI 区域的变体）
 *   - "please try again in 10 seconds"
 *
 * 未命中返回 undefined；命中返回毫秒。
 */
export function parseRetryAfterFromBody(body: string): number | undefined {
  if (!body) return undefined
  // 先走 JSON 路径：不少 SDK 把 retry_after_seconds 放结构化字段里
  try {
    const j = JSON.parse(body) as { error?: { retry_after_ms?: number; retry_after?: number } }
    const ms = j?.error?.retry_after_ms
    if (typeof ms === 'number' && ms > 0 && Number.isFinite(ms)) {
      return Math.round(ms)
    }
    const s = j?.error?.retry_after
    if (typeof s === 'number' && s > 0 && Number.isFinite(s)) {
      return Math.round(s * 1000)
    }
  } catch {
    // body 不是 JSON 也无所谓，走文本匹配
  }
  // 文本兜底：Azure 实际走这条
  const re = /(?:retry\s+after|retry\s+in|try\s+again\s+in)\s+(\d+(?:\.\d+)?)\s*(s\b|sec(?:ond)?s?\b)/i
  const m = re.exec(body)
  if (m && m[1]) {
    const sec = parseFloat(m[1])
    if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000)
  }
  return undefined
}

/**
 * 把 data URL 或普通 URL 转成 Blob。
 *
 * 支持的输入：
 *   - `data:image/png;base64,...`（离线生成的图）
 *   - `/__reel__/assets/<id>`（服务端磁盘资产）
 *   - `blob:...`（浏览器内存对象 URL）
 *   - 任何 http(s):// 同源/跨域 URL（只要 CORS 允许）
 *
 * data URL 分支走纯数据解码，不发请求；其他走 fetch()。
 */
async function dataUrlOrUrlToBlob(src: string): Promise<Blob> {
  if (src.startsWith('data:')) {
    // data:<mime>;base64,<payload>
    const commaIdx = src.indexOf(',')
    if (commaIdx < 0) throw new Error('[REF] malformed data URL')
    const header = src.slice(5, commaIdx)
    const payload = src.slice(commaIdx + 1)
    const isBase64 = header.endsWith(';base64')
    const mime = (isBase64 ? header.slice(0, -7) : header) || 'image/png'
    if (isBase64) {
      const bin = atob(payload)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Blob([bytes], { type: mime })
    }
    return new Blob([decodeURIComponent(payload)], { type: mime })
  }
  // URL（/__reel__/assets/... 或 blob: 或 http）走 fetch
  const r = await fetch(src)
  if (!r.ok) throw new Error(`[REF] fetch ${r.status} ${r.statusText}`)
  return r.blob()
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin)
}

/**
 * 图像 Provider 工厂 —— 按优先级**首个可用**的 provider 胜出：
 *
 *   1. Azure OpenAI gpt-image-2（当前默认）
 *      要求 __RS_IMG_KEY__ + __RS_IMG_BASE__ 都存在
 *
 *   2. MockImageProvider（离线占位，便于 UI 预览）
 *
 * 说明：
 *   - 之前作为首选的 Gemini 3 Pro Image Preview 已下线（业务侧不再使用）
 *   - 文本 LLM 仍可继续用 gemini-aistudio key（见 ClaudeAzureProvider fallback）
 */
export function createImageProvider(): ImageClient {
  // litellm 统一接入（2026-06）：嵌入宿主时优先走 server 的图像网关
  //   （/__ce-api__/generate-image → litellm/多厂商，key 不进前端 bundle、去本地限速）。
  if (shouldUseHostImageGateway()) {
    console.info('[reel-studio/image] using HostGatewayImageProvider (/__ce-api__ · litellm)')
    return new HostGatewayImageProvider()
  }
  if (__RS_IMG_KEY__ && __RS_IMG_BASE__) {
    console.info(
      '[reel-studio/image] using GptImageProvider (Azure gpt-image-2)',
    )
    return new GptImageProvider({
      apiKey: __RS_IMG_KEY__,
      apiBase: __RS_IMG_BASE__,
      apiVersion: __RS_IMG_VERSION__,
      // /images/edits 专用 preview 版本；__RS_IMG_EDIT_VERSION__ 在 vite.config.ts
      // 里已保证永远有字符串（回落链 editApiVersion → apiVersion → '2025-04-01-preview'）
      editApiVersion: __RS_IMG_EDIT_VERSION__,
      deployment: __RS_IMG_DEPLOYMENT__,
    })
  }
  console.info('[reel-studio/image] no Azure image key — using MockImageProvider')
  return new MockImageProvider()
}
