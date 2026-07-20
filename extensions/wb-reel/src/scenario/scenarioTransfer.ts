import {
  deserialize,
  emptyDb,
  mergeDbs,
  type PersistedDb,
} from './scenarioPersist'

/**
 * scenarioTransfer —— 剧本历史的"可移植 JSON"导入/导出。
 *
 * 存在意义：
 *   磁盘镜像只能跨"同一台机器"的浏览器；真跨机器/跨用户，需要一个
 *   可复制粘贴的 portable 格式。这也是所有持久层失效后的最后兜底：
 *   作者点"导出"得到一个 .json，发到哪台机器都能点"导入"读回来。
 *
 * 格式选择：复用 scenarioPersist 的 PersistedDb 格式原样导出。
 *   好处：跟 localStorage / 磁盘里存的就是一码事，无需再维护第二份 schema。
 *   deserialize 已经做了 version 检查和容错，导入时直接 mergeDbs 即可。
 */

export interface ExportEnvelope {
  kind: 'reel-studio:scenarios-export'
  exportedAt: number
  /** PersistedDb 整份；字段名直接沿用 */
  db: PersistedDb
}

export const EXPORT_KIND = 'reel-studio:scenarios-export' as const

export function exportDbToJson(db: PersistedDb, opts: { now?: number } = {}): string {
  const envelope: ExportEnvelope = {
    kind: EXPORT_KIND,
    exportedAt: opts.now ?? Date.now(),
    db,
  }
  return JSON.stringify(envelope, null, 2)
}

export interface ImportResult {
  /** 是否解析成功（只要拿到任何 items 就算成功） */
  ok: boolean
  /** 解析错误，导入为 !ok 时才填 */
  error?: string
  /** 成功时，合并后的完整 db（尚未写盘） */
  merged?: PersistedDb
  /** 本次导入新带进来的剧本数（去重后） */
  addedCount?: number
}

/**
 * 把外部 JSON 文本合并到当前 db。
 *
 * 合并语义（复用 mergeDbs）：
 *   - 同 id：取 updatedAt 更大者
 *   - 其余：全部保留
 *   - max 上限：沿用 mergeDbs 默认
 *
 * 接受的输入格式：
 *   1) { kind: EXPORT_KIND, db: PersistedDb }  —— 本工具导出的信封
 *   2) 直接一份 PersistedDb JSON —— 万一有人手搓
 *
 * 容错：
 *   - JSON 解析失败 / 字段不对 → ok: false + 明确 error
 *   - 空 items 也算 ok（merged 等于 current）—— 不该把这当作"导入失败"
 */
export function importDbFromJson(
  current: PersistedDb,
  raw: string,
): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return {
      ok: false,
      error: `JSON 解析失败：${(e as Error).message}`,
    }
  }

  // 拿到一份外部 db —— 先探信封，再兜底直接当 db
  let externalDb: PersistedDb | null = null
  const obj = parsed as {
    kind?: string
    db?: unknown
    version?: number
    items?: unknown
  }

  if (obj && typeof obj === 'object' && obj.kind === EXPORT_KIND && obj.db) {
    externalDb = deserialize(JSON.stringify(obj.db))
  } else if (obj && typeof obj === 'object' && 'items' in obj && 'version' in obj) {
    externalDb = deserialize(raw)
  }

  if (!externalDb) {
    return {
      ok: false,
      error: '无法识别的 JSON：既不是导出的信封，也不是 PersistedDb 结构',
    }
  }

  const currentIds = new Set(current.items.map((it) => it.id))
  const addedCount = externalDb.items.filter((it) => !currentIds.has(it.id))
    .length

  const merged = mergeDbs(externalDb, current)
  return { ok: true, merged, addedCount }
}

/**
 * 在浏览器触发"下载 JSON 文件"。非浏览器环境（SSR / test）静默返回 false。
 */
export function triggerDownload(filename: string, content: string): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false
  const blob = new Blob([content], { type: 'application/json' })
  return triggerBlobDownload(filename, blob)
}

/**
 * 触发任意二进制 Blob 下载 —— 用于 .reelpkg 等大文件。
 * 与 triggerDownload 共用"a.click + revokeObjectURL"套路，只是不强行封 JSON。
 */
export function triggerBlobDownload(filename: string, blob: Blob): boolean {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return false
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 大 zip 下载给 Safari 留足缓冲（对比 JSON 的 2s，这里放到 5s）
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return true
}

/**
 * 生成默认导出文件名。格式：reel-scenarios-2026-05-01-1503.json
 */
export function defaultExportFilename(now: number = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  return `reel-scenarios-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate(),
  )}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
}
