/**
 * BGM 录入的作者态纯函数（无 React / 无 IO）—— 面板上每一次改动都过这里再写回图。
 *
 * 一条铁律：**ref 空 = 整个 `bgm` 消失**（唯一例外是节点的 `mode: 'stop'`，那一条本就不带曲子）。
 * `{ ref: '' }` 会被 validate 判 error、被 runtime 静默丢弃（见 `getNodeBgm`），作者只会听到
 * 「没响」；所以清空音乐必须删字段，不能留空壳。
 * 同理默认值（`mode: 'push'` / `restart: false` / `loop: true`）一律
 * 不落盘 —— 让「没配」与「配了默认值」在磁盘上同形，旧图不会因为点开一次面板就长出一堆等价字段。
 */
import type { NodeBgm } from '../../runtime/schema/graph-schema'
import type { KinoResourceDTO } from '../assets/kino-api'

/** BGM 资产下拉候选：`id` 落盘（永不落 URL），`label` 仅展示。 */
export interface AudioOption {
  id: string
  label: string
}

function cleanRef(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** 音量归一到 [0, 1]；非数字/NaN 视为未设（validate 对越界值只报 error，不替作者兜底）。 */
function cleanVolume(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return Math.min(1, Math.max(0, v))
}

/** fade 毫秒取整；≤0 与非法值一律视为未设（0 = 不淡入淡出 = 缺省行为）。 */
function cleanMs(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return undefined
  return Math.round(v)
}

/**
 * 节点作用域 BGM 的补丁 —— `undefined` 返回值即「把 `data.bgm` 键删掉」（`patchNodeData` 语义）。
 * 面板出 ref / mode / restart，手写落盘的 volume / fade 原样保留。
 *
 * 两条形状规则，缺一条作者就写不出 v2 的配置或者会落下撒谎的残留：
 *
 * 1. **`mode: 'stop'` 独占一条**（结束当前音乐，不引入曲子）：ref 与播放字段一律收掉。
 *    `BgmStack.stop()` 只读**被结束那一层**的字段（fadeOutMs 取离场帧、volume 与
 *    fadeInMs 取恢复出来的那帧），ref 更是压根不读（SPEC §3.3「给了也忽略」）——留着它们只会
 *    让面板显示着一首永远不播的曲子。
 *    离开 stop 要显式给 mode（下拉就是这么写的）；那时手上没曲子，于是回到下面那条。
 * 2. **没有非空 ref 就删键**：`{ ref: '' }` 会被 validate 判 error、被 runtime 静默丢弃，
 *    作者只会听到「没响」。清空音乐必须让整个 `bgm` 消失。
 */
export function patchNodeBgm(current: NodeBgm | undefined, patch: Partial<NodeBgm>): NodeBgm | undefined {
  const merged = { ...current, ...patch }
  if (merged.mode === 'stop') return { mode: 'stop' }
  const ref = cleanRef(merged.ref)
  if (!ref) return undefined
  const out: NodeBgm = { ref }
  if (merged.mode === 'replace') out.mode = 'replace'
  const volume = cleanVolume(merged.volume)
  if (volume !== undefined) out.volume = volume
  const fadeInMs = cleanMs(merged.fadeInMs)
  if (fadeInMs !== undefined) out.fadeInMs = fadeInMs
  const fadeOutMs = cleanMs(merged.fadeOutMs)
  if (fadeOutMs !== undefined) out.fadeOutMs = fadeOutMs
  if (merged.restart === true) out.restart = true
  return out
}

/**
 * Kino 音频资源 → BGM 候选（与「视频」字段拼 `VideoOption` 同款：去重、名字优先）。
 * 数据源是 Kino `media_type: 'audio'`（资产库上传的那批），不是本地 `/__gva__/assets`。
 */
export function audioAssetOptions(resources: readonly KinoResourceDTO[]): AudioOption[] {
  const seen = new Set<string>()
  const out: AudioOption[] = []
  for (const resource of resources) {
    const id = resource.resource_id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = resource.name?.trim()
    out.push({ id, label: name && name !== id ? name : id })
  }
  return out
}
