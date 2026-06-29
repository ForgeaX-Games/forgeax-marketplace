import { useScenarioStore } from './scenarioStore'
import { getDemoScenario, BUNDLED_DEMO_ID } from './demoScenario'
import { makeBlankScenario } from './blankScenario'
import type { Scenario } from './types'
import {
  loadDb,
  mergeDbs,
  pickActive,
  removeFromDb,
  saveDb,
  setActive,
  upsertScenario,
  type PersistedDb,
  type PersistedItem,
} from './scenarioPersist'
import {
  loadDbFromDisk,
  probeDiskAvailable,
  saveDbToDisk,
} from './scenarioDiskStore'
import {
  exportDbToJson,
  importDbFromJson,
} from './scenarioTransfer'
import { migrateBuiltinDemoIdCollision } from './scenarioDemoIdMigration'
import { captureTrashOnChange } from './scenarioTrash'
import { gameQuery, getGameSlug, gameKeySuffix } from '../shell/gameScope'

/**
 * 一次性"磁盘权威"对账纪元。
 *
 * 背景：localStorage 与磁盘历来是 union 合并（mergeDbs），删除不会跨层传播。
 * 早期"按 game 隔离"上线时，全局老剧本一度被 merge 进某些 game 的库，之后每次
 * 重启 hydrate 又把它们焊回来。提升此纪元号 → 对应作用域在下一次 hydrate 时
 * 直接以（已清理的）磁盘为准、丢弃本地缓存，且每个作用域只执行一次。
 *
 * 仅在"成功读到磁盘"后才执行，故不会因磁盘瞬时不可用而清空本地。
 */
const DISK_RECONCILE_EPOCH = 4

function reconcileEpochKey(): string {
  return `reel-studio:reconcile-epoch${gameKeySuffix()}`
}

function needsDiskReconcile(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(reconcileEpochKey())
    const n = raw ? Number.parseInt(raw, 10) : 0
    return !Number.isFinite(n) || n < DISK_RECONCILE_EPOCH
  } catch {
    return false
  }
}

function markDiskReconciled(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(reconcileEpochKey(), String(DISK_RECONCILE_EPOCH))
  } catch {
    /* best-effort */
  }
}

/**
 * 当前是否处于"按 game 隔离"的作用域（iframe URL 带 slug）。
 *
 * per-game 作用域遵循总工程标准：新建 game = 干净空白，绝不注入内置 demo、
 * 也绝不把全局老剧本 seed 进来。只有"无 slug 的全局库"保留历史 demo 行为，
 * 以兼容老数据和既有单测（测试环境无 slug）。
 */
function isPerGameScope(): boolean {
  return getGameSlug() !== null
}
import { triggerForgeFromQueue, abortForgeQueue, type ForgeQueueItem } from '../forge/forgeQueueTrigger'
export { abortForgeQueue }
import { triggerVisualFromQueue, abortVisualQueue, type VisualQueueItem } from '../forge/visualQueueTrigger'
import { triggerAuditionFromQueue, abortAuditionQueue, type AuditionQueueItem } from '../forge/auditionQueueTrigger'
import { triggerStoryboardFromQueue, type StoryboardQueueItem } from '../forge/storyboardQueueTrigger'
import { triggerKeyframeFromQueue, type KeyframeQueueItem } from '../forge/keyframeQueueTrigger'
import { triggerProduceNodeFromQueue, type ProduceNodeQueueItem } from '../forge/produceNode'
import { triggerVideoFromQueue, type VideoQueueJob } from '../forge/videoQueueTrigger'
export { abortVisualQueue }
export { abortAuditionQueue }

/**
 * 剧本持久化适配器（单机版）——
 *   - boot()  : 启动时读 localStorage 恢复最近一份
 *   - 订阅   : 订阅 scenarioStore.scenario 变化，立即+ debounce 双写到 localStorage 和磁盘
 *   - 工具   : list/load/remove，让顶栏的"历史"下拉直接驱动
 *
 * 模块级单例（_db / _timer），跟 zustand store 一样在浏览器端只 init 一次。
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 行为模型：实时同步
 *   - 任意 scenario 变化 → 立即写 localStorage（防刷新丢数据）
 *   - debounce 800ms 后再推一次磁盘（`.reel-scenarios/` 目录里的 db.json）
 *   - 启动时若磁盘可用，会做一次 hydrate：把磁盘里的 db merge 进 localStorage
 *
 * 磁盘镜像在生产 dev server 下可用（vite 的 reelScenariosPlugin），静态 bundle
 * 时静默降级为只用 localStorage。
 * ───────────────────────────────────────────────────────────────────────────
 */

let _db: PersistedDb | null = null
let _timer: ReturnType<typeof setTimeout> | null = null
let _pollTimer: ReturnType<typeof setInterval> | null = null
let _booted = false
/** 磁盘镜像是否可用（null = 尚未探测 / false = 静态环境 / true = 插件 OK） */
let _diskAvailable: boolean | null = null
/** 当前 hydrate 的 Promise —— 测试用，生产不应 await（会阻塞 UI） */
let _hydratePromise: Promise<void> | null = null
/**
 * 启动时通过 boot 选项传入的"用户期望优先加载这本剧本" id（来自 URL ?scn= 或
 * localStorage lastEditedId，由 sessionRoute 决定）。
 */
let _preferredId: string | undefined = undefined
/**
 * hydrate gate —— hydrate 完成前禁止把 store 里的内容推磁盘，避免空壳覆盖。
 *
 * 背景：zustand store 初值是 bundled demoScenario（空壳），任何变化都会触发
 * subscribe 写盘。如果磁盘里其实有更"丰满"的版本，等 hydrate 回来时已经被空壳
 * 顶过几次。所以 hydrate 完成前，写入只走 localStorage（本机动作，不污染磁盘）。
 */
let _hydrateReady = false
/** 抑制下一次 store 订阅回调写盘 —— 用于系统驱动的 loadScenario（boot/hydrate）。 */
let _suppressWrite = false

const DEBOUNCE_MS = 800

/**
 * 修复 scenes 字段：array → dict，以及 spread 残留 {"0":..,"1":..} → proper keys。
 * 在 boot 阶段一次性遍历所有 db items，确保后续代码可以安全地 Object.entries/keys。
 */
function normalizeDbScenes(db: PersistedDb): PersistedDb {
  let changed = false
  const items = db.items.map((item) => {
    const scenes = item.scenario.scenes as unknown
    let normalized: Record<string, unknown> | null = null

    if (Array.isArray(scenes)) {
      // Direct array form: [{id:"s1",...}, {id:"s2",...}]
      normalized = {}
      for (const s of scenes as Array<Record<string, unknown>>) {
        if (s && typeof s === 'object' && typeof s.id === 'string') {
          normalized[s.id as string] = s
        }
      }
    } else if (scenes && typeof scenes === 'object') {
      // Check for spread-of-array residue: keys are "0","1","2"... but values have .id
      const keys = Object.keys(scenes as Record<string, unknown>)
      if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
        const entries = Object.values(scenes as Record<string, unknown>)
        const allHaveId = entries.every(
          (v) => v && typeof v === 'object' && typeof (v as Record<string, unknown>).id === 'string',
        )
        if (allHaveId) {
          normalized = {}
          for (const v of entries) {
            const id = (v as Record<string, unknown>).id as string
            normalized[id] = v
          }
        }
      }
    }

    if (!normalized) return item
    changed = true
    return {
      ...item,
      scenario: { ...item.scenario, scenes: normalized } as typeof item.scenario,
    }
  })

  if (!changed) return db
  const result = { ...db, items }
  saveDb(result)
  return result
}

/**
 * 修正被 bundled demo 抢占的 activeId。
 *
 * 根因：boot 首屏 store=bundled demo，subscribe 写回会让 upsertScenario 把
 * activeId 设成 demo-001，覆盖作者真实 active —— 自我强化的腐蚀循环，重启后
 * 工坊永远回退 demo。
 *
 * 不变式：只要 db 里存在 demo 之外的真实剧本，activeId 就不得停在 bundled demo。
 * 修正时回落到「最近编辑（updatedAt 最大）的真实剧本」。
 *
 * 纯函数：不写盘，返回新 db（或原 db 引用，若无需修正）。
 */
export function correctDemoUsurpedActiveId(db: PersistedDb): PersistedDb {
  if (db.activeId !== BUNDLED_DEMO_ID) return db
  const realItems = db.items.filter((it) => it.id !== BUNDLED_DEMO_ID)
  if (realItems.length === 0) return db // 只有 demo，保持现状
  const mostRecent = realItems.reduce((a, b) =>
    b.updatedAt > a.updatedAt ? b : a,
  )
  return { ...db, activeId: mostRecent.id }
}

export interface BootScenarioPersistOptions {
  preferredScenarioId?: string
}export function bootScenarioPersist(
  options: BootScenarioPersistOptions = {},
): () => void {
  _preferredId = options.preferredScenarioId
  _db = loadDb()

  // 防御层：修复 scenes 为数组（或 spread 后变为 {"0":..,"1":..} 的残留形态）
  _db = normalizeDbScenes(_db)

  // 一次性迁移：修复 v6.7 之前 demo-001 串台
  const migration = migrateBuiltinDemoIdCollision(_db)
  if (migration.migrated) {
    _db = migration.db
    saveDb(_db)
    // eslint-disable-next-line no-console
    console.info(
      `[reel-scenarios] 修复历史 id 串台: 把被占用的 demo-001 改名为 ${migration.newId}`,
    )
    if (migration.oldId && migration.newId && migration.shouldRelabelAsset) {
      void relabelMigratedAssets(
        migration.oldId,
        migration.newId,
        migration.shouldRelabelAsset,
      )
    }
  }

  // 内置 demo 刷新：让"改 demoScenario.ts 后重启立刻生效"成立。
  // 仅全局库注入 demo；per-game 作用域保持空白（新建 game 必须干净，见标准模式）。
  if (!isPerGameScope()) {
    _db = refreshBuiltinDemoInDb(_db, getDemoScenario())
  }

  // 修正被 bundled demo 抢占的 activeId —— 打破"重启后回退 demo"的腐蚀循环。
  // 必须在 pickActive 之前做，确保下面算出的 active 指向真实剧本而非 demo。
  const corrected = correctDemoUsurpedActiveId(_db)
  if (corrected !== _db) {
    _db = corrected
    saveDb(_db)
  }

  const preferredItem = _preferredId
    ? _db.items.find((it) => it.id === _preferredId)
    : null
  const active = preferredItem ?? pickActive(_db)
  const currentStore = useScenarioStore.getState().scenario
  const storeInDb = _db.items.some((it) => it.id === currentStore.id)

  const unsubscribe = useScenarioStore.subscribe((state, prev) => {
    if (state.scenario === prev.scenario) return
    if (_suppressWrite) {
      _suppressWrite = false
      return
    }
    // 误删保护：内容缩水（删除）时，把删除前的 prev 拍照进回收站（持久化、跨刷新）。
    // 内部已判定「同一本剧本 + 实质内容变少」才入库，普通编辑/新增不触发。
    captureTrashOnChange(prev.scenario, state.scenario)
    writeNow(state.scenario)
    scheduleDebouncedFlush()
  })

  if (preferredItem) {
    if (preferredItem.id !== currentStore.id) {
      systemLoadScenario(preferredItem.scenario)
    }
    if (_db.activeId !== preferredItem.id) {
      _db = { ..._db, activeId: preferredItem.id }
      saveDb(_db)
    }
  } else if (!storeInDb) {
    // per-game 作用域 + store 初值还停在共享内置 demo（demo-001）：新建 game 必须
    // 是一张白纸。这里用一份**全新的、id 唯一的空白剧本**替换共享 demo —— 否则
    // 用户在新 game 里生成的图/视频会被打上 meta.scenarioId='demo-001'，落进该 game
    // 的 assets 目录造成"被 demo 素材污染"（正是 1234 工程 745 张 demo-001 资产的根因）。
    // 全局库（无 slug）行为保持不变：仍沿用历史 demo 体验。
    if (isPerGameScope() && currentStore.id === BUNDLED_DEMO_ID) {
      const blank = makeBlankScenario()
      systemLoadScenario(blank)
      _db = upsertScenario(_db, blank)
      saveDb(_db)
    } else {
      _db = upsertScenario(_db, currentStore)
      saveDb(_db)
    }
  } else if (active && active.id !== currentStore.id) {
    systemLoadScenario(active.scenario)
  } else if (active && active.id === currentStore.id) {
    const refreshed = _db.items.find((it) => it.id === currentStore.id)
    if (refreshed) {
      systemLoadScenario(refreshed.scenario)
    }
  }

  // 异步 hydrate 磁盘镜像（不阻塞首屏）
  const isTestEnv =
    typeof process !== 'undefined' && process.env?.VITEST === 'true'
  if (!isTestEnv) {
    _hydratePromise = hydrateFromDisk()
    void _hydratePromise
  } else {
    _diskAvailable = false
  }

  // Poll disk for external changes (e.g. agent tool calls that save a new scenario)
  // Also polls the forge-queue for pending forge requests from the agent.
  if (!isTestEnv) {
    _pollTimer = setInterval(() => {
      if (!_hydrateReady || _diskAvailable === false) return
      void pollDiskForExternalChanges()
      void pollForgeQueue()
      void pollVisualQueue()
      void pollAuditionQueue()
      void pollStoryboardQueue()
      void pollKeyframeQueue()
      void pollProduceNodeQueue()
      void pollVideoQueue()
    }, 3000)
  }

  _booted = true
  return () => {
    unsubscribe()
    if (_pollTimer) {
      clearInterval(_pollTimer)
      _pollTimer = null
    }
  }
}

async function hydrateFromDisk(): Promise<void> {
  try {
    const available = await probeDiskAvailable()
    _diskAvailable = available
    if (!available) {
      // eslint-disable-next-line no-console
      console.info(
        '[reel-scenarios] 磁盘插件不可用 —— 本次只用 localStorage 持久化。' +
          ' 用 vite dev 启动可启用磁盘镜像。',
      )
      _hydrateReady = true
      return
    }

    const diskDb = await loadDbFromDisk()
    if (!diskDb) {
      _hydrateReady = true
      return
    }

    if (!_db) _db = loadDb()

    // 一次性磁盘对账：丢弃可能被污染的本地缓存，完全以（已清理的）磁盘为准。
    // 只在成功读到磁盘后执行，且每个作用域只执行一次（纪元号守门）。
    if (needsDiskReconcile()) {
      _db = diskDb
      saveDb(_db)
      markDiskReconciled()
      const active = pickActive(diskDb)
      const storeScenario = useScenarioStore.getState().scenario
      const wantsId =
        _preferredId && diskDb.items.some((it) => it.id === _preferredId)
          ? _preferredId
          : active?.id
      const targetItem = wantsId
        ? diskDb.items.find((it) => it.id === wantsId) ?? null
        : null
      if (targetItem && targetItem.id !== storeScenario.id) {
        systemLoadScenario(targetItem.scenario)
      }
      // eslint-disable-next-line no-console
      console.info(
        `[reel-scenarios] 磁盘对账(epoch ${DISK_RECONCILE_EPOCH})：以磁盘为准重建本地库，共 ${diskDb.items.length} 条。`,
      )
      _hydrateReady = true
      return
    }

    const before = _db
    const merged = mergeDbs(diskDb, before)

    const noChange =
      merged.items.length === before.items.length &&
      merged.activeId === before.activeId &&
      merged.items.every((it, i) => {
        const prev = before.items[i]
        return !!prev && prev.id === it.id && prev.updatedAt === it.updatedAt
      })

    _db = merged
    if (!noChange) {
      saveDb(merged)
      // 把合并结果写回磁盘 —— 仅限"首次迁移"（磁盘原本为空、把本地历史迁上去）。
      // 关键防再污染：普通启动若本地缓存里有磁盘没有的陈旧条目（例如曾被污染过的
      // 全局老剧本），绝不把它们 merge 回磁盘 —— 否则删了又被焊回来。磁盘才是权威，
      // 本地新建的剧本会通过用户后续编辑的 debounce flush 自然落盘。
      const isMigration = diskDb.items.length === 0 && merged.items.length > 0
      if (isMigration) {
        void saveDbToDisk(merged)
      }

      const active = pickActive(merged)
      const storeScenario = useScenarioStore.getState().scenario
      const wantsId =
        _preferredId && merged.items.some((it) => it.id === _preferredId)
          ? _preferredId
          : active?.id
      const targetItem = wantsId
        ? merged.items.find((it) => it.id === wantsId) ?? null
        : null
      if (targetItem && targetItem.id !== storeScenario.id) {
        systemLoadScenario(targetItem.scenario)
      }
    }

    const migrated = diskDb.items.length === 0 && merged.items.length > 0
    const rehydrated =
      before.items.length === 0 && merged.items.length > 0 && !migrated
    if (migrated) {
      // eslint-disable-next-line no-console
      console.info(
        `[reel-scenarios] 首次迁移：把 localStorage 里的 ${merged.items.length} 条历史写入磁盘镜像。`,
      )
    } else if (rehydrated) {
      // eslint-disable-next-line no-console
      console.info(
        `[reel-scenarios] 从磁盘补回 ${merged.items.length} 条历史到本浏览器。`,
      )
    }
  } catch {
    _diskAvailable = false
  } finally {
    _hydrateReady = true
  }
}

/**
 * Poll disk DB for external changes — detects when an agent tool call has
 * saved a new scenario or changed activeId. Switches the frontend to the
 * newly active scenario without requiring a page refresh.
 *
 * SAFETY: All zustand state updates (systemLoadScenario) are deferred via
 * setTimeout(0) to avoid triggering React setState during commit phase —
 * a setInterval callback can fire while React is mid-render, and a
 * synchronous zustand update in that window causes the entire tree to unmount.
 */
async function pollDiskForExternalChanges(): Promise<void> {
  try {
    const diskDb = await loadDbFromDisk()
    if (!diskDb || !_db) return

    // Detect activeId change from external source
    if (diskDb.activeId && diskDb.activeId !== _db.activeId) {
      const newActive = diskDb.items.find((it) => it.id === diskDb.activeId)
      if (newActive) {
        const storeScenario = useScenarioStore.getState().scenario
        if (newActive.id !== storeScenario.id) {
          _db = mergeDbs(diskDb, _db)
          saveDb(_db)
          const scenario = newActive.scenario
          const title = newActive.title
          const id = newActive.id
          setTimeout(() => {
            systemLoadScenario(scenario)
            // eslint-disable-next-line no-console
            console.info(
              `[reel-scenarios] 检测到外部工具切换剧本 → "${title}" (${id})`,
            )
          }, 0)
          return
        }
      }
    }

    // Detect content update on the currently-active scenario from external source
    // (agent updates an already-active scenario → same activeId, same item count,
    // but updatedAt is newer on disk)
    const storeScenario = useScenarioStore.getState().scenario
    const diskActive = diskDb.items.find((it) => it.id === storeScenario.id)
    const localActive = _db.items.find((it) => it.id === storeScenario.id)
    if (diskActive && localActive && diskActive.updatedAt > localActive.updatedAt) {
      _db = mergeDbs(diskDb, _db)
      saveDb(_db)
      const scenario = diskActive.scenario
      const title = diskActive.title
      const id = diskActive.id
      setTimeout(() => {
        systemLoadScenario(scenario)
        // eslint-disable-next-line no-console
        console.info(
          `[reel-scenarios] 检测到外部更新当前剧本 → "${title}" (${id})`,
        )
      }, 0)
      return
    }

    // Detect new items added externally
    if (diskDb.items.length > (_db?.items.length ?? 0)) {
      const localIds = new Set(_db.items.map((it) => it.id))
      const newItems = diskDb.items.filter((it) => !localIds.has(it.id))
      if (newItems.length > 0) {
        _db = mergeDbs(diskDb, _db)
        saveDb(_db)
        const activeItem = _db.activeId
          ? _db.items.find((it) => it.id === _db!.activeId)
          : null
        if (activeItem && activeItem.id !== storeScenario.id) {
          const scenario = activeItem.scenario
          const title = activeItem.title
          const id = activeItem.id
          setTimeout(() => {
            systemLoadScenario(scenario)
            // eslint-disable-next-line no-console
            console.info(
              `[reel-scenarios] 检测到外部新增剧本 → "${title}" (${id})`,
            )
          }, 0)
        }
      }
    }
  } catch {
    // Silent — polling failure is non-fatal
  }
}

/**
 * 立即写入 —— store 每次 scenario 变化都调用。
 *
 * 写 localStorage 同步完成；磁盘写入在 debounce 触发时合并。
 * hydrate 完成前不写磁盘（避免空壳覆盖）。
 */
function writeNow(scenario: Scenario): void {
  if (!_db) _db = loadDb()
  // per-game 作用域里不持久化内置 demo 空壳（保持 game 干净）。
  if (isPerGameScope() && scenario.id === BUNDLED_DEMO_ID) return
  _db = upsertGuardingDemoActive(_db, scenario)
  saveDb(_db)
}

/**
 * upsert 一份 scenario，但若写入的是 bundled demo 而 db 里还有真实剧本，
 * 不让 demo 抢占 activeId（否则重启回退 demo、作者剧本永久丢失）。
 */
function upsertGuardingDemoActive(db: PersistedDb, scenario: Scenario): PersistedDb {
  let next = upsertScenario(db, scenario)
  if (scenario.id === BUNDLED_DEMO_ID) {
    next = correctDemoUsurpedActiveId(next)
  }
  return next
}

function scheduleDebouncedFlush(): void {
  if (_timer) clearTimeout(_timer)
  _timer = setTimeout(() => {
    _timer = null
    if (!_db) _db = loadDb()
    const latest = useScenarioStore.getState().scenario
    _db = upsertGuardingDemoActive(_db, latest)
    saveDb(_db)
    // 推磁盘（hydrate 完成后才推）
    if (_hydrateReady && _diskAvailable !== false) {
      void flushToDiskPreservingExternalActiveId(_db)
    }
  }, DEBOUNCE_MS)
}

/**
 * Write db to disk, but preserve disk's activeId if an external tool changed it
 * since our last write. This prevents the debounced flush from overwriting
 * the backend agent's setActive=true choice before the poll picks it up.
 */
async function flushToDiskPreservingExternalActiveId(db: PersistedDb): Promise<void> {
  try {
    const diskDb = await loadDbFromDisk()
    // 空壳保护：绝不用"空库 / 仅内置 demo"覆盖磁盘上已有内容的库。
    // 这是"重启后剧本变没"的根因之一 —— boot 首屏 store 是 demo 空壳，若磁盘读取
    // 瞬时失败或时序错位，debounce flush 可能把空壳写回磁盘清掉真实剧本。
    if (diskDb && diskDb.items.length > 0 && isEffectivelyEmpty(db)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[reel-scenarios] 跳过空壳写盘：本地 ${db.items.length} 条 vs 磁盘 ${diskDb.items.length} 条 —— 保护磁盘已有剧本。`,
      )
      return
    }
    if (diskDb && diskDb.activeId && diskDb.activeId !== db.activeId) {
      const externalActive = diskDb.items.find((it) => it.id === diskDb.activeId)
      if (externalActive) {
        db = { ...db, activeId: diskDb.activeId }
      }
    }
  } catch {
    // Disk read failed — write anyway with our activeId
  }
  void saveDbToDisk(db)
}

/** 一份库是否"实质为空"：0 条，或只剩内置 demo 一条空壳。 */
function isEffectivelyEmpty(db: PersistedDb): boolean {
  if (db.items.length === 0) return true
  return db.items.length === 1 && db.items[0]?.id === BUNDLED_DEMO_ID
}

// ─────────────────────────────────────────────────────────────────────────────
// Forge Queue polling — agent submits script/idea via reel:forge-script tool,
// frontend picks it up and feeds it into the built-in forge pipeline.
// Works at module level — no React component needs to be mounted.
// ─────────────────────────────────────────────────────────────────────────────

const FORGE_QUEUE_ENDPOINT = '/__reel__/forge-queue'

type ForgeQueueListener = (item: ForgeQueueItem) => void
const _forgeQueueListeners: Set<ForgeQueueListener> = new Set()

export function onForgeQueueItem(listener: ForgeQueueListener): () => void {
  _forgeQueueListeners.add(listener)
  return () => { _forgeQueueListeners.delete(listener) }
}

let _forgeQueueProcessing = false

async function pollForgeQueue(): Promise<void> {
  if (_forgeQueueProcessing) return
  try {
    const res = await fetch(FORGE_QUEUE_ENDPOINT + gameQuery(), { method: 'GET', cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as { item?: ForgeQueueItem | null }
    if (!body?.item) return
    _forgeQueueProcessing = true
    // Consume the queue item (DELETE)
    await fetch(FORGE_QUEUE_ENDPOINT + gameQuery(), { method: 'DELETE' })
    const item = body.item
    // Notify listeners (for any React UI that wants to show progress)
    setTimeout(() => {
      for (const listener of _forgeQueueListeners) {
        try { listener(item) } catch { /* listener error non-fatal */ }
      }
    }, 0)
    // Auto-trigger the forge pipeline at module level
    setTimeout(() => {
      void triggerForgeFromQueue(item).finally(() => { _forgeQueueProcessing = false })
    }, 0)
  } catch {
    _forgeQueueProcessing = false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Visual Queue polling — agent submits "生成视觉锚点" via reel:generate-visuals,
// frontend picks it up and runs the (non-destructive) anchor-extract + image
// pipeline on the current active scenario. Module-level, no React needed.
// ─────────────────────────────────────────────────────────────────────────────

const VISUAL_QUEUE_ENDPOINT = '/__reel__/visual-queue'

let _visualQueueProcessing = false

async function pollVisualQueue(): Promise<void> {
  if (_visualQueueProcessing) return
  try {
    const res = await fetch(VISUAL_QUEUE_ENDPOINT + gameQuery(), { method: 'GET', cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as { item?: VisualQueueItem | null }
    if (!body?.item) return
    _visualQueueProcessing = true
    // Consume the queue item (DELETE)
    await fetch(VISUAL_QUEUE_ENDPOINT + gameQuery(), { method: 'DELETE' })
    const item = body.item
    // Auto-trigger the visual pipeline at module level
    setTimeout(() => {
      void triggerVisualFromQueue(item).finally(() => { _visualQueueProcessing = false })
    }, 0)
  } catch {
    _visualQueueProcessing = false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audition Queue polling — agent submits "生成试镜视频与音色" via
// reel:generate-auditions. Frontend picks it up and, for the target characters,
// generates a 3:4/10s audition video from each character's turnaround sheet and
// extracts the full audio track as an MP3 voice sample. Runs in the browser
// pipeline (Seedance creds + mediaStore + AudioContext), so the workbench must
// be open. Single overwriting item, same shape pattern as visual queue.
// ─────────────────────────────────────────────────────────────────────────────

const AUDITION_QUEUE_ENDPOINT = '/__reel__/audition-queue'

let _auditionQueueProcessing = false

async function pollAuditionQueue(): Promise<void> {
  if (_auditionQueueProcessing) return
  try {
    const res = await fetch(AUDITION_QUEUE_ENDPOINT + gameQuery(), { method: 'GET', cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as { item?: AuditionQueueItem | null }
    if (!body?.item) return
    _auditionQueueProcessing = true
    await fetch(AUDITION_QUEUE_ENDPOINT + gameQuery(), { method: 'DELETE' })
    const item = body.item
    setTimeout(() => {
      void triggerAuditionFromQueue(item).finally(() => { _auditionQueueProcessing = false })
    }, 0)
  } catch {
    _auditionQueueProcessing = false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Storyboard Queue polling — agent submits "拆分镜" via reel:generate-storyboard.
// Frontend picks it up and runs the batch storyboard engine on the active
// scenario (single node or whole episode), writing scene.shots[] + timeline
// placeholders. Single overwriting item, same shape as forge/visual queues.
// ─────────────────────────────────────────────────────────────────────────────

const STORYBOARD_QUEUE_ENDPOINT = '/__reel__/storyboard-queue'

let _storyboardQueueProcessing = false

async function pollStoryboardQueue(): Promise<void> {
  if (_storyboardQueueProcessing) return
  try {
    const res = await fetch(STORYBOARD_QUEUE_ENDPOINT + gameQuery(), { method: 'GET', cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as { item?: StoryboardQueueItem | null }
    if (!body?.item) return
    _storyboardQueueProcessing = true
    // Consume the queue item (DELETE)
    await fetch(STORYBOARD_QUEUE_ENDPOINT + gameQuery(), { method: 'DELETE' })
    const item = body.item
    setTimeout(() => {
      void triggerStoryboardFromQueue(item).finally(() => { _storyboardQueueProcessing = false })
    }, 0)
  } catch {
    _storyboardQueueProcessing = false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Keyframe Queue polling — agent submits "逐镜出关键帧" via reel:generate-keyframes.
// Frontend picks it up and generates one keyframe per shot of the target scene,
// writing shot.keyframeMediaRef. Single overwriting item { sceneId, force? }.
// ─────────────────────────────────────────────────────────────────────────────

const KEYFRAME_QUEUE_ENDPOINT = '/__reel__/keyframe-queue'

let _keyframeQueueProcessing = false

async function pollKeyframeQueue(): Promise<void> {
  if (_keyframeQueueProcessing) return
  try {
    const res = await fetch(KEYFRAME_QUEUE_ENDPOINT + gameQuery(), { method: 'GET', cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as { item?: KeyframeQueueItem | null }
    if (!body?.item) return
    _keyframeQueueProcessing = true
    await fetch(KEYFRAME_QUEUE_ENDPOINT + gameQuery(), { method: 'DELETE' })
    const item = body.item
    setTimeout(() => {
      void triggerKeyframeFromQueue(item).finally(() => { _keyframeQueueProcessing = false })
    }, 0)
  } catch {
    _keyframeQueueProcessing = false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Produce-node Queue polling — agent submits "一键产出节点" via reel:produce-node.
// Frontend runs the whole chain (storyboard → keyframes → video) on the node,
// idempotent + overridable. Single overwriting item { sceneId, stages?, force? }.
// ─────────────────────────────────────────────────────────────────────────────

const PRODUCE_NODE_QUEUE_ENDPOINT = '/__reel__/produce-node-queue'

let _produceNodeQueueProcessing = false

async function pollProduceNodeQueue(): Promise<void> {
  if (_produceNodeQueueProcessing) return
  try {
    const res = await fetch(PRODUCE_NODE_QUEUE_ENDPOINT + gameQuery(), { method: 'GET', cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as { item?: ProduceNodeQueueItem | null }
    if (!body?.item) return
    _produceNodeQueueProcessing = true
    await fetch(PRODUCE_NODE_QUEUE_ENDPOINT + gameQuery(), { method: 'DELETE' })
    const item = body.item
    setTimeout(() => {
      void triggerProduceNodeFromQueue(item).finally(() => { _produceNodeQueueProcessing = false })
    }, 0)
  } catch {
    _produceNodeQueueProcessing = false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Video Queue polling — agent submits per-scene video jobs via reel:generate-video.
// Frontend claims the whole batch (DELETE) and runs the SAME in-browser video
// pipeline the workbench uses, binding each result to its scene + timeline.
// Unlike forge/visual queues, this queue is an APPEND array (multiple jobs).
// ─────────────────────────────────────────────────────────────────────────────

const VIDEO_QUEUE_ENDPOINT = '/__reel__/video-queue'

let _videoQueueProcessing = false

async function pollVideoQueue(): Promise<void> {
  if (_videoQueueProcessing) return
  try {
    const res = await fetch(VIDEO_QUEUE_ENDPOINT + gameQuery(), { method: 'GET', cache: 'no-store' })
    if (!res.ok) return
    const body = (await res.json()) as { items?: VideoQueueJob[] | null }
    const jobs = Array.isArray(body?.items) ? body!.items : []
    if (jobs.length === 0) return
    _videoQueueProcessing = true
    // Claim the whole batch (DELETE) so it isn't re-dispatched on the next poll.
    await fetch(VIDEO_QUEUE_ENDPOINT + gameQuery(), { method: 'DELETE' })
    setTimeout(() => {
      void triggerVideoFromQueue(jobs).finally(() => { _videoQueueProcessing = false })
    }, 0)
  } catch {
    _videoQueueProcessing = false
  }
}

function systemLoadScenario(next: Scenario): void {
  _suppressWrite = true
  useScenarioStore.getState().loadScenario(next)
}

// ─────────────────────────────────────────────────────────────────────────────
// 提供给 UI 的查询/操作接口
// ─────────────────────────────────────────────────────────────────────────────

export function listScenarioHistory(): PersistedItem[] {
  if (!_db) _db = loadDb()
  return _db.items
}

export function loadScenarioFromHistory(id: string): boolean {
  if (!_db) _db = loadDb()
  const item = _db.items.find((it) => it.id === id)
  if (!item) return false
  _db = setActive(_db, id)
  saveDb(_db)
  systemLoadScenario(item.scenario)
  return true
}

export function removeScenarioFromHistory(id: string): void {
  if (!_db) _db = loadDb()
  _db = removeFromDb(_db, id)
  saveDb(_db)
  if (_diskAvailable !== false) void saveDbToDisk(_db)
  void import('../media/assetStore').then(({ useAssetStore }) => {
    void useAssetStore.getState().removeByScenarioId(id)
  })
}

export function exportHistoryJson(): string {
  if (!_db) _db = loadDb()
  return exportDbToJson(_db)
}

export function importHistoryFromJson(raw: string): {
  ok: boolean
  error?: string
  addedCount?: number
  totalCount?: number
} {
  if (!_db) _db = loadDb()
  const res = importDbFromJson(_db, raw)
  if (!res.ok || !res.merged) {
    return { ok: false, error: res.error ?? '未知错误' }
  }
  _db = res.merged
  saveDb(_db)
  if (_diskAvailable !== false) void saveDbToDisk(_db)
  return {
    ok: true,
    addedCount: res.addedCount ?? 0,
    totalCount: _db.items.length,
  }
}

export function flushScenarioPersist(): void {
  if (_timer) {
    clearTimeout(_timer)
    _timer = null
  }
  if (!_db) _db = loadDb()
  _db = upsertGuardingDemoActive(_db, useScenarioStore.getState().scenario)
  saveDb(_db)
  if (_hydrateReady && _diskAvailable !== false) {
    void saveDbToDisk(_db)
  }
}

/** 测试 / 重置用 */
export function __resetScenarioPersistForTest(): void {
  _db = null
  if (_timer) {
    clearTimeout(_timer)
    _timer = null
  }
  if (_pollTimer) {
    clearInterval(_pollTimer)
    _pollTimer = null
  }
  _booted = false
  _diskAvailable = null
  _hydratePromise = null
  _hydrateReady = false
  _preferredId = undefined
  _suppressWrite = false
}

export function __isBooted(): boolean {
  return _booted
}

export function __awaitDiskHydrate(): Promise<void> {
  return _hydratePromise ?? Promise.resolve()
}

// ─────────────────────────────────────────────────────────────────────────────
// 内置 demo 刷新
// ─────────────────────────────────────────────────────────────────────────────

export function signScenarioRuntimeSurface(s: Scenario): string {
  const parts: string[] = []
  const scenes = s.scenes ?? {}
  const sceneIds = Object.keys(scenes).sort()
  for (const id of sceneIds) {
    const sc = scenes[id]
    if (!sc) continue
    parts.push(`s:${id}:${sc.durationMs}`)
    if (sc.qte?.window && sc.qte.cues) {
      const w = sc.qte.window
      parts.push(`w:${w.perfect}/${w.great}/${w.good}`)
      for (const cue of sc.qte.cues) {
        parts.push(
          `c:${cue.id}:${cue.shape}:${cue.appearAt}:${cue.targetAt}:${cue.durationMs ?? ''}`,
        )
      }
    }
  }
  return parts.join('|')
}

export function refreshBuiltinDemoInDb(
  db: PersistedDb,
  bundled: Scenario,
): PersistedDb {
  const idx = db.items.findIndex((it) => it.id === bundled.id)
  if (idx < 0) {
    const seed: PersistedItem = {
      id: bundled.id,
      title: bundled.title,
      scenario: bundled,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    return { ...db, items: [...db.items, seed] }
  }
  const existing = db.items[idx]
  if (!existing) return db
  const bundledSig = signScenarioRuntimeSurface(bundled)
  const existingSig = signScenarioRuntimeSurface(existing.scenario)
  if (bundledSig === existingSig) return db

  const mergedScenes = { ...existing.scenario.scenes }
  for (const [sceneId, bundledScene] of Object.entries(bundled.scenes)) {
    const prev = mergedScenes[sceneId]
    if (!prev) {
      mergedScenes[sceneId] = bundledScene
      continue
    }
    mergedScenes[sceneId] = {
      ...prev,
      durationMs: bundledScene.durationMs,
      qte: bundledScene.qte,
    }
  }

  const nextItem: PersistedItem = {
    ...existing,
    scenario: {
      ...existing.scenario,
      scenes: mergedScenes,
    },
    updatedAt: Date.now(),
  }
  const nextItems = db.items.slice()
  nextItems[idx] = nextItem
  return { ...db, items: nextItems }
}

// ─────────────────────────────────────────────────────────────────────────────
// 一次性 asset manifest 修复 —— 配合 migrateBuiltinDemoIdCollision
// ─────────────────────────────────────────────────────────────────────────────

async function relabelMigratedAssets(
  oldId: string,
  newId: string,
  shouldRelabelAsset: (asset: { meta?: { scenarioId?: string; sceneId?: string } }) => boolean,
): Promise<void> {
  try {
    const { useAssetStore } = await import('../media/assetStore')
    const store = useAssetStore.getState()
    if (!store.loaded) {
      await store.refresh()
    }
    const targets = useAssetStore
      .getState()
      .records.filter((r) => shouldRelabelAsset(r))
    if (targets.length === 0) return
    // eslint-disable-next-line no-console
    console.info(
      `[reel-scenarios] 同步迁移 ${targets.length} 条资产: scenarioId ${oldId} → ${newId}`,
    )
    let patched = 0
    const CHUNK = 6
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK)
      const results = await Promise.all(
        chunk.map((r) =>
          useAssetStore
            .getState()
            .patch(r.id, { scenarioId: newId })
            .then((res) => res != null)
            .catch(() => false),
        ),
      )
      patched += results.filter(Boolean).length
    }
    if (patched < targets.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[reel-scenarios] 资产迁移仅完成 ${patched}/${targets.length} 条`,
      )
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[reel-scenarios] relabelMigratedAssets 失败:', e)
  }
}
