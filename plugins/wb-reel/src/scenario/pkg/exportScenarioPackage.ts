/**
 * .reelpkg 导出 —— 把一份剧本 + 它引用的所有资产打成一个 zip。
 *
 * 产物结构：
 *
 *   <title>.reelpkg
 *   ├─ manifest.json          # 包元数据（version / scenarioId / createdAt / files / externalRefs）
 *   ├─ scenario.json          # 单个 scenario；ref 已改写为 pkg:<hash>
 *   └─ assets/
 *        ├─ <sha256-prefix>.<ext>
 *        └─ ...
 *
 * 命名：内容 SHA-256 前 16 字符（62^16 碰撞概率远小于单包条目数），
 * 天然去重 —— 多个 shot 引用同一张图只存一份。
 *
 * 外链策略（用户选了 keep-url）：
 *   · 抓不下来（CORS/404）的外链**不进 assets**；
 *   · scenario 里保持**原始 http URL** 不改写；
 *   · manifest.externalRefs 列出它们，另一端打开就直接走 CDN。
 *
 * 内存预算：
 *   · 一次性把所有 entry 载入内存然后拼接 zip；单条 < 4GB；
 *   · 典型剧本包 50-300MB 在浏览器内完全撑得住。
 *   · 超大视频（> 500MB 单镜）不在 MVP 覆盖范围；真需要再做 streaming。
 */

import type { Scenario } from '../types'
import { sanitizeScenarioForIO } from '../sanitize'
import {
  collectScenarioRefs,
  refLooksPackable,
  type RefCell,
} from './collectScenarioRefs'
import { resolveRef, extForBlob, MissingRefError } from './refResolver'
import { writeZip, type ZipEntry } from './zipStore'
import {
  prunePlaybackScenario,
  type PrunePlaybackOptions,
} from './prunePlaybackScenario'

/** 包格式版本；未来做破坏性改动要 bump，读取端按 version 兼容。 */
export const REELPKG_VERSION = 1

export interface ReelPkgManifest {
  version: number
  /** 固定串，让读取端能在魔数级别确认这是 .reelpkg，不是随便 zip */
  kind: 'reel-studio:scenario-package'
  /**
   * 导出模式 —— v1 新增（软性扩展，旧读包端不认得这个字段会直接忽略）。
   *
   *   'full'     完整剧本：角色/场所/道具/素材库/分镜全部进包（便于二次编辑）
   *   'playback' Player 所见即所得：只包含可达场景的 media+audio+minigame
   *              （包体小、直接能播；另一端看不到编辑态中间产物）
   *
   * 向后兼容：缺省按 'full' 解读。
   */
  mode?: 'full' | 'playback'
  scenarioId: string
  title: string
  synopsis?: string
  /** 导出时间（epoch ms） */
  createdAt: number
  /** 生成本包的工具版本（读包时用于兼容提示） */
  generator: string
  /** 包内资产清单：pkg:<hash> → assets/<hash>.<ext> 的元数据 */
  files: Array<{
    /** 在 scenario 里被引用时的 ref（pkg:<hash>） */
    ref: string
    /** 在 zip 里的相对路径 */
    path: string
    /** 字节数 */
    bytes: number
    /** MIME 类型（依赖 Blob.type，浏览器给什么就用什么） */
    mimeType: string
    /** 哪些字段引用了这个文件（便于诊断 / UI 展示） */
    refs: string[]
  }>
  /** 抓不下来 / 主动保留的外链；读取端可以离线播放不了但能看到清单 */
  externalRefs: Array<{
    /** 原始 URL */
    url: string
    /** 哪些字段指着这个 URL */
    refs: string[]
    /** 失败原因（可选） */
    reason?: string
  }>
  /**
   * 数据本身已经丢失的引用 —— scenario 里留着字段，但 mediaStore/assetStore/磁盘
   * 都找不到对应资产（典型：视频上传未落盘时刷新、资产被手动清理）。
   *
   * 与 externalRefs 的区别：
   *   · externalRefs 是"有外链 URL 但抓不到"（联网能救）
   *   · missingRefs 是"根本没 URL，这条媒体就丢了"（救不了）
   *
   * 读包端应对：在该字段对应位置显示"素材丢失"占位，而不是打开失败 toast。
   */
  missingRefs: Array<{
    /** 原始 ref（多半是 m-xxx 形式的 mediaId） */
    ref: string
    /** 哪些字段引用它 */
    refs: string[]
    /** 具体失败原因（便于诊断） */
    reason: string
  }>
  /** 包内打包"软失败"的计数，便于读包端快速校验 */
  stats: {
    totalCells: number
    packedBlobs: number
    externalKept: number
    /** 原始数据丢失（对应 missingRefs 里的条目数，按 label 去重前的计数） */
    missingCells: number
    /** 其他打包失败（非 missing、非 external）—— 典型：fetch 异常、data URL 坏掉 */
    failedCells: number
  }
  /**
   * playback 模式专属：真正进包的可达 sceneId 列表。
   * full 模式下不写出这两个字段（节省 manifest 体积）。
   */
  includedScenes?: string[]
  /** playback 模式被丢弃的孤岛 sceneId 列表（调试/告知用） */
  droppedScenes?: string[]
}

export interface ExportProgress {
  /** 当前阶段：collect → resolve → pack → done */
  phase: 'collect' | 'resolve' | 'pack' | 'done'
  /** resolve 阶段的已处理 ref 数量 */
  resolved: number
  /** resolve 阶段的总 ref 数量 */
  total: number
  /** 当前正在处理的 ref 标签（label） */
  currentLabel?: string
}

export interface ExportOptions {
  /** 进度回调（可选） */
  onProgress?: (p: ExportProgress) => void
  /** resolve 阶段并发度，默认 4（对外链友好；本地 fetch 其实可以更高） */
  concurrency?: number
  /** 注入固定时间戳，便于单测 */
  now?: number
  /** 生成器版本串（进 manifest.generator），默认 'reel-studio-v0' */
  generator?: string
  /**
   * 导出模式 —— 默认 'full'（保持既有调用者的行为不变）。
   *
   * 'playback' 模式：调用 prunePlaybackScenario 先瘦身 —— 只留从 rootSceneId
   * 可达的 scene，场景内只留 media / audio / minigame / branch；角色参考图 /
   * 场所基准 / 道具 / shot 中间产物 / 素材库 一律丢弃。
   *
   * 典型场景：作者想把"玩家看到的完整游戏"分发给别人直接玩，而不是把整个
   * 编辑工程打包。
   */
  mode?: 'full' | 'playback'
  /**
   * 仅 mode='playback' 生效：是否把 dialogue[] 台词文本一起带进去。
   *
   * 与 Player 里 showSubtitles 设置严格对齐：作者关闭了字幕显示，
   * 就不把字幕文本也塞给下游看。
   * 缺省 = true（台词不占包体积，默认保留 "另一端想看就能看"）。
   */
  includeSubtitles?: boolean
}

export interface ExportResult {
  /** 打好的 .reelpkg（zip）—— Blob 形态，避免 2GiB+ 剧本时单 buffer 分配失败 */
  blob: Blob
  /** 约定的文件名（含 .reelpkg 后缀） */
  filename: string
  /** 清单本体，也写进了 zip；这里暴露给 UI 做"导出后摘要 toast" */
  manifest: ReelPkgManifest
  /** 收集到的所有 warning（不阻断导出，展示给作者看） */
  warnings: string[]
}

/**
 * 导出一份剧本为 .reelpkg 包。
 *
 * 调用方注意：
 *   · 传进来的 scenario 不会被改；内部会深拷贝
 *   · 返回的 blob 由调用方负责触发下载（复用 scenarioTransfer.triggerBlobDownload）
 */
export async function exportScenarioPackage(
  scenario: Scenario,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  const emit = (p: ExportProgress): void => opts.onProgress?.(p)
  const warnings: string[] = []
  const now = opts.now ?? Date.now()
  const mode = opts.mode ?? 'full'

  // 0) 可选：playback 模式先瘦身 —— 精简之后再去 sanitize/clone
  //    放最前面避免把不打算分发的字段/scene 意外带到后续 collect 里。
  let pruneMeta:
    | { includedScenes: string[]; droppedScenes: string[] }
    | undefined
  let baseScenario: Scenario = scenario
  if (mode === 'playback') {
    const pruneOpts: PrunePlaybackOptions = {
      includeSubtitles: opts.includeSubtitles ?? true,
    }
    const res = prunePlaybackScenario(scenario, pruneOpts)
    baseScenario = res.scenario
    pruneMeta = {
      includedScenes: res.includedScenes,
      droppedScenes: res.droppedScenes,
    }
    if (res.droppedScenes.length > 0) {
      warnings.push(
        `playback 模式：跳过 ${res.droppedScenes.length} 个从 rootSceneId 不可达的 scene（${res.droppedScenes.slice(0, 5).join(', ')}${res.droppedScenes.length > 5 ? '…' : ''}）`,
      )
    }
  }

  // 1) 克隆 —— 后续会原地改 ref 字段（sanitize 先清掉非法值）
  const clone = structuredClone(sanitizeScenarioForIO(baseScenario))
  const cells = collectScenarioRefs(clone)
  emit({ phase: 'collect', resolved: 0, total: cells.length })

  // 2) resolve：把每个 cell 抓成 Blob / 外链
  const hashToEntry = new Map<
    string,
    { blob: Blob; ext: string; mimeType: string; refs: string[] }
  >()
  const externalByUrl = new Map<
    string,
    { refs: string[]; reason?: string }
  >()
  /** ref（m-xxx 等）→ { 哪些字段, 原因 } —— 数据彻底丢失的类别 */
  const missingByRef = new Map<
    string,
    { refs: string[]; reason: string }
  >()

  const concurrency = Math.max(1, opts.concurrency ?? 4)
  let cursor = 0
  let resolvedCount = 0
  let failedCount = 0
  let missingCount = 0

  async function worker(): Promise<void> {
    while (cursor < cells.length) {
      const idx = cursor++
      const cell = cells[idx]!
      const ref = cell.get()
      emit({
        phase: 'resolve',
        resolved: resolvedCount,
        total: cells.length,
        currentLabel: cell.label,
      })
      try {
        const resolved = await resolveRef(ref, { scopeScenarioId: clone.id })
        if (resolved.kind === 'external') {
          let entry = externalByUrl.get(resolved.url)
          if (!entry) {
            entry = { refs: [], reason: resolved.reason }
            externalByUrl.set(resolved.url, entry)
          }
          entry.refs.push(cell.label)
          // scenario 里保留原 URL，不改写
          warnings.push(
            `保留外链：${cell.label} → ${resolved.url}（${resolved.reason ?? '未抓到'}）`,
          )
        } else {
          const short = await contentFingerprint(resolved.blob)
          const pkgRef = `pkg:${short}`
          let entry = hashToEntry.get(short)
          if (!entry) {
            const ext = extForBlob(resolved.blob, resolved.sourceUrl)
            entry = {
              blob: resolved.blob,
              ext,
              mimeType: resolved.blob.type || 'application/octet-stream',
              refs: [],
            }
            hashToEntry.set(short, entry)
          }
          entry.refs.push(cell.label)
          cell.set(pkgRef)
        }
      } catch (err) {
        if (err instanceof MissingRefError) {
          // 数据丢失：scenario 保留原 ref（对读包端是软错误，UI 显示占位）
          missingCount++
          let entry = missingByRef.get(err.ref)
          if (!entry) {
            entry = { refs: [], reason: err.message }
            missingByRef.set(err.ref, entry)
          }
          entry.refs.push(cell.label)
          warnings.push(
            `素材已丢失：${cell.label}（${err.ref.slice(0, 80)}）—— 原始资产已不在 mediaStore/assetStore 中`,
          )
        } else {
          failedCount++
          warnings.push(
            `无法打包 ${cell.label}（${ref.slice(0, 80)}）：${(err as Error).message}`,
          )
          // scenario 里保留原 ref，读包端会看到一个"失效引用"
        }
      }
      resolvedCount++
      emit({
        phase: 'resolve',
        resolved: resolvedCount,
        total: cells.length,
        currentLabel: cell.label,
      })
    }
  }

  const workers: Promise<void>[] = []
  for (let i = 0; i < concurrency; i++) workers.push(worker())
  await Promise.all(workers)

  // 3) manifest
  const files = Array.from(hashToEntry.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([short, entry]) => ({
      ref: `pkg:${short}`,
      path: `assets/${short}.${entry.ext}`,
      bytes: entry.blob.size,
      mimeType: entry.mimeType,
      refs: entry.refs.slice(),
    }))

  const externalRefs = Array.from(externalByUrl.entries()).map(
    ([url, info]) => ({
      url,
      refs: info.refs.slice(),
      ...(info.reason ? { reason: info.reason } : {}),
    }),
  )

  const missingRefs = Array.from(missingByRef.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([ref, info]) => ({
      ref,
      refs: info.refs.slice(),
      reason: info.reason,
    }))

  const manifest: ReelPkgManifest = {
    version: REELPKG_VERSION,
    kind: 'reel-studio:scenario-package',
    mode,
    scenarioId: clone.id,
    title: clone.title,
    ...(clone.synopsis ? { synopsis: clone.synopsis } : {}),
    createdAt: now,
    generator: opts.generator ?? 'reel-studio-v0',
    files,
    externalRefs,
    missingRefs,
    stats: {
      totalCells: cells.length,
      packedBlobs: files.length,
      externalKept: externalRefs.length,
      missingCells: missingCount,
      failedCells: failedCount,
    },
    ...(pruneMeta
      ? {
          includedScenes: pruneMeta.includedScenes,
          droppedScenes: pruneMeta.droppedScenes,
        }
      : {}),
  }

  // 4) 组 zip
  emit({ phase: 'pack', resolved: resolvedCount, total: cells.length })
  const encoder = new TextEncoder()
  const entries: ZipEntry[] = [
    {
      path: 'manifest.json',
      data: encoder.encode(JSON.stringify(manifest, null, 2)),
      mtime: now,
    },
    {
      path: 'scenario.json',
      data: encoder.encode(JSON.stringify(clone, null, 2)),
      mtime: now,
    },
  ]
  for (const [short, entry] of hashToEntry) {
    const ab = await entry.blob.arrayBuffer()
    entries.push({
      path: `assets/${short}.${entry.ext}`,
      data: new Uint8Array(ab),
      mtime: now,
    })
  }

  const blob = writeZip(entries)
  emit({ phase: 'done', resolved: resolvedCount, total: cells.length })

  return {
    blob,
    filename: defaultPkgFilename(clone.title, now),
    manifest,
    warnings,
  }
}

/**
 * 内容指纹 —— 用于包内资产按哈希去重 + 稳定命名。
 *
 * 首选 Web Crypto 的 SHA-256（Secure Context 下）；非 Secure Context
 * （http 域名、非 localhost）里 `crypto.subtle` 是 undefined，
 * 这时退化到纯 JS 的 FNV-1a 64-bit。
 *
 * 为什么退化到非密码学哈希也 OK：
 *   · 这里的用途是"同一 Blob → 同一 key"的去重，不是安全校验
 *   · 单包的资产条目数一般 < 1000，FNV-1a 64-bit 冲突概率远小于 2^-32
 *   · 导入端永远信包里 manifest.files[*].path（由 key 生成），
 *     不会把 key 当成"任何人都能独立验证的校验和"
 *
 * 两种哈希的产物都统一成 16 字符 hex 前缀，外部使用方不需要区分。
 */
async function contentFingerprint(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  // Web Crypto 在 Secure Context 外（http + 非 localhost）不可用：
  //   crypto 存在但 crypto.subtle === undefined → 直接走 fallback
  const subtle =
    typeof crypto !== 'undefined' && crypto && 'subtle' in crypto
      ? (crypto as Crypto).subtle
      : undefined
  if (subtle) {
    try {
      const hashBuf = await subtle.digest('SHA-256', buf)
      const bytes = new Uint8Array(hashBuf)
      let hex = ''
      for (const b of bytes) hex += b.toString(16).padStart(2, '0')
      return hex.slice(0, 16)
    } catch {
      // 某些浏览器策略（特别旧版 Safari / 非 Secure Context）会运行期 reject
      // fall through
    }
  }
  return fnv1a64Hex(new Uint8Array(buf))
}

/**
 * 64-bit FNV-1a（拆成 hi/lo 32 位避免 JS number 精度塌陷）。
 * 返回 16 字符小写 hex，长度与 SHA-256 前缀对齐。
 */
function fnv1a64Hex(bytes: Uint8Array): string {
  // offset basis (FNV-1a 64): 0xcbf29ce484222325
  let hi = 0xcbf29ce4 >>> 0
  let lo = 0x84222325 >>> 0
  // prime: 0x100000001b3
  const PRIME_HI = 0x00000100
  const PRIME_LO = 0x000001b3
  for (let i = 0; i < bytes.length; i++) {
    lo = (lo ^ bytes[i]!) >>> 0
    // (hi, lo) *= (PRIME_HI, PRIME_LO) mod 2^64
    const a0 = lo & 0xffff
    const a1 = lo >>> 16
    const a2 = hi & 0xffff
    const a3 = hi >>> 16
    const b0 = PRIME_LO & 0xffff
    const b1 = PRIME_LO >>> 16
    const b2 = PRIME_HI & 0xffff
    const b3 = PRIME_HI >>> 16
    let c0 = a0 * b0
    let c1 = (c0 >>> 16) + a1 * b0
    c0 &= 0xffff
    c1 += a0 * b1
    let c2 = (c1 >>> 16) + a2 * b0
    c1 &= 0xffff
    c2 += a1 * b1
    let c3 = (c2 >>> 16) + a3 * b0
    c2 &= 0xffff
    c3 += a2 * b1
    c2 += a0 * b2
    c3 = (c3 + (c2 >>> 16)) >>> 0
    c2 &= 0xffff
    c3 += a1 * b2 + a0 * b3
    c3 &= 0xffff
    lo = (c0 | (c1 << 16)) >>> 0
    hi = (c2 | (c3 << 16)) >>> 0
  }
  const hex = (n: number): string => n.toString(16).padStart(8, '0')
  return hex(hi) + hex(lo)
}

/**
 * 根据标题生成文件名：`书生误闯女儿国V30-2026-05-11-2215.reelpkg`
 * 非法文件名字符被替换成下划线。
 */
export function defaultPkgFilename(title: string, now: number = Date.now()): string {
  const d = new Date(now)
  const pad = (n: number): string => n.toString().padStart(2, '0')
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  const safeTitle = (title || 'scenario').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
  return `${safeTitle}-${ts}.reelpkg`
}

// 抑制 lint 告警：函数内部用于语义清晰
export { refLooksPackable }
export type { RefCell }
