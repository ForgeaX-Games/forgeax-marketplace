/**
 * 共享素材层资产列表的**原始读取** —— 失败即抛，由调用方决定吞还是报。
 *
 * 两种调用姿态各有正当理由，所以分两层：
 *  - 吞（`media.ts` 的 `listRegistryAssets`）：`GraphVideoView` 的素材列表 / 占位卡这些「有就画、
 *    没有就空着」的地方，多一条错误状态只会让代码长出一堆用不上的分支；
 *  - 报（需要区分「查不到」与「库里真没有」的调用方）：吞掉的话面板会拿着空数组对作者撒谎。
 *    BGM 下拉已改走项目资产缓存，不再依赖本端点的 audio 过滤。
 */
import { pluginFetch } from '../../lib/plugin-http'
import type { MediaAsset, MediaKind } from './registry-types'

export async function fetchRegistryAssets(game?: string, kind?: MediaKind): Promise<MediaAsset[]> {
  const params = new URLSearchParams()
  if (game) params.set('game', game)
  if (kind) params.set('kind', kind)
  const qs = params.toString()
  const r = await pluginFetch(`/__gva__/assets${qs ? `?${qs}` : ''}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = (await r.json()) as { assets?: MediaAsset[] }
  return Array.isArray(j.assets) ? j.assets : []
}
