/**
 * 纯构建器：一棵 Scenario + 一个媒体解析器 → reel-game.pack.json + 媒体文件清单。
 *
 * 这是影游成品资产的「蒸馏 / importer 等价物」（host 自写，无独立 importer）：它把作者在
 * wb-reel 里做好的 per-game 状态，转成可分发的引擎资产形态：
 *   - 一份 `internal-text-package` 的 pack.json，单条 `kind:'reel-game'` 资产，
 *     payload 是整棵 Scenario（媒体引用已改写成 `./reel-media/<hash>.<ext>`）。
 *   - 一组内容寻址、去重后的媒体文件（co-located 在 reel-media/ 下）。
 *
 * 保持纯净：disk/network 由调用方通过 `resolveBlob` 注入（与 exportScenarioPackage
 * 注入 resolveRef 同一套路），因此可在浏览器/Node 任一端复用、易单测。
 */

import type { Scenario } from '../types'
import { collectScenarioRefs } from './collectScenarioRefs'
import {
  makeReelGamePayload,
  type ReelGamePayload,
  type ReelScenarioLike,
} from './reelGamePayload'
import { assertReelScenario } from '../schema/validateScenario'
import { createHash } from 'node:crypto'

export type ResolvedBlob =
  | { kind: 'blob'; bytes: Uint8Array; ext: string }
  | { kind: 'external'; url: string }
  | { kind: 'missing'; reason: string }

export interface BuildReelGameOptions {
  guid: string
  /** 注入：把一个 scenario 引用（m-xxx / url / dataurl）解析成字节或外链/缺失。 */
  resolveBlob: (ref: string) => Promise<ResolvedBlob>
}

/** 入口资产：单条 reel-game，payload 是整棵已蒸馏 Scenario；refs = 它引用的全部媒体 GUID。 */
export interface ReelGameEntryAsset {
  guid: string
  kind: 'reel-game'
  name: string
  payload: ReelGamePayload
  refs: string[]
}

/**
 * 媒体资产：一条媒体一条资产。
 *   - kind:'video'    → 引擎自有 VideoAsset，payload `{url}`。
 *   - kind:'raw-file' → host 不透明媒体（图/音/其他），payload `{url, mime?}`。
 * `url` 恒为 pack 相对路径 `./reel-media/<hash>.<ext>`（build 期不改写为绝对 URL）。
 */
export interface ReelMediaAsset {
  guid: string
  kind: 'video' | 'raw-file'
  name: string
  payload: { url: string; mime?: string }
  refs: []
}

export interface ReelGamePackFile {
  schemaVersion: '1.0.0'
  kind: 'internal-text-package'
  /** 首条恒为 reel-game 入口，其后是它引用的媒体资产（refs 图边）。 */
  assets: [ReelGameEntryAsset, ...ReelMediaAsset[]]
}

export interface BuildReelGameResult {
  packJson: ReelGamePackFile
  mediaFiles: Array<{ path: string; bytes: Uint8Array }>
  external: Array<{ ref: string; url: string }>
  missing: Array<{ ref: string; reason: string }>
}

/** 完整 sha256 hex —— 内容寻址的唯一真源（文件名与媒体 GUID 都从它派生）。 */
function sha256hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * 从内容 sha256 派生一个确定性、合法的 UUIDv8 —— 同内容 ⇒ 同 GUID（去重稳定）。
 * 取前 32 hex，钉死版本位(v8)与 variant 位(RFC 4122，8..b)，其余照抄内容 hash。
 */
function mediaGuidFromSha(hex: string): string {
  const h = hex.slice(0, 32).padEnd(32, '0')
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** 扩展名 → MIME（raw-file 的 payload.mime；未知返回 undefined）。 */
function mimeForExt(ext: string): string | undefined {
  const e = ext.toLowerCase().replace(/^\./, '')
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg', aac: 'audio/aac',
  }
  return map[e]
}

export async function buildReelGameAsset(
  scenario: Scenario,
  opts: BuildReelGameOptions,
): Promise<BuildReelGameResult> {
  // 破坏性扫描 + 改写都在深拷贝上做，绝不动调用方的原 scenario。
  const clone = structuredClone(scenario) as Scenario
  const cells = collectScenarioRefs(clone)
  const filesByHash = new Map<string, { path: string; bytes: Uint8Array }>()
  // 每个去重后的媒体 → 一条媒体资产（video→VideoAsset，其余→raw-file）。
  const mediaByHash = new Map<string, ReelMediaAsset>()
  const external: BuildReelGameResult['external'] = []
  const missing: BuildReelGameResult['missing'] = []

  for (const cell of cells) {
    const ref = cell.get()
    const r = await opts.resolveBlob(ref)
    if (r.kind === 'blob') {
      const full = sha256hex(r.bytes)
      const hash = full.slice(0, 16) // 短内容寻址文件名
      const path = `reel-media/${hash}.${r.ext}`
      const url = `./${path}`
      if (!filesByHash.has(hash)) filesByHash.set(hash, { path, bytes: r.bytes })
      if (!mediaByHash.has(hash)) {
        // 首个用到该媒体的 cell 决定其 kind（同一字节内容类别一致）。
        if (cell.media === 'video') {
          mediaByHash.set(hash, {
            guid: mediaGuidFromSha(full), kind: 'video', name: `${hash}.${r.ext}`,
            payload: { url }, refs: [],
          })
        } else {
          const mime = mimeForExt(r.ext)
          mediaByHash.set(hash, {
            guid: mediaGuidFromSha(full), kind: 'raw-file', name: `${hash}.${r.ext}`,
            payload: mime ? { url, mime } : { url }, refs: [],
          })
        }
      }
      // 保留相对 URL 改写（现有 host FMV 播放路径不破）；GUID 引用切换在 P1-C loader 落地。
      cell.set(url)
    } else if (r.kind === 'external') {
      external.push({ ref, url: r.url }) // 外链原样保留
    } else {
      missing.push({ ref, reason: r.reason }) // 缺失原样保留，导出端打印告警
    }
  }

  // charter Fail-Fast：落盘前按 schema 骨架校验，绝不打包不合契约的剧本。
  assertReelScenario(clone)

  const mediaAssets = [...mediaByHash.values()]
  const entry: ReelGameEntryAsset = {
    guid: opts.guid,
    kind: 'reel-game',
    name: clone.title || clone.id,
    payload: makeReelGamePayload(clone as unknown as ReelScenarioLike),
    // refs = 引用图边：本影游用到的全部媒体 GUID（稳定排序，便于 diff / 校验）。
    refs: mediaAssets.map((a) => a.guid).sort(),
  }
  const packJson: ReelGamePackFile = {
    schemaVersion: '1.0.0',
    kind: 'internal-text-package',
    assets: [entry, ...mediaAssets],
  }
  return { packJson, mediaFiles: [...filesByHash.values()], external, missing }
}
