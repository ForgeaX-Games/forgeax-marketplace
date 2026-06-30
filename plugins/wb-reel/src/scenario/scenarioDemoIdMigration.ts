import type { Scenario } from './types'
import type { PersistedDb, PersistedItem } from './scenarioPersist'
import { getDemoScenario } from './demoScenario'
import { isBuiltinDemo } from './forgeIntent'

/**
 * 一次性数据迁移 —— 修复 v6.7 之前 adoptForgedScenario 烙旧 id 留下的串台。
 *
 * 历史 bug:
 *   v6.7 以前 adoptForgedScenario 把 forge 出的新剧本无脑改成 current.id;
 *   用户在内置 demo 上锻造新剧本 → 新剧本被烙成 demo-001, 把雨夜样板从磁盘
 *   挤掉 (PersistedDb 里 id=demo-001 的 item.scenario 已经不是雨夜了),
 *   还让该新剧本与雨夜共享 .reel-assets/manifest.json 的同 scenarioId 命名空间,
 *   旧 intro 图持续污染。
 *
 * 修复策略 (启动一次性):
 *   1. 在 PersistedDb 里找 id === 'demo-001' 的 item
 *   2. 如果它的 scenario **不是**雨夜样板 (title / scene 结构不匹配)
 *      → 给它新分配一个 sn-migrated-<ts> id, 同步把 versions / lastPublishedBy 等
 *        引用一起迁移; 雨夜样板会被 refreshBuiltinDemoInDb 用 bundled 重新塞进 db
 *   3. 返回需要在 manifest 里把 scenarioId='demo-001' 改成新 id 的资产 id 列表
 *      (雨夜真正属于 demo-001 的资产保留, 因为雨夜样板自己也是 demo-001;
 *       这里靠 sceneId 区分: 雨夜样板的 scene 是 intro/knock/pry/ending_*,
 *       新剧本的 scene 是 scene_001/scene_002/...)
 *
 *   纯函数. asset 改名 / 落盘交给调用方 (scenarioPersistBoot).
 */

const BUILTIN_DEMO_ID = 'demo-001'

/**
 * 雨夜样板的所有 sceneId. 用于在 manifest.json 里区分:
 *   meta.scenarioId === 'demo-001' && sceneId 不在这个集合里 → 是被串台的新剧本资产
 */
function getBuiltinDemoSceneIds(): Set<string> {
  return new Set(Object.keys(getDemoScenario().scenes))
}

export interface ScenarioDemoIdMigrationResult {
  /** 迁移后的 db (没动就和入参引用相等) */
  db: PersistedDb
  /** 是否做了迁移 */
  migrated: boolean
  /** 被迁移的剧本: 旧 id (永远是 demo-001) → 新 id */
  oldId?: string
  newId?: string
  /**
   * manifest.json 里需要把 meta.scenarioId 从 oldId patch 成 newId 的 asset 判定函数.
   * 调用方拿到这个 predicate, 拉 assetStore.records, 找出命中条目逐个 patch.
   *
   * 判定规则: meta.scenarioId === oldId && sceneId 不在雨夜样板的 sceneId 集合里.
   * 雨夜样板自己用过的 sceneId (intro / knock / pry / ending_*) 留在 demo-001
   * 名下, 因为 refreshBuiltinDemoInDb 会把雨夜样板重新塞回 demo-001.
   */
  shouldRelabelAsset?: (asset: { meta?: { scenarioId?: string; sceneId?: string } }) => boolean
}

export function migrateBuiltinDemoIdCollision(
  db: PersistedDb,
  options?: { now?: number },
): ScenarioDemoIdMigrationResult {
  const idx = db.items.findIndex((it) => it.id === BUILTIN_DEMO_ID)
  if (idx < 0) return { db, migrated: false }

  const existing = db.items[idx]
  if (!existing) return { db, migrated: false }

  // 已经是雨夜样板 → 没串台, 不动
  if (isBuiltinDemo(existing.scenario)) return { db, migrated: false }

  // 没题目就当成已经损坏, 也走迁移分支 (用空 title 总比丢失好)
  const now = options?.now ?? Date.now()
  // 后缀加随机, 防同 boot 内多次重 boot 撞名 (StrictMode / HMR)
  const newId = `sn-migrated-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`

  // 重写 item: id / scenario.id 两处
  const renamed: PersistedItem = {
    ...existing,
    id: newId,
    scenario: { ...existing.scenario, id: newId },
  }

  const nextItems = db.items.slice()
  nextItems[idx] = renamed

  // db.activeId 如果原来指向 demo-001 → 也改成新 id, 保证启动后用户看到的还是
  // 自己最近编辑的那个剧本 (不会被 pickActive 兜底到一个意外条目)
  const nextActiveId = db.activeId === BUILTIN_DEMO_ID ? newId : db.activeId

  // 雨夜样板会在 refreshBuiltinDemoInDb 阶段被 bundled 重新插入 db, 所以这里
  // 不需要主动补; 留给 refreshBuiltinDemoInDb 处理是为了避免逻辑分叉。
  const builtinSceneIds = getBuiltinDemoSceneIds()
  const shouldRelabelAsset: ScenarioDemoIdMigrationResult['shouldRelabelAsset'] = (asset) => {
    const m = asset.meta ?? {}
    if (m.scenarioId !== BUILTIN_DEMO_ID) return false
    // 没 sceneId 的 asset (e.g. 角色三视图 / 道具参考图) 当成"剧本级",
    // 也跟着新剧本走. 雨夜 demo 没生成过这类 asset, 落到新剧本不会冲突。
    if (!m.sceneId) return true
    return !builtinSceneIds.has(m.sceneId)
  }

  return {
    db: { ...db, items: nextItems, activeId: nextActiveId },
    migrated: true,
    oldId: BUILTIN_DEMO_ID,
    newId,
    shouldRelabelAsset,
  }
}
