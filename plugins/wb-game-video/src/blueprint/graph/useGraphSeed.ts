/**
 * useGraphSeed —— graph 视图的「出厂 demo」实时派生自当前 per-game 真实剧本。
 *
 * 从旧引擎 scenarioStore 的活动 Scenario 转换出 GameScenario 作为 graphScenarioStore.ensureBoot
 * 的 demo 兜底：首次进入某 game（无草稿/版本）即以真实剧本播种；之后走 localStorage 编辑态。
 * 转换失败或空图时回落到内置 NODIA_DEMO，保证 graph 永远有可跑内容。
 */
import { useMemo } from 'react'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { scenarioToGraph } from './scenarioToGraph'
import { NODIA_DEMO } from './demo'
import type { GameScenario } from './graph-schema'

export function useGraphSeed(): GameScenario {
  const scenario = useScenarioStore((s) => s.scenario)
  return useMemo(() => {
    try {
      const g = scenarioToGraph(scenario)
      return g.graph.nodes.length > 0 ? g : NODIA_DEMO
    } catch {
      return NODIA_DEMO
    }
  }, [scenario])
}
