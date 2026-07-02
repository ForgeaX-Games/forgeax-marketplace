/**
 * 无 WebGPU 的 reel-game pack-index 读取器（独立播放器用）。
 *
 * 独立站点不应为了读一段 JSON 而起一个 GPU device / 整套引擎 AssetRegistry。
 * 这个读取器只做最朴素的三步：
 *   1) fetch pack-index.json（资产目录）
 *   2) 找到 kind==='reel-game' 的条目，按其 relativeUrl fetch 对应 .pack.json
 *   3) 用 extractValidatedScenario 从 payload 取回并 schema 校验整棵 Scenario
 *      （charter Fail-Fast：payload 不合契约就在这里炸，而不是带病进播放器）
 *
 * 与预览态共享同一棵 Scenario（都灌进 scenarioStore、由同一个 Player 渲染）：预览走
 * bootScenarioPersist（读 workbench/reel），本读取器走纯 fetch（独立站点 ?src=pack）。
 *〔暂缓〕将来影游若内嵌进引擎场景，再补一个 loadByGuid loader 作为「同一磁盘格式的
 * 第三个消费端」，磁盘格式不变。
 */

import { type ReelScenarioLike } from '../scenario/pkg/reelGamePayload'
import { extractValidatedScenario } from '../scenario/schema/validateScenario'

export interface LoadDeps {
  fetchJson: (url: string) => Promise<unknown>
}

const defaultDeps: LoadDeps = {
  fetchJson: async (url) => (await fetch(url, { cache: 'no-store' })).json(),
}

interface PackIndexEntry {
  guid: string
  kind: string
  relativeUrl: string
}

/** 把 pack-index 里的相对 url 基于 index 文件位置重定位成可 fetch 的 url。 */
function rebase(packIndexUrl: string, relativeUrl: string): string {
  if (!relativeUrl.startsWith('.')) return relativeUrl
  const base = packIndexUrl.slice(0, packIndexUrl.lastIndexOf('/') + 1)
  return base + relativeUrl.replace(/^\.\//, '')
}

export async function loadReelGameFromPackIndex(
  packIndexUrl: string,
  deps: LoadDeps = defaultDeps,
): Promise<ReelScenarioLike> {
  const index = (await deps.fetchJson(packIndexUrl)) as PackIndexEntry[]
  const entry = Array.isArray(index) ? index.find((e) => e.kind === 'reel-game') : undefined
  if (!entry) throw new Error('no reel-game asset in pack-index')
  const packUrl = rebase(packIndexUrl, entry.relativeUrl)
  const pack = (await deps.fetchJson(packUrl)) as {
    assets: Array<{ guid: string; payload: unknown }>
  }
  const asset = pack.assets.find((a) => a.guid === entry.guid) ?? pack.assets[0]
  return extractValidatedScenario(asset?.payload)
}
