/**
 * Browser-side video generation contract.
 *
 * 浏览器的生成 transport 是同源 `/api/v1/kino/generations`（见
 * `kino-generation-client.ts`）。这里只保留请求/任务形状，不再持有 Workbench
 * Host tool 的提交实现：Host tool `wb-game-video:generate-video-clip` 仍然存在，
 * 但只服务 Agent/MCP 调用方，由 server 侧 handler 承载。
 */

export type KinoVideoSize = '2560x1440' | '1440x2560' | '2496x1664' | '1664x2496'
export type KinoVideoResolution = '720p' | '1080p'
export type VideoGenerationStatus =
  | 'pending'
  | 'submitting'
  | 'polling'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface ClipGenerationRequest {
  /** 当前 Workbench handshake 提供的 gameId。 */
  gameSlug: string
  prompt: string
  durationSeconds: number
  generateAudio: boolean
  mode: 'strict' | 'firstref' | 'ref' | 't2v'
  /** Kino resource id；直连生成以 Kino 资源标识引用参考图。 */
  firstFrameResourceId?: string
  lastFrameResourceId?: string
  referenceImageResourceIds?: string[]
  size?: KinoVideoSize
  resolution?: KinoVideoResolution
  model?: string
  visualStyleKey?: string
  label?: string
}

export interface VideoGenerationTask {
  generationId: string
  status: VideoGenerationStatus
  prompt?: string
  model?: string
  providerTaskId?: string
  /** Kino 直出的可播放地址，`<video>` 可直接使用。 */
  resultUrl?: string
  resourceId?: string
  errorCode?: string
  errorMessage?: string
  createdAt?: number
}
