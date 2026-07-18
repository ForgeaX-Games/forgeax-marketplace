/**
 * ReelLevel —— 影游「成品资产」清单的契约类型（**纯类型，浏览器安全**，无 node 依赖）。
 *
 * 定位（与主程对齐，引擎钦定路径，零改 engine）：
 *   - 成品落在 `assets/ReelLevel.pack.json`，形态是引擎的 **InternalTextPackage**
 *     （`kind:'internal-text-package'`）。这是「纯 host JSON payload」的正解：
 *     它没有 import/cook 步骤（不像 image→texture / gltf→mesh 的 ExternalAssetPackage），
 *     因此**不该**配 `.meta.json` 走 ExternalAssetPackage——给纯 JSON 造一个
 *     「只是把 JSON 抄过去」的 importer 是概念错配。
 *   - 单条资产 `kind:'reel-game'`（host 自定，引擎不约束 kind 取值），payload 即整棵
 *     已蒸馏的 Scenario（媒体引用改写为 bundle 相对 `./reel-media/<hash>.<ext>`）。
 *   - runtime 侧 host 用 `loaders.register({ kind:'reel-game', load })`（主程 #503 LoaderRegistry）
 *     注册自定义加载器，之后 `loadByGuid(guid)` 即可拿到 payload——无需改引擎 Asset 联合体。
 *
 * 红线：
 *   - `refs` 即使为空也**必须**写 `[]`（build-catalog / collect-refs 要求字段存在）。
 *   - 不在 `forge.json` 里塞 `reelGameGuid`（forge.json 是 `.strict()` schema，未知字段会被拒）；
 *     入口 GUID 存在本清单 / wb-reel 元数据里。
 *
 * 本文件只声明结构，不碰磁盘——磁盘路径见同目录 `gameLayout.ts`（node/build 专用）。
 */

/** 引擎 InternalTextPackage 的固定外壳标识。 */
export const INTERNAL_TEXT_PACKAGE_KIND = 'internal-text-package' as const

/** 成品清单文件名（落在 game 的 `assets/` 下）。 */
export const REEL_LEVEL_MANIFEST_FILENAME = 'ReelLevel.pack.json' as const

/** 影游成品在 InternalTextPackage 内的资产 kind（host 自定，引擎不约束）。 */
export const REEL_GAME_ASSET_KIND = 'reel-game' as const

/** 当前清单 schema 版本（与引擎 pack schemaVersion 对齐）。 */
export const REEL_LEVEL_SCHEMA_VERSION = '1.0.0' as const

/**
 * InternalTextPackage 里的单条资产。
 *
 * @typeParam P payload 形态（影游成品里就是已蒸馏的 Scenario）。
 */
export interface ReelLevelAsset<P = unknown> {
  /** 资产 GUID（稳定身份，跨重导出复用，loadByGuid 用它）。 */
  guid: string
  /** host 自定 kind，影游成品恒为 `'reel-game'`。 */
  kind: string
  /** 展示名（可选；当前构建器会填 scenario.title）。 */
  name?: string
  /** 资产负载：整棵已蒸馏 Scenario（媒体引用已 bundle 相对化）。 */
  payload: P
  /** 引擎依赖图边——**字段必须存在**，无依赖也写 `[]`。 */
  refs: string[]
}

/**
 * `ReelLevel.pack.json` 顶层结构（一个 InternalTextPackage）。
 *
 * 与 `scenario/pkg/buildReelGameAsset.ts` 的 `ReelGamePackFile` 结构同构——
 * 后者将在 phase1-export 切换为引用本契约类型，避免类型漂移。
 */
export interface ReelLevelPack<P = unknown> {
  schemaVersion: typeof REEL_LEVEL_SCHEMA_VERSION
  kind: typeof INTERNAL_TEXT_PACKAGE_KIND
  assets: Array<ReelLevelAsset<P>>
}

/**
 * 从单条影游资产构造一份合法的 ReelLevel 清单外壳。
 * 纯函数、无副作用——构建器拼好 payload/refs 后调用即可。
 */
export function makeReelLevelPack<P>(asset: ReelLevelAsset<P>): ReelLevelPack<P> {
  return {
    schemaVersion: REEL_LEVEL_SCHEMA_VERSION,
    kind: INTERNAL_TEXT_PACKAGE_KIND,
    assets: [{ ...asset, refs: asset.refs ?? [] }],
  }
}
