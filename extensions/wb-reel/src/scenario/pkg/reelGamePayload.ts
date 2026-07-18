/**
 * reel-game 资产载荷（payload）的共享形状 + 提取纯函数。
 *
 * 落盘格式：`ReelLevel.pack.json` = `internal-text-package`，内含单条
 * `kind:'reel-game'` 资产，其 `payload` 即本文件约定的结构（见 ReelGamePayload）。
 * 这是 host 自有的数据 kind（引擎闭合 Asset union 不含它）。
 *
 * 消费方式已定为 host React FMV（不做 importer、不需要引擎 loaders.register）；
 * 下列消费端共用同一 payload 约定，必须保持一致：
 *   - 导出器 buildReelGameAsset（把 Scenario 包成 payload 写进 ReelLevel.pack.json）。
 *   - 独立站点读取器 loadReelGameFromPackIndex（?src=pack 时纯 fetch 取回喂 scenarioStore）。
 *   - 预览态 bootScenarioPersist（从 workbench/reel 读同一棵 Scenario 喂 scenarioStore）。
 *   -〔暂缓〕引擎 runtime 的 loadByGuid loader——仅当影游将来内嵌进引擎 3D/场景才需要，
 *     届时照 engine `reel-game-blob` 参考补 `loaders.register`，磁盘格式不变。
 *
 * payload 自包含：`scenario` 是整棵 wb-reel Scenario JSON，其中媒体引用已被
 * 改写成 bundle 相对 URL（./reel-media/<hash>.<ext>）。
 */

export const REEL_GAME_SCHEMA_VERSION = 1

/**
 * 影游剧本的「结构骨架」最小契约。
 *
 * charter「Schema-as-Contract」红线：不再让进出 payload 的剧本停留在裸
 * `Record<string,unknown>`。这里只钉死 runtime 寻路真正依赖的骨架字段，
 * 其余（`src/scenario/types.ts` 的 `Scenario` 1700 行类型）的长尾通过索引签名
 * 宽松放行——避免与可机读 schema（`schema/reelScenario.schema.json`）逐字段漂移。
 * 真正的 fail-fast 校验在 `schema/validateScenario.ts`（ajv）。
 */
export interface ReelScenarioLike {
  id: string
  title: string
  rootSceneId: string
  /** 1..8，见 types.ts Scenario.schemaVersion。 */
  schemaVersion: number
  defaultCharMs: number
  scenes: Record<string, unknown>
  [key: string]: unknown
}

export interface ReelGamePayload {
  schemaVersion: number
  scenario: ReelScenarioLike
}

/** 把一棵 Scenario 包成带 schemaVersion 的 reel-game payload。 */
export function makeReelGamePayload(scenario: ReelScenarioLike): ReelGamePayload {
  return { schemaVersion: REEL_GAME_SCHEMA_VERSION, scenario }
}

/**
 * 从一个 payload 结构性取回 Scenario；形状不合法（非对象 / 缺 scenario）时返回 null。
 *
 * 这是「松」提取：只确认 `payload.scenario` 是个对象，**不**做 schema 校验。
 * 需要 fail-fast 的边界（loader 读取 / 导出落盘）请用
 * `schema/validateScenario.ts` 的 `extractValidatedScenario` / `assertReelScenario`。
 */
export function extractScenario(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null) return null
  const s = (payload as Record<string, unknown>).scenario
  if (typeof s !== 'object' || s === null) return null
  return s as Record<string, unknown>
}
