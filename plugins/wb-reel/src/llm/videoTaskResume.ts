/**
 * `resumeRunningVideoTasks` —— 应用启动时"接盘"未完成任务。
 *
 * 为什么要做：
 *   · 作者反馈："我在视频生成点击视频生成，翻了个页面，回来就没进度了"
 *   · `videoTaskStore` 已把任务卡片 persist 进 localStorage；本函数在 App
 *     mount 时扫描所有 status ∈ {queued, generating, downloading} 的任务，
 *     重新对对应 Provider 起 poll 循环，把结果回写 store。
 *
 * 支持两种 Provider（2026-06 退役本机 Python Flask 后端后）：
 *   · providerKind === 'local'     → HostGatewayVideoProvider 接盘（宿主 litellm 网关）
 *   · providerKind === 'seedance'  → SeedanceProvider 接盘（直连火山方舟）
 *   · 没有 providerKind 的老任务视作 'local'（嵌入态默认走宿主网关）
 *
 * 使用约定：
 *   · 只在 App.tsx 顶层 useEffect(() => { resumeRunningVideoTasks(...) }, [])
 *   · 需要 settingsStore 里的 videoConfig（seedance 路径要 apiKey），
 *     没 apiKey → seedance 接盘失败，标记 interrupted
 *   · resume 期间出现任何错误一律 patch 进 store，不再 throw
 */
import { SeedanceProvider, type VideoTaskProvider } from './VideoProvider'
import { HostGatewayVideoProvider } from './HostGatewayVideoProvider'
import type { VideoConfig } from '../scenario/types'
import type { VideoTaskStatus } from './videoTaskStore'
import { isTerminal, useVideoTaskStore } from './videoTaskStore'

interface ResumeOptions {
  /** 可选：传入当前的 videoConfig，用来拿 apiBase；默认用空字符串（相对路径） */
  videoConfig?: VideoConfig
  /** 诊断回调 */
  onLog?: (msg: string) => void
}

export function resumeRunningVideoTasks(opts: ResumeOptions = {}): void {
  const tasks = useVideoTaskStore.getState().tasks
  const pending = Object.values(tasks).filter((t) => !isTerminal(t.status))
  if (pending.length === 0) return

  // 按 providerKind 分桶，一次构造 provider 给同类任务复用
  const byKind: Record<'local' | 'seedance', string[]> = {
    local: [],
    seedance: [],
  }
  for (const t of pending) {
    const kind = t.providerKind ?? 'local'
    byKind[kind].push(t.taskId)
  }

  opts.onLog?.(
    `[videoTaskResume] 接盘 local=${byKind.local.length} seedance=${byKind.seedance.length}`,
  )

  // local 分支 —— 宿主 litellm 视频网关接盘（同源 /__ce-api__/video-status）
  if (byKind.local.length > 0) {
    const host = new HostGatewayVideoProvider({
      durationSec: opts.videoConfig?.durationSec,
    })
    for (const taskId of byKind.local) {
      void _resumeOne(host, taskId, opts.onLog)
    }
  }

  // seedance 分支 —— 必须有 apiKey；没 key 就标 interrupted（任务还活着，
  // 但这台浏览器没法继续跟；用户重配 key 后下次启动还能接上）
  if (byKind.seedance.length > 0) {
    if (!opts.videoConfig?.apiKey) {
      const { patch } = useVideoTaskStore.getState()
      for (const taskId of byKind.seedance) {
        patch(taskId, {
          status: 'interrupted',
          error: '缺少 Seedance apiKey，无法在本机继续轮询',
          lastMessage: '缺 apiKey · 已放弃接盘',
        })
      }
      opts.onLog?.(
        `[videoTaskResume] ! seedance 任务 ${byKind.seedance.length} 个缺 apiKey，已标 interrupted`,
      )
    } else {
      const seedance = new SeedanceProvider({
        provider: 'seedance',
        apiKey: opts.videoConfig.apiKey,
        apiBase: opts.videoConfig.apiBase,
        model: opts.videoConfig.model,
      } as VideoConfig)
      for (const taskId of byKind.seedance) {
        void _resumeOne(seedance, taskId, opts.onLog)
      }
    }
  }
}

async function _resumeOne(
  provider: VideoTaskProvider,
  taskId: string,
  onLog?: (msg: string) => void,
): Promise<void> {
  const { patch } = useVideoTaskStore.getState()
  try {
    const result = await provider.pollTask(taskId, {
      onUpdate: (t) => {
        patch(taskId, {
          status: t.status as VideoTaskStatus,
          apiStatus: t.api_status,
          lastMessage: `${t.status}${t.api_status ? ` · ${t.api_status}` : ''}`,
        })
      },
    })
    if (result.status === 'completed' && result.videoUrl) {
      patch(taskId, {
        status: 'completed',
        videoUrl: result.videoUrl,
        lastMessage: '完成',
      })
      onLog?.(`[videoTaskResume] ✓ ${taskId} 完成`)
    } else {
      patch(taskId, {
        status: result.status,
        error: result.error,
        lastMessage: result.error ?? result.status,
      })
      onLog?.(`[videoTaskResume] ✗ ${taskId} ${result.status}`)
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    patch(taskId, {
      status: 'failed',
      error: (e as Error).message,
      lastMessage: (e as Error).message,
    })
    onLog?.(`[videoTaskResume] ! ${taskId} ${(e as Error).message}`)
  }
}
