/**
 * 纯构建器：一棵 Scenario + 一个媒体解析器 → reel-game.pack.json + 媒体文件清单。
 *
 * 这是「互动影游作为引擎资产（Route B）」的「蒸馏 / importer 等价物」：它把作者在
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
import { makeReelGamePayload, type ReelGamePayload } from './reelGamePayload'
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

export interface ReelGamePackFile {
  schemaVersion: '1.0.0'
  kind: 'internal-text-package'
  assets: Array<{
    guid: string
    kind: 'reel-game'
    name: string
    payload: ReelGamePayload
    refs: string[]
  }>
}

export interface BuildReelGameResult {
  packJson: ReelGamePackFile
  mediaFiles: Array<{ path: string; bytes: Uint8Array }>
  external: Array<{ ref: string; url: string }>
  missing: Array<{ ref: string; reason: string }>
}

/** sha256 前 16 个 hex —— 内容寻址文件名（碰撞概率可忽略，文件名短）。 */
function sha16(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16)
}

export async function buildReelGameAsset(
  scenario: Scenario,
  opts: BuildReelGameOptions,
): Promise<BuildReelGameResult> {
  // 破坏性扫描 + 改写都在深拷贝上做，绝不动调用方的原 scenario。
  const clone = structuredClone(scenario) as Scenario
  const cells = collectScenarioRefs(clone)
  const filesByHash = new Map<string, { path: string; bytes: Uint8Array }>()
  const external: BuildReelGameResult['external'] = []
  const missing: BuildReelGameResult['missing'] = []

  for (const cell of cells) {
    const ref = cell.get()
    const r = await opts.resolveBlob(ref)
    if (r.kind === 'blob') {
      const hash = sha16(r.bytes)
      const path = `reel-media/${hash}.${r.ext}`
      if (!filesByHash.has(hash)) filesByHash.set(hash, { path, bytes: r.bytes })
      cell.set(`./${path}`)
    } else if (r.kind === 'external') {
      external.push({ ref, url: r.url }) // 外链原样保留
    } else {
      missing.push({ ref, reason: r.reason }) // 缺失原样保留，导出端打印告警
    }
  }

  const packJson: ReelGamePackFile = {
    schemaVersion: '1.0.0',
    kind: 'internal-text-package',
    assets: [
      {
        guid: opts.guid,
        kind: 'reel-game',
        name: clone.title || clone.id,
        payload: makeReelGamePayload(clone as unknown as Record<string, unknown>),
        refs: [],
      },
    ],
  }
  return { packJson, mediaFiles: [...filesByHash.values()], external, missing }
}
