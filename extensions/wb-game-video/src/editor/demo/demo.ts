/**
 * nodia demo —— 出厂数据在 `demo/nodia.graph.json`（完整 `GraphLibraryDocument`：
 * 根 meta + graph + manifest.packs，含主蓝图）。
 * 方案 id/内容与 `nodia-scheme-overlays.ts` 对齐；`ensureBuiltinSchemes` 仅补缺失（含画廊方案）。
 *
 * 运行时/编辑进入优先级：localStorage 草稿/版本 > 本 demo。重置 = 回到本 demo。
 * game 目录下的 `scenarios.graph.json` 由运行时自动落盘，不在此管理。
 */
import type { GraphLibraryDocument } from '../../runtime/schema/graph-schema'
import demoJson from './nodia.graph.json'
import { ensureBuiltinSchemes } from './builtin-schemes'
import { normalizeDocument } from '../persist/blueprint-project'

/** 图 JSON + 固化界面方案（缺失才补）；规范化保证根 graph ↔ manifest.packs[main]。 */
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
