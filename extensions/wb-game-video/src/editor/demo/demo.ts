/**
 * nodia demo 场景 —— 出厂数据在 `demo/nodia.graph.json`（图 + `ui.overlays` 方案正文）。
 * 方案 id/内容与 `nodia-scheme-overlays.ts` 对齐；`ensureBuiltinSchemes` 仅补缺失（含画廊方案）。
 *
 * 运行时/编辑进入优先级：localStorage 草稿/版本 > 本 demo。重置 = 回到本 demo。
 * game 目录下的 `scenarios.graph.json` 由运行时自动落盘，不在此管理。
 */
import type { GameScenario } from '../../runtime/schema/graph-schema'
import demoJson from './nodia.graph.json'
import { ensureBuiltinSchemes } from './builtin-schemes'

/** 图 JSON + 固化界面方案（缺失才补）。 */
function withDemoSchemes(s: GameScenario): GameScenario {
  return {
    ...s,
    ui: { ...s.ui, overlays: ensureBuiltinSchemes(s.ui?.overlays) },
  }
}

/** 出厂只读原始 demo（勿直接改动；需要副本用 makeNodiaDemo）。 */
export const NODIA_DEMO = withDemoSchemes(demoJson as unknown as GameScenario)

/** 取一份可改的 demo 副本；可覆写实体 hp / rng seed（测试与调试用）。 */
export function makeNodiaDemo(over: { bossHp?: number; playerHp?: number; seed?: number } = {}): GameScenario {
  const s = structuredClone(NODIA_DEMO)
  const player = s.entities?.['ent-player']
  const boss = s.entities?.['ent-boss']
  if (over.playerHp != null && player?.attrs) player.attrs.hp = over.playerHp
  if (over.bossHp != null && boss?.attrs) boss.attrs.hp = over.bossHp
  if (over.seed != null) s.rng = { seed: over.seed }
  return s
}
