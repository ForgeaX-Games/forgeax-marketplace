/**
 * nodia demo —— 出厂数据在 `demo/nodia.graph.json`（完整 `GraphLibraryDocument`：
 * 根 meta + graph + manifest.packs，含主蓝图）。
 * 自定义覆盖物目录默认留空；画廊/Nodia 方案仍保留为可手动挂载的预设。
 *
 * 运行时/编辑进入优先级：localStorage 草稿 > 磁盘最新 > 空库。本 demo 仅供「重置」。
 * game 目录下的 `blueprint.json` 是保存后的权威文档；本 demo 不自动落盘。
 */
import type { GraphLibraryDocument } from '../../runtime/schema/graph-schema'
import demoJson from './nodia.graph.json'
import { ensureBuiltinSchemes } from './builtin-schemes'
import { normalizeDocument } from '../persist/blueprint-project'

/** 图 JSON + 基础覆盖物；规范化保证根 graph ↔ manifest.packs[main]。 */
function withDemoSchemes(doc: GraphLibraryDocument): GraphLibraryDocument {
  return normalizeDocument({
    ...doc,
    ui: { ...doc.ui, overlays: ensureBuiltinSchemes(doc.ui?.overlays) },
  })
}

/** 出厂只读库文档（勿直接改动；需要副本用 makeNodiaDemo）。 */
export const NODIA_DEMO_PROJECT: GraphLibraryDocument = withDemoSchemes(
  demoJson as unknown as GraphLibraryDocument,
)

/** @deprecated 与 `NODIA_DEMO_PROJECT` 相同；保留旧名给仍传 GameScenario 的调用点。 */
export const NODIA_DEMO: GraphLibraryDocument = NODIA_DEMO_PROJECT

/** 取一份可改的 demo 副本；可覆写实体 hp（测试与调试用）。 */
export function makeNodiaDemo(over: { bossHp?: number; playerHp?: number } = {}): GraphLibraryDocument {
  const s = structuredClone(NODIA_DEMO_PROJECT)
  const player = s.entities?.['ent-player']
  const boss = s.entities?.['ent-boss']
  if (over.playerHp != null && player?.attrs) player.attrs.hp = over.playerHp
  if (over.bossHp != null && boss?.attrs) boss.attrs.hp = over.bossHp
  return s
}
