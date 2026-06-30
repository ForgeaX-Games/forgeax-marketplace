/**
 * reel-game 资产载荷（payload）的共享形状 + 提取纯函数。
 *
 * 这是「互动影游作为引擎资产（Route B）」里 reel-game.pack.json 的 `payload`
 * 字段约定，被三处共用，必须保持一致：
 *   - 引擎 runtime 的 reelGameLoader（把 payload 解析成 ReelGameAsset POD）。
 *   - 服务端导出器 buildReelGameAsset（把 Scenario 包成 payload 写进 pack.json）。
 *   - 独立播放器的 WebGPU-free 读取器 loadReelGameFromPackIndex。
 *
 * payload 自包含：`scenario` 是整棵 wb-reel Scenario JSON，其中媒体引用已被
 * 改写成 bundle 相对 URL（./reel-media/<hash>.<ext>），引擎只负责寻址+分发。
 */

export const REEL_GAME_SCHEMA_VERSION = 1

export interface ReelGamePayload {
  schemaVersion: number
  scenario: Record<string, unknown>
}

/** 把一棵 Scenario 包成带 schemaVersion 的 reel-game payload。 */
export function makeReelGamePayload(scenario: Record<string, unknown>): ReelGamePayload {
  return { schemaVersion: REEL_GAME_SCHEMA_VERSION, scenario }
}

/**
 * 从一个 payload 取回 Scenario；形状不合法（非对象 / 缺 scenario）时返回 null，
 * 由调用方决定如何报错（charter P3 显式失败）。
 */
export function extractScenario(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null
  const s = (payload as Record<string, unknown>).scenario
  if (typeof s !== 'object' || s === null) return null
  return s as Record<string, unknown>
}
