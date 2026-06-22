import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import {
  readFileSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  unlinkSync,
  statSync,
  renameSync,
  createReadStream,
} from 'fs'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * Reel-Studio 构建注入 —— 从 `key/llm_key.json` 读取：
 *
 *   - Gemini 3.1 Pro (gemini-aistudio)       → 提示词工坊 / 剧情树辅助（**默认**）
 *   - Claude Opus 4.6 (azure-claude)         → Gemini 不可用时的兜底
 *   - GPT-Image-2    (azure-openai-image)    → 关卡画面占位生成
 *
 * 任一缺失时，对应模块退化为本地 MockProvider；编辑器仍可离线使用。
 *
 * 注：Azure Anthropic 的 endpoint 形如：
 *   https://<resource>.services.ai.azure.com/anthropic/v1/messages
 * Azure OpenAI Image 的 endpoint 形如：
 *   https://<resource>.cognitiveservices.azure.com/openai/deployments/<deploy>/images/generations?api-version=...
 *
 * 部署名通常 = 模型名（gpt-image-2 / claude-opus-4-6），如 Azure 后台另起名再调整 vite define。
 *
 * 此文件还包含 inline 的 **reel-assets 持久化插件**（见底部）——
 * 把生成的图/视频写到 .reel-assets/ 磁盘目录，保证作者切场景/刷新永不丢失。
 */

interface KeyEntry {
  api_key?: string
  api_base?: string
  api_version?: string
  models?: string
}

interface BuildKeys {
  gemini: { apiKey: string; apiBase: string; model: string } | null
  claude: { apiKey: string; apiBase: string; model: string } | null
  imageGpt: {
    apiKey: string
    apiBase: string
    apiVersion: string
    /**
     * v3.8 · Azure `/images/edits`（图生图）端点专用的 api-version。
     *
     * 背景：
     *   - `/images/generations` (纯文生图) 用 GA 版本 `2024-02-01` 即可
     *   - `/images/edits` (图生图 / multi-image reference) 在 Azure 上**只在
     *     preview 版本下存在**；GA 版本会直接 404
     *   - 典型值：`2025-04-01-preview`
     *
     * 缺失时回落到 `apiVersion`；回落到 GA 版本的话带参考图的 generate 会 404，
     * 参考图一致性路径失效（但文本路径依然可用）。
     */
    editApiVersion?: string
    deployment: string
  } | null
  /**
   * Seedance（火山方舟·视频生成）。
   *
   * 为什么 vite 层也要注入：
   *   - 视频 API key 默认存在 `settingsStore` 的 localStorage（用户 UI 填）
   *   - 给个 build-time 默认值兜底，新装机器打开就能用，不用每次手填
   *   - 用户仍能在 VideoModelConfig 里覆盖，覆盖值走 localStorage 优先
   *
   * 和 Azure/Gemini 一样：RS_NO_KEY=1 或 `seedance` 块缺失 → 注入空串，
   * settingsStore 拿到空串则退回原本的"请用户自己填"。
   */
  seedance: {
    apiKey: string
    apiBase: string
    model: string
  } | null
  /**
   * TTS —— 角色音色锚点 / 旁白合成。
   *
   * 字段：
   *   - api_key: access token (Bearer 鉴权)
   *   - app_id:  上游 appid
   *   - cluster: 默认 volcano_tts；个别音色 (如音乐合成) 用别的 cluster
   *
   * llm_key.json 里 key 名约定 "doubao-tts" / "doubao-tts-v3" / "tts" / "tts-v3"，
   * 任一存在即可（保留旧名是为了兼容已经分发出去的 key 文件）。
   */
  doubaoTts: {
    apiKey: string
    appId: string
    apiBase: string
    cluster: string
  } | null
  /**
   * MiniMax Music 2.6 —— 剧本主题曲 / BGM / 片头曲生成。
   *
   * 字段（llm_key.json 里以独立块 "minimax-music" 存放，不和文本 LLM 的 "minimax" 块混用）：
   *   - api_key: MiniMax 平台账户的接口密钥 (sk-api-... 形式)；Bearer 鉴权
   *   - api_base: 默认 https://api.minimaxi.com (国内站); 海外用 https://api.minimax.io
   *   - default_model: music-2.6-free (所有 key 都能用) / music-2.6 (Token Plan 用户)
   *
   * 为什么不复用 minimax 文本 LLM 的 key:
   *   · MiniMax 官方按"接口密钥 (Bearer)" vs "AK/SK"两套鉴权体系
   *   · 用户给的 sk-api-... 这种是音乐/视频/图像通用的 Bearer key, 而文本 LLM
   *     走的是兼容 OpenAI 协议的另一组 key。两者来源不同, 拆开管理更安全.
   */
  minimaxMusic: {
    apiKey: string
    apiBase: string
    defaultModel: string
  } | null
}

/**
 * 按优先级**第一个找到**的为准：
 *
 *   1. process.env.KS_LLM_KEY_PATH        ── 用户/CI 显式覆盖
 *   2. ./key/llm_key.json                 ── 独立仓库本地放 key
 *   3. ../<sibling>/key/llm_key.json      ── monorepo 同源上下文（可选）
 *
 * 任一缺失都会**静默退化为 MockProvider**（不抛错），编辑器纯前端能力 100% 可用。
 *
 * 安全约束：
 *   - 候选 #2 / #3 都已通过 `.gitignore` 阻止入仓
 *   - 公共构建场景（`npm run build:standalone`）请用 `RS_NO_KEY=1` 强制清空，详见上面的注释
 */
function loadKeys(): BuildKeys {
  const out: BuildKeys = {
    gemini: null,
    claude: null,
    imageGpt: null,
    seedance: null,
    doubaoTts: null,
    minimaxMusic: null,
  }

  const candidates = [
    process.env.KS_LLM_KEY_PATH,
    resolve(__dirname, 'key/llm_key.json'),
  ].filter((p): p is string => Boolean(p))

  let raw: string | null = null
  let usedPath: string | null = null
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        raw = readFileSync(p, 'utf-8')
        usedPath = p
        break
      }
    } catch {
      // 损坏/权限问题 → 尝试下一个候选
    }
  }
  if (!raw) {
    console.info(
      `[reel-studio/vite] no LLM key file found (looked at: ${candidates
        .map((p) => p.replace(__dirname, '.'))
        .join(' | ')}) — using MockProvider`,
    )
    return out
  }

  try {
    const data = JSON.parse(raw) as Record<string, KeyEntry>

    // Gemini 3.x — 走 AI Studio（Generative Language API，query 参数携带 key）
    const gemini = data['gemini-aistudio']
    if (gemini?.api_key && gemini.api_base) {
      out.gemini = {
        apiKey: gemini.api_key,
        apiBase: gemini.api_base.replace(/\/$/, ''),
        model: 'gemini-3.1-pro-preview',
      }
    }

    const claude = data['azure-claude']
    if (claude?.api_key && claude.api_base) {
      out.claude = {
        apiKey: claude.api_key,
        apiBase: claude.api_base.replace(/\/$/, ''),
        model: 'claude-opus-4-6',
      }
    }

    const img = data['azure-openai-image']
    if (img?.api_key && img.api_base) {
      out.imageGpt = {
        apiKey: img.api_key,
        apiBase: img.api_base.replace(/\/$/, ''),
        apiVersion: img.api_version ?? '2024-02-01',
        // edit_api_version 是我们为 reel-studio 约定的扩展字段
        // （不在标准 llm_key 中），缺失时 fallback 到 undefined →
        // provider 层会再 fallback 到 apiVersion。
        editApiVersion:
          (img as KeyEntry & { edit_api_version?: string }).edit_api_version,
        deployment: 'gpt-image-2',
      }
    }

    // Seedance 视频生成 —— 和图像/文本 key 共用同一个 llm_key.json，字段：
    //   - api_key:  Bearer key（火山方舟）
    //   - api_base: 默认 https://ark.cn-beijing.volces.com/api/v3
    //   - models:   endpoint id（ep-xxx...）或共享 model id；走第一个
    const seedance = data['seedance']
    if (seedance?.api_key) {
      out.seedance = {
        apiKey: seedance.api_key,
        apiBase:
          seedance.api_base?.replace(/\/$/, '') ||
          'https://ark.cn-beijing.volces.com/api/v3',
        model:
          seedance.models?.split(',')[0]?.trim() ||
          'doubao-seedance-1-0-pro-250528',
      }
    }

    // TTS —— 同 llm_key.json，key 名 "doubao-tts" / "doubao-tts-v3" / "tts" / "tts-v3" 任一
    //   - api_key: Bearer 鉴权 token
    //   - app_id:  上游 appid（reelTtsClient 需要拼到 body.app.appid）
    //   - cluster: 默认 volcano_tts，特殊场景下 llm_key 里覆盖
    const ttsCandidate =
      (data['tts-v3'] as KeyEntry & { app_id?: string; cluster?: string }) ||
      (data['tts'] as KeyEntry & { app_id?: string; cluster?: string }) ||
      (data['doubao-tts-v3'] as KeyEntry & { app_id?: string; cluster?: string }) ||
      (data['doubao-tts'] as KeyEntry & { app_id?: string; cluster?: string })
    if (ttsCandidate?.api_key && ttsCandidate.app_id) {
      out.doubaoTts = {
        apiKey: ttsCandidate.api_key,
        appId: ttsCandidate.app_id,
        // dev / 生产都走同源反代（浏览器无法直接命中真实后端，CORS 拒）
        apiBase: '/__tts__',
        cluster: ttsCandidate.cluster ?? 'volcano_tts',
      }
    }

    // MiniMax Music —— llm_key.json 里 "minimax-music" 块独立, 不复用文本 LLM 的 minimax key
    //   - api_key:    sk-api-xxx 接口密钥, Bearer 鉴权
    //   - api_base:   可选, 默认国内站 https://api.minimaxi.com
    //   - default_model: 默认 'music-2.6-free' (所有 key 可用); 'music-2.6' 仅 Token Plan
    const music = data['minimax-music'] as KeyEntry & {
      default_model?: string
    } | undefined
    if (music?.api_key) {
      out.minimaxMusic = {
        apiKey: music.api_key,
        // 与 doubaoTts 同因: 浏览器直连国内站会被 CORS 拦掉, 走 dev server 反代.
        apiBase: '/__minimax_music__',
        defaultModel: music.default_model ?? 'music-2.6-free',
      }
    }
    console.info(
      `[reel-studio/vite] loaded LLM keys from ${usedPath?.replace(__dirname, '.')}`,
    )
  } catch (e) {
    console.warn('[reel-studio/vite] loadKeys parse failed:', e)
  }
  return out
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  Object.assign(process.env, env)
  // RS_NO_KEY=1 时**强制清空** LLM 凭据 —— 用于把产物作为"零密钥"分发版：
  //   - LLM 客户端在 key 为空时自动退化为 MockProvider
  //   - 所以最终 dist 里既没有 key、也不会偷偷请求外部服务
  // 入口：scripts/bundle-singlefile.mjs（单 HTML 打包）会以这个开关跑构建。
  const noKey = process.env.RS_NO_KEY === '1' || process.env.RS_NO_KEY === 'true'
  const keys = noKey
    ? {
        gemini: null,
        claude: null,
        imageGpt: null,
        seedance: null,
        doubaoTts: null,
        minimaxMusic: null,
      }
    : loadKeys()

  console.info(
    `[reel-studio/vite] gemini=${
      keys.gemini ? `${keys.gemini.model}@${keys.gemini.apiBase}` : 'off'
    } · claude=${
      keys.claude ? `${keys.claude.model}@${keys.claude.apiBase}` : 'off'
    } · image=${
      keys.imageGpt ? `${keys.imageGpt.deployment}@${keys.imageGpt.apiBase}` : 'mock'
    } · video=${
      keys.seedance ? `${keys.seedance.model}@${keys.seedance.apiBase}` : 'unset'
    } · tts=${
      keys.doubaoTts ? `${keys.doubaoTts.cluster}@${keys.doubaoTts.apiBase}` : 'mock'
    } · music=${
      keys.minimaxMusic ? `${keys.minimaxMusic.defaultModel}@${keys.minimaxMusic.apiBase}` : 'mock'
    }${noKey ? ' · RS_NO_KEY=1（凭据已清空）' : ''}`,
  )

  if (command === 'build' && (keys.gemini || keys.claude || keys.imageGpt)) {
    console.warn(
      '\n⚠️  [SECURITY] vite build 会把 __RS_GEMINI_KEY__ / __RS_CLAUDE_KEY__ / __RS_IMG_KEY__ 注入 dist ——\n' +
        '   产物中**包含原文 API key**。仅限本地或内网部署。\n' +
        '   公网部署前请把 LLM 调用挪到 serverless 反向代理后端。\n' +
        '   详见 packages/reel-studio/README.md → 「安全模型」章节。\n',
    )
  }

  // Base path:
  //   - 默认 './' (相对路径) — 独立 dev / preview / standalone HTML 单文件分发都靠它
  //   - 当作为 forgeax-studio 的 wb-reel 插件 build 时，host serveStatic 把产物挂在
  //     `/plugins/wb-reel/` 子路径下；此时 vite 必须用绝对 base 才能让 react-router /
  //     fetch 等绝对路径正确解析。通过 `WB_REEL_PLUGIN_BUILD=1` 切换。
  const pluginBase =
    process.env.WB_REEL_PLUGIN_BUILD === '1' ? '/plugins/wb-reel/' : './'

  return {
    base: pluginBase,
    plugins: [react(), reelAssetsPlugin(), reelScenariosPlugin(), reelMinigamesPlugin()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
      // tsc -b 在源码目录会 emit stale .js（仓库级历史问题）。
      // 把 .ts/.tsx 放在扩展名解析顺序最前，避免 import './foo' 优先解析到旧的 foo.js
      // 而读到过期产物。
      extensions: ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
    },
    define: {
      __RS_GEMINI_KEY__: JSON.stringify(keys.gemini?.apiKey ?? ''),
      __RS_GEMINI_BASE__: JSON.stringify(keys.gemini?.apiBase ?? ''),
      __RS_GEMINI_MODEL__: JSON.stringify(
        keys.gemini?.model ?? 'gemini-3.1-pro-preview',
      ),

      __RS_CLAUDE_KEY__: JSON.stringify(keys.claude?.apiKey ?? ''),
      __RS_CLAUDE_BASE__: JSON.stringify(keys.claude?.apiBase ?? ''),
      __RS_CLAUDE_MODEL__: JSON.stringify(keys.claude?.model ?? 'claude-opus-4-6'),

      __RS_IMG_KEY__: JSON.stringify(keys.imageGpt?.apiKey ?? ''),
      // 浏览器走同源反代 '/__img__'（dev server 转发到真实 Azure 端点），
      // 规避 cognitiveservices.azure.com 的 CORS 拦截；同时避免把内部
      // host 字面量打进前端 bundle。无 key 时留空（mock 不发请求）。
      __RS_IMG_BASE__: JSON.stringify(keys.imageGpt?.apiBase ? '/__img__' : ''),
      __RS_IMG_VERSION__: JSON.stringify(keys.imageGpt?.apiVersion ?? '2024-02-01'),
      // /images/edits 专用 preview 版本（loadKeys 里从 azure-openai-image.edit_api_version 读）
      // GptImageProvider 里回落链：editApiVersion → apiVersion → '2025-04-01-preview' 常量。
      __RS_IMG_EDIT_VERSION__: JSON.stringify(
        keys.imageGpt?.editApiVersion ?? '2025-04-01-preview',
      ),
      __RS_IMG_DEPLOYMENT__: JSON.stringify(
        keys.imageGpt?.deployment ?? 'gpt-image-2',
      ),

      // Seedance 视频生成默认值（新装机打开就能跑，免得每次去 UI 填一次）。
      // 用户在 VideoModelConfig 里填的值 > 这里的 build-time 默认值 > 空。
      __RS_VIDEO_KEY__: JSON.stringify(keys.seedance?.apiKey ?? ''),
      __RS_VIDEO_BASE__: JSON.stringify(
        keys.seedance?.apiBase ?? 'https://ark.cn-beijing.volces.com/api/v3',
      ),
      __RS_VIDEO_MODEL__: JSON.stringify(
        keys.seedance?.model ?? 'doubao-seedance-1-0-pro-250528',
      ),

      // TTS （角色音色锚点）—— 同 llm_key.json 同源注入
      __RS_TTS_KEY__: JSON.stringify(keys.doubaoTts?.apiKey ?? ''),
      __RS_TTS_APP_ID__: JSON.stringify(keys.doubaoTts?.appId ?? ''),
      __RS_TTS_BASE__: JSON.stringify(
        keys.doubaoTts?.apiBase ?? '/__tts__',
      ),
      __RS_TTS_CLUSTER__: JSON.stringify(keys.doubaoTts?.cluster ?? 'volcano_tts'),

      // MiniMax Music （主题曲 / BGM）—— 同 llm_key.json 同源注入
      __RS_MUSIC_KEY__: JSON.stringify(keys.minimaxMusic?.apiKey ?? ''),
      __RS_MUSIC_BASE__: JSON.stringify(
        keys.minimaxMusic?.apiBase ?? '/__minimax_music__',
      ),
      __RS_MUSIC_MODEL__: JSON.stringify(
        keys.minimaxMusic?.defaultModel ?? 'music-2.6-free',
      ),
    },
    server: {
      host: true,
      port: 15175,
      strictPort: true,
      allowedHosts: true,
      hmr: {
        // HMR client 连的 ws 端口。
        //   - 直接 `npm run dev` 本地开发 → 不设 → 自动用 server.port (15175)
        //   - 通过反代/容器访问 → 外部显式设
        //     HMR_CLIENT_PORT / PORT_REEL_STUDIO，映射到外部暴露的端口。
        // 之前默认硬编码 10052 —— 没起反代时会导致 ws 连不通（浏览器把 HMR
        // 指向一个无人占用的端口）。
        clientPort: process.env.HMR_CLIENT_PORT
          ? Number(process.env.HMR_CLIENT_PORT)
          : process.env.PORT_REEL_STUDIO
          ? Number(process.env.PORT_REEL_STUDIO)
          : undefined,
      },
      // 2026-06：本机 Python Flask 视频后端（/api/video、/api/upload、/uploads）
      // 已退役，视频统一走宿主 litellm 网关（/__ce-api__），故移除对应 dev proxy。
      proxy: {
        /**
         * v6.7 (2026-05-22)·CORS 反代：TTS 与 MiniMax Music 的官方 API
         * 都不返回 Access-Control-Allow-Origin 头, 浏览器直接 fetch 必跨域被拦.
         *
         * 解决: dev server 把它们当反代后端, 前端永远调同源路径
         *   /__tts__/api/v1/tts                       → 真实 TTS 后端
         *   /__minimax_music__/v1/music_generation    → api.minimaxi.com
         *
         * 生产部署: 在 nginx/网关 做相同 location 转发即可. provider 已被改成
         * 优先走相对路径 + 保留构建期 __RS_*_BASE__ 作为非反代场景兜底.
         */
        /**
         * v6.13 (2026-06)·litellm 统一接入：独立 dev（:15175）把 /__ce-api__/*
         * 反代到宿主 forgeax-server（默认 127.0.0.1:18900），让 HostGatewayImageProvider
         * 在独立 dev 下也能命中宿主图像网关（嵌入态本就同源，无需此代理）。
         * 真实 host 由 FORGEAX_SERVER_URL 覆盖，绝不写死内部域名。
         */
        '/__ce-api__': {
          target: process.env.FORGEAX_SERVER_URL ?? 'http://127.0.0.1:18900',
          changeOrigin: true,
          // /reel-music（MiniMax 整曲）同步阻塞 ~150s，故放宽到 5min，避免长曲被掐断。
          timeout: 5 * 60 * 1000,
          proxyTimeout: 5 * 60 * 1000,
        },
        '/__tts__': {
          target: 'https://openspeech.bytedance.com',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/__tts__/, ''),
        },
        '/__minimax_music__': {
          target: 'https://api.minimaxi.com',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/__minimax_music__/, ''),
          // music_generation 真实耗时 ~150s, 默认 30s timeout 必断. 拉到 5min.
          timeout: 5 * 60 * 1000,
          proxyTimeout: 5 * 60 * 1000,
        },
        /**
         * v7 (2026-06-14)·图像生成同样的 CORS 反代：Azure gpt-image-2 端点
         * （*.cognitiveservices.azure.com）不返回 CORS 头，浏览器直接 fetch
         * 必跨域被拦 → 海报样张永远生不出来（降级到 swatch 占位）。
         *
         * 解决：dev server 反代，前端走同源 /__img__/openai/...，
         * __RS_IMG_BASE__ 在浏览器里被改写成 '/__img__'（见 define）。
         * key 仍由前端在 header 里带（api-key / Authorization），代理只转发。
         *
         * 仅在有真实 image key 时挂载（mock / RS_NO_KEY 场景无需代理）。
         */
        ...(keys.imageGpt?.apiBase
          ? {
              '/__img__': {
                target: keys.imageGpt.apiBase,
                changeOrigin: true,
                secure: true,
                rewrite: (p: string) => p.replace(/^\/__img__/, ''),
                // gpt-image-2 单张高质量可能 30s+，批量更久；放宽到 3min。
                timeout: 3 * 60 * 1000,
                proxyTimeout: 3 * 60 * 1000,
              },
            }
          : {}),
      },
    },
    test: {
      environment: 'happy-dom',
      globals: true,
      // happy-dom 20.9.0 的 localStorage 在 vitest 下方法取不到 → setup 里补内存版兜底
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    },
    build: {
      outDir: 'dist',
      // sourcemap 默认开（便于线上调试）；RS_NO_SOURCEMAP=1 时关闭 ——
      // 用于在 iCloud 同步目录等 I/O 受限环境下显著缩短构建时间/内存占用。
      sourcemap: process.env.RS_NO_SOURCEMAP === '1' ? false : true,
    },
  }
})

// ============================================================================
// reel-assets 持久化插件（inline）
// ============================================================================
//
//   .reel-assets/
//   ├─ manifest.json          # 全索引（asset 元信息列表）
//   └─ blobs/<id>.<ext>       # 实际二进制
//
// 设计要点：
//   - 单进程内顺序读写 manifest（dev server 单线程足够）
//   - 任何写入都"先写 blob、再追加 manifest"——崩溃时最坏丢一条记录
//   - 仅在 dev/preview 阶段挂载；build 产物不依赖此中间件
//   - 路由统一前缀 /__reel__/assets，避免和应用路由冲突
//
// 安全：
//   - 仅本机访问（vite server.host 控制）
//   - 不做远程鉴权——这是开发期工具，不要把 dev server 暴露到公网
//   - 输入大小限制 32 MiB

const ROUTE_PREFIX = '/__reel__/assets'
const MAX_BODY_BYTES = 256 * 1024 * 1024

interface AssetMeta {
  scenarioId?: string
  sceneId?: string
  promptKind?: string
  prompt?: string
  model?: string
  latencyMs?: number
  source?: string
  note?: string
  tags?: string[]
}

interface AssetRecord {
  id: string
  kind: 'image' | 'video'
  filename: string
  mimeType: string
  bytes: number
  createdAt: number
  /** 就地编辑（画笔/打码/翻转等）覆盖原图后的时间戳；用于客户端 cache-bust */
  editedAt?: number
  meta: AssetMeta
}

interface Manifest {
  version: 1
  assets: AssetRecord[]
}

interface AssetStorage {
  rootDir: string
  blobsDir: string
  manifestPath: string
}

function ensureStorage(rootDir: string): AssetStorage {
  const blobsDir = resolve(rootDir, 'blobs')
  const manifestPath = resolve(rootDir, 'manifest.json')
  if (!existsSync(rootDir)) mkdirSync(rootDir, { recursive: true })
  if (!existsSync(blobsDir)) mkdirSync(blobsDir, { recursive: true })
  if (!existsSync(manifestPath)) {
    writeFileSync(manifestPath, JSON.stringify({ version: 1, assets: [] }, null, 2))
  }
  return { rootDir, blobsDir, manifestPath }
}

function readManifest(s: AssetStorage): Manifest {
  try {
    const raw = readFileSync(s.manifestPath, 'utf-8')
    const parsed = JSON.parse(raw) as Manifest
    if (parsed?.version === 1 && Array.isArray(parsed.assets)) return parsed
  } catch {
    // 损坏或丢失 → 静默重建（旧 blob 文件保留，下次能用 GC 工具找回）
  }
  return { version: 1, assets: [] }
}

function writeManifestFile(s: AssetStorage, m: Manifest): void {
  const tmp = `${s.manifestPath}.tmp`
  writeFileSync(tmp, JSON.stringify(m, null, 2))
  renameSync(tmp, s.manifestPath)
}

/**
 * manifest.json 写入串行化 mutex。
 *
 * 历史背景：handleCreate / handleCreateBinary / handleDelete / handlePatch
 * 都是 "read manifest → modify → write manifest" 三步组合，三步之间没锁。
 * Node 单线程虽然在同步段之间不会真并发，但这些 handler 在 await 边界
 * （如 readBinaryBody）让出控制权后，多个并发的上传请求会**交叉**执行
 * "读"和"写"，结果：
 *   · 请求 A: read N → modify N+1 → write
 *   · 请求 B: read N → modify N+1 → write（覆盖 A 的写）
 * → manifest 少记一条，物理文件却已落盘 → 上传方"看似成功"但别人查不到。
 *
 * 解法：所有改 manifest 的 handler 进入前 await 这个链，确保任何时刻
 * 只有一个 read-modify-write 流程在跑。读路径（handleList）不需要 lock
 * 因为 writeManifestFile 走 tmp+rename 原子替换，读不会读到半截文件。
 */
let _manifestWriteChain: Promise<unknown> = Promise.resolve()
function withManifestLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const next = _manifestWriteChain.then(() => fn())
  _manifestWriteChain = next.catch(() => undefined)
  return next
}

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'video/mp4') return 'mp4'
  if (mime === 'video/webm') return 'webm'
  if (mime === 'video/quicktime') return 'mov'
  return 'bin'
}

function nextId(kind: 'image' | 'video'): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `${kind === 'image' ? 'img' : 'vid'}-${t}-${r}`
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise<unknown>((resolveBody, rejectBody) => {
    let total = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > MAX_BODY_BYTES) {
        rejectBody(new Error(`payload too large (>${MAX_BODY_BYTES} bytes)`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        resolveBody(raw ? JSON.parse(raw) : {})
      } catch (e) {
        rejectBody(e as Error)
      }
    })
    req.on('error', rejectBody)
  })
}

/**
 * 读取原始二进制 body —— 视频走这条路径，避免 base64 膨胀 33% 踩上限。
 */
async function readBinaryBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolveBody, rejectBody) => {
    let total = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total > MAX_BODY_BYTES) {
        rejectBody(new Error(`payload too large (>${MAX_BODY_BYTES} bytes)`))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', rejectBody)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function sendBinary(
  res: ServerResponse,
  mime: string,
  data: Buffer,
  filename: string,
): void {
  res.statusCode = 200
  res.setHeader('content-type', mime)
  res.setHeader('content-length', String(data.length))
  // no-cache（而非 immutable）：资产可被「就地编辑（画笔/打码/翻转）」覆盖，
  // URL 不变。本地磁盘服务，重新校验成本可忽略；换来编辑后所见即所得。
  res.setHeader('cache-control', 'no-cache')
  res.setHeader('content-disposition', `inline; filename="${filename}"`)
  res.end(data)
}

interface CreateBody {
  kind?: 'image' | 'video'
  dataUrl?: string
  base64?: string
  mimeType?: string
  meta?: AssetMeta
}

function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const m = /^data:([^;,]+)(?:;[^,]*)?,(.+)$/.exec(dataUrl)
  if (!m) return null
  return { mime: m[1] ?? 'application/octet-stream', base64: m[2] ?? '' }
}

async function handleCreate(
  storage: AssetStorage,
  body: CreateBody,
): Promise<{ status: number; body: unknown }> {
  let mime = body.mimeType ?? ''
  let b64 = body.base64 ?? ''

  if (body.dataUrl) {
    const parsed = parseDataUrl(body.dataUrl)
    if (!parsed) return { status: 400, body: { error: 'invalid dataUrl' } }
    mime = parsed.mime
    b64 = parsed.base64
  }
  if (!b64) return { status: 400, body: { error: 'missing base64/dataUrl' } }
  if (!mime) return { status: 400, body: { error: 'missing mimeType' } }

  const kind: 'image' | 'video' =
    body.kind ?? (mime.startsWith('video/') ? 'video' : 'image')
  const id = nextId(kind)
  const ext = extFromMime(mime)
  const filename = `blobs/${id}.${ext}`
  const fullpath = resolve(storage.rootDir, filename)

  let bin: Buffer
  try {
    bin = Buffer.from(b64, 'base64')
  } catch {
    return { status: 400, body: { error: 'invalid base64' } }
  }
  writeFileSync(fullpath, bin)

  const record: AssetRecord = {
    id,
    kind,
    filename,
    mimeType: mime,
    bytes: bin.length,
    createdAt: Date.now(),
    meta: body.meta ?? {},
  }

  await withManifestLock(() => {
    const manifest = readManifest(storage)
    manifest.assets.push(record)
    writeManifestFile(storage, manifest)
  })

  return { status: 201, body: { asset: record } }
}

/**
 * 二进制上传 handler —— 不走 base64，直接把 req body 当 blob 落盘。
 *
 * 协议：
 *   - POST /__reel__/assets/binary
 *   - Content-Type: <真实 mime，如 video/mp4>
 *   - x-reel-kind: image | video（可选；缺省按 mime 推断）
 *   - x-reel-meta: JSON 序列化的 AssetMeta（可选；无则空 meta）
 *
 * 设计初衷：视频经 base64 编码后体积 ×1.33，32MB 原片变 42MB 就超限了；
 * 走原始 blob 流能省掉这层膨胀，同时避免前端 FileReader.readAsDataURL
 * 在大视频上卡住主线程。
 */
async function handleCreateBinary(
  storage: AssetStorage,
  req: IncomingMessage,
  buf: Buffer,
): Promise<{ status: number; body: unknown }> {
  const mime = (req.headers['content-type'] as string | undefined) ?? ''
  if (!mime) return { status: 400, body: { error: 'missing content-type' } }

  const kindHeader = (req.headers['x-reel-kind'] as string | undefined) ?? ''
  const kind: 'image' | 'video' =
    kindHeader === 'image' || kindHeader === 'video'
      ? kindHeader
      : mime.startsWith('video/')
        ? 'video'
        : 'image'

  let meta: AssetMeta = {}
  const metaHeader = req.headers['x-reel-meta'] as string | undefined
  if (metaHeader) {
    // 协议兼容：
    //   · 新客户端（assetStore.saveBlob 2026-05-21 起）会把 JSON URL-encode
    //     再放 header，避免中文 note 触发 ISO-8859-1 限制；同时附 x-reel-meta-encoded: 1
    //   · 老客户端（已分发）直接放原始 JSON，没有 encoded 头
    //   先看 encoded 头决定要不要 decodeURIComponent；解 JSON 失败时再尝试一次
    //   原始解析作兜底，保证两套客户端都能升级到新 server 后无缝运行。
    const isEncoded = (req.headers['x-reel-meta-encoded'] as string | undefined) === '1'
    let raw = metaHeader
    if (isEncoded) {
      try {
        raw = decodeURIComponent(metaHeader)
      } catch {
        return { status: 400, body: { error: 'x-reel-meta: invalid URL-encoded value' } }
      }
    }
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object') meta = parsed as AssetMeta
    } catch {
      // 兜底：标了 encoded 但 decode 后仍非 JSON，或老客户端没标 encoded
      // 但 raw 本身正好不是 ASCII JSON（极小概率）。无论哪种都拒
      return { status: 400, body: { error: 'x-reel-meta: invalid JSON' } }
    }
  }

  if (buf.length === 0) return { status: 400, body: { error: 'empty body' } }

  const id = nextId(kind)
  const ext = extFromMime(mime)
  const filename = `blobs/${id}.${ext}`
  const fullpath = resolve(storage.rootDir, filename)
  writeFileSync(fullpath, buf)

  const record: AssetRecord = {
    id,
    kind,
    filename,
    mimeType: mime,
    bytes: buf.length,
    createdAt: Date.now(),
    meta,
  }
  await withManifestLock(() => {
    const manifest = readManifest(storage)
    manifest.assets.push(record)
    writeManifestFile(storage, manifest)
  })

  return { status: 201, body: { asset: record } }
}

function handleList(
  storage: AssetStorage,
  query: URLSearchParams,
): { status: number; body: unknown } {
  const manifest = readManifest(storage)
  const sceneId = query.get('sceneId') ?? undefined
  const scenarioId = query.get('scenarioId') ?? undefined
  const kind = query.get('kind') ?? undefined
  const promptKind = query.get('promptKind') ?? undefined

  let list = manifest.assets
  if (sceneId) list = list.filter((a) => a.meta.sceneId === sceneId)
  if (scenarioId) list = list.filter((a) => a.meta.scenarioId === scenarioId)
  if (kind) list = list.filter((a) => a.kind === kind)
  if (promptKind) list = list.filter((a) => a.meta.promptKind === promptKind)

  return { status: 200, body: { assets: list } }
}

function handleGetBlob(
  storage: AssetStorage,
  id: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const manifest = readManifest(storage)
  const rec = manifest.assets.find((a) => a.id === id)
  if (!rec) {
    sendJson(res, 404, { error: `asset ${id} not found` })
    return
  }
  const fullpath = resolve(storage.rootDir, rec.filename)
  if (!existsSync(fullpath)) {
    sendJson(res, 410, { error: `blob missing: ${rec.filename}` })
    return
  }

  // v3.8 · 大视频优化：支持 HTTP Range + 流式响应
  //
  // 背景：原实现 `readFileSync(fullpath)` 把整个文件（可达 227 MiB）塞进 Node 内存
  // 再 `res.end(data)` 一次吐出去。浏览器 <video> 必须**收完整包**才能解码，
  // 首刷 / 换浏览器时单幕等待时间极长；对 moov 在尾部的 mp4 尤其严重。
  //
  // 修法：
  //   - 读 Range 头（<video> 元素默认会发 `Range: bytes=0-`）
  //   - 回 206 Partial Content + Content-Range + Accept-Ranges，fs.createReadStream 流式发送
  //   - 浏览器拿到 moov atom 后立刻起播，mdat 边播边拉
  //   - 无 Range 头时仍回 200 全量（兼容 curl / 简单 GET）
  //
  // 稳定性：
  //   - Range 超过文件大小 → 416 Range Not Satisfiable
  //   - 只读取请求的片段，内存占用 = HWM（默认 64KB），不再 O(文件大小)
  try {
    const stat = statSync(fullpath)
    const totalSize = stat.size
    const rangeHeader = req.headers['range']
    const ext = rec.filename.split('.').pop() ?? 'bin'
    const dispositionName = `${rec.id}.${ext}`

    // 公共响应头
    res.setHeader('Content-Type', rec.mimeType)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.setHeader('Content-Disposition', `inline; filename="${dispositionName}"`)
    res.setHeader('Accept-Ranges', 'bytes')

    if (typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      if (match) {
        const startStr = match[1] ?? ''
        const endStr = match[2] ?? ''
        // 视频通常发 `bytes=N-`（半开），有些客户端也会发 `bytes=-N`（尾部 N 字节）
        let start: number
        let end: number
        if (startStr === '' && endStr !== '') {
          const suffix = parseInt(endStr, 10)
          if (!Number.isFinite(suffix) || suffix <= 0) {
            res.statusCode = 416
            res.setHeader('Content-Range', `bytes */${totalSize}`)
            return void res.end()
          }
          start = Math.max(0, totalSize - suffix)
          end = totalSize - 1
        } else {
          start = parseInt(startStr, 10)
          end = endStr === '' ? totalSize - 1 : parseInt(endStr, 10)
        }
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end >= totalSize ||
          start > end
        ) {
          res.statusCode = 416
          res.setHeader('Content-Range', `bytes */${totalSize}`)
          return void res.end()
        }
        const chunkSize = end - start + 1
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`)
        res.setHeader('Content-Length', String(chunkSize))
        const stream = createReadStream(fullpath, { start, end })
        stream.on('error', (err) => {
          // stream 级错误：比如文件正被写。不发 500（头已经写出去了），静默断流
          // eslint-disable-next-line no-console
          console.warn('[reel-assets] stream error:', err)
          res.end()
        })
        return void stream.pipe(res)
      }
      // Range 格式不认识 → 416
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${totalSize}`)
      return void res.end()
    }

    // 无 Range 头 → 200 全量（仍然流式，不再 readFileSync 整块进内存）
    res.statusCode = 200
    res.setHeader('Content-Length', String(totalSize))
    const stream = createReadStream(fullpath)
    stream.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.warn('[reel-assets] stream error:', err)
      res.end()
    })
    stream.pipe(res)
  } catch (e) {
    sendJson(res, 500, { error: (e as Error).message })
  }
}

async function handleDelete(
  storage: AssetStorage,
  id: string,
): Promise<{ status: number; body: unknown }> {
  return withManifestLock(() => {
    const manifest = readManifest(storage)
    const idx = manifest.assets.findIndex((a) => a.id === id)
    if (idx === -1) return { status: 404, body: { error: `asset ${id} not found` } }

    const rec = manifest.assets[idx]!
    manifest.assets.splice(idx, 1)
    writeManifestFile(storage, manifest)

    const fullpath = resolve(storage.rootDir, rec.filename)
    if (existsSync(fullpath)) {
      try {
        unlinkSync(fullpath)
      } catch {
        // 文件可能已被其他工具清理；manifest 已更新即可
      }
    }
    return { status: 200, body: { ok: true, id } }
  })
}

/**
 * 就地替换一张图像的二进制内容（画笔/打码/翻转等编辑后「保存至原图」）。
 *
 * 保持 id / mediaId / tags / scenarioId / sceneId 不变 —— 已采用引用、卡片归组
 * 全部沿用；仅 blob 字节、mimeType、bytes、filename(扩展名) 更新，并打 editedAt。
 * 仅允许图像（视频/音频不走此路）。
 */
async function handleReplace(
  storage: AssetStorage,
  id: string,
  body: { dataUrl?: string; base64?: string; mimeType?: string },
): Promise<{ status: number; body: unknown }> {
  let mime = body.mimeType ?? ''
  let b64 = body.base64 ?? ''
  if (body.dataUrl) {
    const parsed = parseDataUrl(body.dataUrl)
    if (!parsed) return { status: 400, body: { error: 'invalid dataUrl' } }
    mime = parsed.mime
    b64 = parsed.base64
  }
  if (!b64) return { status: 400, body: { error: 'missing base64/dataUrl' } }
  if (!mime.startsWith('image/')) {
    return { status: 400, body: { error: 'replace only supports images' } }
  }

  let bin: Buffer
  try {
    bin = Buffer.from(b64, 'base64')
  } catch {
    return { status: 400, body: { error: 'invalid base64' } }
  }
  if (bin.length === 0) return { status: 400, body: { error: 'empty image' } }

  return withManifestLock(() => {
    const manifest = readManifest(storage)
    const idx = manifest.assets.findIndex((a) => a.id === id)
    if (idx === -1) return { status: 404, body: { error: `asset ${id} not found` } }
    const cur = manifest.assets[idx]!
    if (cur.kind !== 'image') {
      return { status: 400, body: { error: 'replace only supports image assets' } }
    }

    const ext = extFromMime(mime)
    const newFilename = `blobs/${id}.${ext}`
    const newPath = resolve(storage.rootDir, newFilename)
    writeFileSync(newPath, bin)
    // 扩展名变了（如 jpg→png）：删掉旧 blob，避免残留孤儿文件
    if (cur.filename !== newFilename) {
      const oldPath = resolve(storage.rootDir, cur.filename)
      if (existsSync(oldPath)) {
        try {
          unlinkSync(oldPath)
        } catch {
          /* 旧文件可能已不在；忽略 */
        }
      }
    }

    manifest.assets[idx] = {
      ...cur,
      filename: newFilename,
      mimeType: mime,
      bytes: bin.length,
      editedAt: Date.now(),
    }
    writeManifestFile(storage, manifest)
    return { status: 200, body: { asset: manifest.assets[idx] } }
  })
}

async function handlePatch(
  storage: AssetStorage,
  id: string,
  body: { meta?: Partial<AssetMeta> },
): Promise<{ status: number; body: unknown }> {
  return withManifestLock(() => {
    const manifest = readManifest(storage)
    const idx = manifest.assets.findIndex((a) => a.id === id)
    if (idx === -1) return { status: 404, body: { error: `asset ${id} not found` } }

    const cur = manifest.assets[idx]!
    manifest.assets[idx] = { ...cur, meta: { ...cur.meta, ...(body.meta ?? {}) } }
    writeManifestFile(storage, manifest)
    return { status: 200, body: { asset: manifest.assets[idx] } }
  })
}

function statsOf(storage: AssetStorage): { count: number; bytes: number } {
  const m = readManifest(storage)
  let bytes = 0
  for (const a of m.assets) {
    const fp = resolve(storage.rootDir, a.filename)
    try {
      const st = statSync(fp)
      bytes += st.size
    } catch {
      bytes += a.bytes
    }
  }
  return { count: m.assets.length, bytes }
}

function reelAssetsPlugin(): Plugin {
  /** 全局库（无 ?game= 时用）—— 仍落在 wb-reel 包内 config.root/.reel-assets，老素材零搬迁。 */
  let globalStorage: AssetStorage
  /** 工程根（含 .forgeax/games），per-game 媒体落到该根下；找不到时回退 config.root。 */
  let projectRoot = ''
  const gameStorages = new Map<string, AssetStorage>()

  /**
   * 按 game slug 解析媒体存储：
   *   - 合法 slug → `<projectRoot>/.forgeax/games/<slug>/reel/assets`（game 自包含）。
   *   - 无 slug → 全局库（历史行为）。
   * 每个 slug 一份缓存的 AssetStorage（含 ensureStorage 建目录）。
   */
  function resolveStorageForSlug(slug: string | null): AssetStorage {
    if (!slug) return globalStorage
    const cached = gameStorages.get(slug)
    if (cached) return cached
    const st = ensureStorage(resolveAssetsDir(projectRoot, slug))
    gameStorages.set(slug, st)
    return st
  }

  function attachWriteAndRead(server: ViteDevServer): void {
    server.middlewares.use(ROUTE_PREFIX, async (req, res, next) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname.replace(/\/+$/, '') || '/'
        const method = (req.method ?? 'GET').toUpperCase()
        // per-game 媒体：?game=<slug> 指定时落到该 game 隔离目录，否则全局库。
        const storage = resolveStorageForSlug(gameSlugFromUrl(url))

        if (path === '/' || path === '') {
          if (method === 'GET') {
            const { status, body } = handleList(storage, url.searchParams)
            return sendJson(res, status, body)
          }
          if (method === 'POST') {
            const body = (await readJsonBody(req)) as CreateBody
            const { status, body: out } = await handleCreate(storage, body)
            return sendJson(res, status, out)
          }
          return sendJson(res, 405, { error: 'method not allowed' })
        }

        if (path === '/binary') {
          if (method !== 'POST') {
            return sendJson(res, 405, { error: 'method not allowed' })
          }
          const buf = await readBinaryBody(req)
          const { status, body } = await handleCreateBinary(storage, req, buf)
          return sendJson(res, status, body)
        }

        const idMatch = /^\/([^/]+)$/.exec(path)
        if (idMatch) {
          const id = decodeURIComponent(idMatch[1] ?? '')
          if (method === 'GET') return handleGetBlob(storage, id, req, res)
          if (method === 'DELETE') {
            const { status, body } = await handleDelete(storage, id)
            return sendJson(res, status, body)
          }
          if (method === 'PATCH') {
            const body = (await readJsonBody(req)) as { meta?: Partial<AssetMeta> }
            const { status, body: out } = await handlePatch(storage, id, body)
            return sendJson(res, status, out)
          }
          if (method === 'PUT') {
            const body = (await readJsonBody(req)) as {
              dataUrl?: string
              base64?: string
              mimeType?: string
            }
            const { status, body: out } = await handleReplace(storage, id, body)
            return sendJson(res, status, out)
          }
          return sendJson(res, 405, { error: 'method not allowed' })
        }

        next()
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message })
      }
    })
  }

  return {
    name: 'reel-assets',
    apply: 'serve',
    configResolved(config) {
      // per-game 媒体落到工程根的 .forgeax/games/<slug>/reel/assets；全局库仍在
      // 包内 .reel-assets（resolveAssetsDir(config.root, null)），老素材零搬迁。
      projectRoot = findProjectRootWithForgeax(config.root) ?? config.root
      globalStorage = ensureStorage(resolveAssetsDir(config.root, null))
      const stat = statsOf(globalStorage)
      const mb = (stat.bytes / 1024 / 1024).toFixed(1)
      console.info(
        `[reel-assets] ${stat.count} record(s) · ${mb} MiB · ${globalStorage.rootDir} · per-game→ ${resolve(projectRoot, '.forgeax', 'games')}`,
      )
    },
    configureServer(server) {
      attachWriteAndRead(server)
    },
  }
}

// ============================================================================
// reel-scenarios 持久化插件（inline）
// ============================================================================
//
//   .reel-scenarios/
//   └─ scenarios.json       # PersistedDb 的磁盘镜像
//
// 为什么单独一个插件：
//   - 作者反馈：换一台浏览器/清了站点数据，之前贴过的剧本/剧情树全没了。
//   - 根因：scenarioPersist 只写 localStorage；localStorage 按 "浏览器 × 源"
//     隔离，换浏览器即丢。
//   - 修法：把 PersistedDb 原样落地到 dev server 所在的磁盘目录；
//     同一 dev server 下任何浏览器都能读到同一份（iCloud 同步后还能跨机）。
//
// 设计要点：
//   - 协议极简：GET 读全量 / PUT 整个 db / 没有增量。db 本身几 MB，整体写够用。
//   - 写入走 "先写 tmp、再 rename" 原子替换，避免半写状态。
//   - 前端 fallback：插件不在（比如 build 产物直接打开 html）时，fetch 返回
//     非 2xx，前端回退到原来的 localStorage 行为。
//   - 不做鉴权 —— 仅开发期本机使用，同 assetStore 约束。

const SCENARIO_ROUTE_PREFIX = '/__reel__/scenarios'
const SCENARIO_MAX_BYTES = 32 * 1024 * 1024

interface ScenarioStorage {
  rootDir: string
  dbPath: string
  /** 每版 scenario body 文件目录：.reel-scenarios/versions/<scenarioId>/<versionId>.json */
  versionsDir: string
}

function ensureScenarioStorage(rootDir: string): ScenarioStorage {
  const dbPath = resolve(rootDir, 'scenarios.json')
  const versionsDir = resolve(rootDir, 'versions')
  if (!existsSync(rootDir)) mkdirSync(rootDir, { recursive: true })
  if (!existsSync(versionsDir)) mkdirSync(versionsDir, { recursive: true })
  if (!existsSync(dbPath)) {
    writeFileSync(
      dbPath,
      JSON.stringify({ version: 1, activeId: null, items: [] }, null, 2),
    )
  }
  return { rootDir, dbPath, versionsDir }
}

function readScenarioDb(s: ScenarioStorage): unknown {
  try {
    const raw = readFileSync(s.dbPath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    // 损坏或丢失 → 返回 empty，前端 deserialize 再次兜底
    return { version: 1, activeId: null, items: [] }
  }
}

function writeScenarioDbFile(s: ScenarioStorage, db: unknown): void {
  const tmp = `${s.dbPath}.tmp`
  writeFileSync(tmp, JSON.stringify(db, null, 2))
  renameSync(tmp, s.dbPath)
}

function scenarioStatsOf(s: ScenarioStorage): {
  count: number
  bytes: number
} {
  try {
    const st = statSync(s.dbPath)
    const raw = readScenarioDb(s) as {
      items?: unknown[]
    } | null
    return {
      count: Array.isArray(raw?.items) ? raw!.items!.length : 0,
      bytes: st.size,
    }
  } catch {
    return { count: 0, bytes: 0 }
  }
}

// ─── 版本文件读写 ────────────────────────────────────────────────────────────
//
// 存储布局：
//   .reel-scenarios/versions/<scenarioId>/<versionId>.json
//
// 为什么分文件：
//   - 单版 scenario 50-200KB；20 版都塞进 scenarios.json 会让它膨胀到几 MB，
//     每次 PUT 全量推送磁盘 I/O 很重。
//   - 分文件 = 按需读：历史下拉展开某 scenario → 只读一次元数据（已经在 items 里）；
//     用户点某版回滚时才 GET 对应 version.json。
//
// id 安全性：
//   - scenarioId 和 versionId 都由前端生成（scn-xxx / v-xxx），这里做正则兜底，
//     禁止 ../ 路径穿越和非法字符。
const VERSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function safeSegment(s: string): boolean {
  return VERSION_ID_RE.test(s)
}

function versionFilePath(
  storage: ScenarioStorage,
  scenarioId: string,
  versionId: string,
): string | null {
  if (!safeSegment(scenarioId) || !safeSegment(versionId)) return null
  const dir = resolve(storage.versionsDir, scenarioId)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return resolve(dir, `${versionId}.json`)
}

function writeVersionFile(
  storage: ScenarioStorage,
  scenarioId: string,
  versionId: string,
  body: unknown,
): boolean {
  const p = versionFilePath(storage, scenarioId, versionId)
  if (!p) return false
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(body))
  renameSync(tmp, p)
  return true
}

function readVersionFile(
  storage: ScenarioStorage,
  scenarioId: string,
  versionId: string,
): unknown | null {
  if (!safeSegment(scenarioId) || !safeSegment(versionId)) return null
  const p = resolve(storage.versionsDir, scenarioId, `${versionId}.json`)
  if (!existsSync(p)) return null
  try {
    return JSON.parse(readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

/** game slug 兜底正则 —— 与 host/server 的 GAME_SLUG_RE 对齐，禁路径穿越。 */
const GAME_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,40}$/

/**
 * 从某个起点目录向上找出含 `.forgeax/` 的工程根（games 目录所在）。
 * reel 的 vite `config.root` 是 wb-reel 包目录，工程根在更上层，故向上探。
 * 找不到时返回 null（回退到包内 `.reel-scenarios/games/<slug>`）。
 */
function findProjectRootWithForgeax(start: string): string | null {
  let dir = start
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, '.forgeax', 'games'))) return dir
    const parent = resolve(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * 按 game slug 解析 reel 媒体资产根目录（与剧本库 resolveStorage 同源策略）：
 *   - 合法 slug：`<base>/.forgeax/games/<slug>/reel/assets`，让 game 目录自包含，
 *     server 端导出器可直接读取该 game 的全部媒体（P0：互动影游作为引擎资产）。
 *   - 无 slug / 非法 slug：回退到包内全局 `<base>/.reel-assets`（与历史行为一致，
 *     老素材零搬迁）。
 * 纯函数 —— base 由调用方决定：per-game 传工程根（含 .forgeax），全局传 config.root。
 */
export function resolveAssetsDir(base: string, slug: string | null): string {
  if (slug && GAME_SLUG_RE.test(slug)) {
    return resolve(base, '.forgeax', 'games', slug, 'reel', 'assets')
  }
  return resolve(base, '.reel-assets')
}

/** 从请求 URL 的 `?game=` 取合法 slug（禁路径穿越）；与 reelScenariosPlugin 对齐。 */
function gameSlugFromUrl(url: URL): string | null {
  const raw = (url.searchParams.get('game') ?? '').trim()
  return raw && GAME_SLUG_RE.test(raw) ? raw : null
}

function reelScenariosPlugin(): Plugin {
  let storage: ScenarioStorage
  /** config.root/.reel-scenarios —— 全局库根（无 game 时用）。 */
  let baseRoot = ''
  /** 工程根（含 .forgeax/games），用于 per-game 库；null 表示回退包内。 */
  let projectRoot: string | null = null
  const gameStorages = new Map<string, ScenarioStorage>()

  /**
   * 按 game slug 解析剧本库存储位置：
   *   - 合法 slug：`<projectRoot>/.forgeax/games/<slug>/reel/`（与插件清单声明的
   *     `fs:*:.forgeax/games/{slug}/reel/**` 路径一致）；找不到工程根时退回包内
   *     `.reel-scenarios/games/<slug>/`。每个 game 一套独立 db + activeId。
   *   - 无 slug / 非法：返回全局库（与历史行为完全一致，老剧本零改动）。
   */
  function resolveStorage(slug: string | null): ScenarioStorage {
    if (!slug || !GAME_SLUG_RE.test(slug)) return storage
    const cached = gameStorages.get(slug)
    if (cached) return cached
    const dir = projectRoot
      ? resolve(projectRoot, '.forgeax', 'games', slug, 'reel')
      : resolve(baseRoot, 'games', slug)
    const st = ensureScenarioStorage(dir)
    gameStorages.set(slug, st)
    return st
  }

  function gameSlugOf(url: URL): string | null {
    const raw = (url.searchParams.get('game') ?? '').trim()
    return raw && GAME_SLUG_RE.test(raw) ? raw : null
  }

  function attach(server: ViteDevServer): void {
    server.middlewares.use(SCENARIO_ROUTE_PREFIX, async (req, res, next) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname.replace(/\/+$/, '') || '/'
        const method = (req.method ?? 'GET').toUpperCase()
        // per-game 库：?game=<slug> 指定时落到该 game 的隔离目录，否则全局库。
        const storage = resolveStorage(gameSlugOf(url))

        if (path === '/' || path === '') {
          if (method === 'GET') {
            const db = readScenarioDb(storage)
            return sendJson(res, 200, { db })
          }
          if (method === 'PUT') {
            // 读取并严检 body —— 前端写入前会 sanitize，这里只做 size 兜底
            const raw = await readJsonBody(req)
            const parsed = raw as { db?: unknown }
            if (!parsed || typeof parsed !== 'object' || !parsed.db) {
              return sendJson(res, 400, {
                error: 'missing `db` field in body',
              })
            }
            const serialized = JSON.stringify(parsed.db)
            if (serialized.length > SCENARIO_MAX_BYTES) {
              return sendJson(res, 413, {
                error: `scenario db exceeds limit (${SCENARIO_MAX_BYTES} bytes)`,
              })
            }

            // ─── 多 tab 数据保护（2026-05 补丁）─────────────────────────
            // 客户端 PUT 的是**它本地的完整 db**，但用户可能在另一个 tab / 窗口
            // 刚写入了更新。直接覆盖 = 数据丢失。
            //
            // 策略：读当前磁盘 db，按 item.id 做 per-item 合并：
            //   - 客户端送来的条目 updatedAt > 磁盘现有条目 updatedAt → 用客户端的
            //   - 反之 → 保留磁盘现有条目（别人刚写的）
            //   - 客户端没送来但磁盘有的条目 → **保留**（客户端可能从来没加载过它）
            //   - 客户端送来磁盘没有的新条目 → 加上
            //
            // 这个合并在服务端做、跨所有客户端一致，即使两个客户端同时 PUT 也不会互相吞。
            // 注意：下层 item.scenario 本身的字段级合并不做（那是 CRDT 领域）——
            // 同 item 后写胜；但不同 item 之间绝不互吞。
            const existing = readScenarioDb(storage) as {
              version?: number
              activeId?: string | null
              items?: Array<{
                id: string
                updatedAt: number
                [k: string]: unknown
              }>
            } | null
            const incoming = parsed.db as {
              version?: number
              activeId?: string | null
              items?: Array<{
                id: string
                updatedAt: number
                [k: string]: unknown
              }>
            }

            const byId = new Map<string, { id: string; updatedAt: number; lastPublishedAt?: number; [k: string]: unknown }>()
            // 先放磁盘原有（老内容）
            for (const it of existing?.items ?? []) {
              if (it && typeof it.id === 'string' && typeof it.updatedAt === 'number') {
                byId.set(it.id, it)
              }
            }
            // 再用客户端送来的覆盖（但只覆盖"客户端版本更新"的）
            //
            // 挑选优先级（2026-05 持久化补丁）：
            //   1. lastPublishedAt 更大者胜（保存动作是"权威动作"，一方有较新的已保存版就用它）
            //   2. 发布时间相同或缺失时 fallback 到 updatedAt（兼容旧数据）
            for (const it of incoming.items ?? []) {
              if (!it || typeof it.id !== 'string' || typeof it.updatedAt !== 'number') continue
              const prev = byId.get(it.id)
              if (!prev) {
                byId.set(it.id, it)
                continue
              }
              const incomingPub =
                typeof it.lastPublishedAt === 'number' ? it.lastPublishedAt : 0
              const prevPub =
                typeof prev.lastPublishedAt === 'number' ? prev.lastPublishedAt : 0
              if (incomingPub !== prevPub) {
                if (incomingPub > prevPub) byId.set(it.id, it)
                // prev 发布新，客户端送来的是旧版 → 保留磁盘上的
              } else if (it.updatedAt >= prev.updatedAt) {
                byId.set(it.id, it)
              }
            }
            const mergedItems = [...byId.values()].sort(
              (a, b) => b.updatedAt - a.updatedAt,
            )
            const mergedDb = {
              version: 1,
              // activeId：尊重客户端的选择（他的会话在编辑哪个剧本，不该被别的客户端打扰）
              activeId: incoming.activeId ?? existing?.activeId ?? null,
              items: mergedItems,
            }

            writeScenarioDbFile(storage, mergedDb)
            return sendJson(res, 200, {
              ok: true,
              // 把合并后的结果送回 —— 前端能据此知道"哪些别人改了"并刷 UI
              merged: true,
              db: mergedDb,
              itemCount: mergedItems.length,
            })
          }
          return sendJson(res, 405, { error: 'method not allowed' })
        }

        // 版本文件路由：/versions/<scenarioId>/<versionId>
        //   POST/PUT  写入某版 scenario body（前端 publish 时调用）
        //   GET       读取某版 scenario body（前端回滚时调用）
        //
        // path 形态：'/versions/scn-xxx/v-yyy'
        const versionMatch = path.match(
          /^\/versions\/([^/]+)\/([^/]+)$/,
        )
        if (versionMatch) {
          const scenarioId = decodeURIComponent(versionMatch[1] ?? '')
          const versionId = decodeURIComponent(versionMatch[2] ?? '')
          if (!safeSegment(scenarioId) || !safeSegment(versionId)) {
            return sendJson(res, 400, { error: 'invalid id segment' })
          }
          if (method === 'GET') {
            const body = readVersionFile(storage, scenarioId, versionId)
            if (body == null) {
              return sendJson(res, 404, { error: 'version not found' })
            }
            return sendJson(res, 200, { scenario: body })
          }
          if (method === 'POST' || method === 'PUT') {
            const raw = (await readJsonBody(req)) as { scenario?: unknown }
            if (!raw || typeof raw !== 'object' || !raw.scenario) {
              return sendJson(res, 400, {
                error: 'missing `scenario` field in body',
              })
            }
            const body = JSON.stringify(raw.scenario)
            if (body.length > SCENARIO_MAX_BYTES) {
              return sendJson(res, 413, {
                error: `version body exceeds limit (${SCENARIO_MAX_BYTES} bytes)`,
              })
            }
            const ok = writeVersionFile(storage, scenarioId, versionId, raw.scenario)
            if (!ok) {
              return sendJson(res, 400, { error: 'invalid id segment' })
            }
            return sendJson(res, 201, { ok: true, scenarioId, versionId })
          }
          return sendJson(res, 405, { error: 'method not allowed' })
        }

        next()
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message })
      }
    })

    // ── Forge Queue endpoint ─────────────────────────────────────────────────
    // Agent submits script/idea text → frontend polls and feeds it into the
    // built-in forge pipeline (runForgeFromChat).
    //   GET  /__reel__/forge-queue  → returns pending item (or null)
    //   POST /__reel__/forge-queue  → stores a new forge request
    //   DELETE /__reel__/forge-queue → clears the queue (frontend consumed it)
    const FORGE_QUEUE_ROUTE = '/__reel__/forge-queue'
    server.middlewares.use(FORGE_QUEUE_ROUTE, async (req, res) => {
      try {
        const method = (req.method ?? 'GET').toUpperCase()
        const queueUrl = new URL(req.url ?? '/', 'http://localhost')
        const queueStorage = resolveStorage(gameSlugOf(queueUrl))
        const queuePath = resolve(queueStorage.rootDir, 'forge-queue.json')

        if (method === 'GET') {
          if (!existsSync(queuePath)) {
            return sendJson(res, 200, { item: null })
          }
          try {
            const raw = readFileSync(queuePath, 'utf-8')
            return sendJson(res, 200, { item: JSON.parse(raw) })
          } catch {
            return sendJson(res, 200, { item: null })
          }
        }

        if (method === 'POST') {
          const body = (await readJsonBody(req)) as {
            mode?: string
            text?: string
            title?: string
          } | null
          if (!body || !body.text || !body.mode) {
            return sendJson(res, 400, { error: 'mode and text required' })
          }
          const item = {
            mode: body.mode,
            text: body.text,
            title: body.title ?? undefined,
            createdAt: Date.now(),
          }
          writeFileSync(queuePath, JSON.stringify(item, null, 2))
          return sendJson(res, 201, { ok: true, item })
        }

        if (method === 'DELETE') {
          if (existsSync(queuePath)) {
            unlinkSync(queuePath)
          }
          return sendJson(res, 200, { ok: true })
        }

        return sendJson(res, 405, { error: 'method not allowed' })
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message })
      }
    })

    // ── Visual queue (agent → frontend) ──────────────────────────────────────
    // Agent submits "生成视觉锚点" via reel:generate-visuals → frontend polls and
    // runs the (non-destructive) anchor-extract + image pipeline on the active
    // scenario. Per-game scoped (visual-queue.json under the game's reel dir).
    //   GET  /__reel__/visual-queue  → returns pending item (or null)
    //   POST /__reel__/visual-queue  → stores a new visual request
    //   DELETE /__reel__/visual-queue → clears the queue (frontend consumed it)
    const VISUAL_QUEUE_ROUTE = '/__reel__/visual-queue'
    server.middlewares.use(VISUAL_QUEUE_ROUTE, async (req, res) => {
      try {
        const method = (req.method ?? 'GET').toUpperCase()
        const queueUrl = new URL(req.url ?? '/', 'http://localhost')
        const queueStorage = resolveStorage(gameSlugOf(queueUrl))
        const queuePath = resolve(queueStorage.rootDir, 'visual-queue.json')

        if (method === 'GET') {
          if (!existsSync(queuePath)) {
            return sendJson(res, 200, { item: null })
          }
          try {
            const raw = readFileSync(queuePath, 'utf-8')
            return sendJson(res, 200, { item: JSON.parse(raw) })
          } catch {
            return sendJson(res, 200, { item: null })
          }
        }

        if (method === 'POST') {
          const body = (await readJsonBody(req)) as {
            scope?: string
            scenarioId?: string
            force?: boolean
          } | null
          const item = {
            scope: body?.scope ?? 'anchors',
            scenarioId: body?.scenarioId ?? undefined,
            force: body?.force === true,
            createdAt: Date.now(),
          }
          writeFileSync(queuePath, JSON.stringify(item, null, 2))
          return sendJson(res, 201, { ok: true, item })
        }

        if (method === 'DELETE') {
          if (existsSync(queuePath)) {
            unlinkSync(queuePath)
          }
          return sendJson(res, 200, { ok: true })
        }

        return sendJson(res, 405, { error: 'method not allowed' })
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message })
      }
    })

    // ── Audition queue (agent → frontend) ────────────────────────────────────
    // Agent submits "生成试镜视频与音色" via reel:generate-auditions → frontend polls
    // (pollAuditionQueue → triggerAuditionFromQueue) and, for the target characters,
    // generates a 3:4/10s audition video from each turnaround sheet + extracts the
    // full audio track as an MP3 voice sample. Per-game scoped, single overwriting
    // item: { scope:'all'|'characters', characterIds?, scenarioId?, force? }.
    //   GET    /__reel__/audition-queue → { item | null }
    //   POST   /__reel__/audition-queue → store a new audition request
    //   DELETE /__reel__/audition-queue → clear the queue (frontend claimed it)
    const AUDITION_QUEUE_ROUTE = '/__reel__/audition-queue'
    server.middlewares.use(AUDITION_QUEUE_ROUTE, async (req, res) => {
      try {
        const method = (req.method ?? 'GET').toUpperCase()
        const queueUrl = new URL(req.url ?? '/', 'http://localhost')
        const queueStorage = resolveStorage(gameSlugOf(queueUrl))
        const queuePath = resolve(queueStorage.rootDir, 'audition-queue.json')

        if (method === 'GET') {
          if (!existsSync(queuePath)) {
            return sendJson(res, 200, { item: null })
          }
          try {
            const raw = readFileSync(queuePath, 'utf-8')
            return sendJson(res, 200, { item: JSON.parse(raw) })
          } catch {
            return sendJson(res, 200, { item: null })
          }
        }

        if (method === 'POST') {
          const body = (await readJsonBody(req)) as {
            scope?: string
            characterIds?: string[]
            scenarioId?: string
            force?: boolean
          } | null
          const item = {
            scope: body?.scope === 'characters' ? 'characters' : 'all',
            characterIds: Array.isArray(body?.characterIds) ? body!.characterIds : undefined,
            scenarioId: body?.scenarioId ?? undefined,
            force: body?.force === true,
            createdAt: Date.now(),
          }
          writeFileSync(queuePath, JSON.stringify(item, null, 2))
          return sendJson(res, 201, { ok: true, item })
        }

        if (method === 'DELETE') {
          if (existsSync(queuePath)) {
            unlinkSync(queuePath)
          }
          return sendJson(res, 200, { ok: true })
        }

        return sendJson(res, 405, { error: 'method not allowed' })
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message })
      }
    })

    // ── Storyboard queue (agent → frontend) ──────────────────────────────────
    // Agent submits "拆分镜" via reel:generate-storyboard → frontend polls
    // (pollStoryboardQueue → triggerStoryboardFromQueue) and runs the batch
    // storyboard engine (runActBatchUpgradeOnScenario) on the active scenario,
    // writing scene.shots[] + timeline placeholders. Single overwriting item
    // (like forge/visual): { scope:'scene'|'all', sceneId?, scenarioId? }.
    //   GET    /__reel__/storyboard-queue → { item | null }
    //   POST   /__reel__/storyboard-queue → store a new storyboard request
    //   DELETE /__reel__/storyboard-queue → clear the queue (frontend claimed it)
    const STORYBOARD_QUEUE_ROUTE = '/__reel__/storyboard-queue'
    server.middlewares.use(STORYBOARD_QUEUE_ROUTE, async (req, res) => {
      try {
        const method = (req.method ?? 'GET').toUpperCase()
        const queueUrl = new URL(req.url ?? '/', 'http://localhost')
        const queueStorage = resolveStorage(gameSlugOf(queueUrl))
        const queuePath = resolve(queueStorage.rootDir, 'storyboard-queue.json')

        if (method === 'GET') {
          if (!existsSync(queuePath)) {
            return sendJson(res, 200, { item: null })
          }
          try {
            const raw = readFileSync(queuePath, 'utf-8')
            return sendJson(res, 200, { item: JSON.parse(raw) })
          } catch {
            return sendJson(res, 200, { item: null })
          }
        }

        if (method === 'POST') {
          const body = (await readJsonBody(req)) as {
            scope?: string
            sceneId?: string
            scenarioId?: string
          } | null
          const item = {
            scope: body?.scope === 'all' ? 'all' : 'scene',
            sceneId: typeof body?.sceneId === 'string' ? body.sceneId : undefined,
            scenarioId: typeof body?.scenarioId === 'string' ? body.scenarioId : undefined,
            createdAt: Date.now(),
          }
          writeFileSync(queuePath, JSON.stringify(item, null, 2))
          return sendJson(res, 201, { ok: true, item })
        }

        if (method === 'DELETE') {
          if (existsSync(queuePath)) {
            unlinkSync(queuePath)
          }
          return sendJson(res, 200, { ok: true })
        }

        return sendJson(res, 405, { error: 'method not allowed' })
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message })
      }
    })

    // ── Keyframe queue (agent → frontend) ────────────────────────────────────
    // Agent submits "逐镜出关键帧" via reel:generate-keyframes → frontend polls
    // (pollKeyframeQueue → triggerKeyframeFromQueue) and generates one keyframe
    // per shot of the target scene (reusing the manual per-shot pipeline),
    // writing shot.keyframeMediaRef + keyShot sync. Single overwriting item:
    // { sceneId, scenarioId?, force? }.
    const KEYFRAME_QUEUE_ROUTE = '/__reel__/keyframe-queue'
    server.middlewares.use(KEYFRAME_QUEUE_ROUTE, async (req, res) => {
      try {
        const method = (req.method ?? 'GET').toUpperCase()
        const queueUrl = new URL(req.url ?? '/', 'http://localhost')
        const queueStorage = resolveStorage(gameSlugOf(queueUrl))
        const queuePath = resolve(queueStorage.rootDir, 'keyframe-queue.json')

        if (method === 'GET') {
          if (!existsSync(queuePath)) {
            return sendJson(res, 200, { item: null })
          }
          try {
            const raw = readFileSync(queuePath, 'utf-8')
            return sendJson(res, 200, { item: JSON.parse(raw) })
          } catch {
            return sendJson(res, 200, { item: null })
          }
        }

        if (method === 'POST') {
          const body = (await readJsonBody(req)) as {
            sceneId?: string
            scenarioId?: string
            force?: boolean
          } | null
          if (!body?.sceneId || typeof body.sceneId !== 'string') {
            return sendJson(res, 400, { error: 'sceneId required' })
          }
          const item = {
            sceneId: body.sceneId,
            scenarioId: typeof body.scenarioId === 'string' ? body.scenarioId : undefined,
            force: body.force === true,
            createdAt: Date.now(),
          }
          writeFileSync(queuePath, JSON.stringify(item, null, 2))
          return sendJson(res, 201, { ok: true, item })
        }

        if (method === 'DELETE') {
          if (existsSync(queuePath)) {
            unlinkSync(queuePath)
          }
          return sendJson(res, 200, { ok: true })
        }

        return sendJson(res, 405, { error: 'method not allowed' })
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message })
      }
    })

    // ── Produce-node queue (agent → frontend) ────────────────────────────────
    // Agent submits "一键产出节点" via reel:produce-node → frontend polls
    // (pollProduceNodeQueue → triggerProduceNodeFromQueue) and runs the whole
    // chain (storyboard → keyframes → video) on the target node, idempotent +
    // overridable. Single overwriting item: { sceneId, scenarioId?, stages?, force? }.
    const PRODUCE_NODE_QUEUE_ROUTE = '/__reel__/produce-node-queue'
    server.middlewares.use(PRODUCE_NODE_QUEUE_ROUTE, async (req, res) => {
      try {
        const method = (req.method ?? 'GET').toUpperCase()
        const queueUrl = new URL(req.url ?? '/', 'http://localhost')
        const queueStorage = resolveStorage(gameSlugOf(queueUrl))
        const queuePath = resolve(queueStorage.rootDir, 'produce-node-queue.json')
        const VALID_STAGES = ['storyboard', 'keyframes', 'video']

        if (method === 'GET') {
          if (!existsSync(queuePath)) {
            return sendJson(res, 200, { item: null })
          }
          try {
            const raw = readFileSync(queuePath, 'utf-8')
            return sendJson(res, 200, { item: JSON.parse(raw) })
          } catch {
            return sendJson(res, 200, { item: null })
          }
        }

        if (method === 'POST') {
          const body = (await readJsonBody(req)) as {
            sceneId?: string
            sceneIds?: unknown
            scope?: unknown
            count?: unknown
            scenarioId?: string
            stages?: unknown
            force?: boolean
          } | null
          const sceneIds = Array.isArray(body?.sceneIds)
            ? body!.sceneIds.filter((s): s is string => typeof s === 'string' && s.length > 0)
            : undefined
          const scope =
            body?.scope === 'all' || body?.scope === 'firstN' || body?.scope === 'node'
              ? body.scope
              : undefined
          const hasTarget =
            (typeof body?.sceneId === 'string' && body.sceneId.length > 0) ||
            (sceneIds && sceneIds.length > 0) ||
            scope === 'all' ||
            scope === 'firstN'
          if (!hasTarget) {
            return sendJson(res, 400, {
              error: 'target required: sceneId / sceneIds / scope(all|firstN)',
            })
          }
          const stages = Array.isArray(body!.stages)
            ? body!.stages.filter(
                (s): s is string => typeof s === 'string' && VALID_STAGES.includes(s),
              )
            : undefined
          const count =
            typeof body!.count === 'number' && body!.count >= 1
              ? Math.floor(body!.count)
              : undefined
          const item = {
            sceneId: typeof body!.sceneId === 'string' ? body!.sceneId : undefined,
            sceneIds: sceneIds && sceneIds.length > 0 ? sceneIds : undefined,
            scope,
            count,
            scenarioId: typeof body!.scenarioId === 'string' ? body!.scenarioId : undefined,
            stages: stages && stages.length > 0 ? stages : undefined,
            force: body!.force === true,
            createdAt: Date.now(),
          }
          writeFileSync(queuePath, JSON.stringify(item, null, 2))
          return sendJson(res, 201, { ok: true, item })
        }

        if (method === 'DELETE') {
          if (existsSync(queuePath)) {
            unlinkSync(queuePath)
          }
          return sendJson(res, 200, { ok: true })
        }

        return sendJson(res, 405, { error: 'method not allowed' })
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message })
      }
    })

    // ── Video queue (agent → frontend) ───────────────────────────────────────
    // Agent submits per-scene video jobs via reel:generate-video → frontend polls
    // (pollVideoQueue) and runs the SAME in-browser video pipeline the workbench
    // uses (createTask → videoTaskStore → poll → ingest → setSceneMediaRef VIDEO →
    // timeline). This is the only path that actually binds a video to a scene and
    // survives reloads (resumeRunningVideoTasks). Per-game scoped.
    //   GET    /__reel__/video-queue → { items: VideoQueueJob[] }
    //   POST   /__reel__/video-queue → append job(s); body = single job OR { jobs:[…] }
    //   DELETE /__reel__/video-queue → clear the queue (frontend claimed it)
    // Unlike forge/visual queues (single overwriting item), this is an APPEND
    // array so multiple jobs enqueued in quick succession don't clobber each other.
    const VIDEO_QUEUE_ROUTE = '/__reel__/video-queue'
    server.middlewares.use(VIDEO_QUEUE_ROUTE, async (req, res) => {
      try {
        const method = (req.method ?? 'GET').toUpperCase()
        const queueUrl = new URL(req.url ?? '/', 'http://localhost')
        const queueStorage = resolveStorage(gameSlugOf(queueUrl))
        const queuePath = resolve(queueStorage.rootDir, 'video-queue.json')

        const readItems = (): unknown[] => {
          if (!existsSync(queuePath)) return []
          try {
            const parsed = JSON.parse(readFileSync(queuePath, 'utf-8')) as {
              items?: unknown[]
            }
            return Array.isArray(parsed?.items) ? parsed.items : []
          } catch {
            return []
          }
        }

        if (method === 'GET') {
          return sendJson(res, 200, { items: readItems() })
        }

        if (method === 'POST') {
          const body = (await readJsonBody(req)) as
            | { jobs?: unknown[]; sceneId?: string }
            | null
          const incoming = Array.isArray(body?.jobs)
            ? body!.jobs
            : body
              ? [body]
              : []
          const now = Date.now()
          const jobs = incoming
            .filter(
              (j): j is Record<string, unknown> =>
                !!j && typeof j === 'object' && typeof (j as { sceneId?: unknown }).sceneId === 'string',
            )
            .map((j, i) => ({
              id:
                typeof j.id === 'string'
                  ? j.id
                  : `vq-${now.toString(36)}-${i}-${Math.random().toString(36).slice(2, 6)}`,
              scenarioId: typeof j.scenarioId === 'string' ? j.scenarioId : undefined,
              sceneId: j.sceneId as string,
              prompt: typeof j.prompt === 'string' ? j.prompt : undefined,
              durationSec: typeof j.durationSec === 'number' ? j.durationSec : undefined,
              size: typeof j.size === 'string' ? j.size : undefined,
              createdAt: now,
            }))
          if (jobs.length === 0) {
            return sendJson(res, 400, { error: 'at least one job with sceneId required' })
          }
          const items = [...readItems(), ...jobs]
          writeFileSync(queuePath, JSON.stringify({ items }, null, 2))
          return sendJson(res, 201, { ok: true, queued: jobs.length, items })
        }

        if (method === 'DELETE') {
          if (existsSync(queuePath)) unlinkSync(queuePath)
          return sendJson(res, 200, { ok: true })
        }

        return sendJson(res, 405, { error: 'method not allowed' })
      } catch (e) {
        sendJson(res, 500, { error: (e as Error).message })
      }
    })
  }

  return {
    name: 'reel-scenarios',
    apply: 'serve',
    configResolved(config) {
      baseRoot = resolve(config.root, '.reel-scenarios')
      storage = ensureScenarioStorage(baseRoot)
      projectRoot = findProjectRootWithForgeax(config.root)
      const stat = scenarioStatsOf(storage)
      const kb = (stat.bytes / 1024).toFixed(1)
      console.info(
        `[reel-scenarios] ${stat.count} item(s) · ${kb} KiB · ${storage.rootDir}` +
          (projectRoot ? ` · per-game→ ${resolve(projectRoot, '.forgeax/games')}` : ''),
      )
    },
    configureServer(server) {
      attach(server)
    },
  }
}

// ============================================================================
// reel-minigames 静态文件插件（inline）
// ============================================================================
// 把仓库内的 `src/minigames/**/*` 以 `/__minigames/**` 路由出去（仅 dev）。
// 这样 iframe 可以用 `<iframe src="/__minigames/magical-witch/game.html?embed=1" />`
// 内嵌小游戏而不用移动文件——作者仍在源码目录里迭代游戏本身。
//
// 只允许 GET。受 MIME 白名单约束，禁路径穿越。
// ============================================================================

const MINIGAMES_ROUTE_PREFIX = '/__minigames'
const MINIGAME_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.json': 'application/json; charset=utf-8',
}

function reelMinigamesPlugin(): Plugin {
  let rootDir = ''

  return {
    name: 'reel-minigames',
    apply: 'serve',
    configResolved(config) {
      rootDir = resolve(config.root, 'src/minigames')
      console.info(`[reel-minigames] serving ${rootDir} at ${MINIGAMES_ROUTE_PREFIX}/`)
    },
    configureServer(server) {
      server.middlewares.use(MINIGAMES_ROUTE_PREFIX, (req, res, next) => {
        try {
          const method = (req.method ?? 'GET').toUpperCase()
          if (method !== 'GET' && method !== 'HEAD') {
            res.statusCode = 405
            res.end('method not allowed')
            return
          }
          // 剥掉查询串
          const urlPath = decodeURIComponent(
            (req.url ?? '/').split('?')[0] ?? '/',
          )
          // 防路径穿越：禁 ".." 段
          if (urlPath.split('/').some((seg) => seg === '..')) {
            res.statusCode = 400
            res.end('bad request')
            return
          }
          const filePath = resolve(rootDir, '.' + urlPath)
          // 确保 resolve 后依旧在 rootDir 内
          if (!filePath.startsWith(rootDir + '/') && filePath !== rootDir) {
            res.statusCode = 403
            res.end('forbidden')
            return
          }
          if (!existsSync(filePath)) {
            return next()
          }
          const stat = statSync(filePath)
          if (stat.isDirectory()) {
            return next()
          }
          const ext = (filePath.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase()
          const mime = MINIGAME_MIME[ext] ?? 'application/octet-stream'
          res.setHeader('content-type', mime)
          res.setHeader('content-length', String(stat.size))
          // 这些文件偶有改动，但不走 HMR；让浏览器短期缓存即可
          res.setHeader('cache-control', 'no-cache')
          if (method === 'HEAD') {
            res.statusCode = 200
            res.end()
            return
          }
          res.statusCode = 200
          res.end(readFileSync(filePath))
        } catch (e) {
          res.statusCode = 500
          res.end((e as Error).message)
        }
      })
    },
  }
}

