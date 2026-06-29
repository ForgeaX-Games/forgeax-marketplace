/**
 * renderTarget.ts —— `?surface=render` 离屏渲染面的纯参数解析（无 React/DOM 副作用，可单测）。
 *
 * 录制器（headless 浏览器）会导航到：
 *   /?surface=render&scn=<scenarioId>&scene=<sceneId>&w=1920&h=1080&fps=30
 * 本模块把这些 query 解析成强类型的渲染目标，统一默认值，给 RenderStage 与录制脚本共用。
 */

export interface RenderParams {
  /** 要渲染的 scenario id（缺省走当前激活剧本） */
  scenarioId?: string
  /** 要渲染的 scene id（缺省走 rootSceneId） */
  sceneId?: string
  /** 画布宽（px） */
  width: number
  /** 画布高（px） */
  height: number
  /** 目标帧率（fps），录制器按它步进时钟 */
  fps: number
}

export const RENDER_DEFAULTS = {
  width: 1920,
  height: 1080,
  fps: 30,
} as const

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n)) return fallback
  return n < min ? min : n > max ? max : n
}

/** 解析渲染面 query（接受 `?a=b` 或裸 `a=b`）。 */
export function parseRenderParams(search: string): RenderParams {
  const qs = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const scenarioId = qs.get('scn')?.trim() || undefined
  const sceneId = qs.get('scene')?.trim() || undefined
  return {
    scenarioId,
    sceneId,
    width: clampInt(qs.get('w'), RENDER_DEFAULTS.width, 16, 7680),
    height: clampInt(qs.get('h'), RENDER_DEFAULTS.height, 16, 4320),
    fps: clampInt(qs.get('fps'), RENDER_DEFAULTS.fps, 1, 120),
  }
}

/**
 * 由帧率与时长算总帧数（含首帧 t=0）。录制器据此逐帧 seek。
 * durationMs 向上取整到帧边界，保证片尾不被截断。
 */
export function frameCount(durationMs: number, fps: number): number {
  if (durationMs <= 0 || fps <= 0) return 1
  return Math.max(1, Math.ceil((durationMs / 1000) * fps))
}

/** 第 i 帧（0-based）对应的场景时间（ms）。 */
export function frameTimeMs(frameIndex: number, fps: number): number {
  if (fps <= 0) return 0
  return (frameIndex * 1000) / fps
}
